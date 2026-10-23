import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 75 · DECISÃO 4 — AS PÁGINAS DE ERRO QUE NÃO EXISTIAM
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *  O app tinha **zero `error.tsx` e zero `not-found.tsx`**: todo `notFound()` caía na
 *  página padrão do Next — "This page could not be found.", em inglês, sem a
 *  identidade da instituição e sem caminho de volta — e todo erro de rota subia para
 *  o `global-error`, que desenha sem o CSS do app.
 *
 *  A fase criou um par por ÁREA (a casca autenticada, a área pública da instituição e
 *  a raiz/plataforma). Este spec prova o que a catraca de unidade não consegue: que a
 *  página certa aparece no endereço certo, com o caminho de volta certo, e que a
 *  frase do domínio chegou à TELA.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE CADA CASO MEDE — E O QUE ELE NÃO MEDE
 * ─────────────────────────────────────────────────────────────────────────────
 *  Aqui se mede COMPORTAMENTO: o status HTTP, o texto que a pessoa lê, o `href` do
 *  caminho de volta e o `reset` do botão. A varredura de acessibilidade (WCAG AA, sem
 *  isenção nova) das mesmas telas vive em `tests/e2e/accessibility.spec.ts`, que é
 *  onde o portão mora — este arquivo não duplica o `axe`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PÁGINA DE ERRO NÃO É MAIS MEDIDA POR UMA ROTA QUE ESTOURA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Até a F75 o caminho honesto para ver o boundary de erro era a **armadilha 25**
 *  na forma mais simples: um id que não é UUID chegava ao Prisma, o Postgres
 *  recusava (`invalid input syntax for type uuid`) e a resposta era **500**.
 *
 *      GET /t/<slug>/administracao/eventos/nao-e-uuid   → 500 (até a F75)
 *      GET /t/<slug>/administracao/eventos/nao-e-uuid   → 404 (desde a F76)
 *      GET /t/<slug>/administracao/eventos/<uuid>       → 404 (o `notFound()` normal)
 *
 *  A FASE 76 decidiu que formato inválido é 404 ANTES da consulta. O caso do 500
 *  deixou de existir como comportamento do produto, e este spec foi REAPONTADO:
 *  ele agora mede o 404 do id malformado — sem `test.skip` e sem espera
 *  condicional. A cobertura da PÁGINA DE ERRO não se perdeu: ela passou para o
 *  render estático do componente em `tests/unit/f76-pagina-de-erro-axe.test.ts` e
 *  no portão de acessibilidade (`tests/e2e/accessibility.spec.ts`), que mede o
 *  mesmo HTML no Chromium.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f75-erro';

let tenantSlug: string;
let adminEmail: string;

/**
 * Um id que NÃO tem forma de uuid — o caso real de quem digita ou cola um endereço
 * truncado.
 *
 * Desde a FASE 76 ele não chega ao Prisma: `requireUuidParam` responde 404 no topo
 * da página. O valor continua sendo o mesmo de propósito — é o endereço que a fase
 * mediu e consertou.
 */
