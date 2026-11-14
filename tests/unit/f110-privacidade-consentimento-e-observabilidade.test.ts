/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UNITÁRIOS & CATRACAS — Privacidade, consentimento, conta e observabilidade (FASE 110)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { maskIpAddress } from '../../src/domain/privacy/ip-privacy-rules';
import {
  COOKIE_INVENTORY,
  DATA_PROCESSING_INVENTORY,
  PRIVACY_INVENTORY_VERSION,
  isPreferenceRejected,
  parseCookieConsent,
  serializeCookieConsent,
  shouldShowCookieBanner,
} from '../../src/domain/privacy/privacy-consent-rules';
import {
  REGISTRATION_CONSENT_VERSION,
  REGISTRATION_DATA_CONSENT_TEXT,
  REGISTRATION_IMAGE_CONSENT_TEXT,
  buildRegistrationConsentSnapshot,
} from '../../src/domain/events/registration-consent-rules';
import {
  ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  buildAnonymizedAccountPayload,
  evaluateAccountDeletionEligibility,
} from '../../src/domain/identity/account-deletion-rules';
import {
  ALERT_HTTP_5XX_THRESHOLD,
  ALERT_SCRAPE_DENIED_THRESHOLD,
  evaluateOperationalAlerts,
} from '../../src/domain/observability/alert-rules';
import { evaluateAndPublishOperationalAlerts } from '../../src/lib/observability/alerts';
import { incCounter, renderMetrics, resetMetrics } from '../../src/lib/observability/metrics';
import { PLATFORM_ONLY_TABLES, TENANT_SCOPED_TABLES } from '../../src/lib/db/schema-contract';

const ROOT = process.cwd();

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated') continue;
      out.push(...collectTsFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }

  return out;
}

describe('FASE 110 — Mascaramento de IP (IPv4 /24 e IPv6 /48)', () => {
  it('trunca IPv4 para /24 e IPv6 para /48, preservando null e vazio', () => {
    expect(maskIpAddress(null)).toBeNull();
    expect(maskIpAddress('   ')).toBeNull();
    expect(maskIpAddress('203.0.113.45')).toBe('203.0.113.0');
    expect(maskIpAddress('203.0.113.45:51234')).toBe('203.0.113.0');
    expect(maskIpAddress('198.51.100.9, 10.0.0.1')).toBe('198.51.100.0');
    expect(maskIpAddress('2001:db8:85a3:1234::8a2e:370:7334')).toBe('2001:db8:85a3::');
    expect(maskIpAddress('[2001:0db8:0042:9999::1]:443')).toBe('2001:db8:42::');
    expect(maskIpAddress('::ffff:203.0.113.45')).toBe('::ffff:203.0.113.0');
  });

  it('é idempotente e descarta entradas inválidas como null', () => {
    const maskedV4 = maskIpAddress('172.16.254.99');
    expect(maskIpAddress(maskedV4)).toBe(maskedV4);

    const maskedV6 = maskIpAddress('2804:14c:1234:5678::1');
    expect(maskIpAddress(maskedV6)).toBe(maskedV6);

    expect(maskIpAddress('nao-e-um-ip')).toBeNull();
  });
});

describe('FASE 110 — Inventário versionado e consentimento real de cookies', () => {
  it('separa cookies essenciais de preferência (tema e barra lateral nunca são essenciais)', () => {
    const essential = COOKIE_INVENTORY.filter((c) => c.category === 'ESSENTIAL');
    const preference = COOKIE_INVENTORY.filter((c) => c.category === 'PREFERENCE');

    expect(essential.map((c) => c.name)).toContain('better-auth.session_token');
    expect(essential.map((c) => c.name)).toContain('better-auth.two_factor');
    expect(essential.map((c) => c.name)).toContain('ef_consentimento');
    expect(essential.every((c) => c.optional === false)).toBe(true);

    expect(preference.map((c) => c.name)).toEqual(['ef_tema', 'ef_nav']);
    expect(preference.every((c) => c.optional === true)).toBe(true);
    expect(DATA_PROCESSING_INVENTORY.length).toBeGreaterThanOrEqual(4);
  });

  it('serializa/lê decisão, oculta banner na versão vigente e bloqueia preferências apenas quando recusado', () => {
    const encoded = serializeCookieConsent({
      version: PRIVACY_INVENTORY_VERSION,
      choice: 'ESSENTIAL_ONLY',
      token: 'tok-abc-123456',
    });
    const parsed = parseCookieConsent(encoded);

    expect(parsed).toEqual({
      version: PRIVACY_INVENTORY_VERSION,
      choice: 'ESSENTIAL_ONLY',
      preferencesAllowed: false,
      token: 'tok-abc-123456',
    });
    expect(shouldShowCookieBanner(parsed)).toBe(false);
    expect(isPreferenceRejected(parsed)).toBe(true);

    expect(shouldShowCookieBanner(null)).toBe(true);
    expect(isPreferenceRejected(null)).toBe(false);
    expect(
      shouldShowCookieBanner({
        version: '2026.01-v0',
        choice: 'ALL',
        preferencesAllowed: true,
        token: 'tok-old',
      }),
    ).toBe(true);
  });
});

