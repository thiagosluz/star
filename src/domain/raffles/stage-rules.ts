/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Operação de palco do sorteio (FASE 22)
 *
 *  Regras puras do que acontece COM O SORTEIO NA MÃO: corrigir uma entrega
 *  registrada por engano, achar um sorteio no histórico, premiar mais de um revisor
 *  e decidir o que o público pode ver. Nada aqui toca banco, Next ou React.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTAS REGRAS NÃO MORARAM EM `raffle-rules.ts`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `raffle-rules.ts` é a regra do SORTEIO — elegibilidade, amostragem, payload
 *  canônico, paginação. Estas são as regras da OPERAÇÃO em volta dele, e misturá-las
 *  faria o arquivo que o auditor lê para conferir um resultado carregar também o
 *  texto do motivo de uma entrega desfeita. São coisas diferentes, com leitores
 *  diferentes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { zonedWallTimeToInstant } from '@/domain/events/scheduling-rules';

export type RaffleStatus = 'DRAFT' | 'DRAWN' | 'CANCELED';

export const RAFFLE_STATUSES: readonly RaffleStatus[] = ['DRAFT', 'DRAWN', 'CANCELED'];

export const RAFFLE_STATUS_LABELS: Readonly<Record<RaffleStatus, string>> = {
  DRAFT: 'Não apurado',
  DRAWN: 'Apurado',
  CANCELED: 'Cancelado',
};

export function isRaffleStatus(value: string): value is RaffleStatus {
  return (RAFFLE_STATUSES as readonly string[]).includes(value);
}

// ───────────────────────────────────────────────────────────────────────────────
//  G8 — Desfazer uma entrega registrada por engano
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Mínimo do motivo, em caracteres.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM MOTIVO, E POR QUE ELE NÃO PODE SER "ok"
 * ─────────────────────────────────────────────────────────────────────────────
 *  A entrega do prêmio é o único ponto do sorteio em que DINHEIRO troca de mãos, e
 *  desfazê-la é a única operação capaz de apagar um fato consumado. Sem motivo
 *  escrito, a trilha registraria "a entrega foi desfeita" e nada mais — e a pergunta
 *  que uma auditoria faz ("por quê?") ficaria sem resposta no sistema.
 *
 *  Um mínimo de caracteres não garante verdade, mas impede o clique reflexo: obriga
 *  quem desfaz a escrever uma frase, e é isso que separa "corrigi um erro" de
 *  "apaguei um registro".
 */
export const DELIVERY_REVERSAL_REASON_MIN = 5;
export const DELIVERY_REVERSAL_REASON_MAX = 300;

export type DeliveryReversalDecision =
  | { allowed: true; reason: string }
  | { allowed: false; code: 'NOT_DELIVERED' | 'REASON_REQUIRED'; message: string };

/**
 * A entrega desta posição pode ser desfeita?
 *
 * Desfazer é **limpar o registro da entrega** (quem entregou, quando e a observação),
 * e NÃO apagar a linha da posição: a pessoa continua sendo a ganhadora daquela
 * posição — o que se corrige é o registro de retirada. Os dois fatos ficam na trilha:
 * a entrega original e a reversão, com autor, horário e motivo.
 */
export function evaluateDeliveryReversal(input: {
  /** `null` = não há entrega registrada nesta posição. */
  deliveredAt: Date | null;
  reason: string | null | undefined;
}): DeliveryReversalDecision {
  if (!input.deliveredAt) {
    return {
      allowed: false,
      code: 'NOT_DELIVERED',
      message: 'Esta posição não tem entrega registrada — não há o que desfazer.',
    };
  }

  const reason = (input.reason ?? '').trim();

  if (reason.length < DELIVERY_REVERSAL_REASON_MIN) {
    return {
      allowed: false,
      code: 'REASON_REQUIRED',
      message: `Escreva o motivo da reversão (ao menos ${DELIVERY_REVERSAL_REASON_MIN} caracteres): ele fica na trilha de auditoria junto com a entrega desfeita.`,
    };
  }

  return { allowed: true, reason: reason.slice(0, DELIVERY_REVERSAL_REASON_MAX) };
}

