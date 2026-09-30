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
import {
  instantToZonedWallTime,
  zonedWallTimeToInstant,
} from '@/domain/events/scheduling-rules';

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

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  VALIDADE DO LINK — dívida E70 (FASE 51)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O PADRÃO É **NÃO EXPIRAR**
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O link é a CARTA DA PESSOA, e um endereço que morre sozinho é pior do que um
 *  endereço antigo: quem colou a carta no currículo, no Lattes ou no portfólio
 *  descobriria o link quebrado meses depois, sem ter feito nada. Expirar é uma
 *  ESCOLHA de quem cria — faz sentido para o que circula numa campanha, num
 *  processo seletivo, num evento com data —, então o prazo é oferecido com "sem
 *  prazo" como PRIMEIRA opção e é ela que nasce marcada.
 *
 *  Pela mesma razão não existe limite de ABERTURAS: cortar o link na terceira
 *  visita puniria justamente a carta que mais circulou. O que a instituição
 *  precisa saber ("quantas vezes esta carta foi vista?") é MEDIDO, não proibido.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE "REVOGADO" E "EXPIRADO" SÃO ESTADOS DISTINTOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os dois fecham o link, mas contam histórias diferentes e pedem ações
 *  diferentes:
 *
 *   • REVOGADO é um ATO do dono, aconteceu num instante conhecido e é definitivo —
 *     a saída é criar outro link;
 *   • EXPIRADO é o relógio: o link nasceu com prazo e o prazo acabou. Não houve
 *     ato nenhum, e a saída é escolher um prazo novo.
 *
 *  Quem lê a lista do dono precisa saber QUAL dos dois foi — "revogado" sem ter
 *  revogado nada assusta, e "expirado" num link que a pessoa revogou faria ela
 *  procurar um prazo que nunca existiu. Por isso o domínio devolve o estado
 *  separado e um rótulo pronto, em vez de um booleano "abre/não abre".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PERGUNTA É UMA SÓ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `cardShareStatus` responde a MESMA pergunta para a página pública (que recusa)
 *  e para a lista do dono (que explica). Duas implementações divergiriam na
 *  primeira correção — e divergir aqui significa o dono ver "válido" num link que
 *  o visitante recebe como 404.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const SHARE_VALIDITY_IDS = ['NEVER', 'DAYS_7', 'DAYS_30', 'DAYS_90', 'ON_DATE'] as const;
export type ShareValidityId = (typeof SHARE_VALIDITY_IDS)[number];

export const SHARE_VALIDITY_LABELS: Readonly<Record<ShareValidityId, string>> = {
  NEVER: 'Sem prazo',
  DAYS_7: '7 dias',
  DAYS_30: '30 dias',
  DAYS_90: '90 dias',
  ON_DATE: 'Escolher a data',
};

/** Prazo em dias de cada escolha; `null` = sem prazo (ou data escolhida à mão). */
export const SHARE_VALIDITY_DAYS: Readonly<Record<ShareValidityId, number | null>> = {
  NEVER: null,
  DAYS_7: 7,
  DAYS_30: 30,
  DAYS_90: 90,
  ON_DATE: null,
};

/** O padrão da tela: a primeira opção da lista e a que nasce marcada. */
export const DEFAULT_SHARE_VALIDITY: ShareValidityId = 'NEVER';

/**
 * As opções NA ORDEM em que a tela as oferece.
 *
 * É dado do domínio, e não uma lista montada no JSX, porque o formulário e a
 * validação do serviço precisam concordar sobre o que é uma escolha legítima.
 */
export const SHARE_VALIDITY_CHOICES: readonly {
  id: ShareValidityId;
  label: string;
  days: number | null;
}[] = SHARE_VALIDITY_IDS.map((id) => ({
  id,
  label: SHARE_VALIDITY_LABELS[id],
  days: SHARE_VALIDITY_DAYS[id],
}));

export function isShareValidityId(value: string): value is ShareValidityId {
  return (SHARE_VALIDITY_IDS as readonly string[]).includes(value);
}

/** O prazo de uma data escolhida à mão vence no FIM do dia local, às 23:59. */
export const SHARE_DAY_END_HOUR = 23;
export const SHARE_DAY_END_MINUTE = 59;

export const SHARE_STATUSES = ['VALID', 'EXPIRED', 'REVOKED'] as const;
export type CardShareStatus = (typeof SHARE_STATUSES)[number];

export interface ShareValidityInput {
  revokedAt: Date | null;
  expiresAt: Date | null;
  /** Injetável para que a regra seja testável sem relógio de parede. */
  now?: Date;
}

/**
 * O estado do link AGORA.
 *
 * A ordem das perguntas é contrato: a revogação vem primeiro. Um link revogado e
 * vencido é REVOGADO — foi o dono quem o fechou, e é essa a história que a lista
 * precisa contar (o contrário faria a expiração "apagar" o ato de quem revogou).
 * "Vencido é vencido" segue a mesma régua do resto do sistema: no instante exato
 * do prazo o link já não abre (`<=`), igual à exportação com prazo (FASE 49).
 */
