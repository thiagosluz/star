/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Certificação
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UM CERTIFICADO É UM DOCUMENTO, NÃO UMA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Três consequências diretas deste fato:
 *
 *  1. O CONTEÚDO É CONGELADO (snapshot). Título do evento, nome do participante,
 *     carga horária e texto são copiados no momento da emissão. Editar o evento
 *     depois NÃO pode alterar um documento já emitido — se alterasse, dois
 *     certificados do mesmo evento discordariam entre si.
 *
 *  2. A CARGA HORÁRIA É MEDIDA, NÃO PRESUMIDA. Ela vem das presenças reais
 *     (`Attendance.minutesAttended`), com teto na carga declarada da atividade.
 *     Quem ficou 300 minutos em um minicurso de 240 não tem 300 minutos de
 *     minicurso: tem 240.
 *
 *  3. O HASH COBRE O CONTEÚDO CANÔNICO, não o arquivo. Assim o mesmo certificado
 *     pode ser renderizado em PDF e em SVG e ambos continuam verificáveis contra
 *     o MESMO hash — o renderizador vira detalhe de apresentação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';

// ───────────────────────────────────────────────────────────────────────────────
//  Tipos (espelham os enums do schema — o domínio não importa o ORM)
// ───────────────────────────────────────────────────────────────────────────────
export type CertificateKind =
  | 'ATTENDANCE'
  | 'SPEAKER'
  | 'ORGANIZER'
  | 'REVIEWER'
  | 'AUTHOR'
  | 'MINI_COURSE'
  | 'PARTICIPATION'
  | 'MERIT';

export const CERTIFICATE_KINDS: readonly CertificateKind[] = [
  'ATTENDANCE',
  'SPEAKER',
  'ORGANIZER',
  'REVIEWER',
  'AUTHOR',
  'MINI_COURSE',
  'PARTICIPATION',
  'MERIT',
];

export const CERTIFICATE_KIND_LABELS: Readonly<Record<CertificateKind, string>> = {
  ATTENDANCE: 'Certificado de participação em atividade',
  SPEAKER: 'Certificado de palestrante',
  ORGANIZER: 'Certificado de organização',
  REVIEWER: 'Certificado de avaliação por pares',
  AUTHOR: 'Certificado de autoria',
  MINI_COURSE: 'Certificado de conclusão de minicurso',
  PARTICIPATION: 'Certificado de participação no evento',
  MERIT: 'Certificado de mérito',
};

/**
 * Fração mínima da carga da atividade para a presença contar.
 *
 * Mesma constante usada na gamificação (FASE 5) e no credenciamento. Manter uma
 * definição só evita o absurdo de "ganhou XP mas não tem direito ao certificado"
 * — ou o inverso, que é pior: documentar presença que não houve.
 */
export const MIN_ATTENDANCE_RATIO = 0.75;

/** Piso em minutos quando a atividade não declara carga horária. */
export const MIN_ATTENDANCE_MINUTES = 30;

// ───────────────────────────────────────────────────────────────────────────────
//  Carga horária real
// ───────────────────────────────────────────────────────────────────────────────
export interface AttendanceRecord {
  activityId: string | null;
  activityTitle: string | null;
  activityType: string | null;
  /** Carga declarada da atividade, em minutos (0 = não declarada). */
  workloadMinutes: number;
  /** Minutos efetivamente cumpridos (medidos entre check-in e check-out). */
  minutesAttended: number;
}

export interface WorkloadBreakdownEntry {
  activityId: string | null;
  title: string;
  type: string | null;
  minutesAttended: number;
  workloadMinutes: number;
  /** Minutos que entraram no total (limitados pela carga declarada). */
  countedMinutes: number;
  counted: boolean;
  reason: string | null;
}

export interface WorkloadResult {
  totalMinutes: number;
  entries: WorkloadBreakdownEntry[];
  /** Atividades com presença suficiente para contar. */
  countedActivities: number;
  /** Carga declarada das atividades consideradas. */
  declaredMinutes: number;
}

