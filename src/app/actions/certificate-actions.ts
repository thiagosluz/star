'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Certificação
 *
 *  Três operações, três públicos:
 *    • `requestMyCertificateAction`  — o participante pede o PRÓPRIO certificado;
 *    • `issueEventCertificatesAction` — a equipe emite em lote para o evento;
 *    • `revokeCertificateAction`      — a equipe revoga (fraude comprovada).
 *
 *  A autorização é verificada aqui, não na página: uma Server Action é um endpoint
 *  HTTP como qualquer outro, e esconder botão nunca foi controle de acesso.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { CERTIFICATE_KINDS, type CertificateKind } from '@/domain/certificates/certificate-rules';
import {
  issueCertificate,
  requestEventCertificates,
  revokeCertificate,
  getCertificateDownloadUrl,
} from '@/lib/certificates/certificate-service';

export interface CertificateActionState {
  ok: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
}

async function guard(input: {
  tenantSlug: string;
  permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
  requiresOwnership?: boolean;
}): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: CertificateActionState }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return { ok: false, state: { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' } };
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return {
      ok: false,
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Você não tem vínculo ativo com esta instituição.',
      },
    };
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  const allowed = can(
    principal,
    input.permission,
    { scope: 'TENANT' },
    input.requiresOwnership ? { ownerId: user.id } : undefined,
  );

  if (!allowed) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: `Permissão negada: ${input.permission}.` },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Participante: pedir o próprio certificado
// ───────────────────────────────────────────────────────────────────────────────
const requestSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  kind: z.enum(CERTIFICATE_KINDS as unknown as [CertificateKind, ...CertificateKind[]]),
  activityId: z.string().uuid().optional(),
});

export async function requestMyCertificateAction(
  _prev: CertificateActionState | null,
  formData: FormData,
): Promise<CertificateActionState> {
  const parsed = requestSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    kind: formData.get('kind'),
    activityId: (formData.get('activityId') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para emitir o certificado.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_READ_OWN,
    requiresOwnership: true,
  });

  if (!auth.ok) return auth.state;

  /**
   * O certificado é SEMPRE do usuário da sessão. Não existe parâmetro `userId`
   * vindo do formulário: aceitar um id de terceiro permitiria emitir certificado
   * de presença para quem nunca apareceu.
   */
  const result = await issueCertificate({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    userId: auth.userId,
    kind: parsed.data.kind,
    activityId: parsed.data.activityId ?? null,
    actorId: auth.userId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/certificados'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: result.generated
      ? 'Certificado emitido e pronto para download.'
      : result.existing
        ? 'Certificado já emitido — veja a lista abaixo.'
        : 'Certificado em processamento. Recarregue em alguns instantes.',
    data: {
      certificateId: result.certificateId,
      validationCode: result.validationCode,
      generated: result.generated,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Equipe: emissão em lote
// ───────────────────────────────────────────────────────────────────────────────
const batchSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  kinds: z.string().trim().min(1),
});

export async function issueEventCertificatesAction(
  _prev: CertificateActionState | null,
  formData: FormData,
): Promise<CertificateActionState> {
  const parsed = batchSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    kinds: formData.getAll('kinds').join(','),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione o evento e ao menos um tipo.' };
  }

  const kinds = parsed.data.kinds
    .split(',')
    .map((kind) => kind.trim().toUpperCase())
    .filter((kind): kind is CertificateKind => (CERTIFICATE_KINDS as readonly string[]).includes(kind));

  if (kinds.length === 0) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione ao menos um tipo de certificado.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_ISSUE,
  });

  if (!auth.ok) return auth.state;

  const result = await requestEventCertificates({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    kinds,
    actorId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  /**
   * A geração do arquivo é enfileirada em seguida — ou feita na hora, se a fila
   * estiver indisponível. O lote pode ser grande, então cada certificado é
   * processado uma vez (o `jobId` é o id do certificado e evita duplicidade).
   */
  let generated = 0;

  for (const certificate of result.certificates) {
    const issued = await issueCertificate({
      tenantId: auth.tenantId,
      eventId: parsed.data.eventId,
      userId: certificate.userId,
      kind: certificate.kind,
      actorId: auth.userId,
    });

    if (issued.ok && issued.generated) generated += 1;
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/certificados'));

  return {
    ok: true,
    message: `${result.requested} certificado(s) solicitado(s) — ${generated} gerado(s) agora, o restante na fila.${
      result.skipped > 0 ? ` ${result.skipped} participante(s) não elegível(is).` : ''
    }`,
    data: { requested: result.requested, skipped: result.skipped, generated },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Equipe: revogação
// ───────────────────────────────────────────────────────────────────────────────
const revokeSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  certificateId: z.string().uuid(),
  reason: z.string().trim().min(8, 'Descreva o motivo da revogação (mínimo 8 caracteres).').max(400),
});

export async function revokeCertificateAction(
  _prev: CertificateActionState | null,
  formData: FormData,
): Promise<CertificateActionState> {
  const parsed = revokeSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    certificateId: formData.get('certificateId'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos para revogar.',
    };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_REVOKE,
  });

  if (!auth.ok) return auth.state;

  const result = await revokeCertificate({
    tenantId: auth.tenantId,
    certificateId: parsed.data.certificateId,
    reason: parsed.data.reason,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/certificados'));

  return {
    ok: true,
    message: 'Certificado revogado. A página pública passará a exibir o documento como inválido.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Download autenticado (o público é a rota por código)
// ───────────────────────────────────────────────────────────────────────────────
export async function requestCertificateDownloadAction(
  _prev: CertificateActionState | null,
  formData: FormData,
): Promise<CertificateActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      certificateId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      certificateId: formData.get('certificateId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para o download.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_READ_OWN,
    requiresOwnership: true,
  });

  if (!auth.ok) return auth.state;

  const result = await getCertificateDownloadUrl({
    tenantId: auth.tenantId,
    certificateId: parsed.data.certificateId,
    userId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return { ok: true, message: 'Download pronto.', data: { url: result.url, fileName: result.fileName } };
}
