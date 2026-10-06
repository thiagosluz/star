/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — QUEM VÊ O ENDEREÇO DA SALA ONLINE, RESOLVIDO NO SERVIDOR (FASE 68)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA QUE ESTE ARQUIVO RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O bloco de LOCAL da página pública mostrava `Event.onlineUrl` a QUALQUER
 *  visitante — inclusive ao anônimo — desde sempre, porque a coluna existia e o
 *  renderizador não perguntava nada (medido na fatia 0: um leitor, zero escritores).
 *  Criar o escritor sem resolver a visibilidade seria criar o vazamento: o
 *  organizador digitaria o endereço da sala e ele apareceria para a internet inteira.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FORMA VEM DE DOIS PADRÕES QUE JÁ EXISTIAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • **Equipe do evento** — `canOperateCheckIn`
 *    (`.../(public)/eventos/[eventSlug]/page.tsx:40-54`): `loadPrincipal` e `can(...)`
 *    com os DOIS escopos (`TENANT` **ou** `EVENT`), porque a permissão chega nos dois
 *    formatos reais. A permissão aqui é `EVENT_UPDATE` **ou** `EVENT_MANAGE`
 *    (justificativa no bloco abaixo).
 *  • **Posse resolvida no banco** — `resolveActivityViewer`
 *    (`src/lib/speakers/material-service.ts:848-889`): a pergunta "quem é você neste
 *    evento?" é respondida por uma CONSULTA, nunca pelo que o cliente mandou.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE `EVENT_UPDATE` / `EVENT_MANAGE`, E NÃO OUTRA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O endereço é um CAMPO do evento e da atividade: quem o escreve é quem edita o
 *  evento (`saveEventAction` exige `event:update`) e quem responde por ele
 *  (`event:manage`, o ato de organizar — é a permissão de quem sorteia, convida e
 *  publica). `ORGANIZER` tem as duas; `OWNER`/`ADMIN` herdam o catálogo inteiro.
 *
 *  A escolha é CONSERVADORA de propósito: **`STAFF` (a equipe do dia) NÃO entra** —
 *  ela opera a porta (`registration:checkin`), não a sala, e a permissão `:own`
 *  desta casa nega por padrão (invariante 4). Quem precisa entrar na sala entra
 *  como inscrito; quem a monta está na equipe que edita o evento.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ENDEREÇO NÃO É ESCONDIDO — ELE NÃO É ENTREGUE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `applyOnlineRoomVisibility` devolve uma projeção NOVA com `onlineUrl: null` onde a
 *  pessoa não tem lugar. Não há `hidden`, não há CSS, não há JavaScript: o que não
 *  pode ser visto não chega ao renderizador — e, portanto, não chega ao HTML, ao
 *  `Ctrl+U` nem ao payload de um Client Component.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { loadPrincipal } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import type { RegistrationStatus } from '@/domain/events/registration-rules';
import {
  registrationSeesOnlineRoom,
  seesActivityOnlineRoom,
  seesEventOnlineRoom,
  type OnlineRoomViewer,
} from '@/domain/events/online-room-rules';
import type { PublicEventDetail } from '@/lib/events/event-repository';

/**
 * Os fatos de quem está olhando, lidos no BANCO e sob o contexto de UMA instituição.
 *
 * Anônimo é `{ isEventTeam: false, ... }` sem tocar o banco: sem sessão não há
 * inscrição nem papel a consultar, e o visitante que só quer ver a programação não
 * paga uma ida a mais por uma permissão que ele não tem.
 */
export async function resolveOnlineRoomViewer(input: {
  tenantId: string;
  eventId: string;
  userId: string | null;
}): Promise<OnlineRoomViewer> {
  if (!input.userId) {
    return { isEventTeam: false, eventRegistration: null, activityRegistrations: new Map() };
  }

  /**
   * Cópia LOCAL do id: o estreitamento do `if` acima não sobrevive dentro do callback
   * do `withTenant`, e sem ela o tipo do filtro voltaria a aceitar `null` — o que
   * seria uma consulta silenciosamente vazia (ou pior, uma lista sem dono).
   */
  const userId = input.userId;

  const [isEventTeam, registrations] = await Promise.all([
    isEventTeamMember({ tenantId: input.tenantId, eventId: input.eventId, userId }),
    withTenant(input.tenantId, (tx) =>
      tx.registration.findMany({
        where: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          userId,
          deletedAt: null,
        },
        select: { activityId: true, status: true },
      }),
    ),
  ]);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  UMA PESSOA PODE TER MAIS DE UMA LINHA POR ATIVIDADE — E A CANCELADA NÃO MANDA
   * ─────────────────────────────────────────────────────────────────────────────
   *  O índice único de "inscrição viva" é PARCIAL (`WHERE status IN (...)`,
   *  armadilha 103): ele garante UMA linha viva por (atividade, pessoa), e deixa as
   *  canceladas conviverem com ela — quem cancelou e voltou tem as duas. Ler a
   *  primeira linha que aparecesse faria a `CANCELED` antiga esconder a `CONFIRMED`
   *  nova, e a pessoa com lugar não veria o endereço da própria sala.
   *
   *  Por isso a leitura FICA COM A MELHOR LINHA: a primeira que dá lugar na sala;
   *  na falta dela, a primeira que existir (que é o que a tela de inscrição precisa
   *  para dizer "cancelada").
   */
  let eventRegistration: RegistrationStatus | null = null;
  const activityRegistrations = new Map<string, RegistrationStatus>();

  for (const row of registrations) {
    const status = row.status as RegistrationStatus;

    if (row.activityId === null) {
      if (eventRegistration === null || betterStatus(status, eventRegistration)) {
        eventRegistration = status;
      }
      continue;
    }

    const current = activityRegistrations.get(row.activityId);

    if (current === undefined || betterStatus(status, current)) {
      activityRegistrations.set(row.activityId, status);
    }
  }

  return { isEventTeam, eventRegistration, activityRegistrations };
}

