# FASE 77 — O organizador novo

> **Estado: ENTREGUE.** Quatro fatias: o caminho de partida, a exportação do evento,
> a tela de exemplo e o fechamento. ADR-369 … 371.

---

## 1. Sumário Executivo

A fase nasceu de três ideias para responder à pergunta "por onde começo?". Medido, **duas
delas já existiam em outra forma** e a terceira tinha problema de desenho: a prontidão
(FASE 53) já dizia o que falta, a exportação (FASE 49) já existia inteira, e um "modo
demonstração que grava" produziria dado **sem desfazer possível**. O trabalho não foi
construir as três: foi **ligar o que já existe onde a pessoa procura**, e **não construir**
a que produziria dívida.

O número que abriu o diagnóstico é também o que definiu o desenho: a régua da prontidão
tem **sete pendências** e **nenhuma delas é a página publicada**; um evento **em rascunho,
com o prazo de inscrição preenchido e nada mais**, sai com **ZERO pendências** — o painel
diz "Tudo em ordem" — e, na mesma tela, ainda não há por onde o público entrar. Um guia de
três passos que fosse um recorte do painel **discordaria dele no primeiro dia**.

### O que foi entregue

| Fatia | Entrega | Números medidos |
|---|---|---|
| **1** | `eventLaunchPath` — domínio puro com **três fatias e os fatos que o render JÁ tem** (`registrationHasDeadline`, `activityCount > 0`, `pagePublished`); a faixa dentro da seção de prontidão; os rótulos honestos; e o **link morto** de `sem-programacao` consertado **por estrutura** | **3 passos** · **zero consulta nova** · **5 `<section>` e 17 cartões intactos** · **2 funções novas** de catálogo (`eventAreaTestId`, `findEventAreaByTestId`) · a palavra "pronto" **varrida** em 4 estados |
| **2** | O painel de exportação na raiz (dentro de "Operar", como `div`); o gate por `participant:read` **TENANT** (a mesma regra da action); o **recorte na projeção** (as CTEs passam a respeitar o `eventId`); o **XP troca de fonte**; o novo `ATTENDANCES_CSV` em **formato longo** | **1 migração** (valor de enum) · **2 botões** · **3 colunas removidas** do arquivo do evento · **15 → 12** colunas no recorte · **`ExportKind` 2 → 3** · prova empírica **3/3/210 → 2/2/90** |
| **3** | `/t/<slug>/exemplo` — demo de **LEITURA**: guarda por **vínculo** (`requirePageMembership`, sem `can()`), fixtures tipadas de **um** evento com **um exemplo de cada entidade**, banner `demo-banner`, entrada **só no estado vazio**, e a **catraca** que reprova escrita no escopo do demo | **7 seções** na tela · **29 de 43 tabelas** sem `deletedAt` (o número que matou o "demo que grava") · **1 catraca** com 4 varreduras · **hash antes/depois** idêntico |
| **4** | O documento, o estado sob o teto e a bateria; **2 casos novos no portão WCAG AA** (raiz do evento e exemplo) e o **E2E da exportação na raiz** — e o defeito que o portão **achou** no componente compartilhado | portão **37 → 39 casos** · **1 spec novo** de E2E · **1 defeito real** corrigido sem isenção (`MetaList`/`MetaItem`) |

### Números da fase (medidos nesta árvore)

```text
Arquivos de produção tocados ..... 22 (7 novos + 15 alterados)
  novos .......................... event-launch-path.ts (181), attendance-export-rules.ts (104),
                                   attendance-export-service.ts (245), event-export-panel.tsx (81),
                                   demo/demo-event.ts (313), exemplo/page.tsx (462),
                                   migration (20)
  alterados ...................... event-areas.ts, event-readiness.ts, export-rules.ts,
                                   export-service.ts, export-access.ts, guard-page.ts,
                                   participant-service.ts, export-panel.tsx, export-actions.ts,
                                   page.tsx da raiz (568 linhas), eventos/page.tsx,
                                   participantes/page.tsx, sponsor-experience-panel.tsx,
                                   schema.prisma, components/ui/data.tsx (MetaList/MetaItem)
Casos novos (Vitest) ............. 56 em 6 arquivos (42 de unidade + 14 de integração)
Suíte Vitest ..................... 241 arquivos · 4313 testes · 0 vermelhos
                                    (eram 235 / 4257 na F76)
Casos novos (E2E) ................ 5 em 2 arquivos (3 no spec da exportação + 2 no portão axe)
Suíte E2E ........................ 458 (455 passando + 2 pré-existentes + 1 skip)
ADRs ............................. 369, 370 e 371 (a próxima é a 372)
Migrações ........................ 1 (20261023120000_f77_presencas_por_atividade)
Portão WCAG AA ................... 37 → 39 casos, ISENCOES = []
```

### 1.1 Arquivos da fase

**Produção — o caminho de partida (fatia 1)**

```text
src/domain/events/event-launch-path.ts ....... 181 linhas (novo) — as três fatias, o alvo e a nota
src/domain/events/event-areas.ts ............. +28 linhas — eventAreaTestId / findEventAreaByTestId
src/domain/events/event-readiness.ts ......... o alvo de `sem-programacao` sai da fonte única
src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/page.tsx
                                               a faixa dentro da prontidão + o painel de exportação
```

**Produção — a exportação do evento (fatia 2)**

```text
src/domain/exports/export-rules.ts ................. ATTENDANCES_CSV, rótulos de ação e canExportEventData
src/domain/exports/attendance-export-rules.ts ...... 104 linhas (novo) — a linha longa e as 3 ausências
src/lib/exports/attendance-export-service.ts ....... 245 linhas (novo) — contar e coletar por evento
src/lib/exports/export-service.ts .................. o tipo novo no pedido, no arquivo e na lista
src/lib/exports/export-access.ts ................... presenças exigem o MESMO público do diretório
src/lib/participants/participant-service.ts ........ o recorte na projeção, o XP do livro-razão,
                                                     o cabeçalho derivado da coluna e as 3 colunas fora
src/components/exports/export-panel.tsx ............ `kinds` (um botão por tipo), sem `hidden` de tipo
src/components/exports/event-export-panel.tsx ...... 81 linhas (novo) — o gate e o recorte já preenchidos
src/app/actions/export-actions.ts .................. `atividade` no schema e nos filtros
prisma/schema.prisma ............................... `DataExportKind.ATTENDANCES_CSV`
prisma/migrations/20261023120000_.../migration.sql . ALTER TYPE ... ADD VALUE IF NOT EXISTS
```

**Produção — o exemplo (fatia 3)**

```text
src/domain/demo/demo-event.ts ..................... 313 linhas (novo) — a fixture e os rótulos
src/app/t/[tenantSlug]/(app)/exemplo/page.tsx ..... 462 linhas (novo) — a tela de leitura
src/lib/auth/guard-page.ts ........................ +63 linhas — requirePageMembership
src/app/t/[tenantSlug]/(app)/administracao/eventos/page.tsx
                                                     a entrada pelo estado vazio
```

**Testes**

```text
tests/unit/f77-caminho-de-partida.test.ts ......... 242 linhas · 10 casos
tests/unit/f77-exportacao-do-evento.test.ts ....... 330 linhas · 16 casos
tests/unit/f77-demo-de-leitura.test.ts ............ 370 linhas · 10 casos
tests/unit/f77-demo-guarda.test.ts ................ 146 linhas · 6 casos
tests/integration/f77-caminho-de-partida.test.ts .. 365 linhas · 4 casos (render real das 4 fases)
tests/integration/f77-exportacao-do-evento.test.ts  784 linhas · 10 casos (o recorte, o formato longo,
                                                     o DRAFT e o teto)
tests/e2e/f77-exportacao-do-evento.spec.ts ........ 3 casos (o E2E da raiz, §6.9)
tests/e2e/accessibility.spec.ts ................... +2 casos (raiz do evento e exemplo)
```

**O conserto que o portão obrigou**

