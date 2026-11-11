'use client';

import { useEffect, useRef, useTransition, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Filter, Loader2, Search, X } from 'lucide-react';

import { tenantPath } from '@/domain/tenancy/resolution';

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
 *  BARRA DE FILTROS REATIVA DO COMITÊ (FASE 99 · ADR-416 / ADR-419)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE USETRANSITION + DEBOUNCE EM VEZ DE GET BRUTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Antes desta fase, trocar um <select> ou buscar por nome submetia um formulário
 *  GET tradicional. O Next.js executava uma navegação completa de Server Component,
 *  recarregando a página, pulando o scroll e exigindo cliques manuais.
 *
 *  Agora:
 *    • O campo de busca tem debounce de 300ms com useTransition;
 *    • A troca de <select> é instantânea sem reload de página (scroll: false);
 *    • Tecla '/' foca o input de busca automaticamente (power-user experience);
 *    • O formulário mantém method="GET" para fallback progressivo e suporte a testes.
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

  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  // Atalho de teclado: '/' foca a busca, 'Escape' cancela o foco
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const activeTag = document.activeElement?.tagName;
      if (e.key === '/' && activeTag !== 'INPUT' && activeTag !== 'TEXTAREA' && activeTag !== 'SELECT') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function applyFilters(newBusca: string, newEvento: string, newStatus: string) {
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

    startTransition(() => {
      const query = params.toString();
      const targetUrl = query ? `${pathname}?${query}` : pathname;
      router.replace(targetUrl, { scroll: false });
    });
  }

  function handleBuscaChange(val: string) {
    setBusca(val);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      applyFilters(val, evento, status);
    }, 300);
  }

  function handleEventoChange(val: string) {
    setEvento(val);
    applyFilters(busca, val, status);
  }

  function handleStatusChange(val: string) {
    setStatus(val);
    applyFilters(busca, evento, val);
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
                className="w-full rounded-md border border-input bg-background pl-9 pr-9 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="comite-search-input"
              />
              {isPending ? (
                <Loader2
                  className="pointer-events-none absolute right-3 top-2.5 size-4 animate-spin text-muted-foreground"
                  aria-hidden
                />
              ) : (
                <kbd
                  className="pointer-events-none absolute right-2.5 top-2 hidden rounded border border-border bg-muted/60 px-1.5 py-0.5 text-xs font-medium text-muted-foreground sm:inline-block"
                  title="Pressione / para focar"
                >
                  /
                </kbd>
              )}
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
            <Link
              href={tenantPath(tenantSlug, '/comite')}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              data-testid="comite-filter-clear"
            >
              <X className="size-3" aria-hidden />
              Limpar filtros
            </Link>
          </div>
        ) : null}
      </form>
    </section>
  );
}

