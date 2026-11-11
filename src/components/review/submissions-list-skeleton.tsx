import { Skeleton } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SKELETON DE SUBMISSÕES DO COMITÊ (FASE 99 · ADR-417 / FASE 100 · ADR-420)
 *
 *  Permite que o cabeçalho e a barra de filtros fiquem 100% montados na troca
 *  de filtros/páginas, enquanto o cockpit (métricas e listagem) exibe o estado de
 *  carregamento em streaming assíncrono sem flash de layout (evita CLS).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function SubmissionsListSkeleton() {
  return (
    <div
      className="space-y-8 motion-reduce:animate-none"
      aria-busy="true"
      aria-label="Carregando submissões..."
      data-testid="submissions-skeleton"
    >
      {/* Skeleton dos cartões de métricas */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>

      {/* Skeleton da lista de trabalhos */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
        </div>
        <ul className="space-y-3">
          {[1, 2, 3].map((i) => (
            <li
              key={i}
              className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4"
            >
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-28" />
                </div>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
              <Skeleton className="h-7 w-16 rounded-md" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
