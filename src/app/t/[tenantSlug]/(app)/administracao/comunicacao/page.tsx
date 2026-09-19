import Link from 'next/link';
import { AlertTriangle, Mail, MailCheck, MailX, Send } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listEmailMessages } from '@/lib/communication/email-service';
import { currentEmailDriver, emailFromAddress } from '@/lib/communication/mailer';
import {
  emailStatusLabel,
  isSandboxSender,
  maskEmailAddress,
} from '@/domain/communication/email-rules';
import { EMAIL_TEMPLATE_LABELS, type EmailTemplateKey } from '@/domain/communication/email-templates';
import { retryEmailAction } from '@/app/actions/communication-actions';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SectionHeading,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrapper,
  buttonClasses,
} from '@/components/ui';

export const metadata = { title: 'Comunicação' };
export const dynamic = 'force-dynamic';

const STATUS_TONES: Record<string, 'primary' | 'success' | 'danger' | 'neutral'> = {
  QUEUED: 'primary',
  SENT: 'success',
  FAILED: 'danger',
  SKIPPED: 'neutral',
};

const FILTERS = [
  { value: null, label: 'Todas' },
  { value: 'SENT', label: 'Enviados' },
  { value: 'QUEUED', label: 'Na fila' },
  { value: 'FAILED', label: 'Falhas' },
] as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAIXA DE SAÍDA DA INSTITUIÇÃO — `/t/<slug>/administracao/comunicacao` (FASE 15)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE MOSTRAR O QUE SAIU
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quando alguém diz "não recebi o convite", a pergunta real é "a plataforma
 *  enviou?". Sem esta tela, a resposta exigiria abrir o painel do provedor e cruzar
 *  endereço e horário na mão. Aqui está o registro da própria plataforma: qual
 *  mensagem, para quem, quando, por qual driver e — quando falhou — por quê.
 *
 *  O HTML enviado fica gravado no outbox (ver `email-service.ts`), então esta tela
 *  responde "o que a pessoa recebeu?", e não "o que o template diz hoje".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ENDEREÇO APARECE MASCARADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela é de administração e mostra para quem foi — mas endereço de pessoa é dado
 *  pessoal, e quem audita o envio não precisa dele inteiro para reconhecer o
 *  destinatário. O domínio fica; a parte local é reduzida (`an***@exemplo.org`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function CommunicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { tenantSlug } = await params;
  const { status } = await searchParams;

  const { tenantId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.COMMUNICATION_READ,
  });

  const { rows, summary } = await listEmailMessages({ tenantId, status: status ?? null });
  const driver = currentEmailDriver();
  const from = emailFromAddress();
  const sandbox = isSandboxSender(from);

  return (
    <div className="space-y-8" data-testid="communication-page">
      <PageHeader
        title="Comunicação"
        description="O que a plataforma enviou em nome da instituição: convites, avisos de avaliação, conquistas e certificados."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Comunicação' },
        ]}
        badge={<Badge tone="primary">{tenantName}</Badge>}
      />

      {driver === 'log' ? (
        <Alert tone="warning" title="Envio real desligado" data-testid="communication-driver-notice">
          O driver de e-mail deste ambiente é <strong className="font-medium">log</strong>: as mensagens
          são registradas aqui e <strong className="font-medium">não saem</strong> para o provedor. É o
          comportamento esperado em desenvolvimento e nos testes. Para enviar de verdade, defina{' '}
          <code className="code-data">EMAIL_DRIVER=resend</code> e{' '}
          <code className="code-data">RESEND_API_KEY</code>.
        </Alert>
      ) : null}

      {/**
       * O remetente de TESTE do Resend (`onboarding@resend.dev`) entrega apenas para o
       * endereço dono da conta do provedor. Sem este aviso, a instituição veria convite
       * "Falhou" com uma mensagem em inglês sobre verificar domínio — e concluiria que a
       * plataforma está quebrada.
       */}
      {driver === 'resend' && sandbox ? (
        <Alert tone="warning" title="Remetente de teste do Resend" data-testid="communication-sandbox-notice">
          O envio está ligado, mas o remetente é{' '}
          <code className="code-data">{from}</code> — o endereço de teste do Resend. Enquanto não houver
          um domínio verificado no provedor, o Resend <strong className="font-medium">só entrega</strong>{' '}
          para o endereço dono da conta: os demais destinatários voltam com erro e aparecem em{' '}
          <strong className="font-medium">Falhas</strong>. Verifique um domínio em resend.com/domains e
          troque <code className="code-data">EMAIL_FROM</code>.
        </Alert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="communication-stats">
        <StatCard
          label="Enviadas"
          value={summary.sent}
          hint="Entregues ao provedor"
          icon={<MailCheck className="size-4" aria-hidden />}
          data-testid="communication-sent-count"
        />
        <StatCard
          label="Na fila"
          value={summary.queued}
          hint="Aguardando entrega"
          icon={<Send className="size-4" aria-hidden />}
        />
        <StatCard
          label="Falhas"
          value={summary.failed}
          hint="Precisam de atenção"
          icon={<MailX className="size-4" aria-hidden />}
          tone={summary.failed > 0 ? 'warning' : 'primary'}
          data-testid="communication-failed-count"
        />
        <StatCard
          label="Automáticas"
          value={summary.sent + summary.queued + summary.failed}
          hint="Convites, avaliações, conquistas e certificados"
          icon={<Mail className="size-4" aria-hidden />}
        />
      </section>

      <section className="space-y-4" aria-labelledby="caixa-de-saida">
        <SectionHeading
          title="Mensagens"
          description="Cada linha é uma mensagem que a plataforma registrou em nome da instituição."
          actions={
            <nav className="flex flex-wrap gap-1" aria-label="Filtrar por situação">
              {FILTERS.map((filter) => {
                const active = (status ?? null) === filter.value;
                const href = filter.value
                  ? `${tenantPath(tenantSlug, '/administracao/comunicacao')}?status=${filter.value}`
                  : tenantPath(tenantSlug, '/administracao/comunicacao');

                return (
                  <Link
                    key={filter.label}
                    href={href}
                    aria-current={active ? 'true' : undefined}
                    data-testid={`communication-filter-${filter.value ?? 'all'}`}
                    className={buttonClasses({
                      variant: active ? 'primary' : 'outline',
                      size: 'sm',
                    })}
                  >
                    {filter.label}
                  </Link>
                );
              })}
            </nav>
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="Nenhuma mensagem"
            description="Quando a plataforma enviar um convite, um aviso de avaliação, uma conquista ou um certificado, o registro aparece aqui."
          />
        ) : (
          <Card className="overflow-hidden">
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Mensagem</TH>
                    <TH>Destinatário</TH>
                    <TH>Situação</TH>
                    <TH>Quando</TH>
                    <TH>Ações</TH>
                  </TR>
                </THead>
                <TBody data-testid="communication-messages">
                  {rows.map((row) => (
                    <TR key={row.id} data-message-id={row.id} data-status={row.status}>
                      <TD>
                        <span className="block font-medium text-foreground">{row.subject}</span>
                        <span className="block text-xs text-muted-foreground">
                          {EMAIL_TEMPLATE_LABELS[row.template as EmailTemplateKey] ?? row.template}
                          {row.error ? ` · ${row.error}` : ''}
                        </span>
                      </TD>
                      <TD className="text-xs text-muted-foreground">{maskEmailAddress(row.to)}</TD>
                      <TD>
                        <Badge tone={STATUS_TONES[row.status] ?? 'neutral'} size="sm">
                          {emailStatusLabel(row.status)}
                        </Badge>
                      </TD>
                      <TD className="text-xs text-muted-foreground">
                        {(row.sentAt ?? row.createdAt).toLocaleString('pt-BR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                        {row.attempts > 1 ? ` · ${row.attempts} tentativas` : ''}
                      </TD>
                      <TD>
                        {row.status === 'FAILED' ? (
                          <InlineActionForm
                            action={retryEmailAction}
                            submitLabel="Tentar de novo"
                            testId={`retry-email-${row.id}`}
                            quietSuccess
                          >
                            <input type="hidden" name="tenantSlug" value={tenantSlug} />
                            <input type="hidden" name="emailMessageId" value={row.id} />
                          </InlineActionForm>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          </Card>
        )}
      </section>

      <Alert tone="info" title="Como a entrega funciona">
        A mensagem nasce registrada (na fila) e é entregue pelo worker, com até cinco tentativas e espera
        crescente entre elas. Falha por chave inválida ou remetente não verificado não é retentada —
        insistir não resolveria —, e é o caso que aparece em <strong className="font-medium">Falhas</strong>{' '}
        com o motivo escrito.
        {driver === 'log' ? (
          <>
            {' '}
            <AlertTriangle className="inline size-3.5 align-text-bottom" aria-hidden /> Neste ambiente o
            envio externo está desligado.
          </>
        ) : null}
      </Alert>
    </div>
  );
}
