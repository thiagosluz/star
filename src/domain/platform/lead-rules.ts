/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Leads Institucionais e Contato Comercial (FASE 71 · ADR-353)
 *
 *  Regras puras de validação, limites de campo e estados do funil de contato.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type LeadStatusKey = 'OPEN' | 'CONTACTED' | 'QUALIFIED' | 'ARCHIVED';

export const LEAD_STATUS_LABELS: Record<LeadStatusKey, string> = {
  OPEN: 'Novo (Aberto)',
  CONTACTED: 'Em contato',
  QUALIFIED: 'Qualificado',
  ARCHIVED: 'Arquivado',
};

const VALID_STATUSES = new Set<string>(['OPEN', 'CONTACTED', 'QUALIFIED', 'ARCHIVED']);

export function isLeadStatus(value: unknown): value is LeadStatusKey {
  return typeof value === 'string' && VALID_STATUSES.has(value);
}

export interface RawLeadInput {
  name?: unknown;
  email?: unknown;
  organization?: unknown;
  roleInOrg?: unknown;
  phone?: unknown;
  estimatedEventsPerYear?: unknown;
  message?: unknown;
}

export interface ValidatedLeadInput {
  name: string;
  email: string;
  organization: string;
  roleInOrg: string | null;
  phone: string | null;
  estimatedEventsPerYear: string | null;
  message: string | null;
}

export type LeadValidationResult =
  | { ok: true; data: ValidatedLeadInput }
  | { ok: false; code: string; message: string };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valida a submissão de contato institucional com erros como valor.
 */
export function validateLeadInput(input: RawLeadInput): LeadValidationResult {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const organization =
    typeof input.organization === 'string' ? input.organization.trim() : '';
  const roleInOrg =
    typeof input.roleInOrg === 'string' && input.roleInOrg.trim().length > 0
      ? input.roleInOrg.trim()
      : null;
  const phone =
    typeof input.phone === 'string' && input.phone.trim().length > 0
      ? input.phone.trim()
      : null;
  const estimatedEvents =
    typeof input.estimatedEventsPerYear === 'string' &&
    input.estimatedEventsPerYear.trim().length > 0
      ? input.estimatedEventsPerYear.trim()
      : null;
  const message =
    typeof input.message === 'string' && input.message.trim().length > 0
      ? input.message.trim()
      : null;

  if (name.length < 3) {
    return {
      ok: false,
      code: 'INVALID_NAME',
      message: 'O nome do responsável deve ter pelo menos 3 caracteres.',
    };
  }
  if (name.length > 160) {
    return {
      ok: false,
      code: 'NAME_TOO_LONG',
      message: 'O nome não pode exceder 160 caracteres.',
    };
  }

  if (!EMAIL_REGEX.test(email) || email.length > 255) {
    return {
      ok: false,
      code: 'INVALID_EMAIL',
      message: 'Informe um e-mail corporativo ou institucional válido.',
    };
  }

  if (organization.length < 2) {
    return {
      ok: false,
      code: 'INVALID_ORGANIZATION',
      message: 'O nome da instituição deve ter pelo menos 2 caracteres.',
    };
  }
  if (organization.length > 200) {
    return {
      ok: false,
      code: 'ORGANIZATION_TOO_LONG',
      message: 'O nome da instituição não pode exceder 200 caracteres.',
    };
  }

  if (roleInOrg && roleInOrg.length > 120) {
    return {
      ok: false,
      code: 'ROLE_TOO_LONG',
      message: 'O cargo não pode exceder 120 caracteres.',
    };
  }

  if (phone && phone.length > 40) {
    return {
      ok: false,
      code: 'PHONE_TOO_LONG',
      message: 'O telefone não pode exceder 40 caracteres.',
    };
  }

  if (estimatedEvents && estimatedEvents.length > 60) {
    return {
      ok: false,
      code: 'ESTIMATE_TOO_LONG',
      message: 'A estimativa de eventos não pode exceder 60 caracteres.',
    };
  }

  if (message && message.length > 3000) {
    return {
      ok: false,
      code: 'MESSAGE_TOO_LONG',
      message: 'A mensagem não pode exceder 3.000 caracteres.',
    };
  }

  return {
    ok: true,
    data: {
      name,
      email,
      organization,
      roleInOrg,
      phone,
      estimatedEventsPerYear: estimatedEvents,
      message,
    },
  };
}
