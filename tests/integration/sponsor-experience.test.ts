/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de integração — EXPERIÊNCIA DO PATROCINADOR (FASE 42) — banco real
 *
 *  O QUE ESTES TESTES PRENDEM (e por que cada um é um invariante, não um detalhe):
 *
 *    • a LEITURA credita UMA vez por pessoa e por QR — reler o mesmo código não
 *      paga de novo (o QR do estande é público; sem isso, farm de XP);
 *    • o crédito NÃO depende do consentimento — quem escolhe não compartilhar
 *      recebe o mesmo XP (consentimento não é preço de entrada);
 *    • o patrocinador vê o contato SÓ enquanto a autorização vale, e a revogação
 *      pelo participante tira o contato da lista sem apagar a visita;
 *    • o vínculo é o que limita QUEM cada patrocinador enxerga (o papel `SPONSOR`
 *      sozinho não abre a lista de outro);
 *    • o convite exige token E o e-mail da conta, e regerar invalida o anterior.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveSponsor, saveSponsorTier } from '../../src/lib/admin/sponsor-service';
import {
  acceptSponsorInvite,
  getSponsorPortal,
  getSponsorQrForDownload,
  inviteSponsorUser,
  linkSponsorUserByEmail,
  listMySponsorShares,
  listSponsorAccess,
  listSponsorTeam,
  removeSponsorUser,
  revokeSponsorConsent,
  saveSponsorQrCode,
  scanSponsorQr,
  setSponsorQrCodeActive,
} from '../../src/lib/sponsors/sponsor-portal-service';
import { sponsorQrFile } from '../../src/lib/sponsors/sponsor-qr-sheet';
import { getXpProfile } from '../../src/lib/gamification/xp-service';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let sponsorId: string;
let otherSponsorId: string;
let organizerId: string;
let participantId: string;
let contactId: string;

const EVENT_SLUG = `evento-f42-${RUN}`;

