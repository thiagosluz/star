# FASE 73 — O resultado da chamada que o organizador publica

> **Estado: ENTREGUE.** Fatias 1–4 implementadas e verdes; esta fase fecha com o
> documento, as catracas, a bateria da §4 e o portão de acessibilidade.
> **ADRs 357, 358 e 359** — a próxima numeração é **ADR-360**.

---

## 1. Sumário Executivo

O comitê já decidia cada proposta desde a FASE 33 (`/comite/<submissionId>`, o
protocolo de aceite). O que **não existia** era o outro ato: o organizador publicar,
na chamada, **o resultado** — um texto público, a lista dos trabalhos aprovados e os
próximos passos — e o público ler isso na página da chamada.

A fase separou dois fatos que estavam misturados na cabeça de quem opera: **decidir**
(comitê, interno, com nota e parecer) e **publicar** (organizador, público, com texto
e lista escolhida). A publicação **deriva** da decisão por padrão — as aceitas vêm
marcadas — mas o que vai ao ar é o que o organizador **escolheu**, e o resultado tem
estado: rascunho não vaza, parcial é editável, **final trava** e reabrir é um ato com
trilha.

O princípio que define a fase: **o resultado é um ATO, não uma VISTA.**

### O que foi entregue

| Fatia | Entrega | Situação |
|---|---|---|
| 1 | Domínio puro: quatro estados, tabela legal de transições, trava do final, leitor tolerante, projeção pública com lista fechada, seletor com pré-marcação e a exceção declarada do nome completo | ✅ |
| 2 | Serviço de leitura/escrita (`FOR UPDATE` + trilha na mesma transação) e as quatro Server Actions com `event:manage` conferida na action | ✅ |
| 3 | Cartão na tela de chamadas: texto, próximos passos, seletor com a decisão ao lado, os quatro gestos, confirmação nativa do reabrir e a **prévia da projeção real**; funciona sem JavaScript | ✅ |
| 4 | Página pública: seção **Resultado** só quando há resultado publicado (nó ausente, não escondido), leitura pública própria, selo na landing via `resultState` derivado | ✅ |
| 5 | Este documento, ADRs, catracas de fonte, README/AGENTS/dívidas, bateria da §4, portão WCAG AA e as duas imagens | ✅ |

### Números da fase (medidos nesta árvore)

| Medida | Número |
|---|---|
| Migrações | **1** (`20261022120000_f73_resultado_da_chamada`) — **uma coluna** `call_for_proposals.result JSONB NOT NULL DEFAULT '{}'` |
| Arquivos de código novos | **7** (3 de domínio, 2 de serviço, 2 de componente) |
| Arquivos de código alterados | **7** (schema, actions, 2 páginas, `admin-form`, `block-renderer`, `call-service`) |
| Arquivos de teste novos | **7** (3 unitários, 2 de integração, 2 E2E) |
| Testes unitários da fase | **138** (86 domínio + 27 tela do organizador + 25 página pública) |
| Testes de integração da fase | **28** (18 serviço/actions + 10 leitura pública) |
| Casos E2E da fase | **5** (2 da tela do organizador + 3 da página pública) |
| Portão WCAG AA | **32 casos** (30 → **32**), com `ISENCOES = []` |
| Catracas de fonte | pureza dos três módulos de domínio + a exceção do nome (o módulo não importa a máscara) + as importações proibidas na página da chamada, no serviço público, no cartão, na página de chamadas e no bloco da landing |

### 1.1 Arquivos da fase

**Domínio (puro — sem Prisma, sem Next, sem relógio):**

- `src/domain/proposals/call-result-rules.ts` — estados, transições, decisão, leitor
  tolerante, projeção pública, lista fechada e seletor;
- `src/domain/proposals/call-result-organizer-rules.ts` — as frases dos estados e dos
  gestos da tela (a tela não escreve consequência no JSX);
- `src/domain/proposals/call-result-public-rules.ts` — a decisão da página: título,
  frases, tabela de visibilidade e o selo da landing.

**Aplicação:**

- `src/lib/proposals/call-result-service.ts` — leitura do painel e `applyCallResultAction`;
- `src/lib/proposals/call-result-public-service.ts` — a leitura pública própria;
- `src/app/actions/call-actions.ts` — as quatro actions (`saveCallResultDraftAction`,
  `publishPartialCallResultAction`, `publishFinalCallResultAction`,
  `reopenCallResultAction`) sobre um caminho comum;
- `src/lib/proposals/call-service.ts` — `CallView.resultState` (o **estado** derivado,
  nunca o JSON).

**Interface:**

- `src/components/proposals/call-result-card.tsx` — o cartão do organizador;
- `src/components/proposals/call-result-public-view.tsx` — a projeção desenhada
  (usada **pela prévia e pela página pública**: uma só marcação);
- `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/page.tsx`;
- `src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/chamada/[callSlug]/page.tsx`;
- `src/components/events/block-renderer.tsx` (selo na landing);
- `src/components/admin/admin-form.tsx` (`CheckboxField` ganhou `disabled`);
- `prisma/schema.prisma` + a migração.

**Testes:**

- `tests/unit/f73-resultado-da-chamada.test.ts` (86);
- `tests/unit/f73-tela-do-organizador.test.ts` (27);
- `tests/unit/f73-pagina-publica.test.ts` (25);
- `tests/integration/f73-resultado-da-chamada.test.ts` (18);
- `tests/integration/f73-resultado-publico.test.ts` (10);
- `tests/e2e/f73-resultado-do-organizador.spec.ts` (2);
- `tests/e2e/f73-resultado-publico.spec.ts` (3);
- `tests/e2e/accessibility.spec.ts` (+2 casos: a tela do organizador e a página
  pública da chamada) e `tests/e2e/call-for-proposals.spec.ts` (o locator do vizinho).

---

