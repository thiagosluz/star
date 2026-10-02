import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O TEMA ESCOLHIDO VALE NO SISTEMA INTEIRO (FASE 61 · dívida H3)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  O pedido é "tema escuro completo", e o que ele exige de prova não é a escala de
 *  cores (essa é do `globals.css`, medida por outro portão): é a FIAÇÃO da escolha.
 *  Um tema que só vale na tela em que foi escolhido está quebrado para quem
 *  trabalha nele, e nem o HTML nem o CSS pegariam isso.
 *
 *  Este arquivo percorre o caminho inteiro pelo navegador:
 *
 *    1. a página nasce em `sistema` (`data-tema="sistema"`, sem a classe `.dark`) —
 *       a escolha de quem nunca escolheu é do sistema operacional, e quem responde
 *       por ela é a `@media (prefers-color-scheme: dark)`, não o servidor;
 *    2. escolher **Escuro** no menu de conta escreve a classe `.dark` no `<html>`,
 *       o `data-tema` acompanha e a COR DE FUNDO computada muda de verdade (a
 *       classe sozinha não prova nada: um seletor errado no CSS deixaria o
 *       atributo no lugar e a tela clara);
 *    3. **navegar para outra tela** continua escuro;
 *    4. **recarregar por completo** continua escuro — a prova de que o estado é do
 *       SERVIDOR e não da memória do cliente;
 *    5. a escolha vale também FORA do casco (`/conta`), e o cookie é `httpOnly`:
 *       o navegador o envia, o JavaScript da página não o lê;
 *    6. voltar para **Claro** devolve exatamente a cor de fundo do começo;
 *    7. escolher **Sistema** deixa `data-tema="sistema"` e NÃO escreve a classe —
 *       nem quando o sistema operacional está no escuro (emulado no fim).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UMA SEGUNDA PASSADA SEM JAVASCRIPT NENHUM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O segundo teste roda com `javaScriptEnabled: false`. É o que prende o requisito
 *  "sem estado só no cliente": o controle é um `<form>` com Server Action, o
 *  `<details>` do menu é HTML nativo, e a troca de tema tem de acontecer com o
 *  navegador sem executar uma linha de script.
 */
