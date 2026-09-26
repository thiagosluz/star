'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Palestrantes (FASE 25)
 *
 *  Dois públicos, duas guardas:
 *
 *    • **Organização** (`speaker:manage`): cadastra o palestrante, vincula à
 *      atividade, gera convite, lê os materiais enviados.
 *    • **Palestrante** (`speaker:profile:update:own` / `speaker:material:manage:own`):
 *      edita o PRÓPRIO perfil, publica material nas atividades que ministra e emite o
 *      próprio certificado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A POSSE NÃO VEM DO FORMULÁRIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nenhuma ação aceita "de quem é este perfil" como fato: o id recebido é consultado
 *  no banco e o `userId` gravado é comparado com o da sessão. Uma Server Action é um
 *  endpoint HTTP público — esconder o botão nunca foi controle de acesso, e confiar no
 *  campo escondido seria a mesma coisa com mais passos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { withTenant } from '@/lib/db/tenant-client';
import { can, holdsPermission, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  MATERIAL_KINDS,
  MATERIAL_VISIBILITIES,
  SOCIAL_NETWORKS,
} from '@/domain/speakers/speaker-rules';
import {
  linkSpeakerToActivity,
  regenerateSpeakerInvite,
  saveSpeakerProfile,
  unlinkSpeakerFromActivity,
} from '@/lib/speakers/speaker-service';
import {
  claimSpeakerProfile,
  updateMySpeakerProfile,
  updateSpeakerNotes,
} from '@/lib/speakers/speaker-portal-service';
import {
  confirmMaterialUpload,
  createMaterialLink,
  deleteMaterial,
  loadMaterialOwnership,
  requestMaterialUpload,
  updateMaterial,
} from '@/lib/speakers/material-service';
import { issueCertificate } from '@/lib/certificates/certificate-service';
import { confirmAssetUpload, requestAssetUpload } from '@/lib/admin/asset-service';
import { isUniqueViolation } from '@/lib/db/prisma-errors';

export interface SpeakerActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Guardas
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Revalida a administração da instituição inteira (e não só uma tela).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE `'layout'`, E NÃO O CAMINHO EXATO (FASE 25)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O cadastro do palestrante muda a tela de PALESTRANTES e também a do EVENTO (a
 *  contagem e os atalhos). Revalidar só `/administracao` deixava a tela aberta
 *  servindo o RSC em cache: o organizador salvava o palestrante, lia "cadastrado" e
 *  continuava vendo a lista antiga — o defeito clássico de "salvou mas não aparece".
 *
 *  Revalidar o segmento cobre a subárvore inteira, inclusive telas que ainda não
 *  existem. Descoberto pelo E2E da fase, que é exatamente para isso que ele serve.
 */
function revalidateSpeakerAdmin(tenantSlug: string): void {
  revalidatePath(tenantPath(tenantSlug, '/administracao'), 'layout');
}

/**
 * Recusa de entrada com o CAMPO que falhou.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE OS CAMPOS VÃO NO `details` (FASE 25)
 * ─────────────────────────────────────────────────────────────────────────────
 *  "Não foi possível ler a imagem escolhida" sem dizer QUAL campo faltou é o tipo de
 *  mensagem que faz o organizador (e o depurador) adivinharem. O E2E da fase parou
 *  exatamente nisso: a ação recusava o envio da foto e não havia como saber que o
 *  `eventId` viajava vazio. O caminho de erro passou a dizer o campo, como o resto da
 *  plataforma já faz com validação de formulário.
 */
function invalidInput(
  message: string,
  error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] },
): SpeakerActionState {
  const fields = error.issues
    .map((issue) => `${String(issue.path.join('.') || 'campo')}: ${issue.message}`)
    .join('; ');
  const fullMessage = fields ? `${message} (${fields})` : message;

  /**
   * O log existe porque a tela mostra o resumo e o processo guarda o detalhe: quem
   * investiga um envio recusado precisa saber QUAL campo chegou inválido, sem
   * reproduzir a sessão do usuário.
   */
  console.error(
    `[speakers] entrada recusada: ${fullMessage} — ${JSON.stringify(
      error.issues.map((issue) => ({ campo: issue.path.join('.'), erro: issue.message })),
    )}`,
  );

  return {
    ok: false,
    code: 'INVALID_INPUT',
    message: fullMessage,
    details: error.issues.map((issue) => `Campo "${issue.path.join('.')}": ${issue.message}`),
  };
}

interface GuardOk {
  ok: true;
  userId: string;
  userEmail: string;
  tenantId: string;
  tenantSlug: string;
  principal: Principal;
}

async function resolveTenant(tenantSlug: string): Promise<{ id: string; slug: string } | null> {
  return adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true },
  });
}

