'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CASOS DE USO EXPOSTOS AO BROWSER — Chamadas de propostas (FASE 33)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS PORTAS, TRÊS AUTORIZAÇÕES DIFERENTES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. PAINEL (`saveCallAction`, `setCallPublishedAction`, `deleteCallAction`, e as
 *     quatro ações do RESULTADO da FASE 73) — quem organiza a chamada precisa de
 *     `event:manage`: montar a chamada é ato de organização do evento, não de quem
 *     submete nem de quem julga. Publicar o resultado é o MESMO ato de organização
 *     (é o documento que a instituição assina), e por isso usa a MESMA permissão da
 *     tela de chamadas — não uma permissão nova.
 *
 *  2. FORMULÁRIO PÚBLICO (`submitProposalAction`) — a porta é a PÁGINA PÚBLICA, e
 *     por isso ela usa `guardSelfServiceAction`, não `guardAction`: quem chega para
 *     propor pode ainda NÃO TER VÍNCULO com a instituição (o vínculo nasce da
 *     própria proposta, pelo mesmo mecanismo da inscrição pública da FASE 10). Exigir
 *     vínculo ativo aqui recusaria exatamente o caso normal — a mesma lição da
 *     armadilha 72, na direção oposta.
 *
 *  3. PROTOCOLO DE ACEITE (`acceptProposalAction`) — decidir é `submission:decide`,
 *     a MESMA permissão do comitê científico. O aceite NÃO cria um segundo caminho de
 *     decisão: ele chama o motor de decisão da FASE 16 e acrescenta, POR ESCOLHA do
 *     organizador, a criação da atividade e o convite ao palestrante.
 *
 *  O que o organizador escolhe e o que o sistema decide está separado de propósito:
 *  a DECISÃO é do comitê; criar a atividade e convidar são atos organizacionais, com
 *  caixas próprias no formulário. Nada acontece "de automático" por aceitar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { guardAction, guardSelfServiceAction, type ActionGuardState } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getPublicEvent } from '@/lib/events/event-repository';
import { isValidTimeZone, zonedWallTimeToInstant } from '@/domain/events/scheduling-rules';
import {
  PROPOSAL_KINDS,
  PROPOSAL_LONG_TEXT_MAX,
  proposalFieldsFor,
} from '@/domain/proposals/call-rules';
import { buildRubricFromRows } from '@/domain/review/review-rules';
import type { RubricCriterion } from '@/domain/review/review-rules';
import {
  deleteCall,
  getCallBySlug,
  saveCall,
  setCallPublished,
} from '@/lib/proposals/call-service';
import { applyCallResultAction } from '@/lib/proposals/call-result-service';
import type { CallResultAction } from '@/domain/proposals/call-result-rules';
import { submitProposal } from '@/lib/proposals/proposal-service';
import { acceptProposal } from '@/lib/proposals/acceptance-service';
import {
  rewardSubmissionAcceptedById,
  rewardSubmissionSubmittedById,
} from '@/lib/gamification/hooks';

export interface CallActionState extends ActionGuardState {
  /** Protocolo devolvido a quem propôs — é com ele que a organização acha a proposta. */
  protocol?: string;
  /** Caminho para onde o proponente pode ir depois de enviar. */
  redirectTo?: string;
}

