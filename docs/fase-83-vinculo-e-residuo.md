# FASE 83 — O vínculo que tem significado e o resíduo que ninguém apagava

> **Tema:** o contexto implícito de uma conta com mais de um vínculo deixou de ser o
> primeiro da ordem alfabética e passou a ter **desempate declarado** (`MEMBER` →
> `joinedAt` mais antigo → `tenantId`), com a **pergunta** quando há 2+ vínculos e
> nenhuma escolha registrada; e as fixtures de integração que criavam instituição sem
> apagar foram consertadas, com uma **catraca por AST** prendendo a forma. **ADR-380 e
> ADR-381.**
> **Base:** a porta de entrada da FASE 82 entregou a regra de destino
> (`resolveEntryDestination`) e o seletor como resposta; esta fase conserta a
> **resposta errada** que a ausência de desempate produzia e o **dado que a produzia**.
> **Fatias:** 1 (desempate + pergunta), 2 (resíduo + `joinedAt` como dado). As duas
> entregues; a fase fecha com a bateria completa e a suíte E2E inteira.

---

## 1. Sumário executivo

| Entrega | Onde | Prova |
|---|---|---|
| O **desempate com significado** do vínculo ativo: `MEMBER` antes de `PARTICIPANT` → `joinedAt` mais antigo (`createdAt` de reserva) → `tenantId` | `src/lib/auth/active-membership.ts` | **26 casos** em `f83-desempate-de-vinculo.test.ts` |
| A **contagem de vínculos** e a **escolha já feita** na regra de destino: 2+ sem cookie → `/selecionar-instituicao`; cookie válido vence a contagem | `src/domain/platform/entry-destination-rules.ts`, `src/lib/auth/entry-destination.ts` | **16 casos** de regra/adaptador + **2 E2E** |
| O leitor canônico devolve `kind`, `joinedAt` e `createdAt` **sem trocar o `orderBy` alfabético** do seletor | `src/lib/auth/session.ts` | catraca de fonte: a ordenação continua `tenant.name`; `active-membership.ts` não contém `tenantName` |
| **4 fixtures** de 96 (114 chamadas) entraram na varredura; as **três antigas** (cinco instituições por execução) passaram a apagar **as duas que criam** ou a limpar no `finally`, e a nova já nasceu limpando | `member-lifecycle`, `communication`, `stage-operation` e a fixture nova | catraca por AST `f83-fixtures-sem-residuo` (**6 casos**, sem allowlist) |
| O **`joinedAt` deixou de ser reescrito** pelo `db:seed:dev` e pela inscrição pública — só o `create` o define | `prisma/seed-dev-users.ts`, `src/lib/events/registration-service.ts` | **3 casos** contra PostgreSQL real, incluindo o **seed real** com a data fixada em 2020 |
| A frase que afirmava o contrário do código, corrigida | `docs/contas-de-teste.md:107` | leitura + o teste do seed que a contradiz |
| E2E novo: dois vínculos **sem** cookie → seletor; **com** cookie → painel e a entrada seguinte direto | `tests/e2e/f82-porta-de-entrada.spec.ts` (casos 9 e 10) | 481 no total — **480 passando + 1 skip, zero vermelhos** |

**Números da fase**

```text
Arquivos de código .............. 6 (nenhum novo; 6 alterados)
Fixtures consertadas ............ 3 arquivos antigos (4 fixtures na varredura; 5 instituições por execução)
Testes novos .................... 35 no Vitest (3 arquivos) + 2 no E2E
Vitest .......................... 4492 em 252 arquivos (eram 4457 em 249) — 0 vermelhos
E2E ............................. 481 (479 + 2) — 480 passando + 1 skip, ZERO vermelhos
Migrações ....................... 0
ADRs ............................ 2 (ADR-380, ADR-381) — a próxima é a 382
```

---

## 2. O problema mais difícil: **a premissa estava certa e não resolvia o caso**

O humano relatou um fato simples: uma conta com dois vínculos caía sempre na
**instituição-resíduo de teste**, e não na instituição real. O sintoma não era uma tela
quebrada — era uma tela **plausível**, com o nome errado no topo. Foi por isso que ele
sobreviveu tanto tempo: nada falhava.

A primeira leitura do defeito foi a mais natural: *quem é da equipe entra na instituição
da equipe*. A regra ganhou o degrau `kind` (`MEMBER` antes de `PARTICIPANT`) e a
justificativa parecia completa — participante de evento não é dono da casa. Só que a
medição no banco, feita **antes** de fechar a regra, mostrou outra coisa:

