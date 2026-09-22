/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Central do participante e inteligência da instituição (FASE 32)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO DECIDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Tudo o que a tela do módulo afirma sobre uma pessoa ou sobre a instituição sai
 *  daqui, na forma de função pura: a taxa de comparecimento, os rótulos de
 *  engajamento, a máscara de e-mail, a média de minutos, os limites do recado, a
 *  chave de deduplicação da mensagem, o escape do CSV e a janela de período.
 *
 *  Nada aqui importa Prisma ou Next — é o mesmo contrato das outras áreas: a regra
 *  é testável sem banco, sem tela e sem rede.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ARMADILHA QUE DEFINE O DESENHO: "SEM DADO" NÃO É ZERO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem nunca foi a nada e quem não teve a chance de ir têm a MESMA contagem — e a
 *  tela não pode dizer a mesma coisa para os dois. Por isso toda métrica derivada
 *  aqui devolve `null` (não `0`) quando o denominador é zero, e quem exibe decide
 *  mostrar "—". Um `0%` inventado mancha o relatório da instituição e a conversa
 *  com o participante ("você não compareceu a nada") sem base em fato.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  instantToZonedWallTime,
  isValidTimeZone,
  zonedWallTimeToInstant,
} from '@/domain/events/scheduling-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Limites (regra, não `if` de tela)
// ───────────────────────────────────────────────────────────────────────────────
/** Página do diretório. O diretório é paginado desde o primeiro dia. */
export const PARTICIPANT_PAGE_SIZE = 25;
/** Teto de linhas que o diretório devolve numa consulta — a página nunca "traz tudo". */
export const PARTICIPANT_LIMIT = 500;
/** Teto do CSV exportado: o arquivo é para conferência humana, não para ETL. */
export const CSV_MAX_ROWS = 5_000;
export const MESSAGE_SUBJECT_MAX = 140;
export const MESSAGE_BODY_MAX = 2_000;
/**
 * Quantas pessoas um envio em massa alcança por vez.
 *
 * O e-mail sai pela fila (FASE 15), mas cada destinatário é uma mensagem no outbox
 * e um job: sem teto, um clique em "todos os inscritos da instituição" viraria
 * milhares de jobs e uma conta de envio inesperada. O limite é EXPLÍCITO e a tela
 * diz quantos ficaram de fora.
 */
export const MESSAGE_BATCH_LIMIT = 200;

/**
 * Teto da página. Existe para que `?tamanho=100000` (ou um bug de tela) não vire uma
 * consulta que devolve a instituição inteira numa resposta.
 */
export const MAX_PARTICIPANT_PAGE_SIZE = 100;

export interface ParticipantPage {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  skip: number;
}

/**
 * Normaliza a paginação do diretório — o MESMO padrão do histórico de sorteios
 * (`resolveRafflePage`): número fora da faixa é corrigido em vez de recusado, e a
 * página além do fim cai na última (pedir `page=99` de 3 páginas devolve a 3).
 */
export function resolveParticipantPage(input: {
  page?: number;
  pageSize?: number;
  total: number;
}): ParticipantPage {
  const pageSize = Math.min(
    Math.max(1, Math.floor(input.pageSize ?? PARTICIPANT_PAGE_SIZE)),
    MAX_PARTICIPANT_PAGE_SIZE,
  );
  const total = Math.max(0, Math.floor(input.total));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(input.page ?? 1)), totalPages);

  return { page, pageSize, total, totalPages, skip: (page - 1) * pageSize };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Quem conta como participante da instituição
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A ORIGEM do participante no diretório.
 *
 * O diretório é a UNIÃO de duas fontes, e isso é decisão, não detalhe de consulta:
 * o vínculo (`user_tenant_profiles`, kind `PARTICIPANT`) nasce na inscrição
 * pública desde a FASE 10, mas existem pessoas com inscrição e SEM vínculo (equipe
 * que se inscreveu, dado anterior à fase, inscrição lançada pela organização). Se o
 * diretório olhasse só o vínculo, gente que está na lista de presença sumiria do
 * relatório; se olhasse só a inscrição, quem se cadastrou e ainda não se inscreveu
 * em nada — e é a quem a instituição quer mandar um recado — desapareceria.
 */
export type ParticipantOrigin = 'MEMBERSHIP' | 'REGISTRATION';

