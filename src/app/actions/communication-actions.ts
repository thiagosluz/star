'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Comunicação (FASE 15)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GUARDA É AQUI, NÃO NO BOTÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Convite, reenvio, cancelamento e reentrega de e-mail passam por
 *  `tenant:member:invite` / `communication:read` verificadas NA AÇÃO: esconder o
 *  botão é conveniência; a barreira é esta, porque uma Server Action é um endpoint
 *  HTTP.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ÚNICA EXCEÇÃO: ACEITAR O CONVITE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `acceptInvitationAction` NÃO pede permissão — quem aceita ainda não tem nenhuma.
 *  A autorização dela é outra: o CÓDIGO (que só existe no e-mail) e o endereço da
 *  conta logada precisam bater com o convite. Sem os dois, a resposta é recusa; é o
 *  mesmo desenho do aceite do convite de palestrante (ADR-115), com a diferença de
 *  que aqui a posse do endereço é o único fator, porque não há painel de onde partir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { auth } from '@/lib/auth/auth';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  acceptInvitation,
  inviteMember,
  reissueInvitation,
  revokeInvitation,
} from '@/lib/communication/invitation-service';
import { retryEmailMessage, queueEmail } from '@/lib/communication/email-service';
import { currentEmailDriver } from '@/lib/communication/mailer';
import {
  createCampaign,
  dispatchCampaign,
  parseStoredDefinition,
  type CampaignDispatchOutcome,
} from '@/lib/communication/campaign-service';
import { loadSegmentRecipients } from '@/lib/communication/segment-service';
import { validateCampaignText, campaignStatusLabel } from '@/domain/communication/campaign-rules';
import type { SegmentDefinition } from '@/domain/communication/segments';
import { maskEmailAddress } from '@/domain/communication/email-rules';
import { withTenant } from '@/lib/db/tenant-client';

export interface CommunicationActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

async function guard(input: {
  tenantSlug: string;
  permission: Permission;
}): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: CommunicationActionState }
> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return { ok: false, state: { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' } };
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return {
      ok: false,
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Você não tem vínculo ativo com esta instituição.',
      },
    };
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, input.permission, { scope: 'TENANT' })) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: `Permissão negada: ${input.permission}.` },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

function nullable(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Convite de equipe
// ───────────────────────────────────────────────────────────────────────────────
const inviteSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  email: z.string().trim().min(5).max(320),
  role: z.string().trim().min(2).max(40),
  message: z.string().trim().max(400).optional(),
});

export async function inviteMemberAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const parsed = inviteSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    email: formData.get('email'),
    role: formData.get('role'),
    message: nullable(formData.get('message')) ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Revise os dados do convite.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const access = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.TENANT_MEMBER_INVITE,
  });

  if (!access.ok) return access.state;

  const result = await inviteMember({
    tenantId: access.tenantId,
    actorId: access.userId,
    email: parsed.data.email,
    role: parsed.data.role,
    message: parsed.data.message ?? null,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/equipe'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  /**
   * O link é devolvido UMA vez: o banco guarda só o hash. A tela mostra o endereço
   * para quem quiser entregar por outro canal (e avisa que não será exibido de novo).
   */
  return {
    ok: true,
    message: result.emailQueued
      ? `Convite registrado e enviado para ${result.email}.`
      : `Convite registrado para ${result.email}. O envio por e-mail falhou — use o link abaixo.`,
    data: {
      invitationId: result.invitationId,
      email: result.email,
      inviteUrl: result.inviteUrl,
      emailQueued: result.emailQueued,
    },
  };
}

export async function reissueInvitationAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      invitationId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      invitationId: formData.get('invitationId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Convite inválido.' };
  }

  const access = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.TENANT_MEMBER_INVITE,
  });

  if (!access.ok) return access.state;

  const result = await reissueInvitation({
    tenantId: access.tenantId,
    actorId: access.userId,
    invitationId: parsed.data.invitationId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/equipe'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return {
    ok: true,
    message: `Convite novo gerado para ${result.email}. O código anterior deixou de valer.`,
    data: {
      invitationId: result.invitationId,
      email: result.email,
      inviteUrl: result.inviteUrl,
      emailQueued: result.emailQueued,
      reissued: true,
    },
  };
}

