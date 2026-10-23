# FASE 75 — O refactor que mede antes

> **Estado: ENTREGUE.** Cinco fatias: a rede de caracterização, a unificação das
> guardas, a extração da leitura, o contexto resolvido uma vez e as páginas de erro
> (decisão 4 do humano). ADR-363 … 365.

---

## 1. Sumário Executivo

Esta fase nasceu de uma **revisão externa** que propôs três refactorings. A fase
aceitou os três na direção e **mediu antes de mover**: escreveu a rede de testes que
não existia, migrou o que a medição confirmou, extraiu o que era leitura e recusou o
que era esqueleto de tela. Os números que a revisão prometeu **não existem** — e o
documento entrega os medidos.

### O que foi entregue

| Fatia | Entrega | Números medidos |
|---|---|---|
| **1** | A rede antes do salto: o par **permitido × recusado** das 21 guardas locais + o catálogo que as inventaria | **66 casos** de caracterização (45 explícitos + 21 parametrizados) e **10** de catálogo |
| **2** | As guardas migradas para `guardAction`: **16** diretas + **1** traduzida (`registration`), com **4 exceções declaradas** e catraca | **−760 linhas líquidas** nos 17 arquivos (ações −814, `guard-action` +54); **21 → 4** guardas locais |
| **3** | A **leitura** extraída dos dois serviços, com a escrita (e as transações) no lugar | **−2.324 linhas líquidas** (raffle −1.857, inscription −467); 3 irmãos de leitura com 2.485 linhas |
| **4** | O contexto resolvido **uma vez** por render (a guarda devolve o que já leu) | **2 + 2 → 1 + 1** em 4 superfícies (3 páginas + o shell); ≈8 ms de trabalho removido por render |
| **5** | As **páginas de erro** por área (`error.tsx` / `not-found.tsx`): eram **0** no app | 6 arquivos de rota, 3 áreas, 1 catálogo de frases, **17** casos de unidade, **4** casos de E2E funcional e **4** no portão WCAG AA |

### Números da fase (medidos nesta árvore)

```text
Arquivos de teste novos ......... 7 (6 de unidade/integração + 1 spec E2E), e mais 4 casos
                                  no portão de acessibilidade (arquivo que já existia)
Casos novos (Vitest) ............ 114   (66 + 10 + 12 + 5 + 4 + 17)
Suíte Vitest .................... 227 arquivos · 4157 testes · 0 vermelhos
Casos novos (E2E) ............... 8     (4 funcionais + 4 no portão de acessibilidade)
Suíte E2E ....................... 417 no total: 414 passando + 2 pré-existentes + 1 skip
                                  (eram 409; os 2 vermelhos são os do f62, medidos na §6.10)
Linhas que SAÍRAM dos serviços .. 2.324 (leitura) + 760 (guardas)
Arquivos de rota novos .......... 6 (2 por área: error + not-found)
ADRs ............................ 363, 364 e 365 (a próxima é a 366)
Migrações ....................... nenhuma
```

### 1.1 Arquivos da fase

**Produção — guardas (fatia 2)**

```text
src/lib/auth/guard-action.ts .................. +54 linhas (vira o dono da checagem)
src/app/actions/*.ts .......................... 17 arquivos; −814 linhas no total
```

**Produção — leitura extraída (fatia 3)**

```text
src/lib/raffles/raffle-read-service.ts ........ 620 linhas (novo)
src/lib/raffles/raffle-public-view-service.ts . 1.339 linhas (novo)
src/lib/events/registration-read-service.ts ... 526 linhas (novo)
src/lib/raffles/raffle-service.ts ............. 3.653 → 1.796 linhas
src/lib/events/registration-service.ts ........ 3.410 → 2.943 linhas
```

**Produção — contexto (fatia 4)**

```text
src/lib/auth/guard-page.ts .................... a guarda devolve `context`
src/app/t/[tenantSlug]/(app)/layout.tsx ....... não chama `loadPrincipal` de novo
src/app/t/[tenantSlug]/(app)/{administracao,participantes}/page.tsx
src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/page.tsx
```

**Produção — páginas de erro (decisão 4)**

```text
src/domain/platform/error-pages.ts ............. as frases, por área (fonte única)
src/components/shell/area-error.tsx ............ o desenho do erro (client, com `reset`)
src/components/shell/area-not-found.tsx ........ o desenho do não encontrado (server)
src/lib/tenancy/tenant-slug-header.ts .......... o slug que o `not-found` não recebe
src/app/error.tsx · src/app/not-found.tsx ...... raiz/plataforma
src/app/t/[tenantSlug]/(app)/{error,not-found}.tsx ... casca autenticada
src/app/t/[tenantSlug]/(public)/{error,not-found}.tsx . área pública da instituição
```

**Testes**

```text
tests/integration/f75-guardas-caracterizacao.test.ts ... 66 casos (a rede da fatia 1)
tests/unit/f75-catalogo-de-guardas.test.ts ............. 10 casos (o inventário)
tests/unit/f75-servicos-fracionados.test.ts ............ 12 casos (catraca por AST)
tests/unit/f75-contexto-uma-vez.test.ts ................ 5 casos
tests/integration/f75-contexto-uma-vez.test.ts ......... 4 casos (contagem em execução)
tests/unit/f75-paginas-de-erro.test.ts ................. 17 casos (frase + estrutura)
tests/e2e/f75-paginas-de-erro.spec.ts .................. 4 casos (comportamento)
tests/e2e/accessibility.spec.ts ........................ +4 casos (portão WCAG AA)
```

---

## 2. O Problema Mais Difícil da Fase

**Como se prova que um refactor não mudou nada — antes de movê-lo.**

Uma fase de funcionalidade prova o que entrega: a tela nova aparece, o dado novo é
gravado, a recusa nova acontece. Um refactor não entrega nada: ele promete que o
comportamento de ontem continua igual. E "continua igual" não se lê no diff — o diff
mostra linhas que sumiram, não as decisões que sumiram junto.

