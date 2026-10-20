/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — Vitrine Pública & Leads Institucionais (FASE 71)
 *
 *  Cobre:
 *    • Projeção segura de busca pública (sem vazamento de onlineUrl — R1 / ADR-351);
 *    • Filtros de eventos por categoria temática padronizada, modalidade e termo;
 *    • Eventos em destaque e métricas públicas da plataforma (ADR-352);
 *    • Ciclo de leads institucionais (inserção, listagem e atualização de status);
 *    • Isolamento da tabela institution_leads (tabela de plataforma sem RLS / ADR-353).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import {
  searchPublicEvents,
  getFeaturedPublicEvents,
  getPlatformPublicMetrics,
  insertInstitutionLead,
  listInstitutionLeads,
  getInstitutionLeadById,
  updateInstitutionLeadStatus,
} from '../../src/lib/platform/global-repository';
import { saveEvent } from '../../src/lib/admin/catalog-service';
import { withTenant } from '../../src/lib/db/tenant-client';

const RUN = randomUUID().slice(0, 8);
const TENANT_SLUG = `f71-tenant-${RUN}`;

let tenantId: string;
let actorId: string;
let eventTechId: string;
let eventHealthId: string;

describe('F71 — Vitrine Pública, Descoberta e Expansão Institucional', () => {
  beforeAll(async () => {
    // 1. Criar usuário e tenant de teste
    actorId = randomUUID();
    await adminPrisma.user.create({
      data: {
        id: actorId,
        name: `Gestor F71 ${RUN}`,
        email: `gestor.f71.${RUN}@exemplo.test`,
      },
    });

    tenantId = randomUUID();
    await adminPrisma.tenant.create({
      data: {
        id: tenantId,
        slug: TENANT_SLUG,
        name: `Instituto de Tecnologia e Saúde ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: 'America/Bahia',
        isPublic: true,
        city: 'Salvador',
        state: 'BA',
        segment: 'Ensino Superior e Pesquisa',
      },
    });

    // 2. Criar eventos com categorias distintas via saveEvent
    const now = new Date();
    const startTech = new Date(now.getTime() + 86_400_000 * 5); // +5 dias
    const endTech = new Date(startTech.getTime() + 3600_000 * 8); // +8h

    const resTech = await saveEvent({
      tenantId,
      actorId,
      slug: `congresso-ia-${RUN}`,
      title: `Congresso de Inteligência Artificial e Robótica ${RUN}`,
      summary: 'Explorando novas fronteiras em modelos generativos e robótica.',
      status: 'PUBLISHED',
      modality: 'HYBRID',
      category: 'TECNOLOGIA',
      city: 'Salvador',
      state: 'BA',
      startsAt: startTech,
      endsAt: endTech,
      timezone: 'America/Bahia',
      onlineUrl: 'https://sala.privada.exemplo.test/sala-secreta-123',
    });
    if (!resTech.ok) throw new Error(resTech.message);
    eventTechId = resTech.eventId;

    const startHealth = new Date(now.getTime() + 86_400_000 * 10); // +10 dias
    const endHealth = new Date(startHealth.getTime() + 3600_000 * 6); // +6h

    const resHealth = await saveEvent({
      tenantId,
      actorId,
      slug: `simposio-medico-${RUN}`,
      title: `Simpósio de Medicina e Saúde Pública ${RUN}`,
      summary: 'Debates sobre atenção básica e epidemiologia.',
      status: 'PUBLISHED',
      modality: 'IN_PERSON',
      category: 'SAUDE_BEM_ESTAR',
      city: 'Feira de Santana',
      state: 'BA',
      startsAt: startHealth,
      endsAt: endHealth,
      timezone: 'America/Bahia',
    });
    if (!resHealth.ok) throw new Error(resHealth.message);
    eventHealthId = resHealth.eventId;
  });

  afterAll(async () => {
    // Limpeza reversa
    await adminPrisma.institutionLead.deleteMany({
      where: { email: { contains: RUN } },
    });

    if (tenantId) {
      await adminPrisma.event.deleteMany({ where: { tenantId } });
      await adminPrisma.tenant.delete({ where: { id: tenantId } });
    }

    if (actorId) {
      await adminPrisma.user.delete({ where: { id: actorId } });
    }
  });

  describe('Busca Pública de Eventos (searchPublicEvents)', () => {
    it('filtra com precisão por categoria temática', async () => {
      const searchTech = await searchPublicEvents({
        category: 'TECNOLOGIA',
        query: RUN,
      });

      expect(searchTech.items.some((e) => e.id === eventTechId)).toBe(true);
      expect(searchTech.items.some((e) => e.id === eventHealthId)).toBe(false);

      const searchHealth = await searchPublicEvents({
        category: 'SAUDE_BEM_ESTAR',
        query: RUN,
      });

      expect(searchHealth.items.some((e) => e.id === eventHealthId)).toBe(true);
      expect(searchHealth.items.some((e) => e.id === eventTechId)).toBe(false);
    });

    it('busca por termo de texto no título e resumo', async () => {
      const result = await searchPublicEvents({
        query: 'Inteligência Artificial',
      });

      expect(result.items.some((e) => e.id === eventTechId)).toBe(true);
      expect(result.items.some((e) => e.id === eventHealthId)).toBe(false);
    });

    it('filtra por modalidade', async () => {
      const resultHybrid = await searchPublicEvents({
        modality: 'HYBRID',
        query: RUN,
      });

      expect(resultHybrid.items.some((e) => e.id === eventTechId)).toBe(true);
      expect(resultHybrid.items.some((e) => e.id === eventHealthId)).toBe(false);
    });

    it('NUNCA projeta onlineUrl na vitrine pública (Garantia de Segurança R1 / ADR-351)', async () => {
      const result = await searchPublicEvents({ query: RUN });
      const found = result.items.find((e) => e.id === eventTechId);

      expect(found).toBeDefined();
      // A chave onlineUrl não pode existir na projeção pública
      expect((found as unknown as { onlineUrl?: string }).onlineUrl).toBeUndefined();
    });

    it('getFeaturedPublicEvents retorna apenas eventos publicados com dados do tenant', async () => {
      const featured = await getFeaturedPublicEvents(10);
      const techFeatured = featured.find((e) => e.id === eventTechId);

      expect(techFeatured).toBeDefined();
      expect(techFeatured?.tenantName).toContain('Instituto de Tecnologia e Saúde');
      expect(techFeatured?.tenantSlug).toBe(TENANT_SLUG);
    });
  });

  describe('Métricas Públicas da Plataforma (getPlatformPublicMetrics)', () => {
    it('retorna totais consolidados e anônimos', async () => {
      const metrics = await getPlatformPublicMetrics();

      expect(metrics.totalTenants).toBeGreaterThanOrEqual(1);
      expect(metrics.totalEvents).toBeGreaterThanOrEqual(2);
      expect(metrics.totalRegistrations).toBeGreaterThanOrEqual(0);
      expect(metrics.totalCertificates).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Ciclo de Leads Institucionais (ADR-353)', () => {
    let leadId: string;

    it('insere um novo lead institucional via repositório global', async () => {
      const insertResult = await insertInstitutionLead({
        name: 'Prof. Carlos Mendes',
        email: `carlos.mendes.${RUN}@universidade.test`,
        phone: '(71) 99876-5432',
        organization: `Universidade do Futuro ${RUN}`,
        roleInOrg: 'Diretor de Extensão',
        estimatedEventsPerYear: '6 a 12 eventos por ano',
        message: 'Gostaríamos de implantar para todos os simpósios do ano letivo.',
      });

      expect(insertResult.ok).toBe(true);
      if (!insertResult.ok) return;

      leadId = insertResult.id;
      expect(leadId).toBeDefined();
    });

    it('lista leads com paginação e filtro por status', async () => {
      const list = await listInstitutionLeads({
        status: 'OPEN',
        page: 1,
        pageSize: 50,
      });

      expect(list.total).toBeGreaterThanOrEqual(1);
      const found = list.items.find((item) => item.id === leadId);
      expect(found).toBeDefined();
      expect(found?.organization).toContain(`Universidade do Futuro ${RUN}`);
      expect(found?.status).toBe('OPEN');
    });

    it('atualiza situação e anotações internas do lead', async () => {
      const updated = await updateInstitutionLeadStatus(leadId, {
        status: 'CONTACTED',
        internalNotes: 'Apresentação realizada por videochamada em 09/10.',
      });

      expect(updated).toBeDefined();
      expect(updated.status).toBe('CONTACTED');
      expect(updated.internalNotes).toBe('Apresentação realizada por videochamada em 09/10.');

      const single = await getInstitutionLeadById(leadId);
      expect(single?.status).toBe('CONTACTED');
      expect(single?.internalNotes).toBe('Apresentação realizada por videochamada em 09/10.');
    });

    it('garante que a role de runtime NÃO tem permissão direta na tabela institution_leads', async () => {
      // Como definido no contrato de segurança ADR-191 e ADR-353, tabelas de plataforma
      // não podem ser acessadas pelo contexto de tenant
      let caughtError = false;
      try {
        await withTenant(tenantId, async (tx) => {
          // Consulta bruta como role de runtime
          await tx.$queryRawUnsafe('SELECT count(*) FROM institution_leads');
        });
      } catch (error) {
        caughtError = true;
        expect(String(error)).toMatch(/permission denied|does not exist|violates/i);
      }
      expect(caughtError).toBe(true);
    });
  });
});
