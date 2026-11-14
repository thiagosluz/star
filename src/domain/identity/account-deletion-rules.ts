/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Encerramento da própria conta pelo titular (FASE 110)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AUTONOMIA SEM QUEBRAR INTEGRIDADE ACADÊMICA NEM DEIXAR INSTITUIÇÃO ÓRFÃ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O titular tem direito de apagar a própria conta sem depender da instituição.
 *  Duas salvaguardas puras mantêm o restante do sistema íntegro:
 *
 *    1. Única `OWNER` de uma instituição ativa: encerrar a conta deixaria uma casa
 *       sem dona administrativa. Exigimos transferir a titularidade antes.
 *    2. Registros públicos com dever de autenticidade (certificados assinados,
 *       submissões em anais): a linha em `users` é anonimizada irreversivelmente
 *       (`deletedAt` preenchido, identificadores/contato/segredos zerados), e todas
 *       as sessões, credenciais, semente 2FA, vínculos e inscrições futuras são
 *       removidos/cancelados.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const ACCOUNT_DELETION_CONFIRMATION_PHRASE = 'EXCLUIR MINHA CONTA';

export interface SoleOwnerTenantRef {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
}

export type AccountDeletionCheckResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'CONFIRMATION_MISMATCH'
        | 'PASSWORD_REQUIRED'
        | 'SOLE_OWNER_OF_TENANT';
      message: string;
      soleOwnerTenants?: readonly SoleOwnerTenantRef[];
    };

export function evaluateAccountDeletionEligibility(input: {
  confirmationPhrase: string;
  hasPassword: boolean;
  currentPassword: string;
  soleOwnerTenants: readonly SoleOwnerTenantRef[];
}): AccountDeletionCheckResult {
  if (input.confirmationPhrase.trim().toUpperCase() !== ACCOUNT_DELETION_CONFIRMATION_PHRASE) {
    return {
      ok: false,
      code: 'CONFIRMATION_MISMATCH',
      message: `Digite exatamente "${ACCOUNT_DELETION_CONFIRMATION_PHRASE}" para confirmar o encerramento.`,
    };
  }

  if (input.hasPassword && !input.currentPassword) {
    return {
      ok: false,
      code: 'PASSWORD_REQUIRED',
      message: 'Informe sua senha atual para confirmar o encerramento da conta.',
    };
  }

  if (input.soleOwnerTenants.length > 0) {
    const names = input.soleOwnerTenants.map((t) => t.tenantName).join(', ');
    return {
      ok: false,
      code: 'SOLE_OWNER_OF_TENANT',
      message: `Você ainda é a única pessoa proprietária (OWNER) em: ${names}. Transfira o papel de OWNER para outro membro antes de encerrar sua conta.`,
      soleOwnerTenants: input.soleOwnerTenants,
    };
  }

  return { ok: true };
}

export function buildAnonymizedAccountPayload(userId: string) {
  return {
    name: 'Titular removido (LGPD)',
    email: `deleted-${userId}@anon.invalid`,
    emailVerified: false,
    image: null,
    passwordHash: null,
    publicHandle: null,
    bio: null,
    headline: null,
    country: null,
    orcidId: null,
    lattesId: null,
    publicSiteUrl: null,
    publicSocialLinks: {},
    publicInterests: [],
    profileAudiences: {},
    profileIndexable: false,
    isPublicProfile: false,
    twoFactorEnabled: false,
  };
}
