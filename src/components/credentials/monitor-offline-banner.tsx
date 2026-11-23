'use client';

import { RefreshCw, ScanLine, Wifi, WifiOff } from 'lucide-react';

/** Cabeçalho de status online/offline e sincronização da fila IndexedDB do monitor. */
export function MonitorOfflineBanner({
  isOnline,
  isSyncing,
  pendingCount,
  lastSyncResult,
  onSyncQueue,
}: {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncResult: string | null;
  onSyncQueue: () => void;
}) {
  return (
    <header className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <ScanLine className="size-5 text-primary" aria-hidden />
          Modo monitor
        </h2>

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
            {!isOnline ? <WifiOff className="size-3.5 shrink-0" aria-hidden /> : <Wifi className="size-3.5 shrink-0" aria-hidden />}
            {!isOnline ? 'Offline' : isSyncing ? 'Sincronizando' : 'Online'}
          </span>

          {pendingCount > 0 ? (
            <span
              data-testid="monitor-pending-count"
              className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-semibold text-warning-strong"
            >
              {pendingCount} pendente(s)
            </span>
          ) : null}

          {pendingCount > 0 && isOnline ? (
            <button
              type="button"
              onClick={onSyncQueue}
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
        Escolha onde a leitura vale e o sentido da portaria. Suporta operação offline-first contínua mesmo com
        instabilidade de wi-fi ou telefonia móvel.
      </p>
      {lastSyncResult ? <p className="text-xs text-muted-foreground italic">{lastSyncResult}</p> : null}
    </header>
  );
}