## 2. O Problema Mais Difícil da Fase

**Publicar sem vazar — e a exceção que precisa ser visível.**

A fase tem duas pressões opostas. De um lado, a lista de aprovados é **documento
público**: o congresso, os anais e a biblioteca citam o trabalho pelo **nome completo
da autoria**, e é o ato de aprovar que torna os autores públicos. Do outro, a casa
inteira mascara o nome de quem se oculta (a régua da dívida **E79**, fonte única em
`src/domain/profile/public-profile-rules.ts`), e a FASE 60 levou essa régua a todas as
superfícies que citam a pessoa. Se a lista "resolvesse" a tensão filtrando quem se
oculta, o documento ficaria inútil para quem precisa citá-lo; se ignorasse a ocultação
sem dizer nada, a exceção se espalharia por cópia para a próxima superfície.

A decisão do humano (decisão 2 do plano) foi **declarar a exceção**: a lista mostra o
nome completo **mesmo de quem se oculta**, e essa é a **ÚNICA** superfície assim. O
desenho da fase é o que mantém a exceção **presa** em vez de solta:

1. a exceção mora em **um ponto** da projeção (`autores.map((autor) => autor.nome)`), e
   o sinal `oculto` é lido do banco **de propósito** para que a exceção seja visível no
   dado — e **ignorado** na projeção, no único lugar onde isso acontece;
2. o módulo **não importa** `maskPersonName` nem `isPersonPubliclyVisible` — uma
   **catraca de fonte** reprova se alguém "consertar" a lista trazendo a máscara para
   cá, e reprova também se alguém levar a exceção embora;
3. um teste prova que a **mesma pessoa oculta** continua mascarada na **régua geral**
   (`maskPersonName('Ana Souza') === 'Ana S.'`, `isPersonPubliclyVisible === false`), e
   os E2E da página pública varrem o HTML;
4. o **sinal** de ocultação (`oculto`, `hidden`, `publicProfileHiddenAt`) entra na lista
   fechada de campos proibidos: publicá-lo revelaria **quem** se ocultou — o oposto do
   que a E79 protege.

É esse conjunto que **define o desenho do módulo**: a projeção pública, a lista fechada
e as catracas existem porque a exceção só é segura quando é única, declarada e medida.

---

## 3. Decisões Técnicas Explicadas

### 3.1 Quatro estados, uma tabela legal — e o final que trava

```
SEM_RESULTADO ──publicar parcial──▶ PARCIAL ──publicar final──▶ FINAL
       ▲                              │  ▲                        │
       └────────── rascunho ──────────┘  └──── reabrir (com trilha)┘
```

A tabela vive em **um** lugar (`CALL_RESULT_TRANSITIONS`) e responde três perguntas de
uma vez: de onde a ação é legal, para onde ela leva, e quais ações o estado atual
permite (`availableCallResultActions`). A tela consome a **lista pronta** — não repete
a decisão.

Três escolhas dessa tabela merecem registro:

- **De FINAL só se sai por REABRIR.** `SALVAR_RASCUNHO`, `PUBLICAR_PARCIAL` e
  `PUBLICAR_FINAL` não têm `FINAL` entre as origens. O organizador que só queria
  corrigir uma vírgula passa pelo ato que diz, na trilha, que ele reabriu — senão
  "final" seria apenas um rótulo.
- **Publicar não exige passar pelo rascunho.** `SEM_RESULTADO → PARCIAL` é legal: o
  primeiro ato já leva o texto e a lista da tela, e exigir dois cliques para a primeira
  publicação seria armadilha de uso.
- **FINAL não sai de SEM_RESULTADO.** O estado terminal só é alcançado depois de o
  resultado existir (rascunho ou parcial), para o organizador ter visto o que vira
  definitivo pelo menos uma vez.

`REABRIR` leva a **PARCIAL**, não a RASCUNHO: o texto continua no ar (o diagrama do
plano não tira o resultado do público) e "parcial" é a resposta honesta — voltou a ser
editável. A data da publicação vigente é **preservada** no reabrir; carimbar "agora"
contaria como publicação um ato que não publicou nada.

### 3.2 A lista deriva da decisão, mas é escolhida — e a pré-marcação vale só no primeiro ato

`buildCallResultSelector` devolve **todas** as submissões da chamada, com o status real
ao lado e as **aceitas pré-marcadas**. A pré-marcação existe para o organizador não
redigitar título e autoria de cada trabalho; a **escolha** é dele, e publicar não é
sinônimo de aceitar (decisão 1 do humano): um trabalho em avaliação pode ser publicado
se ele quiser — o E2E marca a caixa de `UNDER_REVIEW` e a lista sai com dois itens.

O critério da pré-marcação é o **estado**, não "a lista está vazia": um rascunho salvo
com a lista vazia (porque ele desmarcou tudo) é uma escolha, e re-marcar as aceitas ali
desfaria a decisão em silêncio. Depois do primeiro ato, a caixa reflete
`publicados` — desmarcar uma aceita e salvar continua desmarcado.

### 3.3 A coluna JSON própria na chamada — e por que `reviewRubric` não servia

O plano mandava a fatia 1 **medir** se havia coluna reutilizável. A medição está na
migração e no schema:

- `CallForProposals.reviewRubric` **existia**, mas **não era reutilizável** — e o
  motivo é semântico: é a **rubrica** da avaliação, **congela no primeiro parecer**
  (FASE 39, ADR-215/216) e é lida por `resolveEffectiveRubric` na precedência CHAMADA →
  TRILHA → PADRÃO. Guardar o resultado ali faria o resultado público depender da régua
  da avaliação, e o congelamento da rubrica congelaria junto um dado que o organizador
  precisa **republicar**.
- `Event.settings` também foi descartado: o resultado é **por chamada**. Um evento pode
  ter várias (artigo, resumo, minicurso), cada uma com a própria lista e o próprio
  texto; em `Event.settings` elas dividiriam o mesmo espaço e uma sobrescreveria a
  outra.

