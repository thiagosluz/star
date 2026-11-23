/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Certificação
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O FLUXO EM DUAS FASES, E POR QUE ELE É ASSIM
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. `requestCertificate`  cria a linha QUEUED com o SNAPSHOT + código +
 *         hash + assinatura. É barato e é o que o usuário espera ver na tela.
 *      2. `generateCertificate` renderiza, envia ao storage e marca ISSUED.
 *         É a parte pesada (PDF, QR, upload) e roda no worker.
 *
 *  O snapshot e a assinatura são criados na FASE 1 de propósito: o certificado
 *  passa a existir (com código válido e conteúdo congelado) antes de o arquivo
 *  existir. Se o worker estiver fora do ar, o participante vê "em processamento"
 *  em vez de nada — e o QR nunca aponta para um código inexistente.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A VALIDAÇÃO PÚBLICA NÃO TEM CONTEXTO DE TENANT
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem valida um QR Code não está logado e não sabe a qual instituição o
 *  documento pertence. A leitura acontece por uma policy dedicada
 *  (`certificate_public_validation`), em que o PRÓPRIO CÓDIGO é a capacidade de
 *  acesso: sem a variável de sessão `app.validation_code`, nada é visível.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomInt, randomUUID } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { BUCKETS, putObjectBuffer } from '@/lib/storage/s3-client';
import {
  buildCanonicalPayload,
  buildCanonicalPayloadV2,
  buildCertificateText,
  buildWorkloadBreakdown,
  computeWorkload,
  evaluateEligibility,
  generateValidationCode,
  hashCanonicalPayload,
  type AttendanceRecord,
  type CertificateKind,
  type EligibilityFacts,
  type WorkloadBreakdownEntry,
  type WorkloadResult,
} from '@/domain/certificates/certificate-rules';
import {
  readCertificatePolicy,
  type CertificatePolicy,
} from '@/domain/certificates/certificate-policy-rules';
import {
  aggregateAttendanceByActivity,
  type AttendanceAggregateRow,
} from '@/domain/certificates/attendance-aggregate';
import type { PreviewPerson } from '@/domain/certificates/certificate-preview-rules';
import {
  certificateBodyTemplate,
  contentValuesFrom,
  formatIssuedAtLabel,
  resolveBodyTemplate,
  resolveCertificateVariables,
  serializeContentValues,
  serializeLayout,
  type CertificateVariableValues,
} from '@/domain/certificates/certificate-layout-rules';
import {
  readStoredLayout,
  readTemplateBackground,
  resolveTemplateWithTx,
} from '@/lib/certificates/certificate-template-service';
import {
  renderCertificateLayoutPdf,
  renderCertificateLayoutSvg,
} from '@/lib/certificates/layout-renderer';
import { computeSpeakerWorkload } from '@/domain/speakers/speaker-rules';
import { notifyCertificateIssued } from '@/lib/communication/notification-service';
import { rewardCertificateIssuedById } from '@/lib/gamification/hooks';
import { renderCertificatePdf, renderCertificateSvg } from '@/lib/certificates/renderer';
import { getSigningConfig, isSigningConfigured, signContentHash } from '@/lib/certificates/signer';
import { publicBaseUrl } from '@/lib/public-url';
import { cpfFromFormResponses } from '@/domain/events/registration-form-rules';
import { logger } from '@/lib/observability/logger';
import {
  formatWorkloadLabel,
  getCertificateDownloadUrl,
  getPublicCertificate,
  getPublicCertificateDownloadUrl,
  listCertificates,
  planEventCertificateZip,
  revokeCertificate,
  validationUrlFor,
  verifyCertificateIntegrity,
  type CertificateErrorCode,
  type CertificateResult,
  type CertificateSummary,
  type CertificateZipPlan,
  type PublicCertificate,
} from '@/lib/certificates/certificate-read-service';

export {
  getCertificateDownloadUrl,
  getPublicCertificate,
  getPublicCertificateDownloadUrl,
  listCertificates,
  planEventCertificateZip,
  revokeCertificate,
  validationUrlFor,
  verifyCertificateIntegrity,
  type CertificateErrorCode,
  type CertificateResult,
  type CertificateSummary,
  type CertificateZipPlan,
  type PublicCertificate,
};

// ───────────────────────────────────────────────────────────────────────────────
//  Configuração de exibição
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A base pública virou módulo próprio na FASE 29 (`src/lib/public-url.ts`), porque o
 * telão do sorteio também precisa de endereço absoluto — e duas cópias da mesma
 * precedência de variáveis divergiriam. O reexport mantém os consumidores daqui.
 */
export { publicBaseUrl };

// ───────────────────────────────────────────────────────────────────────────────
//  Levantamento de fatos
// ───────────────────────────────────────────────────────────────────────────────
/*
 * ─────────────────────────────────────────────────────────────────────────────
 *  A PRESENÇA É AGREGADA POR PESSOA × ATIVIDADE ANTES DE VIRAR FATO (FASE 86)
 * ─────────────────────────────────────────────────────────────────────────────
 *  `attendances` tem uma linha por VISITA (ADR-149), e `computeWorkload` avalia uma
 *  entrada por linha. Entregar as linhas cruas fazia duas visitas de 30 min na
 *  mesma atividade de 60 valerem 30 e 30 — cada uma abaixo dos 45 exigidos —, e a
 *  pessoa que esteve a atividade inteira era descartada duas vezes (dívida E92).
 *
 *  Os DOIS caminhos passam por `aggregateAttendanceByActivity`
 *  (`src/domain/certificates/attendance-aggregate.ts`), que soma e aplica o teto da
 *  janela da atividade (ADR-150). Ver `loadFacts` (individual) e `loadEventFacts`
 *  (projeção): a simulação e a emissão continuam montando o MESMO fato — se só um
 *  lado agregasse, a tela prometeria um certificado que a emissão recusaria. E é
 *  agregação EM MEMÓRIA: nenhuma consulta nova, o custo da projeção não cresce com N.
 */

/** Vínculo de palestrante com o que `computeSpeakerWorkload` consome. */
interface SpeakerLinkRow {
  activityId: string;
  workloadMinutes: number | null;
  activity: {
    title: string;
    workloadMinutes: number;
    status: string;
    startsAt: Date;
    endsAt: Date;
  } | null;
}

/**
 * Monta os fatos que não dependem do tipo do certificado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  UMA FUNÇÃO PARA OS DOIS CAMINHOS (individual e projeção em lote)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A simulação e a emissão precisam chegar ao MESMO objeto antes de chamar
 *  `evaluateEligibility`; se cada uma montasse o seu, a diferença apareceria como
 *  "a tela disse 3 e emitiu 2" — sem erro, sem log, e só no dia do evento. O que
 *  muda entre os caminhos é a CONSULTA (uma pessoa × o evento inteiro), não a
 *  forma do fato.
 */
