/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O TETO DE RASCUNHOS COM ARQUIVO (FASE 74 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTA REGRA FECHA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 2 decidiu, e com razão, que rascunho COM arquivo não é reaproveitado por
 *  outra proposta: o PDF é de um trabalho específico, e anexá-lo ao texto de outro
 *  faria a prontidão passar com o arquivo errado. A consequência é que cada nova
 *  tentativa de quem já tem um arquivo cria um rascunho NOVO — e nada os apagava.
 *
 *  A fatia 3 tirou o rascunho da conta de "proposta recebida" e do limite por autor,
 *  e declarou que o teto seria a quota de armazenamento da instituição (F21). Ela é
 *  um teto REAL — não há upload sem espaço —, mas é COMPARTILHADO: sem uma cota
 *  própria, uma única pessoa pode encher o armazenamento da instituição com
 *  rascunhos abandonados e deixar todo mundo sem conseguir anexar nada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O TETO É DE RASCUNHOS **COM ARQUIVO**, E NÃO DE RASCUNHOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O rascunho vazio é REUSADO pela tentativa seguinte (fatia 2): contar rascunho
 *  vazio puniria justamente quem está tentando enviar, e o limite por autor já
 *  resolve a cota das propostas que saíram da mão do autor. O que ocupa espaço e
 *  não se recicla é o rascunho que já tem PDF — é ele que este teto conta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O NÚMERO É CINCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada rascunho é um trabalho DISTINTO em andamento na mesma chamada (o arquivo não
 *  é compartilhado entre eles). Uma pessoa que mantém cinco trabalhos abertos ao
 *  mesmo tempo já está muito além do uso real; abaixo disso, o teto nunca aparece em
 *  uso honesto. E o teto não substitui a quota: ele impede que UM autor a consuma
 *  sozinho, enquanto a F21 continua sendo o limite duro do conjunto.
 *
 *  A contagem é feita pelo SERVIÇO (`createSubmission`), na mesma transação que cria
 *  o rascunho seguinte — e a corrida entre duas abas pode criar um a mais. É
 *  deliberado: este não é um direito do autor (como o limite de propostas), é uma
 *  proteção de armazenamento, e o custo de um excesso de uma unidade é irrelevante
 *  perto do custo de travar uma pessoa que está tentando enviar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Quantos rascunhos COM arquivo uma pessoa pode manter, por chamada.
 *
 * Mudar este número muda a mensagem e o comportamento juntos: não há cópia dele na
 * tela nem no serviço.
 */
export const MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL = 5;

export type DraftFileCeilingDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: 'DRAFT_FILE_LIMIT_REACHED';
      message: string;
      details: readonly string[];
    };

/**
 * A pessoa pode começar mais um trabalho nesta chamada?
 *
 * Recebe quantos rascunhos COM arquivo ela já tem na chamada e devolve a decisão —
 * a mesma resposta que o serviço transforma em recusa. A frase diz o NÚMERO e o que
 * fazer, porque "limite atingido" sem caminho é o defeito que a FASE 74 inteira
 * persegue: a pessoa precisa saber que o caminho é ENVIAR ou EXCLUIR, não adivinhar.
 */
export function canStartAnotherDraftWithFile(input: {
  draftsWithFile: number;
}): DraftFileCeilingDecision {
  if (input.draftsWithFile < MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL) {
    return { allowed: true };
  }

  return {
    allowed: false,
    code: 'DRAFT_FILE_LIMIT_REACHED',
    message:
      `Você já tem ${MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL} rascunhos com arquivo nesta chamada. ` +
      'Envie ou exclua um deles antes de começar outro trabalho.',
    details: [
      `O teto é de ${MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL} rascunhos com arquivo por pessoa nesta chamada.`,
      'Os arquivos ocupam o armazenamento da instituição — o teto existe para uma pessoa não consumi-lo sozinha.',
    ],
  };
}
