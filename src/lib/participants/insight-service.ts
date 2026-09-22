/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Inteligência da instituição (FASE 32)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA RESPONDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Como vai a vida da instituição?" — quantas pessoas passaram por aqui, quantas
 *  apareceram de fato, quantas horas isso representou, o que foi entregue em
 *  documento e o que foi conversado com elas. Sempre com PERÍODO e com a SÉRIE por
 *  evento, porque um total solto não distingue "a instituição cresceu" de "um evento
 *  gigante aconteceu".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO SUBSTITUI O PAINEL (`getAdminOverview`)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O painel da FASE 7 conta o que EXISTE agora (eventos, atividades, cartas,
 *  membros). Aqui o recorte é outro: o que ACONTECEU num período, por evento, com
 *  taxa de comparecimento e minutos. São perguntas diferentes e os dois números
 *  convivem de propósito — o E2E da FASE 7 depende dos contadores do painel.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A JANELA É DO FUSO DA INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `resolveRange` (domínio) transforma "últimos 30 dias" em instantes no fuso da
 *  instituição, e o filtro é `startsAt >= from AND startsAt < to` — o dia inteiro
 *  entra, sem depender de acertar o último segundo (armadilhas 38 e 57).
 *
 *  A permissão é `tenant:analytics:read`, que existia desde a FASE 2 e **nenhuma
 *  tela usava** — esta é a tela que a honra.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import {
  attendanceRate,
  averageMinutesPerVisit,
  resolveRange,
  type AttendanceRate,
  type IntelligenceRange,
} from '@/domain/participants/participant-rules';
import type { ParticipantResult } from '@/lib/participants/participant-service';

/** Teto de eventos na série: o relatório é para leitura, não para exportação em massa. */
const INSIGHT_EVENT_LIMIT = 200;

export interface InstitutionEventInsight {
  eventId: string;
  title: string;
  slug: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  confirmed: number;
  attended: number;
  visits: number;
  minutes: number;
  certificates: number;
  messages: number;
  rate: AttendanceRate;
}

export interface InstitutionInsight {
  range: {
    range: IntelligenceRange;
    label: string;
    from: Date | null;
    to: Date;
    timeZone: string;
  };
  totals: {
    /** Pessoas distintas que participam da instituição (união vínculo ∪ inscrição). */
    participants: number;
    events: number;
    publishedEvents: number;
    confirmed: number;
    attended: number;
    rate: AttendanceRate;
    visits: number;
    minutes: number;
    averageMinutes: number | null;
    certificates: number;
    cards: number;
    xp: number;
    messages: number;
    unreadMessages: number;
    emailsSent: number;
    emailsFailed: number;
    emailsQueued: number;
  };
  events: readonly InstitutionEventInsight[];
}

