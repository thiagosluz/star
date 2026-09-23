/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Inspeção antivírus dos arquivos (FASE 36)
 *
 *  Sem banco, sem ClamAV e sem rede: aqui vive a REGRA que decide se um arquivo
 *  enviado por terceiro pode ser servido, e ela precisa ser provada todas as vezes —
 *  porque é a única coisa entre o bucket e o navegador de quem baixa.
 *
 *  O que este arquivo prende:
 *
 *    • `INFECTED` NUNCA é servido, com a inspeção ligada ou desligada (desligar o
 *      antivírus não devolve à circulação o que já foi identificado);
 *    • `PENDING` só é bloqueado ENQUANTO a inspeção está ligada;
 *    • valor desconhecido é `PENDING`, nunca `CLEAN` — o que não entendemos não
 *      vira permissão de acesso;
 *    • a resposta do clamd é lida pelo significado dela: `stream: OK` aprova,
 *      `... FOUND` acusa, e QUALQUER outra coisa é falha (não aprovação).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  FILE_SCAN_STATUSES,
  FILE_SCAN_STATUS_LABELS,
  SCAN_DRIVERS,
  SCAN_TIMEOUT_MS,
  canServeFile,
  initialScanStatus,
  interpretClamResponse,
  isFileScanStatus,
  isScanDriver,
  normalizeScanStatus,
  scanStatusLabel,
} from '../../src/domain/review/file-scan-rules';

describe('estado da inspeção', () => {
  it('enumera os quatro estados, cada um com rótulo', () => {
    expect(FILE_SCAN_STATUSES).toEqual(['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED']);

    for (const status of FILE_SCAN_STATUSES) {
      expect(FILE_SCAN_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('reconhece apenas os estados do catálogo', () => {
    expect(isFileScanStatus('CLEAN')).toBe(true);
    expect(isFileScanStatus('clean')).toBe(false);
    expect(isFileScanStatus('')).toBe(false);
    expect(isFileScanStatus(null)).toBe(false);
    expect(isFileScanStatus(7)).toBe(false);
  });

  it('valor desconhecido vira PENDING — nunca CLEAN', () => {
    /**
     * O caso real: uma linha antiga, escrita à mão, ou um estado que uma versão
     * futura gravou. Transformar isso em `CLEAN` seria dar permissão de acesso com
     * base em algo que o sistema não sabe ler.
     */
    expect(normalizeScanStatus('WHATEVER')).toBe('PENDING');
    expect(normalizeScanStatus(undefined)).toBe('PENDING');
    expect(normalizeScanStatus('CLEAN')).toBe('CLEAN');
    expect(scanStatusLabel('WHATEVER')).toBe('Aguardando inspeção');
    expect(scanStatusLabel('SKIPPED')).toBe('Não inspecionado');
  });

  it('o arquivo NASCE pendente só quando a inspeção está ligada', () => {
    expect(initialScanStatus(true)).toBe('PENDING');
    expect(initialScanStatus(false)).toBe('SKIPPED');
  });
});

describe('o portão do download — quem pode ser servido', () => {
  it('INFECTED é bloqueado SEMPRE, com a inspeção ligada ou desligada', () => {
    for (const scanningEnabled of [true, false]) {
      const check = canServeFile({ status: 'INFECTED', scanningEnabled });

      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(check.code).toBe('INFECTED');
        expect(check.message).toContain('bloqueado');
      }
    }
  });

  it('PENDING é bloqueado enquanto a inspeção está ligada', () => {
    const check = canServeFile({ status: 'PENDING', scanningEnabled: true });

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe('PENDING');
  });

  it('PENDING passa quando a inspeção está desligada (e o arquivo não é "inspecionado")', () => {
    const check = canServeFile({ status: 'PENDING', scanningEnabled: false });

    expect(check.ok).toBe(true);
    if (check.ok) expect(check.inspected).toBe(false);
  });

  it('CLEAN é servido e MARCADO como inspecionado', () => {
    const check = canServeFile({ status: 'CLEAN', scanningEnabled: true });

    expect(check.ok).toBe(true);
    if (check.ok) expect(check.inspected).toBe(true);
  });

  it('SKIPPED é servido — mas NÃO é declarado inspecionado', () => {
    /**
     * A diferença entre `inspected: true` e `inspected: false` é o que permite a tela
     * dizer "não inspecionado" em vez de sugerir uma garantia que não existe.
     */
    const check = canServeFile({ status: 'SKIPPED', scanningEnabled: true });

    expect(check.ok).toBe(true);
    if (check.ok) expect(check.inspected).toBe(false);
  });

  it('estado irreconhecível se comporta como PENDING', () => {
    expect(canServeFile({ status: '???', scanningEnabled: true }).ok).toBe(false);
    expect(canServeFile({ status: '???', scanningEnabled: false }).ok).toBe(true);
  });
});

describe('interpretação da resposta do clamd', () => {
  it('aprova a resposta OK, com ou sem o NUL do protocolo', () => {
    expect(interpretClamResponse('stream: OK\0')).toEqual({ status: 'CLEAN' });
    expect(interpretClamResponse('stream: OK')).toEqual({ status: 'CLEAN' });
    expect(interpretClamResponse('  stream: OK \n')).toEqual({ status: 'CLEAN' });
  });

  it('acusa a assinatura encontrada', () => {
    const verdict = interpretClamResponse('stream: Eicar-Signature FOUND\0');

    expect(verdict.status).toBe('INFECTED');
    if (verdict.status === 'INFECTED') expect(verdict.signature).toBe('Eicar-Signature');
  });

  it('QUALQUER outra resposta é falha — nunca aprovação', () => {
    /**
     * "Não entendi" não pode significar "pode servir". Vazio, erro do daemon e
     * resposta truncada caem todos aqui, e o arquivo continua `PENDING`.
     */
    for (const raw of ['', '   ', 'ERROR: Could not read', 'stream:']) {
      const verdict = interpretClamResponse(raw);

      expect(verdict.status, `resposta "${raw}" não pode aprovar`).toBe('UNKNOWN');
    }
  });

  it('trunca a assinatura e a resposta crua em 180 caracteres', () => {
    const long = interpretClamResponse(`stream: ${'A'.repeat(400)} FOUND`);
    const unknown = interpretClamResponse('B'.repeat(400));

    if (long.status === 'INFECTED') expect(long.signature).toHaveLength(180);
    if (unknown.status === 'UNKNOWN') expect(unknown.raw).toHaveLength(180);
  });
});

describe('driver da inspeção', () => {
  it('conhece exatamente dois drivers, e o padrão do produto é NÃO inspecionar', () => {
    expect(SCAN_DRIVERS).toEqual(['none', 'clamav']);
    expect(isScanDriver('none')).toBe(true);
    expect(isScanDriver('clamav')).toBe(true);
    expect(isScanDriver('ClamAV')).toBe(false);
    expect(isScanDriver(undefined)).toBe(false);
  });

  it('o tempo limite é uma constante de domínio (não há variável de ambiente para ele)', () => {
    expect(SCAN_TIMEOUT_MS).toBe(60_000);
  });
});
