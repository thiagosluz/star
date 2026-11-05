/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Medida de texto (largura aproximada, quebra de linha e "cabe?")
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA RÉGUA MUDOU DE CASA (FASE 86)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela nasceu em `src/lib/documents/layout-draw.ts` e em `pdf-text.ts`, junto do
 *  desenho — e estava certo enquanto só o desenho precisava medir texto. Na FASE 86 o
 *  CORPO do certificado passou a precisar da mesma medida NO DOMÍNIO, para responder
 *  "o gabarito do organizador cabe na caixa?" antes de emitir qualquer documento.
 *
 *  Duas saídas ruins foram descartadas:
 *
 *    • reimplementar a medição no domínio — duas réguas divergem no primeiro ajuste,
 *      e o organizador veria na tela um "cabe" diferente do que o PDF imprime;
 *    • deixar a regra na camada de desenho — o domínio passaria a depender de
 *      infraestrutura para decidir uma regra de produto.
 *
 *  Então a medição veio para o domínio, e o desenho a IMPORTA daqui: é a mesma conta
 *  nos dois lados, e `layout-draw.ts` continua exportando os mesmos nomes (o desenho
 *  não mudou de contrato).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MEDIDA É APROXIMADA, E ISSO É DELIBERADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As larguras reais das 14 fontes padrão do PDF estão em tabelas da especificação.
 *  Usar uma média ponderada por classe de caractere (maiúsculas e dígitos são mais
 *  largos) é suficiente porque a MESMA aproximação serve à tela e ao arquivo — o que
 *  o organizador vê na prévia é o que sai impresso, que é o que importa aqui.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Unidades
// ───────────────────────────────────────────────────────────────────────────────
/** 1 polegada = 25,4 mm; o PDF mede em pontos, e 1 ponto = 1/72 de polegada. */
export const PT_PER_MM = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

export function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Largura e quebra de linha
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Largura aproximada em pontos, na fonte de corpo `fontSize`.
 *
 * Aproximação DOCUMENTADA (e não uma tabela de 224 números que ninguém confere): o
 * resultado entra em decisões de quebra de linha e de centralização, sempre com a
 * mesma régua dos dois lados.
 */
export function approximateWidth(text: string, fontSize: number): number {
  let units = 0;

  for (const char of text) {
    if (/[A-Z0-9]/.test(char)) units += 0.62;
    else if (/[a-z]/.test(char)) units += 0.52;
    else if (char === ' ') units += 0.28;
    else units += 0.4;
  }

  return units * fontSize;
}

/**
 * Quebra o texto na largura da caixa, em PT (a régua da fonte).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A QUEBRA PRESERVA O QUE O ORGANIZADOR ESCREVEU
 * ─────────────────────────────────────────────────────────────────────────────
 *  Cada `\n` do texto é uma linha à força: o corpo do certificado é escrito em
 *  parágrafos, e reflowar tudo num bloco só apagaria a divisão que a pessoa escolheu.
 *  Dentro do parágrafo a quebra é por PALAVRA — e uma palavra sozinha maior que a
 *  caixa fica como está, porque cortá-la no meio inventaria um erro de digitação que
 *  não existe no dado.
 */
export function wrapToWidth(text: string, widthPt: number, sizePt: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;

      if (!current || approximateWidth(candidate, sizePt) <= widthPt) {
        current = candidate;
        continue;
      }

      lines.push(current);
      current = word;
    }

    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

// ───────────────────────────────────────────────────────────────────────────────
//  "Cabe na caixa?"
// ───────────────────────────────────────────────────────────────────────────────
export interface TextBoxFit {
  /** Todas as linhas que o texto ocupa na LARGURA da caixa. */
  lines: readonly string[];
  /** Linhas que a ALTURA da caixa comporta. */
  maxLines: number;
  /** Linhas efetivamente necessárias. */
  lineCount: number;
  /** Quantas linhas ficariam de fora (`lineCount - maxLines`, nunca negativo). */
  overflowLines: number;
  fits: boolean;
}

/**
 * Mede o texto contra uma caixa em milímetros.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  MEDIR ≠ TRUNCAR
 * ─────────────────────────────────────────────────────────────────────────────
 *  O desenho (`layoutTextLines`) corta o que não couber e põe "…" na última linha,
 *  porque um documento com texto cortado sem aviso é pior do que um com aviso. Esta
 *  função NÃO corta: ela diz quantas linhas faltariam, para que a tela possa avisar
 *  ANTES da emissão — e é por isso que ela mora no domínio, sem tocar no desenho.
 */
export function fitTextInBox(input: {
  text: string;
  widthMm: number;
  heightMm: number;
  sizePt: number;
  lineHeight: number;
}): TextBoxFit {
  const lines = wrapToWidth(input.text, mmToPt(input.widthMm), input.sizePt);
  const lineHeightPt = input.sizePt * input.lineHeight;
  /**
   * No mínimo UMA linha: uma caixa de 3 mm com corpo de 72 pt não comporta nem a
   * primeira linha, mas devolver zero faria a conta de sobra mentir — o desenho
   * imprime uma linha de qualquer jeito.
   */
  const maxLines = Math.max(1, Math.floor(mmToPt(input.heightMm) / lineHeightPt));

  return {
    lines,
    maxLines,
    lineCount: lines.length,
    overflowLines: Math.max(lines.length - maxLines, 0),
    fits: lines.length <= maxLines,
  };
}
