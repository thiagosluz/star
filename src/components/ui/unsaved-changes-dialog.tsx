'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  KOVENO_UNSAVED_LEAVE_REQUEST_EVENT,
  allowNextUnload,
  type UnsavedLeaveRequestDetail,
} from '@/hooks/use-unsaved-changes';

import { ConfirmDialog } from './dialog';
import { startNavigationProgress } from './navigation-progress-bar';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DIÁLOGO GLOBAL DE ALTERAÇÕES NÃO SALVAS
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SUBSTITUIÇÃO DEFINITIVA DO `window.confirm` PELO PADRÃO DO SISTEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Centraliza em um único `ConfirmDialog` (montado no layout raiz) a confirmação
 *  de saída solicitada por `useUnsavedChanges` ao clicar em qualquer link com
 *  rascunho pendente. Mantém o foco inicial em "Continuar editando" (`tone="danger"`),
 *  respeita modo claro/escuro e navega pelo App Router após confirmação explícita.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function UnsavedChangesDialog() {
  const router = useRouter();
  const [pendingRequest, setPendingRequest] = useState<UnsavedLeaveRequestDetail | null>(null);

  useEffect(() => {
    const handleLeaveRequest = (event: Event) => {
      const customEvent = event as CustomEvent<UnsavedLeaveRequestDetail>;
      if (!customEvent.detail?.href) return;
      setPendingRequest(customEvent.detail);
    };

    window.addEventListener(KOVENO_UNSAVED_LEAVE_REQUEST_EVENT, handleLeaveRequest);
    return () => {
      window.removeEventListener(KOVENO_UNSAVED_LEAVE_REQUEST_EVENT, handleLeaveRequest);
    };
  }, []);

  const handleConfirmLeave = () => {
    if (!pendingRequest) return;
    const { href } = pendingRequest;
    setPendingRequest(null);

    try {
      const url = new URL(href, window.location.href);
      const isSameOrigin = url.origin === window.location.origin;
      const isApiRoute = url.pathname.startsWith('/api/');

      if (isSameOrigin && !isApiRoute) {
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        if (`${url.pathname}${url.search}` !== currentUrl) {
          startNavigationProgress();
        }
        router.push(nextUrl);
        return;
      }
    } catch {
      // Fallback para navegação direta quando o destino não puder ser parseado
    }

    allowNextUnload();
    window.location.assign(href);
  };

  return (
    <ConfirmDialog
      open={pendingRequest !== null}
      title={pendingRequest?.title ?? 'Sair sem salvar alterações?'}
      description={
        pendingRequest?.message ??
        'Você tem alterações não salvas no rascunho. Se sair agora, o que ainda não foi salvo será perdido.'
      }
      confirmLabel="Sair sem salvar"
      cancelLabel="Continuar editando"
      tone="danger"
      testId="unsaved-changes-dialog"
      onCancel={() => setPendingRequest(null)}
      onConfirm={handleConfirmLeave}
    />
  );
}

