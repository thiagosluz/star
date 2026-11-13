'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

import { startNavigationProgress } from '@/components/ui/navigation-progress-bar';
import { tenantPath } from '@/domain/tenancy/resolution';

export interface ParticipantFilterEvent {
  id: string;
  title: string;
  startsAt: Date;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BARRA DE FILTROS DO DIRETÓRIO DE PARTICIPANTES (FASE 102 · ADR-428)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE AUTO-SUBMIT COM TRANSIÇÃO, DEBOUNCE E SUPORTE A ATALHO DE TECLADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O diretório central de participantes reúne todas as pessoas da instituição
 *  com suas métricas agregadas (certificados, presenças, XP).
 *
 *  Para tornar a exploração ágil sem perder a fidelidade de URL:
 *    • Mudança no select de evento ou nos checkboxes (certificado / presença)
 *      aplica o filtro instantaneamente via `startTransition` sem recarga bruta;
 *    • O campo de busca tem debounce de 300ms para evitar requisições a cada tecla;
 *    • Atalho de teclado `/` foca a busca; tecla `Escape` limpa o filtro;
 *    • O botão `<button type="submit" data-testid="participant-filter-apply">`
 *      permanece no DOM garantindo fallback nativo se o JS falhar e compatibilidade
 *      com testes existentes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ParticipantFilterBar({
  tenantSlug,
  events,
  initialBusca = '',
  initialEvento,
  initialCertificado = false,
  initialPresente = false,
}: {
  tenantSlug: string;
  events: readonly ParticipantFilterEvent[];
  initialBusca?: string;
  initialEvento?: string | null;
  initialCertificado?: boolean;
  initialPresente?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [busca, setBusca] = useState(initialBusca);
  const [evento, setEvento] = useState(initialEvento ?? '');
  const [certificado, setCertificado] = useState(initialCertificado);
  const [presente, setPresente] = useState(initialPresente);

  const [prevProps, setPrevProps] = useState({
    busca: initialBusca,
    evento: initialEvento ?? '',
    certificado: initialCertificado,
    presente: initialPresente,
  });

  if (
    prevProps.busca !== initialBusca ||
    prevProps.evento !== (initialEvento ?? '') ||
    prevProps.certificado !== initialCertificado ||
    prevProps.presente !== initialPresente
  ) {
    setPrevProps({
      busca: initialBusca,
      evento: initialEvento ?? '',
      certificado: initialCertificado,
      presente: initialPresente,
    });
    setBusca(initialBusca);
    setEvento(initialEvento ?? '');
    setCertificado(initialCertificado);
    setPresente(initialPresente);
  }

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasFiltered, setHasFiltered] = useState(false);

  const latestFiltersRef = useRef({
    busca: initialBusca,
    evento: initialEvento ?? '',
    certificado: initialCertificado,
    presente: initialPresente,
  });

  useEffect(() => {
    latestFiltersRef.current = { busca, evento, certificado, presente };
  }, [busca, evento, certificado, presente]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const applyFilters = useCallback(
    ({
      nextBusca = latestFiltersRef.current.busca,
      nextEvento = latestFiltersRef.current.evento,
      nextCertificado = latestFiltersRef.current.certificado,
      nextPresente = latestFiltersRef.current.presente,
    }: {
      nextBusca?: string;
      nextEvento?: string;
      nextCertificado?: boolean;
      nextPresente?: boolean;
    } = {}) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');

      // Reset de paginação ao filtrar
      params.delete('pagina');

      if (nextBusca.trim()) {
        params.set('busca', nextBusca.trim());
      } else {
        params.delete('busca');
      }

      if (nextEvento) {
        params.set('evento', nextEvento);
      } else {
        params.delete('evento');
      }

      if (nextCertificado) {
        params.set('certificado', '1');
      } else {
        params.delete('certificado');
      }

      if (nextPresente) {
        params.set('presente', '1');
      } else {
        params.delete('presente');
      }

      const qs = params.toString();
      const targetUrl = `${tenantPath(tenantSlug, '/participantes')}${qs ? `?${qs}` : ''}`;
      const currentUrl = `${window.location.pathname}${window.location.search}`;

      if (targetUrl === currentUrl) return;

      setHasFiltered(true);
      startNavigationProgress();
      startTransition(() => {
        router.replace(targetUrl, { scroll: false });
      });
    },
    [router, searchParams, tenantSlug],
  );

  // Atalho de teclado: "/" para focar, "Escape" para limpar ou desfocar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const activeElement = document.activeElement as HTMLElement | null;
      const targetElement = e.target as HTMLElement | null;
      const isInputOrEditable =
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetElement?.tagName ?? '') ||
        Boolean(targetElement?.isContentEditable) ||
        Boolean(activeElement?.isContentEditable);

