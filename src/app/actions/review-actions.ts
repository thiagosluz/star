'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CASOS DE USO EXPOSTOS AO BROWSER — Submissões e avaliação por pares
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O UPLOAD EM DUAS CHAMADAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O arquivo NÃO atravessa a aplicação. O fluxo é:
 *
 *      requestUploadAction  → devolve URL pré-assinada (valida formato/tamanho)
 *      (o NAVEGADOR envia o PDF direto ao MinIO)
 *      confirmUploadAction  → confere integridade e registra o artefato
 *
 *  O checksum SHA-256 é calculado no NAVEGADOR (Web Crypto API) e conferido no
 *  servidor contra o objeto armazenado. Isso é o que permite detectar um arquivo
 *  trocado entre o envio e a confirmação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  confirmUpload,
  createSubmission,
  deleteSubmission,
  requestUpload,
  submitSubmission,
} from '@/lib/review/submission-service';
import { saveSubmissionAuthors } from '@/lib/review/author-service';
import {
  assignReviewer,
  recordDecision,
  submitReview,
} from '@/lib/review/review-service';
import {
  rewardReviewCompletedById,
  rewardSubmissionAcceptedById,
  rewardSubmissionSubmittedById,
} from '@/lib/gamification/hooks';
import type { SubmissionFileKind } from '@/domain/review/submission-rules';
import type { ReviewRecommendation } from '@/domain/review/review-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Contexto autorizado
// ───────────────────────────────────────────────────────────────────────────────
export interface ActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  /** Payload de sucesso, específico de cada ação. */
  data?: Record<string, unknown>;
}

/**
 * Guarda de autorização.
 *
 * Resolve tenant e vínculo, carrega o `Principal` sob RLS e verifica a permissão
 * — com posse quando a permissão termina em `:own`, porque `can()` NEGA sem
 * `ownership` e essa negação é intencional.
 */
async function guard(input: {
  tenantSlug: string;
  permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
  requiresOwnership?: boolean;
}): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: ActionState }
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
    return {
      ok: false,
      state: { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' },
    };
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

  const allowed = can(
    principal,
    input.permission,
    { scope: 'TENANT' },
    input.requiresOwnership ? { ownerId: user.id } : undefined,
  );

  if (!allowed) {
    return {
      ok: false,
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: `Permissão negada: ${input.permission}.`,
      },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criação de submissão
// ───────────────────────────────────────────────────────────────────────────────
const createSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  trackId: z.string().uuid('Selecione uma trilha.'),
  title: z.string().trim().min(8, 'O título deve ter ao menos 8 caracteres.').max(300),
  abstract: z
    .string()
    .trim()
    .min(150, 'O resumo deve ter ao menos 150 caracteres para permitir avaliação.')
    .max(5000),
  keywords: z
    .string()
    .trim()
    .min(1, 'Informe as palavras-chave.')
    .transform((value) =>
      value
        .split(',')
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0),
    ),
  language: z.enum(['pt-BR', 'en', 'es']).default('pt-BR'),
});

