import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/t/demo/participantes',
  unstable_rethrow: vi.fn(),
}));

vi.mock('@/app/actions/registration-actions', () => ({
  acceptPromotionAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  registerForEventAction: vi.fn(),
}));

import { AdminForm } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { AcceptPromotionButton } from '@/components/events/accept-promotion-button';
import { CancelRegistrationButton } from '@/components/events/cancel-registration-button';
import { MessageComposer } from '@/components/participants/message-composer';
import { ParticipantFilterBar } from '@/components/participants/participant-filter-bar';
import { DeleteDraftButton } from '@/components/review/delete-draft-button';
import { WithdrawSubmissionButton } from '@/components/review/withdraw-submission-button';

function readWorkspaceFile(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n');
}

function collectClientFiles(dir: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectClientFiles(full));
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      const content = readFileSync(full, 'utf8').trimStart();
      if (content.startsWith("'use client'") || content.startsWith('"use client"')) {
        results.push(relative(process.cwd(), full).replace(/\\/g, '/'));
      }
    }
  }

  return results;
}

describe('FASE 107 · Preservação de Estado, Pending em Diálogos, AppLink Canônico, Popstate e Filtros', () => {
  describe('ADR-439 · Preservação de Estado React 19 em AdminForm e Formulários Críticos', () => {
    it('AdminForm renderiza botão de envio sem erro e preserva campos no erro { ok: false }', () => {
      const html = renderToStaticMarkup(
        createElement(
          AdminForm,
          {
            action: async () => ({ ok: true, message: 'Salvo' }),
            submitLabel: 'Salvar chamada',
            testId: 'create-call',
            backHref: '/t/demo/administracao',
            backLabel: 'Voltar',
          },
          createElement('input', { name: 'title', defaultValue: '' }),
        ),
      );

      const dom = new JSDOM(html).window.document;
      expect(dom.querySelector('[data-testid="create-call"]')).not.toBeNull();
      expect(dom.querySelector('[data-testid="admin-submit"]')?.textContent).toContain(
        'Salvar chamada',
      );

      const adminFormSrc = readWorkspaceFile('src/components/admin/admin-form.tsx');
      expect(adminFormSrc).toContain('event.preventDefault()');
      expect(adminFormSrc).toContain('startTransition(() => {');
      expect(adminFormSrc).toContain('if (state.ok) {');
      expect(adminFormSrc).toContain('formRef.current?.reset();');
      expect(adminFormSrc).toContain('pendingOverride={actionPending || isTransitionPending}');
      expect(adminFormSrc).toContain('useUnsavedChanges(');
      expect(adminFormSrc).toContain('<AppLink');
      expect(adminFormSrc).not.toMatch(/from\s+['"]next\/link['"]/);
    });

    it('MessageComposer controla subject e body para preservar texto quando a action recusa', () => {
      const html = renderToStaticMarkup(
        createElement(MessageComposer, {
          tenantSlug: 'demo',
          userIds: ['00000000-0000-0000-0000-000000000001'],
          action: async () => ({ ok: false, code: 'INVALID_SUBJECT', message: 'Assunto curto' }),
          label: 'Enviar recado',
        }),
      );

      const dom = new JSDOM(html).window.document;
      expect(dom.querySelector('[data-testid="message-subject"]')).not.toBeNull();
      expect(dom.querySelector('[data-testid="message-body"]')).not.toBeNull();

      const composerSrc = readWorkspaceFile('src/components/participants/message-composer.tsx');
      expect(composerSrc).toContain("const [subject, setSubject] = useState('')");
      expect(composerSrc).toContain("const [body, setBody] = useState('')");
      expect(composerSrc).toContain('useActionState<ParticipantActionState | null, FormData>(action, null)');
      expect(composerSrc).toContain('useUnsavedChanges(isDirty)');
    });

    it('formulários de palestrante, aceite, inscrição, carta e auth mantêm campos controlados em estado', () => {
      const portalSrc = readWorkspaceFile('src/components/speakers/portal-forms.tsx');
      expect(portalSrc).toContain('setLastSaved(');
      expect(portalSrc).toContain('useUnsavedChanges(isDirty)');
      expect(portalSrc).toContain("'Salvando…'");
      expect(portalSrc).not.toMatch(/useActionState[^;]*async\s*\(/);

      const adminFormSrc = readWorkspaceFile('src/components/admin/admin-form.tsx');
      expect(adminFormSrc).not.toMatch(/useActionState[^;]*async\s*\(/);

      const acceptanceSrc = readWorkspaceFile(
        'src/components/proposals/proposal-acceptance-panel.tsx',
      );
      expect(acceptanceSrc).toContain('useUnsavedChanges(isDirty)');
      expect(acceptanceSrc).toContain('setSelectedActivityType');
      expect(acceptanceSrc).toContain('setStartsAt');

      const registrationSrc = readWorkspaceFile('src/components/events/registration-form.tsx');
      expect(registrationSrc).toContain('setAccessibilityNotes');
      expect(registrationSrc).toContain('setConsentData');
      expect(registrationSrc).toContain('setConsentImage');

      const shareSrc = readWorkspaceFile('src/components/gamification/share-card-panel.tsx');
      expect(shareSrc).toContain('setValidity');
      expect(shareSrc).toContain('setCustomDay');

      const authSrc = readWorkspaceFile('src/components/auth/auth-form.tsx');
      expect(authSrc).toMatch(/const \[name, setName\] = useState\(['"]['"]\)/);
      expect(authSrc).toMatch(/const \[email, setEmail\] = useState\(['"]['"]\)/);
    });
  });

  describe('ADR-440 · Proteção de Popstate (Voltar do Navegador) em useUnsavedChanges', () => {
    it('hook e modal suportam modo history-back com allowNextPopstate antes do history.back()', () => {
      const hookSrc = readWorkspaceFile('src/hooks/use-unsaved-changes.ts');
      const dialogSrc = readWorkspaceFile('src/components/ui/unsaved-changes-dialog.tsx');

      expect(hookSrc).toContain("mode?: 'navigate' | 'history-back'");
      expect(hookSrc).toContain('export function allowNextPopstate()');
      expect(hookSrc).toContain('ensurePopstateInterceptor();');
      expect(hookSrc).toMatch(/window\.addEventListener\(\s*['"]popstate['"]/);
      expect(hookSrc).toContain('e.stopImmediatePropagation()');
      expect(hookSrc).toContain("mode: 'history-back'");

      expect(dialogSrc).toContain("mode === 'history-back'");
      expect(dialogSrc).toContain('allowNextPopstate()');
      expect(dialogSrc).toContain('window.history.back()');
    });
  });

  describe('ADR-441 · Pending em Botões/Diálogos, Migração AppLink Canônico e Paridade ParticipantFilterBar', () => {
    it('botões críticos e diálogos de confirmação bloqueiam clique duplo via pending', () => {
      const acceptHtml = renderToStaticMarkup(
        createElement(AcceptPromotionButton, {
          tenantSlug: 'demo',
          eventSlug: 'ev',
          registrationId: '00000000-0000-0000-0000-000000000001',
          deadlineLabel: 'Amanhã 23:59',
        }),
      );
      expect(acceptHtml).toContain('Aceitar a vaga');

      const deleteHtml = renderToStaticMarkup(
        createElement(DeleteDraftButton, {
          tenantSlug: 'demo',
          submissionId: '00000000-0000-0000-0000-000000000001',
          title: 'Rascunho teste',
          action: async () => ({ ok: true }),
        }),
      );
      expect(deleteHtml).toContain('Excluir rascunho');

      const withdrawHtml = renderToStaticMarkup(
        createElement(WithdrawSubmissionButton, {
          tenantSlug: 'demo',
          submissionId: '00000000-0000-0000-0000-000000000001',
          title: 'Artigo teste',
          action: async () => ({ ok: true }),
        }),
      );
      expect(withdrawHtml).toContain('Retirar submissão');

      const cancelHtml = renderToStaticMarkup(
        createElement(CancelRegistrationButton, {
          tenantSlug: 'demo',
          eventSlug: 'ev',
          registrationId: '00000000-0000-0000-0000-000000000001',
        }),
      );
      expect(cancelHtml).toContain('data-testid="cancel-registration-open"');

      const inlineHtml = renderToStaticMarkup(
        createElement(InlineActionForm, {
          action: async () => ({ ok: true }),
          submitLabel: 'Remover item',
          testId: 'inline-test',
          confirm: {
            title: 'Confirmar?',
            description: 'Remover item da lista.',
            confirmLabel: 'Remover',
          },
        }),
      );
      expect(inlineHtml).toContain('Remover item');

      expect(readWorkspaceFile('src/components/events/accept-promotion-button.tsx')).toContain(
        'Aceitando…',
      );
      expect(readWorkspaceFile('src/components/review/delete-draft-button.tsx')).toContain(
        'Excluindo…',
      );
      expect(readWorkspaceFile('src/components/review/withdraw-submission-button.tsx')).toContain(
        'Retirando…',
      );
      expect(readWorkspaceFile('src/components/events/cancel-registration-button.tsx')).toContain(
        'Cancelando…',
      );
      expect(readWorkspaceFile('src/components/admin/inline-action-form.tsx')).toContain(
        'disabled={pending}',
      );
    });

    it('nenhum componente cliente além de AppLink importa next/link diretamente (catraca)', () => {
      const clientFiles = collectClientFiles(join(process.cwd(), 'src'));
      const offenders = clientFiles.filter((relPath) => {
        if (relPath === 'src/components/ui/app-link.tsx') return false;
        const src = readWorkspaceFile(relPath);
        return /from\s+['"]next\/link['"]/.test(src);
      });

      expect(offenders).toEqual([]);
    });

    it('ParticipantFilterBar nasce com aria-live vazio, guarda isContentEditable e limpa debounce no Escape/unmount', () => {
      const html = renderToStaticMarkup(
        createElement(ParticipantFilterBar, {
          tenantSlug: 'demo',
          events: [
            {
              id: '00000000-0000-0000-0000-000000000001',
              title: 'Simpósio',
              startsAt: new Date('2026-08-01T10:00:00Z'),
            },
          ],
          initialBusca: '',
        }),
      );

      const dom = new JSDOM(html).window.document;
      const live = dom.querySelector('[data-testid="participant-filter-live"]');
      expect(live).not.toBeNull();
      expect(live?.getAttribute('aria-live')).toBe('polite');
      expect(live?.textContent).toBe('');

      const filterSrc = readWorkspaceFile(
        'src/components/participants/participant-filter-bar.tsx',
      );
      expect(filterSrc).toContain('isContentEditable');
      expect(filterSrc).toContain('clearTimeout(debounceTimerRef.current)');
      expect(filterSrc).toContain('latestFiltersRef.current');
      expect(filterSrc).toContain("e.key === 'Escape'");
      expect(filterSrc).toContain('inputRef.current?.blur()');
    });
  });
});
