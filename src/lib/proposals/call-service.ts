/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Chamadas de propostas (FASE 33)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE SERVIÇO É
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O painel que cria e publica as chamadas, e a leitura que alimenta a página
 *  pública e o bloco. A PROPOSTA em si não mora aqui: ela é uma `Submission` e vive
 *  no motor de avaliação da FASE 4 — este serviço só diz quais chamadas existem, em
 *  que estado elas estão e quantas propostas chegaram.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ESTADO É CALCULADO, E NUNCA GRAVADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `callStateOf` (domínio) roda em TODA leitura, com o "agora" vindo de fora. Não há
 *  coluna de situação nem job que "abre" a chamada: uma chamada agendada abre sozinha
 *  quando chega a hora, e uma que passou do prazo fecha sozinha. O painel, o bloco
 *  público e o formulário perguntam a MESMA função e recebem a mesma resposta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE O PAINEL MOSTRA DE NÚMERO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quantas propostas RECEBIDAS chegaram e quantas já foram decididas. É o que
 *  responde "esta chamada está viva?" — e a conta é feita por `groupBy`, não em laço
 *  (o N+1 do diretório da FASE 32 vale aqui também).
 *
 *  "Recebida" não é opinião deste serviço: a régua é a de
 *  `proposal-receipt-rules` (FASE 74), usada pela LISTA, pela CONTAGEM e pelo SELO
 *  da tela. Rascunho não entra na conta — e o rascunho COM arquivo, que é trabalho
 *  em andamento, ganha uma contagem própria em vez de inflar a de recebidas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { isValidSlug, normalizeSlug } from '@/domain/tenancy/resolution';
import { parseRubric, resolveEffectiveRubric, validateRubric, type RubricCriterion } from '@/domain/review/review-rules';
import { assertRubricShapeFree } from '@/lib/review/rubric-guard';
import {
  PROPOSAL_KIND_LABELS,
  callCountdown,
  callStateOf,
  callWindowLabel,
  defaultBlindFor,
  proposalFieldsFor,
  resolveRequiresBlindReview,
  validateCallWindow,
  type CallState,
  type ProposalKind,
} from '@/domain/proposals/call-rules';
import {
  readCallResult,
  SUBMISSION_STATUS_LABELS,
  type CallResultState,
} from '@/domain/proposals/call-result-rules';
import {
  DRAFT_SUBMISSION_STATUS,
  NOT_SENT_SUBMISSION_STATUSES,
  isReceivedProposal,
} from '@/domain/proposals/proposal-receipt-rules';

export type CallErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_WINDOW'
  | 'SLUG_TAKEN'
  /**
   * A FORMA da rubrica não pode mudar: já existe parecer enviado nesta chamada, e a
   * nota de quem avaliou deixaria de ser calculável (FASE 39).
   */
  | 'RUBRIC_FROZEN'
  | 'INTERNAL';

export type CallResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: CallErrorCode; message: string; details?: readonly string[] };

/** Teto de chamadas por evento: o painel é para ler, e a lista não precisa crescer sem fim. */
export const CALL_LIST_LIMIT = 50;

export interface CallView {
  id: string;
  kind: ProposalKind;
  kindLabel: string;
  slug: string;
  title: string;
  summary: string | null;
  instructions: string | null;
  opensAt: Date | null;
  closesAt: Date | null;
  isPublished: boolean;
  /**
   * O que a CHAMADA declara sobre cegueira — `null` = ela NÃO se pronuncia e a
   * TRILHA decide (FASE 74 · fatia 5).
   *
   * A coluna é lida crua de propósito: é este valor que a tela do organizador
   * devolve ao formulário, e é a única forma de distinguir "herdar" de "decidi
   * aberta". Para saber o que VALE, use `effectiveRequiresBlindReview`.
   */
  requiresBlindReview: boolean | null;
  /**
   * A cegueira EFETIVA, resolvida pelo domínio (`resolveRequiresBlindReview`):
   * CHAMADA → TRILHA → PADRÃO do tipo. É o que a página pública anuncia em "O que
   * esta chamada pede" — anunciar a declaração crua faria a página prometer revisão
   * aberta para uma chamada que HERDA de trilha cega, e o envio exigir o PDF
   * anonimizado na cara da pessoa.
   */
  effectiveRequiresBlindReview: boolean;
  maxSubmissionsPerAuthor: number;
  /**
   * Critérios PRÓPRIOS da chamada (vazio = usa a rubrica da trilha, e a padrão quando
   * também não há trilha). O painel precisa deles para EDITAR a rubrica sem apagar o
   * que já está gravado.
   */
  reviewRubric: readonly RubricCriterion[];
  trackId: string | null;
  trackName: string | null;
  state: CallState;
  /** Frase pronta da janela, no fuso do evento. */
  windowLabel: string;
  /** "fecha em 3 dias" — nulo quando não há prazo. */
  countdown: string | null;
  /**
   * Propostas RECEBIDAS nesta chamada.
   *
   * A régua é a de `proposal-receipt-rules` (FASE 74): rascunho não conta. É o
   * MESMO número que a lista de propostas mostra — sem isso o selo e a lista
   * poderiam divergir no dia seguinte (a catraca da F54).
   */
  proposals: number;
  /** Quantas já têm decisão registrada. */
  decided: number;
  /**
   * Rascunhos COM arquivo — trabalho em andamento, NÃO proposta recebida.
   *
   * `null` = a leitura não pediu essa conta (as chamadas públicas não precisam
   * dela e não pagam a consulta). Zero é "contei e não há", e a tela simplesmente
   * não mostra a frase nesse caso.
   */
  proposalsInProgress: number | null;
  /**
   * O estado do RESULTADO publicado (FASE 73 · fatia 4).
   *
   * A landing lê a chamada na renderização (ADR-168) e precisava saber se há
   * resultado publicado sem carregar o JSON: o bloco ganha o selo "Resultado
   * publicado" e um link para a página da chamada, que é onde o documento vive.
   *
   * É o ESTADO derivado por `readCallResult` — nunca o JSON cru. Ele é a única
   * informação do resultado que a projeção pública da chamada carrega, e por isso
   * nota, parecer, revisor e e-mail continuam impossíveis de vazar por aqui: eles
   * não são lidos.
   */
  resultState: CallResultState;
}

