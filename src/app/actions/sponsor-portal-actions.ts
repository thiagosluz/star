'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Experiência do patrocinador (FASE 42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS PÚBLICOS, TRÊS PERMISSÕES
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • ORGANIZAÇÃO (`sponsor:manage`): cria o QR, convida e vincula pessoas;
 *    • PATROCINADOR (`sponsor:read` + VÍNCULO ativo com aquele patrocinador): lê a
 *      própria área — nenhuma ação de escrita sobre dado de terceiro;
 *    • PARTICIPANTE: lê o QR (credita a visita e decide compartilhar) e revoga o
 *      que autorizou. Estas duas NÃO exigem permissão de instituição: exigem ser a
 *      própria pessoa — a posse é o `userId` da sessão.
 *
 *  A autorização é conferida aqui, não na tela: uma Server Action é um endpoint
 *  HTTP como qualquer outro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { sponsorQrInputSchema } from '@/domain/events/sponsor-experience-rules';
import {
  acceptSponsorInvite,
  deleteSponsorQrCode,
  inviteSponsorUser,
  linkSponsorUserByEmail,
  removeSponsorUser,
  revokeSponsorConsent,
  saveSponsorQrCode,
  scanSponsorQr,
  setSponsorQrCodeActive,
} from '@/lib/sponsors/sponsor-portal-service';

export interface SponsorPortalActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

/** Sessão + vínculo ativo + permissão de GESTÃO do patrocínio. */
async function guardManage(tenantSlug: string): Promise<
  | { ok: true; userId: string; tenantId: string }
  | { ok: false; state: SponsorPortalActionState }
> {
  const context = await guardSession(tenantSlug);
  if (!context.ok) return context;

  const principal: Principal = await loadPrincipal(context.userId, context.tenantId, 'ACTIVE');

  if (!can(principal, PERMISSIONS.SPONSOR_MANAGE, { scope: 'TENANT' })) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: 'Permissão negada: sponsor:manage.' },
    };
  }

  return { ok: true, userId: context.userId, tenantId: context.tenantId };
}

/** Sessão + instituição existente — SEM exigir vínculo (aceite de convite). */
async function guardAuthenticated(tenantSlug: string): Promise<
  | { ok: true; userId: string; tenantId: string; userEmail: string }
  | { ok: false; state: SponsorPortalActionState }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return { ok: false, state: { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' } };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, userEmail: user.email ?? '' };
}

/** Sessão + vínculo ativo com a instituição (sem exigir papel). */
async function guardSession(tenantSlug: string): Promise<
  | { ok: true; userId: string; tenantId: string; userEmail: string }
  | { ok: false; state: SponsorPortalActionState }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return { ok: false, state: { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' } };
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: 'Você não tem vínculo ativo com esta instituição.' },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, userEmail: user.email ?? '' };
}

