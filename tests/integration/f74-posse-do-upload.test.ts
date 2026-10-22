/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE DE INTEGRAÇÃO — A POSSE DO UPLOAD (FASE 74 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO (E O STORAGE) DE VERDADE PROVAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `submission:update:own` autoriza a PESSOA, não o ALVO: a guarda da action passa
 *  o `ownerId` da sessão, e antes desta fatia nenhum caminho comparava com o
 *  `submittedById` da submissão. Quem tinha a permissão no tenant anexava (ou
 *  trocava) arquivo na submissão de outra pessoa conhecendo o UUID.
 *
 *  Este arquivo percorre a matriz inteira pelo caminho REAL — as Server Actions,
 *  com o RBAC de verdade (`loadPrincipal` lê as concessões sob RLS), o banco de
 *  verdade e o MinIO de verdade:
 *
 *    (a) o DONO anexa: pré-assinada + confirmação funcionam e o arquivo fica
 *        `isCurrent`;
 *    (b) OUTRA PESSOA do mesmo tenant não anexa: as duas etapas recusam com
 *        `NOT_OWNER`, NADA é gravado e a submissão do dono fica intacta — mesmo
 *        checksum, mesmo `isCurrent`, mesma contagem;
 *    (c) SEM SESSÃO continua recusando como hoje (`NOT_AUTHENTICATED`);
 *    (d) INEXISTENTE e de OUTRO TENANT seguem `NOT_FOUND`, com a MESMA resposta —
 *        e quem não tem vínculo com a instituição recebe a MESMA recusa para os
 *        dois, para a porta não virar oráculo de existência.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A SESSÃO É SUBSTITUÍDA; O RESTO NÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `getAuthenticatedUser` lê o cookie do Better Auth, que não existe fora de uma
 *  requisição do Next — então só ele é trocado por um dublê. O RBAC, a RLS, a
 *  quota e a conferência de integridade rodam de verdade.
 *
 *  O serviço também é chamado DIRETAMENTE em dois casos: a conferência de posse
 *  vive nele, e um teste que só passasse pela action não provaria que a porta dos
 *  fundos está fechada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  confirmUpload,
  createSubmission,
  requestUpload,
} from '../../src/lib/review/submission-service';
import {
  BUCKETS,
  buildObjectKey,
  createUploadUrl,
  inspectObject,
} from '../../src/lib/storage/s3-client';

/**
 * A sessão do caso — `vi.hoisted` porque o dublê é içado para antes das
 * declarações do arquivo.
 */
const sessao = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock('../../src/lib/auth/session', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/auth/session')>();

  return {
    ...real,
    getAuthenticatedUser: async () =>
      sessao.userId === null
        ? null
        : {
            id: sessao.userId,
            name: 'Pessoa do teste',
            email: `${sessao.userId}@exemplo.test`,
            image: null,
            publicHandle: null,
            emailVerified: true,
          },
  };
});

/** `revalidatePath` só existe dentro de uma requisição do Next — e não é o assunto. */
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { confirmUploadAction, requestUploadAction } = await import(
  '../../src/app/actions/review-actions'
);

const RUN = randomUUID().slice(0, 8);

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
);
const CHECKSUM = createHash('sha256').update(PDF).digest('hex');
const MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d];
/** Checksum deliberadamente ERRADO: se a posse não barrar, este valor apaga o objeto. */
const CHECKSUM_ERRADO = 'e'.repeat(64);

type KindDoTeste = 'BLIND_PDF' | 'IDENTIFIED_PDF' | 'SUPPLEMENTARY';

interface Ticket {
  uploadUrl: string;
  objectKey: string;
  bucket: string;
  requiredHeaders: Record<string, string>;
  version: number;
}

interface ArquivoDoBanco {
  kind: string;
  checksum: string;
  isCurrent: boolean;
  version: number;
  uploadedById: string | null;
}

let tenantAId: string;
let tenantASlug: string;
let tenantBId: string;
let eventAId: string;
let eventBId: string;
let trackAId: string;

/** Dono da submissão em A. */
let dono: string;
/** Pessoa de A que NÃO é dona da submissão — tem `submission:update:own`. */
let intruso: string;
/** Dono da submissão de B (para o caso "outro tenant"). */
let donoB: string;

let submissaoDoDono: string;
let submissaoDeOutroTenant: string;

