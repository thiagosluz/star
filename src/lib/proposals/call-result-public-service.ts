/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — A LEITURA PÚBLICA DO RESULTADO DA CHAMADA (FASE 73 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA LEITURA PRÓPRIA, E NÃO O PAINEL DO ORGANIZADOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `getCallResultPanel` (fatia 2) carrega, além do que o público pode ver, o
 *  MATERIAL DO ORGANIZADOR: o seletor com TODAS as submissões e o status da decisão
 *  de cada uma (`buildCallResultSelector`), as submissões não publicadas e os
 *  `problems` da configuração. Reusá-lo na página pública faria o visitante anônimo
 *  receber, no HTML, o status interno de trabalhos que ninguém publicou — e a única
 *  coisa que separa "o público vê" de "a organização vê" seria a marcação da tela.
 *  A leitura pública é própria porque o CONJUNTO DE DADOS é outro, não porque o
 *  código é diferente de propósito.
 *
 *  Isso é preso por CATRACA DE FONTE: `tests/unit/f73-pagina-publica.test.ts` lê este
 *  arquivo e reprova se ele importar o serviço do painel, o seletor ou a tabela de
 *  status das decisões. O teste não mede intenção — mede importação.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA LEITURA CONSULTA — E O QUE ELA NÃO CONSULTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a chamada PUBLICADA no escopo da instituição (`isPublished: true`,
 *    `deletedAt: null`, `tenantId` no filtro): rascunho e despublicada devolvem
 *    `null`, e quem chama trata como "não existe" — o 404 de hoje);
 *  • `call.result` lido por `readCallResult` (tolerante: JSON torto vira
 *    SEM_RESULTADO e os `problems` vão para o LOG, nunca para a tela);
 *  • SÓ as submissões de `publicados`, vivas (`deletedAt: null`), com QUATRO campos:
 *    `protocol`, `title`, o tipo da CHAMADA (rótulo do domínio) e os autores
 *    (`nome` + `publicProfileHiddenAt`, que a projeção transforma em `oculto`).
 *
 *  Nada de nota (`finalScore`, `decisionNotes`), parecer (`reviews`), revisor,
 *  e-mail, situação interna da submissão ou `proposalData`: o `select` abaixo NÃO OS
 *  PEDE, e é isso que os torna impossíveis de vazar — não um filtro depois da
 *  consulta. A lista fechada do domínio (`assertResultadoSemCampoProibido`) é a
 *  segunda linha: ela reprova a projeção inteira se um campo proibido aparecer.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ID PUBLICADO QUE DEIXOU DE EXISTIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `publicados` é uma ESCOLHA GRAVADA; a submissão é um fato que pode mudar (o autor
 *  retirou, a organização excluiu). Quando um id publicado não volta da consulta, ele
 *  NÃO é inventado nem substituído: sai da lista e o motivo é reportado ao log —
 *  `projectPublicCallResult` faz exatamente isso. A lista continua coerente, na ordem
 *  que o organizador gravou, sem buraco e sem item vazio.
 *
 *  A leitura NUNCA lança para o chamador: erro de infraestrutura vira `null` (a seção
 *  não aparece) e uma linha de log. Uma página pública não pode responder erro porque
 *  o JSON do resultado está torto — e uma seção que não existe é a resposta honesta
 *  quando não há dado legível.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import {
  PROPOSAL_KIND_LABELS,
  PROPOSAL_KINDS,
  type ProposalKind,
} from '@/domain/proposals/call-rules';
import {
  projectPublicCallResult,
  readCallResult,
  type CallResultAuthorSource,
  type CallResultSubmissionSource,
  type PublicCallResultView,
} from '@/domain/proposals/call-result-rules';

/**
 * O enum do banco em tipo do domínio.
 *
 * O `kind` do schema é um enum, mas o banco não é catraca de `tsc`: se um dia ele
 * ganhar um valor que o domínio ainda não conhece, a lista mostraria `undefined` no
 * lugar do tipo. `OTHER` é o rótulo honesto para "não sei classificar" — e a chamada
 * continua publicável, porque o resultado não depende do tipo.
 */
function kindOf(value: string): ProposalKind {
  return (PROPOSAL_KINDS as readonly string[]).includes(value) ? (value as ProposalKind) : 'OTHER';
}

