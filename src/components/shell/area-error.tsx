'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { errorContent, type ErrorArea } from '@/domain/platform/error-pages';
import { Button, buttonClasses } from '@/components/ui/button';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PÁGINA DE ERRO — o desenho, uma vez (FASE 75 · decisão 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE COMPONENTE É `'use client'` — E POR QUE ISSO É A ENTREGA
 * ─────────────────────────────────────────────────────────────────────────────
 *  O `error.tsx` só é um boundary de verdade quando é client component: ele recebe o
 *  `reset`, que remonta o segmento e refaz a renderização no SERVIDOR. Sem isso
 *  sobra o botão "recarregue a página", que perde o estado e não é a mesma coisa —
 *  e é exatamente o que o `global-error.tsx` faz hoje (ele desenha sem o CSS do app e
 *  não conhece a área).
 *
 *  O `console.error` fica AQUI, e não na tela: a referência técnica (`digest`) é para
 *  quem depura. Mostrá-la à pessoa não a ajuda a voltar ao trabalho — e vazar detalhe
 *  técnico numa tela pública é a mesma família de defeito do 404 que confirma
 *  existência.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A SAÍDA É O QUE SEPARA ESTA TELA DA TELA MORTA
 * ─────────────────────────────────────────────────────────────────────────────
 *  "Tentar de novo" refaz o que falhou; se a falha for persistente, o botão sozinho
 *  vira um laço. Por isso há sempre um segundo caminho, o da ÁREA — o painel para
 *  quem estava trabalhando, a vitrine para quem estava visitando.
 */
export function AreaError({
  area,
  tenantSlug = null,
  error,
  reset,
}: {
  area: ErrorArea;
  /** O slug da instituição, quando a página de erro consegue vê-lo no `useParams()`. */
  tenantSlug?: string | null;
  error: Error & { digest?: string };
  /** O `reset` do boundary: remonta o segmento e refaz a renderização no servidor. */
  reset: () => void;
}) {
  useEffect(() => {
    console.error(`[area-error:${area}]`, error.digest ?? '', error.message);
  }, [area, error]);

  const content = errorContent({ area, tenantSlug });

  return (
    <main
      className="mx-auto w-full max-w-2xl px-6 py-12"
      data-testid={`area-error-${area}`}
    >
      <div className="space-y-5 rounded-lg border border-border bg-card p-8 shadow-card">
        <p className="text-label-caps uppercase text-muted-foreground">{content.eyebrow}</p>

        <h1 className="font-display text-title-lg text-foreground">{content.title}</h1>

        <p className="max-w-prose text-sm text-muted-foreground">{content.description}</p>

        <div className="flex flex-wrap gap-3">
          <Button onClick={reset}>{content.retryLabel}</Button>

          {content.exits.map((exit) => (
            <Link key={exit.href} href={exit.href} className={buttonClasses({ variant: 'outline' })}>
              {exit.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
