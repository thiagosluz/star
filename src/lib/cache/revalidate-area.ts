import { revalidatePath } from 'next/cache';

import { tenantPath } from '@/domain/tenancy/resolution';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  REVALIDAÇÃO CENTRALIZADA POR ÁREA (FASE 96 · ADR-408)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE CENTRALIZAR AS ROTAS DE REVALIDAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nas FASEs 90 a 95, cada sub-rota dedicada criada (`/eventos/novo`,
 *  `/programacao/nova`, `/chamadas/nova`, `/patrocinadores/novo`, `/cartas/nova`
 *  e agora `/cartas/[cardId]/editar`) obrigava a procurar todas as Server Actions
 *  que tocavam naquela entidade para acrescentar mais um `revalidatePath(...)`.
 *  Esquecer uma rota em uma action não quebra o build nem os testes unitários —
 *  apenas deixa o Router Cache do cliente exibindo estado obsoleto.
 *
 *  Este módulo concentra o mapa canônico das áreas administrativas e públicas da
 *  instituição e invalida cada prefixo com escopo `'layout'` (cobrindo a página
 *  raiz da área e todas as sub-rotas filhas, como `/nova` e `/[id]/editar`),
 *  além dos caminhos explícitos para compatibilidade direta com os testes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const TENANT_CACHE_AREAS = {
  cartas: ['/administracao/cartas', '/administracao/cartas/nova', '/cartas'] as const,
  missoes: ['/administracao/missoes', '/administracao/missoes/nova', '/conquistas'] as const,
  certificados: ['/administracao/certificados', '/certificados'] as const,
  credenciamento: ['/credenciamento'] as const,
  eventosCatalogo: ['/administracao/eventos', '/administracao/eventos/novo', '/eventos'] as const,
  evento: (eventId: string) =>
    [
      `/administracao/eventos/${eventId}`,
      `/administracao/eventos/${eventId}/dados`,
      `/administracao/eventos/${eventId}/salas`,
      `/administracao/eventos/${eventId}/programacao`,
      `/administracao/eventos/${eventId}/programacao/nova`,
      `/administracao/eventos/${eventId}/palestrantes`,
      `/administracao/eventos/${eventId}/palestrantes/novo`,
    ] as const,
  chamadas: (eventId: string) =>
    [
      `/administracao/eventos/${eventId}/chamadas`,
      `/administracao/eventos/${eventId}/chamadas/nova`,
      `/administracao/eventos/${eventId}`,
    ] as const,
  patrocinadores: (eventId: string) =>
    [
      `/administracao/eventos/${eventId}/patrocinadores`,
      `/administracao/eventos/${eventId}/patrocinadores/novo`,
      `/administracao/eventos/${eventId}`,
    ] as const,
} as const;

/**
 * Revalida todas as rotas de uma área da instituição, incluindo sub-rotas
 * aninhadas (via escopo `'layout'` no prefixo principal).
 */
export function revalidateTenantArea(
  tenantSlug: string,
  paths: readonly string[],
): void {
  const cleanSlug = tenantSlug.trim();
  if (!cleanSlug) return;

  for (const path of paths) {
    const resolved = tenantPath(cleanSlug, path);
    revalidatePath(resolved);
    revalidatePath(resolved, 'layout');
  }
}

