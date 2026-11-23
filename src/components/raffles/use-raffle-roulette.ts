'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  prefersReducedMotion,
  type StageModel,
  type StagePhase,
  type StageRoundModel,
} from '@/components/raffles/raffle-stage-types';

export const ROULETTE_INITIAL_DELAY_MS = 60;
export const ROULETTE_MAX_DELAY_MS = 380;
export const ROULETTE_MAX_STEPS = 24;

/** Calcula o próximo intervalo de desaceleração progressiva da roleta (60 ms -> 380 ms). */
export function nextRouletteDelay(currentDelay: number): number {
  return Math.min(ROULETTE_MAX_DELAY_MS, Math.round(currentDelay * 1.14));
}

/** Índice determinístico do participante exibido a cada passo da roleta. */
export function roulettePickIndex(step: number, totalNames: number): number {
  if (totalNames <= 0) return 0;
  return (step * 7) % totalNames;
}

/**
 * Controla a máquina de estados visual da roleta no telão (desaceleração, pausa,
 * replay e atalhos Espaço / R), mantendo refs estáveis para o stream SSE.
 */
export function useRaffleRoulette({
  initialState,
  currentRound,
}: {
  initialState: StageModel['state'];
  currentRound: StageRoundModel | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<StagePhase>(initialState);
  const [rolling, setRolling] = useState(false);
  const [rollName, setRollName] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const isPausedRef = useRef(false);
  const stepRef = useRef(0);
  const delayRef = useRef(ROULETTE_INITIAL_DELAY_MS);
  const rollingRef = useRef(false);

  const startRoll = useCallback(() => {
    rollingRef.current = true;
    stepRef.current = 0;
    delayRef.current = ROULETTE_INITIAL_DELAY_MS;
    isPausedRef.current = false;
    setIsPaused(false);
    setPhase('SORTEANDO');
    setRolling(true);
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      isPausedRef.current = next;
      return next;
    });
  }, []);

  const replayRoulette = useCallback(() => {
    if (!currentRound || currentRound.rollNames.length === 0) return;
    stepRef.current = 0;
    delayRef.current = ROULETTE_INITIAL_DELAY_MS;
    isPausedRef.current = false;
    rollingRef.current = true;
    setIsPaused(false);
    setRollName(null);
    setPhase('SORTEANDO');
    setRolling(true);
  }, [currentRound]);

  const markPending = useCallback(() => {
    setPhase('AGUARDANDO');
  }, []);

  const markCanceled = useCallback(() => {
    setPhase('CANCELADO');
  }, []);

  useEffect(() => {
    if (!rolling || isPaused) return;

    const round = currentRound;
    const names = round?.rollNames ?? [];

    // A lista publicada nasce apenas na apuração; aguarda o refresh com `drawnAtIso`.
    if (round && round.drawnAtIso === null) {
      const retry = setTimeout(() => router.refresh(), 300);
      return () => clearTimeout(retry);
    }

    if (!round || names.length === 0 || prefersReducedMotion()) {
      const immediate = setTimeout(() => {
        rollingRef.current = false;
        setRolling(false);
        setPhase('REVELADO');
      }, 0);

      return () => clearTimeout(immediate);
    }

    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (isPausedRef.current) return;
      stepRef.current += 1;
      const step = stepRef.current;
      const delay = delayRef.current;

      if (step >= ROULETTE_MAX_STEPS || delay >= ROULETTE_MAX_DELAY_MS) {
        setRollName(round.winners[0]?.name ?? names[0]!);
        timer = setTimeout(() => {
          rollingRef.current = false;
          setRolling(false);
          setPhase('REVELADO');
        }, 800);
        return;
      }

      setRollName(names[roulettePickIndex(step, names.length)]!);
      const nextDelay = nextRouletteDelay(delay);
      delayRef.current = nextDelay;
      timer = setTimeout(tick, nextDelay);
    };

    timer = setTimeout(tick, delayRef.current);

    return () => clearTimeout(timer);
  }, [rolling, isPaused, currentRound, router]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (event.code === 'Space') {
        if (rollingRef.current || phase === 'SORTEANDO') {
          event.preventDefault();
          togglePause();
        }
      } else if (event.code === 'KeyR') {
        if (currentRound && (phase === 'REVELADO' || phase === 'SORTEANDO')) {
          event.preventDefault();
          replayRoulette();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, currentRound, togglePause, replayRoulette]);

  return {
    phase,
    rollName,
    isPaused,
    rollingRef,
    startRoll,
    togglePause,
    replayRoulette,
    markPending,
    markCanceled,
  };
}
