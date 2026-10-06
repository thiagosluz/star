/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — A VISÃO DE AGENDA QUE A PROGRAMAÇÃO PÚBLICA PRECISA (FASE 65 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE (E O QUE ELE **NÃO** FAZ)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 1 entregou a grade PRONTA (`getMyAgenda` + `buildMyAgenda`): os itens que
 *  a pessoa já marcou ou já inscreveu, com marca, choques em pares e contagens. Isso
 *  responde "o que está na minha agenda".
 *
 *  A programação pública precisa de outra pergunta, que a fatia 1 não responde:
 *
 *      "esta atividade que estou VENDO choca com alguma coisa que eu já tenho?"
 *
 *  A diferença é o sujeito: na grade, os dois lados são meus; aqui, um lado é um
 *  candidato que pode nem estar marcado — e é justamente por isso que o aviso
 *  aparece ANTES do clique, para a pessoa decidir com a informação na mão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FÓRMULA NÃO É RECOPIADA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `intervalsClash` é a régua do domínio (`src/domain/agenda/overlap-rules.ts`), e
 *  ela já decidiu as bordas: **encostar não é choque quando não há margem, conter é,
 *  sem horário não choca — e dois itens separados por menos que a margem de
 *  deslocamento entre salas conflitam** (E86 · FASE 69). Uma segunda comparação de
 *  datas neste arquivo criaria duas respostas para a mesma pergunta — e a que ficasse
 *  para trás passaria a avisar choque onde não há.
 *  Aqui só se ESCOLHE o par (o candidato contra a minha grade) e se monta o rótulo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O AVISO SÓ AVISA (decisão do humano, registrada no plano da fase)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nada neste arquivo recusa, ordena por gravidade ou esconde o botão. O que a tela
 *  faz com o retorno é MOSTRAR os títulos e o horário — quem escolhe o que assistir é
 *  o participante, e a Server Action do outro lado grava de qualquer jeito.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O ARQUIVO É PURO (E POR QUE ISSO IMPORTA)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele recebe a grade da fatia 1 e devolve uma visão sem Prisma, sem Next e sem
 *  relógio — é o que permite ao teste de unidade varrer as bordas do aviso (encostar,
 *  conter, idênticos, cancelada, sem horário) sem subir navegador nem banco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  agendaMarkOf,
  AGENDA_MARK_LABELS,
  type AgendaActivityStatus,
  type AgendaEntry,
  type AgendaMark,
  type MyAgenda,
} from '@/domain/agenda/agenda-rules';
import { intervalsClash, ROOM_TRAVEL_MARGIN_MINUTES } from '@/domain/agenda/overlap-rules';
import type { RegistrationStatus } from '@/domain/events/registration-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  A visão
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Um item da MINHA grade, do jeito que a programação precisa dele.
 *
 * É o `AgendaEntry` da fatia 1 reduzido ao que a tela lê — nada de descrição, tags
 * ou vagas. Os rótulos de horário vêm prontos (`startsAtLabel`/`endsAtLabel`, no fuso
 * do EVENTO, pela régua da FASE 24): a tela não formata data, e não há uma segunda
 * régua de "que horas são no evento" nascendo aqui.
 */
export interface AgendaViewerItem {
  activityId: string;
  title: string;
  slug: string;
  status: AgendaActivityStatus;
  startsAt: Date;
  endsAt: Date;
  startsAtLabel: string;
  endsAtLabel: string;
  roomName: string | null;
  favorited: boolean;
  registered: boolean;
  mark: AgendaMark;
  markLabel: string;
  /**
   * Estado da inscrição, quando existe. `WAITLISTED` é inscrição VIVA (a vaga pode
   * chegar) e a tela diz isso com este campo — em vez de inventar uma quarta marca.
   */
  registrationStatus: RegistrationStatus | null;
}

