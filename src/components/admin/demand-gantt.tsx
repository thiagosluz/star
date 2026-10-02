/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O GANTT DAS DEMANDAS (FASE 57)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTE COMPONENTE NÃO DECIDE NADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A janela, a coluna em que cada barra começa, o corte nas pontas e o que fica de fora
 *  são do DOMÍNIO (`ganttLayout`). Aqui só existe desenho: uma grade de `days.length`
 *  colunas e a barra posicionada por `gridColumn`. Se a conta estivesse neste arquivo,
 *  ela não teria teste sem navegador — e é exatamente a conta que erra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE GRADE, E NÃO PORCENTAGEM CALCULADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `gridColumn: start / span duração` deixa o navegador dividir a largura: o eixo e a
 *  barra usam a MESMA régua (o número de colunas), então nenhuma conta de pixel pode
 *  divergir do eixo. As duas pontas cortadas aparecem no dado (`data-clipped-*`) porque
 *  o desenho sozinho não distingue "começa aqui" de "já vinha de antes".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A BARRA ESTIMADA É DITA, NÃO SÓ DESENHADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Sem `startAt`, a barra começa na CRIAÇÃO. Isso é uma estimativa da tela, e o título
 *  leva "(início estimado)" além da borda tracejada: cor ou traço não informam quem não
 *  os vê, e o gestor que lê o gráfico precisa saber o que é dado e o que é dedução.
 *
 *  As demandas sem prazo aparecem na faixa "sem data" — com o NÚMERO —, e as que têm data
 *  fora do período são contadas: nada some em silêncio (a lição da FASE 50).
 */
import Link from 'next/link';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';

import {
  ganttLayout,
  monthKeyOf,
  monthLabel,
  type TimelineDemand,
  type TimelineWindow,
} from '@/domain/events/demand-timeline-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { demandViewQuery, type DemandViewFilters } from '@/components/admin/demand-view-switcher';
import { demandSituationTone } from '@/components/admin/demand-situation-tone';
import { shiftedWindowAnchor } from '@/lib/events/demand-timeline';
import { cn } from '@/lib/utils/cn';

/** Largura do rótulo da linha — a MESMA do vão do cabeçalho, senão as colunas desalinham. */
const ROW_LABEL_WIDTH = 'w-40 sm:w-48';

const NAV_LINK =
  'inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent';

/** "set" a partir do rótulo do domínio: o mês por extenso não cabe numa coluna de 1,5 rem. */
function shortMonth(monthKey: string): string {
  const name = monthLabel(monthKey).split(' de ')[0] ?? monthKey;

  return name.slice(0, 3);
}

