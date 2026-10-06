/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Catálogo de segmentos e composição da seleção (FASE 67 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CATÁLOGO É REGRA DE DOMÍNIO, E NÃO UM FORMULÁRIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Segmentar comunicação é escolher GENTE, e a escolha precisa ser explicável:
 *  quem aperta "enviar" tem de saber responder "por que esta pessoa recebeu?" —
 *  hoje e seis meses depois, quando a campanha for auditada. Um construtor
 *  booleano livre produz filtro que ninguém lê; um catálogo de CONDIÇÕES com
 *  frase própria produz uma seleção que se lê em voz alta.
 *
 *  Então cada condição declara, aqui e de uma vez:
 *
 *    • `id` ESTÁVEL — é o que vai gravado no snapshot da campanha; renomear o
 *      rótulo não pode reescrever o passado;
 *    • `label` — o que a tela mostra na lista de escolha;
 *    • `parameters` — os parâmetros DECLARADOS, com tipo, obrigatoriedade e
 *      validação. O que não é declarado não existe: parâmetro desconhecido é
 *      RECUSA, não silêncio (fail-closed);
 *    • `phrase` — a frase que explica o que a condição SELECIONA, com os valores
 *      no lugar. Ela é requisito, não enfeite: é o que permite conferir a
 *      seleção sem abrir o banco e o que faz o catálogo ser testável sem
 *      navegador.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTE ARQUIVO NÃO CONHECE PRISMA, BANCO NEM TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele decide duas coisas: o que cada condição significa e o que uma COMPOSIÇÃO
 *  de condições significa. Quem traduz isso em consulta é
 *  `src/lib/communication/segment-service.ts`, e a catraca entre os dois (toda
 *  condição tem construtor, todo construtor tem condição) vive lá.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE NÃO ENTROU NO CATÁLOGO — E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O plano da fase propunha duas condições que o schema NÃO sustenta, e inventar
 *  a tabela que faltava seria criar um fato falso:
 *
 *    • **"certificado emitido e nunca baixado"** — não existe registro de download
 *      por certificado. `certificates."validationCount"`/`"lastValidatedAt"` são da
 *      página PÚBLICA de validação, e `downloadCount`/`lastDownloadedAt` existem
 *      apenas em `data_exports` (exportação de dado pessoal da FASE 49). Sem o
 *      fato, a condição diria "nunca baixou" sobre quem baixou;
 *    • **"inscritos numa trilha"** — a `Track` é o eixo temático do trabalho
 *      científico e se liga a `submissions` e a `call_for_proposals`; NÃO há
 *      caminho dela para `registrations` nem para `activities` (a inscrição é por
 *      ATIVIDADE). O que existe é recorte por TRILHA onde a trilha de fato existe
 *      (autor de submissão, parecer) e por ATIVIDADE onde o que existe é a
 *      inscrição — é assim que o catálogo está escrito.
 *
 *  A condição "sem certificado" também mudou de recorte, e a mudança é de
 *  honestidade: "com presença suficiente" é o VEREDITO de `evaluateEligibility`
 *  (presenças, carga horária, vínculo de palestrante, pareceres, fim do evento).
 *  Repetir essa conta aqui criaria uma segunda régua, que divergiria da tela do
 *  certificado no primeiro dia. O catálogo seleciona pelo FATO que existe —
 *  "registrou presença e não tem certificado" — e a frase diz exatamente isso.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { isPersonPubliclyVisible, maskPersonName } from '@/domain/profile/public-profile-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Parâmetros
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Os tipos de parâmetro que o catálogo usa.
 *
 * São quatro porque são quatro formas de entrada na tela: escolher uma entidade
 * (uuid), escolher um dia, escolher uma hora e digitar um número. Um tipo a mais
 * ("texto livre") abriria a porta para um filtro que ninguém sabe explicar.
 */
export const SEGMENT_PARAMETER_KINDS = ['uuid', 'data', 'hora', 'numero'] as const;
export type SegmentParameterKind = (typeof SEGMENT_PARAMETER_KINDS)[number];

export const SEGMENT_PARAMETER_KIND_LABELS: Readonly<Record<SegmentParameterKind, string>> = {
  uuid: 'Escolha na lista',
  data: 'Dia (AAAA-MM-DD)',
  hora: 'Hora (HH:MM)',
  numero: 'Número inteiro',
};

export type SegmentValue = string | number;
export type SegmentParams = Readonly<Record<string, SegmentValue>>;

export interface SegmentParameter {
  /** Chave estável — é ela que aparece em `{chave}` na frase e no snapshot. */
  key: string;
  label: string;
  kind: SegmentParameterKind;
  required: boolean;
  /**
   * Valor assumido quando o organizador não informa. `null` = não há padrão, e o
   * parâmetro simplesmente não entra no filtro (a frase diz o que isso significa
   * através de `unset`).
   */
  fallback: SegmentValue | null;
  /**
   * Como a FRASE lê este parâmetro quando ele não foi informado. Obrigatório para
   * parâmetro opcional sem padrão: sem ele a frase mostraria `{atividade}` cru —
   * e a frase é o que o organizador lê para saber o que está prestes a enviar.
   */
  unset?: string;
  /** Explicação do parâmetro, exibida sob o campo na tela. */
  hint: string;
  /** Limites do tipo `numero` (inclusivos). */
  min?: number;
  max?: number;
}

/** Texto usado quando um parâmetro obrigatório chega sem valor à frase. */
export const UNSET_PARAMETER_TEXT = '(não informado)';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** O dia existe no calendário? (`2027-02-31` casa o formato e não existe.) */
function isRealDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;

  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, date));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === date
  );
}

