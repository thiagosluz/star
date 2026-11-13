'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition, type ComponentProps } from 'react';

import { startNavigationProgress } from './navigation-progress-bar';

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<'form'>['onSubmit']>>[0];

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FORMULÁRIO GET PROGRESSIVO DO APP ROUTER (FASE 108)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE EXISTE ESTE INVÓLUCRO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um `<form method="get">` puro no Next.js App Router dispara recarregamento
 *  completo do documento no navegador: pisca a tela, perde o foco e ignora a
 *  barra de progresso global. Envolvê-lo neste componente preserva exatamente o
 *  HTML `<form method="get">` no SSR para o caminho sem JavaScript e, quando há
 *  JavaScript, transforma o envio em `router.push()` dentro de `useTransition`
 *  com `startNavigationProgress()`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function GetSearchForm({
  action,
  onSubmit,
  omitEmpty = false,
  ...props
}: Omit<ComponentProps<'form'>, 'method' | 'action'> & {
  action?: string;
  omitEmpty?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormSubmitEvent) {
    onSubmit?.(event);
    if (event.defaultPrevented) return;

    event.preventDefault();

    const baseTarget = typeof action === 'string' && action.length > 0 ? action : pathname;
    const url = new URL(baseTarget, window.location.origin);
    const params = new URLSearchParams(url.search);
    const formData = new FormData(event.currentTarget);
    const nativeEvent = event.nativeEvent as SubmitEvent | undefined;
    const submitter = nativeEvent?.submitter ?? null;
    if (
      (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) &&
      submitter.name
    ) {
      formData.append(submitter.name, submitter.value);
    }

    // Substitui os parâmetros de busca pelo formulário submetido, espelhando `<form method="get">`.
    const nextParams = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      if (typeof value !== 'string') continue;
      if (omitEmpty && value.trim() === '') continue;
      nextParams.append(key, value);
    }

    // Caso a URL de destino já carregasse parâmetros estáticos fora do formulário,
    // só os preserva se o formulário não declarar a mesma chave.
    for (const [key, value] of params.entries()) {
      if (!nextParams.has(key)) {
        nextParams.append(key, value);
      }
    }

    const search = nextParams.toString();
    const targetUrl = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (targetUrl === currentUrl) {
      startTransition(() => {
        router.refresh();
      });
      return;
    }

    startNavigationProgress();
    startTransition(() => {
      router.push(targetUrl);
    });
  }

  return (
    <form
      {...props}
      method="get"
      action={action}
      onSubmit={handleSubmit}
      aria-busy={isPending || undefined}
    />
  );
}
