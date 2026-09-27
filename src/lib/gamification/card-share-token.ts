/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — token do link de carta: gerar, indexar e selar
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O TOKEN É SELADO, E NÃO GUARDADO EM CLARO NEM SÓ COMO HASH
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os dois extremos conhecidos do projeto não servem aqui:
 *
 *   • HASH (convite do palestrante, ADR-114) — o convite aparece UMA vez porque
 *     quem o entrega é o e-mail. O link da carta é do PRÓPRIO dono: se ele fechar
 *     a tela, precisa poder copiar de novo. Com hash, a única saída seria regerar
 *     — e regerar invalida o link que a pessoa acabou de publicar.
 *
 *   • CLARO (`registrations.badgeToken`) — o crachá é impresso em papel, e o
 *     segredo já circula fisicamente. O link não: guardá-lo em claro faria de
 *     qualquer leitura do banco (um relatório, um suporte, um despejo) uma lista
 *     de links prontos para abrir a coleção de alguém.
 *
 *  SELADO resolve os dois: o dono reexibe o link quando quiser (a aplicação abre
 *  o selo), e um vazamento do banco sozinho não abre nada — falta a chave.
 *
 *  O índice da leitura pública é o SHA-256 (`card_share_links.tokenHash`): achar a
 *  linha por hash não exige decifrar nada, e é o caminho que a página pública usa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CHAVE É DERIVADA, NÃO É A CHAVE DE SESSÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Mesmo desenho do cofre da semente do sorteio (`seed-vault.ts`): SHA-256 de um
 *  rótulo próprio + `BETTER_AUTH_SECRET`. O rótulo garante que vazar uma não
 *  compromete a outra, e usar o MESMO segredo evita uma variável de ambiente nova
 *  para uma feature que já depende do segredo para existir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { SHARE_TOKEN_BYTES } from '@/domain/gamification/card-share-rules';

const KEY_LABEL = 'eventflow:card-share:';
const ALGORITHM = 'aes-256-gcm';
/** 12 bytes é o tamanho de IV recomendado para GCM. */
const IV_LENGTH = 12;
/** Mesmo piso do cofre do sorteio: abaixo disso o segredo não protege nada. */
const MIN_SECRET_LENGTH = 16;

/** Entropia do token: 128 bits, em base64url (22 caracteres, seguros em URL). */
export function createShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

/** Índice da leitura pública — SHA-256 em hexadecimal. */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function sealingKey(): Buffer | null {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;

  return createHash('sha256').update(`${KEY_LABEL}${secret}`, 'utf8').digest();
}

/**
 * Sela o token: `iv.tag.cifra`, tudo em base64url.
 *
 * `null` quando não há segredo utilizável — e o chamador transforma isso em
 * recusa explícita ("o servidor não consegue guardar links agora"), em vez de
 * gravar o token em claro sem que ninguém perceba.
 */
export function sealShareToken(token: string): string | null {
  const key = sealingKey();
  if (!key) return null;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

/** Abre o selo. `null` quando o selo está corrompido ou a chave não está disponível. */
export function openShareToken(sealed: string | null | undefined): string | null {
  if (!sealed) return null;

  const key = sealingKey();
  if (!key) return null;

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
    return null;
  }
}
