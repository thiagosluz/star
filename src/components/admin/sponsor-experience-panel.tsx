import Link from 'next/link';
import { Download, QrCode, ShieldCheck, UserPlus, Users } from 'lucide-react';

import { AdminForm, Field, SelectField } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { SponsorQrShare } from '@/components/sponsors/sponsor-qr-share';
import type { SponsorQrSheet } from '@/lib/sponsors/sponsor-qr-sheet';
import type { SponsorQrPanelRow, SponsorPortalLead, SponsorTeamRow } from '@/lib/sponsors/sponsor-portal-service';
import {
  deleteSponsorQrAction,
  inviteSponsorUserAction,
  linkSponsorUserAction,
  removeSponsorUserAction,
  saveSponsorQrAction,
  setSponsorQrActiveAction,
} from '@/app/actions/sponsor-portal-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PAINEL DA EXPERIÊNCIA DO PATROCINADOR (FASE 42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA SEÇÃO FAZ, E POR QUE ELA FICA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É onde a ORGANIZAÇÃO opera o que o patrocinador vê: cria e desativa o QR do
 *  estande, convida (ou vincula) as pessoas que terão acesso e confere os contatos
 *  autorizados — com a exportação em CSV.
 *
 *  Fica junto do cadastro de patrocínio porque é a MESMA decisão comercial: o QR é
 *  parte do que a cota entrega, e quem cuida da cota cuida dele.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A TELA NÃO MOSTRA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Contato revogado ou vencido não aparece — e a contagem de VISITAS continua
 *  mostrando o que aconteceu. É a distinção que torna o consentimento visível: o
 *  número de visitas menos o número de contatos é o que as pessoas decidiram não
 *  compartilhar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function SponsorExperiencePanel({
  tenantSlug,
  eventId,
  sponsors,
  qrRows,
  qrSheets,
  teamRows,
  leads,
  eventOptions,
  cardOptions,
}: {
  tenantSlug: string;
  eventId: string;
  sponsors: { id: string; name: string }[];
  qrRows: SponsorQrPanelRow[];
  /** A imagem de cada QR (gerada no servidor), por id — ver `sponsor-qr-sheet`. */
  qrSheets: Record<string, SponsorQrSheet>;
  teamRows: (SponsorTeamRow & { sponsorId: string })[];
  leads: (SponsorPortalLead & { sponsorId: string })[];
  eventOptions: { value: string; label: string }[];
  cardOptions: { value: string; label: string }[];
}) {
  if (sponsors.length === 0) return null;

  const qrDe = (sponsorId: string) => qrRows.filter((row) => row.sponsorId === sponsorId);
  const equipeDe = (sponsorId: string) => teamRows.filter((row) => row.sponsorId === sponsorId);
  const contatosDe = (sponsorId: string) => leads.filter((row) => row.sponsorId === sponsorId);

  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-5" data-testid="sponsor-experience">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <QrCode className="size-4" aria-hidden />
          Leitura por QR e acesso do patrocinador
        </h2>
        <p className="text-xs text-muted-foreground">
          Cada QR vale <strong>um crédito por pessoa</strong>. O contato só aparece com autorização.
        </p>
      </div>

      {sponsors.map((sponsor) => {
        const qrCodes = qrDe(sponsor.id);
        const equipe = equipeDe(sponsor.id);
        const contatos = contatosDe(sponsor.id);

        return (
          <div key={sponsor.id} className="space-y-4 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold" data-testid={`sponsor-experience-${sponsor.id}`}>
                {sponsor.name}
              </h3>
              <p className="text-xs text-muted-foreground">
                {qrCodes.length} QR · {qrCodes.reduce((total, qr) => total + qr.visits, 0)} visita(s) ·{' '}
                {contatos.length} contato(s) autorizado(s)
              </p>
            </div>

            {/* ── QRs do estande ───────────────────────────────────────────── */}
            {qrCodes.length > 0 ? (
              <ul className="space-y-2" data-testid={`sponsor-qr-${sponsor.id}`}>
                {qrCodes.map((qr) => {
                  /** O índice é frouxo: o QR existe, então a imagem dele existe. */
                  const sheet = qrSheets[qr.id];

                  return (
                  <li
                    key={qr.id}
                    className="space-y-3 rounded-md border border-border p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {qr.label}
                          {!qr.isActive ? (
                            <span className="text-xs font-normal text-muted-foreground">desativado</span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {qr.formattedCode} · {qr.eventTitle} ·{' '}
                          {qr.xpAmount > 0 ? `${qr.xpAmount} XP` : 'sem XP'}
                          {qr.cardName ? ` · carta "${qr.cardName}"` : ''} · {qr.consentDays} dia(s) de
                          autorização
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
                          <input type="hidden" name="isActive" value={qr.isActive ? 'false' : 'true'} />
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

                    {/*
                      A PEÇA QUE VAI PARA O ESTANDE: o endereço em texto não basta —
                      quem lê é a câmera do participante.
                    */}
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

            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-xs font-medium">Criar QR do estande</summary>
              <div className="pt-3">
                <AdminForm
                  action={saveSponsorQrAction}
                  submitLabel="Criar QR"
                  testId={`qr-new-${sponsor.id}`}
                  compact
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="sponsorId" value={sponsor.id} />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Nome do QR" name="label" required placeholder="Estande — entrada" />
                    <Field
                      label="XP por visita"
                      name="xpAmount"
                      type="number"
                      min={0}
                      max={500}
                      defaultValue={0}
                      hint="0 = QR só de contato"
                    />
                    <SelectField
                      label="Carta da visita"
                      name="cardTemplateId"
                      options={[{ value: '', label: 'Nenhuma carta' }, ...cardOptions]}
                      defaultValue=""
                    />
                    <Field
                      label="Autorização (dias)"
                      name="consentDays"
                      type="number"
                      min={1}
                      max={365}
                      defaultValue={90}
                      hint="Por quanto tempo o contato fica visível"
                    />
                  </div>

                  {eventOptions.length > 1 ? (
                    <p className="text-xs text-muted-foreground">
                      O evento do crédito é o desta tela ({eventOptions[0]?.label}).
                    </p>
                  ) : null}
                </AdminForm>
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
                            {contato.expiresAt ? contato.expiresAt.toLocaleDateString('pt-BR') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <Link
                href={`/api/t/${tenantSlug}/patrocinadores/contatos?sponsorId=${sponsor.id}`}
                data-testid={`sponsor-leads-csv-${sponsor.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <Download className="size-3.5" aria-hidden />
                Exportar contatos (CSV)
              </Link>
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
