import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Globe, Mail, UserCog } from 'lucide-react';

import { TenantProfileForm, TenantStatusForm } from '@/components/platform/platform-forms';
import { requirePlatformPermission } from '@/lib/platform/guard';
import { getTenantDetail } from '@/lib/platform/tenant-service';
import { listPlatformAudit } from '@/lib/platform/global-repository';
import { TENANT_PLAN_LABELS, TENANT_STATUS_LABELS } from '@/domain/platform/platform-rules';
import { tenantPath } from '@/domain/tenancy/resolution';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DETALHE DA INSTITUIÇÃO — `/superadmin/tenants/[tenantId]`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TELA RESPONDE A UMA PERGUNTA: "por que esta instituição pediu ajuda?"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Por isso ela traz, na mesma página: o estado (com o motivo da suspensão, se
 *  houver), quem responde por ela (membros e papéis), o que existe dentro (eventos,
 *  membros, certificados) e o que a plataforma já fez ali (trilha auditada).
 *
 *  O hipersuporte prático é este: em vez de perguntar ao dono o que ele vê, o
 *  suporte vê o mesmo — sem entrar na instituição e sem impersonar ninguém.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SER MEMBRO DA INSTITUIÇÃO NÃO CONCEDE NADA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A guarda exige o papel de PLATAFORMA. Ser OWNER da instituição X dá acesso ao
 *  painel de X — nunca a este. São eixos de autoridade diferentes (ver ADR da
 *  fase), e é o que impede uma instituição de suspender a concorrente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PlatformTenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  await requirePlatformPermission();

  const { tenantId } = await params;

  const detail = await getTenantDetail(tenantId);
  if (!detail) notFound();

  const { tenant, members } = detail;
  const audit = await listPlatformAudit({ entityId: tenant.id, limit: 20 });

  const publicPath = tenantPath(tenant.slug, '/eventos');

  return (
    <div className="space-y-8" data-testid="platform-tenant-detail" data-tenant-slug={tenant.slug}>
      <header className="space-y-4">
        <Link
          href="/superadmin/tenants"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Instituições
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground" data-testid="tenant-detail-name">
              {tenant.name}
            </h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">/{tenant.slug}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span
              data-testid="tenant-detail-status"
              data-status={tenant.status}
              className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground"
            >
              {TENANT_STATUS_LABELS[tenant.status]}
            </span>
            <Link
              href={publicPath}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Abrir página pública
            </Link>
          </div>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="tenant-detail-metrics">
        {[
          { label: 'Eventos', value: tenant.eventCount },
          { label: 'Membros ativos', value: tenant.memberCount },
          { label: 'Certificados emitidos', value: tenant.certificateCount },
          { label: 'Quotas', value: `${tenant.maxEvents} / ${tenant.maxMembers}` },
        ].map((item) => (
          <article key={item.label} className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{item.value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <TenantStatusForm tenantId={tenant.id} status={tenant.status} />
        <TenantProfileForm
          tenantId={tenant.id}
          description={tenant.description}
          logoUrl={tenant.logoUrl}
          websiteUrl={tenant.websiteUrl}
          isPublic={tenant.isPublic}
        />
      </section>

      {tenant.status === 'SUSPENDED' ? (
        <section
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-5"
          data-testid="tenant-suspension-info"
        >
          <h2 className="text-sm font-semibold text-destructive">Suspensão vigente</h2>
          <p className="mt-2 text-sm text-foreground">{tenant.suspensionReason}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Desde {tenant.suspendedAt?.toISOString().slice(0, 16).replace('T', ' ')} — o tráfego da
            instituição está cortado.
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border p-5">
          <h2 className="text-base font-semibold text-foreground">Quem responde pela instituição</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Vínculos ativos e papéis vigentes. O convite de novos membros é feito pela própria
            instituição — a plataforma não impersona ninguém.
          </p>
        </header>

        {members.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground" data-testid="tenant-members-empty">
            Nenhum vínculo registrado.
          </p>
        ) : (
          <ul className="divide-y divide-border" data-testid="tenant-members">
            {members.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <UserCog className="size-4" aria-hidden />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {member.name}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="size-3" aria-hidden />
                    {member.email}
                  </span>
                </span>

                <span className="flex flex-wrap gap-1">
                  {member.roles.length === 0 ? (
                    <span className="text-xs text-muted-foreground">sem papel vigente</span>
                  ) : (
                    member.roles.map((role) => (
                      <span
                        key={`${role.role}-${role.scope}`}
                        className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground"
                      >
                        {role.role}
                      </span>
                    ))
                  )}
                </span>

                <span className="text-xs uppercase text-muted-foreground">
                  {member.membershipStatus}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Trilha da plataforma</h2>

        {audit.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="tenant-audit-empty">
            Nenhuma ação de plataforma registrada para esta instituição.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border" data-testid="tenant-audit">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 py-3 text-sm">
                <span className="font-mono text-xs uppercase text-muted-foreground">
                  {entry.action}
                </span>
                <span className="text-foreground">{entry.entityType}</span>
                <span className="text-xs text-muted-foreground">{entry.actorName ?? 'sistema'}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <Globe className="size-3.5" aria-hidden />
          Plano {TENANT_PLAN_LABELS[tenant.plan]}
          {tenant.customDomain ? ` · domínio ${tenant.customDomain}` : ''} · criada em{' '}
          {tenant.createdAt.toISOString().slice(0, 10)}
        </p>
      </section>
    </div>
  );
}
