/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — FASE 51
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DÍVIDA E70 — o link compartilhado tem prazo, contagem e estado
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O que só o banco de verdade prova:
 *   • o link criado SEM PRAZO abre, e a abertura é contada no banco;
 *   • abrir três vezes conta três (e a leitura de metadados/prévia não conta);
 *   • link VENCIDO não abre e responde IGUAL ao inexistente — byte a byte;
 *   • link REVOGADO não conta abertura;
 *   • a contagem que FALHA não derruba a página (invariante nº 8);
 *   • o dono vê "expirado" com o número de aberturas, e criar outro link revoga o
 *     vencido com o motivo na trilha (o histórico conta a história inteira).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DÍVIDA E73 — a lista de exportações mostra QUEM baixou
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a lista traz o nome e o instante dos últimos downloads;
 *  • sem download, a lista NÃO inventa autor — e o texto é "ninguém baixou ainda";
 *  • a trilha é lida em UMA consulta para a lista inteira (contado no teste).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { systemClient, withTenant } from '../../src/lib/db/tenant-client';
import {
  ensureCardShareLink,
  getCardShareState,
  readSharedCard,
  revokeCardShareLink,
} from '../../src/lib/gamification/card-share-service';
import { shareDateLabel } from '../../src/domain/gamification/card-share-rules';
import {
  EXPORT_DOWNLOADER_LIMIT,
  listRecentDataExports,
} from '../../src/lib/exports/export-service';
import {
  EXPORT_NO_DOWNLOADERS_LABEL,
  exportDownloadersLabel,
} from '../../src/domain/exports/export-rules';

const RUN = randomUUID().slice(0, 8);
/** Fuso da instituição: as datas deste arquivo são lidas em UTC-3. */
const TZ = 'America/Bahia';

let tenantId: string;
let userId: string;
let templateId: string;
let userCardId: string;
/** Dois autores distintos para a prova de "quem baixou" (E73). */
let ana: string;
let bruno: string;

const BASE = {
  tenantId: '',
  userId: '',
  tenantSlug: `f51-cartas-${RUN}`,
  tenantName: `Instituição F51 ${RUN}`,
  userCardId: '',
};

async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name,
      email: `f51.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
    },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  return id;
}

/** O token que a página pública usa — extraído do MESMO endereço que o dono copia. */
function tokenOf(state: { url: string | null }): string {
  return (state.url ?? '').split('/').pop() ?? '';
}

function dbLink() {
  return withTenant(tenantId, (tx) =>
    tx.cardShareLink.findFirstOrThrow({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true, viewCount: true, lastViewedAt: true, revokedAt: true },
    }),
  );
}

/** Faz o tempo passar sem mexer no relógio do processo. */
async function expireLink(linkId: string, when: Date): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.cardShareLink.update({ where: { id: linkId }, data: { expiresAt: when } }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: BASE.tenantSlug,
      name: BASE.tenantName,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: TZ,
    },
  });

  templateId = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.cardTemplate.create({
      data: {
        id: templateId,
        tenantId,
        eventId: null,
        slug: 'guardiao-do-metodo',
        name: 'Guardião do Método',
        description: 'Concedida por concluir um parecer.',
        rarity: 'LEGENDARY',
        trigger: 'REVIEW_COMPLETED',
        art: { holo: true, sheen: 80, tilt: 60 },
      },
    }),
  );

  userId = await createUser('Ana Souza');
  ana = userId;
  bruno = await createUser('Bruno Lima');

  BASE.tenantId = tenantId;
  BASE.userId = userId;
});

afterAll(async () => {
  await withTenant(tenantId, (tx) => tx.auditLog.deleteMany({ where: { tenantId } }));
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f51.${RUN}` } } });
  await adminPrisma.$disconnect();
});

