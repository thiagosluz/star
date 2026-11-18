'use client';

import { useActionState, useEffect, useOptimistic, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Clock, LogIn, LogOut, MapPin, ShieldCheck, TriangleAlert } from 'lucide-react';

import type { AttendanceActionState } from '@/app/actions/attendance-actions';
import { celebrate } from '@/components/gamification/celebration';
import { CHECKIN_CONTEXT_EVENT } from '@/components/credentials/monitor-console';
import { AppLink } from '@/components/ui/app-link';
import { Badge } from '@/components/ui';
import {
  checkinContextKey,
  describeManualQueueTarget,
  describeParticipantContextEnrollment,
  type CheckinContextSelection,
} from '@/domain/events/checkin-console-rules';
import { clampListIndex, shouldIgnoreListKeyEvent } from '@/hooks/keyboard-navigation';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Fila de credenciamento — operação de balcão (FASE 99 / 101 / 103 / 115)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SINCRONIZAÇÃO DE CONTEXTO (PORTARIA × ATIVIDADE) E NAVEGAÇÃO POR TECLADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • Sincroniza em tempo real com o seletor "Onde esta leitura vale" do Modo
 *      Monitor (`ef:checkin-context`), exibindo o destino exato do clique (Portaria
 *      ou Atividade) e o estado de presença/inscrição do participante naquele alvo;
 *    • `ArrowDown` / `ArrowUp` navegam pelas linhas com rolagem contida (`max-h-[520px]`);
 *    • `Enter` aciona instantaneamente a ação primária da linha ativa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface QueueActivityOption {
  id: string;
  title: string;
  requiresRegistration: boolean;
  isNow: boolean;
}

export interface QueueEntry {
  registrationId: string;
  userName: string;
  userEmail: string;
  activityTitle: string | null;
  isInside: boolean;
  checkedInAtLabel: string | null;
  hasEventRegistration?: boolean;
  registeredActivityIds?: readonly string[];
  activityTitles?: readonly string[];
  registrationIdByContext?: Readonly<Record<string, string>>;
  openSessionsByContext?: Readonly<Record<string, string>>;
}

