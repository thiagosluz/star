/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — quotas e planos (FASE 14: C1, C3, I4)
 *
 *  O que só o banco real pode provar:
 *    • C1 — a quota `maxMembers` RECUSA de verdade, no caminho de escrita real, e
 *      volta a permitir quando o plano é ajustado;
 *    • C1 — a inscrição pública, que também cria vínculo, NÃO consome a quota de
 *      membros (é essa separação que torna a quota aplicável);
 *    • C3 — o provisionamento grava as três quotas do plano, inclusive o
 *      armazenamento, e a troca de plano é auditada;
 *    • I4 — a lista de membros não mostra mais inscritos de evento, e a contagem
 *      de participantes aparece separada;
 *    • o vínculo promovido (participante que entra para a equipe) passa a contar.
 *
 *  As pessoas do cenário têm papéis distintos de propósito, para que a asserção de
 *  cada teste não dependa da ordem de execução: `membro` (vinculado), `bloqueado`
 *  (vinculado depois do aumento de quota), `so-participante` (nunca promovido) e
 *  `promovido` (inscrito e depois vinculado à equipe).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addTenantMember,
  getTenantDetail,
  provisionTenant,
  updateTenantPlan,
} from '../../src/lib/platform/tenant-service';
import {
  countTenantMembers,
  countTenantParticipants,
  listTenantMembers,
} from '../../src/lib/platform/global-repository';
import { getTeamOverview } from '../../src/lib/admin/member-service';
import { registerForActivity } from '../../src/lib/events/registration-service';
import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { PLAN_DEFINITIONS } from '../../src/domain/platform/platform-rules';

const RUN = randomUUID().slice(0, 8);

const EMAILS = {
  operador: `f14.operador.${RUN}@exemplo.test`,
  membro: `f14.membro.${RUN}@exemplo.test`,
  bloqueado: `f14.bloqueado.${RUN}@exemplo.test`,
  soParticipante: `f14.so-participante.${RUN}@exemplo.test`,
  promovido: `f14.promovido.${RUN}@exemplo.test`,
};

/** SuperAdmin que executa as ações de plataforma (o serviço só usa o id). */
let operatorId: string;
let memberId: string;
let blockedId: string;
let participantOnlyId: string;
let promotedId: string;

/** Instituição de trabalho, criada pelo provisionamento real. */
let tenantId: string;
let eventId: string;

/** Evento público com uma atividade — a fixture do fluxo de inscrição (FASE 10). */
async function createOpenEventWithActivity(): Promise<void> {
  const startsAt = new Date(Date.now() + 10 * 86_400_000);
  const activityId = randomUUID();

  eventId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: 'evento-aberto',
        title: 'Evento aberto',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 86_400_000),
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
        registrationOpensAt: new Date(Date.now() - 86_400_000),
        registrationClosesAt: new Date(Date.now() + 5 * 86_400_000),
        // Sem `registrationRequiresMembership` nas configurações: evento aberto.
        settings: {} as unknown as object,
      },
    });

    await tx.activity.create({
      data: {
        id: activityId,
        tenantId,
        eventId,
        slug: 'atividade-aberta',
        title: 'Atividade aberta',
        type: 'WORKSHOP',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        workloadMinutes: 60,
        capacity: 20,
        waitlistEnabled: false,
        confirmedCount: 0,
        waitlistCount: 0,
      },
    });
  });
}

async function createPerson(label: string, email: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({ data: { id, name: `Pessoa ${label} ${RUN}`, email } });

  return id;
}

