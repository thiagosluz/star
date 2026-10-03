import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { RUN_ID, cleanupRun, createTenant, e2eDb, grantRole, linkUser, trackTestUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O EDITOR DA PÁGINA DA INSTITUIÇÃO (FASE 64 · fatias 3 e 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM USA
 * ─────────────────────────────────────────────────────────────────────────────
 *  (a) **O organizador monta a página e vê a mudança no ar.** Abre o editor, edita
 *      título e descrição, sobe a CAPA por upload, salva o rascunho, PUBLICA e
 *      confere a página pública — o caminho inteiro, com o mesmo servidor que
 *      atende o visitante. É o requisito de aceite da fatia.
 *  (b) **Quem não tem a permissão não entra e não grava.** O vínculo existe e a
 *      pessoa está autenticada: o que falta é `page:manage`. A tela redireciona, e
 *      — o que importa — o banco continua sem rascunho.
 *  (c) **A paleta da instituição não mata o modo do visitante.** A página publicada
 *      é lida com o cookie `ef_tema` nos dois valores: o modo EFETIVO do escopo
 *      acompanha o visitante, e a identidade da casa (as cores escolhidas no
 *      editor) continua publicada nos dois. Uma paleta que vencesse o modo
 *      apareceria aqui como um `data-theme-mode` claro numa página pedida escura.
 *  (d) **A tela nova entra no portão WCAG AA.** A varredura é a MESMA do
 *      `accessibility.spec.ts` (mesmas tags, mesmos impactos, mesma catraca de
 *      landmark) e vive neste arquivo de propósito: a fase proíbe alterar
 *      `tests/e2e/accessibility.spec.ts`, e um portão que não roda não é portão.
 *      Levar o caso para lá é uma linha de mudança — relatada no documento da
 *      entrega.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ESPERA É O FATO, NUNCA O GESTO (regra 2 do `helpers.ts`)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada passo espera o que o SERVIDOR gravou (um `expect.poll` no banco ou o texto
 *  que a tela passou a mostrar por causa disso). O save da capa é o caso mais claro:
 *  o envio é do CLIENTE (três etapas: assina → envia → confirma), então o clique não
 *  prova nada — o que prova é a URL da capa estar na linha do banco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f64-editor';

const TITULO = `Instituto de Artes ${RUN_ID}`;
const DESCRICAO = 'A casa das artes, das letras e das ciências humanas.';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA COR É DIFERENTE DA PALETA PADRÃO DA INSTITUIÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  `TENANT_THEME_PALETTE.light.primary` é exatamente `#0f6f8c`. Usar o mesmo valor
 *  aqui faria o teste passar mesmo se a escolha da instituição fosse IGNORADA e o
 *  padrão entrasse no lugar — a asserção de estilo não distinguiria os dois casos.
 *  O roxo abaixo não existe em paleta nenhuma do sistema.
 */
const COR_ESCOLHIDA = '#7b2ff7';

/**
 * Um PNG 1×1 VERMELHO, em base64.
 *
 * É uma imagem DE VERDADE: o servidor baixa o objeto, confere tamanho e SHA-256 e
 * DECODIFICA com `sharp` para converter em WebP (FASE 46). Um arquivo inventado
 * seria recusado na conversão — e o teste mediria a recusa, não o caminho.
 */
const PNG_VERMELHO_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let tenant: { id: string; slug: string };
/** A instituição de quem está autenticado mas NÃO tem a permissão. */
let semPermissao: { id: string; slug: string };

let organizadoraEmail: string;
let organizadoraId: string;
let semPermissaoEmail: string;
let semPermissaoId: string;

async function signUpVia(
  api: APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f64ed.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  trackTestUser(user.id);

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

/** A linha da página no banco — lida pela conexão de plataforma, como o E2E faz. */
async function paginaNoBanco(tenantId: string) {
  return e2eDb.tenantPublicPage.findFirst({
    where: { tenantId },
    select: {
      id: true,
      title: true,
      description: true,
      coverImageUrl: true,
      theme: true,
      blocks: true,
      publishedSnapshot: true,
      publishedAt: true,
    },
  });
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GARANTE QUE A PÁGINA ESTÁ NO AR (regra 2 do `helpers.ts`)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Os casos desta spec rodam em ordem, e um deles despublica de propósito para
 *  medir o caminho de volta. Sem esta garantia, o próximo caso mediria uma página
 *  fora do ar e falharia por um motivo que não é dele. Esta função entra pela TELA
 *  (o botão de publicar), olha o FATO (o status no editor) e sai; se a página já
 *  está no ar, não faz nada.
 */
async function garantirNoAr(page: Page, tenantSlug: string): Promise<void> {
  await page.goto(`/t/${tenantSlug}/administracao/pagina`);

  const status = page.getByTestId('tenant-page-status');
  await expect(status).toBeVisible();

  if ((await status.textContent())?.includes('Publicada')) return;

  await page.getByTestId('tenant-page-publish').getByTestId('inline-submit').click();
  await expect(status).toContainText('Publicada');
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const criada = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição do Editor ${RUN_ID}`,
    });

    tenant = { id: criada.id, slug: criada.slug };

    const organizadora = await signUpVia(api, `Organizadora do Editor ${RUN_ID}`);
    organizadoraEmail = organizadora.email;
    organizadoraId = organizadora.id;

    await linkUser({ userId: organizadora.id, tenantId: tenant.id, kind: 'MEMBER' });
    await grantRole({ userId: organizadora.id, tenantId: tenant.id, role: 'ADMIN', scope: 'TENANT' });

    /** A segunda casa: aqui a pessoa tem vínculo e NÃO tem `page:manage`. */
    const outra = await createTenant({
      label: `${TENANT_LABEL}-sem-permissao`,
      name: `Instituição Sem Permissão ${RUN_ID}`,
    });

    semPermissao = { id: outra.id, slug: outra.slug };

    const participante = await signUpVia(api, `Participante Sem Permissão ${RUN_ID}`);
    semPermissaoEmail = participante.email;
    semPermissaoId = participante.id;

    await linkUser({ userId: participante.id, tenantId: outra.id, kind: 'MEMBER' });
    await grantRole({
      userId: participante.id,
      tenantId: outra.id,
      role: 'PARTICIPANT',
      scope: 'TENANT',
    });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await e2eDb.tenant.deleteMany({ where: { id: { in: [tenant.id, semPermissao.id] } } });
  await e2eDb.user.deleteMany({ where: { id: { in: [organizadoraId, semPermissaoId] } } });

  await cleanupRun();
  await e2eDb.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (a) O ORGANIZADOR EDITA, SOBE A CAPA, SALVA E PUBLICA
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(a) o organizador monta e publica a página', () => {
  test('edita título, descrição e capa; salva; publica; e vê a mudança no ar', async ({ page }) => {
    await signInAs(page, organizadoraEmail);

    const editor = `/t/${tenant.slug}/administracao/pagina`;
    const resposta = await page.goto(editor);

    expect(resposta?.status()).toBe(200);

    /**
     * ── A PRIMEIRA VEZ: A PÁGINA AINDA NÃO EXISTE ─────────────────────────────
     *  A instituição nunca abriu o editor, então o status diz que ela não está no ar
     *  e o banco não tem linha nenhuma. É o estado que a tela precisa mostrar sem
     *  quebrar (o read model devolve `null`).
     */
    await expect(page.getByTestId('tenant-page-status')).toContainText('não está no ar');
    expect(await paginaNoBanco(tenant.id)).toBeNull();

    /** ── TÍTULO, DESCRIÇÃO E A COR DA CASA ──────────────────────────────────── */
    await page.getByTestId('tenant-page-title-input').fill(TITULO);
    await page.getByTestId('tenant-page-description-input').fill(DESCRICAO);
    await page.getByLabel('Cor principal').fill(COR_ESCOLHIDA);

    await page.getByTestId('tenant-page-save').getByTestId('admin-submit').click();

    /**
     * A espera é o BANCO, e não o texto de sucesso: a Server Action pode responder
     * depois do `expect`, e o que interessa é o que foi gravado.
     */
    await expect
      .poll(async () => (await paginaNoBanco(tenant.id))?.title, {
        message: 'o rascunho não foi gravado',
      })
      .toBe(TITULO);

    const depoisDeSalvar = await paginaNoBanco(tenant.id);

    expect(depoisDeSalvar?.description).toBe(DESCRICAO);
    /** A paleta escolhida entrou no rascunho; o MODO não (quem decide é o visitante). */
    expect(depoisDeSalvar?.theme).toMatchObject({ primaryColor: COR_ESCOLHIDA });
    expect(depoisDeSalvar?.theme).not.toHaveProperty('backgroundColor');

    /** O rascunho NÃO publica: o snapshot no ar continua vazio. */
    expect(depoisDeSalvar?.publishedAt).toBeNull();

    /** ── A CAPA, POR UPLOAD DE VERDADE ──────────────────────────────────────── */
    await page.getByTestId('tenant-asset-input-TENANT_COVER').setInputFiles({
      name: 'capa-do-instituto.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_VERMELHO_BASE64, 'base64'),
    });

    await page.getByTestId('tenant-asset-submit-TENANT_COVER').click();

    /**
     * ── O FATO É A URL NO BANCO (e ela é WebP) ─────────────────────────────────
     *  O envio passa por três etapas no cliente. Esperar o clique não diz nada; o
     *  que prova o caminho é a URL gravada — e ela termina em `.webp`, que é a
     *  evidência da conversão da FASE 46 no objeto GRAVADO (o original é apagado).
     *  A mensagem da tela diz o mesmo com números (a economia medida).
     */
    await expect
      .poll(async () => (await paginaNoBanco(tenant.id))?.coverImageUrl, {
        message: 'a capa não foi gravada no rascunho',
      })
      .toContain('.webp');

    await expect(page.getByTestId('tenant-asset-status-TENANT_COVER')).toContainText('WebP');

    const comCapa = await paginaNoBanco(tenant.id);
    const urlDaCapa = comCapa?.coverImageUrl ?? '';

    expect(urlDaCapa).toMatch(/^https?:\/\//);
    /** A chave é a da PÁGINA da instituição — não a de um evento. */
    expect(urlDaCapa).toContain(`/pagina/tenant_cover/`);

    /** A prévia já mostra a capa: o MESMO componente da página pública. */
    await expect(page.getByTestId('tenant-page-preview-banner')).toBeVisible();
    await expect(page.getByTestId('tenant-page-cover')).toHaveAttribute('src', urlDaCapa);
    await expect(page.getByTestId('tenant-page-title')).toHaveText(TITULO);

    /** ── PUBLICAR ───────────────────────────────────────────────────────────── */
    await page.getByTestId('tenant-page-publish').getByTestId('inline-submit').click();

    await expect
      .poll(async () => (await paginaNoBanco(tenant.id))?.publishedAt, {
        message: 'a página não foi publicada',
      })
      .not.toBeNull();

    await expect(page.getByTestId('tenant-page-status')).toContainText('Publicada');

    /** ── A PÁGINA PÚBLICA, SEM OUTRO NAVEGADOR ──────────────────────────────── */
    const publica = await page.goto(`/t/${tenant.slug}`);

    expect(publica?.status()).toBe(200);

    await expect(page.getByTestId('tenant-public-page')).toBeVisible();
    await expect(page.getByTestId('tenant-page-title')).toHaveText(TITULO);
    await expect(page.getByTestId('tenant-page-description')).toHaveText(DESCRICAO);
    await expect(page.getByTestId('tenant-page-cover')).toHaveAttribute('src', urlDaCapa);

    /** E os três grupos continuam lá — a página personalizada não os substitui. */
    await expect(page.getByTestId('tenant-group-upcoming')).toBeVisible();
    await expect(page.getByTestId('tenant-group-ongoing')).toBeVisible();
    await expect(page.getByTestId('tenant-group-past')).toBeVisible();

    /** Um `<main>` só na tela pública (a casca não é landmark — FASE 52/60). */
    await expect(page.locator('main')).toHaveCount(1);
  });

  test('tirar do ar devolve a raiz à lista de eventos, sem perder o rascunho', async ({ page }) => {
    await signInAs(page, organizadoraEmail);

    /**
     * A página está publicada pelo caso anterior. Aqui ela sai do ar pelo BOTÃO, com
     * a confirmação do sistema — e a raiz volta a ser o que era antes de tudo.
     */
    await page.goto(`/t/${tenant.slug}/administracao/pagina`);

    await expect(page.getByTestId('tenant-page-status')).toContainText('Publicada');

    await page.getByTestId('tenant-page-unpublish-open').click();
    await page.getByTestId('tenant-page-unpublish-confirm-confirm').click();

    await expect
      .poll(async () => (await paginaNoBanco(tenant.id))?.publishedAt, {
        message: 'a página não saiu do ar',
      })
      .toBeNull();

    const depois = await page.goto(`/t/${tenant.slug}`);

    expect(depois?.status()).toBe(200);
    await expect(page.getByTestId('tenant-events-fallback')).toBeVisible();
    await expect(page.getByTestId('tenant-public-page')).toHaveCount(0);

    /** O trabalho continua salvo: "fora do ar" não é "apagado". */
    const linha = await paginaNoBanco(tenant.id);

    expect(linha?.title).toBe(TITULO);
    expect(linha?.coverImageUrl).toContain('.webp');

    /** E o editor conta a verdade depois de sair do ar. */
    await page.goto(`/t/${tenant.slug}/administracao/pagina`);
    await expect(page.getByTestId('tenant-page-status')).toContainText('não está no ar');

    /** Republica, porque os casos seguintes medem a página NO AR. */
    await page.getByTestId('tenant-page-publish').getByTestId('inline-submit').click();
    await expect
      .poll(async () => (await paginaNoBanco(tenant.id))?.publishedAt)
      .not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (b) A RECUSA — vínculo sem a permissão
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(b) quem não tem a permissão', () => {
  test('não abre o editor — e nenhuma página nasce no banco', async ({ page }) => {
    await signInAs(page, semPermissaoEmail);

    await page.goto(`/t/${semPermissao.slug}/administracao/pagina`);

    /**
     * A guarda da PÁGINA redireciona ao painel — negar com redirecionamento é a
     * régua da casa (não revela a existência de dados que a pessoa não pode ver).
     */
    await expect(page).toHaveURL(new RegExp(`/t/${semPermissao.slug}/dashboard$`));

    /** O que importa: NADA foi criado pela tentativa. */
    expect(await paginaNoBanco(semPermissao.id)).toBeNull();
  });

  test('o menu da instituição não oferece o item da página pública', async ({ page }) => {
    await signInAs(page, semPermissaoEmail);

    await page.goto(`/t/${semPermissao.slug}/dashboard`);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  MENU E TELA CONCORDAM NOS DOIS SENTIDOS (armadilha 44)
     * ─────────────────────────────────────────────────────────────────────────────
     *  O item é decidido por `page:manage`, a MESMA permissão que a action confere —
     *  um item a mais aqui seria o link que só redireciona.
     */
    await expect(page.getByRole('link', { name: 'Página pública' })).toHaveCount(0);

    /** E o administrador da OUTRA casa VÊ o item: a régua não esconde de quem pode. */
    await signInAs(page, organizadoraEmail);
    await page.goto(`/t/${tenant.slug}/dashboard`);
    await expect(page.getByRole('link', { name: 'Página pública' })).toHaveCount(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (c) A PALETA NÃO MATA O MODO DO VISITANTE — provado com o cookie real
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('(c) a paleta da instituição e o modo do visitante', () => {
  test('pedindo ESCURO, o escopo acompanha o visitante e a marca não inverte', async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, organizadoraEmail);

    /** A fixture é posta no estado que o caso mede (regra 2 do `helpers.ts`). */
    await garantirNoAr(page, tenant.slug);

    await page.context().addCookies([
      { name: 'ef_tema', value: 'escuro', url: baseURL ?? 'http://localhost:3000' },
    ]);

    await page.goto(`/t/${tenant.slug}`);

    /** O SERVIDOR entregou o escuro (e não o cliente, depois). */
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    const escopo = page.locator('[data-tenant-theme-scope="page"]');

    await expect(escopo).toHaveCount(1);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PROVA EM UMA LINHA: O MODO DO ESCOPO É O DO VISITANTE
     * ─────────────────────────────────────────────────────────────────────────────
     *  A instituição escolheu a paleta no modo CLARO (o editor não oferece modo).
     *  Se a paleta dela mandasse, este atributo seria `light` — e a página inteira
     *  apareceria clara para quem pediu escuro, com o controle do rodapé marcando
     *  "Escuro". É exatamente o defeito que a fase proíbe.
     */
    await expect(escopo).toHaveAttribute('data-theme-mode', 'dark');

    /** A cor da casa continua publicada — identidade, não iluminação. */
    const estilo = (await escopo.getAttribute('style')) ?? '';

    /**
     * O navegador serializa o atributo `style` SEM espaço depois dos dois-pontos
     * (`--ef-primary:#7b2ff7`), então a asserção é sobre o par chave/valor normalizado
     * — e não sobre uma string formatada como o autor a escreveu.
     */
    expect(estilo.replace(/\s+/g, '')).toContain(`--ef-primary:${COR_ESCOLHIDA}`);
    expect(estilo.replace(/\s+/g, '')).toMatch(/--ef-background:oklch\(0\.15/);

    /**
     * E a SUPERFÍCIE da página é a escura da plataforma: o `--ef-*` do escopo é da
     * página da instituição, e o que o `TenantPublicPage` pinta (`bg-surface`) vem do
     * casco escuro. Medido em RGB: se a paleta clara da instituição tivesse vencido,
     * este valor seria `rgb(249, 249, 255)`.
     */
    const fundo = await page
      .locator('[data-testid="tenant-public-page"]')
      .evaluate((elemento) => getComputedStyle(elemento).backgroundColor);

    expect(fundo).not.toBe('rgb(249, 249, 255)');
    expect(fundo).toMatch(/^rgb\((1[0-9]|2[0-9]|3[0-9]), /);

    /** O controle do visitante está no rodapé DESTA página, com o estado atual. */
    const controle = page.locator('footer').getByTestId('theme-choice');

    await expect(controle).toBeVisible();
    await expect(page.getByTestId('theme-option-escuro')).toHaveAttribute('aria-pressed', 'true');
    await expect(escopo.locator('[data-testid="theme-choice"]')).toHaveCount(0);
  });

  test('pedindo CLARO, o escopo muda de modo e a marca continua a mesma', async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, organizadoraEmail);

    await garantirNoAr(page, tenant.slug);

    await page.context().addCookies([
      { name: 'ef_tema', value: 'claro', url: baseURL ?? 'http://localhost:3000' },
    ]);

    await page.goto(`/t/${tenant.slug}`);

    await expect(page.locator('html')).toHaveAttribute('data-tema', 'claro');

    const escopo = page.locator('[data-tenant-theme-scope="page"]');

    /** O OUTRO LADO: agora o modo efetivo é claro, e a paleta clara da casa aparece. */
    await expect(escopo).toHaveAttribute('data-theme-mode', 'light');

    const estilo = (await escopo.getAttribute('style')) ?? '';

    expect(estilo.replace(/\s+/g, '')).toContain(`--ef-primary:${COR_ESCOLHIDA}`);
    expect(estilo.replace(/\s+/g, '')).toMatch(/--ef-background:#fbfcfd/);

    const fundo = await page
      .locator('[data-testid="tenant-public-page"]')
      .evaluate((elemento) => getComputedStyle(elemento).backgroundColor);

    expect(fundo).toBe('rgb(249, 249, 255)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (d) O PORTÃO WCAG AA DA TELA NOVA
// ═══════════════════════════════════════════════════════════════════════════════
/** Só o que IMPEDE o uso da tela reprova — a MESMA régua do `accessibility.spec`. */
const IMPACTOS_REPROVADOS = ['critical', 'serious'] as const;

async function expectNoCriticalViolations(page: Page, tela: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });

  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise<void>((resolve) => {
      let timer = window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 120);

      const observer = new MutationObserver(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 120);
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    });
  });

  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  const reprovadas = resultado.violations.filter((violacao) =>
    (IMPACTOS_REPROVADOS as readonly string[]).includes(violacao.impact ?? ''),
  );

  const detalhe = reprovadas
    .map(
      (violacao) =>
        `  ✗ ${violacao.id} (${violacao.impact}) — ${violacao.help}\n` +
        violacao.nodes
          .map((node) => `      ${node.target.join(' ')}\n        <${node.html.slice(0, 180)}>`)
          .join('\n'),
    )
    .join('\n\n');

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O LANDMARK: UM `<main>`, E A PRÉVIA NÃO CONTA (FASE 64 · fatia 5)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O editor embute a página pública INTEIRA (o `TenantPublicPage` traz o `<main>`
   *  dele — e deve trazer: na página pública ele É o conteúdo). Aqui dentro a prévia
   *  pede `landmark="none"` e desenha um `<div>`: ela não é o conteúdo principal desta
   *  tela, e o `<main>` do editor continua sendo o único. Antes disso a prévia vinha
   *  com `display: contents`, que tirava a CAIXA mas deixava o nó na árvore de
   *  acessibilidade como região `main` em parte dos leitores — dois "conteúdo
   *  principal" na mesma página.
   *
   *  Com o conserto na causa, a contagem é a ESTRITA: `page.locator('main')`. O
   *  `data-testid` de cada um vai na mensagem para a falha dizer QUAL sobrou.
   */
  const landmarks = await page
    .locator('main')
    .evaluateAll((elementos) =>
      elementos.map((elemento) => elemento.getAttribute('data-testid') ?? 'main-sem-testid'),
    );

  await expect
    .soft(landmarks, `Landmarks <main> em ${tela}: esperado exatamente 1`)
    .toHaveLength(1);

  expect
    .soft(
      reprovadas.map((violacao) => violacao.id),
      `Acessibilidade em ${tela}: ${reprovadas.length} violação(ões) crítica(s)/séria(s)\n\n${detalhe}\n`,
    )
    .toEqual([]);
}

test.describe('(d) o portão de acessibilidade da tela nova', () => {
  test('o editor da página não tem violação crítica', async ({ page }) => {
    await signInAs(page, organizadoraEmail);

    /** A PRÉVIA é metade da tela: ela precisa estar desenhada para ser medida. */
    await garantirNoAr(page, tenant.slug);

    await page.goto(`/t/${tenant.slug}/administracao/pagina`);
    await expect(page.getByTestId('tenant-page-status')).toBeVisible();
    await expect(page.getByTestId('tenant-block-editor')).toBeVisible();
    await expect(page.getByTestId('tenant-page-preview-banner')).toBeVisible();

    await expectNoCriticalViolations(page, `editor da página (/t/${tenant.slug}/administracao/pagina)`);
  });

  test('o editor em modo escuro não tem violação crítica', async ({ page, baseURL }) => {
    await signInAs(page, organizadoraEmail);

    await garantirNoAr(page, tenant.slug);

    await page.context().addCookies([
      { name: 'ef_tema', value: 'escuro', url: baseURL ?? 'http://localhost:3000' },
    ]);

    await page.goto(`/t/${tenant.slug}/administracao/pagina`);

    /** A prova de que o SERVIDOR entregou o escuro (e não o cliente, depois). */
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    await expectNoCriticalViolations(
      page,
      `editor da página em modo escuro (/t/${tenant.slug}/administracao/pagina · ef_tema=escuro)`,
    );

    /** A paleta volta à clara para o resto do arquivo (o cookie é do contexto). */
    await page.context().addCookies([
      { name: 'ef_tema', value: 'claro', url: baseURL ?? 'http://localhost:3000' },
    ]);
  });

  test('a página pública com a aparência do visitante não tem violação crítica', async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, organizadoraEmail);

    await garantirNoAr(page, tenant.slug);

    await page.context().addCookies([
      { name: 'ef_tema', value: 'escuro', url: baseURL ?? 'http://localhost:3000' },
    ]);

    await page.goto(`/t/${tenant.slug}`);

    const controle = page.locator('footer').getByTestId('theme-choice');

    await expect(controle, 'o controle de aparência não está no rodapé da página').toBeVisible();
    await expect(controle).toContainText('Aparência:');
    await expect(controle.locator('[aria-pressed="true"]')).toHaveCount(1);

    await expectNoCriticalViolations(
      page,
      `página da instituição com o controle de aparência (/t/${tenant.slug} · ef_tema=escuro)`,
    );
  });
});
