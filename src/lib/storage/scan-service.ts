/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INFRAESTRUTURA — Inspeção antivírus dos objetos do storage (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE DRIVER, E NÃO CHAMADA DIRETA AO CLAMAV
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Mesma decisão do driver de e-mail (ADR-128): o sistema **não pode fingir** que
 *  inspecionou. Com `SCAN_DRIVER=none` (o padrão), o arquivo nasce `SKIPPED` — o
 *  valor que diz "não inspecionado" — e a tela mostra isso. Nada é bloqueado por
 *  um serviço que não está no ar, e nada é declarado limpo sem ter sido olhado.
 *
 *  `SCAN_DRIVER=clamav` SEM endereço configurado falha com o motivo escrito, em vez
 *  de cair para `none` em silêncio: quem ligou o antivírus precisa saber que ele
 *  não está lá.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROTOCOLO: INSTREAM, E O ARQUIVO NÃO PASSA PELA MEMÓRIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `clamd` escuta em TCP e aceita `zINSTREAM\0` seguido de blocos
 *  (`<4 bytes big-endian><dados>`) e de um bloco vazio. O corpo do objeto é LIDO DO
 *  S3 EM FLUXO e repassado em blocos — um PDF de 20 MB não é carregado inteiro no
 *  processo (a mesma razão pela qual o upload não passa pela aplicação).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { connect, type Socket } from 'node:net';
import { Readable } from 'node:stream';

import { getObjectStream } from '@/lib/storage/s3-client';
import {
  SCAN_TIMEOUT_MS,
  interpretClamResponse,
  isScanDriver,
  type ScanDriver,
} from '@/domain/review/file-scan-rules';

export interface ScanConfig {
  driver: ScanDriver;
  host: string | null;
  port: number;
  /** Motivo da recusa, quando o driver declarado não tem como funcionar. */
  reason: string | null;
}

export const CLAMAV_DEFAULT_PORT = 3310;

/**
 * Lê a configuração do driver.
 *
 * O padrão é `none` — e é ele que mantém o comportamento de todas as instalações
 * que não têm ClamAV (`SKIPPED`, arquivo servido, tela dizendo que não houve
 * inspeção).
 */
export function scanConfig(env: NodeJS.ProcessEnv = process.env): ScanConfig {
  const declared = env.SCAN_DRIVER ?? 'none';

  if (!isScanDriver(declared)) {
    return {
      driver: 'none',
      host: null,
      port: CLAMAV_DEFAULT_PORT,
      reason: `SCAN_DRIVER="${declared}" não é um driver conhecido (use "none" ou "clamav").`,
    };
  }

  if (declared === 'none') {
    return { driver: 'none', host: null, port: CLAMAV_DEFAULT_PORT, reason: null };
  }

  const host = env.CLAMAV_HOST?.trim();
  const port = Number(env.CLAMAV_PORT ?? CLAMAV_DEFAULT_PORT);

  if (!host) {
    return {
      driver: 'clamav',
      host: null,
      port,
      reason:
        'SCAN_DRIVER=clamav exige CLAMAV_HOST definido — sem ele não há como inspecionar, e o sistema não vai fingir que inspecionou.',
    };
  }

  return { driver: 'clamav', host, port: Number.isFinite(port) ? port : CLAMAV_DEFAULT_PORT, reason: null };
}

/** A inspeção está ligada e utilizável? */
export function isScanningEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = scanConfig(env);

  return config.driver === 'clamav' && config.host !== null && config.reason === null;
}

export type ScanOutcome =
  | { ok: true; status: 'CLEAN' | 'INFECTED'; signature?: string }
  /** A inspeção não pôde acontecer — o arquivo continua `PENDING` e será retentado. */
  | { ok: false; code: 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'UNKNOWN_RESPONSE'; message: string };

/**
 * Inspeciona um objeto do storage, lendo o corpo em fluxo.
 *
 * Falha de infraestrutura (clamd fora do ar, timeout, resposta ilegível) NÃO é
 * veredito: devolve `ok: false` e o arquivo permanece `PENDING` para a próxima
 * passada — bloquear para sempre por indisponibilidade seria transformar um
 * problema de operação em recusa de acesso a quem não fez nada de errado.
 */
