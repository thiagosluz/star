/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS E CATRACAS DE FONTE — FASE 112
 *  Bloco do Comitê Científico (`CHAIR`) no Painel e Fechamento do Fluxo Editorial
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_BLOCK_META,
  dashboardBlockHref,
  dashboardBlocksFor,
  type DashboardSubject,
} from '../../src/domain/platform/dashboard-blocks';
import { EVENT_AREAS } from '../../src/domain/events/event-areas';
import {
  THEME_COLOR_PRESETS,
  colorSchema,
  toColorPickerHex,
} from '../../src/domain/events/landing-page';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../../src/domain/rbac/permissions';

function subject(overrides: Partial<DashboardSubject> = {}): DashboardSubject {
  return {
    roles: [],
    hasDeadlineAction: false,
    hasSpeakerProfile: false,
    hasSponsorLink: false,
    hasPendingInvite: false,
    ...overrides,
  };
}

function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('FASE 112 — Bloco do Comitê Científico (CHAIR) e Fluxo Editorial', () => {
  describe('1. Domínio do painel: separação entre comite (/comite) e pareceres (/revisoes)', () => {
    it('declara o bloco comite apontando para /comite com título e descrição próprios', () => {
      expect(DASHBOARD_BLOCK_META.comite).toEqual({
        path: '/comite',
        title: 'Comitê científico',
        description: 'Trabalhos recebidos, distribuição de revisores e decisões das chamadas.',
      });
      expect(dashboardBlockHref('comite', 'ufba-2026')).toBe('/t/ufba-2026/comite');
    });

    it('CHAIR isolado vê participacao, submissoes e comite — e NÃO vê pareceres (/revisoes vazio)', () => {
      const plano = dashboardBlocksFor(subject({ roles: ['CHAIR'] }));
      expect(plano.blocks).toEqual(['participacao', 'submissoes', 'comite']);
      expect(plano.hidden).toBe(0);
    });

    it('REVIEWER isolado vê apenas pareceres (/revisoes) — e NÃO vê comite', () => {
      const plano = dashboardBlocksFor(subject({ roles: ['REVIEWER'] }));
      expect(plano.blocks).toEqual(['pareceres']);
      expect(plano.hidden).toBe(0);
    });

    it('CHAIR + REVIEWER acumulados veem AMBOS os blocos: comite (/comite) e pareceres (/revisoes)', () => {
      const plano = dashboardBlocksFor(subject({ roles: ['CHAIR', 'REVIEWER'] }));
      expect(plano.blocks).toEqual(['participacao', 'submissoes', 'comite', 'pareceres']);
      expect(plano.hidden).toBe(0);
    });

    it('OWNER, ADMIN e ORGANIZER mantêm exatamente seus 5 blocos sem estourar o teto com comite', () => {
      expect(dashboardBlocksFor(subject({ roles: ['OWNER'] })).blocks).toEqual([
        'gestao',
        'participacao',
        'submissoes',
        'pareceres',
        'equipe',
      ]);
      expect(dashboardBlocksFor(subject({ roles: ['ADMIN'] })).blocks).toEqual([
        'gestao',
        'participacao',
        'submissoes',
        'pareceres',
        'equipe',
      ]);
      expect(dashboardBlocksFor(subject({ roles: ['ORGANIZER'] })).blocks).toEqual([
        'gestao',
        'pareceres',
        'equipe',
      ]);
    });
  });

  describe('2. Painel da instituição: fato dinâmico do bloco comite em DashboardPage', () => {
    const dashboardCode = semComentarios(
      readFileSync(
        join(process.cwd(), 'src/app/t/[tenantSlug]/(app)/dashboard/page.tsx'),
        'utf8',
      ),
    );

    it('consulta listSubmissionsForChair apenas quando visible("comite") é verdadeiro', () => {
      expect(dashboardCode).toContain("visible('comite') ? listSubmissionsForChair(tenantId)");
      expect(dashboardCode).toContain('comite: BookOpenCheck');
      expect(dashboardCode).toContain("facts.set(\n      'comite'");
      expect(dashboardCode).toContain("'trabalho na fila'");
      expect(dashboardCode).toContain("'pronto para decisão'");
    });
  });

  describe('3. Permissão de curadoria de Anais (submission:decide) e ponte /comite ↔ /anais', () => {
    it('CHAIR, ORGANIZER, ADMIN e OWNER possuem submission:decide no catálogo RBAC', () => {
      expect(ROLE_PERMISSIONS.CHAIR).toContain(PERMISSIONS.SUBMISSION_DECIDE);
      expect(ROLE_PERMISSIONS.ORGANIZER).toContain(PERMISSIONS.SUBMISSION_DECIDE);
      expect(ROLE_PERMISSIONS.ADMIN).toContain(PERMISSIONS.SUBMISSION_DECIDE);
      expect(ROLE_PERMISSIONS.OWNER).toContain(PERMISSIONS.SUBMISSION_DECIDE);
    });

    it('a área anais em EVENT_AREAS, a página de anais e as 5 Server Actions exigem PERMISSIONS.SUBMISSION_DECIDE', () => {
      const areaAnais = EVENT_AREAS.find((a) => a.id === 'anais');
      expect(areaAnais?.permission).toBe(PERMISSIONS.SUBMISSION_DECIDE);

      const anaisPage = semComentarios(
        readFileSync(
          join(
            process.cwd(),
            'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/anais/page.tsx',
          ),
          'utf8',
        ),
      );
      expect(anaisPage).toContain('permission: PERMISSIONS.SUBMISSION_DECIDE');
      expect(anaisPage).toContain('/comite?evento=${eventId}');

      const actionsCode = semComentarios(
        readFileSync(join(process.cwd(), 'src/app/actions/proceedings-actions.ts'), 'utf8'),
      );
      expect(actionsCode.match(/PERMISSIONS\.SUBMISSION_DECIDE/g)).toHaveLength(5);
      expect(actionsCode).not.toContain('PERMISSIONS.EVENT_MANAGE');
    });

    it('o cockpit de /comite exibe atalhos diretos para os Anais dos eventos (chair-proceedings-links)', () => {
      const comitePage = semComentarios(
        readFileSync(
          join(process.cwd(), 'src/app/t/[tenantSlug]/(app)/comite/page.tsx'),
          'utf8',
        ),
      );
      expect(comitePage).toContain('data-testid="chair-proceedings-links"');
      expect(comitePage).toContain('data-testid={`chair-proceedings-link-${ev.id}`}');
      expect(comitePage).toContain('/administracao/eventos/${ev.id}/anais');
    });
  });

  describe('4. Higiene de contexto nas páginas científicas (1 contexto por render)', () => {
    it('/comite/[submissionId] e /reconhecimento usam o principal de requirePagePermission sem 2ª chamada a getRequestContext', () => {
      const submissionPage = semComentarios(
        readFileSync(
          join(
            process.cwd(),
            'src/app/t/[tenantSlug]/(app)/comite/[submissionId]/page.tsx',
          ),
          'utf8',
        ),
      );
      expect(submissionPage).not.toContain('getRequestContext');
      expect(submissionPage).toContain('const { tenantId, principal } = await requirePagePermission');

      const recognitionPage = semComentarios(
        readFileSync(
          join(
            process.cwd(),
            'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/reconhecimento/page.tsx',
          ),
          'utf8',
        ),
      );
      expect(recognitionPage).not.toContain('getRequestContext');
      expect(recognitionPage).toContain('const { tenantId, principal } = await requirePagePermission');

      const createSubmissionForm = semComentarios(
        readFileSync(
          join(process.cwd(), 'src/components/review/create-submission-form.tsx'),
          'utf8',
        ),
      );
      expect(createSubmissionForm).toContain('data-testid="submission-error"');
      expect(createSubmissionForm).toContain('data-testid="submission-error-toast"');
      expect(createSubmissionForm).toContain('data-testid="submission-error-toast-close"');
      expect(createSubmissionForm).toContain('scrollIntoView');

      for (const presets of Object.values(THEME_COLOR_PRESETS)) {
        expect(presets.length).toBeGreaterThanOrEqual(6);
        for (const preset of presets) {
          expect(colorSchema.safeParse(preset.value).success).toBe(true);
        }
      }
      expect(toColorPickerHex('#1d4ed8', 'primaryColor')).toBe('#1d4ed8');
      expect(toColorPickerHex('#abc', 'primaryColor')).toBe('#aabbcc');
      expect(toColorPickerHex('', 'primaryColor')).toBe('#4f46e5');
      expect(toColorPickerHex('oklch(0.26 0.01 265)', 'secondaryColor')).toBe('#f1f3ff');

      const landingThemeFields = semComentarios(
        readFileSync(
          join(process.cwd(), 'src/components/admin/landing-theme-fields.tsx'),
          'utf8',
        ),
      );
      expect(landingThemeFields).toContain('type="color"');
      expect(landingThemeFields).toContain('theme-picker-');
      expect(landingThemeFields).toContain('theme-preset-');
      expect(landingThemeFields).toContain('theme-clear-');
    });
  });
});
