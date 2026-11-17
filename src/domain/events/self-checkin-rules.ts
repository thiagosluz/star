/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Autocredenciamento e autocheck-in com verificações antifraude (FASE 113)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM CARTAZ IMPRESSO EXIGE DEFESA EM CAMADAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um QR Code impresso em papel é estático por definição: quem o fotografa na porta
 *  pode enviá-lo por mensagem para alguém fora do evento. Para equilibrar autonomia
 *  no local e integridade de certificados, XP e sorteios, a verificação é composta
 *  por regras puras independentes de infraestrutura:
 *
 *    1. Token opaco e revogável (`PA-XXXX-XXXX`) — nunca expõe id de banco nem dado
 *       pessoal e pode ser regenerado em 1 clique caso um cartaz vaze;
 *    2. Geofencing por distância esférica (Haversine) + piso de precisão (`accuracy`),
 *       evitando que geolocalização grosseira por IP em outra cidade passe como GPS;
 *    3. PIN presencial de sala (para cartazes impressos, falado ou escrito no quadro)
 *       e/ou código rotativo TOTP de 60 s para projeção em telão;
 *    4. Anti-ubiquidade física (impede presença simultânea aberta em duas atividades
 *       no mesmo instante) e cooldown mínimo contra check-out acidental por clique duplo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const SELF_CHECKIN_TOKEN_PREFIX = 'PA';
export const SELF_CHECKIN_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const SELF_CHECKIN_GROUPS = 2;
export const SELF_CHECKIN_GROUP_SIZE = 4;
export const SELF_CHECKIN_RANDOM_LENGTH = SELF_CHECKIN_GROUPS * SELF_CHECKIN_GROUP_SIZE;

export const MIN_GEO_RADIUS_METERS = 30;
export const MAX_GEO_RADIUS_METERS = 5000;
export const DEFAULT_GEO_RADIUS_METERS = 200;

export const MIN_GEO_ACCURACY_METERS = 50;
export const MAX_GEO_ACCURACY_METERS = 2000;
export const DEFAULT_GEO_ACCURACY_METERS = 300;

export const MIN_CHECKOUT_COOLDOWN_MINUTES = 0;
export const MAX_CHECKOUT_COOLDOWN_MINUTES = 60;
export const DEFAULT_CHECKOUT_COOLDOWN_MINUTES = 2;

export const TOTP_PERIOD_SECONDS = 60;

const TRIVIAL_PINS = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321']);

export function formatSelfCheckinToken(randomChars: string): string {
  const groups: string[] = [];
  for (let index = 0; index < SELF_CHECKIN_GROUPS; index += 1) {
    groups.push(
      randomChars.slice(index * SELF_CHECKIN_GROUP_SIZE, (index + 1) * SELF_CHECKIN_GROUP_SIZE),
    );
  }
  return `${SELF_CHECKIN_TOKEN_PREFIX}-${groups.join('-')}`;
}

export function generateSelfCheckinToken(randomInt: (max: number) => number): string {
  let chars = '';
  for (let index = 0; index < SELF_CHECKIN_RANDOM_LENGTH; index += 1) {
    const draw = Math.max(
      0,
      Math.min(randomInt(SELF_CHECKIN_ALPHABET.length), SELF_CHECKIN_ALPHABET.length - 1),
    );
    chars += SELF_CHECKIN_ALPHABET[draw]!;
  }
  return formatSelfCheckinToken(chars);
}

export function normalizeSelfCheckinToken(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const withoutPrefix =
    cleaned.startsWith(SELF_CHECKIN_TOKEN_PREFIX) &&
    cleaned.length === SELF_CHECKIN_TOKEN_PREFIX.length + SELF_CHECKIN_RANDOM_LENGTH
      ? cleaned.slice(SELF_CHECKIN_TOKEN_PREFIX.length)
      : cleaned;

  if (withoutPrefix.length !== SELF_CHECKIN_RANDOM_LENGTH) return null;
  if (![...withoutPrefix].every((char) => SELF_CHECKIN_ALPHABET.includes(char))) return null;

  return formatSelfCheckinToken(withoutPrefix);
}