```text
participante@eventflow.test
  ufba-demo               Universidade Federal da Bahia      ACTIVE  PARTICIPANT  06/10/2026
  f21-apertada-035169fa   Instituição sem espaço 035169fa   ACTIVE  PARTICIPANT  24/10/2026
```

Os **dois** vínculos são `PARTICIPANT`. O degrau de `kind` não escolhe nada neste caso —
e não escolheria em nenhum caso daquele formato, porque a pessoa **é** público nas duas
instituições. Quem resolve o caso concreto é o **segundo** degrau: o vínculo da UFBA é o
mais antigo. O `kind` continua certo para o caso geral (equipe × público, provado em
teste próprio) e é o primeiro degrau; mas a lição é que **o desenho não pode depender de
a premissa favorita ser a que o dado confirma**.

O segundo fato medido foi a **origem** do vínculo intruso: ele não veio de um convite
nem de uma importação. Nasceu de uma **inscrição pública em `WAITLISTED`**, que cria
vínculo `ACTIVE` **de propósito** — a pessoa precisa ver a fila dela e o estado da
inscrição. O vínculo é legítimo; o problema é que ele disputava o contexto de entrada
com a instituição onde a pessoa realmente opera. A resposta do produto não foi remover o
vínculo (isso esconderia a fila), e sim **desempatar** e **perguntar** (§3.6).

O terceiro fato fechou o diagnóstico: o degrau de antiguidade só vale se a data for
confiável — e **não era**. O `db:seed:dev` regravava `joinedAt = now` em todo vínculo
`ACTIVE` a cada execução, e o `upsert` da inscrição pública fazia o mesmo no `update`.
Ou seja: a regra nova se apoiava num campo que a própria ferramenta de desenvolvimento
**quebrava a cada execução**. Sem corrigir a origem, o desempate seria uma promessa
válida só até o próximo `npm run db:seed:dev`.

É por isso que a fase tem duas frentes que parecem independentes e não são: **o
desempate** (que decide) e a **integridade do dado que ele lê** (que decide *sempre a
mesma coisa*). Uma regra que depende de um campo reescrito por rotina é uma regra com
prazo de validade.

---

## 3. Decisões técnicas

### 3.1 A ordem do desempate, e por que o nome saiu dela

`pickActiveMembership` passou a escolher o **melhor** vínculo `ACTIVE`, não o primeiro
que o banco devolveu:

| # | Critério | Por que nesta posição |
|---|---|---|
| 1 | `kind = MEMBER` antes de `PARTICIPANT` | quem faz parte da **equipe** entra na instituição dela; vínculo de inscrição pública é público de evento. É o único degrau que distingue os dois **tipos** de relação |
| 2 | `joinedAt` ascendente (mais antigo), com `createdAt` de reserva | empatado o tipo, vale a relação mais antiga — a que a pessoa construiu primeiro e a que permanece estável entre entradas. `joinedAt` é nulo em convite nunca aceito e em linha legada; a reserva é o `createdAt` do perfil, **imutável** |
| 3 | `tenantId` ascendente | empate final **sem significado de produto**: serve para o resultado ser **determinístico** quando dois vínculos têm o mesmo tipo e o mesmo instante. `Tenant.name` **não é único** e dois homônimos davam ordem arbitrária |

O nome **saiu** de propósito: a ordem antiga era a da consulta (`orderBy: tenant.name`),
e o defeito era exatamente o alfabeto decidir a casa da pessoa. `tenantId` é comparado
por **código de unidade** (não `localeCompare`): colação depende de locale/ICU, e a
regra precisa dar o mesmo resultado no servidor, no teste e no worker. A hierarquia de
`kind` é um `Record<MembershipKind, number>` tipado — um `MembershipKind` novo no schema
faz o `typecheck` reprovar até alguém declarar a precedência.

**A ordenação não migrou para o banco.** `loadMemberships` continua com
`orderBy: { tenant: { name: 'asc' } }`, porque essa é a ordem do **seletor** e do menu de
conta — listar instituições em ordem alfabética é o que a pessoa espera na hora de
escolher. Levar o desempate para o `orderBy` faria o contexto de uma pessoa depender da
ordenação de uma tela e mudaria a lista de **todas** as instituições para resolver o
contexto de uma. O desempate é decisão de **contexto**, em memória, sobre uma **cópia**
do array (reordenar no lugar mudaria a ordem do seletor como efeito colateral).

### 3.2 "Existe vínculo?" virou "quantos?" — e o cookie é a resposta já dada

A regra de destino recebia `hasActiveLink: boolean`. Um booleano não distingue "um
vínculo" de "dois", e era essa a pergunta que faltava. O contrato passou a ser:

