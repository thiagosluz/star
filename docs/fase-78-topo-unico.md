# FASE 78 — O topo único

> **Estado: ENTREGUE.** Cinco fatias: o componente, o painel e o participante, a
> plataforma/auth/estado, o público, e o fechamento (documento, estado, par de E2E e
> bateria). **ADR-372, 373 e 374** (a próxima é a 375). A dívida **H1** está fechada.

---

## 1. Sumário Executivo

**A regra já existia — e o mutirão tinha parado.** `docs/design-system.md` §5 diz
"Toda tela começa por `PageHeader`" desde a FASE 11, e a dívida **H1** ("cabeçalhos
ainda escritos à mão") está aberta desde a **F11B**, com a decisão escrita de fazer
"migração incremental, tela a tela, sem fase dedicada". Medido no começo desta fase:
**96 `page.tsx`**, **12 formatos de topo** diferentes e **9 páginas (9,4%)** usando o
componente. Não era deriva de um padrão novo: era um **mutirão interrompido**.

O trabalho não foi inventar um desenho. Foi **cumprir a regra** com um componente que
fosse o **superconjunto** dos doze formatos, provar que ele é **Server Component**
(para não transformar 96 páginas em ilhas de cliente), migrar as telas **sem perder
o contrato de teste que cada uma já tinha** — 12 `data-testid` de título e 5 de
descrição lidos pelo E2E — e deixar uma **catraca** que impede o formato à mão de
voltar. As três famílias que continuam fora têm motivo escrito e não são dívida: o
**tema do evento** (ADR-324/325), os **heróis de marketing** (declarados fora do
escopo no plano) e o **renderizador próprio** da página da casa (FASE 64), mais os
dois redirects.

### O que foi entregue

| Fatia | Entrega | Números medidos |
|---|---|---|
| **1** | `PageHeader` + `Breadcrumbs` separados de `navigation.tsx` (que continua `'use client'`), em `ui/page-header.tsx` **server**; os slots (`title`/`titleTestId`/`eyebrow`/`icon`/`breadcrumbs`/`description`/`descriptionTestId`/`badge`/`actions`), a **volta derivada** e o `headingLevel` da vitrine; amostra em `/superadmin/design` | **1 arquivo novo** (222 linhas) · **25 casos** de unidade · `navigation.tsx` **−107/+?** (o topo saiu de lá) |
| **2** | **Painel e participante** — as telas de `(app)` + as **11 linhas de base** do `f62` re-baseadas no mesmo commit, com motivo por linha e imagens olhadas | **52 telas** (`(app)` menos a prévia do tema) · **11 snapshots** · **duas execuções a 0 px** |
| **3** | **Plataforma, auth e estado** — inclui o `text-headline` inexistente (4 telas em 16px) e o `<h1>` nas **6 telas** que só tinham `<h2>`/`SectionHeading`; `TENANT_NAV_GROUPS`/`PLATFORM_NAV_GROUP`/`PLATFORM_CRUMB` como fonte única | **9 de plataforma + 12 de auth/estado = 21 telas** · **12 casos** de unidade · **4 títulos 16 → 28 px** · **6 `<h1>` novos** |
| **4** | **Público** — as **8 telas públicas migradas** (uma delas pelo `TOPO_COMPARTILHADO`) + as linhas de base restantes; o nome da instituição sai do `eyebrow`/badge | **8 telas** · **1 `TOPO_COMPARTILHADO`** · **16 casos** de unidade · **1 snapshot** (`descadastro`) |
| **5** | O documento, o estado (H1 fechada), a **E90** declarada, o par de E2E (**12 telas**), o `f62` corrigido (raiz dinâmica desde a F71) e a bateria completa | **12 casos E2E** (8,9 s) · **f62 23/23** · **2 linhas da raiz mascaradas e re-baseadas** |

### Números da fase (medidos nesta árvore)

```text
Páginas medidas .................. 96 `page.tsx`
Páginas migradas ................. 81 (9,4% → 84,4%) = 52 do painel/participação
                                     + 9 de plataforma + 12 de auth/estado + 8 públicas
Exceções com motivo .............. 15 (7 tema do evento · 3 heróis · 1 página da casa · 2 redirects
                                     · 1 prévia do tema · 1 ficha pública do palestrante)
Topo compartilhado ............... 1 módulo, 2 pontos de montagem
Formatos de topo ................. 12 → 1 (+ as exceções declaradas)
Casos novos (Vitest) ............. 71 em 4 arquivos (25 + 18 + 12 + 16)
Casos novos (E2E) ................ 12 em 1 arquivo (f78-topo-unico.spec.ts)
Linhas de base re-baseadas ....... 14 (11 da fatia 2 + descadastro da fatia 4 + as 2 da raiz na fatia 5)
Snapshots da catraca visual ...... 23
Migrações ........................ 0
Arquivos intocados ............... src/app/globals.css e playwright.config.ts
Dívida ........................... H1 FECHADA · E90 declarada · total 42 (H=0)
ADRs ............................. 372, 373 e 374
```

### 1.1 Arquivos da fase

```text
src/components/ui/page-header.tsx ............... 222 linhas (novo) — PageHeader + Breadcrumbs + a volta
src/components/ui/navigation.tsx ................ o topo SAIU daqui; o menu continua cliente
src/components/ui/index.ts ...................... reexporta o topo do módulo server
src/components/shell/tenant-nav.tsx ............. +63 linhas — TENANT_NAV_GROUPS, PLATFORM_NAV_GROUP e PLATFORM_CRUMB
src/components/tenancy/public-event-list.tsx .... +30 — o topo da lista pública (TOPO_COMPARTILHADO)
src/components/ui/data.tsx ...................... +30 — o ajuste de `MetaList` que o portão WCAG AA exigiu
src/app/**/page.tsx ............................. 80 arquivos alterados (+1.823/−1.439) — a migração
tests/unit/f78-page-header.test.ts .............. 25 casos — slots, trilha, a11y e a catraca server/client
tests/unit/f78-topo-unico.test.ts ............... 18 casos — a catraca de fonte (96/81/15) e o topo compartilhado
tests/unit/f78-fatia3-plataforma-auth-estado.test.ts  12 casos — a fonte única dos grupos na fatia 3
tests/unit/f78-fatia4-publicas.test.ts .......... 16 casos — as públicas e o que não é grupo
tests/e2e/f78-topo-unico.spec.ts ................ 12 casos — o HTML entregue em 12 telas
tests/e2e/f62-regressao-visual.spec.ts .......... a raiz dinâmica, o mask e a re-base declarada
```

---

## 2. O Problema Mais Difícil da Fase

**Um componente que 81 telas vão copiar precisa ser provado ANTES de ser copiado — e
a prova de fonte não prova o render.**

O caminho "natural" era abrir o `PageHeader` que já existia e sair migrando. Ele
estava em `navigation.tsx`, que é `'use client'` porque `NavLink`/`TabNav` leem
`usePathname`. Se a migração viesse primeiro, cada uma das 96 páginas importaria um
módulo de cliente e o produto ganharia **~96 ilhas de cliente** para desenhar um
`<header>` sem estado. O custo apareceria no bundle, não no `tsc` — e ninguém
relacionaria a lentidão à fase.

Por isso a fatia 1 **separou** antes de migrar: o topo não tem estado, efeito nem
leitura de rota; ele desenha a hierarquia que a página já decidiu. O `navigation.tsx`
ficou com o que precisa de cliente (o menu) e o `page-header.tsx` nasceu server. A
catraca de unidade prende as duas metades: o arquivo do topo não pode ganhar
`'use client'` nem hook, e o da navegação não pode perder a diretiva.

A segunda metade do problema é que **fonte não é render**. A catraca de fonte lê os
`page.tsx` e prova que ninguém escreve `<h1>`/`<header>` à mão; ela **não** prova que
o componente foi montado, que o `title` é o da tela ou que o `eyebrow` ficou fora do
`<h1>`. Um componente com o título errado, ou renderizado só num ramo que a pessoa
nunca vê, passa na fonte. Foi por isso que a fase entregou o **par**: a catraca de
fonte (barata, cobre as 96 telas) **e** o E2E de 12 telas (caro, cobre o HTML
entregue). Nenhum dos dois substitui o outro — o limite está escrito no cabeçalho de
cada um.

**As alternativas descartadas**, e por quê:

- **Manter o `PageHeader` em `navigation.tsx` e aceitar as ilhas**: o bundle
  cresceria em ~96 pontos e o custo não apareceria em nenhuma catraca. Descartada
  antes da primeira migração.
- **Uma prop `back` separada da trilha**: a trilha já declara o pai com `href`. Duas
  fontes do mesmo destino divergem — foi assim que 15 dos 33 links "←" ficaram sem
  nomear para onde voltavam. Descartada em favor da derivação do penúltimo item.
- **`eyebrow` = nome da instituição**: era o que 17 páginas faziam (e o badge em 3).
  A casca já mostra o nome; repeti-lo gasta a única linha que pode dizer **onde** a
  pessoa está. Descartada (ADR-373).
- **Deixar as 2 linhas da raiz vermelhas "para não esconder regressão"**: um vermelho
  que todo mundo conhece ensina a ignorar a suíte. Descartada em favor do **mask** do
  bloco dinâmico + uma re-base declarada (ADR-374 e §3.6).

---

## 3. Decisões Técnicas Explicadas

### 3.1 O `eyebrow` é o grupo de navegação, não o nome da instituição

O diagnóstico mediu o sintoma: o nome da instituição aparecia em **25 páginas, em 3
lugares diferentes** — badge ao lado do título (3), eyebrow (17) e dentro do texto
(5). O nome já está na casca, no topo da barra lateral, em todas as telas. Usá-lo no
eyebrow é dizer de novo **quem** é a casa quando a linha poderia dizer **onde** a
pessoa está.

A decisão: o `eyebrow` é o **grupo de navegação** — "Geral", "Minha participação",
"Comitê científico", "Operação", "Plataforma" — e a fonte é o **mesmo** módulo do
menu (`tenant-nav.tsx`), não uma string escrita na página. As 3 telas que tinham o
nome no badge (administração, equipe e comunicação) perderam o badge; quem quiser
saber a instituição olha a casca, que já a mostra. O ganho não é cosmético: o menu e
o topo passam a concordar por construção, e a string duplicada de
`meu-perfil-publico:104` deixou de existir.

A consequência aceita: **a tela de autenticação e a lista pública não têm grupo** — e
não devem ter. O login não pertence a um menu, e a lista pública não é uma tela de
gestão. O `eyebrow` é opcional justamente porque a ausência dele é informação.

### 3.2 A volta é derivada da trilha — nunca uma prop paralela

Dos **33 links "←"** do produto, **15 não nomeavam o destino**: "← Painel" (4),
"← Voltar" (1) e outros genéricos. O problema não é o desenho da seta; é que o link
não diz para onde volta, e quem usa leitor de tela ouve "Painel" sem saber de qual
tela.

`PageHeader` deriva a volta do **penúltimo item da trilha** que já tem `href`. O nome
acessível é sempre **"Voltar para <pai>"** — "Voltar para Painel", "Voltar para
Administração" — e a seta é `aria-hidden` para não ser lida como "seta para a
esquerda". Quando o penúltimo item não tem `href` (pai só nominal, ou a própria tela
atual), **a volta não é desenhada**: um link que não navega é pior do que link
nenhum.

