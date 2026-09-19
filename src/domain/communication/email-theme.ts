/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Paleta dos E-MAILS — a identidade fora do navegador
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A COR APARECE AQUI COMO VALOR LITERAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra do projeto é "cor de interface vem de token" (`docs/design-system.md`) e
 *  a trava de teste reprova hexadecimal em componente. E-mail é a exceção técnica
 *  honesta: cliente de e-mail **não resolve variável CSS** — nem `var(--ef-primary)`,
 *  nem `<style>` com classe na maioria dos casos. O padrão que funciona é estilo
 *  embutido no elemento, com o valor escrito.
 *
 *  O risco dessa exceção é virar uma segunda identidade que ninguém atualiza. A
 *  defesa tem duas partes:
 *
 *    1. os valores vivem em UM lugar (este arquivo) e são nomeados pelos tokens;
 *    2. um teste lê `globals.css` e falha se algum valor divergir do token
 *       correspondente (`tests/unit/email-templates.test.ts`).
 *
 *  Ou seja: a marca continua tendo uma fonte da verdade. O e-mail só não consegue
 *  consultá-la em tempo de renderização.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Valores espelhados de `src/app/globals.css` (tokens `--ef-*`). */
export const EMAIL_PALETTE = {
  surface: '#f9f9ff',
  card: '#ffffff',
  surfaceLow: '#f1f3ff',
  surfaceHigh: '#e5e8f4',
  border: '#c7c4d8',
  foreground: '#181c24',
  muted: '#464555',
  primary: '#4f46e5',
  primaryText: '#3525cd',
  primarySoft: '#e2dfff',
  secondary: '#00668a',
  tertiary: '#005338',
  danger: '#ef4444',
  warning: '#f59e0b',
} as const;

export type EmailPaletteKey = keyof typeof EMAIL_PALETTE;

/**
 * Token do `globals.css` que cada cor espelha. É o que o teste compara — e o que
 * documenta, para quem ler o arquivo, que aquele hexadecimal não foi escolhido aqui.
 */
export const EMAIL_PALETTE_TOKENS: Record<EmailPaletteKey, string> = {
  surface: '--ef-surface',
  card: '--ef-surface-lowest',
  surfaceLow: '--ef-surface-low',
  surfaceHigh: '--ef-surface-high',
  border: '--ef-outline-variant',
  foreground: '--ef-on-surface',
  muted: '--ef-on-surface-variant',
  primary: '--ef-primary-container',
  primaryText: '--ef-primary',
  primarySoft: '--ef-primary-fixed',
  secondary: '--ef-secondary',
  tertiary: '--ef-tertiary',
  danger: '--ef-danger',
  warning: '--ef-warning',
};

/** Tipografia do sistema (a mesma família carregada na página pública). */
export const EMAIL_FONT_STACK =
  "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
