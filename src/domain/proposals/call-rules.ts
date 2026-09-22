/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Chamadas de propostas (FASE 33)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CHAMADA DEIXOU DE SER SÓ "TRABALHO CIENTÍFICO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até aqui o call for papers era a TRILHA (`Track`): rubrica, cegueira, limite por
 *  autor — e a janela era do EVENTO inteiro. Isso serve para artigo e não serve para
 *  o resto da programação: a chamada de minicurso costuma fechar antes da de artigo,
 *  e a de palestrante costuma ficar aberta depois; e nenhuma das duas quer rubrica
 *  científica com nota ponderada e versão cega.
 *
 *  Este arquivo é o que a chamada passou a ter de próprio: TIPO, JANELA, quais campos
 *  o formulário pede, e como o estado dela se decide — tudo puro, sem banco e sem
 *  tela, para o painel, a página pública e o formulário usarem a MESMA regra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ESTADO É DECIDIDO NA LEITURA (SEM AGENDADOR)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É a decisão das FASES 23/24 aplicada aqui: a chamada ABRE sozinha quando chega a
 *  data, porque quem pergunta "está aberta?" calcula a resposta na hora. Um cron que
 *  "abre a chamada" é uma promessa a mais para falhar em silêncio — e o modo de falha
 *  é o pior possível: a chamada fica fechada com a página dizendo que está aberta.
 *
 *  A janela é interpretada no FUSO DO EVENTO (`callWindowLabel` recebe o texto
 *  digitado), porque o prazo é do evento, não do servidor (armadilha 38).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { instantToZonedWallTime } from '@/domain/events/scheduling-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Tipos de chamada
// ───────────────────────────────────────────────────────────────────────────────
export const PROPOSAL_KINDS = Object.freeze([
  'PAPER',
  'SPEAKER',
  'MINICOURSE',
  'WORKSHOP',
  'ROUNDTABLE',
  'POSTER',
  'OTHER',
] as const);

export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  PAPER: 'Trabalho científico (artigo)',
  SPEAKER: 'Palestrante',
  MINICOURSE: 'Minicurso',
  WORKSHOP: 'Oficina',
  ROUNDTABLE: 'Mesa-redonda',
  POSTER: 'Pôster',
  OTHER: 'Outra atividade',
};

/** Rótulo curto, para etiqueta de lista e filtro. */
export const PROPOSAL_KIND_SHORT_LABELS: Record<ProposalKind, string> = {
  PAPER: 'Artigo',
  SPEAKER: 'Palestrante',
  MINICOURSE: 'Minicurso',
  WORKSHOP: 'Oficina',
  ROUNDTABLE: 'Mesa',
  POSTER: 'Pôster',
  OTHER: 'Outra',
};

/**
 * Tipo de ATIVIDADE que a proposta gera quando o organizador aceita criando a
 * atividade (§ protocolo de aceite). É a ponte entre a chamada e a programação: sem
 * ela, quem aceita um minicurso teria de escolher o tipo de novo, à mão, e a
 * programação nasceria com o tipo errado.
 */
export const PROPOSAL_KIND_ACTIVITY_TYPE: Record<ProposalKind, string> = {
  PAPER: 'ORAL_PRESENTATION',
  SPEAKER: 'LECTURE',
  MINICOURSE: 'MINI_COURSE',
  WORKSHOP: 'WORKSHOP',
  ROUNDTABLE: 'ROUND_TABLE',
  POSTER: 'POSTER_SESSION',
  OTHER: 'OTHER',
};

/** Carga horária sugerida (min) da atividade criada a partir da proposta. */
export const PROPOSAL_KIND_DEFAULT_WORKLOAD: Record<ProposalKind, number> = {
  PAPER: 30,
  SPEAKER: 60,
  MINICOURSE: 120,
  WORKSHOP: 120,
  ROUNDTABLE: 90,
  POSTER: 30,
  OTHER: 60,
};

/**
 * A avaliação por pares é CIENTÍFICA.
 *
 * O aceite de um artigo pede nota ponderada, versão cega e quórum — é o que dá
 * legitimidade à decisão. O convite de um palestrante, não: quem organiza a
 * programação decide olhando a proposta, e exigir dois pareceres cegos para uma
 * palestra institucional é burocracia que empurra a decisão para fora do sistema.
 * Por isso a cegueira nasce LIGADA só para artigo e pôster, e a chamada pode mudar.
 */