function baseFactsFrom(input: {
  attendances: readonly AttendanceRecord[];
  eventCheckedIn: boolean;
  speakerLinks: readonly SpeakerLinkRow[];
  completedReviews: number;
  acceptedSubmissions: number;
  miniCourseCount: number;
  eventFinished: boolean;
  now: Date;
}): Omit<EligibilityFacts, 'kind'> {
  return {
    attendances: input.attendances,
    eventCheckedIn: input.eventCheckedIn,
    miniCourseCount: input.miniCourseCount,
    isSpeaker: input.speakerLinks.length > 0,
    speakerWorkload:
      input.speakerLinks.length > 0 ? speakerWorkloadFrom(input.speakerLinks, input.now) : null,
    completedReviews: input.completedReviews,
    acceptedSubmissions: input.acceptedSubmissions,
    eventFinished: input.eventFinished,
  };
}

/**
 * Coleta os fatos de elegibilidade de UMA pessoa em UM evento — e a política do
 * evento (FASE 86 · fatia 5).
 *
 * Uma consulta por bloco de fatos (presenças, palestrante, pareceres, trabalhos)
 * em vez de uma por tipo de certificado: a emissão em lote chama isto para dezenas
 * de pessoas, e N+1 aqui viraria centenas de consultas.
 *
 * A política vem do `settings` do EVENTO, que já é lido nesta função (a linha
 * existia para `endsAt`): o campo entra no MESMO `select` e NÃO vira uma consulta
 * nova. É o que mantém a promessa de custo da fase — a régua da projeção em lote
 * (`tests/unit/f85-simulacao-da-emissao.test.ts`) continua fechando em 6 chamadas.
 *
 * Na FASE 85 este caminho continua sendo o da EMISSÃO (sete consultas por pessoa).
 * A tela NÃO o usa: `loadEventFacts` abaixo faz a projeção em lote do evento.
 */
async function loadFacts(
  tx: TxClient,
  input: { tenantId: string; eventId: string; userId: string; now?: Date },
): Promise<{ facts: EligibilityFacts; policy: CertificatePolicy }> {
  const now = input.now ?? new Date();

  const [attendances, registration, speaker, reviews, accepted, miniCourses, event] = await Promise.all([
    /**
     * `startsAt`/`endsAt` vêm na MESMA leitura porque a agregação limita a soma à
     * janela real da atividade (ADR-150): são campos a mais no `select` que já
     * existia, não uma consulta nova.
     */
    tx.attendance.findMany({
      where: { tenantId: input.tenantId, userId: input.userId, eventId: input.eventId },
      select: {
        userId: true,
        activityId: true,
        minutesAttended: true,
        checkedOutAt: true,
        activity: {
          select: { title: true, type: true, workloadMinutes: true, startsAt: true, endsAt: true },
        },
      },
    }),
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O CREDENCIAMENTO NO EVENTO É DA LINHA DO EVENTO (FASE 70)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A leitura era a PRIMEIRA inscrição da pessoa no evento — e a primeira podia
     *  ser a de uma OFICINA. Como a presença na atividade grava `checkedInAt` na
     *  linha dela, quem tinha entrado só numa oficina passava a ter "credenciamento no
     *  evento" (`eventCheckedIn`), e o certificado de PARTICIPAÇÃO do evento saía sem
     *  CPF — porque o CPF é lido da linha do evento, que não existia.
     *
     *  `activityId: null` é o que separa "chegou ao evento" de "esteve numa atividade"
     *  — a mesma distinção que o crachá faz pelo CONTEXTO da leitura (ADR-149).
     */
    tx.registration.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        eventId: input.eventId,
        activityId: null,
        deletedAt: null,
      },
      select: { checkedInAt: true, status: true },
    }),
    /**
     * Vínculos de palestrante (FASE 25).
     *
     * A carga vem do vínculo quando declarada (dois palestrantes dividindo um
     * minicurso de 4 h) e da atividade quando não. `status` e `endsAt` entram na
     * consulta porque a apuração precisa saber se a atividade ACONTECEU.
     */
    tx.activitySpeaker.findMany({
      where: { tenantId: input.tenantId, userId: input.userId, activity: { eventId: input.eventId } },
      select: {
        activityId: true,
        workloadMinutes: true,
        activity: {
          select: { title: true, workloadMinutes: true, status: true, startsAt: true, endsAt: true },
        },
      },
    }),
    tx.review.count({
      where: {
        tenantId: input.tenantId,
        reviewerId: input.userId,
        submittedAt: { not: null },
        submission: { eventId: input.eventId },
      },
    }),
    tx.submission.count({
      where: {
        tenantId: input.tenantId,
        eventId: input.eventId,
        status: 'ACCEPTED',
        deletedAt: null,
        authors: { some: { userId: input.userId } },
      },
    }),
    tx.activity.count({
      where: { tenantId: input.tenantId, eventId: input.eventId, type: 'MINI_COURSE', deletedAt: null },
    }),
    tx.event.findFirst({
      where: { id: input.eventId, tenantId: input.tenantId },
      /**
       * `settings` no MESMO `select` de `endsAt`: a política do evento
       * (`settings.certificatePolicy`) chega sem consulta nova. A leitura é
       * tolerante (`readCertificatePolicy`), então JSON torto cai no padrão em
       * vez de derrubar a emissão.
       */
      select: { endsAt: true, settings: true },
    }),
  ]);

  return {
    facts: {
      kind: 'ATTENDANCE',
      ...baseFactsFrom({
        // Uma linha por pessoa × atividade — a soma das visitas com o teto da
        // atividade. `computeWorkload` segue recebendo uma entrada por par.
        attendances: aggregateAttendanceByActivity(attendances),
        eventCheckedIn: Boolean(registration?.checkedInAt),
        speakerLinks: speaker,
        completedReviews: reviews,
        acceptedSubmissions: accepted,
        miniCourseCount: miniCourses,
        eventFinished: event ? event.endsAt.getTime() <= now.getTime() : false,
        now,
      }),
    },
    policy: readCertificatePolicy(event?.settings).policy,
  };
}

/**
 * Converte os vínculos de palestrante na forma que a elegibilidade e o certificado
 * consomem.
 *
 * O detalhamento é montado aqui, e não depois, porque o `workloadBreakdown` do
 * certificado precisa registrar POR QUE uma atividade não entrou na soma (cancelada
 * ou ainda não concluída) — a mesma razão que o certificado de presença já dá para
 * a atividade sem carga cumprida.
 */
