/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — o HTTP da API pública por evento (FASE 72 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE É CONTRATO AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • o `ETag` é derivado do CONTEÚDO CANÔNICO do `data`, NUNCA do envelope
 *    inteiro. O `meta.generatedAt` muda a cada requisição; se ele entrasse no
 *    hash, o `304` nunca aconteceria — e o requisito de cache da fase viraria
 *    decoração. O `meta.etag` que aparece no corpo é o mesmo valor do cabeçalho.
 *  • `Cache-Control: public, max-age=60` nas respostas de leitura (200/304).
 *    Como a leitura é protegida por chave, o `Vary: Authorization` acompanha: um
 *    cache COMPARTILHADO não pode servir o corpo chaveado a uma requisição que
 *    não apresentou a chave. `public` é a decisão do humano; `Vary` impede que
 *    ela vire bypass.
 *  • erro é `{ code, message }`, o envelope da casa, com `Cache-Control:
 *    no-store`: recusa não se guarda em cache.
 *  • CORS `*` em TODAS as respostas, inclusive erro — o site externo precisa
 *    LER a resposta 401/429 para mostrar o motivo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';

import {
  buildApiEnvelope,
  orderApiData,
  toApiJson,
  type ApiResource,
} from '@/domain/api/public-api-contract';

/** O teto de taxa: 120 requisições por minuto por IP (ver o handler). */
export const EVENT_API_RATE_LIMIT = { window: 60, max: 120 } as const;

export const EVENT_API_ALLOW = 'GET, HEAD, OPTIONS';

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag, Retry-After, Allow',
};

/** `Vary: Authorization` — ver o cabeçalho (cache compartilhado × chave). */
const VARY = 'Authorization';

function baseHeaders(): Headers {
  const headers = new Headers(CORS_HEADERS);
  headers.set('Vary', VARY);

  return headers;
}

export interface EventApiErrorBody {
  code: string;
  message: string;
}

export function eventApiErrorBody(code: string, message: string): EventApiErrorBody {
  return { code, message };
}

/**
 * O `ETag` do `data` canônico.
 *
 * 32 hexadecimais (128 bits) bastam para um `ETag` — colisão aqui só faria um
 * cliente receber `304` de um conteúdo diferente, e a probabilidade é a mesma de
 * um SHA-256 truncado para 128 bits. A ordem vem de `orderApiData`, a MESMA do
 * corpo; é por isso que duas respostas com os mesmos valores têm o mesmo selo.
 */
export function computeEventApiEtag(resource: ApiResource, data: unknown): string {
  const canonical = JSON.stringify(orderApiData(resource, toApiJson(data)));

  return `"${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32)}"`;
}

/**
 * `If-None-Match` segundo a RFC 9110: lista separada por vírgula, `*`, e o
 * prefixo de fraqueza `W/` que o cliente pode mandar mesmo para um selo forte.
 */
export function ifNoneMatchMatches(header: string | null, etag: string): boolean {
  if (!header) return false;

  return header.split(',').some((part) => {
    const candidate = part.trim();

    return candidate === '*' || candidate === etag || candidate === `W/${etag}`;
  });
}

/** Resposta sem corpo quando o método é `HEAD` (o cabeçalho ainda é o de GET). */
function respond(
  request: Request,
  status: number,
  body: string | null,
  headers: Headers,
): Response {
  if (request.method.toUpperCase() === 'HEAD') {
    if (body !== null) {
      headers.set('Content-Length', String(new TextEncoder().encode(body).length));
    }

    return new Response(null, { status, headers });
  }

  return new Response(body, { status, headers });
}

/** O 200/304 com o envelope da casa, a ordem canônica e o ETag. */
export function eventApiSuccessResponse(input: {
  request: Request;
  resource: ApiResource;
  data: unknown;
  generatedAt: Date;
}): Response {
  const etag = computeEventApiEtag(input.resource, input.data);

  const headers = baseHeaders();
  headers.set('Cache-Control', 'public, max-age=60');
  headers.set('ETag', etag);
  headers.set('X-Content-Type-Options', 'nosniff');

  if (ifNoneMatchMatches(input.request.headers.get('if-none-match'), etag)) {
    /** 304 sem corpo — nem `Content-Type`, nem `Content-Length`. */
    headers.delete('X-Content-Type-Options');
    headers.delete('Content-Type');

    return respond(input.request, 304, null, headers);
  }

  const envelope = buildApiEnvelope({
    resource: input.resource,
    data: input.data,
    generatedAt: input.generatedAt,
    etag,
  });

  headers.set('Content-Type', 'application/json; charset=utf-8');

  return respond(input.request, 200, JSON.stringify(envelope), headers);
}

/** A resposta de erro: envelope `{ code, message }`, `no-store`, CORS. */
export function eventApiErrorResponse(input: {
  request: Request;
  status: number;
  code: string;
  message: string;
  extraHeaders?: Record<string, string>;
}): Response {
  const headers = baseHeaders();
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', 'application/json; charset=utf-8');

  for (const [name, value] of Object.entries(input.extraHeaders ?? {})) {
    headers.set(name, value);
  }

  return respond(
    input.request,
    input.status,
    JSON.stringify(eventApiErrorBody(input.code, input.message)),
    headers,
  );
}

/** O preflight: libera o site externo a mandar `Authorization` e `If-None-Match`. */
export function eventApiPreflightResponse(): Response {
  const headers = new Headers(CORS_HEADERS);
  headers.set('Allow', EVENT_API_ALLOW);
  headers.set('Access-Control-Allow-Methods', EVENT_API_ALLOW);
  headers.set('Access-Control-Allow-Headers', 'Authorization, If-None-Match, Content-Type');
  headers.set('Access-Control-Max-Age', '600');
  headers.set('Cache-Control', 'public, max-age=600');

  return new Response(null, { status: 204, headers });
}
