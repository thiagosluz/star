import Link from 'next/link';
import { CalendarPlus, Pencil, Plus } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { formatEventPeriod } from '@/domain/events/event-rules';
import {
  EVENT_ARCHIVE_FILTERS,
  EVENT_ARCHIVE_FILTER_LABELS,
  buildAdminEventsHref,
  eventStatusLabel,
  filterEventsByArchive,
  resolveEventArchiveFilter,
} from '@/domain/events/event-lifecycle-rules';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { Badge, PageHeader, type BadgeTone } from '@/components/ui';
import { EventLifecycleActions } from '@/components/admin/event-lifecycle-actions';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Eventos' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GESTÃO DE EVENTOS DA INSTITUIÇÃO — `/t/<slug>/administracao/eventos`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LISTA É O ACERVO; O CADASTRO TEM ROTA PRÓPRIA (FASE 90)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 89, esta página misturava a listagem de eventos com o formulário de
 *  criação de 17 campos em um mesmo documento. O acervo e o cadastro competiam por
 *  atenção, e com vários eventos cadastrados o formulário ficava empurrado para o fim.
 *
 *  A FASE 90 separou as duas intenções:
 *    • `/administracao/eventos` é o cockpit de consulta e acesso rápido aos eventos;
 *    • `/administracao/eventos/novo` é a página dedicada de cadastro do novo evento;
 *    • O botão "Novo evento" vive no slot `actions` do `PageHeader`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function eventStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'PUBLISHED':
    case 'REGISTRATION_OPEN':
    case 'IN_PROGRESS':
      return 'success';
    case 'DRAFT':
      return 'warning';
    case 'CANCELED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export default async function AdminEventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams?: Promise<{ situacao?: string }>;
}) {
  const { tenantSlug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const activeFilter = resolveEventArchiveFilter(resolvedSearchParams?.situacao);

  const { tenantId, principal } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });

  const canCreate = principal ? can(principal, PERMISSIONS.EVENT_CREATE, { scope: 'TENANT' }) : true;
  const canDelete = principal ? can(principal, PERMISSIONS.EVENT_DELETE, { scope: 'TENANT' }) : true;

  const allEvents = await listAdminEvents(tenantId);
  const events = filterEventsByArchive(allEvents, activeFilter);
  const baseHref = tenantPath(tenantSlug, '/administracao/eventos');
  const filterCounts = {
    todos: allEvents.length,
    ativos: allEvents.filter((event) => event.status !== 'ARCHIVED').length,
    arquivados: allEvents.filter((event) => event.status === 'ARCHIVED').length,
  };

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeader
        title="Eventos"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<CalendarPlus className="size-6 text-primary" aria-hidden />}
        description="O evento é a raiz de tudo: atividades, salas, chamada de trabalhos, inscrições e certificados pertencem a ele."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos' },
        ]}
        actions={
          <Link
            href={tenantPath(tenantSlug, '/administracao/eventos/novo')}
            data-testid="btn-novo-evento"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden />
            Novo evento
          </Link>
        }
      />

      <section className="space-y-3" aria-labelledby="lista-eventos">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="lista-eventos" className="text-lg font-semibold tracking-tight text-foreground">
            Eventos da instituição
          </h2>

          <nav
            aria-label="Filtrar eventos por situação"
            data-testid="events-filter-tabs"
            className="flex flex-wrap items-center gap-1.5"
          >
            {EVENT_ARCHIVE_FILTERS.map((filter) => {
              const selected = filter === activeFilter;
              return (
                <Link
                  key={filter}
                  href={buildAdminEventsHref(baseHref, filter)}
                  data-testid={`events-filter-${filter}`}
                  aria-current={selected ? 'page' : undefined}
                  className={
                    selected
                      ? 'rounded-full border border-primary bg-primary-soft px-3 py-1 text-xs font-semibold text-brand transition'
                      : 'rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition hover:bg-surface-low hover:text-foreground'
                  }
                >
                  {EVENT_ARCHIVE_FILTER_LABELS[filter]} ({filterCounts[filter]})
                </Link>
              );
            })}
          </nav>
        </div>

        {events.length === 0 ? (
          <div
            className="space-y-2 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
            data-testid="events-empty"
          >
            <p>
              Nenhum evento cadastrado.{' '}
              <Link
                href={tenantPath(tenantSlug, '/administracao/eventos/novo')}
                className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
              >
                Cadastre o primeiro evento
              </Link>{' '}
              para começar.
            </p>
            {/**
             * ─────────────────────────────────────────────────────────────────────
             *  A PORTA PARA O EXEMPLO (FASE 77 · fatia 3)
             * ─────────────────────────────────────────────────────────────────────
             *  O organizador novo chega nesta tela com a lista vazia e sem saber
             *  como é um evento por dentro. O exemplo é a resposta barata: uma tela
             *  de LEITURA com dados fictícios, que não cria nada, não consome a
             *  quota e não deixa lixo para apagar (o porquê está no documento da
             *  fatia). O link fica AQUI, no estado vazio, e não no menu: ele é uma
             *  ajuda para quem está começando, não uma área do produto.
             */}
            <p>
              <Link
                href={tenantPath(tenantSlug, '/exemplo')}
                data-testid="events-empty-demo-link"
                className="font-medium text-brand underline underline-offset-4"
              >
                Ver um evento de exemplo, sem cadastrar nada
              </Link>{' '}
              — dados fictícios, nada é gravado.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="admin-event-list">
            {events.map((event) => {
              const dateLabel = event.timezone
                ? formatEventPeriod(
                    { startsAt: event.startsAt, endsAt: event.endsAt ?? event.startsAt },
                    event.timezone,
                  )
                : event.startsAt.toLocaleDateString('pt-BR');

              return (
                <li
                  key={event.id}
                  data-testid={`event-row-${event.slug}`}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{event.title}</p>
                      <Badge tone={eventStatusTone(event.status)} size="sm" withDot>
                        {eventStatusLabel(event.status)}
                      </Badge>
                    </div>
                    <p className="code-data text-muted-foreground">/t/{tenantSlug}/eventos/{event.slug}</p>
                    <p className="text-xs text-muted-foreground">
                      {dateLabel} · {event.activityCount} atividade(s) · {event.trackCount} trilha(s) ·{' '}
                      {event.roomCount} sala(s) · {event.registrationCount} inscrição(ões)
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={tenantPath(tenantSlug, `/administracao/eventos/${event.id}/dados`)}
                      data-testid={`edit-event-${event.slug}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                      Editar dados
                    </Link>

                    <Link
                      href={tenantPath(tenantSlug, `/administracao/eventos/${event.id}`)}
                      data-testid={`manage-${event.slug}`}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
                    >
                      Gerenciar
                    </Link>

                    <EventLifecycleActions
                      tenantSlug={tenantSlug}
                      event={{
                        id: event.id,
                        slug: event.slug,
                        title: event.title,
                        status: event.status,
                        startsAtIso: event.startsAt.toISOString(),
                        endsAtIso: (event.endsAt ?? event.startsAt).toISOString(),
                      }}
                      canCreate={canCreate}
                      canDelete={canDelete}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
