/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Administração de gamificação e certificados
 *
 *  O que a instituição precisa para OPERAR o que as fases anteriores entregaram:
 *  criar cartas com paleta e arte, definir missões, acompanhar certificados e
 *  reprocessar o que falhou no worker.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS MESMAS VALIDAÇÕES DA RENDERIZAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A paleta e a arte passam por `resolvePalette`/`resolveArt` — os validadores que
 *  o componente de carta usa. Uma cor fora do formato é descartada na GRAVAÇÃO, e
 *  não na exibição: o organizador vê o problema quando salva, não quando o
 *  participante abre o álbum.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { diffFields, recordAudit } from '@/lib/admin/audit';
import { resolveArt, resolvePalette } from '@/domain/gamification/card-rules';
import { parseTaskTarget } from '@/domain/gamification/task-rules';
import type { CardRarity, CardTrigger, TaskKind, XpSourceKind } from '@/domain/gamification/types';
import type { AdminResult } from '@/lib/admin/catalog-service';

// ───────────────────────────────────────────────────────────────────────────────
//  Cartas
// ───────────────────────────────────────────────────────────────────────────────
export interface CardTemplateInput {
  tenantId: string;
  actorId: string;
  eventId?: string | null;
  cardTemplateId?: string;
  slug: string;
  name: string;
  description?: string | null;
  lore?: string | null;
  rarity: CardRarity;
  trigger: CardTrigger;
  triggerCondition?: Record<string, unknown>;
  levelRequired: number;
  dropWeight: number;
  maxSupply: number;
  availableUntil?: Date | null;
  isActive: boolean;
  isSecret: boolean;
  palette: unknown;
  art: unknown;
}

