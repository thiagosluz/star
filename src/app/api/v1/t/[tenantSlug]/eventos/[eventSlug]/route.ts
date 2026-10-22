/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  API PÚBLICA POR EVENTO — o evento (FASE 72 · fatia 2)
 *
 *  `GET /api/v1/t/<slug>/eventos/<eventSlug>`
 *
 *  Somente leitura, chave do EVENTO em `Authorization: Bearer <chave>`, envelope
 *  `{ data, meta }`, ETag/304 e CORS aberto. A sequência inteira mora em
 *  `@/lib/api/event-api-route-handlers` — aqui só se declara qual recurso esta
 *  rota serve. A projeção é a MESMA da página pública (fatia 1); a rota não tem
 *  consulta própria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createEventApiRouteHandlers } from '@/lib/api/event-api-route-handlers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const handlers = createEventApiRouteHandlers('evento');

export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
export const OPTIONS = handlers.OPTIONS;

/** A API é somente leitura: qualquer outro método responde 405 com `Allow`. */
export const POST = handlers.METHOD_NOT_ALLOWED;
export const PUT = handlers.METHOD_NOT_ALLOWED;
export const PATCH = handlers.METHOD_NOT_ALLOWED;
export const DELETE = handlers.METHOD_NOT_ALLOWED;
