import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';

import { themeMarkup } from '@/lib/theme/theme-mode';
import { readThemeMode } from '@/lib/theme/theme-mode-server';
import { cn } from '@/lib/utils/cn';

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
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TEMA NASCE AQUI, NA PRIMEIRA RESPOSTA (FASE 61 · dívida H3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este é o ÚNICO lugar do sistema que renderiza o `<html>` da aplicação (o
 *  `global-error.tsx` é a casca de emergência, que precisa desenhar sem o CSS
 *  carregado e por isso não lê cookie nenhum). Resolver a escolha de tema AQUI —
 *  e não em cada layout de seção — é o que garante que painel, página pública,
 *  `/conta` e governança concordem: se cada árvore decidisse por si, a primeira
 *  tela que esquecesse a leitura piscaria clara antes de escurecer.
 *
 *  O cookie é lido ANTES de a marcação nascer, então o HTML que o servidor entrega
 *  já traz `class="dark"` e `data-tema` — não existe o instante em que a página
 *  está com o tema errado (o defeito clássico do script no `<head>`, que só
 *  conserta a tela DEPOIS que o JavaScript roda). O preço é conhecido e aceito: ler
 *  cookie torna a rota dinâmica, e é exatamente o que o produto já é em quase toda
 *  tela — não há como servir o tema da pessoa num HTML estático sem piscar.
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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const tema = themeMarkup(await readThemeMode());

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  AS TRÊS MARCAÇÕES, E POR QUE CADA UMA EXISTE
   * ─────────────────────────────────────────────────────────────────────────────
   *  • `class="dark"` — SÓ no escuro explícito. Em `sistema` ela não entra: quem
   *    responde ali é a `@media (prefers-color-scheme: dark)` do `globals.css`, e
   *    escrever a classe deixaria a página presa no escuro para sempre.
   *  • `data-tema` — SEMPRE, inclusive em `sistema`. É o que permite ao CSS (e ao
   *    E2E) distinguir "escolheu claro" de "não escolheu nada".
   *  • `color-scheme` — sem ele a barra de rolagem e os controles nativos
   *    continuam claros dentro de uma página escura; em `sistema` vale
   *    `light dark`, que é a página aceitando os dois e o navegador decidindo.
   */
  return (
    <html
      lang="pt-BR"
      className={cn(inter.variable, plusJakarta.variable, tema.dark && 'dark')}
      data-tema={tema.dataTema}
      style={{ colorScheme: tema.colorScheme }}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
