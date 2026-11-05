/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 86 · FATIA 3 — AS DUAS REGRAS QUE O EDITOR ACRESCENTOU AO DOMÍNIO
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • o conflito `BODY` + variável `corpo` é RECUSADO pelo validador (o texto sairia
 *    duas vezes) — e a mensagem diz qual dos dois remover;
 *  • a altura sugerida pelo botão "aumentar a caixa" é a INVERSA da mesma régua de
 *    `fitTextInBox`, e o resultado realmente comporta as linhas medidas;
 *  • quando a página não comporta a altura, o retorno diz isso (`clamped`) em vez de
 *    prometer um ajuste que o papel não permite.
 *
 *  A tela é testada no navegador (`tests/e2e/f86-corpo-do-certificado.spec.ts`); aqui
 *  ficam as contas, que são o que o botão e o aviso usam.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  bodyBoxHeightForLines,
  buildLayoutFromRows,
  measureCertificateBody,
  validateLayout,
  type CertificateLayout,
  type CertificateLayoutElement,
} from '../../src/domain/certificates/certificate-layout-rules';

function element(partial: Partial<CertificateLayoutElement> & { id: string }): CertificateLayoutElement {
  return {
    kind: 'TEXT',
    xMm: 20,
    yMm: 20,
    widthMm: 100,
    heightMm: 10,
    align: 'LEFT',
    font: 'HELVETICA',
    sizePt: 12,
    color: '#111827',
    lineHeight: 1.4,
    text: 'Texto',
    variable: null,
    ...partial,
  };
}

/** O bloco probatório que `validateLayout` exige em todo modelo. */
function probatory(): CertificateLayoutElement[] {
  return [
    element({ id: 'codigo', kind: 'VARIABLE', variable: 'codigo_validacao', text: null }),
    element({ id: 'url', kind: 'VARIABLE', variable: 'url_validacao', text: null }),
    element({ id: 'qr', kind: 'QR', text: null, widthMm: 30, heightMm: 30 }),
  ];
}

function body(text: string): CertificateLayoutElement {
  return element({
    id: 'corpo-gabarito',
    kind: 'BODY',
    xMm: 24,
    yMm: 90,
    widthMm: 249,
    heightMm: 40,
    sizePt: 13,
    lineHeight: 1.6,
    text,
  });
}

function layout(elements: CertificateLayoutElement[]): CertificateLayout {
  return { page: 'A4_LANDSCAPE', background: null, elements };
}

describe('o conflito entre o corpo próprio e a variável `corpo`', () => {
  it('é RECUSADO, com os dois lados nomeados na mensagem', () => {
    const verdict = validateLayout(
      layout([
        ...probatory(),
        body('Certificamos que {{nome}} participou.'),
        element({ id: 'texto-formal', kind: 'VARIABLE', variable: 'corpo', text: null }),
      ]),
    );

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;

    const issue = verdict.issues.find((item) => item.code === 'BODY_AND_BODY_VARIABLE');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('duas vezes');
    expect(issue?.message).toContain('{{corpo}}');
  });

  it('sem a variável `corpo`, o mesmo corpo é aceito', () => {
    const verdict = validateLayout(layout([...probatory(), body('Certificamos que {{nome}} participou.')]));

    expect(verdict.ok).toBe(true);
  });

  it('sem corpo próprio, a variável `corpo` continua válida (modelos anteriores à fase)', () => {
    const verdict = validateLayout(
      layout([
        ...probatory(),
        element({ id: 'texto-formal', kind: 'VARIABLE', variable: 'corpo', text: null }),
      ]),
    );

    expect(verdict.ok).toBe(true);
  });
});

describe('a porta do formulário normaliza a quebra de linha', () => {
  it('CRLF do navegador vira `\\n` no layout gravado', () => {
    const built = buildLayoutFromRows({
      page: 'A4_LANDSCAPE',
      background: null,
      ids: ['corpo'],
      kinds: ['BODY'],
      texts: ['Certificamos que {{nome}}.\r\nCarga horária: {{carga_horaria}}.'],
      variables: [''],
      xMm: ['24'],
      yMm: ['90'],
      widthMm: ['249'],
      heightMm: ['40'],
      aligns: ['CENTER'],
      fonts: ['HELVETICA'],
      sizePt: ['13'],
      colors: ['#111827'],
      lineHeights: ['1.6'],
    });

    expect(built.elements[0]?.text).toBe(
      'Certificamos que {{nome}}.\nCarga horária: {{carga_horaria}}.',
    );
    expect(built.elements[0]?.text).not.toContain('\r');
  });
});

describe('a altura que comporta as linhas medidas', () => {
  it('devolve a altura necessária e o resultado realmente cabe', () => {
    const fit = measureCertificateBody({
      text: 'uma\nduas\ntres\nquatro\ncinco',
      box: { widthMm: 100, heightMm: 21.5, sizePt: 10, lineHeight: 1.5 },
    });

    expect(fit.fits).toBe(false);
    expect(fit.overflowLines).toBe(1);

    const suggestion = bodyBoxHeightForLines({
      lineCount: fit.lineCount,
      sizePt: 10,
      lineHeight: 1.5,
      page: 'A4_LANDSCAPE',
      topMm: 21.5,
    });

    expect(suggestion.clamped).toBe(false);
    expect(suggestion.heightMm).toBe(26.5);

    const after = measureCertificateBody({
      text: 'uma\nduas\ntres\nquatro\ncinco',
      box: { widthMm: 100, heightMm: suggestion.heightMm, sizePt: 10, lineHeight: 1.5 },
    });

    expect(after.fits).toBe(true);
    expect(after.maxLines).toBeGreaterThanOrEqual(5);
  });

  it('uma linha a mais pede uma altura maior (a conta acompanha o texto)', () => {
    const one = bodyBoxHeightForLines({ lineCount: 5, sizePt: 13, lineHeight: 1.6, page: 'A4_LANDSCAPE', topMm: 90 });
    const two = bodyBoxHeightForLines({ lineCount: 6, sizePt: 13, lineHeight: 1.6, page: 'A4_LANDSCAPE', topMm: 90 });

    expect(two.heightMm).toBeGreaterThan(one.heightMm);
    expect(one.heightMm).toBeCloseTo(36.7, 1);
  });

  it('quando a página não comporta, diz `clamped` e não passa do teto', () => {
    const suggestion = bodyBoxHeightForLines({
      lineCount: 20,
      sizePt: 13,
      lineHeight: 1.6,
      page: 'A4_LANDSCAPE',
      topMm: 200,
    });

    expect(suggestion.clamped).toBe(true);
    expect(suggestion.maxHeightMm).toBe(10);
    expect(suggestion.heightMm).toBeLessThanOrEqual(suggestion.maxHeightMm);
  });

  it('a altura sugerida nunca é menor que o lado mínimo do elemento', () => {
    const suggestion = bodyBoxHeightForLines({
      lineCount: 1,
      sizePt: 6,
      lineHeight: 1,
      page: 'A4_LANDSCAPE',
      topMm: 205,
    });

    expect(suggestion.heightMm).toBeGreaterThanOrEqual(3);
  });
});
