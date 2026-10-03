/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Os três grupos de eventos da página da instituição
 *                                                            (FASE 64 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DECISÃO DO HUMANO: OS GRUPOS VÊM DAS DATAS, NÃO DE CURADORIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `em breve` (começa depois de agora) · `acontecendo` (a janela contém agora) ·
 *  `antigos` (terminou). Nada de lista escolhida à mão: o organizador não tem uma
 *  tarefa a mais por evento criado, e a página nunca fica desatualizada porque
 *  alguém esqueceu de mover um evento de lugar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS BORDAS, QUE É ONDE ESTA REGRA SE GANHA OU SE PERDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • **Evento que começa EXATAMENTE agora NÃO é `em breve`.** No instante em que
 *    ele começou, a vitrine deve dizer que está acontecendo — mandar para `em
 *    breve` um evento que já abriu é o que faz a pessoa não ir.
 *  • **Evento que termina EXATAMENTE agora é `antigo`.** A janela é `[início, fim)`
 *    — meio aberta no fim, como toda janela de tempo. Sem essa escolha, um evento
 *    apareceria em `acontecendo` no instante em que já acabou.
 *  • **Sem data vai para `em breve`.** Isto é a borda de DADO AUSENTE (o modelo
 *    exige as duas datas), e a escolha é: o evento existe, está publicado, e não há
 *    como dizer que aconteceu. Escondê-lo de todos os grupos o tornaria invisível
 *    justamente na página que existe para mostrá-lo.
 *  • **Campo único é lido como o que ele é.** Só início: antes dele é `em breve`,
 *    depois é `acontecendo` (não há fim declarado, então não terminou). Só fim:
 *    depois dele é `antigo`, antes é `acontecendo`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CONTA É EM INSTANTES, E O FUSO SÓ APARECE DEPOIS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `startsAt`/`endsAt` são instantes (TIMESTAMPTZ, sempre UTC). Comparar instante
 *  com instante é correto em qualquer fuso e em qualquer horário de verão — e é a
 *  mesma régua que `src/domain/events/scheduling-rules.ts` documenta desde a FASE 24.
 *
 *  O FUSO DA INSTITUIÇÃO entra no LUGAR CERTO: na APRESENTAÇÃO. É ele que faz a data
 *  ser escrita ("10 de novembro, 08:00") e é ele que responde "que horas são aqui?",
 *  que é a pergunta de quem lê a vitrine da casa. Um evento de outra cidade continua
 *  entrando no grupo pelo seu próprio instante; o que muda é como a data é mostrada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LIÇÃO DA F54: A TELA NÃO RECONTA O QUE O SERVIÇO JÁ CONTOU
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada grupo sai com `items` (recortado pelo limite) **e** `total` (quantos são de
 *  verdade). É isso que permite a tela dizer "3 de 12" sem fazer uma segunda
 *  contagem que poderia divergir da primeira — foi exatamente o defeito que a FASE 54
 *  prendeu com teste no selo de contagem, e ele reapareceria aqui como "veja todos os
 *  6 eventos" embaixo de uma lista de 3.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { PUBLICLY_VISIBLE_EVENT_STATUSES, type EventStatus } from '@/domain/events/event-rules';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';

export type TenantEventGroup = 'UPCOMING' | 'ONGOING' | 'PAST';

/**
 * Quantos eventos cada grupo desenha antes do "ver todos".
 *
 * O padrão é 6 porque é o que cabe numa faixa de vitrine sem virar lista de
 * arquivo; o teto existe para uma URL como `?limite=100000` não virar uma consulta
 * que carrega o acervo inteiro da casa só para esconder 99% na tela.
 */
export const TENANT_GROUP_DEFAULT_LIMIT = 6;
export const TENANT_GROUP_MAX_LIMIT = 24;

export interface TenantEventDateSource {
  id: string;
  slug: string;
  title: string;
  /**
   * Início e fim são OBRIGATÓRIOS no modelo (`Event.startsAt`/`endsAt` são NOT NULL
   * no banco e no schema). O `undefined` aqui é a borda de DADO AUSENTE — um objeto
   * montado por um adapter ou por um snapshot antigo pode não trazer o campo —, e a
   * regra precisa dizer o que faz com ela em vez de produzir `Invalid Date`.
   */
  startsAt: Date | undefined;
  endsAt: Date | undefined;
  status: EventStatus;
}

/**
 * O mínimo para CLASSIFICAR — sem `status` e sem `title`.
 *
 * Existe porque a classificação pura não deve depender de campos que ela não lê: o
 * teste de borda passa `{ startsAt, endsAt }` e nada mais, e o serviço passa o
 * cartão já montado. Se a assinatura exigisse a fonte inteira, o teste teria de
 * inventar `status` e `title` para provar uma conta que não os usa.
 */
export type TenantEventClassificationInput = Pick<
  TenantEventDateSource,
  'startsAt' | 'endsAt' | 'id'
>;

/** O evento como o cartão da página o desenha. */
export interface TenantEventCard {
  id: string;
  slug: string;
  title: string;
  /** Período já escrito no fuso da instituição (ou o aviso de que não há data). */
  periodLabel: string;
  startsAt: Date | undefined;
  endsAt: Date | undefined;
  /** `true` quando o evento está acontecendo agora — o cartão ganha o selo. */
  isHappeningNow: boolean;
}

export interface TenantEventGroupView<TEvent> {
  group: TenantEventGroup;
  /** O que o cartão do grupo desenha, recortado pelo limite. */
  items: TenantEventCard[];
  /** O evento COMO ELE É — o serviço usa isto para completar o cartão. */
  events: TEvent[];
  /** Quantos eventos o grupo tem de verdade (não quantos foram desenhados). */
  total: number;
  /** Mostrar o link "ver todos"? Só quando há mais do que o limite. */
  hasMore: boolean;
  /** O limite que foi APLICADO (já normalizado) — a tela não recalcula. */
  limit: number;
}

export interface TenantEventGroups<TEvent> {
  upcoming: TenantEventGroupView<TEvent>;
  ongoing: TenantEventGroupView<TEvent>;
  past: TenantEventGroupView<TEvent>;
  /** O total geral dos três grupos — o número que a capa anuncia. */
  total: number;
  /** O instante da conta, para a tela poder explicar "calculado às 14:03". */
  now: Date;
  /** O fuso em que as datas foram escritas. */
  timeZone: string;
}

/** Onde cada evento cai. Exportado porque a TELA também precisa saber a regra. */
export function classifyTenantEvent(
  event: Pick<TenantEventDateSource, 'startsAt' | 'endsAt'>,
  now: Date,
): TenantEventGroup {
  const startsAt = event.startsAt;
  const endsAt = event.endsAt;

  // Sem data: ver o cabeçalho — o evento existe e não há como dizer que passou.
  if (!startsAt && !endsAt) return 'UPCOMING';

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  AS BORDAS SÃO PERGUNTAS SEPARADAS, E A ORDEM DELAS É A REGRA
   * ─────────────────────────────────────────────────────────────────────────────
   *  "Ainda não começou" e "já terminou" são indagados ANTES de "está dentro da
   *  janela", e cada um responde por si:
   *
   *    • começou EXATAMENTE agora  → NÃO é "ainda não começou" → `acontecendo`;
   *    • terminou EXATAMENTE agora → É "já terminou"           → `antigo`.
   *
   *  Fazer a conta por um intervalo sintético (`fim ?? início`) erraria os dois
   *  casos de UM SÓ CAMPO: um evento sem fim, começado agora, cairia em `antigo`
   *  (o início viraria o próprio fim), e um evento sem início, que só termina
   *  amanhã, cairia em `em breve` (o fim viraria o início). Os dois defeitos
   *  apareceram no teste desta fatia antes desta versão.
   */
  if (startsAt && startsAt.getTime() > now.getTime()) return 'UPCOMING';
  if (endsAt && endsAt.getTime() <= now.getTime()) return 'PAST';

  return 'ONGOING';
}

/**
 * A janela pedida, dentro do permitido.
 *
 * Um `limite=0` ou `limite=abc` vindo da URL não pode deixar a vitrine vazia nem
 * explodir a consulta: valor fora da faixa cai no PADRÃO. É a mesma régua de
 * `normalizePageSize` (FASE 56 · E2) aplicada a esta tela.
 */
export function normalizeGroupLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed)) return TENANT_GROUP_DEFAULT_LIMIT;
  if (parsed < 1 || parsed > TENANT_GROUP_MAX_LIMIT) return TENANT_GROUP_DEFAULT_LIMIT;

  return Math.floor(parsed);
}

