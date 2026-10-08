import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createActivity,
  createEvent,
  createRoom,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';
import { favoriteActivity } from '../../src/lib/events/agenda-service';
import { applyRegistrationFormOperationOnEvent } from '../../src/lib/admin/registration-form-service';
import {
  addPageBlock,
  ensureHomePage,
  savePageSettings,
} from '../../src/lib/admin/landing-service';
import {
  publishTenantPublicPage,
  saveTenantPublicPageDraft,
} from '../../src/lib/tenancy/tenant-public-page-write-service';
import { unsubscribeUrlFor } from '../../src/lib/communication/unsubscribe-service';
import { createCampaign, dispatchCampaign } from '../../src/lib/communication/campaign-service';
import { composeSegment } from '../../src/domain/communication/segments';

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
 *  O CONJUNTO É PEQUENO DE PROPÓSITO: VINTE E DOIS SNAPSHOTS, OITO SUPERFÍCIES
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
 *    5. **A página pública da instituição** (`pagina-da-instituicao-claro`,
 *       `pagina-da-instituicao-escuro`) — **as duas linhas de base da FASE 64**: a
 *       vitrine que a instituição monta em `/t/<slug>` (capa, identidade, os três
 *       grupos de eventos e os blocos), nos dois modos do VISITANTE. É a superfície
 *       mais nova do produto e a que mais gente vê sem ter conta; ver a seção
 *       "A PÁGINA DA INSTITUIÇÃO" mais abaixo, que explica por que ela entra e a
 *       página do EVENTO continua de fora.
 *    6. **"Minha agenda"** (`minha-agenda-claro`, `minha-agenda-escuro`) — **as duas
 *       linhas de base da FASE 65**: a grade do dia (favoritos ∪ inscrições, com as
 *       duas marcas, os contadores e o bloco de choque). Tela DENSA e nova, nos dois
 *       modos do painel; ver "A MINHA AGENDA E A ABA DO AGORA" mais abaixo.
 *    7. **A aba "Acontecendo agora"** (`evento-aba-agora`) — a outra superfície da
 *       FASE 65, e a única desta suíte que é **relativa ao relógio**: a barra de
 *       progresso, o tempo restante e os horários mudam a cada minuto. Ela entra com
 *       essas quatro peças MASCARADAS e o motivo declarado (ver a mesma seção) — o que
 *       resta medido é o que a fase desenhou em volta delas.
 *    8. **O bloco de LOCAL da página do evento** (`evento-bloco-de-local`) — **a linha
 *       de base da FASE 69**, e a única do arquivo que nasceu de uma AUSÊNCIA: a aba
 *       "Acontecendo agora" não renderiza blocos, então o `VenueBlock` — o bloco que
 *       desenha o endereço físico e o da SALA ONLINE para quem tem lugar — nunca teve
 *       pixel medido, e o vazamento que a FASE 68 fechou passou por todas as catracas
 *       de imagem sem tocar nenhuma. Ver a seção própria no fim do arquivo.
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
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A EXCEÇÃO DECLARADA: O BLOCO DE LOCAL DO EVENTO (FASE 69)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 69 abriu UMA exceção a esse parágrafo, e ela é estreita de propósito: entra o
 *  **bloco de LOCAL** de um evento da FIXTURE (item 8), e não a página do evento. As
 *  três condições que a tornam honesta:
 *
 *    • **a identidade é a padrão** — o evento da fixture não tem `theme` próprio, então
 *      a imagem mede o desenho do bloco na paleta padrão, e não a cor de outra pessoa;
 *    • **o que está em volta é determinístico** — o evento antigo tem janela FIXA
 *      (`JANELA_ANTIGA`) e nada do bloco é relativo ao relógio;
 *    • **a superfície é NOVA** — até aqui o bloco não existia em imagem nenhuma, e um
 *      vazamento medido (o `onlineUrl` desenhado para qualquer visitante) atravessou
 *      todas as catracas de pixel justamente por isso.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PÁGINA DA INSTITUIÇÃO: POR QUE ELA ENTRA, E COMO ELA FICOU DETERMINÍSTICA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 64 pôs uma página NOVA na mesma família da raiz (item 5): `/t/<slug>`
 *  deixou de ser um redirect para o painel e virou a vitrine da casa. Ela entra nesta
 *  catraca pelo mesmo critério do rodapé público — é pública, é de todo mundo e é
 *  estática —, e com uma vantagem sobre a página do evento: **a identidade é da
 *  INSTITUIÇÃO da fixture** (criada por `createTenant`), não de um organizador
 *  qualquer, então medir a cor dela não é medir a cor de outra pessoa.
 *
 *  Determinismo, que é o que permite `maxDiffPixelRatio: 0`:
 *
 *    • **Nenhuma máscara é necessária** — e isso foi CONFERIDO, não suposto. O único
 *      dado que carrega o `RUN_ID` da execução é o SLUG da instituição, e o slug não
 *      aparece em pixel nenhum: o que a página escreve é o NOME (fixo,
 *      `TENANT_NAME`), o título e a descrição publicados (fixos) e o fuso. Os títulos
 *      de evento são fixos e escritos à mão aqui.
 *    • **As DATAS dos eventos da fixture são INSTANTES FIXOS.** Este é o ponto que a
 *      página quebra se ninguém olhar: o cartão de evento imprime o período
 *      ("10/03/2099 09:00 até 12/03/2099 18:00"), e o `createEvent` do helper ancora
 *      tudo em "daqui a N dias" — uma data relativa a HOJE mudaria a linha de base a
 *      cada dia, e a catraca passaria a acusar regressão onde havia calendário.
 *      `fixarJanela` reescreve a janela para um instante fixo, longe o bastante para
 *      não virar passado (2099) e um evento no passado igualmente fixo (2000).
 *      O grupo "Acontecendo agora" fica VAZIO de propósito: ele é o único que exigiria
 *      uma janela contendo o AGORA, que é relativa por definição. A frase do grupo
 *      vazio é fixa e é ela que a imagem registra.
 *    • **Sem capa e sem logotipo**: a imagem de capa viria de um upload com URL de
 *      bucket (que carrega a origem do ambiente), então as duas linhas de base medem a
 *      página no estado em que a maioria das instituições a publica — identidade
 *      tipográfica e blocos de texto.
 *
 *  Os dois modos entram porque a página da instituição é o único lugar do produto em
 *  que a escala do VISITANTE e a paleta da CASA convivem: o escopo publica os `--ef-*`
 *  da instituição (ADR-332) e o que a TELA pinta vem da escala do modo escolhido — uma
 *  troca de token do escuro não aparece em teste de unidade nenhum, e é isso que estas
 *  duas linhas de base prendem.
 *
 *  O que estas imagens NÃO provam (e está medido, com números, em
 *  `docs/fase-64-pagina-da-instituicao.md` §8.2): os `--ef-*` publicados pelo escopo
 *  **não chegam a pintar pixel nenhum**, porque a página usa os tokens do sistema e o
 *  `globals.css` resolve os apelidos na RAIZ — sobrescrever `--ef-primary` num
 *  descendente não re-resolve `--brand`. As duas linhas de base registram a ESCALA DO
 *  MODO, não a paleta da instituição; quando a paleta ganhar leitor, elas vão mudar, e
 *  a mudança será a prova de que o conserto chegou à tela.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MINHA AGENDA E A ABA DO AGORA (FASE 65) — O QUE ENTRA, O QUE É MASCARADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 65 entregou duas superfícies novas para o dia do evento, e nenhuma das duas
 *  tinha imagem. Elas entram aqui por dois caminhos DIFERENTES, porque uma é estática
 *  e a outra não é:
 *
 *    • **"Minha agenda"** (`/t/<slug>/minha-agenda?evento=<id>`), nos DOIS modos do
 *      painel. **Sem máscara nenhuma**, e isso foi conquistado, não suposto: as duas
 *      atividades da fixture nascem com instantes FIXOS (`JANELA_DA_GRADE_*`), então o
 *      horário que a tela imprime ("10/03/2099, 09:00 – 13:00") não muda de um dia
 *      para o outro — foi exatamente o problema que a página da instituição já tinha
 *      (FASE 64) e que `fixarJanela` resolveu. O nome da conta, o nome da instituição
 *      e os títulos são FIXOS (nada carrega o `RUN_ID`); o endereço do `.ics` carrega
 *      um token, mas token não é pixel. A tela entra com conteúdo de verdade: DUAS
 *      marcas (inscrita e favorita), os quatro contadores, um CHOQUE de horário por
 *      CONTER e os dois caminhos de exportação. Uma agenda vazia desenharia uma frase
 *      e nenhum dos componentes que esta fase criou.
 *
 *    • **A aba "Acontecendo agora"** (`/t/<slug>/eventos/<slug>?aba=agora`), em UMA
 *      linha de base — e **com quatro máscaras**, cada uma com o motivo medido:
 *
 *        1. o PREENCHIMENTO da barra (`agora-barra > div`) — a largura é o quanto já
 *           decorreu, e ela muda a cada minuto: é a peça que a própria fase mandou
 *           mascarar;
 *        2. o TEXTO do tempo restante (`agora-restante`) — "termina em 39 min" muda a
 *           cada minuto. O que ele AFIRMA não fica sem prova: o E2E funcional da fase
 *           (`f65-exportacao.spec.ts`, bloco (e)) confere o texto e o `aria-valuetext`,
 *           e o portão de acessibilidade confere os atributos ARIA. Aqui a imagem mede
 *           o DESENHO em volta, não o número;
 *        3. o HORÁRIO do cartão (`agora-horario-*`) — a janela da atividade em curso é
 *           relativa a agora, então o rótulo é outra data a cada execução;
 *        4. a linha do "A SEGUIR nesta sala" (`agora-proxima-*`) — mesma razão: ela
 *           imprime a hora de início da próxima.
 *
 *      O que a imagem AINDA mede, e é bastante: as duas abas com o estado ativo, o
 *      título e a legenda da seção, o cabeçalho da SALA, o cartão inteiro (título,
 *      etiqueta "Em curso", os ícones da linha de informação), o TRILHO da barra e a
 *      geometria do preenchimento, os dois caminhos (crachá e balcão) e o rodapé com a
 *      contagem de atividades. Nenhuma dessas peças é relativa ao relógio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ABA DO AGORA NÃO ENTRA NOS DOIS MODOS, E NÃO É ESQUECIMENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Na página do EVENTO quem manda no claro/escuro é o ORGANIZADOR (FASE 61 · ADR-325),
 *  e não o cookie do visitante: o `ef_tema` não tem efeito nenhum ali. Duas linhas de
 *  base "claro" e "escuro" seriam a MESMA imagem duas vezes — e uma linha de base que
 *  não distingue nada é uma linha de base que não mede nada. Quem quiser o escuro do
 *  EVENTO mede o tema com o `ThemeScope` (é o que a catraca de unidade da fase faz).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PREÇO PAGO NAS LINHAS DE BASE QUE JÁ EXISTIAM (e como ele foi conferido)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As cinco atividades da fixture nova são do MESMO evento da instituição, e duas
 *  telas antigas contam dado de instituição: o painel conta atividades ("Atividades"
 *  passou de 1 para 5) e o diretório de participantes conta, por PESSOA, os eventos e
 *  as inscrições confirmadas — a dona da conta ganhou uma inscrição nesta fase, e a
 *  linha dela mudou de "0 evento(s)" para "1 evento(s) / 1 inscrição(ões)
 *  confirmada(s)".
 *
 *  As QUATRO linhas de base afetadas (painel e diretório, no desktop, claro e escuro)
 *  foram regeradas, e a mudança foi MEDIDA antes: a caixa dos pixels diferentes é
 *  `x 706..719 · y 165..183` no painel (o dígito do cartão) e `x 320..1025 · y
 *  204..866` no diretório (a linha da dona da conta) — nada mais mudou. As de celular
 *  não mudaram: o que mudou está abaixo da dobra numa viewport de 844 px.
 *
 *  Registrado aqui porque "regerar porque mudou o número" é indistinguível de "regerar
 *  para esconder uma regressão" sem esta frase.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PREÇO PAGO NAS LINHAS DE BASE QUE JÁ EXISTIAM — FASE 67 (medido, item a item)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fixture da FASE 67 acrescentou à MESMA instituição **uma atividade** (a "Oficina
 *  dos segmentos") e **duas contas** (a organizadora da fixture e a participante do
 *  descadastro). Três telas já existentes CONTAM esse dado, e a medição encontrou cada
 *  diferença — nenhuma delas é de desenho:
 *
 *    • **painel** (claro e escuro) — o cartão "Atividades" foi de **1 para 6**: **23
 *      pixels** diferentes no claro e **15** no escuro, na caixa do dígito. Foram as
 *      duas linhas de base regeradas;
 *    • **diretório de participantes** (claro e escuro) — a lista é a UNIÃO de vínculo e
 *      inscrição, então as duas contas novas ganharam linha: **989** e **1004** pixels,
 *      na região da tabela. Também regeradas;
 *    • **aba "Acontecendo agora"** — o rodapé do evento conta as atividades do EVENTO:
 *      "5 atividades · 9h de programação" virou **"6 atividades · 10h"** — **781
 *      pixels** medidos. Aqui o conteúdo mudou e o PIXEL não: com a oficina em outro
 *      evento, o rodapé voltou ao que era e o arquivo da linha de base saiu **idêntico**
 *      da regeração (o `git status` não o lista como modificado) — a linha de base não
 *      foi tocada.
 *
 *  E **duas linhas de base foram DEFENDIDAS em vez de regeradas** — as duas por
 *  fixture, e não por teste:
 *
 *    • **"minha agenda"** (claro e escuro) — a primeira versão da fixture pendurou a
 *      oficina no evento da vitrine, e a agenda passou a medi-la (3 itens, 2 inscritas
 *      e 3 choques). Ajustar horários para o número voltar virou caça ao resultado: o
 *      conserto foi a oficina ir para um **evento só dela**, e os números da FASE 65
 *      ficaram intactos (**zero pixel**);
 *    • **página pública da instituição** (claro e escuro) — com o evento dos segmentos
 *      publicado, ele entrava em "Em breve" (ou, com janela fixa, em "Edições
 *      anteriores") ao lado do evento da vitrine, e a imagem piscava **1.886 pixels**
 *      (os dois títulos começam por "Mostra de"). O evento dos segmentos nasce
 *      **RASCUNHO**, e rascunho não aparece em grupo nenhum: **zero pixel**.
 *
 *  As **8 linhas de base** tocadas foram medidas com a caixa dos pixels diferentes, e a
 *  conferência de estabilidade — duas execuções seguidas com **zero pixel** de
 *  diferença nas 21 — está no documento da fase. O que NÃO mudou: o desenho.
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
/** O `id` de quem administra a fixture: é ele que assina a publicação da página (FASE 64). */
let idDaConta: string;
/** O evento da vitrine — é nele que a FASE 65 pendura a grade e a atividade em curso. */
let eventoId: string;
/** O `slug` do mesmo evento: a aba do "agora" é uma URL pública, sem `evento=<id>`. */
let eventoSlug: string;
/**
 * A atividade e o token da FASE 67.
 *
 * A atividade é da MESMA instituição e o titular da conta fica inscrito nela: é o que
 * faz a aba "Segmentos" ter RESULTADO (contagem 1 e uma pessoa na prévia) em vez do
 * estado vazio. O token é o endereço de descadastro do titular — derivado, e não
 * inventado: é o mesmo que o rodapé do e-mail leva.
 */
let atividadeDosSegmentosId: string;
let eventoDosSegmentosId: string;
let TOKEN_DE_DESCADASTRO: string;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS DATAS DA PÁGINA DA INSTITUIÇÃO SÃO INSTANTES FIXOS (FASE 64)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O cartão de evento da vitrine imprime o PERÍODO, e um período relativo a hoje
 *  mudaria a linha de base a cada dia — que é a definição de linha de base inútil.
 *  Os dois instantes abaixo são fixos e ficam onde precisam ficar: o primeiro no
 *  FUTURO (o grupo "Em breve") e o segundo no PASSADO (o grupo "Edições anteriores").
 *  O horário é 12:00 UTC porque 09:00 no fuso da instituição é dia útil e não cruza a
 *  virada de data em nenhum fuso do Brasil.
 */
const JANELA_FUTURA = {
  startsAt: new Date('2099-03-10T12:00:00.000Z'),
  endsAt: new Date('2099-03-12T21:00:00.000Z'),
} as const;

const JANELA_ANTIGA = {
  startsAt: new Date('2000-05-04T12:00:00.000Z'),
  endsAt: new Date('2000-05-06T21:00:00.000Z'),
} as const;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS ATIVIDADES DA "MINHA AGENDA" — INSTANTES FIXOS, E UM CHOQUE (FASE 65)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Mesma razão da janela do evento: a grade imprime o horário de cada atividade, e um
 *  horário relativo a hoje mudaria a linha de base a cada dia. Os dois instantes são
 *  fixos, dentro da janela do evento (2099) e no dia 10/03/2099 — 09:00–13:00 e
 *  10:00–11:00 em Salvador (UTC−3), a mesma hora do cartão do evento.
 *
 *  A segunda cai DENTRO da primeira: é o caso de CONTER, que a régua da sobreposição
 *  decide como choque (encostar não é). A tela assim mostra o bloco de aviso — o
 *  componente que a fase criou para dizer "você escolhe qual assistir" —, e não só a
 *  lista de itens.
 */
const GRADE_LONGA = {
  startsAt: new Date('2099-03-10T12:00:00.000Z'),
  endsAt: new Date('2099-03-10T16:00:00.000Z'),
} as const;

const GRADE_INTERNA = {
  startsAt: new Date('2099-03-10T13:00:00.000Z'),
  endsAt: new Date('2099-03-10T14:00:00.000Z'),
} as const;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A ATIVIDADE DA FASE 67 NÃO ENTRA NA GRADE — E ESSA É A LIÇÃO (FASE 67)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A primeira versão da fixture da FASE 67 pendurou a "Oficina dos segmentos" no
 *  evento da vitrine, e a "minha agenda" passou a medi-la: o resumo foi para 3 itens,
 *  2 inscritas e **3 choques** (a grade longa contém a oficina E a palestra, e a
 *  palestra contém a oficina). Ajustar horários para o número voltar a 1 virou uma
 *  caça ao resultado: o problema não era o horário, era a atividade estar no evento
 *  que a linha de base mede. O conserto é de FIXTURE — a oficina nasce num **evento só
 *  dela** (ver `eventoSegmentos` no `beforeAll`) —, e nenhuma asserção de agenda, de
 *  choque ou de contagem do evento precisou mudar.
 *
 *  Por isso NÃO existe constante de janela para ela aqui: os instantes da oficina são
 *  do evento dela, e nenhuma tela desta suíte imprime data desse evento.
 */

/** Os títulos são fixos (sem `RUN_ID`): é o que permite a linha de base não ter máscara. */
const EVENTO_FUTURO_TITULO = 'Mostra de Arte e Ciência';
const EVENTO_ANTIGO_TITULO = 'Bienal do Recôncavo';
const EVENTO_DOS_SEGMENTOS_TITULO = 'Mostra de Extensão';
/** A sala da grade — o nome dela é impresso no item, então ele também é fixo. */
const SALA_DA_GRADE = 'Sala de oficinas';
/** A sala da atividade em curso, na aba do agora (é o nome do grupo). */
const SALA_DO_AGORA = 'Auditório Central';
/** Os títulos das atividades da FASE 65, fixos como os dos eventos. */
const GRADE_LONGA_TITULO = 'Minicurso de avaliação por pares';
const GRADE_INTERNA_TITULO = 'Palestra sobre rubricas';
const ATIVIDADE_EM_CURSO_TITULO = 'Mesa redonda sobre avaliação por pares';
const TEXTO_DE_SOBRE =
  'Fundado em 1974, o instituto reúne ateliês, galerias e um programa público de formação.';
const TEXTO_DE_CONTATO =
  'Rua das Artes Visuais, 240 — Santo Amaro/BA';

/**
 * O endereço da sala online da atividade EM CURSO (FASE 68 · fatia 5).
 *
 * Ele é o que o `NowCard` desenha no cartão do "acontecendo agora" — e o que a linha
 * de base `evento-aba-agora.png` passou a medir. O host é `.test` de propósito, como
 * o resto das fixtures: nada aqui resolve por DNS, o que importa é o `href`.
 */
const ENDERECO_DO_AGORA = 'https://sala.exemplo.test/a11y-visual';

/**
 * O endereço da sala online do EVENTO e o endereço FÍSICO do bloco de LOCAL (FASE 69).
 *
 * São os dois dados que o `VenueBlock` desenha — e é a imagem DELES que faltava. O
 * endereço físico é o mesmo texto que a página da instituição publica no bloco de
 * contato (`TEXTO_DE_CONTATO`): é texto de fixture, escrito à mão, e não carrega o
 * `RUN_ID` — sem isso a linha de base mudaria a cada execução.
 */
const ENDERECO_DO_LOCAL = 'https://sala.exemplo.test/local-do-evento';
const ENDERECO_FISICO_DO_EVENTO = 'Rua das Artes Visuais, 240 — Santo Amaro/BA';

/**
 * O `id` da atividade EM CURSO — o `agora-item-<id>`/`agora-sala-online-<id>` do cartão.
 *
 * É o único `id` desta fixture que precisa viver fora do `beforeAll`: as asserções da
 * aba do agora o usam para ESCOPAR a barra e o link ao cartão certo (a contagem por
 * prefixo não bastaria se o evento tivesse duas atividades em curso).
 */
let atividadeDoAgoraId: string;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A PÁGINA DE INSCRIÇÃO COM OS CAMPOS DECLARADOS (FASE 70 · a linha de base 23)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELA ENTRA, E O QUE FOI MEDIDO ANTES DE DECIDIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 70 deu à página de inscrição uma superfície nova: os campos que o
 *  ORGANIZADOR declara (seis tipos, seis controles) com a ajuda e a finalidade ao
 *  lado. A decisão de medir pixel aqui NÃO foi tomada no olho — ela foi medida, e a
 *  medição é esta:
 *
 *    • a página é **DETERMINÍSTICA**: duas execuções seguidas da MESMA fixture deram
 *      **0 pixel** de diferença em 1440×1467 (2.112.480 pixels). Não há máscara
 *      nenhuma, e nenhuma é necessária — o `RUN_ID` da execução vive no SLUG, e o
 *      slug não é desenhado;
 *    • o ÚNICO pixel que depende do relógio é o rótulo do PERÍODO: deslocar a janela
 *      do evento em UM dia mudou **1.662 pixels**, na caixa `x 238..474 · y 317..330`
 *      — exatamente a linha que imprime "10 de março de 2099 – 12 de março de 2099".
 *      É o mesmo problema que a vitrine da instituição já tinha (FASE 64) e que
 *      `JANELA_FUTURA` resolve: a janela do evento é um INSTANTE FIXO, e o rótulo
 *      passa a ser o mesmo em qualquer dia em que a suíte rodar.
 *
 *  Com as duas coisas medidas — determinismo provado e a única fonte de variação
 *  identificada e neutralizada pela fixture —, a linha de base VALE: ela é a única
 *  catraca que pega o que o `axe` não vê (rótulo que quebra a linha, ajuda que empurra
 *  o controle, largura do campo que muda com o tipo, o cartão que estoura).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA INSTITUIÇÃO PRÓPRIA, E NÃO A DA VITRINE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A vitrine (`pagina-da-instituicao-*.png`) desenha TODOS os eventos visíveis da
 *  instituição da fixture, agrupados por data: publicar mais um evento em 2099
 *  mudaria as DUAS linhas de base dela (a FASE 67 pagou essa conta — 1.886 pixels por
 *  causa de um segundo cartão em "Em breve"). Uma instituição própria para esta
 *  superfície custa uma fixture a mais e **zero pixel** nas 22 linhas de base que já
 *  existiam — e é a MESMA escolha que as fases 65, 68 e 69 fizeram quando a superfície
 *  nova era de outro assunto (o evento dedicado da sala online, o do tema escuro).
 *
 *  A identidade é a PADRÃO (o evento não tem `theme` próprio) e o evento NÃO tem
 *  página publicada: a imagem mede o desenho da plataforma, e não a cor de outra
 *  pessoa — a condição que a exceção da FASE 69 já declarou.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS TÍTULOS SÃO FIXOS, E A CONTA É A MESMA DA VITRINE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O título do evento aparece na página (o link de volta), e o nome da instituição
 *  aparece no cabeçalho: os dois são escritos à mão, sem o `RUN_ID`. A conta que entra
 *  é a dona da fixture, VINCULADA à segunda instituição como `PARTICIPANT` — sem
 *  vínculo e sem papel ela não veria o formulário, e a imagem mediria o cartão "Entre
 *  para se inscrever" em vez dos campos que esta fase criou.
 */
const TENANT_INSCRICAO_LABEL = 'f62-inscricao';
const TENANT_INSCRICAO_NAME = 'Escola de Extensão do Recôncavo';
const EVENTO_DA_INSCRICAO_TITULO = 'Seminário de Práticas Extensionistas';
const ATIVIDADE_ABERTA_TITULO = 'Mesa de abertura';
const ATIVIDADE_PROPRIA_TITULO = 'Oficina de escrita acadêmica';
const CAPACIDADE_DO_EVENTO = 100;

/**
 * Os SEIS tipos da allowlist, um de cada — cada um vira um controle diferente, e é
 * isso que a imagem mede. A ordem é a da tela, e ela é o conteúdo do bloco.
 */
const CAMPOS_DECLARADOS = [
  {
    key: 'instituicao',
    label: 'Instituição de origem',
    type: 'SHORT_TEXT',
    required: true,
    help: 'Onde você estuda ou trabalha hoje.',
  },
  {
    key: 'observacoes',
    label: 'Observações para a organização',
    type: 'LONG_TEXT',
    required: false,
    purpose: 'Registrar pedidos que não cabem nas outras perguntas.',
  },
  {
    key: 'chegada',
    label: 'Horário previsto de chegada',
    type: 'SINGLE_CHOICE',
    required: false,
    options: ['Manhã', 'Tarde', 'Noite'],
  },
  { key: 'libras', label: 'Precisa de intérprete de Libras?', type: 'YES_NO', required: false },
  {
    key: 'acompanhantes',
    label: 'Quantos acompanhantes virão com você',
    type: 'NUMBER',
    required: false,
    min: 0,
    max: 5,
  },
  { key: 'chegada_em', label: 'Data prevista de chegada', type: 'DATE', required: false },
] as const;

/** O `slug` da instituição da página de inscrição — o endereço que a varredura abre. */
let tenantInscricaoSlug: string;
/**
 * A conta da página de inscrição: ela SÓ existe nesta instituição.
 *
 * É o que evita o painel de escolha de contexto (ver o comentário na fixture) e o que
 * dispensa máscara na imagem — o endereço de quem entrou não é desenhado na página
 * pública de inscrição.
 */
let emailDaInscricao: string;

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
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A JANELA DE DATAS DA FIXTURA, DITA EM INSTANTES (FASE 64)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O `createEvent` do helper ancora tudo em "daqui a N dias", que é o certo para as
 *  outras specs e o ERRADO aqui: a vitrine da instituição imprime o período do
 *  evento, e "daqui a 30 dias" é uma data diferente a cada execução. `fixarJanela`
 *  reescreve a janela depois que o evento existe (o evento continua nascendo pelo
 *  helper, com todas as outras colunas dele), e `criarEventoComJanela` cria o evento
 *  antigo que o helper não sabe montar.
 *
 *  Os dois passam pelo contexto de instituição, como todo dado de tenant.
 */
async function fixarJanela(input: {
  tenantId: string;
  eventId: string;
  startsAt: Date;
  endsAt: Date;
}): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.event.update({
      where: { id: input.eventId },
      data: { startsAt: input.startsAt, endsAt: input.endsAt },
    });
  });
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A MESMA IDEIA PARA A ATIVIDADE (FASE 65)
 * ─────────────────────────────────────────────────────────────────────────────
 *  `createActivity` ancora o início em "daqui a N dias" — o certo para as outras
 *  specs e o ERRADO aqui, porque a minha agenda IMPRIME o horário de cada item. A
 *  atividade continua nascendo pelo helper (com todas as colunas dele); o que este
 *  ajuste reescreve é a JANELA, depois que ela existe.
 */
