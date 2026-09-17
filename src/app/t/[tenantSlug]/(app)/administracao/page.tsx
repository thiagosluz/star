import Link from 'next/link';
import { CalendarCog, FileBadge, History, Layers, ListChecks, Settings2, Ticket } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { can } from '@/domain/rbac/authorization';
import { getRequestContext } from '@/lib/auth/session';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminOverview } from '@/lib/admin/catalog-service';
import { listAuditLog } from '@/lib/admin/audit';

export const metadata = { title: 'Administração' };
export const dynamic = 'force-dynamic';

/**
 * Painel administrativo — porta de entrada.
 *
 * Mostra os números da instituição e a TRILHA DE AUDITORIA. A trilha fica na tela
 * inicial de propósito: quem administra precisa ver, sem procurar, que toda
 * alteração fica registrada com autor e horário.
 */
export default async function AdminHomePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.TENANT_MEMBER_INVITE,
  });

  const context = await getRequestContext();
  const principal = context?.principal;

  const [overview, audit] = await Promise.all([
    getAdminOverview(tenantId),
    listAuditLog(tenantId, { limit: 15 }),
  ]);

  const areas = [
    {
      href: '/administracao/eventos',
      label: 'Eventos, atividades e salas',
      description: 'Criar e editar eventos, programar atividades, salas e trilhas da chamada de trabalhos.',
      icon: CalendarCog,
      permission: PERMISSIONS.EVENT_UPDATE,
      metric: `${overview.events} evento(s) · ${overview.activities} atividade(s)`,
    },
    {
      href: '/administracao/cartas',
      label: 'Cartas colecionáveis',
      description: 'Catálogo com raridade, paleta, arte, gatilho e tiragem.',
      icon: Layers,
      permission: PERMISSIONS.CARD_TEMPLATE_MANAGE,
      metric: `${overview.cards} carta(s)`,
    },
    {
      href: '/administracao/missoes',
      label: 'Missões',
      description: 'Metas que geram XP e cartas, com janela de validade e recompensa.',
      icon: ListChecks,
      permission: PERMISSIONS.TASK_MANAGE,
      metric: `${overview.missions} missão(ões)`,
    },
    {
      href: '/administracao/certificados',
      label: 'Certificados',
      description: 'Acompanhar emissões, reprocessar falhas e revogar documentos.',
      icon: FileBadge,
      permission: PERMISSIONS.CERTIFICATE_ISSUE,
      metric: `${overview.certificates} certificado(s)`,
    },
    {
      href: '/credenciamento',
      label: 'Credenciamento',
      description: 'Check-in por crachá (leitor de QR) e por busca, com registro de saída.',
      icon: Ticket,
      permission: PERMISSIONS.REGISTRATION_CHECKIN,
      metric: `${overview.attendees} presença(s) registrada(s)`,
    },
  ].filter((area) => can(principal, area.permission, { scope: 'TENANT' }));

  const stats = [
    { label: 'Eventos publicados', value: overview.publishedEvents },
    { label: 'Inscrições confirmadas', value: overview.registrations },
    { label: 'Presenças', value: overview.attendees },
    { label: 'Submissões', value: overview.submissions },
  ];

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <header className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Settings2 className="size-6 text-primary" aria-hidden />
          Administração
        </h1>
        <p className="text-sm text-muted-foreground">
          Toda alteração feita aqui é registrada na trilha de auditoria com autor e horário.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-4" data-testid="admin-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold" data-testid={`stat-${stat.label}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </section>

      <section className="space-y-3" aria-labelledby="areas">
        <h2 id="areas" className="text-lg font-semibold tracking-tight">
          Áreas de gestão
        </h2>

        <ul className="grid gap-4 sm:grid-cols-2" data-testid="admin-areas">
          {areas.map((area) => (
            <li key={area.href}>
              <Link
                href={tenantPath(tenantSlug, area.href)}
                className="flex h-full gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-primary/50"
              >
                <area.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">{area.label}</span>
                  <span className="block text-xs text-muted-foreground">{area.description}</span>
                  <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                    {area.metric}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="trilha">
        <h2 id="trilha" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <History className="size-4" aria-hidden />
          Trilha de auditoria
        </h2>

        {audit.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            Nenhuma alteração registrada ainda.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="audit-log">
            {audit.map((entry) => {
              const fields = Object.keys(entry.changes);

              return (
                <li key={entry.id} className="space-y-0.5 p-3">
                  <p className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                      {entry.action}
                    </span>
                    <span className="font-medium">{entry.entityType}</span>
                    <span className="text-xs text-muted-foreground">
                      {entry.actorName ?? 'sistema'} ·{' '}
                      {entry.createdAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </p>
                  {fields.length > 0 ? (
                    <p className="text-[11px] text-muted-foreground">campos: {fields.join(', ')}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
