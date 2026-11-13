// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

const routerPushMock = vi.fn();
const routerRefreshMock = vi.fn();
const routerBackMock = vi.fn();
const routerReplaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
    refresh: routerRefreshMock,
    back: routerBackMock,
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/t/demo/dashboard',
  unstable_rethrow: vi.fn(),
}));

vi.mock('@/app/actions/auth-actions', () => ({
  signOutAction: vi.fn(),
  requestPasswordResetAction: vi.fn(),
  resetPasswordAction: vi.fn(),
  verifyTwoFactorChallengeAction: vi.fn(),
}));

vi.mock('@/app/actions/account-actions', () => ({
  requestEmailChangeAction: vi.fn(),
  updateAccountProfileAction: vi.fn(),
  changeAccountPasswordAction: vi.fn(),
  setAccountPasswordAction: vi.fn(),
  startTwoFactorAction: vi.fn(),
  confirmTwoFactorAction: vi.fn(),
  disableTwoFactorAction: vi.fn(),
  regenerateBackupCodesAction: vi.fn(),
}));

vi.mock('@/app/actions/registration-actions', () => ({
  completeEventRegistrationDataAction: vi.fn(),
}));

vi.mock('@/app/actions/platform-actions', () => ({
  updateLeadStatusAction: vi.fn(),
}));

vi.mock('@/app/actions/communication-actions', () => ({
  acceptInvitationAction: vi.fn(),
}));

vi.mock('@/app/actions/sponsor-actions', () => ({
  submitSponsorScanAction: vi.fn(),
}));

vi.mock('@/app/actions/sponsor-qr-actions', () => ({
  createSponsorQrAction: vi.fn(),
}));

import { AdminForm } from '@/components/admin/admin-form';
import { RequestResetForm, TwoFactorChallengeForm } from '@/components/auth/password-recovery-forms';
import { CertificatePolicyPanel } from '@/components/certificates/certificate-policy-panel';
import { AcceptInvitationForm } from '@/components/communication/accept-invitation-form';
import { EventRegistrationDataForm } from '@/components/events/event-registration-data-form';
import { LeadStatusForm } from '@/components/platform/lead-status-form';
import { CreateSubmissionForm } from '@/components/review/create-submission-form';
import { FormStatusButton, GetSearchForm } from '@/components/ui';
import { KOVENO_UNSAVED_LEAVE_REQUEST_EVENT } from '@/hooks/use-unsaved-changes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function readWorkspaceFile(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n');
}

