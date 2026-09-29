/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — exportação com prazo e trilha de identidade (FASE 49)
 *
 *  O que só o banco de verdade prova:
 *   • o PEDIDO fica gravado (autor, filtros, prazo) e o arquivo é regerado no
 *     download — não há cópia do dado pessoal parada em lugar nenhum;
 *   • a marca d'água sai no arquivo: procedência no topo e autor em CADA linha;
 *   • vencido o prazo, o download é RECUSADO — e é isso que dá sentido ao prazo;
 *   • revogar corta na hora e a linha continua como histórico;
 *   • exportação de outra instituição não existe (RLS), nem por id;
 *   • a trilha de identidade grava o FATO sem segredo e a role de runtime NÃO a lê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  buildDataExportFile,
  createDataExport,
  getDataExport,
  listRecentDataExports,
  revokeDataExport,
} from '../../src/lib/exports/export-service';
import {
  identityAuditSummary,
  listIdentityAudit,
  listMyIdentityAudit,
  recordIdentityAudit,
} from '../../src/lib/platform/identity-audit-service';
import { EXPORT_TTL_HOURS } from '../../src/domain/exports/export-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let otherTenantId: string;
let tenantSlug: string;
let eventId: string;
let ana: string;
let bruno: string;
let sponsorId: string;
let qrCodeId: string;

