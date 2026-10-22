/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Quem pode abrir a página da submissão (FASE 74 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ISTO FECHA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `/t/<slug>/submissoes/<submissionId>` filtrava a submissão só por INSTITUIÇÃO
 *  (`getSubmission` com o `tenantId` da sessão). Qualquer membro do tenant que
 *  soubesse o UUID — um número que circula em e-mail, em conversa, num link
 *  copiado — lia o título, o resumo inteiro, a lista de autores com E-MAIL, os
 *  nomes dos arquivos e a nota/decisão de um trabalho alheio. A RLS não ajuda
 *  aqui: a linha É da instituição; o que faltava era a POSSE.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A COMPARAÇÃO VIVE AQUI, E NÃO NA PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A página é uma das portas; a conferência é uma REGRA. Deixá-la escrita dentro
 *  do JSX faria a próxima superfície que reusar o detalhe da submissão nascer sem
 *  ela — foi assim que o furo existiu. A função devolve o veredito e o que a tela
 *  precisa saber da chamada (o TIPO, que decide quais bloqueios existem), e a
 *  página só escolhe o que fazer com o veredito (404).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "NÃO EXISTE" E "NÃO É SUA" TÊM A MESMA RESPOSTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `ok: false` cobre os dois de propósito: a página responde 404 nos dois casos,
 *  então a porta não vira oráculo de existência (o mesmo raciocínio do upload na
 *  fatia 1). O chamador não recebe NADA da submissão quando a resposta é negativa —
 *  nem o título, nem o protocolo, nem o id.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import type { ProposalKind } from '@/domain/proposals/call-rules';

export type SubmissionPageAccess =
  | {
      ok: true;
      /**
       * O tipo da chamada de origem — NULO quando a submissão não veio de chamada.
       * É ele que a régua de prontidão usa para saber se a proposta é científica
       * (e portanto se exige trilha e PDF); sem ele a tela acusaria bloqueios que
       * o serviço não cobra, ou esconderia os que ele cobra.
       */
      callKind: ProposalKind | null;
    }
  | { ok: false };

/**
 * A submissão existe NESTA instituição e é do autor que está abrindo a página?
 *
 * A leitura é uma só: posse e tipo da chamada vêm na mesma linha, para a tela não
 * pagar duas idas ao banco nem poder decidir com dois retratos diferentes.
 */
export async function loadSubmissionPageAccess(input: {
  tenantId: string;
  submissionId: string;
  /** Quem está abrindo a página — o id da sessão, nunca um id do formulário. */
  viewerId: string;
}): Promise<SubmissionPageAccess> {
  const row = await withTenant(input.tenantId, (tx) =>
    tx.submission.findFirst({
      where: { id: input.submissionId, deletedAt: null },
      select: {
        submittedById: true,
        call: { select: { kind: true } },
      },
    }),
  );

  /**
   * A ORDEM É A GARANTIA: linha inexistente, de outra instituição (a RLS esconde)
   * ou de outra pessoa devolvem o MESMO `ok: false`.
   */
  if (!row || row.submittedById !== input.viewerId) return { ok: false };

  return { ok: true, callKind: (row.call?.kind as ProposalKind | undefined) ?? null };
}
