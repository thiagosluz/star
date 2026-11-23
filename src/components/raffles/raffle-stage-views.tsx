'use client';

import type { ReactNode } from 'react';
import { Pause, Play, Radio, RotateCcw, Sparkles } from 'lucide-react';

import {
  roundSubtitle,
  type StageRoundModel,
  type StageTransport,
} from '@/components/raffles/raffle-stage-types';

export function StageWaitingView({
  round,
  eligibleCount,
  minAttendanceMinutes,
  transport,
  failed,
}: {
  round: StageRoundModel;
  eligibleCount: number;
  minAttendanceMinutes: number;
  transport: StageTransport;
  failed: boolean;
}) {
  return (
    <section className="flex flex-col items-center gap-4" aria-live="polite">
      <p className="ef-stage-eyebrow text-muted-foreground" data-testid="stage-round-announce">
        A seguir · {roundSubtitle(round)}
      </p>
      {round.prizeDescription ? (
        <p className="mx-auto max-w-2xl text-pretty text-sm opacity-80 sm:text-base">{round.prizeDescription}</p>
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
        {minAttendanceMinutes > 0
          ? ` — é preciso ter ao menos ${minAttendanceMinutes} minuto(s) de presença registrada.`
          : '.'}
        {round.seedCommitment
          ? ' A semente já está comprometida: o número abaixo foi publicado antes deste momento.'
          : ''}
      </p>
    </section>
  );
}

export function StageRollingView({
  round,
  rollName,
  eligibleCount,
  isPaused,
  onTogglePause,
  onReplay,
}: {
  round: StageRoundModel | null;
  rollName: string | null;
  eligibleCount: number;
  isPaused: boolean;
  onTogglePause: () => void;
  onReplay: () => void;
}) {
  return (
    <section className="flex flex-col items-center gap-6" aria-live="polite">
      <p className="ef-stage-eyebrow text-muted-foreground" data-testid="stage-roll-label">
        Sorteando · {round ? roundSubtitle(round) : 'rodada'} {isPaused ? '(Pausado)' : ''}
      </p>
      <p key={rollName ?? 'roleta'} className="ef-stage-roll ef-stage-winner text-primary" data-testid="stage-roll">
        {rollName ?? '…'}
      </p>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="size-4 animate-pulse text-primary" aria-hidden />
        {eligibleCount} participante(s) concorrendo nesta rodada
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {isPaused ? (
          <button
            type="button"
            onClick={onTogglePause}
            data-testid="stage-resume-roleta"
            className="inline-flex items-center gap-2 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
          >
            <Play className="size-3.5" aria-hidden />
            Continuar roleta
          </button>
        ) : (
          <button
            type="button"
            onClick={onTogglePause}
            data-testid="stage-pause-roleta"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            <Pause className="size-3.5" aria-hidden />
            Pausar roleta
          </button>
        )}
        <button
          type="button"
          onClick={onReplay}
          data-testid="stage-replay-roleta"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reiniciar roleta
        </button>
      </div>
    </section>
  );
}

export function StageRevealedSection({
  round,
  metaSlot,
  onReplay,
}: {
  round: StageRoundModel;
  metaSlot: ReactNode;
  onReplay: () => void;
}) {
  return (
    <section className="w-full space-y-8" aria-live="polite">
      <div className="space-y-2">
        <p className="ef-stage-eyebrow text-muted-foreground" data-testid="stage-round-result">
          {roundSubtitle(round)}
        </p>
        {round.prizeDescription ? (
          <p className="mx-auto max-w-2xl text-pretty text-sm opacity-80 sm:text-base">{round.prizeDescription}</p>
        ) : null}
        {round.sponsorName ? (
          <p className="text-sm text-muted-foreground" data-testid="stage-sponsor">
            Prêmio oferecido por <strong className="font-medium">{round.sponsorName}</strong>
          </p>
        ) : null}
        {metaSlot}
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

      {round.rollNames.length > 0 ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onReplay}
            data-testid="stage-replay-roleta"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Repetir animação da roleta
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function StagePreviousRoundsSection({ rounds }: { rounds: readonly StageRoundModel[] }) {
  if (rounds.length === 0) return null;

  return (
    <section className="w-full space-y-2 border-t border-border pt-4" data-testid="stage-previous-rounds">
      <p className="ef-stage-eyebrow text-muted-foreground">Já sorteados</p>
      <ol className="space-y-1 text-sm text-muted-foreground sm:text-base">
        {rounds.map((previous) => (
          <li key={previous.roundNumber} data-testid={`stage-previous-round-${previous.roundNumber}`}>
            <strong className="font-medium">{roundSubtitle(previous)}</strong>
            {': '}
            {previous.winners.map((winner) => winner.name).join(', ')}
            {previous.sponsorName ? ` · por ${previous.sponsorName}` : ''}
          </li>
        ))}
      </ol>
    </section>
  );
}
