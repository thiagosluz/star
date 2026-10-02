/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — As demandas do quadro na régua das OUTRAS vistas (FASE 57)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE MAPEAMENTO EXISTE (e não um segundo carregamento)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O Gantt e o calendário mostram as MESMAS demandas que o Kanban já carregou. Uma
 *  consulta nova para cada vista seria a porta pela qual as três divergiriam: o Kanban
 *  lê o quadro filtrado, e um `findMany` paralelo teria de repetir os filtros, a janela
 *  de cartões e a régua de situação — três cópias de uma decisão só.
 *
 *  Aqui a conversão é de FORMA, não de conteúdo: `DemandColumnView` é achatado e a
 *  situação é calculada UMA vez (`withSituation`), com o MESMO instante que o serviço
 *  usou. A vista desenha; quem decide continua sendo o domínio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE `DemandCard` GANHOU `createdAt`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Sem `startAt`, a barra do Gantt começa na CRIAÇÃO — e o Kanban nunca precisou dessa
 *  data. Buscá-la aqui dentro custaria uma consulta por demanda; ela passa a vir junto
 *  do cartão, que é onde o dado já estava disponível.
 */
import {
  barStartKey,
  withSituation,
  type TimelineDemand,
  type TimelineWindow,
} from '@/domain/events/demand-timeline-rules';
import { addDaysToDayKey, localDayKey } from '@/domain/events/demand-rules';
import type { DemandColumnView } from '@/lib/events/demand-service';

/**
 * As demandas do quadro, na forma que as duas vistas novas consomem.
 *
 * A ordem de entrada é a ordem do quadro (coluna por coluna, posição por posição): o
 * Gantt reordena por regra própria, e o calendário agrupa por dia — nenhum dos dois
 * depende daqui, mas manter a ordem do quadro torna a saída determinística para quem lê
 * a lista direto.
 */
export function toTimelineDemands(
  columns: readonly DemandColumnView[],
  now: Date,
  timeZone: string,
): TimelineDemand[] {
  return columns.flatMap((column) =>
    column.cards.map((card) =>
      withSituation(
        {
          id: card.id,
          title: card.title,
          priority: card.priority,
          priorityLabel: card.priorityLabel,
          startAt: card.startAt,
          dueAt: card.dueAt,
          completedAt: card.completedAt,
          createdAt: card.createdAt,
          teamName: card.teamName,
          assignees: card.assignees.map((assignee) => ({
            id: assignee.id,
            name: assignee.name,
          })),
        },
        now,
        timeZone,
      ),
    ),
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Validação do que vem pela URL
// ───────────────────────────────────────────────────────────────────────────────
/**
 * `AAAA-MM-DD` **de calendário**, e não só o formato.
 *
 * O endereço é escrito à mão por quem navega (e por quem cola um link), então a
 * diferença entre "parece uma data" e "é uma data" importa: `2026-99-99` casa com o
 * formato e faria a janela andar por dias que não existem. Valor inválido cai no
 * caminho padrão da tela — nunca vira erro na cara de quem clicou.
 */
export function isTimelineDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [, month, day] = value.split('-');

  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31;
}

/** `AAAA-MM` de calendário — a mesma régua do mês do calendário. */
export function isTimelineMonthKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;

  const [, month] = value.split('-');

  return Number(month) >= 1 && Number(month) <= 12;
}

// ───────────────────────────────────────────────────────────────────────────────
//  A âncora do eixo
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Em que dia o eixo do Gantt começa.
 *
 * A precedência é: **o dia pedido no endereço** → **o início mais cedo das demandas com
 * prazo** → **hoje** (no fuso do evento).
 *
 * ─── POR QUE O MAIS CEDO IGNORA A DEMANDA SEM PRAZO ───────────────────────────
 *  Quem não tem prazo não entra no eixo: ela vai para a faixa "sem data". Deixar uma
 *  demanda sem prazo — criada meses atrás — definir a âncora abriria o Gantt num período
 *  onde NADA é desenhado, e a tela pareceria vazia por causa de um cartão que nem
 *  aparece ali.
 */
export function ganttAnchorKey(input: {
  requested?: string | null;
  demands: readonly TimelineDemand[];
  timeZone: string;
  now: Date;
}): string {
  if (isTimelineDayKey(input.requested)) return input.requested;

  const starts = input.demands
    .filter((demand) => demand.dueAt !== null)
    .map((demand) => barStartKey(demand, input.timeZone));

  return starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : localDayKey(input.now, input.timeZone);
}

/** O mês que o calendário abre: o pedido, senão o mês de hoje no fuso do evento. */
export function calendarMonthKey(input: {
  requested?: string | null;
  timeZone: string;
  now: Date;
}): string {
  if (isTimelineMonthKey(input.requested)) return input.requested;

  return localDayKey(input.now, input.timeZone).slice(0, 7);
}

/**
 * A âncora do período vizinho — uma janela inteira para trás ou para frente.
 *
 * O passo é o TAMANHO da janela (e não um número solto na tela): se o eixo mudar de
 * tamanho, a navegação continua andando exatamente um período, sem repetir nem pular
 * dias. A aritmética é a MESMA do quadro (`addDaysToDayKey`, FASE 38): duas contas de
 * calendário no mesmo produto divergiriam na primeira virada de mês.
 */
export function shiftedWindowAnchor(window: TimelineWindow, direction: -1 | 1): string {
  return addDaysToDayKey(window.fromKey, direction * window.days.length);
}