/** Campo de texto opcional: `""` é ausência, não string vazia. */
function nullable(value: FormDataEntryValue | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Converte `<input type="datetime-local">` em instante **NO FUSO DO EVENTO**.
 *
 * A lição é da FASE 24 (item E17) e vale igual aqui: `new Date(texto)` interpreta a
 * hora de parede no fuso do PROCESSO — UTC no container. O organizador digita "18:00"
 * e o prazo fecha às 15:00, sem erro e sem nada na tela explicando por quê. O fuso
 * viaja em campo oculto porque é ele que a tela MOSTROU a quem digitou.
 */
function toCallInstant(
  value: FormDataEntryValue | null | undefined,
  timeZone: string,
): { ok: true; date: Date | null } | { ok: false; message: string } {
  const text = nullable(value);
  if (!text) return { ok: true, date: null };

  const date = zonedWallTimeToInstant(text, timeZone);
  if (!date) {
    return {
      ok: false,
      message: `A data "${text}" não é válida (use o formato do campo, ex.: 2026-12-01T18:00).`,
    };
  }

  return { ok: true, date };
}

/** O fuso do evento, vindo do formulário — com o caminho de volta declarado. */
function formTimeZone(value: FormDataEntryValue | null | undefined): string {
  const text = nullable(value);
  return text && isValidTimeZone(text) ? text : 'UTC';
}

/**
 * Lê a rubrica própria da chamada das listas paralelas do formulário.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE LISTAS PARALELAS, E NÃO JSON
 * ─────────────────────────────────────────────────────────────────────────────
 *  É o mesmo caminho da rubrica da TRILHA (FASE 4, `saveTrackAction`): quatro campos
 *  por linha (critério, rótulo, peso, nota máxima), sem exigir JSON de quem organiza.
 *  Linha sem critério é descartada — quem abre o formulário e não preenche nada está
 *  dizendo "esta chamada não tem rubrica própria", e não "salve uma rubrica vazia".
 */
function readRubric(formData: FormData): RubricCriterion[] {
  /**
   * A conversão linha → critério vive no DOMÍNIO (`buildRubricFromRows`): a chave é
   * derivada do rótulo quando a linha é nova e preservada quando já existe, e linha
   * sem rótulo é descartada. Uma segunda cópia desta regra no painel da chamada
   * divergiria da que a trilha usa (armadilha 55).
   */
  return buildRubricFromRows({
    keys: formData.getAll('rubricKey'),
    labels: formData.getAll('rubricLabel'),
    weights: formData.getAll('rubricWeight'),
    maxScores: formData.getAll('rubricMaxScore'),
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Painel — montar a chamada
// ───────────────────────────────────────────────────────────────────────────────
const saveCallSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid('Evento inválido.'),
  eventSlug: z.string().trim().min(1).max(120),
  callId: z.string().uuid().optional(),
  kind: z.enum(PROPOSAL_KINDS),
  slug: z.string().trim().min(3, 'Informe um identificador com ao menos 3 caracteres.').max(63),
  title: z.string().trim().min(3, 'Informe um título com ao menos 3 caracteres.').max(300),
  summary: z.string().trim().max(PROPOSAL_LONG_TEXT_MAX).optional(),
  instructions: z.string().trim().max(PROPOSAL_LONG_TEXT_MAX).optional(),
  opensAt: z.string().trim().max(32).optional(),
  closesAt: z.string().trim().max(32).optional(),
  /**
   * `""` = padrão do tipo; `inherit` = HERDAR DA TRILHA (grava `null` na coluna);
   * `on` = forçar revisão cega; `off` = forçar aberta.
   *
   * Um checkbox não serviria: desmarcado ele seria indistinguível de "não perguntei",
   * e o padrão do tipo (que é `true` para artigo e pôster) nunca voltaria a valer.
   * E um booleano não serviria depois da FASE 74 · fatia 5: "não me pronuncio" (a
   * trilha decide) é coisa diferente de "decidi aberta", e só o terceiro estado
   * carrega essa diferença até a coluna.
   */
  blind: z.string().trim().max(16).optional(),
  maxSubmissionsPerAuthor: z.coerce.number().int().min(0).max(50).optional(),
  trackId: z.string().uuid().optional(),
  eventTimezone: z.string().trim().max(64).optional(),
});

export async function saveCallAction(
  _prev: CallActionState | null,
  formData: FormData,
): Promise<CallActionState> {
  const parsed = saveCallSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    eventSlug: formData.get('eventSlug'),
    callId: nullable(formData.get('callId')) ?? undefined,
    kind: formData.get('kind'),
    slug: formData.get('slug'),
    title: formData.get('title'),
    summary: nullable(formData.get('summary')) ?? undefined,
    instructions: nullable(formData.get('instructions')) ?? undefined,
    opensAt: nullable(formData.get('opensAt')) ?? undefined,
    closesAt: nullable(formData.get('closesAt')) ?? undefined,
    blind: nullable(formData.get('requiresBlindReview')) ?? undefined,
    maxSubmissionsPerAuthor: nullable(formData.get('maxSubmissionsPerAuthor')) ?? undefined,
    trackId: nullable(formData.get('trackId')) ?? undefined,
    eventTimezone: nullable(formData.get('eventTimezone')) ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados do formulário inválidos.',
    };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
  });

  if (!auth.ok) return auth.state;

  const data = parsed.data;
  const timeZone = formTimeZone(data.eventTimezone);

  const opensAt = toCallInstant(data.opensAt ?? null, timeZone);
  if (!opensAt.ok) return { ok: false, code: 'INVALID_INPUT', message: opensAt.message };

  const closesAt = toCallInstant(data.closesAt ?? null, timeZone);
  if (!closesAt.ok) return { ok: false, code: 'INVALID_INPUT', message: closesAt.message };

  const result = await saveCall({
    tenantId: auth.tenantId,
    eventId: data.eventId,
    actorId: auth.userId,
    callId: data.callId,
    kind: data.kind,
    slug: data.slug,
    title: data.title,
    summary: data.summary ?? null,
    instructions: data.instructions ?? null,
    opensAt: opensAt.date,
    closesAt: closesAt.date,
    /**
     * `undefined` deixa o serviço aplicar o padrão do TIPO (FASE 33, ADR-160) e
     * `'inherit'` grava `NULL` — a chamada não se pronuncia e a TRILHA decide
     * (FASE 74 · fatia 5). São estados diferentes: o primeiro preenche a coluna, o
     * segundo deixa a coluna vazia de propósito.
     */
    requiresBlindReview:
      data.blind === undefined ? undefined : data.blind === 'inherit' ? null : data.blind === 'on',
    maxSubmissionsPerAuthor: data.maxSubmissionsPerAuthor ?? 0,
    trackId: data.trackId ?? null,
    reviewRubric: readRubric(formData),
  });

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: result.message,
      details: 'details' in result ? result.details : undefined,
    };
  }

  revalidateCallPaths({
    tenantSlug: data.tenantSlug,
    eventSlug: data.eventSlug,
    eventId: data.eventId,
  });

  return {
    ok: true,
    message: result.created
      ? 'Chamada criada. Ela ainda NÃO está no ar: publique quando o texto estiver pronto.'
      : 'Chamada atualizada.',
    data: { callId: result.callId, timeZone },
  };
}

const callIdSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid('Evento inválido.'),
  eventSlug: z.string().trim().min(1).max(120),
  callId: z.string().uuid('Chamada inválida.'),
});

export async function setCallPublishedAction(
  _prev: CallActionState | null,
  formData: FormData,
): Promise<CallActionState> {
  const parsed = callIdSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    eventSlug: formData.get('eventSlug'),
    callId: formData.get('callId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados do formulário inválidos.' };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
  });

  if (!auth.ok) return auth.state;

  const isPublished = formData.get('isPublished') === 'on';

  const result = await setCallPublished({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    callId: parsed.data.callId,
    actorId: auth.userId,
    isPublished,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateCallPaths({
    tenantSlug: parsed.data.tenantSlug,
    eventSlug: parsed.data.eventSlug,
    eventId: parsed.data.eventId,
  });

  return {
    ok: true,
    message: isPublished
      ? 'Chamada publicada — ela já pode aparecer na página pública.'
      : 'Chamada despublicada. As propostas já recebidas continuam aqui.',
  };
}

export async function deleteCallAction(
  _prev: CallActionState | null,
  formData: FormData,
): Promise<CallActionState> {
  const parsed = callIdSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    eventSlug: formData.get('eventSlug'),
    callId: formData.get('callId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados do formulário inválidos.' };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
  });

  if (!auth.ok) return auth.state;

  const result = await deleteCall({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    callId: parsed.data.callId,
    actorId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateCallPaths({
    tenantSlug: parsed.data.tenantSlug,
    eventSlug: parsed.data.eventSlug,
    eventId: parsed.data.eventId,
  });

  return { ok: true, message: 'Chamada excluída.' };
}

/**
 * O painel e a página pública leem a mesma chamada: os dois precisam ser revalidados.
 *
 * `callSlug` existe para o ato do RESULTADO, que muda uma página pública específica
 * (a da chamada) além da landing: revalidar só o `layout` do evento funcionaria,
 * mas deixaria o caminho da call page implícito — e um dia alguém move a seção de
 * resultado para fora do layout sem perceber que a revalidação parou de alcançá-la.
 */
function revalidateCallPaths(input: {
  tenantSlug: string;
  eventSlug: string;
  eventId: string;
  callSlug?: string;
}): void {
  revalidatePath(tenantPath(input.tenantSlug, `/administracao/eventos/${input.eventId}/chamadas`), 'page');

  if (input.callSlug) {
    revalidatePath(
      tenantPath(input.tenantSlug, `/eventos/${input.eventSlug}/chamada/${input.callSlug}`),
      'page',
    );
  }

  revalidatePath(tenantPath(input.tenantSlug, `/eventos/${input.eventSlug}`), 'layout');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Resultado da chamada (FASE 73 · fatia 2)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Os limites de TRANSPORTE, e não de regra.
 *
 * O teto de verdade é do DOMÍNIO (`CALL_RESULT_TEXT_MAX`, `CALL_RESULT_PUBLISHED_MAX`),
 * e é ele que precisa produzir a mensagem que o organizador lê. Se o zod recusasse
 * antes, com um limite igual, a tela mostraria "dados inválidos" no lugar de "o texto
 * passa de 4000 caracteres" — e o teste do texto longo deixaria de provar o domínio.
 * Estes números existem só para uma requisição montada à mão não arrastar um corpo
 * sem tamanho para dentro do processo.
 */
const RESULT_TRANSPORT_TEXT_MAX = 200_000;
const RESULT_TRANSPORT_IDS_MAX = 2_000;

const callResultSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  callId: z.string().uuid('Chamada inválida.'),
  texto: z.string().max(RESULT_TRANSPORT_TEXT_MAX).optional(),
  proximosPassos: z.string().max(RESULT_TRANSPORT_TEXT_MAX).optional(),
  /**
   * A lista vem de CHECKBOXES de mesmo nome — o padrão da casa para lista em
   * formulário que funciona sem JavaScript (`formData.getAll`), o mesmo das seleções
   * de participantes das F56/F70. Um item por caixa marcada, na ordem do formulário.
   *
   * O id NÃO é validado como uuid aqui de propósito: quem sabe se o id é de uma
   * submissão DESTA chamada é o domínio (`ID_FORA_DA_CHAMADA`), e é a mensagem dele
   * que a tela precisa mostrar. Validar o formato antes trocaria o motivo por um
   * genérico.
   */
  publicados: z.array(z.string().max(64)).max(RESULT_TRANSPORT_IDS_MAX).optional(),
});

