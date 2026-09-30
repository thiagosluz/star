/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — QR repetido do patrocinador (FASE 51 · dívida E57)
 *
 *  Roda contra o banco real, com RLS e a role de runtime. Prova o que o domínio puro
 *  não alcança:
 *
 *    • o PRIMEIRO QR não avisa nada — o aviso não pode aparecer para quem está
 *      cadastrando o estande pela primeira vez;
 *    • o SEGUNDO avisa e é RECUSADO sem confirmação explícita, com a contagem junto;
 *    • com a confirmação, ele grava — a decisão é da instituição, não do sistema;
 *    • o aviso conta só o MESMO patrocinador e o MESMO evento (outro patrocinador no
 *      mesmo evento, e o mesmo patrocinador em outro evento, não disparam);
 *    • o crédito continua **um por pessoa por QR** (duas pessoas, dois QR = até 4
 *      créditos), que é justamente o que o aviso explica;
 *    • QR desativado, editado e excluído não entram na contagem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveSponsor, saveSponsorTier } from '../../src/lib/admin/sponsor-service';
import {
  countSponsorQrCodesInEvent,
  deleteSponsorQrCode,
  saveSponsorQrCode,
  scanSponsorQr,
  setSponsorQrCodeActive,
} from '../../src/lib/sponsors/sponsor-portal-service';
import { getXpProfile } from '../../src/lib/gamification/xp-service';
import { sponsorQrRepeatWarning } from '../../src/domain/events/sponsor-experience-rules';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let otherEventId: string;
let sponsorId: string;
let otherSponsorId: string;
let organizerId: string;
let anaId: string;
let brunoId: string;

const QR_XP = 25;