/**
 * Os autores de UMA submissão publicada.
 *
 * `publicProfileHiddenAt` é lido porque o tipo da projeção exige o sinal (`oculto`) —
 * e o sinal NÃO vai ao público: a projeção desta superfície lê o nome e ignora o
 * sinal (a exceção declarada da FASE 73, decisão 2 do humano). Publicar o sinal
 * revelaria QUEM se ocultou, que é o oposto do que a E79 protege.
 *
 * Autor sem nome nenhum é descartado: um item de lista sem autoria esconderia que a
 * fonte está incompleta, e a lista é um documento.
 */
function toAuthorSource(row: {
  guestName: string | null;
  user: { name: string; publicProfileHiddenAt: Date | null } | null;
}): CallResultAuthorSource[] {
  const nome = (row.user?.name ?? row.guestName ?? '').trim();

  if (nome.length === 0) return [];

  return [{ nome, oculto: row.user?.publicProfileHiddenAt != null }];
}

/** O log é a única superfície do que a leitura precisou descartar (a tela não a vê). */
function report(origem: string, callId: string, problems: readonly string[]): void {
  if (problems.length === 0) return;

  console.warn(`[proposals] ${origem} da chamada ${callId}: ${problems.join(' | ')}`);
}

/**
 * Lê o resultado publicado de UMA chamada — o que a página pública desenha.
 *
 * A `callId` vem da chamada que a página JÁ resolveu pelo caminho de hoje
 * (`getCallBySlug`, no escopo da instituição e do evento). Esta função relê a MESMA
 * linha pelo id, exigindo `isPublished: true` — defesa em profundidade, não um
 * segundo caminho de resolução: o slug e o evento continuam sendo resolvidos por um
 * lugar só, e a página ganha a garantia de que uma chamada despublicada entre a
 * resolução e a leitura também não publica resultado.
 */
export async function getPublicCallResult(input: {
  tenantId: string;
  callId: string;
}): Promise<PublicCallResultView | null> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const call = await tx.callForProposals.findFirst({
        where: {
          id: input.callId,
          tenantId: input.tenantId,
          deletedAt: null,
          /** Despublicada não tem resultado público — nem o de antes da despublicação. */
          isPublished: true,
        },
        /**
         * Só o que a projeção usa: o tipo da chamada (o rótulo do tipo na lista) e o
         * JSON do resultado. Nada da rubrica, da trilha ou do criador.
         */
        select: { id: true, kind: true, result: true },
      });

      if (!call) return null;

      const leitura = readCallResult(call.result);

      report('resultado público', call.id, leitura.problems);

      /**
       * SÓ os ids publicados. Sem `in: []`, o Prisma devolveria a chamada inteira —
       * e "todas as submissões" é exatamente o material do organizador que esta
       * leitura não pode carregar.
       */
      const ids = leitura.resultado.publicados;

      const rows =
        ids.length === 0
          ? []
          : await tx.submission.findMany({
              where: {
                tenantId: input.tenantId,
                callId: call.id,
                deletedAt: null,
                id: { in: [...ids] },
              },
              select: {
                id: true,
                protocol: true,
                title: true,
                authors: {
                  orderBy: { authorOrder: 'asc' },
                  select: {
                    guestName: true,
                    user: { select: { name: true, publicProfileHiddenAt: true } },
                  },
                },
              },
            });

      const tipo = PROPOSAL_KIND_LABELS[kindOf(call.kind)];

      const submissoes: CallResultSubmissionSource[] = rows.map((row) => ({
        id: row.id,
        protocol: row.protocol,
        titulo: row.title,
        tipo,
        autores: row.authors.flatMap(toAuthorSource),
      }));

      const projecao = projectPublicCallResult({
        resultado: leitura.resultado,
        submissoes,
      });

      report('projeção pública do resultado', call.id, projecao.problems);

      return projecao.view;
    });
  } catch (error) {
    /**
     * Fail-closed: sem leitura legível, a seção não existe. O log guarda o motivo —
     * o operador descobre o defeito sem abrir o banco, e o visitante não vê erro.
     */
    console.error(
      `[proposals] falha ao ler o resultado público da chamada ${input.callId}: ${errorMessage(error)}`,
    );

    return null;
  }
}
