import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 62 · dívida H6 — REGRESSÃO VISUAL (`toHaveScreenshot`)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O projeto mede contraste, contraste escuro, landmark e `axe` — e **não media a
 *  TELA**. O defeito que abriu esta fase passou por todas as catracas: o bloco de
 *  conta do rodapé da barra lateral estourou a barra e o botão de SAIR apareceu
 *  cortado na borda. Nenhum teste de unidade, de integração ou de acessibilidade
 *  tinha como ver isso: nenhum deles olha pixels. Foi descoberto porque um humano
 *  mandou uma imagem.
 *
 *  A FASE 61 prendeu **aquele** caso com geometria medida (`f61-layout-da-conta.spec.ts`),
 *  que é a prova barata e dirigida. Este arquivo é a prova COMPLEMENTAR: ele não
 *  mede uma propriedade — ele mede o desenho inteiro, e por isso pega o que ninguém
 *  pensou em medir (a cor que trocou de token, o raio da borda, o espaçamento que
 *  encolheu, o item de menu que sumiu, o contraste que ficou lavado no escuro).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CONJUNTO É PEQUENO DE PROPÓSITO: DOZE SNAPSHOTS, CINCO ESTADOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quarenta telas dariam quarenta linhas de base para revisar a cada mudança de
 *  design — e uma linha de base que ninguém revisa é pior que nenhuma. A escolha
 *  concentra o risco REAL de quebra visual do produto:
 *
 *    1. **O rodapé da barra lateral** (`barra-inteira-claro`, `barra-recolhida-claro`,
 *       `barra-recolhida-escuro` e `gaveta-do-celular-claro`) — é o caso que motivou
 *       a fase, e é o único lugar do produto que reúne, na mesma linha, truncamento
 *       de texto alheio (nome/e-mail da pessoa, nome da instituição), dois botões de
 *       tamanho fixo e um `<details>`. Quando a conta estoura, é AQUI.
 *    2. **O painel** (`/t/<slug>/dashboard`) — a tela de referência: shell + cabeçalho
 *       + cartões de indicador + listas + `code-data`. Se um token de superfície ou de
 *       texto mudar de valor, é a primeira a denunciar, e é a que todo mundo abre.
 *    3. **O diretório de participantes** (`/t/<slug>/participantes`) — a tela mais
 *       DENSA do sistema num só lugar (o próprio portão de acessibilidade diz isso):
 *       formulário de filtro, painel de exportação, painel de recado, tabela de cinco
 *       colunas com etiquetas. Densidade é onde o layout quebra primeiro.
 *
 *  Cada uma das duas telas entra nos DOIS modos (claro e escuro, pelo cookie
 *  `ef_tema` — a mesma fiação da FASE 61) e nos DOIS tamanhos (desktop e celular,
 *  este último com a gaveta aberta, que é o estado em que o rodapé de conta aparece
 *  no telefone). O modo escuro entra porque ele é uma ESCALA NOVA (FASE 61): nenhum
 *  par dele tem histórico de imagem, e o `axe` só mede contraste — não mede o cinza
 *  que ficou baixo demais para ler, nem a sombra que sumiu.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DETERMINISMO É O CORAÇÃO DA ENTREGA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Snapshot que pisca é pior que não ter snapshot: ele ensina a rodar
 *  `--update-snapshots` sem olhar, e aí a catraca morre. O que este arquivo trata:
 *
 *    • **Conteúdo dinâmico** — nome de pessoa, e-mail, slug da instituição, contagem
 *      e ids. O que é DADO (e muda a cada execução por causa do `RUN_ID`) é MASCARADO
 *      (ver `mask`/`maskColor` abaixo, com o motivo de cada máscara); o que é fixture
 *      é FIXO (nomes escritos à mão, contagens previsíveis) — nada aqui depende do
 *      seed de demonstração.
 *    • **Datas** — as duas telas escolhidas não imprimem data nenhuma de fixture. Foi
 *      um critério de escolha: a raiz do evento imprime `startsAt` a `endsAt` e o
 *      quadro de demandas imprime prazo relativo a hoje, então os dois mudariam de
 *      linha de base a cada dia. Data que muda todo dia não é regressão visual.
 *    • **Animações** — `animations: 'disabled'` (e o estilo injetado em
 *      `estabilizar`) congela transição e animação do Tailwind no estado final.
 *    • **Cursor e foco** — `caret: 'hide'`; nenhum teste clica em campo de texto, e o
 *      clique que abre a gaveta fica sob a própria gaveta (sem anel de foco visível).
 *    • **Fontes e hidratação** — `estabilizar` espera `load`, `document.fonts.ready` e
 *      o DOM parar de mudar (o mesmo `MutationObserver` da FASE 50): o React troca
 *      conteúdo por streaming, e fotografar no meio disso é corrida, não regressão.
 *    • **Escala** — `scale: 'css'`: um pixel de imagem por pixel de CSS, para a linha
 *      de base não depender do `deviceScaleFactor` da máquina.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS MÁSCARAS — E POR QUE CADA UMA EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Máscara não é "esconder o que incomoda": é separar DADO de DESENHO. O que muda a
 *  cada execução por ser dado (e não desenho) sai tapado; o resto do rodapé continua
 *  sendo medido pixel a pixel. A cor da máscara é o magenta padrão do Playwright
 *  (`#F0F`) DE PROPÓSITO: máscara que se confunde com o conteúdo é armadilha para
 *  quem revisa a imagem depois.
 *
 *    1. **O endereço de e-mail de quem está logado** (`mascaraDoEndereco`) — o e-mail
 *       nasce de `uniqueEmail`, que carrega o `RUN_ID` da execução; sem máscara, TODA
 *       execução geraria uma linha de base diferente. Ele é dado de contato, não
 *       desenho: o que importa medir é que a linha trunca e que os dois botões ao lado
 *       continuam dentro da barra. Vale para a barra do desktop e para a gaveta do
 *       celular — sempre no contêiner que a tela realmente mostra.
 *    2. **A URL canônica do painel** (`code.code-data`, "URL canônica: /t/<slug>/dashboard")
 *       — traz o slug da instituição, que também carrega o `RUN_ID`. É texto de dado
 *       técnica dentro de um `<code>`; o desenho da linha continua medido.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTA SUÍTE ACHOU — E A CORREÇÃO QUE ELA PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A primeira execução (390×844, contra o servidor do projeto) mostrou que a gaveta
 *  de navegação do celular tinha **64 px de altura**:
 *
 *      [data-testid=mobile-navigation] ....... { x: 0, y: 0, width: 320, height: 64 }
 *      <header> (tem `backdrop-blur`) ........ { width: 390, height: 65 }
 *      div.fixed.inset-0 (invólucro) ......... { width: 390, height: 64 }
 *      nav interno ........................... { y: 85, height: 920 }
 *      botão de sair ......................... { y: 1045 }
 *
 *  A causa é do CSS, não do produto: **`backdrop-filter` cria containing block para
 *  descendentes `position: fixed`** — e o cabeçalho do shell tem `backdrop-blur`. O
 *  invólucro da gaveta é `fixed inset-0`, então `inset-0` resolvia contra a caixa do
 *  CABEÇALHO em vez da viewport. Na prática o menu e o rodapé de conta existiam
 *  dentro de uma faixa de 64 px com `overflow-y-auto`: era preciso rolar DENTRO da
 *  faixa para chegar a "Painel" — a navegação do telefone estava inutilizável.
 *
 *  **Ele passou por TODAS as catracas anteriores** (F52, F58, F59, F61) porque todas
 *  medem geometria, contraste ou landmark de nós que existem no DOM: o botão de sair
 *  estava em `y: 1045` e a régua da FASE 61 o considerava "dentro da gaveta" — estava,
 *  dentro de uma gaveta que não aparecia. É o argumento da dívida H6 dito em números:
 *  nenhuma dessas fases media a TELA.
 *
 *  A correção (autorizada depois do achado) ataca a causa em `mobile-nav.tsx`: a
 *  gaveta passou a ser desenhada em `document.body` por `createPortal`, fora da
 *  árvore do cabeçalho, sem mudar um pixel do desenho. Corrigir a altura revelou a
 *  SEGUNDA metade do mesmo defeito: a coluna da gaveta não tinha `min-h-0`, então a
 *  lista de 25 destinos empurrava o rodapé de conta para fora da caixa (o botão de
 *  sair em `y: 1081`, num container de 844 px) — a MESMA armadilha que o
 *  `app-shell.tsx` já documenta na barra lateral. Agora quem rola é a lista
 *  (`min-h-0 flex-1 overflow-y-auto`) e o rodapé fica preso, como no desktop.
 *
 *  A régua que prende isso é de GEOMETRIA, não de pixel (ver `abrirGaveta`): **a
 *  gaveta aberta tem de ocupar a altura da viewport e o botão de sair tem de ficar
 *  dentro dela** — a imagem sozinha não serve, porque uma linha de base pode
 *  registrar a coisa errada (registrou: a primeira versão dos snapshots de celular
 *  nasceu com a gaveta de 64 px).
 *
 *  **As cinco linhas de base de CELULAR foram regeradas depois da correção** — as
 *  anteriores mostravam o defeito. As de desktop não mudaram (a gaveta é `lg:hidden`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PROVA DE QUE A CATRACA MORDE (mutação REAL na interface)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Foi devolvido à interface o `min-w-0` removido do seletor de instituição — o
 *  defeito exato que abriu a dívida H6 (`tenant-menu.tsx`). Resultado medido contra
 *  as linhas de base commitadas: **10 das 12 reprovaram, 2 passaram**.
 *
 *      barra inteira (claro) ................. 2.958 pixels diferentes
 *      painel desktop (claro / escuro) ....... 5.178 / 5.242 pixels diferentes
 *      diretório desktop (claro / escuro) .... 5.178 / 5.242 pixels diferentes
 *      gaveta e as 4 telas de celular ........ régua de geometria: o botão de sair
 *                                              termina em 505,09 px numa gaveta de
 *                                              320 px (esperado: até 320,5)
 *      barra recolhida (claro e escuro) ...... PASSARAM, e o motivo é bom: na barra
 *                                              recolhida o nome e o e-mail são
 *                                              `sr-only`, então o item não tem
 *                                              largura mínima para estourar — a
 *                                              catraca reprova onde o defeito existe.
 *
 *  A mutação foi DESFEITA e a execução voltou a 12/12 verde contra o container.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A HONESTIDADE DO AMBIENTE (leia antes de rodar em outra máquina)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Renderização de fonte, de borda e de canal alfa **varia por sistema** e por
 *  imagem de container. Portanto:
 *
 *    (a) **A linha de base vale para ESTE ambiente** — o servidor deste projeto (o
 *        container `eventflow-web`, ou um servidor equivalente servindo o MESMO
 *        código) com o **Chromium deste host**. É por isso que os arquivos nascem com
 *        o sufixo de plataforma que o Playwright gera (`-chromium-win32.png` aqui).
 *    (b) **Em outra máquina, o `--update-snapshots` é ato CONSCIENTE**: no Linux o
 *        sufixo muda (`-chromium-linux`), o arquivo esperado não existe, e o
 *        Playwright escreve um novo e FALHA a execução. A falha é a mensagem certa —
 *        o errado é rodar `--update-snapshots` para "fazer passar" sem olhar a imagem
 *        nova, porque é exatamente assim que uma regressão visual entra no repositório
 *        com a assinatura de quem a aprovou.
 *    (c) **A tolerância foi MEDIDA, não escolhida no olho.** São dois números:
 *
 *        • `threshold: 0.04` — a distância de cor que ainda conta como "o mesmo
 *          pixel". O padrão do Playwright é **0,2**, e 0,2 é cego para a troca de
 *          token que a dívida H6 cita como razão de existir ("troca de cor por engano
 *          só aparece em revisão manual"). Medição feita nesta fase, com o par real
 *          que a dívida E81 mexeu no modo escuro (`#6b7280` → `#7a7f8d` na borda):
 *          o delta do par é ≈ 94, o corte de 0,2 é 1.408 (passa em silêncio) e o de
 *          0,04 é 56 (reprova). Com 0,04 a troca REPROVA em 5 snapshots escuros —
 *          1.852, 12.745, 22.726, 23.383 e 26.426 pixels de diferença; com 0,2 os
 *          mesmos cinco passam. Os snapshots CLAROS não mudaram (os tokens do claro
 *          não mudaram) — a régua mede o que deve medir.
 *        • `maxDiffPixelRatio: 0` — nenhum pixel diferente é aceito. É o padrão do
 *          Playwright e foi CONFIRMADO por medição: com as linhas de base recém
 *          geradas, três execuções seguidas deram ZERO pixel de diferença — e o MESMO
 *          código servido por um SEGUNDO servidor (build de produção fora do container)
 *          também fechou 12/12 sem um pixel de diferença. Máscara, animação desligada
 *          e espera determinística são o que permite isso. Se um ambiente novo
 *          introduzir ruído, quem cede é o RATIO (com o motivo escrito ao lado) —
 *          nunca o `threshold`, que é o número que enxerga cor.
 *
 *        `maxDiffPixelRatio: 1` ("sempre passa") seria a negação do arquivo inteiro e
 *        não está aqui.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO ATUALIZAR A LINHA DE BASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *      npx playwright test tests/e2e/f62-regressao-visual.spec.ts --update-snapshots
 *
 *  Depois de rodar isso, ABRA as imagens novas (`tests/e2e/f62-regressao-visual.spec.ts-snapshots/`)
 *  e confirme que a mudança é a que você quis fazer. As imagens ficam COMMITADAS: são
 *  elas que dão sentido ao teste.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FICOU DE FORA, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Telão do sorteio, página pública do evento, impressos (PDF/ZPL), calendário do
 *  quadro de demandas e o editor de blocos: são telas cujo desenho depende de dado
 *  que muda com o tempo (prazo, contagem ao vivo, cor do organizador) ou que já têm
 *  prova dirigida própria. Cobri-las aqui exigiria mascarar justamente o que se quer
 *  medir. A catraca visual cresce por ADIÇÃO de risco novo, não por varredura.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f62-visual';
const TENANT_NAME = 'Instituto Visual do Recôncavo';

/**
 * O nome é COMPRIDO DE PROPÓSITO.
 *
 * Sem um nome que não caiba na barra, o truncamento não é exercitado e a barra não
 * tem como estourar — foi um nome assim que revelou o defeito da FASE 61. Um fixture
 * com "Ana" deixaria esta catraca cega para o caso que a criou.
 */
const NOME_DA_CONTA = 'Dona da Conta Com Um Nome Bem Comprido';

/** As pessoas do diretório. Fixas, e em ordem alfabética (é a ordem que a tela usa). */
const PARTICIPANTES = ['Ana Beatriz Sampaio', 'Carlos Eduardo Nogueira', 'Mariana Prado Vasconcelos'];

/**
 * Quantas pessoas a tela lista: as três acima E a dona da conta.
 *
 * O diretório de participantes não é a lista do público — é a UNIÃO de vínculo e
 * inscrição (FASE 32), então quem é da EQUIPE também aparece. Escrever o número
 * esperado aqui (em vez de "pelo menos uma") é o que prova que a linha de base
 * nasceu com conteúdo: uma tabela que esvaziasse por defeito continuaria verde se o
 * teste só pedisse "a lista está visível".
 */
const PESSOAS_NA_INSTITUICAO = PARTICIPANTES.length + 1;

/**
 * O endereço do ambiente, para gravar cookie de tema e de barra.
 *
 * Vem do MESMO lugar que o `playwright.config.ts` lê (`E2E_BASE_URL`), e não do
 * arquivo de configuração: esta fase não pode editá-lo (a dívida I3 é dona dele neste
 * momento), então a configuração que ela precisa vive aqui.
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/**
 * A origem declarada nas chamadas de autenticação.
 *
 * Fica LITERAL em `localhost:3000` (como nos outros specs) porque o Better Auth só
 * aceita a origem que está em `trustedOrigins` — e essa lista sai de `APP_URL`. O
 * cookie de sessão, porém, é do HOST e não da porta: o mesmo teste roda contra
 * `:3000` (o container) ou contra um servidor de verificação em `:3001`.
 */
const ORIGEM = 'http://localhost:3000';

const DESKTOP = { width: 1440, height: 1200 } as const;
const CELULAR = { width: 390, height: 844 } as const;

/**
 * A tolerância declarada (ver a seção (c) do cabeçalho) e os três congelamentos:
 * animação desligada, cursor escondido e escala em pixel de CSS.
 */
const TOLERANCIA = {
  animations: 'disabled',
  caret: 'hide',
  scale: 'css',
  threshold: 0.04,
  maxDiffPixelRatio: 0,
} as const;

let tenantSlug: string;
let emailDaConta: string;

async function signUpVia(
  api: APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const endereco = uniqueEmail('f62');

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: ORIGEM },
    data: { name, email: endereco, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({
    where: { email: endereco },
    select: { id: true },
  });

  return { id: user.id, email: endereco };
}

async function signInAs(page: Page, endereco: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: ORIGEM } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: ORIGEM },
    data: { email: endereco, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${endereco}: HTTP ${response.status()}`);
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A FIXTURE NASCE PELOS MESMOS HELPERS DOS OUTROS SPECS
 * ─────────────────────────────────────────────────────────────────────────────
 *  `createTenant` / `linkUser` / `grantRole` / `createEvent` / `createActivity`, e
 *  nunca o seed de demonstração: o seed muda com o produto, e uma linha de base
 *  amarrada a ele passaria a medir outra instituição sem ninguém perceber.
 *
 *  O e-mail de quem entra é marcado como CONFIRMADO no banco. Sem isso o shell
 *  desenha o aviso "Confirme seu e-mail" — que é estado TRANSITÓRIO, traz o endereço
 *  inteiro (não mascarado) dentro do texto e empurra o conteúdo da página para baixo.
 *  A linha de base mede a tela em REPOUSO; a verificação de e-mail tem prova própria
 *  na FASE 15.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({ label: TENANT_LABEL, name: TENANT_NAME });
    tenantSlug = tenant.slug;

    const conta = await signUpVia(api, NOME_DA_CONTA);
    emailDaConta = conta.email;

    await linkUser({ tenantId: tenant.id, userId: conta.id });
    await grantRole({ tenantId: tenant.id, userId: conta.id, role: 'OWNER' });

    await e2eDb.user.update({ where: { id: conta.id }, data: { emailVerified: true } });

    /** As pessoas do diretório: vínculo de PARTICIPANTE, que é o que a tela lista. */
    for (const nome of PARTICIPANTES) {
      const pessoa = await signUpVia(api, nome);
      await linkUser({ tenantId: tenant.id, userId: pessoa.id, kind: 'PARTICIPANT' });
    }

    /**
     * Um evento e uma atividade existem para o painel mostrar CONTAGEM de verdade
     * (zero em todos os cartões mediria menos: um indicador que parou de contar
     * continuaria parecendo certo). A data deles não aparece em nenhuma das duas
     * telas — nem no `<select>` de evento, que abre em "Todos os eventos".
     */
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `visual-${RUN_ID}`,
      title: 'Mostra de Arte e Ciência',
      status: 'REGISTRATION_OPEN',
      capacity: 100,
    });

    await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `abertura-${RUN_ID}`,
      title: 'Mesa de abertura',
    });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

/** Entra como a dona da conta e grava as DUAS escolhas que o servidor lê no HTML. */
async function preparar(
  page: Page,
  opcoes: { tema: 'claro' | 'escuro'; nav?: 'full' | 'rail' },
): Promise<void> {
  await signInAs(page, emailDaConta);

  await page.context().addCookies([
    { name: 'ef_tema', value: opcoes.tema, url: BASE },
    { name: 'ef_nav', value: opcoes.nav ?? 'full', url: BASE },
  ]);
}

/**
 * Espera o desenho PARAR antes de fotografar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO BASTA O `goto`
 * ─────────────────────────────────────────────────────────────────────────────
 *  O `goto` resolve quando o documento carrega, e o React ainda está trocando o
 *  conteúdo que veio por streaming — a MESMA página fotografada duas vezes sai
 *  diferente, e o teste passa a acusar regressão onde havia corrida (foi o que a
 *  varredura de acessibilidade da FASE 50 aprendeu, e a lição vale igual aqui).
 *
 *  São três esperas, todas determinísticas: a carga terminar, as FONTES assentarem
 *  (métrica de fonte muda a quebra de linha, e quebra de linha muda pixel) e o DOM
 *  ficar 120 ms em silêncio. O estilo injetado zera transição e animação do Tailwind
 *  no estado FINAL — a gaveta do celular entra deslizando em 200 ms, e medir no meio
 *  do caminho não é regressão, é impaciência.
 */
async function estabilizar(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });

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
}

/** A barra lateral do desktop (a gaveta é outro `aside`, e é `display: none` aqui). */
function barraLateral(page: Page): Locator {
  return page.locator('aside[data-nav]');
}

/** A gaveta do celular. */
function gavetaDoCelular(page: Page): Locator {
  return page.getByTestId('mobile-navigation');
}

/**
 * A máscara do e-mail de quem está logado, DENTRO do contêiner que a tela mostra.
 *
 * O mesmo texto existe duas vezes no DOM (barra e gaveta) porque o rodapé de conta é
 * o mesmo `ReactNode` nos dois lugares. Escopar a máscara ao contêiner visível evita
 * tapar o que não está sendo fotografado — e mantém a leitura da imagem honesta.
 */
function mascaraDoEndereco(onde: Locator): Locator {
  return onde.getByText(emailDaConta, { exact: true });
}

/** A URL canônica do painel carrega o slug da instituição — que carrega o `RUN_ID`. */
function mascaraDaUrlCanonica(page: Page): Locator {
  return page.locator('main code.code-data');
}

/**
 * Abre a gaveta, espera ela ASSENTAR e mede a GEOMETRIA dela.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A RÉGUA QUE O SNAPSHOT NÃO DÁ (o defeito que esta fase achou e corrigiu)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A primeira execução mediu a gaveta aberta com **64 px de altura** — a altura do
 *  cabeçalho — porque `backdrop-filter` (o `backdrop-blur` do cabeçalho do shell)
 *  cria containing block para descendentes `position: fixed`, e o invólucro da
 *  gaveta é `fixed inset-0`. Correção: a gaveta passou a ser desenhada em
 *  `document.body` por `createPortal`, e a LISTA (`min-h-0 flex-1 overflow-y-auto`)
 *  passou a ser quem rola — sem isso o rodapé de conta continuava empurrado para
 *  fora da caixa (ver `mobile-nav.tsx`).
 *
 *  A asserção abaixo é a CATRACA disso, e não uma repetição do snapshot: uma imagem
 *  pode ficar verde medindo a mesma coisa errada duas vezes (era o caso — a
 *  baseline registrava a gaveta de 64 px). O que ela prende é o FATO: a gaveta aberta
 *  ocupa a ALTURA DA VIEWPORT, e o rodapé de conta fica DENTRO dela — se alguém
 *  devolver a gaveta para dentro do cabeçalho, a régua reprova dizendo o número.
 *
 *  A classe prova que o clique chegou ao React (o estado virou `open`); o `poll` da
 *  caixa prova que o deslize terminou. O `toPass` existe por um motivo real: o clique
 *  pode acontecer ANTES da hidratação, quando ainda não há `onClick` para recebê-lo —
 *  e aí o botão é clicado "com sucesso" sem nada acontecer. Repetir é a resposta certa
 *  para uma corrida de cliente, e não um `waitForTimeout` que esconde o problema.
 */
async function abrirGaveta(page: Page): Promise<void> {
  const gaveta = gavetaDoCelular(page);
  const alturaDaViewport = page.viewportSize()?.height ?? 0;

  await expect(async () => {
    await page.getByTestId('open-navigation').click();
    await expect(gaveta).toHaveClass(/translate-x-0/, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await expect
    .poll(async () => (await gaveta.boundingBox())?.x ?? Number.NEGATIVE_INFINITY, {
      message: 'a gaveta não terminou de deslizar',
    })
    .toBeLessThanOrEqual(0.5);

  const caixa = await gaveta.boundingBox();
  expect(caixa, 'a gaveta aberta não tem caixa').not.toBeNull();

  expect(
    caixa!.height,
    `a gaveta aberta tem ${caixa!.height}px de altura, e a viewport tem ${alturaDaViewport}px: ` +
      'ela está presa dentro do cabeçalho (defeito da FASE 62 — `backdrop-filter` cria ' +
      'containing block para `position: fixed`)',
  ).toBeGreaterThanOrEqual(alturaDaViewport - 2);

  const sair = await gaveta.getByTestId('sign-out').boundingBox();
  expect(sair, 'a gaveta não tem o botão de sair').not.toBeNull();

  expect(
    sair!.y + sair!.height,
    'o botão de sair fica FORA da gaveta (embaixo)',
  ).toBeLessThanOrEqual(caixa!.y + caixa!.height + 0.5);

  expect(sair!.x + sair!.width, 'o botão de sair passa da borda da gaveta').toBeLessThanOrEqual(
    caixa!.x + caixa!.width + 0.5,
  );
}

/** O painel: a tela de referência. */
async function abrirPainel(page: Page): Promise<void> {
  await page.goto(`/t/${tenantSlug}/dashboard`);

  /** Antes de fotografar: a tela é a que se espera, e não uma página de erro verde. */
  await expect(page.getByTestId('stats')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(TENANT_NAME);

  await estabilizar(page);
}

/** O diretório de participantes: a tela mais densa do sistema. */
async function abrirDiretorio(page: Page): Promise<void> {
  await page.goto(`/t/${tenantSlug}/participantes`);

  await expect(page.getByTestId('participant-list')).toBeVisible();
  await expect(page.getByTestId('participant-list').locator('tbody tr')).toHaveCount(
    PESSOAS_NA_INSTITUICAO,
  );
  await expect(page.getByTestId('participant-summary')).toContainText(
    `${PESSOAS_NA_INSTITUICAO} pessoa(s) na instituição`,
  );

  await estabilizar(page);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DESKTOP — o rodapé de conta, o painel e o diretório, nos dois modos
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('desktop', () => {
  test.use({ viewport: DESKTOP });

  test('1. a barra inteira: o rodapé de conta cabe na largura', async ({ page }) => {
    await preparar(page, { tema: 'claro' });
    await abrirPainel(page);

    const barra = barraLateral(page);
    await expect(barra).toHaveAttribute('data-nav', 'full');
    await expect(barra.getByTestId('account-theme-menu')).toBeVisible();
    await expect(barra.getByTestId('sign-out')).toBeVisible();

    /**
     * A BARRA INTEIRA é o alvo — não o rodapé isolado: o defeito da FASE 61 foi um
     * rodapé que estourava a barra, e a barra é quem tem a largura. Fotografar o
     * rodapé sozinho recortaria justamente a borda onde o botão aparecia cortado.
     */
    await expect(barra).toHaveScreenshot('barra-inteira-claro.png', {
      ...TOLERANCIA,
      mask: [mascaraDoEndereco(barra)],
    });
  });

  test('2. a barra recolhida (ef_nav=rail) no claro', async ({ page }) => {
    await preparar(page, { tema: 'claro', nav: 'rail' });
    await abrirPainel(page);

    const barra = barraLateral(page);
    await expect(barra).toHaveAttribute('data-nav', 'rail');
    await expect(barra.getByTestId('sign-out')).toBeVisible();

    /**
     * SEM MÁSCARA AQUI, e o motivo importa: na barra recolhida o nome e o e-mail são
     * `sr-only` — a caixa de 1×1 px com `clip`, que NÃO desenha texto nenhum. Não há
     * pixel de dado dinâmico para tapar (a máscara só pintaria um ponto magenta no
     * lugar do recorte). Máscara é para o que aparece na tela.
     */
    await expect(barra).toHaveScreenshot('barra-recolhida-claro.png', TOLERANCIA);
  });

  test('3. a barra recolhida no escuro', async ({ page }) => {
    await preparar(page, { tema: 'escuro', nav: 'rail' });
    await abrirPainel(page);

    /**
     * A prova de que o SERVIDOR entregou o escuro (a fiação lê o cookie na
     * requisição) — sem isso, a imagem poderia ser do tema aplicado depois por
     * JavaScript, que é o que o modo noturno existe para não ser.
     */
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    const barra = barraLateral(page);
    await expect(barra).toHaveAttribute('data-nav', 'rail');

    /** Sem máscara: na barra recolhida o e-mail é `sr-only` (ver o teste 2). */
    await expect(barra).toHaveScreenshot('barra-recolhida-escuro.png', TOLERANCIA);
  });

  test('4. o painel no claro', async ({ page }) => {
    await preparar(page, { tema: 'claro' });
    await abrirPainel(page);

    await expect(page).toHaveScreenshot('painel-desktop-claro.png', {
      ...TOLERANCIA,
      mask: [mascaraDoEndereco(barraLateral(page)), mascaraDaUrlCanonica(page)],
    });
  });

  test('5. o painel no escuro', async ({ page }) => {
    await preparar(page, { tema: 'escuro' });
    await abrirPainel(page);

    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    await expect(page).toHaveScreenshot('painel-desktop-escuro.png', {
      ...TOLERANCIA,
      mask: [mascaraDoEndereco(barraLateral(page)), mascaraDaUrlCanonica(page)],
    });
  });

  test('6. o diretório de participantes no claro', async ({ page }) => {
    await preparar(page, { tema: 'claro' });
    await abrirDiretorio(page);

    await expect(page).toHaveScreenshot('participantes-desktop-claro.png', {
      ...TOLERANCIA,
      mask: [mascaraDoEndereco(barraLateral(page))],
    });
  });

  test('7. o diretório de participantes no escuro', async ({ page }) => {
    await preparar(page, { tema: 'escuro' });
    await abrirDiretorio(page);

    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    await expect(page).toHaveScreenshot('participantes-desktop-escuro.png', {
      ...TOLERANCIA,
      mask: [mascaraDoEndereco(barraLateral(page))],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CELULAR — com a gaveta aberta, que é onde o rodapé de conta aparece no telefone
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('celular', () => {
  test.use({ viewport: CELULAR });

  test('8. a gaveta do celular com o rodapé de conta', async ({ page }) => {
    await preparar(page, { tema: 'claro' });
    await abrirPainel(page);
    await abrirGaveta(page);

    const gaveta = gavetaDoCelular(page);
    await expect(gaveta.getByTestId('sign-out')).toBeVisible();

    /**
     * A gaveta é o TERCEIRO estado do mesmo rodapé (FASE 61 mede os três por
     * geometria). Aqui ela é fotografada inteira: a barra inteira, a recolhida e a
     * gaveta são o mesmo bloco em três larguras — e é na largura intermediária
     * (320 px, com o rótulo de cada item visível) que ele tem menos folga.
     */
    await expect(gaveta).toHaveScreenshot('gaveta-do-celular-claro.png', {
      ...TOLERANCIA,
      mask: [mascaraDoEndereco(gaveta)],
    });
  });

  test('9. o painel no celular, no claro', async ({ page }) => {
    await preparar(page, { tema: 'claro' });
    await abrirPainel(page);
    await abrirGaveta(page);

    await expect(page).toHaveScreenshot('painel-celular-claro.png', {
      ...TOLERANCIA,
      mask: [mascaraDoEndereco(gavetaDoCelular(page)), mascaraDaUrlCanonica(page)],
    });
  });

  test('10. o painel no celular, no escuro', async ({ page }) => {
    await preparar(page, { tema: 'escuro' });
    await abrirPainel(page);
    await abrirGaveta(page);

    await expect(page).toHaveScreenshot('painel-celular-escuro.png', {
      ...TOLERANCIA,
      mask: [mascaraDoEndereco(gavetaDoCelular(page)), mascaraDaUrlCanonica(page)],
    });
  });

  test('11. o diretório de participantes no celular, no claro', async ({ page }) => {
    await preparar(page, { tema: 'claro' });
    await abrirDiretorio(page);
    await abrirGaveta(page);

    await expect(page).toHaveScreenshot('participantes-celular-claro.png', {
      ...TOLERANCIA,
      mask: [mascaraDoEndereco(gavetaDoCelular(page))],
    });
  });

  test('12. o diretório de participantes no celular, no escuro', async ({ page }) => {
    await preparar(page, { tema: 'escuro' });
    await abrirDiretorio(page);
    await abrirGaveta(page);

    await expect(page).toHaveScreenshot('participantes-celular-escuro.png', {
      ...TOLERANCIA,
      mask: [mascaraDoEndereco(gavetaDoCelular(page))],
    });
  });
});
