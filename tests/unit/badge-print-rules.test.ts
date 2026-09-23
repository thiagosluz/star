/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Impressão do crachá: folha adesiva e ZPL (FASE 37)
 *
 *  O que só o domínio pode provar, e por que cada um importa:
 *
 *    • **a geometria em milímetros vira a posição certa em pontos** — 1 mm de erro
 *      significa etiqueta saindo torta ou QR caindo na etiqueta do vizinho, e isso só se
 *      descobre gastando folha;
 *    • **grade que não cabe em A4 é RECUSADA** com o quanto ela ocuparia;
 *    • **o ZPL carrega as três coisas** (QR com o código, nome, código por extenso) e
 *      **escapa o que a linguagem usa como comando** — um acento ou um `^` no nome não
 *      pode virar comando e mandar a impressora fazer outra coisa;
 *    • **os pontos seguem o DPI**: a mesma medida de 100 mm é 799 pontos em 203 dpi e
 *      1181 em 300.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  DEFAULT_LABEL_LAYOUT,
  DEFAULT_THERMAL_CONFIG,
  MM_TO_PT,
  ZPL_NAME_MAX_LINES,
  buildBadgeZpl,
  buildBadgeZplBatch,
  fitZplName,
  labelLayoutFromParams,
  labelPositions,
  labelsPerPage,
  mmToDots,
  mmToPt,
  thermalConfigFromParams,
  validateLabelLayout,
  validateThermalConfig,
  zplFieldText,
} from '../../src/domain/events/badge-print-rules';

const params = (query: string) => new URLSearchParams(query);

describe('unidades', () => {
  it('milímetros viram pontos de PDF', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 6);
    expect(mmToPt(63.5)).toBeCloseTo(180, 6);
    expect(MM_TO_PT).toBeCloseTo(2.8346, 4);
  });

  it('milímetros viram pontos da impressora, no DPI informado', () => {
    // 100 mm em 203 dpi (8 pontos/mm) e em 300 dpi (11,8 pontos/mm).
    expect(mmToDots(100, 203)).toBe(799);
    expect(mmToDots(100, 300)).toBe(1181);
    expect(mmToDots(50, 203)).toBe(400);
  });
});

