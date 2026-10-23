'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Arquivo do catálogo: restaurar carta e missão (FASE 51 · E58)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GUARDA É A MESMA DA EXCLUSÃO, E NÃO O BOTÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem pode excluir pode restaurar — é a MESMA permissão (`card-template:manage` e
 *  `task:manage`), e não uma nova: restaurar é o inverso do ato que a pessoa já pode
 *  praticar, e uma permissão separada só criaria o caso esquisito de quem exclui e não
 *  consegue desfazer.
 *
 *  Cada ação resolve sessão, vínculo e permissão ANTES de tocar em qualquer dado.
 *  Esconder o botão na tela é conveniência; a barreira é aqui — uma Server Action é um
 *  endpoint HTTP, e nada impede alguém de postar nela sem passar pela listagem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { restoreCardTemplate, restoreMission } from '@/lib/admin/catalog-archive-service';

export interface CatalogArchiveActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
}

export async function restoreCardTemplateAction(
  _prev: CatalogArchiveActionState | null,
  formData: FormData,
): Promise<CatalogArchiveActionState> {
  const auth = await guardAction<CatalogArchiveActionState>({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    permission: PERMISSIONS.CARD_TEMPLATE_MANAGE,
  });
  if (!auth.ok) return auth.state;

  const cardTemplateId = String(formData.get('cardTemplateId') ?? '');
  if (!z.string().uuid().safeParse(cardTemplateId).success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Carta inválida.' };
  }

  const result = await restoreCardTemplate({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    cardTemplateId,
  });

  /**
   * As DUAS vistas são revalidadas: a carta sai da lista de arquivados e volta para o
   * catálogo ativo. Revalidar só a tela atual deixaria a outra mentindo por um
   * `router.refresh()` inteiro — e é comum o organizador alternar entre as duas.
   */
  const slug = String(formData.get('tenantSlug') ?? '');
  revalidatePath(tenantPath(slug, '/administracao/cartas'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return {
    ok: true,
    message: result.archivedByName
      ? `Carta "${result.name}" restaurada. Ela havia sido arquivada por ${result.archivedByName}.`
      : `Carta "${result.name}" restaurada ao catálogo ativo.`,
  };
}

export async function restoreMissionAction(
  _prev: CatalogArchiveActionState | null,
  formData: FormData,
): Promise<CatalogArchiveActionState> {
  const auth = await guardAction<CatalogArchiveActionState>({
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
    permission: PERMISSIONS.TASK_MANAGE,
  });
  if (!auth.ok) return auth.state;

  const taskDefinitionId = String(formData.get('taskDefinitionId') ?? '');
  if (!z.string().uuid().safeParse(taskDefinitionId).success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Missão inválida.' };
  }

  const result = await restoreMission({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    taskDefinitionId,
  });

  const slug = String(formData.get('tenantSlug') ?? '');
  revalidatePath(tenantPath(slug, '/administracao/missoes'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  return {
    ok: true,
    /**
     * A mensagem diz o que NÃO mudou: o progresso de quem já avançou e o XP resgatado
     * continuam como estavam — a exclusão nunca os tocou, e a restauração também não.
     */
    message: `Missão "${result.name}" restaurada. O progresso de quem já avançou continua valendo.`,
  };
}
