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
import { revalidatePath, revalidateTag } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { PUBLIC_TENANTS_TAG } from '@/lib/platform/directory-service';
import { DEFAULT_RUBRIC } from '@/domain/review/review-rules';
import { buildRubricFromRows } from '@/domain/review/review-rules';
import { CARD_RARITIES, CARD_TRIGGERS, TASK_KINDS, XP_SOURCE_KINDS } from '@/domain/gamification/types';
import {
  deleteActivity,
  deleteRoom,
  saveActivity,
  saveEvent,
  saveRoom,
  saveTrack,
} from '@/lib/admin/catalog-service';
import {
  deleteCardTemplate,
  deleteMission,
  retryCertificateGeneration,
  saveCardTemplate,
  saveMission,
} from '@/lib/admin/gamification-admin-service';
import { checkInByBadgeToken } from '@/lib/events/attendance-service';
import { revokeCertificate } from '@/lib/certificates/certificate-service';
import { confirmRegistration } from '@/lib/events/confirmation-service';
import { resolveConfirmationItem } from '@/lib/events/confirmation-service';

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

/**
 * Inteiro OPCIONAL: campo vazio vira `null`, e não `0`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO REUSAR `toInt(..., 0)`
 * ─────────────────────────────────────────────────────────────────────────────
 *  "Vazio" e "zero" são afirmações diferentes, e o campo de capacidade da sala é o
 *  caso em que a diferença importa: em branco significa "sem limite definido"
 *  (`null`), e não "não cabe ninguém". Com o `fallback = 0` genérico, quem deixasse
 *  o campo vazio gravaria zero — e a sala afirmaria o oposto do que a pessoa quis
 *  dizer.
 */
function toOptionalInt(value: FormDataEntryValue | null): number | null {
  const text = nullable(value);
  if (text === null) return null;

  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
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
    // FASE 12 (item I3): sem marcar, a inscrição segue aberta a qualquer conta —
    // o padrão desde a FASE 10. A caixa vem do formulário do painel.
    registrationRequiresMembership: formData.get('registrationRequiresMembership') === 'on',
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/eventos'));

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A VITRINE PÚBLICA MUDA QUANDO UM EVENTO É PUBLICADO (FASE 9)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O diretório ordena as instituições por VOLUME DE EVENTOS ABERTOS, e essa
   *  contagem é cacheada. Publicar um evento muda a ordem da vitrine — sem esta
   *  invalidação, a instituição que acabou de abrir inscrições continuaria
   *  aparecendo depois das outras por até cinco minutos.
   *
   *  A invalidação só acontece quando o status é de evento ABERTO: rascunho não
   *  aparece no diretório, e invalidar por rascunho seria trabalho sem efeito.
   */
  if (parsed.data.status === 'PUBLISHED' || parsed.data.status === 'REGISTRATION_OPEN') {
    revalidateTag(PUBLIC_TENANTS_TAG, 'max');
    revalidatePath('/organizacoes');
  }

  if (!result.ok) return { ok: false, code: result.code, message: result.message, details: result.details };

  return {
    ok: true,
    message: result.created ? 'Evento criado.' : 'Evento atualizado.',
    data: { eventId: result.eventId },
  };
}

/**
 * Cria ou edita uma sala (revisão da FASE 3).
 *
 * `roomId` presente = edição. A capacidade é OPCIONAL: em branco, a sala não declara
 * limite, e quem limita é a lotação da atividade. A validação de forma fica aqui
 * (nome, negativos explícitos) e a de REGRA fica no serviço — reduzir a capacidade
 * abaixo do que as atividades já usam é recusado lá, com o número que impede.
 */
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
  const capacity = toOptionalInt(formData.get('capacity'));

  if (!z.string().uuid().safeParse(eventId).success || !name) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Informe o nome da sala.' };
  }

  if (capacity !== null && capacity < 0) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A capacidade da sala não pode ser negativa. Deixe em branco para uma sala sem limite.',
    };
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

