'use client';

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';

import type { CardPalette } from '@/domain/gamification/card-rules';
import type { CardStage, CardTilt } from '@/domain/gamification/card-presentation';
import { NEUTRAL_TILT, tiltFromPointer } from '@/domain/gamification/card-presentation';
import type { CardBackContent } from '@/domain/gamification/card-presentation';
import type { CardRarity } from '@/domain/gamification/types';
import { RARITY_LABELS } from '@/domain/gamification/card-rules';
import { CARD_DIMENSIONS, CardVisual } from '@/components/gamification/card-visual';
import { RotateCcw, Sparkles } from 'lucide-react';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CARTA PREMIUM — palco 3D com brilho holográfico (FASE 48)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O EFEITO É ENFEITE, NUNCA REQUISITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Sem JavaScript o que chega ao navegador é a carta ESTÁTICA — a mesma `<figure>`
 *  de sempre —, porque este componente é renderizado no servidor como qualquer
 *  outro. Nada de "carregando a carta": a coleção existe no HTML.
 *
 *  A ficha da conquista (o verso) também NÃO depende do efeito: ela é conteúdo, e
 *  a página a mostra ao lado do palco. O verso da carta é onde ela fica bonita.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS FREIOS QUE NÃO SE NEGOCIAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. `prefers-reduced-motion` desliga inclinação e partículas. Virar continua
 *     funcionando: é troca de conteúdo, não movimento.
 *  2. O teclado faz TUDO o que o ponteiro faz: as setas inclinam, `V`/Enter viram,
 *     `R` reinicia. Quem não usa mouse não perde a carta.
 *  3. `touch-action: none` só enquanto o dedo arrasta: sem isso, arrastar a carta
 *     no celular rola a página no lugar de girar — ou prende a rolagem quando
 *     deveria rolar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface HoloCardProps {
  name: string;
  rarity: CardRarity;
  palette: CardPalette;
  imageUrl?: string | null;
  isFoil?: boolean;
  stage: CardStage;
  back: CardBackContent;
  /** Arte do verso desenhada pela instituição — quando existe, ela é o fundo. */
  backArtUrl?: string | null;
  quantity?: number;
  /**
   * `hover` — álbum: inclina ao passar o ponteiro, sem arrastar, virar nem controles.
   * `stage` — página da carta: arrastar, virar, reiniciar e alternar a luz.
   */
  variant?: 'hover' | 'stage';
  size?: 'sm' | 'md' | 'lg';
  /** Só no palco: controles visíveis. */
  showControls?: boolean;
}

