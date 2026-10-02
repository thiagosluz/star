import Link from 'next/link';
import { Building2, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { MobileNav } from '@/components/shell/mobile-nav';
import { NavCollapseToggle } from '@/components/shell/nav-collapse-toggle';
import { NavLink } from '@/components/ui/navigation';
import { NAV_MODE_RAIL } from '@/lib/shell/nav-mode';
import { readNavMode } from '@/lib/shell/nav-mode-server';
import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SHELL DO SISTEMA — a moldura de toda tela autenticada (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MUDA EM RELAÇÃO À NAVEGAÇÃO ANTERIOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Antes: uma faixa horizontal no topo, com 11 destinos em ordem de chegada
 *  histórica ("Painel, Eventos, Minhas inscrições, Submissões, Comitê, Revisões,
 *  Conquistas, Cartas, Certificados, Credenciamento, Administração"). Nada dizia
 *  o que era do participante e o que era da gestão, e em telas menores metade
 *  ficava escondida.
 *
 *  Agora: barra lateral fixa, com os mesmos destinos **agrupados por intenção**
 *  (Participação · Comitê científico · Operação · Administração), ícone em cada
 *  item, estado ativo derivado da rota e gaveta no mobile. O mesmo componente
 *  serve à instituição e à plataforma (`variant`), o que garante que as duas
 *  áreas pareçam o mesmo produto.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FILTRAGEM POR PERMISSÃO CONTINUA NO SERVIDOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este componente RECEBE a navegação já filtrada (quem decide é `can()`, na
 *  página que o usa). Shell não conhece RBAC: se conhecesse, haveria dois lugares
 *  decidindo o que aparece — e o segundo envelheceria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface ShellNavItem {
  href: string;
  label: string;
  icon?: ReactNode;
  /** Item de raiz de seção: só fica ativo na rota exata. */
  exact?: boolean;
}

export interface ShellNavGroup {
  title: string;
  items: readonly ShellNavItem[];
}

export interface ShellContext {
  /** Nome exibido no bloco de contexto (instituição ou plataforma). */
  name: string;
  /** Linha secundária: papéis, plano, e-mail do operador. */
  detail?: string;
  logoUrl?: string | null;
  /** Rota do bloco de contexto (ex.: seletor de instituição). */
  href?: string;
  /** `data-testid` do bloco — os testes E2E usam `active-tenant`. */
  testId?: string;
}

export function ShellNav({
  groups,
  collapsed = false,
}: {
  groups: readonly ShellNavGroup[];
  /**
   * Barra recolhida (FASE 59): o item vira só o ícone, com o rótulo preservado
   * para leitor de tela. A decisão desce daqui para o `NavLink` em vez de cada
   * tela escolher o desenho do seu menu.
   */
  collapsed?: boolean;
}) {
  return (
    <nav aria-label="Navegação principal" className="space-y-6">
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.title} className="space-y-1">
            {/**
             * O título do grupo é REGIÃO, não rótulo de item: na barra recolhida
             * ele não some da árvore — quem navega por leitor de tela continua
             * ouvindo "Participação, Painel, link". Sem isso, a barra recolhida
             * viraria uma lista de links sem contexto nenhum.
             */}
            <p className={cn('label-caps px-3 pb-1', collapsed && 'sr-only')}>{group.title}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    exact={item.exact}
                    collapsed={collapsed}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
    </nav>
  );
}

function ShellContextBlock({
  context,
  variant,
  compact = false,
}: {
  context: ShellContext;
  variant: 'tenant' | 'platform';
  /**
   * Barra recolhida (FASE 59): sobra o logo (ou o ícone de plataforma).
   *
   * O logo é o ESSENCIAL — é ele que diz em qual instituição a pessoa está, e é
   * o que cabe em 4,5 rem. Nome e detalhe continuam na árvore, em `sr-only`: o
   * nome acessível do bloco não pode depender da largura da tela, senão o mesmo
   * link aparece nomeado numa janela e anônimo na outra.
   */
  compact?: boolean;
}) {
  const badge = variant === 'platform' ? 'Plataforma' : undefined;

  const content = (
    <div className={cn('flex min-w-0 items-center gap-3', compact && 'justify-center')}>
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-low text-on-surface-variant">
        {context.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={context.logoUrl} alt="" className="size-full object-cover" />
        ) : variant === 'platform' ? (
          <ShieldCheck className="size-5" aria-hidden />
        ) : (
          <Building2 className="size-5" aria-hidden />
        )}
      </span>

      <span className={cn('min-w-0', compact && 'sr-only')} data-testid={context.testId}>
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{context.name}</span>
          {badge ? (
            <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium tracking-wide text-brand uppercase">
              {badge}
            </span>
          ) : null}
        </span>
        {context.detail ? (
          <span className="block truncate text-xs text-muted-foreground">{context.detail}</span>
        ) : null}
      </span>
    </div>
  );

  return context.href ? (
    <Link
      href={context.href}
      className="block rounded-md p-2 transition-colors hover:bg-surface-low"
      title={compact ? `Trocar contexto — ${context.name}` : 'Trocar contexto'}
    >
      {content}
    </Link>
  ) : (
    <div className="p-2">{content}</div>
  );
}

/**
 * A sigla que representa a marca quando não há largura para o nome.
 *
 * Aceita uma sigla declarada pelo layout (`brand.short`) porque marca é decisão
 * de quem a tem; sem ela, as iniciais das palavras são a aproximação honesta —
 * "EventFlow" vira "E" e "Governança da Plataforma" vira "GP", em vez de um
 * quadrado vazio.
 */
function sigla(texto: string): string {
  const palavras = texto.split(/\s+/).filter(Boolean);
  const iniciais = palavras.map((palavra) => palavra[0]?.toUpperCase() ?? '').join('');

  return iniciais.slice(0, 2) || '?';
}

export async function AppShell({
  variant = 'tenant',
  brand,
  context,
  navGroups,
  account,
  children,
  contentClassName,
}: {
  variant?: 'tenant' | 'platform';
  brand?: { label: string; tagline?: string; short?: string };
  context: ShellContext;
  navGroups: readonly ShellNavGroup[];
  account: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  const brandLabel = brand?.label ?? 'EventFlow';

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O ESTADO DA BARRA É LIDO AQUI, NO SERVIDOR (FASE 59)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A leitura do cookie mora no PRÓPRIO shell, e não numa prop repassada por cada
   *  layout, por duas razões:
   *
   *    1. **O shell é quem desenha a barra** — e é o mesmo componente nos dois
   *       painéis (instituição e plataforma). Como prop, o segundo layout nasceria
   *       sem o recurso, ou repetindo a leitura: as duas formas de a mesma tela
   *       divergir.
   *    2. **O estado não é decisão da tela.** Nenhuma página escolhe o layout da
   *       barra lateral; a preferência é da PESSOA, e o cookie é o lugar dela.
   *
   *  O `NavCollapseToggle` continua recebendo o estado por parâmetro — quem
   *  inverte são o cookie e a Server Action, e o botão apenas reflete o que o
   *  servidor entregou.
   */
  const navMode = await readNavMode();
  const recolhida = navMode === NAV_MODE_RAIL;

  return (
    <div className="flex min-h-screen bg-surface">
      {/**
        * ───────────────────────────────────────────────────────────────────────────
        *  BARRA LATERAL (desktop) — DOIS ESTADOS (FASE 59)
        * ───────────────────────────────────────────────────────────────────────────
        *  `w-72` continua sendo o estado normal; `w-[4.5rem]` é a barra recolhida.
        *  A largura é CLASSES no HTML, decididas no servidor: sem JavaScript, sem
        *  hidratação e sem salto de layout na primeira pintura.
        *
        *  O mobile não participa: aqui é `hidden`, e quem atende a tela pequena é a
        *  gaveta (`MobileNav`), que sempre mostra ícone E rótulo. Recolher seria
        *  encolher uma barra que não está na tela.
        *
        *  `data-nav` é o contrato do E2E — a régua que prende o estado, e não a
        *  largura em pixels.
        */}
      <aside
        data-nav={navMode}
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 lg:flex',
          recolhida ? 'w-[4.5rem]' : 'w-72',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 border-b border-border py-4',
            recolhida ? 'flex-col px-2' : 'justify-between px-5',
          )}
        >
          <p className={cn('font-display text-title text-foreground', recolhida && 'sr-only')}>
            {brandLabel}
          </p>

          {/**
            * Na barra recolhida o nome não cabe — mas a marca não pode desaparecer:
            * é ela que responde "onde eu estou?". A sigla assume o lugar e o nome
            * inteiro fica em `sr-only`, com o `title` o devolvendo ao ponteiro.
            *
            * É um `<span>`, e não um link: esta barra serve à instituição E à
            * plataforma (o painel de governança usa o mesmo shell), e um destino
            * fixo aqui apontaria para uma rota que não existe num dos dois.
            */}
          {recolhida ? (
            <span
              title={brandLabel}
              className="flex size-9 items-center justify-center rounded-md border border-border bg-surface-low font-display text-sm font-semibold text-foreground"
            >
              <span aria-hidden>{sigla(brand?.short ?? brandLabel)}</span>
              <span className="sr-only">{brandLabel}</span>
            </span>
          ) : brand?.tagline ? (
            <p className="label-caps mt-0.5">{brand.tagline}</p>
          ) : null}

          <NavCollapseToggle mode={navMode} />
        </div>

        <div className="border-b border-border py-2">
          <ShellContextBlock context={context} variant={variant} compact={recolhida} />
        </div>

        {/**
         * `min-h-0` é OBRIGATÓRIO aqui, e não é detalhe de estilo.
         *
         * Um item flex em coluna tem `min-height: auto`: nunca encolhe abaixo do próprio
         * conteúdo — exatamente o que `flex-1 overflow-y-auto` precisa que ele faça. Sem
         * o `min-h-0`, um grupo de menu a mais faz a barra lateral (que é `h-screen`)
         * transbordar, e o rodapé da conta é empurrado para FORA da tela: o seletor de
         * instituição fica inalcançável. Foi o E2E que pegou, ao clicar no menu de troca
         * com a navegação já cheia.
         */}
        <div
          className={cn('min-h-0 flex-1 overflow-y-auto py-5', recolhida ? 'px-2' : 'px-3')}
        >
          <ShellNav groups={navGroups} collapsed={recolhida} />
        </div>

        <div className={cn('border-t border-border py-4', recolhida ? 'px-2' : 'px-4')}>
          {account}
        </div>
      </aside>

      {/* ── Conteúdo ────────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
          {/**
           * A gaveta NÃO repete o bloco de contexto (instituição/papéis).
           *
           * Dois motivos: a barra superior já mostra o nome ao lado do botão, e o
           * bloco de conta — no rodapé da gaveta — já traz o seletor de instituição.
           * Repetir criava `data-testid="active-tenant"` DUAS vezes no DOM, e o
           * Playwright reprova em modo estrito (`resolved to 2 elements`) mesmo com
           * um dos elementos escondido por CSS. Foi assim que a suíte E2E pegou.
           */}
          <MobileNav brandLabel={brandLabel} nav={<ShellNav groups={navGroups} />} account={account} />
          <span className="min-w-0 flex-1 truncate font-display text-body-lg font-semibold text-foreground">
            {context.name}
          </span>
        </header>

        {/**
          * ─────────────────────────────────────────────────────────────────────────
          *  A CASCA NÃO É O LANDMARK — A PÁGINA É (FASE 52 · dívida E75)
          * ─────────────────────────────────────────────────────────────────────────
          *  Aqui havia um `<main>`, e cada página autenticada renderiza o SEU: duas
          *  regiões principais na mesma tela confundem leitor de tela e quebram o modo
          *  estrito do Playwright (`locator('main')` resolve dois elementos).
          *
          *  Quem perdeu o landmark foi a CASCA, e não as telas: este wrapper é
          *  espaçamento e largura — quem diz "este é o conteúdo principal desta tela" é
          *  a própria tela. As quatro páginas que se apoiavam neste `<main>` ganharam o
          *  seu (administração, equipe, comunicação e a prévia da página pública, que
          *  herda o da `EventLanding`).
          */}
        <div className={cn('flex-1 px-4 py-6 lg:px-8 lg:py-8', contentClassName)}>
          <div className="mx-auto w-full max-w-[var(--content-max)]">{children}</div>
        </div>
      </div>
    </div>
  );
}
