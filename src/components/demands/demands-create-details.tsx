import { Plus } from 'lucide-react';

import { DEMAND_PRIORITIES, DEMAND_PRIORITY_LABELS } from '@/domain/events/demand-rules';
import type { DemandColumnView, DemandPerson, DemandTeamView } from '@/lib/events/demand-service';
import { createDemandAction } from '@/app/actions/demand-actions';
import { InlineActionForm } from '@/components/admin/inline-action-form';

interface DemandsCreateDetailsProps {
  tenantSlug: string;
  eventId: string;
  columns: DemandColumnView[];
  teams: DemandTeamView[];
  people: DemandPerson[];
}

export function DemandsCreateDetails({
  tenantSlug,
  eventId,
  columns,
  teams,
  people,
}: DemandsCreateDetailsProps) {
  return (
    <details className="rounded-lg border border-border bg-card p-4" data-testid="demand-create">
      <summary className="cursor-pointer text-sm font-medium">
        <Plus className="mr-1 inline size-4" aria-hidden />
        Nova demanda
      </summary>

      <InlineActionForm
        action={createDemandAction}
        submitLabel="Criar demanda"
        testId="demand-create-form"
        variant="primary"
        className="mt-4 space-y-4"
      >
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block text-muted-foreground">Título</span>
            <input
              name="title"
              required
              maxLength={160}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              data-testid="demand-title"
            />
          </label>

          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block text-muted-foreground">Descrição</span>
            <textarea
              name="description"
              rows={3}
              maxLength={4000}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              data-testid="demand-description"
            />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Coluna</span>
            <select
              name="columnId"
              defaultValue={columns[0]?.id ?? ''}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              data-testid="demand-column"
            >
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Prioridade</span>
            <select
              name="priority"
              defaultValue="NORMAL"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              data-testid="demand-priority"
            >
              {DEMAND_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {DEMAND_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Equipe</span>
            <select
              name="teamId"
              defaultValue=""
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              data-testid="demand-team"
            >
              <option value="">sem equipe</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Início</span>
            <input
              type="date"
              name="startAt"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              data-testid="demand-start"
            />
          </label>

          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">Prazo (fim do dia, no fuso do evento)</span>
            <input
              type="date"
              name="dueAt"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              data-testid="demand-due"
            />
          </label>

          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block text-muted-foreground">
              Responsáveis (equipe ativa da instituição)
            </span>
            <select
              name="assigneeIds"
              multiple
              size={Math.min(Math.max(people.length, 3), 8)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              data-testid="demand-assignees"
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </InlineActionForm>
    </details>
  );
}