A revisão externa que abriu a fase propôs três movimentos grandes com números
redondos ("17 guardas, −1.500 linhas"; "subserviços de regras puras"; "`loading.tsx`
melhora o TTI"). Nenhum dos três resistiu à medição — e é isso que define o desenho
da fase: **antes de mover, medir; antes de medir, prender**. O que a fase construiu
primeiro não foi código de produção: foi a rede.

| Proposta do revisor | O que ele disse | O que foi medido |
|---|---|---|
| Unificar as guardas | "17 `async function guard`; ~1.500 linhas a menos" | **21** guardas locais (não 17). As que chamam `can()` somam **872 linhas**; o universo real é **1.033**. Migraram **16** + **1 traduzida**, e saíram **760 linhas líquidas**. A redução de 1.500 **não existe** |
| Fracionar os dois serviços | "subserviços de regras puras + persistência" | As **regras já estavam no domínio** (`raffle-rules` 883 linhas, `draw-selection`, `pool-rules`, `round-rules`). O que restava para sair era **LEITURA**: **1.857** linhas do `raffle-service` e **467** do `registration-service` (**2.324**). A escrita **não sai**: ela divide **uma** transação |
| `loading.tsx` nas rotas de métricas | "melhora o Time to Interactive" | **Não melhora TTI** — `loading.tsx` muda PERCEPÇÃO, não tempo de execução. Nas rotas de **27–57 ms** medidas (§3.7), o esqueleto é um **flash** de um quadro. O ganho real de performance estava no **contexto duplicado**: **2 + 2 → 1 + 1** (≈8 ms) |

A lição que sobra: **o número do revisor não é o número do sistema**. Os três erros
têm a mesma forma — uma estimativa de leitura virou promessa, e a promessa seria
repetida em documento, em PR e no AGENTS.md. A fase trocou os três por medições, e
cada uma delas custou menos que a linha do tempo de uma migração cega.

**Por que isso define o desenho.** A fatia 1 não tem uma única linha de produção:
ela é 66 casos de caracterização e um catálogo. A fatia 2 não podia começar antes
disso, e a fatia 3 não podia começar antes de a fatia 2 estar verde sem tocar no
arquivo de caracterização. O refactor foi fatiado pela **ordem em que a prova fica
disponível**, e não pela ordem em que o código fica bonito.

---

## 3. Decisões Técnicas Explicadas

### 3.1 A rede antes do salto: 66 casos escritos contra o comportamento de HOJE

**19 das 21 guardas não tinham teste de comportamento** — só E2E de caminho feliz. A
fatia 1 escreveu, por guarda, o par `PERMITIDO × RECUSADO` (a recusa com o código da
casa), no padrão do `f74-posse-do-upload`.

O contrato é: **o arquivo de caracterização não pode ser editado pela fatia 2**. Se
as 66 asserções continuaram verdes sem uma linha mudar, a migração preservou o
comportamento; se uma delas precisou de ajuste, o que mudou foi o produto, não o
teste — e a conversa aconteceria antes do merge.

```text
tests/integration/f75-guardas-caracterizacao.test.ts
├── 45 casos explícitos (permitido/recusado por guarda, com o código da casa)
└── 21 casos parametrizados (`it.each`) — uma guarda sem sessão, todas devolvem
    NOT_AUTHENTICATED com a MESMA mensagem
```

O caso parametrizado é o que mais vale: ele prende a **mensagem** ("Sessão expirada.
Entre novamente.") em 21 guardas de uma vez. Um refactor que troque a mensagem de
uma delas reprova ali, e não três fases depois num E2E de caminho feliz.

**Resultado medido:** `66 passed` antes e depois da fatia 2, com **zero** alteração no
arquivo de caracterização.

### 3.2 O catálogo que morde: a guarda nova reprova com a instrução

O risco de um refactor de guardas não é apagar uma — é **criar a próxima cópia**:
alguém precisa de um caso ligeiramente diferente, escreve mais uma `async function
guard`, e a duplicação volta pela porta dos fundos, agora com a bênção de "já foi
refatorado".

`tests/unit/f75-catalogo-de-guardas.test.ts` lê a árvore de `src/app/actions`, extrai
as guardas que existem de fato (janela do `async function` até a chave que fecha o
CORPO, não o primeiro `\n}`) e compara com a lista esperada, **exigindo igualdade
exata**. A mensagem de falha é o produto:

```text
Guarda(s) nova(s) fora do catálogo: demand-actions.ts::guardX.
Se for uma exceção declarada, acrescente-a à lista com o MOTIVO;
se não for, use `guardAction` em vez de escrever mais uma cópia.
```

O catálogo também prende, arquivo por arquivo, que as **17 portas** migradas
continuam chamando `guardAction` e continuam pedindo **a mesma permissão** — "migrar
não pode trocar a porta". E guarda que **sumiu** também reprova: a lista é contrato,
e migrar exige atualizá-la de propósito, com o motivo escrito.

**As 4 exceções, com o motivo no código** (a lista é a exceção explícita):

| Guarda | Por que não cabe em `guardAction` |
|---|---|
| `sponsor-portal-actions.guardAuthenticated` | **Sem permissão**: sessão + instituição, e nenhum vínculo — o aceite do convite é que cria o vínculo |
| `sponsor-portal-actions.guardSession` | **Sem permissão**: sessão + vínculo ATIVO; a posse é o `userId` da sessão |
| `speaker-actions.speakerGuard` | `holdsPermission` **sem alvo** — o papel é concedido por ATIVIDADE, e `can` com escopo TENANT recusaria o caso normal |
| `demand-actions.guard` | **OU de permissões** (`demand:assign` × `demand:assign:own-team`), com `viaAlternate` decidindo o caminho no serviço |

### 3.3 A catraca por AST do `tx` — e por que proibir o token `tx.` seria impossível

`tests/unit/f75-servicos-fracionados.test.ts` lê as funções **pelo parser do
TypeScript**, não por regex. O motivo é concreto: as consultas usam template literal
(`` `${...}` ``) e uma regex sobre o texto erraria o alvo — "catraca que erra o alvo
reprova por motivo errado".

Quatro regras, todas sobre o **corpo** da função (nunca sobre o arquivo, onde os
comentários citam `recordAudit` e `$transaction` para explicar por que eles **não**
estão ali):

1. as funções de ESCRITA não saem do arquivo original (lista explícita, com o motivo
   de cada uma que "parece leitura");
2. toda função que recebe `tx: TxClient` **não** pode abrir `withTenant(`/`$transaction`
   própria — a transação é do chamador;
3. as leituras extraídas não escrevem: sem `recordAudit`, sem `$transaction`, sem
   SQL cru, sem **verbo de escrita** em `tx.<modelo>`;
4. o grafo de importação tem direção única: leitura não importa escrita (ciclo de
   importação é a armadilha que o cabeçalho evita).

**Por que a regra 3 não proíbe `tx.`:** toda leitura sob RLS consulta por
`tx.raffle.findFirst`, `tx.registration.findMany`, `tx.userTenantProfile.findMany`.
Proibir o token `tx.` proibiria a leitura inteira — a catraca reprovaria o próprio
alvo. O que se proíbe é o **verbo**:

```text
tx.<modelo>.create | createMany | update | updateMany | upsert | delete | deleteMany
$transaction | $executeRaw | $executeRawUnsafe | recordAudit
```

Essa é a diferença entre "leitura não escreve" como intenção e como regra.

### 3.4 Mover LEITURA, não fronteira: o que ficou porque valida a escrita

A extração foi mecânica e conservadora: saiu o que **consulta**, ficou o que
**decide com o dado recém-escrito dentro da mesma transação**.

Ficaram no serviço de escrita, de propósito:

```text
raffle ......... createRaffle · prepareRound · drawRound · drawRaffle
                 updateRoundAnnouncement · markPrizeDelivered · reversePrizeDelivery
                 setRaffleVisibility · setBigscreenVisibility · cancelRaffle
inscrição ...... attemptRegistration · tryReserveSeat · admitToEventRegistration
                 cancelRegistration · updateEventRegistrationData
                 syncOpenActivityEnrollments · acceptPromotion
```

`cancelRegistration` é a que mais engana: parece "uma leitura com status". Ela libera
a vaga, decrementa o contador e **promove o próximo na MESMA transação** (ADR-175/178).
Separar a promoção da liberação abriria a janela em que a vaga está livre e o próximo
não foi promovido — o defeito exato que a F34 fechou.

**E ficaram DOIS leitores no serviço de escrita, porque eles VALIDAM a escrita** (e
não são leitura no sentido da fatia):

- `loadAttendances` / `loadPriorWinnerIds` — a apuração precisa do universo de
  elegíveis **congelado dentro da transação** que grava o resultado. Se a leitura
  fosse de fora, o sorteio poderia publicar um ganhador que não estava mais elegível
  no instante do `INSERT`;
- `assertActivityOwnership` (no mundo das guardas, mesma ideia) — não autoriza a
  pessoa; confere posse de ALVO.

O critério não é "esta função só lê?", é **"esta função participa da decisão de
escrita?"**. As duas últimas entram na catraca como leitura exportada (a regra 3 vale
para elas) e continuam no arquivo de escrita.

### 3.5 Os "puros" que ficaram — movê-los inverteria a dependência

A proposta de "subserviços de regras puras" ignorou que **as regras já estavam no
domínio**: `raffle-rules.ts` (883 linhas), `draw-selection.ts` (204), `pool-rules.ts`
(211), `round-rules.ts` (179). O que sobra nos serviços como função pura é, em
grande parte, **adaptador**: normaliza o que veio do banco para a forma que a regra
pura espera.

Mover esse resto para o domínio parece organização e é o contrário: o domínio passaria
a depender da forma do registro do ORM (o `TxClient`, os `select`, os tipos gerados),
e a invariante nº 1 do projeto — **domínio puro, sem Prisma e sem Next** — cairia. A
dependência hoje aponta numa direção: `lib → domain`. Movê-los apontaria
`domain → lib`.

**Números, com o critério dito:** contando nós de função que não tocam `tx.`,
`prisma.`, `withTenant(`, `$transaction` nem `await`, os cinco arquivos têm **91**
funções "puras" e **173** nós de função no total (em HEAD, os dois serviços tinham
68 + 23 = 91 puras de 173). A fatia 3 registrou **183** com um critério mais largo
(incluindo tabelas e constantes exportadas). A diferença é de CRITÉRIO, e é ela que a
lição ensina: **contar "puro" é fácil; contar "puro que DEVERIA morar no domínio"
exige olhar a dependência** — e é aí que a resposta muda.

### 3.6 O contexto duplicado: 2 + 2 → 1 + 1 (o ganho real de performance)

`getRequestContext` **não é memoizado**, e as três telas de gestão chamavam
`requirePagePermission` **e** `getRequestContext`. A guarda já resolve sessão →
vínculos → principal para decidir a permissão; a página pagava **a mesma leitura
outra vez** só para ler `principal`:

```text
antes (por render):  loadMemberships ×2  +  loadPrincipal ×2  (2 transações RLS)
depois (por render): loadMemberships ×1  +  loadPrincipal ×1
```

Superfícies medidas (contagem em execução, não leitura de código —
`tests/integration/f75-contexto-uma-vez.test.ts`, `toBe(1)` e não `toBeLessThan(2)`):

| Superfície | `memberships` | `principal` | `getSession` |
|---|---|---|---|
| `/t/<slug>/administracao` | 1 | 1 | 1 |
| `/t/<slug>/administracao/eventos/<id>` | 1 | 1 | 1 |
| `/t/<slug>/participantes` | 1 | 1 | 1 |
| o shell do layout `(app)` | 1 | 1 | 1 |

**A decisão foi "a guarda devolve o contexto", não "`cache()` na sessão".** Memoizar a
sessão por requisição é a solução óbvia e contraria a lição da F74: ler o cookie sem
revalidar o vínculo dá a resposta errada quando a pessoa perde o acesso no meio do
caminho. Devolver o contexto mantém **cada chamada relendo e revalidando** — o que
deixa de existir é a SEGUNDA leitura **dentro do mesmo render**, que não tinha como
discordar da primeira.

**E o ganho em HTTP é ruído** — medido nesta árvore, 10 requisições por rota, contra o
container de produção:

| Rota | mín | mediana | máx | dispersão (máx−mín) |
|---|---|---|---|---|
| `/t/<slug>/administracao` | 35 ms | 40 ms | 103 ms | **68 ms** |
| `/t/<slug>/administracao/eventos` | 27 ms | 38 ms | 54 ms | **27 ms** |
| `/t/<slug>/participantes` | 28 ms | 36 ms | 61 ms | **33 ms** |
| `/t/<slug>/dashboard` | 23 ms | 26 ms | 47 ms | 24 ms |

A dispersão de uma rota (27–68 ms) é **maior que o ≈8 ms removidos**: é por isso que
a fase diz que a diferença em HTTP é ruído, e que o ganho é de **trabalho por render**
(duas leituras que atravessam tenants e uma transação RLS a menos), não de relógio de
parede. Quem quiser relógio precisa de uma medição com a rota isolada e N grande; o
número de 8 ms veio do instrumento da fatia 4, e a tabela acima é a razão de ele
**não** aparecer no HTTP.

### 3.7 O "de propósito" no lugar errado — e o motivo melhor que apareceu

O plano da fase mandava "ler o motivo de o contexto não ser `cache()` (há um *de
propósito* em `session.ts:300`)". O comentário existe, e o que ele diz é:

