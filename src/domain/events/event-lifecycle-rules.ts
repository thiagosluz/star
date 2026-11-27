/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — CICLO DE VIDA DO ACERVO DE EVENTOS (FASE 128)
 *
 *  Regras puras (sem Prisma nem Next) para:
 *    1. Tradução dos estados do evento e filtros do acervo (`todos|ativos|arquivados`);
 *    2. Clonagem segura de dados estruturais básicos (descartando segredos em `settings.api`);
 *    3. Guarda de exclusão segura por palavra-chave (`EXCLUIR`) + senha e geração de
 *       slug de liberação ao excluir logicamente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { EventStatus } from '@/domain/events/event-rules';
import { asRecord } from '@/domain/shared/json-record';

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicado',
  REGISTRATION_OPEN: 'Inscrições abertas',
  REGISTRATION_CLOSED: 'Inscrições encerradas',
  IN_PROGRESS: 'Em andamento',
  FINISHED: 'Encerrado',
  CANCELED: 'Cancelado',
  ARCHIVED: 'Arquivado',
};

export function eventStatusLabel(status: string): string {
  return EVENT_STATUS_LABELS[status as EventStatus] ?? status;
}

export const EVENT_ARCHIVE_FILTERS = ['todos', 'ativos', 'arquivados'] as const;

export type EventArchiveFilter = (typeof EVENT_ARCHIVE_FILTERS)[number];

export const EVENT_ARCHIVE_FILTER_LABELS: Record<EventArchiveFilter, string> = {
  todos: 'Todos',
  ativos: 'Ativos',
  arquivados: 'Arquivados',
};

const VALID_FILTERS = new Set<string>(EVENT_ARCHIVE_FILTERS);

export function resolveEventArchiveFilter(raw?: string | null): EventArchiveFilter {
  const normalized = (raw ?? '').trim().toLowerCase();
  return VALID_FILTERS.has(normalized) ? (normalized as EventArchiveFilter) : 'todos';
}

export function buildAdminEventsHref(baseHref: string, filter: EventArchiveFilter): string {
  if (filter === 'todos') return baseHref;
  const params = new URLSearchParams();
  params.set('situacao', filter);
  return `${baseHref}?${params.toString()}`;
}

export function filterEventsByArchive<T extends { status: string }>(
  events: readonly T[],
  filter: EventArchiveFilter,
): T[] {
  if (filter === 'ativos') {
    return events.filter((event) => event.status !== 'ARCHIVED');
  }
  if (filter === 'arquivados') {
    return events.filter((event) => event.status === 'ARCHIVED');
  }
  return [...events];
}

export function canArchiveEvent(status: string): boolean {
  return status !== 'ARCHIVED';
}

export function canRestoreArchivedEvent(status: string): boolean {
  return status === 'ARCHIVED';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Clonagem de dados básicos
// ───────────────────────────────────────────────────────────────────────────────
const SAFE_CLONE_SETTINGS_KEYS = [
  'registrationRequiresMembership',
  'registrationForm',
  'certificatePolicy',
] as const;

/**
 * Copia apenas as chaves estruturais seguras de `Event.settings`.
 *
 * `settings.api` (chave selada, hash e metadados da API do evento) é descartada
 * propositalmente para que uma nova edição nunca herde credenciais externas nem
 * estado de revogação do evento original.
 */
export function sanitizeClonedSettings(rawSettings: unknown): Record<string, unknown> {
  const source = asRecord(rawSettings);
  const clean: Record<string, unknown> = {};

  for (const key of SAFE_CLONE_SETTINGS_KEYS) {
    if (source[key] !== undefined) {
      clean[key] = source[key];
    }
  }

  return clean;
}

const SLUG_SUFFIX_COPY = '-copia';
const MAX_EVENT_SLUG_LENGTH = 63;
const MAX_EVENT_TITLE_LENGTH = 200;

export function buildClonedEventDefaults(input: {
  title: string;
  slug: string;
  startsAt: Date;
  endsAt: Date;
}): {
  title: string;
  slug: string;
  startsAt: Date;
  endsAt: Date;
} {
  const suffixTitle = ' (Cópia)';
  const baseTitle = input.title.trim();
  const truncatedTitle =
    baseTitle.length + suffixTitle.length > MAX_EVENT_TITLE_LENGTH
      ? `${baseTitle.slice(0, MAX_EVENT_TITLE_LENGTH - suffixTitle.length).trim()}${suffixTitle}`
      : `${baseTitle}${suffixTitle}`;

  const normalizedSlug = input.slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const maxSlugPrefix = MAX_EVENT_SLUG_LENGTH - SLUG_SUFFIX_COPY.length;
  const slugPrefix = (normalizedSlug || 'evento').slice(0, maxSlugPrefix).replace(/-+$/g, '');
  const clonedSlug = `${slugPrefix || 'evento'}${SLUG_SUFFIX_COPY}`;

  const durationMs = Math.max(3_600_000, input.endsAt.getTime() - input.startsAt.getTime());
  const startsAt = new Date(input.startsAt.getTime());
  const endsAt = new Date(startsAt.getTime() + durationMs);

  return {
    title: truncatedTitle,
    slug: clonedSlug,
    startsAt,
    endsAt,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Exclusão segura (palavra-chave + senha)
// ───────────────────────────────────────────────────────────────────────────────
export const EVENT_DELETE_CONFIRMATION_WORD = 'EXCLUIR';

export type EventDeletionGuardDecision =
  | { ok: true }
  | {
      ok: false;
      code: 'INVALID_CONFIRMATION_WORD' | 'PASSWORD_REQUIRED';
      message: string;
    };

export function evaluateEventDeletionGuard(input: {
  confirmationWord: string;
  currentPassword: string;
}): EventDeletionGuardDecision {
  const normalizedWord = input.confirmationWord.trim().toUpperCase();
  if (normalizedWord !== EVENT_DELETE_CONFIRMATION_WORD) {
    return {
      ok: false,
      code: 'INVALID_CONFIRMATION_WORD',
      message: `Digite "${EVENT_DELETE_CONFIRMATION_WORD}" para confirmar a exclusão do evento.`,
    };
  }

  if (input.currentPassword.length === 0) {
    return {
      ok: false,
      code: 'PASSWORD_REQUIRED',
      message: 'Informe sua senha atual para confirmar a exclusão.',
    };
  }

  return { ok: true };
}

/**
 * Gera um identificador técnico ao excluir logicamente o evento para que o slug
 * original fique livre caso a instituição cadastre uma nova edição com o mesmo URL.
 */
export function buildDeletedEventSlug(slug: string, eventId: string): string {
  const shortId = eventId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'removed';
  const cleanPrefix = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44)
    .replace(/-+$/g, '');
  return `${cleanPrefix || 'evento'}-del-${shortId}`;
}