/** Sorteia um PIN numérico de 4 dígitos evitando combinações triviais de adivinhar. */
export function generateRoomPin(randomInt: (max: number) => number): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const num = 1000 + Math.max(0, Math.min(randomInt(9000), 8999));
    const candidate = String(num).padStart(4, '0');
    if (!TRIVIAL_PINS.has(candidate)) {
      return candidate;
    }
  }
  return '4827';
}

/** Normaliza PIN informado pelo usuário (4 dígitos de cartaz ou 6 dígitos do telão). */
export function normalizePinInput(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (/^\d{4}$/.test(digits) || /^\d{6}$/.test(digits)) {
    return digits;
  }
  return null;
}

export interface SelfCheckinPolicy {
  enabled: boolean;
  requireGeo: boolean;
  geoRadiusMeters: number;
  maxAccuracyMeters: number;
  requireEventArrivalBeforeActivity: boolean;
  blockConcurrentActivity: boolean;
  allowUnregistered: boolean;
  checkoutCooldownMinutes: number;
}

export const DEFAULT_SELF_CHECKIN_POLICY: SelfCheckinPolicy = {
  enabled: false,
  requireGeo: false,
  geoRadiusMeters: DEFAULT_GEO_RADIUS_METERS,
  maxAccuracyMeters: DEFAULT_GEO_ACCURACY_METERS,
  requireEventArrivalBeforeActivity: false,
  blockConcurrentActivity: true,
  allowUnregistered: false,
  checkoutCooldownMinutes: DEFAULT_CHECKOUT_COOLDOWN_MINUTES,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

export function normalizeSelfCheckinPolicy(
  raw: Partial<Record<keyof SelfCheckinPolicy, unknown>> | null | undefined,
): SelfCheckinPolicy {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SELF_CHECKIN_POLICY };
  }

  return {
    enabled: raw.enabled === true,
    requireGeo: raw.requireGeo === true,
    geoRadiusMeters: clampInt(
      raw.geoRadiusMeters,
      MIN_GEO_RADIUS_METERS,
      MAX_GEO_RADIUS_METERS,
      DEFAULT_GEO_RADIUS_METERS,
    ),
    maxAccuracyMeters: clampInt(
      raw.maxAccuracyMeters,
      MIN_GEO_ACCURACY_METERS,
      MAX_GEO_ACCURACY_METERS,
      DEFAULT_GEO_ACCURACY_METERS,
    ),
    requireEventArrivalBeforeActivity: raw.requireEventArrivalBeforeActivity === true,
    blockConcurrentActivity: raw.blockConcurrentActivity !== false,
    allowUnregistered: raw.allowUnregistered === true,
    checkoutCooldownMinutes: clampInt(
      raw.checkoutCooldownMinutes,
      MIN_CHECKOUT_COOLDOWN_MINUTES,
      MAX_CHECKOUT_COOLDOWN_MINUTES,
      DEFAULT_CHECKOUT_COOLDOWN_MINUTES,
    ),
  };
}

export function parseSelfCheckinPolicy(settings: unknown): SelfCheckinPolicy {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ...DEFAULT_SELF_CHECKIN_POLICY };
  }
  const bag = (settings as Record<string, unknown>).selfCheckin;
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) {
    return { ...DEFAULT_SELF_CHECKIN_POLICY };
  }
  return normalizeSelfCheckinPolicy(bag as Partial<Record<keyof SelfCheckinPolicy, unknown>>);
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

const EARTH_RADIUS_METERS = 6_371_000;

/** Distância geodésica em metros (fórmula de Haversine). */
export function haversineDistanceMeters(origin: GeoPoint, target: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(target.latitude - origin.latitude);
  const dLon = toRad(target.longitude - origin.longitude);
  const lat1 = toRad(origin.latitude);
  const lat2 = toRad(target.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c);
}

export type GeofenceEvaluation =
  | { ok: true; skipped: boolean; distanceMeters: number | null }
  | {
      ok: false;
      code:
        | 'EVENT_LOCATION_MISSING'
        | 'GEO_REQUIRED'
        | 'GEO_INVALID'
        | 'GEO_ACCURACY_LOW'
        | 'OUT_OF_GEOFENCE';
      distanceMeters: number | null;
      message: string;
    };

