'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Quadro de demandas internas do evento (FASE 38)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GUARDA É A MESMA EM TODAS, E NÃO É O MENU
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada ação resolve sessão, vínculo e permissão ANTES de tocar em qualquer dado.
 *  Esconder o botão na tela é conveniência; a barreira é aqui — uma Server Action é
 *  um endpoint HTTP.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS PERMISSÕES DE ATRIBUIÇÃO, E O QUE CADA UMA ABRE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `demand:assign` distribui trabalho em QUALQUER demanda do evento (coordenação).
 *  `demand:assign:own-team` existe para o LÍDER de equipe, e é `:own-team` e não
 *  `:own` de propósito: a posse aqui não é "a linha é minha" (o `:own` do RBAC
 *  compara com o `userId`), é "a demanda é da equipe que eu lidero". Quem decide
 *  isso é o DADO (`event_team_members.isLead`), e a checagem vive no SERVIÇO —
 *  a action só informa qual dos dois caminhos o principal pode usar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { dueAtFromDay } from '@/domain/events/demand-rules';
import {
  addDemandComment,
  createDemand,
  createDemandColumn,
  createEventTeam,
  deleteDemand,
  deleteDemandColumn,
  deleteEventTeam,
  moveDemand,
  reorderDemandColumns,
  setDemandAssignees,
  setEventTeamMembers,
  updateDemand,
  updateDemandColumn,
} from '@/lib/events/demand-service';

export interface DemandActionState {
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
  /** Segunda permissão aceita (o caminho do líder de equipe). */
  alternatePermission?: Permission;
  eventId?: string | null;
}): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal; viaAlternate: boolean }
  | { ok: false; state: DemandActionState }
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
    return {
      ok: false,
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
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Você não tem vínculo ativo com esta instituição.',
      },
    };
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  /**
   * O alvo é o EVENTO quando ele é conhecido — o papel pode valer só nele (equipe
   * do dia), e exigir escopo de instituição recusaria o caso normal.
   */
  const target = input.eventId
    ? ({ scope: 'EVENT', eventId: input.eventId } as const)
    : ({ scope: 'TENANT' } as const);

  if (can(principal, input.permission, target)) {
    return { ok: true, userId: user.id, tenantId: tenant.id, principal, viaAlternate: false };
  }

  if (input.alternatePermission && can(principal, input.alternatePermission, target)) {
    return { ok: true, userId: user.id, tenantId: tenant.id, principal, viaAlternate: true };
  }

  return {
    ok: false,
    state: {
      ok: false,
      code: 'FORBIDDEN',
      message: `Permissão negada: ${input.permission}.`,
    },
  };
}

/** Um dia digitado (`2026-09-26`) vira o FIM daquele dia no fuso do evento. */
function toDueAt(value: FormDataEntryValue | null, timeZone: string): Date | null | undefined {
  if (value === null) return undefined;

  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) return null;

  return dueAtFromDay(text, timeZone);
}

async function eventTimeZone(tenantId: string, eventId: string): Promise<string> {
  const event = await adminPrisma.event.findFirst({
    where: { id: eventId, tenantId },
    select: { timezone: true },
  });

  return event?.timezone ?? 'UTC';
}