Conclusão medida: **não havia coluna reutilizável**. Uma coluna nova, sem tabela nova e
sem migração de dado:

```sql
ALTER TABLE "call_for_proposals" ADD COLUMN "result" JSONB NOT NULL DEFAULT '{}';
```

`DEFAULT '{}'` é o estado honesto de toda chamada que já existia: ausente é
`SEM_RESULTADO` para o leitor tolerante — e nenhuma linha nasce ambígua (`NULL` e `{}`
significariam coisas diferentes sem ninguém ter decidido isso). Coluna nova em tabela
que já tem RLS + FORCE não cria policy nova (a armadilha 101 vale para **tabela** nova),
e o contrato de banco fala de tabelas, não de colunas.

### 3.4 O leitor tolerante falha sempre para o lado de MENOS público

`readCallResult` **nunca lança** — um JSON torto não pode derrubar a página da chamada —
e devolve `{ resultado, source, problems }`:

- estado desconhecido/ausente → `SEM_RESULTADO`;
- **PARCIAL/FINAL sem `publicadoEm` → RASCUNHO**: nada vai ao público sem data de
  publicação, e inventar a data faria a seção aparecer com informação que ninguém
  publicou;
- RASCUNHO com `publicadoEm` → a data sai (rascunho não tem data de publicação);
- `SEM_RESULTADO` com conteúdo → o conteúdo é descartado;
- campo desconhecido → **reportado**, não aceito em silêncio (o spec é fechado).

Os `problems` vão para o **log** e para a tela do organizador — nunca para a página
pública. Tolerar não é ignorar.

### 3.5 A projeção pública e a lista fechada: reprova, não filtra

`projectPublicCallResult` monta a seção com **estado, data vigente, texto, próximos
passos e lista** (protocolo ou id estável, título, tipo e autoria). Nota, parecer,
revisor, e-mail, CPF, dado de inscrição, `proposalData` cru e lista de espera **não
existem no tipo** — e, no fim, `assertResultadoSemCampoProibido` **lança** se um deles
aparecer, em qualquer profundidade.

A escolha é a mesma da API do evento (FASE 72): **filtrar em silêncio** transformaria o
defeito em "campo que simplesmente não aparece", e a próxima pessoa a mexer na projeção
não teria como saber que aquele dado já saiu numa versão anterior. Lançar responde
erro (fail-closed), nomeia o campo e o caminho (`resultado.lista[0].nota`) no log e
mantém o teste vermelho enquanto o defeito existir.

A conferência é chamada **dentro** da projeção — a tela e a página pública não têm como
esquecê-la. A lista fechada usa a **mesma normalização** de nome de campo da API
(`normalizeApiFieldName`), com prefixos que cobrem famílias inteiras (`nota`, `parecer`,
`revisor`, `review`, `inscri`, `ocult`, `hidden`…): o campo mudar de `finalScore` para
`final_score` não escapa.

### 3.6 A exceção declarada, e o que ela NÃO autoriza

Ver §2. Mecanicamente: `CallResultAuthorSource` traz `{ nome, oculto }`, e a projeção
lê **só o nome**. O sinal é proibido na saída (`oculto`, `hidden`,
`publicProfileHiddenAt` estão na lista fechada). A catraca de fonte em
`tests/unit/f73-resultado-da-chamada.test.ts` lê o arquivo e reprova se ele importar
`maskPersonName` **ou** `isPersonPubliclyVisible`; um segundo teste prova a régua
geral na mesma pessoa. A consequência de projeto é aceita e declarada: **a lista é a
única superfície que ignora a ocultação**.

### 3.7 A leitura pública é própria — e a landing recebe só o ESTADO

A página pública **não** reusa `getCallResultPanel`. O painel do organizador carrega o
seletor com **todas** as submissões e o status da decisão de cada uma; reusá-lo faria o
visitante anônimo receber, no HTML, o status interno de trabalhos que ninguém publicou
— e a única coisa que separaria "o público vê" de "a organização vê" seria a marcação
da tela.

`getPublicCallResult` consulta **só** a chamada publicada (`isPublished: true`,
`deletedAt: null`, `tenantId` no filtro) e **só** as submissões de `publicados`, com
quatro campos (`protocol`, `title`, tipo da chamada e os nomes). O `select` não pede
nota, parecer, revisor, e-mail, situação interna nem `proposalData` — é isso que os
torna impossíveis de vazar, não um filtro depois. Uma **catraca de fonte** reprova o
serviço público se ele importar o serviço do painel, o seletor ou a tabela de status
das decisões.

`CallView` ganhou **`resultState`**: a landing (que lê a chamada na renderização,
ADR-168) precisa saber **se** há resultado publicado para desenhar o selo "Resultado
publicado" e o link; ela recebe o **estado derivado** por `readCallResult`, nunca o
JSON. O contrato de `/api/v1` ficou **intacto** — a projeção da API não inclui o campo,
e o teste da F72 foi ajustado só na fixture, declarando o porquê.

### 3.8 O `FOR UPDATE`, a trilha na mesma transação e a ordem das leituras

Dois atos concorrentes na **mesma** chamada se serializam:

1. `SELECT … FOR UPDATE` na linha da chamada, **antes** de qualquer leitura (um lock
   depois não serializa nada);
2. a chamada no escopo do tenant (`NOT_FOUND` se não for desta instituição);
3. os ids das submissões **desta** chamada (`deletedAt: null`);
4. a decisão do domínio;
5. a gravação do objeto inteiro + a trilha, na **mesma** transação.

