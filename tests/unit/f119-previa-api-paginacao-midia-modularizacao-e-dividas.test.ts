import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { buildEventApiPreviews } from '@/lib/api/event-api-organizer-preview';
import { API_RESOURCES } from '@/domain/api/public-api-contract';
import type { PublicEventDetail } from '@/lib/events/event-repository';
import {
  MEDIA_LIBRARY_LIMIT,
  buildMediaPageHref,
  computeMediaPagination,
  parseMediaPage,
} from '@/domain/events/media-filter-rules';

const ROOT = process.cwd();

function readText(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

function makeFakePublicEventDetail(now: Date): PublicEventDetail {
  return {
    id: '00000000-0000-4000-8000-000000000100',
    slug: 'evento-demo',
    title: 'Evento Demo',
    subtitle: null,
    summary: 'Resumo',
    description: null,
    status: 'REGISTRATION_OPEN',
    modality: 'IN_PERSON',
    startsAt: new Date(now.getTime() + 86_400_000),
    endsAt: new Date(now.getTime() + 172_800_000),
    timezone: 'America/Bahia',
    venueName: 'Auditório Principal',
    venueAddress: null,
    city: 'Salvador',
    state: 'BA',
    country: 'Brasil',
    coverImageUrl: null,
    logoUrl: null,
    primaryColor: null,
    theme: {
      preset: 'clean',
      primaryColor: '#1d4ed8',
      accentColor: '#0f172a',
      backgroundColor: '#ffffff',
      surfaceColor: '#f8fafc',
      textColor: '#0f172a',
      mutedTextColor: '#475569',
      fontHeading: 'plus-jakarta',
      fontBody: 'inter',
      radius: 'md',
      density: 'comfortable',
      headerStyle: 'clean',
      animationStyle: 'subtle',
      darkMode: false,
    },
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity: 100,
    remainingSeats: 90,
    activityCount: 0,
    usesCall: false,
    registrationRequiresMembership: false,
    onlineUrl: null,
    activities: [],
    speakers: [],
    sponsors: [],
  } as unknown as PublicEventDetail;
}

describe('FASE 119 — B11: Prévia da API do evento em leitura única (ADR-477)', () => {
  it('executa resolveTenant, verifyKey e loadProjections exatamente 1 vez para os 5 recursos', async () => {
    const now = new Date('2026-11-23T12:00:00.000Z');
    const detail = makeFakePublicEventDetail(now);

    const resolveTenant = vi.fn(async (slug: string) => ({
      tenantId: '00000000-0000-4000-8000-000000000001',
      slug,
      name: 'UFBA Demo',
      status: 'ACTIVE' as const,
      plan: 'FREE' as const,
      timezone: 'America/Bahia',
    }));

    const verifyKey = vi.fn(async () => ({
      ok: true as const,
      config: {
        chaveSelada: 'iv.tag.cifra',
        chaveHash: 'a'.repeat(64),
        criadaEm: now.toISOString(),
        secoes: {
          palestrantes: true,
          patrocinadores: false,
          chamadas: false,
        },
      },
    }));

    const loadProjections = vi.fn(async () => ({
      ok: true as const,
      generatedAt: now,
      projections: {
        evento: { id: detail.id, slug: detail.slug, title: detail.title },
        atividades: [],
        palestrantes: [],
        patrocinadores: [],
        chamadas: [],
      } as never,
    }));

    const result = await buildEventApiPreviews(
      {
        tenantSlug: 'ufba-demo',
        eventSlug: 'evento-demo',
        chave: 'k'.repeat(32),
        now,
      },
      { resolveTenant, verifyKey, loadProjections },
    );

    expect(result.ok).toBe(true);
    expect(resolveTenant).toHaveBeenCalledTimes(1);
    expect(verifyKey).toHaveBeenCalledTimes(1);
    expect(loadProjections).toHaveBeenCalledTimes(1);

    if (result.ok) {
      for (const resource of API_RESOURCES) {
        expect(result.previews[resource]).toBeDefined();
      }
      expect(result.previews.evento.status).toBe(200);
      expect(result.previews.atividades.status).toBe(200);
      expect(result.previews.palestrantes.status).toBe(200);
      expect(result.previews.patrocinadores.status).toBe(404);
      expect(result.previews.chamadas.status).toBe(404);
      expect(result.previews.evento.etag).toMatch(/^"[\w-]+"$/);
    }
  });
});

describe('FASE 119 — Paginação do acervo de mídia (ADR-478)', () => {
  it('parseMediaPage aceita inteiros positivos e normaliza entradas inválidas para 1', () => {
    expect(parseMediaPage(undefined)).toBe(1);
    expect(parseMediaPage('')).toBe(1);
    expect(parseMediaPage('0')).toBe(1);
    expect(parseMediaPage('-3')).toBe(1);
    expect(parseMediaPage('abc')).toBe(1);
    expect(parseMediaPage(' 4 ')).toBe(4);
  });

  it('computeMediaPagination calcula totalPages, skip, bordas e aplica clamp fora da faixa', () => {
    const empty = computeMediaPagination({ matchedCount: 0, page: 3 });
    expect(empty).toEqual({
      page: 1,
      pageSize: MEDIA_LIBRARY_LIMIT,
      totalPages: 1,
      skip: 0,
      hasPreviousPage: false,
      hasNextPage: false,
    });

    const middle = computeMediaPagination({ matchedCount: 405, page: 2, pageSize: 200 });
    expect(middle).toEqual({
      page: 2,
      pageSize: 200,
      totalPages: 3,
      skip: 200,
      hasPreviousPage: true,
      hasNextPage: true,
    });

    const clamped = computeMediaPagination({ matchedCount: 205, page: 99, pageSize: 200 });
    expect(clamped).toEqual({
      page: 2,
      pageSize: 200,
      totalPages: 2,
      skip: 200,
      hasPreviousPage: true,
      hasNextPage: false,
    });
  });

  it('buildMediaPageHref preserva filtros e omite pagina=1', () => {
    const base = '/t/ufba-demo/administracao/eventos/123/pagina/midia';
    expect(buildMediaPageHref(base, { busca: 'logo', pagina: 1 })).toBe(`${base}?busca=logo`);
    expect(
      buildMediaPageHref(base, {
        busca: 'capa',
        tipo: 'image/webp',
        uso: 'em-uso',
        pagina: 2,
      }),
    ).toBe(`${base}?busca=capa&tipo=image%2Fwebp&uso=em-uso&pagina=2`);
  });
});

describe('FASE 119 — Modularização interna de registration-service e certificate-service (ADR-479)', () => {
  it('os dois serviços encolheram e delegam aos novos submódulos sem alterar contratos públicos', async () => {
    const regLines = readText('src/lib/events/registration-service.ts').split(/\r?\n/).length;
    const certLines = readText('src/lib/certificates/certificate-service.ts').split(/\r?\n/).length;

    expect(regLines).toBeLessThan(2550);
    expect(certLines).toBeLessThan(1650);

    const regService = await import('@/lib/events/registration-service');
    expect(typeof regService.registerForActivity).toBe('function');
    expect(typeof regService.registerForEvent).toBe('function');
    expect(typeof regService.ensureEventRegistration).toBe('function');
    expect(typeof regService.linkParticipantIfEligible).toBe('function');
    expect(typeof regService.cancelRegistration).toBe('function');

    const certService = await import('@/lib/certificates/certificate-service');
    expect(typeof certService.requestCertificate).toBe('function');
    expect(typeof certService.previewEventCertificates).toBe('function');
    expect(typeof certService.listCertificates).toBe('function');
    expect(typeof certService.getPublicCertificate).toBe('function');
    expect(typeof certService.verifyCertificateIntegrity).toBe('function');
  });
});

describe('FASE 119 — Catracas de E95 (senha de fixture/seed) e I8 (sincronia documental) (ADR-480)', () => {
  it('E95: nenhuma spec E2E, seed-dev-users, contas-de-teste ou README carrega EventFlow#2026/EventFlow@2026', () => {
    const e2eFiles = readdirSync(join(ROOT, 'tests/e2e')).filter((f) => f.endsWith('.ts'));
    const targets = [
      'prisma/seed-dev-users.ts',
      'docs/contas-de-teste.md',
      'README.md',
      ...e2eFiles.map((f) => `tests/e2e/${f}`),
    ];

    const offenders: string[] = [];
    for (const rel of targets) {
      const text = readText(rel);
      if (text.includes('EventFlow#2026') || text.includes('EventFlow@2026')) {
        offenders.push(rel);
      }
    }

    expect(offenders, `Arquivos ainda com senha legada EventFlow: ${offenders.join(', ')}`).toEqual([]);
  });

  it('I8: AGENTS.md, README.md, docs/dividas-tecnicas.md e docs/armadilhas.md concordam nas contagens canônicas', () => {
    const agents = readText('AGENTS.md');
    const readme = readText('README.md');
    const dividas = readText('docs/dividas-tecnicas.md');
    const armadilhas = readText('docs/armadilhas.md');

    const phasesMatch = agents.match(/Fases concluídas\s+\.{3,}\s+1 a 17, 21 a 25, \*\*29 a (\d+)\*\*/);
    const vitestMatch = agents.match(/Testes\s+\.{3,}\s+\*\*(\d+)\*\* \(Vitest: unit \+ integração, (\d+) arquivos\)/);
    const e2eMatch = agents.match(/\*\*(\d+)\*\* \(Playwright E2E\)(?: \+ (\d+) skip)?/);
    const adrMatch = agents.match(/ADRs\s+\.{3,}\s+(\d+)/);
    const permMatch = agents.match(/Permissões\s+\.{3,}\s+(\d+)/);
    const rlsMatch = agents.match(/Tabelas de tenant\s+\.{3,}\s+(\d+) sob RLS/);

    expect(phasesMatch).not.toBeNull();
    expect(vitestMatch).not.toBeNull();
    expect(e2eMatch).not.toBeNull();
    expect(adrMatch).not.toBeNull();
    expect(permMatch).not.toBeNull();
    expect(rlsMatch).not.toBeNull();

    const maxPhase = phasesMatch![1];
    const vitestCount = vitestMatch![1];
    const vitestFiles = vitestMatch![2];
    const e2eCount = e2eMatch![1];
    const adrCount = adrMatch![1];
    const permCount = permMatch![1];

    // Estado de topo do README
    expect(readme).toContain(`29 a ${maxPhase} concluídas · **F${maxPhase} entregue**`);
    expect(readme).toContain(`**${vitestCount} testes** unitários/integração (${vitestFiles} arquivos)`);
    expect(readme).toContain(`**${e2eCount} testes E2E**`);
    expect(readme).toContain(`${permCount} permissões`);

    // Seção 10 (Testes) e seção 12 (Arquitetura) do README
    expect(readme).toContain(`npm test                  # ${vitestCount} testes (${vitestFiles} arquivos)`);
    expect(readme).toContain(`npm run test:e2e          # ${e2eCount} testes E2E`);
    expect(readme).toContain(`${e2eCount} testes Playwright`);

    // Dívidas abertas entre AGENTS.md, README.md e docs/dividas-tecnicas.md
    const agentsDebtMatch = agents.match(/levantamento consolidado \(\*\*(\d+) itens abertos\*\*/);
    const readmeDebtMatch = readme.match(/\*\*Levantamento consolidado:\*\* (\d+) dívidas abertas/);
    const totalDebtMatch = dividas.match(/\| \*\*Total\*\* \| \*\*(\d+)\*\* \|/);

    expect(agentsDebtMatch).not.toBeNull();
    expect(readmeDebtMatch).not.toBeNull();
    expect(totalDebtMatch).not.toBeNull();
    expect(readmeDebtMatch![1]).toBe(agentsDebtMatch![1]);
    expect(totalDebtMatch![1]).toBe(agentsDebtMatch![1]);

    // Armadilhas entre AGENTS.md, README.md e docs/armadilhas.md
    const agentsTrapMatch = agents.match(/A tabela COMPLETA — (\d+) armadilhas/);
    const readmeTrapMatch = readme.match(/Armadilhas conhecidas do projeto:\*\* as (\d+) que custaram depuração real/);
    const trapRows = [...armadilhas.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1]));
    const maxTrap = String(Math.max(...trapRows));

    expect(agentsTrapMatch).not.toBeNull();
    expect(readmeTrapMatch).not.toBeNull();
    expect(agentsTrapMatch![1]).toBe(maxTrap);
    expect(readmeTrapMatch![1]).toBe(maxTrap);
    expect(adrCount).toBe('480');
  });
});
