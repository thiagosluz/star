import Link from 'next/link';
import { ArrowRight, CalendarClock, IdCard, MapPin, Mic, ScanLine, Video } from 'lucide-react';

import { tenantPath } from '@/domain/tenancy/resolution';
import type { HappeningNowView, NowItem } from '@/domain/agenda/now-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  "ACONTECENDO AGORA" — a aba e a faixa (FASE 65 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O SERVIDOR DECIDE, A TELA DESENHA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem está em curso já chega decidido (`buildHappeningNow`, no domínio, com o
 *  instante e o FUSO DO EVENTO resolvidos pela página). Não há `useEffect`, não há
 *  "agora" calculado no navegador e não há estado de cliente: com o JavaScript
 *  desligado, a aba mostra exatamente a mesma coisa — e o E2E mede assim.
 *
 *  Um tique de cliente para animar a barra seria enfeite e é opcional; a informação
 *  (o tempo restante em TEXTO) não depende dele.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A BARRA DE PROGRESSO É ACESSÍVEL DE VERDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela NÃO é decoração: carrega `role="progressbar"` com `aria-valuemin`,
 *  `aria-valuemax` e `aria-valuenow` (o quanto já decorreu) e um `aria-label` que
 *  NOMEIA a atividade — sem ele, um leitor de tela anuncia "caixa de progresso, 40%"
 *  sem dizer de quê. O `aria-valuetext` diz o que a pessoa quer saber ("termina em
 *  1 h 20 min"), porque porcentagem não é tempo.
 *
 *  As CORES são escolhidas para o contraste: no claro, a barra é `success-strong`
 *  sobre o trilho `surface-high` (**4,49:1**); no escuro, `success-strong` sobre o
 *  trilho escuro (**9,12:1**). Os dois passam o mínimo de 3:1 para componente de
 *  interface, e o texto do tempo restante usa a cor do PRÓPRIO tema do evento
 *  (`currentColor`), que é o único par honesto sobre o cartão do organizador — ver o
 *  comentário do parágrafo, com a medição que a catraca fez. `tests/unit/f65-acontecendo-agora.test.ts`
 *  prende os dois números da barra e a decisão do texto.
 *
 *  Mesmo assim, a cor é REFORÇO: o tempo restante é texto, e quem não vê a barra lê a
 *  frase.
 */

/** A barra de progresso do tempo — acessível, com o restante em texto. */
function TimeProgressBar({ item }: { item: NowItem }) {
  return (
    <div className="space-y-1">
      <div
        role="progressbar"
        aria-label={`Tempo restante da atividade ${item.title}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={item.progressPercent}
        /**
         * O texto do valor tem de ser o TEMPO, não a porcentagem: "termina em 1 h
         * 20 min" é a informação; "40%" não é.
         */
        aria-valuetext={item.remainingLabel}
        data-testid="agora-barra"
        data-progresso={item.progressPercent}
        className="h-2 w-full overflow-hidden rounded-full"
        /**
         * O TRILHO é `--surface-high`, o degrau de "interação" da escala de camadas: ele
         * existe nos dois modos com o mesmo nome, e a barra sobre ele mede **4,49:1** no
         * claro e **9,12:1** no escuro (o mínimo de componente é 3:1).
         */
        style={{ backgroundColor: 'var(--surface-high)' }}
      >
        <div
          aria-hidden
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${item.progressPercent}%`,
            backgroundColor: 'var(--success-strong)',
          }}
        />
      </div>

      {/**
        O TEMPO RESTANTE EM TEXTO — a informação existe sem a barra. É este parágrafo
        que o E2E confere, e é ele que continua certo sem JavaScript.

        ─────────────────────────────────────────────────────────────────────────
         A COR DO TEXTO É A DO TEMA, E ISSO FOI MEDIDO PELA CATRACA (FASE 65 · fatia 5)
        ─────────────────────────────────────────────────────────────────────────
         Aqui havia `text-success-strong` — o token de sucesso da PLATAFORMA. Ele
         funciona sobre as superfícies da plataforma, mas este cartão é `.ef-card`,
         cujo fundo é `color-mix(in oklab, var(--ef-background) 92%, var(--ef-text) 8%)`
         — ou seja, a superfície que o ORGANIZADOR escolheu. No tema padrão claro o
         par rendia **4,36:1** (`#047857` sobre `#e4e5eb`), abaixo dos 4,5:1 do AA:
         é a MESMA armadilha que o aviso de choque já documenta (publicar um tom da
         plataforma sobre o fundo do organizador). Quem reprovou foi o portão de
         acessibilidade, e a correção é a mesma de lá: dentro do tema, a cor vem do
         PRÓPRIO tema (`currentColor`, herdado de `.ef-theme`).

         O semáforo de "está em curso" não se perde: ele é o PREENCHIMENTO da barra
         (que continua verde e passa o mínimo de componente) e, principalmente, o
         TEXTO — "termina em 1 h 20 min" não depende de cor nenhuma.
      */}
      <p className="text-xs font-medium" data-testid="agora-restante">
        {item.remainingLabel}
      </p>
    </div>
  );
}