Sem o lock, dois pedidos leriam o mesmo `RASCUNHO` e o ato que publicasse o final
poderia ser sobrescrito pelo que salvava um rascunho — o "final travado" viraria um
rótulo que a concorrência desfaz (invariante 5). A trilha carrega a **ação explícita**
(`SALVAR_RASCUNHO`, `PUBLICAR_PARCIAL`, `PUBLICAR_FINAL`, `REABRIR`), o estado anterior,
o novo e a contagem de publicados; o **texto não entra** (nem truncado), nem autor,
nem e-mail, nem título. Resultado e trilha commitam juntos: falha da gravação não deixa
trilha de um ato que não existiu.

### 3.9 A tela não decide legalidade — e caixa desabilitada não é enviada

`CallResultCard` recebe `acoesDisponiveis` do serviço e **filtra** a lista para os três
gestos de edição; em FINAL a lista chega `['REABRIR']` e os botões de salvar/publicar
**não existem** no DOM. Não há `if (estado === 'FINAL')` escondendo botão, e a catraca
de fonte prende isso e proíbe a quarta cópia do mapa de status (o cartão importa
`SUBMISSION_STATUS_LABELS` do domínio).

Duas armadilhas de HTML foram tratadas de frente:

- **Caixa `disabled` NÃO é enviada pelo formulário.** No FINAL os checkboxes ficam
  desabilitados, mas os ids publicados viajam em **campos ocultos** ao lado. Sem eles,
  o REABRIR gravaria lista vazia — e a prévia é asserção do E2E: depois de reabrir, ela
  mantém os **2 itens** e o texto volta a ser editável.
- **Um formulário, quatro `formAction`.** Os quatro atos gravam o mesmo conteúdo
  (texto, próximos passos, lista); quatro formulários repetiriam os campos e um deles
  ficaria para trás no primeiro ajuste. O `useActionState` de cada gesto é
  independente, e a tela mostra o retorno do gesto que acabou de ser clicado.

O reabrir usa `<details>/<summary>` (a confirmação nativa das F70/F72): anuncia, antes
do clique, que o final **deixa de ser final**, que o texto continua no ar e que o ato
fica na trilha. Sem modal de JavaScript e sem `useState`.

### 3.10 O portão WCAG AA chegou à página da chamada — e ela tinha três nós a 4,44:1

A página da chamada **nunca estava no portão**. Quando entrou, a varredura achou
**três nós** com `opacity-60` medindo **4,44:1** sobre a superfície — a mesma família da
FASE 66 (o `eyebrow` do `SectionHeading`): o link de volta, o rótulo do tipo no topo e
a nota sobre a avaliação **sobre o cartão**. A correção foi pela **causa**, com os
papéis do tema:

- link de volta e rótulo do tipo: `ef-muted` (o papel de texto de apoio do tema);
- nota sobre o cartão: `ef-muted-on-card` (o papel de apoio sobre a superfície do
  cartão).

Nenhum `opacity-*` de texto de apoio sobrou na página. O portão foi de **30 → 32**
casos (a tela do organizador e a página pública da chamada), com `ISENCOES = []`.

### 3.11 A revalidação usa os caminhos do BANCO

As quatro actions revalidam três caminhos: a tela de chamadas, a **página da chamada**
(`/eventos/<slug>/chamada/<callSlug>`) e o layout do evento (a landing). O `callSlug` e
o `eventId` vêm do **serviço** — que os leu da linha gravada —, nunca do formulário. É
a lição da FASE 68: um id de evento vindo do cliente revalida o caminho errado, e
ninguém percebe porque a revalidação não falha.

---

## 4. Registro de Decisões de Arquitetura (ADRs)

### ADR-357 — O resultado é um ATO: estados, final travado e a lista que deriva da decisão mas é escolhida

**Contexto.** O comitê decide; o público precisa de um documento com texto, lista e
próximos passos. Publicar não pode ser um "salvar" que muda o que já está no ar sem
deixar rastro — e também não pode obrigar o organizador a redigitar título e autoria de
cada trabalho aprovado.

**Decisão.** O resultado é um objeto com **quatro estados** (`SEM_RESULTADO`,
`RASCUNHO`, `PARCIAL`, `FINAL`), uma **tabela legal de transições** como fonte única e
uma trilha por ato. Só `PARCIAL` e `FINAL` produzem seção pública. O `FINAL` é terminal
e só se sai dele por `REABRIR`, que volta a `PARCIAL` e preserva a data de publicação.
A lista **deriva** da decisão (aceitas pré-marcadas no primeiro ato) e é **escolhida**
pelo organizador; rascunho salvo a partir de parcial **despublica** (perde
`publicadoEm`, e a seção sai do público).

**Justificativa.** "Final que muda por um clique de salvar" não é final: a trava é o
que dá sentido ao estado, e reabrir é o ato que diz na trilha que o documento voltou a
ser editável. Derivar a lista sem a escolher faria "publicar" virar sinônimo de
"aceitar", o que a decisão 1 do humano recusou.

**Consequências.** Cada publicação carimba a data vigente; reabrir não republica. O
domínio recusa transição ilegal com o **motivo** (inclusive o "está travado, reabra") e
recusa lista vazia numa publicação. A tela consome `acoesDisponiveis` e não recalcula
legalidade.

### ADR-358 — O resultado mora numa coluna JSON própria, e dois atos na mesma chamada se serializam por `FOR UPDATE`

**Contexto.** Havia uma coluna JSON na chamada (`reviewRubric`) e um JSON no evento
(`Event.settings`). O plano mandava medir o reuso antes de criar coluna.

**Decisão.** Medido: **não havia reuso**. `reviewRubric` é a régua da avaliação, congela
no primeiro parecer e é lida por `resolveEffectiveRubric`; sobrecarregá-la misturaria o
resultado público com a régua da avaliação e o congelamento. `Event.settings` é por
evento, e o resultado é por chamada. Entrou **uma coluna** `call_for_proposals.result
JSONB NOT NULL DEFAULT '{}'`, lida por leitor tolerante e validada pelo **domínio**
(o banco não valida JSON). A escrita faz `SELECT … FOR UPDATE` na linha da chamada
**antes** de ler, e grava resultado + trilha na mesma transação.

