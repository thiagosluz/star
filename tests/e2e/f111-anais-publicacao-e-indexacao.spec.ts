import { createHash } from 'node:crypto';
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
const SENHA = 'SenhaF111!Segura2026';

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let eventSlug: string;
let trackId: string;
let submissionId: string;
let protocol: string;
let organizerEmail: string;
let authorEmail: string;
let authorId: string;

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer << /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n',
);

async function cadastrarViaApi(
  api: APIRequestContext,
  nome: string,
): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f111');
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

test.describe.serial('FASE 111 — Publicação de Anais, Citações e Indexação Gratuita', () => {
  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: ORIGEM });
    try {
      const tenant = await createTenant({
        label: 'f111-anais',
        name: 'Universidade Aberta F111',
      });
      tenantId = tenant.id;
      tenantSlug = tenant.slug;

      await e2eDb.tenant.update({
        where: { id: tenantId },
        data: { isPublic: true },
      });

      const event = await createEvent({
        tenantId,
        slug: `cbca-f111-${Date.now().toString(36)}`,
        title: 'Congresso de Ciência Aberta F111',
        status: 'PUBLISHED',
      });
      eventId = event.id;
      eventSlug = event.slug;

      const track = await e2eDb.track.create({
        data: {
          tenantId,
          eventId,
          slug: 'arquitetura-sistemas',
          name: 'Arquitetura de Sistemas',
        },
      });
      trackId = track.id;

      const organizer = await cadastrarViaApi(api, 'Organizadora Editorial F111');
      organizerEmail = organizer.email;
      await linkUser({ userId: organizer.id, tenantId, kind: 'MEMBER' });
      await grantRole({ userId: organizer.id, tenantId, role: 'ORGANIZER' });

      const author = await cadastrarViaApi(api, 'Maria Clara Pesquisadora');
      authorEmail = author.email;
      authorId = author.id;
      await e2eDb.user.update({
        where: { id: authorId },
        data: { orcidId: '0000-0001-2345-6789' },
      });
      await linkUser({ userId: authorId, tenantId, kind: 'PARTICIPANT' });
      await grantRole({ userId: authorId, tenantId, role: 'PARTICIPANT' });

      protocol = `2026-F111`;
      const submission = await e2eDb.submission.create({
        data: {
          tenantId,
          eventId,
          trackId,
          submittedById: authorId,
          protocol,
          title: 'Isolamento Multi-Tenant e Indexação Aberta em Plataformas Acadêmicas',
          abstract: 'Artigo demonstrando publicação de anais científicos com metadados Highwire Press e OAI-PMH.',
          keywords: ['Multi-tenant', 'OAI-PMH', 'Ciência Aberta'],
          language: 'pt-BR',
          status: 'ACCEPTED',
          finalScore: 97.5,
          decisionNotes: 'Nota interna confidencial F111.',
          submittedAt: new Date(),
          decisionAt: new Date(),
          authors: {
            create: [
              {
                tenantId,
                userId: authorId,
                guestEmail: 'autor-sigiloso@exemplo.local',
                institution: 'UFBA',
                authorOrder: 1,
                isCorresponding: true,
              },
            ],
          },
          files: {
            create: [
              {
                tenantId,
                kind: 'BLIND_PDF',
                storageKey: `tenants/${tenantId}/events/${eventId}/submissions/dummy/blind.pdf`,
                bucket: 'submissions',
                fileName: 'manuscrito-cego.pdf',
                mimeType: 'application/pdf',
                sizeBytes: BigInt(MINIMAL_PDF.length),
                checksum: createHash('sha256').update(MINIMAL_PDF).digest('hex'),
                version: 1,
                isCurrent: true,
                scanStatus: 'CLEAN',
              },
            ],
          },
        },
      });
      submissionId = submission.id;
    } finally {
      await api.dispose();
    }
  });

  test.afterAll(async () => {
    await cleanupRun();
    await e2eDb.$disconnect();
  });

  test('1. Autor registra autorização de publicação e envia versão final camera-ready pós-aceite', async ({
    page,
  }) => {
    await entrarComo(page, authorEmail);
    await page.goto(`/t/${tenantSlug}/submissoes/${submissionId}`);

    const cameraReadySection = page.getByTestId('camera-ready-section');
    await expect(cameraReadySection).toBeVisible();

    await cameraReadySection.locator('#proceedings-term-accepted').check();
    await cameraReadySection.getByRole('button', { name: /Registrar autorização/i }).click();
    await expect(page.getByTestId('proceedings-permission-accepted')).toBeVisible();

    await cameraReadySection.locator('input[type="file"]').setInputFiles({
      name: 'artigo-final-f111.pdf',
      mimeType: 'application/pdf',
      buffer: MINIMAL_PDF,
    });
    await cameraReadySection.getByRole('button', { name: 'Anexar arquivo' }).click();

    await expect(cameraReadySection.getByText('Arquivo anexado e verificado.')).toBeVisible({
      timeout: 20_000,
    });
  });

  test('2. Organizador monta ficha do volume, importa trabalhos aceitos, configura metadados e publica', async ({
    page,
  }) => {
    await entrarComo(page, organizerEmail);

    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}`);
    await expect(page.getByRole('link', { name: /Anais publicados/i })).toBeVisible();
    await page.getByRole('link', { name: /Anais publicados/i }).click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/administracao/eventos/${eventId}/anais`));

    await page.locator('#title').fill('Anais do Congresso de Ciência Aberta F111');
    await page.locator('#volumeLabel').fill('v. 1');
    await page.locator('#issn').fill('2595-1111');
    await page.locator('#editors').fill('Profa. Organizadora Editorial');
    await page.getByTestId('save-proceedings-volume').click();
    await expect(page.getByText('Ficha do volume de anais salva.')).toBeVisible();

    await page.getByTestId('import-accepted-submissions').click();
    await expect(page.getByTestId(`proceedings-entry-${protocol}`)).toBeVisible();

    const row = page.getByTestId(`proceedings-entry-${protocol}`);
    await row.locator('input[name="pageStart"]').fill('10');
    await row.locator('input[name="pageEnd"]').fill('22');
    await row.locator('input[name="externalDoi"]').fill('10.5281/zenodo.1112223');
    await row.getByRole('button', { name: 'Salvar item' }).click();
    await expect(row.getByText('Configuração do trabalho salva.')).toBeVisible();

    await page.getByTestId('publish-proceedings-button').click();
    await expect(page.getByTestId('proceedings-status-badge')).toHaveText('Publicado');
  });

  test('3. Vitrine pública dos Anais, busca, página individual, metatags Google Scholar, JSON-LD e axe', async ({
    page,
  }) => {
    await signOut(page, ORIGEM);

    await page.goto(`/t/${tenantSlug}/eventos/${eventSlug}`);
    await expect(page.getByTestId('event-proceedings-link')).toBeVisible();
    await page.getByTestId('event-proceedings-link').click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/eventos/${eventSlug}/anais`));
    await expect(page.getByTestId(`proceedings-work-card-${protocol}`)).toBeVisible();

    const volumeAxe = await new AxeBuilder({ page }).analyze();
    expect(volumeAxe.violations).toEqual([]);

    await page.getByPlaceholder(/Título, autor/i).fill('OAI-PMH');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/q=OAI-PMH/);
    await expect(page.getByTestId(`proceedings-work-card-${protocol}`)).toBeVisible();

    await page
      .getByTestId(`proceedings-work-card-${protocol}`)
      .getByRole('link', { name: /Isolamento Multi-Tenant/i })
      .click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/eventos/${eventSlug}/anais/${protocol}`));
    await expect(page.getByTestId('citation-abnt')).toContainText('DOI: 10.5281/zenodo.1112223');
    await expect(page.getByTestId('citation-apa')).toContainText('(2026)');

    const html = await page.content();
    expect(html).toContain('name="citation_title"');
    expect(html).toContain('name="citation_author"');
    expect(html).toContain('name="citation_pdf_url"');
    expect(html).toContain('name="citation_issn"');
    expect(html).toContain('name="citation_doi"');
    expect(html).toContain('name="DC.title"');
    expect(html).toContain('ScholarlyArticle');
    expect(html).not.toContain('autor-sigiloso@exemplo.local');
    expect(html).not.toContain('Nota interna confidencial F111');

    const workAxe = await new AxeBuilder({ page }).analyze();
    expect(workAxe.violations).toEqual([]);
  });

  test('4. Download BibTeX, RIS e transmissão inline do PDF camera-ready', async ({ request }) => {
    const bibRes = await request.get(
      `/api/t/${tenantSlug}/eventos/${eventSlug}/anais/${protocol}/citacao?formato=bibtex`,
    );
    expect(bibRes.status()).toBe(200);
    expect(bibRes.headers()['content-type']).toContain('application/x-bibtex');
    const bibText = await bibRes.text();
    expect(bibText).toContain('@inproceedings{');
    expect(bibText).toContain('doi = {10.5281/zenodo.1112223}');

    const risRes = await request.get(
      `/api/t/${tenantSlug}/eventos/${eventSlug}/anais/${protocol}/citacao?formato=ris`,
    );
    expect(risRes.status()).toBe(200);
    const risText = await risRes.text();
    expect(risText).toContain('TY  - CONF');
    expect(risText).toContain('ER  -');

    const pdfRes = await request.get(
      `/api/t/${tenantSlug}/eventos/${eventSlug}/anais/${protocol}/arquivo`,
    );
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()['content-type']).toContain('application/pdf');
    expect(pdfRes.headers()['content-disposition']).toContain('inline');
    const pdfBuf = await pdfRes.body();
    expect(pdfBuf.subarray(0, 8).toString('utf8')).toContain('%PDF-1.4');
  });

  test('5. Endpoints OAI-PMH 2.0, sitemap.xml e robots.txt expõem os anais publicados', async ({
    request,
  }) => {
    const eventOaiRes = await request.get(
      `/api/t/${tenantSlug}/eventos/${eventSlug}/oai?verb=ListRecords&metadataPrefix=oai_dc`,
    );
    expect(eventOaiRes.status()).toBe(200);
    expect(eventOaiRes.headers()['content-type']).toContain('application/xml');
    const eventOaiXml = await eventOaiRes.text();
    expect(eventOaiXml).toContain('<OAI-PMH');
    expect(eventOaiXml).toContain(protocol);
    expect(eventOaiXml).toContain('<dc:title>Isolamento Multi-Tenant e Indexação Aberta em Plataformas Acadêmicas</dc:title>');

    const globalOaiRes = await request.get('/api/oai?verb=Identify');
    expect(globalOaiRes.status()).toBe(200);
    const globalOaiXml = await globalOaiRes.text();
    expect(globalOaiXml).toContain('<Identify>');

    const sitemapRes = await request.get('/sitemap.xml');
    expect(sitemapRes.status()).toBe(200);
    const sitemapXml = await sitemapRes.text();
    expect(sitemapXml).toContain(`/t/${tenantSlug}/eventos/${eventSlug}/anais`);
    expect(sitemapXml).toContain(`/t/${tenantSlug}/eventos/${eventSlug}/anais/${protocol}`);

    const robotsRes = await request.get('/robots.txt');
    expect(robotsRes.status()).toBe(200);
    const robotsTxt = await robotsRes.text();
    expect(robotsTxt).toContain('Sitemap:');
    expect(robotsTxt).toContain('/t/*/administracao');
  });
});
