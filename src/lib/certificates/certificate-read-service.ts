import {
  PUBLIC_CERTIFICATE_CACHE_TTL_SECONDS,
  certificateCacheKey,
  shouldCacheCertificateVerdict,
} from '@/domain/cache/public-cache-rules';
import {
  getOrSetDirectPublicCache,
  invalidatePublicCertificateCache,
} from '@/lib/cache/public-read-cache';
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { createDownloadUrl } from '@/lib/storage/s3-client';
import {
  buildCanonicalPayload,
  buildCanonicalPayloadV2,
  evaluateValidation,
  hashCanonicalPayload,
  isValidValidationCodeFormat,
  normalizeValidationCode,
  readWorkloadBreakdown,
  type CertificateKind,
  type ValidationVerdict,
  type WorkloadBreakdownEntry,
} from '@/domain/certificates/certificate-rules';
import {
  contentValuesFrom,
  serializeContentValues,
  serializeLayout,
} from '@/domain/certificates/certificate-layout-rules';
import { readStoredLayout } from '@/lib/certificates/certificate-template-service';
import { verifySignature } from '@/lib/certificates/signer';
import { publicBaseUrl } from '@/lib/public-url';
import { logger } from '@/lib/observability/logger';

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

export function validationUrlFor(code: string): string {
  return `${publicBaseUrl()}/validar/${code}`;
}

export function formatWorkloadLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}min`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${String(rest).padStart(2, '0')}`;
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
    logger.error(`[certificates] falha ao listar certificados: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível carregar os certificados.' };
  }
}

export interface CertificateZipPlan {
  eventTitle: string;
  eventSlug: string;
  entries: { certificateId: string; bucket: string; storageKey: string; fileName: string }[];
  pending: number;
}

export async function planEventCertificateZip(input: {
  tenantId: string;
  eventId: string;
}): Promise<CertificateResult<CertificateZipPlan>> {
  try {
    const plan = await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { title: true, slug: true },
      });

      if (!event) return null;

      const rows = await tx.certificate.findMany({
        where: { tenantId: input.tenantId, eventId: input.eventId, status: 'ISSUED' },
        orderBy: [{ kind: 'asc' }, { issuedAt: 'asc' }],
        select: {
          id: true,
          bucket: true,
          storageKey: true,
          validationCode: true,
          recipientName: true,
        },
      });

      const inFlight = await tx.certificate.count({
        where: {
          tenantId: input.tenantId,
          eventId: input.eventId,
          status: { in: ['QUEUED', 'GENERATING'] },
        },
      });

      const entries: CertificateZipPlan['entries'] = [];
      let pending = inFlight;

      for (const row of rows) {
        if (!row.storageKey || !row.bucket) {
          pending += 1;
          continue;
        }

        entries.push({
          certificateId: row.id,
          bucket: row.bucket,
          storageKey: row.storageKey,
          fileName: `${row.validationCode}-${row.recipientName
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .toLowerCase()}.pdf`,
        });
      }

      return { eventTitle: event.title, eventSlug: event.slug, entries, pending };
    });

    if (!plan) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
    }

    if (plan.entries.length === 0) {
      return {
        ok: false as const,
        code: 'NOT_STORED',
        message:
          plan.pending > 0
            ? `Os ${plan.pending} certificado(s) deste evento ainda estão sendo gerados. Tente de novo em alguns minutos.`
            : 'Este evento ainda não tem certificados emitidos.',
      };
    }

    return { ok: true as const, ...plan };
  } catch (error) {
    logger.error(`[certificates] falha ao montar o lote: ${errorMessage(error)}`);

    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível preparar o lote.' };
  }
}

export async function getCertificateDownloadUrl(input: {
  tenantId: string;
  certificateId: string;
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
    logger.error(`[certificates] falha ao gerar URL de download: ${errorMessage(error)}`);
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
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const certificate = await tx.certificate.findFirst({
        where: { id: input.certificateId },
        select: { id: true, revokedAt: true, validationCode: true },
      });

      if (!certificate) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Certificado não encontrado.' };
      }

      const revokedAt = certificate.revokedAt ?? new Date();

      await tx.certificate.update({
        where: { id: certificate.id },
        data: { revokedAt, revokedReason: input.reason.slice(0, 400) },
      });

      return { ok: true as const, revokedAt, validationCode: certificate.validationCode };
    });

    if (!outcome.ok) return outcome;
    await invalidatePublicCertificateCache(outcome.validationCode);
    return { ok: true as const, revokedAt: outcome.revokedAt };
  } catch (error) {
    logger.error(`[certificates] falha ao revogar: ${errorMessage(error)}`);
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

export async function verifyCertificateIntegrity(
  certificateId: string,
  tenantId: string,
): Promise<{
  ok: boolean;
  signatureValid: boolean;
  hasSignature: boolean;
  contentHash: string | null;
}> {
  const row = await withTenant(tenantId, (tx) =>
    tx.certificate.findFirst({
      where: { id: certificateId },
      select: {
        validationCode: true,
        tenantId: true,
        eventId: true,
        userId: true,
        activityId: true,
        kind: true,
        recipientName: true,
        title: true,
        bodyText: true,
        workloadMinutes: true,
        issuedAt: true,
        createdAt: true,
        contentHash: true,
        signature: true,
        layoutSnapshot: true,
        variableSnapshot: true,
      },
    }),
  );

  if (!row) return { ok: false, signatureValid: false, hasSignature: false, contentHash: null };

  const issuedAt = row.issuedAt ?? row.createdAt;
  const storedLayout = readStoredLayout(row.layoutSnapshot);

  const canonical = storedLayout
    ? buildCanonicalPayloadV2({
        version: 2,
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
        layout: serializeLayout(storedLayout),
        content: serializeContentValues(
          contentValuesFrom((row.variableSnapshot as Record<string, string> | null) ?? {}),
        ),
      })
    : buildCanonicalPayload({
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

  const hasSignature = Boolean(row.signature);

  return { ok: signatureValid, signatureValid, hasSignature, contentHash: row.contentHash };
}

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

    const { value } = await getOrSetDirectPublicCache({
      key: certificateCacheKey(code),
      ttlSeconds: PUBLIC_CERTIFICATE_CACHE_TTL_SECONDS,
      shouldCache: (res) => res.ok && shouldCacheCertificateVerdict(res.verdict.status),
      loader: async () => {
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
              layoutSnapshot: true,
              variableSnapshot: true,
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

        const integrity = await verifyCertificateIntegrity(row.id, row.tenantId);
        const signatureValid = integrity.signatureValid;

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
          signatureValid: integrity.hasSignature ? signatureValid : undefined,
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
            workloadBreakdown: readWorkloadBreakdown(row.workloadBreakdown).entries,
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
      },
    });

    return value;
  } catch (error) {
    logger.error(`[certificates] falha na validação pública: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível validar o certificado.' };
  }
}

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

  const integrity = await verifyCertificateIntegrity(located.id, located.tenantId);

  if (integrity.hasSignature && !integrity.ok) {
    return {
      ok: false as const,
      code: 'NOT_FOUND',
      message: 'Este certificado não passa na conferência de integridade e não pode ser baixado.',
    };
  }

  return getCertificateDownloadUrl({
    tenantId: located.tenantId,
    certificateId: located.id,
    allowAnyUser: true,
  });
}
