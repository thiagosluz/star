/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Cartas colecionáveis
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS DECISÕES QUE DEFINEM ESTE MÓDULO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. O SORTEIO É INJETÁVEL. `pickCard(candidatas, { random })` recebe a fonte de
 *     aleatoriedade. Em produção é `secureRandom()`; nos testes é uma sequência
 *     fixa. Sem isso, testar distribuição de raridade seria impossível — e a
 *     alternativa usual (mockar o módulo) testa o mock, não a regra.
 *
 *  2. A RARIDADE SEM CARTA NÃO SOME. Se a instituição não cadastrou nenhuma carta
 *     épica, os 10 % da faixa épica são REDISTRIBUÍDOS entre as que existem. Caso
 *     contrário, 10 % dos sorteios não produziriam carta alguma e o participante
 *     receberia "nada" sem entender por quê.
 *
 *  3. A ESCASSEZ É RESERVADA NO BANCO. `maxSupply` é conferido por UPDATE
 *     condicional (mesmo padrão da lotação de atividades, ADR-014). Contar em
 *     JavaScript e inserir depois tem janela de corrida, e carta limitada é
 *     justamente o que a corrida ataca.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod';

import { colorSchema, safeUrlSchema } from '@/domain/events/landing-page';
import { CARD_RARITIES, type CardRarity, type CardTrigger, type XpSourceKind } from '@/domain/gamification/types';

// ───────────────────────────────────────────────────────────────────────────────
//  Distribuição de raridade
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Chance base de cada raridade em um sorteio.
 *
 * Somam exatamente 1.0 (há teste que verifica isso). Os valores foram escolhidos
 * para que a carta rara ainda seja surpresa: 60 % de comuns mantém a âncora, e
 * 5 % entre épica/lendária/mítica preserva o "isso é raro de verdade".
 */
export const RARITY_DROP_CHANCE: Readonly<Record<CardRarity, number>> = {
  COMMON: 0.6,
  RARE: 0.25,
  EPIC: 0.1,
  LEGENDARY: 0.04,
  MYTHIC: 0.01,
};

/** Ordem crescente de raridade — usada para comparar e ordenar. */
export const RARITY_ORDER: readonly CardRarity[] = CARD_RARITIES;

export const RARITY_LABELS: Readonly<Record<CardRarity, string>> = {
  COMMON: 'Comum',
  RARE: 'Rara',
  EPIC: 'Épica',
  LEGENDARY: 'Lendária',
  MYTHIC: 'Mítica',
};

/**
 * Paleta de emergência por raridade.
 *
 * Uma carta sem paleta válida ainda precisa ser exibível: cair para o padrão da
 * raridade mantém a hierarquia visual (a lendária continua dourada) em vez de
 * mostrar um retângulo cinza.
 */
export const DEFAULT_PALETTES: Readonly<Record<CardRarity, CardPalette>> = {
  COMMON: { primary: '#64748b', secondary: '#1e293b', glow: '#94a3b8', text: '#f8fafc' },
  RARE: { primary: '#2563eb', secondary: '#1e3a8a', glow: '#60a5fa', text: '#eff6ff' },
  EPIC: { primary: '#7c3aed', secondary: '#3b0764', glow: '#c084fc', text: '#faf5ff' },
  LEGENDARY: { primary: '#d97706', secondary: '#78350f', glow: '#fbbf24', text: '#fffbeb' },
  MYTHIC: { primary: '#db2777', secondary: '#500724', glow: '#f472b6', text: '#fdf2f8' },
};

export interface CardPalette {
  primary: string;
  secondary: string;
  glow: string;
  text: string;
}

export const ANIMATIONS = ['none', 'shimmer', 'float', 'pulse'] as const;
export type CardAnimation = (typeof ANIMATIONS)[number];

export const PARTICLES = ['none', 'sparkle', 'dust', 'orbit'] as const;
export type CardParticle = (typeof PARTICLES)[number];

/** Arte e efeitos. URLs passam por allowlist de protocolo (http/https). */
export interface CardArt {
  imageUrl: string | null;
  frameUrl: string | null;
  animation: CardAnimation;
  particle: CardParticle;
  foil: boolean;
}