async function fixarAtividade(input: {
  tenantId: string;
  activityId: string;
  startsAt: Date;
  endsAt: Date;
}): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.activity.update({
      where: { id: input.activityId },
      data: {
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        workloadMinutes: Math.round(
          (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000,
        ),
      },
    });
  });
}

/**
 * A inscrição CONFIRMADA de quem administra a fixture numa atividade.
 *
 * O caminho da tela tem spec própria; aqui a inscrição é o FATO que a grade precisa
 * ENCONTRAR — sem ela, "minha agenda" não teria a marca `Inscrito` nem o par em
 * choque, e a linha de base registraria uma tela mais pobre do que a que a pessoa usa.
 */
async function inscreverNaAtividade(input: {
  tenantId: string;
  eventId: string;
  activityId: string;
  userId: string;
}): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        eventId: input.eventId,
        activityId: input.activityId,
        userId: input.userId,
        status: 'CONFIRMED',
      },
    });
  });
}

async function criarEventoComJanela(input: {
  tenantId: string;
  slug: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
}): Promise<string> {
  const id = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.event.create({
      data: {
        id,
        tenantId: input.tenantId,
        slug: input.slug,
        title: input.title,
        summary: null,
        status: 'PUBLISHED',
        modality: 'IN_PERSON',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: 'America/Bahia',
        city: 'Santo Amaro',
        state: 'BA',
        capacity: null,
        confirmedCount: 0,
        registrationOpensAt: new Date('1999-01-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2099-12-31T00:00:00.000Z'),
      },
    });
  });

  /** O `id` sai daqui porque a FASE 69 manda publicar a PÁGINA dele (o bloco de LOCAL). */
  return id;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  O ENDEREÇO FÍSICO E A SALA ONLINE DO EVENTO (FASE 69)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O `VenueBlock` lê os dois do EVENTO (não do conteúdo do bloco), e a fixture os
 *  escreve depois que o evento existe — o mesmo caminho de `fixarJanela`.
 *
 *  `venueName` NÃO é tocado de propósito: o cartão da vitrine da instituição imprime
 *  `venueName, cidade/UF` quando ele existe, e escrevê-lo mudaria DUAS linhas de base
 *  (`pagina-da-instituicao-claro/escuro`) por um motivo que não é do assunto desta
 *  imagem. `venueAddress` não aparece em cartão nenhum — só no bloco de LOCAL, que é
 *  exatamente onde ele deve aparecer.
 */
