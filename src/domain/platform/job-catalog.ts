/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Catálogo das rotinas automáticas (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CATÁLOGO MORA AQUI, E NÃO NO WORKER
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem EXECUTA a rotina é o worker; quem MOSTRA a rotina é a tela da governança.
 *  Se cada lado tivesse a própria lista, a primeira manutenção faria a tela mentir
 *  sobre a cadência — ou exibir uma rotina que não existe mais. Aqui ficam só os
 *  DADOS (nome, rótulo, cadência, o que ela faz); a função que roda continua no
 *  worker, porque importá-la na tela traria as varreduras para dentro do bundle
 *  web (e o worker é quem tem relógio e conexão de plataforma).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const JOB_KEYS = [
  'review-deadlines',
  'attendance-sweep',
  'registration-confirmation-sweep',
  'demand-due',
  'file-scan',
  'audit-partitions',
] as const;

export type JobKey = (typeof JOB_KEYS)[number];

export interface JobDefinition {
  key: JobKey;
  label: string;
  /** O que a passada faz, em uma frase — é o que a tela mostra. */
  description: string;
  /** Expressão cron do agendador (BullMQ). */
  pattern: string;
  /** A cadência em português: cron não é para quem opera. */
  cadenceLabel: string;
  /**
   * O que conta como "item" no registro da execução. A tela precisa disso para
   * não comparar números que significam coisas diferentes.
   */
  itemsLabel: string;
}

export const JOB_CATALOG: Record<JobKey, JobDefinition> = {
  'review-deadlines': {
    key: 'review-deadlines',
    label: 'Prazos de parecer',
    description:
      'Avisa quem tem parecer perto do prazo e quem já passou dele (um aviso por parecer, sem repetir).',
    pattern: '0 */6 * * *',
    cadenceLabel: 'de 6 em 6 horas',
    itemsLabel: 'avisos enviados',
  },
  'attendance-sweep': {
    key: 'attendance-sweep',
    label: 'Presenças em aberto',
    description:
      'Fecha a sessão de quem esqueceu de registrar a saída, com o horário do FIM da atividade.',
    pattern: '*/15 * * * *',
    cadenceLabel: 'de 15 em 15 minutos',
    itemsLabel: 'sessões fechadas',
  },
  'registration-confirmation-sweep': {
    key: 'registration-confirmation-sweep',
    label: 'Confirmação de vaga',
    description:
      'Avisa quem está perto do prazo de confirmação e libera a vaga de quem venceu, promovendo a lista de espera.',
    pattern: '0 * * * *',
    cadenceLabel: 'de hora em hora',
    itemsLabel: 'vagas liberadas',
  },
  'demand-due': {
    key: 'demand-due',
    label: 'Prazos das demandas internas',
    description:
      'Avisa quem é responsável pela demanda que vence amanhã e por aquelas cujo prazo já passou, uma vez por dia.',
    pattern: '0 * * * *',
    cadenceLabel: 'de hora em hora',
    itemsLabel: 'avisos enviados',
  },
  'file-scan': {
    key: 'file-scan',
    label: 'Inspeção de arquivos',
    description:
      'Inspeciona os arquivos enviados por gente de fora (submissões e material de palestrante) antes de liberá-los.',
    pattern: '*/5 * * * *',
    cadenceLabel: 'de 5 em 5 minutos',
    itemsLabel: 'arquivos inspecionados',
  },
  'audit-partitions': {
    key: 'audit-partitions',
    label: 'Partições da auditoria',
    description:
      'Cria as partições mensais de `audit_logs` antes de o mês virar e resgata o que caiu na partição DEFAULT.',
    pattern: '0 3 * * *',
    cadenceLabel: 'todo dia às 3h',
    itemsLabel: 'partições criadas',
  },
};

export function isJobKey(value: unknown): value is JobKey {
  return typeof value === 'string' && (JOB_KEYS as readonly string[]).includes(value);
}

export function jobDefinition(key: JobKey): JobDefinition {
  return JOB_CATALOG[key];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Estados da execução
// ───────────────────────────────────────────────────────────────────────────────
export const JOB_RUN_STATUSES = ['RUNNING', 'OK', 'FAILED', 'SKIPPED'] as const;

export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

export const JOB_RUN_STATUS_LABELS: Record<JobRunStatus, string> = {
  RUNNING: 'Em andamento',
  OK: 'Concluída',
  FAILED: 'Falhou',
  SKIPPED: 'Não rodou (outra já estava em andamento)',
};

export const JOB_TRIGGERS = ['SCHEDULE', 'MANUAL', 'CLI'] as const;

export type JobTrigger = (typeof JOB_TRIGGERS)[number];

export const JOB_TRIGGER_LABELS: Record<JobTrigger, string> = {
  SCHEDULE: 'pelo relógio',
  MANUAL: 'pelo painel',
  CLI: 'pela linha de comando',
};

export function isJobRunStatus(value: unknown): value is JobRunStatus {
  return typeof value === 'string' && (JOB_RUN_STATUSES as readonly string[]).includes(value);
}

/**
 * Quanto tempo uma execução pode ficar "em andamento" antes de ser considerada
 * órfã.
 *
 * ─── POR QUE EXISTE UM TETO ───────────────────────────────────────────────────
 *  O registro é também a exclusão mútua: enquanto há um `RUNNING`, ninguém mais
 *  roda aquela rotina. Se o worker morrer no meio da passada (deploy, OOM, queda),
 *  a linha ficaria `RUNNING` para sempre e a rotina **nunca mais rodaria** — um
 *  travamento silencioso e permanente. Meia hora é folgada para a maior das
 *  passadas (as varreduras são limitadas por lote) e curta o bastante para o
 *  sistema se recuperar sozinho.
 */
export const JOB_STALE_AFTER_MS = 30 * 60 * 1000;

export function isStaleJobRun(startedAt: Date, now: Date): boolean {
  return now.getTime() - startedAt.getTime() > JOB_STALE_AFTER_MS;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Saúde, para a tela
// ───────────────────────────────────────────────────────────────────────────────
export type JobHealth = 'OK' | 'RUNNING' | 'LATE' | 'FAILING' | 'NEVER';

export const JOB_HEALTH_LABELS: Record<JobHealth, string> = {
  OK: 'Em dia',
  RUNNING: 'Rodando agora',
  LATE: 'Atrasada',
  FAILING: 'Falhando',
  NEVER: 'Nunca rodou',
};

/**
 * Traduz a última execução no que a operação precisa saber.
 *
 * A ordem dos testes é a regra: falha é o mais grave; execução em andamento é
 * notícia boa; "atrasada" é a ausência de execução recente comparada com a
 * CADÊNCIA da própria rotina (uma rotina de 15 minutos que não roda há 2 horas
 * está atrasada, e uma diária que não roda há 2 horas não está) — com folga de
 * duas passadas para não acusar atraso por um atraso normal do relógio.
 */
export function jobHealthOf(input: {
  lastStatus: JobRunStatus | null;
  lastStartedAt: Date | null;
  pattern: string;
  now: Date;
}): JobHealth {
  if (!input.lastStartedAt || !input.lastStatus) return 'NEVER';

  if (input.lastStatus === 'RUNNING') return 'RUNNING';
  if (input.lastStatus === 'FAILED') return 'FAILING';

  const intervalMinutes = cronIntervalMinutes(input.pattern);

  if (intervalMinutes === null) return 'OK';

  const ageMinutes = (input.now.getTime() - input.lastStartedAt.getTime()) / 60_000;

  return ageMinutes > intervalMinutes * 2 ? 'LATE' : 'OK';
}

/**
 * Intervalo aproximado, em minutos, de uma expressão cron de 5 campos.
 *
 * Não é um interpretador de cron: é o suficiente para as CADÊNCIAS DESTE catálogo —
 * passo nos minutos, passo de horas com o minuto zerado, hora cheia e um horário fixo
 * diário. Devolver `null` quando não sabe é deliberado: melhor não opinar sobre
 * atraso do que inventar.
 *
 * ─── DUAS ARMADILHAS QUE OS TESTES PEGARAM AQUI ────────────────────────────────
 *  A primeira versão disto lia só os campos de minuto e hora, e errava nos dois
 *  sentidos:
 *
 *    • **`0 * * * *` não era reconhecida** — hora `*` com minuto `0` é de hora em
 *      hora, e caía no `null`. Ou seja: a rotina de confirmação de vaga (que usa
 *      exatamente essa cadência) ficava sem avaliação de atraso;
 *    • **`0 3 * * 1` era lida como DIÁRIA** — o campo do dia da semana era ignorado,
 *      e uma rotina semanal apareceria "atrasada" todos os dias, menos no dia em que
 *      rodasse. Um alarme que sempre toca é um alarme que ninguém olha.
 *
 *  Por isso o dia, o mês e o dia da semana precisam ser `*`: com eles restritos, o
 *  intervalo entre passadas deixa de ser uniforme e a média não descreve nada.
 */
export function cronIntervalMinutes(pattern: string): number | null {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') return null;

  if (minute.startsWith('*/')) {
    const step = Number(minute.slice(2));

    /** Passo nos minutos só é uniforme se a hora inteira estiver liberada. */
    return hour === '*' && Number.isFinite(step) && step > 0 ? step : null;
  }

  if (minute !== '0') return null;

  if (hour === '*') return 60;

  if (hour.startsWith('*/')) {
    const step = Number(hour.slice(2));
    return Number.isFinite(step) && step > 0 ? step * 60 : null;
  }

  return /^\d+$/.test(hour) ? 24 * 60 : null;
}
