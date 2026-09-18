'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Gamificação
 *
 *  A autorização é verificada AQUI, não na página. Esconder o botão não impede a
 *  chamada: uma Server Action é um endpoint HTTP como qualquer outro.
 *
 *  As permissões `:own` recebem posse explícita (`ownerId` = usuário da sessão).
 *  Sem isso, `can()` nega — e a negação é intencional (fail-closed).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { claimMission } from '@/lib/gamification/task-service';
import { setCardPinned } from '@/lib/gamification/card-service';
import { adjustXp } from '@/lib/gamification/xp-service';
import { grantCardForTrigger } from '@/lib/gamification/reward-engine';
import { awardTopReviewers } from '@/lib/gamification/achievement-service';

export interface GamificationActionState {
  ok: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
}

interface GuardResult {
  ok: boolean;
  userId: string;
  tenantId: string;
  principal: Principal | null;
  state?: GamificationActionState;
}

/**
 * Resolve sessão, vínculo e permissão.
 *
 * `requiresOwnership` não é automático aqui: quem chama declara, para que a
 * decisão fique visível no ponto de uso.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ATENÇÃO AO CONSUMIR ESTE RETORNO
 * ─────────────────────────────────────────────────────────────────────────────
 *  `state` existe APENAS no caso de falha. A checagem correta é `if (!auth.ok)`;
 *  escrever `if (!auth.ok || !auth.state)` devolve "Não autorizado" para toda
 *  ação legítima — foi exatamente o que o E2E pegou (o botão de resgate de missão
 *  falhava para um participante com permissão, sem nenhum erro de banco).
 */
async function guard(input: {
  tenantSlug: string;
  permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
  requiresOwnership?: boolean;
}): Promise<GuardResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      userId: '',
      tenantId: '',
      principal: null,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return {
      ok: false,
      userId: user.id,
      tenantId: '',
      principal: null,
      state: { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' },
    };
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return {
      ok: false,
      userId: user.id,
      tenantId: tenant.id,
      principal: null,
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
      userId: user.id,
      tenantId: tenant.id,
      principal,
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: `Permissão negada: ${input.permission}.`,
      },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Resgatar missão
// ───────────────────────────────────────────────────────────────────────────────
const claimSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  taskDefinitionId: z.string().uuid(),
});

export async function claimMissionAction(
  _prev: GamificationActionState | null,
  formData: FormData,
): Promise<GamificationActionState> {
  const parsed = claimSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    taskDefinitionId: formData.get('taskDefinitionId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para resgatar a missão.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.XP_READ_OWN,
    requiresOwnership: true,
  });

  if (!auth.ok) return auth.state ?? { ok: false, message: 'Não autorizado.' };

  const result = await claimMission({
    tenantId: auth.tenantId,
    userId: auth.userId,
    taskDefinitionId: parsed.data.taskDefinitionId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/conquistas'));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/cartas'));

  return {
    ok: true,
    message: result.alreadyClaimed
      ? 'Esta missão já havia sido resgatada.'
      : `Missão resgatada: +${result.xpAwarded} XP.`,
    data: {
      taskName: result.taskName,
      xpAwarded: result.xpAwarded,
      levelAfter: result.reward.levelAfter,
      leveledUp: result.reward.leveledUp,
      prestiged: result.reward.prestiged,
      currentStreak: result.reward.currentStreak,
      cards: result.cards,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Destacar carta
// ───────────────────────────────────────────────────────────────────────────────
const pinSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  userCardId: z.string().uuid(),
  isPinned: z.enum(['true', 'false']).transform((value) => value === 'true'),
});

