import Link from 'next/link';
import { CalendarCog, FileBadge, History, Layers, ListChecks, Settings2, Ticket, Users } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { can } from '@/domain/rbac/authorization';
import { getRequestContext } from '@/lib/auth/session';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminOverview } from '@/lib/admin/catalog-service';
import { listAuditLog } from '@/lib/admin/audit';
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  SectionHeading,
  StatCard,
} from '@/components/ui';

export const metadata = { title: 'Administração' };
export const dynamic = 'force-dynamic';

/**
 * Painel administrativo — porta de entrada (FASE 11A: identidade visual).
 *
 * Mostra os números da instituição e a TRILHA DE AUDITORIA. A trilha fica na tela
 * inicial de propósito: quem administra precisa ver, sem procurar, que toda
 * alteração fica registrada com autor e horário.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA DEMONSTRA DO SISTEMA DE DESIGN
 * ─────────────────────────────────────────────────────────────────────────────
 *  É a tela-exemplo do padrão para qualquer módulo novo: `PageHeader` com trilha
 *  de navegação, indicadores com `StatCard`, áreas de gestão em grade de cartões,
 *  lista com `SectionHeading` e estado vazio com `EmptyState`. Nenhuma classe de
 *  cor ou tamanho de fonte é escrita aqui — tudo vem dos primitivos.
 *
 *  Os `data-testid` (`admin-stats`, `admin-areas`, `audit-log`, `stat-*`) foram
 *  preservados: os testes E2E das FASES 7 e 9 dependem deles, e mudar aparência
 *  não é motivo para mudar contrato de teste.
 * ─────────────────────────────────────────────────────────────────────────────
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
    {
      // FASE 14: quem responde pela instituição e quem é público do evento. A tela
      // existe porque a inscrição pública (FASE 10) criou vínculo para participante
      // e a instituição passou a ver "membros" onde havia inscritos.
      //
      // A guarda é a da seção de administração (`tenant:member:invite`), e não
      // `tenant:read`: participante TEM `tenant:read` e não pode ler e-mails da
      // equipe (ver a nota na própria tela).
      href: '/administracao/equipe',
      label: 'Equipe e participantes',
      description: 'Membros da equipe com seus papéis, público dos eventos e uso da quota do plano.',
      icon: Users,
      permission: PERMISSIONS.TENANT_MEMBER_INVITE,
      metric: `${overview.members} membro(s) · ${overview.participants} participante(s)`,
    },
  ].filter((area) => can(principal, area.permission, { scope: 'TENANT' }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Administração"
        description="Toda alteração feita aqui é registrada na trilha de auditoria com autor e horário."
        breadcrumbs={[{ label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') }, { label: 'Administração' }]}
        badge={<Badge tone="primary">{tenantName}</Badge>}
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="admin-stats">
        <StatCard
          label="Eventos publicados"
          value={overview.publishedEvents}
          data-testid="stat-Eventos publicados"
          icon={<CalendarCog className="size-4" aria-hidden />}
          tone="primary"
        />
        <StatCard
          label="Inscrições confirmadas"
          value={overview.registrations}
          data-testid="stat-Inscrições confirmadas"
        />
        <StatCard
          label="Presenças"
          value={overview.attendees}
          data-testid="stat-Presenças"
          tone="success"
        />
        <StatCard
          label="Submissões"
          value={overview.submissions}
          data-testid="stat-Submissões"
        />
      </section>

      <section className="space-y-4" aria-labelledby="areas">
        <SectionHeading
          title="Áreas de gestão"
          description="O que existe na instituição hoje, com os atalhos para cada módulo."
        />

        {areas.length === 0 ? (
          <EmptyState
            icon={Settings2}
            title="Nenhuma área disponível para o seu perfil"
            description="Seu papel atual não inclui gestão. Fale com a organização se isso não estiver correto."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2" data-testid="admin-areas">
            {areas.map((area) => (
              <li key={area.href}>
                <Link href={tenantPath(tenantSlug, area.href)} className="block h-full">
                  <Card className="h-full transition-colors hover:border-primary/50">
                    <CardContent className="flex gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-brand">
                        <area.icon className="size-5" aria-hidden />
                      </span>
                      <span className="min-w-0 space-y-1">
                        <span className="block text-sm font-medium text-foreground">{area.label}</span>
                        <span className="block text-xs text-muted-foreground">{area.description}</span>
                        <span className="label-caps block pt-1">{area.metric}</span>
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="trilha">
        <SectionHeading
          title="Trilha de auditoria"
          description="Últimas alterações registradas nesta instituição."
        />

        {audit.length === 0 ? (
          <EmptyState
            icon={History}
            title="Nenhuma alteração registrada ainda"
            description="Assim que alguém criar ou editar um evento, a entrada aparece aqui com autor e horário."
          />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border" data-testid="audit-log">
              {audit.map((entry) => {
                const fields = Object.keys(entry.changes);

                return (
                  <li key={entry.id} className="space-y-1 px-5 py-4">
                    <p className="flex flex-wrap items-baseline gap-2 text-sm">
                      <Badge tone="neutral" size="sm">
                        {entry.action}
                      </Badge>
                      <span className="font-medium text-foreground">{entry.entityType}</span>
                      <span className="text-xs text-muted-foreground">
                        {entry.actorName ?? 'sistema'} ·{' '}
                        {entry.createdAt.toLocaleString('pt-BR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </p>
                    {fields.length > 0 ? (
                      <p className="text-xs text-muted-foreground">campos: {fields.join(', ')}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
