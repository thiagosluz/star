/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Motor de sorteios
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UM SORTEIO É UM ATO PÚBLICO, NÃO UM BOTÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem participa de um sorteio presencial precisa poder confiar no resultado. Isso
 *  impõe três propriedades ao código:
 *
 *    1. ELEGIBILIDADE VERIFICÁVEL — só entra quem tem presença REAL registrada
 *       (`attendances`), com o piso de minutos cumprido. Nada de "inscrito que não
 *       apareceu" concorrendo com quem apareceu.
 *    2. ALEATORIEDADE HONESTA — amostragem sem reposição com fonte criptográfica.
 *       `Math.random` é previsível e permite antecipar o resultado.
 *    3. RESULTADO REPRODUTÍVEL PARA AUDITORIA — o hash cobre as REGRAS aplicadas e
 *       os vencedores na ordem sorteada. Depois de apurado, qualquer pessoa pode
 *       reconferir que o registro não foi alterado.
 *
 *  As funções deste arquivo são PURAS: recebem as presenças já lidas do banco e
 *  devolvem a decisão. É o que permite testar filtro de data, piso de minutos,
 *  deduplicação e exclusão de ganhadores anteriores sem tocar em infraestrutura.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash, createHmac } from 'node:crypto';

// ───────────────────────────────────────────────────────────────────────────────
//  Tipos
// ───────────────────────────────────────────────────────────────────────────────
export type RaffleScope = 'EVENT' | 'DAY' | 'ACTIVITY';

export const RAFFLE_SCOPES: readonly RaffleScope[] = ['EVENT', 'DAY', 'ACTIVITY'];

export const RAFFLE_SCOPE_LABELS: Readonly<Record<RaffleScope, string>> = {
  EVENT: 'Todo o evento',
  DAY: 'Um dia do evento',
  ACTIVITY: 'Uma atividade',
};

/** Presença como o domínio a enxerga (já lida do banco). */
export interface AttendanceSample {
  attendanceId: string;
  userId: string;
  userName: string;
  activityId: string | null;
  activityTitle: string | null;
  /** Quando a atividade começou (referência para o escopo DAY). */
  activityStartsAt: Date | null;
  /** Quando a pessoa efetivamente entrou. */
  checkedInAt: Date;
  /** Minutos medidos entre entrada e saída (0 quando não houve saída). */
  minutesAttended: number;
  status: string;
}

/**
 * As peças PURAS da seleção (participante, sorteio uniforme e ponderado) vivem em
 * `draw-selection.ts` desde a FASE 29, porque a auditoria pública as roda também no
 * NAVEGADOR — e este arquivo importa `node:crypto`, que não atravessa para o
 * cliente. O reexport mantém o caminho histórico (`raffle-rules`) válido para
 * quem já importava daqui.
 */
import type { EligibleParticipant } from '@/domain/raffles/draw-selection';

export {
  participantWeight,
  reproduceFromPool,
  selectWeightedWinners,
  selectWinners,
} from '@/domain/raffles/draw-selection';

export type { EligibleParticipant, RafflePoolEntry } from '@/domain/raffles/draw-selection';

export interface RaffleConfig {
  scope: RaffleScope;
  /** Data de referência (obrigatória no escopo DAY). */
  referenceDate: Date | null;
  /** Atividade alvo (obrigatória no escopo ACTIVITY). */
  activityId: string | null;
  /** Piso de minutos assistidos. `0` = basta ter presença registrada. */
  minAttendanceMinutes: number;
  winnersCount: number;
  allowPriorEventWinners: boolean;
  /**
   * Quantos SUPLENTES sortear (FASE 16, item G1). `0` = nenhum.
   *
   * O suplente é sorteado na mesma apuração, logo depois dos titulares, e ocupa uma
   * posição própria — assim ninguém precisa "sortear de novo" quando um vencedor não
   * aparece para retirar o prêmio, e a ordem de reserva fica registrada.
   */
  alternatesCount?: number;
  /**
   * Sortear proporcionalmente aos MINUTOS assistidos (FASE 16, item G3).
   *
   * Desligado, todo elegível tem a mesma chance. Ligado, quem ficou mais tempo tem
   * chance proporcional — e o peso é o próprio tempo, não uma nota subjetiva.
   */
  weightByMinutes?: boolean;
}

