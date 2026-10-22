/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE DE INTEGRAÇÃO — O ANEXO DA PROPOSTA CIENTÍFICA (FASE 74 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DESENHO ESCOLHIDO (A), MEDIDO NO BANCO DE VERDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A proposta científica NÃO se completa na página pública: o formulário grava os
 *  dados e a recusa de prontidão devolve o rascunho; o ANEXO e o ENVIO acontecem na
 *  área do autor, pela esteira que existe desde a FASE 4. Este arquivo percorre esse
 *  caminho inteiro — sem atalho:
 *
 *    1. `submitProposal` cria o rascunho e recusa por falta do PDF;
 *    2. o AUTOR pede a URL pré-assinada, sobe os bytes no MinIO de verdade e
 *       confirma — o `SubmissionFile` nasce corrente, com versão e checksum;
 *    3. `submitSubmission` passa e a proposta sai de "rascunho";
 *    4. a POSSE manda: outra pessoa do mesmo tenant não anexa no rascunho;
 *    5. repetir a confirmação do MESMO objeto não cria versão nova;
 *    6. repetir o gesto do formulário não copia o arquivo para o rascunho novo.
 *
 *  E o TETO de rascunhos com arquivo, que a fatia 3 deixou para esta: no N+1 a
 *  recusa chega com o número e o caminho; o rascunho VAZIO continua sendo reusado
 *  (é o mesmo trabalho) e excluir um abre o teto de novo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveCall, setCallPublished } from '../../src/lib/proposals/call-service';
import { submitProposal } from '../../src/lib/proposals/proposal-service';
import {
  confirmUpload,
  deleteSubmission,
  requestUpload,
  submitSubmission,
} from '../../src/lib/review/submission-service';
import { proposalReceipt } from '../../src/domain/proposals/proposal-receipt-rules';
import { canServeFile, initialScanStatus } from '../../src/domain/review/file-scan-rules';
import { isScanningEnabled } from '../../src/lib/storage/scan-service';
import { BUCKETS } from '../../src/lib/storage/s3-client';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';
const TENANT_SLUG = `f74-anexo-${RUN}`;

const now = new Date();
const opensAt = new Date(now.getTime() - 86_400_000);
const closesAt = new Date(now.getTime() + 30 * 86_400_000);

/** O resumo precisa passar do mínimo do domínio (150 caracteres). */
const ABSTRACT =
  'Este resumo existe para a proposta científica ser real: ele descreve o caminho de quem escreve o trabalho na página pública, é recusado por falta do anexo e conclui na área do autor, anexando o PDF anonimizado pela esteira de upload da instituição.';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const CHECKSUM = createHash('sha256').update(PDF).digest('hex');
const MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d];
const FILE_NAME = 'trabalho-cego.pdf';

let tenantId: string;
let eventId: string;
let trackId: string;
let organizerId: string;
let callId: string;

let autorFluxoId: string;
let autorPosseId: string;
let autorIdemId: string;
let autorTetoId: string;
let autorReusoId: string;
/** Membro do mesmo tenant que NÃO é autor de nada. */
let outroMembroId: string;

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

/** A tentativa pela página pública, como a action a faz: o serviço, com o vínculo. */
async function tentarEnviar(input: { userId: string; title: string }) {
  return submitProposal({
    tenantId,
    eventId,
    callId,
    userId: input.userId,
    title: input.title,
    abstract: ABSTRACT,
    keywords: ['proposta', 'ciência', 'anexo'],
    data: {},
    tenantSlug: TENANT_SLUG,
  });
}

/** Etapas 1 e 3 do upload, com o PUT real no MinIO — o navegador do caso. */
async function anexarPelaEsteira(input: {
  userId: string;
  submissionId: string;
  kind?: 'BLIND_PDF' | 'IDENTIFIED_PDF';
}): Promise<{ fileId: string; checksum: string; version: number }> {
  const kind = input.kind ?? 'BLIND_PDF';

  const pedido = await requestUpload({
    tenantId,
    submissionId: input.submissionId,
    userId: input.userId,
    kind,
    fileName: FILE_NAME,
    mimeType: 'application/pdf',
    sizeBytes: PDF.length,
    checksum: CHECKSUM,
    magicBytes: MAGIC_BYTES,
  });

  if (!pedido.ok) throw new Error(`A pré-assinada recusou: ${pedido.code} ${pedido.message}`);

  const put = await fetch(pedido.uploadUrl, {
    method: 'PUT',
    headers: pedido.requiredHeaders,
    body: PDF,
  });

  if (!put.ok) throw new Error(`O PUT no storage falhou: HTTP ${put.status}`);

  const confirmacao = await confirmUpload({
    tenantId,
    submissionId: input.submissionId,
    userId: input.userId,
    kind,
    objectKey: pedido.objectKey,
    bucket: pedido.bucket,
    fileName: FILE_NAME,
    mimeType: 'application/pdf',
    sizeBytes: PDF.length,
    checksum: CHECKSUM,
    version: pedido.version,
  });

  if (!confirmacao.ok) {
    throw new Error(`A confirmação recusou: ${confirmacao.code} ${confirmacao.message}`);
  }

  return confirmacao;
}