export const PARTICIPANT_ORIGIN_LABELS: Record<ParticipantOrigin, string> = {
  MEMBERSHIP: 'Vínculo de participante',
  REGISTRATION: 'Só inscrição',
};

// ───────────────────────────────────────────────────────────────────────────────
//  Taxa de comparecimento
// ───────────────────────────────────────────────────────────────────────────────
export interface AttendanceRate {
  /**
   * Percentual inteiro (0 a 100) ou `null` quando não há inscrição confirmada
   * sobre a qual falar. `null` é diferente de `0`.
   */
  percent: number | null;
  /** Texto pronto para a tela — inclui o caso sem dado, para ninguém reimplementar. */
  label: string;
  hasData: boolean;
}

/**
 * Inscrições CONFIRMADAS × presenças efetivas.
 *
 * O denominador é a inscrição confirmada, não a "esperada" e não a presença: a taxa
 * responde "de quem se comprometeu a ir, quantos foram?". Usar a presença como
 * denominador daria sempre 100%.
 */
export function attendanceRate(input: { confirmed: number; attended: number }): AttendanceRate {
  const confirmed = Math.max(0, Math.trunc(input.confirmed));
  const attended = Math.max(0, Math.trunc(input.attended));

  if (confirmed === 0) {
    return { percent: null, label: 'Sem inscrições confirmadas', hasData: false };
  }

  // Presença maior que confirmada existe (leitura fora da inscrição, ADR-151):
  // a taxa não passa de 100% — o excedente aparece no número absoluto.
  const capped = Math.min(attended, confirmed);
  const percent = Math.round((capped / confirmed) * 100);

  return { percent, label: `${percent}% de comparecimento`, hasData: true };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Engajamento
// ───────────────────────────────────────────────────────────────────────────────
export type EngagementTag =
  | 'NEWCOMER'
  | 'REGULAR'
  | 'VETERAN'
  | 'ASSIDUOUS'
  | 'CERTIFIED'
  | 'COLLECTOR';

export const ENGAGEMENT_LABELS: Record<EngagementTag, string> = {
  NEWCOMER: 'Primeira participação',
  REGULAR: 'Participa com frequência',
  VETERAN: 'Veterano(a) da instituição',
  ASSIDUOUS: 'Assíduo(a)',
  CERTIFIED: 'Tem certificado',
  COLLECTOR: 'Coleciona cartas',
};

export interface EngagementFacts {
  /** Eventos distintos em que a pessoa tem inscrição. */
  events: number;
  /** Sessões de frequência registradas (uma por visita, com minutos). */
  visits: number;
  minutes: number;
  certificates: number;
  cards: number;
  xp: number;
}

/** Pisos das faixas — nomeados para que a tela não invente número solto. */
export const VETERAN_EVENT_FLOOR = 3;
export const REGULAR_EVENT_FLOOR = 2;
export const ASSIDUOUS_MINUTES_FLOOR = 240;
export const COLLECTOR_CARD_FLOOR = 3;

/**
 * Rótulos de engajamento a partir de FATOS já apurados.
 *
 * Não é "score": são fatos com nome. A escolha evita o número arbitrário ("87 de
 * engajamento") que ninguém sabe explicar e que muda de significado a cada versão.
 * A ordem é estável (do mais específico ao mais genérico) para a tela não piscar
 * cores diferentes a cada render.
 */
export function engagementOf(facts: EngagementFacts): readonly EngagementTag[] {
  const tags: EngagementTag[] = [];

  if (facts.certificates > 0) tags.push('CERTIFIED');
  if (facts.cards >= COLLECTOR_CARD_FLOOR) tags.push('COLLECTOR');
  if (facts.minutes >= ASSIDUOUS_MINUTES_FLOOR) tags.push('ASSIDUOUS');
  if (facts.events >= VETERAN_EVENT_FLOOR) tags.push('VETERAN');
  else if (facts.events >= REGULAR_EVENT_FLOOR) tags.push('REGULAR');

  // Quem ainda não tem história recebe o rótulo que diz isso — nunca lista vazia,
  // senão a tela mostra um espaço em branco que parece defeito.
  if (tags.length === 0) tags.push('NEWCOMER');

  return tags;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Privacidade
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Mascara o e-mail para a LISTA (a ficha mostra completo).
 *
 * O diretório é a tela mais copiada da instituição — planilha, print, tela
 * compartilhada no telão da secretaria. A lista responde "quem é esta pessoa e
 * como ela está?", e para isso o domínio do endereço basta. O endereço completo é
 * dado de contato, e dado de contato se vê na ficha de quem já decidiu abrir
 * aquele cadastro.
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');

  if (at <= 0 || at === trimmed.length - 1) return '—';

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const first = local.slice(0, 1);

  return `${first}${'*'.repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Médias
// ───────────────────────────────────────────────────────────────────────────────
/** Minutos por visita — `null` sem visita (não é "0 minuto"). */
export function averageMinutesPerVisit(input: { minutes: number; visits: number }): number | null {
  const visits = Math.max(0, Math.trunc(input.visits));
  if (visits === 0) return null;

  return Math.round(Math.max(0, Math.trunc(input.minutes)) / visits);
}

/**
 * Cobertura de certificado: certificados ÷ eventos com presença.
 *
 * Mede o que a instituição ENTREGA, então o denominador é a presença confirmada —
 * não a inscrição, que inflaria a conta com quem não apareceu.
 */
export function certificateCoverage(input: {
  certificates: number;
  attendedEvents: number;
}): number | null {
  const attended = Math.max(0, Math.trunc(input.attendedEvents));
  if (attended === 0) return null;

  return Math.round((Math.max(0, Math.trunc(input.certificates)) / attended) * 100);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Recado (e-mail + mensagem interna)
// ───────────────────────────────────────────────────────────────────────────────
export interface MessageDraft {
  subject: string;
  body: string;
}

export type MessageValidation =
  | { ok: true; subject: string; body: string }
  | { ok: false; code: 'INVALID_SUBJECT' | 'INVALID_BODY'; message: string };

/** Valida e normaliza o recado. Espaço em excesso não é erro do autor — é arrumado. */
export function validateMessage(draft: { subject: unknown; body: unknown }): MessageValidation {
  const subject = typeof draft.subject === 'string' ? draft.subject.trim() : '';
  const body = typeof draft.body === 'string' ? draft.body.trim() : '';

  if (subject.length < 3 || subject.length > MESSAGE_SUBJECT_MAX) {
    return {
      ok: false,
      code: 'INVALID_SUBJECT',
      message: `Escreva um assunto de 3 a ${MESSAGE_SUBJECT_MAX} caracteres.`,
    };
  }

  if (body.length < 3 || body.length > MESSAGE_BODY_MAX) {
    return {
      ok: false,
      code: 'INVALID_BODY',
      message: `Escreva a mensagem com 3 a ${MESSAGE_BODY_MAX} caracteres.`,
    };
  }

  return { ok: true, subject, body };
}

/**
 * Chave de deduplicação do e-mail do recado.
 *
 * O `dedupeKey` do outbox (FASE 15) carrega o FATO, não o momento — e o fato aqui
 * é a MENSAGEM gravada (`participant_messages.id`), não o par (pessoa, assunto).
 * Sem o id, dois recados com o mesmo assunto para a mesma pessoa no mesmo dia
 * virariam um só, e o segundo desapareceria sem ninguém entender por quê. Com o
 * id, o reenvio do job é idempotente e o recado novo é sempre um fato novo.
 */
export function messageDedupeKey(input: {
  tenantId: string;
  userId: string;
  messageId: string;
}): string {
  return `participant-message-${input.tenantId}-${input.userId}-${input.messageId}`;
}

/** Trecho da mensagem para a lista, com reticências (a lista não carrega o corpo). */
export function messagePreview(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;

  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  CSV
// ───────────────────────────────────────────────────────────────────────────────
export type CsvValue = string | number | null | undefined;

/**
 * Célula de CSV segura.
 *
 * Duas defesas, e as duas têm histórico:
 *   • aspas e quebras de linha — um nome com `;` ou com enter desmonta a coluna e a
 *     planilha inteira sai desalinhada;
 *   • **fórmula**: campo que começa com `=`, `+`, `-`, `@`, tabulação ou retorno
 *     passa a ser FÓRMULA quando o arquivo abre no Excel/LibreOffice. Um nome de
 *     pessoa é dado de fora do sistema: prefixar com apóstrofo é o que impede o
 *     arquivo exportado de virar execução na máquina de quem abriu.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  const dangerous = /^[=+\-@\t\r]/;

  if (dangerous.test(text)) return `"'${text.replace(/"/g, '""')}"`;
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;

  return text;
}

