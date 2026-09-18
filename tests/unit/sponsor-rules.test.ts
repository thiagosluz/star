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
  MAX_TIER_BENEFITS,
  SPONSOR_TIER_DEFAULT_RANK,
  SPONSOR_TIER_KEYS,
  SPONSOR_TIER_LABELS,
  evaluateContractState,
  evaluateTierCapacity,
  maskTaxId,
  nextSlugCandidate,
  parseBenefits,
  slugifySponsorName,
  sortSponsorsForDisplay,
  sponsorInputSchema,
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