/** Guarda da organização: vínculo ATIVO + permissão no escopo do tenant. */
async function organizationGuard(input: {
  tenantSlug: string;
}): Promise<GuardOk | { ok: false; state: SpeakerActionState }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await resolveTenant(input.tenantSlug);
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

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, PERMISSIONS.SPEAKER_MANAGE, { scope: 'TENANT' })) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: `Permissão negada: ${PERMISSIONS.SPEAKER_MANAGE}.` },
    };
  }

  return {
    ok: true,
    userId: user.id,
    userEmail: user.email,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    principal,
  };
}

/**
 * Guarda do palestrante.
 *
 * `holdsPermission` (e não `can` com um alvo) porque a tela é um painel PESSOAL: o
 * papel pode ter sido concedido por ATIVIDADE, e exigir escopo de tenant recusaria o
 * padrão que a própria plataforma recomenda. Cada escrita, essa sim, chama `can` com
 * o alvo exato — aqui só se decide quem entra na tela.
 */
async function speakerGuard(input: {
  tenantSlug: string;
  permission:
    | typeof PERMISSIONS.SPEAKER_PROFILE_UPDATE_OWN
    | typeof PERMISSIONS.SPEAKER_MATERIAL_MANAGE_OWN;
}): Promise<GuardOk | { ok: false; state: SpeakerActionState }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await resolveTenant(input.tenantSlug);
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
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Seu vínculo com esta instituição não está ativo.',
      },
    };
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!holdsPermission(principal, input.permission)) {
    return {
      ok: false,
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Esta área é do palestrante. Fale com a organização para ser vinculado a uma atividade.',
      },
    };
  }

  return {
    ok: true,
    userId: user.id,
    userEmail: user.email,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    principal,
  };
}

/**
 * Posse de UMA atividade, com o alvo exato.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É SEPARADO DA GUARDA DA TELA
 * ─────────────────────────────────────────────────────────────────────────────
 *  O palestrante pode ter papel em duas atividades e tentar enviar material para uma
 *  terceira — a que ele não ministra. A guarda da tela não vê essa diferença; esta
 *  checagem vê, e é ela que transforma "estou no portal" em "posso escrever AQUI".
 */
async function assertActivityOwnership(input: {
  tenantId: string;
  userId: string;
  activityId: string;
}): Promise<{ ok: true } | { ok: false; state: SpeakerActionState }> {
  const link = await withTenant(input.tenantId, (tx) =>
    tx.activitySpeaker.findFirst({
      where: {
        tenantId: input.tenantId,
        activityId: input.activityId,
        OR: [{ userId: input.userId }, { speakerProfile: { userId: input.userId } }],
      },
      select: { id: true, activity: { select: { eventId: true } } },
    }),
  );

  if (!link) {
    return {
      ok: false,
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Você não consta como ministrante desta atividade.',
      },
    };
  }

  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Organização — cadastro e vínculo
// ───────────────────────────────────────────────────────────────────────────────
const profileSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  speakerProfileId: z.string().uuid().optional(),
  name: z.string().trim().min(3).max(160),
  email: z.string().trim().max(255).optional(),
  institution: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  roleTitle: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(4000).optional(),
  /**
   * A foto vem da esteira de upload como URL já confirmada (FASE 46). Ausente
   * PRESERVA a que existe: o serviço decide isso — e o campo vazio APAGA, que é como
   * a organização tira uma foto publicada.
   */
  avatarUrl: z.string().trim().max(1024).optional(),
  /** Caixa de seleção: `'on'` quando marcada. A exigência é do serviço. */
  photoAuthorization: z.string().optional(),
  displayOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isPublic: z.string().optional(),
});

function socialPayload(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const network of SOCIAL_NETWORKS) {
    const value = formData.get(`social_${network}`);
    if (typeof value === 'string' && value.trim().length > 0) {
      result[network] = value.trim();
    }
  }
  return result;
}

