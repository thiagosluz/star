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
import { Badge, Card, EmptyState, PageHeader, SectionHeading, StatCard } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  VISÃO GERAL DA PLATAFORMA (FASE 11A: identidade visual)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  MÉTRICA DE GOVERNANÇA É CONTAGEM, NÃO LISTA DE PESSOAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O painel responde "quantas", nunca "quem". Um governante de plataforma não
 *  precisa — e não deve — ler a lista de participantes de cada instituição: isso
 *  transformaria o papel de plataforma em um superpoder de leitura sobre dados de
 *  terceiros. As contagens vêm de `COUNT` no banco, agregadas.
 *
 *  O número que importa para a operação é o de SUSPENSAS: é o que exige ação
 *  (contato, cobrança, reativação). Por isso ele aparece com `tone="danger"`, e
 *  não escondido em uma tabela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PlatformOverviewPage() {
  await requirePlatformPermission();

  const [metrics, audit] = await Promise.all([
    getPlatformMetrics(),
    listPlatformAudit({ limit: 10 }),
  ]);

  return (
    <div className="space-y-8" data-testid="platform-overview">
      <PageHeader
        title="Métricas da plataforma"
        description="Consolidação de todas as instituições. Números agregados — o painel não expõe dados de participantes."
        breadcrumbs={[{ label: 'Plataforma' }, { label: 'Métricas' }]}
        badge={<Badge tone="primary">SuperAdmin</Badge>}
        actions={
          <p className="text-xs text-muted-foreground" data-testid="metrics-generated-at">
            Apurado em {metrics.generatedAt.toISOString()}
          </p>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Instituições"
          value={metrics.tenants.total}
          hint={`${metrics.tenants.active} ativas · ${metrics.tenants.public} no diretório`}
          icon={<Building2 className="size-4" aria-hidden />}
          tone="primary"
          data-testid="metric-tenants"
          data-value={metrics.tenants.total}
        />
        <StatCard
          label="Suspensas"
          value={metrics.tenants.suspended}
          hint={metrics.tenants.suspended > 0 ? 'Requer acompanhamento' : 'Nenhuma pendência'}
          icon={<ShieldAlert className="size-4" aria-hidden />}
          tone={metrics.tenants.suspended > 0 ? 'danger' : 'neutral'}
          data-testid="metric-suspended"
          data-value={metrics.tenants.suspended}
        />
        <StatCard
          label="Contas"
          value={metrics.users}
          hint={`${metrics.memberships} vínculos ativos`}
          icon={<Users className="size-4" aria-hidden />}
          data-testid="metric-users"
          data-value={metrics.users}
        />
        <StatCard
          label="Eventos"
          value={metrics.events.total}
          hint={`${metrics.events.open} com inscrições abertas`}
          icon={<CalendarDays className="size-4" aria-hidden />}
          data-testid="metric-events"
          data-value={metrics.events.total}
        />
        <StatCard
          label="Inscrições"
          value={metrics.registrations}
          hint="Confirmadas ou com presença"
          icon={<Activity className="size-4" aria-hidden />}
          data-testid="metric-registrations"
          data-value={metrics.registrations}
        />
        <StatCard
          label="Trabalhos"
          value={metrics.submissions}
          hint="Submissões não excluídas"
          icon={<FileStack className="size-4" aria-hidden />}
          data-testid="metric-submissions"
          data-value={metrics.submissions}
        />
        <StatCard
          label="Certificados"
          value={metrics.certificates}
          hint="Emitidos e assinados"
          icon={<Award className="size-4" aria-hidden />}
          tone="success"
          data-testid="metric-certificates"
          data-value={metrics.certificates}
        />
        <StatCard
          label="Lançamentos de XP"
          value={metrics.xpTransactions}
          hint="Fatos de gamificação"
          icon={<Zap className="size-4" aria-hidden />}
          data-testid="metric-xp"
          data-value={metrics.xpTransactions}
        />
      </section>

      <section className="space-y-4" data-testid="platform-audit">
        <SectionHeading
          title="Últimas ações de plataforma"
          description="Provisionamentos, suspensões e mudanças de perfil, com autor e horário."
          actions={
            <Link
              href="/superadmin/tenants"
              className="text-sm text-brand underline-offset-4 hover:underline"
            >
              Gerenciar instituições
            </Link>
          }
        />

        {audit.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="Nenhuma ação de governança registrada ainda"
            description="Provisionamentos, suspensões e mudanças de perfil aparecem aqui, na ordem em que acontecerem."
            data-testid="platform-audit-empty"
          />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border" data-testid="platform-audit-list">
              {audit.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-4">
                  <Badge tone="neutral" size="sm">
                    {entry.action}
                  </Badge>
                  <span className="text-sm text-foreground">{entry.entityType}</span>
                  <span className="text-xs text-muted-foreground">{entry.actorName ?? 'sistema'}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
