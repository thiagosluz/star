/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Avaliação de um segmento sob `withTenant` (FASE 67 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UM CONSTRUTOR DE CONSULTA POR CONDIÇÃO, E UMA CATRACA ENTRE OS DOIS LADOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O catálogo (`@/domain/communication/segments`) diz o que cada condição
 *  SELECIONA; aqui vive o que cada condição CONSULTA. São duas listas que não
 *  podem divergir: condição sem construtor é filtro que não filtra (e o envio
 *  sairia para mais gente), construtor sem condição é consulta órfã que ninguém
 *  consegue explicar.
 *
 *  A catraca é o TIPO: `SEGMENT_BUILDERS` é `Record<SegmentConditionId, …>`, então
 *  o `tsc` reprova a condição sem construtor E o construtor sem condição — e o
 *  teste de unidade confere as mesmas duas direções em tempo de execução, para o
 *  caso de alguém afrouxar o tipo com um `as`. É o mesmo desenho do catálogo de
 *  rotinas (`JOB_CATALOG` com `JOB_KEYS`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TABELA `user` É GLOBAL — A RLS NÃO A PROTEGE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A policy de identidade libera a leitura de `user` a QUALQUER contexto de
 *  instituição (senão listar a equipe seria impossível). Então toda consulta
 *  daqui carrega a CERCA da instituição — vínculo ativo OU inscrição —, aplicada
 *  em UM lugar (`institutionFence`), além do `tenantId` em cada relação. É a mesma
 *  lição da FASE 32 (a ficha confere pertencimento antes de ler qualquer seção):
 *  um filtro esquecido num construtor não pode virar vazamento entre casas.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DATA E A HORA VÊM DA RÉGUA QUE JÁ EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A janela da condição "presente de manhã, ausente à tarde" é montada com
 *  `zonedWallTimeToInstant` (o mesmo conversor hora-de-parede → instante da FASE
 *  24) e o dia padrão sai de `localDayKey` (o dia local de um instante). Escrever
 *  uma segunda conversão de fuso aqui produziria duas respostas para "que horas
 *  são no evento", e a segunda estaria errada no horário de verão.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from '#db/prisma-client';

import { errorMessage } from '@/lib/db/prisma-errors';
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { localDayKey } from '@/domain/events/demand-rules';
import { isValidTimeZone, zonedWallTimeToInstant } from '@/domain/events/scheduling-rules';
import { summarizeUnsubscribeReasons } from '@/domain/communication/unsubscribe-reason-rules';
import {
  SEGMENT_CATALOG,
  SEGMENT_CONDITION_IDS,
  composeSegment,
  isSegmentConditionId,
  segmentCondition,
  segmentConditionPhrase,
  segmentRecipientIdentity,
  type SegmentConditionId,
  type SegmentDefinition,
  type SegmentParams,
  type ValidatedSegmentCondition,
  type SegmentRecipientIdentity,
} from '@/domain/communication/segments';

type SegmentWhere = Prisma.UserWhereInput;

export type SegmentFailureCode =
  | 'NOT_FOUND'
  | 'INVALID_SEGMENT'
  | 'EVENT_REQUIRED'
  | 'EVENT_CONTEXT'
  | 'INTERNAL';

export type SegmentResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: SegmentFailureCode; message: string; details?: readonly string[] };

/**
 * Contexto da avaliação. `eventId` é NULO na campanha da instituição inteira — e
 * as condições que recortam por evento exigem um (`requiresEvent`).
 */
export interface SegmentContext {
  tenantId: string;
  eventId: string | null;
  /** Fuso do EVENTO. Nulo quando não há evento. */
  timezone: string | null;
  /** Início do evento: é o dia padrão das janelas de horário. */
  eventStartsAt: Date | null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Listas de estado que as consultas usam
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Inscrição VIVA — a mesma lista do índice único parcial de `registrations`
 * (armadilha 103). Cancelada é terminal e fica de fora; usá-la aqui faria quem
 * cancelou voltar a receber como se tivesse vaga.
 */
const LIVE_REGISTRATION_STATUSES = ['PENDING', 'CONFIRMED', 'WAITLISTED', 'ATTENDED'] as const;

/**
 * Quem tem (ou teve) VAGA. A lista de espera tem condição própria — misturá-la
 * aqui faria "inscritos na atividade" incluir quem ainda não conseguiu lugar.
 */
const SEATED_REGISTRATION_STATUSES = ['PENDING', 'CONFIRMED', 'ATTENDED'] as const;

/** Certificado que conta como "já tem": pedido em andamento e emitido. */
const ACTIVE_CERTIFICATE_STATUSES = ['QUEUED', 'GENERATING', 'ISSUED'] as const;

/** Parecer que ainda não foi enviado: convite aceito ou trabalho em andamento. */
const PENDING_REVIEW_STATUSES = ['INVITED', 'ACCEPTED', 'IN_PROGRESS'] as const;

// ───────────────────────────────────────────────────────────────────────────────
//  Os construtores
// ───────────────────────────────────────────────────────────────────────────────
interface SegmentBuildInput {
  context: SegmentContext;
  params: SegmentParams;
  tx: TxClient;
}

/** O mesmo contexto, com o evento GARANTIDO — o que as condições de evento veem. */
type EventScopedBuildInput = SegmentBuildInput & { eventId: string };

type SegmentBuildResult =
  | { ok: true; where: SegmentWhere }
  | { ok: false; code: SegmentFailureCode; message: string };

type SegmentBuilder = (input: SegmentBuildInput) => Promise<SegmentBuildResult>;

function where(value: SegmentWhere): SegmentBuildResult {
  return { ok: true, where: value };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A CONDIÇÃO DE EVENTO NÃO RODA SEM EVENTO — E ELA MESMA SE DEFENDE
 * ─────────────────────────────────────────────────────────────────────────────
 *  O avaliador já recusa a definição inteira quando falta evento, mas a garantia
 *  fica AQUI também: um filtro montado com `eventId` nulo selecionaria ninguém (a
 *  coluna é NOT NULL) e o defeito apareceria como "a campanha não alcançou
 *  ninguém" — silencioso e caro. Este envoltório troca o nulo por uma recusa com
 *  motivo, e é o que permite às condições abaixo receberem `eventId` como string.
 */
function eventScoped(
  builder: (input: EventScopedBuildInput) => Promise<SegmentBuildResult>,
): SegmentBuilder {
  return async (input) => {
    if (!input.context.eventId) {
      return {
        ok: false,
        code: 'EVENT_REQUIRED',
        message: 'Esta condição recorta por evento: escolha o evento da campanha.',
      };
    }

    return builder({ ...input, eventId: input.context.eventId });
  };
}

function uuidParam(params: SegmentParams, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' ? value : null;
}

/**
 * A CERCA da instituição: a pessoa aparece nesta casa por VÍNCULO ou por
 * INSCRIÇÃO (a mesma união do diretório da FASE 32).
 */
function institutionFence(tenantId: string): SegmentWhere {
  return {
    OR: [
      { memberships: { some: { tenantId, deletedAt: null, status: { not: 'REMOVED' } } } },
      { registrations: { some: { tenantId, deletedAt: null } } },
    ],
  };
}

/** O dia local do evento, quando o organizador não escolheu um. */
function defaultDay(context: SegmentContext): string | null {
  if (!context.eventStartsAt || !context.timezone || !isValidTimeZone(context.timezone)) return null;
  return localDayKey(context.eventStartsAt, context.timezone);
}

/**
 * Converte um par (dia, hora) do fuso do EVENTO no instante correspondente.
 *
 * `fimDoDia` existe para a janela da tarde sem hora declarada: o limite passa a
 * ser a virada do dia, em vez de "23:59" — que perderia o check-in do último
 * minuto por um arredondamento que ninguém escolheu.
 */
function instantOf(day: string, time: string, timeZone: string): Date | null {
  return zonedWallTimeToInstant(`${day}T${time}`, timeZone);
}

function nextDay(day: string): string {
  const base = new Date(`${day}T00:00:00.000Z`);
  return new Date(base.getTime() + 86_400_000).toISOString().slice(0, 10);
}

/**
 * O mapa CONSTITUI a catraca: `Record<SegmentConditionId, …>` obriga o `tsc` a
 * exigir exatamente as condições do catálogo — nem uma a menos, nem uma a mais.
 */
export const SEGMENT_BUILDERS: Record<SegmentConditionId, SegmentBuilder> = {
  'inscricao-sem-confirmacao': eventScoped(async ({ context, eventId, params }) =>
    where({
      registrations: {
        some: {
          tenantId: context.tenantId,
          eventId,
          deletedAt: null,
          status: 'PENDING',
          ...(uuidParam(params, 'atividade') ? { activityId: uuidParam(params, 'atividade') } : {}),
        },
      },
    }),
  ),

  'inscricao-em-espera': eventScoped(async ({ context, eventId, params }) =>
    where({
      registrations: {
        some: {
          tenantId: context.tenantId,
          eventId,
          deletedAt: null,
          status: 'WAITLISTED',
          ...(uuidParam(params, 'atividade') ? { activityId: uuidParam(params, 'atividade') } : {}),
        },
      },
    }),
  ),

  'inscricao-cancelada': eventScoped(async ({ context, eventId, params }) =>
    where({
      registrations: {
        some: {
          tenantId: context.tenantId,
          eventId,
          deletedAt: null,
          status: 'CANCELED',
          ...(uuidParam(params, 'atividade') ? { activityId: uuidParam(params, 'atividade') } : {}),
        },
      },
    }),
  ),

  'presenca-manha-sem-tarde': eventScoped(async ({ context, eventId, params }) => {
    const timeZone = context.timezone;

    if (!timeZone || !isValidTimeZone(timeZone)) {
      return {
        ok: false,
        code: 'EVENT_CONTEXT',
        message: 'O fuso do evento é inválido: a janela de horário não pode ser calculada.',
      };
    }

    const day = typeof params.dia === 'string' ? params.dia : defaultDay(context);

    if (!day) {
      return {
        ok: false,
        code: 'EVENT_CONTEXT',
        message: 'O evento não tem data de início: informe o dia da janela.',
      };
    }

    const morningEnd = instantOf(day, typeof params.manha === 'string' ? params.manha : '12:00', timeZone);
    const afternoonEnd =
      typeof params.tarde === 'string'
        ? instantOf(day, params.tarde, timeZone)
        : instantOf(nextDay(day), '00:00', timeZone);
    const dayStart = instantOf(day, '00:00', timeZone);

    if (!morningEnd || !afternoonEnd || !dayStart) {
      return {
        ok: false,
        code: 'EVENT_CONTEXT',
        message: 'Não foi possível converter a janela de horário no fuso do evento.',
      };
    }

    return where({
      attendances: {
        some: { tenantId: context.tenantId, eventId, checkedInAt: { gte: dayStart, lt: morningEnd } },
      },
      /**
       * `NOT { some }` é o "não voltou à tarde" — a negação é da EXISTÊNCIA de um
       * check-in na janela, e não da presença: quem entrou de manhã e saiu à tarde
       * conta como tendo voltado (a saída é consequência da entrada).
       */
      NOT: {
        attendances: {
          some: {
            tenantId: context.tenantId,
            eventId,
            checkedInAt: { gte: morningEnd, lt: afternoonEnd },
          },
        },
      },
    });
  }),

  'nunca-credenciado': eventScoped(async ({ context, eventId, params }) =>
    where({
      registrations: {
        some: {
          tenantId: context.tenantId,
          eventId,
          deletedAt: null,
          status: { in: [...LIVE_REGISTRATION_STATUSES] },
          ...(uuidParam(params, 'atividade') ? { activityId: uuidParam(params, 'atividade') } : {}),
        },
      },
      attendances: { none: { tenantId: context.tenantId, eventId } },
    }),
  ),

  'minutos-abaixo': eventScoped(async ({ context, eventId, params, tx }) => {
    /**
     * Soma por pessoa exige agregação, e uma relação do Prisma não agrega. A
     * contagem sai em SQL — com `LEFT JOIN` para que quem NUNCA fez check-in
     * apareça com zero minuto, que é o que a frase promete.
     */
    const minutes = typeof params.minutos === 'number' ? params.minutos : 0;
    const activityId = uuidParam(params, 'atividade');

    const rows = await tx.$queryRaw<{ userId: string }[]>`
      SELECT r."userId" AS "userId"
        FROM registrations r
        LEFT JOIN (
          SELECT a."userId" AS "userId", SUM(COALESCE(a."minutesAttended", 0)) AS "minutos"
            FROM attendances a
           WHERE a."tenantId" = ${context.tenantId}::uuid
             AND a."eventId" = ${eventId}::uuid
             AND (${activityId}::uuid IS NULL OR a."activityId" = ${activityId}::uuid)
           GROUP BY a."userId"
        ) soma ON soma."userId" = r."userId"
       WHERE r."tenantId" = ${context.tenantId}::uuid
         AND r."eventId" = ${eventId}::uuid
         AND r."deletedAt" IS NULL
         AND r."status" IN ('PENDING', 'CONFIRMED', 'WAITLISTED', 'ATTENDED')
       GROUP BY r."userId", soma."minutos"
      HAVING COALESCE(soma."minutos", 0) < ${minutes}
    `;

    return where({ id: { in: rows.map((row) => row.userId) } });
  }),

  'autor-aprovado-sem-material': eventScoped(async ({ context, eventId, params, tx }) => {
    /**
     * O material de apoio (`speaker_materials`) pende da ATIVIDADE e do PERFIL do
     * palestrante — não da submissão. A consulta percorre as duas formas de
     * autoria (autor principal e coautor com conta) e só seleciona quem tem
     * submissão aprovada COM atividade: sem atividade não existe onde o material
     * viver, e apontar essa gente produziria um "envie seu material" sem destino.
     */
    const trackId = uuidParam(params, 'trilha');

    const rows = await tx.$queryRaw<{ userId: string }[]>`
      SELECT DISTINCT autor."userId" AS "userId"
        FROM (
          SELECT s."submittedById" AS "userId", s."activityId" AS "activityId"
            FROM submissions s
           WHERE s."tenantId" = ${context.tenantId}::uuid
             AND s."eventId" = ${eventId}::uuid
             AND s."status" = 'ACCEPTED'
             AND s."deletedAt" IS NULL
             AND s."activityId" IS NOT NULL
             AND (${trackId}::uuid IS NULL OR s."trackId" = ${trackId}::uuid)
          UNION
          SELECT sa."userId" AS "userId", s."activityId" AS "activityId"
            FROM submissions s
            JOIN submission_authors sa ON sa."submissionId" = s."id"
           WHERE s."tenantId" = ${context.tenantId}::uuid
             AND s."eventId" = ${eventId}::uuid
             AND s."status" = 'ACCEPTED'
             AND s."deletedAt" IS NULL
             AND s."activityId" IS NOT NULL
             AND sa."userId" IS NOT NULL
             AND (${trackId}::uuid IS NULL OR s."trackId" = ${trackId}::uuid)
        ) autor
       WHERE NOT EXISTS (
         SELECT 1
           FROM speaker_materials m
           LEFT JOIN speaker_profiles p ON p."id" = m."speakerProfileId"
          WHERE m."tenantId" = ${context.tenantId}::uuid
            AND m."deletedAt" IS NULL
            AND m."activityId" = autor."activityId"
            /**
             * Duas formas de o material ser DA PESSOA, e as duas valem: o perfil
             * reivindicado por ela e o envio feito por ela. Ficar só no perfil
             * diria "você não enviou" a quem enviou de um perfil ainda não
             * vinculado — e essa é a única mensagem que não se pode errar aqui.
             */
            AND (p."userId" = autor."userId" OR m."uploadedById" = autor."userId")
       )
    `;

    return where({ id: { in: rows.map((row) => row.userId) } });
  }),

  'revisor-com-parecer-pendente': eventScoped(async ({ context, eventId, params }) =>
    where({
      reviewAssignments: {
        some: {
          tenantId: context.tenantId,
          status: { in: [...PENDING_REVIEW_STATUSES] },
          submission: {
            eventId,
            deletedAt: null,
            ...(uuidParam(params, 'trilha') ? { trackId: uuidParam(params, 'trilha') } : {}),
          },
        },
      },
    }),
  ),

  'proposta-em-rascunho': eventScoped(async ({ context, eventId, params }) =>
    where({
      submissions: {
        some: {
          tenantId: context.tenantId,
          eventId,
          deletedAt: null,
          status: 'DRAFT',
          /** Sem chamada escolhida, "proposta" é toda submissão nascida de uma. */
          callId: uuidParam(params, 'chamada') ?? { not: null },
        },
      },
    }),
  ),

  'inscrito-na-atividade': eventScoped(async ({ context, eventId, params }) => {
    const activityId = uuidParam(params, 'atividade');
    if (!activityId) return missingRequired('atividade', 'Escolha a atividade.');

    return where({
      registrations: {
        some: {
          tenantId: context.tenantId,
          eventId,
          activityId,
          deletedAt: null,
          status: { in: [...SEATED_REGISTRATION_STATUSES] },
        },
      },
    });
  }),

  'inscrito-na-sala': eventScoped(async ({ context, eventId, params }) => {
    const roomId = uuidParam(params, 'sala');
    if (!roomId) return missingRequired('sala', 'Escolha a sala.');

    return where({
      registrations: {
        some: {
          tenantId: context.tenantId,
          eventId,
          deletedAt: null,
          status: { in: [...SEATED_REGISTRATION_STATUSES] },
          activity: { roomId },
        },
      },
    });
  }),

  'presenca-sem-certificado': eventScoped(async ({ context, eventId }) =>
    where({
      attendances: { some: { tenantId: context.tenantId, eventId } },
      certificates: {
        none: {
          tenantId: context.tenantId,
          eventId,
          status: { in: [...ACTIVE_CERTIFICATE_STATUSES] },
        },
      },
    }),
  ),

  'perfil-incompleto': async () => where({ OR: [{ image: null }, { bio: null }] }),

  'xp-acima': async ({ context, params }) =>
    where({
      xpProfiles: {
        some: {
          tenantId: context.tenantId,
          totalXp: { gte: typeof params.xp === 'number' ? params.xp : 0 },
        },
      },
    }),

  'carta-conquistada': async ({ context, params }) => {
    const cardTemplateId = uuidParam(params, 'carta');
    if (!cardTemplateId) return missingRequired('carta', 'Escolha a carta.');

    return where({ cards: { some: { tenantId: context.tenantId, cardTemplateId } } });
  },
};

/**
 * O parâmetro obrigatório que chegou sem valor.
 *
 * A composição já recusa antes (e é ela que a tela usa), mas o construtor não
 * pode montar filtro com nulo: `{ activityId: null }` no Prisma casa com as
 * inscrições SEM atividade, ou seja, selecionaria exatamente quem não devia.
 */
function missingRequired(key: string, message: string): SegmentBuildResult {
  return { ok: false, code: 'INVALID_SEGMENT', message: `${message} (parâmetro "${key}" ausente.)` };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Rótulos: o uuid vira nome na frase
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O começo de cada cláusula, por (condição, parâmetro).
 *
 * A frase é escrita para receber a CLÁUSULA INTEIRA ("na atividade Robótica"), e
 * não só o nome: cada preposição depende da frase em volta ("inscrito NA
 * atividade", "lista de espera DA atividade"), e a alternativa — montar a
 * preposição dentro do template — produziria "na atividade na atividade" no dia
 * em que o rótulo já viesse com ela.
 */
const PARAM_CLAUSE_PREFIX: Readonly<Record<string, string>> = {
  'inscricao-sem-confirmacao:atividade': 'na atividade',
  'inscricao-em-espera:atividade': 'da atividade',
  'inscricao-cancelada:atividade': 'na atividade',
  'nunca-credenciado:atividade': 'na atividade',
  'minutos-abaixo:atividade': 'na atividade',
  'inscrito-na-atividade:atividade': 'na atividade',
  'inscrito-na-sala:sala': 'na sala',
  'autor-aprovado-sem-material:trilha': 'na trilha',
  'revisor-com-parecer-pendente:trilha': 'na trilha',
  'proposta-em-rascunho:chamada': 'na chamada',
  'carta-conquistada:carta': '',
  'presenca-manha-sem-tarde:dia': 'em',
};

/** `15/03/2027` a partir de `2027-03-15` (o dia já está no fuso do evento). */
function dayLabel(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

async function resolveSegmentLabels(
  tx: TxClient,
  references: readonly ValidatedSegmentCondition[],
): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  const wanted: Record<string, { key: string; ids: string[] }> = {
    atividade: { key: 'atividade', ids: [] },
    sala: { key: 'sala', ids: [] },
    trilha: { key: 'trilha', ids: [] },
    chamada: { key: 'chamada', ids: [] },
    carta: { key: 'carta', ids: [] },
  };
  const labelKey = (id: SegmentConditionId, key: string): string => `${id}:${key}`;

  for (const reference of references) {
    /**
     * A referência vem do SNAPSHOT gravado, que é dado de entrada: um id que não
     * existe mais no catálogo é ignorado AQUI e recusado pela composição logo
     * abaixo. Sem esta guarda, o `SEGMENT_CATALOG[id]` devolveria `undefined` e o
     * erro sairia como "falha interna" em vez de "definição inválida".
     */
    if (!isSegmentConditionId(reference.id)) continue;

    for (const parameter of segmentCondition(reference.id).parameters) {
      const value = reference.params[parameter.key];
      if (typeof value !== 'string') continue;

      if (parameter.kind === 'uuid' && wanted[parameter.key]) {
        wanted[parameter.key]!.ids.push(value);
        continue;
      }

      if (parameter.kind === 'data') {
        labels[labelKey(reference.id, parameter.key)] = `${PARAM_CLAUSE_PREFIX[labelKey(reference.id, parameter.key)] ?? ''} ${dayLabel(value)}`.trim();
      }
    }
  }

  const [activities, rooms, tracks, calls, cards] = await Promise.all([
    wanted.atividade!.ids.length > 0
      ? tx.activity.findMany({
          where: { id: { in: wanted.atividade!.ids } },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
    wanted.sala!.ids.length > 0
      ? tx.room.findMany({ where: { id: { in: wanted.sala!.ids } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    wanted.trilha!.ids.length > 0
      ? tx.track.findMany({ where: { id: { in: wanted.trilha!.ids } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    wanted.chamada!.ids.length > 0
      ? tx.callForProposals.findMany({
          where: { id: { in: wanted.chamada!.ids } },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
    wanted.carta!.ids.length > 0
      ? tx.cardTemplate.findMany({ where: { id: { in: wanted.carta!.ids } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const names = new Map<string, string>([
    ...activities.map((row) => [row.id, row.title] as const),
    ...rooms.map((row) => [row.id, row.name] as const),
    ...tracks.map((row) => [row.id, row.name] as const),
    ...calls.map((row) => [row.id, row.title] as const),
    ...cards.map((row) => [row.id, row.name] as const),
  ]);

  for (const reference of references) {
    if (!isSegmentConditionId(reference.id)) continue;

    for (const parameter of segmentCondition(reference.id).parameters) {
      const value = reference.params[parameter.key];
      if (typeof value !== 'string') continue;

      const name = names.get(value);
      if (!name) continue;

      const prefix = PARAM_CLAUSE_PREFIX[labelKey(reference.id, parameter.key)] ?? '';
      labels[labelKey(reference.id, parameter.key)] = `${prefix} ${name}`.trim();
    }
  }

  return labels;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Avaliação
// ───────────────────────────────────────────────────────────────────────────────
/** A pessoa que a lista interna mostra — sem contato, de propósito. */
export interface SegmentPerson extends SegmentRecipientIdentity {
  userId: string;
}

export interface SegmentEvaluation {
  /** Quantos vão RECEBER: já sem quem pediu para sair. */
  count: number;
  /** Quantos do segmento saíram e foram pulados (o "N de M" da tela). */
  unsubscribed: number;
  /**
   * POR QUE essas pessoas saíram, em UMA frase — `null` quando ninguém saiu ou
   * quando quem perguntou não pediu o dado (ver `withUnsubscribeReasons`).
   *
   * A frase é montada no DOMÍNIO (`summarizeUnsubscribeReasons`), e chega pronta
   * aqui de propósito: "quantos motivos cabem", "em que ordem" e "o que dizer de
   * quem saiu sem responder" são regras de leitura, com teste próprio — dentro do
   * JSX da tela elas ficariam presas ao desenho.
   */
  unsubscribeReasons: string | null;
  /** A lista, limitada por `limit` — `count` é a verdade do banco. */
  people: readonly SegmentPerson[];
  truncated: boolean;
  /** As frases das condições, com os nomes resolvidos. */
  explanation: readonly string[];
  exclusion: string | null;
}

export interface EvaluateSegmentInput {
  tenantId: string;
  /** Evento da campanha (nulo na campanha da instituição inteira). */
  eventId?: string | null;
  definition: SegmentDefinition;
  /**
   * Teto da LISTA devolvida. `null` = sem teto (é o que o disparo pede: a lista
   * é o que será percorrido). A contagem nunca é limitada.
   */
  limit?: number | null;
  /**
   * Pede também o MOTIVO agregado de quem saiu (E88).
   *
   * É opt-in porque as duas perguntas são diferentes: o DISPARO precisa de quem
   * recebe (a lista), e a TELA precisa entender por que alguém não recebe. Fazer o
   * disparo pagar a agregação de motivos seria uma consulta a mais por campanha
   * para produzir um texto que ninguém lê no meio do envio.
   */
  withUnsubscribeReasons?: boolean;
}

const DEFAULT_LIST_LIMIT = 200;

export async function evaluateSegment(
  input: EvaluateSegmentInput,
): Promise<SegmentResult<SegmentEvaluation>> {
  try {
    const limit =
      input.limit === null
        ? null
        : Math.min(Math.max(input.limit ?? DEFAULT_LIST_LIMIT, 1), 1_000);

    return await withTenant(input.tenantId, async (tx) => {
      const event = input.eventId
        ? await tx.event.findFirst({
            where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
            select: { id: true, timezone: true, startsAt: true },
          })
        : null;

      if (input.eventId && !event) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Evento não encontrado nesta instituição.',
        };
      }

      const context: SegmentContext = {
        tenantId: input.tenantId,
        eventId: event?.id ?? null,
        timezone: event?.timezone ?? null,
        eventStartsAt: event?.startsAt ?? null,
      };

      const references = [...input.definition.conditions];
      if (input.definition.except) references.push(input.definition.except);

      const labels = await resolveSegmentLabels(tx, references);

      const composition = composeSegment(
        { conditions: input.definition.conditions, except: input.definition.except },
        { labels },
      );

      if (!composition.ok) {
        return {
          ok: false as const,
          code: 'INVALID_SEGMENT' as const,
          message: composition.message,
          details: composition.issues.map((issue) => issue.message),
        };
      }

      const needsEvent = [...composition.definition.conditions, composition.definition.except]
        .filter((reference): reference is ValidatedSegmentCondition => reference !== null)
        .some((reference) => SEGMENT_CATALOG[reference.id].requiresEvent);

      if (needsEvent && !context.eventId) {
        return {
          ok: false as const,
          code: 'EVENT_REQUIRED' as const,
          message: 'Esta condição recorta por evento: escolha o evento da campanha.',
        };
      }

      const built = await Promise.all(
        composition.definition.conditions.map((reference) =>
          SEGMENT_BUILDERS[reference.id]({ context, params: reference.params, tx }),
        ),
      );

      const exceptReference = composition.definition.except;
      const exceptBuilt = exceptReference
        ? await SEGMENT_BUILDERS[exceptReference.id]({ context, params: exceptReference.params, tx })
        : null;

      const failure = [...built, ...(exceptBuilt ? [exceptBuilt] : [])].find((result) => !result.ok);
      if (failure && !failure.ok) {
        return { ok: false as const, code: failure.code, message: failure.message };
      }

      const baseWhere: SegmentWhere = {
        AND: [
          institutionFence(input.tenantId),
          ...built.map((result) => (result.ok ? result.where : {})),
          ...(exceptBuilt && exceptBuilt.ok ? [{ NOT: exceptBuilt.where }] : []),
        ],
      };

      /**
       * Quem saiu não recebe — e o filtro é uma CONSULTA, não uma lista em memória:
       * a linha do descadastro é o estado vigente (`resubscribedAt` nulo), e quem
       * voltou a receber tem a mesma linha com a volta marcada.
       */
      const notUnsubscribed: SegmentWhere = {
        NOT: {
          communicationUnsubscribes: {
            some: { tenantId: input.tenantId, resubscribedAt: null },
          },
        },
      };

      const reachableWhere: SegmentWhere = { AND: [baseWhere, notUnsubscribed] };

      const [count, baseCount, rows] = await Promise.all([
        tx.user.count({ where: reachableWhere }),
        tx.user.count({ where: baseWhere }),
        tx.user.findMany({
          where: reachableWhere,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          ...(limit === null ? {} : { take: limit }),
          /**
           * `publicProfileHiddenAt` é pedido no `select` DE PROPÓSITO: é campo
           * obrigatório de `segmentRecipientIdentity`, e o `tsc` acusa quem
           * esquecê-lo (a mesma trava do ranking e da vitrine da equipe).
           */
          select: { id: true, name: true, publicProfileHiddenAt: true },
        }),
      ]);

      const people: SegmentPerson[] = rows.map((row) => ({
        userId: row.id,
        ...segmentRecipientIdentity({ name: row.name, publicProfileHiddenAt: row.publicProfileHiddenAt }),
      }));

      const unsubscribed = Math.max(baseCount - count, 0);

      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  POR QUE A AGREGAÇÃO DE MOTIVOS É UMA CONSULTA SÓ, E DO BANCO (E88)
       * ─────────────────────────────────────────────────────────────────────────────
       *  O "N de M" da tela já sabia QUANTOS saíram; o que faltava era POR QUÊ. A
       *  resposta não pode sair da lista de quem recebe (essas pessoas não estão
       *  nela), e carregar os descadastros um a um para contar em memória seria uma
       *  leitura por pessoa numa tela que já lê o segmento inteiro. O `groupBy`
       *  fecha a conta no banco, e o filtro é o MESMO do "quem não recebe": a linha
       *  vigente (`resubscribedAt` nulo) de gente que casa com o segmento — assim a
       *  soma dos motivos é exatamente o número que a tela já mostra ao lado.
       */
      const unsubscribeReasons =
        input.withUnsubscribeReasons && unsubscribed > 0
          ? summarizeUnsubscribeReasons(
              (
                await tx.communicationUnsubscribe.groupBy({
                  by: ['reason'],
                  where: { tenantId: input.tenantId, resubscribedAt: null, user: baseWhere },
                  _count: { _all: true },
                })
              ).map((row) => ({ reason: row.reason, count: row._count._all })),
            )
          : null;

      return {
        ok: true as const,
        count,
        unsubscribed,
        unsubscribeReasons,
        people,
        truncated: count > people.length,
        explanation: composition.explanation,
        exclusion: composition.exclusion,
      };
    });
  } catch (error) {
    console.error(`[segments] falha ao avaliar o segmento: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível avaliar o segmento.' };
  }
}

/**
 * Os contatos de quem vai receber.
 *
 * Vive FORA de `evaluateSegment` de propósito: a lista que a tela mostra traz o
 * nome (mascarado quando a ocultação da F60 vale) e NÃO traz endereço. O e-mail é
 * dado de contato, e o único lugar que precisa dele é o disparo.
 */
export async function loadSegmentRecipients(input: {
  tenantId: string;
  userIds: readonly string[];
}): Promise<{ userId: string; name: string; email: string }[]> {
  if (input.userIds.length === 0) return [];

  return withTenant(input.tenantId, (tx) =>
    tx.user.findMany({
      where: { id: { in: [...input.userIds] } },
      select: { id: true, name: true, email: true },
    }),
  ).then((rows) => rows.map((row) => ({ userId: row.id, name: row.name, email: row.email })));
}

/** A frase de UMA condição, com o rótulo resolvido — usado pela tela e pelos testes. */
export function describeSegmentCondition(
  id: SegmentConditionId,
  params: SegmentParams = {},
  labels: Readonly<Record<string, string>> = {},
): string {
  return segmentConditionPhrase(id, params, labels);
}

/** Toda condição do catálogo tem construtor? (a catraca, em tempo de execução) */
export function segmentBuilderIds(): readonly string[] {
  return Object.keys(SEGMENT_BUILDERS).sort();
}

/** As condições do catálogo, ordenadas — o outro lado da catraca. */
export function segmentCatalogIds(): readonly string[] {
  return [...SEGMENT_CONDITION_IDS].sort();
}
