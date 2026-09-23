'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Governança da plataforma
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TODA AÇÃO COMEÇA PELA MESMA GUARDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `requirePlatformPermission()` — que responde 404, e não 403 (ver `guard.ts`).
 *  Não há ação de plataforma que faça qualquer coisa antes disso: a única
 *  diferença entre elas é qual operação de negócio vem depois.
 *
 *  A guarda não é redundante com a do painel. Uma aba aberta continua enviando
 *  formulários depois que a concessão foi revogada: sem a checagem aqui, a
 *  revogação só valeria para quem recarregasse a página.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A VITRINE É INVALIDADA AQUI, NÃO NO SERVIÇO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `revalidateTag('public-tenants')` vive na camada de ação porque é um efeito do
 *  Next, não uma regra de negócio: os serviços são chamados por testes e por
 *  scripts, contextos em que não existe cache de requisição nenhum.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';

import { requirePlatformPermission } from '@/lib/platform/guard';
import { PUBLIC_TENANTS_TAG } from '@/lib/platform/directory-service';
import { recordAudit } from '@/lib/admin/audit';
import { enqueueJobRun } from '@/lib/communication/email-queue';
import { isJobKey, jobDefinition } from '@/domain/platform/job-catalog';
import {
  addTenantMember,
  grantSuperAdmin,
  provisionTenant,
  revokeSuperAdmin,
  setTenantStatus,
  updateTenantPlan,
  updateTenantProfile,
  type TenantMemberRole,
} from '@/lib/platform/tenant-service';

export interface PlatformActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

/** Rota do painel — invalidada depois de qualquer mudança de estado. */
const PANEL_PATH = '/superadmin/tenants';

function failure(
  code: string,
  message: string,
  details?: readonly string[],
): PlatformActionState {
  return { ok: false, code, message, details };
}

/**
 * Toda mudança de instituição muda a vitrine e o painel.
 *
 * `revalidatePath` para as telas renderizadas no servidor e `revalidateTag` para a
 * contagem cacheada da vitrine. As duas coisas são necessárias: a primeira atualiza
 * as páginas do painel, a segunda a entrada de cache que a vitrine pública lê.
 */
