/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — A POLÍTICA DE PRESENÇA DO EVENTO (FASE 86 · fatia 5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A REGRA DOS 75 % VIROU DADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até esta fatia, `MIN_ATTENDANCE_RATIO` e `MIN_ATTENDANCE_MINUTES` eram
 *  constantes do domínio: TODO evento emitia (ou recusava) pela mesma régua. O
 *  organizador não tinha como dizer que o simpósio de dois dias exige presença
 *  integral e que a mostra de posters exige metade — e a única saída era abrir um
 *  chamado. A política é CONFIGURAÇÃO DE NEGÓCIO do evento, e o lugar dela é
 *  `Event.settings`, como a política de inscrição (FASE 12), o formulário do
 *  organizador (FASE 70) e a chave da API (FASE 72).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O LEITOR É TOLERANTE, E A TOLERÂNCIA TEM DIREÇÃO (fail-safe)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `settings` é campo livre: uma configuração torta não pode derrubar a emissão
 *  com 500 nem ser aceita "mais ou menos". Cada campo inválido cai no PADRÃO e
 *  alimenta `problems` — a tela mostra a lista, e o serviço que grava usa este
 *  MESMO leitor para recusar antes de persistir. É a mesma régua do
 *  `readEventApiConfig`: valor ausente é o caso normal (evento que nunca
 *  configurou), valor inválido é um problema DECLARADO.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE É RECUSADO, E POR QUÊ (cada recusa responde a um dano real)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • `minRatio` fora de [0,5; 1,0] — **0 é proibido de propósito**: com zero todo
 *    mundo com uma presença de zero minuto "cumpre" a carga, e o certificado passa
 *    a atestar a participação de quem não participou. O teto 1,0 é o máximo que
 *    ainda descreve "a carga inteira"; acima disso a atividade nunca seria
 *    cumprida, e o evento prometeria um documento que ninguém pode receber.
 *
 *  • `minMinutes` fora de [1; 240] — **0 é proibido pelo mesmo motivo**: sem piso,
 *    uma atividade sem carga declarada passaria a valer por qualquer minutagem.
 *    O teto de 240 min (4 h) cobre a atividade acadêmica longa sem transformar o
 *    piso em uma segunda carga horária.
 *
 *  • `requireCheckOut: false` — **não é permitido nesta versão**. O tempo medido
 *    nasce do par check-in/check-out (ADR-149): sem a saída, não há permanência, e
 *    "não exigir check-out" seria aceitar comparecimento presumido como presença.
 *    O campo existe para a evolução (um evento que meça por outro meio), e aqui
 *    ele é FORÇADO para `true` — a política não pode enfraquecer a prova.
 *
 *  • `aggregateBy` diferente de `ACTIVITY` — a agregação por LINHA de
 *    `attendances` era a dívida **E92** (duas visitas de 30 min numa atividade de
 *    60 não somavam 60). A FASE 86 quitou a dívida agregando por pessoa ×
 *    atividade; aceitar outro valor reabriria a porta que acabou de ser fechada.
 *    O campo é o único valor aceito hoje e permanece na política como contrato
 *    explícito do que o número significa.
 *
 *  O módulo é PURO: não importa Prisma, Next, relógio nem `node:crypto`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** A única forma de agregação aceita nesta versão (ver o cabeçalho). */
export const CERTIFICATE_POLICY_AGGREGATION = 'ACTIVITY' as const;

export type CertificatePolicyAggregation = typeof CERTIFICATE_POLICY_AGGREGATION;

/** Limites das duas grandezas — a tela e o validador leem daqui. */
export const CERTIFICATE_POLICY_LIMITS = {
  minRatio: { min: 0.5, max: 1 },
  minMinutes: { min: 1, max: 240 },
} as const;

/**
 * A política aplicada a um evento.
 *
 * Os quatro campos são CONGELADOS no `workloadBreakdown` do certificado no momento
 * da emissão — é o que permite responder "por que este documento tem 40 h" mesmo
 * depois de o organizador mudar a regra. O `workloadBreakdown` NÃO entra no
 * conteúdo canônico assinado (ver `certificate-rules.ts`), então congelá-lo não
 * muda o hash de documento nenhum.
 */
export interface CertificatePolicy {
  /** Fração mínima da carga da atividade, em [0,5; 1,0]. */
  minRatio: number;
  /** Piso em minutos, em [1; 240]. */
  minMinutes: number;
  /**
   * O check-out é obrigatório nesta versão. O campo existe para evolução, mas o
   * leitor RECUSA `false` e devolve `true` (ver o cabeçalho).
   */
  requireCheckOut: boolean;
  /** Como a presença é somada — só `ACTIVITY` (dívida E92). */
  aggregateBy: CertificatePolicyAggregation;
}

/**
 * A política de um evento que nunca configurou nada — e o default EXATO do que o
 * sistema fazia antes desta fatia.
 *
 * Ela é devolvida por valor a cada chamada (e não como constante congelada
 * exportada) para que nenhum chamador possa mutar o default do processo inteiro.
 */
export function policyDefaults(): CertificatePolicy {
  return {
    minRatio: 0.75,
    minMinutes: 30,
    requireCheckOut: true,
    aggregateBy: CERTIFICATE_POLICY_AGGREGATION,
  };
}

export interface ReadCertificatePolicyResult {
  /** Sempre uma política válida: o default entra no lugar de cada campo recusado. */
  policy: CertificatePolicy;
  /** Por que a configuração gravada foi recusada. Vazio = configuração válida. */
  problems: string[];
}

/**
 * Números nas mensagens em pt-BR.
 *
 * As frases vão para a TELA, e "0.5 a 1" ao lado de "0,5" na mesma lista faria a
 * pessoa ler duas grandezas diferentes. O formatador é único no módulo para que a
 * faixa e o valor recusado usem a MESMA régua.
 */
const POLICY_NUMBER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function formatNumber(value: number): string {
  return POLICY_NUMBER.format(value);
}

/** `settings` é JSON livre: qualquer coisa que não seja objeto não tem política. */
function settingsObject(settings: unknown): Record<string, unknown> | null {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return null;

  return settings as Record<string, unknown>;
}

/** Rótulo do valor recusado, sem lançar com objeto/ciclo (o JSON vem do banco). */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return String(value);
  if (value === null) return 'null';

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function readMinRatio(raw: unknown, fallback: number, problems: string[]): number {
  if (raw === undefined) return fallback;

  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    problems.push(
      `settings.certificatePolicy.minRatio deveria ser um número entre ${formatNumber(CERTIFICATE_POLICY_LIMITS.minRatio.min)} e ${formatNumber(CERTIFICATE_POLICY_LIMITS.minRatio.max)}; o padrão ${formatNumber(fallback)} foi aplicado.`,
    );
    return fallback;
  }

  if (raw < CERTIFICATE_POLICY_LIMITS.minRatio.min || raw > CERTIFICATE_POLICY_LIMITS.minRatio.max) {
    problems.push(
      `settings.certificatePolicy.minRatio = ${describeValue(raw)} está fora da faixa permitida (${formatNumber(CERTIFICATE_POLICY_LIMITS.minRatio.min)} a ${formatNumber(CERTIFICATE_POLICY_LIMITS.minRatio.max)}); o padrão ${formatNumber(fallback)} foi aplicado.`,
    );
    return fallback;
  }

  return raw;
}

