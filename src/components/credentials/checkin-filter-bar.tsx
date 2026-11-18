'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IdCard, QrCode, ScanLine, X } from 'lucide-react';

import { AppLink } from '@/components/ui/app-link';
import { Badge } from '@/components/ui';
import { GetSearchForm } from '@/components/ui/get-search-form';
import { startNavigationProgress } from '@/components/ui/navigation-progress-bar';
import {
  buildCheckinHref,
  type CheckinQueueStatusFilter,
  type CheckinTab,
} from '@/domain/events/checkin-console-rules';
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
  activeTab = 'balcao',
}: {
  tenantSlug: string;
  events: readonly CheckinEventItem[];
  selectedEventId?: string | null;
  canManageBadges?: boolean;
  activeTab?: CheckinTab;
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
    <GetSearchForm className="flex flex-wrap items-end justify-between gap-3" data-testid="checkin-filters">
      <div className="flex flex-wrap items-end gap-3">
        {activeTab === 'autocredenciamento' ? (
          <input type="hidden" name="aba" value="autocredenciamento" />
        ) : null}

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

        {/* Visível somente sem JS ativo; com JS a seleção acima troca imediatamente */}
        <button
          type="submit"
          className="hidden [@media(scripting:none)]:inline-flex rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
        >
          Trocar de evento
        </button>
      </div>

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

export function CheckinTabBar({
  tenantSlug,
  eventId,
  activeTab,
  selfCheckinEnabled,
  activePointsCount,
}: {
  tenantSlug: string;
  eventId: string;
  activeTab: CheckinTab;
  selfCheckinEnabled: boolean;
  activePointsCount: number;
}) {
  const balcaoHref = buildCheckinHref({ tenantSlug, eventId, tab: 'balcao' });
  const selfHref = buildCheckinHref({ tenantSlug, eventId, tab: 'autocredenciamento' });

  return (
    <nav
      aria-label="Áreas do balcão"
      className="flex flex-wrap items-center gap-2 border-b border-border pb-3"
      data-testid="checkin-tabs"
    >
      <AppLink
        href={balcaoHref}
        data-testid="checkin-tab-balcao"
        aria-current={activeTab === 'balcao' ? 'page' : undefined}
        className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition ${
          activeTab === 'balcao'
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <ScanLine className="size-4" aria-hidden />
        Balcão ao vivo
      </AppLink>

      <AppLink
        href={selfHref}
        data-testid="checkin-tab-autocredenciamento"
        aria-current={activeTab === 'autocredenciamento' ? 'page' : undefined}
        className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition ${
          activeTab === 'autocredenciamento'
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <QrCode className="size-4" aria-hidden />
        Autocredenciamento &amp; Cartazes
        <Badge tone={selfCheckinEnabled ? 'success' : 'neutral'}>
          {selfCheckinEnabled
            ? activePointsCount > 0
              ? `${activePointsCount} ativo(s)`
              : 'Ativo'
            : 'Desativado'}
        </Badge>
      </AppLink>
    </nav>
  );
}

export function CheckinSearchFilter({
  tenantSlug,
  selectedEventId,
  initialQuery = '',
  statusFilter = 'all',
}: {
  tenantSlug: string;
  selectedEventId?: string | null;
  initialQuery?: string;
  statusFilter?: CheckinQueueStatusFilter;
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

  const statusOptions: ReadonlyArray<{ id: CheckinQueueStatusFilter; label: string }> = [
    { id: 'all', label: 'Todos' },
    { id: 'pending', label: 'Aguardando entrada' },
    { id: 'inside', label: 'Presentes agora' },
  ];

  return (
    <div className="space-y-2.5">
      <form
        method="get"
        onSubmit={(e) => {
          e.preventDefault();
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          applyFilter(query);
        }}
        className="flex flex-wrap items-end gap-2"
        data-testid="checkin-search-form"
      >
        <input type="hidden" name="evento" value={selectedEventId ?? ''} />
        {statusFilter !== 'all' ? <input type="hidden" name="situacao" value={statusFilter} /> : null}
        <label className="min-w-0 flex-1 space-y-1 text-xs font-medium">
          Buscar
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              name="q"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="nome, e-mail ou crachá (/)"
              className={`block w-full rounded-md border border-border bg-background px-3 py-2 text-sm ${query || isPending ? 'pr-10' : ''}`}
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
          className="sr-only [@media(scripting:none)]:not-sr-only [@media(scripting:none)]:inline-flex rounded-md border border-border px-3 py-2 text-sm font-medium transition hover:bg-muted"
        >
          Buscar
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar situação na fila">
        {statusOptions.map((opt) => (
          <AppLink
            key={opt.id}
            href={buildCheckinHref({
              tenantSlug,
              eventId: selectedEventId,
              tab: 'balcao',
              query,
              status: opt.id,
            })}
            data-testid={`checkin-status-${opt.id}`}
            aria-current={statusFilter === opt.id ? 'true' : undefined}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              statusFilter === opt.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {opt.label}
          </AppLink>
        ))}
      </div>
    </div>
  );
}