/** CSV completo (com BOM e `;`, que é o separador que o Excel pt-BR entende). */
export function buildCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header.map(csvCell).join(';')];

  for (const row of rows) {
    lines.push(row.map(csvCell).join(';'));
  }

  // O BOM é o que faz o Excel pt-BR abrir os acentos certos em vez de "Ã§Ã£o".
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Período da inteligência da instituição
// ───────────────────────────────────────────────────────────────────────────────
export type IntelligenceRange = 'ALL' | '30D' | '90D' | 'YEAR' | 'CUSTOM';

export const INTELLIGENCE_RANGE_LABELS: Record<IntelligenceRange, string> = {
  ALL: 'Todo o histórico',
  '30D': 'Últimos 30 dias',
  '90D': 'Últimos 90 dias',
  YEAR: 'Ano corrente',
  CUSTOM: 'Período escolhido',
};

export const INTELLIGENCE_RANGES: readonly IntelligenceRange[] = Object.freeze([
  'ALL',
  '30D',
  '90D',
  'YEAR',
  'CUSTOM',
]);

export interface ResolvedRange {
  /** Início do período (inclusive) ou `null` quando o período é todo o histórico. */
  from: Date | null;
  /** Fim do período (exclusivo, início do dia seguinte no fuso da instituição). */
  to: Date;
  range: IntelligenceRange;
  label: string;
  timeZone: string;
}

