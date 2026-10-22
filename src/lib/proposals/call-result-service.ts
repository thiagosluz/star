/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — O RESULTADO QUE O ORGANIZADOR PUBLICA NA CHAMADA
 *                                                          (FASE 73 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE SERVIÇO É (E O QUE ELE NÃO FAZ)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Duas operações, e só duas:
 *
 *    • LEITURA — carrega a chamada (no escopo do tenant), as submissões dela com
 *      autoria, e monta o que a tela do organizador precisa: o resultado lido do
 *      JSON, o seletor da lista (`buildCallResultSelector`) e o material da prévia
 *      pública.
 *
 *    • ESCRITA — `applyCallResultAction` chama `decideCallResultTransition` e grava
 *      o objeto INTEIRO **somente** quando a decisão é legal, com a trilha do ato na
 *      MESMA transação.
 *
 *  A DECISÃO É DO DOMÍNIO. Este arquivo não repete nenhuma regra de estado, de teto
 *  de texto, de lista ou de data: ele carrega o que o domínio precisa (o resultado
 *  atual, os ids das submissões DESTA chamada, o instante) e grava o que o domínio
 *  devolveu. Se a regra mudar amanhã, muda em um lugar só (armadilha 55).
 *
 *  E ELE NÃO AUTORIZA. A regra da casa é que TODA autorização é verificada na Server
 *  Action (`guardAction`); um serviço que também autorizasse faria a segunda cópia da
 *  mesma regra, e a que ficasse para trás seria a porta aberta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CHAMADA É RESOLVIDA NO ESCOPO DO TENANT — E ISSO É A RECUSA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Todo acesso passa por `withTenant(tenantId, ...)`, que aplica `SET LOCAL
 *  app.tenant_id` na transação (invariante 2). A chamada é lida com `id` E
 *  `tenantId` no filtro: um id de chamada de OUTRA instituição não encontra linha, e
 *  o serviço responde `NOT_FOUND` — não "sem permissão", não erro de infraestrutura.
 *  A RLS é a última linha (invariante 3); o filtro explícito é a primeira, e é ele
 *  que faz a resposta ser a VERDADE ("não existe para você") em vez de um alarme.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TRILHA É DO ATO, E NÃO DO TEXTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada ação grava UMA entrada de auditoria com a ação explícita (`SALVAR_RASCUNHO`,
 *  `PUBLICAR_PARCIAL`, `PUBLICAR_FINAL`, `REABRIR`), o estado anterior, o novo e a
 *  contagem de publicados. O texto público NÃO entra: ele é público, mas a trilha não
 *  precisa carregá-lo — e uma trilha que copia conteúdo para outra tabela é um
 *  problema de privacidade em formação, não uma auditoria melhor (a mesma régua de
 *  `src/lib/admin/audit.ts`). Nenhum dado pessoal entra: a trilha não cita autor,
 *  e-mail nem nome de trabalho.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GRAVAÇÃO É ATÔMICA COM A TRILHA — E O FINAL NÃO SE PERDE NA CORRIDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Resultado e trilha commitam juntos (o `recordAudit` recebe o `tx`): a falha da
 *  gravação não deixa trilha de um ato que não existiu. (O `recordAudit` nunca lança
 *  por contrato da casa — uma falha ao AUDITAR não desfaz o ato; ver o comentário no
 *  ponto da chamada.) E dois atos concorrentes na MESMA chamada se serializam por
 *  `SELECT ... FOR UPDATE` na linha: sem o lock, dois pedidos leriam o mesmo
 *  `RASCUNHO` e o que publicasse o final poderia ser sobrescrito pelo que salvava um
 *  rascunho — o "final travado" viraria um rótulo que a concorrência desfaz
 *  (invariante 5: a concorrência é decidida no banco).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import {
  PROPOSAL_KINDS,
  PROPOSAL_KIND_LABELS,
  type ProposalKind,
} from '@/domain/proposals/call-rules';
import {
  SUBMISSION_STATUS_LABELS,
  availableCallResultActions,
  buildCallResultSelector,
  decideCallResultTransition,
  projectPublicCallResult,
  readCallResult,
  type CallResult,
  type CallResultAction,
  type CallResultAuthorSource,
  type CallResultContent,
  type CallResultRefusalCode,
  type CallResultSelectorOption,
  type CallResultSelectorSource,
  type CallResultSource,
  type CallResultState,
  type CallResultSubmissionSource,
  type PublicCallResultView,
} from '@/domain/proposals/call-result-rules';
import type { SubmissionStatus } from '@/domain/review/submission-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Tipos do serviço
// ───────────────────────────────────────────────────────────────────────────────
/**
 * As recusas do serviço: as do DOMÍNIO (transição ilegal, texto longo, id de outra
 * chamada…) mais as duas da aplicação. O código atravessa até a tela sem tradução —
 * é o que permite ao teste prender o MOTIVO da recusa, e não só o "não".
 */
export type CallResultErrorCode = CallResultRefusalCode | 'NOT_FOUND' | 'INTERNAL';

export type CallResultServiceResult<T> =
  | ({ ok: true } & T)
  | {
      ok: false;
      code: CallResultErrorCode;
      message: string;
      details?: Readonly<Record<string, string>>;
    };

/**
 * O que a tela do organizador recebe em UMA leitura.
 *
 * `resultado` é o que a tela EDITA; `publico` é o que o público VÊ hoje — os dois
 * saem da mesma leitura para a prévia não divergir da página (um segundo caminho
 * para o mesmo fato é como o documento passa a ter duas verdades).
 */
export interface CallResultPanel {
  callId: string;
  callTitle: string;
  callSlug: string;
  /** O tipo da chamada, pelo domínio — o rótulo NÃO é montado na tela. */
  kind: ProposalKind;
  kindLabel: string;
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  /** O resultado gravado, lido pelo leitor tolerante (nunca lança). */
  resultado: CallResult;
  /** `DEFAULT` = não havia resultado legível; `RESULT` = havia. */
  source: CallResultSource;
  /** As ações que o estado atual permite — a tela não decide isso sozinha. */
  acoesDisponiveis: readonly CallResultAction[];
  /** TODAS as submissões da chamada, com a decisão e a pré-marcação do domínio. */
  seletor: readonly CallResultSelectorOption[];
  /** O material da projeção pública (título, protocolo, tipo, autoria). */
  submissoes: readonly CallResultSubmissionSource[];
  /** O que o público vê AGORA (`null` = a seção não existe). */
  publico: PublicCallResultView | null;
  /**
   * O que a leitura precisou descartar — do JSON (`readCallResult`) e dos dados.
   * Vai para a tela para o organizador ser avisado em vez de ver um cartão vazio
   * sem explicação.
   */
  problems: readonly string[];
}

/** O que a action precisa saber depois de um ato — e os caminhos vêm do BANCO. */
export interface CallResultApplied {
  callId: string;
  eventId: string;
  eventSlug: string;
  callSlug: string;
  estado: CallResultState;
  /** A publicação vigente; ausente quando o ato não publicou (rascunho). */
  publicadoEm?: string;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Loga os problemas de uma leitura tolerante.
 *
 * O leitor NUNCA lança — é o que impede um JSON torto de derrubar a página da
 * chamada. Mas tolerar não é ignorar: sem esta linha, uma configuração corrompida
 * viraria "a seção não aparece" e ninguém saberia por quê. O log é a única
 * superfície que o operador tem para descobrir o defeito sem abrir o banco.
 */
function reportReadProblems(input: { origem: string; callId: string; problems: readonly string[] }): void {
  if (input.problems.length === 0) return;

  console.warn(
    `[proposals] ${input.origem} da chamada ${input.callId}: ${input.problems.join(' | ')}`,
  );
}

function isProposalKind(value: string): value is ProposalKind {
  return (PROPOSAL_KINDS as readonly string[]).includes(value);
}

function isSubmissionStatus(value: string): value is SubmissionStatus {
  return Object.prototype.hasOwnProperty.call(SUBMISSION_STATUS_LABELS, value);
}

/**
 * Os autores de uma submissão, com o sinal de ocultação.
 *
 * `publicProfileHiddenAt` é LIDO e entregue ao domínio mesmo sabendo que a projeção
 * pública desta superfície não o usa: a exceção do nome completo (decisão 2 do
 * humano na FASE 73) precisa ser VISÍVEL no dado, senão ela fica invisível no
 * serviço e ninguém consegue provar que a régua da E79 foi considerada e recusada
 * de propósito aqui. O sinal não vai ao público — a lista fechada do domínio o
 * proíbe, justamente para não revelar QUEM se oculta.
 *
 * Autor sem conta entra pelo `guestName` (coautor convidado); autor sem nome nenhum
 * é descartado — publicar um item de lista sem autoria seria esconder que a fonte
 * está incompleta, e a lista é um documento.
 */
function toAuthorSource(row: {
  guestName: string | null;
  user: { name: string; publicProfileHiddenAt: Date | null } | null;
}): CallResultAuthorSource[] {
  const nome = (row.user?.name ?? row.guestName ?? '').trim();

  if (nome.length === 0) return [];

  return [{ nome, oculto: row.user?.publicProfileHiddenAt != null }];
}

/**
 * O tipo da chamada em português, pelo DOMÍNIO (`PROPOSAL_KIND_LABELS`).
 *
 * O `kind` do banco é um enum; a checagem existe para a leitura não imprimir
 * `undefined` se um dia o enum do schema ganhar um valor que o domínio ainda não
 * conhece (o `Record` da tela é catraca do `tsc`, mas o banco não é).
 */
function kindOf(value: string): ProposalKind {
  return isProposalKind(value) ? value : 'OTHER';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura — a tela do organizador
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Carrega o resultado da chamada para a tela do organizador.
 *
 * Uma transação, três leituras encadeadas (chamada → submissões → nada mais): a
 * chamada é a chave, e as submissões só existem depois de saber QUAL chamada. Não
 * há ida ao banco por submissão — a autoria vem aninhada no `select`.
 *
 * `deletedAt: null` na submissão é a mesma régua do serviço da chamada: submissão
 * excluída não entra no seletor nem na lista pública (ela não existe mais para o
 * sistema, e publicá-la mostraria um trabalho que o autor retirou).
 */
export async function getCallResultPanel(input: {
  tenantId: string;
  callId: string;
}): Promise<CallResultServiceResult<{ panel: CallResultPanel }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const call = await tx.callForProposals.findFirst({
        where: { id: input.callId, tenantId: input.tenantId, deletedAt: null },
        select: {
          id: true,
          slug: true,
          title: true,
          kind: true,
          result: true,
          eventId: true,
          event: { select: { slug: true, title: true } },
        },
      });

      if (!call) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Chamada não encontrada.' };
      }

      const leitura = readCallResult(call.result);

      const rows = await tx.submission.findMany({
        where: { tenantId: input.tenantId, callId: call.id, deletedAt: null },
        orderBy: [{ protocol: 'asc' }],
        select: {
          id: true,
          protocol: true,
          title: true,
          status: true,
          authors: {
            orderBy: { authorOrder: 'asc' },
            select: {
              guestName: true,
              user: { select: { name: true, publicProfileHiddenAt: true } },
            },
          },
        },
      });

      const kind = kindOf(call.kind);
      const kindLabel = PROPOSAL_KIND_LABELS[kind];

      /**
       * O TIPO é o da CHAMADA, e não um campo de cada submissão: a proposta é uma
       * `Submission` criada sob a chamada, e todas as propostas dela são do mesmo
       * tipo (é o tipo que define os campos pedidos no formulário).
       *
       * Duas listas, e a diferença é de propósito: `submissoes` é o MATERIAL da
       * projeção pública (tudo o que está vivo) e `selecionaveis` é o que o seletor
       * da tela pode oferecer (só quem tem uma situação que o domínio reconhece).
       */
      const submissoes: CallResultSubmissionSource[] = [];
      const selecionaveis: CallResultSelectorSource[] = [];
      const problems: string[] = [...leitura.problems];

      for (const row of rows) {
        const autores = row.authors.flatMap(toAuthorSource);

        /**
         * O material da projeção é montado para TODAS as submissões vivas — inclusive
         * a de situação que o domínio não reconhece: tirá-la da lista pública
         * esconderia um trabalho em silêncio.
         */
        submissoes.push({
          id: row.id,
          protocol: row.protocol,
          titulo: row.title,
          tipo: kindLabel,
          autores,
        });

        if (!isSubmissionStatus(row.status)) {
          /**
           * O enum do banco garante a situação; esta linha existe para o dia em que
           * não garantir. Ela NÃO entra no seletor porque o domínio precisa de uma
           * decisão REAL para pré-marcar — inventar `SUBMITTED` ali faria a tela
           * mostrar uma situação que ninguém decidiu.
           */
          problems.push(
            `submissão ${row.id}: situação "${row.status}" desconhecida — ela não entra no seletor.`,
          );

          continue;
        }

        selecionaveis.push({
          id: row.id,
          titulo: row.title,
          tipo: kindLabel,
          status: row.status,
          autores: autores.map((autor) => autor.nome),
        });
      }

      const seletor = buildCallResultSelector({
        resultado: leitura.resultado,
        submissoes: selecionaveis,
      });

      /**
       * A prévia do que o público vê é montada AQUI, com as mesmas submissões e a
       * mesma função que a página pública usará (fatia 4). O organizador precisa
       * ver exatamente o documento que vai ao ar — e não uma segunda montagem que
       * envelhece no primeiro ajuste da projeção.
       */
      const projecao = projectPublicCallResult({
        resultado: leitura.resultado,
        submissoes,
      });

      problems.push(...projecao.problems);

      reportReadProblems({ origem: 'leitura do resultado', callId: call.id, problems });

      return {
        ok: true as const,
        panel: {
          callId: call.id,
          callTitle: call.title,
          callSlug: call.slug,
          kind,
          kindLabel,
          eventId: call.eventId,
          eventSlug: call.event.slug,
          eventTitle: call.event.title,
          resultado: leitura.resultado,
          source: leitura.source,
          acoesDisponiveis: availableCallResultActions(leitura.resultado.estado),
          seletor,
          submissoes,
          publico: projecao.view,
          problems,
        },
      };
    });
  } catch (error) {
    console.error(`[proposals] falha ao carregar o resultado da chamada: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível carregar o resultado da chamada.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escrita — o ato
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Aplica UMA ação do resultado: decide pelo domínio e grava o objeto inteiro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O `tenantId` ESTÁ NA ASSINATURA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Porque `withTenant` precisa dele: o contexto de tenant é o que aplica a RLS da
 *  transação (invariante 1 — o runtime NUNCA usa a role admin). Quem chama é a
 *  Server Action, com o `tenantId` que o `guardAction` resolveu do SLUG — nunca um
 *  id vindo do formulário.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A ORDEM DAS LEITURAS É A GARANTIA
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. `FOR UPDATE` na linha da chamada: dois atos concorrentes se serializam;
 *  2. a chamada (escopo do tenant) — `NOT_FOUND` se não for desta instituição;
 *  3. os ids das submissões DESTA chamada (`deletedAt: null`) — o domínio recusa
 *     id de outra chamada com o motivo, e o serviço não precisa saber disso;
 *  4. a decisão do domínio;
 *  5. a gravação do objeto inteiro + a trilha, na MESMA transação.
 *
 *  Se a decisão for recusada, NADA é gravado: o `withTenant` fecha a transação sem
 *  escrita, e o teste prende isso do lado do banco (não só da mensagem).
 */
export async function applyCallResultAction(input: {
  tenantId: string;
  callId: string;
  acao: CallResultAction;
  conteudo: CallResultContent;
  actorId: string;
}): Promise<CallResultServiceResult<CallResultApplied>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      /**
       * O lock vem ANTES da leitura — um lock depois não serializa nada. `FOR UPDATE`
       * na linha da chamada faz o segundo ato esperar o primeiro commitar e reler o
       * estado já novo; é assim que o final travado sobrevive à concorrência.
       */
      await tx.$executeRaw`
        SELECT id FROM "call_for_proposals"
         WHERE id = ${input.callId}::uuid
           AND "tenantId" = ${input.tenantId}::uuid
           AND "deletedAt" IS NULL
         FOR UPDATE
      `;

      const call = await tx.callForProposals.findFirst({
        where: { id: input.callId, tenantId: input.tenantId, deletedAt: null },
        select: {
          id: true,
          slug: true,
          result: true,
          eventId: true,
          event: { select: { slug: true } },
        },
      });

      if (!call) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Chamada não encontrada.' };
      }

      const leitura = readCallResult(call.result);

      reportReadProblems({ origem: 'leitura antes do ato', callId: call.id, problems: leitura.problems });

      const submissoes = await tx.submission.findMany({
        where: { tenantId: input.tenantId, callId: call.id, deletedAt: null },
        select: { id: true },
      });

      const decisao = decideCallResultTransition({
        atual: leitura.resultado,
        acao: input.acao,
        conteudo: input.conteudo,
        submissoesDaChamada: submissoes.map((submissao) => submissao.id),
        agora: new Date(),
      });

      if (!decisao.ok) return decisao;

      const resultado = decisao.resultado;

      await tx.callForProposals.update({
        where: { id: call.id },
        data: { result: resultado as unknown as object },
      });

      /**
       * A trilha na MESMA transação do resultado: se o `update` falhar, o ato não
       * existiu e a trilha não registra um fato que não aconteceu. O `recordAudit`
       * nunca lança por contrato da casa (uma falha ao AUDITAR não desfaz uma
       * operação de negócio já validada — ver `src/lib/admin/audit.ts`); o que a
       * transação garante é o vínculo entre os dois, e não que uma falha de trilha
       * desfaça o ato.
       *
       * A ação explícita entra como CAMPO da trilha — o enum `AuditAction` do schema
       * fala em CREATE/UPDATE/DELETE, e a pergunta "qual ato foi este?" é respondida
       * pelo nome da ação do resultado, não por "UPDATE".
       *
       * O TEXTO não entra (nem truncado): ele é público, mas a trilha não é o lugar
       * do conteúdo. E nada pessoal entra — nem autor, nem e-mail, nem título.
       */
      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'callForProposals',
          entityId: call.id,
          changes: {
            acao: { from: null, to: input.acao },
            estado: { from: leitura.resultado.estado, to: resultado.estado },
            publicados: {
              from: leitura.resultado.publicados.length,
              to: resultado.publicados.length,
            },
          },
        },
        tx,
      );

      return {
        ok: true as const,
        callId: call.id,
        eventId: call.eventId,
        eventSlug: call.event.slug,
        callSlug: call.slug,
        estado: resultado.estado,
        ...(resultado.publicadoEm === undefined ? {} : { publicadoEm: resultado.publicadoEm }),
      };
    });
  } catch (error) {
    console.error(`[proposals] falha ao aplicar o resultado da chamada: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível gravar o resultado da chamada.' };
  }
}
