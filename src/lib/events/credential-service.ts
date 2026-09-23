/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Crachá, credenciamento e frequência (FASE 31)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE SERVIÇO SEPARA, E POR QUE ISSO IMPORTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Antes desta fase, "credenciar" e "coletar frequência" eram o MESMO clique, por
 *  inscrição: marcar `registration.checkedInAt` e criar uma presença com o
 *  `activityId` daquela inscrição. Consequências reais:
 *
 *    • credenciar alguém na portaria NÃO registrava presença em atividade nenhuma
 *      (a inscrição do evento tem `activityId` nulo) — e é a atividade que compõe a
 *      carga do certificado, o peso do sorteio e a carta de presença total;
 *    • quem tinha inscrição no evento e em dois minicursos tinha TRÊS crachás, porque
 *      o código morava na inscrição;
 *    • a presença em atividade só existia por inscrição — quem aparecia na oficina
 *      sem inscrição não tinha como ser registrado (e isso acontece).
 *
 *  Aqui:
 *    • o CRACHÁ é da pessoa no evento (`event_credentials`, um código opaco);
 *    • o CREDENCIAMENTO é o fato "chegou ao evento" (presença com `activityId` nulo);
 *    • a FREQUÊNCIA é o fato "esteve NESTA atividade, por N minutos" (uma linha de
 *      `attendances` por sessão, com entrada e saída);
 *    • o MONITOR escolhe o CONTEXTO da leitura — e é o contexto que decide onde o
 *      fato é gravado, nunca o código lido.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS REGRAS DE REÚSO (para não existirem duas versões da mesma regra)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. Credenciar na portaria quem TEM inscrição no evento chama o `checkIn` de
 *     sempre: XP, cartas, fila do balcão e idempotência continuam vindo de um lugar
 *     só (armadilha 55);
 *  2. Fechar a presença de quem TEM inscrição na atividade chama o `checkOut` de
 *     sempre, pelo mesmo motivo;
 *  3. Os MINUTOS vêm de `sessionMinutes` (domínio) nos dois caminhos — inclusive no
 *     `checkOut`, que antes contava "agora − entrada" e premiava o esquecimento.
 *
 *  A CONCORRÊNCIA é decidida no banco: cada leitura trava a linha do crachá com
 *  `SELECT ... FOR UPDATE`, então dois leitores do mesmo crachá se serializam e o
 *  segundo vê o estado gravado pelo primeiro (a mesma decisão da apuração do sorteio).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomInt, randomUUID } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { checkIn, checkOut } from '@/lib/events/attendance-service';
import {
  canRecordAttendance,
  sessionCloseOf,
  sessionMinutes,
} from '@/domain/events/attendance-rules';
import {
  MAX_BADGE_BATCH,
  badgeQrPayload,
  canUseCredential,
  credentialStateOf,
  generateBadgeCode,
  normalizeBadgeCode,
  type AttendanceContextRef,
  type CredentialState,
} from '@/domain/events/credential-rules';

export type CredentialErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'NO_ELIGIBLE'
  | 'ALREADY_REVOKED'
  | 'CHECKIN_DISABLED'
  | 'WINDOW_NOT_OPEN'
  | 'WINDOW_CLOSED'
  | 'ACTIVITY_CANCELED'
  | 'NOT_CONFIRMED'
  | 'INTERNAL';

export type CredentialResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: CredentialErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura da lista (a área de crachás)
// ───────────────────────────────────────────────────────────────────────────────
export interface CredentialRegistrationRow {
  registrationId: string;
  activityId: string | null;
  activityTitle: string | null;
  status: string;
  checkedInAt: Date | null;
}

export interface CredentialRosterEntry {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  registrations: CredentialRegistrationRow[];
  credential: {
    id: string;
    code: string;
    state: CredentialState;
    issuedAt: Date;
    printedAt: Date | null;
    revokedAt: Date | null;
    /** Código impresso antes desta fase (legado), sem o formato novo. */
    legacy: boolean;
  } | null;
  /** Quando a pessoa foi credenciada na portaria (presença com `activityId` nulo). */
  arrivedAt: Date | null;
  /** Quantas atividades já têm presença registrada. */
  attendedActivities: number;
  minutesAttended: number;
}

export interface CredentialRoster {
  entries: CredentialRosterEntry[];
  total: number;
  withCredential: number;
  withoutCredential: number;
  arrived: number;
}

const ROSTER_LIMIT = 500;

/**
 * Todos os participantes do evento — inscritos no evento **ou** em alguma atividade,
 * mais quem tem crachá emitido (equipe, palestrante, imprensa, visitante).
 *
 * A lista é a base da área de crachás: emitir, reimprimir, revogar e conferir quem
 * já foi credenciado. `query` filtra por nome, e-mail, código do crachá ou título da
 * atividade — é o que o balcão usa quando o leitor falha.
 */
