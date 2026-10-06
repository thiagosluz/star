'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AS DUAS DECISÕES DA PÁGINA DE DESCADASTRO (FASE 67 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM COMPONENTE DE CLIENTE, SE A PÁGINA INTEIRA É DO SERVIDOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As duas ações são `POST` (Server Action) e o resultado precisa aparecer ao lado
 *  do botão, sem tirar a pessoa da página. `useActionState` é o caminho que o
 *  projeto já usa em toda tela com ação (convite, campanha, reenvio de e-mail), e
 *  ele exige o limite de cliente.
 *
 *  O que NÃO é de cliente: o texto da página, de quem é a instituição, o nome de
 *  quem está lendo, o que para e o que continua chegando. Tudo isso é renderizado
 *  no servidor e chega pronto — a página funciona como documento mesmo antes de a
 *  hidratação acontecer.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TOKEN VAI EM CAMPO OCULTO, E NÃO NA `action`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Mesma decisão do aceite de convite (FASE 15): ele já está no CAMINHO da barra de
 *  endereços, e repeti-lo na URL do formulário só o espalharia por log, histórico e
 *  referenciador. Ele viaja no `FormData`, e a ação o confere contra o HMAC antes de
 *  ler qualquer coisa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, BellRing, CheckCircle2, Loader2, MailX } from 'lucide-react';

import {
  confirmResubscribeAction,
  confirmUnsubscribeAction,
  type UnsubscribeActionState,
} from '@/app/actions/unsubscribe-actions';

function SubmitButton({
  label,
  testId,
  variant,
  icon,
}: {
  label: string;
  testId: string;
  variant: 'primary' | 'outline';
  icon: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={testId}
      className={variant === 'primary' ? 'ef-button' : 'ef-button-outline'}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  );
}

function Feedback({ state, testId }: { state: UnsubscribeActionState | null; testId: string }) {
  if (!state?.message) return null;

  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      data-testid={testId}
      data-ok={state.ok ? 'true' : 'false'}
      className="flex items-start gap-2 text-sm"
    >
      {state.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span>{state.message}</span>
    </p>
  );
}

/**
 * A CONFIRMAÇÃO DA SAÍDA. Uma decisão, um botão, e o resultado ao lado.
 *
 * O botão diz o que acontece ("Parar de receber os recados") e não "Confirmar":
 * quem chegou até aqui clicou em algo que prometia "cancelar o recebimento", e o
 * rótulo do botão é a última chance de a pessoa perceber que está no lugar certo.
 */
export function UnsubscribeForm({
  tenantSlug,
  token,
}: {
  tenantSlug: string;
  token: string;
}) {
  const [state, formAction] = useActionState<UnsubscribeActionState | null, FormData>(
    confirmUnsubscribeAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3" data-testid="unsubscribe-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="token" value={token} />

      <SubmitButton
        label="Parar de receber os recados em massa"
        testId="unsubscribe-confirm-submit"
        variant="primary"
        icon={<MailX className="size-4" aria-hidden />}
      />

      <Feedback state={state} testId="unsubscribe-feedback" />
    </form>
  );
}

/**
 * O CAMINHO DE VOLTA. Sempre disponível, e não só depois de sair.
 *
 * Ele fica na página mesmo para quem está DENTRO: a dúvida "eu saí sem querer?"
 * chega por telefone, e a resposta honesta é dar o botão — em vez de explicar que
 * a pessoa precisa sair para poder voltar.
 */
export function ResubscribeForm({
  tenantSlug,
  token,
}: {
  tenantSlug: string;
  token: string;
}) {
  const [state, formAction] = useActionState<UnsubscribeActionState | null, FormData>(
    confirmResubscribeAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3" data-testid="resubscribe-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="token" value={token} />

      <SubmitButton
        label="Voltar a receber os recados"
        testId="resubscribe-submit"
        variant="outline"
        icon={<BellRing className="size-4" aria-hidden />}
      />

      <Feedback state={state} testId="resubscribe-feedback" />
    </form>
  );
}
