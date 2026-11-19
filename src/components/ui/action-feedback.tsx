'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UI — Banner canônico de retorno de Server Action (FASE 117 · ADR-474)
 *
 *  Renderiza qualquer `ActionGuardState` (sucesso ou erro + lista `details`)
 *  sobre o primitivo `<Alert>`, mantendo contratos de acessibilidade e `data-testid`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { ReactNode } from 'react';

import type { ActionGuardState } from '@/lib/auth/guard-action';
import { Alert } from './feedback';

export interface ActionFeedbackProps {
  state: ActionGuardState | null;
  /** Prefixo para `${testId}-ok` / `${testId}-error` (ou literal quando `exactTestId` for true). */
  testId?: string;
  /** Quando `true`, aplica `data-testid={testId}` literalmente em vez de anexar `-ok`/`-error`. */
  exactTestId?: boolean;
  okTestId?: string;
  errorTestId?: string;
  fallbackOk?: string;
  fallbackError?: string;
  className?: string;
  children?: ReactNode;
}

export function ActionFeedback({
  state,
  testId,
  exactTestId = false,
  okTestId,
  errorTestId,
  fallbackOk = 'Pronto.',
  fallbackError = 'Não foi possível concluir.',
  className,
  children,
}: ActionFeedbackProps) {
  if (!state) return null;

  const resolvedTestId = state.ok
    ? (okTestId ?? (testId ? (exactTestId ? testId : `${testId}-ok`) : undefined))
    : (errorTestId ?? (testId ? (exactTestId ? testId : `${testId}-error`) : undefined));

  return (
    <Alert
      tone={state.ok ? 'success' : 'danger'}
      className={className}
      data-testid={resolvedTestId}
      data-ok={state.ok ? 'true' : 'false'}
    >
      <span>{state.message ?? (state.ok ? fallbackOk : fallbackError)}</span>
      {state.details && state.details.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-xs">
          {state.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {children}
    </Alert>
  );
}
