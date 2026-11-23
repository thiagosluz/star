'use client';

import { useState } from 'react';
import { Medal, Trophy } from 'lucide-react';

import type { RaffleWinnerItemData } from '@/components/raffles/raffle-history-types';

/** Linha individual de titular ou suplente no sorteio, com ações inline de entrega e reversão. */
export function RaffleWinnerItem({
  winner,
  raffleId,
  raffleStatus,
  tenantSlug,
  eventId,
  roundPrizeLabel,
  showRoundBadge,
  deliverFormAction,
  reverseFormAction,
}: {
  winner: RaffleWinnerItemData;
  raffleId: string;
  raffleStatus: string;
  tenantSlug: string;
  eventId: string;
  roundPrizeLabel: string | null;
  showRoundBadge: boolean;
  deliverFormAction: (payload: FormData) => void;
  reverseFormAction: (payload: FormData) => void;
}) {
  const [delivering, setDelivering] = useState(false);
  const [reversing, setReversing] = useState(false);

  return (
    <li
      data-testid={`position-${winner.id}`}
      data-kind={winner.kind}
      data-round={winner.roundNumber}
      data-delivered={winner.deliveredAtLabel ? 'true' : 'false'}
      className={`flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${
        winner.kind === 'WINNER' ? 'border-warning/40 bg-warning-soft' : 'border-border bg-surface-low'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {winner.kind === 'WINNER' ? (
          <Trophy className="size-3 shrink-0 text-warning" aria-hidden />
        ) : (
          <Medal className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="code-data">{winner.position}º</span>
        <span className="truncate">{winner.userName}</span>
        {showRoundBadge ? (
          <span
            className="rounded-full border border-border px-1.5 label-caps uppercase text-muted-foreground"
            data-testid={`round-badge-${winner.id}`}
            title={roundPrizeLabel ?? undefined}
          >
            {roundPrizeLabel ?? `rodada ${winner.roundNumber}`}
          </span>
        ) : null}
        {winner.kind === 'ALTERNATE' ? (
          <span className="rounded-full border border-border px-1.5 label-caps uppercase text-muted-foreground">
            suplente
          </span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <span className="code-data text-muted-foreground">{winner.minutes} min</span>

        {winner.deliveredAtLabel ? (
          <span className="flex items-center gap-2">
            <span
              className="text-success-strong"
              data-testid={`delivered-${winner.id}`}
              title={winner.deliveryNote ?? undefined}
            >
              entregue {winner.deliveredAtLabel}
              {winner.deliveredByName ? ` · ${winner.deliveredByName}` : ''}
            </span>

            {raffleStatus === 'DRAWN' ? (
              reversing ? (
                <form action={reverseFormAction} className="flex items-center gap-1">
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="raffleId" value={raffleId} />
                  <input type="hidden" name="positionId" value={winner.id} />
                  <input
                    name="reason"
                    required
                    minLength={5}
                    maxLength={300}
                    placeholder="Motivo da reversão (obrigatório)"
                    aria-label={`Motivo para desfazer a entrega de ${winner.userName}`}
                    className="w-56 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
                  />
                  <button
                    type="submit"
                    data-testid={`confirm-reversal-${winner.id}`}
                    className="rounded-md border border-destructive/50 px-2 py-0.5 text-xs font-medium text-destructive"
                  >
                    Desfazer entrega
                  </button>
                  <button
                    type="button"
                    onClick={() => setReversing(false)}
                    className="px-1 text-xs text-muted-foreground hover:underline"
                  >
                    cancelar
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setReversing(true)}
                  data-testid={`reverse-delivery-${winner.id}`}
                  className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  Desfazer
                </button>
              )
            ) : null}
          </span>
        ) : raffleStatus === 'DRAWN' ? (
          delivering ? (
            <form action={deliverFormAction} className="flex items-center gap-1">
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="raffleId" value={raffleId} />
              <input type="hidden" name="positionId" value={winner.id} />
              <input
                name="note"
                maxLength={300}
                placeholder="Observação (opcional)"
                aria-label={`Observação da entrega de ${winner.userName}`}
                className="w-40 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
              />
              <button
                type="submit"
                data-testid={`confirm-delivery-${winner.id}`}
                className="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
              >
                Confirmar
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setDelivering(true)}
              data-testid={`deliver-${winner.id}`}
              className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted"
            >
              Registrar entrega
            </button>
          )
        ) : null}
      </span>
    </li>
  );
}
