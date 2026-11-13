'use client';

import type { ComponentProps, ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';

/**
 * Botão de submissão leve para formulários renderizados em Server Components.
 *
 * Preserva o `<button type="submit">` nativo no HTML SSR (funcionando antes ou sem
 * JavaScript) e acrescenta trava contra duplo clique e retorno visual de `pending`
 * quando hidratado.
 */
export function FormStatusButton({
  pendingContent,
  showSpinner = false,
  disabled,
  children,
  ...props
}: Omit<ComponentProps<'button'>, 'type'> & {
  pendingContent?: ReactNode;
  showSpinner?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={Boolean(disabled || pending)} {...props}>
      {pending ? (
        <>
          {showSpinner ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {pendingContent ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

