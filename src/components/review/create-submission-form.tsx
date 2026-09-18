'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Send } from 'lucide-react';

import type { ActionState } from '@/app/actions/review-actions';
import { KeywordsInput } from '@/components/review/keywords-input';

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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  NÃO HÁ TELA DE SUCESSO AQUI (revisão da FASE 4)
 * ─────────────────────────────────────────────────────────────────────────────
 *  No sucesso a action REDIRECIONA para a página da submissão criada — então o
 *  único retorno que este formulário chega a tratar é a FALHA (validação, limite
 *  da trilha, chamada de trabalhos fechada). Antes existia aqui um cartão
 *  "Rascunho criado", de onde o autor tinha de voltar à lista e clicar em "Abrir"
 *  para, só então, anexar o arquivo: uma página intermediária que não fazia nada
 *  além de anunciar o que a tela seguinte já mostra.
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

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  OS CAMPOS SÃO CONTROLADOS, E ISSO NÃO É ESTILO (revisão da FASE 4)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O React 19 **reseta o formulário** depois de uma action — inclusive quando ela
   *  devolve ERRO. Com campos não controlados, o autor que digitava um resumo,
   *  esquecia a terceira palavra-chave e via "revise os dados" perdia título e
   *  resumo de uma vez: a correção custava reescrever tudo (armadilha 5, que até
   *  aqui só tinha aparecido em formulário de dois passos).
   *
   *  O estado vive aqui; o servidor continua sendo a autoridade sobre as regras.
   */
  const [fields, setFields] = useState({
    eventId: events[0]?.id ?? '',
    title: '',
    abstract: '',
    language: 'pt-BR',
    trackId: events[0]?.tracks[0]?.id ?? '',
  });

  const update = (patch: Partial<typeof fields>) =>
    setFields((previous) => ({ ...previous, ...patch }));

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
        <select
          id="eventId"
          name="eventId"
          required
          className={inputClass}
          value={fields.eventId}
          onChange={(event) => update({ eventId: event.target.value })}
        >
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
          value={fields.title}
          onChange={(event) => update({ title: event.target.value })}
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
          value={fields.abstract}
          onChange={(event) => update({ abstract: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Mínimo de 150 caracteres. Um resumo curto impossibilita a avaliação de mérito.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="keywords" className="text-sm font-medium">
          Palavras-chave
        </label>
        {/*
          O campo CONTA o que foi digitado (revisão da FASE 4): a regra era só uma
          dica, e o rascunho nascia com uma palavra-chave para ser recusado no envio.
          Quem valida continua sendo o servidor — aqui a mesma regra aparece cedo.
        */}
        <KeywordsInput />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="language" className="text-sm font-medium">
          Idioma
        </label>
        <select
          id="language"
          name="language"
          className={inputClass}
          value={fields.language}
          onChange={(event) => update({ language: event.target.value })}
        >
          <option value="pt-BR">Português</option>
          <option value="en">Inglês</option>
          <option value="es">Espanhol</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="trackId" className="text-sm font-medium">
          Trilha temática
        </label>
        <select
          id="trackId"
          name="trackId"
          required
          className={inputClass}
          value={fields.trackId}
          onChange={(event) => update({ trackId: event.target.value })}
        >
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
