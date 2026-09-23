/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Lote de certificados em ZIP (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTÁ SOB SUSPEITA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não é a emissão do certificado (a FASE 6 prova isso em `certification.test.ts`).
 *  O que estes testes medem é o LOTE: quais certificados entram, com que nome, o que
 *  acontece com o que ainda não tem PDF, e — o caso que só aparece no dia da entrega
 *  — o que acontece quando um objeto some do bucket no meio da montagem.
 *
 *  Por isso as linhas de `certificate` nascem por fixture direta: o caminho sob
 *  suspeita é o ZIP, e passar por `requestCertificate` (que exige evento encerrado,
 *  presença apurada e credenciamento) mediria a fase 6 de novo, mais devagar.
 *  O objeto, esse é REAL: cada PDF vai ao MinIO e volta pelo mesmo `getObjectBuffer`
 *  que a rota usa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { planEventCertificateZip } from '../../src/lib/certificates/certificate-service';
import { getObjectBuffer, putObjectBuffer } from '../../src/lib/storage/s3-client';
import { buildZipChunks, zipFileName, type ZipEntry } from '../../src/lib/documents/zip-writer';

const RUN = randomUUID().slice(0, 8);
const BUCKET = process.env.S3_BUCKET_CERTIFICATES ?? 'eventflow-certificates';

let tenantId: string;
let otherTenantId: string;
let eventId: string;

/** Nomes com acento e espaço: o nome do arquivo dentro do ZIP precisa sobreviver. */
const RECIPIENTS = ['Ana Souza', 'João Conceição', 'Bruno Lima'];

/** Contrabando de barra: o nome vem do banco e NÃO pode virar caminho no ZIP. */
const HOSTILE = 'Maria ../.. Silva';

async function storePdf(key: string, label: string): Promise<Buffer> {
  const content = Buffer.from(`%PDF-1.7\ncertificado de ${label}\n%%EOF\n`, 'utf8');

  await putObjectBuffer({ bucket: BUCKET, objectKey: key, body: content, contentType: 'application/pdf' });

  return content;
}

/** Lê o ZIP inteiro e devolve as entradas — o mesmo leitor do teste unitário. */
async function readZip(buffer: Buffer): Promise<{ name: string; content: Buffer }[]> {
  const entries: ZipEntry[] = [];
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);

  for (let index = 0; index < total; index += 1) {
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;

    entries.push({ name, content: buffer.subarray(start, start + compressedSize) });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Monta o lote pela MESMA esteira da rota, pulando o que não puder ser lido. */
async function mountZip(
  plan: { bucket: string; storageKey: string; fileName: string }[],
): Promise<Buffer> {
  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const entry of plan) {
      try {
        yield { name: entry.fileName, content: await getObjectBuffer(entry.bucket, entry.storageKey) };
      } catch {
        // A rota registra e segue; aqui o silêncio é o comportamento sob teste.
      }
    }
  }

  const chunks: Buffer[] = [];

  for await (const chunk of buildZipChunks(entries())) chunks.push(chunk);

  return Buffer.concat(chunks);
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: `f36-zip-${RUN}`,
        name: `Instituição do Lote ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
      },
      {
        id: otherTenantId,
        slug: `f36-zip-vizinha-${RUN}`,
        name: `Instituição Vizinha do Lote ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
      },
    ],
  });

  await withTenant(tenantId, (tx) =>
    tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-zip-${RUN}`,
        title: 'Congresso dos Certificados',
        status: 'FINISHED',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: new Date(Date.now() - 5 * 86_400_000),
        endsAt: new Date(Date.now() - 3 * 86_400_000),
      },
    }),
  );

  /** Três certificados emitidos COM PDF, um emitido SEM (ainda gerando) e um revogado. */
  let sequence = 0;

  for (const [index, recipient] of [...RECIPIENTS, HOSTILE].entries()) {
    sequence += 1;

    const userId = randomUUID();
    const validationCode = `F36-${RUN}-${sequence}`;

    await adminPrisma.user.create({
      data: { id: userId, name: recipient, email: `f36.zip.${RUN}.${sequence}@exemplo.test` },
    });

    const key = `tenants/${tenantId}/certificados/${validationCode}.pdf`;

    await storePdf(key, recipient);

    await withTenant(tenantId, (tx) =>
      tx.certificate.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId,
          kind: 'PARTICIPATION',
          status: 'ISSUED',
          validationCode,
          title: 'Certificado de participação',
          recipientName: recipient,
          bodyText: 'Certificamos a participação no evento.',
          workloadMinutes: 480,
          issuedAt: new Date(Date.now() - 86_400_000),
          storageKey: key,
          bucket: BUCKET,
          mimeType: 'application/pdf',
          sizeBytes: 100,
        },
      }),
    );

    /** O último fica `GENERATING`: emitido, mas sem PDF ainda. */
    if (index === RECIPIENTS.length - 1) {
      const pendingUser = randomUUID();

      await adminPrisma.user.create({
        data: {
          id: pendingUser,
          name: 'Carla Pendente',
          email: `f36.zip.${RUN}.pendente@exemplo.test`,
        },
      });

      await withTenant(tenantId, (tx) =>
        tx.certificate.create({
          data: {
            id: randomUUID(),
            tenantId,
            eventId,
            userId: pendingUser,
            kind: 'PARTICIPATION',
            status: 'GENERATING',
            validationCode: `F36-${RUN}-PENDENTE`,
            title: 'Certificado de participação',
            recipientName: 'Carla Pendente',
            bodyText: 'Aguardando geração.',
            workloadMinutes: 480,
            storageKey: null,
            bucket: null,
          },
        }),
      );
    }
  }

  /** Um certificado REVOGADO: continua `ISSUED` no banco, mas não vai ao lote. */
  const revokedUser = randomUUID();

  await adminPrisma.user.create({
    data: { id: revokedUser, name: 'Diego Revogado', email: `f36.zip.${RUN}.revogado@exemplo.test` },
  });

  await withTenant(tenantId, (tx) =>
    tx.certificate.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        userId: revokedUser,
        kind: 'PARTICIPATION',
        status: 'REVOKED',
        validationCode: `F36-${RUN}-REVOGADO`,
        title: 'Certificado de participação',
        recipientName: 'Diego Revogado',
        bodyText: 'Certificado revogado.',
        workloadMinutes: 480,
        storageKey: `tenants/${tenantId}/certificados/revogado.pdf`,
        bucket: BUCKET,
      },
    }),
  );
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f36.zip.${RUN}` } } });
});

