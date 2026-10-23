import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Building2,
  Mail,
  Phone,
  Calendar,
  Clock,
  MessageSquare,
} from 'lucide-react';

import { requirePlatformPermission } from '@/lib/platform/guard';
import { listInstitutionLeads } from '@/lib/platform/global-repository';
import { Badge, buttonClasses, PageHeader } from '@/components/ui';
import { PLATFORM_CRUMB, PLATFORM_NAV_GROUP } from '@/components/shell/tenant-nav';
import {
  LEAD_STATUS_LABELS,
  isLeadStatus,
  type LeadStatusKey,
} from '@/domain/platform/lead-rules';
import { LeadStatusForm } from '@/components/platform/lead-status-form';

export const metadata: Metadata = {
  title: 'Leads Institucionais · Superadmin',
};

export const dynamic = 'force-dynamic';

interface LeadsPageProps {
  searchParams: Promise<{
    status?: string;
    pagina?: string;
  }>;
}

export default async function PlatformLeadsPage({ searchParams }: LeadsPageProps) {
  await requirePlatformPermission();

  const params = await searchParams;
  const statusFilter = params.status && isLeadStatus(params.status) ? (params.status as LeadStatusKey) : undefined;
  const page = Number.parseInt(params.pagina ?? '1', 10);
  const validPage = Number.isFinite(page) && page > 0 ? page : 1;

  const { items: leads, total } = await listInstitutionLeads({
    status: statusFilter,
    page: validPage,
    pageSize: 20,
  });

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <main className="space-y-8" data-testid="platform-leads-page">
      <PageHeader
        eyebrow={PLATFORM_NAV_GROUP}
        title="Contatos e Leads Institucionais"
        icon={<Building2 className="size-6 text-muted-foreground" aria-hidden />}
        description="Universidades, faculdades, sociedades científicas e empresas interessadas no EventFlow."
        breadcrumbs={[PLATFORM_CRUMB, { label: 'Leads de Expansão' }]}
        badge={<Badge tone="primary">SuperAdmin</Badge>}
        actions={
          <Link
            href="/para-instituicoes"
            target="_blank"
            className={buttonClasses({ variant: 'outline', size: 'sm' })}
          >
            Ver página pública
          </Link>
        }
      />

      {/* ─── FILTROS DE STATUS ──────────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center gap-2 border-b border-border pb-4" data-testid="leads-filter-tabs">
        <Link
          href="/superadmin/leads"
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            !statusFilter
              ? 'bg-primary text-primary-foreground'
              : 'border border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          Todos ({total})
        </Link>
        {(Object.keys(LEAD_STATUS_LABELS) as LeadStatusKey[]).map((st) => (
          <Link
            key={st}
            href={`/superadmin/leads?status=${st}`}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              statusFilter === st
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {LEAD_STATUS_LABELS[st]}
          </Link>
        ))}
      </section>

      {/* ─── LISTAGEM DE LEADS ──────────────────────────────────────────────── */}
      {leads.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-border bg-card p-12 text-center space-y-3"
          data-testid="leads-empty-state"
        >
          <Building2 className="mx-auto size-10 text-muted-foreground" aria-hidden />
          <h3 className="text-base font-semibold text-foreground">Nenhum contato encontrado</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            {statusFilter
              ? `Não há contatos registrados na situação "${LEAD_STATUS_LABELS[statusFilter]}".`
              : 'Nenhum lead registrado no formulário institucional até o momento.'}
          </p>
        </div>
      ) : (
        <section className="grid gap-6 lg:grid-cols-2" data-testid="leads-list">
          {leads.map((lead) => {
            const statusLabel = LEAD_STATUS_LABELS[lead.status as LeadStatusKey] ?? lead.status;
            return (
              <article
                key={lead.id}
                className="flex flex-col justify-between rounded-xl border border-border bg-card p-6 shadow-2xs space-y-5"
                data-testid={`lead-card-${lead.id}`}
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold text-foreground">
                        {lead.organization}
                      </h2>
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <span className="font-semibold text-foreground">{lead.name}</span>
                        {lead.roleInOrg ? <span>· {lead.roleInOrg}</span> : null}
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        lead.status === 'OPEN'
                          ? 'bg-primary/10 text-primary'
                          : lead.status === 'QUALIFIED'
                          ? 'bg-success/15 text-success'
                          : lead.status === 'CONTACTED'
                          ? 'bg-warning/15 text-warning'
                          : 'bg-muted text-muted-foreground'
                      }`}
                      data-testid={`lead-status-badge-${lead.id}`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg border border-border/50">
                    <div className="flex items-center gap-2">
                      <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <a href={`mailto:${lead.email}`} className="text-foreground hover:underline truncate">
                        {lead.email}
                      </a>
                    </div>

                    {lead.phone ? (
                      <div className="flex items-center gap-2">
                        <Phone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="text-foreground">{lead.phone}</span>
                      </div>
                    ) : null}

                    {lead.estimatedEventsPerYear ? (
                      <div className="flex items-center gap-2">
                        <Calendar className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span>{lead.estimatedEventsPerYear}</span>
                      </div>
                    ) : null}

                    <div className="flex items-center gap-2">
                      <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span>{new Date(lead.createdAt).toLocaleDateString('pt-BR')} às {new Date(lead.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>

                  {lead.message ? (
                    <div className="space-y-1 text-xs">
                      <span className="font-semibold text-foreground flex items-center gap-1">
                        <MessageSquare className="size-3" aria-hidden />
                        Mensagem do interessado:
                      </span>
                      <p className="rounded-md bg-muted/40 p-3 text-muted-foreground leading-relaxed whitespace-pre-wrap">
                        {lead.message}
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="pt-4 border-t border-border">
                  <LeadStatusForm
                    leadId={lead.id}
                    currentStatus={lead.status as LeadStatusKey}
                    currentNotes={lead.internalNotes}
                  />
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* ─── PAGINAÇÃO ──────────────────────────────────────────────────────── */}
      {totalPages > 1 ? (
        <nav className="flex items-center justify-between border-t border-border pt-4 text-xs">
          <span className="text-muted-foreground">
            Página {validPage} de {totalPages} ({total} leads)
          </span>

          <div className="flex items-center gap-2">
            {validPage > 1 ? (
              <Link
                href={`/superadmin/leads?${new URLSearchParams({
                  ...(statusFilter ? { status: statusFilter } : {}),
                  pagina: String(validPage - 1),
                }).toString()}`}
                className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
              >
                Anterior
              </Link>
            ) : null}

            {validPage < totalPages ? (
              <Link
                href={`/superadmin/leads?${new URLSearchParams({
                  ...(statusFilter ? { status: statusFilter } : {}),
                  pagina: String(validPage + 1),
                }).toString()}`}
                className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
              >
                Próxima
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </main>
  );
}
