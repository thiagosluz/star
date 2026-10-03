import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Eye,
  ExternalLink,
  Mail,
  MapPin,
  Phone,
  Users,
} from 'lucide-react';

import {
  TENANT_PAGE_BLOCK_LABELS,
  TENANT_PAGE_GROUP_LABELS,
  TENANT_PAGE_GROUP_ORDER,
  fraseDoGrupoVazio,
  mostrarVerTodos,
  totalDoGrupo,
  type TenantPageGroup,
  type TenantPageGroupView,
} from '@/domain/tenancy/tenant-page-presentation';
import {
  TENANT_MAX_FAQ_ITEMS,
  type TenantPageBlock,
} from '@/domain/tenancy/tenant-public-page';
import { tenantPath } from '@/domain/tenancy/resolution';
import type {
  PublicTenantEventCard,
  PublicTenantPageView,
} from '@/lib/tenancy/tenant-public-page-view';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A PÁGINA PÚBLICA DA INSTITUIÇÃO — componente COMPARTILHADO
 *                                                    (FASE 64 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE É UM COMPONENTE, E NÃO UMA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É a MESMA decisão que a FASE 23 tomou para a página do evento (e9): a
 *  pré-visualização do rascunho (fatia 3, outro agente) precisa mostrar exatamente
 *  o que o visitante verá. A alternativa — uma segunda tela "parecida com a
 *  pública" — começa idêntica e termina diferente, e a diferença aparece sempre na
 *  hora errada: o organizador aprova na prévia algo que o site não mostra.
 *
 *  Então a página pública é este componente, com dois consumidores:
 *
 *      /t/<slug>                              (o visitante, sem sessão)
 *      /t/<slug>/administracao/pagina/previa  (o organizador — fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PURO E SEM ESTADO — O READ MODEL ENTRA POR PROP
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O componente não consulta o banco, não lê cookie e não chama relógio: ele recebe
 *  `page` (o read model de `getPublicTenantPage`, fatia 1) e desenha. Quem decide o
 *  que é "em breve", "acontecendo" e "antigo" é `groupTenantEvents`, no domínio, com
 *  o fuso da instituição — a tela não reclassifica nada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `<main>` É DESTE COMPONENTE, E É ÚNICO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A casca pública (cabeçalho/rodapé, FASE 11A) deixou de ser landmark na FASE 52:
 *  o `<main>` é o CONTEÚDO da tela. Como os dois consumidores desenham esta página,
 *  o landmark nasce aqui — assim a prévia também tem exatamente um, e um `<main>`
 *  novo na casca reprova a catraca de landmark (o portão WCAG AA conta os `<main>`
 *  da tela, nos dois sentidos).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE O ORGANIZADOR ESCREVE E O QUE A PÁGINA LÊ NA RENDERIZAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `PAST_EVENTS` é o caso que define a régua (ADR-168, herdada da FASE 33): o bloco
 *  guarda só a DECORAÇÃO (título, descrição, limite) e a lista de eventos antigos é
 *  lida do read model AGORA. Copiar evento para dentro do bloco mentiria no dia
 *  seguinte — o histórico continuaria mostrando a edição que acabou sem aparecer a
 *  que terminou ontem.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A APARÊNCIA É DA PLATAFORMA NESTA FATIA (de propósito)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A paleta da instituição entra na fatia 4. Aqui a página usa os tokens do sistema
 *  (`bg-surface`, `border-border`, `text-muted-foreground`…) e NÃO publica `--ef-*`:
 *  assim o claro/escuro do VISITANTE continua valendo por cima, que é a decisão
 *  registrada em `docs/fase-64-plano.md` (e o que quita a dívida E84 para esta
 *  página, diferentemente da página do evento).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** O aviso que só a PRÉVIA desenha (fatia 3). */
export interface TenantPagePreviewInfo {
  /** Frase curta com o estado da publicação ("publicada em 12/03 às 10:00"). */
  publicationLabel: string;
  /** Caminho de volta para o editor. */
  editorHref: string;
}

export interface TenantPageProps {
  /** A página como o visitante a vê — publicada (fatia 2) ou o rascunho (fatia 3). */
  page: PublicTenantPageView;
  /** Presente apenas na pré-visualização do organizador. */
  preview?: TenantPagePreviewInfo;
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  QUAL ELEMENTO É O LANDMARK DESTA PÁGINA (`main` × `none`)
   * ─────────────────────────────────────────────────────────────────────────────
   *  `main` é o padrão e é o certo para o VISITANTE: na página pública este é o
   *  conteúdo, e ele é exatamente UM (a casca deixou de ser landmark na FASE 52).
   *
   *  `none` existe para o EDITOR, que embute esta página inteira como prévia e já
   *  desenhou o `<main>` dele (o conteúdo da tela do editor). Sem esta saída a tela
   *  ficaria com DOIS landmarks `main` — dois "conteúdo principal" para quem navega
   *  por leitor de tela, que é o defeito que a FASE 60 prendeu no sentido inverso e
   *  que a catraca do portão WCAG AA reprova.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE UMA PROP, E NÃO UM TRUQUE DE CSS (a primeira tentativa, desfeita)
   *  ─────────────────────────────────────────────────────────────────────────────
   *  A primeira versão resolvia isso com `display: contents` no `<main>` da prévia
   *  por uma regra de `<style>`. Funcionava para a CONTAGEM de caixas e era pior no
   *  resto: `display: contents` tira a caixa do elemento, mas o nó continua na árvore
   *  de acessibilidade como região `main` em parte dos leitores, e o editor ficava
   *  dependendo de um seletor global para não mentir sobre a sua própria estrutura.
   *
   *  Com a prop, quem MONTA decide o elemento — e a prévia deixa de ser um `<main>`
   *  pelo motivo certo: ali ela não é o conteúdo principal, é um pedaço do formulário.
   *  O que a prévia mostra não muda em nada (mesmos filhos, mesmo `data-testid`,
   *  mesmas classes); muda só a tag do contêiner.
   */
  landmark?: 'main' | 'none';
}

/** A raiz da instituição: a página personalizada quando existe, senão o fallback. */
export interface TenantHomeProps {
  page: PublicTenantPageView | null;
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O FALLBACK É OBRIGATÓRIO AQUI, E É ELE QUE MANTÉM O LANDMARK ÚNICO
   * ─────────────────────────────────────────────────────────────────────────────
   *  Quando a instituição nunca publicou a página, `/t/<slug>` tem de continuar
   *  servindo a listagem de eventos dela (requisito de aceite). A tentação é a
   *  PÁGINA decidir entre "página personalizada" e "listagem" — e aí ela desenharia
   *  um `<main>` para o segundo caso enquanto o primeiro herda o daqui: **dois
   *  landmarks na mesma tela**, que é exatamente o defeito H5 que a FASE 52 prendeu
   *  (e a catraca do landmark único reprovou, como reprovou na primeira versão
   *  deste arquivo).
   *
   *  Com o fallback entrando por PROP, o `<main>` é desenhado em UM lugar só — este
   *  —, e nenhum consumidor pode criar um segundo por acidente. Quem chama passa o
   *  conteúdo que já sabe montar (`PublicEventList`), e não uma segunda tela.
   */
  fallback: React.ReactNode;
  /** Presente apenas na pré-visualização do organizador (fatia 3). */
  preview?: TenantPagePreviewInfo;
}

/**
 * O que a RAIZ DA INSTITUIÇÃO renderiza: a página personalizada quando existe, e a
 * listagem de eventos quando não existe.
 *
 * A escolha acontece AQUI (e não na página) para o landmark ser único por construção
 * — ver o comentário do `fallback`.
 */
export function TenantHome({ page, fallback, preview }: TenantHomeProps) {
  if (page) return <TenantPublicPage page={page} preview={preview} />;

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10" data-testid="tenant-events-fallback">
      {fallback}
    </main>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura defensiva do conteúdo do bloco
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O conteúdo já foi validado no domínio (`validateTenantBlockContent`) na hora de
 * gravar. A leitura aqui é defensiva na MESMA medida do renderizador do evento: uma
 * linha gravada antes de uma regra existir não pode derrubar a página inteira. E,
 * como lá, o conteúdo NUNCA é injetado como HTML — lemos campos e deixamos o React
 * escapar o texto.
 */
function lerTexto(content: unknown, key: string): string | null {
  if (typeof content !== 'object' || content === null) return null;

  const valor = (content as Record<string, unknown>)[key];
  if (typeof valor !== 'string') return null;

  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : null;
}

function lerLista(content: unknown, key: string): unknown[] {
  if (typeof content !== 'object' || content === null) return [];

  const valor = (content as Record<string, unknown>)[key];
  return Array.isArray(valor) ? valor : [];
}

/** O inteiro dentro da faixa — fora dela cai no padrão do bloco. */
function lerInteiro(content: unknown, key: string, padrao: number, max: number): number {
  if (typeof content !== 'object' || content === null) return padrao;

  const valor = (content as Record<string, unknown>)[key];
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return padrao;

  const inteiro = Math.floor(valor);
  if (inteiro < 1 || inteiro > max) return padrao;

  return inteiro;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Peças de layout da página
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Uma faixa da página.
 *
 * A largura e o respiro são os MESMOS em todas as seções — o que muda de uma para
 * outra é o conteúdo. Sem `--ef-*`: a densidade é da plataforma nesta fatia.
 */
function Faixa({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="px-6 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 space-y-2">
          {eyebrow ? <p className="label-caps">{eyebrow}</p> : null}
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? (
            <p className="max-w-2xl text-pretty text-sm text-muted-foreground">{description}</p>
          ) : null}
        </header>
        {children}
      </div>
    </section>
  );
}

/** O rótulo do período de um evento — escrito pelo domínio, no fuso da instituição. */
function Periodo({ texto }: { texto: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <CalendarDays className="size-3.5 shrink-0" aria-hidden />
      {texto}
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  O cartão de evento
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O cartão do evento na vitrine da instituição.
 *
 * O período chega ESCRITO (`periodLabel`), no fuso da instituição, porque quem lê a
 * vitrine da casa pensa no horário da casa — mesma decisão de `formatTenantEventPeriod`.
 * O selo de "está acontecendo agora" vem do GRUPO a que o evento pertence, e não de
 * uma segunda conta de data feita aqui.
 */
function CartaoDeEvento({
  event,
  tenantSlug,
}: {
  event: PublicTenantEventCard;
  tenantSlug: string;
}) {
  const local = [event.city, event.state].filter(Boolean).join('/');
  const vagas =
    event.remainingSeats === null
      ? 'Vagas ilimitadas'
      : event.remainingSeats === 0
        ? 'Vagas esgotadas'
        : `${event.remainingSeats} ${event.remainingSeats === 1 ? 'vaga' : 'vagas'}`;

  return (
    <li className="h-full" data-testid="tenant-event-card" data-event-slug={event.slug}>
      <Link
        href={tenantPath(tenantSlug, `/eventos/${event.slug}`)}
        className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-card transition-colors hover:border-primary/50"
      >
        {event.coverImageUrl ? (
          // A capa do evento é DECORAÇÃO aqui: o título vem logo abaixo, e um texto
          // alternativo repetido faria o leitor de tela ouvir o nome duas vezes.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.coverImageUrl} alt="" className="h-36 w-full object-cover" />
        ) : (
          <div className="h-2 w-full bg-primary-soft" aria-hidden />
        )}

        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            {event.isHappeningNow ? (
              <Badge tone="success" withDot>
                Acontecendo agora
              </Badge>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {event.modality === 'ONLINE'
                ? 'Online'
                : event.modality === 'HYBRID'
                  ? 'Híbrido'
                  : 'Presencial'}
            </span>
          </div>

          <h3 className="text-lg font-semibold tracking-tight text-foreground">{event.title}</h3>

          {event.summary ?? event.subtitle ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {event.summary ?? event.subtitle}
            </p>
          ) : null}

          <dl className="mt-auto space-y-1.5 text-xs text-muted-foreground">
            <div>
              <dd>
                <Periodo texto={event.periodLabel} />
              </dd>
            </div>

            {local ? (
              <div className="flex items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <dd>{event.venueName ? `${event.venueName}, ${local}` : local}</dd>
              </div>
            ) : null}

            <div className="flex items-center gap-1.5">
              <Users className="size-3.5 shrink-0" aria-hidden />
              <dd>{vagas}</dd>
            </div>
          </dl>

          <span className="inline-flex items-center gap-1 text-sm font-medium text-brand">
            Ver evento
            <ArrowRight className="size-3.5" aria-hidden />
          </span>
        </div>
      </Link>
    </li>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Os três grupos de eventos
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Um grupo da vitrine: título, os eventos daquele grupo e o caminho para a lista
 * completa.
 *
 * O "ver todos" só aparece quando o serviço diz que há mais (`hasMore`), e o número
 * que ele anuncia é o `total` do serviço — a tela NÃO reconta os `items` (lição da
 * F54). A decisão de mostrar/esconder e o número são regra pura
 * (`tenant-page-presentation.ts`), provada sem navegador.
 */
function GrupoDaVitrine({
  group,
  view,
  tenantSlug,
}: {
  group: TenantPageGroup;
  /**
   * O grupo como o serviço o devolveu. Desenhamos `events` (o evento COMO ELE É) e
   * não `items` (o cartão mínimo do domínio): o nosso cartão mostra resumo, local e
   * vagas, que o grupo do domínio não conhece. `periodLabel` e `isHappeningNow`
   * chegam preenchidos nos DOIS — o domínio os escreve no agrupamento.
   */
  view: { events: readonly PublicTenantEventCard[] } & TenantPageGroupView;
  tenantSlug: string;
}) {
  const labels = TENANT_PAGE_GROUP_LABELS[group];
  const total = totalDoGrupo(view);
  const cards = view.events;

  return (
    <div className="space-y-4" data-testid={`tenant-group-${group.toLowerCase()}`}>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{labels.title}</h2>

      {cards.length === 0 ? (
        <p
          className="rounded-md border border-border bg-surface-low p-4 text-sm text-muted-foreground"
          data-testid={`tenant-group-empty-${group.toLowerCase()}`}
        >
          {fraseDoGrupoVazio(group)}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((event) => (
            <CartaoDeEvento key={event.id} event={event} tenantSlug={tenantSlug} />
          ))}
        </ul>
      )}

      {/**
        * ───────────────────────────────────────────────────────────────────────────
        *  "VER TODOS" — E O NÚMERO QUE ELE ANUNCIA VEM DO SERVIÇO (LIÇÃO DA F54)
        * ───────────────────────────────────────────────────────────────────────────
        *  O link só aparece quando o serviço diz que há mais (`hasMore`), e o total
        *  entre parênteses é o `total` que ele contou — a tela NÃO reconta os `items`.
        *  Recontar aqui diria "ver todos os 6" embaixo de uma lista de 6, com 12 no
        *  banco: é o defeito que a FASE 54 prendeu no selo de contagem, e ele
        *  reaparece em toda tela que mostra uma FATIA e convida a ver o TODO.
        */}
      {mostrarVerTodos(view) ? (
        <p className="text-sm">
          <Link
            href={tenantPath(tenantSlug, '/eventos')}
            className="font-medium text-brand underline-offset-4 hover:underline"
            data-testid={`tenant-group-more-${group.toLowerCase()}`}
          >
            {labels.verTodos} ({total} no total)
          </Link>
        </p>
      ) : null}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Os blocos
// ───────────────────────────────────────────────────────────────────────────────
function BlocoTexto({ content }: { content: unknown }) {
  const body = lerTexto(content, 'body');
  if (!body) return null;

  return (
    <Faixa title={lerTexto(content, 'title') ?? 'Sobre a instituição'}>
      <div className="max-w-3xl whitespace-pre-line text-pretty leading-relaxed text-muted-foreground">
        {body}
      </div>
    </Faixa>
  );
}

/**
 * `ABOUT` — a história da casa.
 *
 * Diferente do `RICH_TEXT` do evento (que tem teto de texto curto), este bloco é uma
 * apresentação: o corpo é longo e o ano de fundação é um RÓTULO, não uma data — "1957"
 * e "séc. XIX" são ambos legítimos, e por isso ele é desenhado como texto.
 */
function BlocoSobre({ content }: { content: unknown }) {
  const body = lerTexto(content, 'body');
  const founded = lerTexto(content, 'foundedLabel');

  if (!body && !founded) return null;

  return (
    <Faixa
      eyebrow="Quem somos"
      title={lerTexto(content, 'title') ?? 'Sobre a instituição'}
      description={founded ? `Fundada em ${founded}.` : null}
    >
      {body ? (
        <div className="max-w-3xl whitespace-pre-line text-pretty leading-relaxed text-muted-foreground">
          {body}
        </div>
      ) : null}
    </Faixa>
  );
}

/**
 * `PAST_EVENTS` — o histórico AUTOMÁTICO (decisão do humano, e a régua do ADR-168).
 *
 * O bloco guarda só a decoração e o LIMITE; os eventos vêm do read model, já
 * classificados como antigos pelo domínio, e o limite escolhido no bloco é aplicado
 * AQUI — sobre a lista que o serviço entregou. A lista pode ser um recorte (o
 * "ver todos" do grupo `PAST` continua levando ao histórico completo).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE NÃO REPETE O TÍTULO DO GRUPO
 * ─────────────────────────────────────────────────────────────────────────────
 *  O grupo dos antigos já se chama "Edições anteriores" — e o organizador que
 *  adiciona este bloco costuma deixar o padrão. Dois títulos idênticos na mesma
 *  página parecem defeito de layout. O bloco se anuncia por um RÓTULO acima
 *  ("Histórico"), e o título que o organizador escreveu (ou o próprio nome do bloco)
 *  fica como título da seção.
 */
function BlocoHistorico({
  content,
  pastEvents,
  tenantSlug,
}: {
  content: unknown;
  pastEvents: readonly PublicTenantEventCard[];
  tenantSlug: string;
}) {
  const limit = lerInteiro(content, 'limit', 6, 24);
  const escolhidos = pastEvents.slice(0, limit);

  if (escolhidos.length === 0) return null;

  return (
    <Faixa
      id="edicoes-anteriores"
      eyebrow="Histórico"
      title={lerTexto(content, 'title') ?? TENANT_PAGE_BLOCK_LABELS.PAST_EVENTS}
      description={lerTexto(content, 'description')}
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {escolhidos.map((event) => (
          <CartaoDeEvento key={event.id} event={event} tenantSlug={tenantSlug} />
        ))}
      </ul>

      <p className="mt-4">
        <Link
          href={tenantPath(tenantSlug, '/eventos')}
          className="text-sm font-medium text-brand underline-offset-4 hover:underline"
        >
          Ver o histórico completo
        </Link>
      </p>
    </Faixa>
  );
}

/** `CONTACT` — como falar com a casa. */
function BlocoContato({ content }: { content: unknown }) {
  const address = lerTexto(content, 'address');
  const email = lerTexto(content, 'email');
  const phone = lerTexto(content, 'phone');
  const mapUrl = lerTexto(content, 'mapUrl');

  if (!address && !email && !phone && !mapUrl) return null;

  return (
    <Faixa
      id="contato"
      eyebrow="Fale com a gente"
      title={lerTexto(content, 'title') ?? 'Contato e localização'}
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {address ? (
          <li className="flex items-start gap-2 rounded-md border border-border bg-card p-4 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">{address}</span>
          </li>
        ) : null}

        {email ? (
          <li className="flex items-start gap-2 rounded-md border border-border bg-card p-4 text-sm">
            <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <a href={`mailto:${email}`} className="text-brand underline-offset-4 hover:underline">
              {email}
            </a>
          </li>
        ) : null}

        {phone ? (
          <li className="flex items-start gap-2 rounded-md border border-border bg-card p-4 text-sm">
            <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <a
              href={`tel:${phone.replace(/[^0-9+]/g, '')}`}
              className="text-brand underline-offset-4 hover:underline"
            >
              {phone}
            </a>
          </li>
        ) : null}

        {mapUrl ? (
          <li className="flex items-start gap-2 rounded-md border border-border bg-card p-4 text-sm">
            <ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-brand underline-offset-4 hover:underline"
            >
              Abrir no mapa
            </a>
          </li>
        ) : null}
      </ul>
    </Faixa>
  );
}

/** `FAQ` — perguntas frequentes, em pares pergunta/resposta. */
function BlocoPerguntas({ content }: { content: unknown }) {
  const itens = lerLista(content, 'items')
    .map((item) => ({
      question: lerTexto(item, 'question'),
      answer: lerTexto(item, 'answer'),
    }))
    .filter(
      (item): item is { question: string; answer: string } =>
        Boolean(item.question && item.answer),
    )
    .slice(0, TENANT_MAX_FAQ_ITEMS);

  if (itens.length === 0) return null;

  return (
    <Faixa id="perguntas" title={lerTexto(content, 'title') ?? 'Perguntas frequentes'}>
      <dl className="space-y-3">
        {itens.map((item) => (
          <div key={item.question} className="rounded-md border border-border bg-card p-4">
            <dt className="font-medium text-foreground">{item.question}</dt>
            <dd className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
              {item.answer}
            </dd>
          </div>
        ))}
      </dl>
    </Faixa>
  );
}

/**
 * `CUSTOM_HTML` — exibido como TEXTO, nunca como HTML.
 *
 * O texto do organizador é HTML arbitrário e interpretá-lo seria XSS armazenado com
 * o nome dele: um atacante com acesso de organização comprometeria todos os
 * visitantes da página. O bloco mostra o conteúdo — e DIZ que não o interpreta, para
 * ninguém achar que a página está quebrada.
 */
function BlocoCodigo({ content }: { content: unknown }) {
  const html = lerTexto(content, 'html');
  if (!html) return null;

  return (
    <Faixa title={lerTexto(content, 'title') ?? TENANT_PAGE_BLOCK_LABELS.CUSTOM_HTML}>
      <p className="mb-3 text-xs text-muted-foreground">
        Este bloco é exibido como texto por segurança. HTML não é interpretado.
      </p>
      <pre className="code-data overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-surface-low p-4 text-muted-foreground">
        {html}
      </pre>
    </Faixa>
  );
}

/**
 * `TEAM` e `SPONSORS` — os dois blocos compartilhados com o editor do evento cujo
 * corpo é dado DA INSTITUIÇÃO, e que esta fatia ainda não tem de onde ler.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELES NÃO DESENHAM NADA AQUI (em vez de desenhar vazio)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A equipe da INSTITUIÇÃO (com a etiqueta de cada área, a foto e o contato que a
 *  pessoa autorizou) e os patrocinadores dela são leituras que ainda não existem: o
 *  read model da fatia 1 entrega os três grupos de eventos e o tema, e nada mais. Um
 *  bloco "Equipe" desenhado com uma lista vazia diria ao visitante que a casa não tem
 *  equipe — o que é diferente de "esta página ainda não sabe ler a equipe".
 *
 *  A árvore devolvida é `null`, e é isso que o editor da fatia 3 vai precisar declarar
 *  como "bloco sem renderizador" (`TENANT_BLOCK_WITHOUT_RENDERER`), pela mesma régua
 *  do `HERO`: oferecer um bloco que não aparece é um formulário que mente.
 */
function BlocoAindaSemLeitura(): null {
  return null;
}

/** O despachante: um tipo de bloco, um componente. */
function BlocoDaInstituicao({
  block,
  page,
}: {
  block: TenantPageBlock;
  page: PublicTenantPageView;
}) {
  switch (block.type) {
    case 'RICH_TEXT':
      return <BlocoTexto content={block.content} />;
    case 'ABOUT':
      return <BlocoSobre content={block.content} />;
    case 'PAST_EVENTS':
      return (
        <BlocoHistorico
          content={block.content}
          pastEvents={page.events.past.events}
          tenantSlug={page.identity.slug}
        />
      );
    case 'CONTACT':
      return <BlocoContato content={block.content} />;
    case 'FAQ':
      return <BlocoPerguntas content={block.content} />;
    case 'CUSTOM_HTML':
      return <BlocoCodigo content={block.content} />;

    // `HERO` é o cabeçalho da própria página (capa + identidade); `TEAM` e `SPONSORS`
    // ainda não têm de onde ler. Ver `BlocoAindaSemLeitura`.
    case 'HERO':
    case 'TEAM':
    case 'SPONSORS':
    default:
      return <BlocoAindaSemLeitura />;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  O cabeçalho da página (capa + identidade)
// ───────────────────────────────────────────────────────────────────────────────
function CabecalhoDaInstituicao({ page }: { page: PublicTenantPageView }) {
  return (
    <header className="border-b border-border bg-card" data-testid="tenant-page-header">
      {page.coverImageUrl ? (
        /**
         * A CAPA É A IMAGEM DE FUNDO, e o título fica FORA dela.
         *
         * Escrever o título sobre a foto do organizador é uma aposta: a imagem pode
         * ser clara e o texto desaparecer (a FASE 52 mediu o que acontece quando uma
         * cor é escolhida no olho). Aqui a capa é mostrada como ela é e a identidade
         * vem logo abaixo, sobre a superfície do sistema — legível nos dois modos.
         */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={page.coverImageUrl}
          alt=""
          className="h-48 w-full object-cover sm:h-64"
          data-testid="tenant-page-cover"
        />
      ) : null}

      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-start gap-5 px-6 py-8">
        {page.logoUrl ? (
          // O nome da instituição vem escrito ao lado: o logotipo é decoração e não
          // precisa de texto alternativo repetido.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={page.logoUrl}
            alt=""
            className="size-16 shrink-0 rounded-md border border-border bg-surface-low object-cover"
            data-testid="tenant-page-logo"
          />
        ) : (
          <span
            className="flex size-16 shrink-0 items-center justify-center rounded-md border border-border bg-surface-low text-muted-foreground"
            aria-hidden
          >
            <Building2 className="size-7" />
          </span>
        )}

        <div className="min-w-0 flex-1 space-y-3">
          <p className="label-caps">Instituição</p>
          <h1
            className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
            data-testid="tenant-page-title"
          >
            {page.title}
          </h1>
          {page.description ? (
            <p
              className="max-w-3xl text-pretty text-muted-foreground"
              data-testid="tenant-page-description"
            >
              {page.description}
            </p>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/**
 * O aviso da pré-visualização (fatia 3).
 *
 * Ele é um `<nav>` NOMEADO porque é uma região de navegação de verdade — "voltar ao
 * editor" é o que ele oferece. Um `<div>` solto não teria nome acessível, e o portão
 * de acessibilidade trata regiões sem nome como ruído.
 */
function AvisoDePrevia({ preview }: { preview: TenantPagePreviewInfo }) {
  return (
    <nav
      aria-label="Pré-visualização"
      className="border-b border-border bg-surface-low px-6 py-3"
      data-testid="tenant-page-preview-banner"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Eye className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <strong>Pré-visualização.</strong> Esta é a página como ela está agora —{' '}
            {preview.publicationLabel}.
          </span>
        </p>
        <Link href={preview.editorHref} className={buttonClasses({ size: 'sm' })}>
          Voltar ao editor
        </Link>
      </div>
    </nav>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  A página
// ───────────────────────────────────────────────────────────────────────────────
export function TenantPublicPage({ page, preview, landmark = 'main' }: TenantPageProps) {
  const tenantSlug = page.identity.slug;
  const blocks = page.blocks;

  /**
   * O contêiner é a ÚNICA coisa que a prop `landmark` muda — ver o comentário dela.
   * O `as` do JSX com uma união de tags nativas é aceito pelo TypeScript.
   */
  const Container = landmark === 'none' ? 'div' : 'main';

  return (
    <Container className="bg-surface" data-testid="tenant-public-page">
      {preview ? <AvisoDePrevia preview={preview} /> : null}

      <CabecalhoDaInstituicao page={page} />

      {/**
        * ─────────────────────────────────────────────────────────────────────────
        *  OS TRÊS GRUPOS — SEMPRE, E NESTA ORDEM (FASE 64)
        * ─────────────────────────────────────────────────────────────────────────
        *  "Em breve · Acontecendo agora · Edições anteriores" é a ordem da pergunta
        *  que quem chega faz ("o que vai acontecer?", "o que está acontecendo?",
        *  "o que já aconteceu?"). Um grupo sem eventos não desaparece: ele diz que
        *  está vazio — esconder a seção faria a página parecer quebrada em vez de
        *  informar.
        *
        *  O total geral não é anunciado em lugar nenhum: a tela não RECONTA (F54) e
        *  o número que o serviço devolveu já está dito nos três grupos. Um resumo
        *  "12 eventos" exigiria uma segunda contagem que poderia divergir da
        *  primeira no dia seguinte.
        */}
      <section className="space-y-10 px-6 py-10" data-testid="tenant-events">
        <div className="mx-auto w-full max-w-5xl space-y-10">
          {TENANT_PAGE_GROUP_ORDER.map(({ group, key }) => (
            <GrupoDaVitrine
              key={group}
              group={group}
              view={page.events[key]}
              tenantSlug={tenantSlug}
            />
          ))}
        </div>
      </section>

      {/** Os blocos, na ordem que o editor numerou (o domínio já filtrou e ordenou). */}
      {blocks.map((block) => (
        <BlocoDaInstituicao key={block.id} block={block} page={page} />
      ))}

      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto w-full max-w-5xl text-xs text-muted-foreground">
          <p>
            {page.identity.name} · horários em {page.events.timeZone}
          </p>
        </div>
      </footer>
    </Container>
  );
}
