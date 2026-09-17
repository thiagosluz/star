/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Assinatura de certificados
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A ASSINATURA GARANTE — E O QUE ELA NÃO GARANTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  GARANTE: que o conteúdo do documento foi produzido por quem detém a chave, e
 *  que ele não foi alterado depois. Basta recomputar o HMAC sobre o conteúdo
 *  canônico e comparar.
 *
 *  NÃO GARANTE: autoria perante terceiros que não confiam na instituição. HMAC é
 *  simétrico — quem verifica precisa do segredo (ou precisa confiar em quem
 *  verifica). Uma assinatura assimétrica (PKCS#7/CMS com X.509) permitiria
 *  validação offline por qualquer pessoa; ela exige uma autoridade certificadora
 *  e um cofre de chave privada, e está registrada como evolução (ver ADR).
 *
 *  O hash SHA-256 e a assinatura são calculados sobre o CONTEÚDO CANÔNICO, não
 *  sobre o arquivo: assim o mesmo certificado renderizado em PDF ou SVG continua
 *  verificável contra o mesmo hash, e o renderizador vira detalhe de apresentação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_SIGNATURE_ALG = 'HMAC-SHA256';

export interface SigningConfig {
  keyId: string;
  secret: string;
  alg: string;
}

/**
 * Lê a configuração de assinatura do ambiente.
 *
 * A leitura é LAZY (dentro da função) e não no topo do módulo: valores de
 * ambiente ausentes durante o build do Next.js já quebraram a compilação uma vez
 * nesta base (FASE 4, no cliente S3). Falhar ao emitir um certificado é aceitável;
 * falhar ao construir a aplicação não é.
 */
export function getSigningConfig(): SigningConfig {
  const keyId = process.env.CERTIFICATE_SIGNING_KEY_ID?.trim() || 'dev-key-local';
  const secret = process.env.CERTIFICATE_HMAC_SECRET?.trim() || '';

  return {
    keyId,
    secret,
    alg: process.env.CERTIFICATE_SIGNATURE_ALG?.trim() || DEFAULT_SIGNATURE_ALG,
  };
}

/** A assinatura está configurada com um segredo utilizável? */
export function isSigningConfigured(): boolean {
  const { secret } = getSigningConfig();
  return secret.length >= 16;
}

/**
 * Assina o hash do conteúdo canônico.
 *
 * O `keyId` entra na mensagem assinada: sem ele, trocar a chave sem trocar o
 * identificador produziria assinaturas indistinguíveis e a rotação de chaves
 * ficaria inauditável.
 */
export function signContentHash(input: {
  contentHash: string;
  keyId?: string;
  secret?: string;
}): string {
  const config = getSigningConfig();
  const keyId = input.keyId ?? config.keyId;
  const secret = input.secret ?? config.secret;

  if (!secret) {
    throw new Error(
      'CERTIFICATE_HMAC_SECRET não configurado: não é possível assinar certificados.',
    );
  }

  return createHmac('sha256', secret).update(`${keyId}.${input.contentHash}`, 'utf8').digest('base64');
}

/**
 * Verifica uma assinatura em tempo constante.
 *
 * `timingSafeEqual` (e não `===`) porque comparação de strings curtas vaza tempo
 * e permite, em tese, descobrir a assinatura byte a byte. O custo de usar a
 * comparação segura é zero.
 */
export function verifySignature(input: {
  contentHash: string;
  signature: string;
  keyId?: string;
  secret?: string;
}): boolean {
  try {
    const expected = signContentHash({
      contentHash: input.contentHash,
      keyId: input.keyId,
      secret: input.secret,
    });

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(input.signature, 'utf8');

    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Resumo curto para exibição no documento impresso.
 *
 * O hash completo (64 caracteres) é ilegível em papel; o impresso mostra o
 * prefixo e o rodapé, e a página pública exibe o valor completo para conferência.
 */
export function shortHash(contentHash: string, size = 16): string {
  return contentHash.slice(0, size);
}
