import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  Award,
  Sparkles,
  Search,
  Building2,
  QrCode,
  ShieldCheck,
  Flame,
  CheckCircle2,
  Clock,
  Compass,
  UserRound,
} from 'lucide-react';

import { ThemeChoice } from '@/components/theme/theme-choice';
import { getRequestContext } from '@/lib/auth/session';
import { buildTenantUrl } from '@/domain/tenancy/resolution';
import { resolveVitrineAccountAction } from '@/domain/platform/vitrine-account-rules';
import {
  getFeaturedPublicEvents,
  getPlatformPublicMetrics,
} from '@/lib/platform/global-repository';
import {
  formatMetricCount,
} from '@/domain/platform/platform-metrics-rules';
import {
  EVENT_CATEGORIES,
  getEventCategoryLabel,
} from '@/domain/events/event-category-rules';
import { eventModalityLabel } from '@/domain/events/event-modality-rules';

export const metadata: Metadata = {
  title: 'EventFlow · A Vitrine Viva de Eventos Acadêmicos e Corporativos',
  description:
    'Descubra eventos, inscreva-se com segurança, receba crachás digitais, conquiste certificados autenticados por QR Code e participe de comunidades.',
};

const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'lvh.me';

function formatEventDate(startsAt: Date, endsAt: Date): string {
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const sameDay =
    startsAt.getFullYear() === endsAt.getFullYear() &&
    startsAt.getMonth() === endsAt.getMonth() &&
    startsAt.getDate() === endsAt.getDate();

  if (sameDay) {
    return dateFormatter.format(startsAt);
  }
  return `${dateFormatter.format(startsAt)} a ${dateFormatter.format(endsAt)}`;
}

