import Link from 'next/link';
import { Handshake, Info, QrCode, ShieldCheck, Users } from 'lucide-react';

import { requirePersonalPage } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { Card, CardContent, SectionHeading } from '@/components/ui';
import {
  getSponsorPortal,
  hasPendingSponsorInvite,
  listSponsorAccess,
} from '@/lib/sponsors/sponsor-portal-service';
import { sponsorQrSheet, type SponsorQrSheet } from '@/lib/sponsors/sponsor-qr-sheet';
import { SponsorQrShare } from '@/components/sponsors/sponsor-qr-share';

/** Mesma formatação da tela de patrocínio da organização (centavos → moeda). */
function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ÁREA DO PATROCINADOR (FASE 42) — SÓ LEITURA
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE O PATROCINADOR VÊ, E O QUE ELE NÃO VÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele vê o que a organização cadastrou PARA ELE: cota, benefícios, valor e vigência
 *  do contrato, os QR codes do estande e os contatos que AUTORIZARAM a partilha.
 *
 *  Ele NÃO vê: inscritos, participantes, leads revogados ou vencidos, contatos de
 *  outro patrocinador, nem nada que possa editar. Toda a leitura passa por
 *  `getSponsorPortal`, que filtra pelo VÍNCULO e por `evaluateLeadAccess` — e não há
 *  nenhuma ação de escrita nesta tela, de propósito: o dado é da organização.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  VISITAS E CONTATOS SÃO NÚMEROS DIFERENTES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem lê o QR e escolhe não compartilhar conta como VISITA e não aparece como
 *  contato. Mostrar os dois números separados é o que torna o consentimento
 *  visível: a diferença entre eles é exatamente o que as pessoas decidiram não
 *  compartilhar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const metadata = { title: 'Área do patrocinador' };
export const dynamic = 'force-dynamic';

