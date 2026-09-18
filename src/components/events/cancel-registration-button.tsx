'use client';

import { useActionState, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { Button, ConfirmDialog } from '@/components/ui';
import {
  cancelRegistrationAction,
  type RegistrationActionState,
} from '@/app/actions/registration-actions';

/**
 * Botão de cancelamento da própria inscrição.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A CONFIRMAÇÃO PASSOU A SER DO SISTEMA (revisão de UI)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Cancelar é ação sem volta — o estado `CANCELED` é terminal e a vaga vai para a
 *  lista de espera —, então a confirmação continua existindo. O que mudou foi o
 *  diálogo: o `window.confirm` aparecia com o desenho do navegador e um "OK" que não
 *  dizia o que ia acontecer; agora há título, consequência escrita e um botão que
 *  nomeia a ação ("Cancelar inscrição"), com o foco inicial no "Voltar" (armadilha 33).
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
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (state?.ok) {
    return (
      <span className="text-xs text-muted-foreground" data-testid="cancel-result">
        {state.message}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventSlug" value={eventSlug} />
        <input type="hidden" name="registrationId" value={registrationId} />

        {/* O botão do formulário apenas ABRE o diálogo; quem envia é o
            `requestSubmit()` do próprio diálogo, mantendo o envio num caminho só. */}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setConfirming(true)}
          data-testid="cancel-registration-open"
        >
          <X className="size-3" aria-hidden />
          Cancelar
        </Button>

        <ConfirmDialog
          open={confirming}
          title="Cancelar sua inscrição?"
          description="Sua vaga é liberada na hora e vai para quem está na lista de espera. Não é possível desfazer — para voltar, será preciso se inscrever de novo."
          confirmLabel="Cancelar inscrição"
          cancelLabel="Voltar"
          testId="cancel-registration-confirm"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            formRef.current?.requestSubmit();
          }}
        />
      </form>

      {state && !state.ok && state.message ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
