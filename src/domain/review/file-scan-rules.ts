/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Inspeção antivírus dos arquivos enviados (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O arquivo de uma submissão entra no bucket por URL pré-assinada — a aplicação
 *  nunca vê o conteúdo (decisão da FASE 4, por memória e tempo). E é servido ao
 *  comitê por outra URL assinada. Entre as duas pontas, ninguém olhava os bytes:
 *  a coluna `SubmissionFile.scanStatus` existia desde a migração inicial e era
 *  gravada como `SKIPPED`, com o comentário certo — *"não afirmar algo que não
 *  verificamos"*. Esta fase tira a coluna do papel (dívida A3).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS REGRAS QUE IMPORTAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. **`INFECTED` nunca é servido**, com a inspeção ligada ou desligada. O que
 *       já foi identificado como malicioso não volta a circular porque alguém
 *       desligou o antivírus.
 *    2. **`PENDING` só é bloqueado ENQUANTO a inspeção está ligada.** É a promessa
 *       do pedido ("antes de disponibilizá-los aos comitês"). Com o driver
 *       desligado, travar tudo por tempo indeterminado quebraria o produto — e o
 *       estado honesto do arquivo, nesse caso, é `SKIPPED` ("não inspecionado"), que
 *       a tela mostra como tal.
 *
 *  Regra pura: nenhum import de Prisma, nenhum de Next, nenhum acesso a socket. É o
 *  que permite prender as quatro combinações sem subir um ClamAV.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Estado da inspeção
// ───────────────────────────────────────────────────────────────────────────────
export const FILE_SCAN_STATUSES = ['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED'] as const;

export type FileScanStatus = (typeof FILE_SCAN_STATUSES)[number];

export const FILE_SCAN_STATUS_LABELS: Record<FileScanStatus, string> = {
  PENDING: 'Aguardando inspeção',
  CLEAN: 'Inspecionado — sem ameaça',
  INFECTED: 'Bloqueado — ameaça detectada',
  SKIPPED: 'Não inspecionado',
};

/** O arquivo pode ser servido? */
export type FileServeCheck =
  | { ok: true; /** `false` = servido sem inspeção; a tela diz isso. */ inspected: boolean }
  | { ok: false; code: 'PENDING' | 'INFECTED'; message: string };

export function isFileScanStatus(value: unknown): value is FileScanStatus {
  return typeof value === 'string' && (FILE_SCAN_STATUSES as readonly string[]).includes(value);
}

/**
 * Traduz o que está gravado no banco num estado conhecido.
 *
 * Valor estranho (dado antigo, escrita à mão, versão futura) vira `PENDING` — e
 * não `CLEAN`. A escolha é deliberada: um valor que não entendemos não pode virar
 * permissão de acesso.
 */
export function normalizeScanStatus(value: unknown): FileScanStatus {
  return isFileScanStatus(value) ? value : 'PENDING';
}

export function scanStatusLabel(value: unknown): string {
  return FILE_SCAN_STATUS_LABELS[normalizeScanStatus(value)];
}

/**
 * O estado com que um arquivo NASCE.
 *
 * Com a inspeção ligada, `PENDING` (o job vai olhar). Desligada, `SKIPPED` — o
 * mesmo valor que a FASE 4 gravava, e que diz a verdade.
 */
export function initialScanStatus(scanningEnabled: boolean): FileScanStatus {
  return scanningEnabled ? 'PENDING' : 'SKIPPED';
}

/**
 * A decisão de servir o arquivo. É chamada em TODO caminho que entrega bytes de
 * upload de terceiro — hoje o parecer do comitê e o material do palestrante.
 */
export function canServeFile(input: {
  status: unknown;
  /** A inspeção está configurada e ligada? */
  scanningEnabled: boolean;
}): FileServeCheck {
  const status = normalizeScanStatus(input.status);

  if (status === 'INFECTED') {
    return {
      ok: false,
      code: 'INFECTED',
      message:
        'Este arquivo foi bloqueado pela inspeção de segurança. Fale com a organização do evento.',
    };
  }

  if (status === 'PENDING' && input.scanningEnabled) {
    return {
      ok: false,
      code: 'PENDING',
      message:
        'Este arquivo está em análise de segurança e fica disponível assim que a inspeção terminar.',
    };
  }

  return { ok: true, inspected: status === 'CLEAN' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Driver
// ───────────────────────────────────────────────────────────────────────────────
export const SCAN_DRIVERS = ['none', 'clamav'] as const;

export type ScanDriver = (typeof SCAN_DRIVERS)[number];

export const SCAN_DRIVER_LABELS: Record<ScanDriver, string> = {
  none: 'Não inspecionar',
  clamav: 'ClamAV (clamd)',
};

export function isScanDriver(value: unknown): value is ScanDriver {
  return typeof value === 'string' && (SCAN_DRIVERS as readonly string[]).includes(value);
}

/** Quanto tempo esperar pelo veredito antes de considerar a inspeção falhada. */
export const SCAN_TIMEOUT_MS = 60_000;

/**
 * Interpreta a resposta do clamd.
 *
 * O protocolo responde uma linha terminada em NUL: `stream: OK` quando está limpo e
 * `stream: <Assinatura> FOUND` quando encontra algo. Qualquer outra coisa (inclusive
 * vazio) NÃO é aprovação: vira falha de inspeção, porque "não entendi a resposta" não
 * pode significar "pode servir".
 */
export function interpretClamResponse(raw: string): { status: 'CLEAN' } | { status: 'INFECTED'; signature: string } | { status: 'UNKNOWN'; raw: string } {
  const text = raw.replace(/\0/g, '').trim();

  if (/(^|\s)OK$/.test(text)) return { status: 'CLEAN' };

  const found = /:\s*(.+?)\s+FOUND$/.exec(text);
  if (found?.[1]) return { status: 'INFECTED', signature: found[1].slice(0, 180) };

  return { status: 'UNKNOWN', raw: text.slice(0, 180) };
}
