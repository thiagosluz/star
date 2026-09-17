import Link from 'next/link';
import {
  Activity,
  Award,
  Building2,
  CalendarDays,
  FileStack,
  ShieldAlert,
  Users,
  Zap,
} from 'lucide-react';

import { requirePlatformPermission } from '@/lib/platform/guard';
import { getPlatformMetrics, listPlatformAudit } from '@/lib/platform/global-repository';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  VISÃO GERAL DA PLATAFORMA
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  MÉTRICA DE GOVERNANÇA É CONTAGEM, NÃO LISTA DE PESSOAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O painel responde "quantas", nunca "quem". Um governante de plataforma não
 *  precisa — e não deve — ler a lista de participantes de cada instituição: isso
 *  seria transformar o papel de plataforma em um superpoder de leitura sobre
 *  dados de terceiros. As contagens vêm de `COUNT` no banco, agregadas.
 *
 *  O número que importa para a operação é o de SUSPENSAS: é o que exige ação
 *  (contato, cobrança, reativação). Por isso ele aparece com destaque, e não
 *  escondido em uma tabela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PlatformOverviewPage() {
  await requirePlatformPermission();

  const [metrics, audit] = await Promise.all([getPlatformMetrics(), listPlatformAudit({ limit: 10 })]);

  const cards = [
    {
      testId: 'metric-tenants',
      label: 'Instituições',
      value: metrics.tenants.total,
      hint: `${metrics.tenants.active} ativas · ${metrics.tenants.public} no diretório`,
      icon: Building2,
    },
    {
      testId: 'metric-suspended',
      label: 'Suspensas',
      value: metrics.tenants.suspended,
      hint: metrics.tenants.suspended > 0 ? 'Requer acompanhamento' : 'Nenhuma pendência',
      icon: ShieldAlert,
      alert: metrics.tenants.suspended > 0,
    },
    {
      testId: 'metric-users',
      label: 'Contas',
      value: metrics.users,
      hint: `${metrics.memberships} vínculos ativos`,
      icon: Users,
    },
    {
      testId: 'metric-events',
      label: 'Eventos',
      value: metrics.events.total,
      hint: `${metrics.events.open} com inscrições abertas`,
      icon: CalendarDays,
    },
    {
      testId: 'metric-registrations',
      label: 'Inscrições',
      value: metrics.registrations,
      hint: 'Confirmadas ou com presença',
      icon: Activity,
    },
    {
      testId: 'metric-submissions',
      label: 'Trabalhos',
      value: metrics.submissions,
      hint: 'Submissões não excluídas',
      icon: FileStack,
    },
    {
      testId: 'metric-certificates',
      label: 'Certificados',
      value: metrics.certificates,
      hint: 'Emitidos e assinados',
      icon: Award,
    },
    {
      testId: 'metric-xp',
      label: 'Lançamentos de XP',
      value: metrics.xpTransactions,
      hint: 'Fatos de gamificação',
      icon: Zap,
    },
  ];

  return (
    <div className="space-y-8" data-testid="platform-overview">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Visão geral</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consolidação de todas as instituições. Números agregados — o painel não expõe dados de
            participantes.
          </p>
        </div>

        <p className="text-[11px] text-muted-foreground" data-testid="metrics-generated-at">
          Apurado em {metrics.generatedAt.toISOString()}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <article
            key={card.testId}
            data-testid={card.testId}
            data-value={card.value}
            className={`rounded-xl border p-5 ${
              card.alert ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {card.label}
              </p>
              <card.icon
                className={`size-4 ${card.alert ? 'text-destructive' : 'text-muted-foreground'}`}
                aria-hidden
              />
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-foreground">{card.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-border bg-card p-6" data-testid="platform-audit">
        <header className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-foreground">Últimas ações de plataforma</h2>
          <Link
            href="/superadmin/tenants"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Gerenciar instituições
          </Link>
        </header>

        {audit.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground" data-testid="platform-audit-empty">
            Nenhuma ação de governança registrada ainda. Provisionamentos, suspensões e mudanças de
            perfil aparecem aqui.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border" data-testid="platform-audit-list">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
                <span className="font-mono text-[11px] uppercase text-muted-foreground">
                  {entry.action}
                </span>
                <span className="text-sm text-foreground">{entry.entityType}</span>
                <span className="text-xs text-muted-foreground">
                  {entry.actorName ?? 'sistema'}
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {entry.createdAt.toISOString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
