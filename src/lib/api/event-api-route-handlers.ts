/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — os handlers das cinco rotas de leitura da API por evento
 *                                                          (FASE 72 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UMA SEQUÊNCIA, CINCO RECURSOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As cinco rotas (`evento`, `atividades`, `palestrantes`, `patrocinadores`,
 *  `chamadas`) têm a MESMA porta de entrada: método, limite de taxa, chave,
 *  interruptor, projeção única, envelope. Escrever isso cinco vezes seria cinco
 *  lugares para esquecer o `Vary`, o `304` ou o `404` uniforme — e o defeito
 *  apareceria só em uma delas. Aqui a sequência mora em um lugar e os arquivos de
 *  rota são cascas de três linhas.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ORDEM DAS PORTAS (e por que ela é essa)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. `OPTIONS` sai antes de tudo: preflight não consome taxa nem chave.
 *  2. método diferente de GET/HEAD → 405 com `Allow`.
 *  3. limite de taxa por IP — ANTES de qualquer banco. O limitador é a proteção
 *     contra sondagem de chave; deixá-lo depois da consulta seria pagar o custo
 *     que ele existe para evitar.
 *  4. instituição + chave. Instituição inexistente, chave ausente, errada,
 *     revogada ou evento inexistente respondem o MESMO 401: quem sonda não
 *     descobre se o evento existe. O motivo detalhado fica na trilha.
 *  5. seção desligada → 404. Só chega aqui quem tem a chave válida, e o corpo é
 *     o MESMO do evento não publicado: "não existe nesta API".
 *  6. projeção (a MESMA da página) e envelope com ETag.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TETO DE TAXA: 120 POR MINUTO POR IP, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O consumidor é um SITE externo lendo conteúdo que muda devagar; 2 req/s
 *  sustentados cobrem a montagem de várias páginas e um cache local de 60 s. O
 *  teto existe para (a) impedir que uma única origem transforme sondagem de chave
 *  em carga de banco e (b) limitar a enxurrada de linhas de trilha que cada recusa
 *  grava. 120/min é baixo o bastante para o segundo objetivo e alto o bastante
 *  para não punir um site legítimo que abre cinco recursos a cada visita.
 *
 *  O excesso responde 429 com `Retry-After` (o TTL da janela do Redis, em
 *  segundos). Sem Redis, o limitador da F13 FALHA ABERTO e registra a métrica —
 *  a proteção é mitigação, não autorização (ver `rate-limit-storage.ts`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  isEventApiSectionEnabled,
  type EventApiSection,
} from '@/domain/api/event-api-key-rules';
import type { ApiResource } from '@/domain/api/public-api-contract';
import {
  createRedisRateLimitStorage,
  type RateLimitStorage,
} from '@/lib/auth/rate-limit-storage';
import { errorMessage } from '@/lib/db/prisma-errors';
import { getTenantContext } from '@/lib/events/event-repository';
import { loadEventApiProjections } from '@/lib/api/event-api-service';
import { extractBearerKey } from '@/lib/api/event-api-key-vault';
import { verifyEventApiKey } from '@/lib/api/event-api-key-service';
import {
  EVENT_API_ALLOW,
  EVENT_API_RATE_LIMIT,
  eventApiErrorResponse,
  eventApiPreflightResponse,
  eventApiSuccessResponse,
} from '@/lib/api/event-api-http';

export interface EventApiRouteContext {
  params: Promise<{ tenantSlug: string; eventSlug: string }>;
}

export type EventApiRouteHandler = (
  request: Request,
  context: EventApiRouteContext,
) => Promise<Response>;

export interface EventApiRouteDeps {
  /** Injetável nos testes do `429`: não precisa de Redis para provar o teto. */
  rateLimit?: RateLimitStorage;
  /** Injetável para um teste determinístico de `generatedAt`. */
  now?: () => Date;
}

export interface EventApiRouteHandlers {
  GET: EventApiRouteHandler;
  HEAD: EventApiRouteHandler;
  OPTIONS: EventApiRouteHandler;
  /** O 405 das rotas: o mesmo handler é exportado como POST/PUT/PATCH/DELETE. */
  METHOD_NOT_ALLOWED: EventApiRouteHandler;
}

/** Seções com interruptor — `evento` e `atividades` NÃO são interruptáveis. */
function togglableSection(resource: ApiResource): resource is EventApiSection {
  return resource === 'palestrantes' || resource === 'patrocinadores' || resource === 'chamadas';
}

/**
 * IP do cliente para o limite de taxa.
 *
 * O `x-forwarded-for` é a convenção do Proxy/ingress; o primeiro valor é o
 * cliente original. Sem nenhum cabeçalho, `desconhecido` compartilha o balde —
 * o que é fail-closed: prefiro limitar todos juntos a deixar todo mundo sem
 * limite por falta de cabeçalho.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();

  if (forwarded) return forwarded;

  return request.headers.get('x-real-ip')?.trim() || 'desconhecido';
}

const NOT_FOUND_CODE = 'NOT_FOUND';
const NOT_FOUND_MESSAGE = 'Recurso não encontrado.';

export function createEventApiRouteHandlers(
  resource: ApiResource,
  deps: EventApiRouteDeps = {},
): EventApiRouteHandlers {
  const rateLimit = deps.rateLimit ?? createRedisRateLimitStorage({ prefix: 'ef:rl:event-api:' });
  const now = deps.now ?? (() => new Date());

  const methodNotAllowed: EventApiRouteHandler = async (request) =>
    eventApiErrorResponse({
      request,
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
      message: 'Método não permitido. Esta API é somente leitura.',
      extraHeaders: { Allow: EVENT_API_ALLOW },
    });

  const options: EventApiRouteHandler = async () => eventApiPreflightResponse();

  /**
   * O 401 é UM só, com dois motivos observáveis: "não mandou" e "não vale".
   * Instituição inexistente, evento inexistente, rascunho sem chave, chave
   * revogada e chave errada respondem exatamente o mesmo corpo de "não vale".
   */
  const unauthorized = (
    request: Request,
    code: 'MISSING_API_KEY' | 'INVALID_API_KEY',
  ): Response =>
    eventApiErrorResponse({
      request,
      status: 401,
      code,
      message:
        code === 'MISSING_API_KEY'
          ? 'Informe a chave do evento no cabeçalho Authorization: Bearer <chave>.'
          : 'Chave de acesso inválida ou revogada.',
      extraHeaders: { 'WWW-Authenticate': 'Bearer' },
    });

  const read: EventApiRouteHandler = async (request, context) => {
    try {
      const { tenantSlug, eventSlug } = await context.params;
      const ipAddress = clientIp(request);

      const decision = await rateLimit.consume(`ip:${ipAddress}`, EVENT_API_RATE_LIMIT);

      if (!decision.allowed) {
        return eventApiErrorResponse({
          request,
          status: 429,
          code: 'RATE_LIMITED',
          message: 'Muitas requisições. Tente de novo em instantes.',
          extraHeaders: {
            'Retry-After': String(decision.retryAfter ?? 1),
            'Access-Control-Expose-Headers': 'ETag, Retry-After, Allow',
          },
        });
      }

      const presentedKey = extractBearerKey(request.headers.get('authorization'));

      const tenant = await getTenantContext(tenantSlug);

      /**
       * Instituição inexistente NÃO é 404: é o mesmo 401 da chave. O contrário
       * revelaria, pela porta dos fundos, que aquele slug de instituição existe.
       * O código acompanha o que a REQUISIÇÃO trouxe (sem chave × chave
       * apresentada), nunca o que o banco sabe.
       */
      if (!tenant) {
        return unauthorized(request, presentedKey ? 'INVALID_API_KEY' : 'MISSING_API_KEY');
      }

      const auth = await verifyEventApiKey({
        tenantId: tenant.tenantId,
        eventSlug,
        presentedKey,
        ipAddress,
        userAgent: request.headers.get('user-agent'),
      });

      if (!auth.ok) {
        return unauthorized(request, presentedKey ? 'INVALID_API_KEY' : 'MISSING_API_KEY');
      }

      /** Seção desligada responde como se não existisse NAQUELA API. */
      if (togglableSection(resource) && !isEventApiSectionEnabled(auth.config, resource)) {
        return eventApiErrorResponse({
          request,
          status: 404,
          code: NOT_FOUND_CODE,
          message: NOT_FOUND_MESSAGE,
        });
      }

      const generatedAt = now();

      const projections = await loadEventApiProjections({
        tenant: { tenantId: tenant.tenantId, slug: tenant.slug, name: tenant.name },
        eventSlug,
        generatedAt,
      });

      if (!projections.ok) {
        /**
         * `NOT_FOUND` cobre inexistente e não publicado — o MESMO corpo, e por
         * isso o corpo é montado aqui, não herdado da mensagem do serviço.
         */
        if (projections.code === 'NOT_FOUND') {
          return eventApiErrorResponse({
            request,
            status: 404,
            code: NOT_FOUND_CODE,
            message: NOT_FOUND_MESSAGE,
          });
        }

        return eventApiErrorResponse({
          request,
          status: 500,
          code: 'INTERNAL',
          message: 'Não foi possível ler o evento.',
        });
      }

      return eventApiSuccessResponse({
        request,
        resource,
        data: projections.projections[resource],
        generatedAt: projections.generatedAt,
      });
    } catch (error) {
      /**
       * Fail-closed: qualquer exceção não prevista (inclusive `ApiContractError`
       * de um campo fora da ordem canônica) vira 500 genérico. O log guarda a
       * causa; a resposta não vaza diagnóstico.
       */
      console.error(`[api] falha na leitura pública de "${resource}": ${errorMessage(error)}`);

      return eventApiErrorResponse({
        request,
        status: 500,
        code: 'INTERNAL',
        message: 'Não foi possível ler o evento.',
      });
    }
  };

  return {
    GET: read,
    HEAD: read,
    OPTIONS: options,
    METHOD_NOT_ALLOWED: methodNotAllowed,
  };
}
