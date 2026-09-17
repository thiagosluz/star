'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Painel administrativo
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GUARDA É A MESMA EM TODAS, E NÃO É O MENU
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada ação resolve sessão, vínculo e permissão ANTES de tocar em qualquer dado.
 *  Esconder o botão no painel é conveniência de interface; a barreira é aqui —
 *  uma Server Action é um endpoint HTTP.
 *
 *  As permissões usadas são as da modelagem da FASE 2 (`event:create`,
 *  `activity:create`, `track:manage`, `card-template:manage`, `task:manage`,
 *  `certificate:issue`, `certificate:revoke`, `registration:checkin`), nunca uma
 *  permissão nova inventada para o painel.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { DEFAULT_RUBRIC } from '@/domain/review/review-rules';
import { CARD_RARITIES, CARD_TRIGGERS, TASK_KINDS, XP_SOURCE_KINDS } from '@/domain/gamification/types';
import {
  saveActivity,
  saveEvent,
  saveRoom,
  saveTrack,
} from '@/lib/admin/catalog-service';
import {
  retryCertificateGeneration,
  saveCardTemplate,
  saveMission,
} from '@/lib/admin/gamification-admin-service';
import { checkInByBadgeToken } from '@/lib/events/attendance-service';
import { revokeCertificate } from '@/lib/certificates/certificate-service';

export interface AdminActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

async function guard(input: {
  tenantSlug: string;
  permission: Permission;
}): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: AdminActionState }
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
      state: { ok: false, code: 'FORBIDDEN', message: 'Você não tem vínculo ativo com esta instituição.' },
    };
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, input.permission, { scope: 'TENANT' })) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: `Permissão negada: ${input.permission}.` },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

/** Converte string vazia em `null` — formulário HTML não conhece ausência. */
function nullable(value: FormDataEntryValue | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

function toDate(value: FormDataEntryValue | null): Date | null {
  const text = nullable(value);
  if (!text) return null;

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toInt(value: FormDataEntryValue | null, fallback = 0): number {
  const numeric = Number(typeof value === 'string' ? value : NaN);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Evento, sala, atividade e trilha
// ───────────────────────────────────────────────────────────────────────────────
const eventSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid().optional(),
  slug: z
    .string()
    .trim()
    .min(3, 'O identificador deve ter ao menos 3 caracteres.')
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use apenas minúsculas, números e hífen (sem hífen nas pontas).'),
  title: z.string().trim().min(4, 'O título deve ter ao menos 4 caracteres.').max(200),
  status: z.enum([
    'DRAFT',
    'PUBLISHED',
    'REGISTRATION_OPEN',
    'REGISTRATION_CLOSED',
    'IN_PROGRESS',
    'FINISHED',
    'CANCELED',
    'ARCHIVED',
  ]),
  modality: z.enum(['IN_PERSON', 'ONLINE', 'HYBRID']),
  timezone: z.string().trim().min(3).max(60),
  startsAt: z.string().min(1, 'Informe o início.'),
  endsAt: z.string().min(1, 'Informe o término.'),
});

export async function saveEventAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const parsed = eventSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: nullable(formData.get('eventId')) ?? undefined,
    slug: formData.get('slug'),
    title: formData.get('title'),
    status: formData.get('status'),
    modality: formData.get('modality'),
    timezone: formData.get('timezone'),
    startsAt: formData.get('startsAt'),
    endsAt: formData.get('endsAt'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique os campos do evento.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const auth = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.EVENT_UPDATE });
  if (!auth.ok) return auth.state;

  const result = await saveEvent({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    eventId: parsed.data.eventId,
    slug: parsed.data.slug,
    title: parsed.data.title,
    subtitle: nullable(formData.get('subtitle')),
    summary: nullable(formData.get('summary')),
    description: nullable(formData.get('description')),
    status: parsed.data.status,
    modality: parsed.data.modality,
    startsAt: new Date(parsed.data.startsAt),
    endsAt: new Date(parsed.data.endsAt),
    timezone: parsed.data.timezone,
    capacity: nullable(formData.get('capacity')) ? toInt(formData.get('capacity')) : null,
    venueName: nullable(formData.get('venueName')),
    city: nullable(formData.get('city')),
    state: nullable(formData.get('state')),
    primaryColor: nullable(formData.get('primaryColor')),
    theme: nullable(formData.get('primaryColor')) ? { primaryColor: nullable(formData.get('primaryColor')) } : {},
    registrationOpensAt: toDate(formData.get('registrationOpensAt')),
    registrationClosesAt: toDate(formData.get('registrationClosesAt')),
    cfpOpensAt: toDate(formData.get('cfpOpensAt')),
    cfpClosesAt: toDate(formData.get('cfpClosesAt')),
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/eventos'));

  if (!result.ok) return { ok: false, code: result.code, message: result.message, details: result.details };

  return {
    ok: true,
    message: result.created ? 'Evento criado.' : 'Evento atualizado.',
    data: { eventId: result.eventId },
  };
}

export async function saveRoomAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await guard({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    permission: PERMISSIONS.EVENT_UPDATE,
  });
  if (!auth.ok) return auth.state;

  const eventId = String(formData.get('eventId') ?? '');
  const name = nullable(formData.get('name'));
  const capacity = toInt(formData.get('capacity'), 0);

  if (!z.string().uuid().safeParse(eventId).success || !name) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Informe o nome da sala.' };
  }

  if (capacity <= 0) {
    return { ok: false, code: 'INVALID_INPUT', message: 'A capacidade da sala precisa ser maior que zero.' };
  }

  const result = await saveRoom({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    eventId,
    roomId: nullable(formData.get('roomId')) ?? undefined,
    name,
    capacity,
  });

  revalidatePath(tenantPath(String(formData.get('tenantSlug')), `/administracao/eventos/${eventId}`));

  return result.ok
    ? { ok: true, message: result.created ? 'Sala criada.' : 'Sala atualizada.' }
    : { ok: false, code: result.code, message: result.message };
}

const activitySchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  activityId: z.string().uuid().optional(),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Identificador inválido.'),
  title: z.string().trim().min(4, 'O título deve ter ao menos 4 caracteres.').max(200),
  type: z.enum([
    'LECTURE',
    'MINI_COURSE',
    'WORKSHOP',
    'ROUND_TABLE',
    'HACKATHON',
    'POSTER_SESSION',
    'ORAL_PRESENTATION',
    'CULTURAL',
    'OTHER',
  ]),
  status: z.enum(['DRAFT', 'SCHEDULED', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']),
  modality: z.enum(['IN_PERSON', 'ONLINE', 'HYBRID']),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  workloadMinutes: z.coerce.number().int().min(1).max(10_000),
});

export async function saveActivityAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const parsed = activitySchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    activityId: nullable(formData.get('activityId')) ?? undefined,
    slug: formData.get('slug'),
    title: formData.get('title'),
    type: formData.get('type'),
    status: formData.get('status'),
    modality: formData.get('modality'),
    startsAt: formData.get('startsAt'),
    endsAt: formData.get('endsAt'),
    workloadMinutes: formData.get('workloadMinutes') ?? 60,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique os campos da atividade.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const auth = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.ACTIVITY_CREATE });
  if (!auth.ok) return auth.state;

  const result = await saveActivity({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    eventId: parsed.data.eventId,
    activityId: parsed.data.activityId,
    slug: parsed.data.slug,
    title: parsed.data.title,
    description: nullable(formData.get('description')),
    type: parsed.data.type,
    status: parsed.data.status,
    modality: parsed.data.modality,
    startsAt: new Date(parsed.data.startsAt),
    endsAt: new Date(parsed.data.endsAt),
    workloadMinutes: parsed.data.workloadMinutes,
    capacity: nullable(formData.get('capacity')) ? toInt(formData.get('capacity')) : null,
    waitlistEnabled: formData.get('waitlistEnabled') === 'on',
    roomId: nullable(formData.get('roomId')),
    isFeatured: formData.get('isFeatured') === 'on',
    checkInEnabled: formData.get('checkInEnabled') !== 'off',
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}`));

  return result.ok
    ? { ok: true, message: result.created ? 'Atividade criada.' : 'Atividade atualizada.' }
    : { ok: false, code: result.code, message: result.message, details: result.details };
}

export async function saveTrackAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await guard({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    permission: PERMISSIONS.TRACK_MANAGE,
  });
  if (!auth.ok) return auth.state;

  const eventId = String(formData.get('eventId') ?? '');
  const slug = nullable(formData.get('slug'));
  const name = nullable(formData.get('name'));

  if (!z.string().uuid().safeParse(eventId).success || !slug || !name) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Informe identificador e nome da trilha.' };
  }

  /**
   * A rubrica chega como três listas paralelas (critério, peso, nota máxima).
   *
   * Listas paralelas evitam exigir JSON do organizador — e são validadas campo a
   * campo por `parseRubric`, que recusa peso zero, nota máxima negativa e chaves
   * duplicadas. Vazio significa "use a rubrica padrão".
   */
  const keys = formData.getAll('rubricKey').map(String);
  const labels = formData.getAll('rubricLabel').map(String);
  const weights = formData.getAll('rubricWeight').map(String);
  const maxScores = formData.getAll('rubricMaxScore').map(String);

  const rubric = keys
    .map((key, index) => ({
      key: key.trim(),
      label: (labels[index] ?? key).trim(),
      weight: Number(weights[index] ?? 1),
      maxScore: Number(maxScores[index] ?? 10),
    }))
    .filter((criterion) => criterion.key.length > 0);

  const result = await saveTrack({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    eventId,
    trackId: nullable(formData.get('trackId')) ?? undefined,
    slug,
    name,
    description: nullable(formData.get('description')),
    color: nullable(formData.get('color')),
    maxSubmissionsPerAuthor: toInt(formData.get('maxSubmissionsPerAuthor'), 0),
    requiresBlindReview: formData.get('requiresBlindReview') !== 'off',
    rubric: rubric.length > 0 ? rubric : DEFAULT_RUBRIC,
    requiredReviews: Math.max(1, toInt(formData.get('requiredReviews'), 2)),
    acceptanceThreshold: toInt(formData.get('acceptanceThreshold'), 70),
    rejectThreshold: toInt(formData.get('rejectThreshold'), 45),
    isActive: formData.get('isActive') !== 'off',
  });

  revalidatePath(tenantPath(String(formData.get('tenantSlug')), `/administracao/eventos/${eventId}`));

  if (!result.ok) return { ok: false, code: result.code, message: result.message, details: result.details };

  return {
    ok: true,
    message: `${result.created ? 'Trilha criada' : 'Trilha atualizada'}.${result.rubricWarning ? ` ${result.rubricWarning}` : ''}`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cartas e missões
// ───────────────────────────────────────────────────────────────────────────────
export async function saveCardTemplateAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await guard({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    permission: PERMISSIONS.CARD_TEMPLATE_MANAGE,
  });
  if (!auth.ok) return auth.state;

  const slug = nullable(formData.get('slug'));
  const name = nullable(formData.get('name'));
  const rarity = String(formData.get('rarity') ?? '');
  const trigger = String(formData.get('trigger') ?? '');

  if (!slug || !name) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Informe identificador e nome da carta.' };
  }

  if (!(CARD_RARITIES as readonly string[]).includes(rarity)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Raridade inválida.' };
  }

  if (!(CARD_TRIGGERS as readonly string[]).includes(trigger)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Gatilho inválido.' };
  }

  /**
   * Condição extra do gatilho: limiar de XP, marco de ofensiva ou nível.
   *
   * Só é gravada quando o gatilho realmente usa condição — guardar um `threshold`
   * em uma carta de check-in não faria mal, mas confundiria quem ler o cadastro
   * depois.
   */
  const condition: Record<string, unknown> = {};
  if (trigger === 'XP_THRESHOLD') condition.threshold = toInt(formData.get('conditionThreshold'), 0);
  if (trigger === 'STREAK') condition.streak = toInt(formData.get('conditionStreak'), 0);
  if (trigger === 'LEVEL_UP') condition.level = toInt(formData.get('conditionLevel'), 1);

  const result = await saveCardTemplate({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    cardTemplateId: nullable(formData.get('cardTemplateId')) ?? undefined,
    eventId: nullable(formData.get('eventId')),
    slug,
    name,
    description: nullable(formData.get('description')),
    lore: nullable(formData.get('lore')),
    rarity: rarity as never,
    trigger: trigger as never,
    triggerCondition: condition,
    levelRequired: Math.max(1, toInt(formData.get('levelRequired'), 1)),
    dropWeight: Math.max(1, toInt(formData.get('dropWeight'), 100)),
    maxSupply: Math.max(0, toInt(formData.get('maxSupply'), 0)),
    isActive: formData.get('isActive') !== 'off',
    isSecret: formData.get('isSecret') === 'on',
    palette: {
      primary: nullable(formData.get('palettePrimary')),
      secondary: nullable(formData.get('paletteSecondary')),
      glow: nullable(formData.get('paletteGlow')),
      text: nullable(formData.get('paletteText')),
    },
    art: {
      imageUrl: nullable(formData.get('artImageUrl')),
      animation: nullable(formData.get('artAnimation')) ?? 'none',
      particle: nullable(formData.get('artParticle')) ?? 'none',
    },
  });

  revalidatePath(tenantPath(String(formData.get('tenantSlug')), '/administracao/cartas'));

  return result.ok
    ? { ok: true, message: result.created ? 'Carta criada.' : 'Carta atualizada.' }
    : { ok: false, code: result.code, message: result.message, details: result.details };
}

export async function saveMissionAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await guard({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    permission: PERMISSIONS.TASK_MANAGE,
  });
  if (!auth.ok) return auth.state;

  const slug = nullable(formData.get('slug'));
  const name = nullable(formData.get('name'));
  const kind = String(formData.get('kind') ?? '');
  const trigger = String(formData.get('trigger') ?? '');

  if (!slug || !name) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Informe identificador e nome da missão.' };
  }

  if (!(TASK_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Tipo de missão inválido.' };
  }

  if (!(XP_SOURCE_KINDS as readonly string[]).includes(trigger)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Gatilho inválido.' };
  }

  const result = await saveMission({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    taskDefinitionId: nullable(formData.get('taskDefinitionId')) ?? undefined,
    eventId: nullable(formData.get('eventId')),
    slug,
    name,
    description: nullable(formData.get('description')),
    kind: kind as never,
    trigger: trigger as never,
    target: {
      count: Math.max(1, toInt(formData.get('targetCount'), 1)),
      activityType: nullable(formData.get('targetActivityType')),
      minutes: nullable(formData.get('targetMinutes')) ? toInt(formData.get('targetMinutes')) : null,
    },
    xpReward: Math.max(0, toInt(formData.get('xpReward'), 0)),
    rewardCardTemplateId: nullable(formData.get('rewardCardTemplateId')),
    repeatEveryHours: Math.max(0, toInt(formData.get('repeatEveryHours'), 0)),
    isActive: formData.get('isActive') !== 'off',
    isVisible: formData.get('isVisible') !== 'off',
    displayOrder: toInt(formData.get('displayOrder'), 0),
  });

  revalidatePath(tenantPath(String(formData.get('tenantSlug')), '/administracao/missoes'));

  return result.ok
    ? { ok: true, message: result.created ? 'Missão criada.' : 'Missão atualizada.' }
    : { ok: false, code: result.code, message: result.message, details: result.details };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Certificados (reprocessar e revogar)
// ───────────────────────────────────────────────────────────────────────────────
export async function retryCertificateAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await guard({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    permission: PERMISSIONS.CERTIFICATE_ISSUE,
  });
  if (!auth.ok) return auth.state;

  const certificateId = String(formData.get('certificateId') ?? '');
  if (!z.string().uuid().safeParse(certificateId).success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Certificado inválido.' };
  }

  const result = await retryCertificateGeneration({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    certificateId,
  });

  revalidatePath(tenantPath(String(formData.get('tenantSlug')), '/administracao/certificados'));

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  return {
    ok: true,
    message: result.generated
      ? 'Certificado gerado agora.'
      : result.queued
        ? 'Certificado enviado para a fila de geração.'
        : 'Certificado já estava emitido.',
  };
}

export async function revokeCertificateAdminAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await guard({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    permission: PERMISSIONS.CERTIFICATE_REVOKE,
  });
  if (!auth.ok) return auth.state;

  const certificateId = String(formData.get('certificateId') ?? '');
  const reason = nullable(formData.get('reason'));

  if (!z.string().uuid().safeParse(certificateId).success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Certificado inválido.' };
  }

  if (!reason || reason.length < 8) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Descreva o motivo da revogação (mínimo 8 caracteres).' };
  }

  const result = await revokeCertificate({ tenantId: auth.tenantId, certificateId, reason });

  revalidatePath(tenantPath(String(formData.get('tenantSlug')), '/administracao/certificados'));

  return result.ok
    ? { ok: true, message: 'Certificado revogado.' }
    : { ok: false, code: result.code, message: result.message };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Credenciamento por crachá (leitor de QR Code)
// ───────────────────────────────────────────────────────────────────────────────
export async function checkInByBadgeAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await guard({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    permission: PERMISSIONS.REGISTRATION_CHECKIN,
  });
  if (!auth.ok) return auth.state;

  const badgeToken = nullable(formData.get('badgeToken'));
  if (!badgeToken) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Informe o código do crachá.' };
  }

  const result = await checkInByBadgeToken({
    tenantId: auth.tenantId,
    badgeToken,
    staffUserId: auth.userId,
  });

  revalidatePath(tenantPath(String(formData.get('tenantSlug')), '/credenciamento'));

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  if (result.alreadyCheckedIn) {
    return { ok: true, message: 'Este crachá já havia sido credenciado.' };
  }

  const xp = result.reward?.xpAwarded ?? 0;

  return {
    ok: true,
    message: xp > 0 ? `Entrada registrada pelo crachá. +${xp} XP.` : 'Entrada registrada pelo crachá.',
    data: {
      registrationId: result.registrationId,
      xpAwarded: xp,
      cards: result.reward?.cards ?? [],
    },
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ATENÇÃO: ARQUIVO 'use server' SÓ EXPORTA FUNÇÃO ASSÍNCRONA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Este arquivo teve, por engano, um helper síncrono (`newFormKey`) exportado. O
 *  `tsc` e o ESLint passaram; o `next build` recusou ("Server Actions must be async
 *  functions"). E como o `docker compose up --build` preserva o container anterior
 *  quando o build falha, o efeito visível foi um 404 na rota nova — com o processo
 *  parecendo saudável. Toda função utilitária deste arquivo precisa ser `async`.
 */
