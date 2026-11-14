/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Área de conta (FASE 47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTAS LEITURAS USAM A CONEXÃO DE PLATAFORMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `user`, `account` e `session` são tabelas de IDENTIDADE: globais por decisão de
 *  arquitetura (ADR-002) e usadas antes de existir instituição ativa. Uma leitura
 *  "sob o contexto de uma instituição" devolveria zero linhas em vez de negar — o
 *  mesmo motivo que levou `src/lib/platform/**` a usar `adminPrisma` (invariante nº 1).
 *
 *  A autorização NÃO mora aqui: as Server Actions conferem a sessão, e cada escrita
 *  usa o `userId` da sessão — nunca um id vindo do formulário.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE MÓDULO NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não confere senha, não gera token e não valida código de segundo fator: isso é da
 *  biblioteca de autenticação, com o crypto dela. Aqui só se LÊ o estado que a tela
 *  precisa mostrar — inclusive o que a tela precisa mostrar para não mentir:
 *  "esta conta tem senha?" e "o segundo fator está ligado?".
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '@/lib/db/admin-client';
import { withTenant } from '@/lib/db/tenant-client';
import { maskIpAddress } from '@/domain/privacy/ip-privacy-rules';
import {
  describeSession,
  orderSessionsForDisplay,
  type AccountSession,
} from '@/domain/account/account-rules';
import {
  buildAnonymizedAccountPayload,
  evaluateAccountDeletionEligibility,
  type SoleOwnerTenantRef,
} from '@/domain/identity/account-deletion-rules';
import { erasePersonalFormResponses } from '@/domain/events/registration-form-spec-rules';
import { removeUserAvatar } from '@/lib/auth/user-avatar-service';
import { cancelRegistration } from '@/lib/events/registration-service';
import { invalidateTenantCache } from '@/lib/tenancy/tenant-resolver';

export interface AccountOverview {
  userId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  /** Foto publicada (a mesma que o perfil público e os cartões de equipe mostram). */
  image: string | null;
  /** Só `true` depois que um código válido confirmou o enrollment. */
  twoFactorEnabled: boolean;
  /**
   * A conta tem senha PRÓPRIA?
   *
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE ISTO NÃO É DETALHE
   * ─────────────────────────────────────────────────────────────────────────────
   *  As contas do seed e as criadas por convite nascem sem linha em `account` (não há
   *  senha). Para elas, "trocar a senha" não existe — a tela precisa oferecer CRIAR a
   *  senha, senão a pessoa recebe "senha atual incorreta" para sempre e não entende por
   *  quê. Também é o que decide se o segundo fator pode ser ligado: a biblioteca exige
   *  senha para isso, e sem ela a única saída seria a redefinição por e-mail.
   */
  hasPassword: boolean;
  /** Quantas sessões ativas a conta tem (a tela avisa antes de a pessoa sair de todas). */
  activeSessions: number;
  /** `@handle` do perfil público, quando existe — só para o atalho na tela. */
  publicHandle: string | null;
}

/** Estado da conta para a tela. `null` = conta inexistente (não deveria acontecer). */
export async function getAccountOverview(userId: string): Promise<AccountOverview | null> {
  const [user, credential, activeSessions] = await Promise.all([
    adminPrisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        twoFactorEnabled: true,
        publicHandle: true,
      },
    }),
    adminPrisma.account.findFirst({
      where: { userId, providerId: 'credential' },
      select: { password: true },
    }),
    adminPrisma.session.count({ where: { userId } }),
  ]);

  if (!user) return null;

  return {
    userId,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    twoFactorEnabled: user.twoFactorEnabled,
    hasPassword: credential?.password != null,
    activeSessions,
    publicHandle: user.publicHandle,
  };
}

/**
 * Sessões ativas da conta, prontas para a tela.
 *
 * `currentToken` vem da sessão de quem está olhando: é o que marca a linha "este
 * dispositivo" — a que a pessoa NÃO deve encerrar sem querer. A leitura é direta na
 * tabela (e não pelo `auth.api.listSessions`) para o serviço poder ser exercitado sem
 * requisição; a listagem pela biblioteca continua sendo o caminho das AÇÕES de
 * encerrar, que precisam conferir a posse.
 */
export async function readAccountSessions(input: {
  userId: string;
  currentToken: string | null;
  limit?: number;
}): Promise<AccountSession[]> {
  const rows = await adminPrisma.session.findMany({
    where: { userId: input.userId },
    orderBy: { updatedAt: 'desc' },
    take: input.limit ?? 50,
    select: {
      token: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      updatedAt: true,
      expiresAt: true,
    },
  });

  const sessions: AccountSession[] = rows.map((row) => ({
    token: row.token,
    ...describeSession(row.userAgent),
    ipAddress: maskIpAddress(row.ipAddress),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    isCurrent: input.currentToken !== null && row.token === input.currentToken,
  }));

  return orderSessionsForDisplay(sessions);
}

export type DeleteOwnAccountResult =
  | { ok: true; soleOwnerTenants?: undefined }
  | {
      ok: false;
      code:
        | 'NOT_FOUND'
        | 'CONFIRMATION_MISMATCH'
        | 'PASSWORD_REQUIRED'
        | 'INVALID_PASSWORD'
        | 'SOLE_OWNER_OF_TENANT';
      message: string;
      soleOwnerTenants?: readonly SoleOwnerTenantRef[];
    };

/**
 * Encerra a própria conta do titular (FASE 110 — direito à eliminação/LGPD).
 *
 * Mantém integridade multi-tenant e documental:
 *  1. Recusa se a pessoa for a única `OWNER` ativa de uma instituição não removida.
 *  2. Cancela inscrições vivas futuras (liberando vagas para a fila).
 *  3. Apaga respostas pessoais de formulários, sessões, credenciais, 2FA, favoritos e vínculos.
 *  4. Anonimiza `users` de forma irreversível para não quebrar certificados públicos já emitidos.
 */
