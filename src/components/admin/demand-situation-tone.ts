/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O TOM DA SITUAÇÃO — uma regra, três vistas (FASE 57)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO SAIU DE DENTRO DA PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 38 escreveu o tom do cartão direto na página do quadro. Com o Gantt e o
 *  calendário, o mesmo critério passaria a existir em três arquivos — e a primeira
 *  manutenção acertaria dois. Não é hipótese: é a armadilha 55 ("duas definições da
 *  mesma regra divergem na primeira manutenção"), que já custou uma fase neste projeto.
 *
 *  A regra é de APRESENTAÇÃO e por isso mora em `components/`, não no domínio: o domínio
 *  diz QUAL é a situação (`demandSituation`), a tela diz de que cor ela fica.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ATRASADA E CONCLUÍDA NÃO PODEM PARECER A MESMA COISA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Vermelho para o que passou do prazo, âmbar para o que vence hoje e cinza para o que
 *  terminou: a diferença de TOM não substitui o rótulo (a situação sempre aparece
 *  escrita), ela só faz o olho parar primeiro no que aperta.
 */
export function demandSituationTone(situation: string): string {
  if (situation === 'OVERDUE') return 'border-destructive/50 bg-destructive/5';
  if (situation === 'DUE_TODAY') return 'border-secondary-strong/50 bg-secondary/5';
  if (situation === 'DONE') return 'border-border bg-muted/40';
  return 'border-border';
}