function ActionButton({
  mode,
  isPending,
  inLabel,
}: {
  mode: 'in' | 'out';
  isPending: boolean;
  inLabel?: string;
}) {
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
      {busy ? 'Registrando…' : mode === 'in' ? (inLabel ?? 'Credenciar') : 'Registrar saída'}
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
  activeContext,
  activeActivity,
  hasContextSync,
}: {
  entry: QueueEntry;
  tenantSlug: string;
  checkInAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
  checkOutAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
  isActive: boolean;
  onSelect: () => void;
  activeContext: CheckinContextSelection;
  activeActivity: QueueActivityOption | null;
  hasContextSync: boolean;
}) {
  const contextKey = checkinContextKey(activeContext);
  const hasContextMap = Boolean(entry.openSessionsByContext);
  const isInsideInContext = hasContextMap
    ? Boolean(entry.openSessionsByContext?.[contextKey])
    : entry.isInside;
  const checkedInAtInContext = hasContextMap
    ? (entry.openSessionsByContext?.[contextKey] ?? null)
    : entry.checkedInAtLabel;
  const targetRegistrationId = entry.registrationIdByContext?.[contextKey] ?? entry.registrationId;

  const [optimisticInside, setOptimisticInside] = useOptimistic(
    isInsideInContext,
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

  const enrollment = describeParticipantContextEnrollment({
    contextKind: activeContext.kind,
    activityId: activeContext.activityId,
    requiresRegistration: activeActivity?.requiresRegistration ?? false,
    hasEventRegistration: entry.hasEventRegistration ?? entry.activityTitle === null,
    registeredActivityIds: entry.registeredActivityIds ?? [],
    activityTitles: entry.activityTitles ?? (entry.activityTitle ? [entry.activityTitle] : []),
    fallbackActivityTitle: entry.activityTitle,
  });

  return (
    <li
      onClick={onSelect}
      className={`space-y-2 rounded-lg border p-3 transition-colors ${
        isActive
          ? 'border-primary bg-card ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'border-border bg-card'
      }`}
      data-testid={`queue-${entry.registrationId}`}
      data-inside={optimisticInside ? 'true' : 'false'}
      data-active-row={isActive ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-medium">{entry.userName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {entry.userEmail}
            {activeContext.kind === 'EVENT'
              ? ` · ${enrollment.label}`
              : activeActivity
                ? ` · Alvo: ${activeActivity.title}`
                : entry.activityTitle
                  ? ` · ${entry.activityTitle}`
                  : ' · evento'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <form action={formAction}>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="registrationId" value={targetRegistrationId} />
            <input type="hidden" name="mode" value={optimisticInside ? 'out' : 'in'} />
            {hasContextSync ? (
              <>
                <input type="hidden" name="contextKind" value={activeContext.kind} />
                {activeContext.kind === 'ACTIVITY' && activeContext.activityId ? (
                  <input type="hidden" name="targetActivityId" value={activeContext.activityId} />
                ) : null}
              </>
            ) : null}
            <ActionButton
              mode={optimisticInside ? 'out' : 'in'}
              isPending={isPending}
              inLabel={activeContext.kind === 'ACTIVITY' ? 'Credenciar na atividade' : 'Credenciar'}
            />
          </form>
        </div>
      </div>

      {(hasContextSync && activeContext.kind === 'ACTIVITY') ||
      (optimisticInside && !isInsideInContext) ||
      (checkedInAtInContext && optimisticInside) ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          {hasContextSync && activeContext.kind === 'ACTIVITY' ? (
            <Badge
              tone={enrollment.tone}
              size="sm"
              className="max-w-full whitespace-normal leading-tight"
              data-testid={`queue-enrollment-${entry.registrationId}`}
            >
              {enrollment.label}
            </Badge>
          ) : null}

          {optimisticInside && !isInsideInContext ? (
            <p className="flex items-center gap-1 text-xs text-primary animate-pulse motion-reduce:animate-none">
              <ShieldCheck className="size-3" aria-hidden />
              Credenciando agora…
            </p>
          ) : checkedInAtInContext && optimisticInside ? (
            <p className="flex items-center gap-1 text-xs text-success-strong">
              <ShieldCheck className="size-3" aria-hidden />
              Entrada registrada às {checkedInAtInContext}
            </p>
          ) : null}
        </div>
      ) : null}

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
  clearSearchHref,
  activities,
}: {
  entries: readonly QueueEntry[];
  tenantSlug: string;
  checkInAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
  checkOutAction: (prev: AttendanceActionState | null, formData: FormData) => Promise<AttendanceActionState>;
  clearSearchHref?: string;
  activities?: readonly QueueActivityOption[];
}) {
  const nowActivity = activities?.find((act) => act.isNow) ?? null;
  const [activeContext, setActiveContext] = useState<CheckinContextSelection>(() => ({
    kind: nowActivity ? 'ACTIVITY' : 'EVENT',
    activityId: nowActivity?.id ?? activities?.[0]?.id ?? null,
  }));

  useEffect(() => {
    function handleContextChange(event: Event) {
      const detail = (event as CustomEvent<CheckinContextSelection>).detail;
      if (!detail) return;
      setActiveContext({
        kind: detail.kind === 'ACTIVITY' ? 'ACTIVITY' : 'EVENT',
        activityId: detail.kind === 'ACTIVITY' ? detail.activityId : null,
      });
    }

    window.addEventListener(CHECKIN_CONTEXT_EVENT, handleContextChange);
    return () => window.removeEventListener(CHECKIN_CONTEXT_EVENT, handleContextChange);
  }, []);

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

  const hasContextSync = Array.isArray(activities);
  const activeActivity =
    activeContext.kind === 'ACTIVITY' && activeContext.activityId
      ? (activities?.find((a) => a.id === activeContext.activityId) ?? null)
      : null;

  const targetDescription = describeManualQueueTarget({
    kind: activeContext.kind,
    activityTitle: activeActivity?.title ?? null,
    requiresRegistration: activeActivity?.requiresRegistration ?? false,
  });

  const contextKey = checkinContextKey(activeContext);

  if (entries.length === 0) {
    return (
      <div
        className="space-y-3 rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground"
        data-testid="queue-empty"
      >
        <p>
          Nenhuma inscrição confirmada encontrada. Ajuste a busca ou verifique se o evento tem
          inscrições confirmadas.
        </p>
        {clearSearchHref ? (
          <div>
            <AppLink
              href={clearSearchHref}
              data-testid="queue-clear-search"
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
            >
              Limpar busca
            </AppLink>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {hasContextSync ? (
        <div
          className="rounded-lg border border-border bg-surface-low px-3 py-2 text-xs"
          data-testid="queue-context-banner"
          data-context-kind={activeContext.kind}
          data-context-activity={activeContext.activityId ?? ''}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <MapPin className="size-3.5 text-primary shrink-0" aria-hidden />
            <span className="text-muted-foreground">Registrando em:</span>
            <strong className="font-semibold text-foreground">{targetDescription.targetTitle}</strong>
            <Badge tone={activeContext.kind === 'ACTIVITY' ? 'info' : 'neutral'}>
              {targetDescription.badgeLabel}
            </Badge>
          </div>
          <p className="mt-0.5 text-muted-foreground">{targetDescription.helperText}</p>
        </div>
      ) : null}

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

      <ul
        className="max-h-[520px] space-y-2 overflow-y-auto pr-1"
        data-testid="checkin-queue"
      >
        {entries.map((entry, index) => (
          <QueueRow
            key={`${entry.registrationId}:${contextKey}`}
            entry={entry}
            tenantSlug={tenantSlug}
            checkInAction={checkInAction}
            checkOutAction={checkOutAction}
            isActive={selectedIndex === index}
            onSelect={() => setSelectedIndex(index)}
            activeContext={activeContext}
            activeActivity={activeActivity}
            hasContextSync={hasContextSync}
          />
        ))}
      </ul>
    </div>
  );
}