interface CallRow {
  id: string;
  kind: string;
  slug: string;
  title: string;
  summary: string | null;
  instructions: string | null;
  opensAt: Date | null;
  closesAt: Date | null;
  isPublished: boolean;
  /** Nulo = a chamada não se pronuncia: a trilha (e, sem ela, o tipo) decide. */
  requiresBlindReview: boolean | null;
  maxSubmissionsPerAuthor: number;
  reviewRubric: unknown;
  trackId: string | null;
  /** A trilha traz a cegueira quando a chamada cala (FASE 74 · fatia 5). */
  track: { name: string; requiresBlindReview: boolean } | null;
  /** O JSON do resultado — lido SÓ para derivar o estado público. */
  result: unknown;
}

/**
 * As contagens de UMA chamada, como `countProposals` as devolve.
 *
 * `inProgress` é `null` quando a leitura não pediu a conta — a mesma distinção da
 * F54 entre "contei e não há" (zero) e "não contei" (nulo).
 */
interface ProposalCounts {
  received: number;
  decided: number;
  inProgress: number | null;
}

function emptyCounts(includeInProgress: boolean): ProposalCounts {
  return { received: 0, decided: 0, inProgress: includeInProgress ? 0 : null };
}

function toView(input: {
  row: CallRow;
  now: Date;
  timeZone: string;
  counts: ProposalCounts;
}): CallView {
  const window = {
    isPublished: input.row.isPublished,
    opensAt: input.row.opensAt,
    closesAt: input.row.closesAt,
    now: input.now,
  };

  /**
   * A rubrica é LIDA pelo domínio, não convertida com `as`: um JSON malformado
   * chegaria ao painel como se fosse critério, e o organizador salvaria de volta o
   * defeito. Vazia significa "a chamada não tem rubrica própria".
   */
  const parsedRubric = parseRubric(input.row.reviewRubric);

  return {
    id: input.row.id,
    kind: input.row.kind as ProposalKind,
    kindLabel: PROPOSAL_KIND_LABELS[input.row.kind as ProposalKind],
    slug: input.row.slug,
    title: input.row.title,
    summary: input.row.summary,
    instructions: input.row.instructions,
    opensAt: input.row.opensAt,
    closesAt: input.row.closesAt,
    isPublished: input.row.isPublished,
    requiresBlindReview: input.row.requiresBlindReview,
    effectiveRequiresBlindReview: resolveRequiresBlindReview({
      callRequiresBlindReview: input.row.requiresBlindReview,
      trackRequiresBlindReview: input.row.track?.requiresBlindReview ?? null,
      kind: input.row.kind as ProposalKind,
    }).requiresBlindReview,
    maxSubmissionsPerAuthor: input.row.maxSubmissionsPerAuthor,
    /**
     * A rubrica é LIDA pelo domínio, não convertida com `as`: um JSON malformado
     * chegaria ao painel como se fosse critério, e o organizador salvaria de volta o
     * defeito. `parseRubric` devolve a lista válida e o painel mostra o que existe.
     */
    reviewRubric: parsedRubric.usedDefault ? [] : parsedRubric.rubric,
    trackId: input.row.trackId,
    trackName: input.row.track?.name ?? null,
    state: callStateOf(window),
    windowLabel: callWindowLabel({ ...input.row, timeZone: input.timeZone }),
    countdown: callCountdown({ closesAt: input.row.closesAt, now: input.now }),
    proposals: input.counts.received,
    decided: input.counts.decided,
    proposalsInProgress: input.counts.inProgress,
    /**
     * O estado DERIVADO, com o leitor tolerante da fatia 1: JSON torto cai em
     * SEM_RESULTADO — e "sem resultado" é o lado de menos público, que é sempre para
     * onde esta leitura pode errar. O `problems` fica de fora daqui de propósito: a
     * lista de chamadas não é o lugar de explicar a configuração de cada uma (o
     * painel do resultado, que é por chamada, já faz isso).
     */
    resultState: readCallResult(input.row.result).resultado.estado,
  };
}

