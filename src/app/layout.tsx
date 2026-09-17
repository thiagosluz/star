import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';

import './globals.css';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Layout raiz — fontes e base tipográfica (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE DUAS FAMÍLIAS, E POR QUE AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DESIGN.md separa dois papéis: **Plus Jakarta Sans** para títulos (autoridade
 *  editorial, geométrica) e **Inter** para tudo que é operacional (tabela, status,
 *  formulário, anotação de parecer), pelo x-height alto em texto denso.
 *
 *  Antes desta fase NENHUMA fonte era carregada — o `--font-inter` citado no tema
 *  dos eventos apontava para uma variável inexistente, e o sistema caía no
 *  `system-ui`. Ou seja: a tipografia do produto era a do sistema operacional de
 *  quem abrisse a página.
 *
 *  As fontes são expostas como CSS custom properties (`--font-jakarta`,
 *  `--font-inter`) e o `globals.css` as liga a `--font-display` e `--font-sans`.
 *  O `next/font` baixa e serve os arquivos do próprio domínio — sem requisição ao
 *  Google em tempo de execução e sem deslocamento de layout (CLS).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  weight: ['600', '700'],
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  title: {
    default: 'EventFlow',
    template: '%s · EventFlow',
  },
  description:
    'Plataforma de gestão de eventos acadêmicos, corporativos e comunitários: submissões, avaliação por pares, gamificação e certificados.',
  applicationName: 'EventFlow',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${plusJakarta.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
