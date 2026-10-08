'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — O formulário de inscrição do evento (FASE 70 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PERMISSÃO É `EVENT_UPDATE`, E ELA É CONFERIDA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Montar o formulário do evento é EDITAR O EVENTO: quem não pode mudar o título
 *  não pode decidir o que se pergunta a quem se inscreve. A guarda é a compartilhada
 *  (`guardAction`, FASE 31) — a mesma das outras telas de configuração —, e ela roda
 *  ANTES de qualquer leitura: esconder o formulário na tela é conveniência; a
 *  barreira é aqui, porque uma Server Action é um endpoint HTTP.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE TRÊS AÇÕES, E NÃO UMA COM UM CAMPO "OPERAÇÃO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada gesto da tela é um `<form>` próprio (é o que faz a tela funcionar sem
 *  JavaScript), e cada um tem o SEU conjunto de campos: salvar manda o campo inteiro,
 *  remover manda uma `key`, reordenar manda uma direção. Uma ação única receberia os
 *  três formatos e teria de adivinhar qual chegou — o formato do formulário é a
 *  intenção, e ele já chega explícito.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { registrationFieldFromFormData } from '@/lib/admin/registration-form-editing';
import { applyRegistrationFormOperationOnEvent } from '@/lib/admin/registration-form-service';

export interface RegistrationFormActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
}

/** O envelope comum: a instituição e o evento da operação. */
const envelope = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
});

/**
 * A tela e a raiz do evento. As duas, porque a raiz mostra a contagem de campos —
 * e ela não pode continuar dizendo o que o formulário tinha antes do gesto.
 */
function revalidateForm(tenantSlug: string, eventId: string): void {
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/formulario`));
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}`));
}

/** Salva (cria ou edita) UM campo do formulário. */
export async function saveRegistrationFormFieldAction(
  _prev: RegistrationFormActionState | null,
  formData: FormData,
): Promise<RegistrationFormActionState> {
  const parsed = envelope.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Formulário inválido.' };
  }

  const auth = await guardAction<RegistrationFormActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });
  if (!auth.ok) return auth.state;

  /**
   * A `key` de origem diz QUAL campo está sendo editado. Vazia é campo NOVO — e é
   * por isso que ela não pode ser confundida com a `key` nova digitada: renomear um
   * campo precisa saber de onde ele veio para não virar um campo a mais.
   */
  const originalKeyRaw = formData.get('originalKey');
  const originalKey =
    typeof originalKeyRaw === 'string' && originalKeyRaw.length > 0 ? originalKeyRaw : null;

  const result = await applyRegistrationFormOperationOnEvent({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    eventId: parsed.data.eventId,
    operation: {
      kind: 'SAVE',
      originalKey,
      field: registrationFieldFromFormData(formData),
    },
  });

  revalidateForm(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok
    ? { ok: true, message: result.message }
    : { ok: false, code: result.code, message: result.message, details: result.details };
}

/** Remove um campo do formulário declarado. */
export async function removeRegistrationFormFieldAction(
  _prev: RegistrationFormActionState | null,
  formData: FormData,
): Promise<RegistrationFormActionState> {
  const parsed = envelope
    .extend({ key: z.string().trim().min(1).max(40) })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      key: formData.get('key'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Campo inválido para remoção.' };
  }

  const auth = await guardAction<RegistrationFormActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });
  if (!auth.ok) return auth.state;

  const result = await applyRegistrationFormOperationOnEvent({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    eventId: parsed.data.eventId,
    operation: { kind: 'REMOVE', key: parsed.data.key },
  });

  revalidateForm(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok
    ? { ok: true, message: result.message }
    : { ok: false, code: result.code, message: result.message, details: result.details };
}

/** Move um campo uma posição para cima ou para baixo. */
export async function moveRegistrationFormFieldAction(
  _prev: RegistrationFormActionState | null,
  formData: FormData,
): Promise<RegistrationFormActionState> {
  const parsed = envelope
    .extend({ key: z.string().trim().min(1).max(40), direction: z.enum(['up', 'down']) })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      key: formData.get('key'),
      direction: formData.get('direction'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Movimento inválido.' };
  }

  const auth = await guardAction<RegistrationFormActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });
  if (!auth.ok) return auth.state;

  const result = await applyRegistrationFormOperationOnEvent({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    eventId: parsed.data.eventId,
    operation: { kind: 'MOVE', key: parsed.data.key, direction: parsed.data.direction },
  });

  revalidateForm(parsed.data.tenantSlug, parsed.data.eventId);

  return result.ok
    ? { ok: true, message: result.message }
    : { ok: false, code: result.code, message: result.message, details: result.details };
}
