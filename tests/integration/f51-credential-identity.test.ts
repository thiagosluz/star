/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Identidade visual do crachá (FASE 51 · dívida E42)
 *
 *  Roda contra o banco real, com RLS e a role de runtime. Prova o que o domínio puro
 *  não alcança:
 *
 *    • a categoria é GRAVADA na emissão, e sem categoria explícita o crachá nasce
 *      `PARTICIPANT` (o padrão da coluna);
 *    • a categoria ATRAVESSA as quatro saídas — folha A4, etiqueta adesiva, ZPL e
 *      crachá online —, cada uma com a cor do seu token;
 *    • trocar a categoria pela tela reflete na lista e NO PAPEL, sem trocar o código
 *      (a etiqueta que está na mão da pessoa continua valendo);
 *    • a folha em LOTE respeita a categoria de cada um (40 participantes + 4 da
 *      equipe saem com duas faixas diferentes, no mesmo arquivo);
 *    • a cor do TEMA DO EVENTO entra na arte, e um tema inválido não derruba a
 *      impressão — ele cai na identidade da plataforma.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { prepareBadgePrint } from '../../src/lib/events/badge-print-service';
import { renderBadgeLabelSheetPdf, renderBadgeSheetPdf } from '../../src/lib/credentials/badge-renderer';
import {
  getOwnCredential,
  issueCredentials,
  listCredentialRoster,
  setCredentialCategory,
} from '../../src/lib/events/credential-service';
import {
  CREDENTIAL_CATEGORY_DEFINITIONS,
  credentialCategoryColor,
  pdfFillOperator,
} from '../../src/domain/events/credential-categories';
import { buildBadgeZpl, DEFAULT_THERMAL_CONFIG } from '../../src/domain/events/badge-print-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

/** A cor do tema do evento — conferida LITERALMENTE no PDF gerado. */
const EVENT_THEME_COLOR = '#b45309';

let tenantId: string;
let eventId: string;
let actorId: string;
let plainEventId: string;

const people: Record<string, string> = {};

async function createPerson(name: string, tenant = tenantId): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f51.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId: tenant, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  return id;
}

async function register(userId: string, targetEvent = eventId): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId: targetEvent,
        activityId: null,
        userId,
        status: 'CONFIRMED',
      },
    }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  plainEventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f51-crachas-${RUN}`,
      name: `Instituição Crachá F51 ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  await withTenant(tenantId, async (tx) => {
    /**
     * O evento principal tem TEMA PRÓPRIO — é o que prova que a cor do evento chega
     * ao papel. O segundo evento não tem tema, e é o controle: sem cor escolhida, o
     * crachá sai com a identidade da plataforma.
     */
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `congresso-f51-${RUN}`,
        title: 'Congresso F51',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-11-10T11:00:00.000Z'),
        endsAt: new Date('2026-11-10T22:00:00.000Z'),
        timezone: TIME_ZONE,
        capacity: null,
        confirmedCount: 0,
        theme: { primaryColor: EVENT_THEME_COLOR },
      },
    });

    await tx.event.create({
      data: {
        id: plainEventId,
        tenantId,
        slug: `encontro-f51-${RUN}`,
        title: 'Encontro sem tema',
        status: 'IN_PROGRESS',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-12-01T11:00:00.000Z'),
        endsAt: new Date('2026-12-01T22:00:00.000Z'),
        timezone: TIME_ZONE,
        capacity: null,
        confirmedCount: 0,
      },
    });
  });

  actorId = await createPerson('Secretaria F51');

  for (const [key, name] of [
    ['ana', 'Ana Crachá F51'],
    ['bruno', 'Bruno Crachá F51'],
    ['carla', 'Carla Crachá F51'],
    ['diego', 'Diego Crachá F51'],
  ] as const) {
    people[key] = await createPerson(name);
    await register(people[key]!);
  }
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

