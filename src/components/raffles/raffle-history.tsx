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

interface RaffleRoundItem {
  id: string;
  roundNumber: number;
  state: 'PREPARED' | 'DRAWN';
  prizeTitle: string | null;
  prizeDescription: string | null;
  sponsorName: string | null;
  winnersCount: number;
  alternatesCount: number;
  eligibleCount: number;
  resultHash: string | null;
  poolHash: string | null;
  seedCommitment: string | null;
  seedRevealed: string | null;
  drawnAtLabel: string | null;
}

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
  /** Rodadas do sorteio, da primeira para a última (FASE 30). */
  rounds: RaffleRoundItem[];
  winners: {
    /** Id da POSIÇÃO sorteada — é o que o registro de entrega envia. */
    id: string;
    position: number;
    /** Rodada que sorteou esta posição (FASE 30). */
    roundNumber: number;
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

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RODADAS DO SORTEIO (FASE 30)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA SEÇÃO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Antes, um sorteio apurava UMA vez. Quem quisesse premiar de novo criava outro
 *  sorteio — e o mesmo participante podia ganhar duas vezes seguidas, porque os
 *  sorteios não se conheciam. Aqui o sorteio passa a ter MOMENTOS: cada um com o seu
 *  prêmio, o seu patrocinador, o seu compromisso de semente e o seu resultado
 *  assinado. Quem ganhou uma rodada não concorre nas seguintes, e o telão anuncia a
 *  rodada preparada antes de ela existir como resultado — que é o que o palco faz.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O PRÊMIO NÃO ENTRA NO SORTEIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O prêmio é ANÚNCIO (ADR-145): não entra no documento assinado. Corrigir "Fone
 *  Bluetooth" para "Fone Bluetooth JBL" depois da apuração não pode invalidar um
 *  resultado que o público já viu.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function RoundsSection({
  raffle,
  tenantSlug,
  eventId,
  sponsors,
  prepareAction,
  drawRoundAction,
}: {
  raffle: RaffleItem;
  tenantSlug: string;
  eventId: string;
  sponsors: readonly { id: string; name: string }[];
  prepareAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  drawRoundAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
}) {
  const [prepareState, prepareFormAction] = useActionState<RaffleActionState | null, FormData>(
    prepareAction,
    null,
  );
  const [drawState, drawRoundFormAction] = useActionState<RaffleActionState | null, FormData>(
    drawRoundAction,
    null,
  );

  /**
   * Campos CONTROLADOS pelo mesmo motivo do console (armadilha 5/56): o React 19
   * reinicia o formulário ao fim de uma action, e a recusa mais comum daqui — "apure
   * a rodada pendente antes" — apagaria o prêmio que a pessoa acabou de digitar.
   */
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

  /**
   * A rodada pendente ganha botão próprio, EXCETO no sorteio em rascunho: ali o botão
   * principal da linha ("Sortear agora") já apura a rodada preparada, e dois botões
   * para a mesma ação só criariam dúvida sobre qual clicar.
   */
  const drawHere = raffle.status !== 'DRAFT';

  return (
    <div className="space-y-2" data-testid={`raffle-rounds-${raffle.id}`}>
      <p className="text-xs font-medium text-muted-foreground">
        Rodadas ({raffle.rounds.length}) — cada uma com o próprio prêmio, o próprio compromisso de
        semente e o próprio resultado
      </p>

      <ol className="space-y-1">
        {raffle.rounds.map((round) => (
          <li
            key={round.id}
            data-testid={`raffle-round-${round.roundNumber}`}
            data-round-state={round.state}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface-low px-2 py-1 text-xs"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="code-data text-muted-foreground">{round.roundNumber}</span>
              <span className="truncate font-medium">{round.prizeTitle ?? 'Prêmio surpresa'}</span>
              {round.sponsorName ? (
                <span className="truncate text-muted-foreground">por {round.sponsorName}</span>
              ) : null}
              <span className="rounded-full border border-border px-1.5 label-caps uppercase text-muted-foreground">
                {round.state === 'DRAWN' ? 'apurada' : 'aguardando apuração'}
              </span>
            </span>

            <span className="flex shrink-0 flex-wrap items-center gap-2 text-muted-foreground">
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
          </li>
        ))}
      </ol>

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

      {/**
       * A próxima rodada NÃO pode ser preparada enquanto houver uma no ar: dois
       * compromissos publicados sem dizer qual está valendo deixariam o telão sem
       * saber o que anunciar (é a guarda do domínio, e a tela mostra o motivo em vez
       * de esconder o formulário sem explicação).
       */}
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

          <RoundButton
            label="Preparar próxima rodada"
            testId={`prepare-round-${raffle.id}`}
          />
        </form>
      ) : null}
    </div>
  );
}

