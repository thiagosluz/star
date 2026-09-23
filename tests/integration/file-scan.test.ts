/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Inspeção antivírus (FASE 36, dívida A3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM clamd FALSO AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O que esta fase precisa provar não é "o ClamAV funciona" — é que o SISTEMA
 *  pergunta a ele direito e faz a coisa certa com a resposta. Um servidor TCP de
 *  vinte linhas que fala o protocolo (`zINSTREAM` + blocos com tamanho + terminador)
 *  prova as duas metades: o enquadramento que enviamos e a decisão que tomamos com
 *  cada veredito. Subir a imagem real traria 1 GB de assinaturas para provar a mesma
 *  coisa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • o arquivo NASCE `PENDING` com a inspeção ligada e `SKIPPED` desligada — e
 *    `SKIPPED` é servido, porque "não inspecionado" não é "limpo";
 *  • com a inspeção ligada, `PENDING` NÃO é servido (é a promessa do pedido);
 *  • `INFECTED` não é servido NUNCA — nem depois de desligar o antivírus;
 *  • a passada transforma `PENDING` em veredito, e a ameaça vai para a TRILHA;
 *  • clamd fora do ar NÃO é veredito: o arquivo continua `PENDING` para a próxima
 *    passada (indisponibilidade não vira recusa de acesso para quem não fez nada).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { createSubmission } from '../../src/lib/review/submission-service';
import { confirmUpload, getFileDownloadUrl } from '../../src/lib/review/submission-service';
import { createUploadUrl } from '../../src/lib/storage/s3-client';
import { runFileScan } from '../../src/lib/review/file-scan-service';

const RUN = randomUUID().slice(0, 8);
const BUCKET = process.env.S3_BUCKET_SUBMISSIONS ?? 'eventflow-submissions';
const PDF = Buffer.from('%PDF-1.7\nconteúdo de teste da inspeção\n%%EOF\n', 'utf8');
const CHECKSUM = createHash('sha256').update(PDF).digest('hex');

let tenantId: string;
let eventId: string;
let trackId: string;
let authorId: string;
let submissionId: string;

const originalScanEnv = {
  SCAN_DRIVER: process.env.SCAN_DRIVER,
  CLAMAV_HOST: process.env.CLAMAV_HOST,
  CLAMAV_PORT: process.env.CLAMAV_PORT,
};

/** Liga e desliga a inspeção para o teste — é `process.env` que o serviço lê. */
function setScanning(enabled: boolean, port?: number): void {
  if (enabled) {
    process.env.SCAN_DRIVER = 'clamav';
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = String(port ?? 0);
    return;
  }

  delete process.env.SCAN_DRIVER;
  delete process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_PORT;
}

// ───────────────────────────────────────────────────────────────────────────────
//  clamd falso — fala o protocolo de verdade
// ───────────────────────────────────────────────────────────────────────────────
interface FakeClamd {
  port: number;
  /** Tudo o que o cliente enviou no corpo do INSTREAM (para conferir o conteúdo). */
  received: () => Buffer;
  close: () => Promise<void>;
}

/**
 * Sobe um servidor que responde o veredito pedido.
 *
 * O enquadramento é lido como o clamd lê: primeiro o nome do comando terminado em
 * NUL, depois blocos `<4 bytes big-endian><dados>` até um bloco de tamanho zero.
 * Se o cliente errar o enquadramento, o servidor nunca responde e o teste estoura no
 * tempo limite — que é exatamente o defeito que se quer pegar.
 */
async function startFakeClamd(verdict: string): Promise<FakeClamd> {
  const state = { received: Buffer.alloc(0) };

  const server: Server = createServer((socket: Socket) => {
    let buffer = Buffer.alloc(0);
    let commandRead = false;

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!commandRead) {
        const end = buffer.indexOf(0);

        if (end === -1) return;

        const command = buffer.subarray(0, end).toString('utf8');
        if (command !== 'zINSTREAM') {
          socket.end('UNKNOWN COMMAND\0');
          return;
        }

        buffer = buffer.subarray(end + 1);
        commandRead = true;
      }

      for (;;) {
        if (buffer.length < 4) return;

        const size = buffer.readUInt32BE(0);

        if (size === 0) {
          socket.end(verdict);
          return;
        }

        if (buffer.length < 4 + size) return;

        state.received = Buffer.concat([state.received, buffer.subarray(4, 4 + size)]);
        buffer = buffer.subarray(4 + size);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    port,
    received: () => state.received,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Fixtures — pelo caminho REAL (upload assinado + confirmação)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Cada envio é uma VERSÃO nova do mesmo tipo de arquivo — o índice único da tabela é
 * `(submissionId, kind, version)`, e reenviar o mesmo `kind` com a mesma versão é
 * exatamente o que ele existe para impedir.
 */
let uploadCount = 0;

async function uploadPdf(name: string): Promise<string> {
  uploadCount += 1;
  const objectKey = `tenants/${tenantId}/eventos/${eventId}/f36/${RUN}-${name}`;

  const ticket = await createUploadUrl({
    bucket: BUCKET,
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
    kind: 'BLIND_PDF',
    objectKey,
    bucket: BUCKET,
    fileName: `${name}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: PDF.length,
    checksum: CHECKSUM,
    version: uploadCount,
  });

  if (!confirmed.ok) throw new Error(`Confirmação falhou: ${confirmed.message}`);

  return confirmed.fileId;
}

async function scanStatusOf(fileId: string): Promise<string> {
  return withTenant(tenantId, (tx) =>
    tx.submissionFile
      .findFirstOrThrow({ where: { id: fileId }, select: { scanStatus: true } })
      .then((row) => row.scanStatus),
  );
}

async function auditFor(fileId: string): Promise<{ action: string; entityType: string }[]> {
  return withTenant(tenantId, (tx) =>
    tx.auditLog.findMany({
      where: { entityId: fileId },
      select: { action: true, entityType: true },
      orderBy: { createdAt: 'desc' },
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
      slug: `f36-scan-${RUN}`,
      name: `Instituição da Inspeção ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
    },
  });

  authorId = randomUUID();
  await adminPrisma.user.create({
    data: { id: authorId, name: 'Autora F36', email: `f36.scan.${RUN}@exemplo.test` },
  });

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-scan-${RUN}`,
        title: 'Congresso da Inspeção',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: new Date(Date.now() + 30 * 86_400_000),
        endsAt: new Date(Date.now() + 32 * 86_400_000),
      },
    });

    /**
     * A trilha é obrigatória no trabalho científico (sem chamada não há eixo temático
     * por onde avaliar) — a mesma exigência do fluxo real da FASE 4.
     */
    await tx.track.create({
      data: {
        id: trackId,
        tenantId,
        eventId,
        slug: `trilha-scan-${RUN}`,
        name: 'Segurança de arquivos',
        requiresBlindReview: false,
        requiredReviews: 1,
        maxSubmissionsPerAuthor: 10,
        acceptanceThreshold: 70,
        rejectThreshold: 45,
      },
    });
  });

  const submission = await createSubmission({
    tenantId,
    eventId,
    userId: authorId,
    trackId,
    title: 'Trabalho sob inspeção',
    abstract:
      'Este resumo existe para exercitar a inspeção de arquivos enviados por terceiros, e por isso tem o comprimento mínimo exigido pela validação de conteúdo da submissão — que recusa resumos curtos demais para permitir avaliação por pares.',
    keywords: ['segurança', 'arquivos', 'inspeção'],
  });

  if (!submission.ok) throw new Error(`Falha ao criar a submissão: ${submission.message}`);

  submissionId = submission.id;
});

afterEach(() => {
  setScanning(false);
});

afterAll(async () => {
  setScanning(false);

  if (originalScanEnv.SCAN_DRIVER !== undefined) process.env.SCAN_DRIVER = originalScanEnv.SCAN_DRIVER;
  if (originalScanEnv.CLAMAV_HOST !== undefined) process.env.CLAMAV_HOST = originalScanEnv.CLAMAV_HOST;
  if (originalScanEnv.CLAMAV_PORT !== undefined) process.env.CLAMAV_PORT = originalScanEnv.CLAMAV_PORT;

  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f36.scan.${RUN}` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o arquivo nasce no estado que a inspeção permite', () => {
  it('sem inspeção: SKIPPED — e o arquivo É servido, sem ser declarado limpo', async () => {
    setScanning(false);

    const fileId = await uploadPdf('sem-inspecao');
    expect(await scanStatusOf(fileId)).toBe('SKIPPED');

    const download = await getFileDownloadUrl(tenantId, fileId, {
      role: 'CHAIR',
      isBlind: false,
    });

    expect(download.ok, download.ok ? 'ok' : download.message).toBe(true);
  });

  it('com inspeção ligada: PENDING — e o comitê NÃO recebe antes do veredito', async () => {
    setScanning(true, 1);

    const fileId = await uploadPdf('pendente');
    expect(await scanStatusOf(fileId)).toBe('PENDING');

    const download = await getFileDownloadUrl(tenantId, fileId, {
      role: 'CHAIR',
      isBlind: false,
    });

    expect(download.ok).toBe(false);
    if (!download.ok) {
      expect(download.code).toBe('FILE_SCANNING');
      expect(download.message).toContain('análise de segurança');
    }
  });
});

describe('a passada transforma PENDING em veredito', () => {
  it('veredito limpo: o arquivo passa a ser servido e o clamd recebeu os BYTES do arquivo', async () => {
    const clamd = await startFakeClamd('stream: OK\0');

    try {
      setScanning(true, clamd.port);

      const fileId = await uploadPdf('limpo');
      expect(await scanStatusOf(fileId)).toBe('PENDING');

      const result = await runFileScan({ limit: 5 });

      expect(result.clean).toBeGreaterThanOrEqual(1);
      expect(await scanStatusOf(fileId)).toBe('CLEAN');

      /**
       * O enquadramento está certo: o clamd recebeu o conteúdo do objeto, byte a byte.
       * A conferência é por CONTER (e não por igualdade) porque a passada é
       * cross-tenant: o mesmo daemon atende os arquivos pendentes de todas as
       * instituições, e o que se quer provar é que ESTE arquivo chegou inteiro. Se o
       * cabeçalho INSTREAM estivesse errado, o servidor falso nunca teria respondido e
       * o teste teria estourado no tempo limite.
       */
      expect(clamd.received().includes(PDF)).toBe(true);

      const download = await getFileDownloadUrl(tenantId, fileId, {
        role: 'CHAIR',
        isBlind: false,
      });

      expect(download.ok, download.ok ? 'ok' : download.message).toBe(true);
    } finally {
      await clamd.close();
    }
  });

  it('ameaça encontrada: INFECTED, com a assinatura na trilha, e o portão recusa', async () => {
    const clamd = await startFakeClamd('stream: Eicar-Signature FOUND\0');

    try {
      setScanning(true, clamd.port);

      const fileId = await uploadPdf('infectado');
      const result = await runFileScan({ limit: 5 });

      expect(result.infected).toBeGreaterThanOrEqual(1);

      const row = await withTenant(tenantId, (tx) =>
        tx.submissionFile.findFirstOrThrow({
          where: { id: fileId },
          select: { scanStatus: true, scanMessage: true, scannedAt: true },
        }),
      );

      expect(row.scanStatus).toBe('INFECTED');
      expect(row.scanMessage).toContain('Eicar-Signature');
      expect(row.scannedAt).toBeInstanceOf(Date);

      /** A trilha guarda o fato — é o que a instituição confere depois. */
      const audit = await auditFor(fileId);

      expect(audit.some((entry) => entry.entityType === 'SubmissionFile')).toBe(true);

      /** E o arquivo continua bloqueado MESMO com a inspeção desligada depois. */
      setScanning(false);

      const download = await getFileDownloadUrl(tenantId, fileId, {
        role: 'CHAIR',
        isBlind: false,
      });

      expect(download.ok).toBe(false);
      if (!download.ok) expect(download.code).toBe('FILE_BLOCKED');
    } finally {
      await clamd.close();
    }
  });

  it('inspeção indisponível NÃO é veredito: o arquivo continua PENDING', async () => {
    /** Porta fechada de propósito: ninguém escutando. */
    setScanning(true, 1);

    const fileId = await uploadPdf('sem-daemon');

    const result = await runFileScan({ limit: 5 });

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await scanStatusOf(fileId)).toBe('PENDING');
  });

  it('idempotência: o que já tem veredito não é inspecionado de novo', async () => {
    const clamd = await startFakeClamd('stream: OK\0');

    try {
      setScanning(true, clamd.port);

      const result = await runFileScan({ limit: 5 });

      /**
       * Só os PENDING entram na passada. Se o veredito já gravado voltasse à fila, a
       * varredura gastaria tempo reprocessando o histórico inteiro a cada 5 minutos.
       */
      const pending = await withTenant(tenantId, (tx) =>
        tx.submissionFile.count({ where: { tenantId, scanStatus: 'PENDING' } }),
      );

      expect(result.scanned).toBeGreaterThanOrEqual(1);
      expect(pending).toBe(0);
      expect(result.clean).toBeGreaterThanOrEqual(1);
    } finally {
      await clamd.close();
    }
  });
});
