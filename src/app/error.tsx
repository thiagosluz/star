'use client';

import { AreaError } from '@/components/shell/area-error';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ERRO — a RAIZ e as telas de PLATAFORMA (FASE 75 · decisão 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO É `'use client'`
 * ─────────────────────────────────────────────────────────────────────────────
 *  Só um client component recebe o `reset` do boundary — e é o `reset` que refaz a
 *  renderização no SERVIDOR. É a diferença entre "tentar de novo" e "recarregar a
 *  página"; a segunda perde o estado de quem estava no meio de algo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ELE COBRE — E O QUE ELE NÃO COBRE
 * ─────────────────────────────────────────────────────────────────────────────
 *  Ele cobre o erro que escapa das telas de plataforma E o que escapa do `layout.tsx`
 *  raiz (um boundary não pega o erro do próprio layout; o do pai pega). O que ele NÃO
 *  cobre é o erro do próprio `layout.tsx` raiz quando o tema não pôde ser lido — esse
 *  sobe para o `global-error.tsx`, que é a única tela que desenha sem o CSS do app.
 *
 *  Sem slug de instituição: a saída da plataforma não depende de contexto, e usar
 *  `useParams()` aqui só acrescentaria um hook que nunca tem o que ler.
 */
export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AreaError area="platform" error={error} reset={reset} />;
}
