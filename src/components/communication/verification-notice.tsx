'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, Send } from 'lucide-react';

import { Alert, Button } from '@/components/ui';
import {
  resendVerificationEmailAction,
  type CommunicationActionState,
} from '@/app/actions/communication-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AVISO DE ENDEREÇO NÃO CONFIRMADO (FASE 15, item A5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O AVISO APARECE NO SHELL, E NÃO NUMA TELA DE PERFIL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A verificação de e-mail não bloqueia o login (decisão registrada em `auth.ts`).
 *  Sem aviso, ela simplesmente nunca aconteceria: quem cria a conta entra direto e
 *  não volta para confirmar. Aqui o aviso é o "não bloqueia, mas não esquece" —
 *  aparece em todas as telas da instituição enquanto o endereço não for confirmado, e
 *  some sozinho no primeiro carregamento depois do clique.
 *
 *  Quem pede o reenvio é a PRÓPRIA sessão: a ação não recebe endereço do formulário,
 *  então este botão não pode virar fonte de e-mail para terceiros.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function ResendButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending} data-testid="resend-verification-submit">
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Send className="size-3.5" aria-hidden />
      )}
      Reenviar confirmação
    </Button>
  );
}

export function VerificationNotice({
  email,
  redirectTo,
}: {
  email: string;
  redirectTo: string;
}) {
  const [state, formAction] = useActionState<CommunicationActionState, FormData>(
    resendVerificationEmailAction,
    { ok: false },
  );

  return (
    <Alert
      tone={state.ok ? 'success' : 'warning'}
      title={state.ok ? 'Confirmação enviada' : 'Confirme seu e-mail'}
      data-testid="verification-notice"
      className="mb-6"
    >
      <div className="space-y-3">
        <p>
          {state.ok
            ? state.message
            : `Enviamos um link de confirmação para ${email}. Confirmar o endereço é o que permite recuperar a senha e receber os avisos do evento.`}
        </p>

        {!state.ok ? (
          <form action={formAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <ResendButton />
            {state.message ? (
              <span role="alert" data-testid="resend-verification-error" className="text-xs">
                {state.message}
              </span>
            ) : null}
          </form>
        ) : null}
      </div>
    </Alert>
  );
}
