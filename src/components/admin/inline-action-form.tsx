'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button, ConfirmDialog } from '@/components/ui';

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
  confirm,
  variant = 'outline',
  className,
  /** Não exibe o retorno de sucesso — para ações cujo efeito já é visível. */
  quietSuccess = false,
}: {
  action: (prev: S | null, formData: FormData) => Promise<S>;
  submitLabel: string;
  testId: string;
  children?: React.ReactNode;
  /**
   * Confirmação em DIÁLOGO DO SISTEMA (revisão de UI). Ausente = envio direto.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE ISTO DEIXOU DE SER UM TEXTO PARA O `window.confirm`
   * ─────────────────────────────────────────────────────────────────────────────
   *  O diálogo nativo aparecia com o título "localhost:3000 diz", botões "OK" e
   *  "Cancelar" sem hierarquia e desenho do navegador — a única tela do sistema que o
   *  design não desenhava. Aqui a confirmação tem título, consequência escrita, botão
   *  que NOMEIA a ação ("Remover bloco") e o padrão visual do produto.
   */
  confirm?: {
    title: string;
    description?: React.ReactNode;
    confirmLabel?: string;
    tone?: 'default' | 'danger';
  };
  variant?: 'outline' | 'destructive' | 'primary';
  className?: string;
  quietSuccess?: boolean;
}) {
  const [state, formAction] = useActionState<S | null, FormData>(action, null);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} data-testid={testId} className={className}>
      {children}

      <div className="flex flex-wrap items-center gap-2">
        {confirm ? (
          /**
           * Com confirmação, o botão do formulário NÃO envia: ele abre o diálogo. Quem
           * envia é o `requestSubmit()` chamado pelo diálogo, e é isso que mantém o
           * caminho de envio em um lugar só (o `<form>`), com `useActionState`,
           * validação nativa e estado de envio funcionando como nas demais ações.
           */
          <Button
            type="button"
            variant={variant}
            size="sm"
            onClick={() => setConfirming(true)}
            data-testid={`${testId}-open`}
          >
            {submitLabel}
          </Button>
        ) : (
          <InlineSubmit label={submitLabel} variant={variant} />
        )}

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

      {confirm ? (
        <ConfirmDialog
          open={confirming}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel ?? submitLabel}
          tone={confirm.tone ?? 'danger'}
          testId={`${testId}-confirm`}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            formRef.current?.requestSubmit();
          }}
        />
      ) : null}
    </form>
  );
}
