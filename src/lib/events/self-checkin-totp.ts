/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CRIANÇA / VERIFICAÇÃO DE TOTP PARA MODO TELÃO (FASE 113)
 *
 *  Gera códigos temporários de 6 dígitos com passo de 60 segundos usando HMAC-SHA256
 *  sobre um segredo aleatório exclusivo do ponto de presença. Aceita o passo atual e
 *  o anterior (±1 janela) para absorver latência de rede ou virada do relógio durante
 *  a digitação no celular.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { TOTP_PERIOD_SECONDS, normalizePinInput } from '@/domain/events/self-checkin-rules';

export function generateTotpSecret(): string {
  return randomBytes(20).toString('hex');
}

export function computeTotpAtStep(secret: string, step: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(Math.max(0, step)), 0);
  const digest = createHmac('sha256', Buffer.from(secret, 'utf8')).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

export function currentTotpWindow(
  secret: string,
  now: Date = new Date(),
): { code: string; remainingSeconds: number; periodSeconds: number } {
  const totalSeconds = Math.floor(now.getTime() / 1000);
  const step = Math.floor(totalSeconds / TOTP_PERIOD_SECONDS);
  const remainingSeconds = TOTP_PERIOD_SECONDS - (totalSeconds % TOTP_PERIOD_SECONDS);

  return {
    code: computeTotpAtStep(secret, step),
    remainingSeconds,
    periodSeconds: TOTP_PERIOD_SECONDS,
  };
}

export function safeComparePin(expected: string | null | undefined, provided: string | null | undefined): boolean {
  const normExpected = normalizePinInput(expected);
  const normProvided = normalizePinInput(provided);
  if (!normExpected || !normProvided || normExpected.length !== normProvided.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(normExpected, 'utf8'), Buffer.from(normProvided, 'utf8'));
}

export function verifyTotpCode(
  secret: string | null | undefined,
  providedCode: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!secret) return false;
  const normalized = normalizePinInput(providedCode);
  if (!normalized || normalized.length !== 6) return false;

  const totalSeconds = Math.floor(now.getTime() / 1000);
  const currentStep = Math.floor(totalSeconds / TOTP_PERIOD_SECONDS);

  for (const step of [currentStep, currentStep - 1, currentStep + 1]) {
    const candidate = computeTotpAtStep(secret, step);
    if (timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(normalized, 'utf8'))) {
      return true;
    }
  }
  return false;
}