Não existe prop `back`. Se existisse, ela poderia discordar da trilha — e o produto
já tinha 15 exemplos do que acontece quando o destino é escrito duas vezes.

### 3.3 O `text-headline` que não existia

Quatro telas — `/conta`, `/esqueci-senha`, `/redefinir-senha` e
`/login/dois-fatores` — usavam `text-headline` no `<h1>`. A classe **não existe** no
`globals.css` nem no `DESIGN.md`: o Tailwind não gera utilitário para ela, o título
cai no tamanho base e as quatro telas renderizavam o **título da página em 16px**.
Nenhuma delas estava na linha de base visual, então nenhuma catraca de pixel viu.

A correção foi para o token que o `DESIGN.md` chama de "título de página": 
`text-title-lg` (28px). A lição não é "usar o token" — é que **medir a classe contra
o CSS** teria pegado: uma varredura de classes usadas × classes definidas reprova
`text-headline` em um segundo. A fase não criou essa catraca (não estava no escopo),
e o ponto fica registrado em §8.

### 3.4 O `PageHeader` era `'use client'` — o split veio antes

Ver §2. O componente foi para `ui/page-header.tsx` sem diretiva, sem hook e sem
`usePathname`; o `navigation.tsx` continua cliente porque é o menu que lê a rota. A
catraca (`f78-page-header.test.ts`) lê os dois arquivos e reprova as duas inversões.
O `index.ts` reexporta `PageHeader`/`Breadcrumbs` do módulo server — a importação
`from '@/components/ui'` não mudou em nenhuma página.

