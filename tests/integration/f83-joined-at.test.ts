/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INTEGRAÇÃO — `joinedAt` é DADO: o seed e a inscrição não o reescrevem (FASE 83)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 1 fez o vínculo ativo ser escolhido por `MEMBER` → `joinedAt` (o mais
 *  antigo) → `tenantId`. O degrau só é confiável se a data não for reescrita por
 *  rotina nenhuma — e era: `npm run db:seed:dev` regravava `joinedAt = now` em todo
 *  vínculo ACTIVE, e o `upsert` da inscrição pública fazia o mesmo no `update`.
 *  Os dois apagavam a antiguidade real e podiam trocar a instituição implícita de
 *  quem entra sem cookie.
 *
 *  Aqui, contra o PostgreSQL real:
 *    1. reexecutar o SEED de contas de teste preserva o `joinedAt` existente;
 *    2. a inscrição que ATIVA um vínculo `INVITED` preserva o `joinedAt` que a
 *       linha já tinha (é o caminho de `update` do `upsert`);
 *    3. reinscrever quem já é participante não toca no campo (caminho
 *       `ALREADY_MEMBER`, que sequer chama o `upsert`).
 *
 *  O caso do seed toca as contas de demonstração de propósito — é o script real,
 *  rodado pelo mesmo `tsx` do `npm run db:seed:dev`. A fixture restaura o valor
 *  original no `finally`, mesmo se a asserção falhar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { registerForActivity } from '../../src/lib/events/registration-service';

const RUN = randomUUID().slice(0, 8);

/** A data que o vínculo já tinha — bem antes de qualquer execução deste teste. */
const ANTIGO = new Date('2019-03-04T05:06:07.000Z');

let tenantId: string;
let eventId: string;

/** Vínculo `INVITED` que a inscrição vai ATIVAR (o `update` do upsert). */
let invitedId: string;
/** Vínculo já `ACTIVE` que se reinscreve (o caminho `ALREADY_MEMBER`). */
let activeId: string;

/** O vínculo do seed que será lido e restaurado (a conta de demonstração existe?). */
let seedProfileId: string | null = null;
let seedJoinedAtOriginal: Date | null = null;
let seedReady = false;

async function createUser(label: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: `Pessoa ${label} ${RUN}`,
      email: `f83.joined.${label}.${RUN}@exemplo.test`,
    },
  });

  return id;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function createActivity(slug: string): Promise<string> {
  const id = randomUUID();
  const startsAt = daysFromNow(30);

  await withTenant(tenantId, (tx) =>
    tx.activity.create({
      data: {
        id,
        tenantId,
        eventId,
        slug,
        title: `Atividade ${slug}`,
        type: 'WORKSHOP',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        workloadMinutes: 60,
        capacity: 10,
        waitlistEnabled: false,
        confirmedCount: 0,
        waitlistCount: 0,
      },
    }),
  );

  return id;
}

async function joinedAtOf(userId: string): Promise<Date | null> {
  const profile = await adminPrisma.userTenantProfile.findUniqueOrThrow({
    where: { tenantId_userId: { tenantId, userId } },
    select: { joinedAt: true },
  });

  return profile.joinedAt;
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f83-juntado-${RUN}`,
      name: `Instituição da Data ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  const startsAt = daysFromNow(29);

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f83-${RUN}`,
        title: `Evento da Data ${RUN}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        registrationOpensAt: new Date(Date.now() - 86_400_000),
        registrationClosesAt: new Date(Date.now() + 20 * 86_400_000),
      },
    }),
  );

  await createActivity('atividade-a');
  await createActivity('atividade-b');

  invitedId = await createUser('convite');
  activeId = await createUser('ativa');

  /**
   * `joinedAt` não nulo num vínculo `INVITED` é dado de borda, e é o que torna a
   * prova visível: se o `update` do `upsert` regravar o campo, o valor deixa de
   * ser o antigo na hora. Se a linha nascesse com `null`, o teste não distinguiria
   * "preservou" de "não tocou porque não havia o que tocar".
   */
  await adminPrisma.userTenantProfile.createMany({
    data: [
      {
        id: randomUUID(),
        tenantId,
        userId: invitedId,
        status: 'INVITED',
        kind: 'PARTICIPANT',
        joinedAt: ANTIGO,
      },
      {
        id: randomUUID(),
        tenantId,
        userId: activeId,
        status: 'ACTIVE',
        kind: 'PARTICIPANT',
        joinedAt: ANTIGO,
      },
    ],
  });

  /**
   * A conta de demonstração do seed: sem ela (ou sem o Congresso) o caso do seed
   * não pode rodar, e o teste é PULADO em vez de reprovar por ambiente incompleto.
   */
  const seedUser = await adminPrisma.user.findUnique({
    where: { email: 'participante@eventflow.test' },
    select: { id: true },
  });
  const seedTenant = await adminPrisma.tenant.findUnique({
    where: { slug: 'ufba-demo' },
    select: { id: true },
  });

  if (seedUser && seedTenant) {
    const congress = await adminPrisma.event.findFirst({
      where: { tenantId: seedTenant.id, slug: 'congresso-2026' },
      select: { id: true },
    });
    const profile = await adminPrisma.userTenantProfile.findUnique({
      where: { tenantId_userId: { tenantId: seedTenant.id, userId: seedUser.id } },
      select: { id: true, joinedAt: true },
    });

    if (congress && profile) {
      seedProfileId = profile.id;
      seedJoinedAtOriginal = profile.joinedAt;
      seedReady = true;
    }
  }
}, 120_000);

