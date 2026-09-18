/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — patrocínio (FASE 17, item E5)
 *
 *  Prova o que o domínio puro não alcança:
 *    • o limite de vagas da cota é decidido com o estado real do banco;
 *    • o `slug` é único por INSTITUIÇÃO (dois eventos, um cadastro);
 *    • o documento fiscal é preservado quando o formulário não o reenvia;
 *    • a ordem de exibição pública sai da cota, e o inativo não aparece;
 *    • a remoção é LÓGICA — o histórico financeiro não evapora.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  deleteSponsorTier,
  listSponsorBoard,
  removeSponsor,
  saveSponsor,
  saveSponsorTier,
  setSponsorActive,
} from '../../src/lib/admin/sponsor-service';
import { getPublicEvent } from '../../src/lib/events/event-repository';
import { listAuditLog } from '../../src/lib/admin/audit';

const RUN = randomUUID().slice(0, 8);
const EVENT_SLUG = `evento-f17-patro-${RUN}`;
const SECOND_EVENT_SLUG = `evento-f17-patro2-${RUN}`;

let tenantId: string;
let eventId: string;
let secondEventId: string;
let actorId: string;

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f17-patro-${RUN}`,
      name: `Instituição Patrocínio ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: { id: actorId, name: 'Financeiro F17', email: `f17p.${RUN}@exemplo.test` },
  });

  eventId = randomUUID();
  secondEventId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    for (const [id, slug, title] of [
      [eventId, EVENT_SLUG, `Congresso Patrocínio ${RUN}`],
      [secondEventId, SECOND_EVENT_SLUG, `Simpósio Patrocínio ${RUN}`],
    ] as const) {
      await tx.event.create({
        data: {
          id,
          tenantId,
          slug,
          title,
          status: 'REGISTRATION_OPEN',
          modality: 'IN_PERSON',
          startsAt: new Date('2026-11-10T13:00:00.000Z'),
          endsAt: new Date('2026-11-12T21:00:00.000Z'),
          timezone: 'America/Bahia',
          confirmedCount: 0,
        },
      });
    }
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

const tier = (overrides: Record<string, unknown> = {}) => ({
  tenantId,
  eventId,
  actorId,
  key: 'GOLD' as const,
  name: 'Ouro',
  description: 'Cota com logo em destaque.',
  color: '#f59e0b',
  rank: 10,
  priceCents: 1_500_000,
  currency: 'BRL',
  maxSponsors: 0,
  benefits: ['Logo na página', 'Estande de 9 m²'],
  ...overrides,
});

let goldTierId: string;
let silverTierId: string;

