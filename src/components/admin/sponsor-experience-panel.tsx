import { QrCode, ShieldCheck, UserPlus, Users } from 'lucide-react';

import { AdminForm, Field } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { SponsorQrCreateForm } from '@/components/admin/sponsor-qr-create-form';
import { SponsorQrShare } from '@/components/sponsors/sponsor-qr-share';
import { ExportPanel } from '@/components/exports/export-panel';
import { AppLink } from '@/components/ui';
import type { ExportRecordView } from '@/lib/exports/export-service';
import type { SponsorQrSheet } from '@/lib/sponsors/sponsor-qr-sheet';
import type {
  SponsorQrPanelRow,
  SponsorPortalLead,
  SponsorTeamRow,
} from '@/lib/sponsors/sponsor-portal-service';
import { saveSponsorQrWithConfirmationAction } from '@/app/actions/sponsor-qr-actions';
import {
  deleteSponsorQrAction,
  inviteSponsorUserAction,
  linkSponsorUserAction,
  removeSponsorUserAction,
  setSponsorQrActiveAction,
} from '@/app/actions/sponsor-portal-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PAINEL DA EXPERIÊNCIA DO PATROCINADOR (FASE 42 · evoluído na FASE 125)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function SponsorExperiencePanel({
  tenantSlug,
  eventId,
  sponsors,
  selectedSponsorId = null,
  clearFilterHref,
  qrRows,
  qrSheets,
  teamRows,
  leads,
  eventOptions,
  cardOptions,
  recentExports,
  createdExport,
  returnTo,
  exportError,
  confirmarQr,
}: {
  tenantSlug: string;
  eventId: string;
  sponsors: { id: string; name: string; contactEmail?: string | null }[];
  selectedSponsorId?: string | null;
  clearFilterHref?: string;
  qrRows: SponsorQrPanelRow[];
  /** A imagem de cada QR (gerada no servidor), por id — ver `sponsor-qr-sheet`. */
  qrSheets: Record<string, SponsorQrSheet>;
  teamRows: (SponsorTeamRow & { sponsorId: string })[];
  leads: (SponsorPortalLead & { sponsorId: string })[];
  eventOptions: { value: string; label: string }[];
  cardOptions: { value: string; label: string }[];
  recentExports: ExportRecordView[];
  createdExport: ExportRecordView | null;
  returnTo: string;
  exportError: string | null;
  confirmarQr: string | null;
}) {
  if (sponsors.length === 0) {
    return (
      <section
        className="rounded-xl border border-border bg-card p-6 text-center shadow-sm"
        data-testid="sponsor-experience-empty"
      >
        <QrCode className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-sm font-medium">Nenhum patrocinador cadastrado neste evento</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Cadastre um patrocinador primeiro para gerar QRs de estande, liberar acesso B2B e acompanhar leads.
        </p>
      </section>
    );
  }

  const activeFilterSponsor = selectedSponsorId
    ? sponsors.find((sponsor) => sponsor.id === selectedSponsorId) ?? null
    : null;
  const visibleSponsors = activeFilterSponsor ? [activeFilterSponsor] : sponsors;

  const qrDe = (sponsorId: string) => qrRows.filter((row) => row.sponsorId === sponsorId);
  const equipeDe = (sponsorId: string) => teamRows.filter((row) => row.sponsorId === sponsorId);
  const contatosDe = (sponsorId: string) => leads.filter((row) => row.sponsorId === sponsorId);

  return (
    <section
      className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="sponsor-experience"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <QrCode className="size-4" aria-hidden />
          Leitura por QR e acesso do patrocinador
        </h2>
        <p className="text-xs text-muted-foreground">
          Cada QR vale <strong>um crédito por pessoa</strong>. O contato só aparece com autorização.
        </p>
      </div>

      {activeFilterSponsor ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-low px-3 py-2 text-xs"
          data-testid="sponsor-experience-filter-banner"
        >
          <span>
            Filtrando estande e leads de <strong>{activeFilterSponsor.name}</strong>
          </span>
          <AppLink
            href={clearFilterHref ?? returnTo}
            className="font-medium underline underline-offset-4"
            data-testid="sponsor-experience-clear-filter"
          >
            Ver todos os patrocinadores ({sponsors.length})
          </AppLink>
        </div>
      ) : null}

      {visibleSponsors.map((sponsor) => {
        const qrCodes = qrDe(sponsor.id);
        const equipe = equipeDe(sponsor.id);
        const contatos = contatosDe(sponsor.id);
        const totalVisits = qrCodes.reduce((total, qr) => total + qr.visits, 0);
        const consentPercent =
          totalVisits > 0 ? Math.min(100, Math.round((contatos.length / totalVisits) * 100)) : null;

        return (
          <div key={sponsor.id} className="space-y-4 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold" data-testid={`sponsor-experience-${sponsor.id}`}>
                {sponsor.name}
              </h3>
              <p className="text-xs text-muted-foreground">
                {qrCodes.length} QR · {totalVisits} visita(s) · {contatos.length} contato(s)
                autorizado(s)
                {consentPercent !== null ? ` (${consentPercent}% de consentimento)` : ''}
              </p>
            </div>

            {/* ── QRs do estande ───────────────────────────────────────────── */}
            {qrCodes.length > 0 ? (
              <ul className="space-y-2" data-testid={`sponsor-qr-${sponsor.id}`}>
                {qrCodes.map((qr) => {
                  const sheet = qrSheets[qr.id];

                  return (
                    <li key={qr.id} className="space-y-3 rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {qr.label}
                            {!qr.isActive ? (
                              <span className="text-xs font-normal text-muted-foreground">
                                desativado
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {qr.formattedCode} · {qr.eventTitle} ·{' '}
                            {qr.xpAmount > 0 ? `${qr.xpAmount} XP` : 'sem XP'}
                            {qr.cardName ? ` · carta "${qr.cardName}"` : ''} · {qr.consentDays}{' '}
                            dia(s) de autorização
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {qr.visits} visita(s) · {qr.leads} contato(s)
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <InlineActionForm
                            action={setSponsorQrActiveAction}
                            submitLabel={qr.isActive ? 'Desativar' : 'Reativar'}
                            testId={`qr-toggle-${qr.id}`}
                          >
                            <input type="hidden" name="tenantSlug" value={tenantSlug} />
                            <input type="hidden" name="eventId" value={eventId} />
                            <input type="hidden" name="qrId" value={qr.id} />
                            <input
                              type="hidden"
                              name="isActive"
                              value={qr.isActive ? 'false' : 'true'}
                            />
                          </InlineActionForm>

                          <InlineActionForm
                            action={deleteSponsorQrAction}
                            submitLabel="Excluir"
                            variant="destructive"
                            testId={`qr-delete-${qr.id}`}
                            confirm={{
                              title: `Excluir o QR “${qr.label}”?`,
                              description:
                                'As leituras deste QR saem junto, e com elas as autorizações dadas por ele. Para apenas parar de creditar, use "Desativar".',
                              confirmLabel: 'Excluir QR',
                            }}
                          >
                            <input type="hidden" name="tenantSlug" value={tenantSlug} />
                            <input type="hidden" name="eventId" value={eventId} />
                            <input type="hidden" name="qrId" value={qr.id} />
                          </InlineActionForm>
                        </div>
                      </div>

                      {sheet ? (
                        <SponsorQrShare
                          tenantSlug={tenantSlug}
                          qrId={qr.id}
                          label={qr.label}
                          isActive={qr.isActive}
                          sheet={sheet}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum QR deste patrocinador ainda.</p>
            )}

            <details className="rounded-md border border-border p-3" open={confirmarQr === sponsor.id}>
              <summary className="cursor-pointer text-xs font-medium">Criar QR do estande</summary>
              <div className="pt-3">
                <SponsorQrCreateForm
                  action={saveSponsorQrWithConfirmationAction}
                  tenantSlug={tenantSlug}
                  eventId={eventId}
                  sponsorId={sponsor.id}
                  cardOptions={cardOptions}
                  returnTo={returnTo}
                  confirmedByNavigation={confirmarQr === sponsor.id}
                  eventLabel={eventOptions[0]?.label ?? 'o desta tela'}
                />
              </div>
            </details>

            {/* ── Acesso do patrocinador ───────────────────────────────────── */}
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Users className="size-3.5" aria-hidden />
                Quem acessa a área do patrocinador
              </p>

              {equipe.length > 0 ? (
                <ul className="space-y-2" data-testid={`sponsor-team-${sponsor.id}`}>
                  {equipe.map((line) => (
                    <li
                      key={line.linkId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-xs"
                    >
                      <span>
                        {line.name ?? line.email}
                        <span className="text-muted-foreground">
                          {' '}
                          · {line.status === 'ACTIVE' ? 'ativo' : 'convite pendente'}
                        </span>
                      </span>
                      <InlineActionForm
                        action={removeSponsorUserAction}
                        submitLabel="Remover acesso"
                        variant="destructive"
                        testId={`sponsor-unlink-${line.linkId}`}
                      >
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="linkId" value={line.linkId} />
                      </InlineActionForm>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Ninguém tem acesso a este patrocinador ainda.
                </p>
              )}

              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-xs font-medium">
                  Convidar ou vincular pessoa
                </summary>
                <div className="space-y-4 pt-3">
                  <AdminForm
                    action={inviteSponsorUserAction}
                    submitLabel="Gerar convite"
                    testId={`sponsor-invite-${sponsor.id}`}
                    compact
                  >
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="sponsorId" value={sponsor.id} />
                    <Field
                      label="E-mail do contato"
                      name="email"
                      type="email"
                      required
                      defaultValue={sponsor.contactEmail ?? undefined}
                      hint="O convite só é aceito por uma conta com este endereço"
                    />
                  </AdminForm>

                  <AdminForm
                    action={linkSponsorUserAction}
                    submitLabel="Vincular agora"
                    testId={`sponsor-link-${sponsor.id}`}
                    compact
                  >
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="sponsorId" value={sponsor.id} />
                    <Field
                      label="E-mail de quem JÁ tem conta"
                      name="email"
                      type="email"
                      required
                      defaultValue={sponsor.contactEmail ?? undefined}
                      hint="Sem convite: a pessoa já está na instituição"
                    />
                  </AdminForm>
                </div>
              </details>
            </div>

            {/* ── Contatos autorizados ─────────────────────────────────────── */}
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <ShieldCheck className="size-3.5" aria-hidden />
                Contatos autorizados ({contatos.length})
              </p>

              {contatos.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum contato autorizado no momento (visitas sem autorização não aparecem aqui).
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-xs">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="p-1">Nome</th>
                        <th className="p-1">E-mail</th>
                        <th className="p-1">QR</th>
                        <th className="p-1">Vale até</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contatos.map((contato) => (
                        <tr key={contato.scanId} className="border-t border-border">
                          <td className="p-1">{contato.sharedName}</td>
                          <td className="p-1">{contato.sharedEmail}</td>
                          <td className="p-1 text-muted-foreground">{contato.qrLabel}</td>
                          <td className="p-1 text-muted-foreground">
                            {contato.expiresAt
                              ? contato.expiresAt.toLocaleDateString('pt-BR')
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <ExportPanel
                tenantSlug={tenantSlug}
                kinds={['SPONSOR_CONTACTS_CSV']}
                returnTo={returnTo}
                sponsorId={sponsor.id}
                created={createdExport}
                recent={recentExports.filter((record) => record.sponsorId === sponsor.id)}
                title="Exportar contatos (CSV)"
                testId={`sponsor-leads-csv-${sponsor.id}`}
                error={exportError}
              />
            </div>
          </div>
        );
      })}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <UserPlus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        O convite prova a posse do e-mail; o vínculo direto serve para quem já tem conta na
        instituição. Quem aceita passa a ver a cota, o contrato e os contatos autorizados — e nada
        além disso.
      </p>
    </section>
  );
}
