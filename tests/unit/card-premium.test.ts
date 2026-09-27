/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — apresentação premium da carta e compartilhamento (FASE 48)
 *
 *  Duas famílias de regra, ambas puras:
 *   • a GEOMETRIA do palco 3D (`resolveCardStage`, `tiltFromPointer`) — o mesmo
 *     cálculo que o navegador usa, preso aqui para não depender de olhar a tela;
 *   • o TEXTO e o ENDEREÇO do compartilhamento (`shareTextFor`, `shareIntent`,
 *     `cardShareUrl`) — onde o risco não é estético, é vazamento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SHEEN,
  DEFAULT_TILT,
  resolveArt,
  type CardArt,
} from '../../src/domain/gamification/card-rules';
import {
  FOIL_SHEEN_BONUS,
  MAX_TILT_DEGREES,
  MIN_TILT_DEGREES,
  NEUTRAL_TILT,
  cardBackContent,
  formatCardDate,
  resolveCardStage,
  tiltFromPointer,
} from '../../src/domain/gamification/card-presentation';
import {
  SHARE_CHANNELS,
  cardShareUrl,
  isValidShareToken,
  normalizeShareToken,
  shareIntent,
  shareTextFor,
} from '../../src/domain/gamification/card-share-rules';

/** Arte completa: o que `resolveArt` devolveria para um JSON vazio. */
function art(overrides: Partial<CardArt> = {}): CardArt {
  return {
    imageUrl: null,
    frameUrl: null,
    animation: 'none',
    particle: 'none',
    foil: false,
    holo: false,
    sheen: DEFAULT_SHEEN,
    tilt: DEFAULT_TILT,
    backUrl: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('arte da carta — os campos da apresentação premium', () => {
  it('carta SEM os campos novos continua exatamente como era', () => {
    const legacy = resolveArt({ imageUrl: 'https://exemplo.test/arte.png', foil: true });

    expect(legacy.imageUrl).toBe('https://exemplo.test/arte.png');
    expect(legacy.foil).toBe(true);
    expect(legacy.holo).toBe(false);
    expect(legacy.sheen).toBe(DEFAULT_SHEEN);
    expect(legacy.tilt).toBe(DEFAULT_TILT);
    expect(legacy.backUrl).toBeNull();
  });

  it('percentual fora de 0–100 é DESCARTADO, não recortado', () => {
    const out = resolveArt({ sheen: 900, tilt: -10 });

    expect(out.sheen).toBe(DEFAULT_SHEEN);
    expect(out.tilt).toBe(DEFAULT_TILT);
  });

  it('percentual não inteiro é descartado (o cadastro declara inteiro)', () => {
    expect(resolveArt({ sheen: 62.5 }).sheen).toBe(DEFAULT_SHEEN);
    expect(resolveArt({ sheen: 62 }).sheen).toBe(62);
  });

  it('um campo inválido não derruba os outros — o bom é preservado', () => {
    const out = resolveArt({ holo: true, sheen: 'muito', tilt: 80, backUrl: 'javascript:alert(1)' });

    expect(out.holo).toBe(true);
    expect(out.sheen).toBe(DEFAULT_SHEEN);
    expect(out.tilt).toBe(80);
    // Protocolo fora de http(s) nunca vira `src` nem fundo.
    expect(out.backUrl).toBeNull();
  });

  it('a arte do verso passa pela MESMA allowlist da frente', () => {
    expect(resolveArt({ backUrl: 'https://exemplo.test/verso.png' }).backUrl).toBe(
      'https://exemplo.test/verso.png',
    );
    expect(resolveArt({ backUrl: 'ftp://exemplo.test/verso.png' }).backUrl).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('palco da carta — o que aparece em cada carta', () => {
  it('sem declaração e sem foil, o efeito está DESLIGADO', () => {
    const stage = resolveCardStage({ art: art({ tilt: 100 }), isFoil: false, rarity: 'MYTHIC' });

    expect(stage.holo).toBe(false);
    expect(stage.sheen).toBe(0);
    // O palco 3D continua existindo: o que está desligado é o BRILHO holográfico.
    expect(stage.maxTiltDegrees).toBe(MAX_TILT_DEGREES);
  });

  it('a variante FOIL liga o brilho sozinha e soma o bônus', () => {
    const stage = resolveCardStage({ art: art({ sheen: 40 }), isFoil: true, rarity: 'RARE' });

    expect(stage.holo).toBe(true);
    expect(stage.sheen).toBe(40 + FOIL_SHEEN_BONUS);
  });

  it('o brilho do foil não passa de 100', () => {
    const stage = resolveCardStage({ art: art({ sheen: 95 }), isFoil: true, rarity: 'RARE' });
    expect(stage.sheen).toBe(100);
  });

  it('a raridade NÃO mexe na intensidade (a instituição é quem decide)', () => {
    const common = resolveCardStage({ art: art({ holo: true, sheen: 30 }), isFoil: false, rarity: 'COMMON' });
    const mythic = resolveCardStage({ art: art({ holo: true, sheen: 30 }), isFoil: false, rarity: 'MYTHIC' });

    expect(common.sheen).toBe(mythic.sheen);
    expect(common.maxTiltDegrees).toBe(mythic.maxTiltDegrees);
  });

  it('tilt 0 para o palco (e não devolve um ângulo imperceptível)', () => {
    expect(resolveCardStage({ art: art({ tilt: 0 }), isFoil: false, rarity: 'COMMON' }).maxTiltDegrees).toBe(0);
  });

  it('a intensidade da inclinação cresce entre o piso e o teto', () => {
    const low = resolveCardStage({ art: art({ tilt: 1 }), isFoil: false, rarity: 'COMMON' });
    const high = resolveCardStage({ art: art({ tilt: 100 }), isFoil: false, rarity: 'COMMON' });

    expect(low.maxTiltDegrees).toBe(MIN_TILT_DEGREES);
    expect(high.maxTiltDegrees).toBe(MAX_TILT_DEGREES);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('tiltFromPointer — a geometria do movimento', () => {
  const box = { width: 400, height: 600, maxTiltDegrees: 20 };

  it('o centro deixa a carta parada e o brilho no meio', () => {
    const tilt = tiltFromPointer({ ...box, x: 200, y: 300 });

    expect(tilt).toEqual({ rotateX: 0, rotateY: 0, glareX: 50, glareY: 50 });
  });

  it('o lado sob o ponteiro RECUA (direita e topo)', () => {
    const right = tiltFromPointer({ ...box, x: 400, y: 300 });
    const top = tiltFromPointer({ ...box, x: 200, y: 0 });

    expect(right.rotateY).toBe(20);
    expect(right.rotateX).toBe(0);
    expect(top.rotateX).toBe(20);
    expect(top.rotateY).toBe(0);
  });

  it('as bordas opostas giram para o outro lado', () => {
    expect(tiltFromPointer({ ...box, x: 0, y: 300 }).rotateY).toBe(-20);
    expect(tiltFromPointer({ ...box, x: 200, y: 600 }).rotateX).toBe(-20);
  });

  it('o brilho acompanha o ponteiro em porcentagem da caixa', () => {
    const tilt = tiltFromPointer({ ...box, x: 100, y: 150 });

    expect(tilt.glareX).toBe(25);
    expect(tilt.glareY).toBe(25);
    expect(tilt.rotateY).toBe(-10);
    expect(tilt.rotateX).toBe(10);
  });

  it('ponteiro FORA da caixa é preso à borda (nada de giro infinito)', () => {
    const far = tiltFromPointer({ ...box, x: 9999, y: -9999 });

    expect(far.rotateY).toBe(20);
    expect(far.rotateX).toBe(20);
    expect(far.glareX).toBe(100);
    expect(far.glareY).toBe(0);
  });

  it('caixa sem medida devolve a carta PARADA (e nunca NaN)', () => {
    for (const bad of [
      { width: 0, height: 600 },
      { width: 400, height: 0 },
      { width: Number.NaN, height: 600 },
    ]) {
      const tilt = tiltFromPointer({ ...box, ...bad, x: 10, y: 10 });
      expect(tilt).toEqual(NEUTRAL_TILT);
    }
  });

  it('ponteiro não numérico não contamina o resultado', () => {
    expect(tiltFromPointer({ ...box, x: Number.NaN, y: 300 })).toEqual(NEUTRAL_TILT);
  });

  it('palco sem inclinação declarada não gira', () => {
    expect(tiltFromPointer({ ...box, maxTiltDegrees: 0, x: 400, y: 0 })).toEqual(NEUTRAL_TILT);
  });

  it('o ângulo é arredondado a duas casas (o CSS não precisa de mais)', () => {
    const tilt = tiltFromPointer({ width: 3, height: 3, maxTiltDegrees: 20, x: 1, y: 1 });

    expect(tilt.rotateY).toBe(-6.67);
    expect(tilt.rotateX).toBe(6.67);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('cardBackContent — o verso é a ficha da conquista', () => {
  const base = {
    rarity: 'LEGENDARY' as const,
    trigger: 'REVIEW_COMPLETED',
    description: 'Concedida por concluir um parecer.',
    lore: 'O trabalho invisível que sustenta a ciência',
    quantity: 1,
    isFoil: false,
    level: 1,
    grantedAt: new Date('2026-03-12T15:00:00Z'),
    timezone: 'America/Bahia',
  };

  it('traz os fatos da conquista, com os rótulos do domínio', () => {
    const back = cardBackContent(base);

    expect(back.rarityLabel).toBe('Lendária');
    expect(back.triggerLabel).toBe('Você concluiu um parecer');
    expect(back.lines.map((line) => line.key)).toEqual(['trigger', 'granted', 'variant', 'level', 'description']);
    expect(back.lines.find((line) => line.key === 'variant')?.value).toBe('Padrão');
  });

  it('a data sai no fuso da INSTITUIÇÃO', () => {
    // 15:00 UTC é 12:00 em Salvador — o mesmo dia. Às 02:00 UTC seria o dia anterior.
    const back = cardBackContent(base);

    expect(back.lines.find((line) => line.key === 'granted')?.value).toBe('12/03/2026');
  });

  it('carta sem carimbo de data diz "—", e não uma data inventada', () => {
    const back = cardBackContent({ ...base, grantedAt: null });

    expect(back.lines.find((line) => line.key === 'granted')?.value).toBe('—');
  });

  it('cópias só aparecem quando existem (a duplicata é o que se mostra)', () => {
    expect(cardBackContent(base).lines.some((line) => line.key === 'copies')).toBe(false);

    const duplicated = cardBackContent({ ...base, quantity: 3 });
    expect(duplicated.lines.find((line) => line.key === 'copies')?.value).toBe('3 (2 duplicata(s))');
  });

  it('a variante holográfica é declarada no verso', () => {
    const back = cardBackContent({ ...base, isFoil: true });
    expect(back.lines.find((line) => line.key === 'variant')?.value).toBe('Holográfica (foil)');
  });

  it('gatilho desconhecido não vira texto vazio', () => {
    expect(cardBackContent({ ...base, trigger: 'INVENTADO' }).triggerLabel).toBe('Conquista desbloqueada');
  });

  it('a lore sai separada das linhas (é narrativa, não fato)', () => {
    const back = cardBackContent(base);

    expect(back.lore).toContain('sustenta a ciência');
    expect(back.lines.some((line) => line.value.includes('sustenta a ciência'))).toBe(false);
  });
});

describe('formatCardDate', () => {
  it('fuso inválido no banco não derruba a tela (cai em UTC)', () => {
    expect(formatCardDate(new Date('2026-03-12T15:00:00Z'), 'Fuso/Inventado')).toBe('12/03/2026');
  });

  it('data inválida é ausência declarada', () => {
    expect(formatCardDate(new Date('nada'), 'America/Bahia')).toBe('—');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('compartilhamento — texto e endereço', () => {
  const text = shareTextFor({
    cardName: 'Guardião do Método',
    rarity: 'LEGENDARY',
    tenantName: 'Universidade Federal da Bahia',
    displayName: 'Ana Souza',
  });

  it('o texto leva nome, carta, raridade e instituição — e nada mais', () => {
    expect(text).toBe(
      'Ana Souza conquistou a carta Guardião do Método (Lendária) em Universidade Federal da Bahia.',
    );
    expect(text).not.toMatch(/@|XP|nível|e-mail/i);
  });

  it('o endereço é do tipo /t/<slug>/carta/<token> e não carrega id nenhum', () => {
    const url = cardShareUrl({ baseUrl: 'https://eventflow.test/', tenantSlug: 'ufba', token: 'abc123' });
    expect(url).toBe('https://eventflow.test/t/ufba/carta/abc123');
  });

  it('TODO canal monta uma intenção com texto e link codificados', () => {
    const payload = { url: 'https://eventflow.test/t/ufba/carta/abc123', text };

    for (const channel of SHARE_CHANNELS) {
      const intent = shareIntent(channel, payload);
      expect(intent.startsWith('https://') || intent.startsWith('mailto:')).toBe(true);
      expect(intent).toContain(encodeURIComponent(payload.url));
    }

    // O LinkedIn ignora texto pré-preenchido: prometer o texto ali seria mentir.
    expect(shareIntent('linkedin', payload)).not.toContain(encodeURIComponent(text));
    expect(shareIntent('email', payload).startsWith('mailto:?subject=')).toBe(true);
  });

  it('o token aceito é o que o serviço gera (base64url) e nada além', () => {
    expect(isValidShareToken('AbC123_-xyzABC123_-xyz')).toBe(true);
    expect(normalizeShareToken('  AbC123_-xyzABC123_-xyz\n')).toBe('AbC123_-xyzABC123_-xyz');
    expect(isValidShareToken('curto')).toBe(false);
    expect(isValidShareToken('com espaço e barra/assim')).toBe(false);
    expect(isValidShareToken('a'.repeat(65))).toBe(false);
  });
});
