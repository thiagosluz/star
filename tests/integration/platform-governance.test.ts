/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — governança da plataforma (FASE 9)
 *
 *  Roda contra o banco real e prova o que o domínio puro não alcança:
 *    • o provisionamento é ATÔMICO: instituição + vínculo + OWNER, ou nada;
 *    • um slug em disputa não deixa instituição órfã nem papel concedido;
 *    • a suspensão corta o tráfego de verdade (vitrine e resolução de tenant);
 *    • o papel de PLATAFORMA é INVISÍVEL para a role de runtime (RLS);
 *    • as métricas somam o que existe, sem expor pessoa alguma.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  getTenantDetail,
  getTenantSummaries,
  grantSuperAdmin,
  provisionTenant,
  revokeSuperAdmin,
  setTenantStatus,
  updateTenantProfile,
} from '../../src/lib/platform/tenant-service';
import { getPlatformMetrics, listPlatformAudit } from '../../src/lib/platform/global-repository';
import { lookupTenant } from '../../src/lib/tenancy/tenant-resolver';
import { isTrafficAllowed } from '../../src/domain/platform/platform-rules';

const RUN = randomUUID().slice(0, 8);
const SLUG = `f9-${RUN}`;

let operatorId: string;
let ownerId: string;
let strangerId: string;
let tenantId: string;

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name: `Pessoa ${label} ${RUN}`, email: `f9.${label}.${RUN}@exemplo.test` },
  });
  return id;
}

function ownerEmail(): string {
  return `f9.owner.${RUN}@exemplo.test`;
}

/** Instituição de apoio: é nela que testamos o isolamento do papel de plataforma. */
async function createSupportTenant(slug: string, name: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.tenant.create({
    data: { id, slug, name, status: 'ACTIVE', plan: 'STARTER', timezone: 'America/Bahia' },
  });
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  operatorId = await createUser('operator');

  ownerId = randomUUID();
  await adminPrisma.user.create({
    data: { id: ownerId, name: `Dono ${RUN}`, email: ownerEmail() },
  });

  strangerId = await createUser('stranger');

  // SuperAdmin de plataforma: concessão em escopo PLATFORM, sem instituição.
  await adminPrisma.roleAssignment.create({
    data: {
      tenantId: null,
      userId: operatorId,
      role: 'SUPERADMIN',
      scope: 'PLATFORM',
      reason: 'Teste de integração da FASE 9',
    },
  });
});

