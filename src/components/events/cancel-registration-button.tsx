'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { X } from 'lucide-react';

import {
  cancelRegistrationAction,
  type RegistrationActionState,
} from '@/app/actions/registration-actions';

function CancelButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
    >
      <X className="mr-1 inline size-3" aria-hidden />
      {pending ? 'Cancelando…' : 'Cancelar'}
    </button>
  );
}

/**
 * Botão de cancelamento.
 *
 * `confirm()` do navegador é usado deliberadamente: cancelar libera a vaga para
 * outra pessoa, então uma confirmação explícita é desejável antes de uma ação
 * irreversível (o estado CANCELED é terminal).
 */
export function CancelRegistrationButton({
  tenantSlug,
  eventSlug,
  registrationId,
}: {
  tenantSlug: string;
  eventSlug: string;
  registrationId: string;
}) {
  const [state, formAction] = useActionState<RegistrationActionState | null, FormData>(
    cancelRegistrationAction,
    null,
  );

  if (state?.ok) {
    return (
      <span className="text-xs text-muted-foreground" data-testid="cancel-result">
        {state.message}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (
            !window.confirm(
              'Cancelar sua inscrição? Sua vaga será liberada para a lista de espera.',
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventSlug" value={eventSlug} />
        <input type="hidden" name="registrationId" value={registrationId} />
        <CancelButton />
      </form>

      {state && !state.ok && state.message ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
