import { History } from 'lucide-react';

import { campaignSendAction } from '@/app/actions/communication-actions';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { Alert, Badge, Card, EmptyState, SectionHeading } from '@/components/ui';
import { CAMPAIGN_STATUS_LABELS, campaignStatusLabel } from '@/domain/communication/campaign-rules';
import type { CampaignHistoryRow } from '@/lib/communication/campaign-history-service';

const CAMPAIGN_TONES: Record<string, 'primary' | 'success' | 'warning' | 'neutral'> = {
  DRAFT: 'neutral',
  SENDING: 'warning',
  SENT: 'success',
};

/** Histórico das campanhas segmentadas com seleção congelada e reenvio idempotente. */
export function SegmentHistory({
  tenantSlug,
  rows,
}: {
  tenantSlug: string;
  rows: readonly CampaignHistoryRow[];
}) {
  return (
    <section className="space-y-4" aria-labelledby="historico-de-campanhas">
      <SectionHeading
        title="Histórico das campanhas"
        description="Cada linha é um disparo: quem mandou, o texto, a seleção congelada e o resultado real de cada passada."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nenhuma campanha ainda"
          description="Monte um segmento acima e confirme o envio: a campanha aparece aqui com as frases que a explicam e a contagem do dia."
        />
      ) : (
        <ul className="space-y-3" data-testid="campaign-history">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className="space-y-3 p-4" data-testid="campaign-row" data-campaign-id={row.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-foreground" data-testid="campaign-subject">
                    {row.subject}
                  </p>
                  <Badge tone={CAMPAIGN_TONES[row.status] ?? 'neutral'} size="sm">
                    {campaignStatusLabel(row.status)}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground" data-testid="campaign-meta">
                  <span data-testid="campaign-created-at">
                    {row.createdAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  {' · '}
                  {row.authorName ?? 'conta removida'}
                  {row.eventTitle ? ` · ${row.eventTitle}` : ' · instituição inteira'}
                </p>

                <div className="space-y-1">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    O que esta campanha selecionou
                  </h3>
                  <ul className="space-y-1 text-sm text-foreground" data-testid="campaign-explanation">
                    {row.explanation.map((phrase) => (
                      <li key={phrase}>{phrase}</li>
                    ))}
                  </ul>
                </div>

                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="campaign-counts">
                  <li data-testid="campaign-recipients">Selecionados: {row.recipientCount}</li>
                  <li>No outbox: {row.reachedCount}</li>
                  <li>Falharam: {row.failedCount}</li>
                  <li>Saíram do canal: {row.skippedCount}</li>
                  {row.finishedAt ? (
                    <li data-testid="campaign-finished-at">
                      Última passada:{' '}
                      {row.finishedAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </li>
                  ) : null}
                </ul>

                {row.status === 'DRAFT' ? (
                  <p className="text-xs text-muted-foreground">
                    A campanha ainda não saiu por completo. Disparar de novo continua de onde parou.
                  </p>
                ) : null}

                {row.error ? (
                  <p className="text-xs text-destructive" role="alert" data-testid="campaign-error">
                    {row.error}
                  </p>
                ) : null}

                <InlineActionForm
                  action={campaignSendAction}
                  submitLabel="Reenviar esta campanha"
                  testId={`campaign-resend-${row.id}`}
                  variant="outline"
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="acao" value="reenviar" />
                  <input type="hidden" name="campaignId" value={row.id} />
                </InlineActionForm>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Alert tone="info" title="Reenviar é caminho de operação, não erro">
        Uma passada pode parar no meio por causa do limite de ritmo do provedor, ou falhar em parte das
        mensagens. Reenviar a MESMA campanha continua de onde parou:{' '}
        <code className="code-data">campaign:&lt;campanha&gt;:&lt;pessoa&gt;</code> é a chave do fato, e quem já
        entrou no outbox volta como “já existia” — ninguém recebe duas vezes. Os estados são{' '}
        {Object.values(CAMPAIGN_STATUS_LABELS).join(' · ')}.
      </Alert>
    </section>
  );
}
