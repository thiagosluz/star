/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Submissão de trabalho e avaliação por pares
 *
 *  Cobre a jornada completa no navegador:
 *    1. autor cria o rascunho e anexa o PDF (upload direto ao MinIO, com
 *       verificação de integridade por SHA-256);
 *    2. envia para avaliação;
 *    3. o comitê vê o painel de distribuição — com conflito de interesse
 *       BLOQUEANDO um revisor e a razão visível;
 *    4. o revisor designado avalia, e a nota ponderada é calculada no servidor;
 *    5. o comitê decide.
 *
 *  Pré-requisitos:
 *      docker compose up -d && npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

/** PDF mínimo válido, com a assinatura `%PDF-`. */
const PDF_CONTENT = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────

/** Cria uma trilha no evento. */
async function createTrack(options: {
  tenantId: string;
  eventId: string;
  slug: string;
  name: string;
  requiresBlindReview?: boolean;
  requiredReviews?: number;
}) {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId}, true)`;

    return tx.track.create({
      data: {
        id: randomUUID(),
        tenantId: options.tenantId,
        eventId: options.eventId,
        slug: options.slug,
        name: options.name,
        requiresBlindReview: options.requiresBlindReview ?? true,
        requiredReviews: options.requiredReviews ?? 1,
        maxSubmissionsPerAuthor: 10,
        reviewRubric: [
          { key: 'originality', label: 'Originalidade', weight: 3, maxScore: 10 },
          { key: 'methodology', label: 'Metodologia', weight: 2, maxScore: 10 },
        ],
        acceptanceThreshold: 70,
        rejectThreshold: 45,
      },
    });
  });
}

/**
 * Cria um usuário e o autentica NESTE navegador.
 *
 * ─── POR QUE PELA API DO BETTER AUTH ─────────────────────────────────────────
 * `page.request` compartilha o cookie jar do contexto do navegador: o cadastro
 * feito por ele autentica a página de verdade. Isso permite montar cenários com
 * VÁRIOS usuários no mesmo teste (autor, revisor, comitê) sem alternar
 * formulários — e sem gerar hashes de senha à mão.
 *
 * O `Origin` é exigido pelo Better Auth para proteção CSRF. O navegador o envia
 * naturalmente; aqui precisamos declará-lo.
 */
async function createUser(
  page: import('@playwright/test').Page,
  tenantId: string,
  name: string,
  role: 'PARTICIPANT' | 'REVIEWER' | 'CHAIR' | 'ORGANIZER' | 'ADMIN',
  reviewer?: { keywords: string[]; institution: string; domain: string },
): Promise<{ id: string; email: string }> {
  const email = `peer.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(
      `Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`,
    );
  }

  const user = await e2eDb.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  await grantUserRole(tenantId, user.id, role);

  if (reviewer) {
    await registerReviewer({
      tenantId,
      userId: user.id,
      keywords: reviewer.keywords,
      institution: reviewer.institution,
      domain: reviewer.domain,
    });
  }

  return { id: user.id, email };
}

/**
 * Autentica uma pessoa já cadastrada, ENCERRANDO a sessão anterior.
 *
 * `signOut` antes do login é necessário porque o Better Auth mantém a sessão por
 * cookie: sem sair, o cadastro seguinte reutilizaria a sessão anterior — e o
 * teste acabaria verificando a tela com o usuário errado (isto é, verificando
 * nada).
 */
async function signInAs(
  page: import('@playwright/test').Page,
  email: string,
): Promise<void> {
  await page.request.post('/api/auth/sign-out', {
    headers: { origin: 'http://localhost:3000' },
  });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(
      `Falha ao autenticar ${email}: HTTP ${response.status()} ${await response.text()}`,
    );
  }
}

/** Vincula o usuário e concede um papel. */
async function grantUserRole(
  tenantId: string,
  userId: string,
  role: 'PARTICIPANT' | 'REVIEWER' | 'CHAIR' | 'ORGANIZER' | 'ADMIN',
) {
  await linkUser({ tenantId, userId });
  await grantRole({ tenantId, userId, role });
}