function RaffleRow({
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
}: {
  raffle: RaffleItem;
  tenantSlug: string;
  eventId: string;
  sponsors: readonly { id: string; name: string }[];
  drawAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  prepareAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  drawRoundAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  cancelAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  deliverAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  reverseAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
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
  const [reverseState, reverseFormAction] = useActionState<RaffleActionState | null, FormData>(
    reverseAction,
    null,
  );
  const [visibilityState, visibilityFormAction] = useActionState<RaffleActionState | null, FormData>(
    visibilityAction,
    null,
  );
  const [showCancel, setShowCancel] = useState(false);
  const [delivering, setDelivering] = useState<string | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);

  const state = cancelState;
  const winners = raffle.winners.filter((winner) => winner.kind === 'WINNER');
  const alternates = raffle.winners.filter((winner) => winner.kind === 'ALTERNATE');
  const delivered = raffle.winners.filter((winner) => winner.deliveredAtLabel).length;

  /**
   * Quantas rodadas o sorteio teve importa para a LEITURA da linha: com uma só, dizer
   * "rodada 1" em cima de cada posição é ruído; com duas ou mais, é a informação que
   * diz QUAL prêmio aquela pessoa levou.
   */
  const multiRound = raffle.rounds.length > 1;
  const roundPrize = (roundNumber: number): string | null =>
    raffle.rounds.find((round) => round.roundNumber === roundNumber)?.prizeTitle ?? null;

  /** Uma linha da lista (titular ou suplente), com o registro de entrega. */
  const renderPosition = (winner: RaffleItem['winners'][number]) => (
    <li
      key={winner.id}
      data-testid={`position-${winner.id}`}
      data-kind={winner.kind}
      data-round={winner.roundNumber}
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
        {multiRound ? (
          <span
            className="rounded-full border border-border px-1.5 label-caps uppercase text-muted-foreground"
            data-testid={`round-badge-${winner.id}`}
            title={roundPrize(winner.roundNumber) ?? undefined}
          >
            {roundPrize(winner.roundNumber) ?? `rodada ${winner.roundNumber}`}
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

            {/**
             * ── DESFAZER A ENTREGA (FASE 22, item G8) ────────────────────────────
             * O recibo é imutável por decisão, mas o ERRO de balcão acontece: o nome
             * parecido, a linha fora de ordem. Antes, corrigir exigia SQL. Aqui a
             * correção pede o MOTIVO antes de acontecer — é ele que entra na trilha
             * junto com a entrega desfeita, e é ele que impede o clique reflexo de
             * apagar um fato consumado.
             */}
            {raffle.status === 'DRAWN' ? (
              reversing === winner.id ? (
                <form action={reverseFormAction} className="flex items-center gap-1">
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="raffleId" value={raffle.id} />
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
                    onClick={() => setReversing(null)}
                    className="px-1 text-xs text-muted-foreground hover:underline"
                  >
                    cancelar
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setReversing(winner.id)}
                  data-testid={`reverse-delivery-${winner.id}`}
                  className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  Desfazer
                </button>
              )
            ) : null}
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

      {/**
       * ── RODADAS (FASE 30) ──────────────────────────────────────────────────────
       * A lista fica ABERTA (e não dentro de um `<details>`): é aqui que a operação
       * prepara o próximo momento e apura o que está pendente — esconder o controle
       * atrás de um clique extra no meio do evento não se paga.
       */}
      <RoundsSection
        raffle={raffle}
        tenantSlug={tenantSlug}
        eventId={eventId}
        sponsors={sponsors}
        prepareAction={prepareAction}
        drawRoundAction={drawRoundAction}
      />

      {/**
       * ── O COMPROMISSO APARECE DESDE A CRIAÇÃO (FASE 29) ────────────────────────
       * Antes, este bloco só existia quando havia `resultHash` — ou seja, o
       * compromisso da semente ficava invisível até a apuração terminar. Um
       * compromisso que ninguém viu ANTES não prova nada: o público (e o próprio
       * organizador) precisa poder registrar o número enquanto o sorteio ainda é
       * rascunho. Foi o telão que expôs a lacuna; a tela do administrador não podia
       * continuar contando a história pela metade.
       */}
      {raffle.seedCommitment ? (
        <p
          className="break-all code-data text-muted-foreground"
          data-testid={`seed-proof-${raffle.id}`}
        >
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
  drawAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  prepareAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  drawRoundAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  cancelAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  deliverAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  reverseAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  visibilityAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  /** Filtro ativo, para a tela dizer o que está sendo mostrado (FASE 22, item G9). */
  filter: { status: string; from: string; to: string; active: boolean; description: string };
  /** O filtro serializado, para a paginação não perdê-lo. */
  filterQuery: string;
}) {
  const basePath = `/t/${tenantSlug}/administracao/eventos/${eventId}/sorteios`;

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  BUSCA NO HISTÓRICO (FASE 22, item G9)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Um formulário GET, e não uma Server Action: o filtro é ESTADO DO ENDEREÇO. Quem
   *  filtra consegue compartilhar o link, voltar pelo navegador e recarregar sem
   *  perder o recorte — coisas que uma action com estado em memória não dariam. A
   *  conversão das datas é do servidor, no fuso da instituição.
   */
  const filterForm = (
    <form method="get" action={basePath} className="flex flex-wrap items-end gap-2" data-testid="raffle-filter">
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
        <a href={basePath} data-testid="raffle-filter-clear" className="px-1 py-1 text-xs underline">
          limpar
        </a>
      ) : null}
    </form>
  );

  if (raffles.length === 0) {
    return (
      <div className="space-y-3">
        {filterForm}

        <p
          className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
          data-testid="raffles-empty"
        >
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
                href={`${basePath}?pagina=${page - 1}${filterQuery}`}
                data-testid="raffle-page-prev"
                className="rounded-md border border-border px-2 py-1 hover:bg-muted"
              >
                Anteriores
              </a>
            ) : null}
            {page < totalPages ? (
              <a
                href={`${basePath}?pagina=${page + 1}${filterQuery}`}
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
