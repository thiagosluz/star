/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Avaliação por pares
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ORDEM DAS OPERAÇÕES É A GARANTIA CENTRAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. FILTRAR conflito de interesse   (bloqueia)
 *      2. PONTUAR afinidade               (sugere)
 *      3. ATRIBUIR                        (revalida o conflito!)
 *
 *  O passo 3 revalida o conflito mesmo que o passo 1 já o tenha feito. Isso não
 *  é redundância: entre a sugestão e a confirmação, um revisor pode ter declarado
 *  um conflito novo, ou a lista de autores pode ter mudado. Uma checagem feita
 *  apenas na leitura é uma checagem que pode ser contornada pelo tempo.
 *
 *  A barreira final é o domínio (`detectConflicts`), que roda dentro da
 *  transação de criação da atribuição. Sem esse reexame, existiria uma janela em
 *  que um revisor em conflito poderia ser atribuído.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { notifyReviewAssigned } from '@/lib/communication/notification-service';
import {
  evaluateConflict,
  screenReviewersForConflicts,
  type Conflict,
  type ReviewAuthorIdentity,
  type ReviewerIdentity,
} from '@/domain/review/conflict-of-interest';
import {
  AFFINITY_BAND_LABELS,
  evaluateReviewQuorum,
  rankReviewersByAffinity,
  suggestReviewers,
  type AffinityResult,
  type ReviewerProfile,
  type ReviewerSuggestion,
  type SubmissionProfile,
} from '@/domain/review/affinity';
import {
  computeWeightedScore,
  resolveEffectiveRubric,
  summarizeReviews,
  suggestRecommendation,
  validateScores,
  type DecisionThresholds,
  type ReviewConsensus,
  type ReviewRecommendation,
  type RubricCriterion,
  type WeightedScoreBreakdown,
} from '@/domain/review/review-rules';
import {
  canTransitionSubmission,
  type SubmissionStatus,
} from '@/domain/review/submission-rules';


// ───────────────────────────────────────────────────────────────────────────────
//  Erros
// ───────────────────────────────────────────────────────────────────────────────
export type ReviewErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT_OF_INTEREST'
  | 'ALREADY_ASSIGNED'
  | 'NOT_ASSIGNED'
  | 'ALREADY_SUBMITTED'
  | 'INVALID_SCORES'
  | 'INVALID_TRANSITION'
  | 'QUORUM_NOT_REACHED'
  | 'FORBIDDEN'
  | 'INTERNAL';

export class ReviewError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    message: string,
    readonly details?: readonly string[],
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

export type ReviewResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: ReviewErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Candidatos a revisor
// ───────────────────────────────────────────────────────────────────────────────
export interface ReviewerCandidate {
  userId: string;
  name: string;
  email: string | null;
  institution: string | null;
  institutionalEmailDomain: string | null;
  orcidId: string | null;
  lattesId: string | null;
  expertiseKeywords: string[];
  preferredTrackIds: string[];
  maxConcurrentAssignments: number;
  completedReviewCount: number;
  activeAssignmentCount: number;
  isAvailable: boolean;
  /** Ids de pessoas com quem este revisor declarou conflito. */
  declaredConflictUserIds: string[];
  /** Conflitos declarados especificamente contra esta submissão. */
  declaredConflictSubmissionIds: string[];
  declaredConflictReasons: Map<string, string>;
  hasFinancialTie: boolean;
}

/**
 * Carrega os candidatos a revisor do tenant.
 *
 * Já traz do banco o que o domínio precisa (expertise, carga atual, conflitos
 * declarados) para que a detecção não faça N+1 consultas. Este é o ponto em que
 * "o domínio é puro" encontra "o banco é caro": toda a leitura acontece aqui, e
 * o domínio recebe os dados prontos.
 */