const RESULT_ACTION_MESSAGES: Readonly<Record<CallResultAction, string>> = {
  SALVAR_RASCUNHO: 'Rascunho salvo. Nada aparece no público enquanto o resultado não for publicado.',
  PUBLICAR_PARCIAL:
    'Resultado parcial publicado — ele já aparece na página da chamada e continua editável.',
  PUBLICAR_FINAL:
    'Resultado final publicado. Ele está travado: para mudar, reabra o resultado final.',
  REABRIR: 'Resultado reaberto como parcial — ele continua no ar e voltou a ser editável.',
};

/**
 * O caminho comum das quatro ações.
 *
 * As quatro fazem a MESMA coisa com um nome diferente de ato: validar o formulário,
 * autorizar, chamar o serviço, devolver a mensagem do domínio e revalidar. Uma função
 * por ação com o corpo copiado faria a autorização divergir na primeira manutenção
 * (armadilha 55) — e a autorização é o pior lugar para uma cópia divergir.
 */
async function runResultAction(input: {
  acao: CallResultAction;
  formData: FormData;
}): Promise<CallActionState> {
  const parsed = callResultSchema.safeParse({
    tenantSlug: input.formData.get('tenantSlug'),
    callId: input.formData.get('callId'),
    texto: nullable(input.formData.get('texto')) ?? undefined,
    proximosPassos: nullable(input.formData.get('proximosPassos')) ?? undefined,
    publicados: input.formData
      .getAll('publicados')
      .filter((value): value is string => typeof value === 'string'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados do formulário inválidos.',
    };
  }

  /** A MESMA permissão da tela de chamadas (`chamadas/page.tsx` usa `event:manage`). */
  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
  });

  if (!auth.ok) return auth.state;

  const result = await applyCallResultAction({
    tenantId: auth.tenantId,
    callId: parsed.data.callId,
    acao: input.acao,
    conteudo: {
      texto: parsed.data.texto ?? '',
      proximosPassos: parsed.data.proximosPassos ?? '',
      publicados: parsed.data.publicados ?? [],
    },
    actorId: auth.userId,
  });

  if (!result.ok) {
    /**
     * A mensagem é a DO DOMÍNIO, sem tradução: é ela que diz "o resultado final está
     * travado, reabra" e "esta submissão não é desta chamada". Os `details` viram a
     * lista que o `ActionGuardState` já carrega — o diagnóstico não se perde.
     */
    return {
      ok: false,
      code: result.code,
      message: result.message,
      details: result.details ? Object.values(result.details) : undefined,
    };
  }

  /**
   * Os caminhos vêm do BANCO (o serviço devolve o evento e o slug da chamada que ele
   * gravou), e não do formulário. É a lição da FASE 68 no `setCallPublished`: um id de
   * evento vindo do cliente revalida o caminho errado — e ninguém percebe, porque a
   * revalidação não falha.
   */
  revalidateCallPaths({
    tenantSlug: parsed.data.tenantSlug,
    eventId: result.eventId,
    eventSlug: result.eventSlug,
    callSlug: result.callSlug,
  });

  return {
    ok: true,
    message: RESULT_ACTION_MESSAGES[input.acao],
    data: {
      estado: result.estado,
      ...(result.publicadoEm === undefined ? {} : { publicadoEm: result.publicadoEm }),
    },
  };
}