async function fixarLocalDoEvento(input: {
  tenantId: string;
  eventId: string;
  venueAddress: string;
  onlineUrl: string;
}): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.event.update({
      where: { id: input.eventId },
      data: { venueAddress: input.venueAddress, onlineUrl: input.onlineUrl },
    });
  });
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({ label: TENANT_LABEL, name: TENANT_NAME });
    tenantSlug = tenant.slug;

    const conta = await signUpVia(api, NOME_DA_CONTA);
    emailDaConta = conta.email;
    idDaConta = conta.id;

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
      title: EVENTO_FUTURO_TITULO,
      status: 'REGISTRATION_OPEN',
      capacity: 100,
    });

    eventoId = event.id;
    eventoSlug = event.slug;

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A JANELA DO EVENTO VIRA UM INSTANTE FIXO (FASE 64)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Sem isto a vitrine da instituição imprimiria "daqui a 30 dias" em número, e a
     *  linha de base mudaria todo dia. O evento continua sendo o MESMO para o painel e
     *  para o diretório de participantes — nenhum dos dois desenha esta data (o
     *  `<select>` de evento mostra a opção SELECIONADA, que é "Todos os eventos", e a
     *  opção fechada de um `<select>` não é pintada).
     */
    await fixarJanela({ tenantId: tenant.id, eventId: event.id, ...JANELA_FUTURA });

    const eventoAntigoId = await criarEventoComJanela({
      tenantId: tenant.id,
      slug: `antigo-${RUN_ID}`,
      title: EVENTO_ANTIGO_TITULO,
      ...JANELA_ANTIGA,
    });

    /**
     * ═══════════════════════════════════════════════════════════════════════════════
     *  O BLOCO DE LOCAL GANHA LINHA DE BASE (FASE 69 · os quatro pontos da F68)
     *
     *  ─────────────────────────────────────────────────────────────────────────────
     *  O QUE FALTAVA, E POR QUE O BURACO ERA ESTRUTURAL
     *  ─────────────────────────────────────────────────────────────────────────────
     *  O `VenueBlock` (`block-renderer.tsx`) é o bloco de LOCAL da página do evento — o
     *  lugar onde o endereço da sala online aparece para quem tem lugar. Ele **não
     *  tinha linha de base visual**, e não por esquecimento: a única superfície do
     *  evento que esta suíte fotografava é a aba "Acontecendo agora" (`?aba=agora`), e
     *  essa aba **não renderiza blocos** — o bloco não existia em imagem nenhuma. O
     *  defeito que ele já teve (a FASE 68 mediu o vazamento: `Event.onlineUrl` desenhado
     *  para QUALQUER visitante) passou por todas as catracas de pixel justamente porque
     *  não havia pixel dele.
     *
     *  ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE A PÁGINA DESTE EVENTO, E NÃO A DO EVENTO DA VITRINE
     *  ─────────────────────────────────────────────────────────────────────────────
     *  Publicar uma página com blocos no evento que "minha agenda" e a aba do "agora"
     *  medem mudaria o desenho delas (a agenda passaria a desenhar o link da sala do
     *  evento, porque a dona da conta é a EQUIPE e vê tudo) — as três linhas de base
     *  pagariam por uma imagem só. É a lição que a FASE 67 pagou duas vezes ("o
     *  conserto é de FIXTURE"), e ela vale aqui inteira.
     *
     *  O evento ANTIGO serve porque já está na vitrine como cartão de "Edições
     *  anteriores" e o conteúdo do cartão NÃO depende da página nem de `venueAddress`
     *  (o cartão imprime `venueName, cidade/UF`, e `venueName` fica `null` — ver
     *  `fixarLocalDoEvento`). As duas linhas de base da vitrine continuam medindo o
     *  mesmo desenho.
     *
     *  ─────────────────────────────────────────────────────────────────────────────
     *  A PÁGINA E O BLOCO NASCEM PELOS SERVIÇOS REAIS
     *  ─────────────────────────────────────────────────────────────────────────────
     *  `ensureHomePage` + `addPageBlock` + `savePageSettings` são o caminho do EDITOR
     *  (validação de tema, trilha de auditoria e versão da página). Inserir as linhas
     *  por `e2eDb` mediria uma página que o editor nunca produziria — a mesma razão do
     *  E2E da FASE 23.
     */
    await fixarLocalDoEvento({
      tenantId: tenant.id,
      eventId: eventoAntigoId,
      venueAddress: ENDERECO_FISICO_DO_EVENTO,
      onlineUrl: ENDERECO_DO_LOCAL,
    });

    const paginaDoLocal = await ensureHomePage({
      tenantId: tenant.id,
      eventId: eventoAntigoId,
      actorId: idDaConta,
      title: EVENTO_ANTIGO_TITULO,
    });

    if (!paginaDoLocal.ok) throw new Error(`Falha ao criar a página: ${paginaDoLocal.message}`);

    const blocoDeLocal = await addPageBlock({
      tenantId: tenant.id,
      eventId: eventoAntigoId,
      actorId: idDaConta,
      type: 'VENUE_MAP',
    });

    if (!blocoDeLocal.ok) throw new Error(`Falha ao criar o bloco: ${blocoDeLocal.message}`);

    const paginaPublicada = await savePageSettings({
      tenantId: tenant.id,
      eventId: eventoAntigoId,
      actorId: idDaConta,
      title: EVENTO_ANTIGO_TITULO,
      isPublished: true,
    });

    if (!paginaPublicada.ok) throw new Error(`Falha ao publicar: ${paginaPublicada.message}`);
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PÁGINA PÚBLICA DA INSTITUIÇÃO É PUBLICADA PELO SERVIÇO REAL (FASE 64)
     * ─────────────────────────────────────────────────────────────────────────────
     *  `saveTenantPublicPageDraft` + `publishTenantPublicPage` são o caminho da fatia
     *  1 (validação, trilha, rascunho × publicado). Inserir a linha com `e2eDb`
     *  pularia a régua que o editor usa — e a imagem mediria uma página que o editor
     *  nunca produziria (a mesma razão do E2E da fase).
     *
     *  Sem capa e sem logotipo de propósito: os dois viriam de upload com URL de
     *  bucket, e a linha de base passaria a medir a origem do ambiente.
     */
    const rascunho = await saveTenantPublicPageDraft({
      tenantId: tenant.id,
      actorId: idDaConta,
      title: TENANT_NAME,
      description: 'A casa das artes visuais do Recôncavo, com agenda aberta o ano inteiro.',
      blocks: [
        {
          type: 'ABOUT',
          content: { title: 'Quem somos', foundedLabel: '1974', body: TEXTO_DE_SOBRE },
        },
        {
          type: 'CONTACT',
          content: {
            title: 'Contato e localização',
            address: TEXTO_DE_CONTATO,
            email: 'secretaria@institutovisual.test',
          },
        },
      ],
    });

    if (!rascunho.ok) throw new Error(`Falha ao gravar a página: ${rascunho.message}`);

    const publicada = await publishTenantPublicPage({ tenantId: tenant.id, actorId: idDaConta });

    if (!publicada.ok) throw new Error(`Falha ao publicar a página: ${publicada.message}`);

    await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `abertura-${RUN_ID}`,
      title: 'Mesa de abertura',
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A FIXTURE DA FASE 67 (fatias 2 e 3) — o segmento com resultado e o token
     * ─────────────────────────────────────────────────────────────────────────────
     *  A atividade é do MESMO evento da vitrine, e o titular da conta fica inscrito
     *  nela com `status: CONFIRMED` (o estado que o construtor `inscrito-na-atividade`
     *  seleciona). É o que faz a aba "Segmentos" desenhar a CONTAGEM, as FRASES e a
     *  PRÉVIA com uma pessoa — uma aba sem resultado desenharia o estado vazio e a
     *  linha de base registraria uma tela que ninguém usa.
     *
     *  A inscrição vai pelo banco dentro do contexto da instituição, como o resto das
     *  fixtures de inscrição deste arquivo (o caminho da tela tem spec próprio).
     */
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ATIVIDADE DA FASE 67 MORA NUM EVENTO SÓ DELA — E ISSO FOI MEDIDO
     * ─────────────────────────────────────────────────────────────────────────────
     *  A aba "Segmentos" precisa de UMA atividade com UMA pessoa inscrita, e a
     *  primeira versão desta fixture pendurou essa atividade no evento da vitrine. Duas
     *  linhas de base pagaram por isso, e cada uma ensinou uma coisa:
     *
     *    • **"minha agenda"** — a oficina passou a aparecer na grade, e com ela o
     *      resumo foi para 3 itens, 2 inscritas e **3 choques** (a grade longa contém a
     *      oficina E a palestra, e a palestra contém a oficina). Ajustar horários para
     *      não chocar virou uma caça ao número: o problema não era o horário, era a
     *      atividade estar NO evento que a linha de base mede;
     *    • **"acontecendo agora"** — o rodapé do evento conta as atividades dele
     *      ("6 atividades · 10h de programação" no lugar de "5 · 9h").
     *
     *  O conserto é de FIXTURE, não de teste: a atividade (e o evento dela) nasce fora
     *  do evento da vitrine, e a linha de base volta a medir exatamente o que media —
     *  sem mexer em nenhuma asserção de agenda, de choque ou de contagem do evento.
     *  O que a fase precisava provar (um segmento com resultado e um histórico com uma
     *  campanha) continua provado: a aba "Segmentos" aponta para este evento.
     */
    const eventoSegmentos = await createEvent({
      tenantId: tenant.id,
      slug: `segmentos-${RUN_ID}`,
      title: EVENTO_DOS_SEGMENTOS_TITULO,
      /**
       * ───────────────────────────────────────────────────────────────────────────
       *  RASCUNHO DE PROPÓSITO — É O QUE MANTÉM A VITRINE INTACTA (ver o cabeçalho)
       * ───────────────────────────────────────────────────────────────────────────
       *  Rascunho não aparece em grupo nenhum da página da instituição, e a aba
       *  "Segmentos" não exige evento publicado: o recorte dela é por FATOS. Assim este
       *  evento existe só para hospedar a atividade e a inscrição que a fase prova, e
       *  as duas linhas de base da vitrine continuam medindo os mesmos cartões.
       */
      status: 'DRAFT',
      capacity: 50,
    });

    await fixarJanela({ tenantId: tenant.id, eventId: eventoSegmentos.id, ...JANELA_ANTIGA });

    const atividadeDosSegmentos = await createActivity({
      tenantId: tenant.id,
      eventId: eventoSegmentos.id,
      slug: `oficina-${RUN_ID}`,
      title: 'Oficina dos segmentos',
      startsAtOffsetDays: 30,
      workloadMinutes: 60,
    });

    atividadeDosSegmentosId = atividadeDosSegmentos.id;
    eventoDosSegmentosId = eventoSegmentos.id;

    await inscreverNaAtividade({
      tenantId: tenant.id,
      eventId: eventoSegmentos.id,
      activityId: atividadeDosSegmentosId,
      userId: idDaConta,
    });

    /**
     * ── UMA CAMPANHA JÁ DISPARADA ─────────────────────────────────────────────────
     *  O HISTÓRICO é metade do desenho da aba, e uma lista vazia desenharia o
     *  `EmptyState`. A campanha nasce pelos serviços REAIS (`composeSegment` +
     *  `createCampaign` + `dispatchCampaign`) — o mesmo caminho da tela —, e o
     *  segmento é o mesmo da URL do teste 20: assim o que a imagem mede é coerente
     *  com o que ela afirma.
     *
     *  O limitador de ritmo é injetado porque o padrão é o Redis da FASE 13, e o que
     *  este arquivo quer é o DESENHO da linha do histórico, não o comportamento do
     *  limitador (esse tem prova própria no E2E da fase).
     */
    const definicao = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: atividadeDosSegmentosId } }],
    });

    if (!definicao.ok) throw new Error(`Segmento inválido na fixture: ${definicao.message}`);

    const campanha = await createCampaign({
      tenantId: tenant.id,
      actorId: idDaConta,
      eventId: eventoDosSegmentosId,
      definition: definicao.definition,
      subject: 'Material da oficina dos segmentos',
      body: 'O material já está no portal do participante.',
    });

    if (!campanha.ok) throw new Error(`Falha ao criar a campanha da fixture: ${campanha.message}`);

    const disparo = await dispatchCampaign({
      tenantId: tenant.id,
      campaignId: campanha.campaignId,
      actorId: idDaConta,
      rateLimit: { async consume() { return { allowed: true, retryAfter: null }; } },
      wait: async () => {},
    });

    if (!disparo.ok) throw new Error(`Falha ao disparar a campanha da fixture: ${disparo.message}`);

    const endereco = unsubscribeUrlFor({
      tenantSlug: tenant.slug,
      tenantId: tenant.id,
      userId: idDaConta,
    });

    if (!endereco) throw new Error('Não foi possível derivar o endereço de descadastro.');

    TOKEN_DE_DESCADASTRO = endereco.split('/').pop() ?? '';

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  AS ATIVIDADES DA FASE 65 (fatia 5) — a grade e a aba do "agora"
     * ─────────────────────────────────────────────────────────────────────────────
     *  Três atividades no MESMO evento da vitrine, e cada uma tem um papel:
     *
     *    • as DUAS primeiras formam a "minha agenda" — a pessoa está INSCRITA na longa
     *      e FAVORITOU a interna, que cai dentro dela (o choque por CONTER);
     *    • a terceira está EM CURSO (começou há vinte minutos, termina em quarenta) e
     *      dá conteúdo à aba "Acontecendo agora": sem ela a aba desenharia o estado
     *      vazio, e a barra de progresso — a peça com `role` e contraste medidos — nem
     *      existiria no DOM.
     *
     *  Os instantes das duas primeiras são FIXOS; o da terceira não tem como ser (é
     *  "agora"), e é por isso que a linha de base dela entra com máscara (ver o
     *  cabeçalho).
     */
    const salaDaGrade = await createRoom({
      tenantId: tenant.id,
      eventId: event.id,
      name: SALA_DA_GRADE,
      capacity: 60,
    });

    const gradeLonga = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `grade-longa-${RUN_ID}`,
      title: GRADE_LONGA_TITULO,
      roomId: salaDaGrade.id,
      workloadMinutes: 240,
    });

    const gradeInterna = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `grade-interna-${RUN_ID}`,
      title: GRADE_INTERNA_TITULO,
      workloadMinutes: 60,
    });

    await fixarAtividade({ tenantId: tenant.id, activityId: gradeLonga.id, ...GRADE_LONGA });
    await fixarAtividade({ tenantId: tenant.id, activityId: gradeInterna.id, ...GRADE_INTERNA });

    /** A inscrição pela rota direta (o caminho da tela tem spec própria) e o favorito pelo SERVIÇO. */
    await inscreverNaAtividade({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: gradeLonga.id,
      userId: idDaConta,
    });

    const favorito = await favoriteActivity({
      tenantId: tenant.id,
      userId: idDaConta,
      activityId: gradeInterna.id,
    });

    if (!favorito.ok) throw new Error(`Falha ao favoritar: ${favorito.message}`);

    const salaDoAgora = await createRoom({
      tenantId: tenant.id,
      eventId: event.id,
      name: SALA_DO_AGORA,
      capacity: 120,
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ATIVIDADE EM CURSO GANHOU SALA ONLINE (FASE 68 · fatia 5)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A linha de base da aba "Acontecendo agora" (`evento-aba-agora.png`) media um
     *  cartão SEM o link da sala online, porque o `NowCard` só o desenha para quem tem
     *  lugar NA ATIVIDADE (`seesActivityOnlineRoom`: a inscrição dela, ou a do evento
     *  quando a atividade é aberta, ou a equipe).
     *
     *  ─────────────────────────────────────────────────────────────────────────────
     *  QUEM ABRE A PORTA AQUI É A EQUIPE — E ISSO É ESCOLHA, NÃO DESCUIDO
     * ─────────────────────────────────────────────────────────────────────────────
     *  A dona da conta é `OWNER` da instituição, e o endereço do evento e o da
     *  atividade chegam até ela pela EQUIPE (`event:update`/`event:manage`). A prova de
     *  que o PARTICIPANTE também vê — e de que o anônimo e a lista de espera NÃO veem —
     *  vive no teste dela (`tests/e2e/f68-sala-online.spec.ts`, os blocos (a) a (e)), e
     *  a de que o cartão do agora desenha o link para quem tem inscrição, no portão de
     *  acessibilidade.
     *
     *  Inscrever esta conta aqui TAMBÉM funcionaria, e foi tentado: o efeito colateral é
     *  que ela passaria a ter TRÊS itens na "minha agenda" e a aparecer com duas
     *  inscrições no diretório de participantes — mudando o desenho de DUAS outras
     *  linhas de base (17, 18, 6 e 7) por um motivo que não é do assunto desta imagem.
     *  A régua de visibilidade não precisa de quatro fotos para valer: precisa de uma
     *  prova por estado, e ela existe no spec da fase.
     *
     *  O efeito na imagem foi MEDIDO antes de qualquer regeração: ver o comentário do
     *  teste 19, que traz a caixa dos pixels que mudaram.
     */
    const atividadeDoAgora = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `agora-${RUN_ID}`,
      title: ATIVIDADE_EM_CURSO_TITULO,
      roomId: salaDoAgora.id,
      startsAtOffsetDays: -20 / (24 * 60),
      workloadMinutes: 60,
      onlineUrl: ENDERECO_DO_AGORA,
    });

    atividadeDoAgoraId = atividadeDoAgora.id;

    /**
     * A PRÓXIMA da mesma sala: é ela que dá conteúdo ao "a seguir nesta sala" — a
     * peça que diz à pessoa onde ela deve estar no minuto seguinte, e a razão de a
     * visão ser por SALA. Não é enfeite: sem uma próxima, a linha não existe (o
     * componente não inventa) e a linha de base mediria menos do que a tela mostra.
     */
    await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `agora-proxima-${RUN_ID}`,
      title: 'Oficina de rubricas',
      roomId: salaDoAgora.id,
      startsAtOffsetDays: 40 / (24 * 60),
      workloadMinutes: 60,
    });

    /**
     * ═══════════════════════════════════════════════════════════════════════════════
     *  A FIXTURE DA PÁGINA DE INSCRIÇÃO (FASE 70 · a linha de base 23)
     * ═══════════════════════════════════════════════════════════════════════════════
     *
     *  ─────────────────────────────────────────────────────────────────────────────
     *  INSTITUIÇÃO PRÓPRIA, E O MOTIVO ESTÁ MEDIDO
     * ─────────────────────────────────────────────────────────────────────────────
     *  A vitrine da instituição da fixture desenha TODOS os eventos visíveis dela: um
     *  evento a mais em 2099 mudaria as DUAS linhas de base da vitrine. Uma segunda
     *  instituição custa uma fixture e deixa as 22 linhas de base existentes com ZERO
     *  pixel — e é o que a FASE 70 mediu e declarou antes de decidir (ver o bloco
     *  "A PÁGINA DE INSCRIÇÃO COM OS CAMPOS DECLARADOS", no alto do arquivo).
     *
     *  A conta da fixture entra VINCULADA a esta instituição como `PARTICIPANT`: sem
     *  vínculo e sem papel ela não veria o formulário, e a imagem mediria o cartão "Entre
     *  para se inscrever" — a tela errada.
     *
     *  ─────────────────────────────────────────────────────────────────────────────
     *  A CONTA É PRÓPRIA, E ISSO FOI MEDIDO (a primeira versão não era)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A primeira versão vinculou a MESMA dona da conta à segunda instituição — e as 16
     *  linhas de base das telas autenticadas REPROVARAM: com dois vínculos, o painel
     *  passa a exigir a ESCOLHA de contexto ("Você tem acesso a 2 instituições…") e
     *  `/t/<slug>/dashboard` deixa de renderizar a tela que a imagem mede. Uma conta
     *  que só existe nesta instituição não muda o contexto de ninguém.
     */
    const tenantDaInscricao = await createTenant({
      label: TENANT_INSCRICAO_LABEL,
      name: TENANT_INSCRICAO_NAME,
    });

    tenantInscricaoSlug = tenantDaInscricao.slug;

    const donaDaInscricao = await signUpVia(api, 'Dona da Página de Inscrição');

    emailDaInscricao = donaDaInscricao.email;

    await linkUser({
      tenantId: tenantDaInscricao.id,
      userId: donaDaInscricao.id,
      kind: 'PARTICIPANT',
    });
    await grantRole({
      tenantId: tenantDaInscricao.id,
      userId: donaDaInscricao.id,
      role: 'PARTICIPANT',
    });

    /**
     * A JANELA É UM INSTANTE FIXO (`JANELA_FUTURA`): o rótulo do período é o ÚNICO
     * pixel da página que depende do relógio — deslocá-lo em um dia mudou 1.662
     * pixels, medidos, na caixa `x 238..474 · y 317..330`.
     */
    const eventoDaInscricaoId = await criarEventoComJanela({
      tenantId: tenantDaInscricao.id,
      slug: `inscricao-${RUN_ID}`,
      title: EVENTO_DA_INSCRICAO_TITULO,
      ...JANELA_FUTURA,
    });

    /** A capacidade entra depois: o helper da janela fixa cria o evento sem lotação. */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantDaInscricao.id}, true)`;
      await tx.event.update({
        where: { id: eventoDaInscricaoId },
        data: { capacity: CAPACIDADE_DO_EVENTO },
      });
    });

    /**
     * As duas listas da página, cada uma com uma atividade: a ABERTA (que a inscrição
     * no evento inclui) e a de INSCRIÇÃO PRÓPRIA. Elas desenham a contagem de vagas ao
     * lado do título — o texto pequeno que a página mostra antes do formulário.
     */
    await createActivity({
      tenantId: tenantDaInscricao.id,
      eventId: eventoDaInscricaoId,
      slug: `aberta-${RUN_ID}`,
      title: ATIVIDADE_ABERTA_TITULO,
      capacity: 80,
      requiresRegistration: false,
      workloadMinutes: 60,
    });

    await createActivity({
      tenantId: tenantDaInscricao.id,
      eventId: eventoDaInscricaoId,
      slug: `propria-${RUN_ID}`,
      title: ATIVIDADE_PROPRIA_TITULO,
      capacity: 20,
      requiresRegistration: true,
      workloadMinutes: 120,
    });

    /**
     * O FORMULÁRIO ENTRA PELO SERVIÇO REAL DO ORGANIZADOR — o mesmo caminho da tela,
     * que grava a lista JÁ VALIDADA em `Event.settings`. Escrever o JSON à mão mediria
     * uma configuração que o produto não tem como produzir.
     */
    for (const campo of CAMPOS_DECLARADOS) {
      const salvo = await applyRegistrationFormOperationOnEvent({
        tenantId: tenantDaInscricao.id,
        actorId: idDaConta,
        eventId: eventoDaInscricaoId,
        operation: { kind: 'SAVE', originalKey: null, field: { ...campo } },
      });

      if (!salvo.ok) {
        throw new Error(`Falha ao declarar o campo ${campo.key}: ${salvo.message}`);
      }
    }
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

// ═══════════════════════════════════════════════════════════════════════════════
//  A PÁGINA PÚBLICA DA INSTITUIÇÃO (FASE 64) — a vitrine da casa, nos dois modos
//
//  SUPERFÍCIE NOVA, E A MAIS EXPOSTA DO PRODUTO: `/t/<slug>` deixou de ser um
//  redirect para o painel e virou a página que a instituição monta (capa, identidade,
//  os três grupos de eventos e os blocos). Quem chega por link compartilhado não tem
//  sessão, e é esta tela — e só ela — que a instituição tem para ser encontrada.
//
//  Nenhuma máscara, e o motivo está medido no cabeçalho do arquivo: o `RUN_ID` da
//  execução só vive no SLUG, e o slug não é desenhado em pixel nenhum; as datas dos
//  eventos da fixture são instantes FIXOS (`JANELA_FUTURA`/`JANELA_ANTIGA`), e por
//  isso a imagem não muda de um dia para o outro. O grupo "Acontecendo agora" aparece
//  VAZIO de propósito — ele exigiria uma janela contendo o AGORA, que é relativa por
//  definição.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A vitrine da instituição, SEM SESSÃO (como o rodapé público acima).
 *
 * A espera afirma os fatos que a imagem precisa ter para valer como linha de base: a
 * página é a PERSONALIZADA (e não o fallback da listagem de eventos, que aparece no
 * mesmo endereço quando não há página publicada), o título é o publicado, os dois
 * grupos com evento têm cartão e o modo pedido é o que está marcado no rodapé. Sem
 * isso, uma imagem do fallback — ou do tema errado — viraria "padrão" sem ninguém
 * perceber.
 */
async function abrirPaginaDaInstituicao(page: Page, tema: 'claro' | 'escuro'): Promise<void> {
  await page.context().addCookies([{ name: 'ef_tema', value: tema, url: BASE }]);

  await page.goto(`/t/${tenantSlug}`);

  await expect(page.getByTestId('tenant-public-page')).toBeVisible();
  await expect(page.getByTestId('tenant-events-fallback')).toHaveCount(0);
  await expect(page.getByTestId('tenant-page-title')).toHaveText(TENANT_NAME);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A VITRINE CONTINUA COM OS MESMOS CARTÕES — E O EVENTO DOS SEGMENTOS NÃO ENTRA
   * ─────────────────────────────────────────────────────────────────────────────
   *  O evento que hospeda a atividade da aba "Segmentos" nasce **RASCUNHO** (ver o
   *  `beforeAll`), e é por isso que a vitrine não muda: rascunho não aparece em grupo
   *  nenhum. As duas tentativas anteriores pagaram por esta linha, e cada uma ensinou
   *  uma coisa: com a janela "daqui a N dias" do helper, o evento caía em "Em breve" e
   *  a imagem piscava (1.886 pixels, com os dois títulos começando por "Mostra de"); com
   *  a janela fixa de 2000, ele caía em "Edições anteriores" e o grupo passava a ter
   *  dois cartões.
   *
   *  A régua desta linha de base é a mesma de sempre: **um cartão por grupo que tem
   *  conteúdo** — o de cima com o título do evento da vitrine e o de baixo com o da
   *  edição passada.
   */
  await expect(
    page.getByTestId('tenant-group-upcoming').getByTestId('tenant-event-card'),
  ).toContainText(EVENTO_FUTURO_TITULO);
  await expect(page.getByTestId('tenant-group-past').getByTestId('tenant-event-card')).toContainText(
    EVENTO_ANTIGO_TITULO,
  );

  /** A prova de que quem entregou o modo foi o SERVIDOR (o cookie é lido na requisição). */
  await expect(page.getByTestId(`theme-option-${tema}`)).toHaveAttribute('aria-pressed', 'true');

  await estabilizar(page);
}

test.describe('página pública da instituição', () => {
  test.use({ viewport: DESKTOP });

  /**
   * `fullPage` pelo mesmo motivo do rodapé público: a pergunta é sobre o DESENHO
   * inteiro, com cada seção no lugar dela. Um recorte do cabeçalho mostraria a
   * identidade bonita mesmo que os grupos tivessem estourado a largura de `main` ou
   * que o rodapé da aparência tivesse sido empurrado para fora da imagem.
   */
  const PAGINA_INTEIRA = { ...TOLERANCIA, fullPage: true } as const;

  test('15. a página da instituição no claro', async ({ page }) => {
    await abrirPaginaDaInstituicao(page, 'claro');

    await expect(page).toHaveScreenshot('pagina-da-instituicao-claro.png', PAGINA_INTEIRA);
  });

  test('16. a página da instituição no escuro', async ({ page }) => {
    await abrirPaginaDaInstituicao(page, 'escuro');

    /**
     * O escuro é a SEGUNDA escala da mesma tela, e é o encontro que só existe aqui: a
     * paleta da instituição (os `--ef-*` do escopo) sobre a escala escura da
     * plataforma. Uma cor que ficasse no token claro, ou um papel que o escopo não
     * publicasse, só aparece em pixel.
     */
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');
    await expect(page.locator('[data-tenant-theme-scope="page"]')).toHaveAttribute(
      'data-theme-mode',
      'dark',
    );

    await expect(page).toHaveScreenshot('pagina-da-instituicao-escuro.png', PAGINA_INTEIRA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  "MINHA AGENDA" (FASE 65) — a grade do dia, nos DOIS modos do painel
//
//  Superfície NOVA e DENSA: os quatro contadores, as duas marcas (inscrita ×
//  favorita), o bloco de choque, os dois caminhos de exportação e três ações por item.
//  Nenhuma máscara — e o motivo está no cabeçalho do arquivo: as duas atividades da
//  fixture têm instantes FIXOS, então o horário impresso não muda de um dia para o
//  outro. Foi a lição da FASE 64 aplicada antes de a imagem nascer, e não depois de
//  ela piscar.
//
//  Os dois modos entram porque esta tela é do PAINEL (segue o cookie `ef_tema`), e a
//  escala escura é onde uma cor que ficou no token claro, ou uma etiqueta que perdeu o
//  contraste, só aparece em pixel.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Abre a minha agenda do evento da fixture e AFIRMA o conteúdo antes de fotografar.
 *
 * A espera não é cerimônia: uma agenda vazia desenha uma frase e NENHUM dos
 * componentes que a fase criou — e a linha de base passaria a registrar essa tela
 * pobre como se fosse a certa. Os quatro números provam que a união e os choques
 * chegaram à tela; as duas marcas provam que o dado não virou só contador.
 */
async function abrirMinhaAgenda(page: Page): Promise<void> {
  await page.goto(`/t/${tenantSlug}/minha-agenda?evento=${eventoId}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Minha agenda' })).toBeVisible();
  await expect(page.getByTestId('minha-agenda')).toBeVisible();

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  ESTA LINHA DE BASE NÃO FOI REGERADA NA FASE 67 — E ISSO É O RESULTADO
   * ─────────────────────────────────────────────────────────────────────────────
   *  A primeira versão da fixture da FASE 67 pendurou a atividade da aba "Segmentos"
   *  NESTE evento, e a agenda passou a medi-la: 3 itens, 2 inscritas e 3 choques. O
   *  conserto foi de FIXTURE — a oficina foi para um **evento só dela** (ver
   *  `eventoSegmentos`) —, e é por isso que os números abaixo continuam sendo os da
   *  FASE 65: a linha de base desta tela mede o MESMO desenho de antes.
   */
  await expect(page.getByTestId('resumo-itens')).toHaveText('2');
  await expect(page.getByTestId('resumo-inscritas')).toHaveText('1');
  await expect(page.getByTestId('resumo-favoritas')).toHaveText('1');
  await expect(page.getByTestId('resumo-choques')).toHaveText('1');

  /**
   * As duas marcas na grade. O seletor pede `li[data-mark]` de propósito: o
   * `data-mark` também existe no interior do cartão (o distintivo da marca), e
   * perguntar pelo atributo solto contaria o cartão E o distintivo — o teste passaria
   * a medir quantos elementos têm a marca, e não quantos itens da grade são de cada
   * tipo.
   *
   * Com a oficina da FASE 67 em OUTRO evento, os inscritos continuam sendo **um** (o
   * minicurso) e o favorito, **um** — os números da FASE 65, intactos.
   */
  await expect(page.locator('li[data-mark="INSCRITO"]')).toHaveCount(1);
  await expect(page.locator('li[data-mark="FAVORITO"]')).toHaveCount(1);

  /** E o choque, em par: o aviso que informa e não bloqueia nada. */
  await expect(page.getByTestId('minha-agenda-choques-secao')).toBeVisible();
  await expect(page.getByTestId('minha-agenda-choques').locator('li')).toHaveCount(1);

  /** Os dois caminhos de exportação da grade — o arquivo e o botão do Google. */
  await expect(page.getByTestId('minha-agenda-exportacao')).toBeVisible();

  await estabilizar(page);
}

