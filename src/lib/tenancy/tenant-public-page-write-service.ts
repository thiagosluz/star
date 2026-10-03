/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Gravação e publicação da página da instituição
 *                                                            (FASE 64 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CONTRATO DE RETORNO É O DA CASA: ERRO É VALOR, NÃO EXCEÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nada aqui lança para o chamador. Uma Server Action que lança produz um erro
 *  genérico na tela — e "não foi possível salvar" não diz a quem está editando se o
 *  problema foi um bloco com a linha de perguntas frequentes pela metade, um tema
 *  com cor fora do contrato ou uma página que não existe. Cada um desses casos tem
 *  `code` e `message` próprios, e a fatia 3 os desenha sem inventar texto.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  RASCUNHO E PUBLICADO SÃO ATOS DIFERENTES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `saveTenantPublicPageDraft` grava o rascunho. Ele NÃO mexe no que está no ar —
 *  essa é a promessa inteira de "publicado × rascunho", e a única forma de o
 *  visitante nunca ver uma página pela metade. `publishTenantPublicPage` copia o
 *  rascunho para o snapshot publicado, com data e autor. `unpublishTenantPublicPage`
 *  tira do ar sem apagar o trabalho.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TRILHA É A MESMA DO EVENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `recordAudit` com `AuditAction.CREATE`/`UPDATE` — exatamente as ações que a
 *  página do evento usa (`landing-service.ts`, `page-version-service.ts`). Não há
 *  ação nova para inventar aqui: publicar uma página é um `UPDATE` no mesmo sentido
 *  do evento, e `entityType: 'tenantPublicPage'` é o que distingue as duas na
 *  consulta da trilha.
 *
 *  O diff registrado é um RESUMO estrutural (quantos blocos, quais tipos, qual
 *  título), e não o conteúdo dos blocos: a trilha não é um segundo banco de dados da
 *  página, e despejar o snapshot inteiro nela encheria a auditoria de dados que já
 *  têm dono — o mesmo critério de `sanitizeChanges` em `lib/admin/audit.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { recordAudit } from '@/lib/admin/audit';
import { errorMessage } from '@/lib/db/prisma-errors';
import {
  validateTenantPage,
  type TenantPageBlock,
  type TenantPageBlockType,
  type TenantPageInput,
  type TenantPageSnapshot,
} from '@/domain/tenancy/tenant-public-page';
import {
  findTenantPublicPage,
  insertTenantPublicPage,
  publishTenantPublicPage as publishRow,
  toDraftSnapshot,
  unpublishTenantPublicPage as unpublishRow,
  updateTenantPublicPageDraft,
  type TenantPublicPageRow,
} from '@/lib/tenancy/tenant-public-page-repository';
import { toAdminView, type AdminTenantPageView } from '@/lib/tenancy/tenant-public-page-view';

export type TenantPageWriteResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: TenantPageWriteErrorCode; message: string };

export type TenantPageWriteErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'NOTHING_TO_PUBLISH'
  | 'UNEXPECTED';

export interface SaveTenantPageInput extends TenantPageInput {
  tenantId: string;
  /** Quem está gravando — vai para a trilha. */
  actorId: string;
}

/**
 * Grava o rascunho.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A PÁGINA NASCE NA PRIMEIRA GRAVAÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  A alternativa seria exigir um "criar página" antes do primeiro bloco — uma tela
 *  a mais para o mesmo ato. Aqui o `INSERT` e o `UPDATE` levam ao mesmo resultado, e
 *  a trilha registra qual dos dois aconteceu: quem lê a auditoria vê "página criada"
 *  e depois "rascunho alterado", sem que a tela precise saber a diferença.
 */
export async function saveTenantPublicPageDraft(
  input: SaveTenantPageInput,
): Promise<TenantPageWriteResult<{ page: AdminTenantPageView }>> {
  if (!input.actorId) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A gravação precisa de um autor identificado.',
    };
  }

  const validation = validateTenantPage(input);

  if (!validation.ok) {
    return { ok: false, code: 'INVALID_INPUT', message: validation.message };
  }

  const snapshot = validation.snapshot;

  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const existing = await findTenantPublicPage(input.tenantId, tx);

      if (!existing) {
        const id = randomUUID();
        await insertTenantPublicPage(tx, { id, tenantId: input.tenantId, snapshot });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'CREATE',
            entityType: 'tenantPublicPage',
            entityId: id,
            changes: { title: { from: null, to: snapshot.title } },
          },
          tx,
        );

        const created = await findTenantPublicPage(input.tenantId, tx);
        return { created: true, row: created };
      }

      await updateTenantPublicPageDraft(tx, { pageId: existing.id, snapshot });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'tenantPublicPage',
          entityId: existing.id,
          changes: draftDiff(existing, snapshot),
        },
        tx,
      );

      const updated = await findTenantPublicPage(input.tenantId, tx);
      return { created: false, row: updated };
    });

    if (!result.row) {
      return {
        ok: false,
        code: 'UNEXPECTED',
        message: 'A página foi gravada, mas não pôde ser relida.',
      };
    }

    return { ok: true, page: toAdminView(result.row) };
  } catch (error) {
    console.error(`[f64] falha ao gravar a página da instituição: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'UNEXPECTED',
      message: 'Não foi possível salvar a página da instituição.',
    };
  }
}