/** A agenda de quem está olhando, na página pública. */
export interface EventAgendaView {
  /**
   * Há SESSÃO?
   *
   * Sem sessão não existe agenda — e a programação não oferece o botão, porque o
   * ato de favoritar é da PESSOA (a posse é o `userId` da sessão, e não há id de
   * pessoa no formulário; ver o comentário da Server Action).
   */
  authenticated: boolean;
  items: readonly AgendaViewerItem[];
  /** O endereço para baixar a agenda inteira (FASE 65 · fatia 3). */
  exportHref: string | null;
}

/**
 * Sem sessão: a programação é a mesma, e nenhuma marca aparece.
 *
 * `exportHref` é `null` porque o endereço da agenda pessoal exige TOKEN — e o token
 * só existe para quem tem sessão. Um endereço sem token não abriria nada, e mostrá-lo
 * seria prometer um arquivo que não vem.
 */
export const EMPTY_AGENDA_VIEW: EventAgendaView = {
  authenticated: false,
  items: [],
  exportHref: null,
};

/** Reduz um item da grade da fatia 1 ao que a tela lê. */
export function agendaViewerItemOf(entry: AgendaEntry): AgendaViewerItem {
  return {
    activityId: entry.activityId,
    title: entry.title,
    slug: entry.slug,
    status: entry.status,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    startsAtLabel: entry.startsAtLabel,
    endsAtLabel: entry.endsAtLabel,
    roomName: entry.roomName,
    favorited: entry.favorited,
    registered: entry.registered,
    mark: entry.mark,
    markLabel: entry.markLabel,
    registrationStatus: entry.registrationStatus,
  };
}

/**
 * A visão a partir do que a fatia 1 devolveu.
 *
 * `getMyAgenda` devolve `null` quando o evento não existe NESTA instituição — e o
 * visitante anônimo nem chega a chamá-lo. Os dois casos caem na MESMA visão vazia, o
 * que é honesto: nenhum item, nenhuma marca, nenhum aviso.
 *
 * O `exportHref` chega PRONTO pela mesma razão que os rótulos de horário já chegam: o
 * endereço do arquivo carrega um token derivado de `BETTER_AUTH_SECRET`, que é segredo
 * de APLICAÇÃO — o domínio não tem como (nem deve) calculá-lo. Quem monta o endereço é
 * a página, com `agendaIcsUrl`, e o que entra aqui é só a string final.
 */
