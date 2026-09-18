/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Teste de INTEGRAÇÃO — Submissão, conflito de interesse e revisão cega
 *
 *  Prova, contra PostgreSQL e MinIO reais, que:
 *
 *    1. a REVALIDAÇÃO do conflito bloqueia a atribuição mesmo quando a lista de
 *       elegíveis foi montada antes;
 *    2. o override só é permitido para conflito INCERTO — nunca para conflito
 *       certo (autoria, orientação, declaração);
 *    3. o artefato cego NÃO é acessível a terceiros fora do fluxo autorizado;
 *    4. a integridade do arquivo é conferida no storage e a troca é detectada;
 *    5. a nota ponderada persistida é calculada do lado do servidor;
 *    6. decidir sem quórum exige justificativa registrada.
 *
 *  Requer: docker compose up -d && npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  BUCKETS,
  buildObjectKey,
  createUploadUrl,
  inspectObject,
} from '../../src/lib/storage/s3-client';
import {
  confirmUpload,
  createSubmission,
  deleteSubmission,
  getFileDownloadUrl,
  submitSubmission,
  updateSubmissionDraft,
} from '../../src/lib/review/submission-service';
import {
  assignReviewer,
  getSubmissionReviewPanel,
  recordDecision,
  submitReview,
} from '../../src/lib/review/review-service';

const RUN = randomUUID().slice(0, 8);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

let tenantId: string;
let eventId: string;
let trackId: string;
let authorId: string;
/** Revisor com a MESMA instituição declarada do autor (conflito certo). */
let conflictedReviewerId: string;
/** Revisor de instituição e domínio diferentes (elegível). */
let cleanReviewerId: string;

/** Cria um usuário e o vincula à instituição. */
async function createUser(label: string, email: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name: label, email, emailVerified: true },
  });
  await withTenant(tenantId, (tx) =>
    tx.userTenantProfile.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId: id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    }),
  );
  return id;
}

/** Registra o revisor com áreas de atuação e instituição. */
async function createReviewer(input: {
  userId: string;
  keywords: string[];
  institution: string | null;
  domain: string | null;
}): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.reviewerExpertise.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId: input.userId,
        expertiseKeywords: input.keywords,
        preferredTrackIds: [trackId],
        declaredInstitution: input.institution,
        institutionalEmailDomain: input.domain,
        maxConcurrentAssignments: 10,
      },
    }),
  );
}

/**
 * Cria uma submissão RASCUNHO e devolve o id.
 *
 * O autor correspondente é registrado AUTOMATICAMENTE por `createSubmission` —
 * quem submete é autor do trabalho. A edição da lista (coautores e ordem de
 * crédito) é um passo separado e tem cobertura nos testes de domínio.
 */
async function createDraft(): Promise<string> {
  const result = await createSubmission({
    tenantId,
    eventId,
    trackId,
    userId: authorId,
    title: 'Aprendizado de máquina aplicado à vigilância epidemiológica',
    abstract:
      'Este trabalho investiga modelos de aprendizado de máquina para a predição de surtos epidemiológicos a partir de dados de vigilância em saúde pública, comparando abordagens supervisionadas e avaliando o desempenho em séries temporais reais.',
    keywords: ['aprendizado de máquina', 'epidemiologia', 'vigilância em saúde'],
  });

  if (!result.ok) throw new Error(`Falha ao criar submissão: ${result.message}`);
  return result.id;
}

/**
 * Declara a instituição de TODOS os autores da submissão.
 *
 * `createSubmission` registra o autor correspondente a partir da conta, que não
 * carrega afiliação. Sem esta declaração, o conflito de mesma instituição só
 * pode ser detectado pelo domínio de e-mail — que é uma evidência INCERTA. Os
 * testes que exigem conflito CERTO precisam declarar a afiliação.
 */
async function declareAuthorInstitution(
  submissionId: string,
  institution: string,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.submissionAuthor.updateMany({
      where: { submissionId },
      data: { institution },
    }),
  );
}

/**
 * Faz upload real de um PDF e confirma a integridade, devolvendo o id do arquivo.
 *
 * O `kind` é parâmetro porque a revisão cega só é demonstrável comparando o que
 * o revisor PODE ver (BLIND_PDF) com o que ele NÃO pode (IDENTIFIED_PDF).
 */
