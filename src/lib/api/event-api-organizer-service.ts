/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — a leitura da tela da API do organizador (FASE 72 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA LEITURA PRÓPRIA, E NÃO `getAdminEvent`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A configuração da chave vive em `Event.settings.api`. `getAdminEvent` já lê
 *  `settings`, mas NÃO o devolve: a tela de dados recebe projeções, nunca o JSON
 *  cru (a lição da F70). Devolver `settings` a todas as telas de administração para
 *  uma delas precisar de um campo seria abrir a caixa inteira para uma pergunta.
 *
 *  Então esta leitura busca só o que a tela da API precisa — identidade mínima do
 *  evento e a configuração, passada pelo leitor TOLERANTE — e devolve erro como
 *  valor, como todo serviço desta casa. A AUTORIZAÇÃO não mora aqui: a página chama
 *  `requirePagePermission` e as actions chamam `guardAction`, como manda a fatia 2.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { errorMessage } from '@/lib/db/prisma-errors';
import { withTenant } from '@/lib/db/tenant-client';
import {
  readEventApiConfig,
  type EventApiStoredConfig,
} from '@/domain/api/event-api-key-rules';
import {
  readEventApiKeyState,
  type EventApiKeyState,
} from '@/domain/api/event-api-organizer-rules';

export interface EventApiOrganizerEvent {
  id: string;
  slug: string;
  title: string;
  status: string;
  timezone: string;
}

export interface EventApiOrganizerState {
  event: EventApiOrganizerEvent;
  /** O estado que a tela mostra (e que o selo do cartão repete). */
  state: EventApiKeyState;
  /** A configuração BEM FORMADA; `null` quando não há (ou está torta). */
  config: EventApiStoredConfig | null;
  /** Por que a configuração foi recusada — a tela mostra, o log também. */
  problems: readonly string[];
}

export type EventApiOrganizerStateResult =
  | { ok: true; data: EventApiOrganizerState }
  | { ok: false; code: 'NOT_FOUND' | 'READ_FAILED'; message: string };

export async function getEventApiOrganizerState(input: {
  tenantId: string;
  eventId: string;
}): Promise<EventApiOrganizerStateResult> {
  try {
    const event = await withTenant(input.tenantId, (tx) =>
      tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, slug: true, title: true, status: true, timezone: true, settings: true },
      }),
    );

    if (!event) {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
    }

    const read = readEventApiConfig(event.settings);

    return {
      ok: true,
      data: {
        event: {
          id: event.id,
          slug: event.slug,
          title: event.title,
          status: event.status,
          timezone: event.timezone,
        },
        state: readEventApiKeyState(read),
        config: read.config,
        problems: read.problems,
      },
    };
  } catch (error) {
    console.error(`[api] falha ao ler a configuração da API do evento: ${errorMessage(error)}`);

    return {
      ok: false,
      code: 'READ_FAILED',
      message: 'Não foi possível ler a configuração da API agora.',
    };
  }
}