### 3.5 Os `data-testid` de descrição — a migração "visual" quebraria testes de conteúdo

Cinco telas de gestão publicavam o **estado** na linha abaixo do título e o E2E lia
esse estado **por testid**: `landing-status` (página do evento), `tenant-page-status`
(página da instituição), `media-summary` (acervo), `profile-identity` (ficha da
pessoa) e `sponsor-status` (patrocinadores). A fatia 4 acrescentou o sexto,
`shared-card-owner` (link público da carta). Levar a descrição para o `<p>` do
componente **sem** o testid trocaria o topo e quebraria a prova de conteúdo sem
quebrar pixel nenhum.

Por isso `descriptionTestId` é um **slot**, e não um `<p>` escrito à mão. O mesmo
vale para o título: `titleTestId` leva ao `<h1>` os 12 testids que o produto já tinha
(`tenant-page-title`, `profile-name`, `card-title`, `call-title`, `speaker-name`,
`audit-title`, `raffle-result-title`, `stage-off-title`, `demand-detail-title`,
`verification-title`, `tenant-detail-name`, `shared-card-title`).

### 3.6 A raiz é DINÂMICA desde a F71 — e o `f62` dizia o contrário

O `f62` nasceu na FASE 62 com duas linhas de base do rodapé público da raiz e um
comentário afirmando que a raiz "é estática — nenhum dado de banco, nenhuma data,
nada derivado do `RUN_ID`". Era verdade até a **FASE 71**, que transformou a raiz em
**vitrine viva**: "Eventos em destaque" e "A força da nossa rede em números" leem o
banco a cada render.

As duas linhas ficaram vermelhas e ninguém entendeu por quê. A medição desta fase:
a **primeira banda de diferença é a linha 988** — o título "Próximos eventos" — e o
topo (0–987, herói + busca) é **idêntico**. O defeito não era o rodapé nem o topo:
era o **diagnóstico**. A altura da imagem mudou de 3.262 para 3.334 px porque a
lista de destaques mudou de tamanho com o dado de execuções anteriores.

A decisão: **mascarar os dois blocos dinâmicos** (`featured-events-section` e
`public-metrics-section`) com o `mask` do `toHaveScreenshot` e **re-basear UMA vez**
com o motivo escrito. O que continua medido é o desenho fixo em volta — herói, busca,
jornada, banner de instituições e o rodapé, que é o alvo original. A alternativa
"re-basear com banco limpo" foi descartada: o banco do dia seguinte tem outro
destaque, e a linha volta a piscar. Deixar vermelho foi descartado porque esconde a
próxima regressão de verdade.

### 3.7 O que ficou de fora, de propósito

- **Os 7 heroes de marketing** (`/`, `/eventos`, `/para-instituicoes` e as páginas de
  venda): são páginas de venda, com desenho próprio, e não têm "gestão" no topo.