export async function saveCallResultDraftAction(
  _prev: CallActionState | null,
  formData: FormData,
): Promise<CallActionState> {
  return runResultAction({ acao: 'SALVAR_RASCUNHO', formData });
}

export async function publishPartialCallResultAction(
  _prev: CallActionState | null,
  formData: FormData,
): Promise<CallActionState> {
  return runResultAction({ acao: 'PUBLICAR_PARCIAL', formData });
}

export async function publishFinalCallResultAction(
  _prev: CallActionState | null,
  formData: FormData,
): Promise<CallActionState> {
  return runResultAction({ acao: 'PUBLICAR_FINAL', formData });
}

export async function reopenCallResultAction(
  _prev: CallActionState | null,
  formData: FormData,
): Promise<CallActionState> {
  return runResultAction({ acao: 'REABRIR', formData });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Público — enviar a proposta
// ───────────────────────────────────────────────────────────────────────────────
const proposalSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventSlug: z.string().trim().min(1).max(120),
  callSlug: z.string().trim().min(1).max(63),
  title: z.string().trim().min(3, 'Informe um título com ao menos 3 caracteres.').max(300),
  abstract: z.string().trim().min(30, 'Escreva um resumo com ao menos 30 caracteres.').max(6000),
  keywords: z.string().trim().max(400).optional(),
  language: z.string().trim().max(16).optional(),
});

/**
 * Envia uma proposta pela chamada pública.
 *
 * O formulário carrega os SLUGS, não os ids: o id da chamada é resolvido aqui, no
 * servidor, a partir do caminho que a pessoa abriu. Um id em campo oculto é um id que
 * o cliente escolhe.
 */