export async function pinCardAction(
  _prev: GamificationActionState | null,
  formData: FormData,
): Promise<GamificationActionState> {
  const parsed = pinSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    userCardId: formData.get('userCardId'),
    isPinned: formData.get('isPinned') ?? 'true',
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para destacar a carta.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CARD_READ_OWN,
    requiresOwnership: true,
  });

  if (!auth.ok) return auth.state ?? { ok: false, message: 'Não autorizado.' };

  const result = await setCardPinned({
    tenantId: auth.tenantId,
    userId: auth.userId,
    userCardId: parsed.data.userCardId,
    isPinned: parsed.data.isPinned,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/cartas'));

  return {
    ok: true,
    message: parsed.data.isPinned ? 'Carta destacada no seu perfil.' : 'Carta removida do destaque.',
    data: { pinnedCount: result.pinnedCount },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ajuste manual de XP (organização)
// ───────────────────────────────────────────────────────────────────────────────
const adjustSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  userId: z.string().uuid(),
  amount: z.coerce
    .number()
    .int('O ajuste deve ser um número inteiro de XP.')
    .refine((value) => value !== 0, 'O ajuste não pode ser zero.')
    .refine((value) => Math.abs(value) <= 100_000, 'Ajuste acima do limite permitido.'),
  reason: z.string().trim().min(8, 'Descreva o motivo do ajuste (mínimo 8 caracteres).').max(300),
});

/**
 * Ajuste manual de XP.
 *
 * Exige `xp:adjust` e motivo textual: um ajuste sem justificativa é
 * indistinguível de erro ou abuso quando alguém auditar o extrato depois.
 */
export async function adjustXpAction(
  _prev: GamificationActionState | null,
  formData: FormData,
): Promise<GamificationActionState> {
  const parsed = adjustSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    userId: formData.get('userId'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos para o ajuste.',
    };
  }

  const auth = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.XP_ADJUST });
  if (!auth.ok) return auth.state ?? { ok: false, message: 'Não autorizado.' };

  const result = await adjustXp({
    tenantId: auth.tenantId,
    userId: parsed.data.userId,
    amount: parsed.data.amount,
    reason: parsed.data.reason,
    actorId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/conquistas'));

  return {
    ok: true,
    message: `Ajuste registrado: ${parsed.data.amount > 0 ? '+' : ''}${parsed.data.amount} XP.`,
    data: { totalXp: result.outcome.totalXp, levelAfter: result.outcome.levelAfter },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Concessão manual de carta (organização)
// ───────────────────────────────────────────────────────────────────────────────
const grantSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  userId: z.string().uuid(),
  cardTemplateId: z.string().uuid(),
  reason: z.string().trim().min(4).max(300).optional(),
});

export async function grantCardAction(
  _prev: GamificationActionState | null,
  formData: FormData,
): Promise<GamificationActionState> {
  const parsed = grantSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    userId: formData.get('userId'),
    cardTemplateId: formData.get('cardTemplateId'),
    reason: formData.get('reason') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para conceder a carta.' };
  }

  const auth = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.CARD_GRANT });
  if (!auth.ok) return auth.state ?? { ok: false, message: 'Não autorizado.' };

  /**
   * A concessão manual passa pelo MESMO caminho de tiragem das cartas
   * automáticas: respeita nível exigido, janela de disponibilidade e limite de
   * tiragem. Um "passe livre" administrativo criaria cartas além da tiragem e
   * quebraria a escassez que dá valor à coleção.
   */
  const result = await grantCardForTrigger({
    tenantId: auth.tenantId,
    userId: parsed.data.userId,
    trigger: 'MANUAL_GRANT',
    templateId: parsed.data.cardTemplateId,
    sourceRef: parsed.data.reason ?? null,
    actorId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  if (result.cards.length === 0) {
    return {
      ok: false,
      code: 'NOT_GRANTED',
      message:
        'A carta não foi concedida: verifique nível exigido, janela de disponibilidade e tiragem restante.',
    };
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/cartas'));

  return {
    ok: true,
    message: `Carta concedida: ${result.cards[0]?.name ?? ''}.`,
    data: { cards: result.cards },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Revisor destaque do evento (FASE 16, item F1)
// ───────────────────────────────────────────────────────────────────────────────
const topReviewerSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  top: z.coerce.number().int().min(1).max(20).default(1),
});

/**
 * Premia o(s) revisor(es) que mais concluíram pareceres neste evento.
 *
 * O gatilho `REVIEWER_TOP` existia no catálogo e nunca disparava. Ele é MANUAL (e
 * não derivado de um crédito de XP) porque "ser o destaque" é um julgamento sobre o
 * evento inteiro: o comitê encerra, o ranking é calculado e a premiação é um ato —
 * não um efeito colateral de cada parecer enviado.
 *
 * A autorização é `card:grant` (conceder carta), a mesma da concessão manual: quem
 * pode dar uma carta a dedo pode dar a carta de reconhecimento.
 */
export async function awardTopReviewersAction(
  _prev: GamificationActionState | null,
  formData: FormData,
): Promise<GamificationActionState> {
  const parsed = topReviewerSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    top: formData.get('top') ?? 1,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para premiar revisores.' };
  }

  const auth = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.CARD_GRANT });
  if (!auth.ok) return auth.state ?? { ok: false, message: 'Não autorizado.' };

  const result = await awardTopReviewers({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorId: auth.userId,
    top: parsed.data.top,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}`));

  if (result.awarded.length === 0) {
    return {
      ok: false,
      code: 'NO_REVIEWER',
      message: result.reason ?? 'Nenhum revisor elegível ao reconhecimento neste evento.',
    };
  }

  const names = result.awarded
    .map((entry) => `${entry.reviewerName} (${entry.completedReviews} pareceres)`)
    .join(', ');

  return {
    ok: true,
    message: `Reconhecimento concedido a ${names}.`,
    data: { awarded: result.awarded },
  };
}
