/**
 * API pública por evento — PALESTRANTES (FASE 72 · fatia 2).
 *
 * `GET /api/v1/t/<slug>/eventos/<eventSlug>/palestrantes`
 *
 * Seção com interruptor: `settings.api.secoes.palestrantes === true` é o único
 * valor que a expõe; ausente/falso responde 404 como se a seção não existisse.
 */
import { createEventApiRouteHandlers } from '@/lib/api/event-api-route-handlers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const handlers = createEventApiRouteHandlers('palestrantes');

export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
export const OPTIONS = handlers.OPTIONS;

export const POST = handlers.METHOD_NOT_ALLOWED;
export const PUT = handlers.METHOD_NOT_ALLOWED;
export const PATCH = handlers.METHOD_NOT_ALLOWED;
export const DELETE = handlers.METHOD_NOT_ALLOWED;
