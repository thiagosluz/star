import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, QrCode, ScanLine } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { getTenantContext } from '@/lib/events/event-repository';
import { tenantPath } from '@/domain/tenancy/resolution';
import { formatSponsorQrCode } from '@/domain/events/sponsor-experience-rules';
import { getPublicSponsorQr } from '@/lib/sponsors/sponsor-portal-service';
import { SponsorScanForm } from '@/components/sponsors/scan-form';
import { scanSponsorQrAction } from '@/app/actions/sponsor-portal-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LEITURA DO QR DO PATROCINADOR (FASE 42) — página pública
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QR DO ESTANDE É UM ENDEREÇO, NÃO UM APLICATIVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A câmera do celular lê o código e abre esta página. Quem já está logado decide
 *  ali mesmo; quem não está entra com volta para cá (o mesmo caminho da inscrição
 *  pública, FASE 10) — o QR não obriga a instalar nada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CRÉDITO NÃO DEPENDE DO COMPARTILHAMENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela oferece as duas escolhas com o MESMO prêmio, e diz isso em uma frase
 *  antes dos botões: consentimento condicionado a benefício não é consentimento
 *  livre (LGPD, art. 8º, §3º). Sem autorização, o patrocinador recebe só o número
 *  da visita.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const metadata = { title: 'Visita ao patrocinador' };
export const dynamic = 'force-dynamic';

export default async function SponsorQrPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; code: string }>;
}) {
  const { tenantSlug, code } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const contexto = await getRequestContext();
  const loggedHere =
    contexto && contexto.activeTenant?.tenantId === tenant.tenantId ? contexto.user : null;

  const qr = await getPublicSponsorQr({
    tenantId: tenant.tenantId,
    code,
    userId: loggedHere?.id ?? null,
  });

  /** QR inexistente, desativado ou de patrocinador removido: a página não existe. */
  if (!qr) notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <header className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          <ScanLine className="size-3.5" aria-hidden />
          Visita registrada por QR
        </p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <QrCode className="size-6 text-primary" aria-hidden />
          {qr.sponsorName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {qr.eventTitle} · {qr.label} · código {formatSponsorQrCode(qr.code)}
        </p>
      </header>

      <section className="rounded-lg border border-border bg-card p-5" data-testid="sponsor-scan">
        {qr.sponsorLogoUrl ? (
          <div className="mb-4 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr.sponsorLogoUrl}
              alt={qr.sponsorName}
              className="h-14 w-auto max-w-40 object-contain"
            />
            {qr.sponsorWebsiteUrl ? (
              <a
                href={qr.sponsorWebsiteUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 text-xs underline underline-offset-4"
              >
                site do patrocinador <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </div>
        ) : null}

        {loggedHere ? (
          <SponsorScanForm
            tenantSlug={tenantSlug}
            code={qr.code}
            xpAmount={qr.xpAmount}
            cardName={qr.cardName}
            consentText={qr.consentText}
            alreadyScanned={qr.alreadyScanned}
            action={scanSponsorQrAction}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Entre com a sua conta para registrar a visita e receber o crédito. A visita vale{' '}
              {qr.xpAmount > 0 ? `${qr.xpAmount} XP` : 'registro no seu histórico'}
              {qr.cardName ? ` e a carta "${qr.cardName}"` : ''}.
            </p>
            <Link
              href={`/login?redirectTo=${encodeURIComponent(
                tenantPath(tenantSlug, `/patrocinio/${qr.code}`),
              )}`}
              data-testid="scan-login"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Entrar e registrar a visita
            </Link>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Você decide o que compartilhar. Sem autorização, a organização e o patrocinador veem apenas o
        número de visitas — nunca o seu nome.
      </p>
    </main>
  );
}
