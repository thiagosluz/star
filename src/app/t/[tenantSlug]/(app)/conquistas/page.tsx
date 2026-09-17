import Link from 'next/link';
import { Medal, Sparkles, Trophy } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { TASK_KIND_LABELS, PROGRESS_STATUS_LABELS } from '@/domain/gamification/task-rules';
import { XP_SOURCE_LABELS } from '@/domain/gamification/xp-rules';
import { getXpProfile, getLeaderboard, listXpHistory } from '@/lib/gamification/xp-service';
import { listMissions } from '@/lib/gamification/task-service';
import { XpProgressPanel } from '@/components/gamification/xp-progress';
import { MissionList } from '@/components/gamification/mission-list';
import { claimMissionAction } from '@/app/actions/gamification-actions';

export const metadata = { title: 'Minhas conquistas' };
export const dynamic = 'force-dynamic';

/**
 * Painel de conquistas do participante.
 *
 * Reúne três leituras que só fazem sentido juntas: onde eu estou (XP, nível,
 * ofensiva), o que eu posso fazer agora (missões) e o que eu já fiz (extrato).
 * Separar isso em três telas obrigaria o participante a caçar a informação.
 */
export default async function AchievementsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId, userId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.XP_READ_OWN,
  });

  const [profileResult, missionsResult, historyResult, leaderboardResult] = await Promise.all([
    getXpProfile(tenantId, userId),
    listMissions(tenantId, userId),
    listXpHistory(tenantId, userId, 12),
    getLeaderboard(tenantId, { limit: 8, currentUserId: userId }),
  ]);

  if (!profileResult.ok) {
    return (
      <main className="max-w-4xl">
        <p className="rounded-lg border border-destructive/40 bg-card p-5 text-sm text-destructive">
          {profileResult.message}
        </p>
      </main>
    );
  }

  const { profile } = profileResult;
  const missions = missionsResult.ok ? missionsResult.missions : [];
  const history = historyResult.ok ? historyResult.entries : [];
  const leaderboard = leaderboardResult.ok ? leaderboardResult.entries : [];

  const claimable = missions.filter((mission) => mission.claimable).length;

  return (
    <main className="max-w-5xl space-y-8">
      <header className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Trophy className="size-6 text-warning" aria-hidden />
          Minhas conquistas
        </h1>
        <p className="text-sm text-muted-foreground">
          Cada ação no evento vale XP. Missões concluídas precisam ser resgatadas por você.
        </p>
      </header>

      <XpProgressPanel
        progress={profile.progress}
        currentStreak={profile.currentStreak}
        longestStreak={profile.longestStreak}
        rank={profile.rank}
        rankedCount={profile.rankedCount}
        seasonXp={profile.seasonXp}
        cardsCollected={profile.cardsCollected}
        tasksCompleted={profile.tasksCompleted}
      />

      <section className="space-y-3" aria-labelledby="missoes">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="missoes" className="text-lg font-semibold tracking-tight">
            Missões
          </h2>
          {claimable > 0 ? (
            <p
              className="rounded-full border border-warning/40 bg-warning-soft px-3 py-1 text-xs font-medium text-warning-strong"
              data-testid="claimable-count"
            >
              {claimable} recompensa(s) esperando resgate
            </p>
          ) : null}
        </div>

        <MissionList
          tenantSlug={tenantSlug}
          action={claimMissionAction}
          missions={missions.map((mission) => ({
            taskDefinitionId: mission.taskDefinitionId,
            name: mission.name,
            description: mission.description,
            kindLabel: TASK_KIND_LABELS[mission.kind] ?? mission.kind,
            triggerLabel: mission.triggerLabel,
            xpReward: mission.xpReward,
            rewardCardSlug: mission.rewardCardSlug,
            progress: mission.progress,
            target: mission.target,
            ratio: mission.ratio,
            status: mission.status,
            claimable: mission.claimable,
            statusLabel: PROGRESS_STATUS_LABELS[mission.status] ?? mission.status,
          }))}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3" aria-labelledby="extrato">
          <h2 id="extrato" className="text-lg font-semibold tracking-tight">
            Extrato de XP
          </h2>

          {history.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              Nenhum XP registrado ainda. Faça o credenciamento no evento para começar.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="xp-history">
              {history.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {XP_SOURCE_LABELS[entry.source] ?? entry.source}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.createdAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      {entry.reason ? ` · ${entry.reason}` : ''}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 code-data text-sm ${
                      entry.amount >= 0 ? 'text-success-strong' : 'text-destructive'
                    }`}
                  >
                    {entry.amount >= 0 ? '+' : ''}
                    {entry.amount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="ranking">
          <h2 id="ranking" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Medal className="size-4 text-warning" aria-hidden />
            Ranking da instituição
          </h2>

          {leaderboard.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              Ninguém pontuou ainda nesta instituição.
            </p>
          ) : (
            <ol className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="leaderboard">
              {leaderboard.map((entry) => (
                <li
                  key={entry.userId}
                  className={`flex items-center justify-between gap-3 p-3 ${
                    entry.isCurrentUser ? 'bg-muted/60' : ''
                  }`}
                  data-testid={`leaderboard-${entry.position}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-6 shrink-0 text-center code-data text-sm text-muted-foreground">
                      {entry.position}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {entry.name}
                        {entry.isCurrentUser ? ' (você)' : ''}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.title} · {entry.cardsCollected} carta(s)
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 code-data text-sm">
                    {entry.totalXp.toLocaleString('pt-BR')}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            O ranking mostra apenas nome, título e XP — nunca dados de contato.
          </p>
        </section>
      </div>

      <nav className="text-sm">
        <Link
          href={tenantPath(tenantSlug, '/cartas')}
          className="font-medium underline underline-offset-4"
        >
          Ver meu álbum de cartas →
        </Link>
      </nav>
    </main>
  );
}
