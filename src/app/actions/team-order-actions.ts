'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Ordem das equipes do evento (FASE 51 · dívida E63)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE MOVER PARA CIMA/BAIXO, E NÃO UM CAMPO NUMÉRICO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As duas alternativas funcionam sem JavaScript, então a escolha não é técnica — é
 *  de produto:
 *
 *   • o quadro de demandas (FASE 38) já reordena colunas com "subir/descer", e a mesma
 *     tela de equipes fica ao lado dele: dois gestos diferentes para "mudar a ordem"
 *     no mesmo produto é o tipo de detalhe que ninguém lê na documentação;
 *   • um campo numérico expõe a RÉGUA (10, 20, 30…) ao organizador, que passaria a
 *     digitar 15 para "ficar entre a segunda e a terceira" — e a reescrita em bloco
 *     jogaria o número dele fora no primeiro movimento. O número é implementação; o
 *     que a pessoa quer dizer é "esta vem antes daquela".
 *
 *  A ordem é calculada com a lista que a TELA mostrou (`loadEventTeamOrder`, a mesma
 *  régua da vitrine) e chega ao serviço como a ordem COMPLETA: é o que impede um
 *  empate de virar um clique que não muda nada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { moveWithinList } from '@/domain/events/demand-rules';
import { loadEventTeamOrder, reorderEventTeams } from '@/lib/events/demand-service';

export interface TeamOrderActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
}

type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

async function guard(input: {
  tenantSlug: string;
  permission: Permission;
  eventId: string;
}): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: TeamOrderActionState }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
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

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  /**
   * O alvo é o EVENTO, como nas outras ações de equipe: o papel pode valer só nele, e
   * exigir escopo de instituição recusaria o caso normal (a equipe do dia).
   */
  if (!can(principal, input.permission, { scope: 'EVENT', eventId: input.eventId })) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: `Permissão negada: ${input.permission}.` },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

function revalidateTeams(tenantSlug: string, eventId: string): void {
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/equipes`));
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/demandas`));
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}`));
}

export async function moveTeamOrderAction(
  _prev: TeamOrderActionState | null,
  formData: FormData,
): Promise<TeamOrderActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      teamId: z.string().uuid(),
      direction: z.enum(['up', 'down']),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      teamId: formData.get('teamId'),
      direction: formData.get('direction'),
    });

  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: 'Movimento inválido.' };

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_TEAM_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const loaded = await loadEventTeamOrder({ tenantId: auth.tenantId, eventId: parsed.data.eventId });
  if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message };

  const index = loaded.teams.findIndex((team) => team.id === parsed.data.teamId);
  if (index < 0) return { ok: false, code: 'NOT_FOUND', message: 'Equipe não encontrada.' };

  const target = parsed.data.direction === 'up' ? index - 1 : index + 1;

  /**
   * Nas pontas NADA é escrito, e a resposta diz por quê. Mandar o movimento mesmo
   * assim gravaria a mesma ordem e uma entrada de trilha a mais — "ordem salva" sem
   * nada ter mudado é a mentira que o usuário não tem como conferir.
   */
  if (target < 0 || target >= loaded.teams.length) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message:
        parsed.data.direction === 'up'
          ? 'Esta equipe já é a primeira da lista.'
          : 'Esta equipe já é a última da lista.',
    };
  }

  const ids = moveWithinList(
    loaded.teams.map((team) => team.id),
    index,
    target,
  );

  const result = await reorderEventTeams({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorId: auth.userId,
    teamIds: ids,
  });

  revalidateTeams(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok
    ? { ok: true, message: 'Ordem das equipes salva.' }
    : { ok: false, code: result.code, message: result.message };
}
