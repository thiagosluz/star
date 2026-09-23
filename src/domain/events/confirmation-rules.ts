/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Confirmação de vaga com prazo (FASE 34)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A inscrição sempre foi um ato único: quem clicava ficava com a vaga. Só que uma
 *  parte das atividades cobra algo para valer — a taxa do minicurso, o quilo de
 *  alimento da campanha, o brinquedo do natal solidário — e a vaga ficava presa com
 *  quem nunca apareceu para pagar ou entregar. O organizador descobria a desistência
 *  no dia, com a fila cheia de gente que poderia ter ocupado aquele lugar.
 *
 *  Esta fase separa dois fatos que estavam juntos:
 *
 *    • **INSCREVER-SE** — o pedido, que já reserva a vaga (é o que garante a ordem);
 *    • **CONFIRMAR-SE** — o comparecimento da pessoa ao LOCAL e ao PRAZO ditos pelo
 *      organizador, que transforma a reserva em direito.
 *
 *  Quem confirma é a EQUIPE (decisão do humano): a confirmação é o registro de que
 *  a instituição recebeu o pagamento, a doação ou o item. O participante é avisado,
 *  mas não declara a própria confirmação — o que ele assinaria sozinho não é prova
 *  de nada para quem cobra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO É
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Regra pura: nenhum import de Prisma ou Next, nenhuma escrita, nenhum relógio
 *  próprio (todo "agora" entra por parâmetro). É o que permite testar o prazo no
 *  fuso do evento sem banco e sem esperar o tempo passar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  instantToZonedWallTime,
  zonedWallTimeToInstant,
} from '@/domain/events/scheduling-rules';
import type { RegistrationStatus } from '@/domain/events/registration-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Política de confirmação
// ───────────────────────────────────────────────────────────────────────────────
export const CONFIRMATION_POLICIES = ['AUTO', 'REQUIRED'] as const;

export type ConfirmationPolicy = (typeof CONFIRMATION_POLICIES)[number];

export const CONFIRMATION_POLICY_LABELS: Record<ConfirmationPolicy, string> = {
  AUTO: 'Automática (no ato da inscrição)',
  REQUIRED: 'Exige confirmação',
};

/**
 * *"se o organizador não escolher essa opção de confirmação, então as vagas são
 * autoconfirmáveis no ato da inscrição"* — o padrão é `AUTO`, e é ele que preserva o
 * comportamento de todas as atividades que já existem.
 */
export const DEFAULT_CONFIRMATION_POLICY: ConfirmationPolicy = 'AUTO';

/** Prazo do organizador: dias, contados da inscrição de CADA pessoa. */
export const CONFIRMATION_WINDOW_MIN_DAYS = 1;
export const CONFIRMATION_WINDOW_MAX_DAYS = 30;
export const CONFIRMATION_WINDOW_DEFAULT_DAYS = 3;

/**
 * A hora do fim do prazo, no dia local.
 *
 * Fim do dia (23:59) e não "mesma hora da inscrição": quem se inscreve às 22h de
 * segunda com 1 dia de prazo tem até o fim de terça, e não até as 22h — a leitura
 * humana de "um dia para confirmar" é o dia inteiro, não 24 horas corridas.
 */
export const CONFIRMATION_DUE_HOUR = 23;
export const CONFIRMATION_DUE_MINUTE = 59;