export function buildEventAgendaView(input: {
  authenticated: boolean;
  agenda: MyAgenda | null;
  exportHref?: string | null;
}): EventAgendaView {
  if (!input.authenticated || !input.agenda) return EMPTY_AGENDA_VIEW;

  return {
    authenticated: true,
    items: input.agenda.entries.map(agendaViewerItemOf),
    exportHref: input.exportHref ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  O aviso de choque na ESCOLHA
// ───────────────────────────────────────────────────────────────────────────────
/** A atividade que a pessoa está olhando na programação. */
export interface AgendaCandidate {
  activityId: string;
  startsAt: Date;
  endsAt: Date;
  /** Status da atividade (`CANCELED` não gera aviso — ver abaixo). */
  status: string;
}

/**
 * Os itens da MINHA grade que disputam o mesmo tempo com o candidato — ou que estão
 * perto demais para dar tempo de atravessar até lá.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS EXCLUSÕES, E POR QUE CADA UMA EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *  • **CANCELADA NÃO AVISA, DOS DOIS LADOS.** Uma atividade cancelada não vai
 *    acontecer: avisar choque contra ela mandaria a pessoa mexer num plano que não
 *    existe. É a MESMA exclusão que `buildMyAgenda` faz ao calcular os pares — se
 *    aqui fosse diferente, a programação e a grade diriam coisas distintas sobre o
 *    mesmo par.
 *  • **ELA MESMA NÃO CONTA.** Sem esta linha, o item recém-marcado apareceria
 *    "chocando consigo próprio" (o intervalo sobrepõe a si mesmo), e o aviso viraria
 *    ruído em toda atividade já marcada.
 *
 *  O resto é do DOMÍNIO: quem responde "conflita?" é `intervalsClash`, com as bordas
 *  já decididas lá (encostar não é choque SEM margem; conter é; sem horário não
 *  choca; e dois itens separados por menos que a margem de deslocamento conflitam).
 *  A margem tem default declarado no domínio (`ROOM_TRAVEL_MARGIN_MINUTES`) e é
 *  parâmetro aqui para o teste poder provar o outro lado (margem zero = FASE 65).
 */
export function clashesWithAgenda(
  candidate: AgendaCandidate,
  items: readonly AgendaViewerItem[],
  roomTravelMarginMinutes: number = ROOM_TRAVEL_MARGIN_MINUTES,
): AgendaViewerItem[] {
  if (candidate.status === 'CANCELED') return [];

  return items.filter(
    (item) =>
      item.status !== 'CANCELED' &&
      item.activityId !== candidate.activityId &&
      intervalsClash(candidate, item, roomTravelMarginMinutes),
  );
}

/**
 * O alvo do aviso, por extenso: título e horário (e a sala, quando ela existe).
 *
 * O rótulo nasce AQUI, e não na tela, porque o aviso é a mesma frase em três lugares
 * (o cartão da programação, a confirmação depois de marcar e a lista de choques da
 * minha agenda) — três cópias do mesmo texto divergiriam no primeiro ajuste.
 */
export function clashTargetLabel(item: AgendaViewerItem): string {
  const room = item.roomName ? ` · ${item.roomName}` : '';
  return `${item.title} (${item.startsAtLabel} – ${item.endsAtLabel}${room})`;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O TEXTO DO AVISO — O NÚMERO SAI DO DOMÍNIO (E86 · FASE 69 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A FRASE MUDOU, E POR QUE ELA NÃO PODE VOLTAR A SER "CHOQUE DE HORÁRIO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Com a margem, o aviso passou a aparecer em um caso que a pessoa NÃO enxerga
 *  sozinha: dois itens que não se sobrepõem e que, lado a lado na grade, parecem
 *  perfeitamente compatíveis. Um aviso que dissesse só "choque de horário" mandaria
 *  quem lê conferir os dois relógios, não achar nada errado e concluir que o sistema
 *  está errado — o aviso morre no terceiro caso desses.
 *
 *  Por isso a frase diz QUAL é o problema (o tempo é curto para o DESLOCAMENTO) e
 *  POR QUANTO (o número de minutos). O número NÃO é digitado aqui: ele sai da
 *  constante do domínio, e é por isso que este texto é uma função — uma frase
 *  escrita à mão na tela continuaria dizendo "15" no dia em que a régua mudasse.
 *
 *  O TÍTULO nasce aqui porque é o mesmo nas duas telas que mostram o aviso; a DICA
 *  que fecha o aviso continua sendo de quem chama, porque ela é do CONTEXTO ("marcar
 *  as duas é permitido" na escolha, "a agenda não bloqueia" na grade).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function agendaClashTitle(): string {
  return `Horários próximos demais para o deslocamento (margem de ${ROOM_TRAVEL_MARGIN_MINUTES} minutos) com`;
}

/**
 * A marca do item em uma frase.
 *
 * A união de favoritos e inscrições tem TRÊS estados, e a tela mostra os dois
 * distintivos (coração e ingresso) em vez de um rótulo combinado. A frase existe para
 * o `aria-label` do botão e para os textos de apoio, onde os dois distintivos não
 * cabem — e sai do domínio (`AGENDA_MARK_LABELS`), para não haver um quarto nome para
 * a mesma coisa.
 */
export function markPhrase(registered: boolean, favorited: boolean): string {
  return AGENDA_MARK_LABELS[agendaMarkOf(registered, favorited)];
}