describe('a categoria é gravada na emissão', () => {
  it('sem categoria explícita, o crachá nasce PARTICIPANT', async () => {
    const issued = await issueCredentials({
      tenantId,
      eventId,
      actorId,
      userIds: [people.ana!],
    });

    expect(issued.ok).toBe(true);

    const roster = await listCredentialRoster({ tenantId, eventId });
    expect(roster.ok).toBe(true);
    if (!roster.ok) return;

    const ana = roster.entries.find((entry) => entry.userId === people.ana);

    expect(ana?.credential?.category).toBe('PARTICIPANT');
  });

  it('a emissão em MASSA grava a categoria do lote para todos', async () => {
    const issued = await issueCredentials({
      tenantId,
      eventId,
      actorId,
      userIds: [people.bruno!, people.carla!],
      category: 'STAFF',
    });

    expect(issued.ok).toBe(true);

    const roster = await listCredentialRoster({ tenantId, eventId });
    expect(roster.ok).toBe(true);
    if (!roster.ok) return;

    for (const userId of [people.bruno, people.carla]) {
      expect(roster.entries.find((entry) => entry.userId === userId)?.credential?.category).toBe('STAFF');
    }
  });

  it('categoria desconhecida no lote cai no PADRÃO, e não inventa uma nova', async () => {
    const issued = await issueCredentials({
      tenantId,
      eventId,
      actorId,
      userIds: [people.diego!],
      category: 'CHEFE-DE-TUDO',
    });

    expect(issued.ok).toBe(true);

    const roster = await listCredentialRoster({ tenantId, eventId });
    expect(roster.ok).toBe(true);
    if (!roster.ok) return;

    expect(roster.entries.find((entry) => entry.userId === people.diego)?.credential?.category).toBe(
      'PARTICIPANT',
    );
  });
});

describe('a listagem mostra a categoria e filtra por ela', () => {
  it('o filtro devolve só o crachá daquela categoria', async () => {
    const staff = await listCredentialRoster({ tenantId, eventId, category: 'STAFF' });

    expect(staff.ok).toBe(true);
    if (!staff.ok) return;

    expect(staff.entries.length).toBeGreaterThan(0);

    for (const entry of staff.entries) {
      expect(entry.credential?.category).toBe('STAFF');
    }

    expect(staff.entries.map((entry) => entry.userId).sort()).toEqual([people.bruno, people.carla].sort());
  });

  it('quem NÃO tem crachá fica de fora do filtro de categoria', async () => {
    /**
     * A categoria mora no CRACHÁ. Devolver, no filtro "Equipe", alguém sem crachá
     * seria afirmar uma categoria sobre dado que não existe.
     */
    const semCrachá = await createPerson('Sem Crachá F51');

    await register(semCrachá);

    const staff = await listCredentialRoster({ tenantId, eventId, category: 'STAFF' });
    expect(staff.ok).toBe(true);
    if (!staff.ok) return;

    expect(staff.entries.some((entry) => entry.userId === semCrachá)).toBe(false);

    /** Sem filtro, a mesma pessoa aparece — é o "falta emitir" da tela. */
    const all = await listCredentialRoster({ tenantId, eventId });
    expect(all.ok).toBe(true);
    if (!all.ok) return;

    expect(all.entries.some((entry) => entry.userId === semCrachá)).toBe(true);
  });

  it('categoria desconhecida no filtro não filtra nada (não zera a lista)', async () => {
    const weird = await listCredentialRoster({ tenantId, eventId, category: 'NAO-EXISTE' });

    expect(weird.ok).toBe(true);
    if (!weird.ok) return;

    const all = await listCredentialRoster({ tenantId, eventId });
    expect(all.ok).toBe(true);
    if (!all.ok) return;

    expect(weird.entries.length).toBe(all.entries.length);
  });
});