export function isConfirmationPolicy(value: unknown): value is ConfirmationPolicy {
  return typeof value === 'string' && (CONFIRMATION_POLICIES as readonly string[]).includes(value);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Exigências (o que é preciso para confirmar)
// ───────────────────────────────────────────────────────────────────────────────
export const CONFIRMATION_REQUIREMENT_KINDS = ['PAYMENT', 'DONATION', 'ITEM', 'OTHER'] as const;

export type ConfirmationRequirementKind = (typeof CONFIRMATION_REQUIREMENT_KINDS)[number];

export const CONFIRMATION_REQUIREMENT_KIND_LABELS: Record<ConfirmationRequirementKind, string> = {
  PAYMENT: 'Pagamento',
  DONATION: 'Doação',
  ITEM: 'Item',
  OTHER: 'Outro',
};

export interface ConfirmationRequirement {
  kind: ConfirmationRequirementKind;
  /** O que a pessoa leva/faz — "1 kg de alimento não perecível". */
  label: string;
  /** Detalhe opcional ("marca não importa", "pix: …"). */
  note: string | null;
  /**
   * A exigência é OBRIGATÓRIA? (FASE 37)
   *
   * Só as obrigatórias bloqueiam a confirmação automática da vaga: um item que a
   * organização quer conferir, mas não cobra, aparece no checklist sem segurar a pessoa
   * no balcão. Ausente = obrigatória, para o dado das fases anteriores continuar valendo
   * como sempre valeu.
   */
  required?: boolean;
}

export const CONFIRMATION_REQUIREMENTS_MAX = 10;
export const CONFIRMATION_REQUIREMENT_LABEL_MAX = 140;
export const CONFIRMATION_REQUIREMENT_NOTE_MAX = 200;

/** Onde confirmar: "Secretaria do bloco B, térreo — até as 18h". */
export const CONFIRMATION_PLACE_MAX = 300;
/** Orientações gerais do organizador. */
export const CONFIRMATION_INSTRUCTIONS_MAX = 1200;

/**
 * Lê a lista de exigências gravada em `Activity.confirmationRequirements` (JSON).
 *
 * A coluna é `Json`, então o conteúdo pode ser qualquer coisa: dado antigo, escrito
 * à mão, ou de uma versão anterior do formato. Linha inválida é DESCARTADA em vez de
 * derrubar a leitura — a alternativa seria a tela da atividade não abrir por causa de
 * uma linha malformada, e o organizador ficar sem enxergar as exigências que estão
 * certas. Mesma decisão do `parseRubric` (FASE 4).
 */
export function parseConfirmationRequirements(value: unknown): ConfirmationRequirement[] {
  if (!Array.isArray(value)) return [];

  const parsed: ConfirmationRequirement[] = [];

  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;

    const row = raw as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label.trim() : '';

    if (!label) continue;
    if (!isConfirmationRequirementKind(row.kind)) continue;

    const note = typeof row.note === 'string' ? row.note.trim() : '';

    parsed.push({
      kind: row.kind,
      label: label.slice(0, CONFIRMATION_REQUIREMENT_LABEL_MAX),
      note: note ? note.slice(0, CONFIRMATION_REQUIREMENT_NOTE_MAX) : null,
      /**
       * `required` só existe como `false` explícito (FASE 37): qualquer outra coisa —
       * campo ausente, `null`, texto — é OBRIGATÓRIA, que é o que a FASE 34 já fazia
       * com todas as exigências. Dado antigo continua valendo como sempre valeu.
       */
      required: row.required !== false,
    });

    if (parsed.length >= CONFIRMATION_REQUIREMENTS_MAX) break;
  }

  return parsed;
}

export function isConfirmationRequirementKind(
  value: unknown,
): value is ConfirmationRequirementKind {
  return (
    typeof value === 'string' &&
    (CONFIRMATION_REQUIREMENT_KINDS as readonly string[]).includes(value)
  );
}