function qrInput(overrides: Partial<Parameters<typeof saveSponsorQrCode>[0]> = {}) {
  return {
    tenantId,
    actorId: organizerId,
    sponsorId,
    eventId,
    label: 'Estande — entrada',
    xpAmount: QR_XP,
    cardTemplateId: null,
    consentDays: 90,
    ...overrides,
  };
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  otherEventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f51-qr-${RUN}`,
      name: `Instituição QR ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
  });

  organizerId = randomUUID();
  anaId = randomUUID();
  brunoId = randomUUID();

  for (const [id, name] of [
    [organizerId, 'Organizadora F51'],
    [anaId, 'Ana Visitante'],
    [brunoId, 'Bruno Visitante'],
  ] as const) {
    await adminPrisma.user.create({
      data: { id, name, email: `f51.qr.${RUN}.${id.slice(0, 6)}@exemplo.test` },
    });
    await adminPrisma.userTenantProfile.create({
      data: { tenantId, userId: id, status: 'ACTIVE', kind: 'PARTICIPANT' },
    });
  }

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `congresso-qr-${RUN}`,
        title: `Congresso QR ${RUN}`,
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: new Date('2026-11-10T13:00:00.000Z'),
        endsAt: new Date('2026-11-12T21:00:00.000Z'),
        confirmedCount: 0,
      },
    });

    await tx.event.create({
      data: {
        id: otherEventId,
        tenantId,
        slug: `encontro-qr-${RUN}`,
        title: `Encontro QR ${RUN}`,
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: new Date('2026-12-01T13:00:00.000Z'),
        endsAt: new Date('2026-12-01T21:00:00.000Z'),
        confirmedCount: 0,
      },
    });
  });

  const tier = await saveSponsorTier({
    tenantId,
    eventId,
    actorId: organizerId,
    key: 'GOLD',
    name: 'Ouro',
    description: 'Cota do estande.',
    color: '#b45309',
    logoScale: 'LARGE',
    rank: 10,
    priceCents: 1_000_000,
    currency: 'BRL',
    maxSponsors: 0,
    benefits: ['Estande'],
  });

  expect(tier.ok).toBe(true);
  if (!tier.ok) throw new Error('Falha ao criar a cota');

  for (const [key, name, seed] of [
    ['parceiro', `Instituto Parceiro ${RUN}`, 0],
    ['editora', `Editora Parceira ${RUN}`, 1],
  ] as const) {
    const created = await saveSponsor({
      tenantId,
      eventId,
      actorId: organizerId,
      name,
      description: null,
      websiteUrl: null,
      logoUrl: null,
      tierId: tier.tierId,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      taxId: null,
      contractValueCents: null,
      contractStart: null,
      contractEnd: null,
      displayOrder: seed,
      isActive: true,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('Falha ao criar o patrocinador');

    if (key === 'parceiro') sponsorId = created.sponsorId;
    else otherSponsorId = created.sponsorId;
  }
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

describe('a régua do aviso (domínio)', () => {
  it('não avisa no primeiro QR', () => {
    const verdict = sponsorQrRepeatWarning({ existingInEvent: 0, confirmed: false });

    expect(verdict.required).toBe(false);
    expect(verdict.blocked).toBe(false);
    expect(verdict.message).toBeNull();
  });

  it('avisa e bloqueia a partir do segundo, com o número e o efeito na mensagem', () => {
    const blocked = sponsorQrRepeatWarning({ existingInEvent: 1, confirmed: false });

    expect(blocked.required).toBe(true);
    expect(blocked.blocked).toBe(true);
    expect(blocked.message).toContain('1 QR');
    expect(blocked.message).toContain('creditar a mesma pessoa');
  });

  it('com confirmação, o aviso continua sendo dito — mas libera', () => {
    const allowed = sponsorQrRepeatWarning({ existingInEvent: 3, confirmed: true });

    expect(allowed.required).toBe(true);
    expect(allowed.blocked).toBe(false);
    expect(allowed.message).toContain('3 QRs');
  });

  it('contagem negativa ou fracionária é normalizada (dado de fora não vira NaN)', () => {
    expect(sponsorQrRepeatWarning({ existingInEvent: -4, confirmed: false }).required).toBe(false);
    expect(sponsorQrRepeatWarning({ existingInEvent: 2.7, confirmed: false }).blocked).toBe(true);
  });
});

describe('o primeiro QR do patrocinador', () => {
  let firstQrId: string;
  let firstCode: string;

  it('é criado sem aviso e sem confirmação', async () => {
    const created = await saveSponsorQrCode(qrInput({ label: 'Estande — entrada' }));

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.created).toBe(true);
    expect(created.existingInEvent).toBe(1);

    firstQrId = created.qrId;
    firstCode = created.code;
  });

  it('a contagem no evento é 1', async () => {
    await expect(countSponsorQrCodesInEvent(tenantId, sponsorId, eventId)).resolves.toBe(1);
  });

  it('o SEGUNDO QR avisa e é RECUSADO sem confirmação', async () => {
    const blocked = await saveSponsorQrCode(qrInput({ label: 'Estande — saída' }));

    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;

    expect(blocked.code).toBe('CONFIRMATION_REQUIRED');
    expect(blocked.message).toContain('1 QR');
    expect(blocked.details?.join(' ')).toContain('1');

    /** Nada foi gravado: a recusa é antes do INSERT. */
    await expect(countSponsorQrCodesInEvent(tenantId, sponsorId, eventId)).resolves.toBe(1);
  });

  it('com confirmação explícita, o segundo QR grava', async () => {
    const created = await saveSponsorQrCode(qrInput({ label: 'Estande — saída', confirmed: true }));

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.created).toBe(true);
    expect(created.existingInEvent).toBe(2);

    await expect(countSponsorQrCodesInEvent(tenantId, sponsorId, eventId)).resolves.toBe(2);
  });

  it('o TERCEIRO volta a avisar, com o número atualizado', async () => {
    const blocked = await saveSponsorQrCode(qrInput({ label: 'Estande — mezanino' }));

    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;

    expect(blocked.code).toBe('CONFIRMATION_REQUIRED');
    expect(blocked.message).toContain('2 QRs');
  });

  it('a trilha guarda a confirmação e a contagem do momento', async () => {
    const logs = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId, entityType: 'sponsorQrCode', action: 'CREATE' },
        select: { changes: true },
      }),
    );

    const withConfirmation = logs.filter((row) => {
      const changes = row.changes as Record<string, { to?: unknown }> | null;
      return changes?.confirmed?.to === true;
    });

    expect(withConfirmation.length).toBeGreaterThanOrEqual(1);
  });

  it('o MESMO patrocinador em OUTRO evento não dispara aviso', async () => {
    const created = await saveSponsorQrCode(
      qrInput({ eventId: otherEventId, label: 'Estande — outra edição' }),
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    /** É o primeiro NAQUELE evento. */
    expect(created.existingInEvent).toBe(1);
    /** E a contagem do evento original segue em 2. */
    await expect(countSponsorQrCodesInEvent(tenantId, sponsorId, eventId)).resolves.toBe(2);
  });

  it('OUTRO patrocinador no mesmo evento não dispara aviso', async () => {
    const created = await saveSponsorQrCode(
      qrInput({ sponsorId: otherSponsorId, label: 'Estande da editora' }),
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.existingInEvent).toBe(1);
  });

  it('QR desativado continua contando; QR EXCLUÍDO não', async () => {
    const created = await saveSponsorQrCode(
      qrInput({ label: 'Estande — reserva', confirmed: true }),
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(countSponsorQrCodesInEvent(tenantId, sponsorId, eventId)).resolves.toBe(3);

    /** Desativar NÃO tira da contagem: o QR existe e pode ser reativado. */
    const off = await setSponsorQrCodeActive({
      tenantId,
      actorId: organizerId,
      qrId: created.qrId,
      isActive: false,
    });

    expect(off.ok).toBe(true);
    await expect(countSponsorQrCodesInEvent(tenantId, sponsorId, eventId)).resolves.toBe(3);

    /** Excluir tira: o QR saiu de circulação e não pode mais creditar ninguém. */
    const removed = await deleteSponsorQrCode({ tenantId, actorId: organizerId, qrId: created.qrId });

    expect(removed.ok).toBe(true);
    await expect(countSponsorQrCodesInEvent(tenantId, sponsorId, eventId)).resolves.toBe(2);
  });

  it('EDITAR um QR existente não passa pelo aviso (não cria código novo)', async () => {
    const edited = await saveSponsorQrCode(
      qrInput({ qrId: firstQrId, label: 'Estande — entrada (renomeado)' }),
    );

    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    expect(edited.created).toBe(false);
    /** O código NÃO muda: quem já imprimiu o QR continua com o código válido. */
    expect(edited.code).toBe(firstCode);
  });
});

