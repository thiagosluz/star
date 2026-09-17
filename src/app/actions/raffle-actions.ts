'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Sorteios
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A APURAÇÃO É UMA ACTION SEPARADA DA CRIAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Criar o sorteio é configuração; APURAR é o ato público. Separar as duas
 *  permite ao organizador montar o sorteio com calma, conferir a lista de
 *  elegíveis e só então executar — e é o que torna possível recusar uma segunda
 *  apuração sem afetar a configuração.
 *
 *  A autorização exige `event:manage` (e não `event:update`): sortear afeta
 *  PESSOAS e produz resultado auditável, então fica com quem responde pelo evento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { RAFFLE_SCOPES, type RaffleScope } from '@/domain/raffles/raffle-rules';
import {
  cancelRaffle,
  createRaffle,
  drawRaffle,
  previewEligibility,
} from '@/lib/raffles/raffle-service';

export interface RaffleActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

async function guard(tenantSlug: string): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: RaffleActionState }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
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
      state: { ok: false, code: 'FORBIDDEN', message: 'Você não tem vínculo ativo com esta instituição.' },
    };
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, PERMISSIONS.EVENT_MANAGE, { scope: 'TENANT' })) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: 'Permissão negada: event:manage.' },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

function toDateOnly(value: FormDataEntryValue | null): Date | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;

  // `<input type="date">` devolve `AAAA-MM-DD`; interpretamos ao meio-dia UTC para
  // que nenhum fuso desloque a data para o dia anterior.
  const date = new Date(`${text}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Prévia (somente leitura, mas exige a mesma permissão)
// ───────────────────────────────────────────────────────────────────────────────
const previewSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  scope: z.enum(RAFFLE_SCOPES as unknown as [RaffleScope, ...RaffleScope[]]),
  activityId: z.string().uuid().optional(),
  referenceDate: z.string().trim().optional(),
  minAttendanceMinutes: z.coerce.number().int().min(0).max(1440).default(0),
  winnersCount: z.coerce.number().int().min(1).max(500).default(1),
  allowPriorEventWinners: z.coerce.boolean().optional().default(false),
});

/**
 * Calcula os elegíveis SEM sortear.
 *
 * Existe para que a conferência aconteça ANTES do sorteio: no palco, descobrir que
 * a lista estava errada já não tem volta.
 */
export async function previewRaffleAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = previewSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    scope: formData.get('scope'),
    activityId: (formData.get('activityId') as string) || undefined,
    referenceDate: (formData.get('referenceDate') as string) || undefined,
    minAttendanceMinutes: formData.get('minAttendanceMinutes') ?? 0,
    winnersCount: formData.get('winnersCount') ?? 1,
    allowPriorEventWinners: formData.get('allowPriorEventWinners') === 'on',
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique os parâmetros do sorteio.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const result = await previewEligibility({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    config: {
      scope: parsed.data.scope,
      referenceDate: toDateOnly(parsed.data.referenceDate ?? null),
      activityId: parsed.data.activityId ?? null,
      minAttendanceMinutes: parsed.data.minAttendanceMinutes,
      winnersCount: parsed.data.winnersCount,
      allowPriorEventWinners: parsed.data.allowPriorEventWinners,
    },
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: result.preview.readiness.message,
    data: {
      eligibleCount: result.preview.eligible.length,
      inspectedAttendances: result.preview.inspectedAttendances,
      canDraw: result.preview.readiness.canDraw,
      willDraw: result.preview.readiness.willDraw,
      shortfall: result.preview.readiness.shortfall,
      eligible: result.preview.eligible.slice(0, 100).map((entry) => ({
        userId: entry.userId,
        userName: entry.userName,
        minutes: entry.minutes,
      })),
      rejected: result.preview.rejected.slice(0, 50),
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criação + apuração em um passo (o fluxo da tela)
// ───────────────────────────────────────────────────────────────────────────────
const drawSchema = previewSchema.extend({
  title: z.string().trim().min(3, 'Dê um nome ao sorteio (mínimo 3 caracteres).').max(200),
  description: z.string().trim().max(2000).optional(),
});

/**
 * Cria e apura o sorteio de uma vez.
 *
 * É o fluxo real do palco: o organizador define o recorte, confere a prévia e
 * executa. As duas operações continuam separadas no serviço (a criação grava o
 * `DRAFT` com a configuração), mas a tela não obriga a dois envios.
 */
export async function createAndDrawRaffleAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = drawSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    title: formData.get('title'),
    description: (formData.get('description') as string) || undefined,
    scope: formData.get('scope'),
    activityId: (formData.get('activityId') as string) || undefined,
    referenceDate: (formData.get('referenceDate') as string) || undefined,
    minAttendanceMinutes: formData.get('minAttendanceMinutes') ?? 0,
    winnersCount: formData.get('winnersCount') ?? 1,
    allowPriorEventWinners: formData.get('allowPriorEventWinners') === 'on',
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique os dados do sorteio.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const created = await createRaffle({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorId: auth.userId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    scope: parsed.data.scope,
    referenceDate: toDateOnly(parsed.data.referenceDate ?? null),
    activityId: parsed.data.activityId ?? null,
    minAttendanceMinutes: parsed.data.minAttendanceMinutes,
    winnersCount: parsed.data.winnersCount,
    allowPriorEventWinners: parsed.data.allowPriorEventWinners,
  });

  if (!created.ok) {
    return { ok: false, code: created.code, message: created.message, details: created.details };
  }

  const drawn = await drawRaffle({
    tenantId: auth.tenantId,
    raffleId: created.raffleId,
    actorId: auth.userId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/sorteios`));

  if (!drawn.ok) {
    /**
     * A configuração FOI criada, mas a apuração não pôde acontecer (tipicamente
     * nenhum elegível). O sorteio permanece como `DRAFT` para ser conferido e
     * apurado depois — em vez de desaparecer e obrigar a redigitar tudo.
     */
    return {
      ok: false,
      code: drawn.code,
      message: drawn.message,
      data: { raffleId: created.raffleId, status: 'DRAFT' },
    };
  }

  return {
    ok: true,
    message:
      drawn.shortfall > 0
        ? `${drawn.winners.length} vencedor(es) sorteados entre ${drawn.eligibleCount} elegíveis (faltaram ${drawn.shortfall} para o pedido).`
        : `${drawn.winners.length} vencedor(es) sorteados entre ${drawn.eligibleCount} elegíveis.`,
    data: {
      raffleId: drawn.raffleId,
      eligibleCount: drawn.eligibleCount,
      inspectedAttendances: drawn.inspectedAttendances,
      resultHash: drawn.resultHash,
      drawnAt: drawn.drawnAt.toISOString(),
      shortfall: drawn.shortfall,
      winners: drawn.winners,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Apuração de um sorteio já configurado
// ───────────────────────────────────────────────────────────────────────────────
export async function drawRaffleAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      raffleId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      raffleId: formData.get('raffleId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para a apuração.' };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const drawn = await drawRaffle({
    tenantId: auth.tenantId,
    raffleId: parsed.data.raffleId,
    actorId: auth.userId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/sorteios`));

  if (!drawn.ok) {
    return { ok: false, code: drawn.code, message: drawn.message };
  }

  return {
    ok: true,
    message: `${drawn.winners.length} vencedor(es) sorteados entre ${drawn.eligibleCount} elegíveis.`,
    data: {
      raffleId: drawn.raffleId,
      eligibleCount: drawn.eligibleCount,
      resultHash: drawn.resultHash,
      shortfall: drawn.shortfall,
      winners: drawn.winners,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cancelamento
// ───────────────────────────────────────────────────────────────────────────────
export async function cancelRaffleAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      raffleId: z.string().uuid(),
      reason: z.string().trim().min(8, 'Descreva o motivo (mínimo 8 caracteres).').max(400),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      raffleId: formData.get('raffleId'),
      reason: formData.get('reason'),
    });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos.',
    };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const result = await cancelRaffle({
    tenantId: auth.tenantId,
    raffleId: parsed.data.raffleId,
    actorId: auth.userId,
    reason: parsed.data.reason,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/sorteios`));

  return result.ok
    ? { ok: true, message: 'Sorteio cancelado.' }
    : { ok: false, code: result.code, message: result.message };
}
