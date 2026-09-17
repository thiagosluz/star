import Link from 'next/link';
import { AlertTriangle, BadgeCheck, Ban, FileText, QrCode, ShieldCheck, XCircle } from 'lucide-react';

import { getPublicCertificate } from '@/lib/certificates/certificate-service';
import { CERTIFICATE_KIND_LABELS } from '@/domain/certificates/certificate-rules';

export const metadata = { title: 'Validação de certificado' };
export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, { border: string; text: string; icon: typeof BadgeCheck }> = {
  VALID: { border: 'border-success/40', text: 'text-success-strong', icon: BadgeCheck },
  REVOKED: { border: 'border-destructive/50', text: 'text-destructive', icon: Ban },
  EXPIRED: { border: 'border-warning/50', text: 'text-warning-strong', icon: AlertTriangle },
  NOT_ISSUED: { border: 'border-warning/50', text: 'text-warning-strong', icon: AlertTriangle },
  NOT_FOUND: { border: 'border-destructive/50', text: 'text-destructive', icon: XCircle },
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  VALIDAÇÃO PÚBLICA DE CERTIFICADO
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTA PÁGINA NÃO TEM LOGIN E NÃO TEM CONTEXTO DE INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem valida é, tipicamente, um TERCEIRO: um empregador, uma banca, um órgão de
 *  fomento. Exigir cadastro para conferir um documento destruiria o propósito da
 *  validação — e o código impresso no certificado é a credencial.
 *
 *  A leitura acontece pela policy `certificate_public_validation`, que libera
 *  exatamente a linha cujo código está na variável de sessão. Sem o código, nada é
 *  visível.
 *
 *  O que a página NÃO mostra: e-mail, documento, endereço, id interno. Mostra o
 *  que está IMPRESSO no certificado — nome, evento, carga horária, código e hash.
 *  Publicar mais do que o documento já expõe seria vazamento disfarçado de
 *  transparência.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function ValidateCertificatePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const result = await getPublicCertificate(decodeURIComponent(code));

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="rounded-lg border border-destructive/40 bg-card p-6 text-sm text-destructive">
          {result.message}
        </p>
      </main>
    );
  }

  const { verdict, certificate } = result;
  const style = STATUS_STYLE[verdict.status] ?? STATUS_STYLE.NOT_FOUND!;
  const Icon = style.icon;

  const countedActivities = certificate?.workloadBreakdown.filter((entry) => entry.counted) ?? [];

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">EventFlow</p>
        <h1 className="text-2xl font-semibold tracking-tight">Validação de certificado</h1>
      </header>

      <section
        className={`space-y-2 rounded-xl border ${style.border} bg-card p-6`}
        data-testid="validation-verdict"
        data-status={verdict.status}
      >
        <p className={`flex items-center gap-2 text-lg font-semibold ${style.text}`}>
          <Icon className="size-5" aria-hidden />
          {verdict.status === 'VALID' ? 'Certificado autêntico' : verdict.message}
        </p>

        {verdict.status === 'VALID' ? (
          <p className="text-sm text-muted-foreground">
            O documento confere com o registro da instituição e a assinatura digital foi verificada.
          </p>
        ) : null}
      </section>

      {certificate ? (
        <>
          <section className="space-y-3 rounded-xl border border-border bg-card p-6" data-testid="certificate-data">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Dados do documento
            </h2>

            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Participante
                </dt>
                <dd className="text-sm font-medium" data-testid="certificate-recipient">
                  {certificate.recipientName}
                </dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Instituição
                </dt>
                <dd className="text-sm font-medium">{certificate.tenantName || '—'}</dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Evento</dt>
                <dd className="text-sm font-medium">{certificate.eventTitle || '—'}</dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Carga horária
                </dt>
                <dd className="text-sm font-medium" data-testid="certificate-workload">
                  {certificate.workloadLabel}
                </dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Tipo</dt>
                <dd className="text-sm font-medium">{CERTIFICATE_KIND_LABELS[certificate.kind]}</dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Emissão</dt>
                <dd className="text-sm font-medium">
                  {certificate.issuedAt
                    ? certificate.issuedAt.toLocaleDateString('pt-BR')
                    : '—'}
                </dd>
              </div>
            </dl>

            <p className="border-t border-border pt-3 text-sm text-muted-foreground">
              {certificate.bodyText}
            </p>
          </section>

          {countedActivities.length > 0 ? (
            <section
              className="space-y-2 rounded-xl border border-border bg-card p-6"
              data-testid="workload-breakdown"
            >
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Composição da carga horária
              </h2>
              <ul className="divide-y divide-border text-sm">
                {countedActivities.map((entry) => (
                  <li key={`${entry.activityId}-${entry.title}`} className="flex justify-between py-2">
                    <span className="truncate">{entry.title}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {entry.countedMinutes} min
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-2 rounded-xl border border-border bg-card p-6" data-testid="certificate-crypto">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Integridade e assinatura
            </h2>

            <p
              className={`flex items-center gap-2 text-sm ${
                certificate.signatureValid ? 'text-success-strong' : 'text-destructive'
              }`}
              data-testid="signature-status"
            >
              <ShieldCheck className="size-4" aria-hidden />
              {certificate.signatureValid
                ? `Assinatura ${certificate.signatureAlg} verificada (chave ${certificate.signatureKeyId}).`
                : 'A assinatura NÃO confere: o conteúdo pode ter sido alterado.'}
            </p>

            <p className="break-all font-mono text-xs text-muted-foreground">
              SHA-256: {certificate.contentHash}
            </p>

            <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <QrCode className="size-3.5" aria-hidden />
              {certificate.validationCode}
            </p>

            <p className="text-xs text-muted-foreground">
              Validado {certificate.validationCount} vez(es). Cada consulta é registrada.
            </p>
          </section>

          {verdict.isUsable ? (
            <p className="flex flex-wrap items-center gap-3 text-sm">
              <a
                href={`/api/certificados/${certificate.validationCode}/arquivo`}
                data-testid="public-download"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition hover:opacity-90"
              >
                <FileText className="size-4" aria-hidden />
                Baixar o PDF
              </a>
              <span className="text-muted-foreground">
                O arquivo é servido por link assinado e temporário.
              </span>
            </p>
          ) : (
            <p className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
              Este documento <strong>não deve ser aceito</strong>: {verdict.message}
            </p>
          )}
        </>
      ) : null}

      <nav className="text-sm">
        <Link href="/" className="font-medium underline underline-offset-4">
          Ir para a página inicial
        </Link>
      </nav>
    </main>
  );
}