/**
 * Calcula a carga horária REAL.
 *
 * Regras:
 *   • presença abaixo do mínimo não conta — e o motivo fica registrado, porque o
 *     certificado precisa explicar por que uma atividade não entrou;
 *   • minutos acima da carga declarada são truncados (teto);
 *   • atividade sem carga declarada usa os minutos medidos (não há teto a aplicar).
 *
 * `activityFilter` permite gerar certificado de UM tipo (minicurso) sem misturar
 * palestras na conta.
 */
export function computeWorkload(input: {
  attendances: readonly AttendanceRecord[];
  activityFilter?: (record: AttendanceRecord) => boolean;
}): WorkloadResult {
  const entries: WorkloadBreakdownEntry[] = [];
  let totalMinutes = 0;
  let countedActivities = 0;
  let declaredMinutes = 0;

  for (const record of input.attendances) {
    const title = record.activityTitle?.trim() || 'Atividade';
    const measured = Math.max(0, Math.round(record.minutesAttended));
    const workload = Math.max(0, Math.round(record.workloadMinutes));
    const threshold = Math.max(MIN_ATTENDANCE_MINUTES, Math.round(workload * MIN_ATTENDANCE_RATIO));

    if (input.activityFilter && !input.activityFilter(record)) {
      entries.push({
        activityId: record.activityId,
        title,
        type: record.activityType,
        minutesAttended: measured,
        workloadMinutes: workload,
        countedMinutes: 0,
        counted: false,
        reason: 'Atividade não se aplica a este tipo de certificado.',
      });
      continue;
    }

    if (measured < threshold) {
      entries.push({
        activityId: record.activityId,
        title,
        type: record.activityType,
        minutesAttended: measured,
        workloadMinutes: workload,
        countedMinutes: 0,
        counted: false,
        reason: `Presença de ${measured} min abaixo do mínimo de ${threshold} min (75 % da carga).`,
      });
      continue;
    }

    // Teto: ninguém cumpre mais carga do que a atividade oferece.
    const counted = workload > 0 ? Math.min(measured, workload) : measured;

    entries.push({
      activityId: record.activityId,
      title,
      type: record.activityType,
      minutesAttended: measured,
      workloadMinutes: workload,
      countedMinutes: counted,
      counted: true,
      reason: workload > 0 && measured > workload ? 'Minutos excedentes limitados à carga da atividade.' : null,
    });

    totalMinutes += counted;
    countedActivities += 1;
    declaredMinutes += workload;
  }

  return { totalMinutes, entries, countedActivities, declaredMinutes };
}

