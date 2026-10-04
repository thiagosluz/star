/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — "MINHA GRADE" (FASE 65 · fatia 1)
 *
 *  A grade do participante é a UNIÃO de duas coisas que nasceram separadas:
 *
 *      FAVORITOS   — o que a pessoa marcou para não perder de vista;
 *      INSCRIÇÕES  — o que ela de fato garantiu (inclusive as automáticas das
 *                    atividades abertas, que a inscrição no evento cria).
 *
 *  Cada item sai com a MARCA correspondente, porque as duas coisas significam
 *  coisas diferentes: `FAVORITO` é intenção, `INSCRITO` é lugar. Somar as listas
 *  sem marca faria a tela prometer vaga para quem só marcou — e é exatamente isso
 *  que a FASE 65 proíbe (favoritar não reserva lugar).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ENTRA NA GRADE, E O QUE FICA DE FORA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • ATIVIDADE EM RASCUNHO NÃO ENTRA. A programação pública esconde `DRAFT`, e
 *      uma grade que a mostrasse revelaria à pessoa um título que a instituição
 *      ainda não publicou — inclusive se o favorito tiver sido gravado por um
 *      caminho que não passou pela tela. A regra se defende sozinha, em vez de
 *      confiar no filtro de quem chamou.
 *    • INSCRIÇÃO CANCELADA NÃO ENTRA. A régua de "inscrição viva" é a MESMA do
 *      índice único parcial do banco (`registrationIsLive`, armadilha 103): quem
 *      cancelou (ou perdeu a vaga pelo prazo) não tem mais lugar — e a grade não
 *      pode dizer que tem.
 *    • INSCRIÇÃO NO EVENTO (sem atividade) NÃO VIRA ITEM. Ela não tem horário nem
 *      sala; o que ela dá é o acesso às atividades abertas, e essas chegam como
 *      inscrições `EVENT_AUTO` com atividade própria.
 *    • ATIVIDADE CANCELADA ENTRA, mas NÃO gera choque. A pessoa precisa VER que a
 *      sessão dela foi cancelada; o que ela não precisa é ser avisada de que essa
 *      sessão cancela algo que ela ainda vai fazer.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ORDENAÇÃO É PELO INSTANTE — E É ASSIM QUE ELA FICA "NO FUSO DO EVENTO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `startsAt` é `TIMESTAMPTZ`: o instante é a verdade, e comparar instantes é
 *  comparar cronologia real. Ordenar pela HORA DE PAREDE poderia inverter dois
 *  itens perto de uma virada de horário de verão (em que 01:30 local acontece
 *  depois de 01:15 local) — a grade mostraria a tarde antes da manhã.
 *
 *  O fuso do evento entra onde ele é o dono da informação: nos RÓTULOS
 *  (`startsAtLabel`/`endsAtLabel`), pela MESMA função da FASE 24
 *  (`formatZonedDateTime`) — uma régua só para "que horas são no evento".
 *
 *  Empate de horário é desempatado por TÍTULO (e, se ainda empatar, pelo id), para
 *  a tela não mudar de ordem entre duas visitas com os mesmos dados.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { findOverlapPairs, type AgendaInterval } from '@/domain/agenda/overlap-rules';
import { registrationIsLive, type RegistrationStatus } from '@/domain/events/registration-rules';
import { formatZonedDateTime, isValidTimeZone } from '@/domain/events/scheduling-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Entrada: os FATOS, sem Prisma e sem tela
// ───────────────────────────────────────────────────────────────────────────────
/** Status de atividade (espelha `ActivityStatus` do schema; o domínio não importa o ORM). */
export type AgendaActivityStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'FULL'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELED';

/** A atividade como a grade precisa dela. Nada de descrição, tags ou imagem. */
export interface AgendaActivityFact {
  id: string;
  title: string;
  slug: string;
  status: AgendaActivityStatus;
  startsAt: Date;
  endsAt: Date;
  type: string;
  roomName: string | null;
  workloadMinutes: number;
}

/** O vínculo de inscrição reduzido ao que a marca precisa. */
export interface AgendaRegistrationFact {
  activityId: string;
  status: RegistrationStatus;
}

