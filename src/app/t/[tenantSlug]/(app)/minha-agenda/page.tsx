import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertCircle, ArrowLeft, CalendarCheck, CheckCircle2, Video } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { withTenant } from '@/lib/db/tenant-client';
import { getMyAgenda } from '@/lib/events/agenda-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { AgendaMarks } from '@/components/events/agenda-marks';
import { AgendaClashNotice } from '@/components/events/agenda-clash-notice';
import { FavoriteButton } from '@/components/events/favorite-button';
import { AgendaExportLinks, ActivityExportLinks } from '@/components/events/activity-export-links';
import { buildEventAgendaView, clashesWithAgenda } from '@/lib/events/agenda-view';
import { agendaIcsToken, agendaIcsUrl, activityIcsUrl, nextAgendaItem } from '@/lib/events/agenda-export';
import { googleCalendarUrl } from '@/lib/calendar/ics';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import { seesEventOnlineRoom } from '@/domain/events/online-room-rules';
import {
  resolveOnlineRoomViewer,
  visibleOnlineRoomsByActivity,
} from '@/lib/events/online-room-service';

export const metadata = { title: 'Minha agenda' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MINHA AGENDA (FASE 65 · fatia 2) — `/t/<slug>/minha-agenda?evento=<eventId>`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA É, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É a GRADE DO DIA da pessoa: a UNIÃO de favoritos e inscrições vivas naquele
 *  evento, com as marcas distintas (`Inscrito` × `Favorito`), os choques de horário
 *  em pares e o caminho para cada atividade. A união e os choques vêm PRONTOS da
 *  fatia 1 (`getMyAgenda` → `buildMyAgenda`) — esta tela não decide o que é agenda,
 *  ela desenha o que a regra decidiu.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É TELA DE QUEM ESTÁ LOGADO — E A AUSÊNCIA DE SESSÃO É TRATADA COMO NA IRMÃ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `/minhas-inscricoes` (a tela irmã, de onde este desenho vem) manda quem não tem
 *  sessão para o login com o destino preservado e quem não tem o contexto daquela
 *  instituição para o seletor. Aqui é igual, com o MESMO caminho de volta: não há
 *  versão pública desta tela, porque não existe agenda de ninguém.
 *
 *  A AUTORIZAÇÃO é a posse: o `userId` sai da sessão, e cada consulta sob RLS filtra
 *  por ele. É por isso que a grade de outra pessoa não aparece — não há parâmetro
 *  nenhum que peça a agenda alheia (o `?evento=` escolhe o EVENTO, nunca a pessoa).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CHOQUE APARECE EM DOIS LUGARES, E OS DOIS SÃO TEXTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. em cada item que disputa horário, dizendo COM QUEM (título + horário);
 *    2. no resumo de pares, com os DOIS títulos e os dois horários lado a lado.
 *  Nenhum dos dois bloqueia nada: a tela diz "você escolhe qual assistir" e segue
 *  oferecendo os links e o botão de desmarcar. A cor é reforço; o recado é o texto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function MyAgendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    evento?: string;
    agenda?: string;
    'agenda-erro'?: string;
  }>;
}) {
  const { tenantSlug } = await params;
  const { evento, agenda: marcada, 'agenda-erro': erroDaAcao } = await searchParams;

  const context = await getRequestContext();

  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(tenantPath(tenantSlug, '/minha-agenda'))}`,
    );
  }

  if (!context.activeTenant || context.activeTenant.tenantSlug !== tenantSlug) {
    redirect('/selecionar-instituicao');
  }

  const tenantId = context.activeTenant.tenantId;
  const tenantName = context.activeTenant.tenantName;
  const userId = context.user.id;

  /**
   * ── OS EVENTOS ONDE A PESSOA TEM AGENDA ──────────────────────────────────────
   *
   *  A lista é da PRÓPRIA participação, e não o catálogo da instituição (o mesmo
   *  princípio do "meu crachá"): a inscrição precisa ter ATIVIDADE — a inscrição no
   *  evento não tem horário nem sala e não vira item da grade — e o favorito é
   *  alcançado pela ATIVIDADE, porque a tabela de favoritos não guarda `eventId`
   *  (uma cópia poderia divergir; ver o comentário do modelo).
   *
   *  Os status de inscrição NÃO são filtrados aqui de propósito: quem decide o que é
   *  "inscrição viva" é `registrationIsLive`, dentro da regra da grade — a MESMA
   *  definição do índice único parcial do banco (armadilha 103). Uma segunda régua de
   *  "vivo" começaria a divergir da primeira no dia seguinte.
   */
  const events = await withTenant(tenantId, (tx) =>
    tx.event.findMany({
      where: {
        deletedAt: null,
        OR: [
          {
            registrations: {
              some: { userId, deletedAt: null, activityId: { not: null } },
            },
          },
          {
            activities: {
              some: { deletedAt: null, favorites: { some: { userId } } },
            },
          },
        ],
      },
      orderBy: { startsAt: 'desc' },
      take: 30,
      select: { id: true, title: true, slug: true, startsAt: true, timezone: true },
    }),
  );

  const selectedEventId =
    evento && events.some((event) => event.id === evento) ? evento : (events[0]?.id ?? null);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;

  const myAgenda = selectedEventId
    ? await getMyAgenda({ tenantId, userId, eventId: selectedEventId })
    : null;

  /**
   * ── O DOWNLOAD DA GRADE INTEIRA (FASE 65 · fatia 3) ───────────────────────────
   *
   *  O token é derivado do `userId` da SESSÃO e do `tenantId` — nunca recebido de
   *  parâmetro. Sem segredo utilizável no servidor ele é `null`, e aí a tela diz que o
   *  download está indisponível em vez de oferecer um endereço que não abre.
   */
  const calendarToken = agendaIcsToken({ tenantId, userId });

  const agenda = buildEventAgendaView({
    authenticated: true,
    agenda: myAgenda,
    exportHref:
      calendarToken && selectedEventId
        ? agendaIcsUrl({ tenantSlug, token: calendarToken, eventId: selectedEventId })
        : null,
  });

  const itemById = new Map(agenda.items.map((item) => [item.activityId, item]));

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A SALA ONLINE — A RÉGUA E O SERVIÇO DA FASE 68, SEM SEGUNDA CÓPIA (FASE 69)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O endereço da sala existia na página do evento e na página da atividade, e faltava
   *  aqui — na tela que a pessoa abre pouco antes da sessão. A correção NÃO é um `if`
   *  novo: `resolveOnlineRoomViewer` lê os fatos no BANCO (inscrição viva que não seja
   *  lista de espera, a inscrição na atividade ou a equipe do evento) e
   *  `visibleOnlineRoomsByActivity` aplica a MESMA projeção da página pública.
   *
   *  O que NÃO se faz aqui, e é o ponto: não há `hidden`, não há CSS e não há condição
   *  no JSX decidindo se o endereço aparece. Ele chega pelo mapa apenas para quem tem
   *  lugar — para os demais o valor não existe, e o `page.content()` do E2E prova isso.
   *
   *  Uma leitura a mais no banco (a mesma que a página pública faz) é o preço de a
   *  pergunta "quem vê a sala?" ter UMA resposta no produto. A alternativa — deduzir a
   *  visibilidade aqui a partir da marca `Inscrito` — erraria os dois casos de verdade:
   *  a LISTA DE ESPERA, que tem marca de inscrição e não tem lugar, e a EQUIPE, que não
   *  tem inscrição nenhuma e monta a sala.
   */
  const onlineRoomViewer = selectedEventId
    ? await resolveOnlineRoomViewer({ tenantId, eventId: selectedEventId, userId })
    : null;

  const salasPorAtividade = onlineRoomViewer
    ? visibleOnlineRoomsByActivity(onlineRoomViewer, myAgenda?.onlineRooms ?? [])
    : new Map<string, string>();

  const salaDoEvento =
    onlineRoomViewer && seesEventOnlineRoom(onlineRoomViewer)
      ? (myAgenda?.eventOnlineUrl ?? null)
      : null;

  /**
   * O item do botão do Google: o primeiro que ainda não terminou.
   *
   * A régua é a mesma do "acontecendo agora" (`endsAt > agora`), e ela é decidida no
   * servidor com o MESMO instante da renderização — um `Date.now()` aqui dentro faria
   * duas partes da mesma tela discordarem sobre "agora".
   */
  const agora = new Date();
  const proximo = nextAgendaItem(agenda.items, agora);

  /** O evento da grade — o link de cada item precisa do slug dele. */
  const eventSlug = myAgenda?.eventSlug ?? selectedEvent?.slug ?? '';

  return (
    <main className="max-w-4xl space-y-8">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/minhas-inscricoes')}
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          >
            <ArrowLeft className="size-3" aria-hidden />
            Minhas inscrições
          </Link>
        </nav>

        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CalendarCheck className="size-6 text-primary" aria-hidden />
          Minha agenda
        </h1>
        <p className="text-sm text-muted-foreground">
          O que você marcou como favorito e o que você já garantiu em {tenantName}. Marcar
          não reserva vaga — quem garante lugar é a inscrição.
        </p>
      </header>

      {/**
        * A FALHA DO ÚLTIMO CLIQUE, quando houve. `role="alert"` porque é uma
        * interrupção: a pessoa acabou de marcar algo e o serviço recusou.
        */}
      {erroDaAcao ? (
        <p
          role="alert"
          data-testid="agenda-erro"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm text-warning-strong"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Não foi possível atualizar a sua agenda: {erroDaAcao}
        </p>
      ) : null}

      {events.length === 0 ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Você ainda não marcou nada na sua agenda nesta instituição. Na programação de um
            evento, cada atividade tem o botão <strong>“Adicionar à minha agenda”</strong> —
            ele guarda o horário para você não perder de vista. As atividades em que você se
            inscreveu aparecem aqui também, com a marca própria.
          </p>
          <Link
            href={tenantPath(tenantSlug, '/eventos')}
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Ver eventos disponíveis
          </Link>
        </div>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs font-medium">
              Evento
              <select
                name="evento"
                defaultValue={selectedEventId ?? ''}
                aria-label="Evento"
                data-testid="minha-agenda-evento"
                className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title} ·{' '}
                    {/**
                      * A DATA DE ABERTURA no fuso do EVENTO — a MESMA correção do cartão
                      * da programação (item C da fatia). `toLocaleDateString('pt-BR')`
                      * sem `timeZone` formata no fuso do PROCESSO, e o container roda em
                      * UTC: um evento que abre às 21:00 em Salvador apareceria aqui como
                      * o dia SEGUINTE.
                      */}
                    {formatZonedDateTime(event.startsAt, event.timezone)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
            >
              Ver
            </button>
          </form>

          {/**
            * ── A SALA ONLINE DO EVENTO (FASE 69) ─────────────────────────────────
            *
            *  Fica ANTES da grade e vale para o dia inteiro (é a transmissão do
            *  evento): quem procura o link às pressas não deveria ter de caçar o item
            *  certo da lista. `salaDoEvento` só existe para quem tem lugar — a decisão
            *  está tomada acima, no servidor, e não há condição de CSS aqui.
            */}
          {salaDoEvento ? (
            <p className="text-sm">
              <a
                href={salaDoEvento}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="minha-agenda-sala-online-evento"
                className="inline-flex items-center gap-2 underline underline-offset-4"
              >
                <Video className="size-4 shrink-0" aria-hidden />
                Acessar a transmissão online do evento
              </a>
            </p>
          ) : null}

          {agenda.items.length === 0 ? (
            /**
             * O EVENTO EXISTE NA LISTA, MAS A GRADE SAIU VAZIA — o caso real é a
             * inscrição que foi cancelada depois de aparecer aqui (a régua de
             * "inscrição viva" a exclui). A tela explica como voltar a marcar em vez de
             * mostrar uma lista vazia sem motivo.
             */
            <div className="space-y-4 rounded-lg border border-border bg-card p-6">
              <p className="text-sm text-muted-foreground">
                Nada na sua agenda deste evento agora. Abra a programação e use{' '}
                <strong>“Adicionar à minha agenda”</strong> nas atividades que você não quer
                perder de vista.
              </p>
              {selectedEvent ? (
                <Link
                  href={tenantPath(tenantSlug, `/eventos/${selectedEvent.slug}`)}
                  className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                >
                  Ver a programação do evento
                </Link>
              ) : null}
            </div>
          ) : (
            <>
              {/* ── O RESUMO ───────────────────────────────────────────────── */}
              <dl
                className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-border bg-card p-4 text-sm"
                data-testid="minha-agenda-resumo"
              >
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">Na agenda</dt>
                  <dd className="font-medium" data-testid="resumo-itens">
                    {myAgenda?.counts.entries ?? 0}
                  </dd>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">Inscritas</dt>
                  <dd className="font-medium" data-testid="resumo-inscritas">
                    {myAgenda?.counts.registered ?? 0}
                  </dd>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">Favoritas</dt>
                  <dd className="font-medium" data-testid="resumo-favoritas">
                    {myAgenda?.counts.favorited ?? 0}
                  </dd>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">Choques de horário</dt>
                  <dd className="font-medium" data-testid="resumo-choques">
                    {myAgenda?.counts.clashPairs ?? 0}
                  </dd>
                </div>
              </dl>

              {/**
                * ── A GRADE INTEIRA NO CALENDÁRIO (FASE 65 · fatia 3) ────────────────
                *
                *  São DOIS caminhos, e a diferença entre eles é a informação que a
                *  tela precisa dar: o ARQUIVO leva a grade completa (é o que o Google
                *  Calendar importa em massa e o que o Apple/Outlook leem sozinhos), e o
                *  botão do GOOGLE cria UM compromisso — por isso ele oferece o PRÓXIMO
                *  item, e não "a grade". Prometer a grade inteira num botão que cria um
                *  evento seria uma mentira que só apareceria no dia do evento.
                */}
              <AgendaExportLinks
                eventTitle={myAgenda?.eventTitle ?? selectedEvent?.title ?? 'o evento'}
                icsHref={agenda.exportHref}
                nextTitle={proximo?.title ?? null}
                nextGoogleHref={
                  proximo
                    ? googleCalendarUrl({
                        activityId: proximo.activityId,
                        title: proximo.title,
                        startsAt: proximo.startsAt,
                        endsAt: proximo.endsAt,
                        timezone: myAgenda?.timezone ?? 'UTC',
                        location: proximo.roomName,
                        description: null,
                      })
                    : null
                }
              />

              {/* ── A GRADE ─────────────────────────────────────────────────── */}
              <section className="space-y-3" aria-labelledby="minha-grade">
                <h2 id="minha-grade" className="text-lg font-semibold tracking-tight">
                  A sua grade
                </h2>

                <ul className="space-y-3" data-testid="minha-agenda">
                  {agenda.items.map((item) => {
                    const choques = clashesWithAgenda(item, agenda.items);

                    /**
                     * A SALA ONLINE DESTA SESSÃO (FASE 69) — o mapa só tem o endereço
                     * de quem tem lugar nela (a decisão é do servidor, acima). Item sem
                     * sala, ou pessoa sem lugar, não desenham nada.
                     */
                    const salaDaAtividade = salasPorAtividade.get(item.activityId) ?? null;

                    return (
                      <li
                        key={item.activityId}
                        id={`atividade-${item.activityId}`}
                        data-testid={`agenda-item-${item.activityId}`}
                        data-mark={item.mark}
                        className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4"
                      >
                        <div className="min-w-0 space-y-2">
                          <AgendaMarks
                            registered={item.registered}
                            favorited={item.favorited}
                            variant="painel"
                            testId={`marcas-${item.activityId}`}
                          />

                          <h3 className="font-medium">{item.title}</h3>

                          <p className="text-xs text-muted-foreground">
                            {item.startsAtLabel} – {item.endsAtLabel}
                            {item.roomName ? ` · ${item.roomName}` : ''}
                          </p>

                          {/**
                            * A SALA ONLINE DA ATIVIDADE (FASE 69). O rótulo diz que a
                            * sala é DESTA sessão, porque a do evento (a transmissão do
                            * dia) já está no topo da tela — duas linhas iguais para
                            * endereços diferentes seriam a confusão seguinte.
                            */}
                          {salaDaAtividade ? (
                            <p className="text-xs">
                              <a
                                href={salaDaAtividade}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-testid={`minha-agenda-sala-online-${item.activityId}`}
                                className="inline-flex items-center gap-1.5 underline underline-offset-4"
                              >
                                <Video className="size-3.5 shrink-0" aria-hidden />
                                Entrar na sala online desta atividade
                              </a>
                            </p>
                          ) : null}

                          {/**
                            * A LISTA DE ESPERA continua sendo uma inscrição VIVA (a vaga
                            * pode chegar) — e a marca `INSCRITO` sozinha não diria isso.
                            * O rótulo vem da fatia 1 (`registrationStatus`), em vez de
                            * uma quarta marca inventada aqui.
                            */}
                          {item.registrationStatus === 'WAITLISTED' ? (
                            <p className="text-xs text-muted-foreground">
                              Na lista de espera — a vaga pode ser liberada.
                            </p>
                          ) : null}

                          {item.status === 'CANCELED' ? (
                            <p className="text-xs font-medium text-destructive">
                              Atividade cancelada pela organização.
                            </p>
                          ) : null}

                          {choques.length > 0 ? (
                            <AgendaClashNotice
                              targets={choques}
                              variant="painel"
                              testId={`choque-${item.activityId}`}
                              hint="Você escolhe qual assistir — a agenda não bloqueia nada."
                            />
                          ) : null}

                          {marcada === item.activityId ? (
                            <p
                              className="flex items-center gap-1.5 text-xs font-medium text-success-strong"
                              data-testid={`agenda-confirmacao-${item.activityId}`}
                            >
                              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                              {item.favorited
                                ? 'Adicionada à sua agenda.'
                                : 'Removida da sua agenda.'}
                            </p>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <Link
                            href={tenantPath(
                              tenantSlug,
                              `/eventos/${eventSlug}/atividades/${item.slug}`,
                            )}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
                          >
                            Ver atividade
                          </Link>

                          {/**
                            * ── O MESMO CAMINHO DE 1 CLIQUE (FASE 65 · fatia 3) ──────
                            *
                            *  Quem montou a grade quer levá-la para o calendário do
                            *  celular — e faz isso ITEM A ITEM, que é como o Google
                            *  aceita (um compromisso por URL). O arquivo com a grade
                            *  inteira está no topo da tela.
                            */}
                          <ActivityExportLinks
                            activityId={item.activityId}
                            title={item.title}
                            startsAt={item.startsAt}
                            endsAt={item.endsAt}
                            timezone={myAgenda?.timezone ?? 'UTC'}
                            location={item.roomName}
                            description={null}
                            icsHref={activityIcsUrl({
                              tenantSlug,
                              activityId: item.activityId,
                            })}
                          />

                          {selectedEvent ? (
                            <FavoriteButton
                              tenantSlug={tenantSlug}
                              eventId={selectedEvent.id}
                              eventSlug={selectedEvent.slug}
                              activityId={item.activityId}
                              activityTitle={item.title}
                              favorited={item.favorited}
                              origem="MINHA_AGENDA"
                              variant="painel"
                            />
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* ── OS CHOQUES, EM PARES ─────────────────────────────────────── */}
              {myAgenda && myAgenda.clashes.length > 0 ? (
                <section
                  className="space-y-3"
                  aria-labelledby="meus-choques"
                  data-testid="minha-agenda-choques-secao"
                >
                  <h2 id="meus-choques" className="text-lg font-semibold tracking-tight">
                    Choques de horário
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Estes pares disputam o mesmo tempo. A escolha é sua — o sistema só avisa.
                  </p>

                  <ul className="space-y-2" data-testid="minha-agenda-choques">
                    {myAgenda.clashes.map((clash) => {
                      const first = itemById.get(clash.firstActivityId);
                      const second = itemById.get(clash.secondActivityId);

                      return (
                        <li
                          key={`${clash.firstActivityId}-${clash.secondActivityId}`}
                          data-testid={`choque-${clash.firstActivityId}-${clash.secondActivityId}`}
                          className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning-strong"
                        >
                          <p className="font-medium">{clash.firstTitle}</p>
                          <p className="text-xs">
                            {first ? `${first.startsAtLabel} – ${first.endsAtLabel}` : ''}
                          </p>
                          <p className="font-medium">{clash.secondTitle}</p>
                          <p className="text-xs">
                            {second ? `${second.startsAtLabel} – ${second.endsAtLabel}` : ''}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </>
      )}
    </main>
  );
}
