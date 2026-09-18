/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Utilitários para os testes E2E
 *
 *  Criam instituições e vínculos diretamente no banco (via conexão admin),
 *  porque a plataforma ainda não expõe UI de provisionamento — isso chega na
 *  FASE 7. Os testes E2E focam no que o usuário faz no navegador.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.ts';

const connectionString =
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://eventflow_admin:eventflow_dev_password@localhost:5432/eventflow?schema=public';

export const e2eDb = new PrismaClient({ adapter: new PrismaPg(connectionString) });

/** Sufixo único por execução, para que os testes não colidam entre si. */
export const RUN_ID = randomUUID().slice(0, 8);

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${RUN_ID}.${randomUUID().slice(0, 6)}@example.test`;
}

/**
 * Cria uma instituição. O slug precisa ser válido segundo as regras do domínio
 * (minúsculas, sem hífen nas pontas), então derivamos dele o sufixo da execução.
 */
export async function createTenant(options: {
  label: string;
  name: string;
  status?: 'ACTIVE' | 'PENDING' | 'SUSPENDED';
}) {
  const slug = `${options.label}-${RUN_ID}`.toLowerCase();

  const tenant = await e2eDb.tenant.create({
    data: {
      id: randomUUID(),
      slug,
      name: options.name,
      status: options.status ?? 'ACTIVE',
      plan: 'FREE',
    },
  });

  return tenant;
}

/** Vincula um usuário a uma instituição. */
export async function linkUser(options: {
  tenantId: string;
  userId: string;
  status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  /**
   * Natureza do vínculo (FASE 14): o default é EQUIPE, que é o que os cenários de
   * RBAC esperam. `PARTICIPANT` existe para montar a fixture do público de eventos
   * sem passar pelo fluxo de inscrição pública.
   */
  kind?: 'MEMBER' | 'PARTICIPANT';
}) {
  return e2eDb.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId: options.tenantId,
      userId: options.userId,
      status: options.status ?? 'ACTIVE',
      kind: options.kind ?? 'MEMBER',
      joinedAt: options.status === 'INVITED' ? null : new Date(),
    },
  });
}

/** Concede um papel. */
export async function grantRole(options: {
  tenantId: string;
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'ORGANIZER' | 'CHAIR' | 'REVIEWER' | 'STAFF' | 'PARTICIPANT';
  scope?: 'TENANT' | 'EVENT' | 'ACTIVITY';
  eventId?: string;
}) {
  return e2eDb.$transaction(async (tx) => {
    // `role_assignments` está sob FORCE RLS: nem o admin escapa sem contexto.
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId}, true)`;

    return tx.roleAssignment.create({
      data: {
        id: randomUUID(),
        tenantId: options.tenantId,
        userId: options.userId,
        role: options.role,
        scope: options.scope ?? 'TENANT',
        eventId: options.eventId ?? null,
      },
    });
  });
}

/**
 * Concede o papel de PLATAFORMA (FASE 9).
 *
 * Não há `tenantId` aqui de propósito: a governança da plataforma não pertence a
 * instituição alguma (`scope = PLATFORM`, `tenant_id = NULL`). A linha é inserida
 * pela conexão administrativa, que é o mesmo caminho do provisionamento real —
 * nenhuma transação de instituição enxerga uma concessão de plataforma.
 */
export async function grantPlatformRole(options: { userId: string; role?: 'SUPERADMIN' }) {
  return e2eDb.roleAssignment.create({
    data: {
      id: randomUUID(),
      tenantId: null,
      userId: options.userId,
      role: options.role ?? 'SUPERADMIN',
      scope: 'PLATFORM',
      reason: 'Concessão do teste E2E da FASE 9',
    },
  });
}

/** Cria um evento dentro de uma instituição (para papéis com escopo de evento). */

export async function createEvent(options: {
  tenantId: string;
  slug: string;
  title: string;
  status?: 'DRAFT' | 'PUBLISHED' | 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED';
  capacity?: number | null;
  startsAtOffsetDays?: number;
  summary?: string;
}) {
  const startsAt = new Date(Date.now() + (options.startsAtOffsetDays ?? 30) * 86_400_000);

  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId}, true)`;

    return tx.event.create({
      data: {
        id: randomUUID(),
        tenantId: options.tenantId,
        slug: options.slug,
        title: options.title,
        summary: options.summary ?? null,
        status: options.status ?? 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        timezone: 'America/Bahia',
        city: 'Salvador',
        state: 'BA',
        capacity: options.capacity === undefined ? null : options.capacity,
        confirmedCount: 0,
        // Inscrições já abertas: o E2E não deve depender de relógio.
        registrationOpensAt: new Date(Date.now() - 86_400_000),
        registrationClosesAt: new Date(Date.now() + 20 * 86_400_000),
      },
    });
  });
}

/** Cria uma atividade dentro de um evento. */
export async function createActivity(options: {
  tenantId: string;
  eventId: string;
  slug: string;
  title: string;
  capacity?: number | null;
  waitlistEnabled?: boolean;
  status?: 'DRAFT' | 'SCHEDULED' | 'FULL' | 'CANCELED';
  workloadMinutes?: number;
  roomId?: string | null;
  startsAtOffsetDays?: number;
}) {
  const startsAt = new Date(Date.now() + (options.startsAtOffsetDays ?? 30) * 86_400_000);

  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId}, true)`;

    return tx.activity.create({
      data: {
        id: randomUUID(),
        tenantId: options.tenantId,
        eventId: options.eventId,
        slug: options.slug,
        title: options.title,
        description: 'Atividade criada para os testes E2E.',
        type: 'WORKSHOP',
        status: options.status ?? 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + (options.workloadMinutes ?? 120) * 60_000),
        workloadMinutes: options.workloadMinutes ?? 120,
        capacity: options.capacity === undefined ? 20 : options.capacity,
        waitlistEnabled: options.waitlistEnabled ?? false,
        confirmedCount: 0,
        waitlistCount: 0,
        roomId: options.roomId ?? null,
      },
    });
  });
}

/** Cria uma sala no evento. */
export async function createRoom(options: {
  tenantId: string;
  eventId: string;
  name: string;
  capacity?: number;
}) {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId}, true)`;

    return tx.room.create({
      data: {
        id: randomUUID(),
        tenantId: options.tenantId,
        eventId: options.eventId,
        name: options.name,
        capacity: options.capacity ?? 50,
      },
    });
  });
}

/** Remove todos os dados criados por esta execução. */
export async function cleanupRun(): Promise<void> {
  await e2eDb.tenant.deleteMany({ where: { slug: { contains: RUN_ID } } });
  await e2eDb.user.deleteMany({ where: { email: { contains: RUN_ID } } });
}

/**
 * Cabeçalho que força o contexto de instituição em `localhost`.
 *
 * O Proxy só confia nesse header quando o host é o domínio raiz (ou localhost),
 * justamente para que um tenant não consiga forjar contexto no próprio domínio.
 * É o que torna possível testar subdomínios sem DNS wildcard.
 */
export function tenantHeaders(slug: string): Record<string, string> {
  return { 'x-ef-tenant': slug };
}