/**
 * Situações com DECISÃO registrada — contadas à parte das recebidas.
 *
 * `REJECTED` aparece nas duas listas, e não é contradição: a proposta FOI recebida
 * (contra a decisão existe, e é isso que o organizador quer ver na fila) e TEM
 * decisão. Antes da fatia 6 a primeira contagem a excluía — e o painel escondia o
 * trabalho recusado como se ele nunca tivesse chegado.
 */
const DECIDED_STATUSES = ['ACCEPTED', 'REJECTED'] as const;

const CALL_SELECT = {
  id: true,
  kind: true,
  slug: true,
  title: true,
  summary: true,
  instructions: true,
  opensAt: true,
  closesAt: true,
  isPublished: true,
  requiresBlindReview: true,
  maxSubmissionsPerAuthor: true,
  reviewRubric: true,
  trackId: true,
  /**
   * A trilha traz o NOME (editores e listas) e a CEGUEIRA (a chamada que herda
   * precisa dela para resolver a precedência — FASE 74 · fatia 5).
   */
  track: { select: { name: true, requiresBlindReview: true } },
  /**
   * O JSON do resultado (FASE 73 · fatia 4). Ele entra na projeção pública porque a
   * landing precisa saber SE há resultado publicado — e o estado é DERIVADO por
   * `readCallResult`. Nenhum campo do resultado vira campo do `CallView`: o selo não
   * é o documento, e o texto/lista/proximos passos continuam só na página da chamada.
   */
  result: true,
} as const;

/**
 * As contagens das chamadas — recebidas, decididas e (quando pedido) em andamento.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA É A DO DOMÍNIO, E NÃO UM `notIn` ESCRITO AQUI
 * ─────────────────────────────────────────────────────────────────────────────
 *  `isReceivedProposal` decide o que soma em "recebidas" — a MESMA função que a
 *  lista filtra. Ela responde "o autor enviou?", e é por isso que retirada,
 *  cancelada e recusada CONTAM: o desfecho veio depois do envio, e a linha da lista
 *  mostra o status. Só o rascunho fica de fora. Escrever `status: { notIn: [...] }`
 *  aqui e outra lista na lista de propostas faria duas réguas que divergem no
 *  primeiro estado novo (armadilha 55).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CONTA DE "EM ANDAMENTO" É OPCIONAL
 * ─────────────────────────────────────────────────────────────────────────────
 *  Só o painel do organizador mostra trabalho em andamento; a página pública lê as
 *  mesmas chamadas e não tem o que fazer com esse número. Fazer a segunda consulta
 *  em toda leitura pública seria pagar por um dado que ninguém lê — por isso o
 *  chamador diz se quer, e o que não foi medido sai `null` (não zero).
 */
async function countProposals(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  callIds: readonly string[],
  options: { inProgress: boolean },
): Promise<Map<string, ProposalCounts>> {
  const counts = new Map<string, ProposalCounts>();

  if (callIds.length === 0) return counts;

  const [rows, drafts] = await Promise.all([
    tx.submission.groupBy({
      by: ['callId', 'status'],
      where: { tenantId, callId: { in: [...callIds] }, deletedAt: null },
      _count: { _all: true },
    }),
    /**
     * O trabalho em andamento é a TERCEIRA resposta da régua: rascunho com arquivo.
     * O filtro repete o critério da fatia 2 (`files` não excluídos) porque é ele que
     * decide se aquele rascunho sobrevive a uma nova tentativa — e um rascunho que
     * sobrevive é, por definição, trabalho que existe.
     */
    options.inProgress
      ? tx.submission.groupBy({
          by: ['callId'],
          where: {
            tenantId,
            callId: { in: [...callIds] },
            deletedAt: null,
            status: DRAFT_SUBMISSION_STATUS,
            files: { some: { deletedAt: null } },
          },
          _count: { _all: true },
        })
      : Promise.resolve([] as { callId: string | null; _count: { _all: number } }[]),
  ]);

  for (const draft of drafts) {
    if (!draft.callId) continue;

    counts.set(draft.callId, {
      ...(counts.get(draft.callId) ?? emptyCounts(options.inProgress)),
      inProgress: draft._count._all,
    });
  }

  for (const row of rows) {
    if (!row.callId) continue;

    const current = counts.get(row.callId) ?? emptyCounts(options.inProgress);
    const received = isReceivedProposal(row.status);
    const decided = DECIDED_STATUSES.includes(row.status as (typeof DECIDED_STATUSES)[number]);

    counts.set(row.callId, {
      received: current.received + (received ? row._count._all : 0),
      decided: current.decided + (decided ? row._count._all : 0),
      inProgress: current.inProgress,
    });
  }

  return counts;
}