/**
 * O arquivo como o banco o guarda — é contra o estado DURÁVEL que a prova é medida.
 *
 * `scanStatus` entra porque é por ele que o portão da FASE 36 decide servir o
 * arquivo ao comitê: um upload que não passasse por ali nasceria sem estado de
 * inspeção, e o comitê veria um PDF que ninguém sabe se foi olhado.
 */
async function arquivosDaSubmissao(submissionId: string) {
  return withTenant(tenantId, (tx) =>
    tx.submissionFile.findMany({
      where: { submissionId, deletedAt: null },
      orderBy: [{ kind: 'asc' }, { version: 'asc' }],
      select: {
        kind: true,
        checksum: true,
        version: true,
        isCurrent: true,
        uploadedById: true,
        scanStatus: true,
      },
    }),
  );
}

/** Rascunhos da pessoa na chamada, com quantos arquivos cada um tem. */
async function rascunhosDaPessoa(userId: string) {
  return withTenant(tenantId, (tx) =>
    tx.submission.findMany({
      where: { tenantId, callId, submittedById: userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true, title: true, _count: { select: { files: true } } },
    }),
  );
}

/**
 * Anexa sem subir bytes: para os cenários de CONTAGEM, o que importa é o arquivo
 * existindo como o banco o guarda (`f74-rascunho-honesto` usa a mesma forma). A
 * esteira real é medida no primeiro bloco, onde ela é o assunto.
 */
