/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Consentimento de cookies (FASE 110)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE USAMOS `adminPrisma` AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `cookie_consents` é tabela de PLATAFORMA: o visitante não pertence a uma
 *  instituição ao aceitar ou recusar cookies na plataforma. Seguindo a ADR-191 e
 *  o contrato em `schema-contract.ts`, a role de runtime (`eventflow_app`) não
 *  tem privilégio algum nessa tabela — só `adminPrisma` escreve e lê o recibo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

import {
  COOKIE_CONSENT_COOKIE,
  PRIVACY_INVENTORY_VERSION,
  isPreferenceRejected,
  parseCookieConsent,
  type CookieConsentChoice,
  type ParsedCookieConsent,
} from '@/domain/privacy/privacy-consent-rules';
import { maskIpAddress } from '@/domain/privacy/ip-privacy-rules';
import { adminPrisma } from '@/lib/db/admin-client';
import { logger } from '@/lib/observability/logger';
import { errorMessage } from '@/lib/db/prisma-errors';

export interface CookieConsentReceipt {
  id: string;
  consentToken: string;
  policyVersion: string;
  preferencesAllowed: boolean;
  source: string;
  ipAddressMasked: string | null;
  createdAt: Date;
}

export async function readVisitorCookieConsent(): Promise<ParsedCookieConsent | null> {
  const cookieStore = await cookies();
  return parseCookieConsent(cookieStore.get(COOKIE_CONSENT_COOKIE)?.value);
}

export async function isVisitorPreferenceRejected(): Promise<boolean> {
  return isPreferenceRejected(await readVisitorCookieConsent());
}

export async function recordCookieConsent(input: {
  choice: CookieConsentChoice;
  source: string;
  userId?: string | null;
  existingToken?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; recordedId: string | null }> {
  const token = input.existingToken && input.existingToken.length >= 16
    ? input.existingToken.slice(0, 64)
    : randomUUID();
  const id = randomUUID();

  try {
    await adminPrisma.cookieConsent.create({
      data: {
        id,
        consentToken: token,
        userId: input.userId ?? null,
        policyVersion: PRIVACY_INVENTORY_VERSION,
        essentialAllowed: true,
        preferencesAllowed: input.choice === 'ALL',
        source: input.source.slice(0, 40),
        ipAddressMasked: maskIpAddress(input.ipAddress),
        userAgent: input.userAgent?.slice(0, 500) ?? null,
      },
    });
    return { token, recordedId: id };
  } catch (error) {
    // Falha no registro histórico não pode travar o cookie nem a navegação do visitante.
    logger.error('privacy.cookie_consent_record_failed', {
      error: errorMessage(error),
      source: input.source,
    });
    return { token, recordedId: null };
  }
}

export async function readCookieConsentReceipt(
  consentToken: string | null | undefined,
): Promise<CookieConsentReceipt | null> {
  if (!consentToken) return null;

  try {
    return await adminPrisma.cookieConsent.findFirst({
      where: { consentToken },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        consentToken: true,
        policyVersion: true,
        preferencesAllowed: true,
        source: true,
        ipAddressMasked: true,
        createdAt: true,
      },
    });
  } catch (error) {
    logger.warn('privacy.cookie_consent_receipt_read_failed', {
      error: errorMessage(error),
    });
    return null;
  }
}
