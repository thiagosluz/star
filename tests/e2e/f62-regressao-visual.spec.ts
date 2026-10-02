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
 *  O CONJUNTO É PEQUENO DE PROPÓSITO: QUATORZE SNAPSHOTS, QUATRO SUPERFÍCIES
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
 *    4. **O rodapé público da plataforma** (`rodape-publico-claro`,
 *       `rodape-publico-escuro`) — **as duas linhas de base que nasceram na FASE 63**:
 *       a raiz `/` com o controle de aparência do VISITANTE (o `<form>` de três
 *       `<button name="tema">` do rodapé). Ver a seção seguinte, que explica o recorte.
 *
 *  Cada uma das duas telas autenticadas entra nos DOIS modos (claro e escuro, pelo cookie
 *  `ef_tema` — a mesma fiação da FASE 61) e nos DOIS tamanhos (desktop e celular,
 *  este último com a gaveta aberta, que é o estado em que o rodapé de conta aparece
 *  no telefone). O modo escuro entra porque ele é uma ESCALA NOVA (FASE 61): nenhum
 *  par dele tem histórico de imagem, e o `axe` só mede contraste — não mede o cinza
 *  que ficou baixo demais para ler, nem a sombra que sumiu.
 *
 *  O rodapé público (item 4) segue a MESMA régua: os dois modos, pelo mesmo cookie,
 *  e sem sessão nenhuma — quem o usa é o visitante que nunca entrou.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O RODAPÉ PÚBLICO — QUE RECORTE, E POR QUÊ (os dois casos da FASE 63)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O alvo é a linha do controle de aparência que a FASE 63 pôs no rodapé das páginas
 *  públicas da plataforma (a raiz `/`), nos dois modos. A pergunta do recorte é
 *  respondida pelo defeito que ESTA suíte achou: a gaveta do celular presa em 64 px
 *  passou por todas as catracas justamente porque cada uma media um nó SEM o
 *  contexto em que ele vive. Um recorte do `<footer>` isolado repetiria esse erro —
 *  ele mostraria a linha bonita mesmo que ela tivesse estourado a largura de `main`,
 *  sobreposto a última seção ou sido empurrada para fora da viewport.
 *
 *  Por isso o snapshot é da PÁGINA INTEIRA (`page`), com o rodapé NO LUGAR dele,
 *  depois da última seção. A raiz é curta, estática e sem máscara nenhuma (não há
 *  dado de execução nela), então medir a página toda custa pouco e é o que prende o
 *  desenho como um todo — inclusive a quebra de linha do rodapé, que é o que muda
 *  quando um dos três botões ganha ou perde `padding`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O RÓTULO DO CONTROLE FOI CORRIGIDO NA FASE 63 — E AS DUAS LINHAS DE BASE
 *  DO RODAPÉ PÚBLICO NÃO MUDARAM UM PIXEL (medido, não suposto)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `rodape-publico-claro-chromium-win32.png` e `rodape-publico-escuro-chromium-win32.png`
 *  nasceram na FASE 63 (são as duas linhas de base deste bloco) e já registram a
 *  tinta CORRETA do rótulo. O que aconteceu, na ordem:
 *
 *    • o portão de acessibilidade (`tests/e2e/accessibility.spec.ts`, WCAG AA, sem
 *      isenção) reprovou a página pública com **uma** violação, e ela era do rótulo
 *      visível deste controle: `<span id="ef-aparencia" class="… text-muted">Aparência:</span>`;
 *    • `text-muted` NÃO é token de texto — `--muted` resolve em `--ef-surface-low`,
 *      a superfície de agrupamento. Como cor de TEXTO sobre a superfície da página
 *      ele media **1,05:1 no claro** e **1,08:1 no escuro**, contra os 4,5:1 que o
 *      AA pede para texto pequeno. O rótulo era, na prática, invisível;
 *    • o rótulo passou a `text-muted-foreground` (`--ef-on-surface-variant`, o
 *      token de texto secundário que as variantes `menu` e `account` já usavam no
 *      `<legend>`): **8,93:1** no claro e **10,43:1** no escuro, presos no par
 *      "rótulo do grupo de aparência sobre o rodapé público" de
 *      `tests/unit/f61-contraste-dos-dois-modos.test.ts`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A REGERAÇÃO DEU ZERO BYTE DE DIFERENÇA (e por que isso é o registro)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `npx playwright test tests/e2e/f62-regressao-visual.spec.ts --update-snapshots`
 *  (14/14 verde) NÃO reescreveu nenhum dos dois arquivos: o SHA-256 é o mesmo antes
 *  e depois, e a comparação pixel a pixel da imagem que o navegador desenha com a
 *  linha de base commitada deu **0 pixel diferente** nos dois modos (1440×1200).
 *
 *  O motivo é medido: o pixel de tinta do rótulo DENTRO das linhas de base é, no
 *  claro, `rgb(70,69,85)` = `#464555`, e no escuro `rgb(197,198,208)` = `#c5c6d0` —
 *  exatamente o `--ef-on-surface-variant`, e a 297 e 292 de distância do
 *  `--ef-surface-low` (`#f1f3ff` / `#1d1f26`). Ou seja: **as linhas de base foram
 *  geradas ANTES de o rótulo ser esmaecido para `text-muted`** — o defeito que o
 *  `axe` pegou entrou depois da geração das imagens e nunca foi regerado, e por isso
 *  a suíte visual passou a ser, sem saber, a única testemunha do desenho certo.
 *  A correção de contraste, portanto, RESTAUROU o desenho que estas duas imagens já
 *  registravam (as imagens de `docs/imagens/f63-rodape-*.png` carregam a mesma tinta).
 *
 *  A lição fica escrita para a próxima vez: **linha de base que não muda quando a
 *  classe muda está dizendo que a classe não chegou a ser aplicada** — ou, como aqui,
 *  que a imagem é mais antiga que o defeito. Nos dois casos quem separa as duas
 *  hipóteses é medir a tinta no arquivo, e não rodar `--update-snapshots` no escuro.
 *  O DESENHO não foi tocado: três botões, ordem dos modos, `gap` e `padding` iguais.
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
 *    • **Datas** — as telas escolhidas não imprimem data nenhuma de fixture. Foi
 *      um critério de escolha: a raiz do evento imprime `startsAt` a `endsAt` e o
 *      quadro de demandas imprime prazo relativo a hoje, então os dois mudariam de
 *      linha de base a cada dia. Data que muda todo dia não é regressão visual. A raiz
 *      pública (item 4) passa pelo mesmo crivo: ela é estática — nenhum dado de banco,
 *      nenhuma data, nada derivado do `RUN_ID`.
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
 *
 *  A **página pública do EVENTO** continua de fora (o parágrafo acima é sobre ela), e
 *  a distinção importa: o que entrou na FASE 63 foi o rodapé das páginas públicas da
 *  PLATAFORMA — a raiz, que é estática e é de todo mundo. A página do evento carrega a
 *  identidade visual que o ORGANIZADOR escolheu, e por isso mediria a cor de outra
 *  pessoa.
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

