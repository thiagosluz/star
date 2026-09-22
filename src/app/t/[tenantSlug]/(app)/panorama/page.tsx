import Link from 'next/link';
import { ArrowLeft, ChartColumn } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';
import { getInstitutionIntelligence } from '@/lib/participants/insight-service';
import {
  INTELLIGENCE_RANGES,
  INTELLIGENCE_RANGE_LABELS,
  type IntelligenceRange,
} from '@/domain/participants/participant-rules';

export const metadata = { title: 'Panorama' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PANORAMA DA INSTITUIÇÃO (FASE 32)
 *  `/t/<slug>/panorama?periodo=30D|90D|YEAR|ALL|CUSTOM&de=&ate=`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA TELA EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela é a única consumidora de `tenant:analytics:read` — permissão que existe desde
 *  a FASE 2 e nenhuma tela usava. O que ela acrescenta ao painel (`/administracao`,
 *  que conta o que existe AGORA) é o RECORTE DE PERÍODO e a SÉRIE POR EVENTO:
 *
 *    • um total sozinho não distingue "a instituição cresceu" de "um evento gigante
 *      aconteceu";
 *    • a taxa de comparecimento responde a pergunta que a secretaria faz de verdade
 *      ("quantos dos inscritos apareceram?") em vez de mostrar só presença absoluta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O RELÓGIO VEM DO BANCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `SELECT now()` — e não `new Date()` no corpo do componente. O React Compiler trata
 *  o corpo de um Server Component como render e recusa função impura (armadilha 70);
 *  além disso, o período precisa ser o MESMO relógio que carimba as presenças.
 *
 *  A janela é interpretada no FUSO DA INSTITUIÇÃO (`Tenant.timezone`), resolvida no
 *  domínio: "os últimos 30 dias" tem de significar a mesma coisa para quem lê o
 *  relatório e para quem grava a frequência (armadilha 38).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PanoramaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string }>;
}) {
  const { tenantSlug } = await params;
  const { periodo, de, ate } = await searchParams;

  const { tenantId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.TENANT_ANALYTICS_READ,
  });

  const selected: IntelligenceRange = INTELLIGENCE_RANGES.includes(periodo as IntelligenceRange)
    ? (periodo as IntelligenceRange)
    : 'ALL';

  const clock = await withTenant(tenantId, (tx) =>
    tx.$queryRaw<{ now: Date }[]>`SELECT now() AS now`,
  );

  const result = await getInstitutionIntelligence({
    tenantId,
    range: selected,
    fromDay: de ?? null,
    toDay: ate ?? null,
    now: clock[0]?.now ?? new Date(0),
  });

  return (
    <main className="max-w-6xl space-y-6" data-testid="panorama">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/dashboard')}
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          >
            <ArrowLeft className="size-3" aria-hidden />
            Painel
          </Link>
        </nav>

        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ChartColumn className="size-6 text-primary" aria-hidden />
          Panorama
        </h1>
        <p className="text-sm text-muted-foreground">
          A vida da instituição no período escolhido: quem passou por aqui, quem apareceu de fato, o
          tempo que isso representou e o que foi entregue e conversado.
        </p>
      </header>

      {!result.ok ? (
        <p className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          {result.message}
        </p>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3" data-testid="panorama-filters">
            <label className="space-y-1 text-xs font-medium">
              Período
              <select
                name="periodo"
                defaultValue={selected}
                aria-label="Período"
                data-testid="panorama-range"
                className="block min-w-48 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
              >
                {INTELLIGENCE_RANGES.map((range) => (
                  <option key={range} value={range}>
                    {INTELLIGENCE_RANGE_LABELS[range]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs font-medium">
              De
              <input
                type="date"
                name="de"
                defaultValue={de ?? ''}
                aria-label="De"
                data-testid="panorama-from"
                className="block rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
              />
            </label>

            <label className="space-y-1 text-xs font-medium">
              Até
              <input
                type="date"
                name="ate"
                defaultValue={ate ?? ''}
                aria-label="Até"
                data-testid="panorama-to"
                className="block rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
              />
            </label>

            <button
              type="submit"
              data-testid="panorama-apply"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
            >
              Aplicar
            </button>
          </form>

          <p className="text-xs text-muted-foreground" data-testid="panorama-range-label">
            {result.insight.range.label} · fuso {result.insight.range.timeZone}
          </p>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="panorama-totals">
            <Stat label="Participantes" value={String(result.insight.totals.participants)} hint="pessoas da instituição" />
            <Stat
              label="Eventos no período"
              value={String(result.insight.totals.events)}
              hint={`${result.insight.totals.publishedEvents} publicado(s)/com inscrição aberta`}
            />
            <Stat
              label="Comparecimento"
              value={
                result.insight.totals.rate.hasData ? `${result.insight.totals.rate.percent}%` : '—'
              }
              hint={`${result.insight.totals.attended} presença(s) em ${result.insight.totals.confirmed} confirmada(s)`}
            />
            <Stat
              label="Frequência"
              value={`${result.insight.totals.minutes} min`}
              hint={
                result.insight.totals.averageMinutes !== null
                  ? `${result.insight.totals.visits} visita(s) · média ${result.insight.totals.averageMinutes} min`
                  : 'sem visitas no período'
              }
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Certificados" value={String(result.insight.totals.certificates)} hint="emitidos no período" />
            <Stat label="Cartas" value={String(result.insight.totals.cards)} hint="conquistadas no período" />
            <Stat label="XP distribuído" value={String(result.insight.totals.xp)} hint="pontos creditados" />
            <Stat
              label="Comunicação"
              value={String(result.insight.totals.messages)}
              hint={`${result.insight.totals.unreadMessages} não lido(s) · ${result.insight.totals.emailsSent} e-mail(s) entregue(s), ${result.insight.totals.emailsFailed} falha(s)`}
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Por evento</h2>

            {result.insight.events.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="panorama-empty">
                Nenhum evento neste período.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm" data-testid="panorama-events">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Evento</th>
                      <th className="px-3 py-2 text-left">Inscrições</th>
                      <th className="px-3 py-2 text-left">Presenças</th>
                      <th className="px-3 py-2 text-left">Comparecimento</th>
                      <th className="px-3 py-2 text-left">Minutos</th>
                      <th className="px-3 py-2 text-left">Certificados</th>
                      <th className="px-3 py-2 text-left">Recados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.insight.events.map((row) => (
                      <tr key={row.eventId} className="border-t border-border/60" data-testid={`panorama-event-${row.eventId}`}>
                        <td className="px-3 py-2">
                          <p className="font-medium">{row.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.startsAt.toLocaleDateString('pt-BR')} · {row.status.toLowerCase()}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.confirmed} confirmada(s) · {row.attended} com presença
                        </td>
                        <td className="px-3 py-2 text-xs">{row.visits} visita(s)</td>
                        <td className="px-3 py-2 text-xs">{row.rate.hasData ? `${row.rate.percent}%` : '—'}</td>
                        <td className="px-3 py-2 text-xs">{row.minutes} min</td>
                        <td className="px-3 py-2 text-xs">{row.certificates}</td>
                        <td className="px-3 py-2 text-xs">{row.messages}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
