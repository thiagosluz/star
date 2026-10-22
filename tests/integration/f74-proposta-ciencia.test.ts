/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE DE INTEGRAÇÃO — A PROPOSTA CIENTÍFICA QUE NÃO TEM ONDE ANEXAR
 *  (FASE 74 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO RELATADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Numa chamada de trabalho científico (PAPER/POSTER), a pessoa preenche o
 *  formulário público, envia e recebe: "A submissão está incompleta. A trilha
 *  exige revisão cega: anexe a versão sem identificação dos autores." — e o
 *  formulário NÃO TEM campo de arquivo. O rascunho ficava criado no banco, mas a
 *  recusa não devolvia o id: o trabalho escrito virava lixo invisível, e cada
 *  nova tentativa criava MAIS um rascunho órfão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, PELO CAMINHO REAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a recusa de prontidão devolve o `submissionId` e o rascunho fica `DRAFT`;
 *  • a SEGUNDA tentativa retoma o MESMO rascunho (não nasce um segundo) e o
 *    conteúdo gravado é o da última tentativa — sem rascunho órfão por clique;
 *  • a lista de bloqueios que a TELA do rascunho mostra é EXATAMENTE a que o
 *    serviço devolve — inclusive "Selecione a trilha temática da submissão." numa
 *    chamada científica sem trilha, que a tela não mostrava;
 *  • a página da submissão só abre para o AUTOR: outro membro do mesmo tenant com
 *    o UUID não passa na leitura de posse (a página responde 404 — o caso do 404
 *    está no arquivo `f74-pagina-da-submissao.test.ts`, que executa a página).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FICOU PARA A FATIA 3 — E JÁ FOI FECHADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O rascunho de uma tentativa que falhou aparecia como "proposta recebida" no
 *  painel da chamada e consumia o limite por autor. Isso era medido por outro
 *  arquivo, `f74-rascunho-honesto.test.ts`, que agora prende o contrário: rascunho
 *  não é recebida, não ocupa a cota e (o COM arquivo) vira "trabalho em andamento".
 *  Este arquivo mede a RETOMADA e a tela do rascunho — não a contagem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveCall, setCallPublished } from '../../src/lib/proposals/call-service';
import { submitProposal } from '../../src/lib/proposals/proposal-service';
import { getSubmission, submitSubmission } from '../../src/lib/review/submission-service';
import { loadSubmissionPageAccess } from '../../src/lib/review/submission-access';
import {
  evaluateSubmissionReadiness,
  submissionArtifactRequirements,
} from '../../src/domain/review/submission-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';
const TENANT_SLUG = `f74-${RUN}`;

const now = new Date();
const opensAt = new Date(now.getTime() - 86_400_000);
const closesAt = new Date(now.getTime() + 30 * 86_400_000);

/** O resumo precisa passar do mínimo do domínio (150 caracteres). */
const ABSTRACT =
  'Este trabalho descreve a proposta científica que a chamada exige e que o formulário público não consegue completar: sem o PDF anonimizado o servidor recusa o envio, e o autor precisa de um caminho de volta para o rascunho que já foi gravado.';

let tenantId: string;
let eventId: string;
let trackId: string;
let organizerId: string;

/** Autor da proposta na chamada COM trilha. */
let autorId: string;
/** Autor da proposta na chamada científica SEM trilha. */
let autorSemTrilhaId: string;
/** Membro do mesmo tenant que NÃO é autor de nada. */
let outroMembroId: string;

let paperCallId: string;
let paperSemTrilhaCallId: string;
let otherTenantId: string;