export async function saveCardTemplate(input: CardTemplateInput): Promise<AdminResult<{ cardTemplateId: string; created: boolean }>> {
  try {
    if (input.dropWeight < 1) {
      return { ok: false as const, code: 'INVALID_INPUT', message: 'O peso de sorteio precisa ser ao menos 1.' };
    }

    if (input.maxSupply < 0) {
      return { ok: false as const, code: 'INVALID_INPUT', message: 'A tiragem não pode ser negativa.' };
    }

    // Valida AGORA e grava o resultado normalizado (allowlist de cor e URL).
    const palette = resolvePalette(input.palette, input.rarity);
    const art = resolveArt(input.art);

    return await withTenant(input.tenantId, async (tx) => {
      const data = {
        eventId: input.eventId ?? null,
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        lore: input.lore ?? null,
        rarity: input.rarity,
        trigger: input.trigger,
        triggerCondition: (input.triggerCondition ?? {}) as unknown as object,
        levelRequired: input.levelRequired,
        dropWeight: input.dropWeight,
        maxSupply: input.maxSupply,
        availableUntil: input.availableUntil ?? null,
        isActive: input.isActive,
        isSecret: input.isSecret,
        palette: palette as unknown as object,
        art: art as unknown as object,
      };

      if (input.cardTemplateId) {
        const before = await tx.cardTemplate.findFirst({
          where: { id: input.cardTemplateId, deletedAt: null },
          select: { id: true, name: true, rarity: true, trigger: true, maxSupply: true, isActive: true },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Carta não encontrada.' };
        }

        await tx.cardTemplate.update({ where: { id: before.id }, data });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'card_template',
            entityId: before.id,
            changes: diffFields(before, data, ['name', 'rarity', 'trigger', 'maxSupply', 'isActive']),
          },
          tx,
        );

        return { ok: true as const, cardTemplateId: before.id, created: false };
      }

      const id = randomUUID();

      await tx.cardTemplate.create({ data: { id, tenantId: input.tenantId, mintedCount: 0, ...data } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'card_template',
          entityId: id,
          changes: {
            name: { from: null, to: input.name },
            rarity: { from: null, to: input.rarity },
            trigger: { from: null, to: input.trigger },
          },
        },
        tx,
      );

      return { ok: true as const, cardTemplateId: id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error) && violatedIndexName(error)?.includes('slug')) {
      return { ok: false as const, code: 'SLUG_TAKEN', message: 'Já existe uma carta com este identificador.' };
    }

    console.error(`[admin] falha ao salvar carta: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível salvar a carta.' };
  }
}

export interface AdminCardRow {
  id: string;
  slug: string;
  name: string;
  rarity: CardRarity;
  trigger: string;
  levelRequired: number;
  maxSupply: number;
  mintedCount: number;
  isActive: boolean;
  isSecret: boolean;
  palette: unknown;
  art: unknown;
  ownedBy: number;
  eventId: string | null;
}

export async function listCardTemplates(tenantId: string): Promise<AdminCardRow[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.cardTemplate.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ rarity: 'asc' }, { name: 'asc' }],
      take: 200,
      select: {
        id: true,
        slug: true,
        name: true,
        rarity: true,
        trigger: true,
        levelRequired: true,
        maxSupply: true,
        mintedCount: true,
        isActive: true,
        isSecret: true,
        palette: true,
        art: true,
        eventId: true,
        _count: { select: { userCards: true } },
      },
    }),
  );

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    rarity: row.rarity,
    trigger: row.trigger,
    levelRequired: row.levelRequired,
    maxSupply: row.maxSupply,
    mintedCount: row.mintedCount,
    isActive: row.isActive,
    isSecret: row.isSecret,
    palette: row.palette,
    art: row.art,
    ownedBy: row._count.userCards,
    eventId: row.eventId,
  }));
}

// ───────────────────────────────────────────────────────────────────────────────
//  Missões
// ───────────────────────────────────────────────────────────────────────────────
export interface MissionInput {
  tenantId: string;
  actorId: string;
  eventId?: string | null;
  taskDefinitionId?: string;
  slug: string;
  name: string;
  description?: string | null;
  kind: TaskKind;
  trigger: XpSourceKind;
  target: { count?: number; activityType?: string | null; trackId?: string | null; minutes?: number | null };
  xpReward: number;
  rewardCardTemplateId?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  repeatEveryHours: number;
  isActive: boolean;
  isVisible: boolean;
  displayOrder: number;
}

export async function saveMission(input: MissionInput): Promise<AdminResult<{ taskDefinitionId: string; created: boolean }>> {
  try {
    if (input.xpReward < 0) {
      return { ok: false as const, code: 'INVALID_INPUT', message: 'A recompensa de XP não pode ser negativa.' };
    }

    const parsedTarget = parseTaskTarget(input.target);

    if (parsedTarget.errors.length > 0) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT',
        message: 'Meta inválida.',
        details: parsedTarget.errors,
      };
    }

    return await withTenant(input.tenantId, async (tx) => {
      const data = {
        eventId: input.eventId ?? null,
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        kind: input.kind,
        trigger: input.trigger,
        target: parsedTarget.target as unknown as object,
        xpReward: input.xpReward,
        rewardCardTemplateId: input.rewardCardTemplateId ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        repeatEveryHours: input.repeatEveryHours,
        isActive: input.isActive,
        isVisible: input.isVisible,
        displayOrder: input.displayOrder,
      };

      if (input.taskDefinitionId) {
        const before = await tx.taskDefinition.findFirst({
          where: { id: input.taskDefinitionId, deletedAt: null },
          select: { id: true, name: true, kind: true, trigger: true, xpReward: true, isActive: true },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Missão não encontrada.' };
        }

        await tx.taskDefinition.update({ where: { id: before.id }, data });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'task_definition',
            entityId: before.id,
            changes: diffFields(before, data, ['name', 'kind', 'trigger', 'xpReward', 'isActive']),
          },
          tx,
        );

        return { ok: true as const, taskDefinitionId: before.id, created: false };
      }

      const id = randomUUID();

      await tx.taskDefinition.create({ data: { id, tenantId: input.tenantId, ...data } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'task_definition',
          entityId: id,
          changes: {
            name: { from: null, to: input.name },
            trigger: { from: null, to: input.trigger },
            xpReward: { from: null, to: input.xpReward },
          },
        },
        tx,
      );

      return { ok: true as const, taskDefinitionId: id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error) && violatedIndexName(error)?.includes('slug')) {
      return { ok: false as const, code: 'SLUG_TAKEN', message: 'Já existe uma missão com este identificador.' };
    }

    console.error(`[admin] falha ao salvar missão: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível salvar a missão.' };
  }
}

export interface AdminMissionRow {
  id: string;
  slug: string;
  name: string;
  kind: string;
  trigger: string;
  target: unknown;
  xpReward: number;
  rewardCardSlug: string | null;
  isActive: boolean;
  isVisible: boolean;
  displayOrder: number;
  completions: number;
  claims: number;
}

export async function listMissions(tenantId: string): Promise<AdminMissionRow[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.taskDefinition.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      take: 200,
      select: {
        id: true,
        slug: true,
        name: true,
        kind: true,
        trigger: true,
        target: true,
        xpReward: true,
        isActive: true,
        isVisible: true,
        displayOrder: true,
        rewardCard: { select: { slug: true } },
        progress: { select: { status: true } },
      },
    }),
  );

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    trigger: row.trigger,
    target: row.target,
    xpReward: row.xpReward,
    rewardCardSlug: row.rewardCard?.slug ?? null,
    isActive: row.isActive,
    isVisible: row.isVisible,
    displayOrder: row.displayOrder,
    completions: row.progress.filter((entry) => entry.status === 'COMPLETED' || entry.status === 'CLAIMED').length,
    claims: row.progress.filter((entry) => entry.status === 'CLAIMED').length,
  }));
}