/** Movimento reduzido — assinatura de sistema externo (a preferência do sistema). */
function usePrefersReducedMotion(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window.matchMedia !== 'function') return () => {};

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  /**
   * `useSyncExternalStore` em vez de `useEffect` + `setState`: a preferência de
   * movimento é estado do SISTEMA, não do componente, e ler no efeito provocava
   * render em cascata (a regra `react-hooks/set-state-in-effect` reprova — e o
   * motivo é real: a primeira pintura já sai certa, sem uma segunda passada).
   */
  const getSnapshot = useCallback(
    () =>
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false,
    [],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function HoloCard({
  name,
  rarity,
  palette,
  imageUrl,
  isFoil = false,
  stage,
  back,
  backArtUrl = null,
  quantity = 0,
  variant = 'hover',
  size = 'md',
  showControls = true,
}: HoloCardProps) {
  const reducedMotion = usePrefersReducedMotion();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState<CardTilt>(NEUTRAL_TILT);
  const [flipped, setFlipped] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** "Luz e brilho": a luz do palco realça o brilho da carta. */
  const [light, setLight] = useState(false);

  const interactive = variant === 'stage';
  const tiltEnabled = stage.maxTiltDegrees > 0 && !reducedMotion;

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;

      setTilt(
        tiltFromPointer({
          x: clientX - box.left,
          y: clientY - box.top,
          width: box.width,
          height: box.height,
          maxTiltDegrees: stage.maxTiltDegrees,
        }),
      );
    },
    [stage.maxTiltDegrees],
  );

  const reset = useCallback(() => {
    setTilt(NEUTRAL_TILT);
    setFlipped(false);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || !tiltEnabled) return;
    // Captura o ponteiro: o dedo pode sair da carta durante o arrasto e o giro
    // continua respondendo — sem isso o movimento "trava" na borda.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    updateFromPointer(event.clientX, event.clientY);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!tiltEnabled) return;
    if (interactive && !dragging) return;
    updateFromPointer(event.clientX, event.clientY);
  };

  const endDrag = () => setDragging(false);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;

    const step = 4;
    const current = tilt;

    switch (event.key) {
      case 'ArrowRight':
        setTilt({ ...current, rotateY: Math.min(current.rotateY + step, stage.maxTiltDegrees) });
        break;
      case 'ArrowLeft':
        setTilt({ ...current, rotateY: Math.max(current.rotateY - step, -stage.maxTiltDegrees) });
        break;
      case 'ArrowDown':
        setTilt({ ...current, rotateX: Math.max(current.rotateX - step, -stage.maxTiltDegrees) });
        break;
      case 'ArrowUp':
        setTilt({ ...current, rotateX: Math.min(current.rotateX + step, stage.maxTiltDegrees) });
        break;
      case 'Enter':
      case ' ':
      case 'v':
      case 'V':
        setFlipped((value) => !value);
        break;
      case 'r':
      case 'R':
        reset();
        break;
      default:
        return;
    }

    event.preventDefault();
  };

  const style = {
    '--card-primary': palette.primary,
    '--card-secondary': palette.secondary,
    '--card-glow': palette.glow,
    '--card-text': palette.text,
    '--ef-holo-x': `${tilt.glareX}%`,
    '--ef-holo-y': `${tilt.glareY}%`,
    '--ef-holo-strength': String(stage.sheen / 100),
    '--ef-holo-tilt-x': `${tilt.rotateX}deg`,
    '--ef-holo-tilt-y': `${tilt.rotateY}deg`,
  } as React.CSSProperties;

  const dimensions = CARD_DIMENSIONS[size];
  const testId = interactive ? `holo-card-${name}` : `album-card-${name}`;

  return (
    <div className="space-y-3">
      <div
        ref={boxRef}
        className={`ef-holo-stage ${light ? 'ef-holo-stage-lit' : ''}`}
        data-testid={testId}
        data-holo={stage.holo ? 'on' : 'off'}
        data-foil={isFoil ? 'on' : 'off'}
        data-flipped={flipped ? 'on' : 'off'}
        data-dragging={dragging ? 'on' : 'off'}
        style={style}
        tabIndex={interactive ? 0 : -1}
        role={interactive ? 'group' : undefined}
        aria-label={
          interactive
            ? `${name} — ${RARITY_LABELS[rarity]}${isFoil ? ' (foil)' : ''}. Use as setas para inclinar, Enter para virar e R para reiniciar.`
            : undefined
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          endDrag();
          if (tiltEnabled) setTilt(NEUTRAL_TILT);
        }}
        onKeyDown={onKeyDown}
      >
        <div className="ef-holo-body">
          {/* Frente: a MESMA carta do álbum — uma régua só de desenho. */}
          <div className="ef-holo-face">
            <CardVisual
              name={name}
              rarity={rarity}
              palette={palette}
              imageUrl={imageUrl}
              isFoil={isFoil}
              quantity={quantity}
              size={size}
              animation={stage.animation}
            />

            {stage.sheen > 0 ? <span aria-hidden className="ef-holo-sheen" /> : null}
          </div>

          {/* Verso: a ficha da conquista (ou a arte que a instituição desenhou). */}
          <div className="ef-holo-face ef-holo-face-back" data-testid={`card-back-${name}`}>
            <div
              className={`relative flex ${dimensions} shrink-0 flex-col justify-between overflow-hidden rounded-xl p-3 ring-1 ${isFoil ? 'ring-2' : ''}`}
              style={{
                backgroundImage:
                  'linear-gradient(160deg, var(--card-secondary), var(--card-primary))',
                color: 'var(--card-text)',
              }}
            >
              {backArtUrl ? (
                // A arte do verso vem do cadastro da carta (URL http(s) validada no
                // domínio); `next/image` exigiria configurar o domínio de cada
                // instituição, e aqui a imagem é o FUNDO de uma face de tamanho fixo.
                // eslint-disable-next-line @next/next/no-img-element -- host do storage é dinâmico
                <img src={backArtUrl} alt="" className="absolute inset-0 size-full object-cover" aria-hidden />
              ) : null}

              <header className="relative flex items-center justify-between gap-2 text-xs">
                <span className="rounded-full bg-black/25 px-2 py-0.5 font-semibold uppercase tracking-wide backdrop-blur-sm">
                  Verso
                </span>
                <span className="rounded-full bg-black/25 px-2 py-0.5 uppercase backdrop-blur-sm">
                  {back.rarityLabel}
                </span>
              </header>

              <dl className="relative space-y-1.5">
                {back.lines.map((line) => (
                  <div key={line.key}>
                    <dt className="text-xs uppercase tracking-wide opacity-70">{line.label}</dt>
                    <dd className="text-xs font-medium leading-snug">{line.value}</dd>
                  </div>
                ))}
              </dl>

              {back.lore ? (
                <p className="relative text-xs italic leading-snug opacity-90">{back.lore}</p>
              ) : null}
            </div>
          </div>
        </div>

        {stage.particle !== 'none' && !reducedMotion ? (
          <span aria-hidden className={`ef-holo-particles ef-holo-particles-${stage.particle}`} />
        ) : null}
      </div>

      {interactive && showControls ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <p className="text-muted-foreground">
            {tiltEnabled
              ? 'Arraste para girar a carta (setas no teclado).'
              : 'Movimento reduzido: a carta não gira.'}
          </p>

          <button
            type="button"
            className="rounded-full border border-border bg-card px-3 py-1 font-medium"
            onClick={() => setFlipped((value) => !value)}
            data-testid="card-flip"
          >
            {flipped ? 'Ver frente' : 'Virar'}
          </button>

          <button
            type="button"
            className="rounded-full border border-border bg-card px-3 py-1 font-medium"
            onClick={reset}
            data-testid="card-reset"
          >
            <RotateCcw className="mr-1 inline size-3" aria-hidden />
            Reiniciar
          </button>

          {stage.holo ? (
            <button
              type="button"
              className="rounded-full border border-border bg-card px-3 py-1 font-medium"
              onClick={() => setLight((value) => !value)}
              aria-pressed={light}
              data-testid="card-light"
            >
              <Sparkles className="mr-1 inline size-3" aria-hidden />
              Luz e brilho
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
