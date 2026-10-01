/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Lotação, lista de espera e cancelamento
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA CENTRAL: SUPERLOTAÇÃO SOB CONCORRÊNCIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O padrão ingênuo é:
 *
 *      1. SELECT count(*) FROM registrations WHERE activityId = X   -- 49
 *      2. comparar com capacity (50) -> cabe
 *      3. INSERT
 *
 *  Duas requisições simultâneas leem 49, ambas concluem que cabe, ambas
 *  inserem — e a atividade termina com 51 inscritos. É o bug clássico de
 *  check-then-act, e o teste de carga sempre encontra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A SOLUÇÃO: CONTADOR DENORMALIZADO + UPDATE CONDICIONAL ATÔMICO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `activities.confirmedCount` é mantido por este módulo. A reserva de vaga é
 *  UMA instrução:
 *
 *      UPDATE activities
 *         SET "confirmedCount" = "confirmedCount" + 1
 *       WHERE id = $1
 *         AND ("capacity" IS NULL OR "confirmedCount" < "capacity")
 *
 *  O PostgreSQL serializa UPDATEs concorrentes na MESMA linha: a segunda
 *  transação bloqueia, reavalia o predicado já com o contador atualizado e
 *  afeta 0 linhas. Zero linhas = "não havia vaga" — sem race condition, sem
 *  `SELECT FOR UPDATE`, sem lock explícito.
 *
 *  Por isso a decisão de "cabe ou não" NÃO é tomada em JavaScript para o
 *  caminho de escrita: ela é o próprio predicado do UPDATE. As funções puras
 *  deste arquivo decidem o que fazer DEPOIS (aceitar, ir para espera, recusar)
 *  e são usadas para validação, UI e testes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Semântica de capacidade
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Capacidade é `Int?`:
 *   null  -> ILIMITADA
 *   0     -> ESGOTADA (nenhuma vaga)
 *   n > 0 -> n vagas no total
 *
 * A distinção entre `null` e `0` é deliberada e testada: tratar 0 como
 * "ilimitado" liberaria inscrições em uma atividade configurada como lotada.
 */
export function isUnlimitedCapacity(capacity: number | null | undefined): boolean {
  return capacity === null || capacity === undefined;
}

/** Vagas restantes. `null` quando ilimitada. Nunca negativo. */
export function remainingSeats(
  capacity: number | null | undefined,
  confirmedCount: number,
): number | null {
  if (isUnlimitedCapacity(capacity)) return null;
  return Math.max(0, (capacity as number) - confirmedCount);
}

export function hasAvailableSeat(
  capacity: number | null | undefined,
  confirmedCount: number,
): boolean {
  if (isUnlimitedCapacity(capacity)) return true;
  return confirmedCount < (capacity as number);
}

