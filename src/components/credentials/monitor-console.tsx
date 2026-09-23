'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  ScanLine,
  TriangleAlert,
  UserCheck,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';

import {
  syncOfflinePresencesAction,
  type CredentialActionState,
} from '@/app/actions/credential-actions';
import { QrCameraReader } from '@/components/credentials/qr-camera-reader';
import { describeAttendanceContext } from '@/domain/events/credential-rules';
import { useOfflineQueue } from '@/components/credentials/use-offline-queue';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MODO MONITOR — o balcão do credenciamento (FASE 31 · OFFLINE-FIRST NA FASE 35)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE O MONITOR FAZ, NESTA ORDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. escolhe ONDE a leitura vale — a portaria do evento ou uma atividade;
 *    2. escolhe o SENTIDO da leitura — Somente Entrada, Alternado ou Somente Saída
 *       (FASE 35: evita fechamento indevido por bipes duplos na portaria);
 *    3. lê o crachá (câmera, leitor USB ou digitação);
 *    4. vê o NOME e o que aconteceu em letras grandes, inclusive quando a rede cai
 *       (fila persistida em IndexedDB com sincronização idempotente).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface MonitorActivity {
  id: string;
  title: string;
  startsAtIso: string;
  endsAtIso: string;
  roomName: string | null;
  /** A atividade está acontecendo agora (sugestão de contexto). */
  isNow: boolean;
  /** O credenciamento dela está desligado — o monitor precisa saber antes de ler. */
  checkInEnabled: boolean;
}

type Feedback = {
  ok: boolean;
  message: string;
  details: readonly string[];
  data: Record<string, unknown> | undefined;
};

/**
 * Pausa a câmera enquanto a action está em curso.
 */
