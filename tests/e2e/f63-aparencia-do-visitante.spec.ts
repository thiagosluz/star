import { expect, test, type Page } from '@playwright/test';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 63 — O VISITANTE ANÔNIMO ESCOLHE A APARÊNCIA
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Numa aba anônima, numa máquina configurada no escuro, a página pública da
 *  plataforma abre ESCURA — e o visitante não tem como discordar. O cookie
 *  (`ef_tema`), a leitura no servidor e a Server Action existem desde a FASE 61 e
 *  já funcionavam para quem não tem sessão; o que faltava era o CONTROLE. A lacuna
 *  é da FASE 61, não um defeito novo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PERCORRE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Em cada uma das três páginas públicas da PLATAFORMA — a raiz (`/`), o diretório
 *  de instituições (`/organizacoes`) e a validação pública (`/validar/**`):
 *
 *    1. **sem sessão nenhuma** (nenhum login é feito aqui) e com o sistema
 *       operacional EMULADO no escuro, a página nasce obedecendo ao sistema
 *       (`data-tema="sistema"`, sem a classe `.dark`) e PINTA o escuro — a cor
 *       computada do fundo é medida e comparada com a mesma página no claro, porque
 *       a classe sozinha não prova cor nenhuma;
 *    2. o controle está no RODAPÉ, com os três estados e o atual marcado por
 *       `aria-pressed`;
 *    3. escolher **Claro** muda a página **na MESMA resposta** — sem recarregar: um
 *       marcador escrito no `window` sobrevive à atualização, e o POST da Server
 *       Action é observado e registrado no relatório da execução;
 *    4. **e continua claro depois de um recarregamento completo** (a prova de que o
 *       estado é do SERVIDOR, via cookie, e não da memória do cliente);
 *    5. **Sistema** volta a obedecer ao sistema operacional — inclusive quando ele
 *       muda de ideia (emulado no claro no fim).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MEDIÇÃO DO `revalidatePath` (o item obrigatório da fase)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ação faz `revalidatePath('/', 'layout')`. A pergunta é se isso ALCANÇA as
 *  rotas públicas — ou se o visitante só veria o tema novo no F5 seguinte. Cada
 *  troca imprime uma linha `[F63]` com a URL, o status do POST e se o marcador de
 *  cliente sobreviveu; o `expect` do marcador é o que transforma a medição em
 *  catraca (uma resposta que exigisse recarregar reprova aqui).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FICA DE FORA, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A página pública do EVENTO e as páginas da instituição: ali quem manda é o
 *  ORGANIZADOR (decisão da FASE 61), o rodapé da plataforma não é o dela, e o
 *  visitante não pode sobrescrever a identidade que a instituição escolheu. O
 *  telão e os impressos já estavam de fora pelo mesmo motivo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const RAIZ = '/';
const DIRETORIO = '/organizacoes';

/**
 * A validação pública com um código que NÃO existe.
 *
 * É de propósito: o caminho de recusa ("não encontrado") é o mais comum da vida
 * real — link digitado errado, documento revogado — e é uma página pública inteira.
 * Usar um código real exigiria semear certificado e sessão num teste que existe
 * para provar que NÃO precisa de nenhuma das duas coisas.
 */
const VALIDACAO = '/validar/CERT-NAOEXISTE-63';

/**
 * O sistema operacional padrão desta suíte: ESCURO — o cenário do relato.
 *
 * `test.use` (e não um `emulateMedia` no meio do teste) porque a preferência
 * precisa valer ANTES da primeira pintura: é ela que a `@media
 * (prefers-color-scheme: dark)` consulta na resposta que o servidor entrega.
 * O `page.emulateMedia` continua sendo usado onde a pergunta é "e se o sistema
 * mudar de ideia?" — que é o caso 4.
 */
test.use({ colorScheme: 'dark' });

/** A classe `.dark` está no `<html>`? (o `<html>` também carrega as fontes). */
function classeEscura(page: Page): Promise<boolean> {
  return page.locator('html').evaluate((elemento) => elemento.classList.contains('dark'));
}

/**
 * A cor de fundo REALMENTE pintada.
 *
 * Lida do `<body>`, que é quem carrega `bg-background`: o `<html>` não pinta fundo
 * nenhum, e ler de lá devolveria transparente nos dois temas (o teste passaria sem
 * provar coisa alguma).
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
 * O visitante não tem sessão — e o teste CONFERE isso em vez de confiar no título.
 *
 * Sem esta asserção, um teste que "esquecesse" de limpar o contexto passaria por
 * outro caminho (o menu de conta) e não estaria medindo o visitante anônimo.
 */
