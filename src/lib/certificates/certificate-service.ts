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
import { BUCKETS, createDownloadUrl, putObjectBuffer } from '@/lib/storage/s3-client';
import {
  buildCanonicalPayload,
  buildCertificateText,
  computeWorkload,
  evaluateEligibility,
  evaluateValidation,
  generateValidationCode,
  hashCanonicalPayload,
  isValidValidationCodeFormat,
  normalizeValidationCode,
  type AttendanceRecord,
  type CertificateKind,
  type EligibilityFacts,
  type ValidationVerdict,
  type WorkloadBreakdownEntry,
} from '@/domain/certificates/certificate-rules';
import { renderCertificatePdf, renderCertificateSvg } from '@/lib/certificates/renderer';
import { getSigningConfig, isSigningConfigured, signContentHash, verifySignature } from '@/lib/certificates/signer';

export type CertificateErrorCode =
  | 'NOT_FOUND'
  | 'NOT_ELIGIBLE'
  | 'ALREADY_ISSUED'
  | 'SIGNING_NOT_CONFIGURED'
  | 'INVALID_CODE'
  | 'NOT_STORED'
  | 'INTERNAL';

export type CertificateResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: CertificateErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Configuração de exibição
// ───────────────────────────────────────────────────────────────────────────────
/** Base pública usada para montar a URL que vai no QR Code. */
export function publicBaseUrl(): string {
  return (
    process.env.APP_URL?.replace(/\/+$/, '') ??
    process.env.BETTER_AUTH_URL?.replace(/\/+$/, '') ??
    'http://localhost:3000'
  );
}

export function validationUrlFor(code: string): string {
  return `${publicBaseUrl()}/validar/${code}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Levantamento de fatos
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Coleta os fatos de elegibilidade de UMA pessoa em UM evento.
 *
 * Uma consulta por bloco de fatos (presenças, palestrante, pareceres, trabalhos)
 * em vez de uma por tipo de certificado: a emissão em lote chama isto para dezenas
 * de pessoas, e N+1 aqui viraria centenas de consultas.
 */
async function loadFacts(
  tx: TxClient,
  input: { tenantId: string; eventId: string; userId: string },
): Promise<EligibilityFacts> {
  const [attendances, registration, speaker, reviews, accepted, miniCourses] = await Promise.all([
    tx.attendance.findMany({
      where: { tenantId: input.tenantId, userId: input.userId, eventId: input.eventId },
      select: {
        activityId: true,
        minutesAttended: true,
        checkedOutAt: true,
        activity: { select: { title: true, type: true, workloadMinutes: true } },
      },
    }),
    tx.registration.findFirst({
      where: { tenantId: input.tenantId, userId: input.userId, eventId: input.eventId, deletedAt: null },
      select: { checkedInAt: true, status: true },
    }),
    tx.activitySpeaker.findMany({
      where: { tenantId: input.tenantId, userId: input.userId, activity: { eventId: input.eventId } },
      select: { workloadMinutes: true, activity: { select: { workloadMinutes: true } } },
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
  ]);

  const records: AttendanceRecord[] = attendances.map((attendance) => ({
    activityId: attendance.activityId,
    activityTitle: attendance.activity?.title ?? null,
    activityType: attendance.activity?.type ?? null,
    workloadMinutes: attendance.activity?.workloadMinutes ?? 0,
    /**
     * Sem check-out, o tempo medido é 0 — não "indefinido". Assumir presença
     * completa sem saída registrada seria emitir certificado por comparecimento
     * presumido, exatamente o que a regra dos 75 % existe para impedir.
     */
    minutesAttended: attendance.checkedOutAt ? (attendance.minutesAttended ?? 0) : 0,
  }));

  return {
    kind: 'ATTENDANCE',
    attendances: records,
    eventCheckedIn: Boolean(registration?.checkedInAt),
    miniCourseCount: miniCourses,
    isSpeaker: speaker.length > 0,
    speakerWorkloadMinutes: speaker.reduce(
      (sum, entry) => sum + (entry.workloadMinutes ?? entry.activity?.workloadMinutes ?? 0),
      0,
    ),
    completedReviews: reviews,
    acceptedSubmissions: accepted,
  };
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

      const facts = await loadFacts(tx, input);

      const verdict = evaluateEligibility({
        ...facts,
        kind: input.kind,
      });

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
       *   • SPEAKER     → carga atribuída ao palestrante, quando declarada;
       *   • demais      → tudo o que foi cumprido no evento.
       */
      const workload =
        input.kind === 'SPEAKER' && facts.speakerWorkloadMinutes > 0
          ? {
              totalMinutes: facts.speakerWorkloadMinutes,
              entries: verdict.workload.entries,
              countedActivities: verdict.workload.countedActivities,
              declaredMinutes: verdict.workload.declaredMinutes,
            }
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
      const canonical = buildCanonicalPayload({
        version: 1,
        validationCode,
        tenantId: input.tenantId,
        eventId: input.eventId,
        userId: input.userId,
        activityId: input.activityId ?? null,
        kind: input.kind,
        recipientName: context.userName,
        title: text.title,
        bodyText: text.bodyText,
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
          bodyText: text.bodyText,
          workloadMinutes: text.workloadMinutes,
          workloadBreakdown: workload.entries as unknown as object,
          contentHash,
          signature,
          signatureKeyId: keyId,
          signatureAlg: alg,
          mimeType: 'application/pdf',
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

    console.error(`[certificates] falha ao solicitar certificado: ${errorMessage(error)}`);
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
}

async function loadCertificateContext(
  tx: TxClient,
  input: { tenantId: string; eventId: string; userId: string; activityId: string | null },
): Promise<CertificateContext | null> {
  const [user, tenant, event, activity] = await Promise.all([
    tx.user.findUnique({ where: { id: input.userId }, select: { name: true } }),
    tx.tenant.findUnique({ where: { id: input.tenantId }, select: { name: true, timezone: true } }),
    tx.event.findFirst({
      where: { id: input.eventId, deletedAt: null },
      select: { title: true, startsAt: true, endsAt: true },
    }),
    input.activityId
      ? tx.activity.findFirst({ where: { id: input.activityId }, select: { title: true } })
      : Promise.resolve(null),
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

    const pdf = renderCertificatePdf(document);
    const svg = renderCertificateSvg(document);

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

    console.error(`[certificates] falha ao gerar certificado: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Falha ao gerar o arquivo do certificado.' };
  }
}

function formatWorkloadLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}min`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${String(rest).padStart(2, '0')}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Emissão em lote por evento
// ───────────────────────────────────────────────────────────────────────────────
export interface BatchIssueOutput {
  requested: number;
  skipped: number;
  certificates: { userId: string; certificateId: string; kind: CertificateKind }[];
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
    let skipped = 0;

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
          skipped += 1;
        }
      }
    }

    return {
      ok: true as const,
      requested: certificates.length,
      skipped,
      certificates,
    };
  } catch (error) {
    console.error(`[certificates] falha na emissão em lote: ${errorMessage(error)}`);
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
    console.error(`[certificates] não foi possível enfileirar: ${errorMessage(error)}`);
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

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura (tenant)
// ───────────────────────────────────────────────────────────────────────────────
export interface CertificateSummary {
  id: string;
  kind: CertificateKind;
  status: string;
  title: string;
  recipientName: string;
  eventTitle: string;
  validationCode: string;
  workloadMinutes: number;
  workloadLabel: string;
  issuedAt: Date | null;
  revokedAt: Date | null;
  validationUrl: string;
  contentHash: string | null;
  hasFile: boolean;
  eventId: string;
  userId: string;
}

export async function listCertificates(input: {
  tenantId: string;
  userId?: string;
  eventId?: string;
  limit?: number;
}): Promise<CertificateResult<{ certificates: CertificateSummary[] }>> {
  try {
    const rows = await withTenant(input.tenantId, (tx) =>
      tx.certificate.findMany({
        where: {
          tenantId: input.tenantId,
          ...(input.userId ? { userId: input.userId } : {}),
          ...(input.eventId ? { eventId: input.eventId } : {}),
        },
        orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        take: Math.min(Math.max(1, input.limit ?? 50), 200),
        select: {
          id: true,
          kind: true,
          status: true,
          title: true,
          recipientName: true,
          validationCode: true,
          workloadMinutes: true,
          issuedAt: true,
          revokedAt: true,
          contentHash: true,
          storageKey: true,
          eventId: true,
          userId: true,
          event: { select: { title: true } },
        },
      }),
    );

    return {
      ok: true as const,
      certificates: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        title: row.title,
        recipientName: row.recipientName,
        eventTitle: row.event?.title ?? '',
        validationCode: row.validationCode,
        workloadMinutes: row.workloadMinutes,
        workloadLabel: formatWorkloadLabel(row.workloadMinutes),
        issuedAt: row.issuedAt,
        revokedAt: row.revokedAt,
        validationUrl: validationUrlFor(row.validationCode),
        contentHash: row.contentHash,
        hasFile: Boolean(row.storageKey),
        eventId: row.eventId,
        userId: row.userId,
      })),
    };
  } catch (error) {
    console.error(`[certificates] falha ao listar certificados: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível carregar os certificados.' };
  }
}