- **O tema do evento** (7 telas, mais a prévia e a ficha pública do palestrante): o
  topo é o site do organizador (ADR-324/325), com a paleta e a tipografia dele. Um
  `PageHeader` ali seria o topo do painel dentro da vitrine.
- **A página da casa** (`/t/<slug>`, FASE 64 · ADR-332): renderizador próprio, com
  capa, identidade e blocos.
- **Os 2 redirects** (`/superadmin` e o diretório legado `/organizacoes`): não são tela.

A allowlist é **motivada e assertada** (15 linhas): migrar uma tela exige remover a
linha e baixar o número; acrescentar exceção nova reprova.

---

## 4. Registro de Decisões de Arquitetura (ADRs)

### ADR-372 — O topo é um componente SERVER, e o split da navegação vem ANTES da migração

**Contexto.** O `PageHeader` existia desde a FASE 11 em `src/components/ui/navigation.tsx`,
que é `'use client'` porque `NavLink`/`TabNav` leem `usePathname`. Nove páginas o
usavam; 87 desenhavam o topo à mão. A dívida **H1** pedia "migração incremental, tela
a tela", e essa foi a decisão da F11B — que parou depois de nove telas.

**Decisão.** O topo sai da navegação e vira `src/components/ui/page-header.tsx`, sem
`'use client'`, sem estado, sem efeito e sem hook. `navigation.tsx` continua cliente
com o que **só** o menu precisa. O `index.ts` mantém a porta de importação
(`from '@/components/ui'`). A migração das 81 páginas vem **depois** do split.

**Justificativa.** O topo não tem comportamento: ele desenha a hierarquia, o título e
as ações que a página já decidiu. Mantê-lo no módulo de cliente faria cada página
migrada carregar JavaScript que ela não usa. Medido antes de decidir: 96 `page.tsx`
× uma ilha por página seria o custo de "migrar primeiro".

**Consequências.**
- A catraca `tests/unit/f78-page-header.test.ts` prende as duas metades: o topo não
  pode ganhar `'use client'`/hook; a navegação não pode perdê-lo.
- Um `PageHeader` que um dia precise de estado (um menu de ações, por exemplo) terá de
  ser um componente de cliente **separado**, montado como `actions` — não o topo.
- A migração pôde ser feita sem tocar no bundle das páginas: nenhuma delas virou
  ilha de cliente.

### ADR-373 — O `eyebrow` é o grupo de navegação da fonte única, não o nome da instituição

**Contexto.** O nome da instituição aparecia em 25 páginas e em três lugares: badge ao
lado do título (3), eyebrow (17) e texto (5). A casca já mostra o nome no topo da
barra lateral em todas as telas de gestão.

**Decisão.** O `eyebrow` é o **grupo de navegação** — "Geral", "Minha participação",
"Comitê científico", "Operação", "Plataforma" —, lido de `TENANT_NAV_GROUPS` /
`PLATFORM_NAV_GROUP` em `src/components/shell/tenant-nav.tsx`. O nome da instituição
sai do badge das três telas que o tinham. O eyebrow é `<p>` e fica **fora** do `<h1>`;
a ausência é válida (auth e lista pública não pertencem a um menu).

**Justificativa.** A única linha acima do título deve dizer **onde** a pessoa está, não
**quem** é a casa — a casa já está na casca. Repetir o nome gasta a linha e ainda
duplica a string em dois lugares que podem divergir. Com a fonte no menu, topo e
navegação concordam por construção.

**Consequências.**
- O `eyebrow` nunca é um heading: é `<p>`, e a catraca de unidade e o E2E verificam a
  tag e o afastamento do `<h1>`.
- Uma tela nova que não pertença a um grupo não inventa um: fica sem eyebrow.
- O nome da instituição passa a ter **um** lugar (a casca). Quem precisar dele no corpo
  usa o texto, não o topo.

### ADR-374 — A volta é derivada da trilha, e o contrato de teste da tela migra junto com o topo

**Contexto.** Dos 33 links "←" do produto, 15 não nomeavam o destino. As telas também
já tinham contratos de teste no topo: 12 `data-testid` de título e 5 de descrição lidos
pelo E2E. Uma migração "só visual" quebraria os dois — o nome acessível da volta e a
prova de conteúdo.

**Decisão.** (a) A volta é **derivada** do penúltimo item da trilha com `href`, com o
nome acessível "Voltar para <pai>"; não existe prop `back` e a seta é `aria-hidden`.
(b) O título e a descrição aceitam `titleTestId`/`descriptionTestId`, e os testids que
a tela já publicava **migram com ela**. (c) A migração é provada em **dois níveis**:
a catraca de fonte (as 96 telas) e o par de E2E (12 telas, o HTML entregue).

**Justificativa.** A trilha já é a fonte do caminho; uma prop paralela criaria a
segunda verdade que produziu os 15 links sem nome. Os testids não são detalhe de
teste: são o contrato que permite ao E2E provar o **conteúdo** que o topo publica —
perdê-los trocaria uma migração visual por um teste de conteúdo quebrado. E a fonte
sozinha não prova o render: quem prova é o navegador; quem cobre todas as telas é a
fonte.

**Consequências.**
- `PageHeader` é o único lugar que desenha a volta. Uma tela que queira um destino
  diferente da trilha está com a trilha errada — conserta-se a trilha.
