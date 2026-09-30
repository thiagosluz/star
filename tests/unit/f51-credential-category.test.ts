/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Categoria do crachá (FASE 51 · dívida E42)
 *
 *  O que só o domínio pode provar, e por que cada um importa:
 *
 *    • **o catálogo é FECHADO e tem padrão** — a coluna é texto livre no banco, e um
 *      valor estranho não pode deixar a pessoa sem crachá na porta nem inventar uma
 *      cor que ninguém sabe ler;
 *    • **a cor de cada categoria é a do TOKEN do design system** — o teste lê o
 *      `globals.css` e falha se os dois divergirem. É a mesma defesa da paleta do
 *      e-mail: PDF e impressora térmica não resolvem variável CSS, então o valor tem
 *      de estar escrito em algum lugar, e esse lugar é UM só;
 *    • **o hexadecimal vira operador de PDF** — e valor que não é cor vira `null`, e
 *      não `NaN`: um `NaN` no meio do stream não lança, ele CORROMPE o arquivo;
 *    • **a faixa tem altura por etiqueta** — a folha A4 (193 pt de célula) e o rolo
 *      de 100 × 50 mm precisam concordar sobre onde a cor fica;
 *    • **quatro desenhos leem a MESMA régua** — PDF, etiqueta, ZPL e crachá online.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CREDENTIAL_CATEGORIES,
  CREDENTIAL_CATEGORY_DEFINITIONS,
  CREDENTIAL_CATEGORY_LIST,
  CREDENTIAL_CATEGORY_PALETTE,
  CREDENTIAL_CATEGORY_TONES,
  CREDENTIAL_CATEGORY_TOKENS,
  CREDENTIAL_STRIPE_MAX_PT,
  CREDENTIAL_STRIPE_MIN_PT,
  DEFAULT_CREDENTIAL_CATEGORY,
  credentialCategoryColor,
  credentialCategoryLabel,
  credentialCategoryToken,
  credentialCategoryTone,
  credentialStripeHeight,
  isKnownCredentialCategory,
  pdfFillOperator,
  pdfRgb,
  resolveCredentialCategory,
} from '../../src/domain/events/credential-categories';
import { CREDENTIAL_CATEGORY_LIST as VIA_REGRA } from '../../src/domain/events/credential-rules';
import { buildBadgeZpl, DEFAULT_THERMAL_CONFIG } from '../../src/domain/events/badge-print-rules';
describe('o catálogo de categorias', () => {
  it('tem as seis categorias, com PARTICIPANT como padrão', () => {
    expect([...CREDENTIAL_CATEGORIES]).toEqual([
      'PARTICIPANT',
      'SPEAKER',
      'STAFF',
      'PRESS',
      'VIP',
      'GUEST',
    ]);
    expect(DEFAULT_CREDENTIAL_CATEGORY).toBe('PARTICIPANT');
  });

  it('toda categoria tem rótulo em português, descrição e cor', () => {
    for (const definition of CREDENTIAL_CATEGORY_LIST) {
      expect(definition.label.length, `${definition.key} sem rótulo`).toBeGreaterThan(2);

      /** O rótulo é para GENTE: identificador em caixa alta não é rótulo. */
      expect(definition.label).not.toBe(definition.key);
      expect(definition.description.length).toBeGreaterThan(10);
      expect(definition.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(definition.colorToken).toMatch(/^--ef-/);
      expect(CREDENTIAL_CATEGORY_TONES).toContain(definition.tone);
    }
  });

  it('a LISTA é a ordem do catálogo, e o padrão vem primeiro', () => {
    expect(CREDENTIAL_CATEGORY_LIST.map((item) => item.key)).toEqual([...CREDENTIAL_CATEGORIES]);
    expect(CREDENTIAL_CATEGORY_LIST[0]?.key).toBe(DEFAULT_CREDENTIAL_CATEGORY);
  });

  it('o módulo de regras do crachá reexporta a MESMA lista (uma porta de entrada)', () => {
    expect(VIA_REGRA).toBe(CREDENTIAL_CATEGORY_LIST);
  });

  it('nenhuma categoria repete a cor de outra', () => {
    const colors = CREDENTIAL_CATEGORY_LIST.map((item) => item.color);

    expect(new Set(colors).size).toBe(CREDENTIAL_CATEGORY_LIST.length);
  });

  it('o resolvedor aceita o valor em qualquer caixa e com espaço', () => {
    expect(resolveCredentialCategory('staff').key).toBe('STAFF');
    expect(resolveCredentialCategory('  SpeakeR  ').key).toBe('SPEAKER');
    expect(isKnownCredentialCategory('vip')).toBe(true);
  });

  it('valor DESCONHECIDO cai no padrão, e o padrão é dito (não inventado)', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE A RESPOSTA É O PADRÃO, E NÃO UMA RECUSA
     * ─────────────────────────────────────────────────────────────────────────────
     *  Recusar deixaria a pessoa SEM crachá na porta — pior que um crachá de
     *  participante. Inventar uma categoria faria a cor perder o sentido, que é o
     *  que a dívida E42 veio consertar. O que o chamador que precisa AVISAR usa é
     *  `isKnownCredentialCategory`, e ele é falso aqui.
     */
    for (const weird of [null, undefined, '', '   ', 'CHEFE', 'PARTICIPANTE', '0', 'STAFF ']) {
      const definition = resolveCredentialCategory(weird);

      if (weird === 'STAFF ') {
        expect(definition.key).toBe('STAFF');
        continue;
      }

      expect(definition.key, `"${String(weird)}" deveria cair no padrão`).toBe(
        DEFAULT_CREDENTIAL_CATEGORY,
      );
      expect(isKnownCredentialCategory(weird)).toBe(false);
    }
  });

  it('as funções de conveniência concordam com a definição', () => {
    const speaker = CREDENTIAL_CATEGORY_DEFINITIONS.SPEAKER;

    expect(credentialCategoryLabel('SPEAKER')).toBe(speaker.label);
    expect(credentialCategoryColor('speaker')).toBe(speaker.color);
    expect(credentialCategoryToken('SPEAKER')).toBe(speaker.colorToken);
    expect(credentialCategoryTone('SPEAKER')).toBe(speaker.tone);

    /** Sem categoria explícita, tudo vem do padrão. */
    expect(credentialCategoryLabel(null)).toBe('Participante');
    expect(credentialCategoryColor(undefined)).toBe(CREDENTIAL_CATEGORY_PALETTE.primary);
  });
});

