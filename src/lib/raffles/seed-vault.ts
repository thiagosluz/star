/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  COFRE DA SEMENTE DO SORTEIO (FASE 16, item G4 — commit-reveal)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FALTAVA NA AUDITORIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O hash do resultado prova que o registro não foi ALTERADO depois da apuração.
 *  Ele não prova que a apuração aconteceu depois do fechamento do credenciamento:
 *  quem tivesse acesso ao banco poderia apurar, ver quem ganhou e "refazer" até
 *  gostar do resultado — e o hash da última tentativa conferiria perfeitamente.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO O COMPROMISSO FECHA ESSA PORTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. Na CRIAÇÃO do sorteio (antes de existir elegível), o sistema gera uma
 *       semente aleatória de 32 bytes e publica `sha256(semente)` — o COMPROMISSO.
 *       Ele já fica visível na tela e na trilha, com data.
 *    2. A semente é guardada SELADA (AES-256-GCM) no banco: um dump do banco não
 *       revela a semente, então nem quem lê a tabela consegue prever o resultado.
 *    3. Na APURAÇÃO a semente é aberta, usada como fonte do sorteio e REVELADA no
 *       resultado. Qualquer pessoa confere: `sha256(semente revelada)` é igual ao
 *       compromisso publicado ANTES, e o resultado se reproduz rodando o sorteio
 *       com a mesma semente (ver `createSeededRandomInt` no domínio).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DE ONDE VEM A CHAVE DE SELAGEM (FASE 22, item G12)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A chave tem VERSÃO, e o sorteio grava qual usou (`raffles."seedKeyVersion"`).
 *  Abrir a semente usa a versão GRAVADA — nunca a atual —, e é isso que permite girar
 *  a chave sem invalidar o compromisso de sorteios já selados. Antes disso a chave era
 *  sempre derivada de `BETTER_AUTH_SECRET`, e trocar o segredo apagava a prova de todo
 *  o histórico em silêncio (a apuração caía para o gerador do sistema).
 *
 *    • versão `0` = LEGADA: `sha256('eventflow:raffle-seed:' + BETTER_AUTH_SECRET)`.
 *      A fórmula é a mesma de antes desta fase, byte a byte, porque é ela que abre os
 *      sorteios criados até aqui — mudá-la invalidaria o histórico inteiro.
 *    • versão `n ≥ 1` = `RAFFLE_SEED_KEYS`, no formato `versão:segredo` (F22/ADR-137).
 *      A versão ATUAL é a maior declarada, e é a que os sorteios novos usam.
 *
 *  O rótulo garante que a chave do cofre NÃO é a chave de assinatura de sessão —
 *  vazar uma não compromete a outra.
 *
 *  Sem chave nenhuma (ambiente de teste, por exemplo), o sorteio continua funcionando
 *  com o gerador do sistema e SEM compromisso — o serviço registra a ausência e a tela
 *  explica. Auditoria degradada e declarada é melhor que auditoria que finge existir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import {
  LEGACY_SEED_KEY_VERSION,
  MIN_SEED_SECRET_LENGTH,
  parseSeedKeyRing,
  seedKeyVersionLabel,
  type SeedKeyRing,
} from '@/domain/raffles/seed-key-rules';

const KEY_LABEL = 'eventflow:raffle-seed:';
const ALGORITHM = 'aes-256-gcm';
/** 12 bytes é o tamanho de IV recomendado para GCM. */
const IV_LENGTH = 12;

let warnedMissingSecret = false;

/** O chaveiro declarado em `RAFFLE_SEED_KEYS` (lido a cada uso: env não é cache). */
export function seedKeyRing(): SeedKeyRing {
  return parseSeedKeyRing(process.env.RAFFLE_SEED_KEYS);
}

/** A chave legada (`BETTER_AUTH_SECRET`) está disponível e é utilizável? */
function legacySecret(): string | null {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret || secret.length < MIN_SEED_SECRET_LENGTH) return null;

  return secret;
}

/**
 * Versão que os sorteios NOVOS usam.
 *
 * `RAFFLE_SEED_KEYS` vence o segredo de sessão quando existe: quem declarou um
 * chaveiro está dizendo que quer girar chave, e continuar selando com a legada
 * manteria a dependência que a fase veio remover.
 */
export function currentSeedKeyVersion(): number | null {
  const ring = seedKeyRing();
  if (ring.current !== null) return ring.current;

  return legacySecret() ? LEGACY_SEED_KEY_VERSION : null;
}