/**
 * Formatos completos de paleta e arte.
 *
 * Servem como DOCUMENTAÇÃO do contrato do JSON gravado em `CardTemplate`. A
 * validação em si é feita CAMPO A CAMPO por `readField` (ver comentário abaixo):
 * validar o objeto inteiro com zod é tudo-ou-nada e descartaria campos válidos
 * junto com o inválido.
 */
/**
 * Valida UM campo, isoladamente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO VALIDAR O OBJETO INTEIRO COM ZOD
 * ─────────────────────────────────────────────────────────────────────────────
 *  `schema.safeParse(objeto)` é TUDO-OU-NADA: um único campo inválido reprova o
 *  objeto e obriga a descartar os campos válidos junto. Era exatamente o que
 *  acontecia aqui — um `glow` digitado errado apagava as outras três cores e a
 *  carta caía inteira no padrão.
 *
 *  Validar campo a campo entrega a política que queremos: o dado ruim é
 *  descartado, o dado bom é preservado. O schema do objeto continua existindo
 *  como documentação do formato completo.
 */
function readField<T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, value: unknown): T | null {
  if (value === undefined || value === null) return null;
  const parsed = schema.safeParse(value);
  return parsed.success && parsed.data !== undefined ? parsed.data : null;
}

const animationSchema = z.enum(ANIMATIONS);
const particleSchema = z.enum(PARTICLES);
const booleanSchema = z.boolean();

/** Normaliza a paleta vinda do banco (JSON livre) para algo renderizável. */
export function resolvePalette(raw: unknown, rarity: CardRarity): CardPalette {
  const fallback = DEFAULT_PALETTES[rarity] ?? DEFAULT_PALETTES.COMMON;
  const record = asRecord(raw);
  if (!record) return { ...fallback };

  return {
    primary: readField(colorSchema, record.primary) ?? fallback.primary,
    secondary: readField(colorSchema, record.secondary) ?? fallback.secondary,
    glow: readField(colorSchema, record.glow) ?? fallback.glow,
    text: readField(colorSchema, record.text) ?? fallback.text,
  };
}

