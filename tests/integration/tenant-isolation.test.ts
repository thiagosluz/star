/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 1 — Teste de integração do isolamento multi-tenant
 *
 *  Os scripts em `prisma/scripts/*.mjs` provam o isolamento por SQL puro. Este
 *  teste prova a MESMA propriedade através da camada de acesso a dados que a
 *  aplicação realmente usa (`src/lib/db/tenant-client.ts`), incluindo:
 *
 *    • o wrapper `withTenant()` aplica `SET LOCAL app.tenant_id`;
 *    • o proxy `db` se recusa a operar fora de um contexto (falha ruidosa);
 *    • o contexto não vaza entre chamadas concorrentes (AsyncLocalStorage);
 *    • um tenant não enxerga nem altera dados de outro.
 *
 *  Requer um banco em execução:
 *      docker compose up -d && npm run db:migrate && npm run db:rls
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { adminPrisma } from '../../src/lib/db/admin-client';
import {
  MissingTenantContextError,
  db,
  disconnectDb,
  withTenant,
} from '../../src/lib/db/tenant-client';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const EVENT_A = randomUUID();
const EVENT_B = randomUUID();

const suffix = randomUUID().slice(0, 8);

/** Cria uma instituição com um evento. Usa a conexão ADMIN (bypassa RLS). */
async function seedTenant(tenantId: string, eventId: string, label: string) {
  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `it-${label}-${suffix}`,
      name: `Instituição ${label}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
  });

  await adminPrisma.event.create({
    data: {
      id: eventId,
      tenantId,
      slug: `evento-${label}`,
      title: `Evento ${label}`,
      status: 'PUBLISHED',
      modality: 'IN_PERSON',
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 86_400_000),
      timezone: 'America/Bahia',
    },
  });
}

beforeAll(async () => {
  await seedTenant(TENANT_A, EVENT_A, 'a');
  await seedTenant(TENANT_B, EVENT_B, 'b');
});

afterAll(async () => {
  // O cascade remove os eventos vinculados.
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
  await adminPrisma.$disconnect();
  await disconnectDb();
});

describe('isolamento multi-tenant — camada de acesso a dados', () => {
  it('rejeita acesso a dados fora de um contexto de tenant (falha ruidosa)', () => {
    // Sem `withTenant`, o proxy deve LANÇAR em vez de devolver [] silenciosamente.
    expect(() => db.event).toThrow(MissingTenantContextError);
  });

  it('expõe apenas os eventos do tenant informado', async () => {
    const eventos = await withTenant(TENANT_A, () => db.event.findMany());

    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.id).toBe(EVENT_A);
    expect(eventos.map((e) => e.id)).not.toContain(EVENT_B);
  });

  it('não permite ler um evento de outro tenant nem por id explícito', async () => {
    const intruso = await withTenant(TENANT_A, () =>
      db.event.findUnique({ where: { id: EVENT_B } }),
    );

    expect(intruso).toBeNull();
  });

  it('não permite atualizar um evento de outro tenant', async () => {
    const resultado = await withTenant(TENANT_A, () =>
      db.event.updateMany({
        where: { id: EVENT_B },
        data: { title: 'SEQUESTRADO' },
      }),
    );

    expect(resultado.count).toBe(0);
  });

  it('não permite apagar um evento de outro tenant', async () => {
    const resultado = await withTenant(TENANT_A, () =>
      db.event.deleteMany({ where: { id: EVENT_B } }),
    );

    expect(resultado.count).toBe(0);
  });

  it('tem acesso de escrita ao próprio tenant', async () => {
    const atualizado = await withTenant(TENANT_A, () =>
      db.event.update({
        where: { id: EVENT_A },
        data: { title: 'Evento A (atualizado)' },
      }),
    );

    expect(atualizado.title).toBe('Evento A (atualizado)');
  });

  it('mantém contextos isolados em execuções concorrentes (AsyncLocalStorage)', async () => {
    // Duas transações simultâneas, cada uma com seu tenant. Se o contexto fosse
    // global em vez de assíncrono-local, uma vazaria na outra.
    const [doA, doB] = await Promise.all([
      withTenant(TENANT_A, async () => {
        await new Promise((r) => setTimeout(r, 30));
        return db.event.findMany({ select: { id: true } });
      }),
      withTenant(TENANT_B, () => db.event.findMany({ select: { id: true } })),
    ]);

    expect(doA.map((e) => e.id)).toEqual([EVENT_A]);
    expect(doB.map((e) => e.id)).toEqual([EVENT_B]);
  });

  it('não vaza o contexto para a chamada seguinte', async () => {
    await withTenant(TENANT_A, () => db.event.findMany());

    // Nova chamada, outro tenant: deve ver apenas o próprio dado.
    const eventosB = await withTenant(TENANT_B, () => db.event.findMany());
    expect(eventosB.map((e) => e.id)).toEqual([EVENT_B]);
  });
});