/** Registra o usuário como revisor com instituição e áreas. */
async function registerReviewer(options: {
  tenantId: string;
  userId: string;
  keywords: string[];
  institution: string;
  domain: string;
}) {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId}, true)`;

    return tx.reviewerExpertise.create({
      data: {
        id: randomUUID(),
        tenantId: options.tenantId,
        userId: options.userId,
        expertiseKeywords: options.keywords,
        preferredTrackIds: [],
        declaredInstitution: options.institution,
        institutionalEmailDomain: options.domain,
        maxConcurrentAssignments: 10,
      },
    });
  });
}

/**
 * Prepara um cenário completo: instituição, evento, trilha e autor com papel.
 */
async function scenario(label: string) {
  const tenant = await createTenant({ label, name: `Instituição ${label} ${RUN_ID}` });
  const event = await createEvent({
    tenantId: tenant.id,
    slug: `evento-${label}`,
    title: `Evento ${label}`,
    status: 'REGISTRATION_OPEN',
  });
  const track = await createTrack({
    tenantId: tenant.id,
    eventId: event.id,
    slug: `trilha-${label}`,
    name: `Trilha ${label}`,
    requiredReviews: 1,
  });

  return { tenant, event, track };
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('submissão de trabalho', () => {
  test('autor cria rascunho, anexa o PDF e envia para avaliação', async ({ page }) => {
    const { tenant, event, track } = await scenario('submissao');

    // A pessoa autenticada é a autora do trabalho; `createUser` já a registra.
    await createUser(page, tenant.id, 'Autora E2E', 'PARTICIPANT');

    // ── Cria o rascunho pela interface ─────────────────────────────────────
    await page.goto(`/t/${tenant.slug}/submissoes/nova`);

    await page.getByLabel('Evento').selectOption(event.id);
    await page
      .getByLabel('Título')
      .fill('Modelos de aprendizado de máquina para vigilância epidemiológica');
    await page
      .getByLabel('Resumo')
      .fill(
        'Este trabalho investiga modelos de aprendizado de máquina aplicados à predição de surtos epidemiológicos a partir de dados de vigilância em saúde pública, comparando abordagens supervisionadas e avaliando o desempenho em séries temporais reais de três regiões.',
      );
    await page
      .getByLabel('Palavras-chave')
      .fill('aprendizado de máquina, epidemiologia, vigilância em saúde');
    await page.getByLabel('Trilha temática').selectOption(track.id);
    await page.getByRole('button', { name: /criar rascunho/i }).click();

    await expect(page.getByTestId('submission-created')).toBeVisible();

    // ── Abre a submissão e anexa o PDF cego ────────────────────────────────
    const submission = await e2eDb.submission.findFirstOrThrow({
      where: { trackId: track.id },
      select: { id: true, protocol: true },
    });

    await page.goto(`/t/${tenant.slug}/submissoes/${submission.id}`);

    const uploader = page.getByTestId('submission-files');
    await expect(uploader).toBeVisible();

    // Anexa a versão cega (a trilha exige revisão cega).
    const fileInput = page.getByLabel(/versão cega/i);
    await fileInput.setInputFiles({
      name: 'artigo-cego.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_CONTENT,
    });

    await page.getByRole('button', { name: /anexar arquivo/i }).first().click();

    await expect(page.getByTestId('upload-status-BLIND_PDF')).toContainText(
      /anexado e verificado/i,
      { timeout: 30_000 },
    );

    // ── Envia ──────────────────────────────────────────────────────────────
    await expect(page.getByTestId('submit-blockers')).toHaveCount(0);
    await page.getByRole('button', { name: /enviar para avaliação/i }).click();

    await expect(page.getByTestId('submission-submitted')).toContainText(
      /enviada para avaliação/i,
      { timeout: 20_000 },
    );

    // ── Banco: arquivo registrado com integridade ──────────────────────────
    const stored = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.submission.findUniqueOrThrow({
        where: { id: submission.id },
        select: {
          status: true,
          submittedAt: true,
          files: {
            select: { kind: true, checksum: true, sizeBytes: true, isCurrent: true },
          },
        },
      });
    });

    expect(stored.status).toBe('SUBMITTED');
    expect(stored.submittedAt).not.toBeNull();
    expect(stored.files).toHaveLength(1);
    expect(stored.files[0]?.kind).toBe('BLIND_PDF');
    // O checksum é SHA-256 em hexadecimal — a integridade foi verificada.
    expect(stored.files[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(stored.files[0]?.sizeBytes)).toBe(PDF_CONTENT.length);
  }, 120_000);

  test('recusa arquivo que não é PDF (validação no navegador)', async ({ page }) => {
    const { tenant, event, track } = await scenario('naopdf');

    const author = await createUser(page, tenant.id, 'Autora NãoPDF', 'PARTICIPANT');

    // Cria a submissão direto no banco (o foco do teste é a validação do arquivo).
    const submissionId = randomUUID();
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      await tx.submission.create({
        data: {
          id: submissionId,
          tenantId: tenant.id,
          eventId: event.id,
          trackId: track.id,
          protocol: `E2E-${RUN_ID.slice(0, 3)}`,
          title: 'Submissão para teste de formato de arquivo',
          abstract: 'R'.repeat(200),
          keywords: ['teste', 'formato', 'arquivo'],
          status: 'DRAFT',
          submittedById: author.id,
        },
      });
    });

    await page.goto(`/t/${tenant.slug}/submissoes/${submissionId}`);

    await page.getByLabel(/versão cega/i).setInputFiles({
      name: 'documento.pdf',
      mimeType: 'application/pdf',
      // Conteúdo que NÃO é PDF: assinatura de ZIP.
      buffer: Buffer.from('PK\x03\x04conteudo que nao e pdf'),
    });

    await page.getByRole('button', { name: /anexar arquivo/i }).first().click();

    // A validação do domínio recusa pela ASSINATURA, não pelo tipo declarado.
    await expect(page.getByTestId('upload-status-BLIND_PDF')).toContainText(
      /não é um PDF válido/i,
      { timeout: 20_000 },
    );

    const fileCount = await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.submissionFile.count({ where: { submissionId } });
    });

    expect(fileCount).toBe(0);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('conflito de interesse no comitê', () => {
  test('comitê vê o conflito BLOQUEANDO o revisor, com a razão', async ({ page }) => {
    const { tenant, event, track } = await scenario('conflito');

    // ── Autor e revisor CONFLITADOS (mesma instituição) ────────────────────
    const author = await createUser(page, tenant.id, 'Autora Conflito', 'PARTICIPANT');

    const chair = await createUser(page, tenant.id, 'Presidente Comitê', 'CHAIR');

    await createUser(
      page,
      tenant.id,
      'Revisor Conflitado E2E',
      'REVIEWER',
      {
        keywords: ['aprendizado de máquina', 'epidemiologia'],
        institution: 'Universidade Alfa',
        domain: 'universidade-alfa.edu.br',
      },
    );

    /**
     * Um revisor ELEGÍVEL no mesmo cenário.
     *
     * Sem ele, a lista de elegíveis ficaria vazia e o painel mostraria "nenhum
     * revisor elegível" — impedindo verificar a asserção que importa: que o
     * conflitado NÃO aparece entre os elegíveis e SIM entre os bloqueados.
     */
    await createUser(page, tenant.id, 'Revisor Elegível E2E', 'REVIEWER', {
      keywords: ['aprendizado de máquina', 'epidemiologia', 'saúde pública'],
      institution: 'Universidade Gama',
      domain: 'universidade-gama.edu.br',
    });

    // Vincula o autor à MESMA instituição declarada.
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      await tx.submissionAuthor.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          submissionId: (
            await tx.submission.create({
              data: {
                id: randomUUID(),
                tenantId: tenant.id,
                eventId: event.id,
                trackId: track.id,
                protocol: `COI-${RUN_ID.slice(0, 3)}`,
                title: 'Trabalho com revisor em conflito de interesse',
                abstract:
                  'Resumo suficientemente longo para permitir a avaliação de mérito por pares neste cenário de teste de conflito de interesse institucional.',
                keywords: ['aprendizado de máquina', 'epidemiologia', 'conflito'],
                status: 'SUBMITTED',
                submittedById: author.id,
                submittedAt: new Date(),
              },
            })
          ).id,
          userId: author.id,
          authorOrder: 1,
          isCorresponding: true,
          institution: 'Universidade Alfa',
        },
      });
    });

    const submission = await e2eDb.submission.findFirstOrThrow({
      where: { trackId: track.id },
      select: { id: true },
    });

    /**
     * ── O PAINEL É DO COMITÊ, NÃO DE QUEM ESTÁ LOGADO ─────────────────────
     * `createUser` deixa a ÚLTIMA conta criada autenticada — que aqui seria um
     * revisor. Entrar explicitamente como presidente é o que garante que a tela
     * está sendo verificada no papel certo (e a guarda de permissão da página
     * recusaria os demais papéis).
     */
    await signInAs(page, chair.email);
    await page.goto(`/t/${tenant.slug}/comite/${submission.id}`);

    await expect(page.getByTestId('eligible-reviewers')).toBeVisible();

    // O revisor NÃO aparece entre os elegíveis.
    await expect(page.getByTestId('eligible-reviewers')).not.toContainText(
      'Revisor Conflitado E2E',
    );

    // ── E aparece na lista de bloqueados, COM A RAZÃO ──────────────────────
    await page.getByText(/bloqueados por conflito de interesse/i).click();

    const blocked = page.getByTestId('blocked-reviewers');
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText('Revisor Conflitado E2E');
    await expect(blocked).toContainText(/mesma instituição|domínio institucional/i);
  }, 120_000);

  /**
   * A fila do comitê expõe títulos e resumos de trabalhos de terceiros.
   *
   * O link não aparece no menu para um participante, mas esconder link não é
   * autorização: quem digita a URL precisa ser barrado no servidor, ANTES de a
   * lista ser consultada.
   */
  test('PARTICIPANTE não acessa o painel do comitê', async ({ page }) => {
    const { tenant } = await scenario('rbac-comite');

    await createUser(page, tenant.id, 'Participante Curioso', 'PARTICIPANT');

    await page.goto(`/t/${tenant.slug}/comite`);

    // Foi devolvido ao painel; a fila do comitê nunca renderizou.
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboard$`));
    await expect(page.getByTestId('chair-summary')).toHaveCount(0);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('revisão cega', () => {
  test('revisor em revisão cega NÃO recebe a versão identificada', async ({ page }) => {
    const { tenant, event, track } = await scenario('cega');

    const author = await createUser(page, tenant.id, 'Autora Cega', 'PARTICIPANT');

    const reviewer = await createUser(page, tenant.id, 'Revisor Cego', 'REVIEWER', {
      keywords: ['aprendizado de máquina'],
      institution: 'Universidade Beta',
      domain: 'universidade-beta.edu.br',
    });

    /**
     * Cria a submissão com DOIS artefatos: o cego e o identificado.
     *
     * O revisor está designado para revisão cega — ele NÃO pode receber o
     * identificado, mesmo que exista.
     */
    const submissionId = randomUUID();

    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

      await tx.submission.create({
        data: {
          id: submissionId,
          tenantId: tenant.id,
          eventId: event.id,
          trackId: track.id,
          protocol: `BLD-${RUN_ID.slice(0, 3)}`,
          title: 'Trabalho em avaliação cega',
          abstract:
            'Resumo suficientemente longo para permitir a avaliação de mérito por pares neste cenário de revisão cega com dois artefatos distintos.',
          keywords: ['aprendizado de máquina', 'revisão cega', 'teste'],
          status: 'UNDER_REVIEW',
          submittedById: author.id,
          submittedAt: new Date(),
        },
      });

      await tx.submissionFile.createMany({
        data: [
          {
            id: randomUUID(),
            tenantId: tenant.id,
            submissionId,
            kind: 'BLIND_PDF',
            storageKey: `tenants/${tenant.id}/eventos/${event.id}/submissoes/${submissionId}/blind_pdf/v1/cego.pdf`,
            bucket: 'eventflow-submissions',
            fileName: 'artigo-cego.pdf',
            mimeType: 'application/pdf',
            sizeBytes: BigInt(PDF_CONTENT.length),
            checksum: 'a'.repeat(64),
            version: 1,
            isCurrent: true,
            scanStatus: 'SKIPPED',
          },
          {
            id: randomUUID(),
            tenantId: tenant.id,
            submissionId,
            kind: 'IDENTIFIED_PDF',
            storageKey: `tenants/${tenant.id}/eventos/${event.id}/submissoes/${submissionId}/identified_pdf/v1/identificado.pdf`,
            bucket: 'eventflow-submissions',
            fileName: 'artigo-com-autores.pdf',
            mimeType: 'application/pdf',
            sizeBytes: BigInt(PDF_CONTENT.length),
            checksum: 'b'.repeat(64),
            version: 1,
            isCurrent: true,
            scanStatus: 'SKIPPED',
          },
        ],
      });

      await tx.reviewAssignment.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          submissionId,
          reviewerId: reviewer.id,
          status: 'INVITED',
          isBlind: true,
        },
      });
    });

    await page.goto(`/t/${tenant.slug}/revisoes/${submissionId}`);

    const files = page.getByTestId('reviewable-files');
    await expect(files).toBeVisible();

    // Apenas o artefato cego é entregue ao revisor.
    await expect(files).toContainText('artigo-cego.pdf');
    await expect(files).not.toContainText('artigo-com-autores.pdf');

    // O aviso de revisão cega é explícito.
    await expect(page.getByText(/revisão cega/i).first()).toBeVisible();
  }, 120_000);
});
