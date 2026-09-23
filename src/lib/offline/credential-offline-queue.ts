/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FILA LOCAL DE LEITURAS DE CRACHÁ EM INDEXEDDB (FASE 35 · DÍVIDA E40)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE INDEXEDDB, E NÃO LOCALSTORAGE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No pico de credenciamento de um evento grande com queda prolongada de rede,
 *  centenas de leituras acumulam. O `localStorage` tem limite de ~5 MB por origem,
 *  é síncrono (bloqueia a thread do render a cada escrita) e não tem índices. O
 *  IndexedDB é assíncrono, suporta milhares de registros estruturados e permite
 *  índices por (tenant, evento, status), garantindo leitura rápida sem travar
 *  a câmera do leitor de QR Code.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTRUTURA DE IDEMPOTÊNCIA E ORDENAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada leitura grava o instante real da leitura (`readAt`). Ao sincronizar com o
 *  servidor, a esteira envia o carimbo de data/hora original e a chave única
 *  `idempotencyKey = ${eventId}:${code}:${contextKind}:${activityId ?? 'root'}:${readAt}`.
 *  Se a mesma leitura for reenviada em caso de falha de resposta, o servidor
 *  reconhece a chave salva em `Attendance.qrNonce` e não duplica a presença.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface OfflineScanInput {
  id?: string;
  tenantSlug: string;
  eventId: string;
  contextKind: 'EVENT' | 'ACTIVITY';
  activityId?: string | null;
  code: string;
  mode: 'IN' | 'OUT' | 'TOGGLE';
  readAt?: string;
  idempotencyKey?: string;
}

export interface OfflineScanRecord {
  id: string;
  tenantSlug: string;
  eventId: string;
  contextKind: 'EVENT' | 'ACTIVITY';
  activityId: string | null;
  code: string;
  mode: 'IN' | 'OUT' | 'TOGGLE';
  readAt: string;
  idempotencyKey: string;
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  attempts: number;
  lastAttemptAt?: string;
  syncedAt?: string;
  error?: string;
  outcome?: Record<string, unknown>;
}

export interface QueueSummary {
  total: number;
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
}

const DB_NAME = 'eventflow_offline_v1';
const DB_VERSION = 1;
const STORE_NAME = 'credential_scans';

/** Gera UUID v4 seguro no navegador ou fallback simples. */
export function generateClientUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Calcula a chave de idempotência de uma leitura. */
export function buildIdempotencyKey(input: {
  eventId: string;
  code: string;
  contextKind: 'EVENT' | 'ACTIVITY';
  activityId?: string | null;
  readAt: string;
}): string {
  const normCode = input.code.trim().toUpperCase();
  const context = input.contextKind === 'ACTIVITY' ? (input.activityId ?? 'unknown') : 'event';
  return `${input.eventId}:${normCode}:${context}:${input.readAt}`;
}

/** Confere se o ambiente suporta IndexedDB. */
export function isIndexedDbSupported(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

/** Abre ou atualiza o banco de dados IndexedDB. */
export function openCredentialDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDbSupported()) {
    return Promise.reject(new Error('IndexedDB não suportado neste ambiente.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('tenant_event_status', ['tenantSlug', 'eventId', 'status'], { unique: false });
        store.createIndex('tenant_event', ['tenantSlug', 'eventId'], { unique: false });
        store.createIndex('readAt', 'readAt', { unique: false });
        store.createIndex('idempotencyKey', 'idempotencyKey', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao abrir o IndexedDB.'));
  });
}

/** Enfileira uma leitura para posterior sincronização. */
export async function enqueueOfflineScan(input: OfflineScanInput): Promise<OfflineScanRecord> {
  const db = await openCredentialDatabase();

  const nowIso = input.readAt ?? new Date().toISOString();
  const id = input.id ?? generateClientUuid();
  const idempotencyKey =
    input.idempotencyKey ??
    buildIdempotencyKey({
      eventId: input.eventId,
      code: input.code,
      contextKind: input.contextKind,
      activityId: input.activityId ?? null,
      readAt: nowIso,
    });

  const record: OfflineScanRecord = {
    id,
    tenantSlug: input.tenantSlug,
    eventId: input.eventId,
    contextKind: input.contextKind,
    activityId: input.activityId ?? null,
    code: input.code.trim().toUpperCase(),
    mode: input.mode,
    readAt: nowIso,
    idempotencyKey,
    status: 'PENDING',
    attempts: 0,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);

    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error ?? new Error('Falha ao enfileirar leitura offline.'));
  });
}