async function anexarNoBanco(input: {
  submissionId: string;
  userId: string;
  checksum: string;
}): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.submissionFile.create({
      data: {
        id: randomUUID(),
        tenantId,
        submissionId: input.submissionId,
        kind: 'BLIND_PDF',
        fileName: FILE_NAME,
        mimeType: 'application/pdf',
        sizeBytes: BigInt(PDF.length),
        checksum: input.checksum,
        version: 1,
        isCurrent: true,
        storageKey: `testes/f74/${RUN}/${randomUUID()}.pdf`,
        bucket: BUCKETS.submissions(),
        uploadedById: input.userId,
      },
    }),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  trackId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição do Anexo ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  organizerId = await criarPessoa(`Organizadora F74 ${RUN}`);
  autorFluxoId = await criarPessoa(`Autora do fluxo ${RUN}`);
  autorPosseId = await criarPessoa(`Autora da posse ${RUN}`);
  autorIdemId = await criarPessoa(`Autora da idempotência ${RUN}`);
  autorTetoId = await criarPessoa(`Autora do teto ${RUN}`);
  autorReusoId = await criarPessoa(`Autora do reuso ${RUN}`);
  outroMembroId = await criarPessoa(`Outro membro ${RUN}`);

  const startsAt = new Date(now.getTime() + 30 * 86_400_000);

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f74-anexo-${RUN}`,
        title: 'Simpósio do Anexo',
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
        slug: `trilha-f74-anexo-${RUN}`,
        name: 'Pesquisa e anexo',
        requiresBlindReview: true,
        requiredReviews: 2,
      },
    });
  });

  const created = await saveCall({
    tenantId,
    eventId,
    actorId: organizerId,
    kind: 'PAPER',
    slug: `artigos-f74-anexo-${RUN}`,
    title: `Artigos completos do anexo ${RUN}`,
    opensAt,
    closesAt,
    trackId,
    /**
     * `requiresBlindReview` AUSENTE de propósito: o padrão do domínio para PAPER é
     * cego (`defaultBlindFor`), e é o caso real do relato.
     */
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

  callId = created.callId;
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o caminho A, de ponta a ponta', () => {
  it('recusa com o rascunho, o autor anexa o PDF cego pela esteira e a proposta é enviada', async () => {
    const tentativa = await tentarEnviar({
      userId: autorFluxoId,
      title: 'Vigilância do território com dados abertos',
    });

    // ── 1. A página pública não completa: o rascunho volta com a recusa ──────
    expect(tentativa.ok).toBe(false);
    if (tentativa.ok) return;

    expect(tentativa.code).toBe('NOT_READY');
    expect(tentativa.details?.join(' ')).toMatch(/revisão cega/i);
    expect(tentativa.submissionId).toEqual(expect.any(String));

    const submissionId = tentativa.submissionId;
    if (!submissionId) throw new Error('A recusa de prontidão não devolveu o rascunho.');

    expect(await arquivosDaSubmissao(submissionId)).toHaveLength(0);

    // ── 2. A área do autor: a esteira real (pré-assinada → PUT → confirmação) ─
    const confirmado = await anexarPelaEsteira({ userId: autorFluxoId, submissionId });

    expect(confirmado.checksum).toBe(CHECKSUM);
    expect(confirmado.version).toBe(1);

    const arquivos = await arquivosDaSubmissao(submissionId);

    expect(arquivos).toEqual([
      {
        kind: 'BLIND_PDF',
        checksum: CHECKSUM,
        version: 1,
        isCurrent: true,
        uploadedById: autorFluxoId,
        /**
         * O PORTÃO DA FASE 36: o arquivo nasce com o estado que a esteira decide —
         * `PENDING` com inspeção ligada, `SKIPPED` (não inspecionado) desligada. O
         * upload novo não inventa um estado nem fura o portão.
         */
        scanStatus: initialScanStatus(isScanningEnabled()),
      },
    ]);

    /** E o portão serviria este arquivo no estado em que ele nasceu. */
    const gate = canServeFile({
      status: arquivos[0]?.scanStatus,
      scanningEnabled: isScanningEnabled(),
    });

    expect(gate.ok).toBe(true);

    // ── 3. O envio passa agora que o arquivo existe ───────────────────────────
    const enviada = await submitSubmission({
      tenantId,
      submissionId,
      userId: autorFluxoId,
    });

    expect(enviada.ok, enviada.ok ? 'ok' : enviada.message).toBe(true);

    if (!enviada.ok) return;

    expect(enviada.status).toBe('SUBMITTED');
    expect(enviada.submittedAt).toBeInstanceOf(Date);

    const doBanco = await withTenant(tenantId, (tx) =>
      tx.submission.findUniqueOrThrow({
        where: { id: submissionId },
        select: {
          status: true,
          submittedAt: true,
          blindSnapshot: true,
          protocol: true,
        },
      }),
    );

    expect(doBanco.status).toBe('SUBMITTED');
    expect(doBanco.submittedAt).toBeInstanceOf(Date);
    expect(doBanco.protocol).toMatch(/^\d{4}-[A-Z0-9]{4}$/);

    /**
     * O snapshot da autoria é gravado no envio — é dele que a versão cega sai. Sem
     * ele, a revisão cega não teria de onde remover a identificação.
     */
    expect(doBanco.blindSnapshot).toBeTruthy();

    /** E a proposta deixa de ser rascunho: passa a contar como recebida. */
    expect(proposalReceipt({ status: doBanco.status, fileCount: 1 })).toBe('RECEBIDA');
  });

  it('a posse continua valendo nesse caminho: outra pessoa NÃO anexa no rascunho', async () => {
    const tentativa = await tentarEnviar({
      userId: autorPosseId,
      title: 'Pesquisa da autora da posse',
    });

    expect(tentativa.ok).toBe(false);
    if (tentativa.ok) return;

    const submissionId = tentativa.submissionId;
    if (!submissionId) throw new Error('A recusa não devolveu o rascunho.');

    const pedidoDoOutro = await requestUpload({
      tenantId,
      submissionId,
      userId: outroMembroId,
      kind: 'BLIND_PDF',
      fileName: FILE_NAME,
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      checksum: CHECKSUM,
      magicBytes: MAGIC_BYTES,
    });

    expect(pedidoDoOutro.ok).toBe(false);
    if (pedidoDoOutro.ok) return;

    expect(pedidoDoOutro.code).toBe('NOT_OWNER');

    const confirmacaoDoOutro = await confirmUpload({
      tenantId,
      submissionId,
      userId: outroMembroId,
      kind: 'BLIND_PDF',
      objectKey: `testes/f74/${RUN}/alheio.pdf`,
      bucket: BUCKETS.submissions(),
      fileName: FILE_NAME,
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      checksum: CHECKSUM,
      version: 1,
    });

    expect(confirmacaoDoOutro.ok).toBe(false);
    if (confirmacaoDoOutro.ok) return;
    expect(confirmacaoDoOutro.code).toBe('NOT_OWNER');

    /** NADA foi gravado — e o objeto alheio nem chegou a ser inspecionado. */
    expect(await arquivosDaSubmissao(submissionId)).toHaveLength(0);

    /** E o dono anexa normalmente: a recusa não deixou o rascunho pela metade. */
    await anexarPelaEsteira({ userId: autorPosseId, submissionId });

    expect(await arquivosDaSubmissao(submissionId)).toHaveLength(1);
  });

  it('repetir a confirmação do MESMO objeto não cria versão nova', async () => {
    const tentativa = await tentarEnviar({
      userId: autorIdemId,
      title: 'Pesquisa da autora da idempotência',
    });

    expect(tentativa.ok).toBe(false);
    if (tentativa.ok) return;

    const submissionId = tentativa.submissionId;
    if (!submissionId) throw new Error('A recusa não devolveu o rascunho.');

    const primeira = await anexarPelaEsteira({ userId: autorIdemId, submissionId });

    /**
     * A SEGUNDA CONFIRMAÇÃO DO MESMO OBJETO. Acontece de verdade: uma resposta de
     * rede perdida faz o navegador repetir a confirmação. O índice único
     * `(submissionId, kind, version)` faria a repetição virar erro se o serviço não
     * reconhecesse o mesmo `storageKey` — e o autor veria falha numa operação que já
     * deu certo.
     */
    const segunda = await anexarPelaEsteira({ userId: autorIdemId, submissionId });

    expect(segunda.fileId).toBe(primeira.fileId);
    expect(segunda.version).toBe(1);

    const arquivos = await arquivosDaSubmissao(submissionId);

    expect(arquivos).toHaveLength(1);
    expect(arquivos[0]).toMatchObject({
      kind: 'BLIND_PDF',
      checksum: CHECKSUM,
      version: 1,
      isCurrent: true,
    });
  });

  it('repetir o gesto do formulário cria outro rascunho, mas NÃO copia o arquivo', async () => {
    const [rascunho] = await rascunhosDaPessoa(autorIdemId);
    if (!rascunho) throw new Error('O rascunho da autora da idempotência não existe.');

    /**
     * A fatia 2 decidiu, e está certo: rascunho COM arquivo não é reaproveitado (o
     * PDF é de um trabalho específico). O que a repetição NÃO pode fazer é arrastar
     * o arquivo junto — o rascunho novo nasce vazio, e a autora decide o que anexar.
     */
    const nova = await tentarEnviar({
      userId: autorIdemId,
      title: 'Segundo trabalho da autora da idempotência',
    });

    expect(nova.ok).toBe(false);
    if (nova.ok) return;

    expect(nova.code).toBe('NOT_READY');
    expect(nova.submissionId).not.toBe(rascunho.id);

    const novoRascunho = nova.submissionId;
    if (!novoRascunho) throw new Error('A repetição não devolveu o rascunho novo.');

    const doOriginal = await arquivosDaSubmissao(rascunho.id);
    expect(doOriginal).toHaveLength(1);
    expect(doOriginal[0]).toMatchObject({ version: 1, isCurrent: true, checksum: CHECKSUM });

    const doNovo = await arquivosDaSubmissao(novoRascunho);
    expect(doNovo).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o teto de rascunhos com arquivo (o que a fatia 3 deixou para decidir aqui)', () => {
  it('no teto, a tentativa seguinte é recusada com o número e o caminho, e nada é criado', async () => {
    /**
     * CINCO trabalhos DISTINTOS começados: cada tentativa cria um rascunho novo
     * porque o anterior já tem arquivo e não é reusado (a decisão da fatia 2). Sem o
     * teto, o sexto começaria o sexto trabalho — e o armazenamento da instituição
     * (compartilhado) é que pagaria.
     */
    for (let indice = 1; indice <= 5; indice += 1) {
      const tentativa = await tentarEnviar({
        userId: autorTetoId,
        title: `Trabalho ${indice} da autora do teto`,
      });

      expect(tentativa.ok, `tentativa ${indice}`).toBe(false);
      if (tentativa.ok) return;
      expect(tentativa.code).toBe('NOT_READY');

      const submissionId = tentativa.submissionId;
      if (!submissionId) throw new Error('A recusa não devolveu o rascunho.');

      await anexarNoBanco({
        submissionId,
        userId: autorTetoId,
        checksum: createHash('sha256').update(`${RUN}-${indice}`).digest('hex'),
      });
    }

    const antes = await rascunhosDaPessoa(autorTetoId);
    expect(antes).toHaveLength(5);
    expect(antes.every((row) => row.status === 'DRAFT' && row._count.files === 1)).toBe(true);

    // ── O N+1: recusado com a mensagem do domínio ───────────────────────────────
    const sexta = await tentarEnviar({
      userId: autorTetoId,
      title: 'Sexto trabalho que o teto precisa recusar',
    });

    expect(sexta.ok).toBe(false);
    if (sexta.ok) return;

    expect(sexta.code).toBe('DRAFT_FILE_LIMIT_REACHED');
    expect(sexta.message).toContain('5');
    expect(sexta.message).toContain('rascunhos com arquivo');
    expect(sexta.details?.join(' ')).toContain('armazenamento');

    /** E NADA nasceu: a recusa acontece ANTES da escrita. */
    const depois = await rascunhosDaPessoa(autorTetoId);
    expect(depois).toHaveLength(5);

    /**
     * ── EXCLUIR UM ABRE O TETO DE NOVO ─────────────────────────────────────────
     * A mensagem manda "envie ou exclua um deles"; excluir precisa funcionar. O
     * rascunho é apagado fisicamente (decisão da FASE 4) e o arquivo sai junto pelo
     * cascade — o teto conta o que existe.
     */
    const [vitima] = depois;
    if (!vitima) throw new Error('O rascunho a excluir não existe.');

    const excluido = await deleteSubmission({
      tenantId,
      submissionId: vitima.id,
      userId: autorTetoId,
    });

    expect(excluido.ok, excluido.ok ? 'ok' : excluido.message).toBe(true);

    const destravada = await tentarEnviar({
      userId: autorTetoId,
      title: 'Trabalho que só começa depois de excluir um',
    });

    expect(destravada.ok).toBe(false);
    if (destravada.ok) return;

    expect(destravada.code).toBe('NOT_READY');
    expect(await rascunhosDaPessoa(autorTetoId)).toHaveLength(5);
  });

  it('o rascunho VAZIO é reusado e não esbarra no teto (é o mesmo trabalho)', async () => {
    /**
     * Cinco tentativas, arquivo nas quatro primeiras: quatro trabalhos em andamento e
     * UM rascunho vazio (o resto da última tentativa, que é o que a retomada usa).
     */
    let rascunhoVazio: string | null = null;

    for (let indice = 1; indice <= 5; indice += 1) {
      const tentativa = await tentarEnviar({
        userId: autorReusoId,
        title: `Tentativa ${indice} da autora do reuso`,
      });

      expect(tentativa.ok, `tentativa ${indice}`).toBe(false);
      if (tentativa.ok) return;

      const submissionId = tentativa.submissionId;
      if (!submissionId) throw new Error('A recusa não devolveu o rascunho.');

      if (indice < 5) {
        await anexarNoBanco({
          submissionId,
          userId: autorReusoId,
          checksum: createHash('sha256').update(`${RUN}-reuso-${indice}`).digest('hex'),
        });
      } else {
        rascunhoVazio = submissionId;
      }
    }

    if (!rascunhoVazio) throw new Error('O rascunho vazio da última tentativa não foi criado.');

    const antes = await rascunhosDaPessoa(autorReusoId);
    expect(antes).toHaveLength(5);
    expect(antes.filter((row) => row._count.files === 0)).toHaveLength(1);

    const retomada = await tentarEnviar({
      userId: autorReusoId,
      title: 'Retomada do rascunho que ficou vazio',
    });

    expect(retomada.ok).toBe(false);
    if (retomada.ok) return;

    /**
     * O teto NÃO aparece: a retomada é o mesmo trabalho, e o rascunho vazio é o que a
     * fatia 2 reaproveita. Se a contagem fosse de rascunhos (e não de rascunhos COM
     * arquivo), esta pessoa — que está apenas tentando enviar — ficaria travada.
     */
    expect(retomada.code).toBe('NOT_READY');
    expect(retomada.submissionId).toBe(rascunhoVazio);

    const depois = await rascunhosDaPessoa(autorReusoId);
    expect(depois).toHaveLength(5);
  });
});