async function createUser(name: string, email: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({ data: { id, name, email } });
  await adminPrisma.userTenantProfile.create({
    data: { tenantId, userId: id, status: 'ACTIVE', kind: 'PARTICIPANT' },
  });

  return id;
}

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f42-${RUN}`,
      name: `Instituição Patrocínio ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  const other = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f42-vizinha-${RUN}`,
      name: `Instituição Vizinha ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  otherTenantId = other.id;

  organizerId = await createUser('Organizadora F42', `f42.organizadora.${RUN}@exemplo.test`);
  participantId = await createUser('Participante F42', `f42.participante.${RUN}@exemplo.test`);
  contactId = await createUser('Contato do Patrocinador', `f42.contato.${RUN}@exemplo.test`);

  eventId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: EVENT_SLUG,
        title: `Congresso da Vitrine ${RUN}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: new Date('2026-11-10T13:00:00.000Z'),
        endsAt: new Date('2026-11-12T21:00:00.000Z'),
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
    description: 'Cota com logo em destaque.',
    color: '#b45309',
    logoScale: 'LARGE',
    rank: 10,
    priceCents: 1_500_000,
    currency: 'BRL',
    maxSponsors: 0,
    benefits: ['Logo na página'],
  });
  expect(tier.ok).toBe(true);
  if (!tier.ok) throw new Error('Falha ao criar a cota');

  const sponsor = await saveSponsor({
    tenantId,
    eventId,
    actorId: organizerId,
    name: `Instituto Parceiro ${RUN}`,
    description: 'Patrocinador de demonstração.',
    websiteUrl: 'https://example.org/parceiro',
    logoUrl: null,
    tierId: tier.tierId,
    contactName: 'Contato do Patrocinador',
    contactEmail: `f42.contato.${RUN}@exemplo.test`,
    contactPhone: null,
    taxId: null,
    contractValueCents: 1_500_000,
    contractStart: new Date('2026-08-01T00:00:00.000Z'),
    contractEnd: new Date('2026-12-31T00:00:00.000Z'),
    displayOrder: 0,
    isActive: true,
  });
  expect(sponsor.ok).toBe(true);
  if (!sponsor.ok) throw new Error('Falha ao criar o patrocinador');
  sponsorId = sponsor.sponsorId;

  const second = await saveSponsor({
    tenantId,
    eventId,
    actorId: organizerId,
    name: `Editora Parceira ${RUN}`,
    description: null,
    websiteUrl: null,
    logoUrl: null,
    tierId: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    taxId: null,
    contractValueCents: null,
    contractStart: null,
    contractEnd: null,
    displayOrder: 1,
    isActive: true,
  });
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error('Falha ao criar o segundo patrocinador');
  otherSponsorId = second.sponsorId;
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f42.` } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('QR do patrocinador', () => {
  let qrId: string;
  let qrCode: string;

  it('gera um código único e legível por instituição', async () => {
    const created = await saveSponsorQrCode({
      tenantId,
      actorId: organizerId,
      sponsorId,
      eventId,
      label: 'Estande — entrada',
      xpAmount: 60,
      cardTemplateId: null,
      consentDays: 30,
    });

    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    qrId = created.qrId;
    qrCode = created.code;

    expect(qrCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it('recusa patrocinador de outra instituição (e nada é gravado)', async () => {
    const result = await saveSponsorQrCode({
      tenantId: otherTenantId,
      actorId: organizerId,
      sponsorId,
      eventId,
      label: 'QR da vizinha',
      xpAmount: 10,
      cardTemplateId: null,
      consentDays: 30,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  /**
   * A leitura que alimenta o arquivo do QR.
   *
   * Ela devolve o DONO do QR (`sponsorId`) porque é isso que a rota de download usa
   * para decidir quem pode baixar — o patrocinador só leva o dele. Sem a RLS e sem
   * essa leitura, um `qrId` trocado na URL entregaria a arte de outra empresa.
   */
  it('a leitura do QR devolve o dono — e a imagem sai com o endereço absoluto', async () => {
    const originalAppUrl = process.env.APP_URL;
    process.env.APP_URL = 'https://eventos.exemplo.br';

    try {
      const found = await getSponsorQrForDownload(tenantId, qrId);

      expect(found.ok, found.ok ? 'ok' : found.message).toBe(true);
      if (!found.ok) return;

      expect(found.sponsorId).toBe(sponsorId);
      expect(found.code).toBe(qrCode);
      expect(found.isActive).toBe(true);

      const file = await sponsorQrFile({ tenantSlug: 'ufba-demo', code: found.code, format: 'png' });
      expect(file.contentType).toBe('image/png');
      expect((file.body as Buffer).byteLength).toBeGreaterThan(500);
    } finally {
      if (originalAppUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = originalAppUrl;
    }
  });

  it('QR de outra instituição (ou inexistente) não é encontrado', async () => {
    const daVizinha = await getSponsorQrForDownload(otherTenantId, qrId);
    expect(daVizinha.ok).toBe(false);
    if (!daVizinha.ok) expect(daVizinha.code).toBe('NOT_FOUND');

    const inexistente = await getSponsorQrForDownload(tenantId, randomUUID());
    expect(inexistente.ok).toBe(false);
  });

  it('o QR desativado para de creditar', async () => {
    const off = await setSponsorQrCodeActive({ tenantId, actorId: organizerId, qrId, isActive: false });
    expect(off.ok).toBe(true);

    const scan = await scanSponsorQr({ tenantId, code: qrCode, userId: participantId, consent: true });
    expect(scan.ok).toBe(false);
    if (!scan.ok) expect(scan.message).toContain('desativado');

    const on = await setSponsorQrCodeActive({ tenantId, actorId: organizerId, qrId, isActive: true });
    expect(on.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('leitura do QR: crédito e consentimento', () => {
  let qrCode: string;

  it('a primeira leitura credita XP e grava o contato autorizado', async () => {
    const created = await saveSponsorQrCode({
      tenantId,
      actorId: organizerId,
      sponsorId,
      eventId,
      label: 'Estande — leitura',
      xpAmount: 80,
      cardTemplateId: null,
      consentDays: 90,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    qrCode = created.code;

    const before = await getXpProfile(tenantId, participantId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const scan = await scanSponsorQr({ tenantId, code: qrCode, userId: participantId, consent: true });

    expect(scan.ok, scan.ok ? 'ok' : scan.message).toBe(true);
    if (!scan.ok) return;

    expect(scan.outcome.shared).toBe(true);
    expect(scan.outcome.xpAwarded).toBe(80);

    const after = await getXpProfile(tenantId, participantId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    /** O XP vive no `progress` do perfil (não há `totalXp` na raiz da view). */
    expect(after.profile.progress.totalXp).toBe(before.profile.progress.totalXp + 80);

    /** O que ficou gravado é o pacote declarado — nome e e-mail, nada mais. */
    const row = await withTenant(tenantId, (tx) =>
      tx.sponsorScan.findFirstOrThrow({
        where: { qrCodeId: created.qrId, userId: participantId },
        select: {
          sharedName: true,
          sharedEmail: true,
          consentVersion: true,
          consentText: true,
          expiresAt: true,
          revokedAt: true,
          xpAwarded: true,
        },
      }),
    );

    expect(row.sharedName).toBe('Participante F42');
    expect(row.sharedEmail).toBe(`f42.participante.${RUN}@exemplo.test`);
    expect(row.consentVersion).toBe('v1');
    expect(row.consentText).toContain('revogar');
    expect(row.expiresAt).not.toBeNull();
    expect(row.revokedAt).toBeNull();
    expect(row.xpAwarded).toBe(80);
  });

  it('a SEGUNDA leitura do mesmo QR não credita de novo', async () => {
    const before = await getXpProfile(tenantId, participantId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const scan = await scanSponsorQr({ tenantId, code: qrCode, userId: participantId, consent: true });

    expect(scan.ok).toBe(true);
    if (!scan.ok) return;

    expect(scan.outcome.repeated).toBe(true);
    expect(scan.outcome.xpAwarded).toBe(0);

    const after = await getXpProfile(tenantId, participantId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    expect(after.profile.progress.totalXp).toBe(before.profile.progress.totalXp);
  });

  it('sem consentimento, a visita credita e NÃO vira contato', async () => {
    const outro = await createUser('Sem Consentimento F42', `f42.sem.${RUN}@exemplo.test`);

    const scan = await scanSponsorQr({ tenantId, code: qrCode, userId: outro, consent: false });

    expect(scan.ok).toBe(true);
    if (!scan.ok) return;

    /** Consentimento não é preço de entrada: o XP vem igual. */
    expect(scan.outcome.xpAwarded).toBe(80);
    expect(scan.outcome.shared).toBe(false);

    const row = await withTenant(tenantId, (tx) =>
      tx.sponsorScan.findFirstOrThrow({
        where: { userId: outro },
        select: { consentedAt: true, sharedName: true, sharedEmail: true, xpAwarded: true },
      }),
    );

    expect(row.consentedAt).toBeNull();
    expect(row.sharedName).toBeNull();
    expect(row.sharedEmail).toBeNull();
    expect(row.xpAwarded).toBe(80);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('vínculo, convite e área do patrocinador', () => {
  it('o convite exige o e-mail da conta e invalida o anterior ao ser regerado', async () => {
    const primeiro = await inviteSponsorUser({
      tenantId,
      actorId: organizerId,
      sponsorId,
      email: `f42.contato.${RUN}@exemplo.test`,
    });
    expect(primeiro.ok).toBe(true);
    if (!primeiro.ok) return;

    const segundo = await inviteSponsorUser({
      tenantId,
      actorId: organizerId,
      sponsorId,
      email: `f42.contato.${RUN}@exemplo.test`,
    });
    expect(segundo.ok).toBe(true);
    if (!segundo.ok) return;

    /** O token antigo morreu: dois convites válidos seriam dois caminhos de entrada. */
    const comAntigo = await acceptSponsorInvite({
      tenantId,
      userId: contactId,
      userEmail: `f42.contato.${RUN}@exemplo.test`,
      token: primeiro.token,
    });
    expect(comAntigo.ok).toBe(false);

    const outroEmail = await acceptSponsorInvite({
      tenantId,
      userId: participantId,
      userEmail: `f42.participante.${RUN}@exemplo.test`,
      token: segundo.token,
    });
    expect(outroEmail.ok).toBe(false);
    if (!outroEmail.ok) expect(outroEmail.message).toContain('outro endereço');

    const aceito = await acceptSponsorInvite({
      tenantId,
      userId: contactId,
      userEmail: `f42.contato.${RUN}@exemplo.test`,
      token: segundo.token,
    });
    expect(aceito.ok, aceito.ok ? 'ok' : aceito.message).toBe(true);

    /** O aceite concede o papel — e o vínculo é o que diz QUAL patrocinador. */
    const role = await withTenant(tenantId, (tx) =>
      tx.roleAssignment.findFirst({
        where: { tenantId, userId: contactId, role: 'SPONSOR', revokedAt: null },
        select: { scope: true },
      }),
    );
    expect(role?.scope).toBe('TENANT');

    const access = await listSponsorAccess(tenantId, contactId);
    expect(access.map((entry) => entry.sponsorId)).toEqual([sponsorId]);
  });

  it('a área mostra o que a organização cadastrou e SÓ os contatos vigentes', async () => {
    const portal = await getSponsorPortal({ tenantId, userId: contactId });

    expect(portal.ok).toBe(true);
    if (!portal.ok) return;

    expect(portal.portal.selected?.name).toBe(`Instituto Parceiro ${RUN}`);
    expect(portal.portal.selected?.tierName).toBe('Ouro');
    expect(portal.portal.selected?.tierBenefits).toEqual(['Logo na página']);
    expect(portal.portal.selected?.contractStateLabel).toBe('Vigente');

    expect(portal.portal.counters.visits).toBe(2);
    expect(portal.portal.counters.leads).toBe(1);
    expect(portal.portal.leads[0]?.sharedEmail).toBe(`f42.participante.${RUN}@exemplo.test`);
  });

  it('quem não tem vínculo não vê nada — o papel sozinho não abre a lista', async () => {
    const semVinculo = await getSponsorPortal({ tenantId, userId: participantId });
    expect(semVinculo.ok).toBe(false);
    if (!semVinculo.ok) expect(semVinculo.code).toBe('NOT_FOUND');

    const acesso = await listSponsorAccess(tenantId, participantId);
    expect(acesso).toEqual([]);
  });

  it('vincular à mão exige conta COM vínculo na instituição', async () => {
    const semConta = await linkSponsorUserByEmail({
      tenantId,
      actorId: organizerId,
      sponsorId: otherSponsorId,
      email: `nao-existe.${RUN}@exemplo.test`,
    });
    expect(semConta.ok).toBe(false);
    if (!semConta.ok) expect(semConta.code).toBe('NO_ACCOUNT');

    const vinculado = await linkSponsorUserByEmail({
      tenantId,
      actorId: organizerId,
      sponsorId: otherSponsorId,
      email: `f42.contato.${RUN}@exemplo.test`,
    });
    expect(vinculado.ok, vinculado.ok ? 'ok' : `${vinculado.code}: ${vinculado.message}`).toBe(true);
    if (!vinculado.ok) return;

    /** Agora a mesma pessoa enxerga DOIS patrocinadores, e escolhe qual abrir. */
    const acesso = await listSponsorAccess(tenantId, contactId);
    expect(acesso).toHaveLength(2);

    const portal = await getSponsorPortal({ tenantId, userId: contactId, sponsorId: otherSponsorId });
    expect(portal.ok).toBe(true);
    if (portal.ok) expect(portal.portal.selected?.id).toBe(otherSponsorId);
  });

  it('remover o vínculo tira o acesso — e só revoga o papel quando não sobra nenhum', async () => {
    const time = await listSponsorTeam(tenantId, otherSponsorId);
    const line = time.find((row) => row.userId === contactId);
    expect(line).toBeDefined();

    const removed = await removeSponsorUser({ tenantId, actorId: organizerId, linkId: line!.linkId });
    expect(removed.ok).toBe(true);

    const acesso = await listSponsorAccess(tenantId, contactId);
    expect(acesso.map((entry) => entry.sponsorId)).toEqual([sponsorId]);

    /** Ainda é patrocinador do outro: o papel continua vigente. */
    const role = await withTenant(tenantId, (tx) =>
      tx.roleAssignment.findFirst({
        where: { tenantId, userId: contactId, role: 'SPONSOR', revokedAt: null },
        select: { id: true },
      }),
    );
    expect(role).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('revogação e vencimento (LGPD)', () => {
  it('revogar tira o contato da lista do patrocinador e MANTÉM a visita contada', async () => {
    const shares = await listMySponsorShares(tenantId, participantId);
    expect(shares).toHaveLength(1);
    expect(shares[0]?.state).toBe('ACTIVE');

    const revoke = await revokeSponsorConsent({
      tenantId,
      userId: participantId,
      scanId: shares[0]!.scanId,
    });
    expect(revoke.ok).toBe(true);

    const depois = await listMySponsorShares(tenantId, participantId);
    expect(depois[0]?.state).toBe('REVOKED');
    expect(depois[0]?.stateLabel).toContain('revogada');

    const portal = await getSponsorPortal({ tenantId, userId: contactId });
    expect(portal.ok).toBe(true);
    if (!portal.ok) return;

    expect(portal.portal.counters.leads).toBe(0);
    expect(portal.portal.leads).toEqual([]);
    /** A visita continua existindo: o número não mente sobre o que aconteceu. */
    expect(portal.portal.counters.visits).toBe(2);
  });

  it('autorização vencida fecha o acesso sozinha', async () => {
    const qr = await saveSponsorQrCode({
      tenantId,
      actorId: organizerId,
      sponsorId,
      eventId,
      label: 'Estande — prazo curto',
      xpAmount: 10,
      cardTemplateId: null,
      consentDays: 1,
    });
    expect(qr.ok).toBe(true);
    if (!qr.ok) return;

    const pessoa = await createUser('Prazo Curto F42', `f42.prazo.${RUN}@exemplo.test`);

    /** A leitura acontece no passado: é o que permite medir o vencimento. */
    const scan = await scanSponsorQr({
      tenantId,
      code: qr.code,
      userId: pessoa,
      consent: true,
      now: new Date('2026-01-01T12:00:00.000Z'),
    });
    expect(scan.ok).toBe(true);

    const vigenteNaEpoca = await listMySponsorShares(
      tenantId,
      pessoa,
      /** Seis horas depois da leitura: dentro do prazo de 1 dia. */
      new Date('2026-01-01T18:00:00.000Z'),
    );
    expect(vigenteNaEpoca[0]?.state).toBe('ACTIVE');

    const hoje = await listMySponsorShares(tenantId, pessoa, new Date('2026-06-01T12:00:00.000Z'));
    expect(hoje[0]?.state).toBe('EXPIRED');
  });

  it('a instituição VIZINHA não alcança o QR nem a leitura (RLS)', async () => {
    const portal = await getSponsorPortal({ tenantId: otherTenantId, userId: contactId });
    expect(portal.ok).toBe(false);

    const qr = await withTenant(tenantId, (tx) =>
      tx.sponsorQrCode.findFirstOrThrow({ where: { sponsorId }, select: { code: true } }),
    );

    /** O mesmo código, lido sob o contexto da vizinha, não existe. */
    const scan = await scanSponsorQr({
      tenantId: otherTenantId,
      code: qr.code,
      userId: participantId,
      consent: true,
    });
    expect(scan.ok).toBe(false);
    if (!scan.ok) expect(scan.code).toBe('NOT_FOUND');
  });
});