/**
 * Separa os eventos nos três grupos, com limite e contagem total por grupo.
 *
 * Só entram eventos PUBLICAMENTE VISÍVEIS: um rascunho que por algum motivo chegou
 * à consulta não pode aparecer na vitrine da instituição. O filtro é a lista do
 * domínio (`PUBLICLY_VISIBLE_EVENT_STATUSES`) — a mesma que a leitura pública de
 * eventos usa desde a FASE 56 —, e não uma lista escrita aqui.
 */
export function groupTenantEvents<TEvent extends TenantEventDateSource>(
  events: readonly TEvent[],
  options: { now: Date; timeZone: string; limit?: unknown },
): TenantEventGroups<TEvent> {
  const limit = normalizeGroupLimit(options.limit);
  const now = options.now;
  const timeZone = options.timeZone;

  const visible = events.filter((event) => isPublicEventStatus(event.status));

  const buckets: Record<TenantEventGroup, TEvent[]> = {
    UPCOMING: [],
    ONGOING: [],
    PAST: [],
  };

  for (const event of visible) {
    buckets[classifyTenantEvent(event, now)].push(event);
  }

  /**
   * A ordem de cada grupo é a pergunta que ele responde:
   *   • `em breve`  — o PRÓXIMO primeiro (quem abre a página quer saber o que vem);
   *   • `antigos`   — o mais RECENTE primeiro (é o histórico, e o último é o que
   *     interessa);
   *   • `acontecendo` — quem COMEÇOU primeiro, e sem data no fim (a ordem em que a
   *     pessoa decide onde ir agora).
   */
  const ordered = {
    UPCOMING: [...buckets.UPCOMING].sort((a, b) => ascendingStart(a, b)),
    ONGOING: [...buckets.ONGOING].sort((a, b) => ascendingStart(a, b)),
    PAST: [...buckets.PAST].sort((a, b) => descendingEnd(a, b)),
  };

  return {
    upcoming: view('UPCOMING', ordered.UPCOMING, limit, timeZone),
    ongoing: view('ONGOING', ordered.ONGOING, limit, timeZone),
    past: view('PAST', ordered.PAST, limit, timeZone),
    total: visible.length,
    now,
    timeZone,
  };
}