/**
 * URL assinada de download do PDF.
 *
 * A validade é curta (5 min) e a URL é gerada sob demanda: um certificado contém
 * dados pessoais e não deve ficar acessível por link permanente em histórico de
 * navegador ou cache de proxy.
 */
export async function getCertificateDownloadUrl(input: {
  tenantId: string;
  certificateId: string;
  /** Permite baixar certificado de TERCEIRO (equipe/validação pública). */
  allowAnyUser?: boolean;
  userId?: string;
}): Promise<CertificateResult<{ url: string; fileName: string }>> {
  try {
    const certificate = await withTenant(input.tenantId, (tx) =>
      tx.certificate.findFirst({
        where: {
          id: input.certificateId,
          ...(input.allowAnyUser ? {} : input.userId ? { userId: input.userId } : {}),
        },
        select: {
          storageKey: true,
          bucket: true,
          status: true,
          recipientName: true,
          validationCode: true,
          revokedAt: true,
        },
      }),
    );

    if (!certificate) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'Certificado não encontrado.' };
    }

    if (!certificate.storageKey || !certificate.bucket || certificate.status !== 'ISSUED') {
      return {
        ok: false as const,
        code: 'NOT_STORED',
        message: 'O arquivo do certificado ainda está sendo gerado.',
      };
    }

    const fileName = `${certificate.validationCode}-${certificate.recipientName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase()}.pdf`;

    const url = await createDownloadUrl({
      bucket: certificate.bucket,
      objectKey: certificate.storageKey,
      fileName,
    });

    return { ok: true as const, url, fileName };
  } catch (error) {
    console.error(`[certificates] falha ao gerar URL de download: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível preparar o download.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Revogação
// ───────────────────────────────────────────────────────────────────────────────
export async function revokeCertificate(input: {
  tenantId: string;
  certificateId: string;
  reason: string;
}): Promise<CertificateResult<{ revokedAt: Date }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const certificate = await tx.certificate.findFirst({
        where: { id: input.certificateId },
        select: { id: true, revokedAt: true },
      });

      if (!certificate) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Certificado não encontrado.' };
      }

      const revokedAt = certificate.revokedAt ?? new Date();

      await tx.certificate.update({
        where: { id: certificate.id },
        data: { revokedAt, revokedReason: input.reason.slice(0, 400) },
      });

      return { ok: true as const, revokedAt };
    });
  } catch (error) {
    console.error(`[certificates] falha ao revogar: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível revogar o certificado.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Validação pública (SEM contexto de tenant)
// ───────────────────────────────────────────────────────────────────────────────
export interface PublicCertificate {
  validationCode: string;
  kind: CertificateKind;
  title: string;
  recipientName: string;
  bodyText: string;
  workloadMinutes: number;
  workloadLabel: string;
  workloadBreakdown: WorkloadBreakdownEntry[];
  issuedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  expiresAt: Date | null;
  status: string;
  contentHash: string | null;
  signatureValid: boolean;
  signatureKeyId: string | null;
  signatureAlg: string | null;
  tenantName: string;
  eventTitle: string;
  validationUrl: string;
  validationCount: number;
}

/**
 * Lê o certificado pelo código, sem contexto de tenant.
 *
 * A transação define `app.validation_code` em vez de `app.tenant_id`: a policy
 * dedicada libera EXATAMENTE a linha daquele código. Sem o código, zero linhas —
 * a mesma política fail-closed do resto do sistema.
 *
 * A assinatura é verificada AQUI, e o resultado viaja junto com o documento: a
 * página pública mostra se a assinatura confere, em vez de apenas afirmar que o
 * documento é autêntico.
 */
export async function getPublicCertificate(rawCode: string): Promise<
  CertificateResult<{ verdict: ValidationVerdict; certificate: PublicCertificate | null }>
> {
  try {
    const code = normalizeValidationCode(rawCode);

    if (!isValidValidationCodeFormat(code)) {
      return {
        ok: true as const,
        verdict: {
          status: 'NOT_FOUND' as const,
          message: 'Código em formato inválido. Confira os caracteres e tente novamente.',
          isUsable: false,
        },
        certificate: null,
      };
    }

    const baseUrl = publicBaseUrl();

    const row = await withValidationCode(code, async (tx) => {
      const certificate = await tx.certificate.findFirst({
        where: { validationCode: code },
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
          workloadBreakdown: true,
          issuedAt: true,
          createdAt: true,
          revokedAt: true,
          revokedReason: true,
          expiresAt: true,
          contentHash: true,
          signature: true,
          signatureKeyId: true,
          signatureAlg: true,
          validationCount: true,
        },
      });

      if (!certificate) return null;

      return certificate;
    });

    if (!row) {
      return {
        ok: true as const,
        verdict: evaluateValidation({
          found: false,
          status: null,
          revokedAt: null,
          revokedReason: null,
          expiresAt: null,
          now: new Date(),
        }),
        certificate: null,
      };
    }

    /**
     * Verificação da assinatura: recalcula o conteúdo canônico A PARTIR DO BANCO.
     * Se alguém alterar `bodyText` (ou qualquer campo coberto) por fora, o hash
     * deixa de casar e a assinatura não confere — que é exatamente o que a
     * assinatura existe para detectar.
     */
    const issuedAt = row.issuedAt ?? row.createdAt;
    const canonical = buildCanonicalPayload({
      version: 1,
      validationCode: row.validationCode,
      tenantId: row.tenantId,
      eventId: row.eventId,
      userId: row.userId,
      activityId: row.activityId,
      kind: row.kind,
      recipientName: row.recipientName,
      title: row.title,
      bodyText: row.bodyText,
      workloadMinutes: row.workloadMinutes,
      issuedAt: issuedAt.toISOString(),
    });

    const recomputedHash = hashCanonicalPayload(canonical);
    const hashMatches = recomputedHash === row.contentHash;
    const signatureValid =
      hashMatches &&
      Boolean(row.signature) &&
      verifySignature({ contentHash: recomputedHash, signature: row.signature ?? '' });

    // Leitura de exibição + contador de acesso, dentro do contexto de tenant já
    // resolvido. A policy de validação pública é SOMENTE de SELECT: quem valida
    // pode ler o documento pelo código, mas a escrita acontece no contexto
    // correto (e é o tenant que responde por ela).
    const display = await withTenant(row.tenantId, async (tx) => {
      const [tenant, event] = await Promise.all([
        tx.tenant.findUnique({ where: { id: row.tenantId }, select: { name: true } }),
        tx.event.findFirst({ where: { id: row.eventId }, select: { title: true } }),
      ]);

      await tx.certificate.update({
        where: { id: row.id },
        data: { validationCount: { increment: 1 }, lastValidatedAt: new Date() },
      });

      return { tenantName: tenant?.name ?? '', eventTitle: event?.title ?? '' };
    }).catch(() => ({ tenantName: '', eventTitle: '' }));

    const verdict = evaluateValidation({
      found: true,
      status: row.status,
      revokedAt: row.revokedAt,
      revokedReason: row.revokedReason,
      expiresAt: row.expiresAt,
      now: new Date(),
    });

    return {
      ok: true as const,
      verdict,
      certificate: {
        validationCode: row.validationCode,
        kind: row.kind,
        title: row.title,
        recipientName: row.recipientName,
        bodyText: row.bodyText,
        workloadMinutes: row.workloadMinutes,
        workloadLabel: formatWorkloadLabel(row.workloadMinutes),
        workloadBreakdown: (row.workloadBreakdown as unknown as WorkloadBreakdownEntry[]) ?? [],
        issuedAt: row.issuedAt,
        revokedAt: row.revokedAt,
        revokedReason: row.revokedReason,
        expiresAt: row.expiresAt,
        status: row.status,
        contentHash: row.contentHash,
        signatureValid,
        signatureKeyId: row.signatureKeyId,
        signatureAlg: row.signatureAlg,
        tenantName: display.tenantName,
        eventTitle: display.eventTitle,
        validationUrl: `${baseUrl}/validar/${row.validationCode}`,
        validationCount: row.validationCount + 1,
      },
    };
  } catch (error) {
    console.error(`[certificates] falha na validação pública: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível validar o certificado.' };
  }
}

/**
 * Executa uma leitura com a capacidade de validação ativa.
 *
 * `set_config(..., true)` é LOCAL à transação: a capacidade morre no COMMIT e não
 * vaza para a próxima requisição que usar a mesma conexão do pool. É o mesmo
 * raciocínio do `app.tenant_id` — e a razão de não existir um `SET` global.
 */
async function withValidationCode<T>(
  code: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  const { systemClient } = await import('@/lib/db/tenant-client');

  return systemClient().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.validation_code', ${code}, true)`;
    return fn(tx as TxClient);
  });
}

/** Utilitário exposto para a tela de conferência: carga horária detalhada. */
export function summarizeWorkload(entries: readonly WorkloadBreakdownEntry[]): {
  counted: number;
  total: number;
} {
  return entries.reduce(
    (accumulator, entry) => ({
      counted: accumulator.counted + (entry.counted ? 1 : 0),
      total: accumulator.total + entry.countedMinutes,
    }),
    { counted: 0, total: 0 },
  );
}

/**
 * URL assinada do PDF a partir do CÓDIGO de validação.
 *
 * É o download público: quem tem o código (impresso no documento ou lido do QR)
 * baixa o próprio certificado. O código É a credencial — por isso ele é longo e
 * usa alfabeto sem ambiguidade, e por isso a URL assinada dura 5 minutos.
 */
export async function getPublicCertificateDownloadUrl(
  rawCode: string,
): Promise<CertificateResult<{ url: string; fileName: string }>> {
  const code = normalizeValidationCode(rawCode);

  if (!isValidValidationCodeFormat(code)) {
    return { ok: false as const, code: 'INVALID_CODE', message: 'Código de validação inválido.' };
  }

  const located = await withValidationCode(code, async (tx) =>
    tx.certificate.findFirst({
      where: { validationCode: code },
      select: { id: true, tenantId: true, revokedAt: true, status: true },
    }),
  );

  if (!located) {
    return { ok: false as const, code: 'NOT_FOUND', message: 'Certificado não encontrado.' };
  }

  if (located.revokedAt) {
    return {
      ok: false as const,
      code: 'NOT_FOUND',
      message: 'Este certificado foi revogado e não pode ser baixado.',
    };
  }

  if (located.status !== 'ISSUED') {
    return {
      ok: false as const,
      code: 'NOT_STORED',
      message: 'O arquivo ainda está sendo gerado. Tente novamente em instantes.',
    };
  }

  return getCertificateDownloadUrl({
    tenantId: located.tenantId,
    certificateId: located.id,
    allowAnyUser: true,
  });
}

/** Reexportado para consumo das telas (mantém o domínio como fonte única). */
export { computeWorkload };
export type { TxClient };
export { isUniqueViolation, violatedIndexName };