export interface SegmentParamsResult {
  ok: boolean;
  values: SegmentParams;
  /** Motivos da recusa, em português, para a tela mostrar o que corrigir. */
  problems: readonly string[];
}

/**
 * Valida e normaliza os parâmetros de UMA condição.
 *
 * Aplica os padrões declarados e RECUSA o resto — nunca "ignora o que não
 * entende". Um parâmetro inválido que fosse descartado em silêncio faria a
 * seleção ser maior do que o organizador pediu, e o envio, irreversível.
 */
export function parseSegmentParams(
  condition: SegmentCondition,
  raw: Readonly<Record<string, unknown>> = {},
): SegmentParamsResult {
  const problems: string[] = [];
  const values: Record<string, SegmentValue> = {};
  const declared = new Set(condition.parameters.map((parameter) => parameter.key));

  for (const key of Object.keys(raw)) {
    if (!declared.has(key)) {
      problems.push(`Parâmetro não declarado em "${condition.label}": ${key}.`);
    }
  }

  for (const parameter of condition.parameters) {
    const entry = raw[parameter.key];
    const empty = entry === undefined || entry === null || (typeof entry === 'string' && entry.trim() === '');

    if (empty) {
      if (parameter.fallback !== null) {
        values[parameter.key] = parameter.fallback;
      } else if (parameter.required) {
        problems.push(`Informe ${parameter.label.toLowerCase()}.`);
      }
      continue;
    }

    const value = validateParameterValue(parameter, entry);

    if (value === null) {
      problems.push(`Valor inválido para ${parameter.label.toLowerCase()}: ${String(entry)}.`);
      continue;
    }

    values[parameter.key] = value;
  }

  return { ok: problems.length === 0, values, problems };
}

/** Converte e valida um valor informado. `null` = recusa. */
function validateParameterValue(parameter: SegmentParameter, entry: unknown): SegmentValue | null {
  const text = typeof entry === 'string' ? entry.trim() : entry;

  switch (parameter.kind) {
    case 'uuid':
      return typeof text === 'string' && UUID_PATTERN.test(text) ? text.toLowerCase() : null;

    case 'data':
      return typeof text === 'string' && isRealDay(text) ? text : null;

    case 'hora':
      return typeof text === 'string' && TIME_PATTERN.test(text) ? text : null;

    case 'numero': {
      const numeric =
        typeof text === 'number' ? text : typeof text === 'string' && /^-?\d+$/.test(text) ? Number(text) : NaN;

      if (!Number.isInteger(numeric)) return null;
      if (parameter.min !== undefined && numeric < parameter.min) return null;
      if (parameter.max !== undefined && numeric > parameter.max) return null;
      return numeric;
    }
  }
}

