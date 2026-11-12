'use client';

import { useActionState, useOptimistic, useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';

import { resolveConfirmationItemAction } from '@/app/actions/admin-actions';
import { CONFIRMATION_ITEM_STATUS_LABELS } from '@/domain/events/confirmation-item-rules';

export interface ConfirmationItemData {
  id: string;
  position: number;
  label: string;
  required: boolean;
  status: 'PENDING' | 'RECEIVED' | 'WAIVED';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CHECKLIST OTIMISTA DE ITENS DE CONFIRMAÇÃO (FASE 103 · ADR-429)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  MICRO-INTERAÇÃO OTIMISTA NO BALCÃO DE CONFIRMAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quando o operador no balcão confere itens (doações, comprovantes), cada clique
 *  em "Recebido" ou "Dispensar" aplica `useOptimistic` imediatamente:
 *    • O item é tachado e recebe o status em 0ms;
 *    • A contagem do resumo atualiza de imediato;
 *    • Os botões daquele item desaparecem instantaneamente;
 *    • A Server Action `resolveConfirmationItemAction` roda em transição de fundo;
 *    • A ação de formulário é executada no cliente via transição React 19.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ConfirmationItemsChecklist({
  tenantSlug,
  eventId,
  registrationId,
  items,
  itemsSummary,
}: {
  tenantSlug: string;
  eventId: string;
  registrationId: string;
  items: readonly ConfirmationItemData[];
  itemsSummary: string;
}) {
  const [optimisticItems, updateOptimistic] = useOptimistic(
    items,
    (currentItems, update: { itemId: string; status: 'RECEIVED' | 'WAIVED' }) => {
      return currentItems.map((item) =>
        item.id === update.itemId ? { ...item, status: update.status } : item,
      );
    },
  );

  const [isPending, startTransition] = useTransition();
  const [, formAction] = useActionState(resolveConfirmationItemAction, null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFormSubmit = (
    itemId: string,
    status: 'RECEIVED' | 'WAIVED',
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    setErrorMessage(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      updateOptimistic({ itemId, status });
      try {
        const result = await resolveConfirmationItemAction(null, formData);
        if (result && !result.ok) {
          setErrorMessage(result.message ?? 'Não foi possível registrar a confirmação.');
        }
      } catch {
        setErrorMessage('Erro de conexão ao registrar confirmação.');
      }
    });
  };

  const completedCount = optimisticItems.filter(
    (item) => item.status === 'RECEIVED' || item.status === 'WAIVED',
  ).length;
  const currentSummary = `${completedCount} de ${optimisticItems.length} itens`;

  return (
    <div
      className="mt-2 space-y-1.5 rounded-md border border-border bg-surface-low p-2"
      data-testid={`confirmation-items-${registrationId}`}
      data-pending={String(isPending)}
    >
      <p className="text-xs font-medium" data-testid={`items-summary-${registrationId}`}>
        Checklist: {isPending ? currentSummary : itemsSummary}
      </p>

      {errorMessage ? (
        <p
          role="alert"
          aria-live="assertive"
          className="text-xs text-destructive font-medium"
          data-testid={`item-error-${registrationId}`}
        >
          {errorMessage}
        </p>
      ) : null}

      <ul className="space-y-1.5">
        {optimisticItems.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 text-xs"
            data-testid={`confirmation-item-${registrationId}-${item.position}`}
            data-item-status={item.status}
          >
            <span className="min-w-0">
              <span
                className={
                  item.status === 'PENDING'
                    ? 'text-foreground'
                    : 'text-muted-foreground line-through'
                }
              >
                {item.label}
              </span>
              {item.required ? null : (
                <span className="ml-1 text-muted-foreground">(opcional)</span>
              )}
              <span className="ml-1 text-muted-foreground">
                · {CONFIRMATION_ITEM_STATUS_LABELS[item.status]}
              </span>
            </span>

            {item.status === 'PENDING' ? (
              <span className="flex shrink-0 gap-1">
                <form
                  action={formAction}
                  onSubmit={(e) => handleFormSubmit(item.id, 'RECEIVED', e)}
                  data-testid={`receive-item-${registrationId}-${item.position}`}
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="registrationId" value={registrationId} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="status" value="RECEIVED" />
                  <button
                    type="submit"
                    disabled={isPending}
                    data-testid="inline-submit"
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs font-medium transition hover:bg-accent disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                    Recebido
                  </button>
                </form>

                <form
                  action={formAction}
                  onSubmit={(e) => handleFormSubmit(item.id, 'WAIVED', e)}
                  data-testid={`waive-item-${registrationId}-${item.position}`}
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="registrationId" value={registrationId} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="status" value="WAIVED" />
                  <button
                    type="submit"
                    disabled={isPending}
                    data-testid="inline-submit"
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs font-medium transition hover:bg-accent disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                    Dispensar
                  </button>
                </form>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
