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

import { guardAction } from '@/lib/auth/guard-action';
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

  /**
   * O alvo é o EVENTO, como nas outras ações de equipe: o papel pode valer só nele, e
   * exigir escopo de instituição recusaria o caso normal (a equipe do dia). Quem
   * garante isso é `allowedScopes: ['EVENT']` + o `eventId` do formulário — o
   * `guardAction` continua sendo o dono da checagem.
   */
  const auth = await guardAction<TeamOrderActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_TEAM_MANAGE,
    allowedScopes: ['EVENT'],
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
