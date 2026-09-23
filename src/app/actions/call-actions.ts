'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CASOS DE USO EXPOSTOS AO BROWSER — Chamadas de propostas (FASE 33)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS PORTAS, TRÊS AUTORIZAÇÕES DIFERENTES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. PAINEL (`saveCallAction`, `setCallPublishedAction`, `deleteCallAction`) —
 *     quem organiza a chamada precisa de `event:manage`: montar a chamada é ato de
 *     organização do evento, não de quem submete nem de quem julga.
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
import { submitProposal } from '@/lib/proposals/proposal-service';
import { acceptProposal } from '@/lib/proposals/acceptance-service';

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
   * `""` = padrão do tipo; `on` = forçar revisão cega; `off` = forçar aberta.
   *
   * Um checkbox não serviria: desmarcado ele seria indistinguível de "não perguntei",
   * e o padrão do tipo (que é `true` para artigo e pôster) nunca voltaria a valer.
   */
  blind: z.string().trim().max(8).optional(),
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
    // `undefined` deixa o serviço aplicar o padrão do tipo (FASE 33, ADR-160).
    requiresBlindReview: data.blind === undefined ? undefined : data.blind === 'on',
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

  revalidateCallPaths(data.tenantSlug, data.eventSlug, data.eventId);

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

  revalidateCallPaths(parsed.data.tenantSlug, parsed.data.eventSlug, parsed.data.eventId);

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

  revalidateCallPaths(parsed.data.tenantSlug, parsed.data.eventSlug, parsed.data.eventId);

  return { ok: true, message: 'Chamada excluída.' };
}

/** O painel e a página pública leem a mesma chamada: os dois precisam ser revalidados. */
function revalidateCallPaths(tenantSlug: string, eventSlug: string, eventId: string): void {
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/chamadas`), 'page');
  revalidatePath(tenantPath(tenantSlug, `/eventos/${eventSlug}`), 'layout');
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
    return {
      ok: false,
      code: result.code,
      message: result.message,
      details: result.details,
    };
  }

  revalidatePath(tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`), 'layout');

  /**
   * A confirmação diz o que aconteceu com o E-MAIL, e não só "enviado": a proposta
   * está gravada (o protocolo é a prova), e o e-mail pode ter ficado na fila. Prometer
   * entrega quando ela não aconteceu faria a pessoa esperar por uma mensagem que não vem.
   */
  return {
    ok: true,
    protocol: result.protocol,
    redirectTo: tenantPath(data.tenantSlug, '/minhas-submissoes'),
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