function speakerWorkloadFrom(
  links: readonly {
    activityId: string;
    workloadMinutes: number | null;
    activity: {
      title: string;
      workloadMinutes: number;
      status: string;
      startsAt: Date;
      endsAt: Date;
    } | null;
  }[],
  now: Date,
): WorkloadResult {
  const computed = computeSpeakerWorkload(
    links.map((link) => ({
      activityId: link.activityId,
      activityTitle: link.activity?.title ?? 'Atividade',
      activityStatus: link.activity?.status ?? 'DRAFT',
      startsAt: link.activity?.startsAt ?? now,
      endsAt: link.activity?.endsAt ?? now,
      activityWorkloadMinutes: link.activity?.workloadMinutes ?? 0,
      declaredWorkloadMinutes: link.workloadMinutes ?? null,
    })),
    now,
  );

  const entries: WorkloadBreakdownEntry[] = computed.entries.map((entry) => ({
    activityId: entry.activityId,
    title: entry.activityTitle,
    type: null,
    // Não há minutos medidos aqui: o palestrante recebe a CARGA da atividade, não o
    // tempo de permanência dele na sala.
    minutesAttended: entry.minutes,
    workloadMinutes: entry.minutes,
    countedMinutes: entry.minutes,
    counted: entry.counted,
    reason: entry.reason,
  }));

  return {
    totalMinutes: computed.totalMinutes,
    entries,
    countedActivities: computed.countedActivities,
    declaredMinutes: entries.reduce((sum, entry) => sum + entry.workloadMinutes, 0),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  FASE 85 — a projeção em lote da tela (o DRY-RUN do MESMO serviço)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA PROJEÇÃO, E NÃO `loadFacts` POR PESSOA
 * ─────────────────────────────────────────────────────────────────────────────
 *  `loadFacts` custa SETE consultas por pessoa. Numa tela isso é inviável: um
 *  evento de 300 pessoas faria 2.100 idas ao banco para desenhar uma prévia que
 *  ninguém pediu para gravar. Aqui o evento inteiro é lido em SEIS chamadas Prisma
 *  (a régua é presa por teste de fonte) e os MESMOS fatos são montados por pessoa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A POPULAÇÃO É A DA EMISSÃO, NÃO A DA INSCRIÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Os candidatos são a UNIÃO que `requestEventCertificates` já percorre:
 *  presença ∪ palestrante ∪ parecer submetido ∪ autor de trabalho aceito. Não são
 *  as inscrições: `_count.registrations` conta LINHAS (inclusive a inscrição de uma
 *  atividade) e faria "pessoas no escopo" maior do que a população que a emissão
 *  examina — um número que a tela não pode defender.
 *
 *  As consultas de fatos SÃO a fonte dos candidatos: quem aparece numa presença,
 *  num vínculo de palestrante, num parecer ou numa autoria aceita entra no escopo;
 *  não existe uma consulta separada de "quem são os candidatos".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RÉGUA DAS CONSULTAS (a catraca lê estes marcadores)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Seis chamadas Prisma — não seis comandos SQL. Cada `select` aninhado vira um
 *  comando extra no driver (medido com log de query no evento vazio: 6 chamadas →
 *  13 comandos, porque atividade/usuário/avaliador vêm em consultas separadas). A
 *  régua é de FONTE: é o número de `tx.<modelo>.<operação>(` que esta função
 *  escreve, preso por `tests/unit/f85-simulacao-da-emissao.test.ts`. O que importa
 *  é que o custo não cresça com N — 13 comandos para 3 ou para 300 pessoas.
 */
interface EventFactsProjection {
  eventFound: boolean;
  eventFinished: boolean;
  miniCourseCount: number;
  /**
   * A política de presença do evento (FASE 86 · fatia 5), lida do `settings` que
   * a MESMA consulta do evento já trazia. Não é consulta nova: entra no `select`
   * de `eventFacts` e a régua das SEIS chamadas Prisma da projeção não muda.
   */
  policy: CertificatePolicy;
  candidateIds: string[];
  names: Map<string, string>;
  attendancesByUser: Map<string, AttendanceRecord[]>;
  checkedInUsers: Set<string>;
  speakersByUser: Map<string, SpeakerLinkRow[]>;
  reviewsByUser: Map<string, number>;
  acceptedByUser: Map<string, number>;
}

/** <!-- f85-projecao-inicio --> */
async function loadEventFacts(
  tx: TxClient,
  input: { tenantId: string; eventId: string; now: Date },
): Promise<EventFactsProjection> {
  const { tenantId, eventId, now } = input;

  const [attendances, registrations, speakers, reviews, authors, eventFacts] = await Promise.all([
    /**
     * `startsAt`/`endsAt` na MESMA leitura da presença: a agregação por pessoa ×
     * atividade limita a soma à janela real (ADR-150). São campos a mais no
     * `select` — a régua das SEIS chamadas Prisma não muda.
     */
    tx.attendance.findMany({
      where: { tenantId, eventId },
      select: {
        userId: true,
        activityId: true,
        minutesAttended: true,
        checkedOutAt: true,
        activity: {
          select: { title: true, type: true, workloadMinutes: true, startsAt: true, endsAt: true },
        },
        user: { select: { name: true } },
      },
    }),
    /**
     * Só a linha do EVENTO (`activityId: null`) responde "chegou ao evento" — a
     * mesma distinção da FASE 70. A inscrição de uma atividade grava `checkedInAt`
     * nela e NÃO é credenciamento no evento.
     */
    tx.registration.findMany({
      where: { tenantId, eventId, activityId: null, deletedAt: null },
      select: { userId: true, checkedInAt: true },
    }),
    tx.activitySpeaker.findMany({
      where: { tenantId, activity: { eventId }, userId: { not: null } },
      select: {
        userId: true,
        activityId: true,
        workloadMinutes: true,
        activity: {
          select: { title: true, workloadMinutes: true, status: true, startsAt: true, endsAt: true },
        },
        user: { select: { name: true } },
      },
    }),
    /**
     * `findMany` em vez de `groupBy`: além da contagem, a linha traz o NOME do
     * revisor — sem uma sétima consulta só para nomes. A contagem é feita em
     * memória, sobre exatamente as mesmas linhas que o `count` do caminho
     * individual enxergaria.
     */
    tx.review.findMany({
      where: { tenantId, submission: { eventId }, submittedAt: { not: null } },
      select: { reviewerId: true, reviewer: { select: { name: true } } },
    }),
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O `deletedAt` É SELECIONADO, MAS NÃO ENTRA NO `where` DOS CANDIDATOS
     * ─────────────────────────────────────────────────────────────────────────────
     *  A consulta de CANDIDATOS da emissão aceita autor de trabalho aceito mesmo
     *  que a submissão esteja excluída (ela não filtra `deletedAt`); depois o
     *  `loadFacts` conta só as não excluídas. Reproduzir isso aqui é obrigatório:
     *  filtrar a submissão excluída já na consulta tiraria a pessoa do ESCOPO, e a
     *  tela mostraria uma população menor do que a que a emissão percorre.
     */
    tx.submissionAuthor.findMany({
      where: { tenantId, userId: { not: null }, submission: { eventId, status: 'ACCEPTED' } },
      select: {
        submissionId: true,
        userId: true,
        user: { select: { name: true } },
        submission: { select: { deletedAt: true } },
      },
    }),
    /**
     * Os fatos do EVENTO (fim, número de minicursos e a POLÍTICA DE PRESENÇA) numa
     * leitura só. A lista de minicursos vem filtrada e o tamanho dela é a contagem
     * — o mesmo filtro do `activity.count` individual. `settings` entra no MESMO
     * `select`: a política da fatia 5 não cria consulta.
     */
    tx.event.findFirst({
      where: { id: eventId, tenantId },
      select: {
        endsAt: true,
        settings: true,
        activities: {
          where: { type: 'MINI_COURSE', deletedAt: null },
          select: { id: true },
        },
      },
    }),
  ]);
  /** <!-- f85-projecao-fim --> */

  const candidateIds = new Set<string>();
  const names = new Map<string, string>();
  const attendancesByUser = new Map<string, AttendanceRecord[]>();
  const checkedInUsers = new Set<string>();
  const speakersByUser = new Map<string, SpeakerLinkRow[]>();
  const reviewsByUser = new Map<string, number>();
  const acceptedByUser = new Map<string, number>();

  /**
   * As linhas são agrupadas POR PESSOA primeiro porque a agregação é por
   * `(userId, activityId)` — e esta projeção lê o evento inteiro. Agrupar aqui é
   * memória, não banco: as consultas acima são as mesmas SEIS (a catraca
   * `tests/unit/f85-simulacao-da-emissao.test.ts` prende a régua).
   */
  const attendanceRowsByUser = new Map<string, AttendanceAggregateRow[]>();

  for (const row of attendances) {
    candidateIds.add(row.userId);
    names.set(row.userId, row.user.name);

    const rows = attendanceRowsByUser.get(row.userId) ?? [];
    rows.push(row);
    attendanceRowsByUser.set(row.userId, rows);
  }

  for (const [userId, rows] of attendanceRowsByUser) {
    attendancesByUser.set(userId, aggregateAttendanceByActivity(rows));
  }

  for (const row of registrations) {
    if (row.checkedInAt) checkedInUsers.add(row.userId);
  }

  for (const row of speakers) {
    // A consulta já filtra `userId: { not: null }`; o guarda existe para o tipo.
    if (!row.userId) continue;

    candidateIds.add(row.userId);
    // O vínculo pode existir com `userId` sem relação carregada (legado). O nome é
    // rótulo de tela; faltar nome NÃO pode tirar a pessoa do escopo.
    names.set(row.userId, row.user?.name ?? 'Participante');

    const links = speakersByUser.get(row.userId) ?? [];
    links.push({
      activityId: row.activityId,
      workloadMinutes: row.workloadMinutes,
      activity: row.activity,
    });
    speakersByUser.set(row.userId, links);
  }

  for (const row of reviews) {
    candidateIds.add(row.reviewerId);
    names.set(row.reviewerId, row.reviewer.name);
    reviewsByUser.set(row.reviewerId, (reviewsByUser.get(row.reviewerId) ?? 0) + 1);
  }

  /**
   * Trabalhos aceitos são contados por SUBMISSÃO, não por linha de autoria: o
   * `submission.count` do caminho individual conta o trabalho uma vez para a
   * pessoa, mesmo que ela apareça em duas linhas de coautoria.
   */
  const acceptedSubmissionsByUser = new Map<string, Set<string>>();

  for (const row of authors) {
    if (!row.userId) continue;

    candidateIds.add(row.userId);
    names.set(row.userId, row.user?.name ?? 'Participante');

    if (row.submission.deletedAt) continue;

    const submissions = acceptedSubmissionsByUser.get(row.userId) ?? new Set<string>();
    submissions.add(row.submissionId);
    acceptedSubmissionsByUser.set(row.userId, submissions);
  }

  for (const [userId, submissions] of acceptedSubmissionsByUser) {
    acceptedByUser.set(userId, submissions.size);
  }

  return {
    eventFound: Boolean(eventFacts),
    eventFinished: eventFacts ? eventFacts.endsAt.getTime() <= now.getTime() : false,
    miniCourseCount: eventFacts?.activities.length ?? 0,
    policy: readCertificatePolicy(eventFacts?.settings).policy,
    candidateIds: [...candidateIds],
    names,
    attendancesByUser,
    checkedInUsers,
    speakersByUser,
    reviewsByUser,
    acceptedByUser,
  };
}

export interface EventCertificatePreview {
  /** Pessoas com direito a avaliação — a população que a emissão percorre. */
  scope: number;
  people: PreviewPerson[];
}

/**
 * DRY-RUN da emissão em lote: percorre os candidatos e devolve os vereditos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  NÃO GRAVA NADA — E NÃO DECIDE NADA DIFERENTE
 * ─────────────────────────────────────────────────────────────────────────────
 *  Não há `requestCertificate`, nem fila, nem PDF: só leitura. A decisão é da
 *  MESMA função de domínio que a emissão chama (`evaluateEligibility`), alimentada
 *  pela MESMA montagem de fatos (`baseFactsFrom`). A igualdade com a emissão não é
 *  argumento — é catraca: `tests/integration/f85-preview-e-emissao.test.ts` compara
 *  os elegíveis do preview com os certificados que a emissão cria no mesmo evento.
 *
 *  `reason` é a novidade da fatia: a emissão jogava `verdict.reason` fora
 *  (`skipped += 1`). A tela precisa do texto do domínio para dizer POR QUE uma
 *  pessoa ficou de fora — "não elegível" sem motivo manda a equipe abrir chamado.
 */
export async function previewEventCertificates(input: {
  tenantId: string;
  eventId: string;
  kinds: readonly CertificateKind[];
  now?: Date;
}): Promise<CertificateResult<{ preview: EventCertificatePreview }>> {
  try {
    const now = input.now ?? new Date();

    return await withTenant(input.tenantId, async (tx) => {
      const facts = await loadEventFacts(tx, {
        tenantId: input.tenantId,
        eventId: input.eventId,
        now,
      });

      if (!facts.eventFound) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Evento não encontrado.',
        };
      }

      const people: PreviewPerson[] = facts.candidateIds.map((userId) => {
        const base = baseFactsFrom({
          attendances: facts.attendancesByUser.get(userId) ?? [],
          eventCheckedIn: facts.checkedInUsers.has(userId),
          speakerLinks: facts.speakersByUser.get(userId) ?? [],
          completedReviews: facts.reviewsByUser.get(userId) ?? 0,
          acceptedSubmissions: facts.acceptedByUser.get(userId) ?? 0,
          miniCourseCount: facts.miniCourseCount,
          eventFinished: facts.eventFinished,
          now,
        });

        return {
          userId,
          name: facts.names.get(userId) ?? 'Participante',
          verdicts: input.kinds.map((kind) => {
            /**
             * A MESMA política do evento que a emissão vai aplicar. Se a simulação
             * usasse o default e a emissão a política gravada, a tela diria "2" e
             * o botão emitiria 1 — o modo de falha que a catraca da F85 existe
             * para impedir.
             */
            const verdict = evaluateEligibility({ ...base, kind }, facts.policy);

            return { kind, eligible: verdict.eligible, reason: verdict.reason };
          }),
        };
      });

      // Ordem de leitura estável: nome; o `userId` desempata homônimos para a tela
      // não mudar de ordem entre dois renders do mesmo evento.
      people.sort(
        (a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.userId.localeCompare(b.userId),
      );

      return { ok: true as const, preview: { scope: people.length, people } };
    });
  } catch (error) {
    logger.error(`[certificates] falha ao simular a emissão em lote: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL' as const,
      message: 'Não foi possível simular a emissão agora.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Fase 1 — solicitação (cria o documento com código, hash e assinatura)
// ───────────────────────────────────────────────────────────────────────────────
export interface RequestCertificateInput {
  tenantId: string;
  eventId: string;
  userId: string;
  kind: CertificateKind;
  activityId?: string | null;
  /** Quem pediu (para auditoria). `null` em emissão automática por evento. */
  actorId?: string | null;
  now?: Date;
}

export interface RequestCertificateOutput {
  certificateId: string;
  validationCode: string;
  status: string;
  /** `true` quando o certificado já existia (a operação é idempotente). */
  existing: boolean;
}

/**
 * Cria (ou recupera) o certificado em estado QUEUED.
 *
 * Idempotência pela chave natural `(tenantId, userId, eventId, activityId, kind)`,
 * que já é única no schema: pedir duas vezes não cria dois documentos — o que
 * seria um desastre silencioso, porque cada um teria um código de validação
 * diferente para a mesma conquista.
 */
export async function requestCertificate(
  input: RequestCertificateInput,
): Promise<CertificateResult<RequestCertificateOutput>> {
  try {
    if (!isSigningConfigured()) {
      return {
        ok: false as const,
        code: 'SIGNING_NOT_CONFIGURED',
        message:
          'A assinatura de certificados não está configurada (CERTIFICATE_HMAC_SECRET). Emissão bloqueada.',
      };
    }

    const now = input.now ?? new Date();

    return await withTenant(input.tenantId, async (tx) => {
      const existing = await tx.certificate.findFirst({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          eventId: input.eventId,
          activityId: input.activityId ?? null,
          kind: input.kind,
        },
        select: { id: true, validationCode: true, status: true },
      });

      if (existing) {
        return {
          ok: true as const,
          certificateId: existing.id,
          validationCode: existing.validationCode,
          status: existing.status,
          existing: true,
        };
      }

      /**
       * A política vem do evento e é aplicada AQUI, no caminho individual. O lote
       * (`requestEventCertificates`) passa por este mesmo `requestCertificate`, e a
       * simulação (`previewEventCertificates`) pela mesma `evaluateEligibility` com a
       * mesma política — três caminhos, uma regra.
       */
      const { facts, policy } = await loadFacts(tx, { ...input, now });

      const verdict = evaluateEligibility(
        {
          ...facts,
          kind: input.kind,
        },
        policy,
      );

      if (!verdict.eligible) {
        return {
          ok: false as const,
          code: 'NOT_ELIGIBLE' as const,
          message: verdict.reason,
        };
      }

      const context = await loadCertificateContext(tx, {
        tenantId: input.tenantId,
        eventId: input.eventId,
        userId: input.userId,
        activityId: input.activityId ?? null,
      });

      if (!context) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento ou participante não encontrado.' };
      }

      /**
       * Carga horária:
       *   • MINI_COURSE → só os minicursos;
       *   • SPEAKER     → carga das atividades efetivamente ministradas (FASE 25);
       *   • demais      → tudo o que foi cumprido no evento.
       */
      const workload =
        input.kind === 'SPEAKER' && facts.speakerWorkload
          ? facts.speakerWorkload
          : verdict.workload;

      const text = buildCertificateText({
        kind: input.kind,
        recipientName: context.userName,
        eventTitle: context.eventTitle,
        eventStartsAt: context.eventStartsAt,
        eventEndsAt: context.eventEndsAt,
        workloadMinutes: workload.totalMinutes,
        activityTitle: context.activityTitle,
        tenantName: context.tenantName,
        timeZone: context.timeZone,
      });

      const validationCode = await allocateValidationCode(tx);

      const issuedAt = now;

      /**
       * ─────────────────────────────────────────────────────────────────────────
       *  O MODELO VISUAL DECIDE A VERSÃO DO DOCUMENTO (FASE 40)
       * ─────────────────────────────────────────────────────────────────────────
       *  Sem modelo configurado, o certificado sai no desenho fixo da FASE 6 e o
       *  conteúdo assinado continua sendo a versão 1 — nada muda para quem nunca
       *  abriu o editor. Com modelo, o layout e as variáveis de conteúdo entram no
       *  snapshot e no conteúdo canônico (versão 2).
       *
       *  As variáveis são CONGELADAS aqui, e não lidas na renderização: o nome do
       *  evento, o nome da instituição e o título da atividade vivem em outras
       *  tabelas, e uma edição posterior faria o MESMO documento (mesmo hash) sair
       *  impresso diferente.
       */
      const template = await resolveTemplateWithTx(tx, {
        tenantId: input.tenantId,
        eventId: input.eventId,
        kind: input.kind,
      });

      const baseValues = template
        ? resolveCertificateVariables({
            recipientName: context.userName,
            title: text.title,
            bodyText: text.bodyText,
            eventTitle: context.eventTitle,
            activityTitle: context.activityTitle ?? '',
            workloadLabel: text.workloadLabel,
            period: text.period ?? '',
            issuedAtLabel: formatIssuedAtLabel(issuedAt, context.timeZone),
            tenantName: context.tenantName,
            validationCode,
            validationUrl: validationUrlFor(validationCode),
            contentHash: '',
            signature: '',
            keyId: '',
            /**
             * CPF e título da apresentação (FASE 56 · dívida E54) entram CONGELADOS
             * como os demais: o campo do formulário pode ser corrigido depois e o
             * trabalho pode ser renomeado — o documento emitido fica como estava.
             */
            cpf: context.cpf,
            presentationTitle: context.presentationTitle,
          })
        : null;

      /**
       * ─────────────────────────────────────────────────────────────────────────
       *  O CORPO DO CERTIFICADO É RESOLVIDO UMA VEZ, AQUI (FASE 86)
       * ─────────────────────────────────────────────────────────────────────────
       *  Com um elemento `BODY` no modelo, o texto formal deixa de ser a frase gerada
       *  em código e passa a ser o GABARITO do organizador interpolado com as variáveis
       *  congeladas. A interpolação acontece agora, e não no renderizador, por dois
       *  motivos:
       *
       *    • o texto resolvido precisa entrar na ASSINATURA — `bodyText` e `corpo`
       *      entram no conteúdo canônico, e o documento tem de afirmar o que vai ser
       *      impresso;
       *    • o renderizador não pode reinterpretar o gabarito: se ele interpolasse de
       *      novo, a leitura do banco (evento renomeado, CPF corrigido) faria um
       *      documento com o MESMO hash sair impresso diferente.
       *
       * Os valores do gabarito já existem neste ponto (inclusive `codigo_validacao` e
       * `url_validacao`, alocados acima), e é por isso que a resolução acontece DEPOIS
       * da alocação do código. Sem `BODY`, nada muda: `bodyText` continua a frase
       * gerada e o hash dos documentos já emitidos permanece o mesmo.
       */
      const bodyTemplate = template ? certificateBodyTemplate(template.layout) : null;
      const resolvedBody = bodyTemplate && baseValues ? resolveBodyTemplate(bodyTemplate, baseValues) : null;
      const bodyText = resolvedBody ?? text.bodyText;

      const contentValues = baseValues
        ? contentValuesFrom(resolvedBody === null ? baseValues : { ...baseValues, corpo: resolvedBody })
        : null;

      const canonical = template
        ? buildCanonicalPayloadV2({
            version: 2,
            validationCode,
            tenantId: input.tenantId,
            eventId: input.eventId,
            userId: input.userId,
            activityId: input.activityId ?? null,
            kind: input.kind,
            recipientName: context.userName,
            title: text.title,
            bodyText,
            workloadMinutes: text.workloadMinutes,
            issuedAt: issuedAt.toISOString(),
            layout: serializeLayout(template.layout),
            content: serializeContentValues(contentValues ?? {}),
          })
        : buildCanonicalPayload({
            version: 1,
            validationCode,
            tenantId: input.tenantId,
            eventId: input.eventId,
            userId: input.userId,
            activityId: input.activityId ?? null,
            kind: input.kind,
            recipientName: context.userName,
            title: text.title,
            bodyText,
            workloadMinutes: text.workloadMinutes,
            issuedAt: issuedAt.toISOString(),
          });

      const contentHash = hashCanonicalPayload(canonical);
      const { keyId, alg } = getSigningConfig();
      const signature = signContentHash({ contentHash });

      const created = await tx.certificate.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          eventId: input.eventId,
          userId: input.userId,
          activityId: input.activityId ?? null,
          kind: input.kind,
          status: 'QUEUED',
          validationCode,
          title: text.title,
          recipientName: context.userName,
          /**
           * `bodyText` é o texto RESOLVIDO (FASE 86): com elemento `BODY`, ele é o
           * gabarito interpolado — o mesmo valor que vai em `corpo` no
           * `variableSnapshot`. Guardar o gabarito cru aqui faria o documento afirmar
           * uma coisa e imprimir outra.
           */
          bodyText,
          workloadMinutes: text.workloadMinutes,
          /**
           * ─────────────────────────────────────────────────────────────────────
           *  O DETALHAMENTO CONGELA A REGRA, MAS NÃO É ASSINADO (FASE 86 · fatia 5)
           * ─────────────────────────────────────────────────────────────────────
           *  `workloadBreakdown` guarda as entradas do cálculo E a política que
           *  decidiu quais entram — é o que responde "por que 40 h" meses depois,
           *  quando o organizador já mudou a régua do evento. Ele NÃO entra em
           *  `buildCanonicalPayload`/`V2`, então este objeto não altera o hash nem a
           *  assinatura de documento nenhum (e por isso não se criou a v3).
           *  Consequência declarada: a política congelada não tem prova
           *  criptográfica; o que o documento AFIRMA (`workloadMinutes`) continua
           *  assinado.
           */
          workloadBreakdown: buildWorkloadBreakdown(policy, workload.entries) as unknown as object,
          contentHash,
          signature,
          signatureKeyId: keyId,
          signatureAlg: alg,
          mimeType: 'application/pdf',
          /**
           * O desenho vem do MODELO e é CONGELADO aqui: editar o modelo depois não
           * pode mexer em documento já emitido. `layoutSnapshot` nulo é o que
           * identifica a versão 1 do documento (desenho fixo da FASE 6), e é por isso
           * que a versão do conteúdo canônico não precisa de coluna própria.
           *
           * ─────────────────────────────────────────────────────────────────────
           *  O SNAPSHOT GUARDA O GABARITO **E** O TEXTO RESOLVIDO (FASE 86)
           * ─────────────────────────────────────────────────────────────────────
           *  O layout congelado traz o elemento `BODY` com o gabarito (é o que o hash
           *  cobre e o que prova de onde o texto saiu), e `variableSnapshot.corpo`
           *  traz o texto já interpolado (é o que foi impresso). Os dois juntos
           *  respondem "o que estava escrito" e "de onde veio" sem consultar o modelo
           *  — que pode ter sido editado ou excluído depois.
           */
          templateId: template?.templateId ?? null,
          layoutSnapshot: template ? (template.layout as unknown as object) : undefined,
          variableSnapshot: contentValues ? (contentValues as unknown as object) : undefined,
          /**
           * ─────────────────────────────────────────────────────────────────────
           *  O `issuedAt` É GRAVADO AGORA, E ISSO É OBRIGATÓRIO
           * ─────────────────────────────────────────────────────────────────────
           *  Ele faz parte do CONTEÚDO CANÔNICO assinado. Não gravá-lo aqui fazia a
           *  verificação pública recalcular o hash com `createdAt` (o default do
           *  banco, alguns milissegundos depois) e concluir que a assinatura não
           *  conferia — ou seja, TODO certificado emitido seria reprovado na
           *  validação.
           *
           *  O que o documento afirma é o instante em que ele passou a existir
           *  (registrado, assinado e validável). O arquivo é uma RENDERIZAÇÃO
           *  desse documento e não muda o que ele afirma.
           */
          issuedAt,
        },
        select: { id: true, validationCode: true, status: true },
      });

      return {
        ok: true as const,
        certificateId: created.id,
        validationCode: created.validationCode,
        status: created.status,
        existing: false,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Corrida no `validationCode` (ou na chave natural): o chamador pode tentar
      // de novo e encontrará o registro existente.
      return {
        ok: false as const,
        code: 'ALREADY_ISSUED',
        message: 'Certificado já solicitado. Recarregue a página.',
      };
    }

    logger.error(`[certificates] falha ao solicitar certificado: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível solicitar o certificado.' };
  }
}

/**
 * Aloca um código de validação livre (tentativas limitadas).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CONSULTA NÃO FILTRA POR TENANT
 * ─────────────────────────────────────────────────────────────────────────────
 *  `validationCode` é único GLOBALMENTE (é o que permite validar um documento sem
 *  saber a instituição). A consulta prévia, porém, roda sob RLS e enxerga apenas o
 *  tenant corrente: um código já usado por OUTRA instituição não aparece aqui.
 *
 *  A garantia real é o índice único — e a colisão é astronomicamente improvável
 *  (1 em 29⁸ por tentativa). Quando acontecer, a inserção falha com P2002 e o
 *  chamador recebe "já solicitado", que é um erro honesto e recuperável: tentar de
 *  novo aloca outro código.
 */
async function allocateValidationCode(tx: TxClient): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateValidationCode((max) => randomInt(0, max));
    const taken = await tx.certificate.findFirst({
      where: { validationCode: code },
      select: { id: true },
    });

    if (!taken) return code;
  }

  throw new Error('Não foi possível alocar um código de validação livre.');
}

