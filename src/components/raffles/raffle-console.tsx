'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Dices, Eye, Loader2, Sparkles, Trophy, UserCheck, Users } from 'lucide-react';

import type { RaffleActionState } from '@/app/actions/raffle-actions';
import { celebrate } from '@/components/gamification/celebration';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Console de sorteio
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O FLUXO EM DOIS PASSOS, E POR QUE ELE É ASSIM
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. CONFERIR  → mostra quem é elegível e com quantos minutos
 *      2. SORTEAR   → executa e revela, um a um
 *
 *  O passo 1 não é enfeite: descobrir no palco que a lista estava errada (o piso
 *  de minutos alto demais, a data trocada, o credenciamento incompleto) não tem
 *  volta — o resultado já foi anunciado. Conferir antes é a única defesa.
 *
 *  A REVELAÇÃO É ESCALONADA e usa a preferência de movimento do sistema: quem
 *  pediu `prefers-reduced-motion` vê a lista completa de uma vez, sem suspense.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

interface EligibleEntry {
  userId: string;
  userName: string;
  minutes: number;
}

interface WinnerEntry {
  position: number;
  userId: string;
  userName: string;
  minutes: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function SubmitButton({
  label,
  pendingLabel,
  testId,
  icon,
  variant = 'primary',
}: {
  label: string;
  pendingLabel: string;
  testId: string;
  icon: React.ReactNode;
  variant?: 'primary' | 'outline';
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={testId}
      className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-60 ${
        variant === 'primary'
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : 'border border-border hover:bg-muted'
      }`}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {pending ? pendingLabel : label}
    </button>
  );
}

/** Revelação escalonada dos vencedores. */
function WinnerReveal({ winners }: { winners: readonly WinnerEntry[] }) {
  const reduced = prefersReducedMotion();

  /**
   * O estado inicial já considera a preferência de movimento: quem pediu
   * `prefers-reduced-motion` vê a lista completa de imediato, sem suspense.
   *
   * A animação é disparada por TIMERS (assíncronos), e não por `setState` síncrono
   * dentro do efeito — o React Compiler recusa o segundo padrão, e o motivo é
   * bom: setState síncrono em efeito provoca render em cascata.
   *
   * Um novo sorteio REMONTA o componente (a página usa `key` com o hash do
   * resultado), então não é preciso zerar o contador aqui.
   */
  const [revealed, setRevealed] = useState(reduced ? winners.length : 0);

  useEffect(() => {
    if (reduced || winners.length === 0) return;

    const timers = winners.map((_, index) =>
      setTimeout(
        () => {
          setRevealed(index + 1);
          celebrate({ intensity: index + 1 === winners.length ? 'high' : 'low' });
        },
        450 * (index + 1),
      ),
    );

    return () => timers.forEach(clearTimeout);
  }, [reduced, winners]);

  if (winners.length === 0) return null;

  return (
    <ol className="space-y-2" data-testid="winner-reveal">
      {winners.map((winner, index) => (
        <li
          key={winner.userId}
          data-testid={`winner-${winner.position}`}
          data-revealed={index < revealed ? 'true' : 'false'}
          className={`flex items-center justify-between gap-3 rounded-lg border p-3 transition-all duration-500 ${
            index < revealed
              ? 'border-warning/60 bg-warning-soft opacity-100'
              : 'border-border bg-card opacity-20 blur-[2px]'
          }`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning/20 code-data text-sm font-semibold text-warning-strong">
              {winner.position}º
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {index < revealed ? winner.userName : 'Revelando…'}
              </span>
              {index < revealed ? (
                <span className="block text-xs text-muted-foreground">
                  {winner.minutes} min de presença comprovada
                </span>
              ) : null}
            </span>
          </span>

          {index < revealed ? (
            <Trophy className="size-4 shrink-0 text-warning" aria-hidden />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function RaffleConsole({
  tenantSlug,
  eventId,
  activities,
  previewAction,
  drawAction,
}: {
  tenantSlug: string;
  eventId: string;
  activities: readonly { id: string; title: string; startsAt: string }[];
  previewAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
  drawAction: (prev: RaffleActionState | null, formData: FormData) => Promise<RaffleActionState>;
}) {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  ESTADO CONTROLADO — E POR QUE NÃO `defaultValue`
   * ─────────────────────────────────────────────────────────────────────────────
   *  O React 19 RESETA o formulário depois que uma action termina. Com campos não
   *  controlados, clicar em "Conferir elegíveis" apagava tudo o que o organizador
   *  tinha digitado: o piso de minutos voltava a 0 e o sorteio seguinte usava
   *  OUTRA configuração — com resultado diferente do que a prévia mostrou.
   *
   *  O defeito apareceu no E2E (a prévia dizia "1 elegível" e a apuração
   *  considerou 2). Campos controlados mantêm o que foi digitado entre as duas
   *  ações, que é o comportamento que qualquer pessoa espera de um assistente em
   *  dois passos.
   */
  const [form, setForm] = useState({
    title: 'Sorteio de brindes',
    scope: 'EVENT' as 'EVENT' | 'DAY' | 'ACTIVITY',
    activityId: activities[0]?.id ?? '',
    referenceDate: '',
    minAttendanceMinutes: '0',
    winnersCount: '1',
    allowPriorEventWinners: false,
  });

  const update = (patch: Partial<typeof form>) => setForm((previous) => ({ ...previous, ...patch }));

  const [previewState, previewFormAction] = useActionState<RaffleActionState | null, FormData>(
    previewAction,
    null,
  );
  const [drawState, drawFormAction] = useActionState<RaffleActionState | null, FormData>(
    drawAction,
    null,
  );

  const eligible = useMemo(
    () => (Array.isArray(previewState?.data?.eligible) ? (previewState!.data!.eligible as EligibleEntry[]) : []),
    [previewState],
  );

  const rejected = useMemo(
    () =>
      Array.isArray(previewState?.data?.rejected)
        ? (previewState!.data!.rejected as { userId: string; userName: string; reason: string }[])
        : [],
    [previewState],
  );

  const winners = useMemo(
    () => (Array.isArray(drawState?.data?.winners) ? (drawState!.data!.winners as WinnerEntry[]) : []),
    [drawState],
  );

  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-5" data-testid="raffle-console">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Dices className="size-5 text-primary" aria-hidden />
          Novo sorteio
        </h2>
        <p className="text-xs text-muted-foreground">
          Só concorre quem tem <strong>presença real registrada</strong> (credenciamento). Confira os
          elegíveis antes de sortear — depois de apurado, o resultado não muda.
        </p>
      </header>

      {/* ── Configuração ──────────────────────────────────────────────────── */}
      <form className="space-y-4" data-testid="raffle-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-xs font-medium sm:col-span-2">
            Título do sorteio
            <input
              name="title"
              required
              minLength={3}
              value={form.title}
              onChange={(event) => update({ title: event.target.value })}
              aria-label="Título do sorteio"
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
            />
          </label>

          <label className="block space-y-1 text-xs font-medium">
            Universo do sorteio
            <select
              name="scope"
              aria-label="Universo do sorteio"
              value={form.scope}
              onChange={(event) => update({ scope: event.target.value as typeof form.scope })}
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
            >
              <option value="EVENT">Todo o evento (qualquer presença)</option>
              <option value="DAY">Um dia do evento</option>
              <option value="ACTIVITY">Uma atividade específica</option>
            </select>
          </label>

          {form.scope === 'ACTIVITY' ? (
            <label className="block space-y-1 text-xs font-medium">
              Atividade
              <select
                name="activityId"
                required
                aria-label="Atividade"
                value={form.activityId || activities[0]?.id || ''}
                onChange={(event) => update({ activityId: event.target.value })}
                className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
              >
                {activities.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {form.scope === 'DAY' ? (
            <label className="block space-y-1 text-xs font-medium">
              Dia do evento
              <input
                type="date"
                name="referenceDate"
                required
                aria-label="Dia do evento"
                value={form.referenceDate}
                onChange={(event) => update({ referenceDate: event.target.value })}
                className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
              />
            </label>
          ) : null}

          <label className="block space-y-1 text-xs font-medium">
            Piso de minutos assistidos
            <input
              type="number"
              name="minAttendanceMinutes"
              min={0}
              max={1440}
              value={form.minAttendanceMinutes}
              onChange={(event) => update({ minAttendanceMinutes: event.target.value })}
              aria-label="Piso de minutos assistidos"
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
            />
            <span className="block text-xs font-normal text-muted-foreground">
              0 = basta ter presença registrada (quem compareceu sem check-out conta)
            </span>
          </label>

          <label className="block space-y-1 text-xs font-medium">
            Quantos vencedores
            <input
              type="number"
              name="winnersCount"
              min={1}
              max={500}
              value={form.winnersCount}
              onChange={(event) => update({ winnersCount: event.target.value })}
              aria-label="Quantos vencedores"
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
            />
          </label>
        </div>

        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            name="allowPriorEventWinners"
            checked={form.allowPriorEventWinners}
            onChange={(event) => update({ allowPriorEventWinners: event.target.checked })}
            className="mt-0.5 size-3.5"
          />
          <span>
            <span className="font-medium">Permitir quem já ganhou neste evento</span>
            <span className="block text-xs text-muted-foreground">
              Desmarcado, quem já venceu qualquer sorteio deste evento sai do páreo automaticamente.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            formAction={previewFormAction}
            formNoValidate
            data-testid="preview-raffle"
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
          >
            <Eye className="size-4" aria-hidden />
            Conferir elegíveis
          </button>

          <span className="inline-flex">
            <span className="contents">
              <DrawButton formAction={drawFormAction} />
            </span>
          </span>
        </div>
      </form>

      {/* ── Prévia ────────────────────────────────────────────────────────── */}
      {previewState ? (
        <div
          role={previewState.ok ? 'status' : 'alert'}
          data-testid="raffle-preview"
          className={`space-y-3 rounded-lg border p-4 text-sm ${
            previewState.ok ? 'border-border' : 'border-destructive/40'
          }`}
        >
          <p className={previewState.ok ? 'font-medium' : 'font-medium text-destructive'}>
            {previewState.message}
          </p>

          {previewState.details?.length ? (
            <ul className="ml-5 list-disc text-xs text-destructive">
              {previewState.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}

          {eligible.length > 0 ? (
            <>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="size-3.5" aria-hidden />
                {String(previewState.data?.eligibleCount ?? eligible.length)} elegível(is) ·{' '}
                {String(previewState.data?.inspectedAttendances ?? 0)} presença(s) inspecionada(s)
              </p>

              <ul className="max-h-56 space-y-1 overflow-y-auto text-xs" data-testid="eligible-list">
                {eligible.map((entry) => (
                  <li key={entry.userId} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                    <span className="flex items-center gap-1.5 truncate">
                      <UserCheck className="size-3 text-success-strong" aria-hidden />
                      {entry.userName}
                    </span>
                    <span className="code-data text-muted-foreground">{entry.minutes} min</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {rejected.length > 0 ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                {rejected.length} participante(s) fora do sorteio
              </summary>
              <ul className="mt-2 space-y-1" data-testid="rejected-list">
                {rejected.map((entry) => (
                  <li key={entry.userId} className="text-muted-foreground">
                    <strong className="font-medium">{entry.userName}</strong>: {entry.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {/* ── Resultado ─────────────────────────────────────────────────────── */}
      {drawState ? (
        <div
          role={drawState.ok ? 'status' : 'alert'}
          data-testid="raffle-result"
          className={`space-y-3 rounded-lg border p-4 ${
            drawState.ok ? 'border-warning/60 bg-warning-soft' : 'border-destructive/40'
          }`}
        >
          <p className={`flex items-center gap-2 text-sm font-medium ${drawState.ok ? '' : 'text-destructive'}`}>
            <Sparkles className="size-4" aria-hidden />
            {drawState.message}
          </p>

          {drawState.ok && typeof drawState.data?.resultHash === 'string' ? (
            <p className="break-all code-data text-muted-foreground">
              Hash da apuração: {String(drawState.data.resultHash)}
            </p>
          ) : null}

          {/* A `key` remonta a revelação a cada apuração nova (estado zerado). */}
          <WinnerReveal
            key={String(drawState.data?.resultHash ?? 'sem-hash')}
            winners={winners}
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * Botão de sorteio.
 *
 * Fica em um componente próprio porque precisa de `useFormStatus` para o estado
 * "sorteando…" — e o `formAction` é passado para ele, e não para o formulário,
 * permitindo que o MESMO formulário tenha duas ações (conferir e sortear).
 */
function DrawButton({
  formAction,
}: {
  formAction: (formData: FormData) => void;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      formAction={formAction}
      data-testid="draw-raffle"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Dices className="size-4" aria-hidden />
      )}
      {pending ? 'Sorteando…' : 'Sortear agora'}
    </button>
  );
}

/** Botão isolado (usado no histórico para apurar um sorteio já configurado). */
export { SubmitButton };