- `activeLinkCount` — **quantos** vínculos `ACTIVE` existem (0, 1, 2+ mudam o destino);
- `chosenTenantSlug` — o cookie `ef_tenant` **já revalidado** contra um vínculo `ACTIVE`;
- `activeTenantSlug` — o melhor vínculo, para o caso de um só.

Com **1** vínculo, o destino é o painel dele (não há o que perguntar). Com **2 ou mais**
e **nenhuma escolha**, o destino é `/selecionar-instituicao`. Com cookie válido, o
destino é o painel do **escolhido**, mesmo havendo outro vínculo "melhor" pelo desempate:
o cookie é a **resposta que a pessoa já deu**, e perguntar de novo a cada entrada
transformaria o seletor num pedágio.

A ordem dos degraus ficou: `redirectTo` → plataforma → **escolha explícita** → **um
vínculo** → **2+ vínculos (pergunta)** → convite → descoberta. A escolha vem **antes**
da contagem, e é o `switchTenantAction` gravando o cookie que faz a entrada seguinte ir
direto ao painel. O cookie só chega à regra se **revalidou** como vínculo `ACTIVE`:
slug órfão ou de convite pendente vira `null` e a regra segue — fail-closed, sem confiar
no navegador.

`activeTenantSlug` e `activeLinkCount` **não** foram fundidos: o vínculo pode existir sem
que o slug chegue (dado incompleto, chamador novo), e nesse caso a regra precisa cair
para o próximo degrau em vez de montar `/t/null/dashboard`.

### 3.3 Os dois lados leem o MESMO critério

`getRequestContext()` e o adaptador de entrada escolhiam o vínculo ativo com **seis
linhas copiadas**. A cópia é o defeito: no dia em que um lado mudasse o critério, o
login mandaria a pessoa para `/t/<A>/dashboard` e a casca renderizaria a instituição B
logo depois, com o menu de uma e o painel da outra. O critério passou a viver em
`active-membership.ts`, consumido pelos dois, e as três perguntas (`activeMemberships`,
`pickChosenMembership`, `pickActiveMembership`) saem do mesmo módulo — o `status ===
'ACTIVE'` tem uma casa só. A catraca de fonte prende: o módulo **não contém**
`tenantName`, e `session.ts` continua ordenando por nome.

### 3.4 `joinedAt` é DADO, não telemetria

O seed reafirma **estado** (status, kind, `deletedAt`) a cada execução; antiguidade não é
estado a reafirmar. O `update` do seed deixou de gravar `joinedAt`, e o `upsert` da
inscrição pública também — quem define a data é o **`create`**. O vínculo que já existe
mantém a data que tem; ativar um convite pendente muda o `status`, não a origem.

A prova é contra o PostgreSQL real, com o **script real** (`prisma/seed-dev-users.ts`
rodado pelo mesmo `tsx` do `npm run db:seed:dev`): a fixture fixa o `joinedAt` de uma
conta do seed em **2020-02-03**, roda o seed e confere que a data continua 2020 — não
"não nula", não "recente": **a mesma**. A fixture restaura o valor original no `finally`,
mesmo se a asserção falhar. Os outros dois casos provam o caminho `update` do `upsert`
(convite `INVITED` ativado por inscrição preserva a data) e o caminho `ALREADY_MEMBER`
(reinscrever quem já é participante **nem toca** no vínculo).

O cabeçalho de `active-membership.ts` ainda dizia que `joinedAt` **não** era imutável —
a fragilidade que a própria fatia 1 declarou para "a fatia que mexer na origem do
vínculo". Esta é essa fatia: o comentário foi atualizado para dizer o fato novo. **Nenhuma
linha de decisão da regra mudou** (o diff é só de comentário).

### 3.5 A catraca por AST: a forma, e o limite declarado

A varredura de **96 arquivos** (114 chamadas de criação) encontrou **quatro fixtures**
com criação de instituição: **três antigas** — `member-lifecycle` (duas instituições),
`communication` (duas) e o caso de "outra instituição" de `stage-operation` (uma) —
criavam e não apagavam (**cinco instituições por execução**), e a fixture nova da fase
já nasceu limpando. O conserto de cada uma é pequeno; o que não pode voltar é a
**forma**. A catraca `f83-fixtures-sem-residuo` lê o fonte com a API do TypeScript e
reprova:

- criação **fora** de um `it` (o normal é `beforeAll`) sem `afterAll` que apague ao menos
  uma instituição (`tenant.delete` / `tenant.deleteMany`);
