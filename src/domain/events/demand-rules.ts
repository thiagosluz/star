/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Quadro de demandas internas do evento (FASE 38)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE "DEMANDA", E NÃO "TAREFA"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Tarefa" já significa outra coisa neste sistema: `TaskDefinition` e
 *  `UserTaskProgress` são as MISSÕES da gamificação (FASE 5), e `task:manage` é a
 *  permissão de quem as cadastra. Chamar de tarefa o que a equipe faz no evento
 *  criaria duas entidades diferentes com o mesmo nome em três lugares (schema,
 *  permissão e menu) — e o rótulo repetido já quebrou tela e teste neste projeto
 *  (armadilha 81). "Demanda" é o que o humano pediu, é o que a tela diz e é o que
 *  a URL mostra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A COLUNA É O ESTADO, MAS QUEM MANDA NO "CONCLUÍDO" É UM DADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As colunas são configuráveis (o organizador renomeia, cria e reordena), então
 *  "concluído" não pode ser o NOME de uma coluna: renomear a coluna para "Feito"
 *  faria o sistema perder a conta do que terminou. Cada coluna carrega `isDone`, e
 *  é ele que define se a demanda está concluída — o nome é rótulo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "VENCE HOJE" NÃO É "ATRASADA"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O prazo é o DIA inteiro no fuso do evento (mesma decisão da FASE 34): quem tem
 *  prazo hoje ainda está dentro dele às 22h. Comparar o INSTANTE do prazo com o
 *  agora acusaria atraso na manhã do próprio dia — e uma tela que chama de atrasado
 *  quem está no prazo ensina a operação a ignorar o alerta. Por isso a comparação é
 *  entre DIA LOCAL e DIA LOCAL, por chave de calendário ("AAAA-MM-DD"), nunca por
 *  subtração de instantes.
 *
 *  Módulo puro: nada aqui importa Prisma ou Next.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { instantToZonedWallTime, zonedWallTimeToInstant } from './scheduling-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Prioridade
// ───────────────────────────────────────────────────────────────────────────────
export const DEMAND_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

export type DemandPriority = (typeof DEMAND_PRIORITIES)[number];

export const DEMAND_PRIORITY_LABELS: Record<DemandPriority, string> = {
  LOW: 'Baixa',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

/**
 * Ordem de leitura na tela: urgente primeiro.
 *
 * A prioridade NÃO reordena o quadro sozinha (a ordem é a que o organizador
 * arrastou); ela ordena o que a tela mostra FORA do quadro — o resumo e os
 * filtros. Ordenar por urgência é a mesma regra da fila de confirmações
 * (armadilha 80): tela de trabalho abre pelo que aperta.
 */
export const DEMAND_PRIORITY_RANK: Record<DemandPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

export function isDemandPriority(value: unknown): value is DemandPriority {
  return typeof value === 'string' && (DEMAND_PRIORITIES as readonly string[]).includes(value);
}

/**
 * Prioridade do formulário → prioridade gravada.
 *
 * Valor ausente ou desconhecido cai em `NORMAL`, e não em `URGENT`: um formulário
 * que não mandou prioridade nenhuma não está pedindo urgência, e "escolhi não
 * dizer" tem de significar o meio da escala. É o oposto do `required` da FASE 37,
 * onde o ausente é a decisão mais FORTE — lá o ausente significa "obrigatória"
 * porque era o dado que já existia; aqui não existe dado anterior.
 */
export function normalizeDemandPriority(value: unknown): DemandPriority {
  return isDemandPriority(value) ? value : 'NORMAL';
}

export function priorityLabel(value: string): string {
  return isDemandPriority(value) ? DEMAND_PRIORITY_LABELS[value] : DEMAND_PRIORITY_LABELS.NORMAL;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Colunas
// ───────────────────────────────────────────────────────────────────────────────
export const DEMAND_COLUMN_NAME_MAX = 40;

/**
 * O quadro nasce pronto: cinco colunas que descrevem o trabalho de organização de
 * evento, sem o organizador ter de inventar o vocabulário antes de usar a tela.
 *
 * A ÚLTIMA é a única `isDone` — e nasce assim porque "Concluído" como coluna de
 * trabalho (onde o cartão fica parado sem estar pronto) não existe: quem entra ali
 * terminou.
 */
export const DEFAULT_DEMAND_COLUMNS: readonly { name: string; isDone: boolean }[] = Object.freeze([
  { name: 'A fazer', isDone: false },
  { name: 'Em andamento', isDone: false },
  { name: 'Em revisão', isDone: false },
  { name: 'Bloqueado', isDone: false },
  { name: 'Concluído', isDone: true },
]);

export interface DemandColumnLike {
  id: string;
  name: string;
  isDone: boolean;
  position: number;
}

export function normalizeColumnName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return trimmed.length === 0 ? null : trimmed.slice(0, DEMAND_COLUMN_NAME_MAX);
}

/**
 * A coluna em que a demanda entra quando ninguém escolheu: a PRIMEIRA na ordem.
 *
 * "Primeira" e não "A fazer" pelo nome, pelo mesmo motivo de `isDone`: o nome é do
 * organizador.
 */
export function firstColumn<T extends DemandColumnLike>(columns: readonly T[]): T | null {
  return (
    [...columns].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0] ?? null
  );
}

