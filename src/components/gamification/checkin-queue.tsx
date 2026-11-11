'use client';

import { useEffect, useActionState, useOptimistic } from 'react';
import { useFormStatus } from 'react-dom';
import { Clock, LogIn, LogOut, ShieldCheck, TriangleAlert } from 'lucide-react';

import type { AttendanceActionState } from '@/app/actions/attendance-actions';
import { celebrate } from '@/components/gamification/celebration';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Fila de credenciamento — operação de balcão (FASE 99 · ADR-418 / FASE 100 · ADR-421)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  MICRO-INTERAÇÃO OTIMISTA COM TRATAMENTO UNIFICADO DE ERROS (REACT 19)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No balcão com fila e centenas de pessoas chegando, qualquer delay de 300ms a
 *  1s enquanto a Server Action viaja causa incerteza e cliques repetidos.
 *
 *  Na FASE 100 (ADR-421):
 *    • Unificação do despachante em um único `useActionState`, garantindo que
 *      respostas de erro (ex.: atividade lotada, QR expirado) persistam no
 *      estado do componente e sejam exibidas visualmente ao operador (role="alert"),
 *      mesmo após o rollback otimista de `useOptimistic`;
 *    • Suporte a `prefers-reduced-motion` no indicador de pulso;
 *    • Estado vazio alinhado aos padrões visuais de card da instituição.
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
  const [state, formAction] = useActionState<AttendanceActionState | null, FormData>(
    async (prev, formData) => {
      const mode = formData.get('mode');
      if (mode === 'out') {
        return checkOutAction(prev, formData);
      }
      return checkInAction(prev, formData);
    },
    null,
  );

  const [optimisticInside, setOptimisticInside] = useOptimistic(
    entry.isInside,
    (_current, next: boolean) => next,
  );

  useEffect(() => {
    if (!state?.ok) return;
    const cards = Array.isArray(state.data?.cards) ? state.data.cards.length : 0;
    const xp = Number(state.data?.xpAwarded ?? 0);
    if (cards > 0 || xp >= 150) celebrate({ intensity: 'medium' });
  }, [state]);

  async function handleFormAction(formData: FormData) {
    const nextInside = !optimisticInside;
    setOptimisticInside(nextInside);
    await formAction(formData);
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
          <p className="flex items-center gap-1 text-xs text-primary animate-pulse motion-reduce:animate-none">
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
          <input type="hidden" name="mode" value={optimisticInside ? 'out' : 'in'} />
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
      <div
        className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground"
        data-testid="queue-empty"
      >
        <p>
          Nenhuma inscrição confirmada encontrada. Ajuste a busca ou verifique se o evento tem
          inscrições confirmadas.
        </p>
      </div>
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
