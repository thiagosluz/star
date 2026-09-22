'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Send } from 'lucide-react';

import type { ParticipantActionState } from '@/app/actions/participant-actions';
import {
  MESSAGE_BODY_MAX,
  MESSAGE_SUBJECT_MAX,
} from '@/domain/participants/participant-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Compositor do recado (FASE 32)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE OS DESTINATÁRIOS SÃO CAMPOS OCULTOS (E NÃO ARGUMENTO DO BOTÃO)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O recado sai pela MESMA action em três lugares: a ficha de uma pessoa, a seleção
 *  do diretório e (no futuro) um filtro salvo. Em todos, o que muda é a LISTA de
 *  `userId`; o formulário, a validação, a autorização e o resultado são um só. Um
 *  segundo caminho de envio seria uma segunda regra (armadilha 55) — e envio de
 *  e-mail é o pior lugar para duas versões da mesma regra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CAMPO É CONTROLADO, E ISSO É DELIBERADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O React 19 reseta o formulário depois da action — inclusive quando ela devolve
 *  ERRO (armadilha 5). Num recado de 2.000 caracteres, perder o texto digitado por
 *  causa de um assunto curto é inaceitável: os campos são controlados e o texto
 *  sobrevive à recusa.
 */
export function MessageComposer({
  tenantSlug,
  userIds,
  eventId,
  action,
  label,
  compact = false,
}: {
  tenantSlug: string;
  userIds: readonly string[];
  eventId?: string | null;
  action: (prev: ParticipantActionState | null, formData: FormData) => Promise<ParticipantActionState>;
  label: string;
  compact?: boolean;
}) {
  const [state, formAction] = useActionState<ParticipantActionState | null, FormData>(action, null);

  const failures = Array.isArray(state?.data?.failures) ? (state.data.failures as string[]) : [];

  return (
    <form action={formAction} className="space-y-3" data-testid="message-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}
      {userIds.map((id) => (
        <input key={id} type="hidden" name="userIds" value={id} />
      ))}

      <div className={compact ? 'space-y-2' : 'grid gap-3 sm:grid-cols-2'}>
        <label className="space-y-1 text-xs font-medium">
          Assunto
          <input
            name="subject"
            required
            maxLength={MESSAGE_SUBJECT_MAX}
            placeholder="Ex.: Credenciamento abre às 8h"
            aria-label="Assunto do recado"
            data-testid="message-subject"
            className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
        </label>

        <label className="space-y-1 text-xs font-medium sm:col-span-2">
          Mensagem
          <textarea
            name="body"
            required
            rows={compact ? 3 : 5}
            maxLength={MESSAGE_BODY_MAX}
            placeholder="Escreva o recado. Ele vai por e-mail e fica na área do participante."
            aria-label="Mensagem"
            data-testid="message-body"
            className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label={label} />

        <span className="text-xs text-muted-foreground">
          {userIds.length} destinatário(s) · o recado fica na plataforma mesmo se o e-mail falhar
        </span>
      </div>

      {state ? (
        <div
          role={state.ok ? 'status' : 'alert'}
          data-testid="message-feedback"
          className={`space-y-1 rounded-lg border p-3 text-sm ${
            state.ok ? 'border-success/40 bg-success-soft' : 'border-destructive/40 bg-destructive-soft'
          }`}
        >
          <p className="font-medium">{state.message ?? (state.ok ? 'Recado enviado.' : 'Não foi possível enviar.')}</p>

          {failures.length > 0 ? (
            <ul className="space-y-0.5 text-xs" data-testid="message-failures">
              {failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

/**
 * O botão conhece o estado do envio por `useFormStatus` (e não por prop): com fila,
 * um segundo clique enquanto a action roda mandaria o recado duas vezes — a chave de
 * deduplicação protege o e-mail, mas o registro ficaria duplicado.
 */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="message-send"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      <Send className="size-3.5" aria-hidden />
      {pending ? 'Enviando…' : label}
    </button>
  );
}