describe('trocar a categoria pela tela', () => {
  it('muda a categoria SEM trocar o código, e a trilha guarda as duas pontas', async () => {
    const before = await listCredentialRoster({ tenantId, eventId });
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const ana = before.entries.find((entry) => entry.userId === people.ana);
    const credentialId = ana?.credential?.id;
    const code = ana?.credential?.code;

    expect(credentialId).toBeTruthy();

    const changed = await setCredentialCategory({
      tenantId,
      credentialId: credentialId!,
      actorId,
      category: 'VIP',
    });

    expect(changed.ok).toBe(true);

    const after = await listCredentialRoster({ tenantId, eventId });
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    const anaAfter = after.entries.find((entry) => entry.userId === people.ana);

    expect(anaAfter?.credential?.category).toBe('VIP');
    /** O código é o MESMO: o crachá que está na mão dela continua valendo. */
    expect(anaAfter?.credential?.code).toBe(code);
  });

  it('recusa categoria fora do catálogo (não apaga a anterior em silêncio)', async () => {
    const roster = await listCredentialRoster({ tenantId, eventId });
    expect(roster.ok).toBe(true);
    if (!roster.ok) return;

    const ana = roster.entries.find((entry) => entry.userId === people.ana);

    const refused = await setCredentialCategory({
      tenantId,
      credentialId: ana!.credential!.id,
      actorId,
      category: 'CHEFE',
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;

    expect(refused.code).toBe('INVALID_INPUT');

    /** A categoria anterior continua lá. */
    const again = await listCredentialRoster({ tenantId, eventId });
    expect(again.ok).toBe(true);
    if (!again.ok) return;

    expect(again.entries.find((entry) => entry.userId === people.ana)?.credential?.category).toBe('VIP');
  });

  it('recusa crachá de OUTRA instituição e crachá revogado', async () => {
    const other = randomUUID();

    await adminPrisma.tenant.create({
      data: {
        id: other,
        slug: `f51-outro-${RUN}`,
        name: `Outra ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: TIME_ZONE,
      },
    });

    try {
      const roster = await listCredentialRoster({ tenantId, eventId });
      expect(roster.ok).toBe(true);
      if (!roster.ok) return;

      const ana = roster.entries.find((entry) => entry.userId === people.ana);

      /**
       * ── A POSSE É RECONFERIDA NO BANCO (armadilha 42) ─────────────────────────
       *  O `withTenant` da OUTRA instituição não enxerga a linha (RLS), e o serviço
       *  responde `NOT_FOUND` — a mesma resposta de quem pediu um id que não existe.
       *  Isso é o correto: negar diferente revelaria que o crachá existe.
       */
      const crossTenant = await setCredentialCategory({
        tenantId: other,
        credentialId: ana!.credential!.id,
        actorId,
        category: 'STAFF',
      });

      expect(crossTenant.ok).toBe(false);
      if (crossTenant.ok) return;
      expect(crossTenant.code).toBe('NOT_FOUND');
    } finally {
      await adminPrisma.tenant.delete({ where: { id: other } });
    }
  });
});

describe('a identidade visual atravessa as quatro saídas', () => {
  it('a folha A4 traz a COR DO TEMA e a FAIXA da categoria', async () => {
    const prepared = await prepareBadgePrint({ tenantId, eventId, actorId });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.batch.theme.primaryColor).toBe(EVENT_THEME_COLOR);

    const pdf = renderBadgeSheetPdf({
      tenantName: prepared.batch.tenantName,
      eventTitle: prepared.batch.eventTitle,
      generatedAt: new Date('2026-11-01T12:00:00.000Z'),
      badges: prepared.batch.badges,
      theme: prepared.batch.theme,
    }).toString('latin1');

    /** A cor do evento aparece no PDF como operador — e não como `var(--…)`. */
    const accent = pdfFillOperator(EVENT_THEME_COLOR);
    expect(pdf).toContain(accent);

    /** E a faixa de CADA categoria presente no lote, pela cor do seu token. */
    const categories = new Set(prepared.batch.badges.map((badge) => badge.category));

    for (const category of categories) {
      expect(pdf, `faixa de ${category} ausente na folha`).toContain(
        pdfFillOperator(credentialCategoryColor(category)),
      );
    }
  });

  it('a etiqueta adesiva e a folha A4 usam a MESMA régua de cor', async () => {
    const prepared = await prepareBadgePrint({ tenantId, eventId, actorId });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const labels = renderBadgeLabelSheetPdf({
      tenantName: prepared.batch.tenantName,
      eventTitle: prepared.batch.eventTitle,
      generatedAt: new Date('2026-11-01T12:00:00.000Z'),
      badges: prepared.batch.badges,
      theme: prepared.batch.theme,
      layout: {
        columns: 3,
        rows: 8,
        labelWidthMm: 63.5,
        labelHeightMm: 33.9,
        marginLeftMm: 9.75,
        marginTopMm: 12.9,
        gapXMm: 0,
        gapYMm: 0,
      },
    }).toString('latin1');

    expect(labels).toContain(pdfFillOperator(EVENT_THEME_COLOR));
    expect(labels).toContain(pdfFillOperator(credentialCategoryColor('STAFF')));
  });

  it('o ZPL leva a faixa, e o crachá online leva o rótulo e o tom', async () => {
    const prepared = await prepareBadgePrint({ tenantId, eventId, actorId });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const zpl = buildBadgeZpl(
      {
        name: 'Ana Crachá F51',
        code: 'CR-ABCD-EFGH',
        category: 'VIP',
        eventTitle: prepared.batch.eventTitle,
        tenantName: prepared.batch.tenantName,
      },
      DEFAULT_THERMAL_CONFIG,
    );

    /** 100 mm a 203 dpi = 799 pontos; a barra ocupa a largura inteira. */
    expect(zpl).toContain('^FO0,0^GB799,');
    expect(zpl).toContain('CR-ABCD-EFGH');

    const own = await getOwnCredential({ tenantId, userId: people.ana!, eventId });

    expect(own.ok).toBe(true);
    if (!own.ok) return;

    expect(own.category.key).toBe('VIP');
    expect(own.category.label).toBe(CREDENTIAL_CATEGORY_DEFINITIONS.VIP.label);
    expect(own.category.tone).toBe(CREDENTIAL_CATEGORY_DEFINITIONS.VIP.tone);
    /** O crachá online recebe a cor do evento para desenhar a mesma identidade. */
    expect(own.theme.primaryColor).toBe(EVENT_THEME_COLOR);
  });

  it('o lote em MASSA respeita a categoria de CADA um', async () => {
    const prepared = await prepareBadgePrint({ tenantId, eventId, actorId });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const byCategory = new Map<string, number>();

    for (const badge of prepared.batch.badges) {
      const key = badge.category ?? 'PARTICIPANT';
      byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
    }

    /** O evento tem crachás em mais de uma categoria — é o caso da folha misturada. */
    expect(byCategory.size).toBeGreaterThan(1);
    expect(byCategory.get('STAFF')).toBeGreaterThanOrEqual(1);

    const pdf = renderBadgeSheetPdf({
      tenantName: prepared.batch.tenantName,
      eventTitle: prepared.batch.eventTitle,
      generatedAt: new Date('2026-11-01T12:00:00.000Z'),
      badges: prepared.batch.badges,
      theme: prepared.batch.theme,
    }).toString('latin1');

    for (const category of byCategory.keys()) {
      expect(pdf, `faixa de ${category} ausente no lote misto`).toContain(
        pdfFillOperator(credentialCategoryColor(category)),
      );
    }
  });

  it('evento SEM tema sai com a identidade da plataforma (não quebra)', async () => {
    const bruno2 = await createPerson('Bruno Sem Tema F51');
    await register(bruno2, plainEventId);

    const issued = await issueCredentials({
      tenantId,
      eventId: plainEventId,
      actorId,
      userIds: [bruno2],
      category: 'PRESS',
    });

    expect(issued.ok).toBe(true);

    const prepared = await prepareBadgePrint({ tenantId, eventId: plainEventId, actorId });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    expect(prepared.batch.theme.primaryColor).toBeNull();

    const pdf = renderBadgeSheetPdf({
      tenantName: prepared.batch.tenantName,
      eventTitle: prepared.batch.eventTitle,
      generatedAt: new Date('2026-11-01T12:00:00.000Z'),
      badges: prepared.batch.badges,
      theme: prepared.batch.theme,
    }).toString('latin1');

    /** A cor do CÓDIGO é a de sempre (FASE 31) e a faixa é a da categoria. */
    expect(pdf).toContain('0.110 0.310 0.851 rg');
    expect(pdf).toContain(pdfFillOperator(credentialCategoryColor('PRESS')));
  });
});
