'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UI — Barra de Blocos Rápidos + Histórico (Desfazer/Refazer) (FASE 131)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { Plus, Redo2, Undo2 } from 'lucide-react';

import { MAX_LAYOUT_ELEMENTS } from '@/domain/certificates/certificate-layout-rules';
import {
  STUDIO_QUICK_BLOCKS,
  type StudioQuickBlockId,
} from '@/domain/certificates/certificate-studio-rules';
import { Button } from '@/components/ui';

export function StudioToolbar({
  elementsCount,
  canUndo,
  canRedo,
  onAddQuickBlock,
  onUndo,
  onRedo,
}: {
  elementsCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onAddQuickBlock: (blockId: StudioQuickBlockId) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const limitReached = elementsCount >= MAX_LAYOUT_ELEMENTS;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
      data-testid="studio-toolbar"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Adicionar bloco:</span>
        {STUDIO_QUICK_BLOCKS.map((block) => (
          <Button
            key={block.id}
            type="button"
            variant="outline"
            size="sm"
            disabled={limitReached}
            title={block.description}
            onClick={() => onAddQuickBlock(block.id)}
            data-testid={`studio-add-${block.id}`}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {block.label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canUndo}
          onClick={onUndo}
          title="Desfazer (Ctrl+Z)"
          data-testid="studio-undo"
        >
          <Undo2 className="size-3.5" aria-hidden="true" />
          Desfazer
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canRedo}
          onClick={onRedo}
          title="Refazer (Ctrl+Y)"
          data-testid="studio-redo"
        >
          <Redo2 className="size-3.5" aria-hidden="true" />
          Refazer
        </Button>
      </div>
    </div>
  );
}