/**
 * Exclui uma sala (revisão da FASE 3).
 *
 * Mesma permissão da criação: quem monta a programação é quem corrige o cadastro. A
 * recusa quando a sala está em uso vem do serviço, com a contagem e o caminho
 * (trocar a sala das atividades) — a exclusão de uma sala referenciada apagaria a
 * referência em silêncio, porque a FK é `ON DELETE SET NULL`.
 */
export async function deleteRoomAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      roomId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      roomId: formData.get('roomId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });
  if (!auth.ok) return auth.state;

  const result = await deleteRoom({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    eventId: parsed.data.eventId,
    roomId: parsed.data.roomId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}`));

  return result.ok
    ? { ok: true, message: `Sala “${result.name}” excluída.` }
    : { ok: false, code: result.code, message: result.message };
}

/**
 * Lê as exigências da confirmação de vaga do formulário (FASE 34, `required` na FASE 37).
 *
 * As linhas chegam em LISTAS PARALELAS (`requirementKind[]`, `requirementLabel[]`,
 * `requirementNote[]`), como a rubrica da chamada (FASE 33) e a autoria da submissão
 * (FASE 17): é o que permite adicionar e remover linhas na tela sem indexar nomes de
 * campo. Linha sem descrição é DESCARTADA aqui — o domínio recusaria a lista inteira
 * por causa de uma linha em branco que o organizador nem viu.
 *
 * ─── A OBRIGATORIEDADE VEM COMO ÍNDICES, NÃO COMO LISTA PARALELA ──────────────
 *  Uma caixa marcada manda UM valor (o índice da linha) e uma desmarcada não manda
 *  nada — diferente dos campos de texto, que mandam vazio. Ler `requirementRequired`
 *  como lista paralela faria a marcação escorregar de linha na primeira vez que alguém
 *  deixasse uma em branco no meio (as listas teriam tamanhos diferentes). O índice é a
 *  chave, e ele resolve isso de uma vez.
 */
function readConfirmationRequirements(
  formData: FormData,
): { kind: string; label: string; note: string; required: boolean }[] {
  const kinds = formData.getAll('requirementKind').map((value) => String(value));
  const labels = formData.getAll('requirementLabel').map((value) => String(value));
  const notes = formData.getAll('requirementNote').map((value) => String(value));
  const requiredIndexes = new Set(formData.getAll('requirementRequired').map((value) => String(value)));

  const rows: { kind: string; label: string; note: string; required: boolean }[] = [];

  for (let index = 0; index < labels.length; index += 1) {
    const label = (labels[index] ?? '').trim();
    if (!label) continue;

    rows.push({
      kind: (kinds[index] ?? '').trim(),
      label,
      note: (notes[index] ?? '').trim(),
      required: requiredIndexes.has(String(index)),
    });
  }

  return rows;
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
    /**
     * A caixa vem marcada por padrão (inscrição individual). O domínio aplica o
     * padrão do tipo quando o valor não chega — assim um cliente que não conhece o
     * campo (a API interna, um teste) continua criando atividade coerente.
     */
    requiresRegistration: formData.get('requiresRegistration') === 'on',
    /**
     * ─── Confirmação de vaga com prazo (FASE 34) ──────────────────────────────
     * O organizador escolhe no cadastro da atividade. Ausente/`AUTO` = a vaga é
     * confirmada no ato da inscrição, e nada mais nesta fase se aplica.
     */
    confirmationPolicy: formData.get('confirmationPolicy') === 'REQUIRED' ? 'REQUIRED' : 'AUTO',
    confirmationWindowDays: nullable(formData.get('confirmationWindowDays'))
      ? toInt(formData.get('confirmationWindowDays'))
      : null,
    confirmationRequirements: readConfirmationRequirements(formData),
    confirmationPlace: nullable(formData.get('confirmationPlace')),
    confirmationInstructions: nullable(formData.get('confirmationInstructions')),
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}`));
  // A programação pública e a página do evento mudam quando a atividade muda.
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/eventos'), 'layout');

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  /**
   * A atividade ABERTA alcança quem já estava inscrito no evento — e a mensagem
   * diz quantos entraram: "aberta a todos" precisa dizer a quantos.
   */
  const automatic =
    result.autoEnrolled > 0
      ? ` ${result.autoEnrolled} inscrição(ões) do evento foram incluídas automaticamente.`
      : '';

  return {
    ok: true,
    message: `${result.created ? 'Atividade criada.' : 'Atividade atualizada.'}${automatic}`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Confirmação de vaga (FASE 34)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Registra a confirmação de uma vaga, pela EQUIPE.
 *
 * A permissão é `registration:update:any` — a mesma de quem corrige uma inscrição
 * pelo painel, e não uma permissão nova: confirmar é atualizar a situação de uma
 * inscrição que a pessoa já fez. Quem confirma é a equipe (decisão do humano nesta
 * fase), então não há caminho de autosserviço: o `actorId` vem da sessão e vai para a
 * trilha, que é o que responde "quem recebeu este pagamento?" depois.
 */
export async function confirmRegistrationAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      registrationId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      registrationId: formData.get('registrationId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Confirmação inválida.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_UPDATE_ANY,
  });
  if (!auth.ok) return auth.state;

  const request = await headers();

  const result = await confirmRegistration({
    tenantId: auth.tenantId,
    registrationId: parsed.data.registrationId,
    actorId: auth.userId,
    ipAddress: request.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.get('user-agent'),
  });

  /**
   * A fila PRECISA ser relida: a linha confirmada sai dos pendentes e entra nos
   * confirmados, e o contador da atividade muda. Sem a releitura a tela continuaria
   * oferecendo "Confirmar" para quem já foi confirmado — e o segundo clique receberia
   * "já confirmada", que parece defeito.
   */
  revalidatePath(
    tenantPath(
      parsed.data.tenantSlug,
      `/administracao/eventos/${parsed.data.eventId}/confirmacoes`,
    ),
  );
  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}`));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: `Vaga de ${result.personName} em “${result.activityTitle}” confirmada.${
      result.emailQueued ? ' O aviso foi enviado por e-mail.' : ''
    }`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Confirmação POR ITEM (FASE 37 — dívida E48)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Marca UM item do checklist da inscrição: recebido ou dispensado pela organização.
 *
 * A permissão é a MESMA de confirmar a vaga (`registration:update:any`): quem recebe o
 * item no balcão é quem confirma a vaga, e separar as duas permissões criaria o caso
 * absurdo de alguém poder dizer "recebi o alimento" sem poder dizer "a vaga está dele".
 *
 * Quando esta marcação fecha o checklist, o SERVIÇO confirma a vaga pelo caminho de
 * sempre — e o retorno diz isso à tela, para o balcão saber que não precisa clicar mais
 * nada (`autoConfirmed`).
 */
export async function resolveConfirmationItemAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      registrationId: z.string().uuid(),
      itemId: z.string().uuid(),
      status: z.enum(['RECEIVED', 'WAIVED']),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      registrationId: formData.get('registrationId'),
      itemId: formData.get('itemId'),
      status: formData.get('status'),
      note: (formData.get('note') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Item inválido.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_UPDATE_ANY,
  });
  if (!auth.ok) return auth.state;

  const request = await headers();

  const result = await resolveConfirmationItem({
    tenantId: auth.tenantId,
    registrationId: parsed.data.registrationId,
    itemId: parsed.data.itemId,
    status: parsed.data.status,
    actorId: auth.userId,
    note: parsed.data.note ?? null,
    ipAddress: request.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.get('user-agent'),
  });

  /**
   * A releitura é obrigatória mesmo quando nada visual mudou: o checklist daquela
   * inscrição mudou de estado. E quando a vaga se confirma sozinha, a LINHA MUDA DE
   * LISTA (sai de pendentes, entra em confirmadas) — sem revalidar, o balcão veria a
   * vaga ainda pendente com o checklist completo (armadilha 76 ao contrário: a tela
   * precisa refletir o fato que a action acabou de gravar).
   */
  revalidatePath(
    tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/confirmacoes`),
  );
  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}`));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  const verb = result.status === 'RECEIVED' ? 'recebido' : 'dispensado pela organização';

  return {
    ok: true,
    message: result.autoConfirmed
      ? `“${result.label}” ${verb}. ${result.summary} — a vaga foi CONFIRMADA automaticamente.`
      : `“${result.label}” ${verb}. ${result.summary}${
          result.missingMessage ? ` · ${result.missingMessage}` : ''
        }`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Exclusão de atividade (revisão da FASE 3)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Exclui uma atividade — recusando quando já há gente inscrita ou presença.
 *
 * A permissão é a mesma da criação (`activity:create`): quem monta a programação é
 * quem corrige o cadastro. O serviço decide pelo domínio e a mensagem de recusa
 * chega pronta, com a contagem e o caminho alternativo (cancelar).
 */
export async function deleteActivityAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      activityId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      activityId: formData.get('activityId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.ACTIVITY_CREATE,
  });
  if (!auth.ok) return auth.state;

  const result = await deleteActivity({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    eventId: parsed.data.eventId,
    activityId: parsed.data.activityId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}`));
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/eventos'), 'layout');

  return result.ok
    ? { ok: true, message: `Atividade “${result.title}” excluída.` }
    : { ok: false, code: result.code, message: result.message };
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
   * A rubrica chega como listas paralelas (rótulo, peso, nota máxima) e mais a chave
   * oculta de cada linha.
   *
   * Listas paralelas evitam exigir JSON do organizador — e a conversão vive no DOMÍNIO
   * (`buildRubricFromRows`), a mesma que o painel da chamada usa: a chave é derivada do
   * rótulo na linha nova e preservada na linha que já existe, e linha sem rótulo é
   * descartada. Vazio significa "use a rubrica padrão".
   */
  const rubric = buildRubricFromRows({
    keys: formData.getAll('rubricKey'),
    labels: formData.getAll('rubricLabel'),
    weights: formData.getAll('rubricWeight'),
    maxScores: formData.getAll('rubricMaxScore'),
  });

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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  EXCLUIR CARTA E MISSÃO (FASE 43)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A exclusão é **lógica** nos dois casos, e a mensagem diz o que aconteceu com o que
 *  já foi conquistado: nada. A carta sai do catálogo mas fica no álbum de quem a
 *  ganhou; a missão sai da lista mas o progresso e o XP resgatado continuam.
 *
 *  A carta em uso como prêmio é RECUSADA pelo serviço, com a contagem — a tela já
 *  mostra onde ela é usada, então a recusa chega como confirmação do que estava à
 *  vista, não como surpresa.
 */