**Justificativa.** O resultado é um **ato lido por inteiro**, não um dado consultável
por campo: as duas datas e a lista de ids não justificam três colunas e uma tabela de
junção, e a ordem da lista é a escolha do organizador, não uma relação a filtrar em SQL.
O lock existe porque a concorrência é decidida no banco (invariante 5): sem ele, o final
travado seria desfeito por um rascunho concorrente.

**Consequências.** `DEFAULT '{}'` dá estado honesto às chamadas antigas e permite
`NOT NULL`. Coluna nova em tabela com RLS + FORCE não exige policy nova. O `FOR UPDATE`
**não tem teste de concorrência paralela** — está declarado em §8.

### ADR-359 — A exceção declarada do nome completo, e a leitura pública que entrega só o estado derivado

**Contexto.** A régua da E79 mascara o nome de quem se oculta em todas as superfícies
públicas. A lista de aprovados precisa do nome **completo** para ser documento citável.
A página pública e a landing citam o resultado, e o painel do organizador carrega
material interno (o seletor com todas as submissões e o status da decisão de cada uma).

**Decisão.** (a) A lista de aprovados é a **única** superfície que ignora a ocultação —
exceção **declarada**, decidida pelo humano (decisão 2 do plano), presa por **catraca de
fonte** (o módulo não importa a máscara) e por teste que exige a mesma pessoa oculta
seguindo mascarada na régua geral; o **sinal** `oculto` é proibido na saída. (b) A
página pública tem **leitura própria** (`getPublicCallResult`), que consulta só a
chamada publicada e só as submissões escolhidas, com quatro campos; e a landing recebe
apenas `CallView.resultState` — o estado derivado, nunca o JSON —, mantendo o contrato
de `/api/v1` intacto.

**Justificativa.** A exceção só é segura quando é **única e visível**: o dado traz o
sinal para que a exceção seja testável, e não para que ele saia. E a leitura pública
própria é o que impede o vazamento por reuso: o conjunto de dados do painel é outro, não
o código. Publicar o sinal de ocultação revelaria **quem** se ocultou — o oposto do que
a E79 protege.

**Consequências.** A lista de aprovados mostra o nome completo de quem se oculta, e isso
está documentado aqui e na §10 do `AGENTS.md`. Qualquer superfície nova que cite
resultado **não** herda a exceção por cópia: importa a projeção (que é a mesma) ou cai
na catraca. O estado na landing é barato e honesto; o texto, a lista e os próximos
passos continuam só na página da chamada.

---

## 5. Lições Aprendidas

### 5.1 As nove lições, com a evidência de cada uma

| # | Lição | Evidência |
|---|---|---|
| 1 | **O resultado é um ATO, não uma vista** | Quatro estados com tabela legal única; `FINAL` só sai por `REABRIR` (com trilha); `SALVAR_RASCUNHO` a partir de `PARCIAL` **despublica** (`publicadoEm` sai, e a prévia do E2E vira o vazio honesto). O domínio deriva a lista das decisões do comitê, e o organizador escolhe o que publica (o E2E publica um trabalho em avaliação) |
| 2 | **A exceção declarada do nome completo** (decisão 2 do plano) | A lista mostra o nome de quem se oculta; é a **única** superfície assim, presa por catraca de fonte (o módulo não importa `maskPersonName`/`isPersonPubliclyVisible`) e por teste de que a mesma pessoa segue mascarada na régua geral (`'Ana S.'`); o sinal `oculto` é proibido na saída |
| 3 | **A coluna JSON própria, e o porquê** | `reviewRubric` existia mas **não era reutilizável**: congela no primeiro parecer e é lida por `resolveEffectiveRubric`; sobrecarregá-la misturaria resultado público com régua de avaliação. `Event.settings` é por evento, e o resultado é por chamada. Medição registrada na migração |
| 4 | **O `FOR UPDATE` serializando dois atos na mesma chamada + a mutação que desligou `recordAudit` e derrubou 5 testes** | O lock vem antes da leitura; a trilha grava na mesma transação. Na mutação que removeu `recordAudit`, **5 testes** de integração reprovaram — a catraca da trilha morde. (A concorrência em si **não** tem teste paralelo: §8) |
| 5 | **Caixa desabilitada NÃO é enviada** | No `FINAL` os checkboxes ficam `disabled` e os ids publicados viajam em campos ocultos; sem eles o `REABRIR` gravaria lista vazia. A prévia manter **2 itens** depois de reabrir é asserção do E2E |
| 6 | **A tela não decide legalidade** | Recebe `acoesDisponiveis` e só filtra; catraca de fonte proíbe `if (estado === …)` escondendo botão e a **quarta cópia** do mapa de status (o cartão importa `SUBMISSION_STATUS_LABELS` do domínio) |
| 7 | **A página da chamada nunca estava no portão** | Tinha **3 nós a 4,44:1** (`opacity-60`): link de volta, rótulo do tipo e nota sobre o cartão — a mesma família da F66. Corrigida pela causa, com os papéis do tema (`ef-muted` / `ef-muted-on-card`); a página entrou no portão sem isenção nova |
| 8 | **A regressão do vizinho** | O locator do E2E do bloco de chamadas passou a casar "Publicar parcial" e quebrou **4 casos**. A fatia 4 rodou o E2E alheio, viu e corrigiu com `exact: true` **sem tocar no componente** |
| 9 | **O `resultState` no `CallView`** | A landing recebe só o **estado** derivado por `readCallResult`, nunca o JSON cru, e o contrato de `/api/v1` ficou intacto (o teste da F72 mudou só a fixture, declarando o porquê) |

