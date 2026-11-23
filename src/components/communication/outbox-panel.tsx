import Link from 'next/link';
import { AlertTriangle, Mail, MailCheck, MailX, Send } from 'lucide-react';

import { retryEmailAction } from '@/app/actions/communication-actions';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
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
import { emailStatusLabel, maskEmailAddress } from '@/domain/communication/email-rules';
import { EMAIL_TEMPLATE_LABELS, type EmailTemplateKey } from '@/domain/communication/email-templates';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listEmailMessages } from '@/lib/communication/email-service';

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

/** Aba 1 de Comunicação: métricas, filtros por situação e fila/outbox com reprocessamento. */
export async function OutboxPanel({
  tenantSlug,
  tenantId,
  status,
  driver,
}: {
  tenantSlug: string;
  tenantId: string;
  status: string | null;
  driver: string;
}) {
  const { rows, summary } = await listEmailMessages({ tenantId, status });
  const basePath = tenantPath(tenantSlug, '/administracao/comunicacao');

  return (
    <>
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
          hint="Convites, avaliações, conquistas, certificados e campanhas"
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
                const active = status === filter.value;
                const href = filter.value ? `${basePath}?status=${filter.value}` : basePath;

                return (
                  <Link
                    key={filter.label}
                    href={href}
                    aria-current={active ? 'true' : undefined}
                    data-testid={`communication-filter-${filter.value ?? 'all'}`}
                    className={buttonClasses({ variant: active ? 'primary' : 'outline', size: 'sm' })}
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
            description="Quando a plataforma enviar um convite, um aviso de avaliação, uma conquista, um certificado ou uma campanha, o registro aparece aqui."
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
        insistir não resolveria —, e é o caso que aparece em{' '}
        <strong className="font-medium">Falhas</strong> com o motivo escrito.
        {driver === 'log' ? (
          <>
            {' '}
            <AlertTriangle className="inline size-3.5 align-text-bottom" aria-hidden /> Neste ambiente o envio
            externo está desligado.
          </>
        ) : null}
      </Alert>
    </>
  );
}
