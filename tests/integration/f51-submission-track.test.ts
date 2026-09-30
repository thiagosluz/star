/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 51 · dívida E32 — trocar a TRILHA do rascunho
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A trilha ficou de fora da edição de conteúdo desde a revisão da FASE 4, e quem
 *  errasse o seletor tinha de excluir o rascunho e recomeçar. Agora ela é editável
 *  ENQUANTO NADA DEPENDE da classificação — e é recusada, com o motivo e o caminho,
 *  quando já existe parecer, atribuição ou envio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  createSubmission,
  updateSubmissionDraft,
} from '../../src/lib/review/submission-service';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let eventId: string;
let authorId: string;
let trackA: string;
let trackB: string;
let outroEventoTrackId: string;

const CONTEUDO = {
  title: 'Reclassificação de rascunho em trilha diferente',
  abstract:
    'Este texto descreve um estudo de caso sobre classificação temática de trabalhos submetidos a eventos científicos, com critérios explícitos e verificáveis de enquadramento por eixo temático.',
  keywords: ['classificação temática', 'eventos científicos', 'avaliação por pares'],
};

async function novoRascunho(trackId: string | null): Promise<string> {
  const created = await createSubmission({
    tenantId,
    eventId,
    trackId,
    userId: authorId,
    ...CONTEUDO,
    title: `${CONTEUDO.title} ${randomUUID().slice(0, 6)}`,
  });

  if (!created.ok) throw new Error(created.message);

  return created.id;
}

