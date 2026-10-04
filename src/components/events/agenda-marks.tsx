import { Heart, Ticket } from 'lucide-react';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  As MARCAS da agenda pessoal (FASE 65 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DUAS MARCAS, E NÃO UMA: INTENÇÃO × LUGAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `FAVORITO` é intenção (a pessoa marcou para não perder de vista) e `INSCRITO` é
 *  lugar (a vaga é dela). Quando as duas coisas valem, a tela mostra os DOIS
 *  distintivos — em vez de um terceiro rótulo combinado, que é o que a lista de
 *  "minha agenda" precisa ler de relance.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MARCA NÃO É SÓ COR (o portão WCAG AA não tem isenções)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada distintivo tem ÍCONE e TEXTO — "Favorito" com o coração, "Inscrito" com o
 *  ingresso. Quem não distingue as duas cores (ou quem usa leitor de tela) lê a
 *  mesma informação: nada aqui depende de tom, e por isso não há `aria-label`
 *  escondendo o texto — o texto É o rótulo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE DUAS VARIANTES DE ESTILO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A programação pública vive dentro do `ThemeScope` do evento: lá as cores são as
 *  que o ORGANIZADOR escolheu (`--ef-text`/`--ef-radius`, consumidos pelo
 *  `ef-badge`). A "minha agenda" vive no painel do participante e usa os tokens da
 *  PLATAFORMA — a mesma pílula de "Minhas inscrições". São dois vocabulários de
 *  desenho para o MESMO dado, e a variante é dita por quem chama, em vez de a tela
 *  adivinhar pelo contexto.
 */
export type AgendaMarksVariant = 'tema' | 'painel';

export function AgendaMarks({
  favorited,
  registered,
  variant,
  testId,
}: {
  favorited: boolean;
  registered: boolean;
  variant: AgendaMarksVariant;
  /** `data-testid` do conjunto — cada distintivo leva o seu dentro dele. */
  testId?: string;
}) {
  if (!favorited && !registered) return null;

  const classes =
    variant === 'tema'
      ? 'ef-badge'
      : 'inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground';

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid={testId}>
      {registered ? (
        <span className={classes} data-testid="marca-inscrito" data-mark="INSCRITO">
          <Ticket className="size-3.5 shrink-0" aria-hidden />
          Inscrito
        </span>
      ) : null}

      {favorited ? (
        <span className={classes} data-testid="marca-favorito" data-mark="FAVORITO">
          <Heart className="size-3.5 shrink-0" aria-hidden />
          Favorito
        </span>
      ) : null}
    </span>
  );
}
