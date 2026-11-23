'use client';

import { CheckCircle2, TriangleAlert, UserCheck, XCircle } from 'lucide-react';

export type MonitorFeedback = {
  ok: boolean;
  message: string;
  details: readonly string[];
  data: Record<string, unknown> | undefined;
};

/** Cartão de retorno imediato da leitura de crachá (acima da câmera no balcão). */
export function MonitorFeedbackCard({
  feedback,
  eventTitle,
  'data-testid': testId = 'monitor-feedback',
}: {
  feedback: MonitorFeedback;
  eventTitle: string;
  'data-testid'?: string;
}) {
  const outcomeAction = typeof feedback.data?.action === 'string' ? feedback.data.action : null;
  const outcomeName = typeof feedback.data?.userName === 'string' ? feedback.data.userName : null;
  const outcomeMinutes = typeof feedback.data?.minutes === 'number' ? feedback.data.minutes : null;
  const outcomeCategory =
    typeof feedback.data?.categoryLabel === 'string' ? feedback.data.categoryLabel : null;

  return (
    <div
      role={feedback.ok ? 'status' : 'alert'}
      data-testid={testId}
      data-action={outcomeAction ?? (feedback.ok ? 'OK' : 'ERRO')}
      className={`space-y-1 rounded-xl border p-4 ${
        feedback.ok ? 'border-success/40 bg-success-soft' : 'border-destructive/40 bg-destructive-soft'
      }`}
    >
      <p className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        {feedback.ok ? (
          outcomeAction === 'CHECKED_OUT' ? (
            <CheckCircle2 className="size-6 text-success-strong" aria-hidden />
          ) : (
            <UserCheck className="size-6 text-success-strong" aria-hidden />
          )
        ) : (
          <XCircle className="size-6 text-destructive" aria-hidden />
        )}
        {outcomeName ?? feedback.message}
      </p>

      {feedback.ok && outcomeCategory ? (
        <p className="text-xs text-muted-foreground" data-testid="monitor-category">
          Categoria do crachá: <span className="font-medium text-foreground">{outcomeCategory}</span>
        </p>
      ) : null}

      <p className="text-sm">{feedback.ok && outcomeName ? feedback.message : feedback.ok ? '' : feedback.message}</p>

      {outcomeMinutes !== null ? (
        <p className="text-sm text-muted-foreground">
          {outcomeMinutes} minuto(s) nesta sessão · total fechado no contexto:{' '}
          {String(feedback.data?.closedMinutes ?? 0)} min
        </p>
      ) : null}

      {feedback.details.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-warning-strong" data-testid="monitor-warnings">
          {feedback.details.map((detail) => (
            <li key={detail} className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {detail}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-muted-foreground">{eventTitle}</p>
    </div>
  );
}
