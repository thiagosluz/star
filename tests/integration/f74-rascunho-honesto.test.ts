/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE DE INTEGRAÇÃO — O RASCUNHO HONESTO (FASE 74 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO MEDIDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O envio pela chamada pública cria o rascunho e só depois valida a prontidão.
 *  Quando a validação recusa (falta o PDF anonimizado), o rascunho fica — e ele
 *  aparecia no painel do organizador como "proposta recebida" e consumia o limite
 *  por autor. Com `maxSubmissionsPerAuthor = 1`, a pessoa se trancava fora TENTANDO:
 *  o rascunho da primeira recusa já ocupava a vaga.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE, CONTRA O BANCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  (a) chamada com 1 rascunho + 1 proposta enviada → a lista mostra 1 e o selo diz
 *      1 ("1 proposta recebida"); o rascunho NÃO aparece;
 *  (b) com limite 1: N tentativas falhas não trancam a pessoa fora (o envio real
 *      passa) e o SEGUNDO envio real é recusado pelo limite — a regra não foi
 *      afrouxada onde importa;
 *  (c) a decisão do item 4: rascunho COM arquivo é TRABALHO EM ANDAMENTO — não é
 *      proposta recebida, não some, e é contado à parte com frase própria;
 *  (d) o selo e a lista concordam em TODAS as chamadas do evento (a catraca da F54).
 *
 *  E ainda o lado oposto do item 3: tirar o rascunho da conta não pode virar um
 *  colchão. O rascunho vazio é REUSADO pela fatia 2 (repetir a tentativa não cria
 *  outro), e a retomada confere o limite — senão um rascunho esquecido viraria uma
 *  proposta além da cota.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { listCallProposals, listCalls, saveCall, setCallPublished, deleteCall } from '../../src/lib/proposals/call-service';
import { submitProposal } from '../../src/lib/proposals/proposal-service';
import { submitSubmission } from '../../src/lib/review/submission-service';
import {
  inProgressDraftsLabel,
  receivedProposalsLabel,
} from '../../src/domain/proposals/proposal-receipt-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';
const TENANT_SLUG = `f74-honesto-${RUN}`;

const now = new Date();
const opensAt = new Date(now.getTime() - 86_400_000);
const closesAt = new Date(now.getTime() + 30 * 86_400_000);

/** O resumo precisa passar do mínimo do domínio (150 caracteres). */
const ABSTRACT =
  'Este trabalho existe para medir o que o painel conta como proposta recebida: o envio pela chamada científica cria o rascunho antes de validar a prontidão, e o rascunho de uma tentativa que falhou não pode ocupar a vaga de uma proposta que ninguém enviou.';

let tenantId: string;
let eventId: string;
let trackId: string;
let organizerId: string;

/** Autora que só falhou (rascunho vazio) na chamada principal. */
let autoraRascunhoId: string;
/** Autora que enviou de verdade na chamada principal. */
let autoraEnviadaId: string;
/** Autora com rascunho COM arquivo (trabalho em andamento) na chamada principal. */
let autoraEmAndamentoId: string;
/** Autora da prova do limite. */
let autoraLimiteId: string;
/** Autora da prova de que rascunho com arquivo não ocupa a cota. */
let autoraCotaId: string;
/** Autora da prova de que a retomada não fura o limite. */
let autoraRetomadaId: string;

let chamadaPrincipalId: string;
let chamadaLimiteId: string;
let chamadaCotaId: string;

async function criarPessoa(nome: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: nome,
      email: `f74.${RUN}.${id.slice(0, 8)}@exemplo.test`,
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
  title: string;
  maxSubmissionsPerAuthor: number;
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
    maxSubmissionsPerAuthor: input.maxSubmissionsPerAuthor,
    trackId,
    /**
     * `requiresBlindReview` fica ausente de propósito: o padrão do DOMÍNIO para
     * PAPER é cego, e é ele que a proposta real enfrenta — é a falta do PDF
     * anonimizado que faz a tentativa falhar.
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

/** A tentativa que falha: preenche, envia e recebe a recusa de prontidão. */
async function tentarEnviar(input: {
  callId: string;
  userId: string;
  title: string;
}): Promise<{ submissionId: string; code: string }> {
  const result = await submitProposal({
    tenantId,
    eventId,
    callId: input.callId,
    userId: input.userId,
    title: input.title,
    abstract: ABSTRACT,
    keywords: ['proposta', 'rascunho', 'chamada'],
    data: {},
    tenantSlug: TENANT_SLUG,
  });

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('A tentativa deveria ter sido recusada.');

  if (!result.submissionId) throw new Error(`A recusa ${result.code} não devolveu o rascunho.`);

  return { submissionId: result.submissionId, code: result.code };
}

/**
 * Anexa o `BLIND_PDF` direto no banco.
 *
 * O upload de verdade (pré-assinada + MinIO) tem cobertura própria (`f74-posse-do-
 * upload`); o que esta fatia mede é a CONTAGEM, e o arquivo aqui só precisa existir
 * como o banco o guarda — com `deletedAt` nulo, que é o critério de "tem arquivo".
 */
async function anexarBlindPdf(submissionId: string, uploadedById: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.submissionFile.create({
      data: {
        id: randomUUID(),
        tenantId,
        submissionId,
        kind: 'BLIND_PDF',
        fileName: 'cego.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        checksum: 'b'.repeat(64),
        version: 1,
        isCurrent: true,
        storageKey: `testes/f74-honesto/${RUN}/${submissionId}.pdf`,
        bucket: 'submissions',
        uploadedById,
      },
    }),
  );
}

/** As submissões da chamada como o BANCO as guarda — é contra o durável que se mede. */
async function submissoesDaChamada(callId: string, userId?: string) {
  return withTenant(tenantId, (tx) =>
    tx.submission.findMany({
      where: { tenantId, callId, deletedAt: null, ...(userId ? { submittedById: userId } : {}) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        submittedById: true,
        submittedAt: true,
        files: { where: { deletedAt: null }, select: { id: true, kind: true } },
      },
    }),
  );
}

/** A chamada como o painel a lê. */
async function chamadaDoPainel(callId: string) {
  const result = await listCalls({ tenantId, eventId, now: new Date() });

  expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
  if (!result.ok) throw new Error('Falha ao listar as chamadas.');

  const call = result.calls.find((row) => row.id === callId);
  if (!call) throw new Error(`A chamada ${callId} não apareceu no painel.`);

  return call;
}

async function propostasDaChamada(callId: string) {
  const result = await listCallProposals({ tenantId, callId });

  expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
  if (!result.ok) throw new Error('Falha ao listar as propostas.');

  return result.proposals;
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  trackId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição do Rascunho Honesto ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  organizerId = await criarPessoa(`Organizadora F74 ${RUN}`);
  autoraRascunhoId = await criarPessoa(`Autora do rascunho vazio ${RUN}`);
  autoraEnviadaId = await criarPessoa(`Autora da proposta enviada ${RUN}`);
  autoraEmAndamentoId = await criarPessoa(`Autora do trabalho em andamento ${RUN}`);
  autoraLimiteId = await criarPessoa(`Autora do limite ${RUN}`);
  autoraCotaId = await criarPessoa(`Autora da cota ${RUN}`);
  autoraRetomadaId = await criarPessoa(`Autora da retomada ${RUN}`);

  const startsAt = new Date(now.getTime() + 30 * 86_400_000);

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f74-honesto-${RUN}`,
        title: 'Simpósio do Rascunho Honesto',
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
        slug: `trilha-f74-honesto-${RUN}`,
        name: 'Pesquisa e extensão',
        requiresBlindReview: true,
        requiredReviews: 2,
        maxSubmissionsPerAuthor: 0,
      },
    });
  });

  chamadaPrincipalId = await criarChamada({
    slug: 'principal-f74',
    title: `Chamada principal ${RUN}`,
    maxSubmissionsPerAuthor: 0,
  });

  chamadaLimiteId = await criarChamada({
    slug: 'limite-f74',
    title: `Chamada com limite de uma ${RUN}`,
    maxSubmissionsPerAuthor: 1,
  });

  chamadaCotaId = await criarChamada({
    slug: 'cota-f74',
    title: `Chamada da cota ${RUN}`,
    maxSubmissionsPerAuthor: 1,
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('(a) o painel não recebe o que ninguém enviou', () => {
  it('1 rascunho + 1 proposta enviada → a lista mostra 1 e o selo diz 1', async () => {
    const falha = await tentarEnviar({
      callId: chamadaPrincipalId,
      userId: autoraRascunhoId,
      title: 'Pesquisa que ainda não saiu da mão da autora',
    });

    expect(falha.code).toBe('NOT_READY');

    const envio = await tentarEnviar({
      callId: chamadaPrincipalId,
      userId: autoraEnviadaId,
      title: 'Pesquisa enviada de verdade',
    });

    await anexarBlindPdf(envio.submissionId, autoraEnviadaId);

    const submetida = await submitSubmission({
      tenantId,
      submissionId: envio.submissionId,
      userId: autoraEnviadaId,
    });

    expect(submetida.ok, submetida.ok ? 'ok' : submetida.message).toBe(true);

    // ── A LISTA: só a proposta enviada ────────────────────────────────────────
    const propostas = await propostasDaChamada(chamadaPrincipalId);

    expect(propostas).toHaveLength(1);
    expect(propostas[0]?.id).toBe(envio.submissionId);
    expect(propostas.map((row) => row.id)).not.toContain(falha.submissionId);
    expect(propostas[0]?.status).toBe('SUBMITTED');

    // ── O SELO: o MESMO número, com a frase do domínio ────────────────────────
    const chamada = await chamadaDoPainel(chamadaPrincipalId);

    expect(chamada.proposals).toBe(1);
    expect(chamada.proposalsInProgress).toBe(0);
    expect(receivedProposalsLabel(chamada.proposals)).toBe('1 proposta recebida');
    expect(chamada.proposals).toBe(propostas.length);

    /**
     * O rascunho continua no banco (nada se perde) — ele só não é mais confundido
     * com proposta recebida. A área do AUTOR continua listando os rascunhos dela
     * (`/submissoes`): esta fatia não mexe nessa tela.
     */
    const doBanco = await submissoesDaChamada(chamadaPrincipalId, autoraRascunhoId);

    expect(doBanco).toHaveLength(1);
    expect(doBanco[0]).toMatchObject({ id: falha.submissionId, status: 'DRAFT' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('(c) o rascunho COM arquivo é trabalho em andamento — não proposta recebida', () => {
  it('não entra na lista nem no selo de recebidas, mas é contado à parte', async () => {
    const tentativa = await tentarEnviar({
      callId: chamadaPrincipalId,
      userId: autoraEmAndamentoId,
      title: 'Pesquisa que a autora começou e ainda vai anexar',
    });

    /**
     * O arquivo é o que separa "trabalho em andamento" de "resto de tentativa": a
     * fatia 2 NÃO reusa rascunho com arquivo (o PDF é de um trabalho específico),
     * então ele sobrevive — e o organizador precisa saber que existe.
     */
    await anexarBlindPdf(tentativa.submissionId, autoraEmAndamentoId);

    const chamada = await chamadaDoPainel(chamadaPrincipalId);
    const propostas = await propostasDaChamada(chamadaPrincipalId);

    // Continua NÃO sendo proposta recebida...
    expect(chamada.proposals).toBe(1);
    expect(propostas).toHaveLength(1);
    expect(propostas.map((row) => row.id)).not.toContain(tentativa.submissionId);

    // ...mas não sumiu: virou a terceira resposta, com frase própria.
    expect(chamada.proposalsInProgress).toBe(1);
    expect(inProgressDraftsLabel(chamada.proposalsInProgress ?? 0)).toBe('1 rascunho em andamento');

    // O selo e a lista continuam concordando (a catraca da F54).
    expect(chamada.proposals).toBe(propostas.length);

    // E o dado físico está intacto: o rascunho é DRAFT e o arquivo existe.
    const doBanco = await submissoesDaChamada(chamadaPrincipalId, autoraEmAndamentoId);

    expect(doBanco).toHaveLength(1);
    expect(doBanco[0]?.status).toBe('DRAFT');
    expect(doBanco[0]?.files.map((file) => file.kind)).toEqual(['BLIND_PDF']);
  });

  it('repetir a tentativa de quem tem rascunho com arquivo cria outro rascunho — e a conta continua honesta', async () => {
    /**
     * Este é o "colchão" que o item 3 manda olhar: como o rascunho com arquivo não é
     * reusado, uma tentativa nova cria outro. O que impede o abuso não é uma cota de
     * rascunhos (que não existe): é o fato de que nenhum deles conta como proposta
     * recebida nem consome o limite — e o armazenamento tem a quota da F21. O teste
     * prende o comportamento para ninguém achar que é engano.
     */
    const antes = await submissoesDaChamada(chamadaPrincipalId, autoraEmAndamentoId);

    const nova = await tentarEnviar({
      callId: chamadaPrincipalId,
      userId: autoraEmAndamentoId,
      title: 'Outra pesquisa da mesma autora',
    });

    const anteriores = new Set(antes.map((row) => row.id));
    expect(anteriores.has(nova.submissionId)).toBe(false);

    const depois = await submissoesDaChamada(chamadaPrincipalId, autoraEmAndamentoId);
    expect(depois).toHaveLength(2);

    const chamada = await chamadaDoPainel(chamadaPrincipalId);
    const propostas = await propostasDaChamada(chamadaPrincipalId);

    // Nenhum dos dois rascunhos entrou na lista de recebidas.
    expect(chamada.proposals).toBe(1);
    expect(propostas).toHaveLength(1);
    // E só o que tem arquivo é trabalho em andamento (o novo está vazio).
    expect(chamada.proposalsInProgress).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('(b) o limite por autor não conta rascunho — e continua valendo onde importa', () => {
  it('depois de N tentativas falhas, o envio real PASSA; o segundo envio real é RECUSADO', async () => {
    const rascunhos = new Set<string>();

    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      const recusa = await tentarEnviar({
        callId: chamadaLimiteId,
        userId: autoraLimiteId,
        title: `Pesquisa da tentativa ${tentativa}`,
      });

      expect(recusa.code).toBe('NOT_READY');
      rascunhos.add(recusa.submissionId);
    }

    /**
     * A fatia 2 reusa o rascunho vazio: três tentativas, UM rascunho. É o que impede
     * o limite de virar colchão — repetir a mesma tentativa não multiplica nada.
     */
    expect(rascunhos.size).toBe(1);

    const [rascunho] = [...rascunhos];
    if (!rascunho) throw new Error('Nenhum rascunho foi criado.');

    /**
     * ANTES do envio real, a cota das recebidas está VAZIA: o rascunho não ocupa
     * vaga. Este é o fato que a fase corrige — antes, a contagem do limite já era 1.
     */
    const antesDoEnvio = await chamadaDoPainel(chamadaLimiteId);
    expect(antesDoEnvio.proposals).toBe(0);
    expect(antesDoEnvio.proposalsInProgress).toBe(0);
    expect(receivedProposalsLabel(antesDoEnvio.proposals)).toBe('nenhuma proposta recebida');

    // ── O ENVIO REAL ACONTECE ──────────────────────────────────────────────────
    await anexarBlindPdf(rascunho, autoraLimiteId);

    const submetida = await submitSubmission({
      tenantId,
      submissionId: rascunho,
      userId: autoraLimiteId,
    });

    expect(submetida.ok, submetida.ok ? 'ok' : submetida.message).toBe(true);

    const depoisDoEnvio = await chamadaDoPainel(chamadaLimiteId);
    expect(depoisDoEnvio.proposals).toBe(1);

    // ── O SEGUNDO ENVIO REAL É RECUSADO PELO LIMITE ────────────────────────────
    const segundo = await submitProposal({
      tenantId,
      eventId,
      callId: chamadaLimiteId,
      userId: autoraLimiteId,
      title: 'Uma segunda proposta que o limite de uma precisa recusar',
      abstract: ABSTRACT,
      keywords: ['proposta', 'rascunho', 'chamada'],
      data: {},
      tenantSlug: TENANT_SLUG,
    });

    expect(segundo.ok).toBe(false);
    if (segundo.ok) return;
    expect(segundo.code).toBe('AUTHOR_LIMIT_REACHED');

    /**
     * E nada foi criado: a recusa do limite acontece ANTES da escrita. A chamada
     * continua com uma proposta — a que foi enviada de verdade.
     */
    const doBanco = await submissoesDaChamada(chamadaLimiteId, autoraLimiteId);

    expect(doBanco).toHaveLength(1);
    expect(doBanco[0]).toMatchObject({ id: rascunho, status: 'SUBMITTED' });
  });

  it('rascunho COM arquivo também não consome a cota — a tentativa seguinte ainda é aceita pelo limite', async () => {
    const primeiro = await tentarEnviar({
      callId: chamadaCotaId,
      userId: autoraCotaId,
      title: 'Primeira tentativa da autora da cota',
    });

    await anexarBlindPdf(primeiro.submissionId, autoraCotaId);

    /**
     * A tentativa seguinte NÃO pode ser recusada pelo limite: a única submissão da
     * autora é um rascunho, e rascunho não é proposta recebida. Antes da fatia 3 a
     * resposta aqui era `AUTHOR_LIMIT_REACHED` — a pessoa se trancava fora.
     *
     * Ela cria um rascunho NOVO (o primeiro tem arquivo e não é reusável) e falha na
     * prontidão, que é o desfecho honesto: ainda falta o PDF do novo trabalho.
     */
    const segundo = await tentarEnviar({
      callId: chamadaCotaId,
      userId: autoraCotaId,
      title: 'Segunda tentativa da autora da cota',
    });

    expect(segundo.code).toBe('NOT_READY');
    expect(segundo.submissionId).not.toBe(primeiro.submissionId);

    const doBanco = await submissoesDaChamada(chamadaCotaId, autoraCotaId);

    expect(doBanco).toHaveLength(2);
    expect(doBanco.filter((row) => row.status === 'DRAFT')).toHaveLength(2);

    const chamada = await chamadaDoPainel(chamadaCotaId);
    expect(chamada.proposals).toBe(0);
    // Um com arquivo (o primeiro), um vazio (o segundo): só o primeiro é andamento.
    expect(chamada.proposalsInProgress).toBe(1);
  });

  it('a RETOMADA do rascunho não fura o limite já usado por uma proposta real', async () => {
    /**
     * O lado oposto do item 3: se os rascunhos deixaram de contar, um rascunho vazio
     * esquecido não pode virar uma proposta além da cota. Monta-se o estado de
     * propósito — um rascunho com arquivo (que não é reusado) e um vazio (que é) —,
     * envia-se o com arquivo e tenta-se retomar o vazio.
     */
    const comArquivo = await tentarEnviar({
      callId: chamadaCotaId,
      userId: autoraRetomadaId,
      title: 'Pesquisa que vai ser enviada de verdade',
    });

    await anexarBlindPdf(comArquivo.submissionId, autoraRetomadaId);

    const vazio = await tentarEnviar({
      callId: chamadaCotaId,
      userId: autoraRetomadaId,
      title: 'Rascunho vazio que fica para trás',
    });

    const submetida = await submitSubmission({
      tenantId,
      submissionId: comArquivo.submissionId,
      userId: autoraRetomadaId,
    });

    expect(submetida.ok, submetida.ok ? 'ok' : submetida.message).toBe(true);

    // A partir daqui a autora já usou a única vaga dela nesta chamada.
    const doBancoAntes = await submissoesDaChamada(chamadaCotaId, autoraRetomadaId);
    expect(doBancoAntes.filter((row) => row.status === 'SUBMITTED')).toHaveLength(1);

    // A retomada existe (o rascunho vazio é reusável) — e MESMO ASSIM o limite barra.
    const retomada = await submitProposal({
      tenantId,
      eventId,
      callId: chamadaCotaId,
      userId: autoraRetomadaId,
      title: 'Tentativa de retomar o rascunho depois do limite',
      abstract: ABSTRACT,
      keywords: ['proposta', 'rascunho', 'chamada'],
      data: {},
      tenantSlug: TENANT_SLUG,
    });

    expect(retomada.ok).toBe(false);
    if (retomada.ok) return;
    expect(retomada.code).toBe('AUTHOR_LIMIT_REACHED');
    /** E nem o id do rascunho volta: não há caminho para continuar o que não pode entrar. */
    expect(retomada.submissionId).toBeUndefined();

    const doBancoDepois = await submissoesDaChamada(chamadaCotaId, autoraRetomadaId);
    expect(doBancoDepois).toHaveLength(2);
    expect(doBancoDepois.filter((row) => row.status === 'DRAFT')).toHaveLength(1);
    expect(doBancoDepois.find((row) => row.id === vazio.submissionId)?.status).toBe('DRAFT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('(d) o selo e a lista concordam — a catraca da F54', () => {
  it('em TODAS as chamadas do evento, a contagem do selo é a da lista', async () => {
    const result = await listCalls({ tenantId, eventId, now: new Date() });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) throw new Error('Falha ao listar as chamadas.');

    expect(result.calls.length).toBeGreaterThanOrEqual(3);

    for (const call of result.calls) {
      const propostas = await propostasDaChamada(call.id);

      expect(propostas.length, `chamada ${call.title}: lista x selo`).toBe(call.proposals);

      const frase = receivedProposalsLabel(call.proposals);

      if (call.proposals === 0) {
        expect(frase).toBe('nenhuma proposta recebida');
      } else {
        expect(frase.startsWith(`${call.proposals} `), `chamada ${call.title}: frase`).toBe(true);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('(e) a fila mostra o que foi ENVIADO, com o desfecho na linha (fatia 6)', () => {
  it('recusada e retirada aparecem com o rótulo; o rascunho não; o selo conta as três', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O DEFEITO QUE ESTA FATIA CORRIGE
     * ─────────────────────────────────────────────────────────────────────────────
     *  A fatia 3 alinhou lista e contagem pelo lado de MENOS: para fazer a lista
     *  bater com a contagem antiga, passou a esconder retirada, cancelada e recusada.
     *  Mas uma proposta recusada FOI recebida — e a retirada também. O organizador
     *  perdia a informação de que o trabalho existiu, e o status é justamente o que
     *  explica por que ele não está mais no páreo.
     *
     *  A correção muda a DEFINIÇÃO (recebida = enviada), e não o filtro: a lista e o
     *  selo passam a contar as três enviadas, e o rascunho continua fora.
     */
    const chamadaId = await criarChamada({
      slug: 'fila-f74',
      title: `Chamada da fila honesta ${RUN}`,
      maxSubmissionsPerAuthor: 0,
    });

    const autores = await Promise.all([
      criarPessoa(`Autora da enviada ${RUN}`),
      criarPessoa(`Autora da recusada ${RUN}`),
      criarPessoa(`Autora da retirada ${RUN}`),
      criarPessoa(`Autora do rascunho fora da fila ${RUN}`),
    ]);
    const [autoraEnviada, autoraRecusada, autoraRetirada, autoraRascunho] = autores;

    if (!autoraEnviada || !autoraRecusada || !autoraRetirada || !autoraRascunho) {
      throw new Error('Falha ao criar as autoras da fila.');
    }

    /** As três propostas saem pelo caminho real: criar rascunho, anexar e enviar. */
    const enviadas: { id: string; userId: string; titulo: string }[] = [];

    for (const [indice, userId] of [autoraEnviada, autoraRecusada, autoraRetirada].entries()) {
      const titulo = `Pesquisa enviada ${indice + 1} ${RUN}`;
      const tentativa = await tentarEnviar({ callId: chamadaId, userId, title: titulo });

      await anexarBlindPdf(tentativa.submissionId, userId);

      const submetida = await submitSubmission({
        tenantId,
        submissionId: tentativa.submissionId,
        userId,
      });

      expect(submetida.ok, submetida.ok ? 'ok' : submetida.message).toBe(true);

      enviadas.push({ id: tentativa.submissionId, userId, titulo });
    }

    /**
     * O status é gravado direto porque o que esta fatia mede é a LEITURA da fila; o
     * caminho que produz cada decisão tem cobertura própria (o protocolo de aceite e
     * a retirada do autor). `submittedAt` permanece: as três foram enviadas.
     */
    const recusada = enviadas[1];
    const retirada = enviadas[2];
    const enviada = enviadas[0];
    if (!enviada || !recusada || !retirada) throw new Error('Faltou uma proposta enviada.');

    const rascunhoId = randomUUID();

    await withTenant(tenantId, async (tx) => {
      await tx.submission.update({ where: { id: recusada.id }, data: { status: 'REJECTED' } });
      await tx.submission.update({ where: { id: retirada.id }, data: { status: 'WITHDRAWN' } });

      // O rascunho de quem NUNCA enviou — o que a fila tem de continuar escondendo.
      await tx.submission.create({
        data: {
          id: rascunhoId,
          tenantId,
          eventId,
          callId: chamadaId,
          submittedById: autoraRascunho,
          protocol: `F74-DRAFT-${RUN}`,
          title: `Trabalho que ninguém enviou ${RUN}`,
          abstract: ABSTRACT,
          keywords: ['rascunho'],
          language: 'pt-BR',
          status: 'DRAFT',
        },
      });
    });

    const propostas = await propostasDaChamada(chamadaId);

    // ── A LISTA: as três enviadas, com o desfecho em português ──────────────────
    expect(propostas).toHaveLength(3);
    expect(propostas.map((row) => row.id)).not.toContain(rascunhoId);

    const porId = new Map(propostas.map((row) => [row.id, row]));
    expect(porId.get(recusada.id)).toMatchObject({ status: 'REJECTED', statusLabel: 'Rejeitada' });
    expect(porId.get(retirada.id)).toMatchObject({ status: 'WITHDRAWN', statusLabel: 'Retirada' });
    expect(porId.get(enviada.id)).toMatchObject({ status: 'SUBMITTED', statusLabel: 'Enviada' });

    // ── O SELO: o MESMO número da lista (a catraca da F54) ──────────────────────
    const chamada = await chamadaDoPainel(chamadaId);

    expect(chamada.proposals).toBe(3);
    expect(chamada.proposals).toBe(propostas.length);
    expect(receivedProposalsLabel(chamada.proposals)).toBe('3 propostas recebidas');
    // O rascunho não é "trabalho em andamento" porque está VAZIO — é resto de tentativa.
    expect(chamada.proposalsInProgress).toBe(0);

    // E o banco confirma os quatro: três enviados, um rascunho.
    const doBanco = await submissoesDaChamada(chamadaId);
    expect(doBanco).toHaveLength(4);
    expect(doBanco.filter((row) => row.status === 'DRAFT')).toHaveLength(1);
  });
});
// ═══════════════════════════════════════════════════════════════════════════════
describe('(f) a exclusão da chamada também não chama rascunho de proposta recebida', () => {
  it('recusa apagando a chamada com o motivo certo — e o painel continua dizendo zero', async () => {
    /**
     * A exclusão é recusada quando existe QUALQUER submissão: apagar a chamada
     * deixaria o rascunho do autor sem o endereço onde ele foi começado (é para lá
     * que a tela manda a pessoa depois de uma recusa de prontidão). O que não podia
     * continuar era a MENSAGEM dizendo "já recebeu 1 proposta" para uma chamada que
     * o painel anuncia como "nenhuma proposta recebida" — a mentira só mudaria de
     * lugar.
     */
    const chamadaId = await criarChamada({
      slug: 'exclusao-f74',
      title: `Chamada só com rascunho ${RUN}`,
      maxSubmissionsPerAuthor: 0,
    });

    const autoraId = await criarPessoa(`Autora da exclusão ${RUN}`);

    await tentarEnviar({
      callId: chamadaId,
      userId: autoraId,
      title: 'Trabalho começado e nunca enviado',
    });

    const chamada = await chamadaDoPainel(chamadaId);
    expect(chamada.proposals).toBe(0);

    const removida = await deleteCall({
      tenantId,
      eventId,
      callId: chamadaId,
      actorId: organizerId,
    });

    expect(removida.ok).toBe(false);
    if (removida.ok) return;

    expect(removida.code).toBe('INVALID_INPUT');
    expect(removida.message).toMatch(/rascunho/i);
    /** A palavra que mentia: a chamada NÃO recebeu proposta nenhuma. */
    expect(removida.message).not.toMatch(/recebeu/i);
    expect(removida.message).toContain('Despublique');

    // E nada foi apagado: a chamada e o rascunho continuam no banco.
    const aindaExiste = await chamadaDoPainel(chamadaId);
    expect(aindaExiste.id).toBe(chamadaId);
    expect(await submissoesDaChamada(chamadaId, autoraId)).toHaveLength(1);
  });
});
