/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Histórico de versões da página pública (FASE 23, item E12)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GRAVAÇÃO ACONTECE NA MESMA TRANSAÇÃO DA ALTERAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `appendVersion` recebe o `tx` da mutação. Se a alteração falhar, não existe
 *  versão de um estado que nunca vigorou — o mesmo raciocínio da trilha de
 *  auditoria. E se a versão falhar, a alteração não fica pela metade: as duas coisas
 *  são o mesmo fato.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A VERSÃO É O ESTADO DEPOIS DA ALTERAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A alternativa seria guardar o estado ANTERIOR (para "desfazer" um passo). Guardar
 *  o estado resultante é melhor aqui por dois motivos: o histórico mostra o que a
 *  página era em cada momento (inclusive para conferir o que estava no ar quando um
 *  problema apareceu) e restaurar é aplicar uma versão, sem depender de qual foi a
 *  última operação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { BLOCK_ORDER_STEP, type PageBlockType } from '@/domain/events/landing-page';
import {
  MAX_PAGE_VERSIONS,
  PAGE_VERSION_REASONS,
  shouldRecordVersion,
  snapshotChecksum,
  snapshotToBlockRows,
  summarizeSnapshot,
  versionsToPrune,
  type PageSnapshot,
  type PageVersionReason,
} from '@/domain/events/page-version-rules';

export type PageVersionErrorCode = 'NOT_FOUND' | 'INVALID_INPUT' | 'INTERNAL';

export type PageVersionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: PageVersionErrorCode; message: string };

// ───────────────────────────────────────────────────────────────────────────────
//  Snapshot a partir do estado gravado
// ───────────────────────────────────────────────────────────────────────────────
interface PageRowForSnapshot {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  isPublished: boolean;
  publishAt: Date | null;
  blocks: {
    id: string;
    type: string;
    content: unknown;
    displayOrder: number;
    isVisible: boolean;
  }[];
}

/**
 * Monta o snapshot do estado vigente.
 *
 * A ordenação dos blocos é a MESMA da renderização pública (`displayOrder`, com
 * desempate por id). Isso não é estética: o checksum é calculado sobre o snapshot, e
 * duas ordens diferentes para o mesmo estado fariam a marcação "versão atual" nunca
 * casar — o histórico mostraria todas as versões como antigas.
 */
function toSnapshot(page: PageRowForSnapshot): PageSnapshot {
  return {
    title: page.title,
    metaTitle: page.metaTitle,
    metaDescription: page.metaDescription,
    isPublished: page.isPublished,
    publishAt: page.publishAt?.toISOString() ?? null,
    blocks: [...page.blocks]
      .sort((a, b) => {
        if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
        return a.id.localeCompare(b.id);
      })
      .map((block) => ({
        type: block.type as PageBlockType,
        content: block.content,
        displayOrder: block.displayOrder,
        isVisible: block.isVisible,
      })),
  };
}

const SNAPSHOT_BLOCK_SELECT = {
  select: { id: true, type: true, content: true, displayOrder: true, isVisible: true },
} as const;

// ───────────────────────────────────────────────────────────────────────────────
//  Gravação (dentro da transação da alteração)
// ───────────────────────────────────────────────────────────────────────────────
export interface AppendVersionInput {
  tenantId: string;
  pageId: string;
  actorId: string;
  reason: PageVersionReason;
}

export interface AppendVersionOutcome {
  recorded: boolean;
  versionId: string | null;
  checksum: string;
}

/**
 * Grava uma versão da página, se o conteúdo mudou.
 *
 * Devolve `recorded: false` quando o estado é idêntico ao da última versão — e isso
 * não é erro: é o que impede vinte linhas iguais na história depois de vinte
 * salvamentos sem alteração.
 */
