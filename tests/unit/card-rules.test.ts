/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — cartas colecionáveis
 *
 *  O sorteio recebe a aleatoriedade por parâmetro, então aqui ele é
 *  DETERMINÍSTICO: cada teste injeta a sequência que quer testar. Nenhum teste
 *  depende de sorte.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PALETTES,
  MAX_FOIL_CHANCE,
  MAX_PINNED_CARDS,
  RARITY_DROP_CHANCE,
  RARITY_ORDER,
  cardTriggerForSource,
  evaluateCardAvailability,
  foilChanceFor,
  paletteToCssVariables,
  pickCard,
  resolveArt,
  resolvePalette,
  rollRarity,
  shouldBeFoil,
  summarizeAlbum,
  type AlbumEntry,
  type CardCandidate,
} from '../../src/domain/gamification/card-rules';
import { CARD_RARITIES, type CardRarity } from '../../src/domain/gamification/types';

// ───────────────────────────────────────────────────────────────────────────────
function card(overrides: Partial<CardCandidate> = {}): CardCandidate {
  return {
    id: `card-${Math.random().toString(36).slice(2, 8)}`,
    slug: 'carta',
    name: 'Carta',
    rarity: 'COMMON',
    levelRequired: 1,
    dropWeight: 100,
    maxSupply: 0,
    mintedCount: 0,
    availableUntil: null,
    isActive: true,
    ...overrides,
  };
}

