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
import { readEventApiKeyState } from '@/domain/api/event-api-organizer-rules';
import { readEventApiConfig } from '@/domain/api/event-api-key-rules';

import type { EventAreaCounts } from '@/domain/events/event-areas';
import type { EventOverviewDbMetrics } from '@/domain/events/event-overview-rules';
import { logger } from '@/lib/observability/logger';

export type EventAreaCountsResult =
  | { ok: true; counts: EventAreaCounts; overview: EventOverviewDbMetrics }
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

      const [
        calls,
        rooms,
        activities,
        teams,
        sponsors,
        credentials,
        certificates,
        proceedingsEntries,
        financialEntries,
        openDemands,
        speakers,
        page,
        estadoDoEvento,
        registrationGroups,
        attendanceByUser,
        submissionsCount,
        completedDemandsCount,
        fundingAgg,
        settledFinanceGroups,
      ] = await Promise.all([
          tx.callForProposals.count({ where: { ...escopo, deletedAt: null } }),
          tx.room.count({ where: escopo }),
          tx.activity.count({ where: escopo }),
          tx.eventTeam.count({ where: { ...escopo, isActive: true } }),
          tx.sponsor.count({ where: { ...escopo, isActive: true } }),
          tx.eventCredential.count({ where: { ...escopo, status: 'ACTIVE' } }),
          tx.certificate.count({ where: escopo }),
          tx.proceedingsEntry.count({
            where: {
              tenantId: input.tenantId,
              includeInProceedings: true,
              volume: { tenantId: input.tenantId, eventId: input.eventId },
            },
          }),
          tx.eventFinancialEntry.count({
            where: { ...escopo, status: { not: 'CANCELED' } },
          }),
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
             *
             * A MESMA linha serve ao formulário (F70) e à chave da API (F72 · fatia
             * 3): os dois vivem em `Event.settings`, e uma segunda leitura do mesmo
             * JSON seria uma segunda verdade sobre o mesmo dado.
             */
            .findFirst({
              where: { id: input.eventId, tenantId: input.tenantId },
              select: { settings: true },
            })
            .then((row) => {
              if (!row) return { formFields: null, apiKey: null };

              const form = readRegistrationForm(row.settings);
              const api = readEventApiConfig(row.settings);

              return {
                formFields: form.problems.length > 0 ? null : form.fields.length,
                /**
                 * `INVALID` é um estado da chave, mas NÃO vira selo: a leitura
                 * tolerante devolveu problemas, e afirmar qualquer coisa sobre uma
                 * configuração ilegível seria o selo mentindo (ver o domínio).
                 */
                apiKey: readEventApiKeyState(api),
              };
            }),
          /** Inscrições no evento (`activityId: null`) agrupadas por estado para o painel executivo (FASE 126). */
          tx.registration.groupBy({
            by: ['status'],
            where: { ...escopo, activityId: null, deletedAt: null },
            _count: { _all: true },
          }),
          /** Frequência distinta por pessoa e minutos acumulados no evento (FASE 126). */
          tx.attendance.groupBy({
            by: ['userId'],
            where: escopo,
            _count: { _all: true },
            _sum: { minutesAttended: true },
          }),
          /** Trabalhos/propostas já submetidos (rascunhos ficam de fora) (FASE 126). */
          tx.submission.count({
            where: { ...escopo, deletedAt: null, status: { not: 'DRAFT' } },
          }),
          tx.demand.count({
            where: { ...escopo, completedAt: { not: null } },
          }),
          tx.eventFundingSource.aggregate({
            where: escopo,
            _sum: { approvedCents: true },
          }),
          tx.eventFinancialEntry.groupBy({
            by: ['type'],
            where: { ...escopo, status: 'SETTLED' },
            _sum: { amountCents: true },
          }),
        ]);

      let confirmedRegistrations = 0;
      let pendingEventRegistrations = 0;
      let waitlistedRegistrations = 0;
      let attendedRegistrations = 0;

      for (const row of registrationGroups) {
        if (row.status === 'CONFIRMED' || row.status === 'ATTENDED') {
          confirmedRegistrations += row._count._all;
        }
        if (row.status === 'ATTENDED') {
          attendedRegistrations += row._count._all;
        }
        if (row.status === 'PENDING') {
          pendingEventRegistrations += row._count._all;
        }
        if (row.status === 'WAITLISTED') {
          waitlistedRegistrations += row._count._all;
        }
      }

      let attendanceVisitsCount = 0;
      let attendanceMinutesTotal = 0;
      for (const row of attendanceByUser) {
        attendanceVisitsCount += row._count._all;
        attendanceMinutesTotal += row._sum.minutesAttended ?? 0;
      }

      let settledIncomeCents = 0;
      let settledExpenseCents = 0;
      for (const row of settledFinanceGroups) {
        if (row.type === 'INCOME') {
          settledIncomeCents += row._sum.amountCents ?? 0;
        }
        if (row.type === 'EXPENSE') {
          settledExpenseCents += row._sum.amountCents ?? 0;
        }
      }

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
          proceedingsEntries,
          financialEntries,
          openDemands,
          speakers,
          /**
           * As inscrições que retêm vaga são contadas pela FILA de confirmações, que
           * a tela já carrega — repetir a conta aqui seria uma segunda verdade sobre
           * o mesmo fato. O chamador passa o número que já tem.
           */
          pendingConfirmations: null,
          formFields: estadoDoEvento.formFields,
          pagePublished: page?.isPublished ?? null,
          apiKey: estadoDoEvento.apiKey,
        },
        overview: {
          confirmedRegistrations,
          pendingEventRegistrations,
          waitlistedRegistrations,
          attendedUsersCount: Math.max(attendanceByUser.length, attendedRegistrations),
          attendanceVisitsCount,
          attendanceMinutesTotal,
          submissionsCount,
          completedDemandsCount,
          approvedFundingCents: fundingAgg._sum.approvedCents ?? 0,
          settledIncomeCents,
          settledExpenseCents,
        },
      };
    });
  } catch (error) {
    /**
     * Sem número a tela continua: o selo é informação, não pré-requisito. O log
     * existe porque a falha é SILENCIOSA por desenho — sem ele, uma consulta quebrada
     * vira "os cartões nunca têm selo" e ninguém sabe por quê.
     */
    logger.error(`[areas] falha ao contar as áreas do evento: ${errorMessage(error)}`);

    return {
      ok: false,
      code: 'READ_FAILED',
      message: 'Não foi possível contar as áreas do evento agora.',
    };
  }
}
