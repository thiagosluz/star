/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — PATROCÍNIO (FASE 17, item E5)
 *
 *  Três regras que não são de formulário e por isso vivem no domínio:
 *    • o limite de vagas da cota (é cláusula comercial, não preferência de layout);
 *    • a ordem de exibição (Diamante antes de Ouro — é o que o patrocinador comprou);
 *    • a máscara do documento fiscal (o CNPJ não circula inteiro na tela).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  CONTRACT_STATE_LABELS,
  DEFAULT_SPONSOR_LOGO_SCALE,
  MAX_TIER_BENEFITS,
  SPONSOR_LOGO_HEIGHT_PX,
  SPONSOR_LOGO_MAX_WIDTH_PX,
  SPONSOR_LOGO_SCALES,
  SPONSOR_LOGO_SCALE_LABELS,
  SPONSOR_TIER_BORDER_PERCENT,
  SPONSOR_TIER_COLOR_SUGGESTIONS,
  SPONSOR_TIER_DEFAULT_RANK,
  SPONSOR_TIER_KEYS,
  SPONSOR_TIER_LABELS,
  SPONSOR_TIER_TINT_PERCENT,
  evaluateContractState,
  evaluateTierCapacity,
  maskTaxId,
  nextSlugCandidate,
  parseBenefits,
  parseSponsorLogoScale,
  slugifySponsorName,
  sortSponsorsForDisplay,
  sponsorInputSchema,
  sponsorTierTint,
  tierInputSchema,
} from '../../src/domain/events/sponsor-rules';

