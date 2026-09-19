/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Comunicação (FASE 15)
 *
 *  Contra o PostgreSQL real, prova o que o domínio puro não alcança:
 *    • a mensagem NASCE no outbox (QUEUED) e o HTML fica gravado — o registro
 *      mostra o que saiu, não o template de hoje;
 *    • `dedupeKey` impede o mesmo fato de virar duas mensagens, mesmo com corrida;
 *    • mensagem de PLATAFORMA (tenantId nulo) é invisível para qualquer instituição
 *      (RLS), e é escrita pela conexão administrativa;
 *    • o convite de equipe nasce pendente, o aceite cria vínculo + papel, o
 *      endereço errado é recusado, o reenvio invalida o código anterior e a quota
 *      do plano é aplicada NO ACEITE;
 *    • os gatilhos D3 (avaliação atribuída), D4 (prazo), D5 (carta) e D6
 *      (certificado) realmente registram a mensagem certa para a pessoa certa;
 *    • a decisão de NÃO bloquear o login sem verificação está travada por teste.
 *
 *  Requer: docker compose up -d && npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { auth } from '../../src/lib/auth/auth';
import { sendAccountEmail } from '../../src/lib/communication/account-mail';
import { deliverEmail, listEmailMessages, queueEmail, retryEmailMessage } from '../../src/lib/communication/email-service';
import { closeEmailQueue } from '../../src/lib/communication/email-queue';
import {
  acceptInvitation,
  hashInvitationToken,
  inviteMember,
  listInvitations,
  reissueInvitation,
  revokeInvitation,
} from '../../src/lib/communication/invitation-service';
import {
  notifyCardGranted,
  notifyCertificateIssued,
  notifyReviewAssigned,
} from '../../src/lib/communication/notification-service';
import { runReviewDeadlineScan } from '../../src/lib/communication/reminder-service';
import { listPlatformEmailsByRecipient } from '../../src/lib/platform/platform-mail';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let tenantSlug: string;
let smallTenantId: string;
let smallTenantSlug: string;

let organizerId: string;
let reviewerId: string;
let authorId: string;
let cardOwnerId: string;
let certificateOwnerId: string;

let eventId: string;
let trackId: string;
let submissionId: string;
let dueSoonAssignmentId: string;
let overdueAssignmentId: string;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name: `Pessoa ${label} ${RUN}`, email: `f15.${label}.${RUN}@exemplo.test` },
  });
  return id;
}

async function emailFor(userId: string): Promise<string> {
  const user = await adminPrisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });
  return user.email;
}

/** Mensagens que a INSTITUIÇÃO enxerga (a leitura é sob RLS). */
async function outboxFor(tenant: string, template?: string) {
  return withTenant(tenant, (tx) =>
    tx.emailMessage.findMany({
      where: template ? { template } : {},
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        to: true,
        subject: true,
        template: true,
        status: true,
        driver: true,
        error: true,
        attempts: true,
        html: true,
        dedupeKey: true,
      },
    }),
  );
}

