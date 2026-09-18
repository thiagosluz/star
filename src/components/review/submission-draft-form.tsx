'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button, Field, Input, Select, Textarea, fieldAria } from '@/components/ui';
import { KeywordsInput } from '@/components/review/keywords-input';
import {
  MAX_ABSTRACT_LENGTH,
  MIN_ABSTRACT_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_TITLE_LENGTH,
} from '@/domain/review/submission-rules';
import type { ActionState } from '@/app/actions/review-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EDIÇÃO DO RASCUNHO (revisão da FASE 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE FORMULÁRIO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O conteúdo era escrito UMA vez, na criação. Um resumo com erro de digitação,
 *  uma palavra-chave faltando ou um título provisório ficavam assim para sempre —
 *  e, como a validação só rodava no envio, o autor descobria o problema no fim,
 *  com um "a submissão está incompleta" e sem onde corrigir.
 *
 *  As regras mostradas aqui (tamanho do título e do resumo, 3 a 8 palavras-chave)
 *  são as MESMAS que o envio aplica — o autor não é convidado a salvar algo que
 *  será recusado depois. Quem decide, no entanto, é o servidor: a tela repete a
 *  regra para ajudar, não para autorizar.
 *
 *  A TRILHA não está aqui de propósito: trocá-la mudaria a rubrica, o requisito de
 *  versão cega e a fila de revisores — decisão do comitê, não ajuste de texto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="outline" disabled={pending} data-testid="save-draft">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      Salvar dados
    </Button>
  );
}

export function SubmissionDraftForm({
  tenantSlug,
  submissionId,
  initial,
  action,
}: {
  tenantSlug: string;
  submissionId: string;
  initial: {
    title: string;
    abstract: string;
    keywords: readonly string[];
    language: string;
  };
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState<ActionState | null, FormData>(action, null);

  /**
   * Campos CONTROLADOS: o React 19 reseta o formulário depois de uma action — mesmo
   * quando ela devolve erro. Sem isto, o autor que ajustasse o resumo e mantivesse
   * duas palavras-chave veria "revise os dados" e o formulário em branco, perdendo
   * exatamente o texto que estava corrigindo (armadilha 5).
   */
  const [fields, setFields] = useState({
    title: initial.title,
    abstract: initial.abstract,
    language: initial.language,
  });

  const update = (patch: Partial<typeof fields>) =>
    setFields((previous) => ({ ...previous, ...patch }));

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="space-y-1">
        <h2 className="font-medium">Dados da submissão</h2>
        <p className="text-xs text-muted-foreground">
          Título, resumo e palavras-chave podem ser ajustados enquanto a submissão não for enviada.
        </p>
      </div>

      <form action={formAction} className="space-y-4" data-testid="draft-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="submissionId" value={submissionId} />

        <Field name="title" label="Título" required>
          <Input
            {...fieldAria('title')}
            value={fields.title}
            onChange={(event) => update({ title: event.target.value })}
            required
            minLength={MIN_TITLE_LENGTH}
            maxLength={MAX_TITLE_LENGTH}
          />
        </Field>

        <Field
          name="abstract"
          label="Resumo"
          hint={`Mínimo de ${MIN_ABSTRACT_LENGTH} caracteres. Um resumo curto impossibilita a avaliação de mérito.`}
          required
        >
          <Textarea
            {...fieldAria('abstract', { hint: true })}
            value={fields.abstract}
            onChange={(event) => update({ abstract: event.target.value })}
            rows={8}
            required
            minLength={MIN_ABSTRACT_LENGTH}
            maxLength={MAX_ABSTRACT_LENGTH}
          />
        </Field>

        <Field name="keywords" label="Palavras-chave" required>
          <KeywordsInput defaultValue={initial.keywords.join(', ')} />
        </Field>

        <Field name="language" label="Idioma">
          <Select
            {...fieldAria('language')}
            value={fields.language}
            onChange={(event) => update({ language: event.target.value })}
          >
            <option value="pt-BR">Português</option>
            <option value="en">Inglês</option>
            <option value="es">Espanhol</option>
          </Select>
        </Field>

        {state && !state.ok ? (
          <div
            role="alert"
            className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="draft-form-error"
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

        {state?.ok ? (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-success-strong"
            data-testid="draft-form-ok"
          >
            <CheckCircle2 className="size-4" aria-hidden />
            {state.message}
          </p>
        ) : null}

        <SaveButton />
      </form>
    </section>
  );
}