afterAll(async () => {
  // Remove tudo o que a suíte criou — inclusive as concessões de plataforma.
  await adminPrisma.auditLog.deleteMany({
    where: { tenantId: null, entityId: tenantId },
  });
  await adminPrisma.roleAssignment.deleteMany({
    where: { OR: [{ tenantId }, { userId: { in: [operatorId, ownerId, strangerId] }, tenantId: null }] },
  });
  await adminPrisma.userTenantProfile.deleteMany({ where: { tenantId } });
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.tenant.deleteMany({ where: { slug: { startsWith: `f9-apoio-${RUN}` } } });
  await adminPrisma.user.deleteMany({
    where: { id: { in: [operatorId, ownerId, strangerId] } },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('provisionamento atômico', () => {
  it('valida os dados e recusa slug reservado antes de tocar no banco', async () => {
    const result = await provisionTenant(operatorId, {
      name: 'Instituição Inválida',
      slug: 'api',
      plan: 'FREE',
      ownerEmail: ownerEmail(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_INPUT');
      expect(result.details?.join(' ')).toContain('reservado');
    }

    const created = await adminPrisma.tenant.findUnique({ where: { slug: 'api' } });
    expect(created).toBeNull();
  });

  it('recusa proprietário sem conta na plataforma (e não cria a instituição)', async () => {
    const result = await provisionTenant(operatorId, {
      name: 'Sem Dono',
      slug: `f9-sem-dono-${RUN}`,
      plan: 'FREE',
      ownerEmail: `ninguem.${RUN}@exemplo.test`,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OWNER_NOT_FOUND');

    const created = await adminPrisma.tenant.findUnique({
      where: { slug: `f9-sem-dono-${RUN}` },
    });
    expect(created).toBeNull();
  });

  it('cria instituição, vínculo ATIVO e papel OWNER em uma única operação', async () => {
    const result = await provisionTenant(operatorId, {
      name: `Instituição Nova ${RUN}`,
      slug: SLUG,
      plan: 'PROFESSIONAL',
      ownerEmail: ownerEmail(),
      description: 'Instituição criada pelo painel de plataforma.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    tenantId = result.tenantId;
    expect(result.slug).toBe(SLUG);

    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, plan: true, isPublic: true, maxEvents: true, maxMembers: true },
    });

    expect(tenant).toMatchObject({
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      isPublic: true,
      // Quota não informada HERDA o plano (e não vira zero).
      maxEvents: 50,
      maxMembers: 5000,
    });

    const membership = await adminPrisma.userTenantProfile.findFirst({
      where: { tenantId, userId: ownerId },
      select: { status: true, joinedAt: true },
    });

    expect(membership?.status).toBe('ACTIVE');
    expect(membership?.joinedAt).not.toBeNull();

    const assignment = await adminPrisma.roleAssignment.findFirst({
      where: { tenantId, userId: ownerId },
      select: { role: true, scope: true },
    });

    expect(assignment).toMatchObject({ role: 'OWNER', scope: 'TENANT' });
  });

  it('registra a ação na trilha de plataforma (tenant_id nulo)', async () => {
    const audit = await listPlatformAudit({ entityId: tenantId, limit: 10 });

    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0]?.entityType).toBe('Tenant');
    expect(audit[0]?.action).toBe('CREATE');
    expect(audit[0]?.actorName).toContain('operator');
  });

  it('slug duplicado faz ROLLBACK e não deixa vínculo nem papel para trás', async () => {
    const otherOwner = await createUser('duplicado');

    const before = {
      memberships: await adminPrisma.userTenantProfile.count({ where: { userId: otherOwner } }),
      assignments: await adminPrisma.roleAssignment.count({ where: { userId: otherOwner } }),
      tenants: await adminPrisma.tenant.count({ where: { slug: SLUG } }),
    };

    const result = await provisionTenant(operatorId, {
      name: 'Tentativa Duplicada',
      slug: SLUG,
      plan: 'ENTERPRISE',
      ownerEmail: `f9.duplicado.${RUN}@exemplo.test`,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SLUG_TAKEN');

    const after = {
      memberships: await adminPrisma.userTenantProfile.count({ where: { userId: otherOwner } }),
      assignments: await adminPrisma.roleAssignment.count({ where: { userId: otherOwner } }),
      tenants: await adminPrisma.tenant.count({ where: { slug: SLUG } }),
    };

    // Nada mudou: a transação inteira foi revertida.
    expect(after).toEqual(before);
    expect(after.tenants).toBe(1);

    await adminPrisma.user.delete({ where: { id: otherOwner } });
  });

  it('a corrida pelo mesmo slug é decidida pelo índice único, não pela checagem prévia', async () => {
    const emailA = `f9.corrida.a.${RUN}@exemplo.test`;
    const emailB = `f9.corrida.b.${RUN}@exemplo.test`;

    const userA = await createUser('corrida-a');
    const userB = await createUser('corrida-b');

    await adminPrisma.user.update({ where: { id: userA }, data: { email: emailA } });
    await adminPrisma.user.update({ where: { id: userB }, data: { email: emailB } });

    const slug = `f9-corrida-${RUN}`;

    /**
     * Duas provisões SIMULTÂNEAS com o mesmo slug: a checagem de disponibilidade
     * das duas passa (nenhuma vê a outra), então quem decide é o banco. Exatamente
     * uma precisa vencer — e a perdedora não pode deixar rastro.
     */
    const [first, second] = await Promise.all([
      provisionTenant(operatorId, { name: 'Corrida A', slug, plan: 'FREE', ownerEmail: emailA }),
      provisionTenant(operatorId, { name: 'Corrida B', slug, plan: 'FREE', ownerEmail: emailB }),
    ]);

    const winners = [first, second].filter((result) => result.ok);
    const losers = [first, second].filter((result) => !result.ok);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    if (!losers[0]!.ok) expect(losers[0]!.code).toBe('SLUG_TAKEN');

    const tenants = await adminPrisma.tenant.findMany({ where: { slug }, select: { id: true } });
    expect(tenants).toHaveLength(1);

    const loserUserId = first.ok ? userB : userA;
    const orphanMemberships = await adminPrisma.userTenantProfile.count({
      where: { userId: loserUserId, tenantId: tenants[0]!.id },
    });
    expect(orphanMemberships).toBe(0);

    await adminPrisma.roleAssignment.deleteMany({ where: { tenantId: tenants[0]!.id } });
    await adminPrisma.userTenantProfile.deleteMany({ where: { tenantId: tenants[0]!.id } });
    await adminPrisma.tenant.delete({ where: { id: tenants[0]!.id } });
    await adminPrisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('ciclo de vida — suspensão e reativação', () => {
  it('recusa suspender sem justificativa suficiente', async () => {
    const result = await setTenantStatus(operatorId, {
      tenantId,
      status: 'SUSPENDED',
      reason: 'curto',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_STATE');

    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    expect(tenant?.status).toBe('ACTIVE');
  });

  it('suspende com justificativa e corta o tráfego imediatamente', async () => {
    const result = await setTenantStatus(operatorId, {
      tenantId,
      status: 'SUSPENDED',
      reason: 'Pendência financeira do plano PROFESSIONAL em aberto.',
    });

    expect(result.ok).toBe(true);

    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, suspendedAt: true, suspensionReason: true },
    });

    expect(tenant?.status).toBe('SUSPENDED');
    expect(tenant?.suspendedAt).toBeInstanceOf(Date);
    expect(tenant?.suspensionReason).toContain('Pendência financeira');
    expect(isTrafficAllowed(tenant!.status)).toBe(false);

    /**
     * A resolução de tenant — usada pelo Proxy e pelos layouts — passa a devolver
     * `not-operational`. É esta resposta que vira a página de bloqueio; sem isso a
     * suspensão seria apenas um campo no banco.
     */
    const lookup = await lookupTenant({
      kind: 'resolved',
      source: 'path',
      identifier: SLUG,
      isCustomDomain: false,
    });

    expect(lookup.kind).toBe('not-operational');
    if (lookup.kind === 'not-operational') {
      expect(lookup.reason).toBe('SUSPENDED');
      expect(lookup.tenant.slug).toBe(SLUG);
    }
  });

  it('recusa suspender duas vezes', async () => {
    const result = await setTenantStatus(operatorId, {
      tenantId,
      status: 'SUSPENDED',
      reason: 'Tentativa repetida de suspensão.',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_STATE');
  });

  it('reativa e devolve o acesso', async () => {
    const result = await setTenantStatus(operatorId, { tenantId, status: 'ACTIVE' });
    expect(result.ok).toBe(true);

    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, suspendedAt: true, suspensionReason: true },
    });

    expect(tenant).toMatchObject({ status: 'ACTIVE', suspendedAt: null, suspensionReason: null });
  });

  it('a suspensão fica registrada na trilha com motivo antes/depois', async () => {
    const audit = await listPlatformAudit({ entityId: tenantId, limit: 20 });
    const statusChanges = audit.filter(
      (entry) => entry.action === 'UPDATE' && 'status' in entry.changes,
    );

    expect(statusChanges.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('perfil público', () => {
  it('recusa URL que não seja http(s) — o diretório é página pública', async () => {
    const result = await updateTenantProfile(operatorId, {
      tenantId,
      description: 'Descrição válida.',
      logoUrl: 'javascript:alert(1)',
      websiteUrl: null,
      isPublic: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_INPUT');
  });

  it('salva descrição, logotipo e site válidos', async () => {
    const result = await updateTenantProfile(operatorId, {
      tenantId,
      description: 'Instituição de pesquisa e ensino.',
      logoUrl: 'https://cdn.exemplo.test/logo.png',
      websiteUrl: 'https://exemplo.test',
      isPublic: true,
    });

    expect(result.ok).toBe(true);

    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { description: true, logoUrl: true, websiteUrl: true },
    });

    expect(tenant?.logoUrl).toBe('https://cdn.exemplo.test/logo.png');
    expect(tenant?.websiteUrl).toBe('https://exemplo.test');
  });

  it('desligar a vitrine não desliga a instituição', async () => {
    const result = await updateTenantProfile(operatorId, {
      tenantId,
      description: 'Instituição discreta.',
      logoUrl: null,
      websiteUrl: null,
      isPublic: false,
    });

    expect(result.ok).toBe(true);

    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, isPublic: true },
    });

    // Some do diretório, mas continua operando para quem tem o link.
    expect(tenant).toMatchObject({ status: 'ACTIVE', isPublic: false });

    const lookup = await lookupTenant({
      kind: 'resolved',
      source: 'path',
      identifier: SLUG,
      isCustomDomain: false,
    });
    expect(lookup.kind).toBe('ok');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('papel de plataforma e isolamento', () => {
  it('a role de runtime NÃO enxerga a concessão de plataforma (tenant_id nulo)', async () => {
    const support = await createSupportTenant(`f9-apoio-${RUN}-a`, `Apoio A ${RUN}`);

    const visible = await withTenant(support, (tx) =>
      tx.roleAssignment.findMany({
        where: { userId: operatorId },
        select: { id: true, scope: true },
      }),
    );

    // Fail-closed: a policy compara tenant_id com o contexto, e NULL nunca é igual.
    expect(visible).toHaveLength(0);

    // Pela conexão administrativa (a única que a governança usa) a concessão existe.
    const adminView = await adminPrisma.roleAssignment.findFirst({
      where: { userId: operatorId, scope: 'PLATFORM' },
      select: { id: true },
    });
    expect(adminView).not.toBeNull();
  });

  it('conceder governança exige conta existente', async () => {
    const result = await grantSuperAdmin(operatorId, {
      email: `fantasma.${RUN}@exemplo.test`,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OWNER_NOT_FOUND');
  });

  it('concede e revoga a governança, registrando na trilha', async () => {
    const granted = await grantSuperAdmin(operatorId, {
      email: `f9.stranger.${RUN}@exemplo.test`,
      reason: 'Suplente de governança para o teste',
    });

    expect(granted.ok).toBe(true);

    const duplicate = await grantSuperAdmin(operatorId, {
      email: `f9.stranger.${RUN}@exemplo.test`,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe('ALREADY_OWNER');

    const revoked = await revokeSuperAdmin(operatorId, strangerId);
    expect(revoked.ok).toBe(true);
    if (revoked.ok) expect(revoked.revoked).toBe(1);

    const after = await adminPrisma.roleAssignment.count({
      where: { userId: strangerId, scope: 'PLATFORM', revokedAt: null },
    });
    expect(after).toBe(0);
  });

  it('não permite revogar o último SuperAdmin ativo', async () => {
    /**
     * O banco é COMPARTILHADO com os testes E2E, que criam os próprios
     * SuperAdmins. Para testar o invariante ("nunca ficar sem ninguém") o cenário
     * precisa ser isolado: as outras concessões são suspensas temporariamente e
     * restauradas no `finally`, para que este teste não tenha efeito colateral.
     */
    const others = await adminPrisma.roleAssignment.findMany({
      where: { scope: 'PLATFORM', tenantId: null, revokedAt: null, userId: { not: operatorId } },
      select: { id: true },
    });

    if (others.length > 0) {
      await adminPrisma.roleAssignment.updateMany({
        where: { id: { in: others.map((row) => row.id) } },
        data: { revokedAt: new Date() },
      });
    }

    try {
      const active = await adminPrisma.roleAssignment.count({
        where: { scope: 'PLATFORM', tenantId: null, revokedAt: null },
      });
      expect(active).toBe(1);

      const result = await revokeSuperAdmin(operatorId, operatorId);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('LAST_SUPERADMIN');

      const stillThere = await adminPrisma.roleAssignment.count({
        where: { userId: operatorId, scope: 'PLATFORM', revokedAt: null },
      });
      expect(stillThere).toBe(1);
    } finally {
      if (others.length > 0) {
        await adminPrisma.roleAssignment.updateMany({
          where: { id: { in: others.map((row) => row.id) } },
          data: { revokedAt: null },
        });
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('leitura do painel', () => {
  it('a listagem traz contadores agregados da instituição', async () => {
    const { tenants } = await getTenantSummaries({ status: 'ALL', query: SLUG });
    const row = tenants.find((tenant) => tenant.id === tenantId);

    expect(row).toBeDefined();
    expect(row?.memberCount).toBeGreaterThanOrEqual(1);
    expect(row?.eventCount).toBe(0);
    // O perfil foi desligado da vitrine no teste anterior: a listagem do painel
    // mostra a instituição de qualquer forma — governança vê o que a vitrine não vê.
    expect(row?.isPublic).toBe(false);
  });

  it('o detalhe traz os membros com seus papéis vigentes', async () => {
    const detail = await getTenantDetail(tenantId);
    expect(detail).not.toBeNull();

    const owner = detail!.members.find((member) => member.userId === ownerId);
    expect(owner).toBeDefined();
    expect(owner?.roles.map((role) => role.role)).toContain('OWNER');
  });

  it('instituição inexistente devolve null no detalhe', async () => {
    expect(await getTenantDetail(randomUUID())).toBeNull();
  });

  it('as métricas contam a plataforma e não expõem pessoa alguma', async () => {
    const metrics = await getPlatformMetrics();

    expect(metrics.tenants.total).toBeGreaterThanOrEqual(1);
    expect(metrics.users).toBeGreaterThanOrEqual(3);
    expect(metrics.memberships).toBeGreaterThanOrEqual(1);
    expect(metrics.generatedAt).toBeInstanceOf(Date);

    // O contrato de tipo é a garantia: não há campo de pessoa nem de e-mail.
    expect(Object.keys(metrics)).not.toContain('emails');
  });
});