beforeAll(async () => {
  operatorId = await createPerson('operador', EMAILS.operador);
  memberId = await createPerson('membro', EMAILS.membro);
  blockedId = await createPerson('bloqueado', EMAILS.bloqueado);
  participantOnlyId = await createPerson('so-participante', EMAILS.soParticipante);
  promotedId = await createPerson('promovido', EMAILS.promovido);

  /**
   * Provisionamento REAL: cria a instituição, o vínculo do proprietário (que ocupa
   * a primeira vaga de membro) e o papel OWNER.
   */
  const provisioned = await provisionTenant(operatorId, {
    name: `Instituição F14 ${RUN}`,
    slug: `f14-${RUN}`,
    plan: 'FREE',
    ownerEmail: EMAILS.operador,
  });

  if (!provisioned.ok) throw new Error(`provisionamento falhou: ${provisioned.message}`);

  tenantId = provisioned.tenantId;

  await createOpenEventWithActivity();

  // A equipe começa com uma pessoa além do proprietário: é o que permite testar a
  // redução de quota abaixo do uso e o esgotamento do teto.
  const linked = await addTenantMember(operatorId, {
    tenantId,
    email: EMAILS.membro,
    role: 'ADMIN',
  });

  if (!linked.ok) throw new Error(`vínculo inicial falhou: ${linked.message}`);
});

afterAll(async () => {
  await adminPrisma.auditLog.deleteMany({ where: { entityId: tenantId } });
  await adminPrisma.roleAssignment.deleteMany({ where: { tenantId } });
  await adminPrisma.userTenantProfile.deleteMany({ where: { tenantId } });
  await adminPrisma.registration.deleteMany({ where: { tenantId } });
  await adminPrisma.activity.deleteMany({ where: { tenantId } });
  await adminPrisma.event.deleteMany({ where: { tenantId } });
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({
    where: { id: { in: [operatorId, memberId, blockedId, participantOnlyId, promotedId] } },
  });
  await adminPrisma.$disconnect();
});

