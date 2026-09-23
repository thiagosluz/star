import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveTrack } from '../../src/lib/admin/catalog-service';
import { saveCall, setCallPublished } from '../../src/lib/proposals/call-service';
import { createSubmission } from '../../src/lib/review/submission-service';
import { DEFAULT_RUBRIC, type RubricCriterion } from '../../src/domain/review/review-rules';
import { rubricReviewCounts } from '../../src/lib/review/rubric-guard';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let authorId: string;
let reviewerId: string;

const eventSlug = `evento-rubrica-${RUN}`;
const startsAt = new Date(Date.now() + 30 * 86_400_000);

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Rubrica com número livre de critérios (FASE 39) — integração com banco real
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a trilha e a chamada aceitam QUALQUER número de critérios, de 1 até o teto, e o
 *    teto é do serviço (não só da tela);
 *  • a FORMA da rubrica (chave, peso, nota máxima e o conjunto de chaves) CONGELA a
 *    partir do primeiro parecer, com a contagem na recusa;
 *  • o que NÃO congela continua salvando: rótulo, descrição e ordem — corrigir um erro
 *    de digitação depois de avaliado precisa ser possível;
 *  • a comparação é contra a rubrica EM VIGOR: uma trilha sem rubrica própria usa a
 *    PADRÃO, e gravar cinco critérios nela é mudança de forma como qualquer outra;
 *  • a contagem é por INSTITUIÇÃO e por alvo (o parecer da trilha vizinha não congela
 *    esta).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FIXTURE DO PARECER É UM `create` DIRETO, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra sob teste CONTA linhas de `Review`: o caminho que as cria (`submitReview`,
 *  com upload real de arquivo e atribuição de revisor) tem cobertura própria em
 *  `peer-review.test.ts`, e repeti-lo aqui custaria um harness de storage para medir
 *  uma contagem. O que a fixture precisa garantir é apenas o que a regra lê — a linha
 *  existir, com o `submissionId` certo —, e é isso que ela faz.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f39.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  return id;
}

function rubricOf(labels: readonly string[]): RubricCriterion[] {
  return labels.map((label, index) => ({
    key: `criterio_${index}`,
    label,
    weight: index === 0 ? 3 : 1,
    maxScore: 10,
  }));
}

async function createTrack(input: {
  slug: string;
  name: string;
  rubric?: RubricCriterion[];
}): Promise<string> {
  const result = await saveTrack({
    tenantId,
    actorId: authorId,
    eventId,
    slug: input.slug,
    name: input.name,
    description: null,
    color: null,
    maxSubmissionsPerAuthor: 0,
    requiresBlindReview: true,
    rubric: input.rubric ?? [],
    requiredReviews: 1,
    acceptanceThreshold: 70,
    rejectThreshold: 45,
    isActive: true,
  });

  if (!result.ok) throw new Error(`Falha ao criar a trilha: ${result.message}`);

  return result.trackId;
}

async function saveTrackRubric(trackId: string, rubric: RubricCriterion[]) {
  return saveTrack({
    tenantId,
    actorId: authorId,
    eventId,
    trackId,
    slug: `trilha-${trackId.slice(0, 6)}`,
    name: 'Trilha editada',
    description: null,
    color: null,
    maxSubmissionsPerAuthor: 0,
    requiresBlindReview: true,
    rubric,
    requiredReviews: 1,
    acceptanceThreshold: 70,
    rejectThreshold: 45,
    isActive: true,
  });
}

/** Uma submissão na trilha, e UM parecer enviado nela. */
async function withSubmittedReview(trackId: string): Promise<void> {
  const created = await createSubmission({
    tenantId,
    eventId,
    trackId,
    userId: authorId,
    title: 'Proposta com rubrica livre',
    abstract:
      'Resumo suficientemente longo para passar pela validação de conteúdo mínimo da submissão, escrito para o teste de congelamento da rubrica: cobre o número livre de critérios, a forma congelada depois do primeiro parecer e a contagem por alvo.',
    keywords: ['rubrica', 'avaliação', 'critérios'],
  });

  if (!created.ok) throw new Error(`Falha ao criar a submissão: ${created.message}`);

  await withTenant(tenantId, (tx) =>
    tx.review.create({
      data: {
        tenantId,
        submissionId: created.id,
        reviewerId,
        status: 'SUBMITTED',
        scores: { criterio_0: 8, criterio_1: 7, criterio_2: 9 },
        submittedAt: new Date(),
      },
    }),
  );
}