async function semSessao(page: Page): Promise<void> {
  const nomes = (await page.context().cookies()).map((item) => item.name);

  expect(nomes.filter((nome) => nome.includes('session')), 'há sessão neste teste').toEqual([]);
  expect(await page.getByTestId('sign-out').count(), 'a página tem bloco de conta').toBe(0);
}

/** O cookie da aparência, como o navegador o guarda. */
async function cookieDoTema(page: Page) {
  return (await page.context().cookies()).find((item) => item.name === 'ef_tema');
}

/** O marcador que só existe enquanto a página NÃO é recarregada. */
type JanelaComMarcador = { __f63MesmaResposta?: boolean };

/**
 * Escolhe um estado no rodapé e MEDE como a resposta chegou.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  COMO SE PROVA "NA MESMA RESPOSTA, SEM RECARREGAR"
 * ─────────────────────────────────────────────────────────────────────────────
 *  Duas testemunhas independentes, e as duas são necessárias:
 *
 *    • o marcador escrito em `window` ANTES do clique — ele sobrevive a uma
 *      atualização do React (a Server Action responde com a árvore redesenhada) e
 *      morre em qualquer recarregamento do documento. Se ele sumisse, a página
 *      teria vindo inteira do servidor, e não haveria "mesma resposta" nenhuma;
 *    • a resposta HTTP do POST, observada e registrada: é ela que diz se o
 *      `revalidatePath` fez o servidor redesenhar a rota em que o visitante está.
 *
 *  A marcação (`data-tema`) é conferida antes de o marcador ser lido: é o FATO que
 *  a fase inteira persegue.
 */
async function escolherNoRodape(
  page: Page,
  modo: 'claro' | 'escuro' | 'sistema',
): Promise<{ status: number; semRecarregar: boolean }> {
  await page.evaluate(() => {
    (window as unknown as JanelaComMarcador).__f63MesmaResposta = true;
  });

  const [resposta] = await Promise.all([
    page.waitForResponse((item) => item.request().method() === 'POST'),
    page.getByTestId(`theme-option-${modo}`).click(),
  ]);

  await expect(page.locator('html')).toHaveAttribute('data-tema', modo);

  const semRecarregar = await page.evaluate(
    () => (window as unknown as JanelaComMarcador).__f63MesmaResposta ?? false,
  );

  console.log(
    `[F63] ${new URL(page.url()).pathname} · escolha "${modo}" · POST ${resposta.status()} ` +
      `${resposta.url()} · sem recarregar: ${semRecarregar} · ` +
      `data-tema=${await page.locator('html').getAttribute('data-tema')} ` +
      `classe-dark=${await classeEscura(page)}`,
  );

  return { status: resposta.status(), semRecarregar };
}

/**
 * O ciclo completo do visitante numa página pública, com a medição de cada passo.
 *
 * Devolve a medição da troca para o teste cobrar "sem recarregar" — a asserção fica
 * no teste (e não aqui) para que a falha diga QUAL das três páginas quebrou.
 */