/**
 * A raiz pública da PLATAFORMA com o controle de aparência do visitante (FASE 63).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  SEM SESSÃO, E DE PROPÓSITO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Quem usa este controle é quem NÃO tem conta: nenhum `signInAs` aqui (o `preparar`
 *  acima é das telas do painel). O único cookie é o `ef_tema` — a mesma fiação do
 *  modo noturno —, gravado ANTES do `goto` para o servidor desenhar o modo escolhido
 *  na PRIMEIRA resposta, e não o sistema operacional da máquina que roda a suíte.
 *
 *  A espera afirma os DOIS fatos que a imagem precisa ter para valer como linha de
 *  base: o controle está no rodapé E é o modo pedido que está marcado. Sem isso, uma
 *  imagem do tema errado (ou de uma página sem o controle) viraria "padrão" sem
 *  ninguém perceber.
 */
async function abrirRaizPublica(page: Page, tema: 'claro' | 'escuro'): Promise<void> {
  await page.context().addCookies([{ name: 'ef_tema', value: tema, url: BASE }]);

  await page.goto('/');

  await expect(page.getByTestId('theme-choice')).toBeVisible();
  await expect(page.getByTestId(`theme-option-${tema}`)).toHaveAttribute('aria-pressed', 'true');

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

// ═══════════════════════════════════════════════════════════════════════════════
//  O RODAPÉ PÚBLICO DA PLATAFORMA (FASE 63) — o controle do VISITANTE, nos dois modos
//
//  A linha que a FASE 63 criou é a que mais fácil quebra em SILÊNCIO: três botões
//  lado a lado num rótulo de texto mudo, com um deles preenchido pela variante
//  `primary` — nada ali depende de dado, então `axe` e teste de unidade passam por
//  cima, e um `padding` que muda de token ou um botão que perde o `border` só
//  aparecem em pixel. Nenhuma máscara: a raiz é estática e não carrega `RUN_ID`,
//  e-mail nem slug de instituição nenhuma (ver o cabeçalho, seção do recorte).
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('rodapé público da plataforma', () => {
  test.use({ viewport: DESKTOP });

  /**
   * `fullPage` é o que garante que o RODAPÉ esteja na imagem.
   *
   * Hoje a raiz cabe inteira na viewport (1440×1200) e a linha aparece no lugar dela
   * sem rolagem — mas `toBeVisible` do Playwright não pergunta se o elemento está na
   * ÁREA fotografada, e uma seção nova acima do rodapé empurraria o alvo para fora da
   * imagem em silêncio: a linha de base continuaria verde medindo outra coisa. Com a
   * página inteira, o que a imagem mede é o desenho todo, com o rodapé onde ele vive.
   */
  const PAGINA_INTEIRA = { ...TOLERANCIA, fullPage: true } as const;

  test('13. o rodapé público da raiz no claro', async ({ page }) => {
    await abrirRaizPublica(page, 'claro');

    /**
     * A PÁGINA INTEIRA, com o rodapé no lugar dele — e não um recorte do `<footer>`:
     * foi um recorte que escondeu o contexto no defeito que abriu esta suíte (a
     * gaveta de 64 px passou por todas as catracas porque cada uma media um nó
     * sozinho). Aqui a imagem também denuncia o rodapé que estoura a largura de
     * `main` ou que invade a última seção.
     */
    await expect(page).toHaveScreenshot('rodape-publico-claro.png', PAGINA_INTEIRA);
  });

  test('14. o rodapé público da raiz no escuro', async ({ page }) => {
    await abrirRaizPublica(page, 'escuro');

    /** A prova de que o escuro veio do SERVIDOR (o cookie é lido na requisição). */
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    /**
     * O escuro é uma ESCALA NOVA, e é onde o botão marcado troca de par de contraste
     * (`primary` sobre `primary-foreground`): a segunda linha de base da FASE 63.
     */
    await expect(page).toHaveScreenshot('rodape-publico-escuro.png', PAGINA_INTEIRA);
  });
});
