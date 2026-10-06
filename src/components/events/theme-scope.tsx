import type { ResolvedEventTheme } from '@/domain/events/landing-page';
import { buildEventThemeScope } from '@/domain/events/event-page-theme-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Aplicador de tema do evento
 *
 *  Injeta as CSS custom properties do tema (`--ef-*`) — e os apelidos da plataforma
 *  que os componentes leem lá dentro (`--muted-foreground`, `--card`, …) — em um
 *  wrapper. Todos os componentes da página pública leem essas variáveis, então trocar
 *  o tema muda a página inteira sem tocar em nenhum componente.
 *
 *  O tema já chega VALIDADO e normalizado: `resolveTheme()` garante que cores
 *  só existem em hexadecimal ou `oklch()`. Isso é o que impede que um valor de
 *  cor malicioso escape do contexto de custom property e injete regras CSS.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ATENÇÃO — `style` DO REACT NÃO ACEITA STRING
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Passar a serialização CSS (`"--ef-primary:#fff;--ef-radius:12px"`) para o
 *  prop `style` lança em runtime:
 *
 *      Error: The `style` prop expects a mapping from style properties to
 *      values, not a string.
 *
 *  Por isso usamos `buildEventThemeScope()`, que devolve um objeto. A
 *  serialização em string (`themeToStyleString`) existe apenas para contextos
 *  de HTML puro, não para JSX.
 *
 *  `data-theme-mode` permite ao CSS reagir ao modo claro/escuro sem lógica
 *  condicional nos componentes.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O MAPA FECHA TODOS OS PAPÉIS — NENHUM `var()` CAI NA PLATAFORMA (FASE 61)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CSS do evento (`event-theme.css`) consome `--ef-*` e não tem fallback: os
 *  papéis que o organizador não escolheu chegam aqui com o padrão do MODO que ele
 *  declarou. Antes eram `var(--color-surface, …)` — token da plataforma, que a
 *  escala escura redefine —, e a página de quem escolheu só a cor primária
 *  escurecia junto com o painel. A catraca que prende isso é
 *  `tests/unit/f61-tema-do-evento.test.ts`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A COR DO EVENTO TAMBÉM VIRA TOKEN DO SISTEMA (FASE 51 · E42)
 * ─────────────────────────────────────────────────────────────────────────────
 *  As variáveis `--ef-*` são do CSS da PÁGINA PÚBLICA: os componentes do sistema
 *  não as leem (e não devem — a trava do design system reprova cor escolhida em
 *  componente). O crachá é o primeiro que precisa da cor do evento FORA da página,
 *  e o mesmo evento é desenhado em três lugares: a página, o crachá na tela e o
 *  crachá no papel.
 *
 *  Por isso a `ThemeScope` também publica `--theme-primary`, que nasce na marca da
 *  plataforma (`globals.css`) e aqui recebe a cor do evento. Um token só, e o
 *  componente que o usa (`Badge` com `tone="event"`) não sabe de onde ele veio.
 *  Desde a FASE 69 esse papel é montado em `buildEventThemeScope`, junto do resto do
 *  escopo: a página tem UM lugar que decide o que o tema publica.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ESCOPO PUBLICA TAMBÉM OS PAPÉIS DA PLATAFORMA (FASE 69 · fatia 3 · E84)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os `--ef-*` não bastavam. Os componentes do sistema desenhados DENTRO do tema
 *  (o cartão do "acontecendo agora", a galeria de palestrantes, a marca de agenda, o
 *  botão de favorito) leem os apelidos SEM prefixo — `text-muted-foreground`,
 *  `bg-card`, `border-border` —, e o `globals.css` resolve esses apelidos na RAIZ:
 *  sobrescrever um `--ef-*` num descendente não os re-resolve. Resultado medido na
 *  FASE 66: a tinta clara da PLATAFORMA sobre a superfície escura do ORGANIZADOR —
 *  **2,10:1** sobre o fundo e **1,86:1** sobre o cartão, contra os 4,5:1 do AA.
 *
 *  O modo desta página é do organizador (ADR-325), então os apelidos que ele não
 *  escolhe passam a ser publicados aqui no modo DELE — o mesmo movimento que a FASE
 *  64 fez na página da instituição, onde eles continuam vindo da plataforma porque
 *  lá o modo da página já É o do visitante. O porquê de cada escolha, o que fica de
 *  fora e a catraca que prende os valores estão em
 *  `src/domain/events/event-page-theme-rules.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ThemeScope({
  theme,
  children,
}: {
  theme: ResolvedEventTheme;
  children: React.ReactNode;
}) {
  // As chaves são custom properties (`--ef-*` e os apelidos da plataforma), que o tipo
  // CSSProperties não declara. O objeto é montado a partir de uma allowlist validada.
  const { variables, mode } = buildEventThemeScope({ theme });
  const style = variables as React.CSSProperties;

  return (
    <div style={style} data-theme-mode={mode} className="ef-theme min-h-screen">
      {children}
    </div>
  );
}

/**
 * Espaçamento vertical derivado da densidade escolhida.
 *
 * Usa a variável `--ef-spacing-scale` em vez de classes condicionais para que a
 * mudança de densidade seja uma única propriedade CSS.
 */
export function Section({
  children,
  className = '',
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`px-6 py-[calc(3rem*var(--ef-spacing-scale,1))] ${className}`}
    >
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </section>
  );
}

/**
 * Cabeçalho de seção, reaproveitado por todos os blocos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O RÓTULO NÃO USA `opacity` (FASE 66) — e o defeito é o mesmo da FASE 65
 * ─────────────────────────────────────────────────────────────────────────────
 *  O `eyebrow` era `opacity-60` e media **4,44:1** sobre a `--ef-background` do
 *  tema padrão claro (`#72747c` sobre `#f9f9ff`) — abaixo dos 4,5:1 do AA para
 *  texto pequeno (12 px, sem negrito). É a MESMA causa dos quatro nós que a
 *  FASE 65 corrigiu: a opacidade compõe a tinta com o fundo que o ORGANIZADOR
 *  escolheu, e quem responde pela paleta dentro do tema é ele (ADR da F61).
 *
 *  Sobrou para esta fase porque a página do evento na aba "Programação" não
 *  estava no portão WCAG AA — o defeito só existia onde ninguém media. O valor
 *  agora vem do papel do tema (`.ef-muted`: 5,08:1 no claro e 5,91:1 no escuro),
 *  preso em `tests/unit/f66-contraste-do-rotulo.test.ts`.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string | null;
}) {
  return (
    <header className="mb-[calc(2rem*var(--ef-spacing-scale,1))] space-y-2">
      {eyebrow ? (
        <p className="ef-muted text-xs font-semibold uppercase tracking-wider">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {description ? (
        <p className="max-w-2xl text-pretty opacity-70">{description}</p>
      ) : null}
    </header>
  );
}
