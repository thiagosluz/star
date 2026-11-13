// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/t/demo/dashboard',
  unstable_rethrow: vi.fn(),
}));

vi.mock('@/app/actions/context-actions', () => ({
  switchTenantAction: vi.fn(),
}));

vi.mock('@/app/actions/member-actions', () => ({
  updateMemberRolesAction: vi.fn(),
  removeMemberAction: vi.fn(),
  demoteMemberAction: vi.fn(),
}));

vi.mock('@/app/actions/communication-actions', () => ({
  inviteMemberAction: vi.fn(),
}));

vi.mock('@/app/actions/platform-actions', () => ({
  submitInstitutionLeadAction: vi.fn(),
}));

vi.mock('@/app/actions/registration-actions', () => ({
  registerForEventAction: vi.fn(),
}));

vi.mock('@/app/actions/account-actions', () => ({
  requestEmailChangeAction: vi.fn(),
  updateAccountProfileAction: vi.fn(),
}));

import { AccountEmailForm, AccountProfileForm } from '@/components/account/account-forms';
import { RouteLoadingSkeleton, RouteProgress } from '@/components/shell/route-progress';
import { EventApiSectionsForm } from '@/components/admin/event-api-sections-form';
import { MemberRolesForm } from '@/components/admin/member-actions';
import { InviteMemberForm } from '@/components/communication/invite-member-form';
import { EventRegistrationForm } from '@/components/events/event-registration-form';
import { InstitutionLeadForm } from '@/components/platform/lead-form';
import { AuthorEditor } from '@/components/review/author-editor';
import { SubmissionUploader } from '@/components/review/submission-uploader';
import { MobileNav } from '@/components/shell/mobile-nav';
import { TenantMenu } from '@/components/tenancy/tenant-menu';
import { ConfirmSubmitButton, GetSearchForm } from '@/components/ui';

function readWorkspaceFile(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n');
}

