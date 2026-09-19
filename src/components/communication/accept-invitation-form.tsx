'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Loader2, UserRoundPlus } from 'lucide-react';

import { acceptInvitationAction, type CommunicationActionState } from '@/app/actions/communication-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ACEITE DO CONVITE DE EQUIPE (FASE 15)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CÓDIGO VIAJA EM CAMPO OCULTO, NÃO NA URL DO FORMULÁRIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele já está na barra de endereços (é o link que a pessoa recebeu); repeti-lo na
 *  `action` do formulário só o espalharia por logs e referências. A Server Action
 *  recebe o token pelo `FormData`, junto com o slug da instituição.
 *
 *  A recusa aparece NA TELA, sem prometer sucesso: endereço de outra conta, convite
 *  vencido, cancelado ou já aceito são respostas de negócio, e a pessoa precisa
 *  saber qual delas aconteceu para decidir o próximo passo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function AcceptSubmit() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="ef-button" disabled={pending} data-testid="accept-invitation-submit">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserRoundPlus className="size-4" aria-hidden />}
      Aceitar convite
    </button>
  );
}

export function AcceptInvitationForm({
  tenantSlug,
  token,
}: {
  tenantSlug: string;
  token: string;
}) {
  const [state, formAction] = useActionState<CommunicationActionState, FormData>(
    acceptInvitationAction,
    { ok: false },
  );

  return (
    <form action={formAction} className="space-y-3" data-testid="accept-invitation-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="token" value={token} />

      <AcceptSubmit />

      {!state.ok && state.message ? (
        <p
          role="alert"
          data-testid="accept-invitation-error"
          className="flex items-start gap-2 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {state.message}
            {state.details?.length ? (
              <span className="block opacity-75">{state.details.join(' ')}</span>
            ) : null}
          </span>
        </p>
      ) : null}
    </form>
  );
}
