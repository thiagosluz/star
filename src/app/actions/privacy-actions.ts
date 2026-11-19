'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CASOS DE USO — Consentimento de cookies (FASE 110)
 *
 *  Contrato `(formData: FormData) => Promise<void>` para funcionar 100% sem
 *  JavaScript no banner e em `/privacidade`, exatamente como `ThemeChoice` e
 *  `NavCollapseToggle`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { extractClientIp } from '@/lib/http/request-meta';

import {
  COOKIE_CONSENT_COOKIE,
  COOKIE_CONSENT_MAX_AGE_SECONDS,
  PRIVACY_INVENTORY_VERSION,
  parseCookieConsent,
  serializeCookieConsent,
  type CookieConsentChoice,
} from '@/domain/privacy/privacy-consent-rules';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { recordCookieConsent } from '@/lib/privacy/cookie-consent-service';
import { NAV_MODE_COOKIE } from '@/lib/shell/nav-mode';
import { THEME_COOKIE } from '@/lib/theme/theme-mode';

function parseChoice(value: FormDataEntryValue | null): CookieConsentChoice {
  return value === 'ALL' ? 'ALL' : 'ESSENTIAL_ONLY';
}

function parseSource(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string') return 'banner';
  const cleaned = value.trim().slice(0, 40);
  return cleaned || 'banner';
}

export async function saveCookieConsentAction(formData: FormData): Promise<void> {
  const choice = parseChoice(formData.get('choice'));
  const source = parseSource(formData.get('source'));

  const [cookieStore, requestHeaders, user] = await Promise.all([
    cookies(),
    headers(),
    getAuthenticatedUser().catch(() => null),
  ]);

  const existing = parseCookieConsent(cookieStore.get(COOKIE_CONSENT_COOKIE)?.value);

  const { token } = await recordCookieConsent({
    choice,
    source,
    userId: user?.id ?? null,
    existingToken: existing?.token ?? null,
    ipAddress: extractClientIp(requestHeaders),
    userAgent: requestHeaders.get('user-agent'),
  });

  cookieStore.set(
    COOKIE_CONSENT_COOKIE,
    serializeCookieConsent({
      version: PRIVACY_INVENTORY_VERSION,
      choice,
      token,
    }),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: COOKIE_CONSENT_MAX_AGE_SECONDS,
    },
  );

  // Escolha real: recusar preferências apaga na hora os cookies de tema e barra.
  if (choice === 'ESSENTIAL_ONLY') {
    cookieStore.delete(THEME_COOKIE);
    cookieStore.delete(NAV_MODE_COOKIE);
  }

  revalidatePath('/', 'layout');
}
