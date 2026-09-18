'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Patrocínio (FASE 17, item E5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `sponsor:manage` — E NÃO `page:manage`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Patrocínio é dado COMERCIAL: valor de contrato, contato, vigência. O papel
 *  `FINANCE` tem `sponsor:manage` desde a FASE 2 justamente para cuidar disso sem
 *  receber `page:manage` (que publica no site). Separar as duas permissões é o que
 *  permite o financeiro manter o cadastro sem poder alterar a página pública.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DOCUMENTO FISCAL NÃO VOLTA PARA A TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O formulário envia CNPJ/CPF, o serviço grava, e a LEITURA devolve só a máscara
 *  (`maskTaxId`). A trilha de auditoria também não recebe o campo — ver
 *  `saveSponsor`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  SPONSOR_TIER_KEYS,
  parseBenefits,
  sponsorInputSchema,
  tierInputSchema,
  type SponsorTierKey,
} from '@/domain/events/sponsor-rules';
import {
  copySponsorToEvent,
  deleteSponsorTier,
  removeSponsor,
  saveSponsor,
  saveSponsorTier,
  setSponsorActive,
} from '@/lib/admin/sponsor-service';

export interface SponsorActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

async function guard(tenantSlug: string): Promise<
  | { ok: true; userId: string; tenantId: string }
  | { ok: false; state: SponsorActionState }
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

  const principal: Principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, PERMISSIONS.SPONSOR_MANAGE, { scope: 'TENANT' })) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: 'Permissão negada: sponsor:manage.' },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id };
}

function revalidateSponsors(tenantSlug: string, eventId: string): void {
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/patrocinadores`));
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}`));
  revalidatePath(tenantPath(tenantSlug, '/eventos'), 'layout');
}

