/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Autocredenciamento e Segurança Antifraude (FASE 113)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SELF_CHECKIN_POLICY,
  SELF_CHECKIN_ALPHABET,
  evaluateAntiUbiquity,
  evaluateCheckoutCooldown,
  evaluateGeofenceCheck,
  generateRoomPin,
  generateSelfCheckinToken,
  haversineDistanceMeters,
  normalizePinInput,
  normalizeSelfCheckinPolicy,
  normalizeSelfCheckinToken,
  parseSelfCheckinPolicy,
} from '../../src/domain/events/self-checkin-rules';
import {
  computeTotpAtStep,
  currentTotpWindow,
  safeComparePin,
  verifyTotpCode,
} from '../../src/lib/events/self-checkin-totp';
import { renderSelfCheckinPosterPdf } from '../../src/lib/events/self-checkin-poster';

describe('FASE 113 — Domínio de Autocredenciamento e Antifraude', () => {
  describe('1. Token opaco (PA-XXXX-XXXX) e PIN de sala', () => {
    it('gera e normaliza tokens com prefixo PA e alfabeto não-ambíguo', () => {
      let step = 0;
      const token = generateSelfCheckinToken(() => {
        const val = step % SELF_CHECKIN_ALPHABET.length;
        step += 3;
        return val;
      });

      expect(token).toMatch(/^PA-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}$/);
      expect(normalizeSelfCheckinToken(token.toLowerCase().replace(/-/g, ''))).toBe(token);
      expect(normalizeSelfCheckinToken('PA-INVALIDO')).toBeNull();
      expect(normalizeSelfCheckinToken('pa0l1o22')).toBeNull();
    });

    it('gera PIN numérico de 4 dígitos evitando sequências triviais', () => {
      // Simula gerador que primeiro cairia em 1234 e depois sorteia 7391.
      const seq = [234, 6391];
      let i = 0;
      const pin = generateRoomPin(() => seq[i++] ?? 4821);
      expect(pin).toBe('7391');
      expect(normalizePinInput(' 73-91 ')).toBe('7391');
      expect(normalizePinInput('123456')).toBe('123456');
      expect(normalizePinInput('123')).toBeNull();
    });
  });

  describe('2. Geofencing (Haversine) e filtro de precisão', () => {
    const UFBA = { latitude: -12.9999, longitude: -38.5108 };

    it('calcula 0 m para coordenadas idênticas e ~111 m para 0,001° de latitude', () => {
      expect(haversineDistanceMeters(UFBA, UFBA)).toBe(0);
      const approx111m = haversineDistanceMeters(UFBA, {
        latitude: UFBA.latitude + 0.001,
        longitude: UFBA.longitude,
      });
      expect(approx111m).toBeGreaterThanOrEqual(105);
      expect(approx111m).toBeLessThanOrEqual(118);
    });

    it('aprova dentro do raio quando precisão está boa e recusa fora do raio', () => {
      const policy = normalizeSelfCheckinPolicy({
        enabled: true,
        requireGeo: true,
        geoRadiusMeters: 200,
        maxAccuracyMeters: 300,
      });

      const ok = evaluateGeofenceCheck({
        policy,
        eventCoords: UFBA,
        participantCoords: { latitude: UFBA.latitude + 0.001, longitude: UFBA.longitude },
        accuracyMeters: 25,
      });
      expect(ok.ok).toBe(true);
      if (ok.ok) {
        expect(ok.skipped).toBe(false);
        expect(ok.distanceMeters).toBeLessThan(200);
      }

      const far = evaluateGeofenceCheck({
        policy,
        eventCoords: UFBA,
        participantCoords: { latitude: UFBA.latitude + 0.01, longitude: UFBA.longitude },
        accuracyMeters: 20,
      });
      expect(far.ok).toBe(false);
      if (!far.ok) {
        expect(far.code).toBe('OUT_OF_GEOFENCE');
        expect(far.distanceMeters).toBeGreaterThan(1000);
      }
    });

    it('bloqueia leitura com precisão de GPS degradada (ex.: geolocalização de desktop por IP)', () => {
      const policy = normalizeSelfCheckinPolicy({
        enabled: true,
        requireGeo: true,
        geoRadiusMeters: 250,
        maxAccuracyMeters: 300,
      });

      const degraded = evaluateGeofenceCheck({
        policy,
        eventCoords: UFBA,
        participantCoords: UFBA,
        accuracyMeters: 1500,
      });
      expect(degraded.ok).toBe(false);
      if (!degraded.ok) {
        expect(degraded.code).toBe('GEO_ACCURACY_LOW');
      }
    });

    it('exige coordenadas do evento e do participante quando requireGeo = true', () => {
      const policy = normalizeSelfCheckinPolicy({ enabled: true, requireGeo: true });

      const missingEvent = evaluateGeofenceCheck({
        policy,
        eventCoords: null,
        participantCoords: UFBA,
      });
      expect(missingEvent.ok).toBe(false);
      if (!missingEvent.ok) expect(missingEvent.code).toBe('EVENT_LOCATION_MISSING');

      const missingUser = evaluateGeofenceCheck({
        policy,
        eventCoords: UFBA,
        participantCoords: null,
      });
      expect(missingUser.ok).toBe(false);
      if (!missingUser.ok) expect(missingUser.code).toBe('GEO_REQUIRED');
    });
  });

  describe('3. Anti-ubiquidade, cooldown de saída e política', () => {
    it('bloqueia entrada em atividade B se atividade A continua com sessão aberta', () => {
      const blocked = evaluateAntiUbiquity({
        blockConcurrentActivity: true,
        targetActivityId: 'act-b',
        openActivities: [{ activityId: 'act-a', title: 'Oficina de IA' }],
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.code).toBe('CONCURRENT_ACTIVITY_OPEN');
        expect(blocked.blockingActivityTitle).toBe('Oficina de IA');
      }

      const same = evaluateAntiUbiquity({
        blockConcurrentActivity: true,
        targetActivityId: 'act-a',
        openActivities: [{ activityId: 'act-a', title: 'Oficina de IA' }],
      });
      expect(same.ok).toBe(true);
    });

    it('impõe cooldown mínimo antes de fechar presença para evitar toque duplo acidental', () => {
      const entrada = new Date('2026-11-17T14:00:00Z');
      const logoDepois = new Date('2026-11-17T14:00:45Z');
      const depoisDoCooldown = new Date('2026-11-17T14:03:00Z');

      const early = evaluateCheckoutCooldown({ checkedInAt: entrada, now: logoDepois, cooldownMinutes: 2 });
      expect(early.allowed).toBe(false);
      expect(early.waitSeconds).toBe(75);

      const ok = evaluateCheckoutCooldown({ checkedInAt: entrada, now: depoisDoCooldown, cooldownMinutes: 2 });
      expect(ok.allowed).toBe(true);
    });

    it('interpreta e limita valores extremos de Event.settings.selfCheckin', () => {
      expect(parseSelfCheckinPolicy(null)).toEqual(DEFAULT_SELF_CHECKIN_POLICY);
      const parsed = parseSelfCheckinPolicy({
        selfCheckin: {
          enabled: true,
          requireGeo: true,
          geoRadiusMeters: 10_000,
          maxAccuracyMeters: 10,
          checkoutCooldownMinutes: -5,
        },
      });
      expect(parsed.enabled).toBe(true);
      expect(parsed.geoRadiusMeters).toBe(5000);
      expect(parsed.maxAccuracyMeters).toBe(50);
      expect(parsed.checkoutCooldownMinutes).toBe(0);
    });
  });

  describe('4. TOTP de telão (60 s), comparação de PIN e cartaz PDF', () => {
    it('gera e valida código rotativo TOTP aceitando tolerância de ±1 janela', () => {
      const secret = '0123456789abcdef0123456789abcdef01234567';
      const now = new Date(1_800_000_000 * 1000);
      const win = currentTotpWindow(secret, now);

      expect(win.code).toMatch(/^\d{6}$/);
      expect(win.periodSeconds).toBe(60);
      expect(verifyTotpCode(secret, win.code, now)).toBe(true);

      const prevStep = Math.floor(now.getTime() / 1000 / 60) - 1;
      const prevCode = computeTotpAtStep(secret, prevStep);
      expect(verifyTotpCode(secret, prevCode, now)).toBe(true);

      const farStep = Math.floor(now.getTime() / 1000 / 60) - 5;
      const farCode = computeTotpAtStep(secret, farStep);
      expect(verifyTotpCode(secret, farCode, now)).toBe(false);
      expect(safeComparePin('4829', '4829')).toBe(true);
      expect(safeComparePin('4829', '4820')).toBe(false);
    });

    it('renderiza cartaz A4 em PDF vetorial íntegro sem dependências externas', () => {
      const pdf = renderSelfCheckinPosterPdf(
        {
          pointId: '00000000-0000-4000-8000-000000000001',
          tenantSlug: 'ufba-demo',
          tenantName: 'UFBA Demonstração',
          eventId: '00000000-0000-4000-8000-000000000002',
          eventTitle: 'Congresso de Computação 2026',
          eventSlug: 'comp-2026',
          venueName: 'Pavilhão de Aulas',
          activityId: '00000000-0000-4000-8000-000000000003',
          activityTitle: 'Palestra de Segurança Aplicada',
          roomName: 'Auditório Central',
          startsAt: new Date('2026-11-17T14:00:00Z'),
          endsAt: new Date('2026-11-17T16:00:00Z'),
          timezone: 'America/Bahia',
          token: 'PA-ABCD-EFGH',
          isActive: true,
          revokedAt: null,
          pinRequired: true,
          pinCode: '7391',
          totpEnabled: false,
          totpWindow: null,
          policy: normalizeSelfCheckinPolicy({
            enabled: true,
            requireGeo: true,
            geoRadiusMeters: 150,
          }),
          hasEventCoordinates: true,
          primaryColor: '#1d4ed8',
        },
        { includePin: true, generatedAt: new Date('2026-11-17T12:00:00Z') },
      );

      const text = pdf.toString('latin1');
      expect(text.startsWith('%PDF-1.4')).toBe(true);
      expect(text).toContain('xref');
      expect(text).toContain('%%EOF');
      expect(text).toContain('PA-ABCD-EFGH');
      expect(text).toContain('7391');
    });
  });
});
