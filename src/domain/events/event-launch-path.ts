/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O CAMINHO DE PARTIDA DO EVENTO (FASE 77 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE GUIA NÃO É O PAINEL DE PRONTIDÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A raiz do evento já responde "o que atrapalha AGORA" (FASE 53). O organizador
 *  novo, porém, faz outra pergunta: "por onde começo?". São perguntas diferentes,
 *  e tratar uma como recorte da outra produziria dois sinais opostos na mesma tela:
 *  um evento DRAFT sem página e sem atividade sai com ZERO pendências ("Tudo em
 *  ordem") e, ao mesmo tempo, ainda não tem por onde o público entrar.
 *
 *  Por isso este guia é um caminho de PARTIDA, não uma lista de pendências:
 *  - os fatos são os que a tela JÁ carrega (`registrationHasDeadline`,
 *    `activityCount`, `pagePublished`) — nenhuma consulta nova;
 *  - os três passos valem mesmo quando nada está travado, porque descrevem o que
 *    falta para o evento IR AO AR, não o que está quebrado;
 *  - a palavra "pronto" não entra em texto nenhum: o painel fala de conclusão do
 *    que atrapalha, e este guia fala de começo. O teste de unidade reprova a
 *    palavra em qualquer texto produzido aqui.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE OS RÓTULOS SÃO ESTES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Dados e prazos" e não "Dados Básicos": o formulário já exige nome, data e
 *  local, e o sistema não confere nada disso em lugar nenhum. Prometer "dados
 *  básicos" faria o guia afirmar uma validação que não existe. O fato que a tela
 *  conhece — e que muda o estado do evento — é o PRAZO de inscrição.
 *
 *  "Página no ar" e não "Página publicada": o que interessa a quem começa é se há
 *  um site para divulgar. O estado continua vindo de `pagePublished`, e `null`
 *  (página nunca criada) é PENDENTE — não se afirma "no ar" sobre o que não foi
 *  conferido.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O ALVO SAI DO CATÁLOGO, E NÃO DE UM LITERAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O destino de cada passo é o `data-testid` do CARTÃO da área (ADR-302 preserva
 *  os atalhos legados: a área `pagina` responde por `landing-link`, não por
 *  `event-area-pagina`). Escrever o literal aqui criaria uma segunda verdade sobre
 *  o mesmo contrato — e foi assim que `sem-programacao` passou a apontar para um
 *  `activities-section` que a FASE 55 removeu da raiz. A derivação vive em
 *  `eventAreaTestId`, e este módulo a usa para que o alvo seja, por construção, um
 *  cartão que existe.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { EVENT_AREAS, eventAreaTestId } from '@/domain/events/event-areas';

export type EventLaunchStepId = 'dados-e-prazos' | 'programacao' | 'pagina-no-ar';

/** Uma fatia do caminho: dada ou ainda por dar. */
export type EventLaunchStepState = 'DONE' | 'PENDING';

export interface EventLaunchStep {
  id: EventLaunchStepId;
  /** O nome do passo, sem prometer validação que o sistema não faz. */
  label: string;
  /** O que conta como dado — a mesma frase que a tela mostra ao lado do rótulo. */
  hint: string;
  state: EventLaunchStepState;
  /**
   * O `data-testid` do cartão que resolve o passo.
   *
   * É um contrato de TELA: o cartão é o destino clicável, e o teste de unidade
   * prende que ele existe no catálogo de áreas.
   */
  targetTestId: string;
}

/**
 * Os fatos do render. Nenhum deles é buscado de novo: são os mesmos que a
 * prontidão e o selo dos cartões já usam.
 */
export interface EventLaunchPathFacts {
  /** `Event.registrationClosesAt !== null` — o fato de `inscricoes-sem-prazo`. */
  registrationHasDeadline: boolean;
  /** Atividades do evento (`> 0` = há programação). */
  activityCount: number;
  /** `getEventAreaCounts().pagePublished`; `null` = página nunca criada. */
  pagePublished: boolean | null;
}

export interface EventLaunchPath {
  steps: readonly EventLaunchStep[];
  completed: number;
  total: number;
  /** A frase da contagem — no caso 3/3, "os três passos foram dados". */
  summary: string;
}

/**
 * O rótulo do estado de cada passo.
 *
 * Fica no domínio porque é TEXTO do produto: a tela não escolhe "concluído" ou
 * "a fazer" por conta própria, e o teste que reprova a palavra "pronto" alcança
 * estes rótulos também.
 */
export const EVENT_LAUNCH_STATE_LABEL: Readonly<Record<EventLaunchStepState, string>> = {
  DONE: 'concluído',
  PENDING: 'a fazer',
};

/**
 * A frase que reconcilia o guia com o painel.
 *
 * Sem ela, um evento DRAFT com zero pendências mostraria "Tudo em ordem" e um
 * passo pendente na mesma dobra — dois sinais que parecem se contradizer. A nota
 * diz, em uma linha, que são perguntas diferentes.
 */
export const EVENT_LAUNCH_NOTE =
  'Os passos de partida mostram por onde começar; as pendências dizem o que atrapalha agora.';

/** O alvo de um passo: o `data-testid` real do cartão da área. */
function targetOf(areaId: string): string {
  const area = EVENT_AREAS.find((candidate) => candidate.id === areaId);

  /**
   * O catálogo é a fonte única do alvo. Se a área sumir, é defeito de
   * programação — e o teste de unidade reprova ANTES de a tela renderizar um link
   * morto (foi o defeito do `activities-section` na raiz).
   */
  if (!area) throw new Error(`Passo de partida sem área no catálogo: ${areaId}`);

  return eventAreaTestId(area);
}

function summaryFor(completed: number): string {
  if (completed === 0) return 'Nenhum dos três passos de partida foi dado ainda.';
  if (completed === 1) return '1 dos 3 passos de partida foi dado.';
  if (completed === 2) return '2 dos 3 passos de partida foram dados.';

  return 'Os três passos de partida foram dados.';
}

/**
 * As três fatias do caminho, na ordem em que o evento costuma ser montado:
 * declarar prazos, montar a programação e colocar a página no ar.
 *
 * A ordem não é a do banco nem a das fases: é a de quem começa. Por isso ela é
 * fixa e não depende do estado — o organizador precisa enxergar o caminho
 * inteiro, inclusive o que já foi dado.
 */
export function eventLaunchPath(facts: EventLaunchPathFacts): EventLaunchPath {
  const steps: EventLaunchStep[] = [
    {
      id: 'dados-e-prazos',
      label: 'Dados e prazos',
      hint: 'A data de encerramento das inscrições.',
      state: facts.registrationHasDeadline ? 'DONE' : 'PENDING',
      targetTestId: targetOf('dados'),
    },
    {
      id: 'programacao',
      label: 'Programação',
      hint: 'Ao menos uma atividade na programação.',
      state: facts.activityCount > 0 ? 'DONE' : 'PENDING',
      targetTestId: targetOf('programacao'),
    },
    {
      id: 'pagina-no-ar',
      label: 'Página no ar',
      hint: 'A página do evento publicada.',
      /**
       * `null` é "nunca criada" (e também "não conferi") — nos dois casos não se
       * pode afirmar que há página no ar. Só `true` conclui o passo.
       */
      state: facts.pagePublished === true ? 'DONE' : 'PENDING',
      targetTestId: targetOf('pagina'),
    },
  ];

  const completed = steps.filter((step) => step.state === 'DONE').length;

  return {
    steps,
    completed,
    total: steps.length,
    summary: summaryFor(completed),
  };
}