function trackIdOf(submissionId: string): Promise<string | null> {
  return withTenant(tenantId, (tx) =>
    tx.submission
      .findUniqueOrThrow({ where: { id: submissionId }, select: { trackId: true } })
      .then((row) => row.trackId),
  );
}

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f51-trilha-${RUN}`,
      name: `Instituição da Trilha ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  tenantId = tenant.id;
  eventId = randomUUID();

  const autor = await adminPrisma.user.create({
    data: {
      id: randomUUID(),
      name: `Autora da reclassificação ${RUN}`,
      email: `f51.trilha.${RUN}@exemplo.test`,
      emailVerified: true,
    },
  });

  authorId = autor.id;

  await adminPrisma.userTenantProfile.create({
    data: { id: randomUUID(), tenantId, userId: authorId, status: 'ACTIVE', kind: 'PARTICIPANT' },
  });

  trackA = randomUUID();
  trackB = randomUUID();
  outroEventoTrackId = randomUUID();
  const outroEvento = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `f51-evento-${RUN}`,
        title: 'Congresso da reclassificação',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt: new Date(Date.now() + 30 * 86_400_000),
        endsAt: new Date(Date.now() + 32 * 86_400_000),
      },
    });

    await tx.event.create({
      data: {
        id: outroEvento,
        tenantId,
        slug: `f51-evento-vizinho-${RUN}`,
        title: 'Outro congresso',
        status: 'REGISTRATION_OPEN',
        modality: 'ONLINE',
        timezone: TIME_ZONE,
        startsAt: new Date(Date.now() + 30 * 86_400_000),
        endsAt: new Date(Date.now() + 32 * 86_400_000),
      },
    });

    await tx.track.createMany({
      data: [
        { id: trackA, tenantId, eventId, name: 'Trilha A', slug: `trilha-a-${RUN}` },
        { id: trackB, tenantId, eventId, name: 'Trilha B', slug: `trilha-b-${RUN}` },
        { id: outroEventoTrackId, tenantId, eventId: outroEvento, name: 'Trilha de outro evento', slug: `trilha-x-${RUN}` },
      ],
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f51.trilha.${RUN}` } } });
});

describe('trocar a trilha do rascunho (FASE 51 · dívida E32)', () => {
  it('troca a trilha do rascunho e o conteúdo continua editável junto', async () => {
    const submissionId = await novoRascunho(trackA);

    const trocado = await updateSubmissionDraft({
      tenantId,
      submissionId,
      userId: authorId,
      title: `${CONTEUDO.title} — corrigido`,
      abstract: `${CONTEUDO.abstract} Ajuste do autor.`,
      keywords: [...CONTEUDO.keywords],
      language: 'pt-BR',
      trackId: trackB,
    });

    expect(trocado.ok, trocado.ok ? 'ok' : trocado.message).toBe(true);
    expect(await trackIdOf(submissionId)).toBe(trackB);
  });

  it('NÃO mexe na trilha quando o campo não é enviado (tela antiga)', async () => {
    const submissionId = await novoRascunho(trackB);

    const semTrilha = await updateSubmissionDraft({
      tenantId,
      submissionId,
      userId: authorId,
      title: `${CONTEUDO.title} — só o texto`,
      abstract: CONTEUDO.abstract,
      keywords: [...CONTEUDO.keywords],
      language: 'pt-BR',
    });

    expect(semTrilha.ok, semTrilha.ok ? 'ok' : semTrilha.message).toBe(true);
    /** `undefined` é "não mexe" — não pode APAGAR a classificação em silêncio. */
    expect(await trackIdOf(submissionId)).toBe(trackB);
  });

  it('aceita ficar SEM trilha onde a chamada não exige', async () => {
    const submissionId = await novoRascunho(trackA);

    const semTrilha = await updateSubmissionDraft({
      tenantId,
      submissionId,
      userId: authorId,
      title: CONTEUDO.title,
      abstract: CONTEUDO.abstract,
      keywords: [...CONTEUDO.keywords],
      language: 'pt-BR',
      trackId: null,
    });

    expect(semTrilha.ok, semTrilha.ok ? 'ok' : semTrilha.message).toBe(true);
    expect(await trackIdOf(submissionId)).toBeNull();
  });

  it('RECUSA trilha de OUTRO evento', async () => {
    const submissionId = await novoRascunho(trackA);

    const result = await updateSubmissionDraft({
      tenantId,
      submissionId,
      userId: authorId,
      title: CONTEUDO.title,
      abstract: CONTEUDO.abstract,
      keywords: [...CONTEUDO.keywords],
      language: 'pt-BR',
      trackId: outroEventoTrackId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRACK');
    expect(await trackIdOf(submissionId)).toBe(trackA);
  });

  it('RECUSA depois do ENVIO, dizendo que reclassificar é do comitê', async () => {
    const submissionId = await novoRascunho(trackA);

    /** O envio é o que tira a submissão do rascunho — a mesma transição do fluxo. */
    await withTenant(tenantId, (tx) =>
      tx.submission.update({
        where: { id: submissionId },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      }),
    );

    const result = await updateSubmissionDraft({
      tenantId,
      submissionId,
      userId: authorId,
      title: CONTEUDO.title,
      abstract: CONTEUDO.abstract,
      keywords: [...CONTEUDO.keywords],
      language: 'pt-BR',
      trackId: trackB,
    });

    /**
     * Depois do envio, o portão que recusa primeiro é o de EDIÇÃO: o formulário inteiro
     * fecha, não só o seletor de trilha. O código `NOT_EDITABLE` é a resposta certa
     * aqui — `NOT_DRAFT` seria a resposta do domínio se a submissão ainda fosse
     * editável (é o caso do teste seguinte, com a revisão solicitada).
     */
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_EDITABLE');
    expect(await trackIdOf(submissionId)).toBe(trackA);
  });

  it('RECUSA quando está EDITÁVEL mas já tem parecer — e diz que é do comitê', async () => {
    const submissionId = await novoRascunho(trackB);
    const reviewerId = randomUUID();

    await adminPrisma.user.create({
      data: {
        id: reviewerId,
        name: `Parecerista da revisão ${RUN}`,
        email: `f51.revisao.${RUN}.${reviewerId.slice(0, 6)}@exemplo.test`,
        emailVerified: true,
      },
    });

    await withTenant(tenantId, async (tx) => {
      /**
       * `REVISION_REQUESTED` é EDITÁVEL (`isEditableByAuthor`) — é justamente o caso
       * que dá sentido à regra da trilha: a pessoa pode corrigir o TEXTO e não pode
       * reclassificar, porque o parecer responde à rubrica da trilha atual.
       */
      await tx.submission.update({
        where: { id: submissionId },
        data: { status: 'REVISION_REQUESTED' },
      });

      await tx.review.create({
        data: {
          id: randomUUID(),
          tenantId,
          submissionId,
          reviewerId,
          status: 'SUBMITTED',
          recommendation: 'MAJOR_REVISION',
          submittedAt: new Date(),
        },
      });
    });

    const result = await updateSubmissionDraft({
      tenantId,
      submissionId,
      userId: authorId,
      title: CONTEUDO.title,
      abstract: CONTEUDO.abstract,
      keywords: [...CONTEUDO.keywords],
      language: 'pt-BR',
      trackId: trackA,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('HAS_REVIEWS');
    expect(result.message).toMatch(/comitê/i);
    expect(await trackIdOf(submissionId)).toBe(trackB);

    /** E o TEXTO continua editável no mesmo estado — editar e reclassificar diferem. */
    const soTexto = await updateSubmissionDraft({
      tenantId,
      submissionId,
      userId: authorId,
      title: `${CONTEUDO.title} — ajuste pedido pelo comitê`,
      abstract: CONTEUDO.abstract,
      keywords: [...CONTEUDO.keywords],
      language: 'pt-BR',
      trackId: trackB,
    });

    expect(soTexto.ok, soTexto.ok ? 'ok' : soTexto.message).toBe(true);
  });

  it('RECUSA quando já existe ATRIBUIÇÃO a revisor (a fila foi montada por trilha)', async () => {
    const submissionId = await novoRascunho(trackA);
    const reviewerId = randomUUID();

    await adminPrisma.user.create({
      data: {
        id: reviewerId,
        name: `Revisor da trilha ${RUN}`,
        email: `f51.revisor.${RUN}.${reviewerId.slice(0, 6)}@exemplo.test`,
        emailVerified: true,
      },
    });

    await withTenant(tenantId, (tx) =>
      tx.reviewAssignment.create({
        data: {
          id: randomUUID(),
          tenantId,
          submissionId,
          reviewerId,
          status: 'INVITED',
          dueAt: new Date(Date.now() + 15 * 86_400_000),
        },
      }),
    );

    const result = await updateSubmissionDraft({
      tenantId,
      submissionId,
      userId: authorId,
      title: CONTEUDO.title,
      abstract: CONTEUDO.abstract,
      keywords: [...CONTEUDO.keywords],
      language: 'pt-BR',
      trackId: trackB,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('HAS_ASSIGNMENTS');
    expect(await trackIdOf(submissionId)).toBe(trackA);

    /**
     * E o IMPORTANTE: a recusa vale para TROCAR, não para corrigir o texto. Sem isto,
     * quem tem atribuição não conseguiria nem ajustar o resumo.
     */
    const semTroca = await updateSubmissionDraft({
      tenantId,
      submissionId,
      userId: authorId,
      title: `${CONTEUDO.title} — ajuste com atribuição viva`,
      abstract: CONTEUDO.abstract,
      keywords: [...CONTEUDO.keywords],
      language: 'pt-BR',
      trackId: trackA,
    });

    expect(semTroca.ok, semTroca.ok ? 'ok' : semTroca.message).toBe(true);
  });

  it('RECUSA quando já existe PARECER — a nota responde à rubrica da trilha', async () => {
    const submissionId = await novoRascunho(trackA);
    const reviewerId = randomUUID();

    await adminPrisma.user.create({
      data: {
        id: reviewerId,
        name: `Parecerista da trilha ${RUN}`,
        email: `f51.parecer.${RUN}.${reviewerId.slice(0, 6)}@exemplo.test`,
        emailVerified: true,
      },
    });

    await withTenant(tenantId, (tx) =>
      tx.review.create({
        data: {
          id: randomUUID(),
          tenantId,
          submissionId,
          reviewerId,
          status: 'SUBMITTED',
          recommendation: 'ACCEPT',
          submittedAt: new Date(),
        },
      }),
    );

    const result = await updateSubmissionDraft({
      tenantId,
      submissionId,
      userId: authorId,
      title: CONTEUDO.title,
      abstract: CONTEUDO.abstract,
      keywords: [...CONTEUDO.keywords],
      language: 'pt-BR',
      trackId: trackB,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('HAS_REVIEWS');
    expect(result.message).toMatch(/rubrica/i);
  });
});