describe('C3 — provisionamento e troca de plano', () => {
  it('grava as TRÊS quotas do plano, inclusive o armazenamento', async () => {
    const created = await provisionTenant(operatorId, {
      name: `Instituição Storage ${RUN}`,
      slug: `f14-storage-${RUN}`,
      plan: 'PROFESSIONAL',
      ownerEmail: EMAILS.operador,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const tenant = await adminPrisma.tenant.findUniqueOrThrow({
      where: { id: created.tenantId },
      select: { maxEvents: true, maxMembers: true, maxStorageBytes: true, plan: true },
    });

    // Antes da FASE 14, `maxStorageBytes` ficava no default do schema (5 GiB) para
    // QUALQUER plano: uma instituição PROFESSIONAL nascia com quota de plano
    // gratuito, e a tela mostrava isso como se fosse o contratado.
    expect(tenant.plan).toBe('PROFESSIONAL');
    expect(tenant.maxEvents).toBe(PLAN_DEFINITIONS.PROFESSIONAL.maxEvents);
    expect(tenant.maxMembers).toBe(PLAN_DEFINITIONS.PROFESSIONAL.maxMembers);
    expect(Number(tenant.maxStorageBytes)).toBe(PLAN_DEFINITIONS.PROFESSIONAL.maxStorageBytes);

    await adminPrisma.roleAssignment.deleteMany({ where: { tenantId: created.tenantId } });
    await adminPrisma.userTenantProfile.deleteMany({ where: { tenantId: created.tenantId } });
    await adminPrisma.tenant.deleteMany({ where: { id: created.tenantId } });
  });

  it('recusa plano sem vaga para o proprietário designado', async () => {
    const created = await provisionTenant(operatorId, {
      name: `Instituição Zero ${RUN}`,
      slug: `f14-zero-${RUN}`,
      plan: 'FREE',
      ownerEmail: EMAILS.operador,
      maxMembers: 0,
    });

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.code).toBe('INVALID_INPUT');
  });

  it('troca de plano com as quotas padrão e registra a trilha de plataforma', async () => {
    const changed = await updateTenantPlan(operatorId, {
      tenantId,
      plan: 'STARTER',
      useDefaults: true,
    });

    expect(changed.ok).toBe(true);
    if (!changed.ok) return;

    expect(changed.plan).toBe('STARTER');
    expect(changed.quotas).toEqual({
      maxEvents: PLAN_DEFINITIONS.STARTER.maxEvents,
      maxMembers: PLAN_DEFINITIONS.STARTER.maxMembers,
      maxStorageBytes: PLAN_DEFINITIONS.STARTER.maxStorageBytes,
    });

    const audit = await adminPrisma.auditLog.findFirst({
      where: { entityType: 'TenantPlan', entityId: tenantId },
      orderBy: { createdAt: 'desc' },
    });

    expect(audit).not.toBeNull();
    expect(audit?.tenantId).toBeNull(); // trilha de PLATAFORMA
    expect(audit?.action).toBe('UPDATE');
  });

  it('avisa (sem recusar) quando a nova quota fica abaixo do uso', async () => {
    // Duas pessoas na equipe (proprietário + membro) e quota de um membro: a
    // redução é aceita — é decisão da plataforma —, mas a tela precisa saber o que
    // passou a estar bloqueado.
    const reduced = await updateTenantPlan(operatorId, {
      tenantId,
      plan: 'FREE',
      maxEvents: 5,
      maxMembers: 1,
    });

    expect(reduced.ok).toBe(true);
    if (!reduced.ok) return;

    expect(reduced.warnings.join(' ')).toContain('membro(s)');

    await updateTenantPlan(operatorId, { tenantId, plan: 'FREE', maxEvents: 5, maxMembers: 3 });
  });
});

describe('C1 — quota de membros aplicada no caminho de escrita', () => {
  it('vincula pessoa existente, cria o papel e grava o vínculo como equipe', async () => {
    const profile = await adminPrisma.userTenantProfile.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId, userId: memberId } },
      select: { kind: true, status: true },
    });

    expect(profile.kind).toBe('MEMBER');
    expect(profile.status).toBe('ACTIVE');

    const assignment = await adminPrisma.roleAssignment.findFirst({
      where: { tenantId, userId: memberId, role: 'ADMIN', revokedAt: null },
    });

    expect(assignment).not.toBeNull();
  });

  it('recusa pessoa sem conta, apontando o caminho', async () => {
    const linked = await addTenantMember(operatorId, {
      tenantId,
      email: `nao-existe.${RUN}@exemplo.test`,
      role: 'STAFF',
    });

    expect(linked.ok).toBe(false);
    if (!linked.ok) {
      expect(linked.code).toBe('OWNER_NOT_FOUND');
      expect(linked.details?.join(' ')).toContain('/signup');
    }
  });

  it('recusa quando a quota está esgotada e volta a permitir após o ajuste', async () => {
    // Quota de 2: proprietário + membro já a esgotam.
    await updateTenantPlan(operatorId, { tenantId, plan: 'FREE', maxEvents: 5, maxMembers: 2 });

    const blocked = await addTenantMember(operatorId, {
      tenantId,
      email: EMAILS.bloqueado,
      role: 'STAFF',
    });

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe('QUOTA_EXCEEDED');
      expect(blocked.details?.join(' ')).toContain('Membros hoje: 2 de 2');
    }

    const raised = await updateTenantPlan(operatorId, {
      tenantId,
      plan: 'FREE',
      maxEvents: 5,
      maxMembers: 10,
    });

    expect(raised.ok).toBe(true);

    const allowed = await addTenantMember(operatorId, {
      tenantId,
      email: EMAILS.bloqueado,
      role: 'STAFF',
    });

    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.memberCount).toBe(3);
  });

  it('não duplica vínculo de quem já é membro ativo', async () => {
    const again = await addTenantMember(operatorId, {
      tenantId,
      email: EMAILS.membro,
      role: 'ADMIN',
    });

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('ALREADY_MEMBER');
  });
});