/**
 * Converte o período escolhido em INSTANTES, no fuso da INSTITUIÇÃO.
 *
 * `Tenant.timezone` manda aqui, e não o fuso do processo (UTC no container) nem o do
 * navegador: "os últimos 30 dias" precisa significar a mesma coisa para quem lê o
 * relatório e para quem grava a presença (armadilha 38). A conversão usa as duas
 * passagens de `zonedWallTimeToInstant`, que já resolvem horário de verão.
 *
 * O fim é o INÍCIO DO DIA SEGUINTE, e a consulta usa `< to` — assim o dia inteiro
 * entra, sem depender de acertar o último segundo (armadilha 57).
 */
export function resolveRange(input: {
  range: IntelligenceRange;
  now: Date;
  timeZone: string;
  fromDay?: string | null;
  toDay?: string | null;
}): ResolvedRange {
  const timeZone = isValidTimeZone(input.timeZone) ? input.timeZone : 'UTC';
  const todayWall = instantToZonedWallTime(input.now, timeZone).slice(0, 10);

  const startOfDay = (day: string): Date | null => zonedWallTimeToInstant(`${day}T00:00`, timeZone);

  const shiftDays = (day: string, days: number): string => {
    const anchor = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
    const moved = new Date(anchor + days * 86_400_000);

    return moved.toISOString().slice(0, 10);
  };

  const to = startOfDay(shiftDays(todayWall, 1)) ?? input.now;

  if (input.range === 'CUSTOM') {
    const fromDay = input.fromDay ?? todayWall;
    const toDay = input.toDay ?? todayWall;
    const from = startOfDay(fromDay);
    const exclusiveTo = startOfDay(shiftDays(toDay, 1));

    return {
      from,
      to: exclusiveTo ?? to,
      range: 'CUSTOM',
      label: `${fromDay.split('-').reverse().join('/')} a ${toDay.split('-').reverse().join('/')}`,
      timeZone,
    };
  }

  if (input.range === 'ALL') {
    return { from: null, to, range: 'ALL', label: INTELLIGENCE_RANGE_LABELS.ALL, timeZone };
  }

  if (input.range === 'YEAR') {
    const from = startOfDay(`${todayWall.slice(0, 4)}-01-01`);

    return { from, to, range: 'YEAR', label: INTELLIGENCE_RANGE_LABELS.YEAR, timeZone };
  }

  const days = input.range === '30D' ? 30 : 90;

  return {
    from: startOfDay(shiftDays(todayWall, -days)),
    to,
    range: input.range,
    label: INTELLIGENCE_RANGE_LABELS[input.range],
    timeZone,
  };
}