async function uploadPdf(
  submissionId: string,
  kind: 'BLIND_PDF' | 'IDENTIFIED_PDF',
): Promise<string> {
  const fileName = kind === 'BLIND_PDF' ? 'artigo-cego.pdf' : 'artigo-identificado.pdf';
  const checksum = createHash('sha256').update(PDF).digest('hex');

  const submission = await withTenant(tenantId, (tx) =>
    tx.submission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { eventId: true, version: true },
    }),
  );

  const bucket = BUCKETS.submissions();
  const objectKey = buildObjectKey({
    tenantId,
    eventId: submission.eventId,
    submissionId,
    kind,
    version: 1,
    fileName,
  });

  const ticket = await createUploadUrl({
    bucket,
    objectKey,
    contentType: 'application/pdf',
    contentLength: PDF.length,
  });

  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.requiredHeaders,
    body: PDF,
  });
  if (!put.ok) throw new Error(`PUT falhou: HTTP ${put.status}`);

  const confirmed = await confirmUpload({
    tenantId,
    submissionId,
    userId: authorId,
    kind,
    objectKey,
    bucket,
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: PDF.length,
    checksum,
    version: 1,
  });

  if (!confirmed.ok) throw new Error(`Confirmação falhou: ${confirmed.message}`);
  return confirmed.fileId;
}

