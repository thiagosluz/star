import Link from 'next/link';

import { OutboxPanel } from '@/components/communication/outbox-panel';
import { SegmentsPanel } from '@/components/communication/segments-panel';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { Alert, PageHeader } from '@/components/ui';
import { isSandboxSender } from '@/domain/communication/email-rules';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { requirePagePermission } from '@/lib/auth/guard-page';
import { currentEmailDriver, emailFromAddress } from '@/lib/communication/mailer';
import type { RawSearchParams } from '@/lib/communication/segment-form';

export const metadata = { title: 'Comunicação' };
export const dynamic = 'force-dynamic';

/** Página de Comunicação da instituição: guarda RBAC, abas por URL e delegação aos painéis. */
export default async function CommunicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { tenantSlug } = await params;
  const raw = await searchParams;
  const status = typeof raw.status === 'string' ? raw.status : null;
  const segmentTab = raw.aba === 'segmentos';

  const { tenantId, tenantName, userId, principal } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.COMMUNICATION_READ,
  });

  const canSend = can(principal, PERMISSIONS.PARTICIPANT_MESSAGE, { scope: 'TENANT' });

  const basePath = tenantPath(tenantSlug, '/administracao/comunicacao');
  const driver = currentEmailDriver();
  const from = emailFromAddress();
  const sandbox = isSandboxSender(from);

  const tabs = [
    { key: 'saida', label: 'Caixa de saída', href: basePath, active: !segmentTab },
    ...(canSend
      ? [
          {
            key: 'segmentos',
            label: 'Segmentos',
            href: `${basePath}?aba=segmentos`,
            active: segmentTab,
          },
        ]
      : []),
  ];

  return (
    <main className="space-y-8" data-testid="communication-page">
      <PageHeader
        title="Comunicação"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        description="O que a plataforma enviou em nome da instituição — e para quem: convites, avisos, conquistas, certificados e as campanhas segmentadas."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Comunicação' },
        ]}
      />

      {driver === 'log' ? (
        <Alert tone="warning" title="Envio real desligado" data-testid="communication-driver-notice">
          O driver de e-mail deste ambiente é <strong className="font-medium">log</strong>: as mensagens são
          registradas aqui e <strong className="font-medium">não saem</strong> para o provedor. É o
          comportamento esperado em desenvolvimento e nos testes. Para enviar de verdade, defina{' '}
          <code className="code-data">EMAIL_DRIVER=resend</code> e{' '}
          <code className="code-data">RESEND_API_KEY</code>.
        </Alert>
      ) : null}

      {driver === 'resend' && sandbox ? (
        <Alert tone="warning" title="Remetente de teste do Resend" data-testid="communication-sandbox-notice">
          O envio está ligado, mas o remetente é <code className="code-data">{from}</code> — o endereço de teste
          do Resend. Enquanto não houver um domínio verificado no provedor, o Resend{' '}
          <strong className="font-medium">só entrega</strong> para o endereço dono da conta: os demais
          destinatários voltam com erro e aparecem em <strong className="font-medium">Falhas</strong>. Verifique
          um domínio em resend.com/domains e troque <code className="code-data">EMAIL_FROM</code>.
        </Alert>
      ) : null}

      <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Seções da comunicação">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.active ? 'page' : undefined}
            data-testid={`communication-tab-${tab.key}`}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors ${
              tab.active
                ? 'border-primary font-medium text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {segmentTab ? (
        canSend ? (
          <SegmentsPanel
            tenantSlug={tenantSlug}
            tenantName={tenantName}
            tenantId={tenantId}
            userId={userId}
            searchParams={raw}
          />
        ) : (
          <Alert tone="warning" title="Permissão necessária" data-testid="segments-forbidden">
            Montar e disparar campanha exige a permissão <code className="code-data">participant:message</code>,
            que o seu papel não tem nesta instituição. A caixa de saída continua disponível.
          </Alert>
        )
      ) : (
        <OutboxPanel tenantSlug={tenantSlug} tenantId={tenantId} status={status} driver={driver} />
      )}
    </main>
  );
}
