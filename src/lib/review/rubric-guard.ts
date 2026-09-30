/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — O congelamento da FORMA da rubrica (FASE 39)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A RUBRICA CONGELA DEPOIS DO PRIMEIRO PARECER
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O número de critérios deixou de ser fixo em três, e isso tornou alcançável um
 *  defeito que antes era improvável: `computeWeightedScore` devolve `null` quando
 *  QUALQUER critério da rubrica está sem nota, e normaliza a nota pelo peso total.
 *  Consequências de editar a rubrica com pareceres já enviados:
 *
 *    • ACRESCENTAR um critério → todo parecer existente passa a ter um critério sem
 *      nota, e a nota dele deixa de ser calculável (vira `null` no histórico);
 *    • REMOVER um critério → os pesos restantes são renormalizados, e as notas dadas
 *      passam a significar outra coisa, sem que ninguém tenha decidido isso;
 *    • TROCAR peso ou nota máxima → o mesmo, em menor escala.
 *
 *  E não há como reconstruir o passado: `Review.scores` é chaveado por critério e o
 *  parecer NÃO guarda a rubrica com que foi dado. O que a pessoa viu no dia não está
 *  gravado em lugar nenhum.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ESCOLHA: CONGELAR, E DIZER POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A alternativa seria fotografar a rubrica em cada parecer (snapshot) e permitir
 *  editar sempre — mais caro, e com um efeito colateral pior: a média final passaria
 *  a comparar notas dadas em escalas diferentes, o que exige o comitê saber disso para
 *  decidir. Congelar é mais simples e mais honesto: **a rubrica é livre enquanto
 *  ninguém avaliou, e imutável na forma a partir do primeiro parecer** — com a
 *  contagem na mensagem e o caminho declarado (criar outra trilha ou outra chamada).
 *
 *  O congelamento cobre a FORMA (chave, peso, nota máxima e o conjunto de chaves).
 *  Rótulo, descrição e ORDEM continuam editáveis: não entram na conta, e travar a
 *  correção de um erro de digitação seria pior que a divergência cosmética.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CONTAGEM OLHA A RUBRICA QUE A SUBMISSÃO REALMENTE USA (FASE 50 · dívida E53)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A rubrica de uma submissão resolve por precedência CHAMADA → TRILHA → PADRÃO, e
 *  até a FASE 49 a contagem da TRILHA ignorava isso: contava "pareceres em submissões
 *  desta trilha", incluindo as de chamadas que têm rubrica PRÓPRIA — submissões que
 *  nunca leram a rubrica da trilha. O efeito era uma trilha congelar por um motivo que
 *  não era dela: o organizador criava a chamada com rubrica própria, e a trilha ficava
 *  intocável por causa de pareceres que não a usam.
 *
 *  Agora a contagem da trilha EXCLUI as submissões cuja chamada tem rubrica própria, e
 *  a da chamada inclui todas as dela (a chamada vence a trilha — é ela que manda no
 *  que aqueles pareceres leram). A pergunta "esta rubrica é própria?" é a MESMA que a
 *  precedência faz (`rubricIsCustom`, no domínio): uma noção só, dois usos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import {
  parseRubric,
  rubricIsCustom,
  rubricShapeChanged,
  rubricShapeDiff,
  rubricShapeDiffLabel,
  type RubricCriterion,
} from '@/domain/review/review-rules';

export type RubricFreezeFailure = { ok: false; code: 'RUBRIC_FROZEN'; message: string };

/**
 * Quantos pareceres já foram enviados em submissões desta trilha (ou desta chamada).
 *
 * Uma linha em `Review` só existe depois do ENVIO do parecer (`submitReview` cria a
 * linha): convite aceito e rascunho não contam. É o que faz "congela a partir do
 * primeiro parecer" ser uma frase exata.
 */
export async function countRubricReviews(
  tx: TxClient,
  input: { tenantId: string; trackId?: string | null; callId?: string | null },
): Promise<number> {
  if (!input.trackId && !input.callId) return 0;

  /**
   * CHAMADA: todos os pareceres das submissões dela contam — a rubrica da chamada
   * vence a da trilha, então ela é o que aqueles revisores leram (ou passariam a ler).
   */
  if (input.callId) {
    return tx.review.count({
      where: {
        tenantId: input.tenantId,
        submission: { callId: input.callId, deletedAt: null },
      },
    });
  }

  /**
   * TRILHA: só conta quem avalia POR ELA. A submissão de uma chamada com rubrica
   * própria é governada pela chamada e sai da conta (dívida E53).
   *
   * A leitura traz a rubrica da chamada de cada parecer e a decisão é do domínio
   * (`rubricIsCustom`) — o mesmo critério da precedência. O volume é o de pareceres de
   * uma trilha, e isto roda numa edição de rubrica, não numa listagem.
   */
  const rows = await tx.review.findMany({
    where: {
      tenantId: input.tenantId,
      submission: { trackId: input.trackId, deletedAt: null },
    },
    select: { submission: { select: { call: { select: { reviewRubric: true } } } } },
  });

  return rows.filter((row) => !rubricIsCustom(row.submission.call?.reviewRubric)).length;
}

