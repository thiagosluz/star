/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — As listas que o formulário de segmento oferece (FASE 67 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O FORMULÁRIO PRECISA DE UMA LISTA, E NÃO DE UM CAMPO DE TEXTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cinco condições do catálogo recortam por ENTIDADE (atividade, sala, trilha,
 *  chamada, carta), e o parâmetro delas é um uuid. Texto livre aqui seria um
 *  gerador de segmento vazio: ninguém digita uuid de cabeça, e um uuid errado
 *  seleciona NINGUÉM — que é o pior resultado possível para quem está montando uma
 *  campanha, porque parece que a instituição não tem ninguém.
 *
 *  As listas saem de UMA leitura sob `withTenant` (a RLS é a cerca) e o teto é
 *  generoso de propósito: pentear todas as opções de uma instituição grande num
 *  `<select>` não é o problema — o problema é a lista MENTIR por omissão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LISTA NÃO TROCA QUANDO O EVENTO TROCA — ELA DIZ DE ONDE VEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As atividades de uma instituição podem se chamar "Abertura" em cinco eventos
 *  diferentes. Com evento escolhido, a lista é a do evento (e o rótulo é o título,
 *  como o organizador o vê); sem evento, a lista é a da instituição inteira e o
 *  rótulo carrega o evento de origem — senão a escolha seria um sorteio entre
 *  títulos idênticos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { logger } from '@/lib/observability/logger';

export interface SegmentOption {
  id: string;
  label: string;
}

export interface SegmentOptions {
  events: readonly SegmentOption[];
  activities: readonly SegmentOption[];
  rooms: readonly SegmentOption[];
  tracks: readonly SegmentOption[];
  calls: readonly SegmentOption[];
  cards: readonly SegmentOption[];
}

const EMPTY_OPTIONS: SegmentOptions = {
  events: [],
  activities: [],
  rooms: [],
  tracks: [],
  calls: [],
  cards: [],
};

const OPTION_LIMIT = 200;

/** `Abertura — Congresso 2027` quando a lista junta mais de um evento. */
function withEventTitle(title: string, eventTitle: string | null | undefined): string {
  return eventTitle ? `${title} — ${eventTitle}` : title;
}

/**
 * Carrega as opções do formulário.
 *
 * Falha de leitura NÃO derruba a tela: devolve listas vazias e registra o motivo.
 * Quem monta o segmento continua vendo as condições sem parâmetro de entidade (e a
 * lista vazia diz "nenhuma opção"), em vez de receber a página de erro.
 */
export async function loadSegmentOptions(input: {
  tenantId: string;
  eventId: string | null;
}): Promise<SegmentOptions> {
  const eventFilter = input.eventId ? { eventId: input.eventId } : {};
  const decorate = input.eventId === null;

  try {
    const [events, activities, rooms, tracks, calls, cards] = await withTenant(input.tenantId, (tx) =>
      Promise.all([
        tx.event.findMany({
          where: { tenantId: input.tenantId, deletedAt: null },
          orderBy: { startsAt: 'desc' },
          take: OPTION_LIMIT,
          select: { id: true, title: true },
        }),
        tx.activity.findMany({
          where: { tenantId: input.tenantId, deletedAt: null, ...eventFilter },
          orderBy: [{ startsAt: 'desc' }, { title: 'asc' }],
          take: OPTION_LIMIT,
          select: { id: true, title: true, event: { select: { title: true } } },
        }),
        tx.room.findMany({
          where: { tenantId: input.tenantId, ...eventFilter },
          orderBy: { name: 'asc' },
          take: OPTION_LIMIT,
          select: { id: true, name: true, event: { select: { title: true } } },
        }),
        tx.track.findMany({
          where: { tenantId: input.tenantId, deletedAt: null, ...eventFilter },
          orderBy: { name: 'asc' },
          take: OPTION_LIMIT,
          select: { id: true, name: true, event: { select: { title: true } } },
        }),
        tx.callForProposals.findMany({
          where: { tenantId: input.tenantId, deletedAt: null, ...eventFilter },
          orderBy: { title: 'asc' },
          take: OPTION_LIMIT,
          select: { id: true, title: true, event: { select: { title: true } } },
        }),
        tx.cardTemplate.findMany({
          where: { tenantId: input.tenantId, deletedAt: null },
          orderBy: { name: 'asc' },
          take: OPTION_LIMIT,
          select: { id: true, name: true },
        }),
      ]),
    );

    return {
      events: events.map((row) => ({ id: row.id, label: row.title })),
      activities: activities.map((row) => ({
        id: row.id,
        label: decorate ? withEventTitle(row.title, row.event?.title) : row.title,
      })),
      rooms: rooms.map((row) => ({
        id: row.id,
        label: decorate ? withEventTitle(row.name, row.event?.title) : row.name,
      })),
      tracks: tracks.map((row) => ({
        id: row.id,
        label: decorate ? withEventTitle(row.name, row.event?.title) : row.name,
      })),
      calls: calls.map((row) => ({
        id: row.id,
        label: decorate ? withEventTitle(row.title, row.event?.title) : row.title,
      })),
      cards: cards.map((row) => ({ id: row.id, label: row.name })),
    };
  } catch (error) {
    logger.error('segments: falha ao carregar as opções do formulário', {
      error: errorMessage(error),
    });

    return EMPTY_OPTIONS;
  }
}
