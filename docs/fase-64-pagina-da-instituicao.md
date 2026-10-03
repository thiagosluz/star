# FASE 64 — A página pública da instituição

> **Estado: ENTREGUE** (fatias 1 a 5). A instituição deixou de ter só uma lista de
> eventos: ela passou a ter uma **vitrine própria** em `/t/<slug>` — capa, identidade,
> os três grupos de eventos lidos na renderização e blocos que o organizador monta —,
> com **editor**, **rascunho × publicado** e **tema da casa**.
>
> Este documento traz os números REAIS, os defeitos REAIS que os testes pegaram, as
> decisões (com as alternativas descartadas) e o que ficou aberto.

---

## 1. Sumário executivo

### O que o visitante e o organizador ganharam

```text
Página pública ....... /t/<slug>                        (o visitante, sem sessão)
Editor ............... /t/<slug>/administracao/pagina   (page:manage)
Onde fica no menu .... "Página pública" no grupo OPERAÇÃO (tenant-nav.tsx)
Tabela ............... tenant_public_pages (RLS + FORCE, 1 linha por instituição)
```

A raiz da instituição virou **duas telas na mesma URL**, decididas por uma pergunta:
quando a instituição **publicou** a página, o endereço é ela; quando **nunca publicou**
(ou tirou do ar), o endereço continua sendo o que sempre foi — a **listagem pública de
eventos** dela. Sem redirect, sem 404, sem tela vazia: é requisito de aceite, e tem
teste que o prende nos dois sentidos (nunca publicada **e** despublicada).

### Tabela de entregas

| # | Fatia | Entrega | Onde |
|---|---|---|---|
| 1 | Fundação | Domínio puro (blocos reusando as regras do editor do evento + a regra dos três grupos por data, no fuso da instituição), tabela `tenant_public_pages` (RLS + FORCE) com migração, repositório por `withTenant`, serviço de leitura (render), de gravação (com trilha) e de publicação (rascunho × publicado por snapshot) | `src/domain/tenancy/tenant-public-page.ts`, `tenant-event-groups.ts`; `src/lib/tenancy/tenant-public-page-{repository,view,write-service}.ts`; `prisma/migrations/20261001180000_f64_pagina_publica_da_instituicao/` |
| 2 | Página pública | `/t/<slug>`: capa, descrição, identidade, os três grupos com limite e "ver todos", os blocos — tudo **lido na renderização**, com **um único `<main>`**, o rodapé da aparência (F63) e o fallback da listagem | `src/app/t/[tenantSlug]/(public)/page.tsx`; `src/components/tenancy/tenant-page.tsx` (`TenantPublicPage`/`TenantHome`); `src/components/tenancy/public-event-list.tsx`; `src/domain/tenancy/tenant-page-presentation.ts` |
| 3 | Editor do organizador | `/t/<slug>/administracao/pagina`: identidade, capa e logotipo por upload (WebP, original apagado, quota conferida antes de assinar a URL), blocos com ordem/visibilidade/remoção, **prévia pelo mesmo componente da página real**, publicar/despublicar | `src/app/t/[tenantSlug]/(app)/administracao/pagina/page.tsx`; `src/app/actions/tenant-page-actions.ts`; `src/components/admin/tenant-{identity,theme}-fields.tsx`, `tenant-asset-uploader.tsx`, `tenant-block-fields.tsx`; `src/domain/tenancy/tenant-page-editor.ts`; `src/lib/tenancy/tenant-page-asset-service.ts` |
| 4 | Capa e tema | A paleta da instituição publicada como papéis `--ef-*` no **escopo da página**, com o modo resolvido pelo **visitante** | `src/domain/tenancy/tenant-page-theme-rules.ts`; `src/components/admin/tenant-theme-fields.tsx` |
| 5 | Catracas e documento | Unidade, integração (RLS, rascunho × publicado), E2E (organizador edita → público muda; anônimo lê sem sessão; os três grupos com fixtures de data), **portão WCAG AA** com as telas novas, **regressão visual** nos dois modos, este documento, `README.md`/`AGENTS.md` e a **E84 quitada para a instituição** | `tests/{unit,integration,e2e}/f64-*`; `tests/e2e/accessibility.spec.ts`; `tests/e2e/f62-regressao-visual.spec.ts` |

### Números da fase

| Medida | Antes da fase | Depois da fase |
|---|---|---|
| Vitest (unit + integração) | 2.984 | **3.105** (+121) |
| Arquivos de teste do Vitest | 159 | **165** (+6) |
| Playwright E2E | 300 (o `AGENTS.md` dizia 299) | **317** (+17), 1 deles `skip` |
| Casos no portão WCAG AA (`accessibility.spec.ts`) | 15 | **17** (+2), `ISENCOES` continua `[]` |
| Linhas de base da regressão visual (`f62`) | 14 | **16** (+2) |
| Tabelas de tenant sob RLS + FORCE | 58 | **59** (+1) |
| ADRs | 330 | **333** (331, 332, 333 nesta fase) |

Os **121** casos do Vitest estão em 6 arquivos:

```text
tests/unit/f64-grupos-de-eventos.test.ts ................ 27
tests/unit/f64-pagina-da-instituicao.test.ts ............ 30
tests/unit/f64-pagina-publica-da-instituicao.test.ts .... 16
tests/unit/f64-editor-e-tema-da-pagina.test.ts .......... 26
tests/integration/f64-pagina-da-instituicao.test.ts ..... 12
tests/integration/f64-editor-da-pagina.test.ts .......... 10
                                                  total  121
```