async function createUser(name: string, tenant = tenantId): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name,
      email: `f49.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
    },
  });

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId: tenant, userId: id, status: 'ACTIVE', joinedAt: new Date() },
  });

  return id;
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  tenantSlug = `f49-${RUN}`;

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: tenantSlug,
        name: `Instituição Exportação ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f49-outra-${RUN}`,
        name: `Instituição Vizinha ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: TIME_ZONE,
      },
    ],
  });

  eventId = randomUUID();

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `congresso-${RUN}`,
        title: 'Congresso da Exportação',
        status: 'PUBLISHED',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt: new Date('2026-09-01T12:00:00Z'),
        endsAt: new Date('2026-09-03T21:00:00Z'),
      },
    }),
  );

  ana = await createUser('Ana Exportadora');
  bruno = await createUser('Bruno Participante');

  /** Os dois têm inscrição: é a UNIÃO (vínculo ∪ inscrição) que os traz ao diretório. */
  await withTenant(tenantId, (tx) =>
    tx.registration.createMany({
      data: [ana, bruno].map((userId) => ({
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: null,
        userId,
        status: 'CONFIRMED' as const,
      })),
    }),
  );

  /** Patrocinador com um contato AUTORIZADO — para a exportação de contatos. */
  sponsorId = randomUUID();
  qrCodeId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.sponsor.create({
      data: {
        id: sponsorId,
        tenantId,
        eventId,
        name: `Instituto Parceiro ${RUN}`,
        slug: `parceiro-${RUN}`,
        isActive: true,
      },
    });

    await tx.sponsorQrCode.create({
      data: {
        id: qrCodeId,
        tenantId,
        sponsorId,
        eventId,
        code: `QR${RUN.slice(0, 6)}`.toUpperCase(),
        label: 'Estande',
        xpAmount: 0,
        consentDays: 90,
      },
    });

    await tx.sponsorScan.create({
      data: {
        id: randomUUID(),
        tenantId,
        qrCodeId,
        sponsorId,
        eventId,
        userId: bruno,
        consentedAt: new Date('2026-09-02T22:30:00Z'), // 19:30 em Salvador
        expiresAt: new Date('2026-12-01T12:00:00Z'),
        sharedName: 'Bruno Participante',
        sharedEmail: `bruno.${RUN}@exemplo.test`,
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.identityAuditLog.deleteMany({
    where: { userId: { in: [ana, bruno].filter(Boolean) } },
  });
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f49.${RUN}` } } });
  await adminPrisma.$disconnect();
});

beforeEach(async () => {
  await withTenant(tenantId, (tx) => tx.dataExport.deleteMany({ where: { tenantId } }));
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('pedido de exportação', () => {
  it('grava o ATO (autor, filtros, prazo) e não guarda o arquivo', async () => {
    const created = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'PARTICIPANTS_CSV',
      filters: { query: 'Bruno', onlyWithCertificate: false, onlyAttended: false, sponsorId: undefined },
    });

    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    expect(created.rowCount).toBeGreaterThanOrEqual(1);
    expect(created.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      EXPORT_TTL_HOURS * 3_600_000 + 5_000,
    );

    const record = await getDataExport({ tenantId, exportId: created.exportId });

    expect(record?.status).toBe('ATIVA');
    expect(record?.hoursLeft).toBe(EXPORT_TTL_HOURS);
    expect(record?.sponsorId).toBeNull();

    /** Filtro vazio é DESCARTADO: `{ onlyAttended: false }` descreveria recorte falso. */
    const stored = await withTenant(tenantId, (tx) =>
      tx.dataExport.findFirstOrThrow({
        where: { id: created.exportId },
        select: { filters: true, downloadCount: true },
      }),
    );

    expect(stored.filters).toEqual({ query: 'Bruno' });
    expect(stored.downloadCount).toBe(0);
  });

  it('o mesmo diretório gera pedidos distintos (exportar de novo é ato novo)', async () => {
    const first = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'PARTICIPANTS_CSV',
      filters: {},
    });
    const second = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'PARTICIPANTS_CSV',
      filters: {},
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.exportId).not.toBe(second.exportId);
    expect(await listRecentDataExports({ tenantId, kind: 'PARTICIPANTS_CSV' })).toHaveLength(2);
  });

  it('exportação de contatos exige o patrocinador', async () => {
    const semPatrocinador = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'SPONSOR_CONTACTS_CSV',
      filters: {},
    });

    expect(semPatrocinador.ok).toBe(false);
    if (!semPatrocinador.ok) expect(semPatrocinador.code).toBe('INVALID_INPUT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('arquivo com marca d\'água', () => {
  it('o CSV sai com procedência no topo, autor em CADA linha e validade', async () => {
    const created = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'PARTICIPANTS_CSV',
      filters: { eventId },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const file = await buildDataExportFile({
      tenantId,
      exportId: created.exportId,
      tenantSlug,
      actorId: ana,
    });

    expect(file.ok, file.ok ? 'ok' : file.message).toBe(true);
    if (!file.ok) return;

    const lines = file.csv.replace('\uFEFF', '').split('\r\n');
    const header = lines.find((line) => line.startsWith('Nome;E-mail')) ?? '';
    /** Linha de DADO não começa com `#` (o `#` marca o bloco de procedência e o rodapé). */
    const dataLines = lines.filter((line) => !line.startsWith('#') && line.includes('@exemplo.test'));

    expect(file.csv.startsWith('\uFEFF')).toBe(true);
    expect(file.csv).toContain('# Exportado por: Ana Exportadora <');
    expect(file.csv).toContain(`# Instituição: Instituição Exportação ${RUN}`);
    expect(file.csv).toContain('(America/Bahia)');
    expect(file.csv).toContain('# Filtros: Evento: Congresso da Exportação');
    expect(file.csv).toContain('# Válido até:');
    expect(file.csv).toContain('Exportado por');
    expect(header.endsWith('Exportado por')).toBe(true);

    expect(dataLines.length).toBeGreaterThanOrEqual(2);

    for (const line of dataLines) {
      expect(line).toContain('Ana Exportadora');
      expect(line).toContain('válido até');
    }

    expect(file.fileName).toBe(`participantes-${tenantSlug}-${new Date().toISOString().slice(0, 10)}.csv`);
  });

  it('o download entra na trilha da instituição e conta na linha do pedido', async () => {
    const created = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'PARTICIPANTS_CSV',
      filters: {},
    });
    if (!created.ok) throw new Error(created.message);

    await buildDataExportFile({ tenantId, exportId: created.exportId, tenantSlug, actorId: ana });
    await buildDataExportFile({ tenantId, exportId: created.exportId, tenantSlug, actorId: ana });

    const record = await getDataExport({ tenantId, exportId: created.exportId });
    expect(record?.downloadCount).toBe(2);
    expect(record?.lastDownloadedAt).toBeInstanceOf(Date);

    const trail = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId, entityType: 'data_export', entityId: created.exportId },
        select: { action: true, userId: true, changes: true },
      }),
    );

    expect(trail.some((entry) => entry.action === 'CREATE')).toBe(true);
    expect(trail.filter((entry) => entry.action === 'EXPORT')).toHaveLength(2);
    expect(trail.every((entry) => entry.userId === ana)).toBe(true);
  });

  it('o contato do patrocinador sai com a data no fuso da instituição', async () => {
    const created = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'SPONSOR_CONTACTS_CSV',
      filters: { sponsorId },
    });

    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    const file = await buildDataExportFile({
      tenantId,
      exportId: created.exportId,
      tenantSlug,
      actorId: ana,
    });

    expect(file.ok, file.ok ? 'ok' : file.message).toBe(true);
    if (!file.ok) return;

    const row = file.csv.split('\r\n').find((line) => line.includes('bruno.')) ?? '';

    /** 2026-09-02T22:30Z é dia 02 às 19:30 em Salvador — e não dia 03. */
    expect(row).toContain('2026-09-02');
    expect(file.csv).toContain('# Filtros: Instituto Parceiro');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('prazo e revogação', () => {
  it('vencido o prazo, o download é RECUSADO com a instrução de exportar de novo', async () => {
    const created = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'PARTICIPANTS_CSV',
      filters: {},
    });
    if (!created.ok) throw new Error(created.message);

    await withTenant(tenantId, (tx) =>
      tx.dataExport.update({
        where: { id: created.exportId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      }),
    );

    const file = await buildDataExportFile({ tenantId, exportId: created.exportId, tenantSlug, actorId: ana });

    expect(file.ok).toBe(false);
    if (!file.ok) {
      expect(file.code).toBe('EXPIRED');
      expect(file.message).toContain('Exporte de novo');
    }

    const record = await getDataExport({ tenantId, exportId: created.exportId });
    expect(record?.status).toBe('EXPIRADA');
    expect(record?.hoursLeft).toBe(0);
  });

  it('revogar corta na hora e a linha continua como histórico', async () => {
    const created = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'PARTICIPANTS_CSV',
      filters: {},
    });
    if (!created.ok) throw new Error(created.message);

    const revoked = await revokeDataExport({ tenantId, actorId: ana, exportId: created.exportId });
    expect(revoked.ok).toBe(true);

    const file = await buildDataExportFile({ tenantId, exportId: created.exportId, tenantSlug, actorId: ana });
    expect(file.ok).toBe(false);
    if (!file.ok) expect(file.code).toBe('REVOKED');

    const record = await getDataExport({ tenantId, exportId: created.exportId });
    expect(record?.status).toBe('REVOGADA');
    expect(record?.revokedAt).toBeInstanceOf(Date);

    /** Revogar de novo é resposta de negócio, não erro de sistema. */
    const again = await revokeDataExport({ tenantId, actorId: ana, exportId: created.exportId });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('NOT_FOUND');

    /** A exportação revogada CONTINUA na lista (o controle de destino é histórico). */
    const recent = await listRecentDataExports({ tenantId, kind: 'PARTICIPANTS_CSV' });
    expect(recent[0]?.status).toBe('REVOGADA');
  });

  it('exportação de outra instituição não é encontrada — nem por id', async () => {
    const created = await createDataExport({
      tenantId,
      actorId: ana,
      kind: 'PARTICIPANTS_CSV',
      filters: {},
    });
    if (!created.ok) throw new Error(created.message);

    expect(await getDataExport({ tenantId: otherTenantId, exportId: created.exportId })).toBeNull();

    const file = await buildDataExportFile({
      tenantId: otherTenantId,
      exportId: created.exportId,
      tenantSlug: `f49-outra-${RUN}`,
      actorId: ana,
    });

    expect(file.ok).toBe(false);
    if (!file.ok) expect(file.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('trilha de identidade', () => {
  it('grava o FATO, com gravidade e sem segredo', async () => {
    await recordIdentityAudit({
      userId: ana,
      event: 'PASSWORD_CHANGED',
      details: {
        outrasSessoesEncerradas: true,
        password: 'segredo-que-nao-pode-ficar',
        nested: { token: 'abc123' },
      },
      ipAddress: '203.0.113.10',
      userAgent: 'Vitest/1.0',
    });

    const entries = await listMyIdentityAudit({ userId: ana });

    expect(entries.length).toBeGreaterThanOrEqual(1);

    const entry = entries[0]!;
    expect(entry.event).toBe('PASSWORD_CHANGED');
    expect(entry.tone).toBe('CRITICAL');
    expect(entry.ipAddress).toBe('203.0.113.10');
    expect(entry.subjectName).toBe('Ana Exportadora');

    const serialized = JSON.stringify(entry.details);
    expect(serialized).not.toContain('segredo-que-nao-pode-ficar');
    expect(serialized).not.toContain('abc123');
    expect(entry.details).toMatchObject({ outrasSessoesEncerradas: true });
    expect(entry.details.password).toBe('[removido]');
  });

  it('a role de RUNTIME não lê a trilha (o privilégio é a proteção)', async () => {
    await recordIdentityAudit({ userId: ana, event: 'TWO_FACTOR_ENABLED' });

    await expect(
      withTenant(tenantId, (tx) => tx.identityAuditLog.count()),
    ).rejects.toThrow();
  });

  it('filtra por pessoa, por tipo e pagina', async () => {
    await recordIdentityAudit({ userId: ana, event: 'PASSWORD_SET' });
    await recordIdentityAudit({ userId: bruno, event: 'BACKUP_CODE_USED' });
    await recordIdentityAudit({ userId: bruno, event: 'SESSION_REVOKED' });

    const porPessoa = await listIdentityAudit({ userId: bruno });
    expect(porPessoa.entries.length).toBeGreaterThanOrEqual(2);
    expect(porPessoa.entries.every((entry) => entry.userId === bruno)).toBe(true);

    const porEvento = await listIdentityAudit({ event: 'BACKUP_CODE_USED' });
    expect(porEvento.entries.some((entry) => entry.userId === bruno)).toBe(true);

    const porBusca = await listIdentityAudit({ query: 'Ana Exportadora' });
    expect(porBusca.entries.some((entry) => entry.userId === ana)).toBe(true);
    expect(porBusca.entries.some((entry) => entry.userId === bruno)).toBe(false);

    const paginado = await listIdentityAudit({ pageSize: 1, page: 2 });
    expect(paginado.page).toBe(2);
    expect(paginado.entries.length).toBeLessThanOrEqual(1);

    const resumo = await identityAuditSummary({ days: 30 });
    expect(resumo.PASSWORD_SET ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('a trilha sobrevive à exclusão da conta (sem chave estrangeira)', async () => {
    const efemero = await createUser('Conta Efêmera F49');

    await recordIdentityAudit({ userId: efemero, event: 'PASSWORD_RESET_REQUESTED' });
    await adminPrisma.user.delete({ where: { id: efemero } });

    const entries = await listIdentityAudit({ userId: efemero });

    expect(entries.entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.entries[0]?.userId).toBe(efemero);
    /** O alvo não existe mais: a trilha mantém o identificador, não o nome. */
    expect(entries.entries[0]?.subjectName).toBeNull();
  });
});
