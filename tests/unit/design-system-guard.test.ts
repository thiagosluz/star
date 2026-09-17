/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TRAVA DO SISTEMA DE DESIGN (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É UM TESTE, E NÃO UM PARÁGRAFO NA DOCUMENTAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Documentação descreve a intenção; teste impede a regressão. Sem esta trava, a
 *  próxima tela escrita às pressas usa `text-gray-500` e `bg-[#4F46E5]`, e em duas
 *  fases ninguém sabe mais qual é a cor certa — que é exatamente o estado em que o
 *  projeto estava no fim da FASE 10: 150 usos de cor crua e três tons de cinza
 *  diferentes para "texto secundário".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TRAVA É UMA CATRACA, NÃO UM MURO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Arquivos das FASES 1–10 têm cor crua em pontos que a 11A não tocou. Em vez de
 *  permitir tudo (trava inútil) ou reescrever 31 arquivos de uma vez (mudança
 *  grande demais para uma entrega), existe uma LISTA DE DÍVIDA explícita: arquivo
 *  → número máximo de ocorrências. O teste falha quando:
 *    • um arquivo NOVO introduz cor crua ou tamanho arbitrário;
 *    • um arquivo da lista PIORA (mais ocorrências do que o registrado);
 *    • a lista registra mais do que o arquivo tem (dívida quitada que ficou
 *      anotada) — a lista só pode encolher.
 *
 *  Corrigir um arquivo na FASE 11B exige baixar o número aqui: a catraca aperta
 *  sozinha, e a dívida não pode crescer sem alguém escrever isso no código.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCAN_DIRS = ['src/app', 'src/components'];

/** Paleta cinza/colorida do Tailwind: proibida — cor de interface vem de token. */
const RAW_PALETTE =
  /\b(?:bg|text|border|from|to|via|ring|fill|stroke|divide|outline|decoration|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

/** Tamanho de fonte arbitrário (`text-[13px]`): a escala é do sistema. */
const ARBITRARY_TEXT = /\btext-\[[0-9.]+(?:px|rem|em)\]/g;

/** Cor literal (`#4F46E5`, `bg-[#fff]`). */
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;

/**
 * Arquivos onde valor literal é LEGÍTIMO, com o motivo:
 *  • `globals.css`   — é onde os valores da identidade vivem (a fonte da verdade);
 *  • `event-theme.css` — tema por instituição: cores vêm do banco, em variáveis;
 *  • `design/page.tsx` — o guia de estilo EXIBE os valores hexadecimais;
 *  • `global-error.tsx` — página de erro que precisa renderizar sem o CSS carregado,
 *    por isso usa estilo inline (não pode depender de classe).
 */
const HEX_EXEMPT = [
  'src/app/globals.css',
  'src/app/global-error.tsx',
  'src/app/superadmin/design/page.tsx',
  'src/app/t/[tenantSlug]/(public)/eventos/event-theme.css',
];

/**
 * Dívida reconhecida (FASE 11B) — arquivo → teto de ocorrências de COR CRUA.
 * Nenhum arquivo novo entra aqui sem justificativa escrita no commit.
 */
/**
 * Dívida de COR CRUA: **zerada na FASE 11B**.
 *
 * A lista existiu para permitir a migração em duas etapas sem travar o
 * desenvolvimento. Com a 11B concluída, o teto de todo arquivo é 0 — qualquer cor
 * fora de token reprova. O mecanismo continua aqui porque é ele que garante o
 * próximo módulo: um mapa vazio é a catraca totalmente apertada.
 */
const RAW_COLOR_DEBT: Record<string, number> = {};

/** Dívida reconhecida — arquivo → teto de ocorrências de TAMANHO ARBITRÁRIO. */
/** Dívida de TAMANHO ARBITRÁRIO: também zerada na FASE 11B. */
const ARBITRARY_TEXT_DEBT: Record<string, number> = {};

function listSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const absolute = join(ROOT, dir, entry);

    if (statSync(absolute).isDirectory()) {
      listSourceFiles(join(dir, entry), found);
      continue;
    }

    if (/\.(?:tsx|ts|css)$/.test(entry)) {
      found.push(dir.split(sep).join('/') + '/' + entry);
    }
  }

  return found;
}

/**
 * Remove comentários e VALORES DE ATRIBUTO antes de procurar cor literal.
 *
 * Dois motivos, ambos reais:
 *  • comentário que cita `#4F46E5` para explicar uma decisão não é estilo;
 *  • `placeholder="#1d4ed8"` num campo de cor é DADO (o exemplo que o usuário vê
 *    no formulário), não a cor da interface. Proibir isso empurraria o exemplo
 *    para fora do formulário — pior para quem usa.
 */
