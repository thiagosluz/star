import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { RUN_ID, createTenant, e2eDb, grantRole, linkUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A BARRA LATERAL DO PAINEL ENCOLHE (FASE 59)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  O pedido foi curto — "o sidebar poderia ter uma opção de colapsar" — e o que
 *  ele exige de prova não é o desenho: é a PERSISTÊNCIA. Uma barra que encolhe e
 *  volta a abrir na tela seguinte está quebrada para quem trabalha nela, e nenhum
 *  teste de HTML pegaria isso.
 *
 *  Este arquivo percorre o caminho inteiro pelo navegador:
 *
 *    1. a barra nasce INTEIRA (`data-nav="full"`);
 *    2. o botão "Recolher menu" a encolhe — e o botão passa a se chamar
 *       "Expandir menu", que é a AÇÃO, com `aria-expanded` coerente;
 *    3. **navegar para outra tela mantém a barra recolhida** — a prova do cookie
 *       lido no servidor, que é onde este estado mora;
 *    4. clicar de novo devolve a barra inteira.
 *
 *  Os ícones sozinhos não bastam: na barra recolhida cada item continua com nome
 *  acessível (é o que o portão WCAG cobra em `link-name`), e o teste prende isso
 *  do lado de fora, olhando o que o navegador expõe — não a classe do CSS.
 */
const PASSWORD = 'EventFlow#2026';
const TENANT_LABEL = `f59-nav-${RUN_ID}`;

let tenantId: string;
let tenantSlug: string;
let pessoa: { id: string; email: string };

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f59.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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

async function signInAs(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição da Barra ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    /**
     * A pessoa é da EQUIPE: a barra recolhida precisa encontrar o menu cheio
     * (grupos de participação, operação e administração) para que a navegação do
     * passo 3 seja um clique de verdade num item do menu.
     */
    pessoa = await signUpVia(api, 'Pessoa da Barra');
    await linkUser({ tenantId, userId: pessoa.id, kind: 'MEMBER' });
    await grantRole({ tenantId, userId: pessoa.id, role: 'ADMIN' });
  } finally {
    await api.dispose();
  }
});

test('1. a barra nasce inteira, recolhe, PERSISTE na navegação e volta', async ({ page }) => {
  await signInAs(page, pessoa.email);
  await page.goto(`/t/${tenantSlug}/dashboard`);

  const barra = page.locator('aside[data-nav]');
  const botao = page.getByTestId('nav-collapse-toggle');

  // ── 1. O estado de origem ────────────────────────────────────────────────────
  await expect(barra).toHaveAttribute('data-nav', 'full');
  await expect(botao).toBeVisible();

  /**
   * O nome acessível do botão diz o que ele FAZ, e `aria-expanded` diz em que
   * estado a barra está. Um botão que só dissesse "menu" obrigaria quem usa
   * leitor de tela a adivinhar o efeito do clique.
   */
  await expect(botao).toHaveAccessibleName('Recolher menu');
  await expect(botao).toHaveAttribute('aria-expanded', 'true');

  // ── 2. Recolher ──────────────────────────────────────────────────────────────
  await botao.click();

  await expect(barra).toHaveAttribute('data-nav', 'rail');
  await expect(botao).toHaveAccessibleName('Expandir menu');
  await expect(botao).toHaveAttribute('aria-expanded', 'false');

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  ÍCONE SEM NOME REPROVA O PORTÃO — E O NOME NÃO PODE SAIR DA ÁRVORE
   * ─────────────────────────────────────────────────────────────────────────────
   *  Na barra recolhida o rótulo some da TELA, mas continua na árvore de
   *  acessibilidade (`sr-only`): é isso que faz o item ser anunciado pelo nome do
   *  destino, e é o que o `title` devolve ao ponteiro.
   */
  const painel = barra.getByRole('link', { name: 'Painel', exact: true });
  await expect(painel).toBeVisible();
  await expect(painel).toHaveAccessibleName('Painel');
  await expect(painel).toHaveAttribute('title', 'Painel');

  /**
   * E o rótulo realmente NÃO está desenhado: sem esta conferência, um `sr-only`
   * esquecido (ou trocado por `hidden`) passaria como "recolhido" com o texto
   * inteiro à mostra — o estado estaria errado e o teste, verde.
   *
   * A régua é a CAIXA do rótulo: `sr-only` o reduz a 1 px, e o texto visível de
   * um item de menu mede dezenas de pixels de largura.
   */
  const larguraDoRotulo = async (nome: string) =>
    page
      .locator('aside[data-nav]')
      .getByRole('link', { name: nome, exact: true })
      .getByTestId('nav-link-label')
      .evaluate((elemento) => elemento.getBoundingClientRect().width);

  expect(await larguraDoRotulo('Painel')).toBeLessThanOrEqual(1);

  // ── 3. A PROVA: navegar não devolve a barra ao estado inicial ────────────────
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A NAVEGAÇÃO É PARA DENTRO DO PAINEL (o item "Eventos" sai do casco)
   * ─────────────────────────────────────────────────────────────────────────────
   *  "Eventos" leva à página PÚBLICA da instituição (`/t/<slug>/eventos`), que tem
   *  outro layout e **não tem barra lateral** — a asserção do `aside` falhava ali, e
   *  não porque o estado se perdeu. "Minhas inscrições" fica DENTRO do painel, que é
   *  onde a barra existe e onde a persistência pode ser medida.
   */
  await barra.getByRole('link', { name: 'Minhas inscrições', exact: true }).click();
  await page.waitForURL(`**/t/${tenantSlug}/minhas-inscricoes`);

  await expect(page.locator('aside[data-nav]')).toHaveAttribute('data-nav', 'rail');
  await expect(page.getByTestId('nav-collapse-toggle')).toHaveAccessibleName('Expandir menu');

  /**
   * E a prova mais dura: um RECARREGAMENTO COMPLETO.
   *
   * A navegação entre telas já re-renderiza o layout no servidor, mas um `reload`
   * é o que descarta qualquer memória do cliente — se a barra voltasse inteira
   * aqui, o estado estaria no JavaScript, e não no cookie. É a diferença entre um
   * estado que PERSISTE e um que apenas sobrevive à próxima navegação.
   */
  await page.reload();
  await expect(page.locator('aside[data-nav]')).toHaveAttribute('data-nav', 'rail');

  // ── 4. Expandir de novo ──────────────────────────────────────────────────────
  await page.getByTestId('nav-collapse-toggle').click();

  await expect(page.locator('aside[data-nav]')).toHaveAttribute('data-nav', 'full');
  await expect(page.getByTestId('nav-collapse-toggle')).toHaveAccessibleName('Recolher menu');

  /**
   * O rótulo voltou a ser TEXTO na tela: o mesmo item que estava só com ícone
   * volta a mostrar o nome. É a ida e volta completa da preferência.
   */
  expect(await larguraDoRotulo('Painel')).toBeGreaterThan(1);
});