function readMinMinutes(raw: unknown, fallback: number, problems: string[]): number {
  if (raw === undefined) return fallback;

  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    problems.push(
      `settings.certificatePolicy.minMinutes deveria ser um número inteiro entre ${formatNumber(CERTIFICATE_POLICY_LIMITS.minMinutes.min)} e ${formatNumber(CERTIFICATE_POLICY_LIMITS.minMinutes.max)}; o padrão ${formatNumber(fallback)} foi aplicado.`,
    );
    return fallback;
  }

  if (raw < CERTIFICATE_POLICY_LIMITS.minMinutes.min || raw > CERTIFICATE_POLICY_LIMITS.minMinutes.max) {
    problems.push(
      `settings.certificatePolicy.minMinutes = ${describeValue(raw)} está fora da faixa permitida (${formatNumber(CERTIFICATE_POLICY_LIMITS.minMinutes.min)} a ${formatNumber(CERTIFICATE_POLICY_LIMITS.minMinutes.max)}); o padrão ${formatNumber(fallback)} foi aplicado.`,
    );
    return fallback;
  }

  return raw;
}

function readRequireCheckOut(raw: unknown, problems: string[]): boolean {
  if (raw === undefined) return true;

  if (raw === true) return true;

  if (raw === false) {
    problems.push(
      'settings.certificatePolicy.requireCheckOut = false não é permitido nesta versão: o check-out é o que prova a saída e a política não pode desligá-lo; o padrão true foi aplicado.',
    );
    return true;
  }

  problems.push(
    `settings.certificatePolicy.requireCheckOut deveria ser um booleano; ${describeValue(raw)} foi recusado e o padrão true foi aplicado.`,
  );
  return true;
}

