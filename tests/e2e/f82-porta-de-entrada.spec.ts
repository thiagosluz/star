/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — a PORTA DE ENTRADA (FASE 82 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTAVA ERRADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Todo fluxo de entrada terminava num `redirect` INCONDICIONAL para
 *  `/selecionar-instituicao`: o SuperAdmin caía no seletor (e ficava sem porta de
 *  volta para a governança), quem não tinha vínculo caía numa tela que só oferecia
 *  "Sair da conta", e o `redirectTo` do login estava MORTO — só era lido dentro do
 *  branch de `tenantSlug`, prop que nenhuma tela envia ao formulário.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, NO NAVEGADOR REAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os quatro degraus da regra, cada um por um caminho diferente:
 *
 *    1. SuperAdmin pelo FORMULÁRIO → `/superadmin` (governança);
 *    2. pessoa nova, sem vínculo       → `/eventos` (descoberta);
 *    3. membro com UM vínculo          → `/t/<slug>/dashboard` (painel);
 *    4. `?redirectTo=`                 → volta para o destino pedido.
 *
 *  O caso 4 é a prova que faltava: ele passa pelo formulário SEM `tenantSlug` —
 *  era exatamente aí que o destino era ignorado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  E A PORTA DE VOLTA (FASE 82 · fatia 3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A entrada passou a levar a pessoa ao lugar certo, mas a TELA do seletor
 *  continuava sem caminho para o painel: com um vínculo a linha é um `<span>`
 *  "Contexto atual", e o link do rodapé apontava para `/` (a vitrine). Os casos
 *  5 a 7 medem o link novo nos TRÊS ramos da tela; o caso 8 mede a porta de volta
 *  do operador de plataforma, que era o último beco — o bloco de conta de
 *  `/superadmin` não oferecia nem `/conta` nem a instituição.
 *
 *  Cada caso cria a PRÓPRIA conta pelo caminho da tela e espera o que ELE criou
 *  (regra 1 do cabeçalho de `helpers.ts`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ENTRADA COM DOIS VÍNCULOS (FASE 83)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a fatia 2 da F83, quem tinha 2+ vínculos ativos e nenhum cookie caía no
 *  painel do vínculo "escolhido" pela ordem antiga (`tenant.name`) — e podia cair
 *  no resíduo de uma inscrição pública. A regra passou a PERGUNTAR. Os casos 9 e
 *  10 medem os dois lados no navegador: sem cookie → seletor; depois da escolha
 *  feita pelo menu (`switchTenantAction` de verdade) → painel do escolhido,
 *  inclusive na entrada seguinte.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import {
  RUN_ID,
  cleanupRun,
  createTenant,
  e2eDb,
  grantPlatformRole,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const ORIGIN = 'http://localhost:3000';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

/**
 * Sai da conta pela rota da biblioteca.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O CORPO `{}` NÃO É ENFEITE (medido nesta fase)
 * ─────────────────────────────────────────────────────────────────────────────
 *  `POST /api/auth/sign-out` SEM corpo responde **415** ("Content-Type is
 *  required") e NÃO limpa cookie nenhum. O padrão repetido em outras specs
 *  (`post('/api/auth/sign-out', { headers: { origin } })`) é um no-op silencioso:
 *  elas continuam funcionando porque o login seguinte sobrescreve o cookie de
 *  sessão. Aqui isso não serve — o caso 4 precisa de um visitante DE VERDADE na
 *  tela de login —, então o corpo JSON é enviado e a resposta é conferida.
 */
async function sairDaConta(page: import('@playwright/test').Page): Promise<void> {
  const response = await page.request.post('/api/auth/sign-out', {
    headers: { origin: ORIGIN },
    data: {},
  });

  expect(response.ok(), `sign-out respondeu ${response.status()}`).toBe(true);
}

/**
 * Cria a conta pelo FORMULÁRIO e devolve o e-mail.
 *
 * A conta nasce sem vínculo e sem convite, então o destino esperado é a
 * descoberta de eventos — o degrau 5 da regra, exercitado de graça por todo
 * cadastro da suíte.
 */
async function cadastrarPeloFormulario(
  page: import('@playwright/test').Page,
  name: string,
): Promise<string> {
  const email = uniqueEmail('f82');

  await page.goto('/signup');
  await page.getByLabel('Nome completo').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Criar conta' }).click();

  await expect(page).toHaveURL(/\/eventos$/, { timeout: 30_000 });

  return email;
}

/** Entra pelo formulário, opcionalmente com o destino pretendido na URL. */
async function entrarPeloFormulario(
  page: import('@playwright/test').Page,
  email: string,
  redirectTo?: string,
): Promise<void> {
  const destino = redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : '';

  await page.goto(`/login${destino}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test.describe('a porta de entrada', () => {
  test('1. superadmin pelo formulário vai para a governança da plataforma', async ({ page }) => {
    const email = await cadastrarPeloFormulario(page, `Superadmin ${RUN_ID}`);
    const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

    /**
     * A concessão nasce DEPOIS do cadastro, pelo caminho administrativo real
     * (`grantPlatformRole`), então a conta é de uma pessoa comum até aqui — é a
     * entrada seguinte que precisa reconhecê-la como operadora.
     */
    await grantPlatformRole({ userId: user.id });
    await sairDaConta(page);

    await entrarPeloFormulario(page, email);

    /**
     * O destino é `/superadmin/metricas` (a constante do domínio), e não o índice:
     * `/superadmin` é um redirect para as métricas. Exigir o caminho final prende
     * as duas coisas — que a regra foi consultada e que a governança abriu.
     */
    await expect(page).toHaveURL(/\/superadmin\/metricas$/, { timeout: 30_000 });
    await expect(page.getByTestId('platform-overview')).toBeVisible();
  });

  test('2. pessoa nova, sem vínculo, cai na descoberta de eventos', async ({ page }) => {
    await cadastrarPeloFormulario(page, `Pessoa Nova ${RUN_ID}`);

    // A tela de descoberta, não o seletor vazio: há para onde ir sem vínculo.
    await expect(page.getByTestId('public-events-directory')).toBeVisible();
    await expect(page).not.toHaveURL(/selecionar-instituicao/);
  });

  test('3. membro com um vínculo entra direto no painel da instituição', async ({ page }) => {
    const email = await cadastrarPeloFormulario(page, `Membro ${RUN_ID}`);
    const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

    const tenant = await createTenant({
      label: 'f82-vinculo',
      name: `Instituição da Porta ${RUN_ID}`,
    });

    await linkUser({ tenantId: tenant.id, userId: user.id });
    await grantRole({ tenantId: tenant.id, userId: user.id, role: 'PARTICIPANT' });
    await sairDaConta(page);

    await entrarPeloFormulario(page, email);

    // Um vínculo ATIVO basta: o painel é o degrau 3, na frente do convite/descoberta.
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboard$`), { timeout: 30_000 });
    await expect(page.getByTestId('active-tenant')).toContainText(tenant.name);
  });

  test('4. `redirectTo` vence a regra e devolve a pessoa ao destino pedido', async ({ page }) => {
    const email = await cadastrarPeloFormulario(page, `Volta ${RUN_ID}`);

    await sairDaConta(page);

    /**
     * `/conta` é global (existe sem vínculo) e NÃO é o destino padrão de ninguém
     * — por isso serve de prova: se o formulário ignorasse o `redirectTo`, a
     * pessoa cairia em `/eventos` (o degrau 5) e o teste reprovaria.
     *
     * Note que NENHUM `tenantSlug` viaja no formulário: era exatamente a condição
     * que fazia o destino ser ignorado antes desta fatia.
     */
    await entrarPeloFormulario(page, email, '/conta');

    await expect(page).toHaveURL(/\/conta$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /minha conta/i })).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //  A PORTA DE VOLTA NA TELA DO SELETOR (FASE 82 · fatia 3)
  // ─────────────────────────────────────────────────────────────────────────────
  test('5. com um vínculo, o link do seletor leva ao painel da instituição', async ({ page }) => {
    const email = await cadastrarPeloFormulario(page, `Painel ${RUN_ID}`);
    const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

    const tenant = await createTenant({
      label: 'f82-painel',
      name: `Instituição do Painel ${RUN_ID}`,
    });

    await linkUser({ tenantId: tenant.id, userId: user.id });
    await grantRole({ tenantId: tenant.id, userId: user.id, role: 'PARTICIPANT' });

    await page.goto('/selecionar-instituicao');

    /**
     * A PROVA DO DEFEITO ORIGINAL: com UM vínculo, a linha do seletor é um
     * `<span>` "Contexto atual" — não há botão "Entrar". Sem o link do rodapé,
     * esta tela não teria NENHUM caminho para o painel.
     */
    await expect(page.getByTestId('tenant-options')).toContainText(tenant.name);
    await expect(page.getByTestId('tenant-options')).toContainText('Contexto atual');
    await expect(page.getByTestId('tenant-options').getByRole('button', { name: 'Entrar' })).toHaveCount(0);

    const link = page.getByRole('link', { name: 'Ir ao painel da instituição' });

    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/t/${tenant.slug}/dashboard`);
    // O rótulo antigo apontava para a VITRINE e não dizia isso.
    await expect(page.getByRole('link', { name: 'Página inicial' })).toHaveCount(0);

    await link.click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboard$`), { timeout: 30_000 });
    await expect(page.getByTestId('active-tenant')).toContainText(tenant.name);
  });

  test('6. sem vínculo, o link do seletor leva à descoberta de eventos', async ({ page }) => {
    await cadastrarPeloFormulario(page, `Descoberta ${RUN_ID}`);

    /**
     * A entrada já manda a pessoa sem vínculo para `/eventos`; o seletor
     * continua alcançável (é a tela que diz "não há vínculo") e é lá que o
     * caminho alternativo precisa existir — antes só havia "Sair da conta".
     */
    await page.goto('/selecionar-instituicao');

    await expect(
      page.getByRole('heading', { name: 'Nenhuma instituição vinculada' }),
    ).toBeVisible();

    const link = page.getByRole('link', { name: 'Explorar eventos' });

    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/eventos');
    await expect(page.getByRole('link', { name: 'Ir ao painel da instituição' })).toHaveCount(0);

    await link.click();

    await expect(page).toHaveURL(/\/eventos$/, { timeout: 30_000 });
    await expect(page.getByTestId('public-events-directory')).toBeVisible();
  });

  test('7. só com convite pendente, o seletor mostra o convite e oferece a descoberta', async ({
    page,
  }) => {
    const email = await cadastrarPeloFormulario(page, `Convidada ${RUN_ID}`);
    const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

    const tenant = await createTenant({
      label: 'f82-convite',
      name: `Instituição do Convite ${RUN_ID}`,
    });

    /**
     * Convite pendente NÃO é vínculo operacional: não há painel para onde ir, e
     * é justamente por isso que a tela não pode virar um redirect puro (aqui é
     * onde o convite aparece). O destino alternativo é a descoberta.
     */
    await linkUser({ tenantId: tenant.id, userId: user.id, status: 'INVITED' });

    await page.goto('/selecionar-instituicao');

    await expect(page.getByTestId('tenant-options')).toContainText(tenant.name);
    await expect(page.getByTestId('tenant-options')).toContainText('convite pendente');

    const link = page.getByRole('link', { name: 'Explorar eventos' });

    await expect(link).toHaveAttribute('href', '/eventos');
    await expect(page.getByRole('link', { name: 'Ir ao painel da instituição' })).toHaveCount(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //  A PORTA DE VOLTA DO OPERADOR DE PLATAFORMA (FASE 82 · fatia 3)
  // ─────────────────────────────────────────────────────────────────────────────
  test('8. o bloco de conta da plataforma oferece /conta e o caminho à instituição', async ({
    page,
  }) => {
    const email = await cadastrarPeloFormulario(page, `Operador ${RUN_ID}`);
    const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

    await grantPlatformRole({ userId: user.id });

    const tenant = await createTenant({
      label: 'f82-plataforma',
      name: `Instituição do Operador ${RUN_ID}`,
    });

    await linkUser({ tenantId: tenant.id, userId: user.id });
    await grantRole({ tenantId: tenant.id, userId: user.id, role: 'PARTICIPANT' });

    /**
     * Entrar DIRETO em `/superadmin` era o caminho do operador que ficava sem
     * porta: o painel não tem link para `/conta` e o bloco de conta era montado
     * sem os vínculos. A concessão foi criada depois do cadastro, então esta
     * navegação é a primeira em que a guarda o reconhece como operador.
     */
    await page.goto('/superadmin/metricas');
    await expect(page.getByTestId('platform-overview')).toBeVisible();

    /**
     * DOIS blocos de conta no DOM (barra lateral e a gaveta mobile, ambas as
     * cópias do MESMO elemento no shell) — o `first()` é o da barra lateral, que
     * é o visível no viewport do teste.
     */
    const bloco = page
      .locator('details')
      .filter({ has: page.getByTestId('account-tenant-menu') })
      .first();

    await bloco.locator('summary').click();

    /** A PRIMEIRA porta: a área de conta, que é global. */
    const conta = bloco.getByTestId('menu-my-account');
    await expect(conta).toBeVisible();
    await expect(conta).toHaveAttribute('href', '/conta');

    /** A SEGUNDA: a instituição do operador, direto pelo menu (sem `currentSlug`). */
    const linhaDaInstituicao = bloco.locator(`input[name="tenantSlug"][value="${tenant.slug}"]`);
    await expect(linhaDaInstituicao).toHaveCount(1);

    /**
     * No MENU de conta a linha inteira é o botão (nome da instituição + papéis),
     * ao contrário do seletor de `/selecionar-instituicao`, onde o botão é
     * "Entrar". Clicar pela linha é clicar no controle que a pessoa vê.
     */
    await bloco.getByRole('button', { name: new RegExp(tenant.name) }).click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboard$`), { timeout: 30_000 });
    await expect(page.getByTestId('active-tenant')).toContainText(tenant.name);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //  DOIS VÍNCULOS: A ENTRADA PERGUNTA, E A ESCOLHA VENCE NA PRÓXIMA (FASE 83)
  // ─────────────────────────────────────────────────────────────────────────────
  test('9. com dois vínculos ativos e sem cookie, a entrada pergunta a instituição', async ({
    page,
  }) => {
    const email = await cadastrarPeloFormulario(page, `Duas Casas ${RUN_ID}`);
    const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

    const alfa = await createTenant({
      label: 'f83-alfa',
      name: `Instituição Alfa ${RUN_ID}`,
    });
    const beta = await createTenant({
      label: 'f83-beta',
      name: `Instituição Beta ${RUN_ID}`,
    });

    await linkUser({ tenantId: alfa.id, userId: user.id });
    await linkUser({ tenantId: beta.id, userId: user.id });

    await sairDaConta(page);
    await entrarPeloFormulario(page, email);

    /**
     * A MUDANÇA DE EFEITO QUE ESTA FATIA MEDE: antes, a regra olhava só SE havia
     * vínculo ativo e mandava ao "primeiro" (ordem alfabética do nome). Com dois,
     * a resposta não é nossa — a entrada abre a PERGUNTA.
     */
    await expect(page).toHaveURL(/\/selecionar-instituicao$/, { timeout: 30_000 });

    const opcoes = page.getByTestId('tenant-options');
    await expect(opcoes).toContainText(alfa.name);
    await expect(opcoes).toContainText(beta.name);

    // E não abriu o painel de NENHUMA das duas: perguntar não é escolher.
    await expect(page).not.toHaveURL(/\/t\/f83-(alfa|beta)-.*\/dashboard$/);
  });

  test('10. a escolha pelo menu grava o cookie e a entrada seguinte vai direto ao painel', async ({
    page,
  }) => {
    const email = await cadastrarPeloFormulario(page, `Escolhe Casa ${RUN_ID}`);
    const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

    const alfa = await createTenant({
      label: 'f83-menu-alfa',
      name: `Instituição Menu Alfa ${RUN_ID}`,
    });
    const beta = await createTenant({
      label: 'f83-menu-beta',
      name: `Instituição Menu Beta ${RUN_ID}`,
    });

    await linkUser({ tenantId: alfa.id, userId: user.id });
    await linkUser({ tenantId: beta.id, userId: user.id });

    await sairDaConta(page);
    await entrarPeloFormulario(page, email);

    await expect(page).toHaveURL(/\/selecionar-instituicao$/, { timeout: 30_000 });

    /** A primeira escolha é pelo seletor — e Alfa já é o contexto implícito. */
    const linhaAlfa = page
      .getByTestId('tenant-options')
      .locator('li')
      .filter({ has: page.locator(`input[name="tenantSlug"][value="${alfa.slug}"]`) });

    await expect(linhaAlfa.getByText('Contexto atual')).toBeVisible();
    await page.getByRole('link', { name: 'Ir ao painel da instituição' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alfa.slug}/dashboard$`), { timeout: 30_000 });
    await expect(page.getByTestId('active-tenant')).toContainText(alfa.name);

    /**
     * A troca de verdade é pelo MENU de conta: é `switchTenantAction` gravando o
     * cookie `ef_tenant` — não um `goto` para a URL da outra instituição (que
     * cairia no seletor, porque o contexto ainda é o de Alfa).
     *
     * A casca renderiza DUAS cópias do bloco de conta (barra lateral e gaveta
     * mobile), e a PRIMEIRA no DOM é a oculta: `:visible` escolhe a que a pessoa
     * vê neste viewport — foi o que o E2E mediu (`details.first()` pegava a
     * cópia oculta e o clique esperava para sempre).
     */
    await page.locator('summary:visible').first().click();

    const menuItemBeta = page.locator('li:visible', { hasText: beta.name });
    await menuItemBeta.getByRole('button').click();

    await expect(page).toHaveURL(new RegExp(`/t/${beta.slug}/dashboard$`), { timeout: 30_000 });
    await expect(page.getByTestId('active-tenant')).toContainText(beta.name);

    /**
     * A ENTRADA SEGUINTE: sair da conta não apaga o `ef_tenant`. Com dois
     * vínculos e o cookie de Beta revalidado, o degrau 3 da regra vence a
     * contagem — a pessoa não é perguntada de novo.
     */
    await sairDaConta(page);
    await entrarPeloFormulario(page, email);

    await expect(page).toHaveURL(new RegExp(`/t/${beta.slug}/dashboard$`), { timeout: 30_000 });
    await expect(page.getByTestId('active-tenant')).toContainText(beta.name);
  });
});