/**
 * Publica o RASCUNHO ATUAL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PUBLICAÇÃO NÃO ACEITA CONTEÚDO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Publicar é um ato sobre o que JÁ ESTÁ gravado. Aceitar o conteúdo junto abriria a
 *  porta para uma tela publicar algo que ninguém salvou — e, pior, para a versão no
 *  ar não corresponder ao rascunho que o organizador acabou de ver. A tela salva e
 *  depois publica; se as duas chamadas vierem na ordem errada, o que vai ao ar é o
 *  rascunho real.
 *
 *  Publicar duas vezes é idempotente: a segunda publicação regrava o mesmo snapshot
 *  e atualiza a data. A trilha registra as duas, porque "quando foi republicada" é
 *  informação de operação.
 */
export async function publishTenantPublicPage(input: {
  tenantId: string;
  actorId: string;
  now?: Date;
}): Promise<TenantPageWriteResult<{ page: AdminTenantPageView }>> {
  if (!input.actorId) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A publicação precisa de um autor identificado.',
    };
  }

  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const existing = await findTenantPublicPage(input.tenantId, tx);

      if (!existing) {
        return { code: 'NOT_FOUND' as const, row: null };
      }

      /**
       * O rascunho GRAVADO é revalidado antes de ir ao ar. Se ele foi escrito antes
       * de uma mudança de contrato (ou por um caminho que não passou pelo
       * validador), publicar às cegas colocaria um bloco inválido na página
       * pública — e o lugar de recusar isso é antes, não na renderização.
       */
      const revalidation = validateTenantPage({
        title: existing.title,
        description: existing.description,
        coverImageUrl: existing.coverImageUrl,
        logoUrl: existing.logoUrl,
        theme: existing.theme,
        blocks: existing.blocks,
      });

      if (!revalidation.ok) {
        return { code: 'NOTHING_TO_PUBLISH' as const, row: null, message: revalidation.message };
      }

      const publishedAt = input.now ?? new Date();

      await publishRow(tx, {
        pageId: existing.id,
        snapshot: revalidation.snapshot,
        actorId: input.actorId,
        publishedAt,
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'tenantPublicPage',
          entityId: existing.id,
          changes: {
            publishedAt: { from: existing.publishedAt, to: publishedAt },
            ...summarizeSnapshotChange(existing.publishedSnapshot, revalidation.snapshot),
          },
        },
        tx,
      );

      const updated = await findTenantPublicPage(input.tenantId, tx);
      return { code: 'OK' as const, row: updated };
    });

    if (result.code === 'NOT_FOUND') {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'A página da instituição ainda não foi criada.',
      };
    }

    if (result.code === 'NOTHING_TO_PUBLISH') {
      return {
        ok: false,
        code: 'NOTHING_TO_PUBLISH',
        message: result.message ?? 'O rascunho tem conteúdo que não pode ser publicado.',
      };
    }

    if (!result.row) {
      return {
        ok: false,
        code: 'UNEXPECTED',
        message: 'A publicação não pôde ser relida.',
      };
    }

    return { ok: true, page: toAdminView(result.row) };
  } catch (error) {
    console.error(`[f64] falha ao publicar a página da instituição: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'UNEXPECTED',
      message: 'Não foi possível publicar a página da instituição.',
    };
  }
}

/** Tira a página do ar — o rascunho permanece intacto para quem quiser voltar. */
export async function unpublishTenantPublicPage(input: {
  tenantId: string;
  actorId: string;
}): Promise<TenantPageWriteResult<{ page: AdminTenantPageView }>> {
  if (!input.actorId) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A despublicação precisa de um autor identificado.',
    };
  }

  try {
    const result = await withTenant(input.tenantId, async (tx) => {
      const existing = await findTenantPublicPage(input.tenantId, tx);

      if (!existing) return { found: false, row: null };

      await unpublishRow(tx, existing.id);

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'tenantPublicPage',
          entityId: existing.id,
          changes: {
            publishedAt: { from: existing.publishedAt, to: null },
            estado: { from: 'publicada', to: 'rascunho' },
          },
        },
        tx,
      );

      const updated = await findTenantPublicPage(input.tenantId, tx);
      return { found: true, row: updated };
    });

    if (!result.found || !result.row) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'A página da instituição ainda não foi criada.',
      };
    }

    return { ok: true, page: toAdminView(result.row) };
  } catch (error) {
    console.error(`[f64] falha ao despublicar a página da instituição: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'UNEXPECTED',
      message: 'Não foi possível tirar a página do ar.',
    };
  }
}

