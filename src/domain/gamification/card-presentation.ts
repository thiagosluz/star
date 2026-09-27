/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Apresentação da carta (palco 3D, brilho holográfico e verso)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A GEOMETRIA DO MOVIMENTO MORA NO DOMÍNIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A inclinação da carta é TRIGONOMETRIA, não estilo: o mesmo cálculo decide o
 *  giro e a posição do brilho, e é ele que a suíte consegue prender em teste —
 *  "o canto superior esquerdo inclina para onde?" é pergunta com resposta certa.
 *
 *  Escrito dentro do componente, o efeito só seria verificável abrindo o
 *  navegador e olhando. Aqui, `tiltFromPointer` é função pura: entra ponteiro e
 *  caixa, sai ângulo.
 *
 *  O componente continua sendo quem decide SE aplica (movimento reduzido, sem
 *  JavaScript, tela pequena) — o domínio só diz ONDE a carta vai parar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { CardRarity, CardTrigger } from '@/domain/gamification/types';
import { CARD_TRIGGER_LABELS } from '@/domain/gamification/types';
import type { CardAnimation, CardArt, CardParticle } from '@/domain/gamification/card-rules';
import { RARITY_LABELS } from '@/domain/gamification/card-rules';

/**
 * Teto e piso do giro, em graus.
 *
 * O piso existe porque inclinação de 1 grau não se vê: quem declara `tilt: 0`
 * quer o palco PARADO, e isso é o `enabled` da configuração, não um ângulo
 * imperceptível. Entre 6 e 20 graus o efeito é o mesmo em qualquer tela pequena
 * ou grande — o que muda com a intensidade é quanto a carta se move, não se ela
 * se mexe.
 */
export const MIN_TILT_DEGREES = 6;
export const MAX_TILT_DEGREES = 20;

/** Quanto a variante foil soma ao brilho declarado (ela É a variante holográfica). */
export const FOIL_SHEEN_BONUS = 25;

export interface CardStage {
  /** Brilho holográfico ligado (declarado pela instituição OU variante foil). */
  holo: boolean;
  /** Intensidade do brilho, 0–100. */
  sheen: number;
  /** Intensidade da inclinação, 0–100. */
  tilt: number;
  /** Giro máximo em graus — derivado de `tilt`, nunca lido da tela. */
  maxTiltDegrees: number;
  particle: CardParticle;
  animation: CardAnimation;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/**
 * O que o palco deve mostrar para ESTA carta.
 *
 * Duas decisões que valem a leitura:
 *   • a variante **foil liga o brilho sozinha**. Desde a FASE 5 foil é a "variante
 *     holográfica" — exigir um segundo interruptor para a carta que já é
 *     holográfica seria pedir à instituição que confirme o óbvio, e as cartas
 *     concedidas ANTES desta fase (que já podem ser foil) apareceriam sem efeito;
 *   • a raridade NÃO mexe na intensidade. Ela já governa anel, brilho e cor; somar
 *     "quanto de holografia" ao mesmo eixo faria uma mítica com `sheen: 0` brilhar
 *     mais que uma lendária com `sheen: 100`, e a instituição perderia o controle.
 */
export function resolveCardStage(input: {
  art: CardArt;
  isFoil: boolean;
  rarity: CardRarity;
}): CardStage {
  const holo = input.art.holo || input.isFoil;
  const tilt = clampPercent(input.art.tilt);

  const sheen = holo
    ? clampPercent(input.art.sheen + (input.isFoil ? FOIL_SHEEN_BONUS : 0))
    : 0;

  return {
    holo,
    sheen,
    tilt,
    maxTiltDegrees:
      tilt === 0
        ? 0
        : Math.round(MIN_TILT_DEGREES + ((MAX_TILT_DEGREES - MIN_TILT_DEGREES) * tilt) / 100),
    particle: input.art.particle,
    animation: input.art.animation,
  };
}

export interface CardTilt {
  /** Giro no eixo horizontal (topo recua / base avança), em graus. */
  rotateX: number;
  /** Giro no eixo vertical (direita recua / esquerda avança), em graus. */
  rotateY: number;
  /** Posição do brilho, em porcentagem da caixa. */
  glareX: number;
  glareY: number;
}

export const NEUTRAL_TILT: CardTilt = { rotateX: 0, rotateY: 0, glareX: 50, glareY: 50 };

/**
 * Onde a carta para quando o ponteiro está em `(x, y)`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O LADO SOB O PONTEIRO RECUA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É a convenção do `rotateX`/`rotateY` do CSS (girar em torno de +X leva a parte
 *  de baixo para perto do leitor; em torno de +Y, leva a direita para longe). Com
 *  os dois sinais assim, o canto sob o cursor é o que se afasta, e a carta parece
 *  estar sendo EMPURRADA — que é o que o dedo faz no celular.
 *
 *  Toda entrada degenerada devolve a carta parada, e não `NaN`: uma caixa de
 *  altura zero aparece em layout que ainda não mediu (primeira pintura, `display:
 *  none`), e `rotateX(NaN)` apaga o elemento da tela em alguns navegadores.
 */
export function tiltFromPointer(input: {
  x: number;
  y: number;
  width: number;
  height: number;
  maxTiltDegrees: number;
}): CardTilt {
  const { x, y, width, height, maxTiltDegrees } = input;

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxTiltDegrees) ||
    width <= 0 ||
    height <= 0 ||
    maxTiltDegrees <= 0
  ) {
    return { ...NEUTRAL_TILT };
  }

  const clampedX = Math.min(Math.max(x, 0), width);
  const clampedY = Math.min(Math.max(y, 0), height);

  /** -1 (borda esquerda/topo) a 1 (borda direita/base); 0 é o centro. */
  const nx = (clampedX / width) * 2 - 1;
  const ny = (clampedY / height) * 2 - 1;

  return {
    rotateX: round2(-ny * maxTiltDegrees),
    rotateY: round2(nx * maxTiltDegrees),
    glareX: round2((clampedX / width) * 100),
    glareY: round2((clampedY / height) * 100),
  };
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  /**
   * `-0` não é curiosidade: `Math.round(-0.001 * 100) / 100` devolve `-0`, e o
   * componente escreveria `rotateX(-0deg)`. O valor é o mesmo, o texto não — e o
   * teste unitário enxerga a diferença (`Object.is(-0, 0)` é falso), que é como
   * esta linha apareceu.
   */
  return rounded === 0 ? 0 : rounded;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Verso — a ficha da conquista
