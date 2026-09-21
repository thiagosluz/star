'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Maximize2, Radio, ShieldCheck, Sparkles, Trophy } from 'lucide-react';

import { ConfettiBurst } from '@/components/raffles/confetti-burst';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O TELÃO DO SORTEIO (FASE 29 · RODADAS E ROLETA NA FASE 30)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O resultado publicado (FASE 22) é uma página de CONSULTA: ela existe depois da
 *  apuração e serve para compartilhar. O telão é o contrário — ele existe ANTES,
 *  fica aberto na parede durante o credenciamento e tem de mostrar, sem ninguém
 *  tocar em nada:
 *
 *    1. a RODADA ANUNCIADA (prêmio e patrocinador) e a contagem subindo ao vivo;
 *    2. o COMPROMISSO da semente daquela rodada, publicado antes dela;
 *    3. a APURAÇÃO acontecendo na tela — a roleta passa os nomes de quem concorria
 *       e para em quem ganhou, com confete;
 *    4. o que já foi sorteado nos momentos anteriores.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ROLETA É APRESENTAÇÃO, NÃO SORTEIO — E ISSO É DITO AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O resultado é apurado e ASSINADO no servidor quando alguém clica em "Sortear a
 *  rodada". A roleta que o público vê começa DEPOIS disso: ela passa os nomes da
 *  lista publicada daquela rodada (gente que concorreu de verdade, com o nome
 *  mascarado pela mesma regra de sempre) e para no primeiro ganhador.
 *
 *  Inventar nomes seria mais fácil e desonesto — daria a impressão de um sorteio
 *  sobre gente que não estava no páreo. Fazer a tela "sortear" antes do servidor
 *  seria pior: o que está na parede deixaria de ser o que o banco assinou. O que a
 *  animação entrega é o SUSPENSE do anúncio; a decisão já está gravada e auditável,
 *  e a prova (compromisso, semente e hashes) está no rodapé e na auditoria.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO A TELA SABE QUE A RODADA ACONTECEU
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Pelo fluxo SSE da rota pública do palco, que traz a contagem E a rodada em
 *  cartaz. Quando a rodada apurada muda (a 2ª depois da 1ª, por exemplo), o
 *  componente pede a página de novo (`router.refresh()`) e roda a roleta: os nomes e
 *  os ganhadores vêm pela página (uma fonte só), e o cliente guarda apenas "já
 *  revelei esta rodada".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA **NÃO** FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não relaxa a privacidade: o nome vem pronto do servidor, mascarado pela mesma
 *  regra dos outros lugares (`publicWinnerName`). Uma tela que o evento inteiro vê
 *  não é lugar de decidir consentimento — e é por isso que ela não recebe o nome
 *  cru para decidir por conta própria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface StageWinner {
  position: number;
  name: string;
  masked: boolean;
}

/** Uma rodada como o telão a exibe (FASE 30). */
export interface StageRoundModel {
  roundNumber: number;
  prizeTitle: string | null;
  prizeDescription: string | null;
  sponsorName: string | null;
  drawnAtIso: string | null;
  seedCommitment: string | null;
  seedRevealed: string | null;
  resultHash: string | null;
  winnersCount: number;
  alternatesCount: number;
  /**
   * Nomes (mascarados) da lista publicada DESTA rodada — é o que a roleta passa.
   * Vazio quando a rodada ainda não foi apurada: sem lista publicada não há nomes
   * reais para mostrar, e a tela não inventa.
   */
  rollNames: string[];
  winners: StageWinner[];
  alternates: StageWinner[];
}

export interface StageModel {
  raffleId: string;
  title: string;
  description: string | null;
  state: 'AGUARDANDO' | 'REVELADO' | 'CANCELADO';
  /** A rodada em cartaz: a preparada (o anúncio) ou, sem pendente, a última apurada. */
  currentRound: StageRoundModel | null;
  /** Rodadas anteriores, já apuradas: ficam na parede como histórico do momento. */
  previousRounds: StageRoundModel[];
  minAttendanceMinutes: number;
  eligibleCount: number;
  auditHref: string;
}