export default async function PlatformHomePage() {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A VITRINE É DE TODOS — INCLUSIVE DE QUEM TEM SESSÃO
   * ─────────────────────────────────────────────────────────────────────────────
   *  Aqui havia dois `redirect()`: com instituição ativa a raiz mandava para
   *  `/t/<slug>/dashboard`; autenticada sem vínculo, para `/selecionar-instituicao`.
   *  O efeito prático era que a pessoa logada NÃO CONSEGUIA ABRIR a vitrine — o
   *  endereço público da plataforma ficava inacessível justamente para quem já é da
   *  casa, e quem clicasse no logo de uma página qualquer era jogado no painel.
   *
   *  A decisão de DESTINO não se perdeu: ela mudou de lugar. O que era para onde
   *  redirecionar passou a ser para onde aponta o botão "Minha área" do cabeçalho, e
   *  a regra vive em `resolveVitrineAccountAction` (domínio), com o mesmo critério e
   *  os mesmos caminhos de antes. Por isso a leitura de contexto continua sendo
   *  `getRequestContext()`: é ela que revalida o cookie assinado contra os vínculos
   *  reais e diz qual é a instituição ativa — inventar outro caminho para descobrir o
   *  slug do painel seria decidir diferente do que o produto decidia.
   *
   *  O preço é conhecido e aceito: quem tem sessão paga a leitura de vínculos nesta
   *  página (quem não tem, sai antes, na primeira linha de `getRequestContext`). A
   *  alternativa — adivinhar o destino pelo cookie sem revalidar — daria o mesmo
   *  resultado na maioria das vezes e o ERRADO exatamente quando alguém perde o
   *  vínculo, que é quando a resposta precisa estar certa.
   */
  const context = await getRequestContext();
  const accountAction = resolveVitrineAccountAction({
    isAuthenticated: Boolean(context?.user),
    activeTenantSlug: context?.activeTenant?.tenantSlug ?? null,
  });

  // Leitura paralela de dados da vitrine viva e métricas públicas agregadas
  const [featuredEvents, metrics] = await Promise.all([
    getFeaturedPublicEvents(6),
    getPlatformPublicMetrics(),
  ]);

  const popularCategories = EVENT_CATEGORIES.slice(0, 5);

  return (
    <main className="min-h-screen bg-background text-foreground" data-testid="platform-home-page">
      {/* ─── BARRA DE NAVEGAÇÃO SUPERIOR ─────────────────────────────────────── */}
      <header className="border-b border-border bg-card/70 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight text-lg text-foreground hover:opacity-90">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-black text-sm shadow-xs">
                EF
              </span>
              <span>EventFlow</span>
            </Link>

            <nav className="hidden md:flex items-center gap-4 text-sm font-medium">
              <Link
                href="/eventos"
                className="text-muted-foreground transition hover:text-foreground inline-flex items-center gap-1.5"
              >
                <Compass className="size-4" aria-hidden />
                Explorar Eventos
              </Link>
              <Link
                href="/para-instituicoes"
                className="text-muted-foreground transition hover:text-foreground inline-flex items-center gap-1.5"
              >
                <Building2 className="size-4" aria-hidden />
                Para Instituições
              </Link>
            </nav>
          </div>

          {/*
            ───────────────────────────────────────────────────────────────────────
             O CABEÇALHO SABE QUEM ESTÁ OLHANDO (mas o CONTEÚDO não muda)
            ───────────────────────────────────────────────────────────────────────
             A troca é de BOTÃO, não de página: quem tem sessão perde os dois
             convites ("Entrar" e "Criar conta" não fazem sentido para quem já
             entrou) e ganha o caminho da própria área. É exatamente o par que o
             cabeçalho público da instituição já desenhava — mesmas palavras, mesma
             fonte de rótulo (`MINHA_AREA_LABEL`), para as duas telas não divergirem.

             A âncora é `<Link>` de verdade (nada de `onClick`): navegação por
             teclado, "abrir em nova aba" e o rastreamento de link continuam
             funcionando — e o destino vem da regra de domínio, não do JSX.
          */}
          <div className="flex items-center gap-2.5">
            {accountAction.kind === 'account' ? (
              <Link
                href={accountAction.href}
                data-testid="vitrine-account-link"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs sm:text-sm font-medium text-primary-foreground shadow-xs transition hover:opacity-90"
              >
                <UserRound className="size-3.5" aria-hidden />
                {accountAction.label}
              </Link>
            ) : (
              <>
                <Link
                  href={accountAction.loginHref}
                  className="rounded-md px-3.5 py-1.5 text-xs sm:text-sm font-medium text-muted-foreground transition hover:text-foreground hover:bg-muted"
                >
                  Entrar
                </Link>
                <Link
                  href={accountAction.signupHref}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs sm:text-sm font-medium text-primary-foreground shadow-xs transition hover:opacity-90"
                >
                  Criar conta
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ─── HERO SECTION COM BUSCA RÁPIDA ──────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border py-16 sm:py-24 bg-radial from-primary/5 via-background to-background">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3.5 py-1 text-xs font-medium text-muted-foreground shadow-2xs">
            <Sparkles className="size-3.5 text-primary" aria-hidden />
            A vitrine viva de congressos, simpósios e encontros institucionais
          </div>

          <h1 className="text-balance text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-foreground">
            Encontre conhecimento, viva experiências e{' '}
            <span className="text-primary underline decoration-primary/40 underline-offset-6">
              certifique seu percurso
            </span>
          </h1>

          <p className="mx-auto max-w-2xl text-pretty text-base sm:text-lg text-muted-foreground">
            Descubra os principais eventos acadêmicos, corporativos e comunitários do país.
            Inscrições simplificadas, submissões com revisão por pares e emissão oficial de certificados.
          </p>

          {/* Campo de Busca Rápida de Eventos */}
          <div className="mx-auto max-w-2xl">
            <form
              action="/eventos"
              method="GET"
              className="flex flex-col sm:flex-row items-stretch gap-2 rounded-xl border border-border bg-card p-2 shadow-sm"
              data-testid="home-search-form"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden />
                <input
                  type="text"
                  name="q"
                  placeholder="Busque por nome do evento, tema ou cidade..."
                  aria-label="Buscar eventos"
                  className="w-full rounded-lg border-0 bg-transparent py-2.5 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-0"
                />
              </div>

              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 shrink-0"
              >
                <span>Explorar</span>
                <ArrowRight className="size-4" aria-hidden />
              </button>
            </form>

            {/* Categorias em alta */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className="text-muted-foreground">Temas frequentes:</span>
              {popularCategories.map((cat) => (
                <Link
                  key={cat.key}
                  href={`/eventos?categoria=${cat.key}`}
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-muted-foreground transition hover:border-primary hover:text-foreground"
                >
                  {cat.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── EVENTOS EM DESTAQUE NA PLATAFORMA ───────────────────────────────── */}
      {/*
        ─────────────────────────────────────────────────────────────────────────
         A ALTURA DESTA SEÇÃO NÃO PODE DEPENDER DO BANCO (FASE 81)
        ─────────────────────────────────────────────────────────────────────────
        A seção lê "eventos em destaque" a cada render, e isso é proposital: a
        vitrine é viva (FASE 71). O que NÃO pode ser vivo é a GEOMETRIA dela.

        O `f62` fotografa a PÁGINA INTEIRA (`fullPage`) e mascara os dois blocos
        dinâmicos — mas máscara esconde PIXEL, não LAYOUT: a seção continua
        ocupando espaço na imagem, e o rodapé (o alvo real da linha de base) fica
        onde ela terminar. Enquanto a altura seguir o dado, toda execução que
        deixar um evento a mais no banco (a suíte de integração do Vitest deixa)
        muda a altura da página e reprova o snapshot por um motivo que não é
        desenho — o "defeito" seria a fixture, não a tela.

        O desenho promete DUAS FILEIRAS de três cartões. O cartão passou a ter
        altura fixa de 237 px (título em até duas linhas, resumo em uma, ficha e
        rodapé), então a grade reserva 2 × 237 + 24 (o vão) = 498 px para
        QUALQUER quantidade de 0 a 6 eventos. O `min-h` não corta conteúdo: ele é
        MAIOR que o conteúdo máximo do cartão (225 px) — cortar exigiria uma
        altura menor que o texto, que é justamente o que não se faz aqui.

        O resumo perdeu a segunda linha (`line-clamp-1`): ele era o único bloco
        do cartão cuja altura variava com o DADO (dois eventos da lista têm
        resumo, três não; uns ocupam duas linhas, outros uma). Uma linha é o
        mesmo tipo de recorte que o desenho já fazia em duas; a diferença é que
        agora o teto do cartão é conhecido antes de o banco responder.
      */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 space-y-8" data-testid="featured-events-section">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Flame className="size-3.5 text-primary" aria-hidden />
              Eventos em Destaque
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl text-foreground mt-1">
              Próximos eventos com inscrições abertas
            </h2>
          </div>

          <Link
            href="/eventos"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground underline underline-offset-4 hover:text-muted-foreground shrink-0"
          >
            Ver todos os eventos
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        {featuredEvents.length === 0 ? (
          <div className="flex min-h-[498px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center space-y-3">
            <CalendarDays className="mx-auto size-10 text-muted-foreground" aria-hidden />
            <h3 className="text-base font-semibold text-foreground">Novos eventos sendo preparados</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Nossa comunidade está organizando as próximas edições. Explore o diretório completo de instituições para saber mais.
            </p>
            <div className="pt-2">
              <Link
                href="/eventos?aba=instituicoes"
                className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-xs font-medium hover:bg-muted"
              >
                Ver instituições ativas
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid min-h-[498px] content-center gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredEvents.map((event) => {
              const eventPublicUrl = buildTenantUrl({
                slug: event.tenantSlug,
                rootDomain: ROOT_DOMAIN,
                path: `/eventos/${event.slug}`,
              });
              return (
                <article
                  key={event.id}
                  className="group flex min-h-[237px] flex-col justify-between rounded-xl border border-border bg-card p-4 transition hover:border-primary/50 hover:shadow-md"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="rounded-full border border-border bg-muted/60 px-2.5 py-0.5 font-medium text-foreground text-xs">
                        {getEventCategoryLabel(event.category)}
                      </span>
                      <span className="text-muted-foreground">
                        {eventModalityLabel(event.modality)}
                      </span>
                    </div>

                    <h3 className="text-lg font-semibold tracking-tight text-foreground line-clamp-2 group-hover:text-primary transition">
                      <a href={eventPublicUrl} target="_blank" rel="noopener noreferrer">
                        {event.title}
                      </a>
                    </h3>

                    {event.summary ? (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {event.summary}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5 truncate">
                        <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                        {formatEventDate(event.startsAt, event.endsAt)}
                      </span>
                      {event.city ? (
                        <span className="truncate max-w-[100px]">
                          {event.city}{event.state ? `/${event.state}` : ''}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-2 truncate">
                        {event.tenantLogoUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={event.tenantLogoUrl}
                            alt=""
                            className="size-5 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-bold text-xs">
                            {event.tenantName.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <span className="text-xs font-medium text-muted-foreground truncate">
                          {event.tenantName}
                        </span>
                      </div>

                      <a
                        href={eventPublicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                      >
                        Participar
                        <ArrowRight className="size-3" aria-hidden />
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── A JORNADA DO PARTICIPANTE (4 PILARES) ─────────────────────────── */}
      <section className="border-y border-border bg-card/40 py-16 sm:py-20" data-testid="participant-journey-section">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-12">
          <div className="text-center space-y-3 max-w-2xl mx-auto">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Experiência Completa
            </span>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Toda a jornada do evento: do credenciamento ao certificado
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground">
              Acompanhe sua trajetória acadêmica e profissional com infraestrutura desenhada para valorizar cada atividade realizada.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-xl border border-border bg-card p-6 space-y-3">
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <CalendarDays className="size-5" aria-hidden />
              </span>
              <h3 className="text-base font-semibold text-foreground">Inscrições Ágeis</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Inscreva-se em múltiplos eventos com seu perfil único. Controle de lotação transparente, lista de espera automática e formulários personalizados.
              </p>
            </article>

            <article className="rounded-xl border border-border bg-card p-6 space-y-3">
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <QrCode className="size-5" aria-hidden />
              </span>
              <h3 className="text-base font-semibold text-foreground">Credenciamento & Crachá</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Crachá digital no celular com QR Code exclusivo para portaria e leitura de frequência por atividade e minicurso em tempo real.
              </p>
            </article>

            <article className="rounded-xl border border-border bg-card p-6 space-y-3">
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="size-5" aria-hidden />
              </span>
              <h3 className="text-base font-semibold text-foreground">Gamificação & XP</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Ganhe pontos de experiência (XP), cumpra missões e desbloqueie cartas colecionáveis exclusivas por sua presença, submissão e avaliação de trabalhos.
              </p>
            </article>

            <article className="rounded-xl border border-border bg-card p-6 space-y-3">
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Award className="size-5" aria-hidden />
              </span>
              <h3 className="text-base font-semibold text-foreground">Certificação Oficial</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Certificados digitais com carga horária real discriminada, hash criptográfico de integridade e link público permanente para verificação instantânea.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ─── MÉTRICAS PÚBLICAS DA PLATAFORMA ───────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" data-testid="public-metrics-section">
        <div className="rounded-2xl border border-border bg-card p-8 sm:p-12 space-y-8">
          <div className="text-center space-y-2 max-w-xl mx-auto">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              A força da nossa rede em números
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Métricas agregadas em tempo real de todas as instituições e eventos ativos na plataforma.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
            <div className="text-center px-4 pt-4 sm:pt-0">
              <p className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
                {formatMetricCount(metrics.totalTenants)}
              </p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Instituições Ativas
              </p>
            </div>

            <div className="text-center px-4 pt-4 sm:pt-0">
              <p className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
                {formatMetricCount(metrics.totalEvents)}
              </p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Eventos Realizados
              </p>
            </div>

            <div className="text-center px-4 pt-4 sm:pt-0">
              <p className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
                {formatMetricCount(metrics.totalRegistrations)}
              </p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Inscrições Processadas
              </p>
            </div>

            <div className="text-center px-4 pt-4 sm:pt-0">
              <p className="text-3xl sm:text-4xl font-extrabold text-foreground tracking-tight">
                {formatMetricCount(metrics.totalCertificates)}
              </p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Certificados Emitidos
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-border flex items-center justify-center gap-2 text-xs text-muted-foreground text-center">
            <Clock className="size-3.5" aria-hidden />
            <span>Validação criptográfica permanente por QR Code em todos os certificados emitidos.</span>
          </div>
        </div>
      </section>

      {/* ─── BANNER PARA ORGANIZADORES & INSTITUIÇÕES ───────────────────────── */}
      <section className="border-t border-border bg-muted/40 py-16 sm:py-20" data-testid="institutions-banner-section">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-8 rounded-2xl border border-border bg-card p-8 sm:p-12">
            <div className="space-y-4 max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground">
                <ShieldCheck className="size-3.5 text-primary" aria-hidden />
                Para Universidades, Associações e Empresas
              </div>

              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Pronto para transformar a gestão de eventos da sua instituição?
              </h2>

              <p className="text-sm text-muted-foreground leading-relaxed">
                Garanta isolamento completo dos seus dados, submissão cega com critérios de avaliação por pares,
                crachás térmicos e emissão automática em lote com a sua própria marca e subdomínio institucional.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <Link
                  href="/para-instituicoes"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs transition hover:opacity-90"
                >
                  Conheça a plataforma para instituições
                  <ArrowRight className="size-4" aria-hidden />
                </Link>

                <Link
                  href="/para-instituicoes#contato"
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted"
                >
                  Falar com especialista
                </Link>
              </div>
            </div>

            <div className="w-full lg:w-auto shrink-0 space-y-3 rounded-xl border border-border bg-muted/50 p-6 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground text-sm">O que sua organização ganha:</div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-primary shrink-0" />
                <span>Isolamento seguro de dados via Row-Level Security</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-primary shrink-0" />
                <span>Submissão por trilha com avaliação duplamente cega</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-primary shrink-0" />
                <span>Leitura ágil de crachás e controle de presença</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-primary shrink-0" />
                <span>Página pública personalizada com sua identidade visual</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── RODAPÉ DA PLATAFORMA ────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-card py-12 text-xs text-muted-foreground">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
            <div className="space-y-1">
              <div className="flex items-center justify-center sm:justify-start gap-2 font-bold text-sm text-foreground">
                <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground font-black text-xs">
                  EF
                </span>
                <span>EventFlow SaaS</span>
              </div>
              <p className="max-w-md text-xs text-muted-foreground">
                Plataforma integrada de gestão, descoberta e certificação de eventos acadêmicos, comunitários e corporativos.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 text-xs">
              <Link href="/eventos" className="hover:text-foreground transition">
                Explorar Eventos
              </Link>
              <Link href="/eventos?aba=instituicoes" className="hover:text-foreground transition">
                Diretório de Instituições
              </Link>
              <Link href="/para-instituicoes" className="hover:text-foreground transition">
                Para Instituições
              </Link>
              <Link href="/login" className="hover:text-foreground transition">
                Área do Participante
              </Link>
            </div>
          </div>

          <div className="pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <p>
              Cada instituição acessa pelo próprio subdomínio (<span className="code-data">instituicao.{ROOT_DOMAIN}</span>) ou por <span className="code-data">/t/&lt;slug&gt;</span>.
            </p>

            {/* Seletor de Tema Público (FASE 63) */}
            <ThemeChoice variant="public" />
          </div>
        </div>
      </footer>
    </main>
  );
}