/** Papel da posição sorteada: titular do prêmio ou reserva. */
export type RaffleWinnerKind = 'WINNER' | 'ALTERNATE';

export const RAFFLE_WINNER_KINDS: readonly RaffleWinnerKind[] = ['WINNER', 'ALTERNATE'];

export const RAFFLE_WINNER_KIND_LABELS: Readonly<Record<RaffleWinnerKind, string>> = {
  WINNER: 'Titular',
  ALTERNATE: 'Suplente',
};

export interface EligibilityInput {
  attendances: readonly AttendanceSample[];
  config: RaffleConfig;
  /** Fuso da instituição: o "dia" do escopo DAY é o dia LOCAL. */
  timeZone: string;
  /** Quem já ganhou sorteio anterior NESTE evento (quando a flag está desligada). */
  priorWinnerIds?: readonly string[];
  /**
   * Quem já ganhou uma RODADA ANTERIOR deste mesmo sorteio (FASE 30).
   *
   * Este filtro NÃO depende de flag e não é o mesmo que `priorWinnerIds`: quem já
   * saiu na rodada 1 não concorre na 2 — é o que "cada pessoa ganha uma vez" quer
   * dizer num sorteio com vários momentos. O banco também garante isso (índice
   * único por sorteio), mas a lista do telão precisa da MESMA regra: um nome que
   * aparece na rolagem e não podia concorrer é uma promessa falsa.
   */
  sameRaffleWinnerIds?: readonly string[];
}

