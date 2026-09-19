/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Tipos do domínio de gamificação
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O DOMÍNIO REDECLARA OS ENUMS DO BANCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O domínio não importa o cliente Prisma (regra das fases anteriores: regra de
 *  negócio não depende de ORM). Os tipos abaixo espelham os enums do schema e são
 *  estruturalmente idênticos a eles, então a camada de aplicação passa um valor
 *  do domínio para o banco sem conversão.
 *
 *  O preço é manter os dois lados em sincronia. O teste de contrato
 *  (`tests/unit/gamification-contract.test.ts`) compara esta lista com o schema e
 *  falha se alguém adicionar um valor só de um lado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** O que gerou o crédito de XP. Espelha `enum XpSourceKind`. */
export type XpSourceKind =
  | 'CHECKIN'
  | 'ACTIVITY_ATTENDANCE'
  | 'MINI_COURSE_COMPLETION'
  | 'SUBMISSION_SUBMITTED'
  | 'SUBMISSION_ACCEPTED'
  | 'REVIEW_COMPLETED'
  | 'TASK_COMPLETED'
  | 'BONUS'
  | 'ADMIN_ADJUSTMENT'
  | 'REFERRAL';

export const XP_SOURCE_KINDS: readonly XpSourceKind[] = [
  'CHECKIN',
  'ACTIVITY_ATTENDANCE',
  'MINI_COURSE_COMPLETION',
  'SUBMISSION_SUBMITTED',
  'SUBMISSION_ACCEPTED',
  'REVIEW_COMPLETED',
  'TASK_COMPLETED',
  'BONUS',
  'ADMIN_ADJUSTMENT',
  'REFERRAL',
];

/** Raridade da carta. Espelha `enum CardRarity`. */
export type CardRarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';

export const CARD_RARITIES: readonly CardRarity[] = [
  'COMMON',
  'RARE',
  'EPIC',
  'LEGENDARY',
  'MYTHIC',
];

/** Gatilho de distribuição da carta. Espelha `enum CardTrigger`. */
export type CardTrigger =
  | 'CHECKIN'
  | 'ACTIVITY_COMPLETION'
  | 'MINI_COURSE_COMPLETION'
  | 'SUBMISSION_ACCEPTED'
  | 'SUBMISSION_SUBMITTED'
  | 'REVIEW_COMPLETED'
  | 'REVIEWER_TOP'
  | 'XP_THRESHOLD'
  | 'LEVEL_UP'
  | 'MANUAL_GRANT'
  | 'STREAK'
  | 'EVENT_ATTENDANCE_FULL';

export const CARD_TRIGGERS: readonly CardTrigger[] = [
  'CHECKIN',
  'ACTIVITY_COMPLETION',
  'MINI_COURSE_COMPLETION',
  'SUBMISSION_ACCEPTED',
  'SUBMISSION_SUBMITTED',
  'REVIEW_COMPLETED',
  'REVIEWER_TOP',
  'XP_THRESHOLD',
  'LEVEL_UP',
  'MANUAL_GRANT',
  'STREAK',
  'EVENT_ATTENDANCE_FULL',
];

/**
 * Rótulo do gatilho em português — o "porquê" que a pessoa lê ao ganhar a carta.
 *
 * Mora no domínio, e não na tela, porque o e-mail de conquista (FASE 15) precisa da
 * MESMA frase que a celebração na tela. Duas listas divergiriam na primeira vez que
 * alguém ajustasse uma delas.
 */
export const CARD_TRIGGER_LABELS: Readonly<Record<CardTrigger, string>> = {
  CHECKIN: 'Você fez o credenciamento no evento',
  ACTIVITY_COMPLETION: 'Você participou de uma atividade',
  MINI_COURSE_COMPLETION: 'Você concluiu um minicurso',
  SUBMISSION_ACCEPTED: 'Seu trabalho foi aceito',
  SUBMISSION_SUBMITTED: 'Você submeteu um trabalho',
  REVIEW_COMPLETED: 'Você concluiu um parecer',
  REVIEWER_TOP: 'Você foi destaque entre os revisores do evento',
  XP_THRESHOLD: 'Você alcançou a meta de XP',
  LEVEL_UP: 'Você subiu de nível',
  MANUAL_GRANT: 'A organização concedeu esta carta a você',
  STREAK: 'Você manteve a sequência de participação',
  EVENT_ATTENDANCE_FULL: 'Você esteve em todas as atividades do evento',
};

export function cardTriggerLabel(trigger: string): string {
  return CARD_TRIGGER_LABELS[trigger as CardTrigger] ?? 'Conquista desbloqueada';
}

/** Tipo de missão. Espelha `enum TaskKind`. */
export type TaskKind = 'DAILY' | 'WEEKLY' | 'EVENT_LONG' | 'ONE_OFF' | 'ACHIEVEMENT';

export const TASK_KINDS: readonly TaskKind[] = [
  'DAILY',
  'WEEKLY',
  'EVENT_LONG',
  'ONE_OFF',
  'ACHIEVEMENT',
];

/** Estado do progresso de uma missão. Espelha `enum TaskProgressStatus`. */
export type TaskProgressStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CLAIMED'
  | 'EXPIRED';

export const TASK_PROGRESS_STATUSES: readonly TaskProgressStatus[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'CLAIMED',
  'EXPIRED',
];

/** Tipo de atividade usado nos filtros de meta das missões. */
export type ActivityType =
  | 'LECTURE'
  | 'MINI_COURSE'
  | 'WORKSHOP'
  | 'ROUND_TABLE'
  | 'HACKATHON'
  | 'POSTER_SESSION'
  | 'ORAL_PRESENTATION'
  | 'CULTURAL'
  | 'OTHER';

export const ACTIVITY_TYPES: readonly ActivityType[] = [
  'LECTURE',
  'MINI_COURSE',
  'WORKSHOP',
  'ROUND_TABLE',
  'HACKATHON',
  'POSTER_SESSION',
  'ORAL_PRESENTATION',
  'CULTURAL',
  'OTHER',
];
