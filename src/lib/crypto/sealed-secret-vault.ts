/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INFRAESTRUTURA — o cofre de segredos selados (AES-256-GCM), UM só
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE (FASE 72 · fatia 2)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O link da carta (FASE 48) já tinha o desenho certo: o segredo é SELADO com
 *  AES-256-GCM, o índice público é o SHA-256 e a chave de selagem é DERIVADA do
 *  `BETTER_AUTH_SECRET` com um rótulo próprio. A chave da API por evento precisa
 *  exatamente do mesmo desenho — o organizador reexibe a chave, o banco sozinho
 *  não a abre.
 *
 *  A alternativa fácil seria copiar `card-share-token.ts` para um segundo arquivo
 *  e trocar o rótulo. Isso é um SEGUNDO cofre: duas implementações de criptografia
 *  divergem no primeiro ajuste (um passa a usar IV de 16 bytes, o outro continua
 *  com 12; um valida o tag, o outro esquece), e a que ficou para trás só é
 *  descoberta no dia em que o segredo vaza. Aqui o mecanismo mora em UM lugar e
 *  cada domínio tem o seu RÓTULO — rótulos diferentes garantem que vazar a chave
 *  derivada de um não comprometa o outro.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE MÓDULO NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não lê banco, não lê relógio e não decide política: `seal` devolve `null`
 *  quando não há segredo utilizável, e quem chama transforma isso em recusa
 *  explícita (nunca em "guardei em claro"). `open` devolve `null` para selo
 *  corrompido, adulterado ou de outra chave — o fail-closed do cofre.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
/** 12 bytes é o tamanho de IV recomendado para GCM. */
const IV_LENGTH = 12;
/** Abaixo disso o segredo não protege nada — o mesmo piso do cofre do sorteio. */
const MIN_SECRET_LENGTH = 16;

export interface SealedSecretVault {
  /** O segredo em claro, com entropia de `tokenBytes` (base64url). */
  createToken(): string;
  /** O índice de busca/compare — SHA-256 em hexadecimal. */
  hashToken(token: string): string;
  /** `iv.tag.cifra` em base64url, ou `null` sem segredo utilizável. */
  seal(token: string): string | null;
  /** Abre o selo; `null` quando corrompido/adulterado ou sem chave. */
  open(sealed: string | null | undefined): string | null;
}

export interface SealedSecretVaultOptions {
  /**
   * O rótulo do domínio, incluindo os dois-pontos finais (ex.:
   * `"eventflow:card-share:"`). Ele entra na derivação da chave e é a fronteira
   * entre os cofres: o mesmo `BETTER_AUTH_SECRET` produz chaves diferentes.
   */
  label: string;
  /** Entropia do segredo em claro. */
  tokenBytes: number;
}

export function createSealedSecretVault(options: SealedSecretVaultOptions): SealedSecretVault {
  function sealingKey(): Buffer | null {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret || secret.length < MIN_SECRET_LENGTH) return null;

    return createHash('sha256').update(`${options.label}${secret}`, 'utf8').digest();
  }

  return {
    createToken() {
      return randomBytes(options.tokenBytes).toString('base64url');
    },

    hashToken(token) {
      return createHash('sha256').update(token, 'utf8').digest('hex');
    },

    seal(token) {
      const key = sealingKey();
      if (!key) return null;

      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();

      return [
        iv.toString('base64url'),
        tag.toString('base64url'),
        encrypted.toString('base64url'),
      ].join('.');
    },

    open(sealed) {
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
    },
  };
}