function readAggregation(raw: unknown, problems: string[]): CertificatePolicyAggregation {
  if (raw === undefined) return CERTIFICATE_POLICY_AGGREGATION;

  if (raw === CERTIFICATE_POLICY_AGGREGATION) return CERTIFICATE_POLICY_AGGREGATION;

  problems.push(
    `settings.certificatePolicy.aggregateBy = ${describeValue(raw)} não é aceito nesta versão: a agregação por LINHA era a dívida E92; o padrão "${CERTIFICATE_POLICY_AGGREGATION}" foi aplicado.`,
  );
  return CERTIFICATE_POLICY_AGGREGATION;
}

/**
 * Lê `settings.certificatePolicy` com tolerância e devolve o motivo de cada recusa.
 *
 * Casos normais:
 *   • `settings` ausente/nulo → padrão, sem problema (evento nunca configurado);
 *   • `certificatePolicy` ausente → padrão, sem problema;
 *   • campo ausente → só aquele campo cai no padrão, sem problema (configuração
 *     parcial é válida: quem gravou só o percentual não perde o piso de 30 min).
 *
 * Configuração torta (texto, lista, número fora da faixa, `requireCheckOut: false`,
 * agregação desconhecida) → o campo recusado cai no padrão e o motivo entra em
 * `problems`. A leitura NUNCA lança: a emissão não pode depender de o JSON estar
 * bonito, e a tela precisa poder dizer o que está errado.
 */
export function readCertificatePolicy(settings: unknown): ReadCertificatePolicyResult {
  const policy = policyDefaults();

  // Ausente é o caso normal — o evento que nunca escolheu política. Não é erro.
  if (settings === undefined || settings === null) return { policy, problems: [] };

  const root = settingsObject(settings);
  if (!root) {
    return {
      policy,
      problems: ['settings do evento deveria ser um objeto; a política padrão foi aplicada.'],
    };
  }

  const raw = root.certificatePolicy;

  if (raw === undefined || raw === null) return { policy, problems: [] };

  const record = settingsObject(raw);
  if (!record) {
    return {
      policy,
      problems: ['settings.certificatePolicy deveria ser um objeto; a política padrão foi aplicada.'],
    };
  }

  const problems: string[] = [];

  policy.minRatio = readMinRatio(record.minRatio, policy.minRatio, problems);
  policy.minMinutes = readMinMinutes(record.minMinutes, policy.minMinutes, problems);
  policy.requireCheckOut = readRequireCheckOut(record.requireCheckOut, problems);
  policy.aggregateBy = readAggregation(record.aggregateBy, problems);

  return { policy, problems };
}

/**
 * O percentual que a política representa — a MESMA conta que o detalhamento usa.
 *
 * Existe como função porque a mensagem de recusa e a tela precisam do mesmo número:
 * duas formatações de `minRatio` dariam "75 %" numa e "0,75" na outra, e a pessoa
 * leria a regra em duas unidades diferentes na mesma página.
 */
export function policyPercent(minRatio: number): number {
  return Math.round(minRatio * 100);
}