E os **17** casos E2E da fase: 4 em `f64-pagina-da-instituicao.spec.ts`, 9 em
`f64-editor-da-pagina.spec.ts`, 2 no portão de acessibilidade e 2 na regressão visual.

---

## 2. O problema mais difícil da fase

**Duas telas no MESMO endereço, e um `<main>` só.**

`/t/<slug>` já existia — era um `redirect` para o painel — e a fase precisou fazer
dele a vitrine da casa **sem quebrar o que ele já era**: o endereço que o subdomínio
inteiro usa (o Proxy reescreve `ufba.lvh.me/` para cá), o destino do logotipo do
cabeçalho e o link de toda página de evento da instituição.

O caminho fácil era a página decidir sozinha: "tem página publicada? desenho a
vitrine; não tem? desenho a listagem". E é aí que a fase quase se perdeu — as duas
telas desenham o **próprio `<main>`** (a casca deixou de ser landmark na FASE 52), e
uma decisão tomada dentro da página produz **dois landmarks** em um dos ramos. A
catraca do portão WCAG AA reprovou exatamente isso na primeira versão, e a correção
não foi afrouxar a catraca: foi mover a escolha para um componente que desenha o
`<main>` **uma vez** e recebe o conteúdo do outro ramo por prop (`TenantHome`).

O mesmo problema apareceu uma segunda vez, do outro lado: o **editor** embute a
página pública inteira como prévia (decisão herdada da F27/F23: prévia desenhada por
outro componente mente), e a prévia traz o `<main>` dela. A solução foi
`display: contents` no `<main>` da prévia — a caixa some (e com ela o landmark), e os
filhos seguem desenhados e acessíveis. **A catraca passou a medir o que é landmark**
(`checkVisibility()`), e não quantos nós `main` existem no DOM.

É este problema que define o desenho da fase inteira: **o landmark é do componente
compartilhado**, e é por isso que as duas telas (visitante e editor) desenham a
MESMA árvore, com os mesmos `<main>`, os mesmos blocos e os mesmos cartões. Não há
"tela parecida com a pública": há uma só.

### As outras duas decisões difíceis, em uma frase cada

- **Os grupos vêm das DATAS, não de curadoria.** O organizador não ganha uma tarefa
  por evento criado, e a página nunca fica desatualizada porque alguém esqueceu de
  mover um evento de lugar. A conta é em INSTANTES (`startsAt`/`endsAt` são
  TIMESTAMPTZ) e o fuso da instituição entra só na APRESENTAÇÃO — comparar instante
  com instante é correto em qualquer fuso e em qualquer horário de verão.
- **A página lê o evento na RENDERIZAÇÃO.** O bloco de histórico guarda só a
  decoração (título, descrição, limite); a lista é lida do sistema agora. Copiar o
  evento para dentro do bloco mentiria no dia seguinte — é a lição da FASE 33
  (ADR-168), e ela vale igual aqui.

---

## 3. Decisões técnicas (o "porquê", e o que foi descartado)

### 3.1 Rascunho e publicado na MESMA linha, por snapshot

A tabela guarda o rascunho em colunas (`title`, `description`, `coverImageUrl`,
`logoUrl`, `theme`, `blocks`) e a versão no ar em **uma coluna JSONB**
(`publishedSnapshot`) mais `publishedAt`/`publishedById`.

Descartado: **duas tabelas** (`..._drafts` e `..._published`). Seriam duas verdades
para a mesma página, com o risco clássico de a versão no ar existir sem rascunho (ou
o contrário) e nenhuma forma barata de saber qual está desatualizada. Com o snapshot,
"tem alteração não publicada?" é uma pergunta só, respondida por **hash canônico do
snapshot inteiro** (`tenantPageChecksum`, com a mesma canonicalização do histórico de
versões do evento) — e um campo novo no snapshot entra na comparação por construção,
em vez de depender de alguém lembrar de compará-lo.

Descartado também: **coluna booleana `isPublished`**. Ela responde "está no ar?" e não
responde "o que eu acabei de editar já está no ar?" — e é essa segunda pergunta que o
organizador faz. `TenantPagePublication` tem três estados (`NEVER_PUBLISHED`,
`PUBLISHED`, `CHANGES_PENDING`) justamente porque as duas perguntas são diferentes.

O snapshot vazio é `{}` e **não** é uma versão publicada: `readTenantPageSnapshot`
exige a forma mínima (um `title` de verdade). Uma linha corrompida vira "nunca
publicada" em vez de uma página desenhada a partir de `undefined`.

### 3.2 O domínio COMPÕE o do evento em vez de copiar a régua

`tenant-public-page.ts` importa `themeSchema`, `resolveTheme`, `themeToCssVariables`,
`safeUrlSchema`, `validateBlockContent`, `orderBlockIds`, `moveBlockId`,
`assignDisplayOrder` e `canonicalize` **do evento**, por referência. Aqui só vivem os
três tipos de bloco que são invenção desta página (`ABOUT`, `PAST_EVENTS`,
`CONTACT`) e a **paleta padrão da instituição** — que é outra de propósito: o azul
institucional (`#0f6f8c`) não é o índigo do evento (`#4f46e5`).

Descartado: um validador "parecido" para a instituição. Duas réguas para a mesma
ideia divergem no dia em que alguém corrige só um dos lados — e o defeito aparece no
lado que ninguém olhou (a lição da dívida **E79**, repetida na FASE 60). Foi
exatamente esse arranjo que pegou o defeito nº 3 da §5.

### 3.3 O tema: papéis `--ef-*` no escopo, modo do visitante

