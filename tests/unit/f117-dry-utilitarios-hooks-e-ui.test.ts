/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UNITÁRIOS + CATRACA ESTRUTURAL — FASE 117 (Consolidação DRY · ADR-472..474)
 *
 *  Valida o comportamento dos utilitários e hooks extraídos e trava, por varredura
 *  estática de `src/`, o retorno de cópias duplicadas das funções consolidadas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { asRecord, asRecordOrNull } from '@/domain/shared/json-record';
import { round2 } from '@/domain/shared/number-rules';
import { stripDiacritics } from '@/domain/shared/text-rules';
import {
  formatDateTimePtBr,
  formatShortDatePtBr,
  formatTimePtBr,
  formatUtcMoment,
  toDatetimeLocalInput,
} from '@/domain/shared/date-format';
import { parseImageMime } from '@/domain/events/image-rules';
import { getRedisUrl } from '@/lib/redis/config';
import {
  formBoolean,
  formDate,
  formInt,
  formNullableInt,
  formNullableText,
  formText,
} from '@/lib/http/form-data';
import { extractClientIp } from '@/lib/http/request-meta';
import { readMagicBytes, sha256Hex } from '@/lib/client/file-crypto';

function walkSrc(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'node_modules') continue;
      walkSrc(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full.replace(/\\/g, '/'));
    }
  }
  return out;
}

describe('FASE 117 — Utilitários puros de domínio (ADR-472)', () => {
  it('asRecord e asRecordOrNull rejeitam null, arrays e primitivos e devolvem cópia segura', () => {
    expect(asRecordOrNull(null)).toBeNull();
    expect(asRecordOrNull(undefined)).toBeNull();
    expect(asRecordOrNull([1, 2])).toBeNull();
    expect(asRecordOrNull('texto')).toBeNull();
    expect(asRecordOrNull(42)).toBeNull();

    const original = { a: 1, b: 'ok' };
    expect(asRecordOrNull(original)).toBe(original);

    const copy = asRecord(original);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(asRecord(null)).toEqual({});
    expect(asRecord(['x'])).toEqual({});
  });

  it('round2 arredonda para 2 casas e normaliza -0 para 0 positivo', () => {
    expect(round2(3.14159)).toBe(3.14);
    expect(round2(2.005)).toBe(2.01);
    expect(Object.is(round2(-0.001), 0)).toBe(true);
    expect(Object.is(round2(-0), 0)).toBe(true);
  });

  it('stripDiacritics remove acentos preservando caixa', () => {
    expect(stripDiacritics('Programação Científica — São Paulo')).toBe(
      'Programacao Cientifica — Sao Paulo',
    );
    expect(stripDiacritics('ÁÉÍÓÚçñ')).toBe('AEIOUcn');
  });

  it('date-format formata datas pt-BR, UTC e datetime-local com fallback honesto', () => {
    const instant = new Date('2026-10-15T18:30:00.000Z');

    expect(formatUtcMoment(instant)).toBe('2026-10-15 18:30');
    expect(formatShortDatePtBr(instant, 'America/Sao_Paulo')).toBe('15/10/2026');
    expect(formatTimePtBr(instant, 'America/Sao_Paulo')).toBe('15:30');
    expect(formatDateTimePtBr(instant, 'America/Sao_Paulo')).toMatch(/^15\/10\/2026,?\s+15:30$/);
    expect(toDatetimeLocalInput(instant, 'America/Sao_Paulo')).toBe('2026-10-15T15:30');

    expect(formatDateTimePtBr(null)).toBe('—');
    expect(formatShortDatePtBr('data-invalida')).toBe('—');
    expect(formatTimePtBr(undefined)).toBe('—');
    expect(toDatetimeLocalInput(null)).toBe('');
  });

  it('parseImageMime aceita apenas a allowlist normalizada e recusa SVG/HTML', () => {
    expect(parseImageMime('image/PNG; charset=utf-8')).toBe('image/png');
    expect(parseImageMime('image/webp')).toBe('image/webp');
    expect(parseImageMime('image/avif')).toBe('image/avif');
    expect(parseImageMime('image/svg+xml')).toBeNull();
    expect(parseImageMime('text/html')).toBeNull();
    expect(parseImageMime(null)).toBeNull();
  });

  it('getRedisUrl respeita REDIS_URL ou cai no fallback local', () => {
    const previous = process.env.REDIS_URL;
    try {
      delete process.env.REDIS_URL;
      expect(getRedisUrl()).toBe('redis://localhost:6379');
      process.env.REDIS_URL = 'redis://redis-test:6379';
      expect(getRedisUrl()).toBe('redis://redis-test:6379');
    } finally {
      if (previous === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previous;
    }
  });
});

describe('FASE 117 — Utilitários HTTP e criptografia de cliente (ADR-473)', () => {
  it('parsers de FormData distinguem vazio de zero e tratam entradas inválidas', () => {
    expect(formText('  abc  ')).toBe('abc');
    expect(formText(null)).toBe('');

    expect(formNullableText('   ')).toBeNull();
    expect(formNullableText('  valor ')).toBe('valor');

    expect(formInt('42.9')).toBe(42);
    expect(formInt('', 7)).toBe(7);
    expect(formInt('abc', 5)).toBe(5);

    expect(formNullableInt('')).toBeNull();
    expect(formNullableInt('0')).toBe(0);
    expect(formNullableInt('12.8')).toBe(12);
    expect(formNullableInt('nao-numero')).toBeNull();

    expect(formBoolean('on')).toBe(true);
    expect(formBoolean('true')).toBe(true);
    expect(formBoolean('1')).toBe(true);
    expect(formBoolean('false')).toBe(false);
    expect(formBoolean(null)).toBe(false);

    expect(formDate('')).toBeNull();
    expect(formDate('invalida')).toBeNull();
    expect(formDate('2026-10-15T12:00:00.000Z')?.toISOString()).toBe('2026-10-15T12:00:00.000Z');
  });

  it('extractClientIp lê o primeiro hop de x-forwarded-for e cai para x-real-ip', () => {
    const forwarded = new Headers({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1' });
    expect(extractClientIp(forwarded)).toBe('203.0.113.10');

    const realIp = new Headers({ 'x-real-ip': '198.51.100.42' });
    expect(extractClientIp(realIp)).toBe('198.51.100.42');

    expect(extractClientIp(new Headers())).toBeNull();
  });

  it('sha256Hex e readMagicBytes produzem hash e assinatura determinísticos', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    const pdfBlob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])]);
    expect(await readMagicBytes(pdfBlob, 5)).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(await sha256Hex(pdfBlob)).toHaveLength(64);
  });
});

