'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, UserPlus } from 'lucide-react';

import type { ActionState } from '@/app/actions/review-actions';

function Button() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent disabled:opacity-60"
    >
      <UserPlus className="size-3.5" aria-hidden />
      {pending ? 'Atribuindo…' : 'Atribuir'}
    </button>
  );
}

/**
 * Botão de atribuição de revisor.
 *
 * O servidor REVALIDA o conflito de interesse ao criar a atribuição — mesmo que
 * o painel já o tenha feito. Se um conflito surgir entre a montagem da lista e o
 * clique (o revisor declarou algo, um autor foi adicionado), a atribuição é
 * recusada com a razão.
 *
 * Quando o conflito é apenas INCERTO (tipicamente domínio de e-mail
 * compartilhado por coincidência), o comitê pode autorizar explicitamente — e a
 * autorização fica registrada em `matchReason`.
 */
export function AssignReviewerButton({
  tenantSlug,
  submissionId,
  reviewerId,
  reviewerName,
  action,
}: {
  tenantSlug: string;
  submissionId: string;
  reviewerId: string;
  reviewerName: string;
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState<ActionState | null, FormData>(action, null);

  if (state?.ok) {
    return (
      <span className="shrink-0 text-xs text-success-strong" data-testid="assigned-ok">
        atribuído
      </span>
    );
  }

  const conflictBlocked = state?.code === 'CONFLICT_OF_INTEREST';

  return (
    <div className="shrink-0 space-y-1.5">
      <form action={formAction} className="space-y-1.5">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="submissionId" value={submissionId} />
        <input type="hidden" name="reviewerId" value={reviewerId} />
        <input
          type="hidden"
          name="matchReason"
          value={`Atribuído manualmente pelo comitê a partir da lista de elegíveis.`}
        />

        {conflictBlocked ? (
          <label className="flex items-start gap-1.5 text-xs text-warning-strong">
            <input type="checkbox" name="overrideUncertainConflict" className="mt-0.5" />
            <span>
              Autorizar conflito incerto
            </span>
          </label>
        ) : null}

        <Button />
      </form>

      {state && !state.ok ? (
        <p
          role="alert"
          className="max-w-72 text-xs text-destructive"
          data-testid="assign-error"
        >
          <span className="flex items-start gap-1">
            <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              {state.message}
              {reviewerName ? '' : ''}
            </span>
          </span>
        </p>
      ) : null}
    </div>
  );
}