/** Ocupação em 0..1. `null` quando ilimitada (não há denominador). */
export function occupancyRatio(
  capacity: number | null | undefined,
  confirmedCount: number,
): number | null {
  if (isUnlimitedCapacity(capacity)) return null;
  const cap = capacity as number;
  if (cap <= 0) return 1;
  return Math.min(1, confirmedCount / cap);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A FILA DO EVENTO E O PRAZO DE QUEM É PROMOVIDO (dívidas E33 e E1)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O EVENTO LOTADO ENFILEIRA EM VEZ DE RECUSAR (E33)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fila existia só por ATIVIDADE. Quando a lotação do EVENTO acabava, a inscrição
 *  era RECUSADA — e o interessado simplesmente desaparecia: não havia onde guardá-lo,
 *  nem como saber quem esperava, nem a quem entregar a vaga de quem desistisse. A
 *  instituição descobria a demanda por fora (telefone, e-mail) e refazia à mão o
 *  trabalho que o sistema já sabia fazer na atividade.
 *
 *  A régua é a mesma da atividade, e por isso ela mora aqui: **a vaga que não existe
 *  não se perde — ela espera**. `eventHasWaitlist` responde a única pergunta que o
 *  serviço precisa fazer antes de enfileirar: este evento TEM lotação? Evento sem
 *  lotação não tem fila (não há vaga contada para faltar).
 *
 *  A decisão NÃO é um `if` sobre o contador: quem decide se há vaga continua sendo o
 *  `UPDATE` condicional (`RESERVE_EVENT_SEAT_SQL`), no banco. Esta função só diz se,
 *  falhando a reserva, o caminho é a FILA ou a recusa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O PROMOVIDO TEM PRAZO, E POR QUE 48 HORAS (E1)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A promoção era silenciosa e definitiva: quem era chamado da fila virava
 *  `CONFIRMED` no mesmo instante. Se não quisesse mais a vaga — ou não visse o aviso —
 *  ela ficava PRESA com quem não respondeu, e a fila inteira atrás dele esperava por
 *  alguém que não vinha. A vaga que não se perde no fim da fila se perdia no começo.
 *
 *  O prazo é FIXO em 48 h, e isso é decisão: o prazo da FILA não pode ser o mesmo
 *  campo da política de confirmação de vaga (FASE 34), que é sobre o que a atividade
 *  COBRA (taxa, doação, item). Amarrar os dois faria a política de cobrança governar a
 *  fila em silêncio — quem cobrasse 30 dias daria 30 dias de fila parada, e quem não
 *  cobrasse nada faria a fila vencer por um prazo que ninguém configurou. A promoção
 *  entra como `PENDING` com `confirmationDueAt`, que é o estado que a FASE 34 já sabe
 *  liberar e promover de novo (ADR-175/178) — a máquina já existia; faltava quem a
 *  acionasse pela fila.
 */
export const PROMOTION_WINDOW_HOURS = 48;

/** Quando vence a vaga de quem foi promovido da fila: agora + `PROMOTION_WINDOW_HOURS`. */
export function promotionDeadline(now: Date): Date {
  return new Date(now.getTime() + PROMOTION_WINDOW_HOURS * 3_600_000);
}

/**
 * Um evento COM lotação tem fila. Sem lotação não há vaga contada para faltar — e
 * enfileirar quem nunca seria recusado seria inventar espera.
 */
export function eventHasWaitlist(capacity: number | null | undefined): boolean {
  return !isUnlimitedCapacity(capacity);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Decisão de inscrição
// ───────────────────────────────────────────────────────────────────────────────
export type RegistrationDecision =
  | { outcome: 'CONFIRMED'; remainingAfter: number | null }
  | { outcome: 'WAITLISTED'; position: number }
  | { outcome: 'REJECTED'; reason: RegistrationRejectionReason; message: string };

export type RegistrationRejectionReason =
  | 'FULL_NO_WAITLIST'
  | 'DUPLICATE'
  | 'ALREADY_WAITLISTED'
  | 'ACTIVITY_CANCELED'
  | 'ACTIVITY_NOT_OPEN';

export interface RegistrationDecisionInput {
  /** `null` = ilimitada; `0` = esgotada. */
  capacity: number | null | undefined;
  /** Valor atual do contador denormalizado. */
  confirmedCount: number;
  waitlistEnabled: boolean;
  /** Quantidade de pessoas já na lista de espera. */
  waitlistCount: number;
  /** Limite da lista de espera. `null` = ilimitada. */
  waitlistCapacity?: number | null;
  /** Já existe inscrição ativa deste usuário? */
  alreadyRegistered: boolean;
  /** Já está na lista de espera? */
  alreadyWaitlisted?: boolean;
  activityStatus: 'DRAFT' | 'SCHEDULED' | 'FULL' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
}

/**
 * Decide o desfecho de uma tentativa de inscrição, dado o estado atual.
 *
 * IMPORTANTE: esta função é usada para (a) a checagem de leitura que dá
 * feedback imediato na UI e (b) os testes. O caminho de ESCRITA não confia nela
 * — ele usa o UPDATE condicional, cujo resultado em 0 linhas é a verdade
 * definitiva. Aqui pode haver corrida; lá, não.
 */
export function decideRegistration(
  input: RegistrationDecisionInput,
): RegistrationDecision {
  const {
    capacity,
    confirmedCount,
    waitlistEnabled,
    waitlistCount,
    waitlistCapacity = null,
    alreadyRegistered,
    alreadyWaitlisted = false,
    activityStatus,
  } = input;

  if (activityStatus === 'CANCELED') {
    return {
      outcome: 'REJECTED',
      reason: 'ACTIVITY_CANCELED',
      message: 'Esta atividade foi cancelada.',
    };
  }

  // Atividades em rascunho/interrompidas/concluídas não aceitam inscrição.
  if (activityStatus !== 'SCHEDULED' && activityStatus !== 'FULL') {
    return {
      outcome: 'REJECTED',
      reason: 'ACTIVITY_NOT_OPEN',
      message: 'Esta atividade não está com inscrições abertas.',
    };
  }

  if (alreadyRegistered) {
    return {
      outcome: 'REJECTED',
      reason: 'DUPLICATE',
      message: 'Você já está inscrito nesta atividade.',
    };
  }

  if (alreadyWaitlisted) {
    return {
      outcome: 'REJECTED',
      reason: 'ALREADY_WAITLISTED',
      message: 'Você já está na lista de espera desta atividade.',
    };
  }

  if (hasAvailableSeat(capacity, confirmedCount)) {
    return {
      outcome: 'CONFIRMED',
      // Vagas restantes DEPOIS de consumir uma.
      remainingAfter: remainingSeats(capacity, confirmedCount + 1),
    };
  }

  // Sem vaga: tenta a lista de espera, se habilitada e com espaço.
  if (waitlistEnabled) {
    const waitlistFull =
      waitlistCapacity !== null && waitlistCapacity > 0 && waitlistCount >= waitlistCapacity;

    if (!waitlistFull) {
      return { outcome: 'WAITLISTED', position: waitlistCount + 1 };
    }
  }

  return {
    outcome: 'REJECTED',
    reason: 'FULL_NO_WAITLIST',
    message: waitlistEnabled
      ? 'A atividade está lotada e a lista de espera também.'
      : 'A atividade está lotada.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Promoção da lista de espera
// ───────────────────────────────────────────────────────────────────────────────
export type WaitlistPromotion =
  | { promote: false; reason: 'NO_WAITLIST' | 'NO_SEAT' }
  | { promote: true; nextPosition: number };

/**
 * Ao liberar uma vaga, quem deve ser promovido?
 *
 * Ordem: FIFO pela posição na lista de espera. É a política mais previsível e a
 * que os participantes esperam. `waitlistPosition` é reindexado após cada
 * promoção para que as posições exibidas continuem fazendo sentido.
 */
export function nextWaitlistPromotion(
  input: {
    capacity: number | null | undefined;
    confirmedCount: number;
    waitlist: readonly { id: string; waitlistPosition: number | null }[];
  },
): WaitlistPromotion {
  const { capacity, confirmedCount, waitlist } = input;

  if (waitlist.length === 0) return { promote: false, reason: 'NO_WAITLIST' };
  if (!hasAvailableSeat(capacity, confirmedCount)) {
    return { promote: false, reason: 'NO_SEAT' };
  }

  const ordered = [...waitlist].sort(
    (a, b) => (a.waitlistPosition ?? Number.MAX_SAFE_INTEGER) - (b.waitlistPosition ?? Number.MAX_SAFE_INTEGER),
  );

  return { promote: true, nextPosition: ordered[0]!.waitlistPosition ?? 1 };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Transições de status permitidas
// ───────────────────────────────────────────────────────────────────────────────
export type RegistrationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'WAITLISTED'
  | 'CANCELED'
  | 'ATTENDED'
  | 'NO_SHOW';

/**
 * Transições válidas de status de inscrição.
 *
 * Modelar isso explicitamente impede o bug de "desfazer" uma presença já
 * registrada (ATTENDED -> CONFIRMED), que corromperia o cálculo de carga
 * horária do certificado.
 */
const ALLOWED_TRANSITIONS: Record<RegistrationStatus, readonly RegistrationStatus[]> = {
  PENDING: ['CONFIRMED', 'WAITLISTED', 'CANCELED'],
  CONFIRMED: ['CANCELED', 'ATTENDED', 'NO_SHOW'],
  WAITLISTED: ['CONFIRMED', 'CANCELED'],
  CANCELED: [], // estado terminal: cancelar é definitivo
  ATTENDED: [], // estado terminal: presença consumada
  NO_SHOW: [],
};

/**
 * A inscrição está VIVA?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A MESMA DEFINIÇÃO DO ÍNDICE ÚNICO PARCIAL (FASE 50 · defeito encontrado na E59)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O banco garante uma inscrição viva por (atividade, pessoa) com um índice único
 *  PARCIAL: `WHERE status IN ('PENDING','CONFIRMED','WAITLISTED','ATTENDED')`. A
 *  intenção está escrita na migração `20260916214408_registration_live_unique` e no
 *  comentário do modelo: um cancelamento é TERMINAL na LINHA, e a pessoa pode se
 *  inscrever de novo criando uma linha NOVA.
 *
 *  A checagem da aplicação, porém, recusava qualquer linha existente — inclusive
 *  CANCELED e NO_SHOW. O efeito era o inverso do projetado: quem cancelava (ou quem
 *  perdia a vaga pelo prazo da FASE 34, que cancela sozinho) **nunca mais conseguia se
 *  inscrever naquela atividade**, e a mensagem ainda dizia "você já está inscrito".
 *
 *  Esta função é a fonte única da pergunta, para que a regra da aplicação e o índice do
 *  banco não possam divergir — o teste que a prende compara com as quatro situações.
 */
export function registrationIsLive(status: RegistrationStatus): boolean {
  return status === 'PENDING' || status === 'CONFIRMED' || status === 'WAITLISTED' || status === 'ATTENDED';
}

export function canTransitionRegistration(
  from: RegistrationStatus,
  to: RegistrationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Cancelar libera vaga?
 *
 * Só libera se a inscrição estava de fato ocupando vaga. Cancelar algo que já
 * estava CANCELED não pode decrementar o contador — isso inflaria a lotação
 * disponível e permitiria superlotação por cancelamentos repetidos.
 */
export function cancelReleasesSeat(status: RegistrationStatus): boolean {
  return status === 'CONFIRMED' || status === 'PENDING';
}

/** Cancelar reordena a lista de espera? (só se estava esperando) */
export function cancelAffectsWaitlist(status: RegistrationStatus): boolean {
  return status === 'WAITLISTED';
}

// ───────────────────────────────────────────────────────────────────────────────
//  SQL dos contadores — a fronteira transacional
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Predicado de disponibilidade de vaga, para usar no `WHERE` de um UPDATE.
 *
 * Mantido aqui (e não escrito à mão em cada caso de uso) para que a semântica de
 * `null` = ilimitada e `0` = esgotada exista em um único lugar. Se alguém mudar
 * a regra, muda aqui e todos os caminhos acompanham.
 *
 * A string é interpolada apenas com identificadores fixos deste módulo — nunca
 * com entrada de usuário.
 */
export const SEAT_AVAILABLE_PREDICATE = `("capacity" IS NULL OR "confirmedCount" < "capacity")`;

/**
 * O teto da SALA, no mesmo predicado (revisão da FASE 3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A SALA ENTRA AQUI, E NÃO NUMA CHECAGEM ANTES
 * ─────────────────────────────────────────────────────────────────────────────
 *  A vaga é reservada por UM `UPDATE` condicional, e é isso que torna a
 *  superlotação impossível sob concorrência (ver o cabeçalho deste módulo). Uma
 *  checagem de sala em JavaScript antes do UPDATE reabriria exatamente a janela que
 *  o predicado fecha: duas requisições leem "cabe", ambas reservam, e a sala
 *  termina com mais gente do que cadeiras.
 *
 *  A subconsulta enxerga os valores ANTIGOS da linha sendo atualizada — é assim que
 *  `UPDATE ... WHERE` funciona no PostgreSQL —, então `confirmedCount` aqui é o
 *  ocupado de antes da reserva. Sem isso, a última vaga de uma sala de 40 seria
 *  entregue duas vezes.
 *
 *  O `activities.` explícito no interior da subconsulta não é decorativo: sem ele
 *  o PostgreSQL resolveria `"confirmedCount"` contra a própria `rooms` (que não tem
 *  essa coluna) e a consulta falharia.
 */
export const ROOM_SEAT_AVAILABLE_PREDICATE = `(
  "roomId" IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM rooms r
     WHERE r.id = activities."roomId"
       AND r."capacity" IS NOT NULL
       AND r."capacity" > 0
       AND activities."confirmedCount" >= r."capacity"
  )
)`;

/**
 * A reserva de vaga de ATIVIDADE — uma instrução, um lugar.
 *
 * Estava escrita à mão em quatro pontos do serviço de inscrição (inscrição
 * individual, promoção da lista de espera e as duas sincronizações de atividade
 * aberta). Quatro cópias da mesma regra é uma regra que vai divergir: foi o que
 * quase aconteceu quando a SALA passou a limitar, porque só um dos pontos poderia
 * ter sido lembrado.
 *
 * Uso: `tx.$executeRawUnsafe(RESERVE_ACTIVITY_SEAT_SQL, activityId)` — sem
 * interpolação de entrada, com `$1` como parâmetro.
 */
export const RESERVE_ACTIVITY_SEAT_SQL = `
  UPDATE activities
     SET "confirmedCount" = "confirmedCount" + 1
   WHERE id = $1::uuid
     AND ${SEAT_AVAILABLE_PREDICATE}
     AND ${ROOM_SEAT_AVAILABLE_PREDICATE}
`;

/**
 * A reserva de vaga de uma atividade ABERTA — sem predicado de lotação.
 *
 * Atividade aberta recebe quem se inscreveu no evento, por decisão da revisão da
 * FASE 3 (`requiresRegistration = false`): ela não tem fila nem recusa. O contador
 * acompanha mesmo assim, porque é ele que a lista de presença e o painel mostram.
 * Ficou nomeado para que a AUSÊNCIA de predicado seja uma escolha visível, e não
 * uma cópia esquecida do SQL acima.
 */
export const RESERVE_OPEN_ACTIVITY_SEAT_SQL = `
  UPDATE activities
     SET "confirmedCount" = "confirmedCount" + 1
   WHERE id = $1::uuid
`;

/** Predicado para reservar vaga de lista de espera (não mexe no contador). */
export const WAITLIST_POSITION_SQL = `  COALESCE(
    (SELECT MAX("waitlistPosition") FROM registrations
      WHERE "activityId" = $1 AND status = 'WAITLISTED'),
    0
  ) + 1
`;

/**
 * A reserva de vaga na INSCRIÇÃO DO EVENTO.
 *
 * Sem `ROOM_SEAT_AVAILABLE_PREDICATE`: a sala pertence à ATIVIDADE, e o evento não
 * tem uma. Uso: `tx.$executeRawUnsafe(RESERVE_EVENT_SEAT_SQL, eventId)`.
 */
export const RESERVE_EVENT_SEAT_SQL = `
  UPDATE events
     SET "confirmedCount" = "confirmedCount" + 1
   WHERE id = $1::uuid
     AND ${SEAT_AVAILABLE_PREDICATE}
`;
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O ACEITE DA VAGA OFERTADA É ATO DA PESSOA (dívida E1)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ISTO CONSERTA (encontrado pelas catracas da F43, na hora)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A promoção passou a nascer `PENDING` com prazo — mas quem confirma `PENDING` é a
 *  EQUIPE, e `canConfirmRegistration` recusa quando a atividade não exige confirmação
 *  ("esta atividade confirma a vaga automaticamente"), e recusa também a inscrição do
 *  evento. Resultado: numa atividade gratuita (ou no evento), a vaga ofertada não tinha
 *  QUEM a confirmasse — vencia em 48 h, ia para o próximo, vencia de novo. A fila
 *  giraria para sempre e ninguém entraria.
 *
 *  A distinção é a mesma da FASE 34, um nível acima: **a equipe confere o que a
 *  atividade COBRA (taxa, doação, item); a pessoa decide se ainda QUER a vaga.** Onde
 *  a atividade exige conferência da equipe, o aceite não é o portão — o time confirma
 *  depois das exigências, e o prazo da fila continua valendo como pressão de tempo.
 *
 *  Onde não há nada a conferir, o aceite da pessoa é o único ato que falta — e é ele
 *  que impede a vaga de rodar em círculos.
 */
export type PromotionAcceptance =
  | { ok: true }
  | { ok: false; reason: 'NOT_OFFERED' | 'ALREADY_SETTLED' | 'EXPIRED' | 'TEAM_CONFIRMS'; message: string };

export function canAcceptPromotion(input: {
  status: RegistrationStatus;
  dueAt: Date | null;
  policy: 'AUTOMATIC' | 'REQUIRED' | null;
  now: Date;
}): PromotionAcceptance {
  if (input.status !== 'PENDING') {
    return {
      ok: false,
      reason: 'ALREADY_SETTLED',
      message: 'Esta vaga já está resolvida — não há oferta a aceitar.',
    };
  }

  if (input.dueAt === null) {
    return {
      ok: false,
      reason: 'NOT_OFFERED',
      message: 'Não há vaga ofertada esperando resposta sua.',
    };
  }

  if (input.dueAt.getTime() <= input.now.getTime()) {
    return {
      ok: false,
      reason: 'EXPIRED',
      message: 'O prazo para aceitar esta vaga venceu — ela foi oferecida a outra pessoa.',
    };
  }

  if (input.policy === 'REQUIRED') {
    return {
      ok: false,
      reason: 'TEAM_CONFIRMS',
      message:
        'Esta vaga depende da conferência da organização (o que a atividade pede). A equipe confirma assim que estiver tudo certo.',
    };
  }

  return { ok: true };
}
