/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — compartilhamento de carta (FASE 48)
 *
 *  O que só o banco de verdade prova:
 *   • o token NÃO é gravado em claro, e o selo devolve o mesmo endereço depois;
 *   • compartilhar duas vezes NÃO invalida o link que já foi enviado;
 *   • a leitura pública é servida sob RLS: token de outra instituição não existe;
 *   • a página devolve SÓ a carta — nem XP, nem álbum, nem e-mail;
 *   • revogar corta o acesso na hora, e a linha continua como histórico;
 *   • o nome que sai respeita a régua da FASE 44 (nome privado ⇒ `@handle`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  ensureCardShareLink,
  getCardShareState,
  readSharedCard,
  revokeCardShareLink,
  NEUTRAL_SHARE_NAME,
} from '../../src/lib/gamification/card-share-service';
import { openShareToken } from '../../src/lib/gamification/card-share-token';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let otherTenantId: string;
let userId: string;
let userCardId: string;
let templateId: string;

const BASE = {
  tenantId: '',
  userId: '',
  tenantSlug: `cartas-${RUN}`,
  tenantName: `Instituição Cartas ${RUN}`,
  userCardId: '',
};

async function createUser(input: {
  name: string;
  username?: string | null;
  profileAudiences?: Record<string, string>;
}): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: input.name,
      email: `cartas.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
      publicHandle: input.username ?? null,
      profileAudiences: (input.profileAudiences ?? {}) as object,
    },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  return id;
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      { id: tenantId, slug: BASE.tenantSlug, name: BASE.tenantName, status: 'ACTIVE', plan: 'FREE' },
      {
        id: otherTenantId,
        slug: `cartas-outra-${RUN}`,
        name: `Outra Instituição ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
      },
    ],
  });

  templateId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.cardTemplate.create({
      data: {
        id: templateId,
        tenantId,
        eventId: null,
        slug: 'guardiao-do-metodo',
        name: 'Guardião do Método',
        description: 'Concedida por concluir um parecer.',
        lore: 'O trabalho invisível que sustenta a ciência',
        rarity: 'LEGENDARY',
        trigger: 'REVIEW_COMPLETED',
        art: { holo: true, sheen: 80, tilt: 60 },
      },
    });
  });

  userId = await createUser({ name: 'Ana Souza', username: `ana-${RUN}` });
  BASE.tenantId = tenantId;
  BASE.tenantSlug = `cartas-${RUN}`;
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