export async function listCredentialRoster(input: {
  tenantId: string;
  eventId: string;
  query?: string | null;
  /** Só quem ainda NÃO tem crachá (o caminho de "emitir os que faltam"). */
  onlyMissing?: boolean;
}): Promise<CredentialResult<CredentialRoster>> {
  const query = input.query?.trim() ?? '';

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const registrations = await tx.registration.findMany({
        where: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          deletedAt: null,
          status: { not: 'CANCELED' },
        },
        orderBy: [{ createdAt: 'asc' }],
        select: {
          id: true,
          userId: true,
          activityId: true,
          status: true,
          checkedInAt: true,
          activity: { select: { title: true } },
        },
      });

      const credentials = await tx.eventCredential.findMany({
        where: { tenantId: input.tenantId, eventId: input.eventId },
        select: {
          id: true,
          userId: true,
          code: true,
          status: true,
          issuedAt: true,
          printedAt: true,
          revokedAt: true,
        },
      });

      /**
       * As presenças entram agregadas: a tela mostra "chegou às 14h02" e
       * "3 atividades · 240 min", e trazer cada sessão para montar isso na memória
       * seria carregar o evento inteiro na lista.
       */
      const attendances = await tx.attendance.findMany({
        where: { tenantId: input.tenantId, eventId: input.eventId },
        select: { userId: true, activityId: true, checkedInAt: true, minutesAttended: true },
      });

      const credentialByUser = new Map(credentials.map((row) => [row.userId, row]));
      const registrationByUser = new Map<string, CredentialRegistrationRow[]>();

      for (const row of registrations) {
        const list = registrationByUser.get(row.userId) ?? [];
        list.push({
          registrationId: row.id,
          activityId: row.activityId,
          activityTitle: row.activity?.title ?? null,
          status: row.status,
          checkedInAt: row.checkedInAt,
        });
        registrationByUser.set(row.userId, list);
      }

      const arrivalByUser = new Map<string, Date>();
      const minutesByUser = new Map<string, number>();
      const activitiesByUser = new Map<string, Set<string>>();

      for (const row of attendances) {
        if (row.activityId === null) {
          const current = arrivalByUser.get(row.userId);
          if (!current || row.checkedInAt.getTime() < current.getTime()) {
            arrivalByUser.set(row.userId, row.checkedInAt);
          }
        } else {
          const set = activitiesByUser.get(row.userId) ?? new Set<string>();
          set.add(row.activityId);
          activitiesByUser.set(row.userId, set);
          minutesByUser.set(
            row.userId,
            (minutesByUser.get(row.userId) ?? 0) + Math.max(0, row.minutesAttended ?? 0),
          );
        }
      }

      /**
       * A união é feita pelo `userId`: quem tem inscrição, quem tem crachá, e quem
       * tem os dois. Um visitante com crachá emitido à mão aparece na lista; um
       * inscrito que ainda não tem crachá também — é ele que falta emitir.
       */
      const userIds = [
        ...new Set([...registrationByUser.keys(), ...credentials.map((row) => row.userId)]),
      ].filter((userId) => registrationByUser.has(userId) || credentialByUser.has(userId));

      const people = await tx.user.findMany({
        where: { id: { in: userIds } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, email: true, image: true },
      });

      const entries: CredentialRosterEntry[] = people.map((person) => {
        const credential = credentialByUser.get(person.id);
        const rows = registrationByUser.get(person.id) ?? [];

        return {
          userId: person.id,
          name: person.name,
          email: person.email,
          image: person.image,
          registrations: rows,
          credential: credential
            ? {
                id: credential.id,
                code: credential.code,
                state: credentialStateOf(credential),
                issuedAt: credential.issuedAt,
                printedAt: credential.printedAt,
                revokedAt: credential.revokedAt,
                legacy: normalizeBadgeCode(credential.code) === null,
              }
            : null,
          arrivedAt: arrivalByUser.get(person.id) ?? null,
          attendedActivities: activitiesByUser.get(person.id)?.size ?? 0,
          minutesAttended: minutesByUser.get(person.id) ?? 0,
        };
      });

      const needle = query.toLocaleLowerCase('pt-BR');

      const filtered = entries.filter((entry) => {
        if (input.onlyMissing && entry.credential && entry.credential.state === 'ACTIVE') return false;

        if (needle.length === 0) return true;

        const haystack = [
          entry.name,
          entry.email,
          entry.credential?.code ?? '',
          ...entry.registrations.map((row) => row.activityTitle ?? 'inscrição no evento'),
        ]
          .join(' ')
          .toLocaleLowerCase('pt-BR');

        return haystack.includes(needle);
      });

      return {
        ok: true as const,
        entries: filtered.slice(0, ROSTER_LIMIT),
        total: filtered.length,
        withCredential: entries.filter((entry) => entry.credential !== null).length,
        withoutCredential: entries.filter((entry) => entry.credential === null).length,
        arrived: entries.filter((entry) => entry.arrivedAt !== null).length,
      };
    });
  } catch (error) {
    console.error(`[credentials] falha ao listar participantes: ${errorMessage(error)}`);

    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível carregar a lista de participantes.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Emissão
// ───────────────────────────────────────────────────────────────────────────────
export interface IssuedCredential {
  userId: string;
  userName: string;
  credentialId: string;
  code: string;
}

/**
 * Emite crachás — para quem falta, ou para uma lista explícita de pessoas.
 *
 * Sem `userIds`, emite para TODOS os inscritos no evento ou em atividades que ainda
 * não têm crachá (é o "emitir os que faltam" da área de crachás). Com `userIds`,
 * emite para as pessoas indicadas, mesmo sem inscrição — é o caminho de equipe,
 * palestrante, imprensa e visitante.
 *
 * Idempotente por (evento, pessoa): quem já tem crachá ativo é PULADO, e não recebe
 * outro código. Reemitir é ato explícito (`reissueCredential`), porque um crachá novo
 * invalida o que está na mão de alguém.
 */
export async function issueCredentials(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  userIds?: readonly string[];
  notes?: string | null;
}): Promise<CredentialResult<{ issued: IssuedCredential[]; skipped: number; truncated: boolean }>> {
  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, title: true },
      });

      if (!event) return { error: 'NOT_FOUND' as const };

      const explicit = input.userIds && input.userIds.length > 0 ? [...new Set(input.userIds)] : null;

      let candidateIds: string[];

      if (explicit) {
        const people = await tx.userTenantProfile.findMany({
          where: { tenantId: input.tenantId, userId: { in: explicit }, deletedAt: null },
          select: { userId: true },
        });

        candidateIds = people.map((row) => row.userId);
      } else {
        const registrations = await tx.registration.findMany({
          where: {
            tenantId: input.tenantId,
            eventId: input.eventId,
            deletedAt: null,
            status: { not: 'CANCELED' },
          },
          select: { userId: true },
        });

        candidateIds = [...new Set(registrations.map((row) => row.userId))];
      }

      const existing = await tx.eventCredential.findMany({
        where: { tenantId: input.tenantId, eventId: input.eventId, userId: { in: candidateIds } },
        select: { userId: true, status: true, revokedAt: true },
      });

      /**
       * Quem tem crachá ATIVO é pulado. Quem tem crachá REVOGADO entra na emissão de
       * novo — o código revogado sai de circulação, e o índice único (evento, pessoa)
       * é ocupado pela reemissão, que também registra a revogação na trilha.
       */
      const active = new Set(
        existing.filter((row) => credentialStateOf(row) === 'ACTIVE').map((row) => row.userId),
      );
      const revoked = new Map(
        existing.filter((row) => credentialStateOf(row) === 'REVOKED').map((row) => [row.userId, row]),
      );

      const missing = candidateIds.filter((userId) => !active.has(userId));
      const truncated = missing.length > MAX_BADGE_BATCH;
      const target = missing.slice(0, MAX_BADGE_BATCH);

      if (target.length === 0) return { issued: [] as IssuedCredential[], skipped: candidateIds.length, truncated: false };

      const people = await tx.user.findMany({
        where: { id: { in: target } },
        select: { id: true, name: true },
      });
      const nameById = new Map(people.map((person) => [person.id, person.name]));

      const issued: IssuedCredential[] = [];

      for (const userId of target) {
        const code = await uniqueBadgeCode(tx, generateBadgeCode);
        const existingRow = await tx.eventCredential.findFirst({
          where: { tenantId: input.tenantId, eventId: input.eventId, userId },
          select: { id: true, status: true, revokedAt: true },
        });

        if (existingRow) {
          await tx.eventCredential.update({
            where: { id: existingRow.id },
            data: {
              code,
              status: 'ACTIVE',
              issuedById: input.actorId,
              issuedAt: new Date(),
              printedAt: null,
              printedById: null,
              revokedAt: null,
              revokedById: null,
              revokeReason: null,
              notes: input.notes ?? null,
            },
          });

          issued.push({
            userId,
            userName: nameById.get(userId) ?? 'Participante',
            credentialId: existingRow.id,
            code,
          });
          continue;
        }

        const created = await tx.eventCredential.create({
          data: {
            id: randomUUID(),
            tenantId: input.tenantId,
            eventId: input.eventId,
            userId,
            code,
            status: 'ACTIVE',
            issuedById: input.actorId,
            notes: input.notes ?? null,
          },
          select: { id: true },
        });

        issued.push({
          userId,
          userName: nameById.get(userId) ?? 'Participante',
          credentialId: created.id,
          code,
        });
      }

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'credential',
          entityId: input.eventId,
          changes: {
            eventId: { from: null, to: input.eventId },
            issued: { from: null, to: issued.length },
            skipped: { from: null, to: candidateIds.length - target.length },
            codes: { from: null, to: issued.map((entry) => entry.code).join(', ') },
            revokedReissued: { from: null, to: revoked.size },
          },
        },
        tx,
      );

      return { issued, skipped: candidateIds.length - target.length, truncated };
    });

    if ('error' in result) {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
    }

    return { ok: true as const, ...result };
  } catch (error) {
    console.error(`[credentials] falha ao emitir crachás: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível emitir os crachás.' };
  }
}

/** Sorteia um código que ainda não existe (a unicidade é global). */
async function uniqueBadgeCode(tx: TxClient, generate: (randomInt: (max: number) => number) => string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = generate((max) => randomInt(max));
    const taken = await tx.eventCredential.findUnique({ where: { code }, select: { id: true } });

    if (!taken) return code;
  }

  /**
   * Doze colisões seguidas com 30^8 combinações significam gerador quebrado — e um
   * crachá repetido ligaria duas pessoas ao mesmo QR. Falhar alto é a resposta certa.
   */
  throw new Error('Não foi possível gerar um código de crachá único.');
}

/** Revoga um crachá: o código sai de circulação e a trilha guarda o motivo. */
export async function revokeCredential(input: {
  tenantId: string;
  credentialId: string;
  actorId: string;
  reason: string;
  now?: Date;
}): Promise<CredentialResult<{ credentialId: string; reason: string }>> {
  const reason = input.reason.trim();

  if (reason.length < 5) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Descreva o motivo da revogação (mínimo 5 caracteres).',
    };
  }

  try {
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const row = await tx.eventCredential.findFirst({
        where: { id: input.credentialId, tenantId: input.tenantId },
        select: { id: true, code: true, revokedAt: true, eventId: true },
      });

      if (!row) return { error: 'NOT_FOUND' as const };
      if (row.revokedAt) return { error: 'ALREADY_REVOKED' as const };

      await tx.eventCredential.update({
        where: { id: row.id },
        data: {
          status: 'REVOKED',
          revokedAt: input.now ?? new Date(),
          revokedById: input.actorId,
          revokeReason: reason,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'credential',
          entityId: row.id,
          changes: {
            code: { from: row.code, to: row.code },
            status: { from: 'ACTIVE', to: 'REVOKED' },
            reason: { from: null, to: reason },
          },
        },
        tx,
      );

      return { credentialId: row.id, reason };
    });

    if ('error' in outcome) {
      return outcome.error === 'NOT_FOUND'
        ? { ok: false, code: 'NOT_FOUND', message: 'Crachá não encontrado.' }
        : { ok: false, code: 'ALREADY_REVOKED', message: 'Este crachá já está revogado.' };
    }

    return { ok: true as const, ...outcome };
  } catch (error) {
    console.error(`[credentials] falha ao revogar crachá: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível revogar o crachá.' };
  }
}

