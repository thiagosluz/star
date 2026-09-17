'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Send } from 'lucide-react';

import type { ActionState } from '@/app/actions/review-actions';
import type { RubricCriterion } from '@/domain/review/review-rules';

const RECOMMENDATIONS = [
  { value: 'ACCEPT', label: 'Aceitar' },
  { value: 'MINOR_REVISION', label: 'Aceitar com revisões menores' },
  { value: 'MAJOR_REVISION', label: 'Revisões maiores' },
  { value: 'REJECT', label: 'Rejeitar' },
] as const;

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring/40';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      <Send className="size-4" aria-hidden />
      {pending ? 'Enviando…' : 'Enviar parecer'}
    </button>
  );
}

/**
 * Formulário de parecer.
 *
 * ─── A NOTA FINAL NÃO ESTÁ AQUI ──────────────────────────────────────────────
 * O revisor informa as notas POR CRITÉRIO. A nota ponderada é calculada no
 * servidor a partir da rubrica da trilha. Aceitar a nota final do cliente
 * permitiria declarar qualquer resultado sem relação com as notas dadas.
 *
 * A prévia mostrada abaixo é apenas informativa — o servidor recalcula.
 */
export function ReviewForm({
  tenantSlug,
  submissionId,
  rubric,
  action,
  alreadySubmitted,
}: {
  tenantSlug: string;
  submissionId: string;
  rubric: readonly RubricCriterion[];
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
  alreadySubmitted: boolean;
}) {
  const [state, formAction] = useActionState<ActionState | null, FormData>(action, null);
  const [scores, setScores] = useState<Record<string, number>>({});

  if (alreadySubmitted) {
    return (
      <p
        className="flex items-center gap-2 rounded-lg border border-border bg-card p-5 text-sm text-success-strong"
        data-testid="review-already-submitted"
      >
        <CheckCircle2 className="size-4" aria-hidden />
        Você já enviou o parecer desta submissão.
      </p>
    );
  }

  /** Prévia da nota ponderada — mesma fórmula do servidor, apenas informativa. */
  const totalWeight = rubric.reduce((sum, criterion) => sum + criterion.weight, 0);
  const preview = rubric.every((criterion) => Number.isFinite(scores[criterion.key]))
    ? rubric.reduce((sum, criterion) => {
        const value = Math.min(scores[criterion.key] ?? 0, criterion.maxScore);
        return sum + (value / criterion.maxScore) * criterion.weight * (100 / totalWeight);
      }, 0)
    : null;

  return (
    <form action={formAction} className="space-y-6" data-testid="review-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="submissionId" value={submissionId} />

      {state && !state.ok ? (
        <div
          role="alert"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="review-error"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden />
            {state.message}
          </p>
          {state.details?.length ? (
            <ul className="ml-6 list-disc text-xs">
              {state.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ── Notas por critério ────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium">Avaliação por critério</h3>

        {rubric.map((criterion) => (
          <div key={criterion.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={`score_${criterion.key}`} className="text-sm">
                {criterion.label}
                <span className="ml-1 text-xs text-muted-foreground">
                  (peso {criterion.weight})
                </span>
              </label>
              <span className="text-xs text-muted-foreground">
                <span data-testid={`score-value-${criterion.key}`}>
                  {scores[criterion.key] ?? '—'}
                </span>{' '}
                / {criterion.maxScore}
              </span>
            </div>

            {criterion.description ? (
              <p className="text-xs text-muted-foreground">{criterion.description}</p>
            ) : null}

            <input
              id={`score_${criterion.key}`}
              name={`score_${criterion.key}`}
              type="range"
              min={0}
              max={criterion.maxScore}
              step={0.5}
              required
              value={scores[criterion.key] ?? Math.round(criterion.maxScore / 2)}
              onChange={(event) =>
                setScores((previous) => ({
                  ...previous,
                  [criterion.key]: Number(event.target.value),
                }))
              }
              className="w-full"
            />
          </div>
        ))}

        {preview !== null ? (
          <p className="text-sm text-muted-foreground">
            Nota ponderada estimada:{' '}
            <span className="font-semibold tabular-nums text-foreground">
              {preview.toFixed(1)}
            </span>{' '}
            / 100
            <span className="ml-2 text-xs">
              (o servidor recalcula no envio)
            </span>
          </p>
        ) : null}
      </section>

      {/* ── Recomendação ──────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <label htmlFor="recommendation" className="text-sm font-medium">
          Recomendação
        </label>
        <select
          id="recommendation"
          name="recommendation"
          required
          className={inputClass}
          defaultValue=""
        >
          <option value="" disabled>
            Selecione…
          </option>
          {RECOMMENDATIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      {/* ── Comentários ───────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <label htmlFor="feedbackToAuthor" className="text-sm font-medium">
          Comentários para o autor
        </label>
        <textarea
          id="feedbackToAuthor"
          name="feedbackToAuthor"
          rows={5}
          maxLength={8000}
          className={inputClass}
          placeholder="Pontos fortes, fragilidades e sugestões de melhoria. Estes comentários são devolvidos ao autor."
        />
      </section>

      <section className="space-y-2">
        <label htmlFor="confidentialComments" className="text-sm font-medium">
          Comentários confidenciais ao comitê{' '}
          <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <textarea
          id="confidentialComments"
          name="confidentialComments"
          rows={3}
          maxLength={8000}
          className={inputClass}
          placeholder="Observações que não devem ser vistas pelo autor."
        />
        <p className="text-xs text-muted-foreground">
          Estes comentários não são exibidos ao autor em nenhuma hipótese.
        </p>
      </section>

      <SubmitButton />
    </form>
  );
}
