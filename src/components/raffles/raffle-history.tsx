'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Ban, CheckCircle2, Dices, Loader2, Trophy } from 'lucide-react';

import type { RaffleActionState } from '@/app/actions/raffle-actions';

/**
 * Histórico de apurações.
 *
 * Cada item mostra o que permite RECONFERIR o sorteio depois: o recorte aplicado
 * (escopo, atividade ou dia), o piso de minutos, quantos participaram, quem
 * apurou e o hash do resultado. Um histórico que só lista nomes não serve para
 * auditoria — é a lista de quem ganhou, não a prova de como foi apurado.
 */

interface RaffleItem {
  id: string;
  title: string;
  scopeLabel: string;
  activityTitle: string | null;
  referenceDay: string | null;
  status: string;
  winnersCount: number;
  eligibleCount: number;
  inspectedAttendances: number;
  minAttendanceMinutes: number;
  allowPriorEventWinners: boolean;
  drawnAtLabel: string | null;
  resultHash: string | null;
  createdByName: string | null;
  winners: { position: number; userId: string; userName: string; minutes: number }[];
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Configurado — aguardando apuração',
  DRAWN: 'Apurado',
  CANCELED: 'Cancelado',
};

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
      className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2 py-1 text-[11px] text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Ban className="size-3" aria-hidden />}
      Cancelar sorteio
    </button>
  );
}

function RaffleRow({
  raffle,
  tenantSlug,
  eventId,
  drawAction,
  cancelAction,
}: {
  raffle: RaffleItem;
  tenantSlug: string;
  eventId: string;
  drawAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  cancelAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
}) {
  const [drawState, drawFormAction] = useActionState<RaffleActionState | null, FormData>(drawAction, null);
  const [cancelState, cancelFormAction] = useActionState<RaffleActionState | null, FormData>(
    cancelAction,
    null,
  );
  const [showCancel, setShowCancel] = useState(false);

  const state = cancelState;

  return (
    <li
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      data-testid={`raffle-${raffle.id}`}
      data-status={raffle.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{raffle.title}</p>
          <p className="text-[11px] text-muted-foreground">
            {raffle.scopeLabel}
            {raffle.activityTitle ? ` · ${raffle.activityTitle}` : ''}
            {raffle.referenceDay ? ` · ${raffle.referenceDay}` : ''}
            {raffle.minAttendanceMinutes > 0 ? ` · piso de ${raffle.minAttendanceMinutes} min` : ''}
            {raffle.allowPriorEventWinners ? ' · permite ganhadores anteriores' : ''}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {raffle.status === 'DRAWN'
              ? `${raffle.winners.length} vencedor(es) entre ${raffle.eligibleCount} elegíveis · ${raffle.inspectedAttendances} presença(s) inspecionada(s)`
              : `Alvo: ${raffle.winnersCount} vencedor(es)`}
            {raffle.drawnAtLabel ? ` · apurado em ${raffle.drawnAtLabel}` : ''}
            {raffle.createdByName ? ` · por ${raffle.createdByName}` : ''}
          </p>
        </div>

        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            raffle.status === 'DRAWN'
              ? 'border-green-600/40 text-green-700'
              : raffle.status === 'CANCELED'
                ? 'border-destructive/50 text-destructive'
                : 'border-border text-muted-foreground'
          }`}
        >
          {STATUS_LABEL[raffle.status] ?? raffle.status}
        </span>
      </div>

      {raffle.winners.length > 0 ? (
        <ol className="space-y-1" data-testid={`winners-${raffle.id}`}>
          {raffle.winners.map((winner) => (
            <li
              key={winner.userId}
              className="flex items-center justify-between gap-2 rounded border border-amber-400/40 bg-amber-400/5 px-2 py-1 text-xs"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Trophy className="size-3 shrink-0 text-amber-500" aria-hidden />
                <span className="font-mono">{winner.position}º</span>
                <span className="truncate">{winner.userName}</span>
              </span>
              <span className="shrink-0 font-mono text-muted-foreground">{winner.minutes} min</span>
            </li>
          ))}
        </ol>
      ) : null}

      {raffle.resultHash ? (
        <p className="break-all font-mono text-[10px] text-muted-foreground">
          SHA-256: {raffle.resultHash}
        </p>
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
              className="text-[11px] text-muted-foreground underline underline-offset-4"
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
          className={`flex items-center gap-1.5 text-xs ${drawState.ok ? 'text-green-700' : 'text-destructive'}`}
        >
          {drawState.ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : null}
          {drawState.message}
        </p>
      ) : null}

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={`text-xs ${state.ok ? 'text-green-700' : 'text-destructive'}`}
        >
          {state.message}
        </p>
      ) : null}
    </li>
  );
}

export function RaffleHistory({
  raffles,
  tenantSlug,
  eventId,
  drawAction,
  cancelAction,
}: {
  raffles: readonly RaffleItem[];
  tenantSlug: string;
  eventId: string;
  drawAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  cancelAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
}) {
  if (raffles.length === 0) {
    return (
      <p
        className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
        data-testid="raffles-empty"
      >
        Nenhum sorteio neste evento ainda. Configure e execute o primeiro acima.
      </p>
    );
  }

  return (
    <ul className="space-y-3" data-testid="raffle-history">
      {raffles.map((raffle) => (
        <RaffleRow
          key={raffle.id}
          raffle={raffle}
          tenantSlug={tenantSlug}
          eventId={eventId}
          drawAction={drawAction}
          cancelAction={cancelAction}
        />
      ))}
    </ul>
  );
}