export function evaluateGeofenceCheck(input: {
  policy: SelfCheckinPolicy;
  eventCoords: GeoPoint | null;
  participantCoords: GeoPoint | null;
  accuracyMeters?: number | null;
}): GeofenceEvaluation {
  const { policy, eventCoords, participantCoords, accuracyMeters } = input;

  const bothValid =
    eventCoords !== null &&
    isValidCoordinate(eventCoords.latitude, eventCoords.longitude) &&
    participantCoords !== null &&
    isValidCoordinate(participantCoords.latitude, participantCoords.longitude);

  const measured = bothValid ? haversineDistanceMeters(eventCoords, participantCoords) : null;

  if (!policy.requireGeo) {
    return { ok: true, skipped: true, distanceMeters: measured };
  }

  if (!eventCoords || !isValidCoordinate(eventCoords.latitude, eventCoords.longitude)) {
    return {
      ok: false,
      code: 'EVENT_LOCATION_MISSING',
      distanceMeters: null,
      message:
        'Este evento exige localização, mas a organização ainda não definiu as coordenadas do local.',
    };
  }

  if (!participantCoords) {
    return {
      ok: false,
      code: 'GEO_REQUIRED',
      distanceMeters: null,
      message:
        'Autorize o compartilhamento da sua localização (GPS) para confirmar que você está no local do evento.',
    };
  }

  if (!isValidCoordinate(participantCoords.latitude, participantCoords.longitude)) {
    return {
      ok: false,
      code: 'GEO_INVALID',
      distanceMeters: null,
      message: 'As coordenadas recebidas do dispositivo são inválidas.',
    };
  }

  if (
    typeof accuracyMeters === 'number' &&
    Number.isFinite(accuracyMeters) &&
    accuracyMeters > policy.maxAccuracyMeters
  ) {
    return {
      ok: false,
      code: 'GEO_ACCURACY_LOW',
      distanceMeters: measured,
      message: `A precisão atual do GPS (${Math.round(accuracyMeters)} m) é insuficiente para validar presença (máximo aceito: ${policy.maxAccuracyMeters} m). Tente usar o celular com GPS ativo.`,
    };
  }

  if (measured !== null && measured > policy.geoRadiusMeters) {
    return {
      ok: false,
      code: 'OUT_OF_GEOFENCE',
      distanceMeters: measured,
      message: `Você está a ${measured} m do local do evento (raio permitido: ${policy.geoRadiusMeters} m). Aproxime-se do local e tente novamente.`,
    };
  }

  return { ok: true, skipped: false, distanceMeters: measured };
}

export type AntiUbiquityEvaluation =
  | { ok: true }
  | { ok: false; code: 'CONCURRENT_ACTIVITY_OPEN'; blockingActivityTitle: string; message: string };

/**
 * Impede que a pessoa abra sessão em uma segunda atividade enquanto mantém outra
 * atividade em aberto (não permite "estar em dois lugares ao mesmo tempo").
 */
export function evaluateAntiUbiquity(input: {
  blockConcurrentActivity: boolean;
  targetActivityId: string | null;
  openActivities: readonly { activityId: string; title: string }[];
}): AntiUbiquityEvaluation {
  if (!input.blockConcurrentActivity || input.targetActivityId === null) {
    return { ok: true };
  }

  const conflict = input.openActivities.find((item) => item.activityId !== input.targetActivityId);
  if (!conflict) {
    return { ok: true };
  }

  return {
    ok: false,
    code: 'CONCURRENT_ACTIVITY_OPEN',
    blockingActivityTitle: conflict.title,
    message: `Você já possui uma presença em aberto em "${conflict.title}". Registre a saída lá antes de fazer autocheck-in em outra atividade.`,
  };
}

export function evaluateCheckoutCooldown(input: {
  checkedInAt: Date;
  now: Date;
  cooldownMinutes: number;
}): { allowed: boolean; waitSeconds: number } {
  const thresholdMs = Math.max(0, input.cooldownMinutes) * 60_000;
  const elapsedMs = input.now.getTime() - input.checkedInAt.getTime();
  if (elapsedMs >= thresholdMs) {
    return { allowed: true, waitSeconds: 0 };
  }
  return {
    allowed: false,
    waitSeconds: Math.max(1, Math.ceil((thresholdMs - elapsedMs) / 1000)),
  };
}