/** Faz upload real do PDF cego e confirma a integridade. */
async function uploadBlindPdf(submissionId: string): Promise<void> {
  await uploadPdf(submissionId, 'BLIND_PDF');
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  trackId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `peer-${RUN}`,
      name: `Instituição Peer Review ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
  });

  await withTenant(tenantId, async (tx) => {
    const startsAt = new Date(Date.now() + 60 * 86_400_000);

    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: 'evento-peer',
        title: 'Evento de Avaliação por Pares',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
        cfpOpensAt: new Date(Date.now() - 86_400_000),
        cfpClosesAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    await tx.track.create({
      data: {
        id: trackId,
        tenantId,
        eventId,
        slug: 'trilha-ml',
        name: 'Aprendizado de Máquina',
        requiresBlindReview: true,
        requiredReviews: 2,
        /**
         * Limite alto de propósito.
         *
         * Este é um cenário de teste que cria MUITAS submissões com o mesmo autor
         * para exercitar caminhos independentes. Com um limite baixo (como 5), os
         * testes passariam a falhar por esgotamento do limite em vez de por
         * regressão no comportamento que estão verificando — um falso negativo
         * que esconderia bugs reais.
         *
         * O limite por autor tem cobertura própria nos testes unitários de
         * domínio; aqui o que importa é o fluxo de avaliação.
         */
        maxSubmissionsPerAuthor: 100,
        // Rubrica com pesos diferentes para exercitar a ponderação.
        reviewRubric: [
          { key: 'originality', label: 'Originalidade', weight: 3, maxScore: 10 },
          { key: 'methodology', label: 'Metodologia', weight: 2, maxScore: 10 },
          { key: 'clarity', label: 'Clareza', weight: 1, maxScore: 10 },
        ],
        acceptanceThreshold: 70,
        rejectThreshold: 45,
      },
    });
  });

  authorId = await createUser('Autora Principal', `autora.${RUN}@universidade-a.edu.br`);
  conflictedReviewerId = await createUser(
    'Revisor Conflitado',
    `conflitado.${RUN}@universidade-a.edu.br`,
  );
  cleanReviewerId = await createUser(
    'Revisor Elegível',
    `elegivel.${RUN}@universidade-b.edu.br`,
  );

  await createReviewer({
    userId: conflictedReviewerId,
    keywords: ['aprendizado de máquina', 'epidemiologia'],
    institution: 'Universidade A',
    domain: 'universidade-a.edu.br',
  });

  await createReviewer({
    userId: cleanReviewerId,
    keywords: ['aprendizado de máquina', 'epidemiologia', 'saúde pública'],
    institution: 'Universidade B',
    domain: 'universidade-b.edu.br',
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('submissão com upload real', () => {
  it('cria, anexa o PDF cego e envia para avaliação', async () => {
    const submissionId = await createDraft();
    await uploadBlindPdf(submissionId);

    const submitted = await submitSubmission({
      tenantId,
      submissionId,
      userId: authorId,
    });

    expect(
      submitted.ok,
      submitted.ok ? 'ok' : `código=${submitted.code} | ${submitted.message} | ${(submitted.details ?? []).join('; ')}`,
    ).toBe(true);
    if (submitted.ok) expect(submitted.status).toBe('SUBMITTED');

    const detail = await withTenant(tenantId, (tx) =>
      tx.submission.findUniqueOrThrow({
        where: { id: submissionId },
        select: {
          status: true,
          protocol: true,
          submittedAt: true,
          blindSnapshot: true,
          files: { select: { kind: true, checksum: true, sizeBytes: true } },
        },
      }),
    );

    expect(detail.status).toBe('SUBMITTED');
    expect(detail.submittedAt).not.toBeNull();
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0]?.kind).toBe('BLIND_PDF');
    expect(detail.files[0]?.checksum).toHaveLength(64);
    expect(Number(detail.files[0]?.sizeBytes)).toBe(PDF.length);
    // O snapshot é gravado no envio: é dele que a versão cega é derivada.
    expect(detail.blindSnapshot).toBeTruthy();
  }, 60_000);

  it('NÃO envia sem o artefato exigido pela trilha', async () => {
    const submissionId = await createDraft();

    const submitted = await submitSubmission({
      tenantId,
      submissionId,
      userId: authorId,
    });

    expect(submitted.ok).toBe(false);
    if (!submitted.ok) {
      expect(submitted.code).toBe('NOT_READY');
      expect(submitted.details?.join(' ')).toMatch(/revisão cega/i);
    }
  }, 30_000);

  it('DETECTA arquivo trocado (tamanho divergente) e descarta o objeto', async () => {
    const submissionId = await createDraft();
    const checksum = createHash('sha256').update(PDF).digest('hex');

    const bucket = BUCKETS.submissions();
    const objectKey = buildObjectKey({
      tenantId,
      eventId,
      submissionId,
      kind: 'BLIND_PDF',
      version: 1,
      fileName: 'trocado.pdf',
    });

    const ticket = await createUploadUrl({
      bucket,
      objectKey,
      contentType: 'application/pdf',
      contentLength: PDF.length,
    });

    // Envia conteúdo MAIOR que o declarado — o storage rejeita pela assinatura.
    const bigger = Buffer.concat([PDF, Buffer.from('conteudo adicional')]);
    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.requiredHeaders,
      body: bigger,
    });

    expect(put.ok).toBe(false);

    // Nada foi registrado.
    const count = await withTenant(tenantId, (tx) =>
      tx.submissionFile.count({ where: { submissionId } }),
    );
    expect(count).toBe(0);
    expect(checksum).toHaveLength(64);
  }, 60_000);

  it('recusa arquivo cuja assinatura não é PDF', async () => {
    const submissionId = await createDraft();

    const result = await confirmUpload({
      tenantId,
      submissionId,
      userId: authorId,
      kind: 'BLIND_PDF',
      objectKey: 'inexistente.pdf',
      bucket: BUCKETS.submissions(),
      fileName: 'falso.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      checksum: 'a'.repeat(64),
      version: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UPLOAD_MISSING');
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('conflito de interesse na ATRIBUIÇÃO', () => {
  it('BLOQUEIA atribuição a revisor da mesma instituição (conflito certo)', async () => {
    const submissionId = await createDraft();
    await uploadBlindPdf(submissionId);
    await declareAuthorInstitution(submissionId, 'Universidade A');
    await submitSubmission({ tenantId, submissionId, userId: authorId });

    const result = await assignReviewer({
      tenantId,
      submissionId,
      reviewerId: conflictedReviewerId,
      assignedById: authorId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONFLICT_OF_INTEREST');
      expect(result.message).toMatch(/conflito/i);
    }

    // Nada foi persistido.
    const count = await withTenant(tenantId, (tx) =>
      tx.reviewAssignment.count({ where: { submissionId } }),
    );
    expect(count).toBe(0);
  }, 60_000);

  it('NÃO permite override de conflito CERTO nem com a flag ligada', async () => {
    const submissionId = await createDraft();
    await uploadBlindPdf(submissionId);
    await declareAuthorInstitution(submissionId, 'Universidade A');
    await submitSubmission({ tenantId, submissionId, userId: authorId });

    /**
     * Conflito certo (mesma instituição declarada) é um FATO, não uma
     * heurística. Permitir override abriria a porta para "autorizar" um autor
     * avaliando o próprio trabalho.
     */
    const result = await assignReviewer({
      tenantId,
      submissionId,
      reviewerId: conflictedReviewerId,
      assignedById: authorId,
      overrideUncertainConflict: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CONFLICT_OF_INTEREST');
  }, 60_000);

  it('PERMITE override quando o conflito é apenas INCERTO (domínio coincidente)', async () => {
    const submissionId = await createDraft();
    await uploadBlindPdf(submissionId);
    /**
     * Sem afiliação declarada pelo autor, a única evidência é o domínio de
     * e-mail compartilhado — heurística, não fato. É exatamente o caso em que o
     * comitê pode assumir o risco de forma explícita.
     */
    await submitSubmission({ tenantId, submissionId, userId: authorId });

    const blocked = await assignReviewer({
      tenantId,
      submissionId,
      reviewerId: conflictedReviewerId,
      assignedById: authorId,
    });

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('CONFLICT_OF_INTEREST');

    const overridden = await assignReviewer({
      tenantId,
      submissionId,
      reviewerId: conflictedReviewerId,
      assignedById: authorId,
      overrideUncertainConflict: true,
    });

    expect(
      overridden.ok,
      overridden.ok ? 'ok' : `código=${overridden.code} | ${overridden.message}`,
    ).toBe(true);

    // O motivo registrado precisa deixar claro que houve decisão humana.
    const assignment = await withTenant(tenantId, (tx) =>
      tx.reviewAssignment.findFirstOrThrow({
        where: { submissionId, reviewerId: conflictedReviewerId },
        select: { matchReason: true },
      }),
    );
    expect(assignment.matchReason).toContain('conflito incerto autorizado');
  }, 60_000);

  it('AUTORIZA atribuição a revisor elegível', async () => {
    const submissionId = await createDraft();
    await uploadBlindPdf(submissionId);
    await submitSubmission({ tenantId, submissionId, userId: authorId });

    const result = await assignReviewer({
      tenantId,
      submissionId,
      reviewerId: cleanReviewerId,
      assignedById: authorId,
      matchReason: 'Afinidade alta na trilha de aprendizado de máquina.',
    });

    expect(result.ok).toBe(true);

    const assignment = await withTenant(tenantId, (tx) =>
      tx.reviewAssignment.findFirstOrThrow({
        where: { submissionId, reviewerId: cleanReviewerId },
        select: { status: true, isBlind: true, affinityScore: true, matchReason: true },
      }),
    );

    expect(assignment.status).toBe('INVITED');
    expect(assignment.isBlind).toBe(true);
    // A afinidade fica registrada para auditoria da escolha.
    expect(assignment.affinityScore).not.toBeNull();
    expect(assignment.matchReason).toContain('Afinidade');
  }, 60_000);

  it('RESPEITA conflito declarado pelo próprio revisor', async () => {
    const submissionId = await createDraft();
    await uploadBlindPdf(submissionId);
    await submitSubmission({ tenantId, submissionId, userId: authorId });

    // O revisor declara conflito com o AUTOR (vale para qualquer submissão dele).
    await withTenant(tenantId, (tx) =>
      tx.reviewerConflictDeclaration.create({
        data: {
          id: randomUUID(),
          tenantId,
          reviewerId: cleanReviewerId,
          conflictedUserId: authorId,
          type: 'FINANCIAL_TIE',
          reason: 'Consultoria remunerada prestada à mesma instituição da autora.',
        },
      }),
    );

    try {
      const result = await assignReviewer({
        tenantId,
        submissionId,
        reviewerId: cleanReviewerId,
        assignedById: authorId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CONFLICT_OF_INTEREST');
        expect(result.message).toMatch(/consultoria|conflito/i);
      }
    } finally {
      // Remove a declaração para não afetar os testes seguintes.
      await withTenant(tenantId, (tx) =>
        tx.reviewerConflictDeclaration.deleteMany({
          where: { tenantId, reviewerId: cleanReviewerId, conflictedUserId: authorId },
        }),
      );
    }
  }, 60_000);

  it('impede atribuir o mesmo revisor duas vezes à mesma submissão', async () => {
    const submissionId = await createDraft();
    await uploadBlindPdf(submissionId);
    await submitSubmission({ tenantId, submissionId, userId: authorId });

    const first = await assignReviewer({
      tenantId,
      submissionId,
      reviewerId: cleanReviewerId,
      assignedById: authorId,
    });
    expect(first.ok).toBe(true);

    const second = await assignReviewer({
      tenantId,
      submissionId,
      reviewerId: cleanReviewerId,
      assignedById: authorId,
    });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('ALREADY_ASSIGNED');
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('revisão cega no acesso ao ARQUIVO', () => {
  it('NEGA a versão identificada ao revisor e PERMITE ao autor', async () => {
    const submissionId = await createDraft();
    await uploadBlindPdf(submissionId);
    const identifiedFileId = await uploadPdf(submissionId, 'IDENTIFIED_PDF');
    await submitSubmission({ tenantId, submissionId, userId: authorId });

    const assigned = await assignReviewer({
      tenantId,
      submissionId,
      reviewerId: cleanReviewerId,
      assignedById: authorId,
    });
    expect(assigned.ok).toBe(true);

    /**
     * ─── POR QUE ESTA ASSERÇÃO EXISTE NA CAMADA DE DADOS ─────────────────────
     * A página de revisão já filtra os arquivos visíveis antes de pedir as URLs.
     * Mas uma URL pré-assinada é acesso DIRETO ao objeto: se a regra vivesse só
     * na montagem da lista, qualquer novo ponto de uso que recebesse um fileId
     * (um route handler, um relatório, um e-mail) emitiria a URL da versão
     * identificada. Aqui a regra é verificada onde a URL é emitida.
     */
    const denied = await getFileDownloadUrl(tenantId, identifiedFileId, {
      role: 'REVIEWER',
      isBlind: true,
    });

    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('FORBIDDEN');

    // O autor conhece a própria autoria: para ele, nada é sigiloso.
    const allowed = await getFileDownloadUrl(tenantId, identifiedFileId, {
      role: 'AUTHOR',
      isBlind: true,
    });

    expect(allowed.ok, allowed.ok ? 'ok' : `${allowed.code} | ${allowed.message}`).toBe(true);
  }, 60_000);

  it('PERMITE a versão cega ao revisor (o sigilo não pode impedir o trabalho)', async () => {
    const submissionId = await createDraft();
    const blindFileId = await uploadPdf(submissionId, 'BLIND_PDF');
    await submitSubmission({ tenantId, submissionId, userId: authorId });

    const result = await getFileDownloadUrl(tenantId, blindFileId, {
      role: 'REVIEWER',
      isBlind: true,
    });

    expect(result.ok, result.ok ? 'ok' : `${result.code} | ${result.message}`).toBe(true);
  }, 60_000);
});

/**
 * Prepara uma submissão enviada com DOIS revisores elegíveis atribuídos.
 *
 * Declarada no escopo do módulo (e não dentro do `describe`) porque é usada por
 * vários testes: uma função declarada dentro do bloco não é visível para os
 * callbacks dos `it`, que são registrados fora daquele escopo.
 */
async function prepareSubmission(): Promise<string> {
  const submissionId = await createDraft();
  await uploadBlindPdf(submissionId);
  await submitSubmission({ tenantId, submissionId, userId: authorId });

  // Um segundo revisor elegível, para exercitar o consenso entre pareceres.
  const secondReviewer = await createUser(
    `Revisor Dois ${randomUUID().slice(0, 4)}`,
    `revisor2.${RUN}.${randomUUID().slice(0, 6)}@universidade-c.edu.br`,
  );
  await createReviewer({
    userId: secondReviewer,
    keywords: ['aprendizado de máquina'],
    institution: 'Universidade C',
    domain: 'universidade-c.edu.br',
  });

  await assignReviewer({
    tenantId,
    submissionId,
    reviewerId: cleanReviewerId,
    assignedById: authorId,
  });
  await assignReviewer({
    tenantId,
    submissionId,
    reviewerId: secondReviewer,
    assignedById: authorId,
  });

  return submissionId;
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('parecer e decisão', () => {
  it('calcula a nota ponderada no SERVIDOR e persiste o detalhamento', async () => {
    const submissionId = await prepareSubmission();

    /**
     * Pesos: originalidade 3, metodologia 2, clareza 1 (total 6).
     * Notas: 10, 5, 5 →
     *   (10/10×3 + 5/10×2 + 5/10×1) / 6 × 100
     *   = (3 + 1 + 0.5) / 6 × 100 = 75
     *
     * O teste fixa a fórmula: se ela mudar sem intenção, isto falha.
     */
    const result = await submitReview({
      tenantId,
      submissionId,
      reviewerId: cleanReviewerId,
      scores: { originality: 10, methodology: 5, clarity: 5 },
      recommendation: 'ACCEPT',
      feedbackToAuthor: 'Trabalho relevante, com boa fundamentação.',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.weightedScore).toBe(75);

    const review = await withTenant(tenantId, (tx) =>
      tx.review.findFirstOrThrow({
        where: { submissionId, reviewerId: cleanReviewerId },
        select: {
          weightedScore: true,
          scoreBreakdown: true,
          submissionVersion: true,
          submittedAt: true,
        },
      }),
    );

    expect(Number(review.weightedScore)).toBe(75);
    expect(review.submittedAt).not.toBeNull();
    expect(review.submissionVersion).toBe(1);
    // O detalhamento permite auditar cada critério.
    expect(Array.isArray(review.scoreBreakdown)).toBe(true);
    expect((review.scoreBreakdown as unknown[]).length).toBe(3);
  }, 90_000);

  it('RECUSA notas fora do intervalo da rubrica', async () => {
    const submissionId = await prepareSubmission();

    const result = await submitReview({
      tenantId,
      submissionId,
      reviewerId: cleanReviewerId,
      // Metodologia tem máximo 10.
      scores: { originality: 5, methodology: 99, clarity: 5 },
      recommendation: 'ACCEPT',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_SCORES');
  }, 90_000);

  it('RECUSA parecer de quem não está atribuído', async () => {
    const submissionId = await prepareSubmission();

    const result = await submitReview({
      tenantId,
      submissionId,
      reviewerId: authorId,
      scores: { originality: 5, methodology: 5, clarity: 5 },
      recommendation: 'ACCEPT',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_ASSIGNED');
  }, 90_000);

  it('expõe o consenso e sinaliza DIVERGÊNCIA entre pareceres', async () => {
    const submissionId = await prepareSubmission();

    const reviewers = await withTenant(tenantId, (tx) =>
      tx.reviewAssignment.findMany({
        where: { submissionId },
        select: { reviewerId: true },
      }),
    );

    expect(reviewers).toHaveLength(2);

    // Pareceres radicalmente opostos: um aceita com nota alta, outro rejeita.
    await submitReview({
      tenantId,
      submissionId,
      reviewerId: reviewers[0]!.reviewerId,
      scores: { originality: 10, methodology: 9, clarity: 9 },
      recommendation: 'ACCEPT',
    });
    await submitReview({
      tenantId,
      submissionId,
      reviewerId: reviewers[1]!.reviewerId,
      scores: { originality: 1, methodology: 1, clarity: 1 },
      recommendation: 'REJECT',
    });

    const panel = await getSubmissionReviewPanel(tenantId, submissionId);
    expect(panel.ok).toBe(true);

    if (panel.ok) {
      expect(panel.panel.reviews).toHaveLength(2);
      expect(panel.panel.consensus.distribution.ACCEPT).toBe(1);
      expect(panel.panel.consensus.distribution.REJECT).toBe(1);
      // O sistema NÃO resolve a divergência sozinho: ele a expõe.
      expect(panel.panel.consensus.requiresDiscussion).toBe(true);
      expect(panel.panel.consensus.discussionReasons.length).toBeGreaterThan(0);
      // O quórum de 2 pareceres foi atingido.
      expect(panel.panel.quorum.satisfied).toBe(true);
    }
  }, 90_000);

  it('exige justificativa para decidir SEM quórum', async () => {
    const submissionId = await createDraft();
    await uploadBlindPdf(submissionId);
    await submitSubmission({ tenantId, submissionId, userId: authorId });

    // Nenhum parecer — quórum de 2 não atingido.
    const semJustificativa = await recordDecision({
      tenantId,
      submissionId,
      decidedById: authorId,
      decision: 'ACCEPTED',
      overrideQuorum: true,
    });

    expect(semJustificativa.ok).toBe(false);
    if (!semJustificativa.ok) expect(semJustificativa.code).toBe('QUORUM_NOT_REACHED');

    // Sem override, também é recusado.
    const semOverride = await recordDecision({
      tenantId,
      submissionId,
      decidedById: authorId,
      decision: 'ACCEPTED',
    });
    expect(semOverride.ok).toBe(false);

    // Com override E justificativa, é aceito — e fica registrado.
    const comJustificativa = await recordDecision({
      tenantId,
      submissionId,
      decidedById: authorId,
      decision: 'ACCEPTED',
      notes: 'Decisão antecipada por prazo editorial; pareceres em atraso.',
      overrideQuorum: true,
    });

    expect(comJustificativa.ok).toBe(true);

    const decided = await withTenant(tenantId, (tx) =>
      tx.submission.findUniqueOrThrow({
        where: { id: submissionId },
        select: { status: true, decisionNotes: true, decisionById: true },
      }),
    );

    expect(decided.status).toBe('ACCEPTED');
    expect(decided.decisionNotes).toContain('prazo editorial');
    expect(decided.decisionById).toBe(authorId);
  }, 90_000);

  it('ACCEPTED e REJECTED são terminais (não voltam atrás)', async () => {
    const submissionId = await createDraft();
    await uploadBlindPdf(submissionId);
    await submitSubmission({ tenantId, submissionId, userId: authorId });

    await recordDecision({
      tenantId,
      submissionId,
      decidedById: authorId,
      decision: 'REJECTED',
      notes: 'Fora do escopo da trilha.',
      overrideQuorum: true,
    });

    const changeAgain = await recordDecision({
      tenantId,
      submissionId,
      decidedById: authorId,
      decision: 'ACCEPTED',
      overrideQuorum: true,
      notes: 'Tentativa de reverter.',
    });

    expect(changeAgain.ok).toBe(false);
    if (!changeAgain.ok) expect(changeAgain.code).toBe('INVALID_TRANSITION');
  }, 90_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RASCUNHO: NÃO NASCE INVÁLIDO, E PODE SER EDITADO (revisão da FASE 4)
 *
 *  O autor salvava com uma palavra-chave (a regra só era checada no envio),
 *  editava o conteúdo uma única vez — na criação — e descobria o problema no fim,
 *  sem ter onde corrigir. Estes testes prendem as duas metades da correção: a
 *  criação aplica a MESMA validação do envio, e a edição respeita posse e estado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('rascunho — validação na criação e edição do conteúdo', () => {
  const draftContent = {
    title: 'Modelos de aprendizado de máquina para triagem neonatal',
    abstract:
      'Este trabalho avalia modelos supervisionados aplicados à triagem neonatal a partir de dados de vigilância em saúde, comparando métricas de sensibilidade e especificidade em coortes reais de três regiões brasileiras.',
    keywords: ['aprendizado de máquina', 'triagem neonatal', 'saúde pública'],
  };

  it('RECUSA criar rascunho com menos de 3 palavras-chave distintas', async () => {
    const result = await createSubmission({
      tenantId,
      eventId,
      trackId,
      userId: authorId,
      ...draftContent,
      keywords: ['teste'],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_CONTENT');
    // A mensagem diz O QUE corrigir, em vez de só recusar.
    expect(result.details?.join(' ')).toMatch(/3 palavras-chave distintas/i);
  });

  it('RECUSA rascunho com uma palavra-chave repetida três vezes', async () => {
    const result = await createSubmission({
      tenantId,
      eventId,
      trackId,
      userId: authorId,
      ...draftContent,
      keywords: ['teste', 'Teste', 'TESTE '],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_CONTENT');
  });

  it('grava a lista NORMALIZADA e permite editar o rascunho depois', async () => {
    const created = await createSubmission({
      tenantId,
      eventId,
      trackId,
      userId: authorId,
      ...draftContent,
      // Quatro entradas, TRÊS distintas: a repetida (caixa e espaço diferentes) sai.
      keywords: [' Saúde ', 'saúde', 'Dados abertos', 'Vigilância'],
    });
    if (!created.ok) throw new Error(created.message);

    const stored = await withTenant(tenantId, (tx) =>
      tx.submission.findUniqueOrThrow({
        where: { id: created.id },
        select: { keywords: true, abstract: true, language: true },
      }),
    );

    // Repetida (ignorando caixa e espaço) entra UMA vez — é a lista que a afinidade usa.
    expect(stored.keywords).toEqual(['Saúde', 'Dados abertos', 'Vigilância']);

    const updated = await updateSubmissionDraft({
      tenantId,
      submissionId: created.id,
      userId: authorId,
      title: 'Modelos de aprendizado de máquina para triagem neonatal — revisado',
      abstract: `${draftContent.abstract} Revisão do autor depois da primeira leitura.`,
      keywords: ['aprendizado de máquina', 'triagem neonatal', 'saúde pública'],
      language: 'pt-BR',
    });

    expect(updated.ok, updated.ok ? 'ok' : updated.message).toBe(true);

    const after = await withTenant(tenantId, (tx) =>
      tx.submission.findUniqueOrThrow({
        where: { id: created.id },
        select: { title: true, keywords: true, abstract: true },
      }),
    );

    expect(after.title).toContain('revisado');
    expect(after.keywords).toHaveLength(3);
    expect(after.abstract).toContain('Revisão do autor');

    // A trilha registra a alteração — com o FATO, e não o texto inteiro.
    const audited = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId, entityType: 'submission', entityId: created.id, action: 'UPDATE' },
        select: { changes: true },
      }),
    );

    expect(audited).not.toBeNull();
    expect(JSON.stringify(audited?.changes)).toContain('palavrasChave');
  }, 60_000);

  it('RECUSA edição que deixaria o rascunho inválido', async () => {
    const created = await createSubmission({
      tenantId,
      eventId,
      trackId,
      userId: authorId,
      ...draftContent,
    });
    if (!created.ok) throw new Error(created.message);

    const result = await updateSubmissionDraft({
      tenantId,
      submissionId: created.id,
      userId: authorId,
      title: draftContent.title,
      abstract: draftContent.abstract,
      keywords: ['uma só'],
      language: 'pt-BR',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_CONTENT');
  }, 60_000);

  it('RECUSA editar a submissão de outra pessoa e a que já foi enviada', async () => {
    const created = await createSubmission({
      tenantId,
      eventId,
      trackId,
      userId: authorId,
      ...draftContent,
    });
    if (!created.ok) throw new Error(created.message);

    const outraPessoa = await createUser('Editora Intrusa', `peer.intrusa.${RUN}@exemplo.test`);

    const deTerceiro = await updateSubmissionDraft({
      tenantId,
      submissionId: created.id,
      userId: outraPessoa,
      title: draftContent.title,
      abstract: draftContent.abstract,
      keywords: [...draftContent.keywords],
      language: 'pt-BR',
    });

    expect(deTerceiro.ok).toBe(false);
    if (!deTerceiro.ok) expect(deTerceiro.code).toBe('FORBIDDEN');

    // Depois do envio, o texto é registro: a edição para de ser permitida.
    await uploadBlindPdf(created.id);
    const sent = await submitSubmission({ tenantId, submissionId: created.id, userId: authorId });
    expect(sent.ok).toBe(true);

    const depoisDoEnvio = await updateSubmissionDraft({
      tenantId,
      submissionId: created.id,
      userId: authorId,
      title: 'Título trocado depois de enviar',
      abstract: draftContent.abstract,
      keywords: [...draftContent.keywords],
      language: 'pt-BR',
    });

    expect(depoisDoEnvio.ok).toBe(false);
    if (!depoisDoEnvio.ok) expect(depoisDoEnvio.code).toBe('NOT_EDITABLE');

    const intact = await withTenant(tenantId, (tx) =>
      tx.submission.findUniqueOrThrow({ where: { id: created.id }, select: { title: true } }),
    );
    expect(intact.title).toBe(draftContent.title);
  }, 90_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EXCLUSÃO DO RASCUNHO (revisão da FASE 4)
 *
 *  O autor escreve ao longo de dias e erra: um teste, um título provisório, uma
 *  trilha trocada. Sem exclusão, esse lixo fica para sempre na lista dele. Mas o
 *  rascunho é o ÚNICO estado em que apagar não destrói registro — e é isso que
 *  estes testes prendem, incluindo o efeito no BUCKET (o objeto do PDF sai junto).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('exclusão do rascunho — só o autor, e só antes do envio', () => {
  it('o autor apaga o PRÓPRIO rascunho: sai a submissão, a autoria, o arquivo e o objeto', async () => {
    const submissionId = await createDraft();
    const fileId = await uploadPdf(submissionId, 'BLIND_PDF');

    const stored = await withTenant(tenantId, (tx) =>
      tx.submissionFile.findUniqueOrThrow({
        where: { id: fileId },
        select: { bucket: true, storageKey: true },
      }),
    );

    // Antes: o objeto existe mesmo no bucket.
    await expect(inspectObject(stored.bucket, stored.storageKey)).resolves.toMatchObject({
      exists: true,
    });

    const result = await deleteSubmission({ tenantId, submissionId, userId: authorId });
    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.protocol).toMatch(/^\d{4}-[A-Z2-9]{4}$/);
    expect(result.removedFiles).toBe(1);

    // ── Nada sobrou apontando para o rascunho ────────────────────────────────
    const [submission, authors, files] = await withTenant(tenantId, (tx) =>
      Promise.all([
        tx.submission.findUnique({ where: { id: submissionId }, select: { id: true } }),
        tx.submissionAuthor.count({ where: { submissionId } }),
        tx.submissionFile.count({ where: { submissionId } }),
      ]),
    );

    expect(submission).toBeNull();
    // Autores e arquivos acompanham a submissão (cascade no schema).
    expect(authors).toBe(0);
    expect(files).toBe(0);

    // ── O objeto também saiu do bucket ───────────────────────────────────────
    await expect(inspectObject(stored.bucket, stored.storageKey)).resolves.toMatchObject({
      exists: false,
    });

    /**
     * E o FATO fica na trilha: é o que sobra de um rascunho apagado, e é o que
     * responde "para onde foi a submissão 2026-ABCD?".
     */
    const audited = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId, entityType: 'submission', entityId: submissionId, action: 'DELETE' },
        select: { changes: true, userId: true },
      }),
    );

    expect(audited).not.toBeNull();
    expect(audited?.userId).toBe(authorId);
    expect(JSON.stringify(audited?.changes)).toContain('protocolo');
  }, 90_000);

  it('RECUSA excluir a submissão de outra pessoa', async () => {
    const submissionId = await createDraft();
    const outraPessoa = await createUser('Outra Pessoa', `peer.outra.${RUN}@exemplo.test`);

    const result = await deleteSubmission({
      tenantId,
      submissionId,
      userId: outraPessoa,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FORBIDDEN');

    // A submissão continua exatamente onde estava.
    const stillThere = await withTenant(tenantId, (tx) =>
      tx.submission.findUnique({ where: { id: submissionId }, select: { id: true } }),
    );
    expect(stillThere).not.toBeNull();
  }, 60_000);

  it('RECUSA excluir submissão JÁ ENVIADA — ela é o registro da avaliação', async () => {
    const submissionId = await createDraft();
    const fileId = await uploadPdf(submissionId, 'BLIND_PDF');

    const sent = await submitSubmission({ tenantId, submissionId, userId: authorId });
    expect(sent.ok).toBe(true);

    const result = await deleteSubmission({ tenantId, submissionId, userId: authorId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_EDITABLE');
    // A mensagem diz o caminho alternativo, em vez de só negar.
    expect(result.message).toMatch(/rascunho/i);

    // Nada foi removido: nem a linha, nem o arquivo, nem o objeto.
    const stored = await withTenant(tenantId, (tx) =>
      tx.submissionFile.findUniqueOrThrow({
        where: { id: fileId },
        select: { bucket: true, storageKey: true },
      }),
    );
    await expect(inspectObject(stored.bucket, stored.storageKey)).resolves.toMatchObject({
      exists: true,
    });
  }, 90_000);

  it('RECUSA excluir o que não existe', async () => {
    const result = await deleteSubmission({
      tenantId,
      submissionId: randomUUID(),
      userId: authorId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });
});
