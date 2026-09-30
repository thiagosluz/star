/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 52 · dívida E74 — o contraste do token de aviso é MEDIDO, não estimado
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O tom único do aviso (`#d97706`) media **2,89:1** sobre o painel claro e o portão
 *  de acessibilidade isentou estes nós por uma fase inteira — a isenção era o
 *  lembrete, não a solução. A correção separou o token em dois, cada um medido
 *  contra a superfície onde vive.
 *
 *  Este arquivo é a CATRACA dessa decisão: ele lê o `globals.css` de verdade, calcula
 *  o contraste pela fórmula do WCAG e reprova quem voltar a usar um tom só. Um
 *  comentário na paleta não impede ninguém de "clarear um pouquinho" o token na
 *  próxima revisão visual; este teste impede.
 *
 *  E ele prova o próprio valor: o primeiro caso afirma que o tom ANTIGO **falharia**,
 *  para que ninguém tenha de acreditar no número escrito no comentário.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync('src/app/globals.css', 'utf8');

/** O valor de um token `--ef-*` declarado na paleta. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS);

  if (!match?.[1]) throw new Error(`token --${name} não encontrado (ou não é hexadecimal) no globals.css`);

  return match[1];
}

function luminancia(hex: string): number {
  const canais = [1, 3, 5].map((posicao) => {
    const valor = Number.parseInt(hex.slice(posicao, posicao + 2), 16) / 255;

    return valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * canais[0]! + 0.7152 * canais[1]! + 0.0722 * canais[2]!;
}

/** Razão de contraste do WCAG 2.x, arredondada como o axe reporta. */
function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);

  return Math.round(((claro! + 0.05) / (escuro! + 0.05)) * 100) / 100;
}

/**
 * O `warning-soft` é um `color-mix(in oklab, --ef-warning 14%, --ef-surface-lowest)`:
 * o valor efetivo é o que o navegador computa, e é ele que o axe lê. Aqui ele está
 * declarado como a constante MEDIDA (2,89:1 com o tom antigo — o número que abriu a
 * dívida), com a receita ao lado para quem for reconferir.
 */
const AVISO_SUAVE = '#fff2e4';

const MINIMO_AA = 4.5;

describe('E74 — o token de aviso passa no AA onde ele é usado', () => {
  it('o tom ANTIGO falharia — a dívida era real, não estética', () => {
    expect(contraste('#d97706', AVISO_SUAVE)).toBeLessThan(MINIMO_AA);
    expect(contraste('#d97706', '#2c3039')).toBeLessThan(MINIMO_AA);
  });

  it('o tom dos painéis CLAROS passa sobre o aviso suave e sobre o branco do cartão', () => {
    const tom = token('ef-warning-strong');

    expect(contraste(tom, AVISO_SUAVE), `warning-strong sobre warning-soft (${tom})`).toBeGreaterThanOrEqual(
      MINIMO_AA,
    );
    expect(contraste(tom, token('ef-surface-lowest')), `warning-strong sobre branco (${tom})`).toBeGreaterThanOrEqual(
      MINIMO_AA,
    );
  });

  it('o tom do TELÃO passa sobre a superfície escura', () => {
    expect(
      contraste(token('ef-warning-strong-on-dark'), token('ef-inverse-surface')),
      'warning-strong-on-dark sobre o telão',
    ).toBeGreaterThanOrEqual(MINIMO_AA);
  });

  it('os dois tons são DIFERENTES — um valor só não serve às duas superfícies', () => {
    const claro = token('ef-warning-strong');
    const escuro = token('ef-warning-strong-on-dark');

    expect(claro).not.toBe(escuro);
    /** O do escuro tem de ser CLARO e o do claro tem de ser ESCURO: é o que os separa. */
    expect(luminancia(escuro)).toBeGreaterThan(luminancia(claro));
  });

  it('a folga do tom claro sobrevive a um invólucro com opacity-90', () => {
    /**
     * A dívida media 2,59:1 "onde há invólucro com `opacity-90`" — o texto translúcido
     * se mistura com o fundo, e o contraste cai. Em vez de proibir o invólucro, o tom
     * ganhou folga: com 10% de transparência sobre o aviso suave ele ainda passa.
     */
    const tom = token('ef-warning-strong');
    const misturado = misturar(tom, AVISO_SUAVE, 0.9);

    expect(contraste(misturado, AVISO_SUAVE)).toBeGreaterThanOrEqual(MINIMO_AA);
  });
});

/** Cor resultante de pintar `frente` com `alpha` sobre `fundo` (o que `opacity-90` faz). */
function misturar(frente: string, fundo: string, alpha: number): string {
  const canais = [1, 3, 5].map((posicao) => {
    const f = Number.parseInt(frente.slice(posicao, posicao + 2), 16);
    const b = Number.parseInt(fundo.slice(posicao, posicao + 2), 16);

    return Math.round(f * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  });

  return `#${canais.join('')}`;
}