const ID_MALFORMADO = 'nao-e-uuid';

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ email: string }> {
  const email = `f75.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  return { email };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da página de erro ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;

    const admin = await signUpVia(api, 'Administradora da página de erro');

    /**
     * O `id` do cadastro NÃO é reaproveitado do retorno: ele é relido do banco pelo
     * e-mail. É a lição da armadilha 25 — o id que o teste guarda numa `let` pode não
     * existir no worker seguinte, e o sintoma seria um 500 no lugar do cenário real.
     */
    const pessoa = await e2eDb.user.findUniqueOrThrow({
      where: { email: admin.email },
      select: { id: true },
    });

    adminEmail = admin.email;

    await linkUser({ userId: pessoa.id, tenantId: tenant.id, kind: 'MEMBER' });
    await grantRole({ userId: pessoa.id, tenantId: tenant.id, role: 'ADMIN', scope: 'TENANT' });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
});

test.describe('a página de NÃO ENCONTRADO', () => {
  test('na área pública, diz o que aconteceu e leva de volta à vitrine da instituição', async ({
    page,
  }) => {
    /**
     * Um evento que não existe é o caso NORMAL da área pública: link de campanha,
     * mensagem antiga, endereço digitado à mão.
     */
    const resposta = await page.goto(
      `/t/${tenantSlug}/eventos/evento-que-nao-existe-${RUN_ID}`,
    );

    expect(resposta?.status(), 'o endereço inexistente responde 404').toBe(404);

    const tela = page.getByTestId('area-not-found-public');
    await expect(tela).toBeVisible();

    /**
     * A frase é a do DOMÍNIO, e é a MESMA nas três áreas: as três hipóteses juntas
     * ("não existe", "foi removido", "não está disponível para você"). É o que impede
     * a página de virar oráculo de existência de recurso privado.
     */
    await expect(tela).toContainText('Página não encontrada');
    await expect(tela).toContainText('Este endereço não existe, foi removido ou não está disponível para você.');

    /** O caminho de volta é o da ÁREA: a vitrine da instituição, não o painel. */
    const volta = tela.getByRole('link', { name: 'Ver os eventos da instituição' });
    await expect(volta).toHaveAttribute('href', `/t/${tenantSlug}/eventos`);

    /**
     * E a página padrão do framework NÃO aparece: era exatamente ela que a fase
     * substituiu (o texto em inglês é a assinatura dela).
     */
    await expect(page.locator('body')).not.toContainText('This page could not be found');
  });

  test('na raiz, cobre o endereço que não é rota nenhuma', async ({ page }) => {
    const resposta = await page.goto(`/endereco-que-nao-existe-${RUN_ID}`);

    expect(resposta?.status()).toBe(404);

    const tela = page.getByTestId('area-not-found-platform');
    await expect(tela).toBeVisible();
    await expect(tela.getByRole('link', { name: 'Ir para a página inicial' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  test('no painel, o caminho de volta é o painel da instituição', async ({ page }) => {
    await signInAs(page, adminEmail);

    /**
     * Um UUID VÁLIDO que não existe: é o caminho do `notFound()` normal (o serviço
     * devolve `null` e a página responde 404), e não o do id malformado.
     */
    const resposta = await page.goto(`/t/${tenantSlug}/administracao/eventos/${randomUUID()}`);

    expect(resposta?.status()).toBe(404);

    const tela = page.getByTestId('area-not-found-app');
    await expect(tela).toBeVisible();
    await expect(tela).toContainText('Página não encontrada');

    await expect(tela.getByRole('link', { name: 'Voltar ao painel' })).toHaveAttribute(
      'href',
      `/t/${tenantSlug}/dashboard`,
    );

    /** A casca da instituição continua em volta: quem estava trabalhando não é expulso. */
    await expect(page.getByTestId('active-tenant')).toBeVisible();
  });
});

test.describe('o id malformado — o 500 que a FASE 76 converteu em 404', () => {
  test('no painel, responde 404 com a página de não encontrado, sem detalhe técnico', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    const resposta = await page.goto(
      `/t/${tenantSlug}/administracao/eventos/${ID_MALFORMADO}`,
    );

    /**
     * ─── O REAPONTAMENTO DA FASE 76 ─────────────────────────────────────────────
     *  Até a F75 este endereço respondia 500 e o caso cobrava a página de erro.
     *  Agora o formato inválido é 404 decidido ANTES da consulta: a prova é o
     *  status e a página de NÃO ENCONTRADO — sem `test.skip`, sem condicional.
     */
    expect(resposta?.status(), 'o id malformado responde 404 — nunca 500').toBe(404);

    const tela = page.getByTestId('area-not-found-app');
    await expect(tela).toBeVisible();
    await expect(tela).toContainText('Página não encontrada');
    await expect(tela).toContainText(
      'Este endereço não existe, foi removido ou não está disponível para você.',
    );
    await expect(tela.getByRole('link', { name: 'Voltar ao painel' })).toHaveAttribute(
      'href',
      `/t/${tenantSlug}/dashboard`,
    );

    /**
     * A tela de ERRO não aparece: o caminho do 500 deixou de existir. Se alguém
     * reintroduzir uma consulta antes da validação do formato, o 500 volta e este
     * `toHaveCount(0)`/status reprova.
     */
    await expect(page.getByTestId('area-error-app')).toHaveCount(0);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  NADA DE DETALHE TÉCNICO NA TELA
     * ─────────────────────────────────────────────────────────────────────────────
     *  A mensagem do Prisma cita a coluna, o tipo e o valor — e é o tipo de coisa
     *  que já vazou em erro de produto. O 404 não pode ser a nova porta para ela.
     */
    const texto = await tela.innerText();
    for (const vazamento of ['invalid input syntax', 'Prisma', 'TypeError', 'at Object', 'digest']) {
      expect(texto, `a tela do 404 vazou "${vazamento}"`).not.toContain(vazamento);
    }

    /** E a página padrão do framework continua fora: a tela é a da casa. */
    await expect(page.locator('body')).not.toContainText('This page could not be found');
  });
});
