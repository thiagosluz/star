/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — CHOQUE DE HORÁRIO NA AGENDA PESSOAL (FASE 65)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FÓRMULA NÃO MORA AQUI, E ISSO É DELIBERADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Dois intervalos se sobrepõem?" já é respondido desde a FASE 3 por
 *  `overlaps()` em `src/domain/events/event-rules.ts` — é a régua que impede duas
 *  atividades na MESMA SALA no mesmo horário. Este módulo NÃO recopia a
 *  comparação: ele a reusa e acrescenta o que a agenda do participante precisa e
 *  a régua de sala não tinha — intervalo SEM horário (que não choca com nada),
 *  a distinção entre ENCOSTAR e SOBREPOR, e a listagem de PARES.
 *
 *  Copiar `a.inicio < b.fim && b.inicio < a.fim` para um segundo arquivo criaria
 *  duas réguas para a mesma ideia — e a que ficasse para trás passaria a avisar
 *  choque onde não há (ou pior: a deixar de avisar onde há).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS BORDAS, DECIDIDAS E DOCUMENTADAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • ENCOSTAR NÃO É CHOQUE. Uma atividade que termina 10:00 e outra que começa
 *      10:00 estão em sequência, não em conflito: é a grade normal de um evento.
 *      (`intervalosSeSobrepoem` usa `<` estrito nas duas pontas.)
 *    • CONTER É CHOQUE. Um minicurso de 14:00 às 18:00 e uma palestra de 15:00 às
 *      16:00 disputam o mesmo tempo — o participante tem de escolher.
 *    • IDÊNTICOS SÃO CHOQUE. Dois itens no mesmo intervalo (duas mesas-redondas
 *      simultâneas) são a decisão mais óbvia de todas.
 *    • UM DENTRO DO OUTRO, nas duas direções, é choque: a relação é SIMÉTRICA.
 *    • SEM HORÁRIO NÃO CHOCA. Um item sem `startsAt`/`endsAt` não ocupa tempo
 *      nenhum — não há como colidir com ele. É o caso da inscrição no EVENTO (que
 *      não tem atividade) e de dado incompleto.
 *    • INSTANTE (duração zero) segue a MESMA régua das bordas. Dentro de outro
 *      intervalo ele É choque (o ponto cai no meio do que o outro ocupa); sobre a
 *      borda, não (encostar não é choque). O cadastro de atividade já recusa
 *      `fim <= início`, então este caso só aparece em dado corrompido — e guarda
 *      que não existe é a que falha em silêncio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MARGEM DE DESLOCAMENTO (E86 · FASE 69 · fatia 1)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ENCOSTAR NÃO É CHOQUE **NO PAPEL** — e é por isso que a régua pura ficava
 *  mentindo na vida real: quem termina uma oficina 15:00 na sala A e começa uma
 *  palestra 15:00 na sala B não tem choque de horário nenhum, mas também não tem
 *  como atravessar o campus a tempo. O que falta entre os dois não é sobreposição:
 *  é DESLOCAMENTO.
 *
 *  `ROOM_TRAVEL_MARGIN_MINUTES` é essa distância, em minutos, aplicada entre o FIM
 *  de um item e o INÍCIO do outro. Ela entra como PARÂMETRO da regra pura (o
 *  domínio não lê configuração, não importa Prisma, Next nem relógio) e tem um
 *  padrão declarado aqui, num lugar só.
 *
 *  Com margem ZERO a régua volta a ser exatamente a de antes: `gap < 0` nunca
 *  acontece, então só o que se sobrepõe avisa. É essa equivalência que mantém os
 *  testes da FASE 65 válidos palavra por palavra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CHOQUE SÓ AVISA, NUNCA BLOQUEIA (decisão do humano, FASE 65)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nada aqui recusa, ordena por gravidade ou sugere desistir: a casa não decide
 *  pelo participante. Quem escolhe o que assistir é ele — e a única coisa que o
 *  sistema faz é MOSTRAR o par. Por isso o retorno é uma lista de pares, e não um
 *  booleano que uma tela usaria como portão.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { overlaps, type TimeSlot } from '@/domain/events/event-rules';

