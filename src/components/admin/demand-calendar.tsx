/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O CALENDÁRIO DAS DEMANDAS (FASE 57)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DIA É O DO PRAZO, NÃO O DE HOJE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A demanda atrasada aparece no dia em que VENCEU, e a concluída continua marcada no dia
 *  em que era para ter ficado pronta. O calendário conta a história do que era para ter
 *  acontecido — é isso que permite olhar o mês passado e entender o que ficou para trás.
 *  "O que está atrasado hoje" é pergunta do filtro de situação do quadro, e continua lá.
 *
 *  A grade (semanas de sete, dias de fora do mês atenuados, `isToday`) vem pronta do
 *  domínio (`calendarMonth`): aqui só existe desenho — inclusive porque a conta de mês é
 *  a única do sistema que NÃO usa `Date`, para não depender do fuso do servidor.
 *
 *  Esta vista mostra SÓ as demandas: atividade de programação tem tela própria, e
 *  misturá-las faria o organizador procurar no dia errado.
 */
import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import {
  calendarMonth,
  type TimelineDemand,
} from '@/domain/events/demand-timeline-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { demandViewQuery, type DemandViewFilters } from '@/components/admin/demand-view-switcher';
import { demandSituationTone } from '@/components/admin/demand-situation-tone';
import { cn } from '@/lib/utils/cn';

/** Semana brasileira: começa no domingo, e o domínio devolve as células na mesma ordem. */
const WEEKDAY_LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

const NAV_LINK =
  'inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent';

export function DemandCalendar({
  tenantSlug,
  eventId,
  demands,
  monthKey,
  timeZone,
  now,
  filters,
}: {
  tenantSlug: string;
  eventId: string;
  demands: readonly TimelineDemand[];
  monthKey: string;
  timeZone: string;
  now: Date;
  filters: DemandViewFilters;
}) {
  const month = calendarMonth({ monthKey, demands, timeZone, now });
  const basePath = `/administracao/eventos/${eventId}/demandas`;
  const boardPath = tenantPath(tenantSlug, basePath);

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4" data-testid="demand-calendar">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2
            className="flex items-center gap-2 text-sm font-medium"
            data-testid="demand-calendar-month"
          >
            <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
            {month.monthLabel}
          </h2>
          <p className="text-xs text-muted-foreground">
            As demandas aparecem no dia do PRAZO — a atrasada fica no dia em que venceu.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`${boardPath}?${demandViewQuery('calendario', filters, {
              key: 'mes',
              value: month.prevMonthKey,
            })}`}
            data-testid="demand-calendar-prev"
            className={NAV_LINK}
            rel="prev"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            Mês anterior
          </Link>
          <Link
            href={`${boardPath}?${demandViewQuery('calendario', filters, {
              key: 'mes',
              value: month.nextMonthKey,
            })}`}
            data-testid="demand-calendar-next"
            className={NAV_LINK}
            rel="next"
          >
            Próximo mês
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </header>

      <div className="overflow-x-auto">
        <div className="min-w-[42rem] space-y-1">
          <div className="grid grid-cols-7 border-b border-border pb-1">
            {WEEKDAY_LABELS.map((label) => (
              <span
                key={label}
                className="text-center text-xs uppercase tracking-wide text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>

          {month.weeks.map((week) => (
            <div key={week[0]?.dayKey ?? 'semana'} className="grid grid-cols-7 gap-1">
              {week.map((cell) => (
                <div
                  key={cell.dayKey}
                  data-testid={`demand-calendar-cell-${cell.dayKey}`}
                  data-in-month={cell.inMonth ? '1' : undefined}
                  data-today={cell.isToday ? '1' : undefined}
                  className={cn(
                    'min-h-20 space-y-1 rounded-md border p-1',
                    cell.inMonth ? 'border-border' : 'border-dashed border-border/60 bg-muted/20',
                    /** O anel de "hoje" é do sistema, e não uma cor nova: quem já conhece o
                        anel de foco reconhece o de hoje. */
                    cell.isToday ? 'ring-2 ring-primary' : '',
                  )}
                >
                  <p
                    className={cn(
                      'text-xs tabular-nums',
                      /**
                       * ─────────────────────────────────────────────────────────────
                       *  O DIA DO MÊS VIZINHO NÃO ESMAECE O TEXTO (FASE 58)
                       * ─────────────────────────────────────────────────────────────
                       *  Era `text-muted-foreground/60` — o token com 60% de alfa —, e a
                       *  varredura de acessibilidade mediu **2,9:1** sobre `bg-muted/20`
                       *  (mínimo AA é 4,5:1 para texto pequeno): os dias 27 a 30 do mês
                       *  anterior ficavam ilegíveis para quem tem baixa visão. A célula
                       *  CONTINUA atenuada — pela borda tracejada e pelo fundo —, que é
                       *  onde a atenuação não custa leitura. Texto pequeno é texto: se a
                       *  data está na tela, ela precisa ser legível.
                       */
                      cell.inMonth ? 'font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {cell.dayOfMonth}
                  </p>

                  {cell.demands.map((item) => (
                    <Link
                      key={item.id}
                      href={tenantPath(tenantSlug, `${basePath}/${item.id}`)}
                      data-testid={`demand-calendar-demand-${item.id}`}
                      title={`${item.title} · ${item.situationLabel}`}
                      className={cn(
                        'block truncate rounded-sm border px-1 py-0.5 text-xs hover:underline',
                        demandSituationTone(item.situation),
                      )}
                    >
                      {item.title}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="demand-calendar-outside">
        {month.outside === 0
          ? 'Nenhuma demanda vence em outro mês.'
          : `${month.outside} demanda(s) vencem em outro mês — ande pelos meses para vê-las.`}
      </p>

      <div
        className="space-y-1 rounded-md border border-dashed border-border p-2"
        data-testid="demand-calendar-undated"
      >
        <p className="text-xs font-medium text-muted-foreground">
          Sem prazo ({month.undated.length})
        </p>
        {month.undated.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todas as demandas do quadro têm prazo.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {month.undated.map((item) => (
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
