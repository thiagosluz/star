'use client';

import { useActionState } from 'react';
import { CheckCircle2, FileCheck2 } from 'lucide-react';

import { Alert, Checkbox, FormStatusButton, Label } from '@/components/ui';
import type { ActionState } from '@/app/actions/review-actions';

export function ProceedingsPermissionForm(props: {
  tenantSlug: string;
  submissionId: string;
  termText: string;
  acceptedAtIso: string | null;
  acceptedVersion: string | null;
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(props.action, null);
  const alreadyAccepted = Boolean(props.acceptedAtIso || (state?.ok && state.data?.acceptedAt));

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-card p-5" data-testid="proceedings-permission-form">
      <input type="hidden" name="tenantSlug" value={props.tenantSlug} />
      <input type="hidden" name="submissionId" value={props.submissionId} />

      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FileCheck2 className="size-4 text-primary" aria-hidden />
          Autorização de publicação nos anais
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{props.termText}</p>
      </div>

      {alreadyAccepted ? (
        <p
          className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs font-medium text-success-strong"
          data-testid="proceedings-permission-accepted"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Autorização registrada
          {props.acceptedVersion ? ` (versão ${props.acceptedVersion})` : ''}.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox id="proceedings-term-accepted" name="accepted" required />
            <Label htmlFor="proceedings-term-accepted" className="text-xs leading-snug">
              Li e autorizo a publicação deste trabalho nos anais digitais e repositórios acadêmicos do evento.
            </Label>
          </div>

          <FormStatusButton
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            pendingContent="Registrando autorização..."
            showSpinner
          >
            Registrar autorização nos anais
          </FormStatusButton>
        </div>
      )}

      {state && !state.ok ? (
        <Alert tone="danger" title="Não foi possível registrar">
          {state.message}
        </Alert>
      ) : null}
    </form>
  );
}