test.describe('minha agenda', () => {
  test.use({ viewport: DESKTOP });

  test('17. a minha agenda no claro', async ({ page }) => {
    await preparar(page, { tema: 'claro' });
    await abrirMinhaAgenda(page);

    /**
     * A página inteira, e não um recorte da lista: o rodapé e o cabeçalho da grade
     * (contadores + exportação) fazem parte do desenho, e um recorte mediria o cartão
     * bonito mesmo que ele tivesse estourado a largura de `main`.
     */
    await expect(page).toHaveScreenshot('minha-agenda-claro.png', {
      ...TOLERANCIA,
      fullPage: true,
      mask: [mascaraDoEndereco(barraLateral(page))],
    });
  });

  test('18. a minha agenda no escuro', async ({ page }) => {
    await preparar(page, { tema: 'escuro' });
    await abrirMinhaAgenda(page);

    /** A prova de que o escuro veio do SERVIDOR (o cookie é lido na requisição). */
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    await expect(page).toHaveScreenshot('minha-agenda-escuro.png', {
      ...TOLERANCIA,
      fullPage: true,
      mask: [mascaraDoEndereco(barraLateral(page))],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A ABA "ACONTECENDO AGORA" (FASE 65) — a única linha de base relativa ao relógio
//
//  Ela entra COM QUATRO MÁSCARAS, e o motivo de cada uma está no cabeçalho do arquivo:
//  o preenchimento da barra, o texto do tempo restante e os dois horários (o do cartão
//  e o do "a seguir") mudam a cada minuto. Mascarar não é esconder o que importa: o que
//  a fase AFIRMA sobre o tempo é provado por TEXTO e por ATRIBUTO — no E2E funcional
//  (`f65-exportacao.spec.ts`, bloco (e): o `aria-valuenow` entre 25 e 45, o
//  `aria-valuetext` igual ao texto visível, "termina em N min") e no portão de
//  acessibilidade (o `aria-label` da barra). A imagem mede o DESENHO em volta.
//
//  A sessão entra porque a aba desenha DOIS caminhos que só existem para quem tem o
//  que fazer ali: "Abrir o meu crachá" (sessão) e "Abrir o balcão de credenciamento"
//  (permissão). Sem sessão, os dois links somem — e a linha de base registraria uma
//  tela que só o visitante anônimo vê.
// ═══════════════════════════════════════════════════════════════════════════════

async function abrirAbaDoAgora(page: Page): Promise<void> {
  await page.goto(`/t/${tenantSlug}/eventos/${eventoSlug}?aba=agora`);

  /** A aba navegada é a ATIVA (link com `aria-current`, sem estado de cliente). */
  await expect(page.getByTestId('aba-agora')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('aba-programacao')).not.toHaveAttribute('aria-current', 'page');

  const secao = page.getByTestId('agora');

  await expect(secao).toBeVisible();
  await expect(page.getByTestId(`agora-sala-${SALA_DO_AGORA}`)).toBeVisible();
  await expect(secao).toContainText(ATIVIDADE_EM_CURSO_TITULO);

  /**
   * A barra e o tempo restante: a imagem os MASCARA, e é justamente por isso que eles
   * são afirmados aqui — sem esta linha, um defeito que apagasse os dois deixaria a
   * foto verde (a máscara taparia a ausência, e não a mudança).
   */
  await expect(page.getByTestId('agora-barra')).toHaveAttribute('role', 'progressbar');
  await expect(page.getByTestId('agora-restante')).toHaveText(/termina em /);

  /** E os dois caminhos do dia do evento — cada um exatamente uma vez. */
  await expect(page.locator('[data-testid^="agora-cracha-"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="agora-balcao-"]')).toHaveCount(1);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O LINK NOVO DA FASE 68 TAMBÉM É AFIRMADO AQUI — EXATAMENTE UM (fatia 5)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A linha de base desta tela passou a MEDIR o link da sala online na FASE 68, e a
   *  máscara da imagem não o tapa: uma tela que perdesse o link (ou que o desenhasse
   *  duas vezes) deixaria a foto verde se ninguém o afirmasse.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  OS DOIS PREFIXOS QUE COMEÇAM IGUAL, E POR QUE A CONTAGEM É EXPLÍCITA
   * ─────────────────────────────────────────────────────────────────────────────
   *  A aba usa dois nomes parecidos: `agora-sala-<sala>` é o GRUPO da sala e
   *  `agora-sala-online-<atividade>` é o LINK do cartão. Os dois são afirmados
   *  separadamente, um por prefixo — um prefixo novo que casasse com os dois quebraria
   *  estas linhas, que é o aviso do §4 do plano da fase ("nome novo com prefixo
   *  parecido quebra a contagem"). O `href` fecha a prova: o endereço do cartão é o DA
   *  ATIVIDADE, e um vazamento do endereço do evento apareceria aqui.
   */
  await expect(page.locator('[data-testid^="agora-sala-online-"]')).toHaveCount(1);
  await expect(page.getByTestId(`agora-sala-online-${atividadeDoAgoraId}`)).toHaveAttribute(
    'href',
    ENDERECO_DO_AGORA,
  );

  /** O que vem depois NA MESMA SALA — sem isso a linha não existe e a máscara sobra. */
  await expect(page.getByTestId(`agora-proxima-${SALA_DO_AGORA}`)).toBeVisible();

  await estabilizar(page);
}

test.describe('aba "acontecendo agora"', () => {
  test.use({ viewport: DESKTOP });

  test('19. a aba "Acontecendo agora" do evento', async ({ page }) => {
    await preparar(page, { tema: 'claro' });
    await abrirAbaDoAgora(page);

    await expect(page).toHaveScreenshot('evento-aba-agora.png', {
      ...TOLERANCIA,
      fullPage: true,
      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  AS QUATRO MÁSCARAS SÃO CONTÊINERES ESTÁVEIS, E ISSO FOI APRENDIDO AQUI
       * ─────────────────────────────────────────────────────────────────────────────
       *  A primeira versão mascarava o `<dd>` do horário e o PREENCHIMENTO da barra —
       *  os dois nós cujo CONTEÚDO muda. Medi a diferença entre duas execuções e ela
       *  estava exatamente ali: 137 px de largura mudaram, e a causa não era o texto
       *  mascarado aparecendo, era a CAIXA da máscara mudando de largura e EMPURRANDO
       *  o nome da sala ao lado. Máscara de nó que muda de tamanho é máscara que se
       *  mexe: ela esconde o dado e denuncia a si mesma.
       *
       *  Por isso as quatro máscaras de agora são contêineres de largura FIXA (o
       *  trilho inteiro da barra, a linha de informação do cartão, o parágrafo do tempo
       *  e a linha do "a seguir"): o dado sai tapado e a CAIXA continua medindo o
       *  desenho — uma barra que engordasse, uma linha que quebrasse ou um cartão que
       *  encolhesse mudam a caixa magenta e reprovam.
       */
      mask: [
        /** 1. A barra INTEIRA (o trilho): o preenchimento muda de largura a cada minuto. */
        page.getByTestId('agora-barra'),
        /**
         * 2. A linha de informação do cartão: o horário é relativo a agora. A SALA
         * entra na máscara junto (ela divide a mesma linha), e o nome dela continua
         * medido no cabeçalho do grupo logo acima, que não é mascarado.
         */
        page.locator('[data-testid^="agora-item-"] dl'),
        /** 3. O tempo restante em texto: muda a cada minuto. */
        page.getByTestId('agora-restante'),
        /** 4. O "a seguir nesta sala": ele imprime a hora de início da próxima. */
        page.locator('[data-testid^="agora-proxima-"]'),
      ],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A ABA "SEGMENTOS" E A PÁGINA DE DESCADASTRO (FASE 67) — duas linhas de base
//
//  ─────────────────────────────────────────────────────────────────────────────
//  O QUE ELAS MEDEM, E POR QUE CADA UMA ENTRA
//  ─────────────────────────────────────────────────────────────────────────────
//    • **a aba "Segmentos"** — o formulário `GET` com os campos que o catálogo
//      declara (os `fieldset` por condição, o `grid` de duas colunas por parâmetro),
//      o cartão do resultado com a contagem, as frases e a prévia, o bloco da
//      mensagem e o HISTÓRICO de campanhas com as frases congeladas. É a tela mais
//      DENSA da fase, e densidade é onde o layout quebra primeiro (o mesmo argumento
//      que trouxe o diretório de participantes para esta suíte);
//    • **a página de descadastro** — a única tela da fase que a PESSOA abre de um
//      e-mail, sem sessão. Ela desenha dois cartões de promessa, o bloco de situação
//      e os dois formulários de ação; nem a página nem a aba tinham imagem.
//
//  ─────────────────────────────────────────────────────────────────────────────
//  AS MÁSCARAS, E A MEDIÇÃO QUE DECIDIU CADA UMA
//  ─────────────────────────────────────────────────────────────────────────────
//  A regra do arquivo é separar DADO de DESENHO, e as duas telas têm dado que muda:
//
//    • o NOME de quem recebe (o titular da conta, cujo nome carrega o `RUN_ID`) —
//      mascarado onde ele aparece desenhado (o cartão da prévia da lista);
//    • a DATA de cada campanha no histórico — e é ela que quase excluiu esta tela,
//      pela régua que o arquivo já usa ("data que muda todo dia não é regressão
//      visual"). O que a salvou foi a máscara ser de CAIXA ESTÁVEL: a célula da data
//      tem a mesma largura em toda execução, então tapá-la esconde o dia e continua
//      medindo o desenho da linha (a lição das quatro máscaras da aba do "agora":
//      máscara de nó que muda de tamanho empurra o vizinho e denuncia a si mesma);
//    • o ENDEREÇO de descadastro do formulário é `hidden` — não desenha pixel nenhum,
//      então não há o que mascarar (e o token não aparece no HTML renderizado).
//
//  A MEDIÇÃO ESTÁ NO DOCUMENTO DA FASE (`docs/fase-67-mala-direta-por-fatos.md`): as
//  duas linhas de base foram geradas e conferidas com `maxDiffPixelRatio: 0` — duas
//  execuções seguidas deram ZERO pixel de diferença. Sem isso elas não entrariam: o
//  que este arquivo não aceita é linha de base que pisca.
// ═══════════════════════════════════════════════════════════════════════════════

/** O endereço de descadastro da dona da conta — o mesmo caminho que o e-mail leva. */
async function abrirDescadastro(page: Page): Promise<void> {
  await page.goto(`/t/${tenantSlug}/descadastro/${TOKEN_DE_DESCADASTRO}`);

  await expect(page.getByTestId('unsubscribe-state')).toBeVisible();
  await expect(page.getByTestId('unsubscribe-state-value')).toHaveAttribute('data-out', 'false');
  await expect(page.getByTestId('unsubscribe-keeps-list')).toContainText('Certificado');

  await estabilizar(page);
}

/** A aba "Segmentos" com um segmento MONTADO e COM RESULTADO (a definição vai na URL). */
async function abrirSegmentos(page: Page): Promise<void> {
  const query = new URLSearchParams({
    aba: 'segmentos',
    segmento: '1',
    evento: eventoDosSegmentosId,
    c0: 'inscrito-na-atividade',
    p0_atividade: atividadeDosSegmentosId,
  });

  await page.goto(`/t/${tenantSlug}/administracao/comunicacao?${query.toString()}`);

  await expect(page.getByTestId('communication-tab-segmentos')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByTestId('segment-count')).toHaveText('1');
  await expect(page.getByTestId('segment-explanation')).toContainText('Quem está inscrito');
  await expect(page.getByTestId('segment-people')).toBeVisible();

  await estabilizar(page);
}

test.describe('comunicação segmentada e descadastro', () => {
  test.use({ viewport: DESKTOP });

  test('20. a aba "Segmentos" com um segmento montado', async ({ page }) => {
    await preparar(page, { tema: 'claro' });
    await abrirSegmentos(page);

    await expect(page).toHaveScreenshot('comunicacao-segmentos.png', {
      ...TOLERANCIA,
      fullPage: true,
      mask: [
        /** 1. O e-mail de quem está logado, na barra lateral (carrega o `RUN_ID`). */
        mascaraDoEndereco(barraLateral(page)),
        /** 2. O bloco do nome na PRÉVIA da lista. */
        page.getByTestId('segment-people'),
        /**
         * 3. A LINHA INTEIRA do carimbo da campanha no histórico (`campaign-meta`).
         *
         * ─────────────────────────────────────────────────────────────────────────────
         *  POR QUE A MÁSCARA CRESCEU ATÉ A LINHA — E ISSO FOI MEDIDO (FASE 67)
         * ─────────────────────────────────────────────────────────────────────────────
         *  A primeira versão mascarava só o `<span>` da data, e ela **piscava**: o texto
         *  do carimbo tem largura variável (`10/03/2126, 14:05` e `…
         *  09:05` não medem o mesmo), a CAIXA da máscara acompanhava, e a linha de base
         *  acusava 1.143 a 2.041 pixels de diferença entre execuções — sempre dentro do
         *  carimbo. É a lição das quatro máscaras da aba do "agora" cobrada de novo:
         *  **máscara de nó que muda de tamanho é máscara que se mexe**.
         *
         *  A linha inteira é uma caixa ESTÁVEL (quem manda na altura e na largura é o
         *  `text-xs` do parágrafo, não o conteúdo), então o desenho da linha continua
         *  medido e o dado sai tapado. O que ela esconde junto é o AUTOR — nome de
         *  fixture, fixo, e que aparece na imagem apenas como caixa magenta.
         */
        page.getByTestId('campaign-meta'),
        /**
         * 4. A FRASE CONGELADA da campanha (`campaign-explanation`) — a única linha da
         *    imagem que ainda piscava depois da máscara 3 (medido: **31 pixels**, uma
         *    faixa de ~1 px de altura no meio do texto). O que sobra de variável ali é a
         *    quebra de linha do próprio texto do organizador, e o que a imagem mede de
         *    valor na linha da campanha é o DESENHO dela — a etiqueta de situação, os
         *    números e o botão de reenvio, que continuam fora da máscara.
         */
        page.getByTestId('campaign-explanation'),
        /**
         * 5. A LINHA DOS NÚMEROS da campanha (`campaign-counts`) — e a decisão aqui é
         *    declarada, porque ela custa medição.
         *
         * ─────────────────────────────────────────────────────────────────────────────
         *  POR QUE ESTA MÁSCARA CRESCEU ATÉ A LINHA INTEIRA (FASE 67 · medido)
         * ─────────────────────────────────────────────────────────────────────────────
         *  A primeira versão mascarava só o `<li>` do instante da última passada, e a
         *  linha de base continuou acusando **44 pixels** — sempre depois do fim do
         *  `<li>` mascarado. Em vez de mascarar mais um nó e continuar caçando pixel, a
         *  leitura é feita: o que esta linha imprime é **número de fixture mais carimbo
         *  de relógio**, e o carimbo muda a cada execução. Os NÚMEROS dessa linha são
         *  provados por asserção (o E2E da fase prende "Selecionados: N" e "No outbox: N"
         *  no histórico, e o portão de acessibilidade varre a mesma linha), então o que
         *  a imagem perde aqui é um número — e o que ela MANTÉM é a linha, a altura e o
         *  desenho da campanha.
         *
         *  É a mesma separação de sempre (dado × desenho), aplicada com o número à mão.
         */
        page.getByTestId('campaign-counts'),
      ],
    });
  });

  test('21. a página de descadastro', async ({ page }) => {
    await preparar(page, { tema: 'claro' });
    await abrirDescadastro(page);

    await expect(page).toHaveScreenshot('descadastro.png', {
      ...TOLERANCIA,
      fullPage: true,
      mask: [mascaraDoEndereco(barraLateral(page))],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  O BLOCO DE LOCAL DA PÁGINA DO EVENTO (FASE 69 · os quatro pontos da F68)
//
//  ─────────────────────────────────────────────────────────────────────────────
//  A LINHA DE BASE QUE NÃO EXISTIA — E POR QUE O BURACO ERA ESTRUTURAL
//  ─────────────────────────────────────────────────────────────────────────────
//  O `VenueBlock` é o bloco de LOCAL da página pública do evento: o endereço físico e
//  o endereço da SALA ONLINE, que a FASE 68 fez aparecer só para quem tem lugar. Ele
//  não tinha imagem, e a causa não era esquecimento: a única superfície do evento que
//  esta suíte fotografava era a aba "Acontecendo agora" (`?aba=agora`), e **essa aba
//  não renderiza blocos** — o bloco não existia em pixel nenhum. O vazamento que a
//  FASE 68 fechou (`Event.onlineUrl` desenhado para qualquer visitante) atravessou
//  todas as catracas de pixel porque não havia pixel dele para atravessar.
//
//  ─────────────────────────────────────────────────────────────────────────────
//  O QUE A IMAGEM MEDE, E O QUE ELA NÃO PODE MEDIR
//  ─────────────────────────────────────────────────────────────────────────────
//  Mede o DESENHO do bloco: o cartão, o ícone, a linha do endereço físico, o link com
//  o `ExternalLink` e o espaçamento entre eles. Não mede o `href` — quem o prende é a
//  asserção abaixo (e o E2E da FASE 68, que prova quem vê e quem não vê). É a divisão
//  de sempre: pixel mede desenho, asserção mede fato.
//
//  A imagem é da PÁGINA INTEIRA (`fullPage`) com o bloco no lugar dele, e não um
//  recorte do cartão: foi um recorte que escondeu o contexto no defeito que abriu esta
//  suíte, e um bloco que estoure a largura de `main` só aparece na página inteira.
//
//  ─────────────────────────────────────────────────────────────────────────────
//  QUEM OLHA, E POR QUE ISSO IMPORTA PARA A IMAGEM
//  ─────────────────────────────────────────────────────────────────────────────
//  A dona da conta é `OWNER` da instituição, e é por isso que o endereço da sala
//  ONLINE aparece no bloco: ele é resolvido no servidor pela régua da FASE 68
//  (`seesEventOnlineRoom`: equipe do evento ou inscrição que dá lugar). Sem sessão, o
//  mesmo bloco desenharia só o endereço físico — e a linha de base registraria uma
//  tela que não é a que o organizador vê.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A página do evento ANTIGO, com o bloco de LOCAL publicado.
 *
 * O slug é derivado do `RUN_ID` no `beforeAll` (`antigo-<RUN_ID>`) e é escrito aqui do
 * mesmo jeito — a constante do slug não existe porque nenhuma outra asserção do
 * arquivo precisa dela.
 */
async function abrirBlocoDeLocal(page: Page): Promise<void> {
  await page.goto(`/t/${tenantSlug}/eventos/antigo-${RUN_ID}`);

  /** O bloco está renderizado — sem isto a foto mediria a ausência dele. */
  await expect(page.getByRole('heading', { name: 'Local' })).toBeVisible();

  const secao = page.locator('section#local');

  await expect(secao).toContainText(ENDERECO_FISICO_DO_EVENTO);

  /**
   * O link da sala online, com o `href` conferido: é a peça que a FASE 68 pôs aqui e
   * que a imagem passa a medir. Um link com o endereço de OUTRA sala passaria por
   * "existe" — por isso o atributo entra.
   */
  const link = page.getByTestId('evento-sala-online');

  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', ENDERECO_DO_LOCAL);

  await estabilizar(page);
}

test.describe('bloco de local da página do evento', () => {
  test.use({ viewport: DESKTOP });

  test('22. o bloco de local com a sala online', async ({ page }) => {
    await preparar(page, { tema: 'claro' });
    await abrirBlocoDeLocal(page);

    await expect(page).toHaveScreenshot('evento-bloco-de-local.png', {
      ...TOLERANCIA,
      fullPage: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A PÁGINA DE INSCRIÇÃO COM OS CAMPOS DECLARADOS (FASE 70) — a linha de base 23
//
//  Os números da medição que autorizou esta linha de base (0 pixel entre duas
//  execuções; 1.662 pixels, na caixa `x 238..474 · y 317..330`, ao deslocar a janela
//  em um dia) estão no bloco do alto do arquivo, junto das constantes da fixture.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Abre a página de inscrição e AFIRMA o que a fase criou antes de fotografar.
 *
 * Sem estas asserções, uma página que perdesse o bloco inteiro — ou que desenhasse só
 * o primeiro campo — passaria IGUAL: o `toHaveScreenshot` compara com a linha de base,
 * e não com a intenção. É a régua que a FASE 65 declarou ("o que a imagem não prova, a
 * asserção prova"), aplicada a uma tela em que os seis controles são o sujeito.
 */
async function abrirInscricaoComCampos(page: Page): Promise<void> {
  await page.goto(`/t/${tenantInscricaoSlug}/eventos/inscricao-${RUN_ID}/inscricao`);

  await expect(page.getByTestId('event-registration-form')).toBeVisible();
  await expect(page.getByTestId('event-declared-fields')).toBeVisible();

  for (const campo of CAMPOS_DECLARADOS) {
    await expect(page.getByTestId(`event-declared-field-${campo.key}`)).toBeVisible();
  }

  /** A contagem de vagas do evento: o texto pequeno que a fase pôs em `.ef-muted`. */
  await expect(page.getByTestId('event-registration-summary')).toContainText(
    `${CAPACIDADE_DO_EVENTO} restantes`,
  );

  await estabilizar(page);
}

test.describe('página de inscrição do evento com os campos declarados', () => {
  test.use({ viewport: DESKTOP });

  test('23. a página de inscrição com os campos declarados', async ({ page }) => {
    /**
     * A CONTA é a da instituição da fixture, e não a dona da conta da vitrine: com dois
     * vínculos o painel pede a escolha de contexto antes de servir a tela.
     */
    await signInAs(page, emailDaInscricao);
    await page.context().addCookies([{ name: 'ef_tema', value: 'claro', url: BASE }]);

    await abrirInscricaoComCampos(page);

    await expect(page).toHaveScreenshot('evento-inscricao.png', {
      ...TOLERANCIA,
      fullPage: true,
    });
  });
});
