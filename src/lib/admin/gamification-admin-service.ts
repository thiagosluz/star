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

// ───────────────────────────────────────────────────────────────────────────────
//  Exclusão (FASE 43)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  EXCLUIR CARTA: LÓGICA, COM GUARDA DE USO
 * ─────────────────────────────────────────────────────────────────────────────
 *  A exclusão é **lógica** (`deletedAt`), como no resto do sistema: a carta sai do
 *  catálogo e deixa de ser sorteada, mas nada é apagado — e o **álbum de quem já a
 *  ganhou continua mostrando a carta**, porque o fato aconteceu. Uma coleção que
 *  apaga o que a pessoa conquistou não é uma coleção.
 *
 *  A guarda é sobre a PROMESSA, não sobre o passado: carta que é prêmio de uma missão
 *  ou de um QR de patrocinador em vigor não pode sumir — quem completasse a missão
 *  receberia nada, e o estande anunciaria uma carta que não existe. A recusa diz
 *  quantos são, para a organização decidir (a régua da sala em uso, ADR-136).
 */
export async function deleteCardTemplate(input: {
  tenantId: string;
  actorId: string;
  cardTemplateId: string;
}): Promise<AdminResult<{ ownedBy: number }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const card = await tx.cardTemplate.findFirst({
        where: { id: input.cardTemplateId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, name: true, slug: true },
      });

      if (!card) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Carta não encontrada.' };
      }

      const [missions, qrCodes, ownedBy] = await Promise.all([
        tx.taskDefinition.count({
          where: { tenantId: input.tenantId, rewardCardTemplateId: card.id, deletedAt: null },
        }),
        tx.sponsorQrCode.count({
          where: { tenantId: input.tenantId, cardTemplateId: card.id, deletedAt: null },
        }),
        tx.userCard.count({ where: { tenantId: input.tenantId, cardTemplateId: card.id } }),
      ]);

      if (missions > 0 || qrCodes > 0) {
        const partes = [
          missions > 0 ? `${missions} missão(ões)` : null,
          qrCodes > 0 ? `${qrCodes} QR de patrocinador` : null,
        ].filter(Boolean);

        return {
          ok: false as const,
          code: 'CARD_IN_USE' as const,
          message: `Esta carta é prêmio de ${partes.join(' e ')}. Troque o prêmio antes de excluir — ou desative a carta para parar de concedê-la.`,
          details: [
            missions > 0 ? `Missões usando esta carta como prêmio: ${missions}.` : '',
            qrCodes > 0 ? `QRs de patrocinador concedendo esta carta: ${qrCodes}.` : '',
          ].filter(Boolean),
        };
      }

      await tx.cardTemplate.update({
        where: { id: card.id },
        data: { deletedAt: new Date(), isActive: false },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'card_template',
          entityId: card.id,
          changes: {
            name: { from: card.name, to: null },
            /** Quantas pessoas mantêm a carta no álbum — o número justifica a lógica. */
            noAlbumDe: { from: null, to: String(ownedBy) },
          },
        },
        tx,
      );

      return { ok: true as const, ownedBy };
    });
  } catch (error) {
    console.error(`[admin] falha ao excluir carta: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível excluir a carta.' };
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  EXCLUIR MISSÃO: SEM GUARDA, COM AVISO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Nada aponta para uma missão — o que existe é o PROGRESSO das pessoas. Por isso a
 *  exclusão é permitida e a tela AVISA antes (quantas pessoas progrediram e quantos
 *  resgates houve): o histórico fica, a missão sai da lista de quem joga, e o XP que
 *  já foi creditado não é tocado. Cancelar conquista alheia seria outra operação, e
 *  ela tem nome: ajuste de XP (que existe, com trilha).
 */
export async function deleteMission(input: {
  tenantId: string;
  actorId: string;
  taskDefinitionId: string;
}): Promise<AdminResult<{ completions: number; claims: number }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const mission = await tx.taskDefinition.findFirst({
        where: { id: input.taskDefinitionId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, name: true, slug: true },
      });

      if (!mission) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Missão não encontrada.' };
      }

      const progress = await tx.userTaskProgress.findMany({
        where: { tenantId: input.tenantId, taskDefinitionId: mission.id },
        select: { status: true },
      });

      const claims = progress.filter((row) => row.status === 'CLAIMED').length;
      const completions = progress.filter(
        (row) => row.status === 'COMPLETED' || row.status === 'CLAIMED',
      ).length;

      await tx.taskDefinition.update({
        where: { id: mission.id },
        data: { deletedAt: new Date(), isActive: false, isVisible: false },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'task_definition',
          entityId: mission.id,
          changes: {
            name: { from: mission.name, to: null },
            pessoasQueProgrediram: { from: null, to: String(completions) },
            resgates: { from: null, to: String(claims) },
          },
        },
        tx,
      );

      return { ok: true as const, completions, claims };
    });
  } catch (error) {
    console.error(`[admin] falha ao excluir missão: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível excluir a missão.' };
  }
}