function nullable(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

function revalidateSponsorArea(tenantSlug: string, eventId?: string | null): void {
  revalidatePath(tenantPath(tenantSlug, '/patrocinador'));
  if (eventId) {
    revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/patrocinadores`));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  QR do patrocinador (organização)
// ═══════════════════════════════════════════════════════════════════════════════
const qrFormSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  sponsorId: z.string().uuid(),
  qrId: z.string().uuid().optional(),
  label: z.string().trim().min(3).max(120),
  xpAmount: z.coerce.number().int().min(0).max(500).default(0),
  cardTemplateId: z.string().uuid().optional(),
  consentDays: z.coerce.number().int().min(1).max(365).default(90),
});

export async function saveSponsorQrAction(
  _prev: SponsorPortalActionState | null,
  formData: FormData,
): Promise<SponsorPortalActionState> {
  const parsed = qrFormSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    sponsorId: formData.get('sponsorId'),
    qrId: nullable(formData.get('qrId')) ?? undefined,
    label: formData.get('label'),
    xpAmount: formData.get('xpAmount') || 0,
    cardTemplateId: nullable(formData.get('cardTemplateId')) ?? undefined,
    consentDays: formData.get('consentDays') || 90,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique os dados do QR.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const data = parsed.data;

  /** A mesma validação do domínio que os testes usam — não há duas réguas. */
  const domainCheck = sponsorQrInputSchema.safeParse({
    label: data.label,
    xpAmount: data.xpAmount,
    cardTemplateId: data.cardTemplateId,
    consentDays: data.consentDays,
  });

  if (!domainCheck.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'QR inválido.',
      details: domainCheck.error.issues.map((issue) => issue.message),
    };
  }

  const context = await guardManage(data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await saveSponsorQrCode({
    tenantId: context.tenantId,
    actorId: context.userId,
    sponsorId: data.sponsorId,
    eventId: data.eventId,
    ...(data.qrId ? { qrId: data.qrId } : {}),
    label: data.label,
    xpAmount: data.xpAmount,
    cardTemplateId: data.cardTemplateId ?? null,
    consentDays: data.consentDays,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateSponsorArea(data.tenantSlug, data.eventId);

  return {
    ok: true,
    message: result.created
      ? `QR criado. O código é ${result.code} — imprima no estande.`
      : 'QR atualizado.',
    data: { qrId: result.qrId, code: result.code },
  };
}

export async function setSponsorQrActiveAction(
  _prev: SponsorPortalActionState | null,
  formData: FormData,
): Promise<SponsorPortalActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      qrId: z.string().uuid(),
      isActive: z.enum(['true', 'false']),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      qrId: formData.get('qrId'),
      isActive: formData.get('isActive'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guardManage(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await setSponsorQrCodeActive({
    tenantId: context.tenantId,
    actorId: context.userId,
    qrId: parsed.data.qrId,
    isActive: parsed.data.isActive === 'true',
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateSponsorArea(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: parsed.data.isActive === 'true' ? 'QR reativado.' : 'QR desativado.' };
}

export async function deleteSponsorQrAction(
  _prev: SponsorPortalActionState | null,
  formData: FormData,
): Promise<SponsorPortalActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      qrId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      qrId: formData.get('qrId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guardManage(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await deleteSponsorQrCode({
    tenantId: context.tenantId,
    actorId: context.userId,
    qrId: parsed.data.qrId,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateSponsorArea(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: 'QR excluído. As leituras dele saíram junto.' };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Vínculo (organização)
// ═══════════════════════════════════════════════════════════════════════════════
export async function inviteSponsorUserAction(
  _prev: SponsorPortalActionState | null,
  formData: FormData,
): Promise<SponsorPortalActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      sponsorId: z.string().uuid(),
      email: z.email('E-mail inválido.').max(255),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      sponsorId: formData.get('sponsorId'),
      email: formData.get('email'),
    });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'E-mail inválido.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const context = await guardManage(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await inviteSponsorUser({
    tenantId: context.tenantId,
    actorId: context.userId,
    sponsorId: parsed.data.sponsorId,
    email: parsed.data.email,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateSponsorArea(parsed.data.tenantSlug, parsed.data.eventId);

  /**
   * O token aparece UMA vez, na resposta — dentro do LINK completo, que é o que o
   * operador copia e envia. Depois disso ele só existe como hash; quem perder o
   * link gera outro (e o anterior morre).
   */
  const invitePath = tenantPath(
    parsed.data.tenantSlug,
    `/patrocinador/convite?codigo=${result.token}`,
  );

  return {
    ok: true,
    message: `Convite gerado para ${result.email}. Envie este link (ele aparece só uma vez): ${invitePath}`,
    data: { token: result.token, expiresAt: result.expiresAt.toISOString(), email: result.email },
  };
}

export async function linkSponsorUserAction(
  _prev: SponsorPortalActionState | null,
  formData: FormData,
): Promise<SponsorPortalActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      sponsorId: z.string().uuid(),
      email: z.email('E-mail inválido.').max(255),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      sponsorId: formData.get('sponsorId'),
      email: formData.get('email'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'E-mail inválido.' };
  }

  const context = await guardManage(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await linkSponsorUserByEmail({
    tenantId: context.tenantId,
    actorId: context.userId,
    sponsorId: parsed.data.sponsorId,
    email: parsed.data.email,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateSponsorArea(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: `${result.name} agora tem acesso a este patrocinador.` };
}

export async function removeSponsorUserAction(
  _prev: SponsorPortalActionState | null,
  formData: FormData,
): Promise<SponsorPortalActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      linkId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      linkId: formData.get('linkId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guardManage(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await removeSponsorUser({
    tenantId: context.tenantId,
    actorId: context.userId,
    linkId: parsed.data.linkId,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateSponsorArea(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: 'Acesso removido. Os contatos autorizados continuam com o patrocinador.' };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Aceite do convite (a pessoa convidada)
// ═══════════════════════════════════════════════════════════════════════════════
export async function acceptSponsorInviteAction(
  _prev: SponsorPortalActionState | null,
  formData: FormData,
): Promise<SponsorPortalActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      token: z.string().trim().min(8).max(64),
    })
    .safeParse({ tenantSlug: formData.get('tenantSlug'), token: formData.get('token') });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Convite inválido.' };
  }

  /**
   * ─── O ACEITE NÃO EXIGE VÍNCULO PRÉVIO (só autenticação) ─────────────────────
   *
   *  O contato comercial da empresa pode não ter vínculo nenhum com a instituição.
   *  O convite prova a posse do e-mail; o VÍNCULO nasce do aceite, como no convite
   *  de palestrante (FASE 25) e no convite de equipe (FASE 15). Exigir vínculo aqui
   *  criaria o impasse: sem vínculo não se aceita, e sem aceitar não há vínculo.
   */
  const context = await guardAuthenticated(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await acceptSponsorInvite({
    tenantId: context.tenantId,
    userId: context.userId,
    userEmail: context.userEmail,
    token: parsed.data.token,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateSponsorArea(parsed.data.tenantSlug);

  return { ok: true, message: `Pronto! Você agora tem acesso à área de ${result.sponsorName}.` };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  A LEITURA do QR (participante) — crédito e consentimento
// ═══════════════════════════════════════════════════════════════════════════════
export async function scanSponsorQrAction(
  _prev: SponsorPortalActionState | null,
  formData: FormData,
): Promise<SponsorPortalActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      code: z.string().trim().min(4).max(20),
      /**
       * `consent` chega como `'true'`/`'false'` de dois botões diferentes do MESMO
       * formulário: o crédito é igual nos dois, e só o compartilhamento muda.
       */
      consent: z.enum(['true', 'false']),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      code: formData.get('code'),
      consent: formData.get('consent'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'QR inválido.' };
  }

  const context = await guardSession(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await scanSponsorQr({
    tenantId: context.tenantId,
    code: parsed.data.code,
    userId: context.userId,
    consent: parsed.data.consent === 'true',
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/minhas-inscricoes'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/meus-compartilhamentos'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/cartas'));

  const { outcome } = result;

  /** A tela mostra o que ACONTECEU: quanto creditou, e se compartilhou ou não. */
  const partes: string[] = [];

  if (outcome.repeated) {
    partes.push('Você já havia registrado esta visita — nada foi creditado de novo.');
  } else if (outcome.xpAwarded > 0) {
    partes.push(`+${outcome.xpAwarded} XP pela visita a ${outcome.sponsorName}.`);
  } else {
    partes.push(`Visita a ${outcome.sponsorName} registrada.`);
  }

  if (outcome.cardName) partes.push(`Você ganhou a carta "${outcome.cardName}".`);

  partes.push(
    outcome.shared
      ? `Seu nome e e-mail foram compartilhados por ${outcome.consentDays} dia(s). Você pode revogar em "Meus compartilhamentos".`
      : 'Você escolheu não compartilhar seus dados — o patrocinador vê apenas o número da visita.',
  );

  return {
    ok: true,
    message: partes.join(' '),
    data: {
      sponsorName: outcome.sponsorName,
      xpAwarded: outcome.xpAwarded,
      cardName: outcome.cardName,
      repeated: outcome.repeated,
      shared: outcome.shared,
    },
  };
}

/** O participante revoga o que autorizou. */
export async function revokeSponsorConsentAction(
  _prev: SponsorPortalActionState | null,
  formData: FormData,
): Promise<SponsorPortalActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      scanId: z.string().uuid(),
    })
    .safeParse({ tenantSlug: formData.get('tenantSlug'), scanId: formData.get('scanId') });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Registro inválido.' };
  }

  const context = await guardSession(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await revokeSponsorConsent({
    tenantId: context.tenantId,
    userId: context.userId,
    scanId: parsed.data.scanId,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/meus-compartilhamentos'));

  return {
    ok: true,
    message: 'Autorização revogada. O patrocinador deixou de ver os seus dados.',
  };
}
