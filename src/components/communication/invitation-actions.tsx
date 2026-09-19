'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';

import { Button, Input } from '@/components/ui';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import {
  reissueInvitationAction,
  revokeInvitationAction,
  type CommunicationActionState,
} from '@/app/actions/communication-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AÇÕES DE UM CONVITE PENDENTE (FASE 15)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O REENVIO NÃO É UM `InlineActionForm`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cancelar é uma ação de um clique com confirmação — o `InlineActionForm` (FASE 17)
 *  cobre isso: botão de contorno, diálogo do sistema, mensagem ao lado.
 *
 *  Gerar um link novo é diferente: o RETORNO é o dado importante. O código antigo
 *  deixa de valer no instante em que o novo é criado, e o banco guarda apenas o
 *  hash — então o link precisa aparecer na tela, uma vez, ou a instituição fica sem
 *  como entregá-lo. Por isso este formulário lê o estado da ação, em vez de só
 *  mostrar "pronto".
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function ReissueSubmit() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending} data-testid="reissue-invitation-submit">
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <RotateCcw className="size-3.5" aria-hidden />
      )}
      Gerar novo link
    </Button>
  );
}

function ReissueInvitationForm({
  tenantSlug,
  invitationId,
}: {
  tenantSlug: string;
  invitationId: string;
}) {
  const [state, formAction] = useActionState<CommunicationActionState, FormData>(
    reissueInvitationAction,
    { ok: false },
  );

  const inviteUrl = typeof state.data?.inviteUrl === 'string' ? state.data.inviteUrl : null;

  return (
    <form action={formAction} className="space-y-2" data-testid={`reissue-invitation-${invitationId}`}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <ReissueSubmit />

      {!state.ok && state.message ? (
        <span
          role="alert"
          data-testid={`reissue-feedback-${invitationId}`}
          className="flex items-center gap-1.5 text-xs text-destructive"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {state.message}
        </span>
      ) : null}

      {state.ok && inviteUrl ? (
        <div className="space-y-1.5" data-testid={`reissue-success-${invitationId}`}>
          <span className="flex items-center gap-1.5 text-xs text-success-strong">
            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
            {state.message}
          </span>
          <Input
            readOnly
            value={inviteUrl}
            data-testid={`reissue-link-${invitationId}`}
            onFocus={(event) => event.currentTarget.select()}
            aria-label="Novo link do convite"
          />
        </div>
      ) : null}
    </form>
  );
}

/** Ações da linha: gerar link novo e cancelar (com confirmação do sistema). */
export function InvitationActions({
  tenantSlug,
  invitationId,
  email,
  canRevoke,
}: {
  tenantSlug: string;
  invitationId: string;
  email: string;
  canRevoke: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {canRevoke ? (
        <InlineActionForm
          action={revokeInvitationAction}
          submitLabel="Cancelar convite"
          variant="destructive"
          testId={`revoke-invitation-${invitationId}`}
          confirm={{
            title: `Cancelar o convite de ${email}?`,
            description:
              'O link enviado deixa de funcionar imediatamente. A pessoa pode ser convidada de novo depois — um convite novo é gerado do zero.',
            confirmLabel: 'Cancelar convite',
          }}
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="invitationId" value={invitationId} />
        </InlineActionForm>
      ) : null}

      <ReissueInvitationForm tenantSlug={tenantSlug} invitationId={invitationId} />
    </div>
  );
}
