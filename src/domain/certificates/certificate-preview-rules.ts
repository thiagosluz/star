/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — A SIMULAÇÃO DA EMISSÃO EM LOTE (FASE 85)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A SIMULAÇÃO NÃO É UMA SEGUNDA REGRA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este módulo NÃO decide quem é elegível. Quem decide é `evaluateEligibility`
 *  (`certificate-rules.ts`), a MESMA função que a emissão chama — a projeção em
 *  lote só monta os fatos e alimenta essa função. Aqui ficam apenas as duas coisas
 *  que a TELA precisa e o domínio pode provar sem banco:
 *
 *    1. a CONTAGEM do que a simulação mostrou (escopo, elegíveis, descartados);
 *    2. a ESTIMATIVA de tempo, com a régua de amostra mínima.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FRAÇÃO É ELEGÍVEIS ÷ ESCOPO — NUNCA "PRESENÇA MÉDIA"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `eligibleRatio` responde "de cada 100 pessoas com direito a avaliação, quantas
 *  têm ao menos um documento a receber". Presença média é outro número, com outro
 *  denominador (minutos) e outro significado: dividir minutos por pessoas para
 *  dizer "96,3 % elegível" seria inventar uma taxa que ninguém calculou. Quando não
 *  há escopo, a fração é `null` — "não há denominador" não é 0 %.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { CertificateKind } from './certificate-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Tipos da simulação
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Os tipos que a tela simula por PADRÃO.
 *
 * É a mesma lista que o formulário marca ao abrir — a simulação e as caixas de
 * seleção não podem discordar no primeiro render, senão o N do botão já nasce
 * mentindo. Trocar as caixas e disparar RECALCULA: o N exibido é a foto do que a
 * página viu, e isso é dito na tela.
 *
 * `MERIT` fica fora porque é concessão nominal do comitê, não um documento que o
 * lote saiba distribuir (a mesma exclusão da lista de tipos da tela).
 */
export const DEFAULT_BATCH_KINDS: readonly CertificateKind[] = ['ATTENDANCE', 'MINI_COURSE'];

/** Um veredito da simulação — o MESMO texto que a emissão devolveria. */
export interface PreviewVerdict {
  kind: CertificateKind;
  eligible: boolean;
  reason: string;
}

/** Uma pessoa candidata e o veredito dela para cada tipo simulado. */
export interface PreviewPerson {
  userId: string;
  name: string;
  verdicts: readonly PreviewVerdict[];
}

/** Uma tentativa (pessoa × tipo) recusada, com o motivo do domínio. */
export interface PreviewDiscard {
  userId: string;
  name: string;
  kind: CertificateKind;
  reason: string;
}

export interface EventPreviewSummary {
  /** Pessoas que a emissão em lote realmente considera candidatas. */
  scope: number;
  /** Pessoas com ao menos um tipo aprovado. */
  eligiblePeople: number;
  /** `eligiblePeople / scope`; `null` quando o escopo é zero. */
  eligibleRatio: number | null;
  /** Pares (pessoa × tipo) aprovados — o N do disparo. */
  certificatesToIssue: number;
  /** Pares recusados, com o motivo que o domínio produziu. */
  discarded: PreviewDiscard[];
}

/**
 * Conta o que a projeção devolveu.
 *
 * `scope` entra explícito (e não é derivado de `people.length`) porque uma pessoa
 * sem veredito nenhum — tipos vazios — continua no escopo: ela foi avaliada e não
 * tem documento a receber. Derivar o escopo da lista de vereditos encolheria o
 * denominador justamente no caso em que a tela precisa ser honesta.
 */
export function summarizeEventPreview(input: {
  scope: number;
  people: readonly PreviewPerson[];
}): EventPreviewSummary {
  const scope = Math.max(0, Math.round(input.scope));
  const eligibleUsers = new Set<string>();
  const discarded: PreviewDiscard[] = [];
  let certificatesToIssue = 0;

  for (const person of input.people) {
    let personApproved = false;

    for (const verdict of person.verdicts) {
      if (verdict.eligible) {
        personApproved = true;
        certificatesToIssue += 1;
        continue;
      }

      discarded.push({
        userId: person.userId,
        name: person.name,
        kind: verdict.kind,
        reason: verdict.reason,
      });
    }

    if (personApproved) eligibleUsers.add(person.userId);
  }

  /**
   * A lista é ordenada para a tela ser estável entre renders. O desempate pelo
   * `userId` existe porque duas pessoas podem ter o mesmo nome — e a ordem não
   * pode depender da ordem em que o banco devolveu as linhas.
   */
  discarded.sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'pt-BR') ||
      a.userId.localeCompare(b.userId) ||
      a.kind.localeCompare(b.kind),
  );

  return {
    scope,
    eligiblePeople: eligibleUsers.size,
    eligibleRatio: scope > 0 ? eligibleUsers.size / scope : null,
    certificatesToIssue,
    discarded,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Estimativa de tempo
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Abaixo disto não há estimativa — há uma coincidência.
 *
 * Um único PDF pode ter sido gerado com o storage quente e outro com o worker
 * frio; a média de 1 ou 2 amostras não descreve nada. Cinco é o piso declarado:
 * com menos, a tela diz "ainda sem medição" em vez de exibir um número que
 * ninguém deveria usar para planejar nada.
 */
export const MIN_GENERATION_SAMPLE = 5;

/** Média observada nos jobs concluídos (`Job.processedOn`/`finishedOn`). */
export interface GenerationTimeSample {
  averageMs: number;
  sampleSize: number;
}

export interface GenerationTimeEstimate {
  /** Soma do trabalho estimado — NÃO é o relógio (o worker processa em paralelo). */
  totalMs: number;
  averageMs: number;
  sampleSize: number;
}

/**
 * Estima o TRABALHO de gerar N PDFs.
 *
 * `null` quando não há amostra suficiente — e a tela é obrigada a dizer "ainda sem
 * medição". O número nunca é inventado a partir de uma constante: a única fonte é
 * o tempo real dos jobs que a fila ainda retém.
 *
 * Não divide pela concorrência do worker: o processo web NÃO observa
 * `WORKER_CONCURRENCY`, então qualquer divisão seria um chute com cara de medição.
 */
export function estimateGenerationTime(input: {
  certificates: number;
  sample: GenerationTimeSample | null;
}): GenerationTimeEstimate | null {
  const sample = input.sample;

  if (!sample) return null;
  if (sample.sampleSize < MIN_GENERATION_SAMPLE) return null;
  if (!Number.isFinite(sample.averageMs) || sample.averageMs <= 0) return null;

  const certificates = Math.max(0, Math.round(input.certificates));

  return {
    totalMs: Math.round(certificates * sample.averageMs),
    averageMs: Math.round(sample.averageMs),
    sampleSize: sample.sampleSize,
  };
}
