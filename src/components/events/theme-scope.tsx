import {
  themeToCssVariables,
  type ResolvedEventTheme,
} from '@/domain/events/landing-page';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Aplicador de tema do evento
 *
 *  Injeta as CSS custom properties do tema (`--ef-*`) em um wrapper. Todos os
 *  componentes da página pública leem essas variáveis, então trocar o tema muda
 *  a página inteira sem tocar em nenhum componente.
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
 *  Por isso usamos `themeToCssVariables()`, que devolve um objeto. A
 *  serialização em string (`themeToStyleString`) existe apenas para contextos
 *  de HTML puro, não para JSX.
 *
 *  `data-theme-mode` permite ao CSS reagir ao modo claro/escuro sem lógica
 *  condicional nos componentes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ThemeScope({
  theme,
  children,
}: {
  theme: ResolvedEventTheme;
  children: React.ReactNode;
}) {
  // As chaves são custom properties (`--ef-*`), que o tipo CSSProperties não
  // declara. O objeto é montado a partir de uma allowlist validada.
  const style = themeToCssVariables(theme) as React.CSSProperties;

  return (
    <div style={style} data-theme-mode={theme.colorMode} className="ef-theme min-h-screen">
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

/** Cabeçalho de seção, reaproveitado por todos os blocos. */
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
        <p className="text-xs font-semibold uppercase tracking-wider opacity-60">
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