export async function appendVersion(
  tx: TxClient,
  input: AppendVersionInput,
): Promise<AppendVersionOutcome> {
  const page = await tx.eventPage.findFirst({
    where: { id: input.pageId, tenantId: input.tenantId },
    select: {
      id: true,
      title: true,
      metaTitle: true,
      metaDescription: true,
      isPublished: true,
      publishAt: true,
      blocks: SNAPSHOT_BLOCK_SELECT,
    },
  });

  if (!page) {
    throw new Error(`Página ${input.pageId} não encontrada ao gravar versão.`);
  }

  const snapshot = toSnapshot(page);
  const checksum = snapshotChecksum(snapshot);

  const recent = await tx.eventPageVersion.findMany({
    where: { pageId: page.id },
    // `id` desempata: ele é uuid v7, ordenável no tempo, e duas versões gravadas no
    // mesmo milissegundo não podem depender da ordem de retorno do banco.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, checksum: true },
  });

  if (!shouldRecordVersion(recent[0]?.checksum ?? null, snapshot)) {
    return { recorded: false, versionId: null, checksum };
  }

  const versionId = randomUUID();

  await tx.eventPageVersion.create({
    data: {
      id: versionId,
      tenantId: input.tenantId,
      pageId: page.id,
      reason: input.reason.slice(0, 120),
      snapshot: snapshot as unknown as object,
      checksum,
      createdById: input.actorId,
    },
  });

  /**
   * Retenção: mantém as `MAX_PAGE_VERSIONS` mais recentes.
   *
   * Sem teto, o histórico de uma página editada por anos cresceria sem limite dentro
   * do banco transacional — e o valor de uma versão de dois anos atrás é próximo de
   * zero para quem opera o evento.
   */
  const prune = versionsToPrune([{ id: versionId }, ...recent]);

  if (prune.length > 0) {
    await tx.eventPageVersion.deleteMany({ where: { id: { in: prune } } });
  }

  return { recorded: true, versionId, checksum };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura
// ───────────────────────────────────────────────────────────────────────────────
export interface PageVersionRow {
  id: string;
  reason: string;
  createdAt: Date;
  actorName: string | null;
  blockCount: number;
  types: PageBlockType[];
  isPublished: boolean;
  publishAt: Date | null;
  /** É a versão que corresponde ao estado atual da página? */
  isCurrent: boolean;
}

export interface PageVersionHistory {
  pageId: string;
  versions: PageVersionRow[];
  max: number;
}

/**
 * Lista o histórico, marcando qual versão corresponde ao estado atual.
 *
 * A marcação vem do checksum: a primeira versão cuja impressão digital é a do estado
 * vigente é a atual. Comparar por conteúdo (e não por "a mais recente") é o que faz
 * a marca continuar correta depois de uma restauração — que grava uma versão nova.
 */
export async function listPageVersions(
  tenantId: string,
  eventId: string,
): Promise<PageVersionHistory | null> {
  return withTenant(tenantId, async (tx) => {
    const page = await tx.eventPage.findFirst({
      where: { eventId, tenantId, deletedAt: null },
      orderBy: [{ isHome: 'desc' }, { displayOrder: 'asc' }],
      select: {
        id: true,
        title: true,
        metaTitle: true,
        metaDescription: true,
        isPublished: true,
        publishAt: true,
        blocks: SNAPSHOT_BLOCK_SELECT,
        versions: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_PAGE_VERSIONS,
          select: {
            id: true,
            reason: true,
            checksum: true,
            snapshot: true,
            createdAt: true,
            createdBy: { select: { name: true } },
          },
        },
      },
    });

    if (!page) return null;

    const currentChecksum = snapshotChecksum(toSnapshot(page));

    /**
     * Só a versão MAIS RECENTE que casa com o estado atual é marcada.
     *
     * Duas versões podem ter o mesmo conteúdo (publicar, editar, restaurar o texto
     * anterior devolve exatamente o estado publicado). Marcar as duas com "estado
     * atual" é tecnicamente verdadeiro e visualmente confuso — uma lista com dois
     * selos iguais não diz qual deles é o vigente.
     */
    let currentAssigned = false;

    return {
      pageId: page.id,
      max: MAX_PAGE_VERSIONS,
      versions: page.versions.map((version) => {
        const summary = summarizeSnapshot(version.snapshot);
        const matchesCurrent = !currentAssigned && version.checksum === currentChecksum;
        if (matchesCurrent) currentAssigned = true;

        return {
          id: version.id,
          reason: version.reason,
          createdAt: version.createdAt,
          actorName: version.createdBy?.name ?? null,
          blockCount: summary.blockCount,
          types: summary.types,
          isPublished: summary.isPublished,
          publishAt: summary.publishAt ? new Date(summary.publishAt) : null,
          isCurrent: matchesCurrent,
        };
      }),
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Restauração
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Restaura a página a partir de uma versão.
 *
 * Substituição TOTAL dos blocos (`deleteMany` + `createMany`), pela mesma razão da
 * edição de autoria: a ordem gravada é reescrita do zero, e tentar reconciliar bloco
 * a bloco exigiria decidir o que fazer com os que não existem mais no snapshot —
 * decisão que ninguém quer tomar no meio de um evento.
 *
 * A restauração GRAVA UMA VERSÃO NOVA. Sem isso, o histórico teria um salto: as
 * versões entre a restaurada e a atual continuariam listadas como se nada tivesse
 * acontecido, e o próximo a olhar o histórico concluiria que o estado atual é o
 * antigo.
 */
export async function restorePageVersion(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  versionId: string;
}): Promise<PageVersionResult<{ pageId: string; restoredFrom: Date; blockCount: number }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const version = await tx.eventPageVersion.findFirst({
        where: { id: input.versionId, tenantId: input.tenantId },
        select: {
          id: true,
          pageId: true,
          createdAt: true,
          snapshot: true,
          page: { select: { id: true, eventId: true, title: true } },
        },
      });

      if (!version || version.page.eventId !== input.eventId) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Versão não encontrada.' };
      }

      const snapshot = version.snapshot as unknown as PageSnapshot;

      if (!Array.isArray(snapshot.blocks)) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: 'A versão escolhida está corrompida e não pode ser restaurada.',
        };
      }

      await tx.eventPage.update({
        where: { id: version.pageId },
        data: {
          title: snapshot.title,
          metaTitle: snapshot.metaTitle,
          metaDescription: snapshot.metaDescription,
          // Publicação NÃO é restaurada: voltar um texto não deve republicar (nem
          // despublicar) a página. Quem decide o que está no ar é o organizador,
          // agora — este é o tipo de efeito colateral que ninguém espera de um
          // "desfazer".
          blocks: {
            deleteMany: {},
            createMany: {
              data: snapshotToBlockRows(snapshot, BLOCK_ORDER_STEP).map((block) => ({
                id: randomUUID(),
                tenantId: input.tenantId,
                type: block.type,
                content: block.content as unknown as object,
                displayOrder: block.displayOrder,
                isVisible: block.isVisible,
              })),
            },
          },
        },
      });

      await appendVersion(tx, {
        tenantId: input.tenantId,
        pageId: version.pageId,
        actorId: input.actorId,
        reason: PAGE_VERSION_REASONS.RESTORED,
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'eventPage',
          entityId: version.pageId,
          changes: {
            restoredFrom: { from: null, to: version.createdAt.toISOString() },
            blocks: { from: null, to: snapshot.blocks.length },
          },
        },
        tx,
      );

      return {
        ok: true as const,
        pageId: version.pageId,
        restoredFrom: version.createdAt,
        blockCount: snapshot.blocks.length,
      };
    });
  } catch (error) {
    console.error(`[page-version] falha ao restaurar: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL' as const,
      message: 'Não foi possível restaurar a versão escolhida.',
    };
  }
}
