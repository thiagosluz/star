'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, MailOpen, Send } from 'lucide-react';

import type { ParticipantActionState } from '@/app/actions/participant-actions';

export interface InboxEntry {
  id: string;
  subject: string;
  body: string;
  sentAtLabel: string;
  readAtLabel: string | null;
  eventTitle: string | null;
  sentByName: string | null;
  /** As respostas da pessoa (E45) — a conversa aparece dentro do recado. */
  replies: { id: string; body: string; sentAtLabel: string; authorName: string }[];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Caixa de entrada do participante (FASE 32)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE CADA MENSAGEM TEM O PRÓPRIO FORMULÁRIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Marcar como lida é um fato por MENSAGEM, e o `messageId` viaja no formulário
 *  daquela mensagem — a action sempre recebe um id só. Um formulário único com
 *  vários botões exigiria estado no cliente para saber qual foi clicado, e o
 *  `updateMany` do serviço já resolve a posse no banco (`userId` da sessão): quem
 *  tentar marcar a mensagem de outra pessoa recebe `0` linhas, que é resposta de
 *  negócio — não erro.
 *
 *  O corpo aparece inteiro (não há "abrir": o recado é curto por construção, com
 *  teto de 2.000 caracteres no domínio).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function OwnInbox({
  entries,
  tenantSlug,
  action,
  replyAction,
}: {
  entries: readonly InboxEntry[];
  tenantSlug: string;
  action: (prev: ParticipantActionState | null, formData: FormData) => Promise<ParticipantActionState>;
  /** A ação da RESPOSTA (E45) — separada da de marcar como lida. */
  replyAction: (prev: ParticipantActionState | null, formData: FormData) => Promise<ParticipantActionState>;
}) {
  return (
    <ul className="space-y-3" data-testid="inbox-list">
      {entries.map((entry) => (
        <li
          key={entry.id}
          data-testid={`inbox-message-${entry.id}`}
          data-read={entry.readAtLabel !== null ? '1' : undefined}
          className={`space-y-2 rounded-xl border p-4 ${
            entry.readAtLabel === null ? 'border-primary/40 bg-card' : 'border-border bg-card/60'
          }`}
        >
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                {entry.readAtLabel === null ? (
                  <span className="size-2 rounded-full bg-primary" aria-label="Não lida" />
                ) : null}
                {entry.subject}
              </h2>
              <p className="text-xs text-muted-foreground">
                {entry.sentAtLabel}
                {entry.sentByName ? ` · ${entry.sentByName}` : ''}
                {entry.eventTitle ? ` · ${entry.eventTitle}` : ''}
              </p>
            </div>

            {entry.readAtLabel === null ? (
              <MarkReadForm tenantSlug={tenantSlug} messageId={entry.id} action={action} />
            ) : (
              <span className="text-xs text-muted-foreground" data-testid={`inbox-read-${entry.id}`}>
                <MailOpen className="mr-1 inline size-3.5" aria-hidden />
                lida em {entry.readAtLabel}
              </span>
            )}
          </header>

          <p className="whitespace-pre-line text-sm" data-testid={`inbox-body-${entry.id}`}>
            {entry.body}
          </p>

          {/**
            * ─────────────────────────────────────────────────────────────────────
            *  A CONVERSA, E NÃO SÓ O RECADO (FASE 56 · dívida E45)
            * ─────────────────────────────────────────────────────────────────────
            *  As respostas ficam DENTRO do recado, em ordem: é a mesma conversa, e a
            *  pessoa precisa reler o que escreveu para não repetir a pergunta.
            */}
          {entry.replies.length > 0 ? (
            <ul className="space-y-2 border-l-2 border-primary/30 pl-3" data-testid={`inbox-thread-${entry.id}`}>
              {entry.replies.map((reply) => (
                <li key={reply.id} className="text-sm" data-testid={`inbox-reply-${reply.id}`}>
                  <p className="text-xs text-muted-foreground">
                    {reply.authorName} · {reply.sentAtLabel}
                  </p>
                  <p className="whitespace-pre-line">{reply.body}</p>
                </li>
              ))}
            </ul>
          ) : null}

          <ReplyForm tenantSlug={tenantSlug} messageId={entry.id} replyAction={replyAction} />
        </li>
      ))}
    </ul>
  );
}

function MarkReadForm({
  tenantSlug,
  messageId,
  action,
}: {
  tenantSlug: string;
  messageId: string;
  action: (prev: ParticipantActionState | null, formData: FormData) => Promise<ParticipantActionState>;
}) {
  const [, formAction] = useActionState<ParticipantActionState | null, FormData>(action, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="messageId" value={messageId} />
      <MarkReadButton messageId={messageId} />
    </form>
  );
}

function MarkReadButton({ messageId }: { messageId: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={`inbox-mark-${messageId}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-60"
    >
      <Check className="size-3.5" aria-hidden />
      {pending ? 'Marcando…' : 'Marcar como lida'}
    </button>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RESPONDER O RECADO (FASE 56 · dívida E45)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  O campo aparece DENTRO de cada recado, e não numa tela de "nova mensagem": a pessoa
 *  responde o que leu, e o `messageId` viaja escondido no formulário — o serviço confere
 *  a posse no banco, então um id de outra pessoa devolve `NOT_FOUND` em vez de gravar.
 *
 *  A caixa é de TEXTO LIVRE e o limite é do domínio (2.000 caracteres, o mesmo do
 *  recado). O `maxLength` aqui é conveniência; quem decide é o servidor.
 */
function ReplyForm({
  tenantSlug,
  messageId,
  replyAction,
}: {
  tenantSlug: string;
  messageId: string;
  replyAction: (prev: ParticipantActionState | null, formData: FormData) => Promise<ParticipantActionState>;
}) {
  const [state, formAction] = useActionState<ParticipantActionState | null, FormData>(
    replyAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-1.5 pt-1">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="messageId" value={messageId} />

      <label htmlFor={`reply-${messageId}`} className="text-xs font-medium">
        Responder
      </label>
      <textarea
        id={`reply-${messageId}`}
        name="body"
        rows={2}
        maxLength={2000}
        required
        placeholder="Escreva a sua resposta para a organização"
        data-testid={`inbox-reply-body-${messageId}`}
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
      />

      <div className="flex flex-wrap items-center gap-2">
        <ReplyButton messageId={messageId} />

        {state?.message ? (
          <p
            role={state.ok ? undefined : 'alert'}
            data-testid={`inbox-reply-result-${messageId}`}
            className={`text-xs ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function ReplyButton({ messageId }: { messageId: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={`inbox-reply-submit-${messageId}`}
      className="ef-button inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
    >
      <Send className="size-3.5" aria-hidden />
      {pending ? 'Enviando…' : 'Enviar resposta'}
    </button>
  );
}