export async function saveSpeakerProfileAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = profileSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    speakerProfileId: (formData.get('speakerProfileId') as string) || undefined,
    name: formData.get('name'),
    email: (formData.get('email') as string) || undefined,
    institution: (formData.get('institution') as string) || undefined,
    company: (formData.get('company') as string) || undefined,
    roleTitle: (formData.get('roleTitle') as string) || undefined,
    bio: (formData.get('bio') as string) || undefined,
    avatarUrl: (formData.get('avatarUrl') as string) ?? undefined,
    photoAuthorization: (formData.get('photoAuthorization') as string) || undefined,
    displayOrder: (formData.get('displayOrder') as string) || undefined,
    isPublic: (formData.get('isPublic') as string) || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos para o palestrante.',
    };
  }

  const auth = await organizationGuard({ tenantSlug: parsed.data.tenantSlug });
  if (!auth.ok) return auth.state;

  const result = await saveSpeakerProfile({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    speakerProfileId: parsed.data.speakerProfileId,
    name: parsed.data.name,
    email: parsed.data.email ?? null,
    institution: parsed.data.institution ?? null,
    company: parsed.data.company ?? null,
    roleTitle: parsed.data.roleTitle ?? null,
    bio: parsed.data.bio ?? null,
    avatarUrl: parsed.data.avatarUrl,
    photoAuthorization: parsed.data.photoAuthorization === 'on',
    socialLinks: socialPayload(formData),
    displayOrder: parsed.data.displayOrder,
    isPublic: parsed.data.isPublic === undefined ? undefined : parsed.data.isPublic === 'on',
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  revalidateSpeakerAdmin(parsed.data.tenantSlug);

  return {
    ok: true,
    message: result.created
      ? result.inviteToken
        ? 'Palestrante cadastrado. Copie o código de convite abaixo e entregue a ele.'
        : 'Palestrante cadastrado. Cadastre um e-mail para gerar o convite de acesso.'
      : 'Cadastro do palestrante atualizado.',
    data: {
      speakerProfileId: result.speakerProfileId,
      inviteToken: result.inviteToken,
      inviteExpiresAt: result.inviteExpiresAt,
    },
  };
}

const linkSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  activityId: z.string().uuid(),
  speakerProfileId: z.string().uuid(),
  roleTitle: z.string().trim().max(120).optional(),
  isKeynote: z.string().optional(),
  workloadMinutes: z.coerce.number().int().min(0).max(20000).optional(),
});

export async function linkSpeakerAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = linkSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    activityId: formData.get('activityId'),
    speakerProfileId: formData.get('speakerProfileId'),
    roleTitle: (formData.get('roleTitle') as string) || undefined,
    isKeynote: (formData.get('isKeynote') as string) || undefined,
    workloadMinutes: (formData.get('workloadMinutes') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Escolha a atividade e o palestrante.' };
  }

  const auth = await organizationGuard({ tenantSlug: parsed.data.tenantSlug });
  if (!auth.ok) return auth.state;

  const result = await linkSpeakerToActivity({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    activityId: parsed.data.activityId,
    speakerProfileId: parsed.data.speakerProfileId,
    roleTitle: parsed.data.roleTitle ?? null,
    isKeynote: parsed.data.isKeynote === 'on',
    workloadMinutes: parsed.data.workloadMinutes ?? null,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateSpeakerAdmin(parsed.data.tenantSlug);

  return {
    ok: true,
    message: result.created
      ? 'Palestrante vinculado à atividade. A vitrine pública já mostra o nome dele.'
      : 'Vínculo atualizado.',
    data: { linkId: result.linkId },
  };
}

export async function unlinkSpeakerAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      linkId: z.string().uuid(),
    })
    .safeParse({ tenantSlug: formData.get('tenantSlug'), linkId: formData.get('linkId') });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Vínculo inválido.' };
  }

  const auth = await organizationGuard({ tenantSlug: parsed.data.tenantSlug });
  if (!auth.ok) return auth.state;

  const result = await unlinkSpeakerFromActivity({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    linkId: parsed.data.linkId,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidateSpeakerAdmin(parsed.data.tenantSlug);

  return {
    ok: true,
    message: 'Vínculo removido. Os materiais que ele havia publicado saíram da página pública.',
  };
}

export async function regenerateSpeakerInviteAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      speakerProfileId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      speakerProfileId: formData.get('speakerProfileId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Palestrante inválido.' };
  }

  const auth = await organizationGuard({ tenantSlug: parsed.data.tenantSlug });
  if (!auth.ok) return auth.state;

  const result = await regenerateSpeakerInvite({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    speakerProfileId: parsed.data.speakerProfileId,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  return {
    ok: true,
    message: 'Convite novo gerado. O código anterior deixou de funcionar.',
    data: { inviteToken: result.inviteToken, inviteExpiresAt: result.inviteExpiresAt },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Portal — perfil próprio
// ───────────────────────────────────────────────────────────────────────────────
export async function updateMySpeakerProfileAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const avatarRaw = formData.get('avatarUrl');

  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      speakerProfileId: z.string().uuid(),
      name: z.string().trim().min(3).max(160),
      email: z.string().trim().max(255).optional(),
      institution: z.string().trim().max(200).optional(),
      company: z.string().trim().max(200).optional(),
      roleTitle: z.string().trim().max(120).optional(),
      bio: z.string().trim().max(4000).optional(),
      avatarUrl: z.string().trim().max(1024).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      speakerProfileId: formData.get('speakerProfileId'),
      name: formData.get('name'),
      email: (formData.get('email') as string) || undefined,
      institution: (formData.get('institution') as string) || undefined,
      company: (formData.get('company') as string) || undefined,
      roleTitle: (formData.get('roleTitle') as string) || undefined,
      bio: (formData.get('bio') as string) || undefined,
      /**
       * A foto vai como veio — inclusive VAZIA (FASE 46).
       *
       * `|| undefined` transformaria "remover foto" em "não mexer": o botão Remover
       * limpa o campo de propósito, e é o serviço que decide que vazio APAGA e ausente
       * PRESERVA. Sem isso, o aviso ao palestrante ("você pode removê-la") mentiria.
       */
      avatarUrl: typeof avatarRaw === 'string' ? avatarRaw : undefined,
    });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos.',
    };
  }

  const auth = await speakerGuard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SPEAKER_PROFILE_UPDATE_OWN,
  });
  if (!auth.ok) return auth.state;

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A POSSE É A BARREIRA — E ELA NÃO DEPENDE DO ESCOPO DA CONCESSÃO (FASE 25)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Aqui NÃO se chama `can(..., { scope: 'TENANT' })`. O papel de palestrante é
   *  concedido por ATIVIDADE (é o padrão que o aceite do convite cria, e o que a fase
   *  recomenda), e exigir escopo de tenant recusaria justamente o caso normal: o
   *  palestrante dono do perfil recebia "permissão negada para editar o perfil" na
   *  própria tela. Descoberto pelo E2E da fase.
   *
   *  O que importa para uma permissão `:own` numa tela PESSOAL é: (a) a pessoa tem a
   *  permissão em algum escopo vigente — `speakerGuard` já verificou; (b) o perfil é
   *  DELA — e quem responde isso é o banco, dentro do serviço (`profile.userId`),
   *  não o formulário.
   */
  const result = await updateMySpeakerProfile({
    tenantId: auth.tenantId,
    userId: auth.userId,
    speakerProfileId: parsed.data.speakerProfileId,
    name: parsed.data.name,
    email: parsed.data.email ?? null,
    institution: parsed.data.institution ?? null,
    company: parsed.data.company ?? null,
    roleTitle: parsed.data.roleTitle ?? null,
    bio: parsed.data.bio ?? null,
    avatarUrl: parsed.data.avatarUrl ?? null,
    socialLinks: socialPayload(formData),
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message, details: result.details };

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/palestrante'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/eventos'), 'layout');

  return { ok: true, message: 'Perfil atualizado. A vitrine pública já mostra os dados novos.' };
}

