'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — QR REPETIDO DO PATROCINADOR (FASE 51 · dívida E57)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA AÇÃO É SEPARADA DE `saveSponsorQrAction`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A criação do QR passou a ter DOIS passos quando o patrocinador já tem código
 *  neste evento, e o segundo passo é uma confirmação explícita. Manter as duas em
 *  uma ação só faria o mesmo endpoint às vezes gravar e às vezes recusar, sem que
 *  a tela tivesse como saber em qual estado está.
 *
 *  Aqui: `saveSponsorQrWithConfirmationAction` é a MESMA régua de
 *  `saveSponsorQrAction`, com o campo `confirmado` a mais — que é justamente o que
 *  o aviso da tela pede. O serviço continua sendo quem decide: sem confirmação, a
 *  criação é recusada com `CONFIRMATION_REQUIRED` e a contagem em `details`.
 *
 *  A autorização é a mesma da gestão do patrocínio (`sponsor:manage`), conferida
 *  AQUI: uma Server Action é um endpoint HTTP como qualquer outro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { sponsorQrInputSchema } from '@/domain/events/sponsor-experience-rules';
import { countSponsorQrCodesInEvent, saveSponsorQrCode } from '@/lib/sponsors/sponsor-portal-service';

export interface SponsorQrConfirmationState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

function nullable(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

const qrFormSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  sponsorId: z.string().uuid(),
  qrId: z.string().uuid().optional(),
  label: z.string().trim().min(3).max(120),
  xpAmount: z.coerce.number().int().min(0).max(500).default(0),
  cardTemplateId: z.string().uuid().optional(),
  consentDays: z.coerce.number().int().min(1).max(365).default(90),
  /** O segundo passo da tela. Só `true` (literal) confirma. */
  confirmado: z.literal('true').optional(),
});

export async function saveSponsorQrWithConfirmationAction(
  _prev: SponsorQrConfirmationState | null,
  formData: FormData,
): Promise<SponsorQrConfirmationState> {
  const parsed = qrFormSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    sponsorId: formData.get('sponsorId'),
    qrId: nullable(formData.get('qrId')) ?? undefined,
    label: formData.get('label'),
    xpAmount: formData.get('xpAmount') || 0,
    cardTemplateId: nullable(formData.get('cardTemplateId')) ?? undefined,
    consentDays: formData.get('consentDays') || 90,
    confirmado: nullable(formData.get('confirmado')) === 'true' ? 'true' : undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique os dados do QR.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const data = parsed.data;

  /** A mesma validação do domínio que os testes usam — não há duas réguas. */
  const domainCheck = sponsorQrInputSchema.safeParse({
    label: data.label,
    xpAmount: data.xpAmount,
    cardTemplateId: data.cardTemplateId,
    consentDays: data.consentDays,
  });

  if (!domainCheck.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'QR inválido.',
      details: domainCheck.error.issues.map((issue) => issue.message),
    };
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: data.tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' };
  }

  const principal: Principal = await loadPrincipal(user.id, tenant.id, 'ACTIVE');

  if (!can(principal, PERMISSIONS.SPONSOR_MANAGE, { scope: 'TENANT' })) {
    return { ok: false, code: 'FORBIDDEN', message: 'Permissão negada: sponsor:manage.' };
  }

  const result = await saveSponsorQrCode({
    tenantId: tenant.id,
    actorId: user.id,
    sponsorId: data.sponsorId,
    eventId: data.eventId,
    ...(data.qrId ? { qrId: data.qrId } : {}),
    label: data.label,
    xpAmount: data.xpAmount,
    cardTemplateId: data.cardTemplateId ?? null,
    consentDays: data.consentDays,
    confirmed: data.confirmado === 'true',
  });

  revalidatePath(tenantPath(data.tenantSlug, '/patrocinador'));
  revalidatePath(tenantPath(data.tenantSlug, `/administracao/eventos/${data.eventId}/patrocinadores`));

  if (!result.ok) {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A RECUSA POR FALTA DE CONFIRMAÇÃO NÃO É ERRO DE DADOS (E57)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Os dados estão certos — falta o segundo passo. A tela usa o código para
     *  mostrar o AVISO com o número, e o mesmo formulário é reenviado com
     *  `confirmado=true`. Devolver `INVALID_INPUT` faria a tela tratar um caso
     *  legítimo como formulário mal preenchido.
     */
    if (result.code === 'CONFIRMATION_REQUIRED') {
      const existing = await countSponsorQrCodesInEvent(tenant.id, data.sponsorId, data.eventId);

      return {
        ok: false,
        code: 'CONFIRMATION_REQUIRED',
        message: result.message,
        details: result.details,
        data: { existingInEvent: existing, needsConfirmation: true },
      };
    }

    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return {
    ok: true,
    message: result.created
      ? `QR criado. O código é ${result.code} — imprima no estande.${
          result.existingInEvent > 1
            ? ` Este patrocinador passou a ter ${result.existingInEvent} QRs neste evento.`
            : ''
        }`
      : 'QR atualizado.',
    data: {
      qrId: result.qrId,
      code: result.code,
      existingInEvent: result.existingInEvent,
    },
  };
}