### 5.2 Defeitos REAIS encontrados por testes

| Defeito | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| **A trilha desapareceu na mutação** | 5 testes de integração vermelhos ao remover `recordAudit` | A trilha é parte do ato — os testes comparam a sequência de entradas, o estado anterior e a contagem, e o "banco intacto" nas recusas | Nada a corrigir no produto: a mutação **provou** a catraca. O registro fica como a evidência de que a trilha não é decoração |
| **O reabrir apagaria a lista** | Prévia voltaria com 0 itens depois do `REABRIR` | Caixa `disabled` não é enviada pelo formulário — regra do HTML | Campo oculto `publicados=<id>` ao lado de cada caixa publicada quando `screen.locked`; o E2E assere os 2 itens depois de reabrir |
| **O vizinho quebrou** | 4 casos de `call-for-proposals.spec.ts` com erro de strict mode | O botão "Publicar parcial" do cartão novo casava com `getByRole('button', { name: 'Publicar' })` | `exact: true` no locator do E2E alheio, **sem tocar no componente**: o botão que publica a chamada continua sendo aquele |
| **3 nós a 4,44:1 na página da chamada** | O portão novo reprovou contraste | `opacity-60` em texto de apoio sobre a superfície (a mesma causa da F66) | Papéis do tema (`ef-muted`, `ef-muted-on-card`), medidos no portão |

### 5.3 O que NÃO foi medido

- **A concorrência do `FOR UPDATE` não tem teste paralelo.** O lock está no código e a
  sequência de leitura está descrita, mas não há dois processos disputando a mesma
  chamada num teste automatizado. A proteção é por construção, não por medição.
- **O tempo de render da tela de chamadas com N chamadas.** A leitura é uma por chamada
  (`Promise.all`), e o número de chamadas por evento já tem teto (`CALL_LIST_LIMIT`),
  mas a latência não foi medida.
- **O `heading-order` dos `<h5>` do componente compartilhado** não é medido pelo portão
  (é `best-practice`, fora do AA — ver §8).

---

## 6. Evidência de Verificação

> Medido nesta árvore em **2026-10-22**, com o container `web`/`worker` construído às
> **10:46** do mesmo dia. Os números são os reais; nenhum foi arredondado.

### 6.1 `npm run lint`

```text
npm notice run eventflow@0.1.0 lint
npm notice run eslint .
EXIT=0
```

**0 erros, 0 warnings.**

### 6.2 `npm run typecheck`

```text
npm notice run eventflow@0.1.0 typecheck
npm notice run tsc --noEmit
EXIT=0
```

**0 erros.**

### 6.3 `npm test` — a suíte Vitest inteira

```text
 Test Files  209 passed (209)
      Tests  3939 passed (3939)
   Start at  10:48:30
   Duration  269.10s (tests 57%, import 30%, transform 11%, worker 1%)
EXIT=0
```

**209 arquivos, 3939 testes** — eram **3773** em 204 arquivos antes da fase: **166 testes
novos** (138 unitários + 28 de integração, exatamente os arquivos `tests/f73-*`).

### 6.4 `npm run build`

```text
✓ Compiled successfully in 15.1s
Finished TypeScript in 58s ...
EXIT=0
```

O `next build` listou as rotas da fase (`…/chamadas` e `…/chamada/[callSlug]`), sem rota
nova — a fase não criou endereço, mudou o conteúdo de dois existentes.

### 6.5 `npm run db:verify`

```text
  ✓  Nenhuma tabela com RLS ficou sem policy
  ✓  Role "eventflow_app" sem superuser e sem BYPASSRLS
  ✓  GRANTs mínimos presentes, TRUNCATE ausente
  ✓  Tabela(s) de plataforma inalcançável(is) pela role "eventflow_app"

  Contrato íntegro.
  EXIT=0
```

A migração adiciona **uma coluna** a uma tabela que já tinha RLS + FORCE: nenhuma policy nova,
nenhum privilégio novo.

### 6.6 `npm run db:verify:isolation`

```text
  ✓  [A8] Contexto de tenant não vaza para a transação seguinte (SET LOCAL)
         count = 0 (esperado 0 — a conexão voltou limpa ao pool)
  ✓  [A9] Role de runtime não consegue desligar a RLS nem escalar privilégio
         todas as tentativas rejeitadas

  9/9 verificações passaram.
  Isolamento entre tenants garantido pelo banco.
  EXIT=0
```

### 6.7 `npm run db:partitions`

```text
PARTIÇÕES DE audit_logs
· todas as partições do intervalo já existiam
audit_logs_2026_10              54023    30.27 MB
audit_logs_2026_11                  0     0.04 MB
audit_logs_2026_12                  0     0.04 MB
total: 97895 linha(s)
EXIT=0
```

As partições do mês atual e dos seguintes existem (a rotina do worker já as criou).

### 6.8 O container — a imagem é a nova

```text
eventflow/web:local     2026-10-22 10:46:03 -0300 -03
eventflow/worker:local  2026-10-22 10:46:31 -0300 -03
```

O primeiro `--build` desta bateria **falhou** por DNS do Docker (`EAI_AGAIN` em
`binaries.prisma.sh`), e o `docker compose` manteve as imagens **velhas** de 2026-10-19 no ar —
a armadilha clássica. O Docker Desktop foi reiniciado (o DNS interno não respondia), o build
foi repetido e concluiu (`Built`, containers **Recreated** e `healthy`); a data acima é a
prova de que o E2E mediu o código desta fase.

### 6.9 E2E — a suíte inteira

```text
Running 401 tests using 1 worker
...
  2 failed
    [chromium] › tests/e2e/f62-regressao-visual.spec.ts:1969:3 › rodapé público da plataforma › 13. o rodapé público da raiz no claro
    [chromium] › tests/e2e/f62-regressao-visual.spec.ts:1982:3 › rodapé público da plataforma › 14. o rodapé público da raiz no escuro
  1 skipped
  398 passed (21.4m)
```