export function columnOf<T extends DemandColumnLike>(
  columns: readonly T[],
  columnId: string | null,
): T | null {
  if (!columnId) return null;
  return columns.find((column) => column.id === columnId) ?? null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ordenação dos cartões
// ─────────────────────────────────────────────────────────────────────────────
/**
 * As posições andam de 10 em 10.
 *
 * O espaço entre elas não é decorativo: enquanto houver folga, inserir um cartão
 * ENTRE dois outros é um `UPDATE` de uma linha (a posição média), e não a
 * reescrita da coluna inteira. Quando a folga acaba (dois vizinhos consecutivos), o
 * serviço reescreve a coluna — `planReorder` é quem devolve esse plano.
 */
export const DEMAND_POSITION_STEP = 10;

/** Posições 10, 20, 30… na ordem dada. */
export function planReorder(ids: readonly string[]): { id: string; position: number }[] {
  return ids.map((id, index) => ({ id, position: (index + 1) * DEMAND_POSITION_STEP }));
}

/** Posição média entre duas vizinhas, ou `null` quando não há folga. */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return DEMAND_POSITION_STEP;
  if (before === null) return after === null ? null : after - DEMAND_POSITION_STEP;
  if (after === null) return before + DEMAND_POSITION_STEP;

  const middle = Math.floor((before + after) / 2);
  return middle > before && middle < after ? middle : null;
}

export function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

/**
 * Move um item de posição dentro da MESMA lista.
 *
 * `splice` sem o cuidado do índice deslocado é o erro clássico (remover antes de
 * ler o destino faz o item andar uma casa a mais quando desce). Aqui o índice de
 * destino é interpretado na lista JÁ SEM o item — que é como a tela conta ("soltar
 * depois do terceiro cartão visível").
 */