/**
 * A rubrica EFETIVA de um alvo — o que os revisores realmente viram.
 *
 * Comparar contra o JSON gravado não bastaria: uma trilha sem rubrica própria usa a
 * PADRÃO (`DEFAULT_RUBRIC`, três critérios), e gravar uma rubrica de cinco critérios
 * nela mudaria a forma do mesmo jeito. `parseRubric` faz essa conversão — e é o mesmo
 * caminho que o formulário do revisor usa, então não existem duas noções de "rubrica
 * em vigor".
 */
export function effectiveRubric(raw: unknown): readonly RubricCriterion[] {
  return parseRubric(raw).rubric;
}

/**
 * A forma da rubrica pode mudar?
 *
 * Devolve a recusa pronta para o serviço, com a contagem e o que mudou — a mensagem é
 * o produto aqui: quem organiza precisa saber que o caminho é criar outra trilha ou
 * outra chamada, e não ficar tentando.
 */
export async function assertRubricShapeFree(
  tx: TxClient,
  input: {
    tenantId: string;
    trackId?: string | null;
    callId?: string | null;
    /** Rubrica ATUALMENTE em vigor no alvo (o `before` da comparação). */
    stored: unknown;
    /** Rubrica que o organizador está tentando gravar. */
    submitted: readonly RubricCriterion[];
  },
): Promise<{ ok: true; reviews: number } | RubricFreezeFailure> {
  const reviews = await countRubricReviews(tx, {
    tenantId: input.tenantId,
    trackId: input.trackId,
    callId: input.callId,
  });

  if (reviews === 0) return { ok: true, reviews: 0 };

  const before = effectiveRubric(input.stored);

  if (!rubricShapeChanged(before, input.submitted)) return { ok: true, reviews };

  const diff = rubricShapeDiff(before, input.submitted);
  const where = input.callId ? 'chamada' : 'trilha';

  return {
    ok: false,
    code: 'RUBRIC_FROZEN',
    message:
      `Esta ${where} já tem ${reviews} parecer(es) enviado(s): o número de critérios, as chaves, ` +
      `os pesos e as notas máximas não podem mais mudar — a nota de quem já avaliou deixaria de ` +
      `ser calculável. Rótulo, descrição e ordem continuam livres. ` +
      `Mudanças recusadas: ${rubricShapeDiffLabel(diff)}. ` +
      (input.callId
        ? 'Para avaliar por outros critérios, crie outra chamada.'
        : 'Para avaliar por outros critérios, crie outra trilha.'),
  };
}

/**
 * Contagem de pareceres para VÁRIOS alvos de uma vez — a lista de trilhas e o painel
 * de chamadas mostram o estado de congelamento sem uma consulta por linha.
 */
export async function rubricReviewCounts(input: {
  tenantId: string;
  trackIds?: readonly string[];
  callIds?: readonly string[];
}): Promise<{ byTrack: Record<string, number>; byCall: Record<string, number> }> {
  const byTrack: Record<string, number> = {};
  const byCall: Record<string, number> = {};

  try {
    await withTenant(input.tenantId, async (tx) => {
      if (input.trackIds && input.trackIds.length > 0) {
        const rows = await tx.review.findMany({
          where: {
            tenantId: input.tenantId,
            submission: { trackId: { in: [...input.trackIds] }, deletedAt: null },
          },
          select: {
            submission: { select: { trackId: true, call: { select: { reviewRubric: true } } } },
          },
        });

        for (const row of rows) {
          /**
           * A LISTA precisa contar a MESMA coisa que o congelamento (dívida E53): o
           * aviso da tela e a recusa da gravação não podem discordar, senão a tela diz
           * "0 pareceres" e a gravação recusa por causa de um.
           */
          if (rubricIsCustom(row.submission.call?.reviewRubric)) continue;

          const key = row.submission.trackId;
          if (key) byTrack[key] = (byTrack[key] ?? 0) + 1;
        }
      }

      if (input.callIds && input.callIds.length > 0) {
        const rows = await tx.review.findMany({
          where: {
            tenantId: input.tenantId,
            submission: { callId: { in: [...input.callIds] }, deletedAt: null },
          },
          select: { submission: { select: { callId: true } } },
        });

        for (const row of rows) {
          const key = row.submission.callId;
          if (key) byCall[key] = (byCall[key] ?? 0) + 1;
        }
      }
    });
  } catch (error) {
    /** Contagem que falha não pode derrubar a tela: a lista abre sem o aviso. */
    console.error(`[rubrica] falha ao contar pareceres: ${errorMessage(error)}`);
  }

  return { byTrack, byCall };
}
