export interface StageWinner {
  position: number;
  name: string;
  masked: boolean;
}

/** Uma rodada como o telão a exibe (FASE 30). */
export interface StageRoundModel {
  roundNumber: number;
  prizeTitle: string | null;
  prizeDescription: string | null;
  sponsorName: string | null;
  drawnAtIso: string | null;
  seedCommitment: string | null;
  seedRevealed: string | null;
  resultHash: string | null;
  winnersCount: number;
  alternatesCount: number;
  rollNames: string[];
  winners: StageWinner[];
  alternates: StageWinner[];
}

export interface StageModel {
  raffleId: string;
  title: string;
  description: string | null;
  state: 'AGUARDANDO' | 'REVELADO' | 'CANCELADO';
  currentRound: StageRoundModel | null;
  previousRounds: StageRoundModel[];
  minAttendanceMinutes: number;
  eligibleCount: number;
  auditHref: string;
}

export type StageTransport = 'sse' | 'polling';
export type StagePhase = 'AGUARDANDO' | 'SORTEANDO' | 'REVELADO' | 'CANCELADO';

export function roundSubtitle(round: StageRoundModel | null): string | null {
  if (!round) return null;

  const parts = [`Rodada ${round.roundNumber}`];
  if (round.prizeTitle) parts.push(round.prizeTitle);

  return parts.join(' — ');
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;

  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
