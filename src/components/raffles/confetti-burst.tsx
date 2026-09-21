'use client';

import { useEffect, useRef } from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CONFETES DO PALCO (FASE 29)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA IMPLEMENTAÇÃO PRÓPRIA, E NÃO UMA BIBLIOTECA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `canvas-confetti` resolveria em uma linha — e traria uma dependência de UI para
 *  um projeto que não tem nenhuma, num arquivo que roda na parede do evento sem
 *  ninguém olhando o console. O efeito que o palco precisa é pequeno e conhecido
 *  (partículas caindo por alguns segundos), então ele vive aqui: ~100 linhas,
 *  auditáveis, sem superfície nova para manter.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS CUIDADOS QUE NÃO SÃO ENFEITE
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • `prefers-reduced-motion` — quem pediu menos movimento recebe a revelação
 *      sem confete. Um efeito "bonito" não pode ser obrigatório;
 *    • as CORES vêm das variáveis do tema do evento (`--ef-*`), lidas do CSS: o
 *      componente não conhece hexadecimal nenhum, e o telão nasce com a cara da
 *      instituição;
 *    • o canvas é `pointer-events-none` e fica ATRÁS do conteúdo, para não roubar
 *      clique de um telão que, na prática, é operado por controle remoto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Quanto tempo o efeito dura. Curto o bastante para não atrapalhar a leitura. */
const BURST_MS = 3_800;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  color: string;
}

/** Lê as cores do tema do evento; sem tema, cai na cor do texto do próprio canvas. */
function themeColors(canvas: HTMLCanvasElement): { colors: string[]; fallback: string } {
  const styles = getComputedStyle(canvas);
  const names = ['--ef-primary', '--ef-accent', '--ef-secondary', '--ef-text'];

  const found = names
    .map((name) => styles.getPropertyValue(name).trim())
    .filter((value) => value.length > 0);

  return {
    colors: found.length > 0 ? found : [styles.color],
    fallback: styles.color,
  };
}

export function ConfettiBurst({ active, testId }: { active: boolean; testId?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;

    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);

    const { colors, fallback } = themeColors(canvas);
    const particles: Particle[] = Array.from({ length: Math.min(180, Math.round(width / 6)) }, () => ({
      x: Math.random() * width,
      y: -20 - Math.random() * height * 0.4,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 1.6 + Math.random() * 2.8,
      size: 6 + Math.random() * 8,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.18,
      color: colors[Math.floor(Math.random() * colors.length)] ?? fallback,
    }));

    let frame = 0;
    const started = performance.now();

    const tick = () => {
      const elapsed = performance.now() - started;
      frame = window.requestAnimationFrame(tick);

      context.clearRect(0, 0, width, height);

      // Nos últimos 20% do efeito as partículas desaparecem em vez de sumir de uma
      // vez — corte seco no telão parece falha, não fim.
      const fade = elapsed > BURST_MS * 0.8 ? Math.max(0, 1 - (elapsed - BURST_MS * 0.8) / (BURST_MS * 0.2)) : 1;

      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.012;
        particle.rotation += particle.spin;

        context.save();
        context.globalAlpha = fade;
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
        context.restore();
      }

      if (elapsed >= BURST_MS) {
        window.cancelAnimationFrame(frame);
        context.clearRect(0, 0, width, height);
      }
    };

    frame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
      className="pointer-events-none fixed inset-0 z-0 size-full"
    />
  );
}
