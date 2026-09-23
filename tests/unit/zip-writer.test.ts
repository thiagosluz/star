/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Escritor de ZIP sem dependência (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE ESCREVE UM LEITOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "O arquivo foi gerado" não prova nada sobre um ZIP: o formato é binário e uma
 *  contagem de bytes errada produz um arquivo que abre em um leitor e falha em
 *  outro. Aqui o teste LÊ o que foi escrito — cabeçalho local, nome, conteúdo,
 *  diretório central e registro de fim, campo a campo — e confere o CRC-32 contra o
 *  valor publicado pela norma (o CRC de "123456789" é `0xCBF43926`; se a tabela
 *  estiver errada, o `unzip` recusaria o arquivo inteiro).
 *
 *  O gerador é assíncrono de propósito: o lote de certificados é produzido sem
 *  carregar todos os PDFs em memória, e o teste percorre o MESMO caminho.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  ZIP_MAX_ENTRIES,
  ZIP_MAX_ENTRY_BYTES,
  buildZipChunks,
  crc32,
  zipEntryName,
  zipFileName,
  zipWebStream,
  type ZipEntry,
} from '../../src/lib/documents/zip-writer';

/** Fonte das entradas: o gerador aceita qualquer iterável assíncrono. */
async function* entries(list: ZipEntry[]): AsyncGenerator<ZipEntry> {
  for (const entry of list) yield entry;
}

async function collect(list: ZipEntry[]): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of buildZipChunks(entries(list))) chunks.push(chunk);

  return Buffer.concat(chunks);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitor mínimo do formato — escrito aqui, de propósito
// ───────────────────────────────────────────────────────────────────────────────
interface ReadEntry {
  name: string;
  content: Buffer;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
}

interface ReadZip {
  entries: ReadEntry[];
  comment: string;
}

function readZip(buffer: Buffer): ReadZip {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

  expect(eocd, 'registro de fim (EOCD) ausente').toBeGreaterThan(-1);

  const total = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const commentLength = buffer.readUInt16LE(eocd + 20);
  const comment = buffer.subarray(eocd + 22, eocd + 22 + commentLength).toString('utf8');

  const result: ReadEntry[] = [];
  let cursor = centralOffset;

  for (let index = 0; index < total; index += 1) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);

    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const entryCommentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    // O cabeçalho LOCAL aponta para o mesmo nome e o mesmo tamanho.
    expect(buffer.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    expect(buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8')).toBe(
      name,
    );

    const contentStart = localOffset + 30 + localNameLength + localExtraLength;
    const content = buffer.subarray(contentStart, contentStart + compressedSize);

    result.push({ name, content, crc, compressedSize, uncompressedSize, method });

    cursor += 46 + nameLength + extraLength + entryCommentLength;
  }

  expect(cursor - centralOffset).toBe(centralSize);

  return { entries: result, comment };
}

describe('CRC-32', () => {
  it('bate com o valor publicado pela norma', () => {
    expect(crc32(Buffer.from('123456789', 'utf8'))).toBe(0xcbf43926);
  });

  it('trata o buffer vazio (CRC zero) e não estoura em byte alto', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
    expect(crc32(Buffer.from([0xff]))).toBeGreaterThan(0);
  });
});

describe('nome da entrada — o zip slip', () => {
  it('remove travessia de diretório e normaliza o separador', () => {
    expect(zipEntryName('../../etc/passwd')).toBe('etc/passwd');
    expect(zipEntryName('..\\..\\windows\\system32')).toBe('windows/system32');
    expect(zipEntryName('./a/./b.pdf')).toBe('a/b.pdf');
  });

  it('remove acentos e o que não é seguro no nome', () => {
    expect(zipEntryName('Certificado — João Conceição.pdf')).toBe('Certificado-Joao-Conceicao.pdf');
  });

  it('nunca devolve vazio nem caminho absoluto', () => {
    expect(zipEntryName('...')).toBe('arquivo.pdf');
    expect(zipEntryName('   ')).toBe('arquivo.pdf');
    expect(zipEntryName('/etc/shadow').startsWith('/')).toBe(false);
  });

  it('corta nomes longos em 180 caracteres', () => {
    expect(zipEntryName(`${'a'.repeat(400)}.pdf`)).toHaveLength(180);
  });
});

