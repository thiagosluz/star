'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Crachá, credenciamento e frequência (FASE 31)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTAS AÇÕES FAZEM, E O QUE ELAS NÃO FAZEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • `recordPresenceAction` — a ação do BALCÃO: recebe o código lido (câmera, leitor
 *    USB ou digitação) e o CONTEXTO escolhido pelo monitor (portaria ou atividade) e
 *    registra o fato. É ela que o monitor usa o dia inteiro;
 *  • `issueCredentialsAction` — emite crachás para quem falta (todos os inscritos) ou
 *    para uma lista explícita (equipe, palestrante, imprensa);
 *  • `revokeCredentialAction` — tira um código de circulação, com motivo na trilha;
 *  • `closeSessionsAction` — fecha as presenças abertas da atividade (quem esqueceu de
 *    sair recebe a saída no FIM da atividade).
 *
 *  A autorização usa `registration:checkin` (o balcão) e `attendance:manage` (emissão,
 *  revogação e fechamento) — e aceita o escopo de EVENTO, porque quem opera a porta é
 *  a equipe do dia (FASE 12/I7). É por isso que `eventId` entra na guarda.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { guardAction, type ActionGuardState } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  closeOpenSessions,
  getOwnCredential,
  issueCredentials,
  recordCredentialPresence,
  revokeCredential,
} from '@/lib/events/credential-service';
import { normalizeBadgeCode } from '@/domain/events/credential-rules';

export type CredentialActionState = ActionGuardState;

const contextSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  /** `EVENT` = portaria; `ACTIVITY` = atividade escolhida. */
  contextKind: z.enum(['EVENT', 'ACTIVITY']),
  activityId: z.string().uuid().optional(),
});

function contextOf(data: z.infer<typeof contextSchema>) {
  return data.contextKind === 'ACTIVITY'
    ? ({ kind: 'ACTIVITY' as const, activityId: data.activityId ?? null })
    : ({ kind: 'EVENT' as const, activityId: null });
}

export interface SyncScanResult {
  id: string;
  ok: boolean;
  message: string;
  code?: string;
  action?: string;
  data?: Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────────────
//  O balcão: registrar presença a partir do crachá
// ───────────────────────────────────────────────────────────────────────────────
export async function recordPresenceAction(
  _prev: CredentialActionState | null,
  formData: FormData,
): Promise<CredentialActionState> {
  const parsed = contextSchema
    .extend({
      code: z.string().trim().min(3).max(64),
      /** `TOGGLE` é o botão único do balcão; `OUT` fecha a sessão abertas. */
      mode: z.enum(['IN', 'OUT', 'TOGGLE']).default('TOGGLE'),
      readAt: z.string().datetime().optional(),
      idempotencyKey: z.string().trim().max(128).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      contextKind: formData.get('contextKind') ?? 'EVENT',
      activityId: (formData.get('activityId') as string) || undefined,
      code: formData.get('code'),
      mode: formData.get('mode') ?? 'TOGGLE',
      readAt: (formData.get('readAt') as string) || undefined,
      idempotencyKey: (formData.get('idempotencyKey') as string) || undefined,
    });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message:
        parsed.error.issues[0]?.message ??
        'Informe o código do crachá e escolha onde a leitura vale (portaria ou atividade).',
    };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CHECKIN,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId: parsed.data.eventId,
  });

  if (!auth.ok) return auth.state;

  const result = await recordCredentialPresence({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    code: parsed.data.code,
    context: contextOf(parsed.data),
    actorId: auth.userId,
    mode: parsed.data.mode,
    readAt: parsed.data.readAt ? new Date(parsed.data.readAt) : undefined,
    idempotencyKey: parsed.data.idempotencyKey,
  });

  const eventPath = tenantPath(parsed.data.tenantSlug, '/credenciamento');
  revalidatePath(eventPath);

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: result.message,
      details: result.details,
      data: { code: normalizeBadgeCode(parsed.data.code) ?? parsed.data.code },
    };
  }

  const { action, target, minutes, warnings, rewarded } = result;

  const headline =
    action === 'CHECKED_IN'
      ? `Entrada registrada para ${target.userName}.`
      : action === 'CHECKED_OUT'
        ? `Saída registrada para ${target.userName}${minutes !== null ? ` · ${minutes} min` : ''}.`
        : action === 'ALREADY_INSIDE'
          ? `${target.userName} já estava com a entrada registrada aqui.`
          : `${target.userName} não tinha entrada registrada neste contexto.`;

  return {
    ok: true,
    message: rewarded ? `${headline} Recompensa creditada.` : headline,
    details: warnings,
    data: {
      action,
      userId: target.userId,
      userName: target.userName,
      userImage: target.userImage,
      code: target.code,
      activityTitle: parsed.data.contextKind === 'ACTIVITY' ? (target.registrations.find((row) => row.activityId === parsed.data.activityId)?.activityTitle ?? null) : null,
      minutes,
      registered: target.registered,
      registrationStatus: target.registrationStatus,
      openSince: target.openSession?.checkedInAt.toISOString() ?? null,
      closedMinutes: target.closedMinutes,
      rewarded,
    },
  };
}

