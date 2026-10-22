/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — A leitura que alimenta a API pública do evento (FASE 72 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE SERVIÇO NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele não conhece Prisma, `withTenant`, SQL nem a forma das tabelas. A leitura é
 *  a MESMA da página pública (`getPublicEventView`) e a das chamadas é a MESMA do
 *  bloco público (`listPublicCalls`). Se um dia alguém precisar de um campo que a
 *  página não tem, o caminho é EXTRAIR a projeção — nunca abrir uma consulta só
 *  para a API, que seria o segundo caminho para o banco e o primeiro vazamento.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VISÃO É ANÔNIMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A API por evento não tem sessão de participante: ela é lida por um site
 *  externo com a chave do evento. `userId: null` faz `getPublicEventView` aplicar
 *  a régua da F68 como o visitante anônimo — o endereço da sala chega `null` à
 *  projeção. Mesmo que a projeção por recurso esquecesse de omiti-lo, o valor já
 *  não estaria lá; e a lista fechada reprova a resposta se ele aparecer.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ERRO COMO VALOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O serviço devolve `{ ok: false, code, message }`; não lança para o chamador. A
 *  rota da fatia 2 traduz `NOT_FOUND` em 404 (sem revelar rascunho) e `INTERNAL`
 *  em 500 com o envelope de erro da casa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  API_RESOURCES,
  assertApiProjectionSemCampoProibido,
} from '@/domain/api/public-api-contract';
import { errorMessage } from '@/lib/db/prisma-errors';
import type { TenantContext } from '@/lib/events/event-repository';
import { getPublicEventView } from '@/lib/events/public-event-view';
import { listPublicCalls } from '@/lib/proposals/call-service';
import {
  projectApiAtividades,
  projectApiChamadas,
  projectApiEvento,
  projectApiPalestrantes,
  projectApiPatrocinadores,
  type ApiAtividade,
  type ApiChamada,
  type ApiEvento,
  type ApiPalestrante,
  type ApiPatrocinador,
} from '@/lib/api/event-api-projection';

/** O mínimo da instituição que a resposta do evento carrega (identidade pública). */
export type EventApiTenant = Pick<TenantContext, 'tenantId' | 'slug' | 'name'>;

export interface EventApiProjections {
  evento: ApiEvento;
  atividades: ApiAtividade[];
  palestrantes: ApiPalestrante[];
  patrocinadores: ApiPatrocinador[];
  chamadas: ApiChamada[];
}

export type EventApiErrorCode = 'NOT_FOUND' | 'INTERNAL';

export type EventApiResult =
  | {
      ok: true;
      /** O MESMO instante usado para derivar `status`/`registrationOpen`. */
      generatedAt: Date;
      projections: EventApiProjections;
    }
  | {
      ok: false;
      code: EventApiErrorCode;
      message: string;
    };

/**
 * Monta as cinco projeções do evento.
 *
 * `generatedAt` entra por parâmetro (nada de relógio no domínio/serviço de leitura
 * pura): a fatia 2 passa o instante da requisição e o usa também no `meta` e no
 * `ETag`, para a resposta ser reprodutível.
 */
export async function loadEventApiProjections(input: {
  tenant: EventApiTenant;
  eventSlug: string;
  generatedAt: Date;
}): Promise<EventApiResult> {
  try {
    const view = await getPublicEventView({
      tenantId: input.tenant.tenantId,
      eventSlug: input.eventSlug,
      userId: null,
      now: input.generatedAt,
    });

    /**
     * `null` cobre "não existe" e "não está publicado" — a MESMA resposta, como na
     * página. Distinguir os dois revelaria a existência de um rascunho.
     */
    if (!view) {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
    }

    const calls = await listPublicCalls({
      tenantId: input.tenant.tenantId,
      eventId: view.event.id,
      now: input.generatedAt,
    });

    if (!calls.ok) {
      return {
        ok: false,
        code: 'INTERNAL',
        message: 'Não foi possível ler as chamadas do evento.',
      };
    }

    const projections: EventApiProjections = {
      evento: projectApiEvento({
        event: view.event,
        tenant: { slug: input.tenant.slug, name: input.tenant.name },
        now: input.generatedAt,
      }),
      atividades: projectApiAtividades(view.event),
      palestrantes: projectApiPalestrantes(view.event),
      patrocinadores: projectApiPatrocinadores(view.event),
      chamadas: projectApiChamadas({
        calls: calls.calls,
        tenantSlug: input.tenant.slug,
        eventSlug: view.event.slug,
      }),
    };

    /**
     * A segunda barreira. O envelope (`buildApiEnvelope`) também confere, mas a
     * rota da fatia 2 pode serializar `projections` diretamente; conferir AQUI
     * garante que o campo proibido não sai nem por esse caminho — a leitura é
     * recusada inteira, não filtrada.
     */
    for (const resource of API_RESOURCES) {
      assertApiProjectionSemCampoProibido(resource, projections[resource]);
    }

    return { ok: true, generatedAt: input.generatedAt, projections };
  } catch (error) {
    /**
     * O `errorMessage` NÃO vai para a resposta: ele pode conter o nome do campo
     * proibido (e o caminho dele), que é informação de diagnóstico, não de API. O
     * log guarda a causa; o cliente recebe a resposta genérica.
     */
    console.error(`[api] falha ao projetar o evento público: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível ler o evento.' };
  }
}