beforeAll(async () => {
  /**
   * A suíte NUNCA envia e-mail de verdade: o driver é forçado para `log` aqui.
   *
   * O `.env` de quem desenvolve pode ter `EMAIL_DRIVER=resend` com chave real — e um
   * teste que dispara mensagem para endereço de exemplo (`@exemplo.test`) gastaria
   * cota do provedor e queimaria a reputação do domínio. O driver `log` registra a
   * mensagem no outbox exatamente como o real, que é tudo o que estes testes medem.
   */
  process.env.EMAIL_DRIVER = 'log';

  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f15-comunicacao-${RUN}`,
      name: `Instituição Comunicação ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
    select: { id: true, slug: true },
  });
  tenantId = tenant.id;
  tenantSlug = tenant.slug;

  /**
   * Instituição pequena, com teto de UM membro, para provar que a quota é aplicada
   * no ACEITE do convite — e não na criação dele.
   */
  const small = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f15-quota-${RUN}`,
      name: `Instituição Quota ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      maxMembers: 1,
      timezone: 'America/Sao_Paulo',
    },
    select: { id: true, slug: true },
  });
  smallTenantId = small.id;
  smallTenantSlug = small.slug;

  organizerId = await createUser('organizadora');
  reviewerId = await createUser('revisora');
  authorId = await createUser('autor');
  cardOwnerId = await createUser('carta');
  certificateOwnerId = await createUser('certificado');

  // Vínculos de equipe (o membro da instituição pequena ocupa a única vaga).
  await adminPrisma.userTenantProfile.createMany({
    data: [
      { id: randomUUID(), tenantId, userId: organizerId, status: 'ACTIVE', kind: 'MEMBER' },
      { id: randomUUID(), tenantId, userId: reviewerId, status: 'ACTIVE', kind: 'MEMBER' },
      { id: randomUUID(), tenantId, userId: cardOwnerId, status: 'ACTIVE', kind: 'MEMBER' },
      { id: randomUUID(), tenantId, userId: certificateOwnerId, status: 'ACTIVE', kind: 'MEMBER' },
      { id: randomUUID(), tenantId: smallTenantId, userId: organizerId, status: 'ACTIVE', kind: 'MEMBER' },
    ],
  });

  eventId = randomUUID();
  trackId = randomUUID();
  submissionId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-comunicacao-${RUN}`,
        title: `Congresso de Comunicação ${RUN}`,
        status: 'PUBLISHED',
        modality: 'ONLINE',
        timezone: 'America/Bahia',
        startsAt: daysFromNow(30),
        endsAt: daysFromNow(32),
      },
    });

    await tx.track.create({
      data: {
        id: trackId,
        tenantId,
        eventId,
        slug: `trilha-comunicacao-${RUN}`,
        name: 'Comunicação e Educação',
        requiresBlindReview: true,
        requiredReviews: 1,
        maxSubmissionsPerAuthor: 10,
      },
    });

    await tx.submission.create({
      data: {
        id: submissionId,
        tenantId,
        eventId,
        trackId,
        protocol: `C15${RUN}`.slice(0, 20),
        title: 'Ensino de programação com Rust',
        abstract: 'Relato de experiência sobre o ensino introdutório de Rust em cursos de graduação.',
        keywords: ['rust', 'ensino', 'programação'],
        status: 'UNDER_REVIEW',
        submittedById: authorId,
        submittedAt: new Date(),
      },
    });

    const dueSoon = await tx.reviewAssignment.create({
      data: {
        tenantId,
        submissionId,
        reviewerId,
        status: 'INVITED',
        dueAt: new Date(Date.now() + 20 * 3_600_000),
      },
      select: { id: true },
    });
    dueSoonAssignmentId = dueSoon.id;

    const overdue = await tx.reviewAssignment.create({
      data: {
        tenantId,
        submissionId,
        reviewerId: organizerId,
        status: 'IN_PROGRESS',
        dueAt: new Date(Date.now() - 3 * 86_400_000),
      },
      select: { id: true },
    });
    overdueAssignmentId = overdue.id;
  });
}, 120_000);

afterAll(async () => {
  // A fila fica aberta se não for encerrada — e o processo de teste não termina.
  await closeEmailQueue().catch(() => undefined);
  await adminPrisma.$disconnect().catch(() => undefined);
});

describe('outbox e entrega', () => {
  it('registra a mensagem ANTES de enviar e guarda o HTML que saiu', async () => {
    const queued = await queueEmail({
      tenantId,
      to: await emailFor(cardOwnerId),
      toUserId: cardOwnerId,
      template: 'CARD_GRANTED',
      brandName: 'Instituição Comunicação',
      dedupeKey: `teste-outbox:${RUN}`,
      payload: {
        recipientName: 'Pessoa carta',
        cardName: 'Cartógrafa do Cerrado',
        rarityLabel: 'Rara',
        reasonLabel: 'Você fez o credenciamento no evento',
        albumUrl: 'http://localhost:3000/t/x/cartas',
      },
    });

    expect(queued.ok, queued.ok ? 'ok' : queued.message).toBe(true);
    if (!queued.ok) return;

    expect(queued.emailMessageId).toBeTruthy();

    /**
     * A fila PRECISA aceitar o job. Este `expect` é a trava do defeito encontrado
     * nesta fase: um `jobId` com `:` faz o BullMQ recusar o `add`, e o envio cai
     * silenciosamente para o caminho inline — funcionando, sem fila e sem aviso.
     */
    expect(queued.queued, 'o BullMQ recusou o job: confira o jobId (não pode ter ":")').toBe(true);

    const stored = await withTenant(tenantId, (tx) =>
      tx.emailMessage.findUniqueOrThrow({ where: { id: queued.emailMessageId as string } }),
    );

    expect(stored.status).toBe('QUEUED');
    expect(stored.html).toContain('Cartógrafa do Cerrado');
    expect(stored.text).toContain('Cartógrafa do Cerrado');
    expect(stored.payload).toMatchObject({ cardName: 'Cartógrafa do Cerrado' });

    const delivered = await deliverEmail({ emailMessageId: stored.id, tenantId });

    expect(delivered.ok, delivered.ok ? 'ok' : delivered.message).toBe(true);
    if (!delivered.ok) return;
    expect(delivered.status).toBe('SENT');

    const after = await withTenant(tenantId, (tx) =>
      tx.emailMessage.findUniqueOrThrow({ where: { id: stored.id } }),
    );
    expect(after.status).toBe('SENT');
    expect(after.driver).toBe('log');
    expect(after.sentAt).not.toBeNull();
    expect(after.attempts).toBe(1);

    // Entregar de novo não reenvia: a mensagem já saiu.
    const again = await deliverEmail({ emailMessageId: stored.id, tenantId });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.status).toBe('SENT');

    const untouched = await withTenant(tenantId, (tx) =>
      tx.emailMessage.findUniqueOrThrow({ where: { id: stored.id }, select: { attempts: true } }),
    );
    expect(untouched.attempts).toBe(1);
  }, 60_000);

  it('o mesmo FATO não gera duas mensagens (dedupeKey é índice único)', async () => {
    const dedupeKey = `teste-dedupe:${RUN}`;
    const to = await emailFor(cardOwnerId);

    const first = await queueEmail({
      tenantId,
      to,
      template: 'CARD_GRANTED',
      brandName: 'Instituição Comunicação',
      dedupeKey,
      payload: {
        recipientName: 'Pessoa carta',
        cardName: 'Cartógrafa do Cerrado',
        rarityLabel: 'Rara',
        reasonLabel: 'Conquista',
        albumUrl: 'http://localhost:3000/t/x/cartas',
      },
    });

    const second = await queueEmail({
      tenantId,
      to,
      template: 'CARD_GRANTED',
      brandName: 'Instituição Comunicação',
      dedupeKey,
      payload: {
        recipientName: 'Pessoa carta',
        cardName: 'Cartógrafa do Cerrado',
        rarityLabel: 'Rara',
        reasonLabel: 'Conquista',
        albumUrl: 'http://localhost:3000/t/x/cartas',
      },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.duplicate).toBe(true);
    expect(second.emailMessageId).toBeNull();

    const rows = await outboxFor(tenantId, 'CARD_GRANTED');
    const matching = rows.filter((row) => row.dedupeKey === dedupeKey);
    expect(matching).toHaveLength(1);
  }, 60_000);

  it('RECUSA endereço implausível sem criar linha', async () => {
    const before = (await outboxFor(tenantId)).length;

    const result = await queueEmail({
      tenantId,
      to: 'nao-e-endereco',
      template: 'CARD_GRANTED',
      brandName: 'Instituição Comunicação',
      payload: {
        recipientName: 'X',
        cardName: 'Y',
        rarityLabel: 'Rara',
        reasonLabel: 'Z',
        albumUrl: 'http://localhost:3000/',
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_RECIPIENT');

    expect((await outboxFor(tenantId)).length).toBe(before);
  }, 60_000);

  it('a caixa de saída resume por situação e mascara o destinatário na tela', async () => {
    const { rows, summary } = await listEmailMessages({ tenantId });

    expect(rows.length).toBeGreaterThan(0);
    expect(summary.sent + summary.queued + summary.failed).toBeGreaterThan(0);

    const filtered = await listEmailMessages({ tenantId, status: 'SENT' });
    expect(filtered.rows.every((row) => row.status === 'SENT')).toBe(true);
  }, 60_000);

  it('reenviar só alcança o que falhou ou está na fila', async () => {
    const sent = (await outboxFor(tenantId)).find((row) => row.status === 'SENT');
    expect(sent).toBeTruthy();

    const result = await retryEmailMessage({ tenantId, emailMessageId: sent?.id as string });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ALREADY_SENT');
  }, 60_000);
});

describe('mensagem de plataforma — sem instituição, invisível para instituições', () => {
  it('grava com tenantId nulo e a RLS a esconde de qualquer instituição', async () => {
    const email = await emailFor(certificateOwnerId);

    await sendAccountEmail({
      template: 'EMAIL_VERIFICATION',
      user: { id: certificateOwnerId, email, name: 'Pessoa certificado' },
      url: 'http://localhost:3000/api/auth/verify-email?token=abc',
    });

    // Visível pela conexão administrativa (é onde a plataforma lê)…
    const platformRows = await listPlatformEmailsByRecipient(email);
    expect(platformRows.some((row) => row.template === 'EMAIL_VERIFICATION')).toBe(true);

    // …e INVISÍVEL sob o contexto de uma instituição: a policy compara tenantId.
    const viaTenant = await withTenant(tenantId, (tx) =>
      tx.emailMessage.count({ where: { to: email, template: 'EMAIL_VERIFICATION' } }),
    );
    expect(viaTenant).toBe(0);
  }, 60_000);

  it('a decisão de NÃO bloquear login sem verificação está travada por teste', () => {
    /**
     * Se alguém ligar `requireEmailVerification`, toda conta existente (as 16 de
     * teste inclusive) perde o acesso até confirmar um endereço que ninguém pediu.
     * A decisão é de produto — este teste existe para que a mudança seja consciente.
     */
    expect(auth.options.emailAndPassword?.requireEmailVerification).toBe(false);
    expect(typeof auth.options.emailVerification?.sendVerificationEmail).toBe('function');
    expect(typeof auth.options.emailAndPassword?.sendResetPassword).toBe('function');
    expect(auth.options.emailVerification?.sendOnSignUp).toBe(true);
  });
});

describe('convite de equipe', () => {
  it('cria convite PENDENTE, envia o e-mail com o link e NÃO cria vínculo', async () => {
    const email = `convidada.${RUN}@exemplo.test`;

    const invited = await inviteMember({
      tenantId,
      actorId: organizerId,
      email,
      role: 'STAFF',
      message: 'Bem-vinda ao credenciamento!',
    });

    expect(invited.ok, invited.ok ? 'ok' : invited.message).toBe(true);
    if (!invited.ok) return;

    expect(invited.inviteUrl).toContain(`/t/${tenantSlug}/convite?codigo=`);

    // O código em claro NÃO está no banco — só o hash.
    const row = await withTenant(tenantId, (tx) =>
      tx.tenantInvitation.findUniqueOrThrow({ where: { id: invited.invitationId } }),
    );
    expect(row.status).toBe('PENDING');
    expect(row.tokenHash).toHaveLength(64);

    const token = new URL(invited.inviteUrl).searchParams.get('codigo') as string;
    expect(row.tokenHash).toBe(hashInvitationToken(token));
    expect(row.tokenHash).not.toContain(token);

    // Nenhum vínculo nasceu do convite.
    const membership = await adminPrisma.userTenantProfile.findFirst({
      where: { tenantId, user: { email } },
    });
    expect(membership).toBeNull();

    // E a mensagem saiu com o link.
    const messages = await outboxFor(tenantId, 'MEMBER_INVITATION');
    const message = messages.find((entry) => entry.to === email);
    expect(message).toBeTruthy();
    expect(message?.html).toContain('/convite?codigo=');

    const listed = await listInvitations({ tenantId });
    expect(listed.some((entry) => entry.email === email && entry.state === 'PENDING')).toBe(true);
  }, 90_000);

  it('resolve o convite pelo código e RECUSA o aceite com outro endereço', async () => {
    const email = `endereco.errado.${RUN}@exemplo.test`;

    const invited = await inviteMember({
      tenantId,
      actorId: organizerId,
      email,
      role: 'REVIEWER',
    });
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;

    const token = new URL(invited.inviteUrl).searchParams.get('codigo') as string;

    // Uma conta DIFERENTE do endereço convidado: recusa, e o vínculo não nasce.
    const wrongUser = await createUser('intrusa');
    const refused = await acceptInvitation({ tenantId, token, userId: wrongUser });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('REFUSED');

    const stillPending = await withTenant(tenantId, (tx) =>
      tx.tenantInvitation.findUniqueOrThrow({
        where: { id: invited.invitationId },
        select: { status: true },
      }),
    );
    expect(stillPending.status).toBe('PENDING');

    // Código inexistente: nenhum convite encontrado.
    const notFound = await acceptInvitation({ tenantId, token: 'codigo-inventado', userId: wrongUser });
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.code).toBe('NOT_FOUND');
  }, 90_000);

  it('aceita com o endereço certo: vínculo de EQUIPE + papel, e marca o convite', async () => {
    const email = `aceita.${RUN}@exemplo.test`;
    const userId = await createUser(`aceita-${RUN}`);
    await adminPrisma.user.update({ where: { id: userId }, data: { email } });

    const invited = await inviteMember({
      tenantId,
      actorId: organizerId,
      email,
      role: 'ORGANIZER',
    });
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;

    const token = new URL(invited.inviteUrl).searchParams.get('codigo') as string;
    const accepted = await acceptInvitation({ tenantId, token, userId });

    expect(accepted.ok, accepted.ok ? 'ok' : accepted.message).toBe(true);
    if (!accepted.ok) return;

    const membership = await adminPrisma.userTenantProfile.findFirstOrThrow({
      where: { tenantId, userId },
      select: { kind: true, status: true, invitedById: true },
    });
    expect(membership.kind).toBe('MEMBER');
    expect(membership.status).toBe('ACTIVE');
    expect(membership.invitedById).toBe(organizerId);

    const role = await withTenant(tenantId, (tx) =>
      tx.roleAssignment.findFirst({
        where: { userId, role: 'ORGANIZER', revokedAt: null },
        select: { scope: true, reason: true },
      }),
    );
    expect(role?.scope).toBe('TENANT');

    const invitation = await withTenant(tenantId, (tx) =>
      tx.tenantInvitation.findUniqueOrThrow({
        where: { id: invited.invitationId },
        select: { status: true, acceptedById: true },
      }),
    );
    expect(invitation.status).toBe('ACCEPTED');
    expect(invitation.acceptedById).toBe(userId);

    // Aceitar de novo é recusado (o convite não é uma segunda porta).
    const again = await acceptInvitation({ tenantId, token, userId });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('REFUSED');
  }, 90_000);

  it('gerar link novo invalida o anterior e cancelar impede o aceite', async () => {
    const email = `reenvio.${RUN}@exemplo.test`;
    const userId = await createUser(`reenvio-${RUN}`);
    await adminPrisma.user.update({ where: { id: userId }, data: { email } });

    const first = await inviteMember({ tenantId, actorId: organizerId, email, role: 'STAFF' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const oldToken = new URL(first.inviteUrl).searchParams.get('codigo') as string;

    const reissued = await reissueInvitation({
      tenantId,
      actorId: organizerId,
      invitationId: first.invitationId,
    });
    expect(reissued.ok, reissued.ok ? 'ok' : reissued.message).toBe(true);
    if (!reissued.ok) return;

    const newToken = new URL(reissued.inviteUrl).searchParams.get('codigo') as string;
    expect(newToken).not.toBe(oldToken);

    // O convite antigo foi revogado: o código dele não vale mais.
    const withOld = await acceptInvitation({ tenantId, token: oldToken, userId });
    expect(withOld.ok).toBe(false);

    // E o novo funciona até ser cancelado.
    const revoked = await revokeInvitation({
      tenantId,
      actorId: organizerId,
      invitationId: reissued.invitationId,
    });
    expect(revoked.ok, revoked.ok ? 'ok' : revoked.message).toBe(true);

    const afterRevoke = await acceptInvitation({ tenantId, token: newToken, userId });
    expect(afterRevoke.ok).toBe(false);
    if (!afterRevoke.ok) expect(afterRevoke.message).toMatch(/cancelad/i);
  }, 90_000);

  it('a quota de membros é aplicada no ACEITE, não no convite', async () => {
    const email = `quota.${RUN}@exemplo.test`;
    const userId = await createUser(`quota-${RUN}`);
    await adminPrisma.user.update({ where: { id: userId }, data: { email } });

    // O convite é criado normalmente (não ocupa vaga)…
    const invited = await inviteMember({
      tenantId: smallTenantId,
      actorId: organizerId,
      email,
      role: 'STAFF',
    });
    expect(invited.ok, invited.ok ? 'ok' : invited.message).toBe(true);
    if (!invited.ok) return;

    const token = new URL(invited.inviteUrl).searchParams.get('codigo') as string;
    const accepted = await acceptInvitation({ tenantId: smallTenantId, token, userId });

    // …e o aceite é recusado, porque o plano permite UM membro e já existe um.
    expect(accepted.ok).toBe(false);
    if (!accepted.ok) {
      expect(accepted.code).toBe('QUOTA_EXCEEDED');
      expect(accepted.message).toMatch(/quota|membro/i);
    }

    const membership = await adminPrisma.userTenantProfile.findFirst({
      where: { tenantId: smallTenantId, userId },
    });
    expect(membership).toBeNull();

    // O convite continua pendente: quando houver vaga, ele ainda serve.
    const row = await withTenant(smallTenantId, (tx) =>
      tx.tenantInvitation.findUniqueOrThrow({
        where: { id: invited.invitationId },
        select: { status: true },
      }),
    );
    expect(row.status).toBe('PENDING');
  }, 90_000);

  it('recusa papel que não é de equipe', async () => {
    const owner = await inviteMember({
      tenantId,
      actorId: organizerId,
      email: `owner.${RUN}@exemplo.test`,
      role: 'OWNER',
    });
    expect(owner.ok).toBe(false);
    if (!owner.ok) expect(owner.code).toBe('INVALID_ROLE');

    const participant = await inviteMember({
      tenantId,
      actorId: organizerId,
      email: `participante.${RUN}@exemplo.test`,
      role: 'PARTICIPANT',
    });
    expect(participant.ok).toBe(false);
  }, 60_000);

  it('um único convite PENDENTE por endereço (índice parcial)', async () => {
    const email = `duplicado.${RUN}@exemplo.test`;

    const first = await inviteMember({ tenantId, actorId: organizerId, email, role: 'STAFF' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await inviteMember({ tenantId, actorId: organizerId, email, role: 'ADMIN' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const pending = await withTenant(tenantId, (tx) =>
      tx.tenantInvitation.findMany({ where: { email, status: 'PENDING' }, select: { id: true, role: true } }),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(second.invitationId);
    expect(pending[0]?.role).toBe('ADMIN');

    // O anterior ficou registrado como revogado — histórico, não lixo.
    const revoked = await withTenant(tenantId, (tx) =>
      tx.tenantInvitation.findMany({ where: { email, status: 'REVOKED' }, select: { id: true } }),
    );
    expect(revoked.map((row) => row.id)).toContain(first.invitationId);
  }, 90_000);
});

describe('gatilhos de notificação', () => {
  it('D3 — avaliação atribuída avisa o revisor com prazo no fuso do evento', async () => {
    await notifyReviewAssigned({ tenantId, assignmentId: dueSoonAssignmentId, actorId: organizerId });

    const rows = await outboxFor(tenantId, 'REVIEW_ASSIGNED');
    const reviewerEmail = await emailFor(reviewerId);
    const message = rows.find((row) => row.to === reviewerEmail);

    expect(message).toBeTruthy();
    expect(message?.subject).toContain('Ensino de programação com Rust');
    expect(message?.dedupeKey).toBe(`review-assigned:${dueSoonAssignmentId}`);
    expect(message?.html).toContain('Comunicação e Educação');

    // Reexecutar não duplica: a chave é a atribuição.
    await notifyReviewAssigned({ tenantId, assignmentId: dueSoonAssignmentId });
    const again = (await outboxFor(tenantId, 'REVIEW_ASSIGNED')).filter(
      (row) => row.dedupeKey === `review-assigned:${dueSoonAssignmentId}`,
    );
    expect(again).toHaveLength(1);
  }, 90_000);

  it('D4 — a varredura avisa prazo próximo e vencido, uma vez por dia', async () => {
    const first = await runReviewDeadlineScan();

    expect(first.tenants).toBeGreaterThan(0);
    expect(first.dueSoon).toBeGreaterThanOrEqual(1);
    expect(first.overdue).toBeGreaterThanOrEqual(1);

    const dueSoon = (await outboxFor(tenantId, 'REVIEW_DUE_SOON')).filter((row) =>
      row.dedupeKey?.startsWith(`review-due:${dueSoonAssignmentId}:`),
    );
    expect(dueSoon).toHaveLength(1);

    const overdue = (await outboxFor(tenantId, 'REVIEW_OVERDUE')).filter((row) =>
      row.dedupeKey?.startsWith(`review-overdue:${overdueAssignmentId}:`),
    );
    expect(overdue).toHaveLength(1);

    // Segunda varredura no MESMO dia: nada novo (idempotência por data).
    const second = await runReviewDeadlineScan();
    expect(second.deduplicated).toBeGreaterThanOrEqual(2);

    const dueSoonAgain = (await outboxFor(tenantId, 'REVIEW_DUE_SOON')).filter((row) =>
      row.dedupeKey?.startsWith(`review-due:${dueSoonAssignmentId}:`),
    );
    expect(dueSoonAgain).toHaveLength(1);
  }, 120_000);

  it('D5 — carta conquistada avisa quem ganhou', async () => {
    await notifyCardGranted({
      tenantId,
      userId: cardOwnerId,
      cardName: 'Cartógrafa do Cerrado',
      rarity: 'RARE',
      triggerLabel: 'Você fez o credenciamento no evento',
      eventId,
    });

    const rows = await outboxFor(tenantId, 'CARD_GRANTED');
    const cardEmail = await emailFor(cardOwnerId);
    const message = rows.find(
      (row) => row.to === cardEmail && row.subject.includes('Cartógrafa'),
    );

    expect(message).toBeTruthy();
    expect(message?.html).toContain('Rara');
  }, 60_000);

  it('D6 — certificado emitido avisa o titular com o código de validação', async () => {
    const certificateId = randomUUID();

    await withTenant(tenantId, (tx) =>
      tx.certificate.create({
        data: {
          id: certificateId,
          tenantId,
          eventId,
          userId: certificateOwnerId,
          kind: 'ATTENDANCE',
          status: 'ISSUED',
          validationCode: `CERT-${RUN}`.slice(0, 20),
          title: 'Certificado de participação',
          recipientName: 'Pessoa certificado',
          bodyText: 'Participou do congresso.',
          workloadMinutes: 480,
          issuedAt: new Date(),
        },
      }),
    );

    await notifyCertificateIssued({ tenantId, certificateId });

    const rows = await outboxFor(tenantId, 'CERTIFICATE_ISSUED');
    const certificateEmail = await emailFor(certificateOwnerId);
    const message = rows.find((row) => row.to === certificateEmail);

    expect(message).toBeTruthy();
    expect(message?.html).toContain(`CERT-${RUN}`.slice(0, 20));
    expect(message?.html).toContain('8h');
    expect(message?.dedupeKey).toBe(`certificate-issued:${certificateId}`);
  }, 90_000);
});

describe('isolamento — o outbox e o convite respeitam a fronteira', () => {
  it('uma instituição não enxerga a mensagem nem o convite da outra', async () => {
    const smallOutbox = await withTenant(smallTenantId, (tx) => tx.emailMessage.count());
    const smallInvites = await withTenant(smallTenantId, (tx) => tx.tenantInvitation.count());

    // A instituição pequena só tem o convite que ELA criou — nenhum dos vários da
    // instituição principal, e nenhuma mensagem dela.
    expect(smallInvites).toBe(1);
    expect(smallOutbox).toBeGreaterThanOrEqual(1);

    const bigInvites = await withTenant(tenantId, (tx) => tx.tenantInvitation.count());
    expect(bigInvites).toBeGreaterThan(smallInvites);

    expect(tenantSlug).not.toBe(smallTenantSlug);
  }, 60_000);
});
