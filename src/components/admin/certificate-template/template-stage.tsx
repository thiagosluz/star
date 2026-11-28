'use client';

import { useEffect, useRef, useState } from 'react';
import { QrCode } from 'lucide-react';

import {
  ELEMENT_NUDGE_FAST_MM,
  ELEMENT_NUDGE_MM,
  nudgeElementPosition,
  type CertificatePageFormat,
  type CertificatePreviewVariant,
} from '@/domain/certificates/certificate-layout-rules';
import {
  ensureStageReadableColor,
  resolveStageElementPreviewText,
  resolveStageFontStyle,
  snapElementPosition,
} from '@/domain/certificates/certificate-studio-rules';
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
  previewVariant?: CertificatePreviewVariant;
  onSelect: (index: number) => void;
  onMove: (index: number, xMm: number, yMm: number) => void;
  onResize: (index: number, widthMm: number, heightMm: number) => void;
}

const PT_TO_MM = 0.3528;

/** Palco WYSIWYG proporcional para arrastar, redimensionar, encaixar no centro e mover por teclado (mm). */
export function TemplateStage({
  page,
  elements,
  selected,
  backgroundHref,
  previewVariant = 'FULL',
  onSelect,
  onMove,
  onResize,
}: TemplateStageProps) {
  const [widthMm, heightMm] = page === 'A4_PORTRAIT' ? [210, 297] : [297, 210];
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [stageWidthPx, setStageWidthPx] = useState(560);
  const [guides, setGuides] = useState<{ centerX: boolean; centerY: boolean }>({
    centerX: false,
    centerY: false,
  });
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

  useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const sync = () => {
      const next = node.getBoundingClientRect().width;
      if (next > 0) setStageWidthPx(next);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const pxPerMm = stageWidthPx / widthMm;

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
      const nudged = nudgeElementPosition({
        element: state.origin,
        page,
        dxMm: roundMm(state.origin.xMm + deltaXMm) - state.origin.xMm,
        dyMm: roundMm(state.origin.yMm + deltaYMm) - state.origin.yMm,
      });

      const snapped = snapElementPosition({
        xMm: nudged.xMm,
        yMm: nudged.yMm,
        widthMm: state.origin.widthMm,
        heightMm: state.origin.heightMm,
        page,
      });

      setGuides({ centerX: snapped.snapCenterX, centerY: snapped.snapCenterY });
      onMove(state.index, snapped.xMm, snapped.yMm);
      return;
    }

    setGuides({ centerX: false, centerY: false });
    onResize(
      state.index,
      clampMm(roundMm(state.origin.widthMm + deltaXMm), 12, widthMm - state.origin.xMm),
      clampMm(roundMm(state.origin.heightMm + deltaYMm), 4, heightMm - state.origin.yMm),
    );
  };

  const endDrag = () => {
    drag.current = null;
    setGuides({ centerX: false, centerY: false });
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
      <div className="overflow-x-auto">
        <div
          ref={stageRef}
          onPointerMove={handleMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          data-testid="template-stage"
          className="relative w-full min-w-[1200px] overflow-hidden rounded-md border border-border bg-white shadow-sm"
          style={{ aspectRatio: `${widthMm} / ${heightMm}` }}
        >
        {backgroundHref ? (
          // eslint-disable-next-line @next/next/no-img-element -- a arte é um data: URI do bucket privado
          <img src={backgroundHref} alt="" className="pointer-events-none absolute inset-0 size-full object-fill" />
        ) : null}

        {guides.centerX ? (
          <div
            aria-hidden="true"
            data-testid="stage-guide-center-x"
            className="pointer-events-none absolute inset-y-0 left-1/2 w-px border-l border-dashed border-primary"
          />
        ) : null}

        {guides.centerY ? (
          <div
            aria-hidden="true"
            data-testid="stage-guide-center-y"
            className="pointer-events-none absolute inset-x-0 top-1/2 h-px border-t border-dashed border-primary"
          />
        ) : null}

        {elements.map((element, index) => {
          const isSelected = selected === index;
          const label =
            element.kind === 'QR'
              ? 'QR'
              : element.kind === 'VARIABLE'
                ? element.variable || 'variável'
                : element.text || 'texto';
          const liveText = resolveStageElementPreviewText(element, previewVariant);
          const fontStyle = resolveStageFontStyle(element.font);
          const fontSizePx = Math.max(7, element.sizePt * PT_TO_MM * pxPerMm);
          const textAlign =
            element.align === 'LEFT' ? 'left' : element.align === 'RIGHT' ? 'right' : 'center';

          const accessibleLabel =
            element.kind === 'QR'
              ? `Elemento ${index + 1}: QR`
              : `Elemento ${index + 1}: ${label} — ${liveText}`;

          return (
            <div
              key={`${element.id}-${index}`}
              role="button"
              tabIndex={0}
              aria-label={accessibleLabel}
              aria-describedby={STAGE_HINT_ID}
              title={`Elemento ${index + 1}: ${label}`}
              data-testid={`stage-element-${index}`}
              onPointerDown={(event) => {
                onSelect(index);
                beginDrag(event, index, 'move');
              }}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onFocus={() => onSelect(index)}
              className={`absolute cursor-move overflow-hidden rounded-xs border transition-colors ${isSelected
                ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                : 'border-dashed border-border/80 hover:border-primary/60'
                }`}
              style={{
                left: `${(element.xMm / widthMm) * 100}%`,
                top: `${(element.yMm / heightMm) * 100}%`,
                width: `${(element.widthMm / widthMm) * 100}%`,
                height: `${(element.heightMm / heightMm) * 100}%`,
              }}
            >
              {element.kind === 'QR' ? (
                <div className="pointer-events-none flex size-full flex-col items-center justify-center gap-0.5 bg-card/80 text-foreground">
                  <QrCode className="size-1/2 max-h-10 max-w-10" aria-hidden="true" />
                  <span className="text-xs font-medium">QR</span>
                </div>
              ) : (
                <span
                  className="pointer-events-none block size-full whitespace-pre-wrap break-words px-0.5"
                  style={{
                    fontFamily: fontStyle.fontFamily,
                    fontWeight: fontStyle.fontWeight,
                    fontStyle: fontStyle.fontStyle,
                    fontSize: `${fontSizePx}px`,
                    lineHeight: element.lineHeight || 1.35,
                    color: ensureStageReadableColor(element.color),
                    textAlign,
                  }}
                >
                  {liveText}
                </span>
              )}

              {isSelected ? (
                <span
                  role="presentation"
                  data-testid={`stage-resize-${index}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    beginDrag(event, index, 'resize');
                  }}
                  className="absolute right-0 bottom-0 size-3 cursor-nwse-resize rounded-xs bg-primary"
                />
              ) : null}
            </div>
          );
        })}
        </div>
      </div>

      <p id={STAGE_HINT_ID} className="text-xs text-muted-foreground">
        Arraste para mover (com encaixe automático no centro) ou use as <strong>setas</strong> (1 mm) e{' '}
        <strong>Shift + setas</strong> (10 mm).
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