**401 casos no total** (400 ativos + 1 skip): **398 passando**, **2 vermelhos
PRÉ-EXISTENTES** (o snapshot do rodapé da raiz, §6.10) e **1 skip**. Nenhum vermelho novo — e
os cinco casos da fase passaram **também isolados**, com o container servindo a imagem nova:

```text
Running 5 tests using 1 worker
  ✓ 1 f73-resultado-do-organizador.spec.ts:338  a jornada: publicar parcial → prévia → final travado → reabrir → editar → rascunho não vaza (4.2s)
  ✓ 2 f73-resultado-do-organizador.spec.ts:499  SEM JavaScript: escrever, escolher e PUBLICAR de verdade (1.7s)
  ✓ 3 f73-resultado-publico.spec.ts:433          o organizador publica e o visitante lê — sem a avaliação no HTML (2.3s)
  ✓ 4 f73-resultado-publico.spec.ts:525          salvar rascunho esconde a seção do público — e o selo da landing (2.1s)
  ✓ 5 f73-resultado-publico.spec.ts:587          despublicar a chamada tira a página do ar (404, como hoje) (658ms)

  5 passed (15.8s)
```

Os **dois casos novos do portão** também passaram dentro da suíte inteira:

```text
✓ 9  accessibility.spec.ts:1603  a página pública da chamada com resultado publicado não tem violação crítica (2.5s)
✓ 32 accessibility.spec.ts:2538  a página de chamadas com o cartão do resultado não tem violação crítica (4.3s)
```

### 6.10 Os vermelhos pré-existentes, medidos isolados

**f62 — o snapshot do rodapé da raiz (claro e escuro).** Rodei só os dois casos:

```text
npx playwright test tests/e2e/f62-regressao-visual.spec.ts -g "rodapé público da raiz"
...
Expected an image 1440px by 3262px, received 1440px by 3362px.
235478 pixels (ratio 0.05 of all image pixels) are different.   ← rodape-publico-claro.png
950293 pixels (ratio 0.20 of all image pixels) are different.   ← rodape-publico-escuro.png
  2 failed
```

**Reproduzido fora da fase.** O diagnóstico é o que a linha de base já declarava: o snapshot é
da **página inteira** da raiz e a página mostra **lista e métricas dinâmicas**; a captura de
hoje tem **100 px a mais de altura** (3262 → 3362) porque a lista/contagem de eventos mudou
desde a captura da linha de base. **A FASE 73 não toca a raiz** (mudou a tela de chamadas e a
página da chamada); o vermelho não é regressão desta fase, e não foi mascarado: nenhum `skip`,
nenhum `--update-snapshots`, nenhuma tolerância afrouxada.

**f65 — a aba "Acontecendo agora".** Rodei o bloco isolado:

```text
npx playwright test tests/e2e/f65-exportacao.spec.ts -g "Acontecendo agora"
Running 2 tests using 1 worker
  ✓ 1 a navegação é por link com aria-current, e a aba mostra o que está em curso (2.6s)
  ✓ 2 sem nada em curso, a faixa NÃO aparece na programação (793ms)

  2 passed (6.3s)
```

**Não reproduziu nesta execução** — e ele também passou na suíte inteira. A causa descrita na
fase anterior é a asserção que **recalcula `Date.now()`**: se o minuto virar entre a montagem da
fixture e a leitura da faixa, a atividade que "acontece agora" muda de estado. Fica registrado
como **intermitente** (não como verde conquistado): a próxima execução pode encontrá-lo
vermelho, e o diagnóstico é este.

**Nenhum outro vermelho.** Fora os dois do f62, a suíte passou inteira.

### 6.11 As catracas, com a mutação

Duas mutações foram aplicadas e **revertidas**, para provar que as catracas de fonte mordem de
verdade:

1. **Importar o painel do organizador no serviço público**
   (`import { getCallResultPanel } from './call-result-service'`):

   ```text
   ❯ tests/unit/f73-pagina-publica.test.ts (25 tests | 1 failed)
   × não importa o painel do organizador nem o seletor da lista
   AssertionError: expected '…' not to contain 'call-result-service'
   ```

2. **Trazer a régua da E79 para o módulo do resultado**
   (`import { maskPersonName } from '@/domain/profile/public-profile-rules'`):

   ```text
   ❯ tests/unit/f73-resultado-da-chamada.test.ts (86 tests | 1 failed)
   × CATRACA: a exceção mora em UM arquivo, que NÃO importa a régua da E79
   AssertionError: expected '…' not to contain 'public-profile-rules'
   ```

Restaurados os dois arquivos, `npx vitest run` dos dois arquivos voltou a **111 passed**. A
mutação da **trilha** (remover `recordAudit`) foi feita na fatia 2 e derrubou **5 testes** de
integração — registrada na §5.2, não repetida nesta bateria.

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
docker images --format "{{.Repository}}:{{.Tag}} {{.CreatedAt}}" | grep eventflow

# A suíte E2E inteira, com a saída FORA da árvore
npm run test:e2e -- --output=../f73-e2e-results

# Só a fase
npx playwright test tests/e2e/f73-resultado-do-organizador.spec.ts \
                   tests/e2e/f73-resultado-publico.spec.ts

# O portão de acessibilidade, só as duas telas da fase
npx playwright test tests/e2e/accessibility.spec.ts -g "resultado"

# A tela do organizador
# /t/<slug>/administracao/eventos/<eventId>/chamadas  → cartão "Resultado da chamada"

# A página pública (só existe seção com PARCIAL/FINAL publicado)
# /t/<slug>/eventos/<eventSlug>/chamada/<callSlug>  → seção "Resultado"

