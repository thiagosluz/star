/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE DE INTEGRAÇÃO — A CHAMADA HERDA A CEGUEIRA DA TRILHA
 *  (FASE 74 · fatia 5 · decisão 3 do humano)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, PELO CAMINHO REAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • uma chamada com `requiresBlindReview = NULL` sobre uma trilha CEGA faz o
 *    `submitSubmission` EXIGIR o `BLIND_PDF` — e o PDF identificado não basta;
 *  • a MESMA trilha com a chamada dizendo `false` NÃO exige o cego: o identificado
 *    passa (a chamada que se pronuncia vence a trilha);
 *  • a chamada dizendo `true` sobre uma trilha ABERTA exige o cego;
 *  • a herança chega ao ANÚNCIO da página da chamada: `getCallBySlug` devolve a
 *    declaração crua (`null`) e a cegueira EFETIVA (`true`), e a lista de
 *    exigências — a mesma composição da página — anuncia o PDF anonimizado;
 *  • "Padrão do tipo" GRAVA o default do tipo na coluna, e "Herdar da trilha" grava
 *    `NULL`: são estados diferentes, e a diferença é lida do BANCO;
 *  • a ATRIBUIÇÃO de revisor marca `isBlind` pela mesma precedência (uma chamada cega
 *    sobre trilha aberta produzia parecer "não cego" e mostrava a autoria).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE (E NÃO SÓ O UNITÁRIO)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A matriz de domínio prova a função; ela não prova que o SERVIÇO a consulta com os
 *  dados certos. A coluna nulável, a leitura da trilha e a decisão do envio só podem
 *  ser medidas contra o banco — e o defeito original era exatamente uma leitura de
 *  banco que nunca chegava na trilha.
 *  A migração (`DROP NOT NULL`, sem backfill) é medida à parte, por consulta SQL antes
 *  e depois, no relatório da fatia: as linhas existentes mantêm true/false.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { getCallBySlug, saveCall, setCallPublished } from '../../src/lib/proposals/call-service';
import {
  createSubmission,
  getSubmission,
  submitSubmission,
} from '../../src/lib/review/submission-service';
import { assignReviewer } from '../../src/lib/review/review-service';
import { submissionArtifactRequirements } from '../../src/domain/review/submission-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';
const TENANT_SLUG = `f74f5-${RUN}`;

const now = new Date();
const opensAt = new Date(now.getTime() - 86_400_000);
const closesAt = new Date(now.getTime() + 30 * 86_400_000);

const ABSTRACT =
  'Este trabalho descreve a proposta que a chamada recebe e mede a precedência da cegueira: a chamada que não se pronuncia deixa a trilha decidir, e o envio cobra o artefato que essa decisão exige, sem que a tela prometa outra coisa.';

let tenantId: string;
let eventId: string;
let trackBlindId: string;
let trackOpenId: string;
let organizerId: string;
let reviewerId: string;

/** Uma autora por cenário: cada uma cria o próprio rascunho sem disputar estado. */
let autoraHerdaId: string;
let autoraAbertaId: string;
let autoraCegaSobreAbertaId: string;
let autoraAtribuicaoHerdaId: string;
let autoraAtribuicaoAbertaId: string;

let herdaCallId: string;
let abertaCallId: string;
let cegaSobreAbertaCallId: string;

const slugs = {
  herda: `herda-cega-${RUN}`,
  aberta: `aberta-sobre-cega-${RUN}`,
  cegaSobreAberta: `cega-sobre-aberta-${RUN}`,
  padraoPaper: `padrao-paper-${RUN}`,
  padraoMinicurso: `padrao-minicurso-${RUN}`,
};

async function criarPessoa(input: {
  nome: string;
  emailDomain?: string;
}): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: input.nome,
      email: `f74f5.${RUN}.${id.slice(0, 8)}@${input.emailDomain ?? 'exemplo.test'}`,
      emailVerified: true,
    },
  });

  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId: id,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });

  await withTenant(tenantId, (tx) =>
    tx.roleAssignment.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId: id,
        role: 'PARTICIPANT',
        scope: 'TENANT',
      },
    }),
  );

  return id;
}

async function criarChamada(input: {
  slug: string;
  kind: 'PAPER' | 'MINICOURSE';
  trackId: string | null;
  /** `undefined` = "Padrão do tipo"; `null` = "Herdar da trilha". */
  requiresBlindReview?: boolean | null;
}): Promise<string> {
  const created = await saveCall({
    tenantId,
    eventId,
    actorId: organizerId,
    kind: input.kind,
    slug: input.slug,
    title: `Chamada ${input.slug}`,
    opensAt,
    closesAt,
    trackId: input.trackId,
    ...(input.requiresBlindReview === undefined
      ? {}
      : { requiresBlindReview: input.requiresBlindReview }),
  });

  if (!created.ok) throw new Error(`Falha ao criar a chamada: ${created.message}`);

  const published = await setCallPublished({
    tenantId,
    eventId,
    callId: created.callId,
    actorId: organizerId,
    isPublished: true,
  });

  if (!published.ok) throw new Error(`Falha ao publicar a chamada: ${published.message}`);

  return created.callId;
}