/** Lista leituras pendentes ordenadas pelo instante original da leitura (`readAt` asc). */
export async function listPendingScans(tenantSlug: string, eventId: string): Promise<OfflineScanRecord[]> {
  const db = await openCredentialDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('tenant_event');
    const req = index.getAll(IDBKeyRange.only([tenantSlug, eventId]));

    req.onsuccess = () => {
      const records = (req.result as OfflineScanRecord[]).filter(
        (r) => r.status === 'PENDING' || r.status === 'SYNCING',
      );
      // Ordena cronologicamente: a leitura mais antiga sincroniza primeiro
      records.sort((a, b) => a.readAt.localeCompare(b.readAt));
      resolve(records);
    };
    req.onerror = () => reject(req.error ?? new Error('Falha ao listar leituras pendentes.'));
  });
}

/** Retorna o sumário de contagens da fila local. */
export async function getOfflineQueueSummary(tenantSlug: string, eventId: string): Promise<QueueSummary> {
  const db = await openCredentialDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('tenant_event');
    const req = index.getAll(IDBKeyRange.only([tenantSlug, eventId]));

    req.onsuccess = () => {
      const records = req.result as OfflineScanRecord[];
      const summary: QueueSummary = {
        total: records.length,
        pending: 0,
        syncing: 0,
        synced: 0,
        failed: 0,
      };

      for (const r of records) {
        if (r.status === 'PENDING') summary.pending += 1;
        else if (r.status === 'SYNCING') summary.syncing += 1;
        else if (r.status === 'SYNCED') summary.synced += 1;
        else if (r.status === 'FAILED') summary.failed += 1;
      }

      resolve(summary);
    };
    req.onerror = () => reject(req.error ?? new Error('Falha ao calcular sumário da fila offline.'));
  });
}

/** Atualiza o estado de sincronização de uma leitura. */
export async function markScanStatus(
  id: string,
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED',
  extra?: { error?: string; outcome?: Record<string, unknown> },
): Promise<void> {
  const db = await openCredentialDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const record = getReq.result as OfflineScanRecord | undefined;
      if (!record) {
        resolve();
        return;
      }

      record.status = status;
      record.attempts += 1;
      record.lastAttemptAt = new Date().toISOString();

      if (status === 'SYNCED') {
        record.syncedAt = new Date().toISOString();
        if (extra?.outcome) record.outcome = extra.outcome;
        delete record.error;
      } else if (status === 'FAILED') {
        if (extra?.error) record.error = extra.error;
      }

      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error ?? new Error('Falha ao atualizar registro de leitura.'));
    };

    getReq.onerror = () => reject(getReq.error ?? new Error('Falha ao buscar leitura offline.'));
  });
}

/** Limpa leituras já sincronizadas mais antigas que N dias (padrão: 3 dias). */
export async function pruneSyncedScans(olderThanDays = 3): Promise<number> {
  const db = await openCredentialDatabase();
  const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    let count = 0;

    req.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor) {
        resolve(count);
        return;
      }

      const val = cursor.value as OfflineScanRecord;
      if (val.status === 'SYNCED' && val.syncedAt && val.syncedAt < threshold) {
        cursor.delete();
        count += 1;
      }
      cursor.continue();
    };

    req.onerror = () => reject(req.error ?? new Error('Falha ao limpar leituras sincronizadas.'));
  });
}
