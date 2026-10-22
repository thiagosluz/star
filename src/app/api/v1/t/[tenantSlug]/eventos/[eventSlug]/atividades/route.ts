/**
 * API pública por evento — a PROGRAMAÇÃO (FASE 72 · fatia 2).
 *
 * `GET /api/v1/t/<slug>/eventos/<eventSlug>/atividades`
 *
 * Sempre disponível para quem tem a chave do evento: `atividades` NÃO tem
 * interruptor por seção nesta fatia (decisão do humano — torná-lo interruptável
 * é uma pergunta, não um commit).
 */
import { createEventApiRouteHandlers } from '@/lib/api/event-api-route-handlers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const handlers = createEventApiRouteHandlers('atividades');

export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
export const OPTIONS = handlers.OPTIONS;

export const POST = handlers.METHOD_NOT_ALLOWED;
export const PUT = handlers.METHOD_NOT_ALLOWED;
export const PATCH = handlers.METHOD_NOT_ALLOWED;
export const DELETE = handlers.METHOD_NOT_ALLOWED;