/** A candidata dá lugar na sala e a atual não? (desempate da leitura acima.) */
function betterStatus(candidate: RegistrationStatus, current: RegistrationStatus): boolean {
  return !registrationSeesOnlineRoom(current) && registrationSeesOnlineRoom(candidate);
}

/**
 * A permissão da equipe, nos DOIS escopos — a forma de `canOperateCheckIn`.
 *
 * `EVENT_UPDATE` é quem edita o evento (e o endereço); `EVENT_MANAGE` é quem responde
 * por ele. Ver o bloco do cabeçalho para a justificativa e para o que fica de fora.
 */
async function isEventTeamMember(input: {
  tenantId: string;
  eventId: string;
  userId: string;
}): Promise<boolean> {
  const principal = await loadPrincipal(input.userId, input.tenantId, 'ACTIVE');

  const scopes = [
    { scope: 'TENANT' as const },
    { scope: 'EVENT' as const, eventId: input.eventId },
  ];

  return scopes.some(
    (scope) =>
      can(principal, PERMISSIONS.EVENT_UPDATE, scope) ||
      can(principal, PERMISSIONS.EVENT_MANAGE, scope),
  );
}

/**
 * ───────────────────────────────────────────────────────────────────────────────
 *  A PROJEÇÃO POR ATIVIDADE — O ÚNICO LUGAR QUE DECIDE (FASE 68 · reusado na F69)
 * ───────────────────────────────────────────────────────────────────────────────
 *  A pergunta "qual endereço ESTA pessoa pode ver, por atividade?" é respondida aqui, e
 *  só aqui. `applyOnlineRoomVisibility` (a página pública do evento, o "acontecendo
 *  agora" e a prévia) e a "minha agenda" (FASE 69) precisam da MESMA resposta sobre
 *  projeções diferentes — uma tem o `PublicEventDetail` inteiro, a outra tem a lista de
 *  itens da grade.
 *
 *  Escrever a segunda decisão no meio da tela da agenda seria a repetição que esta casa
 *  já pagou caro: duas perguntas "quem vê o endereço?" divergem no primeiro ajuste, e a
 *  que ficar para trás passa a ENTREGAR o endereço a quem não tem lugar. Por isso a
 *  função é PURA (recebe a régua do domínio e devolve um mapa) e as duas superfícies a
 *  chamam — o que muda entre elas é só de onde vêm os fatos.
 *
 *  Ela não existe no domínio porque o mapa por id é uma decisão de APRESENTAÇÃO (é o
 *  formato que os renderizadores consomem), e não uma regra sobre quem tem lugar.
 */
/**
 * A atividade reduzida ao que a projeção da sala online precisa.
 *
 * É o MESMO formato de `PublicActivitySummary` (que tem `id` e `requiresRegistration`) e
 * o mesmo que a "minha agenda" monta a partir da própria leitura (FASE 69) — o que
 * permite às duas superfícies chamarem a MESMA função em vez de escreverem a régua de
 * novo. `requiresRegistration` é o fato que separa a atividade aberta da fechada.
 */
export interface OnlineRoomActivityFact {
  id: string;
  requiresRegistration: boolean;
  onlineUrl: string | null;
}

export function visibleOnlineRoomsByActivity(
  viewer: OnlineRoomViewer,
  activities: readonly OnlineRoomActivityFact[],
): ReadonlyMap<string, string> {
  const byActivity = new Map<string, string>();

  for (const activity of activities) {
    if (!activity.onlineUrl) continue;

    const visible = seesActivityOnlineRoom(viewer, {
      id: activity.id,
      requiresRegistration: activity.requiresRegistration,
    });

    if (visible) byActivity.set(activity.id, activity.onlineUrl);
  }

  return byActivity;
}

/**
 * A projeção pública com os endereços que ESTA pessoa pode ver.
 *
 * É o único caminho pelo qual a página pública recebe o evento: quem não tem lugar
 * recebe `onlineUrl: null` no evento e em cada atividade, e o renderizador não tem o
 * que desenhar (ver o cabeçalho).
 *
 * `byActivity` existe para o cartão do "acontecendo agora" (FASE 65): a visão daquele
 * cartão (`HappeningNowView`) é serializável e vai para o cliente, então o endereço
 * NÃO pode viajar nela — ele viaja neste mapa, que é consumido por um Server
 * Component e nunca é serializado.
 */
export function applyOnlineRoomVisibility(
  event: PublicEventDetail,
  viewer: OnlineRoomViewer,
): { event: PublicEventDetail; byActivity: ReadonlyMap<string, string> } {
  const byActivity = visibleOnlineRoomsByActivity(viewer, event.activities);

  /**
   * A atividade que NÃO está no mapa tem o endereço zerado na projeção — inclusive
   * quando ela nem endereço tem, e aí a cópia é a mesma coisa (o valor já era `null`).
   * O que a linha garante é a única coisa que importa: o que não pode ser visto não
   * chega ao renderizador.
   */
  const activities = event.activities.map((activity) =>
    byActivity.has(activity.id) ? activity : { ...activity, onlineUrl: null },
  );

  return {
    event: {
      ...event,
      onlineUrl: seesEventOnlineRoom(viewer) ? event.onlineUrl : null,
      activities,
    },
    byActivity,
  };
}
