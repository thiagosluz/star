'use client';

import { useActionState, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';

import { Button, ConfirmDialog } from '@/components/ui';
import type { ActionState } from '@/app/actions/review-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RETIRAR A PRÓPRIA SUBMISSÃO (FASE 56 · dívida E31)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO É "EXCLUIR"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Excluir só existe no rascunho, porque depois do envio há pareceres e atribuições
 *  apontando para a submissão. Retirar é outra coisa: o trabalho sai do PÁREO e o
 *  registro fica, com o protocolo e o estado `WITHDRAWN` na trilha. Antes desta fase,
 *  quem enviava por engano só saía dali por pedido manual à comissão — e o trabalho
 *  seguia na fila dos revisores enquanto isso.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O DIÁLOGO DIZ O QUE NÃO VOLTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem clica está desistindo de algo que levou dias para escrever. O diálogo escreve a
 *  consequência ANTES do clique (armadilha 33): sai do páreo, o protocolo continua, e
 *  voltar atrás depende da comissão. Depois de decidido o resultado, o botão nem
 *  aparece — quem decide isso é o DOMÍNIO (`canWithdrawSubmission`), e o servidor
 *  recusa de novo, porque a tela só deixa de oferecer.
 */
export function WithdrawSubmissionButton({
  tenantSlug,
  submissionId,
  title,
  action,
}: {
  tenantSlug: string;
  submissionId: string;
  /** Título do trabalho — entra no diálogo para quem confirma saber O QUE retira. */
  title: string;
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState<ActionState | null, FormData>(action, null);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (state?.ok) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="withdraw-submission-result">
        {state.message}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="submissionId" value={submissionId} />

        {/* O botão abre o diálogo; quem envia é o `requestSubmit()` do próprio diálogo. */}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setConfirming(true)}
          data-testid="withdraw-submission"
        >
          <Undo2 className="size-3.5" aria-hidden />
          Retirar submissão
        </Button>

        <ConfirmDialog
          open={confirming}
          title="Retirar esta submissão?"
          description={
            <>
              O trabalho “{title}” sai do páreo: ele deixa de ser avaliado, e os revisores
              não o verão mais. <strong>O protocolo continua registrado</strong> e o motivo
              fica na trilha da comissão. Para voltar atrás depois disso, será preciso
              falar com a comissão do evento.
            </>
          }
          confirmLabel="Retirar submissão"
          cancelLabel="Voltar"
          testId="withdraw-submission-confirm"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            formRef.current?.requestSubmit();
          }}
        />
      </form>

      {state && !state.ok && state.message ? (
        <p role="alert" className="text-xs text-destructive" data-testid="withdraw-submission-error">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