/** Normaliza a arte; URLs fora de http(s) são descartadas (nunca viram `src`). */
export function resolveArt(raw: unknown): CardArt {
  const record = asRecord(raw) ?? {};

  return {
    imageUrl: readField(safeUrlSchema, record.imageUrl),
    frameUrl: readField(safeUrlSchema, record.frameUrl),
    animation: readField(animationSchema, record.animation) ?? 'none',
    particle: readField(particleSchema, record.particle) ?? 'none',
    foil: readField(booleanSchema, record.foil) ?? false,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Variáveis CSS da paleta — o componente aplica como estilo, nunca como string solta. */
export function paletteToCssVariables(palette: CardPalette): Record<string, string> {
  return {
    '--card-primary': palette.primary,
    '--card-secondary': palette.secondary,
    '--card-glow': palette.glow,
    '--card-text': palette.text,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Foil
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Chance de a carta sair em FOIL (variante holográfica).
 *
 * Cresce com a raridade: uma comum em foil precisa ser mais rara que uma mítica
 * normal, senão a variante perde sentido. O teto existe para que foil nunca seja
 * garantido — garantia transforma variante em requisito.
 */
export const RARITY_FOIL_CHANCE: Readonly<Record<CardRarity, number>> = {
  COMMON: 0.03,
  RARE: 0.05,
  EPIC: 0.08,
  LEGENDARY: 0.12,
  MYTHIC: 0.2,
};

export const MAX_FOIL_CHANCE = 0.35;

export function foilChanceFor(rarity: CardRarity): number {
  return Math.min(RARITY_FOIL_CHANCE[rarity] ?? 0, MAX_FOIL_CHANCE);
}

export function shouldBeFoil(rarity: CardRarity, random: number): boolean {
  return random < foilChanceFor(rarity);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Elegibilidade e sorteio
// ───────────────────────────────────────────────────────────────────────────────
/** Candidata a sorteio — o mínimo que a regra precisa saber sobre a carta. */
export interface CardCandidate {
  id: string;
  slug: string;
  name: string;
  rarity: CardRarity;
  levelRequired: number;
  dropWeight: number;
  /** 0 = ilimitado. */
  maxSupply: number;
  mintedCount: number;
  availableUntil: Date | null;
  isActive: boolean;
}

export interface CardAvailability {
  available: boolean;
  reason: string | null;
}

/**
 * A carta pode ser concedida agora?
 *
 * Cada motivo de recusa é textual porque o comitê precisa poder explicar ao
 * participante por que a carta não saiu — "não ganhou" sem explicação é o que
 * faz o usuário concluir que o sistema está quebrado.
 */
export function evaluateCardAvailability(input: {
  card: CardCandidate;
  now: Date;
  userLevel: number;
}): CardAvailability {
  const { card, now, userLevel } = input;

  if (!card.isActive) {
    return { available: false, reason: 'Carta desativada pela organização.' };
  }

  if (card.availableUntil && card.availableUntil.getTime() <= now.getTime()) {
    return { available: false, reason: 'Edição limitada já encerrada.' };
  }

  if (card.maxSupply > 0 && card.mintedCount >= card.maxSupply) {
    return { available: false, reason: 'Tiragem esgotada.' };
  }

  if (userLevel < card.levelRequired) {
    return {
      available: false,
      reason: `Requer nível ${card.levelRequired} (você está no ${userLevel}).`,
    };
  }

  return { available: true, reason: null };
}

/** Sorteia a raridade respeitando as chances e o que existe no catálogo. */
export function rollRarity(
  random: number,
  available: readonly CardRarity[] = RARITY_ORDER,
): CardRarity | null {
  if (available.length === 0) return null;

  /**
   * Redistribuição proporcional: as chances das raridades AUSENTES são
   * distribuídas entre as presentes, mantendo as proporções relativas. Sem isso,
   * uma instituição sem cartas míticas perderia 1 % dos sorteios.
   */
  const present = RARITY_ORDER.filter((rarity) => available.includes(rarity));
  const totalWeight = present.reduce((sum, rarity) => sum + RARITY_DROP_CHANCE[rarity], 0);
  if (totalWeight <= 0) return present[0] ?? null;

  const roll = clamp01(random) * totalWeight;
  let cursor = 0;

  for (const rarity of present) {
    cursor += RARITY_DROP_CHANCE[rarity];
    if (roll < cursor) return rarity;
  }

  // Só alcançável por erro de ponto flutuante no último intervalo.
  return present[present.length - 1] ?? null;
}

/**
 * Escolhe UMA carta entre as candidatas.
 *
 * Duas etapas: sorteia a raridade e, dentro dela, sorteia a carta com peso
 * `dropWeight` — onde MAIOR peso significa MAIS comum (o nome vem do banco e é
 * interpretado como "peso de queda"). Carta com peso 200 aparece o dobro de uma
 * com peso 100 dentro da mesma raridade.
 */
export function pickCard(
  candidates: readonly CardCandidate[],
  input: { random: () => number; userLevel: number; now?: Date },
): CardCandidate | null {
  const now = input.now ?? new Date();

  const eligible = candidates.filter(
    (card) => evaluateCardAvailability({ card, now, userLevel: input.userLevel }).available,
  );
  if (eligible.length === 0) return null;

  const byRarity = new Map<CardRarity, CardCandidate[]>();
  for (const card of eligible) {
    const bucket = byRarity.get(card.rarity) ?? [];
    bucket.push(card);
    byRarity.set(card.rarity, bucket);
  }

  const rarity = rollRarity(clamp01(input.random()), [...byRarity.keys()]);
  if (!rarity) return null;

  const pool = byRarity.get(rarity) ?? [];
  if (pool.length === 0) return null;

  const totalWeight = pool.reduce((sum, card) => sum + Math.max(1, card.dropWeight), 0);
  const roll = clamp01(input.random()) * totalWeight;
  let cursor = 0;

  for (const card of pool) {
    cursor += Math.max(1, card.dropWeight);
    if (roll < cursor) return card;
  }

  return pool[pool.length - 1] ?? null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value >= 1) return 0.999999999;
  return value;
}

/**
 * O gerador de aleatoriedade NÃO mora aqui.
 *
 * O domínio é isomórfico de propósito: componentes de cliente importam este
 * módulo para renderizar paleta, raridade e rótulos. Um `import 'node:crypto'`
 * neste arquivo quebraria o bundle do navegador para entregar algo que o cliente
 * nunca precisa. Quem sorteia é a camada de aplicação
 * (`src/lib/gamification/random.ts`), que passa `random` como dependência.
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Álbum
// ───────────────────────────────────────────────────────────────────────────────
export interface AlbumEntry {
  templateId: string;
  slug: string;
  name: string;
  rarity: CardRarity;
  owned: boolean;
  isFoil: boolean;
  quantity: number;
  level: number;
  isPinned: boolean;
  secret: boolean;
}

export interface AlbumSummary {
  owned: number;
  total: number;
  /** Cartas secretas ainda não obtidas NÃO entram no denominador. */
  completionRatio: number;
  byRarity: Record<CardRarity, { owned: number; total: number }>;
  foils: number;
  duplicates: number;
  pinned: number;
}

/**
 * Resumo do álbum.
 *
 * Cartas secretas não descobertas ficam FORA do denominador: incluí-las tornaria
 * 100 % inalcançável sem que o participante soubesse o que falta — coleção que
 * não pode ser completada deixa de ser coleção.
 */
export function summarizeAlbum(entries: readonly AlbumEntry[]): AlbumSummary {
  const countable = entries.filter((entry) => !entry.secret || entry.owned);
  const byRarity = {} as AlbumSummary['byRarity'];

  for (const rarity of RARITY_ORDER) {
    byRarity[rarity] = { owned: 0, total: 0 };
  }

  let owned = 0;
  let foils = 0;
  let duplicates = 0;
  let pinned = 0;

  for (const entry of countable) {
    byRarity[entry.rarity].total += 1;
    if (entry.owned) {
      byRarity[entry.rarity].owned += 1;
      owned += 1;
      if (entry.isFoil) foils += 1;
      if (entry.quantity > 1) duplicates += entry.quantity - 1;
      if (entry.isPinned) pinned += 1;
    }
  }

  const total = countable.length;

  return {
    owned,
    total,
    completionRatio: total === 0 ? 0 : round2(owned / total),
    byRarity,
    foils,
    duplicates,
    pinned,
  };
}

/** Máximo de cartas fixadas no perfil público. */
export const MAX_PINNED_CARDS = 3;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Gatilhos
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Tradução de origem de XP para gatilho de carta.
 *
 * Existe porque os dois enums são parecidos mas não idênticos (o de carta tem
 * `LEVEL_UP`, `STREAK`, `MANUAL_GRANT`…; o de XP tem `BONUS`,
 * `ADMIN_ADJUSTMENT`, `REFERRAL`). Mapear explicitamente evita a suposição
 * silenciosa de que os nomes coincidem.
 *
 * `SPONSOR_QR` fica FORA de propósito: quem concede a carta da visita é o próprio
 * fluxo da leitura, com a carta escolhida no QR (`sponsor_qr_codes.cardTemplateId`).
 * Mapear aqui daria uma segunda concessão por sorteio — a carta sairia em dobro.
 */
export const XP_SOURCE_TO_CARD_TRIGGER: Readonly<Partial<Record<XpSourceKind, CardTrigger>>> = {
  CHECKIN: 'CHECKIN',
  ACTIVITY_ATTENDANCE: 'ACTIVITY_COMPLETION',
  MINI_COURSE_COMPLETION: 'MINI_COURSE_COMPLETION',
  SUBMISSION_SUBMITTED: 'SUBMISSION_SUBMITTED',
  SUBMISSION_ACCEPTED: 'SUBMISSION_ACCEPTED',
  REVIEW_COMPLETED: 'REVIEW_COMPLETED',
  REGISTRATION_CONFIRMED: 'REGISTRATION_CONFIRMED',
  CERTIFICATE_ISSUED: 'CERTIFICATE_ISSUED',
  RAFFLE_WON: 'RAFFLE_WON',
};

export function cardTriggerForSource(source: XpSourceKind): CardTrigger | null {
  return XP_SOURCE_TO_CARD_TRIGGER[source] ?? null;
}
