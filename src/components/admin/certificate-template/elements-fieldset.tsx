'use client';

import { Plus, Trash2 } from 'lucide-react';

import {
  MAX_LAYOUT_ELEMENTS,
  type CertificatePageFormat,
} from '@/domain/certificates/certificate-layout-rules';
import { TemplateElementRow } from '@/components/admin/certificate-template/element-row';
import type { EditorElement } from '@/components/admin/certificate-template/types';

/** Tabela e controles da grade de elementos do certificado (inclui fallback completo sem JS). */
export function TemplateElementsFieldset({
  rows,
  elementsCount,
  selected,
  page,
  interactive,
  hasCorpoVariable,
  onSelect,
  onUpdate,
  onAddElement,
  onRemoveSelected,
}: {
  rows: EditorElement[];
  elementsCount: number;
  selected: number | null;
  page: CertificatePageFormat;
  interactive: boolean;
  hasCorpoVariable: boolean;
  onSelect: (index: number) => void;
  onUpdate: (index: number, patch: Partial<EditorElement>) => void;
  onAddElement: () => void;
  onRemoveSelected: () => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Elementos da página</legend>

      <p className="text-xs text-muted-foreground">
        Arraste no palco para posicionar, ou digite as medidas em milímetros. As posições são absolutas: um
        elemento vazio simplesmente não aparece no documento, e nada se move por causa disso.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="p-1">#</th>
              <th className="p-1">Tipo</th>
              <th className="p-1">Conteúdo</th>
              <th className="p-1">X</th>
              <th className="p-1">Y</th>
              <th className="p-1">Larg.</th>
              <th className="p-1">Alt.</th>
              <th className="p-1">Alinh.</th>
              <th className="p-1">Fonte</th>
              <th className="p-1">Corpo</th>
              <th className="p-1">Cor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((element, index) => (
              <TemplateElementRow
                key={index}
                index={index}
                element={element}
                filled={index < elementsCount}
                isSelected={selected === index}
                page={page}
                interactive={interactive}
                hasCorpoVariable={hasCorpoVariable}
                onSelect={() => onSelect(index)}
                onUpdate={(patch) => onUpdate(index, patch)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="body-hint">
        O <strong>corpo do certificado</strong> é o elemento do tipo “Corpo do certificado (gabarito)”. O gabarito
        aceita quebras de linha e variáveis como <code>{'{{nome}}'}</code>; o texto é impresso no lugar da caixa
        do elemento.
      </p>

      {rows.map((element, index) => (
        <input key={`id-${index}`} type="hidden" name="elementId" value={element.id} />
      ))}

      {interactive ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAddElement}
            data-testid="element-add"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <Plus className="size-3.5" aria-hidden /> Acrescentar elemento
          </button>
          <button
            type="button"
            onClick={onRemoveSelected}
            disabled={selected === null}
            data-testid="element-remove"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Trash2 className="size-3.5" aria-hidden /> Remover selecionado
          </button>
          <span className="text-xs text-muted-foreground">
            {elementsCount} de {MAX_LAYOUT_ELEMENTS} elementos
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="no-js-hint">
          Sem JavaScript, o formulário mostra as {MAX_LAYOUT_ELEMENTS} linhas do teto: preencha as que quiser usar
          (linha sem conteúdo é descartada) e salve. Para o corpo, escolha “Corpo do certificado (gabarito)” na
          coluna Tipo de uma linha livre e escreva o gabarito na coluna Conteúdo — as quebras de linha são
          preservadas. As variáveis podem ser digitadas à mão (ex.: <code>{'{{nome}}'}</code>).
        </p>
      )}
    </fieldset>
  );
}