/**
 * Sincroniza em lote leituras offline enfileiradas no IndexedDB.
 *
 * Processa as leituras em ordem cronológica de `readAt`, preservando os minutos
 * reais e aplicando idempotência via `idempotencyKey`.
 */
export async function syncOfflinePresencesAction(
  tenantSlug: string,
  eventId: string,
  scans: Array<{
    id: string;
    contextKind: 'EVENT' | 'ACTIVITY';
    activityId?: string | null;
    code: string;
    mode: 'IN' | 'OUT' | 'TOGGLE';
    readAt: string;
    idempotencyKey?: string;
  }>,
): Promise<SyncScanResult[]> {
  if (!Array.isArray(scans) || scans.length === 0) return [];

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CHECKIN,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId,
  });

  if (!auth.ok) {
    return scans.map((s) => ({
      id: s.id,
      ok: false,
      code: auth.state.code ?? 'FORBIDDEN',
      message: auth.state.message ?? 'Não autorizado.',
    }));
  }

  const sorted = [...scans].sort((a, b) => a.readAt.localeCompare(b.readAt));
  const results: SyncScanResult[] = [];

  for (const scan of sorted) {
    try {
      const result = await recordCredentialPresence({
        tenantId: auth.tenantId,
        eventId,
        code: scan.code,
        context:
          scan.contextKind === 'ACTIVITY'
            ? { kind: 'ACTIVITY', activityId: scan.activityId ?? null }
            : { kind: 'EVENT', activityId: null },
        actorId: auth.userId,
        mode: scan.mode,
        readAt: new Date(scan.readAt),
        idempotencyKey: scan.idempotencyKey,
        source: 'QR_CODE_CHECKIN',
      });

      if (!result.ok) {
        results.push({
          id: scan.id,
          ok: false,
          code: result.code,
          message: result.message,
        });
      } else {
        results.push({
          id: scan.id,
          ok: true,
          action: result.action,
          message: `Sincronizado: ${result.action} para ${result.target.userName}.`,
          data: {
            userName: result.target.userName,
            action: result.action,
            minutes: result.minutes,
          },
        });
      }
    } catch (err) {
      results.push({
        id: scan.id,
        ok: false,
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'Falha ao sincronizar.',
      });
    }
  }

  const eventPath = tenantPath(tenantSlug, '/credenciamento');
  revalidatePath(eventPath);

  return results;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Emissão e revogação