/**
 * Parâmetros com os padrões aplicados, sem julgar validade.
 *
 * Existe separado de `parseSegmentParams` porque a FRASE precisa ser montável
 * mesmo quando a definição foi recusada: é mostrando "menos de 120 minutos" que
 * o organizador entende o que errou.
 */
export function segmentParamsWithDefaults(
  condition: SegmentCondition,
  raw: SegmentParams = {},
): Record<string, SegmentValue> {
  const values: Record<string, SegmentValue> = {};

  for (const parameter of condition.parameters) {
    const entry = raw[parameter.key];
    if (entry !== undefined) values[parameter.key] = entry;
    else if (parameter.fallback !== null) values[parameter.key] = parameter.fallback;
  }

  return values;
}

// ───────────────────────────────────────────────────────────────────────────────
//  O catálogo
// ───────────────────────────────────────────────────────────────────────────────
export const SEGMENT_CONDITION_IDS = [
  'inscricao-sem-confirmacao',
  'inscricao-em-espera',
  'inscricao-cancelada',
  'presenca-manha-sem-tarde',
  'nunca-credenciado',
  'minutos-abaixo',
  'autor-aprovado-sem-material',
  'revisor-com-parecer-pendente',
  'proposta-em-rascunho',
  'inscrito-na-atividade',
  'inscrito-na-sala',
  'presenca-sem-certificado',
  'perfil-incompleto',
  'xp-acima',
  'carta-conquistada',
] as const;

export type SegmentConditionId = (typeof SEGMENT_CONDITION_IDS)[number];

export interface SegmentCondition {
  id: SegmentConditionId;
  label: string;
  /**
   * O que a condição SELECIONA, com `{parametro}` onde entram os valores.
   *
   * A frase cita TODOS os parâmetros que mudam a seleção (menos o evento, que é
   * o recorte da campanha e aparece no topo da tela) — e um teste prende isso.
   */
  phrase: string;
  parameters: readonly SegmentParameter[];
  /**
   * A condição recorta por EVENTO? Sem evento no contexto, avaliá-la é ERRO — e
   * não "seleciona todo mundo", que é o que um filtro por evento vazio faria.
   */
  requiresEvent: boolean;
}