export async function createSubmissionAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    trackId: formData.get('trackId'),
    title: formData.get('title'),
    abstract: formData.get('abstract'),
    keywords: formData.get('keywords'),
    language: formData.get('language') || 'pt-BR',
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique os dados do formulário.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const data = parsed.data;

  const context = await guard({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_CREATE,
  });

  if (!context.ok) return context.state;

  const result = await createSubmission({
    tenantId: context.tenantId,
    eventId: data.eventId,
    trackId: data.trackId,
    userId: context.userId,
    title: data.title,
    abstract: data.abstract,
    keywords: data.keywords,
    language: data.language,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O RASCUNHO ABRE NA TELA ONDE ELE É COMPLETADO (revisão da FASE 4)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Antes a action devolvia "Rascunho criado" e a tela ficava parada: para anexar
   *  o PDF e enviar, o autor tinha de voltar à lista e clicar em "Abrir" — uma
   *  página intermediária que só existia porque a navegação era do cliente.
   *
   *  O servidor já conhece o id recém-criado: então ele REDIRECIONA. O aviso de
   *  "rascunho criado" reaparece lá (`?novo=1`), onde a próxima ação acontece.
   */
  redirect(tenantPath(data.tenantSlug, `/submissoes/${result.id}?novo=1`));
}

// ───────────────────────────────────────────────────────────────────────────────
//  Exclusão do rascunho
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Exclui um rascunho do próprio autor.
 *
 * A permissão é `submission:update:own` COM posse: excluir o rascunho é a forma
 * extrema de editá-lo, e o serviço reconfere a posse pelo `submittedById` do
 * banco. O que impede alcançar uma submissão já enviada não é a permissão, é o
 * ESTADO (`canDeleteSubmission`, no domínio) — e a mensagem que volta diz isso.
 */
export async function deleteDraftSubmissionAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      submissionId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      submissionId: formData.get('submissionId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_UPDATE_OWN,
    requiresOwnership: true,
  });

  if (!context.ok) return context.state;

  const result = await deleteSubmission({
    tenantId: context.tenantId,
    submissionId: parsed.data.submissionId,
    userId: context.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  const listPath = tenantPath(parsed.data.tenantSlug, '/submissoes');
  // A lista é quem mostra o efeito: sem revalidar, o rascunho apagado continuaria ali.
  revalidatePath(listPath);
  revalidatePath(tenantPath(parsed.data.tenantSlug, `/submissoes/${parsed.data.submissionId}`));

  /**
   * O destino é a LISTA: quem acabou de apagar um rascunho não pode continuar numa
   * página que aponta para ele (a submissão não existe mais e a tela daria 404).
   */
  redirect(listPath);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Upload — etapa 1
// ───────────────────────────────────────────────────────────────────────────────
const requestUploadSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  submissionId: z.string().uuid(),
  kind: z.enum(['BLIND_PDF', 'IDENTIFIED_PDF', 'SUPPLEMENTARY', 'PRESENTATION', 'CAMERA_READY']),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i, 'Checksum SHA-256 inválido.'),
  magicBytes: z.array(z.number().int().min(0).max(255)).max(8).optional(),
});

