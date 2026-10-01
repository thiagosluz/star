/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AS CONTAGENS DAS ÁREAS DO EVENTO (FASE 54)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA CONSULTA SÓ, E POR QUE ELA NÃO CONFIA EM NADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O selo de cada cartão precisa de um número. Buscá-los um a um seria uma ida ao
 *  banco por cartão — oito para desenhar a tela que o organizador abre primeiro. As
 *  contagens vão juntas, na MESMA transação de tenant (`withTenant`), e por isso
 *  enxergam exatamente o que a RLS permite: nada vaza entre instituições.
 *
 *  Três decisões que evitam selo mentiroso:
 *
 *  • **Contagem é do EVENTO, não da instituição.** "3 patrocinadores" na tela de um
 *    evento que não tem nenhum seria pior do que selo nenhum — todas as consultas
 *    filtram por `eventId`.
 *  • **O que está fora do ar não conta como existente.** Patrocinador inativo, equipe
 *    desativada, chamada excluída e crachá revogado ficam de fora: o selo mede o que
 *    está valendo.
 *  • **Falha não derruba a tela.** Se a leitura falhar, a função devolve `ok: false`
 *    e o chamador desenha os cartões SEM selo — a tela de gerenciar evento não pode
 *    ficar indisponível porque um número não veio (o selo é enfeite informativo, a
 *    tela é o trabalho).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';

import type { EventAreaCounts } from '@/domain/events/event-areas';

export type EventAreaCountsResult =
  | { ok: true; counts: EventAreaCounts }
  | { ok: false; code: 'READ_FAILED'; message: string };

/**
 * As contagens do evento, em uma leitura.
 *
 * O que não é medido com segurança vem `null` — e o selo daquela área não aparece
 * (o domínio trata `null` como "sem selo", ver `eventAreaMetric`). É melhor um
 * cartão limpo do que um número que ninguém conferiu.
 */
export async function getEventAreaCounts(input: {
  tenantId: string;
  eventId: string;
}): Promise<EventAreaCountsResult> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const escopo = { tenantId: input.tenantId, eventId: input.eventId };

      const [calls, rooms, activities, teams, sponsors, credentials, certificates, openDemands, speakers, page] =
        await Promise.all([
          tx.callForProposals.count({ where: { ...escopo, deletedAt: null } }),
          tx.room.count({ where: escopo }),
          tx.activity.count({ where: escopo }),
          tx.eventTeam.count({ where: { ...escopo, isActive: true } }),
          tx.sponsor.count({ where: { ...escopo, isActive: true } }),
          tx.eventCredential.count({ where: { ...escopo, status: 'ACTIVE' } }),
          tx.certificate.count({ where: escopo }),
          tx.demand.count({ where: { ...escopo, completedAt: null } }),
          /**
           * Palestrante é da ATIVIDADE, não do evento (FASE 25): quem dá a palestra é
           * vinculado à sessão. Contar perfis da instituição inflaria o número com
           * gente que não pisa neste evento.
           */
          tx.activitySpeaker.count({ where: { activity: { tenantId: input.tenantId, eventId: input.eventId } } }),
          tx.eventPage.findFirst({ where: escopo, select: { isPublished: true } }),
        ]);

      return {
        ok: true as const,
        counts: {
          calls,
          rooms,
          activities,
          teams,
          sponsors,
          credentials,
          certificates,
          openDemands,
          speakers,
          /**
           * As inscrições que retêm vaga são contadas pela FILA de confirmações, que
           * a tela já carrega — repetir a conta aqui seria uma segunda verdade sobre
           * o mesmo fato. O chamador passa o número que já tem.
           */
          pendingConfirmations: null,
          pagePublished: page?.isPublished ?? null,
        },
      };
    });
  } catch {
    /** Sem número a tela continua: o selo é informação, não pré-requisito. */
    return {
      ok: false,
      code: 'READ_FAILED',
      message: 'Não foi possível contar as áreas do evento agora.',
    };
  }
}