describe('FASE 110 — Consentimento versionado de inscrição e encerramento de conta', () => {
  it('monta snapshot com versão vigente e texto explícito apresentado no ato', () => {
    const snap = buildRegistrationConsentSnapshot({
      consentData: true,
      consentImage: false,
    });

    expect(snap.consentVersion).toBe(REGISTRATION_CONSENT_VERSION);
    expect(snap.consentText).toContain('[Dados:ACEITO]');
    expect(snap.consentText).toContain(REGISTRATION_DATA_CONSENT_TEXT);
    expect(snap.consentText).toContain('[Imagem:NAO_AUTORIZADO]');
    expect(snap.consentText).toContain(REGISTRATION_IMAGE_CONSENT_TEXT);
  });

  it('valida frase de confirmação, senha e bloqueio por última OWNER antes de anonimizar', () => {
    expect(
      evaluateAccountDeletionEligibility({
        confirmationPhrase: 'errado',
        hasPassword: false,
        currentPassword: '',
        soleOwnerTenants: [],
      }),
    ).toMatchObject({ ok: false, code: 'CONFIRMATION_MISMATCH' });

    expect(
      evaluateAccountDeletionEligibility({
        confirmationPhrase: ACCOUNT_DELETION_CONFIRMATION_PHRASE,
        hasPassword: true,
        currentPassword: '',
        soleOwnerTenants: [],
      }),
    ).toMatchObject({ ok: false, code: 'PASSWORD_REQUIRED' });

    expect(
      evaluateAccountDeletionEligibility({
        confirmationPhrase: ACCOUNT_DELETION_CONFIRMATION_PHRASE,
        hasPassword: true,
        currentPassword: 'segredo-correto',
        soleOwnerTenants: [
          { tenantId: 't1', tenantName: 'UFBA Demo', tenantSlug: 'ufba-demo' },
        ],
      }),
    ).toMatchObject({ ok: false, code: 'SOLE_OWNER_OF_TENANT' });

    expect(
      evaluateAccountDeletionEligibility({
        confirmationPhrase: `  ${ACCOUNT_DELETION_CONFIRMATION_PHRASE.toLowerCase()} `,
        hasPassword: false,
        currentPassword: '',
        soleOwnerTenants: [],
      }),
    ).toEqual({ ok: true });

    const payload = buildAnonymizedAccountPayload('user-123');
    expect(payload.email).toBe('deleted-user-123@anon.invalid');
    expect(payload.image).toBeNull();
    expect(payload.twoFactorEnabled).toBe(false);
    expect(payload.isPublicProfile).toBe(false);
  });
});

describe('FASE 110 — Alertas operacionais acoplados a /api/metrics (B9)', () => {
  it('avalia regras críticas e de atenção conforme limiares', () => {
    const quiet = evaluateOperationalAlerts({
      queueUp: true,
      queueWorkers: 1,
      waitingJobs: 2,
      failedJobs: 0,
      http5xxTotal: 0,
      scrapeDeniedTotal: 0,
    });
    expect(quiet.every((a) => !a.firing)).toBe(true);

    const loud = evaluateOperationalAlerts({
      queueUp: true,
      queueWorkers: 0,
      waitingJobs: 3,
      failedJobs: 2,
      http5xxTotal: ALERT_HTTP_5XX_THRESHOLD,
      scrapeDeniedTotal: ALERT_SCRAPE_DENIED_THRESHOLD,
    });
    const firingNames = loud.filter((a) => a.firing).map((a) => a.name);
    expect(firingNames).toEqual([
      'BullMQNoWorkers',
      'BullMQFailedJobsBacklog',
      'Http5xxSpike',
      'MetricsScrapeDeniedSpike',
    ]);
  });

  it('publica gauges eventflow_alert_firing e eventflow_alerts_firing_total no Prometheus', () => {
    resetMetrics();
    for (let i = 0; i < ALERT_HTTP_5XX_THRESHOLD; i++) {
      incCounter('http_requests_total', { route: '/api/test', method: 'GET', status: '500' });
    }

    const report = evaluateAndPublishOperationalAlerts({
      waiting: 0,
      active: 0,
      completed: 10,
      failed: 0,
      workers: 1,
    });

    expect(report.firingCount).toBe(1);
    const prom = renderMetrics();
    expect(prom).toContain('eventflow_alert_firing{alert="Http5xxSpike",severity="warning"} 1');
    expect(prom).toContain('eventflow_alerts_firing_total 1');
  });
});

describe('FASE 110 — Catracas arquiteturais (contrato de plataforma e logger B6)', () => {
  it('mantém cookie_consents na lista PLATFORM_ONLY_TABLES e revogada em 00-roles.sql', () => {
    expect(PLATFORM_ONLY_TABLES).toContain('cookie_consents');
    expect(TENANT_SCOPED_TABLES).not.toContain('cookie_consents');

    const rolesSql = readFileSync(join(ROOT, 'docker/postgres/init/00-roles.sql'), 'utf8');
    expect(rolesSql).toContain("'cookie_consents'");
  });

  it('proíbe chamadas console.* restantes em src/lib, src/workers, src/app/actions e src/app/api', () => {
    const targets = [
      ...collectTsFiles(join(ROOT, 'src/lib')),
      ...collectTsFiles(join(ROOT, 'src/workers')),
      ...collectTsFiles(join(ROOT, 'src/app/actions')),
      ...collectTsFiles(join(ROOT, 'src/app/api')),
    ].filter((file) => !file.endsWith(join('src', 'lib', 'observability', 'logger.ts')));

    const offenders: string[] = [];
    for (const file of targets) {
      const content = readFileSync(file, 'utf8');
      for (const [idx, line] of content.split(/\r?\n/).entries()) {
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
        if (/\bconsole\.(log|warn|error|info|debug)\s*\(/.test(trimmed)) {
          offenders.push(`${file}:${idx + 1}: ${trimmed}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
