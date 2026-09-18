'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Ban, CheckCircle2, Dices, Globe, Loader2, Medal, Trophy } from 'lucide-react';

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
  alternatesCount: number;
  weightByMinutes: boolean;
  isPublic: boolean;
  eligibleCount: number;
  inspectedAttendances: number;
  minAttendanceMinutes: number;
  allowPriorEventWinners: boolean;
  drawnAtLabel: string | null;
  resultHash: string | null;
  seedCommitment: string | null;
  seedRevealed: string | null;
  createdByName: string | null;
  winners: {
    /** Id da POSIÇÃO sorteada — é o que o registro de entrega envia. */
    id: string;
    position: number;
    userId: string;
    userName: string;
    minutes: number;
    kind: 'WINNER' | 'ALTERNATE';
    deliveredAtLabel: string | null;
    deliveredByName: string | null;
    deliveryNote: string | null;
  }[];
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
      className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2 py-1 text-xs text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
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
  deliverAction,
  visibilityAction,
}: {
  raffle: RaffleItem;
  tenantSlug: string;
  eventId: string;
  drawAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  cancelAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  deliverAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  visibilityAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
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
  const [visibilityState, visibilityFormAction] = useActionState<RaffleActionState | null, FormData>(
    visibilityAction,
    null,
  );
  const [showCancel, setShowCancel] = useState(false);
  const [delivering, setDelivering] = useState<string | null>(null);

  const state = cancelState;
  const winners = raffle.winners.filter((winner) => winner.kind === 'WINNER');
  const alternates = raffle.winners.filter((winner) => winner.kind === 'ALTERNATE');
  const delivered = raffle.winners.filter((winner) => winner.deliveredAtLabel).length;

  /** Uma linha da lista (titular ou suplente), com o registro de entrega. */
  const renderPosition = (winner: RaffleItem['winners'][number]) => (
    <li
      key={winner.id}
      data-testid={`position-${winner.id}`}
      data-kind={winner.kind}
      data-delivered={winner.deliveredAtLabel ? 'true' : 'false'}
      className={`flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${
        winner.kind === 'WINNER'
          ? 'border-warning/40 bg-warning-soft'
          : 'border-border bg-surface-low'
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
        {winner.kind === 'ALTERNATE' ? (
          <span className="rounded-full border border-border px-1.5 label-caps uppercase text-muted-foreground">
            suplente
          </span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <span className="code-data text-muted-foreground">{winner.minutes} min</span>

        {winner.deliveredAtLabel ? (
          <span
            className="text-success-strong"
            data-testid={`delivered-${winner.id}`}
            title={winner.deliveryNote ?? undefined}
          >
            entregue {winner.deliveredAtLabel}
            {winner.deliveredByName ? ` · ${winner.deliveredByName}` : ''}
          </span>
        ) : raffle.status === 'DRAWN' ? (
          delivering === winner.id ? (
            <form action={deliverFormAction} className="flex items-center gap-1">
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <input type="hidden" name="raffleId" value={raffle.id} />
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
              onClick={() => setDelivering(winner.id)}
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
            {STATUS_LABEL[raffle.status] ?? raffle.status}
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
            {winners.map(renderPosition)}
          </ol>

          {alternates.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Suplentes — entregam em caso de ausência do titular
              </p>
              <ol className="space-y-1" data-testid={`alternates-${raffle.id}`}>
                {alternates.map(renderPosition)}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}

      {raffle.resultHash ? (
        <div className="space-y-1">
          <p className="break-all code-data text-muted-foreground">SHA-256: {raffle.resultHash}</p>
          {raffle.seedCommitment ? (
            <p
              className="break-all code-data text-muted-foreground"
              data-testid={`seed-proof-${raffle.id}`}
            >
              compromisso da semente: {raffle.seedCommitment}
              {raffle.seedRevealed ? ` · revelada: ${raffle.seedRevealed}` : ' · ainda selada'}
            </p>
          ) : (
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

      {visibilityState ? (
        <p
          role={visibilityState.ok ? 'status' : 'alert'}
          data-testid={`visibility-feedback-${raffle.id}`}
          className={`text-xs ${visibilityState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {visibilityState.message}
        </p>
      ) : null}

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={`text-xs ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
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
  page,
  totalPages,
  total,
  drawAction,
  cancelAction,
  deliverAction,
  visibilityAction,
}: {
  raffles: readonly RaffleItem[];
  tenantSlug: string;
  eventId: string;
  page: number;
  totalPages: number;
  total: number;
  drawAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  cancelAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  deliverAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  visibilityAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
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

  const basePath = `/t/${tenantSlug}/administracao/eventos/${eventId}/sorteios`;

  return (
    <div className="space-y-3">
      <ul className="space-y-3" data-testid="raffle-history">
        {raffles.map((raffle) => (
          <RaffleRow
            key={raffle.id}
            raffle={raffle}
            tenantSlug={tenantSlug}
            eventId={eventId}
            drawAction={drawAction}
            cancelAction={cancelAction}
            deliverAction={deliverAction}
            visibilityAction={visibilityAction}
          />
        ))}
      </ul>

      {/*
        ── PAGINAÇÃO (item G6) ────────────────────────────────────────────────
        O histórico tinha teto de 100 e o começo da lista desaparecia sem aviso.
        Aqui o total aparece e a navegação é por link, para que o endereço da
        página seja compartilhável e o botão "voltar" do navegador funcione.
      */}
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
              <a
                href={`${basePath}?pagina=${page - 1}`}
                data-testid="raffle-page-prev"
                className="rounded-md border border-border px-2 py-1 hover:bg-muted"
              >
                Anteriores
              </a>
            ) : null}
            {page < totalPages ? (
              <a
                href={`${basePath}?pagina=${page + 1}`}
                data-testid="raffle-page-next"
                className="rounded-md border border-border px-2 py-1 hover:bg-muted"
              >
                Próximos
              </a>
            ) : null}
          </span>
        </nav>
      ) : null}
    </div>
  );
}
