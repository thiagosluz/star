/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Motor de XP, níveis, prestígio e ofensiva (streak)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA CENTRAL: O NÍVEL É DERIVADO, NUNCA ATRIBUÍDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `XpTransaction` é o livro-razão (append-only) e `UserXpProfile.totalXp` é o
 *  saldo. Nível, prestígio e progresso NÃO são decididos por quem grava: são
 *  função pura do saldo (`resolveXpProgress`). Isso elimina a classe de bug mais
 *  comum em gamificação — o contador que "anda" sozinho — porque não existe
 *  caminho de código capaz de gravar nível incoerente com o XP.
 *
 *  Um ajuste administrativo negativo derruba o nível na hora, e isso é
 *  intencional: fraude descoberta depois precisa ter consequência.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Tabela de XP por origem
// ───────────────────────────────────────────────────────────────────────────────
import type { XpSourceKind } from '@/domain/gamification/types';

/**
 * XP creditado por cada origem de evento.
 *
 * A escala foi escolhida para que o **esforço científico valha mais que a
 * presença**: assistir a uma palestra é fácil (40), avaliar um trabalho é
 * trabalhoso (300) e ter um artigo aceito é o resultado que o evento existe para
 * produzir (500).
 *
 * `TASK_COMPLETED`, `BONUS` e `ADMIN_ADJUSTMENT` valem 0 de propósito: o valor
 * vem do caso concreto (`TaskDefinition.xpReward` ou `amount` explícito). Ter um
 * padrão aqui creditaria XP dobrado — ou crédito fantasma, pior ainda.
 */
export const XP_SOURCES: Readonly<Record<XpSourceKind, number>> = {
  CHECKIN: 50,
  ACTIVITY_ATTENDANCE: 40,
  MINI_COURSE_COMPLETION: 150,
  SUBMISSION_SUBMITTED: 200,
  SUBMISSION_ACCEPTED: 500,
  REVIEW_COMPLETED: 300,
  TASK_COMPLETED: 0,
  BONUS: 0,
  ADMIN_ADJUSTMENT: 0,
  REFERRAL: 250,
} as const;

/** Rótulos em pt-BR para o extrato de XP. */
export const XP_SOURCE_LABELS: Readonly<Record<XpSourceKind, string>> = {
  CHECKIN: 'Credenciamento no evento',
  ACTIVITY_ATTENDANCE: 'Presença em atividade',
  MINI_COURSE_COMPLETION: 'Conclusão de minicurso',
  SUBMISSION_SUBMITTED: 'Trabalho submetido',
  SUBMISSION_ACCEPTED: 'Trabalho aceito',
  REVIEW_COMPLETED: 'Parecer concluído',
  TASK_COMPLETED: 'Missão concluída',
  BONUS: 'Bônus',
  ADMIN_ADJUSTMENT: 'Ajuste administrativo',
  REFERRAL: 'Indicação',
};

// ───────────────────────────────────────────────────────────────────────────────
//  Curva de níveis
// ───────────────────────────────────────────────────────────────────────────────
/** Nível máximo de um ciclo. Ao atingi-lo, o ciclo fecha e o prestígio sobe. */
export const LEVEL_CAP = 50;

/** Prestígio máximo (10 ciclos completos). */
export const MAX_PRESTIGE = 10;

/**
 * XP necessário para COMPLETAR o nível `level` (subir para o seguinte).
 *
 * Cresce linearmente (100, 150, 200, …) em vez de exponencialmente. Curva
 * exponencial é hostil em evento de poucos dias: o participante que faz tudo
 * ainda termina no nível 4 e conclui que o sistema está quebrado. Linear + teto
 * de ciclo mantém progresso visível a cada poucas ações.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO HÁ `0` NO TETO
 * ─────────────────────────────────────────────────────────────────────────────
 *  A primeira versão devolvia 0 no nível 50 (raciocínio de "não existe nível
 *  51"). O efeito era perverso: o nível 50 só era alcançado no instante exato em
 *  que o prestígio subia — ou seja, o topo da curva era INALCANÇÁVEL e o título
 *  "Lenda" nunca aparecia. Aqui o nível 50 tem custo de conclusão como qualquer
 *  outro; quem o completa sobe de prestígio.
 */
export function xpToNextLevel(level: number): number {
  if (level < 1) return 0;
  return 100 + (level - 1) * 50;
}

