'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Send } from 'lucide-react';

import type { ActionState } from '@/app/actions/review-actions';

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring/40';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      <Send className="size-4" aria-hidden />
      {pending ? 'Criando…' : 'Criar rascunho'}
    </button>
  );
}

export interface EventOption {
  id: string;
  title: string;
  tracks: { id: string; name: string; requiresBlindReview: boolean }[];
}

/**
 * Formulário de criação da submissão.
 *
 * Cria um RASCUNHO, não uma submissão enviada. O autor precisa poder salvar e
 * voltar: submissões são escritas ao longo de dias, e exigir o envio completo em
 * uma única sessão seria irreal. A validação completa acontece no envio.
 */
export function CreateSubmissionForm({
  tenantSlug,
  events,
  action,
}: {
  tenantSlug: string;
  events: readonly EventOption[];
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState<ActionState | null, FormData>(action, null);

  // Sucesso: a página recarrega e o rascunho aparece na lista.
  if (state?.ok) {
    return (
      <div
        className="space-y-2 rounded-lg border border-border bg-card p-5"
        data-testid="submission-created"
      >
        <p className="font-medium">Rascunho criado</p>
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <p className="text-xs text-muted-foreground">
          Anexe o arquivo e envie para avaliação na página da submissão.
        </p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        Não há chamada de trabalhos aberta no momento.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state && !state.ok ? (
        <div
          role="alert"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="submission-error"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden />
            {state.message}
          </p>
          {state.details?.length ? (
            <ul className="ml-6 list-disc text-xs">
              {state.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="eventId" className="text-sm font-medium">
          Evento
        </label>
        <select id="eventId" name="eventId" required className={inputClass}>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="title" className="text-sm font-medium">
          Título
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          minLength={8}
          maxLength={300}
          className={inputClass}
          placeholder="Título do trabalho"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="abstract" className="text-sm font-medium">
          Resumo
        </label>
        <textarea
          id="abstract"
          name="abstract"
          required
          minLength={150}
          maxLength={5000}
          rows={8}
          className={inputClass}
          placeholder="Resumo do trabalho (mínimo de 150 caracteres). Descreva objetivo, método e contribuição."
        />
        <p className="text-xs text-muted-foreground">
          Mínimo de 150 caracteres. Um resumo curto impossibilita a avaliação de mérito.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="keywords" className="text-sm font-medium">
          Palavras-chave
        </label>
        <input
          id="keywords"
          name="keywords"
          type="text"
          required
          className={inputClass}
          placeholder="aprendizado de máquina, saúde pública, epidemiologia"
        />
        <p className="text-xs text-muted-foreground">
          De 3 a 8 palavras-chave, separadas por vírgula. Elas alimentam a sugestão de
          revisores por afinidade.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="language" className="text-sm font-medium">
          Idioma
        </label>
        <select id="language" name="language" className={inputClass} defaultValue="pt-BR">
          <option value="pt-BR">Português</option>
          <option value="en">Inglês</option>
          <option value="es">Espanhol</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="trackId" className="text-sm font-medium">
          Trilha temática
        </label>
        <select id="trackId" name="trackId" required className={inputClass}>
          {events.flatMap((event) =>
            event.tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {event.title} · {track.name}
                {track.requiresBlindReview ? ' (revisão cega)' : ''}
              </option>
            )),
          )}
        </select>
      </div>

      <SubmitButton />
    </form>
  );
}