export async function loadReviewerCandidates(
  tenantId: string,
  trackId: string | null,
): Promise<ReviewerCandidate[]> {
  const reviewers = await withTenant(tenantId, (tx) =>
    tx.reviewerExpertise.findMany({
      where: { isAvailable: true },
      select: {
        userId: true,
        expertiseKeywords: true,
        preferredTrackIds: true,
        maxConcurrentAssignments: true,
        completedReviewCount: true,
        declaredInstitution: true,
        institutionalEmailDomain: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            orcidId: true,
            lattesId: true,
            _count: {
              select: {
                reviewAssignments: {
                  where: { status: { in: ['INVITED', 'ACCEPTED', 'IN_PROGRESS'] } },
                },
              },
            },
            conflictDeclarations: {
              where: { revokedAt: null },
              select: {
                conflictedUserId: true,
                submissionId: true,
                reason: true,
                type: true,
                expiresAt: true,
              },
            },
          },
        },
      },
    }),
  );

  const now = Date.now();

  return reviewers
    .map((reviewer) => {
      const activeConflicts = reviewer.user.conflictDeclarations.filter(
        (declaration) => !declaration.expiresAt || declaration.expiresAt.getTime() > now,
      );

      const reasons = new Map<string, string>();
      const conflictedUserIds: string[] = [];
      const conflictedSubmissionIds: string[] = [];

      for (const declaration of activeConflicts) {
        if (declaration.conflictedUserId) {
          conflictedUserIds.push(declaration.conflictedUserId);
          // Uma declaração contra PESSOA vale para toda submissão em que ela
          // apareça — é o caso de "sou coautor deste pesquisador".
          reasons.set(declaration.conflictedUserId, declaration.reason ?? 'Conflito declarado.');
        }
        if (declaration.submissionId) {
          conflictedSubmissionIds.push(declaration.submissionId);
          reasons.set(declaration.submissionId, declaration.reason ?? 'Conflito declarado.');
        }
      }

      return {
        userId: reviewer.userId,
        name: reviewer.user.name,
        email: reviewer.user.email,
        institution: reviewer.declaredInstitution,
        institutionalEmailDomain: reviewer.institutionalEmailDomain,
        orcidId: reviewer.user.orcidId,
        lattesId: reviewer.user.lattesId,
        expertiseKeywords: reviewer.expertiseKeywords,
        preferredTrackIds: reviewer.preferredTrackIds,
        maxConcurrentAssignments: reviewer.maxConcurrentAssignments,
        completedReviewCount: reviewer.completedReviewCount,
        activeAssignmentCount: reviewer.user._count.reviewAssignments,
        isAvailable: true,
        declaredConflictUserIds: conflictedUserIds,
        declaredConflictSubmissionIds: conflictedSubmissionIds,
        declaredConflictReasons: reasons,
        hasFinancialTie: activeConflicts.some((d) => d.type === 'FINANCIAL_TIE'),
      };
    })
    .filter((candidate) => {
      // A trilha é filtro de elegibilidade, não apenas de score: sugerir alguém
      // que não se declarou apto para a trilha geraria ruído na lista.
      if (!trackId) return true;
      if (candidate.preferredTrackIds.length === 0) return true;
      return candidate.preferredTrackIds.includes(trackId);
    });
}

/**
 * Linha de `SubmissionAuthor` como ela chega do banco.
 *
 * Existe separada porque os dois pontos de leitura (painel de atribuição e
 * atribuição propriamente dita) selecionam o mesmo conjunto, e um tipo
 * estrutural documenta essa expectativa em um lugar só.
 */
interface SubmissionAuthorRow {
  userId: string | null;
  guestName: string | null;
  guestEmail: string | null;
  institution: string | null;
  guestInstitution: string | null;
  guestOrcidId: string | null;
  isCorresponding: boolean;
  user: { name: string | null; email: string | null; orcidId: string | null } | null;
}

/**
 * Converte o autor no formato que o domínio de conflito entende.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CONTA DO AUTOR TEM PRECEDÊNCIA SOBRE OS CAMPOS `guest*`
 * ─────────────────────────────────────────────────────────────────────────────
 *  Um autor COM conta não preenche `guestName`/`guestEmail` — esses campos são o
 *  caminho do coautor sem cadastro. Ler apenas `guestEmail` fazia todo autor
 *  cadastrado parecer um autor sem e-mail, e o conflito por domínio
 *  institucional (mesma universidade) simplesmente não disparava.
 *
 *  A precedência é: dado da conta → dado declarado na submissão → vazio. Nunca
 *  o contrário: o cadastro é a fonte que o revisor não controla.
 */
function toAuthorContext(author: SubmissionAuthorRow): ReviewAuthorIdentity {
  const accountName = author.user?.name?.trim();
  const guestName = author.guestName?.trim();

  return {
    userId: author.userId,
    name: accountName || guestName || 'Autor sem nome',
    email: author.user?.email ?? author.guestEmail ?? null,
    institution: author.institution ?? author.guestInstitution ?? null,
    orcidId: author.user?.orcidId ?? author.guestOrcidId ?? null,
    isCorresponding: author.isCorresponding,
  };
}

