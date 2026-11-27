/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Ciclo de Vida no Acervo de Eventos (FASE 128)
 *
 *  Operações executadas sob `withTenant` (RLS + FORCE) com trilha de auditoria:
 *    • `archiveEvent`: arquiva (`ARCHIVED`) ou restaura (`DRAFT`) sem perder dados;
 *    • `cloneEventBasicData`: cria novo evento em `DRAFT` respeitando a quota
 *      do plano e copiando apenas dados básicos e `settings` seguros (sem API key);
 *    • `deleteEventSecurely`: exige confirmação `"EXCLUIR"` + senha verificada via
 *      callback criptográfico (`auth.api.verifyPassword`), executa exclusão lógica
 *      (`deletedAt`), libera o slug original e registra trilha `DELETE`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import {
  buildDeletedEventSlug,
  canArchiveEvent,
  canRestoreArchivedEvent,
  evaluateEventDeletionGuard,
  sanitizeClonedSettings,
} from '@/domain/events/event-lifecycle-rules';
import { evaluateEventQuota } from '@/domain/platform/platform-rules';
import { recordAudit } from '@/lib/admin/audit';
import { errorMessage, isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { withTenant } from '@/lib/db/tenant-client';
import { logger } from '@/lib/observability/logger';

export type EventLifecycleErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_STATE'
  | 'SLUG_TAKEN'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_CONFIRMATION_WORD'
  | 'PASSWORD_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'INTERNAL';

export type EventLifecycleResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: EventLifecycleErrorCode; message: string };

export async function archiveEvent(input: {
  tenantId: string;
  actorId: string;
  eventId: string;
  archive: boolean;
}): Promise<EventLifecycleResult<{ eventId: string; slug: string; status: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, slug: true, status: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      if (input.archive && !canArchiveEvent(event.status)) {
        return {
          ok: false as const,
          code: 'INVALID_STATE' as const,
          message: 'Este evento já está arquivado.',
        };
      }

      if (!input.archive && !canRestoreArchivedEvent(event.status)) {
        return {
          ok: false as const,
          code: 'INVALID_STATE' as const,
          message: 'Somente eventos arquivados podem ser restaurados como rascunho.',
        };
      }

      const nextStatus = input.archive ? 'ARCHIVED' : 'DRAFT';

      await tx.event.update({
        where: { id: event.id },
        data: { status: nextStatus },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'event',
          entityId: event.id,
          changes: { status: { from: event.status, to: nextStatus } },
        },
        tx,
      );

      return { ok: true as const, eventId: event.id, slug: event.slug, status: nextStatus };
    });
  } catch (error) {
    logger.error(`[events] falha ao alterar arquivamento do evento: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível atualizar o arquivamento do evento agora.',
    };
  }
}

export async function cloneEventBasicData(input: {
  tenantId: string;
  actorId: string;
  sourceEventId: string;
  title: string;
  slug: string;
  startsAt: Date;
  endsAt: Date;
}): Promise<EventLifecycleResult<{ eventId: string; slug: string; title: string }>> {
  const title = input.title.trim();
  const slug = input.slug.trim().toLowerCase();

  if (title.length < 4 || slug.length < 3 || input.endsAt.getTime() <= input.startsAt.getTime()) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique título, identificador e datas (o término deve ser após o início).',
    };
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const [source, tenant, currentCount] = await Promise.all([
        tx.event.findFirst({
          where: { id: input.sourceEventId, tenantId: input.tenantId, deletedAt: null },
          select: {
            id: true,
            subtitle: true,
            summary: true,
            description: true,
            modality: true,
            category: true,
            timezone: true,
            usesCall: true,
            venueName: true,
            venueAddress: true,
            city: true,
            state: true,
            country: true,
            onlineUrl: true,
            capacity: true,
            coverImageUrl: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            accentColor: true,
            theme: true,
            settings: true,
          },
        }),
        tx.tenant.findUnique({
          where: { id: input.tenantId },
          select: { maxEvents: true },
        }),
        tx.event.count({
          where: { tenantId: input.tenantId, deletedAt: null },
        }),
      ]);

      if (!source) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Evento de origem não encontrado.',
        };
      }

      const quota = evaluateEventQuota({
        currentCount,
        maxEvents: tenant?.maxEvents ?? null,
      });

      if (!quota.allowed) {
        return {
          ok: false as const,
          code: 'QUOTA_EXCEEDED' as const,
          message: quota.message ?? 'A quota de eventos do plano foi atingida.',
        };
      }

      const newId = randomUUID();
      const safeSettings = sanitizeClonedSettings(source.settings);

      await tx.event.create({
        data: {
          id: newId,
          tenantId: input.tenantId,
          slug,
          title,
          subtitle: source.subtitle,
          summary: source.summary,
          description: source.description,
          status: 'DRAFT',
          modality: source.modality,
          category: source.category,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          timezone: source.timezone,
          registrationOpensAt: null,
          registrationClosesAt: null,
          usesCall: source.usesCall,
          venueName: source.venueName,
          venueAddress: source.venueAddress,
          city: source.city,
          state: source.state,
          country: source.country,
          onlineUrl: source.onlineUrl,
          capacity: source.capacity,
          confirmedCount: 0,
          waitlistCount: 0,
          coverImageUrl: source.coverImageUrl,
          logoUrl: source.logoUrl,
          primaryColor: source.primaryColor,
          secondaryColor: source.secondaryColor,
          accentColor: source.accentColor,
          theme: (source.theme ?? {}) as object,
          settings: safeSettings as object,
          createdById: input.actorId,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'event',
          entityId: newId,
          changes: {
            clonedFromEventId: { from: null, to: source.id },
            title: { from: null, to: title },
            slug: { from: null, to: slug },
          },
        },
        tx,
      );

      return { ok: true as const, eventId: newId, slug, title };
    });
  } catch (error) {
    if (isUniqueViolation(error) && violatedIndexName(error)?.includes('slug')) {
      return {
        ok: false,
        code: 'SLUG_TAKEN',
        message: 'Já existe outro evento com este identificador na instituição.',
      };
    }

    logger.error(`[events] falha ao clonar evento: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível clonar o evento agora.',
    };
  }
}

export async function deleteEventSecurely(input: {
  tenantId: string;
  actorId: string;
  eventId: string;
  confirmationWord: string;
  currentPassword: string;
  verifyPassword: (password: string) => Promise<boolean>;
}): Promise<EventLifecycleResult<{ eventId: string; previousSlug: string }>> {
  const guardDecision = evaluateEventDeletionGuard({
    confirmationWord: input.confirmationWord,
    currentPassword: input.currentPassword,
  });

  if (!guardDecision.ok) {
    return {
      ok: false,
      code: guardDecision.code,
      message: guardDecision.message,
    };
  }

  const validPassword = await input.verifyPassword(input.currentPassword);
  if (!validPassword) {
    return {
      ok: false,
      code: 'INVALID_PASSWORD',
      message: 'A senha informada está incorreta.',
    };
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, slug: true, title: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      const archivedSlug = buildDeletedEventSlug(event.slug, event.id);

      await tx.event.update({
        where: { id: event.id },
        data: {
          deletedAt: new Date(),
          status: 'ARCHIVED',
          slug: archivedSlug,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'event',
          entityId: event.id,
          changes: {
            title: { from: event.title, to: null },
            slug: { from: event.slug, to: null },
          },
        },
        tx,
      );

      return { ok: true as const, eventId: event.id, previousSlug: event.slug };
    });
  } catch (error) {
    logger.error(`[events] falha ao excluir evento: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível excluir o evento agora.',
    };
  }
}