// ───────────────────────────────────────────────────────────────────────────────
export async function issueCredentialsAction(
  _prev: CredentialActionState | null,
  formData: FormData,
): Promise<CredentialActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      /** Vazio = todos os inscritos que ainda não têm crachá. */
      userIds: z.array(z.string().uuid()).optional(),
      notes: z.string().trim().max(300).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      userIds: formData.getAll('userIds').filter((value): value is string => typeof value === 'string' && value.length > 0),
      notes: (formData.get('notes') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para emitir crachás.' };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.ATTENDANCE_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId: parsed.data.eventId,
  });

  if (!auth.ok) return auth.state;

  const result = await issueCredentials({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorId: auth.userId,
    userIds: parsed.data.userIds && parsed.data.userIds.length > 0 ? parsed.data.userIds : undefined,
    notes: parsed.data.notes ?? null,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/credenciamento/crachas'));

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  if (result.issued.length === 0) {
    return {
      ok: true,
      message:
        result.skipped > 0
          ? 'Todos os participantes selecionados já têm crachá válido.'
          : 'Nenhum participante para emitir crachá.',
      data: { issued: 0, skipped: result.skipped },
    };
  }

  return {
    ok: true,
    message: `${result.issued.length} crachá(s) emitido(s)${result.skipped > 0 ? ` · ${result.skipped} já tinha(m) crachá` : ''}${
      result.truncated ? ' · o lote foi limitado (emita o restante na próxima vez)' : ''
    }.`,
    data: { issued: result.issued.length, skipped: result.skipped, codes: result.issued.map((row) => row.code) },
  };
}

export async function revokeCredentialAction(
  _prev: CredentialActionState | null,
  formData: FormData,
): Promise<CredentialActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      credentialId: z.string().uuid(),
      reason: z.string().max(300).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      credentialId: formData.get('credentialId'),
      reason: (formData.get('reason') as string) ?? '',
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para revogar o crachá.' };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.ATTENDANCE_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId: parsed.data.eventId,
  });

  if (!auth.ok) return auth.state;

  const result = await revokeCredential({
    tenantId: auth.tenantId,
    credentialId: parsed.data.credentialId,
    actorId: auth.userId,
    reason: parsed.data.reason ?? '',
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/credenciamento/crachas'));

  return result.ok
    ? { ok: true, message: 'Crachá revogado. O motivo ficou na trilha de auditoria.' }
    : { ok: false, code: result.code, message: result.message };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Fechamento das presenças abertas
// ───────────────────────────────────────────────────────────────────────────────
export async function closeSessionsAction(
  _prev: CredentialActionState | null,
  formData: FormData,
): Promise<CredentialActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      activityId: z.string().uuid().optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      activityId: (formData.get('activityId') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para fechar as presenças.' };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.ATTENDANCE_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId: parsed.data.eventId,
  });

  if (!auth.ok) return auth.state;

  const result = await closeOpenSessions({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    activityId: parsed.data.activityId ?? null,
    actorId: auth.userId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/credenciamento'));

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  return {
    ok: true,
    message:
      result.closed === 0
        ? 'Não havia presença aberta para fechar neste contexto.'
        : `${result.closed} presença(s) fechada(s), somando ${result.minutes} minuto(s).`,
    data: { closed: result.closed, minutes: result.minutes },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  O crachá do próprio participante
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Emite (na primeira vez) o crachá da PRÓPRIA pessoa e revalida a tela dela.
 *
 * A autorização aqui é a posse: só a pessoa abre o próprio crachá, e é o serviço que
 * confere se ela tem inscrição no evento. Nada de permissão de balcão — quem só vai
 * assistir também precisa do próprio crachá.
 */
export async function generateOwnCredentialAction(
  _prev: CredentialActionState | null,
  formData: FormData,
): Promise<CredentialActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
    })
    .safeParse({ tenantSlug: formData.get('tenantSlug'), eventId: formData.get('eventId') });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para gerar o crachá.' };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_READ_OWN,
  });

  if (!auth.ok) return auth.state;

  const result = await getOwnCredential({
    tenantId: auth.tenantId,
    userId: auth.userId,
    eventId: parsed.data.eventId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/meu-cracha'));

  return result.ok
    ? { ok: true, message: `Seu crachá está pronto: ${result.code}`, data: { code: result.code } }
    : { ok: false, code: result.code, message: result.message };
}
