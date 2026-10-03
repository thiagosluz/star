import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getTenantContext, listPublicEvents } from '@/lib/events/event-repository';
import { getPublicTenantPage } from '@/lib/tenancy/tenant-public-page-view';
import { isPubliclyVisible } from '@/domain/events/event-rules';
import { PublicEventList } from '@/components/tenancy/public-event-list';
import { TenantHome } from '@/components/tenancy/tenant-page';
import {
  buildTenantThemeScope,
  type TenantThemeScope,
} from '@/domain/tenancy/tenant-page-theme-rules';
import { ThemeChoice } from '@/components/theme/theme-choice';
import { readThemeMode } from '@/lib/theme/theme-mode-server';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A PÁGINA PÚBLICA DA INSTITUIÇÃO — `/t/<slug>` (FASE 64 · fatias 2 e 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DUAS TELAS NA MESMA URL, E A ESCOLHA É UMA SÓ PERGUNTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quando a instituição **publicou** a página personalizada, este endereço é ela:
 *  capa, identidade, os três grupos de eventos (em breve · acontecendo · antigos) e
 *  os blocos, na ordem que o organizador numerou.
 *
 *  Quando ela **nunca publicou** (ou publicou e tirou do ar), `getPublicTenantPage`
 *  devolve `null` — e a resposta NÃO é redirect, NÃO é 404 e NÃO é tela vazia: é o
 *  que sempre existiu aqui, a listagem pública de eventos da instituição. Isto é
 *  requisito de aceite, e tem teste que o prende (os casos (a) do E2E da fatia 2).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O FALLBACK NÃO DESAPARECE COM O TEMPO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A página personalizada é OPT-IN: quem administra a instituição decide montá-la, e
 *  a maioria das instituições novas não a tem. Se este endereço passasse a exigir
 *  página publicada, todo link para a raiz da casa (`ufba.lvh.me/`, o logotipo do
 *  cabeçalho, o subdomínio inteiro) levaria a uma tela morta — e o Proxy reescreve
 *  requisições de subdomínio exatamente para cá.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PÁGINA NÃO DESENHA `<main>` — ELA O HERDA DO `TenantHome`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A casca pública (cabeçalho e rodapé) deixou de ser landmark na FASE 52: o `<main>`
 *  é o CONTEÚDO da tela, e é exatamente UM. Quem escolhe entre a página personalizada
 *  e a listagem é o `TenantHome`, dentro do mesmo `<main>` — se esta página
 *  desenhasse o seu para o ramo do fallback, a tela teria dois landmarks, e a
 *  catraca do landmark único reprova isso (reprovou na primeira versão; ver o
 *  comentário do `fallback` no componente).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TELA NÃO CONTA O QUE O SERVIÇO JÁ CONTOU (LIÇÃO DA F54)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os três grupos e os seus totais vêm prontos do read model (`items` × `total` ×
 *  `hasMore`, com o limite já aplicado no domínio). Aqui não existe `filter`, `sort`
 *  nem `length` de lista dos grupos: uma segunda contagem poderia divergir da
 *  primeira, e o "ver todos" passaria a anunciar um número que ninguém conferiu.
 *  (O `filter` que sobrou é o da LISTA, e é a MESMA lista que o banco paginou — a
 *  conferência de visibilidade que a tela de eventos já fazia desde a FASE 56.)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TEMA DA INSTITUIÇÃO, E O MODO DO VISITANTE POR CIMA (FASE 64 · fatia 4)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os papéis `--ef-*` são publicados AQUI, no escopo da página, com o modo já
 *  resolvido pelo cookie `ef_tema` (FASE 63) — a regra pura está em
 *  `tenant-page-theme-rules.ts` e tem teste. O casco (cabeçalho, rodapé e o controle
 *  de aparência) fica FORA do escopo de propósito: a paleta da casa pinta a página
 *  dela, e não os controles da plataforma.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CONTROLE DE APARÊNCIA ENTROU AQUI, E NÃO NO LAYOUT — E ISSO É DELIBERADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O rodapé abaixo é DESTA página. O `(public)/layout.tsx` envolve também a página do
 *  EVENTO, onde quem manda na aparência é o organizador (ADR-325) — pôr o controle lá
 *  daria ao visitante o poder de sobrescrever o tema do evento por um clique. A
 *  catraca da FASE 63 (`f63-aparencia-do-visitante.test.ts`) prende exatamente isso, e
 *  ela continua valendo: `variant="public"` não aparece no layout nem no
 *  `account-block`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Instituição não encontrada' };

  const page = await getPublicTenantPage({
    tenantId: tenant.tenantId,
    slug: tenant.slug,
    name: tenant.name,
    timezone: tenant.timezone,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
    description: tenant.description,
  });

  /**
   * Sem página publicada, o título é o da casa: o endereço continua sendo a vitrine
   * dela (a listagem de eventos), e não uma página sem nome.
   */
  return page
    ? { title: page.title, description: page.description ?? undefined }
    : { title: tenant.name, description: tenant.description ?? undefined };
}

