'use client';

import { useActionState } from 'react';
import { KeyRound, Loader2, MailCheck, ShieldCheck } from 'lucide-react';

import { Alert, Button, Field, Input } from '@/components/ui';
import { PASSWORD_MIN_LENGTH, passwordHint } from '@/domain/account/account-rules';
import type { ActionState } from '@/app/actions/auth-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FORMULÁRIOS DE ENTRADA — recuperação de senha e desafio do segundo fator
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES FORMULÁRIOS NÃO FAZEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não dizem se o e-mail existe, não guardam token em estado próprio e não decidem
 *  nada: o token viaja em campo oculto (veio da URL e volta para o servidor), e quem
 *  valida é a biblioteca. A tela só mostra o que voltou.
 *
 *  O aviso de "mesma resposta para todos" no pedido de redefinição não é frieza: é o
 *  que impede a tela de virar um oráculo de quem tem conta na plataforma.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

type Action = (prev: ActionState | null, formData: FormData) => Promise<ActionState>;

// ───────────────────────────────────────────────────────────────────────────────
//  Pedido de redefinição
// ───────────────────────────────────────────────────────────────────────────────
export function RequestResetForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, null);

  if (state?.ok) {
    return (
      <Alert tone="success" title="Confira o seu e-mail" data-testid="reset-request-sent">
        <p>{state.message}</p>
        <p className="mt-2 text-xs">
          O link vale por 60 minutos e só pode ser usado uma vez. Se não chegar, peça outro — o
          anterior deixa de valer.
        </p>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-4" data-testid="reset-request-form" noValidate>
      {state?.message ? (
        <Alert tone="danger" data-testid="reset-request-error">
          {state.message}
        </Alert>
      ) : null}

      <Field
        name="reset-email"
        label="E-mail da conta"
        hint="Enviaremos um link para você definir uma nova senha."
      >
        <Input
          id="reset-email"
          name="email"
          type="email"
          required
          maxLength={255}
          autoComplete="email"
          data-testid="reset-email"
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full" data-testid="request-reset">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MailCheck className="size-4" aria-hidden />}
        Enviar link de redefinição
      </Button>
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Definição da nova senha
// ───────────────────────────────────────────────────────────────────────────────
export function ResetPasswordForm({ action, token }: { action: Action; token: string }) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-4" data-testid="reset-password-form" noValidate>
      <input type="hidden" name="token" value={token} />

      {state?.message ? (
        <Alert tone="danger" data-testid="reset-password-error">
          {state.message}
        </Alert>
      ) : null}

      <Field name="reset-new-password" label="Nova senha" hint={passwordHint()}>
        <Input
          id="reset-new-password"
          name="newPassword"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={128}
          autoComplete="new-password"
          data-testid="reset-new-password"
        />
      </Field>

      <Field name="reset-confirm-password" label="Repita a nova senha">
        <Input
          id="reset-confirm-password"
          name="confirmation"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={128}
          autoComplete="new-password"
          data-testid="reset-confirm-password"
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full" data-testid="submit-reset">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
        Definir nova senha
      </Button>

      <p className="text-xs text-muted-foreground">
        Ao definir a nova senha, as sessões abertas nesta conta são encerradas — inclusive em outros
        dispositivos.
      </p>
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Desafio do segundo fator
// ───────────────────────────────────────────────────────────────────────────────
export function TwoFactorChallengeForm({
  action,
  tenantSlug,
  redirectTo,
}: {
  action: Action;
  tenantSlug?: string;
  redirectTo?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-4" data-testid="two-factor-challenge-form" noValidate>
      {tenantSlug ? <input type="hidden" name="tenantSlug" value={tenantSlug} /> : null}
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

      {state?.message ? (
        <Alert tone="danger" data-testid="two-factor-challenge-error">
          {state.message}
        </Alert>
      ) : null}

      <Field
        name="challenge-code"
        label="Código de verificação"
        hint="O número de seis dígitos do aplicativo autenticador — ou um dos seus códigos de recuperação."
      >
        <Input
          id="challenge-code"
          name="code"
          inputMode="text"
          autoComplete="one-time-code"
          required
          maxLength={16}
          autoFocus
          className="font-mono"
          data-testid="challenge-code"
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full" data-testid="submit-challenge">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
        Confirmar e entrar
      </Button>

      <p className="text-xs text-muted-foreground">
        Perdeu o celular? Use um dos códigos de recuperação que você guardou ao ativar o segundo
        fator — cada um funciona uma vez.
      </p>
    </form>
  );
}