describe('folha de etiquetas', () => {
  it('o padrão é 3 × 8 de 63,5 × 33,9 mm e CABE em A4', () => {
    expect(DEFAULT_LABEL_LAYOUT).toMatchObject({
      columns: 3,
      rows: 8,
      labelWidthMm: 63.5,
      labelHeightMm: 33.9,
    });
    expect(labelsPerPage(DEFAULT_LABEL_LAYOUT)).toBe(24);
    expect(validateLabelLayout(DEFAULT_LABEL_LAYOUT)).toEqual({ ok: true });
  });

  it('posiciona as etiquetas na ordem de LEITURA, de cima para baixo', () => {
    const positions = labelPositions(DEFAULT_LABEL_LAYOUT);

    expect(positions).toHaveLength(24);

    const [first] = positions;
    const second = positions[1]!;
    const secondRow = positions[3]!;

    // Primeira etiqueta: margem esquerda e margem superior, em pontos.
    expect(first!.x).toBeCloseTo(mmToPt(DEFAULT_LABEL_LAYOUT.marginLeftMm), 6);
    expect(first!.y).toBeCloseTo(
      mmToPt(A4_HEIGHT_MM) - mmToPt(DEFAULT_LABEL_LAYOUT.marginTopMm) - mmToPt(DEFAULT_LABEL_LAYOUT.labelHeightMm),
      6,
    );

    // A segunda está à direita; a quarta está ABAIXO da primeira, na mesma coluna.
    expect(second.x).toBeGreaterThan(first!.x);
    expect(second.y).toBeCloseTo(first!.y, 6);
    expect(secondRow.x).toBeCloseTo(first!.x, 6);
    expect(secondRow.y).toBeLessThan(first!.y);

    // E nenhuma sai da folha.
    for (const position of positions) {
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.x + position.width).toBeLessThanOrEqual(mmToPt(A4_WIDTH_MM) + 0.01);
      expect(position.y + position.height).toBeLessThanOrEqual(mmToPt(A4_HEIGHT_MM) + 0.01);
    }
  });

  it('o espaço entre etiquetas é somado ao avanço da grade', () => {
    const withGap = { ...DEFAULT_LABEL_LAYOUT, gapXMm: 2 };
    const positions = labelPositions(withGap);

    expect(positions[1]!.x - positions[0]!.x).toBeCloseTo(mmToPt(63.5 + 2), 6);
  });

  it('grade que não cabe em A4 é RECUSADA com o tamanho que ocuparia', () => {
    const tooWide = validateLabelLayout({ ...DEFAULT_LABEL_LAYOUT, labelWidthMm: 100 });

    expect(tooWide.ok).toBe(false);
    if (!tooWide.ok) {
      expect(tooWide.code).toBe('DOES_NOT_FIT');
      expect(tooWide.message).toContain(`${A4_WIDTH_MM}`);
      expect(tooWide.message).toContain('cabe em A4');
    }

    const tooTall = validateLabelLayout({ ...DEFAULT_LABEL_LAYOUT, rows: 12 });

    expect(tooTall.ok).toBe(false);
  });

  it('recusa coluna/linha fora do intervalo e medida absurda', () => {
    expect(validateLabelLayout({ ...DEFAULT_LABEL_LAYOUT, columns: 0 }).ok).toBe(false);
    expect(validateLabelLayout({ ...DEFAULT_LABEL_LAYOUT, columns: 9 }).ok).toBe(false);
    expect(validateLabelLayout({ ...DEFAULT_LABEL_LAYOUT, rows: 0 }).ok).toBe(false);
    expect(validateLabelLayout({ ...DEFAULT_LABEL_LAYOUT, columns: 2.5 }).ok).toBe(false);
    expect(validateLabelLayout({ ...DEFAULT_LABEL_LAYOUT, labelHeightMm: 5 }).ok).toBe(false);
    expect(validateLabelLayout({ ...DEFAULT_LABEL_LAYOUT, marginLeftMm: -1 }).ok).toBe(false);
  });

  it('a query preenche só o que falta — e o campo VAZIO explícito é respeitado', () => {
    const defaults = labelLayoutFromParams(params(''));

    expect(defaults.ok).toBe(true);
    if (defaults.ok) expect(defaults.layout).toEqual(DEFAULT_LABEL_LAYOUT);

    const custom = labelLayoutFromParams(
      params('colunas=2&linhas=5&largura=70&altura=37&margem-esquerda=0&margem-superior=10'),
    );

    expect(custom.ok).toBe(true);
    if (custom.ok) {
      expect(custom.layout).toMatchObject({
        columns: 2,
        rows: 5,
        labelWidthMm: 70,
        labelHeightMm: 37,
        marginLeftMm: 0,
        marginTopMm: 10,
      });
    }
  });

  it('aceita vírgula decimal (é como a régua do brasileiro lê)', () => {
    const parsed = labelLayoutFromParams(params('largura=63,5&altura=33,9'));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.layout.labelWidthMm).toBe(63.5);
      expect(parsed.layout.labelHeightMm).toBe(33.9);
    }
  });

  it('a query que não cabe volta como recusa, e não como layout', () => {
    const parsed = labelLayoutFromParams(params('colunas=5&largura=60'));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('DOES_NOT_FIT');
  });

  /**
   * Medida que não é número é ERRO, e não "usa o padrão": substituir em silêncio "6 3,5"
   * por 63,5 mm imprimiria a folha inteira na medida errada, e ninguém saberia até gastar
   * a etiqueta. Ausente (ou vazio, como o formulário manda) continua valendo o padrão.
   */
  it('medida que não é número é RECUSADA, com o campo no nome', () => {
    const texto = labelLayoutFromParams(params('largura=6 3,5'));

    expect(texto.ok).toBe(false);
    if (!texto.ok) {
      expect(texto.code).toBe('INVALID');
      expect(texto.message).toContain('largura');
    }

    const vazio = labelLayoutFromParams(params('largura=&altura='));

    expect(vazio.ok).toBe(true);
    if (vazio.ok) expect(vazio.layout.labelWidthMm).toBe(DEFAULT_LABEL_LAYOUT.labelWidthMm);
  });
});