async function criarPessoa(input: { tenantId: string; nome: string }): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: input.nome,
      email: `f74.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
    },
  });

  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: id,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });

  await withTenant(input.tenantId, (tx) =>
    tx.roleAssignment.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
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
  title: string;
  trackId: string | null;
}): Promise<string> {
  const created = await saveCall({
    tenantId,
    eventId,
    actorId: organizerId,
    kind: 'PAPER',
    slug: `${input.slug}-${RUN}`,
    title: input.title,
    opensAt,
    closesAt,
    trackId: input.trackId,
    /**
     * `requiresBlindReview` fica ausente de propósito: o padrão do DOMÍNIO para
     * PAPER é cego (`defaultBlindFor`), e é esse padrão que a chamada real usa.
     */
  });

  if (!created.ok) throw new Error(`Falha ao criar a chamada: ${created.message}`);

  await setCallPublished({
    tenantId,
    eventId,
    callId: created.callId,
    actorId: organizerId,
    isPublished: true,
  });

  return created.callId;
}

/** A submissão como o BANCO a guarda — é contra o estado durável que se mede. */
async function rascunhosDaChamada(callId: string, userId: string) {
  return withTenant(tenantId, (tx) =>
    tx.submission.findMany({
      where: { callId, submittedById: userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        title: true,
        abstract: true,
        submittedAt: true,
        callId: true,
        submittedById: true,
        protocol: true,
        proposalData: true,
      },
    }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();
  trackId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: TENANT_SLUG,
        name: `Instituição da Proposta Científica ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f74-vizinha-${RUN}`,
        name: `Instituição Vizinha ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: TIME_ZONE,
      },
    ],
  });

  organizerId = await criarPessoa({ tenantId, nome: `Organizadora F74 ${RUN}` });
  autorId = await criarPessoa({ tenantId, nome: `Autora PAPER ${RUN}` });
  autorSemTrilhaId = await criarPessoa({ tenantId, nome: `Autora sem trilha ${RUN}` });
  outroMembroId = await criarPessoa({ tenantId, nome: `Outro membro ${RUN}` });

  const startsAt = new Date(now.getTime() + 30 * 86_400_000);

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f74-${RUN}`,
        title: 'Simpósio da Proposta Científica',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.track.create({
      data: {
        id: trackId,
        tenantId,
        eventId,
        slug: `trilha-f74-${RUN}`,
        name: 'Pesquisa e extensão',
        requiresBlindReview: true,
        requiredReviews: 2,
      },
    });
  });

  paperCallId = await criarChamada({
    slug: 'artigos-f74',
    title: `Artigos completos ${RUN}`,
    trackId,
  });

  paperSemTrilhaCallId = await criarChamada({
    slug: 'artigos-sem-trilha-f74',
    title: `Artigos sem trilha ${RUN}`,
    trackId: null,
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a falha deixa de ser beco', () => {
  it('a recusa de prontidão devolve o submissionId e o rascunho fica DRAFT', async () => {
    const result = await submitProposal({
      tenantId,
      eventId,
      callId: paperCallId,
      userId: autorId,
      title: 'Vigilância epidemiológica com dados abertos',
      abstract: ABSTRACT,
      keywords: ['epidemiologia', 'dados abertos', 'saúde pública'],
      data: {},
      tenantSlug: TENANT_SLUG,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('NOT_READY');
    expect(result.submissionId).toEqual(expect.any(String));
    expect(result.details?.join(' ')).toMatch(/revisão cega/i);

    const submissionId = result.submissionId;
    if (!submissionId) throw new Error('A recusa de prontidão não devolveu o rascunho.');

    const rascunhos = await rascunhosDaChamada(paperCallId, autorId);

    expect(rascunhos).toHaveLength(1);
    expect(rascunhos[0]).toMatchObject({
      id: submissionId,
      status: 'DRAFT',
      callId: paperCallId,
      submittedById: autorId,
      submittedAt: null,
    });
    expect(rascunhos[0]?.protocol).toMatch(/^\d{4}-[A-Z0-9]{4}$/);

    /**
     * O RASCUNHO É O CAMINHO DE VOLTA: a página da submissão tem que abrir para
     * este id — é para lá que a action redireciona (ajuste da fatia 2).
     */
    const acesso = await loadSubmissionPageAccess({
      tenantId,
      submissionId,
      viewerId: autorId,
    });

    expect(acesso).toEqual({ ok: true, callKind: 'PAPER' });
  });

  it('repetir a tentativa retoma o MESMO rascunho — não nasce um segundo', async () => {
    const antes = await rascunhosDaChamada(paperCallId, autorId);
    expect(antes).toHaveLength(1);

    const primeira = await submitProposal({
      tenantId,
      eventId,
      callId: paperCallId,
      userId: autorId,
      title: 'Vigilância epidemiológica com dados abertos',
      abstract: ABSTRACT,
      keywords: ['epidemiologia', 'dados abertos', 'saúde pública'],
      data: {},
      tenantSlug: TENANT_SLUG,
    });

    expect(primeira.ok).toBe(false);
    if (primeira.ok) return;

    /**
     * ─────────────────────────────────────────────────────────────────────────
     *  A SEGUNDA TENTATIVA TAMBÉM TROCA O CONTEÚDO DO RASCUNHO
     * ─────────────────────────────────────────────────────────────────────────
     *  Retomar não é "ignorar o que a pessoa digitou de novo": o texto que ela
     *  acabou de mandar é o que fica gravado. Sem isso, quem corrigisse um erro de
     *  digitação e tentasse de novo enviaria o texto ANTIGO sem perceber.
     */
    const segunda = await submitProposal({
      tenantId,
      eventId,
      callId: paperCallId,
      userId: autorId,
      title: 'Vigilância epidemiológica com dados abertos — versão corrigida',
      abstract: `${ABSTRACT} Revisão da tentativa anterior.`,
      keywords: ['epidemiologia', 'dados abertos', 'saúde pública', 'vigilância'],
      data: {},
      tenantSlug: TENANT_SLUG,
    });

    expect(segunda.ok).toBe(false);
    if (segunda.ok) return;

    expect(segunda.code).toBe('NOT_READY');
    expect(segunda.submissionId).toBe(primeira.submissionId);

    const depois = await rascunhosDaChamada(paperCallId, autorId);

    expect(depois).toHaveLength(1);
    expect(depois[0]).toMatchObject({
      id: primeira.submissionId,
      status: 'DRAFT',
      title: 'Vigilância epidemiológica com dados abertos — versão corrigida',
    });
    expect(depois[0]?.abstract).toContain('Revisão da tentativa anterior.');

    /**
     * E nada foi enviado: o rascunho não pode ter virado `SUBMITTED` no caminho da
     * retomada (a recusa continua sendo de prontidão).
     */
    expect(depois[0]?.submittedAt).toBeNull();

    /**
     * ─────────────────────────────────────────────────────────────────────────
     *  A FRONTEIRA DA FATIA 3 JÁ FOI FECHADA (não é esquecimento)
     * ─────────────────────────────────────────────────────────────────────────
     *  Este rascunho NÃO aparece como "proposta recebida" no painel e NÃO consome o
     *  limite por autor — a contagem foi corrigida na fatia 3 e é presa por
     *  `f74-rascunho-honesto.test.ts`, que é de onde essa regra é medida. Aqui
     *  interessa só a retomada: um único rascunho, com o texto da última tentativa.
     */
  });

  it('um rascunho COM arquivo não é reaproveitado por outra proposta', async () => {
    /**
     * O CRITÉRIO DE RETOMADA É "SEM ARQUIVO NENHUM" (ver `findReusableDraft`): o
     * `BLIND_PDF` de um trabalho não pode ser anexado ao texto de outro — a
     * prontidão passaria com o PDF errado. Aqui o rascunho do autor ganha um
     * arquivo corrente, e a tentativa seguinte precisa criar um rascunho NOVO.
     */
    const [rascunho] = await rascunhosDaChamada(paperCallId, autorId);
    if (!rascunho) throw new Error('O rascunho da primeira tentativa não existe.');

    await withTenant(tenantId, (tx) =>
      tx.submissionFile.create({
        data: {
          id: randomUUID(),
          tenantId,
          submissionId: rascunho.id,
          kind: 'BLIND_PDF',
          fileName: 'cego.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          checksum: 'a'.repeat(64),
          version: 1,
          isCurrent: true,
          storageKey: `testes/f74/${RUN}/cego.pdf`,
          bucket: 'submissions',
          uploadedById: autorId,
        },
      }),
    );

    const nova = await submitProposal({
      tenantId,
      eventId,
      callId: paperCallId,
      userId: autorId,
      title: 'Segundo trabalho na mesma chamada',
      abstract: ABSTRACT,
      keywords: ['epidemiologia', 'dados abertos', 'saúde pública'],
      data: {},
      tenantSlug: TENANT_SLUG,
    });

    expect(nova.ok).toBe(false);
    if (nova.ok) return;
    expect(nova.code).toBe('NOT_READY');
    expect(nova.submissionId).not.toBe(rascunho.id);

    const depois = await rascunhosDaChamada(paperCallId, autorId);
    expect(depois).toHaveLength(2);

    /** O rascunho retomado por engano teria o título trocado — este não foi tocado. */
    const original = depois.find((row) => row.id === rascunho.id);
    expect(original?.title).toBe('Vigilância epidemiológica com dados abertos — versão corrigida');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a tela do rascunho conta a verdade', () => {
  it('os bloqueios da TELA são exatamente os que o SERVIÇO devolve', async () => {
    /**
     * A chamada científica SEM trilha é o caso ambíguo do relato: o serviço exige
     * trilha e a tela não dizia nada. A prova é a COINCIDÊNCIA das duas listas.
     */
    const proposta = await submitProposal({
      tenantId,
      eventId,
      callId: paperSemTrilhaCallId,
      userId: autorSemTrilhaId,
      title: 'Pesquisa sem trilha definida pela chamada',
      abstract: ABSTRACT,
      keywords: ['pesquisa', 'extensão', 'território'],
      data: {},
      tenantSlug: TENANT_SLUG,
    });

    expect(proposta.ok).toBe(false);
    if (proposta.ok) return;
    expect(proposta.submissionId).toEqual(expect.any(String));

    const submissionId = proposta.submissionId;
    if (!submissionId) throw new Error('A recusa de prontidão não devolveu o rascunho.');

    /**
     * ── A LEITURA DA TELA, FEITA COMO A PÁGINA FAZ ────────────────────────────
     * `loadSubmissionPageAccess` (o tipo da chamada) + `getSubmission` (o detalhe)
     * → `evaluateSubmissionReadiness`. É a mesma composição da página; uma cópia
     * à mão aqui mediria a cópia.
     */
    const acesso = await loadSubmissionPageAccess({ tenantId, submissionId, viewerId: autorSemTrilhaId });
    expect(acesso.ok, 'o autor precisa passar na posse da página').toBe(true);
    if (!acesso.ok) return;

    const detalhe = await getSubmission(tenantId, submissionId);
    if (!detalhe) throw new Error('A submissão recém-criada não foi lida.');

    const daTela = evaluateSubmissionReadiness({
      title: detalhe.title,
      abstract: detalhe.abstract,
      keywords: detalhe.keywords,
      language: detalhe.language,
      trackId: detalhe.trackId,
      files: detalhe.files
        .filter((file) => file.isCurrent)
        .map((file) => ({ kind: file.kind, checksum: file.checksum })),
      requiresBlindReview: detalhe.requiresBlindReview,
      authorCount: detalhe.authors.length,
      proposalKind: acesso.callKind,
    });

    /** E a mesma pergunta ao SERVIÇO, pelo caminho que a tela do rascunho usa. */
    const doServico = await submitSubmission({ tenantId, submissionId, userId: autorSemTrilhaId });

    expect(doServico.ok).toBe(false);
    if (doServico.ok) return;

    expect(doServico.code).toBe('NOT_READY');
    expect(daTela.ready).toBe(false);

    /**
     * A COINCIDÊNCIA É O CONTRATO: mensagem por mensagem, na mesma ordem. Era esta
     * igualdade que faltava quando a tela dizia "Tudo pronto" e o servidor recusava.
     */
    expect(daTela.blockers).toEqual(doServico.details);

    /** E a trilha está lá — a linha que a tela não mostrava. */
    expect(daTela.blockers).toContain('Selecione a trilha temática da submissão.');
    expect(daTela.blockers.join(' ')).toMatch(/revisão cega/i);
  });

  it('com trilha na chamada, o bloqueio de trilha não aparece em nenhuma das duas', async () => {
    const [rascunho] = await rascunhosDaChamada(paperCallId, autorId);
    if (!rascunho) throw new Error('O rascunho da chamada com trilha não existe.');

    const acesso = await loadSubmissionPageAccess({ tenantId, submissionId: rascunho.id, viewerId: autorId });
    expect(acesso.ok).toBe(true);
    if (!acesso.ok) return;

    const detalhe = await getSubmission(tenantId, rascunho.id);
    if (!detalhe) throw new Error('A submissão não foi lida.');

    const daTela = evaluateSubmissionReadiness({
      title: detalhe.title,
      abstract: detalhe.abstract,
      keywords: detalhe.keywords,
      language: detalhe.language,
      trackId: detalhe.trackId,
      files: detalhe.files
        .filter((file) => file.isCurrent)
        .map((file) => ({ kind: file.kind, checksum: file.checksum })),
      requiresBlindReview: detalhe.requiresBlindReview,
      authorCount: detalhe.authors.length,
      proposalKind: acesso.callKind,
    });

    expect(daTela.blockers.join(' ')).not.toMatch(/trilha/i);
  });

  it('a lista de exigências da página da chamada é a mesma que a régua cobra', () => {
    /**
     * A página pública anuncia `submissionArtifactRequirements`; a régua acima
     * transforma a MESMA lista em bloqueios/avisos. Aqui a prova é de domínio: para
     * cada exigência obrigatória, o texto que a tela mostra é o mesmo objeto que a
     * recusa usa — e a exigência que falta vira o bloqueio correspondente.
     */
    const exigencias = submissionArtifactRequirements({
      requiresBlindReview: true,
      proposalKind: 'PAPER',
    });

    expect(exigencias.map((row) => row.key)).toEqual(['BLIND_PDF', 'IDENTIFIED_PDF']);
    expect(exigencias[0]?.label).toContain('anonimizado');
    expect(exigencias[1]?.required).toBe(false);

    const semArquivo = evaluateSubmissionReadiness({
      title: 'Um título suficientemente longo para passar',
      abstract: ABSTRACT,
      keywords: ['uma', 'duas', 'três'],
      language: 'pt-BR',
      trackId,
      files: [],
      requiresBlindReview: true,
      authorCount: 1,
      proposalKind: 'PAPER',
    });

    expect(semArquivo.blockers).toContain(exigencias[0]?.refusal);
    expect(semArquivo.warnings).toContain(exigencias[1]?.notice);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a página da submissão confere o autor', () => {
  it('o autor passa; outro membro do mesmo tenant com o UUID NÃO passa', async () => {
    const [rascunho] = await rascunhosDaChamada(paperCallId, autorId);
    if (!rascunho) throw new Error('O rascunho não existe.');

    const doAutor = await loadSubmissionPageAccess({
      tenantId,
      submissionId: rascunho.id,
      viewerId: autorId,
    });

    expect(doAutor).toEqual({ ok: true, callKind: 'PAPER' });

    const doOutro = await loadSubmissionPageAccess({
      tenantId,
      submissionId: rascunho.id,
      viewerId: outroMembroId,
    });

    /** A leitura negativa não devolve NADA da submissão — nem título, nem tipo. */
    expect(doOutro).toEqual({ ok: false });

    const inexistente = await loadSubmissionPageAccess({
      tenantId,
      submissionId: randomUUID(),
      viewerId: autorId,
    });

    /** "Não existe" e "não é sua" têm a MESMA resposta: a porta não é oráculo. */
    expect(inexistente).toEqual(doOutro);
  });

  it('uma pessoa de outra instituição também é "não passa"', async () => {
    const vizinho = randomUUID();

    await adminPrisma.user.create({
      data: {
        id: vizinho,
        name: `Pessoa da vizinha ${RUN}`,
        email: `f74.vizinha.${RUN}@exemplo.test`,
        emailVerified: true,
      },
    });

    await adminPrisma.userTenantProfile.create({
      data: {
        id: randomUUID(),
        tenantId: otherTenantId,
        userId: vizinho,
        status: 'ACTIVE',
        kind: 'MEMBER',
        joinedAt: new Date(),
      },
    });

    const [rascunho] = await rascunhosDaChamada(paperCallId, autorId);
    if (!rascunho) throw new Error('O rascunho não existe.');

    const acesso = await loadSubmissionPageAccess({
      tenantId,
      submissionId: rascunho.id,
      viewerId: vizinho,
    });

    expect(acesso).toEqual({ ok: false });
  });
});