- criação **dentro** de um `it` que não apaga naquele mesmo corpo — o `finally` vale, e é
  o que garante que a limpeza não depende de o teste passar.

**O limite, dito sem eufemismo:** a catraca prova a **forma**, não o **efeito**. Um
`afterAll` que apague só **uma** das duas instituições passa (o parser não casa cada
`create` com cada id), e uma limpeza que falhe em runtime não é vista. O efeito foi
medido de outro jeito: rodando as fixtures e conferindo o banco — zero resíduo novo
depois da suíte. Não há allowlist: `partition-service.test.ts` cria e apaga no **mesmo
caso**, dentro de `try/finally`, e passa pela regra do `it` sem exceção. Os cinco casos
sintéticos provam que a catraca **morde** (um teste que só varre a árvore atual passaria
verde para sempre se o detector estivesse quebrado).

### 3.6 O vínculo de `WAITLISTED` **permanece**

Decisão registrada, não esquecimento: a inscrição pública em lista de espera **continua
criando vínculo `ACTIVE`**. É como a pessoa vê a fila dela, o estado da inscrição e o
aviso de promoção; esconder o vínculo para "limpar" o contexto quebraria uma tela real
para consertar outra. O dano era **disputar o contexto**, e ele foi resolvido em duas
camadas que não removem dado nenhum: o desempate (o vínculo mais antigo/da equipe vence)
e a pergunta (com 2+ vínculos e nenhuma escolha, o sistema não adivinha). Quem quiser
que a instituição da inscrição seja a casa escolhe no seletor — e o cookie passa a
valer.

### 3.7 O que a fase **não** fez, de propósito

- **Não apagou o resíduo do banco de desenvolvimento.** Há **50 instituições** de
  famílias antigas no banco local (`f21-*` 20, `f15-*` 20, `f22-*` 10), incluindo a
  `f21-apertada-035169fa` que o `participante@` tem como segundo vínculo. Isso é **dado
  local**, não dívida de código; a remoção exige autorização e o comando está proposto no
  §8.1 e em `docs/contas-de-teste.md`.
- **Não mexeu nas decisões das fatias 1 e 2** da F82 (`active-membership` enquanto
  módulo, regra de destino, fixtures, `joinedAt`): a fase **usa** o que a F82 entregou.
- **Não trocou o `orderBy`** alfabético do seletor (§3.1), nem o menu de conta, nem a
  ordem de `loadMemberships`.

---

## 4. ADRs

### ADR-380 — O vínculo ativo tem desempate com significado, e 2+ vínculos sem escolha viram **pergunta**

**Contexto.** O contexto implícito de quem entra era "o primeiro vínculo `ACTIVE` na
ordem de `loadMemberships`", que ordena por `tenant.name`. Uma pessoa real com dois
vínculos — a instituição onde opera e uma instituição criada por **inscrição pública em
`WAITLISTED`** — caía na instituição-resíduo porque "Instituição sem espaço…" vem antes
de "Universidade…" no alfabeto. Medido no banco: os **dois** vínculos são
`PARTICIPANT`; o que resolve o caso concreto é a **antiguidade**, não o tipo. E a regra
de destino olhava só **se** havia vínculo ativo: com dois, a pessoa nunca era perguntada.

**Decisão.** O vínculo ativo é escolhido por `pickActiveMembership`, em memória, com
ordem declarada: `kind` (`MEMBER` antes de `PARTICIPANT`) → `joinedAt` mais antigo
(`createdAt` de reserva) → `tenantId` asc. O cookie `ef_tenant` **revalidado** vence o
desempate (é a escolha explícita). A regra de destino passa a receber
`activeLinkCount` e `chosenTenantSlug`: **1** vínculo → painel; **2+** sem escolha →
`/selecionar-instituicao`; **2+** com escolha → painel do escolhido. O `orderBy`
alfabético do seletor **não** muda.

**Justificativa.** O nome não é critério de pertencimento, e `Tenant.name` nem é único.
O tipo é o critério certo **quando** distingue as relações (equipe × público), mas não
resolve o caso medido; a antiguidade resolve e é estável entre entradas. O cookie é a
única resposta que a pessoa **deu**, e por isso vence a contagem sem transformar o
seletor em pedágio. As alternativas descartadas: (a) remover o vínculo de `WAITLISTED`
(esconde a fila da pessoa — §3.6); (b) trocar o `orderBy` para o desempate (muda a lista
de todo mundo e faz o contexto depender de uma tela); (c) desempatar por nome (é o
defeito); (d) perguntar **sempre** que houver 2+ vínculos, ignorando o cookie (pedágio a
cada entrada).