function stripNonStyleText(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(?:placeholder|hint|title|alt|aria-label)=(?:"[^"]*"|\{[^}]*\})/g, '');
}

const SOURCE_FILES = SCAN_DIRS.flatMap((dir) => listSourceFiles(dir));

function countIn(file: string, pattern: RegExp): number {
  return (stripNonStyleText(readFileSync(join(ROOT, file), 'utf8')).match(pattern) ?? []).length;
}

function ratchet(
  pattern: RegExp,
  debt: Record<string, number>,
  suggestion: string,
): { violations: string[]; stale: string[] } {
  const violations: string[] = [];
  const stale: string[] = [];

  for (const file of SOURCE_FILES) {
    const found = countIn(file, pattern);
    const ceiling = debt[file] ?? 0;

    if (found > ceiling) {
      violations.push(
        `${relative(ROOT, join(ROOT, file))}: ${found} ocorrência(s) (teto ${ceiling}) — ${suggestion}`,
      );
    }
  }

  for (const [file, ceiling] of Object.entries(debt)) {
    if (countIn(file, pattern) < ceiling) {
      stale.push(`${file}: teto ${ceiling}, encontrado ${countIn(file, pattern)} — baixe o teto`);
    }
  }

  return { violations, stale };
}

describe('sistema de design — tokens obrigatórios', () => {
  it('nenhuma cor vem da paleta crua do Tailwind', () => {
    const { violations, stale } = ratchet(
      RAW_PALETTE,
      RAW_COLOR_DEBT,
      'use token do sistema (bg-card, text-muted-foreground, text-success, border-outline…)',
    );

    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
    expect(stale, `\nDívida quitada ainda registrada:\n${stale.join('\n')}\n`).toEqual([]);
  });

  it('nenhum componente escreve cor hexadecimal (fora das exceções documentadas)', () => {
    const violations: string[] = [];

    for (const file of SOURCE_FILES) {
      if (HEX_EXEMPT.includes(file)) continue;

      const found = countIn(file, HEX_COLOR);

      if (found > 0) {
        violations.push(`${file}: ${found} cor(es) literal(is) — cor pertence ao token, não ao componente`);
      }
    }

    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
  });

  it('tamanho de fonte vem da escala tipográfica', () => {
    const { violations, stale } = ratchet(
      ARBITRARY_TEXT,
      ARBITRARY_TEXT_DEBT,
      'use text-xs, text-sm, text-title, text-display…',
    );

    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
    expect(stale, `\nDívida quitada ainda registrada:\n${stale.join('\n')}\n`).toEqual([]);
  });

  it('o sistema de tokens cobre a paleta do DESIGN.md', () => {
    const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');

    for (const token of [
      '--ef-surface',
      '--ef-surface-low',
      '--ef-surface-lowest',
      '--ef-surface-high',
      '--ef-on-surface-variant',
      '--ef-outline-variant',
      '--ef-primary-container',
      '--ef-primary-hover',
      '--ef-secondary',
      '--ef-secondary-container',
      '--ef-tertiary',
      '--ef-success',
      '--ef-warning',
      '--ef-danger',
      '--ef-tier-common-from',
      '--ef-tier-legendary-to',
      '--ef-tier-mythic-to',
      '--shadow-card',
      '--shadow-modal',
      '--text-display',
      '--text-title-lg',
      '--text-label-caps',
    ]) {
      expect(css, `token ausente no globals.css: ${token}`).toContain(token);
    }
  });

  it('os tokens da identidade são os valores exatos do DESIGN.md', () => {
    const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');

    /**
     * Amarra o código ao documento. Se alguém "ajustar" a marca sem atualizar o
     * DESIGN.md, este teste falha — e a conversa acontece antes de 40 telas
     * mudarem de cor por acidente.
     */
    const expected: [string, string][] = [
      ['--ef-surface:', '#f9f9ff'],
      ['--ef-surface-low:', '#f1f3ff'],
      ['--ef-surface-lowest:', '#ffffff'],
      ['--ef-surface-high:', '#e5e8f4'],
      ['--ef-on-surface:', '#181c24'],
      ['--ef-on-surface-variant:', '#464555'],
      ['--ef-outline-variant:', '#c7c4d8'],
      ['--ef-primary:', '#3525cd'],
      ['--ef-primary-container:', '#4f46e5'],
      ['--ef-secondary:', '#00668a'],
      ['--ef-tertiary:', '#005338'],
      ['--ef-success:', '#10b981'],
      ['--ef-warning:', '#f59e0b'],
      ['--ef-danger:', '#ef4444'],
    ];

    for (const [declaration, value] of expected) {
      expect(css, `token ${declaration} deveria valer ${value}`).toContain(
        `${declaration} ${value}`,
      );
    }
  });
});

