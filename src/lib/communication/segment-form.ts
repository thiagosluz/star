/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — A PONTE ENTRE O FORMULÁRIO E O DOMÍNIO (FASE 67 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA PONTE É UM MÓDULO PURO, E NÃO CÓDIGO DENTRO DA PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A definição do segmento entra pela URL (o `<form method="GET">`, que faz o
 *  resultado ser um endereço compartilhável) e sai como SNAPSHOT para a Server
 *  Action que envia. As duas coisas são decididas aqui, sem Next, sem Prisma e sem
 *  React — e é por isso que a regra da tela (qual passo mostrar) é testável sem
 *  navegador.
 *
 *  Nada aqui avalia segmento nem fala com o banco: a composição e a contagem são do
 *  domínio e do serviço da fatia 1, e continuam sendo a única fonte da verdade.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CONDIÇÃO DESCONHECIDA ATRAVESSA — NÃO É DESCARTADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um id que não existe no catálogo (URL editada à mão, snapshot de uma versão
 *  antiga) continua na lista e é RECUSADO pela composição. Descartá-lo em silêncio
 *  seria fail-open: "todas as condições valem" com uma condição a menos seleciona
 *  MAIS gente do que o organizador pediu — e o envio é irreversível.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DEFINIÇÃO VIAJA CANÔNICA PARA O ENVIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O passo de confirmação NÃO remonta a definição campo a campo: ele carrega o
 *  JSON da definição já VALIDADA (`encodeSegmentDefinition`) e a ação a reconstrói
 *  com `parseStoredDefinition` — o mesmo leitor do snapshot gravado. Um campo
 *  esquecido nos `hidden` de um formulário reconstruído alargaria a seleção em
 *  silêncio; um JSON inválido, não: ele vira lista vazia, a composição RECUSA e
 *  nada sai (fail-closed, o caminho do snapshot corrompido).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  isSegmentConditionId,
  segmentCondition,
  type SegmentDefinition,
} from '@/domain/communication/segments';

/**
 * Quantos filtros a tela oferece de uma vez.
 *
 * O número é do PRODUTO, não do banco: o segmento é uma frase que se lê em voz
 * alta, e "todas as condições valem" com quinze filtros não é frase — é consulta.
 * Cinco cobre os recortes reais (uma entidade, um fato de presença, um de vínculo)
 * com folga, e o formulário continua sendo um formulário numa página só.
 */
export const SEGMENT_SLOT_COUNT = 5;

/** Nome do campo do filtro `index` (0-based). */
export function segmentSlotField(index: number): string {
  return `c${index}`;
}

/** Nome do campo do parâmetro `key` do filtro `index`. */
export function segmentSlotParamField(index: number, key: string): string {
  return `p${index}_${key}`;
}

export const SEGMENT_EXCEPT_FIELD = 'exceto';

/** Nome do campo do parâmetro `key` do "exceto quem…". */
export function segmentExceptParamField(key: string): string {
  return `x_${key}`;
}

export const SEGMENT_EVENT_FIELD = 'evento';
export const SEGMENT_SUBJECT_FIELD = 'assunto';
export const SEGMENT_BODY_FIELD = 'corpo';
/** O organizador pediu o passo de confirmação (`revisar=1`). */
export const SEGMENT_REVIEW_FIELD = 'revisar';
/** Marcador de que o formulário já foi enviado (a URL carrega uma definição). */
export const SEGMENT_SUBMIT_FIELD = 'segmento';

/** Lê um campo do formulário. `null` = o campo não veio. */
type SegmentFormReader = (key: string) => string | null;

export interface SegmentFormCondition {
  /**
   * O id COMO VEIO — e não o tipo fechado do catálogo. Id desconhecido precisa
   * chegar à composição para ser recusado (ver o cabeçalho do arquivo).
   */
  id: string;
  /** Valores informados, por chave declarada. Campo vazio não entra. */
  values: Readonly<Record<string, string>>;
}

export interface SegmentFormState {
  /** O formulário já foi enviado ao menos uma vez? */
  submitted: boolean;
  eventId: string | null;
  /** Um item por filtro; `null` = o filtro não foi usado. */
  slots: readonly (SegmentFormCondition | null)[];
  except: SegmentFormCondition | null;
  subject: string;
  body: string;
  /** `true` = o passo de confirmação (o que envia de verdade). */
  reviewing: boolean;
}

function readCondition(
  read: SegmentFormReader,
  idField: string,
  paramField: (key: string) => string,
): SegmentFormCondition | null {
  const raw = read(idField);
  const id = typeof raw === 'string' ? raw.trim() : '';

  if (id.length === 0) return null;

  const values: Record<string, string> = {};

  /**
   * Os parâmetros lidos são os DECLARADOS pelo catálogo. Se a condição é
   * desconhecida não há o que declarar — e o id sozinho já basta para a recusa.
   */
  if (isSegmentConditionId(id)) {
    for (const parameter of segmentCondition(id).parameters) {
      const value = read(paramField(parameter.key));
      const text = typeof value === 'string' ? value.trim() : '';

      if (text.length > 0) values[parameter.key] = text;
    }
  }

  return { id, values };
}