export function moveWithinList(
  ids: readonly string[],
  from: number,
  to: number,
): string[] {
  const list = [...ids];
  const origin = clampIndex(from, list.length - 1);
  const [moved] = list.splice(origin, 1);

  if (moved === undefined) return list;

  list.splice(clampIndex(to, list.length), 0, moved);
  return list;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Prazo
// ───────────────────────────────────────────────────────────────────────────────
/**
 * 23:59 no fuso do evento — o prazo é o DIA, não 24 horas corridas (ADR-173).
 *
 * `23:59` e não `23:59:59`: é o mesmo minuto que a pessoa lê na tela e no aviso, e
 * a diferença de 59 segundos não decide nada enquanto o rótulo e o dado dizem a
 * mesma coisa.
 */
export const DEMAND_DUE_HOUR = 23;
export const DEMAND_DUE_MINUTE = 59;

/** Chave do dia de CALENDÁRIO no fuso do evento: `"2026-09-26"`. */
export function localDayKey(instant: Date, timeZone: string): string {
  return instantToZonedWallTime(instant, timeZone).slice(0, 10);
}

/**
 * `"2026-09-26"` (o que o `<input type="date">` manda) → o INSTANTE do fim daquele
 * dia no fuso do evento.
 *
 * Devolve `null` quando o texto não é uma data — a tela transforma isso em
 * mensagem, e o serviço recusa em vez de gravar o prazo de hoje por engano.
 */
export function dueAtFromDay(day: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return null;

  const [, year, month, dayOfMonth] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(dayOfMonth);

  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;

  const pad = (value: number): string => String(value).padStart(2, '0');
  const wallTime = `${year}-${pad(monthNumber)}-${pad(dayNumber)}T${pad(DEMAND_DUE_HOUR)}:${pad(
    DEMAND_DUE_MINUTE,
  )}`;

  return zonedWallTimeToInstant(wallTime, timeZone);
}

/** Caminho de volta: o instante gravado → o texto do campo de data. */
export function dayFromDueAt(dueAt: Date | null, timeZone: string): string {
  return dueAt ? localDayKey(dueAt, timeZone) : '';
}

export type DemandSituation = 'DONE' | 'OVERDUE' | 'DUE_TODAY' | 'OPEN';

export const DEMAND_SITUATION_LABELS: Record<DemandSituation, string> = {
  DONE: 'Concluída',
  OVERDUE: 'Atrasada',
  DUE_TODAY: 'Vence hoje',
  OPEN: 'Em aberto',
};

export interface DemandSituationInput {
  dueAt: Date | null;
  completedAt: Date | null;
}

/**
 * A situação do cartão — derivada, nunca gravada.
 *
 * Gravada, ela mentiria no dia seguinte: um cartão que "vence hoje" continua com a
 * linha dizendo isso amanhã. Quem decide é a comparação entre o dia do prazo e o
 * dia de hoje, no fuso do evento.
 *
 * Concluída vence tudo: demanda entregue com atraso é histórica, e a tela não deve
 * continuar acusando atraso de quem já resolveu.
 */
export function demandSituation(
  input: DemandSituationInput,
  now: Date,
  timeZone: string,
): DemandSituation {
  if (input.completedAt) return 'DONE';
  if (!input.dueAt) return 'OPEN';

  const due = localDayKey(input.dueAt, timeZone);
  const today = localDayKey(now, timeZone);

  if (due < today) return 'OVERDUE';
  if (due === today) return 'DUE_TODAY';
  return 'OPEN';
}

export function isDemandSituation(value: unknown): value is DemandSituation {
  return (
    typeof value === 'string' &&
    (Object.keys(DEMAND_SITUATION_LABELS) as string[]).includes(value)
  );
}

/**
 * Dias inteiros de atraso, no calendário do evento. Zero quando não há atraso.
 *
 * A conta é entre CHAVES DE DIA (interpretadas como meia-noite UTC), e não entre
 * instantes: é o número de dias de calendário que a pessoa conta no dedo, sem
 * depender do horário em que o job rodou.
 */
export function daysLate(input: DemandSituationInput, now: Date, timeZone: string): number {
  if (input.completedAt || !input.dueAt) return 0;

  const due = localDayKey(input.dueAt, timeZone);
  const today = localDayKey(now, timeZone);
  if (due >= today) return 0;

  const dueMs = Date.parse(`${due}T00:00:00.000Z`);
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);

  return Math.round((todayMs - dueMs) / 86_400_000);
}

/** "26/09/2026" no fuso do evento — o rótulo que a tela e o aviso mostram. */
export function dueDayLabel(dueAt: Date | null, timeZone: string): string | null {
  if (!dueAt) return null;

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone,
  }).format(dueAt);
}