function revalidateBoard(tenantSlug: string, eventId: string, demandId?: string): void {
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/demandas`));
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/equipes`));
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}`));

  if (demandId) {
    revalidatePath(
      tenantPath(tenantSlug, `/administracao/eventos/${eventId}/demandas/${demandId}`),
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Demanda: criar e editar
// ───────────────────────────────────────────────────────────────────────────────
const demandFieldsSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  columnId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  startAt: z.string().trim().optional(),
  dueAt: z.string().trim().optional(),
});

export async function createDemandAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = demandFieldsSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    title: formData.get('title'),
    description: (formData.get('description') as string) || undefined,
    priority: (formData.get('priority') as string) || undefined,
    columnId: (formData.get('columnId') as string) || undefined,
    teamId: (formData.get('teamId') as string) || undefined,
    startAt: (formData.get('startAt') as string) || undefined,
    dueAt: (formData.get('dueAt') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados da demanda inválidos.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const timeZone = await eventTimeZone(auth.tenantId, parsed.data.eventId);
  const assigneeIds = formData.getAll('assigneeIds').map((value) => String(value));

  const result = await createDemand({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorId: auth.userId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    priority: parsed.data.priority ?? null,
    columnId: parsed.data.columnId ?? null,
    teamId: parsed.data.teamId ?? null,
    startAt: toDueAt(formData.get('startAt'), timeZone) ?? null,
    dueAt: toDueAt(formData.get('dueAt'), timeZone) ?? null,
    assigneeIds,
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId);

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  return {
    ok: true,
    message: 'Demanda criada.',
    data: { demandId: result.demandId, avisados: result.notices.filter((n) => n.ok).length },
  };
}

export async function updateDemandAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = demandFieldsSchema
    .extend({ demandId: z.string().uuid() })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      demandId: formData.get('demandId'),
      title: formData.get('title'),
      description: (formData.get('description') as string) || undefined,
      priority: (formData.get('priority') as string) || undefined,
      teamId: (formData.get('teamId') as string) || undefined,
      startAt: (formData.get('startAt') as string) || undefined,
      dueAt: (formData.get('dueAt') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados da demanda inválidos.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const timeZone = await eventTimeZone(auth.tenantId, parsed.data.eventId);

  const result = await updateDemand({
    tenantId: auth.tenantId,
    demandId: parsed.data.demandId,
    actorId: auth.userId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    priority: parsed.data.priority ?? null,
    teamId: parsed.data.teamId ?? null,
    startAt: toDueAt(formData.get('startAt'), timeZone),
    dueAt: toDueAt(formData.get('dueAt'), timeZone),
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId, parsed.data.demandId);

  return result.ok ? { ok: true, message: 'Demanda salva.' } : { ok: false, code: result.code, message: result.message };
}

/**
 * Mover o cartão.
 *
 * É a MESMA ação para o arrastar e soltar e para o formulário que funciona sem
 * JavaScript: o cliente monta o `FormData` e chama; o `<form>` do cartão faz o mesmo
 * caminho quando o bundle ainda não carregou. Um caminho de escrita, dois jeitos de
 * chegar nele.
 */
export async function moveDemandAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      demandId: z.string().uuid(),
      fromColumnId: z.string().uuid(),
      toColumnId: z.string().uuid(),
      toIndex: z.coerce.number().int().min(0).max(1000).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      demandId: formData.get('demandId'),
      fromColumnId: formData.get('fromColumnId'),
      toColumnId: formData.get('toColumnId'),
      toIndex: formData.get('toIndex') ?? undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Movimento inválido.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await moveDemand({
    tenantId: auth.tenantId,
    demandId: parsed.data.demandId,
    actorId: auth.userId,
    fromColumnId: parsed.data.fromColumnId,
    toColumnId: parsed.data.toColumnId,
    toIndex: parsed.data.toIndex,
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId, parsed.data.demandId);

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  return {
    ok: true,
    message: result.completed ? 'Demanda concluída.' : 'Demanda movida.',
  };
}

/**
 * O MESMO movimento, na forma que um `<form>` SEM JavaScript consegue enviar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE DUAS PORTAS PARA A MESMA ESCRITA
 * ─────────────────────────────────────────────────────────────────────────────
 *  O `<form action={...}>` do React só aceita `(formData) => void`; a ação com
 *  `useActionState` recebe `(prev, formData)` e não pode ser usada direto ali. Em vez
 *  de escolher uma das duas (e perder o arrastar com aviso OU o quadro operável sem
 *  JavaScript — a dívida E50), as duas portas chamam o MESMO serviço.
 */
export async function moveDemandFormAction(formData: FormData): Promise<void> {
  await moveDemandAction(null, formData);
}

export async function deleteDemandAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      demandId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      demandId: formData.get('demandId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Demanda inválida.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await deleteDemand({
    tenantId: auth.tenantId,
    demandId: parsed.data.demandId,
    actorId: auth.userId,
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok ? { ok: true, message: 'Demanda excluída.' } : { ok: false, code: result.code, message: result.message };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Atribuição (coordenação × líder da própria equipe)
// ───────────────────────────────────────────────────────────────────────────────
export async function assignDemandAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      demandId: z.string().uuid(),
      teamId: z.string().uuid().nullable().optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      demandId: formData.get('demandId'),
      teamId: formData.get('teamId') === '' ? null : ((formData.get('teamId') as string) || undefined),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Atribuição inválida.' };
  }

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_ASSIGN,
    alternatePermission: PERMISSIONS.DEMAND_ASSIGN_OWN_TEAM,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const userIds = formData.getAll('assigneeIds').map((value) => String(value));

  const result = await setDemandAssignees({
    tenantId: auth.tenantId,
    demandId: parsed.data.demandId,
    actorId: auth.userId,
    userIds,
    teamId: formData.has('teamId') ? (parsed.data.teamId ?? null) : undefined,
    /**
     * O caminho estreito: quem só tem `:own-team` pode distribuir DENTRO da equipe
     * que lidera, e o serviço confere a posse no banco.
     */
    leadOnly: auth.viaAlternate,
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId, parsed.data.demandId);

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  return {
    ok: true,
    message: `Responsáveis salvos${result.notices.length > 0 ? ` · ${result.notices.filter((n) => n.ok).length} aviso(s) enviado(s)` : ''}.`,
  };
}

export async function commentDemandAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      demandId: z.string().uuid(),
      body: z.string().trim().min(1).max(2000),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      demandId: formData.get('demandId'),
      body: formData.get('body'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'COMMENT_REQUIRED', message: 'Escreva o comentário.' };
  }

  /**
   * Comentar exige a leitura do quadro — quem acompanha a demanda comenta nela. A
   * atribuição continua sendo ato de coordenação.
   */
  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_READ,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await addDemandComment({
    tenantId: auth.tenantId,
    demandId: parsed.data.demandId,
    actorId: auth.userId,
    body: parsed.data.body,
    mentionIds: formData.getAll('mentionIds').map((value) => String(value)),
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId, parsed.data.demandId);

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  const notified = result.notices.filter((notice) => notice.ok).length;

  return {
    ok: true,
    message:
      notified > 0
        ? `Comentário registrado · ${notified} pessoa(s) avisada(s).`
        : 'Comentário registrado.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Colunas
// ───────────────────────────────────────────────────────────────────────────────
export async function createColumnAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      name: z.string().trim().min(1).max(40),
      isDone: z.coerce.boolean().optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      name: formData.get('name'),
      isDone: formData.get('isDone') === 'on' || formData.get('isDone') === 'true',
    });

  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: 'Nome da coluna inválido.' };

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_TEAM_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await createDemandColumn({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorId: auth.userId,
    name: parsed.data.name,
    isDone: parsed.data.isDone ?? false,
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok ? { ok: true, message: 'Coluna criada.' } : { ok: false, code: result.code, message: result.message };
}

export async function updateColumnAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      columnId: z.string().uuid(),
      name: z.string().trim().max(40).optional(),
      isDone: z.enum(['true', 'false']).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      columnId: formData.get('columnId'),
      name: (formData.get('name') as string) || undefined,
      isDone: (formData.get('isDone') as string) || undefined,
    });

  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: 'Coluna inválida.' };

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_TEAM_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await updateDemandColumn({
    tenantId: auth.tenantId,
    columnId: parsed.data.columnId,
    actorId: auth.userId,
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.isDone !== undefined ? { isDone: parsed.data.isDone === 'true' } : {}),
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok ? { ok: true, message: 'Coluna salva.' } : { ok: false, code: result.code, message: result.message };
}

export async function deleteColumnAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      columnId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      columnId: formData.get('columnId'),
    });

  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: 'Coluna inválida.' };

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_TEAM_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await deleteDemandColumn({
    tenantId: auth.tenantId,
    columnId: parsed.data.columnId,
    actorId: auth.userId,
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok ? { ok: true, message: 'Coluna excluída.' } : { ok: false, code: result.code, message: result.message };
}

export async function reorderColumnsAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      direction: z.enum(['up', 'down']),
      columnId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      direction: formData.get('direction'),
      columnId: formData.get('columnId'),
    });

  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: 'Movimento inválido.' };

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_TEAM_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const { loadColumnOrder } = await import('@/lib/events/demand-service');
  const columns = await loadColumnOrder({ tenantId: auth.tenantId, eventId: parsed.data.eventId });

  const index = columns.findIndex((column) => column.id === parsed.data.columnId);
  if (index < 0) return { ok: false, code: 'NOT_FOUND', message: 'Coluna não encontrada.' };

  const target = parsed.data.direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= columns.length) {
    return { ok: false, code: 'INVALID_INPUT', message: 'A coluna já está no fim da fila.' };
  }

  const ids = columns.map((column) => column.id);
  const [moved] = ids.splice(index, 1);
  ids.splice(target, 0, moved!);

  const result = await reorderDemandColumns({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorId: auth.userId,
    columnIds: ids,
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok ? { ok: true, message: 'Ordem das colunas salva.' } : { ok: false, code: result.code, message: result.message };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Equipes do evento
// ───────────────────────────────────────────────────────────────────────────────
export async function createTeamAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      name: z.string().trim().min(1).max(40),
      description: z.string().trim().max(300).optional(),
      leadId: z.string().uuid().optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      name: formData.get('name'),
      description: (formData.get('description') as string) || undefined,
      leadId: (formData.get('leadId') as string) || undefined,
    });

  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: 'Dados da equipe inválidos.' };

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_TEAM_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await createEventTeam({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorId: auth.userId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    memberIds: formData.getAll('memberIds').map((value) => String(value)),
    leadId: parsed.data.leadId ?? null,
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok ? { ok: true, message: 'Equipe criada.' } : { ok: false, code: result.code, message: result.message };
}

export async function setTeamMembersAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      teamId: z.string().uuid(),
      leadId: z.string().uuid().nullable().optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      teamId: formData.get('teamId'),
      leadId: formData.get('leadId') === '' ? null : ((formData.get('leadId') as string) || undefined),
    });

  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: 'Equipe inválida.' };

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_TEAM_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await setEventTeamMembers({
    tenantId: auth.tenantId,
    teamId: parsed.data.teamId,
    actorId: auth.userId,
    memberIds: formData.getAll('memberIds').map((value) => String(value)),
    leadId: parsed.data.leadId ?? null,
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok ? { ok: true, message: 'Equipe salva.' } : { ok: false, code: result.code, message: result.message };
}

export async function deleteTeamAction(
  _prev: DemandActionState | null,
  formData: FormData,
): Promise<DemandActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      teamId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      teamId: formData.get('teamId'),
    });

  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: 'Equipe inválida.' };

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.DEMAND_TEAM_MANAGE,
    eventId: parsed.data.eventId,
  });
  if (!auth.ok) return auth.state;

  const result = await deleteEventTeam({
    tenantId: auth.tenantId,
    teamId: parsed.data.teamId,
    actorId: auth.userId,
  });

  revalidateBoard(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok ? { ok: true, message: 'Equipe excluída.' } : { ok: false, code: result.code, message: result.message };
}
