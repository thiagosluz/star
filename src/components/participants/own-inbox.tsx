'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, MailOpen } from 'lucide-react';

import type { ParticipantActionState } from '@/app/actions/participant-actions';

export interface InboxEntry {
  id: string;
  subject: string;
  body: string;
  sentAtLabel: string;
  readAtLabel: string | null;
  eventTitle: string | null;
  sentByName: string | null;
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
}: {
  entries: readonly InboxEntry[];
  tenantSlug: string;
  action: (prev: ParticipantActionState | null, formData: FormData) => Promise<ParticipantActionState>;
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