- A catraca de fonte reprova `<h1>`/`<header>` à mão e a allowlist só encolhe; o E2E
  reprova `h1 !== 1`, `header h1 !== 1` e eyebrow dentro do `<h1>`.
- O limite dos dois níveis está escrito no código: a fonte não prova o ramo
  renderizado; o E2E cobre 12 telas, não 96.

---

## 5. Lições Aprendidas

### 5.1 As lições, com a evidência de cada uma

| # | Lição | Evidência medida | O que fica |
|---|---|---|---|
| 1 | **A regra já existia e o mutirão parou** | `design-system.md` §5 desde a F11; H1 aberta desde a F11B ("migração incremental, tela a tela, sem fase dedicada"); 9 de 96 telas no componente (9,4%) | Uma regra sem catraca envelhece como dívida. A fase fecha a H1 com o número (81/96) e uma catraca que só encolhe |
| 2 | **O eyebrow é o grupo, não a instituição** | Nome em 25 páginas/3 lugares; badge em 3; eyebrow em 17 | A casca já diz o nome. A linha acima do título é para dizer ONDE a pessoa está; fonte única no menu |
| 3 | **A volta derivada da trilha** | 15 dos 33 links "←" sem destino; "← Painel" ×4 | O nome acessível vem do pai com `href` ("Voltar para Painel"); sem prop paralela |
| 4 | **O `text-headline` que não existia** | 4 telas (conta, esqueci-senha, redefinir-senha, dois-fatores) com `<h1>` em 16px; a classe não está no CSS nem no `DESIGN.md` | Medir a classe contra o CSS teria pegado. 16 → 28 px (`text-title-lg`) |
| 5 | **A raiz é dinâmica desde a F71; o `f62` dizia estática** | Primeira banda de diferença na linha 988 ("Próximos eventos"); topo 0–987 idêntico; altura 3.262 → 3.334 | O vermelho era DADO, não topo. Mask nos dois blocos + uma re-base declarada |
| 6 | **O `PageHeader` era `'use client'`** | 96 `page.tsx`; o componente vivia em `navigation.tsx` | Espalhá-lo criaria ~96 ilhas. O split veio ANTES da migração (ADR-372) |
| 7 | **Os testids de descrição** | 5 (`landing-status`, `tenant-page-status`, `media-summary`, `profile-identity`, `sponsor-status`) + `shared-card-owner` na fatia 4 | A migração "visual" quebraria testes de conteúdo. `descriptionTestId` é slot |
| 8 | **O `.ef-card` fora do tema** | O cartão do convite sem moldura/fundo, achado OLHANDO a tela | `.ef-card`/`.ef-button-outline` usam `var(--ef-*)` que só existem sob `.ef-theme`. Virou a dívida **E90** |

### 5.2 Defeitos REAIS encontrados

| Sintoma | Causa raiz | Correção |
|---|---|---|
| Quatro telas com o título em 16px | `text-headline` não existe no CSS; nenhuma estava em linha de base visual | `text-title-lg` (28px); a lição é a varredura classe × CSS (§8) |
| Duas linhas da raiz vermelhas por "topo" | O comentário do `f62` dizia estática, mas a F71 pôs destaques e métricas na raiz | Diagnóstico medido (linha 988), máscara nos blocos dinâmicos e re-base única |
| O cartão do convite sem moldura e sem fundo | `.ef-card`/`.ef-button-outline` leem `--ef-background`/`--ef-text`/`--ef-radius`, publicados só sob `.ef-theme`; fora dele o valor é inválido | Declarado como **E90** (não corrigido nesta fase) |

O defeito da **gaveta de 64 px** é da FASE 62, não desta; ele é citado como a razão
de a suíte visual existir, não como achado da F78.

### 5.3 O que NÃO foi medido

- **O tempo de render das 81 telas.** A migração é de apresentação; a fase não mediu
  TTFB/TTI antes e depois. O argumento do split é de BUNDLE (nenhuma ilha nova), não
  de latência medida.
- **A classe `text-headline` em telas fora das 4.** A varredura foi dirigida às telas
  do topo. Não há catraca global de classe × CSS (proposta em §8).
- **A leitura em leitor de tela real.** O nome acessível "Voltar para X" e o eyebrow
  como `<p>` são provados por DOM e por `axe`/estrutura, não por teste com NVDA/VoiceOver.
- **O tema do evento.** Fica fora por decisão (ADR-324/325), e a fase não o mediu.

---

## 6. Evidência de Verificação

### 6.1 `npm run lint`

```text
npm run lint → eslint .
(sem saída de erro; exit 0)
```

### 6.2 `npm run typecheck`

```text
npm run typecheck → tsc --noEmit
(sem saída de erro; exit 0)
```

### 6.3 `npm test` — a suíte Vitest inteira

```text
 Test Files  245 passed (245)
      Tests  4384 passed (4384)
   Duration  193.14s (tests 52%, import 35%, transform 10%, environment 2%)
```

**4384 casos em 245 arquivos** (eram 4313/241 na F77): a diferença de **71 casos em 4
arquivos** é exatamente a catraca da F78 (`f78-page-header` 25, `f78-topo-unico` 18,
`f78-fatia3` 12 e `f78-fatia4` 16).

