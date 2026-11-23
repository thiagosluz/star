import type { DemandColumnView } from '@/lib/events/demand-service';
import {
  createColumnAction,
  deleteColumnAction,
  reorderColumnsAction,
  updateColumnAction,
} from '@/app/actions/demand-actions';
import { InlineActionForm } from '@/components/admin/inline-action-form';

interface DemandsColumnsConfigProps {
  tenantSlug: string;
  eventId: string;
  columns: DemandColumnView[];
}

export function DemandsColumnsConfig({ tenantSlug, eventId, columns }: DemandsColumnsConfigProps) {
  return (
    <details className="rounded-lg border border-border bg-card p-4" data-testid="demand-columns-config">
      <summary className="cursor-pointer text-sm font-medium">Colunas do quadro</summary>

      <div className="mt-4 space-y-4">
        {columns.map((column) => (
          <div
            key={column.id}
            className="flex flex-wrap items-end gap-2 border-b border-border pb-3 last:border-0"
            data-testid={`demand-column-row-${column.id}`}
          >
            <InlineActionForm
              action={updateColumnAction}
              submitLabel="Renomear"
              testId={`demand-column-rename-${column.id}`}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="columnId" value={column.id} />
              <input
                name="name"
                defaultValue={column.name}
                maxLength={40}
                className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                data-testid={`demand-column-name-${column.id}`}
              />
            </InlineActionForm>

            <InlineActionForm
              action={updateColumnAction}
              submitLabel={column.isDone ? 'Deixar de concluir' : 'Marcar como conclusão'}
              testId={`demand-column-done-${column.id}`}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="columnId" value={column.id} />
              <input type="hidden" name="isDone" value={column.isDone ? 'false' : 'true'} />
            </InlineActionForm>

            <InlineActionForm
              action={reorderColumnsAction}
              submitLabel="←"
              testId={`demand-column-up-${column.id}`}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="columnId" value={column.id} />
              <input type="hidden" name="direction" value="up" />
            </InlineActionForm>

            <InlineActionForm
              action={reorderColumnsAction}
              submitLabel="→"
              testId={`demand-column-down-${column.id}`}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="columnId" value={column.id} />
              <input type="hidden" name="direction" value="down" />
            </InlineActionForm>

            <InlineActionForm
              action={deleteColumnAction}
              submitLabel="Excluir"
              testId={`demand-column-delete-${column.id}`}
              variant="destructive"
              confirm={{
                title: `Excluir a coluna "${column.name}"?`,
                description:
                  'A coluna só pode ser excluída se estiver vazia. As demandas que estão nela precisam ser movidas antes.',
                confirmLabel: 'Excluir coluna',
              }}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="columnId" value={column.id} />
            </InlineActionForm>
          </div>
        ))}

        <InlineActionForm
          action={createColumnAction}
          submitLabel="Criar coluna"
          testId="demand-column-create"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          <input
            name="name"
            placeholder="Nome da coluna"
            maxLength={40}
            className="w-44 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            data-testid="demand-column-new-name"
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" name="isDone" data-testid="demand-column-new-done" />
            conclui a demanda
          </label>
        </InlineActionForm>
      </div>
    </details>
  );
}
