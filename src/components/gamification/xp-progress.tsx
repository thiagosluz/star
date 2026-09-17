import { Flame, Sparkles, TrendingUp, Trophy } from 'lucide-react';

import type { XpProgress } from '@/domain/gamification/xp-rules';

/**
 * Barra de progresso de XP, nível, prestígio e ofensiva.
 *
 * O progresso é DERIVADO do saldo no servidor (`resolveXpProgress`); este
 * componente apenas desenha o que recebeu. Nenhuma conta de nível acontece aqui
 * — cálculo duplicado na UI é como surgem as divergências entre "o que a tela
 * diz" e "o que o banco diz".
 */
export function XpProgressPanel({
  progress,
  currentStreak,
  longestStreak,
  rank,
  rankedCount,
  seasonXp,
  cardsCollected,
  tasksCompleted,
}: {
  progress: XpProgress;
  currentStreak: number;
  longestStreak: number;
  rank: number | null;
  rankedCount: number;
  seasonXp: number;
  cardsCollected: number;
  tasksCompleted: number;
}) {
  const percent = Math.round(progress.levelRatio * 100);

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-6"
      data-testid="xp-panel"
      data-level={progress.level}
      data-prestige={progress.prestigeLevel}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Trophy className="size-3.5" aria-hidden />
            {progress.title}
          </p>
          <h2 className="text-3xl font-semibold tracking-tight" data-testid="xp-level">
            Nível {progress.level}
            {progress.prestigeLevel > 0 ? (
              <span className="ml-2 align-middle text-sm font-medium text-muted-foreground">
                prestígio {progress.prestigeLevel}
              </span>
            ) : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            <span className="code-data" data-testid="xp-total">
              {progress.totalXp.toLocaleString('pt-BR')}
            </span>{' '}
            XP no total · {seasonXp.toLocaleString('pt-BR')} XP nesta temporada
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-4 text-center">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Ofensiva</dt>
            <dd className="flex items-center justify-center gap-1 text-lg font-semibold">
              <Flame className="size-4 text-warning" aria-hidden />
              {currentStreak}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Ranking</dt>
            <dd className="text-lg font-semibold">{rank ? `${rank}º` : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Cartas</dt>
            <dd className="text-lg font-semibold">{cardsCollected}</dd>
          </div>
        </dl>
      </header>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>
            {progress.atPrestigeGate
              ? 'Complete o nível para subir de prestígio'
              : `Faltam ${progress.xpToNextLevel.toLocaleString('pt-BR')} XP para o nível ${progress.level + 1}`}
          </span>
          <span className="code-data">{percent}%</span>
        </div>

        <div
          className="h-3 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progresso do nível ${progress.level}`}
          data-testid="xp-bar"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/*
          A barra do CICLO só aparece depois do primeiro prestígio: mostrá-la
          antes seria exibir um objetivo a 60 mil XP de distância para quem acabou
          de entrar.
        */}
        {progress.prestigeLevel > 0 ? (
          <div className="space-y-1 pt-1">
            <div className="flex items-baseline justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Sparkles className="size-3" aria-hidden />
                Ciclo de prestígio {progress.prestigeLevel}/10
              </span>
              <span className="code-data">{Math.round(progress.cycleRatio * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-warning"
                style={{ width: `${Math.round(progress.cycleRatio * 100)}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <TrendingUp className="size-3.5" aria-hidden />
        Maior ofensiva: {longestStreak} dia(s) · {tasksCompleted} missão(ões) resgatada(s)
        {rankedCount > 0 ? ` · ${rankedCount} participante(s) pontuando` : ''}
      </p>
    </section>
  );
}
