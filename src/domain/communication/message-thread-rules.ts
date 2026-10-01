/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — A conversa do recado (FASE 56 · dívida E45)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A RESPOSTA APONTA PARA O RECADO RAIZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A alternativa era apontar para a mensagem respondida, formando uma ÁRVORE. Numa
 *  caixa de entrada, árvore é o que ninguém quer: para desenhar uma conversa é preciso
 *  percorrer os filhos nível a nível, e a pergunta "esta conversa foi respondida?"
 *  deixa de ter resposta em uma consulta.
 *
 *  Com o ponteiro para a RAIZ, a conversa é uma LISTA de duas consultas
 *  (`parentId = raiz`) — e é isso que faz o indicador "respondeu" ser barato tanto na
 *  caixa de entrada quanto na ficha da pessoa.
 *
 *  A regra é pura e vive aqui porque DUAS telas dependem dela: quem grava a resposta e
 *  quem lê a conversa. Duas implementações divergiriam na primeira manutenção.
 */

/** Teto do corpo da resposta — o mesmo do recado (a coluna é `VarChar(2000)`). */
export const MAX_MESSAGE_BODY_LENGTH = 2000;

/** Teto do assunto, com o prefixo de resposta já contado. */
export const MAX_SUBJECT_LENGTH = 140;

export type ThreadDirection = 'OUTBOUND' | 'INBOUND';

export interface ThreadMessage {
  id: string;
  parentId: string | null;
  direction: ThreadDirection;
}

/**
 * A raiz da conversa: a própria mensagem, quando ela é o recado original; o pai,
 * quando ela já é uma resposta.
 */
export function threadRootFor(message: { id: string; parentId: string | null }): string {
  return message.parentId ?? message.id;
}

/**
 * O assunto da resposta.
 *
 * O prefixo `Re:` é acrescentado UMA vez: responder a uma resposta não pode produzir
 * `Re: Re: Re:`. E o resultado é truncado no teto da coluna — assunto de 140 caracteres
 * com o prefixo estouraria o banco, e o erro apareceria como falha de gravação, não como
 * mensagem longa demais.
 */
export function replySubjectFor(subject: string): string {
  const trimmed = subject.trim();
  const prefixed = /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;

  return prefixed.slice(0, MAX_SUBJECT_LENGTH);
}

/**
 * A conversa tem resposta DA PESSOA?
 *
 * É o indicador que a ficha da instituição mostra. A direção é o que decide — nunca a
 * contagem de mensagens: uma conversa com duas mensagens da instituição não foi
 * respondida.
 */
export function hasParticipantReply(thread: readonly ThreadMessage[]): boolean {
  return thread.some((message) => message.direction === 'INBOUND');
}

/** Quando a pessoa respondeu pela última vez — `null` quando não respondeu. */
export function lastParticipantReplyAt(
  thread: readonly (ThreadMessage & { sentAt: Date })[],
): Date | null {
  const replies = thread
    .filter((message) => message.direction === 'INBOUND')
    .map((message) => message.sentAt);

  if (replies.length === 0) return null;

  return replies.reduce((latest, current) => (current > latest ? current : latest));
}

/**
 * O corpo da resposta é aceitável?
 *
 * Devolve o motivo em vez de `boolean` porque quem chama tem de DIZER à pessoa o que
 * está errado: "escreva a resposta" e "sua resposta passou do limite" são correções
 * diferentes.
 */
export type ReplyBodyProblem = 'EMPTY' | 'TOO_LONG' | null;

export function replyBodyProblem(body: string): ReplyBodyProblem {
  const trimmed = body.trim();

  if (trimmed.length === 0) return 'EMPTY';
  if (trimmed.length > MAX_MESSAGE_BODY_LENGTH) return 'TOO_LONG';

  return null;
}
