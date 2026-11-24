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
  const email = uniqueEmail('f123');
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
  'FASE 123 — UX Financeiro: Onboarding, Prevenção Proativa de Glosa, Ciclo PLANNED→COMMITTED→SETTLED e Drill-Down',
  () => {
    test.beforeAll(async ({ playwright }) => {
      const api = await playwright.request.newContext({ baseURL: ORIGEM });
      try {
        const tenant = await createTenant({
          label: 'f123-ux-financas',
          name: 'Universidade Federal F123',
        });
        tenantId = tenant.id;
        tenantSlug = tenant.slug;

        const event = await createEvent({
          tenantId,
          slug: `encontro-fomento-f123-${Date.now().toString(36)}`,
          title: 'Encontro de Inovação e Prestação de Contas',
          status: 'PUBLISHED',
        });
        eventId = event.id;

        const organizer = await cadastrarViaApi(api, 'Coordenador UX Financeiro F123');
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

    test('1. Exibe onboarding inicial, limpa formulários após submit, alerta glosa antes do envio, executa ciclo Empenhar -> Liquidar com NF e filtra por drill-down com WCAG AA', async ({
      page,
    }) => {
      await entrarComo(page, organizerEmail);
      await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/financeiro`);

      // 1. Guia de onboarding visível quando o evento ainda não possui fontes nem lançamentos
      await expect(page.getByTestId('finance-onboarding-guide')).toBeVisible();

      // 2. Cadastra Edital CNPq na rota dedicada /fontes/nova com rubrica restrita a Passagens
      await page.getByTestId('finance-header-new-source').click();
      await expect(page).toHaveURL(/\/financeiro\/fontes\/nova$/);

      await page.getByTestId('finance-source-name').fill('Edital CNPq 09/2026 — Eventos');
      await page.getByTestId('finance-source-process').fill('CNPq 401234/2026-0');
      await page.getByTestId('finance-source-amount').fill('15.000,00');
      await page.getByTestId('finance-source-cat-TRAVEL_AND_PER_DIEM').check();
      await page.getByTestId('finance-source-submit').click();

      await expect(page.getByText('Fonte de recurso cadastrada')).toBeVisible();
      await expect(page.getByTestId('finance-source-name')).toHaveValue('');
      await expect(page.getByTestId('finance-source-amount')).toHaveValue('');

      await page.getByTestId('finance-source-back').click();
      await expect(page.getByTestId('finance-sources-list')).toContainText(
        'Edital CNPq 09/2026 — Eventos',
      );

      // 3. Abre /lancamentos/novo: ao escolher PLANNED, settledOn fica oculto;
      //    ao escolher CATERING na fonte CNPq, exibe aviso preventivo de glosa antes do submit
      await page.getByTestId('finance-header-new-entry').click();
      await expect(page).toHaveURL(/\/financeiro\/lancamentos\/novo$/);

      await page.getByTestId('finance-entry-type').selectOption('EXPENSE');
      await page.getByTestId('finance-entry-status').selectOption('PLANNED');
      await expect(page.getByTestId('finance-entry-settled')).toHaveCount(0);

      await page
        .getByTestId('finance-entry-source')
        .selectOption({ label: 'Edital CNPq 09/2026 — Eventos' });
      await page.getByTestId('finance-entry-category').selectOption('CATERING');
      await page.getByTestId('finance-entry-title').fill('Coffee-break de abertura');
      await page.getByTestId('finance-entry-amount').fill('4.000,00');

      await expect(page.getByTestId('finance-entry-compliance-preview')).toContainText(
        'Saldo projetado do teto após lançamento: R$ 11.000,00',
      );
      await expect(page.getByTestId('finance-entry-compliance-warning')).toContainText(
        'risco de glosa',
      );

      await page.getByTestId('finance-entry-submit').click();

      // Verifica reset automático dos campos do lançamento após salvar
      await expect(page.getByTestId('finance-entry-title')).toHaveValue('');
      await expect(page.getByTestId('finance-entry-amount')).toHaveValue('');

      // 4. Volta ao Livro-razão: verifica badge de glosa na linha, subtotais e transição PLANNED -> COMMITTED -> SETTLED com Nº NF
      await page.getByTestId('finance-entry-back').click();
      await expect(page).toHaveURL(/aba=lancamentos/);

      const ledger = page.getByTestId('finance-entries-ledger');
      await expect(ledger).toContainText('Coffee-break de abertura');
      await expect(ledger).toContainText('Rubrica fora do edital');
      await expect(page.getByTestId('finance-ledger-subtotals')).toContainText('R$ 4.000,00');

      await ledger.getByRole('button', { name: 'Empenhar' }).click();
      await expect(ledger).toContainText('Empenhado / Contratado');

      await ledger
        .getByPlaceholder('Nº NF-e / Recibo')
        .fill('NF-e 2026-555');
      await ledger.getByRole('button', { name: 'Marcar como pago' }).click();

      await expect(ledger).toContainText('Comprovante/NF/NE: NF-e 2026-555');
      await expect(page.getByTestId('finance-kpi-expense')).toContainText('R$ 4.000,00');

      // 5. Na Visão geral, clica no link de drill-down do gráfico de rubricas para filtrar o livro-razão
      await page.getByTestId('finance-tab-resumo').click();
      await page.getByTestId('finance-chart-filter-category-CATERING').click();
      await expect(page).toHaveURL(/aba=lancamentos&categoria=CATERING/);
      await expect(page.getByTestId('finance-ledger-export-scope')).toHaveText(
        'Exportar o recorte atual:',
      );

      // 6. Portão WCAG AA (axe-core)
      const a11y = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(a11y.violations).toEqual([]);
    });
  },
);