describe('ZPL — o texto que a impressora térmica lê', () => {
  const badge = {
    name: 'Ana Souza',
    code: 'CR-ABCD-EFGH',
    eventTitle: 'Congresso de Tecnologia',
    tenantName: 'UFBA',
  };

  it('o padrão é 203 dpi com etiqueta de 100 × 50 mm', () => {
    expect(DEFAULT_THERMAL_CONFIG).toMatchObject({ dpi: 203, widthMm: 100, heightMm: 50 });
    expect(validateThermalConfig(DEFAULT_THERMAL_CONFIG)).toEqual({ ok: true });
  });

  it('abre e fecha o rótulo, declara UTF-8 e o tamanho em PONTOS', () => {
    const zpl = buildBadgeZpl(badge, DEFAULT_THERMAL_CONFIG);

    expect(zpl.startsWith('^XA\n')).toBe(true);
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true);
    expect(zpl).toContain('^CI28');
    expect(zpl).toContain(`^PW${mmToDots(100, 203)}`);
    expect(zpl).toContain(`^LL${mmToDots(50, 203)}`);
  });

  it('leva o QR com o CÓDIGO, o NOME e o código por extenso', () => {
    const zpl = buildBadgeZpl(badge, DEFAULT_THERMAL_CONFIG);

    expect(zpl).toContain('^BQN,2,3');
    expect(zpl).toContain('^FDLA,CR-ABCD-EFGH^FS');
    expect(zpl).toContain('^FH^FDAna Souza^FS');
    /** O `·` também é byte fora do ASCII: sai como par hexadecimal. */
    expect(zpl).toContain('UFBA _C2_B7 Congresso de Tecnologia');
  });

  it('o MESMO lote gera o MESMO texto (determinismo)', () => {
    expect(buildBadgeZpl(badge, DEFAULT_THERMAL_CONFIG)).toBe(
      buildBadgeZpl(badge, DEFAULT_THERMAL_CONFIG),
    );
  });

  it('escapa o que a linguagem usa como comando', () => {
    // Acento vira par hexadecimal (UTF-8), e `^`, `~` e `_` não podem virar comando.
    expect(zplFieldText('Conceição')).toBe('Concei_C3_A7_C3_A3o');
    expect(zplFieldText('A^B~C_D')).toBe('A_5EB_7EC_5FD');

    const zpl = buildBadgeZpl({ ...badge, name: 'João ^ Silva' }, DEFAULT_THERMAL_CONFIG);

    expect(zpl).toContain('^FH^FDJo_C3_A3o _5E^FS');
    expect(zpl).toContain('^FH^FDSilva^FS');
    /** O acento NUNCA vai cru: a impressora recebe `_C3_A3`, não `ã`. */
    expect(zpl).not.toContain('João');
  });

  it('o nome INTEIRO cabe: o corpo da letra cai até o nome caber, em até 3 linhas', () => {
    const long = 'Maria da Conceição Aparecida dos Santos Oliveira Albuquerque';

    const fitted = fitZplName(long, 487, 400, 234);

    /** Nenhuma palavra se perde: o que saiu, junto, é o nome pedido. */
    expect(fitted.lines.join(' ')).toBe(long);
    expect(fitted.lines.length).toBeLessThanOrEqual(ZPL_NAME_MAX_LINES);
    expect(fitted.lines.length).toBeGreaterThan(1);

    const zpl = buildBadgeZpl({ ...badge, name: long }, DEFAULT_THERMAL_CONFIG);

    // As linhas do nome + o código + a origem, todas com fonte própria.
    expect(zpl.split('^A0N,').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('nome curto usa corpo MAIOR que o nome comprido (a proporção responde ao texto)', () => {
    const short = buildBadgeZpl(badge, DEFAULT_THERMAL_CONFIG);
    const long = buildBadgeZpl(
      { ...badge, name: 'Maria da Conceição Aparecida dos Santos Oliveira Albuquerque' },
      DEFAULT_THERMAL_CONFIG,
    );

    const fontOf = (zpl: string): number => Number(/\^A0N,(\d+),/.exec(zpl)?.[1] ?? 0);

    expect(fontOf(short)).toBeGreaterThan(fontOf(long));
  });

  it('o lote é uma etiqueta por crachá, na ordem da lista', () => {
    const zpl = buildBadgeZplBatch(
      [badge, { ...badge, name: 'Bruno Lima', code: 'CR-ABCD-EFGI' }],
      DEFAULT_THERMAL_CONFIG,
    );

    expect(zpl.split('^XA').length - 1).toBe(2);
    expect(zpl.split('^XZ').length - 1).toBe(2);
    expect(zpl.indexOf('Ana Souza')).toBeLessThan(zpl.indexOf('Bruno Lima'));
  });

  it('300 dpi dobra a contagem de pontos da mesma medida', () => {
    const zpl = buildBadgeZpl(badge, { ...DEFAULT_THERMAL_CONFIG, dpi: 300 });

    expect(zpl).toContain(`^PW${mmToDots(100, 300)}`);
    expect(zpl).toContain(`^LL${mmToDots(50, 300)}`);
  });

  it('recusa DPI desconhecido, medida absurda e ampliação fora da faixa', () => {
    expect(validateThermalConfig({ ...DEFAULT_THERMAL_CONFIG, dpi: 600 as never }).ok).toBe(false);
    expect(validateThermalConfig({ ...DEFAULT_THERMAL_CONFIG, widthMm: 5 }).ok).toBe(false);
    expect(validateThermalConfig({ ...DEFAULT_THERMAL_CONFIG, heightMm: 999 }).ok).toBe(false);
    expect(validateThermalConfig({ ...DEFAULT_THERMAL_CONFIG, qrMagnification: 0 }).ok).toBe(false);
    expect(validateThermalConfig({ ...DEFAULT_THERMAL_CONFIG, qrMagnification: 11 }).ok).toBe(false);
  });

  it('a query preenche a configuração e recusa o que não entende', () => {
    const defaults = thermalConfigFromParams(params(''));

    expect(defaults.ok).toBe(true);
    if (defaults.ok) expect(defaults.config).toEqual(DEFAULT_THERMAL_CONFIG);

    const custom = thermalConfigFromParams(params('dpi=300&largura=60&altura=40&ampliacao-qr=5'));

    expect(custom.ok).toBe(true);
    if (custom.ok) {
      expect(custom.config).toEqual({ dpi: 300, widthMm: 60, heightMm: 40, qrMagnification: 5 });
    }

    /**
     * ─── O DPI ERRADO É RECUSADO, NÃO TROCADO PELO PADRÃO ──────────────────────
     *
     *  `^PW`/`^LL` são contagens de PONTOS: a mesma etiqueta de 100 mm impressa a 203 dpi
     *  numa impressora de 300 dpi sai MENOR, sem erro nenhum. Cair para o padrão em
     *  silêncio produziria uma etiqueta fisicamente errada — e o operador só descobriria
     *  com o rolo na mão.
     */
    const wrongDpi = thermalConfigFromParams(params('dpi=111'));

    expect(wrongDpi.ok).toBe(false);
    if (!wrongDpi.ok) {
      expect(wrongDpi.message).toMatch(/dpi/i);
      expect(wrongDpi.message).toContain('111');
    }

    /** Texto que não é número também é recusado, e a mensagem nomeia o campo. */
    const texto = thermalConfigFromParams(params('largura=abc'));

    expect(texto.ok).toBe(false);
    if (!texto.ok) expect(texto.message).toContain('largura');

    expect(thermalConfigFromParams(params('largura=1')).ok).toBe(false);
  });
});