export interface BuildMyAgendaInput {
  /** Fuso do EVENTO (IANA). Rótulos saem nele; a ordem sai do instante. */
  timezone: string;
  /** Todas as atividades visíveis do evento — a grade só usa as que a pessoa toca. */
  activities: readonly AgendaActivityFact[];
  /** Ids das atividades favoritadas por esta pessoa NESTE evento. */
  favoriteActivityIds: readonly string[];
  /** Inscrições da pessoa NESTE evento (inclusive as automáticas). */
  registrations: readonly AgendaRegistrationFact[];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Saída: a grade pronta
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A marca do item. São TRÊS, e não duas bandeiras soltas, porque a tela precisa
 * de um rótulo único e a regra precisa de um valor comparável:
 *   `FAVORITO`            — só marcou (NÃO tem lugar);
 *   `INSCRITO`            — só se inscreveu;
 *   `INSCRITO_E_FAVORITO` — as duas coisas.
 */
export type AgendaMark = 'INSCRITO' | 'FAVORITO' | 'INSCRITO_E_FAVORITO';

/** Rótulo pronto em português — a tela não inventa o seu. */
export const AGENDA_MARK_LABELS: Record<AgendaMark, string> = {
  INSCRITO: 'Inscrito',
  FAVORITO: 'Favorito',
  INSCRITO_E_FAVORITO: 'Inscrito e favorito',
};

export interface AgendaEntry {
  activityId: string;
  title: string;
  slug: string;
  status: AgendaActivityStatus;
  type: string;
  roomName: string | null;
  workloadMinutes: number;
  startsAt: Date;
  endsAt: Date;
  /** Início no fuso do evento — "01/12/2026, 18:00". */
  startsAtLabel: string;
  /** Fim no fuso do evento. */
  endsAtLabel: string;
  mark: AgendaMark;
  markLabel: string;
  registered: boolean;
  favorited: boolean;
  /**
   * Estado da inscrição, quando existe. `WAITLISTED` continua sendo uma inscrição
   * VIVA (a pessoa está na fila, e a vaga pode chegar) — a tela diz "na lista de
   * espera" com este campo, em vez de inventar uma quarta marca.
   */
  registrationStatus: RegistrationStatus | null;
  /** Este item disputa o mesmo horário com pelo menos outro. */
  hasClash: boolean;
}

/** Um par que disputa o mesmo tempo. Só AVISA: nenhum dos dois é "o errado". */
export interface AgendaClash {
  firstActivityId: string;
  secondActivityId: string;
  firstTitle: string;
  secondTitle: string;
}

export interface MyAgenda {
  timezone: string;
  entries: AgendaEntry[];
  clashes: AgendaClash[];
  counts: {
    entries: number;
    registered: number;
    favorited: number;
    both: number;
    clashPairs: number;
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  A regra
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Uma atividade em RASCUNHO não é agenda de ninguém (ver o cabeçalho).
 *
 * Mora numa função porque o mesmo critério é usado pelo SERVIÇO na hora de
 * favoritar: duas cópias do `status !== 'DRAFT'` divergiriam no dia em que um
 * status novo (ou uma regra de visibilidade) aparecesse.
 */
export function isOnAgenda(status: AgendaActivityStatus): boolean {
  return status !== 'DRAFT';
}

/** Quantos itens estão na grade (usado pela tela para o resumo). */
export function agendaMarkOf(registered: boolean, favorited: boolean): AgendaMark {
  if (registered && favorited) return 'INSCRITO_E_FAVORITO';
  if (registered) return 'INSCRITO';
  return 'FAVORITO';
}

/**
 * Monta a "minha grade": união com marcas, choques e ordem.
 *
 * Função PURA — sem Prisma, sem Next, sem relógio: o banco entrega os fatos e a
 * decisão inteira é testável sem infraestrutura (é o que o teste de unidade faz
 * com as bordas de sobreposição).
 */
export function buildMyAgenda(input: BuildMyAgendaInput): MyAgenda {
  /**
   * Fuso inválido cai em UTC em vez de derrubar a leitura — a MESMA escolha de
   * `formatZonedDateTime`. Uma grade com horário em UTC é ruim; uma grade que não
   * abre porque o organizador digitou "America/Bahiaa" é pior.
   */
  const timezone = isValidTimeZone(input.timezone) ? input.timezone : 'UTC';

  /**
   * O mapa de inscrições vivas. O banco garante UMA inscrição viva por
   * (atividade, pessoa) pelo índice único parcial; se duas chegarem (dado antigo),
   * a PRIMEIRA vence, e o resultado não depende da ordem do banco.
   */
  const registrationByActivity = new Map<string, RegistrationStatus>();

  for (const registration of input.registrations) {
    if (!registrationIsLive(registration.status)) continue;
    if (!registrationByActivity.has(registration.activityId)) {
      registrationByActivity.set(registration.activityId, registration.status);
    }
  }

  const favorites = new Set(input.favoriteActivityIds);

  const entries: AgendaEntry[] = [];

  for (const activity of input.activities) {
    if (!isOnAgenda(activity.status)) continue;

    const registrationStatus = registrationByActivity.get(activity.id) ?? null;
    const registered = registrationStatus !== null;
    const favorited = favorites.has(activity.id);

    // A união: o que a pessoa não marcou e não inscreveu não é agenda dela.
    if (!registered && !favorited) continue;

    const mark = agendaMarkOf(registered, favorited);

    entries.push({
      activityId: activity.id,
      title: activity.title,
      slug: activity.slug,
      status: activity.status,
      type: activity.type,
      roomName: activity.roomName,
      workloadMinutes: activity.workloadMinutes,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      startsAtLabel: formatZonedDateTime(activity.startsAt, timezone),
      endsAtLabel: formatZonedDateTime(activity.endsAt, timezone),
      mark,
      markLabel: AGENDA_MARK_LABELS[mark],
      registered,
      favorited,
      registrationStatus,
      hasClash: false,
    });
  }

  entries.sort(compareAgendaEntries);

  /**
   * ── OS CHOQUES ──────────────────────────────────────────────────────────────
   *
   * A atividade CANCELADA fica de fora, e o porquê está no cabeçalho: ela não vai
   * acontecer, então avisar choque contra ela mandaria a pessoa mexer num plano
   * que não existe. (O item SEM horário é tratado pela própria régua de
   * sobreposição, que responde `false` para ele — ver `overlap-rules.ts`.)
   *
   * O par carrega os títulos porque é ISSO que a tela mostra — devolver só ids
   * obrigaria cada consumidor a procurar os dois na lista de novo, e um deles
   * acharia o índice errado.
   */
  const clashable = entries.filter((entry) => entry.status !== 'CANCELED');

  const pairs = findOverlapPairs<AgendaEntry>(clashable, (entry): AgendaInterval => ({
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
  }));

  const clashIds = new Set<string>();

  for (const pair of pairs) {
    clashIds.add(pair.first.activityId);
    clashIds.add(pair.second.activityId);
  }

  for (const entry of entries) {
    entry.hasClash = clashIds.has(entry.activityId);
  }

  return {
    timezone,
    entries,
    clashes: pairs.map((pair) => ({
      firstActivityId: pair.first.activityId,
      secondActivityId: pair.second.activityId,
      firstTitle: pair.first.title,
      secondTitle: pair.second.title,
    })),
    counts: {
      entries: entries.length,
      registered: entries.filter((entry) => entry.registered).length,
      favorited: entries.filter((entry) => entry.favorited).length,
      both: entries.filter((entry) => entry.registered && entry.favorited).length,
      clashPairs: pairs.length,
    },
  };
}

/**
 * Ordem da grade: por INÍCIO (instante), depois fim, depois título e id.
 *
 * Os dois últimos critérios existem para a ordem ser DETERMINÍSTICA: sem eles,
 * duas atividades no mesmo horário trocariam de lugar entre duas leituras, e a
 * tela (e o teste) pareceriam instáveis por um motivo que não é instabilidade.
 */
function compareAgendaEntries(a: AgendaEntry, b: AgendaEntry): number {
  const byStart = a.startsAt.getTime() - b.startsAt.getTime();
  if (byStart !== 0) return byStart;

  const byEnd = a.endsAt.getTime() - b.endsAt.getTime();
  if (byEnd !== 0) return byEnd;

  const byTitle = a.title.localeCompare(b.title, 'pt-BR');
  if (byTitle !== 0) return byTitle;

  return a.activityId.localeCompare(b.activityId);
}
