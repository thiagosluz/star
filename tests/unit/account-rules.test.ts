/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Regras da área de conta (FASE 47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • os códigos do segundo fator são NORMALIZADOS antes de ir (espaço, hífen, caixa)
 *      e o que não é código é recusado ANTES de gastar uma tentativa da conta — a
 *      biblioteca bloqueia depois de 10 falhas, então errar por causa de um espaço
 *      custaria caro;
 *    • o rótulo do dispositivo é HEURÍSTICA e não pode mentir: navegador que se
 *      apresenta como outro (Edge dizendo "Chrome") recebe o nome certo;
 *    • a sessão atual vem primeiro na lista — é a linha que a pessoa não deve encerrar;
 *    • o e-mail é comparado sem caixa, e a chave do TOTP só é extraída de um URI que
 *      realmente seja de TOTP.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MIN_LENGTH,
  describeSession,
  formatBackupCode,
  isSameEmail,
  normalizeBackupCode,
  normalizeTotpCode,
  orderSessionsForDisplay,
  passwordHint,
  passwordsMatch,
  totpSecretFromUri,
} from '../../src/domain/account/account-rules';

describe('códigos do segundo fator', () => {
  it('aceita o código de seis dígitos como a pessoa digita', () => {
    expect(normalizeTotpCode('123456')).toBe('123456');
    // Espaço é o que o teclado do celular insere ao colar do aplicativo.
    expect(normalizeTotpCode(' 123 456 ')).toBe('123456');
    expect(normalizeTotpCode('123-456')).toBe('123456');
  });

  it('recusa o que não é código de seis dígitos', () => {
    expect(normalizeTotpCode('12345')).toBeNull();
    expect(normalizeTotpCode('1234567')).toBeNull();
    expect(normalizeTotpCode('abcdef')).toBeNull();
    expect(normalizeTotpCode('')).toBeNull();
    expect(normalizeTotpCode(null)).toBeNull();
    expect(normalizeTotpCode(123456)).toBeNull();
  });

  it('reconstrói o formato canônico do código de recuperação — sem mexer na caixa', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O SERVIDOR COMPARA EXATAMENTE (caso que o E2E pegou)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A biblioteca gera `abcde-fghij` (com hífen e com maiúsculas) e confere com
     *  `codes.includes(code)`. A primeira versão desta função baixava a caixa e tirava
     *  o hífen — e o segundo fator passou a recusar códigos CORRETOS, deixando sem
     *  saída justamente quem perdeu o celular. O que se normaliza é só o que o teclado
     *  acrescenta (espaço), e o hífen é reposto quando ele não vem.
     */
    expect(normalizeBackupCode('ABCDE-FGHIJ')).toBe('ABCDE-FGHIJ');
    expect(normalizeBackupCode('ABCDEFGHIJ')).toBe('ABCDE-FGHIJ');
    expect(normalizeBackupCode(' ABCDE FGHIJ ')).toBe('ABCDE-FGHIJ');
    expect(normalizeBackupCode('a1b2C-d3e4F')).toBe('a1b2C-d3e4F');
  });

  it('recusa o que não tem o tamanho de código de recuperação', () => {
    expect(normalizeBackupCode('abc')).toBeNull();
    expect(normalizeBackupCode('abcdefghijkl')).toBeNull();
    expect(normalizeBackupCode('abcdefgh!j')).toBeNull();
    expect(normalizeBackupCode('')).toBeNull();
    expect(normalizeBackupCode(undefined)).toBeNull();
  });

  it('mostra o código em grupos, para quem copiou no papel não errar', () => {
    expect(formatBackupCode('ABCDEFGHIJ')).toBe('ABCDE-FGHIJ');
    expect(formatBackupCode('ABCDE-FGHIJ')).toBe('ABCDE-FGHIJ');
  });

  it('extrai a chave digitável do URI do aplicativo — e só de um URI de TOTP', () => {
    const uri =
      'otpauth://totp/EventFlow:ana@example.test?secret=JBSWY3DPEHPK3PXP&issuer=EventFlow&period=30';

    expect(totpSecretFromUri(uri)).toBe('JBSWY3DPEHPK3PXP');
    // URI de outro tipo, texto solto ou valor ausente não viram "chave".
    expect(totpSecretFromUri('otpauth://hotp/x?secret=ABC')).toBeNull();
    expect(totpSecretFromUri('JBSWY3DPEHPK3PXP')).toBeNull();
    expect(totpSecretFromUri('otpauth://totp/x?issuer=Y')).toBeNull();
    expect(totpSecretFromUri(null)).toBeNull();
  });
});

describe('senha', () => {
  it('a confirmação precisa ser igual — e vazia não vale', () => {
    expect(passwordsMatch('frase-longa-1', 'frase-longa-1')).toBe(true);
    expect(passwordsMatch('frase-longa-1', 'frase-longa-2')).toBe(false);
    expect(passwordsMatch('', '')).toBe(false);
  });

  it('o texto da tela diz o mesmo mínimo que o servidor aplica', () => {
    expect(passwordHint()).toContain(String(PASSWORD_MIN_LENGTH));
  });
});

describe('e-mail da conta', () => {
  it('compara sem caixa e sem espaços das pontas', () => {
    expect(isSameEmail('Ana@Example.test', ' ana@example.TEST ')).toBe(true);
    expect(isSameEmail('ana@example.test', 'ana2@example.test')).toBe(false);
  });
});

describe('rótulo do dispositivo', () => {
  it('reconhece sistema e navegador do dia a dia', () => {
    const chromeWindows =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

    expect(describeSession(chromeWindows)).toEqual({ device: 'Windows', browser: 'Chrome' });

    const firefoxLinux = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';
    expect(describeSession(firefoxLinux)).toEqual({ device: 'Linux', browser: 'Firefox' });

    const safariIphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    expect(describeSession(safariIphone)).toEqual({ device: 'iPhone ou iPad', browser: 'Safari' });
  });

  it('não diz "Chrome" para quem está no Edge — a ordem das checagens importa', () => {
    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0';

    expect(describeSession(edge).browser).toBe('Edge');
  });

  it('sem reconhecimento, o rótulo é honesto em vez de adivinhado', () => {
    expect(describeSession(null)).toEqual({
      device: 'Dispositivo não identificado',
      browser: 'Navegador não identificado',
    });
    expect(describeSession('')).toEqual({
      device: 'Dispositivo não identificado',
      browser: 'Navegador não identificado',
    });
    expect(describeSession('curl/8.5.0')).toEqual({
      device: 'Dispositivo não identificado',
      browser: 'Navegador não identificado',
    });
  });
});

describe('ordem das sessões', () => {
  it('a sessão de agora vem primeiro; depois, as mais recentes', () => {
    const ordered = orderSessionsForDisplay([
      { token: 'a', isCurrent: false, lastUsedAt: '2026-01-01T10:00:00.000Z' },
      { token: 'b', isCurrent: true, lastUsedAt: '2025-12-01T10:00:00.000Z' },
      { token: 'c', isCurrent: false, lastUsedAt: '2026-02-01T10:00:00.000Z' },
    ]);

    expect(ordered.map((session) => session.token)).toEqual(['b', 'c', 'a']);
  });
});
