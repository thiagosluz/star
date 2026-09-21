/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Chaveiro do cofre de sementes (FASE 22, item G12)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ISTO FECHA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A chave que sela a semente do sorteio era DERIVADA de `BETTER_AUTH_SECRET`. Trocar
 *  esse segredo — rotação de credencial, resposta a incidente, troca de ambiente —
 *  tornava impossível abrir qualquer semente ainda selada: o sorteio continuava
 *  apurável (cai para o gerador do sistema), mas PERDIA a prova de commit-reveal, que
 *  é a razão de o cofre existir. A auditoria degradava em silêncio, exatamente no
 *  momento em que ela mais importa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO O CHAVEIRO RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `RAFFLE_SEED_KEYS` guarda VÁRIAS chaves, cada uma com um número de versão:
 *
 *      RAFFLE_SEED_KEYS="1:segredo-antigo...,2:segredo-novo..."
 *
 *  A versão ATUAL é a maior; os sorteios novos selam com ela e gravam a versão em
 *  `raffles."seedKeyVersion"`. Abrir uma semente usa a versão GRAVADA, não a atual —
 *  então girar a chave não invalida nada que já foi selado, e a chave antiga pode
 *  sair do arquivo depois que não houver mais semente selada com ela.
 *
 *  A versão `0` é reservada à chave LEGADA (derivada de `BETTER_AUTH_SECRET` com o
 *  mesmo rótulo de sempre): todo sorteio criado antes desta fase tem o selo nela, e a
 *  fórmula não pode mudar, ou o histórico inteiro de compromissos fica sem prova.
 *
 *  A leitura do arquivo é PURA (texto entra, chaveiro sai) porque é aqui que moram os
 *  erros silenciosos: uma vírgula a mais, um número repetido, um segredo curto. O
 *  chaveiro devolve os PROBLEMAS encontrados em vez de ignorar entradas inválidas —
 *  uma chave descartada em silêncio só apareceria na hora de abrir a semente, no palco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Versão da chave legada (derivada de `BETTER_AUTH_SECRET`). Nunca vem do arquivo. */
export const LEGACY_SEED_KEY_VERSION = 0;

/** Mesmo piso de `BETTER_AUTH_SECRET`: menos que isso é segredo de brinquedo. */
export const MIN_SEED_SECRET_LENGTH = 16;

export interface SeedKeyRing {
  /** Versão → segredo. */
  keys: ReadonlyMap<number, string>;
  /** Versão que os sorteios NOVOS usam (`null` = só a chave legada existe). */
  current: number | null;
  /** Entradas recusadas, com o motivo — para o log e para a tela de operação. */
  problems: readonly string[];
}

/**
 * Lê `RAFFLE_SEED_KEYS`.
 *
 * Formato: `versão:segredo`, separado por vírgula. O segredo pode conter `:` (a
 * divisão é no PRIMEIRO), porque segredo gerado por humano costuma ter.
 */
export function parseSeedKeyRing(raw: string | null | undefined): SeedKeyRing {
  const keys = new Map<number, string>();
  const problems: string[] = [];

  for (const entry of (raw ?? '').split(',')) {
    const text = entry.trim();
    if (text.length === 0) continue;

    const separator = text.indexOf(':');

    if (separator < 1) {
      problems.push(`Entrada "${truncate(text)}" ignorada: use o formato versão:segredo.`);
      continue;
    }

    const rawVersion = text.slice(0, separator).trim();
    const secret = text.slice(separator + 1);

    const version = Number(rawVersion);

    if (!Number.isInteger(version) || version < 1) {
      problems.push(
        `Entrada "${truncate(text)}" ignorada: a versão precisa ser um número inteiro a partir de 1 (a versão ${LEGACY_SEED_KEY_VERSION} é reservada à chave legada).`,
      );
      continue;
    }

    if (secret.length < MIN_SEED_SECRET_LENGTH) {
      problems.push(
        `Chave da versão ${version} ignorada: o segredo precisa ter ao menos ${MIN_SEED_SECRET_LENGTH} caracteres.`,
      );
      continue;
    }

    if (keys.has(version)) {
      problems.push(`Chave da versão ${version} repetida: vale a PRIMEIRA declarada.`);
      continue;
    }

    keys.set(version, secret);
  }

  const versions = [...keys.keys()];

  return {
    keys,
    current: versions.length > 0 ? Math.max(...versions) : null,
    problems,
  };
}

/** Rótulo humano da versão — para a trilha e para a tela de operação. */
export function seedKeyVersionLabel(version: number | null | undefined): string {
  if (version === null || version === undefined) return 'legada (BETTER_AUTH_SECRET)';

  return version === LEGACY_SEED_KEY_VERSION
    ? 'legada (BETTER_AUTH_SECRET)'
    : `versão ${version}`;
}

/**
 * A chave da versão pedida existe?
 *
 * Usado pela apuração para dizer, ANTES do palco, que uma semente não poderá ser
 * aberta — em vez de descobrir isso com o público esperando.
 */
export function keyRingHasVersion(ring: SeedKeyRing, version: number): boolean {
  return version === LEGACY_SEED_KEY_VERSION || ring.keys.has(version);
}

function truncate(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}…` : value;
}
