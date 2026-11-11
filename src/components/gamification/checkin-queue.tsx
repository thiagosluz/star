'use client';

import { useEffect, useActionState, useOptimistic } from 'react';
import { useFormStatus } from 'react-dom';
import { Clock, LogIn, LogOut, ShieldCheck, TriangleAlert } from 'lucide-react';

import type { AttendanceActionState } from '@/app/actions/attendance-actions';
import { celebrate } from '@/components/gamification/celebration';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Fila de credenciamento — operação de balcão (FASE 99 · ADR-418)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  MICRO-INTERAÇÃO OTIMISTA (useOptimistic DO REACT 19)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No balcão com fila e centenas de pessoas chegando, qualquer delay de 300ms a
 *  1s enquanto a Server Action viaja causa incerteza e cliques repetidos.
 *
 *  Com `useOptimistic`, o clique em "Credenciar" ou "Registrar saída" atualiza
 *  a linha no milissegundo zero:
 *    • O botão alterna o rótulo de imediato;
 *    • O data-inside reflete a nova situação no DOM;
 *    • Se a Server Action retornar sucesso, a revalidação consolida o dado;
 *    • Se a Server Action falhar (ex.: atividade lotada), a linha reverte
 *      automaticamente ao estado real do banco com mensagem de erro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface QueueEntry {
  registrationId: string;
  userName: string;
  userEmail: string;
  activityTitle: string | null;
  isInside: boolean;
  checkedInAtLabel: string | null;
}

function ActionButton({ mode }: { mode: 'in' | 'out' }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={mode === 'in' ? 'checkin-button' : 'checkout-button'}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
        mode === 'in'
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : 'border border-border hover:bg-muted'
      }`}
    >
      {mode === 'in' ? (
        <LogIn className="size-3.5" aria-hidden />
      ) : (
        <LogOut className="size-3.5" aria-hidden />
      )}
      {pending ? 'Registrando…' : mode === 'in' ? 'Credenciar' : 'Registrar saída'}
    </button>
  );
}

function QueueRow({
  entry,
  tenantSlug,
  checkInAction,
  checkOutAction,
}: {
  entry: QueueEntry;
  tenantSlug: string;
  checkInAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
  checkOutAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
}) {
  const [inState, inAction] = useActionState<AttendanceActionState | null, FormData>(checkInAction, null);
  const [outState, outAction] = useActionState<AttendanceActionState | null, FormData>(checkOutAction, null);

  const [optimisticInside, setOptimisticInside] = useOptimistic(
    entry.isInside,
    (_current, next: boolean) => next,
  );

  const state = optimisticInside ? inState : outState;

  useEffect(() => {
    if (!state?.ok) return;
    const cards = Array.isArray(state.data?.cards) ? state.data.cards.length : 0;
    const xp = Number(state.data?.xpAwarded ?? 0);
    if (cards > 0 || xp >= 150) celebrate({ intensity: 'medium' });
  }, [state]);

  async function handleFormAction(formData: FormData) {
    const nextInside = !optimisticInside;
    setOptimisticInside(nextInside);
    if (optimisticInside) {
      await outAction(formData);
    } else {
      await inAction(formData);
    }
  }

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
      data-testid={`queue-${entry.registrationId}`}
      data-inside={optimisticInside ? 'true' : 'false'}
    >
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium">{entry.userName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {entry.userEmail}
          {entry.activityTitle ? ` · ${entry.activityTitle}` : ' · evento'}
        </p>
        {optimisticInside && !entry.isInside ? (
          <p className="flex items-center gap-1 text-xs text-primary animate-pulse">
            <ShieldCheck className="size-3" aria-hidden />
            Credenciando agora…
          </p>
        ) : entry.checkedInAtLabel && optimisticInside ? (
          <p className="flex items-center gap-1 text-xs text-success-strong">
            <ShieldCheck className="size-3" aria-hidden />
            Entrada registrada às {entry.checkedInAtLabel}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <form action={handleFormAction}>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="registrationId" value={entry.registrationId} />
          <ActionButton mode={optimisticInside ? 'out' : 'in'} />
        </form>
      </div>

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={`w-full text-xs ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
          data-testid={`checkin-feedback-${entry.registrationId}`}
        >
          {state.ok ? (
            <span className="flex items-center gap-1.5">
              <Clock className="size-3" aria-hidden />
              {state.message}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <TriangleAlert className="size-3" aria-hidden />
              {state.message}
            </span>
          )}
        </p>
      ) : null}
    </li>
  );
}

export function CheckinQueue({
  entries,
  tenantSlug,
  checkInAction,
  checkOutAction,
}: {
  entries: readonly QueueEntry[];
  tenantSlug: string;
  checkInAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
  checkOutAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
}) {
  if (entries.length === 0) {
    return (
      <p
        className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
        data-testid="queue-empty"
      >
        Nenhuma inscrição confirmada encontrada. Ajuste a busca ou verifique se o evento tem
        inscrições confirmadas.
      </p>
    );
  }

  return (
    <ul className="space-y-2" data-testid="checkin-queue">
      {entries.map((entry) => (
        <QueueRow
          key={entry.registrationId}
          entry={entry}
          tenantSlug={tenantSlug}
          checkInAction={checkInAction}
          checkOutAction={checkOutAction}
        />
      ))}
    </ul>
  );
}