### 6.4 `npm run build`

```text
✓ Compiled successfully in 3.8s
✓ Generating static pages using 15 workers (18/18) in 739ms
ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand
```

Nenhuma rota nova (a fase não cria endereço); as 96 páginas continuam no manifesto.

### 6.5 `npm run db:verify`

```text
  ✓  Nenhuma tabela com RLS ficou sem policy
  ✓  Role "eventflow_app" sem superuser e sem BYPASSRLS
  ✓  GRANTs mínimos presentes, TRUNCATE ausente
  ✓  Tabela(s) de plataforma inalcançável(is) pela role "eventflow_app"

  Contrato íntegro.
```

### 6.6 `npm run db:verify:isolation`

```text
  ✓  [A9] Role de runtime não consegue desligar a RLS nem escalar privilégio
         todas as tentativas rejeitadas

  9/9 verificações passaram.
  Isolamento entre tenants garantido pelo banco.
```

### 6.7 `npm run db:partitions`

```text
  audit_logs_2026_09 ....  43872 linhas · 25.04 MB
  audit_logs_2026_10 ....  72616 linhas · 40.29 MB
  audit_logs_2026_11 ....      0 linhas ·  0.04 MB   (a do mês seguinte, criada)
  audit_logs_2026_12 ....      0 linhas ·  0.04 MB
  audit_logs_default ....      0 linhas ·  0.09 MB
  total ................. 116488 linha(s)
```

### 6.8 O container — a imagem é a nova

```text
docker compose --profile app up -d --build web worker
   Image eventflow/web:local Built
   Image eventflow/worker:local Built
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}'
   eventflow/web:local     2026-10-23 16:34:15 -0300
   eventflow/worker:local  2026-10-23 16:34:26 -0300
docker compose ps
   web    Up (healthy)
   worker Up
```

**Por que a data é a de 16:34 e isso é o build desta fase:** o `.dockerignore` exclui
`tests/`, `docs/` e `*.md` do contexto — que são justamente os arquivos que a fatia 5
tocou. O `src/**` não mudou depois das fatias 1–4, então o `--build` reutilizou as
camadas e a imagem **é** a do código atual. A prova não é a data: é a tela. O HTML de
`/verificacao` servido pelo container traz o topo novo —

```html
<header class="space-y-4" data-testid="verification-result">
  <div class="min-w-0 space-y-1.5">
    <p class="text-xs uppercase tracking-wide text-muted-foreground">Plataforma</p>
    …<h1 class="font-display text-title-lg text-foreground" data-testid="verification-title">
```

—, e não o `<h1>` de 24px escrito à mão. É a mesma verificação que o `AGENTS.md` §4
exige: a data sozinha não prova; a rota prova.

### 6.9 E2E — a suíte inteira

```text
imagem docker ..................... eventflow/web:local · 2026-10-23 16:34:15 (o build da F78)
npx playwright test --output %TEMP%\f78-e2e

  1 skipped
  469 passed (10.8m)
```

**470 no total** (469 passando + 1 skip) — eram **458** na F77, e a diferença é
exatamente o que a fase acrescentou: **12** casos no `f78-topo-unico.spec.ts`. O skip é
o `test.fixme` da **E76** (`inline-action-without-js.spec.ts`: a ação em linha antes do
bundle), declarado e não desta fase. **Nenhum vermelho.** Em particular:

- as **duas linhas de base do rodapé da raiz**, que estavam vermelhas desde a F76,
  **passaram** com o mask e a re-base (o `f62` inteiro fechou 23/23 na suíte);
- o `f65` ("Acontecendo agora"), intermitente declarado, **não falhou nesta execução** —
  o que não muda o registro: ele continua sendo o único vermelho esperado quando falha;
- os specs de **participantes**, **acessibilidade** e **exportação** continuaram verdes
  com o topo novo, porque os `data-testid` de título/descrição migraram como slots.

### 6.10 O `f62` (regressão visual), depois do mask

```text
npx playwright test tests/e2e/f62-regressao-visual.spec.ts --update-snapshots
  23 passed (47.0s)          ← a ÚNICA re-base, com o motivo escrito

npx playwright test tests/e2e/f62-regressao-visual.spec.ts
  23 passed (34.4s)          ← execução 1, 0 pixel contra a linha nova

npx playwright test tests/e2e/f62-regressao-visual.spec.ts
  23 passed (33.8s)          ← execução 2, 0 pixel contra a linha nova
```

O que mudou, medido: as duas imagens da raiz passaram de **1440×3262** (linha velha,
gerada antes de a F71 pôr destaques e métricas na página) para **1440×3334**, com os
dois blocos dinâmicos mascarados. O topo (0–987) não mudou; a primeira banda de
diferença da linha antiga era a **linha 988**, o título "Próximos eventos". A re-base
foi **uma só**, e as duas execuções seguintes deram **zero pixel** de diferença com
`maxDiffPixelRatio: 0`.

### 6.11 O par de E2E do topo único

```text
npx playwright test tests/e2e/f78-topo-unico.spec.ts --output %TEMP%\f78-topo
  12 passed (8.9s)
```

As 12 telas: painel, participantes, administração, equipe, raiz do evento,
programação, minhas inscrições, certificados, métricas, rotinas, login e a lista
pública de eventos. Cada uma afirma: **1 `<h1>`**, **1 `<h1>` no `<header>`**, o
`eyebrow` como `<p>` fora do `<h1>` (ou a ausência dos grupos, quando a tela não
pertence a um menu).