`buildTenantThemeScope` escolhe o MODO em que `themeToCssVariables` é chamado: se o
visitante escolheu `claro`/`escuro`, manda a escolha dele; se escolheu `sistema` (ou
não escolheu nada), vale o modo que a instituição declarou. Fundo e texto **não são
campo do editor** — são os dois únicos papéis que PRECISAM mudar com o modo, e
deixá-los com a instituição faria a escolha dela vencer a do visitante (o defeito que
a fase proíbe). O editor oferece a IDENTIDADE (principal, secundária, destaque).

Descartado: publicar os papéis do modo declarado e deixar o CSS do visitante
sobrescrever depois. Daria duas fontes para a mesma cor e, no modo `sistema`, duas
respostas para "que horas são aqui?".

> **O que a fatia 5 precisou consertar aqui — e vale para quem for mexer:** publicar os
> papéis `--ef-*` **não bastava**. O `globals.css` resolve os apelidos semânticos na
> RAIZ (`--brand: var(--ef-primary)`, …) e o CSS substitui `var()` no elemento onde a
> declaração é feita — então sobrescrever `--ef-primary` num descendente **não**
> re-resolve `--brand`, e a paleta da casa publicava sem pintar nada (medido: `#7b2ff7`
> no escopo e `#3525cd` na tela). O escopo passou a publicar TAMBÉM os apelidos de
> IDENTIDADE que a página lê, e **só** eles: superfície, texto e contorno continuam
> vindo do modo do visitante. A medição de antes e depois está na §8.2.

### 3.4 Os três grupos, o limite e o "ver todos"

Cada grupo devolve `items` (recortado pelo limite), `events` (o evento COMO ELE É) e
`total`/`hasMore` (o grupo inteiro). O link "ver todos" só aparece quando o serviço
diz que há mais, e o número entre parênteses é o `total` **do serviço** — a tela não
reconta os cartões desenhados. É a lição da FASE 54 aplicada: recontar diria "ver
todos os 6" embaixo de uma lista de 6, com 12 no banco.

Um grupo VAZIO não desaparece: ele diz que está vazio. Esconder a seção faria a
página parecer quebrada em vez de informar.

### 3.5 O upload da capa entra no acervo com finalidade PRÓPRIA

`TENANT_COVER` e `TENANT_LOGO` entraram no catálogo canônico de finalidades
(`image-rules.ts`) em vez de reusar `COVER`/`LOGO`. A finalidade faz parte da
identidade do objeto no bucket e da deduplicação do acervo: com `COVER`, a mesma
imagem usada na capa de um evento e na da instituição seria gravada UMA vez, e a
segunda tela apontaria para o objeto da primeira — apagar uma deixaria a outra
quebrada. Fora isso, limites, allowlist de tipo, assinatura real (magic bytes) e
política de WebP são a MESMA régua (uma segunda tabela de limites divergiria no
primeiro ajuste).

O `eventId` do acervo passou a aceitar `null` (o acervo da INSTITUIÇÃO — coluna
prevista desde a FASE 24 e até agora sem leitor de verdade).

---

## 4. ADRs

### ADR-331 — A página da instituição é uma ENTIDADE sob RLS, e o que o visitante vê é um SNAPSHOT publicado

**Contexto.** A instituição só tinha páginas de EVENTO (F17/F23). A raiz `/t/<slug>`
era um `redirect` para o painel. Foi pedido que a instituição tivesse a própria
vitrine, montável pela equipe, com a mesma mecânica que o organizador já conhece.

**Decisão.** A página mora em `tenant_public_pages`, **uma linha por instituição**
(índice único em `tenantId`), com o rascunho em colunas e a versão no ar em
`publishedSnapshot` (JSONB) + `publishedAt` + `publishedById`. A tabela entra em
`TENANT_SCOPED_TABLES` (`schema-contract.ts`) e nasce com **RLS + FORCE**; a policy
vem da **introspecção** de `20260917191000_rls_policies` (toda tabela com `tenantId`
recebe ENABLE + FORCE + policy), e o `FORCE` vai explícito na migração para a tabela
nascer no estado correto mesmo entre `prisma migrate` e `db:rls`.

**Justificativa.** (a) A leitura pública é feita **sem sessão**, a partir do slug que
vem da URL — o `slug` é entrada de visitante anônimo; a RLS é a última linha se uma
consulta esquecer o filtro. (b) O `FORCE` importa mais que o `ENABLE`: sem ele o DONO
da tabela (`eventflow_admin`, a role do seed e das CLIs) ignora a policy.
(c) Rascunho e publicado na mesma linha dão UMA resposta para "o que está no ar?".

**Consequências.** A leitura pública devolve `null` em três casos — nunca publicada,
sem linha, ou despublicada — com a MESMA resposta ao visitante (o que existe no
rascunho de outra pessoa não é assunto dele). O fallback da listagem de eventos fica
preservado por construção, e o `<main>` é desenhado em UM lugar (`TenantHome`) para
os dois ramos não criarem dois landmarks.

### ADR-332 — O modo da página da instituição é do VISITANTE; a paleta é a IDENTIDADE (E84 quitada para a instituição)

**Contexto.** A FASE 61 (ADR-325) decidiu que, na página do EVENTO, quem manda no
claro/escuro é o ORGANIZADOR: a landing é um cartaz. A FASE 63 deu ao visitante
anônimo um controle de aparência no rodapé das páginas públicas da plataforma. A
página da instituição vive DENTRO do casco da plataforma (cabeçalho, rodapé e o
controle da F63) — e ali a escolha do visitante não pode desaparecer.

