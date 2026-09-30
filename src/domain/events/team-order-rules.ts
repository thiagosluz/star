/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Ordem manual das equipes do evento (FASE 51 · dívida E63)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A IDEIA EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A vitrine pública ("Equipe do evento", FASE 45) ordenava as equipes por NOME e,
 *  dentro de cada uma, líder primeiro. A ordem alfabética dá conta do caso comum —
 *  e é por isso que ela CONTINUA valendo quando ninguém ordenou nada —, mas não
 *  permite o "a presidência primeiro, depois a diretoria na ordem que eu decidir".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE "POR EQUIPE", E NÃO UMA POSIÇÃO POR PESSOA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Posição de PESSOA envelhece em silêncio: alguém sai da equipe, a posição 3 fica
 *  vaga e ninguém percebe que a grade mudou. A equipe é uma lista curta que a
 *  organização mantém de fato — e o líder (dado desde a FASE 38) já resolve o
 *  "quem vem primeiro" DENTRO dela. As duas réguas juntas (ordem da equipe + líder)
 *  produzem o efeito pedido sem inventar uma tela de arrastar pessoas.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE "ZERO" SIGNIFICA — E POR QUE ISSO IMPORTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `displayOrder = 0` é "sem opinião", NÃO "primeiro lugar". Duas consequências:
 *
 *    • quem nunca ordenou nada continua exatamente na ordem que já existia
 *      (alfabética, pt-BR) — a fase não pode trocar a ordem de quem não pediu nada;
 *    • equipe NOVA (que nasce 0) entra no FIM da lista, e não no meio, porque o
 *      organizador ainda não disse onde ela fica.
 *
 *  Se a ordenação tratasse 0 como posição real, a primeira equipe ordenada em 10
 *  empurraria todas as outras para depois dela sem ninguém ter pedido — que é a
 *  definição de "inventar ordem alfabética nova onde já havia".
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { DEMAND_POSITION_STEP, planReorder } from '@/domain/events/demand-rules';

export interface TeamOrderLike {
  id: string;
  name: string;
  /** 0 = ninguém ordenou esta equipe. */
  displayOrder: number;
}

/** A mesma régua de 10 em 10 do quadro de demandas e dos blocos de página (FASE 17/38). */
export const TEAM_ORDER_STEP = DEMAND_POSITION_STEP;

/**
 * Comparador TOTAL da lista de equipes.
 *
 * A ordem é: quem tem opinião (displayOrder > 0) vem primeiro, do menor para o
 * maior; quem não tem vem depois, em ordem alfabética; e o `id` fecha o desempate.
 * Sem o id no fim, duas equipes homônimas (o nome NÃO é único entre eventos, e
 * dentro do evento é — mas o comparador não pode depender disso) trocariam de lugar
 * entre duas requisições, e quem abre a página duas vezes veria duas páginas.
 */
export function compareTeamsForDisplay(a: TeamOrderLike, b: TeamOrderLike): number {
  const aOrdered = a.displayOrder > 0;
  const bOrdered = b.displayOrder > 0;

  if (aOrdered !== bOrdered) return aOrdered ? -1 : 1;

  if (aOrdered && bOrdered && a.displayOrder !== b.displayOrder) {
    return a.displayOrder - b.displayOrder;
  }

  return a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id);
}

/** A lista de equipes na ordem em que a vitrine e a tela de administração mostram. */
export function orderTeamsForDisplay<T extends TeamOrderLike>(teams: readonly T[]): T[] {
  return [...teams].sort(compareTeamsForDisplay);
}

/**
 * O plano de reescrita da ordem: 10, 20, 30… na ordem dada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE REESCREVER O BLOCO INTEIRO, E NÃO GRAVAR A POSIÇÃO DA EQUIPE MOVIDA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Gravar só a equipe movida produziria EMPATE com a vizinha (duas equipes com o
 *  mesmo número), e o empate cai no desempate alfabético — ou seja, o movimento
 *  viraria um NO-OP silencioso, com a tela dizendo "ordem salva" e nada mudando.
 *
 *  A reescrita passa pela função PURA que o quadro de demandas já usa
 *  (`planReorder`), e não por uma cópia da conta: duas contas de "qual é a próxima
 *  posição" divergem no primeiro dia em que alguém mudar o passo.
 */
export function planTeamOrder(ids: readonly string[]): { id: string; displayOrder: number }[] {
  return planReorder(ids).map((row) => ({ id: row.id, displayOrder: row.position }));
}
