/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Escritor de ZIP (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM ESCRITOR PRÓPRIO, SEM DEPENDÊNCIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O que a fase precisa é de um ZIP de PDFs, gerado no servidor, transmitido em
 *  fluxo. Uma biblioteca traria uma árvore de dependências para produzir um formato
 *  que, no método STORE, são quatro estruturas de tamanho fixo — e o projeto já
 *  prefere domínio testável a pacote (o mesmo raciocínio do renderizador de
 *  certificado e do QR).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  STORE, E NÃO DEFLATE — A DECISÃO QUE TORNA O FLUXO POSSÍVEL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PDF já é um formato comprimido internamente (FlateDecode). Recomprimir gastaria
 *  CPU do servidor para economizar pouco — e, pior, obrigaria a conhecer o tamanho
 *  COMPRIMIDO antes de escrever o cabeçalho da entrada, o que força ter o arquivo
 *  inteiro (ou usar data descriptor, que alguns descompactadores tratam mal).
 *
 *  Com STORE, o tamanho comprimido é o tamanho real: o cabeçalho sai correto e o
 *  conteúdo é transmitido na sequência. A memória do processo fica limitada a **um**
 *  PDF por vez, não ao evento inteiro.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  LIMITES DECLARADOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O formato clássico usa inteiros de 32 bits: cada arquivo (e o ZIP inteiro) fica
 *  abaixo de 4 GB, e o diretório central aceita 65535 entradas. Não há Zip64 aqui —
 *  e é melhor RECUSAR com mensagem do que gerar um arquivo que o descompactador do
 *  usuário vai ler errado (ver `ZIP_MAX_ENTRIES`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { Readable } from 'node:stream';

/** Assinaturas do formato (o "PK" de Phil Katz). */
const SIGNATURE_LOCAL = 0x04034b50;
const SIGNATURE_CENTRAL = 0x02014b50;
const SIGNATURE_END = 0x06054b50;

/** Teto de entradas do formato clássico (sem Zip64). */
export const ZIP_MAX_ENTRIES = 60_000;
/** Teto por arquivo (4 GB - 1, o máximo de um campo de 32 bits). */
export const ZIP_MAX_ENTRY_BYTES = 0xffff_ffff;

export interface ZipEntry {
  /** Caminho dentro do ZIP. Barras separam pastas; sem barra inicial. */
  name: string;
  content: Buffer;
  /** Data de modificação gravada na entrada (UTC). */
  date?: Date;
}

/**
 * Tabela do CRC-32 (IEEE 802.3), calculada uma vez.
 *
 * O CRC vai no cabeçalho de CADA entrada e é o que o descompactador usa para dizer
 * que o arquivo chegou íntegro — é a única verificação que o formato oferece, e é
 * por isso que ele é calculado aqui em vez de "confiar no tamanho".
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/** Data/hora no formato do MS-DOS (o que o ZIP usa). */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getUTCFullYear(), 1980);

  return {
    time:
      (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/**
 * Normaliza o nome da entrada.
 *
 * Um nome com `..` ou barra invertida viraria caminho fora da pasta na hora de
 * extrair — o "zip slip", que é o mesmo problema do `sanitizeFileName` do storage.
 *
 * O nome que sobra SEM nenhuma letra ou número não é um nome: `.`, `..` e `...`
 * chegam aqui por caminhos diferentes e o filtro de partes só barra os dois
 * primeiros — `...` passaria como "arquivo chamado três pontos". O teste pegou isso,
 * e a resposta certa é a mesma para todos: um nome de reserva.
 */
export function zipEntryName(raw: string): string {
  const cleaned = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .join('/')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._/-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 180);

  return /[a-zA-Z0-9]/.test(cleaned) ? cleaned : 'arquivo.pdf';
}

/**
 * Gera o ZIP em pedaços, consumindo as entradas uma a uma.
 *
 * O gerador devolve primeiro cada entrada (cabeçalho + conteúdo) e, no fim, o
 * diretório central e o registro de fim — que é como o formato exige: o leitor
 * encontra o fim procurando a assinatura de trás para frente.
 */
export async function* buildZipChunks(entries: AsyncIterable<ZipEntry>): AsyncGenerator<Buffer> {
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;

  for await (const entry of entries) {
    if (count >= ZIP_MAX_ENTRIES) {
      throw new Error(
        `O ZIP aceita até ${ZIP_MAX_ENTRIES} arquivos. Reduza o filtro e tente de novo.`,
      );
    }

    if (entry.content.length > ZIP_MAX_ENTRY_BYTES) {
      throw new Error(`O arquivo "${entry.name}" é grande demais para um ZIP clássico.`);
    }

    const name = Buffer.from(zipEntryName(entry.name), 'utf8');
    const { time, date } = dosDateTime(entry.date ?? new Date());
    const crc = crc32(entry.content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIGNATURE_LOCAL, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0, 6); // sem flags (tamanhos são conhecidos)
    local.writeUInt16LE(0, 8); // método STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.content.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    yield local;
    yield name;
    yield entry.content;

    const header = Buffer.alloc(46);
    header.writeUInt32LE(SIGNATURE_CENTRAL, 0);
    header.writeUInt16LE(20, 4); // versão que criou
    header.writeUInt16LE(20, 6); // versão necessária
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(entry.content.length, 20);
    header.writeUInt32LE(entry.content.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30); // extra
    header.writeUInt16LE(0, 32); // comentário
    header.writeUInt16LE(0, 34); // disco
    header.writeUInt16LE(0, 36); // atributos internos
    header.writeUInt32LE(0, 38); // atributos externos
    header.writeUInt32LE(offset, 42);

    central.push(header, name);

    offset += local.length + name.length + entry.content.length;
    count += 1;
  }

  const centralBuffer = Buffer.concat(central);

  yield centralBuffer;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIGNATURE_END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  yield end;
}

/**
 * O ZIP como fluxo web, pronto para o corpo de uma resposta HTTP.
 *
 * `Readable.toWeb` faz a ponte entre o gerador (Node) e o `Response` (web) sem
 * acumular nada: cada pedaço sai assim que é produzido.
 */
export function zipWebStream(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
  const nodeStream = Readable.from(buildZipChunks(entries), { objectMode: false });

  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

/** Nome do arquivo do lote, previsível para quem baixa. */
export function zipFileName(slug: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);

  return `certificados-${slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-${day}.zip`;
}
