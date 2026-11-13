'use client';

import { useActionState, useEffect, useOptimistic, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Clock, LogIn, LogOut, ShieldCheck, TriangleAlert } from 'lucide-react';

import type { AttendanceActionState } from '@/app/actions/attendance-actions';
import { celebrate } from '@/components/gamification/celebration';
import { clampListIndex, shouldIgnoreListKeyEvent } from '@/hooks/keyboard-navigation';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Fila de credenciamento — operação de balcão (FASE 99 / 101 / FASE 103 · ADR-431)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NAVEGAÇÃO POR TECLADO POWER-USER (ADR-431)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No balcão com fila intensa, operadores usam o teclado para agilidade máxima:
 *    • `ArrowDown` / `ArrowUp` navegam pelas linhas da fila de credenciamento;
 *    • A linha selecionada ganha destaque visual e `data-active-row="true"`;
 *    • `Enter` aciona instantaneamente a ação primária (Credenciar ou Registrar saída)
 *      da linha ativa, sem necessidade de tocar no mouse.
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
  isActive,
  onSelect,
}: {
  entry: QueueEntry;
  tenantSlug: string;
  checkInAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
  checkOutAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
  isActive: boolean;
  onSelect: () => void;
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
      onClick={onSelect}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 transition-colors ${
        isActive
          ? 'border-primary bg-card ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'border-border bg-card'
      }`}
      data-testid={`queue-${entry.registrationId}`}
      data-inside={optimisticInside ? 'true' : 'false'}
      data-active-row={isActive ? 'true' : 'false'}
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
  const [rawSelectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selectedIndex = clampListIndex(rawSelectedIndex, entries.length);

  useEffect(() => {
    if (entries.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreListKeyEvent(e)) {
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const clamped = clampListIndex(prev, entries.length);
          return clamped === null ? 0 : Math.min(clamped + 1, entries.length - 1);
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const clamped = clampListIndex(prev, entries.length);
          return clamped === null ? 0 : Math.max(clamped - 1, 0);
        });
      } else if (e.key === 'Enter' && selectedIndex !== null) {
        const activeEntry = entries[selectedIndex];
        if (activeEntry) {
          const rowEl = document.querySelector(`[data-testid="queue-${activeEntry.registrationId}"]`);
          const buttonEl = rowEl?.querySelector<HTMLButtonElement>('button[type="submit"]');
          if (buttonEl && !buttonEl.disabled) {
            e.preventDefault();
            buttonEl.click();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [entries, selectedIndex]);

  const prevSelectedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (selectedIndex === null || !entries[selectedIndex]) {
      prevSelectedIndexRef.current = selectedIndex;
      return;
    }
    if (prevSelectedIndexRef.current !== selectedIndex) {
      prevSelectedIndexRef.current = selectedIndex;
      const activeRegId = entries[selectedIndex].registrationId;
      const activeRow = document.querySelector<HTMLElement>(`[data-testid="queue-${activeRegId}"]`);
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      activeRow?.scrollIntoView({
        block: 'nearest',
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    }
  }, [selectedIndex, entries]);

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
    <div className="space-y-2">
      <div aria-live="polite" className="sr-only" data-testid="queue-live-region">
        {selectedIndex !== null && entries[selectedIndex]
          ? `Selecionado para credenciamento: ${entries[selectedIndex].userName}`
          : ''}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="queue-keyboard-hint">
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">↓</kbd>
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">↑</kbd>
        {' '}navegar linhas ·{' '}
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">Enter</kbd>
        {' '}credenciar
      </p>

      <ul className="space-y-2" data-testid="checkin-queue">
        {entries.map((entry, index) => (
          <QueueRow
            key={entry.registrationId}
            entry={entry}
            tenantSlug={tenantSlug}
            checkInAction={checkInAction}
            checkOutAction={checkOutAction}
            isActive={selectedIndex === index}
            onSelect={() => setSelectedIndex(index)}
          />
        ))}
      </ul>
    </div>
  );
}
