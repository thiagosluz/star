/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HTTP / AUDITORIA — Metadados de requisição (FASE 117 · ADR-473)
 *
 *  Centraliza a extração de IP do cliente (`x-forwarded-for` → `x-real-ip`) e
 *  `user-agent` para Server Actions, rotas HTTP e trilha de auditoria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Extrai o primeiro IP válido de `x-forwarded-for`, com fallback para `x-real-ip`. */
export function extractClientIp(headerList: Pick<Headers, 'get'>): string | null {
  const forwarded = headerList.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;

  const realIp = headerList.get('x-real-ip')?.trim();
  return realIp && realIp.length > 0 ? realIp : null;
}

/** Lê IP e `user-agent` da requisição atual sem lançar fora de contexto HTTP. */
export async function readRequestMeta(): Promise<RequestMeta> {
  try {
    const { headers } = await import('next/headers');
    const headerList = await headers();
    return {
      ipAddress: extractClientIp(headerList),
      userAgent: headerList.get('user-agent'),
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}
