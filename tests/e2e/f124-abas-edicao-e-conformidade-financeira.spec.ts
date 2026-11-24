import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  signOut,
  uniqueEmail,
} from './helpers';

const ORIGEM = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const SENHA = 'Koveno#2026';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let organizerEmail: string;

async function cadastrarViaApi(
  api: APIRequestContext,
  nome: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f124');
  const res = await api.post('/api/auth/sign-up/email', {
    headers: { origin: ORIGEM },
    data: { name: nome, email, password: SENHA },
  });
  expect(res.ok(), `sign-up ${email} respondeu ${res.status()}`).toBe(true);

  const user = await e2eDb.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  return { id: user.id, email };
}

async function entrarComo(page: Page, email: string): Promise<void> {
  await signOut(page, ORIGEM);
  const res = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: ORIGEM },
    data: { email, password: SENHA },
  });
  expect(res.ok(), `sign-in ${email} respondeu ${res.status()}`).toBe(true);
}

test.describe.serial(
  'FASE 124 — Abas por Intenção, Edição/Reatribuição de Glosa e Checklist de Conformidade',
  () => {
    test.beforeAll(async ({ playwright }) => {
      const api = await playwright.request.newContext({ baseURL: ORIGEM });
      try {
        const tenant = await createTenant({
          label: 'f124-financas-abas',
          name: 'Universidade Federal F124',
        });
        tenantId = tenant.id;
        tenantSlug = tenant.slug;

        const event = await createEvent({
          tenantId,
          slug: `congresso-f124-${Date.now().toString(36)}`,
          title: 'Congresso de Prestação de Contas F124',
          status: 'PUBLISHED',
        });
        eventId = event.id;

        const organizer = await cadastrarViaApi(api, 'Coordenador Financeiro F124');
        organizerEmail = organizer.email;
        await linkUser({ userId: organizer.id, tenantId, kind: 'MEMBER' });
        await grantRole({ userId: organizer.id, tenantId, role: 'ORGANIZER' });
      } finally {
        await api.dispose();
      }
    });

    test.afterAll(async () => {
      await cleanupRun();
      await e2eDb.$disconnect();
    });

    test('1. Separa fluxo em abas, detecta glosa no checklist, permite editar fonte (aditivo) e reatribuir lançamento para zerar pendência com WCAG AA', async ({
      page,
    }) => {
      await entrarComo(page, organizerEmail);
      await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/financeiro`);

      // 1. Cria 2 fontes em /fontes/nova: uma restrita a Passagens e uma livre
      await page.getByTestId('finance-header-new-source').click();
      await page.getByTestId('finance-source-name').fill('Edital FAPEG Restrito');
      await page.getByTestId('finance-source-amount').fill('10.000,00');
      await page.getByTestId('finance-source-cat-TRAVEL_AND_PER_DIEM').check();
      await page.getByTestId('finance-source-submit').click();
      await expect(page.getByText('Fonte de recurso cadastrada')).toBeVisible();

      await page.getByTestId('finance-source-name').fill('Patrocínio Livre');
      await page.getByTestId('finance-source-kind').selectOption('SPONSORSHIP');
      await page.getByTestId('finance-source-amount').fill('5.000,00');
      await page.getByTestId('finance-source-submit').click();
      await expect(page.getByText('Fonte de recurso cadastrada')).toBeVisible();

      // 2. Vai para Fontes e editais e edita o teto do Patrocínio Livre (aditivo -> R$ 8.000,00)
      await page.getByTestId('finance-source-back').click();
      await expect(page).toHaveURL(/aba=fontes/);
      await page.locator('[data-testid^="finance-source-edit-"]').nth(1).click();
      await expect(page).toHaveURL(/\/financeiro\/fontes\/.*\/editar$/);
      await page.getByTestId('finance-source-amount').fill('8.000,00');
      await page.getByTestId('finance-source-submit').click();
      await expect(page.getByText('Fonte de recurso atualizada')).toBeVisible();
      await page.getByTestId('finance-source-back').click();
      await expect(page.getByTestId('finance-kpi-approved')).toContainText('R$ 18.000,00');

      // 3. Cria despesa CATERING na fonte restrita (gerando glosa proposital) sem NF
      await page.getByTestId('finance-header-new-entry').click();
      await page
        .getByTestId('finance-entry-source')
        .selectOption({ label: 'Edital FAPEG Restrito' });
      await page.getByTestId('finance-entry-category').selectOption('CATERING');
      await page.getByTestId('finance-entry-title').fill('Lanche lançado na fonte errada');
      await page.getByTestId('finance-entry-amount').fill('1.200,00');
      await page.getByTestId('finance-entry-submit').click();
      await expect(page.getByText('Lançamento financeiro registrado')).toBeVisible();

      // 4. Na Visão geral, o checklist aponta a glosa e o botão "Revisar ->" leva direto ao Livro-razão filtrado
      await page.getByTestId('finance-entry-back').click();
      await page.getByTestId('finance-tab-resumo').click();

      await expect(page.getByTestId('finance-compliance-checklist')).toContainText(
        '1 despesa(s) fora das rubricas do edital',
      );
      await page.getByTestId('finance-compliance-link-GLOSA').click();
      await expect(page).toHaveURL(/aba=lancamentos&conformidade=GLOSA/);

      // 5. Edita o lançamento em /lancamentos/[entryId]/editar, reatribuindo para Patrocínio Livre e anexando NF
      await page.locator('[data-testid^="finance-entry-edit-"]').first().click();
      await expect(page).toHaveURL(/\/financeiro\/lancamentos\/.*\/editar$/);
      await page.getByTestId('finance-entry-source').selectOption({ label: 'Patrocínio Livre' });
      await page.getByTestId('finance-entry-document').fill('NF-e 404');
      await expect(page.getByTestId('finance-entry-compliance-warning')).toHaveCount(0);
      await page.getByTestId('finance-entry-submit').click();
      await expect(page.getByText('Lançamento financeiro atualizado')).toBeVisible();

      // 6. Confere que na Visão geral o checklist zerou as pendências e valida WCAG AA
      await page.getByTestId('finance-entry-back').click();
      await page.getByTestId('finance-tab-resumo').click();
      await expect(page.getByTestId('finance-compliance-checklist')).toContainText(
        'Rubricas 100% compatíveis com os editais',
      );
      await expect(page.getByTestId('finance-compliance-checklist')).toContainText(
        'Todos os itens pagos/recebidos possuem Nº NF/OB',
      );

      const a11y = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(a11y.violations).toEqual([]);
    });
  },
);