export const SEGMENT_CATALOG: Record<SegmentConditionId, SegmentCondition> = {
  'inscricao-sem-confirmacao': {
    id: 'inscricao-sem-confirmacao',
    label: 'Vaga retida, sem confirmação',
    phrase: 'Quem se inscreveu {atividade} e ainda não confirmou a vaga — a inscrição está retida.',
    parameters: [
      {
        key: 'atividade',
        label: 'Atividade',
        kind: 'uuid',
        required: false,
        fallback: null,
        unset: 'em alguma atividade do evento',
        hint: 'Deixe em branco para todas as atividades que exigem confirmação.',
      },
    ],
    requiresEvent: true,
  },

  'inscricao-em-espera': {
    id: 'inscricao-em-espera',
    label: 'Na lista de espera',
    phrase: 'Quem está na lista de espera {atividade} — esperando uma vaga abrir.',
    parameters: [
      {
        key: 'atividade',
        label: 'Atividade',
        kind: 'uuid',
        required: false,
        fallback: null,
        unset: 'do evento',
        hint: 'Deixe em branco para a lista de espera inteira do evento.',
      },
    ],
    requiresEvent: true,
  },

  'inscricao-cancelada': {
    id: 'inscricao-cancelada',
    label: 'Inscrição cancelada',
    phrase: 'Quem cancelou a inscrição {atividade}.',
    parameters: [
      {
        key: 'atividade',
        label: 'Atividade',
        kind: 'uuid',
        required: false,
        fallback: null,
        unset: 'no evento',
        hint: 'Deixe em branco para todos os cancelamentos do evento.',
      },
    ],
    requiresEvent: true,
  },

  'presenca-manha-sem-tarde': {
    id: 'presenca-manha-sem-tarde',
    label: 'Presente de manhã, ausente à tarde',
    phrase:
      'Quem registrou presença de manhã {dia} e não voltou à tarde — a manhã vai até {manha} e o dia até {tarde}.',
    parameters: [
      {
        key: 'dia',
        label: 'Dia',
        kind: 'data',
        required: false,
        fallback: null,
        unset: 'no dia da abertura do evento',
        hint: 'O dia é contado no fuso do evento. Em branco, vale o dia em que o evento começa.',
      },
      {
        key: 'manha',
        label: 'A manhã termina às',
        kind: 'hora',
        required: false,
        fallback: '12:00',
        hint: 'Fim do período da manhã e começo da tarde, no fuso do evento.',
      },
      {
        key: 'tarde',
        label: 'O dia termina às',
        kind: 'hora',
        required: false,
        fallback: null,
        unset: 'o fim do dia',
        hint: 'Limite para o check-in da tarde. Em branco, vale o fim do dia do evento.',
      },
    ],
    requiresEvent: true,
  },

  'nunca-credenciado': {
    id: 'nunca-credenciado',
    label: 'Inscrito que nunca fez check-in',
    phrase:
      'Quem está inscrito {atividade} e nunca registrou presença no evento — nem na portaria, nem em atividade.',
    parameters: [
      {
        key: 'atividade',
        label: 'Atividade',
        kind: 'uuid',
        required: false,
        fallback: null,
        unset: 'no evento',
        hint: 'Deixe em branco para todos os inscritos do evento.',
      },
    ],
    requiresEvent: true,
  },

  'minutos-abaixo': {
    id: 'minutos-abaixo',
    label: 'Menos de X minutos de presença',
    phrase:
      'Quem tem menos de {minutos} minutos de presença somados {atividade} — inclui quem nunca fez check-in (zero minuto).',
    parameters: [
      {
        key: 'minutos',
        label: 'Minutos de presença',
        kind: 'numero',
        required: true,
        fallback: null,
        hint: 'Soma dos minutos medidos entre check-in e check-out.',
        min: 1,
        max: 100_000,
      },
      {
        key: 'atividade',
        label: 'Atividade',
        kind: 'uuid',
        required: false,
        fallback: null,
        unset: 'no evento',
        hint: 'Deixe em branco para somar a presença do evento inteiro.',
      },
    ],
    requiresEvent: true,
  },

  'autor-aprovado-sem-material': {
    id: 'autor-aprovado-sem-material',
    label: 'Autor aprovado sem material',
    phrase:
      'Autores de submissão aprovada {trilha} que não publicaram material de apoio na atividade da submissão.',
    parameters: [
      {
        key: 'trilha',
        label: 'Trilha',
        kind: 'uuid',
        required: false,
        fallback: null,
        unset: 'de qualquer trilha do evento',
        hint: 'Deixe em branco para todas as trilhas.',
      },
    ],
    requiresEvent: true,
  },

  'revisor-com-parecer-pendente': {
    id: 'revisor-com-parecer-pendente',
    label: 'Parecer pendente',
    phrase: 'Revisores com parecer atribuído {trilha} que ainda não enviaram a avaliação.',
    parameters: [
      {
        key: 'trilha',
        label: 'Trilha',
        kind: 'uuid',
        required: false,
        fallback: null,
        unset: 'em qualquer trilha do evento',
        hint: 'Deixe em branco para todas as trilhas.',
      },
    ],
    requiresEvent: true,
  },

  'proposta-em-rascunho': {
    id: 'proposta-em-rascunho',
    label: 'Proposta em rascunho',
    phrase: 'Autores com proposta em rascunho {chamada} — começaram a preencher e não enviaram.',
    parameters: [
      {
        key: 'chamada',
        label: 'Chamada',
        kind: 'uuid',
        required: false,
        fallback: null,
        unset: 'em qualquer chamada do evento',
        hint: 'Deixe em branco para todas as chamadas.',
      },
    ],
    requiresEvent: true,
  },

  'inscrito-na-atividade': {
    id: 'inscrito-na-atividade',
    label: 'Inscritos na atividade',
    phrase: 'Quem está inscrito {atividade}.',
    parameters: [
      {
        key: 'atividade',
        label: 'Atividade',
        kind: 'uuid',
        required: true,
        fallback: null,
        hint: 'A inscrição é por atividade: é este o recorte que define o público.',
      },
    ],
    requiresEvent: true,
  },

  'inscrito-na-sala': {
    id: 'inscrito-na-sala',
    label: 'Inscritos na sala',
    phrase: 'Quem está inscrito {sala} — em alguma atividade dela.',
    parameters: [
      {
        key: 'sala',
        label: 'Sala',
        kind: 'uuid',
        required: true,
        fallback: null,
        hint: 'A sala é da atividade — quem está inscrito em qualquer atividade dela entra.',
      },
    ],
    requiresEvent: true,
  },

  'presenca-sem-certificado': {
    id: 'presenca-sem-certificado',
    label: 'Presença sem certificado',
    phrase:
      'Quem registrou presença no evento e ainda não tem certificado — nem pedido de emissão em andamento.',
    parameters: [],
    requiresEvent: true,
  },

  'perfil-incompleto': {
    id: 'perfil-incompleto',
    label: 'Perfil sem foto ou sem bio',
    phrase: 'Pessoas desta instituição com o perfil sem foto ou sem bio.',
    parameters: [],
    requiresEvent: false,
  },

  'xp-acima': {
    id: 'xp-acima',
    label: 'XP acima de um patamar',
    phrase: 'Quem já acumulou {xp} XP ou mais nesta instituição.',
    parameters: [
      {
        key: 'xp',
        label: 'XP mínimo',
        kind: 'numero',
        required: true,
        fallback: null,
        hint: 'XP total acumulado na instituição.',
        min: 1,
        max: 1_000_000,
      },
    ],
    requiresEvent: false,
  },

  'carta-conquistada': {
    id: 'carta-conquistada',
    label: 'Carta conquistada',
    phrase: 'Quem já conquistou a carta {carta}.',
    parameters: [
      {
        key: 'carta',
        label: 'Carta',
        kind: 'uuid',
        required: true,
        fallback: null,
        hint: 'Qualquer exemplar da carta no álbum da pessoa.',
      },
    ],
    requiresEvent: false,
  },
};

