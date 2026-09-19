'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, MailPlus } from 'lucide-react';

import { Button, Field, Input, Select, Textarea, fieldAria } from '@/components/ui';
import { inviteMemberAction, type CommunicationActionState } from '@/app/actions/communication-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CONVITE DE EQUIPE (FASE 15)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CAMPOS CONTROLADOS, PORQUE A ACTION PODE RECUSAR (armadilha 5)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O React 19 reseta o formulário depois de uma Server Action — inclusive quando ela
 *  devolve ERRO. Com campos não controlados, quem digita o endereço errado, envia e
 *  vê "revise os dados" perde também o papel escolhido e o recado escrito. Aqui o
 *  estado vive no componente e o valor sobrevive à recusa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O LINK APARECE UMA ÚNICA VEZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O banco guarda o SHA-256 do código (mesma decisão do convite de palestrante,
 *  ADR-114) e o e-mail leva o endereço completo. Este painel existe para o caso em
 *  que a instituição quer entregar o link por outro canal — e avisa, em texto, que
 *  sair da tela significa perder o código: para ver de novo, é preciso gerar outro
 *  (o que invalida o anterior, pela lista de convites).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="invite-member-submit">
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <MailPlus className="size-4" aria-hidden />
      )}
      Enviar convite
    </Button>
  );
}

export function InviteMemberForm({
  tenantSlug,
  roles,
}: {
  tenantSlug: string;
  roles: readonly { value: string; label: string; consequence: string }[];
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roles[0]?.value ?? 'STAFF');
  const [message, setMessage] = useState('');

  const [state, formAction] = useActionState<CommunicationActionState, FormData>(
    /**
     * Depois de um convite registrado, os campos são limpos AQUI — e não num efeito:
     * deixar o endereço anterior preenchido convida ao segundo clique, e o segundo
     * clique revogaria o convite que acabou de sair (um convite pendente por
     * endereço). Limpar dentro do fluxo da action respeita a regra do lint de efeitos
     * (`react-hooks/set-state-in-effect`) e mantém o formulário previsível.
     */
    async (previous, formData) => {
      const result = await inviteMemberAction(previous, formData);

      if (result.ok) {
        setEmail('');
        setMessage('');
      }

      return result;
    },
    { ok: false },
  );

  const selected = roles.find((entry) => entry.value === role);
  const roleHint = selected ? `Ao aceitar, terá ${selected.consequence}.` : undefined;
  const emailHint = 'O convite vale para a conta criada com este endereço.';
  const messageHint = 'Aparece no e-mail e na página de aceite.';

  const inviteUrl = typeof state.data?.inviteUrl === 'string' ? state.data.inviteUrl : null;

  return (
    <div className="space-y-4" data-testid="invite-member-form">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="email" label="E-mail da pessoa" hint={emailHint}>
            <Input
              {...fieldAria('email', { hint: emailHint })}
              type="email"
              required
              autoComplete="email"
              placeholder="pessoa@instituicao.br"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field name="role" label="Papel na instituição" hint={roleHint}>
            <Select
              {...fieldAria('role', { hint: roleHint })}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {roles.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field name="message" label="Recado (opcional)" hint={messageHint}>
          <Textarea
            {...fieldAria('message', { hint: messageHint })}
            rows={2}
            maxLength={400}
            placeholder="Ex.: Bem-vinda à equipe do congresso! Qualquer dúvida, me chame."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton />

          {!state.ok && state.message ? (
            <span
              role="alert"
              data-testid="invite-member-error"
              className="flex items-center gap-1.5 text-xs text-destructive"
            >
              <AlertCircle className="size-3.5 shrink-0" aria-hidden />
              {state.message}
              {state.details?.length ? (
                <span className="text-muted-foreground">({state.details.join('; ')})</span>
              ) : null}
            </span>
          ) : null}
        </div>
      </form>

      {state.ok && state.message ? (
        <div
          role="status"
          data-testid="invite-member-success"
          className="space-y-3 rounded-sm border border-success/40 bg-success-soft p-4"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CheckCircle2 className="size-4 text-success-strong" aria-hidden />
            {state.message}
          </p>

          {inviteUrl ? (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Link do convite —{' '}
                <strong className="font-medium text-foreground">aparece uma única vez</strong>. Se
                perder, gere outro na lista abaixo (o anterior deixa de funcionar).
              </p>
              <Input
                readOnly
                value={inviteUrl}
                data-testid="invite-member-link"
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Link do convite"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
