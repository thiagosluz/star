import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BadgeCheck, Handshake, Pencil, Plus, QrCode, Tags } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { withTenant } from '@/lib/db/tenant-client';
import { listSponsorBoard } from '@/lib/admin/sponsor-service';
import {
  SPONSOR_LOGO_SCALE_LABELS,
  SPONSOR_TABS,
  SPONSOR_TAB_LABELS,
  SPONSOR_TIER_LABELS,
  buildEventSponsorsHref,
  computeSponsorKpiSummary,
  resolveSponsorTab,
  sponsorTierTint,
  type ContractState,
  type SponsorTab,
} from '@/domain/events/sponsor-rules';
import { SponsorKpiCards } from '@/components/admin/sponsor-kpi-cards';
import { SponsorExperiencePanel } from '@/components/admin/sponsor-experience-panel';
import { getDataExport, listRecentDataExports } from '@/lib/exports/export-service';
import {
  getEventSponsorExperienceCounts,
  listSponsorLeads,
  listSponsorQrCodes,
  listSponsorTeam,
} from '@/lib/sponsors/sponsor-portal-service';
import { sponsorQrSheet, type SponsorQrSheet } from '@/lib/sponsors/sponsor-qr-sheet';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { AssetUploader } from '@/components/admin/asset-uploader';
import {
  confirmAssetUploadAction,
  requestAssetUploadAction,
} from '@/app/actions/landing-actions';
import {
  deleteTierAction,
  removeSponsorAction,
  setSponsorActiveAction,
  syncSponsorAction,
} from '@/app/actions/sponsor-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Patrocinadores do evento' };
export const dynamic = 'force-dynamic';

const CONTRACT_TONE: Record<ContractState, string> = {
  ACTIVE: 'text-success-strong',
  SCHEDULED: 'text-muted-foreground',
  EXPIRED: 'text-destructive',
  UNKNOWN: 'text-muted-foreground',
};

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}

async function listCardTemplateOptions(
  tenantId: string,
): Promise<{ value: string; label: string }[]> {
  return withTenant(tenantId, async (tx) => {
    const cards = await tx.cardTemplate.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    return cards.map((card) => ({ value: card.id, label: card.name }));
  });
}

/**
 * Cockpit de patrocínio do evento por intenção (FASE 125).
 *
 * Separa em 3 abas reais na URL (`patrocinadores`, `cotas`, `estandes`), mantém
 * a faixa executiva fixa no topo (`SponsorKpiCards`) e isola os formulários densos
 * nas rotas dedicadas (`/novo`, `/[sponsorId]/editar`, `/cotas/nova`,
 * `/cotas/[tierId]/editar`). As consultas pesadas de QRs, equipe e leads só
 * executam quando `activeTab === 'estandes'`.
 */