export function isSegmentConditionId(value: unknown): value is SegmentConditionId {
  return typeof value === 'string' && (SEGMENT_CONDITION_IDS as readonly string[]).includes(value);
}

export function segmentCondition(id: SegmentConditionId): SegmentCondition {
  return SEGMENT_CATALOG[id];
}

/** A condição exige um evento no contexto para ser avaliada? */
export function segmentConditionRequiresEvent(id: SegmentConditionId): boolean {
  return SEGMENT_CATALOG[id].requiresEvent;
}

// ───────────────────────────────────────────────────────────────────────────────
//  A frase
// ───────────────────────────────────────────────────────────────────────────────
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/**
 * A frase da condição com os valores no lugar.
 *
 * `labels` permite trocar o valor cru pelo NOME da coisa: `atividade` é um uuid,
 * e "inscritos na atividade 3f2a…" não é frase que se leia. A chave é
 * `<id da condição>:<parâmetro>` — e `<parâmetro>` sozinho serve de reserva,
 * para a tela que já resolveu o rótulo antes.
 *
 * O que não foi informado sai pelo texto `unset` declarado no catálogo. Um `{`
 * que sobrevivesse à substituição seria defeito: há teste prendendo.
 */
export function segmentConditionPhrase(
  id: SegmentConditionId,
  params: SegmentParams = {},
  labels: Readonly<Record<string, string>> = {},
): string {
  const condition = SEGMENT_CATALOG[id];
  const filled = segmentParamsWithDefaults(condition, params);

  return condition.phrase.replace(PLACEHOLDER, (_match, key: string) => {
    const scoped = labels[`${id}:${key}`];
    const generic = labels[key];
    const label = typeof scoped === 'string' && scoped.length > 0 ? scoped : generic;

    if (typeof label === 'string' && label.length > 0) return label;

    const value = filled[key];
    if (value !== undefined) return String(value);

    return condition.parameters.find((parameter) => parameter.key === key)?.unset ?? UNSET_PARAMETER_TEXT;
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Composição: todas as condições valem, e uma exclusão
// ───────────────────────────────────────────────────────────────────────────────
export type SegmentScope = 'condicao' | 'exceto';

export type SegmentIssueCode =
  | 'SEGMENTO_VAZIO'
  | 'CONDICAO_DESCONHECIDA'
  | 'PARAMETRO_INVALIDO'
  | 'CONDICAO_REPETIDA'
  | 'CONDICAO_CONTRADITORIA';

export interface SegmentIssue {
  scope: SegmentScope;
  /** Posição na lista original (0-based). `-1` no "exceto quem…", que é único. */
  index: number;
  code: SegmentIssueCode;
  message: string;
  /** `true` = impede a avaliação. Aviso (`false`) informa e deixa seguir. */
  blocking: boolean;
}

export interface ValidatedSegmentCondition {
  id: SegmentConditionId;
  params: SegmentParams;
}

export interface SegmentDefinition {
  conditions: readonly ValidatedSegmentCondition[];
  except: ValidatedSegmentCondition | null;
}

export type SegmentCompositionCode = 'SEGMENTO_VAZIO' | 'DEFINICAO_INVALIDA';

export interface SegmentComposition {
  /** Falso = NÃO avalie: a seleção não é a que o organizador pediu. */
  ok: boolean;
  code: SegmentCompositionCode | null;
  message: string;
  definition: SegmentDefinition;
  issues: readonly SegmentIssue[];
  /** As frases das condições, na ordem — o que a tela mostra antes de enviar. */
  explanation: readonly string[];
  /** A frase da exclusão, quando há uma. */
  exclusion: string | null;
}

/** Referência crua a uma condição (o que vem do formulário ou do snapshot). */
export interface SegmentConditionInput {
  id?: unknown;
  params?: unknown;
}

function readParams(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** Forma canônica dos parâmetros: é o que decide "condição repetida". */
export function canonicalSegmentParams(params: SegmentParams): string {
  return JSON.stringify(
    Object.entries(params)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, value]) => [key, value]),
  );
}

/** Duas referências pedem exatamente o mesmo filtro? */
export function sameSegmentCondition(
  left: ValidatedSegmentCondition,
  right: ValidatedSegmentCondition,
): boolean {
  return left.id === right.id && canonicalSegmentParams(left.params) === canonicalSegmentParams(right.params);
}

/**
 * Compõe a definição do segmento a partir do que o organizador montou.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS QUATRO BORDAS, E POR QUE CADA UMA RESPONDE ASSIM
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. **Lista vazia** — RECUSA (`SEGMENTO_VAZIO`). "Todas as condições valem" com
 *     zero condições é verdade vazia, e a avaliação de um `E` vazio selecionaria
 *     a instituição INTEIRA. Falhar aberto aqui é o defeito mais caro possível
 *     numa tela de envio;
 *  2. **Parâmetro inválido** (ou não declarado) — a condição é descartada da
 *     avaliação e a composição é RECUSADA. Descartar em silêncio enviaria para
 *     mais gente do que o pedido;
 *  3. **Condição repetida** (mesmo id, mesmos parâmetros) — a segunda é dispensada
 *     com AVISO: `E` é idempotente, e manter as duas só faria a contagem parecer
 *     maior. Mesmo id com parâmetros DIFERENTES são dois filtros de verdade
 *     ("inscrito na atividade A" e "na atividade B") e os dois ficam;
 *  4. **Exclusão inválida** — RECUSA, e a exclusão NÃO é aplicada como nula:
 *     seguir sem ela mandaria a mensagem justamente para quem o organizador
 *     excluiu. Exclusão igual a uma das condições vira AVISO (`CONDICAO_
 *     CONTRADITORIA`): é definição legítima que seleciona ninguém, e a contagem
 *     zero na tela é a resposta.
 */
export function composeSegment(
  input: { conditions?: unknown; except?: unknown },
  options: { labels?: Readonly<Record<string, string>> } = {},
): SegmentComposition {
  const labels = options.labels ?? {};
  const rawConditions = Array.isArray(input.conditions) ? input.conditions : [];
  const issues: SegmentIssue[] = [];
  const conditions: ValidatedSegmentCondition[] = [];
  const explanation: string[] = [];
  const seen = new Set<string>();

  rawConditions.forEach((entry, index) => {
    const reference = (entry ?? {}) as SegmentConditionInput;

    if (!isSegmentConditionId(reference.id)) {
      issues.push({
        scope: 'condicao',
        index,
        code: reference.id === undefined ? 'SEGMENTO_VAZIO' : 'CONDICAO_DESCONHECIDA',
        message:
          reference.id === undefined
            ? 'Escolha uma condição.'
            : `Condição desconhecida: ${String(reference.id)}.`,
        blocking: true,
      });
      return;
    }

    const condition = segmentCondition(reference.id);
    const parsed = parseSegmentParams(condition, readParams(reference.params));

    if (!parsed.ok) {
      issues.push({
        scope: 'condicao',
        index,
        code: 'PARAMETRO_INVALIDO',
        message: `${condition.label}: ${parsed.problems.join(' ')}`,
        blocking: true,
      });
      return;
    }

    const validated: ValidatedSegmentCondition = { id: condition.id, params: parsed.values };
    const key = `${condition.id}|${canonicalSegmentParams(parsed.values)}`;

    if (seen.has(key)) {
      issues.push({
        scope: 'condicao',
        index,
        code: 'CONDICAO_REPETIDA',
        message: `A condição "${condition.label}" já foi escolhida com os mesmos valores — a repetição foi dispensada.`,
        blocking: false,
      });
      return;
    }

    seen.add(key);
    conditions.push(validated);
    explanation.push(segmentConditionPhrase(condition.id, parsed.values, labels));
  });

  const except = readExcept(input.except, issues);

  if (except && conditions.some((condition) => sameSegmentCondition(condition, except))) {
    issues.push({
      scope: 'exceto',
      index: -1,
      code: 'CONDICAO_CONTRADITORIA',
      message: 'A mesma condição está em "exceto quem…": a seleção fica vazia.',
      blocking: false,
    });
  }

  const blocked = issues.some((issue) => issue.blocking);

  /**
   * A ORDEM DAS DUAS RESPOSTAS IMPORTA. Com uma condição inválida, a pergunta do
   * organizador é "o que eu errei no valor?", e não "escolha uma condição" — a
   * definição TEM condição. Por isso a recusa por definição vem antes da recusa
   * por lista vazia; esta última só vale quando não há nada bloqueante (isto é,
   * quando o organizador realmente não escolheu nada).
   */
  if (conditions.length === 0 && !blocked) {
    issues.push({
      scope: 'condicao',
      index: -1,
      code: 'SEGMENTO_VAZIO',
      message: 'Escolha ao menos uma condição: sem condição o segmento selecionaria a instituição inteira.',
      blocking: true,
    });

    return {
      ok: false,
      code: 'SEGMENTO_VAZIO',
      message: 'Escolha ao menos uma condição para montar o segmento.',
      definition: { conditions: [], except: null },
      issues,
      explanation: [],
      exclusion: null,
    };
  }

  if (blocked) {
    return {
      ok: false,
      code: 'DEFINICAO_INVALIDA',
      message: 'Revise as condições e os valores do segmento antes de continuar.',
      definition: { conditions, except },
      issues,
      explanation,
      exclusion: except ? segmentConditionPhrase(except.id, except.params, labels) : null,
    };
  }

  if (conditions.length === 0) {
    return {
      ok: false,
      code: 'SEGMENTO_VAZIO',
      message: 'Escolha ao menos uma condição para montar o segmento.',
      definition: { conditions: [], except: null },
      issues,
      explanation: [],
      exclusion: null,
    };
  }

  return {
    ok: true,
    code: null,
    message: 'Segmento pronto para ser contado.',
    definition: { conditions, except },
    issues,
    explanation,
    exclusion: except ? segmentConditionPhrase(except.id, except.params, labels) : null,
  };
}

function readExcept(value: unknown, issues: SegmentIssue[]): ValidatedSegmentCondition | null {
  if (value === undefined || value === null) return null;

  if (typeof value !== 'object' || Array.isArray(value)) {
    issues.push({
      scope: 'exceto',
      index: -1,
      code: 'PARAMETRO_INVALIDO',
      message: 'O "exceto quem…" aceita uma condição.',
      blocking: true,
    });
    return null;
  }

  const reference = value as SegmentConditionInput;

  if (!isSegmentConditionId(reference.id)) {
    issues.push({
      scope: 'exceto',
      index: -1,
      code: reference.id === undefined ? 'PARAMETRO_INVALIDO' : 'CONDICAO_DESCONHECIDA',
      message:
        reference.id === undefined
          ? 'O "exceto quem…" está vazio: escolha a condição a excluir ou remova a exclusão.'
          : `Condição desconhecida em "exceto quem…": ${String(reference.id)}.`,
      blocking: true,
    });
    return null;
  }

  const condition = segmentCondition(reference.id);
  const parsed = parseSegmentParams(condition, readParams(reference.params));

  if (!parsed.ok) {
    issues.push({
      scope: 'exceto',
      index: -1,
      code: 'PARAMETRO_INVALIDO',
      message: `Exceto — ${condition.label}: ${parsed.problems.join(' ')}`,
      blocking: true,
    });
    return null;
  }

  // A frase da exclusão é montada por quem chamou (tem os rótulos resolvidos).
  return { id: condition.id, params: parsed.values };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Como a lista INTERNA cita a pessoa (F60 · E79)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  QUEM OCULTOU O PERFIL RECEBE A MENSAGEM — E SAI MASCARADO NA TELA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A ocultação da F60 é sobre VISIBILIDADE PÚBLICA, não sobre receber o que é da
 *  instituição da pessoa: quem pediu para sumir da internet continua sendo
 *  participante, e uma campanha sobre a vaga retida dela não é exposição — é o
 *  recado da casa. O que sai é o NOME nas superfícies INTERNAS (prévia, lista do
 *  segmento, CSV), pela mesma régua do ranking de conquistas (E80): abreviado e
 *  reconhecível para quem convive, ilegível para quem só tem o link da tela.
 *
 *  A régua NÃO é reescrita aqui: `isPersonPubliclyVisible` decide e
 *  `maskPersonName` mascara — as duas da fonte única, onde a E79 as juntou.
 */
export interface SegmentRecipientSource {
  name: string;
  /**
   * O efeito da moderação da plataforma. OBRIGATÓRIO de propósito, como no
   * ranking e na vitrine da equipe: um `select` que esqueça a coluna entrega
   * `undefined` e o `tsc` acusa; para o que escapar do tipo, a fonte única
   * responde "não visível" (fail-closed).
   */
  publicProfileHiddenAt: Date | null;
}

export interface SegmentRecipientIdentity {
  name: string;
  /** `true` = o nome saiu pela régua da ocultação. É prova de teste, não de tela. */
  masked: boolean;
}

export function segmentRecipientIdentity(person: SegmentRecipientSource): SegmentRecipientIdentity {
  if (isPersonPubliclyVisible(person)) return { name: person.name, masked: false };

  return { name: maskPersonName(person.name), masked: true };
}
