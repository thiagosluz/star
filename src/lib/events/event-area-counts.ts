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
import { errorMessage } from '@/lib/db/prisma-errors';
import { readRegistrationForm } from '@/domain/events/registration-form-spec-rules';

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

      const [calls, rooms, activities, teams, sponsors, credentials, certificates, openDemands, speakers, page, formulario] =
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
          /**
           * ─────────────────────────────────────────────────────────────────────────────
           *  O FORMULÁRIO DO EVENTO É `settings`, E O LEITOR É O DO DOMÍNIO (FASE 70)
           * ─────────────────────────────────────────────────────────────────────────────
           *  Os campos declarados não são linha de tabela: vivem em
           *  `Event.settings.registrationForm`. Contá-los aqui é ler a MESMA projeção
           *  que a tela do participante lê (`readRegistrationForm`) — contar o JSON cru
           *  daria um número que a página de inscrição não confirma (configuração torta
           *  é lida como zero campo, e o selo diria "3").
           *
           *  Configuração INVÁLIDA devolve `null`, e não zero: zero é "contei e não há",
           *  e aqui o que há é uma configuração que o sistema não consegue ler. Sem
           *  selo, o organizador olha a área; com "nenhum campo declarado", ele
           *  acreditaria nela.
           */
          tx.event
            /**
             * O `where` é próprio: `escopo` usa `eventId`, que é o nome da chave nas
             * tabelas FILHAS — o evento se identifica por `id`.
             */
            .findFirst({
              where: { id: input.eventId, tenantId: input.tenantId },
              select: { settings: true },
            })
            .then((row) => {
              if (!row) return null;

              const form = readRegistrationForm(row.settings);

              return form.problems.length > 0 ? null : form.fields.length;
            }),
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
          formFields: formulario,
          pagePublished: page?.isPublished ?? null,
        },
      };
    });
  } catch (error) {
    /**
     * Sem número a tela continua: o selo é informação, não pré-requisito. O log
     * existe porque a falha é SILENCIOSA por desenho — sem ele, uma consulta quebrada
     * vira "os cartões nunca têm selo" e ninguém sabe por quê.
     */
    console.error(`[areas] falha ao contar as áreas do evento: ${errorMessage(error)}`);

    return {
      ok: false,
      code: 'READ_FAILED',
      message: 'Não foi possível contar as áreas do evento agora.',
    };
  }
}
