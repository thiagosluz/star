/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — A CHAMADA DE TRABALHOS É OPCIONAL (FASE 68)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É REGRA, E NÃO UM `if` NA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O bloco `TRACKS` da página pública anunciava **"Chamada de trabalhos"** e
 *  **"Submeta seu trabalho na trilha correspondente ao tema."** sempre que o evento
 *  tivesse trilha cadastrada. Sem janela, sem estado e sem link: um convite que o
 *  evento não faz — e que, num evento corporativo que nunca recebe artigo, é uma
 *  promessa que ninguém vai cumprir.
 *
 *  O que o bloco NÃO sabia era a diferença entre **não usar chamada** e **não ter
 *  configurado a chamada**. É a mesma distinção que o painel de prontidão (F53)
 *  precisava fazer — e por isso ela vive aqui, pura e testável sem navegador, e não
 *  espalhada em condição de JSX.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "RECEBE TRABALHOS" TEM DUAS FONTES, E É DE PROPÓSITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • o **interruptor do evento** (`Event.usesCall`) — a declaração explícita de quem
 *    organiza: "este evento recebe trabalhos", mesmo antes de a chamada existir;
 *  • a **chamada publicada** (F33) — que é o evento dizendo o mesmo com o fato, e não
 *    com a intenção.
 *
 *  Por isso quem chama passa o fato já combinado (`receivesSubmissions = interruptor
 *  OU existe chamada publicada`): uma chamada no ar num evento com o interruptor
 *  desligado continuaria sendo um convite verdadeiro — e a contradição do organizador
 *  se resolve a favor do que o público está vendo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** O que a página pública faz com as trilhas deste evento. */
export type TracksAnnouncement = 'ANNOUNCE' | 'INVENTORY' | 'SILENT';

/**
 * O bloco de trilhas deve convidar, inventariar ou se calar?
 *
 *  • `SILENT` — o evento **não recebe trabalhos**: não há convite a fazer. O bloco
 *    inteiro sai do HTML (não é `hidden`: o que não é renderizado não é lido por
 *    ninguém, nem por leitor de tela, nem pelo `Ctrl+U`).
 *  • `INVENTORY` — o evento recebe trabalhos, mas ainda não há chamada publicada para
 *    onde mandar o autor. O bloco continua (a lista de eixos temáticos é informação
 *    útil sobre o evento), mas ele **não convida a submeter**: dizer "submeta seu
 *    trabalho" sem nenhuma chamada publicada mandaria o visitante procurar um
 *    formulário que não existe.
 *  • `ANNOUNCE` — há chamada publicada: o convite é verdadeiro e o bloco é o dele.
 */
export function tracksAnnouncement(input: {
  /** `Event.usesCall` **ou** existe chamada publicada da F33 (ver o cabeçalho). */
  receivesSubmissions: boolean;
  hasPublishedCall: boolean;
  trackCount: number;
}): TracksAnnouncement {
  if (input.trackCount === 0) return 'SILENT';
  if (!input.receivesSubmissions) return 'SILENT';

  return input.hasPublishedCall ? 'ANNOUNCE' : 'INVENTORY';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O CAMINHO ANTIGO, QUANDO O EVENTO TEM CHAMADA (FASE 68)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O SERVIDOR RECUSA, E NÃO SÓ A TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O código `CFP_CLOSED` existia em `submission-service.ts` desde a FASE 4 e **nunca
 *  era devolvido**: quem submetia por trilha entrava, e a única barreira era o filtro
 *  da consulta, que lia a janela do evento — a coluna que ninguém escrevia. Com a
 *  janela removida, sem esta regra o portão simplesmente sumiria.
 *
 *  O que o portão decide é uma coisa só, e ela é estreita de propósito: **o evento tem
 *  chamada publicada?** Se tem, a submissão por trilha é um SEGUNDO caminho para o
 *  mesmo fato — um rascunho que não passa pela janela, pelo limite por autor nem pela
 *  rubrica da chamada. Se não tem, o caminho antigo continua valendo (é o que os
 *  testes de revisão por pares exercitam), e sem prazo: quem diz se a chamada está
 *  aberta é a `CallForProposals`, na leitura.
 *
 *  A recusa cita o caminho certo — quem lê "esta chamada está encerrada" precisa saber
 *  ONDE a chamada vive, senão vai procurar o prazo no lugar errado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export type LegacySubmissionPermission =
  | { ok: true }
  | { ok: false; code: 'CFP_CLOSED'; message: string };

export function legacySubmissionPermission(input: {
  /** O evento tem QUALQUER chamada publicada da F33? */
  eventHasPublishedCall: boolean;
}): LegacySubmissionPermission {
  if (!input.eventHasPublishedCall) return { ok: true };

  return {
    ok: false,
    code: 'CFP_CLOSED',
    message:
      'Este evento recebe trabalhos por uma chamada — envie a proposta pela página da chamada, que tem prazo, tipo e limite próprios.',
  };
}