export function DemandGantt({
  tenantSlug,
  eventId,
  demands,
  window,
  timeZone,
  filters,
}: {
  tenantSlug: string;
  eventId: string;
  demands: readonly TimelineDemand[];
  window: TimelineWindow;
  timeZone: string;
  filters: DemandViewFilters;
}) {
  const layout = ganttLayout({ demands, window, timeZone });
  const basePath = `/administracao/eventos/${eventId}/demandas`;
  const boardPath = tenantPath(tenantSlug, basePath);
  const columns = layout.window.days.length;
  const template = `repeat(${columns}, minmax(0, 1fr))`;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4" data-testid="demand-gantt">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <CalendarRange className="size-4 text-muted-foreground" aria-hidden />
            Linha do tempo das demandas
          </h2>
          <p className="text-xs text-muted-foreground">
            {layout.window.fromKey} a {layout.window.toKey} · {layout.rows.length} no período.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`${boardPath}?${demandViewQuery('gantt', filters, {
              key: 'de',
              value: shiftedWindowAnchor(layout.window, -1),
            })}`}
            data-testid="demand-gantt-prev"
            className={NAV_LINK}
            rel="prev"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            Período anterior
          </Link>
          <Link
            href={`${boardPath}?${demandViewQuery('gantt', filters, {
              key: 'de',
              value: shiftedWindowAnchor(layout.window, 1),
            })}`}
            data-testid="demand-gantt-next"
            className={NAV_LINK}
            rel="next"
          >
            Próximo período
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </header>

      <div className="overflow-x-auto">
        <div className="min-w-[48rem] space-y-1">
          {/* ── O eixo: o número do dia, e o mês quando ele vira ─────────────── */}
          <div className="flex items-stretch gap-2" data-testid="demand-gantt-axis">
            <span className={cn(ROW_LABEL_WIDTH, 'shrink-0')} aria-hidden />
            <div className="grid flex-1 border-b border-border" style={{ gridTemplateColumns: template }}>
              {layout.window.days.map((dayKey, index) => {
                const previous = index === 0 ? null : (layout.window.days[index - 1] ?? null);
                const turnsMonth = previous === null || monthKeyOf(previous) !== monthKeyOf(dayKey);

                return (
                  <div
                    key={dayKey}
                    title={monthLabel(monthKeyOf(dayKey))}
                    className="border-l border-border/60 px-0.5 py-1 text-center last:border-r"
                  >
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {dayKey.slice(8)}
                    </span>
                    {/* A linha do mês ocupa lugar mesmo quando vazia: sem ela, as colunas
                        que viram o mês ficariam mais altas que as outras. */}
                    {turnsMonth ? (
                      <span className="block text-xs font-medium uppercase text-foreground">
                        {shortMonth(monthKeyOf(dayKey))}
                      </span>
                    ) : (
                      <span className="block text-xs">&nbsp;</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Uma linha por demanda que toca o período ─────────────────────── */}
          {layout.rows.map((row) => (
            <div
              key={row.id}
              data-testid={`demand-gantt-row-${row.id}`}
              className="flex items-center gap-2"
            >
              <div className={cn(ROW_LABEL_WIDTH, 'shrink-0')}>
                <Link
                  href={tenantPath(tenantSlug, `${basePath}/${row.id}`)}
                  className="block truncate text-xs font-medium underline-offset-2 hover:underline"
                >
                  {row.title}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {row.situationLabel} · {row.priorityLabel}
                  {row.teamName ? ` · ${row.teamName}` : ''}
                  {row.assigneeNames.length > 0 ? ` · ${row.assigneeNames.join(', ')}` : ''}
                </p>
              </div>

              <div className="grid flex-1 items-center py-0.5" style={{ gridTemplateColumns: template }}>
                <Link
                  href={tenantPath(tenantSlug, `${basePath}/${row.id}`)}
                  style={{ gridColumn: `${row.startColumn + 1} / span ${row.spanColumns}` }}
                  data-testid={`demand-gantt-bar-${row.id}`}
                  /** `"1"` e não string vazia: o atributo afirma, e o teste o lê. */
                  data-estimated={row.estimatedStart ? '1' : undefined}
                  data-clipped-start={row.clippedStart ? '1' : undefined}
                  data-clipped-end={row.clippedEnd ? '1' : undefined}
                  data-situation={row.situation}
                  data-kind={row.kind}
                  title={`${row.title} · ${row.startKey} a ${row.endKey}${
                    row.estimatedStart ? ' (início estimado)' : ''
                  }`}
                  className={cn(
                    'flex h-7 items-center gap-1 overflow-hidden rounded-sm border px-1.5 text-xs',
                    demandSituationTone(row.situation),
                    row.estimatedStart ? 'border-dashed' : '',
                  )}
                >
                  <span className="truncate font-medium">{row.title}</span>
                  {row.estimatedStart ? (
                    <span className="shrink-0 text-xs text-muted-foreground">(início estimado)</span>
                  ) : null}
                </Link>
              </div>
            </div>
          ))}

          {layout.rows.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              Nenhuma demanda com prazo dentro deste período.
            </p>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="demand-gantt-outside">
        {layout.outside === 0
          ? 'Nenhuma demanda com data fora deste período.'
          : `${layout.outside} demanda(s) com data fora deste período — ande pelo eixo para vê-las.`}
      </p>

      {/* ── A faixa "sem data": o Gantt não tem onde desenhá-las, então ele as lista ── */}
      <div
        className="space-y-1 rounded-md border border-dashed border-border p-2"
        data-testid="demand-gantt-undated"
      >
        <p className="text-xs font-medium text-muted-foreground">
          Sem data ({layout.undated.length})
        </p>
        {layout.undated.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Todas as demandas do quadro têm prazo.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {layout.undated.map((item) => (
              <li key={item.id}>
                <Link
                  href={tenantPath(tenantSlug, `${basePath}/${item.id}`)}
                  className="text-xs underline underline-offset-4"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