/** "Pagamento: taxa de R$ 30" — para listas, e-mails e o checklist da tela. */
export function requirementLabel(requirement: ConfirmationRequirement): string {
  const kind = CONFIRMATION_REQUIREMENT_KIND_LABELS[requirement.kind];

  return `${kind}: ${requirement.label}${requirement.note ? ` (${requirement.note})` : ''}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Validação da política
// ───────────────────────────────────────────────────────────────────────────────
export interface ConfirmationPolicyInput {
  policy: unknown;
  windowDays: unknown;
  requirements: unknown;
  place: unknown;
  instructions: unknown;
}

export type ConfirmationPolicyResult =
  | {
      ok: true;
      policy: ConfirmationPolicy;
      windowDays: number | null;
      requirements: ConfirmationRequirement[];
      place: string | null;
      instructions: string | null;
    }
  | { ok: false; message: string; details?: readonly string[] };

/**
 * Valida e NORMALIZA a política escolhida no cadastro da atividade.
 *
 * A recusa que mais importa: **`REQUIRED` sem exigência e sem local**. "Exige
 * confirmação" sem dizer o que nem onde produziria o pior aviso possível — a pessoa
 * recebe "confirme sua vaga ou ela será liberada" e não tem como obedecer. Se a
 * atividade não cobra nada e não tem lugar de comparecimento, não há o que confirmar:
 * a política certa é `AUTO`. Diferente de "não preenchi ainda", que é erro de quem
 * digita e merece mensagem, não silêncio.
 */
export function validateConfirmationPolicy(
  input: ConfirmationPolicyInput,
): ConfirmationPolicyResult {
  const policy = isConfirmationPolicy(input.policy)
    ? input.policy
    : DEFAULT_CONFIRMATION_POLICY;

  if (input.policy !== undefined && input.policy !== null && input.policy !== '' && !isConfirmationPolicy(input.policy)) {
    return { ok: false, message: 'Escolha uma política de confirmação válida.' };
  }

  const place = normalizeText(input.place, CONFIRMATION_PLACE_MAX);
  const instructions = normalizeText(input.instructions, CONFIRMATION_INSTRUCTIONS_MAX);

  if (policy === 'AUTO') {
    /**
     * Sem confirmação, os campos do assunto são DESCARTADOS em vez de recusados:
     * desligar a política é uma decisão legítima e não pode ficar presa a um campo
     * que só existe do outro lado. O que volta é `null`, e o banco não guarda promessa
     * de confirmação que ninguém vai cobrar.
     */
    return { ok: true, policy, windowDays: null, requirements: [], place: null, instructions: null };
  }

  const windowDays = Number(input.windowDays);

  if (!Number.isInteger(windowDays)) {
    return { ok: false, message: 'Informe o prazo para confirmação em dias.' };
  }

  if (windowDays < CONFIRMATION_WINDOW_MIN_DAYS || windowDays > CONFIRMATION_WINDOW_MAX_DAYS) {
    return {
      ok: false,
      message: `O prazo para confirmar deve ficar entre ${CONFIRMATION_WINDOW_MIN_DAYS} e ${CONFIRMATION_WINDOW_MAX_DAYS} dias.`,
    };
  }

  const requirements = parseConfirmationRequirements(input.requirements);

  if (Array.isArray(input.requirements) && input.requirements.length > CONFIRMATION_REQUIREMENTS_MAX) {
    return {
      ok: false,
      message: `A lista de exigências aceita no máximo ${CONFIRMATION_REQUIREMENTS_MAX} itens.`,
    };
  }

  const details: string[] = [];

  for (const raw of Array.isArray(input.requirements) ? input.requirements : []) {
    if (typeof raw !== 'object' || raw === null) continue;

    const row = raw as Record<string, unknown>;
    const hasContent =
      (typeof row.label === 'string' && row.label.trim() !== '') ||
      (typeof row.note === 'string' && row.note.trim() !== '');

    if (!hasContent) continue;

    if (!isConfirmationRequirementKind(row.kind)) {
      details.push('Cada exigência precisa de um tipo (pagamento, doação, item ou outro).');
      continue;
    }

    const label = typeof row.label === 'string' ? row.label.trim() : '';

    if (!label) {
      details.push('Cada exigência precisa de uma descrição.');
      continue;
    }

    if (label.length > CONFIRMATION_REQUIREMENT_LABEL_MAX) {
      details.push(`A descrição da exigência "${label.slice(0, 40)}…" é longa demais.`);
    }

    const note = typeof row.note === 'string' ? row.note.trim() : '';

    if (note.length > CONFIRMATION_REQUIREMENT_NOTE_MAX) {
      details.push(`A observação de "${label.slice(0, 40)}…" é longa demais.`);
    }
  }

  if (details.length > 0) {
    return { ok: false, message: 'Revise as exigências da confirmação.', details };
  }

  if (requirements.length === 0 && !place) {
    return {
      ok: false,
      message:
        'Diga o que é preciso para confirmar ou onde a pessoa deve comparecer — sem um dos dois, o aviso não tem como ser obedecido.',
    };
  }

  return { ok: true, policy, windowDays, requirements, place, instructions };
}

function normalizeText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  return trimmed ? trimmed.slice(0, max) : null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  O prazo
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Quando vence o prazo de confirmação de UMA inscrição.
 *
 * O prazo é do FUSO DO EVENTO (armadilha 38): o participante lê "até 25/09" e é isso
 * que vale, mesmo que o processo rode em UTC. A conversão passa pelas duas passagens
 * de `zonedWallTimeToInstant` (horário de verão), em vez de somar 24 h × N — somar
 * horas erraria o dia exatamente nas viradas de horário de verão.
 *
 * O prazo NÃO é limitado pela data da atividade aqui: quem decide se ainda dá tempo é
 * o organizador, ao escolher os dias, e a inscrição só é aceita enquanto a janela de
 * inscrição está aberta.
 */
export function confirmationDueAt(input: {
  registeredAt: Date;
  windowDays: number;
  timeZone: string;
}): Date {
  const days = clampWindowDays(input.windowDays);
  const local = instantToZonedWallTime(input.registeredAt, input.timeZone);
  const [datePart] = local.split('T');
  const [year, month, day] = datePart!.split('-').map(Number);

  // Aritmética de CALENDÁRIO (UTC puro, sem fuso): aqui só se conta o dia, e o
  // instante é reconstruído depois com o deslocamento correto.
  const target = new Date(Date.UTC(year!, month! - 1, day! + days));
  const pad = (value: number): string => String(value).padStart(2, '0');
  const wallTime = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(
    target.getUTCDate(),
  )}T${pad(CONFIRMATION_DUE_HOUR)}:${pad(CONFIRMATION_DUE_MINUTE)}`;

  return zonedWallTimeToInstant(wallTime, input.timeZone) ?? input.registeredAt;
}

