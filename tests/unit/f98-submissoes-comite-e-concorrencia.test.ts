import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('FASE 98 — Destravar visão do autor, cockpit do comitê e concorrência', () => {
  const root = process.cwd();

  describe('1. Visão do Autor em /submissoes (ADR-412)', () => {
    const pageSrc = readFileSync(
      join(root, 'src/app/t/[tenantSlug]/(app)/submissoes/page.tsx'),
      'utf8',
    );

    it('consolida leituras de submissões, eventos e chamadas em transação única withTenant', () => {
      // Confere que há exatamente uma chamada a withTenant na página
      const withTenantMatches = pageSrc.match(/withTenant\(/g);
      expect(withTenantMatches).toHaveLength(1);
      expect(pageSrc).toContain('const { page, openEvents, openCalls } = await withTenant(');
    });

    it('busca chamadas de propostas abertas e exibe links clicáveis para os proponentes', () => {
      expect(pageSrc).toContain('tx.callForProposals.findMany(');
      expect(pageSrc).toContain('chamadas-abertas');
      expect(pageSrc).toContain('/eventos/${call.event.slug}/chamada/${call.slug}');
      expect(pageSrc).toContain('Enviar proposta');
    });

    it('preserva data-testid="no-open-cfp" tanto com chamadas abertas quanto sem chamadas', () => {
      expect(pageSrc).toContain('data-testid="no-open-cfp"');
    });

    it('submission-service exporta listMySubmissions aceitando client transacional opcional', () => {
      const serviceSrc = readFileSync(
        join(root, 'src/lib/review/submission-service.ts'),
        'utf8',
      );
      expect(serviceSrc).toMatch(
        /export async function listMySubmissions[\s\S]*?tenantId: string[\s\S]*?userId: string[\s\S]*?client\?: TxClient/,
      );
    });
  });

  describe('2. Cockpit do Comitê Científico em /comite (ADR-413)', () => {
    const pageSrc = readFileSync(
      join(root, 'src/app/t/[tenantSlug]/(app)/comite/page.tsx'),
      'utf8',
    );

    it('executa leituras sob transação withTenant em boundary assíncrono com Suspense (FASE 100 · ADR-420)', () => {
      expect(pageSrc).toContain('withTenant(');
      expect(pageSrc).toContain('<Suspense');
      expect(pageSrc).toContain('fallback={<SubmissionsListSkeleton />}');
      expect(pageSrc).toContain('ComiteResults');
    });

    it('possui barra de busca e filtros de evento e status/quórum', () => {
      expect(pageSrc).toContain('name="busca"');
      expect(pageSrc).toContain('name="evento"');
      expect(pageSrc).toContain('name="status"');
      expect(pageSrc).toContain('Limpar filtros');
    });

    it('exibe o título do evento em cada card da fila de submissões', () => {
      expect(pageSrc).toContain('submission.eventTitle');
      expect(pageSrc).toContain('data-testid="chair-submissions"');
      expect(pageSrc).toContain('data-testid="chair-summary"');
    });

    it('review-service enriquece listSubmissionsForChair com evento, chamada e filtros opcionais', () => {
      const serviceSrc = readFileSync(
        join(root, 'src/lib/review/review-service.ts'),
        'utf8',
      );
      expect(serviceSrc).toContain('eventId: row.eventId');
      expect(serviceSrc).toContain('eventTitle: row.event.title');
      expect(serviceSrc).toContain('callTitle: row.call?.title ?? null');
      expect(serviceSrc).toContain('options.search');
      expect(serviceSrc).toContain('options.eventId');
    });
  });

  describe('3. Fila de Pareceres e Concorrência em /revisoes e /equipe (ADR-414)', () => {
    it('listReviewerTasks consolida assignments e submitted em transação única withTenant', () => {
      const serviceSrc = readFileSync(
        join(root, 'src/lib/review/review-service.ts'),
        'utf8',
      );
      expect(serviceSrc).toContain('const { assignments, submitted } = await withTenant(');
    });

    it('/revisoes/page.tsx apresenta cockpit com cartões de pendentes e concluídos', () => {
      const pageSrc = readFileSync(
        join(root, 'src/app/t/[tenantSlug]/(app)/revisoes/page.tsx'),
        'utf8',
      );
      expect(pageSrc).toContain('Pareceres pendentes');
      expect(pageSrc).toContain('Pareceres concluídos');
      expect(pageSrc).toContain('task.eventTitle');
    });

    it('/administracao/equipe/page.tsx carrega membros e convites em paralelo com Promise.all', () => {
      const pageSrc = readFileSync(
        join(root, 'src/app/t/[tenantSlug]/(app)/administracao/equipe/page.tsx'),
        'utf8',
      );
      expect(pageSrc).toContain('const [team, invitations] = await Promise.all([');
      expect(pageSrc).toContain('getTeamOverview(tenantId)');
      expect(pageSrc).toContain('listInvitations({ tenantId })');
    });
  });
});