**Decisão.** O escopo do tema publica os papéis `--ef-*` da instituição com o MODO
resolvido pelo visitante: `claro`/`escuro` do cookie `ef_tema` mandam; `sistema` cai
no modo que a instituição declarou. Fundo e texto não são campo do editor (seguem a
paleta do modo); principal, secundária e destaque são escolha da casa nos dois modos
(a marca não inverte).

**Justificativa.** Se a paleta da instituição publicasse fundo e texto a partir do
modo DELA, o visitante que escolheu "escuro" receberia uma página clara — com o
controle do rodapé logo abaixo marcando "Escuro". Seria uma mentira visível na mesma
tela. A consequência é declarada: **a dívida E84 (o claro/escuro do visitante sobre a
paleta do organizador) fica QUITADA para a página da instituição e segue ABERTA para
a página do evento**.

**Emenda da fatia 5 — o que "publicar os papéis" precisou significar.** Publicar só os
`--ef-*` não bastava: com eles no escopo e sem ninguém para lê-los, a paleta da casa era
um campo morto (§8.2, medido). O escopo passou a publicar TAMBÉM os apelidos de
IDENTIDADE que os componentes desta página leem (`--brand`, `--primary`, `--ring`,
`--primary-soft`, …) — e **só** eles: superfície, texto e contorno continuam vindo do
modo do VISITANTE, que é o que esta decisão protege. O papel de TEXTO (`--brand`) é
ajustado ao modo até 5:1, porque **não existe um tom que sirva às duas superfícies** (a
mesma lição da F52): a marca escolhida não inverte no PREENCHIMENTO, e a tinta com que a
página escreve é medida.

**Consequências.** O editor não oferece "modo" (a tela diz por quê), e o
`data-theme-mode` do escopo governa os controles nativos (barra de rolagem, seletor
de data) dentro da página. A prévia do editor usa o MESMO modo — o organizador vê o
que o visitante verá.

### ADR-333 — Os grupos de eventos vêm das DATAS, no fuso da instituição, e o total é do SERVIÇO

**Contexto.** A vitrine da casa precisava mostrar o que vai acontecer, o que está
acontecendo e o que já aconteceu. Curadoria manual (o organizador escolhe o que
destacar) foi considerada e recusada pelo humano: seria uma tarefa a mais por evento
criado e uma lista que envelhece sozinha.

**Decisão.** `classifyTenantEvent` decide por INSTANTE: começa depois de agora →
`em breve`; a janela `[início, fim)` contém agora → `acontecendo`; terminou →
`antigo`. As bordas são explícitas: **evento que começa exatamente agora NÃO é "em
breve"** (no instante em que abriu, a vitrine diz que está acontecendo); **evento que
termina exatamente agora É antigo** (a janela é meio aberta no fim); **sem data vai
para "em breve"** (o evento existe e não há como dizer que passou). Cada grupo devolve
`items` (recortado por limite), `events` (completo) e `total`; o "ver todos" e o
número que ele anuncia saem do serviço.

**Justificativa.** A conta em instantes é correta em qualquer fuso e em qualquer
horário de verão — o fuso da instituição entra só na APRESENTAÇÃO (`formatZonedDateTime`,
a mesma função que a página do evento usa desde a F24). E o total do serviço impede a
segunda contagem divergir da primeira (F54).

**Consequências.** Cada grupo tem ordem própria, pela pergunta que responde: `em
breve` do próximo para o mais distante, `antigos` do mais recente para o mais antigo,
`acontecendo` por quem começou primeiro. O limite é por requisição (`?limite=`), com
teto de 24, e valor fora da faixa cai no padrão de 6 — nunca numa vitrine vazia nem
numa consulta que carrega o acervo inteiro.

---