export async function scanStoredObject(input: {
  bucket: string;
  objectKey: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ScanOutcome> {
  const config = scanConfig(input.env);

  if (config.driver !== 'clamav') {
    return { ok: false, code: 'NOT_CONFIGURED', message: 'Inspeção desligada.' };
  }

  if (!config.host || config.reason) {
    return { ok: false, code: 'NOT_CONFIGURED', message: config.reason ?? 'Inspeção sem endereço.' };
  }

  let socket: Socket | null = null;

  try {
    const body = await getObjectStream(input.bucket, input.objectKey);

    socket = await openClamd(config.host, config.port);

    const verdict = await streamToClamd(socket, body);

    const parsed = interpretClamResponse(verdict);

    if (parsed.status === 'CLEAN') return { ok: true, status: 'CLEAN' };

    if (parsed.status === 'INFECTED') {
      return { ok: true, status: 'INFECTED', signature: parsed.signature };
    }

    return {
      ok: false,
      code: 'UNKNOWN_RESPONSE',
      message: `Resposta inesperada do clamd: ${parsed.raw || '(vazia)'}`,
    };
  } catch (error) {
    return {
      ok: false,
      code: 'UNAVAILABLE',
      message: error instanceof Error ? error.message : 'Falha ao falar com o clamd.',
    };
  } finally {
    socket?.destroy();
  }
}

function openClamd(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });

    const onError = (error: Error) => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(SCAN_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error('O clamd não respondeu dentro do tempo limite.'));
    });

    socket.once('error', onError);
    socket.once('connect', () => {
      socket.off('error', onError);
      resolve(socket);
    });
  });
}

/**
 * Envia o fluxo no protocolo INSTREAM e devolve a resposta crua.
 *
 * Os blocos são montados um a um (`length` + dados) e o último é o marcador de fim
 * (quatro bytes zero) — o clamd só responde depois dele.
 */
function streamToClamd(socket: Socket, body: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = '';

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      response += chunk;
    });
    socket.on('error', reject);
    socket.on('end', () => resolve(response));

    socket.write('zINSTREAM\0');

    body.on('data', (chunk: Buffer) => {
      const size = Buffer.alloc(4);
      size.writeUInt32BE(chunk.length, 0);
      socket.write(size);
      socket.write(chunk);
    });

    body.on('end', () => {
      const end = Buffer.alloc(4);
      socket.write(end);
    });

    body.on('error', reject);
  });
}

/**
 * Inspeciona um conteúdo já em memória.
 *
 * Existe para os testes (o arquivo de teste padrão do ClamAV, o EICAR, é uma
 * string) e para qualquer caminho futuro em que o conteúdo já esteja carregado —
 * o caminho de produção usa `scanStoredObject`, que não carrega nada.
 */
export async function scanBuffer(
  content: Buffer,
  options: { host?: string; port?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ScanOutcome> {
  const config = scanConfig(options.env);
  const host = options.host ?? config.host;
  const port = options.port ?? config.port;

  if (!host) {
    return { ok: false, code: 'NOT_CONFIGURED', message: config.reason ?? 'Inspeção sem endereço.' };
  }

  let socket: Socket | null = null;

  try {
    socket = await openClamd(host, port);
    const verdict = await streamToClamd(socket, bufferToStream(content));
    const parsed = interpretClamResponse(verdict);

    if (parsed.status === 'CLEAN') return { ok: true, status: 'CLEAN' };
    if (parsed.status === 'INFECTED') return { ok: true, status: 'INFECTED', signature: parsed.signature };

    return { ok: false, code: 'UNKNOWN_RESPONSE', message: parsed.raw };
  } catch (error) {
    return {
      ok: false,
      code: 'UNAVAILABLE',
      message: error instanceof Error ? error.message : 'Falha ao falar com o clamd.',
    };
  } finally {
    socket?.destroy();
  }
}

function bufferToStream(buffer: Buffer): NodeJS.ReadableStream {
  return Readable.from([buffer]);
}
