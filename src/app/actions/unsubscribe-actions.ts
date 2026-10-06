'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — O DESCADASTRO SEM LOGIN (FASE 67 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTAS DUAS AÇÕES NÃO PEDEM PERMISSÃO — E A EXCEÇÃO É DECLARADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Toda outra Server Action do projeto confere o RBAC na entrada (e é o certo:
 *  uma Server Action é um endpoint HTTP). Estas duas não podem, e o motivo é o
 *  mesmo do aceite de convite (ADR-115): **quem chega aqui não tem sessão**. É a
 *  pessoa que recebeu um e-mail e clicou em "cancele o recebimento" — muitas vezes
 *  sem nunca ter entrado na plataforma.
 *
 *  A autorização delas é o TOKEN, e ela é verificada no SERVIÇO, antes de qualquer
 *  leitura: `unsubscribeByToken` / `resubscribeByUnsubscribeToken` conferem o HMAC
 *  contra os vínculos ativos daquela instituição e respondem `INVALID_TOKEN` sem
 *  consultar nada quando o token não é de ninguém dali. A ação não recebe `userId`
 *  NEM de formulário: aceitar um id de fora transformaria este endpoint num
 *  descadastrador de qualquer pessoa da instituição.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SEM `redirect` E SEM `throw`: ERRO COMO VALOR, COMO NO RESTO DA CASA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A resposta é o estado que o `useActionState` do formulário mostra. Um token
 *  torto que chegasse até aqui (página montada antes de alguém editar a URL) vira
 *  mensagem em português ao lado do botão — e não uma tela de erro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getTenantContext } from '@/lib/events/event-repository';
import {
  resubscribeByUnsubscribeToken,
  unsubscribeByToken,
  unsubscribePath,
} from '@/lib/communication/unsubscribe-service';
import {
  UNSUBSCRIBE_REASON_FIELD,
  UNSUBSCRIBE_REASON_NOTE_FIELD,
  unsubscribeReasonFor,
} from '@/domain/communication/unsubscribe-reason-rules';

export interface UnsubscribeActionState {
  ok: boolean;
  code?: string;
  message?: string;
  /** `true` quando a pessoa JÁ estava no estado pedido — nada mudou. */
  unchanged?: boolean;
}

const tokenSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  token: z.string().trim().min(10).max(200),
});

function invalidState(message: string): UnsubscribeActionState {
  return { ok: false, code: 'INVALID_INPUT', message };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PÁGINA É REVALIDADA, SE O POST JÁ RE-RENDERIZA A ROTA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A primeira versão destas duas ações NÃO revalidava, com o argumento de que o
 *  POST de uma Server Action re-renderiza a rota atual. **O E2E reprovou**: o banco
 *  ficava certo e a TELA continuava dizendo "você está fora" depois de a pessoa
 *  voltar (o `Router Cache` do cliente servia a versão anterior). O sintoma é o pior
 *  possível numa tela de descadastro — ela afirmando o oposto do estado real.
 *
 *  `revalidatePath` com o caminho da própria página é o que invalida essa entrada.
 *  Ele recebe o endereço RELATIVO da página (o mesmo que o rodapé do e-mail usa), e
 *  não o absoluto: a revalidação é do cache do servidor/cliente do Next, que não
 *  conhece origem.
 */
function revalidarPagina(tenantSlug: string, token: string): void {
  revalidatePath(unsubscribePath({ tenantSlug, token }));
}

/**
 * Confirma a saída. Idempotente: sair duas vezes não muda nada e responde a mesma
 * coisa (a pessoa clica duas vezes, ou abre o link em dois aparelhos).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O MOTIVO ENTRA NA MESMA REQUISIÇÃO — E NÃO PODE DERRUBAR NADA (E88)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O que chega do formulário passa pelo DOMÍNIO (`unsubscribeReasonFor`), que
 *  devolve uma frase conhecida, o texto escrito, ou `null` — nunca uma recusa. A
 *  pergunta é uma cortesia no fim de uma saída, e uma cortesia que recusa o
 *  formulário prenderia a pessoa que quer sair: o único valor que este campo pode
 *  acrescentar é informação, e informação não vale uma saída impedida.
 *
 *  Também por isso o motivo NÃO é validado pelo `zod` junto com o token: o token
 *  precisa de forma (ele é credencial), o motivo não — ele é texto, e quem decide
 *  o que dele se aproveita é a regra pura do domínio.
 *
 *  Quem já estava fora e clica de novo com um motivo novo tem a resposta de sempre
 *  ("já estava fora") e o motivo da PRIMEIRA saída preservado: regravar a razão de
 *  uma saída antiga reescreveria a história, e a data da saída — que é o outro
 *  lado da mesma idempotência — também não muda.
 */
export async function confirmUnsubscribeAction(
  _prev: UnsubscribeActionState | null,
  formData: FormData,
): Promise<UnsubscribeActionState> {
  const parsed = tokenSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    token: formData.get('token'),
  });

  if (!parsed.success) return invalidState('Endereço de descadastro inválido ou incompleto.');

  const tenant = await getTenantContext(parsed.data.tenantSlug);

  if (!tenant) return invalidState('Instituição não encontrada.');

  const reason = unsubscribeReasonFor({
    option: formData.get(UNSUBSCRIBE_REASON_FIELD),
    note: formData.get(UNSUBSCRIBE_REASON_NOTE_FIELD),
  });

  const result = await unsubscribeByToken({
    tenantId: tenant.tenantId,
    token: parsed.data.token,
    reason,
  });

  revalidarPagina(parsed.data.tenantSlug, parsed.data.token);

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    unchanged: result.alreadyOut,
    message: result.alreadyOut
      ? 'Você já estava fora da lista: nada mudou.'
      : 'Pronto. Você não recebe mais os recados em massa desta instituição.',
  };
}

/** O caminho de volta: "voltar a receber". Idempotente pelo mesmo motivo. */
export async function confirmResubscribeAction(
  _prev: UnsubscribeActionState | null,
  formData: FormData,
): Promise<UnsubscribeActionState> {
  const parsed = tokenSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    token: formData.get('token'),
  });

  if (!parsed.success) return invalidState('Endereço de descadastro inválido ou incompleto.');

  const tenant = await getTenantContext(parsed.data.tenantSlug);

  if (!tenant) return invalidState('Instituição não encontrada.');

  const result = await resubscribeByUnsubscribeToken({
    tenantId: tenant.tenantId,
    token: parsed.data.token,
  });

  revalidarPagina(parsed.data.tenantSlug, parsed.data.token);

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    unchanged: !result.changed,
    message: result.changed
      ? 'Pronto: você voltou a receber os recados desta instituição.'
      : 'Você já estava recebendo: nada mudou.',
  };
}
