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
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A IMPLEMENTAÇÃO MUDOU DE LUGAR NA FASE 72
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O mecanismo (AES-GCM + IV + tag + derivação por rótulo) foi extraído para
 *  `@/lib/crypto/sealed-secret-vault` quando a chave da API por evento passou a
 *  precisar do MESMO cofre. Este arquivo continua com o MESMO comportamento e o
 *  MESMO rótulo (`eventflow:card-share:`) — os links já emitidos continuam
 *  abrindo. O que ele deixou de ter é a segunda implementação de criptografia.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createSealedSecretVault } from '@/lib/crypto/sealed-secret-vault';
import { SHARE_TOKEN_BYTES } from '@/domain/gamification/card-share-rules';

/** Entropia do token: 128 bits, em base64url (22 caracteres, seguros em URL). */
const vault = createSealedSecretVault({
  label: 'eventflow:card-share:',
  tokenBytes: SHARE_TOKEN_BYTES,
});

export function createShareToken(): string {
  return vault.createToken();
}

/** Índice da leitura pública — SHA-256 em hexadecimal. */
export function hashShareToken(token: string): string {
  return vault.hashToken(token);
}

/**
 * Sela o token: `iv.tag.cifra`, tudo em base64url.
 *
 * `null` quando não há segredo utilizável — e o chamador transforma isso em
 * recusa explícita ("o servidor não consegue guardar links agora"), em vez de
 * gravar o token em claro sem que ninguém perceba.
 */
export function sealShareToken(token: string): string | null {
  return vault.seal(token);
}

/** Abre o selo. `null` quando o selo está corrompido ou a chave não está disponível. */
export function openShareToken(sealed: string | null | undefined): string | null {
  return vault.open(sealed);
}