export const PROPOSAL_KIND_BLIND_BY_DEFAULT: Record<ProposalKind, boolean> = {
  PAPER: true,
  SPEAKER: false,
  MINICOURSE: false,
  WORKSHOP: false,
  ROUNDTABLE: false,
  POSTER: true,
  OTHER: false,
};

/** A cegueira nasce ligada neste tipo? (ver `PROPOSAL_KIND_BLIND_BY_DEFAULT`.) */
export function defaultBlindFor(kind: ProposalKind): boolean {
  return PROPOSAL_KIND_BLIND_BY_DEFAULT[kind];
}

/** A chamada tem público externo? Todas têm — mas artigo é o caso central. */
export function isScientific(kind: ProposalKind): boolean {
  return kind === 'PAPER' || kind === 'POSTER';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Campos específicos por tipo
// ───────────────────────────────────────────────────────────────────────────────
export const PROPOSAL_TEXT_MAX = 300;
export const PROPOSAL_LONG_TEXT_MAX = 1_200;
export const MINICOURSE_WORKLOAD_MIN = 30;
export const MINICOURSE_WORKLOAD_MAX = 720;
export const ROUNDTABLE_DURATION_MIN = 30;
export const ROUNDTABLE_DURATION_MAX = 240;

export type ProposalFieldKey =
  | 'workloadMinutes'
  | 'targetAudience'
  | 'prerequisites'
  | 'bio'
  | 'topics'
  | 'availability'
  | 'format'
  | 'durationMinutes';

export interface ProposalFieldSpec {
  key: ProposalFieldKey;
  label: string;
  help?: string;
  /** `NUMBER` vira número na gravação; os outros, texto aparado. */
  input: 'TEXT' | 'LONG_TEXT' | 'NUMBER';
  required: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
}

/**
 * O que cada tipo pede ALÉM do comum.
 *
 * Comum a todas: título, resumo, proponente (nome e e-mail), instituição e,
 * opcionalmente, arquivo. O que muda é o que a ORGANIZAÇÃO precisa saber para
 * decidir: sem carga horária e público-alvo, um minicurso aceito volta por e-mail
 * três dias depois pedindo exatamente esses dois números.
 */
export const PROPOSAL_KIND_FIELDS: Record<ProposalKind, readonly ProposalFieldSpec[]> = {
  PAPER: [],
  POSTER: [],
  SPEAKER: [
    {
      key: 'bio',
      label: 'Minibiografia',
      help: 'Como o público deve conhecer você (aparece na vitrine do evento).',
      input: 'LONG_TEXT',
      required: true,
      maxLength: PROPOSAL_LONG_TEXT_MAX,
    },
    {
      key: 'topics',
      label: 'Temas que pretende abordar',
      input: 'TEXT',
      required: true,
      maxLength: PROPOSAL_TEXT_MAX,
    },
    {
      key: 'availability',
      label: 'Disponibilidade de datas',
      help: 'Opcional: restrições de agenda que a organização precisa respeitar.',
      input: 'TEXT',
      required: false,
      maxLength: PROPOSAL_TEXT_MAX,
    },
  ],
  MINICOURSE: [
    {
      key: 'workloadMinutes',
      label: 'Carga horária (min)',
      input: 'NUMBER',
      required: true,
      min: MINICOURSE_WORKLOAD_MIN,
      max: MINICOURSE_WORKLOAD_MAX,
    },
    {
      key: 'targetAudience',
      label: 'Público-alvo',
      input: 'TEXT',
      required: true,
      maxLength: PROPOSAL_TEXT_MAX,
    },
    {
      key: 'prerequisites',
      label: 'Pré-requisitos',
      input: 'TEXT',
      required: false,
      maxLength: PROPOSAL_TEXT_MAX,
    },
  ],
  WORKSHOP: [
    {
      key: 'workloadMinutes',
      label: 'Carga horária (min)',
      input: 'NUMBER',
      required: true,
      min: MINICOURSE_WORKLOAD_MIN,
      max: MINICOURSE_WORKLOAD_MAX,
    },
    {
      key: 'targetAudience',
      label: 'Público-alvo',
      input: 'TEXT',
      required: true,
      maxLength: PROPOSAL_TEXT_MAX,
    },
    {
      key: 'prerequisites',
      label: 'Materiais e pré-requisitos',
      input: 'TEXT',
      required: false,
      maxLength: PROPOSAL_TEXT_MAX,
    },
  ],
  ROUNDTABLE: [
    {
      key: 'format',
      label: 'Formato da mesa',
      help: 'Ex.: 4 debatedores e 1 mediador, 90 minutos com perguntas.',
      input: 'TEXT',
      required: true,
      maxLength: PROPOSAL_TEXT_MAX,
    },
    {
      key: 'durationMinutes',
      label: 'Duração (min)',
      input: 'NUMBER',
      required: true,
      min: ROUNDTABLE_DURATION_MIN,
      max: ROUNDTABLE_DURATION_MAX,
    },
  ],
  OTHER: [
    {
      key: 'format',
      label: 'Formato da atividade',
      input: 'TEXT',
      required: true,
      maxLength: PROPOSAL_TEXT_MAX,
    },
    {
      key: 'durationMinutes',
      label: 'Duração (min)',
      input: 'NUMBER',
      required: false,
      min: 15,
      max: 480,
    },
  ],
};

export function proposalFieldsFor(kind: ProposalKind): readonly ProposalFieldSpec[] {
  return PROPOSAL_KIND_FIELDS[kind];
}

/** Campo que o tipo trata como carga horária/duração — o que vira a atividade. */
export function proposedWorkload(kind: ProposalKind, data: Record<string, string | number>): number {
  const raw = data.workloadMinutes ?? data.durationMinutes;

  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);

  return PROPOSAL_KIND_DEFAULT_WORKLOAD[kind];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Validação dos campos por tipo
// ───────────────────────────────────────────────────────────────────────────────
export type ProposalDataValidation =
  | { ok: true; data: Record<string, string | number> }
  | { ok: false; code: 'MISSING_FIELD' | 'INVALID_FIELD'; field: ProposalFieldKey; message: string };

/**
 * Valida os campos DO TIPO e devolve só o que foi aceito.
 *
 * Devolver o objeto normalizado (e não o formulário cru) é o que impede um campo
 * inventado no `FormData` de virar dado no `proposalData`: o que não está na
 * especificação do tipo não entra.
 */
export function validateProposalData(input: {
  kind: ProposalKind;
  data: Record<string, unknown>;
}): ProposalDataValidation {
  const normalized: Record<string, string | number> = {};

  for (const field of proposalFieldsFor(input.kind)) {
    const raw = input.data[field.key];

    if (field.input === 'NUMBER') {
      const isEmpty = raw === undefined || raw === null || raw === '';
      const value = isEmpty ? null : Number(raw);

      if (isEmpty || value === null || !Number.isFinite(value)) {
        if (field.required) {
          return {
            ok: false,
            code: 'MISSING_FIELD',
            field: field.key,
            message: `Informe ${field.label.toLowerCase()}.`,
          };
        }

        continue;
      }

      const truncated = Math.trunc(value);

      if ((field.min !== undefined && truncated < field.min) || (field.max !== undefined && truncated > field.max)) {
        return {
          ok: false,
          code: 'INVALID_FIELD',
          field: field.key,
          message: `${field.label} deve ficar entre ${field.min} e ${field.max}.`,
        };
      }

      normalized[field.key] = truncated;
      continue;
    }

    const text = typeof raw === 'string' ? raw.trim() : '';

    if (text.length === 0) {
      if (field.required) {
        return {
          ok: false,
          code: 'MISSING_FIELD',
          field: field.key,
          message: `Informe ${field.label.toLowerCase()}.`,
        };
      }

      continue;
    }

    if (field.maxLength !== undefined && text.length > field.maxLength) {
      return {
        ok: false,
        code: 'INVALID_FIELD',
        field: field.key,
        message: `${field.label} deve ter no máximo ${field.maxLength} caracteres.`,
      };
    }

    normalized[field.key] = text;
  }

  return { ok: true, data: normalized };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Estado da chamada (decidido na leitura)
// ───────────────────────────────────────────────────────────────────────────────
export const CALL_STATES = Object.freeze(['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED'] as const);

export type CallState = (typeof CALL_STATES)[number];

export const CALL_STATE_LABELS: Record<CallState, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendada',
  OPEN: 'Aberta',
  CLOSED: 'Encerrada',
};

export interface CallWindow {
  isPublished: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
  now: Date;
}

/**
 * O estado da chamada, calculado.
 *
 * A ordem importa: publicada é o primeiro portão (uma chamada não publicada não
 * abre, mesmo dentro da janela), e o fechamento vence a abertura quando as duas
 * datas estão no passado — uma chamada cuja janela inteira passou está ENCERRADA,
 * não "agendada".
 */
export function callStateOf(window: CallWindow): CallState {
  if (!window.isPublished) return 'DRAFT';

  if (window.opensAt && window.now.getTime() < window.opensAt.getTime()) return 'SCHEDULED';

  if (window.closesAt && window.now.getTime() >= window.closesAt.getTime()) return 'CLOSED';

  return 'OPEN';
}

export function isCallOpen(window: CallWindow): boolean {
  return callStateOf(window) === 'OPEN';
}

export type CallWindowValidation =
  | { ok: true }
  | { ok: false; code: 'INVALID_WINDOW'; message: string };

/**
 * A janela faz sentido?
 *
 * Um término ANTES da abertura produz uma chamada que nunca abre — e o modo de
 * falha é silencioso: o painel mostra "agendada", a página pública não mostra nada,
 * e ninguém entende por quê. Também recusa término igual à abertura (janela de
 * duração zero): aberta e encerrada no mesmo instante é sempre engano de digitação.
 */
export function validateCallWindow(input: {
  opensAt: Date | null;
  closesAt: Date | null;
}): CallWindowValidation {
  if (!input.opensAt || !input.closesAt) return { ok: true };

  if (input.closesAt.getTime() <= input.opensAt.getTime()) {
    return {
      ok: false,
      code: 'INVALID_WINDOW',
      message: 'O prazo final precisa ser depois da abertura da chamada.',
    };
  }

  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Submissão permitida?
// ───────────────────────────────────────────────────────────────────────────────
export type ProposalRefusalCode =
  | 'CALL_NOT_PUBLISHED'
  | 'CALL_NOT_OPEN'
  | 'CALL_CLOSED'
  | 'AUTHOR_LIMIT_REACHED';

export type ProposalPermission =
  | { ok: true }
  | { ok: false; code: ProposalRefusalCode; message: string };

/**
 * Decide se ESTA pessoa pode propor NESTA chamada NESTE instante.
 *
 * O limite por autor conta as propostas **não canceladas nem recusadas** do autor
 * NAQUELA chamada — não no evento. É o que a chamada promete ("até 2 propostas por
 * pessoa nesta chamada"), e contar no evento faria o limite de uma chamada consumir
 * a cota da outra.
 */
export function canSubmitToCall(input: {
  call: CallWindow & { maxSubmissionsPerAuthor: number; title: string };
  authorSubmissions: number;
}): ProposalPermission {
  const state = callStateOf(input.call);

  if (state === 'DRAFT') {
    return {
      ok: false,
      code: 'CALL_NOT_PUBLISHED',
      message: 'Esta chamada ainda não foi publicada.',
    };
  }

  if (state === 'SCHEDULED') {
    return { ok: false, code: 'CALL_NOT_OPEN', message: 'Esta chamada ainda não está aberta.' };
  }

  if (state === 'CLOSED') {
    return { ok: false, code: 'CALL_CLOSED', message: 'Esta chamada está encerrada.' };
  }

  const limit = Math.max(0, Math.trunc(input.call.maxSubmissionsPerAuthor));

  if (limit > 0 && input.authorSubmissions >= limit) {
    return {
      ok: false,
      code: 'AUTHOR_LIMIT_REACHED',
      message:
        limit === 1
          ? 'Você já enviou uma proposta para esta chamada.'
          : `Você já atingiu o limite de ${limit} propostas nesta chamada.`,
    };
  }

  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Texto da janela e contagem
// ───────────────────────────────────────────────────────────────────────────────
/** `2026-09-30T23:59` (hora de parede do evento) → `30/09/2026 às 23:59`. */
export function formatCallInstant(instant: Date, timeZone: string): string {
  const wall = instantToZonedWallTime(instant, timeZone);
  const [day = '', time = ''] = wall.split('T');

  return `${day.split('-').reverse().join('/')} às ${time}`;
}

/**
 * A frase da janela, montada no SERVIDOR.
 *
 * A página pública não escolhe texto: com uma data só ela diz "a partir de", com as
 * duas diz o intervalo, e sem data nenhuma diz que não há prazo. Assim o que aparece
 * no bloco, na página da chamada e no painel é sempre a mesma frase — e no fuso do
 * evento (armadilha 38).
 */
export function callWindowLabel(input: {
  opensAt: Date | null;
  closesAt: Date | null;
  timeZone: string;
}): string {
  const opens = input.opensAt ? formatCallInstant(input.opensAt, input.timeZone) : null;
  const closes = input.closesAt ? formatCallInstant(input.closesAt, input.timeZone) : null;

  if (opens && closes) return `De ${opens} até ${closes}`;
  if (opens) return `A partir de ${opens}`;
  if (closes) return `Até ${closes}`;

  return 'Sem prazo definido';
}

export const LAST_DAY_HOURS = 24;

/** "fecha em 3 dias", "último dia", "encerrada" — o número, não a impressão. */
export function callCountdown(input: { closesAt: Date | null; now: Date }): string | null {
  if (!input.closesAt) return null;

  const remaining = input.closesAt.getTime() - input.now.getTime();

  if (remaining <= 0) return 'encerrada';

  const hours = Math.floor(remaining / 3_600_000);

  if (hours < LAST_DAY_HOURS) {
    const minutes = Math.max(1, Math.floor(remaining / 60_000));

    return hours >= 1 ? `fecha em ${hours}h` : `fecha em ${minutes} min`;
  }

  const days = Math.ceil(hours / 24);

  return days === 1 ? 'fecha amanhã' : `fecha em ${days} dias`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Protocolo de aceite
// ───────────────────────────────────────────────────────────────────────────────
export const ACTIVITY_TITLE_MAX = 300;
export const INVITE_REQUIRES_EMAIL = 'Sem e-mail não há como convidar: complete o cadastro do proponente.';

export interface AcceptancePlanInput {
  /** Criar a atividade na programação a partir da proposta? */
  createActivity: boolean;
  /** Convidar o proponente como palestrante? */
  inviteSpeaker: boolean;
  /** A atividade pede tipo, início e término — não há como inventar agenda. */
  activityType?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  speakerEmail: string | null;
  speakerName: string | null;
}

export type AcceptancePlan =
  | { ok: true; createActivity: boolean; inviteSpeaker: boolean }
  | { ok: false; code: 'MISSING_SCHEDULE' | 'MISSING_EMAIL' | 'INVALID_SCHEDULE'; message: string };

/**
 * Valida o que o organizador ESCOLHEU fazer no aceite (a decisão do humano nesta
 * fase: criar a atividade e convidar são escolhas, não consequências automáticas).
 *
 * As duas recusas existem porque as duas coisas quebram em silêncio: criar atividade
 * sem agenda gravaria uma atividade em 1970, e "convidar" quem não tem e-mail geraria
 * um convite que nunca chega — nos dois casos a tela diria que deu certo.
 */
export function planAcceptance(input: AcceptancePlanInput): AcceptancePlan {
  if (input.createActivity) {
    const { activityType, startsAt, endsAt } = input;

    if (!activityType || !startsAt || !endsAt) {
      return {
        ok: false,
        code: 'MISSING_SCHEDULE',
        message: 'Para criar a atividade, informe tipo, início e término — sem agenda ela não entra na programação.',
      };
    }

    if (endsAt.getTime() <= startsAt.getTime()) {
      return {
        ok: false,
        code: 'INVALID_SCHEDULE',
        message: 'O término da atividade precisa ser depois do início.',
      };
    }
  }

  if (input.inviteSpeaker && !input.speakerEmail) {
    return { ok: false, code: 'MISSING_EMAIL', message: INVITE_REQUIRES_EMAIL };
  }

  if (input.inviteSpeaker && !input.speakerName) {
    return { ok: false, code: 'MISSING_EMAIL', message: 'Sem o nome do proponente não há convite a enviar.' };
  }

  return { ok: true, createActivity: input.createActivity, inviteSpeaker: input.inviteSpeaker };
}

/** Título da atividade a partir da proposta (o título do formulário é longo). */
export function activityTitleFromProposal(title: string): string {
  const trimmed = title.trim();

  if (trimmed.length <= ACTIVITY_TITLE_MAX) return trimmed;

  return `${trimmed.slice(0, ACTIVITY_TITLE_MAX - 1).trimEnd()}…`;
}