```text
src/components/ui/data.tsx .... MetaList/MetaItem — o `dt`/`dd` deixou de ser NETO do `<dl>`
```

---

## 2. O Problema Mais Difícil da Fase

**Um número com rótulo de recorte tem de ser do recorte.**

A exportação da FASE 49 tinha um filtro chamado `?evento=`. Ele filtrava **quem aparece**:
a lista de pessoas do arquivo era, de fato, a das inscritas no evento. E as colunas
numéricas — Inscrições confirmadas, Presenças, Visitas, Minutos, Comparecimento,
Certificados, Cartas, XP — vinham de CTEs agregadas **por instituição**, sem `eventId`.

O resultado é o pior tipo de defeito: **o arquivo está certo nas linhas e errado nas
colunas**, e o rótulo diz "do evento". Uma pessoa inscrita em dois eventos aparecia no CSV
do Congresso com a vida dela na instituição inteira. Medido, no cenário do teste de
integração (Ana com inscrição nos dois eventos, presença em três atividades, dois
certificados, cinco cartas e 120 XP):

```text
                         instituição        evento A        o que o organizador leria
Visitas .................      3                2           "2 visitas no congresso" (mas eram 3)
Minutos .................    210               90           "90 minutos" (mas eram 210)
Certificados ............      2                1
Cartas ..................      5                2
XP ......................    120               50
```

O conserto não é no filtro, é na **projeção** — e é isso que define o desenho da fatia:
se o recorte ficasse na tela, qualquer leitura nova (um relatório, um e-mail, a API) teria
de lembrar de aplicá-lo. Ele foi para o SQL, no mesmo lugar em que os números nascem.

E há uma consequência que só aparece depois do conserto: **há colunas que não podem ser
recortadas**. "Eventos" é quantos eventos a pessoa tem na instituição; "Rótulos" é o
engajamento dela na casa. Recortá-las pelo evento daria **1** para todo mundo e chamaria de
"Primeira participação" quem está na casa há anos. A decisão foi: **o que não pode ser
recortado sai do arquivo recortado**, em vez de mudar de sentido. E o XP, que é um
acumulado na instituição (`user_xp_profiles.totalXp`), **trocou de fonte**: o recorte lê o
**livro-razão** (`xp_transactions.eventId`), que é append-only e tem o evento de cada
lançamento.

A segunda consequência é a **forma do arquivo**: presença por atividade não cabe numa
coluna por pessoa. Uma pessoa com vinte atividades geraria vinte colunas de número e
nenhuma de horário; e o teto de 5.000 linhas estouraria antes (800 inscritos × 4
atividades × 2 visitas já passa de 6.000). A saída foi um **tipo novo de exportação**, em
**formato longo**: uma linha por sessão.

Por isso o problema mais difícil é o título deste documento: ele obriga a decidir, coluna
por coluna, **o que o recorte significa** — e a forma do arquivo passa a ser consequência
do recorte, não uma escolha de layout.

---

## 3. Decisões Técnicas Explicadas

### 3.1 O guia responde OUTRA pergunta (e por isso não é um recorte do painel)

**O que foi descartado.** Um "guia de três passos" montado sobre a prontidão:
"dados + programação + página". Ele **contradiria o painel**:

- os três passos não são o critério da prontidão: um evento com os três ainda pode ter
  `inscricoes-sem-prazo` e, no ar, `sem-inscricao`;
- um evento **sem página e sem atividade** é rascunho e sai com **zero pendências** — dois
  sinais opostos na mesma dobra. O organizador novo aprende a não confiar em nenhum;
- marcar "Programação" como passo num rascunho seria cobrar o que o painel **cala de
  propósito** (rascunho tem programação vazia por definição).

**O que foi feito.** `eventLaunchPath(fatos)` — domínio puro, **três fatias**, cada uma com
**um fato que o render já carrega**:

| Passo | Rótulo | Fato | Alvo |
|---|---|---|---|
| 1 | **Dados e prazos** | `event.registrationClosesAt !== null` | `event-area-dados` |
| 2 | **Programação** | `activityCount > 0` | `event-area-programacao` |
| 3 | **Página no ar** | `contagens.pagePublished === true` | `landing-link` |

Três decisões de desenho dentro dessa tabela:

1. **"Dados e prazos", não "Dados Básicos".** O formulário já exige nome, data e local, e o
   sistema **não confere nada disso em lugar nenhum**. Um passo chamado "Dados Básicos"
   prometeria uma validação que não existe. O fato que a tela conhece — e que muda o estado
   do evento — é o **prazo** de inscrição.
2. **"Página no ar", não "Página publicada".** O que interessa a quem começa é se há um site
   para divulgar. E `pagePublished: null` (página nunca criada) é **PENDENTE**: não se
   afirma "no ar" sobre o que não foi conferido — a mesma régua de `null ≠ 0` que a F54
   usou no selo dos cartões.