```text
getPlatformContext:
  "Não usa `cache()` do React de propósito: este módulo também roda no worker,
   fora do Next.js — a mesma razão documentada no cliente de banco."
```

Ou seja: **o comentário era do contexto de PLATAFORMA, não do contexto da
requisição**. `getRequestContext` nunca declarou por que não memoiza — o custo
dobrado não estava defendido em lugar nenhum, estava apenas não percebido.

Lido o comentário errado, a decisão poderia ter sido "então usa `cache()`, o motivo
não se aplica". A decisão certa apareceu ao olhar a **F74**: a sessão é revalidada
contra o banco em toda chamada de propósito (perder o vínculo precisa valer na
requisição seguinte), e um cache por requisição só é seguro quando a chave é a
requisição — que é exatamente o que a guarda devolvendo o contexto já garante, sem
cache nenhum. **O "de propósito" estava no lugar errado; o motivo melhor estava na
fase anterior.**

### 3.8 As páginas de erro: o recorte, a frase e o `reset`

O app tinha **0 `error.tsx` e 0 `not-found.tsx`** (só o `global-error.tsx`, que
desenha sem o CSS do app e existe por causa de um bug de prerender do Next 16.3.5).
Consequências reais, medidas no levantamento:

- **26 chamadas de `notFound()` em 20 arquivos** na casca autenticada;
- **35 em 18 arquivos** na área pública da instituição;
- **3** na plataforma (`/superadmin/tenants/<id>`, `/instituicao-bloqueada`).

