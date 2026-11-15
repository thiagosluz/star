/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — FASE 112: Bloco do Comitê Científico (`CHAIR`) no Painel e Fluxo Editorial
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  signOut,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const ORIGEM = 'http://localhost:3000';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let eventSlug: string;

let chairEmail: string;
let chairReviewerEmail: string;

async function signUpVia(
  api: APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f112');
  const res = await api.post('/api/auth/sign-up/email', {
    headers: { origin: ORIGEM },
    data: { name, email, password: PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`Falha no sign-up de ${name}: HTTP ${res.status()}`);
  }
  const user = await e2eDb.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  return { id: user.id, email };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await signOut(page, ORIGEM);
  const res = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: ORIGEM },
    data: { email, password: PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`Falha ao autenticar ${email}: HTTP ${res.status()}`);
  }
}

test.describe.serial('FASE 112 — Jornada completa do CHAIR: Painel → Comitê → Anais', () => {
  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGEM });
    try {
      const chair = await signUpVia(api, 'Profa. Helena Chair F112');
      const chairReviewer = await signUpVia(api, 'Prof. Marcos Chair e Revisor F112');
      const author = await signUpVia(api, 'Autor Científico F112');

      chairEmail = chair.email;
      chairReviewerEmail = chairReviewer.email;

      const tenant = await createTenant({
        label: 'f112-chair',
        name: `Sociedade Científica F112 ${RUN_ID}`,
      });
      tenantId = tenant.id;
      tenantSlug = tenant.slug;

      await linkUser({ userId: chair.id, tenantId, kind: 'MEMBER' });
      await grantRole({ userId: chair.id, tenantId, role: 'CHAIR' });

      await linkUser({ userId: chairReviewer.id, tenantId, kind: 'MEMBER' });
      await grantRole({ userId: chairReviewer.id, tenantId, role: 'CHAIR' });
      await grantRole({ userId: chairReviewer.id, tenantId, role: 'REVIEWER' });

      await linkUser({ userId: author.id, tenantId, kind: 'PARTICIPANT' });
      await grantRole({ userId: author.id, tenantId, role: 'PARTICIPANT' });

      const event = await createEvent({
        tenantId,
        slug: `simposio-f112-${Date.now().toString(36)}`,
        title: `Simpósio Nacional de Pesquisa F112 ${RUN_ID}`,
        status: 'PUBLISHED',
      });
      eventId = event.id;
      eventSlug = event.slug;

      const track = await e2eDb.track.create({
        data: {
          tenantId,
          eventId,
          slug: 'computacao-e-sociedade',
          name: 'Computação e Sociedade',
        },
      });

      // Uma submissão aguardando avaliação na fila do comitê e uma já aceita para os anais
      await e2eDb.submission.create({
        data: {
          tenantId,
          eventId,
          trackId: track.id,
          submittedById: author.id,
          protocol: '2026-CH01',
          title: 'Modelagem Formal de Isolamento Multi-Tenant sob RLS',
          abstract: 'Artigo submetido na fila do comitê científico para avaliação.',
          keywords: ['rls', 'postgresql'],
          language: 'pt-BR',
          status: 'SUBMITTED',
          submittedAt: new Date(),
          authors: {
            create: [
              {
                tenantId,
                userId: author.id,
                institution: 'UFBA',
                authorOrder: 1,
                isCorresponding: true,
              },
            ],
          },
        },
      });

      await e2eDb.submission.create({
        data: {
          tenantId,
          eventId,
          trackId: track.id,
          submittedById: author.id,
          protocol: '2026-CH02',
          title: 'Verificação Empírica de Atalhos por Perfil no Painel',
          abstract: 'Artigo já aceito pronto para curadoria nos anais pelo CHAIR.',
          keywords: ['ux', 'rbac'],
          language: 'pt-BR',
          status: 'ACCEPTED',
          submittedAt: new Date(),
          decisionAt: new Date(),
          decisionById: chair.id,
          authors: {
            create: [
              {
                tenantId,
                userId: author.id,
                institution: 'UFBA',
                authorOrder: 1,
                isCorresponding: true,
              },
            ],
          },
        },
      });
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async () => {
    await cleanupRun();
  });

  test('1. CHAIR vê o card "Comitê científico" com contagem real no painel e aterrissa em /comite', async ({
    page,
  }) => {
    await signInAs(page, chairEmail);
    await page.goto(`/t/${tenantSlug}/dashboard`);

    const comiteCard = page.getByTestId('dashboard-block-comite');
    await expect(comiteCard).toBeVisible();
    await expect(comiteCard).toHaveAttribute('href', `/t/${tenantSlug}/comite`);
    await expect(comiteCard).toContainText('Comitê científico');
    await expect(comiteCard).toContainText('1 trabalho na fila');

    // CHAIR puro não vê o bloco de pareceres individuais nem o de gestão executiva
    await expect(page.getByTestId('dashboard-block-pareceres')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-block-gestao')).toHaveCount(0);

    await comiteCard.click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/comite$`));
    await expect(page.getByTestId('chair-summary')).toBeVisible();
    await expect(page.getByTestId('chair-submissions')).toContainText(
      'Modelagem Formal de Isolamento Multi-Tenant sob RLS',
    );
  });

  test('2. De /comite, o CHAIR acessa os Anais do evento, importa aceitos, publica e volta ao Comitê pela trilha', async ({
    page,
  }) => {
    await signInAs(page, chairEmail);
    await page.goto(`/t/${tenantSlug}/comite`);

    const anaisLink = page.getByTestId(`chair-proceedings-link-${eventId}`);
    await expect(anaisLink).toBeVisible();
    await anaisLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/t/${tenantSlug}/administracao/eventos/${eventId}/anais$`),
    );

    // Salva a ficha do volume como CHAIR (protegido por submission:decide)
    await page.getByTestId('save-proceedings-volume').click();
    await expect(page.getByText('Ficha do volume de anais salva.')).toBeVisible();

    // Importa o trabalho aceito (2026-CH02) e publica os anais
    await page.getByTestId('import-accepted-submissions').click();
    await expect(page.getByTestId('proceedings-entry-2026-CH02')).toBeVisible();

    await page.getByTestId('publish-proceedings-button').click();
    await expect(page.getByTestId('proceedings-status-badge')).toHaveText('Publicado');

    // A trilha do CHAIR aponta de volta para Comitê científico (/comite?evento=...)
    const backCrumb = page.getByRole('link', { name: 'Comitê científico' }).first();
    await expect(backCrumb).toHaveAttribute(
      'href',
      `/t/${tenantSlug}/comite?evento=${eventId}`,
    );

    // E a vitrine pública dos anais está no ar
    await page.goto(`/t/${tenantSlug}/eventos/${eventSlug}/anais`);
    await expect(
      page.getByText('Verificação Empírica de Atalhos por Perfil no Painel'),
    ).toBeVisible();
  });

  test('3. Perfil acumulado CHAIR + REVIEWER vê tanto Comitê científico (/comite) quanto Meus pareceres (/revisoes)', async ({
    page,
  }) => {
    await signInAs(page, chairReviewerEmail);
    await page.goto(`/t/${tenantSlug}/dashboard`);

    const comiteCard = page.getByTestId('dashboard-block-comite');
    const pareceresCard = page.getByTestId('dashboard-block-pareceres');

    await expect(comiteCard).toBeVisible();
    await expect(comiteCard).toHaveAttribute('href', `/t/${tenantSlug}/comite`);

    await expect(pareceresCard).toBeVisible();
    await expect(pareceresCard).toHaveAttribute('href', `/t/${tenantSlug}/revisoes`);
  });
});