// ═══════════════════════════════════════════════════════════════════════════════
describe('cotas', () => {
  it('cria a cota e a devolve no quadro', async () => {
    const created = await saveSponsorTier(tier());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    goldTierId = created.tierId;

    const board = await listSponsorBoard(tenantId, eventId);
    const row = board?.tiers.find((entry) => entry.id === goldTierId);

    expect(row?.name).toBe('Ouro');
    expect(row?.benefits).toEqual(['Logo na página', 'Estande de 9 m²']);
    expect(row?.remaining).toBeNull(); // 0 = ilimitado
  });

  it('recusa nome de cota repetido no MESMO evento', async () => {
    const duplicated = await saveSponsorTier(tier({ name: 'Ouro' }));
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) expect(duplicated.code).toBe('SLUG_TAKEN');
  });

  it('permite o mesmo nome de cota em OUTRO evento', async () => {
    const other = await saveSponsorTier(tier({ eventId: secondEventId }));
    expect(other.ok).toBe(true);
  });

  it('a cota com limite mostra as vagas restantes', async () => {
    const created = await saveSponsorTier(
      tier({ name: 'Prata', key: 'SILVER', rank: 20, maxSponsors: 2 }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    silverTierId = created.tierId;

    const board = await listSponsorBoard(tenantId, eventId);
    expect(board?.tiers.find((entry) => entry.id === silverTierId)?.remaining).toBe(1);
  });

  it('atualiza a cota e audita a mudança de limite', async () => {
    const updated = await saveSponsorTier(
      tier({ tierId: goldTierId, name: 'Ouro', maxSponsors: 5, rank: 5 }),
    );
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.created).toBe(false);

    const entries = await listAuditLog(tenantId, { limit: 50 });
    expect(
      entries.some(
        (entry) =>
          entry.entityType === 'sponsorTier' &&
          entry.action === 'UPDATE' &&
          'maxSponsors' in entry.changes,
      ),
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('patrocinadores', () => {
  let firstSponsorId: string;

  it('cadastra com cota e gera identificador a partir do nome', async () => {
    const created = await saveSponsor({
      tenantId,
      eventId,
      actorId,
      name: 'Instituto de Tecnologia Aberta',
      description: 'Apoiadora do congresso.',
      websiteUrl: 'https://example.org/ita',
      logoUrl: null,
      tierId: goldTierId,
      contactName: 'Marina Alves',
      contactEmail: 'marina@example.org',
      contactPhone: null,
      taxId: '12345678000199',
      contractValueCents: 1_500_000,
      contractStart: new Date('2026-01-01T12:00:00.000Z'),
      contractEnd: new Date('2026-12-31T12:00:00.000Z'),
      displayOrder: 0,
      isActive: true,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    firstSponsorId = created.sponsorId;
    expect(created.slug).toBe('instituto-de-tecnologia-aberta');
  });

  it('o documento fiscal aparece MASCARADO na leitura', async () => {
    const board = await listSponsorBoard(tenantId, eventId);
    const row = board?.sponsors.find((entry) => entry.id === firstSponsorId);
    expect(row?.taxIdMasked).toBe('12.345.678/****-99');
  });

  it('NÃO apaga o documento fiscal quando o formulário não o reenvia', async () => {
    /**
     * A tela mostra o CNPJ mascarado, então o formulário de edição não tem como
     * devolvê-lo. Se ausente significasse "limpar", abrir e salvar o formulário
     * apagaria o documento do patrocinador.
     */
    const updated = await saveSponsor({
      tenantId,
      eventId,
      actorId,
      sponsorId: firstSponsorId,
      name: 'Instituto de Tecnologia Aberta',
      description: 'Apoiadora do congresso.',
      websiteUrl: 'https://example.org/ita',
      logoUrl: null,
      tierId: goldTierId,
      contactName: 'Marina Alves',
      contactEmail: 'marina@example.org',
      contactPhone: '+55 71 99999-0000',
      // taxId ausente de propósito
      contractValueCents: 1_500_000,
      contractStart: new Date('2026-01-01T12:00:00.000Z'),
      contractEnd: new Date('2026-12-31T12:00:00.000Z'),
      displayOrder: 0,
      isActive: true,
    });

    expect(updated.ok).toBe(true);

    const board = await listSponsorBoard(tenantId, eventId);
    expect(board?.sponsors.find((entry) => entry.id === firstSponsorId)?.taxIdMasked).toBe(
      '12.345.678/****-99',
    );
  });

  it('o MESMO nome em evento da mesma instituição recebe identificador distinto', async () => {
    const created = await saveSponsor({
      tenantId,
      eventId: secondEventId,
      actorId,
      name: 'Instituto de Tecnologia Aberta',
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
      displayOrder: 0,
      isActive: true,
    });

    expect(created.ok).toBe(true);
    // `slug` é único por instituição: o segundo recebe sufixo em vez de duplicar.
    if (created.ok) expect(created.slug).toBe('instituto-de-tecnologia-aberta-2');
  });

  it('RESPEITA o limite de vagas da cota', async () => {
    const inSilver = {
      tenantId,
      eventId,
      actorId,
      name: 'Editora Prata Um',
      description: null,
      websiteUrl: null,
      logoUrl: null,
      tierId: silverTierId,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      taxId: null,
      contractValueCents: null,
      contractStart: null,
      contractEnd: null,
      displayOrder: 0,
      isActive: true,
    };

    const first = await saveSponsor(inSilver);
    expect(first.ok).toBe(true);

    const second = await saveSponsor({ ...inSilver, name: 'Editora Prata Dois' });
    expect(second.ok).toBe(true);

    // A cota comporta 2: a terceira é recusada — e a recusa cita o limite.
    const third = await saveSponsor({ ...inSilver, name: 'Editora Prata Três' });
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.code).toBe('TIER_FULL');
      expect(third.message).toMatch(/2 patrocinador/);
    }

    // A contagem no banco confirma que nada foi gravado pela metade.
    const stored = await withTenant(tenantId, (tx) =>
      tx.sponsor.count({ where: { tenantId, eventId, tierId: silverTierId, deletedAt: null } }),
    );
    expect(stored).toBe(2);
  });

  it('editar um patrocinador de cota cheia NÃO é bloqueado por ele mesmo', async () => {
    const board = await listSponsorBoard(tenantId, eventId);
    const inSilver = board?.sponsors.find((entry) => entry.tierName === 'Prata');
    expect(inSilver).toBeDefined();

    const updated = await saveSponsor({
      tenantId,
      eventId,
      actorId,
      sponsorId: inSilver!.id,
      name: inSilver!.name,
      description: 'Contrato renovado.',
      websiteUrl: inSilver!.websiteUrl,
      logoUrl: inSilver!.logoUrl,
      tierId: silverTierId,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      contractValueCents: null,
      contractStart: null,
      contractEnd: null,
      displayOrder: 1,
      isActive: true,
    });

    expect(updated.ok).toBe(true);
  });

  it('recusa fim de contrato antes do início', async () => {
    const invalid = await saveSponsor({
      tenantId,
      eventId,
      actorId,
      name: 'Contrato Invertido',
      description: null,
      websiteUrl: null,
      logoUrl: null,
      tierId: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      taxId: null,
      contractValueCents: null,
      contractStart: new Date('2026-12-01T12:00:00.000Z'),
      contractEnd: new Date('2026-01-01T12:00:00.000Z'),
      displayOrder: 0,
      isActive: true,
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe('INVALID_INPUT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('exibição pública', () => {
  it('a página pública mostra só os ATIVOS, na ordem da cota', async () => {
    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent).not.toBeNull();

    const names = publicEvent?.sponsors.map((sponsor) => sponsor.name) ?? [];
    expect(names).toContain('Instituto de Tecnologia Aberta');

    const ranks = publicEvent?.sponsors.map((sponsor) => sponsor.tierName) ?? [];
    // Ouro (rank atualizado para 5) antes de Prata (20).
    expect(ranks.indexOf('Ouro')).toBeLessThan(ranks.indexOf('Prata'));
  });

  it('ocultar tira o patrocinador da página SEM apagar o cadastro', async () => {
    const board = await listSponsorBoard(tenantId, eventId);
    const target = board?.sponsors.find((entry) => entry.tierName === 'Prata');
    expect(target).toBeDefined();

    const hidden = await setSponsorActive({
      tenantId,
      actorId,
      sponsorId: target!.id,
      isActive: false,
    });
    expect(hidden.ok).toBe(true);

    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(publicEvent?.sponsors.some((sponsor) => sponsor.id === target!.id)).toBe(false);

    const after = await listSponsorBoard(tenantId, eventId);
    expect(after?.sponsors.some((sponsor) => sponsor.id === target!.id)).toBe(true);
    expect(after?.publicCount).toBeLessThan(after?.sponsors.length ?? 0);
  });

  it('a cota do patrocinador viaja junto — o bloco pode filtrar por cota', async () => {
    const publicEvent = await getPublicEvent(tenantId, EVENT_SLUG);
    const sponsor = publicEvent?.sponsors.find(
      (entry) => entry.name === 'Instituto de Tecnologia Aberta',
    );

    expect(sponsor?.tierId).toBe(goldTierId);
    expect(sponsor?.tierName).toBe('Ouro');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('remoções', () => {
  it('recusa remover cota com patrocinadores dentro', async () => {
    const blocked = await deleteSponsorTier({ tenantId, eventId, actorId, tierId: goldTierId });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('TIER_IN_USE');
      expect(blocked.message).toContain('patrocinador');
    }
  });

  it('remove a cota vazia', async () => {
    const created = await saveSponsorTier(tier({ name: 'Apoio', key: 'SUPPORTER', rank: 40 }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const removed = await deleteSponsorTier({
      tenantId,
      eventId,
      actorId,
      tierId: created.tierId,
    });
    expect(removed.ok).toBe(true);

    const board = await listSponsorBoard(tenantId, eventId);
    expect(board?.tiers.some((entry) => entry.id === created.tierId)).toBe(false);
  });

  it('a remoção de patrocinador é LÓGICA — o histórico financeiro permanece', async () => {
    const created = await saveSponsor({
      tenantId,
      eventId,
      actorId,
      name: 'Patrocinador Efêmero',
      description: null,
      websiteUrl: null,
      logoUrl: null,
      tierId: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      taxId: null,
      contractValueCents: 750_000,
      contractStart: null,
      contractEnd: null,
      displayOrder: 9,
      isActive: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const removed = await removeSponsor({
      tenantId,
      actorId,
      sponsorId: created.sponsorId,
    });
    expect(removed.ok).toBe(true);

    const after = await listSponsorBoard(tenantId, eventId);
    expect(after?.sponsors.some((sponsor) => sponsor.id === created.sponsorId)).toBe(false);

    // A LINHA continua no banco, com o valor do contrato — auditoria e financeiro.
    const stored = await withTenant(tenantId, (tx) =>
      tx.sponsor.findFirst({
        where: { id: created.sponsorId },
        select: { deletedAt: true, isActive: true, contractValueCents: true },
      }),
    );
    expect(stored?.deletedAt).not.toBeNull();
    expect(stored?.isActive).toBe(false);
    expect(stored?.contractValueCents).toBe(750_000);
  });

  it('a trilha registra criação, alteração e remoção de patrocínio', async () => {
    const entries = await listAuditLog(tenantId, { limit: 200 });
    const sponsorActions = entries
      .filter((entry) => entry.entityType === 'sponsor')
      .map((entry) => entry.action);

    expect(sponsorActions).toContain('CREATE');
    expect(sponsorActions).toContain('UPDATE');
    expect(sponsorActions).toContain('DELETE');
  });

  it('o documento fiscal NUNCA entra na trilha', async () => {
    const entries = await listAuditLog(tenantId, { limit: 200 });
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('12345678000199');
    expect(serialized).not.toContain('taxId');
  });
});
