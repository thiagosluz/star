'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Interruptor do telão do sorteio (FASE 51 · dívida E37)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO É NOVO, E NÃO UM `export` A MAIS EM `raffle-actions.ts`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O telão é uma decisão de OPERAÇÃO DE PALCO, e não de apuração: ela não mexe em
 *  semente, resultado nem entrega — nega o ACESSO a um endereço que existe desde a
 *  criação do sorteio. A dívida E37 nasceu justamente por isso: o palco responde
 *  desde que o sorteio existe, e não havia como fechá-lo sem mexer no sorteio em si.
 *  Um arquivo próprio mantém essa separação legível (e evita reescrever o arquivo das
 *  apurações, que outros fluxos da fase tocam).
 *
 *  A AUTORIZAÇÃO É CONFERIDA AQUI, como em toda Server Action do projeto: negar o
 *  telão muda o que o PÚBLICO vê na parede, e quem responde pelo evento é quem tem
 *  `event:manage`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { setBigscreenVisibility } from '@/lib/raffles/raffle-service';

export interface BigscreenActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

/**
 * A guarda local SAIU na FASE 75 (era a duplicação declarada com `raffle-actions`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELA EXISTIA, E POR QUE NÃO EXISTE MAIS
 * ─────────────────────────────────────────────────────────────────────────────
 *  Quando este arquivo nasceu, `raffle-actions.ts` mantinha a guarda PRIVADA — e um
 *  módulo `'use server'` só pode exportar funções assíncronas, então importá-la não
 *  era uma opção. Copiar era a saída, com o comentário explicando a cópia.
 *
 *  A regra é a mesma das duas: vínculo ACTIVE na instituição e `event:manage` no
 *  escopo do tenant. Duas cópias da MESMA autorização divergem na primeira
 *  manutenção (armadilha 55) — e aqui a divergência fecharia ou abriria o telão, que
 *  é público. `guardAction` é o dono único dessa checagem; este arquivo só diz qual
 *  é a permissão.
 */

/**
 * Liga ou desliga o telão de um sorteio.
 *
 * O que o público passa a ver é dito na RESPOSTA, e não só na tela: quem desliga
 * precisa saber que quem tem o link deixa de ver o sorteio — e que o endereço
 * continua respondendo com o aviso (não vira 404).
 */
export async function setBigscreenVisibilityAction(
  _prev: BigscreenActionState | null,
  formData: FormData,
): Promise<BigscreenActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      raffleId: z.string().uuid(),
      visible: z.coerce.boolean(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      raffleId: formData.get('raffleId'),
      visible: formData.get('visible') === 'true',
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para o telão do sorteio.' };
  }

  const auth = await guardAction<BigscreenActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
  });
  if (!auth.ok) return auth.state;

  const result = await setBigscreenVisibility({
    tenantId: auth.tenantId,
    raffleId: parsed.data.raffleId,
    actorId: auth.userId,
    visible: parsed.data.visible,
  });

  /**
   * A tela de sorteios mostra o interruptor e o endereço do palco: ela precisa ser
   * revalidada mesmo quando o serviço recusa, porque a resposta (o aviso de erro)
   * aparece nela.
   */
  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/sorteios`));

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  return {
    ok: true,
    message: result.bigscreenVisible
      ? 'Telão ligado. Quem tem o endereço volta a ver o sorteio ao vivo.'
      : 'Telão desligado. Quem tem o endereço passa a ver apenas o aviso — o sorteio não vaza.',
    data: { bigscreenVisible: result.bigscreenVisible },
  };
}
