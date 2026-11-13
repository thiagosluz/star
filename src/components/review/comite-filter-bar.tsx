'use client';

import { useCallback, useEffect, useRef, useTransition, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Filter, Loader2, Search, X } from 'lucide-react';

import { tenantPath } from '@/domain/tenancy/resolution';
import { AppLink } from '@/components/ui/app-link';
import { startNavigationProgress } from '@/components/ui';

export interface ComiteFilterBarProps {
  tenantSlug: string;
  events: { id: string; title: string }[];
  initialBusca: string;
  initialEvento: string;
  initialStatus: string;
  hasActiveFilters: boolean;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BARRA DE FILTROS REATIVA DO COMITÊ (FASE 99 · ADR-416 / FASE 100 · ADR-422)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE USETRANSITION + DEBOUNCE COM REFS E TRATAMENTO DE TECLADO ROBUSTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Na FASE 100:
 *    • O debounce na busca lê referências sincronizadas (`latestFiltersRef`) para
 *      impedir que digitação concorrente com troca de select cause closures
 *      desatualizadas ou desfaça seleções;
 *    • A tecla 'Escape' limpa a busca ativa e dispara a transição caso haja texto,
 *      ou libera o foco (blur) se o campo já estiver vazio;
 *    • O atalho '/' não intercepta elementos `contentEditable` além de inputs;
 *    • Dispara `startNavigationProgress()` integrando com a barra global;
 *    • Informa tecnologias assistivas via `aria-live="polite"` durante `isPending`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ComiteFilterBar({
  tenantSlug,
  events,
  initialBusca,
  initialEvento,
  initialStatus,
  hasActiveFilters,
}: ComiteFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [busca, setBusca] = useState(initialBusca);
  const [evento, setEvento] = useState(initialEvento);
  const [status, setStatus] = useState(initialStatus);
  const [hasFiltered, setHasFiltered] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // Mantém refs atualizadas para leitura fresca dentro do timer de debounce
  const latestFiltersRef = useRef({ busca: initialBusca, evento: initialEvento, status: initialStatus });

  useEffect(() => {
    latestFiltersRef.current = { busca, evento, status };
  }, [busca, evento, status]);

  // Sincroniza estado durante o render caso mudem externamente (ex.: clique em StatCard ou URL)
  const [prevProps, setPrevProps] = useState({ initialBusca, initialEvento, initialStatus });
  if (
    prevProps.initialBusca !== initialBusca ||
    prevProps.initialEvento !== initialEvento ||
    prevProps.initialStatus !== initialStatus
  ) {
    setPrevProps({ initialBusca, initialEvento, initialStatus });
    setBusca(initialBusca);
    setEvento(initialEvento);
    setStatus(initialStatus);
  }

  const applyFilters = useCallback(
    (newBusca: string, newEvento: string, newStatus: string) => {
      const params = new URLSearchParams(searchParams.toString());

      if (newBusca.trim()) {
        params.set('busca', newBusca.trim());
      } else {
        params.delete('busca');
      }

      if (newEvento) {
        params.set('evento', newEvento);
      } else {
        params.delete('evento');
      }

      if (newStatus) {
        params.set('status', newStatus);
      } else {
        params.delete('status');
      }

      const query = params.toString();
      const targetUrl = query ? `${pathname}?${query}` : pathname;

      const currentQuery = searchParams.toString();
      const currentUrl = currentQuery ? `${pathname}?${currentQuery}` : pathname;

      // Idempotência (ADR-425): se a URL final for idêntica à atual, não ativa a barra nem transiciona
      if (targetUrl === currentUrl) {
        return;
      }

      setHasFiltered(true);
      startNavigationProgress();
      startTransition(() => {
        router.replace(targetUrl, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  // Atalho de teclado: '/' foca a busca, 'Escape' limpa a busca ou libera o foco
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const activeElement = document.activeElement as HTMLElement | null;
      const isInputOrEditable =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'SELECT' ||
        Boolean(activeElement?.isContentEditable);

      if (e.key === '/' && !isInputOrEditable) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape' && activeElement === searchInputRef.current) {
        if (latestFiltersRef.current.busca.trim().length > 0) {
          e.preventDefault();
          setBusca('');
          latestFiltersRef.current.busca = '';
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          applyFilters('', latestFiltersRef.current.evento, latestFiltersRef.current.status);
        } else {
          searchInputRef.current?.blur();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyFilters]);

  function handleBuscaChange(val: string) {
    setBusca(val);
    latestFiltersRef.current.busca = val;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      applyFilters(val, latestFiltersRef.current.evento, latestFiltersRef.current.status);
    }, 300);
  }

  function handleEventoChange(val: string) {
    setEvento(val);
    latestFiltersRef.current.evento = val;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    applyFilters(latestFiltersRef.current.busca, val, latestFiltersRef.current.status);
  }

  function handleStatusChange(val: string) {
    setStatus(val);
    latestFiltersRef.current.status = val;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    applyFilters(latestFiltersRef.current.busca, latestFiltersRef.current.evento, val);
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <form
        method="GET"
        action={tenantPath(tenantSlug, '/comite')}
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          applyFilters(busca, evento, status);
        }}
      >
        <span className="sr-only" aria-live="polite" data-testid="comite-filter-live">
          {isPending
            ? 'Atualizando submissões do comitê...'
            : hasFiltered
              ? 'Lista de submissões atualizada.'
              : ''}
        </span>

        <div className="grid gap-3 sm:grid-cols-12">
          <div className="sm:col-span-5">
            <label htmlFor="busca" className="sr-only">
              Buscar submissões
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
                aria-hidden
              />
              <input
                ref={searchInputRef}
                id="busca"
                name="busca"
                value={busca}
                onChange={(e) => handleBuscaChange(e.target.value)}
                placeholder="Buscar por título ou protocolo..."
                className="w-full rounded-md border border-input bg-background pl-9 pr-14 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="comite-search-input"
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {busca.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                      setBusca('');
                      latestFiltersRef.current.busca = '';
                      applyFilters('', latestFiltersRef.current.evento, latestFiltersRef.current.status);
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Limpar busca"
                    data-testid="comite-search-clear"
                    className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                ) : null}
                {isPending ? (
                  <Loader2
                    className="pointer-events-none size-4 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                ) : busca.length === 0 ? (
                  <kbd
                    className="pointer-events-none hidden rounded border border-border bg-muted/60 px-1.5 py-0.5 text-xs font-medium text-muted-foreground sm:inline-block"
                    title="Pressione / para focar"
                  >
                    /
                  </kbd>
                ) : null}
              </div>
            </div>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="evento" className="sr-only">
              Filtrar por evento
            </label>
            <select
              id="evento"
              name="evento"
              value={evento}
              onChange={(e) => handleEventoChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="comite-event-filter"
            >
              <option value="">Todos os eventos</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="status" className="sr-only">
              Filtrar por situação
            </label>
            <select
              id="status"
              name="status"
              value={status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="comite-status-filter"
            >
              <option value="">Todas em avaliação</option>
              <option value="NO_REVIEWER">Sem revisor</option>
              <option value="WAITING_QUORUM">Aguardando pareceres</option>
              <option value="READY">Prontas para decisão</option>
              <option value="ACCEPTED">Aceitas</option>
              <option value="REJECTED">Rejeitadas</option>
              <option value="ALL">Todas as situações</option>
            </select>
          </div>

          <div className="flex items-center gap-2 sm:col-span-1">
            <button
              type="submit"
              aria-label="Aplicar filtros"
              className="inline-flex w-full items-center justify-center rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition hover:opacity-90"
              title="Aplicar filtros"
              data-testid="comite-filter-submit"
            >
              <Filter className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        {hasActiveFilters ? (
          <div className="flex items-center justify-between border-t border-border pt-2.5 text-xs text-muted-foreground">
            <span>Filtros ativos aplicados na fila</span>
            <AppLink
              href={tenantPath(tenantSlug, '/comite')}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              data-testid="comite-filter-clear"
            >
              <X className="size-3" aria-hidden />
              Limpar filtros
            </AppLink>
          </div>
        ) : null}
      </form>
    </section>
  );
}