### 6.12 As catracas, com a mutação

```text
árvore íntegra      18 passed (18)   ← a catraca de fonte da F78

MUTAÇÃO             src/app/__mutacao-f78/page.tsx, um page.tsx com
                    <main><header><h1>Topo escrito à mão</h1></header></main>
                    (sem importar nem usar o PageHeader)

MUTADA              18 tests | 4 failed
  × encontra as telas e ancora o tamanho da dívida          (97 ≠ 96)
  × nenhuma tela migrada desenha o próprio <h1>
  × nenhuma tela migrada desenha um <header> como topo
  × toda tela migrada importa e usa PageHeader

RESTAURADA          arquivo apagado — 18 passed (18)
```

A mutação prova o que a catraca **morde**: um topo escrito à mão em QUALQUER página
reprova em quatro frentes (o número, o `<h1>`, o `<header>` e a ausência do
componente). O que ela **não** prova — o ramo renderizado — é a razão de o par de E2E
existir (§6.11 e ADR-374).

### 6.13 As imagens

```text
docs/imagens/f78-topo-unico.png ... antes × depois de Minhas inscrições e Participantes
```

Capturadas da tela real com spec temporário, apagado depois (a limpeza está em §7).

---

## 7. Comandos Operacionais

```bash
# testes da fase
npx vitest run tests/unit/f78-page-header.test.ts
npx vitest run tests/unit/f78-topo-unico.test.ts
npx vitest run tests/unit/f78-fatia3-plataforma-auth-estado.test.ts
npx vitest run tests/unit/f78-fatia4-publicas.test.ts

# navegador
npx playwright test tests/e2e/f78-topo-unico.spec.ts
npx playwright test tests/e2e/f62-regressao-visual.spec.ts

# a imagem do topo foi capturada por um spec TEMPORÁRIO (f78-captura.spec.ts),
# apagado depois de gerar docs/imagens/f78-topo-unico.png; não há comando a repetir.
# As capturas "antes" usaram as duas páginas com o topo antigo restaurado no lugar,
# no mesmo dado (instituição, evento e pessoas fixos), e as "depois" o código atual.
```