describe('FASE 108 · Polimento Final de UX, React 19 & App Router', () => {
  describe('Bloco A · React 19 useFormStatus, useActionState direto e preservação pós-erro', () => {
    it('TenantMenu usa useFormStatus em componente filho de <form>, AppLink e fechamento por Esc/fora/rota', () => {
      const html = renderToStaticMarkup(
        createElement(
          TenantMenu,
          {
            currentSlug: 'ufba',
            label: 'Trocar de instituição',
            memberships: [
              {
                tenantId: 't-1',
                tenantSlug: 'ufba',
                tenantName: 'UFBA',
                status: 'ACTIVE',
                roles: ['OWNER'],
              },
              {
                tenantId: 't-2',
                tenantSlug: 'fiocruz',
                tenantName: 'Fiocruz',
                status: 'ACTIVE',
                roles: ['ADMIN'],
              },
            ],
          },
          createElement('span', null, 'Conta Demo'),
        ),
      );

      const dom = new JSDOM(html).window.document;
      expect(dom.querySelector('[data-testid="account-tenant-menu"]')).not.toBeNull();
      expect(dom.querySelector('[data-testid="menu-my-account"]')?.getAttribute('href')).toBe('/conta');

      const src = readWorkspaceFile('src/components/tenancy/tenant-menu.tsx');
      expect(src).toContain('function SwitchTenantOptionButton');
      expect(src).toContain('const { pending } = useFormStatus();');
      expect(src).toContain('Entrando na instituição…');
      expect(src).toContain('<AppLink');
      expect(src).not.toContain('<a\n            href="/conta"');
      expect(src).toContain('pointerdown');
      expect(src).toContain('event.key === "Escape"');
      expect(src).toContain('usePathname');
    });

    it('MemberRolesForm e InviteMemberForm passam actions diretamente ao useActionState sem closure async', () => {
      const rolesHtml = renderToStaticMarkup(
        createElement(MemberRolesForm, {
          tenantSlug: 'demo',
          userId: 'u-1',
          memberName: 'Ana',
          currentRoles: ['ADMIN'],
          options: [
            { value: 'ADMIN', label: 'Administrador' },
            { value: 'STAFF', label: 'Equipe' },
          ],
        }),
      );
      expect(new JSDOM(rolesHtml).window.document.querySelector('[data-testid="save-roles-submit"]')).not.toBeNull();

      const inviteHtml = renderToStaticMarkup(
        createElement(InviteMemberForm, {
          tenantSlug: 'demo',
          roles: [{ value: 'STAFF', label: 'Equipe', consequence: 'acesso operacional' }],
        }),
      );
      expect(new JSDOM(inviteHtml).window.document.querySelector('[data-testid="invite-member-submit"]')).not.toBeNull();

      const memberSrc = readWorkspaceFile('src/components/admin/member-actions.tsx');
      expect(memberSrc).toContain('useActionState(updateMemberRolesAction, INITIAL_MEMBER_STATE)');
      expect(memberSrc).not.toMatch(/useActionState[\s\S]{0,120}?async\s*\(/);
      expect(memberSrc).toContain("pending ? 'Salvando…' : 'Salvar papéis'");

      const inviteSrc = readWorkspaceFile('src/components/communication/invite-member-form.tsx');
      expect(inviteSrc).toContain('useActionState(inviteMemberAction, INITIAL_INVITE_STATE)');
      expect(inviteSrc).not.toMatch(/useActionState[\s\S]{0,160}?async\s*\(/);
      expect(inviteSrc).toContain("pending ? 'Enviando…' : 'Enviar convite'");
    });

    it('LeadForm, AccountEmailForm, EventRegistrationForm e EventApiSectionsForm preservam entrada em erro', () => {
      const leadHtml = renderToStaticMarkup(createElement(InstitutionLeadForm));
      expect(new JSDOM(leadHtml).window.document.querySelector('[data-testid="institution-lead-form"]')).not.toBeNull();

      const emailHtml = renderToStaticMarkup(
        createElement(AccountEmailForm, {
          currentEmail: 'atual@example.test',
          emailVerified: true,
          action: async () => ({ ok: false, message: 'Senha incorreta' }),
        }),
      );
      expect(new JSDOM(emailHtml).window.document.querySelector('[data-testid="account-new-email"]')).not.toBeNull();

      const profileHtml = renderToStaticMarkup(
        createElement(AccountProfileForm, {
          currentName: 'Nome Atual',
          action: async () => ({ ok: false, message: 'Nome curto' }),
        }),
      );
      expect(new JSDOM(profileHtml).window.document.querySelector('[data-testid="account-name"]')).not.toBeNull();

      const regHtml = renderToStaticMarkup(
        createElement(EventRegistrationForm, {
          tenantSlug: 'demo',
          eventSlug: 'ev-1',
          openActivities: [],
          individualActivities: [],
        }),
      );
      const regDom = new JSDOM(regHtml).window.document;
      expect(regDom.querySelector('input[name="consentData"]')).not.toBeNull();
      expect(regDom.querySelector('input[name="consentImage"]')).not.toBeNull();

      const apiHtml = renderToStaticMarkup(
        createElement(EventApiSectionsForm, {
          tenantSlug: 'demo',
          eventId: 'ev-1',
          state: 'ACTIVE',
          secoes: { palestrantes: true, patrocinadores: false, chamadas: true },
          action: async () => ({ ok: false, message: 'Erro' }),
        }),
      );
      const apiDom = new JSDOM(apiHtml).window.document;
      expect(apiDom.querySelector('[data-testid="event-api-section-palestrantes"]')?.hasAttribute('checked')).toBe(
        true,
      );

      const platformActionSrc = readWorkspaceFile('src/app/actions/platform-actions.ts');
      expect(platformActionSrc).toContain('values?: {');
      expect(platformActionSrc).toContain('values: submittedValues');

      const accountActionSrc = readWorkspaceFile('src/app/actions/account-actions.ts');
      expect(accountActionSrc).toContain('values?: {');
      expect(accountActionSrc).toContain('values: { email: submittedEmail }');
      expect(accountActionSrc).toContain('values: { name: submittedName }');

      const regActionSrc = readWorkspaceFile('src/app/actions/registration-actions.ts');
      expect(regActionSrc).toContain('consentData?: boolean;');
      expect(regActionSrc).toContain('consentImage?: boolean;');

      const regFormSrc = readWorkspaceFile('src/components/events/event-registration-form.tsx');
      expect(regFormSrc).toContain('defaultChecked={Boolean(state?.values?.consentData)}');
      expect(regFormSrc).toContain('defaultChecked={Boolean(state?.values?.consentImage)}');

      const apiFormSrc = readWorkspaceFile('src/components/admin/event-api-sections-form.tsx');
      expect(apiFormSrc).toContain('defaultChecked={draft[info.section]}');
      expect(apiFormSrc).toContain('useUnsavedChanges(');
      expect(apiFormSrc).toContain("pending ? 'Salvando…' : 'Salvar seções'");
    });

    it('ConfirmSubmitButton e fluxos de senha/palestrante sinalizam pending e startNavigationProgress', () => {
      const formRef = createRef<HTMLFormElement>();
      const confirmHtml = renderToStaticMarkup(
        createElement(ConfirmSubmitButton, {
          label: 'Excluir item',
          title: 'Confirmar exclusão?',
          formRef,
          testId: 'confirm-delete',
        }),
      );
      expect(new JSDOM(confirmHtml).window.document.querySelector('[data-testid="confirm-delete"]')).not.toBeNull();

      const dialogSrc = readWorkspaceFile('src/components/ui/dialog.tsx');
      expect(dialogSrc).toContain('const { pending } = useFormStatus();');
      expect(dialogSrc).toContain("pending ? 'Processando…' : label");

      const recoverySrc = readWorkspaceFile('src/components/auth/password-recovery-forms.tsx');
      expect(recoverySrc).toContain("pending ? 'Enviando…' : 'Enviar link de redefinição'");
      expect(recoverySrc).toContain("pending ? 'Salvando…' : 'Definir nova senha'");

      const portalSrc = readWorkspaceFile('src/components/speakers/portal-forms.tsx');
      expect(portalSrc).toContain('startNavigationProgress();');
      expect(portalSrc).toContain("pending ? 'Confirmando…' : 'Sou eu — assumir este perfil'");
      expect(portalSrc).toContain("pending ? 'Verificando…' : 'Usar código'");
    });
  });

  describe('Bloco B · Proteção de Rascunho e Acessibilidade do MobileNav', () => {
    it('AuthorEditor e SubmissionUploader ativam useUnsavedChanges e travam seleção durante upload', () => {
      const authorHtml = renderToStaticMarkup(
        createElement(AuthorEditor, {
          tenantSlug: 'demo',
          submissionId: 'sub-1',
          authors: [
            {
              userId: null,
              name: 'Autor Um',
              email: 'a@example.test',
              institution: 'UFBA',
              orcidId: null,
              isCorresponding: true,
            },
          ],
          action: async () => ({ ok: true }),
          editable: true,
        }),
      );
      expect(new JSDOM(authorHtml).window.document.querySelector('[data-testid="author-editor"]')).not.toBeNull();

      const uploaderHtml = renderToStaticMarkup(
        createElement(SubmissionUploader, {
          tenantSlug: 'demo',
          submissionId: 'sub-1',
          kind: 'BLIND_PDF',
          requestUploadAction: async () => ({ ok: true }),
          confirmUploadAction: async () => ({ ok: true }),
          existing: null,
        }),
      );
      expect(new JSDOM(uploaderHtml).window.document.querySelector('input[type="file"]')).not.toBeNull();

      const authorSrc = readWorkspaceFile('src/components/review/author-editor.tsx');
      expect(authorSrc).toContain('useUnsavedChanges(');
      expect(authorSrc).toContain('serializeAuthors(authors) !== savedSnapshot');

      const uploaderSrc = readWorkspaceFile('src/components/review/submission-uploader.tsx');
      expect(uploaderSrc).toContain('useUnsavedChanges(');
      expect(uploaderSrc).toContain('disabled={isBusy}');
    });

    it('MobileNav implementa role="dialog", aria-modal, focus trap, inert, retorno de foco e fechamento por rota', () => {
      const mobileHtml = renderToStaticMarkup(
        createElement(MobileNav, {
          nav: createElement('a', { href: '/t/demo/dashboard' }, 'Painel'),
          account: createElement('span', null, 'Conta'),
          brandLabel: 'Koveno',
        }),
      );
      const mobileBtn = new JSDOM(mobileHtml).window.document.querySelector(
        '[data-testid="open-navigation"]',
      );
      expect(mobileBtn?.getAttribute('aria-controls')).toBe('mobile-navigation-drawer');

      const mobileSrc = readWorkspaceFile('src/components/shell/mobile-nav.tsx');
      expect(mobileSrc).toContain('role="dialog"');
      expect(mobileSrc).toContain('aria-modal={open || undefined}');
      expect(mobileSrc).toContain('child.inert = true');
      expect(mobileSrc).toContain("event.key === 'Tab'");
      expect(mobileSrc).toContain("event.key === 'Escape'");
      expect(mobileSrc).toContain('openButtonRef.current?.focus()');
      expect(mobileSrc).toContain('if (pathname !== prevPathname)');
    });
  });

  describe('Bloco C · Transição App Router sem violar ADR-410 e GetSearchForm progressivo', () => {
    it('preserva feedback instantâneo via RouteProgress/RouteLoadingSkeleton sem loading.tsx em layouts pais', () => {
      expect(existsSync(join(process.cwd(), 'src/app/t/[tenantSlug]/(app)/loading.tsx'))).toBe(false);
      expect(existsSync(join(process.cwd(), 'src/app/superadmin/loading.tsx'))).toBe(false);

      const tenantLoadingHtml = renderToStaticMarkup(createElement(RouteLoadingSkeleton, { variant: 'tenant' }));
      const tenantDoc = new JSDOM(tenantLoadingHtml).window.document;
      const tenantRoot = tenantDoc.querySelector('[data-testid="app-route-skeleton"]');
      expect(tenantRoot?.getAttribute('role')).toBe('status');
      expect(tenantRoot?.getAttribute('aria-busy')).toBe('true');

      const superLoadingHtml = renderToStaticMarkup(createElement(RouteProgress, { variant: 'platform', forceVisible: true }));
      const superDoc = new JSDOM(superLoadingHtml).window.document;
      const superRoot = superDoc.querySelector('[data-testid="platform-route-loading"]');
      expect(superRoot?.getAttribute('role')).toBe('status');
      expect(superRoot?.getAttribute('aria-busy')).toBe('true');
    });

    it('GetSearchForm renderiza <form method="get"> para No-JS e usa startNavigationProgress + transition nas páginas alvo', () => {
      const searchHtml = renderToStaticMarkup(
        createElement(
          GetSearchForm,
          { action: '/eventos', omitEmpty: true },
          createElement('input', { name: 'q', defaultValue: 'simposio' }),
        ),
      );
      const form = new JSDOM(searchHtml).window.document.querySelector('form');
      expect(form?.getAttribute('method')).toBe('get');
      expect(form?.getAttribute('action')).toBe('/eventos');

      const getFormSrc = readWorkspaceFile('src/components/ui/get-search-form.tsx');
      expect(getFormSrc).toContain('startNavigationProgress()');
      expect(getFormSrc).toContain('startTransition(() => {');
      expect(getFormSrc).toContain('router.push(targetUrl)');

      for (const pageFile of [
        'src/app/page.tsx',
        'src/app/(public)/eventos/page.tsx',
        'src/app/superadmin/tenants/page.tsx',
        'src/app/t/[tenantSlug]/(app)/administracao/cartas/page.tsx',
        'src/app/t/[tenantSlug]/(app)/administracao/certificados/page.tsx',
        'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/confirmacoes/page.tsx',
        'src/app/t/[tenantSlug]/(app)/credenciamento/crachas/page.tsx',
      ]) {
        const content = readWorkspaceFile(pageFile);
        expect(content, `${pageFile} deve usar GetSearchForm`).toContain('<GetSearchForm');
      }
    });
  });
});