/** Marca que os crachás foram impressos (a folha pode ser reimpressa depois). */
export async function markCredentialsPrinted(input: {
  tenantId: string;
  credentialIds: readonly string[];
  actorId: string;
  now?: Date;
}): Promise<CredentialResult<{ printed: number }>> {
  if (input.credentialIds.length === 0) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione ao menos um crachá.' };
  }

  try {
    const printed = await withTenant(input.tenantId, async (tx) => {
      const updated = await tx.eventCredential.updateMany({
        where: { tenantId: input.tenantId, id: { in: [...input.credentialIds] } },
        data: { printedAt: input.now ?? new Date(), printedById: input.actorId },
      });

      return updated.count;
    });

    return { ok: true as const, printed };
  } catch (error) {
    console.error(`[credentials] falha ao marcar impressão: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível registrar a impressão.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura no balcão (o monitor)
// ───────────────────────────────────────────────────────────────────────────────
export interface CredentialScanTarget {
  credentialId: string;
  code: string;
  state: CredentialState;
  userId: string;
  userName: string;
  userEmail: string;
  userImage: string | null;
  /** A pessoa tem inscrição CONFIRMADA neste contexto? */
  registered: boolean;
  registrationStatus: string | null;
  /** Sessão ABERTA neste contexto (entrada sem saída), com os minutos decorridos. */
  openSession: { attendanceId: string; checkedInAt: Date; minutes: number } | null;
  /** Minutos já fechados neste contexto. */
  closedMinutes: number;
  /** Quando chegou ao evento (presença com `activityId` nulo). */
  arrivedAt: Date | null;
  /** Inscrições da pessoa no evento, para o monitor decidir. */
  registrations: { activityId: string | null; activityTitle: string | null; status: string }[];
}

interface ResolvedCredential {
  credentialId: string;
  code: string;
  state: CredentialState;
  userId: string;
  /** Achado pelo token legado, e não pelo crachá novo. */
  legacy: boolean;
}

/**
 * Encontra a pessoa a partir do que o leitor mandou.
 *
 * Aceita três coisas, porque o balcão tem três:
 *   • o código novo (`CR-XXXX-XXXX`), normalizado;
 *   • o código LEGADO gravado antes desta fase (o backfill trouxe os tokens
 *     existentes para a tabela nova, e eles continuam valendo);
 *   • o token na coluna antiga `registrations.badgeToken`, para um crachá emitido
 *     entre a migração e a primeira leitura (nada é apagado; a leitura tenta o
 *     legado em vez de responder "não encontrado").
 */
async function resolveCredential(tx: TxClient, tenantId: string, rawCode: string): Promise<ResolvedCredential | null> {
  const normalized = normalizeBadgeCode(rawCode);
  const typed = rawCode.trim();

  /**
   * O token LEGADO entra na busca na CAIXA EXATA em que foi digitado/lido.
   *
   * O código novo (`CR-…`) é nosso e por isso pode ser normalizado — quem digita
   * `cr j2fw ynf5` quer o mesmo crachá. O token da coluna antiga, não: ele é uma
   * string opaca, escrita por outra geração do sistema, e a etiqueta impressa carrega
   * aquele texto letra por letra. Promover tudo a maiúsculas fazia o crachá já
   * impresso parar de ser encontrado (o defeito apareceu no E2E da jornada, cujo
   * token de fixture tem hex minúsculo) — e o balcão responderia "não encontrado"
   * para um crachá que está na mão da pessoa.
   */
  const candidates = [...new Set([normalized, typed, typed.toUpperCase()].filter(Boolean))] as string[];

  const row = await tx.eventCredential.findFirst({
    where: { tenantId, code: { in: candidates } },
    select: { id: true, code: true, status: true, revokedAt: true, userId: true },
  });

  if (row) {
    return {
      credentialId: row.id,
      code: row.code,
      state: credentialStateOf(row),
      userId: row.userId,
      legacy: normalized === null,
    };
  }

  const registration = await tx.registration.findFirst({
    where: { tenantId, badgeToken: { in: candidates }, deletedAt: null },
    orderBy: [{ checkedInAt: 'asc' }],
    select: { id: true, userId: true, eventId: true, badgeToken: true },
  });

  if (!registration) return null;

  /**
   * O token legado ainda não virou crachá (a inscrição é posterior à migração):
   * cria o crachá agora, com o MESMO código — é o que permite o crachá já impresso
   * continuar funcionando sem que ninguém reimprima nada.
   */
  const created = await tx.eventCredential.upsert({
    where: { eventId_userId: { eventId: registration.eventId, userId: registration.userId } },
    create: {
      id: randomUUID(),
      tenantId,
      eventId: registration.eventId,
      userId: registration.userId,
      code: registration.badgeToken!,
      status: 'ACTIVE',
    },
    update: {},
    select: { id: true, code: true, status: true, revokedAt: true, userId: true },
  });

  return {
    credentialId: created.id,
    code: created.code,
    state: credentialStateOf(created),
    userId: created.userId,
    legacy: true,
  };
}

/** Lê o crachá e devolve o que o balcão precisa ver — sem gravar nada. */
export async function readCredential(input: {
  tenantId: string;
  eventId: string;
  code: string;
  context: AttendanceContextRef;
}): Promise<CredentialResult<{ target: CredentialScanTarget }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const resolved = await resolveCredential(tx, input.tenantId, input.code);

      if (!resolved) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Crachá não encontrado nesta instituição. Confira o código ou busque pelo nome.',
        };
      }

      const target = await buildScanTarget(tx, {
        tenantId: input.tenantId,
        eventId: input.eventId,
        context: input.context,
        resolved,
        now: new Date(),
      });

      return { ok: true as const, target };
    });
  } catch (error) {
    console.error(`[credentials] falha ao ler crachá: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível ler o crachá.' };
  }
}