      if (e.key === '/' && !isInputOrEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        if (latestFiltersRef.current.busca.trim().length > 0) {
          e.preventDefault();
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          setBusca('');
          latestFiltersRef.current.busca = '';
          applyFilters({ nextBusca: '' });
        } else {
          inputRef.current?.blur();
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
      applyFilters({ nextBusca: val });
    }, 300);
  }

  function handleEventoChange(val: string) {
    setEvento(val);
    latestFiltersRef.current.evento = val;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    applyFilters({ nextEvento: val });
  }

  function handleCertificadoChange(checked: boolean) {
    setCertificado(checked);
    latestFiltersRef.current.certificado = checked;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    applyFilters({ nextCertificado: checked });
  }

  function handlePresenteChange(checked: boolean) {
    setPresente(checked);
    latestFiltersRef.current.presente = checked;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    applyFilters({ nextPresente: checked });
  }

  return (
    <form
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        applyFilters();
      }}
      className="flex flex-wrap items-end gap-3"
      data-testid="participant-filters"
    >
      <span className="sr-only" aria-live="polite" data-testid="participant-filter-live">
        {isPending
          ? 'Atualizando lista de participantes...'
          : hasFiltered
            ? 'Lista de participantes atualizada.'
            : ''}
      </span>
      <label className="space-y-1 text-xs font-medium">
        Buscar
        <div className="relative">
          <input
            ref={inputRef}
            type="search"
            name="busca"
            value={busca}
            onChange={(e) => handleBuscaChange(e.target.value)}
            placeholder="nome ou e-mail"
            aria-label="Buscar participante"
            data-testid="participant-search"
            className={`block min-w-56 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal ${
              busca || isPending ? 'pr-10' : ''
            }`}
          />
          {isPending || busca ? (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {isPending && (
                <span
                  role="status"
                  aria-label="Buscando"
                  className="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent"
                />
              )}
              {busca ? (
                <button
                  type="button"
                  onClick={() => {
                    setBusca('');
                    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                    inputRef.current?.focus();
                    applyFilters({ nextBusca: '' });
                  }}
                  data-testid="participant-search-clear"
                  aria-label="Limpar campo de busca"
                  className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </label>

      <label className="space-y-1 text-xs font-medium">
        Evento
        <select
          name="evento"
          value={evento}
          onChange={(e) => handleEventoChange(e.target.value)}
          aria-label="Evento"
          data-testid="participant-event"
          className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
        >
          <option value="">Todos os eventos</option>
          {events.map((evt) => (
            <option key={evt.id} value={evt.id} suppressHydrationWarning>
              {evt.title} · {new Date(evt.startsAt).toLocaleDateString('pt-BR')}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 pb-2 text-xs">
        <input
          type="checkbox"
          name="certificado"
          value="1"
          checked={certificado}
          onChange={(e) => handleCertificadoChange(e.target.checked)}
          data-testid="participant-only-certificate"
          className="size-3.5"
        />
        Só quem tem certificado
      </label>

      <label className="flex items-center gap-2 pb-2 text-xs">
        <input
          type="checkbox"
          name="presente"
          value="1"
          checked={presente}
          onChange={(e) => handlePresenteChange(e.target.checked)}
          data-testid="participant-only-attended"
          className="size-3.5"
        />
        Só quem já compareceu
      </label>

      <button
        type="submit"
        data-testid="participant-filter-apply"
        className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
      >
        <Search className="size-3.5" aria-hidden />
        Filtrar
      </button>
    </form>
  );
}
