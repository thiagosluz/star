/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Arquivo e restauração do catálogo (FASE 51 · dívida E58)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA QUE ESTE MÓDULO RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A exclusão de carta e de missão é LÓGICA desde a FASE 43, e todas as leituras
 *  filtram `deletedAt: null`: o item desaparecia das telas e não havia onde vê-lo de
 *  novo. Quem excluísse por engano dependia de `UPDATE deleted_at = NULL` no banco.
 *
 *  Aqui vive a outra metade: a LEITURA da trilha que explica cada item arquivado
 *  (quando e por quem foi excluído — a trilha guarda isso desde a FASE 43) e a
 *  RESTAURAÇÃO, que é o inverso exato do arquivamento.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A RESTAURAÇÃO NÃO É "SÓ ZERAR O deletedAt"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Três armadilhas, todas resolvidas neste arquivo:
 *
 *   1. **Colisão.** O nome da carta/missão NÃO é único (o índice único é
 *      `(tenantId, slug)`, e é TOTAL — vale para as linhas arquivadas também). Isso
 *      significa duas coisas opostas, e as duas importam:
 *        • o SLUG continua reservado enquanto o item está arquivado, então ninguém
 *          consegue criar um item novo com ele (é por isso que a colisão de slug é
 *          impossível hoje — a checagem existe como catraca, ver abaixo);
 *        • o NOME fica livre, e é perfeitamente possível criar "Carta de Boas-vindas"
 *          nova enquanto a antiga está arquivada. Restaurar a antiga produziria DUAS
 *          cartas ativas com o mesmo nome — e a lista da organização, que é ordenada
 *          por nome, passaria a mostrar duas linhas idênticas. É recusado, com o
 *          nome de quem está ocupando o lugar.
 *
 *   2. **Corrida.** Duas abas restaurando o mesmo item: a escrita é um `updateMany`
 *      CONDICIONAL (`deletedAt` ainda não nulo), e zero linhas é resposta de negócio
 *      ("já está ativa"), não erro (invariante nº 5).
 *
 *   3. **Rastro.** A trilha guarda as DUAS pontas: o `deletedAt` que sai (a data em
 *      que o item foi arquivado) e o que entra (nulo). Sem isso, a única prova de que
 *      ele voltou seria a ausência dele na lista de arquivados.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import type { AdminResult } from '@/lib/admin/catalog-service';

/**
 * Os `entityType` da trilha, em UM lugar só.
 *
 * Os dois lados da jornada (a exclusão da FASE 43 e a restauração daqui) precisam
 * escrever a MESMA string: o dia em que um deles mudar, a lista de arquivados perde
 * a data e o autor em silêncio — a tela mostraria "arquivada" sem dizer quando nem
 * por quem, e ninguém desconfiaria de um typo.
 */
export const CATALOG_ENTITY_TYPE = {
  card: 'card_template',
  mission: 'task_definition',
} as const;

export interface CatalogArchiveEntry {
  entityId: string;
  /** Quando o item foi arquivado (a trilha da EXCLUSÃO). */
  at: Date;
  /** Quem arquivou. `null` quando a conta já não existe (a FK é `SetNull`). */
  byName: string | null;
}

/**
 * A trilha de arquivamento de VÁRIOS itens, em UMA consulta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO É UMA CONSULTA POR LINHA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A lista de arquivados mostra o autor e a data em cada item. Buscar a trilha dentro
 *  do laço de renderização seria N+1 consultas numa tela que lista até 200 itens — o
 *  mesmo defeito que a leitura do quadro de demandas evita. Aqui é um `findMany` só,
 *  com os ids da página, e o mais recente de cada entidade vence (um item pode ter
 *  sido excluído, restaurado e excluído de novo; a data que interessa é a última).
 *
 *  Recebe o `tx` de quem já está com o contexto de instituição aberto: abrir uma
 *  transação nova aqui dentro seria uma segunda conexão para ler o que a primeira
 *  acabou de listar.
 */