// ───────────────────────────────────────────────────────────────────────────────
//  Fixtures
// ───────────────────────────────────────────────────────────────────────────────
async function criarPessoa(input: {
  tenantId: string;
  nome: string;
}): Promise<string> {
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

function formularioDePedido(input: {
  submissionId: string;
  kind: KindDoTeste;
}): FormData {
  const data = new FormData();

  data.set('tenantSlug', tenantASlug);
  data.set('submissionId', input.submissionId);
  data.set('kind', input.kind);
  data.set('fileName', `${input.kind.toLowerCase()}.pdf`);
  data.set('mimeType', 'application/pdf');
  data.set('sizeBytes', String(PDF.length));
  data.set('checksum', CHECKSUM);
  data.set('magicBytes', MAGIC_BYTES.join(','));

  return data;
}

function formularioDeConfirmacao(input: {
  submissionId: string;
  kind: KindDoTeste;
  ticket: Ticket;
  checksum?: string;
}): FormData {
  const data = new FormData();

  data.set('tenantSlug', tenantASlug);
  data.set('submissionId', input.submissionId);
  data.set('kind', input.kind);
  data.set('objectKey', input.ticket.objectKey);
  data.set('bucket', input.ticket.bucket);
  data.set('fileName', `${input.kind.toLowerCase()}.pdf`);
  data.set('mimeType', 'application/pdf');
  data.set('sizeBytes', String(PDF.length));
  data.set('checksum', input.checksum ?? CHECKSUM);
  data.set('version', String(input.ticket.version));

  return data;
}

function ticketDe(resultado: { data?: Record<string, unknown> }): Ticket {
  const data = resultado.data;

  if (!data) {
    throw new Error('A pré-assinada não devolveu os dados do ticket.');
  }

  return {
    uploadUrl: String(data.uploadUrl),
    objectKey: String(data.objectKey),
    bucket: String(data.bucket),
    requiredHeaders: data.requiredHeaders as Record<string, string>,
    version: Number(data.version),
  };
}

/** Sobe os bytes no storage pelo caminho assinado — é o navegador do caso. */
async function enviarAoStorage(ticket: Ticket): Promise<void> {
  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.requiredHeaders,
    body: PDF,
  });

  if (!put.ok) throw new Error(`PUT falhou: HTTP ${put.status}`);
}

/** O estado DURÁVEL da submissão: é contra ele que a recusa é medida. */
async function arquivosDaSubmissao(submissionId: string): Promise<ArquivoDoBanco[]> {
  return withTenant(tenantAId, (tx) =>
    tx.submissionFile.findMany({
      where: { submissionId },
      orderBy: [{ kind: 'asc' }, { version: 'asc' }],
      select: {
        kind: true,
        checksum: true,
        isCurrent: true,
        version: true,
        uploadedById: true,
      },
    }),
  );
}

