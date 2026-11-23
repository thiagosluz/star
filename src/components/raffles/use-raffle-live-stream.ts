'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { StageModel, StageTransport } from '@/components/raffles/raffle-stage-types';

interface LivePayload {
  eligibleCount?: number | null;
  raffle?: {
    status?: string;
    pendingRound?: { roundNumber: number } | null;
    lastDrawnRound?: { roundId: string; roundNumber: number } | null;
  } | null;
}

/**
 * Gerencia a conexão SSE (com fallback automático para polling) do telão do sorteio.
 * Mantém dependências estáveis em `[liveUrl, router]` para não cancelar o
 * `router.refresh()` agendado durante transições de rodada (defeito real da FASE 30).
 */
export function useRaffleLiveStream({
  liveUrl,
  initialEligibleCount,
  initialState,
  initialRoundNumber,
  rollingRef,
  onDrawnRound,
  onPendingRound,
  onCanceled,
}: {
  liveUrl: string;
  initialEligibleCount: number;
  initialState: StageModel['state'];
  initialRoundNumber: number | null;
  rollingRef: React.RefObject<boolean>;
  onDrawnRound: () => void;
  onPendingRound: () => void;
  onCanceled: () => void;
}) {
  const router = useRouter();
  const [eligibleCount, setEligibleCount] = useState(initialEligibleCount);
  const [transport, setTransport] = useState<StageTransport>('polling');
  const [failed, setFailed] = useState(false);

  const seenRoundId = useRef<string | null>(
    initialState === 'REVELADO' && initialRoundNumber !== null ? `drawn-${initialRoundNumber}` : null,
  );
  const callbacksRef = useRef({ onDrawnRound, onPendingRound, onCanceled });

  useEffect(() => {
    callbacksRef.current = { onDrawnRound, onPendingRound, onCanceled };
  }, [onDrawnRound, onPendingRound, onCanceled]);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let controller: AbortController | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const apply = (payload: LivePayload) => {
      if (typeof payload.eligibleCount === 'number') setEligibleCount(payload.eligibleCount);

      const raffle = payload.raffle;
      if (!raffle?.status) return;

      if (raffle.status === 'CANCELED') {
        callbacksRef.current.onCanceled();
        return;
      }

      const drawn = raffle.lastDrawnRound ?? null;

      if (drawn && seenRoundId.current !== `drawn-${drawn.roundNumber}`) {
        seenRoundId.current = `drawn-${drawn.roundNumber}`;
        callbacksRef.current.onDrawnRound();

        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => router.refresh(), 250);
        return;
      }

      if (raffle.pendingRound && !rollingRef.current) {
        callbacksRef.current.onPendingRound();

        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => router.refresh(), 250);
      }
    };

    const startPolling = () => {
      const load = async () => {
        try {
          controller = controller ?? new AbortController();
          const response = await fetch(liveUrl, { signal: controller.signal, cache: 'no-store' });
          apply((await response.json()) as LivePayload);
        } catch {
          if (!cancelled) setFailed(true);
        }
      };

      void load();
      pollTimer = setInterval(() => void load(), 5_000);
    };

    if (typeof EventSource === 'undefined') {
      startPolling();
    } else {
      source = new EventSource(liveUrl);

      source.addEventListener('open', () => {
        if (!cancelled) setTransport('sse');
      });

      source.addEventListener('live', (event) => {
        try {
          apply(JSON.parse((event as MessageEvent<string>).data) as LivePayload);
        } catch {
          // Evento malformado não derruba o telão público.
        }
      });

      source.addEventListener('error', () => {
        if (cancelled) return;

        if (source?.readyState === EventSource.CLOSED) {
          setTransport('polling');
          source.close();
          source = null;
          startPolling();
        }
      });
    }

    return () => {
      cancelled = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      controller?.abort();
    };
  }, [liveUrl, rollingRef, router]);

  return { eligibleCount, transport, failed };
}
