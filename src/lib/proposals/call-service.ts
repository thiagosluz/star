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
 *  Quantas propostas chegaram e quantas já foram decididas. É o que responde "esta
 *  chamada está viva?" — e a conta é feita por `groupBy`, não em laço (o N+1 do
 *  diretório da FASE 32 vale aqui também).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { isValidSlug, normalizeSlug } from '@/domain/tenancy/resolution';
import { parseRubric, validateRubric, type RubricCriterion } from '@/domain/review/review-rules';
import {
  PROPOSAL_KIND_LABELS,
  callCountdown,
  callStateOf,
  callWindowLabel,
  defaultBlindFor,
  proposalFieldsFor,
  validateCallWindow,
  type CallState,
  type ProposalKind,
} from '@/domain/proposals/call-rules';

export type CallErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_WINDOW'
  | 'SLUG_TAKEN'
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
  requiresBlindReview: boolean;
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
  /** Propostas recebidas nesta chamada. */
  proposals: number;
  /** Quantas já têm decisão registrada. */
  decided: number;
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
  requiresBlindReview: boolean;
  maxSubmissionsPerAuthor: number;
  reviewRubric: unknown;
  trackId: string | null;
  track: { name: string } | null;
}

function toView(input: {
  row: CallRow;
  now: Date;
  timeZone: string;
  counts: { total: number; decided: number };
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
    proposals: input.counts.total,
    decided: input.counts.decided,
  };
}

/** Situações em que a proposta ainda está viva (não conta contra o limite do autor). */
const DEAD_STATUSES = ['WITHDRAWN', 'CANCELED', 'REJECTED'] as const;
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
  track: { select: { name: true } },
} as const;

async function countProposals(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  callIds: readonly string[],
): Promise<Map<string, { total: number; decided: number }>> {
  const counts = new Map<string, { total: number; decided: number }>();

  if (callIds.length === 0) return counts;

  const rows = await tx.submission.groupBy({
    by: ['callId', 'status'],
    where: { tenantId, callId: { in: [...callIds] }, deletedAt: null },
    _count: { _all: true },
  });

  for (const row of rows) {
    if (!row.callId) continue;

    const current = counts.get(row.callId) ?? { total: 0, decided: 0 };
    const alive = !DEAD_STATUSES.includes(row.status as (typeof DEAD_STATUSES)[number]);
    const decided = DECIDED_STATUSES.includes(row.status as (typeof DECIDED_STATUSES)[number]);

    counts.set(row.callId, {
      total: current.total + (alive ? row._count._all : 0),
      decided: current.decided + (decided ? row._count._all : 0),
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
            counts: counts.get(row.id) ?? { total: 0, decided: 0 },
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
            counts: counts.get(row.id) ?? { total: 0, decided: 0 },
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

      const counts = await countProposals(tx, input.tenantId, [row.id]);

      return {
        ok: true as const,
        call: toView({
          row,
          now: input.now,
          timeZone: row.event.timezone,
          counts: counts.get(row.id) ?? { total: 0, decided: 0 },
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
  requiresBlindReview?: boolean;
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
          select: { id: true },
        });

        if (!track) {
          return { ok: false as const, code: 'INVALID_INPUT' as const, message: 'Trilha não encontrada neste evento.' };
        }
      }

      const data = {
        kind: input.kind,
        slug,
        title,
        summary,
        instructions,
        opensAt,
        closesAt,
        requiresBlindReview: input.requiresBlindReview ?? defaultBlindFor(input.kind),
        maxSubmissionsPerAuthor: Math.max(0, Math.trunc(input.maxSubmissionsPerAuthor ?? 0)),
        trackId: input.trackId ?? null,
        reviewRubric: rubric as unknown as object,
      };

      if (input.callId) {
        const existing = await tx.callForProposals.findFirst({
          where: { id: input.callId, tenantId: input.tenantId, eventId: input.eventId, deletedAt: null },
          select: { id: true, kind: true },
        });

        if (!existing) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Chamada não encontrada.' };
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
          data: { ...data, kind: existing.kind },
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

      const proposals = await tx.submission.count({
        where: { tenantId: input.tenantId, callId: call.id, deletedAt: null },
      });

      if (proposals > 0) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: `Esta chamada já recebeu ${proposals} proposta(s): despublique em vez de excluir, para não perder o histórico.`,
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
  submittedAt: Date | null;
  authorName: string | null;
  authorEmail: string | null;
  finalScore: number | null;
  /** Campos do tipo, já ordenados para exibição. */
  data: readonly { label: string; value: string }[];
}

/**
 * As propostas de uma chamada, com o que o organizador precisa para decidir.
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
        where: { tenantId: input.tenantId, callId: call.id, deletedAt: null },
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
