'use client';

import { useRef, useState } from 'react';

import {
  ELEMENT_NUDGE_FAST_MM,
  ELEMENT_NUDGE_MM,
  nudgeElementPosition,
  type CertificatePageFormat,
} from '@/domain/certificates/certificate-layout-rules';
import {
  STAGE_HINT_ID,
  clampMm,
  roundMm,
  type EditorElement,
} from '@/components/admin/certificate-template/types';

export interface TemplateStageProps {
  page: CertificatePageFormat;
  elements: EditorElement[];
  selected: number | null;
  backgroundHref: string | null;
  onSelect: (index: number) => void;
  onMove: (index: number, xMm: number, yMm: number) => void;
  onResize: (index: number, widthMm: number, heightMm: number) => void;
}

/** Palco esquemático e proporcional para arrastar, redimensionar e mover por teclado (mm). */
export function TemplateStage({
  page,
  elements,
  selected,
  backgroundHref,
  onSelect,
  onMove,
  onResize,
}: TemplateStageProps) {
  const [widthMm, heightMm] = page === 'A4_PORTRAIT' ? [210, 297] : [297, 210];
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    index: number;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origin: EditorElement;
    mmPerPxX: number;
    mmPerPxY: number;
  } | null>(null);

  const beginDrag = (event: React.PointerEvent, index: number, mode: 'move' | 'resize') => {
    const element = elements[index];
    const stage = stageRef.current;
    if (!element || !stage) return;

    const rect = stage.getBoundingClientRect();

    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    drag.current = {
      index,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: element,
      mmPerPxX: widthMm / rect.width,
      mmPerPxY: heightMm / rect.height,
    };
  };

  const handleMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;

    const deltaXMm = (event.clientX - state.startX) * state.mmPerPxX;
    const deltaYMm = (event.clientY - state.startY) * state.mmPerPxY;

    if (state.mode === 'move') {
      // Usa a mesma régua do teclado (`nudgeElementPosition`) para manter a caixa dentro da página.
      const next = nudgeElementPosition({
        element: state.origin,
        page,
        dxMm: roundMm(state.origin.xMm + deltaXMm) - state.origin.xMm,
        dyMm: roundMm(state.origin.yMm + deltaYMm) - state.origin.yMm,
      });

      onMove(state.index, next.xMm, next.yMm);
      return;
    }

    onResize(
      state.index,
      clampMm(roundMm(state.origin.widthMm + deltaXMm), 12, widthMm - state.origin.xMm),
      clampMm(roundMm(state.origin.heightMm + deltaYMm), 4, heightMm - state.origin.yMm),
    );
  };

  const endDrag = () => {
    drag.current = null;
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const element = elements[index];
    if (!element) return;
    if (
      event.key !== 'ArrowUp' &&
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight'
    ) {
      return;
    }

    event.preventDefault();

    const step = event.shiftKey ? ELEMENT_NUDGE_FAST_MM : ELEMENT_NUDGE_MM;
    const dxMm = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dyMm = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;

    const next = nudgeElementPosition({ element, page, dxMm, dyMm });

    if (next.xMm === element.xMm && next.yMm === element.yMm) {
      setAnnouncement(`Elemento ${index + 1} está na borda da página: não há para onde mover.`);
      return;
    }

    onSelect(index);
    onMove(index, next.xMm, next.yMm);
    setAnnouncement(`Elemento ${index + 1} em ${next.xMm} mm por ${next.yMm} mm.`);
  };

  return (
    <div className="space-y-2">
      {/* O palco simula papel branco nos dois modos; exceção declarada em tests/unit/f61-varredura-escuro.test.ts. */}
      <div
        ref={stageRef}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        data-testid="template-stage"
        className="relative w-full overflow-hidden rounded-md border border-border bg-white shadow-sm"
        style={{ aspectRatio: `${widthMm} / ${heightMm}` }}
      >
        {backgroundHref ? (
          // eslint-disable-next-line @next/next/no-img-element -- a arte é um data: URI do bucket privado
          <img src={backgroundHref} alt="" className="pointer-events-none absolute inset-0 size-full object-fill" />
        ) : null}

        {elements.map((element, index) => {
          const isSelected = selected === index;
          const label =
            element.kind === 'QR'
              ? 'QR'
              : element.kind === 'VARIABLE'
                ? element.variable || 'variável'
                : element.text || 'texto';

          return (
            <div
              key={`${element.id}-${index}`}
              role="button"
              tabIndex={0}
              aria-label={`Elemento ${index + 1}: ${label}`}
              aria-describedby={STAGE_HINT_ID}
              title={`Elemento ${index + 1}: ${label}`}
              data-testid={`stage-element-${index}`}
              onPointerDown={(event) => {
                onSelect(index);
                beginDrag(event, index, 'move');
              }}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onFocus={() => onSelect(index)}
              className={`absolute cursor-move overflow-hidden rounded-sm border text-xs leading-tight ${
                isSelected ? 'border-primary bg-primary/10' : 'border-dashed border-border bg-foreground/5'
              }`}
              style={{
                left: `${(element.xMm / widthMm) * 100}%`,
                top: `${(element.yMm / heightMm) * 100}%`,
                width: `${(element.widthMm / widthMm) * 100}%`,
                height: `${(element.heightMm / heightMm) * 100}%`,
              }}
            >
              <span className="pointer-events-none block truncate px-1 text-foreground">
                {index + 1}. {label}
              </span>

              {isSelected ? (
                <span
                  role="presentation"
                  data-testid={`stage-resize-${index}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    beginDrag(event, index, 'resize');
                  }}
                  className="absolute right-0 bottom-0 size-3 cursor-nwse-resize rounded-sm bg-primary"
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <p id={STAGE_HINT_ID} className="text-xs text-muted-foreground">
        No palco, a caixa focada anda com as <strong>setas</strong> (1 mm) e com{' '}
        <strong>Shift + setas</strong> (10 mm). As medidas aparecem nos campos ao lado.
      </p>

      <p
        role="status"
        aria-live="polite"
        data-testid="template-stage-announce"
        className={`text-xs text-muted-foreground ${announcement ? '' : 'sr-only'}`}
      >
        {announcement}
      </p>
    </div>
  );
}