Todas caíam na página padrão do Next — *"This page could not be found."*, em inglês,
sem a identidade da instituição e sem caminho de volta.

**O recorte: uma página por ÁREA, não por tela.** As três áreas são as três cascas que
existem, e o que muda entre elas é o **caminho de volta**:

| Área | Onde mora | Primeiro caminho de volta |
|---|---|---|
| `app` | `(app)/error.tsx` · `(app)/not-found.tsx` | `/t/<slug>/dashboard` (o painel) |
| `public` | `(public)/error.tsx` · `(public)/not-found.tsx` | `/t/<slug>/eventos` (a vitrine) |
| `platform` | `error.tsx` · `not-found.tsx` (raiz) | `/` (a página inicial) |

Um par por página seriam dezenas de arquivos com a **mesma frase**; um par só na raiz
daria o painel a quem estava na vitrine, e a página inicial a quem estava trabalhando.
Seis arquivos de rota, **um** catálogo de frases e ** dois ** componentes de desenho.

**A frase é domínio** (`src/domain/platform/error-pages.ts`), e o teste lê a tabela:

- **o 404 é uniforme** — "não existe", "foi removido" e "não está disponível para
  você" aparecem **juntos**, sempre, nas três áreas. Separar as hipóteses faria a
  página responder, pelo texto, a pergunta que o servidor recusou a responder (a
  mesma régua do `NOT_OWNER` da F74);
- **o erro não culpa a pessoa e não vaza detalhe técnico** — "A falha foi do nosso
  lado, não sua, e já foi registrada". Nada de `error.message`, `stack` ou `digest` na
  tela; o `console.error` do boundary continua com os três (é lá que eles servem);
- **a tabela não tem campo para mensagem técnica** — o teste compara as CHAVES do
  objeto; acrescentar `details`/`message`/`digest` reprova antes de alguém ligá-lo no
  JSX.

**`error.tsx` é client component, e isso é a entrega.** Só um client component recebe
o `reset` do boundary — e o `reset` remonta o segmento e refaz a renderização **no
servidor**. O botão "Tentar de novo" é um `onClick={reset}` de verdade (o E2E clica e
confere que a tela continua sendo a de erro, porque a falha persiste), e ao lado dele
há sempre um caminho de saída.

**O `not-found.tsx` não recebe `params`.** Conferido no código do framework: o Next
renderiza o `not-found` como `createElement(Component, null)`. Por isso o slug vem do
header `x-ef-tenant-slug` que o Proxy já injeta em toda navegação — a MESMA resolução
que o layout usou para validar o vínculo. O nome do header é literal em
`tenant-slug-header.ts` (importar `TENANT_HEADERS` de `src/proxy.ts` arrastaria o Proxy
inteiro para dentro de uma página) e **está preso por teste**: se o Proxy mudar, o
catálogo reprova — em vez de a página montar `/t/null/dashboard`.

**Um `<main>` por tela.** A casca não é landmark desde a F52, então o `<main>` é o do
componente compartilhado e os seis arquivos de rota **não** desenham um segundo — há
um caso de unidade para isso (`o landmark mora no componente compartilhado, e só nele`)
e o portão de acessibilidade reprova com `Received: 2` se a casca ganhar o seu.

**O que NÃO entrou: o `loading.tsx`.** A proposta 3 pedia esqueleto nas rotas de
métricas. Nas rotas de **27–57 ms** medidas, o esqueleto é um flash; e `loading.tsx`
não muda TTI (muda percepção). O plano admitia a fatia 5 "só onde houver espera
medida" — não havia. Fica registrado como **não feito por medição**, e não por falta
de tempo.

---

## 4. Registro de Decisões de Arquitetura (ADRs)

### ADR-363 — A guarda devolve o contexto que já resolveu: "uma leitura, duas necessidades" sem `cache()`

**Contexto.** `requirePagePermission` resolve o contexto inteiro (sessão → vínculos →
principal) para decidir a permissão. As três telas de gestão chamavam a guarda **e**
`getRequestContext()`, pagando duas vezes `loadMemberships` (consulta administrativa
que atravessa tenants) e `loadPrincipal` (transação sob RLS). O plan da fase pedia
para ler o "de propósito" de `session.ts:300` e **fazer a guarda devolver o contexto**
— sem cache novo se o motivo do comentário fosse bom.

**Decisão.** A guarda passou a devolver `context: RequestContext` além de
`tenantId`/`tenantName`/`userId`/`principal`. As páginas e o layout `(app)` leem
`context.user`/`context.memberships` dali. **Não** se memoizou a sessão.

**Justificativa.**

- O "de propósito" de `session.ts:300` era do **`getPlatformContext`** (módulo que roda
  no worker, fora do Next) — não do contexto da requisição. O contexto da requisição
  nunca teve defesa escrita; o custo dobrado não era decisão, era desconhecimento.
- `cache()` por requisição **pioraria** a segurança relativa da F74: a sessão é
  revalidada contra o banco em toda chamada **de propósito** (quem perde o vínculo
  precisa perdê-lo na requisição seguinte). A chave do cache seria a requisição — que
  é exatamente o que "a guarda devolve o que leu" oferece, sem inventar cache.