describe('FASE 109 · Fechamento de UX, React 19 & App Router', () => {
  describe('Bloco A · Estado React 19, AdminForm pós-salvamento e seleção acoplada', () => {
    it('AdminForm mantém proteção de alterações não salvas em uma 2ª edição após salvamento bem-sucedido', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const link = document.createElement('a');
      link.href = '/t/demo/dashboard';
      link.textContent = 'Voltar';
      document.body.appendChild(link);

      const leaveEvents: CustomEvent[] = [];
      const onLeave = (event: Event) => {
        leaveEvents.push(event as CustomEvent);
      };
      window.addEventListener(KOVENO_UNSAVED_LEAVE_REQUEST_EVENT, onLeave);

      const action = vi.fn(async () => ({ ok: true, message: 'Salvo com sucesso.' }));
      const root = createRoot(container);

      try {
        await act(async () => {
          root.render(
            createElement(
              AdminForm,
              {
                action,
                submitLabel: 'Salvar',
                testId: 'admin-form-f109',
                warnUnsaved: true,
              },
              createElement('input', {
                name: 'summary',
                defaultValue: 'Inicial',
                'data-testid': 'summary-input',
              }),
            ),
          );
        });

        const input = container.querySelector('input[name="summary"]') as HTMLInputElement;
        const form = container.querySelector('form') as HTMLFormElement;

        // 1ª edição + salvamento bem-sucedido
        await act(async () => {
          input.value = 'Editado 1';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });

        await act(async () => {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(action).toHaveBeenCalledTimes(1);

        // Logo após salvar, navegar é seguro (não sujo)
        await act(async () => {
          link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        expect(leaveEvents).toHaveLength(0);

        // 2ª edição após state.ok === true precisa rearmar o guardião
        await act(async () => {
          input.value = 'Editado 2';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });

        await act(async () => {
          link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        expect(leaveEvents).toHaveLength(1);
      } finally {
        window.removeEventListener(KOVENO_UNSAVED_LEAVE_REQUEST_EVENT, onLeave);
        await act(async () => {
          root.unmount();
        });
        container.remove();
        link.remove();
      }
    });

    it('CreateSubmissionForm filtra trilhas pelo evento selecionado e reajusta trackId ao trocar de evento', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      const events = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Congresso Alfa',
          tracks: [
            { id: 'aaaa1111-1111-4111-8111-111111111111', name: 'Trilha Alfa', requiresBlindReview: true },
          ],
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Simpósio Beta',
          tracks: [
            { id: 'bbbb2222-2222-4222-8222-222222222222', name: 'Trilha Beta', requiresBlindReview: false },
          ],
        },
      ];

      try {
        await act(async () => {
          root.render(
            createElement(CreateSubmissionForm, {
              tenantSlug: 'demo',
              events,
              action: async () => ({ ok: false }),
            }),
          );
        });

        const eventSelect = container.querySelector('select[name="eventId"]') as HTMLSelectElement;
        const trackSelect = container.querySelector('select[name="trackId"]') as HTMLSelectElement;

        expect(Array.from(trackSelect.options).map((opt) => opt.value)).toEqual([
          'aaaa1111-1111-4111-8111-111111111111',
        ]);
        expect(trackSelect.value).toBe('aaaa1111-1111-4111-8111-111111111111');

        await act(async () => {
          eventSelect.value = '22222222-2222-4222-8222-222222222222';
          eventSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(Array.from(trackSelect.options).map((opt) => opt.value)).toEqual([
          'bbbb2222-2222-4222-8222-222222222222',
        ]);
        expect(trackSelect.value).toBe('bbbb2222-2222-4222-8222-222222222222');
      } finally {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      }
    });

    it('preserva values pós-erro em RequestResetForm, ClaimInviteForm, EventRegistrationDataForm, CertificatePolicyPanel e LeadStatusForm', () => {
      const regDataSrc = readWorkspaceFile('src/components/events/event-registration-data-form.tsx');
      expect(regDataSrc).toContain('defaultChecked={Boolean(state?.values?.consentData)}');
      expect(regDataSrc).toContain('defaultChecked={Boolean(state?.values?.consentImage)}');

      const resetSrc = readWorkspaceFile('src/components/auth/password-recovery-forms.tsx');
      expect(resetSrc).toContain("defaultValue={state?.values?.email ?? ''}");

      const resetHtml = renderToStaticMarkup(
        createElement(RequestResetForm, { action: async () => ({ ok: false }) }),
      );
      expect(new JSDOM(resetHtml).window.document.querySelector('[data-testid="reset-email"]')).not.toBeNull();

      const regHtml = renderToStaticMarkup(
        createElement(EventRegistrationDataForm, {
          tenantSlug: 'demo',
          eventSlug: 'evt',
          fields: [],
          respostas: {},
          accessibilityNotes: null,
        }),
      );
      expect(new JSDOM(regHtml).window.document.querySelector('input[name="consentData"]')).not.toBeNull();

      const policyHtml = renderToStaticMarkup(
        createElement(CertificatePolicyPanel, {
          tenantSlug: 'demo',
          eventId: 'evt-1',
          policy: { minRatio: 0.75, minMinutes: 30, requireCheckOut: true, aggregateBy: 'ACTIVITY' },
          problems: [],
          canManage: true,
          action: async () => ({ ok: false }),
        }),
      );
      expect(
        new JSDOM(policyHtml).window.document.querySelector('[data-testid="certificate-policy-min-ratio"]'),
      ).not.toBeNull();

      const leadHtml = renderToStaticMarkup(
        createElement(LeadStatusForm, {
          leadId: 'lead-1',
          currentStatus: 'NEW',
          currentNotes: 'Nota',
        }),
      );
      expect(
        new JSDOM(leadHtml).window.document.querySelector('[data-testid="lead-status-select-lead-1"]'),
      ).not.toBeNull();

      const portalSrc = readWorkspaceFile('src/components/speakers/portal-forms.tsx');
      expect(portalSrc).toContain('defaultValue={state?.values?.token ?? defaultToken}');

      const speakerActionSrc = readWorkspaceFile('src/app/actions/speaker-actions.ts');
      expect(speakerActionSrc).toContain('values: { token: tokenValue }');

      const certActionSrc = readWorkspaceFile('src/app/actions/certificate-actions.ts');
      expect(certActionSrc).toContain('minRatioPercent: typeof rawRatio');

      const platformActionSrc = readWorkspaceFile('src/app/actions/platform-actions.ts');
      expect(platformActionSrc).toContain('values: submittedValues');

      const dadosPageSrc = readWorkspaceFile(
        'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/dados/page.tsx',
      );
      expect(dadosPageSrc).toContain('warnUnsaved');

      const publicProfilePageSrc = readWorkspaceFile(
        'src/app/t/[tenantSlug]/(app)/meu-perfil-publico/page.tsx',
      );
      expect(publicProfilePageSrc).toContain('warnUnsaved');
    });
  });

  describe('Bloco B · Navegação SPA com GetSearchForm, AppLink e startTransition', () => {
    it('GetSearchForm preserva name/value do botão submitter ao submeter formulários GET com múltiplas ações', async () => {
      routerPushMock.mockClear();
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      try {
        await act(async () => {
          root.render(
            createElement(
              GetSearchForm,
              { action: '/t/demo/administracao/comunicacao', 'data-testid': 'seg-form' },
              createElement('input', { type: 'hidden', name: 'aba', value: 'segmentos' }),
              createElement(
                'button',
                { type: 'submit', name: 'revisar', value: '1', 'data-testid': 'review-btn' },
                'Revisar',
              ),
            ),
          );
        });

        const form = container.querySelector('form') as HTMLFormElement;
        const submitBtn = container.querySelector('button[name="revisar"]') as HTMLButtonElement;

        await act(async () => {
          const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
          Object.defineProperty(submitEvent, 'submitter', { value: submitBtn });
          form.dispatchEvent(submitEvent);
        });

        expect(routerPushMock).toHaveBeenCalledWith(
          '/t/demo/administracao/comunicacao?aba=segmentos&revisar=1',
        );
      } finally {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      }
    });

    it('substitui os formulários GET e links internos remanescentes por GetSearchForm e AppLink', () => {
      for (const file of [
        'src/app/t/[tenantSlug]/(app)/administracao/comunicacao/page.tsx',
        'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/demandas/page.tsx',
        'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/pagina/midia/page.tsx',
        'src/app/t/[tenantSlug]/(app)/meu-cracha/page.tsx',
        'src/app/t/[tenantSlug]/(app)/minha-agenda/page.tsx',
        'src/app/t/[tenantSlug]/(app)/panorama/page.tsx',
        'src/app/validar/lote/page.tsx',
        'src/components/raffles/raffle-history.tsx',
        'src/components/credentials/checkin-filter-bar.tsx',
      ]) {
        const src = readWorkspaceFile(file);
        expect(src, `${file} deve usar GetSearchForm`).toContain('GetSearchForm');
      }

      for (const file of [
        'src/components/account/account-forms.tsx',
        'src/components/admin/sponsor-qr-create-form.tsx',
        'src/components/raffles/raffle-history.tsx',
        'src/components/raffles/raffle-stage.tsx',
      ]) {
        const src = readWorkspaceFile(file);
        expect(src, `${file} deve usar AppLink`).toContain('<AppLink');
      }

      expect(readWorkspaceFile('src/components/speakers/portal-forms.tsx')).toContain(
        'startTransition(() => {\n        startNavigationProgress();',
      );
      expect(readWorkspaceFile('src/components/ui/unsaved-changes-dialog.tsx')).toContain(
        'startTransition(() => {\n          router.push(nextUrl);',
      );
    });
  });

  describe('Bloco C e D · FormStatusButton em formulários Server, rótulos pending e datas sem hydration mismatch', () => {
    it('FormStatusButton preserva <button type="submit"> SSR e substitui botões crus de logout, tema e barra', () => {
      const btnHtml = renderToStaticMarkup(
        createElement(
          FormStatusButton,
          { pendingContent: 'Saindo…', showSpinner: true, 'data-testid': 'logout-btn' },
          'Sair da conta',
        ),
      );
      const btn = new JSDOM(btnHtml).window.document.querySelector('button');
      expect(btn?.getAttribute('type')).toBe('submit');
      expect(btn?.textContent).toBe('Sair da conta');

      for (const file of [
        'src/components/shell/account-block.tsx',
        'src/app/conta/page.tsx',
        'src/app/selecionar-instituicao/page.tsx',
        'src/components/shell/nav-collapse-toggle.tsx',
        'src/components/theme/theme-choice.tsx',
      ]) {
        expect(readWorkspaceFile(file), `${file} deve usar FormStatusButton`).toContain(
          '<FormStatusButton',
        );
      }

      const challengeHtml = renderToStaticMarkup(
        createElement(TwoFactorChallengeForm, { action: async () => ({ ok: false }) }),
      );
      expect(new JSDOM(challengeHtml).window.document.querySelector('[data-testid="submit-challenge"]')).not.toBeNull();
      expect(readWorkspaceFile('src/components/auth/password-recovery-forms.tsx')).toContain(
        "pending ? 'Confirmando…' : 'Confirmar e entrar'",
      );

      const acceptHtml = renderToStaticMarkup(
        createElement(AcceptInvitationForm, { tenantSlug: 'demo', token: 'tok' }),
      );
      expect(new JSDOM(acceptHtml).window.document.querySelector('[data-testid="accept-invitation-submit"]')).not.toBeNull();
      expect(readWorkspaceFile('src/components/communication/accept-invitation-form.tsx')).toContain(
        "pending ? 'Aceitando…' : 'Aceitar convite'",
      );

      expect(readWorkspaceFile('src/components/sponsors/scan-form.tsx')).toContain(
        "pending ? 'Registrando…'",
      );
    });

    it('aplica timeZone explícito em meu-cracha e suppressHydrationWarning nos componentes clientes com toLocale*', () => {
      const meuCrachaSrc = readWorkspaceFile('src/app/t/[tenantSlug]/(app)/meu-cracha/page.tsx');
      expect(meuCrachaSrc).toContain('formatZonedDateTime(event.startsAt, event.timezone)');
      expect(meuCrachaSrc).toContain('timeZone:');

      for (const file of [
        'src/components/credentials/checkin-filter-bar.tsx',
        'src/components/participants/participant-filter-bar.tsx',
        'src/components/raffles/raffle-console.tsx',
        'src/components/raffles/raffle-stage.tsx',
        'src/components/speakers/admin-speaker-panel.tsx',
        'src/components/speakers/portal-forms.tsx',
      ]) {
        expect(readWorkspaceFile(file), `${file} precisa proteger formatação local`).toContain(
          'suppressHydrationWarning',
        );
      }
    });
  });
});