beforeEach(async () => {
  await withTenant(tenantId, async (tx) => {
    await tx.cardShareLink.deleteMany({ where: { tenantId } });
    await tx.userCard.deleteMany({ where: { tenantId } });
    await tx.dataExport.deleteMany({ where: { tenantId } });
    /**
     * A trilha não é limpa pelo cascade (ela guarda o fato, não a linha): sem isto,
     * a contagem de downloads de um teste cairia no teste seguinte.
     */
    await tx.auditLog.deleteMany({ where: { tenantId } });
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
        source: 'REVIEW_COMPLETED',
        grantedAt: new Date('2026-03-12T15:00:00Z'),
      },
    }),
  );

  BASE.userCardId = userCardId;
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('E70 · link sem prazo e contagem de aberturas', () => {
  it('o link criado sem prazo abre e o estado do dono diz "sem prazo"', async () => {
    const created = await ensureCardShareLink(BASE);

    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    expect(created.state.status).toBe('VALID');
    expect(created.state.statusLabel).toBe('sem prazo');
    expect(created.state.expiresAt).toBeNull();
    expect(created.state.viewCount).toBe(0);
    expect(created.state.lastViewedLabel).toBeNull();
    expect(created.state.history).toHaveLength(1);
    expect(created.state.history[0]?.statusLabel).toBe('sem prazo');

    const shared = await readSharedCard({ tenantId, token: tokenOf(created.state), timezone: TZ });
    expect(shared.ok).toBe(true);
  });

  it('abrir a página conta a abertura, e a última abertura fica gravada', async () => {
    const created = await ensureCardShareLink(BASE);
    if (!created.ok) throw new Error(created.message);

    const token = tokenOf(created.state);

    await readSharedCard({ tenantId, token, timezone: TZ, registerView: true });
    await readSharedCard({ tenantId, token, timezone: TZ, registerView: true });
    await readSharedCard({ tenantId, token, timezone: TZ, registerView: true });

    const row = await dbLink();
    expect(row.viewCount).toBe(3);
    expect(row.lastViewedAt).not.toBeNull();

    const state = await getCardShareState(BASE);
    expect(state.ok).toBe(true);
    if (!state.ok) return;

    expect(state.state.viewCount).toBe(3);
    expect(state.state.lastViewedLabel).toContain('às');
    expect(state.state.history[0]?.viewsLabel).toContain('3 aberturas');
  });

  it('a leitura que NÃO é a página não conta (metadados e imagem de prévia)', async () => {
    const created = await ensureCardShareLink(BASE);
    if (!created.ok) throw new Error(created.message);

    const token = tokenOf(created.state);

    /**
     * `generateMetadata` e a rota da imagem de prévia leem o MESMO link a cada
     * requisição — inclusive a do robô que só busca a prévia para o WhatsApp.
     * Contá-las inflaria o número com visitas que ninguém fez.
     */
    await readSharedCard({ tenantId, token, timezone: TZ });
    await readSharedCard({ tenantId, token, timezone: TZ });

    expect((await dbLink()).viewCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('E70 · link vencido', () => {
  it('não abre, não conta e responde IGUAL ao link inexistente', async () => {
    const created = await ensureCardShareLink(BASE);
    if (!created.ok || !created.state.linkId) throw new Error('link não criado');

    const token = tokenOf(created.state);
    await expireLink(created.state.linkId, new Date(Date.now() - 60_000));

    const vencido = await readSharedCard({ tenantId, token, timezone: TZ, registerView: true });
    const inexistente = await readSharedCard({
      tenantId,
      token: 'a'.repeat(22),
      timezone: TZ,
      registerView: true,
    });

    /** A mesma resposta, campo por campo: nada distingue "existiu" de "nunca existiu". */
    expect(vencido).toEqual(inexistente);
    expect(vencido).toEqual({ ok: false, code: 'NOT_FOUND', message: 'Link não encontrado.' });

    /** E a recusa não conta abertura nenhuma. */
    expect((await dbLink()).viewCount).toBe(0);
  });

  it('o dono vê "expirado", sem endereço para copiar, com o histórico preservado', async () => {
    const created = await ensureCardShareLink(BASE);
    if (!created.ok || !created.state.linkId) throw new Error('link não criado');

    await readSharedCard({ tenantId, token: tokenOf(created.state), timezone: TZ, registerView: true });
    await expireLink(created.state.linkId, new Date(Date.now() - 60_000));

    const state = await getCardShareState(BASE);
    expect(state.ok).toBe(true);
    if (!state.ok) return;

    expect(state.state.status).toBe('EXPIRED');
    expect(state.state.statusLabel).toBe('expirado');
    expect(state.state.url).toBeNull();
    expect(state.state.historyCount).toBe(1);
    expect(state.state.history[0]?.statusLabel).toBe('expirado');
    expect(state.state.history[0]?.viewCount).toBe(1);
  });

  it('criar outro link REVOGA o vencido, com o motivo na trilha', async () => {
    const first = await ensureCardShareLink(BASE);
    if (!first.ok || !first.state.linkId) throw new Error('link não criado');

    const oldToken = tokenOf(first.state);
    await expireLink(first.state.linkId, new Date(Date.now() - 60_000));

    const second = await ensureCardShareLink({ ...BASE, validity: 'DAYS_30' });
    expect(second.ok, second.ok ? 'ok' : second.message).toBe(true);
    if (!second.ok) return;

    expect(second.state.historyCount).toBe(2);
    expect(second.state.url).not.toBeNull();
    expect(second.state.status).toBe('VALID');
    expect(second.state.statusLabel).toMatch(/^expira em \d{2}\/\d{2}\/\d{4}$/);

    /** O endereço antigo morreu de vez; o novo abre. */
    expect((await readSharedCard({ tenantId, token: oldToken, timezone: TZ })).ok).toBe(false);
    expect(
      (await readSharedCard({ tenantId, token: tokenOf(second.state), timezone: TZ })).ok,
    ).toBe(true);

    const trail = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId, entityType: 'card_share_link' },
        orderBy: { createdAt: 'desc' },
        select: { action: true, changes: true, entityId: true },
      }),
    );

    const revogacao = trail.find((entry) => entry.action === 'DELETE');
    expect(revogacao?.entityId).toBe(first.state.linkId);
    expect(JSON.stringify(revogacao?.changes ?? {})).toContain('prazo do link vencido');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('E70 · prazo escolhido por quem cria', () => {
  it('"7 dias" vira um prazo no futuro e o rótulo diz a data certa', async () => {
    const created = await ensureCardShareLink({ ...BASE, validity: 'DAYS_7' });
    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok || !created.state.expiresAt) return;

    const sevenDays = 7 * 86_400_000;
    expect(created.state.expiresAt.getTime() - Date.now()).toBeGreaterThan(sevenDays - 60_000);
    expect(created.state.expiresAt.getTime() - Date.now()).toBeLessThan(sevenDays + 60_000);

    expect(created.state.statusLabel).toBe(`expira em ${shareDateLabel(created.state.expiresAt, TZ)}`);
  });

  it('a data escolhida vale até o fim do dia no fuso da INSTITUIÇÃO', async () => {
    const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

    const created = await ensureCardShareLink({ ...BASE, validity: 'ON_DATE', validityDay: day });
    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok || !created.state.expiresAt) return;

    /** 23:59 em Salvador (UTC-3) = 02:59 do dia seguinte em UTC — não meia-noite. */
    expect(created.state.expiresAt.getUTCHours()).toBe(2);
    expect(created.state.expiresAt.getUTCMinutes()).toBe(59);

    const [year, month, dayOfMonth] = day.split('-');
    expect(shareDateLabel(created.state.expiresAt, TZ)).toBe(`${dayOfMonth}/${month}/${year}`);
  });

  it('data já passada é RECUSADA e nenhum link nasce', async () => {
    const result = await ensureCardShareLink({
      ...BASE,
      validity: 'ON_DATE',
      validityDay: '2020-01-01',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_VALIDITY');
    expect(await withTenant(tenantId, (tx) => tx.cardShareLink.count({ where: { tenantId } }))).toBe(0);
  });

  it('link revogado não conta abertura', async () => {
    const created = await ensureCardShareLink(BASE);
    if (!created.ok || !created.state.linkId) throw new Error('link não criado');

    const token = tokenOf(created.state);
    await readSharedCard({ tenantId, token, timezone: TZ, registerView: true });

    const revoked = await revokeCardShareLink({
      tenantId,
      userId,
      linkId: created.state.linkId,
    });
    expect(revoked.ok).toBe(true);

    const after = await readSharedCard({ tenantId, token, timezone: TZ, registerView: true });
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.code).toBe('NOT_FOUND');

    /** A abertura de antes da revogação continua contada; nenhuma nova entrou. */
    expect((await dbLink()).viewCount).toBe(1);

    const state = await getCardShareState(BASE);
    expect(state.ok).toBe(true);
    if (!state.ok) return;

    expect(state.state.status).toBeNull();
    expect(state.state.history[0]?.statusLabel).toBe('revogado');
  });

  it('a contagem que FALHA não derruba a página (invariante 8)', async () => {
    const created = await ensureCardShareLink(BASE);
    if (!created.ok) throw new Error(created.message);

    const token = tokenOf(created.state);
    const base = systemClient();
    const original = base.$transaction.bind(base);

    let calls = 0;
    const spy = vi.spyOn(base, '$transaction').mockImplementation(((
      ...args: unknown[]
    ) => {
      calls += 1;
      /** A 1ª transação é a LEITURA da carta; a 2ª é o contador. */
      if (calls === 2) return Promise.reject(new Error('contador fora do ar (simulado no teste)'));
      return original(...args);
    }) as unknown as typeof base.$transaction);

    let shared: Awaited<ReturnType<typeof readSharedCard>> | null = null;

    try {
      shared = await readSharedCard({ tenantId, token, timezone: TZ, registerView: true });
    } finally {
      spy.mockRestore();
    }

    expect(calls).toBeGreaterThanOrEqual(2);
    /** A carta abre mesmo com o contador caído: a recompensa não derruba o fluxo. */
    expect(shared?.ok, shared && !shared.ok ? shared.message : 'ok').toBe(true);
    if (!shared?.ok) return;
    expect(shared.card.cardName).toBe('Guardião do Método');

    /** E o contador não avançou: falha registrada não é contagem pela metade. */
    expect((await dbLink()).viewCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('E73 · quem baixou a exportação', () => {
  /** Cria o pedido direto no banco: aqui o assunto é a LEITURA da trilha. */
  async function makeExport(requestedById: string): Promise<string> {
    const id = randomUUID();

    await withTenant(tenantId, (tx) =>
      tx.dataExport.create({
        data: {
          id,
          tenantId,
          requestedById,
          kind: 'PARTICIPANTS_CSV',
          filters: {},
          rowCount: 12,
          /**
           * O pedido nasce no PASSADO: download só acontece depois de a exportação
           * existir, e é essa a janela que a consulta da trilha usa.
           */
          createdAt: new Date(Date.now() - 24 * 3_600_000),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    );

    return id;
  }

  /** O que o download grava de verdade: `EXPORT` com `entityId` = a exportação. */
  async function registerDownload(input: {
    exportId: string;
    downloaderId: string;
    at: Date;
  }): Promise<void> {
    await withTenant(tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId,
          userId: input.downloaderId,
          action: 'EXPORT',
          entityType: 'data_export',
          entityId: input.exportId,
          createdAt: input.at,
        },
      }),
    );
  }

  it('mostra QUEM baixou, com o instante, e lista dois autores distintos', async () => {
    const exportId = await makeExport(ana);
    const maisAntigo = new Date(Date.now() - 3_600_000);
    const maisRecente = new Date(Date.now() - 60_000);

    await registerDownload({ exportId, downloaderId: ana, at: maisAntigo });
    await registerDownload({ exportId, downloaderId: bruno, at: maisRecente });

    const [record] = await listRecentDataExports({ tenantId, kind: 'PARTICIPANTS_CSV' });

    expect(record?.id).toBe(exportId);
    expect(record?.downloaders.map((downloader) => downloader.name)).toEqual(['Bruno Lima', 'Ana Souza']);
    expect(record?.downloaders[0]?.at.getTime()).toBe(maisRecente.getTime());

    const line = exportDownloadersLabel({
      downloaders: record?.downloaders ?? [],
      downloadCount: record?.downloadCount ?? 0,
    });

    expect(line).toContain('baixado por');
    expect(line).toContain('Bruno Lima');
    expect(line).toContain('Ana Souza');
  });

  it('sem download, não inventa autor: o vazio é explícito', async () => {
    const exportId = await makeExport(ana);

    const [record] = await listRecentDataExports({ tenantId, kind: 'PARTICIPANTS_CSV' });

    expect(record?.id).toBe(exportId);
    expect(record?.downloaders).toEqual([]);
    expect(
      exportDownloadersLabel({ downloaders: [], downloadCount: record?.downloadCount ?? 0 }),
    ).toBe(EXPORT_NO_DOWNLOADERS_LABEL);
    expect(EXPORT_NO_DOWNLOADERS_LABEL).toBe('ninguém baixou ainda');
  });

  it('só o EXPORT conta como download, e só da exportação certa', async () => {
    const comDownload = await makeExport(ana);
    const semDownload = await makeExport(bruno);

    await registerDownload({ exportId: comDownload, downloaderId: bruno, at: new Date() });

    /** Leitura de ficha (`READ`) não é download; entidade de outro tipo também não. */
    await withTenant(tenantId, async (tx) => {
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId,
          userId: ana,
          action: 'READ',
          entityType: 'data_export',
          entityId: semDownload,
        },
      });

      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId,
          userId: ana,
          action: 'EXPORT',
          entityType: 'card_share_link',
          entityId: semDownload,
        },
      });
    });

    const records = await listRecentDataExports({ tenantId, kind: 'PARTICIPANTS_CSV' });
    const porId = new Map(records.map((record) => [record.id, record]));

    expect(porId.get(comDownload)?.downloaders.map((downloader) => downloader.name)).toEqual([
      'Bruno Lima',
    ]);
    expect(porId.get(semDownload)?.downloaders).toEqual([]);
  });

  it('os últimos downloads: a linha guarda no máximo o teto, do mais novo para o mais antigo', async () => {
    const exportId = await makeExport(ana);
    const base = Date.now() - 10 * 3_600_000;
    for (let index = 0; index < EXPORT_DOWNLOADER_LIMIT + 2; index += 1) {
      await registerDownload({
        exportId,
        downloaderId: index % 2 === 0 ? ana : bruno,
        at: new Date(base + index * 60_000),
      });
    }

    const [record] = await listRecentDataExports({ tenantId, kind: 'PARTICIPANTS_CSV' });
    const downloaders = record?.downloaders ?? [];

    expect(downloaders).toHaveLength(EXPORT_DOWNLOADER_LIMIT);
    /** Ordem decrescente: o último download registrado é o primeiro da lista. */
    expect(downloaders[0]?.at.getTime()).toBe(base + (EXPORT_DOWNLOADER_LIMIT + 1) * 60_000);

    /** O total continua visível na linha, mesmo com a lista cortada. */
    const line = exportDownloadersLabel({ downloaders, downloadCount: EXPORT_DOWNLOADER_LIMIT + 2 });
    expect(line).toContain('+2 download(s)');
  });

  it('a trilha da lista inteira sai em UMA consulta (não uma por exportação)', async () => {
    const primeira = await makeExport(ana);
    const segunda = await makeExport(ana);
    const terceira = await makeExport(bruno);

    await registerDownload({ exportId: primeira, downloaderId: ana, at: new Date() });
    await registerDownload({ exportId: segunda, downloaderId: bruno, at: new Date() });

    const base = systemClient();
    const spy = vi.spyOn(base, '$transaction');

    let records: Awaited<ReturnType<typeof listRecentDataExports>> = [];
    let transactions = 0;

    try {
      records = await listRecentDataExports({ tenantId, kind: 'PARTICIPANTS_CSV' });
      /** Lido ANTES do restore: `mockRestore` apaga o histórico do espião. */
      transactions = spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }

    expect(records).toHaveLength(3);
    expect(records.find((record) => record.id === terceira)?.downloaders).toEqual([]);

    /**
     * DUAS transações, com três exportações na lista: a das exportações e a da
     * trilha. Uma consulta por linha daria 1 + 3 — e `audit_logs` é particionada por
     * mês, então cada uma dessas idas varreria partições por conta própria.
     */
    expect(transactions).toBe(2);
  });
});
