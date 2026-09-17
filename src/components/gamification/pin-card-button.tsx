'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Pin, PinOff } from 'lucide-react';

import type { GamificationActionState } from '@/app/actions/gamification-actions';

function Button({ isPinned }: { isPinned: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={isPinned ? 'unpin-card' : 'pin-card'}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium transition hover:bg-muted disabled:opacity-60"
    >
      {isPinned ? <PinOff className="size-3" aria-hidden /> : <Pin className="size-3" aria-hidden />}
      {pending ? '…' : isPinned ? 'Remover destaque' : 'Destacar'}
    </button>
  );
}

/**
 * Destacar/remover carta do perfil.
 *
 * A mensagem de erro aparece AO LADO do botão, não como alerta global: com oito
 * cartas na tela, um aviso no topo não diria QUAL carta falhou.
 */
export function PinCardButton({
  tenantSlug,
  userCardId,
  isPinned,
  action,
}: {
  tenantSlug: string;
  userCardId: string;
  isPinned: boolean;
  action: (prev: GamificationActionState | null, formData: FormData) => Promise<GamificationActionState>;
}) {
  const [state, formAction] = useActionState<GamificationActionState | null, FormData>(action, null);

  return (
    <div className="space-y-1">
      <form action={formAction}>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="userCardId" value={userCardId} />
        <input type="hidden" name="isPinned" value={isPinned ? 'false' : 'true'} />
        <Button isPinned={isPinned} />
      </form>

      {state && !state.ok ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