export default async function TenantPublicHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ pagina?: string }>;
}) {
  const { tenantSlug } = await params;
  const { pagina } = await searchParams;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  /**
   * O instante da leitura é resolvido UMA vez e desce para o agrupamento: o mesmo
   * `now` decide os três grupos, e os componentes de renderização continuam puros
   * (nenhum deles lê o relógio).
   */
  const now = new Date();

  const page = await getPublicTenantPage(
    {
      tenantId: tenant.tenantId,
      slug: tenant.slug,
      name: tenant.name,
      timezone: tenant.timezone,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
      description: tenant.description,
    },
    { now },
  );

  const events = await listPublicEvents(tenant.tenantId, { page: pagina });

  /**
   * O escopo do tema é montado só quando HÁ página publicada.
   *
   * Sem página, o que a tela mostra é a listagem de eventos da plataforma — e pintá-la
   * com a paleta de um rascunho que ninguém publicou seria mostrar a identidade que a
   * instituição ainda não decidiu exibir.
   */
  const scope = page
    ? buildTenantThemeScope({ theme: page.theme, visitorMode: await readThemeMode() })
    : null;

  return (
    <>
      <TenantComTheme scope={scope}>
        <TenantHome
          page={page}
          fallback={
            <PublicEventList
              tenantSlug={tenantSlug}
              tenantName={tenant.name}
              page={events}
              events={events.events.filter((event) => isPubliclyVisible(event.status))}
            />
          }
        />
      </TenantComTheme>

      {/**
        * O RODAPÉ DA APARÊNCIA — a variante `public` do controle da FASE 63.
        *
        * Ele fica FORA do escopo do tema (`TenantComTheme`) de propósito: os três
        * botões são controles da PLATAFORMA, e pintá-los com a paleta da instituição
        * faria o "estado atual" depender da cor que a casa escolheu.
        */}
      <footer className="border-t border-border bg-surface px-6 py-6" data-testid="tenant-page-footer">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {tenant.name} · página pública da instituição
          </p>

          <ThemeChoice variant="public" />
        </div>
      </footer>
    </>
  );
}

/**
 * O escopo do tema da instituição — um wrapper, não um segundo renderizador.
 *
 * Ele NÃO desenha nada além de publicar as custom properties: os componentes da
 * página continuam sendo os da fatia 2 (`TenantHome` → `TenantPublicPage`), e é por
 * isso que a prévia do editor e a página pública não podem divergir.
 *
 * `data-theme-mode` acompanha o modo EFETIVO — é ele que governa os controles
 * nativos (barra de rolagem, seletor de data) dentro do escopo, pela regra do
 * `data-theme-mode` que o CSS do evento já declara.
 */
function TenantComTheme({
  scope,
  children,
}: {
  scope: TenantThemeScope | null;
  children: React.ReactNode;
}) {
  if (!scope) return <>{children}</>;

  return (
    <div
      className="tenant-theme"
      style={scope.variables as React.CSSProperties}
      data-theme-mode={scope.mode}
      data-tenant-theme-scope="page"
    >
      {children}
    </div>
  );
}