export async function readCatalogArchiveTrail(
  tx: TxClient,
  input: { tenantId: string; entityType: string; entityIds: readonly string[] },
): Promise<Map<string, CatalogArchiveEntry>> {
  const trail = new Map<string, CatalogArchiveEntry>();
  if (input.entityIds.length === 0) return trail;

  const rows = await tx.auditLog.findMany({
    where: {
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: { in: [...input.entityIds] },
      action: 'DELETE',
    },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, createdAt: true, user: { select: { name: true } } },
  });

  for (const row of rows) {
    if (!row.entityId || trail.has(row.entityId)) continue;

    trail.set(row.entityId, {
      entityId: row.entityId,
      at: row.createdAt,
      byName: row.user?.name ?? null,
    });
  }

  return trail;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cartas
// ───────────────────────────────────────────────────────────────────────────────
export async function restoreCardTemplate(input: {
  tenantId: string;
  actorId: string;
  cardTemplateId: string;
}): Promise<AdminResult<{ name: string; archivedAt: Date; archivedByName: string | null }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      /**
       * A leitura NÃO filtra `deletedAt`: é justamente o estado arquivado que se quer
       * saber, e um `where` com `deletedAt: { not: null }` responderia "não encontrada"
       * para quem clicasse duas vezes — a mensagem errada para o caso mais provável.
       */
      const card = await tx.cardTemplate.findFirst({
        where: { id: input.cardTemplateId, tenantId: input.tenantId },
        select: { id: true, name: true, slug: true, deletedAt: true },
      });

      if (!card) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Carta não encontrada.' };
      }

      if (card.deletedAt === null) {
        return {
          ok: false as const,
          code: 'ALREADY_ACTIVE' as const,
          message: 'Esta carta já está no catálogo ativo.',
        };
      }

      const archivedAt = card.deletedAt;

      const clash = await tx.cardTemplate.findFirst({
        where: {
          tenantId: input.tenantId,
          deletedAt: null,
          id: { not: card.id },
          /**
           * O NOME é a colisão possível: o slug continua reservado pelo índice único
           * TOTAL `(tenantId, slug)`, que vale também para a linha arquivada. A
           * checagem de slug fica como CATRACA — o dia em que alguém tornar aquele
           * índice parcial (para liberar o slug de quem foi excluído), a restauração
           * passa a ter colisão real e é recusada aqui, e não com um erro de banco.
           */
          OR: [{ name: card.name }, { slug: card.slug }],
        },
        select: { id: true, name: true, slug: true },
      });

      if (clash) {
        return {
          ok: false as const,
          code: 'ARCHIVE_CONFLICT' as const,
          message: `Já existe uma carta ativa chamada "${clash.name}". Renomeie uma das duas antes de restaurar — duas cartas com o mesmo nome deixariam a lista ambígua.`,
          details: [`Carta ativa em conflito: ${clash.name} (${clash.slug}).`],
        };
      }

      /**
       * ── A ESCRITA É CONDICIONAL (invariante nº 5) ─────────────────────────────
       *  `deletedAt: { not: null }` no `where`: se outra pessoa restaurou entre a
       *  leitura e a escrita, zero linhas voltam e a resposta é de NEGÓCIO. Um
       *  `update` por id sobrescreveria sem perceber — e a trilha registraria duas
       *  restaurações de um item que só voltou uma vez.
       */
      const restored = await tx.cardTemplate.updateMany({
        where: { id: card.id, tenantId: input.tenantId, deletedAt: { not: null } },
        /**
         * `isActive: true` faz parte do inverso: a exclusão DESLIGOU a carta para ela
         * parar de ser sorteada, e restaurar é "voltar a valer". (Se ela já estava
         * inativa antes de ser arquivada, isso não tem como ser sabido: a trilha da
         * exclusão não guardou o valor anterior. Restaurar e depois desativar é um
         * clique na própria tela.)
         */
        data: { deletedAt: null, isActive: true },
      });

      if (restored.count === 0) {
        return {
          ok: false as const,
          code: 'ALREADY_ACTIVE' as const,
          message: 'Esta carta já foi restaurada por outra pessoa.',
        };
      }

      const trail = await readCatalogArchiveTrail(tx, {
        tenantId: input.tenantId,
        entityType: CATALOG_ENTITY_TYPE.card,
        entityIds: [card.id],
      });

      const archivedByName = trail.get(card.id)?.byName ?? null;

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          /**
           * `UPDATE`, e não uma ação nova: o enum `AuditAction` vive no schema (e o
           * banco não ganha valor novo sem migração). O fato é exatamente "a mesma
           * linha, uma coluna de volta" — e as duas pontas ficam gravadas abaixo, que
           * é o que a auditoria precisa ler depois.
           */
          action: 'UPDATE',
          entityType: CATALOG_ENTITY_TYPE.card,
          entityId: card.id,
          changes: {
            name: { from: null, to: card.name },
            deletedAt: { from: archivedAt, to: null },
            estado: { from: 'arquivada', to: 'ativa' },
          },
        },
        tx,
      );

      return { ok: true as const, name: card.name, archivedAt, archivedByName };
    });
  } catch (error) {
    console.error(`[admin] falha ao restaurar carta: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível restaurar a carta.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Missões
// ───────────────────────────────────────────────────────────────────────────────
export async function restoreMission(input: {
  tenantId: string;
  actorId: string;
  taskDefinitionId: string;
}): Promise<AdminResult<{ name: string; archivedAt: Date; archivedByName: string | null }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const mission = await tx.taskDefinition.findFirst({
        where: { id: input.taskDefinitionId, tenantId: input.tenantId },
        select: { id: true, name: true, slug: true, deletedAt: true },
      });

      if (!mission) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Missão não encontrada.' };
      }

      if (mission.deletedAt === null) {
        return {
          ok: false as const,
          code: 'ALREADY_ACTIVE' as const,
          message: 'Esta missão já está ativa.',
        };
      }

      const archivedAt = mission.deletedAt;

      const clash = await tx.taskDefinition.findFirst({
        where: {
          tenantId: input.tenantId,
          deletedAt: null,
          id: { not: mission.id },
          OR: [{ name: mission.name }, { slug: mission.slug }],
        },
        select: { id: true, name: true, slug: true },
      });

      if (clash) {
        return {
          ok: false as const,
          code: 'ARCHIVE_CONFLICT' as const,
          message: `Já existe uma missão ativa chamada "${clash.name}". Renomeie uma das duas antes de restaurar — duas missões com o mesmo nome deixariam a lista ambígua.`,
          details: [`Missão ativa em conflito: ${clash.name} (${clash.slug}).`],
        };
      }

      const restored = await tx.taskDefinition.updateMany({
        where: { id: mission.id, tenantId: input.tenantId, deletedAt: { not: null } },
        /**
         * `isActive` E `isVisible` voltam ligados: foram as duas colunas que a exclusão
         * desligou (a missão saiu da lista de quem joga). O PROGRESSO das pessoas nunca
         * foi tocado — nem na exclusão, nem aqui: quem tinha 2 de 3 presenças continua
         * com 2 de 3, e o XP já resgatado continua creditado.
         */
        data: { deletedAt: null, isActive: true, isVisible: true },
      });

      if (restored.count === 0) {
        return {
          ok: false as const,
          code: 'ALREADY_ACTIVE' as const,
          message: 'Esta missão já foi restaurada por outra pessoa.',
        };
      }

      const trail = await readCatalogArchiveTrail(tx, {
        tenantId: input.tenantId,
        entityType: CATALOG_ENTITY_TYPE.mission,
        entityIds: [mission.id],
      });

      const archivedByName = trail.get(mission.id)?.byName ?? null;

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: CATALOG_ENTITY_TYPE.mission,
          entityId: mission.id,
          changes: {
            name: { from: null, to: mission.name },
            deletedAt: { from: archivedAt, to: null },
            estado: { from: 'arquivada', to: 'ativa' },
          },
        },
        tx,
      );

      return { ok: true as const, name: mission.name, archivedAt, archivedByName };
    });
  } catch (error) {
    console.error(`[admin] falha ao restaurar missão: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL', message: 'Não foi possível restaurar a missão.' };
  }
}
