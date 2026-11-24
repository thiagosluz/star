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
  const email = uniqueEmail('f122');
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
  'FASE 122 — Gestão Financeira, Editais de Fomento (FAPEG/FUNAPE/UF/IF), Patrocínio e Prestação de Contas',
  () => {
    test.beforeAll(async ({ playwright }) => {
      const api = await playwright.request.newContext({ baseURL: ORIGEM });
      try {
        const tenant = await createTenant({
          label: 'f122-financas',
          name: 'Universidade Federal F122',
        });
        tenantId = tenant.id;
        tenantSlug = tenant.slug;

        const event = await createEvent({
          tenantId,
          slug: `simposio-fomento-${Date.now().toString(36)}`,
          title: 'Simpósio Nacional de Pesquisa e Inovação',
          status: 'PUBLISHED',
        });
        eventId = event.id;

        const organizer = await cadastrarViaApi(api, 'Coordenador Financeiro F122');
        organizerEmail = organizer.email;
        await linkUser({ userId: organizer.id, tenantId, kind: 'MEMBER' });
        await grantRole({ userId: organizer.id, tenantId, role: 'ORGANIZER' });

        await e2eDb.sponsor.create({
          data: {
            tenantId,
            eventId,
            name: 'FUNAPE / Apoio Institucional',
            slug: `funape-apoio-${Date.now().toString(36)}`,
            isActive: true,
            contractValueCents: 1_000_000, // R$ 10.000,00
            taxId: '00.111.222/0001-33',
          },
        });
      } finally {
        await api.dispose();
      }
    });

    test.afterAll(async () => {
      await cleanupRun();
      await e2eDb.$disconnect();
    });

    test('1. Raiz do evento exibe cartão Finanças e fomento; tela cadastra edital FAPEG, importa patrocínio, lança entradas/saídas, renderiza gráficos SVG, valida WCAG AA e exporta CSVs', async ({
      page,
    }) => {
      await entrarComo(page, organizerEmail);
      await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}`);

      const financeCard = page.getByTestId('event-area-financeiro');
      await expect(financeCard).toBeVisible();
      await expect(page.getByTestId('event-area-metric-financeiro')).toHaveText(
        'nenhum lançamento financeiro',
      );

      await financeCard.click();
      await expect(page).toHaveURL(
        new RegExp(`/t/${tenantSlug}/administracao/eventos/${eventId}/financeiro$`),
      );

      // 1. Vai para a aba Fontes e editais e importa contrato de patrocínio ativo em 1 clique
      await page.getByTestId('finance-tab-fontes').click();
      await expect(page).toHaveURL(/aba=fontes/);

      await expect(page.getByTestId('finance-sponsor-import-banner')).toContainText(
        'FUNAPE / Apoio Institucional (R$ 10.000,00)',
      );
      await page
        .getByTestId('finance-import-sponsors-form')
        .getByTestId('inline-submit')
        .click();

      await expect(page.getByTestId('finance-kpi-approved')).toContainText('R$ 10.000,00');

      // 2. Cadastra Edital FAPEG na rota dedicada /fontes/nova com rubrica carimbada
      await page.getByTestId('finance-btn-new-source').click();
      await expect(page).toHaveURL(/\/financeiro\/fontes\/nova$/);

      await page
        .getByTestId('finance-source-name')
        .fill('Edital FAPEG 04/2026 — Auxílio a Eventos');
      await page.getByTestId('finance-source-kind').selectOption('PUBLIC_GRANT');
      await page.getByTestId('finance-source-process').fill('SEI 23070.055444/2026-10');
      await page.getByTestId('finance-source-amount').fill('25.000,00');
      await page.getByTestId('finance-source-cat-TRAVEL_AND_PER_DIEM').check();
      await page.getByTestId('finance-source-submit').click();

      await expect(page.getByText('Fonte de recurso cadastrada')).toBeVisible();
      await page.getByTestId('finance-source-back').click();

      await expect(page.getByTestId('finance-sources-list')).toContainText(
        'Edital FAPEG 04/2026 — Auxílio a Eventos',
      );
      await expect(page.getByTestId('finance-kpi-approved')).toContainText('R$ 35.000,00');

      // 3. Registra Entrada do repasse FAPEG (R$ 20.000,00) na rota dedicada /lancamentos/novo
      await page.getByTestId('finance-header-new-entry').click();
      await expect(page).toHaveURL(/\/financeiro\/lancamentos\/novo$/);

      await page.getByTestId('finance-entry-type').selectOption('INCOME');
      await page.getByTestId('finance-entry-status').selectOption('SETTLED');
      await page
        .getByTestId('finance-entry-source')
        .selectOption({ label: 'Edital FAPEG 04/2026 — Auxílio a Eventos' });
      await page.getByTestId('finance-entry-category').selectOption('GRANT_DISBURSEMENT');
      await page.getByTestId('finance-entry-title').fill('Repasse 1ª parcela FAPEG');
      await page.getByTestId('finance-entry-amount').fill('20.000,00');
      await page.getByTestId('finance-entry-counterparty').fill('FAPEG');
      await page.getByTestId('finance-entry-document').fill('OB-2026-778');
      await page.getByTestId('finance-entry-submit').click();
      await expect(page.getByText('Lançamento financeiro registrado')).toBeVisible();

      // 4. Registra Saída de Passagens Aéreas (R$ 5.500,00 pagos) na mesma tela em lote
      await page.getByTestId('finance-entry-type').selectOption('EXPENSE');
      await page.getByTestId('finance-entry-status').selectOption('SETTLED');
      await page
        .getByTestId('finance-entry-source')
        .selectOption({ label: 'Edital FAPEG 04/2026 — Auxílio a Eventos' });
      await page.getByTestId('finance-entry-category').selectOption('TRAVEL_AND_PER_DIEM');
      await page
        .getByTestId('finance-entry-title')
        .fill('Passagens aéreas palestrantes convidados');
      await page.getByTestId('finance-entry-amount').fill('5.500,00');
      await page.getByTestId('finance-entry-counterparty').fill('Agência Voar');
      await page.getByTestId('finance-entry-document').fill('NF-e 00912');
      await page.getByTestId('finance-entry-submit').click();
      await expect(page.getByTestId('finance-entry-title')).toHaveValue('');

      // Volta para a Visão geral para conferir KPIs, gráficos SVG e exportação
      await page.getByTestId('finance-entry-back').click();
      await page.getByTestId('finance-tab-resumo').click();

      // Saldo líquido em caixa: 20.000,00 - 5.500,00 = R$ 14.500,00
      await expect(page.getByTestId('finance-kpi-income')).toContainText('R$ 20.000,00');
      await expect(page.getByTestId('finance-kpi-expense')).toContainText('R$ 5.500,00');
      await expect(page.getByTestId('finance-kpi-balance')).toContainText('R$ 14.500,00');

      // 5. Verifica os 3 gráficos SVG renderizados no servidor
      await expect(page.getByTestId('finance-chart-sources').locator('svg').first()).toBeVisible();
      await expect(
        page.getByTestId('finance-chart-categories').locator('svg').first(),
      ).toBeVisible();
      await expect(page.getByTestId('finance-chart-monthly').locator('svg').first()).toBeVisible();

      // 6. Portão de acessibilidade WCAG AA (axe-core)
      const a11y = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(a11y.violations).toEqual([]);

      // 7. Valida as duas exportações CSV (lançamentos e prestação de contas por fonte)
      const exportEntriesUrl = await page
        .getByTestId('finance-export-entries')
        .getAttribute('href');
      expect(exportEntriesUrl).toBeTruthy();

      const entriesCsvRes = await page.request.get(exportEntriesUrl!);
      expect(entriesCsvRes.status()).toBe(200);
      expect(entriesCsvRes.headers()['content-type']).toContain('text/csv');
      const entriesCsvText = await entriesCsvRes.text();
      expect(entriesCsvText).toContain('Passagens aéreas palestrantes convidados');
      expect(entriesCsvText).toContain('NF-e 00912');

      const exportAccUrl = await page
        .getByTestId('finance-export-accountability')
        .getAttribute('href');
      expect(exportAccUrl).toBeTruthy();

      const accCsvRes = await page.request.get(exportAccUrl!);
      expect(accCsvRes.status()).toBe(200);
      const accCsvText = await accCsvRes.text();
      expect(accCsvText).toContain('Edital FAPEG 04/2026 — Auxílio a Eventos');
      expect(accCsvText).toContain('SEI 23070.055444/2026-10');
    });
  },
);