export function clampWindowDays(value: unknown): number {
  const days = Math.trunc(Number(value));

  if (!Number.isFinite(days)) return CONFIRMATION_WINDOW_DEFAULT_DAYS;

  return Math.min(Math.max(days, CONFIRMATION_WINDOW_MIN_DAYS), CONFIRMATION_WINDOW_MAX_DAYS);
}

/** Quantas horas antes do vencimento o lembrete sai. */
export const CONFIRMATION_REMINDER_LEAD_HOURS = 24;

/**
 * O lembrete deve sair agora?
 *
 * Duas condições, e as duas importam: falta menos de `lead` para o vencimento **e**
 * ainda há tempo (prazo não vencido). Sem a segunda, a varredura que roda depois do
 * vencimento mandaria "corra, falta 1 dia" para quem já perdeu a vaga — o pior aviso
 * possível, porque é falso e chega atrasado.
 */
export function shouldSendConfirmationReminder(input: {
  dueAt: Date | null;
  now: Date;
  alreadyReminded: boolean;
  leadHours?: number;
}): boolean {
  if (input.alreadyReminded) return false;
  if (!input.dueAt) return false;

  const lead = (input.leadHours ?? CONFIRMATION_REMINDER_LEAD_HOURS) * 3_600_000;
  const remaining = input.dueAt.getTime() - input.now.getTime();

  return remaining > 0 && remaining <= lead;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Estado da confirmação
// ───────────────────────────────────────────────────────────────────────────────
export type ConfirmationState =
  /** A atividade não pede confirmação (política `AUTO`) — ou não há vaga a confirmar. */
  | 'NOT_REQUIRED'
  /** Vaga retida, dentro do prazo. */
  | 'PENDING'
  /** Confirmada pela equipe. */
  | 'CONFIRMED'
  /** Prazo vencido e a varredura ainda não passou (a vaga está para ser liberada). */
  | 'EXPIRED'
  /** A varredura passou: a vaga foi liberada e a inscrição, cancelada. */
  | 'RELEASED';

/** O motivo gravado no cancelamento automático — é ele que distingue "liberada" de "desistiu". */
export const EXPIRY_CANCEL_REASON = 'Prazo de confirmação vencido';

export interface ConfirmationStateInput {
  policy: ConfirmationPolicy;
  status: RegistrationStatus;
  dueAt: Date | null;
  now: Date;
  cancelReason?: string | null;
}

/**
 * Traduz o par (status da inscrição, prazo) no que a confirmação significa HOJE.
 *
 * A ordem dos testes é a regra: política primeiro (atividade que não confirma nunca
 * mostra prazo), depois os estados que já são terminais (lista de espera não ocupa
 * vaga, logo não há o que confirmar) e só então o relógio.
 */
export function confirmationStateOf(input: ConfirmationStateInput): ConfirmationState {
  if (input.policy !== 'REQUIRED') return 'NOT_REQUIRED';

  /**
   * `WAITLISTED` fica de fora de propósito: quem está na espera NÃO ocupa vaga, e a
   * confirmação existe para liberar vaga. Promovido da espera, a linha vira
   * `CONFIRMED` (decisão da promoção, FASE 3): a equipe combinou o comparecimento
   * quando a vaga foi oferecida, e cobrar uma segunda confirmação de quem acabou de
   * ser chamado seria uma armadilha a mais para perder a vaga de novo.
   */
  if (input.status === 'WAITLISTED') return 'NOT_REQUIRED';

  if (input.status === 'CANCELED') {
    return input.cancelReason === EXPIRY_CANCEL_REASON ? 'RELEASED' : 'NOT_REQUIRED';
  }

  if (input.status === 'CONFIRMED' || input.status === 'ATTENDED' || input.status === 'NO_SHOW') {
    return 'CONFIRMED';
  }

  // Daqui para baixo, `PENDING`.
  if (!input.dueAt) return 'PENDING';

  return input.dueAt.getTime() <= input.now.getTime() ? 'EXPIRED' : 'PENDING';
}

// ───────────────────────────────────────────────────────────────────────────────
//  A confirmação pela equipe
// ───────────────────────────────────────────────────────────────────────────────
export type ConfirmationRefusalCode =
  | 'NOT_REQUIRED'
  | 'ALREADY_CONFIRMED'
  | 'RELEASED'
  | 'CANCELED'
  | 'EXPIRED'
  | 'ACTIVITY_CANCELED'
  | 'NOT_FOUND';

export type ConfirmationCheck =
  | { ok: true }
  | { ok: false; code: ConfirmationRefusalCode; message: string };

export interface CanConfirmInput {
  policy: ConfirmationPolicy;
  status: RegistrationStatus;
  dueAt: Date | null;
  now: Date;
  cancelReason?: string | null;
  activityCanceled: boolean;
}

/**
 * A equipe pode confirmar esta inscrição?
 *
 * A checagem de LEITURA existe para dar mensagem boa; a escrita NÃO confia nela —
 * ela usa `updateMany` condicional por `status = 'PENDING'`, e o retorno de 0 linhas
 * é a resposta de negócio (invariante nº 5). Duas pessoas confirmando ao mesmo tempo
 * no balcão produzem um efeito só.
 */
export function canConfirmRegistration(input: CanConfirmInput): ConfirmationCheck {
  if (input.policy !== 'REQUIRED') {
    return {
      ok: false,
      code: 'NOT_REQUIRED',
      message: 'Esta atividade confirma a vaga automaticamente na inscrição.',
    };
  }

  if (input.activityCanceled) {
    return { ok: false, code: 'ACTIVITY_CANCELED', message: 'Esta atividade foi cancelada.' };
  }

  const state = confirmationStateOf({
    policy: input.policy,
    status: input.status,
    dueAt: input.dueAt,
    now: input.now,
    cancelReason: input.cancelReason ?? null,
  });

  switch (state) {
    case 'CONFIRMED':
      return { ok: false, code: 'ALREADY_CONFIRMED', message: 'Esta vaga já está confirmada.' };
    case 'RELEASED':
      return {
        ok: false,
        code: 'RELEASED',
        message: 'O prazo venceu e a vaga foi liberada — a pessoa precisa se inscrever de novo.',
      };
    case 'EXPIRED':
      return {
        ok: false,
        code: 'EXPIRED',
        message: 'O prazo de confirmação venceu antes deste registro.',
      };
    case 'NOT_REQUIRED':
      return {
        ok: false,
        code: 'CANCELED',
        message: 'Esta inscrição não está aguardando confirmação.',
      };
    default:
      return { ok: true };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Textos derivados (e-mail, tela e checklist)
// ───────────────────────────────────────────────────────────────────────────────
/** "até 25/09/2026, 23:59" — no fuso do evento, que é o que a pessoa lê. */
export function confirmationDeadlineLabel(dueAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(dueAt);
}

/** Quanto falta, em linguagem de gente: "faltam 2 dias", "vence hoje". */
export function confirmationCountdown(dueAt: Date, now: Date): string {
  const remaining = dueAt.getTime() - now.getTime();

  if (remaining <= 0) return 'prazo vencido';

  const hours = Math.floor(remaining / 3_600_000);
  const days = Math.floor(hours / 24);

  if (days >= 2) return `faltam ${days} dias`;
  if (days === 1) return 'falta 1 dia';
  if (hours >= 1) return `faltam ${hours} hora(s)`;

  return 'vence em menos de uma hora';
}

/**
 * As linhas do "o que é preciso" — o mesmo texto no e-mail, na tela e na fila do
 * balcão. Uma segunda cópia dele faria o e-mail pedir o que a tela não pede.
 */
export function confirmationRequirementLines(
  requirements: readonly ConfirmationRequirement[],
): string[] {
  return requirements.map((requirement) => requirementLabel(requirement));
}
