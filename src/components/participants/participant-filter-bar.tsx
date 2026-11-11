'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

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

  const applyFilters = useCallback(
    ({
      nextBusca = busca,
      nextEvento = evento,
      nextCertificado = certificado,
      nextPresente = presente,
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

      startNavigationProgress();
      startTransition(() => {
        router.replace(targetUrl, { scroll: false });
      });
    },
    [busca, certificado, evento, presente, router, searchParams, tenantSlug],
  );

  // Atalho de teclado: "/" para focar, "Escape" para limpar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setBusca('');
        applyFilters({ nextBusca: '' });
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyFilters]);

  function handleBuscaChange(val: string) {
    setBusca(val);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      applyFilters({ nextBusca: val });
    }, 300);
  }

  function handleEventoChange(val: string) {
    setEvento(val);
    applyFilters({ nextEvento: val });
  }

  function handleCertificadoChange(checked: boolean) {
    setCertificado(checked);
    applyFilters({ nextCertificado: checked });
  }

  function handlePresenteChange(checked: boolean) {
    setPresente(checked);
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
      <label className="space-y-1 text-xs font-medium">
        Buscar
        <div className="relative">
          <input
            ref={inputRef}
            type="search"
            name="busca"
            value={busca}
            onChange={(e) => handleBuscaChange(e.target.value)}
            placeholder="nome ou e-mail (Pressione / para buscar)"
            aria-label="Buscar participante"
            data-testid="participant-search"
            className="block min-w-56 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
          {isPending && (
            <span
              role="status"
              aria-label="Buscando"
              className="absolute right-2.5 top-2.5 size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent"
            />
          )}
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
            <option key={evt.id} value={evt.id}>
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
