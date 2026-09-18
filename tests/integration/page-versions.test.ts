/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — histórico de versões da página (FASE 23, item E12)
 *
 *  Prova o que o domínio puro não alcança:
 *    • a versão é gravada NA MESMA TRANSAÇÃO da alteração;
 *    • salvar sem mudança NÃO cria versão (deduplicação pelo checksum do banco);
 *    • a versão marcada como "atual" é a do estado vigente — e a marca anda depois
 *      de uma restauração;
 *    • restaurar devolve o conteúdo e NÃO mexe na publicação;
 *    • a retenção mantém as mais recentes;
 *    • a tabela nova respeita o isolamento (RLS).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  addPageBlock,
  ensureHomePage,
  getLandingForEdit,
  movePageBlock,
  savePageSettings,
  updatePageBlock,
  deletePageBlock,
} from '../../src/lib/admin/landing-service';
import { listPageVersions, restorePageVersion } from '../../src/lib/admin/page-version-service';
import { MAX_PAGE_VERSIONS } from '../../src/domain/events/page-version-rules';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let actorId: string;

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f23-versoes-${RUN}`,
      name: `Instituição Versões ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  const other = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f23-versoes-outra-${RUN}`,
      name: `Outra Versões ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  otherTenantId = other.id;

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: { id: actorId, name: 'Organizador Versões', email: `f23.${RUN}@exemplo.test` },
  });

  eventId = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f23-${RUN}`,
        title: `Congresso F23 ${RUN}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-12-10T13:00:00.000Z'),
        endsAt: new Date('2026-12-12T21:00:00.000Z'),
        timezone: 'America/Bahia',
        confirmedCount: 0,
      },
    }),
  );
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

const versionsOf = async (tenant = tenantId) => {
  const history = await listPageVersions(tenant, eventId);
  return history?.versions ?? [];
};