export async function updateSpeakerNotesAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      linkId: z.string().uuid(),
      activityId: z.string().uuid(),
      syllabus: z.string().max(6000).optional(),
      requirements: z.string().max(6000).optional(),
      bibliography: z.string().max(6000).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      linkId: formData.get('linkId'),
      activityId: formData.get('activityId'),
      syllabus: (formData.get('syllabus') as string) || undefined,
      requirements: (formData.get('requirements') as string) || undefined,
      bibliography: (formData.get('bibliography') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para a ementa.' };
  }

  const auth = await speakerGuard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SPEAKER_MATERIAL_MANAGE_OWN,
  });
  if (!auth.ok) return auth.state;

  const ownership = await assertActivityOwnership({
    tenantId: auth.tenantId,
    userId: auth.userId,
    activityId: parsed.data.activityId,
  });
  if (!ownership.ok) return ownership.state;

  const result = await updateSpeakerNotes({
    tenantId: auth.tenantId,
    userId: auth.userId,
    linkId: parsed.data.linkId,
    syllabus: parsed.data.syllabus ?? null,
    requirements: parsed.data.requirements ?? null,
    bibliography: parsed.data.bibliography ?? null,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/palestrante'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/eventos'), 'layout');

  return { ok: true, message: 'Conteúdo da atividade salvo na página pública.' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Portal — convite
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Aceita o convite.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE AQUI NÃO SE EXIGE VÍNCULO ATIVO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Quem reivindica um perfil pode ser alguém que acabou de criar a conta e ainda NÃO
 *  tem vínculo com a instituição — é exatamente o caso do convidado externo. Exigir
 *  vínculo ativo antes de aceitar criaria um impasse: sem vínculo não se aceita o
 *  convite, e sem aceitar o convite não se ganha o vínculo.
 *
 *  A prova, aqui, é o TOKEN (ou o e-mail cadastrado pela organização), conferida no
 *  serviço contra o hash gravado. O vínculo é criado DEPOIS, como consequência.
 */
export async function claimSpeakerInviteAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      speakerProfileId: z.string().uuid().optional(),
      token: z.string().trim().max(64).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      speakerProfileId: (formData.get('speakerProfileId') as string) || undefined,
      token: (formData.get('token') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Convite inválido.' };
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      code: 'NOT_AUTHENTICATED',
      message: 'Entre na sua conta para aceitar o convite de palestrante.',
    };
  }

  const tenant = await resolveTenant(parsed.data.tenantSlug);
  if (!tenant) {
    return { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' };
  }

  const result = await claimSpeakerProfile({
    tenantId: tenant.id,
    userId: user.id,
    userEmail: user.email,
    speakerProfileId: parsed.data.speakerProfileId,
    token: parsed.data.token ?? null,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  /**
   * O vínculo com a instituição nasce aqui, quando ainda não existe.
   *
   * `PARTICIPANT` e não `MEMBER`: o convidado de um minicurso não é equipe, e
   * contá-lo como membro consumiria a quota do plano — um evento com 20 palestrantes
   * esgotaria o plano gratuito sozinho. O acesso ao portal vem do PAPEL
   * (`SPEAKER`, concedido por atividade), não do tipo de vínculo.
   */
  try {
    await withTenant(tenant.id, async (tx) => {
      const existing = await tx.userTenantProfile.findFirst({
        where: { tenantId: tenant.id, userId: user.id },
        select: { id: true, status: true },
      });

      if (existing) {
        if (existing.status !== 'ACTIVE') {
          await tx.userTenantProfile.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', deletedAt: null, joinedAt: new Date() },
          });
        }
        return;
      }

      await tx.userTenantProfile.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          kind: 'PARTICIPANT',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
    });
  } catch (error) {
    // Conflito de corrida (dois cliques no mesmo convite) não invalida o aceite: o
    // perfil já foi vinculado na transação anterior.
    if (!isUniqueViolation(error)) {
      console.error('[speakers] falha ao criar vínculo no aceite do convite', error);
    }
  }

  /**
   * Revalida o SEGMENTO inteiro da instituição, e não só a página do portal.
   *
   * O aceite muda o MENU: o item deixa de ser "Convite de palestrante" e passa a ser
   * "Portal do palestrante" (o papel nasceu agora). O menu vive no layout — revalidar
   * apenas `/palestrante` deixaria a barra lateral com o rótulo antigo até um
   * carregamento completo da página (armadilha 40, na versão do shell).
   */
  revalidatePath(tenantPath(parsed.data.tenantSlug), 'layout');

  return {
    ok: true,
    message: `Convite aceito! Você agora responde por ${result.attachedActivities} atividade(s) como palestrante.`,
    data: { speakerProfileId: result.speakerProfileId, activities: result.attachedActivities },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Portal — foto do palestrante
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Envio da FOTO pela mesma esteira da capa do evento (FASE 25).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO HÁ UPLOAD PRÓPRIO PARA O AVATAR
 * ─────────────────────────────────────────────────────────────────────────────
 *  A esteira de imagem já resolve as três partes difíceis: URL pré-assinada com
 *  tamanho travado, conferência da ASSINATURA REAL do arquivo (o que impede servir
 *  `text/html` como foto) e registro na biblioteca de mídia da instituição, que passa
 *  a saber onde a foto é usada antes de permitir excluí-la.
 *
 *  Um caminho próprio para o avatar divergiria exatamente na verificação de
 *  assinatura — a parte que é segurança, não conveniência.
 */
export async function requestSpeakerAvatarUploadAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().trim().uuid().optional().or(z.literal('')),
      speakerProfileId: z.string().uuid(),
      fileName: z.string().trim().min(1).max(300),
      mimeType: z.string().trim().min(3).max(160),
      sizeBytes: z.coerce.number().int().positive(),
      magicBytes: z.string().optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId') || undefined,
      speakerProfileId: formData.get('speakerProfileId'),
      fileName: formData.get('fileName'),
      mimeType: formData.get('mimeType'),
      sizeBytes: formData.get('sizeBytes'),
      magicBytes: (formData.get('magicBytes') as string) || undefined,
    });

  if (!parsed.success) {
    return invalidInput('Não foi possível ler a imagem escolhida.', parsed.error);
  }

  const auth = await speakerGuard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SPEAKER_PROFILE_UPDATE_OWN,
  });
  if (!auth.ok) return auth.state;

  const owns = await withTenant(auth.tenantId, (tx) =>
    tx.speakerProfile.findFirst({
      where: { tenantId: auth.tenantId, id: parsed.data.speakerProfileId, userId: auth.userId, deletedAt: null },
      select: { id: true },
    }),
  );

  if (!owns) {
    return { ok: false, code: 'FORBIDDEN', message: 'Este perfil de palestrante pertence a outra conta.' };
  }

  let eventId = parsed.data.eventId;
  if (!eventId) {
    const fallback = await withTenant(auth.tenantId, (tx) =>
      tx.event.findFirst({
        where: { tenantId: auth.tenantId, deletedAt: null },
        orderBy: { startsAt: 'desc' },
        select: { id: true },
      }),
    );
    if (!fallback) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'A instituição ainda não possui nenhum evento cadastrado para associar o arquivo.',
      };
    }
    eventId = fallback.id;
  }

  const result = await requestAssetUpload({
    tenantId: auth.tenantId,
    eventId,
    target: 'SPEAKER_AVATAR',
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    magicBytes: parseMagicBytes(parsed.data.magicBytes),
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message, details: result.details };

  return {
    ok: true,
    message: 'Envio preparado.',
    data: {
      uploadUrl: result.uploadUrl,
      objectKey: result.objectKey,
      bucket: result.bucket,
      requiredHeaders: result.requiredHeaders,
      mimeType: result.mimeType,
      maxBytes: result.maxBytes,
      eventId,
    },
  };
}

export async function confirmSpeakerAvatarUploadAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().trim().uuid().optional().or(z.literal('')),
      speakerProfileId: z.string().uuid(),
      objectKey: z.string().trim().min(1).max(1024),
      bucket: z.string().trim().min(1).max(120),
      fileName: z.string().trim().min(1).max(300),
      mimeType: z.string().trim().min(3).max(160),
      sizeBytes: z.coerce.number().int().positive(),
      checksum: z.string().trim().length(64),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId') || undefined,
      speakerProfileId: formData.get('speakerProfileId'),
      objectKey: formData.get('objectKey'),
      bucket: formData.get('bucket'),
      fileName: formData.get('fileName'),
      mimeType: formData.get('mimeType'),
      sizeBytes: formData.get('sizeBytes'),
      checksum: formData.get('checksum'),
    });

  if (!parsed.success) {
    return invalidInput('Dados inválidos para confirmar a imagem.', parsed.error);
  }

  const auth = await speakerGuard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SPEAKER_PROFILE_UPDATE_OWN,
  });
  if (!auth.ok) return auth.state;

  const owns = await withTenant(auth.tenantId, (tx) =>
    tx.speakerProfile.findFirst({
      where: { tenantId: auth.tenantId, id: parsed.data.speakerProfileId, userId: auth.userId, deletedAt: null },
      select: { id: true },
    }),
  );

  if (!owns) {
    return { ok: false, code: 'FORBIDDEN', message: 'Este perfil de palestrante pertence a outra conta.' };
  }

  let eventId = parsed.data.eventId;
  if (!eventId) {
    const match = /^tenants\/[^/]+\/eventos\/([^/]+)\/assets\//.exec(parsed.data.objectKey);
    if (match?.[1]) {
      eventId = match[1];
    }
  }

  if (!eventId) {
    const fallback = await withTenant(auth.tenantId, (tx) =>
      tx.event.findFirst({
        where: { tenantId: auth.tenantId, deletedAt: null },
        orderBy: { startsAt: 'desc' },
        select: { id: true },
      }),
    );
    if (!fallback) {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
    }
    eventId = fallback.id;
  }

  const result = await confirmAssetUpload({
    tenantId: auth.tenantId,
    eventId,
    actorId: auth.userId,
    target: 'SPEAKER_AVATAR',
    objectKey: parsed.data.objectKey,
    bucket: parsed.data.bucket,
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    checksum: parsed.data.checksum,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message, details: result.details };

  /**
   * A URL só entra no PERFIL quando o palestrante salvar o formulário — a esteira
   * devolve o endereço e o campo escondido o carrega. Gravar aqui deixaria a troca de
   * foto acontecendo antes de a pessoa confirmar o resto da edição.
   */
  return {
    ok: true,
    message: 'Imagem validada. Salve o perfil para publicá-la.',
    data: { url: result.url },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Portal — materiais
// ───────────────────────────────────────────────────────────────────────────────
export async function requestSpeakerMaterialUploadAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      activityId: z.string().uuid(),
      speakerProfileId: z.string().uuid(),
      fileName: z.string().trim().min(1).max(300),
      mimeType: z.string().trim().min(3).max(160),
      sizeBytes: z.coerce.number().int().positive(),
      magicBytes: z.string().optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      activityId: formData.get('activityId'),
      speakerProfileId: formData.get('speakerProfileId'),
      fileName: formData.get('fileName'),
      mimeType: formData.get('mimeType'),
      sizeBytes: formData.get('sizeBytes'),
      magicBytes: (formData.get('magicBytes') as string) || undefined,
    });

  if (!parsed.success) {
    return invalidInput('Não foi possível ler o arquivo escolhido.', parsed.error);
  }

  const auth = await speakerGuard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SPEAKER_MATERIAL_MANAGE_OWN,
  });
  if (!auth.ok) return auth.state;

  /**
   * O perfil é conferido contra o BANCO: o formulário diz qual é, e a resposta vem de
   * `speaker_profiles.userId`. Sem isso, o campo escondido seria a autorização.
   */
  const owns = await withTenant(auth.tenantId, (tx) =>
    tx.speakerProfile.findFirst({
      where: { tenantId: auth.tenantId, id: parsed.data.speakerProfileId, userId: auth.userId, deletedAt: null },
      select: { id: true },
    }),
  );

  if (!owns) {
    return { ok: false, code: 'FORBIDDEN', message: 'Este perfil de palestrante pertence a outra conta.' };
  }

  const ownership = await assertActivityOwnership({
    tenantId: auth.tenantId,
    userId: auth.userId,
    activityId: parsed.data.activityId,
  });
  if (!ownership.ok) return ownership.state;

  const result = await requestMaterialUpload({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    activityId: parsed.data.activityId,
    speakerProfileId: parsed.data.speakerProfileId,
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    magicBytes: parseMagicBytes(parsed.data.magicBytes),
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message, details: result.details };

  return {
    ok: true,
    message: 'Envio preparado.',
    data: {
      uploadUrl: result.uploadUrl,
      objectKey: result.objectKey,
      bucket: result.bucket,
      requiredHeaders: result.requiredHeaders,
      mimeType: result.mimeType,
      maxBytes: result.maxBytes,
    },
  };
}

export async function confirmSpeakerMaterialUploadAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      activityId: z.string().uuid(),
      speakerProfileId: z.string().uuid(),
      title: z.string().trim().min(3).max(200),
      description: z.string().trim().max(600).optional(),
      kind: z.enum(MATERIAL_KINDS as unknown as [string, ...string[]]),
      visibility: z.enum(MATERIAL_VISIBILITIES as unknown as [string, ...string[]]),
      objectKey: z.string().trim().min(1).max(1024),
      bucket: z.string().trim().min(1).max(120),
      fileName: z.string().trim().min(1).max(300),
      mimeType: z.string().trim().min(3).max(160),
      sizeBytes: z.coerce.number().int().positive(),
      checksum: z.string().trim().length(64),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      activityId: formData.get('activityId'),
      speakerProfileId: formData.get('speakerProfileId'),
      title: formData.get('title'),
      description: (formData.get('description') as string) || undefined,
      kind: formData.get('kind'),
      visibility: formData.get('visibility'),
      objectKey: formData.get('objectKey'),
      bucket: formData.get('bucket'),
      fileName: formData.get('fileName'),
      mimeType: formData.get('mimeType'),
      sizeBytes: formData.get('sizeBytes'),
      checksum: formData.get('checksum'),
    });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos para o material.',
    };
  }

  const auth = await speakerGuard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SPEAKER_MATERIAL_MANAGE_OWN,
  });
  if (!auth.ok) return auth.state;

  const owns = await withTenant(auth.tenantId, (tx) =>
    tx.speakerProfile.findFirst({
      where: { tenantId: auth.tenantId, id: parsed.data.speakerProfileId, userId: auth.userId, deletedAt: null },
      select: { id: true },
    }),
  );

  if (!owns) {
    return { ok: false, code: 'FORBIDDEN', message: 'Este perfil de palestrante pertence a outra conta.' };
  }

  const result = await confirmMaterialUpload({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    eventId: parsed.data.eventId,
    activityId: parsed.data.activityId,
    speakerProfileId: parsed.data.speakerProfileId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    kind: parsed.data.kind,
    visibility: parsed.data.visibility,
    objectKey: parsed.data.objectKey,
    bucket: parsed.data.bucket,
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    checksum: parsed.data.checksum,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message, details: result.details };

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/palestrante'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/eventos'), 'layout');

  return {
    ok: true,
    message: 'Material publicado. A página da atividade já o exibe conforme a visibilidade escolhida.',
    data: { materialId: result.materialId },
  };
}

export async function saveSpeakerMaterialLinkAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      activityId: z.string().uuid(),
      speakerProfileId: z.string().uuid(),
      title: z.string().trim().min(3).max(200),
      description: z.string().trim().max(600).optional(),
      kind: z.enum(MATERIAL_KINDS as unknown as [string, ...string[]]),
      visibility: z.enum(MATERIAL_VISIBILITIES as unknown as [string, ...string[]]),
      url: z.string().trim().min(3).max(1024),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      activityId: formData.get('activityId'),
      speakerProfileId: formData.get('speakerProfileId'),
      title: formData.get('title'),
      description: (formData.get('description') as string) || undefined,
      kind: formData.get('kind'),
      visibility: formData.get('visibility'),
      url: formData.get('url'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para o link.' };
  }

  const auth = await speakerGuard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SPEAKER_MATERIAL_MANAGE_OWN,
  });
  if (!auth.ok) return auth.state;

  const owns = await withTenant(auth.tenantId, (tx) =>
    tx.speakerProfile.findFirst({
      where: { tenantId: auth.tenantId, id: parsed.data.speakerProfileId, userId: auth.userId, deletedAt: null },
      select: { id: true },
    }),
  );

  if (!owns) {
    return { ok: false, code: 'FORBIDDEN', message: 'Este perfil de palestrante pertence a outra conta.' };
  }

  const result = await createMaterialLink({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    activityId: parsed.data.activityId,
    speakerProfileId: parsed.data.speakerProfileId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    kind: parsed.data.kind,
    visibility: parsed.data.visibility,
    url: parsed.data.url,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/palestrante'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/eventos'), 'layout');

  return { ok: true, message: 'Link publicado como material de apoio.' };
}