**Consequências.** (1) Quem tem 2+ vínculos e nenhum cookie passa a ver o seletor **uma
vez** na entrada; a escolha grava o cookie e a entrada seguinte vai direto. (2) O
`kind`/`joinedAt`/`createdAt` entram no tipo `TenantMembership` e na consulta de
`loadMemberships`, sem mudar a ordem. (3) A mesma função serve `getRequestContext()` e o
adaptador de entrada — uma fonte só. (4) O degrau de antiguidade só é confiável porque
o `joinedAt` deixou de ser reescrito (ADR-381).

### ADR-381 — Instituição criada por fixture é apagada pela fixture, e `joinedAt` só nasce no `create`

**Contexto.** Quatro fixtures de **96 arquivos** (114 chamadas) criavam instituição sem
apagar. As sobras ficavam no banco de desenvolvimento e viravam segundos vínculos quando
a inscrição pública de outro teste caía nelas — o resíduo que produziu o defeito do
ADR-380. No mesmo caminho, dois escritores reescreviam `joinedAt`: o `db:seed:dev`
(regravava `now` em todo vínculo `ACTIVE` a cada execução) e o `upsert` da inscrição
pública (no `update`). O degrau "mais antigo" era uma promessa que a própria ferramenta
quebrava a cada execução.

**Decisão.** (1) Fixture que cria instituição **apaga o que criou** — as duas, no
`afterAll`, ou a instituição do caso no `finally` —, numa catraca por **AST** que reprova
a forma sem allowlist. (2) `joinedAt` é definido **só no `create`**: o `update` do seed
reafirma status/kind/`deletedAt` e não toca na data; o `upsert` da inscrição ativa o
vínculo sem regravá-la.

**Justificativa.** O resíduo não é sujeira cosmética: ele **muda a decisão de contexto**
de uma pessoa real, e o mecanismo que o produzia era invisível (a fixture passava, o
banco acumulava). A catraca prende a **forma** porque é o que se degrada numa edição
futura; o efeito é medido no banco. `joinedAt` é dado de negócio (desde quando o vínculo
vale), não telemetria: reescrevê-lo apaga a antiguidade real e faz a escolha implícita
mudar de dono só porque alguém rodou o seed. As alternativas descartadas: (a) limpar o
banco no início da suíte (apagaria dado de demonstração e não impediria a próxima
fixture de vazar); (b) allowlist de fixtures conhecidas (a quinta fixture nasceria fora
dela); (c) manter `joinedAt = now` no seed "porque é idempotente" (idempotente para o
status, destrutivo para a data).

**Consequências.** (1) `npm run db:seed:dev` pode rodar quantas vezes for preciso sem
mexer na antiguidade de ninguém. (2) Ativar convite por inscrição preserva a data de
origem; reinscrever quem já é participante nem toca no vínculo. (3) A catraca não casa
cada `create` com cada id — o limite está declarado no §3.5 e no cabeçalho do teste.
(4) O resíduo **já existente** no banco local não foi apagado: é dado, e a limpeza está
proposta no §8.1.

---

## 5. Lições aprendidas

> Só o que aconteceu: cada linha é um defeito medido, com a correção e a prova.

