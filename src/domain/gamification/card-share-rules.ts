/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Compartilhamento da carta
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TEXTO DO COMPARTILHAMENTO NÃO É MONTADO NA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É a mesma frase em todos os canais (WhatsApp, X, LinkedIn, Telegram, e-mail) e
 *  é ela que carrega o NOME PÚBLICO da pessoa escolhido por ela. Duas montagens —
 *  uma no botão e outra na prévia do link — divergiriam na primeira correção, e a
 *  divergência aqui é vazar o que a pessoa não autorizou.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE MÓDULO NUNCA RECEBE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  E-mail, XP, nível, álbum, instituição de origem da inscrição: nada disso entra
 *  porque nada disso é PARÂMETRO. A função recebe a carta, a instituição e o nome
 *  público — o que não está na assinatura não tem como escapar para o texto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { CardRarity } from '@/domain/gamification/types';
import { RARITY_LABELS } from '@/domain/gamification/card-rules';

export const SHARE_CHANNELS = ['whatsapp', 'x', 'linkedin', 'telegram', 'email'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export const SHARE_CHANNEL_LABELS: Readonly<Record<ShareChannel, string>> = {
  whatsapp: 'WhatsApp',
  x: 'X',
  linkedin: 'LinkedIn',
  telegram: 'Telegram',
  email: 'E-mail',
};

export interface ShareTextInput {
  cardName: string;
  rarity: CardRarity;
  tenantName: string;
  /**
   * Nome PÚBLICO já resolvido pelo serviço (`resolvePublicDisplayName`: o nome
   * escolhido ou o `@handle`). O domínio não sabe de onde ele veio de propósito —
   * quem decide o que é público é a FASE 44, não esta função.
   */
  displayName: string;
}

/**
 * A frase que acompanha o link.
 *
 * Curta porque é o que cabe numa mensagem: quem lê no grupo vê o nome, a carta, a
 * raridade e a instituição — os quatro fatos que a pessoa quer mostrar. Sem
 * "confira", sem "clique aqui" e sem emoji: texto de propaganda em link de coleção
 * parece spam e faz a pessoa não enviar.
 */
export function shareTextFor(input: ShareTextInput): string {
  const rarity = RARITY_LABELS[input.rarity] ?? input.rarity;
  return `${input.displayName} conquistou a carta ${input.cardName} (${rarity}) em ${input.tenantName}.`;
}

/**
 * Endereço público da carta compartilhada.
 *
 * O `baseUrl` vem do chamador (o domínio não conhece host nem protocolo) e o
 * token é opaco: o caminho NÃO carrega o id da carta nem o da pessoa, para que o
 * link não seja adivinhável nem sirva de chave para outra coisa.
 */
export function cardShareUrl(input: { baseUrl: string; tenantSlug: string; token: string }): string {
  const base = input.baseUrl.replace(/\/+$/, '');
  return `${base}/t/${input.tenantSlug}/carta/${input.token}`;
}

/**
 * URL de intenção de cada rede.
 *
 * Cada canal tem o seu formato, e nenhum deles é "abrir a rede e a pessoa cola":
 * a intenção já leva texto e link. O e-mail usa `mailto:` com `subject` e `body`
 * codificados — é o único canal em que a mensagem nasce com assunto.
 *
 * `linkedin` recebe só o link porque a rede ignora texto pré-preenchido na
 * partilha (comportamento documentado do `shareArticle`); mandar o texto mesmo
 * assim daria a impressão de que ele apareceria.
 */
export function shareIntent(
  channel: ShareChannel,
  payload: { url: string; text: string },
): string {
  const url = encodeURIComponent(payload.url);
  const text = encodeURIComponent(payload.text);

  switch (channel) {
    case 'whatsapp':
      return `https://wa.me/?text=${text}%20${url}`;
    case 'x':
      return `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
    case 'telegram':
      return `https://t.me/share/url?url=${url}&text=${text}`;
    case 'email':
      return `mailto:?subject=${text}&body=${url}`;
  }
}

/**
 * Token de compartilhamento: 16 bytes em base64url (22 caracteres).
 *
 * 128 bits de entropia aleatória. O tamanho não é estético: o link é a ÚNICA
 * credencial que abre a carta sem sessão, e um token curto seria atacável por
 * tentativa e erro. Não entra `userCardId` nem sequência de tempo — o endereço não
 * deve dizer nada além de "existe".
 */
export const SHARE_TOKEN_BYTES = 16;

/** O token colado no link pode vir com espaço ou quebra de linha; a barra admite. */
export function normalizeShareToken(raw: string): string {
  return raw.trim();
}

/** Formato aceito na LEITURA do link — recusar cedo evita consultar o banco à toa. */
export function isValidShareToken(raw: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(normalizeShareToken(raw));
}