function revalidatePlatform(slug?: string): void {
  revalidateTag(PUBLIC_TENANTS_TAG, 'max');
  revalidatePath('/organizacoes');
  revalidatePath(PANEL_PATH);
  revalidatePath('/superadmin/metricas');

  if (slug) {
    revalidatePath(`/t/${slug}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Provisionamento
// ───────────────────────────────────────────────────────────────────────────────
const provisionSchema = z.object({
  name: z.string().trim().min(3).max(160),
  slug: z.string().trim().min(1).max(63),
  plan: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
  ownerEmail: z.string().trim().min(3).max(255),
  customDomain: z.string().trim().max(253).optional(),
  description: z.string().trim().max(600).optional(),
  maxEvents: z.coerce.number().int().min(0).max(100_000).optional(),
  maxMembers: z.coerce.number().int().min(0).max(1_000_000).optional(),
  isPublic: z.coerce.boolean().optional(),
});

/**
 * Provisiona a instituição e designa o proprietário.
 *
 * Devolve os dados criados para que a tela possa mostrar o endereço novo — quem
 * acabou de criar uma instituição precisa do link, não de uma mensagem genérica.
 */
export async function provisionTenantAction(
  _prev: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
  const operator = await requirePlatformPermission();

  const parsed = provisionSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
    plan: formData.get('plan'),
    ownerEmail: formData.get('ownerEmail'),
    customDomain: (formData.get('customDomain') as string) || undefined,
    description: (formData.get('description') as string) || undefined,
    // Campo vazio significa "herdar a quota do plano", e não "zero":
    // `undefined` deixa `validateProvisioning` aplicar o padrão do plano.
    maxEvents: (formData.get('maxEvents') as string) || undefined,
    maxMembers: (formData.get('maxMembers') as string) || undefined,
    isPublic: formData.get('isPublic') === 'on',
  });

  if (!parsed.success) {
    return failure(
      'INVALID_INPUT',
      'Revise os dados da instituição.',
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  const result = await provisionTenant(operator.userId, {
    name: parsed.data.name,
    slug: parsed.data.slug,
    plan: parsed.data.plan,
    ownerEmail: parsed.data.ownerEmail,
    customDomain: parsed.data.customDomain ?? null,
    description: parsed.data.description ?? null,
    maxEvents: parsed.data.maxEvents ?? null,
    maxMembers: parsed.data.maxMembers ?? null,
    isPublic: parsed.data.isPublic,
  });

  if (!result.ok) {
    return failure(result.code, result.message, result.details);
  }

  revalidatePlatform(result.slug);

  return {
    ok: true,
    message: `Instituição "${result.name}" criada. ${result.ownerEmail} é o proprietário.`,
    data: { tenantId: result.tenantId, slug: result.slug, ownerEmail: result.ownerEmail },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ciclo de vida
// ───────────────────────────────────────────────────────────────────────────────
const statusSchema = z.object({
  tenantId: z.string().uuid(),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().max(400).optional(),
});

export async function setTenantStatusAction(
  _prev: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
  const operator = await requirePlatformPermission();

  const parsed = statusSchema.safeParse({
    tenantId: formData.get('tenantId'),
    status: formData.get('status'),
    reason: (formData.get('reason') as string) || undefined,
  });

  if (!parsed.success) {
    return failure('INVALID_INPUT', 'Requisição inválida.');
  }

  const result = await setTenantStatus(operator.userId, {
    tenantId: parsed.data.tenantId,
    status: parsed.data.status,
    reason: parsed.data.reason,
  });

  if (!result.ok) {
    return failure(result.code, result.message, result.details);
  }

  revalidatePlatform(result.slug);

  return {
    ok: true,
    message:
      result.status === 'SUSPENDED'
        ? `Instituição suspensa. O acesso público e o painel dela estão bloqueados desde agora.`
        : `Instituição reativada e novamente visível na vitrine.`,
    data: { tenantId: result.tenantId, slug: result.slug, status: result.status },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Perfil público
// ───────────────────────────────────────────────────────────────────────────────
const profileSchema = z.object({
  tenantId: z.string().uuid(),
  description: z.string().trim().max(600).optional(),
  logoUrl: z.string().trim().max(1024).optional(),
  websiteUrl: z.string().trim().max(1024).optional(),
  isPublic: z.coerce.boolean().optional(),
});

export async function updateTenantProfileAction(
  _prev: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
  const operator = await requirePlatformPermission();

  const parsed = profileSchema.safeParse({
    tenantId: formData.get('tenantId'),
    description: (formData.get('description') as string) || undefined,
    logoUrl: (formData.get('logoUrl') as string) || undefined,
    websiteUrl: (formData.get('websiteUrl') as string) || undefined,
    isPublic: formData.get('isPublic') === 'on',
  });

  if (!parsed.success) {
    return failure(
      'INVALID_INPUT',
      'Revise os dados públicos.',
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  const result = await updateTenantProfile(operator.userId, {
    tenantId: parsed.data.tenantId,
    description: parsed.data.description ?? null,
    logoUrl: parsed.data.logoUrl ?? null,
    websiteUrl: parsed.data.websiteUrl ?? null,
    isPublic: parsed.data.isPublic,
  });

  if (!result.ok) {
    return failure(result.code, result.message, result.details);
  }

  revalidatePlatform(result.slug);

  return { ok: true, message: 'Perfil público atualizado.', data: { slug: result.slug } };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Plano e quotas (FASE 14 — item C3)
// ───────────────────────────────────────────────────────────────────────────────
const planSchema = z.object({
  tenantId: z.string().uuid(),
  plan: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
  /**
   * Vazio é `undefined` — "herdar do plano" —, e não zero.
   *
   * É a mesma distinção do provisionamento: `0` é um valor legítimo ("nenhum
   * evento"), `null` é ilimitado, e vazio significa "não mexi neste campo". O
   * serviço resolve isso com `useDefaults`.
   */
  maxEvents: z.coerce.number().int().min(0).max(100_000).optional(),
  maxMembers: z.coerce.number().int().min(1).max(1_000_000).optional(),
  useDefaults: z.coerce.boolean().optional(),
});

export async function updateTenantPlanAction(
  _prev: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
  const operator = await requirePlatformPermission();

  const parsed = planSchema.safeParse({
    tenantId: formData.get('tenantId'),
    plan: formData.get('plan'),
    maxEvents: (formData.get('maxEvents') as string) || undefined,
    maxMembers: (formData.get('maxMembers') as string) || undefined,
    useDefaults: formData.get('useDefaults') === 'on',
  });

  if (!parsed.success) {
    return failure(
      'INVALID_INPUT',
      'Revise o plano e as quotas.',
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  const result = await updateTenantPlan(operator.userId, {
    tenantId: parsed.data.tenantId,
    plan: parsed.data.plan,
    maxEvents: parsed.data.maxEvents ?? null,
    maxMembers: parsed.data.maxMembers ?? null,
    useDefaults: parsed.data.useDefaults,
  });

  if (!result.ok) {
    return failure(result.code, result.message, result.details);
  }

  revalidatePlatform(result.slug);
  // O detalhe da instituição é uma rota própria: sem isto, a tela que enviou o
  // formulário continuaria mostrando o plano anterior até um recarregamento.
  revalidatePath(`/superadmin/tenants/${parsed.data.tenantId}`);

  /**
   * Os avisos vão em `details` de propósito: a operação deu certo (o plano mudou) e
   * o que precisa chegar ao operador é o EFEITO — "esta instituição já tem mais
   * eventos do que a nova quota permite". Devolver isso como erro faria a pessoa
   * tentar de novo; devolver em silêncio faria ela bloquear uma instituição sem
   * saber.
   */
  return {
    ok: true,
    message: `Plano atualizado para ${result.plan}: ${result.quotas.maxEvents ?? 'ilimitados'} evento(s) e ${result.quotas.maxMembers ?? 'ilimitados'} membro(s).`,
    details: result.warnings.length > 0 ? result.warnings : undefined,
    data: { slug: result.slug, plan: result.plan },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Vínculo de membro da equipe (FASE 14 — item C1)
// ───────────────────────────────────────────────────────────────────────────────
const memberSchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().trim().min(3).max(255),
  role: z.string().trim().min(2).max(40),
});

export async function addTenantMemberAction(
  _prev: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
  const operator = await requirePlatformPermission();

  const parsed = memberSchema.safeParse({
    tenantId: formData.get('tenantId'),
    email: formData.get('email'),
    role: formData.get('role'),
  });

  if (!parsed.success) {
    return failure('INVALID_INPUT', 'Informe o e-mail e o papel da pessoa.');
  }

  const result = await addTenantMember(operator.userId, {
    tenantId: parsed.data.tenantId,
    email: parsed.data.email,
    role: parsed.data.role as TenantMemberRole,
  });

  if (!result.ok) {
    return failure(result.code, result.message, result.details);
  }

  revalidatePlatform(result.slug);
  revalidatePath(`/superadmin/tenants/${parsed.data.tenantId}`);

  return {
    ok: true,
    message: `${result.name} agora é ${result.role} nesta instituição (${result.memberCount} de ${result.maxMembers ?? 'ilimitados'} membro(s)).`,
    data: { userId: result.userId, role: result.role },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  SuperAdmins
// ───────────────────────────────────────────────────────────────────────────────
const superAdminSchema = z.object({
  email: z.string().trim().min(3).max(255),
  reason: z.string().trim().max(300).optional(),
});

export async function grantSuperAdminAction(
  _prev: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
  const operator = await requirePlatformPermission();

  const parsed = superAdminSchema.safeParse({
    email: formData.get('email'),
    reason: (formData.get('reason') as string) || undefined,
  });

  if (!parsed.success) {
    return failure('INVALID_INPUT', 'Informe um e-mail válido.');
  }

  const result = await grantSuperAdmin(operator.userId, {
    email: parsed.data.email,
    reason: parsed.data.reason ?? null,
  });

  if (!result.ok) {
    return failure(result.code, result.message, result.details);
  }

  revalidatePath('/superadmin/governanca');

  return { ok: true, message: `${result.email} agora é SuperAdmin da plataforma.` };
}

export async function revokeSuperAdminAction(
  _prev: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
  const operator = await requirePlatformPermission();

  const parsed = z.object({ userId: z.string().uuid() }).safeParse({
    userId: formData.get('userId'),
  });

  if (!parsed.success) {
    return failure('INVALID_INPUT', 'Requisição inválida.');
  }

  const result = await revokeSuperAdmin(operator.userId, parsed.data.userId);

  if (!result.ok) {
    return failure(result.code, result.message, result.details);
  }

  revalidatePath('/superadmin/governanca');

  return { ok: true, message: 'Concessão de plataforma revogada.' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Rotinas automáticas (FASE 36)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Pede ao worker que rode uma rotina AGORA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A TELA NÃO RODA A ROTINA — E ISSO É O DESENHO, NÃO UMA LIMITAÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  As cinco rotinas são cross-tenant: cada passada abre transação por instituição,
 *  com a conexão de PLATAFORMA (`adminPrisma`), que o processo web não usa para
 *  isso (invariante nº 1). Rodá-las dentro da requisição prenderia a resposta do
 *  operador por minutos e daria à web uma conexão que ela não tem.
 *
 *  Então a ação ENFILEIRA e responde na hora. O que o operador lê é a verdade: o
 *  pedido foi entregue ao worker. A execução aparece no histórico logo abaixo —
 *  com `trigger = MANUAL` e o nome de quem pediu —, e é por isso que este retorno
 *  não é um "concluído" falso.
 *
 *  `revalidatePath` NÃO é chamado aqui de propósito (armadilha 76): o render desta
 *  rota depende de `job_runs`, e a linha só existe quando o worker terminar. Mandar
 *  a página se redesenhar agora apagaria a mensagem e mostraria a mesma lista, sem
 *  o registro. Quem atualiza a lista é o próprio componente, depois da resposta.
 */
export async function runJobNowAction(
  _prev: PlatformActionState | null,
  formData: FormData,
): Promise<PlatformActionState> {
  const operator = await requirePlatformPermission();

  const parsed = z.object({ job: z.string().trim().min(1).max(60) }).safeParse({
    job: formData.get('job'),
  });

  if (!parsed.success || !isJobKey(parsed.data.job)) {
    return failure('INVALID_INPUT', 'Rotina desconhecida.');
  }

  const job = parsed.data.job;
  const definition = jobDefinition(job);

  const queued = await enqueueJobRun({ job, trigger: 'MANUAL', actorId: operator.userId });

  if (!queued) {
    return failure(
      'QUEUE_UNAVAILABLE',
      'A fila de rotinas não respondeu. Confirme se o Redis e o worker estão no ar — sem o worker, a execução não sai da fila.',
    );
  }

  /**
   * A trilha guarda quem PEDIU. O registro da execução (`job_runs`) guarda o
   * `actorId` também, mas ele nasce no worker; aqui fica o pedido, que é o ato de
   * governança — e ele existe mesmo se o worker estiver fora do ar.
   *
   * ─── `entityId` É NULO DE PROPÓSITO ───────────────────────────────────────────
   *  A coluna é `uuid`, e a rotina é identificada por uma CHAVE (`audit-partitions`).
   *  Passar a chave ali faz o `INSERT` falhar — e, como `recordAudit` NUNCA lança
   *  (invariante 8: auditoria não derruba operação), a falha virava **ausência de
   *  trilha**, em silêncio. Quem pegou foi o E2E, que afirma a linha na tabela em vez
   *  de afirmar a tela. A chave vai em `changes.chave`, e o rótulo em legível.
   */
  await recordAudit({
    tenantId: null,
    userId: operator.userId,
    action: 'UPDATE',
    entityType: 'job_schedule',
    entityId: null,
    changes: {
      chave: { from: null, to: job },
      rotina: { from: null, to: definition.label },
      pedido: { from: null, to: 'execução imediata' },
    },
  });

  return {
    ok: true,
    message: `Execução de "${definition.label}" pedida ao worker. O registro aparece no histórico assim que ele concluir.`,
    data: { job },
  };
}