/** O rascunho nasce pelo motor real: autor correspondente incluído, janela conferida. */
async function criarRascunho(callId: string, userId: string): Promise<string> {
  const created = await createSubmission({
    tenantId,
    eventId,
    callId,
    userId,
    title: 'Precedência da cegueira medida no envio',
    abstract: ABSTRACT,
    keywords: ['revisão cega', 'chamada', 'trilha'],
  });

  if (!created.ok) throw new Error(`Falha ao criar o rascunho: ${created.message}`);

  return created.id;
}

/**
 * Anexa um artefato CORRENTE direto no banco: o caminho de upload (F23/F36) exige
 * storage, e aqui o que se mede é a régua de prontidão — o arquivo confirmado.
 */
async function anexar(input: {
  submissionId: string;
  kind: 'BLIND_PDF' | 'IDENTIFIED_PDF';
  userId: string;
}): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.submissionFile.create({
      data: {
        id: randomUUID(),
        tenantId,
        submissionId: input.submissionId,
        kind: input.kind,
        fileName: `${input.kind.toLowerCase()}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        checksum: randomUUID().replace(/-/g, '').padEnd(64, 'a').slice(0, 64),
        version: 1,
        isCurrent: true,
        storageKey: `testes/f74-fatia5/${RUN}/${input.submissionId}/${input.kind}.pdf`,
        bucket: 'submissions',
        uploadedById: input.userId,
      },
    }),
  );
}

/** A coluna como o BANCO a guarda — é contra o estado durável que se mede. */
async function colunaDeBlind(callId: string): Promise<boolean | null> {
  return withTenant(tenantId, (tx) =>
    tx.callForProposals.findFirstOrThrow({
      where: { id: callId },
      select: { requiresBlindReview: true },
    }),
  ).then((row) => row.requiresBlindReview);
}

/** A recusa que a régua devolve quando falta o PDF anonimizado. */
const RECUSA_CEGA =
  submissionArtifactRequirements({ requiresBlindReview: true, proposalKind: 'PAPER' }).find(
    (row) => row.required,
  )?.refusal ?? '';

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  trackBlindId = randomUUID();
  trackOpenId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição da Herança ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  organizerId = await criarPessoa({ nome: `Organizador ${RUN}` });
  /** Domínio de e-mail próprio: um domínio compartilhado viraria conflito INCERTO. */
  reviewerId = await criarPessoa({ nome: `Revisor ${RUN}`, emailDomain: 'revisor-f74.test' });

  autoraHerdaId = await criarPessoa({ nome: `Autora herda ${RUN}` });
  autoraAbertaId = await criarPessoa({ nome: `Autora aberta ${RUN}` });
  autoraCegaSobreAbertaId = await criarPessoa({ nome: `Autora cega ${RUN}` });
  autoraAtribuicaoHerdaId = await criarPessoa({ nome: `Autora atribuição herda ${RUN}` });
  autoraAtribuicaoAbertaId = await criarPessoa({ nome: `Autora atribuição aberta ${RUN}` });

  const startsAt = new Date(now.getTime() + 30 * 86_400_000);

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f74f5-${RUN}`,
        title: 'Simpósio da Herança da Cegueira',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.track.createMany({
      data: [
        {
          id: trackBlindId,
          tenantId,
          eventId,
          slug: `trilha-cega-${RUN}`,
          name: 'Trilha cega',
          requiresBlindReview: true,
          requiredReviews: 2,
        },
        {
          id: trackOpenId,
          tenantId,
          eventId,
          slug: `trilha-aberta-${RUN}`,
          name: 'Trilha aberta',
          requiresBlindReview: false,
          requiredReviews: 2,
        },
      ],
    });

    await tx.reviewerExpertise.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId: reviewerId,
        expertiseKeywords: ['revisão cega', 'chamada', 'trilha'],
        preferredTrackIds: [trackBlindId, trackOpenId],
        maxConcurrentAssignments: 10,
      },
    });
  });

  herdaCallId = await criarChamada({
    slug: slugs.herda,
    kind: 'PAPER',
    trackId: trackBlindId,
    requiresBlindReview: null,
  });

  abertaCallId = await criarChamada({
    slug: slugs.aberta,
    kind: 'PAPER',
    trackId: trackBlindId,
    requiresBlindReview: false,
  });

  cegaSobreAbertaCallId = await criarChamada({
    slug: slugs.cegaSobreAberta,
    kind: 'PAPER',
    trackId: trackOpenId,
    requiresBlindReview: true,
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o ENVIO cobra a cegueira que a precedência decide', () => {
  it('chamada CALADA + trilha cega: exige o BLIND_PDF, e o identificado não basta', async () => {
    /** A frase esperada vem do DOMÍNIO — não é uma cópia escrita neste arquivo. */
    expect(RECUSA_CEGA).toMatch(/revisão cega/i);

    const submissionId = await criarRascunho(herdaCallId, autoraHerdaId);

    const semArquivo = await submitSubmission({ tenantId, submissionId, userId: autoraHerdaId });

    expect(semArquivo.ok).toBe(false);
    if (semArquivo.ok) return;

    expect(semArquivo.code).toBe('NOT_READY');
    expect(semArquivo.details?.join(' ')).toMatch(/revisão cega/i);
    expect(semArquivo.details).toContain(RECUSA_CEGA);

    /** O PDF COM identificação é recomendação, não substituto do anonimizado. */
    await anexar({ submissionId, kind: 'IDENTIFIED_PDF', userId: autoraHerdaId });

    const soIdentificado = await submitSubmission({ tenantId, submissionId, userId: autoraHerdaId });

    expect(soIdentificado.ok).toBe(false);
    if (soIdentificado.ok) return;
    expect(soIdentificado.code).toBe('NOT_READY');
    expect(soIdentificado.details).toContain(RECUSA_CEGA);

    await anexar({ submissionId, kind: 'BLIND_PDF', userId: autoraHerdaId });

    const enviado = await submitSubmission({ tenantId, submissionId, userId: autoraHerdaId });

    expect(enviado.ok).toBe(true);
    if (!enviado.ok) return;
    expect(enviado.status).toBe('SUBMITTED');

    /** E a tela da submissão lê a MESMA cegueira que o envio cobrou. */
    const detalhe = await getSubmission(tenantId, submissionId);
    expect(detalhe?.requiresBlindReview).toBe(true);
  });

  it('a MESMA trilha com a chamada dizendo "aberta": o identificado BASTA', async () => {
    const submissionId = await criarRascunho(abertaCallId, autoraAbertaId);

    const semArquivo = await submitSubmission({ tenantId, submissionId, userId: autoraAbertaId });

    expect(semArquivo.ok).toBe(false);
    if (semArquivo.ok) return;

    /** Continua faltando um PDF (o trabalho é científico), mas NÃO o anonimizado. */
    expect(semArquivo.code).toBe('NOT_READY');
    expect(semArquivo.details?.join(' ')).not.toMatch(/revisão cega|anonimizad/i);
    expect(semArquivo.details?.join(' ')).toMatch(/PDF/);

    const detalheAntes = await getSubmission(tenantId, submissionId);
    expect(detalheAntes?.requiresBlindReview).toBe(false);

    await anexar({ submissionId, kind: 'IDENTIFIED_PDF', userId: autoraAbertaId });

    const enviado = await submitSubmission({ tenantId, submissionId, userId: autoraAbertaId });

    expect(enviado.ok).toBe(true);
    if (!enviado.ok) return;
    expect(enviado.status).toBe('SUBMITTED');
  });

  it('chamada dizendo "cega" sobre trilha ABERTA: exige o BLIND_PDF', async () => {
    const submissionId = await criarRascunho(cegaSobreAbertaCallId, autoraCegaSobreAbertaId);

    const semArquivo = await submitSubmission({
      tenantId,
      submissionId,
      userId: autoraCegaSobreAbertaId,
    });

    expect(semArquivo.ok).toBe(false);
    if (semArquivo.ok) return;
    expect(semArquivo.code).toBe('NOT_READY');
    expect(semArquivo.details).toContain(RECUSA_CEGA);

    await anexar({ submissionId, kind: 'BLIND_PDF', userId: autoraCegaSobreAbertaId });

    const enviado = await submitSubmission({
      tenantId,
      submissionId,
      userId: autoraCegaSobreAbertaId,
    });

    expect(enviado.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o ANÚNCIO da página da chamada acompanha a herança', () => {
  it('a chamada que herda anuncia o PDF anonimizado (antes não anunciava)', async () => {
    /**
     * ── A COMPOSIÇÃO DA PÁGINA, FEITA AQUI ────────────────────────────────────
     * `getCallBySlug` (a leitura da página) → `submissionArtifactRequirements` (a
     * lista de "O que esta chamada pede"). É a mesma dupla da página; recopiar a
     * frase aqui mediria a cópia.
     */
    const lida = await getCallBySlug({
      tenantId,
      eventId,
      slug: slugs.herda,
      now: new Date(),
    });

    expect(lida.ok).toBe(true);
    if (!lida.ok) return;

    expect(lida.call.requiresBlindReview).toBeNull();
    expect(lida.call.effectiveRequiresBlindReview).toBe(true);

    const anuncio = submissionArtifactRequirements({
      requiresBlindReview: lida.call.effectiveRequiresBlindReview,
      proposalKind: lida.call.kind,
    });

    expect(anuncio.map((row) => row.key)).toEqual(['BLIND_PDF', 'IDENTIFIED_PDF']);
    expect(anuncio[0]?.required).toBe(true);
    expect(anuncio[0]?.label).toContain('anonimizado');
    expect(anuncio[1]?.required).toBe(false);
  });

  it('a chamada que diz "aberta" anuncia o PDF comum — a herança não se inventa', async () => {
    const lida = await getCallBySlug({
      tenantId,
      eventId,
      slug: slugs.aberta,
      now: new Date(),
    });

    expect(lida.ok).toBe(true);
    if (!lida.ok) return;

    expect(lida.call.requiresBlindReview).toBe(false);
    expect(lida.call.effectiveRequiresBlindReview).toBe(false);

    const anuncio = submissionArtifactRequirements({
      requiresBlindReview: lida.call.effectiveRequiresBlindReview,
      proposalKind: lida.call.kind,
    });

    expect(anuncio.map((row) => row.key)).toEqual(['ANY_PDF']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('"Padrão do tipo" × "Herdar da trilha" — a coluna lida do banco', () => {
  it('o padrão do tipo GRAVA o default; herdar grava NULL (e não se confundem)', async () => {
    /**
     * O TESTE DO DEFAULT DO TIPO (FASE 33): quem escolhe "Padrão do tipo" não quer
     * dizer "não me pronuncio" — quer congelar o default do tipo na chamada. Por
     * isso a coluna recebe `true`/`false` e a trilha deixa de ser consultada.
     */
    const padraoPaper = await criarChamada({
      slug: slugs.padraoPaper,
      kind: 'PAPER',
      trackId: null,
    });

    const padraoMinicurso = await criarChamada({
      slug: slugs.padraoMinicurso,
      kind: 'MINICOURSE',
      trackId: null,
    });

    expect(await colunaDeBlind(padraoPaper)).toBe(true);
    expect(await colunaDeBlind(padraoMinicurso)).toBe(false);

    /** E "herdar" é o BURACO na coluna, não o default. */
    expect(await colunaDeBlind(herdaCallId)).toBeNull();
    expect(await colunaDeBlind(abertaCallId)).toBe(false);
    expect(await colunaDeBlind(cegaSobreAbertaCallId)).toBe(true);
  });

  it('a chamada pode ser EDITADA para herdar e de volta para uma decisão', async () => {
    const atualizar = async (requiresBlindReview: boolean | null) => {
      const resultado = await saveCall({
        tenantId,
        eventId,
        actorId: organizerId,
        callId: herdaCallId,
        kind: 'PAPER',
        slug: slugs.herda,
        title: `Chamada ${slugs.herda}`,
        opensAt,
        closesAt,
        trackId: trackBlindId,
        requiresBlindReview,
      });

      if (!resultado.ok) throw new Error(`Falha ao salvar: ${resultado.message}`);
    };

    await atualizar(true);
    expect(await colunaDeBlind(herdaCallId)).toBe(true);

    await atualizar(null);
    expect(await colunaDeBlind(herdaCallId)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a ATRIBUIÇÃO de revisor usa a MESMA precedência', () => {
  async function isBlindDaAtribuicao(submissionId: string): Promise<boolean | null> {
    return withTenant(tenantId, (tx) =>
      tx.reviewAssignment.findFirstOrThrow({
        where: { submissionId },
        select: { isBlind: true },
      }),
    ).then((row) => row.isBlind);
  }

  it('a chamada que herda de trilha cega produz parecer CEGO', async () => {
    const submissionId = await criarRascunho(herdaCallId, autoraAtribuicaoHerdaId);

    const atribuida = await assignReviewer({
      tenantId,
      submissionId,
      reviewerId,
      assignedById: organizerId,
    });

    expect(atribuida.ok).toBe(true);
    expect(await isBlindDaAtribuicao(submissionId)).toBe(true);
  });

  it('a chamada que diz "aberta" sobre a mesma trilha cega produz parecer ABERTO', async () => {
    /**
     * O outro lado da precedência: a declaração da chamada vence a trilha. Antes da
     * fatia, esta atribuição nascia cega (a trilha era a única lida) enquanto o envio
     * — que também lia só a trilha mais o fallback — deixava a chamada decidir.
     */
    const submissionId = await criarRascunho(abertaCallId, autoraAtribuicaoAbertaId);

    const atribuida = await assignReviewer({
      tenantId,
      submissionId,
      reviewerId,
      assignedById: organizerId,
    });

    expect(atribuida.ok).toBe(true);
    expect(await isBlindDaAtribuicao(submissionId)).toBe(false);
  });
});
