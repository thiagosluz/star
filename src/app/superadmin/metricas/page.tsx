import Link from 'next/link';
import {
  Activity,
  Award,
  Building2,
  CalendarDays,
  FileStack,
  Flag,
  ShieldAlert,
  Users,
  Zap,
} from 'lucide-react';

import { requirePlatformPermission } from '@/lib/platform/guard';
import { getPlatformMetrics, listPlatformAudit } from '@/lib/platform/global-repository';
import { countOpenReports } from '@/lib/platform/profile-moderation';
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

  const [metrics, audit, openReports] = await Promise.all([
    getPlatformMetrics(),
    listPlatformAudit({ limit: 10 }),
    countOpenReports(),
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
          // Membros e participantes separados (FASE 14): só o vínculo de equipe
          // consome quota de plano; o público dos eventos é informativo.
          hint={`${metrics.memberships} membro(s) · ${metrics.participants} participante(s)`}
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

      {/**
       * ─── O ATALHO DA MODERAÇÃO (FASE 56 · E62) ─────────────────────────────────
       *
       *  Denúncia aberta é conteúdo possivelmente ofensivo que continua no ar: é
       *  trabalho que não pode esperar, e por isso a entrada da fila fica na VISÃO
       *  GERAL, e não escondida em um menu.
       *
       *  A contagem é a de `countOpenReports`, e `null` (não consegui contar) sai SEM
       *  número — afirmar zero sem ter contado é pior do que não afirmar nada (a
       *  régua da FASE 54: zero é uma contagem, `null` é a ausência dela).
       */}
      <section
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5"
        data-testid="platform-moderation-shortcut"
        data-open={openReports === null ? 'unknown' : String(openReports)}
      >
        <div className="flex items-start gap-3">
          <Flag className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <h2 className="font-display text-title text-foreground">Denúncias de perfil</h2>
            <p className="text-sm text-muted-foreground">
              {openReports === null
                ? 'Fila de moderação dos perfis públicos.'
                : openReports === 0
                  ? 'Nenhuma denúncia aguardando decisão.'
                  : openReports === 1
                    ? '1 denúncia aguardando decisão.'
                    : `${openReports} denúncias aguardando decisão.`}
            </p>
          </div>
        </div>

        <Link
          href="/superadmin/denuncias"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          data-testid="platform-moderation-link"
        >
          Abrir a fila
        </Link>
      </section>

      <section className="space-y-4" data-testid="platform-audit">        <SectionHeading
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
