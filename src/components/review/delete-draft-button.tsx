'use client';

import { useActionState, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button, ConfirmDialog } from '@/components/ui';
import type { ActionState } from '@/app/actions/review-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EXCLUIR O RASCUNHO (revisão da FASE 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE BOTÃO SÓ EXISTE NO RASCUNHO — E POR QUE ELE PEDE CONFIRMAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O autor escreve ao longo de dias e erra: um teste, um título provisório, uma
 *  trilha trocada. Sem exclusão, esse lixo fica para sempre na lista dele. Mas o
 *  rascunho é o ÚNICO estado em que apagar não destrói registro: depois do envio
 *  existem pareceres e atribuições apontando para a submissão.
 *
 *  Quem decide isso é o DOMÍNIO (`canDeleteSubmission`) e, na dúvida, o SERVIDOR —
 *  a tela só não oferece a ação. Aqui o botão abre o diálogo do sistema, com a
 *  consequência escrita antes do clique (armadilha 33).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function DeleteDraftButton({
  tenantSlug,
  submissionId,
  title,
  action,
  testId = 'delete-draft',
  variant = 'destructive',
  label = 'Excluir rascunho',
}: {
  tenantSlug: string;
  submissionId: string;
  /** Título do rascunho — entra no diálogo para quem confirma saber O QUE apaga. */
  title: string;
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
  testId?: string;
  variant?: 'destructive' | 'ghost';
  label?: string;
}) {
  const [state, formAction] = useActionState<ActionState | null, FormData>(action, null);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="space-y-1.5">
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="submissionId" value={submissionId} />

        {/* O botão abre o diálogo; quem envia é o `requestSubmit()` (FASE 26). */}
        <Button
          type="button"
          variant={variant}
          size="sm"
          onClick={() => setConfirming(true)}
          data-testid={testId}
        >
          <Trash2 className="size-3.5" aria-hidden />
          {label}
        </Button>

        <ConfirmDialog
          open={confirming}
          title="Excluir este rascunho?"
          description={
            <>
              O rascunho “{title}” e os arquivos já anexados são apagados, e ele sai da sua lista.
              Trabalhos <strong>já enviados</strong> não podem ser excluídos: eles fazem parte do
              registro da avaliação. Se precisar desistir de um deles, fale com a comissão do evento.
            </>
          }
          confirmLabel="Excluir rascunho"
          cancelLabel="Voltar"
          testId={`${testId}-confirm`}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            formRef.current?.requestSubmit();
          }}
        />
      </form>

      {state && !state.ok && state.message ? (
        <p role="alert" className="text-xs text-destructive" data-testid={`${testId}-error`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
