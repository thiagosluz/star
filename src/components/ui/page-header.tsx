import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O TOPO ÚNICO — `PageHeader` e `Breadcrumbs` (FASE 78 · fatia 1)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE (E POR QUE ELE É SERVER)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Até a F77 o `PageHeader` morava em `navigation.tsx`, que é `'use client'`
 *  porque `NavLink`/`TabNav` leem `usePathname`. Enquanto o cabeçalho vivesse
 *  lá, cada tela que passasse a usá-lo viraria uma ilha de cliente — e o custo
 *  de fechar a dívida H1 (87 páginas ainda com topo escrito à mão) seria maior
 *  do que o de conviver com 12 formatos de topo.
 *
 *  O cabeçalho não tem estado, não tem efeito e não lê a rota: ele só desenha a
 *  hierarquia, o título e as ações que a página já decidiu. Separado do menu,
 *  ele é Server Component e pode ser importado por qualquer página sem levar
 *  JavaScript junto.
 *
 *  A catraca (`tests/unit/f78-page-header.test.ts`) prende as duas metades: este
 *  arquivo não pode ganhar `'use client'` nem hook, e `navigation.tsx` não pode
 *  perder o `'use client'` — quem precisa dele é o menu, não o topo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A VOLTA É DERIVADA DA TRILHA, NUNCA UMA PROP
 * ─────────────────────────────────────────────────────────────────────────────
 *  A trilha JÁ declara de onde a tela veio: o penúltimo item é o pai, com o
 *  `href` e o rótulo do destino. Uma prop `back` separada poderia divergir dela
 *  (o link diria "Painel" e a trilha, "Administração"), e foi assim que 15 dos
 *  33 links "←" do produto ficaram sem nomear o destino — "← Painel" não diz
 *  para onde volta. Derivando, o nome acessível é sempre "Voltar para <pai>".
 *
 *  Quando o penúltimo item não tem `href` não há destino para onde voltar, e o
 *  link não é desenhado: desenhar uma "volta" que não navega seria pior do que
 *  não desenhá-la. A trilha continua mostrando o caminho.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Item da trilha. `href` ausente = item que não navega (o pai só nominal, ou a tela atual). */
export interface Crumb {
  label: string;
  href?: string;
}

/**
 * A trilha em si: `nav` rotulado + `ol`, com o item final marcado como a página
 * atual. Lista ordenada porque a trilha tem ordem (raiz → … → aqui), e é isso
 * que o leitor de tela anuncia.
 */
export function Breadcrumbs({ items, className }: { items: readonly Crumb[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Trilha de navegação" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight className="size-3.5 text-on-surface-variant/60" aria-hidden />
              ) : null}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className="text-xs font-medium text-foreground"
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** O pai da tela, quando ele tem destino: é dele que sai a "volta" do cabeçalho. */
function parentCrumb(items: readonly Crumb[]): { label: string; href: string } | null {
  if (items.length < 2) return null;

  const parent = items.at(-2);
  if (!parent?.href) return null;

  return { label: parent.label, href: parent.href };
}

/**
 * Cabeçalho padrão de tela — o topo ÚNICO do produto.
 *
 * Toda página começa por aqui: mesma trilha, mesmo tamanho de título (o token
 * `text-title-lg`, 28px, que o `DESIGN.md` chama de "título de página"), mesmas
 * ações à direita. É o que faz telas diferentes parecerem o mesmo produto.
 *
 * `eyebrow` é o GRUPO DE NAVEGAÇÃO da tela ("Operação", "Minha participação"),
 * não o nome da instituição: a casca já mostra o nome, e repeti-lo gastaria a
 * única linha que pode dizer onde a pessoa está. Por isso ele é um `<p>` e fica
 * FORA do `<h1>` — dentro, o nome acessível do título passaria a ser o grupo
 * colado ao título.
 */
export function PageHeader({
  title,
  titleTestId,
  eyebrow,
  icon,
  description,
  descriptionTestId,
  breadcrumbs,
  badge,
  actions,
  headingLevel = 1,
  className,
  ...props
}: ComponentProps<'header'> & {
  /** O título da tela. É o `<h1>` (ver `headingLevel`). */
  title: string;
  /** O `data-testid` que o E2E da tela usa para achar o título — passa para o `<h1>`. */
  titleTestId?: string;
  /** Grupo de navegação da tela, em `<p>` e fora do `<h1>`. */
  eyebrow?: string;
  /** Ícone decorativo: irmão do `<h1>` e sempre `aria-hidden`. */
  icon?: ReactNode;
  description?: ReactNode;
  /**
   * O `data-testid` da descrição, quando a tela já o publicava.
   *
   * Várias telas de gestão têm o estado na linha abaixo do título
   * (`landing-status`, `tenant-page-status`, `media-summary`, `profile-identity`)
   * e o E2E lê esse estado POR TESTID. Deixar a descrição no mesmo `<p>` do
   * componente e sumir com o testid na migração trocaria o topo e quebraria a
   * prova — por isso o testid é um slot, e não um `<p>` escrito à mão.
   */
  descriptionTestId?: string;
  /** A trilha. A volta do cabeçalho é derivada do penúltimo item dela. */
  breadcrumbs?: readonly Crumb[];
  /** Só ESTADO ("Exemplo", "SuperAdmin"), nunca o nome da instituição. */
  badge?: ReactNode;
  actions?: ReactNode;
  /**
   * ─────────────────────────────────────────────────────────────────────────
   *  A EXCEÇÃO DA VITRINE — e só dela (FASE 78)
   * ─────────────────────────────────────────────────────────────────────────
   *  `/superadmin/design` mostra seis cabeçalhos dentro de uma página que já
   *  tem o seu; sem rebaixar as amostras, o guia teria sete `<h1>`. O default é
   *  1 e NENHUMA página real usa outro valor — a catraca da F78 reprova
   *  `headingLevel` em qualquer `page.tsx` fora da vitrine.
   */
  headingLevel?: 1 | 2;
}) {
  const parent = breadcrumbs ? parentCrumb(breadcrumbs) : null;
  const Heading = headingLevel === 2 ? 'h2' : 'h1';

  return (
    <header className={cn('space-y-4', className)} {...props}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Breadcrumbs items={breadcrumbs} />

          {parent ? (
            /**
             * A seta é `aria-hidden`: o nome acessível do link é "Voltar para X",
             * e não "seta para a esquerda, Voltar para X". O destino está escrito
             * na frase — é o que os 15 links "← Painel" não faziam.
             */
            <Link
              href={parent.href}
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              <span aria-hidden>←</span> Voltar para {parent.label}
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? (
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {icon ? (
              <span aria-hidden className="shrink-0 text-muted-foreground">
                {icon}
              </span>
            ) : null}
            <Heading className="font-display text-title-lg text-foreground" data-testid={titleTestId}>
              {title}
            </Heading>
            {badge}
          </div>

          {description ? (
            <p
              className="max-w-3xl text-sm text-muted-foreground"
              data-testid={descriptionTestId}
            >
              {description}
            </p>
          ) : null}
        </div>

        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
