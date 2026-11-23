import type { TxClient } from '@/lib/db/tenant-client';
import { isUniqueViolation } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import {
  PUBLIC_REGISTRATION_ROLE,
  evaluateParticipantLink,
  shouldGrantParticipantRole,
  type MembershipStatusName,
  type ParticipantLinkDecision,
} from '@/domain/events/public-registration-rules';
import {
  kindAfterPublicRegistration,
  type MembershipKind as MembershipKindName,
} from '@/domain/tenancy/membership-rules';

/**
 * Dá vínculo de participante a quem chegou por um caminho PÚBLICO (FASE 33 / FASE 119).
 *
 * Roda na transação do CHAMADOR para que o vínculo nasça junto com a inscrição ou proposta.
 */
export async function linkParticipantIfEligible(
  tx: TxClient,
  input: {
    tenantId: string;
    userId: string;
    eventIsPublic: boolean;
    requiresMembership: boolean;
    tenantName: string;
  },
): Promise<{ linked: boolean; blocked: boolean; message: string | null }> {
  const decision = await decideParticipantLink(tx, input);

  if (decision.action === 'BLOCKED') {
    return { linked: false, blocked: true, message: decision.message ?? null };
  }

  const linked = await applyParticipantLink(tx, {
    tenantId: input.tenantId,
    userId: input.userId,
    decision,
  });

  return { linked, blocked: false, message: null };
}

export async function decideParticipantLink(
  tx: TxClient,
  input: {
    tenantId: string;
    userId: string;
    eventIsPublic: boolean;
    requiresMembership: boolean;
    tenantName: string;
  },
): Promise<ParticipantLinkDecision> {
  const membership = await tx.userTenantProfile.findFirst({
    where: { tenantId: input.tenantId, userId: input.userId },
    select: { status: true, deletedAt: true },
  });

  return evaluateParticipantLink({
    membershipStatus: (membership?.status ?? null) as MembershipStatusName | null,
    deleted: Boolean(membership?.deletedAt),
    eventIsPublic: input.eventIsPublic,
    requiresMembership: input.requiresMembership,
    tenantName: input.tenantName,
  });
}

export async function applyParticipantLink(
  tx: TxClient,
  input: { tenantId: string; userId: string; decision: ParticipantLinkDecision },
): Promise<boolean> {
  if (input.decision.action === 'ALREADY_MEMBER' || input.decision.action === 'BLOCKED') {
    return false;
  }

  const now = new Date();
  const activated = input.decision.action === 'ACTIVATE';

  const existing = await tx.userTenantProfile.findUnique({
    where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
    select: { kind: true },
  });

  const kind = kindAfterPublicRegistration(
    (existing?.kind as MembershipKindName | undefined) ?? null,
  );

  await tx.userTenantProfile.upsert({
    where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
    create: {
      tenantId: input.tenantId,
      userId: input.userId,
      status: 'ACTIVE',
      kind,
      joinedAt: now,
      invitedAt: null,
      invitedById: null,
    },
    update: { status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });

  const roles = await tx.roleAssignment.findMany({
    where: { tenantId: input.tenantId, userId: input.userId, revokedAt: null },
    select: { role: true },
  });

  if (shouldGrantParticipantRole(roles.map((role) => role.role))) {
    try {
      await tx.roleAssignment.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          role: PUBLIC_REGISTRATION_ROLE,
          scope: 'TENANT',
          reason: 'Inscrição em atividade de evento público',
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'PERMISSION_CHANGE',
          entityType: 'RoleAssignment',
          changes: { role: { from: null, to: PUBLIC_REGISTRATION_ROLE } },
        },
        tx,
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  await recordAudit(
    {
      tenantId: input.tenantId,
      userId: input.userId,
      action: activated ? 'UPDATE' : 'CREATE',
      entityType: 'UserTenantProfile',
      changes: {
        status: { from: activated ? 'INVITED' : null, to: 'ACTIVE' },
        origem: { from: null, to: 'inscrição pública' },
      },
    },
    tx,
  );

  return true;
}