// ───────────────────────────────────────────────────────────────────────────────
export interface CardBackInput {
  rarity: CardRarity;
  trigger: string;
  description: string | null;
  lore: string | null;
  quantity: number;
  isFoil: boolean;
  level: number;
  grantedAt: Date | null;
  /** Fuso da instituição: a data da conquista é lida no dia de quem a concedeu. */
  timezone: string;
}

export interface CardBackLine {
  key: string;
  label: string;
  value: string;
}

export interface CardBackContent {
  rarityLabel: string;
  triggerLabel: string;
  lines: CardBackLine[];
  /** Texto longo, quando existe — vem DEPOIS dos fatos, e é o único opcional. */
  lore: string | null;
}

/**
 * O que vai no verso quando a instituição não desenhou um.
 *
 * O verso não é decoração de reserva: é a FICHA da conquista — o que a carta
 * significa, quando foi ganha e em que variante. Numa coleção, "por que eu tenho
 * esta carta?" é a pergunta que dá valor a ela, e a frente (arte + nome) não
 * responde.
 *
 * `null` de data aparece como "—" e não como "não registrado": a carta pode ter
 * sido concedida por caminho antigo sem carimbo, e inventar uma data seria pior
 * que declarar a ausência.
 */
export function cardBackContent(input: CardBackInput): CardBackContent {
  const lines: CardBackLine[] = [
    { key: 'trigger', label: 'Como foi conquistada', value: triggerLabelOf(input.trigger) },
    { key: 'granted', label: 'Conquistada em', value: formatCardDate(input.grantedAt, input.timezone) },
    { key: 'variant', label: 'Variante', value: input.isFoil ? 'Holográfica (foil)' : 'Padrão' },
    { key: 'level', label: 'Nível da carta', value: String(Math.max(1, input.level)) },
  ];

  /**
   * Cópias só aparecem quando EXISTEM. "1 cópia" em toda carta transformaria a
   * exceção (duplicata) em ruído, e a duplicata é justamente o que a pessoa
   * mostra.
   */
  if (input.quantity > 1) {
    lines.push({ key: 'copies', label: 'Cópias', value: `${input.quantity} (${input.quantity - 1} duplicata(s))` });
  }

  if (input.description) {
    lines.push({ key: 'description', label: 'Sobre a carta', value: input.description });
  }

  return {
    rarityLabel: RARITY_LABELS[input.rarity] ?? input.rarity,
    triggerLabel: triggerLabelOf(input.trigger),
    lines,
    lore: input.lore,
  };
}

function triggerLabelOf(trigger: string): string {
  return CARD_TRIGGER_LABELS[trigger as CardTrigger] ?? 'Conquista desbloqueada';
}

/**
 * A data da conquista no fuso da INSTITUIÇÃO, em formato curto.
 *
 * Sem hora de propósito: a carta comemora um dia, e "12/03/2026" é o que se lê
 * numa carta. A hora exata é dado operacional, que vive no extrato de XP.
 */
export function formatCardDate(date: Date | null, timezone: string): string {
  if (!date || Number.isNaN(date.getTime())) return '—';

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    /**
     * Fuso inválido no banco não pode derrubar a tela da coleção: o fallback é a
     * data em UTC — que pode estar um dia fora, e é por isso que ele é a exceção,
     * não o caminho.
     */
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }
}
