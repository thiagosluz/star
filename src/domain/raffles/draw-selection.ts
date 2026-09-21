/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SELEÇÃO DO SORTEIO — a parte PURA, que roda no servidor E no navegador
 *  (FASE 8, reorganizada na FASE 29)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO SAIU DE `raffle-rules.ts`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A auditoria pública (FASE 29) reproduz o sorteio NO NAVEGADOR de quem confere —
 *  é o que separa "confie no meu servidor" de "refaça a conta você mesmo". Só que
 *  `raffle-rules.ts` importa `node:crypto` (hash do resultado, HMAC do gerador
 *  semeado), e um módulo com `node:crypto` não atravessa para o cliente.
 *
 *  A saída NÃO foi reescrever a seleção no cliente — duas implementações divergem,
 *  e a auditoria passaria a validar uma regra que não é a que rodou (o defeito que a
 *  FASE 22 documentou para a contagem de elegíveis). A seleção veio para cá, sem
 *  nenhuma dependência de runtime, e os DOIS lados chamam ESTAS funções:
 *
 *    • o servidor apura com `createSeededRandomInt(semente)` (node:crypto);
 *    • o navegador reproduz com o mesmo gerador, montado sobre a WebCrypto.
 *
 *  O que muda entre os dois é só o adaptador de aleatoriedade — e há teste
 *  comparando as duas sequências, byte a byte, para o mesmo par (semente, teto).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Participante elegível, com a evidência que o qualificou. */
export interface EligibleParticipant {
  userId: string;
  userName: string;
  /** Total de minutos considerados no escopo do sorteio. */
  minutes: number;
  /** Presenças que compuseram o total. */
  attendanceIds: string[];
  /** Presença mais relevante (maior tempo), usada como referência. */
  referenceAttendanceId: string | null;
}

/**
 * Uma linha da lista publicada — o que o sorteio realmente consome.
 *
 * O `code` é a identidade pública do participante NAQUELE sorteio; o servidor
 * deriva de (sorteio, participante) e o resultado publica o mesmo código, de modo
 * que a auditoria ligue a linha da lista à posição do resultado sem precisar do
 * `userId`.
 */
