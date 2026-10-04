/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — "ACONTECENDO AGORA" (FASE 65 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PERGUNTA DESTA REGRA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "O que está em curso NESTE INSTANTE, e onde?" — com a resposta agrupada pela
 *  SALA, que é como quem está no evento procura a informação ("o que tem no
 *  auditório agora?"), e não pela ordem da grade.
 *
 *  O INSTANTE ENTRA POR PARÂMETRO. A regra não lê relógio: quem decide "agora" é o
 *  servidor, uma vez por renderização, e desce para cá. É o que faz a aba continuar
 *  correta ao recarregar (o HTML sai pronto) e o que permite ao teste varrer as
 *  bordas do intervalo sem depender da hora em que a suíte roda.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS BORDAS, DECIDIDAS — E POR QUE **NÃO** SÃO AS DA SOBREPOSIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • **COMEÇAR AGORA É ESTAR EM CURSO** (`startsAt <= now`). Às 10:00 em ponto, a
 *      atividade das 10:00 está acontecendo: quem abre a tela nesse segundo tem de
 *      vê-la, não esperar o próximo carregamento.
 *    • **TERMINAR AGORA NÃO É ESTAR EM CURSO** (`endsAt > now`). Às 11:00 em ponto, a
 *      atividade que acabava às 11:00 acabou. A sala já é da próxima.
 *
 *  As bordas de `overlap-rules.ts` respondem OUTRA pergunta — "dois itens disputam o
 *  mesmo tempo?" — e lá encostar NÃO é choque. Reusá-las aqui faria o "agora" dizer
 *  "em curso" para algo que terminou neste instante, e o aviso de choque perder o
 *  sentido (dois itens em sequência passariam a "colidir"). São duas réguas porque
 *  são duas perguntas; a proximidade está no formato (início inclusivo, fim
 *  exclusivo), que é o mesmo das duas.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FICA DE FORA, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • RASCUNHO não existe para o público (`isOnAgenda` da fatia 1 é a MESMA régua);
 *    • CANCELADA não está acontecendo — anunciar "em curso" o que a instituição
 *      cancelou é pior do que não anunciar nada. Ela também não entra no "a seguir"
 *      da sala: ninguém vai para a sala de uma atividade cancelada;
 *    • SEM HORÁRIO não está em curso nem é "a seguir": não ocupa tempo nenhum.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { formatZonedDateTime, isValidTimeZone } from '@/domain/events/scheduling-rules';
import { isOnAgenda, type AgendaActivityStatus } from '@/domain/agenda/agenda-rules';

/** A atividade como a visão do "agora" precisa dela. Nada de descrição ou vagas. */
export interface NowActivityFact {
  id: string;
  title: string;
  slug: string;
  status: AgendaActivityStatus;
  startsAt: Date;
  endsAt: Date;
  roomName: string | null;
  /** Nomes para exibição — quem está conduzindo a sessão que está em curso. */
  speakerNames: readonly string[];
}

/** Rótulo usado quando a atividade não tem sala cadastrada. */
export const NO_ROOM_LABEL = 'Sem sala';

/** A atividade em curso, como a tela a desenha. */
export interface NowItem {
  activityId: string;
  title: string;
  slug: string;
  roomName: string;
  speakerNames: readonly string[];
  /** Instantes (UTC) — a ORDEM dos itens sai daqui, nunca do rótulo formatado. */
  startsAt: Date;
  endsAt: Date;
  /** Início no fuso do EVENTO — "01/12/2026, 10:00". */
  startsAtLabel: string;
  endsAtLabel: string;
  /** "termina em 1 h 20 min" / "termina em menos de 1 min". */
  remainingLabel: string;
  /** Minutos inteiros até o fim (nunca negativo). */
  remainingMinutes: number;
  /** Quanto já decorreu, de 0 a 100 — o dado da barra de progresso. */
  progressPercent: number;
}

/** Uma sala com o que está em curso nela e o que vem depois. */
export interface NowRoom {
  /** `null` = atividade sem sala; a tela mostra `NO_ROOM_LABEL`. */
  roomKey: string | null;
  roomName: string;
  items: readonly NowItem[];
  /** O que começa em seguida NESTA sala — `null` quando não há próxima conhecida. */
  nextLabel: string | null;
  nextStartsAtLabel: string | null;
}

export interface HappeningNowView {
  /** O fuso EFETIVO usado nos rótulos (inválido cai em UTC, como no resto do sistema). */
  timezone: string;
  rooms: readonly NowRoom[];
  totalItems: number;
  /** Nada em curso: a faixa do topo da programação NÃO aparece. */
  isEmpty: boolean;
}

export interface BuildHappeningNowInput {
  /** Fuso do EVENTO (IANA). */
  timezone: string;
  /** O instante decidido pelo SERVIDOR. */
  now: Date;
  activities: readonly NowActivityFact[];
}

/**
 * A visão VAZIA — usada pelos consumidores que não têm como decidir o "agora".
 *
 * A pré-visualização do rascunho (`/administracao/eventos/<id>/pagina/previa`) monta a
 * landing page com o DADO do evento, e não com a leitura pública: ela passa esta visão
 * vazia, e a faixa do "acontecendo agora" simplesmente não aparece. É o comportamento
 * certo: a prévia existe para o organizador conferir o DESENHO da página, e afirmar
 * "3 atividades em curso" ali seria afirmar sobre um relógio que ninguém pediu.
 */
export const EMPTY_HAPPENING_NOW: HappeningNowView = {
  timezone: 'UTC',
  rooms: [],
  totalItems: 0,
  isEmpty: true,
};

/**
 * O tempo restante em TEXTO — é ele que o leitor de tela ouve e que a tela mostra.
 *
 * Mora no domínio porque é a MESMA frase em três lugares (a faixa, o cartão da aba e
 * o `aria-valuetext`): três cópias divergiriam no primeiro ajuste de redação.
 *
 * "menos de 1 min" existe para o arredondamento não mentir: 30 segundos restantes
 * arredondados para baixo virariam "0 min", que se lê como "acabou".
 */
export function formatRemainingTime(minutes: number, phase: 'antes' | 'em-curso'): string {
  const prefix = phase === 'em-curso' ? 'termina em' : 'faltam';
  const total = Math.max(0, Math.floor(minutes));

  if (total === 0) return `${prefix} menos de 1 min`;
  if (total < 60) return `${prefix} ${total} min`;

  const hours = Math.floor(total / 60);
  const rest = total % 60;

  return rest === 0 ? `${prefix} ${hours} h` : `${prefix} ${hours} h ${rest} min`;
}

/**
 * Quanto do intervalo já decorreu, em pontos percentuais inteiros (0–100).
 *
 * O `clamp` não é decorativo: o instante pode cair fora do intervalo (relógio do
 * processo atrasado, dado corrigido no meio) e uma barra com `aria-valuenow` fora da
 * faixa declarada é um valor inválido para a tecnologia assistiva. Duração zero
 * responde 100 — o intervalo acabou no mesmo instante em que começou.
 */
export function progressPercentOf(input: { startsAt: Date; endsAt: Date; now: Date }): number {
  const total = input.endsAt.getTime() - input.startsAt.getTime();
  if (total <= 0) return 100;

  const decorrido = input.now.getTime() - input.startsAt.getTime();

  return Math.min(100, Math.max(0, Math.round((decorrido / total) * 100)));
}

/** A atividade está em curso neste instante? (início inclusivo, fim exclusivo) */
function isHappeningNow(activity: NowActivityFact, now: number): boolean {
  return activity.startsAt.getTime() <= now && activity.endsAt.getTime() > now;
}

/**
 * A visão do "agora": as atividades em curso agrupadas por sala, cada uma com o
 * horário da sala, o tempo restante e o que começa em seguida.
 *
 * A ordem é DETERMINÍSTICA — sala por nome e item por início, fim, título e id —,
 * pelo mesmo motivo da grade da fatia 1: duas leituras dos mesmos dados não podem
 * trocar as linhas de lugar, senão a tela (e o teste) parecem instáveis por um
 * motivo que não é instabilidade. `Sem sala` vai por último: quem procura uma sala
 * específica não deve encontrá-la depois de um bloco sem nome.
 */
export function buildHappeningNow(input: BuildHappeningNowInput): HappeningNowView {
  const timezone = isValidTimeZone(input.timezone) ? input.timezone : 'UTC';
  const now = input.now.getTime();

  const visiveis = input.activities.filter(
    (activity) => isOnAgenda(activity.status) && activity.status !== 'CANCELED',
  );

  const emCurso = visiveis.filter((activity) => isHappeningNow(activity, now));

  const porSala = new Map<string | null, { items: NowItem[]; todas: NowActivityFact[] }>();

  for (const activity of visiveis) {
    const grupo = porSala.get(activity.roomName) ?? { items: [], todas: [] };
    grupo.todas.push(activity);
    porSala.set(activity.roomName, grupo);
  }

  for (const activity of emCurso) {
    const grupo = porSala.get(activity.roomName);

    /**
     * `grupo` sempre existe: a atividade em curso passou pelo laço acima. O `if`
     * existe porque o compilador não sabe disso — e um `!` aqui esconderia uma
     * mudança futura que quebrasse a garantia.
     */
    if (!grupo) continue;

    const remainingMinutes = Math.floor((activity.endsAt.getTime() - now) / 60_000);

    grupo.items.push({
      activityId: activity.id,
      title: activity.title,
      slug: activity.slug,
      roomName: activity.roomName ?? NO_ROOM_LABEL,
      speakerNames: activity.speakerNames,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      startsAtLabel: formatZonedDateTime(activity.startsAt, timezone),
      endsAtLabel: formatZonedDateTime(activity.endsAt, timezone),
      remainingLabel: formatRemainingTime(remainingMinutes, 'em-curso'),
      remainingMinutes,
      progressPercent: progressPercentOf({ startsAt: activity.startsAt, endsAt: activity.endsAt, now: input.now }),
    });
  }

  const rooms: NowRoom[] = [];

  for (const [roomKey, grupo] of porSala) {
    if (grupo.items.length === 0) continue;

    grupo.items.sort(compareNowItems);

    /**
     * O "a seguir" é o primeiro que COMEÇA depois do fim do que já está em curso
     * nesta sala. A régua é `startsAt > now` — e não "depois do fim do item em
     * curso": uma atividade que começa antes de a atual terminar já está em curso
     * (e estaria na lista de itens), então a próxima é, por definição, a que ainda
     * não começou.
     */
    const proxima = grupo.todas
      .filter((activity) => activity.startsAt.getTime() > now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];

    rooms.push({
      roomKey,
      roomName: roomKey ?? NO_ROOM_LABEL,
      items: grupo.items,
      nextLabel: proxima?.title ?? null,
      nextStartsAtLabel: proxima ? formatZonedDateTime(proxima.startsAt, timezone) : null,
    });
  }

  rooms.sort((a, b) => {
    if (a.roomKey === null) return b.roomKey === null ? 0 : 1;
    if (b.roomKey === null) return -1;

    return a.roomName.localeCompare(b.roomName, 'pt-BR');
  });

  const totalItems = rooms.reduce((total, room) => total + room.items.length, 0);

  return { timezone, rooms, totalItems, isEmpty: totalItems === 0 };
}

/**
 * Ordem dos itens de uma sala.
 *
 * O primeiro critério é o INÍCIO (o que começou antes está mais perto do fim e é o
 * que a pessoa precisa ver primeiro); os demais existem para a ordem não depender do
 * banco: duas atividades no mesmo minuto trocariam de lugar entre duas leituras.
 *
 * A comparação usa os INSTANTES, e nunca os rótulos formatados: comparar "01/12/2026,
 * 09:00" com "01/12/2026, 10:00" como texto funcionaria por acaso neste formato e
 * quebraria em qualquer outro (e "9:00" viria depois de "10:00").
 */
function compareNowItems(a: NowItem, b: NowItem): number {
  const byStart = a.startsAt.getTime() - b.startsAt.getTime();
  if (byStart !== 0) return byStart;

  const byEnd = a.endsAt.getTime() - b.endsAt.getTime();
  if (byEnd !== 0) return byEnd;

  const byTitle = a.title.localeCompare(b.title, 'pt-BR');
  if (byTitle !== 0) return byTitle;

  return a.activityId.localeCompare(b.activityId);
}
