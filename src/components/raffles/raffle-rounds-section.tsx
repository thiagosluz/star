'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Dices, Loader2 } from 'lucide-react';

import type { RaffleActionState } from '@/app/actions/raffle-actions';
import type { RaffleActionFn, RaffleItem } from '@/components/raffles/raffle-history-types';

function RoundButton({ label, testId }: { label: string; testId: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={testId}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Dices className="size-3.5" aria-hidden />}
      {pending ? 'Sorteando…' : label}
    </button>
  );
}

/** Gerenciamento de rodadas do sorteio: preparo controlado, apuração e edição de anúncio. */
export function RaffleRoundsSection({
  raffle,
  tenantSlug,
  eventId,
  sponsors,
  prepareAction,
  drawRoundAction,
  updateRoundAction,
}: {
  raffle: RaffleItem;
  tenantSlug: string;
  eventId: string;
  sponsors: readonly { id: string; name: string }[];
  prepareAction: RaffleActionFn;
  drawRoundAction: RaffleActionFn;
  updateRoundAction: RaffleActionFn;
}) {
  const [prepareState, prepareFormAction] = useActionState<RaffleActionState | null, FormData>(
    prepareAction,
    null,
  );
  const [drawState, drawRoundFormAction] = useActionState<RaffleActionState | null, FormData>(
    drawRoundAction,
    null,
  );
  const [updateState, updateFormAction] = useActionState<RaffleActionState | null, FormData>(
    updateRoundAction,
    null,
  );
  const [editingRoundId, setEditingRoundId] = useState<string | null>(null);

  // Campos controlados para não perder o prêmio digitado se o servidor recusar o preparo no React 19.
  const [form, setForm] = useState({
    prizeTitle: '',
    prizeDescription: '',
    sponsorId: '',
    winnersCount: String(raffle.winnersCount),
    alternatesCount: String(raffle.alternatesCount),
  });
  const update = (patch: Partial<typeof form>) => setForm((previous) => ({ ...previous, ...patch }));

  const pending = raffle.rounds.find((round) => round.state === 'PREPARED') ?? null;
  const canPrepare = raffle.status !== 'CANCELED';
  const drawHere = raffle.status !== 'DRAFT';

  return (
    <div className="space-y-2" data-testid={`raffle-rounds-${raffle.id}`}>
      <p className="text-xs font-medium text-muted-foreground">
        Rodadas ({raffle.rounds.length}) — cada uma com o próprio prêmio, o próprio compromisso de semente e o
        próprio resultado
      </p>

      <ol className="space-y-1">
        {raffle.rounds.map((round) => (
          <li
            key={round.id}
            data-testid={`raffle-round-${round.roundNumber}`}
            data-round-state={round.state}
            className="flex flex-col gap-1 rounded border border-border bg-surface-low p-2 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="code-data text-muted-foreground">{round.roundNumber}</span>
                <span className="truncate font-medium">{round.prizeTitle ?? 'Prêmio surpresa'}</span>
                {round.sponsorName ? <span className="truncate text-muted-foreground">por {round.sponsorName}</span> : null}
                <span className="rounded-full border border-border px-1.5 label-caps uppercase text-muted-foreground">
                  {round.state === 'DRAWN' ? 'apurada' : 'aguardando apuração'}
                </span>
              </span>

              <span className="flex shrink-0 flex-wrap items-center gap-2 text-muted-foreground">
                <button
                  type="button"
                  onClick={() => setEditingRoundId(editingRoundId === round.id ? null : round.id)}
                  data-testid={`edit-round-announcement-${round.roundNumber}`}
                  className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  {editingRoundId === round.id ? 'Fechar edição' : 'Editar anúncio'}
                </button>

                {round.state === 'DRAWN' ? (
                  <>
                    <span>
                      {round.winnersCount} titular(es)
                      {round.alternatesCount > 0 ? ` + ${round.alternatesCount} suplente(s)` : ''} entre{' '}
                      {round.eligibleCount}
                    </span>
                    {round.drawnAtLabel ? <span>{round.drawnAtLabel}</span> : null}
                  </>
                ) : (
                  <>
                    <span>
                      alvo: {round.winnersCount}
                      {round.alternatesCount > 0 ? ` + ${round.alternatesCount}` : ''}
                    </span>
                    {drawHere ? (
                      <form action={drawRoundFormAction}>
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="raffleId" value={raffle.id} />
                        <input type="hidden" name="roundId" value={round.id} />
                        <RoundButton
                          label={`Sortear a rodada ${round.roundNumber}`}
                          testId={`draw-round-${round.roundNumber}`}
                        />
                      </form>
                    ) : null}
                  </>
                )}
              </span>
            </div>

            {editingRoundId === round.id ? (
              <form
                action={updateFormAction}
                className="mt-2 w-full space-y-2 rounded border border-border bg-background p-2"
                data-testid={`edit-announcement-form-${round.roundNumber}`}
              >
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="raffleId" value={raffle.id} />
                <input type="hidden" name="roundId" value={round.id} />

                <p className="font-semibold text-foreground">Editar anúncio da rodada {round.roundNumber}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1 text-xs">
                    <span className="block text-muted-foreground">Título do prêmio</span>
                    <input
                      name="prizeTitle"
                      defaultValue={round.prizeTitle ?? ''}
                      placeholder="Ex.: Fone de ouvido"
                      data-testid={`edit-prize-title-${round.roundNumber}`}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                    />
                  </label>

                  <label className="space-y-1 text-xs">
                    <span className="block text-muted-foreground">Patrocinador</span>
                    <select
                      name="sponsorId"
                      defaultValue=""
                      data-testid={`edit-sponsor-${round.roundNumber}`}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                    >
                      <option value="">Sem patrocinador informado</option>
                      {sponsors.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-xs sm:col-span-2">
                    <span className="block text-muted-foreground">Descrição do prêmio</span>
                    <input
                      name="prizeDescription"
                      defaultValue={round.prizeDescription ?? ''}
                      placeholder="Descrição opcional"
                      data-testid={`edit-prize-description-${round.roundNumber}`}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                    />
                  </label>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    data-testid={`save-round-announcement-${round.roundNumber}`}
                    className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
                  >
                    Salvar anúncio
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingRoundId(null)}
                    className="rounded border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ol>

      {updateState ? (
        <p
          role={updateState.ok ? 'status' : 'alert'}
          data-testid={`round-update-feedback-${raffle.id}`}
          className={`text-xs ${updateState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {updateState.message}
        </p>
      ) : null}

      {drawState ? (
        <p
          role={drawState.ok ? 'status' : 'alert'}
          data-testid={`round-draw-feedback-${raffle.id}`}
          className={`text-xs ${drawState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {drawState.message}
        </p>
      ) : null}

      {prepareState ? (
        <p
          role={prepareState.ok ? 'status' : 'alert'}
          data-testid={`round-prepare-feedback-${raffle.id}`}
          className={`text-xs ${prepareState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {prepareState.message}
        </p>
      ) : null}

      {pending ? (
        <p className="text-xs text-muted-foreground">
          A rodada {pending.roundNumber} está preparada e aguardando a apuração. Apure-a para preparar a
          próxima — o telão anuncia uma rodada por vez.
        </p>
      ) : canPrepare ? (
        <form
          action={prepareFormAction}
          className="space-y-2 rounded border border-dashed border-border p-2"
          data-testid={`prepare-round-form-${raffle.id}`}
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="raffleId" value={raffle.id} />

          <p className="text-xs font-medium">Preparar a próxima rodada</p>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Prêmio (opcional)</span>
              <input
                name="prizeTitle"
                maxLength={200}
                value={form.prizeTitle}
                onChange={(event) => update({ prizeTitle: event.target.value })}
                aria-label="Prêmio da próxima rodada"
                data-testid={`prepare-prize-title-${raffle.id}`}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Quem deu o prêmio (opcional)</span>
              <select
                name="sponsorId"
                value={form.sponsorId}
                onChange={(event) => update({ sponsorId: event.target.value })}
                aria-label="Patrocinador da próxima rodada"
                data-testid={`prepare-sponsor-${raffle.id}`}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="">Sem patrocinador informado</option>
                {sponsors.map((sponsor) => (
                  <option key={sponsor.id} value={sponsor.id}>
                    {sponsor.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Titulares</span>
              <input
                type="number"
                name="winnersCount"
                min={1}
                max={500}
                value={form.winnersCount}
                onChange={(event) => update({ winnersCount: event.target.value })}
                aria-label="Titulares da próxima rodada"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Suplentes</span>
              <input
                type="number"
                name="alternatesCount"
                min={0}
                max={500}
                value={form.alternatesCount}
                onChange={(event) => update({ alternatesCount: event.target.value })}
                aria-label="Suplentes da próxima rodada"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
            </label>

            <label className="space-y-1 text-xs sm:col-span-2">
              <span className="block text-muted-foreground">Detalhe do prêmio (opcional)</span>
              <input
                name="prizeDescription"
                maxLength={600}
                value={form.prizeDescription}
                onChange={(event) => update({ prizeDescription: event.target.value })}
                aria-label="Detalhe do prêmio da próxima rodada"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
            </label>
          </div>

          <RoundButton label="Preparar próxima rodada" testId={`prepare-round-${raffle.id}`} />
        </form>
      ) : null}
    </div>
  );
}