export async function submitProposalAction(
  _prev: CallActionState | null,
  formData: FormData,
): Promise<CallActionState> {
  const parsed = proposalSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventSlug: formData.get('eventSlug'),
    callSlug: formData.get('callSlug'),
    title: formData.get('title'),
    abstract: formData.get('abstract'),
    keywords: nullable(formData.get('keywords')) ?? undefined,
    language: nullable(formData.get('language')) ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados do formulário inválidos.',
    };
  }

  const data = parsed.data;
  const callPath = tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}/chamada/${data.callSlug}`);

  const context = await guardSelfServiceAction({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_CREATE,
  });

  if (!context.ok) {
    if (context.reason === 'FORBIDDEN') {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Seu perfil não tem permissão para propor nesta instituição.',
      };
    }

    // Sem sessão: o caminho é entrar (ou criar a conta) e voltar para ESTA chamada.
    redirect(`/login?redirectTo=${encodeURIComponent(callPath)}`);
  }

  const event = await getPublicEvent(context.tenantId, data.eventSlug);
  if (!event) {
    return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
  }

  const call = await getCallBySlug({
    tenantId: context.tenantId,
    eventId: event.id,
    slug: data.callSlug,
    now: new Date(),
  });

  if (!call.ok) {
    return { ok: false, code: call.code, message: call.message };
  }

  /**
   * Os campos POR TIPO são lidos do formulário pela lista de campos do tipo — e não
   * por uma lista fixa aqui. Assim, acrescentar um campo a um tipo no domínio já o
   * faz chegar à proposta, sem tocar nesta action (a validação continua sendo do
   * domínio, que é quem sabe o que é obrigatório).
   */
  const raw: Record<string, unknown> = {};
  for (const field of proposalFieldsFor(call.call.kind)) {
    const value = nullable(formData.get(`campo.${field.key}`));
    if (value !== null) raw[field.key] = value;
  }

  const keywords = (data.keywords ?? '')
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .slice(0, 12);

  const result = await submitProposal({
    tenantId: context.tenantId,
    eventId: event.id,
    callId: call.call.id,
    userId: context.userId,
    title: data.title,
    abstract: data.abstract,
    keywords,
    language: data.language,
    data: raw,
    tenantSlug: data.tenantSlug,
  });

  if (!result.ok) {
    /**
     * ═══════════════════════════════════════════════════════════════════════════
     *  A RECUSA DE PRONTIDÃO LEVA AO RASCUNHO — SEM TELA INTERMEDIÁRIA
     *  (FASE 74 · ajuste da fatia 2)
     * ═══════════════════════════════════════════════════════════════════════════
     *
     *  ─────────────────────────────────────────────────────────────────────────────
     *  O QUE MUDOU, E POR QUÊ
     * ─────────────────────────────────────────────────────────────────────────────
     *  A fatia 2 devolvia o `submissionId` e a tela mostrava um link "Continuar na
     *  área do autor". Funcionava, mas cobrava um passo de quem já tinha acabado de
     *  escrever a proposta e só queria anexar o arquivo: a recusa não é um erro a
     *  ler, é o fim de um caminho que continua em outro lugar.
     *
     *  Agora a action REDIRECIONA para o rascunho que o serviço acabou de gravar. O
     *  `redirect` do framework é a exceção deliberada à regra de "erro como valor":
     *  ele interrompe a resposta e vira navegação — não há estado de erro a renderizar.
     *
     *  ─────────────────────────────────────────────────────────────────────────────
     *  SÓ A RECUSA QUE TEM RASCUNHO
     * ─────────────────────────────────────────────────────────────────────────────
     *  `submissionId` só vem de `NOT_READY` (o serviço devolve o rascunho da
     *  tentativa). Qualquer outra recusa — janela fechada, limite por autor, vínculo
     *  bloqueado, dados inválidos — NÃO tem rascunho para onde ir, e continua voltando
     *  como erro na tela. Um redirecionamento sem alvo seria uma tela morta, que é
     *  exatamente o que esta mudança veio remover.
     */
    if (result.code === 'NOT_READY' && result.submissionId) {
      redirect(tenantPath(data.tenantSlug, `/submissoes/${result.submissionId}?rascunho=1`));
    }

    return {
      ok: false,
      code: result.code,
      message: result.message,
      details: result.details,
    };
  }

  revalidatePath(tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`), 'layout');

  /**
   * ── A PROPOSTA ENVIADA TAMBÉM É UM TRABALHO SUBMETIDO (FASE 43) ─────────────
   *
   *  A proposta é uma `Submission` (FASE 33) e passa pelo mesmo motor do artigo, mas o
   *  gancho de gamificação só existia no caminho do fluxo acadêmico: quem submetia pela
   *  chamada não recebia nada. O gancho é o mesmo, com a chave da submissão.
   *
   *  Depois do commit e sem poder falhar (invariante 8).
   */
  await rewardSubmissionSubmittedById({ tenantId: context.tenantId, submissionId: result.submissionId });

  /**
   * ── A CONFIRMAÇÃO DIZ O QUE ACONTECEU COM O E-MAIL (FASE 33) ─────────────────
   * A proposta está gravada (o protocolo é a prova), e o e-mail pode ter ficado na
   * fila. Prometer entrega quando ela não aconteceu faria a pessoa esperar por uma
   * mensagem que não vem.
   *
   * O `redirectTo` é a rota REAL, e não `/minhas-submissoes` (que nunca existiu —
   * o caminho da lista é `/submissoes` desde a FASE 56): um destino quebrado numa
   * tela de sucesso é a mesma mentira da recusa sem saída, só que depois do trabalho
   * pronto. Como a action devolve o id da submissão, o destino é a página dela.
   */
  return {
    ok: true,
    protocol: result.protocol,
    redirectTo: tenantPath(data.tenantSlug, `/submissoes/${result.submissionId}`),
    message: result.confirmationQueued
      ? `Proposta recebida! Seu protocolo é ${result.protocol}. Enviamos a confirmação por e-mail.`
      : `Proposta recebida! Seu protocolo é ${result.protocol}. Guarde-o: é com ele que a organização localiza sua proposta.`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Protocolo de aceite (organizador)
// ───────────────────────────────────────────────────────────────────────────────
const acceptanceSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventSlug: z.string().trim().min(1).max(120),
  submissionId: z.string().uuid('Proposta inválida.'),
  notes: z.string().trim().max(2000).optional(),
  /** Criar a atividade na programação é ESCOLHA do organizador, não consequência. */
  createActivity: z.boolean(),
  activityType: z.string().trim().max(40).optional(),
  startsAt: z.string().trim().max(32).optional(),
  endsAt: z.string().trim().max(32).optional(),
  roomId: z.string().uuid().optional(),
  capacity: z.coerce.number().int().min(0).max(100000).optional(),
  requiresRegistration: z.boolean(),
  /** Convidar o proponente como palestrante — a segunda escolha. */
  inviteSpeaker: z.boolean(),
  eventTimezone: z.string().trim().max(64).optional(),
});