/** Formata minutos como "12h30" / "8h" / "45min" (apresentação, não cálculo). */
export function formatWorkload(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;

  if (hours === 0) return `${rest}min`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${String(rest).padStart(2, '0')}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Elegibilidade
// ───────────────────────────────────────────────────────────────────────────────
export interface EligibilityFacts {
  kind: CertificateKind;
  /** Presenças do usuário no evento (com dados da atividade). */
  attendances: readonly AttendanceRecord[];
  /** O usuário tem check-in de credenciamento no evento? */
  eventCheckedIn: boolean;
  /** Quantas atividades do evento são do tipo minicurso. */
  miniCourseCount: number;
  /** É palestrante de alguma atividade? */
  isSpeaker: boolean;
  /**
   * Carga horária do palestrante já apurada (FASE 25).
   *
   * `null` quando a pessoa não é palestrante. As atividades que contam são apenas
   * as EFETIVAMENTE ministradas — ver `computeSpeakerWorkload` em
   * `src/domain/speakers/speaker-rules.ts`: cancelada ou ainda não concluída não
   * entra na soma, porque o certificado declara fato consumado.
   */
  speakerWorkload: WorkloadResult | null;
  /** Pareceres concluídos no evento. */
  completedReviews: number;
  /** Trabalhos aceitos no evento. */
  acceptedSubmissions: number;
  /**
   * O evento já terminou? (FASE 25)
   *
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE ESTE FATO EXISTE
   * ─────────────────────────────────────────────────────────────────────────────
   *  O certificado de PARTICIPAÇÃO pode ser pedido durante o evento — quem já
   *  cumpriu a carga do minicurso tem direito a ele. O de PALESTRANTE, não: ele
   *  atesta que a pessoa ministrou a atividade inteira, e durante o evento isso
   *  ainda não é fato. Emitir antes seria atestar o futuro.
   */
  eventFinished: boolean;
}

export interface EligibilityVerdict {
  eligible: boolean;
  reason: string;
  /** Atividades que fundamentam o certificado (auditoria). */
  workload: WorkloadResult;
}

/**
 * Decide se o certificado pode ser emitido — e diz POR QUÊ quando não pode.
 *
 * A recusa é textual de propósito: "não elegível" sem motivo obriga o
 * participante a abrir um chamado para descobrir que faltaram 12 minutos de
 * presença.
 */
export function evaluateEligibility(facts: EligibilityFacts): EligibilityVerdict {
  const all = computeWorkload({ attendances: facts.attendances });

  switch (facts.kind) {
    case 'MINI_COURSE': {
      const miniCourses = computeWorkload({
        attendances: facts.attendances,
        activityFilter: (record) => record.activityType === 'MINI_COURSE',
      });

      if (facts.miniCourseCount === 0) {
        return {
          eligible: false,
          reason: 'Este evento não tem minicursos.',
          workload: miniCourses,
        };
      }

      if (miniCourses.countedActivities === 0) {
        return {
          eligible: false,
          reason:
            'Nenhum minicurso com carga horária cumprida (mínimo de 75 % da carga da atividade).',
          workload: miniCourses,
        };
      }

      return { eligible: true, reason: 'Minicurso concluído com presença suficiente.', workload: miniCourses };
    }

    case 'ATTENDANCE': {
      if (all.countedActivities === 0) {
        return {
          eligible: false,
          reason: 'Nenhuma atividade com presença suficiente (mínimo de 75 % da carga).',
          workload: all,
        };
      }

      return { eligible: true, reason: 'Presença registrada em atividade do evento.', workload: all };
    }

    case 'PARTICIPATION': {
      if (!facts.eventCheckedIn && all.countedActivities === 0) {
        return {
          eligible: false,
          reason: 'Não há credenciamento no evento nem presença em atividade.',
          workload: all,
        };
      }

      return { eligible: true, reason: 'Participação registrada no evento.', workload: all };
    }

    case 'SPEAKER': {
      const speakerWorkload = facts.speakerWorkload ?? all;

      if (!facts.isSpeaker) {
        return { eligible: false, reason: 'O participante não consta como palestrante.', workload: speakerWorkload };
      }

      /**
       * ─────────────────────────────────────────────────────────────────────────
       *  TRÊS PORTAS, NESTA ORDEM (FASE 25)
       * ─────────────────────────────────────────────────────────────────────────
       *  Cada uma responde uma pergunta diferente, e a mensagem diz QUAL faltou —
       *  "não elegível" sem motivo obrigaria o palestrante a abrir um chamado para
       *  descobrir que o credenciamento dele não foi registrado no balcão.
       */
      if (!facts.eventFinished) {
        return {
          eligible: false,
          reason: 'O certificado de palestrante é emitido após o término do evento.',
          workload: speakerWorkload,
        };
      }

      if (!facts.eventCheckedIn) {
        return {
          eligible: false,
          reason:
            'O credenciamento do palestrante no evento ainda não foi registrado. Procure a organização no local.',
          workload: speakerWorkload,
        };
      }

      if (speakerWorkload.countedActivities === 0) {
        return {
          eligible: false,
          reason:
            'Nenhuma atividade ministrada entrou na apuração (atividade cancelada ou ainda não concluída).',
          workload: speakerWorkload,
        };
      }

      return {
        eligible: true,
        reason: `Palestrante em ${speakerWorkload.countedActivities} atividade(s) do evento.`,
        workload: speakerWorkload,
      };
    }

    case 'REVIEWER': {
      if (facts.completedReviews <= 0) {
        return { eligible: false, reason: 'Nenhum parecer concluído neste evento.', workload: all };
      }

      return {
        eligible: true,
        reason: `${facts.completedReviews} parecer(es) concluído(s).`,
        workload: all,
      };
    }

    case 'AUTHOR': {
      if (facts.acceptedSubmissions <= 0) {
        return { eligible: false, reason: 'Nenhum trabalho aceito neste evento.', workload: all };
      }

      return {
        eligible: true,
        reason: `${facts.acceptedSubmissions} trabalho(s) aceito(s).`,
        workload: all,
      };
    }

    case 'ORGANIZER': {
      /**
       * Organização não depende de presença: quem organizou pode ter passado o
       * evento inteiro resolvendo problema nos bastidores. A elegibilidade vem do
       * PAPEL, verificada por quem emite (a ação exige permissão de emissão).
       */
      return { eligible: true, reason: 'Papel de organização no evento.', workload: all };
    }

    case 'MERIT': {
      // Mérito é decisão humana, nunca automática.
      return { eligible: false, reason: 'Certificado de mérito é emitido por decisão do comitê.', workload: all };
    }

    default: {
      return { eligible: false, reason: 'Tipo de certificado desconhecido.', workload: all };
    }
  }
}

/** Quais tipos fazem sentido automático para estes fatos (emissão em lote). */
export function eligibleKindsFor(facts: Omit<EligibilityFacts, 'kind'>): CertificateKind[] {
  return CERTIFICATE_KINDS.filter((kind) => {
    if (kind === 'MERIT') return false;
    if (kind === 'ORGANIZER') return false; // exige papel, não fato
    return evaluateEligibility({ ...facts, kind }).eligible;
  });}

// ───────────────────────────────────────────────────────────────────────────────
//  Texto do certificado
// ───────────────────────────────────────────────────────────────────────────────
export interface CertificateTextInput {
  kind: CertificateKind;
  recipientName: string;
  eventTitle: string;
  eventStartsAt: Date | null;
  eventEndsAt: Date | null;
  workloadMinutes: number;
  activityTitle?: string | null;
  tenantName: string;
  timeZone: string;
}

export interface CertificateText {
  title: string;
  bodyText: string;
  workloadMinutes: number;
  period: string | null;
  workloadLabel: string;
}

/**
 * Monta o texto do certificado.
 *
 * O corpo é escrito uma vez e CONGELADO no snapshot: se a redação mudar em uma
 * próxima versão, os certificados antigos continuam com o texto que foi emitido.
 */
export function buildCertificateText(input: CertificateTextInput): CertificateText {
  const workloadLabel = formatWorkload(input.workloadMinutes);

  const period = formatPeriod(input.eventStartsAt, input.eventEndsAt, input.timeZone);

  const kindSentence: Record<CertificateKind, string> = {
    ATTENDANCE: 'pela participação nas atividades',
    SPEAKER: 'pela atuação como palestrante',
    ORGANIZER: 'pela organização',
    REVIEWER: 'pela atuação como avaliador(a) de trabalhos científicos',
    AUTHOR: 'pela autoria de trabalho aprovado',
    MINI_COURSE: 'pela conclusão do minicurso',
    PARTICIPATION: 'pela participação',
    MERIT: 'pelo mérito reconhecido',
  };

  const target = input.activityTitle
    ? `${kindSentence[input.kind]} "${input.activityTitle}"`
    : `${kindSentence[input.kind]} do evento "${input.eventTitle}"`;

  const parts = [
    `Certificamos que ${input.recipientName} participou ${target}`,
    period ? `realizado em ${period}` : null,
    `com carga horária de ${workloadLabel}.`,
  ].filter(Boolean);

  return {
    title: CERTIFICATE_KIND_LABELS[input.kind],
    bodyText: `${parts.join(', ').replace(', com carga', ' com carga')}`,
    workloadMinutes: input.workloadMinutes,
    period,
    workloadLabel,
  };
}

/** Período legível do evento, no fuso da instituição. */
export function formatPeriod(startsAt: Date | null, endsAt: Date | null, timeZone: string): string | null {
  if (!startsAt) return null;

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const start = formatter.format(startsAt);
  if (!endsAt) return start;

  const sameDay =
    new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(startsAt) ===
    new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(endsAt);

  if (sameDay) return start;

  const end = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: 'long',
  }).format(endsAt);

  return `${start} a ${end}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Código de validação
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Alfabeto SEM caracteres ambíguos.
 *
 * O código é lido em voz alta, digitado à mão e transcrito de um QR Code
 * impresso. Foram removidos os símbolos que se confundem na leitura:
 *
 *   0/O · 1/I/L · 5/S · 2/Z
 *
 * Restam 29 símbolos: 29⁸ ≈ 5 × 10¹¹ combinações — suficiente para que um código
 * válido não seja adivinhável por tentativa — e o tamanho (8) mantém o código
 * imprimível no certificado sem virar uma linha ilegível.
 */
export const VALIDATION_ALPHABET = '23456789ABCDEFGHJKMNPQRTUVWXY';
export const VALIDATION_CODE_LENGTH = 8;

/** Prefixo legível: `CERT-` ajuda a reconhecer o código em um e-mail ou crachá. */
export const VALIDATION_CODE_PREFIX = 'CERT-';

/**
 * Gera um código de validação.
 *
 * Usa `randomInt` criptográfico (não `Math.random`): o código é a chave de acesso
 * à validação pública e, em muitos eventos, o único mecanismo de prova de
 * autenticidade. Previsibilidade aqui é fraude.
 */
export function generateValidationCode(randomInt: (max: number) => number): string {
  let code = '';
  for (let index = 0; index < VALIDATION_CODE_LENGTH; index += 1) {
    code += VALIDATION_ALPHABET[randomInt(VALIDATION_ALPHABET.length)];
  }
  return `${VALIDATION_CODE_PREFIX}${code}`;
}

/**
 * Normaliza o que a pessoa digitou: caixa, espaços e prefixo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO "CORRIGIMOS" CARACTERES PARECIDOS
 * ─────────────────────────────────────────────────────────────────────────────
 *  A tentação é mapear `O`→`Q`, `I`→`J`, `S`→`Z` para perdoar a leitura errada.
 *  Isso é perigoso: o mapeamento transforma um erro de digitação em OUTRO código
 *  — que pode existir e pertencer a uma pessoa diferente. Mostrar o certificado
 *  de um estranho por causa de um typo é pior do que dizer "código inválido".
 *
 *  Então o alfabeto é respeitado: caractere fora dele **reprova o formato** e a
 *  página orienta a conferir o código (e informa quais símbolos existem).
 */
export function normalizeValidationCode(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
  const body = cleaned.startsWith('CERT') ? cleaned.slice('CERT'.length) : cleaned;

  return `${VALIDATION_CODE_PREFIX}${body}`;
}

/**
 * O código tem o formato esperado?
 *
 * Não diz se existe — apenas se é plausível. Serve para responder rápido a um
 * código malformado sem tocar no banco (e sem contar como tentativa de acesso).
 */
export function isValidValidationCodeFormat(code: string): boolean {
  const normalized = normalizeValidationCode(code);
  const body = normalized.slice(VALIDATION_CODE_PREFIX.length);

  if (body.length !== VALIDATION_CODE_LENGTH) return false;
  return [...body].every((char) => VALIDATION_ALPHABET.includes(char));
}

// ───────────────────────────────────────────────────────────────────────────────
//  Conteúdo canônico e hash
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Conteúdo canônico do certificado — a base do hash e da assinatura.
 *
 * A ordem das chaves é FIXA e explícita: `JSON.stringify` de um objeto preserva a
 * ordem de inserção, mas depender disso em qualquer lugar do sistema seria
 * frágil. Aqui a ordem é parte do contrato: mudar a ordem muda o hash de todos os
 * certificados.
 */
export interface CanonicalCertificate {
  version: 1;
  validationCode: string;
  tenantId: string;
  eventId: string;
  userId: string;
  activityId: string | null;
  kind: CertificateKind;
  recipientName: string;
  title: string;
  bodyText: string;
  workloadMinutes: number;
  issuedAt: string;
}

export function buildCanonicalPayload(input: CanonicalCertificate): string {
  const ordered: CanonicalCertificate = {
    version: input.version,
    validationCode: input.validationCode,
    tenantId: input.tenantId,
    eventId: input.eventId,
    userId: input.userId,
    activityId: input.activityId,
    kind: input.kind,
    recipientName: input.recipientName.trim(),
    title: input.title.trim(),
    bodyText: input.bodyText.trim(),
    workloadMinutes: input.workloadMinutes,
    issuedAt: input.issuedAt,
  };

  return JSON.stringify(ordered);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Conteúdo canônico — versão 2 (o documento com LAYOUT)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A versão 2 do documento (FASE 40).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA VERSÃO NOVA, E NÃO UMA MUDANÇA NA 1
 * ─────────────────────────────────────────────────────────────────────────────
 *  O layout e o conteúdo congelado das variáveis mudam o que o documento AFIRMA, e
 *  todo certificado já emitido tem o hash gravado no formato da versão 1. Recalcular
 *  com campos a mais reprovaria a assinatura de tudo o que existe — o mesmo problema
 *  que a FASE 30 resolveu com o payload versionado do sorteio (ADR-144).
 *
 *  Então a 1 continua verificável exatamente como nasceu, e a 2 vale para quem tem
 *  layout (`layoutSnapshot`). A versão é DERIVADA da presença do snapshot, e não
 *  gravada em coluna: com um campo a mais existiria o estado incoerente "versão 2 sem
 *  layout".
 */
export interface CanonicalCertificateV2 {
  version: 2;
  validationCode: string;
  tenantId: string;
  eventId: string;
  userId: string;
  activityId: string | null;
  kind: CertificateKind;
  recipientName: string;
  title: string;
  bodyText: string;
  workloadMinutes: number;
  issuedAt: string;
  /** Layout serializado de forma canônica — inclui a impressão da arte. */
  layout: string;
  /** Variáveis de conteúdo congeladas (ordem do catálogo). */
  content: string;
}

export function buildCanonicalPayloadV2(input: CanonicalCertificateV2): string {
  const ordered: CanonicalCertificateV2 = {
    version: input.version,
    validationCode: input.validationCode,
    tenantId: input.tenantId,
    eventId: input.eventId,
    userId: input.userId,
    activityId: input.activityId,
    kind: input.kind,
    recipientName: input.recipientName.trim(),
    title: input.title.trim(),
    bodyText: input.bodyText.trim(),
    workloadMinutes: input.workloadMinutes,
    issuedAt: input.issuedAt,
    layout: input.layout,
    content: input.content,
  };

  return JSON.stringify(ordered);
}

/** SHA-256 em hexadecimal do conteúdo canônico. */
export function hashCanonicalPayload(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Validação pública
// ───────────────────────────────────────────────────────────────────────────────
export type ValidationStatus = 'VALID' | 'REVOKED' | 'EXPIRED' | 'NOT_ISSUED' | 'NOT_FOUND';

export interface ValidationVerdict {
  status: ValidationStatus;
  message: string;
  /** O documento pode ser exibido/baixado? */
  isUsable: boolean;
}

/**
 * Avalia o estado de um certificado para quem está validando.
 *
 * `isUsable` é o que a página pública usa para decidir se mostra o documento. A
 * distinção entre "não existe" e "existe mas foi revogado" é importante: quem
 * recebeu um certificado revogado precisa entender que o documento é falso
 * AGORA, mesmo tendo sido emitido de fato — é o caso de fraude comprovada.
 */
export function evaluateValidation(input: {
  found: boolean;
  status: string | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  expiresAt: Date | null;
  now: Date;
}): ValidationVerdict {
  if (!input.found) {
    return {
      status: 'NOT_FOUND',
      message: 'Código não encontrado. Verifique se digitou corretamente ou consulte a instituição.',
      isUsable: false,
    };
  }

  if (input.revokedAt) {
    return {
      status: 'REVOKED',
      message: `Certificado REVOGADO em ${input.revokedAt.toLocaleDateString('pt-BR')}.${
        input.revokedReason ? ` Motivo: ${input.revokedReason}` : ''
      }`,
      isUsable: false,
    };
  }

  if (input.expiresAt && input.expiresAt.getTime() <= input.now.getTime()) {
    return {
      status: 'EXPIRED',
      message: `Certificado expirado em ${input.expiresAt.toLocaleDateString('pt-BR')}.`,
      isUsable: false,
    };
  }

  if (input.status !== 'ISSUED') {
    return {
      status: 'NOT_ISSUED',
      message:
        input.status === 'QUEUED' || input.status === 'GENERATING'
          ? 'Certificado em processamento. Tente novamente em alguns instantes.'
          : 'Certificado não foi emitido.',
      isUsable: false,
    };
  }

  return { status: 'VALID', message: 'Certificado autêntico e válido.', isUsable: true };
}