export async function requestUploadAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const magicRaw = formData.get('magicBytes');

  const parsed = requestUploadSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    submissionId: formData.get('submissionId'),
    kind: formData.get('kind'),
    fileName: formData.get('fileName'),
    mimeType: formData.get('mimeType'),
    sizeBytes: Number(formData.get('sizeBytes')),
    checksum: formData.get('checksum'),
    ...(typeof magicRaw === 'string' && magicRaw.length > 0
      ? { magicBytes: magicRaw.split(',').map(Number) }
      : {}),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados de upload inválidos.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const data = parsed.data;

  const context = await guard({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_UPDATE_OWN,
    requiresOwnership: true,
  });

  if (!context.ok) return context.state;

  const result = await requestUpload({
    tenantId: context.tenantId,
    submissionId: data.submissionId,
    userId: context.userId,
    kind: data.kind as SubmissionFileKind,
    fileName: data.fileName,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    checksum: data.checksum,
    magicBytes: data.magicBytes ?? null,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return {
    ok: true,
    data: {
      uploadUrl: result.uploadUrl,
      objectKey: result.objectKey,
      bucket: result.bucket,
      requiredHeaders: result.requiredHeaders,
      version: result.version,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Upload — etapa 3
// ───────────────────────────────────────────────────────────────────────────────
const confirmUploadSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  submissionId: z.string().uuid(),
  kind: z.enum(['BLIND_PDF', 'IDENTIFIED_PDF', 'SUPPLEMENTARY', 'PRESENTATION', 'CAMERA_READY']),
  objectKey: z.string().trim().min(1).max(1024),
  bucket: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
  version: z.number().int().positive(),
});

export async function confirmUploadAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = confirmUploadSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    submissionId: formData.get('submissionId'),
    kind: formData.get('kind'),
    objectKey: formData.get('objectKey'),
    bucket: formData.get('bucket'),
    fileName: formData.get('fileName'),
    mimeType: formData.get('mimeType'),
    sizeBytes: Number(formData.get('sizeBytes')),
    checksum: formData.get('checksum'),
    version: Number(formData.get('version')),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados de confirmação inválidos.',
    };
  }

  const data = parsed.data;

  const context = await guard({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_UPDATE_OWN,
    requiresOwnership: true,
  });

  if (!context.ok) return context.state;

  const result = await confirmUpload({
    tenantId: context.tenantId,
    submissionId: data.submissionId,
    userId: context.userId,
    kind: data.kind as SubmissionFileKind,
    objectKey: data.objectKey,
    bucket: data.bucket,
    fileName: data.fileName,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    checksum: data.checksum,
    version: data.version,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return {
    ok: true,
    message: 'Arquivo anexado e verificado.',
    data: {
      fileId: result.fileId,
      version: result.version,
      checksum: result.checksum,
      sizeBytes: result.sizeBytes,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Envio da submissão
// ───────────────────────────────────────────────────────────────────────────────
export async function submitSubmissionAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      submissionId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      submissionId: formData.get('submissionId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_UPDATE_OWN,
    requiresOwnership: true,
  });

  if (!context.ok) return context.state;

  const result = await submitSubmission({
    tenantId: context.tenantId,
    submissionId: parsed.data.submissionId,
    userId: context.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  /**
   * Recompensa de gamificação — NÃO-FATAL por construção.
   *
   * A submissão já está enviada; o retorno desta chamada é `null` em qualquer
   * falha e o erro vai para o log. Um problema ao sortear uma carta não pode
   * impedir alguém de submeter um trabalho.
   */
  const reward = await rewardSubmissionSubmittedById({
    tenantId: context.tenantId,
    submissionId: parsed.data.submissionId,
  });

  return {
    ok: true,
    message: 'Submissão enviada para avaliação.',
    data: {
      status: result.status,
      ...(reward && reward.xpAwarded > 0 ? { xpAwarded: reward.xpAwarded } : {}),
      ...(reward && reward.cards.length > 0 ? { cards: reward.cards } : {}),
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Autoria (coautores) — FASE 17, item E6
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Salva a lista de autores de uma submissão.
 *
 * Os campos chegam como LISTAS PARALELAS (`authorName`, `authorEmail`, …), e a
 * ordem delas É a ordem de crédito. Não é um formato elegante — é o que um
 * formulário HTML com linhas repetidas consegue enviar sem serializar JSON, e o
 * domínio (`normalizeAuthors`) reindexa a ordem de qualquer forma.
 *
 * A permissão é `submission:update:own` COM posse: o serviço confere, além disso,
 * que quem edita é o autor que submeteu — um coautor com conta não reescreve a
 * ordem de crédito dos outros.
 */
export async function saveSubmissionAuthorsAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      submissionId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      submissionId: formData.get('submissionId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const context = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_UPDATE_OWN,
    requiresOwnership: true,
  });

  if (!context.ok) return context.state;

  const names = formData.getAll('authorName').map((entry) => String(entry));
  const emails = formData.getAll('authorEmail').map((entry) => String(entry));
  const institutions = formData.getAll('authorInstitution').map((entry) => String(entry));
  const orcids = formData.getAll('authorOrcid').map((entry) => String(entry));
  const userIds = formData.getAll('authorUserId').map((entry) => String(entry));
  /** Índice da linha marcada como correspondente (um radio por linha). */
  const corresponding = String(formData.get('authorCorresponding') ?? '0');

  const authors = names.map((name, index) => ({
    name: name.trim(),
    ...(emails[index]?.trim() ? { email: emails[index].trim() } : {}),
    ...(institutions[index]?.trim() ? { institution: institutions[index].trim() } : {}),
    ...(orcids[index]?.trim() ? { orcidId: orcids[index].trim() } : {}),
    ...(userIds[index]?.trim() ? { userId: userIds[index].trim() } : {}),
    isCorresponding: corresponding === String(index),
  }));

  const result = await saveSubmissionAuthors({
    tenantId: context.tenantId,
    submissionId: parsed.data.submissionId,
    actorId: context.userId,
    authors,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  const submissionPath = tenantPath(
    parsed.data.tenantSlug,
    `/submissoes/${parsed.data.submissionId}`,
  );
  revalidatePath(submissionPath);
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/submissoes'));

  return {
    ok: true,
    message: result.changed
      ? `Autoria atualizada: ${result.count} autor(es).`
      : 'Nenhuma alteração na autoria.',
    data: { count: result.count, changed: result.changed },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Atribuição de revisor (comitê)
// ───────────────────────────────────────────────────────────────────────────────
const assignSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  submissionId: z.string().uuid(),
  reviewerId: z.string().uuid(),
  matchReason: z.string().trim().max(400).optional(),
  dueAt: z.string().trim().optional(),
  overrideUncertainConflict: z.coerce.boolean().optional().default(false),
});

export async function assignReviewerAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = assignSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    submissionId: formData.get('submissionId'),
    reviewerId: formData.get('reviewerId'),
    matchReason: (formData.get('matchReason') as string) || undefined,
    dueAt: (formData.get('dueAt') as string) || undefined,
    overrideUncertainConflict: formData.get('overrideUncertainConflict') === 'on',
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const data = parsed.data;

  const context = await guard({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_ASSIGN_REVIEWER,
  });

  if (!context.ok) return context.state;

  const result = await assignReviewer({
    tenantId: context.tenantId,
    submissionId: data.submissionId,
    reviewerId: data.reviewerId,
    assignedById: context.userId,
    matchReason: data.matchReason ?? null,
    overrideUncertainConflict: data.overrideUncertainConflict,
    ...(data.dueAt ? { dueAt: new Date(data.dueAt) } : {}),
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return {
    ok: true,
    message: 'Revisor atribuído.',
    data: { assignmentId: result.assignmentId, affinityScore: result.affinityScore },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Parecer (revisor)
// ───────────────────────────────────────────────────────────────────────────────
const reviewSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  submissionId: z.string().uuid(),
  recommendation: z.enum(['ACCEPT', 'MINOR_REVISION', 'MAJOR_REVISION', 'REJECT']),
  feedbackToAuthor: z.string().trim().max(8000).optional(),
  confidentialComments: z.string().trim().max(8000).optional(),
});

export async function submitReviewAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = reviewSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    submissionId: formData.get('submissionId'),
    recommendation: formData.get('recommendation'),
    feedbackToAuthor: (formData.get('feedbackToAuthor') as string) || undefined,
    confidentialComments: (formData.get('confidentialComments') as string) || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Preencha a recomendação.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const data = parsed.data;

  const context = await guard({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.REVIEW_SUBMIT_OWN,
    requiresOwnership: true,
  });

  if (!context.ok) return context.state;

  /**
   * As notas por critério chegam como `score_<chave>` no FormData.
   *
   * A NOTA FINAL NUNCA vem do cliente: ela é calculada no servidor a partir da
   * rubrica da trilha. Aceitá-la permitiria a um revisor declarar qualquer
   * resultado.
   */
  const scores: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('score_')) continue;
    const criterion = key.slice('score_'.length);
    const numeric = Number(value);
    if (Number.isFinite(numeric)) scores[criterion] = numeric;
  }

  const result = await submitReview({
    tenantId: context.tenantId,
    submissionId: data.submissionId,
    reviewerId: context.userId,
    scores,
    recommendation: data.recommendation as ReviewRecommendation,
    feedbackToAuthor: data.feedbackToAuthor ?? null,
    confidentialComments: data.confidentialComments ?? null,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  // Avaliar é o trabalho do revisor: é ele quem recebe o XP.
  const reward = await rewardReviewCompletedById({
    tenantId: context.tenantId,
    reviewId: result.reviewId,
  });

  return {
    ok: true,
    message: `Parecer registrado. Nota ponderada: ${result.weightedScore.toFixed(1)}.`,
    data: {
      reviewId: result.reviewId,
      weightedScore: result.weightedScore,
      ...(reward && reward.xpAwarded > 0 ? { xpAwarded: reward.xpAwarded } : {}),
      ...(reward && reward.cards.length > 0 ? { cards: reward.cards } : {}),
      ...(reward && reward.missions.length > 0 ? { missions: reward.missions } : {}),
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Decisão (comitê)
// ───────────────────────────────────────────────────────────────────────────────
const decisionSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  submissionId: z.string().uuid(),
  decision: z.enum(['ACCEPTED', 'REJECTED', 'REVISION_REQUESTED']),
  notes: z.string().trim().max(4000).optional(),
  overrideQuorum: z.coerce.boolean().optional().default(false),
});

export async function recordDecisionAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = decisionSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    submissionId: formData.get('submissionId'),
    decision: formData.get('decision'),
    notes: (formData.get('notes') as string) || undefined,
    overrideQuorum: formData.get('overrideQuorum') === 'on',
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados da decisão inválidos.' };
  }

  const data = parsed.data;

  const context = await guard({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.SUBMISSION_DECIDE,
  });

  if (!context.ok) return context.state;

  const result = await recordDecision({
    tenantId: context.tenantId,
    submissionId: data.submissionId,
    decidedById: context.userId,
    decision: data.decision,
    notes: data.notes ?? null,
    overrideQuorum: data.overrideQuorum,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  /**
   * Aceite recompensa quem escreveu o trabalho.
   *
   * Só o ACEITE credita: rejeitar não pode punir com perda de XP — a avaliação
   * por pares já é o resultado, e transformar rejeição em penalidade de pontos
   * desencorajaria a submissão de trabalhos arriscados.
   */
  const reward =
    result.status === 'ACCEPTED'
      ? await rewardSubmissionAcceptedById({
          tenantId: context.tenantId,
          submissionId: data.submissionId,
        })
      : null;

  return {
    ok: true,
    message: `Decisão registrada: ${result.status}.`,
    data: {
      status: result.status,
      finalScore: result.finalScore,
      ...(reward && reward.xpAwarded > 0 ? { xpAwarded: reward.xpAwarded } : {}),
    },
  };
}
