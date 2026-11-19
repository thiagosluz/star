/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Guarda da plataforma
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A RESPOSTA É 404 E NÃO 403
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um 403 confirma que a rota existe: "existe um painel de governança aqui, você
 *  não pode entrar". Para quem sonda a plataforma, isso já é informação — e é o
 *  suficiente para transformar um alvo invisível em um alvo mapeado.
 *
 *  O 404 responde a mesma coisa para todo mundo: não existe. Quem é SuperAdmin vê
 *  o painel; quem não é vê exatamente o que veria em `/qualquer-coisa`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DECISÃO USA `can()`, NÃO UM `if (role === 'SUPERADMIN')`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Comparar o papel à mão espalharia a regra por cada página e cada ação, e a
 *  primeira que esquecesse a concessão expirada ou revogada seria a brecha. `can()`
 *  já valida vigência, revogação e vínculo operacional — a guarda só pergunta.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { notFound } from 'next/navigation';

import { getPlatformContext } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';

export interface PlatformOperator {
  userId: string;
  name: string;
  email: string;
}

/**
 * Exige a permissão de plataforma. Sem sessão, sem concessão ou com concessão
 * revogada/expirada: `notFound()` — nunca um erro que explique o motivo.
 *
 * Serve tanto para Server Components quanto para Server Actions: em ambos, o
 * desfecho é a página 404, e não um painel recém-revelado a quem não pode vê-lo.
 */
export async function requirePlatformPermission(
  permission: string = PERMISSIONS.PLATFORM_MANAGE,
): Promise<PlatformOperator> {
  const context = await getPlatformContext();

  if (!context) notFound();

  const allowed = can(
    context.principal,
    permission as (typeof PERMISSIONS)[keyof typeof PERMISSIONS],
    { scope: 'PLATFORM' },
  );

  if (!allowed) notFound();

  return { userId: context.user.id, name: context.user.name, email: context.user.email };
}