/**
 * Intervalo que pode não existir.
 *
 * `startsAt`/`endsAt` nulos não são "meia-noite": são a AUSÊNCIA de horário, e o
 * domínio do projeto trata ausência como ausência em toda parte (a sala sem
 * capacidade não é a sala de zero lugares). Um item assim fica na agenda sem
 * participar do cálculo de choque.
 */
export interface AgendaInterval {
  startsAt: Date | null;
  endsAt: Date | null;
}

/** O intervalo está completo (tem começo e fim)? */
export function hasInterval(interval: AgendaInterval): interval is TimeSlot {
  return interval.startsAt instanceof Date && interval.endsAt instanceof Date;
}

/**
 * O intervalo é um PONTO no tempo (`início === fim`)?
 *
 * Vale saber porque a resposta de choque muda conforme a POSIÇÃO do ponto: dentro
 * de outro intervalo ele colide; sobre a borda, encosta e não colide. O cadastro
 * de atividade já recusa duração zero, então isto é guarda de dado corrompido.
 */
export function isPointInTime(interval: AgendaInterval): boolean {
  return hasInterval(interval) && interval.startsAt.getTime() === interval.endsAt.getTime();
}

/**
 * Os dois intervalos se sobrepõem?
 *
 * Encostar NÃO é sobrepor (ver o cabeçalho). Sem horário em qualquer um dos
 * lados, a resposta é `false` — e o chamador não precisa checar antes.
 */
export function intervalsOverlap(a: AgendaInterval, b: AgendaInterval): boolean {
  if (!hasInterval(a) || !hasInterval(b)) return false;
  return overlaps(a, b);
}

/**
 * Os intervalos apenas se ENCOSTAM (o fim de um é o início do outro)?
 *
 * É a borda que a agenda mostra como "em sequência". Existe como função — e não
 * como `else` de `intervalsOverlap` — porque "não choca" e "está emendado" são
 * informações DIFERENTES para quem lê a grade: a segunda é o que permite dizer
 * "esta termina quando aquela começa" sem bloco vermelho.
 */
export function intervalsTouch(a: AgendaInterval, b: AgendaInterval): boolean {
  if (!hasInterval(a) || !hasInterval(b)) return false;

  return (
    a.endsAt.getTime() === b.startsAt.getTime() ||
    b.endsAt.getTime() === a.startsAt.getTime()
  );
}

/** `outer` contém `inner` (bordas incluídas)? Sem horário, não contém. */
export function containsInterval(outer: AgendaInterval, inner: AgendaInterval): boolean {
  if (!hasInterval(outer) || !hasInterval(inner)) return false;

  return (
    outer.startsAt.getTime() <= inner.startsAt.getTime() &&
    outer.endsAt.getTime() >= inner.endsAt.getTime()
  );
}

/** Um par de itens que disputam o mesmo tempo. */
export interface OverlapPair<T> {
  first: T;
  second: T;
}

/**
 * Todos os PARES que se sobrepõem, na ordem em que os itens chegaram.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VARREDURA É QUADRÁTICA (E NÃO UMA LINHA DE VARREDURA)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O algoritmo "ordene por início e compare cada item com o ANTERIOR" é mais
 *  rápido, mas PERDE pares: um minicurso de 14:00 às 18:00 seguido de três
 *  palestras de 15:00, 16:00 e 17:00 só aparece colidindo com a PRIMEIRA — as
 *  outras duas ficam escondidas atrás dela, e a grade mentiria.
 *
 *  A agenda de um dia tem dezenas de itens; o custo O(n²) é irrelevante perto de
 *  errar o aviso. A comparação é entre TODOS os pares, e o resultado sai na ordem
 *  dos itens de entrada (o chamador ordena antes, e o par herda a ordem dele).
 */
export function findOverlapPairs<T>(
  items: readonly T[],
  intervalOf: (item: T) => AgendaInterval,
): OverlapPair<T>[] {
  const pairs: OverlapPair<T>[] = [];

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const first = items[i] as T;
      const second = items[j] as T;

      if (intervalsOverlap(intervalOf(first), intervalOf(second))) {
        pairs.push({ first, second });
      }
    }
  }

  return pairs;
}

