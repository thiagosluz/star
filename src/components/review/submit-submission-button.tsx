'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Send, AlertCircle, CheckCircle2 } from 'lucide-react';

import type { ActionState } from '@/app/actions/review-actions';

function Button({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Send className="size-4" aria-hidden />
      {pending ? 'Enviando…' : 'Enviar para avaliação'}
    </button>
  );
}

export function SubmitSubmissionButton({
  tenantSlug,
  submissionId,
  disabled,
  action,
}: {
  tenantSlug: string;
  submissionId: string;
  disabled: boolean;
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState<ActionState | null, FormData>(action, null);

  if (state?.ok) {
    return (
      <p
        className="flex items-center gap-2 text-sm text-success-strong"
        data-testid="submission-submitted"
      >
        <CheckCircle2 className="size-4" aria-hidden />
        {state.message}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="submissionId" value={submissionId} />
        <Button disabled={disabled} />
      </form>

      {state && !state.ok ? (
        <div role="alert" className="space-y-1 text-xs text-destructive">
          <p className="flex items-center gap-1.5">
            <AlertCircle className="size-3.5" aria-hidden />
            {state.message}
          </p>
          {state.details?.length ? (
            <ul className="ml-5 list-disc">
              {state.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