| # | Sintoma | Causa raiz | Correção | Prova |
|---|---|---|---|---|
| 1 | **O default alfabético levou uma pessoa real a uma instituição-resíduo de teste** — e a tela abria plausível, com o nome errado | a escolha era "o primeiro `ACTIVE`" na ordem de `loadMemberships` (`tenant.name`); uma inscrição pública em `WAITLISTED` de outro teste criou um segundo vínculo `ACTIVE` **de propósito** (a pessoa precisa ver a fila) | desempate com significado (`kind` → `joinedAt` → `tenantId`) + **pergunta** quando há 2+ sem escolha; o vínculo de `WAITLISTED` **permanece** | 26 casos + E2E 9 e 10; medido no banco: a UFBA é o vínculo mais antigo |
| 2 | **A premissa do `kind` estava errada para o caso concreto** | o desenho supôs que o vínculo intruso seria `PARTICIPANT` e o real `MEMBER`; no banco, **os dois são `PARTICIPANT`** — a pessoa é público nas duas casas. O `kind` não distingue nada nesse caso | o `kind` continua sendo o **primeiro** degrau (equipe × público, com teste próprio), mas o caso medido é resolvido pelo **`joinedAt`**; a prova não depende da fixture | caso "dois `PARTICIPANT`" (ordem invertida + nomes alfabeticamente enganosos) e caso "o caso medido" no adaptador |
| 3 | **`joinedAt` era reescrito pelo seed e pela reinscrição** — o degrau "mais antigo" era uma promessa que a ferramenta quebrava a cada execução | o `update` do seed gravava `joinedAt = now` em todo vínculo `ACTIVE`; o `upsert` da inscrição fazia o mesmo no `update` | `joinedAt` só nasce no `create`; seed e inscrição não o tocam | 3 casos contra PostgreSQL real, com o **seed real** e a data fixada em **2020-02-03** |
| 4 | **4 de 96 fixtures** na varredura (114 chamadas) — e as **três antigas** criavam instituição sem apagar (**cinco por execução**), e a sobra virava contexto de alguém | `afterAll` que só chamava `$disconnect()`, e um caso que criava "outra instituição" fora do alcance do `afterAll`; o banco acumulava **50** instituições de famílias antigas | limpeza nas duas (ou `finally` no caso) + catraca por **AST** sem allowlist | 6 casos (5 sintéticos + varredura) e **zero resíduo novo** depois da suíte |
| 5 | **`docs/contas-de-teste.md:107` afirmava o contrário do código** — "não existe contexto implícito" | a frase descrevia o comportamento **antes** do desempate e nunca foi reescrita; era a **única** fonte que negava o que o código fazia, e é justamente a que uma pessoa lê para entender as contas de teste | a linha passou a dizer o fato: existe contexto implícito **determinístico** (cookie → `MEMBER` → mais antigo → `tenantId`), mas com **2+ sem escolha** a entrada pergunta | leitura do código + o teste do seed; a frase nova nomeia a regra |
| 6 | **O menu de conta existe DUAS vezes no DOM** (uma cópia oculta por breakpoint) — o E2E esperou para sempre num clique | a casca renderiza a barra lateral e a gaveta mobile, ambas com o mesmo `details`; `details.first()` pegava a **oculta** | `summary:visible` / `li:visible` escolhem a cópia que a pessoa vê no viewport | caso 10 do spec da porta, que precisou da correção para passar |

Três lições de método, que não são defeito de produto:

- **Medir antes de fechar a regra.** O `kind` parecia a resposta certa; o banco disse
  outra coisa. A regra ficou com os dois degraus e dois testes, em vez de depender da
  premissa que o caso não sustentava. É a mesma régua da F82 (o plano que mediu antes).
- **Regra que lê um campo precisa de dono para o campo.** O desempate por antiguidade só
  vale porque a fase fechou quem escreve `joinedAt`. Testar a regra pura não pegaria o
  seed reescrevendo a data — foi preciso rodar o **seed real** contra o banco.
- **Catraca que não é exercitada é decoração.** Os cinco casos sintéticos existem porque
  a varredura da árvore atual passaria verde para sempre se o detector estivesse
  quebrado. É a lição que a F82 pagou com a catraca do vínculo ativo.

---

## 6. Evidência de verificação

### 6.1 A bateria

```text
npm run lint ........................ 0 erros, 0 avisos
npm run typecheck ................... 0 erros
npm test ............................ 252 arquivos, 4492 testes, 0 vermelhos
npm run build ....................... "✓ Compiled successfully" (exit 0)
npm run db:verify ................... "Contrato íntegro."
npm run db:verify:isolation ......... "9/9 verificações passaram."
npm run db:partitions ............... mês atual e os seguintes criados
```

### 6.2 Os testes novos, por arquivo

```text
tests/unit/f83-desempate-de-vinculo.test.ts ....... 26 passed
  · o desempate (kind → antiguidade → tenantId) ...  8
  · a regra de destino (contagem + escolha) .......  7
  · o adaptador (cookie × contagem) ...............  9
  · catraca de fonte (nome não é critério) ........  2
tests/unit/f83-fixtures-sem-residuo.test.ts .......  6 passed
  · a catraca morde — casos sintéticos ............  5
  · a árvore de integração ........................  1
tests/integration/f83-joined-at.test.ts ...........  3 passed
  · o seed real preserva o `joinedAt` ..............  1
  · a inscrição preserva o `joinedAt` ..............  2
tests/e2e/f82-porta-de-entrada.spec.ts ............  10 passed (8 + 2)
```

### 6.3 O E2E inteiro

```text
npm run test:e2e -- --output %TEMP%\f83-e2e-out
  481 testes em 13,5 min: **480 passed + 1 skipped, ZERO failed**

  por spec, o que a fase toca:
    tests/e2e/f82-porta-de-entrada.spec.ts .......  10 passed (era 8)
    tests/e2e/accessibility.spec.ts ..............  40 passed
    tests/e2e/f60-landmark.spec.ts ...............  16 passed
    tests/e2e/f62-regressao-visual.spec.ts .......  23 passed
```

