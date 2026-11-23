'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, ScanLine } from 'lucide-react';

import {
  syncOfflinePresencesAction,
  type CredentialActionState,
} from '@/app/actions/credential-actions';
import {
  MonitorContextCard,
  MonitorModeSelector,
  type MonitorActivity,
  type MonitorContextKind,
  type MonitorMode,
} from '@/components/credentials/monitor-context-selector';
import { MonitorFeedbackCard, type MonitorFeedback } from '@/components/credentials/monitor-feedback-card';
import { MonitorOfflineBanner } from '@/components/credentials/monitor-offline-banner';
import { QrCameraReader } from '@/components/credentials/qr-camera-reader';
import { useOfflineQueue } from '@/components/credentials/use-offline-queue';
import { ConfirmSubmitButton } from '@/components/ui/dialog';
import { cameraDeviceStorageKey } from '@/domain/events/camera-device-rules';
import { describeAttendanceContext } from '@/domain/events/credential-rules';

export const CHECKIN_CONTEXT_EVENT = 'ef:checkin-context';
export type { MonitorActivity };

function ScanGate({ onRead, storageKey }: { onRead: (code: string) => void; storageKey: string }) {
  const { pending } = useFormStatus();

  return <QrCameraReader onRead={onRead} paused={pending} storageKey={storageKey} />;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="presence-submit"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ScanLine className="size-4" aria-hidden />}
      {pending ? 'Registrando…' : label}
    </button>
  );
}

/**
 * Orquestrador do modo monitor do credenciamento: sincroniza contexto (Portaria × Atividade),
 * sentido da leitura, fila offline em IndexedDB e envio pelo leitor USB/câmera.
 */
