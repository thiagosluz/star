'use client';

import { useRef } from 'react';

import {
  BODY_TEMPLATE_VARIABLES,
  MAX_BODY_TEMPLATE_LENGTH,
  bodyBoxHeightForLines,
  measureCertificateBody,
  resolveBodyTemplate,
  sampleVariableValues,
  validateBodyTemplate,
  type CertificatePageFormat,
} from '@/domain/certificates/certificate-layout-rules';
import { Textarea } from '@/components/ui';
import {
  COUNT_FORMAT,
  MM_FORMAT,
  type EditorElement,
} from '@/components/admin/certificate-template/types';

export interface BodyTemplateFieldProps {
  index: number;
  element: EditorElement;
  page: CertificatePageFormat;
  interactive: boolean;
  /** Há um elemento `VARIABLE` com `variable === 'corpo'` no mesmo modelo. */
  hasCorpoVariable: boolean;
  onChange: (text: string) => void;
  onHeight: (heightMm: number) => void;
}

/** Editor do gabarito `BODY` com inserção de tokens no cursor e avisos de capacidade. */
export function BodyTemplateField({
  index,
  element,
  page,
  interactive,
  hasCorpoVariable,
  onChange,
  onHeight,
}: BodyTemplateFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const validation = validateBodyTemplate(element.text);

  const fullText = resolveBodyTemplate(element.text, sampleVariableValues('FULL'));
  const worstText = resolveBodyTemplate(element.text, sampleVariableValues('WORST_CASE'));
  const fit = measureCertificateBody({ text: fullText, box: element });
  const suggestion = fit.warning
    ? bodyBoxHeightForLines({
        lineCount: fit.lineCount,
        sizePt: element.sizePt,
        lineHeight: element.lineHeight,
        page,
        topMm: element.yMm,
      })
    : null;

  const hasToken = /\{\{[^{}]*\}\}/.test(element.text);
  const emptyInWorstCase = hasToken && worstText.trim() === '';

  const counterId = `body-counter-${index}`;
  const errorsId = `body-errors-${index}`;
  const fitId = `body-fit-${index}`;
  const emptyId = `body-empty-${index}`;
  const conflictId = `body-conflict-${index}`;

  const describedBy = [
    counterId,
    validation.ok ? null : errorsId,
    fit.warning ? fitId : null,
    emptyInWorstCase ? emptyId : null,
    hasCorpoVariable ? conflictId : null,
  ]
    .filter((id): id is string => id !== null)
    .join(' ');

  const insertToken = (key: string) => {
    const textarea = textareaRef.current;
    const token = `{{${key}}}`;

    if (!textarea) {
      onChange(`${element.text}${token}`);
      return;
    }

    const start = textarea.selectionStart ?? element.text.length;
    const end = textarea.selectionEnd ?? start;
    const next = `${element.text.slice(0, start)}${token}${element.text.slice(end)}`;

    onChange(next);

    // Restaura foco e cursor após a atualização controlada para permitir inserções seguidas.
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + token.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="space-y-2" data-testid={`body-field-${index}`}>
      <label className="block space-y-1 text-xs font-medium">
        <span>Gabarito do corpo do elemento {index + 1}</span>
        <Textarea
          ref={textareaRef}
          id={`body-template-${index}`}
          name="elementText"
          value={element.text}
          rows={6}
          className="min-h-32"
          aria-label={`Gabarito do corpo do elemento ${index + 1}`}
          aria-invalid={!validation.ok}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>

      <p
        id={counterId}
        data-testid={`body-counter-${index}`}
        className={`text-xs ${element.text.length > MAX_BODY_TEMPLATE_LENGTH ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
      >
        {COUNT_FORMAT.format(element.text.length)} de {COUNT_FORMAT.format(MAX_BODY_TEMPLATE_LENGTH)} caracteres
        {element.text.length > MAX_BODY_TEMPLATE_LENGTH ? ' — passa do limite' : ''}
      </p>

      {!validation.ok ? (
        <ul id={errorsId} data-testid={`body-errors-${index}`} className="space-y-1 text-xs text-destructive">
          {validation.issues.map((issue) => (
            <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}

      {hasCorpoVariable ? (
        <p
          id={conflictId}
          data-testid={`body-corpo-conflict-${index}`}
          className="rounded-sm border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
        >
          Este modelo também tem um elemento com a variável <strong>Texto formal do certificado</strong> (
          {'{{corpo}}'}). O texto sairia <strong>duas vezes</strong> no certificado, então o servidor recusa
          salvar: troque ou remova aquele elemento.
        </p>
      ) : null}

      {fit.warning ? (
        <div
          id={fitId}
          data-testid={`body-fit-${index}`}
          className="space-y-1 rounded-sm border border-warning bg-warning-soft p-2 text-xs text-warning-strong"
        >
          <p className="font-medium">O corpo não cabe na caixa.</p>
          <p>
            O texto ocupa <strong>{fit.lineCount}</strong> linha(s); a caixa comporta{' '}
            <strong>{fit.maxLines}</strong>; sobram <strong>{fit.overflowLines}</strong>. O PDF corta o que
            não couber e marca o corte com “…” — por isso o aviso vem antes de emitir.
          </p>
          {interactive && suggestion ? (
            <button
              type="button"
              data-testid={`body-fit-grow-${index}`}
              onClick={() => onHeight(suggestion.heightMm)}
              className="rounded-md border border-border bg-card px-2 py-1 font-medium hover:bg-accent"
            >
              Aumentar a caixa para {MM_FORMAT.format(suggestion.heightMm)} mm
            </button>
          ) : (
            <p>
              Ajuste a altura na coluna Alt. da linha (o máximo desta página é{' '}
              {MM_FORMAT.format(suggestion?.maxHeightMm ?? 0)} mm).
            </p>
          )}
          {suggestion?.clamped ? (
            <p>
              A página não comporta toda a altura necessária (o máximo a partir desta posição é{' '}
              {MM_FORMAT.format(suggestion.maxHeightMm)} mm). Reduza o corpo da fonte ou encurte o texto.
            </p>
          ) : null}
        </div>
      ) : null}

      {emptyInWorstCase ? (
        <p
          id={emptyId}
          data-testid={`body-empty-worst-${index}`}
          className="rounded-sm border border-warning bg-warning-soft p-2 text-xs text-warning-strong"
        >
          Com os dados opcionais vazios, o corpo fica vazio — nenhuma caixa será impressa nesse caso. O
          modelo continua salvável: é uma escolha do organizador.
        </p>
      ) : null}

      <div data-testid={`body-legend-${index}`} className="space-y-1 rounded-sm border border-border p-2">
        <p className="text-xs font-semibold">Variáveis do corpo</p>
        <p className="text-xs text-muted-foreground">
          {interactive
            ? 'Clique em uma variável para inseri-la na posição do cursor.'
            : 'Sem JavaScript, digite o token no gabarito (ex.: {{nome}}). As quebras de linha são preservadas.'}
        </p>
        <ul data-testid={`body-variable-legend-${index}`} className="grid gap-1 sm:grid-cols-2">
          {BODY_TEMPLATE_VARIABLES.map((variable) => (
            <li key={variable.key}>
              {interactive ? (
                <button
                  type="button"
                  data-testid={`body-insert-${variable.key}`}
                  onClick={() => insertToken(variable.key)}
                  className="w-full rounded-sm px-1.5 py-1 text-left text-xs hover:bg-accent"
                >
                  <code>{`{{${variable.key}}}`}</code> · {variable.label}
                  {variable.canBeEmpty ? <span className="text-muted-foreground"> (opcional)</span> : null}
                </button>
              ) : (
                <span className="block px-1.5 py-1 text-xs">
                  <code>{`{{${variable.key}}}`}</code> · {variable.label}
                  {variable.canBeEmpty ? <span className="text-muted-foreground"> (opcional)</span> : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
