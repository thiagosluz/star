'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CASOS DE USO — Troca de contexto (context switching)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO A TROCA FUNCIONA SEM PERDER A SESSÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A sessão de autenticação (`session` do Better Auth) é ÚNICA e permanece
 *  intacta. O que muda é apenas o cookie `ef_tenant`, que aponta para a
 *  instituição ativa. Não há novo login, novo token, nem recriação de sessão.
 *
 *  O usuário continua o mesmo; só muda "de onde ele está falando".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VALIDAÇÃO DE VÍNCULO É OBRIGATÓRIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O cookie é assinado, mas assinatura não é autorização: um usuário legítimo
 *  poderia reaproveitar o próprio cookie após ser REMOVIDO da instituição. Por
 *  isso toda troca revalida o vínculo no banco antes de gravar o cookie, e o
 *  `getRequestContext()` revalida novamente a cada requisição. Duas camadas
 *  independentes — defesa em profundidade.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminPrisma } from '@/lib/db/admin-client';
import {
  ACTIVE_TENANT_COOKIE,
  getAuthenticatedUser,
  loadMemberships,
  serializeActiveTenant,
} from '@/lib/auth/session';
import { PATH_TENANT_PREFIX, matchPathTenant, tenantPath } from '@/domain/tenancy/resolution';

const switchSchema = z.object({
  tenantSlug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Instituição não informada.')
    .max(63),
  /** Rota de destino após a troca. Sempre relativa, nunca uma URL externa. */
  redirectTo: z.string().optional(),
});

export interface SwitchContextState {
  ok: boolean;
  message?: string;
}

/**
 * Troca a instituição ativa do usuário.
 *
 * Segurança aplicada:
 *  1. Exige sessão autenticada.
 *  2. Verifica que o vínculo existe E está ATIVO (convite pendente não conta).
 *  3. Aceita apenas caminho relativo como destino (evita open redirect).
 */
export async function switchTenantAction(
  _prev: SwitchContextState | null,
  formData: FormData,
): Promise<SwitchContextState> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, message: 'Sessão expirada. Entre novamente.' };
  }

  const parsed = switchSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    redirectTo: formData.get('redirectTo') ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: 'Instituição inválida.' };
  }

  const { tenantSlug, redirectTo } = parsed.data;

  // Revalida o vínculo no banco — nunca confiamos no que veio do formulário.
  const memberships = await loadMemberships(user.id);
  const target = memberships.find(
    (m) => m.tenantSlug === tenantSlug && m.status === 'ACTIVE',
  );

  if (!target) {
    return {
      ok: false,
      message: 'Você não tem acesso ativo a esta instituição.',
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, serializeActiveTenant(target.tenantSlug), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 dias
  });

  // Registra o último tenant para telemetria (nunca para autorização).
  await adminPrisma.session
    .updateMany({
      where: { userId: user.id },
      data: { lastTenantId: target.tenantId },
    })
    .catch(() => {
      // Telemetria não pode derrubar a troca de contexto.
    });

  // O layout do tenant é cacheado por requisição; invalida para refletir o novo
  // contexto imediatamente.
  revalidatePath('/', 'layout');

  /**
   * O destino é SEMPRE o caminho canônico do novo contexto.
   *
   * Por que não redirecionar para um caminho "cru" como `/dashboard`:
   * `/dashboard` no domínio raiz é uma rota exclusiva de instituição, e o Proxy
   * responde 404 quando não há instituição no host. Além disso, o Next resolve
   * redirecionamentos relativos contra o host atual, o que produziria o painel
   * da instituição ERRADA ao trocar vindo de um subdomínio.
   *
   * Ancorar em `tenantPath(novoSlug, destino)` funciona nos dois modos:
   * por path (`/t/<slug>/...`) e por subdomínio.
   */
  const requestedPath =
    redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')
      ? redirectTo
      : '/dashboard';

  // Aceita tanto `/dashboard` quanto `/t/outro-slug/dashboard` como destino.
  const innerPath = requestedPath.startsWith(`${PATH_TENANT_PREFIX}/`)
    ? (matchPathTenant(requestedPath)?.rest ?? '/dashboard')
    : requestedPath;

  redirect(tenantPath(target.tenantSlug, innerPath));
}

/**
 * Define o contexto ativo a partir do slug, sem formulário.
 * Usado no fluxo de "entrar na instituição" a partir do seletor.
 */
export async function enterTenantAction(tenantSlug: string): Promise<SwitchContextState> {
  const formData = new FormData();
  formData.set('tenantSlug', tenantSlug);
  return switchTenantAction(null, formData);
}