/**
 * Aceita uma proposta — e, se o organizador pedir, cria a atividade e convida.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  QUEM DECIDE É O MOTOR DA FASE 16
 * ─────────────────────────────────────────────────────────────────────────────
 *  A decisão entra por `acceptProposal` → `recordDecision`, o MESMO caminho do comitê
 *  científico (`submission:decide`): situação, nota final, trilha de auditoria e
 *  quórum. Uma segunda implementação de "aceitar" divergiria da primeira no primeiro
 *  ajuste de quórum — e a proposta passaria a ter duas verdades.
 *
 *  O que esta action acrescenta é o DEPOIS: a atividade na programação (com a carga
 *  horária que o proponente declarou) e o convite. Os dois são opcionais e o painel
 *  pergunta antes; a decisão NÃO é desfeita se a criação da atividade falhar — o
 *  aceite é um fato, e o aviso volta na resposta.
 */
export async function acceptProposalAction(
  _prev: CallActionState | null,
  formData: FormData,
): Promise<CallActionState> {
  const parsed = acceptanceSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventSlug: formData.get('eventSlug'),
    submissionId: formData.get('submissionId'),
    notes: nullable(formData.get('notes')) ?? undefined,
    createActivity: formData.get('createActivity') === 'on',
    activityType: nullable(formData.get('activityType')) ?? undefined,
    startsAt: nullable(formData.get('startsAt')) ?? undefined,
    endsAt: nullable(formData.get('endsAt')) ?? undefined,
    roomId: nullable(formData.get('roomId')) ?? undefined,
    capacity: nullable(formData.get('capacity')) ?? undefined,
    requiresRegistration: formData.get('requiresRegistration') === 'on',
    inviteSpeaker: formData.get('inviteSpeaker') === 'on',
    eventTimezone: nullable(formData.get('eventTimezone')) ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados do formulário inválidos.',
    };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_DECIDE,
  });

  if (!auth.ok) return auth.state;

  const data = parsed.data;
  const timeZone = formTimeZone(data.eventTimezone);

  let schedule: { startsAt: Date; endsAt: Date } | null = null;

  if (data.createActivity) {
    const startsAt = toCallInstant(data.startsAt ?? null, timeZone);
    if (!startsAt.ok) return { ok: false, code: 'INVALID_INPUT', message: startsAt.message };

    const endsAt = toCallInstant(data.endsAt ?? null, timeZone);
    if (!endsAt.ok) return { ok: false, code: 'INVALID_INPUT', message: endsAt.message };

    schedule = { startsAt: startsAt.date as Date, endsAt: endsAt.date as Date };
  }

  const result = await acceptProposal({
    tenantId: auth.tenantId,
    tenantSlug: data.tenantSlug,
    submissionId: data.submissionId,
    actorId: auth.userId,
    notes: data.notes ?? null,
    createActivity:
      data.createActivity && schedule
        ? {
            activityType: data.activityType ?? 'OTHER',
            startsAt: schedule.startsAt,
            endsAt: schedule.endsAt,
            roomId: data.roomId ?? null,
            capacity: data.capacity && data.capacity > 0 ? data.capacity : null,
            requiresRegistration: data.requiresRegistration,
          }
        : null,
    inviteSpeaker: data.inviteSpeaker,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE O PAINEL DO COMITÊ **NÃO** É REVALIDADO AQUI (defeito real da FASE 33)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A primeira versão revalidava `/comite/<id>`. Como o painel de aceite só existia
   *  enquanto a proposta NÃO tinha decisão, o `revalidatePath` fazia o Server Component
   *  reler o status (agora `ACCEPTED`) e desmontar o painel — levando junto o estado de
   *  sucesso do `useActionState`. O organizador via o painel desaparecer sem nenhuma
   *  confirmação, justamente depois do clique mais importante da tela. Foi o E2E que
   *  pegou (armadilha 76).
   *
   *  A correção tem DUAS partes, e as duas são necessárias: esta action parou de
   *  revalidar a própria rota do painel (a página pública do evento continua revalidada —
   *  outra rota, que precisa mostrar a atividade criada), e o painel passou a MOSTRAR o
   *  estado "já decidida" quando a página é re-renderizada com o status novo. Só a
   *  primeira metade deixaria o silêncio de volta na próxima navegação.
   */
  revalidatePath(tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`), 'layout');

  /**
   * ── ACEITAR A PROPOSTA PAGA O MESMO XP QUE O COMITÊ PAGA (FASE 43) ──────────
   *
   *  O aceite entra por `recordDecision`, o MESMO motor do comitê — mas o prêmio
   *  estava só na action do painel do comitê, então a mesma decisão valia XP por uma
   *  porta e nada pela outra. Aqui entra o MESMO gancho, e a chave de idempotência é
   *  derivada da SUBMISSÃO: se as duas portas decidirem, quem chegar primeiro credita.
   *
   *  Depois do commit e sem poder falhar (invariante 8).
   */
  await rewardSubmissionAcceptedById({ tenantId: auth.tenantId, submissionId: data.submissionId });

  /**
   * A resposta diz o que ficou PENDENTE. Aceitar sem criar a atividade e sem convidar é
   * um resultado legítimo — e a mensagem não pode deixar a organização achar que o
   * palestrante foi convidado quando ninguém foi.
   */
  const parts = ['Proposta aceita.'];

  if (result.activityId) parts.push('Atividade criada na programação.');
  if (result.inviteToken) {
    parts.push(
      result.inviteSent
        ? 'Convite de palestrante enviado por e-mail.'
        : 'Convite gerado — o e-mail ficou na fila; copie o link e envie você mesmo se preferir.',
    );
  }

  for (const warning of result.warnings) parts.push(warning);

  return {
    ok: true,
    message: parts.join(' '),
    data: {
      status: result.status,
      activityId: result.activityId,
      inviteToken: result.inviteToken,
    },
  };
}