export interface AdminCardRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  lore: string | null;
  rarity: CardRarity;
  /**
   * O gatilho como tipo do DOMÍNIO, e não `string`: é o que permite o catálogo indexar
   * o mapa de rótulos com o tipo fechado — `Record<CardTrigger, string>` — e assim o
   * compilador reprovar um gatilho novo que chegue à tela sem nome em português.
   */
  trigger: CardTrigger;
  levelRequired: number;
  maxSupply: number;
  mintedCount: number;
  dropWeight: number;
  isActive: boolean;
  isSecret: boolean;
  palette: unknown;
  art: unknown;
  /** Condição extra do gatilho (`{threshold}`/`{streak}`/`{level}`), para editar sem perder. */
  triggerCondition: unknown;
  ownedBy: number;
  /** Missões que a usam como prêmio (a exclusão é recusada enquanto houver). */
  usedByMissions: number;
  /** QRs de patrocinador que a concedem (idem). */
  usedByQrCodes: number;
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
        description: true,
        lore: true,
        rarity: true,
        trigger: true,
        levelRequired: true,
        maxSupply: true,
        mintedCount: true,
        dropWeight: true,
        isActive: true,
        isSecret: true,
        palette: true,
        art: true,
        triggerCondition: true,
        eventId: true,
        /**
         * As três contagens que a tela precisa para não deixar a organização excluir
         * uma carta no escuro (FASE 43): quantas pessoas já a ganharam (o álbum delas
         * NÃO muda com a exclusão) e onde ela é PRÊMIO — missão e QR de patrocinador
         * (aí a exclusão é recusada, porque sumiria com uma promessa em vigor).
         */
        _count: { select: { userCards: true, taskDefinitions: true, sponsorQrCodes: true } },
      },
    }),
  );

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    lore: row.lore,
    rarity: row.rarity,
    trigger: row.trigger,
    levelRequired: row.levelRequired,
    maxSupply: row.maxSupply,
    mintedCount: row.mintedCount,
    dropWeight: row.dropWeight,
    isActive: row.isActive,
    isSecret: row.isSecret,
    palette: row.palette,
    art: row.art,
    triggerCondition: row.triggerCondition,
    ownedBy: row._count.userCards,
    usedByMissions: row._count.taskDefinitions,
    usedByQrCodes: row._count.sponsorQrCodes,
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
  description: string | null;
  kind: string;
  trigger: string;
  target: unknown;
  xpReward: number;
  rewardCardSlug: string | null;
  rewardCardTemplateId: string | null;
  repeatEveryHours: number;
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
        description: true,
        kind: true,
        trigger: true,
        target: true,
        xpReward: true,
        rewardCardTemplateId: true,
        repeatEveryHours: true,
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
    description: row.description,
    kind: row.kind,
    trigger: row.trigger,
    target: row.target,
    xpReward: row.xpReward,
    rewardCardSlug: row.rewardCard?.slug ?? null,
    rewardCardTemplateId: row.rewardCardTemplateId,
    repeatEveryHours: row.repeatEveryHours,
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