O que os dois casos novos medem, além do número:

- **caso 9** cria uma conta pelo formulário, dois vínculos `ACTIVE` e entra **sem
  cookie**; exige `/selecionar-instituicao`, as **duas** instituições na tela e — o mais
  importante — que a URL **não** seja o painel de nenhuma das duas: perguntar não é
  escolher.
- **caso 10** faz a escolha pelo **`switchTenantAction` de verdade** (o menu de conta,
  com `:visible`), confere o painel do escolhido, sai e entra de novo: com o cookie
  revalidado, a entrada seguinte vai **direto** ao painel, sem perguntar. É a prova de
  que a pergunta não virou pedágio.

### 6.4 O efeito no banco

```text
antes da suíte ........ 50 instituições de famílias antigas no banco local
                        (f21-* 20, f15-* 20, f22-* 10 — de execuções anteriores)
depois da suíte ....... o mesmo número; nenhuma instituição nova de f21/f15/f22/f82/f83
                        sobra no banco (as fixtures novas limpam o que criam)

participante@eventflow.test (medido no banco):
  ufba-demo               Universidade Federal da Bahia      ACTIVE  PARTICIPANT  06/10/2026
  f21-apertada-035169fa   Instituição sem espaço 035169fa   ACTIVE  PARTICIPANT  24/10/2026
```

### 6.5 A imagem da fase

```text
docs/imagens/f83-vinculo-e-residuo.png ... antes × depois do relato:
  ANTES  — o painel da instituição-resíduo, para onde a ordem alfabética levava a conta
           com dois vínculos. Capturado depois de escolher a instituição no seletor: é
           exatamente o mesmo painel que a entrada abria sozinha antes do desempate.
  DEPOIS — a tela de seleção, capturada depois de um login REAL da mesma conta, com os
           dois vínculos e a pergunta.
```

As duas telas são da **mesma conta** e do **mesmo banco**; o spec temporário
(`tmp-captura-f83.spec.ts`) foi **apagado** depois de gerar a imagem. A primeira
captura do painel "DEPOIS" saiu **em branco** (a transição do App Router ainda não
tinha pintado, e `screenshot()` não desliga animação como `toHaveScreenshot`); a
captura passou a esperar a pintura e a usar `animations: 'disabled'` — e o composto
é recortado pela altura real do corpo, sem a sobra do viewport.

---

## 7. Comandos operacionais

```bash
# o desempate e a regra de destino (sem banco, sem cookie, sem Next)
npx vitest run tests/unit/f83-desempate-de-vinculo.test.ts

# a catraca das fixtures (com os casos sintéticos que provam que ela morde)
npx vitest run tests/unit/f83-fixtures-sem-residuo.test.ts

# `joinedAt` contra o PostgreSQL real (roda o seed real; restaura o valor no finally)
npx vitest run tests/integration/f83-joined-at.test.ts

# a entrada com dois vínculos no navegador (casos 9 e 10)
npx playwright test tests/e2e/f82-porta-de-entrada.spec.ts

# a suíte inteira, com a saída FORA da árvore
npm run test:e2e -- --output %TEMP%\f83-e2e-out

# a imagem foi capturada por um spec TEMPORÁRIO (tmp-captura-f83.spec.ts),
# apagado depois de gerar docs/imagens/f83-vinculo-e-residuo.png; não há comando a repetir.
```

```text
Regra ............ src/lib/auth/active-membership.ts (puro; não lê banco/cookie/Next)
Regra de destino . src/domain/platform/entry-destination-rules.ts (pura)
Adaptador ........ src/lib/auth/entry-destination.ts (só na entrada)
Contexto ......... src/lib/auth/session.ts → pickActiveMembership (uma fonte só)
Fixtures ......... member-lifecycle · communication · stage-operation · f83-joined-at
Seed ............. prisma/seed-dev-users.ts (não grava `joinedAt` no update)
Inscrição ........ src/lib/events/registration-service.ts (upsert sem `joinedAt`)
```

---

## 8. Dívidas técnicas e pontos de atenção

### 8.1 O resíduo local: **dado**, não dívida de código — e a proposta de limpeza

O banco de **desenvolvimento** tem **50 instituições** de famílias antigas (`f21-*` 20,
`f15-*` 20, `f22-*` 10), produzidas pelas fixtures antes desta fase. Elas **não** são
dívida de código: o código que as criava foi consertado e a catraca impede a volta. São
dado local acumulado, e a fase **não** as apagou porque remoção de dado exige
autorização explícita.