/** O cofre está configurado? (o mesmo teste que a assinatura de certificado faz) */
export function isSeedVaultConfigured(): boolean {
  return currentSeedKeyVersion() !== null;
}

/**
 * Situação do cofre, para a tela de operação dizer o que esperar.
 *
 * `problems` sai da leitura do chaveiro: entrada malformada, segredo curto, versão
 * repetida. Sem isso, um erro de digitação na variável de ambiente só apareceria na
 * hora de abrir a semente — no palco, com o público esperando.
 */
export function seedVaultStatus(): {
  configured: boolean;
  currentVersion: number | null;
  currentVersionLabel: string;
  versions: number[];
  problems: readonly string[];
} {
  const ring = seedKeyRing();
  const current = currentSeedKeyVersion();

  return {
    configured: current !== null,
    currentVersion: current,
    currentVersionLabel: seedKeyVersionLabel(current),
    versions: [...ring.keys.keys()].sort((a, b) => a - b),
    problems: ring.problems,
  };
}

/**
 * Deriva a chave da versão pedida.
 *
 * `null` quando a versão não está disponível (chave girada e removida do arquivo, ou
 * segredo legado ausente) — e o chamador transforma isso em "não há prova a abrir".
 */
function sealingKey(version: number): Buffer | null {
  if (version === LEGACY_SEED_KEY_VERSION) {
    const secret = legacySecret();

    if (!secret) {
      if (!warnedMissingSecret) {
        warnedMissingSecret = true;
        console.warn(
          '[raffles] BETTER_AUTH_SECRET ausente ou curto: o sorteio roda sem compromisso de semente (auditoria degradada).',
        );
      }

      return null;
    }

    /**
     * A fórmula legada NÃO muda: é ela que abre todo selo gravado antes da FASE 22.
     * A nova (versão ≥ 1) inclui a versão no rótulo, então as duas nunca colidem.
     */
    return createHash('sha256').update(`${KEY_LABEL}${secret}`, 'utf8').digest();
  }

  const secret = seedKeyRing().keys.get(version);
  if (!secret) return null;

  return createHash('sha256').update(`${KEY_LABEL}v${version}:${secret}`, 'utf8').digest();
}

/** Semente nova: 32 bytes em hexadecimal (o mesmo tamanho de um SHA-256). */
export function createRaffleSeed(): string {
  return randomBytes(32).toString('hex');
}

export interface SealedSeed {
  /** `iv.authTag.ciphertext`, tudo em base64url. */
  sealed: string;
  /** Versão da chave usada — gravada no sorteio e necessária para abrir. */
  keyVersion: number;
}

/**
 * Sela a semente com a chave ATUAL: `iv.authTag.ciphertext`, tudo em base64url.
 *
 * O GCM autentica o conteúdo: um `seedSealed` alterado no banco não decifra, e o
 * erro aparece na apuração em vez de produzir um resultado silenciosamente errado.
 *
 * A versão sai JUNTO do selo de propósito: quem grava tem de gravar as duas, e um
 * retorno único (`string | null`) tornaria possível selar com a versão nova e gravar
 * a antiga — o defeito exato que a FASE 22 veio fechar.
 */
export function sealSeed(seed: string): SealedSeed | null {
  const version = currentSeedKeyVersion();
  if (version === null) return null;

  const key = sealingKey(version);
  if (!key) return null;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(seed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    sealed: [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(
      '.',
    ),
    keyVersion: version,
  };
}

/**
 * Abre a semente selada com a versão GRAVADA no sorteio.
 *
 * `keyVersion` ausente/`null` (linha anterior à FASE 22) é lida como versão legada —
 * é o que o banco dizia implicitamente, porque não havia outra chave possível.
 *
 * `null` quando o selo está ausente, corrompido, ou quando a chave daquela versão não
 * está mais disponível.
 */
export function unsealSeed(
  sealed: string | null | undefined,
  keyVersion?: number | null,
): string | null {
  if (!sealed) return null;

  const version = keyVersion ?? LEGACY_SEED_KEY_VERSION;
  const key = sealingKey(version);

  if (!key) {
    console.warn(
      `[raffles] chave do cofre (${seedKeyVersionLabel(version)}) indisponível: a semente selada não pode ser aberta.`,
    );
    return null;
  }

  const [ivPart, tagPart, dataPart] = sealed.split('.');
  if (!ivPart || !tagPart || !dataPart) return null;

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch {
    // Selo adulterado ou chave trocada: a apuração cai para o gerador do sistema em
    // vez de abortar com o público esperando no palco.
    console.warn('[raffles] não foi possível abrir a semente selada; usando gerador do sistema.');
    return null;
  }
}