// ───────────────────────────────────────────────────────────────────────────────
//  G9 — Busca e filtro no histórico
// ───────────────────────────────────────────────────────────────────────────────
export interface RaffleHistoryFilter {
  status: RaffleStatus | null;
  /** Início do período (inclusivo), já no INSTANTE do fuso da instituição. */
  from: Date | null;
  /** Fim do período (inclusivo, até o último milissegundo do dia). */
  to: Date | null;
  /**
   * O DIA como a pessoa digitou (`AAAA-MM-DD`).
   *
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE O TEXTO ORIGINAL VIAJA JUNTO DO INSTANTE
   * ─────────────────────────────────────────────────────────────────────────────
   *  `to` é o ÚLTIMO milissegundo do dia local — que, em `America/Bahia`, é
   *  02:59:59.999Z do dia SEGUINTE. Formatá-lo de volta para exibir "criado até…"
   *  mostraria 19/10 para quem filtrou 18/10: o rótulo contradiria o campo que a
   *  pessoa acabou de preencher. Quem sabe o dia é o TEXTO que ela digitou; o instante
   *  existe para a consulta.
   */
  fromDay: string | null;
  toDay: string | null;
  /** O período é sobre a data de CRIAÇÃO do sorteio. */
  periodField: 'createdAt';
}