## 5. Lições aprendidas (defeitos REAIS)

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Um evento **sem `startsAt`** (só com fim) caía em `antigo`, e um evento **sem `endsAt`** (começado agora) caía em `em breve` | A classificação calculava por um intervalo sintético (`fim ?? início`): o início virava o próprio fim. O teste de borda da fatia 1 pegou os DOIS casos antes da versão final | As bordas passaram a ser perguntas SEPARADAS e nesta ordem: "ainda não começou?" antes de "já terminou?" (ver o comentário em `classifyTenantEvent`) |
| 2 | O portão WCAG AA reprovou a página pública com **dois `<main>`** na tela | A primeira versão da fatia 2 deixava a PÁGINA escolher entre a vitrine e a listagem, e cada ramo desenhava o seu `<main>` — a casca deixou de ser landmark na F52, então a tela ficava com dois | A escolha passou para `TenantHome`, que desenha o `<main>` UMA vez e recebe o outro ramo por prop; quem chama não pode criar o segundo por acidente |
| 3 | Os papéis que a instituição NÃO escolheu saíam com a paleta do EVENTO: `--ef-background: oklch(… 265)` em vez de `oklch(… 230)` | `themeToCssVariables` cobre os papéis não escolhidos com `EVENT_THEME_PALETTE` (índigo `#4f46e5`) — correto para a página do evento, errado para a da instituição. O teste de unidade da fatia 4 pegou pela matiz | `buildTenantThemeScope` sobrescreve os papéis não escolhidos com `TENANT_THEME_PALETTE` do modo EFETIVO; a régua compartilhada não foi tocada (a catraca `f61-tema-do-evento` a prende) |
| 4 | **O cartão de evento desenhava o ícone do calendário com o texto VAZIO**, e o selo "Acontecendo agora" nunca aparecia | `groupTenantEvents` carimbava `periodLabel` e `isHappeningNow` só em `items` (o cartão mínimo do domínio). A tela desenha `events` — o objeto do chamador, que o próprio serviço declara ter o período preenchido (`PublicTenantEventCard.periodLabel`) e que chegava `''`. **Nenhum teste pegou**: a unidade afirma `items`, o E2E afirma títulos, e texto vazio não é violação de acessibilidade nem erro de tipo | `view()` passou a devolver `events` CARIMBADO (`{ ...event, ...toCard(...) }`), mantendo `items` como estava. Quem pegou foi a **catraca de regressão visual** — a única que mede a TELA |
| 5 | A largura do `<select>` de eventos do diretório de participantes (e tudo à sua direita) muda **+6 px** quando a data do evento da fixture muda de texto | O `<select>` dimensiona pela opção MAIS LARGA, e a opção imprime `título · data` — a data vinha de "hoje + 30 dias". Os algarismos não são tabulares, então "02/11/2026" e "10/03/2099" têm larguras diferentes (medido: `x=861 → 867` e `x=1080 → 1086`) | As janelas de data da fixture da F62 passaram a ser INSTANTES FIXOS (`2099` e `2000`). É ganho de determinismo para a suíte visual — a linha de base deixa de depender do dia em que foi gerada |
| 6 | Duas fatias (3 e 4) chegaram à árvore **sem relatório e sem nenhuma execução de teste** — o agente que as fez morreu no meio | Nenhuma barreira: o contrato de fases depende do agente RELATAR, e o relatório não veio. A árvore parecia pronta (o `tsc` passava, o `lint` passava) e nada tinha sido medido | A fatia 5 rodou a bateria inteira, achou o defeito nº 4 (que ninguém tinha medido) e **um spec temporário esquecido** na árvore (`tests/e2e/tmp-diag-contraste.spec.ts`, **commitado** na F63) e outro em disco (`tmp-captura-f64.mjs`). Ambos foram apagados |
| 7 | A paleta da instituição era **publicada e não pintava**: a cor computada do "Ver evento" era `#3525cd` no claro e `#a5b4fc` no escuro, mesmo com `#7b2ff7` publicado no escopo | O `globals.css` resolve os apelidos semânticos na RAIZ e o CSS substitui `var()` no elemento da declaração — o `--ef-primary` do descendente não re-resolve `--brand`. **Nenhum teste olhava a cor COMPUTADA**: a unidade media o mapa de variáveis e o E2E media o atributo `style`, então o campo morto atravessou unitário, integração e portão de acessibilidade | O escopo passou a publicar os apelidos de IDENTIDADE (`--brand`, `--primary`, `--ring`…), com o papel de TEXTO ajustado ao modo até 5:1; superfície e texto seguem do modo do visitante. Medição antes/depois na §8.2 e catraca de contraste no teste da fase |
| 8 | O editor ficava com **dois landmarks `<main>`** (o dele e o da prévia que embute a página pública), e o caso novo do portão reprovou com `Received: 2` | A prévia desenhava o `<main>` do `TenantPublicPage` — certo na página pública, errado aqui. A primeira correção foi **mexer na régua** (`checkVisibility()` no lugar da contagem), o que escondia o sintoma sem resolver a causa: `display: contents` tira a caixa, mas o nó continua na árvore de acessibilidade como região `main` em parte dos leitores | Conserto na CAUSA, como a fatia 2 já tinha feito: `TenantPublicPage` ganhou a prop `landmark` (`main` × `none`), a prévia virou um `<div>` e a régua do portão voltou a ser a ESTRITA (`page.locator('main')`) |

**O que as seis lições têm em comum:** em cinco delas, a régua CERTA existia e media a
coisa ERRADA. A unidade media `items` e a tela desenhava `events`; o E2E media títulos
e não períodos; a regressão visual da F62 media a barra lateral, o painel e o
diretório, e nenhuma tela nova. **Catraca que mede o irmão do alvo fica verde.** Foi
preciso acrescentar as duas telas novas ao portão e a linha de base da página para o
defeito nº 4 aparecer — e ele apareceu na PRIMEIRA imagem gerada.

---

## 6. Evidência de verificação

### 6.1 A bateria da §4 do `AGENTS.md`

```text
$ npm run lint
(0 erros, 0 warnings)

$ npm run typecheck
(0 erros)

$ npm test
 Test Files  165 passed (165)
      Tests  3105 passed (3105)
   Duration  354.75s

$ npm run build
 ✓ Compiled successfully in 14.3s
 ├ ƒ /t/[tenantSlug]/administracao/pagina      ← a rota nova listada

$ npm run db:verify
  ✓  Nenhuma tabela com RLS ficou sem policy
  ✓  Role "eventflow_app" sem superuser e sem BYPASSRLS
  ✓  GRANTs mínimos presentes, TRUNCATE ausente
  ✓  Tabela(s) de plataforma inalcançável(is) pela role "eventflow_app"
  Contrato íntegro.

$ npm run db:verify:isolation
  ✓  [A9] Role de runtime não conseguiu desligar a RLS nem escalar privilégio
  9/9 verificações passaram.
  Isolamento entre tenants garantido pelo banco.
```

### 6.2 A suíte E2E inteira

```text
$ npx playwright test --output=%TEMP%\pw-f64-e2e-full
```

```text
Running 317 tests using 1 worker
  316 passed, 1 skipped (7.8m)
```