/**
 * O fuso do evento, para as frases de janela saírem na hora LOCAL dele.
 *
 * Devolve `null` quando o evento não está visível — e isso acontece de verdade: a
 * instituição vizinha passando o id de um evento que não é dela (a RLS esconde a
 * linha). Antes isto era `findFirstOrThrow`, e o efeito era a leitura de uma
 * instituição responder "não foi possível carregar as chamadas" — um erro de
 * INFRAESTRUTURA para uma pergunta cuja resposta é "não existe". Quem chama
 * transforma o `null` em `NOT_FOUND`, que é a verdade.
 */
async function eventTimeZone(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  eventId: string,
): Promise<string | null> {
  const event = await tx.event.findFirst({
    where: { id: eventId, tenantId, deletedAt: null },
    select: { timezone: true },
  });

  return event?.timezone ?? null;
}

/** Todas as chamadas do evento — o painel. */
export async function listCalls(input: {
  tenantId: string;
  eventId: string;
  now: Date;
}): Promise<CallResult<{ calls: CallView[] }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const [rows, timeZone] = await Promise.all([
        tx.callForProposals.findMany({
          where: { tenantId: input.tenantId, eventId: input.eventId, deletedAt: null },
          orderBy: [{ isPublished: 'desc' }, { createdAt: 'desc' }],
          take: CALL_LIST_LIMIT,
          select: CALL_SELECT,
        }),
        eventTimeZone(tx, input.tenantId, input.eventId),
      ]);

      const counts = await countProposals(
        tx,
        input.tenantId,
        rows.map((row) => row.id),
        /** O painel é o único leitor que precisa do trabalho em andamento. */
        { inProgress: true },
      );

      if (!timeZone) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      return {
        ok: true as const,
        calls: rows.map((row) =>
          toView({
            row,
            now: input.now,
            timeZone,
            counts: counts.get(row.id) ?? emptyCounts(true),
          }),
        ),
      };
    });
  } catch (error) {
    console.error(`[proposals] falha ao listar chamadas: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível carregar as chamadas.' };
  }
}

/**
 * As chamadas que podem aparecer ao público.
 *
 * Só publicadas — e a página mostra também as AGENDADAS e ENCERRADAS, porque o
 * organizador costuma querer anunciar o prazo antes de abrir e deixar o histórico
 * visível depois. Quem decide o que exibir no bloco é a configuração dele.
 */
export async function listPublicCalls(input: {
  tenantId: string;
  eventId: string;
  now: Date;
}): Promise<CallResult<{ calls: CallView[] }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const [rows, timeZone] = await Promise.all([
        tx.callForProposals.findMany({
          where: { tenantId: input.tenantId, eventId: input.eventId, isPublished: true, deletedAt: null },
          orderBy: [{ closesAt: 'asc' }, { title: 'asc' }],
          take: CALL_LIST_LIMIT,
          select: CALL_SELECT,
        }),
        eventTimeZone(tx, input.tenantId, input.eventId),
      ]);

      const counts = await countProposals(
        tx,
        input.tenantId,
        rows.map((row) => row.id),
        /** A vitrine não mostra trabalho em andamento — não paga a consulta. */
        { inProgress: false },
      );

      if (!timeZone) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      return {
        ok: true as const,
        calls: rows.map((row) =>
          toView({
            row,
            now: input.now,
            timeZone,
            counts: counts.get(row.id) ?? emptyCounts(false),
          }),
        ),
      };
    });
  } catch (error) {
    console.error(`[proposals] falha ao listar chamadas públicas: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível carregar as chamadas.' };
  }
}

/**
 * Uma chamada pelo slug — o caminho do formulário público.
 *
 * Devolve também o evento (nome, fuso, situação), porque a página precisa dos dois e
 * uma segunda consulta só para isso seria uma ida a mais ao banco por acesso.
 */
export async function getCallBySlug(input: {
  tenantId: string;
  eventId: string;
  slug: string;
  now: Date;
}): Promise<
  CallResult<{
    call: CallView;
    event: { id: string; title: string; slug: string; timeZone: string; status: string };
  }>
> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const row = await tx.callForProposals.findFirst({
        where: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          slug: normalizeSlug(input.slug),
          deletedAt: null,
        },
        select: { ...CALL_SELECT, event: { select: { id: true, title: true, slug: true, timezone: true, status: true } } },
      });

      if (!row) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Chamada não encontrada.' };
      }

      const counts = await countProposals(tx, input.tenantId, [row.id], { inProgress: false });

      return {
        ok: true as const,
        call: toView({
          row,
          now: input.now,
          timeZone: row.event.timezone,
          counts: counts.get(row.id) ?? emptyCounts(false),
        }),
        event: {
          id: row.event.id,
          title: row.event.title,
          slug: row.event.slug,
          timeZone: row.event.timezone,
          status: row.event.status,
        },
      };
    });
  } catch (error) {
    console.error(`[proposals] falha ao carregar a chamada: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível carregar a chamada.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escrita (painel)
// ───────────────────────────────────────────────────────────────────────────────
export interface SaveCallInput {
  tenantId: string;
  eventId: string;
  actorId: string;
  /** Ausente cria; presente atualiza. */
  callId?: string;
  kind: ProposalKind;
  slug: string;
  title: string;
  summary?: string | null;
  instructions?: string | null;
  opensAt?: Date | null;
  closesAt?: Date | null;
  /**
   * A cegueira da chamada (FASE 74 · fatia 5). Três estados, e a diferença entre os
   * dois primeiros é a fatia inteira:
   *
   *   • `undefined` — "Padrão do tipo": a coluna recebe `defaultBlindFor(kind)`, o
   *     valor do TIPO, e a partir daí a chamada decide sozinha;
   *   • `null` — "Herdar da trilha": a coluna fica NULA e a TRILHA decide (sem
   *     trilha, o padrão do tipo);
   *   • `true`/`false` — a chamada decide sozinha, contra ou a favor da trilha.
   */
  requiresBlindReview?: boolean | null;
  maxSubmissionsPerAuthor?: number;
  trackId?: string | null;
  /**
   * Critérios PRÓPRIOS da chamada (FASE 33). Vazio significa "não tem rubrica
   * própria": a avaliação usa a da trilha e, sem trilha, a padrão.
   */
  reviewRubric?: readonly RubricCriterion[];
}

/**
 * Cria ou atualiza uma chamada.
 *
 * O TIPO não é editável depois de criado quando já existem propostas: as propostas
 * foram validadas pelos campos DAQUELE tipo, e trocar o tipo faria a lista mostrar
 * "(vazio)" em campos que ninguém pediu — e a etiqueta do painel mentir sobre o que
 * aquelas pessoas enviaram.
 */
export async function saveCall(
  input: SaveCallInput,
): Promise<CallResult<{ callId: string; created: boolean }>> {
  const slug = normalizeSlug(input.slug);
  const title = input.title.trim();
  const summary = input.summary?.trim() || null;
  const instructions = input.instructions?.trim() || null;
  const opensAt = input.opensAt ?? null;
  const closesAt = input.closesAt ?? null;

  if (title.length < 3 || title.length > 300) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Informe um título de 3 a 300 caracteres.' };
  }

  if (!isValidSlug(slug)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'O identificador da chamada aceita minúsculas, números e hífen (3 a 63 caracteres).',
    };
  }

  const window = validateCallWindow({ opensAt, closesAt });
  if (!window.ok) return { ok: false, code: 'INVALID_WINDOW', message: window.message };

  /**
   * A rubrica própria é validada pelo DOMÍNIO (`validateRubric`), a mesma função que
   * a trilha usa: peso zero, nota máxima negativa e chave duplicada são recusados com
   * o motivo, em vez de virarem um `parseRubric` que cai no padrão em silêncio — o
   * organizador acharia que configurou e a nota sairia por outros critérios.
   */
  const rubric = input.reviewRubric ?? [];

  if (rubric.length > 0) {
    const validation = validateRubric(rubric);

    if (!validation.valid) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'A rubrica tem problemas.',
        details: validation.errors.map((issue) => issue.message),
      };
    }
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true },
      });

      if (!event) return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };

      if (input.trackId) {
        const track = await tx.track.findFirst({
          where: { id: input.trackId, eventId: input.eventId, deletedAt: null },
          select: { id: true, reviewRubric: true },
        });

        if (!track) {
          return { ok: false as const, code: 'INVALID_INPUT' as const, message: 'Trilha não encontrada neste evento.' };
        }
      }

      /**
       * `undefined` NÃO é `null` aqui (FASE 74 · fatia 5): "não escolhi" preenche a
       * coluna com o padrão do TIPO; "escolhi herdar" grava `NULL` de propósito. Um
       * `?? defaultBlindFor(...)` trataria as duas coisas como a mesma e o
       * organizador nunca conseguiria devolver a decisão para a trilha.
       */
      const blindForType = (kind: ProposalKind): boolean | null =>
        input.requiresBlindReview === undefined
          ? defaultBlindFor(kind)
          : input.requiresBlindReview;

      const data = {
        kind: input.kind,
        slug,
        title,
        summary,
        instructions,
        opensAt,
        closesAt,
        requiresBlindReview: blindForType(input.kind),
        maxSubmissionsPerAuthor: Math.max(0, Math.trunc(input.maxSubmissionsPerAuthor ?? 0)),
        trackId: input.trackId ?? null,
        reviewRubric: rubric as unknown as object,
      };

      if (input.callId) {
        const existing = await tx.callForProposals.findFirst({
          where: { id: input.callId, tenantId: input.tenantId, eventId: input.eventId, deletedAt: null },
          select: { id: true, kind: true, reviewRubric: true, trackId: true },
        });

        if (!existing) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Chamada não encontrada.' };
        }

        /**
         * ─────────────────────────────────────────────────────────────────────
         *  A FORMA DA RUBRICA CONGELA A PARTIR DO PRIMEIRO PARECER (FASE 39)
         * ─────────────────────────────────────────────────────────────────────
         *  Os dois lados da comparação passam pela MESMA precedência que o revisor
         *  usa (`resolveEffectiveRubric`: CHAMADA → TRILHA → PADRÃO). Comparar o JSON
         *  gravado não bastaria: uma chamada sem rubrica própria herda a da trilha, e
         *  nesse caso gravar uma rubrica de cinco critérios mudaria a forma do mesmo
         *  jeito — só que sem parecer com a antiga.
         */
        const trackRubric = existing.trackId
          ? (
              await tx.track.findFirst({
                where: { id: existing.trackId, deletedAt: null },
                select: { reviewRubric: true },
              })
            )?.reviewRubric ?? null
          : null;

        const freeze = await assertRubricShapeFree(tx, {
          tenantId: input.tenantId,
          callId: existing.id,
          stored: existing.reviewRubric,
          submitted: resolveEffectiveRubric({
            callRubric: rubric.length > 0 ? rubric : null,
            trackRubric,
          }).rubric,
        });

        if (!freeze.ok) {
          return { ok: false as const, code: 'RUBRIC_FROZEN' as const, message: freeze.message };
        }

        const proposals = await tx.submission.count({
          where: { tenantId: input.tenantId, callId: existing.id, deletedAt: null },
        });

        if (proposals > 0 && existing.kind !== input.kind) {
          return {
            ok: false as const,
            code: 'INVALID_INPUT' as const,
            message:
              'Esta chamada já recebeu propostas: o tipo não pode mais mudar (os campos pedidos foram os do tipo atual).',
          };
        }

        await tx.callForProposals.update({
          where: { id: existing.id },
          /**
           * O tipo GRAVADO manda nos dois campos (FASE 74 · fatia 5): com propostas já
           * recebidas o tipo não muda, e "Padrão do tipo" precisa preencher a coluna
           * com o padrão do tipo que a chamada REALMENTE tem — senão o formulário que
           * mandasse outro tipo deixaria a cegueira dizendo "aberta" para um artigo.
           */
          data: {
            ...data,
            kind: existing.kind,
            requiresBlindReview:
              input.requiresBlindReview === undefined
                ? defaultBlindFor(existing.kind)
                : input.requiresBlindReview,
          },
        });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'callForProposals',
            entityId: existing.id,
            changes: {
              titulo: { from: null, to: title },
              janela: { from: null, to: `${opensAt?.toISOString() ?? '—'} → ${closesAt?.toISOString() ?? '—'}` },
            },
          },
          tx,
        );

        return { ok: true as const, callId: existing.id, created: false };
      }

      const id = randomUUID();

      await tx.callForProposals.create({
        data: {
          id,
          tenantId: input.tenantId,
          eventId: input.eventId,
          createdById: input.actorId,
          ...data,
        },
      });

      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  CRIAR UMA CHAMADA LIGA O INTERRUPTOR DO EVENTO (FASE 68)
       * ─────────────────────────────────────────────────────────────────────────────
       *  `Event.usesCall` é a declaração do organizador ("este evento recebe
       *  trabalhos"), e a chamada é o mesmo fato dito com o FATO. Sem esta linha, o
       *  evento que claramente recebe propostas ficava com a caixa desmarcada no
       *  formulário — e o painel de prontidão (F53) tratava "recebe trabalhos" como
       *  "não configurou".
       *
       *  Uma direção só: DESLIGAR continua sendo ato do organizador no formulário do
       *  evento (a chamada publicada nunca desliga o interruptor sozinha), e é por
       *  isso que nada devolve `false` aqui.
       */
      await tx.event.update({ where: { id: input.eventId }, data: { usesCall: true } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'callForProposals',
          entityId: id,
          changes: {
            tipo: { from: null, to: input.kind },
            titulo: { from: null, to: title },
            slug: { from: null, to: slug },
          },
        },
        tx,
      );

      return { ok: true as const, callId: id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        code: 'SLUG_TAKEN',
        message: 'Já existe uma chamada com este identificador neste evento.',
      };
    }

    console.error(`[proposals] falha ao salvar a chamada: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível salvar a chamada.' };
  }
}

