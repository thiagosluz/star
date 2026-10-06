/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Regras da campanha de comunicação (FASE 67 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `dedupeKey` É A PEÇA CENTRAL DESTE ARQUIVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma campanha pode ser disparada mais de uma vez, e isso é DESENHO, não
 *  acidente: o disparo é limitado pelo ritmo do provedor (F13), então quem tem
 *  300 destinatários roda de novo para alcançar o resto; e quem viu três falhas
 *  no outbox roda de novo depois de corrigir o endereço. O que impede a mesma
 *  pessoa de receber a mesma campanha duas vezes não é um botão desabilitado —
 *  é a chave do FATO: `campaign:<id da campanha>:<id da pessoa>`, com índice
 *  único em `email_messages."dedupeKey"` (FASE 15).
 *
 *  Chave derivada do FATO, e não do momento, é a mesma régua que impede a mesma
 *  conquista de virar duas mensagens. Aqui o fato é "esta campanha, para esta
 *  pessoa" — e é por isso que o reenvio é seguro por construção.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM JOGA A CHAVE FORA NÃO CONSEGUE CONTAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O prefixo (`campaign:<id>:`) é a outra metade: com ele a instituição conta
 *  quantas linhas do outbox são DESTA campanha sem precisar de coluna nova nem
 *  de lista de ids na campanha. Por isso o prefixo também é função daqui — o
 *  formato da chave é um contrato entre o disparo e a leitura.
 * ═══════════════════════════════════════════════════════════════════════════════

/** Estado do ATO (espelha o enum `CampaignStatus` do schema). */
export const CAMPAIGN_STATUSES = ['DRAFT', 'SENDING', 'SENT'] as const;
export type CampaignStatusValue = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Readonly<Record<CampaignStatusValue, string>> = {
  DRAFT: 'Rascunho',
  SENDING: 'Enviando',
  SENT: 'Enviada',
};

export function campaignStatusLabel(status: string): string {
  return CAMPAIGN_STATUS_LABELS[status as CampaignStatusValue] ?? status;
}

/**
 * De onde veio o descadastro.
 *
 * `EMAIL` — a pessoa clicou no link da mensagem;
 * `LINK` — chegou à página sem login por outro caminho (o link de um colega, o
 *   atalho salvo), e o canal importa para a operação saber se o rodapé funciona;
 * `MANUAL` — a equipe registrou o pedido feito por telefone/balcão.
 *
 * O canal é DADO, não dedução: "saiu pelo link do e-mail" e "pediu por telefone"
 * são fatos diferentes, e o segundo não pode ser inferido do primeiro.
 */
export const UNSUBSCRIBE_CHANNELS = ['EMAIL', 'LINK', 'MANUAL'] as const;
export type UnsubscribeChannel = (typeof UNSUBSCRIBE_CHANNELS)[number];

export const UNSUBSCRIBE_CHANNEL_LABELS: Readonly<Record<UnsubscribeChannel, string>> = {
  EMAIL: 'pelo link do e-mail',
  LINK: 'pela página de descadastro',
  MANUAL: 'registrado pela equipe',
};

export function isUnsubscribeChannel(value: unknown): value is UnsubscribeChannel {
  return typeof value === 'string' && (UNSUBSCRIBE_CHANNELS as readonly string[]).includes(value);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Texto da campanha
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Limites do texto.
 *
 * O assunto cabe no `VarChar(200)` da coluna e o corpo é `TEXT` — o teto de 5.000
 * caracteres não é do banco: é de produto. Campanha é recado, não apostila, e um
 * corpo sem teto é o caminho mais curto para a caixa de spam.
 */
export const MAX_CAMPAIGN_SUBJECT_LENGTH = 200;
export const MAX_CAMPAIGN_BODY_LENGTH = 5_000;
export const MIN_CAMPAIGN_BODY_LENGTH = 10;

export interface CampaignDraft {
  subject: string;
  body: string;
}

export type CampaignTextValidation =
  | { ok: true; subject: string; body: string }
  | { ok: false; message: string };

/**
 * Valida o texto escrito pelo organizador.
 *
 * O assunto é UMA linha de propósito: quebra de linha em assunto é cabeçalho de
 * e-mail se disfarçando de texto, e alguns clientes cortam o resto em silêncio.
 */
export function validateCampaignText(input: { subject: unknown; body: unknown }): CampaignTextValidation {
  const subject = typeof input.subject === 'string' ? input.subject.trim().replace(/\s+/g, ' ') : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';

  if (subject.length === 0) return { ok: false, message: 'Escreva o assunto da mensagem.' };
  if (subject.length > MAX_CAMPAIGN_SUBJECT_LENGTH) {
    return { ok: false, message: `O assunto passa de ${MAX_CAMPAIGN_SUBJECT_LENGTH} caracteres.` };
  }
  if (body.length < MIN_CAMPAIGN_BODY_LENGTH) {
    return { ok: false, message: 'Escreva o corpo da mensagem (ao menos uma frase).' };
  }
  if (body.length > MAX_CAMPAIGN_BODY_LENGTH) {
    return { ok: false, message: `O corpo passa de ${MAX_CAMPAIGN_BODY_LENGTH} caracteres.` };
  }

  return { ok: true, subject, body };
}

// ───────────────────────────────────────────────────────────────────────────────
//  A chave do fato
// ───────────────────────────────────────────────────────────────────────────────
const DEDUPE_PREFIX = 'campaign';

/** O prefixo de TODAS as chaves de uma campanha — a contagem sai daqui. */
export function campaignDedupePrefix(campaignId: string): string {
  return `${DEDUPE_PREFIX}:${campaignId}:`;
}

/**
 * A chave de UMA pessoa numa campanha.
 *
 * Cabe no `VarChar(200)` com folga (o menor caso são dois uuid v4: 82 caracteres)
 * e não usa `:` de separador por acaso — o `:` só é proibido no `jobId` do BullMQ
 * (armadilha 49), que aqui vem do id da MENSAGEM, não desta chave.
 */
export function campaignDedupeKey(campaignId: string, userId: string): string {
  return `${campaignDedupePrefix(campaignId)}${userId}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Lotes e estado
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Quanto tempo uma reserva de disparo pode ficar de pé antes de ser considerada
 * órfã.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A LIÇÃO DA FASE 36, APLICADA AQUI
 * ─────────────────────────────────────────────────────────────────────────────
 *  `SENDING` é a exclusão mútua: enquanto há uma passada em andamento, ninguém
 *  dispara a mesma campanha. Se o processo morrer no meio (deploy, OOM, queda), a
 *  linha ficaria `SENDING` **para sempre** e a campanha nunca mais poderia ser
 *  retomada — travamento silencioso e permanente. Meia hora é folgada para a
 *  maior passada (o lote é limitado e o limite de ritmo é por minuto) e curta o
 *  bastante para a operação retomar sozinha.
 */
export const CAMPAIGN_STALE_AFTER_MS = 30 * 60 * 1000;

export type CampaignDispatchState = 'READY' | 'RUNNING';

/**
 * A campanha pode ser disparada AGORA?
 *
 * `DRAFT` pode (primeiro disparo), `SENT` pode (o reenvio é o caminho de
 * recuperação, e o `dedupeKey` o torna seguro) e `SENDING` só pode quando a
 * reserva VENCEU. Uma reserva sem `startedAt` conta como vencida de propósito:
 * fail-open para a retomada, porque a correção do dado não pode depender de
 * alguém editar o banco — e a chave do fato continua sendo a garantia contra
 * mensagem repetida.
 */
export function campaignDispatchState(input: {
  status: CampaignStatusValue;
  startedAt: Date | null;
  now: Date;
}): CampaignDispatchState {
  if (input.status !== 'SENDING') return 'READY';
  if (!input.startedAt) return 'READY';

  return input.now.getTime() - input.startedAt.getTime() > CAMPAIGN_STALE_AFTER_MS ? 'READY' : 'RUNNING';
}

/**
 * Divide a lista em lotes de tamanho fixo, preservando a ordem.
 *
 * Fatiar em lotes é o que permite PARAR no meio quando o provedor pede calma sem
 * perder o que já saiu: cada lote é uma unidade de trabalho concluída, e a
 * próxima passada recomeça do zero — contando com a chave do fato para não
 * repetir quem já entrou.
 */
export function splitIntoBatches<T>(items: readonly T[], size: number): T[][] {
  const batchSize = Math.max(1, Math.floor(size));
  const batches: T[][] = [];

  for (let start = 0; start < items.length; start += batchSize) {
    batches.push(items.slice(start, start + batchSize));
  }

  return batches;
}