3. **A palavra "pronto" não entra.** O painel fala de conclusão do que atrapalha; o guia
   fala de começo. A frase do caso 3/3 é "Os três passos de partida foram dados" — nunca
   "o evento está pronto". O teste varre **todos** os textos que o domínio produz (rótulos,
   dicas, alvos, estados, resumo e a nota) nos **quatro** estados possíveis. A palavra
   sobrevive no **título da seção de prontidão** ("O que falta para este evento ficar
   pronto"), que é da FASE 53 — por isso a varredura do HTML mede **a faixa**, e a do
   domínio mede **o que o guia produz**.

**Onde ele mora.** Dentro da seção de prontidão, **acima da lista**. Não é uma 6ª seção: a
raiz tem **cinco `<section>`** no DOM (prontidão + quatro grupos) e **17 cartões**; uma
seção nova entre a prontidão e o mapa empurraria os cartões de Configurar para baixo da
dobra — e o organizador perderia justamente o atalho que o guia promete. A faixa é um
`<ol>` de verdade, com os números em texto ("1.", "2.", "3."): leitor de tela anuncia a
sequência sem depender de contador de CSS, e tudo funciona sem JavaScript (são links do
servidor).

**A nota que reconcilia os dois.** Uma linha, dentro da faixa:

> "Os passos de partida mostram por onde começar; as pendências dizem o que atrapalha agora."

Sem ela, um evento em rascunho com zero pendências mostraria "Tudo em ordem" e "a fazer" na
mesma dobra. Com ela, as duas leituras são perguntas diferentes — e o teste de integração
prende **o mesmo HTML** com o guia em 1/3 e o painel com `sem-programacao` e `sem-inscricao`.

**O que NÃO foi feito:** transformar a página publicada numa **8ª pendência**. Isso mudaria
a filosofia declarada da F53 ("pendência que não é acionável não entra" e "o que falta para
ir ao ar" não é "o que está quebrado agora") e faria o guia virar recorte puro de um painel
que passou a cobrar o que ele nunca cobrou. Fica declarado no §8.

### 3.2 O alvo se resolve no catálogo — e o teste que prendia o defeito

O painel de prontidão linka o título de cada pendência **só quando o `targetTestId` casa com
o `data-testid` de um cartão**. A pendência `sem-programacao` apontava para
`activities-section` — o `<details>` que a FASE 55 **removeu da raiz** ao transformar as
seções em páginas. O testid sobreviveu lá dentro, mas na raiz não existe mais: o título
deixou de ser clicável e ninguém percebeu por duas fases.

Por que ninguém percebeu: o teste da F53 que devia prender isso tinha a lista de alvos
**escrita à mão** —

```ts
const alvos = new Set([
  'confirmations-link', 'calls-link', 'landing-link', 'event-area-salas',
  'activities-section', 'tracks-section', 'event-area-dados',
]);
```

— e `activities-section` estava **na lista**. O teste media a lista, não a tela: **prendia o
defeito**.

A correção é estrutural, em dois movimentos:

1. **A derivação virou fonte única**, em `event-areas.ts`:

```ts
export function eventAreaTestId(area: EventArea): string {
  return area.legacyTestId ?? `event-area-${area.id}`;   // ADR-302 preserva os atalhos legados
}
export function findEventAreaByTestId(testId: string): EventArea | undefined { … }
```

   Três lugares precisam da **mesma** resposta: o cartão, o painel de prontidão e o caminho
   de partida. Repetir a regra em cada um é como o alvo continuou escrito à mão enquanto a
   tela mudava.

2. **A whitelist do teste passou a derivar do catálogo**:

```ts
const alvos = new Set(EVENT_AREAS.map(eventAreaTestId));
```

   Agora uma pendência só passa se o render **tiver** para onde linkar. E o alvo de
   `sem-programacao` passou a ser o cartão da Programação — o destino que existe e o certo:
   criar a atividade é o que resolve a pendência.

**A prova por mutação** (feita nesta árvore, com hash): devolver `activities-section` ao
domínio derruba **três** casos — o teste da F53 (a lista agora derivada) e **dois** da F77
(o alvo literal e o "nenhum alvo morto"). O arquivo voltou ao hash original.

`targetOf()` no guia é a mesma ideia levada ao limite: ele busca a área **no catálogo** e
**lança** se ela não existir. Um passo de partida não pode nascer com alvo inexistente —
o defeito é de programação e estoura no teste de unidade, antes de a tela renderizar um
link morto.

### 3.3 O recorte na projeção — e o que a tela passou a dizer

`listParticipants` monta uma consulta com CTEs. A mudança foi cirúrgica: `buildFilters`
devolve o `$n` do evento, e **cada** CTE que mede um fato de evento recebe o mesmo recorte
por uma função só:

```ts
function eventScope(eventParam: string | null, alias: string): string {
  return eventParam ? `AND ${alias}."eventId" = ${eventParam}::uuid` : '';
}
```

O recorte entra em `registrations`, `attendances`, `certificates`, `user_cards` e
`xp_transactions`. Sem evento, o SQL é o de antes — e os números do diretório inteiro não
mudam (o teste prende as **duas** leituras).

**O que continua sendo da PESSOA** — e por isso **não** passa pelo recorte: `events`,
`attendedEvents` e os rótulos de engajamento. Eles são lidos **fora** do recorte, em **uma**
consulta, com os ids da página (no máximo 100), e **só quando há evento**: sem filtro, a
consulta principal já é a da instituição e esses números vêm dela. Recortá-los diria a um
veterano que ele é novo na casa — e a coluna "Eventos" valeria 1 para todo mundo.

**A tela passou a declarar o recorte.** No diretório de participantes, com um evento
escolhido, aparece uma linha (`participant-event-scope`) dizendo que inscrições, presenças,
visitas, minutos, comparecimento, certificados, cartas e XP **são deste evento**, e que o
total de eventos e os rótulos continuam sendo da pessoa na instituição. Número que muda de
significado sem avisar é o mesmo defeito por outro caminho.

**A forma do arquivo também é do recorte.** O cabeçalho deixou de ser uma lista e a linha
outra lista "na mesma ordem por convenção": cada coluna declara **rótulo e valor**, e o
cabeçalho é derivado. Desalinhar deixou de ser possível — e daí sai, de graça, a lista do
arquivo do evento.

```text
Arquivo da instituição (15 colunas)      Arquivo do evento (12 colunas)
Nome · E-mail · Origem · Eventos ·       Nome · E-mail · Origem ·
Inscrições confirmadas · Presenças ·     Inscrições confirmadas · Presenças ·
Eventos com presença · Visitas ·         Visitas · Minutos · Comparecimento (%) ·
Minutos · Comparecimento (%) ·           Certificados · Cartas · XP ·
Certificados · Cartas · XP ·             Última presença
Rótulos · Última presença
```

**Por que as três saíram** — e não ficaram com outro nome:

- `Eventos` e `Eventos com presença`: recortados pelo evento, valeriam **1** (ou 0) para
  todo mundo. Um número que não varia não é informação: é a linha inteira dizendo "esta
  pessoa está neste evento".
- `Rótulos`: engajamento é classificação da **pessoa** na instituição. Calculá-lo do
  recorte chamaria de "Primeira participação" quem está na casa há anos.

**A prova empírica** (§6, mutação): com `eventScope` devolvendo `''`, o primeiro número a
quebrar é `Inscrições confirmadas: 3` — o total da instituição com o rótulo do evento. Era
exatamente o defeito.

### 3.4 O XP trocou de fonte — e o que não tem `eventId` fica fora

`user_xp_profiles.totalXp` é **acumulado por instituição**. Não há como recortá-lo: ele é
um contador, não um extrato. Com o evento informado, o XP passou a vir de
`xp_transactions` (`sum(amount)` por `userId`, filtrando `eventId`) — o **livro-razão**,
append-only, que guarda o evento de cada lançamento. Sem evento, a leitura continua a de
sempre (o perfil), e o número do diretório não muda.

A consequência é uma regra, não um esquecimento: **cartas e XP sem `eventId` ficam fora do
arquivo do evento, por definição**. `user_cards.eventId` e `xp_transactions.eventId` são
nuláveis: uma carta da instituição (sem evento) e um ajuste manual de XP não pertencem a
nenhum recorte. Somá-los ao arquivo "do evento" seria devolver o número global pela porta
dos fundos. O teste prende os dois lados: no evento, Cartas = 2 e XP = 50; na instituição,
Cartas = 5 e XP = 120.

### 3.5 Formato longo nas presenças — e as três ausências ditas

O tipo novo, `ATTENDANCES_CSV`, entrega **uma linha por sessão**:

```text
Atividade · Pessoa · Entrada · Saída · Minutos
```

**Por que o formato curto (uma coluna por atividade) não sobrevive:**

- o teto do arquivo é de **5.000 linhas**, e presença é mais numerosa que pessoa: 800
  inscritos × 4 atividades × 2 visitas passa de **6.000**;
- a **sessão** (entrada/saída) é a unidade do fato (ADR-149): quem entrou duas vezes na
  mesma atividade tem duas janelas, e uma coluna por atividade só caberia a soma — que é
  justamente a informação que se perde;
- com **20 atividades**, a planilha de 800 pessoas teria 20 colunas de número e nenhuma de
  horário.

**As três ausências que o arquivo não esconde** (o `null ≠ 0` da casa):

| Situação | O que a linha diz | Por quê |
|---|---|---|
| `activityId` nulo | **`(sem atividade)`** | é a **chegada ao evento** (portaria, ADR-149). Sumir com ela faria o arquivo mostrar **menos** presenças do que o evento teve |
| `checkedOutAt` nulo | **`(em aberto)`** | a sessão não foi encerrada. Horário inventado seria mentira; a coluna **diz** o estado |
| `minutesAttended` nulo | **célula vazia** | o minuto não foi apurado. `null` não é `0`: zero é "ficou zero minuto", vazio é "não se sabe" |

Os instantes saem no **fuso do evento** — é onde a sessão aconteceu e onde o organizador lê
a lista de presença. A ordem é a da lista impressa: atividade → pessoa → entrada; e a
chegada sem atividade fica no fim (o banco ordena `NULL` por último no `ASC`).

O escopo é **sempre um evento**, e ele precisa existir: sem evento, "presenças por
atividade" seria a instituição inteira linha a linha; e um id inexistente é **recusado**
(`NOT_FOUND`), não vira um CSV de zero linhas — arquivo vazio parece "ninguém compareceu",
quando o que houve foi pedido errado. Atividade de outro evento é `INVALID_INPUT`.

O arquivo continua **não sendo guardado** (F49): o pedido grava o recorte (`eventId` +
`activityId`), o prazo de 24 h e a marca d'água; o download o regera.

### 3.6 O demo de leitura — o número que matou o "modo demonstração"

A ideia original era um botão que criasse um evento de verdade no tenant. **Três números
mataram:**

- **29 das 43 tabelas** que o dataset toca **não têm `deletedAt`** — presença, XP
  (livro-razão append-only), certificados, salas, demandas, versões de página, papéis (só
  `revokedAt`), `audit_logs` (particionada);
- **não existe exclusão de evento no produto** (`ARCHIVED` é status e **não libera quota**),
  e o guarda de atividade **recusa** apagar quando há presença — o sistema já decidiu que
  registro com presença não se apaga;
- a quota de eventos do próprio tenant demo é **3** (o seed grava o plano PROFESSIONAL e
  não as quotas): "40 eventos" é impossível e "alguns" fica **irremovível**.

Agravantes: `xp_transactions` e `user_cards` têm `eventId` **`SET NULL`** — apagar o evento
deixaria XP e cartas no extrato/álbum da pessoa para sempre; e `audit_logs.tenantId` é
`SET NULL`, então a trilha **sobrevive órfã**. O que apareceria: a trilha de
`/administracao` mostra as últimas **15** (40 eventos falsos escondem o real por dias), a
lista de eventos pega 100 e ensina a ignorar o painel de prontidão, e `/panorama` e
`/superadmin` passam a mentir sobre a plataforma inteira.

**O que foi feito: o oposto.** Um evento **fictício, imutável**, que existe só na memória do
render (`src/domain/demo/demo-event.ts`). Nenhuma linha de banco nasce dali, a RLS nem
entra, e não existe ação de escrita para alguém clicar. **Um** evento basta: o objetivo é
mostrar a **forma** das telas, com uma entidade de cada — duas atividades, uma chamada, uma
inscrição, uma presença, uma carta e uma demanda. Quarenta eventos, além de esconderem o
real, só repetiriam a forma.

A tela (`/t/<slug>/exemplo`) abre por **vínculo**, não por permissão:
`requirePageMembership` confere sessão + vínculo ATIVO na instituição da URL. Exigir
`event:update` fecharia a porta justamente para quem **acabou de criar a instituição** — o
caso da entrada pelo estado vazio. A guarda **não devolve nem autoriza dado algum**: o
exemplo é fixture fixa, então não há consulta para proteger.

O selo `demo-banner` é a primeira coisa depois do título, e diz o que o exemplo **não é** (um
evento da instituição), para onde ele **não vai** (lista, relatório, exportação, certificado)
e o que ele **não faz** (gravar). Números e datas são **inventados** — e fixos: 12 de
novembro de 2026, 08:00–18:00, no fuso `America/Bahia` (o mesmo da fixture), para a tela ser
idêntica em qualquer servidor.

**A catraca que sustenta a decisão** (`tests/unit/f77-demo-de-leitura.test.ts`) varre os
arquivos do demo (`src/app/**/exemplo/**` + `src/domain/demo/**` + `src/components/demo/**`,
que nem existe hoje) e reprova:

```text
withTenant · adminPrisma · prisma · import de src/lib/db · import de src/app/actions
'use server' · <form> · method de escrita · action={...} · type="submit"
fetch( · revalidatePath · redirect
```

A varredura **remove comentários** antes de procurar: a justificativa da decisão **cita**
`withTenant`, `revalidatePath` e `fetch` para dizer por que eles não estão lá, e comentário
não executa. Ela também **confere que não passou por lista vazia** (≥ 2 arquivos, e a página
entre eles) — catraca que varre zero arquivo é verde para sempre.

**A prova por hash** (§6.11): com o arquivo original em
`EBD57D02…C7FF77`, a inserção de `export function naoUsada() { return fetch('/mutacao') }`
mudou o hash para `AE0EBBDF…F63771` e a catraca reprovou
`src/domain/demo/demo-event.ts: chama fetch(`; restaurado, o hash voltou a
`EBD57D02…C7FF77`.

### 3.7 O que ficou de fora, de propósito

- **`.xlsx` nativo.** Não há biblioteca de planilha no projeto (nem `pdf-lib`; o PDF e o ZIP
  são escritos à mão) e o **CSV com BOM já abre no Excel pt-BR**, que é a razão declarada do
  BOM. Se alguém quiser OOXML um dia, o escritor de ZIP já existe e OOXML é ZIP de XML — sem
  dependência nova.
- **A página como 8ª pendência da prontidão** (§3.1).
- **Um `git mv` das fases antigas do `AGENTS.md`** — proposto no §8, não executado sem
  autorização.
- **O demo no menu.** A entrada é só no estado vazio da lista de eventos: é ajuda para quem
  está começando, não área do produto.

---

## 4. Registro de Decisões de Arquitetura (ADRs)

### ADR-369 — O caminho de partida responde outra pergunta; e o alvo de qualquer guia/painel se resolve NO CATÁLOGO

**Contexto.** O organizador novo abre a raiz do evento e não sabe por onde começar. A
prontidão (F53) responde "o que atrapalha agora" e tem sete pendências — nenhuma delas é a
página. Um evento em rascunho com prazo preenchido sai com **zero** pendências ("Tudo em
ordem") e, ao mesmo tempo, não tem página nem programação. Um guia recortado do painel
produziria dois sinais opostos na mesma dobra.

**Decisão.**

1. O guia é uma função de domínio nova (`eventLaunchPath`) com **três fatias** e os **fatos
   que o render já tem** — **nenhuma consulta nova**. Ele mora **dentro** da seção de
   prontidão, acima da lista, e **não** é uma seção (a raiz tem cinco `<section>` e 17
   cartões por contrato).
2. Os rótulos são os do fato que o sistema conhece ("Dados e prazos", "Programação",
   "Página no ar"), e a palavra **"pronto" é proibida** nos textos do guia, por varredura.
3. Uma **nota** dentro da faixa reconcilia as duas leituras em uma linha.
4. **Todo alvo** (do guia e das pendências) é resolvido **no catálogo de áreas**
   (`eventAreaTestId` / `findEventAreaByTestId`); a lista de alvos do teste da F53 deixou de
   ser escrita à mão e **deriva de `EVENT_AREAS`**.

**Alternativas descartadas.**

- *Guia como recorte da prontidão*: contradiria o painel (acima).
- *Guia como 6ª seção*: empurraria os 7 cartões de Configurar para baixo da dobra.
- *Guia de links estático*: as três áreas já são cartões do mapa; seria o mapa com menos
  informação.
- *Página como 8ª pendência*: mudaria a filosofia declarada da F53 e faria o guia virar
  recorte de um painel que passou a cobrar o que nunca cobrou.
- *Whitelist de alvos escrita à mão no teste*: foi ela que **prendeu o defeito** por duas
  fases (aceitava `activities-section`, um alvo que a F55 removeu da raiz).

**Consequências.**

- O guia **nunca** diz que o evento está pronto: 3/3 é "os três passos de partida foram
  dados". O painel continua sendo o único lugar que fala de pendência.
- Um passo novo com alvo inexistente **estoura no domínio**, não vira link morto na tela.
- O teste da F53 e o da F77 agora reprovam juntos quando um alvo deixa de existir (provado
  por mutação).
- O guia **não filtra** os três links por permissão de área: quem administra o evento mas
  não pode editar a página vê o passo "Página no ar" e o cartão leva a `/pagina`, que
  **redireciona**. É um ponto de atenção declarado (§8), não um vazamento — a tela de
  destino continua guardada.

---

### ADR-370 — O arquivo "do evento" é do EVENTO: o recorte mora na projeção, o que não pode ser recortado SAI, e a presença é longa

**Contexto.** A exportação da F49 tinha `?evento=` filtrando **quem aparece**, enquanto
todas as colunas numéricas vinham de agregações **por instituição**. Um CSV "do evento"
entregava as pessoas do evento com a vida inteira delas na instituição — e não havia
presença por atividade em arquivo nenhum. Botão novo sobre número errado **piora**: dá cara
de recorte a um total global.

**Decisão.**

1. **O recorte mora na PROJEÇÃO.** `eventScope` entra em todas as CTEs que medem fato de
   evento (`registrations`, `attendances`, `certificates`, `user_cards`,
   `xp_transactions`), com o **mesmo** parâmetro do filtro. O filtro da tela e o número do
   arquivo passam a ser a mesma coisa.
2. **O que é da PESSOA não é recortado** (`events`, `attendedEvents`, rótulos), e é lido
   **fora** do recorte, em uma consulta, só quando há evento.
3. **O que não pode ser recortado SAI do arquivo recortado** (`Eventos`, `Eventos com
   presença`, `Rótulos`) — em vez de mudar de sentido.
4. **O XP troca de fonte**: acumulado do perfil → **livro-razão** (`xp_transactions.eventId`).
   Cartas/XP **sem `eventId` ficam fora**, por definição.
5. **A forma do arquivo é do recorte**: o cabeçalho é **derivado** da declaração de coluna
   (rótulo + valor), e a lista do evento sai por filtro — 15 → 12 colunas.
6. **Presenças por atividade** viram um `ExportKind` novo (`ATTENDANCES_CSV`), em **formato
   longo** — uma linha por sessão —, porque o formato curto não sobrevive ao teto de 5.000
   nem a 20 atividades. As três ausências são **ditas** (`(sem atividade)`, `(em aberto)`,
   minutos vazios).
7. **A tela declara o recorte** no diretório de participantes (`participant-event-scope`).
8. O painel entra na raiz, **dentro de "Operar"** e **depois dos cartões**, como `div`
   (`surface="div"`), com o recorte já preenchido; o gate é `canExportEventData` — a
   **mesma** função que a action reconfere.

**Alternativas descartadas.**

- *Recortar na tela (pós-processar as linhas)*: qualquer leitura nova (relatório, e-mail,
  API) teria de lembrar de aplicar o recorte.
- *Manter as colunas "da pessoa" no arquivo do evento*: dariam 1 para todo mundo.
- *Recalcular o rótulo de engajamento do recorte*: chamaria de "Primeira participação" quem
  está na casa há anos.
- *Formato curto (uma coluna por atividade)*: estoura o teto e perde a sessão.
- *`<select>` de tipo no painel*: esconderia a segunda opção atrás de um clique; **dois
  botões** mostram as duas, e cada um é um submit (nada de JavaScript). O `kind` vai no
  `name`/`value` do **próprio botão** — com dois botões, um `hidden` de tipo seria enviado
  junto e o POST diria sempre o mesmo tipo.
- *Criar uma permissão "de presença"*: não existe no catálogo, e criá-la faria o organizador
  exportar a lista de inscritos e não a de presença — a mesma pessoa no mesmo evento.
- *Levar o painel para "Resultado"*: exportação é trabalho do dia do evento, não resultado.

**Consequências.**

- O número do arquivo e o número da tela passam a ser o mesmo — e a tela diz de que recorte
  ele é.
- O arquivo do evento **não tem a mesma cara** do arquivo da instituição: é isso que impede
  o organizador de ler um total global achando que é do evento.
- `ATTENDANCES_CSV` é um valor de **enum no banco** (migração): o `kind` do pedido é dado
  histórico, e um arquivo de 2027 precisa continuar sabendo o que foi exportado.
- O evento em `DRAFT` **exporta**: o filtro que esconde rascunho é do diretório, não do dado.
- A janela de recentes é de **30 por tipo** e o filtro pelo evento acontece **depois** —
  pedir só as 5 últimas da instituição faria a exportação deste evento sumir da lista assim
  que cinco outros eventos exportassem.

---

### ADR-371 — A demonstração de um clique não escreve no dado real: fixture de leitura, guarda por vínculo e catraca

**Contexto.** A ideia era um botão que criasse um evento de demonstração. A medição recusou:
**29 das 43 tabelas** do dataset não têm `deletedAt`; **não existe exclusão de evento** no
produto; o guarda de atividade **recusa** apagar o que tem presença; e a quota de eventos do
tenant demo é **3**. `xp_transactions`/`user_cards` são `SET NULL`, então apagar o evento
deixaria XP e cartas para sempre; `audit_logs` sobrevive órfã. Criar sem poder desfazer é
dívida, não demonstração.

**Decisão.**

1. A demonstração é uma **tela de LEITURA** (`/t/<slug>/exemplo`) sobre uma fixture
   **imutável e pura** do domínio (`src/domain/demo/demo-event.ts`): nenhuma linha de banco
   nasce dali, a RLS nem entra, e não existe ação de escrita para clicar.
2. **Um** evento, com uma entidade de cada (2 atividades, 1 chamada, 1 inscrição, 1 presença,
   1 carta, 1 demanda) — a forma das telas, não um catálogo.
3. A guarda é **vínculo** (`requirePageMembership`), não permissão: quem acabou de criar a
   instituição e o participante sem papel de organização entram; quem não tem vínculo cai no
   destino da casca. A guarda **não autoriza dado** (não há dado real).
4. O selo `demo-banner` diz o que o exemplo não é, para onde não vai e o que não faz.
5. A entrada é **só no estado vazio** da lista de eventos — ajuda de quem começa, não área
   do produto (por isso não está no menu).
6. **Uma catraca de fonte** varre os arquivos do demo e reprova banco, action, `'use server'`,
   `<form>`, `submit`, `action={}`, `method` de escrita, `fetch`, `revalidatePath` e
   `redirect`; ela remove comentários (a justificativa cita os termos) e **prova que não
   varreu lista vazia**.

**Alternativas descartadas.**

- *Demo que grava*: sem desfazer (§ acima), e as 40 linhas falsas escondem o evento real na
  trilha (últimas 15) e na lista (100).
- *Guardar por `event:update`*: fecharia a porta de quem mais precisa do exemplo.
- *Tela pública (sem guarda)*: o exemplo parece um evento da instituição; um visitante
  anônimo não deve encontrá-lo por URL.
- *Exceção na catraca para "só uma consultinha"*: a catraca não tem exceção hoje; se um dia
  precisar, a exceção entra com o motivo escrito — nunca em silêncio.

**Consequências.**

- Nenhum dado nasce, logo não há desfazer a prometer, e a tela é idêntica em qualquer
  servidor (datas fixas, fuso da fixture).
- A garantia não depende de alguém lembrar da decisão: a catraca reprova a alteração antes
  de a rota subir. **A prova por hash está em §6.11.**
- O demo **não é medido pelo E2E de dados** e **está no portão WCAG AA** (é uma tela como
  outra qualquer). E foi o portão que **achou um defeito real** no componente compartilhado:
  `MetaList`/`MetaItem` deixavam o `dt`/`dd` **neto** do `<dl>` (`definition-list` + `dlitem`,
  4 + 34 nós). Nenhuma outra tela usa o componente — por isso ele sobreviveu a todas as
  varreduras anteriores. Corrigido **sem isenção** (§5.2).
- A catraca da F69 (rótulos de modalidade) **pegou** a fixture nova: ela varre **todo** o
  `src/`, e um rótulo escrito à mão no dado reprovou. A correção foi usar a fonte única
  (`eventModalityLabel`), não abrir exceção — sinal de que as catracas atravessam fases
  (§5.1, lição 7).

---

## 5. Lições Aprendidas

### 5.1 As lições, com a evidência de cada uma

| # | Lição | A evidência (medida nesta árvore) |
|---|---|---|
| 1 | **O guia não pode ser uma segunda régua.** Duas listas na mesma tela que respondem "o que falta" discordam no primeiro dia — e o organizador acredita na mais conveniente. Um guia de partida é **outro recorte**: fatos que o render já tem, rótulos do fato, e a palavra "pronto" proibida por varredura | prontidão com **7 pendências**, **nenhuma** é a página; rascunho com prazo = **ZERO** pendências ("Tudo em ordem") e **1/3** no guia, no **mesmo HTML** (integração); "pronto" varrida em **4 estados** e **3 textos** |
| 2 | **O alvo se resolve no catálogo.** `targetOf()` sobre `EVENT_AREAS` torna impossível apontar para cartão inexistente — e a whitelist do teste que aceitava o alvo morto passou a derivar do catálogo (o teste **prendia** o defeito) | `sem-programacao` apontava para `activities-section`, removido da raiz pela F55; a mutação que o devolve derruba **3 casos** (F53 + 2 da F77); hash restaurado idêntico |
| 3 | **Número com rótulo de recorte tem de ser do recorte.** O `?evento=` filtrava quem aparece e entregava agregados da instituição | empírico **3/3/210 → 2/2/90** (visitas/minutos); a mutação que anula `eventScope` reprova com `Inscrições confirmadas: 3` (era 2); **3 colunas saem** do arquivo do evento (Eventos, Eventos com presença, Rótulos) |
| 4 | **O XP trocou de fonte** (perfil acumulado → livro-razão recortado); **cartas/XP sem `eventId` ficam fora** do arquivo do evento, por definição | evento: Cartas **2**, XP **50**; instituição: **5** e **120** — os dois lados presos no teste de integração |
| 5 | **Formato longo nas presenças.** O curto não sobrevive ao teto de 5.000 nem a 20 atividades; as três ausências são **ditas** | 1 linha por sessão; `(sem atividade)`, `(em aberto)` e minutos **vazios** (`null ≠ 0`); teto de 5.000 com `truncated` no pedido |
| 6 | **Demo não escreve no dado real.** Os números da recusa (**29 de 43** tabelas sem `deletedAt`; **não existe** exclusão de evento; quota do tenant demo = **3**) e a alternativa de leitura, sustentada por catraca | catraca com **4 varreduras**; prova por hash `EBD57D02… → AE0EBBDF… → EBD57D02…`, com a reprovação `chama fetch(` |
| 7 | **A catraca de outra fase pegou o arquivo novo** — as catracas atravessam fases | a catraca da F69 (rótulos de modalidade, que varre **todo** o `src/`) reprovou a fixture do demo por rótulo escrito à mão; corrigido com a **fonte única**, sem exceção |

### 5.2 Defeitos REAIS encontrados pelos testes

| Defeito | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| **O link morto que duas fases não viram** | o título de `sem-programacao` não era clicável na raiz | o alvo era `activities-section`, um `<details>` que a FASE 55 removeu da raiz **ao transformar as seções em páginas**; e a whitelist do teste da F53 **listava** o alvo morto, então o teste media a lista e não a tela | derivação em `eventAreaTestId` (fonte única) e a whitelist derivando de `EVENT_AREAS`; o alvo passou a ser o cartão da Programação |
| **A vírgula que derrubava a consulta inteira** | a consulta do diretório com evento falhava por **sintaxe**, não por dado | o `WITH` era montado como texto corrido e, quando o XP recortado (uma CTE condicional) não existia, **sobrava uma vírgula** — e o PostgreSQL recusa a consulta inteira | as CTEs passaram a ser montadas **em partes** e juntadas com vírgula (`ctes.join(',\n')`), então a condicional some inteira |
| **O índice como segundo argumento do `.map`** | o React renderizaria `"0"`, `"1"`, `"2"` no meio da página | `{grupos.filter(...).map(grupoDeAreas)}` passava o **índice** como segundo parâmetro do molde, e o molde ganhou um parâmetro `extra` (`ReactNode`) — o índice virou filho | as chamadas passaram a ser funções explícitas (`(grupo) => grupoDeAreas(grupo, …)`), com o motivo escrito no código |
| **O teste que prendia o próprio defeito** | o teste "toda pendência aponta para um atalho que EXISTE" estava verde com um alvo inexistente | a lista de alvos era um `Set` de literais, mantido à mão | o conjunto passou a ser `EVENT_AREAS.map(eventAreaTestId)` |
| **A fixture do demo fora da fonte única** | a catraca da F69 reprovou o arquivo novo | rótulo de modalidade escrito à mão no dado | a tela passou a ler `eventModalityLabel`, e o dado guarda só `'IN_PERSON'` |
| **O `<dl>` com `dt`/`dd` netos** | o caso novo do portão reprovou a tela do exemplo com **`definition-list` (4 nós) e `dlitem` (34 nós)** | `MetaItem` desenhava `dl > div > div > dt + dd`: o `div` interno existia para empilhar rótulo e valor e deixava o par **neto** do `<dl>`, o que a especificação não permite (o único agrupamento aceito é UM `div` com os pares). Nenhuma outra tela usa `MetaList`, então o defeito nunca tinha sido medido | o `div` virou o próprio grupo (`grid gap-1`), com o ícone **dentro** do `dt`; sem isenção nova, e o caso do portão passou a medir a tela |

**A lição que os cinco compartilham:** *teste que mede uma cópia da verdade (lista à mão,
rótulo à mão, string montada) fica verde enquanto a verdade muda.* A correção é sempre a
mesma: **derivar da fonte**.

### 5.3 O que NÃO foi medido

- **O ganho de tempo do organizador** com o guia: não há instrumentação de produto para isso,
  e o teste mede o **conteúdo** da faixa, não o comportamento de quem usa.
- **A exportação de presenças com 20 atividades**: o teto e o formato longo são provados com
  5.001 sessões (o teto) e com 3 atividades no cenário de recorte; 20 atividades caberia no
  mesmo raciocínio, mas não é um caso medido.
- **A leitura do exemplo por leitor de tela real**: o portão mede `axe` (WCAG AA), não a
  experiência com NVDA/VoiceOver.
- **O `?evento=` inválido** (dívida E89) continua caindo em outro evento: fora do escopo
  desta fase.

---

## 6. Evidência de Verificação

### 6.1 `npm run lint`

```text
> eslint .
(sem saída — 0 erros, 0 warnings)
```

### 6.2 `npm run typecheck`

```text
> tsc --noEmit
(sem saída — 0 erros)
```

### 6.3 `npm test` — a suíte Vitest inteira

```text
 Test Files  241 passed (241)
      Tests  4313 passed (4313)
   Duration  257.85s
```

Eram **235 arquivos / 4257 testes** na F76: **+6 arquivos** (os seis `f77-*`) e **+56 casos**.

**Uma nota de honestidade sobre a primeira execução.** A primeira rodada da bateria teve
**1 vermelho**: `tests/integration/f51-sponsor-qr-repeat.test.ts` — "duas pessoas lendo dois
QRs recebem até quatro créditos" (`scan.ok` falso). O teste **passa isolado** (15/15) e
**passou na segunda execução completa**; a fase não toca em QR de patrocinador, e a falha
é da família "teste de integração sob carga" (o `ok:false` não dizia o motivo). Foi feito o
que fecha a porta para a próxima: **a asserção passou a carregar a mensagem**
(`expect(scan.ok, JSON.stringify(scan))`), para que uma recusa real — QR desativado, QR não
encontrado ou banco sem resposta — apareça no relatório em vez de um booleano. É um ponto de
atenção declarado no §8, não um vermelho escondido.

### 6.4 `npm run build`

```text
✓ Compiled successfully in 6.3s
├ ƒ /t/[tenantSlug]/exemplo
```

A rota do exemplo é listada como **dinâmica** (`ƒ`): ela lê sessão e cookie de contexto para a
guarda, então não pode ser pré-renderizada.

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
9/9 verificações passaram.
Isolamento entre tenants garantido pelo banco.
```

### 6.7 `npm run db:partitions`

```text
PARTIÇÕES DE audit_logs
· todas as partições do intervalo já existiam
total: 109870 linha(s)
```

### 6.8 O container — a imagem é a nova

```text
docker compose --profile app up -d --build web worker
   Image eventflow/web:local Built
   Container eventflow-web Recreated / Started (healthy)
docker images | grep eventflow/web
   eventflow/web:local   2026-10-23 11:07:38 -0300
```

A imagem foi reconstruída **duas vezes**: a segunda depois do conserto de `MetaList`/`MetaItem`
(§5.2), e a data acima é a da segunda — a que rodou a bateria de E2E.

A migração nova é **de enum** (`ALTER TYPE "DataExportKind" ADD VALUE 'ATTENDANCES_CSV'`). O
banco do container é o mesmo do host, e o fluxo usado foi **`npm run db:migrate:deploy`**
(`prisma migrate deploy` + `prisma generate` + `db:rls`) — e **não** `db:setup`, porque
`db:setup` chama `prisma migrate dev` (interativo e com `reset` possível) e o passo `db:seed`
recria os tenants de demonstração. O valor foi conferido direto no catálogo:

```sql
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
 WHERE t.typname='DataExportKind';
 → ATTENDANCES_CSV · PARTICIPANTS_CSV · SPONSOR_CONTACTS_CSV
```

E a rota nova responde: `/t/ufba-demo/exemplo` devolve **307** (redirect para o login, porque a
guarda é de vínculo) — **não 404**.

### 6.9 E2E — a suíte inteira

```text
imagem docker ..................... eventflow/web:local · 2026-10-23 11:07:38 (o `--build` da fase)
migração no container ............. `npm run db:migrate:deploy` (migrate deploy + generate + rls;
                                    o banco já tinha o valor do enum, conferido em pg_enum)
npx playwright test --output %TEMP%\f77-e2e

  2 failed
    [chromium] f62-regressao-visual.spec.ts:1969 › 13. o rodapé público da raiz no claro
    [chromium] f62-regressao-visual.spec.ts:1982 › 14. o rodapé público da raiz no escuro
  1 skipped
  455 passed (13.3m)
```

**458 no total** (455 passando + 2 pré-existentes + 1 skip) — eram **453** na F76, e a diferença
é exatamente o que a fase acrescentou: **3** casos no `f77-exportacao-do-evento.spec.ts` e **2**
no portão de acessibilidade.

**Os dois vermelhos são os pré-existentes da F76**, e os números ficam na mesma faixa de ruído
de lá (§6.10): não são regressão da fase. Nenhum outro vermelho apareceu — em particular, os
specs de **participantes** e de **exportação** (`data-export-and-identity-audit`,
`participant-center` e `f65-exportacao`) continuaram verdes com o painel de dois botões: o
`data-testid` do botão único (`export-participants-create`) foi preservado de propósito quando
o painel tem **um** tipo, e o `kind` passou a ir no `name`/`value` do próprio botão.

**Nenhum spec precisou ser consertado pela faixa nova.** As asserções de posição do
`f53-painel-e-areas` (grupos, cartões e a ausência de `<details>`) continuam valendo porque o
painel de exportação entra **depois** dos cartões de "Operar", como um `div`; e a única
mudança de markup fora da fase — o `MetaList`/`MetaItem` (§5.2) — foi exigida pelo **portão**,
não por um spec de comportamento.

### 6.10 O `f62` (regressão visual), medido isolado

```text
npx playwright test tests/e2e/f62-regressao-visual.spec.ts --output %TEMP%\f77-f62
  2 failed · 21 passed (54.5s)

13. claro:  Expected 1440×3262, received 1440×3334
            233.442 pixels (ratio 0,05)
14. escuro: Expected 1440×3262, received 1440×3334
            820.411 pixels (ratio 0,18)
```

**Diagnóstico.** Os dois casos fotografam a **página inteira** de `/` (`fullPage`) para garantir
que o rodapé esteja na imagem — e a raiz é a tela mais dinâmica da plataforma: destaques,
métricas e listas mudam com o seed e com a data. A altura medida mudou de **3262** para
**3334** px (+72), e o diff acompanha. A **F76 mediu os mesmos dois vermelhos** com
**233.342 / 820.309** px (e **233.049 / 820.021** numa execução anterior dela); esta bateria
mediu **233.442 / 820.411** — a mesma faixa, com a variação que a própria lista de destaques
explica. O escuro difere mais (18% × 5%) porque o mesmo deslocamento desloca mais área de
contraste alto sobre o fundo escuro. Ficam **vermelhos e declarados**: regenerar a linha de
base é ato deliberado, e fazer isso no fecho de uma fase esconderia a próxima regressão real.

### 6.11 As catracas, com a mutação (hash antes/depois)

```text
demo (catraca de escrita)
  ANTES   EBD57D0268C336199EC3CF5DBC9A644B2AE12424DB9C5DFDB711D086E5C7FF77
  MUTADO  AE0EBBDF9203C7C804DFD5202DE16C2A6A1496EA4C4EAD21DF2C695B62F63771
          (export function naoUsada() { return fetch('/mutacao') })
  REPROVOU src/domain/demo/demo-event.ts: chama fetch(
  RESTAU  EBD57D0268C336199EC3CF5DBC9A644B2AE12424DB9C5DFDB711D086E5C7FF77  (idêntico)

alvo morto (F53 + F77)
  ANTES   6B62682919AB7435FF58D01A6EE5B9F70F937B5AEE1FD0FBF7F22F90DD2EF2D3
  MUTADO  F5DED0D1EA5C8858CEB23106BDFBE7C8EA6523C4C29ABBE2649FD26FFA6D737F
          (targetTestId: 'event-area-programacao' → 'activities-section')
  REPROVOU 3 casos: "toda pendência aponta para um atalho que EXISTE na tela" (F53),
          "aponta para o cartão da Programação" e "não sobrou nenhum alvo morto" (F77)
  RESTAU  6B62682919AB7435FF58D01A6EE5B9F70F937B5AEE1FD0FBF7F22F90DD2EF2D3  (idêntico)

palavra proibida
  ANTES   05782244EA66491B4B3DF6038F2213F8E90047C9D833AF8006B5111D1D3AFACF
  MUTADO  ("O evento está pronto: os três passos foram dados.")
  REPROVOU 2 casos (o 3/3 e a varredura da palavra)
  RESTAU  05782244EA66491B4B3DF6038F2213F8E90047C9D833AF8006B5111D1D3AFACF  (idêntico)

recorte (projeção)
  ANTES   B09A9DE524B9D55FCA662768BD782AC1C51F4FBB57E2B5FAABB78220F26B3792
  MUTADO  7DC7BFFE4A8B11B3B0B82DF3F73A15C38ACE68ACA5B9EB4D6A971C92566EFE0B
          (eventScope devolvendo '')
  REPROVOU 2 casos; o primeiro: "expected 3 to be 2" (Inscrições confirmadas)
  RESTAU  B09A9DE524B9D55FCA662768BD782AC1C51F4FBB57E2B5FAABB78220F26B3792  (idêntico)
```

### 6.12 As imagens

```text
docs/imagens/f77-caminho-de-partida.png ... a faixa dentro da prontidão, na raiz do evento
docs/imagens/f77-demo.png ................. a tela de exemplo com o banner
```

Capturadas da tela real com spec temporário, apagado depois (a limpeza está em §7).

---

## 7. Comandos Operacionais

```bash
# o que a fase acrescentou
npm run db:setup                       # aplica a migração do enum + verifica + seed

# testes da fase
npx vitest run tests/unit/f77-caminho-de-partida.test.ts
npx vitest run tests/unit/f77-exportacao-do-evento.test.ts
npx vitest run tests/unit/f77-demo-de-leitura.test.ts
npx vitest run tests/unit/f77-demo-guarda.test.ts
npx vitest run tests/integration/f77-caminho-de-partida.test.ts
npx vitest run tests/integration/f77-exportacao-do-evento.test.ts

# navegador
npx playwright test tests/e2e/f77-exportacao-do-evento.spec.ts
npx playwright test tests/e2e/accessibility.spec.ts
npx playwright test tests/e2e/f62-regressao-visual.spec.ts

# limpeza
npm run e2e:clean
```

```text
Telas ....... /t/<slug>/administracao/eventos/<eventId>   → "Por onde começar" + exportação (Operar)
              /t/<slug>/exemplo                          → o evento de exemplo (leitura)
Arquivo ...... GET /api/t/<slug>/exportacoes/<exportId>/arquivo  (sessão; 410 se vencida)
Recortes ..... ?evento=<uuid> (inscritos) · ?evento=<uuid>&atividade=<uuid> (presenças)
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

**Nenhum item novo no levantamento.** A contagem continua **42** (A=4, B=6, C=1, D=3, E=22,
F=5, H=1, I=0). A fase não quitou item de dívida: ela **ligou o que existia** e fechou **três
defeitos que não estavam no levantamento** (o link morto, o recorte da projeção e o `<dl>` do
`MetaList`/`MetaItem`) — achados **pela medição e pelo portão desta fase**, e por isso
registrados aqui e nas lições, não como código de dívida.

**Pontos de atenção declarados (sem código de dívida):**

- **A faixa do guia mora DENTRO de "Operar".** A exportação é trabalho do dia do evento, e o
  bloco entra depois dos quatro cartões do grupo. Consequência: **um papel com
  `participant:read` e sem permissão de Operar perderia o painel** — hoje não existe esse
  papel (quem tem `event:update` no TENANT é OWNER/ADMIN/ORGANIZER, e os três têm
  `participant:read`), mas a dependência existe e está dita.
- **A janela de recentes é de 30 por tipo** (`listRecentDataExports(limit: 30)`), porque o
  filtro pelo **evento** acontece depois. Um evento com mais de 30 exportações de um mesmo
  tipo pode não ver a mais antiga na lista (o pedido recém-criado vem por `?exportacao=` e
  não depende da janela).
- **`pagePublished: null` também ocorre quando a leitura das contagens FALHA.** O passo
  "Página no ar" vira **"a fazer"** em vez de "não conferido" — é a resposta segura (não se
  afirma o que não se sabe), mas é uma **indistinção** entre "não existe" e "não consegui
  ler". O selo dos cartões tem o mesmo comportamento desde a F54 (sem selo).
- **A faixa do guia não filtra os 3 links por permissão da área.** O mapa de cartões filtra
  (`visibleEventAreas`); a faixa, não. Quem administra o evento e não pode editar a página
  vê o passo 3 e o cartão leva a `/pagina`, que **redireciona**. A tela de destino continua
  guardada — é atrito, não vazamento.
- **As datas do demo são fixas (nov/2026).** Em 2027 o exemplo mostrará um evento "do
  passado" com inscrições abertas. É o preço de uma tela determinística; corrigir exige
  decidir se o demo acompanha o calendário (e aí deixa de ser determinístico) ou se ganha
  uma nota do tipo "exemplo congelado".
- **O demo não está no menu, de propósito.** A entrada é só no estado vazio de
  `/administracao/eventos`; quem já tem evento não encontra o exemplo por navegação (só por
  URL). É ajuda de onboarding, não área do produto.
- **A exportação com 20 atividades não é um caso medido** (§5.3): o formato longo cobre o
  raciocínio, mas 20 atividades × N pessoas não está na bateria.
- **Teste de integração sob carga**: a primeira execução da suíte teve **1 vermelho
  intermitente** em `f51-sponsor-qr-repeat` (passou isolado e na segunda execução). A
  asserção passou a carregar a mensagem da recusa, para que a próxima ocorrência seja
  diagnosticável. Não é dívida do levantamento — é ruído de infraestrutura de teste, e fica
  registrado para não ser confundido com o produto.
- **A E2E negativa do painel**: não existe hoje um papel com `event:update` **sem**
  `participant:read`, então a ausência do painel para "quem não pode exportar" é provada
  pelo **componente** (dois principals, no `f77-exportacao-do-evento.test.ts`) e pela
  **action** (403), não por um papel no navegador. Ver §6.9.

**Proposta para a próxima fase (NÃO executada — precisa de autorização).** A condensação desta
fase **funcionou, mas por pouco**: para caber a linha 77 e as contagens foram condensadas três
linhas históricas da §9 (F15, F25 e F30) e consolidado o parágrafo de "Quitados recentemente".
O arquivo fechou em **64.144 bytes** — sob o teto de ~64.800, com ~650 bytes de folga. **A
próxima fase com uma linha nova não cabe sem apagar detalhe útil**, e é isso que faz o movimento
estrutural deixar de ser preferência: **mover as fases 1–25 para `docs/fases-historico.md`** e
deixar na §9 a tabela dos temas recentes + ponteiro. Devolve ~15 KB e acaba com a condensação
anual; **não foi feito agora** porque muda a memória durável do projeto e é decisão do humano.

---

## 9. Checklist de Aceite

| Requisito | Situação |
|---|---|
| `docs/fase-77-organizador-novo.md` com as **9 seções** e **ADR-369/370/371** (a próxima é a 372) | ✅ |
| As **7 lições** com a evidência medida de cada uma | ✅ (§5.1) |
| **Fatia 1** — `eventLaunchPath` puro, 3 fatias e os fatos do render | ✅ (10 casos de unidade) |
| A faixa **dentro** da prontidão, **5 seções e 17 cartões intactos** | ✅ (integração conta o DOM) |
| O **link morto** de `sem-programacao` consertado **por estrutura** (`targetOf` sobre o catálogo) | ✅ (mutação derruba 3 casos) |
| A whitelist do `f53` **deriva** de `EVENT_AREAS` | ✅ |
| No **mesmo HTML**, guia 3/3 e painel com `sem-inscricao` | ✅ (integração) |
| A palavra **"pronto"** proibida por varredura | ✅ (4 estados; mutação) |
| **Fatia 2** — o painel na raiz, dentro de "Operar", 17 cartões e 5 seções preservados | ✅ (unit + integração) |
| O gate por `participant:read` **TENANT** (a mesma regra da action) | ✅ (`canExportEventData`) |
| O **recorte** nas CTEs; prova empírica **3/3/210 → 2/2/90** | ✅ (integração + mutação "3 to be 2") |
| Saíram **Eventos**, **Eventos com presença** e os **rótulos**; o XP trocou de fonte | ✅ (cabeçalho de 12 colunas; XP do livro-razão) |
| `ATTENDANCES_CSV` em **formato longo**, migração `20261023120000_f77_presencas_por_atividade` | ✅ (migração aplicada; `db:setup`) |
| O arquivo **continua não sendo guardado** | ✅ (marca d'água + prazo + download regera) |
| **Fatia 3** — `/t/<slug>/exemplo` com guarda por **vínculo**, fixtures tipadas, banner e entrada no estado vazio | ✅ (unit/integração de render) |
| A **catraca** do demo (withTenant/prisma/action/`<form>`/fetch/redirect) **provada com hash** | ✅ (§6.11) |
| A catraca da **F69** pegou a fixture nova; corrigido com a **fonte única** | ✅ (lição 7) |
| `AGENTS.md` com fases **29 a 77**, contagens medidas, **ADRs 371 → 372**, linha 77, dívidas e §10 | ✅ (tamanho conferido no fim) |
| `README.md` e `docs/dividas-tecnicas.md` com a narrativa e os pontos de atenção | ✅ |
| **Bateria completa** da §4 com os números reais | ✅ (§6: 4313 Vitest · 458 E2E · `db:verify` ×3) |
| **Portão WCAG AA** com a **raiz do evento** e o **exemplo**, **sem isenção nova** | ✅ (37 → **39 casos**, `ISENCOES = []`) |
| O portão **achou** o defeito de `definition-list`/`dlitem` em `MetaList`/`MetaItem` e ele foi **corrigido sem isenção** | ✅ (4 + 34 nós; §5.2) |
| **E2E da exportação na raiz**: painel com `participant:read`, botão que baixa, **DRAFT** exporta | ✅ (§6.9 — 3 casos novos) |
| **Nenhum** spec existente quebrou pela faixa nova; o único ajuste de teste foi a **mensagem** da asserção do `f51-sponsor-qr-repeat` (o vermelho intermitente) | ✅ (§6.3) |
| Imagens `f77-caminho-de-partida.png` e `f77-demo.png` | ✅ |
| `playwright-report/`, `test-results*`, `.playwright*` limpos; `git status` sem resíduo; `next-env.d.ts` intacto | ✅ |
| **Nada** tocado em `src/app/globals.css` nem em `playwright.config.ts` | ✅ |
| Sem `any`; erros como valor; comentários explicam **POR QUE** | ✅ |
| `f62` rodado isolado, com os vermelhos pré-existentes medidos e diagnosticados | ✅ (§6.10) |

---

> **Aguardando APROVADO: AVANÇAR**