export interface RafflePoolEntry {
  /** Posição na lista (1-based). A ORDEM é entrada do sorteio, não enfeite. */
  index: number;
  /** Identidade pública estável (`P-XXXXXXXXXXXX`). */
  code: string;
  /** Minutos assistidos somados. É o peso quando `weightByMinutes` está ligado. */
  minutes: number;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Amostragem sem reposição
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Sorteia `count` participantes distintos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  FISHER-YATES COM FONTE INJETADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A amostragem é SEM REPOSIÇÃO por construção: cada índice já usado sai do
 *  intervalo de sorteio, então ninguém pode ser sorteado duas vezes — a
 *  propriedade não depende de checagem posterior.
 *
 *  O gerador é injetado (`randomInt`) exatamente como no sorteio de cartas da
 *  FASE 5: em produção é a semente comprometida (ou `crypto.randomInt`), nos testes
 *  é uma sequência fixa e no navegador é a WebCrypto. Sem isso, testar distribuição,
 *  ordem e reprodução seria impossível.
 *
 *  Quando faltam elegíveis, o sorteio entrega o que existe — e o chamador informa
 *  quantos foram sorteados de fato, em vez de falhar e não sortear ninguém.
 */
export function selectWinners(
  pool: readonly EligibleParticipant[],
  count: number,
  randomInt: (max: number) => number,
): EligibleParticipant[] {
  const remaining = [...pool];
  const winners: EligibleParticipant[] = [];
  const target = Math.min(Math.max(0, Math.floor(count)), remaining.length);

  for (let index = 0; index < target; index += 1) {
    const draw = randomInt(remaining.length - index);
    const picked = index + Math.max(0, Math.min(draw, remaining.length - index - 1));

    [remaining[index], remaining[picked]] = [remaining[picked]!, remaining[index]!];
    winners.push(remaining[index]!);
  }

  return winners;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Amostragem ponderada por minutos (item G3)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Peso de um participante no sorteio ponderado.
 *
 * O peso é o tempo assistido, com piso 1: quem é elegível com `0` minuto (só
 * possível quando o piso de minutos é zero) continua concorrendo, com chance
 * mínima. Zerar o peso o excluiria — e excluir não é o que "ponderado" significa:
 * quem está na lista de elegíveis concorre.
 */
export function participantWeight(participant: EligibleParticipant): number {
  return Math.max(1, Math.floor(participant.minutes));
}

/**
 * Sorteia `count` participantes com chance PROPORCIONAL aos minutos assistidos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO REUSAR O FISHER-YATES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O embaralhamento uniforme dá a todos a mesma chance, que é exatamente o que a
 *  ponderação precisa desfazer. Aqui cada retirada sorteia um ponto no intervalo
 *  `[0, somaDosPesos)` e percorre a soma acumulada: um participante com o dobro do
 *  tempo ocupa o dobro do intervalo, e portanto tem o dobro da chance.
 *
 *  A retirada é SEM REPOSIÇÃO: quem sai não volta para a próxima rodada, então a
 *  soma é recalculada e ninguém é sorteado duas vezes. Empates de peso são
 *  resolvidos pela ordem do `pool` (que já vem ordenada por nome), e é por isso que
 *  o resultado é reproduzível a partir da mesma semente.
 */
export function selectWeightedWinners(
  pool: readonly EligibleParticipant[],
  count: number,
  randomInt: (max: number) => number,
): EligibleParticipant[] {
  const remaining = [...pool];
  const winners: EligibleParticipant[] = [];
  const target = Math.min(Math.max(0, Math.floor(count)), remaining.length);

  for (let index = 0; index < target; index += 1) {
    const total = remaining.reduce((sum, participant) => sum + participantWeight(participant), 0);
    // `randomInt(total)` devolve `[0, total)`; o acumulado encontra o dono do ponto.
    let point = Math.max(0, Math.min(randomInt(total), total - 1));
    let picked = remaining.length - 1;

    for (let position = 0; position < remaining.length; position += 1) {
      point -= participantWeight(remaining[position]!);

      if (point < 0) {
        picked = position;
        break;
      }
    }

    const [chosen] = remaining.splice(picked, 1);
    winners.push(chosen!);
  }

  return winners;
}

/**
 * Reproduz a apuração a partir da lista PUBLICADA, com um gerador injetado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A REPRODUÇÃO MORA AQUI, E NÃO EM `pool-rules`
 * ─────────────────────────────────────────────────────────────────────────────
 *  O servidor reproduz (para o veredito que a página mostra sem JavaScript) e o
 *  navegador reproduz (para quem não confia no servidor). Se cada um tivesse a sua
 *  cópia, a auditoria poderia discordar do resultado por um motivo que não é o
 *  sorteio. Mesma função, dois adaptadores de aleatoriedade.
 *
 *  `count` é o total sorteado (titulares + suplentes), exatamente como na apuração:
 *  a seleção é UMA só, e o papel de cada posição é decidido depois pela contagem de
 *  titulares. Reimplementar a divisão aqui abriria espaço para a auditoria discordar
 *  do resultado por outro motivo.
 */
export function reproduceFromPool(input: {
  pool: readonly RafflePoolEntry[];
  count: number;
  weightByMinutes: boolean;
  randomInt: (max: number) => number;
}): RafflePoolEntry[] {
  /**
   * O `userId` do algoritmo recebe o CÓDIGO: a partir da lista publicada a
   * identidade é pública, e o resultado da reprodução sai com códigos — que é o que
   * a auditoria compara com o resultado gravado, sem precisar de nome nenhum.
   */
  const participants: EligibleParticipant[] = input.pool.map((entry) => ({
    userId: entry.code,
    userName: entry.code,
    minutes: entry.minutes,
    attendanceIds: [],
    referenceAttendanceId: null,
  }));

  const drawn = input.weightByMinutes
    ? selectWeightedWinners(participants, input.count, input.randomInt)
    : selectWinners(participants, input.count, input.randomInt);

  const byCode = new Map(input.pool.map((entry) => [entry.code, entry]));

  return drawn
    .map((participant) => byCode.get(participant.userId))
    .filter((entry): entry is RafflePoolEntry => entry !== undefined);
}