async function cicloDoVisitante(page: Page, rota: string): Promise<{ semRecarregar: boolean }> {
  await page.goto(rota);
  await semSessao(page);

  const html = page.locator('html');

  // ── 1. O estado de partida: quem não escolheu segue o sistema operacional ────
  await expect(html, `${rota}: a página não nasceu em modo sistema`).toHaveAttribute(
    'data-tema',
    'sistema',
  );
  await expect.poll(() => classeEscura(page)).toBe(false);

  const corEscuraDoSistema = await corDeFundo(page);
  expect(corEscuraDoSistema, `${rota}: o fundo não está pintado`).not.toBe('rgba(0, 0, 0, 0)');

  /**
   * O CLARO DO MESMO INSTANTE, para a comparação não depender de valor fixo: a
   * escala de cores é do `globals.css` (outro dono), e prender o hexadecimal aqui
   * faria este teste reprovar toda vez que ela fosse ajustada.
   */
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();

  /** Trocar a preferência do sistema NÃO muda a marcação: quem decide é a media query. */
  await expect(html).toHaveAttribute('data-tema', 'sistema');

  const corClaraDoSistema = await corDeFundo(page);
  expect(
    somaLuz(corEscuraDoSistema),
    `${rota}: o sistema emulado no escuro não escureceu a página ` +
      `(escuro ${corEscuraDoSistema} × claro ${corClaraDoSistema})`,
  ).toBeLessThan(somaLuz(corClaraDoSistema));

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();

  // ── 2. O controle, no rodapé, com o estado atual marcado ────────────────────
  const controle = page.getByTestId('theme-choice');

  await expect(controle, `${rota}: o controle não está no rodapé`).toBeVisible();
  await expect(controle).toContainText('Aparência:');
  await expect(page.getByTestId('theme-option-claro')).toHaveText(/Claro/);
  await expect(page.getByTestId('theme-option-escuro')).toHaveText(/Escuro/);
  await expect(page.getByTestId('theme-option-sistema')).toHaveText(/Sistema/);

  await expect(page.getByTestId('theme-option-sistema')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('theme-option-claro')).toHaveAttribute('aria-pressed', 'false');

  // ── 3. Escolher Claro — na MESMA resposta ──────────────────────────────────
  const medicao = await escolherNoRodape(page, 'claro');

  await expect(html, `${rota}: a marcação não mudou no clique`).toHaveAttribute('data-tema', 'claro');
  await expect.poll(() => classeEscura(page)).toBe(false);

  const corClara = await corDeFundo(page);

  /** O claro ESCOLHIDO é o mesmo claro do sistema: não há tema "quase claro". */
  expect(corClara, `${rota}: o claro escolhido não é o claro da escala`).toBe(corClaraDoSistema);
  expect(somaLuz(corClara)).toBeGreaterThan(somaLuz(corEscuraDoSistema));

  // ── 4. O cookie: é ele que sobrevive ao recarregamento ─────────────────────
  const cookie = await cookieDoTema(page);

  expect(cookie, `${rota}: o cookie ef_tema não foi gravado`).toBeTruthy();
  expect(cookie?.value).toBe('claro');
  expect(cookie?.httpOnly, 'o JavaScript da página não deve poder reescrever o tema').toBe(true);

  await page.reload();

  await expect(html, `${rota}: o reload não manteve o claro`).toHaveAttribute('data-tema', 'claro');
  await expect(page.getByTestId('theme-option-claro')).toHaveAttribute('aria-pressed', 'true');
  expect(await corDeFundo(page), `${rota}: a cor mudou depois do reload`).toBe(corClara);

  return { semRecarregar: medicao.semRecarregar };
}

test('1. em `/` o visitante anônimo vê o escuro do sistema, escolhe Claro e continua claro', async ({
  page,
}) => {
  const medicao = await cicloDoVisitante(page, RAIZ);

  expect(
    medicao.semRecarregar,
    'o tema só apareceu depois de recarregar: o `revalidatePath` da ação não alcançou a rota',
  ).toBe(true);
});

test('2. em `/organizacoes` o mesmo ciclo, com o mesmo controle', async ({ page }) => {
  const medicao = await cicloDoVisitante(page, DIRETORIO);

  expect(medicao.semRecarregar, 'o diretório só mudou de tema no recarregamento').toBe(true);
});

test('3. em `/validar` (código inexistente) o mesmo ciclo, com o mesmo controle', async ({ page }) => {
  const medicao = await cicloDoVisitante(page, VALIDACAO);

  expect(medicao.semRecarregar, 'a validação pública só mudou de tema no recarregamento').toBe(
    true,
  );
});

