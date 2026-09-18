'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AÇÃO PONTUAL EM FORMULÁRIO PEQUENO (FASE 17)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO REUSAR O `AdminForm`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `AdminForm` é a moldura de um formulário de CADASTRO: rótulo grande, botão
 *  primário, área de resultado embaixo. Numa página com 12 blocos, cada um com
 *  "subir", "descer" e "remover", três `AdminForm` por bloco dariam 36 botões
 *  primários e nenhuma hierarquia visual — a ação destrutiva ficaria do mesmo
 *  tamanho da principal.
 *
 *  Este componente é a versão mínima: um botão de contorno e, quando a ação falha,
 *  o motivo ao lado. Ele EXISTE para que a tela não precise chamar a Server Action
 *  "no escuro" (o padrão `<form action={acao}>`, que descarta o retorno): uma
 *  remoção recusada precisa dizer por quê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface InlineActionState {
  ok: boolean;
  message?: string;
  details?: readonly string[];
}

function InlineSubmit({
  label,
  size = 'sm',
  variant = 'outline',
}: {
  label: string;
  size?: 'sm' | 'md';
  variant?: 'outline' | 'destructive' | 'primary';
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} size={size} variant={variant} data-testid="inline-submit">
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {label}
    </Button>
  );
}

export function InlineActionForm<S extends InlineActionState>({
  action,
  submitLabel,
  testId,
  children,
  confirmText,
  variant = 'outline',
  className,
  /** Não exibe o retorno de sucesso — para ações cujo efeito já é visível. */
  quietSuccess = false,
}: {
  action: (prev: S | null, formData: FormData) => Promise<S>;
  submitLabel: string;
  testId: string;
  children?: React.ReactNode;
  /** Texto do `confirm()` do navegador. Ausente = sem confirmação. */
  confirmText?: string;
  variant?: 'outline' | 'destructive' | 'primary';
  className?: string;
  quietSuccess?: boolean;
}) {
  const [state, formAction] = useActionState<S | null, FormData>(action, null);

  return (
    <form
      action={formAction}
      data-testid={testId}
      className={className}
      onSubmit={(event) => {
        /**
         * `confirm()` do navegador, e não um modal do sistema: a confirmação existe
         * para uma ação sem volta (remover bloco, remover patrocinador) e o diálogo
         * nativo é o único que funciona sem JavaScript adicional no bundle.
         */
        if (confirmText && !window.confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      {children}

      <div className="flex flex-wrap items-center gap-2">
        <InlineSubmit label={submitLabel} variant={variant} />

        {state && !state.ok ? (
          <span
            role="alert"
            data-testid={`${testId}-feedback`}
            className="flex items-center gap-1.5 text-xs text-destructive"
          >
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            {state.message}
            {state.details?.length ? (
              <span className="text-muted-foreground">({state.details.join('; ')})</span>
            ) : null}
          </span>
        ) : null}

        {state?.ok && !quietSuccess ? (
          <span
            role="status"
            data-testid={`${testId}-feedback`}
            className="flex items-center gap-1.5 text-xs text-success-strong"
          >
            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