describe('FASE 117 — Catraca estrutural DRY (impede retorno de cópias duplicadas)', () => {
  const srcRoot = path.resolve(process.cwd(), 'src');
  const allSrcFiles = walkSrc(srcRoot);

  function filesMatching(pattern: RegExp, filter?: (filePath: string) => boolean): string[] {
    const matched: string[] = [];
    for (const file of allSrcFiles) {
      if (filter && !filter(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (pattern.test(content)) {
        matched.push(path.relative(process.cwd(), file).replace(/\\/g, '/'));
      }
    }
    return matched;
  }

  it('módulos em src/domain/shared/** permanecem 100% puros (sem Prisma, Next ou @/lib)', () => {
    const sharedFiles = allSrcFiles.filter((f) => f.includes('/domain/shared/'));
    expect(sharedFiles.length).toBeGreaterThanOrEqual(4);

    for (const file of sharedFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/from\s+['"]@\/lib\//);
      expect(content).not.toMatch(/from\s+['"]next\//);
      expect(content).not.toMatch(/from\s+['"]@prisma\//);
    }
  });

  it('funções consolidadas existem apenas nos módulos canônicos', () => {
    expect(filesMatching(/\bfunction\s+sha256Hex\s*\(/)).toEqual(['src/lib/client/file-crypto.ts']);
    expect(filesMatching(/\bfunction\s+readMagicBytes\s*\(/)).toEqual([
      'src/lib/client/file-crypto.ts',
    ]);
    expect(filesMatching(/\bfunction\s+useIsInteractive\s*\(/)).toEqual([
      'src/hooks/use-is-interactive.ts',
    ]);
    expect(filesMatching(/\bfunction\s+round2\s*\(/)).toEqual(['src/domain/shared/number-rules.ts']);
    expect(filesMatching(/\bfunction\s+asRecord\s*\(/)).toEqual([
      'src/domain/shared/json-record.ts',
    ]);
    expect(filesMatching(/\bfunction\s+settingsObject\s*\(/)).toEqual([]);
    expect(filesMatching(/\bfunction\s+asImageMime\s*\(/)).toEqual([]);
    expect(filesMatching(/\bfunction\s+redisUrl\s*\(/)).toEqual([]);
    expect(
      filesMatching(/\bfunction\s+nullable\s*\(/, (f) => f.includes('/app/actions/')),
    ).toEqual([]);
  });

  it('acesso a clipboard e x-forwarded-for permanece centralizado', () => {
    expect(filesMatching(/navigator\.clipboard\.writeText/)).toEqual([
      'src/hooks/use-copy-to-clipboard.ts',
    ]);
    expect(filesMatching(/\.get\(\s*['"]x-forwarded-for['"]\s*\)/)).toEqual([
      'src/lib/http/request-meta.ts',
    ]);
  });
});