export async function getInstitutionIntelligence(input: {
  tenantId: string;
  range: IntelligenceRange;
  fromDay?: string | null;
  toDay?: string | null;
  now: Date;
}): Promise<ParticipantResult<{ insight: InstitutionInsight }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: input.tenantId },
        select: { timezone: true },
      });

      const window = resolveRange({
        range: input.range,
        now: input.now,
        timeZone: tenant.timezone,
        fromDay: input.fromDay,
        toDay: input.toDay,
      });

      const period = { gte: window.from ?? undefined, lt: window.to };

      const [participantsRows, events] = await Promise.all([
        /**
         * A contagem de participantes é do ESTADO ATUAL da instituição, e não do
         * período: "quantas pessoas participam" não é um número que faz sentido
         * recortar por data — quem se inscreveu ontem continua participando hoje.
         */
        tx.$queryRawUnsafe<{ total: bigint | number }[]>(
          `
          SELECT count(*) AS total FROM (
            SELECT p."userId" AS "userId"
              FROM user_tenant_profiles p
             WHERE p."tenantId" = $1::uuid AND p."deletedAt" IS NULL AND p.status <> 'REMOVED'
            UNION
            SELECT r."userId" AS "userId"
              FROM registrations r
             WHERE r."tenantId" = $1::uuid AND r."deletedAt" IS NULL
          ) AS people
          `,
          input.tenantId,
        ),
        tx.event.findMany({
          where: { tenantId: input.tenantId, deletedAt: null, startsAt: period },
          orderBy: [{ startsAt: 'desc' }],
          take: INSIGHT_EVENT_LIMIT,
          select: { id: true, title: true, slug: true, status: true, startsAt: true, endsAt: true },
        }),
      ]);

      const eventIds = events.map((row) => row.id);

      const [registrations, attendances, certificates, messages, totalMessages, cards, xp, emails, unread] =
        await Promise.all([
          tx.registration.groupBy({
            by: ['eventId', 'status'],
            where: { tenantId: input.tenantId, deletedAt: null, eventId: { in: eventIds } },
            _count: { _all: true },
          }),
          tx.attendance.groupBy({
            by: ['eventId'],
            where: { tenantId: input.tenantId, eventId: { in: eventIds } },
            _count: { _all: true },
            _sum: { minutesAttended: true },
          }),
          tx.certificate.groupBy({
            by: ['eventId'],
            where: { tenantId: input.tenantId, eventId: { in: eventIds }, status: 'ISSUED' },
            _count: { _all: true },
          }),
          tx.participantMessage.groupBy({
            by: ['eventId'],
            where: { tenantId: input.tenantId, eventId: { in: eventIds }, sentAt: period },
            _count: { _all: true },
          }),
          /**
           * O TOTAL de recados é contado SEM o recorte de evento — e a diferença é o
           * ponto: um recado da INSTITUIÇÃO (sem evento) não pertence a nenhum item da
           * série, mas continua sendo comunicação que a instituição fez no período. Se
           * o total saísse da soma da série, todo recado institucional desapareceria do
           * panorama (foi o defeito que o teste pegou).
           */
          tx.participantMessage.count({
            where: { tenantId: input.tenantId, sentAt: period },
          }),
          tx.userCard.aggregate({
            where: { tenantId: input.tenantId, grantedAt: period },
            _sum: { quantity: true },
          }),
          tx.xpTransaction.aggregate({
            where: { tenantId: input.tenantId, createdAt: period },
            _sum: { amount: true },
          }),
          tx.emailMessage.groupBy({
            by: ['status'],
            where: { tenantId: input.tenantId, createdAt: period },
            _count: { _all: true },
          }),
          tx.participantMessage.count({
            where: { tenantId: input.tenantId, sentAt: period, readAt: null },
          }),
        ]);

      const confirmedByEvent = new Map<string, number>();
      const attendedByEvent = new Map<string, number>();

      for (const row of registrations) {
        if (row.status === 'CONFIRMED' || row.status === 'ATTENDED') {
          confirmedByEvent.set(row.eventId, (confirmedByEvent.get(row.eventId) ?? 0) + row._count._all);
        }
        if (row.status === 'ATTENDED') {
          attendedByEvent.set(row.eventId, (attendedByEvent.get(row.eventId) ?? 0) + row._count._all);
        }
      }

      const visitsByEvent = new Map(attendances.map((row) => [row.eventId, row._count._all]));
      const minutesByEvent = new Map(attendances.map((row) => [row.eventId, row._sum.minutesAttended ?? 0]));
      const certificatesByEvent = new Map(certificates.map((row) => [row.eventId, row._count._all]));
      const messagesByEvent = new Map(
        messages.filter((row) => row.eventId !== null).map((row) => [row.eventId as string, row._count._all]),
      );

      const series: InstitutionEventInsight[] = events.map((row) => {
        const confirmed = confirmedByEvent.get(row.id) ?? 0;
        const attended = attendedByEvent.get(row.id) ?? 0;

        return {
          eventId: row.id,
          title: row.title,
          slug: row.slug,
          status: row.status,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          confirmed,
          attended,
          visits: visitsByEvent.get(row.id) ?? 0,
          minutes: minutesByEvent.get(row.id) ?? 0,
          certificates: certificatesByEvent.get(row.id) ?? 0,
          messages: messagesByEvent.get(row.id) ?? 0,
          rate: attendanceRate({ confirmed, attended }),
        };
      });

      const confirmed = series.reduce((total, row) => total + row.confirmed, 0);
      const attended = series.reduce((total, row) => total + row.attended, 0);
      const visits = series.reduce((total, row) => total + row.visits, 0);
      const minutes = series.reduce((total, row) => total + row.minutes, 0);
      const emailCount = (status: 'SENT' | 'FAILED' | 'QUEUED' | 'SKIPPED'): number =>
        emails.find((row) => row.status === status)?._count._all ?? 0;

      return {
        ok: true as const,
        insight: {
          range: {
            range: window.range,
            label: window.label,
            from: window.from,
            to: window.to,
            timeZone: window.timeZone,
          },
          totals: {
            participants: Number(participantsRows[0]?.total ?? 0),
            events: series.length,
            publishedEvents: series.filter(
              (row) => row.status === 'PUBLISHED' || row.status === 'REGISTRATION_OPEN',
            ).length,
            confirmed,
            attended,
            rate: attendanceRate({ confirmed, attended }),
            visits,
            minutes,
            averageMinutes: averageMinutesPerVisit({ minutes, visits }),
            certificates: series.reduce((total, row) => total + row.certificates, 0),
            cards: cards._sum.quantity ?? 0,
            xp: xp._sum.amount ?? 0,
            messages: totalMessages,
            unreadMessages: unread,
            emailsSent: emailCount('SENT') + emailCount('SKIPPED'),
            emailsFailed: emailCount('FAILED'),
            emailsQueued: emailCount('QUEUED'),
          },
          events: series,
        },
      };
    });
  } catch (error) {
    console.error(`[participants] falha ao apurar a inteligência da instituição: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível apurar os números da instituição.' };
  }
}