A proposta, com autorização:

```sql
-- a cascata leva perfis, papéis, eventos, inscrições, auditoria e o vínculo do participante
DELETE FROM tenants WHERE slug LIKE 'f21-%' OR slug LIKE 'f15-%' OR slug LIKE 'f22-%';
```

Enquanto isso, o `participante@eventflow.test` continua com **dois** vínculos e a entrada
**pergunta** — que é o comportamento correto para 2+ vínculos, e é justamente o que a
imagem da fase mostra. O registro está em `docs/contas-de-teste.md` (§4, nota da FASE 83).

### 8.2 O limite declarado da catraca por AST

A catraca prende a **forma** (existe `afterAll`/`finally` que apaga?), não o **efeito**
(apagou **todas** as instituições que criou?). Um `afterAll` que apague uma das duas
passa; uma limpeza que falhe em runtime não é vista. Fechar o casamento
`create` ↔ `delete` por AST é possível, mas exige análise de fluxo que o teste não faz —
e o custo/benefício não se justificou nesta fase. O efeito é medido no banco (§6.4), e a
catraca existe para o que se degrada numa edição futura.

### 8.3 A cópia do menu de conta no DOM

O menu de conta existe **duas vezes** no DOM (barra lateral e gaveta mobile, uma oculta
por breakpoint). Não é defeito de produto — é o mesmo elemento renderizado em dois
contêineres —, mas é armadilha de teste: `details.first()` pega a cópia oculta e o clique
espera para sempre. A regra para specs novos é `:visible` (§5, lição 6). Um teste que
precise da **primeira** cópia deve declarar isso, não confiar na ordem do DOM.

### 8.4 O vínculo de `WAITLISTED` continua, e isso é decisão

Quem se inscreve numa atividade com fila ganha vínculo `ACTIVE` com a instituição —
necessário para ver a fila, o estado e o aviso de promoção. O vínculo **permanece**
(§3.6). O que mudou é que ele não decide mais o contexto sozinho: o desempate e a
pergunta resolvem a disputa sem esconder a fila de ninguém.

### 8.5 Dívida nova: **nenhuma**

A fase não quitou nem declarou item no levantamento. O resíduo local é dado (§8.1), o
limite da catraca é decisão declarada (§8.2) e a duplicação do menu é ponto de atenção
(§8.3). **A contagem permanece em 44** (A=4, B=6, C=1, D=3, E=23, F=5, H=0, I=2).

---

## 9. Checklist de aceite

- [x] O vínculo ativo tem **desempate com significado**: `kind` (`MEMBER` → `PARTICIPANT`)
      → `joinedAt` mais antigo (`createdAt` de reserva) → `tenantId`, em memória, com o
      `orderBy` alfabético do seletor **intacto**
- [x] Com **2+ vínculos** e **nenhuma escolha**, a entrada **pergunta**
      (`/selecionar-instituicao`); com **1**, vai ao painel
- [x] O **cookie válido vence a contagem** — a escolha já dada não é recalculada, e a
      entrada seguinte vai direto ao painel
- [x] `getRequestContext()` e o adaptador de entrada consomem **o mesmo** critério
- [x] O vínculo de `WAITLISTED` **permanece** (decisão registrada), e o dano foi
      resolvido por desempate + pergunta
- [x] **4 fixtures** de 96 deixaram de criar instituição sem apagar; catraca por **AST**
      com 6 casos, sem allowlist, e **prova sintética** de que morde
- [x] **Zero resíduo novo** depois da suíte (medido no banco)
- [x] `joinedAt` **não** é reescrito pelo `db:seed:dev` nem pela inscrição pública —
      provado com o **seed real** e a data fixada em 2020 (3 casos, PostgreSQL real)
- [x] `docs/contas-de-teste.md:107` corrigido (a frase dizia que não existe contexto
      implícito; existe, e é determinístico)
- [x] E2E **inteiro** verde: **481 = 480 + 1 skip, zero vermelhos**; casos 9 e 10 do
      `f82-porta-de-entrada` passando
- [x] `docs/imagens/f83-vinculo-e-residuo.png` (antes × depois), com o spec temporário
      **apagado**
- [x] `lint` 0/0 · `typecheck` 0 · `npm test` **4492 em 252 arquivos** · `build` OK ·
      `db:verify` contrato íntegro · isolamento **9/9** · partições do mês e dos seguintes
- [x] `AGENTS.md` (estado, §9 com a linha 83, dívidas e §10), `README.md` (narrativa,
      índice e as **duas** cópias das contagens) e `docs/fases-historico.md` atualizados
