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
 *  `intervalsOverlap` é a régua do domínio (`src/domain/agenda/overlap-rules.ts`), e
 *  ela já decidiu as bordas: **encostar não é choque, conter é, sem horário não
 *  choca**. Uma segunda comparação de datas neste arquivo criaria duas respostas para
 *  a mesma pergunta — e a que ficasse para trás passaria a avisar choque onde não há.
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
import { intervalsOverlap } from '@/domain/agenda/overlap-rules';
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
 * Os itens da MINHA grade que disputam o mesmo tempo com o candidato.
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
 *  O resto é do DOMÍNIO: quem responde "sobrepõe?" é `intervalsOverlap`, com as
 *  bordas já decididas lá (encostar não é choque; conter é; sem horário não choca).
 */
export function clashesWithAgenda(
  candidate: AgendaCandidate,
  items: readonly AgendaViewerItem[],
): AgendaViewerItem[] {
  if (candidate.status === 'CANCELED') return [];

  return items.filter(
    (item) =>
      item.status !== 'CANCELED' &&
      item.activityId !== candidate.activityId &&
      intervalsOverlap(candidate, item),
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