- A segunda leitura era **indenfensável**: mesma sessão, mesmo cookie, mesmos
  vínculos, **mesmo render**. Não havia como discordar da primeira.

**Consequências.**

- ✔ 4 superfícies medidas em `1 + 1` (eram `2 + 2`), com `toBe(1)` como contrato.
- ✔ O ganho é de trabalho por render (≈8 ms), **não** de relógio de parede: a
  dispersão de HTTP (27–68 ms) engole o delta (§3.6).
- ⚠ O `context` devolvido **ainda não tem consumidor** em todas as páginas: as que
  não precisam dele ignoram o campo. É dívida declarada (§8), não bug.
- ⚠ Quem chamar a guarda **e** `getRequestContext` de novo paga a segunda leitura: a
  catraca prende a contagem nas quatro superfícies medidas, não no resto da árvore.

### ADR-364 — Mover a LEITURA, não a fronteira: dois irmãos por serviço e a escrita na mesma transação

**Contexto.** A revisão propôs "subserviços de regras puras + persistência" para o
`raffle-service` (3.653 linhas) e o `registration-service` (3.410). A medição mostrou
que **as regras já estão no domínio** (`raffle-rules` 883, `draw-selection` 204,
`pool-rules` 211, `round-rules` 179) e que o que sobra é **leitura**.

**Decisão.** Extrair **apenas leitura e helpers puros**, no precedente de
`registration-response-service.ts` (F70):

- `raffle-read-service.ts` (620) — listas, estados de palco/SSE, auditoria, prévias;
- `raffle-public-view-service.ts` (1.339) — a projeção pública do sorteio;
- `registration-read-service.ts` (526) — "minhas inscrições", contadores, fila.

**A escrita fica onde está**, porque compartilha **uma** transação: `createRaffle`,
`prepareRound`, `drawRound`, `drawRaffle`, `markPrizeDelivered`/reverse,
`cancelRaffle`; `attemptRegistration`, `tryReserveSeat` (SAVEPOINT **dentro** do `tx`
do chamador), `admitToEventRegistration`, `cancelRegistration` (status + contador +
promoção na MESMA transação — ADR-175/178), `updateEventRegistrationData`,
`syncOpenActivityEnrollments`, `acceptPromotion`, e os
`promoteNextFrom*`/`reindexWaitlist`/`enrollEventRegistrationInOpenActivities`, que
**recebem `tx`**.

**Justificativa.**

- Decompor por **pureza**, nunca por tamanho de arquivo — e **jamais** separar o que
  divide uma transação.
- `cancelRegistration` é o caso que engana: separar a promoção da liberação abre a
  janela "vaga livre, próximo não promovido" que a F34 fechou.
- Dois leitores ficaram no serviço de escrita porque **validam a escrita**
  (`loadAttendances`/`loadPriorWinnerIds` congelam o universo elegível dentro da
  transação da apuração).

**Consequências.**

- ✔ −2.324 linhas líquidas nos dois serviços; o arquivo que se lê por vez caiu de
  3.653/3.410 para 1.796/2.943.
- ✔ 242 testes de vizinhança verdes (raffle, inscrição, palco, auditoria, E2E de
  sorteio) sem tocar nos arquivos de teste além do import.
- ⚠ A árvore **cresceu 161 linhas** (2.485 nos irmãos contra 2.324 removidas): o
  ganho não é tamanho, é legibilidade. Cabeçalho e imports de cada lado custam.
- ⚠ `RaffleErrorCode`/`RaffleResult` **moram no irmão de leitura** (é lá que os
  primeiros consumidores ficaram) e são importados pelo serviço de escrita. Mover os
  tipos para um `raffle-types.ts` seria mais limpo e não foi feito (§8).

### ADR-365 — A página de erro por ÁREA: a frase no domínio, o `<main>` na tela e o `reset` que é de verdade

**Contexto.** O app tinha **0 `error.tsx` e 0 `not-found.tsx`**. Um erro de rota subia
para o `global-error.tsx` (que desenha sem o CSS do app) e todo `notFound()` caía na
página padrão do Next, em inglês, sem identidade e sem saída. O levantamento contou
**64 chamadas de `notFound()`** (26 na casca autenticada, 35 na pública, 3 na
plataforma).

**Decisão.** Um par `error.tsx`/`not-found.tsx` **por área** — `(app)`, `(public)` e
raiz/plataforma — com:

- **as frases no domínio** (`error-pages.ts`), uma vez por área, com o 404 **uniforme**
  e a tabela **sem campo** para mensagem técnica;
- **dois componentes** de desenho (`area-error.tsx` client, `area-not-found.tsx`
  server), que são o **único** lugar com `<main>`;
- **seis arquivos de rota** finos, que delegam e não escrevem frase.

**Justificativa.**

- A área muda o **caminho de volta**, não o que aconteceu: repetir a tela por página
  criaria quatro redações da mesma ideia, nenhuma testável.
- `error.tsx` **tem de ser client** para receber o `reset` — que remonta o segmento e
  refaz a renderização no servidor; um "recarregar a página" perde o estado e não é a
  mesma coisa.
- `not-found.tsx` **não recebe `params`**: o slug vem do header do Proxy, com o
  literal preso por teste.
- O 404 uniforme é decisão de segurança da casa, não de redação: num multi-tenant,
  "isto não existe" para recurso privado é oráculo.

**Consequências.**

- ✔ As três áreas têm página própria, e o portão WCAG AA mede as duas superfícies
  (não encontrado na área pública e na raiz; não encontrado e erro no painel).
- ✔ `notFound()` e erro deixam de ser uma tela sem saída: sempre há "tentar de novo"
  (no erro) e um caminho de volta nomeado por área.
- ⚠ O `rest` do `not-found` na casca autenticada continua **exigindo sessão e
  vínculo** (roda dentro do layout `(app)`) — correto, mas significa que o 404 do
  painel não é observável por quem não está logado.
- ⚠ O caso de E2E da página de erro depende de um **500 real** (§6.10): se a rota
  passar a validar o id, o caso pula com a mensagem em vez de mentir.

---

## 5. Lições Aprendidas

### 5.1 As lições, com a evidência de cada uma

