/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — O RANKING DE REVISORES NÃO CITA QUEM A MODERAÇÃO OCULTOU
 *  (FASE 69 · dívida E82)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a decisão da moderação (`decideReport`, o serviço REAL da plataforma) grava
 *      `User.publicProfileHiddenAt`, e o efeito atravessa `getReviewerRanking` — o
 *      serviço que alimenta `/administracao/eventos/<id>/reconhecimento`;
 *    • a linha de quem foi ocultado CONTINUA no ranking, na MESMA posição e com a
 *      MESMA contagem de pareceres, e continua ELEGÍVEL à premiação: a carta é
 *      concedida pelo `id`, e esconder o nome não é apagar o fato (a decisão está
 *      documentada em `src/domain/gamification/leaderboard-rules.ts`);
 *    • quem NÃO foi ocultado continua com o nome inteiro: a régua é da PESSOA, e não
 *      um blecaute da lista;
 *    • a lista de PREMIAÇÃO (o outro lugar em que este painel nomeia a pessoa) sai
 *      pela mesma régua do ranking — as duas leem a mesma decisão.
 *
 *  A ordem dos cenários É o teste: mostrar (antes) → decidir → mascarar (depois).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  awardTopReviewers,
  getReviewerRanking,
} from '../../src/lib/gamification/achievement-service';
import { decideReport } from '../../src/lib/platform/profile-moderation';
import { reportPublicProfile } from '../../src/lib/profile/profile-report-service';

const RUN = randomUUID().slice(0, 8);

const TENANT_SLUG = `f69-e82-${RUN}`;
const HANDLE_ANA = `ana-f69-${RUN}`;
const TIME_ZONE = 'America/Bahia';
const NOTA = 'O perfil publica dado de terceiro sem autorizacao; medida confirmada na analise.';

/** Ana cumpre o piso do reconhecimento; Bruno tem UM parecer e fica abaixo dele. */
const PARECERES_ANA = 3;
const PARECERES_BRUNO = 1;

let tenantId: string;
let eventId: string;

let ana: string;
let bruno: string;
let autor: string;
let denunciante: string;
let moderador: string;