```text
Telas ....... /t/<slug>/dashboard · /participantes · /administracao · /administracao/equipe
              .../eventos/<eventId> · .../programacao · /minhas-inscricoes · /certificados
              /superadmin/metricas · /superadmin/rotinas · /login · /t/<slug>/eventos
Regra ....... toda tela começa por PageHeader; eyebrow = grupo do menu; volta derivada da trilha
Exceção ..... tema do evento (ADR-324/325), heróis de marketing, página da casa (F64), redirects
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

### 8.1 A dívida H1 fechada

A **H1** ("Composição das telas antigas — cabeçalhos ainda escritos à mão") está
**fechada**. O número que a define: **96 `page.tsx` medidos, 81 migrados, 15
exceções motivadas**. A catraca de fonte asserta os três números, e o E2E prova o
render em 12 telas. A contagem de dívidas vai de **42 para 41** com a quitação.

### 8.2 A dívida nova: E90

O defeito encontrado **olhando a tela**: `.ef-card` e `.ef-button-outline` são classes
do **tema do evento** e leem `var(--ef-background)`, `var(--ef-text)` e
`var(--ef-radius)` **sem fallback**. Essas variáveis só existem sob `.ef-theme`,
publicadas pelo `themeToCssVariables`. Fora dele — o cartão do **convite de equipe**
(`/t/<slug>/convite`, 6 blocos `.ef-card`) — o valor é inválido, o `background-color`
e o `border` caem, e o cartão aparece **sem fundo e sem moldura**; o botão de contorno
perde a borda. A mesma família de classes aparece em `unsubscribe-forms.tsx`
(descadastro) e `erase-form-responses-button.tsx` (minhas inscrições), que também não
estão sob o tema.

É **defeito reprodutível numa tela real**, não limite de desenho — o critério da E87 e
da E89 —, e por isso entra na contagem: **E90**, esforço **M**, e o total volta a
**42** (A=4, B=6, C=1, D=3, **E=23**, F=5, **H=0**, I=0). Não foi corrigido nesta
fase: mexer nas classes do tema sem uma varredura de todos os usos trocaria o defeito
de lugar.

### 8.3 Pontos de atenção declarados

- **O `'Plataforma'` do selo em `app-shell.tsx:125`** ainda é uma **string literal**,
  enquanto o eyebrow usa `PLATFORM_NAV_GROUP` (o mesmo texto). São duas fontes da
  mesma palavra: renomear o grupo não renomeia o selo. O caminho é o selo ler a
  constante — não foi feito para não tocar no shell nesta fase.
- **O avatar 48 × 80 no slot de ícone**: o slot `icon` aceita qualquer nó e não
  normaliza tamanho. A ficha pública (`u/[username]`) passa a **foto 80 × 80**
  (`size-20`), enquanto o fallback `Avatar size="lg"` mede **48 × 48**. O topo fica
  com duas alturas de linha conforme a pessoa tenha ou não foto. Padronizar é
  decisão de desenho (não há número errado, há dois números).
- **`TOPO_COMPARTILHADO` é conceito novo**: quando uma lista tem **dois pontos de
  montagem** (a página e o fallback da página da casa, F64), o topo mora no
  **componente** — não em duas páginas. A catraca registra a delegação e exige que o
  módulo declarado use o `PageHeader`; não é allowlist e não conta como dívida. Hoje
  há **1 módulo** (`public-event-list.tsx`) com **2 pontos de montagem**.
- **As 2 linhas de base da raiz foram mascaradas** — o mask cobre os blocos
  "Eventos em destaque" e "A força da nossa rede em números". A altura da imagem
  depende de a lista de destaques ter o mesmo número de cartões; uma execução
  **interrompida** que deixe instituições para trás muda a altura e reprova. O
  remédio operacional é `npm run e2e:clean -- --confirmar` antes da suíte quando
  houver resíduo.
- **A varredura de classe × CSS não existe**: o `text-headline` provou que uma classe
  inexistente pode viver em produção sem nenhuma catraca. Proposta para um mutirão:
  cruzar as classes usadas nos `tsx` com as definidas no `globals.css`/`event-theme.css`
  e reprovar o que não existe.

### 8.4 Os efeitos visuais declarados das fatias

A migração **muda a tela**, e mudar era o objetivo. O que o humano vai ver:

- **`<h1>` 16 → 28 px** nas 4 telas do `text-headline` (conta, esqueci-senha,
  redefinir-senha, dois-fatores).
- **Login e signup 24 → 28 px**: eram 24px escritos à mão; passaram ao token de
  página.
- **Telas de resultado/estado não são mais centradas**: verificação, validação
  (código e lote), instituição bloqueada, 404 de instituição e seleção de instituição
  alinharam o topo à esquerda, como as demais telas de gestão.
- **"PLATAFORMA" acima do título**: as telas de plataforma e as de estado da
  plataforma ganharam o `eyebrow` `PLATFORM_NAV_GROUP`; antes não havia linha de
  grupo.
- **"Geral"/"Operação"/"Minha participação"/"Comitê científico"** no lugar do nome da
  instituição (ou de nada) no painel e nas telas de gestão.
- **O nome da instituição saiu do badge** de administração, equipe e comunicação.
  Continua na casca.
- **6 telas que só tinham `<h2>` ganharam `<h1>`**: api, dados, formulário,
  programação, reconhecimento e salas do evento.
- **A trilha e o "Voltar para X"** substituíram os links "←" genéricos nas telas de
  detalhe; a volta passou a nomear o destino.

### 8.5 O que ficou aberto

- **Nada funcional desta fase.** A H1 está fechada, a E90 declarada, as duas linhas da
  raiz verdes.
- **O tema do evento e os heróis de marketing** continuam com desenho próprio — é
  decisão, não pendência.
- **A E90** (M) e a varredura classe × CSS (proposta) seguem como trabalho futuro.

---

## 9. Checklist de Aceite

| Requisito | Situação |
|---|---|
| `docs/fase-78-topo-unico.md` com as **9 seções** e **ADR-372/373/374** (a próxima é a 375) | ✅ |
| `PageHeader` **server** separado de `navigation.tsx`, sem ilha de cliente em página nenhuma | ✅ |
| `title`/`titleTestId`/`eyebrow`/`icon`/`breadcrumbs`/`description`/`descriptionTestId`/`badge`/`actions` implementados | ✅ |
| A volta **derivada** do penúltimo item da trilha, com nome acessível "Voltar para X" | ✅ |
| `eyebrow` = grupo de navegação da fonte única (`TENANT_NAV_GROUPS`/`PLATFORM_NAV_GROUP`), nunca o nome da instituição | ✅ |
| **81 das 96 páginas migradas** e **15 exceções** em allowlist motivada | ✅ |
| `TOPO_COMPARTILHADO` para a lista pública (2 pontos de montagem), com o módulo usando o topo | ✅ |
| `text-headline` eliminado (4 telas 16 → 28 px) | ✅ |
| As 6 telas que só tinham `<h2>` ganharam `<h1>` | ✅ |
| Os 12 `data-testid` de título e os 5 + 1 de descrição preservados | ✅ |
| Catraca de fonte (`f78-topo-unico.test.ts`, 18 casos) com allowlist assertada | ✅ |
| Par de E2E (`f78-topo-unico.spec.ts`, 12 telas): 1 `<h1>`, `header h1 === 1`, eyebrow `<p>` fora do `<h1>` | ✅ |
| `f62` com a raiz **dinâmica** documentada, os blocos mascarados e UMA re-base | ✅ |
| `docs/dividas-tecnicas.md` com a **H1 fechada** (42 → 41, H=0) e a **E90** declarada (41 → 42) | ✅ |
| `docs/design-system.md` §10 corrigido (23 snapshots) e a regra do topo registrada | ✅ |
| `AGENTS.md` com a fase 78, as contagens, ADRs 374 → 375, dívidas e §10 | ✅ |
| `README.md` com a narrativa e o índice | ✅ |
| `docs/imagens/f78-topo-unico.png` (antes × depois de duas telas) | ✅ |
| Bateria da §4 inteira, com os números reais | ✅ |
| `src/app/globals.css` e `playwright.config.ts` intocados | ✅ |

**Aguardando APROVADO: AVANÇAR.**
