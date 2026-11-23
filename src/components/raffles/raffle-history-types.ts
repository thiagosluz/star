import type { RaffleActionState } from '@/app/actions/raffle-actions';

export type RaffleActionFn = (
  prev: RaffleActionState | null,
  formData: FormData,
) => Promise<RaffleActionState>;

export interface RaffleRoundItem {
  id: string;
  roundNumber: number;
  state: 'PREPARED' | 'DRAWN';
  prizeTitle: string | null;
  prizeDescription: string | null;
  sponsorName: string | null;
  winnersCount: number;
  alternatesCount: number;
  eligibleCount: number;
  resultHash: string | null;
  poolHash: string | null;
  seedCommitment: string | null;
  seedRevealed: string | null;
  drawnAtLabel: string | null;
}

export interface RaffleWinnerItemData {
  /** Id da POSIÇÃO sorteada — é o que o registro de entrega envia. */
  id: string;
  position: number;
  roundNumber: number;
  userId: string;
  userName: string;
  minutes: number;
  kind: 'WINNER' | 'ALTERNATE';
  deliveredAtLabel: string | null;
  deliveredByName: string | null;
  deliveryNote: string | null;
}

export interface RaffleItem {
  id: string;
  title: string;
  scopeLabel: string;
  activityTitle: string | null;
  referenceDay: string | null;
  status: string;
  winnersCount: number;
  alternatesCount: number;
  weightByMinutes: boolean;
  isPublic: boolean;
  eligibleCount: number;
  inspectedAttendances: number;
  minAttendanceMinutes: number;
  allowPriorEventWinners: boolean;
  drawnAtLabel: string | null;
  resultHash: string | null;
  seedCommitment: string | null;
  seedRevealed: string | null;
  createdByName: string | null;
  rounds: RaffleRoundItem[];
  winners: RaffleWinnerItemData[];
}

export const RAFFLE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Configurado — aguardando apuração',
  DRAWN: 'Apurado',
  CANCELED: 'Cancelado',
};
