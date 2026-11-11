'use client';

import { useActionState, useEffect, useOptimistic } from 'react';
import { useFormStatus } from 'react-dom';
import { Clock, LogIn, LogOut, ShieldCheck, TriangleAlert } from 'lucide-react';

import type { AttendanceActionState } from '@/app/actions/attendance-actions';
import { celebrate } from '@/components/gamification/celebration';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Fila de credenciamento — operação de balcão (FASE 99 · ADR-418 / FASE 101 · ADR-424)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  MICRO-INTERAÇÃO OTIMISTA ESTÁVEL E TRATAMENTO RESILIENTE DE ERROS (REACT 19)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No balcão com fila e centenas de pessoas chegando, qualquer delay de 300ms a
 *  1s enquanto a Server Action viaja causa incerteza e cliques repetidos.
 *
 *  Na FASE 101 (ADR-424):
 *    • O useOptimistic é executado dentro de uma transição assíncrona real (startTransition
 *      com await na Server Action), garantindo que o estado "Credenciando agora…"
 *      permaneça visível durante toda a viagem de rede e banco, em vez de reverter
 *      instantaneamente em 0ms;
 *    • O botão de ação é desabilitado tanto por useFormStatus().pending quanto por
 *      isPending da transição, impedindo cliques duplos que poderiam enviar uma
 *      saída acidental após uma entrada;
 *    • Caso a Server Action falhe (ex.: atividade lotada, QR expirado), o estado
 *      reverte de forma segura e a mensagem com role="alert" e text-destructive
 *      permanece visível na linha para intervenção do operador;
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

function ActionButton({ mode, isPending }: { mode: 'in' | 'out'; isPending: boolean }) {
  const { pending } = useFormStatus();
  const busy = pending || isPending;

  return (
    <button
      type="submit"
      disabled={busy}
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
      {busy ? 'Registrando…' : mode === 'in' ? 'Credenciar' : 'Registrar saída'}
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
  const [optimisticInside, setOptimisticInside] = useOptimistic(
    entry.isInside,
    (_current, next: boolean) => next,
  );

  const [state, formAction, isPending] = useActionState(
    async (prevState: AttendanceActionState | null, formData: FormData) => {
      const mode = formData.get('mode');
      const nextInside = !optimisticInside;
      setOptimisticInside(nextInside);
      const action = mode === 'out' ? checkOutAction : checkInAction;
      return action(prevState, formData);
    },
    null,
  );

  useEffect(() => {
    if (!state?.ok) return;
    const cards = Array.isArray(state.data?.cards) ? state.data.cards.length : 0;
    const xp = Number(state.data?.xpAwarded ?? 0);
    if (cards > 0 || xp >= 150) celebrate({ intensity: 'medium' });
  }, [state]);

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
        <form action={formAction}>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="registrationId" value={entry.registrationId} />
          <input type="hidden" name="mode" value={optimisticInside ? 'out' : 'in'} />
          <ActionButton mode={optimisticInside ? 'out' : 'in'} isPending={isPending} />
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