export async function deleteOwnAccount(input: {
  userId: string;
  confirmationPhrase: string;
  currentPassword?: string;
  verifyPassword?: (password: string) => Promise<boolean>;
}): Promise<DeleteOwnAccountResult> {
  const [user, credential, ownerAssignments] = await Promise.all([
    adminPrisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, deletedAt: true },
    }),
    adminPrisma.account.findFirst({
      where: { userId: input.userId, providerId: 'credential' },
      select: { password: true },
    }),
    adminPrisma.roleAssignment.findMany({
      where: {
        userId: input.userId,
        role: 'OWNER',
        revokedAt: null,
        tenantId: { not: null },
        tenant: { deletedAt: null },
      },
      select: {
        tenantId: true,
        tenant: { select: { id: true, name: true, slug: true } },
      },
    }),
  ]);

  if (!user || user.deletedAt) {
    return { ok: false, code: 'NOT_FOUND', message: 'Conta não encontrada ou já encerrada.' };
  }

  const soleOwnerTenants: SoleOwnerTenantRef[] = [];
  for (const assignment of ownerAssignments) {
    if (!assignment.tenantId || !assignment.tenant) continue;
    const otherActiveOwners = await adminPrisma.roleAssignment.count({
      where: {
        tenantId: assignment.tenantId,
        role: 'OWNER',
        revokedAt: null,
        userId: { not: input.userId },
        user: {
          deletedAt: null,
          memberships: {
            some: {
              tenantId: assignment.tenantId,
              status: 'ACTIVE',
              deletedAt: null,
            },
          },
        },
      },
    });
    if (otherActiveOwners === 0) {
      soleOwnerTenants.push({
        tenantId: assignment.tenant.id,
        tenantName: assignment.tenant.name,
        tenantSlug: assignment.tenant.slug,
      });
    }
  }

  const hasPassword = credential?.password != null;
  const eligibility = evaluateAccountDeletionEligibility({
    confirmationPhrase: input.confirmationPhrase,
    hasPassword,
    currentPassword: input.currentPassword ?? '',
    soleOwnerTenants,
  });

  if (!eligibility.ok) {
    return {
      ok: false,
      code: eligibility.code,
      message: eligibility.message,
      soleOwnerTenants: eligibility.soleOwnerTenants,
    };
  }

  if (hasPassword && input.verifyPassword) {
    const valid = await input.verifyPassword(input.currentPassword ?? '');
    if (!valid) {
      return {
        ok: false,
        code: 'INVALID_PASSWORD',
        message: 'A senha atual está incorreta.',
      };
    }
  }

  // Libera vagas de inscrições vivas em eventos futuros usando o serviço canônico de cada tenant.
  const now = new Date();
  const futureRegistrations = await adminPrisma.registration.findMany({
    where: {
      userId: input.userId,
      deletedAt: null,
      status: { in: ['PENDING', 'CONFIRMED', 'WAITLISTED'] },
      event: { endsAt: { gt: now }, deletedAt: null },
    },
    select: { id: true, tenantId: true },
  });

  for (const reg of futureRegistrations) {
    await cancelRegistration({
      tenantId: reg.tenantId,
      registrationId: reg.id,
      userId: input.userId,
      reason: 'Conta encerrada pelo titular',
    }).catch(() => {});
  }

  // Limpa respostas pessoais em inscrições restantes (mantendo apenas eventuais certificados íntegros).
  const remainingRegistrations = await adminPrisma.registration.findMany({
    where: { userId: input.userId, deletedAt: null },
    select: { id: true, tenantId: true, formResponses: true },
  });

  const regsByTenant = new Map<string, typeof remainingRegistrations>();
  for (const reg of remainingRegistrations) {
    const list = regsByTenant.get(reg.tenantId) ?? [];
    list.push(reg);
    regsByTenant.set(reg.tenantId, list);
  }

  for (const [tenantId, regs] of regsByTenant) {
    await withTenant(tenantId, async (tx) => {
      for (const reg of regs) {
        const cleaned = erasePersonalFormResponses(reg.formResponses);
        await tx.registration.update({
          where: { id: reg.id },
          data: {
            accessibilityNotes: null,
            dietaryNotes: null,
            formResponses: cleaned.kept as object,
          },
        });
      }
      await tx.activityFavorite.deleteMany({ where: { userId: input.userId } });
    });
  }

  // Remove foto armazenada fora do banco (melhor esforço).
  await removeUserAvatar(input.userId).catch(() => {});

  const anonymized = buildAnonymizedAccountPayload(input.userId);
  const memberships = await adminPrisma.userTenantProfile.findMany({
    where: { userId: input.userId },
    select: { tenantId: true },
  });

  await adminPrisma.$transaction([
    adminPrisma.roleAssignment.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: now, reason: 'Conta encerrada pelo titular' },
    }),
    adminPrisma.userTenantProfile.updateMany({
      where: { userId: input.userId, deletedAt: null },
      data: { status: 'REMOVED', deletedAt: now },
    }),
    adminPrisma.session.deleteMany({ where: { userId: input.userId } }),
    adminPrisma.account.deleteMany({ where: { userId: input.userId } }),
    adminPrisma.twoFactor.deleteMany({ where: { userId: input.userId } }),
    adminPrisma.user.update({
      where: { id: input.userId },
      data: {
        ...anonymized,
        banned: true,
        banReason: 'Conta encerrada pelo titular',
        deletedAt: now,
      },
    }),
  ]);

  for (const membership of memberships) {
    invalidateTenantCache(membership.tenantId);
  }

  return { ok: true };
}
