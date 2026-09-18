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
 *  DE ONDE VEM A CHAVE DE SELAGEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  De `BETTER_AUTH_SECRET`, derivada com um rótulo próprio (`sha256('eventflow:
 *  raffle-seed:' + segredo)`). Não é preguiça de criar variável nova: o segredo já é
 *  obrigatório e já é o segredo-mestre do processo, e uma variável a mais é uma
 *  variável a mais para alguém esquecer de configurar em produção. O rótulo garante
 *  que a chave do cofre NÃO é a chave de assinatura de sessão — vazar uma não
 *  compromete a outra.
 *
 *  Sem o segredo configurado (ambiente de teste, por exemplo), o sorteio continua
 *  funcionando com o gerador do sistema e SEM compromisso — o serviço registra a
 *  ausência e a tela explica. Auditoria degradada e declarada é melhor que auditoria
 *  que finge existir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const KEY_LABEL = 'eventflow:raffle-seed:';
const ALGORITHM = 'aes-256-gcm';
/** 12 bytes é o tamanho de IV recomendado para GCM. */
const IV_LENGTH = 12;

let warnedMissingSecret = false;

/** O cofre está configurado? (o mesmo teste que a assinatura de certificado faz) */
export function isSeedVaultConfigured(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 16);
}

function sealingKey(): Buffer | null {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret || secret.length < 16) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn(
        '[raffles] BETTER_AUTH_SECRET ausente ou curto: o sorteio roda sem compromisso de semente (auditoria degradada).',
      );
    }

    return null;
  }

  return createHash('sha256').update(`${KEY_LABEL}${secret}`, 'utf8').digest();
}

/** Semente nova: 32 bytes em hexadecimal (o mesmo tamanho de um SHA-256). */
export function createRaffleSeed(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Sela a semente: `iv.authTag.ciphertext`, tudo em base64url.
 *
 * O GCM autentica o conteúdo: um `seedSealed` alterado no banco não decifra, e o
 * erro aparece na apuração em vez de produzir um resultado silenciosamente errado.
 */
export function sealSeed(seed: string): string | null {
  const key = sealingKey();
  if (!key) return null;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(seed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(
    '.',
  );
}

/** Abre a semente selada. `null` quando o selo está ausente, corrompido ou sem chave. */
export function unsealSeed(sealed: string | null | undefined): string | null {
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
    // Selo adulterado ou chave trocada: a apuração cai para o gerador do sistema em
    // vez de abortar com o público esperando no palco.
    console.warn('[raffles] não foi possível abrir a semente selada; usando gerador do sistema.');
    return null;
  }
}