function view<TEvent extends TenantEventDateSource>(
  group: TenantEventGroup,
  events: readonly TEvent[],
  limit: number,
  timeZone: string,
): TenantEventGroupView<TEvent> {
  /** O recorte é do grupo INTEIRO já ordenado — o "ver todos" mostra o resto. */
  const shown = events.slice(0, limit);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O EVENTO DO CHAMADOR TAMBÉM SAI CARIMBADO (defeito REAL, achado na FASE 64)
   * ─────────────────────────────────────────────────────────────────────────────
   *  `items` é o cartão MÍNIMO do domínio (id, título, período e o selo de "está
   *  acontecendo"). `events` é o objeto do CHAMADOR — na página da instituição, o
   *  cartão cheio, com resumo, local e vagas, que só o serviço conhece.
   *
   *  A primeira versão devolvia `events: shown` cru, com o raciocínio de que o
   *  chamador completaria o que faltasse. Só que `periodLabel` e `isHappeningNow` são
   *  escritos AQUI (é este módulo que sabe o grupo e o fuso), e o cartão cheio DECLARA
   *  os dois campos (`PublicTenantEventCard`) — o resultado era o pior possível: o
   *  campo existia no tipo, vinha VAZIO em produção, e a tela desenhava o ícone do
   *  calendário sem data nenhuma ao lado.
   *
   *  Ninguém pegou por dois motivos, e os dois ficam ditos: os testes desta função
   *  afirmam `items` (que SEMPRE esteve certo — o defeito estava no caminho que a
   *  tela usa), e texto vazio não é violação de acessibilidade nem erro de tipo. Quem
   *  pegou foi a catraca de REGRESSÃO VISUAL da FASE 64, que mede a tela.
   *
   *  O conserto é aqui, e não na tela, porque a regra desta casa é que a classificação
   *  e a formatação de data vivem no domínio: uma tela que juntasse `items` com
   *  `events` para reencontrar o período seria uma SEGUNDA régua — a mesma que a F54
   *  prendeu no selo de contagem.
   *
   *  `items` continua sendo o cartão puro (nada nele muda), e `events` passa a ser o
   *  objeto do chamador COM os campos do cartão por cima — os do domínio vencem.
   */
  const enriched = shown.map((event) => ({ ...event, ...toCard(event, group, timeZone) }));

  return {
    group,
    items: shown.map((event) => toCard(event, group, timeZone)),
    events: enriched,
    total: events.length,
    hasMore: events.length > limit,
    limit,
  };
}

/**
 * Só status publicamente visíveis entram na vitrine.
 *
 * A comparação usa `Set` montado da lista do domínio a cada chamada de propósito: o
 * módulo é puro e o conjunto é pequeno (cinco itens). Um `Set` de módulo com estado
 * mutável seria uma fonte de verdade a mais para lembrar de atualizar.
 */
function isPublicEventStatus(status: EventStatus): boolean {
  return (PUBLICLY_VISIBLE_EVENT_STATUSES as readonly string[]).includes(status);
}

function ascendingStart(
  a: Pick<TenantEventDateSource, 'startsAt' | 'endsAt' | 'id'>,
  b: Pick<TenantEventDateSource, 'startsAt' | 'endsAt' | 'id'>,
): number {
  const left = a.startsAt ?? a.endsAt;
  const right = b.startsAt ?? b.endsAt;

  // Sem data vai para o FIM da lista (não some, mas não ocupa o lugar do próximo).
  if (!left && !right) return compareId(a.id, b.id);
  if (!left) return 1;
  if (!right) return -1;
  if (left.getTime() !== right.getTime()) return left.getTime() - right.getTime();

  return compareId(a.id, b.id);
}

function descendingEnd(
  a: Pick<TenantEventDateSource, 'startsAt' | 'endsAt' | 'id'>,
  b: Pick<TenantEventDateSource, 'startsAt' | 'endsAt' | 'id'>,
): number {
  const left = a.endsAt ?? a.startsAt;
  const right = b.endsAt ?? b.startsAt;

  if (!left && !right) return compareId(a.id, b.id);
  if (!left) return 1;
  if (!right) return -1;
  if (left.getTime() !== right.getTime()) return right.getTime() - left.getTime();

  return compareId(a.id, b.id);
}

/** Desempate estável: sem ele, dois eventos no mesmo instante trocam de lugar a cada render. */
function compareId(a: string, b: string): number {
  return a.localeCompare(b);
}

function toCard(
  event: TenantEventDateSource,
  group: TenantEventGroup,
  timeZone: string,
): TenantEventCard {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    periodLabel: formatTenantEventPeriod(event, timeZone),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    /** O selo de "acontecendo agora" é do GRUPO — a mesma conta, uma vez só. */
    isHappeningNow: group === 'ONGOING',
  };
}

