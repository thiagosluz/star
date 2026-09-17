'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Gavel } from 'lucide-react';

import type { ActionState } from '@/app/actions/review-actions';
import type { ReviewConsensus } from '@/domain/review/review-rules';

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring/40';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      <Gavel className="size-4" aria-hidden />
      {pending ? 'Registrando…' : label}
    </button>
  );
}

/**
 * Formulário de decisão do comitê.
 *
 * Duas salvaguardas visíveis:
 *   1. o quórum é mostrado, e decidir sem ele exige marcar um override COM
 *      justificativa;
 *   2. o consenso é exibido — inclusive quando DIVERGE, porque uma decisão
 *      tomada sobre pareceres contraditórios merece atenção explícita.
 */
export function DecisionForm({
  tenantSlug,
  submissionId,
  consensus,
  quorumSatisfied,
  quorumMessage,
  suggested,
  action,
}: {
  tenantSlug: string;
  submissionId: string;
  consensus: ReviewConsensus;
  quorumSatisfied: boolean;
  quorumMessage: string;
  suggested: string | null;
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState<ActionState | null, FormData>(action, null);

  if (state?.ok) {
    return (
      <div
        className="space-y-2 rounded-lg border border-success/40 bg-card p-5"
        data-testid="decision-recorded"
      >
        <p className="font-medium text-success-strong">{state.message}</p>
        <p className="text-xs text-muted-foreground">
          A decisão é definitiva para o autor e fica registrada para auditoria.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" data-testid="decision-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="submissionId" value={submissionId} />

      {/* ── Consenso ──────────────────────────────────────────────────────── */}
      <section className="space-y-2 rounded-md border border-border p-4">
        <h3 className="text-sm font-medium">Consenso dos pareceres</h3>

        <p className="text-xs text-muted-foreground">
          {consensus.reviewCount} parecer(es)
          {consensus.averageScore !== null
            ? ` · média ${consensus.averageScore.toFixed(1)}`
            : ''}
          {consensus.scoreStdDev !== null
            ? ` · desvio ${consensus.scoreStdDev.toFixed(1)}`
            : ''}
        </p>

        <ul className="flex flex-wrap gap-2 text-xs">
          {Object.entries(consensus.distribution)
            .filter(([, count]) => count > 0)
            .map(([recommendation, count]) => (
              <li
                key={recommendation}
                className="rounded border border-border px-2 py-0.5 text-muted-foreground"
              >
                {recommendation}: {count}
              </li>
            ))}
        </ul>

        {consensus.requiresDiscussion ? (
          <div
            className="space-y-1 rounded-md border border-warning/40 bg-warning-soft p-3"
            data-testid="consensus-divergence"
          >
            <p className="text-xs font-medium text-warning-strong">
              Os pareceres divergem — discuta antes de decidir
            </p>
            <ul className="ml-4 list-disc text-xs text-warning-strong">
              {consensus.discussionReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {suggested ? (
          <p className="text-xs text-muted-foreground">
            Sugestão a partir da média:{' '}
            <span className="font-medium text-foreground">{suggested}</span>{' '}
            <span className="opacity-70">
              — é apenas uma sugestão; a decisão é do comitê.
            </span>
          </p>
        ) : null}
      </section>

      {/* ── Quórum ────────────────────────────────────────────────────────── */}
      <p
        className={`flex items-center gap-2 text-xs ${
          quorumSatisfied ? 'text-success-strong' : 'text-warning-strong'
        }`}
        data-testid="quorum-message"
      >
        <AlertCircle className="size-3.5 shrink-0" aria-hidden />
        {quorumMessage}
      </p>

      {state && !state.ok ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="decision-error"
        >
          {state.message}
        </p>
      ) : null}

      {/* ── Decisão ───────────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <label htmlFor="decision" className="text-sm font-medium">
          Decisão
        </label>
        <select id="decision" name="decision" required className={inputClass} defaultValue="">
          <option value="" disabled>
            Selecione…
          </option>
          <option value="ACCEPTED">Aceitar</option>
          <option value="REVISION_REQUESTED">Solicitar revisão</option>
          <option value="REJECTED">Rejeitar</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="notes" className="text-sm font-medium">
          Justificativa{' '}
          <span className="font-normal text-muted-foreground">
            (obrigatória ao decidir sem quórum)
          </span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={4000}
          className={inputClass}
          placeholder="Fundamentação da decisão, que será comunicada ao autor."
        />
      </div>

      {!quorumSatisfied ? (
        <label className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft p-3 text-xs">
          <input type="checkbox" name="overrideQuorum" className="mt-0.5" />
          <span className="text-warning-strong">
            Decidir mesmo sem o quórum completo. A justificativa acima é obrigatória e
            ficará registrada na auditoria.
          </span>
        </label>
      ) : null}

      <SubmitButton label="Registrar decisão" />
    </form>
  );
}