beforeEach(async () => {
  await withTenant(tenantId, async (tx) => {
    await tx.cardShareLink.deleteMany({ where: { tenantId } });
    await tx.userCard.deleteMany({ where: { tenantId } });
    /**
     * A trilha NÃO é limpa pelo cascade (ela guarda o fato, não a linha): sem esta
     * remoção, a asserção de auditoria contaria os fatos dos testes anteriores.
     */
    await tx.auditLog.deleteMany({ where: { tenantId, entityType: 'card_share_link' } });
  });

  userCardId = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.userCard.create({
      data: {
        id: userCardId,
        tenantId,
        userId,
        cardTemplateId: templateId,
        quantity: 2,
        isFoil: false,
        source: 'REVIEW_COMPLETED',
        grantedAt: new Date('2026-03-12T15:00:00Z'),
      },
    }),
  );

  BASE.userId = userId;
  BASE.userCardId = userCardId;
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('criação do link', () => {
  it('o token NÃO é gravado em claro — e o selo devolve o mesmo endereço', async () => {
    const created = await ensureCardShareLink(BASE);

    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    const url = created.state.url ?? '';
    const token = url.split('/').pop() ?? '';
    expect(token.length).toBeGreaterThan(15);

    const row = await withTenant(tenantId, (tx) =>
      tx.cardShareLink.findFirstOrThrow({
        where: { tenantId, userCardId },
        select: { tokenHash: true, tokenSealed: true },
      }),
    );

    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenSealed).not.toContain(token);
    // O selo abre com o segredo da aplicação: é assim que o dono reexibe o link.
    expect(openShareToken(row.tokenSealed)).toBe(token);
  });

  it('compartilhar duas vezes devolve o MESMO link (não invalida o que já foi enviado)', async () => {
    const first = await ensureCardShareLink(BASE);
    const second = await ensureCardShareLink(BASE);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.state.url).toBe(first.state.url);
    expect(second.state.historyCount).toBe(1);

    const count = await withTenant(tenantId, (tx) => tx.cardShareLink.count({ where: { tenantId } }));
    expect(count).toBe(1);
  });

  it('carta que NÃO é sua não gera link', async () => {
    const other = await createUser({ name: 'Bruno Lima', username: `bruno-${RUN}` });

    const result = await ensureCardShareLink({ ...BASE, userId: other });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_OWNED');
  });

  it('a criação entra na trilha, e o token NUNCA é registrado', async () => {
    const created = await ensureCardShareLink(BASE);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const audit = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId, entityType: 'card_share_link' },
        select: { action: true, changes: true, userId: true },
      }),
    );

    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('CREATE');
    expect(audit[0]?.userId).toBe(userId);

    const serialized = JSON.stringify(audit[0]?.changes ?? {});
    const token = (created.state.url ?? '').split('/').pop() ?? '';
    expect(serialized).not.toContain(token);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('leitura pública', () => {
  async function link(): Promise<string> {
    const created = await ensureCardShareLink(BASE);
    if (!created.ok || !created.state.url) throw new Error('link não foi criado');
    return created.state.url.split('/').pop() ?? '';
  }

  it('devolve a carta com a ficha, a paleta e o palco resolvidos', async () => {
    const token = await link();

    const shared = await readSharedCard({ tenantId, token, timezone: 'America/Bahia' });

    expect(shared.ok, shared.ok ? 'ok' : shared.message).toBe(true);
    if (!shared.ok) return;

    expect(shared.card.cardName).toBe('Guardião do Método');
    expect(shared.card.rarity).toBe('LEGENDARY');
    expect(shared.card.displayName).toBe('Ana Souza');
    expect(shared.card.quantity).toBe(2);
    // A data da conquista sai no fuso da instituição (12/03 em Salvador).
    expect(shared.card.back.lines.find((line) => line.key === 'granted')?.value).toBe('12/03/2026');
    expect(shared.card.back.triggerLabel).toBe('Você concluiu um parecer');
    // O efeito é dado: veio do JSON da carta.
    expect(shared.card.stage.holo).toBe(true);
    expect(shared.card.stage.sheen).toBe(80);
  });

  it('NÃO devolve nada além da carta (nem XP, nem álbum, nem e-mail)', async () => {
    const token = await link();

    const shared = await readSharedCard({ tenantId, token, timezone: 'America/Bahia' });
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;

    const serialized = JSON.stringify(shared.card).toLowerCase();

    expect(serialized).not.toContain('@exemplo.test');
    expect(serialized).not.toContain('totalxp');
    expect(serialized).not.toContain('levelTitle');
    expect(serialized).not.toContain('certificate');
    expect(Object.keys(shared.card).sort()).toEqual(
      [
        'art',
        'avatarUrl',
        'back',
        'cardName',
        'displayName',
        'grantedAt',
        'imageUrl',
        'isFoil',
        'level',
        'palette',
        'quantity',
        'rarity',
        'sharedAt',
        'stage',
      ].sort(),
    );
  });

  it('token inventado não encontra nada', async () => {
    const shared = await readSharedCard({
      tenantId,
      token: 'inventado-que-nao-existe-1234',
      timezone: 'America/Bahia',
    });

    expect(shared.ok).toBe(false);
    if (shared.ok) return;
    expect(shared.code).toBe('NOT_FOUND');
  });

  it('token de OUTRA instituição não é encontrado (a RLS isola)', async () => {
    const token = await link();

    const shared = await readSharedCard({
      tenantId: otherTenantId,
      token,
      timezone: 'America/Bahia',
    });

    expect(shared.ok).toBe(false);
    if (shared.ok) return;
    expect(shared.code).toBe('NOT_FOUND');

    // E a linha é invisível para a outra instituição, sob o runtime.
    const rows = await withTenant(otherTenantId, (tx) =>
      tx.cardShareLink.findMany({ where: { tenantId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('a régua do nome é a da FASE 44: nome privado sai como @handle', async () => {
    const privateName = await createUser({
      name: 'Carla Nome Privado',
      username: `carla-${RUN}`,
      profileAudiences: { displayName: 'PRIVATE' },
    });

    const card = randomUUID();
    await withTenant(tenantId, (tx) =>
      tx.userCard.create({
        data: {
          id: card,
          tenantId,
          userId: privateName,
          cardTemplateId: templateId,
          source: 'REVIEW_COMPLETED',
        },
      }),
    );

    const created = await ensureCardShareLink({ ...BASE, userId: privateName, userCardId: card });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.state.shareDisplayName).toBe(`@carla-${RUN}`);
    expect(created.state.showsRealName).toBe(false);

    const shared = await readSharedCard({
      tenantId,
      token: (created.state.url ?? '').split('/').pop() ?? '',
      timezone: 'America/Bahia',
    });

    expect(shared.ok).toBe(true);
    if (!shared.ok) return;

    expect(shared.card.displayName).toBe(`@carla-${RUN}`);
    expect(JSON.stringify(shared.card)).not.toContain('Carla Nome Privado');
  });

  it('sem nome público e sem handle, o link usa um rótulo neutro (nunca o nome de cadastro)', async () => {
    const anonymous = await createUser({
      name: 'Diego Sem Handle',
      username: null,
      profileAudiences: { displayName: 'PRIVATE' },
    });

    const card = randomUUID();
    await withTenant(tenantId, (tx) =>
      tx.userCard.create({
        data: {
          id: card,
          tenantId,
          userId: anonymous,
          cardTemplateId: templateId,
          source: 'REVIEW_COMPLETED',
        },
      }),
    );

    const created = await ensureCardShareLink({ ...BASE, userId: anonymous, userCardId: card });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.state.shareDisplayName).toBe(NEUTRAL_SHARE_NAME);
    expect(created.state.shareDisplayName).not.toContain('Diego');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('revogação', () => {
  it('revogar corta o acesso na hora e preserva a linha', async () => {
    const created = await ensureCardShareLink(BASE);
    expect(created.ok).toBe(true);
    if (!created.ok || !created.state.linkId) return;

    const token = (created.state.url ?? '').split('/').pop() ?? '';

    const revoked = await revokeCardShareLink({
      tenantId,
      userId,
      linkId: created.state.linkId,
    });
    expect(revoked.ok).toBe(true);

    const shared = await readSharedCard({ tenantId, token, timezone: 'America/Bahia' });
    expect(shared.ok).toBe(false);

    const row = await withTenant(tenantId, (tx) =>
      tx.cardShareLink.findFirstOrThrow({ where: { tenantId }, select: { revokedAt: true } }),
    );
    expect(row.revokedAt).not.toBeNull();
  });

  it('depois de revogar, compartilhar de novo cria um endereço NOVO', async () => {
    const first = await ensureCardShareLink(BASE);
    expect(first.ok).toBe(true);
    if (!first.ok || !first.state.linkId) return;

    await revokeCardShareLink({ tenantId, userId, linkId: first.state.linkId });

    const second = await ensureCardShareLink(BASE);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.state.url).not.toBe(first.state.url);
    expect(second.state.historyCount).toBe(2);

    /** O antigo não abre mais; o novo sim. */
    const oldToken = (first.state.url ?? '').split('/').pop() ?? '';
    const newToken = (second.state.url ?? '').split('/').pop() ?? '';

    expect((await readSharedCard({ tenantId, token: oldToken, timezone: 'America/Bahia' })).ok).toBe(false);
    expect((await readSharedCard({ tenantId, token: newToken, timezone: 'America/Bahia' })).ok).toBe(true);
  });

  it('NÃO se revoga o link de outra pessoa', async () => {
    const created = await ensureCardShareLink(BASE);
    expect(created.ok).toBe(true);
    if (!created.ok || !created.state.linkId) return;

    const intruder = await createUser({ name: 'Eva Intrusa', username: `eva-${RUN}` });

    const revoked = await revokeCardShareLink({
      tenantId,
      userId: intruder,
      linkId: created.state.linkId,
    });

    expect(revoked.ok).toBe(false);
    if (revoked.ok) return;
    expect(revoked.code).toBe('NOT_FOUND');

    // O link do dono continua valendo.
    const token = (created.state.url ?? '').split('/').pop() ?? '';
    expect((await readSharedCard({ tenantId, token, timezone: 'America/Bahia' })).ok).toBe(true);
  });

  it('o estado lido pelo dono traz o endereço pronto para copiar', async () => {
    await ensureCardShareLink(BASE);

    const state = await getCardShareState(BASE);

    expect(state.ok).toBe(true);
    if (!state.ok) return;

    expect(state.state.url).toContain(`/t/${BASE.tenantSlug}/carta/`);
    expect(state.state.linkId).not.toBeNull();
    expect(state.state.shareText).toContain('Guardião do Método');
    expect(state.state.shareText).toContain('Ana Souza');
  });
});
