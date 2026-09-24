'use client';

import { useActionState, useRef, useState, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, Move, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';

import type { CertificateTemplateActionState } from '@/app/actions/certificate-actions';
import {
  CERTIFICATE_ALIGNMENTS,
  CERTIFICATE_ALIGNMENT_LABELS,
  CERTIFICATE_FONTS,
  CERTIFICATE_FONT_LABELS,
  CERTIFICATE_VARIABLES,
  DEFAULT_ELEMENT_COLOR,
  MAX_LAYOUT_ELEMENTS,
  type CertificatePageFormat,
} from '@/domain/certificates/certificate-layout-rules';
import { Input, Select } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EDITOR DO MODELO VISUAL DO CERTIFICADO (FASE 40)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ARRASTAR É O CAMINHO RÁPIDO; O NÚMERO É O CAMINHO QUE SEMPRE FUNCIONA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela tem DUAS camadas, e elas não competem:
 *
 *    • o PALCO, em que o organizador arrasta as caixas e vê onde cada coisa cai;
 *    • as LINHAS do formulário, com X, Y, largura, altura, corpo e cor — que são a
 *      fonte dos valores enviados.
 *
 *  Arrastar escreve nos campos numéricos (nunca em estado paralelo), então o mesmo
 *  formulário funciona sem JavaScript: sem os botões de arrastar, o organizador
 *  digita as coordenadas e envia. A caixa é a MESMA — não há dois desenhos.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PALCO NÃO É A PRÉVIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O palco é ESQUEMÁTICO: ele mostra posição e ordem para posicionar. Quem mostra o
 *  documento é a prévia, gerada no servidor pelo mesmo renderizador que produz o PDF
 *  emitido. Reimplementar o desenho aqui faria o organizador aprovar na tela um
 *  certificado que não é o que sai — e a marca da instituição impressa errada é o
 *  tipo de defeito que só aparece no papel.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface EditorElement {
  id: string;
  kind: 'TEXT' | 'VARIABLE' | 'QR';
  text: string;
  variable: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  align: string;
  font: string;
  sizePt: number;
  color: string;
  lineHeight: number;
}

export interface EditorModel {
  templateId: string | null;
  name: string;
  eventId: string;
  kind: string;
  page: CertificatePageFormat;
  backgroundHref: string | null;
  backgroundNotice: string | null;
  /** Tamanho da arte gravada, em bytes (0 quando não há). */
  backgroundBytes: number;
  /** Prévia renderizada no servidor ao abrir a página. */
  previewSvg: string | null;
  elements: EditorElement[];
}

/**
 * Interatividade só depois da hidratação.
 *
 * `useSyncExternalStore` é o jeito de perguntar "o JavaScript já carregou?" sem
 * `setState` dentro de efeito — que o React Compiler reprova (e com razão: render em
 * cascata). Antes disso a tela mostra o formulário completo e nenhum botão morto.
 */
function useIsInteractive(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Uma caixa vazia para o organizador começar. */
function emptyElement(index: number): EditorElement {
  return {
    id: `elemento-${index + 1}`,
    kind: 'TEXT',
    text: '',
    variable: '',
    xMm: 30,
    yMm: 30 + index * 8,
    widthMm: 200,
    heightMm: 10,
    align: 'CENTER',
    font: 'HELVETICA',
    sizePt: 12,
    color: DEFAULT_ELEMENT_COLOR,
    lineHeight: 1.4,
  };
}

function SubmitButton({ label, testId }: { label: string; testId: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={testId}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
      {pending ? 'Salvando…' : label}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Palco: as caixas arrastáveis
// ───────────────────────────────────────────────────────────────────────────────
interface StageProps {
  page: CertificatePageFormat;
  elements: EditorElement[];
  selected: number | null;
  backgroundHref: string | null;
  onSelect: (index: number) => void;
  onMove: (index: number, xMm: number, yMm: number) => void;
  onResize: (index: number, widthMm: number, heightMm: number) => void;
}

function Stage({ page, elements, selected, backgroundHref, onSelect, onMove, onResize }: StageProps) {
  const [widthMm, heightMm] = page === 'A4_PORTRAIT' ? [210, 297] : [297, 210];
  const stageRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    index: number;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origin: EditorElement;
    mmPerPxX: number;
    mmPerPxY: number;
  } | null>(null);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O PALCO É PROPORCIONAL, E O ARRASTAR CONVERTE PIXEL EM MILÍMETRO
   * ─────────────────────────────────────────────────────────────────────────────
   *  A primeira versão posicionava as caixas em pixels (3,2 px por mm) e prendia o
   *  palco à largura da coluna: as caixas passavam da borda, ficavam RECORTADAS e o
   *  ponteiro caía fora delas — arrastar não fazia nada. Foi o E2E que pegou, e o que
   *  mostrou a causa foi MEDIR o alvo do `pointerdown` (era o `html`, não a caixa).
   *
   *  Agora a posição é PERCENTUAL e o palco mantém a proporção da página: o desenho
   *  cabe em qualquer coluna, e a conversão do gesto usa a medida REAL do palco.
   */
  const beginDrag = (event: React.PointerEvent, index: number, mode: 'move' | 'resize') => {
    const element = elements[index];
    const stage = stageRef.current;
    if (!element || !stage) return;

    const rect = stage.getBoundingClientRect();

    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    drag.current = {
      index,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: element,
      mmPerPxX: widthMm / rect.width,
      mmPerPxY: heightMm / rect.height,
    };
  };

  const handleMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;

    const deltaXMm = (event.clientX - state.startX) * state.mmPerPxX;
    const deltaYMm = (event.clientY - state.startY) * state.mmPerPxY;

    if (state.mode === 'move') {
      onMove(
        state.index,
        clamp(round(state.origin.xMm + deltaXMm), 0, widthMm - state.origin.widthMm),
        clamp(round(state.origin.yMm + deltaYMm), 0, heightMm - state.origin.heightMm),
      );
      return;
    }

    onResize(
      state.index,
      clamp(round(state.origin.widthMm + deltaXMm), 12, widthMm - state.origin.xMm),
      clamp(round(state.origin.heightMm + deltaYMm), 4, heightMm - state.origin.yMm),
    );
  };

  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div
      ref={stageRef}
      onPointerMove={handleMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      data-testid="template-stage"
      className="relative w-full overflow-hidden rounded-md border border-border bg-card shadow-sm"
      style={{ aspectRatio: `${widthMm} / ${heightMm}` }}
    >
      {backgroundHref ? (
        // eslint-disable-next-line @next/next/no-img-element -- a arte é um data: URI do bucket privado
        <img src={backgroundHref} alt="" className="pointer-events-none absolute inset-0 size-full object-fill" />
      ) : null}

      {elements.map((element, index) => {
        const isSelected = selected === index;
        const label =
          element.kind === 'QR'
            ? 'QR'
            : element.kind === 'VARIABLE'
              ? element.variable || 'variável'
              : element.text || 'texto';

        return (
          <div
            key={`${element.id}-${index}`}
            role="button"
            tabIndex={0}
            aria-label={`Elemento ${index + 1}: ${label}`}
            title={`Elemento ${index + 1}: ${label}`}
            data-testid={`stage-element-${index}`}
            onPointerDown={(event) => {
              onSelect(index);
              beginDrag(event, index, 'move');
            }}
            onFocus={() => onSelect(index)}
            className={`absolute cursor-move overflow-hidden rounded-sm border text-xs leading-tight ${
              isSelected ? 'border-primary bg-primary/10' : 'border-dashed border-border bg-foreground/5'
            }`}
            style={{
              left: `${(element.xMm / widthMm) * 100}%`,
              top: `${(element.yMm / heightMm) * 100}%`,
              width: `${(element.widthMm / widthMm) * 100}%`,
              height: `${(element.heightMm / heightMm) * 100}%`,
              color: element.color,
            }}
          >
            {/* O número é o mesmo da tabela: sem ele, a caixa selecionada no palco não
                se liga à linha que o organizador está editando. */}
            <span className="pointer-events-none block truncate px-1">
              {index + 1}. {label}
            </span>

            {isSelected ? (
              <span
                role="presentation"
                data-testid={`stage-resize-${index}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginDrag(event, index, 'resize');
                }}
                className="absolute right-0 bottom-0 size-3 cursor-nwse-resize rounded-sm bg-primary"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(max, min));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Editor
// ───────────────────────────────────────────────────────────────────────────────
export interface TemplateEditorProps {
  tenantSlug: string;
  model: EditorModel;
  events: { value: string; label: string }[];
  kinds: { value: string; label: string }[];
  saveAction: (prev: CertificateTemplateActionState | null, formData: FormData) => Promise<CertificateTemplateActionState>;
  previewAction: (
    prev: CertificateTemplateActionState | null,
    formData: FormData,
  ) => Promise<CertificateTemplateActionState>;
  uploadAction: (
    prev: CertificateTemplateActionState | null,
    formData: FormData,
  ) => Promise<CertificateTemplateActionState>;
  clearBackgroundAction: (
    prev: CertificateTemplateActionState | null,
    formData: FormData,
  ) => Promise<CertificateTemplateActionState>;
}

export function CertificateTemplateEditor({
  tenantSlug,
  model,
  events,
  kinds,
  saveAction,
  previewAction,
  uploadAction,
  clearBackgroundAction,
}: TemplateEditorProps) {
  const interactive = useIsInteractive();
  const [elements, setElements] = useState<EditorElement[]>(model.elements);
  const [selected, setSelected] = useState<number | null>(model.elements.length > 0 ? 0 : null);

  const [saveState, saveFormAction] = useActionState<CertificateTemplateActionState | null, FormData>(
    saveAction,
    null,
  );
  const [previewState, previewFormAction] = useActionState<CertificateTemplateActionState | null, FormData>(
    previewAction,
    null,
  );
  const [uploadState, uploadFormAction] = useActionState<CertificateTemplateActionState | null, FormData>(
    uploadAction,
    null,
  );
  const [clearState, clearFormAction] = useActionState<CertificateTemplateActionState | null, FormData>(
    clearBackgroundAction,
    null,
  );

  const serverPreview = typeof previewState?.data?.previewSvg === 'string' ? previewState.data.previewSvg : null;

  /**
   * A prévia mostrada é a do servidor quando ela existe, e a da página enquanto
   * isso. Derivar (em vez de guardar em estado com efeito) tem duas consequências
   * boas: o React Compiler não reprova `setState` em efeito — o defeito da FASE 39 —
   * e uma prévia RECUSADA (layout inválido) não apaga a última boa: o organizador
   * continua vendo o desenho anterior e a mensagem de erro ao lado.
   */
  const preview = serverPreview ?? model.previewSvg;

  const rowCount = interactive ? Math.min(Math.max(elements.length + 1, 8), MAX_LAYOUT_ELEMENTS) : MAX_LAYOUT_ELEMENTS;
  const rows = Array.from({ length: rowCount }, (_, index) => elements[index] ?? emptyElement(index));

  const update = (index: number, patch: Partial<EditorElement>) => {
    setElements((current) => current.map((element, position) => (position === index ? { ...element, ...patch } : element)));
  };

  const addElement = () => {
    setElements((current) => {
      if (current.length >= MAX_LAYOUT_ELEMENTS) return current;
      const next = [...current, emptyElement(current.length)];
      setSelected(next.length - 1);
      return next;
    });
  };

  const removeElement = (index: number) => {
    setElements((current) => current.filter((_, position) => position !== index));
    setSelected((current) => (current === index ? null : current));
  };

  const background = model.backgroundHref;

  return (
    <div className="space-y-6" data-testid="template-editor">
      {model.backgroundNotice ? (
        <p className="rounded-md border border-warning bg-warning-soft p-3 text-xs text-warning-strong" data-testid="background-notice">
          {model.backgroundNotice}
        </p>
      ) : null}

      {saveState && !saveState.ok ? (
        <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="template-error">
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden /> {saveState.message}
          </p>
          {saveState.details?.length ? (
            <ul className="list-disc space-y-0.5 pl-6 text-xs text-muted-foreground">
              {saveState.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {saveState?.ok ? (
        <p className="flex items-center gap-2 rounded-md border border-success bg-success-soft p-3 text-sm text-success-strong" data-testid="template-saved">
          <CheckCircle2 className="size-4" aria-hidden /> {saveState.message}
        </p>
      ) : null}

      {/*
        ─── A BANCADA VEM PRIMEIRO, E LARGA ─────────────────────────────────────────
         Palco e prévia estavam numa coluna de 360 px, ao lado de uma tabela de 860 px
         — e o resultado era o pior dos dois mundos: caixas de 4 mm virando um risco
         de 8 px e uma prévia espremida embaixo, sem relação visível com o que se
         arrastava. Aqui as duas ocupam METADE da largura cada (lado a lado em tela
         grande, empilhadas em tela pequena): o palco mostra a página inteira e a
         prévia fica ao lado, para o organizador comparar o esquema com o documento
         sem rolar a tela. A tabela ganha a largura toda logo abaixo.
      */}
      <section className="grid gap-4 xl:grid-cols-2" data-testid="template-workbench">
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Move className="size-4" aria-hidden /> Posições
          </h2>

          {interactive ? (
            <>
              <p className="text-xs text-muted-foreground">
                Arraste a caixa para posicionar e o canto para redimensionar. O número é a linha da tabela.
              </p>
              <Stage
                page={model.page}
                elements={elements}
                selected={selected}
                backgroundHref={background}
                onSelect={setSelected}
                onMove={(index, xMm, yMm) => update(index, { xMm, yMm })}
                onResize={(index, widthMm, heightMm) => update(index, { widthMm, heightMm })}
              />
            </>
          ) : (
            <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              O posicionamento por arrastar precisa de JavaScript. Sem ele, use as colunas X e Y do formulário — o
              resultado é o mesmo.
            </p>
          )}
        </div>

        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <h2 className="text-sm font-semibold">Prévia do documento</h2>

          {preview ? (
            <div
              className="overflow-hidden rounded-md border border-border bg-card [&>svg]:h-auto [&>svg]:w-full"
              data-testid="template-preview"
              // O SVG vem do MESMO renderizador do PDF emitido, com dados de exemplo.
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          ) : (
            <p className="rounded-md border border-border p-3 text-xs text-muted-foreground" data-testid="template-preview-empty">
              Salve o modelo e clique em <strong>Atualizar prévia</strong> para ver o documento com dados de exemplo.
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Formulário: a fonte dos valores enviados ─────────────────────────── */}
        <form action={saveFormAction} className="space-y-6" data-testid="template-form">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          {model.templateId ? <input type="hidden" name="templateId" value={model.templateId} /> : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1.5 text-sm font-medium">
              <span>Nome do modelo</span>
              <Input name="name" defaultValue={model.name} required maxLength={120} data-testid="template-name" />
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Vale para o evento</span>
              <Select name="eventId" defaultValue={model.eventId} data-testid="template-event">
                <option value="">Todos os eventos da instituição</option>
                {events.map((event) => (
                  <option key={event.value} value={event.value}>
                    {event.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Tipo de certificado</span>
              <Select name="kind" defaultValue={model.kind} data-testid="template-kind">
                <option value="">Qualquer tipo</option>
                {kinds.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <label className="block max-w-xs space-y-1.5 text-sm font-medium">
            <span>Página</span>
            <Select name="page" defaultValue={model.page} data-testid="template-page">
              <option value="A4_LANDSCAPE">A4 paisagem (297 × 210 mm)</option>
              <option value="A4_PORTRAIT">A4 retrato (210 × 297 mm)</option>
            </Select>
          </label>

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
                  {rows.map((element, index) => {
                    const filled = index < elements.length;

                    return (
                      <tr
                        key={index}
                        data-testid={`element-row-${index}`}
                        data-filled={filled ? 'true' : 'false'}
                        className={selected === index ? 'bg-primary/5' : undefined}
                      >
                        <td className="p-1">
                          <button
                            type="button"
                            onClick={() => setSelected(index)}
                            className="rounded px-1 text-muted-foreground hover:text-foreground"
                            aria-label={`Selecionar elemento ${index + 1}`}
                            data-testid={`element-select-${index}`}
                          >
                            {index + 1}
                          </button>
                        </td>
                        <td className="p-1">
                          <Select
                            name="elementKind"
                            value={element.kind}
                            onChange={(event) => update(index, { kind: event.target.value as EditorElement['kind'] })}
                            aria-label={`Tipo do elemento ${index + 1}`}
                          >
                            <option value="TEXT">Texto fixo</option>
                            <option value="VARIABLE">Variável</option>
                            <option value="QR">QR Code</option>
                          </Select>
                        </td>
                        <td className="p-1">
                          {element.kind === 'VARIABLE' ? (
                            <Select
                              name="elementVariable"
                              value={element.variable}
                              onChange={(event) => update(index, { variable: event.target.value })}
                              aria-label={`Variável do elemento ${index + 1}`}
                            >
                              <option value="">—</option>
                              {CERTIFICATE_VARIABLES.map((variable) => (
                                <option key={variable.key} value={variable.key} title={variable.source}>
                                  {variable.label}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <>
                              <input type="hidden" name="elementVariable" value="" />
                              <Input
                                name="elementText"
                                value={element.kind === 'QR' ? '' : element.text}
                                disabled={element.kind === 'QR'}
                                onChange={(event) => update(index, { text: event.target.value })}
                                aria-label={`Texto do elemento ${index + 1}`}
                              />
                            </>
                          )}
                        </td>
                        <td className="p-1">
                          <Input
                            name="elementX"
                            value={element.xMm}
                            inputMode="decimal"
                            className="w-16"
                            onChange={(event) => update(index, { xMm: Number(event.target.value) || 0 })}
                            aria-label={`X do elemento ${index + 1}`}
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            name="elementY"
                            value={element.yMm}
                            inputMode="decimal"
                            className="w-16"
                            onChange={(event) => update(index, { yMm: Number(event.target.value) || 0 })}
                            aria-label={`Y do elemento ${index + 1}`}
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            name="elementWidth"
                            value={element.widthMm}
                            inputMode="decimal"
                            className="w-16"
                            onChange={(event) => update(index, { widthMm: Number(event.target.value) || 0 })}
                            aria-label={`Largura do elemento ${index + 1}`}
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            name="elementHeight"
                            value={element.heightMm}
                            inputMode="decimal"
                            className="w-16"
                            onChange={(event) => update(index, { heightMm: Number(event.target.value) || 0 })}
                            aria-label={`Altura do elemento ${index + 1}`}
                          />
                        </td>
                        <td className="p-1">
                          <Select
                            name="elementAlign"
                            value={element.align}
                            onChange={(event) => update(index, { align: event.target.value })}
                            aria-label={`Alinhamento do elemento ${index + 1}`}
                          >
                            {CERTIFICATE_ALIGNMENTS.map((align) => (
                              <option key={align} value={align}>
                                {CERTIFICATE_ALIGNMENT_LABELS[align]}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="p-1">
                          <Select
                            name="elementFont"
                            value={element.font}
                            onChange={(event) => update(index, { font: event.target.value })}
                            aria-label={`Fonte do elemento ${index + 1}`}
                          >
                            {CERTIFICATE_FONTS.map((font) => (
                              <option key={font} value={font}>
                                {CERTIFICATE_FONT_LABELS[font]}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="p-1">
                          <Input
                            name="elementSize"
                            value={element.sizePt}
                            inputMode="decimal"
                            className="w-16"
                            onChange={(event) => update(index, { sizePt: Number(event.target.value) || 0 })}
                            aria-label={`Corpo do elemento ${index + 1}`}
                          />
                        </td>
                        <td className="p-1">
                          <input type="hidden" name="elementLineHeight" value={element.lineHeight} />
                          <Input
                            name="elementColor"
                            value={element.color}
                            className="w-24"
                            onChange={(event) => update(index, { color: event.target.value })}
                            aria-label={`Cor do elemento ${index + 1}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Identificadores: sem eles o servidor deriva, mas preservá-los mantém a
                chave estável quando duas linhas trocam de lugar. */}
            {rows.map((element, index) => (
              <input key={`id-${index}`} type="hidden" name="elementId" value={element.id} />
            ))}

            {interactive ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={addElement}
                  data-testid="element-add"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                >
                  <Plus className="size-3.5" aria-hidden /> Acrescentar elemento
                </button>
                <button
                  type="button"
                  onClick={() => selected !== null && removeElement(selected)}
                  disabled={selected === null}
                  data-testid="element-remove"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" aria-hidden /> Remover selecionado
                </button>
                <span className="text-xs text-muted-foreground">
                  {elements.length} de {MAX_LAYOUT_ELEMENTS} elementos
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="no-js-hint">
                Sem JavaScript, o formulário mostra as {MAX_LAYOUT_ELEMENTS} linhas do teto: preencha as que quiser usar
                (linha sem conteúdo é descartada) e salve.
              </p>
            )}
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton label="Salvar modelo" testId="template-submit" />
            <button
              type="submit"
              formAction={previewFormAction}
              data-testid="template-preview-submit"
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              <RotateCcw className="size-4" aria-hidden /> Atualizar prévia
            </button>
          </div>
        </form>

        {/* ── Palco e prévia ──────────────────────────────────────────────────── */}
        <aside className="space-y-4">
          <section className="space-y-2" data-testid="template-background">
            <h2 className="text-sm font-semibold">Arte de fundo</h2>

            {model.templateId ? (
              <>
                <form action={uploadFormAction} encType="multipart/form-data" className="space-y-2">
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="templateId" value={model.templateId} />
                  <input
                    type="file"
                    name="background"
                    accept="image/jpeg"
                    required
                    aria-label="Arquivo da arte de fundo (JPEG)"
                    data-testid="background-file"
                    className="block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    JPEG em RGB, no mínimo 150 dpi para a página escolhida. CMYK e JPEG progressivo são recusados: o PDF
                    embute o arquivo como está, e converter mudaria as cores sem ninguém perceber.
                  </p>
                  <button
                    type="submit"
                    data-testid="background-submit"
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    Aplicar arte
                  </button>
                </form>

                {model.backgroundBytes > 0 ? (
                  <form action={clearFormAction} className="flex items-center justify-between gap-2 text-xs">
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input type="hidden" name="templateId" value={model.templateId} />
                    <span className="text-muted-foreground">
                      Arte atual: {Math.round(model.backgroundBytes / 1024)} KB
                    </span>
                    <button
                      type="submit"
                      data-testid="background-clear"
                      className="rounded-md border border-border px-2 py-1 font-medium hover:bg-accent"
                    >
                      Remover arte
                    </button>
                  </form>
                ) : null}

                {[uploadState, clearState].map((feedback, index) =>
                  feedback ? (
                    <p
                      key={index}
                      role={feedback.ok ? 'status' : 'alert'}
                      data-testid={feedback.ok ? 'background-ok' : 'background-error'}
                      className={`text-xs ${feedback.ok ? 'text-success-strong' : 'text-destructive'}`}
                    >
                      {feedback.message}
                      {feedback.details?.length ? ` ${feedback.details.join(' ')}` : ''}
                    </p>
                  ) : null,
                )}
              </>
            ) : (
              <p className="rounded-md border border-border p-3 text-xs text-muted-foreground" data-testid="background-needs-save">
                Salve o modelo primeiro: a arte é guardada junto dele e o caminho no bucket usa o identificador do
                modelo.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
