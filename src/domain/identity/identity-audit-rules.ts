/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Trilha de identidade (FASE 49)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA TRILHA PRÓPRIA, E NÃO A `audit_logs`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `audit_logs` tem `tenantId` e RLS: ela registra o que acontece DENTRO de uma
 *  instituição. Trocar senha, ligar o segundo fator, trocar e-mail e encerrar
 *  sessões são fatos da IDENTIDADE, que é global desde a ADR-002 — e a pergunta
 *  "de onde veio esta troca de senha?" não tinha onde ser respondida (dívida E67).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TRILHA GUARDA — E O QUE ELA NUNCA PODE GUARDAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Guarda o FATO: quem, o quê, quando, de onde (IP e user-agent) e o que mudou em
 *  termos de estado (`{ twoFactorEnabled: { from: false, to: true } }`).
 *
 *  Não guarda — e a lista é curta de propósito, porque segredo em trilha é segredo
 *  vazado — **senha, hash, token, código de recuperação, segredo TOTP, cookie e
 *  assinatura**. `recordIdentityAudit` descarta essas chaves em qualquer nível do
 *  objeto, e o teste que prende isso é o que impede a "melhoria" futura de gravar
 *  o código para conferir depois.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const IDENTITY_AUDIT_EVENTS = [
  'PASSWORD_CHANGED',
  'PASSWORD_SET',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'TWO_FACTOR_ENABLED',
  'TWO_FACTOR_DISABLED',
  'BACKUP_CODES_REGENERATED',
  'BACKUP_CODE_USED',
  'TWO_FACTOR_CHALLENGE_FAILED',
  'EMAIL_CHANGE_REQUESTED',
  'EMAIL_VERIFIED',
  'SESSION_REVOKED',
  'OTHER_SESSIONS_REVOKED',
  'PROFILE_PHOTO_CHANGED',
  'PROFILE_PHOTO_REMOVED',
] as const;

export type IdentityAuditEvent = (typeof IDENTITY_AUDIT_EVENTS)[number];

export const IDENTITY_AUDIT_EVENT_LABELS: Readonly<Record<IdentityAuditEvent, string>> = {
  PASSWORD_CHANGED: 'Senha alterada',
  PASSWORD_SET: 'Senha criada',
  PASSWORD_RESET_REQUESTED: 'Redefinição de senha pedida',
  PASSWORD_RESET_COMPLETED: 'Senha redefinida pelo link',
  TWO_FACTOR_ENABLED: 'Segundo fator ativado',
  TWO_FACTOR_DISABLED: 'Segundo fator desativado',
  BACKUP_CODES_REGENERATED: 'Códigos de recuperação regenerados',
  BACKUP_CODE_USED: 'Código de recuperação usado no login',
  TWO_FACTOR_CHALLENGE_FAILED: 'Código do segundo fator recusado',
  EMAIL_CHANGE_REQUESTED: 'Troca de e-mail pedida',
  EMAIL_VERIFIED: 'E-mail confirmado',
  SESSION_REVOKED: 'Uma sessão encerrada',
  OTHER_SESSIONS_REVOKED: 'As outras sessões encerradas',
  PROFILE_PHOTO_CHANGED: 'Foto de perfil alterada',
  PROFILE_PHOTO_REMOVED: 'Foto de perfil removida',
};

/**
 * Gravidade — o que a tela usa para ordenar o olho de quem investiga.
 *
 * `CRITICAL` é o que tira alguém da conta (senha, segundo fator, sessões) ou o que
 * falha na porta (código recusado); `INFO` é mudança de perfil. Sem esta separação,
 * uma lista de trinta linhas iguais esconde o fato que importava.
 */
export type IdentityAuditTone = 'INFO' | 'WARN' | 'CRITICAL';

export const IDENTITY_AUDIT_EVENT_TONES: Readonly<Record<IdentityAuditEvent, IdentityAuditTone>> = {
  PASSWORD_CHANGED: 'CRITICAL',
  PASSWORD_SET: 'CRITICAL',
  PASSWORD_RESET_REQUESTED: 'WARN',
  PASSWORD_RESET_COMPLETED: 'CRITICAL',
  TWO_FACTOR_ENABLED: 'CRITICAL',
  TWO_FACTOR_DISABLED: 'CRITICAL',
  BACKUP_CODES_REGENERATED: 'WARN',
  BACKUP_CODE_USED: 'WARN',
  TWO_FACTOR_CHALLENGE_FAILED: 'CRITICAL',
  EMAIL_CHANGE_REQUESTED: 'CRITICAL',
  EMAIL_VERIFIED: 'INFO',
  SESSION_REVOKED: 'WARN',
  OTHER_SESSIONS_REVOKED: 'WARN',
  PROFILE_PHOTO_CHANGED: 'INFO',
  PROFILE_PHOTO_REMOVED: 'INFO',
};

export const IDENTITY_AUDIT_TONE_LABELS: Readonly<Record<IdentityAuditTone, string>> = {
  INFO: 'Informativo',
  WARN: 'Atenção',
  CRITICAL: 'Crítico',
};

export function isIdentityAuditEvent(value: unknown): value is IdentityAuditEvent {
  return typeof value === 'string' && (IDENTITY_AUDIT_EVENTS as readonly string[]).includes(value);
}

export function identityAuditLabel(event: string): string {
  return isIdentityAuditEvent(event) ? IDENTITY_AUDIT_EVENT_LABELS[event] : 'Evento de segurança';
}

export function identityAuditTone(event: string): IdentityAuditTone {
  return isIdentityAuditEvent(event) ? IDENTITY_AUDIT_EVENT_TONES[event] : 'WARN';
}

/**
 * Chaves que NUNCA entram na trilha, em qualquer profundidade.
 *
 * A lista é a mesma da trilha de instituição (`sanitizeChanges`) mais os nomes que
 * o fluxo de identidade usa: `password`, `token`, `secret`, `backupCodes`, `code`,
 * `otp`, `cookie`, `signature`.
 */
export const IDENTITY_AUDIT_FORBIDDEN_KEYS: readonly string[] = [
  'password',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'token',
  'secret',
  'totpsecret',
  'backupcodes',
  'recoverycode',
  'code',
  'otp',
  'cookie',
  'signature',
  'sessiontoken',
  'apikey',
];

/** Deixa passar só o que pode ser lido: o resto sai como `[removido]`. */
export function sanitizeIdentityDetails(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 4) return '[profundo]';

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeIdentityDetails(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (IDENTITY_AUDIT_FORBIDDEN_KEYS.includes(key.toLowerCase().replace(/[^a-z]/g, ''))) {
        out[key] = '[removido]';
        continue;
      }

      out[key] = sanitizeIdentityDetails(item, depth + 1);
    }

    return out;
  }

  if (typeof value === 'string') return value.slice(0, 300);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  return String(value).slice(0, 300);
}

/** O detalhe "de → para" só entra quando as duas pontas existem e diferem. */
export function identityChange(from: unknown, to: unknown): { from: unknown; to: unknown } {
  return { from: from ?? null, to: to ?? null };
}