export async function deleteCardTemplateAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await guard({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    permission: PERMISSIONS.CARD_TEMPLATE_MANAGE,
  });
  if (!auth.ok) return auth.state;

  const cardTemplateId = String(formData.get('cardTemplateId') ?? '');
  if (!z.string().uuid().safeParse(cardTemplateId).success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Carta inválida.' };
  }

  const result = await deleteCardTemplate({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    cardTemplateId,
  });

  revalidatePath(tenantPath(String(formData.get('tenantSlug')), '/administracao/cartas'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return {
    ok: true,
    message:
      result.ownedBy > 0
        ? `Carta excluída do catálogo. Ela continua no álbum de ${result.ownedBy} pessoa(s) que já a ganharam.`
        : 'Carta excluída do catálogo.',
  };
}

export async function deleteMissionAction(
  _prev: AdminActionState | null,
  formData: FormData,
): Promise<AdminActionState> {
  const auth = await guard({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    permission: PERMISSIONS.TASK_MANAGE,
  });
  if (!auth.ok) return auth.state;

  const taskDefinitionId = String(formData.get('taskDefinitionId') ?? '');
  if (!z.string().uuid().safeParse(taskDefinitionId).success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Missão inválida.' };
  }

  const result = await deleteMission({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    taskDefinitionId,
  });

  revalidatePath(tenantPath(String(formData.get('tenantSlug')), '/administracao/missoes'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return {
    ok: true,
    message:
      result.completions > 0
        ? `Missão excluída. As ${result.completions} pessoa(s) que progrediram mantêm o histórico e o XP já resgatado.`
        : 'Missão excluída.',
  };
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
