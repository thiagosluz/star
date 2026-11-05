'use client';

import { Fragment, useActionState, useRef, useState, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, Move, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';

import type { CertificateTemplateActionState } from '@/app/actions/certificate-actions';
import {
  BODY_TEMPLATE_VARIABLES,
  CERTIFICATE_ALIGNMENTS,
  CERTIFICATE_ALIGNMENT_LABELS,
  CERTIFICATE_ELEMENT_KINDS,
  CERTIFICATE_ELEMENT_KIND_LABELS,
  CERTIFICATE_FONTS,
  CERTIFICATE_FONT_LABELS,
  CERTIFICATE_PAGE_FORMATS,
  CERTIFICATE_VARIABLES,
  DEFAULT_ELEMENT_COLOR,
  ELEMENT_NUDGE_FAST_MM,
  ELEMENT_NUDGE_MM,
  MAX_BODY_TEMPLATE_LENGTH,
  MAX_LAYOUT_ELEMENTS,
  bodyBoxHeightForLines,
  measureCertificateBody,
  nudgeElementPosition,
  resolveBodyTemplate,
  sampleVariableValues,
  validateBodyTemplate,
  type CertificateBodyFit,
  type CertificateElementKind,
  type CertificatePageFormat,
  type CertificatePreviewVariant,
} from '@/domain/certificates/certificate-layout-rules';
import { Input, Select, Textarea } from '@/components/ui';

/**
 * Id do aviso que ensina os atalhos do palco — referenciado por cada caixa com
 * `aria-describedby` (dívida E55). Aqui os dois lados vivem no MESMO módulo, então a
 * constante atravessa sem o problema de fronteira servidor/cliente.
 */
const STAGE_HINT_ID = 'template-stage-keyboard-hint';

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
  /**
   * Um `BODY` pode chegar do servidor (modelo com corpo próprio, FASE 86): a tela
   * ainda não tem os campos próprios dele — isso é a fatia 3 —, mas o modelo precisa
   * ROUND-TRIPAR sem virar texto fixo ao salvar, senão abrir e salvar o modelo
   * imprimiria `{{nome}}` no certificado.
   */
  kind: CertificateElementKind;
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
  /** Prévia renderizada no servidor ao abrir a página (todos os dados). */
  previewSvg: string | null;
  /**
   * A segunda prévia: o pior caso real (opcionais vazios). Ela existe porque um
   * gabarito que só usa `{{atividade}}` — opcional — pode resolver para vazio, e o
   * organizador precisa VER isso antes de emitir, não descobrir no papel.
   */
  previewWorstSvg: string | null;
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
  const [announcement, setAnnouncement] = useState<string | null>(null);
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
      /**
       * A régua do DOMÍNIO (`nudgeElementPosition`) prende a caixa à página — a mesma
       * função que o teclado usa. Duas cópias da mesma conta divergem, e a que
       * divergisse deixaria a caixa sair da folha sem a tela perceber (o layout só é
       * validado ao salvar).
       */
      const next = nudgeElementPosition({
        element: state.origin,
        page,
        dxMm: round(state.origin.xMm + deltaXMm) - state.origin.xMm,
        dyMm: round(state.origin.yMm + deltaYMm) - state.origin.yMm,
      });

      onMove(state.index, next.xMm, next.yMm);
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

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A CAIXA TAMBÉM ANDA POR TECLADO (dívida E55)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Arrastar exige ponteiro, e o formulário numérico ao lado resolve o caso — mas quem
   *  navega por teclado não tinha como mexer no PALCO (mesma família da dívida E51, no
   *  quadro de demandas).
   *
   *  Setas = 1 mm; Shift + setas = 10 mm. A página tem 297 × 210 mm: a 1 mm por toque,
   *  atravessá-la seria hostil; a 10 mm, seis toques resolvem.
   *
   *  A escrita vai pelo MESMO `onMove` do arrastar — o estado do editor continua sendo a
   *  fonte da verdade, e as linhas numéricas do formulário acompanham sozinhas (é o que
   *  o teste prende).
   */
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const element = elements[index];
    if (!element) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    /** O acorde é nosso: sem isto o navegador rola a página junto com o movimento. */
    event.preventDefault();

    const step = event.shiftKey ? ELEMENT_NUDGE_FAST_MM : ELEMENT_NUDGE_MM;
    const dxMm = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dyMm = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;

    const next = nudgeElementPosition({ element, page, dxMm, dyMm });

    if (next.xMm === element.xMm && next.yMm === element.yMm) {
      setAnnouncement(
        `Elemento ${index + 1} está na borda da página: não há para onde mover.`,
      );
      return;
    }

    onSelect(index);
    onMove(index, next.xMm, next.yMm);
    setAnnouncement(`Elemento ${index + 1} em ${next.xMm} mm por ${next.yMm} mm.`);
  };

  return (
    <div className="space-y-2">
      {/**
       * ───────────────────────────────────────────────────────────────────────────
       *  O PALCO DO CERTIFICADO É PAPEL (FASE 61 · dívida H3)
       * ───────────────────────────────────────────────────────────────────────────
       *  Era `bg-card`, que é `--ef-surface-lowest`: branco no modo claro e #23252d
       *  no escuro. O texto de cada caixa é TINTA (`element.color`, o padrão
       *  `#111827`), então no modo escuro o organizador arrastaria caixas com o
       *  rótulo invisível sobre um retângulo escuro — e o desenho que ele está
       *  compondo é para PAPEL BRANCO nos dois modos.
       *
       *  `bg-white` aqui não é cor crua por descuido: é a única superfície do
       *  sistema que NÃO pode acompanhar o tema. No claro é o mesmo branco de antes
       *  (`--ef-surface-lowest` = `#ffffff`), então o modo claro não muda; no escuro
       *  ele continua sendo a folha. A exceção está declarada com o motivo em
       *  `tests/unit/f61-varredura-escuro.test.ts`.
       */}
      <div
        ref={stageRef}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        data-testid="template-stage"
        className="relative w-full overflow-hidden rounded-md border border-border bg-white shadow-sm"
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
            aria-describedby={STAGE_HINT_ID}
            title={`Elemento ${index + 1}: ${label}`}
            data-testid={`stage-element-${index}`}
            onPointerDown={(event) => {
              onSelect(index);
              beginDrag(event, index, 'move');
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onFocus={() => onSelect(index)}
            className={`absolute cursor-move overflow-hidden rounded-sm border text-xs leading-tight ${
              isSelected ? 'border-primary bg-primary/10' : 'border-dashed border-border bg-foreground/5'
            }`}
            style={{
              left: `${(element.xMm / widthMm) * 100}%`,
              top: `${(element.yMm / heightMm) * 100}%`,
              width: `${(element.widthMm / widthMm) * 100}%`,
              height: `${(element.heightMm / heightMm) * 100}%`,
            }}
          >
            {/* O número é o mesmo da tabela: sem ele, a caixa selecionada no palco não
                se liga à linha que o organizador está editando. O RÓTULO usa o token de
                texto da interface, e não `element.color`: o palco é esquemático (quem
                mostra a cor do documento é a prévia), e uma tinta clara escolhida para
                o papel deixaria o rótulo ilegível sobre a superfície do painel — o
                portão de acessibilidade reprovou exatamente isso ao incluir esta tela. */}
            <span className="pointer-events-none block truncate px-1 text-foreground">
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

      {/**
       * O aviso que ENSINA o atalho, e a região que ANUNCIA o resultado.
       *
       * O aviso é referenciado por cada caixa (`aria-describedby`): quem chega pelo
       * teclado ouve os atalhos ao focar, em vez de descobri-los por tentativa. E o
       * anúncio existe porque mover uma caixa posicionada por `absolute` não muda a
       * posição dela na árvore — sem a frase, quem não vê a tela apertaria a seta e não
       * ouviria nada.
       */}
      <p id={STAGE_HINT_ID} className="text-xs text-muted-foreground">
        No palco, a caixa focada anda com as <strong>setas</strong> (1 mm) e com{' '}
        <strong>Shift + setas</strong> (10 mm). As medidas aparecem nos campos ao lado.
      </p>

      <p
        role="status"
        aria-live="polite"
        data-testid="template-stage-announce"
        className={`text-xs text-muted-foreground ${announcement ? '' : 'sr-only'}`}
      >
        {announcement}
      </p>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(max, min));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Números da tela em pt-BR. `Intl` é determinístico no servidor e no cliente, então o
 * contador não muda de "1.240" para "1,240" na hidratação.
 */
const COUNT_FORMAT = new Intl.NumberFormat('pt-BR');
const MM_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

// ───────────────────────────────────────────────────────────────────────────────
//  O gabarito do corpo (FASE 86 · fatia 3)
// ───────────────────────────────────────────────────────────────────────────────
interface BodyFieldProps {
  index: number;
  element: EditorElement;
  page: CertificatePageFormat;
  interactive: boolean;
  /** Há um elemento `VARIABLE` com `variable === 'corpo'` no mesmo modelo. */
  hasCorpoVariable: boolean;
  onChange: (text: string) => void;
  onHeight: (heightMm: number) => void;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  O CAMPO É UM `textarea`, E O TOKEN ENTRA NO CURSOR
 * ─────────────────────────────────────────────────────────────────────────────
 *  O conteúdo de um `BODY` não é rótulo: é texto formal, com parágrafos. Um
 *  `<input>` de uma linha apagaria as quebras de linha que o organizador escreveu —
 *  e `wrapToWidth` as usa para separar parágrafos no desenho.
 *
 *  A legenda insere `{{chave}}` na posição do cursor. Isso exige JavaScript; sem ele,
 *  a legenda CONTINUA visível (com o rótulo humano de cada chave) e o organizador
 *  digita o token à mão no mesmo `textarea` — o caminho do `<noscript>` da F39, sem
 *  um segundo formulário que gravaria outro corpo.
 *
 *  Os erros e o "não cabe" são CALCULADOS na tela por funções puras do domínio; o
 *  servidor continua sendo a guarda (`validateLayout`), e o formulário não fica
 *  bloqueado no cliente — esconder o botão salvar esconderia a mensagem do servidor.
 */
function BodyTemplateField({
  index,
  element,
  page,
  interactive,
  hasCorpoVariable,
  onChange,
  onHeight,
}: BodyFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const validation = validateBodyTemplate(element.text);

  /**
   * A medição usa os DADOS DE EXEMPLO do catálogo, como a prévia: o gabarito tem
   * tokens, e medir `{{nome}}` como se fosse texto literal daria uma largura que não
   * corresponde ao documento. `FULL` é o caso mais longo (todos os opcionais
   * preenchidos); é ele que decide se a caixa cabe.
   */
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

    /**
     * O valor é controlado pelo estado do editor; devolver o foco e o cursor depois do
     * render é o que faz o próximo token entrar DEPOIS do que acabou de ser inserido,
     * e não no fim do texto.
     */
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
            <p>Ajuste a altura na coluna Alt. da linha (o máximo desta página é {MM_FORMAT.format(suggestion?.maxHeightMm ?? 0)} mm).</p>
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

/**
 * Uma das duas prévias. A marca do "não cabe" fica SOBRE a caixa do corpo, na posição
 * real do layout — não é um aviso solto na página: o organizador vê ONDE o texto seria
 * cortado.
 */
function PreviewPanel({
  variant,
  label,
  svg,
  body,
  fit,
  page,
}: {
  variant: CertificatePreviewVariant;
  label: string;
  svg: string | null;
  body: EditorElement | null;
  fit: CertificateBodyFit | null;
  page: CertificatePageFormat;
}) {
  const pageSize = CERTIFICATE_PAGE_FORMATS[page];
  const warning = fit?.warning ?? null;
  const slug = variant === 'FULL' ? 'full' : 'worst';

  return (
    <figure className="space-y-1" data-testid={`template-preview-${slug}`}>
      <figcaption className="text-xs font-medium">{label}</figcaption>

      {svg ? (
        <div className="relative overflow-hidden rounded-md border border-border bg-white">
          {/**
           * O branco é a FOLHA, não uma cor de interface — a mesma exceção declarada do
           * palco: o SVG da prévia é transparente e o texto é tinta escura.
           */}
          <div
            data-testid={variant === 'FULL' ? 'template-preview' : 'template-preview-worst-svg'}
            className="[&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />

          {warning && body ? (
            <div
              data-testid={`template-preview-body-warning-${slug}`}
              className="pointer-events-none absolute border-2 border-destructive bg-destructive/10"
              style={{
                left: `${(body.xMm / pageSize.widthMm) * 100}%`,
                top: `${(body.yMm / pageSize.heightMm) * 100}%`,
                width: `${(body.widthMm / pageSize.widthMm) * 100}%`,
                height: `${(body.heightMm / pageSize.heightMm) * 100}%`,
              }}
            >
              <span className="absolute -top-5 left-0 rounded-sm bg-destructive px-1 text-xs whitespace-nowrap text-destructive-foreground">
                Não cabe: {warning.overflowLines} linha(s)
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
          Salve o modelo e clique em <strong>Atualizar prévia</strong> para ver o documento com dados de
          exemplo.
        </p>
      )}

      {fit ? (
        <p className="text-xs text-muted-foreground">
          {fit.lineCount} linha(s) no corpo · cabem {fit.maxLines}
        </p>
      ) : null}
    </figure>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Editor
// ───────────────────────────────────────────────────────────────────────────────
export interface TemplateEditorProps {
  tenantSlug: string;
  model: EditorModel;
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O ALVO É DA ROTA, NÃO DE UM `<select>` (FASE 86 · fatia 4)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O editor tinha "Vale para o evento" com "Todos os eventos da instituição" —
   *  e era por ali que a tela da instituição criava modelo de evento, misturando os
   *  dois alvos na mesma galeria. Agora a tela DA INSTITUIÇÃO só cria padrão
   *  (`eventId = null`) e a tela DO EVENTO só cria para aquele evento: o alvo é o
   *  endereço, e um `<select>` de um item convidaria a trocar o que a rota decidiu.
   *  O campo vira TEXTO e um `input` oculto, para o formulário sem JavaScript
   *  continuar mandando o `eventId` certo.
   */
  eventTitle: string | null;
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
  eventTitle,
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
  const serverPreviewWorst =
    typeof previewState?.data?.previewWorstSvg === 'string' ? previewState.data.previewWorstSvg : null;

  /**
   * A prévia mostrada é a do servidor quando ela existe, e a da página enquanto
   * isso. Derivar (em vez de guardar em estado com efeito) tem duas consequências
   * boas: o React Compiler não reprova `setState` em efeito — o defeito da FASE 39 —
   * e uma prévia RECUSADA (layout inválido) não apaga a última boa: o organizador
   * continua vendo o desenho anterior e a mensagem de erro ao lado.
   */
  const previewFull = serverPreview ?? model.previewSvg;
  const previewWorst = serverPreviewWorst ?? model.previewWorstSvg;

  const bodyElement = elements.find((element) => element.kind === 'BODY') ?? null;
  const bodyFitFor = (variant: CertificatePreviewVariant): CertificateBodyFit | null => {
    if (!bodyElement) return null;

    return measureCertificateBody({
      text: resolveBodyTemplate(bodyElement.text, sampleVariableValues(variant)),
      box: bodyElement,
    });
  };
  const fullBodyFit = bodyFitFor('FULL');
  const worstBodyFit = bodyFitFor('WORST_CASE');

  /**
   * O conflito `BODY` + `{{corpo}}` é recusado no domínio. Aqui ele aparece ANTES do
   * envio, porque salvar para descobrir é caro quando o organizador já escreveu o
   * texto inteiro.
   */
  const hasCorpoVariable = elements.some(
    (element) => element.kind === 'VARIABLE' && element.variable === 'corpo',
  );

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

          {previewFull || previewWorst ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <PreviewPanel
                variant="FULL"
                label="Com todos os dados"
                svg={previewFull}
                body={bodyElement}
                fit={fullBodyFit}
                page={model.page}
              />
              <PreviewPanel
                variant="WORST_CASE"
                label="Com dados opcionais vazios"
                svg={previewWorst}
                body={bodyElement}
                fit={worstBodyFit}
                page={model.page}
              />
            </div>
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

            <div className="space-y-1.5 text-sm font-medium">
              <span>Vale para</span>
              <p
                className="rounded-md border border-border bg-card px-3 py-2 text-sm font-normal"
                data-testid="template-event-fixed"
              >
                {model.eventId
                  ? `Este evento — ${eventTitle ?? 'evento da rota'}`
                  : 'Todos os eventos da instituição (modelo padrão)'}
              </p>
              {model.eventId ? <input type="hidden" name="eventId" value={model.eventId} /> : null}
            </div>

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
                      <Fragment key={index}>
                        <tr
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
                            {/**
                             * As opções saem do CATÁLOGO do domínio (fonte única). O
                             * `BODY` entrou na lista na FASE 86 junto com o domínio:
                             * sem a opção, um modelo com corpo próprio abriria no
                             * editor com o seletor "vazio" e salvaria como texto fixo,
                             * imprimindo `{{nome}}` no certificado. A edição de verdade
                             * do gabarito (área de texto, legenda das variáveis e aviso
                             * de "não cabe") é a fatia 3.
                             */}
                            {CERTIFICATE_ELEMENT_KINDS.map((kind) => (
                              <option key={kind} value={kind}>
                                {CERTIFICATE_ELEMENT_KIND_LABELS[kind]}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="p-1">
                          {element.kind === 'VARIABLE' ? (
                            <>
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
                              {/**
                               * O `elementText` oculto mantém as colunas ALINHADAS por
                               * índice: `buildLayoutFromRows` lê listas paralelas, e uma
                               * linha que não envia o campo deslocaria o texto de todas
                               * as seguintes. O formulário sem JavaScript depende disso.
                               */}
                              <input type="hidden" name="elementText" value="" />
                            </>
                          ) : element.kind === 'BODY' ? (
                            <>
                              <input type="hidden" name="elementVariable" value="" />
                              <p className="text-xs text-muted-foreground">
                                Gabarito — o campo fica logo abaixo da linha, com a legenda das variáveis.
                              </p>
                            </>
                          ) : element.kind === 'QR' ? (
                            <>
                              <input type="hidden" name="elementVariable" value="" />
                              <Input value="" disabled aria-label={`Texto do elemento ${index + 1}`} />
                              <input type="hidden" name="elementText" value="" />
                            </>
                          ) : (
                            <>
                              <input type="hidden" name="elementVariable" value="" />
                              {/**
                               * `textarea` também no TEXTO FIXO: sem JavaScript o
                               * organizador troca o tipo da linha e continua com o mesmo
                               * campo, e as quebras de linha do corpo não se perdem no
                               * caminho (é o `<noscript>` da F39 sem um segundo
                               * formulário).
                               */}
                              <Textarea
                                name="elementText"
                                value={element.text}
                                rows={1}
                                className="h-11 min-h-0 py-2"
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

                        {element.kind === 'BODY' ? (
                          <tr data-testid={`element-body-row-${index}`}>
                            <td colSpan={11} className="bg-primary/5 p-2">
                              <BodyTemplateField
                                index={index}
                                element={element}
                                page={model.page}
                                interactive={interactive}
                                hasCorpoVariable={hasCorpoVariable}
                                onChange={(text) => update(index, { text })}
                                onHeight={(heightMm) => update(index, { heightMm })}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground" data-testid="body-hint">
              O <strong>corpo do certificado</strong> é o elemento do tipo “Corpo do certificado (gabarito)”. O
              gabarito aceita quebras de linha e variáveis como <code>{'{{nome}}'}</code>; o texto é impresso no
              lugar da caixa do elemento.
            </p>

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
                Sem JavaScript, o formulário mostra as {MAX_LAYOUT_ELEMENTS} linhas do teto: preencha as que quiser
                usar (linha sem conteúdo é descartada) e salve. Para o corpo, escolha “Corpo do certificado
                (gabarito)” na coluna Tipo de uma linha livre e escreva o gabarito na coluna Conteúdo — as quebras
                de linha são preservadas. As variáveis podem ser digitadas à mão (ex.: <code>{'{{nome}}'}</code>).
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
                  {/**
                   * O alvo vai junto em TODO formulário que escreve no modelo. Sem
                   * isto, a arte (e o "remover arte", e a exclusão) alcançaria o
                   * modelo de outro evento trocando só o `templateId` do corpo.
                   * Campo vazio = padrão da instituição — é um valor, não ausência.
                   */}
                  <input type="hidden" name="eventId" value={model.eventId} />
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
                    <input type="hidden" name="eventId" value={model.eventId} />
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
