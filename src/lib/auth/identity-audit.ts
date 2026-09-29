/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Registrar um fato de segurança da conta (FASE 49)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM INVÓLUCRO, E NÃO UMA CHAMADA DIRETA EM CADA ACTION
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Todo fato de identidade precisa do MESMO par de metadados da requisição (IP e
 *  user-agent), e ler o cabeçalho em cada um dos treze pontos de mutação convidaria
 *  ao esquecimento — justamente no ponto que importa. Aqui o cabeçalho é lido uma
 *  vez, e o ponto de mutação só diz o QUE aconteceu e para QUEM.
 *
 *  `actorId` só é preenchido quando quem age é OUTRA pessoa (suporte, administração).
 *  No uso comum é a própria pessoa fazendo a mudança na própria conta, e um campo
 *  repetindo o `userId` seria ruído na investigação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { headers } from 'next/headers';

import { recordIdentityAudit } from '@/lib/platform/identity-audit-service';
import type { IdentityAuditEvent } from '@/domain/identity/identity-audit-rules';

export async function recordIdentityEvent(input: {
  /** A conta afetada. `null` quando o fato não chegou a uma conta (e-mail inexistente). */
  userId?: string | null;
  /** Preenchido só quando quem age é outra pessoa. */
  actorId?: string | null;
  event: IdentityAuditEvent;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const requestHeaders = await headers();

    await recordIdentityAudit({
      userId: input.userId ?? null,
      actorId: input.actorId ?? null,
      event: input.event,
      details: input.details,
      ipAddress: requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: requestHeaders.get('user-agent'),
    });
  } catch (error) {
    /**
     * `headers()` fora de uma requisição (script, teste de unidade) lança. Registrar
     * segurança NUNCA pode derrubar a operação que já deu certo — o erro vai para o
     * log e a troca de senha continua valendo.
     */
    console.error(`[identity-audit] não foi possível ler a requisição: ${String(error)}`);
  }
}