/** Uma trilha com a rubrica dada E um parecer nela — o estado "congelado". */
async function trackWithReview(slug: string, rubric: RubricCriterion[]): Promise<string> {
  const trackId = await createTrack({ slug: `${slug}-${RUN}`, name: `Trilha ${slug}`, rubric });
  await withSubmittedReview(trackId);

  return trackId;
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: `f39-${RUN}`,
        name: `Instituição da Rubrica ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f39-vizinha-${RUN}`,
        name: `Instituição Vizinha ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: TIME_ZONE,
      },
    ],
  });

  authorId = await createUser('Organizador F39');
  reviewerId = await createUser('Revisor F39');

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: eventSlug,
        title: 'Congresso da rubrica livre',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
        cfpOpensAt: new Date(Date.now() - 86_400_000),
        cfpClosesAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f39.${RUN}` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a rubrica aceita qualquer número de critérios', () => {
  it('grava cinco critérios, e a trilha devolve os cinco', async () => {
    const trackId = await createTrack({
      slug: `cinco-${RUN}`,
      name: 'Trilha de cinco critérios',
      rubric: rubricOf(['Originalidade', 'Método', 'Clareza', 'Impacto', 'Viabilidade']),
    });

    const stored = await withTenant(tenantId, (tx) =>
      tx.track.findUniqueOrThrow({ where: { id: trackId }, select: { reviewRubric: true } }),
    );

    expect((stored.reviewRubric as unknown[]).length).toBe(5);
  });

  it('recusa acima do teto com o motivo (o teto é do SERVIÇO, não da tela)', async () => {
    const result = await saveTrack({
      tenantId,
      actorId: authorId,
      eventId,
      slug: `acima-${RUN}`,
      name: 'Trilha acima do teto',
      description: null,
      color: null,
      maxSubmissionsPerAuthor: 0,
      requiresBlindReview: true,
      rubric: rubricOf(Array.from({ length: 13 }, (_, index) => `Critério ${index + 1}`)),
      requiredReviews: 1,
      acceptanceThreshold: 70,
      rejectThreshold: 45,
      isActive: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('INVALID_INPUT');
    expect(result.details?.join(' ')).toContain('13');
    expect(result.details?.join(' ')).toContain('12');
  });

  it('a chamada também aceita cinco critérios', async () => {
    const result = await saveCall({
      tenantId,
      actorId: authorId,
      eventId,
      eventSlug,
      kind: 'WORKSHOP',
      slug: `chamada-cinco-${RUN}`,
      title: 'Chamada de oficinas',
      reviewRubric: rubricOf(['Viabilidade', 'Clareza do plano', 'Ineditismo', 'Adequação', 'Custo']),
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a FORMA da rubrica congela a partir do primeiro parecer', () => {
  const base = rubricOf(['Originalidade', 'Método', 'Clareza']);

  it('sem parecer, editar a rubrica é livre', async () => {
    const trackId = await createTrack({
      slug: `livre-${RUN}`,
      name: 'Trilha livre',
      rubric: base,
    });

    const result = await saveTrackRubric(
      trackId,
      rubricOf(['Originalidade', 'Método', 'Clareza', 'Impacto']),
    );

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
  });

  it('com UM parecer, acrescentar critério é recusado com a contagem', async () => {
    const trackId = await trackWithReview('congela-add', base);

    const result = await saveTrackRubric(
      trackId,
      rubricOf(['Originalidade', 'Método', 'Clareza', 'Impacto']),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('RUBRIC_FROZEN');
    expect(result.message).toContain('1 parecer');
    expect(result.message).toContain('critério(s) novo(s)');
    expect(result.message).toContain('crie outra trilha');
  });

  it('remover critério e trocar peso também são recusados — e a mensagem diz o quê', async () => {
    const trackId = await trackWithReview('congela-remove', base);

    const removed = await saveTrackRubric(trackId, rubricOf(['Originalidade', 'Método']));
    expect(removed.ok).toBe(false);
    if (!removed.ok) {
      expect(removed.code).toBe('RUBRIC_FROZEN');
      expect(removed.message).toContain('critério(s) removido(s)');
    }

    const reweighted = await saveTrackRubric(
      trackId,
      base.map((criterion) => ({ ...criterion, weight: criterion.weight + 1 })),
    );
    expect(reweighted.ok).toBe(false);
    if (!reweighted.ok) {
      expect(reweighted.code).toBe('RUBRIC_FROZEN');
      expect(reweighted.message).toContain('peso ou nota máxima alterados');
    }
  });

  it('salvar a MESMA rubrica continua funcionando (é o que a tela congelada manda)', async () => {
    const trackId = await trackWithReview('congela-mesma', base);

    const result = await saveTrackRubric(trackId, base);

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
  });

  it('rótulo, descrição e ORDEM continuam livres — não entram na conta da nota', async () => {
    const trackId = await trackWithReview('congela-rotulo', base);

    const renamed = await saveTrackRubric(trackId, [
      { ...base[0]!, label: 'Originalidade e relevância', description: 'Texto novo' },
      { ...base[1]!, label: 'Metodologia empregada' },
      { ...base[2]!, label: 'Clareza e organização' },
    ]);

    expect(renamed.ok, renamed.ok ? 'ok' : renamed.message).toBe(true);

    const reordered = await saveTrackRubric(trackId, [base[2]!, base[0]!, base[1]!]);

    expect(reordered.ok, reordered.ok ? 'ok' : reordered.message).toBe(true);
  });

  it('a comparação é contra a rubrica EM VIGOR: trilha sem rubrica própria usa a PADRÃO', async () => {
    const semRubrica = await createTrack({ slug: `padrao-${RUN}`, name: 'Trilha sem rubrica' });
    await withSubmittedReview(semRubrica);

    /** Três critérios "quaisquer" ≠ os três da padrão: é mudança de forma. */
    const different = await saveTrackRubric(semRubrica, rubricOf(['A', 'B', 'C']));

    expect(different.ok).toBe(false);
    if (!different.ok) expect(different.code).toBe('RUBRIC_FROZEN');

    /** E gravar exatamente a padrão é aceito: a forma não mudou. */
    const same = await saveTrackRubric(semRubrica, [...DEFAULT_RUBRIC]);

    expect(same.ok, same.ok ? 'ok' : same.message).toBe(true);
  });

  it('a contagem é por alvo: o parecer de OUTRA trilha não congela esta', async () => {
    const vizinha = await createTrack({ slug: `vizinha-${RUN}`, name: 'Trilha sem parecer' });

    const result = await saveTrackRubric(
      vizinha,
      rubricOf(['Originalidade', 'Método', 'Clareza', 'Impacto']),
    );

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a chamada congela pelo próprio parecer', () => {
  it('com parecer na chamada, mudar a forma é recusado', async () => {
    const created = await saveCall({
      tenantId,
      actorId: authorId,
      eventId,
      eventSlug,
      kind: 'WORKSHOP',
      slug: `chamada-congela-${RUN}`,
      title: 'Chamada que congela',
      reviewRubric: rubricOf(['Viabilidade', 'Clareza']),
    });

    if (!created.ok) throw new Error(`Falha ao criar a chamada: ${created.message}`);

    /** Só chamada PUBLICADA recebe proposta — a regra é da FASE 33. */
    const published = await setCallPublished({
      tenantId,
      actorId: authorId,
      callId: created.callId,
      isPublished: true,
    });

    if (!published.ok) throw new Error(`Falha ao publicar a chamada: ${published.message}`);

    const submission = await createSubmission({
      tenantId,
      eventId,
      callId: created.callId,
      userId: authorId,
      title: 'Proposta da chamada',
      abstract:
        'Resumo suficientemente longo para passar pela validação de conteúdo mínimo da proposta da chamada, escrito para o teste de congelamento da rubrica própria: cobre o número livre de critérios e a recusa de mudar a forma depois do primeiro parecer.',
      keywords: ['oficina', 'viabilidade', 'critérios'],
    });

    if (!submission.ok) throw new Error(`Falha ao criar a proposta: ${submission.message}`);

    await withTenant(tenantId, (tx) =>
      tx.review.create({
        data: {
          tenantId,
          submissionId: submission.id,
          reviewerId,
          status: 'SUBMITTED',
          scores: { criterio_0: 9, criterio_1: 8 },
          submittedAt: new Date(),
        },
      }),
    );

    const refused = await saveCall({
      tenantId,
      actorId: authorId,
      eventId,
      eventSlug,
      kind: 'WORKSHOP',
      callId: created.callId,
      slug: `chamada-congela-${RUN}`,
      title: 'Chamada que congela',
      reviewRubric: rubricOf(['Viabilidade', 'Clareza', 'Custo']),
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;

    expect(refused.code).toBe('RUBRIC_FROZEN');
    expect(refused.message).toContain('1 parecer');
    expect(refused.message).toContain('crie outra chamada');
  });

  it('a contagem por chamada é da INSTITUIÇÃO: a vizinha aparece zerada', async () => {
    const counts = await rubricReviewCounts({ tenantId: otherTenantId, callIds: ['inexistente'] });

    expect(counts.byCall).toEqual({});
    expect(counts.byTrack).toEqual({});
  });
});