# O resultado gravado, lido pelo leitor tolerante (a coluna é JSONB)
psql "$DATABASE_URL" -c \
  'SELECT id, title, result->>'"'"'estado'"'"' AS estado, result->'"'"'publicados'"'"' FROM call_for_proposals'
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

Esta fase **não quitou nem declarou** dívida do levantamento (`docs/dividas-tecnicas.md`
continua com **41**). O que ela deixa **aberto e declarado**:

1. **`heading-order` nos `<h5>` do componente compartilhado.**
   `call-result-public-view.tsx` usa `<h5>` para "Lista publicada" e "Próximos passos"
   dentro de uma `<section>` que a página envolve com `<h2>`/`<h4>`. O `axe` acusa
   `heading-order` — que é **best-practice**, **não** critério AA — e o portão da fase **não**
   reprova por isso (ele mede as violações críticas). Mexer nesse componente mudaria a
   hierarquia de telas que já o usam; o certo é uma passada de headings no sistema, não um
   remendo local. **Declarado, não escondido.**
2. **O `resultState` não é exposto em `/api/v1`.**
   A API da F72 tem contrato fechado e a fase o manteve intacto: a landing recebe o **estado
   derivado** no `CallView`, mas a resposta pública de `/api/v1/…/chamadas` não ganhou o
   campo. Quem consome a API e quiser o documento lê a página da chamada. Expor (ou não) é
   decisão de contrato, com versão — não um efeito colateral desta fase.
3. **A concorrência do `FOR UPDATE` não tem teste paralelo.**
   O lock está no código, na ordem certa (antes da leitura), e a trilha é gravada na mesma
   transação. O que **não** existe é um teste com dois processos disputando a mesma chamada:
   a proteção é por construção e revisão, não por medição. Um teste desses precisa de duas
   conexões e um ponto de sincronização — fica declarado como cobertura, não como defeito.
4. **A quarta cópia do mapa de status não foi removida das telas antigas.**
   O cartão novo importa `SUBMISSION_STATUS_LABELS` do domínio (a catraca proíbe a cópia
   nova), mas `submissoes/page.tsx`, `submissoes/[submissionId]/page.tsx` e `comite/page.tsx`
   ainda têm o próprio mapa. A fase **evitou** a quarta cópia; unificar as três é uma
   limpeza de telas vizinhas, fora do escopo — e por isso não foi feita "de passagem".
5. **O tempo de render da tela de chamadas não foi medido.**
   A leitura é uma por chamada (`Promise.all`), com teto de chamadas por evento, mas não há
   medição de latência (§5.3).

---

## 9. Checklist de Aceite

- [x] **A lista deriva das decisões e o organizador escolhe** — todas as submissões da
      chamada aparecem com o status ao lado, as aceitas pré-marcadas, e ele desmarca o que
      não quer publicar (inclusive publicar um trabalho em avaliação).
- [x] **Nome completo sempre, como exceção declarada** — a lista mostra o nome mesmo de quem
      se oculta; é a única superfície assim, presa por catraca de fonte e por teste da régua
      geral.
- [x] **O final trava** — mudar exige reabrir, com confirmação nativa e trilha; reabrir volta
      a parcial e preserva a data da publicação vigente.
- [x] **Público para qualquer visitante** — seção Resultado na página da chamada e selo na
      landing; rascunho e sem-resultado não criam nó (nem título, nem espaço).
- [x] **Texto, lista e próximos passos** — os três publicados com estado e data; nada mais
      (nota, parecer, revisor, e-mail, CPF, `proposalData`) atravessa a projeção.
- [x] **Coluna própria medida antes de criada** — `reviewRubric` e `Event.settings` recusados
      com o motivo; uma coluna JSONB com `DEFAULT '{}'`, sem tabela nova e sem migração de
      dado.
- [x] **Trilha por ato na mesma transação** — quatro ações explícitas, estado anterior e novo,
      contagem de publicados; o texto não entra na trilha.
- [x] **`FOR UPDATE` antes da leitura** — dois atos na mesma chamada se serializam (cobertura
      de teste paralelo declarada em §8).
- [x] **A tela não decide legalidade** — recebe `acoesDisponiveis`, só filtra; catraca de
      fonte proíbe `if (estado === …)` escondendo botão e a quarta cópia do mapa de status.
- [x] **Caixa desabilitada não é enviada** — no final, os ids publicados viajam em campos
      ocultos; o E2E assere a prévia com 2 itens depois de reabrir.
- [x] **Funciona sem JavaScript** — o E2E publica de verdade num contexto com
      `javaScriptEnabled: false` e confere o estado no banco.
- [x] **Prévia é a projeção real** — o mesmo componente desenha a prévia e a página pública;
      a prévia vazia explica de onde o conteúdo virá.
- [x] **Leitura pública própria** — consulta só a chamada publicada e só as submissões
      escolhidas, com quatro campos; catraca de fonte proíbe importar o painel do organizador.
- [x] **O contrato de `/api/v1` ficou intacto** — só `CallView` ganhou o estado derivado.
- [x] **A página da chamada entrou no portão WCAG AA** — 30 → 32 casos, `ISENCOES = []`, e os
      três nós a 4,44:1 corrigidos pela causa (papéis do tema).
- [x] **A regressão do vizinho foi vista e corrigida** — `exact: true` no locator do E2E de
      chamadas, sem tocar no componente.
- [x] **Documento, ADRs, README, AGENTS e dívidas** — este arquivo, ADR-357/358/359,
      `README.md`, `AGENTS.md` (fases 29 a 73, contagens, linha 73, §10) e
      `docs/dividas-tecnicas.md`.
- [x] **Bateria da §4 completa** — lint, typecheck, `npm test`, build, `db:verify`,
      `db:verify:isolation`, `db:partitions` e a suíte E2E inteira, com os vermelhos
      pré-existentes medidos isolados.

---

**Aguardando APROVADO: AVANÇAR**

