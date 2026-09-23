'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  enqueueOfflineScan,
  getOfflineQueueSummary,
  listPendingScans,
  markScanStatus,
  pruneSyncedScans,
  type OfflineScanInput,
  type OfflineScanRecord,
  type QueueSummary,
} from '@/lib/offline/credential-offline-queue';
import type { SyncScanResult } from '@/app/actions/credential-actions';

export interface UseOfflineQueueOptions {
  tenantSlug: string;
  eventId: string;
  onSyncBatch?: (scans: OfflineScanRecord[]) => Promise<SyncScanResult[]>;
  autoSyncIntervalMs?: number;
}

export function useOfflineQueue({
  tenantSlug,
  eventId,
  onSyncBatch,
  autoSyncIntervalMs = 5000,
}: UseOfflineQueueOptions) {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [summary, setSummary] = useState<QueueSummary>({
    total: 0,
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
  });
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncResult, setLastSyncResult] = useState<string | null>(null);

  const syncingRef = useRef(false);

  // 1. Conexão do navegador
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 2. Atualiza sumário da fila
  const refreshSummary = useCallback(async () => {
    try {
      const s = await getOfflineQueueSummary(tenantSlug, eventId);
      setSummary(s);
    } catch {
      // IndexedDB pode não estar pronto
    }
  }, [tenantSlug, eventId]);

  useEffect(() => {
    let cancelled = false;
    getOfflineQueueSummary(tenantSlug, eventId)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {});

    void pruneSyncedScans().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [tenantSlug, eventId]);

  // 3. Sincronização
  const syncQueue = useCallback(async () => {
    if (!onSyncBatch || syncingRef.current || !navigator.onLine) return;

    try {
      syncingRef.current = true;
      setIsSyncing(true);

      const pending = await listPendingScans(tenantSlug, eventId);
      if (pending.length === 0) {
        syncingRef.current = false;
        setIsSyncing(false);
        void refreshSummary();
        return;
      }

      // Marca em syncing
      for (const item of pending) {
        await markScanStatus(item.id, 'SYNCING');
      }
      void refreshSummary();

      const results = await onSyncBatch(pending);

      for (const res of results) {
        if (res.ok) {
          await markScanStatus(res.id, 'SYNCED', { outcome: res.data });
        } else {
          await markScanStatus(res.id, 'FAILED', { error: res.message });
        }
      }

      setLastSyncResult(
        `${results.filter((r) => r.ok).length} sincronizada(s), ${results.filter((r) => !r.ok).length} falha(s).`,
      );
    } catch (err) {
      setLastSyncResult(`Erro ao sincronizar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
      void refreshSummary();
    }
  }, [tenantSlug, eventId, onSyncBatch, refreshSummary]);

  // Auto-sync periódico quando online e com pendências
  useEffect(() => {
    if (!isOnline) return;

    const timer = setInterval(() => {
      if (summary.pending > 0 && !syncingRef.current) {
        void syncQueue();
      }
    }, autoSyncIntervalMs);

    return () => clearInterval(timer);
  }, [isOnline, summary.pending, syncQueue, autoSyncIntervalMs]);

  // Enfileira nova leitura
  const enqueue = useCallback(
    async (scanInput: Omit<OfflineScanInput, 'tenantSlug' | 'eventId'>) => {
      const record = await enqueueOfflineScan({
        ...scanInput,
        tenantSlug,
        eventId,
      });
      void refreshSummary();
      return record;
    },
    [tenantSlug, eventId, refreshSummary],
  );

  return {
    isOnline,
    summary,
    isSyncing,
    lastSyncResult,
    enqueue,
    syncQueue,
    refreshSummary,
  };
}
