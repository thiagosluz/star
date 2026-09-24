/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Token de convite (compartilhado)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO SAIU DO MÓDULO DO PALESTRANTE (FASE 42)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O convite do portal do palestrante (FASE 25) e o convite do patrocinador (FASE
 *  42) fazem a MESMA coisa: um código que prova a posse de um endereço, guardado
 *  como hash, com prazo e um único pendente por destinatário. Duas cópias do
 *  gerador divergiriam no primeiro ajuste — e divergir aqui significa que um dos
 *  dois convites passa a ser mais fácil de adivinhar que o outro.
 *
 *  O alfabeto, o tamanho e o prazo continuam sendo os mesmos do portal do
 *  palestrante: `speaker-rules.ts` reexporta o que exportava, então nenhum
 *  chamador antigo mudou.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash, randomBytes } from 'node:crypto';

/** Validade do convite: 30 dias. Regerar é barato; um link eterno, não. */
export const INVITE_TTL_DAYS = 30;

/**
 * Alfabeto SEM `I`, `O`, `0` e `1`: o código vai ser ditado por telefone ou
 * copiado de um papel, e a confusão entre `l`/`1` e `O`/`0` é o defeito clássico
 * de código impresso (a mesma razão do alfabeto do código de validação de
 * certificado).
 */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const INVITE_TOKEN_LENGTH = 32;

/**
 * Token de convite.
 *
 * 32 caracteres de um alfabeto de 32 símbolos = 160 bits.
 */
export function generateInviteToken(randomChar: (max: number) => number): string {
  let token = '';
  for (let index = 0; index < INVITE_TOKEN_LENGTH; index += 1) {
    token += INVITE_ALPHABET[randomChar(INVITE_ALPHABET.length)];
  }
  return token;
}

/** Token novo, com `randomBytes` criptográfico (nunca `Math.random`). */
export function newInviteToken(): string {
  /**
   * `byte % 32` é uniforme aqui porque 256 é divisível pelo tamanho do alfabeto
   * (32). Com um alfabeto de tamanho que não divide 256, o resto introduziria
   * viés — e viés em token de convite é entropia a menos.
   */
  const bytes = randomBytes(INVITE_TOKEN_LENGTH);
  let token = '';
  for (const byte of bytes) {
    token += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  }
  return token;
}

/** SHA-256 do token em hexadecimal — é o que vai para o banco. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token.trim().toUpperCase(), 'utf8').digest('hex');
}

export function normalizeInviteToken(token: string): string {
  return token.replace(/[\s-]/g, '').toUpperCase();
}

export function inviteExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function isInviteExpired(expiresAt: Date | null | undefined, now: Date): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now.getTime();
}