describe('C1 — a inscrição pública cria PARTICIPANTE e não consome a quota', () => {
  it('quem se inscreve em evento aberto vira participante', async () => {
    const outcome = await registerForActivity({
      tenantId,
      eventSlug: 'evento-aberto',
      activitySlug: 'atividade-aberta',
      userId: participantOnlyId,
      consentData: true,
    });

    expect(outcome.ok).toBe(true);

    const profile = await adminPrisma.userTenantProfile.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId, userId: participantOnlyId } },
      select: { kind: true, status: true },
    });

    expect(profile.kind).toBe('PARTICIPANT');
    expect(profile.status).toBe('ACTIVE');
  });

  it('a instituição no limite de membros continua aceitando inscrição pública', async () => {
    const membersBefore = await countTenantMembers(tenantId);

    // Aperta a quota até o uso atual: nenhum membro novo entra.
    await updateTenantPlan(operatorId, {
      tenantId,
      plan: 'FREE',
      maxEvents: 5,
      maxMembers: membersBefore,
    });

    const outcome = await registerForActivity({
      tenantId,
      eventSlug: 'evento-aberto',
      activitySlug: 'atividade-aberta',
      userId: promotedId,
      consentData: true,
    });

    // Se a quota de membros contasse participantes, este teste falharia: a equipe
    // está no teto e o público tem de continuar entrando.
    expect(outcome.ok).toBe(true);
    expect(await countTenantMembers(tenantId)).toBe(membersBefore);

    // Reabre a quota para os testes de I4.
    await updateTenantPlan(operatorId, { tenantId, plan: 'FREE', maxEvents: 5, maxMembers: 10 });
  });

  it('quem já é membro e se inscreve continua MEMBRO (não é rebaixado)', async () => {
    const outcome = await registerForActivity({
      tenantId,
      eventSlug: 'evento-aberto',
      activitySlug: 'atividade-aberta',
      userId: memberId,
      consentData: true,
    });

    expect(outcome.ok).toBe(true);

    const profile = await adminPrisma.userTenantProfile.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId, userId: memberId } },
      select: { kind: true },
    });

    expect(profile.kind).toBe('MEMBER');
  });
});

describe('I4 — membros e participantes não se misturam', () => {
  it('a lista de membros da plataforma traz equipe, não inscritos', async () => {
    const emails = (await listTenantMembers(tenantId)).map((member) => member.email);

    expect(emails).toContain(EMAILS.operador);
    expect(emails).toContain(EMAILS.membro);
    expect(emails).toContain(EMAILS.bloqueado);
    // Quem se inscreveu em evento aberto NÃO responde pela instituição.
    expect(emails).not.toContain(EMAILS.soParticipante);
    expect(emails).not.toContain(EMAILS.promovido);
  });

  it('o detalhe da instituição separa os contadores', async () => {
    const detail = await getTenantDetail(tenantId);

    expect(detail).not.toBeNull();
    expect(detail!.tenant.memberCount).toBe(3);
    expect(detail!.tenant.participantCount).toBe(2);
  });

  it('a leitura da instituição (sob RLS) mostra equipe, público e uso da quota', async () => {
    const team = await getTeamOverview(tenantId);

    expect(team.members).toHaveLength(3);
    expect(team.members.map((member) => member.email)).toContain(EMAILS.membro);
    expect(team.memberCount).toBe(team.activeMembers + team.invitedMembers);
    expect(team.participantCount).toBe(2);
    expect(team.maxMembers).toBe(10);
    expect(team.quota.state).toBe('OK');
    // Os papéis vêm na mesma leitura, sem N+1.
    expect(team.members.find((member) => member.email === EMAILS.membro)?.roles[0]?.role).toBe('ADMIN');
  });

  it('promover um participante a membro o faz contar na quota', async () => {
    const membersBefore = await countTenantMembers(tenantId);

    const promoted = await addTenantMember(operatorId, {
      tenantId,
      email: EMAILS.soParticipante,
      role: 'ORGANIZER',
    });

    expect(promoted.ok).toBe(true);

    const profile = await adminPrisma.userTenantProfile.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId, userId: participantOnlyId } },
      select: { kind: true },
    });

    expect(profile.kind).toBe('MEMBER');
    expect(await countTenantMembers(tenantId)).toBe(membersBefore + 1);
    // Continua no público? Não: o vínculo é UM só, e agora é de equipe.
    expect(await countTenantParticipants(tenantId)).toBe(1);
    expect((await listTenantMembers(tenantId)).map((member) => member.email)).toContain(
      EMAILS.soParticipante,
    );
  });
});