async function buildScanTarget(
  tx: TxClient,
  input: {
    tenantId: string;
    eventId: string;
    context: AttendanceContextRef;
    resolved: ResolvedCredential;
    now: Date;
  },
): Promise<CredentialScanTarget> {
  const activityId = input.context.kind === 'ACTIVITY' ? (input.context.activityId ?? null) : null;

  const [person, registrations, sessions] = await Promise.all([
    tx.user.findUniqueOrThrow({
      where: { id: input.resolved.userId },
      select: { id: true, name: true, email: true, image: true },
    }),
    tx.registration.findMany({
      where: {
        tenantId: input.tenantId,
        eventId: input.eventId,
        userId: input.resolved.userId,
        deletedAt: null,
      },
      select: { activityId: true, status: true, activity: { select: { title: true } } },
    }),
    tx.attendance.findMany({
      where: {
        tenantId: input.tenantId,
        eventId: input.eventId,
        userId: input.resolved.userId,
        activityId,
      },
      orderBy: { checkedInAt: 'desc' },
      select: { id: true, checkedInAt: true, checkedOutAt: true, minutesAttended: true },
    }),
  ]);

  const relevant = registrations.find((row) => row.activityId === activityId) ?? null;
  const open = sessions.find((row) => row.checkedOutAt === null) ?? null;

  const arrivedAt =
    activityId === null
      ? (sessions.find((row) => row.checkedOutAt === null)?.checkedInAt ??
        sessions[sessions.length - 1]?.checkedInAt ??
        null)
      : null;

  return {
    credentialId: input.resolved.credentialId,
    code: input.resolved.code,
    state: input.resolved.state,
    userId: person.id,
    userName: person.name,
    userEmail: person.email,
    userImage: person.image,
    registered: relevant !== null && (relevant.status === 'CONFIRMED' || relevant.status === 'ATTENDED'),
    registrationStatus: relevant?.status ?? null,
    openSession: open
      ? {
          attendanceId: open.id,
          checkedInAt: open.checkedInAt,
          minutes: sessionMinutes({ checkedInAt: open.checkedInAt, closedAt: input.now }),
        }
      : null,
    closedMinutes: sessions
      .filter((row) => row.checkedOutAt !== null)
      .reduce((sum, row) => sum + Math.max(0, row.minutesAttended ?? 0), 0),
    arrivedAt,
    registrations: registrations.map((row) => ({
      activityId: row.activityId,
      activityTitle: row.activity?.title ?? null,
      status: row.status,
    })),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Registrar presença (entrada e saída)
// ───────────────────────────────────────────────────────────────────────────────
export interface PresenceOutcome {
  action: 'CHECKED_IN' | 'CHECKED_OUT' | 'ALREADY_INSIDE' | 'NOT_INSIDE';
  attendanceId: string | null;
  minutes: number | null;
  target: CredentialScanTarget;
  /** Avulsos que o monitor precisa ler em voz alta (sem inscrição, revogado, etc.). */
  warnings: string[];
  /** XP/cartas creditados, quando houve. */
  rewarded: boolean;
}

/**
 * Registra a presença no CONTEXTO escolhido pelo monitor.
 *
 * `mode`:
 *   • `IN` — entrada (padrão): abre uma sessão de presença;
 *   • `OUT` — saída: fecha a sessão aberta e calcula os minutos;
 *   • `TOGGLE` — o botão único do balcão: entra se estiver fora, sai se estiver dentro.
 *
 * Quando a pessoa TEM inscrição no contexto, quem grava é o serviço de presença de
 * sempre (`checkIn`/`checkOut`) — XP, cartas, fila do balcão e idempotência vêm de um
 * lugar só. Sem inscrição, a sessão é gravada aqui mesmo: **a presença de quem
 * apareceu sem inscrição é um fato real**, e recusá-la na porta seria pior que
 * registrá-la (com aviso na tela).
 */
export async function recordCredentialPresence(input: {
  tenantId: string;
  eventId: string;
  code: string;
  context: AttendanceContextRef;
  actorId: string;
  mode?: 'IN' | 'OUT' | 'TOGGLE';
  now?: Date;
  readAt?: Date;
  idempotencyKey?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Fonte gravada na presença — o toggle do balcão usa `QR_CODE_*`. */
  source?: 'QR_CODE_CHECKIN' | 'QR_CODE_CHECKOUT' | 'MANUAL_STAFF';
}): Promise<CredentialResult<PresenceOutcome>> {
  const now = input.readAt ?? input.now ?? new Date();
  const mode = input.mode ?? 'IN';
  const warnings: string[] = [];

  try {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O CRACHÁ É TRAVADO ANTES DE QUALQUER ESCRITA
     * ─────────────────────────────────────────────────────────────────────────────
     *  Dois monitores lendo o MESMO crachá ao mesmo tempo (a pessoa passa duas vezes,
     *  ou dois leitores na mesma porta) precisam se serializar: sem a trava, os dois
     *  abririam sessão e a presença sairia duplicada. O crachá é único por
     *  (evento, pessoa), então travar a linha dele serializa tudo o que acontece com
     *  aquela pessoa neste evento.
     */
    const locked = await withTenant(input.tenantId, async (tx) => {
      const resolved = await resolveCredential(tx, input.tenantId, input.code);
      if (!resolved) return { error: 'NOT_FOUND' as const };

      await tx.$executeRaw`
        SELECT id FROM "event_credentials"
         WHERE id = ${resolved.credentialId}::uuid
           AND "tenantId" = ${input.tenantId}::uuid
         FOR UPDATE
      `;

      return { resolved };
    });

    if ('error' in locked) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Crachá não encontrado nesta instituição. Confira o código ou busque pelo nome.',
      };
    }

    const { resolved } = locked;

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  IDEMPOTÊNCIA POR CHAVE DE LEITURA (FASE 35 · OFFLINE-FIRST)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Se a mesma leitura offline for sincronizada mais de uma vez ou reenviada por
     *  oscilação de rede, o `qrNonce` (chave única da leitura) impede replays.
     */
    if (input.idempotencyKey) {
      const existing = await withTenant(input.tenantId, (tx) =>
        tx.attendance.findFirst({
          where: {
            tenantId: input.tenantId,
            eventId: input.eventId,
            qrNonce: input.idempotencyKey,
          },
          select: {
            id: true,
            checkedInAt: true,
            checkedOutAt: true,
            minutesAttended: true,
          },
        }),
      );

      if (existing) {
        const target = await withTenant(input.tenantId, (tx) =>
          buildScanTarget(tx, { tenantId: input.tenantId, eventId: input.eventId, context: input.context, resolved, now }),
        );

        return {
          ok: true as const,
          action: existing.checkedOutAt ? ('CHECKED_OUT' as const) : ('CHECKED_IN' as const),
          attendanceId: existing.id,
          minutes: existing.minutesAttended,
          target,
          warnings: ['Leitura já sincronizada anteriormente (idempotente).'],
          rewarded: false,
        };
      }
    }

    const usable = canUseCredential({ status: resolved.state === 'ACTIVE' ? 'ACTIVE' : 'REVOKED', revokedAt: resolved.state === 'REVOKED' ? now : null });

    if (!usable.ok) {
      // A leitura continua válida: o monitor precisa VER de quem é o crachá para
      // resolver no balcão. O que não acontece é o registro da presença.
      const target = await withTenant(input.tenantId, (tx) =>
        buildScanTarget(tx, { tenantId: input.tenantId, eventId: input.eventId, context: input.context, resolved, now }),
      );

      return {
        ok: false,
        code: 'ALREADY_REVOKED',
        message: usable.reason ?? 'Crachá revogado.',
        details: [target.userName],
      };
    }

    const activityId = input.context.kind === 'ACTIVITY' ? (input.context.activityId ?? null) : null;

    if (input.context.kind === 'ACTIVITY') {
      if (!activityId) {
        return { ok: false, code: 'INVALID_INPUT', message: 'Escolha a atividade antes de ler o crachá.' };
      }

      const activity = await withTenant(input.tenantId, (tx) =>
        tx.activity.findFirst({
          where: { id: activityId, tenantId: input.tenantId, eventId: input.eventId, deletedAt: null },
          select: {
            id: true,
            title: true,
            status: true,
            checkInEnabled: true,
            checkInOpensAt: true,
            checkInClosesAt: true,
          },
        }),
      );

      if (!activity) {
        return { ok: false, code: 'NOT_FOUND', message: 'Atividade não encontrada neste evento.' };
      }

      const window = canRecordAttendance({ activity, now });

      if (!window.ok) {
        return {
          ok: false,
          code: window.code,
          message: window.message,
          details: [activity.title],
        };
      }
    }

    const registration = await withTenant(input.tenantId, (tx) =>
      tx.registration.findFirst({
        where: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          userId: resolved.userId,
          activityId,
          deletedAt: null,
          status: { not: 'CANCELED' },
        },
        orderBy: [{ createdAt: 'desc' }],
        select: { id: true, status: true, checkedInAt: true },
      }),
    );

    const targetBefore = await withTenant(input.tenantId, (tx) =>
      buildScanTarget(tx, { tenantId: input.tenantId, eventId: input.eventId, context: input.context, resolved, now }),
    );

    const wantsOut = mode === 'OUT' || (mode === 'TOGGLE' && targetBefore.openSession !== null);

    if (wantsOut) {
      if (!targetBefore.openSession) {
        return {
          ok: true as const,
          action: 'NOT_INSIDE' as const,
          attendanceId: null,
          minutes: null,
          target: targetBefore,
          warnings: ['Não havia entrada registrada neste contexto — nada a fechar.'],
          rewarded: false,
        };
      }

      /**
       * Com inscrição, quem fecha é o `checkOut` de sempre (XP, cartas e a conquista
       * de presença total saem de lá). Sem inscrição, fecha aqui, com a MESMA regra de
       * minutos do domínio.
       */
      if (registration && activityId !== null) {
        const closed = await checkOut({
          tenantId: input.tenantId,
          registrationId: registration.id,
          staffUserId: input.actorId,
          now,
        });

        if (!closed.ok) {
          return { ok: false, code: closed.code as CredentialErrorCode, message: closed.message };
        }

        const target = await withTenant(input.tenantId, (tx) =>
          buildScanTarget(tx, { tenantId: input.tenantId, eventId: input.eventId, context: input.context, resolved, now }),
        );

        return {
          ok: true as const,
          action: 'CHECKED_OUT' as const,
          attendanceId: targetBefore.openSession.attendanceId,
          minutes: closed.minutesAttended,
          target,
          warnings,
          rewarded: closed.rewards.length > 0,
        };
      }

      const attendance = await withTenant(input.tenantId, (tx) =>
        tx.attendance.findFirstOrThrow({
          where: { id: targetBefore.openSession!.attendanceId, tenantId: input.tenantId },
          select: { id: true, checkedInAt: true, activityId: true, activity: { select: { endsAt: true } } },
        }),
      );

      const minutes = sessionMinutes({
        checkedInAt: attendance.checkedInAt,
        closedAt: now,
        activityEndsAt: attendance.activity?.endsAt ?? null,
      });

      await withTenant(input.tenantId, (tx) =>
        tx.attendance.update({
          where: { id: attendance.id },
          data: { checkedOutAt: now, minutesAttended: minutes },
        }),
      );

      if (!registration) {
        warnings.push('Presença registrada SEM inscrição nesta atividade.');
      }

      const target = await withTenant(input.tenantId, (tx) =>
        buildScanTarget(tx, { tenantId: input.tenantId, eventId: input.eventId, context: input.context, resolved, now }),
      );

      return {
        ok: true as const,
        action: 'CHECKED_OUT' as const,
        attendanceId: attendance.id,
        minutes,
        target,
        warnings,
        rewarded: false,
      };
    }

    // ── Entrada ────────────────────────────────────────────────────────────────
    if (targetBefore.openSession) {
      return {
        ok: true as const,
        action: 'ALREADY_INSIDE' as const,
        attendanceId: targetBefore.openSession.attendanceId,
        minutes: null,
        target: targetBefore,
        warnings: [
          `Entrada já registrada às ${targetBefore.openSession.checkedInAt.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })}.`,
        ],
        rewarded: false,
      };
    }

    if (!registration) {
      warnings.push(
        activityId === null
          ? 'Esta pessoa não tem inscrição no evento — a chegada foi registrada mesmo assim.'
          : 'Presença registrada SEM inscrição nesta atividade.',
      );
    } else if (registration.status !== 'CONFIRMED' && registration.status !== 'ATTENDED') {
      warnings.push(`A inscrição desta pessoa está como ${registration.status} — confira na organização.`);
    }

    /**
     * ── A PRIMEIRA VISITA COM INSCRIÇÃO: O SERVIÇO DE PRESENÇA DE SEMPRE ────────
     *  `checkIn` marca a inscrição como credenciada, cria a presença, credita XP e é
     *  idempotente por `checkedInAt`/chave de XP. Reimplementar isso aqui criaria uma
     *  segunda versão da mesma regra (armadilha 55) e a gamificação deixaria de ver a
     *  portaria.
     *
     *  ─────────────────────────────────────────────────────────────────────────────
     *  SÓ NA PRIMEIRA VISITA — E ESTE `if` É O DEFEITO QUE O TESTE PEGOU
     *  ─────────────────────────────────────────────────────────────────────────────
     *  `checkIn` é idempotente por `registration.checkedInAt`: na SEGUNDA visita à
     *  mesma atividade ele responde "já credenciado" e NÃO abre sessão nova — o que é
     *  certo para a chegada ao evento (um fato por pessoa) e errado para FREQUÊNCIA
     *  (a pessoa sai para o almoço e volta; a sessão da tarde é outro fato, com os
     *  minutos dela). Depois da primeira vez, a sessão é criada aqui.
     */
    if (registration && registration.checkedInAt === null) {
      const checked = await checkIn({
        tenantId: input.tenantId,
        registrationId: registration.id,
        staffUserId: input.actorId,
        now,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        qrNonce: input.idempotencyKey ?? null,
      });

      if (!checked.ok) {
        if (checked.code === 'NOT_CONFIRMED') {
          warnings.push('A inscrição não está confirmada: a presença não foi registrada por este caminho.');
        } else {
          return { ok: false, code: checked.code as CredentialErrorCode, message: checked.message };
        }
      }

      const target = await withTenant(input.tenantId, (tx) =>
        buildScanTarget(tx, { tenantId: input.tenantId, eventId: input.eventId, context: input.context, resolved, now }),
      );

      if (!checked.ok) {
        return {
          ok: true as const,
          action: 'NOT_INSIDE' as const,
          attendanceId: null,
          minutes: null,
          target,
          warnings,
          rewarded: false,
        };
      }

      return {
        ok: true as const,
        action: checked.alreadyCheckedIn ? ('ALREADY_INSIDE' as const) : ('CHECKED_IN' as const),
        attendanceId: checked.attendanceId || null,
        minutes: null,
        target,
        warnings,
        rewarded: checked.reward !== null,
      };
    }

    /**
     * ── A SESSÃO É GRAVADA AQUI (visita nova, ou pessoa sem inscrição) ─────────
     *  A sessão nasce aberta e o monitor fecha na saída (ou o fechamento automático
     *  fecha no fim da atividade). Quando existe inscrição, ela vai LIGADA na linha —
     *  é por ela que a saída encontra a sessão (`checkOut` busca por `registrationId`)
     *  e por ela que a gamificação credita a frequência.
     */
    const created = await withTenant(input.tenantId, (tx) =>
      tx.attendance.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          eventId: input.eventId,
          activityId,
          registrationId: registration?.id ?? null,
          userId: resolved.userId,
          status: 'PRESENT',
          source: input.source ?? 'QR_CODE_CHECKIN',
          checkedInAt: now,
          validatedById: input.actorId,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
          qrNonce: input.idempotencyKey ?? null,
          minutesAttended: 0,
        },
        select: { id: true },
      }),
    );

    const target = await withTenant(input.tenantId, (tx) =>
      buildScanTarget(tx, { tenantId: input.tenantId, eventId: input.eventId, context: input.context, resolved, now }),
    );

    return {
      ok: true as const,
      action: 'CHECKED_IN' as const,
      attendanceId: created.id,
      minutes: null,
      target,
      warnings,
      rewarded: false,
    };
  } catch (error) {
    console.error(`[credentials] falha ao registrar presença: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível registrar a presença.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Fechamento das presenças abertas
// ───────────────────────────────────────────────────────────────────────────────
export interface SessionCloseSummary {
  closed: number;
  minutes: number;
}

/**
 * Fecha as sessões abertas de uma atividade (o botão "encerrar a atividade").
 *
 * Quem esqueceu de sair recebe a saída no FIM DA ATIVIDADE — nunca no momento em que
 * o botão foi clicado: o número tem de ser o mesmo todas as vezes que a conta for
 * refeita, e é esse número que pesa no sorteio e compõe a carga do certificado.
 */
export async function closeOpenSessions(input: {
  tenantId: string;
  eventId: string;
  activityId: string | null;
  actorId: string;
  now?: Date;
}): Promise<CredentialResult<SessionCloseSummary>> {
  const now = input.now ?? new Date();

  try {
    const summary = await withTenant(input.tenantId, async (tx) => {
      const open = await tx.attendance.findMany({
        where: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          activityId: input.activityId,
          checkedOutAt: null,
        },
        select: {
          id: true,
          checkedInAt: true,
          userId: true,
          activity: { select: { endsAt: true } },
        },
      });

      let closed = 0;
      let minutesTotal = 0;

      for (const session of open) {
        const endsAt = session.activity?.endsAt ?? null;

        /**
         * A portaria (sem atividade) não tem fim declarado: fechar ali seria inventar
         * um horário de saída. O que fecha é a atividade que terminou.
         */
        const close =
          input.activityId === null
            ? { closedAt: now, minutes: sessionMinutes({ checkedInAt: session.checkedInAt, closedAt: now }), autoClosed: false }
            : (sessionCloseOf({ checkedInAt: session.checkedInAt, activityEndsAt: endsAt, now }) ?? {
                closedAt: now,
                minutes: sessionMinutes({ checkedInAt: session.checkedInAt, closedAt: now, activityEndsAt: endsAt }),
                autoClosed: false,
              });

        await tx.attendance.update({
          where: { id: session.id },
          data: {
            checkedOutAt: close.closedAt,
            minutesAttended: close.minutes,
            notes: close.autoClosed ? 'Saída registrada no fim da atividade (fechamento automático).' : null,
          },
        });

        closed += 1;
        minutesTotal += close.minutes;
      }

      if (closed > 0) {
        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'attendance',
            entityId: input.activityId ?? input.eventId,
            changes: {
              sessionsClosed: { from: null, to: closed },
              minutes: { from: null, to: minutesTotal },
            },
          },
          tx,
        );
      }

      return { closed, minutes: minutesTotal };
    });

    return { ok: true as const, ...summary };
  } catch (error) {
    console.error(`[credentials] falha ao fechar presenças abertas: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível fechar as presenças abertas.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Crachá online do participante
// ───────────────────────────────────────────────────────────────────────────────
export interface OwnCredential {
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  startsAt: Date;
  credentialId: string;
  code: string;
  qrPayload: string;
  state: CredentialState;
  issuedAt: Date;
  /** O que a pessoa pode frequentar (a lista que o monitor vê). */
  registrations: { activityTitle: string | null; status: string }[];
  attendedActivities: number;
  minutesAttended: number;
}

/**
 * O crachá da PRÓPRIA pessoa — e, se ainda não existir, ele nasce aqui.
 *
 * "Gerar o crachá online" é o pedido: o participante abre a área dele e mostra o QR
 * na tela do celular. Emitir na primeira abertura é idempotente (um por pessoa por
 * evento) e não exige que a organização emita antes — e a emissão fica na trilha com
 * a própria pessoa como autora.
 */
export async function getOwnCredential(input: {
  tenantId: string;
  userId: string;
  eventId: string;
}): Promise<CredentialResult<OwnCredential>> {
  try {
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, title: true, slug: true, startsAt: true },
      });

      if (!event) return { error: 'NOT_FOUND' as const };

      const registrations = await tx.registration.findMany({
        where: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          userId: input.userId,
          deletedAt: null,
          status: { not: 'CANCELED' },
        },
        select: { activityId: true, status: true, activity: { select: { title: true } } },
      });

      const existing = await tx.eventCredential.findFirst({
        where: { tenantId: input.tenantId, eventId: input.eventId, userId: input.userId },
        select: { id: true, code: true, status: true, revokedAt: true, issuedAt: true },
      });

      let credential = existing;

      if (!credential) {
        if (registrations.length === 0) return { error: 'NO_ELIGIBLE' as const };

        const code = await uniqueBadgeCode(tx, generateBadgeCode);

        credential = await tx.eventCredential.create({
          data: {
            id: randomUUID(),
            tenantId: input.tenantId,
            eventId: input.eventId,
            userId: input.userId,
            code,
            status: 'ACTIVE',
            issuedById: input.userId,
            notes: 'Emitido pelo próprio participante na área dele.',
          },
          select: { id: true, code: true, status: true, revokedAt: true, issuedAt: true },
        });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.userId,
            action: 'CREATE',
            entityType: 'credential',
            entityId: credential.id,
            changes: {
              eventId: { from: null, to: input.eventId },
              code: { from: null, to: code },
              origin: { from: null, to: 'participante' },
            },
          },
          tx,
        );
      }

      const attendances = await tx.attendance.findMany({
        where: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          userId: input.userId,
          activityId: { not: null },
        },
        select: { activityId: true, minutesAttended: true },
      });

      return {
        event,
        credential,
        registrations,
        attendedActivities: new Set(attendances.map((row) => row.activityId)).size,
        minutesAttended: attendances.reduce((sum, row) => sum + Math.max(0, row.minutesAttended ?? 0), 0),
      };
    });

    if ('error' in outcome) {
      return outcome.error === 'NOT_FOUND'
        ? { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' }
        : {
            ok: false,
            code: 'NO_ELIGIBLE',
            message: 'Você não tem inscrição neste evento — fale com a organização para receber um crachá.',
          };
    }

    return {
      ok: true as const,
      eventId: outcome.event.id,
      eventTitle: outcome.event.title,
      eventSlug: outcome.event.slug,
      startsAt: outcome.event.startsAt,
      credentialId: outcome.credential.id,
      code: outcome.credential.code,
      qrPayload: badgeQrPayload(outcome.credential.code),
      state: credentialStateOf(outcome.credential),
      issuedAt: outcome.credential.issuedAt,
      registrations: outcome.registrations.map((row) => ({
        activityTitle: row.activity?.title ?? null,
        status: row.status,
      })),
      attendedActivities: outcome.attendedActivities,
      minutesAttended: outcome.minutesAttended,
    };
  } catch (error) {
    console.error(`[credentials] falha ao carregar o crachá: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível carregar o seu crachá.' };
  }
}
