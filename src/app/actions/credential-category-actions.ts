'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — CATEGORIA do crachá (FASE 51 · dívida E42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM ARQUIVO NOVO, E NÃO MAIS UMA AÇÃO EM `credential-actions.ts`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Trocar a categoria é uma escrita DIFERENTE das outras três do crachá (emitir,
 *  revogar, fechar presença): ela muda a identidade da etiqueta sem mexer no
 *  código, e é a única que a recepção usa DEPOIS do evento começar — quando a
 *  pessoa chega na porta e a faixa está errada. O arquivo próprio também é a
 *  convenção da casa: arquivo NOVO em vez de editar o existente.
 *
 *  A autorização é a mesma da área de crachás (`attendance:manage`, aceitando o
 *  escopo de EVENTO — quem opera a porta é a equipe do dia, FASE 12/I7), conferida
 *  AQUI: uma Server Action é um endpoint HTTP como qualquer outro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { guardAction, type ActionGuardState } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { setCredentialCategory } from '@/lib/events/credential-service';
import { isKnownCredentialCategory, resolveCredentialCategory } from '@/domain/events/credential-rules';

export type CredentialCategoryActionState = ActionGuardState;

export async function setCredentialCategoryAction(
  _prev: CredentialCategoryActionState | null,
  formData: FormData,
): Promise<CredentialCategoryActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      credentialId: z.string().uuid(),
      category: z.string().trim().min(1).max(20),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      credentialId: formData.get('credentialId'),
      category: formData.get('category'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para mudar a categoria.' };
  }

  /**
   * Categoria fora do catálogo é RECUSADA, e não trocada pelo padrão: a tela
   * oferece uma lista fechada, então um valor desconhecido chegou por requisição
   * montada à mão — e gravar "participante" no lugar apagaria a categoria anterior
   * sem ninguém ter pedido.
   */
  if (!isKnownCredentialCategory(parsed.data.category)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Categoria desconhecida. Escolha uma das categorias da lista.',
    };
  }

  const auth = await guardAction({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.ATTENDANCE_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    eventId: parsed.data.eventId,
  });

  if (!auth.ok) return auth.state;

  const result = await setCredentialCategory({
    tenantId: auth.tenantId,
    credentialId: parsed.data.credentialId,
    actorId: auth.userId,
    category: parsed.data.category,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/credenciamento/crachas'));

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  const definition = resolveCredentialCategory(result.category);

  /**
   * A mensagem diz que a ETIQUETA já impressa mudou de significado: quem troca a
   * categoria de um crachá que está na mão de alguém precisa saber que a faixa no
   * papel continua a antiga até reimprimir — e é por isso que a área de crachás
   * mostra "impresso" ao lado.
   */
  return {
    ok: true,
    message: `Categoria alterada para ${definition.label}. A etiqueta já impressa continua com a faixa anterior até ser reimpressa.`,
    data: { category: definition.key, label: definition.label, color: definition.color },
  };
}