/** Converte o candidato no formato que o domínio de conflito entende. */
function toReviewerIdentity(
  candidate: ReviewerCandidate,
  submissionId: string,
  authorUserIds: readonly string[],
): ReviewerIdentity {
  // Conflito declarado contra um dos autores DESTA submissão equivale a
  // "declaredConflict" — a razão mais forte possível.
  const conflictsWithAuthor = candidate.declaredConflictUserIds.some((id) =>
    authorUserIds.includes(id),
  );
  const conflictsWithSubmission =
    candidate.declaredConflictSubmissionIds.includes(submissionId);

  const declaredReason = conflictsWithAuthor
    ? candidate.declaredConflictReasons.get(
        candidate.declaredConflictUserIds.find((id) => authorUserIds.includes(id))!,
      )
    : conflictsWithSubmission
      ? candidate.declaredConflictReasons.get(submissionId)
      : undefined;

  return {
    userId: candidate.userId,
    name: candidate.name,
    email: candidate.email,
    institution: candidate.institution,
    institutionalEmailDomain: candidate.institutionalEmailDomain,
    orcidId: candidate.orcidId,
    lattesId: candidate.lattesId,
    hasFinancialTie: candidate.hasFinancialTie,
    declaredConflict: conflictsWithAuthor || conflictsWithSubmission,
    declaredConflictReason: declaredReason ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Painel de atribuição
// ───────────────────────────────────────────────────────────────────────────────
export interface AssignmentBoard {
  submissionId: string;
  protocol: string;
  title: string;
  trackId: string | null;
  /** Revisores elegíveis, do mais para o menos afim. */
  eligible: (AffinityResult & { institution: string | null })[];
  /** Revisores bloqueados, com o motivo — o comitê precisa poder auditar. */
  blocked: { userId: string; name: string; reason: string; conflicts: Conflict[] }[];
  /** Sugestão curta, para ação rápida. */
  suggestions: ReviewerSuggestion[];
  /** Já atribuídos a esta submissão. */
  assigned: { reviewerId: string; reviewerName: string; status: string }[];
  quorum: ReturnType<typeof evaluateReviewQuorum>;
}

/**
 * Monta o painel de distribuição de uma submissão.
 *
 * Devolve tanto os ELEGÍVEIS quanto os BLOQUEADOS com o motivo. Esconder os
 * bloqueados seria pior: o comitê precisa conseguir explicar a um revisor por que
 * ele não foi designado, e precisa perceber quando um conflito foi detectado
 * incorretamente (ex.: homônimo).
 */
export async function buildAssignmentBoard(
  tenantId: string,
  submissionId: string,
): Promise<ReviewResult<{ board: AssignmentBoard }>> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: submissionId, deletedAt: null },
        select: {
          id: true,
          protocol: true,
          title: true,
          abstract: true,
          keywords: true,
          trackId: true,
          submittedById: true,
          authors: {
            select: {
              userId: true,
              guestName: true,
              guestEmail: true,
              institution: true,
              guestInstitution: true,
              guestOrcidId: true,
              isCorresponding: true,
              // A conta do autor: sem ela, um autor COM conta apareceria sem
              // e-mail e o conflito por domínio institucional não dispararia.
              user: { select: { name: true, email: true, orcidId: true } },
            },
          },
          assignments: {
            where: { status: { notIn: ['DECLINED'] } },
            select: {
              reviewerId: true,
              status: true,
              reviewer: { select: { name: true } },
            },
          },
          track: { select: { requiredReviews: true } },
        },
      });

      if (!submission) {
        throw new ReviewError('NOT_FOUND', 'Submissão não encontrada.');
      }

      const candidates = await loadReviewerCandidates(tenantId, submission.trackId);

      const authors: ReviewAuthorIdentity[] = submission.authors.map(toAuthorContext);

      const authorUserIds = authors
        .map((author) => author.userId)
        .filter((id): id is string => Boolean(id));

      // ── 1. Filtrar conflitos ───────────────────────────────────────────────
      const screened = screenReviewersForConflicts(
        candidates.map((candidate) => ({
          ...toReviewerIdentity(candidate, submission.id, authorUserIds),
          _candidate: candidate,
        })),
        authors,
        submission.submittedById,
      );

      const eligibleCandidates = screened.eligible.map((entry) => entry._candidate);
      const blocked = screened.blocked.map((entry) => ({
        userId: entry.reviewer.userId,
        name: entry.reviewer.name,
        reason: entry.verdict.message,
        conflicts: [...entry.verdict.conflicts],
      }));

      // ── 2. Pontuar afinidade ───────────────────────────────────────────────
      const profile: SubmissionProfile = {
        title: submission.title,
        abstract: submission.abstract,
        keywords: submission.keywords,
        trackId: submission.trackId,
      };

      const reviewerProfiles: ReviewerProfile[] = eligibleCandidates.map((candidate) => ({
        userId: candidate.userId,
        name: candidate.name,
        expertiseKeywords: candidate.expertiseKeywords,
        preferredTrackIds: candidate.preferredTrackIds,
        activeAssignmentCount: candidate.activeAssignmentCount,
        maxConcurrentAssignments: candidate.maxConcurrentAssignments,
        completedReviewCount: candidate.completedReviewCount,
      }));

      const ranked = rankReviewersByAffinity(profile, reviewerProfiles);
      const institutionByUser = new Map(
        eligibleCandidates.map((candidate) => [candidate.userId, candidate.institution]),
      );

      const requiredReviews = submission.track?.requiredReviews ?? 2;
      const submittedCount = submission.assignments.filter(
        (assignment) => assignment.status === 'SUBMITTED',
      ).length;

      return {
        ok: true as const,
        board: {
          submissionId: submission.id,
          protocol: submission.protocol,
          title: submission.title,
          trackId: submission.trackId,
          eligible: ranked.map((result) => ({
            ...result,
            institution: institutionByUser.get(result.userId) ?? null,
          })),
          blocked,
          suggestions: suggestReviewers(profile, reviewerProfiles, 5),
          assigned: submission.assignments.map((assignment) => ({
            reviewerId: assignment.reviewerId,
            reviewerName: assignment.reviewer.name,
            status: assignment.status,
          })),
          quorum: evaluateReviewQuorum(submittedCount, requiredReviews),
        },
      };
    });
  } catch (error) {
    return toFailure('buildAssignmentBoard', error);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Atribuição
// ───────────────────────────────────────────────────────────────────────────────
export interface AssignReviewerInput {
  tenantId: string;
  submissionId: string;
  reviewerId: string;
  assignedById: string;
  /** Prazo para entrega do parecer. */
  dueAt?: Date | null;
  /** Justificativa da escolha, registrada para auditoria. */
  matchReason?: string | null;
  /**
   * Autoriza atribuir mesmo com conflito INCERTO (ex.: mesmo domínio de e-mail
   * por coincidência). Nunca permite conflito CERTO, e o override é registrado.
   */
  overrideUncertainConflict?: boolean;
}

/**
 * Atribui um revisor a uma submissão.
 *
 * ─── A REVALIDAÇÃO DO CONFLITO ───────────────────────────────────────────────
 * O conflito é verificado DE NOVO aqui, dentro da transação, mesmo que o painel
 * já o tenha feito. Motivo: entre a montagem do painel e o clique do comitê, o
 * revisor pode ter declarado um conflito novo, ou um autor pode ter sido
 * adicionado. Uma checagem feita só na leitura tem uma janela de validade — e
 * essa janela é exatamente o que um processo de integridade não pode ter.
 */
export async function assignReviewer(
  input: AssignReviewerInput,
): Promise<ReviewResult<{ assignmentId: string; affinityScore: number | null }>> {
  try {
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: input.submissionId, deletedAt: null },
        select: {
          id: true,
          title: true,
          abstract: true,
          keywords: true,
          trackId: true,
          submittedById: true,
          status: true,
          authors: {
            select: {
              userId: true,
              guestName: true,
              guestEmail: true,
              institution: true,
              guestInstitution: true,
              guestOrcidId: true,
              isCorresponding: true,
              user: { select: { name: true, email: true, orcidId: true } },
            },
          },
          track: { select: { requiresBlindReview: true } },
        },
      });

      if (!submission) {
        throw new ReviewError('NOT_FOUND', 'Submissão não encontrada.');
      }

      const already = await tx.reviewAssignment.findFirst({
        where: {
          submissionId: submission.id,
          reviewerId: input.reviewerId,
          status: { notIn: ['DECLINED'] },
        },
        select: { id: true },
      });

      if (already) {
        throw new ReviewError(
          'ALREADY_ASSIGNED',
          'Este revisor já está atribuído a esta submissão.',
        );
      }

      // ── REVALIDAÇÃO DO CONFLITO (dentro da transação) ──────────────────────
      const candidates = await loadReviewerCandidates(input.tenantId, submission.trackId);
      const candidate = candidates.find((entry) => entry.userId === input.reviewerId);

      if (!candidate) {
        throw new ReviewError(
          'NOT_FOUND',
          'Revisor não encontrado ou indisponível para esta trilha.',
        );
      }

      const authors: ReviewAuthorIdentity[] = submission.authors.map(toAuthorContext);

      const authorUserIds = authors
        .map((author) => author.userId)
        .filter((id): id is string => Boolean(id));

      const verdict = evaluateConflict({
        reviewer: toReviewerIdentity(candidate, submission.id, authorUserIds),
        authors,
        submittedById: submission.submittedById,
      });

      if (verdict.blocked) {
        /**
         * Override é permitido APENAS para conflito de confiança INCERTA
         * (tipicamente domínio de e-mail compartilhado por coincidência).
         *
         * Conflito CERTO — autoria, orientação, declaração do revisor — nunca é
         * sobreponível: esses são fatos, não heurísticas.
         */
        const certain = verdict.conflicts.some((c) => c.confidence === 'CERTAIN');
        const canOverride = !certain && input.overrideUncertainConflict === true;

        if (!canOverride) {
          throw new ReviewError(
            'CONFLICT_OF_INTEREST',
            `Atribuição bloqueada por conflito de interesse: ${verdict.message}`,
            verdict.conflicts.map((conflict) => conflict.reason),
          );
        }
      }

      // ── Afinidade, registrada para auditoria ──────────────────────────────
      const ranked = rankReviewersByAffinity(
        {
          title: submission.title,
          abstract: submission.abstract,
          keywords: submission.keywords,
          trackId: submission.trackId,
        },
        [
          {
            userId: candidate.userId,
            name: candidate.name,
            expertiseKeywords: candidate.expertiseKeywords,
            preferredTrackIds: candidate.preferredTrackIds,
            activeAssignmentCount: candidate.activeAssignmentCount,
            maxConcurrentAssignments: candidate.maxConcurrentAssignments,
            completedReviewCount: candidate.completedReviewCount,
          },
        ],
      );

      const affinity = ranked[0]?.score ?? null;

      const assignment = await tx.reviewAssignment.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          submissionId: submission.id,
          reviewerId: input.reviewerId,
          status: 'INVITED',
          affinityScore: affinity,
          matchReason:
            input.matchReason ??
            (verdict.conflicts.length > 0
              ? `Atribuído com conflito incerto autorizado: ${verdict.message}`
              : 'Atribuição manual pelo comitê.'),
          isBlind: submission.track?.requiresBlindReview ?? true,
          assignedById: input.assignedById,
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        },
        select: { id: true },
      });

      // Submissão passa a "em avaliação" quando recebe o primeiro revisor.
      if (submission.status === 'SUBMITTED') {
        await tx.submission.update({
          where: { id: submission.id },
          data: { status: 'UNDER_REVIEW' },
        });
      }

      return { ok: true as const, assignmentId: assignment.id, affinityScore: affinity };
    });

    /**
     * Aviso ao revisor DEPOIS do commit (armadilha 41): a notificação abre a própria
     * transação, e chamá-la de dentro desta faria a leitura não enxergar a atribuição
     * recém-criada. Nunca lança — a atribuição já está gravada.
     */
    await notifyReviewAssigned({
      tenantId: input.tenantId,
      assignmentId: outcome.assignmentId,
      actorId: input.assignedById,
    });

    return outcome;
  } catch (error) {
    return toFailure('assignReviewer', error);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Parecer
// ───────────────────────────────────────────────────────────────────────────────
export interface SubmitReviewInput {
  tenantId: string;
  submissionId: string;
  reviewerId: string;
  scores: Record<string, number>;
  recommendation: ReviewRecommendation;
  confidentialComments?: string | null;
  feedbackToAuthor?: string | null;
}

/**
 * Registra o parecer de um revisor.
 *
 * A nota ponderada é calculada no SERVIDOR a partir da rubrica da trilha. O
 * cliente pode enviar as notas por critério, mas NUNCA a nota final — aceitá-la
 * permitiria a um revisor (ou a um script) declarar qualquer resultado.
 */
export async function submitReview(
  input: SubmitReviewInput,
): Promise<
  ReviewResult<{ reviewId: string; weightedScore: number; breakdown: WeightedScoreBreakdown }>
> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const assignment = await tx.reviewAssignment.findFirst({
        where: {
          submissionId: input.submissionId,
          reviewerId: input.reviewerId,
          status: { notIn: ['DECLINED', 'RECUSED'] },
        },
        select: { id: true, isBlind: true },
      });

      if (!assignment) {
        throw new ReviewError(
          'NOT_ASSIGNED',
          'Você não está atribuído como revisor desta submissão.',
        );
      }

      const submission = await tx.submission.findFirst({
        where: { id: input.submissionId, deletedAt: null },
        select: { id: true, trackId: true, callId: true, version: true, status: true },
      });

      if (!submission) {
        throw new ReviewError('NOT_FOUND', 'Submissão não encontrada.');
      }

      const existing = await tx.review.findFirst({
        where: { submissionId: submission.id, reviewerId: input.reviewerId },
        select: { id: true, submittedAt: true },
      });

      if (existing?.submittedAt) {
        throw new ReviewError('ALREADY_SUBMITTED', 'Este parecer já foi enviado.');
      }

      // ── Rubrica e validação das notas ─────────────────────────────────────
      const rubric: readonly RubricCriterion[] = await resolveRubricForTx(tx, {
        trackId: submission.trackId,
        callId: submission.callId,
      });

      const validation = validateScores(rubric, input.scores);
      if (!validation.valid) {
        throw new ReviewError(
          'INVALID_SCORES',
          'As notas informadas são inválidas.',
          validation.errors.map((error) => error.message),
        );
      }

      const breakdown = computeWeightedScore(rubric, input.scores);
      if (!breakdown) {
        throw new ReviewError(
          'INVALID_SCORES',
          'Não foi possível calcular a nota ponderada.',
        );
      }

      // ── Persistência ──────────────────────────────────────────────────────
      const submittedAt = new Date();

      const review = existing
        ? await tx.review.update({
            where: { id: existing.id },
            data: {
              status: 'SUBMITTED',
              recommendation: input.recommendation,
              scores: input.scores,
              weightedScore: breakdown.score,
              scoreBreakdown: breakdown.contributions as unknown as object,
              confidentialComments: input.confidentialComments ?? null,
              feedbackToAuthor: input.feedbackToAuthor ?? null,
              submissionVersion: submission.version,
              submittedAt,
            },
            select: { id: true },
          })
        : await tx.review.create({
            data: {
              id: crypto.randomUUID(),
              tenantId: input.tenantId,
              submissionId: submission.id,
              reviewerId: input.reviewerId,
              assignmentId: assignment.id,
              status: 'SUBMITTED',
              recommendation: input.recommendation,
              scores: input.scores,
              weightedScore: breakdown.score,
              scoreBreakdown: breakdown.contributions as unknown as object,
              confidentialComments: input.confidentialComments ?? null,
              feedbackToAuthor: input.feedbackToAuthor ?? null,
              isBlind: assignment.isBlind,
              submissionVersion: submission.version,
              submittedAt,
            },
            select: { id: true },
          });

      await tx.reviewAssignment.update({
        where: { id: assignment.id },
        data: { status: 'SUBMITTED', respondedAt: submittedAt },
      });

      // Contador de experiência do revisor (satura em 10 no cálculo de afinidade).
      await tx.reviewerExpertise.updateMany({
        where: { tenantId: input.tenantId, userId: input.reviewerId },
        data: { completedReviewCount: { increment: 1 } },
      });

      return {
        ok: true as const,
        reviewId: review.id,
        weightedScore: breakdown.score,
        breakdown,
      };
    });
  } catch (error) {
    return toFailure('submitReview', error);
  }
}