| Lição | A evidência |
|---|---|
| **A rede antes do salto** | Os **66** casos de caracterização ficaram verdes na fatia 2 **sem uma linha mudar** no arquivo de caracterização. É a prova de que a migração não mudou comportamento — e não uma afirmação no PR |
| **O catálogo que morde** | A guarda nova reprova com a instrução na mensagem ("use `guardAction` em vez de escrever mais uma cópia"), e a guarda que **sumiu** também reprova (a lista é contrato) |
| **A catraca por AST do `tx`** | Proibir o token `tx.` seria impossível: **toda** leitura sob RLS consulta por `tx.<modelo>.find*`. O que se proíbe é o verbo de escrita e o furo de transação — lido do **corpo** da função, não do arquivo (os comentários citam `recordAudit` de propósito) |
| **Mover LEITURA, não fronteira** | A escrita ficou porque divide **uma** transação; `cancelRegistration` (status + contador + promoção) é o caso que engana. Dois leitores ficaram porque **validam** a escrita |
| **Os "puros" que ficaram** | As regras já estavam no domínio (883 + 204 + 211 + 179 linhas); mover o resto inverteria `lib → domain` para `domain → lib` e quebraria a invariante nº 1 |
| **O "de propósito" no lugar errado** | O comentário do `cache()` era do `getPlatformContext` (worker), não do `getRequestContext`; o motivo melhor para deixar o `cache()` de fora veio da F74 (revalidar o vínculo em toda chamada) |
| **A tela não se prova no fonte** | A catraca de unidade lê a frase e a estrutura; quem prova que a página **aparece** é o E2E (4 casos funcionais + 4 no portão), e o caso do erro **mede o status** antes de cobrar a tela |

### 5.2 Defeitos REAIS encontrados pelos testes

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `it.each` de guarda sem sessão passou a devolver mensagem diferente em **uma** guarda, na migração | A guarda traduzida (`registration`) **lança** para quem não pode e devolve `null` para quem precisa entrar — contrato diferente de `guardAction` | Wrapper de tradução (`requireRegistrationActor`) preservando os dois caminhos, em vez de forçar a guarda no molde |
| A catraca do catálogo reprovou a lista **antes** de a fatia 2 terminar (`sumidas`) | A lista é o contrato: migrar exige atualizar a lista **de propósito**, com o motivo | A lista foi reduzida de 21 para 5 entradas, com a nota de cada exceção |
| O `not-found` respondia **sem o slug** e a saída caía na página inicial | `not-found.tsx` **não recebe `params`** (o Next o renderiza como `createElement(Component, null)`) | Header `x-ef-tenant-slug` (já injetado pelo Proxy) + literal preso por teste contra `src/proxy.ts` |
| O E2E do erro não tinha como acionar a tela | Não existe rota feita para falhar — e inventar uma seria medir o teste | O caminho honesto que existe: **id malformado → 500** (armadilha 25). O caso confere o status antes de cobrar a página |
| `axe` reprovava a página de erro com **dois** `<main>` na primeira versão | O `<main>` foi desenhado no arquivo de rota **e** no componente | O landmark ficou só no componente compartilhado, e há catraca de unidade para isso |

### 5.3 O que NÃO foi medido

- **A diferença de HTTP do contexto único.** A tabela da §3.6 mostra a dispersão
  (27–68 ms) — ela é maior que o ≈8 ms removidos. Não há medição com a rota isolada e
  N grande que separe o delta do ruído, e a fase **não** afirma ganho de relógio.
- **O TTI do `loading.tsx`.** Não foi medido porque não foi implementado: a decisão de
  não implementar veio da faixa de 27–57 ms, não de uma medição de TTI.
- **A página de erro em produção sob carga real.** O caminho foi exercitado contra o
  container (500 → boundary → página), não sob concorrência.

---

## 6. Evidência de Verificação

### 6.1 `npm run lint`

```text
0 erros, 0 warnings
```

### 6.2 `npm run typecheck`

```text
0 erros
```

### 6.3 `npm test` — a suíte Vitest inteira

```text
 Test Files  227 passed (227)
      Tests  4157 passed (4157)
   Duration  192.04s
```

Os arquivos da fase, com a contagem por arquivo:

```text
 ✓ tests/integration/f75-guardas-caracterizacao.test.ts (66 tests)
 ✓ tests/unit/f75-catalogo-de-guardas.test.ts (10 tests)
 ✓ tests/unit/f75-servicos-fracionados.test.ts (12 tests)
 ✓ tests/unit/f75-contexto-uma-vez.test.ts (5 tests)
 ✓ tests/integration/f75-contexto-uma-vez.test.ts (4 tests)
 ✓ tests/unit/f75-paginas-de-erro.test.ts (17 tests)
```

### 6.4 `npm run build`

```text
✓ Compiled successfully in 22.0s
Route (app) … ƒ /_not-found …
```

As páginas novas aparecem como `ƒ (Dynamic)` — todas as rotas do projeto já são
dinâmicas (o layout raiz lê o cookie de tema).

### 6.5 `npm run db:verify`

```text
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
  audit_logs_2029_05                  0     0.08 MB
  audit_logs_default                  0     0.09 MB

  total: 104496 linha(s)

  A retenção continua sendo decisão de negócio: esta manutenção CRIA e mantém,
  e nunca apaga. Apagar é `DROP TABLE audit_logs_<AAAA_MM>` (dívida B8).
```

As partições do mês atual e dos seguintes existem — a rotina **cria e mantém**, nunca
apaga. A fase não tem migração: as tabelas e as policies são as mesmas de antes.

### 6.8 O container — a imagem é a nova

```text
 Image eventflow/web:local Built
 Image eventflow/worker:local Built
 Container eventflow-web Started
 Container eventflow-worker Started
```

Data da imagem, conferida **depois** do build:

```text
eventflow/web:local ....... 2026-10-23T00:23:29.81639031Z
eventflow/worker:local .... 2026-10-23T00:23:45.51998773Z
```

(os dois em **22/10/2026, 21:23** em `America/Sao_Paulo` — o carimbo em UTC já caiu
no dia seguinte.) O build **não** falhou por DNS e as rotas novas respondem — `/t/<slug>/eventos/<inexistente>` responde **404** com a página
nova, e não com a do framework.

### 6.9 E2E — a suíte inteira

```text
  2 failed
    [chromium] › tests/e2e/f62-regressao-visual.spec.ts:1969:3 › rodapé público da plataforma › 13. o rodapé público da raiz no claro
    [chromium] › tests/e2e/f62-regressao-visual.spec.ts:1982:3 › rodapé público da plataforma › 14. o rodapé público da raiz no escuro
  1 skipped
  414 passed (11.8m)
```

**417 casos no total** (`npx playwright test --list` → `417 tests in 85 files`): 414
passando + os 2 vermelhos PRÉ-EXISTENTES + 1 skip. A fase acrescentou **8** (4
funcionais em `f75-paginas-de-erro.spec.ts` e 4 no portão de acessibilidade); o
total medido nesta árvore antes dela era **409**.

