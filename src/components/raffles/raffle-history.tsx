'use client';

import type { RaffleActionFn, RaffleItem } from '@/components/raffles/raffle-history-types';
import { RaffleRow } from '@/components/raffles/raffle-row';
import { AppLink, GetSearchForm } from '@/components/ui';

/**
 * Orquestrador do histórico de sorteios: busca GET por URL, paginação e delegação dos cards
 * para `RaffleRow` (preserva `<GetSearchForm>` e `<AppLink>` na fachada para `f109`).
 */
export function RaffleHistory({
  raffles,
  tenantSlug,
  eventId,
  sponsors,
  page,
  totalPages,
  total,
  drawAction,
  prepareAction,
  drawRoundAction,
  cancelAction,
  deliverAction,
  reverseAction,
  visibilityAction,
  updateRoundAction,
  filter,
  filterQuery,
}: {
  raffles: readonly RaffleItem[];
  tenantSlug: string;
  eventId: string;
  sponsors: readonly { id: string; name: string }[];
  page: number;
  totalPages: number;
  total: number;
  drawAction: RaffleActionFn;
  prepareAction: RaffleActionFn;
  drawRoundAction: RaffleActionFn;
  cancelAction: RaffleActionFn;
  deliverAction: RaffleActionFn;
  reverseAction: RaffleActionFn;
  visibilityAction: RaffleActionFn;
  updateRoundAction?: RaffleActionFn;
  filter: { status: string; from: string; to: string; active: boolean; description: string };
  filterQuery: string;
}) {
  const basePath = `/t/${tenantSlug}/administracao/eventos/${eventId}/sorteios`;

  const filterForm = (
    <GetSearchForm action={basePath} className="flex flex-wrap items-end gap-2" data-testid="raffle-filter">
      <label className="space-y-1 text-xs">
        <span className="block text-muted-foreground">Situação</span>
        <select
          name="situacao"
          defaultValue={filter.status}
          data-testid="raffle-filter-status"
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="ALL">Todas</option>
          <option value="DRAFT">Não apurado</option>
          <option value="DRAWN">Apurado</option>
          <option value="CANCELED">Cancelado</option>
        </select>
      </label>

      <label className="space-y-1 text-xs">
        <span className="block text-muted-foreground">Criado de</span>
        <input
          type="date"
          name="de"
          defaultValue={filter.from}
          data-testid="raffle-filter-from"
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        />
      </label>

      <label className="space-y-1 text-xs">
        <span className="block text-muted-foreground">até</span>
        <input
          type="date"
          name="ate"
          defaultValue={filter.to}
          data-testid="raffle-filter-to"
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        />
      </label>

      <button
        type="submit"
        data-testid="raffle-filter-apply"
        className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted"
      >
        Filtrar
      </button>

      {filter.active ? (
        <AppLink href={basePath} data-testid="raffle-filter-clear" className="px-1 py-1 text-xs underline">
          limpar
        </AppLink>
      ) : null}
    </GetSearchForm>
  );

  if (raffles.length === 0) {
    return (
      <div className="space-y-3">
        {filterForm}
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="raffles-empty">
          {filter.active
            ? `Nenhum sorteio para este filtro (${filter.description}).`
            : 'Nenhum sorteio neste evento ainda. Configure e execute o primeiro acima.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filterForm}

      {filter.active ? (
        <p className="text-xs text-muted-foreground" data-testid="raffle-filter-summary">
          Filtrando por {filter.description}.
        </p>
      ) : null}

      <ul className="space-y-3" data-testid="raffle-history">
        {raffles.map((raffle) => (
          <RaffleRow
            key={raffle.id}
            raffle={raffle}
            tenantSlug={tenantSlug}
            eventId={eventId}
            sponsors={sponsors}
            drawAction={drawAction}
            prepareAction={prepareAction}
            drawRoundAction={drawRoundAction}
            cancelAction={cancelAction}
            deliverAction={deliverAction}
            reverseAction={reverseAction}
            visibilityAction={visibilityAction}
            updateRoundAction={updateRoundAction}
          />
        ))}
      </ul>

      {totalPages > 1 ? (
        <nav
          className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"
          data-testid="raffle-pagination"
          aria-label="Paginação do histórico de sorteios"
        >
          <span>
            Página {page} de {totalPages} · {total} sorteio(s)
          </span>
          <span className="flex items-center gap-2">
            {page > 1 ? (
              <AppLink
                href={`${basePath}?pagina=${page - 1}${filterQuery}`}
                data-testid="raffle-page-prev"
                className="rounded-md border border-border px-2 py-1 hover:bg-muted"
              >
                Anteriores
              </AppLink>
            ) : null}
            {page < totalPages ? (
              <AppLink
                href={`${basePath}?pagina=${page + 1}${filterQuery}`}
                data-testid="raffle-page-next"
                className="rounded-md border border-border px-2 py-1 hover:bg-muted"
              >
                Próximos
              </AppLink>
            ) : null}
          </span>
        </nav>
      ) : null}
    </div>
  );
}