const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f61-tema-${RUN_ID}`;

let tenantSlug: string;
let pessoa: { id: string; email: string };

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f61.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { id: user.id, email };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/**
 * A CLASSE `.dark` está no `<html>`?
 *
 * `classList` e não `toHaveClass(/dark/)`: a lista de classes do `<html>` também
 * carrega as variáveis das fontes do `next/font` (`__variable_xxxx`), e uma
 * expressão regular que casasse com um desses nomes daria verde sem a classe.
 */
function classeEscura(page: Page): Promise<boolean> {
  return page.locator('html').evaluate((elemento) => elemento.classList.contains('dark'));
}

/**
 * A cor de fundo REALMENTE pintada.
 *
 * Lida do `<body>` porque é ele que carrega `bg-background` — o `<html>` não pinta
 * fundo nenhum, e ler `background-color` de lá devolveria transparente nas duas
 * situações (o teste passaria sem provar coisa alguma).
 */
function corDeFundo(page: Page): Promise<string> {
  return page.locator('body').evaluate((elemento) => getComputedStyle(elemento).backgroundColor);
}

/** Soma dos canais RGB — a régua grosseira e suficiente para "escureceu de verdade". */
function somaLuz(rgb: string): number {
  return (rgb.match(/\d+/g) ?? [])
    .slice(0, 3)
    .map((valor) => Number(valor))
    .reduce((total, valor) => total + valor, 0);
}

/**
 * O `color-scheme` computado, em pedaços.
 *
 * Comparado por PEDAÇO e não por igualdade: `light dark` (o valor do modo
 * `sistema`) contém os dois, e a ordem/forma exata da string é do navegador — o
 * que importa é a página estar dizendo ao navegador qual esquema os controles
 * nativos devem usar.
 */
async function esquemaDeCor(page: Page): Promise<string[]> {
  const valor = await page
    .locator('html')
    .evaluate((elemento) => getComputedStyle(elemento).colorScheme);

  return valor.split(/\s+/).filter(Boolean);
}

/**
 * O bloco de conta aparece DUAS vezes no DOM: no rodapé da barra lateral e na
 * gaveta do mobile (`MobileNav`). A gaveta vive fora da tela, mas existe — e o
 * Playwright reprova em modo estrito ("resolved to 2 elements") mesmo com um dos
 * elementos escondido por CSS. É a mesma armadilha que o `app-shell.tsx` documenta
 * para o `data-testid="active-tenant"`, e por isso toda consulta do menu de conta
 * é feita DENTRO da barra lateral de desktop (`aside[data-nav]`), que é única.
 */
function menuDeTema(page: Page) {
  return page.locator('aside[data-nav]').getByTestId('account-theme-menu');
}

function opcaoDeTema(page: Page, modo: string) {
  return page.locator('aside[data-nav]').getByTestId(`theme-option-${modo}`);
}

/**
 * Abre ou fecha o painel do menu de conta, de forma IDEMPOTENTE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO BASTA CLICAR NO `<summary>`
 * ─────────────────────────────────────────────────────────────────────────────
 *  O painel abre para CIMA e passa por cima da barra lateral — se ele ficar aberto
 *  quando o teste for clicar num item de menu, o Playwright espera o elemento
 *  deixar de estar coberto e o cenário morre por "intercepts pointer events". E o
 *  estado de `open` de um `<details>` é do DOM, não do React: depois de uma Server
 *  Action ele pode continuar aberto (ou voltar fechado), então "clicar de novo"
 *  tanto pode fechar quanto reabrir.
 *
 *  A pergunta é feita ao NAVEGADOR (`isVisible`), e não ao atributo `open`: painel
 *  fechado não é desenhado, então "está visível" é exatamente a pergunta que o
 *  passo seguinte precisa responder — e é também a condição que o Playwright cobra
 *  antes de aceitar o clique. Vale nos dois mundos: com JavaScript ligado e com
 *  `javaScriptEnabled: false` (a API do Playwright continua funcionando; quem não
 *  roda é o script DA PÁGINA).
 */
async function definirMenuDeTema(page: Page, aberto: boolean): Promise<void> {
  const visivel = await opcaoDeTema(page, 'sistema').isVisible();

  if (visivel !== aberto) {
    await menuDeTema(page).click();
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Tema ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;

    /**
     * A pessoa é da EQUIPE: o menu de conta vive no rodapé do casco autenticado, e é
     * de lá que o tema é escolhido no caminho principal deste arquivo.
     */
    pessoa = await signUpVia(api, 'Pessoa do Tema');
    await linkUser({ tenantId: tenant.id, userId: pessoa.id, kind: 'MEMBER' });
    await grantRole({ tenantId: tenant.id, userId: pessoa.id, role: 'ADMIN' });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test('1. a escolha do tema atravessa telas, o recarregamento e o casco', async ({ page }) => {
  await signInAs(page, pessoa.email);
  await page.goto(`/t/${tenantSlug}/dashboard`);

  const html = page.locator('html');

  // ── 1. O estado de origem: quem não escolheu segue o sistema ────────────────
  await expect(html).toHaveAttribute('data-tema', 'sistema');
  await expect.poll(() => classeEscura(page)).toBe(false);

  const corClara = await corDeFundo(page);
  expect(corClara, 'o body precisa ter fundo pintado — transparente não prova nada').not.toBe(
    'rgba(0, 0, 0, 0)',
  );

  /** Em `sistema` a página ACEITA os dois esquemas e o navegador decide. */
  expect(await esquemaDeCor(page)).toContain('light');
  expect(await esquemaDeCor(page)).toContain('dark');

  // ── 2. Escolher Escuro pelo menu de conta ──────────────────────────────────
  /**
   * O menu abre no clique, e antes disso a opção ATUAL já é anunciada: é o
   * `aria-pressed` que responde "qual está valendo" para quem não vê a cor do
   * preenchimento.
   */
  await definirMenuDeTema(page, true);

  await expect(opcaoDeTema(page, 'sistema')).toHaveAttribute('aria-pressed', 'true');
  await expect(opcaoDeTema(page, 'escuro')).toHaveAttribute('aria-pressed', 'false');

  await opcaoDeTema(page, 'escuro').click();

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A MARCAÇÃO MUDA SEM RECARREGAR — E ISSO É REQUISITO, NÃO CONFORTO
   * ─────────────────────────────────────────────────────────────────────────────
   *  A Server Action responde com a árvore redesenhada (`revalidatePath('/', 'layout')`)
   *  e o `<html>` é a raiz dessa árvore. Se o clique só mudasse a marcação depois de
   *  um F5, a pessoa clicaria "Escuro" e a tela continuaria clara — que é o defeito
   *  que esta fase existe para não ter.
   */
  await expect(html).toHaveAttribute('data-tema', 'escuro');
  await expect.poll(() => classeEscura(page)).toBe(true);

  /**
   * A COR, e não a classe: um seletor `.dark` que não existisse (ou que apontasse
   * para as variáveis erradas) deixaria a marcação correta e a tela clara. A régua
   * é comparativa de propósito — a escala escura é de outro dono, e prender o
   * valor exato aqui faria este teste reprovar toda vez que ela fosse ajustada.
   */
  const corEscura = await corDeFundo(page);
  expect(corEscura).not.toBe(corClara);
  expect(somaLuz(corEscura)).toBeLessThan(somaLuz(corClara));

  /**
   * O `color-scheme` acompanha para a barra de rolagem e os controles nativos: sem
   * ele, o formulário continuaria branco dentro da página escura.
   */
  const esquemaEscuro = await esquemaDeCor(page);
  expect(esquemaEscuro).toContain('dark');
  expect(esquemaEscuro).not.toContain('light');

  // ── 3. Navegar para outra tela do painel mantém a escolha ──────────────────
  /** O painel do menu cobre a barra: fecha antes de usar um item de navegação. */
  await definirMenuDeTema(page, false);

  await page
    .locator('aside[data-nav]')
    .getByRole('link', { name: 'Minhas inscrições', exact: true })
    .click();
  await page.waitForURL(`**/t/${tenantSlug}/minhas-inscricoes`);

  await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');
  await expect.poll(() => classeEscura(page)).toBe(true);

  // ── 4. A prova mais dura: um RECARREGAMENTO COMPLETO ───────────────────────
  /**
   * A navegação entre telas já re-renderiza o layout no servidor, mas o `reload`
   * descarta qualquer memória do cliente. Se a página voltasse clara aqui, o estado
   * estaria no JavaScript — e não no cookie.
   */
  await page.reload();

  await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');
  await expect.poll(() => classeEscura(page)).toBe(true);
  expect(await corDeFundo(page)).toBe(corEscura);

  // ── 5. O cookie é do SERVIDOR: httpOnly, e o cliente não o lê ──────────────
  const cookie = (await page.context().cookies()).find((item) => item.name === 'ef_tema');

  expect(cookie, 'o cookie ef_tema precisa existir depois da escolha').toBeTruthy();
  expect(cookie?.value).toBe('escuro');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(
    await page.evaluate(() => document.cookie.includes('ef_tema')),
    'httpOnly significa que o JavaScript da página não enxerga a preferência',
  ).toBe(false);

  // ── 6. FORA do casco a escolha continua valendo ────────────────────────────
  /**
   * `/conta` é uma tela global: não tem barra lateral nem shell de instituição. Se
   * a leitura do cookie morasse no casco, esta navegação devolveria a página clara —
   * e é exatamente o defeito que a fase existe para não ter.
   */
  await page.goto('/conta');

  await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');
  await expect.poll(() => classeEscura(page)).toBe(true);
  await expect(page.getByTestId('theme-option-escuro')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('theme-option-claro')).toHaveAttribute('aria-pressed', 'false');

  // ── 7. Voltar para Claro ───────────────────────────────────────────────────
  await page.getByTestId('theme-option-claro').click();

  await expect(page.locator('html')).toHaveAttribute('data-tema', 'claro');
  await expect.poll(() => classeEscura(page)).toBe(false);

  /** O claro EXPLÍCITO vence o sistema operacional: o esquema vira só `light`. */
  const esquemaClaro = await esquemaDeCor(page);
  expect(esquemaClaro).toContain('light');
  expect(esquemaClaro).not.toContain('dark');

  /** E a cor volta a ser EXATAMENTE a do começo: não há tema "quase claro". */
  expect(await corDeFundo(page)).toBe(corClara);

  // ── 8. Sistema: o atributo fica, a classe NÃO ──────────────────────────────
  await page.getByTestId('theme-option-sistema').click();

  await expect(page.locator('html')).toHaveAttribute('data-tema', 'sistema');
  await expect.poll(() => classeEscura(page)).toBe(false);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  E O SERVIDOR CONTINUA NÃO DECIDINDO PELO SISTEMA OPERACIONAL
   * ─────────────────────────────────────────────────────────────────────────────
   *  Com o sistema operacional EMULADO no escuro, a marcação não pode mudar: em
   *  `sistema` quem responde é a `@media (prefers-color-scheme: dark)` do CSS, e é
   *  por isso que a classe `.dark` continua ausente. Se o servidor escrevesse a
   *  classe aqui, a página ficaria presa no escuro e a media query perderia a voz.
   *
   *  A COR não é medida nesta passada de propósito: a escala escura é do
   *  `globals.css`, e este arquivo não é o portão dela.
   */
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();

  await expect(page.locator('html')).toHaveAttribute('data-tema', 'sistema');
  await expect.poll(() => classeEscura(page)).toBe(false);
});

test.describe('sem JavaScript', () => {
  /**
   * O navegador não executa script nenhum da PÁGINA nesta passada (a API do
   * Playwright continua funcionando). Tudo o que acontecer daqui para baixo é HTML,
   * formulário e servidor — que é como a casa desenha as telas que não podem
   * depender de hidratação (FASES 38, 39 e 59), e é o mesmo caminho que a
   * `inline-action-without-js.spec.ts` (FASE 50) usa para prender a dívida E50.
   */
  test.use({ javaScriptEnabled: false });

  test('2. a escolha é gravada sem uma linha de JavaScript no cliente', async ({ page }) => {
    await signInAs(page, pessoa.email);
    await page.goto(`/t/${tenantSlug}/dashboard`);

    const html = page.locator('html');

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PRIMEIRA RESPOSTA JÁ TRAZ O TEMA — É ISSO QUE "NÃO PISCA" SIGNIFICA
     * ─────────────────────────────────────────────────────────────────────────────
     *  Sem JavaScript não existe a possibilidade de um script no `<head>` corrigir
     *  a tela depois: se o tema não estiver no HTML que o servidor entregou, ele
     *  simplesmente não existe.
     */
    await expect(html).toHaveAttribute('data-tema', 'sistema');
    await expect(html).not.toHaveAttribute('class', /(^|\s)dark(\s|$)/);

    /** O `<details>` do menu de conta é HTML nativo: abre sem script. */
    await definirMenuDeTema(page, true);
    await opcaoDeTema(page, 'escuro').click();

    /**
     * O POST do formulário chegou ao servidor e o servidor redesenhou o `<html>` com
     * a classe `.dark` — sem hidratação, sem `onChange` e sem estado no cliente.
     */
    await expect(html).toHaveAttribute('data-tema', 'escuro');
    await expect(html).toHaveAttribute('class', /(^|\s)dark(\s|$)/);

    /**
     * A COR não é medida nesta passada de propósito: ela já é medida (e comparada
     * com o claro) no teste 1, e a escala escura é do `globals.css` — aqui o que
     * está em julgamento é o CAMINHO da escolha, não o tom.
     */

    /** E a escolha volta, também sem script, pelo mesmo caminho. */
    await definirMenuDeTema(page, true);
    await opcaoDeTema(page, 'claro').click();

    await expect(html).toHaveAttribute('data-tema', 'claro');
    await expect(html).not.toHaveAttribute('class', /(^|\s)dark(\s|$)/);
  });
});