O único vermelho da PRIMEIRA execução cheia foi `f51-credential-badge.spec.ts` ("trocar a
categoria de UM crachá não troca o código"): rodado **isolado**, o arquivo passa **7/7**
(`7 passed (20.1s)`) — é o vermelho falso de ambiente compartilhado que a casa já
conhece, e a regra da bateria manda medir isolado antes de tratá-lo como regressão.

### 6.3 Os casos da fase, isolados (antes da bateria cheia)

```text
$ npx playwright test tests/e2e/f64-editor-da-pagina.spec.ts tests/e2e/f64-pagina-da-instituicao.spec.ts
Running 13 tests using 1 worker
  13 passed (45.4s)

$ npx vitest run <os 6 arquivos f64>
 Test Files  6 passed (6)
      Tests  121 passed (121)
```

### 6.4 O portão WCAG AA com as telas novas

```text
$ npx playwright test tests/e2e/accessibility.spec.ts
Running 17 tests using 1 worker
  17 passed (52.4s)
```

**Sem isenção nova:** `ISENCOES` continua `[]`. A varredura da página da instituição
afirma o conteúdo da fixture ANTES de varrer (capa, título, os três grupos com um
evento cada, os blocos publicados e o controle de aparência no rodapé) — porque o
`axe` mede o que está no DOM, e "o grupo sumiu" não é violação de regra nenhuma.

**A régua do landmark é a ESTRITA, e o conserto foi na CAUSA — provado por medição.**
O caso novo do editor reprovou aqui com o número exato:

```text
  Landmarks <main> em editor da página da instituição: esperado exatamente 1
  Received: 2
```

Dois `<main>` na mesma tela: o do editor e o da prévia, que embute a página pública
inteira. A primeira reação foi perguntar ao navegador se o elemento produz caixa
(`checkVisibility()`) — **e era um falso conserto**: `display: contents` tira a caixa,
mas o nó continua na árvore de acessibilidade como região `main` em parte dos leitores,
e a página seguia com dois "conteúdo principal" para quem navega por leitor de tela.

A casa já tinha resolvido um defeito desse tipo pela CAUSA uma vez (fatia 2: o `<main>`
saiu do ramo do fallback, em vez de a catraca mudar). Aqui não foi diferente:
`TenantPublicPage` ganhou a prop `landmark` (`main` × `none`), a prévia passou a
desenhar um `<div>` — ela não é o conteúdo principal da tela do editor, é um pedaço do
formulário — e a régua voltou a ser `page.locator('main')`, a mesma pergunta estrita de
sempre. O que a prévia MOSTRA não mudou: mesmos filhos, mesmas classes, mesmo
`data-testid`.

A prova de que a régua MORDE é a medição acima: com a prévia de volta a `<main>` — ou
com a prop removida —, o caso reprova com 2. E ZERO continua pegando a tela sem o seu
conteúdo.

### 6.5 A regressão visual

```text
$ npx playwright test tests/e2e/f62-regressao-visual.spec.ts --update-snapshots
  16 passed (1.4m)
```

As **duas linhas de base novas** (`pagina-da-instituicao-claro` e
`-escuro`) foram geradas contra o container **reconstruído** com o código da árvore, e
a imagem mostra o período de cada evento escrito e o selo "Acontecendo agora" — os
dois campos que o defeito nº 4 deixava vazios.

As **sete linhas de base antigas** mudaram, e a mudança foi conferida pixel a pixel
contra as versões commitadas (`git show HEAD:…`) antes de ser aceita:

```text
barra-inteira-claro           3176 px dif  bbox x[24..148]   y[980..1108]  (288x1200)
barra-recolhida-claro          609 px dif  bbox x[28..43]    y[858..975]   (72x1200)
barra-recolhida-escuro         607 px dif  bbox x[28..43]    y[858..975]   (72x1200)
painel-desktop-claro          3320 px dif  bbox x[24..351]   y[165..1108]  (1440x1200)
painel-desktop-escuro         3363 px dif  bbox x[24..351]   y[165..1108]  (1440x1200)
participantes-desktop-claro  24061 px dif  bbox x[12..1306]  y[197..1108]  (1440x1200)
participantes-desktop-escuro 24131 px dif  bbox x[12..1306]  y[197..1108]  (1440x1200)
```

A mudança da barra recolhida é a mais fácil de ler porque a barra é quase toda ícone:
**64 linhas** de 1200 têm diferença, em **quatro faixas contíguas** — `858..874`,
`892..907`, `926..941`, `961..975` —, que são exatamente quatro linhas de ícone do
menu (as faixas de ícone medidas na linha de base nova são `859..872`, `894..905`,
`927..940`, `961..974`, com passo de ~33 px). Ou seja: **um item de menu a mais** no
grupo OPERAÇÃO ("Página pública", `tenant-nav.tsx`), e os quatro itens que vêm depois
dele desceram uma linha. O rodapé de conta (y ≥ 1043) não foi tocado, o conteúdo da
página não foi tocado, e a faixa de x é a coluna de ícone (28..43 de 72 px).

Nas telas de conteúdo há duas causas somadas, as duas declaradas:

1. o **item novo de menu** (a mesma faixa y[980..1108] da barra inteira);
2. no **painel**, o cartão "Eventos" passou de **1 para 2** — a fixture da F62 ganhou
   o evento antigo que a página da instituição precisa para ter conteúdo no grupo
   "Edições anteriores" (bbox até x=351);
3. no **diretório de participantes**, o deslocamento de **+6 px** da linha de filtros
   (defl. nº 5), que é o `<select>` dimensionando pela opção mais larga.

**As linhas de base foram regeradas DEPOIS de o container ser reconstruído**, e isso
não é retórica: a imagem `eventflow/web:local` é de **2026-10-03 10:50:25**; a única
mudança de `src/**` desta fatia é de **10:48:13** (`tenant-event-groups.ts`, o
conserto do defl. nº 4); e os nove arquivos de linha de base foram escritos entre
**10:52:20 e 10:53:29**. A execução anterior à reconstrução, com a mesma árvore, tinha
capturado o **período vazio** no mesmo teste — a diferença entre as duas execuções é o
conserto, o que prova ao mesmo tempo que o container estava velho ANTES e que a
regeneração mediu o código novo.

### 6.6 Uma linha de base só vale para este ambiente

Vale o que a F62 já documentou: renderização de fonte e de borda varia por sistema e
por imagem. As linhas de base nascem com o sufixo de plataforma
(`-chromium-win32.png`) e valem para ESTE host servindo ESTE código.

---

## 7. Comandos operacionais

```bash
# As telas novas
#   /t/<slug>                        a vitrine (visitante, sem sessão)
#   /t/<slug>/administracao/pagina   o editor (page:manage)

# Os casos da fase
npx vitest run tests/unit/f64-*.test.ts tests/integration/f64-*.test.ts
npx playwright test tests/e2e/f64-pagina-da-instituicao.spec.ts tests/e2e/f64-editor-da-pagina.spec.ts

# As duas catracas de interface
npx playwright test tests/e2e/accessibility.spec.ts
npx playwright test tests/e2e/f62-regressao-visual.spec.ts

# Atualizar a linha de base visual (ato CONSCIENTE: abra as imagens depois)
npx playwright test tests/e2e/f62-regressao-visual.spec.ts --update-snapshots

# O E2E exige o container com o código NOVO
docker compose --profile app up -d --build web worker
docker images --format "{{.Repository}}:{{.Tag}} {{.CreatedAt}}" | grep eventflow/web

# Onde a página mora, para inspeção
psql "$DATABASE_URL" -c 'SELECT "tenantId", title, "publishedAt" FROM tenant_public_pages'
```

---

## 8. Dívidas técnicas e pontos de atenção

### 8.1 A E84 fica quitada para a página da instituição — e continua aberta para a do evento

A dívida E84 é "o claro/escuro do visitante não vence a paleta do organizador". Nesta
página a decisão foi o contrário, de propósito (ADR-332): o modo é do VISITANTE,
porque a página vive dentro do casco da plataforma, onde o controle de aparência da
F63 está logo abaixo. A catraca `f63-aparencia-do-visitante.test.ts` continua valendo
(o controle não aparece na página do EVENTO). Para a página do evento a dívida
**segue aberta**.

### 8.2 RESOLVIDO — a paleta da instituição pinta a página (achado E conserto da fatia 5)

**O defeito, medido com a página publicada e `theme.primaryColor = '#7b2ff7'`** (um roxo
que não existe em paleta nenhuma do sistema):

```text
[ANTES · claro]  --ef-primary no escopo = "#7b2ff7"   "Ver evento" (text-brand) = rgb(53, 37, 205)  = #3525cd
[ANTES · escuro] --ef-primary no escopo = "#7b2ff7"   "Ver evento" (text-brand) = rgb(165, 180, 252) = #a5b4fc
```

O roxo era publicado e **não pintava pixel nenhum** — as duas cores acima são as da
RAIZ. O `globals.css` declara os apelidos semânticos na raiz (`--brand:
var(--ef-primary)`, `--primary: var(--ef-primary-container)`, …) e o CSS substitui
`var()` no elemento onde a declaração é feita: sobrescrever `--ef-primary` num
descendente **não** re-resolve `--brand`. A página do EVENTO não sofre disso porque os
componentes dela usam CSS próprio (`event-theme.css`, classe `ef-theme`) que lê `--ef-*`
direto; a da INSTITUIÇÃO foi montada com os tokens do sistema.

**O conserto.** `buildTenantThemeScope` passou a publicar os apelidos de IDENTIDADE que
a página lê — `--brand`, `--brand-foreground`, `--primary`, `--primary-foreground`,
`--primary-hover`, `--primary-soft` e `--ring`. Superfície (`--surface`, `--card`,
`--background`), texto (`--foreground`, `--muted-foreground`) e contorno (`--border`)
**não** entram: continuam vindo do modo do VISITANTE (ADR-332). O papel de TEXTO
(`--brand`) é o único ajustado por modo — clareado no escuro, escurecido no claro, o
mínimo para alcançar 5:1 —, porque não existe um tom que sirva às duas superfícies; o
PREENCHIMENTO guarda a cor escolhida (a marca não inverte) e o rótulo em cima dela é
escolhido por medição (`#ffffff` ou a tinta do modo, o que contrastar mais).

**A medição DEPOIS, com a mesma fixture:**

```text
[DEPOIS · claro]  --ef-primary = "#7b2ff7"   --brand = "#7b2ff7"   --primary = "#7b2ff7"
                  "Ver evento" = rgb(123, 47, 247) = #7b2ff7
                  fundo da página = rgb(249, 249, 255)   ← o modo do visitante, intacto
[DEPOIS · escuro] --ef-primary = "#7b2ff7"   --brand = "#9c63f9"   --primary = "#7b2ff7"
                  "Ver evento" = rgb(156, 99, 249) = #9c63f9
                  fundo da página = rgb(23, 24, 30)      ← o modo do visitante, intacto
```

O `#7b2ff7` pinta no claro; no escuro o MESMO tom é clareado para `#9c63f9`, o mínimo
para passar — medido **4,69:1** na superfície real da plataforma e 5,20:1 na superfície
da paleta da instituição, contra os 4,5:1 que o AA pede para texto pequeno. O
preenchimento é a cor escolhida nos DOIS modos, e o fundo da página não mudou em nenhum
deles.

**As catracas.** O portão WCAG AA segue **17/17 verde e SEM isenção** — e agora com a
paleta pintando: as três varreduras que tocam a página da instituição (a pública, a do
editor e a do editor em modo escuro) passam com o `--brand` ajustado. A regra nova tem
catraca própria em `tests/unit/f64-editor-e-tema-da-pagina.test.ts`: o contraste do
papel de TEXTO nas duas paletas da fase nos dois modos, os apelidos de SUPERFÍCIE e de
TEXTO **ausentes** do escopo (a linha que não pode ser cruzada), a escolha do rótulo por
medição e a conversão de `hex` e `oklch`. As **duas linhas de base** da página foram
regeradas depois do conserto, conscientemente — e **só elas mudaram**: as outras 14
continuam byte a byte iguais, o que prova que o escopo não vaza para fora da página da
instituição.
### 8.3 Pontos de atenção que ficam registrados

- **A linha de base do diretório de participantes é sensível ao TEXTO DA DATA do
  evento da fixture** (defl. nº 5). A F62 nasceu com esse acoplamento; esta fase o
  reduziu (datas fixas) mas não o eliminou para quem mexer na fixture no futuro.
- **`TEAM` e `SPONSORS` são oferecidos no editor e não desenham nada** na página da
  instituição (a leitura da equipe e do patrocínio dela ainda não existe). O editor
  diz isso na tela ("não aparece na página") em vez de oferecer um bloco que mente —
  é `TENANT_BLOCK_WITHOUT_RENDERER` ao lado de `HERO`.
- **O grupo "Acontecendo agora" não entra na linha de base visual da instituição**: a
  janela teria de conter o AGORA, e isso é relativo por definição (a linha de base
  mudaria a cada execução). O selo está coberto pela imagem do documento e pelo E2E.

---

## 9. Checklist de aceite

- [x] **`/t/<slug>` é a página publicada da instituição** quando ela publicou — capa,
      título, descrição, identidade e os blocos na ordem que o editor numerou.
- [x] **A instituição sem publicação continua servindo a listagem de eventos** (200,
      sem redirect, sem 404) — e o mesmo vale para quem publicou e tirou do ar.
- [x] **Os três grupos vêm das DATAS** (`em breve`, `acontecendo agora`, `edições
      anteriores`), no fuso da instituição, com limite por grupo e "ver todos" que
      anuncia o total do SERVIÇO.
- [x] **O histórico é automático**: o bloco lê os eventos do sistema na renderização e
      não guarda evento nenhum no conteúdo publicado.
- [x] **Um único `<main>` por tela** nas duas telas novas (catraca do portão WCAG AA).
- [x] **O visitante anônimo lê sem sessão** — provado pelo cookie ausente e pelo
      cabeçalho que oferece "Entrar".
- [x] **O organizador monta a página pela tela**: identidade, paleta, capa e logotipo
      por upload (WebP), blocos com ordem/visibilidade, prévia pelo MESMO componente
      da página, publicar e tirar do ar.
- [x] **Quem não tem `page:manage` não entra** no editor (redirect ao painel) e **nada
      é criado no banco** pela tentativa; o item do menu não aparece para quem não
      pode abrir a tela (menu e tela concordam nos dois sentidos).
- [x] **Rascunho × publicado são atos diferentes**: salvar não publica, tirar do ar
      não apaga o trabalho, e o editor diz se o que está no ar é o que foi editado.
- [x] **A paleta da instituição não mata o claro/escuro do visitante** (ADR-332) — a
      dívida **E84** fica quitada para esta página, e o modo do visitante segue mandando
      na superfície (medido: o fundo da página não muda).
- [x] **A paleta da instituição PINTA** os apelidos de identidade que a página lê (§8.2),
      com o papel de TEXTO ajustado ao modo até 5:1 nos dois modos.
- [x] **A prévia do editor não desenha um segundo `<main>`**: a tela tem UM landmark, e a
      régua do portão voltou a ser a estrita (§6.4).
- [x] **Runtime só por `withTenant`**, com a tabela nova sob **RLS + FORCE** e presente
      em `TENANT_SCOPED_TABLES` (verificado no contrato e no isolamento).
- [x] **Sem `any`**, `kebab-case.ts`, comentários explicando POR QUE, tudo em
      português; `lint` e `typecheck` em 0.
- [x] **As telas novas nas DUAS catracas de interface**: portão WCAG AA **sem isenção
      nova** (15 → 17 casos) e regressão visual nos dois modos (14 → 16 linhas de
      base).
- [x] **A suíte E2E inteira verde** e a bateria da §4 com os números reais neste
      documento.
- [x] **O defeito do período vazio foi consertado** (e a catraca visual que o pegou
      ficou no repositório).
- [x] **Nenhum spec temporário** na árvore (`tmp-diag-contraste.spec.ts`, da F63, e
      `tmp-captura-f64.mjs`, da F64, foram apagados) e nenhum diretório de artefato
      de teste sobrando com sufixo.

---

## Apêndice — o que a fase NÃO fez

- **Não** criou permissão nova: a página usa `page:manage`, a mesma da página do
  evento (montar a vitrine pública é UM ofício).
- **Não** copiou evento para dentro de bloco: o histórico é lido na renderização.
- **Não** deu ao editor a escolha de "modo" (claro/escuro): quem escolhe é o visitante.
- **Não** mexeu no `globals.css`, no `playwright.config.ts` nem em spec de outra fase
  (a única exceção autorizada foi a tabela de landmarks do `f60-landmark.spec.ts`, que
  ganhou `/t/<slug>` com a âncora do fallback).
- **Não** tocou no `globals.css` para a paleta pintar: o conserto ficou no domínio
  (`buildTenantThemeScope`), publicando os apelidos que a página lê — a medição de antes e
  depois está na §8.2.
