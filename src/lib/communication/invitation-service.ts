/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CONVITE DE EQUIPE (D2) — a instituição traz a própria equipe
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE FLUXO RESOLVE (E O QUE A FASE 14 DEIXOU EXPLÍCITO)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 14 entregou vincular quem JÁ tem conta — e isso é ato de PLATAFORMA, no
 *  painel de governança. A tela de equipe dizia, em texto: convidar quem não tem
 *  conta "é o desenho da fase de Comunicação", porque exige provar a posse do
 *  endereço. É este arquivo.
 *
 *  O convite é uma PROMESSA, não um vínculo: nasce como `PENDING`, não ocupa vaga na
 *  quota de membros e não cria conta nenhuma. O vínculo (`MEMBER` + papel) nasce no
 *  ACEITE, quando a pessoa prova que controla o endereço — e é lá que a quota é
 *  aplicada, do mesmo jeito que em `addTenantMember`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CÓDIGO DO CONVITE É GUARDADO COMO HASH
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Mesma decisão do convite de palestrante (ADR-114): o banco guarda o SHA-256 e o
 *  código em claro só existe no e-mail. Vazamento do banco não vira convite
 *  utilizável. Consequência assumida: o link NÃO pode ser reexibido depois — mostrar
 *  o convite de novo significa GERAR OUTRO (que invalida o anterior) e reenviar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash, randomBytes } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { logger } from '@/lib/observability/logger';
import { evaluateMemberQuota } from '@/domain/platform/platform-rules';
import { normalizeEmailAddress, isPlausibleEmailAddress, invitationRoleLabel } from '@/domain/communication/email-rules';
import {
  INVITATION_TTL_DAYS,
  evaluateAcceptance,
  invitationExpiry,
  invitationState,
  invitationStateLabel,
  isInvitableRole,
  type InvitationState,
} from '@/domain/communication/invitation-rules';
import { queueEmail } from './email-service';
import { appBaseUrl } from './links';

export type InvitationErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_ROLE'
  | 'NOT_FOUND'
  | 'ALREADY_MEMBER'
  | 'QUOTA_EXCEEDED'
  | 'REFUSED'
  | 'INTERNAL';

export type InvitationResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: InvitationErrorCode; message: string; details?: readonly string[] };

function failure(
  scope: string,
  error: unknown,
  message = 'Não foi possível concluir a operação com o convite.',
): { ok: false; code: InvitationErrorCode; message: string } {
  logger.error(`convite: falha em ${scope}`, {
    error: error instanceof Error ? error.message : String(error),
  });

  return { ok: false, code: 'INTERNAL', message };
}

/** `sha256` em hexadecimal — é o formato da coluna `tokenHash` (`Char(64)`). */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Código novo, aleatório, seguro para URL (não usa base64 com `+/`). */
function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