export function MonitorConsole({
  tenantSlug,
  eventId,
  eventTitle,
  activities,
  action,
  closeAction,
}: {
  tenantSlug: string;
  eventId: string;
  eventTitle: string;
  activities: readonly MonitorActivity[];
  action: (prev: CredentialActionState | null, formData: FormData) => Promise<CredentialActionState>;
  closeAction: (prev: CredentialActionState | null, formData: FormData) => Promise<CredentialActionState>;
}) {
  const nowActivity = activities.find((activity) => activity.isNow) ?? null;

  const [contextKind, setContextKind] = useState<MonitorContextKind>(nowActivity ? 'ACTIVITY' : 'EVENT');
  const [activityId, setActivityId] = useState(nowActivity?.id ?? activities[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<MonitorMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`eventflow_monitor_mode_${eventId}`);
      if (saved === 'IN' || saved === 'OUT' || saved === 'TOGGLE') return saved;
    }
    return 'TOGGLE';
  });
  const [localFeedback, setLocalFeedback] = useState<MonitorFeedback | null>(null);

  const handleModeChange = (newMode: MonitorMode) => {
    setMode(newMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`eventflow_monitor_mode_${eventId}`, newMode);
    }
  };

  const onSyncBatch = useCallback(
    async (scans: Parameters<typeof syncOfflinePresencesAction>[2]) => {
      return syncOfflinePresencesAction(tenantSlug, eventId, scans);
    },
    [tenantSlug, eventId],
  );

  const { isOnline, summary, isSyncing, lastSyncResult, enqueue, syncQueue } = useOfflineQueue({
    tenantSlug,
    eventId,
    onSyncBatch,
  });

  const [state, formAction] = useActionState<CredentialActionState | null, FormData>(action, null);
  const [closeState, closeFormAction] = useActionState<CredentialActionState | null, FormData>(closeAction, null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const modeInputRef = useRef<HTMLInputElement | null>(null);
  const closeFormRef = useRef<HTMLFormElement | null>(null);
  const scanInFlightRef = useRef(false);

  const feedback: MonitorFeedback | null = localFeedback
    ? localFeedback
    : state
      ? {
          ok: state.ok,
          message: state.message ?? '',
          details: state.details ?? [],
          data: state.data,
        }
      : null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(CHECKIN_CONTEXT_EVENT, {
        detail: {
          kind: contextKind,
          activityId: contextKind === 'ACTIVITY' ? activityId || null : null,
        },
      }),
    );
  }, [contextKind, activityId]);

  useEffect(() => {
    if (modeInputRef.current) {
      modeInputRef.current.value = mode;
    }
  }, [mode]);

  useEffect(() => {
    scanInFlightRef.current = false;
    if (state) {
      inputRef.current?.focus();
    }
  }, [state]);

  const recordLocally = async (val: string, targetMode: MonitorMode) => {
    const trimmed = val.trim().toUpperCase();
    if (!trimmed) return;

    const readAt = new Date().toISOString();
    await enqueue({
      code: trimmed,
      mode: targetMode,
      contextKind,
      activityId: contextKind === 'ACTIVITY' ? activityId : null,
      readAt,
    });

    setCode('');
    setLocalFeedback({
      ok: true,
      message: `Leitura guardada localmente no dispositivo (offline).`,
      details: [`Instante: ${new Date(readAt).toLocaleTimeString('pt-BR')}. Será sincronizada assim que a rede retornar.`],
      data: {
        action: targetMode === 'OUT' ? 'CHECKED_OUT' : 'CHECKED_IN',
        userName: trimmed,
        code: trimmed,
      },
    });

    inputRef.current?.focus();
  };

  const submitCode = (value: string) => {
    if (scanInFlightRef.current) return;
    setCode(value);

    if (!isOnline) {
      void recordLocally(value, mode);
      return;
    }

    scanInFlightRef.current = true;
    setLocalFeedback(null);
    requestAnimationFrame(() => {
      if (modeInputRef.current) {
        modeInputRef.current.value = mode;
      }
      formRef.current?.requestSubmit();
    });
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!isOnline) {
      e.preventDefault();
      scanInFlightRef.current = false;
      if (code.trim()) {
        void recordLocally(code, mode);
      }
      return;
    }
    setLocalFeedback(null);
  };

  // Envia saída pontual sem sobrescrever o modo principal salvo no localStorage.
  const handleOneShotCheckout = () => {
    if (!code.trim()) {
      inputRef.current?.focus();
      return;
    }
    if (!isOnline) {
      void recordLocally(code, 'OUT');
      return;
    }
    setLocalFeedback(null);
    if (modeInputRef.current) {
      modeInputRef.current.value = 'OUT';
    }
    formRef.current?.requestSubmit();
    if (modeInputRef.current) {
      modeInputRef.current.value = mode;
    }
    inputRef.current?.focus();
  };

  const contextLabel = describeAttendanceContext({
    kind: contextKind,
    activityId: contextKind === 'ACTIVITY' ? activityId : null,
    activityTitle: activities.find((activity) => activity.id === activityId)?.title ?? null,
  });

  return (
    <section className="space-y-4" data-testid="monitor-console">
      <MonitorOfflineBanner
        isOnline={isOnline}
        isSyncing={isSyncing}
        pendingCount={summary.pending}
        lastSyncResult={lastSyncResult}
        onSyncQueue={() => void syncQueue()}
      />

      <MonitorContextCard
        contextKind={contextKind}
        activityId={activityId}
        activities={activities}
        contextLabel={contextLabel}
        onContextKindChange={setContextKind}
        onActivityChange={setActivityId}
      />

      <MonitorModeSelector mode={mode} onChange={handleModeChange} />

      <form ref={formRef} action={formAction} onSubmit={handleFormSubmit} className="space-y-3" data-testid="monitor-form">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="contextKind" value={contextKind} />
        {contextKind === 'ACTIVITY' ? <input type="hidden" name="activityId" value={activityId} /> : null}
        <input ref={modeInputRef} type="hidden" name="mode" defaultValue={mode} />

        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1 text-xs font-medium">
            Código do crachá
            <input
              ref={inputRef}
              name="code"
              required
              autoFocus
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="CR-XXXX-XXXX"
              aria-label="Código do crachá"
              data-testid="monitor-code"
              className="block w-full min-w-52 rounded-md border border-border bg-background px-3 py-2 code-data text-base"
            />
          </label>

          <SubmitButton label="Registrar" />

          <button
            type="button"
            onClick={handleOneShotCheckout}
            data-testid="monitor-checkout"
            title="Registra uma saída pontual para este código sem trocar o modo ativo"
            className="rounded-md border border-border bg-background px-3 py-2.5 text-xs font-medium transition hover:bg-muted"
          >
            Registrar saída imediata
          </button>
        </div>

        {feedback ? (
          <MonitorFeedbackCard data-testid="monitor-feedback" feedback={feedback} eventTitle={eventTitle} />
        ) : null}

        <ScanGate onRead={submitCode} storageKey={cameraDeviceStorageKey(eventId)} />
      </form>

      <form ref={closeFormRef} action={closeFormAction} className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />
        {contextKind === 'ACTIVITY' ? <input type="hidden" name="activityId" value={activityId} /> : null}
        <ConfirmSubmitButton
          formRef={closeFormRef}
          label="Fechar as presenças abertas deste contexto"
          title="Fechar todas as presenças abertas?"
          description={`Todos os participantes ainda com sessão aberta em "${contextLabel}" receberão o horário de encerramento do contexto.`}
          confirmLabel="Confirmar fechamento"
          tone="danger"
          variant="outline"
          size="sm"
          testId="monitor-close-sessions"
        />
        <noscript>
          <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
            Fechar as presenças abertas deste contexto
          </button>
        </noscript>
        <span className="text-xs text-muted-foreground">
          Quem esqueceu de sair recebe a saída no fim da atividade — o número é o mesmo sempre.
        </span>
      </form>

      {closeState ? (
        <p
          role={closeState.ok ? 'status' : 'alert'}
          data-testid="monitor-close-feedback"
          className={`text-xs ${closeState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {closeState.message}
        </p>
      ) : null}
    </section>
  );
}