beforeAll(async () => {
  tenantAId = randomUUID();
  tenantBId = randomUUID();
  tenantASlug = `f74-${RUN}`;
  eventAId = randomUUID();
  eventBId = randomUUID();
  trackAId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantAId,
        slug: tenantASlug,
        name: `Instituição da Posse ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: 'America/Bahia',
      },
      {
        id: tenantBId,
        slug: `f74-vizinha-${RUN}`,
        name: `Instituição Vizinha ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: 'America/Bahia',
      },
    ],
  });

  dono = await criarPessoa({ tenantId: tenantAId, nome: 'Autora F74' });
  intruso = await criarPessoa({ tenantId: tenantAId, nome: 'Outra Pessoa F74' });
  donoB = await criarPessoa({ tenantId: tenantBId, nome: 'Autora da Vizinha F74' });

  const startsAt = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantAId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventAId,
        tenantId: tenantAId,
        slug: `evento-f74-${RUN}`,
        title: 'Seminário da Posse do Upload',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.track.create({
      data: {
        id: trackAId,
        tenantId: tenantAId,
        eventId: eventAId,
        slug: 'trilha-f74',
        name: 'Trilha da Posse',
        requiresBlindReview: true,
        requiredReviews: 2,
        maxSubmissionsPerAuthor: 0,
      },
    });
  });

  await withTenant(tenantBId, (tx) =>
    tx.event.create({
      data: {
        id: eventBId,
        tenantId: tenantBId,
        slug: `evento-f74-vizinho-${RUN}`,
        title: 'Evento da Instituição Vizinha',
        status: 'REGISTRATION_OPEN',
        modality: 'ONLINE',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    }),
  );

  const criada = await createSubmission({
    tenantId: tenantAId,
    eventId: eventAId,
    trackId: trackAId,
    userId: dono,
    title: 'A posse do upload na submissão de outra pessoa',
    abstract:
      'Este resumo existe para a submissão ser real e poder receber arquivos no teste de integração da FASE 74. Ele descreve, sem rodeios, o furo que a fatia fecha: quem tem a permissão de editar a própria submissão podia anexar um arquivo na submissão de outra pessoa apenas conhecendo o UUID do alvo.',
    keywords: ['segurança', 'posse', 'upload'],
  });

  if (!criada.ok) throw new Error(`Falha ao criar a submissão: ${criada.message}`);
  submissaoDoDono = criada.id;

  submissaoDeOutroTenant = randomUUID();

  await withTenant(tenantBId, (tx) =>
    tx.submission.create({
      data: {
        id: submissaoDeOutroTenant,
        tenantId: tenantBId,
        eventId: eventBId,
        protocol: `F74-${RUN}`.slice(0, 20),
        title: 'Trabalho da instituição vizinha',
        abstract: 'Resumo.',
        status: 'DRAFT',
        submittedById: donoB,
      },
    }),
  );
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('(a) o dono anexa', () => {
  it('a pré-assinada e a confirmação funcionam e o arquivo fica isCurrent', async () => {
    sessao.userId = dono;

    const pedido = await requestUploadAction(
      null,
      formularioDePedido({ submissionId: submissaoDoDono, kind: 'BLIND_PDF' }),
    );

    expect(pedido.ok).toBe(true);

    const ticket = ticketDe(pedido);
    expect(ticket.objectKey).toContain(submissaoDoDono);
    expect(ticket.version).toBe(1);

    await enviarAoStorage(ticket);

    const confirmacao = await confirmUploadAction(
      null,
      formularioDeConfirmacao({
        submissionId: submissaoDoDono,
        kind: 'BLIND_PDF',
        ticket,
      }),
    );

    expect(confirmacao.ok).toBe(true);
    expect(confirmacao.data?.checksum).toBe(CHECKSUM);
    expect(confirmacao.data?.fileId).toEqual(expect.any(String));

    const arquivos = await arquivosDaSubmissao(submissaoDoDono);
    const cego = arquivos.find((arquivo) => arquivo.kind === 'BLIND_PDF');

    expect(cego).toEqual({
      kind: 'BLIND_PDF',
      checksum: CHECKSUM,
      isCurrent: true,
      version: 1,
      uploadedById: dono,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('(b) outra pessoa não anexa', () => {
  it('as duas etapas recusam com NOT_OWNER e a submissão do dono fica intacta', async () => {
    const antes = await arquivosDaSubmissao(submissaoDoDono);
    const antesCru = JSON.stringify(antes);

    /**
     * O objeto é preparado FORA da submissão do dono — como se o intruso tivesse
     * conseguido os bytes. Ele existe no bucket e tem o checksum correto; tudo o
     * que o impede de virar artefato é a conferência de posse.
     */
    const bucket = BUCKETS.submissions();
    const objectKey = buildObjectKey({
      tenantId: tenantAId,
      eventId: eventAId,
      submissionId: submissaoDoDono,
      kind: 'IDENTIFIED_PDF',
      version: 1,
      fileName: 'identificado.pdf',
    });
    const ticketDoObjeto = await createUploadUrl({
      bucket,
      objectKey,
      contentType: 'application/pdf',
      contentLength: PDF.length,
      checksumSha256: CHECKSUM,
    });

    await enviarAoStorage({
      uploadUrl: ticketDoObjeto.uploadUrl,
      objectKey: ticketDoObjeto.objectKey,
      bucket: ticketDoObjeto.bucket,
      requiredHeaders: ticketDoObjeto.requiredHeaders,
      version: 1,
    });

    sessao.userId = intruso;

    // ── Etapa 1: a pré-assinada não é concedida ──────────────────────────────
    const pedido = await requestUploadAction(
      null,
      formularioDePedido({ submissionId: submissaoDoDono, kind: 'IDENTIFIED_PDF' }),
    );

    expect(pedido.ok).toBe(false);
    expect(pedido.code).toBe('NOT_OWNER');
    expect(pedido.message).toBe('Esta submissão não é sua.');

    const ticket: Ticket = {
      uploadUrl: ticketDoObjeto.uploadUrl,
      objectKey: ticketDoObjeto.objectKey,
      bucket: ticketDoObjeto.bucket,
      requiredHeaders: ticketDoObjeto.requiredHeaders,
      version: 1,
    };

    // ── Etapa 3: a confirmação também recusa (é ela que grava `isCurrent`) ───
    const confirmacao = await confirmUploadAction(
      null,
      formularioDeConfirmacao({
        submissionId: submissaoDoDono,
        kind: 'IDENTIFIED_PDF',
        ticket,
      }),
    );

    expect(confirmacao.ok).toBe(false);
    expect(confirmacao.code).toBe('NOT_OWNER');
    expect(confirmacao.message).toBe('Esta submissão não é sua.');

    /**
     * O CHECKSUM ERRADO é a prova de que a posse vem ANTES da inspeção: sem ela,
     * este mesmo pedido cairia em `INTEGRITY_FAILED` e APAGARIA o objeto.
     */
    const confirmacaoComChecksumErrado = await confirmUploadAction(
      null,
      formularioDeConfirmacao({
        submissionId: submissaoDoDono,
        kind: 'IDENTIFIED_PDF',
        ticket,
        checksum: CHECKSUM_ERRADO,
      }),
    );

    expect(confirmacaoComChecksumErrado.ok).toBe(false);
    expect(confirmacaoComChecksumErrado.code).toBe('NOT_OWNER');

    const objetoAindaExiste = await inspectObject(bucket, objectKey);
    expect(objetoAindaExiste.exists).toBe(true);

    // ── O SERVIÇO direto (a porta dos fundos) também recusa ─────────────────
    const pedidoNoServico = await requestUpload({
      tenantId: tenantAId,
      submissionId: submissaoDoDono,
      userId: intruso,
      kind: 'SUPPLEMENTARY',
      fileName: 'suplementar.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      checksum: CHECKSUM,
      magicBytes: MAGIC_BYTES,
    });

    expect(pedidoNoServico.ok).toBe(false);
    if (!pedidoNoServico.ok) {
      expect(pedidoNoServico.code).toBe('NOT_OWNER');
      expect(pedidoNoServico.message).toBe('Esta submissão não é sua.');
    }

    const confirmacaoNoServico = await confirmUpload({
      tenantId: tenantAId,
      submissionId: submissaoDoDono,
      userId: intruso,
      kind: 'IDENTIFIED_PDF',
      objectKey,
      bucket,
      fileName: 'identificado.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      checksum: CHECKSUM,
      version: 1,
    });

    expect(confirmacaoNoServico.ok).toBe(false);
    if (!confirmacaoNoServico.ok) {
      expect(confirmacaoNoServico.code).toBe('NOT_OWNER');
    }

    // ── NADA foi gravado, e o objeto nem foi tocado ─────────────────────────
    const depois = await arquivosDaSubmissao(submissaoDoDono);
    expect(JSON.stringify(depois)).toBe(antesCru);
    expect(depois).toHaveLength(antes.length);
    expect(await inspectObject(bucket, objectKey)).toMatchObject({ exists: true });

    /**
     * O dono confirma o MESMO objeto que o intruso tentou: ele estava intacto.
     * É a prova de que a recusa não deixou o alvo pela metade (objeto apagado,
     * banco sem linha, ou linha marcada como não-corrente).
     */
    sessao.userId = dono;

    const confirmacaoDoDono = await confirmUploadAction(
      null,
      formularioDeConfirmacao({
        submissionId: submissaoDoDono,
        kind: 'IDENTIFIED_PDF',
        ticket,
      }),
    );

    expect(confirmacaoDoDono.ok).toBe(true);

    const final = await arquivosDaSubmissao(submissaoDoDono);
    expect(final).toHaveLength(antes.length + 1);

    const cego = final.find((arquivo) => arquivo.kind === 'BLIND_PDF');
    expect(cego).toEqual({
      kind: 'BLIND_PDF',
      checksum: CHECKSUM,
      isCurrent: true,
      version: 1,
      uploadedById: dono,
    });

    const identificado = final.find((arquivo) => arquivo.kind === 'IDENTIFIED_PDF');
    expect(identificado).toEqual({
      kind: 'IDENTIFIED_PDF',
      checksum: CHECKSUM,
      isCurrent: true,
      version: 1,
      uploadedById: dono,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('(c) sem sessão', () => {
  it('continua recusando com NOT_AUTHENTICATED, sem tocar na submissão', async () => {
    sessao.userId = null;

    const antes = JSON.stringify(await arquivosDaSubmissao(submissaoDoDono));

    const pedido = await requestUploadAction(
      null,
      formularioDePedido({ submissionId: submissaoDoDono, kind: 'SUPPLEMENTARY' }),
    );

    expect(pedido.ok).toBe(false);
    expect(pedido.code).toBe('NOT_AUTHENTICATED');

    const ticket: Ticket = {
      uploadUrl: 'http://exemplo.invalido/nao-usado',
      objectKey: 'nao-usado',
      bucket: 'nao-usado',
      requiredHeaders: {},
      version: 1,
    };

    const confirmacao = await confirmUploadAction(
      null,
      formularioDeConfirmacao({
        submissionId: submissaoDoDono,
        kind: 'SUPPLEMENTARY',
        ticket,
      }),
    );

    expect(confirmacao.ok).toBe(false);
    expect(confirmacao.code).toBe('NOT_AUTHENTICATED');

    expect(JSON.stringify(await arquivosDaSubmissao(submissaoDoDono))).toBe(antes);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('(d) inexistente e outro tenant', () => {
  it('respondem NOT_FOUND com a MESMA resposta, e nada é gravado', async () => {
    const antesDono = JSON.stringify(await arquivosDaSubmissao(submissaoDoDono));
    const antesVizinho = JSON.stringify(
      await withTenant(tenantBId, (tx) =>
        tx.submissionFile.findMany({
          where: { submissionId: submissaoDeOutroTenant },
          select: { id: true },
        }),
      ),
    );

    const inexistente = randomUUID();

    /** Pessoa de A: tem vínculo e permissão — o que falta é o alvo existir em A. */
    sessao.userId = intruso;

    const pedidoInexistente = await requestUploadAction(
      null,
      formularioDePedido({ submissionId: inexistente, kind: 'BLIND_PDF' }),
    );

    const pedidoDeOutroTenant = await requestUploadAction(
      null,
      formularioDePedido({ submissionId: submissaoDeOutroTenant, kind: 'BLIND_PDF' }),
    );

    expect(pedidoInexistente).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Submissão não encontrada.',
    });
    expect(pedidoDeOutroTenant).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Submissão não encontrada.',
    });

    /**
     * A resposta para "não existe" e para "é de outra instituição" é IDÊNTICA:
     * a RLS esconde a linha alheia antes de qualquer comparação de posse, então
     * a porta não vira oráculo de existência.
     */
    expect(pedidoDeOutroTenant).toEqual(pedidoInexistente);

    const ticket: Ticket = {
      uploadUrl: 'http://exemplo.invalido/nao-usado',
      objectKey: 'nao-usado',
      bucket: 'nao-usado',
      requiredHeaders: {},
      version: 1,
    };

    const confirmacaoInexistente = await confirmUploadAction(
      null,
      formularioDeConfirmacao({ submissionId: inexistente, kind: 'BLIND_PDF', ticket }),
    );

    const confirmacaoDeOutroTenant = await confirmUploadAction(
      null,
      formularioDeConfirmacao({
        submissionId: submissaoDeOutroTenant,
        kind: 'BLIND_PDF',
        ticket,
      }),
    );

    expect(confirmacaoInexistente).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Submissão não encontrada.',
    });
    expect(confirmacaoDeOutroTenant).toEqual(confirmacaoInexistente);

    expect(JSON.stringify(await arquivosDaSubmissao(submissaoDoDono))).toBe(antesDono);
    expect(
      JSON.stringify(
        await withTenant(tenantBId, (tx) =>
          tx.submissionFile.findMany({
            where: { submissionId: submissaoDeOutroTenant },
            select: { id: true },
          }),
        ),
      ),
    ).toBe(antesVizinho);
  });

  it('quem não tem vínculo recebe a MESMA recusa para o alvo existente e para o inexistente', async () => {
    /**
     * A dona da instituição vizinha não tem vínculo com A: a guarda recusa antes
     * de o alvo ser lido — logo, ela não descobre se o UUID existe.
     */
    sessao.userId = donoB;

    const comAlvoExistente = await requestUploadAction(
      null,
      formularioDePedido({ submissionId: submissaoDoDono, kind: 'BLIND_PDF' }),
    );

    const comAlvoInexistente = await requestUploadAction(
      null,
      formularioDePedido({ submissionId: randomUUID(), kind: 'BLIND_PDF' }),
    );

    expect(comAlvoExistente).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(comAlvoInexistente).toEqual(comAlvoExistente);
  });
});