/**
 * Publica ou despublica.
 *
 * Rascunho não aparece em lugar nenhum — nem no bloco, nem no endereço público. A
 * publicação é o ato de tornar a chamada visível, e é separada de salvar de
 * propósito: quem está montando o texto precisa poder salvar sem abrir a chamada.
 */
export async function setCallPublished(input: {
  tenantId: string;
  eventId: string;
  callId: string;
  actorId: string;
  isPublished: boolean;
}): Promise<CallResult<{ isPublished: boolean }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const updated = await tx.callForProposals.updateMany({
        where: { id: input.callId, tenantId: input.tenantId, eventId: input.eventId, deletedAt: null },
        data: { isPublished: input.isPublished },
      });

      if (updated.count === 0) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Chamada não encontrada.' };
      }

      /**
       * PUBLICAR também liga o interruptor do evento (FASE 68) — é o fato consumado:
       * uma chamada no ar é o evento recebendo trabalhos, mesmo que o organizador
       * tenha esquecido de marcar a caixa. Despublicar NÃO desliga: a declaração é
       * dele, e apagar a intenção por causa de uma pausa seria decidir por ele.
       *
       * ─────────────────────────────────────────────────────────────────────────────
       *  O `eventId` VEM DA CHAMADA, E NÃO DO CHAMADOR (FASE 68 · fatia 5)
       * ─────────────────────────────────────────────────────────────────────────────
       *  A versão original desta linha usava `input.eventId`. O campo existe no tipo,
       *  mas **um chamador real não o passava** (`tests/integration/rubric-freeze.test.ts`,
       *  a publicação da chamada que congela): o `event.update` recebia `id: undefined`
       *  e o Prisma lançava `PrismaClientValidationError` — a publicação da chamada
       *  devolvia `INTERNAL` e a suíte ficava vermelha por um motivo que não tinha nada
       *  a ver com a chamada. O `updateMany` acima NÃO pegava isso porque o filtro com
       *  `eventId: undefined` casa por `id` + `tenantId` e continua achando a linha.
       *
       *  A correção não é acrescentar o argumento no teste: é a linha passar a usar o
       *  `eventId` DA PRÓPRIA CHAMADA, que é o único fato verdadeiro aqui. Assim o
       *  interruptor é religado no evento certo — e não no que o chamador disse, nem em
       *  nenhum, quando ele não disse nada.
       */
      if (input.isPublished) {
        const chamada = await tx.callForProposals.findFirst({
          where: { id: input.callId, tenantId: input.tenantId, deletedAt: null },
          select: { eventId: true },
        });

        if (chamada) {
          await tx.event.update({ where: { id: chamada.eventId }, data: { usesCall: true } });
        }
      }

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'callForProposals',
          entityId: input.callId,
          changes: { publicada: { from: !input.isPublished, to: input.isPublished } },
        },
        tx,
      );

      return { ok: true as const, isPublished: input.isPublished };
    });
  } catch (error) {
    console.error(`[proposals] falha ao publicar a chamada: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível publicar a chamada.' };
  }
}

/**
 * Exclui (logicamente) a chamada.
 *
 * Recusa quando já há propostas: elas ficariam órfãs de chamada e o painel perderia
 * o contexto do que foi pedido. Despublicar é o caminho para tirar do ar sem perder
 * o histórico — e é o que a mensagem diz.
 */
export async function deleteCall(input: {
  tenantId: string;
  eventId: string;
  callId: string;
  actorId: string;
}): Promise<CallResult<{ deleted: true }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const call = await tx.callForProposals.findFirst({
        where: { id: input.callId, tenantId: input.tenantId, eventId: input.eventId, deletedAt: null },
        select: { id: true, title: true },
      });

      if (!call) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Chamada não encontrada.' };
      }

      /**
       * ── A GUARDA CONTA TUDO, E DIZ A VERDADE SOBRE O QUE CONTOU (FASE 74) ──
       * Excluir a chamada não apaga a submissão, mas deixa o rascunho do autor sem o
       * endereço onde ele foi começado — e é para lá que a tela manda a pessoa
       * continuar depois de uma recusa de prontidão. Por isso a exclusão é recusada
       * quando existe QUALQUER submissão, inclusive rascunho.
       *
       * O que NÃO pode é a recusa dizer "já recebeu 1 proposta" quando a chamada não
       * recebeu nenhuma: o número da mensagem sai da régua de proposta recebida, a
       * MESMA do painel. Sem isso, a tela diria "nenhuma proposta recebida" e o
       * botão de excluir responderia que uma chegou — a mentira só mudaria de lugar.
       */
      const received = await tx.submission.count({
        where: {
          tenantId: input.tenantId,
          callId: call.id,
          deletedAt: null,
          status: { notIn: [...NOT_SENT_SUBMISSION_STATUSES] },
        },
      });

      if (received > 0) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: `Esta chamada já recebeu ${received} proposta(s): despublique em vez de excluir, para não perder o histórico.`,
        };
      }

      const anySubmission = await tx.submission.count({
        where: { tenantId: input.tenantId, callId: call.id, deletedAt: null },
      });

      if (anySubmission > 0) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message:
            'Há rascunho de proposta ainda não enviado nesta chamada: excluí-la deixaria esse trabalho sem o endereço onde foi começado. Despublique em vez de excluir.',
        };
      }

      await tx.callForProposals.update({
        where: { id: call.id },
        data: { deletedAt: new Date(), isPublished: false },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'callForProposals',
          entityId: call.id,
          changes: { titulo: { from: call.title, to: null } },
        },
        tx,
      );

      return { ok: true as const, deleted: true as const };
    });
  } catch (error) {
    console.error(`[proposals] falha ao excluir a chamada: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível excluir a chamada.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  As propostas de uma chamada (painel)
// ───────────────────────────────────────────────────────────────────────────────
export interface CallProposalRow {
  id: string;
  protocol: string;
  title: string;
  status: string;
  /** O status em português, pronto para a linha da lista (fatia 6). */
  statusLabel: string;
  submittedAt: Date | null;
  authorName: string | null;
  authorEmail: string | null;
  finalScore: number | null;
  /** Campos do tipo, já ordenados para exibição. */
  data: readonly { label: string; value: string }[];
}

/**
 * As propostas RECEBIDAS de uma chamada, com o que o organizador precisa para decidir.
 *
 * A lista e o selo usam a MESMA régua (`proposal-receipt-rules`): a length daqui é
 * o número que `CallView.proposals` anuncia. Rascunho não entra — nem o vazio, resto
 * de tentativa que a fatia 2 reusa, nem o que tem arquivo (esse é trabalho em
 * andamento, contado à parte em `CallView.proposalsInProgress`). Retirada,
 * cancelada e recusada ENTRAM: foram enviadas, e é o status na linha que conta o
 * desfecho (fatia 6 — sumir com elas tirava informação do organizador).
 *
 * O nome/e-mail do proponente vem do AUTOR da submissão (a primeira linha de
 * autoria) — é dele que sai o convite no protocolo de aceite, e é o dado que a lista
 * mostra sem abrir cada proposta.
 */
export async function listCallProposals(input: {
  tenantId: string;
  callId: string;
  limit?: number;
}): Promise<CallResult<{ proposals: CallProposalRow[] }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const call = await tx.callForProposals.findFirst({
        where: { id: input.callId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, kind: true },
      });

      if (!call) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Chamada não encontrada.' };
      }

      const rows = await tx.submission.findMany({
        where: {
          tenantId: input.tenantId,
          callId: call.id,
          deletedAt: null,
          /**
           * ── A LISTA OBEDECE À MESMA RÉGUA DO SELO (FASE 74 · fatias 3 e 6) ──
           *  "Propostas recebidas" é o que `isReceivedProposal` diz que é: só o
           *  rascunho não foi enviado. A fatia 3 excluía também retirada,
           *  cancelada e recusada para alinhar a lista à contagem antiga — e o
           *  conserto da fatia 6 foi corrigir a DEFINIÇÃO, não esconder a linha:
           *  agora as duas contam o que foi enviado e a lista mostra o status.
           *
           *  O filtro sai da lista do DOMÍNIO — e não de um `notIn` escrito aqui —
           *  para a lista e a contagem do selo não divergirem (a catraca da F54:
           *  número e frase da mesma fonte).
           */
          status: { notIn: [...NOT_SENT_SUBMISSION_STATUSES] },
        },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        take: Math.min(Math.max(1, input.limit ?? 100), 300),
        select: {
          id: true,
          protocol: true,
          title: true,
          status: true,
          submittedAt: true,
          finalScore: true,
          proposalData: true,
          authors: {
            orderBy: { authorOrder: 'asc' },
            take: 1,
            select: { userId: true, guestName: true, guestEmail: true, user: { select: { name: true, email: true } } },
          },
        },
      });

      const fields = proposalFieldsFor(call.kind as ProposalKind);

      return {
        ok: true as const,
        proposals: rows.map((row) => {
          const data = (row.proposalData as Record<string, string | number>) ?? {};
          const author = row.authors[0];

          return {
            id: row.id,
            protocol: row.protocol,
            title: row.title,
            status: row.status,
            /**
             * O RÓTULO VEM DO DOMÍNIO, pronto (fatia 6). A linha mostrava o status
             * CRU do banco (`WITHDRAWN`), que é vocabulário do schema e não do
             * organizador; a tradução mora em `SUBMISSION_STATUS_LABELS`, a mesma
             * que o comitê e o resultado da chamada usam. Um status novo que escape
             * do mapa cai no próprio código — visível, em vez de virar "undefined".
             */
            statusLabel:
              (SUBMISSION_STATUS_LABELS as Readonly<Record<string, string>>)[row.status] ??
              row.status,
            submittedAt: row.submittedAt,
            authorName: author?.user?.name ?? author?.guestName ?? null,
            authorEmail: author?.user?.email ?? author?.guestEmail ?? null,
            finalScore: row.finalScore === null ? null : Number(row.finalScore),
            data: fields
              .filter((field) => data[field.key] !== undefined)
              .map((field) => ({ label: field.label, value: String(data[field.key]) })),
          };
        }),
      };
    });
  } catch (error) {
    console.error(`[proposals] falha ao listar as propostas: ${errorMessage(error)}`);

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível carregar as propostas.' };
  }
}