/** Um item em curso, com o caminho de cada papel. */
function NowCard({
  item,
  tenantSlug,
  eventSlug,
  eventId,
  showBadgeLink,
  showCounterLink,
  onlineUrl,
}: {
  item: NowItem;
  tenantSlug: string;
  eventSlug: string;
  eventId: string;
  showBadgeLink: boolean;
  showCounterLink: boolean;
  /**
   * O endereço da sala desta atividade, quando a pessoa tem lugar nela (FASE 68).
   *
   * Ele NÃO vem de `item`: `HappeningNowView` é serializável e vai para o cliente, e
   * o endereço não pode viajar nela (plano da fase, §4). Vem deste parâmetro, que é
   * um `ReadonlyMap` montado no servidor — e `Map` é a escolha, não um detalhe: o
   * React RECUSA serializar um `Map` se algum dia este componente virar Client
   * Component, então o erro seria alto em vez de um vazamento silencioso.
   */
  onlineUrl?: string;
}) {
  /**
   * O cartão vive SEMPRE dentro do tema do evento (`ThemeScope`), e é por isso que ele
   * usa as classes `ef-*`: não há um segundo vocabulário a servir — a aba é da página
   * pública, e a pré-visualização do rascunho também passa pelo mesmo tema.
   */
  const cardClass = 'ef-card space-y-3 p-4';
  const linkClass =
    'inline-flex items-center gap-1.5 rounded-md border border-current px-3 py-1.5 text-xs font-medium transition hover:opacity-80';

  return (
    <li className={cardClass} data-testid={`agora-item-${item.activityId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold" data-testid={`agora-titulo-${item.activityId}`}>
          <Link
            href={tenantPath(
              tenantSlug,
              `/eventos/${eventSlug}/atividades/${item.slug}`,
            )}
            className="underline-offset-4 hover:underline"
          >
            {item.title}
          </Link>
        </h3>
        <span className="ef-badge">Em curso</span>
      </div>

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs opacity-80">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden />
          <dd data-testid={`agora-horario-${item.activityId}`}>
            {item.startsAtLabel} – {item.endsAtLabel}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <dd>{item.roomName}</dd>
        </div>
        {item.speakerNames.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <Mic className="size-3.5 shrink-0" aria-hidden />
            <dd>{item.speakerNames.join(', ')}</dd>
          </div>
        ) : null}
      </dl>

      <TimeProgressBar item={item} />

      {/**
        ── A SALA ONLINE DA ATIVIDADE EM CURSO (FASE 68) ─────────────────────────
        Quem está no evento e assiste de longe precisa do endereço AGORA, e não na
        programação. Ele é desenhado AQUI, no servidor, e só chega para quem tem lugar
        na sala: a página resolve a visibilidade ANTES de montar este mapa
        (`applyOnlineRoomVisibility`), e o endereço não existe no HTML dos demais.
      */}
      {onlineUrl ? (
        <a
          href={onlineUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          data-testid={`agora-sala-online-${item.activityId}`}
        >
          <Video className="size-3.5 shrink-0" aria-hidden />
          Entrar na sala online
        </a>
      ) : null}

      {/**
        ── O CAMINHO DE CADA PAPEL ──────────────────────────────────────────────
        Quem está no evento costuma precisar de UMA das duas coisas: o próprio crachá
        (para entrar na sala) ou o balcão (para registrar a presença de quem chegou).
        Os dois links só existem quando fazem sentido:
          • o CRACHÁ exige SESSÃO — `/meu-cracha` é tela de quem tem inscrição, e manda
            o anônimo para o login (a régua da tela irmã, `/minha-agenda`);
          • o BALCÃO exige PERMISSÃO (`registration:checkin`, no servidor) — quem só
            participa não opera a portaria.
      */}
      {showBadgeLink || showCounterLink ? (
        <div className="flex flex-wrap items-center gap-2">
          {showBadgeLink ? (
            <Link
              href={`${tenantPath(tenantSlug, '/meu-cracha')}?evento=${eventId}`}
              className={linkClass}
              data-testid={`agora-cracha-${item.activityId}`}
            >
              <IdCard className="size-3.5 shrink-0" aria-hidden />
              Abrir o meu crachá
            </Link>
          ) : null}

          {showCounterLink ? (
            <Link
              href={`${tenantPath(tenantSlug, '/credenciamento')}?evento=${eventId}`}
              className={linkClass}
              data-testid={`agora-balcao-${item.activityId}`}
            >
              <ScanLine className="size-3.5 shrink-0" aria-hidden />
              Abrir o balcão de credenciamento
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * A aba "Acontecendo agora": o que está em curso AGORA, agrupado por sala.
 *
 * Uma sala sem nada em curso NÃO aparece — a pergunta é "o que está acontecendo", e
 * uma lista de salas vazias seria a resposta errada com boa aparência.
 */
export function HappeningNowSection({
  view,
  tenantSlug,
  eventSlug,
  eventId,
  authenticated,
  canOperateCounter,
  onlineRooms = new Map(),
}: {
  view: HappeningNowView;
  tenantSlug: string;
  eventSlug: string;
  eventId: string;
  /** Sessão ativa — só ela pode abrir o próprio crachá. */
  authenticated: boolean;
  /** `registration:checkin` conferida NO SERVIDOR (ver a página do evento). */
  canOperateCounter: boolean;
  /**
   * Endereço da sala online por atividade (FASE 68), já filtrado pela visibilidade no
   * servidor. `ReadonlyMap` de propósito: se este componente virar Client Component,
   * o React RECUSA serializar em vez de mandar o endereço ao navegador em silêncio.
   */
  onlineRooms?: ReadonlyMap<string, string>;
}) {
  if (view.isEmpty) {
    return (
      <section
        className="space-y-2 rounded-lg border border-border bg-card p-6"
        data-testid="agora-vazio"
        aria-labelledby="agora-titulo"
      >
        <h2 id="agora-titulo" className="text-lg font-semibold tracking-tight">
          Acontecendo agora
        </h2>
        <p className="text-sm text-muted-foreground">
          Nenhuma atividade em curso neste momento. A programação mostra o que vem a seguir.
        </p>
        <Link
          href="#programacao"
          className="inline-block text-sm underline underline-offset-4"
        >
          Ver a programação completa
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="agora-titulo" data-testid="agora">
      <div className="space-y-1">
        <h2 id="agora-titulo" className="text-lg font-semibold tracking-tight">
          Acontecendo agora
        </h2>
        <p className="text-sm text-muted-foreground" data-testid="agora-legenda">
          {view.totalItems === 1
            ? '1 atividade em curso neste momento'
            : `${view.totalItems} atividades em curso neste momento`}{' '}
          · horários em {view.timezone}
        </p>
      </div>

      <div className="space-y-5">
        {view.rooms.map((room) => (
          <div key={room.roomKey ?? 'sem-sala'} data-testid={`agora-sala-${room.roomKey ?? 'sem-sala'}`}>
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider opacity-70">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              {room.roomName}
            </h3>

            <ul className="mt-2 space-y-3">
              {room.items.map((item) => (
                <NowCard
                  key={item.activityId}
                  item={item}
                  tenantSlug={tenantSlug}
                  eventSlug={eventSlug}
                  eventId={eventId}
                  showBadgeLink={authenticated}
                  showCounterLink={canOperateCounter}
                  onlineUrl={onlineRooms.get(item.activityId)}
                />
              ))}
            </ul>

            {/**
              O QUE VEM DEPOIS NA MESMA SALA — é isto que diz à pessoa onde ela deve
              estar no minuto seguinte, e o motivo de a visão ser por SALA (e não por
              ordem da grade).
            */}
            {room.nextLabel && room.nextStartsAtLabel ? (
              <p
                className="mt-2 flex flex-wrap items-center gap-1.5 text-xs opacity-80"
                data-testid={`agora-proxima-${room.roomKey ?? 'sem-sala'}`}
              >
                <ArrowRight className="size-3.5 shrink-0" aria-hidden />
                A seguir nesta sala: <strong>{room.nextLabel}</strong> às{' '}
                {room.nextStartsAtLabel}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A duração oficial da atividade, para a faixa não repetir a régua de formatação. */

/**
 * A FAIXA do topo da programação: anuncia o que está em curso e leva para a aba.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  SEM NADA EM CURSO, A FAIXA NÃO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A programação não ganha um bloco dizendo "nenhuma atividade em curso": isso
 *  ocuparia o lugar mais nobre da tela com uma negativa, e a negativa já é visível na
 *  própria grade. O componente devolve `null`, e o E2E prende isso.
 */
export function HappeningNowBanner({
  view,
  tenantSlug,
  eventSlug,
}: {
  view: HappeningNowView;
  tenantSlug: string;
  eventSlug: string;
}) {
  if (view.isEmpty) return null;

  const primeiro = view.rooms[0]?.items[0];

  return (
    <p
      className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-current px-3 py-2 text-xs"
      data-testid="agora-faixa"
      style={{
        borderColor: 'color-mix(in oklab, currentColor 45%, transparent)',
        backgroundColor: 'color-mix(in oklab, currentColor 6%, transparent)',
      }}
    >
      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
      <span>
        <strong>Acontecendo agora:</strong>{' '}
        {view.totalItems === 1
          ? `1 atividade em curso${primeiro ? ` — ${primeiro.title}` : ''}`
          : `${view.totalItems} atividades em curso em ${view.rooms.length} ${
              view.rooms.length === 1 ? 'sala' : 'salas'
            }`}
        .
      </span>
      <Link
        href={`${tenantPath(tenantSlug, `/eventos/${eventSlug}`)}?aba=agora`}
        className="underline underline-offset-4"
        data-testid="agora-faixa-link"
      >
        Ver o que está acontecendo agora
      </Link>
    </p>
  );
}