describe('plano do lote', () => {
  it('inclui os emitidos com PDF, conta os que ficaram de fora e ignora outro evento', async () => {
    const plan = await planEventCertificateZip({ tenantId, eventId });

    expect(plan.ok, plan.ok ? 'ok' : plan.message).toBe(true);
    if (!plan.ok) return;

    /** Os quatro com PDF (três nomes + o nome hostil). O revogado não entra. */
    expect(plan.entries).toHaveLength(4);
    expect(plan.pending).toBe(1);
    expect(plan.eventTitle).toBe('Congresso dos Certificados');
    expect(plan.eventSlug).toBe(`evento-zip-${RUN}`);

    expect(plan.entries.some((entry) => entry.storageKey.includes('REVOGADO'))).toBe(false);
  });

  it('o nome do arquivo é o código de validação + o nome da pessoa, sem acento', async () => {
    const plan = await planEventCertificateZip({ tenantId, eventId });
    if (!plan.ok) throw new Error(plan.message);

    const names = plan.entries.map((entry) => entry.fileName);

    expect(names).toContain(`F36-${RUN}-2-joao-conceicao.pdf`);
    expect(names.some((name) => name.startsWith(`F36-${RUN}-1-`))).toBe(true);

    /**
     * O código vem PRIMEIRO porque é ele que a instituição usa para localizar o
     * documento; o nome é o que confirma que é a pessoa certa.
     */
    for (const entry of plan.entries) {
      expect(entry.fileName.startsWith('F36-')).toBe(true);
      expect(entry.fileName.endsWith('.pdf')).toBe(true);
    }
  });

  it('a RLS responde "não encontrado" para o evento da instituição vizinha', async () => {
    const plan = await planEventCertificateZip({ tenantId: otherTenantId, eventId });

    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.code).toBe('NOT_FOUND');
  });

  it('evento sem certificado emitido diz o que falta, em vez de entregar um ZIP vazio', async () => {
    const emptyEventId = randomUUID();

    await withTenant(tenantId, (tx) =>
      tx.event.create({
        data: {
          id: emptyEventId,
          tenantId,
          slug: `evento-zip-vazio-${RUN}`,
          title: 'Evento sem certificados',
          status: 'FINISHED',
          modality: 'IN_PERSON',
          startsAt: new Date(Date.now() - 5 * 86_400_000),
          endsAt: new Date(Date.now() - 3 * 86_400_000),
        },
      }),
    );

    const plan = await planEventCertificateZip({ tenantId, eventId: emptyEventId });

    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.code).toBe('NOT_STORED');
      expect(plan.message).toContain('não tem certificados emitidos');
    }
  });
});