function ScanGate({ onRead }: { onRead: (code: string) => void }) {
  const { pending } = useFormStatus();

  return <QrCameraReader onRead={onRead} paused={pending} />;
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

  const [contextKind, setContextKind] = useState<'EVENT' | 'ACTIVITY'>(
    nowActivity ? 'ACTIVITY' : 'EVENT',
  );
  const [activityId, setActivityId] = useState(nowActivity?.id ?? activities[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'TOGGLE' | 'IN' | 'OUT'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`eventflow_monitor_mode_${eventId}`);
      if (saved === 'IN' || saved === 'OUT' || saved === 'TOGGLE') {
        return saved;
      }
    }
    return 'TOGGLE';
  });
  const [localFeedback, setLocalFeedback] = useState<Feedback | null>(null);

  const handleModeChange = (newMode: 'TOGGLE' | 'IN' | 'OUT') => {
    setMode(newMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`eventflow_monitor_mode_${eventId}`, newMode);
    }
  };

  // Integração com a Fila Offline (IndexedDB)
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
  const [closeState, closeFormAction] = useActionState<CredentialActionState | null, FormData>(
    closeAction,
    null,
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  /**
   * O painel de resultado prioriza o feedback local mais recente (leitura offline imediata)
   * ou o estado retornado pela action do servidor.
   */
  const feedback: Feedback | null = localFeedback
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
    if (state) {
      inputRef.current?.focus();
    }
  }, [state]);

  const recordLocally = async (val: string, targetMode: 'TOGGLE' | 'IN' | 'OUT') => {
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
    setCode(value);

    // Se estiver sem rede no navegador, salva direto na fila local sem travar o balcão
    if (!isOnline) {
      void recordLocally(value, mode);
      return;
    }

    setLocalFeedback(null);
    requestAnimationFrame(() => {
      formRef.current?.requestSubmit();
    });
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!isOnline) {
      e.preventDefault();
      if (code.trim()) {
        void recordLocally(code, mode);
      }
      return;
    }
    setLocalFeedback(null);
  };

  const contextLabel = describeAttendanceContext({
    kind: contextKind,
    activityId: contextKind === 'ACTIVITY' ? activityId : null,
    activityTitle: activities.find((activity) => activity.id === activityId)?.title ?? null,
  });

  const outcomeAction = typeof feedback?.data?.action === 'string' ? feedback.data.action : null;
  const outcomeName = typeof feedback?.data?.userName === 'string' ? feedback.data.userName : null;
  const outcomeMinutes = typeof feedback?.data?.minutes === 'number' ? feedback.data.minutes : null;

  return (
    <section className="space-y-4" data-testid="monitor-console">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ScanLine className="size-5 text-primary" aria-hidden />
            Modo monitor
          </h2>

          {/* ── Status de Conectividade e Fila Offline (FASE 35) ──────────────── */}
          <div className="flex items-center gap-2">
            <span
              data-testid="monitor-connection-status"
              data-online={isOnline ? 'true' : 'false'}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                !isOnline
                  ? 'border-destructive/40 bg-destructive-soft text-destructive'
                  : isSyncing
                    ? 'border-warning/40 bg-warning-soft text-warning-strong'
                    : 'border-success/40 bg-success-soft text-success-strong'
              }`}
            >
              {!isOnline ? (
                <WifiOff className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <Wifi className="size-3.5 shrink-0" aria-hidden />
              )}
              {!isOnline ? 'Offline' : isSyncing ? 'Sincronizando' : 'Online'}
            </span>

            {summary.pending > 0 ? (
              <span
                data-testid="monitor-pending-count"
                className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-semibold text-warning-strong"
              >
                {summary.pending} pendente(s)
              </span>
            ) : null}

            {summary.pending > 0 && isOnline ? (
              <button
                type="button"
                onClick={() => void syncQueue()}
                disabled={isSyncing}
                data-testid="sync-offline-queue"
                className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
              >
                <RefreshCw className={`size-3 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden />
                Sincronizar
              </button>
            ) : null}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Escolha onde a leitura vale e o sentido da portaria. Suporta operação offline-first contínua mesmo
          com instabilidade de wi-fi ou telefonia móvel.
        </p>
        {lastSyncResult ? (
          <p className="text-xs text-muted-foreground italic">{lastSyncResult}</p>
        ) : null}
      </header>

      {/* ── Contexto ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 rounded-lg border border-border bg-surface-low p-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          Onde esta leitura vale
          <select
            value={contextKind}
            onChange={(event) => setContextKind(event.target.value as 'EVENT' | 'ACTIVITY')}
            aria-label="Contexto da leitura"
            data-testid="monitor-context-kind"
            className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          >
            <option value="EVENT">Portaria do evento — registra a chegada</option>
            <option value="ACTIVITY">Atividade — registra a frequência</option>
          </select>
        </label>

        {contextKind === 'ACTIVITY' ? (
          <label className="space-y-1 text-xs font-medium">
            Atividade
            <select
              value={activityId}
              onChange={(event) => setActivityId(event.target.value)}
              aria-label="Atividade da leitura"
              data-testid="monitor-activity"
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
            >
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.title}
                  {activity.roomName ? ` · ${activity.roomName}` : ''}
                  {activity.isNow ? ' (acontecendo agora)' : ''}
                  {activity.checkInEnabled ? '' : ' · credenciamento desligado'}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <p className="text-xs text-muted-foreground sm:col-span-2" data-testid="monitor-context-label">
          Lendo em: <strong className="font-medium text-foreground">{contextLabel}</strong>
        </p>
      </div>

      {/* ── Controle Estrito de Modos no Balcão (FASE 35 · DÍVIDA E43) ───────── */}
      <div className="space-y-1.5 rounded-lg border border-border bg-surface-low p-3" data-testid="monitor-mode-selector">
        <span className="block text-xs font-medium text-foreground">Sentido da leitura / Modo de operação</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="monitor-mode-in"
            onClick={() => handleModeChange('IN')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold border transition ${
              mode === 'IN'
                ? 'bg-success text-success-foreground border-success shadow-xs'
                : 'border-border bg-background hover:bg-muted text-muted-foreground'
            }`}
          >
            <span className="size-2 rounded-full bg-current" />
            Somente Entrada
          </button>
          <button
            type="button"
            data-testid="monitor-mode-toggle"
            onClick={() => handleModeChange('TOGGLE')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold border transition ${
              mode === 'TOGGLE'
                ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                : 'border-border bg-background hover:bg-muted text-muted-foreground'
            }`}
          >
            <span className="size-2 rounded-full bg-current" />
            Alternado (Entrada / Saída)
          </button>
          <button
            type="button"
            data-testid="monitor-mode-out"
            onClick={() => handleModeChange('OUT')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold border transition ${
              mode === 'OUT'
                ? 'bg-destructive text-destructive-foreground border-destructive shadow-xs'
                : 'border-border bg-background hover:bg-muted text-muted-foreground'
            }`}
          >
            <span className="size-2 rounded-full bg-current" />
            Somente Saída
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {mode === 'IN'
            ? 'Em "Somente Entrada", leituras duplas em rajada avisam que a pessoa já está dentro sem fechar a presença.'
            : mode === 'OUT'
              ? 'Em "Somente Saída", fecha sessões em aberto sem registrar novas entradas.'
              : 'Em "Alternado", o sistema decide sozinho: entra quem está fora, sai quem está dentro.'}
        </p>
      </div>

      {/* ── Leitura ──────────────────────────────────────────────────────────── */}
      <form
        ref={formRef}
        action={formAction}
        onSubmit={handleFormSubmit}
        className="space-y-3"
        data-testid="monitor-form"
      >
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="contextKind" value={contextKind} />
        {contextKind === 'ACTIVITY' ? <input type="hidden" name="activityId" value={activityId} /> : null}
        <input type="hidden" name="mode" value={mode} />

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-medium">
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
              className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 code-data text-base"
            />
          </label>

          <SubmitButton label="Registrar" />
        </div>

        <ScanGate onRead={submitCode} />

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">Atalho rápido para fechar sessão:</span>
          <button
            type="button"
            onClick={() => {
              handleModeChange('OUT');
              requestAnimationFrame(() => formRef.current?.requestSubmit());
            }}
            data-testid="monitor-checkout"
            className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
          >
            Registrar saída imediata
          </button>
        </div>
      </form>

      {/* ── Resultado ────────────────────────────────────────────────────────── */}
      {feedback ? (
        <div
          role={feedback.ok ? 'status' : 'alert'}
          data-testid="monitor-feedback"
          data-action={outcomeAction ?? (feedback.ok ? 'OK' : 'ERRO')}
          className={`space-y-1 rounded-xl border p-4 ${
            feedback.ok ? 'border-success/40 bg-success-soft' : 'border-destructive/40 bg-destructive-soft'
          }`}
        >
          <p className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {feedback.ok ? (
              outcomeAction === 'CHECKED_OUT' ? (
                <CheckCircle2 className="size-6 text-success-strong" aria-hidden />
              ) : (
                <UserCheck className="size-6 text-success-strong" aria-hidden />
              )
            ) : (
              <XCircle className="size-6 text-destructive" aria-hidden />
            )}
            {outcomeName ?? feedback.message}
          </p>

          <p className="text-sm">{feedback.ok && outcomeName ? feedback.message : feedback.ok ? '' : feedback.message}</p>

          {outcomeMinutes !== null ? (
            <p className="text-sm text-muted-foreground">
              {outcomeMinutes} minuto(s) nesta sessão · total fechado no contexto:{' '}
              {String(feedback.data?.closedMinutes ?? 0)} min
            </p>
          ) : null}

          {feedback.details.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-warning-strong" data-testid="monitor-warnings">
              {feedback.details.map((detail) => (
                <li key={detail} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {detail}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs text-muted-foreground">{eventTitle}</p>
        </div>
      ) : null}

      {/* ── Fechamento das presenças abertas ─────────────────────────────────── */}
      <form action={closeFormAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={eventId} />
        {contextKind === 'ACTIVITY' ? <input type="hidden" name="activityId" value={activityId} /> : null}
        <button
          type="submit"
          data-testid="monitor-close-sessions"
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          Fechar as presenças abertas deste contexto
        </button>
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
