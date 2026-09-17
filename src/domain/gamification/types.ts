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
