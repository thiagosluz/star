'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Celebração (Canvas Confetti)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ACESSIBILIDADE NÃO É OPCIONAL EM ANIMAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem pediu `prefers-reduced-motion` no sistema pediu por um motivo — e
 *  confete é exatamente o tipo de estímulo que causa desconforto vestibular. A
 *  função checa a preferência ANTES de animar e simplesmente não faz nada.
 *
 *  A importação de `canvas-confetti` é DINÂMICA: o pacote só entra no bundle
 *  quando alguém realmente ganha algo, em vez de pesar o carregamento inicial de
 *  todas as páginas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type CelebrationIntensity = 'low' | 'medium' | 'high';

const PARTICLE_COUNT: Record<CelebrationIntensity, number> = {
  low: 40,
  medium: 90,
  high: 180,
};

export function celebrate(options: { intensity?: CelebrationIntensity } = {}): void {
  if (typeof window === 'undefined') return;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reducedMotion) return;

  const intensity = options.intensity ?? 'low';

  void import('canvas-confetti')
    .then((module) => {
      const confetti = module.default;
      const count = PARTICLE_COUNT[intensity];

      confetti({
        particleCount: count,
        spread: intensity === 'high' ? 100 : 70,
        origin: { y: 0.7 },
        scalar: intensity === 'high' ? 1.1 : 0.9,
        disableForReducedMotion: true,
      });

      // Nível novo merece uma segunda explosão: é o evento mais raro dos três.
      if (intensity === 'high') {
        setTimeout(() => {
          confetti({
            particleCount: Math.round(count / 2),
            angle: 60,
            spread: 70,
            origin: { x: 0 },
            disableForReducedMotion: true,
          });
          confetti({
            particleCount: Math.round(count / 2),
            angle: 120,
            spread: 70,
            origin: { x: 1 },
            disableForReducedMotion: true,
          });
        }, 220);
      }
    })
    .catch(() => {
      // Confete é enfeite: falhar em carregar não pode virar erro na tela.
    });
}