// ═══════════════════════════════════════════════════════════════════════════════
describe('catálogo de cotas', () => {
  it('toda cota tem rótulo e ordem sugerida', () => {
    for (const key of SPONSOR_TIER_KEYS) {
      expect(SPONSOR_TIER_LABELS[key], `sem rótulo: ${key}`).toBeTruthy();
      expect(typeof SPONSOR_TIER_DEFAULT_RANK[key]).toBe('number');
    }
  });

  it('a ordem sugerida coloca Diamante antes de Ouro antes de Prata', () => {
    expect(SPONSOR_TIER_DEFAULT_RANK.DIAMOND).toBeLessThan(SPONSOR_TIER_DEFAULT_RANK.GOLD);
    expect(SPONSOR_TIER_DEFAULT_RANK.GOLD).toBeLessThan(SPONSOR_TIER_DEFAULT_RANK.SILVER);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('tierInputSchema', () => {
  const base = { name: 'Ouro', key: 'GOLD' as const };

  it('aplica padrões (moeda, ordem, vagas ilimitadas)', () => {
    const parsed = tierInputSchema.parse(base);
    expect(parsed.currency).toBe('BRL');
    expect(parsed.maxSponsors).toBe(0);
    expect(parsed.benefits).toEqual([]);
  });

  it('normaliza a moeda para maiúsculas e exige 3 letras', () => {
    expect(tierInputSchema.parse({ ...base, currency: 'brl' }).currency).toBe('BRL');
    expect(tierInputSchema.safeParse({ ...base, currency: 'R$' }).success).toBe(false);
  });

  it('recusa nome curto demais e valor negativo', () => {
    expect(tierInputSchema.safeParse({ ...base, name: 'Ok' }).success).toBe(false);
    expect(tierInputSchema.safeParse({ ...base, priceCents: -1 }).success).toBe(false);
  });

  it('recusa cor fora da allowlist (a mesma do tema)', () => {
    expect(tierInputSchema.safeParse({ ...base, color: 'red' }).success).toBe(false);
    expect(tierInputSchema.safeParse({ ...base, color: '#f59e0b' }).success).toBe(true);
  });

  it('limita a quantidade de benefícios', () => {
    const many = Array.from({ length: MAX_TIER_BENEFITS + 1 }, (_, i) => `Benefício ${i}`);
    expect(tierInputSchema.safeParse({ ...base, benefits: many }).success).toBe(false);
  });

  it('aceita `maxSponsors = 0` como ILIMITADO, não como "nenhuma vaga"', () => {
    expect(tierInputSchema.parse({ ...base, maxSponsors: 0 }).maxSponsors).toBe(0);
    expect(evaluateTierCapacity({ maxSponsors: 0, currentCount: 99 }).allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evaluateTierCapacity()', () => {
  it('cota ilimitada não tem teto nem vagas restantes', () => {
    expect(evaluateTierCapacity({ maxSponsors: 0, currentCount: 42 })).toEqual({
      allowed: true,
      remaining: null,
    });
  });

  it('conta as vagas restantes', () => {
    expect(evaluateTierCapacity({ maxSponsors: 3, currentCount: 1 })).toEqual({
      allowed: true,
      remaining: 1,
    });
  });

  it('recusa quando a cota está completa, com mensagem que explica o limite', () => {
    const result = evaluateTierCapacity({ maxSponsors: 1, currentCount: 1 });
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('1');
  });

  it('na EDIÇÃO, o próprio patrocinador não ocupa vaga contra ele mesmo', () => {
    /**
     * Sem `excluding`, salvar um patrocinador já existente numa cota cheia seria
     * recusado — e o organizador não entenderia por que não consegue corrigir o
     * telefone de alguém que já está lá.
     */
    expect(
      evaluateTierCapacity({ maxSponsors: 2, currentCount: 2, excluding: 1 }).allowed,
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('slug do patrocinador', () => {
  it('gera identificador a partir do nome, sem acento', () => {
    expect(slugifySponsorName('Instituto de Tecnologia Aberta')).toBe(
      'instituto-de-tecnologia-aberta',
    );
    expect(slugifySponsorName('Editora Ciência Viva')).toBe('editora-ciencia-viva');
    expect(slugifySponsorName('  ACME   S/A  ')).toBe('acme-s-a');
  });

  it('nunca devolve vazio', () => {
    expect(slugifySponsorName('***')).toBe('patrocinador');
    expect(slugifySponsorName('')).toBe('patrocinador');
  });

  it('sufixa candidatos repetidos sem estourar o limite da coluna', () => {
    expect(nextSlugCandidate('acme', 1)).toBe('acme');
    expect(nextSlugCandidate('acme', 2)).toBe('acme-2');
    expect(nextSlugCandidate('a'.repeat(200), 3).length).toBeLessThanOrEqual(120);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('máscara do documento fiscal', () => {
  it('mascara CNPJ preservando o suficiente para conferência', () => {
    expect(maskTaxId('12345678000199')).toBe('12.345.678/****-99');
  });

  it('mascara CPF', () => {
    expect(maskTaxId('12345678901')).toBe('123.***.***-01');
  });

  it('aceita documento já formatado e devolve máscara', () => {
    expect(maskTaxId('12.345.678/0001-99')).toBe('12.345.678/****-99');
  });

  it('não vaza nada quando o formato é desconhecido', () => {
    expect(maskTaxId('123')).toBe('****');
    expect(maskTaxId(null)).toBeNull();
    expect(maskTaxId(undefined)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('sortSponsorsForDisplay()', () => {
  const sponsors = [
    { id: '3', name: 'Zeta', displayOrder: 0, tierRank: 20 },
    { id: '1', name: 'Alfa', displayOrder: 0, tierRank: 0 },
    { id: '2', name: 'Beta', displayOrder: 1, tierRank: 0 },
    { id: '4', name: 'Sem cota', displayOrder: 0, tierRank: null },
  ];

  it('ordena por rank da cota, depois ordem, depois nome', () => {
    expect(sortSponsorsForDisplay(sponsors).map((s) => s.id)).toEqual(['1', '2', '3', '4']);
  });

  it('quem não tem cota vai para o FIM (o patrocínio existe e foi pago)', () => {
    const sorted = sortSponsorsForDisplay(sponsors);
    expect(sorted.at(-1)?.name).toBe('Sem cota');
  });

  it('é estável: dois do mesmo rank e mesma ordem saem em ordem alfabética', () => {
    const tied = [
      { id: 'b', name: 'Bom', displayOrder: 0, tierRank: 0 },
      { id: 'a', name: 'Ágil', displayOrder: 0, tierRank: 0 },
    ];
    expect(sortSponsorsForDisplay(tied).map((s) => s.name)).toEqual(['Ágil', 'Bom']);
  });

  it('não muta a lista recebida', () => {
    const original = [...sponsors];
    sortSponsorsForDisplay(sponsors);
    expect(sponsors).toEqual(original);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('evaluateContractState()', () => {
  const now = new Date('2026-09-17T12:00:00.000Z');

  it('sem vigência informada, o estado é desconhecido (e não "vencido")', () => {
    expect(evaluateContractState({ now })).toBe('UNKNOWN');
    expect(CONTRACT_STATE_LABELS.UNKNOWN).toContain('Sem vigência');
  });

  it('reconhece contrato vigente, a iniciar e encerrado', () => {
    expect(
      evaluateContractState({
        contractStart: new Date('2026-01-01T00:00:00.000Z'),
        contractEnd: new Date('2026-12-31T00:00:00.000Z'),
        now,
      }),
    ).toBe('ACTIVE');

    expect(
      evaluateContractState({ contractStart: new Date('2026-10-01T00:00:00.000Z'), now }),
    ).toBe('SCHEDULED');

    expect(
      evaluateContractState({ contractEnd: new Date('2026-08-01T00:00:00.000Z'), now }),
    ).toBe('EXPIRED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('sponsorInputSchema e parseBenefits()', () => {
  it('exige nome e aceita o resto vazio', () => {
    const parsed = sponsorInputSchema.safeParse({ name: 'Instituto Parceiro' });
    expect(parsed.success).toBe(true);
  });

  it('recusa site que não seja http(s)', () => {
    expect(sponsorInputSchema.safeParse({ name: 'ACME', websiteUrl: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(
      sponsorInputSchema.safeParse({ name: 'ACME', websiteUrl: 'https://acme.test' }).success,
    ).toBe(true);
  });

  it('recusa e-mail de contato inválido', () => {
    expect(sponsorInputSchema.safeParse({ name: 'ACME', contactEmail: 'nao-e-email' }).success).toBe(
      false,
    );
  });

  it('converte texto multilinha em lista, aceitando marcadores', () => {
    expect(
      parseBenefits('Logo no site\n- Estande de 9 m²\n* Palestra de 10 min\n\n• Duas cortesias'),
    ).toEqual(['Logo no site', 'Estande de 9 m²', 'Palestra de 10 min', 'Duas cortesias']);
  });

  it('devolve lista vazia para entrada ausente', () => {
    expect(parseBenefits(null)).toEqual([]);
    expect(parseBenefits('')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('vitrine da cota — cor e tamanho da logo (FASE 41)', () => {
  it('todo degrau tem rótulo, altura e largura máxima — e a escala é CRESCENTE', () => {
    let previousHeight = 0;

    for (const scale of SPONSOR_LOGO_SCALES) {
      expect(SPONSOR_LOGO_SCALE_LABELS[scale], `sem rótulo: ${scale}`).toBeTruthy();
      expect(SPONSOR_LOGO_HEIGHT_PX[scale]).toBeGreaterThan(previousHeight);
      expect(SPONSOR_LOGO_MAX_WIDTH_PX[scale]).toBeGreaterThan(0);

      previousHeight = SPONSOR_LOGO_HEIGHT_PX[scale];
    }
  });

  it('a logo nunca é mais alta que a largura máxima permitida (senão vira faixa)', () => {
    for (const scale of SPONSOR_LOGO_SCALES) {
      expect(SPONSOR_LOGO_MAX_WIDTH_PX[scale]).toBeGreaterThan(SPONSOR_LOGO_HEIGHT_PX[scale]);
    }
  });

  it('valor desconhecido no banco cai no degrau padrão, sem quebrar o desenho', () => {
    expect(parseSponsorLogoScale('ENORME')).toBe(DEFAULT_SPONSOR_LOGO_SCALE);
    expect(parseSponsorLogoScale(null)).toBe(DEFAULT_SPONSOR_LOGO_SCALE);
    expect(parseSponsorLogoScale(undefined)).toBe(DEFAULT_SPONSOR_LOGO_SCALE);
    expect(parseSponsorLogoScale('FEATURE')).toBe('FEATURE');
  });

  it('a cota sem cor devolve cartão NEUTRO — não escolher cor é resposta legítima', () => {
    expect(sponsorTierTint(null)).toBeNull();
    expect(sponsorTierTint('')).toBeNull();
    expect(sponsorTierTint('   ')).toBeNull();
  });

  it('a cor vira tom suave com a cor CHEIA só no destaque', () => {
    const tint = sponsorTierTint('#b45309');

    expect(tint).not.toBeNull();
    expect(tint!.accent).toBe('#b45309');

    /**
     * O fundo é sempre um TOM (a força está no domínio, em porcentagem), e a cor
     * cheia só aparece no marcador: cor cheia atrás de texto é ilegível.
     */
    expect(tint!.surface).toContain('color-mix');
    expect(tint!.surface).toContain('#b45309');
    expect(tint!.surface).toContain(`${SPONSOR_TIER_TINT_PERCENT}%`);
    expect(tint!.surface).not.toBe('#b45309');
    expect(tint!.border).toContain('color-mix');
    expect(tint!.border).toContain(`${SPONSOR_TIER_BORDER_PERCENT}%`);
    expect(SPONSOR_TIER_BORDER_PERCENT).toBeGreaterThan(SPONSOR_TIER_TINT_PERCENT);
  });

  it('aceita oklch() (o formato que a tela anuncia) e mistura do mesmo jeito', () => {
    const tint = sponsorTierTint('oklch(0.62 0.19 259)');

    expect(tint?.accent).toBe('oklch(0.62 0.19 259)');
    expect(tint?.surface).toContain('oklch(0.62 0.19 259)');
  });

  it('RECUSA o que não é cor — a cor entra num style inline, e o contexto não pode ser escapado', () => {
    for (const invalid of [
      'red',
      'rgb(1,2,3)',
      '#12345',
      '#b45309; background: url(https://x.test/a.png)',
      'oklch(0.62 0.19 259); color: red',
    ]) {
      expect(sponsorTierTint(invalid), `deveria recusar: ${invalid}`).toBeNull();
    }
  });

  it('as cores sugeridas são válidas para o MESMO validador que o serviço usa', () => {
    for (const suggestion of SPONSOR_TIER_COLOR_SUGGESTIONS) {
      expect(sponsorTierTint(suggestion.value), `sugestão inválida: ${suggestion.label}`).not.toBeNull();
    }
  });

  it('a cota nasce com o degrau padrão e recusa degrau que não existe', () => {
    const base = { name: 'Cota Ouro' };

    expect(tierInputSchema.parse(base).logoScale).toBe(DEFAULT_SPONSOR_LOGO_SCALE);
    expect(tierInputSchema.parse({ ...base, logoScale: 'FEATURE' }).logoScale).toBe('FEATURE');
    expect(tierInputSchema.safeParse({ ...base, logoScale: 'GIGANTE' }).success).toBe(false);
  });

  it('a cota aceita a cor em hexadecimal E em oklch(), e recusa o resto', () => {
    expect(tierInputSchema.safeParse({ name: 'Cota Ouro', color: '#b45309' }).success).toBe(true);
    expect(tierInputSchema.safeParse({ name: 'Cota Ouro', color: 'oklch(0.62 0.19 259)' }).success).toBe(true);
    expect(tierInputSchema.safeParse({ name: 'Cota Ouro', color: 'dourado' }).success).toBe(false);
  });
});
