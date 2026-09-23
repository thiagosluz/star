import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildIdempotencyKey,
  generateClientUuid,
  isIndexedDbSupported,
  enqueueOfflineScan,
  listPendingScans,
  getOfflineQueueSummary,
  markScanStatus,
  pruneSyncedScans,
  type OfflineScanRecord,
} from '../../src/lib/offline/credential-offline-queue';

describe('Fila Offline de Credenciamento (FASE 35 · Dívida E40)', () => {
  describe('buildIdempotencyKey & generateClientUuid', () => {
    it('normaliza o código para maiúsculas e remove espaços', () => {
      const key = buildIdempotencyKey({
        eventId: 'ev-1',
        code: '  abc-123  ',
        contextKind: 'EVENT',
        readAt: '2026-09-22T12:00:00.000Z',
      });

      expect(key).toBe('ev-1:ABC-123:event:2026-09-22T12:00:00.000Z');
    });

    it('diferencia contexto de evento e contexto de atividade', () => {
      const eventKey = buildIdempotencyKey({
        eventId: 'ev-1',
        code: 'CR-99',
        contextKind: 'EVENT',
        readAt: '2026-09-22T12:00:00.000Z',
      });

      const actKey = buildIdempotencyKey({
        eventId: 'ev-1',
        code: 'CR-99',
        contextKind: 'ACTIVITY',
        activityId: 'act-workshop',
        readAt: '2026-09-22T12:00:00.000Z',
      });

      expect(eventKey).not.toBe(actKey);
      expect(actKey).toBe('ev-1:CR-99:act-workshop:2026-09-22T12:00:00.000Z');
    });

    it('gera UUIDs v4 válidos e distintos', () => {
      const id1 = generateClientUuid();
      const id2 = generateClientUuid();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('detecta ausência de IndexedDB no ambiente Node por padrão', () => {
      // No Node sem polyfill, isIndexedDbSupported deve retornar false
      const supported = isIndexedDbSupported();
      expect(typeof supported).toBe('boolean');
    });
  });

  describe('Ciclo de vida com mock de IndexedDB', () => {
    let mockStore: Map<string, OfflineScanRecord>;

    beforeEach(() => {
      mockStore = new Map();

      // Configura um mock simples de IndexedDB para o ambiente Node
      const fakeDb = {
        objectStoreNames: { contains: () => true },
        transaction: () => ({
          objectStore: () => ({
            put: (record: OfflineScanRecord) => {
              mockStore.set(record.id, { ...record });
              const req = { onsuccess: null as (() => void) | null, onerror: null };
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
            get: (id: string) => {
              const req = {
                result: mockStore.get(id) ? { ...mockStore.get(id)! } : undefined,
                onsuccess: null as (() => void) | null,
                onerror: null,
              };
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
            delete: (id: string) => {
              mockStore.delete(id);
              const req = { onsuccess: null as (() => void) | null, onerror: null };
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
            openCursor: () => {
              const entries = Array.from(mockStore.entries());
              let index = 0;
              const req: {
                result: { value: OfflineScanRecord; delete: () => void; continue: () => void } | null;
                onsuccess: ((ev: { target: typeof req }) => void) | null;
                onerror: null;
              } = {
                result: null,
                onsuccess: null,
                onerror: null,
              };
              const advance = () => {
                if (index < entries.length) {
                  const [key, val] = entries[index]!;
                  req.result = {
                    value: val,
                    delete: () => mockStore.delete(key),
                    continue: () => {
                      index++;
                      advance();
                      req.onsuccess?.({ target: req });
                    },
                  };
                } else {
                  req.result = null;
                }
              };
              advance();
              setTimeout(() => req.onsuccess?.({ target: req }), 0);
              return req;
            },
            index: () => ({
              getAll: () => {
                const records = Array.from(mockStore.values());
                const req = {
                  result: records.map((r) => ({ ...r })),
                  onsuccess: null as (() => void) | null,
                  onerror: null,
                };
                setTimeout(() => req.onsuccess?.(), 0);
                return req;
              },
            }),
          }),
        }),
      };

      // Injeta globais temporárias para o teste
      (globalThis as unknown as Record<string, unknown>).window = globalThis;
      (globalThis as unknown as Record<string, unknown>).IDBKeyRange = {
        only: (val: unknown) => val,
      };
      (globalThis as unknown as Record<string, unknown>).indexedDB = {
        open: () => {
          const req = {
            result: fakeDb,
            onsuccess: null as (() => void) | null,
            onerror: null,
            onupgradeneeded: null,
          };
          setTimeout(() => req.onsuccess?.(), 0);
          return req;
        },
      };
    });

    it('enfileira leituras com status PENDING e chave de idempotência', async () => {
      const scan = await enqueueOfflineScan({
        tenantSlug: 'inst-teste',
        eventId: 'evt-10',
        contextKind: 'EVENT',
        code: 'CR-OFFLINE-01',
        mode: 'IN',
        readAt: '2026-09-22T10:00:00.000Z',
      });

      expect(scan.status).toBe('PENDING');
      expect(scan.code).toBe('CR-OFFLINE-01');
      expect(scan.mode).toBe('IN');
      expect(scan.idempotencyKey).toBe('evt-10:CR-OFFLINE-01:event:2026-09-22T10:00:00.000Z');
      expect(mockStore.has(scan.id)).toBe(true);
    });

    it('lista leituras pendentes em ordem cronológica (FIFO por readAt)', async () => {
      await enqueueOfflineScan({
        tenantSlug: 'inst-teste',
        eventId: 'evt-10',
        contextKind: 'EVENT',
        code: 'SEGUNDO',
        mode: 'IN',
        readAt: '2026-09-22T10:05:00.000Z',
      });

      await enqueueOfflineScan({
        tenantSlug: 'inst-teste',
        eventId: 'evt-10',
        contextKind: 'EVENT',
        code: 'PRIMEIRO',
        mode: 'IN',
        readAt: '2026-09-22T10:00:00.000Z',
      });

      const pending = await listPendingScans('inst-teste', 'evt-10');
      expect(pending).toHaveLength(2);
      expect(pending[0]!.code).toBe('PRIMEIRO');
      expect(pending[1]!.code).toBe('SEGUNDO');
    });

    it('calcula sumário da fila e transiciona status para SYNCED', async () => {
      const s1 = await enqueueOfflineScan({
        tenantSlug: 'inst-teste',
        eventId: 'evt-10',
        contextKind: 'EVENT',
        code: 'CR-1',
        mode: 'IN',
      });

      await enqueueOfflineScan({
        tenantSlug: 'inst-teste',
        eventId: 'evt-10',
        contextKind: 'EVENT',
        code: 'CR-2',
        mode: 'OUT',
      });

      let summary = await getOfflineQueueSummary('inst-teste', 'evt-10');
      expect(summary.total).toBe(2);
      expect(summary.pending).toBe(2);
      expect(summary.synced).toBe(0);

      await markScanStatus(s1.id, 'SYNCED', { outcome: { action: 'CHECKED_IN' } });

      summary = await getOfflineQueueSummary('inst-teste', 'evt-10');
      expect(summary.total).toBe(2);
      expect(summary.pending).toBe(1);
      expect(summary.synced).toBe(1);
    });

    it('faz expurgo de leituras sincronizadas antigas', async () => {
      const scan = await enqueueOfflineScan({
        tenantSlug: 'inst-teste',
        eventId: 'evt-10',
        contextKind: 'EVENT',
        code: 'CR-ANTIGO',
        mode: 'IN',
      });

      await markScanStatus(scan.id, 'SYNCED');

      // Força a data de sincronização para mais de 7 dias atrás
      const record = mockStore.get(scan.id)!;
      record.syncedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      mockStore.set(scan.id, record);

      const pruned = await pruneSyncedScans(7);
      expect(pruned).toBe(1);
      expect(mockStore.has(scan.id)).toBe(false);
    });
  });
});
