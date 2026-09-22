/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Central do participante: diretório e ficha (FASE 32)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PERGUNTA QUE ESTE SERVIÇO RESPONDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Quem são as pessoas desta instituição, o que elas viveram aqui e o que nós
 *  falamos com elas?" — atravessando TODOS os eventos, e não um por vez.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS DECISÕES QUE EXPLICAM O CÓDIGO ABAIXO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. **Quem conta como participante é uma UNIÃO** (`PARTICIPANT_UNION_SQL`): quem
 *     tem vínculo de participante ∪ quem tem qualquer inscrição. Olhar só o vínculo
 *     esconderia gente que está na lista de presença; olhar só a inscrição esconderia
 *     quem se cadastrou e ainda não se inscreveu em nada — justamente quem a
 *     instituição quer convidar.
 *  2. **A agregação acontece no BANCO, em uma consulta por seção.** A alternativa
 *     (trazer as pessoas e depois consultar cada uma) é o N+1 clássico: com 40
 *     pessoas passa, com 400 o diretório fica inutilizável — e o modo de falha é
 *     lento, não errado, então ninguém percebe até o dia do evento.
 *  3. **`null` não é `0`.** Toda métrica derivada vem do domínio
 *     (`attendanceRate`, `averageMinutesPerVisit`), que devolve ausência de dado
 *     quando não há denominador. A tela mostra "—" e não inventa percentual.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FICHA É LEITURA AUDITADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Abrir a ficha de alguém é acessar dado pessoal agregado — nome, e-mail, tudo o
 *  que a pessoa fez e tudo o que recebeu. Isso entra na trilha
 *  (`AuditAction.READ`), com autor e instante. A LISTA não entra (é consulta de
 *  trabalho, com e-mail mascarado); a FICHA entra, porque é a decisão de olhar uma
 *  pessoa. Mesma lógica do nome mascarado no resultado público (ADR-139): o dado
 *  aparece quando há razão, e a razão fica registrada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { instantToZonedWallTime } from '@/domain/events/scheduling-rules';
import {
  CSV_MAX_ROWS,
  ENGAGEMENT_LABELS,
  MAX_PARTICIPANT_PAGE_SIZE,
  PARTICIPANT_LIMIT,
  PARTICIPANT_ORIGIN_LABELS,
  attendanceRate,
  averageMinutesPerVisit,
  buildCsv,
  certificateCoverage,
  engagementOf,
  maskEmail,
  resolveParticipantPage,
  type AttendanceRate,
  type EngagementTag,
  type ParticipantOrigin,
  type ParticipantPage,
} from '@/domain/participants/participant-rules';

export type ParticipantErrorCode = 'NOT_FOUND' | 'INVALID_INPUT' | 'INTERNAL';

export type ParticipantResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: ParticipantErrorCode; message: string };

// ───────────────────────────────────────────────────────────────────────────────
//  A união que define "participante da instituição"
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Vínculo de participante ∪ qualquer inscrição no tenant.
 *
 * `UNION` (e não `UNION ALL`) porque uma pessoa costuma estar nas duas pontas: o
 * vínculo nasce com a primeira inscrição (FASE 10). Sem o `DISTINCT`, ela apareceria
 * duas vezes no diretório — e a contagem de participantes da instituição mentiria.
 *
 * `$1` é o `tenantId`. A RLS continua valendo por cima: a policy limita as duas
 * tabelas à instituição do contexto, então nem um filtro esquecido aqui vaza dado.
 */
const PARTICIPANT_UNION_SQL = `
  SELECT p."userId" AS "userId"
    FROM user_tenant_profiles p
   WHERE p."tenantId" = $1::uuid
     AND p."deletedAt" IS NULL
     AND p.status <> 'REMOVED'
  UNION
  SELECT r."userId" AS "userId"
    FROM registrations r
   WHERE r."tenantId" = $1::uuid
     AND r."deletedAt" IS NULL
`;

