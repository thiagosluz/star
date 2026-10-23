'use client';

import { useParams } from 'next/navigation';

import { tenantSlugFromParam } from '@/domain/platform/error-pages';
import { AreaError } from '@/components/shell/area-error';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ERRO — a área PÚBLICA da instituição (FASE 75 · decisão 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VITRINE PRECISA DA PRÓPRIA PÁGINA DE ERRO
 * ─────────────────────────────────────────────────────────────────────────────
 *  A falha de uma página pública não pode oferecer "voltar ao painel": quem está
 *  aqui pode nem ter conta — o organizador que compartilhou o link, o participante
 *  que veio do e-mail, o visitante de uma campanha. A saída é a VITRINE (os eventos
 *  daquela instituição), que é o que a pessoa estava procurando.
 *
 *  O layout público continua em volta (cabeçalho com a identidade da instituição e
 *  rodapé), então o erro acontece DENTRO da casa em vez de numa tela órfã.
 */
export default function PublicAreaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ tenantSlug?: string | string[] }>();

  return (
    <AreaError
      area="public"
      tenantSlug={tenantSlugFromParam(params.tenantSlug)}
      error={error}
      reset={reset}
    />
  );
}