export interface EligibilityResult {
  eligible: EligibleParticipant[];
  /** Diagnóstico por participante descartado — a tela mostra o porquê. */
  rejected: { userId: string; userName: string; reason: string }[];
  inspectedAttendances: number;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Data no fuso da instituição
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Chave do dia (`AAAA-MM-DD`) no fuso da instituição.
 *
 * O dia do sorteio não pode ser UTC: uma atividade que termina às 23h em Salvador
 * (UTC−3) já é o dia seguinte em UTC, e o sorteio daquela noite deixaria de fora
 * exatamente quem estava lá.
 */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Data de referência do escopo DAY como chave (`AAAA-MM-DD`). */
export function referenceDayKey(referenceDate: Date, timeZone: string): string {
  return dayKey(referenceDate, timeZone);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Validação da configuração
// ───────────────────────────────────────────────────────────────────────────────
export interface ConfigValidation {
  valid: boolean;
  errors: string[];
}

/** Minutos mínimos aceitos (teto defensivo: 24h de evento). */
export const MAX_MINUTES = 24 * 60;
/** Teto de vencedores por sorteio (evita sorteio que "premia todo mundo"). */
export const MAX_WINNERS = 500;
/** Teto de suplentes por sorteio (mesma ordem de grandeza dos titulares). */
export const MAX_ALTERNATES = 500;

/**
 * Valida a configuração de um sorteio.
 *
 * Devolve TODOS os erros, e não o primeiro: o organizador corrige o formulário de
 * uma vez em vez de descobrir um problema por tentativa.
 */
export function validateRaffleConfig(config: {
  scope: string;
  referenceDate?: Date | null;
  activityId?: string | null;
  minAttendanceMinutes?: number;
  winnersCount: number;
  title?: string | null;
  alternatesCount?: number;
}): ConfigValidation {
  const errors: string[] = [];

  if (!(RAFFLE_SCOPES as readonly string[]).includes(config.scope)) {
    errors.push('Escopo inválido: use EVENT, DAY ou ACTIVITY.');
  }

  if (config.scope === 'DAY' && !config.referenceDate) {
    errors.push('O sorteio por dia exige a data de referência.');
  }

  if (config.scope === 'ACTIVITY' && !config.activityId) {
    errors.push('O sorteio por atividade exige a atividade alvo.');
  }

  if (!Number.isInteger(config.winnersCount) || config.winnersCount < 1) {
    errors.push('O número de vencedores precisa ser ao menos 1.');
  } else if (config.winnersCount > MAX_WINNERS) {
    errors.push(`O número de vencedores não pode passar de ${MAX_WINNERS}.`);
  }

  const alternates = config.alternatesCount ?? 0;
  if (!Number.isInteger(alternates) || alternates < 0) {
    errors.push('O número de suplentes não pode ser negativo.');
  } else if (alternates > MAX_ALTERNATES) {
    errors.push(`O número de suplentes não pode passar de ${MAX_ALTERNATES}.`);
  }

  const minutes = config.minAttendanceMinutes ?? 0;
  if (!Number.isInteger(minutes) || minutes < 0) {
    errors.push('O piso de minutos não pode ser negativo.');
  } else if (minutes > MAX_MINUTES) {
    errors.push(`O piso de minutos não pode passar de ${MAX_MINUTES}.`);
  }

  if (config.title !== undefined && config.title !== null && config.title.trim().length < 3) {
    errors.push('O título do sorteio precisa ter ao menos 3 caracteres.');
  }

  return { valid: errors.length === 0, errors };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Elegibilidade
// ───────────────────────────────────────────────────────────────────────────────
/** A presença é válida como comprovação? (`ABSENT` não comprova nada.) */
export function isPresenceValid(status: string): boolean {
  return status === 'PRESENT' || status === 'PARTIAL';
}

/**
 * A presença entra no universo deste sorteio?
 *
 * Cada escopo tem um recorte próprio, e o recorte é a REGRA do sorteio: sortear
 * "todo o evento" quando se queria apenas quem foi ao minicurso é um erro que não
 * pode depender de interpretação.
 */
export function matchesScope(
  sample: AttendanceSample,
  config: RaffleConfig,
  timeZone: string,
): { matches: boolean; reason: string | null } {
  if (!isPresenceValid(sample.status)) {
    return { matches: false, reason: 'Presença marcada como ausente.' };
  }

  if (config.scope === 'ACTIVITY') {
    if (!config.activityId) {
      return { matches: false, reason: 'Atividade alvo não definida.' };
    }

    if (sample.activityId !== config.activityId) {
      return { matches: false, reason: 'Presença em outra atividade.' };
    }

    return { matches: true, reason: null };
  }

  if (config.scope === 'DAY') {
    if (!config.referenceDate) {
      return { matches: false, reason: 'Data de referência não definida.' };
    }

    /**
     * O dia é o da ATIVIDADE (é o que o organizador escolhe: "o sorteio de
     * sábado"), com a presença como alternativa quando a atividade não está
     * vinculada (credenciamento no evento sem atividade específica).
     */
    const reference = sample.activityStartsAt ?? sample.checkedInAt;
    const key = dayKey(reference, timeZone);
    const target = referenceDayKey(config.referenceDate, timeZone);

    if (key !== target) {
      return {
        matches: false,
        reason: `Presença no dia ${key}, e o sorteio é do dia ${target}.`,
      };
    }

    return { matches: true, reason: null };
  }

  // EVENT: qualquer presença válida no evento já é recorte suficiente.
  return { matches: true, reason: null };
}

/**
 * Quem pode ser sorteado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A ORDEM DAS CHECAGENS IMPORTA PARA A EXPLICAÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Cada participante descartado recebe UM motivo. Se o piso de minutos fosse
 *  avaliado antes do recorte de escopo, alguém que nem estava no dia sorteado
 *  apareceria como "não atingiu o tempo mínimo" — uma explicação errada sobre um
 *  fato correto.
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const { config, timeZone } = input;
  const priorWinners = new Set(input.priorWinnerIds ?? []);
  const sameRaffleWinners = new Set(input.sameRaffleWinnerIds ?? []);

  const byUser = new Map<string, EligibleParticipant>();
  const rejected = new Map<string, string>();
  let inspectedAttendances = 0;

  for (const sample of input.attendances) {
    inspectedAttendances += 1;

    const scope = matchesScope(sample, config, timeZone);
    if (!scope.matches) {
      // Só registra o motivo se o participante ainda não tem um motivo registrado.
      if (!rejected.has(sample.userId) && !byUser.has(sample.userId)) {
        rejected.set(sample.userId, scope.reason ?? 'Fora do recorte do sorteio.');
      }
      continue;
    }

    /**
     * A exclusão de ganhadores anteriores só vale quando a flag está DESLIGADA.
     *
     * A primeira versão aplicava o filtro sempre — a flag existia no modelo, era
     * validada e gravada, e não era consultada em lugar nenhum. O teste "permite
     * ganhadores anteriores quando a flag está ligada" pegou exatamente isso:
     * configuração que não muda comportamento é pior que configuração ausente,
     * porque o organizador acredita ter escolhido.
     */
    if (!config.allowPriorEventWinners && priorWinners.has(sample.userId)) {
      rejected.set(sample.userId, 'Já foi sorteado neste evento.');
      continue;
    }

    /**
     * ───────────────────────────────────────────────────────────────────────────
     *  QUEM JÁ GANHOU NESTE SORTEIO NÃO VOLTA (FASE 30)
     * ───────────────────────────────────────────────────────────────────────────
     *  O filtro vem ANTES de somar minutos: a pessoa sai da rodada 2 pelo que fez na
     *  rodada 1, e o motivo dito na tela é esse — não "pouco tempo de presença", que
     *  seria uma explicação errada sobre um fato correto.
     */
    if (sameRaffleWinners.has(sample.userId)) {
      rejected.set(sample.userId, 'Já ganhou uma rodada anterior deste sorteio.');
      continue;
    }

    const current = byUser.get(sample.userId) ?? {
      userId: sample.userId,
      userName: sample.userName,
      minutes: 0,
      attendanceIds: [],
      referenceAttendanceId: null,
    };

    current.minutes += Math.max(0, Math.round(sample.minutesAttended));
    current.attendanceIds.push(sample.attendanceId);
    byUser.set(sample.userId, current);

    // A presença de referência é a mais longa (evidência mais forte).
    const best = current.referenceAttendanceId
      ? input.attendances.find((entry) => entry.attendanceId === current.referenceAttendanceId)
      : null;

    if (!best || sample.minutesAttended > best.minutesAttended) {
      current.referenceAttendanceId = sample.attendanceId;
    }
  }

  const eligible: EligibleParticipant[] = [];

  for (const participant of byUser.values()) {
    /**
     * ─────────────────────────────────────────────────────────────────────────
     *  O PISO DE MINUTOS, E O QUE ELE SIGNIFICA QUANDO É ZERO
     * ─────────────────────────────────────────────────────────────────────────
     *  `minAttendanceMinutes = 0` significa "basta ter presença registrada": quem
     *  foi ao evento e não teve a saída registrada tem 0 minuto medido, mas
     *  COMPARECEU — e excluí-lo seria punir o participante por uma falha de
     *  operação do credenciamento.
     *
     *  Com piso > 0, a exigência passa a ser a carga efetivamente cumprida.
     */
    if (config.minAttendanceMinutes > 0 && participant.minutes < config.minAttendanceMinutes) {
      rejected.set(
        participant.userId,
        `Cumpriu ${participant.minutes} min, abaixo do piso de ${config.minAttendanceMinutes} min.`,
      );
      continue;
    }

    eligible.push(participant);
  }

  // Ordena por nome para que a listagem na tela seja estável e conferível.
  eligible.sort((a, b) => a.userName.localeCompare(b.userName, 'pt-BR'));

  return {
    eligible,
    rejected: [...rejected.entries()].map(([userId, reason]) => ({
      userId,
      userName: input.attendances.find((sample) => sample.userId === userId)?.userName ?? 'Participante',
      reason,
    })),
    inspectedAttendances,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Aleatoriedade semeada (item G4 — commit-reveal)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Gerador determinístico a partir de uma semente pública revelada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O QUE O COMMIT-REVEAL RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O hash do resultado prova que o registro não foi ALTERADO depois. Não prova que
 *  o sorteio aconteceu depois do fechamento do credenciamento — quem tivesse acesso
 *  ao banco poderia apurar, ver quem ganhou e "refazer" até gostar.
 *
 *  Com compromisso: a instituição publica `sha256(semente)` na CRIAÇÃO do sorteio
 *  (antes de haver elegíveis), a semente fica selada e só é revelada na apuração.
 *  Qualquer pessoa confere duas coisas — o hash da semente revelada é o compromisso
 *  publicado, e o resultado se reproduz rodando esta função com a mesma semente.
 *
 *  Derivação: `HMAC-SHA256(semente, contador)` em 4 bytes. Não é um CSPRNG de
 *  propósito geral, mas é determinístico, uniforme o bastante para sortear posições
 *  e — o que importa aqui — REPRODUZÍVEL por quem só tem a semente.
 */
export function createSeededRandomInt(seed: string): (max: number) => number {
  let counter = 0;

  return (max: number): number => {
    if (max <= 1) return 0;

    const block = createHmac('sha256', seed).update(`draw:${counter}`).digest();
    counter += 1;

    // 4 bytes → inteiro sem sinal; o módulo introduz um viés desprezível para os
    // tamanhos de pool reais (dezenas a milhares de participantes).
    const value = block.readUInt32BE(0);

    return value % max;
  };
}

/** Compromisso público da semente: `sha256(semente)`. */
export function seedCommitment(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

/** A semente revelada corresponde ao compromisso publicado antes da apuração? */
export function verifySeed(seed: string, commitment: string): boolean {
  return seedCommitment(seed) === commitment;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Exibição pública do nome (item G5)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Mascara o nome para exibição pública.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE MASCARAR POR PADRÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ganhar um sorteio é um fato da pessoa, e publicar "Fulano de Tal ganhou o
 *  notebook" na internet é exposição que ninguém consentiu ao se credenciar. O
 *  padrão é `Ana Souza` → `Ana S.`: quem estava no palco reconhece, quem só navega
 *  não identifica. Quem optou por ter perfil público (`User.isPublicProfile`) tem o
 *  nome completo publicado — consentimento explícito e verificável.
 *
 *  Nome de uma palavra só é preservado (`Ana` → `Ana`): mascarar viraria `A.`, que
 *  não identifica nem para quem estava lá.
 */
export function maskName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length <= 1) return parts[0] ?? '';

  const [first, ...rest] = parts;
  const initials = rest
    .filter((part) => part.length > 2)
    .map((part) => `${part[0]!.toUpperCase()}.`)
    .join(' ');

  return initials ? `${first} ${initials}` : first!;
}

/** Nome para exibição pública, respeitando o consentimento de perfil público. */
export function publicWinnerName(input: { name: string; publicProfile: boolean }): string {
  return input.publicProfile ? input.name : maskName(input.name);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Paginação do histórico (item G6)
// ───────────────────────────────────────────────────────────────────────────────
export const RAFFLE_PAGE_SIZE = 10;
export const MAX_RAFFLE_PAGE_SIZE = 50;

export interface RafflePage {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Índice do primeiro item da página (`skip` do Prisma). */
  skip: number;
}

/**
 * Resolve a página pedida contra o total existente.
 *
 * O histórico tinha um teto fixo de 100 e nada além disso aparecia: evento com mais
 * sorteios do que isso simplesmente perdia o começo da lista, sem aviso. Aqui a
 * página é LIMITADA ao intervalo válido — pedir `?pagina=999` num evento com 3
 * páginas devolve a última, em vez de uma tela vazia que parece defeito.
 *
 * A regra de recorte é a mesma do diretório público (FASE 9); quando a paginação
 * transversal entrar no levantamento (item E2), as duas passam a usar uma função só.
 */
export function resolveRafflePage(input: { page?: number; pageSize?: number; total: number }): RafflePage {
  const pageSize = Math.min(
    Math.max(1, Math.floor(input.pageSize ?? RAFFLE_PAGE_SIZE)),
    MAX_RAFFLE_PAGE_SIZE,
  );
  const total = Math.max(0, Math.floor(input.total));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(input.page ?? 1)), totalPages);

  return { page, pageSize, total, totalPages, skip: (page - 1) * pageSize };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Hash do resultado
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Versão do conteúdo canônico do resultado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VERSÃO SUBIU (FASE 16)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A suplência (G1) e o peso por minutos (G3) acrescentaram campos AO CONTEÚDO
 *  ASSINADO. Se eles entrassem na `version 1`, o hash de todo sorteio já apurado
 *  deixaria de conferir — e a trilha de auditoria de apurações antigas viraria
 *  "resultado adulterado" da noite para o dia.
 *
 *  Por isso o payload é versionado: quem apurou antes continua verificável pela
 *  versão 1, quem apura agora usa a 2, e `verifyResult` reconstrói o payload na
 *  versão CERTA a partir do que está gravado no sorteio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VERSÃO SUBIU DE NOVO (FASE 29, versão 3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A auditoria conferível precisava amarrar a ENTRADA do sorteio ao resultado: sem
 *  isso, trocar a lista de elegíveis depois da apuração deixaria o hash do resultado
 *  intacto, e a página pública prometia uma reprodução que ninguém podia conferir.
 *  A versão 3 acrescenta `poolHash` (SHA-256 da lista publicada) e `poolCount` ao
 *  conteúdo assinado — mudar a lista, a ordem ou os minutos de alguém passa a mudar
 *  o hash do resultado. A 2 e a 1 seguem verificáveis, cada uma com o seu formato.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  E DE NOVO (FASE 30, versão 4): o documento passou a ser POR RODADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada apuração é um momento próprio, com o seu compromisso e a sua semente — e o
 *  documento assinado passou a declarar QUAL momento ele descreve (`roundNumber`).
 *  Sem isso, dois documentos de rodadas diferentes seriam indistinguíveis, e trocar
 *  um pelo outro (o resultado da rodada 2 no lugar da 1) conferiria perfeitamente.
 *
 *  O PRÊMIO NÃO ENTRA AQUI de propósito: ele é anúncio, e corrigir uma vírgula no
 *  texto do prêmio não pode invalidar um resultado já publicado (ADR-145). O que é
 *  assinado é o que DECIDE o sorteio: semente, lista, minutos e posições.
 */
export const RESULT_PAYLOAD_VERSION = 4;

export interface RaffleResultWinner {
  position: number;
  userId: string;
  minutes: number;
  /** Titular ou suplente. Ausente na versão 1 do payload (só havia titulares). */
  kind?: RaffleWinnerKind;
}

export interface RaffleResultPayload {
  validationVersion: 1 | 2 | 3 | 4;
  raffleId: string;
  tenantId: string;
  eventId: string;
  /** Presente a partir da versão 4: qual MOMENTO este documento descreve. */
  roundNumber?: number;
  scope: RaffleScope;
  activityId: string | null;
  referenceDate: string | null;
  minAttendanceMinutes: number;
  winnersCount: number;
  allowPriorEventWinners: boolean;
  /** Presente a partir da versão 2. */
  alternatesCount?: number;
  /** Presente a partir da versão 2. */
  weightByMinutes?: boolean;
  /** Presente a partir da versão 3: SHA-256 da lista publicada (a entrada do sorteio). */
  poolHash?: string | null;
  /** Presente a partir da versão 3: quantos elegíveis a lista tinha. */
  poolCount?: number;
  eligibleCount: number;
  drawnAt: string;
  winners: RaffleResultWinner[];
}

/**
 * Conteúdo canônico do resultado — ordem de chaves FIXA.
 *
 * `JSON.stringify` preserva a ordem de inserção, mas depender disso em qualquer
 * lugar seria frágil: a ordem aqui é parte do contrato, e mudá-la mudaria o hash
 * de todos os sorteios já apurados.
 *
 * Na versão 2, cada vencedor também declara `kind` (titular ou suplente): promover
 * um suplente a titular depois mudaria o hash, que é exatamente o que a auditoria
 * precisa impedir.
 *
 * Na versão 3, `poolHash` e `poolCount` entram ANTES dos vencedores: a lista é a
 * entrada do sorteio, e o documento assinado passa a dizer com que entrada o
 * resultado foi produzido — é o que permite a quem audita refazer a conta.
 */
export function buildResultPayload(input: RaffleResultPayload): string {
  const ordered: RaffleResultPayload =
    input.validationVersion === 4
      ? {
          validationVersion: 4,
          raffleId: input.raffleId,
          tenantId: input.tenantId,
          eventId: input.eventId,
          roundNumber: input.roundNumber ?? 1,
          scope: input.scope,
          activityId: input.activityId,
          referenceDate: input.referenceDate,
          minAttendanceMinutes: input.minAttendanceMinutes,
          winnersCount: input.winnersCount,
          allowPriorEventWinners: input.allowPriorEventWinners,
          alternatesCount: input.alternatesCount ?? 0,
          weightByMinutes: input.weightByMinutes ?? false,
          poolHash: input.poolHash ?? null,
          poolCount: input.poolCount ?? 0,
          eligibleCount: input.eligibleCount,
          drawnAt: input.drawnAt,
          winners: input.winners.map((winner) => ({
            position: winner.position,
            userId: winner.userId,
            minutes: winner.minutes,
            kind: winner.kind ?? 'WINNER',
          })),
        }
      : input.validationVersion === 3
        ? {
            validationVersion: 3,
            raffleId: input.raffleId,
            tenantId: input.tenantId,
            eventId: input.eventId,
            scope: input.scope,
            activityId: input.activityId,
            referenceDate: input.referenceDate,
            minAttendanceMinutes: input.minAttendanceMinutes,
            winnersCount: input.winnersCount,
            allowPriorEventWinners: input.allowPriorEventWinners,
            alternatesCount: input.alternatesCount ?? 0,
            weightByMinutes: input.weightByMinutes ?? false,
            poolHash: input.poolHash ?? null,
            poolCount: input.poolCount ?? 0,
            eligibleCount: input.eligibleCount,
            drawnAt: input.drawnAt,
            winners: input.winners.map((winner) => ({
              position: winner.position,
              userId: winner.userId,
              minutes: winner.minutes,
              kind: winner.kind ?? 'WINNER',
            })),
          }
        : input.validationVersion === 2
          ? {
              validationVersion: 2,
              raffleId: input.raffleId,
              tenantId: input.tenantId,
              eventId: input.eventId,
              scope: input.scope,
              activityId: input.activityId,
              referenceDate: input.referenceDate,
              minAttendanceMinutes: input.minAttendanceMinutes,
              winnersCount: input.winnersCount,
              allowPriorEventWinners: input.allowPriorEventWinners,
              alternatesCount: input.alternatesCount ?? 0,
              weightByMinutes: input.weightByMinutes ?? false,
              eligibleCount: input.eligibleCount,
              drawnAt: input.drawnAt,
              winners: input.winners.map((winner) => ({
                position: winner.position,
                userId: winner.userId,
                minutes: winner.minutes,
                kind: winner.kind ?? 'WINNER',
              })),
            }
          : {
              validationVersion: 1,
              raffleId: input.raffleId,
              tenantId: input.tenantId,
              eventId: input.eventId,
              scope: input.scope,
              activityId: input.activityId,
              referenceDate: input.referenceDate,
              minAttendanceMinutes: input.minAttendanceMinutes,
              winnersCount: input.winnersCount,
              allowPriorEventWinners: input.allowPriorEventWinners,
              eligibleCount: input.eligibleCount,
              drawnAt: input.drawnAt,
              winners: input.winners.map((winner) => ({
                position: winner.position,
                userId: winner.userId,
                minutes: winner.minutes,
              })),
            };

  return JSON.stringify(ordered);
}

/** SHA-256 do resultado canônico. */
export function hashResult(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Reconferência: o hash gravado corresponde ao resultado que está no banco?
 *
 * É o que permite a um auditor verificar depois que a apuração não foi alterada —
 * trocar um vencedor, a ordem ou o piso de minutos muda o hash.
 */
export function verifyResult(input: RaffleResultPayload, storedHash: string): boolean {
  return hashResult(buildResultPayload(input)) === storedHash;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Resumo para a tela
// ───────────────────────────────────────────────────────────────────────────────
export interface RaffleReadiness {
  eligibleCount: number;
  requested: number;
  /** Quantos serão efetivamente sorteados (limitado pelos elegíveis). */
  willDraw: number;
  /** O sorteio vai entregar menos do que o pedido? */
  shortfall: number;
  /** Quantos suplentes serão sorteados de fato (FASE 16). */
  alternatesToDraw: number;
  canDraw: boolean;
  message: string;
}

/**
 * O sorteio pode ser executado, e com quantos?
 *
 * Devolver `willDraw` separado de `requested` é o ponto: "pedi 10, só há 6
 * elegíveis" precisa ser uma decisão informada do organizador, não uma surpresa
 * depois do clique.
 *
 * Com suplentes, o pool é consumido na ordem: primeiro os titulares, depois as
 * reservas. Se faltam elegíveis, quem sobra recebe o que existe — e o resumo diz
 * quantos suplentes saíram, porque "3 titulares e 0 suplentes" é diferente de
 * "2 titulares e 1 suplente" na hora de entregar o prêmio.
 */
export function evaluateReadiness(
  eligibleCount: number,
  winnersCount: number,
  alternatesCount = 0,
): RaffleReadiness {
  const wanted = Math.max(0, winnersCount) + Math.max(0, alternatesCount);
  const willDraw = Math.min(eligibleCount, wanted);
  const shortfall = Math.max(0, wanted - eligibleCount);
  const winnersDrawn = Math.min(eligibleCount, Math.max(0, winnersCount));
  const alternatesToDraw = Math.max(0, willDraw - winnersDrawn);
  const alternatesSuffix = alternatesCount > 0 ? ` + ${alternatesToDraw} suplente(s)` : '';

  if (eligibleCount === 0) {
    return {
      eligibleCount,
      requested: winnersCount,
      willDraw: 0,
      shortfall,
      alternatesToDraw: 0,
      canDraw: false,
      message:
        'Nenhum participante elegível com presença comprovada para este recorte. Confira o credenciamento e o piso de minutos.',
    };
  }

  if (shortfall > 0) {
    return {
      eligibleCount,
      requested: winnersCount,
      willDraw,
      shortfall,
      alternatesToDraw,
      canDraw: true,
      message: `Há ${eligibleCount} elegível(is) para ${wanted} vaga(s) (titulares + suplentes): o sorteio entregará ${winnersDrawn} titular(es)${alternatesSuffix}.`,
    };
  }

  return {
    eligibleCount,
    requested: winnersCount,
    willDraw,
    shortfall: 0,
    alternatesToDraw,
    canDraw: true,
    message:
      alternatesCount > 0
        ? `${eligibleCount} elegível(is) para ${winnersCount} vaga(s) e ${alternatesCount} suplência(s).`
        : `${eligibleCount} elegível(is) para ${winnersCount} vaga(s).`,
  };
}