**Nenhum outro vermelho.** O `f65` ("Acontecendo agora", intermitente na virada do
minuto) **não** reprovou nesta execução, e o `peer-review` que a F74 havia
reapontado segue verde.

### 6.10 O `f62` (regressão visual), medido isolado

Rodado **sozinho**, como a fase exige (o aditamento da vitrine logada da F74 tinha
deixado a suíte visual fora da bateria):

```text
  2 failed
    [chromium] › tests/e2e/f62-regressao-visual.spec.ts:1969:3 › rodapé público da plataforma › 13. o rodapé público da raiz no claro
    [chromium] › tests/e2e/f62-regressao-visual.spec.ts:1982:3 › rodapé público da plataforma › 14. o rodapé público da raiz no escuro
  21 passed (48.2s)
```

Os dois números, **iguais** nas duas execuções (isolada e dentro da suíte):

```text
13. rodapé público da raiz no claro
    Expected an image 1440px by 3262px, received 1440px by 3334px.
    233049 pixels (ratio 0.05 of all image pixels) are different.

14. rodapé público da raiz no escuro
    Expected an image 1440px by 3262px, received 1440px by 3334px.
    820021 pixels (ratio 0.18 of all image pixels) are different.
```

**Diagnóstico:** a página mede **lista e métricas dinâmicas** — a altura muda com o
conteúdo do momento (3334 px recebidos contra 3262 px de linha de base) e a
diferença de pixels acompanha. **Não é regressão da F75**: a fase não tocou a raiz
pública, nem `globals.css`, nem `playwright.config.ts`; e os dois vermelhos já
estavam registrados na F74 com a mesma ordem de grandeza (233.106 px / 5% no claro e
820.069 px / 18% no escuro — a diferença de dezenas de pixels entre as duas
medições é o próprio conteúdo que muda). As outras **21** linhas de base passaram
sem um pixel de diferença, incluindo as telas que a fase poderia ter mexido (painel,
diretório de participantes, página da instituição).

**E as páginas de erro não entram no `f62`:** são telas sem dado dinâmico, mas o
desenho delas está preso por outro caminho — o portão de acessibilidade mede as
quatro superfícies e o `f75-paginas-de-erro.spec.ts` mede o comportamento. Abrir
linha de base visual para elas é decisão para quando o desenho estabilizar (é o
mesmo critério da F62: a catraca cresce por adição de risco novo).

### 6.11 As catracas, com a mutação