interface CertificateContext {
  userName: string;
  tenantName: string;
  eventTitle: string;
  eventStartsAt: Date | null;
  eventEndsAt: Date | null;
  activityTitle: string | null;
  timeZone: string;
  /**
   * CPF em DÍGITOS, lido do formulário de inscrição no evento (dívida E54) — `null`
   * quando a pessoa não informou ou o número não confere.
   */
  cpf: string | null;
  /** Título do trabalho que a pessoa enviou neste evento — `null` para quem não submeteu. */
  presentationTitle: string | null;
}

async function loadCertificateContext(
  tx: TxClient,
  input: { tenantId: string; eventId: string; userId: string; activityId: string | null },
): Promise<CertificateContext | null> {
  const [user, tenant, event, activity, registration, submission] = await Promise.all([
    tx.user.findUnique({ where: { id: input.userId }, select: { name: true } }),
    tx.tenant.findUnique({ where: { id: input.tenantId }, select: { name: true, timezone: true } }),
    tx.event.findFirst({
      where: { id: input.eventId, deletedAt: null },
      select: { title: true, startsAt: true, endsAt: true },
    }),
    input.activityId
      ? tx.activity.findFirst({ where: { id: input.activityId }, select: { title: true } })
      : Promise.resolve(null),
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O CPF VEM DA INSCRIÇÃO NO EVENTO (dívida E54)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A inscrição do EVENTO é a de `activityId: null` — é nela que o formulário é
     *  preenchido (as inscrições em atividade herdam a pessoa, não o formulário). A
     *  leitura é a mais recente: quem se inscreveu, cancelou e voltou tem duas linhas.
     */
    tx.registration.findFirst({
      where: {
        tenantId: input.tenantId,
        eventId: input.eventId,
        userId: input.userId,
        activityId: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { formResponses: true },
    }),
    /**
     * O TÍTULO DA APRESENTAÇÃO é o do trabalho que a pessoa enviou neste evento.
     *
     * Rascunho, retirada e cancelamento ficam FORA: não são apresentação — quem
     * escreveu e desistiu antes de enviar não tem título para constar em documento.
     */
    tx.submission.findFirst({
      where: {
        tenantId: input.tenantId,
        eventId: input.eventId,
        submittedById: input.userId,
        deletedAt: null,
        status: { notIn: ['DRAFT', 'WITHDRAWN', 'CANCELED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { title: true },
    }),
  ]);

  if (!user || !tenant || !event) return null;

  return {
    userName: user.name,
    tenantName: tenant.name,
    eventTitle: event.title,
    eventStartsAt: event.startsAt,
    eventEndsAt: event.endsAt,
    activityTitle: activity?.title ?? null,
    timeZone: tenant.timezone ?? 'UTC',
    cpf: cpfFromFormResponses(registration?.formResponses ?? null),
    presentationTitle: submission?.title ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Fase 2 — geração do arquivo (roda no worker)
// ───────────────────────────────────────────────────────────────────────────────
export interface GenerateCertificateOutput {
  status: string;
  storageKey: string;
  bucket: string;
  sizeBytes: number;
  contentHash: string;
}

/**
 * Renderiza o PDF e o SVG, envia ao storage e marca o certificado como emitido.
 *
 * Os dois formatos são gerados juntos: o PDF é o documento, o SVG é a versão
 * leve para a página pública (não precisa de URL assinada para ser exibida).
 */
export async function generateCertificate(input: {
  tenantId: string;
  certificateId: string;
}): Promise<CertificateResult<GenerateCertificateOutput>> {
  try {
    const record = await withTenant(input.tenantId, async (tx) => {
      const certificate = await tx.certificate.findFirst({
        where: { id: input.certificateId },
        select: {
          id: true,
          tenantId: true,
          eventId: true,
          userId: true,
          activityId: true,
          kind: true,
          status: true,
          validationCode: true,
          title: true,
          recipientName: true,
          bodyText: true,
          workloadMinutes: true,
          contentHash: true,
          signature: true,
          signatureKeyId: true,
          signatureAlg: true,
          issuedAt: true,
          createdAt: true,
          revokedAt: true,
          layoutSnapshot: true,
          variableSnapshot: true,
        },
      });

      if (!certificate) return null;

      // Marca GENERATING e incrementa a tentativa (auditoria de retry do worker).
      await tx.certificate.update({
        where: { id: certificate.id },
        data: { status: 'GENERATING', attempts: { increment: 1 } },
      });

      const context = await loadCertificateContext(tx, {
        tenantId: input.tenantId,
        eventId: certificate.eventId,
        userId: certificate.userId,
        activityId: certificate.activityId,
      });

      return { certificate, context };
    });

    if (!record) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'Certificado não encontrado.' };
    }

    const { certificate, context } = record;

    /**
     * A data de emissão é FIXA na primeira geração (`issuedAt`), e não o relógio
     * do momento da renderização: reemitir o mesmo certificado precisa produzir o
     * mesmo hash — e um hash que muda a cada tentativa tornaria a verificação
     * pública inútil.
     */
    const issuedAt = certificate.issuedAt ?? certificate.createdAt;
    const contentHash = certificate.contentHash ?? '';
    const signature = certificate.signature ?? '';

    const document = {
      title: certificate.title,
      recipientName: certificate.recipientName,
      bodyText: certificate.bodyText,
      eventTitle: context?.eventTitle ?? '',
      tenantName: context?.tenantName ?? '',
      period: null as string | null,
      workloadLabel: formatWorkloadLabel(certificate.workloadMinutes),
      validationCode: certificate.validationCode,
      validationUrl: validationUrlFor(certificate.validationCode),
      contentHash,
      signature,
      keyId: certificate.signatureKeyId ?? '',
      signatureAlg: certificate.signatureAlg ?? '',
      issuedAt,
    };

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  QUAL DESENHO RENDERIZA ESTE CERTIFICADO
     * ─────────────────────────────────────────────────────────────────────────────
     *  Com layout no snapshot, quem desenha é o editor visual, com o conteúdo
     *  CONGELADO na emissão — e não o que está no banco hoje. Sem layout, o desenho
     *  fixo da FASE 6 continua valendo: o arquivo de um certificado já emitido não
     *  muda porque a fase seguinte chegou.
     *
     *  Layout sem conteúdo congelado é FALHA, não improviso: renderizar com os dados
     *  de hoje imprimiria um documento que o hash não cobre.
     */
    const layout = readStoredLayout(certificate.layoutSnapshot);
    let pdf: Buffer;
    let svg: string;

    if (layout) {
      const stored = certificate.variableSnapshot;
      const content = stored ? contentValuesFrom(stored as Record<string, string>) : null;

      if (!content) {
        throw new Error('Certificado com modelo visual sem o conteúdo congelado da emissão.');
      }

      const values = {
        ...content,
        hash: contentHash,
        assinatura: signature,
        chave: certificate.signatureKeyId ?? '',
      } as CertificateVariableValues;

      const backgroundBytes = await readTemplateBackground(layout);
      const layoutDocument = { values, layout, backgroundBytes, issuedAt };

      pdf = renderCertificateLayoutPdf(layoutDocument);
      svg = renderCertificateLayoutSvg(layoutDocument);
    } else {
      pdf = renderCertificatePdf(document);
      svg = renderCertificateSvg(document);
    }

    const baseKey = `tenants/${input.tenantId}/events/${certificate.eventId}/certificates/${certificate.id}`;
    const bucket = BUCKETS.certificates();

    const [pdfUpload] = await Promise.all([
      putObjectBuffer({
        bucket,
        objectKey: `${baseKey}/certificado.pdf`,
        body: pdf,
        contentType: 'application/pdf',
        metadata: { 'validation-code': certificate.validationCode, 'content-hash': contentHash },
      }),
      putObjectBuffer({
        bucket,
        objectKey: `${baseKey}/certificado.svg`,
        body: Buffer.from(svg, 'utf8'),
        contentType: 'image/svg+xml',
        metadata: { 'validation-code': certificate.validationCode, 'content-hash': contentHash },
      }),
    ]);

    await withTenant(input.tenantId, (tx) =>
      tx.certificate.update({
        where: { id: certificate.id },
        data: {
          status: 'ISSUED',
          issuedAt,
          storageKey: `${baseKey}/certificado.pdf`,
          bucket,
          mimeType: 'application/pdf',
          sizeBytes: BigInt(pdfUpload.sizeBytes),
          failureReason: null,
        },
      }),
    );

    /**
     * Aviso de certificado emitido (D6), depois do commit e sem poder falhar: o
     * documento já existe no storage e no banco. Este é o caminho usado tanto pela
     * emissão inline quanto pelo worker — quem emite, avisa.
     */
    await notifyCertificateIssued({
      tenantId: input.tenantId,
      certificateId: certificate.id,
    });

    /**
     * ── O CERTIFICADO EMITIDO MOVE A GAMIFICAÇÃO (FASE 43) ──────────────────────
     *
     *  Aqui e não em `issueCertificate`, porque ESTE é o ponto por onde os dois
     *  caminhos passam: a emissão imediata da tela e a geração pelo worker. Registrar
     *  no pedido pagaria por um PDF que pode falhar, e o documento só é promessa
     *  cumprida quando existe.
     *
     *  Depois do commit e sem poder falhar (invariante 8): o arquivo já está no
     *  storage e o banco já diz `ISSUED`.
     */
    await rewardCertificateIssuedById({
      tenantId: input.tenantId,
      certificateId: certificate.id,
    });

    return {
      ok: true as const,
      status: 'ISSUED',
      storageKey: `${baseKey}/certificado.pdf`,
      bucket,
      sizeBytes: pdfUpload.sizeBytes,
      contentHash,
    };
  } catch (error) {
    // Registra a falha para que o operador veja o motivo no painel, em vez de um
    // certificado eternamente "em processamento".
    await withTenant(input.tenantId, (tx) =>
      tx.certificate.updateMany({
        where: { id: input.certificateId },
        data: {
          status: 'QUEUED',
          failureReason: errorMessage(error).slice(0, 500),
        },
      }),
    ).catch(() => undefined);

    logger.error(`[certificates] falha ao gerar certificado: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Falha ao gerar o arquivo do certificado.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Emissão em lote por evento
// ───────────────────────────────────────────────────────────────────────────────
export interface BatchIssueOutput {
  requested: number;
  skipped: number;
  certificates: { userId: string; certificateId: string; kind: CertificateKind }[];
  /**
   * As tentativas recusadas, com o motivo que o domínio produziu (FASE 85).
   *
   * Até aqui o motivo era DESCARTADO (`skipped += 1`), e nem a resposta da action
   * nem a simulação podiam dizer por que alguém ficou de fora. A contagem
   * `skipped` continua existindo (é o contrato antigo), mas agora é
   * `discarded.length` — as duas não podem divergir.
   */
  discarded: { userId: string; kind: CertificateKind; reason: string }[];
}

/**
 * Solicita certificados para TODOS os elegíveis de um evento.
 *
 * Percorre os participantes que tiveram alguma atividade registrada no evento
 * (presença, submissão, parecer ou papel de palestrante) e, para cada um, emite
 * os tipos que os fatos sustentam. Quem não tem fato nenhum é ignorado em
 * silêncio — a alternativa seria criar dezenas de certificados recusados.
 */
export async function requestEventCertificates(input: {
  tenantId: string;
  eventId: string;
  kinds: readonly CertificateKind[];
  actorId?: string | null;
  now?: Date;
}): Promise<CertificateResult<BatchIssueOutput>> {
  try {
    const candidates = await withTenant(input.tenantId, async (tx) => {
      const [attendances, speakers, reviewers, authors] = await Promise.all([
        tx.attendance.findMany({
          where: { tenantId: input.tenantId, eventId: input.eventId },
          select: { userId: true },
          distinct: ['userId'],
        }),
        tx.activitySpeaker.findMany({
          where: { tenantId: input.tenantId, activity: { eventId: input.eventId }, userId: { not: null } },
          select: { userId: true },
          distinct: ['userId'],
        }),
        tx.review.findMany({
          where: { tenantId: input.tenantId, submission: { eventId: input.eventId }, submittedAt: { not: null } },
          select: { reviewerId: true },
          distinct: ['reviewerId'],
        }),
        tx.submissionAuthor.findMany({
          where: { tenantId: input.tenantId, submission: { eventId: input.eventId, status: 'ACCEPTED' }, userId: { not: null } },
          select: { userId: true },
          distinct: ['userId'],
        }),
      ]);

      return [
        ...new Set([
          ...attendances.map((row) => row.userId),
          ...speakers.map((row) => row.userId).filter((id): id is string => Boolean(id)),
          ...reviewers.map((row) => row.reviewerId),
          ...authors.map((row) => row.userId).filter((id): id is string => Boolean(id)),
        ]),
      ];
    });

    const certificates: BatchIssueOutput['certificates'] = [];
    const discarded: BatchIssueOutput['discarded'] = [];

    for (const userId of candidates) {
      for (const kind of input.kinds) {
        const result = await requestCertificate({
          tenantId: input.tenantId,
          eventId: input.eventId,
          userId,
          kind,
          actorId: input.actorId ?? null,
          now: input.now,
        });

        if (result.ok) {
          certificates.push({ userId, certificateId: result.certificateId, kind });
        } else {
          // O motivo deixa de ser jogado fora: é ele que a simulação lista e que a
          // resposta da action conta. `NOT_ELIGIBLE` traz o texto do domínio; os
          // demais códigos (assinatura, erro interno) também têm mensagem própria.
          discarded.push({ userId, kind, reason: result.message });
        }
      }
    }

    return {
      ok: true as const,
      requested: certificates.length,
      skipped: discarded.length,
      certificates,
      discarded,
    };
  } catch (error) {
    logger.error(`[certificates] falha na emissão em lote: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível emitir os certificados.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Orquestração: solicitar + garantir a geração
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Solicita o certificado e GARANTE que ele seja gerado.
 *
 * A fila é tentada primeiro (é o caminho escalável). Se o Redis não responder, a
 * geração acontece inline: o certificado sai do mesmo jeito, apenas ocupando o
 * processo web por algumas centenas de milissegundos. Funcionalidade do produto
 * não pode depender da disponibilidade de um broker.
 *
 * O `import` da fila é DINÂMICO de propósito: `bullmq` é uma dependência pesada e
 * não precisa entrar no bundle das páginas que só consultam certificados.
 */
export async function issueCertificate(
  input: RequestCertificateInput,
): Promise<CertificateResult<RequestCertificateOutput & { generated: boolean }>> {
  const requested = await requestCertificate(input);

  if (!requested.ok) return requested;

  if (requested.existing && requested.status === 'ISSUED') {
    return { ...requested, generated: false };
  }

  let enqueued = false;

  try {
    const { enqueueCertificate } = await import('@/lib/certificates/queue');
    enqueued = await enqueueCertificate({
      tenantId: input.tenantId,
      certificateId: requested.certificateId,
      actorId: input.actorId ?? null,
    });
  } catch (error) {
    logger.error(`[certificates] não foi possível enfileirar: ${errorMessage(error)}`);
  }

  if (enqueued) {
    return { ...requested, generated: false };
  }

  const generated = await generateCertificate({
    tenantId: input.tenantId,
    certificateId: requested.certificateId,
  });

  if (!generated.ok) {
    // O certificado existe (com código e assinatura) mesmo que o arquivo tenha
    // falhado: isso mantém a promessa de "emitido" e permite reprocessar.
    return { ...requested, generated: false };
  }

  return { ...requested, generated: true };
}

/** Reexportado para consumo das telas (mantém o domínio como fonte única). */
export { computeWorkload };
export type { TxClient };
export { isUniqueViolation, violatedIndexName };
