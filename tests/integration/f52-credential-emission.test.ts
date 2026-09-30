/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Emissão à mão do crachá (FASE 52 · dívida I1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela de crachás monta a lista por INSCRIÇÃO no evento — é o que define quem é
 *  público daquele evento. A emissão à mão, quando recebia uma seleção explícita,
 *  buscava as pessoas por VÍNCULO (`user_tenant_profiles`) e descartava o resto.
 *
 *  As duas populações não são a mesma: quem se inscreveu pelo formulário público e não
 *  tem vínculo aparecia na tela COM caixa de seleção, era escolhido pela secretaria — e
 *  a emissão respondia **"Nenhum participante para emitir crachá"**, culpando a
 *  seleção por um dado que existia. O E2E da FASE 51 conviveu com isso como falha de
 *  teste; era falha de produto.
 *
 *  Aqui a régua fica presa: inscrição no evento ∪ vínculo emitem; quem não tem nenhum
 *  dos dois continua de fora (a recusa honesta).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { issueCredentials } from '../../src/lib/events/credential-service';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let actorId: string;

/** Só inscrição no evento: é a pessoa que a tela oferece e a emissão recusava. */
let inscritoSemVinculoId: string;
/** Só vínculo: é a equipe que recebe crachá sem estar inscrita em atividade nenhuma. */
let vinculadoSemInscricaoId: string;
/** Nem um, nem outro: a recusa continua, e é ela que impede crachá para estranho. */
let estranhoId: string;

async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f52.cracha.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  return id;
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f52-crachas-${RUN}`,
      name: `Instituição Crachá F52 ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  actorId = await createUser('Organizadora F52');
  inscritoSemVinculoId = await createUser('Inscrito sem vínculo F52');
  vinculadoSemInscricaoId = await createUser('Equipe sem inscrição F52');
  estranhoId = await createUser('Estranho F52');

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: actorId, status: 'ACTIVE', joinedAt: new Date() },
  });

  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId: vinculadoSemInscricaoId,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `congresso-f52-${RUN}`,
        title: 'Congresso F52',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-11-10T11:00:00.000Z'),
        endsAt: new Date('2026-11-10T22:00:00.000Z'),
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
      },
    });

    /** A inscrição no EVENTO (`activityId` nulo) — o crachá é da pessoa no evento. */
    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: null,
        userId: inscritoSemVinculoId,
        status: 'CONFIRMED',
      },
    });
  });
});

afterAll(async () => {
  await withTenant(tenantId, async (tx) => {
    await tx.eventCredential.deleteMany({ where: { tenantId } });
    await tx.registration.deleteMany({ where: { tenantId } });
    await tx.event.deleteMany({ where: { tenantId } });
  });

  await adminPrisma.userTenantProfile.deleteMany({ where: { tenantId } });
  await adminPrisma.tenant.delete({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({
    where: {
      id: { in: [actorId, inscritoSemVinculoId, vinculadoSemInscricaoId, estranhoId] },
    },
  });
  await adminPrisma.$disconnect();
});

describe('emissão à mão: quem a tela oferece é quem o serviço aceita', () => {
  it('a pessoa INSCRITA no evento recebe crachá mesmo sem vínculo', async () => {
    const result = await issueCredentials({
      tenantId,
      eventId,
      actorId,
      userIds: [inscritoSemVinculoId],
      category: 'STAFF',
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.issued.map((item) => item.userId)).toEqual([inscritoSemVinculoId]);

    /** A categoria pedida é a GRAVADA — o `issued` devolve o crachá, não o detalhe. */
    const gravado = await withTenant(tenantId, (tx) =>
      tx.eventCredential.findFirst({
        where: { tenantId, eventId, userId: inscritoSemVinculoId },
        select: { category: true, code: true, status: true },
      }),
    );

    expect(gravado?.category).toBe('STAFF');
    expect(gravado?.code).toBeTruthy();
    expect(gravado?.status).toBe('ACTIVE');
  });

  it('quem tem VÍNCULO também recebe — é a equipe sem inscrição em atividade', async () => {
    const result = await issueCredentials({
      tenantId,
      eventId,
      actorId,
      userIds: [vinculadoSemInscricaoId],
      category: 'STAFF',
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.issued.map((item) => item.userId)).toEqual([vinculadoSemInscricaoId]);
  });

  it('quem não tem NEM inscrição NEM vínculo continua de fora', async () => {
    const result = await issueCredentials({
      tenantId,
      eventId,
      actorId,
      userIds: [estranhoId],
      category: 'PARTICIPANT',
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.issued).toHaveLength(0);
  });

  it('a seleção MISTA emite os dois de uma vez, e nenhum deles duas vezes', async () => {
    const segundoInscrito = await createUser('Segundo inscrito F52');

    await withTenant(tenantId, async (tx) => {
      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId: null,
          userId: segundoInscrito,
          status: 'CONFIRMED',
        },
      });
    });

    const result = await issueCredentials({
      tenantId,
      eventId,
      actorId,
      userIds: [segundoInscrito, inscritoSemVinculoId, estranhoId],
      category: 'PARTICIPANT',
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    /** O segundo entra; quem já tinha crachá é PULADO (não é reemissão silenciosa). */
    expect(result.issued.map((item) => item.userId)).toEqual([segundoInscrito]);
    expect(result.skipped).toBe(1);

    await withTenant(tenantId, async (tx) => {
      await tx.registration.deleteMany({ where: { userId: segundoInscrito } });
    });
    await adminPrisma.user.delete({ where: { id: segundoInscrito } });
  });
});
