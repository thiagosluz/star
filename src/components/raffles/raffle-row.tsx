'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Ban, CheckCircle2, Dices, Globe, Loader2 } from 'lucide-react';

import type { RaffleActionState } from '@/app/actions/raffle-actions';
import {
  RAFFLE_STATUS_LABELS,
  type RaffleActionFn,
  type RaffleItem,
} from '@/components/raffles/raffle-history-types';
import { RaffleRoundsSection } from '@/components/raffles/raffle-rounds-section';
import { RaffleWinnerItem } from '@/components/raffles/raffle-winner-item';

function DrawNowButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="draw-existing"
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Dices className="size-3.5" aria-hidden />}
      {pending ? 'Sorteando…' : 'Sortear agora'}
    </button>
  );
}

function CancelButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="cancel-raffle"
      className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2 py-1 text-xs text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Ban className="size-3.5" aria-hidden />}
      Cancelar sorteio
    </button>
  );
}

/** Card completo de um sorteio no histórico administrativo (titulares, suplentes, rodadas e ações). */
export function RaffleRow({
  raffle,
  tenantSlug,
  eventId,
  sponsors,
  drawAction,
  prepareAction,
  drawRoundAction,
  cancelAction,
  deliverAction,
  reverseAction,
  visibilityAction,
  updateRoundAction,
}: {
  raffle: RaffleItem;
  tenantSlug: string;
  eventId: string;
  sponsors: readonly { id: string; name: string }[];
  drawAction: RaffleActionFn;
  prepareAction: RaffleActionFn;
  drawRoundAction: RaffleActionFn;
  cancelAction: RaffleActionFn;
  deliverAction: RaffleActionFn;
  reverseAction: RaffleActionFn;
  visibilityAction: RaffleActionFn;
  updateRoundAction?: RaffleActionFn;
}) {
  const [drawState, drawFormAction] = useActionState<RaffleActionState | null, FormData>(drawAction, null);
  const [cancelState, cancelFormAction] = useActionState<RaffleActionState | null, FormData>(
    cancelAction,
    null,
  );
  const [deliverState, deliverFormAction] = useActionState<RaffleActionState | null, FormData>(
    deliverAction,
    null,
  );
  const [reverseState, reverseFormAction] = useActionState<RaffleActionState | null, FormData>(
    reverseAction,
    null,
  );
  const [visibilityState, visibilityFormAction] = useActionState<RaffleActionState | null, FormData>(
    visibilityAction,
    null,
  );
  const [showCancel, setShowCancel] = useState(false);

  const winners = raffle.winners.filter((winner) => winner.kind === 'WINNER');
  const alternates = raffle.winners.filter((winner) => winner.kind === 'ALTERNATE');
  const delivered = raffle.winners.filter((winner) => winner.deliveredAtLabel).length;

  const multiRound = raffle.rounds.length > 1;
  const roundPrize = (roundNumber: number): string | null =>
    raffle.rounds.find((round) => round.roundNumber === roundNumber)?.prizeTitle ?? null;

  return (
    <li
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      data-testid={`raffle-${raffle.id}`}
      data-status={raffle.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{raffle.title}</p>
          <p className="text-xs text-muted-foreground">
            {raffle.scopeLabel}
            {raffle.activityTitle ? ` · ${raffle.activityTitle}` : ''}
            {raffle.referenceDay ? ` · ${raffle.referenceDay}` : ''}
            {raffle.minAttendanceMinutes > 0 ? ` · piso de ${raffle.minAttendanceMinutes} min` : ''}
            {raffle.weightByMinutes ? ' · chance proporcional ao tempo' : ''}
            {raffle.allowPriorEventWinners ? ' · permite ganhadores anteriores' : ''}
          </p>
          <p className="text-xs text-muted-foreground">
            {raffle.status === 'DRAWN'
              ? `${winners.length} titular(es)${alternates.length > 0 ? ` + ${alternates.length} suplente(s)` : ''} entre ${raffle.eligibleCount} elegíveis · ${delivered} entrega(s) registrada(s)`
              : `Alvo: ${raffle.winnersCount} titular(es)${raffle.alternatesCount > 0 ? ` + ${raffle.alternatesCount} suplente(s)` : ''}`}
            {raffle.drawnAtLabel ? ` · apurado em ${raffle.drawnAtLabel}` : ''}
            {raffle.createdByName ? ` · por ${raffle.createdByName}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              raffle.status === 'DRAWN'
                ? 'border-success/40 text-success-strong'
                : raffle.status === 'CANCELED'
                  ? 'border-destructive/50 text-destructive'
                  : 'border-border text-muted-foreground'
            }`}
          >
            {RAFFLE_STATUS_LABELS[raffle.status] ?? raffle.status}
          </span>

          {raffle.status === 'DRAWN' ? (
            <form action={visibilityFormAction} data-testid={`visibility-${raffle.id}`}>
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="raffleId" value={raffle.id} />
              <input type="hidden" name="isPublic" value={raffle.isPublic ? 'false' : 'true'} />
              <button
                type="submit"
                data-testid={`toggle-public-${raffle.id}`}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted"
              >
                <Globe className="size-3" aria-hidden />
                {raffle.isPublic ? 'Despublicar resultado' : 'Publicar resultado'}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {raffle.winners.length > 0 ? (
        <div className="space-y-2">
          <ol className="space-y-1" data-testid={`winners-${raffle.id}`}>
            {winners.map((winner) => (
              <RaffleWinnerItem
                key={winner.id}
                winner={winner}
                raffleId={raffle.id}
                raffleStatus={raffle.status}
                tenantSlug={tenantSlug}
                eventId={eventId}
                roundPrizeLabel={roundPrize(winner.roundNumber)}
                showRoundBadge={multiRound}
                deliverFormAction={deliverFormAction}
                reverseFormAction={reverseFormAction}
              />
            ))}
          </ol>

          {alternates.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Suplentes — entregam em caso de ausência do titular
              </p>
              <ol className="space-y-1" data-testid={`alternates-${raffle.id}`}>
                {alternates.map((winner) => (
                  <RaffleWinnerItem
                    key={winner.id}
                    winner={winner}
                    raffleId={raffle.id}
                    raffleStatus={raffle.status}
                    tenantSlug={tenantSlug}
                    eventId={eventId}
                    roundPrizeLabel={roundPrize(winner.roundNumber)}
                    showRoundBadge={multiRound}
                    deliverFormAction={deliverFormAction}
                    reverseFormAction={reverseFormAction}
                  />
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}

      <RaffleRoundsSection
        raffle={raffle}
        tenantSlug={tenantSlug}
        eventId={eventId}
        sponsors={sponsors}
        prepareAction={prepareAction}
        drawRoundAction={drawRoundAction}
        updateRoundAction={updateRoundAction ?? (async () => ({ ok: false, message: 'Ação não disponível' }))}
      />

      {raffle.seedCommitment ? (
        <p className="break-all code-data text-muted-foreground" data-testid={`seed-proof-${raffle.id}`}>
          compromisso da semente: {raffle.seedCommitment}
          {raffle.seedRevealed ? ` · revelada: ${raffle.seedRevealed}` : ' · ainda selada'}
        </p>
      ) : null}

      {raffle.resultHash ? (
        <div className="space-y-1">
          <p className="break-all code-data text-muted-foreground">SHA-256: {raffle.resultHash}</p>
          {raffle.seedCommitment ? null : (
            <p className="text-xs text-muted-foreground">
              Sem compromisso de semente (cofre não configurado): o hash confere a integridade, mas o
              resultado não é reproduzível por terceiros.
            </p>
          )}
        </div>
      ) : null}

      {raffle.status === 'DRAFT' ? (
        <div className="flex flex-wrap items-center gap-3">
          <form action={drawFormAction}>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="raffleId" value={raffle.id} />
            <DrawNowButton />
          </form>

          {showCancel ? (
            <form action={cancelFormAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="raffleId" value={raffle.id} />
              <input
                name="reason"
                required
                minLength={8}
                placeholder="Motivo do cancelamento"
                aria-label="Motivo do cancelamento"
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
              <CancelButton />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              Cancelar este sorteio
            </button>
          )}
        </div>
      ) : null}

      {drawState ? (
        <p
          role={drawState.ok ? 'status' : 'alert'}
          data-testid={`draw-feedback-${raffle.id}`}
          className={`flex items-center gap-1.5 text-xs ${drawState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {drawState.ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : null}
          {drawState.message}
        </p>
      ) : null}

      {deliverState ? (
        <p
          role={deliverState.ok ? 'status' : 'alert'}
          data-testid={`delivery-feedback-${raffle.id}`}
          className={`text-xs ${deliverState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {deliverState.message}
        </p>
      ) : null}

      {reverseState ? (
        <p
          role={reverseState.ok ? 'status' : 'alert'}
          data-testid={`reversal-feedback-${raffle.id}`}
          className={`text-xs ${reverseState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {reverseState.message}
        </p>
      ) : null}

      {visibilityState ? (
        <p
          role={visibilityState.ok ? 'status' : 'alert'}
          data-testid={`visibility-feedback-${raffle.id}`}
          className={`text-xs ${visibilityState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {visibilityState.message}
        </p>
      ) : null}

      {cancelState ? (
        <p
          role={cancelState.ok ? 'status' : 'alert'}
          className={`text-xs ${cancelState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {cancelState.message}
        </p>
      ) : null}
    </li>
  );
}