export interface ParticipantListEntry {
  userId: string;
  name: string;
  /** Já mascarado para a lista — a ficha mostra o endereço completo. */
  emailMasked: string;
  email: string;
  image: string | null;
  origin: ParticipantOrigin;
  /** Eventos distintos com inscrição. */
  events: number;
  confirmed: number;
  attended: number;
  /** Eventos distintos com presença registrada. */
  attendedEvents: number;
  visits: number;
  minutes: number;
  certificates: number;
  cards: number;
  xp: number;
  rate: AttendanceRate;
  engagement: readonly EngagementTag[];
  lastActivityAt: Date | null;
}

export interface ParticipantListFilters {
  query?: string;
  eventId?: string;
  onlyWithCertificate?: boolean;
  onlyAttended?: boolean;
}

interface RosterRow {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  tenantId: string | null;
  events: bigint | number;
  confirmed: bigint | number;
  attended: bigint | number;
  attendedEvents: bigint | number;
  visits: bigint | number;
  minutes: bigint | number;
  certificates: bigint | number;
  cards: bigint | number;
  xp: bigint | number;
  lastActivityAt: Date | null;
}

/** O driver devolve `bigint` em `count`/`sum`: converter aqui, uma vez só. */
function toNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
}

function buildFilters(input: { tenantId: string } & ParticipantListFilters): {
  where: string;
  params: unknown[];
} {
  const params: unknown[] = [input.tenantId];
  const clauses: string[] = [];

  if (input.query?.trim()) {
    params.push(`%${input.query.trim()}%`);
    clauses.push(`(person.name ILIKE $${params.length} OR person.email ILIKE $${params.length})`);
  }

  if (input.eventId) {
    params.push(input.eventId);
    clauses.push(`EXISTS (
      SELECT 1 FROM registrations fr
       WHERE fr."tenantId" = $1::uuid AND fr."userId" = people."userId"
         AND fr."eventId" = $${params.length}::uuid AND fr."deletedAt" IS NULL
    )`);
  }

  if (input.onlyWithCertificate) clauses.push(`COALESCE(cert.certificates, 0) > 0`);
  if (input.onlyAttended) clauses.push(`COALESCE(att.visits, 0) > 0`);

  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * Lista paginada do diretório da instituição.
 *
 * A ordenação é por NOME e depois por id: sem o desempate por id, duas pessoas
 * homônimas trocam de lugar entre páginas e uma delas aparece duas vezes (o mesmo
 * cuidado que a reordenação de blocos da FASE 17 toma ao reescrever a ordem).
 */
export async function listParticipants(
  input: {
    tenantId: string;
    page?: number;
    pageSize?: number;
  } & ParticipantListFilters,
): Promise<
  ParticipantResult<{
    entries: ParticipantListEntry[];
    page: ParticipantPage;
    truncated: boolean;
  }>
> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const filters = buildFilters(input);

      /** A partir daqui os parâmetros são posicionais e o número já está avançado. */
      const countRows = await tx.$queryRawUnsafe<{ total: bigint | number }[]>(
        `
        WITH people AS (${PARTICIPANT_UNION_SQL}),
        cert AS (
          SELECT "userId" AS uid, count(*) AS certificates
            FROM certificates
           WHERE "tenantId" = $1::uuid AND status = 'ISSUED'
           GROUP BY "userId"
        ),
        att AS (
          SELECT "userId" AS uid, count(*) AS visits
            FROM attendances
           WHERE "tenantId" = $1::uuid
           GROUP BY "userId"
        )
        SELECT count(*) AS total
          FROM people
          JOIN "user" person ON person.id = people."userId"
          LEFT JOIN cert ON cert.uid = people."userId"
          LEFT JOIN att ON att.uid = people."userId"
          ${filters.where}
        `,
        ...filters.params,
      );

      const total = toNumber(countRows[0]?.total ?? 0);
      const page = resolveParticipantPage({
        page: input.page,
        pageSize: input.pageSize,
        total: Math.min(total, PARTICIPANT_LIMIT),
      });

      const rows = await tx.$queryRawUnsafe<RosterRow[]>(
        `
        WITH people AS (${PARTICIPANT_UNION_SQL}),
        reg AS (
          SELECT r."userId" AS uid,
                 count(DISTINCT r."eventId") AS events,
                 count(*) FILTER (WHERE r.status IN ('CONFIRMED', 'ATTENDED')) AS confirmed,
                 count(*) FILTER (WHERE r.status = 'ATTENDED') AS attended
            FROM registrations r
           WHERE r."tenantId" = $1::uuid AND r."deletedAt" IS NULL
           GROUP BY r."userId"
        ),
        att AS (
          SELECT a."userId" AS uid,
                 count(*) AS visits,
                 count(DISTINCT a."eventId") AS "attendedEvents",
                 COALESCE(sum(COALESCE(a."minutesAttended", 0)), 0) AS minutes,
                 max(a."checkedInAt") AS "lastActivityAt"
            FROM attendances a
           WHERE a."tenantId" = $1::uuid
           GROUP BY a."userId"
        ),
        cert AS (
          SELECT "userId" AS uid, count(*) AS certificates
            FROM certificates
           WHERE "tenantId" = $1::uuid AND status = 'ISSUED'
           GROUP BY "userId"
        ),
        cards AS (
          SELECT "userId" AS uid, COALESCE(sum(quantity), 0) AS cards
            FROM user_cards
           WHERE "tenantId" = $1::uuid
           GROUP BY "userId"
        )
        SELECT people."userId" AS "userId",
               person.name AS name,
               person.email AS email,
               person.image AS image,
               profile."tenantId" AS "tenantId",
               COALESCE(reg.events, 0) AS events,
               COALESCE(reg.confirmed, 0) AS confirmed,
               COALESCE(reg.attended, 0) AS attended,
               COALESCE(att."attendedEvents", 0) AS "attendedEvents",
               COALESCE(att.visits, 0) AS visits,
               COALESCE(att.minutes, 0) AS minutes,
               COALESCE(cert.certificates, 0) AS certificates,
               COALESCE(cards.cards, 0) AS cards,
               COALESCE(xp."totalXp", 0) AS xp,
               att."lastActivityAt" AS "lastActivityAt"
          FROM people
          JOIN "user" person ON person.id = people."userId"
          LEFT JOIN reg ON reg.uid = people."userId"
          LEFT JOIN att ON att.uid = people."userId"
          LEFT JOIN cert ON cert.uid = people."userId"
          LEFT JOIN cards ON cards.uid = people."userId"
          LEFT JOIN user_xp_profiles xp
                 ON xp."userId" = people."userId" AND xp."tenantId" = $1::uuid
          LEFT JOIN user_tenant_profiles profile
                 ON profile."userId" = people."userId" AND profile."tenantId" = $1::uuid
          ${filters.where}
         ORDER BY lower(person.name) ASC, people."userId" ASC
         LIMIT $${filters.params.length + 1} OFFSET $${filters.params.length + 2}
        `,
        ...filters.params,
        page.pageSize,
        page.skip,
      );

      const entries: ParticipantListEntry[] = rows.map((row) => {
        const confirmed = toNumber(row.confirmed);
        const attended = toNumber(row.attended);
        const minutes = toNumber(row.minutes);
        const visits = toNumber(row.visits);
        const certificates = toNumber(row.certificates);
        const cards = toNumber(row.cards);
        const events = toNumber(row.events);
        const attendedEvents = toNumber(row.attendedEvents);

        return {
          userId: row.userId,
          name: row.name,
          email: row.email,
          emailMasked: maskEmail(row.email),
          image: row.image,
          origin: row.tenantId ? 'MEMBERSHIP' : 'REGISTRATION',
          events,
          confirmed,
          attended,
          attendedEvents,
          visits,
          minutes,
          certificates,
          cards,
          xp: toNumber(row.xp),
          rate: attendanceRate({ confirmed, attended }),
          engagement: engagementOf({ events, visits, minutes, certificates, cards, xp: toNumber(row.xp) }),
          lastActivityAt: row.lastActivityAt,
        };
      });

      return {
        ok: true as const,
        entries,
        page: { ...page, total },
        /**
         * O diretório PARA no teto (`PARTICIPANT_LIMIT`) em vez de tentar devolver
         * tudo: quem exporta usa o CSV, que tem o próprio limite e o próprio aviso.
         */
        truncated: total > PARTICIPANT_LIMIT,
      };
    });
  } catch (error) {
    console.error(`[participants] falha ao listar participantes: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível carregar os participantes.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Exportação (CSV)
// ───────────────────────────────────────────────────────────────────────────────
/** Cabeçalho do arquivo — a MESMA ordem das colunas montadas abaixo. */
export const PARTICIPANT_CSV_HEADER = Object.freeze([
  'Nome',
  'E-mail',
  'Origem',
  'Eventos',
  'Inscrições confirmadas',
  'Presenças',
  'Eventos com presença',
  'Visitas',
  'Minutos',
  'Comparecimento (%)',
  'Certificados',
  'Cartas',
  'XP',
  'Rótulos',
  'Última presença',
]);

/**
 * Exporta o diretório em CSV.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A EXPORTAÇÃO É AUDITADA E TEM TETO
 * ─────────────────────────────────────────────────────────────────────────────
 *  O CSV tira o dado pessoal da plataforma e o deposita num arquivo que circula por
 *  e-mail e pasta compartilhada. É o pedido mais legítimo da secretaria e, ao mesmo
 *  tempo, o caminho mais fácil para uma base inteira sair sem rastro — por isso a
 *  exportação entra na trilha (`AuditAction.EXPORT`, que existe desde a FASE 1) com
 *  autor, filtros e número de linhas, e tem teto (`CSV_MAX_ROWS`).
 *
 *  A data da última presença sai no fuso da INSTITUIÇÃO: o arquivo é lido por gente,
 *  e "ontem às 22h" em UTC apareceria como "hoje" para quem lê no Brasil.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CSV LEVA O E-MAIL COMPLETO — DECISÃO EXPLÍCITA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela mascara o endereço; o arquivo não. É a diferença entre MOSTRAR e ENTREGAR:
 *  a lista é uma tela de trabalho que se copia e se projeta, e o CSV é o insumo de
 *  uma ação (conferir quem não foi, importar num sistema de mala direta). Um arquivo
 *  com `m***@ufba.br` não serve para nada — e o risco não some por mascarar, só muda
 *  de lugar. O que protege é o registro: `AuditAction.EXPORT` grava autor, instante,
 *  filtros e número de linhas, e o teto impede a extração da base inteira num clique.
 */
export async function exportParticipantsCsv(input: {
  tenantId: string;
  actorId: string;
  filters?: ParticipantListFilters;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ParticipantResult<{ csv: string; rows: number; truncated: boolean }>> {
  const listing = await listParticipants({
    tenantId: input.tenantId,
    page: 1,
    pageSize: MAX_PARTICIPANT_PAGE_SIZE,
    ...input.filters,
  });

  if (!listing.ok) return listing;

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: input.tenantId },
        select: { timezone: true },
      });

      const collected: ParticipantListEntry[] = [...listing.entries];
      let page = 2;
      let truncated = false;

      while (listing.page.total > collected.length) {
        if (collected.length >= CSV_MAX_ROWS) {
          truncated = true;
          break;
        }

        const next = await listParticipants({
          tenantId: input.tenantId,
          page,
          pageSize: MAX_PARTICIPANT_PAGE_SIZE,
          ...input.filters,
        });

        if (!next.ok || next.entries.length === 0) break;

        collected.push(...next.entries);
        page += 1;
      }

      if (collected.length > CSV_MAX_ROWS) {
        collected.length = CSV_MAX_ROWS;
        truncated = true;
      }

      const csv = buildCsv(
        PARTICIPANT_CSV_HEADER,
        collected.map((entry) => [
          entry.name,
          entry.email,
          PARTICIPANT_ORIGIN_LABELS[entry.origin],
          entry.events,
          entry.confirmed,
          entry.attended,
          entry.attendedEvents,
          entry.visits,
          entry.minutes,
          entry.rate.percent,
          entry.certificates,
          entry.cards,
          entry.xp,
          entry.engagement.map((tag) => ENGAGEMENT_LABELS[tag]).join(' · '),
          entry.lastActivityAt ? instantToZonedWallTime(entry.lastActivityAt, tenant.timezone).replace('T', ' ') : null,
        ]),
      );

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'EXPORT',
          entityType: 'participant',
          entityId: null,
          changes: {
            linhas: { from: null, to: collected.length },
            ...(input.filters?.eventId ? { evento: { from: null, to: input.filters.eventId } } : {}),
            ...(input.filters?.query ? { busca: { from: null, to: input.filters.query } } : {}),
          },
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );

      return { ok: true as const, csv, rows: collected.length, truncated };
    });
  } catch (error) {
    console.error(`[participants] falha ao exportar participantes: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível exportar a lista.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  A ficha (visão 360)
// ───────────────────────────────────────────────────────────────────────────────
export interface ParticipantProfile {
  userId: string;
  name: string;
  email: string;
  emailMasked: string;
  image: string | null;
  origin: ParticipantOrigin;
  /** Vínculo na instituição, quando existe. */
  profile: {
    status: string;
    joinedAt: Date | null;
    jobTitle: string | null;
    department: string | null;
  } | null;
  /** Consentimento de perfil público (ele decide o que aparece no resultado). */
  isPublicProfile: boolean;
  registeredAt: Date | null;
  totals: {
    events: number;
    confirmed: number;
    attended: number;
    attendedEvents: number;
    visits: number;
    minutes: number;
    averageMinutes: number | null;
    certificates: number;
    cards: number;
    xp: number;
    level: number;
    messages: number;
    unreadMessages: number;
    emails: number;
    rate: AttendanceRate;
    coverage: number | null;
  };
  engagement: readonly EngagementTag[];
  /** Eventos, com a presença e os minutos da pessoa em cada um. */
  events: readonly {
    eventId: string;
    title: string;
    slug: string;
    startsAt: Date;
    endsAt: Date;
    status: string;
    /** `null` = inscrição no evento; preenchido = inscrição numa atividade. */
    activityTitle: string | null;
    registrationStatus: string;
    registeredAt: Date;
    checkedInAt: Date | null;
    visits: number;
    minutes: number;
  }[];
  certificates: readonly {
    id: string;
    kind: string;
    status: string;
    title: string;
    validationCode: string;
    workloadMinutes: number | null;
    issuedAt: Date | null;
    eventTitle: string | null;
    activityTitle: string | null;
  }[];
  cards: readonly {
    id: string;
    name: string;
    rarity: string;
    quantity: number;
    isFoil: boolean;
    grantedAt: Date;
    eventTitle: string | null;
  }[];
  xpRecent: readonly { id: string; amount: number; source: string; reason: string | null; createdAt: Date }[];
  messages: readonly {
    id: string;
    subject: string;
    body: string;
    sentAt: Date;
    readAt: Date | null;
    eventTitle: string | null;
    sentByName: string | null;
  }[];
  emails: readonly {
    id: string;
    to: string;
    template: string;
    subject: string;
    status: string;
    sentAt: Date | null;
    createdAt: Date;
    error: string | null;
  }[];
}

/**
 * Ficha completa de UMA pessoa na instituição.
 *
 * A pessoa precisa pertencer à instituição pela MESMA união do diretório: sem isso,
 * alguém com o `userId` na mão poderia abrir a ficha de uma pessoa de fora — e a RLS
 * não barraria, porque o `user` é global (a policy protege as tabelas com `tenantId`,
 * e a pessoa em si não tem uma).
 */
export async function getParticipantProfile(input: {
  tenantId: string;
  userId: string;
  actorId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ParticipantResult<{ profile: ParticipantProfile }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const belongs = await tx.$queryRawUnsafe<{ userId: string }[]>(
        `SELECT "userId" FROM (${PARTICIPANT_UNION_SQL}) AS people WHERE "userId" = $2::uuid LIMIT 1`,
        input.tenantId,
        input.userId,
      );

      if (belongs.length === 0) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Esta pessoa não participa desta instituição.',
        };
      }

      const [
        person,
        profile,
        registrations,
        attendanceTotals,
        attendanceByEvent,
        certificates,
        cards,
        xpProfile,
        xpRows,
        messages,
        emails,
      ] = await Promise.all([
        tx.user.findUniqueOrThrow({
          where: { id: input.userId },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            isPublicProfile: true,
            createdAt: true,
          },
        }),
        tx.userTenantProfile.findFirst({
          where: { tenantId: input.tenantId, userId: input.userId },
          select: { status: true, joinedAt: true, jobTitle: true, department: true },
        }),
        tx.registration.findMany({
          where: { tenantId: input.tenantId, userId: input.userId, deletedAt: null },
          orderBy: [{ createdAt: 'desc' }],
          select: {
            id: true,
            status: true,
            checkedInAt: true,
            createdAt: true,
            eventId: true,
            activityId: true,
            event: { select: { id: true, title: true, slug: true, startsAt: true, endsAt: true, status: true } },
            activity: { select: { title: true } },
          },
        }),
        tx.attendance.aggregate({
          where: { tenantId: input.tenantId, userId: input.userId },
          _count: { _all: true },
          _sum: { minutesAttended: true },
        }),
        tx.attendance.groupBy({
          by: ['eventId'],
          where: { tenantId: input.tenantId, userId: input.userId },
          _count: { _all: true },
          _sum: { minutesAttended: true },
        }),
        tx.certificate.findMany({
          where: { tenantId: input.tenantId, userId: input.userId },
          orderBy: [{ issuedAt: 'desc' }],
          select: {
            id: true,
            kind: true,
            status: true,
            title: true,
            validationCode: true,
            workloadMinutes: true,
            issuedAt: true,
            event: { select: { title: true } },
            activity: { select: { title: true } },
          },
        }),
        tx.userCard.findMany({
          where: { tenantId: input.tenantId, userId: input.userId },
          orderBy: [{ grantedAt: 'desc' }],
          select: {
            id: true,
            quantity: true,
            isFoil: true,
            grantedAt: true,
            cardTemplate: { select: { name: true, rarity: true } },
            event: { select: { title: true } },
          },
        }),
        tx.userXpProfile.findFirst({
          where: { tenantId: input.tenantId, userId: input.userId },
          select: { totalXp: true, level: true },
        }),
        tx.xpTransaction.findMany({
          where: { tenantId: input.tenantId, userId: input.userId },
          orderBy: [{ createdAt: 'desc' }],
          take: 15,
          select: { id: true, amount: true, source: true, reason: true, createdAt: true },
        }),
        tx.participantMessage.findMany({
          where: { tenantId: input.tenantId, userId: input.userId },
          orderBy: [{ sentAt: 'desc' }],
          take: 50,
          select: {
            id: true,
            subject: true,
            body: true,
            sentAt: true,
            readAt: true,
            event: { select: { title: true } },
            sentBy: { select: { name: true } },
          },
        }),
        tx.emailMessage.findMany({
          where: { tenantId: input.tenantId, toUserId: input.userId },
          orderBy: [{ createdAt: 'desc' }],
          take: 50,
          select: {
            id: true,
            to: true,
            template: true,
            subject: true,
            status: true,
            sentAt: true,
            createdAt: true,
            error: true,
          },
        }),
      ]);

      /**
       * A LEITURA ENTRA NA TRILHA — e entra aqui, depois de confirmar que a pessoa é
       * da instituição: registrar o acesso de quem tentou abrir ficha alheia também
       * é informação, mas não pode virar a resposta para um `userId` de fora.
       */
      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'READ',
          entityType: 'participant',
          entityId: input.userId,
          changes: { ficha: { from: null, to: `${person.name} (${maskEmail(person.email)})` } },
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );

      const visits = attendanceTotals._count._all;
      const minutes = attendanceTotals._sum.minutesAttended ?? 0;
      const confirmed = registrations.filter(
        (row) => row.status === 'CONFIRMED' || row.status === 'ATTENDED',
      ).length;
      const attended = registrations.filter((row) => row.status === 'ATTENDED').length;
      const issuedCertificates = certificates.filter((row) => row.status === 'ISSUED').length;
      const events = new Set(registrations.map((row) => row.eventId)).size;
      const cardCount = cards.reduce((total, row) => total + row.quantity, 0);
      const minutesByEvent = new Map(
        attendanceByEvent.map((row) => [
          row.eventId,
          {
            visits: row._count._all,
            minutes: row._sum.minutesAttended ?? 0,
          },
        ]),
      );

      return {
        ok: true as const,
        profile: {
          userId: person.id,
          name: person.name,
          email: person.email,
          emailMasked: maskEmail(person.email),
          image: person.image,
          origin: profile ? 'MEMBERSHIP' : 'REGISTRATION',
          profile: profile
            ? {
                status: profile.status,
                joinedAt: profile.joinedAt,
                jobTitle: profile.jobTitle,
                department: profile.department,
              }
            : null,
          isPublicProfile: person.isPublicProfile,
          registeredAt: registrations.at(-1)?.createdAt ?? person.createdAt,
          totals: {
            events,
            confirmed,
            attended,
            attendedEvents: attendanceByEvent.length,
            visits,
            minutes,
            averageMinutes: averageMinutesPerVisit({ minutes, visits }),
            certificates: issuedCertificates,
            cards: cardCount,
            xp: xpProfile?.totalXp ?? 0,
            level: xpProfile?.level ?? 1,
            messages: messages.length,
            unreadMessages: messages.filter((row) => row.readAt === null).length,
            emails: emails.length,
            rate: attendanceRate({ confirmed, attended }),
            coverage: certificateCoverage({ certificates: issuedCertificates, attendedEvents: attendanceByEvent.length }),
          },
          engagement: engagementOf({
            events,
            visits,
            minutes,
            certificates: issuedCertificates,
            cards: cardCount,
            xp: xpProfile?.totalXp ?? 0,
          }),
          events: registrations.map((row) => {
            const perEvent = minutesByEvent.get(row.eventId);

            return {
              eventId: row.event.id,
              title: row.event.title,
              slug: row.event.slug,
              startsAt: row.event.startsAt,
              endsAt: row.event.endsAt,
              status: row.event.status,
              activityTitle: row.activity?.title ?? null,
              registrationStatus: row.status,
              registeredAt: row.createdAt,
              checkedInAt: row.checkedInAt,
              visits: row.activityId === null ? (perEvent?.visits ?? 0) : 0,
              /**
               * Os minutos são da PESSOA no EVENTO (todas as atividades), não da
               * linha da inscrição: é assim que o certificado e o sorteio contam
               * (ADR-150), e a ficha não pode contar diferente deles.
               */
              minutes: perEvent?.minutes ?? 0,
            };
          }),
          certificates: certificates.map((row) => ({
            id: row.id,
            kind: row.kind,
            status: row.status,
            title: row.title,
            validationCode: row.validationCode,
            workloadMinutes: row.workloadMinutes,
            issuedAt: row.issuedAt,
            eventTitle: row.event?.title ?? null,
            activityTitle: row.activity?.title ?? null,
          })),
          cards: cards.map((row) => ({
            id: row.id,
            name: row.cardTemplate.name,
            rarity: row.cardTemplate.rarity,
            quantity: row.quantity,
            isFoil: row.isFoil,
            grantedAt: row.grantedAt,
            eventTitle: row.event?.title ?? null,
          })),
          xpRecent: xpRows,
          messages: messages.map((row) => ({
            id: row.id,
            subject: row.subject,
            body: row.body,
            sentAt: row.sentAt,
            readAt: row.readAt,
            eventTitle: row.event?.title ?? null,
            sentByName: row.sentBy?.name ?? null,
          })),
          emails: emails.map((row) => ({
            id: row.id,
            to: row.to,
            template: row.template,
            subject: row.subject,
            status: row.status,
            sentAt: row.sentAt,
            createdAt: row.createdAt,
            error: row.error,
          })),
        },
      };
    });
  } catch (error) {
    console.error(`[participants] falha ao carregar a ficha: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível carregar a ficha do participante.' };
  }
}