/**
 * Resolve a rubrica usando uma transação já aberta (evita abrir outra).
 *
 * A precedência é CHAMADA → TRILHA → PADRÃO (FASE 33): a proposta de uma chamada com
 * rubrica própria é julgada pelos critérios DELA, mesmo quando a chamada aponta uma
 * trilha para a afinidade dos revisores.
 */
async function resolveRubricForTx(
  tx: TxClient,
  input: { trackId: string | null; callId: string | null },
): Promise<readonly RubricCriterion[]> {
  const { resolveEffectiveRubric } = await import('@/domain/review/review-rules');

  const [track, call] = await Promise.all([
    input.trackId
      ? tx.track.findFirst({ where: { id: input.trackId }, select: { reviewRubric: true } })
      : null,
    input.callId
      ? tx.callForProposals.findFirst({
          where: { id: input.callId },
          select: { reviewRubric: true },
        })
      : null,
  ]);

  return resolveEffectiveRubric({
    callRubric: call?.reviewRubric,
    trackRubric: track?.reviewRubric,
  }).rubric;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Painel do revisor
// ───────────────────────────────────────────────────────────────────────────────
export interface ReviewerTask {
  assignmentId: string;
  submissionId: string;
  protocol: string;
  title: string;
  abstract: string;
  keywords: string[];
  trackName: string | null;
  eventTitle: string;
  isBlind: boolean;
  dueAt: Date | null;
  status: string;
  /** Parecer já enviado? */
  hasReview: boolean;
  /**
   * O prazo venceu e o parecer não foi entregue.
   *
   * Calculado na CAMADA DE SERVIÇO, não no componente: ler o relógio durante a
   * renderização viola a idempotência exigida pelo React (regra
   * `react-hooks/purity`). Como o atraso é um dado derivado, ele pertence aqui —
   * o componente apenas exibe.
   */
  isOverdue: boolean;
  /** Artefatos visíveis a este revisor (respeita a revisão cega). */
  files: { id: string; kind: string; fileName: string; sizeBytes: number }[];
}

/**
 * Lista as tarefas de revisão do usuário.
 *
 * O filtro de arquivos é aplicado AQUI, no servidor: o revisor recebe apenas os
 * artefatos que lhe são permitidos. A versão identificada nunca sai do servidor
 * para um revisor em revisão cega — filtrar na UI seria uma barreira cosmética.
 */
export async function listReviewerTasks(
  tenantId: string,
  reviewerId: string,
): Promise<ReviewerTask[]> {
  const assignments = await withTenant(tenantId, (tx) =>
    tx.reviewAssignment.findMany({
      where: {
        reviewerId,
        status: { notIn: ['DECLINED', 'RECUSED'] },
      },
      orderBy: [{ dueAt: 'asc' }, { invitedAt: 'asc' }],
      select: {
        id: true,
        status: true,
        isBlind: true,
        dueAt: true,
        submission: {
          select: {
            id: true,
            protocol: true,
            title: true,
            abstract: true,
            keywords: true,
            status: true,
            track: { select: { name: true } },
            event: { select: { title: true } },
            files: {
              where: { isCurrent: true, deletedAt: null },
              select: {
                id: true,
                kind: true,
                fileName: true,
                sizeBytes: true,
              },
            },
          },
        },
      },
    }),
  );

  // Quais já têm parecer enviado por este revisor?
  const submitted = await withTenant(tenantId, (tx) =>
    tx.review.findMany({
      where: {
        reviewerId,
        submittedAt: { not: null },
        submissionId: { in: assignments.map((a) => a.submission.id) },
      },
      select: { submissionId: true },
    }),
  );
  const submittedSet = new Set(submitted.map((review) => review.submissionId));
  const now = Date.now();

  return assignments.map((assignment) => {
    // Revisão cega: apenas o PDF cego é exposto.
    const visibleFiles = assignment.isBlind
      ? assignment.submission.files.filter((file) => file.kind === 'BLIND_PDF')
      : assignment.submission.files;

    const hasReview = submittedSet.has(assignment.submission.id);

    return {
      assignmentId: assignment.id,
      submissionId: assignment.submission.id,
      protocol: assignment.submission.protocol,
      title: assignment.submission.title,
      abstract: assignment.submission.abstract,
      keywords: assignment.submission.keywords,
      trackName: assignment.submission.track?.name ?? null,
      eventTitle: assignment.submission.event.title,
      isBlind: assignment.isBlind,
      dueAt: assignment.dueAt,
      status: assignment.status,
      hasReview,
      isOverdue: Boolean(assignment.dueAt && assignment.dueAt.getTime() < now && !hasReview),
      files: visibleFiles.map((file) => ({
        id: file.id,
        kind: file.kind,
        fileName: file.fileName,
        sizeBytes: Number(file.sizeBytes),
      })),
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Consolidação e decisão
// ───────────────────────────────────────────────────────────────────────────────
export interface SubmissionReviewPanel {
  submissionId: string;
  protocol: string;
  title: string;
  status: SubmissionStatus;
  rubric: readonly RubricCriterion[];
  reviews: {
    reviewId: string;
    reviewerId: string;
    reviewerName: string;
    recommendation: ReviewRecommendation | null;
    weightedScore: number | null;
    scores: Record<string, unknown>;
    feedbackToAuthor: string | null;
    confidentialComments: string | null;
    submittedAt: Date | null;
    submissionVersion: number;
  }[];
  consensus: ReviewConsensus;
  /** Sugestão derivada da média — a decisão é humana. */
  suggestedRecommendation: ReviewRecommendation | null;
  quorum: ReturnType<typeof evaluateReviewQuorum>;
}

/** Painel do comitê: todos os pareceres e o consenso. */
export async function getSubmissionReviewPanel(
  tenantId: string,
  submissionId: string,
): Promise<ReviewResult<{ panel: SubmissionReviewPanel }>> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: submissionId, deletedAt: null },
        select: {
          id: true,
          protocol: true,
          title: true,
          status: true,
          trackId: true,
          callId: true,
          track: {
            select: {
              requiredReviews: true,
              reviewRubric: true,
              acceptanceThreshold: true,
              rejectThreshold: true,
            },
          },
          call: { select: { reviewRubric: true } },
          reviews: {
            where: { deletedAt: null },
            select: {
              id: true,
              reviewerId: true,
              recommendation: true,
              weightedScore: true,
              scores: true,
              feedbackToAuthor: true,
              confidentialComments: true,
              submittedAt: true,
              submissionVersion: true,
              reviewer: { select: { name: true } },
            },
          },
        },
      });

      if (!submission) {
        throw new ReviewError('NOT_FOUND', 'Submissão não encontrada.');
      }

      /**
       * A rubrica da CHAMADA vence a da trilha (FASE 33); sem nenhuma das duas, o
       * padrão. O quórum e os limiares continuam vindo da trilha — quando ela não
       * existe (palestrante, minicurso), valem os padrões declarados abaixo.
       */
      const rubric = resolveEffectiveRubric({
        callRubric: submission.call?.reviewRubric,
        trackRubric: submission.track?.reviewRubric,
      }).rubric;

      const reviews = submission.reviews.map((review) => ({
        reviewId: review.id,
        reviewerId: review.reviewerId,
        reviewerName: review.reviewer.name,
        recommendation: review.recommendation as ReviewRecommendation | null,
        weightedScore: review.weightedScore ? Number(review.weightedScore) : null,
        scores: (review.scores ?? {}) as Record<string, unknown>,
        feedbackToAuthor: review.feedbackToAuthor,
        confidentialComments: review.confidentialComments,
        submittedAt: review.submittedAt,
        submissionVersion: review.submissionVersion,
      }));

      const consensus = summarizeReviews(
        reviews.map((review) => ({
          id: review.reviewId,
          recommendation: review.recommendation,
          weightedScore: review.weightedScore,
          scores: review.scores,
        })),
      );

      const thresholds: DecisionThresholds = {
        acceptThreshold: Number(submission.track?.acceptanceThreshold ?? 70),
        rejectThreshold: Number(submission.track?.rejectThreshold ?? 45),
      };

      const submittedCount = reviews.filter((review) => review.submittedAt !== null).length;

      return {
        ok: true as const,
        panel: {
          submissionId: submission.id,
          protocol: submission.protocol,
          title: submission.title,
          status: submission.status as SubmissionStatus,
          rubric,
          reviews,
          consensus,
          suggestedRecommendation:
            consensus.averageScore !== null
              ? suggestRecommendation(consensus.averageScore, thresholds)
              : null,
          quorum: evaluateReviewQuorum(
            submittedCount,
            submission.track?.requiredReviews ?? 2,
          ),
        },
      };
    });
  } catch (error) {
    return toFailure('getSubmissionReviewPanel', error);
  }
}

