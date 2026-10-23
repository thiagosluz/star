'use client';

import { useParams } from 'next/navigation';

import { tenantSlugFromParam } from '@/domain/platform/error-pages';
import { AreaError } from '@/components/shell/area-error';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ERRO — a casca AUTENTICADA da instituição (FASE 75 · decisão 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE FICA DENTRO DE `(app)`
 * ─────────────────────────────────────────────────────────────────────────────
 *  Um `error.tsx` só cobre o segmento em que vive e os filhos. Falhas das telas
 *  autenticadas precisam de uma saída DESTA casca — "voltar ao painel" —, e a página
 *  deve continuar dentro do shell (barra lateral, contexto da instituição): quem
 *  estava trabalhando não é expulso da área por causa de uma tela que falhou.
 *
 *  Aqui o slug VEM do `useParams()`, ao contrário do `not-found.tsx` (que não recebe
 *  props): o boundary de erro é renderizado como filho do segmento, então os params
 *  da URL estão no contexto. `tenantSlugFromParam` normaliza a lista que o
 *  `useParams()` pode devolver.
 */
export default function AppAreaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ tenantSlug?: string | string[] }>();

  return (
    <AreaError
      area="app"
      tenantSlug={tenantSlugFromParam(params.tenantSlug)}
      error={error}
      reset={reset}
    />
  );
}