export type RaffleHistoryFilterResult =
  | { ok: true; filter: RaffleHistoryFilter }
  | { ok: false; code: 'INVALID_STATUS' | 'INVALID_DATE' | 'INVALID_RANGE'; message: string };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-10-18` (como a pessoa digitou) → `18/10/2026` (como ela lê). */
function formatDayText(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

/**
 * Normaliza o filtro que vem da URL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O DIA É O DA INSTITUIÇÃO, NÃO O DO SERVIDOR (armadilha 38)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O `<input type="date">` manda `2026-10-18` — um DIA, sem hora. Interpretá-lo com
 *  `new Date('2026-10-18')` o trataria como meia-noite UTC, e a instituição em
 *  `America/Bahia` (UTC−3) veria o filtro começar às 21h do dia ANTERIOR: quem
 *  sorteou às 22h de terça sumiria de um filtro por "quarta". A conversão passa pelo
 *  fuso da instituição, com o início e o fim do dia explícitos.
 *
 *  Período invertido (`de` depois de `até`) é RECUSADO em vez de devolver nada: uma
 *  lista vazia por causa disso parece defeito, não resposta.
 */
export function parseRaffleHistoryFilter(input: {
  status?: string | null;
  from?: string | null;
  to?: string | null;
  timeZone: string;
}): RaffleHistoryFilterResult {
  const rawStatus = (input.status ?? '').trim();

  let status: RaffleStatus | null = null;

  if (rawStatus.length > 0 && rawStatus !== 'ALL') {
    if (!isRaffleStatus(rawStatus)) {
      return {
        ok: false,
        code: 'INVALID_STATUS',
        message: 'Situação inválida para o filtro do histórico.',
      };
    }

    status = rawStatus;
  }

  const from = parseDay(input.from, input.timeZone, '00:00:00');
  const to = parseDay(input.to, input.timeZone, '23:59:59');

  if (from === 'invalid' || to === 'invalid') {
    return {
      ok: false,
      code: 'INVALID_DATE',
      message: 'Data inválida no filtro. Use o formato AAAA-MM-DD.',
    };
  }

  if (from && to && from.getTime() > to.getTime()) {
    return {
      ok: false,
      code: 'INVALID_RANGE',
      message: 'A data inicial do filtro é posterior à final.',
    };
  }

  return {
    ok: true,
    filter: {
      status,
      from,
      to,
      fromDay: dayText(input.from),
      toDay: dayText(input.to),
      periodField: 'createdAt',
    },
  };
}

/** O dia digitado, quando ele é válido (o filtro já recusou o resto). */
function dayText(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return DAY_PATTERN.test(text) ? text : null;
}

function parseDay(
  value: string | null | undefined,
  timeZone: string,
  time: string,
): Date | null | 'invalid' {
  const text = (value ?? '').trim();
  if (text.length === 0) return null;
  if (!DAY_PATTERN.test(text)) return 'invalid';

  const instant = zonedWallTimeToInstant(`${text}T${time}`, timeZone);
  return instant ?? 'invalid';
}

/** O filtro está ativo? (usado para dizer "filtrado" na tela e para o rótulo do vazio) */
export function raffleFilterIsActive(filter: RaffleHistoryFilter): boolean {
  return filter.status !== null || filter.from !== null || filter.to !== null;
}

/**
 * Rótulo humano do filtro, para a tela dizer o que está sendo mostrado.
 *
 * As datas saem do TEXTO digitado (`fromDay`/`toDay`), não do instante: o fim do dia
 * local cai no dia seguinte em UTC, e reformatar o instante mostraria 19/10 para quem
 * filtrou 18/10 — o rótulo contradiria o campo preenchido (o teste unitário pegou
 * exatamente isso antes de chegar à tela).
 */
export function describeRaffleHistoryFilter(filter: RaffleHistoryFilter): string {
  const parts: string[] = [];

  if (filter.status) parts.push(`situação: ${RAFFLE_STATUS_LABELS[filter.status]}`);
  if (filter.fromDay) parts.push(`criado a partir de ${formatDayText(filter.fromDay)}`);
  if (filter.toDay) parts.push(`criado até ${formatDayText(filter.toDay)}`);

  return parts.join(' · ');
}

// ───────────────────────────────────────────────────────────────────────────────
//  G10 — Premiar mais de um revisor
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Teto de pessoas premiadas em uma rodada.
 *
 * Premiar "os 3 melhores" é operação de reconhecimento; premiar 200 é distribuir
 * carta em massa, e a carta de destaque existe justamente por ser escassa. O teto
 * também protege a concessão: cada prêmio é uma transação com auditoria.
 */
export const MAX_REVIEWER_AWARDS = 10;

export type ReviewerAwardDecision =
  | { ok: true; top: number; /** Pediu mais do que existe? A tela avisa. */ capped: boolean }
  | { ok: false; code: 'INVALID_INPUT' | 'NO_RANKING'; message: string };

/**
 * Quantos revisores premiar, dado o pedido e o ranking disponível.
 *
 * Pedir mais do que o ranking tem **não é erro**: premia quem existe e a tela diz
 * quantos foram. Erro é pedir zero/negativo (não há prêmio a conceder) ou não haver
 * ninguém com parecer suficiente — e aí a mensagem explica o critério.
 */
export function resolveReviewerAwardCount(input: {
  requested: number;
  rankedCount: number;
}): ReviewerAwardDecision {
  if (!Number.isFinite(input.requested) || input.requested < 1) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe quantos revisores premiar (ao menos 1).',
    };
  }

  if (input.rankedCount <= 0) {
    return {
      ok: false,
      code: 'NO_RANKING',
      message: 'Nenhum revisor atingiu o mínimo de pareceres para entrar no ranking.',
    };
  }

  const requested = Math.min(Math.trunc(input.requested), MAX_REVIEWER_AWARDS);
  const top = Math.min(requested, input.rankedCount);

  return { ok: true, top, capped: top < Math.trunc(input.requested) };
}

// ───────────────────────────────────────────────────────────────────────────────
//  G11 — O que o público pode ver
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O resultado deste sorteio está publicado?
 *
 * Duas condições, e as duas são necessárias: a instituição publicou (`isPublic`) e o
 * sorteio foi apurado (`DRAWN`). Publicar um rascunho mostraria uma página com o
 * título do prêmio e nenhum ganhador — e o título é justamente o que não pode vazar
 * antes da hora.
 */
export function isRaffleResultPublished(input: {
  isPublic: boolean;
  status: RaffleStatus;
}): boolean {
  return input.isPublic && input.status === 'DRAWN';
}

/**
 * O sorteio saiu do ar depois de publicado?
 *
 * DRAFT + isPublic é o estado que a tela produz quando alguém despublica antes da
 * apuração; CANCELED + isPublic acontece quando o sorteio é cancelado depois de
 * publicado. Distinguir os dois permite dizer à instituição POR QUE o endereço
 * público responde 404 — em vez de um "não encontrado" que parece bug de link.
 */
export function rafflePublicationState(input: {
  isPublic: boolean;
  status: RaffleStatus;
}): 'PUBLISHED' | 'NOT_PUBLISHED' | 'NOT_DRAWN' | 'CANCELED' {
  if (input.status === 'CANCELED') return input.isPublic ? 'CANCELED' : 'NOT_PUBLISHED';
  if (!input.isPublic) return 'NOT_PUBLISHED';
  if (input.status !== 'DRAWN') return 'NOT_DRAWN';

  return 'PUBLISHED';
}