describe('montagem do ZIP', () => {
  it('cada certificado do lote entra com o PDF que está no bucket', async () => {
    const plan = await planEventCertificateZip({ tenantId, eventId });
    if (!plan.ok) throw new Error(plan.message);

    const zip = await mountZip(plan.entries);
    const entries = await readZip(zip);

    expect(entries).toHaveLength(4);

    for (const entry of entries) {
      expect(entry.content.subarray(0, 8).toString('utf8')).toBe('%PDF-1.7');
    }

    const joao = entries.find((entry) => entry.name.includes('joao-conceicao'));

    expect(joao?.content.toString('utf8')).toContain('certificado de João Conceição');
  });

  it('o nome hostil não escapa da pasta (nem do ZIP)', async () => {
    /**
     * O nome vem do BANCO — e um `../..` no nome de quem recebe o certificado viraria
     * caminho na hora de extrair, se o escritor não normalizasse. O `zipEntryName`
     * roda na montagem, então nem o ZIP guarda a travessia.
     */
    const plan = await planEventCertificateZip({ tenantId, eventId });
    if (!plan.ok) throw new Error(plan.message);

    const zip = await mountZip(plan.entries);
    const entries = await readZip(zip);

    const hostile = entries.find((entry) => entry.name.includes('maria'));

    expect(hostile).toBeTruthy();
    expect(hostile!.name).not.toContain('..');
    expect(hostile!.name.startsWith('/')).toBe(false);
  });

  it('objeto que sumiu do bucket é PULADO — o lote sai com o resto', async () => {
    /**
     * O caso do dia da entrega: alguém limpou o bucket, ou o objeto se perdeu. Um
     * arquivo ausente não pode impedir a instituição de baixar os outros — e o ZIP
     * continua sendo um ZIP válido.
     */
    const plan = await planEventCertificateZip({ tenantId, eventId });
    if (!plan.ok) throw new Error(plan.message);

    const broken = [
      ...plan.entries,
      { certificateId: 'ausente', bucket: BUCKET, storageKey: 'nao/existe.pdf', fileName: 'ausente.pdf' },
    ];

    const zip = await mountZip(broken);
    const entries = await readZip(zip);

    expect(entries).toHaveLength(4);
    expect(entries.some((entry) => entry.name === 'ausente.pdf')).toBe(false);
  });

  it('o nome do lote é previsível e usa o slug do evento', async () => {
    const plan = await planEventCertificateZip({ tenantId, eventId });
    if (!plan.ok) throw new Error(plan.message);

    expect(zipFileName(plan.eventSlug, new Date('2026-09-23T13:30:00.000Z'))).toBe(
      `certificados-evento-zip-${RUN}-2026-09-23.zip`,
    );
  });
});
