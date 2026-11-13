'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IdCard, X } from 'lucide-react';

import { AppLink } from '@/components/ui/app-link';
import { GetSearchForm } from '@/components/ui/get-search-form';
import { startNavigationProgress } from '@/components/ui/navigation-progress-bar';
import { tenantPath } from '@/domain/tenancy/resolution';

export interface CheckinEventItem {
  id: string;
  title: string;
  startsAt: Date;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FILTROS DE CREDENCIAMENTO — OPERAÇÃO REATIVA NO BALCÃO (FASE 102 · ADR-428)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE AUTO-SUBMIT COM TRANSIÇÃO E ATALHOS DE TECLADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No balcão de evento com centenas de participantes na fila, exigir que o
 *  operador selecione o evento no select e clique em "Trocar de evento", ou
 *  digite na busca e clique em "Buscar", adiciona atrito operacional contínuo.
 *
 *  Estes componentes implementam:
 *    • Troca instantânea de evento com `useTransition` e preservação de rota;
 *    • Busca por nome/e-mail com debounce de 300ms e atalho `/` + `Escape`;
 *    • Idempotência de URL para não disparar animações nem tráfego redundante;
 *    • Preservação dos botões e atributos `<form method="get">` nativos para
 *      garantir funcionamento perfeito sem JavaScript (`javaScriptEnabled: false`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function CheckinEventFilter({
  tenantSlug,
  events,
  selectedEventId,
  canManageBadges,
}: {
  tenantSlug: string;
  events: readonly CheckinEventItem[];
  selectedEventId?: string | null;
  canManageBadges?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function handleEventChange(nextEventId: string) {
    if (nextEventId === selectedEventId) return;

    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (nextEventId) {
      params.set('evento', nextEventId);
    } else {
      params.delete('evento');
    }

    const qs = params.toString();
    const targetUrl = `${tenantPath(tenantSlug, '/credenciamento')}${qs ? `?${qs}` : ''}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (targetUrl === currentUrl) return;

    startNavigationProgress();
    startTransition(() => {
      router.push(targetUrl);
    });
  }

  return (
    <GetSearchForm className="flex flex-wrap items-end gap-3" data-testid="checkin-filters">
      <label className="space-y-1 text-xs font-medium">
        Evento
        <select
          name="evento"
          defaultValue={selectedEventId ?? ''}
          onChange={(e) => handleEventChange(e.target.value)}
          className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm"
          aria-label="Evento"
          data-testid="checkin-event"
        >
          {events.map((event) => (
            <option key={event.id} value={event.id} suppressHydrationWarning>
              {event.title} · {new Date(event.startsAt).toLocaleDateString('pt-BR')}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
      >
        Trocar de evento
      </button>

      {canManageBadges ? (
        <AppLink
          href={tenantPath(tenantSlug, `/credenciamento/crachas?evento=${selectedEventId ?? ''}`)}
          data-testid="checkin-badges-link"
          className="inline-flex items-center gap-2 rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10"
        >
          <IdCard className="size-4" aria-hidden />
          Crachás: emitir e imprimir
        </AppLink>
      ) : null}
    </GetSearchForm>
  );
}

export function CheckinSearchFilter({
  tenantSlug,
  selectedEventId,
  initialQuery = '',
}: {
  tenantSlug: string;
  selectedEventId?: string | null;
  initialQuery?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);
  const [prevInitialQuery, setPrevInitialQuery] = useState(initialQuery);
  if (prevInitialQuery !== initialQuery) {
    setPrevInitialQuery(initialQuery);
    setQuery(initialQuery);
  }

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef(query);

  useEffect(() => {
    latestQueryRef.current = query;
  }, [query]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const applyFilter = useCallback(
    (nextQuery: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (selectedEventId) {
        params.set('evento', selectedEventId);
      }
      if (nextQuery.trim()) {
        params.set('q', nextQuery.trim());
      } else {
        params.delete('q');
      }

      const qs = params.toString();
      const targetUrl = `${tenantPath(tenantSlug, '/credenciamento')}${qs ? `?${qs}` : ''}`;
      const currentUrl = `${window.location.pathname}${window.location.search}`;

      if (targetUrl === currentUrl) return;

      startNavigationProgress();
      startTransition(() => {
        router.replace(targetUrl, { scroll: false });
      });
    },
    [router, searchParams, selectedEventId, tenantSlug],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const targetEl = e.target as HTMLElement | null;
      const isEditable =
        targetEl?.tagName === 'INPUT' ||
        targetEl?.tagName === 'TEXTAREA' ||
        targetEl?.tagName === 'SELECT' ||
        Boolean(targetEl?.isContentEditable);

      if (e.key === '/' && !isEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        if (latestQueryRef.current.trim().length > 0) {
          e.preventDefault();
          setQuery('');
          latestQueryRef.current = '';
          applyFilter('');
        } else {
          inputRef.current?.blur();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyFilter]);

  function handleInputChange(val: string) {
    setQuery(val);
    latestQueryRef.current = val;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      applyFilter(val);
    }, 300);
  }

  function handleClear() {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setQuery('');
    latestQueryRef.current = '';
    applyFilter('');
    inputRef.current?.focus();
  }

  return (
    <form
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        applyFilter(query);
      }}
      className="flex flex-wrap items-end gap-3"
      data-testid="checkin-search-form"
    >
      <input type="hidden" name="evento" value={selectedEventId ?? ''} />
      <label className="space-y-1 text-xs font-medium">
        Buscar
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            name="q"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="nome, e-mail ou crachá (Pressione / para buscar)"
            className={`block min-w-56 rounded-md border border-border bg-background px-3 py-2 text-sm ${query || isPending ? 'pr-10' : ''}`}
            aria-label="Buscar participante"
            data-testid="checkin-search"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {query.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Limpar busca"
                data-testid="checkin-search-clear"
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
            {isPending && (
              <span
                role="status"
                aria-label="Buscando"
                className="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent"
              />
            )}
          </div>
        </div>
      </label>

      <button
        type="submit"
        className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
      >
        Buscar
      </button>
    </form>
  );
}