type Transport = 'sse' | 'polling';
type Phase = 'AGUARDANDO' | 'SORTEANDO' | 'REVELADO' | 'CANCELADO';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;

  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function roundSubtitle(round: StageRoundModel | null): string | null {
  if (!round) return null;

  const parts = [`Rodada ${round.roundNumber}`];
  if (round.prizeTitle) parts.push(round.prizeTitle);

  return parts.join(' — ');
}

export function RaffleStage({ model, liveUrl }: { model: StageModel; liveUrl: string }) {
  const router = useRouter();

  const [eligibleCount, setEligibleCount] = useState(model.eligibleCount);
  const [transport, setTransport] = useState<Transport>('polling');
  const [failed, setFailed] = useState(false);

  /**
   * `phase` começa no que o servidor mandou: quem abre o link DEPOIS da festa vê o
   * resultado direto, sem roleta. A roleta é do anúncio ao vivo — quem chega tarde
   * não precisa esperar o suspense de um sorteio que já aconteceu.
   */
  const [phase, setPhase] = useState<Phase>(model.state);
  const [rolling, setRolling] = useState(false);
  const [rollName, setRollName] = useState<string | null>(null);

  /**
   * O mesmo "está rolando" em um REF.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE O FLUXO LÊ O REF, E NÃO O ESTADO (defeito real da FASE 30)
   *  ─────────────────────────────────────────────────────────────────────────────
   *  A primeira versão colocou `rolling` nas dependências do efeito do SSE. Só que
   *  `setRolling(true)` re-renderiza, o efeito é REEXECUTADO e o `cleanup` cancela o
   *  `setTimeout(router.refresh, 250)` que acabou de ser agendado — a página nunca
   *  era relida com o resultado novo, e a roleta revelava a rodada 2 com os dados
   *  ANTIGOS (zero ganhadores), enquanto o banco já tinha a posição 2 gravada. O E2E
   *  pegou exatamente isso ("o telão anuncia a rodada, rola a roleta e se revela"
   *  falhando em `stage-winner-2`).
   *
   *  Com o ref, o efeito tem dependências ESTÁVEIS (a conexão não é reaberta a cada
   *  mudança de fase) e o refresh agendado sobrevive.
   */
  const rollingRef = useRef(false);

  /**
   * A rodada que ESTE cliente já viu apurada. É o que transforma "o servidor diz que
   * está apurado" em "acabou de ser apurado aqui": sem isso, toda vez que o fluxo
   * reenviasse o mesmo estado a roleta recomeçaria.
   */
  const seenRoundId = useRef<string | null>(
    model.state === 'REVELADO' && model.currentRound ? `drawn-${model.currentRound.roundNumber}` : null,
  );

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let controller: AbortController | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A RODADA EM CARTAZ MUDA A TELA (FASE 30)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Duas transições importam, e as duas vêm da RODADA, não do status do sorteio:
     *
     *    • apareceu uma rodada PREPARADA nova → a parede anuncia o próximo prêmio e
     *      volta para "aguardando" (a roleta da anterior já terminou);
     *    • a rodada apurada MUDOU → roda a roleta e revela.
     *
     *  Ler só o status do sorteio não bastaria: depois da primeira apuração ele fica
     *  `DRAWN` para sempre, e a rodada 2 seria apurada sem a parede perceber.
     */
    const apply = (payload: {
      eligibleCount?: number | null;
      raffle?: {
        status?: string;
        pendingRound?: { roundNumber: number } | null;
        lastDrawnRound?: { roundId: string; roundNumber: number } | null;
      } | null;
    }) => {
      if (typeof payload.eligibleCount === 'number') setEligibleCount(payload.eligibleCount);

      const raffle = payload.raffle;
      if (!raffle?.status) return;

      if (raffle.status === 'CANCELED') {
        setPhase('CANCELADO');
        return;
      }

      const drawn = raffle.lastDrawnRound ?? null;

      if (drawn && seenRoundId.current !== `drawn-${drawn.roundNumber}`) {
        seenRoundId.current = `drawn-${drawn.roundNumber}`;
        setPhase('SORTEANDO');
        rollingRef.current = true;
        setRolling(true);

        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => router.refresh(), 250);
        return;
      }

      /**
       * Rodada nova preparada (e nada apurado desde então): o telão volta a anunciar.
       * O `seenRoundId` NÃO muda aqui — quem apurou a rodada anterior continua sendo
       * a última coisa vista, e é isso que impede a roleta de repetir quando a página
       * for recarregada pelo `refresh`.
       */
      if (raffle.pendingRound && !rollingRef.current) {
        setPhase('AGUARDANDO');

        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => router.refresh(), 250);
      }
    };

    const startPolling = () => {
      const load = async () => {
        try {
          controller = controller ?? new AbortController();

          const response = await fetch(liveUrl, { signal: controller.signal, cache: 'no-store' });
          apply((await response.json()) as { eligibleCount?: number });
        } catch {
          if (!cancelled) setFailed(true);
        }
      };

      void load();
      pollTimer = setInterval(() => void load(), 5_000);
    };

    if (typeof EventSource === 'undefined') {
      startPolling();
    } else {
      source = new EventSource(liveUrl);

      source.addEventListener('open', () => {
        if (!cancelled) setTransport('sse');
      });

      source.addEventListener('live', (event) => {
        try {
          apply(JSON.parse((event as MessageEvent<string>).data) as { eligibleCount?: number });
        } catch {
          // Evento malformado não pode derrubar a parede do evento.
        }
      });

      source.addEventListener('error', () => {
        if (cancelled) return;

        // `CONNECTING` = o próprio EventSource está reconectando; só quando ele
        // desiste (`CLOSED`) é que vale trocar de transporte.
        if (source?.readyState === EventSource.CLOSED) {
          setTransport('polling');
          source.close();
          source = null;
          startPolling();
        }
      });
    }

    return () => {
      cancelled = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      controller?.abort();
    };
    /**
     * As dependências são ESTÁVEIS de propósito: reabrir a conexão a cada mudança de
     * fase custaria uma reconexão e — pior — o `cleanup` cancelaria o refresh
     * agendado (ver o comentário do `rollingRef`).
     */
  }, [liveUrl, router]);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A ROLETA (FASE 30)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O intervalo DESACELERA: começa rápido (60 ms) e termina devagar (~380 ms), que é
   *  o que dá a sensação de roda parando. A sequência é determinística (passo fixo
   *  sobre a lista publicada) — não é aleatoriedade disfarçada de sorteio, e o mesmo
   *  telão mostra sempre a mesma sequência.
   *
   *  O último quadro é o PRIMEIRO GANHADOR, e não um nome qualquer: a roleta para em
   *  quem ganhou. Sem lista publicada (rodada antiga), não há nomes reais para
   *  passar — a tela revela direto, em vez de inventar.
   */
  useEffect(() => {
    if (!rolling) return;

    const round = model.currentRound;
    const names = round?.rollNames ?? [];

    /**
     * Sem lista publicada (rodada antiga) ou com a preferência de menos movimento, não
     * há roleta: revela direto. A revelação vai por TIMER porque `setState` síncrono
     * dentro do efeito provoca render em cascata — o React Compiler recusa, e o motivo
     * é bom (a mesma decisão está documentada no `WinnerReveal` do console).
     */
    if (!round || names.length === 0 || prefersReducedMotion()) {
      const immediate = setTimeout(() => {
        rollingRef.current = false;
        setRolling(false);
        setPhase('REVELADO');
      }, 0);

      return () => clearTimeout(immediate);
    }

    let step = 0;
    let delay = 60;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      step += 1;

      // ~3 s de suspense e no máximo 24 quadros: o suficiente para a plateia sentir
      // a roleta, curto o suficiente para não virar espera.
      if (step >= 24 || delay >= 380) {
        setRollName(round.winners[0]?.name ?? names[0]!);
        timer = setTimeout(() => {
          rollingRef.current = false;
          setRolling(false);
          setPhase('REVELADO');
        }, 800);
        return;
      }

      setRollName(names[(step * 7) % names.length]!);
      delay = Math.min(380, Math.round(delay * 1.14));
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, delay);

    return () => clearTimeout(timer);
  }, [rolling, model.currentRound]);

  const openFullscreen = () => {
    void document.documentElement.requestFullscreen?.().catch(() => {
      // Navegador sem permissão de tela cheia: o telão continua legível.
    });
  };

  const round = model.currentRound;
  const revealed = phase === 'REVELADO' && round !== null;
  const rollingNow = phase === 'SORTEANDO';
  const drawnAtLabel = round?.drawnAtIso
    ? new Date(round.drawnAtIso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center gap-10 overflow-hidden px-6 py-16 text-center"
      data-testid="raffle-stage"
      data-stage-state={phase}
      data-stage-round={round?.roundNumber ?? ''}
      data-transport={transport}
    >
      <ConfettiBurst active={revealed} testId="stage-confetti" />

      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center gap-8">
        <header className="space-y-4">
          <p className="ef-stage-eyebrow flex items-center justify-center gap-2 text-muted-foreground">
            <Trophy className="size-4" aria-hidden />
            Sorteio
          </p>
          <h1 className="ef-stage-title text-balance" data-testid="stage-title">
            {model.title}
          </h1>
          {model.description ? (
            <p className="mx-auto max-w-2xl text-pretty text-sm opacity-80 sm:text-base">
              {model.description}
            </p>
          ) : null}
        </header>

        {phase === 'CANCELADO' ? (
          <p className="ef-stage-title text-muted-foreground" data-testid="stage-canceled">
            Este sorteio foi cancelado.
          </p>
        ) : null}

        {/**
         * ── O ANÚNCIO DA RODADA ────────────────────────────────────────────────────
         * Enquanto a rodada não é apurada, a parede diz O QUE está sendo sorteado e
         * QUEM deu o prêmio, com a contagem subindo. Antes da FASE 30 esta seção não
         * tinha prêmio nenhum: o telão só sabia dizer "participantes elegíveis".
         */}
        {phase === 'AGUARDANDO' && round ? (
          <section className="flex flex-col items-center gap-4" aria-live="polite">
            <p className="ef-stage-eyebrow text-muted-foreground" data-testid="stage-round-announce">
              A seguir · {roundSubtitle(round)}
            </p>
            {round.prizeDescription ? (
              <p className="mx-auto max-w-2xl text-pretty text-sm opacity-80 sm:text-base">
                {round.prizeDescription}
              </p>
            ) : null}
            {round.sponsorName ? (
              <p className="text-sm text-muted-foreground" data-testid="stage-sponsor">
                Prêmio oferecido por <strong className="font-medium">{round.sponsorName}</strong>
              </p>
            ) : null}

            <p className="ef-stage-eyebrow pt-2 text-muted-foreground">Participantes elegíveis agora</p>
            <p className="ef-stage-count text-primary" data-testid="stage-eligible">
              {eligibleCount}
            </p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Radio className="size-4 animate-pulse text-primary" aria-hidden />
              {transport === 'sse' ? 'contagem ao vivo' : 'contagem atualizada a cada 5 s'}
              {failed ? ' · reconectando' : ''}
            </p>
            <p className="max-w-xl text-sm text-muted-foreground">
              O sorteio desta rodada acontece em instantes. Quem está nesta contagem concorre
              {model.minAttendanceMinutes > 0
                ? ` — é preciso ter ao menos ${model.minAttendanceMinutes} minuto(s) de presença registrada.`
                : '.'}
              {round.seedCommitment
                ? ' A semente já está comprometida: o número abaixo foi publicado antes deste momento.'
                : ''}
            </p>
          </section>
        ) : null}

        {/**
         * ── A ROLETA ───────────────────────────────────────────────────────────────
         * Os nomes que passam são os da lista publicada da rodada apurada (mascarados
         * pelo servidor). A `key` remonta o nó a cada troca para a animação de entrada
         * rodar de novo.
         */}
        {rollingNow ? (
          <section className="flex flex-col items-center gap-6" aria-live="polite">
            <p className="ef-stage-eyebrow text-muted-foreground" data-testid="stage-roll-label">
              Sorteando · {round ? roundSubtitle(round) : 'rodada'}
            </p>
            <p
              key={rollName ?? 'roleta'}
              className="ef-stage-roll ef-stage-winner text-primary"
              data-testid="stage-roll"
            >
              {rollName ?? '…'}
            </p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="size-4 animate-pulse text-primary" aria-hidden />
              {eligibleCount} participante(s) concorrendo nesta rodada
            </p>
          </section>
        ) : null}

        {revealed ? (
          <section className="w-full space-y-8" aria-live="polite">
            <div className="space-y-2">
              <p className="ef-stage-eyebrow text-muted-foreground" data-testid="stage-round-result">
                {roundSubtitle(round)}
              </p>
              {round.prizeDescription ? (
                <p className="mx-auto max-w-2xl text-pretty text-sm opacity-80 sm:text-base">
                  {round.prizeDescription}
                </p>
              ) : null}
              {round.sponsorName ? (
                <p className="text-sm text-muted-foreground" data-testid="stage-sponsor">
                  Prêmio oferecido por <strong className="font-medium">{round.sponsorName}</strong>
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                {round.winners.length} titular(es)
                {round.alternates.length > 0 ? ` · ${round.alternates.length} suplente(s)` : ''}
                {drawnAtLabel ? ` · apurado em ${drawnAtLabel}` : ''}
              </p>
            </div>

            <ol className="space-y-4" data-testid="stage-winners">
              {round.winners.map((winner, index) => (
                <li
                  key={winner.position}
                  data-testid={`stage-winner-${winner.position}`}
                  data-masked={winner.masked ? 'true' : 'false'}
                  className="ef-stage-reveal flex items-center justify-center gap-4"
                  style={{ animationDelay: `${index * 420}ms` }}
                >
                  <span className="code-data flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
                    {winner.position}º
                  </span>
                  <span className="ef-stage-winner">{winner.name}</span>
                </li>
              ))}
            </ol>

            {round.alternates.length > 0 ? (
              <div className="space-y-2">
                <p className="ef-stage-eyebrow text-muted-foreground">Suplentes</p>
                <ol className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
                  {round.alternates.map((alternate) => (
                    <li key={alternate.position}>
                      {alternate.position}º {alternate.name}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>
        ) : null}

        {/**
         * ── O QUE JÁ FOI SORTEADO ──────────────────────────────────────────────────
         * A parede não pode "esquecer" a rodada anterior: quem chegou no meio do evento
         * precisa ver os outros ganhadores, e quem já ganhou não concorre de novo.
         */}
        {model.previousRounds.length > 0 ? (
          <section className="w-full space-y-2 border-t border-border pt-4" data-testid="stage-previous-rounds">
            <p className="ef-stage-eyebrow text-muted-foreground">Já sorteados</p>
            <ol className="space-y-1 text-sm text-muted-foreground sm:text-base">
              {model.previousRounds.map((previous) => (
                <li key={previous.roundNumber} data-testid={`stage-previous-round-${previous.roundNumber}`}>
                  <strong className="font-medium">{roundSubtitle(previous)}</strong>
                  {': '}
                  {previous.winners.map((winner) => winner.name).join(', ')}
                  {previous.sponsorName ? ` · por ${previous.sponsorName}` : ''}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <footer className="flex flex-col items-center gap-4 border-t border-border pt-6 text-xs text-muted-foreground sm:text-sm">
          {round?.seedCommitment ? (
            <p className="max-w-3xl space-y-1">
              <span className="ef-stage-eyebrow block text-muted-foreground">
                Compromisso publicado antes desta rodada
              </span>
              <span className="code-data block break-all" data-testid="stage-commitment">
                {round.seedCommitment}
              </span>
            </p>
          ) : (
            <p className="text-warning-strong" data-testid="stage-no-commitment">
              Este sorteio não tem compromisso de semente: o resultado é auditável por hash, mas não
              reproduzível por terceiros.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-4">
            <a
              href={model.auditHref}
              className="inline-flex items-center gap-2 underline underline-offset-4"
              data-testid="stage-audit-link"
            >
              <ShieldCheck className="size-4" aria-hidden />
              Conferir a auditoria deste sorteio
            </a>

            <button
              type="button"
              onClick={openFullscreen}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 transition hover:bg-accent"
              data-testid="stage-fullscreen"
            >
              <Maximize2 className="size-4" aria-hidden />
              Tela cheia
            </button>
          </div>

          {revealed && round?.resultHash ? (
            <p className="code-data max-w-3xl break-all opacity-70">
              resultado da rodada {round.roundNumber} (SHA-256): {round.resultHash}
            </p>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
