/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ESQUELETO DO DIRETÓRIO DE PARTICIPANTES (FASE 103 · ADR-430)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  STREAMING E FEEDBACK INSTANTÂNEO EM TRANSIÇÕES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quando a tela de participantes é carregada ou quando os filtros são alterados,
 *  este esqueleto é exibido dentro de `<Suspense fallback={<ParticipantSkeleton />}>`,
 *  mantendo a barra de cabeçalho e filtros responsivas e sem congelamento visual.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ParticipantSkeleton() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-label="Carregando participantes…"
      data-testid="participant-skeleton"
    >
      <div className="h-4 w-64 animate-pulse rounded bg-muted/60 motion-reduce:animate-none" />

      {/* Esqueleto do painel de exportação */}
      <div className="h-24 animate-pulse rounded-xl border border-border/50 bg-card/60 motion-reduce:animate-none" />

      {/* Esqueleto da tabela */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="h-10 bg-muted/30" />
        <div className="divide-y divide-border/40 bg-card">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-4"
              data-testid={`participant-skeleton-row-${index}`}
            >
              <div className="space-y-2">
                <div className="h-4 w-48 animate-pulse rounded bg-muted/70 motion-reduce:animate-none" />
                <div className="h-3 w-32 animate-pulse rounded bg-muted/50 motion-reduce:animate-none" />
              </div>
              <div className="space-y-1">
                <div className="h-3 w-20 animate-pulse rounded bg-muted/50 motion-reduce:animate-none" />
                <div className="h-3 w-16 animate-pulse rounded bg-muted/40 motion-reduce:animate-none" />
              </div>
              <div className="h-8 w-24 animate-pulse rounded bg-muted/50 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

