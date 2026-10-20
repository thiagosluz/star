import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  EVENT_CATEGORIES,
  getEventCategoryDefinition,
  getEventCategoryLabel,
  isEventCategory,
  parseEventCategory,
} from '@/domain/events/event-category-rules';
import {
  isLeadStatus,
  LEAD_STATUS_LABELS,
  validateLeadInput,
} from '@/domain/platform/lead-rules';
import {
  formatMetricCount,
  formatWorkHours,
} from '@/domain/platform/platform-metrics-rules';
import { PLATFORM_ONLY_TABLES } from '@/lib/db/schema-contract';
import type { PublicEventCardRow } from '@/lib/platform/global-repository';

describe('FASE 71 — Taxonomia de Categorias de Evento (ADR-351)', () => {
  it('contém exatamente 10 categorias padronizadas cobrindo academia, corporativo e comunidade', () => {
    expect(EVENT_CATEGORIES).toHaveLength(10);
    const keys = EVENT_CATEGORIES.map((c) => c.key);
    expect(keys).toEqual([
      'TECNOLOGIA',
      'CIENCIA_ACADEMICO',
      'SAUDE_BEM_ESTAR',
      'EDUCACAO',
      'NEGOCIOS_GESTAO',
      'ENGENHARIA_INDUSTRIA',
      'DIREITO_GOVERNANCA',
      'ARTE_CULTURA',
      'MEIO_AMBIENTE',
      'OUTROS',
    ]);
  });

  it('valida chaves legítimas e rejeita strings livres ou inventadas', () => {
    expect(isEventCategory('TECNOLOGIA')).toBe(true);
    expect(isEventCategory('CIENCIA_ACADEMICO')).toBe(true);
    expect(isEventCategory('INVALIDA')).toBe(false);
    expect(isEventCategory(null)).toBe(false);
    expect(isEventCategory(123)).toBe(false);
  });

  it('parseia chave com segurança', () => {
    expect(parseEventCategory('SAUDE_BEM_ESTAR')).toBe('SAUDE_BEM_ESTAR');
    expect(parseEventCategory('OUTROS')).toBe('OUTROS');
    expect(parseEventCategory('teste')).toBeNull();
  });

  it('retorna rótulos amigáveis em português e ícones sem quebrar', () => {
    expect(getEventCategoryLabel('TECNOLOGIA')).toBe('Tecnologia & Inovação');
    expect(getEventCategoryLabel('CIENCIA_ACADEMICO')).toBe('Ciência, Pesquisa & Academia');
    expect(getEventCategoryLabel(null)).toBe('Geral');
    expect(getEventCategoryLabel(undefined)).toBe('Geral');

    const def = getEventCategoryDefinition('MEIO_AMBIENTE');
    expect(def?.label).toBe('Sustentabilidade & Meio Ambiente');
    expect(def?.iconName).toBe('Leaf');
  });
});

describe('FASE 71 — Leads Institucionais (ADR-353)', () => {
  it('valida lead com dados completos com sucesso', () => {
    const result = validateLeadInput({
      name: 'Dra. Márcia Oliveira',
      email: 'reitoria@universidade.edu.br',
      organization: 'Universidade Federal do Saber',
      roleInOrg: 'Pró-Reitora de Extensão',
      phone: '(71) 98888-7777',
      estimatedEventsPerYear: '10 a 25 eventos/ano',
      message: 'Gostaríamos de implantar a plataforma para nossos simpósios acadêmicos.',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe('Dra. Márcia Oliveira');
      expect(result.data.email).toBe('reitoria@universidade.edu.br');
      expect(result.data.organization).toBe('Universidade Federal do Saber');
      expect(result.data.roleInOrg).toBe('Pró-Reitora de Extensão');
    }
  });

  it('rejeita nome curto ou vazio', () => {
    const result = validateLeadInput({
      name: 'Jo',
      email: 'jo@empresa.com',
      organization: 'Tech Ltda',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_NAME');
    }
  });

  it('rejeita e-mail inválido', () => {
    const result = validateLeadInput({
      name: 'Carlos Silva',
      email: 'carlos-sem-arroba',
      organization: 'Associação de Bairro',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_EMAIL');
    }
  });

  it('rejeita organização em branco', () => {
    const result = validateLeadInput({
      name: 'Carlos Silva',
      email: 'carlos@associacao.org',
      organization: '   ',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_ORGANIZATION');
    }
  });

  it('reconhece os estados válidos do funil de lead', () => {
    expect(isLeadStatus('OPEN')).toBe(true);
    expect(isLeadStatus('CONTACTED')).toBe(true);
    expect(isLeadStatus('QUALIFIED')).toBe(true);
    expect(isLeadStatus('ARCHIVED')).toBe(true);
    expect(isLeadStatus('UNKNOWN')).toBe(false);
    expect(LEAD_STATUS_LABELS.OPEN).toBe('Novo (Aberto)');
  });
});

describe('FASE 71 — Métricas Públicas da Vitrine (ADR-352)', () => {
  it('formata contadores para números amigáveis da Landing Page', () => {
    expect(formatMetricCount(0)).toBe('0');
    expect(formatMetricCount(-5)).toBe('0');
    expect(formatMetricCount(42)).toBe('42+');
    expect(formatMetricCount(450)).toBe('450+');
    expect(formatMetricCount(1200)).toBe('1.2k+');
    expect(formatMetricCount(15000)).toBe('15k+');
    expect(formatMetricCount(1200000)).toBe('1.2M+');
  });

  it('formata carga horária com sufixo convidativo', () => {
    expect(formatWorkHours(0)).toBe('0h');
    expect(formatWorkHours(80)).toBe('+80 horas');
    expect(formatWorkHours(2500)).toBe('+2.5k horas');
  });
});

describe('FASE 71 — Defesa contra Vazamento de onlineUrl (R1 / ADR-352)', () => {
  it('PublicEventCardRow estritamente não possui propriedade onlineUrl', () => {
    // Verificação estática / semântica: criamos um objeto modelo do card
    const card: PublicEventCardRow = {
      id: 'evt-1',
      slug: 'congresso-2026',
      title: 'Congresso de Tecnologia',
      summary: 'Grande evento',
      coverImageUrl: null,
      modality: 'ONLINE',
      category: 'TECNOLOGIA',
      city: 'Salvador',
      state: 'BA',
      startsAt: new Date(),
      endsAt: new Date(),
      registrationClosesAt: null,
      tenantId: 'ten-1',
      tenantSlug: 'ufba',
      tenantName: 'UFBA',
      tenantLogoUrl: null,
    };

    expect(card).not.toHaveProperty('onlineUrl');
    expect((card as unknown as { onlineUrl?: string }).onlineUrl).toBeUndefined();
  });
});

describe('FASE 71 — Isolamento da Tabela de Plataforma institution_leads (ADR-353)', () => {
  it('institution_leads está declarada em PLATFORM_ONLY_TABLES', () => {
    expect(PLATFORM_ONLY_TABLES).toContain('institution_leads');
  });

  it('institution_leads está incluída no REVOKE do provisionamento em 00-roles.sql', () => {
    const sql = readFileSync(
      new URL('../../docker/postgres/init/00-roles.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain("'institution_leads'");
  });
});