export async function revokeInvitationAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      invitationId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      invitationId: formData.get('invitationId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Convite inválido.' };
  }

  const access = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.TENANT_MEMBER_INVITE,
  });

  if (!access.ok) return access.state;

  const result = await revokeInvitation({
    tenantId: access.tenantId,
    actorId: access.userId,
    invitationId: parsed.data.invitationId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/equipe'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return { ok: true, message: `Convite de ${result.email} cancelado.` };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Aceite (sem permissão: o código é a autorização)
// ───────────────────────────────────────────────────────────────────────────────
export async function acceptInvitationAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      token: z.string().trim().min(10).max(200),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      token: formData.get('token'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Convite inválido ou incompleto.' };
  }

  const user = await getAuthenticatedUser();

  if (!user) {
    return {
      ok: false,
      code: 'NOT_AUTHENTICATED',
      message: 'Entre na sua conta (ou crie uma com o e-mail convidado) para aceitar o convite.',
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: parsed.data.tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' };
  }

  const result = await acceptInvitation({
    tenantId: tenant.id,
    token: parsed.data.token,
    userId: user.id,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  /**
   * O vínculo e o papel são NOVOS: o menu, a lista de instituições e o painel
   * precisam ser reconstruídos. Revalidar o layout do tenant cobre todas as telas
   * dele de uma vez (armadilha 40).
   */
  revalidatePath(tenantPath(parsed.data.tenantSlug), 'layout');

  redirect(tenantPath(parsed.data.tenantSlug, '/dashboard'));
}

// ───────────────────────────────────────────────────────────────────────────────
//  Caixa de saída
// ───────────────────────────────────────────────────────────────────────────────
export async function retryEmailAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      emailMessageId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      emailMessageId: formData.get('emailMessageId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Mensagem inválida.' };
  }

  const access = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.COMMUNICATION_READ,
  });

  if (!access.ok) return access.state;

  const result = await retryEmailMessage({
    tenantId: access.tenantId,
    emailMessageId: parsed.data.emailMessageId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/comunicacao'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: result.queued
      ? 'Mensagem reenfileirada. A entrega acontece em instantes.'
      : 'Mensagem reenviada agora.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Verificação de e-mail (A5)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Reenvia a confirmação de endereço para a PRÓPRIA conta.
 *
 * Não recebe e-mail do formulário: quem pede é quem está logado, e aceitar um
 * endereço de fora transformaria esta ação num gerador de spam. O `callbackURL`
 * leva a pessoa de volta a uma página que explica o que aconteceu.
 */
export async function resendVerificationEmailAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const redirectTo = nullable(formData.get('redirectTo')) ?? '/selecionar-instituicao';

  const user = await getAuthenticatedUser();

  if (!user) {
    return { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' };
  }

  /**
   * A sessão carrega `emailVerified` desde a FASE 15 — o dado já vinha do Better
   * Auth. A checagem evita mandar e-mail novo para quem já confirmou o endereço.
   */
  if (user.emailVerified) {
    return { ok: true, message: 'Este endereço já está confirmado.' };
  }

  try {
    await auth.api.sendVerificationEmail({
      body: { email: user.email, callbackURL: '/verificacao' },
    });
  } catch {
    // O Better Auth pode recusar por limite de taxa; a mensagem não promete sucesso.
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Não foi possível enviar agora. Tente novamente em alguns minutos.',
    };
  }

  if (redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
    revalidatePath(redirectTo);
  }

  return {
    ok: true,
    message: `Enviamos um novo link de confirmação para ${user.email}. O link vale por 24 horas.`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Campanha segmentada (FASE 67 · fatia 2)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A PERMISSÃO DO ENVIO É `participant:message` — E NÃO `communication:read`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A SEGUNDA, SE AS DUAS ESTÃO NO MESMO PAPEL HOJE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Hoje OWNER, ADMIN e ORGANIZER têm as duas, então a escolha não muda quem passa.
 *  Ela muda o SIGNIFICADO — e é o significado que sobrevive à próxima concessão: a
 *  caixa de saída é CONFERÊNCIA ("o que a plataforma enviou?"), e campanha é
 *  COMUNICAÇÃO em massa, com efeito fora da plataforma. O catálogo já declara
 *  exatamente essa distinção, na justificativa de `participant:message`: *"quem só
 *  precisa conferir não deve poder disparar e-mail em massa"*.
 *
 *  Escolher `communication:read` para o disparo faria a primeira concessão estreita
 *  ("dá para ela ver a caixa de saída") entregar, de brinde, o botão de mandar
 *  mensagem para a instituição inteira.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DEFINIÇÃO VEM DO FORMULÁRIO — E É RECONFERIDA INTEIRA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O passo de confirmação carrega o JSON da definição já validada. A ação NÃO
 *  confia nele: `parseStoredDefinition` + a composição do domínio o revalidam, e
 *  JSON quebrado vira lista vazia — que a composição RECUSA. Segmento vazio
 *  selecionaria a instituição inteira, e é justamente esse o erro que não pode
 *  acontecer por um campo de formulário adulterado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const campaignSendSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  /** Definido só quando a campanha é de UM evento (ver `requiresEvent`). */
  evento: z.string().trim().uuid().optional(),
  assunto: z.string().max(400).optional(),
  corpo: z.string().max(20_000).optional(),
  /** Obrigatória no disparo novo; o reenvio da lista não precisa dela. */
  definicao: z.string().trim().max(20_000).optional(),
  acao: z.enum(['teste', 'disparar', 'reenviar']).optional(),
  campaignId: z.string().trim().uuid().optional(),
});

function readDefinition(raw: string): SegmentDefinition {
  try {
    return parseStoredDefinition(JSON.parse(raw) as unknown);
  } catch {
    // JSON quebrado vira definição VAZIA — e a composição recusa (fail-closed).
    return { conditions: [], except: null };
  }
}

/**
 * O resultado REAL do disparo, em português.
 *
 * `ok: true` do serviço não é "todo mundo recebeu": é "a passada terminou". Os
 * números que a tela mostra são os do outbox — quantos entraram, quantos já
 * existiam (o reenvio não duplica), quantos falharam e quantos sobraram para a
 * próxima passada por causa do limite de ritmo.
 */
function dispatchState(outcome: CampaignDispatchOutcome): CommunicationActionState {
  const details = [
    `Destinatários alcançados pela definição agora: ${outcome.evaluated}.`,
    `Saíram por descadastro e não recebem: ${outcome.skippedUnsubscribed}.`,
  ];

  if (outcome.remaining > 0) {
    details.push(
      `Sobraram ${outcome.remaining} para a próxima passada — o limite de ritmo do provedor parou o envio no meio. Disparar de novo continua de onde parou, sem repetir ninguém.`,
    );
  }

  details.push(
    `Passadas executadas: ${outcome.batches}${outcome.rateLimited ? ' (a última foi interrompida pelo limite de ritmo)' : ''}.`,
  );

  return {
    ok: true,
    message: `${campaignStatusLabel(outcome.status)}: ${outcome.queued} mensagem(ns) entraram na fila, ${outcome.duplicates} já existiam, ${outcome.failed} falharam.`,
    details,
    data: {
      campaignId: outcome.campaignId,
      queued: outcome.queued,
      duplicates: outcome.duplicates,
      failed: outcome.failed,
      remaining: outcome.remaining,
      rateLimited: outcome.rateLimited,
    },
  };
}

/**
 * Envia um teste SÓ para quem está logado.
 *
 * É ato de quem vai disparar, e não uma campanha: não cria linha em
 * `communication_campaigns`, não tem `dedupeKey` (o mesmo teste pode ser repetido
 * quantas vezes o organizador quiser) e sai pelo MESMO outbox — nenhum caminho
 * novo de e-mail nasce aqui.
 */
async function sendCampaignTest(input: {
  tenantId: string;
  userId: string;
  eventId: string | null;
  subject: string;
  body: string;
}): Promise<CommunicationActionState> {
  const [author] = await loadSegmentRecipients({ tenantId: input.tenantId, userIds: [input.userId] });

  if (!author) {
    return { ok: false, code: 'NOT_FOUND', message: 'Não foi possível localizar o seu cadastro.' };
  }

  const eventId = input.eventId;

  const eventTitle = eventId
    ? ((await withTenant(input.tenantId, (tx) =>
        tx.event.findFirst({ where: { id: eventId }, select: { title: true } }),
      ))?.title ?? null)
    : null;

  const tenantName = await withTenant(input.tenantId, (tx) =>
    tx.tenant.findUnique({ where: { id: input.tenantId }, select: { name: true } }),
  ).then((row) => row?.name ?? 'EventFlow');

  const result = await queueEmail({
    tenantId: input.tenantId,
    to: author.email,
    toUserId: author.userId,
    template: 'CAMPAIGN_MESSAGE',
    brandName: tenantName,
    createdById: input.userId,
    payload: {
      recipientName: author.name,
      tenantName,
      subject: input.subject,
      body: input.body,
      eventTitle,
      senderName: author.name,
      /**
       * O TESTE NÃO LEVA DESCADASTRO, e é decisão: ele vai só para quem disparou,
       * não é uma campanha (não tem linha em `communication_campaigns` nem
       * `dedupeKey`) e descadastrar a própria pessoa por causa de um teste seria um
       * efeito que ninguém pediu. O rodapé do template trata o nulo dizendo que o
       * descadastro está fora do ar — texto conferido na prévia da tela.
       */
      unsubscribeUrl: null,
    },
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  /**
   * O driver `log` registra e NÃO entrega (FASE 15). Dizer "enviado" aqui seria a
   * mentira mais fácil da tela — e a que faz a instituição esperar por um e-mail
   * que nunca sai.
   */
  const address = maskEmailAddress(author.email);
  const footnote = currentEmailDriver() === 'log'
    ? ' Neste ambiente o envio externo está desligado (driver log): a mensagem ficou registrada na caixa de saída.'
    : '';

  return {
    ok: true,
    message: result.queued
      ? `Teste registrado e enfileirado para ${address}.${footnote}`
      : `Teste registrado para ${address}.${footnote}`,
  };
}

/**
 * O disparo: cria a campanha (o ATO, com o snapshot) e manda.
 *
 * As duas etapas são chamadas SEPARADAS de propósito — `createCampaign` grava o
 * fato e tira a contagem do momento, `dispatchCampaign` toma a reserva e enfileira
 * em lotes. Se a segunda recusar (já há uma passada em andamento, por exemplo), a
 * campanha continua existindo em `DRAFT`, e a tela mostra o motivo em vez de um
 * "enviado" otimista.
 */
export async function campaignSendAction(
  _prev: CommunicationActionState | null,
  formData: FormData,
): Promise<CommunicationActionState> {
  const parsed = campaignSendSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    evento: nullable(formData.get('evento')) ?? undefined,
    assunto: nullable(formData.get('assunto')) ?? undefined,
    corpo: formData.get('corpo') ?? undefined,
    definicao: nullable(formData.get('definicao')) ?? undefined,
    acao: nullable(formData.get('acao')) ?? undefined,
    campaignId: nullable(formData.get('campaignId')) ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Revise o texto e o segmento antes de enviar.' };
  }

  const access = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.PARTICIPANT_MESSAGE,
  });

  if (!access.ok) return access.state;

  const eventId = parsed.data.evento ?? null;
  const action = parsed.data.acao ?? 'disparar';

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O REENVIO VEM ANTES DA VALIDAÇÃO DO TEXTO, E ISSO É DELIBERADO
   * ─────────────────────────────────────────────────────────────────────────────
   *  Reenviar não envia texto novo: `dispatchCampaign` relê o assunto e o corpo
   *  GRAVADOS na campanha — é o que faz a segunda passada reproduzir o que foi
   *  enviado, e não o rascunho de hoje. Exigir `assunto`/`corpo` no formulário de
   *  reenvio (que não os tem) recusaria a operação legítima com "escreva o assunto".
   */
  if (action === 'reenviar') {
    if (!parsed.data.campaignId) {
      return { ok: false, code: 'INVALID_INPUT', message: 'Campanha não informada para o reenvio.' };
    }

    const again = await dispatchCampaign({
      tenantId: access.tenantId,
      campaignId: parsed.data.campaignId,
      actorId: access.userId,
    });

    revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/comunicacao'));

    if (!again.ok) {
      return { ok: false, code: again.code, message: again.message, details: again.details };
    }

    return dispatchState(again);
  }

  const text = validateCampaignText({ subject: parsed.data.assunto, body: parsed.data.corpo });

  if (!text.ok) return { ok: false, code: 'INVALID_INPUT', message: text.message };

  if (action === 'teste') {
    return sendCampaignTest({
      tenantId: access.tenantId,
      userId: access.userId,
      eventId,
      subject: text.subject,
      body: text.body,
    });
  }

  const definition = readDefinition(parsed.data.definicao ?? '{}');

  const created = await createCampaign({
    tenantId: access.tenantId,
    actorId: access.userId,
    eventId,
    definition,
    subject: text.subject,
    body: text.body,
  });

  if (!created.ok) {
    return { ok: false, code: created.code, message: created.message, details: created.details };
  }

  const dispatched = await dispatchCampaign({
    tenantId: access.tenantId,
    campaignId: created.campaignId,
    actorId: access.userId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/comunicacao'));

  if (!dispatched.ok) {
    return {
      ok: false,
      code: dispatched.code,
      message: dispatched.message,
      details: dispatched.details,
      data: { campaignId: created.campaignId },
    };
  }

  return dispatchState(dispatched);
}
