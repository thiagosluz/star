'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — a chave e as seções da API do evento (FASE 72 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PERMISSÃO É `EVENT_UPDATE`, E ELA É CONFERIDA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O serviço da fatia 2 NÃO autoriza de propósito: ele recebe `actorUserId` só
 *  para a trilha. Quem barra é esta camada, com a guarda compartilhada da casa —
 *  ANTES de qualquer leitura. Esconder o cartão na raiz é conveniência; a barreira
 *  é aqui, porque uma Server Action é um endpoint HTTP.
 *
 *  Não existe na casa uma permissão de "chave/segredo" (o catálogo tem
 *  `event:update`, `event:manage`, `page:manage`…). A chave é CONFIGURAÇÃO do
 *  evento — a mesma espécie de "Dados do evento" e do "Formulário de inscrição" —,
 *  então a permissão é `event:update`. `event:manage` ficaria reservada ao que
 *  AFETA PESSOAS e produz resultado (sorteio, decisão de certificado), que não é o
 *  caso: a API lê o que já é público.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTAS ACTIONS DEVOLVEM — E O QUE ELAS NUNCA REGISTRAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Criar e reexibir devolvem a chave em CLARO no estado da action, que é o corpo
 *  da resposta da própria pessoa autenticada; é assim que "a chave aparece uma vez"
 *  e "Mostrar chave" funcionam. Nenhuma delas registra a chave em log, em URL ou na
 *  trilha — a trilha da fatia 2 grava o ÍNDICE SHA-256, nunca o valor.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUATRO ACTIONS, UM GESTO CADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada `<form>` da tela tem o seu formato (gerar não manda nada, ligar/desligar
 *  manda três booleanos, revogar manda a confirmação). Uma action única teria de
 *  adivinhar a intenção pelo formato — o formato JÁ é a intenção.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { EVENT_API_SECTIONS, type EventApiSectionToggles } from '@/domain/api/event-api-key-rules';
import {
  createEventApiKey,
  revealEventApiKey,
  revokeEventApiKey,
  updateEventApiSections,
} from '@/lib/api/event-api-key-service';

export interface EventApiActionState {
  ok: boolean;
  code?: string;
  message?: string;
  /** Presente só em "gerar" e "mostrar": o estado vive na resposta, não no banco. */
  chave?: string;
}

/** O envelope comum: a instituição e o evento da operação. */
const envelope = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
});

/**
 * A tela e a raiz do evento. A raiz porque o selo do cartão mostra o estado da
 * chave — e ele não pode continuar dizendo o que era antes do gesto.
 */
function revalidateApi(tenantSlug: string, eventId: string): void {
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}/api`));
  revalidatePath(tenantPath(tenantSlug, `/administracao/eventos/${eventId}`));
}

/** Gera a chave e devolve o valor UMA vez. */
export async function createEventApiKeyAction(
  _prev: EventApiActionState | null,
  formData: FormData,
): Promise<EventApiActionState> {
  const parsed = envelope.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Formulário inválido.' };
  }

  const auth = await guardAction<EventApiActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });
  if (!auth.ok) return auth.state;

  const result = await createEventApiKey({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorUserId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateApi(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, chave: result.chave, message: 'Chave criada.' };
}

/** Reexibe a chave pelo selo — o gesto deliberado de "Mostrar chave". */
export async function revealEventApiKeyAction(
  _prev: EventApiActionState | null,
  formData: FormData,
): Promise<EventApiActionState> {
  const parsed = envelope.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Formulário inválido.' };
  }

  const auth = await guardAction<EventApiActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });
  if (!auth.ok) return auth.state;

  const result = await revealEventApiKey({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return { ok: true, chave: result.chave, message: 'Chave revelada.' };
}

/**
 * Revoga — o ato que corta o acesso na requisição seguinte.
 *
 * Não revalida a página para "esconder" a chave: o estado REVOKED já troca o
 * painel, e a revalidação é a mesma das demais actions (a raiz precisa do selo).
 */
export async function revokeEventApiKeyAction(
  _prev: EventApiActionState | null,
  formData: FormData,
): Promise<EventApiActionState> {
  const parsed = envelope.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Formulário inválido.' };
  }

  const auth = await guardAction<EventApiActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });
  if (!auth.ok) return auth.state;

  const result = await revokeEventApiKey({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorUserId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateApi(parsed.data.tenantSlug, parsed.data.eventId);

  return {
    ok: true,
    message: 'Chave revogada. A API já responde 401 para ela.',
  };
}

/**
 * Liga/desliga as três seções.
 *
 * Checkbox ausente é `false` — é o comportamento nativo do formulário, e o
 * contrário ("ausente = mantenha") faria desligar uma seção ser impossível sem
 * JavaScript. A lista de nomes vem do DOMÍNIO (`EVENT_API_SECTIONS`), para uma
 * seção nova não ficar de fora em silêncio.
 */
export async function updateEventApiSectionsAction(
  _prev: EventApiActionState | null,
  formData: FormData,
): Promise<EventApiActionState> {
  const parsed = envelope.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Formulário inválido.' };
  }

  const auth = await guardAction<EventApiActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });
  if (!auth.ok) return auth.state;

  const secoes = EVENT_API_SECTIONS.reduce<EventApiSectionToggles>(
    (acumulado, section) => {
      acumulado[section] = formData.get(section) === 'on';
      return acumulado;
    },
    { palestrantes: false, patrocinadores: false, chamadas: false },
  );

  const result = await updateEventApiSections({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorUserId: auth.userId,
    secoes,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidateApi(parsed.data.tenantSlug, parsed.data.eventId);

  return { ok: true, message: 'Seções atualizadas.' };
}