test('4. `Sistema` volta a obedecer ao sistema operacional (inclusive quando ele muda)', async ({
  page,
}) => {
  await page.goto(DIRETORIO);
  await semSessao(page);

  const html = page.locator('html');

  /** Primeiro sai do sistema: uma escolha explícita de Claro. */
  await escolherNoRodape(page, 'claro');
  const corClara = await corDeFundo(page);

  /** E volta para `Sistema`, que é a escolha de não escolher. */
  await escolherNoRodape(page, 'sistema');

  await expect(html).toHaveAttribute('data-tema', 'sistema');
  await expect.poll(() => classeEscura(page)).toBe(false);

  const corEscura = await corDeFundo(page);
  expect(
    somaLuz(corEscura),
    'em `sistema`, com o sistema operacional no escuro, a página precisa ficar escura',
  ).toBeLessThan(somaLuz(corClara));

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A PROVA DE QUE O SERVIDOR NÃO DECIDIU PELO SISTEMA OPERACIONAL
   * ─────────────────────────────────────────────────────────────────────────────
   *  Com o sistema mudando de ideia (agora emulado no CLARO), a marcação continua a
   *  mesma — `data-tema="sistema"` e nenhuma classe `.dark` —, e o que muda é só a
   *  cor: quem responde é a `@media (prefers-color-scheme: dark)`. Se o servidor
   *  tivesse escrito a classe ao ver o sistema escuro, aqui a página ficaria presa
   *  no escuro e este `expect` seria o primeiro a reprovar.
   */
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();

  await expect(html).toHaveAttribute('data-tema', 'sistema');
  await expect.poll(() => classeEscura(page)).toBe(false);
  expect(await corDeFundo(page)).toBe(corClara);
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A OUTRA METADE DA MEDIÇÃO DO `revalidatePath`
 * ─────────────────────────────────────────────────────────────────────────────
 *  O ciclo acima mede a rota em que o visitante ESTÁ. Falta a pergunta que o
 *  `revalidatePath('/', 'layout')` promete responder: a escolha feita numa página
 *  pública vale nas OUTRAS? O navegador guarda, no cache do roteador, a árvore
 *  React que já buscou para cada destino — e o link do rodapé de `/validar/lote`
 *  para a raiz é prefetchado antes de qualquer clique.
 *
 *  **O que este caso prende é o FATO, não a causa.** A ablação da fase (a linha do
 *  `revalidatePath` comentada, o container reconstruído, esta spec rodada de novo)
 *  deu os MESMOS seis casos verdes — ou seja, o que devolve o tema novo é a rota ser
 *  DINÂMICA (o layout raiz lê o cookie), e não a invalidação. O que o visitante não
 *  pode ver, em nenhuma das duas configurações, é a página anterior voltando com o
 *  tema velho; é isso que a asserção abaixo cobra. A medição completa, com a saída
 *  real, está registrada em `src/app/actions/theme-actions.ts`.
 */
test('5. a escolha feita numa página pública vale na outra (voltar não devolve o tema velho)', async ({
  page,
}) => {
  const html = page.locator('html');

  /** A primeira página entra pela URL; a segunda, por LINK (navegação de cliente). */
  await page.goto('/validar/lote');
  await expect(html).toHaveAttribute('data-tema', 'sistema');

  await page.getByRole('link', { name: 'Ir para a página inicial' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(html).toHaveAttribute('data-tema', 'sistema');

  /** A escolha é feita na RAIZ, já com `/validar/lote` na história do navegador. */
  const medicao = await escolherNoRodape(page, 'claro');

  expect(medicao.semRecarregar).toBe(true);

  /**
   * `/validar/lote` foi desenhada com `data-tema="sistema"` (o claro/escuro vinha do
   * sistema operacional, que aqui está emulado no escuro). Ela tem de voltar CLARA —
   * o mesmo tema que o cookie agora diz.
   */
  await page.goBack();

  await expect(page).toHaveURL(/\/validar\/lote/);
  await expect(
    html,
    'a página pública anterior voltou com o tema velho',
  ).toHaveAttribute('data-tema', 'claro');
  await expect.poll(() => classeEscura(page)).toBe(false);
});

test.describe('sem JavaScript', () => {  /**
   * O navegador não executa script nenhum da PÁGINA nesta passada (a API do
   * Playwright continua funcionando). É o padrão da casa: o controle é um `<form>`
   * com Server Action e três `<button name="tema">`, e o POST do formulário chega ao
   * servidor sem hidratação — o mesmo caminho do botão de recolher a barra (FASE 59)
   * e do quadro de demandas (FASE 38).
   */
  test.use({ javaScriptEnabled: false });

  test('6. a escolha é gravada sem uma linha de JavaScript no cliente', async ({ page }) => {
    await page.goto(RAIZ);
    await semSessao(page);

    const html = page.locator('html');

    /** A primeira resposta já traz o tema — sem JS não existe script para corrigir depois. */
    await expect(html).toHaveAttribute('data-tema', 'sistema');
    await expect(html).not.toHaveAttribute('class', /(^|\s)dark(\s|$)/);

    await expect(page.getByTestId('theme-choice')).toBeVisible();
    await expect(page.getByTestId('theme-option-sistema')).toHaveAttribute('aria-pressed', 'true');

    await Promise.all([
      page.waitForResponse((item) => item.request().method() === 'POST'),
      page.getByTestId('theme-option-escuro').click(),
    ]);

    await expect(html).toHaveAttribute('data-tema', 'escuro');
    await expect.poll(() => classeEscura(page)).toBe(true);
    expect((await cookieDoTema(page))?.value).toBe('escuro');

    /** E volta, também sem script, pelo mesmo caminho. */
    await Promise.all([
      page.waitForResponse((item) => item.request().method() === 'POST'),
      page.getByTestId('theme-option-claro').click(),
    ]);

    await expect(html).toHaveAttribute('data-tema', 'claro');
    await expect.poll(() => classeEscura(page)).toBe(false);
    expect((await cookieDoTema(page))?.value).toBe('claro');
  });
});