- **Catálogo das guardas**: acrescentar uma `async function guard` em
  `demand-actions.ts` → reprova ("use `guardAction` em vez de escrever mais uma
  cópia"). Mutação desfeita.
- **Portas migradas**: remover `guardAction` de `admin-actions.ts` → reprova ("a
  guarda local voltou pela porta dos fundos"). Mutação desfeita.
- **Catraca do `tx`**: mover `cancelRegistration` para `registration-read-service.ts`
  → reprova nos dois lados (saiu do original e a leitura passou a ter verbo de
  escrita). Mutação desfeita.
- **Contexto uma vez**: devolver a segunda chamada a `getRequestContext` na raiz do
  evento → `memberships` volta a 2 e o `toBe(1)` reprova. Mutação desfeita.
- **Frases das páginas de erro**: escrever "Página não encontrada" dentro de um
  `not-found.tsx` → reprova (o arquivo de rota não pode conter a frase da tabela).
  Mutação desfeita.
- **Landmark**: devolver `<main>` a `area-not-found.tsx`… já o tem; a mutação é
  pôr o `<main>` no **arquivo de rota** → reprova no caso de unidade e no `axe`
  (`Received: 2`). Mutação desfeita.

### 6.12 As imagens

`docs/imagens/f75-pagina-de-erro.png` — a página de **não encontrado** da área
pública, 1440×900, anônima, com o cabeçalho e o rodapé da instituição, as **três
hipóteses na mesma frase** e os **dois caminhos de volta** ("Ver os eventos da
instituição" e "Ir para a página inicial"). Foi capturada da tela real, contra o
container, e o spec de captura foi **apagado** depois.

**O `f75-catalogo-de-guardas.png` não foi feito, e não é esquecimento:** o catálogo
de guardas **é teste, não tela** — ele não tem pixel para mostrar, e uma imagem do
`npm test` não é evidência de interface. O que prova o catálogo é o próprio teste
(§6.3) e a mutação da §6.11. Uma captura da saída do terminal envelheceria na
primeira vez que a suíte crescesse.

---

## 7. Comandos Operacionais

```bash
# A bateria da §4, na ordem
npm run lint
npm run typecheck
npm test
npm run build
npm run db:verify
npm run db:verify:isolation
npm run db:partitions

# O container precisa rodar o código NOVO antes do E2E
docker compose --profile app up -d --build web worker
docker image inspect eventflow/web:local --format '{{.Created}}'

# A suíte E2E inteira, com a saída FORA da árvore
npx playwright test --output "$TEMP/ef-e2e-f75" --reporter=list

# A fase, por fatia
npx vitest run tests/integration/f75-guardas-caracterizacao.test.ts   # a rede (fatia 1)
npx vitest run tests/unit/f75-catalogo-de-guardas.test.ts             # o catálogo (fatia 2)
npx vitest run tests/unit/f75-servicos-fracionados.test.ts            # a catraca do tx (fatia 3)
npx vitest run tests/unit/f75-contexto-uma-vez.test.ts tests/integration/f75-contexto-uma-vez.test.ts
npx vitest run tests/unit/f75-paginas-de-erro.test.ts                 # as frases (decisão 4)

# As páginas de erro no navegador
npx playwright test tests/e2e/f75-paginas-de-erro.spec.ts
npx playwright test tests/e2e/accessibility.spec.ts -g "não encontrado|página de erro"

# O visual, isolado (2 vermelhos pré-existentes)
npx playwright test tests/e2e/f62-regressao-visual.spec.ts
npx playwright test tests/e2e/f62-regressao-visual.spec.ts -g "13\. o rodapé público da raiz no claro"
npx playwright test tests/e2e/f62-regressao-visual.spec.ts -g "14\. o rodapé público da raiz no escuro"
```

**Onde olhar na interface:**

```text
Não encontrado ..... /t/<slug>/eventos/<inexistente>     (área pública, 404)
                      /endereco-que-nao-existe           (raiz, 404)
                      /t/<slug>/administracao/eventos/<uuid inexistente>  (painel, 404)
Erro ................ /t/<slug>/administracao/eventos/nao-e-uuid          (painel, 500)
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

**A contagem de dívidas não muda: 41 abertos.** A fase não quitou nem declarou item
numerado do levantamento; o que ela fez foi refactor com rede e páginas de erro. O
que fica registrado aqui são **pontos de atenção** — nenhum deles é item novo da
lista, e todos estão escritos para quem continuar:

- **Sem `cache()`** — layout e página seguem resolvendo o contexto **cada um** (o
  layout tem o dele; a página tem o dela). A fatia 4 tirou a **segunda** leitura
  dentro da mesma página, não a leitura do layout. Um `cache()` por requisição
  resolveria, e foi deliberadamente recusado (ADR-363).
- **Os dois checks de convite do shell não foram unificados** — `hasPendingSpeakerInvite`
  e `hasPendingSponsorInvite` (e `listSponsorAccess`) são três consultas por render do
  shell, cada uma com o próprio módulo. Unificar exigiria uma tabela de convites única,
  que é decisão de modelo, não de refactor.
- **`RaffleErrorCode`/`RaffleResult` moram no irmão de leitura** — o som e a forma dos
  erros do sorteio passaram a viver em `raffle-read-service.ts` porque foi ali que os
  primeiros consumidores ficaram; o serviço de escrita os importa. Um
  `raffle-types.ts` seria mais limpo.
- **O contrato `context` devolvido pela guarda ainda não tem consumidor** em todas as
  páginas: as que precisam de `principal`/`user` usam, as demais ignoram o campo. Não
  é bug — é um contrato que nasceu pronto e será consumido aos poucos.
- **Id malformado na URL responde 500 (PRÉ-EXISTENTE, armadilha 25).** Qualquer
  `/t/<slug>/administracao/eventos/<não-UUID>` derruba a consulta no Prisma e sobe
  como 500. Não é regressão desta fase (é anterior, e atinge todas as rotas com id na
  URL do painel), e é o caminho que o E2E usa para medir a página de erro. O conserto
  certo é validar o formato do id e responder `notFound()` — fica como **ponto de
  atenção** para uma fase de mutirão, com o custo de varrer as rotas de id.
- **O `not-found` da área autenticada não é observável sem sessão** — ele roda dentro
  do layout `(app)`, que exige vínculo. É o comportamento correto; o efeito é que o
  404 do painel nunca é a primeira tela de quem chega.
- **A contagem de "puros" da fatia 3 (183) não é reproduzível com o critério da §3.5
  (91)**. A diferença é de critério, e a lição não depende dela. Registrado para que
  o próximo número não seja copiado sem a régua ao lado.

---

## 9. Checklist de Aceite

| Requisito | Situação |
|---|---|
| **Fatia 1** — o par permitido × recusado das 21 guardas, no padrão `f74-posse-do-upload` | ✅ (66 casos) |
| O arquivo de caracterização **não** foi editado pela fatia 2 | ✅ (66 verdes sem tocar) |
| O catálogo inventaria as guardas, exige igualdade exata e reprova guarda nova | ✅ (10 casos) |
| **Fatia 2** — 16 guardas migradas + a `registration` traduzida, com **4 exceções declaradas e motivadas** | ✅ (21 → 4) |
| As 17 portas continuam pedindo a **mesma** permissão | ✅ (catálogo, arquivo por arquivo) |
| **−760 linhas líquidas** (não −1.500) | ✅ (ações −814, `guard-action` +54) |
| **Fatia 3** — só a leitura extraída; a escrita e as transações no lugar | ✅ (−2.324 líquidas) |
| Catraca por AST: escrita não sai, quem recebe `tx` não abre transação, leitura não escreve, sem ciclo de import | ✅ (12 casos) |
| **Fatia 4** — a guarda devolve o contexto; **2 + 2 → 1 + 1** em 4 superfícies | ✅ (9 casos, `toBe(1)`) |
| O ganho de HTTP **não** é afirmado (é ruído), com a tabela da dispersão | ✅ (§3.6) |
| **Decisão 4** — `error.tsx` e `not-found.tsx` **por área** (raiz, `(app)`, `(public)`) | ✅ (6 arquivos) |
| Um só por área, não um por página, com o recorte e o porquê declarados | ✅ (§3.8) |
| `<main>` único; tokens do tema; sem cor crua; sem `opacity` em texto | ✅ (catraca de unidade + `axe`) |
| `error.tsx` é **client component**, com `reset` de verdade, "Tentar de novo" e um caminho de saída | ✅ (E2E clica e confere) |
| A tela de erro **não** culpa a pessoa nem vaza detalhe técnico | ✅ (teste de frase + caso de E2E) |
| `not-found` diz o que aconteceu, oferece volta e **não** revela existência de recurso privado | ✅ (as três hipóteses juntas) |
| Frases de **domínio**, testáveis, não string solta em cada arquivo | ✅ (`error-pages.ts` + catraca de fonte) |
| **Portão WCAG AA** com caso novo para o **não encontrado** (público e raiz) | ✅ (2 casos) |
| E o de **erro**, medido numa rota que estoura de verdade | ✅ (1 caso; a rota é a armadilha 25, declarada na §8) |
| **Sem isenção nova** no portão | ✅ (`ISENCOES` continua vazia, teto 2) |
| `docs/fase-75-refactor-que-mede-antes.md` com as 9 seções e ADR-363/364/365 | ✅ |
| As **três propostas do revisor** respondidas com os números medidos | ✅ (§2 e §3) |
| `AGENTS.md` com fases **29 a 75**, contagens medidas, **ADRs 365 → 366**, linha 75, dívidas e §10 | ✅ (tamanho conferido no fim) |
| `README.md` e `docs/dividas-tecnicas.md` com a narrativa da fase e o que ficou aberto | ✅ |
| Bateria da §4 completa, com os números reais | ✅ (§6) |
| `f62` rodado isolado, com os 2 vermelhos pré-existentes medidos e diagnosticados | ✅ (§6.10) |
| Imagens da página de erro (e o catálogo, se fizesse sentido) | ✅ (`docs/imagens/f75-pagina-de-erro.png`; o catálogo **não** tem imagem — é teste, não tela, e o porquê está na §6.12) |
| Spec temporário apagado; `playwright-report/`, `test-results*`, `.playwright*` limpos | ✅ |
| `git status` sem resíduo e `next-env.d.ts` intacto | ✅ |
| **Nada** tocado em `src/app/globals.css` nem em `playwright.config.ts` | ✅ |
| Sem `any`; erros como valor; comentários explicam **POR QUE** | ✅ |

---

> **Aguardando APROVADO: AVANÇAR**

