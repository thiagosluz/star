'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UI — Atualização sob demanda do painel de métricas (FASE 129)
 *
 *  Dispara `router.refresh()` dentro de `useTransition` para revalidar os Server
 *  Components da rota sem recarregar a página inteira no navegador.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui';

export function RefreshMetricsButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
      data-testid="refresh-metrics-button"
    >
      <RefreshCw
        className={`size-3.5 ${isPending ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      {isPending ? 'Atualizando...' : 'Atualizar leitura'}
    </Button>
  );
}