export default async function EventSponsorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
  searchParams: Promise<{
    aba?: string;
    patrocinador?: string;
    exportacao?: string;
    erro?: string;
    confirmarQr?: string;
  }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;
  const { aba, patrocinador, exportacao, erro, confirmarQr } = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
  });

  const activeTab = resolveSponsorTab({ aba, confirmarQr, exportacao, erro });

  const [event, board, experienceCounts] = await Promise.all([
    getAdminEvent(tenantId, eventId),
    listSponsorBoard(tenantId, eventId),
    getEventSponsorExperienceCounts(tenantId, eventId),
  ]);

  if (!event || !board) notFound();

  const baseUrl = tenantPath(tenantSlug, `/administracao/eventos/${eventId}/patrocinadores`);
  const summary = computeSponsorKpiSummary({
    tiers: board.tiers,
    sponsors: board.sponsors,
    experience: experienceCounts,
  });

  // Dados operacionais de estande/QR/LGPD carregados apenas na aba `estandes`.
  let recentExports: Awaited<ReturnType<typeof listRecentDataExports>> = [];
  let createdExport: Awaited<ReturnType<typeof getDataExport>> = null;
  let qrRows: Awaited<ReturnType<typeof listSponsorQrCodes>> = [];
  let teamRows: (Awaited<ReturnType<typeof listSponsorTeam>>[number] & { sponsorId: string })[] =
    [];
  let leadRows: (Awaited<ReturnType<typeof listSponsorLeads>>[number] & { sponsorId: string })[] =
    [];
  let cardOptions: { value: string; label: string }[] = [];
  const qrSheets: Record<string, SponsorQrSheet> = {};

  if (activeTab === 'estandes') {
    const [exportsList, created, qrLists, teamLists, leadLists, cards] = await Promise.all([
      listRecentDataExports({ tenantId, kind: 'SPONSOR_CONTACTS_CSV', limit: 30 }),
      exportacao ? getDataExport({ tenantId, exportId: exportacao }) : Promise.resolve(null),
      Promise.all(board.sponsors.map((sponsor) => listSponsorQrCodes(tenantId, sponsor.id))),
      Promise.all(board.sponsors.map((sponsor) => listSponsorTeam(tenantId, sponsor.id))),
      Promise.all(board.sponsors.map((sponsor) => listSponsorLeads(tenantId, sponsor.id))),
      listCardTemplateOptions(tenantId),
    ]);

    recentExports = exportsList;
    createdExport = created;
    qrRows = qrLists.flat();
    teamRows = board.sponsors.flatMap((sponsor, index) =>
      (teamLists[index] ?? []).map((line) => ({ ...line, sponsorId: sponsor.id })),
    );
    leadRows = board.sponsors.flatMap((sponsor, index) =>
      (leadLists[index] ?? []).map((lead) => ({ ...lead, sponsorId: sponsor.id })),
    );
    cardOptions = cards;

    await Promise.all(
      qrRows.map(async (qr) => {
        qrSheets[qr.id] = await sponsorQrSheet({ tenantSlug, code: qr.code });
      }),
    );
  }

  const tabCounts: Record<SponsorTab, number> = {
    patrocinadores: board.sponsors.length,
    cotas: board.tiers.length,
    estandes: experienceCounts.qrCount,
  };

  return (
    <main className="max-w-5xl space-y-6">
      <PageHeader
        title="Patrocinadores"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        descriptionTestId="sponsor-status"
        description={
          <>
            {board.sponsors.length} cadastrado(s) · {board.publicCount} visível(is) na página pública ·{' '}
            {board.tiers.length} cota(s)
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`${baseUrl}/cotas/nova`}
              data-testid="btn-nova-cota"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              <Plus className="size-4" aria-hidden />
              Nova cota
            </Link>
            <Link
              href={`${baseUrl}/novo`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              data-testid="btn-novo-patrocinador"
            >
              <Plus className="size-4" aria-hidden />
              Novo patrocinador
            </Link>
          </div>
        }
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: event.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Patrocinadores' },
        ]}
      />

      <p className="text-xs">
        <Link
          href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/pagina`)}
          className="underline underline-offset-4"
        >
          ← Voltar ao editor da página
        </Link>
      </p>

      <SponsorKpiCards summary={summary} tenantSlug={tenantSlug} eventId={eventId} />

      <nav
        aria-label="Visões de patrocínio"
        data-testid="sponsor-tabs"
        className="flex flex-wrap gap-2 border-b border-border pb-3"
      >
        {SPONSOR_TABS.map((tab) => {
          const isCurrent = activeTab === tab;
          return (
            <Link
              key={tab}
              href={buildEventSponsorsHref(baseUrl, { aba: tab })}
              data-testid={`sponsor-tab-${tab}`}
              aria-current={isCurrent ? 'page' : undefined}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                isCurrent
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <span>{SPONSOR_TAB_LABELS[tab]}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  isCurrent ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-surface-low'
                }`}
              >
                {tabCounts[tab]}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* ── Aba 1: Patrocinadores ────────────────────────────────────────── */}
      {activeTab === 'patrocinadores' ? (
        <section
          className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          data-testid="sponsor-section"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Handshake className="size-4" aria-hidden />
              Patrocinadores ({board.sponsors.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Ordenados pela cota e depois pela ordem dentro da cota.
            </p>
          </div>

          {board.sponsors.length > 0 ? (
            <ul className="space-y-3" data-testid="sponsor-list">
              {board.sponsors.map((sponsor) => (
                <li
                  key={sponsor.id}
                  data-testid={`sponsor-${sponsor.id}`}
                  data-active={sponsor.isActive ? 'true' : 'false'}
                  className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-low">
                        {sponsor.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={sponsor.logoUrl}
                            alt={sponsor.name}
                            className="size-full object-contain"
                          />
                        ) : (
                          <Handshake className="size-5 text-muted-foreground" aria-hidden />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span>{sponsor.name}</span>
                          {sponsor.isActive ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs text-success-strong">
                              <BadgeCheck className="size-3" aria-hidden />
                              visível
                            </span>
                          ) : (
                            <span className="rounded-full bg-surface-low px-2 py-0.5 text-xs text-muted-foreground">
                              oculto
                            </span>
                          )}
                          {sponsor.sourceSponsorId ? (
                            <span
                              className="text-xs font-normal text-muted-foreground"
                              data-testid={`sponsor-source-${sponsor.id}`}
                            >
                              · Copiado de {sponsor.sourceName ?? 'outra edição'}
                            </span>
                          ) : null}
                        </p>

                        <div className="grid gap-1 text-xs sm:grid-cols-2">
                          <div className="space-y-0.5">
                            <p className="text-muted-foreground">
                              {sponsor.tierName ?? 'Sem cota'} · ordem {sponsor.displayOrder}
                              {sponsor.contractValueCents
                                ? ` · ${formatMoney(sponsor.contractValueCents, 'BRL')}`
                                : ''}
                            </p>
                            <p className={CONTRACT_TONE[sponsor.contractState]}>
                              {sponsor.contractStateLabel}
                              {sponsor.contractEnd
                                ? ` · até ${sponsor.contractEnd.toLocaleDateString('pt-BR')}`
                                : ''}
                            </p>
                          </div>

                          <div className="space-y-0.5 text-muted-foreground">
                            {sponsor.contactName || sponsor.contactEmail ? (
                              <p>
                                {sponsor.contactName ?? ''}
                                {sponsor.contactEmail ? ` · ${sponsor.contactEmail}` : ''}
                              </p>
                            ) : null}
                            {sponsor.taxIdMasked ? (
                              <p className="code-data">Documento {sponsor.taxIdMasked}</p>
                            ) : null}
                            {sponsor.websiteUrl ? (
                              <a
                                href={sponsor.websiteUrl}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="inline-block underline underline-offset-4"
                              >
                                {sponsor.websiteUrl}
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`${baseUrl}/${sponsor.id}/editar`}
                        data-testid={`edit-sponsor-${sponsor.id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                      >
                        <Pencil className="size-3" aria-hidden />
                        Editar
                      </Link>

                      <Link
                        href={buildEventSponsorsHref(baseUrl, {
                          aba: 'estandes',
                          patrocinador: sponsor.id,
                        })}
                        data-testid={`booth-sponsor-${sponsor.id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                      >
                        <QrCode className="size-3" aria-hidden />
                        Estande & QR
                      </Link>

                      {sponsor.sourceSponsorId ? (
                        <InlineActionForm
                          action={syncSponsorAction}
                          submitLabel="Sincronizar"
                          testId={`sync-sponsor-${sponsor.id}`}
                        >
                          <input type="hidden" name="tenantSlug" value={tenantSlug} />
                          <input type="hidden" name="eventId" value={eventId} />
                          <input type="hidden" name="sponsorId" value={sponsor.id} />
                        </InlineActionForm>
                      ) : null}

                      <InlineActionForm
                        action={setSponsorActiveAction}
                        submitLabel={sponsor.isActive ? 'Ocultar' : 'Exibir'}
                        testId={`toggle-sponsor-${sponsor.id}`}
                      >
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="sponsorId" value={sponsor.id} />
                        <input
                          type="hidden"
                          name="isActive"
                          value={sponsor.isActive ? 'false' : 'true'}
                        />
                      </InlineActionForm>

                      <InlineActionForm
                        action={removeSponsorAction}
                        submitLabel="Remover"
                        variant="destructive"
                        testId={`remove-sponsor-${sponsor.id}`}
                        confirm={{
                          title: `Remover “${sponsor.name}” do evento?`,
                          description:
                            'O cadastro sai da página pública e da lista. O histórico financeiro é preservado.',
                          confirmLabel: 'Remover patrocinador',
                        }}
                      >
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="sponsorId" value={sponsor.id} />
                      </InlineActionForm>
                    </div>
                  </div>

                  <AssetUploader
                    tenantSlug={tenantSlug}
                    eventId={eventId}
                    target="SPONSOR_LOGO"
                    sponsorId={sponsor.id}
                    currentUrl={sponsor.logoUrl}
                    requestUploadAction={requestAssetUploadAction}
                    confirmUploadAction={confirmAssetUploadAction}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div
              className="rounded-lg border border-dashed border-border p-8 text-center"
              data-testid="empty-sponsors"
            >
              <Handshake className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm font-medium">Nenhum patrocinador cadastrado</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Adicione patrocinadores e parceiros para exibir suas marcas e gerenciar contratos.
              </p>
              <div className="mt-4">
                <Link
                  href={`${baseUrl}/novo`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  <Plus className="size-3.5" aria-hidden />
                  Cadastrar primeiro patrocinador
                </Link>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* ── Aba 2: Cotas e vitrine ───────────────────────────────────────── */}
      {activeTab === 'cotas' ? (
        <section
          className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          data-testid="tier-section"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Tags className="size-4" aria-hidden />
                Cotas e vitrine ({board.tiers.length})
              </h2>
              <p className="text-xs text-muted-foreground">
                A cota define a ORDEM na página pública, a cor do cartão e quantos patrocinadores ela aceita.
              </p>
            </div>
            <Link
              href={`${baseUrl}/cotas/nova`}
              data-testid="btn-nova-cota-aba"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Plus className="size-3.5" aria-hidden />
              Nova cota
            </Link>
          </div>

          {board.tiers.length > 0 ? (
            <ul className="space-y-3" data-testid="tier-list">
              {board.tiers.map((tier) => {
                const tint = sponsorTierTint(tier.color);
                return (
                  <li
                    key={tier.id}
                    data-testid={`tier-${tier.id}`}
                    className="rounded-lg border p-4"
                    style={
                      tint
                        ? { backgroundColor: tint.surface, borderColor: tint.border }
                        : undefined
                    }
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span
                            aria-hidden
                            className="inline-block size-3 rounded-full border border-border"
                            style={{ backgroundColor: tier.color ?? undefined }}
                          />
                          <span>{tier.name}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {SPONSOR_TIER_LABELS[tier.key]} · ordem {tier.rank} · logo{' '}
                            {SPONSOR_LOGO_SCALE_LABELS[tier.logoScale].toLowerCase()}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {tier.sponsorCount} patrocinador(es) ·{' '}
                          {tier.maxSponsors === 0
                            ? 'vagas ilimitadas'
                            : `limite ${tier.maxSponsors}${
                                tier.remaining !== null ? ` (${tier.remaining} livre(s))` : ''
                              }`}{' '}
                          ·{' '}
                          {tier.priceCents > 0
                            ? formatMoney(tier.priceCents, tier.currency)
                            : 'sem valor definido'}
                        </p>
                        {tier.benefits.length > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            {tier.benefits.join(' · ')}
                          </p>
                        ) : null}
                        {tier.description ? (
                          <p className="text-xs text-muted-foreground">{tier.description}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={`${baseUrl}/cotas/${tier.id}/editar`}
                          data-testid={`edit-tier-${tier.id}`}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                        >
                          <Pencil className="size-3" aria-hidden />
                          Editar cota
                        </Link>

                        <InlineActionForm
                          action={deleteTierAction}
                          submitLabel="Remover"
                          variant="destructive"
                          testId={`delete-tier-${tier.id}`}
                          confirm={{
                            title: `Remover a cota “${tier.name}”?`,
                            description:
                              'A cota deixa de existir neste evento. Patrocinadores que já estão nela precisam ser movidos antes, senão a remoção é recusada.',
                            confirmLabel: 'Remover cota',
                          }}
                        >
                          <input type="hidden" name="tenantSlug" value={tenantSlug} />
                          <input type="hidden" name="eventId" value={eventId} />
                          <input type="hidden" name="tierId" value={tier.id} />
                        </InlineActionForm>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div
              className="rounded-lg border border-dashed border-border p-8 text-center"
              data-testid="empty-tiers"
            >
              <Tags className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm font-medium">Nenhuma cota cadastrada</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sem cotas, todo patrocinador aparece no agrupamento &quot;Patrocinadores&quot;.
              </p>
              <div className="mt-4">
                <Link
                  href={`${baseUrl}/cotas/nova`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  <Plus className="size-3.5" aria-hidden />
                  Criar primeira cota
                </Link>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* ── Aba 3: Estandes, QRs e leads LGPD ────────────────────────────── */}
      {activeTab === 'estandes' ? (
        <SponsorExperiencePanel
          tenantSlug={tenantSlug}
          eventId={eventId}
          sponsors={board.sponsors.map((sponsor) => ({
            id: sponsor.id,
            name: sponsor.name,
            contactEmail: sponsor.contactEmail,
          }))}
          selectedSponsorId={patrocinador ?? null}
          clearFilterHref={buildEventSponsorsHref(baseUrl, { aba: 'estandes' })}
          qrRows={qrRows}
          qrSheets={qrSheets}
          teamRows={teamRows}
          leads={leadRows}
          eventOptions={[{ value: eventId, label: event.title }]}
          cardOptions={cardOptions}
          recentExports={recentExports}
          createdExport={createdExport}
          returnTo={buildEventSponsorsHref(baseUrl, {
            aba: 'estandes',
            patrocinador: patrocinador ?? null,
          })}
          exportError={erro ?? null}
          confirmarQr={confirmarQr ?? null}
        />
      ) : null}
    </main>
  );
}