export function cardShareStatus(input: ShareValidityInput): CardShareStatus {
  if (input.revokedAt) return 'REVOKED';

  const now = input.now ?? new Date();
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';

  return 'VALID';
}

/** "Este link abre agora?" — a pergunta da página pública e da lista do dono. */
export function isCardShareOpen(input: ShareValidityInput): boolean {
  return cardShareStatus(input) === 'VALID';
}

/** `12/03/2027` no fuso da instituição (o dia que a pessoa lê, não o do servidor). */
export function shareDateLabel(date: Date, timeZone: string): string {
  const wall = instantToZonedWallTime(date, timeZone);
  const [year, month, day] = wall.slice(0, 10).split('-');
  return `${day ?? '??'}/${month ?? '??'}/${year ?? '????'}`;
}

/** `12/03/2027 às 14:32` — o instante de uma abertura. `null` = nunca aconteceu. */
export function shareMomentLabel(date: Date | null, timeZone: string): string | null {
  if (!date) return null;

  /** O texto vem da hora de parede (`YYYY-MM-DDTHH:mm`); só a hora é usada aqui. */
  const time = instantToZonedWallTime(date, timeZone).split('T')[1];

  return `${shareDateLabel(date, timeZone)} às ${time ?? '--:--'}`;
}

/**
 * O rótulo que a tela mostra para o estado do link.
 *
 * Devolve frase pronta (e não um enum) porque o texto é o MESMO na lista do dono e
 * no aviso da criação: montá-lo duas vezes faria as duas telas divergirem na
 * primeira correção de redação.
 */
export function shareValidityLabel(input: {
  status: CardShareStatus;
  expiresAt: Date | null;
  timeZone: string;
}): string {
  if (input.status === 'REVOKED') return 'revogado';
  if (input.status === 'EXPIRED') return 'expirado';
  if (!input.expiresAt) return 'sem prazo';

  return `expira em ${shareDateLabel(input.expiresAt, input.timeZone)}`;
}

export type ShareExpiryErrorCode = 'INVALID_CHOICE' | 'INVALID_DAY' | 'DAY_IN_PAST';

export type ShareExpiryResult =
  | { ok: true; expiresAt: Date | null }
  | { ok: false; code: ShareExpiryErrorCode; message: string };

/**
 * A escolha da tela → o INSTANTE em que o link deixa de abrir (`null` = nunca).
 *
 * A validade chega do formulário como palpite: um `id` desconhecido é RECUSADO em
 * vez de cair no "sem prazo" — cair no padrão transformaria um pedido de prazo
 * adulterado num link eterno, que é o oposto do que quem pediu queria.
 *
 * A data escolhida vale até o FIM do dia no fuso da instituição (23:59), como o
 * prazo de confirmação de vaga (ADR-173): quem escolhe "12/03" quer o dia inteiro,
 * não a meia-noite que começa ele. Data já passada é recusada porque o link
 * nasceria expirado — e um link que nasce morto é um defeito silencioso.
 */
export function shareExpiryFor(input: {
  validity: string;
  /** `"2027-03-12"` — o que o `<input type="date">` manda. */
  day?: string | null;
  now?: Date;
  timeZone: string;
}): ShareExpiryResult {
  if (!isShareValidityId(input.validity)) {
    return {
      ok: false,
      code: 'INVALID_CHOICE',
      message: 'Prazo desconhecido para o link. Escolha uma das opções da tela.',
    };
  }

  const now = input.now ?? new Date();
  const days = SHARE_VALIDITY_DAYS[input.validity];

  if (days !== null) {
    return { ok: true, expiresAt: new Date(now.getTime() + days * 86_400_000) };
  }

  if (input.validity === 'NEVER') return { ok: true, expiresAt: null };

  const day = (input.day ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return {
      ok: false,
      code: 'INVALID_DAY',
      message: 'Escolha a data em que o link deve parar de abrir.',
    };
  }

  const pad = (value: number): string => String(value).padStart(2, '0');
  const expiresAt = zonedWallTimeToInstant(
    `${day}T${pad(SHARE_DAY_END_HOUR)}:${pad(SHARE_DAY_END_MINUTE)}`,
    input.timeZone,
  );

  if (!expiresAt) {
    return { ok: false, code: 'INVALID_DAY', message: 'Esta data não existe no calendário.' };
  }

  if (expiresAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      code: 'DAY_IN_PAST',
      message: 'Esta data já passou — o link nasceria expirado.',
    };
  }

  return { ok: true, expiresAt };
}

/**
 * Rótulo das ABERTURAS.
 *
 * "Conta leitura, não pessoa": quem abre duas vezes conta duas. O texto precisa
 * dizer isso — um número solto ao lado de uma carta é lido como "quantas pessoas
 * viram", e a instituição responderia à dívida E70 com um dado errado.
 */
export function shareViewCountLabel(viewCount: number, timeZone: string, lastViewedAt: Date | null): string {
  if (viewCount <= 0) return 'nenhuma abertura ainda';

  const when = shareMomentLabel(lastViewedAt, timeZone);
  const times = viewCount === 1 ? '1 abertura' : `${viewCount} aberturas`;

  return when ? `${times} · última em ${when}` : times;
}
