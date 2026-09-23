import Link from 'next/link';
import { Download, FileBadge, RefreshCw, ShieldAlert } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listCertificatesForAdmin } from '@/lib/admin/gamification-admin-service';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { AdminForm, Field } from '@/components/admin/admin-form';
import { retryCertificateAction, revokeCertificateAdminAction } from '@/app/actions/admin-actions';

export const metadata = { title: 'Certificados' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'Todos' },
  { value: 'QUEUED', label: 'Na fila' },
  { value: 'GENERATING', label: 'Gerando' },
  { value: 'ISSUED', label: 'Emitidos' },
  { value: 'FAILED', label: 'Falharam' },
];

/**
 * Certificados — visão da equipe.
 *
 * A coluna de FALHA é o motivo de a tela existir: um certificado preso em "na
 * fila" sem explicação é descoberto por reclamação do participante. Aqui o
 * operador vê `failureReason`, o número de tentativas e reprocessa com um clique.
 */
export default async function AdminCertificatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ situacao?: string; evento?: string; q?: string }>;
}) {
  const { tenantSlug } = await params;
  const { situacao, evento, q } = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_ISSUE,
  });

  const [certificates, events] = await Promise.all([
    listCertificatesForAdmin(tenantId, { status: situacao, eventId: evento, query: q }),
    listAdminEvents(tenantId),
  ]);

  const eventOptions = [
    { value: '', label: 'Todos os eventos' },
    ...events.map((event) => ({ value: event.id, label: event.title })),
  ];

  const failed = certificates.filter((certificate) => certificate.failureReason);

  return (
    <main className="max-w-5xl space-y-8">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/administracao')}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← Administração
          </Link>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <FileBadge className="size-6 text-primary" aria-hidden />
              Certificados
            </h1>
            <p className="text-sm text-muted-foreground">
              {certificates.length} documento(s) listado(s)
              {failed.length > 0 ? ` · ${failed.length} com falha de geração` : ''}
            </p>
          </div>

          {/*
            ─── O LOTE EM ZIP (FASE 36) ────────────────────────────────────────────
            O download é por EVENTO — é assim que a instituição entrega os documentos
            ("os certificados do congresso"), e é a única granularidade em que o lote
            faz sentido: um ZIP com a instituição inteira misturaria eventos e não
            caberia em memória nenhuma.

            Com um evento escolhido no filtro, o botão aparece e leva ao lote daquele
            evento. Sem ele, a tela diz o que fazer — em vez de oferecer um botão que
            baixaria tudo.
          */}
          {evento ? (
            <a
              href={`/api/t/${tenantSlug}/certificados/zip?evento=${evento}`}
              data-testid="download-certificate-zip"
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              <Download className="size-4" aria-hidden />
              Baixar todos em ZIP
            </a>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="zip-hint">
              Escolha um evento no filtro para baixar o lote em ZIP.
            </p>
          )}
        </div>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3" data-testid="certificate-filters">
        <label className="space-y-1 text-xs font-medium">
          Situação
          <select
            name="situacao"
            defaultValue={situacao ?? 'ALL'}
            aria-label="Situação"
            className="block min-w-40 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs font-medium">
          Evento
          <select
            name="evento"
            defaultValue={evento ?? ''}
            aria-label="Evento"
            className="block min-w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {eventOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs font-medium">
          Buscar
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="nome ou código"
            aria-label="Buscar certificado"
            className="block min-w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>

        <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
          Filtrar
        </button>
      </form>

      {certificates.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="certificates-admin-empty">
          Nenhum certificado encontrado com esse filtro.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="admin-certificate-list">
          {certificates.map((certificate) => (
            <li key={certificate.id} className="space-y-3 rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p className="font-medium">{certificate.recipientName}</p>
                  <p className="text-xs text-muted-foreground">
                    {certificate.eventTitle} · {certificate.kind} ·{' '}
                    {certificate.workloadMinutes > 0 ? `${certificate.workloadMinutes} min` : 'sem carga horária'}
                  </p>
                  <p className="code-data text-muted-foreground">
                    {certificate.validationCode} · {certificate.validationCount} validação(ões)
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      certificate.revokedAt
                        ? 'border-destructive/50 text-destructive'
                        : certificate.hasFile
                          ? 'border-success/40 text-success-strong'
                          : 'border-warning/50 text-warning-strong'
                    }`}
                    data-testid={`status-${certificate.validationCode}`}
                  >
                    {certificate.revokedAt ? 'revogado' : certificate.hasFile ? 'emitido' : certificate.status.toLowerCase()}
                  </span>

                  {certificate.hasFile ? (
                    <a
                      href={`/api/certificados/${certificate.validationCode}/arquivo`}
                      className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Baixar
                    </a>
                  ) : (
                    <AdminForm
                      action={retryCertificateAction}
                      submitLabel="Reprocessar"
                      testId={`retry-${certificate.validationCode}`}
                      compact
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="certificateId" value={certificate.id} />
                      <span className="sr-only">
                        <RefreshCw aria-hidden />
                      </span>
                    </AdminForm>
                  )}
                </div>
              </div>

              {certificate.failureReason ? (
                <p className="flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  <ShieldAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                  Falha após {certificate.attempts} tentativa(s): {certificate.failureReason}
                </p>
              ) : null}

              {!certificate.revokedAt ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Revogar certificado</summary>

                  <div className="pt-2">
                    <AdminForm
                      action={revokeCertificateAdminAction}
                      submitLabel="Confirmar revogação"
                      testId={`revoke-${certificate.validationCode}`}
                      compact
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="certificateId" value={certificate.id} />
                      <Field
                        label="Motivo"
                        name="reason"
                        required
                        placeholder="Presença não comprovada em auditoria"
                        hint="A página pública passa a exibir o documento como inválido"
                      />
                    </AdminForm>
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