export interface RecordDecisionInput {
  tenantId: string;
  submissionId: string;
  decidedById: string;
  decision: 'ACCEPTED' | 'REJECTED' | 'REVISION_REQUESTED';
  notes?: string | null;
  /**
   * Autoriza decidir sem quórum completo. Exige justificativa: decidir com
   * menos pareceres que o previsto é uma exceção, e exceções precisam de motivo
   * registrado.
   */
  overrideQuorum?: boolean;
}

/**
 * Registra a decisão do comitê sobre uma submissão.
 *
 * Duas barreiras:
 *   1. a transição de status precisa ser válida (máquina de estados);
 *   2. o quórum de pareceres precisa estar completo — a menos que o comitê
 *      assuma explicitamente a decisão antecipada, com justificativa.
 */
export async function recordDecision(
  input: RecordDecisionInput,
): Promise<ReviewResult<{ status: SubmissionStatus; finalScore: number | null }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: input.submissionId, deletedAt: null },
        select: {
          id: true,
          status: true,
          track: { select: { requiredReviews: true } },
          reviews: {
            where: { submittedAt: { not: null }, deletedAt: null },
            select: { weightedScore: true },
          },
        },
      });

      if (!submission) {
        throw new ReviewError('NOT_FOUND', 'Submissão não encontrada.');
      }

      const from = submission.status as SubmissionStatus;

      if (!canTransitionSubmission(from, input.decision)) {
        throw new ReviewError(
          'INVALID_TRANSITION',
          `Não é possível mudar o status de ${from} para ${input.decision}.`,
        );
      }

      const submittedCount = submission.reviews.length;
      const required = submission.track?.requiredReviews ?? 2;
      const quorum = evaluateReviewQuorum(submittedCount, required);

      if (!quorum.satisfied && !input.overrideQuorum) {
        throw new ReviewError('QUORUM_NOT_REACHED', quorum.message);
      }

      if (!quorum.satisfied && input.overrideQuorum && !input.notes?.trim()) {
        throw new ReviewError(
          'QUORUM_NOT_REACHED',
          'Decidir sem o quórum completo exige justificativa registrada.',
        );
      }

      const scores = submission.reviews
        .map((review) => (review.weightedScore ? Number(review.weightedScore) : null))
        .filter((score): score is number => score !== null);

      const finalScore =
        scores.length > 0
          ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
          : null;

      await tx.submission.update({
        where: { id: submission.id },
        data: {
          status: input.decision,
          finalScore,
          decisionAt: new Date(),
          decisionById: input.decidedById,
          decisionNotes: input.notes ?? null,
        },
      });

      return { ok: true as const, status: input.decision as SubmissionStatus, finalScore };
    });
  } catch (error) {
    return toFailure('recordDecision', error);
  }
}

