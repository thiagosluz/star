import Link from 'next/link';
import { Award, Download, ExternalLink, QrCode, ShieldCheck } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { can } from '@/domain/rbac/authorization';
import { getRequestContext } from '@/lib/auth/session';
import { tenantPath } from '@/domain/tenancy/resolution';
import { CERTIFICATE_KIND_LABELS, CERTIFICATE_KINDS } from '@/domain/certificates/certificate-rules';
import { listCertificates } from '@/lib/certificates/certificate-service';
import { withTenant } from '@/lib/db/tenant-client';
import { RequestCertificateForm } from '@/components/certificates/request-form';
import { IssueBatchPanel, RevokeCertificateForm } from '@/components/certificates/issue-panel';
import {
  issueEventCertificatesAction,
  requestMyCertificateAction,
  revokeCertificateAction,
} from '@/app/actions/certificate-actions';

export const metadata = { title: 'Meus certificados' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  QUEUED: 'Na fila',
  GENERATING: 'Gerando',
  ISSUED: 'Emitido',
  REVOKED: 'Revogado',
  FAILED: 'Falhou',
  EXPIRED: 'Expirado',
};

/**
 * Certificados do participante (+ painel de emissão para a equipe).
 *
 * A tela mostra o código de validação e o link público de cada documento: é o que
 * permite a quem recebeu o certificado conferir que ele é verdadeiro antes de
 * apresentá-lo — e é a única forma de descobrir uma revogação.
 */
export default async function CertificatesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId, userId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_READ_OWN,
  });

  const context = await getRequestContext();
  const canIssue = can(context?.principal, PERMISSIONS.CERTIFICATE_ISSUE, { scope: 'TENANT' });
  const canRevoke = can(context?.principal, PERMISSIONS.CERTIFICATE_REVOKE, { scope: 'TENANT' });

  const [mineResult, events] = await Promise.all([
    listCertificates({ tenantId, userId }),
    withTenant(tenantId, (tx) =>
      tx.event.findMany({
        where: { tenantId, deletedAt: null, status: { not: 'DRAFT' } },
        orderBy: { startsAt: 'desc' },
        take: 30,
        select: { id: true, title: true },
      }),
    ),
  ]);

  const certificates = mineResult.ok ? mineResult.certificates : [];

  const kindOptions = CERTIFICATE_KINDS.filter((kind) => kind !== 'MERIT').map((kind) => ({
    value: kind,
    label: CERTIFICATE_KIND_LABELS[kind],
  }));

  return (
    <main className="max-w-5xl space-y-8">
      <header className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Award className="size-6 text-primary" aria-hidden />
          Meus certificados
        </h1>
        <p className="text-sm text-muted-foreground">
          Cada certificado tem um código público de validação: qualquer pessoa pode conferir a
          autenticidade em <span className="code-data">/validar/&lt;código&gt;</span> ou lendo o QR
          Code impresso no documento.
        </p>
      </header>

      <section className="space-y-3" aria-labelledby="emitir">
        <h2 id="emitir" className="text-lg font-semibold tracking-tight">
          Emitir um certificado
        </h2>
        <RequestCertificateForm
          tenantSlug={tenantSlug}
          events={events}
          kinds={kindOptions}
          action={requestMyCertificateAction}
        />
      </section>

      <section className="space-y-3" aria-labelledby="lista">
        <h2 id="lista" className="text-lg font-semibold tracking-tight">
          Documentos
        </h2>

        {certificates.length === 0 ? (
          <p
            className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
            data-testid="certificates-empty"
          >
            Você ainda não tem certificados. Faça o credenciamento no evento (a presença precisa
            atingir 75 % da carga da atividade) e emita acima.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="certificate-list">
            {certificates.map((certificate) => (
              <li
                key={certificate.id}
                className="space-y-3 rounded-lg border border-border bg-card p-4"
                data-testid={`certificate-${certificate.validationCode}`}
                data-status={certificate.status}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">{certificate.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {certificate.eventTitle}
                      {certificate.workloadMinutes > 0
                        ? ` · ${certificate.workloadLabel} de carga horária`
                        : ''}
                    </p>
                    <p className="flex items-center gap-2 code-data text-muted-foreground">
                      <QrCode className="size-3" aria-hidden />
                      {certificate.validationCode}
                    </p>
                  </div>

                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      certificate.revokedAt
                        ? 'border-destructive/50 text-destructive'
                        : certificate.status === 'ISSUED'
                          ? 'border-success/40 text-success-strong'
                          : 'border-border text-muted-foreground'
                    }`}
                  >
                    {certificate.revokedAt ? 'Revogado' : (STATUS_LABEL[certificate.status] ?? certificate.status)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {certificate.hasFile ? (
                    <a
                      href={`/api/certificados/${certificate.validationCode}/arquivo`}
                      data-testid={`download-${certificate.validationCode}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground transition hover:opacity-90"
                    >
                      <Download className="size-3.5" aria-hidden />
                      Baixar PDF
                    </a>
                  ) : (
                    <span className="text-muted-foreground" data-testid={`pending-${certificate.validationCode}`}>
                      Arquivo em processamento…
                    </span>
                  )}

                  <Link
                    href={`/validar/${certificate.validationCode}`}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 underline underline-offset-4"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    Página pública de validação
                  </Link>

                  {certificate.contentHash ? (
                    <span className="flex items-center gap-1.5 code-data text-muted-foreground">
                      <ShieldCheck className="size-3" aria-hidden />
                      {certificate.contentHash.slice(0, 16)}…
                    </span>
                  ) : null}
                </div>

                {canRevoke ? (
                  <RevokeCertificateForm
                    tenantSlug={tenantSlug}
                    certificateId={certificate.id}
                    action={revokeCertificateAction}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canIssue ? (
        <IssueBatchPanel
          tenantSlug={tenantSlug}
          events={events}
          kinds={kindOptions}
          action={issueEventCertificatesAction}
        />
      ) : null}

      <nav className="text-sm">
        <Link
          href={tenantPath(tenantSlug, '/conquistas')}
          className="font-medium underline underline-offset-4"
        >
          ← Ver minhas conquistas
        </Link>
      </nav>
    </main>
  );
}