export async function updateSpeakerMaterialAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      materialId: z.string().uuid(),
      title: z.string().trim().min(3).max(200),
      description: z.string().trim().max(600).optional(),
      kind: z.enum(MATERIAL_KINDS as unknown as [string, ...string[]]),
      visibility: z.enum(MATERIAL_VISIBILITIES as unknown as [string, ...string[]]),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      materialId: formData.get('materialId'),
      title: formData.get('title'),
      description: (formData.get('description') as string) || undefined,
      kind: formData.get('kind'),
      visibility: formData.get('visibility'),
    });

  if (!parsed.success) {
    return invalidInput('Dados inválidos para o material.', parsed.error);
  }

  const auth = await speakerGuard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SPEAKER_MATERIAL_MANAGE_OWN,
  });
  if (!auth.ok) return auth.state;

  const ownership = await loadMaterialOwnership({
    tenantId: auth.tenantId,
    materialId: parsed.data.materialId,
  });

  if (!ownership) {
    return { ok: false, code: 'NOT_FOUND', message: 'Material não encontrado.' };
  }

  if (ownership.ownerUserId !== auth.userId) {
    return { ok: false, code: 'FORBIDDEN', message: 'Este material é de outro palestrante.' };
  }

  const result = await updateMaterial({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    materialId: parsed.data.materialId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    kind: parsed.data.kind,
    visibility: parsed.data.visibility,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/palestrante'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/eventos'), 'layout');

  return { ok: true, message: 'Material atualizado.' };
}

export async function deleteSpeakerMaterialAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      materialId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      materialId: formData.get('materialId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Material inválido.' };
  }

  const auth = await speakerGuard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SPEAKER_MATERIAL_MANAGE_OWN,
  });
  if (!auth.ok) return auth.state;

  const ownership = await loadMaterialOwnership({
    tenantId: auth.tenantId,
    materialId: parsed.data.materialId,
  });

  if (!ownership) {
    return { ok: false, code: 'NOT_FOUND', message: 'Material não encontrado.' };
  }

  /**
   * A equipe também remove: é quem dá suporte quando o palestrante publica o arquivo
   * errado e não consegue mais entrar. O que não pode é remover o de OUTRO palestrante
   * sem ser da organização.
   */
  const isOrganizer = can(auth.principal, PERMISSIONS.SPEAKER_MANAGE, { scope: 'TENANT' });

  if (ownership.ownerUserId !== auth.userId && !isOrganizer) {
    return { ok: false, code: 'FORBIDDEN', message: 'Este material é de outro palestrante.' };
  }

  const result = await deleteMaterial({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    materialId: parsed.data.materialId,
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/palestrante'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/eventos'), 'layout');

  return { ok: true, message: 'Material removido da página.' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Portal — certificado
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Emite o certificado de PALESTRANTE do próprio usuário.
 *
 * A elegibilidade (evento encerrado + credenciamento registrado + carga apurada) é do
 * domínio e roda dentro de `issueCertificate`. Aqui não há como pedir certificado de
 * outra pessoa: o `userId` é o da sessão, e não existe campo para escolher.
 */
export async function requestSpeakerCertificateAction(
  _prev: SpeakerActionState | null,
  formData: FormData,
): Promise<SpeakerActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Evento inválido.' };
  }

  const auth = await speakerGuard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SPEAKER_PROFILE_UPDATE_OWN,
  });
  if (!auth.ok) return auth.state;

  const result = await issueCertificate({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    userId: auth.userId,
    kind: 'SPEAKER',
    actorId: auth.userId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/palestrante'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/certificados'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: result.generated
      ? 'Certificado de palestrante emitido e pronto para download.'
      : result.existing
        ? 'Certificado já emitido — veja abaixo.'
        : 'Certificado em processamento. Recarregue em alguns instantes.',
    data: { certificateId: result.certificateId, validationCode: result.validationCode },
  };
}

/** `magicBytes` chegam como lista separada por vírgula (o cliente lê os 16 primeiros). */
function parseMagicBytes(value: string | undefined): number[] | null {
  if (!value) return null;
  const parsed = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);

  return parsed.length > 0 ? parsed : null;
}