/** Fila de submissões para o comitê decidir. */
export async function listSubmissionsForChair(
  tenantId: string,
  options: { status?: SubmissionStatus[] } = {},
): Promise<
  {
    id: string;
    protocol: string;
    title: string;
    status: SubmissionStatus;
    trackName: string | null;
    submittedAt: Date | null;
    reviewCount: number;
    requiredReviews: number;
    averageScore: number | null;
  }[]
> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.submission.findMany({
      where: {
        deletedAt: null,
        ...(options.status ? { status: { in: options.status } } : {
          status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'REVISION_REQUESTED'] },
        }),
      },
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true,
        protocol: true,
        title: true,
        status: true,
        submittedAt: true,
        track: { select: { name: true, requiredReviews: true } },
        reviews: {
          where: { submittedAt: { not: null }, deletedAt: null },
          select: { weightedScore: true },
        },
      },
    }),
  );

  return rows.map((row) => {
    const scores = row.reviews
      .map((review) => (review.weightedScore ? Number(review.weightedScore) : null))
      .filter((score): score is number => score !== null);

    return {
      id: row.id,
      protocol: row.protocol,
      title: row.title,
      status: row.status as SubmissionStatus,
      trackName: row.track?.name ?? null,
      submittedAt: row.submittedAt,
      reviewCount: row.reviews.length,
      requiredReviews: row.track?.requiredReviews ?? 2,
      averageScore:
        scores.length > 0
          ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
          : null,
    };
  });
}

export { AFFINITY_BAND_LABELS };

// ───────────────────────────────────────────────────────────────────────────────
function toFailure<T>(operation: string, error: unknown): ReviewResult<T> & { ok: false } {
  if (error instanceof ReviewError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }

  console.error(
    `[review] falha inesperada em ${operation}:`,
    error instanceof Error ? error.message : error,
  );

  return {
    ok: false,
    code: 'INTERNAL',
    message: 'Não foi possível concluir a operação. Tente novamente.',
  };
}