export default async function SponsorAreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ patrocinador?: string }>;
}) {
  const { tenantSlug } = await params;
  const { patrocinador } = await searchParams;

  const { tenantId, tenantName, userId, userEmail } = await requirePersonalPage({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_READ,
    /**
     * A SEGUNDA PORTA: quem foi convidado e ainda não aceitou. O papel `SPONSOR`
     * nasce com o aceite, então exigi-lo para chegar ao convite seria um impasse.
     */
    allowWhen: ({ tenantId: invitedTenantId, userEmail: invitedEmail }) =>
      hasPendingSponsorInvite(invitedTenantId, invitedEmail),
  });

  const [acessos, portal] = await Promise.all([
    listSponsorAccess(tenantId, userId),
    getSponsorPortal({ tenantId, userId, sponsorId: patrocinador ?? null }),
  ]);

  const convitePendente = acessos.length === 0 && (await hasPendingSponsorInvite(tenantId, userEmail));

  if (convitePendente) {
    return (
      <main className="max-w-3xl space-y-6">
        <header className="space-y-1.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Handshake className="size-6 text-primary" aria-hidden />
            Área do patrocinador
          </h1>
        </header>

        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm">
              A organização registrou um convite para <strong>{userEmail}</strong>. Abra o link que
              você recebeu para confirmar o acesso — ele leva à página de aceite.
            </p>
            <p className="text-xs text-muted-foreground">
              O convite é conferido contra o e-mail da sua conta: se ele foi emitido para outro
              endereço, a organização precisa gerar um novo.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!portal.ok) {
    return (
      <main className="max-w-3xl space-y-6">
        <header className="space-y-1.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Handshake className="size-6 text-primary" aria-hidden />
            Área do patrocinador
          </h1>
        </header>

        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm">{portal.message}</p>
            <p className="text-xs text-muted-foreground">
              Peça à organização para vincular o seu e-mail a um patrocinador, ou use o link do
              convite que você recebeu.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const { sponsors, selected, qrCodes, leads, counters } = portal.portal;

  /**
   * A imagem de cada QR do estande, gerada no servidor.
   *
   * O patrocinador também precisa da PEÇA — é ele quem monta o balcão, e a cota
   * dele inclui o estande. Baixar o arquivo é leitura, não escrita: a área continua
   * sem nenhuma ação que altere o que a organização cadastrou.
   */
  const qrSheets: Record<string, SponsorQrSheet> = {};
  await Promise.all(
    qrCodes.map(async (qr) => {
      qrSheets[qr.id] = await sponsorQrSheet({ tenantSlug, code: qr.code });
    }),
  );

  return (
    <main className="max-w-5xl space-y-8" data-testid="sponsor-area">
      <header className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Handshake className="size-6 text-primary" aria-hidden />
          Área do patrocinador
        </h1>
        <p className="text-sm text-muted-foreground">
          Tudo aqui é informação que a organização cadastrou para você. Esta área é de leitura: para
          alterar cota, contrato ou QR, fale com a organização.
        </p>
      </header>

      {sponsors.length > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label="Patrocinadores">
          {sponsors.map((sponsor) => (
            <Link
              key={sponsor.id}
              href={tenantPath(tenantSlug, `/patrocinador?patrocinador=${sponsor.id}`)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                sponsor.id === selected?.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
              }`}
            >
              {sponsor.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2" aria-label="Resumo">
        <Card>
          <CardContent className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Visitas registradas</p>
            <p className="text-3xl font-semibold" data-testid="sponsor-visits">
              {counters.visits}
            </p>
            <p className="text-xs text-muted-foreground">
              Cada visita conta uma vez por pessoa, mesmo que ela leia o QR de novo.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Contatos autorizados
            </p>
            <p className="text-3xl font-semibold" data-testid="sponsor-leads">
              {counters.leads}
            </p>
            <p className="text-xs text-muted-foreground">
              Só entra aqui quem autorizou nome e e-mail, e só enquanto a autorização vale.
            </p>
          </CardContent>
        </Card>
      </section>

      {selected ? (
        <section className="space-y-3">
          <SectionHeading title="Seu patrocínio" description="Cota, benefícios e contrato." />
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Cota</p>
                <p className="text-sm font-medium" data-testid="sponsor-tier">
                  {selected.tierName ?? 'Sem cota definida'}
                </p>
                {selected.tierBenefits.length > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {selected.tierBenefits.map((benefit) => (
                      <li key={benefit}>{benefit}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Contrato</p>
                <p className="text-sm font-medium">{selected.contractStateLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {selected.contractValueCents
                    ? formatMoney(selected.contractValueCents, selected.currency ?? 'BRL')
                    : 'Valor não informado'}
                </p>
                {selected.contractStart || selected.contractEnd ? (
                  <p className="text-xs text-muted-foreground">
                    {selected.contractStart ? selected.contractStart.toLocaleDateString('pt-BR') : '—'} a{' '}
                    {selected.contractEnd ? selected.contractEnd.toLocaleDateString('pt-BR') : '—'}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1 sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Eventos</p>
                <p className="text-sm">
                  {selected.eventTitles.length > 0
                    ? selected.eventTitles.join(' · ')
                    : 'Nenhum evento com QR cadastrado ainda'}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionHeading
          title="QR codes do estande"
          description="Cada código vale um crédito por pessoa. A organização é quem cria e desativa."
        />

        {qrCodes.length === 0 ? (
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground" data-testid="sponsor-no-qr">
            Nenhum QR cadastrado para este patrocinador ainda.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="sponsor-qr-list">
            {qrCodes.map((qr) => {
              /** O índice é frouxo: o QR existe, então a imagem dele existe. */
              const sheet = qrSheets[qr.id];

              return (
              <li key={qr.id} className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <QrCode className="size-4 text-muted-foreground" aria-hidden />
                      {qr.label}
                      {!qr.isActive ? (
                        <span className="text-xs font-normal text-muted-foreground">desativado</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {qr.eventTitle} · código <strong>{qr.formattedCode}</strong> ·{' '}
                      {qr.xpAmount > 0 ? `${qr.xpAmount} XP por visita` : 'sem XP'}
                      {qr.cardName ? ` · carta "${qr.cardName}"` : ''} · autorização de{' '}
                      {qr.consentDays} dia(s)
                    </p>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {qr.visits} visita(s) · {qr.leads} contato(s)
                  </p>
                </div>

                {/* A peça do estande: quem lê o código é a câmera do participante. */}
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
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading
          title={`Contatos autorizados (${leads.length})`}
          description="Quem leu o QR e autorizou o compartilhamento de nome e e-mail."
        />

        <p className="flex items-start gap-2 rounded-md border border-border bg-surface-low p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          O contato fica disponível enquanto a autorização valer. Se a pessoa revogar, ele sai desta
          lista — e a visita continua contada, sem identificá-la.
        </p>

        {leads.length === 0 ? (
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground" data-testid="sponsor-no-leads">
            Nenhum contato autorizado no momento.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="sponsor-lead-table">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-2">Nome</th>
                  <th className="p-2">E-mail</th>
                  <th className="p-2">Evento</th>
                  <th className="p-2">QR</th>
                  <th className="p-2">Autorizado em</th>
                  <th className="p-2">Vale até</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.scanId} className="border-t border-border">
                    <td className="p-2">{lead.sharedName}</td>
                    <td className="p-2">{lead.sharedEmail}</td>
                    <td className="p-2 text-xs text-muted-foreground">{lead.eventTitle}</td>
                    <td className="p-2 text-xs text-muted-foreground">{lead.qrLabel}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {lead.consentedAt.toLocaleDateString('pt-BR')}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {lead.expiresAt ? lead.expiresAt.toLocaleDateString('pt-BR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="size-3.5" aria-hidden />
          Precisa deste relatório em planilha? Peça à organização — ela exporta em CSV.
        </p>
      </section>

      <p className="flex items-start gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Dados pessoais aqui são de uso exclusivo deste patrocínio. Repassar a terceiros ou usar fora
        do evento contraria a autorização dada pelo participante.
      </p>
    </main>
  );
}