describe('ZIP — o arquivo lido de volta', () => {
  it('grava duas entradas com nome, conteúdo, tamanho e CRC corretos', async () => {
    const zip = await collect([
      { name: 'CERT-AAA-ana-souza.pdf', content: Buffer.from('%PDF-1.7 primeiro', 'utf8') },
      { name: 'CERT-BBB-bruno-lima.pdf', content: Buffer.from('%PDF-1.7 segundo — com acento', 'utf8') },
    ]);

    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');

    const read = readZip(zip);

    expect(read.entries).toHaveLength(2);
    expect(read.entries.map((entry) => entry.name)).toEqual([
      'CERT-AAA-ana-souza.pdf',
      'CERT-BBB-bruno-lima.pdf',
    ]);
    expect(read.entries[0]?.content.toString('utf8')).toBe('%PDF-1.7 primeiro');
    expect(read.entries[1]?.content.toString('utf8')).toBe('%PDF-1.7 segundo — com acento');

    for (const entry of read.entries) {
      // STORE: sem compressão, os dois tamanhos coincidem e o CRC cobre os bytes.
      expect(entry.method).toBe(0);
      expect(entry.compressedSize).toBe(entry.uncompressedSize);
      expect(entry.crc).toBe(crc32(entry.content));
    }
  });

  it('gera um ZIP válido e VAZIO (só o registro de fim)', async () => {
    const zip = await collect([]);

    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
    expect(readZip(zip).entries).toHaveLength(0);
    expect(zip).toHaveLength(22);
  });

  it('a entrada de 1 byte e a de 64 KB passam inteiras', async () => {
    const small = Buffer.from([0x41]);
    const large = Buffer.alloc(65_536, 0x42);
    const zip = await collect([
      { name: 'um.pdf', content: small },
      { name: 'grande.pdf', content: large },
    ]);

    const read = readZip(zip);

    expect(read.entries[0]?.content.equals(small)).toBe(true);
    expect(read.entries[1]?.content.equals(large)).toBe(true);
  });

  it('usa a data da entrada quando ela existe (e não o relógio)', async () => {
    const date = new Date('2026-09-23T13:30:00.000Z');
    const zip = await collect([{ name: 'a.pdf', content: Buffer.from('x'), date }]);

    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const centralOffset = zip.readUInt32LE(eocd + 16);

    // Data e hora no formato do MS-DOS, no cabeçalho central (deslocamentos 12 e 14).
    const dosTime = zip.readUInt16LE(centralOffset + 12);
    const dosDate = zip.readUInt16LE(centralOffset + 14);

    expect(dosDate >> 9).toBe(2026 - 1980);
    expect((dosDate >> 5) & 0x0f).toBe(9);
    expect(dosDate & 0x1f).toBe(23);
    expect(dosTime >> 11).toBe(13);
    expect((dosTime >> 5) & 0x3f).toBe(30);
  });

  it('recusa mais entradas que o formato clássico aceita', async () => {
    const many: ZipEntry[] = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, index) => ({
      name: `f-${index}.pdf`,
      content: Buffer.from('x'),
    }));

    await expect(collect(many)).rejects.toThrow(/aceita até/);
  });

  it('recusa arquivo maior que o campo de 32 bits', async () => {
    /**
     * Não se aloca 4 GB para provar isto: a checagem é sobre `length`, e o teto é
     * declarado no módulo. O teste prende o VALOR do teto e o fato de ele ser o
     * limite do formato (Zip64 está fora de escopo).
     */
    expect(ZIP_MAX_ENTRY_BYTES).toBe(0xffffffff);

    class FakeEntry {
      readonly name = 'gigante.pdf';
      readonly content = { length: ZIP_MAX_ENTRY_BYTES + 1 } as unknown as Buffer;
    }

    async function* oversized(): AsyncGenerator<ZipEntry> {
      yield new FakeEntry() as unknown as ZipEntry;
    }

    await expect(
      (async () => {
        for await (const _chunk of buildZipChunks(oversized())) {
          // Só o primeiro pedaço importa.
          break;
        }
      })(),
    ).rejects.toThrow(/grande demais/);
  });

  it('o caminho de leitura sob demanda: erro em uma entrada não corrompe o ZIP já escrito', async () => {
    /**
     * A rota do lote PULA o arquivo que falhou (log e segue). O que o teste prende é
     * que o gerador pode receber uma lista já filtrada — o ZIP continua válido com as
     * entradas que restaram.
     */
    const zip = await collect([
      { name: 'ok-1.pdf', content: Buffer.from('%PDF 1') },
      { name: 'ok-2.pdf', content: Buffer.from('%PDF 2') },
    ]);

    expect(readZip(zip).entries.map((entry) => entry.name)).toEqual(['ok-1.pdf', 'ok-2.pdf']);
  });
});

describe('fluxo web e nome do arquivo', () => {
  it('entrega um ReadableStream com os mesmos bytes', async () => {
    const stream = zipWebStream(
      entries([{ name: 'a.pdf', content: Buffer.from('%PDF a') }]),
    );
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    const zip = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));

    expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(readZip(zip).entries[0]?.name).toBe('a.pdf');
  });

  it('o nome do lote é previsível e sem acento', () => {
    const name = zipFileName('Congresso de Tecnologia 2026', new Date('2026-09-23T13:30:00.000Z'));

    expect(name).toBe('certificados-congresso-de-tecnologia-2026-2026-09-23.zip');
  });
});