// ───────────────────────────────────────────────────────────────────────────────
//  A MARGEM DE DESLOCAMENTO ENTRE SALAS (E86 · FASE 69 · fatia 1)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A régua de troca de sala, em MINUTOS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE 15, E NÃO OUTRO NÚMERO
 * ─────────────────────────────────────────────────────────────────────────────
 *  É a régua usual de troca de sala em evento acadêmico, e ela é a MENOR que
 *  resolve o caso real que a dívida descreve: sair de uma sala, atravessar o
 *  campus e ainda se acomodar antes de a outra sessão começar. Abaixo disso
 *  (5 ou 10) o deslocamento entre prédios DISTANTES continuaria invisível — o
 *  aviso existiria e não cobriria o caso que o motivou; muito acima (30) a régua
 *  passaria a acusar conflito entre salas vizinhas e o aviso viraria ruído, que é
 *  como um aviso morre.
 *
 *  O número é DECLARADO, e não medido: o sistema não conhece distância, andar nem
 *  mapa de campus, e inventar um cálculo a partir de dado que não existe seria
 *  pior do que uma régua única e explícita. Se algum dia houver planta do prédio,
 *  ESTE é o ponto de troca — e não um literal espalhado pelas telas.
 *
 *  O organizador NÃO configura nada nesta fase: configurar por evento é decisão de
 *  produto, não efeito colateral de consertar o detector.
 */
export const ROOM_TRAVEL_MARGIN_MINUTES = 15;

/** A margem em milissegundos — a unidade em que as datas se comparam. */
const MINUTO_EM_MS = 60_000;

/**
 * Os dois intervalos CONFLITAM considerando o deslocamento?
 *
 * `true` em dois casos, e só neles:
 *   • os intervalos se SOBREPÕEM (a régua de `intervalsOverlap`, intocada); ou
 *   • são DISJUNTOS e o intervalo livre entre o fim de um e o início do outro é
 *     MENOR que a margem — não dá tempo de chegar.
 *
 * Margem `0` desliga a segunda parte: a folga entre dois itens disjuntos é sempre
 * POSITIVA, e nenhum número positivo é menor que zero. Com margem zero, portanto,
 * esta função responde exatamente o que `intervalsOverlap` responde — é assim que
 * a FASE 69 preserva o comportamento da FASE 65, e o teste prende a equivalência.
 *
 * Sem horário em QUALQUER um dos lados a resposta é `false`: um item que não ocupa
 * tempo nenhum não disputa tempo, e não há "fim" de onde medir deslocamento. Por
 * isso o chamador não precisa checar antes.
 */
export function intervalsClash(
  a: AgendaInterval,
  b: AgendaInterval,
  marginMinutes: number,
): boolean {
  if (!hasInterval(a) || !hasInterval(b)) return false;

  // Sobreposto é conflito com qualquer margem — inclusive negativo de dado corrompido.
  if (overlaps(a, b)) return true;

  const gap =
    a.endsAt.getTime() <= b.startsAt.getTime()
      ? b.startsAt.getTime() - a.endsAt.getTime()
      : a.startsAt.getTime() - b.endsAt.getTime();

  return gap < marginMinutes * MINUTO_EM_MS;
}

/**
 * Todos os PARES em conflito — sobreposição OU deslocamento impossível.
 *
 * A varredura é a MESMA de `findOverlapPairs` (quadrática, todos contra todos; o
 * porquê está no comentário de lá: a comparação com o vizinho anterior PERDE
 * pares), e o par sai na ordem dos itens de entrada — o que faz a relação ser
 * simétrica por construção: trocar a ordem dos itens troca a ordem dos campos do
 * par, nunca o veredito.
 */
export function findClashPairs<T>(
  items: readonly T[],
  intervalOf: (item: T) => AgendaInterval,
  marginMinutes: number,
): OverlapPair<T>[] {
  const pairs: OverlapPair<T>[] = [];

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const first = items[i] as T;
      const second = items[j] as T;

      if (intervalsClash(intervalOf(first), intervalOf(second), marginMinutes)) {
        pairs.push({ first, second });
      }
    }
  }

  return pairs;
}
