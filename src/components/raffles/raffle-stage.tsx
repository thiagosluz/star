'use client';

import { Maximize2, ShieldCheck, Trophy } from 'lucide-react';

import { ConfettiBurst } from '@/components/raffles/confetti-burst';
import {
  StagePreviousRoundsSection,
  StageRevealedSection,
  StageRollingView,
  StageWaitingView,
} from '@/components/raffles/raffle-stage-views';
import type {
  StageModel,
  StageRoundModel,
  StageWinner,
} from '@/components/raffles/raffle-stage-types';
import { useRaffleLiveStream } from '@/components/raffles/use-raffle-live-stream';
import { useRaffleRoulette } from '@/components/raffles/use-raffle-roulette';
import { AppLink } from '@/components/ui';

export type { StageModel, StageRoundModel, StageWinner };

/**
 * Orquestrador do telão ao vivo do sorteio: conecta stream SSE/polling
 * (`useRaffleLiveStream`) à máquina da roleta (`useRaffleRoulette`) e às visões
 * declarativas da etapa em cartaz, mantendo `AppLink` e `suppressHydrationWarning`.
 */
export function RaffleStage({ model, liveUrl }: { model: StageModel; liveUrl: string }) {
  const {
    phase,
    rollName,
    isPaused,
    rollingRef,
    startRoll,
    togglePause,
    replayRoulette,
    markPending,
    markCanceled,
  } = useRaffleRoulette({
    initialState: model.state,
    currentRound: model.currentRound,
  });

  const { eligibleCount, transport, failed } = useRaffleLiveStream({
    liveUrl,
    initialEligibleCount: model.eligibleCount,
    initialState: model.state,
    initialRoundNumber: model.currentRound?.roundNumber ?? null,
    rollingRef,
    onDrawnRound: startRoll,
    onPendingRound: markPending,
    onCanceled: markCanceled,
  });

  const openFullscreen = () => {
    void document.documentElement.requestFullscreen?.().catch(() => {
      // Navegador sem permissão de tela cheia: o telão continua legível.
    });
  };

  const round = model.currentRound;
  const revealed = phase === 'REVELADO' && round !== null;
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
            <p className="mx-auto max-w-2xl text-pretty text-sm opacity-80 sm:text-base">{model.description}</p>
          ) : null}
        </header>

        {phase === 'CANCELADO' ? (
          <p className="ef-stage-title text-muted-foreground" data-testid="stage-canceled">
            Este sorteio foi cancelado.
          </p>
        ) : null}

        {phase === 'AGUARDANDO' && round ? (
          <StageWaitingView
            round={round}
            eligibleCount={eligibleCount}
            minAttendanceMinutes={model.minAttendanceMinutes}
            transport={transport}
            failed={failed}
          />
        ) : null}

        {phase === 'SORTEANDO' ? (
          <StageRollingView
            round={round}
            rollName={rollName}
            eligibleCount={eligibleCount}
            isPaused={isPaused}
            onTogglePause={togglePause}
            onReplay={replayRoulette}
          />
        ) : null}

        {revealed ? (
          <StageRevealedSection
            round={round}
            onReplay={replayRoulette}
            metaSlot={
              <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                {round.winners.length} titular(es)
                {round.alternates.length > 0 ? ` · ${round.alternates.length} suplente(s)` : ''}
                {drawnAtLabel ? ` · apurado em ${drawnAtLabel}` : ''}
              </p>
            }
          />
        ) : null}

        <StagePreviousRoundsSection rounds={model.previousRounds} />

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
            <p className="text-warning-strong-on-dark" data-testid="stage-no-commitment">
              Este sorteio não tem compromisso de semente: o resultado é auditável por hash, mas não
              reproduzível por terceiros.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-4">
            <AppLink
              href={model.auditHref}
              className="inline-flex items-center gap-2 underline underline-offset-4"
              data-testid="stage-audit-link"
            >
              <ShieldCheck className="size-4" aria-hidden />
              Conferir a auditoria deste sorteio
            </AppLink>

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
