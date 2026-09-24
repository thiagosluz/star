import Link from 'next/link';
import { ShieldCheck, ShieldOff } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { SectionHeading } from '@/components/ui';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { listMySponsorShares } from '@/lib/sponsors/sponsor-portal-service';
import { revokeSponsorConsentAction } from '@/app/actions/sponsor-portal-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MEUS COMPARTILHAMENTOS (FASE 42) — a tela do PARTICIPANTE
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA TELA PRECISA EXISTIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Consentimento que não pode ser retirado não é consentimento: é autorização sem
 *  volta. Aqui a pessoa vê EXATAMENTE o que compartilhou (nome, e-mail, com quem e
 *  por quanto tempo) e revoga com um clique — e a revogação tem efeito imediato,
 *  porque a lista do patrocinador é filtrada por `evaluateLeadAccess` na leitura.
 *
 *  A guarda é `tenant:read` no escopo da instituição com posse implícita: o serviço
 *  filtra por `userId` da SESSÃO, então ninguém vê o compartilhamento de outra
 *  pessoa nem passando um id na URL.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const metadata = { title: 'Meus compartilhamentos' };
export const dynamic = 'force-dynamic';

export default async function MySponsorSharesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId, userId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.TENANT_READ,
  });

  const shares = await listMySponsorShares(tenantId, userId);

  return (
    <main className="max-w-4xl space-y-6" data-testid="my-shares">
      <header className="space-y-1.5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="size-6 text-primary" aria-hidden />
          Meus compartilhamentos
        </h1>
        <p className="text-sm text-muted-foreground">
          O que você autorizou ao ler o QR de um patrocinador. A revogação vale na hora: o
          patrocinador deixa de ver os seus dados, e a visita continua contada sem identificar você.
        </p>
      </header>

      {shares.length === 0 ? (
        <p
          className="rounded-md border border-border p-4 text-sm text-muted-foreground"
          data-testid="my-shares-empty"
        >
          Você ainda não compartilhou dados com nenhum patrocinador. Ao ler o QR de um estande, a
          escolha aparece aqui — e você pode mudar de ideia depois.
        </p>
      ) : (
        <section className="space-y-3">
          <SectionHeading title={`Autorizações (${shares.length})`} />

          <ul className="space-y-3" data-testid="my-shares-list">
            {shares.map((share) => {
              const vigente = share.state === 'ACTIVE';

              return (
                <li
                  key={share.scanId}
                  className="space-y-3 rounded-lg border border-border p-4"
                  data-testid={`share-${share.scanId}`}
                  data-state={share.state}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {vigente ? (
                          <ShieldCheck className="size-4 text-success-strong" aria-hidden />
                        ) : (
                          <ShieldOff className="size-4 text-muted-foreground" aria-hidden />
                        )}
                        {share.sponsorName}
                        <span className="text-xs font-normal text-muted-foreground">
                          {share.stateLabel}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {share.eventTitle} · {share.qrLabel} · autorizado em{' '}
                        {share.consentedAt.toLocaleDateString('pt-BR')}
                        {share.expiresAt
                          ? ` · vale até ${share.expiresAt.toLocaleDateString('pt-BR')}`
                          : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Compartilhado: {share.sharedName} · {share.sharedEmail}
                      </p>
                    </div>

                    {vigente ? (
                      <InlineActionForm
                        action={revokeSponsorConsentAction}
                        submitLabel="Revogar"
                        variant="destructive"
                        testId={`revoke-${share.scanId}`}
                        confirm={{
                          title: `Revogar a autorização para ${share.sponsorName}?`,
                          description:
                            'O patrocinador deixa de ver o seu nome e o seu e-mail imediatamente. A sua visita continua contada, sem identificar você.',
                          confirmLabel: 'Revogar autorização',
                        }}
                      >
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="scanId" value={share.scanId} />
                      </InlineActionForm>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Quer ver o que você ganhou lendo os QRs?{' '}
        <Link
          href={tenantPath(tenantSlug, '/cartas')}
          className="underline underline-offset-4"
        >
          Álbum de cartas
        </Link>{' '}
        e{' '}
        <Link
          href={tenantPath(tenantSlug, '/conquistas')}
          className="underline underline-offset-4"
        >
          conquistas
        </Link>
        .
      </p>
    </main>
  );
}
