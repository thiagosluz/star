/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — o cofre da chave da API por evento (FASE 72 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O MESMO COFRE DO LINK DA CARTA, COM RÓTULO PRÓPRIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `@/lib/crypto/sealed-secret-vault` é a implementação única de AES-256-GCM.
 *  Aqui ela nasce com o rótulo `eventflow:event-api-key:` — a chave derivada de
 *  um domínio não abre o selo do outro, embora o segredo de ambiente seja o mesmo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A VERIFICAÇÃO NÃO ABRE O SELO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem chega na rota manda a chave em claro; a conferência é SHA-256 contra o
 *  índice gravado (`chaveHash`), em tempo constante. Abrir o selo só é necessário
 *  para o organizador REEXIBIR a chave (fatia 3) — e é por isso que girar o
 *  `BETTER_AUTH_SECRET` não derruba as integrações já configuradas: a comparação
 *  por hash continua valendo; o que deixa de funcionar é reexibir a chave, e o
 *  serviço responde isso com uma frase honesta em vez de fingir.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CHAVE NUNCA É REGISTRADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nenhuma função deste arquivo loga. A trilha guarda o ÍNDICE (SHA-256) e o ato;
 *  o valor em claro só existe na memória da requisição e na resposta que o
 *  organizador copia.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { timingSafeEqual } from 'node:crypto';

import { EVENT_API_KEY_BYTES } from '@/domain/api/event-api-key-rules';
import { createSealedSecretVault } from '@/lib/crypto/sealed-secret-vault';

const vault = createSealedSecretVault({
  label: 'eventflow:event-api-key:',
  tokenBytes: EVENT_API_KEY_BYTES,
});

/** 192 bits de entropia, em base64url (32 caracteres, seguros em cabeçalho). */
export function createEventApiKeySecret(): string {
  return vault.createToken();
}

/** O índice de busca/comparação — SHA-256 em hexadecimal. */
export function hashEventApiKey(key: string): string {
  return vault.hashToken(key);
}

/** Sela a chave; `null` quando o segredo da aplicação não está utilizável. */
export function sealEventApiKey(key: string): string | null {
  return vault.seal(key);
}

/** Abre o selo para o organizador reexibir a chave; `null` = selo ilegível. */
export function openEventApiKey(sealed: string | null | undefined): string | null {
  return vault.open(sealed);
}

/**
 * Compara a chave apresentada com o índice gravado, em tempo constante.
 *
 * O hash tem 64 hexadecimais; um valor gravado em outro formato (truncado, com
 * maiúsculas, base64) não pode ser comparado e responde `false` — fail-closed.
 */
export function eventApiKeyMatchesHash(presented: string, storedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;

  const presentedHash = Buffer.from(hashEventApiKey(presented), 'hex');
  const stored = Buffer.from(storedHash, 'hex');

  if (presentedHash.length !== stored.length) return false;

  return timingSafeEqual(presentedHash, stored);
}

/**
 * Extrai a chave de `Authorization: Bearer <chave>`.
 *
 * A comparação do esquema é case-insensitive (RFC 6750), mas o valor não é
 * normalizado: espaço, aspas ou vírgula sobrando fazem a chave não bater — e é
 * melhor recusar do que "consertar" um cabeçalho malformado.
 */
export function extractBearerKey(header: string | null): string | null {
  if (!header) return null;

  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());

  return match?.[1] ?? null;
}