const startsAt = new Date(Date.now() + 30 * 86_400_000);

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
async function createUser(input: { name: string; platformRole?: boolean }): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: input.name,
      email: `f69.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
    },
  });

  if (input.platformRole) {
    await adminPrisma.roleAssignment.create({
      data: {
        id: randomUUID(),
        tenantId: null,
        userId: id,
        role: 'SUPERADMIN',
        scope: 'PLATFORM',
        reason: 'Moderador do teste de integração da FASE 69',
      },
    });
  }

  return id;
}

async function addMember(userId: string): Promise<void> {
  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição do Reconhecimento ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  ana = await createUser({ name: 'Ana Souza' });
  bruno = await createUser({ name: 'Bruno Visivel' });
  autor = await createUser({ name: 'Autor dos Trabalhos' });
  denunciante = await createUser({ name: 'Quem Denuncia' });
  moderador = await createUser({ name: 'Moderador da Plataforma', platformRole: true });

  await addMember(ana);
  await addMember(bruno);

  /** O `@handle` é o endereço público: é o que a denúncia procura e o que a medida tira do ar. */
  await adminPrisma.user.update({ where: { id: ana }, data: { publicHandle: HANDLE_ANA } });

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `congresso-do-reconhecimento-${RUN}`,
        title: 'Congresso do reconhecimento',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 86_400_000),
      },
    });

    /**
     * UM parecer por (submissão, revisor) é o índice único do modelo: para dar três
     * pareceres à Ana são necessárias três submissões, e é assim que o cenário
     * reflete a realidade (um revisor avalia vários trabalhos, não o mesmo três vezes).
     */
    const submissions = [randomUUID(), randomUUID(), randomUUID()];

    for (const [index, submissionId] of submissions.entries()) {
      await tx.submission.create({
        data: {
          id: submissionId,
          tenantId,
          eventId,
          protocol: `F69-${RUN}-${index}`,
          title: `Trabalho avaliado ${index + 1}`,
          abstract: 'Resumo',
          status: 'UNDER_REVIEW',
          submittedById: autor,
        },
      });
    }

    for (const submissionId of submissions) {
      await tx.review.create({
        data: {
          id: randomUUID(),
          tenantId,
          submissionId,
          reviewerId: ana,
          status: 'SUBMITTED',
          recommendation: 'ACCEPT',
          submittedAt: new Date(),
        },
      });
    }

    await tx.review.create({
      data: {
        id: randomUUID(),
        tenantId,
        submissionId: submissions[0]!,
        reviewerId: bruno,
        status: 'SUBMITTED',
        recommendation: 'ACCEPT',
        submittedAt: new Date(),
      },
    });

    /** A carta do gatilho: exige 2 pareceres e o piso do produto (3) é o que vale. */
    await tx.cardTemplate.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        slug: `revisor-destaque-${RUN}`,
        name: 'Revisor Destaque',
        rarity: 'LEGENDARY',
        trigger: 'REVIEWER_TOP',
        triggerCondition: { threshold: 2 } as unknown as object,
        isActive: true,
      },
    });
  });
});

afterAll(async () => {
  const reports = await adminPrisma.profileReport.findMany({
    where: { tenantId },
    select: { id: true },
  });

  /** A trilha da decisão é de PLATAFORMA (sem tenant) e não cai com a exclusão. */
  await adminPrisma.auditLog.deleteMany({
    where: { entityType: 'profile_report', entityId: { in: reports.map((row) => row.id) } },
  });

  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f69.${RUN}` } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('antes da decisão, o ranking cita as duas pessoas por inteiro', () => {
  it('Ana aparece em 1º com o nome inteiro; Bruno em 2º', async () => {
    const ranking = await getReviewerRanking({ tenantId, eventId });

    expect(ranking.ok, ranking.ok ? 'ok' : ranking.message).toBe(true);
    if (!ranking.ok) return;

    expect(ranking.ranked).toEqual([
      { reviewerId: ana, reviewerName: 'Ana Souza', completedReviews: PARECERES_ANA },
      { reviewerId: bruno, reviewerName: 'Bruno Visivel', completedReviews: PARECERES_BRUNO },
    ]);
    /**
     * A carta declara o piso DESTE evento (o comportamento do gatilho é o da F16, com
     * teste próprio pinando o número). O Bruno tem UM parecer e fica fora da premiação.
     */
    expect(ranking.minReviews).toBe(2);
    expect(ranking.awarded.map((row) => row.reviewerId)).toEqual([ana]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a decisão da moderação (serviço real da plataforma)', () => {
  it('a denúncia entra na fila e o OCULTAR grava o efeito no perfil', async () => {
    const reported = await reportPublicProfile({
      tenantId,
      reporterUserId: denunciante,
      username: HANDLE_ANA,
      category: 'PRIVACY',
      details: 'O perfil publica o telefone de uma terceira pessoa, sem autorização dela.',
    });

    expect(reported.ok, reported.ok ? 'ok' : reported.message).toBe(true);
    if (!reported.ok) return;

    const decidida = await decideReport({
      reportId: reported.reportId,
      action: 'HIDE',
      note: NOTA,
      actorId: moderador,
    });

    expect(decidida.ok, decidida.ok ? 'ok' : decidida.message).toBe(true);
    if (!decidida.ok) return;

    expect(decidida.hiddenProfile).toBe(true);

    /** O efeito é lido do BANCO: ocultar NÃO apaga — nem o perfil, nem os pareceres. */
    const pessoa = await adminPrisma.user.findUniqueOrThrow({
      where: { id: ana },
      select: { publicProfileHiddenAt: true, publicHandle: true },
    });

    expect(pessoa.publicProfileHiddenAt).not.toBeNull();
    expect(pessoa.publicHandle).toBe(HANDLE_ANA);

    const pareceres = await withTenant(tenantId, (tx) =>
      tx.review.count({ where: { tenantId, reviewerId: ana, status: 'SUBMITTED' } }),
    );

    expect(pareceres).toBe(PARECERES_ANA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o ranking depois da decisão', () => {
  it('a pessoa continua na lista, na MESMA posição, com a MESMA contagem — e sem o nome', async () => {
    const ranking = await getReviewerRanking({ tenantId, eventId });

    expect(ranking.ok).toBe(true);
    if (!ranking.ok) return;

    /** A lista NÃO encolhe: é o que a decisão de mascarar (e não remover) preserva. */
    expect(ranking.ranked).toHaveLength(2);
    expect(ranking.ranked[0]).toEqual({
      reviewerId: ana,
      reviewerName: 'Ana S.',
      completedReviews: PARECERES_ANA,
    });
    expect(ranking.topCount).toBe(PARECERES_ANA);

    /**
     * A checagem é sobre o JSON inteiro: o nome do cadastro não pode sobreviver em
     * nenhum campo da saída — nem por um detalhe que a tela não desenha.
     */
    const serialized = JSON.stringify(ranking);

    expect(serialized).not.toContain('Ana Souza');
    expect(serialized).toContain('Ana S.');
  });

  it('quem NÃO foi ocultado continua citado por inteiro (a régua é da pessoa)', async () => {
    const ranking = await getReviewerRanking({ tenantId, eventId });

    expect(ranking.ok).toBe(true);
    if (!ranking.ok) return;

    expect(ranking.ranked[1]).toEqual({
      reviewerId: bruno,
      reviewerName: 'Bruno Visivel',
      completedReviews: PARECERES_BRUNO,
    });
  });

  it('a lista de PREMIAÇÃO usa a mesma régua, e a carta continua sendo concedida pelo `id`', async () => {
    const premiacao = await awardTopReviewers({ tenantId, eventId, actorId: moderador });

    expect(premiacao.ok, premiacao.ok ? 'ok' : premiacao.message).toBe(true);
    if (!premiacao.ok) return;

    /** O painel nomeia quem RECEBEU a carta — e é por aqui que a E82 também vazava. */
    expect(premiacao.awarded).toHaveLength(1);
    expect(premiacao.awarded[0]).toMatchObject({
      reviewerId: ana,
      reviewerName: 'Ana S.',
      completedReviews: PARECERES_ANA,
      cardName: 'Revisor Destaque',
    });

    /** O FATO (a carta) chega à pessoa certa: a máscara troca o texto, não o alvo. */
    const cartas = await adminPrisma.userCard.findMany({
      where: { tenantId, userId: ana, source: 'REVIEWER_TOP' },
      select: { quantity: true },
    });

    expect(cartas).toHaveLength(1);
    expect(cartas[0]!.quantity).toBe(1);
  });
});