/**
 * XP acumulado necessário para ESTAR no nível `n` (nível 1 = 0 XP).
 *
 * Fórmula fechada: `25n² + 25n − 50`, equivalente a somar `xpToNextLevel` de 1
 * até `n − 1`. Aceita `LEVEL_CAP + 1`, que representa o FIM do ciclo (o ponto em
 * que o prestígio sobe).
 */
export function xpToReachLevel(level: number): number {
  if (level <= 1) return 0;
  const capped = Math.min(level, LEVEL_CAP + 1);
  return 25 * capped * capped + 25 * capped - 50;
}

/** XP que um ciclo completo (nível 1 → 50 e conclusão do nível 50) custa. */
export const PRESTIGE_COST_XP = xpToReachLevel(LEVEL_CAP + 1);

/**
 * Nível correspondente a um XP **dentro do ciclo**.
 *
 * Usa a forma fechada como ponto de partida e ajusta com uma verificação
 * explícita. O ajuste é barato (≤ algumas iterações) e elimina qualquer dúvida
 * de arredondamento na raiz quadrada.
 */
export function levelFromXp(xpInCycle: number): number {
  const xp = Math.max(0, Math.floor(xpInCycle));
  if (xp <= 0) return 1;

  // n = (−1 + √(9 + 4·xp/25)) / 2
  const estimate = Math.floor((-1 + Math.sqrt(9 + (4 * xp) / 25)) / 2);
  let level = Math.min(Math.max(estimate, 1), LEVEL_CAP);

  while (level > 1 && xpToReachLevel(level) > xp) level -= 1;
  while (level < LEVEL_CAP && xpToReachLevel(level + 1) <= xp) level += 1;

  return level;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Progresso resolvido
// ───────────────────────────────────────────────────────────────────────────────
export interface XpProgress {
  /** Saldo do livro-razão, como está no banco (pode ser negativo). */
  totalXp: number;
  /** Saldo usado no cálculo (nunca negativo). */
  effectiveXp: number;
  prestigeLevel: number;
  level: number;
  /** XP acumulado dentro do ciclo corrente. */
  xpInCycle: number;
  /** XP já conquistado dentro do nível atual. */
  xpIntoLevel: number;
  /** XP que falta para o próximo nível (0 se estiver no teto do ciclo). */
  xpToNextLevel: number;
  /** Fração 0–1 de preenchimento do nível atual. */
  levelRatio: number;
  /** Fração 0–1 de preenchimento do ciclo de prestígio. */
  cycleRatio: number;
  /** Nível é o teto do ciclo e o próximo passo é subir de prestígio. */
  atPrestigeGate: boolean;
  title: string;
}

/**
 * Resolve todo o progresso a partir do saldo de XP.
 *
 * Função PURA e total: qualquer inteiro (inclusive negativo) produz um estado
 * válido. É o único lugar que decide nível e prestígio.
 */
export function resolveXpProgress(totalXp: number): XpProgress {
  const effectiveXp = Math.max(0, Math.floor(totalXp));

  const rawPrestige = Math.floor(effectiveXp / PRESTIGE_COST_XP);
  const prestigeLevel = Math.min(rawPrestige, MAX_PRESTIGE);
  const xpInCycle = effectiveXp - prestigeLevel * PRESTIGE_COST_XP;

  const level = levelFromXp(xpInCycle);
  const floorOfLevel = xpToReachLevel(level);
  /**
   * Teto do nível = XP para estar no nível seguinte. No nível 50 esse teto é o
   * FIM DO CICLO (`xpToReachLevel(51)`), e não zero: assim a barra de progresso
   * do último nível aponta para o prestígio em vez de já nascer cheia.
   */
  const ceilingOfLevel = xpToReachLevel(level + 1);
  const span = ceilingOfLevel - floorOfLevel;

  const xpIntoLevel = xpInCycle - floorOfLevel;
  const atPrestigeGate = level >= LEVEL_CAP;

  return {
    totalXp: Math.floor(totalXp),
    effectiveXp,
    prestigeLevel,
    level,
    xpInCycle,
    xpIntoLevel,
    xpToNextLevel: Math.max(0, ceilingOfLevel - xpInCycle),
    levelRatio: span <= 0 ? 1 : clamp01(xpIntoLevel / span),
    cycleRatio: clamp01(xpInCycle / PRESTIGE_COST_XP),
    atPrestigeGate,
    title: levelTitle(level, prestigeLevel),
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// ───────────────────────────────────────────────────────────────────────────────
//  Títulos
// ───────────────────────────────────────────────────────────────────────────────
const TITLE_BANDS: readonly { minLevel: number; title: string }[] = [
  { minLevel: 50, title: 'Lenda' },
  { minLevel: 35, title: 'Mestre' },
  { minLevel: 20, title: 'Especialista' },
  { minLevel: 10, title: 'Veterano' },
  { minLevel: 5, title: 'Explorador' },
  { minLevel: 1, title: 'Iniciante' },
];

/**
 * Título exibido no perfil.
 *
 * Com prestígio, o título ganha o sufixo do ciclo: "Mestre · Prestígio 2". O
 * prestígio é informação que o participante conquistou e quer exibir — escondê-lo
 * tiraria o motivo de existir do sistema de prestígio.
 */
export function levelTitle(level: number, prestigeLevel = 0): string {
  const band = TITLE_BANDS.find((entry) => level >= entry.minLevel) ?? TITLE_BANDS[TITLE_BANDS.length - 1]!;
  if (prestigeLevel <= 0) return band!.title;
  return `${band!.title} · Prestígio ${prestigeLevel}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ofensiva (streak)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Chave do dia no fuso da INSTITUIÇÃO.
 *
 * O dia não pode ser UTC: um check-in às 22h em Salvador (UTC−3) cairia no dia
 * seguinte em UTC e quebraria a ofensiva de quem participou corretamente. O fuso
 * do tenant é a referência de "hoje" para os participantes do evento.
 */
export function dayKey(date: Date, timeZone: string): string {
  // 'en-CA' produz ISO (YYYY-MM-DD) e aceita `timeZone`, sem dependência externa.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Chave do trimestre no fuso da instituição: `2026-Q3`. */
export function seasonKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/** Data (meio-dia UTC) deslocada em N dias — evita surpresas de horário de verão. */
function shiftDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  /** O dia da atividade é novo (a ofensiva foi recalculada)? */
  isNewDay: boolean;
  /** A ofensiva foi quebrada por inatividade? */
  wasBroken: boolean;
}

/**
 * Recalcula a ofensiva a partir do último dia com atividade.
 *
 * Regras:
 *   • mesma data de calendário → nada muda (várias ações no mesmo dia contam 1);
 *   • dia anterior → +1;
 *   • mais antigo (ou nunca) → recomeça em 1.
 *
 * O `longestStreak` nunca diminui: é recorde, não estado.
 */
export function applyStreak(input: {
  currentStreak: number;
  longestStreak: number;
  lastActivityAt: Date | null;
  now: Date;
  timeZone: string;
}): StreakState {
  const { now, timeZone } = input;
  const today = dayKey(now, timeZone);

  if (!input.lastActivityAt) {
    return {
      currentStreak: 1,
      longestStreak: Math.max(input.longestStreak, 1),
      isNewDay: true,
      wasBroken: false,
    };
  }

  const last = dayKey(input.lastActivityAt, timeZone);
  if (last === today) {
    return {
      currentStreak: Math.max(input.currentStreak, 1),
      longestStreak: Math.max(input.longestStreak, input.currentStreak, 1),
      isNewDay: false,
      wasBroken: false,
    };
  }

  const yesterday = dayKey(shiftDays(now, -1), timeZone);
  if (last === yesterday) {
    const next = input.currentStreak + 1;
    return {
      currentStreak: next,
      longestStreak: Math.max(input.longestStreak, next),
      isNewDay: true,
      wasBroken: false,
    };
  }

  return {
    currentStreak: 1,
    longestStreak: Math.max(input.longestStreak, 1),
    isNewDay: true,
    wasBroken: input.currentStreak > 1,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Marcos de ofensiva
// ───────────────────────────────────────────────────────────────────────────────
/** Ofensivas que merecem reconhecimento (usadas por cartas de gatilho STREAK). */
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

/** A ofensiva atingiu um marco (e não apenas passou por ele)? */
export function reachedStreakMilestone(streak: number): boolean {
  return (STREAK_MILESTONES as readonly number[]).includes(streak);
}

/**
 * XP de bônus por manter a ofensiva.
 *
 * Cresce em degraus e satura: sequência longa não pode virar fonte infinita de
 * XP, senão a única estratégia racional do jogo passa a ser "aparecer todo dia" —
 * e a gamificação competiria com o conteúdo em vez de reforçá-lo.
 */
export function streakBonusXp(streak: number): number {
  if (streak >= 100) return 300;
  if (streak >= 60) return 200;
  if (streak >= 30) return 150;
  if (streak >= 14) return 100;
  if (streak >= 7) return 60;
  if (streak >= 3) return 30;
  return 0;
}