/** Rótulo curto de prazo, com a situação — "vence hoje", "atrasada há 2 dias". */
export function dueStatusLabel(
  input: DemandSituationInput,
  now: Date,
  timeZone: string,
): string | null {
  const situation = demandSituation(input, now, timeZone);

  if (situation === 'DUE_TODAY') return 'vence hoje';
  if (situation === 'OVERDUE') {
    const days = daysLate(input, now, timeZone);
    return days === 1 ? 'atrasada há 1 dia' : `atrasada há ${days} dias`;
  }

  return dueDayLabel(input.dueAt, timeZone);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Texto
// ───────────────────────────────────────────────────────────────────────────────
export const DEMAND_TITLE_MAX = 160;
export const DEMAND_DESCRIPTION_MAX = 4000;
export const DEMAND_COMMENT_MAX = 2000;

function normalizeText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

export function normalizeDemandTitle(raw: unknown): string | null {
  return normalizeText(raw, DEMAND_TITLE_MAX);
}

export function normalizeDemandDescription(raw: unknown): string | null {
  return normalizeText(raw, DEMAND_DESCRIPTION_MAX);
}

export function normalizeDemandComment(raw: unknown): string | null {
  return normalizeText(raw, DEMAND_COMMENT_MAX);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Menções
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Quem foi mencionado num comentário.
 *
 * ─── POR QUE A MENÇÃO É DADO, E NÃO TEXTO PROCURADO ───────────────────────────
 *  A tentação é varrer o corpo atrás de `@` e casar com o nome de alguém. Isso
 *  quebra de três jeitos: duas pessoas chamadas "Ana Paula" viram sorteio; "João"
 *  casaria com "João Pedro"; e o acento da digitação ("@Joao") deixaria de fora
 *  justamente quem se escreve com acento. O formulário manda os IDS de quem foi
 *  escolhido numa lista (que funciona sem JavaScript), e `@Nome` no texto é
 *  CONVENIÊNCIA DE LEITURA, não a fonte do fato.
 *
 *  A lista é filtrada contra quem pode ser mencionado (gente da equipe da
 *  instituição, no evento) e contra o próprio autor: mencionar a si mesmo encheria
 *  a caixa de entrada de quem acabou de escrever.
 */
export function normalizeMentionIds(
  raw: readonly string[],
  allowed: ReadonlySet<string>,
  authorId: string,
): string[] {
  const seen = new Set<string>();

  for (const value of raw) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (id.length === 0 || id === authorId || !allowed.has(id)) continue;
    seen.add(id);
  }

  return [...seen];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Liderança de equipe
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O líder da equipe pode atribuir trabalho DENTRO da própria equipe.
 *
 * ─── POR QUE ISTO NÃO É UM PAPEL ──────────────────────────────────────────────
 *  Líder de equipe é um DADO (uma linha em `event_team_members` com `isLead`), não
 *  um papel do RBAC: o organizador cria equipes quantas quiser, e transformar cada
 *  uma em papel exigiria mexer no catálogo de permissões a cada equipe nova. A
 *  permissão `demand:assign:own-team` existe no catálogo e a POSSE é conferida
 *  aqui — é o invariante nº 4 aplicado: permissão `:own` sem posse explícita nega.
 */
export function leadsTeam(teamId: string | null, leadingTeamIds: readonly string[]): boolean {
  return teamId !== null && leadingTeamIds.includes(teamId);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Resumo do quadro
// ───────────────────────────────────────────────────────────────────────────────
export interface DemandSummaryInput {
  id: string;
  dueAt: Date | null;
  completedAt: Date | null;
  teamId: string | null;
  assigneeIds: readonly string[];
}

export interface DemandSummaryBucket {
  open: number;
  overdue: number;
  dueToday: number;
  done: number;
  total: number;
}

export interface DemandSummary {
  open: number;
  overdue: number;
  dueToday: number;
  done: number;
  total: number;
  byTeam: ({ teamId: string | null } & DemandSummaryBucket)[];
  byAssignee: ({ userId: string } & DemandSummaryBucket)[];
}

function emptyBucket(): DemandSummaryBucket {
  return { open: 0, overdue: 0, dueToday: 0, done: 0, total: 0 };
}

function countInto(bucket: DemandSummaryBucket, situation: DemandSituation): void {
  bucket.total += 1;

  if (situation === 'DONE') {
    bucket.done += 1;
    return;
  }

  bucket.open += 1;
  if (situation === 'OVERDUE') bucket.overdue += 1;
  if (situation === 'DUE_TODAY') bucket.dueToday += 1;
}

/**
 * Números do quadro — no topo da tela e no filtro por equipe.
 *
 * ─── POR QUE A ORDEM DAS EQUIPES É POR URGÊNCIA ───────────────────────────────
 *  Ordenar por nome seria estável e inútil: a primeira linha da tela é onde o olho
 *  para. Ela abre por quem tem mais atrasadas, depois mais abertas — e o
 *  desempate é o id, para a saída ser determinística (teste que compara resumo
 *  comparando ordem precisa que a ordem não dependa do banco).
 *
 *  Demanda SEM responsável entra em `byAssignee` sob `"SEM_RESPONSAVEL"`: é
 *  exatamente o que o coordenador procura ("o que ninguém pegou"), e escondê-la do
 *  resumo deixaria o quadro parecer distribuído quando não está.
 */
export const UNASSIGNED_KEY = 'SEM_RESPONSAVEL';

export function boardSummary(
  demands: readonly DemandSummaryInput[],
  now: Date,
  timeZone: string,
): DemandSummary {
  const total = emptyBucket();
  const teams = new Map<string, { teamId: string | null } & DemandSummaryBucket>();
  const assignees = new Map<string, { userId: string } & DemandSummaryBucket>();

  for (const demand of demands) {
    const situation = demandSituation(demand, now, timeZone);

    countInto(total, situation);

    const teamKey = demand.teamId ?? UNASSIGNED_KEY;
    const team = teams.get(teamKey) ?? { teamId: demand.teamId, ...emptyBucket() };
    countInto(team, situation);
    teams.set(teamKey, team);

    const targets = demand.assigneeIds.length > 0 ? demand.assigneeIds : [UNASSIGNED_KEY];

    for (const userId of new Set(targets)) {
      const bucket = assignees.get(userId) ?? { userId, ...emptyBucket() };
      countInto(bucket, situation);
      assignees.set(userId, bucket);
    }
  }

  const byTeam = [...teams.values()].sort(
    (a, b) =>
      b.overdue - a.overdue ||
      b.open - a.open ||
      b.total - a.total ||
      (a.teamId ?? '').localeCompare(b.teamId ?? ''),
  );

  const byAssignee = [...assignees.values()].sort(
    (a, b) =>
      b.overdue - a.overdue || b.open - a.open || b.total - a.total || a.userId.localeCompare(b.userId),
  );

  return {
    open: total.open,
    overdue: total.overdue,
    dueToday: total.dueToday,
    done: total.done,
    total: total.total,
    byTeam,
    byAssignee,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Linha do tempo do cartão
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O que a ficha do cartão conta. É a NARRATIVA da demanda ("moveu para Em
 * andamento"), separada da trilha de auditoria, que é registro de conformidade com
 * IP e diff de campos.
 *
 * O valor gravado é o código; o rótulo é apresentação. Quem grava é o serviço, e o
 * par `fromValue`/`toValue` guarda as duas pontas em texto já legível — a ficha não
 * precisa reconstruir nada a partir do estado ATUAL da linha (que já mudou).
 */
export const DEMAND_EVENT_KINDS = [
  'CREATED',
  'MOVED',
  'ASSIGNED',
  'UNASSIGNED',
  'UPDATED',
  'COMPLETED',
  'REOPENED',
  'COMMENTED',
  'TEAM_CHANGED',
] as const;

export type DemandEventKind = (typeof DEMAND_EVENT_KINDS)[number];

export const DEMAND_EVENT_LABELS: Record<DemandEventKind, string> = {
  CREATED: 'criou a demanda',
  MOVED: 'moveu',
  ASSIGNED: 'atribuiu',
  UNASSIGNED: 'removeu a atribuição de',
  UPDATED: 'alterou',
  COMPLETED: 'concluiu',
  REOPENED: 'reabriu',
  COMMENTED: 'comentou',
  TEAM_CHANGED: 'mudou a equipe',
};

export function isDemandEventKind(value: unknown): value is DemandEventKind {
  return typeof value === 'string' && (DEMAND_EVENT_KINDS as readonly string[]).includes(value);
}

export function demandEventLabel(kind: string): string {
  return isDemandEventKind(kind) ? DEMAND_EVENT_LABELS[kind] : kind;
}

/**
 * Prazo, em dias, do aviso "está chegando".
 *
 * Um dia: o quadro é de operação de evento, e o aviso existe para dar TEMPO de
 * resolver — avisar no mesmo dia não dá. Avisar com uma semana encheria a caixa de
 * entrada de coisa que ainda não aperta, e alerta que toca sempre é alerta que
 * ninguém lê (a mesma lição da FASE 36 sobre a leitura de cron).
 */
export const DEMAND_DUE_SOON_DAYS = 1;

/**
 * Soma dias a uma chave de dia (`"2026-09-26"` + 1 → `"2026-09-27"`).
 *
 * Aritmética de CALENDÁRIO em UTC puro: aqui não existe fuso, só a contagem de
 * dias. Somar 24 horas a um instante erraria o dia nas viradas de horário de verão
 * — é a mesma razão pela qual `confirmationDueAt` (F34) monta a hora de parede em
 * vez de somar milissegundos.
 */
export function addDaysToDayKey(dayKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return dayKey;

  const [, year, month, day] = match;
  const base = Date.UTC(Number(year), Number(month) - 1, Number(day) + days);
  const target = new Date(base);
  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`;
}