function inviteLink(tenantSlug: string, token: string): string {
  return `${appBaseUrl()}/t/${tenantSlug}/convite?codigo=${encodeURIComponent(token)}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criar / reenviar / cancelar
// ───────────────────────────────────────────────────────────────────────────────
export interface CreatedInvitation {
  invitationId: string;
  email: string;
  role: string;
  expiresAt: Date;
  /**
   * O link só existe NESTE retorno (o banco guarda o hash). A tela mostra uma vez e
   * avisa: depois disso, só gerando outro convite.
   */
  inviteUrl: string;
  emailQueued: boolean;
}

/**
 * Convida alguém para a equipe.
 *
 * Reenviar para quem já tem convite pendente NÃO cria um segundo: o anterior é
 * revogado na mesma transação — é o que mantém o índice único parcial
 * (`tenant_invitations_live_email_key`) satisfeito e o fluxo com um único convite
 * vivo por endereço.
 */
export async function inviteMember(input: {
  tenantId: string;
  actorId: string;
  email: string;
  role: string;
  message?: string | null;
}): Promise<InvitationResult<CreatedInvitation>> {
  const email = normalizeEmailAddress(input.email ?? '');

  if (!isPlausibleEmailAddress(email)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Informe um endereço de e-mail válido.' };
  }

  if (!isInvitableRole(input.role)) {
    return {
      ok: false,
      code: 'INVALID_ROLE',
      message: 'Papel inválido para convite de equipe.',
      details: [
        'A propriedade da instituição não é transferida por convite, e papéis de plataforma e de participante não pertencem à equipe.',
      ],
    };
  }

  const now = new Date();
  const token = generateInvitationToken();
  const tokenHash = hashInvitationToken(token);

  try {
    const prepared = await withTenant(input.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { id: true, name: true, slug: true },
      });

      if (!tenant) return null;

      // Já é da equipe? Então não há o que convidar.
      const activeMember = await tx.userTenantProfile.findFirst({
        where: {
          tenantId: input.tenantId,
          kind: 'MEMBER',
          status: 'ACTIVE',
          deletedAt: null,
          user: { email },
        },
        select: { id: true },
      });

      if (activeMember) {
        return { conflict: 'ALREADY_MEMBER' as const, tenant };
      }

      /**
       * Revoga o convite vivo do mesmo endereço: a partir daqui existe UM convite
       * pendente por e-mail e instituição (o índice parcial garante isso no banco).
       */
      await tx.tenantInvitation.updateMany({
        where: { tenantId: input.tenantId, email, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: now },
      });

      const invitation = await tx.tenantInvitation.create({
        data: {
          tenantId: input.tenantId,
          email,
          role: input.role as 'ADMIN',
          status: 'PENDING',
          tokenHash,
          expiresAt: invitationExpiry(now, INVITATION_TTL_DAYS),
          message: input.message?.trim() ? input.message.trim().slice(0, 400) : null,
          invitedById: input.actorId,
          sendCount: 0,
        },
        select: { id: true, expiresAt: true },
      });

      // Nome de quem convida: aparece no e-mail e na página de aceite.
      const inviter = await tx.user.findFirst({
        where: { id: input.actorId },
        select: { name: true },
      });

      return { conflict: null, tenant, invitation, inviterName: inviter?.name ?? null };
    });

    if (!prepared) {
      return { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' };
    }

    if (prepared.conflict === 'ALREADY_MEMBER') {
      return {
        ok: false,
        code: 'ALREADY_MEMBER',
        message: `${email} já é membro ativo desta instituição.`,
        details: ['Para mudar o papel de quem já é da equipe, use a concessão de papel.'],
      };
    }

    const invitationId = prepared.invitation.id;
    const inviteUrl = inviteLink(prepared.tenant.slug, token);

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.actorId,
      action: 'CREATE',
      entityType: 'TenantInvitation',
      entityId: invitationId,
      changes: {
        email: { from: null, to: email },
        role: { from: null, to: input.role },
        expiresAt: { from: null, to: prepared.invitation.expiresAt.toISOString() },
      },
    });

    const queued = await queueEmail({
      tenantId: input.tenantId,
      to: email,
      template: 'MEMBER_INVITATION',
      brandName: prepared.tenant.name,
      createdById: input.actorId,
      /**
       * A chave é o id do CONVITE: reconvidar depois de revogar precisa mandar
       * mensagem nova, e reenviar o MESMO convite usa `resendInvitation` (que tem
       * contador próprio e chave com data).
       */
      dedupeKey: `member-invitation:${invitationId}`,
      payload: {
        recipientName: null,
        tenantName: prepared.tenant.name,
        roleLabel: invitationRoleLabel(input.role),
        inviterName: prepared.inviterName,
        message: input.message?.trim() ? input.message.trim().slice(0, 400) : null,
        inviteUrl,
        expiresInDays: INVITATION_TTL_DAYS,
        isReminder: false,
      },
    });

    await markSent(input.tenantId, invitationId);

    return {
      ok: true,
      invitationId,
      email,
      role: input.role,
      expiresAt: prepared.invitation.expiresAt,
      inviteUrl,
      emailQueued: queued.ok,
    };
  } catch (error) {
    /**
     * Corrida com outro convite para o mesmo endereço: o índice parcial barrou. Não é
     * erro para quem clicou — o convite vivo é o que vale, e a tela recarrega a lista.
     */
    if (isUniqueViolation(error) && violatedIndexName(error) === 'tenant_invitations_live_email_key') {
      return {
        ok: false,
        code: 'REFUSED',
        message: 'Já existe um convite pendente para este endereço. Reenvie ou cancele o atual.',
      };
    }

    return failure('inviteMember', error);
  }
}

/**
 * Gera um convite NOVO para o mesmo endereço e papel, invalidando o anterior.
 * É o caminho para "reenviar" — o código antigo deixa de funcionar, e o novo é
 * mostrado uma vez na tela.
 */
export async function reissueInvitation(input: {
  tenantId: string;
  actorId: string;
  invitationId: string;
}): Promise<InvitationResult<CreatedInvitation>> {
  try {
    const current = await withTenant(input.tenantId, (tx) =>
      tx.tenantInvitation.findFirst({
        where: { id: input.invitationId },
        select: { email: true, role: true, message: true, status: true },
      }),
    );

    if (!current) {
      return { ok: false, code: 'NOT_FOUND', message: 'Convite não encontrado.' };
    }

    if (current.status === 'ACCEPTED') {
      return {
        ok: false,
        code: 'REFUSED',
        message: 'Este convite já foi aceito — não há o que reenviar.',
      };
    }

    return inviteMember({
      tenantId: input.tenantId,
      actorId: input.actorId,
      email: current.email,
      role: current.role,
      message: current.message,
    });
  } catch (error) {
    return failure('reissueInvitation', error);
  }
}

/** Cancela um convite pendente. */
export async function revokeInvitation(input: {
  tenantId: string;
  actorId: string;
  invitationId: string;
}): Promise<InvitationResult<{ email: string }>> {
  try {
    const revoked = await withTenant(input.tenantId, async (tx) => {
      const invitation = await tx.tenantInvitation.findFirst({
        where: { id: input.invitationId },
        select: { id: true, email: true, status: true, acceptedAt: true },
      });

      if (!invitation) return null;

      if (invitation.acceptedAt || invitation.status === 'ACCEPTED') {
        return { accepted: true as const, email: invitation.email };
      }

      await tx.tenantInvitation.update({
        where: { id: invitation.id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });

      return { accepted: false as const, email: invitation.email };
    });

    if (!revoked) {
      return { ok: false, code: 'NOT_FOUND', message: 'Convite não encontrado.' };
    }

    if (revoked.accepted) {
      return {
        ok: false,
        code: 'REFUSED',
        message: 'Este convite já foi aceito: o vínculo existe e precisa ser removido na equipe.',
      };
    }

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.actorId,
      action: 'DELETE',
      entityType: 'TenantInvitation',
      entityId: input.invitationId,
      changes: { status: { from: 'PENDING', to: 'REVOKED' } },
    });

    return { ok: true, email: revoked.email };
  } catch (error) {
    return failure('revokeInvitation', error);
  }
}

async function markSent(tenantId: string, invitationId: string): Promise<void> {
  // Falha aqui não invalida o convite: o contador é informativo.
  await withTenant(tenantId, (tx) =>
    tx.tenantInvitation.update({
      where: { id: invitationId },
      data: { sendCount: { increment: 1 }, lastSentAt: new Date() },
    }),
  ).catch(() => undefined);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura
// ───────────────────────────────────────────────────────────────────────────────
export interface InvitationView {
  id: string;
  email: string;
  role: string;
  roleLabel: string;
  state: InvitationState;
  stateLabel: string;
  message: string | null;
  invitedByName: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  sendCount: number;
}

/** Lista os convites da instituição (a tela de equipe mostra os vivos primeiro). */
export async function listInvitations(input: {
  tenantId: string;
  limit?: number;
}): Promise<InvitationView[]> {
  const now = new Date();

  const rows = await withTenant(input.tenantId, (tx) =>
    tx.tenantInvitation.findMany({
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(Math.max(input.limit ?? 50, 1), 200),
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        message: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        sendCount: true,
        createdAt: true,
        invitedBy: { select: { name: true } },
      },
    }),
  );

  return rows.map((row) => {
    const state = invitationState(row, now);

    return {
      id: row.id,
      email: row.email,
      role: row.role,
      roleLabel: invitationRoleLabel(row.role),
      state,
      stateLabel: invitationStateLabel(state),
      message: row.message,
      invitedByName: row.invitedBy?.name ?? null,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
      createdAt: row.createdAt,
      sendCount: row.sendCount,
    };
  });
}

export interface InvitationForAccept {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  email: string;
  role: string;
  roleLabel: string;
  state: InvitationState;
  stateLabel: string;
  message: string | null;
  invitedByName: string | null;
  expiresAt: Date;
}

/**
 * Resolve o convite pelo código, para a página pública de aceite.
 *
 * A busca é por HASH — e é por isso que "não encontrado" é a resposta para código
 * inválido (não existe "código errado" no banco: existe hash que não casa).
 */
export async function findInvitationByToken(input: {
  tenantId: string;
  token: string;
}): Promise<InvitationForAccept | null> {
  const tokenHash = hashInvitationToken(input.token);

  const row = await withTenant(input.tenantId, (tx) =>
    tx.tenantInvitation.findFirst({
      where: { tokenHash },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        status: true,
        message: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        invitedBy: { select: { name: true } },
        tenant: { select: { name: true, slug: true } },
      },
    }),
  );

  if (!row) return null;

  const state = invitationState(row, new Date());

  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenant.name,
    tenantSlug: row.tenant.slug,
    email: row.email,
    role: row.role,
    roleLabel: invitationRoleLabel(row.role),
    state,
    stateLabel: invitationStateLabel(state),
    message: row.message,
    invitedByName: row.invitedBy?.name ?? null,
    expiresAt: row.expiresAt,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Aceite
// ───────────────────────────────────────────────────────────────────────────────
export interface AcceptedInvitation {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: string;
  memberName: string;
}

/**
 * Aceita o convite: cria o vínculo de equipe e concede o papel.
 *
 * O endereço da CONTA precisa ser o endereço CONVIDADO — é o que prova a posse. A
 * quota de membros é aplicada AQUI (não no convite), porque é aqui que nasce um
 * membro para o plano.
 */
export async function acceptInvitation(input: {
  tenantId: string;
  token: string;
  userId: string;
}): Promise<InvitationResult<AcceptedInvitation>> {
  try {
    const tokenHash = hashInvitationToken(input.token);
    const now = new Date();

    const outcome = await withTenant(input.tenantId, async (tx) => {
      const invitation = await tx.tenantInvitation.findFirst({
        where: { tokenHash },
        select: {
          id: true,
          tenantId: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          invitedById: true,
          tenant: { select: { name: true, slug: true, maxMembers: true } },
        },
      });

      if (!invitation) return { kind: 'NOT_FOUND' as const };

      const user = await tx.user.findFirst({
        where: { id: input.userId },
        select: { id: true, name: true, email: true },
      });

      if (!user) return { kind: 'NO_USER' as const };

      const membership = await tx.userTenantProfile.findFirst({
        where: { tenantId: input.tenantId, userId: user.id, deletedAt: null },
        select: { id: true, kind: true, status: true },
      });

      const alreadyMember = Boolean(
        membership && membership.kind === 'MEMBER' && membership.status === 'ACTIVE',
      );

      const verdict = evaluateAcceptance({
        invitation,
        now,
        userEmail: user.email,
        alreadyMember,
      });

      if (!verdict.ok) {
        return {
          kind: 'REFUSED' as const,
          code: verdict.code,
          message: verdict.message,
          tenant: invitation.tenant,
        };
      }

      /**
       * Quota: contada ANTES de criar o vínculo, com o MESMO critério do painel de
       * governança (MEMBER ativo ou convidado). Sem isso, um convite aceito furaria
       * o limite do plano pela porta de trás.
       */
      const members = await tx.userTenantProfile.count({
        where: {
          tenantId: input.tenantId,
          kind: 'MEMBER',
          status: { in: ['ACTIVE', 'INVITED'] },
          deletedAt: null,
        },
      });

      const decision = evaluateMemberQuota({ currentCount: members, maxMembers: invitation.tenant.maxMembers });

      if (!decision.allowed) {
        return {
          kind: 'QUOTA' as const,
          message: decision.message ?? 'A quota de membros desta instituição está esgotada.',
          tenant: invitation.tenant,
        };
      }

      await tx.userTenantProfile.upsert({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: user.id } },
        create: {
          tenantId: input.tenantId,
          userId: user.id,
          status: 'ACTIVE',
          kind: 'MEMBER',
          joinedAt: now,
          // O convite registra quem convidou: o vínculo herda essa origem.
          invitedById: invitation.invitedById,
          invitedAt: now,
        },
        // Promoção explícita: quem era PARTICIPANTE de evento entra na equipe.
        update: { status: 'ACTIVE', kind: 'MEMBER', deletedAt: null, joinedAt: now },
      });

      const live = await tx.roleAssignment.findFirst({
        where: {
          tenantId: input.tenantId,
          userId: user.id,
          role: invitation.role,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      });

      if (!live) {
        await tx.roleAssignment.create({
          data: {
            tenantId: input.tenantId,
            userId: user.id,
            role: invitation.role,
            scope: 'TENANT',
            /**
             * Quem concedeu foi o CONVITE, não uma pessoa agindo agora: o aceite é
             * ato do convidado. O autor da concessão é quem convidou — é o que
             * responde "de onde veio este acesso?" na trilha.
             */
            grantedById: invitation.invitedById,
            reason: 'Convite de equipe aceito',
          },
        });
      }

      await tx.tenantInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: now, acceptedById: user.id },
      });

      return {
        kind: 'ACCEPTED' as const,
        tenantSlug: invitation.tenant.slug,
        tenantName: invitation.tenant.name,
        role: invitation.role,
        memberName: user.name,
        invitationId: invitation.id,
      };
    });

    if (outcome.kind === 'NOT_FOUND') {
      return { ok: false, code: 'NOT_FOUND', message: 'Convite não encontrado.' };
    }

    if (outcome.kind === 'NO_USER') {
      return { ok: false, code: 'NOT_FOUND', message: 'Conta não encontrada.', details: ['Entre novamente e repita o aceite.'] };
    }

    if (outcome.kind === 'REFUSED') {
      return {
        ok: false,
        code: outcome.code === 'ALREADY_MEMBER' ? 'ALREADY_MEMBER' : 'REFUSED',
        message: outcome.message,
      };
    }

    if (outcome.kind === 'QUOTA') {
      return {
        ok: false,
        code: 'QUOTA_EXCEEDED',
        message: outcome.message,
        details: ['A instituição precisa liberar vaga (remover alguém ou ajustar o plano) antes do aceite.'],
      };
    }

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'UPDATE',
      entityType: 'TenantInvitation',
      entityId: outcome.invitationId,
      changes: {
        status: { from: 'PENDING', to: 'ACCEPTED' },
        role: { from: null, to: outcome.role },
        acceptedBy: { from: null, to: input.userId },
      },
    });

    return {
      ok: true,
      tenantId: input.tenantId,
      tenantSlug: outcome.tenantSlug,
      tenantName: outcome.tenantName,
      role: outcome.role,
      memberName: outcome.memberName,
    };
  } catch (error) {
    return failure('acceptInvitation', error);
  }
}

/** Link absoluto de um convite a partir do slug (usado pela tela de equipe). */
export function invitationUrlFor(tenantSlug: string, token: string): string {
  return inviteLink(tenantSlug, token);
}