/**
 * O período em uma linha, no fuso da instituição.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A DATA É ESCRITA NO FUSO DA INSTITUIÇÃO, E NÃO NOUTC
 * ─────────────────────────────────────────────────────────────────────────────
 *  Quem lê a vitrine da casa está pensando no horário da casa. O mesmo evento
 *  escrito em UTC mostraria "11:00" para um evento das 08:00 em Salvador — e a
 *  pessoa chegaria três horas depois. A conversão é a MESMA função que a página do
 *  evento usa desde a FASE 24 (`formatZonedDateTime`), e não uma segunda conta.
 */
export function formatTenantEventPeriod(
  event: Pick<TenantEventDateSource, 'startsAt' | 'endsAt'>,
  timeZone: string,
): string {
  const startsAt = event.startsAt;
  const endsAt = event.endsAt;

  if (!startsAt && !endsAt) return 'Data a definir';

  // Só o fim conhecido: o evento é anunciado pelo que se sabe.
  if (!startsAt) return `Encerra em ${formatZonedDateTime(endsAt as Date, timeZone)}`;

  if (!endsAt || endsAt.getTime() === startsAt.getTime()) {
    return formatZonedDateTime(startsAt, timeZone);
  }

  /** Mesmo dia: não repete a data duas vezes ("10/11/2026 08:00 às 18:00"). */
  const startDay = formatZonedDay(startsAt, timeZone);
  const endDay = formatZonedDay(endsAt, timeZone);

  if (startDay === endDay) {
    return `${formatZonedDateTime(startsAt, timeZone)} às ${formatZonedTime(endsAt, timeZone)}`;
  }

  return `${formatZonedDateTime(startsAt, timeZone)} até ${formatZonedDateTime(endsAt, timeZone)}`;
}

function formatZonedDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeZone: safeZone(timeZone),
  }).format(instant);
}

function formatZonedTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeStyle: 'short',
    timeZone: safeZone(timeZone),
  }).format(instant);
}

/**
 * O fuso da instituição é texto livre no banco (`Tenants.timezone`).
 *
 * Um valor inválido não pode virar página em branco: cai em UTC e a data sai
 * errada, mas sai — o mesmo critério do `formatZonedDateTime` do evento.
 */
function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}