/** Fila de números "aleatórios" para injetar no sorteio. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('distribuição de raridade', () => {
  it('as chances somam exatamente 1', () => {
    const total = RARITY_ORDER.reduce((sum, rarity) => sum + RARITY_DROP_CHANCE[rarity], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('cobre todas as raridades do enum', () => {
    for (const rarity of CARD_RARITIES) {
      expect(RARITY_DROP_CHANCE[rarity]).toBeGreaterThan(0);
      expect(DEFAULT_PALETTES[rarity]).toBeDefined();
    }
  });

  it('é monótona: comum mais provável que mítica', () => {
    const ordered = [...RARITY_ORDER];
    for (let i = 1; i < ordered.length; i += 1) {
      expect(RARITY_DROP_CHANCE[ordered[i]!]).toBeLessThan(RARITY_DROP_CHANCE[ordered[i - 1]!]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('rollRarity()', () => {
  const all: CardRarity[] = [...RARITY_ORDER];

  it('respeita os limites de cada faixa', () => {
    expect(rollRarity(0, all)).toBe('COMMON');
    expect(rollRarity(0.5999, all)).toBe('COMMON');
    expect(rollRarity(0.6, all)).toBe('RARE');
    expect(rollRarity(0.8499, all)).toBe('RARE');
    expect(rollRarity(0.85, all)).toBe('EPIC');
    expect(rollRarity(0.9499, all)).toBe('EPIC');
    expect(rollRarity(0.95, all)).toBe('LEGENDARY');
    expect(rollRarity(0.9899, all)).toBe('LEGENDARY');
    expect(rollRarity(0.99, all)).toBe('MYTHIC');
  });

  it('REDISTRIBUI a chance das raridades ausentes', () => {
    /**
     * Se a instituição só cadastrou cartas raras, TODA carta sorteada precisa ser
     * rara. Sem redistribuição, 40 % dos sorteios não dariam carta nenhuma.
     */
    expect(rollRarity(0, ['RARE'])).toBe('RARE');
    expect(rollRarity(0.5, ['RARE'])).toBe('RARE');
    expect(rollRarity(0.999, ['RARE'])).toBe('RARE');

    // Com duas faixas, a proporção relativa entre elas é mantida:
    // RARE 0.25 e MYTHIC 0.01 → 25/26 da massa para RARE.
    expect(rollRarity(0, ['RARE', 'MYTHIC'])).toBe('RARE');
    expect(rollRarity(0.96, ['RARE', 'MYTHIC'])).toBe('RARE');
    expect(rollRarity(0.97, ['RARE', 'MYTHIC'])).toBe('MYTHIC');
  });

  it('devolve null sem catálogo', () => {
    expect(rollRarity(0.5, [])).toBeNull();
  });

  it('nunca devolve raridade fora das disponíveis', () => {
    for (let i = 0; i <= 100; i += 1) {
      const rarity = rollRarity(i / 100, ['COMMON', 'EPIC']);
      expect(['COMMON', 'EPIC']).toContain(rarity);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evaluateCardAvailability()', () => {
  const now = new Date('2026-09-17T12:00:00.000Z');

  it('libera a carta elegível', () => {
    const verdict = evaluateCardAvailability({ card: card(), now, userLevel: 1 });
    expect(verdict.available).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it('explica cada recusa', () => {
    expect(
      evaluateCardAvailability({ card: card({ isActive: false }), now, userLevel: 1 }).reason,
    ).toMatch(/desativada/i);

    expect(
      evaluateCardAvailability({
        card: card({ availableUntil: new Date('2026-09-16T12:00:00.000Z') }),
        now,
        userLevel: 1,
      }).reason,
    ).toMatch(/encerrada/i);

    expect(
      evaluateCardAvailability({
        card: card({ maxSupply: 10, mintedCount: 10 }),
        now,
        userLevel: 1,
      }).reason,
    ).toMatch(/tiragem/i);

    expect(
      evaluateCardAvailability({ card: card({ levelRequired: 12 }), now, userLevel: 3 }).reason,
    ).toMatch(/nível 12/i);
  });

  it('o limite de tiragem é exclusivo: a última unidade ainda sai', () => {
    const verdict = evaluateCardAvailability({
      card: card({ maxSupply: 10, mintedCount: 9 }),
      now,
      userLevel: 1,
    });
    expect(verdict.available).toBe(true);
  });

  it('`maxSupply = 0` significa ilimitado', () => {
    const verdict = evaluateCardAvailability({
      card: card({ maxSupply: 0, mintedCount: 999_999 }),
      now,
      userLevel: 1,
    });
    expect(verdict.available).toBe(true);
  });

  it('a data limite é exclusiva no instante exato', () => {
    const verdict = evaluateCardAvailability({
      card: card({ availableUntil: now }),
      now,
      userLevel: 1,
    });
    expect(verdict.available).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('pickCard()', () => {
  const now = new Date('2026-09-17T12:00:00.000Z');

  it('sorteia raridade e depois a carta dentro dela', () => {
    const common = card({ id: 'c1', rarity: 'COMMON', dropWeight: 100 });
    const mythic = card({ id: 'm1', rarity: 'MYTHIC', dropWeight: 100 });

    // Primeiro número define a raridade, o segundo escolhe dentro dela.
    expect(pickCard([common, mythic], { random: sequence([0.1, 0.5]), userLevel: 1, now })?.id).toBe(
      'c1',
    );
    expect(pickCard([common, mythic], { random: sequence([0.995, 0.5]), userLevel: 1, now })?.id).toBe(
      'm1',
    );
  });

  it('maior `dropWeight` significa mais comum dentro da raridade', () => {
    const heavy = card({ id: 'heavy', rarity: 'COMMON', dropWeight: 300 });
    const light = card({ id: 'light', rarity: 'COMMON', dropWeight: 100 });
    const candidates = [heavy, light];

    // Massa total 400: [0, 0.75) → heavy, [0.75, 1) → light.
    expect(pickCard(candidates, { random: sequence([0, 0]), userLevel: 1, now })?.id).toBe('heavy');
    expect(pickCard(candidates, { random: sequence([0, 0.5]), userLevel: 1, now })?.id).toBe(
      'heavy',
    );
    expect(pickCard(candidates, { random: sequence([0, 0.74]), userLevel: 1, now })?.id).toBe(
      'heavy',
    );
    expect(pickCard(candidates, { random: sequence([0, 0.9]), userLevel: 1, now })?.id).toBe(
      'light',
    );
  });

  it('ignora candidatas inelegíveis antes de sortear', () => {
    const locked = card({ id: 'locked', rarity: 'MYTHIC', levelRequired: 40 });
    const open = card({ id: 'open', rarity: 'COMMON' });

    // Mesmo com número que sortearia a mítica, ela não está no páreo.
    const picked = pickCard([locked, open], { random: sequence([0.995, 0.5]), userLevel: 2, now });
    expect(picked?.id).toBe('open');
  });

  it('devolve null quando nada é elegível', () => {
    expect(
      pickCard([card({ isActive: false })], { random: sequence([0, 0]), userLevel: 1, now }),
    ).toBeNull();
    expect(pickCard([], { random: sequence([0, 0]), userLevel: 1, now })).toBeNull();
  });

  it('nunca entrega carta acima do nível do participante', () => {
    const candidates = [
      card({ id: 'a', rarity: 'COMMON', levelRequired: 5 }),
      card({ id: 'b', rarity: 'RARE', levelRequired: 9 }),
    ];

    for (let i = 0; i <= 50; i += 1) {
      const picked = pickCard(candidates, {
        random: sequence([i / 50, i / 50, i / 50]),
        userLevel: 4,
        now,
      });
      expect(picked).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('foil', () => {
  it('raridade mais alta tem mais chance, mas nunca garantia', () => {
    expect(foilChanceFor('COMMON')).toBeLessThan(foilChanceFor('MYTHIC'));
    for (const rarity of RARITY_ORDER) {
      const chance = foilChanceFor(rarity);
      expect(chance).toBeGreaterThan(0);
      expect(chance).toBeLessThan(1);
      expect(chance).toBeLessThanOrEqual(MAX_FOIL_CHANCE);
    }
  });

  it('decide pelo número sorteado', () => {
    expect(shouldBeFoil('COMMON', 0.0)).toBe(true);
    expect(shouldBeFoil('COMMON', 0.02)).toBe(true);
    expect(shouldBeFoil('COMMON', 0.03)).toBe(false);
    expect(shouldBeFoil('MYTHIC', 0.19)).toBe(true);
    expect(shouldBeFoil('MYTHIC', 0.2)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('paleta e arte', () => {
  it('usa a paleta informada quando válida', () => {
    const palette = resolvePalette(
      { primary: '#ff0000', secondary: '#00ff00', glow: '#0000ff', text: '#ffffff' },
      'COMMON',
    );
    expect(palette).toEqual({
      primary: '#ff0000',
      secondary: '#00ff00',
      glow: '#0000ff',
      text: '#ffffff',
    });
  });

  it('descarta CAMPO inválido sem apagar os demais', () => {
    const palette = resolvePalette(
      { primary: 'vermelho', secondary: '#00ff00', glow: 'url(javascript:1)', text: '#fff' },
      'COMMON',
    );

    expect(palette.primary).toBe(DEFAULT_PALETTES.COMMON.primary);
    expect(palette.secondary).toBe('#00ff00');
    expect(palette.glow).toBe(DEFAULT_PALETTES.COMMON.glow);
    expect(palette.text).toBe('#fff');
  });

  it('cai no padrão da RARIDADE quando não há paleta utilizável', () => {
    expect(resolvePalette(null, 'LEGENDARY')).toEqual(DEFAULT_PALETTES.LEGENDARY);
    expect(resolvePalette({ primary: 'nope' }, 'MYTHIC').primary).toBe(
      DEFAULT_PALETTES.MYTHIC.primary,
    );
  });

  it('aceita oklch()', () => {
    const palette = resolvePalette({ primary: 'oklch(0.7 0.2 250)' }, 'RARE');
    expect(palette.primary).toBe('oklch(0.7 0.2 250)');
  });

  it('RECUSA URL com protocolo perigoso', () => {
    const art = resolveArt({
      imageUrl: 'javascript:alert(1)',
      frameUrl: 'https://cdn.exemplo.test/moldura.png',
      animation: 'shimmer',
    });

    expect(art.imageUrl).toBeNull();
    expect(art.frameUrl).toBe('https://cdn.exemplo.test/moldura.png');
    expect(art.animation).toBe('shimmer');
  });

  it('aplica allowlist de animação e partícula', () => {
    expect(resolveArt({ animation: 'explosao', particle: 'laser' })).toMatchObject({
      animation: 'none',
      particle: 'none',
    });
    expect(resolveArt({ animation: 'float', particle: 'sparkle' })).toMatchObject({
      animation: 'float',
      particle: 'sparkle',
    });
  });

  it('converte a paleta em variáveis CSS', () => {
    const variables = paletteToCssVariables(DEFAULT_PALETTES.EPIC);
    expect(variables['--card-primary']).toBe(DEFAULT_PALETTES.EPIC.primary);
    expect(Object.keys(variables)).toHaveLength(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('summarizeAlbum()', () => {
  function entry(overrides: Partial<AlbumEntry>): AlbumEntry {
    return {
      templateId: Math.random().toString(36).slice(2),
      slug: 'carta',
      name: 'Carta',
      rarity: 'COMMON',
      owned: false,
      isFoil: false,
      quantity: 0,
      level: 1,
      isPinned: false,
      secret: false,
      ...overrides,
    };
  }

  it('conta obtidas sobre o total', () => {
    const summary = summarizeAlbum([
      entry({ owned: true }),
      entry({ owned: true }),
      entry({ owned: false }),
      entry({ owned: false }),
    ]);

    expect(summary.owned).toBe(2);
    expect(summary.total).toBe(4);
    expect(summary.completionRatio).toBe(0.5);
  });

  it('cartas SECRETAS não descobertas ficam fora do denominador', () => {
    // Incluí-las tornaria 100 % inalcançável sem que o participante soubesse o
    // que falta — coleção que não pode ser completada deixa de ser coleção.
    const summary = summarizeAlbum([
      entry({ owned: true }),
      entry({ owned: false, secret: true }),
      entry({ owned: false, secret: true }),
    ]);

    expect(summary.total).toBe(1);
    expect(summary.completionRatio).toBe(1);
  });

  it('carta secreta DESCOBERTA passa a contar', () => {
    const summary = summarizeAlbum([
      entry({ owned: true }),
      entry({ owned: true, secret: true }),
    ]);

    expect(summary.total).toBe(2);
    expect(summary.owned).toBe(2);
  });

  it('agrega por raridade, foils, duplicatas e fixadas', () => {
    const summary = summarizeAlbum([
      entry({ rarity: 'COMMON', owned: true, quantity: 3 }),
      entry({ rarity: 'COMMON', owned: false }),
      entry({ rarity: 'MYTHIC', owned: true, isFoil: true, isPinned: true }),
    ]);

    expect(summary.byRarity.COMMON).toEqual({ owned: 1, total: 2 });
    expect(summary.byRarity.MYTHIC).toEqual({ owned: 1, total: 1 });
    expect(summary.byRarity.RARE).toEqual({ owned: 0, total: 0 });
    expect(summary.foils).toBe(1);
    expect(summary.duplicates).toBe(2);
    expect(summary.pinned).toBe(1);
  });

  it('álbum vazio não divide por zero', () => {
    const summary = summarizeAlbum([]);
    expect(summary.total).toBe(0);
    expect(summary.completionRatio).toBe(0);
    expect(summary.owned).toBe(0);
  });

  it('define o limite de cartas fixadas no perfil', () => {
    expect(MAX_PINNED_CARDS).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('mapeamento de gatilhos', () => {
  it('traduz as origens de XP que têm carta correspondente', () => {
    expect(cardTriggerForSource('CHECKIN')).toBe('CHECKIN');
    expect(cardTriggerForSource('ACTIVITY_ATTENDANCE')).toBe('ACTIVITY_COMPLETION');
    expect(cardTriggerForSource('MINI_COURSE_COMPLETION')).toBe('MINI_COURSE_COMPLETION');
    expect(cardTriggerForSource('SUBMISSION_SUBMITTED')).toBe('SUBMISSION_SUBMITTED');
    expect(cardTriggerForSource('SUBMISSION_ACCEPTED')).toBe('SUBMISSION_ACCEPTED');
    expect(cardTriggerForSource('REVIEW_COMPLETED')).toBe('REVIEW_COMPLETED');
  });

  it('não inventa gatilho para origem sem carta', () => {
    // Ajuste administrativo e bônus NÃO distribuem carta: seriam um caminho para
    // "fabricar" cartas raras sem cumprir gatilho nenhum.
    expect(cardTriggerForSource('ADMIN_ADJUSTMENT')).toBeNull();
    expect(cardTriggerForSource('BONUS')).toBeNull();
    expect(cardTriggerForSource('REFERRAL')).toBeNull();
    expect(cardTriggerForSource('TASK_COMPLETED')).toBeNull();
  });
});
