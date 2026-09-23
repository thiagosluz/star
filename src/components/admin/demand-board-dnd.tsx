'use client';

import { useState, useTransition } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import type { DemandActionState } from '@/app/actions/demand-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ARRASTAR E SOLTAR DO QUADRO (FASE 38)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ROLETA É APRESENTAÇÃO, O QUADRO TAMBÉM (mesma lição da FASE 30)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este componente NÃO decide nada: ele lê de onde o cartão saiu e onde foi solto, e
 *  manda isso para a Server Action, que faz a escrita condicional. A ordem final é a
 *  que o SERVIDOR gravou — arrastar é gesto, não regra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE NÃO SUBSTITUI O FORMULÁRIO DO CARTÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O cartão continua tendo um `<form>` de verdade (o `<select>` de coluna e o botão
 *  "Mover"). Sem JavaScript, o quadro é operável por ele; com JavaScript, este
 *  componente acrescenta o gesto. Foi o que quitou a dívida **E50**: a ação em linha
 *  que só existia depois da hidratação (armadilha 88) deixou de ser o ÚNICO caminho.
 *
 *  A delegação de evento no contêiner (em vez de um `onDragStart` por cartão) é
 *  deliberada: os cartões são renderizados pelo SERVIDOR, com os dados do banco, e
 *  amarrar handler a cada um obrigaria a transformar cada cartão em componente de
 *  cliente — mais bundle e mais lugares para divergir do que a tela mostra.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function DemandBoardDnd({
  action,
  tenantSlug,
  eventId,
  canMove,
  children,
}: {
  action: (prev: DemandActionState | null, formData: FormData) => Promise<DemandActionState>;
  tenantSlug: string;
  eventId: string;
  canMove: boolean;
  children: React.ReactNode;
}) {
  const [feedback, setFeedback] = useState<DemandActionState | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function columnOf(element: Element | null): string | null {
    return element?.closest('[data-column-drop]')?.getAttribute('data-column-drop') ?? null;
  }

  function onDragStart(event: React.DragEvent): void {
    if (!canMove) return;

    const card = (event.target as HTMLElement).closest('[data-demand-id]');
    if (!card) return;

    const id = card.getAttribute('data-demand-id');
    if (!id) return;

    setDragging(id);
    event.dataTransfer.effectAllowed = 'move';
    /** Alguns navegadores só iniciam o arrasto se houver dado no `dataTransfer`. */
    event.dataTransfer.setData('text/plain', id);
  }

  function onDragOver(event: React.DragEvent): void {
    if (!canMove || !dragging) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setOverColumn(columnOf(event.target as Element));
  }

  function onDragEnd(): void {
    setDragging(null);
    setOverColumn(null);
  }

  function onDrop(event: React.DragEvent): void {
    if (!canMove || !dragging) return;

    event.preventDefault();

    const target = event.target as Element;
    const toColumnId = columnOf(target);
    const card = document.querySelector(`[data-demand-id="${dragging}"]`);
    const fromColumnId = card?.getAttribute('data-demand-column') ?? null;

    setDragging(null);
    setOverColumn(null);

    if (!toColumnId || !fromColumnId) return;

    /**
     * Soltar SOBRE um cartão insere antes dele; soltar no espaço vazio da coluna
     * manda para o fim. O índice é o da lista JÁ SEM o cartão arrastado (é assim que
     * o serviço conta), então descer dentro da mesma coluna desconta um.
     */
    const overCard = target.closest('[data-demand-id]');
    let toIndex: number | undefined;

    if (overCard) {
      const raw = Number(overCard.getAttribute('data-demand-index'));
      const overIndex = Number.isFinite(raw) ? raw : undefined;
      const fromIndex = Number(card?.getAttribute('data-demand-index'));

      if (overIndex !== undefined) {
        toIndex =
          fromColumnId === toColumnId && Number.isFinite(fromIndex) && fromIndex < overIndex
            ? overIndex - 1
            : overIndex;
      }
    }

    const formData = new FormData();
    formData.set('tenantSlug', tenantSlug);
    formData.set('eventId', eventId);
    formData.set('demandId', dragging);
    formData.set('fromColumnId', fromColumnId);
    formData.set('toColumnId', toColumnId);
    if (toIndex !== undefined) formData.set('toIndex', String(toIndex));

    startTransition(async () => {
      const state = await action(null, formData);
      setFeedback(state);
    });
  }

  return (
    <div
      className="space-y-3"
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      data-testid="demand-board"
    >
      {feedback ? (
        <p
          role={feedback.ok ? 'status' : 'alert'}
          data-testid="demand-board-feedback"
          className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs ${
            feedback.ok
              ? 'border-border text-success-strong'
              : 'border-destructive/40 text-destructive'
          }`}
        >
          {feedback.ok ? (
            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          )}
          {feedback.message}
        </p>
      ) : null}

      {pending ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="demand-board-pending">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Salvando o movimento…
        </p>
      ) : null}

      {canMove ? (
        <p className="text-xs text-muted-foreground">
          Arraste o cartão para outra coluna, ou use o formulário de cada cartão.
        </p>
      ) : null}

      <div
        className="grid gap-3 lg:grid-cols-3 xl:grid-cols-5"
        data-dragging={dragging ?? undefined}
        data-over-column={overColumn ?? undefined}
      >
        {children}
      </div>
    </div>
  );
}