/**
 * O resumo do que mudou entre dois rascunhos, para a trilha.
 *
 * Só entra o que muda de forma legível: título, descrição, capa, tema e a ESTRUTURA
 * dos blocos (quantidade e tipos). O conteúdo dos blocos fica fora de propósito —
 * ver o cabeçalho.
 */
function draftDiff(
  previous: TenantPublicPageRow,
  next: TenantPageSnapshot,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (previous.title !== next.title) changes.title = { from: previous.title, to: next.title };
  if (previous.description !== next.description) changes.description = { from: previous.description, to: next.description };
  if (previous.coverImageUrl !== next.coverImageUrl) changes.capa = { from: previous.coverImageUrl, to: next.coverImageUrl };
  if (previous.logoUrl !== next.logoUrl) changes.logotipo = { from: previous.logoUrl, to: next.logoUrl };
  if (JSON.stringify(previous.theme ?? {}) !== JSON.stringify(next.theme ?? {})) {
    changes.tema = { from: 'anterior', to: 'alterado' };
  }

  Object.assign(changes, summarizeSnapshotChange(toDraftSnapshot(previous), next));

  return changes;
}

/** A estrutura dos blocos, em uma linha — nunca o conteúdo. */
function summarizeSnapshotChange(
  previous: TenantPageSnapshot | null,
  next: TenantPageSnapshot,
): Record<string, { from: unknown; to: unknown }> {
  const before = blockSummary(previous?.blocks ?? []);
  const after = blockSummary(next.blocks);

  if (before === after) return {};

  return { blocos: { from: before, to: after } };
}

function blockSummary(blocks: readonly TenantPageBlock[]): string {
  if (blocks.length === 0) return 'nenhum bloco';

  const types = blocks.map((block) => block.type as TenantPageBlockType);
  return `${blocks.length} bloco(s): ${types.join(', ')}`;
}