// ═══════════════════════════════════════════════════════════════════════════════
describe('gravação de versões', () => {
  it('a página criada já tem a primeira versão', async () => {
    const created = await ensureHomePage({ tenantId, eventId, actorId });
    expect(created.ok).toBe(true);

    const versions = await versionsOf();
    expect(versions).toHaveLength(1);
    expect(versions[0]?.reason).toBe('Página criada');
    expect(versions[0]?.isCurrent).toBe(true);
    expect(versions[0]?.actorName).toBe('Organizador Versões');
  });

  it('salvar SEM mudança não cria versão nova (deduplicação)', async () => {
    const before = await versionsOf();

    const saved = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso F23 ${RUN}`,
      metaTitle: null,
      metaDescription: null,
      isPublished: false,
    });
    expect(saved.ok).toBe(true);

    expect(await versionsOf()).toHaveLength(before.length);
  });

  it('mudar o conteúdo cria versão, e a nova passa a ser a atual', async () => {
    const block = await addPageBlock({ tenantId, eventId, actorId, type: 'RICH_TEXT' });
    expect(block.ok).toBe(true);
    if (!block.ok) return;

    const afterAdd = await versionsOf();
    expect(afterAdd[0]?.reason).toBe('Bloco adicionado');
    expect(afterAdd[0]?.isCurrent).toBe(true);

    await updatePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: block.blockId,
      content: { title: 'Sobre', body: 'Primeira redação.' },
    });

    const afterEdit = await versionsOf();
    expect(afterEdit[0]?.reason).toBe('Conteúdo alterado');
    expect(afterEdit[0]?.blockCount).toBe(1);
    expect(afterEdit.filter((version) => version.isCurrent)).toHaveLength(1);
    expect(afterEdit[0]?.isCurrent).toBe(true);
  });

  it('a versão é gravada na MESMA transação: alteração recusada não gera versão', async () => {
    const before = await versionsOf();

    const rejected = await updatePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: (await versionBlockId()) ?? '',
      content: { body: 'a'.repeat(9000) },
    });

    expect(rejected.ok).toBe(false);
    expect(await versionsOf()).toHaveLength(before.length);
  });

  it('reordenar também é versionado', async () => {
    await addPageBlock({ tenantId, eventId, actorId, type: 'FAQ' });

    const landing = await getLandingForEdit(tenantId, eventId);
    const second = landing?.page?.blocks[1]?.id;
    expect(second).toBeDefined();

    const moved = await movePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: second!,
      direction: 'up',
    });
    expect(moved.ok).toBe(true);
    expect((await versionsOf())[0]?.reason).toBe('Ordem alterada');
  });
});

async function versionBlockId(): Promise<string | null> {
  const landing = await getLandingForEdit(tenantId, eventId);
  return landing?.page?.blocks[0]?.id ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('restauração', () => {
  it('restaura o conteúdo E não mexe na publicação', async () => {
    /**
     * A página é publicada DEPOIS de existir uma versão de rascunho. Restaurar aquela
     * versão não pode despublicar: quem decide o que está no ar é o organizador, e um
     * "desfazer" que tira a página do ar seria uma surpresa caríssima.
     */
    const published = await savePageSettings({
      tenantId,
      eventId,
      actorId,
      title: `Congresso F23 ${RUN}`,
      metaTitle: null,
      metaDescription: null,
      isPublished: true,
    });
    expect(published.ok).toBe(true);

    const versions = await versionsOf();
    const draftVersion = versions.find((version) => !version.isPublished && !version.isCurrent);
    expect(draftVersion).toBeDefined();

    const currentBlock = (await getLandingForEdit(tenantId, eventId))?.page?.blocks[0]?.id;
    await updatePageBlock({
      tenantId,
      eventId,
      actorId,
      blockId: currentBlock!,
      content: { title: 'Sobre', body: 'TEXTO QUE SERÁ DESCARTADO' },
    });

    const restored = await restorePageVersion({
      tenantId,
      eventId,
      actorId,
      versionId: draftVersion!.id,
    });

    expect(restored.ok).toBe(true);

    const landing = await getLandingForEdit(tenantId, eventId);
    // Conteúdo voltou ao da versão restaurada…
    expect(JSON.stringify(landing?.page?.blocks[0]?.content)).not.toContain('SERÁ DESCARTADO');
    // …e a publicação continua como estava (publicada).
    expect(landing?.page?.isPublished).toBe(true);
    expect(landing?.page?.publicationState).toBe('PUBLISHED');
  });

  it('a restauração GRAVA UMA VERSÃO NOVA e ela passa a ser a atual', async () => {
    const versions = await versionsOf();
    expect(versions[0]?.reason).toBe('Restaurada de uma versão anterior');
    expect(versions[0]?.isCurrent).toBe(true);
    expect(versions.filter((version) => version.isCurrent)).toHaveLength(1);
  });

  it('recusa versão de OUTRA instituição', async () => {
    const version = (await versionsOf())[1];
    expect(version).toBeDefined();

    const denied = await restorePageVersion({
      tenantId: otherTenantId,
      eventId,
      actorId,
      versionId: version!.id,
    });

    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('NOT_FOUND');
  });

  it('recusa versão de outro evento da mesma instituição', async () => {
    const version = (await versionsOf())[1];

    const denied = await restorePageVersion({
      tenantId,
      eventId: randomUUID(),
      actorId,
      versionId: version!.id,
    });

    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('retenção e isolamento', () => {
  it('mantém no máximo MAX_PAGE_VERSIONS versões, descartando as mais antigas', async () => {
    for (let index = 0; index < MAX_PAGE_VERSIONS + 5; index += 1) {
      const block = await addPageBlock({ tenantId, eventId, actorId, type: 'COUNTDOWN' });
      if (block.ok) {
        await deletePageBlock({ tenantId, eventId, actorId, blockId: block.blockId });
      }
    }

    const versions = await versionsOf();
    expect(versions.length).toBeLessThanOrEqual(MAX_PAGE_VERSIONS);

    // A lista continua da mais recente para a mais antiga.
    for (let index = 1; index < versions.length; index += 1) {
      expect(versions[index - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        versions[index]!.createdAt.getTime(),
      );
    }
  });

  it('o histórico é por PÁGINA e some com a instituição (RLS + cascade)', async () => {
    const stored = await withTenant(tenantId, (tx) =>
      tx.eventPageVersion.count({ where: { tenantId } }),
    );
    expect(stored).toBeGreaterThan(0);

    // Sob o contexto da OUTRA instituição, nada é visível.
    const foreign = await withTenant(otherTenantId, (tx) => tx.eventPageVersion.count());
    expect(foreign).toBe(0);
  });
});