describe('o crédito continua um por pessoa POR QR', () => {
  it('duas pessoas lendo dois QRs recebem até quatro créditos', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  É EXATAMENTE ISTO QUE O AVISO EXPLICA (E57)
     * ─────────────────────────────────────────────────────────────────────────────
     *  O crédito está CORRETO — um por pessoa por QR, garantido pelo índice único de
     *  `sponsor_scans`. O que a instituição precisa saber é que um QR a mais é uma
     *  chance a mais de a MESMA pessoa passar dos 25 para os 50 XP. O teste prova o
     *  mecanismo; a mensagem do aviso traduz a consequência.
     */
    const codes = await withTenant(tenantId, (tx) =>
      tx.sponsorQrCode.findMany({
        where: { tenantId, sponsorId, eventId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, code: true },
      }),
    );

    expect(codes.length).toBe(2);

    const [first, second] = codes;

    /** Ana lê os dois: 2 × QR_XP. */
    for (const qr of codes) {
      const scan = await scanSponsorQr({
        tenantId,
        code: qr!.code,
        userId: anaId,
        consent: false,
      });

      expect(scan.ok).toBe(true);
    }

    /** Bruno lê só o primeiro: 1 × QR_XP. */
    const brunoScan = await scanSponsorQr({
      tenantId,
      code: first!.code,
      userId: brunoId,
      consent: false,
    });

    expect(brunoScan.ok).toBe(true);

    const ana = await getXpProfile(tenantId, anaId);
    const bruno = await getXpProfile(tenantId, brunoId);

    expect(ana.ok).toBe(true);
    expect(bruno.ok).toBe(true);
    if (!ana.ok || !bruno.ok) return;

    expect(ana.profile.progress.totalXp).toBe(QR_XP * 2);
    expect(bruno.profile.progress.totalXp).toBe(QR_XP);

    /** Reler o MESMO QR não credita de novo (a trava do índice único). */
    const replay = await scanSponsorQr({ tenantId, code: first!.code, userId: anaId, consent: false });

    expect(replay.ok).toBe(true);

    const anaAgain = await getXpProfile(tenantId, anaId);
    expect(anaAgain.ok).toBe(true);
    if (!anaAgain.ok) return;

    expect(anaAgain.profile.progress.totalXp).toBe(QR_XP * 2);

    /** E o segundo QR existe mesmo — é o que o aviso contou. */
    expect(second).toBeTruthy();
  });
});
