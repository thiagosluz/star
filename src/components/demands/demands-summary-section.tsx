import type { DemandSummary } from '@/domain/events/demand-rules';
import type { DemandTeamView } from '@/lib/events/demand-service';

interface DemandsSummarySectionProps {
  summary: DemandSummary;
  teams: DemandTeamView[];
}

export function DemandsSummarySection({ summary, teams }: DemandsSummarySectionProps) {
  const cards = [
    { key: 'open', label: 'Em aberto', value: summary.open },
    { key: 'overdue', label: 'Atrasadas', value: summary.overdue },
    { key: 'dueToday', label: 'Vencem hoje', value: summary.dueToday },
    { key: 'done', label: 'Concluídas', value: summary.done },
  ];

  return (
    <>
      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="demand-summary">
        {cards.map((item) => (
          <div
            key={item.key}
            className="rounded-lg border border-border bg-card p-3"
            data-testid={`demand-summary-${item.key}`}
          >
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
          </div>
        ))}
      </section>

      {summary.byTeam.length > 0 ? (
        <section className="space-y-2" data-testid="demand-summary-teams">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Como as equipes estão
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {summary.byTeam.map((row) => {
              const team = teams.find((candidate) => candidate.id === row.teamId);

              return (
                <li key={row.teamId ?? 'sem-equipe'} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">
                    {team?.name ?? 'Sem equipe'}
                    {team?.leadName ? (
                      <span className="text-xs text-muted-foreground"> · líder: {team.leadName}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.open} em aberto · {row.overdue} atrasada(s) · {row.done} concluída(s)
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}
