/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O QUE CONTA COMO PROPOSTA RECEBIDA (FASE 74 · fatias 3 e 6)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTA REGRA FECHOU
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O envio pela chamada pública cria o rascunho ANTES de validar a prontidão — é o
 *  que permite ao autor continuar o que escreveu quando falta o PDF. Só que o
 *  rascunho ficava com o mesmo peso de uma proposta enviada em dois lugares:
 *
 *    • o painel do organizador o listava como "proposta recebida";
 *    • o limite por autor o contava como proposta.
 *
 *  As duas coisas diziam a mesma mentira: o trabalho NUNCA saiu da mão do autor.
 *  Com limite configurado, a pessoa se trancava fora tentando enviar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Proposta RECEBIDA é a que o autor ENVIOU — em qualquer desfecho. `DRAFT` nunca
 *  foi enviado, então é o ÚNICO estado que não conta. `WITHDRAWN`, `CANCELED` e
 *  `REJECTED` foram recebidas: a retirada e o cancelamento aconteceram DEPOIS do
 *  envio, e a recusa é uma decisão sobre um trabalho que chegou. Sumir com elas da
 *  fila não é rigor — é retirar do organizador a informação do que ele recebeu.
 *
 *  A fatia 3 tinha chamado de "recebida" a proposta que continuava no páreo, e com
 *  isso alinhou lista e contagem pelo lado de MENOS. O conserto é a mesma régua com
 *  a definição certa: o que saiu da mão do autor, com o status na linha. `DRAFT`
 *  continua fora, pela decisão do humano — rascunho não é proposta recebida.
 *
 *  Esta é a ÚNICA definição. A lista do painel, a contagem do selo e o limite por
 *  autor leem daqui — três leitores, uma régua (a mesma exigência da F54: o número
 *  e a frase saem da mesma fonte, senão o selo e a lista divergem no dia seguinte).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O RASCUNHO COM ARQUIVO É UMA TERCEIRA RESPOSTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um rascunho COM arquivo é trabalho em andamento: a fatia 2 não o reusa (o PDF é
 *  de um trabalho específico, e anexá-lo a outro texto faria a prontidão passar com
 *  o arquivo errado), então ele sobrevive a novas tentativas. Ele NÃO é proposta
 *  recebida — chamá-lo assim seria dizer que entrou no páreo —, mas tratá-lo como
 *  lixo apagaria a visão de quem começou e parou.
 *
 *  Por isso ele é contado À PARTE, com frase própria ("1 rascunho em andamento"). O
 *  organizador sabe que há trabalho sendo feito sem que a chamada afirme ter
 *  recebido uma proposta que ninguém enviou — e sem ler o conteúdo de um trabalho
 *  que o autor ainda não entregou.
 *
 *  Rascunho VAZIO não vira nem isso: é o resto de uma tentativa que a fatia 2 reusa.
 *  Pintá-lo de "em andamento" contaria como trabalho um formulário que ninguém
 *  preencheu — e o defeito original nasceu exatamente de dar peso a esse resto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { SubmissionStatus } from '@/domain/review/submission-rules';

/** O único estado em que o trabalho ainda NÃO saiu da mão do autor. */
export const DRAFT_SUBMISSION_STATUS: SubmissionStatus = 'DRAFT';

/**
 * Situações em que a proposta NUNCA chegou à chamada.
 *
 * Só `DRAFT`. A lista teve quatro situações na fatia 3, quando "recebida" significava
 * "ainda no páreo": retirada, cancelada e recusada saíam da fila e o organizador
 * deixava de ver o que a chamada recebeu. O nome antigo (`NOT_RECEIVED_…`) passaria
 * a mentir — uma proposta retirada FOI recebida —, então a lista mudou de nome e de
 * conteúdo junto: agora ela responde "o que não foi enviado?".
 *
 * O complemento é `isReceivedProposal`; os dois são escritos um a partir do outro
 * para não haver duas respostas.
 */
export const NOT_SENT_SUBMISSION_STATUSES: readonly SubmissionStatus[] = Object.freeze([
  DRAFT_SUBMISSION_STATUS,
]);

export type ProposalReceipt = 'RECEBIDA' | 'EM_ANDAMENTO' | 'NAO_RECEBIDA';

/**
 * Classifica uma submissão da chamada nas três respostas que a tela distingue.
 *
 * `fileCount` é quantos arquivos a submissão tem (não excluídos); ele só decide
 * alguma coisa enquanto a submissão é rascunho. Depois do envio, arquivo ou não,
 * a resposta é a mesma: a proposta saiu da mão do autor.
 */
export function proposalReceipt(input: {
  status: string;
  fileCount: number;
}): ProposalReceipt {
  if (input.status === DRAFT_SUBMISSION_STATUS) {
    return input.fileCount > 0 ? 'EM_ANDAMENTO' : 'NAO_RECEBIDA';
  }

  return isReceivedProposal(input.status) ? 'RECEBIDA' : 'NAO_RECEBIDA';
}

/** A proposta saiu da mão do autor? `DRAFT` é a única resposta negativa. */
export function isReceivedProposal(status: string): boolean {
  return !(NOT_SENT_SUBMISSION_STATUSES as readonly string[]).includes(status);
}

/**
 * A frase do selo da chamada — `1 proposta recebida`, `2 propostas recebidas`,
 * `nenhuma proposta recebida`.
 *
 * O zero aparece porque é RESPOSTA (a chamada não recebeu nada), e não ausência de
 * dado; o singular existe porque "1 propostas" faz o produto parecer quebrado no
 * primeiro uso. A frase mora aqui, e não na tela, para o número que a lista mostra e
 * o número que o selo anuncia saírem da mesma régua (F54).
 */
export function receivedProposalsLabel(total: number): string {
  if (total <= 0) return 'nenhuma proposta recebida';

  return `${total} ${total === 1 ? 'proposta recebida' : 'propostas recebidas'}`;
}

/**
 * A frase do trabalho em andamento — separada da de recebidas de propósito: são
 * fatos diferentes, e juntá-los num número só seria voltar ao defeito.
 */
export function inProgressDraftsLabel(total: number): string {
  if (total <= 0) return 'nenhum rascunho em andamento';

  return `${total} ${total === 1 ? 'rascunho em andamento' : 'rascunhos em andamento'}`;
}