afterAll(async () => {
  await adminPrisma.auditLog.deleteMany({ where: { tenantId } });
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect().catch(() => undefined);
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o seed preserva a antiguidade do vínculo', () => {
  it(
    'reexecutar `db:seed:dev` NÃO reescreve o `joinedAt` de um vínculo existente',
    async (context) => {
      /**
       * A conta de demonstração só é descoberta no `beforeAll`, e `skipIf` é
       * avaliado na COLETA (antes dele). O `context.skip()` é a saída honesta:
       * ambiente sem `db:seed` pula o caso em vez de reprovar por dado ausente.
       */
      if (!seedReady) context.skip();

      if (!seedProfileId) throw new Error('fixture do seed não montada');

      const marco = new Date('2020-02-03T04:05:06.000Z');

      await adminPrisma.userTenantProfile.update({
        where: { id: seedProfileId },
        data: { joinedAt: marco },
      });

      try {
        execFileSync(
          process.execPath,
          ['node_modules/tsx/dist/cli.mjs', 'prisma/seed-dev-users.ts'],
          {
            encoding: 'utf8',
            cwd: process.cwd(),
            env: process.env,
            timeout: 120_000,
          },
        );

        const depois = await adminPrisma.userTenantProfile.findUniqueOrThrow({
          where: { id: seedProfileId },
          select: { joinedAt: true, status: true },
        });

        // A data que o vínculo já tinha continua sendo a dele — o seed reafirma
        // estado (status/kind), não antiguidade.
        expect(depois.joinedAt?.toISOString()).toBe(marco.toISOString());
        expect(depois.status).toBe('ACTIVE');
      } finally {
        await adminPrisma.userTenantProfile.update({
          where: { id: seedProfileId },
          data: { joinedAt: seedJoinedAtOriginal },
        });
      }
    },
    150_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a inscrição pública preserva a antiguidade do vínculo', () => {
  it('ativar um convite pendente NÃO reescreve o `joinedAt` da linha', async () => {
    const outcome = await registerForActivity({
      tenantId,
      eventSlug: `evento-f83-${RUN}`,
      activitySlug: 'atividade-a',
      userId: invitedId,
      consentData: true,
    });

    expect(outcome.ok, outcome.ok ? 'ok' : outcome.message).toBe(true);
    if (outcome.ok) expect(outcome.linkedAsParticipant).toBe(true);

    const profile = await adminPrisma.userTenantProfile.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId, userId: invitedId } },
      select: { status: true, deletedAt: true, joinedAt: true },
    });

    expect(profile.status).toBe('ACTIVE');
    expect(profile.deletedAt).toBeNull();
    expect(profile.joinedAt?.toISOString()).toBe(ANTIGO.toISOString());
  }, 90_000);

  it('reinscrever quem já é participante NÃO toca no `joinedAt`', async () => {
    const antes = await joinedAtOf(activeId);

    const primeira = await registerForActivity({
      tenantId,
      eventSlug: `evento-f83-${RUN}`,
      activitySlug: 'atividade-a',
      userId: activeId,
      consentData: true,
    });

    expect(primeira.ok, primeira.ok ? 'ok' : primeira.message).toBe(true);
    if (primeira.ok) expect(primeira.linkedAsParticipant).toBe(false);

    const segunda = await registerForActivity({
      tenantId,
      eventSlug: `evento-f83-${RUN}`,
      activitySlug: 'atividade-b',
      userId: activeId,
      consentData: true,
    });

    expect(segunda.ok, segunda.ok ? 'ok' : segunda.message).toBe(true);
    // `ALREADY_MEMBER`: o vínculo nem é tocado — a data continua a mesma.
    if (segunda.ok) expect(segunda.linkedAsParticipant).toBe(false);

    expect((await joinedAtOf(activeId))?.toISOString()).toBe(antes?.toISOString());
    expect((await joinedAtOf(activeId))?.toISOString()).toBe(ANTIGO.toISOString());
  }, 120_000);
});