// ───────────────────────────────────────────────────────────────────────────────
//  Certificados (visão da equipe)
// ───────────────────────────────────────────────────────────────────────────────
export interface AdminCertificateRow {
  id: string;
  validationCode: string;
  kind: string;
  status: string;
  recipientName: string;
  eventTitle: string;
  workloadMinutes: number;
  issuedAt: Date | null;
  revokedAt: Date | null;
  failureReason: string | null;
  attempts: number;
  validationCount: number;
  hasFile: boolean;
}

/**
 * Lista certificados da instituição com o estado do ARQUIVO.
 *
 * `failureReason` e `attempts` aparecem na tela porque um certificado preso em
 * "na fila" sem explicação é o tipo de problema que o suporte descobre por
 * reclamação do participante — melhor que o painel mostre a falha e ofereça o
 * reprocessamento.
 */
export async function listCertificatesForAdmin(
  tenantId: string,
  options: { status?: string; eventId?: string; query?: string } = {},
): Promise<AdminCertificateRow[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.certificate.findMany({
      where: {
        tenantId,
        ...(options.status && options.status !== 'ALL' ? { status: options.status as never } : {}),
        ...(options.eventId ? { eventId: options.eventId } : {}),
        ...(options.query
          ? {
              OR: [
                { recipientName: { contains: options.query, mode: 'insensitive' as const } },
                { validationCode: { contains: options.query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        validationCode: true,
        kind: true,
        status: true,
        recipientName: true,
        workloadMinutes: true,
        issuedAt: true,
        revokedAt: true,
        failureReason: true,
        attempts: true,
        validationCount: true,
        storageKey: true,
        event: { select: { title: true } },
      },
    }),
  );

  return rows.map((row) => ({
    id: row.id,
    validationCode: row.validationCode,
    kind: row.kind,
    status: row.status,
    recipientName: row.recipientName,
    eventTitle: row.event?.title ?? '',
    workloadMinutes: row.workloadMinutes,
    issuedAt: row.issuedAt,
    revokedAt: row.revokedAt,
    failureReason: row.failureReason,
    attempts: row.attempts,
    validationCount: row.validationCount,
    hasFile: Boolean(row.storageKey),
  }));
}

/** Reprocessa a geração de um certificado que ficou preso ou falhou. */
export async function retryCertificateGeneration(input: {
  tenantId: string;
  actorId: string;
  certificateId: string;
}): Promise<AdminResult<{ queued: boolean; generated: boolean }>> {
  try {
    const { generateCertificate, issueCertificate } = await import('@/lib/certificates/certificate-service');

    const certificate = await withTenant(input.tenantId, (tx) =>
      tx.certificate.findFirst({
        where: { id: input.certificateId, tenantId: input.tenantId },
        select: { id: true, eventId: true, userId: true, kind: true, status: true, revokedAt: true },
      }),
    );

    if (!certificate) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'Certificado não encontrado.' };
    }

    if (certificate.revokedAt) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT',
        message: 'Certificado revogado não deve ser reemitido — emita um novo, se for o caso.',
      };
    }

    // `issueCertificate` tenta a fila e, se ela estiver fora, gera na hora.
    const issued = await issueCertificate({
      tenantId: input.tenantId,
      eventId: certificate.eventId,
      userId: certificate.userId,
      kind: certificate.kind,
      actorId: input.actorId,
    });

    if (!issued.ok) {
      return { ok: false as const, code: 'INTERNAL', message: issued.message };
    }

    if (issued.generated) {
      return { ok: true as const, queued: false, generated: true };
    }

    // Já estava emitido, ou foi para a fila: confirma o estado real do arquivo.
    const refreshed = await withTenant(input.tenantId, (tx) =>
      tx.certificate.findFirst({ where: { id: input.certificateId }, select: { status: true } }),
    );

    if (refreshed?.status === 'ISSUED') {
      return { ok: true as const, queued: false, generated: false };
    }

    // Rede de segurança: enfileirar pode ter funcionado sem worker vivo. Garante.
    await generateCertificate({ tenantId: input.tenantId, certificateId: input.certificateId });

    return { ok: true as const, queued: true, generated: false };
  } catch (error) {
    console.error(`[admin] falha ao reprocessar certificado: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível reprocessar o certificado.' };
  }
}
