/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — A visão pública do evento, com a sala online já resolvida (FASE 72)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UMA FUNÇÃO, DOIS CONSUMIDORES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A página pública do evento e a API por evento precisam da MESMA coisa: a
 *  projeção de `getPublicEvent` com o endereço da sala online entregue somente a
 *  quem tem lugar. Antes desta função, a página fazia a sequência
 *  `getPublicEvent` → `resolveOnlineRoomViewer` → `applyOnlineRoomVisibility` na
 *  mão; a API faria a mesma sequência em outro arquivo — e a segunda sequência é
 *  exatamente o "caminho novo para o banco" que a fase proíbe.
 *
 *  Aqui a sequência mora em UM lugar. A página passa o `userId` da sessão; a API
 *  passa `null` (não há sessão em uma API pública por chave). O que muda entre as
 *  duas é o FATO de quem olha, nunca a consulta nem a régua de visibilidade.
 *
 *  O `byActivity` continua sendo devolvido porque o cartão do "acontecendo agora"
 *  (F65) precisa do mapa separado — ele é serializável e o endereço não pode
 *  viajar nele.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  getPublicEvent,
  type PublicEventDetail,
} from '@/lib/events/event-repository';
import {
  applyOnlineRoomVisibility,
  resolveOnlineRoomViewer,
} from '@/lib/events/online-room-service';

export interface PublicEventView {
  /** A projeção com `onlineUrl` zerado onde o visitante não tem lugar. */
  event: PublicEventDetail;
  /** Os endereços visíveis por id de ATIVIDADE (nunca serializar). */
  byActivity: ReadonlyMap<string, string>;
}

/**
 * A leitura pública com a visibilidade da sala aplicada.
 *
 * `now` é opcional e só a API o injeta — o mesmo instante do `generatedAt` da
 * resposta. A página não o passa e continua usando o relógio do processo.
 */
export async function getPublicEventView(input: {
  tenantId: string;
  eventSlug: string;
  userId: string | null;
  now?: Date;
}): Promise<PublicEventView | null> {
  const publicEvent = await getPublicEvent(
    input.tenantId,
    input.eventSlug,
    input.now ? { now: input.now } : {},
  );

  /**
   * `null` é "não existe OU não é público" — a mesma resposta para os dois, para
   * não revelar rascunho. A página transforma em `notFound()`; a API, em `404`.
   */
  if (!publicEvent) return null;

  const viewer = await resolveOnlineRoomViewer({
    tenantId: input.tenantId,
    eventId: publicEvent.id,
    userId: input.userId,
  });

  return applyOnlineRoomVisibility(publicEvent, viewer);
}
