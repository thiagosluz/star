import { AlertTriangle } from 'lucide-react';

import type { AgendaMarksVariant } from '@/components/events/agenda-marks';
import { clashTargetLabel, type AgendaViewerItem } from '@/lib/events/agenda-view';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O AVISO DE CHOQUE DE HORÁRIO (FASE 65 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O AVISO **INFORMA**; ELE NÃO IMPEDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este componente não esconde o botão, não o desabilita e não pede confirmação:
 *  ele diz QUAL atividade disputa o mesmo horário, com o horário ao lado, e deixa a
 *  decisão com quem está lendo. A casa não escolhe o que o participante vai assistir
 *  (decisão do humano, no plano da fase) — e a Server Action grava de qualquer jeito.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NÃO É SÓ COR: ÍCONE + PALAVRA + OS DOIS TÍTULOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem não distingue o tom (ou usa leitor de tela) recebe a mesma informação: o
 *  ícone de atenção (com `aria-hidden`, porque é decoração de um texto que já diz
 *  tudo), a palavra "Choque de horário" e o alvo por extenso — título e horário. A
 *  cor é reforço, nunca o recado; é a regra que o portão WCAG AA cobra e que este
 *  aviso cumpre sem isenção nenhuma.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS VARIANTES DE ESTILO (a MESMA razão das marcas)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • `tema` — na programação pública, dentro do `ThemeScope` do evento. Ali não
 *    existe token de aviso: publicar o `--ef-warning` da plataforma sobre um fundo
 *    claro ESCOLHIDO pelo organizador é como o contraste quebra. O aviso se desenha
 *    com o `currentColor` do próprio tema (borda e fundo tirados do texto), com o
 *    ícone e a palavra fazendo o resto.
 *  • `painel` — em "minha agenda", com os tokens medidos da plataforma
 *    (`warning-soft` / `warning-strong`, presos pela catraca da FASE 52 nos dois
 *    modos).
 */
export function AgendaClashNotice({
  targets,
  variant,
  testId,
  /** Frase curta que fecha o aviso (muda entre a escolha e a lista da grade). */
  hint,
}: {
  targets: readonly AgendaViewerItem[];
  variant: AgendaMarksVariant;
  testId?: string;
  hint: string;
}) {
  if (targets.length === 0) return null;

  const classes =
    variant === 'tema'
      ? 'rounded-md border border-current px-3 py-2 text-xs'
      : 'rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-strong';

  return (
    <div
      className={`flex items-start gap-2 ${classes}`}
      data-testid={testId}
      /**
       * `role="note"` (e não `alert`): o aviso não é uma urgência que interrompe a
       * leitura — ele é parte do cartão, e existe desde o primeiro desenho da página.
       */
      role="note"
      style={
        variant === 'tema'
          ? {
              borderColor: 'color-mix(in oklab, currentColor 45%, transparent)',
              backgroundColor: 'color-mix(in oklab, currentColor 6%, transparent)',
            }
          : undefined
      }
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />

      <div className="space-y-0.5">
        <p className="font-medium">
          Choque de horário com{' '}
          {targets.map((target, index) => (
            <span key={target.activityId}>
              {index > 0 ? ' e ' : ''}
              {clashTargetLabel(target)}
            </span>
          ))}
        </p>
        <p>{hint}</p>
      </div>
    </div>
  );
}