/** Lê o estado do formulário da URL da tela. */
function segmentFormFrom(read: SegmentFormReader): SegmentFormState {
  const slots: (SegmentFormCondition | null)[] = [];

  for (let index = 0; index < SEGMENT_SLOT_COUNT; index += 1) {
    slots.push(readCondition(read, segmentSlotField(index), (key) => segmentSlotParamField(index, key)));
  }

  return {
    submitted: read(SEGMENT_SUBMIT_FIELD) === '1',
    eventId: nonEmpty(read(SEGMENT_EVENT_FIELD)),
    slots,
    except: readCondition(read, SEGMENT_EXCEPT_FIELD, segmentExceptParamField),
    subject: read(SEGMENT_SUBJECT_FIELD)?.trim() ?? '',
    body: read(SEGMENT_BODY_FIELD) ?? '',
    reviewing: read(SEGMENT_REVIEW_FIELD) === '1',
  };
}

function nonEmpty(value: string | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

/** `searchParams` do Next como fonte do formulário. */
export function segmentFormFromSearchParams(
  params: Readonly<Record<string, string | string[] | undefined>>,
): SegmentFormState {
  return segmentFormFrom((key) => {
    const value = params[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  });
}

/**
 * A entrada da composição, do jeito que `composeSegment` entende.
 *
 * O "exceto quem…" vazio sai como `null` (e não como `{}`): objeto sem id é
 * RECUSA no domínio, e um formulário em branco não é um erro do organizador.
 */
export function segmentFormCompositionInput(state: SegmentFormState): {
  conditions: readonly { id: string; params: Readonly<Record<string, string>> }[];
  except: { id: string; params: Readonly<Record<string, string>> } | null;
} {
  return {
    conditions: state.slots
      .filter((slot): slot is SegmentFormCondition => slot !== null)
      .map((slot) => ({ id: slot.id, params: slot.values })),
    except: state.except ? { id: state.except.id, params: state.except.values } : null,
  };
}

/** A definição validada vira o `hidden` do passo de confirmação. */
export function encodeSegmentDefinition(definition: SegmentDefinition): string {
  return JSON.stringify({
    conditions: definition.conditions.map((reference) => ({
      id: reference.id,
      params: reference.params,
    })),
    except: definition.except ? { id: definition.except.id, params: definition.except.params } : null,
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  O endereço compartilhável
// ───────────────────────────────────────────────────────────────────────────────
export type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

/**
 * Reconstrói o endereço da tela a partir do que está na URL, trocando ou tirando
 * chaves.
 *
 * Existe para o caminho de volta ("editar o texto" sai do passo de confirmação) e
 * para o "limpar" — e é montado a partir da URL INTEIRA, e não do estado do
 * formulário: assim nada do que o organizador montou se perde numa ida e volta.
 */
export function segmentQuery(
  params: RawSearchParams,
  options: { omit?: readonly string[]; set?: Readonly<Record<string, string>> } = {},
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (options.omit?.includes(key)) continue;
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
      continue;
    }

    search.set(key, value);
  }

  for (const [key, value] of Object.entries(options.set ?? {})) {
    search.set(key, value);
  }

  return search.toString();
}

// ───────────────────────────────────────────────────────────────────────────────
//  O evento do endereço
// ───────────────────────────────────────────────────────────────────────────────
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O evento informado tem forma de uuid?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO É UMA VALIDAÇÃO DE ENFEITE
 * ─────────────────────────────────────────────────────────────────────────────
 *  Um `evento` torto no endereço (URL editada à mão) não pode ser tratado como
 *  "sem evento": a campanha passaria a ser da INSTITUIÇÃO INTEIRA, que é mais gente
 *  do que o organizador pediu. A resposta certa é a recusa, dita na tela — e é por
 *  isso que a pergunta é feita aqui, antes de qualquer consulta.
 */
export function isSegmentEventIdShaped(value: string | null): boolean {
  return value === null || UUID_PATTERN.test(value);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Qual passo a tela mostra
// ───────────────────────────────────────────────────────────────────────────────
export type SegmentScreenStep =
  /** O formulário em branco (ou já montado): nada foi contado ainda. */
  | 'montar'
  /** A definição foi recusada: o motivo é do domínio, e a tela só o mostra. */
  | 'recusado'
  /** A seleção está de pé: contagem, frases, prévia e o texto da mensagem. */
  | 'contar'
  /** O texto está válido e o organizador pediu a confirmação. */
  | 'confirmar';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA DA TELA, EM UMA FUNÇÃO SÓ
 * ─────────────────────────────────────────────────────────────────────────────
 *  O passo de confirmação exige TRÊS coisas ao mesmo tempo: definição de pé,
 *  contagem feita e texto válido. Sem a última, "confirmar" seria um botão que
 *  envia uma mensagem sem assunto — a recusa apareceria depois do clique, como
 *  falha da ação, quando o certo é ela aparecer antes, junto do campo.
 *
 *  E o campo em branco NÃO é recusa: quem chega à aba vê o formulário, não um erro
 *  sobre um segmento que ainda não montou.
 */
export function segmentScreenStep(input: {
  submitted: boolean;
  compositionOk: boolean;
  evaluationOk: boolean;
  textOk: boolean;
  reviewing: boolean;
}): SegmentScreenStep {
  if (!input.submitted) return 'montar';
  if (!input.compositionOk || !input.evaluationOk) return 'recusado';
  if (!input.textOk) return 'contar';

  return input.reviewing ? 'confirmar' : 'contar';
}

