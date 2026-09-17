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
import {
  grantSuperAdmin,
  provisionTenant,
  revokeSuperAdmin,
  setTenantStatus,
  updateTenantProfile,
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