function nullable(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

/**
 * Converte `AAAA-MM-DD` em data ao MEIO-DIA UTC.
 *
 * Mesma decisão da FASE 16: o `<input type="date">` não tem hora, e interpretar à
 * meia-noite local deslocaria o dia em fusos negativos — um contrato que vence "31
 * de dezembro" apareceria como 30 no relatório.
 */
function toDateOnly(value: FormDataEntryValue | null): Date | undefined {
  const text = nullable(value);
  if (!text) return undefined;
  const date = new Date(`${text}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const tierFormSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  tierId: z.string().uuid().optional(),
  key: z.enum(SPONSOR_TIER_KEYS as unknown as [SponsorTierKey, ...SponsorTierKey[]]),
  name: z.string().trim().min(3, 'O nome da cota precisa ter ao menos 3 caracteres.').max(80),
  description: z.string().trim().max(400).optional(),
  color: z.string().trim().max(9).optional(),
  rank: z.coerce.number().int().min(0).max(1000).default(0),
  priceCents: z.coerce.number().int().min(0).default(0),
  currency: z.string().trim().length(3).default('BRL'),
  maxSponsors: z.coerce.number().int().min(0).max(200).default(0),
  benefits: z.string().max(4000).optional(),
});

/**
 * Cota em CENTAVOS, digitada em reais.
 *
 * A tela pede reais ("valor comercial") e o banco guarda centavos: dinheiro em
 * ponto flutuante é erro clássico, e a conversão fica em UM lugar. O arredondamento
 * é para o centavo mais próximo — `Math.round(199.99 * 100)` dá 19999.
 */
function reaisToCents(raw: FormDataEntryValue | null): number {
  const text = nullable(raw);
  if (!text) return 0;
  const value = Number(text.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

export async function saveTierAction(
  _prev: SponsorActionState | null,
  formData: FormData,
): Promise<SponsorActionState> {
  const parsed = tierFormSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    tierId: nullable(formData.get('tierId')) ?? undefined,
    key: formData.get('key') || 'CUSTOM',
    name: formData.get('name'),
    description: nullable(formData.get('description')) ?? undefined,
    color: nullable(formData.get('color')) ?? undefined,
    rank: formData.get('rank') || 0,
    priceCents: reaisToCents(formData.get('priceReais')),
    currency: formData.get('currency') || 'BRL',
    maxSponsors: formData.get('maxSponsors') || 0,
    benefits: typeof formData.get('benefits') === 'string' ? String(formData.get('benefits')) : undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique os dados da cota.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const data = parsed.data;

  /**
   * O formato da cota passa pelo MESMO schema do domínio usado pelos testes: a
   * validação que a tela dispara é a mesma que o serviço aceita, então não existe
   * "passou no formulário e falhou no serviço".
   */
  const domainCheck = tierInputSchema.safeParse({
    key: data.key,
    name: data.name,
    description: data.description,
    color: data.color,
    rank: data.rank,
    priceCents: data.priceCents,
    currency: data.currency,
    maxSponsors: data.maxSponsors,
    benefits: parseBenefits(data.benefits),
  });

  if (!domainCheck.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Cota inválida.',
      details: domainCheck.error.issues.map((issue) => issue.message),
    };
  }

  const context = await guard(data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await saveSponsorTier({
    tenantId: context.tenantId,
    eventId: data.eventId,
    actorId: context.userId,
    ...(data.tierId ? { tierId: data.tierId } : {}),
    key: data.key,
    name: data.name,
    description: data.description ?? null,
    color: data.color ?? null,
    rank: data.rank,
    priceCents: data.priceCents,
    currency: data.currency,
    maxSponsors: data.maxSponsors,
    benefits: domainCheck.data.benefits,
  });

  if (!result.ok) return result;

  revalidateSponsors(data.tenantSlug, data.eventId);

  return {
    ok: true,
    message: result.created ? 'Cota criada.' : 'Cota atualizada.',
    data: { tierId: result.tierId },
  };
}

export async function deleteTierAction(
  _prev: SponsorActionState | null,
  formData: FormData,
): Promise<SponsorActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      tierId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      tierId: formData.get('tierId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await deleteSponsorTier({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    actorId: context.userId,
    tierId: parsed.data.tierId,
  });

  if (!result.ok) return result;

  revalidateSponsors(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: 'Cota removida.' };
}

const sponsorFormSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  sponsorId: z.string().uuid().optional(),
  name: z.string().trim().min(2, 'Informe o nome do patrocinador.').max(160),
  description: z.string().trim().max(2000).optional(),
  websiteUrl: z.string().trim().max(1024).optional(),
  logoUrl: z.string().trim().max(1024).optional(),
  tierId: z.string().uuid().optional(),
  contactName: z.string().trim().max(160).optional(),
  contactEmail: z.string().trim().max(255).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  taxId: z.string().trim().max(32).optional(),
  displayOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.coerce.boolean().default(true),
});

export async function saveSponsorAction(
  _prev: SponsorActionState | null,
  formData: FormData,
): Promise<SponsorActionState> {
  const parsed = sponsorFormSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    sponsorId: nullable(formData.get('sponsorId')) ?? undefined,
    name: formData.get('name'),
    description: nullable(formData.get('description')) ?? undefined,
    websiteUrl: nullable(formData.get('websiteUrl')) ?? undefined,
    logoUrl: nullable(formData.get('logoUrl')) ?? undefined,
    tierId: nullable(formData.get('tierId')) ?? undefined,
    contactName: nullable(formData.get('contactName')) ?? undefined,
    contactEmail: nullable(formData.get('contactEmail')) ?? undefined,
    contactPhone: nullable(formData.get('contactPhone')) ?? undefined,
    taxId: nullable(formData.get('taxId')) ?? undefined,
    displayOrder: formData.get('displayOrder') || 0,
    isActive: formData.get('isActive') === 'on',
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique os dados do patrocinador.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const data = parsed.data;

  const domainCheck = sponsorInputSchema.safeParse({
    name: data.name,
    description: data.description,
    websiteUrl: data.websiteUrl,
    logoUrl: data.logoUrl,
    tierId: data.tierId,
    contactName: data.contactName,
    contactEmail: data.contactEmail,
    contactPhone: data.contactPhone,
    taxId: data.taxId,
    contractValueCents: reaisToCents(formData.get('contractValueReais')),
    contractStart: toDateOnly(formData.get('contractStart')),
    contractEnd: toDateOnly(formData.get('contractEnd')),
    displayOrder: data.displayOrder,
    isActive: data.isActive,
  });

  if (!domainCheck.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Patrocinador inválido.',
      details: domainCheck.error.issues.map((issue) => issue.message),
    };
  }

  const context = await guard(data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await saveSponsor({
    tenantId: context.tenantId,
    eventId: data.eventId,
    actorId: context.userId,
    ...(data.sponsorId ? { sponsorId: data.sponsorId } : {}),
    name: domainCheck.data.name,
    description: domainCheck.data.description ?? null,
    websiteUrl: domainCheck.data.websiteUrl ?? null,
    logoUrl: domainCheck.data.logoUrl ?? null,
    tierId: domainCheck.data.tierId ?? null,
    contactName: domainCheck.data.contactName ?? null,
    contactEmail: domainCheck.data.contactEmail ?? null,
    contactPhone: domainCheck.data.contactPhone ?? null,
    /**
     * Documento fiscal: AUSENTE significa preservar o que já está gravado (a tela
     * mostra o valor mascarado e não tem como devolvê-lo). Ver `SaveSponsorInput`.
     */
    ...(domainCheck.data.taxId ? { taxId: domainCheck.data.taxId } : {}),
    contractValueCents: domainCheck.data.contractValueCents ?? null,
    contractStart: domainCheck.data.contractStart ?? null,
    contractEnd: domainCheck.data.contractEnd ?? null,
    displayOrder: domainCheck.data.displayOrder,
    isActive: domainCheck.data.isActive,
  });

  if (!result.ok) return result;

  revalidateSponsors(data.tenantSlug, data.eventId);

  return {
    ok: true,
    message: result.created
      ? `Patrocinador cadastrado (identificador ${result.slug}).`
      : 'Patrocinador atualizado.',
    data: { sponsorId: result.sponsorId, slug: result.slug },
  };
}

export async function setSponsorActiveAction(
  _prev: SponsorActionState | null,
  formData: FormData,
): Promise<SponsorActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      sponsorId: z.string().uuid(),
      isActive: z.coerce.boolean(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      sponsorId: formData.get('sponsorId'),
      isActive: formData.get('isActive') === 'true',
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await setSponsorActive({
    tenantId: context.tenantId,
    actorId: context.userId,
    sponsorId: parsed.data.sponsorId,
    isActive: parsed.data.isActive,
  });

  if (!result.ok) return result;

  revalidateSponsors(parsed.data.tenantSlug, parsed.data.eventId);

  return {
    ok: true,
    message: result.isActive
      ? 'Patrocinador visível na página pública.'
      : 'Patrocinador oculto da página pública.',
  };
}

/**
 * Copia um patrocinador de outro evento da instituição para este (FASE 23, item E11).
 *
 * A cópia nasce INATIVA e sem valor de contrato: é um cadastro para a próxima
 * edição, não um patrocínio fechado. O valor é renegociado a cada edição, e o
 * contato (a pessoa) é o mesmo.
 */
export async function copySponsorAction(
  _prev: SponsorActionState | null,
  formData: FormData,
): Promise<SponsorActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      sourceSponsorId: z.string().uuid('Selecione um patrocinador.'),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      sourceSponsorId: formData.get('sourceSponsorId'),
    });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos.',
    };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await copySponsorToEvent({
    tenantId: context.tenantId,
    eventId: parsed.data.eventId,
    actorId: context.userId,
    sourceSponsorId: parsed.data.sourceSponsorId,
  });

  if (!result.ok) return result;

  revalidateSponsors(parsed.data.tenantSlug, parsed.data.eventId);

  return {
    ok: true,
    message: result.tierMatched
      ? `"${result.sourceName}" copiado para este evento, na mesma cota. Ele entra OCULTO: revise o contrato e exiba quando estiver fechado.`
      : `"${result.sourceName}" copiado para este evento SEM cota (a cota de origem não existe aqui). Ele entra OCULTO: escolha a cota e exiba quando estiver fechado.`,
    data: { sponsorId: result.sponsorId, slug: result.slug, tierMatched: result.tierMatched },
  };
}

export async function removeSponsorAction(
  _prev: SponsorActionState | null,
  formData: FormData,
): Promise<SponsorActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      sponsorId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      sponsorId: formData.get('sponsorId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard(parsed.data.tenantSlug);
  if (!context.ok) return context.state;

  const result = await removeSponsor({
    tenantId: context.tenantId,
    actorId: context.userId,
    sponsorId: parsed.data.sponsorId,
  });

  if (!result.ok) return result;

  revalidateSponsors(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: 'Patrocinador removido do evento.' };
}
