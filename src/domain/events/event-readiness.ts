/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O QUE FALTA PARA O EVENTO FICAR PRONTO (FASE 53)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É REGRA, E NÃO UMA LISTA ESCRITA NA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela de gerenciar evento mostrava tudo o que existe (salas, programação,
 *  chamada, reconhecimento) e nada sobre o que FALTA. Quem organiza um evento pela
 *  primeira vez não sabe que uma sala sem capacidade definida não limita vaga
 *  nenhuma, nem que a chamada publicada sem prazo aceita proposta para sempre.
 *
 *  Cada pendência é uma REGRA com o seu caminho de correção — e por isso vive aqui,
 *  pura: o teste prova, sem navegador, que "3 vagas retidas" aparece quando há 3 e
 *  desaparece quando não há, que a sala sem capacidade vira pendência, e que um
 *  evento completo sai com a lista VAZIA (o painel precisa saber dizer "está tudo
 *  certo", e não inventar serviço).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE **NÃO** É PENDÊNCIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • **Evento sem trilha** — evento corporativo ou comunitário não tem eixo
 *    temático, e a trilha é obrigatória só na ciência (FASE 33). Listar isso como
 *    falta seria acusar o organizador de não fazer o que ele não precisa fazer.
 *  • **Evento sem patrocinador** — patrocínio é oportunidade comercial, não
 *    requisito de evento pronto.
 *  • **Evento sem atividade** só conta quando ele JÁ está publicado: rascunho em
 *    montagem tem programação vazia por definição, e o organizador sabe disso.
 *  • **Evento que NÃO recebe trabalhos** (FASE 68) — a chamada virou interruptor: sem
 *    ele ligado, nem o prazo da chamada nem a trilha temática são cobrados. Antes, o
 *    painel exigia trilha de um evento corporativo que nunca vai receber artigo — e a
 *    régua do "não configurou" era, na verdade, a janela do evento que ninguém
 *    escrevia.
 *
 *  Pendência que não é acionável é ruído — e ruído ensina a ignorar o painel.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Quão cedo isso precisa de atenção. `BLOCKING` = atrapalha quem já está no fluxo. */
export type ReadinessSeverity = 'BLOCKING' | 'ATTENTION';

export interface ReadinessItem {
  id: string;
  /** O que falta, em uma linha — sem jargão. */
  title: string;
  /** Por que isso importa (o efeito concreto, não a teoria). */
  detail: string;
  severity: ReadinessSeverity;
  /** O caminho que resolve — o `data-testid` do atalho na própria tela. */
  targetTestId: string;
}

/** Os fatos que a tela já carrega. Nada aqui é buscado de novo. */
export interface EventReadinessFacts {
  status: string;
  activityCount: number;
  registrationCount: number;
  trackCount: number;
  /** Inscrições que RETÊM vaga esperando conferência da equipe. */
  pendingConfirmations: number;
  /** Salas com capacidade indefinida (`null` = sem limite). */
  roomsWithoutCapacity: number;
  roomCount: number;
  /**
   * O evento RECEBE trabalhos? (FASE 68)
   *
   * É o que separa "não usa chamada" de "não configurou a chamada". Sem este fato,
   * um evento corporativo era cobrado por uma trilha temática que ele nunca vai ter.
   */
  usesCall: boolean;
  /**
   * Existe CHAMADA da F33 publicada? (FASE 68)
   *
   * Até esta fase o fato vinha da janela do evento (`cfpOpensAt !== null`) — que
   * ninguém escrevia. O painel então acusava "publicada sem prazo" para um evento com
   * a janela preenchida e ZERO chamadas, e mandava o organizador para uma tela vazia.
   * Agora quem responde é a fonte da verdade: `call_for_proposals.isPublished`.
   */
  hasPublishedCall: boolean;
  /** Existe chamada publicada SEM prazo de encerramento? (`closesAt` nulo.) */
  callWithoutDeadline: boolean;
  /** Data de encerramento das inscrições (`null` = sem prazo). */
  registrationHasDeadline: boolean;
}

/** O evento está no ar (deixou de ser rascunho)? */
export function isEventLive(status: string): boolean {
  return status !== 'DRAFT' && status !== 'CANCELED';
}

/**
 * As pendências, na ordem em que doem: o que trava quem já está no fluxo primeiro.
 *
 * A ordem é deliberada — vagas retidas vencem sozinhas e viram cancelamento, então
 * vêm antes de qualquer coisa de configuração.
 */
export function eventReadiness(facts: EventReadinessFacts): readonly ReadinessItem[] {
  const itens: ReadinessItem[] = [];

  if (facts.pendingConfirmations > 0) {
    itens.push({
      id: 'confirmacoes',
      title:
        facts.pendingConfirmations === 1
          ? '1 inscrição espera confirmação de vaga'
          : `${facts.pendingConfirmations} inscrições esperam confirmação de vaga`,
      detail:
        'Enquanto ninguém confere, a vaga fica retida — e o prazo vencido devolve o lugar para a lista de espera.',
      severity: 'BLOCKING',
      targetTestId: 'confirmations-link',
    });
  }

  if (facts.roomCount > 0 && facts.roomsWithoutCapacity > 0) {
    itens.push({
      id: 'salas-sem-capacidade',
      title:
        facts.roomsWithoutCapacity === 1
          ? '1 sala está sem capacidade definida'
          : `${facts.roomsWithoutCapacity} salas estão sem capacidade definida`,
      detail:
        'Sem capacidade, a sala não limita vaga nenhuma: o limite efetivo passa a ser só o da atividade.',
      severity: 'ATTENTION',
      targetTestId: 'event-area-salas',
    });
  }

  if (isEventLive(facts.status) && facts.activityCount === 0) {
    itens.push({
      id: 'sem-programacao',
      title: 'O evento está no ar e não tem nenhuma atividade na programação',
      detail: 'Sem atividade não há inscrição por atividade, presença nem certificado.',
      severity: 'BLOCKING',
      targetTestId: 'activities-section',
    });
  }

  if (!facts.registrationHasDeadline) {
    itens.push({
      id: 'inscricoes-sem-prazo',
      title: 'As inscrições não têm data de encerramento',
      detail: 'Sem prazo, a inscrição segue aberta depois do evento começar.',
      severity: 'ATTENTION',
      targetTestId: 'event-area-dados',
    });
  }

  if (facts.usesCall && facts.callWithoutDeadline) {
    itens.push({
      id: 'chamada-sem-prazo',
      title: 'A chamada de trabalhos está publicada sem prazo de encerramento',
      detail: 'A chamada aceita proposta para sempre — e o comitê não tem quando fechar.',
      severity: 'ATTENTION',
      targetTestId: 'calls-link',
    });
  }

  /**
   * A trilha só é cobrada de quem USA chamada (FASE 68). A condição inclui
   * `usesCall` porque a chamada publicada LIGA o interruptor: um evento que recebe
   * trabalhos não pode ficar sem o eixo que o comitê usa para distribuir parecer.
   */
  if (
    facts.usesCall &&
    facts.hasPublishedCall &&
    facts.activityCount > 0 &&
    facts.trackCount === 0
  ) {
    itens.push({
      id: 'chamada-sem-trilha',
      title: 'A chamada de trabalhos está publicada e não há trilha cadastrada',
      detail:
        'A trilha é o eixo temático que o comitê usa para distribuir parecer — sem ela, a submissão científica fica sem classificação.',
      severity: 'ATTENTION',
      /**
       * A tela do EVENTO, e não a seção: as trilhas passaram a viver junto das chamadas
       * (FASE 53), então o caminho para criar a que falta é o mesmo atalho da chamada.
       */
      targetTestId: 'calls-link',
    });
  }

  /** A ausência total de inscrição só vira pendência depois que o evento está no ar. */
  if (isEventLive(facts.status) && facts.registrationCount === 0) {
    itens.push({
      id: 'sem-inscricao',
      title: 'Ainda não há nenhuma inscrição',
      detail: 'Se o evento já está no ar, vale conferir se a página pública está divulgada.',
      severity: 'ATTENTION',
      targetTestId: 'landing-link',
    });
  }

  return itens;
}

/** Quantas pendências são bloqueantes — o número que a tela destaca. */
export function blockingCount(items: readonly ReadinessItem[]): number {
  return items.filter((item) => item.severity === 'BLOCKING').length;
}
