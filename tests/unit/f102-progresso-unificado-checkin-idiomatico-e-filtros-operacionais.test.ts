import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { RouteProgress } from '@/components/shell/route-progress';

const root = process.cwd();

describe('FASE 102 — Progresso Unificado, Check-in Idiomático React 19 e Filtros Operacionais Reativos (ADR-426 a ADR-428)', () => {
  describe('1. Unificação da Barra de Progresso e Link Canônico (ADR-426)', () => {
    const appLinkPath = resolve(root, 'src/components/ui/app-link.tsx');
    const routeProgressPath = resolve(root, 'src/components/shell/route-progress.tsx');
    const navigationPath = resolve(root, 'src/components/ui/navigation.tsx');

    it('AppLink possui guarda contra rota idêntica antes de iniciar progresso', () => {
      expect(existsSync(appLinkPath)).toBe(true);
      const src = readFileSync(appLinkPath, 'utf8');

      expect(src).toContain('targetPath !== currentPath');
      expect(src).toContain('url.origin === window.location.origin');
      expect(src).toContain('startNavigationProgress()');
    });

    it('RouteProgress atua como âncora de acessibilidade semântica sincronizada aos eventos globais sem duplicar a barra visual', () => {
      expect(existsSync(routeProgressPath)).toBe(true);
      const src = readFileSync(routeProgressPath, 'utf8');

      // Escuta os eventos canônicos de progresso
      expect(src).toContain('KOVENO_NAVIGATION_START_EVENT');
      expect(src).toContain('KOVENO_NAVIGATION_STOP_EVENT');

      // Não renderiza barra de progresso visual redundante
      expect(src).not.toContain('h-1 overflow-hidden bg-primary/20');
      expect(src).toContain('className="sr-only"');

      // Atende ao contrato de acessibilidade e testids
      const tenantHtml = renderToStaticMarkup(
        createElement(RouteProgress, { variant: 'tenant', forceVisible: true }),
      );
      expect(tenantHtml).toContain('data-testid="app-route-loading"');
      expect(tenantHtml).toContain('aria-busy="true"');
      expect(tenantHtml).toContain('Carregando página');

      const platformHtml = renderToStaticMarkup(
        createElement(RouteProgress, { variant: 'platform', forceVisible: true }),
      );
      expect(platformHtml).toContain('data-testid="platform-route-loading"');
      expect(platformHtml).toContain('aria-busy="true"');
      expect(platformHtml).toContain('Carregando painel da plataforma');
    });

    it('NavLink e TabNav utilizam AppLink para navegação canônica integrada à barra de progresso', () => {
      expect(existsSync(navigationPath)).toBe(true);
      const src = readFileSync(navigationPath, 'utf8');

      expect(src).toContain("import { AppLink } from '@/components/ui/app-link'");
      expect(src).toContain('<AppLink');
    });
  });

  describe('2. Check-in Idiomático no React 19 com useActionState e Rollback (ADR-427)', () => {
    const queuePath = resolve(root, 'src/components/gamification/checkin-queue.tsx');

    it('QueueRow conecta action={formAction} diretamente ao form e executa useOptimistic na transição nativa', () => {
      expect(existsSync(queuePath)).toBe(true);
      const src = readFileSync(queuePath, 'utf8');

      expect(src).toContain('useActionState(');
      expect(src).toContain('useOptimistic(');
      expect(src).toContain('<form action={formAction}>');
      expect(src).toContain('setOptimisticInside(nextInside);');
      expect(src).toContain('return action(prevState, formData);');
      expect(src).toContain("role={state.ok ? 'status' : 'alert'}");
      expect(src).toContain('const { pending } = useFormStatus();');
    });
  });

  describe('3. Transição Suave em /comite e Filtros Operacionais Reativos (ADR-428)', () => {
    const comitePagePath = resolve(root, 'src/app/t/[tenantSlug]/(app)/comite/page.tsx');
    const checkinFilterPath = resolve(root, 'src/components/credentials/checkin-filter-bar.tsx');
    const participantFilterPath = resolve(root, 'src/components/participants/participant-filter-bar.tsx');
    const credenciamentoPagePath = resolve(root, 'src/app/t/[tenantSlug]/(app)/credenciamento/page.tsx');
    const participantesPagePath = resolve(root, 'src/app/t/[tenantSlug]/(app)/participantes/page.tsx');

    it('ComitePage entrega Suspense estável sem key na casca, mantendo a lista visível durante transição', () => {
      expect(existsSync(comitePagePath)).toBe(true);
      const src = readFileSync(comitePagePath, 'utf8');

      expect(src).toContain('<Suspense fallback={<SubmissionsListSkeleton />}>');
      expect(src).toContain('<ComiteResults');
      expect(src).toContain('key={filterKey}');
    });

    it('Credenciamento integra CheckinEventFilter e CheckinSearchFilter com suporte reativo e no-JS', () => {
      expect(existsSync(checkinFilterPath)).toBe(true);
      const filterSrc = readFileSync(checkinFilterPath, 'utf8');

      expect(filterSrc).toContain('data-testid="checkin-filters"');
      expect(filterSrc).toContain('data-testid="checkin-event"');
      expect(filterSrc).toContain('data-testid="checkin-badges-link"');
      expect(filterSrc).toContain('data-testid="checkin-search-form"');
      expect(filterSrc).toContain('data-testid="checkin-search"');
      expect(filterSrc).toContain("e.key === '/'");
      expect(filterSrc).toContain("e.key === 'Escape'");
      expect(filterSrc).toContain('targetUrl === currentUrl');

      const pageSrc = readFileSync(credenciamentoPagePath, 'utf8');
      expect(pageSrc).toContain('<CheckinEventFilter');
      expect(pageSrc).toContain('<CheckinSearchFilter');
    });

    it('Participantes integra ParticipantFilterBar com auto-submit, debounce e atalhos de teclado', () => {
      expect(existsSync(participantFilterPath)).toBe(true);
      const filterSrc = readFileSync(participantFilterPath, 'utf8');

      expect(filterSrc).toContain('data-testid="participant-filters"');
      expect(filterSrc).toContain('data-testid="participant-search"');
      expect(filterSrc).toContain('data-testid="participant-event"');
      expect(filterSrc).toContain('data-testid="participant-only-certificate"');
      expect(filterSrc).toContain('data-testid="participant-only-attended"');
      expect(filterSrc).toContain('data-testid="participant-filter-apply"');
      expect(filterSrc).toContain("e.key === '/'");
      expect(filterSrc).toContain("e.key === 'Escape'");
      expect(filterSrc).toContain('targetUrl === currentUrl');

      const pageSrc = readFileSync(participantesPagePath, 'utf8');
      expect(pageSrc).toContain('<ParticipantFilterBar');
    });
  });
});