describe('a cor de cada categoria é a do token do design system', () => {
  it('cada valor espelha o declarado no globals.css', () => {
    /**
     * A MESMA trava do e-mail transacional: o valor literal é uma exceção técnica
     * (PDF e impressora não resolvem `var()`), e a defesa contra virar uma segunda
     * identidade que ninguém atualiza é este teste.
     */
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

    for (const [key, token] of Object.entries(CREDENTIAL_CATEGORY_TOKENS)) {
      const value = CREDENTIAL_CATEGORY_PALETTE[key as keyof typeof CREDENTIAL_CATEGORY_PALETTE];
      const declaration = new RegExp(`${token}:\\s*([^;]+);`).exec(css);

      expect(declaration, `token ${token} ausente no globals.css`).toBeTruthy();
      expect(
        declaration?.[1]?.trim().toLowerCase(),
        `${token} divergiu: o crachá usa ${value} e o globals.css tem ${declaration?.[1]?.trim()}`,
      ).toBe(value.toLowerCase());
    }
  });
});

describe('hexadecimal → operador de PDF', () => {
  it('converte 6 dígitos em componentes de 0 a 1', () => {
    expect(pdfRgb('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(pdfRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });

    const half = pdfRgb('#808080');
    expect(half?.r).toBeCloseTo(0.502, 2);
  });

  it('aceita a forma curta (#rgb) e o espaço em volta', () => {
    const short = pdfRgb('#fff');
    const long = pdfRgb('  #ffffff  ');

    expect(short).toEqual(long);
  });

  it('valor que NÃO é cor devolve null — nunca NaN', () => {
    /**
     * Um `NaN` no meio dos operadores de PDF não lança: ele gera um arquivo
     * corrompido, e o defeito aparece na impressora, não no teste.
     */
    for (const bad of [null, undefined, 42, {}, '', 'vermelho', 'rgb(1,2,3)', '#12345', 'oklch(0.5 0.1 200)']) {
      expect(pdfRgb(bad), `${String(bad)} deveria ser recusado`).toBeNull();
    }
  });

  it('o operador de preenchimento sai em três casas, com queda para preto', () => {
    expect(pdfFillOperator('#000000')).toBe('0.000 0.000 0.000 rg');
    expect(pdfFillOperator('#ffffff')).toBe('1.000 1.000 1.000 rg');
    expect(pdfFillOperator('não é cor')).toBe('0 0 0 rg');
  });

  it('o valor de cada categoria vira operador válido', () => {
    for (const definition of CREDENTIAL_CATEGORY_LIST) {
      expect(pdfFillOperator(definition.color)).toMatch(/^[\d.]+ [\d.]+ [\d.]+ rg$/);
    }
  });
});

describe('a faixa da categoria', () => {
  it('fica entre o piso e o teto, em qualquer tamanho de etiqueta', () => {
    /** A célula da folha A4 da FASE 31 tem ~193 pt; o rolo de 100 × 50 mm, ~400. */
    const sizes = [40, 96, 193, 400, 1000];

    for (const size of sizes) {
      const height = credentialStripeHeight(size);

      expect(height).toBeGreaterThanOrEqual(CREDENTIAL_STRIPE_MIN_PT);
      expect(height).toBeLessThanOrEqual(CREDENTIAL_STRIPE_MAX_PT);
    }
  });

  it('cresce com a etiqueta, mas nunca estoura o teto', () => {
    expect(credentialStripeHeight(400)).toBeGreaterThan(credentialStripeHeight(96));
    expect(credentialStripeHeight(10_000)).toBe(CREDENTIAL_STRIPE_MAX_PT);
  });

  it('a etiqueta adesiva de 33,9 mm fica com uma faixa FINA (não dominante)', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O DEFEITO QUE ESTE CASO PRENDE (FASE 51 · E42)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Com o piso de 5 pt aplicado sozinho, a etiqueta adesiva de 63,5 × 33,9 mm
     *  (~96 pt de célula) ficava com **5,2%** da altura em faixa, e o desenho ainda
     *  reserva 10 pt de respiro acima do nome: os 15 pt comiam o espaço do QR.
     *
     *  A régua agora é proporcional: em 96 pt a faixa tem ~6,7 pt (7%), que é menos
     *  de um décimo da etiqueta — visível e não dominante.
     */
    const alturaDaEtiqueta = (96 * 72) / 72; // 33,9 mm em pontos ≈ 96
    const faixa = credentialStripeHeight(alturaDaEtiqueta);
    const respiroDoNome = 10;

    expect(faixa).toBeLessThan(alturaDaEtiqueta * 0.08);
    /** Sobra para o QR (53 pt) e para o bloco de texto. */
    expect(faixa + respiroDoNome + 53).toBeLessThan(alturaDaEtiqueta);
  });

  it('valor não finito não vira NaN na geometria', () => {
    expect(Number.isFinite(credentialStripeHeight(Number.NaN))).toBe(true);
    expect(credentialStripeHeight(Number.NaN)).toBe(CREDENTIAL_STRIPE_MIN_PT);
    expect(credentialStripeHeight(-100)).toBe(CREDENTIAL_STRIPE_MIN_PT);
  });
});

describe('o ZPL leva a faixa e desloca o conteúdo', () => {
  const badge = { name: 'Ana Souza', code: 'CR-ABCD-EFGH', eventTitle: 'Congresso', tenantName: 'UFBA' };

  /**
   * A altura da barra sai do DOMÍNIO, e não de um número copiado aqui: se ela mudar
   * de proporção, o teste continua medindo o CONTRATO (a barra existe, com a largura
   * da etiqueta, e o conteúdo desce por ela) em vez de travar a constante.
   */
  const stripeOf = (heightDots: number) => Math.round(credentialStripeHeight(heightDots));
  /** 100 mm a 203 dpi = 799 pontos; 50 mm = 400. */
  const WIDTH_DOTS = 799;
  const HEIGHT_DOTS = 400;
  const PADDING_DOTS = 24;

  it('desenha a barra no topo, com a largura da etiqueta', () => {
    const zpl = buildBadgeZpl({ ...badge, category: 'STAFF' }, DEFAULT_THERMAL_CONFIG);
    const bar = `^FO0,0^GB${WIDTH_DOTS},${stripeOf(HEIGHT_DOTS)},${stripeOf(HEIGHT_DOTS)}^FS`;

    expect(zpl).toContain(bar);
    /** Uma barra por etiqueta — não uma por categoria. */
    expect(zpl.split(bar).length - 1).toBe(1);
  });

  it('PARTICIPANT e STAFF saem com a MESMA barra — a térmica tem uma cor', () => {
    /**
     * A impressora térmica imprime uma cor. O que distingue a categoria no rolo é a
     * barra SÓLIDA, não o tom; a cor do domínio existe para o PDF e para a tela
     * concordarem com ele.
     */
    const participant = buildBadgeZpl({ ...badge, category: 'PARTICIPANT' }, DEFAULT_THERMAL_CONFIG);
    const staff = buildBadgeZpl({ ...badge, category: 'STAFF' }, DEFAULT_THERMAL_CONFIG);
    const bar = `^FO0,0^GB${WIDTH_DOTS},${stripeOf(HEIGHT_DOTS)},${stripeOf(HEIGHT_DOTS)}^FS`;

    expect(participant).toContain(bar);
    expect(staff).toContain(bar);
  });

  it('sem categoria, a barra continua existindo (o padrão)', () => {
    const zpl = buildBadgeZpl(badge, DEFAULT_THERMAL_CONFIG);

    expect(zpl).toContain(`^FO0,0^GB${WIDTH_DOTS},${stripeOf(HEIGHT_DOTS)},`);
  });

  it('o conteúdo desce pela altura da faixa (o QR não sai do papel)', () => {
    const zpl = buildBadgeZpl({ ...badge, category: 'PRESS' }, DEFAULT_THERMAL_CONFIG);
    const qr = /\^FO(\d+),(\d+)\^BQN/.exec(zpl);

    expect(Number(qr?.[1])).toBe(PADDING_DOTS);
    expect(Number(qr?.[2])).toBe(PADDING_DOTS + stripeOf(HEIGHT_DOTS) + 4);
  });
});
