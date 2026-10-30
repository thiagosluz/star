# FASE 85 — A emissão é do evento, e a simulação é o mesmo serviço

> **Tema:** o cartão **"Certificados"** do grupo RESULTADO da raiz do evento prometia
> "a emissão em lote do evento" e entregava o **inventário da instituição** — uma tela
> que lista documentos de todos os eventos e não emite nada. O painel de lote existia
> desde a FASE 6/36, mas morava em `/certificados` (a tela de "meus certificados"),
> misturando a pergunta do participante ("os MEUS documentos") com a da equipe
> ("os documentos do EVENTO"). A fase move o painel para
> `/t/<slug>/administracao/eventos/<eventId>/certificados` e, no mesmo movimento, faz a
> tela **simular antes de disparar**: quatro contadores, o tempo estimado a partir de
> medição real, o estado da fila e a **lista de descartados com o motivo do domínio**.
> A simulação não é uma segunda regra — é a **mesma** `evaluateEligibility`, alimentada
> pelos **mesmos** fatos, provada por uma catraca de integração que compara os
> certificados emitidos com os pares que a tela previu. **ADR-384 e ADR-385.**
> **Base:** a FASE 53 desenhou as áreas do evento como catálogo; a FASE 55 transformou
> cada área em página; a FASE 76 fixou a ordem "404 antes de consultar"; a FASE 78
> unificou o topo (`PageHeader` + `eyebrow` da fonte única). Esta fase **usa essas
> réguas** em vez de inventar outras: o `href` passou a sair do catálogo, o id é
> validado antes da consulta, o topo é o único e o `eyebrow` é o grupo de navegação.
> **Fatias:** 1 (rota do evento, painel como componente de evento, catálogo, portão de
> acessibilidade) e 2 (a simulação: projeção em lote, motivos, estimativa, fila). As
> duas entregues; a fase fecha com a bateria completa e a suíte E2E inteira.

---

## 1. Sumário executivo

| Entrega | Onde | Prova |
|---|---|---|
| O cartão **"Certificados"** do grupo RESULTADO passou a apontar para a **página do evento**, não para o inventário; o propósito foi reescrito ("a emissão em lote dos documentos do evento, para quem tem fato registrado") | `src/domain/events/event-areas.ts` | E2E `f85-emissao-do-evento.spec.ts` caso 1 (clica no cartão e cai na rota do evento) |
| A **página nova** `/t/<slug>/administracao/eventos/<eventId>/certificados`, com `certificate:issue`, id validado **antes** de qualquer consulta (404 para o malformado, 404 para o evento de outra instituição), topo único e `eyebrow` `operacao` | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/certificados/page.tsx` (novo) | catracas `f76` (24 páginas/25 params) e `f78` (97 páginas/82 migradas); E2E casos 1 e 3; portão `axe` |
| O `IssueBatchPanel` virou **componente de evento**: sem `<select>` de eventos, com o `eventId` da rota em campo oculto, o evento como texto e a simulação recebida pronta do servidor | `src/components/certificates/issue-panel.tsx` | E2E caso 1 (`issue-panel-event` contém o título; disparo emite de verdade) |
| A tela `/certificados` **perdeu o lote** e manteve o pedido individual, a lista dos próprios documentos e a revogação de quem administra | `src/app/t/[tenantSlug]/(app)/certificados/page.tsx` | E2E `accessibility` e a suíte inteira (nenhum caso apontava para o painel ali) |
| **`previewEventCertificates`** — leitura pura que projeta o evento inteiro e usa a **mesma** `evaluateEligibility` e a **mesma** montagem de fatos (`baseFactsFrom`) da emissão | `src/lib/certificates/certificate-service.ts` | integração `f85-preview-e-emissao.test.ts` (3 casos); unit `f85-simulacao-da-emissao.test.ts` |
| **`discarded`** com o motivo: o serviço deixou de jogar `verdict.reason` fora (`skipped += 1`) e passou a devolver `{ userId, kind, reason }`; a action conta os descartes na resposta | `src/lib/certificates/certificate-service.ts` e `src/app/actions/certificate-actions.ts` | integração: **10 descartes**, motivo idêntico **texto a texto** ao da simulação |
| A **projeção em lote**: 6 chamadas Prisma fixas (13 comandos), sem custo por pessoa; a população é a união que a emissão percorre | `src/lib/certificates/certificate-service.ts` (`loadEventFacts`) | catraca de fonte: `≤ 6` chamadas no bloco marcado; integração: escopo 6 sem a pessoa só-credenciada |
| **Amostra de duração** dos PDFs (`Job.processedOn`/`finishedOn`) e a **estimativa** com amostra mínima 5; abaixo disso, "Ainda sem medição" | `src/lib/certificates/queue.ts` e `src/domain/certificates/certificate-preview-rules.ts` | unit: 5 casos de estimativa; tela real: média de **70 ms** em **200** jobs concluídos |
| Os **quatro contadores** (escopo · elegíveis · descartadas · certificados a emitir), a frase da estimativa ("soma do trabalho, não o relógio"), o estado real da fila e a lista de descartados em `<details>` nativo | `src/components/certificates/issue-panel.tsx` | E2E casos 1 e 2; portão `axe` com a lista **aberta** |
| A rota nova entrou no **portão de acessibilidade** (39 → 40 telas) e na **tabela do id malformado** (35 → 36 casos; 23 → 24 páginas/24 → 25 params) | `tests/e2e/accessibility.spec.ts`, `tests/e2e/f76-id-malformado.spec.ts`, `tests/unit/f76-catalogo-de-ids.test.ts` | os três arquivos, verdes |
| A imagem da fase: a simulação com os quatro contadores, o tempo estimado, a fila e a lista de descartados aberta | `docs/imagens/f85-emissao-do-evento.png` | spec temporário **apagado** depois da captura |

**Números da fase**

```text
Arquivos ......................... 5 novos (a página do evento, certificate-preview-rules,
                                    f85 unit, f85 integração e f85 E2E) + 10 alterados na entrega
                                    + a catraca f79 e 4 documentos de estado no fechamento
Linhas ........................... +929 / −131 no diff final dos arquivos RASTREADOS (inclui os
                                    documentos de estado e a catraca); +846 / −91 são os 10
                                    arquivos de produto e teste da entrega
Testes novos ..................... 15 no Vitest (12 unit + 3 integração)
Vitest ........................... 4563 em 256 arquivos — 0 vermelhos
E2E .............................. 492 casos — **491 passando + 1 skip**, 0 vermelhos
                                   (3 do spec novo + 1 no portão de acessibilidade)
Migrações ........................ 0
ADRs ............................. 2 (ADR-384 e ADR-385) — a próxima é a 386
Dívidas novas .................... 1 (E92) — a contagem vai de 46 para 47
Consultas da projeção ............ 6 chamadas Prisma (13 comandos), fixas
Consultas da emissão ............. 7 por pessoa — 2.100 num evento de 300
Amostra mínima de tempo .......... 5 PDFs (abaixo disso, sem número)
```

---

## 2. O problema mais difícil: **a área já existia e apontava para a tela errada**

O defeito não estava no código do painel — ele estava no **catálogo**. A FASE 53
transformou as seções da raiz do evento em áreas com grupo, propósito e permissão, e a
FASE 55 fez cada área virar uma página. O cartão `certificados` nasceu no grupo
**RESULTADO**, com o propósito "Emissão, modelos e o lote de documentos do evento" e um
`href` para `/administracao/certificados`. Essa rota é o **inventário**: ela lista os
documentos da instituição inteira, filtra por evento e baixa o ZIP — e **não emite**.

O humano viu o sintoma na tela: clicou em "Certificados" na raiz do evento esperando
emitir e recebeu a lista. A investigação no catálogo encontrou a causa em uma linha:
o cartão prometia uma coisa e entregava outra, e **nenhum teste comparava `href` com
`purpose`** — a catraca da F53 prova que não há endereço repetido e que todo propósito
existe; ela não prova que o endereço **faz** o que o propósito diz.

A tentação era "consertar o texto do cartão" (prometer o inventário). O produto já tinha
o painel de lote, com a permissão certa (`certificate:issue`) e a Server Action certa —
só não tinha endereço próprio. O desenho correto era o inverso: **dar ao painel o
endereço do evento** e deixar o inventário com o seu papel (listar, filtrar, baixar).

O segundo problema apareceu quando o painel foi movido: **nada quebrou**. A busca por
`issue-batch|issue-panel|issue-feedback` em `tests/` devolvia **zero**. O painel existia
desde a FASE 6/36 e nenhum teste o abria; as specs que pareciam cobri-lo usavam o
formulário **individual** de `/certificados`. Mover uma tela sem teste é um movimento
que não prova nada — e foi preciso escrever o E2E que **entra pelo cartão** e verifica a
linha em `certificates`, senão a fase seria só uma troca de URL.

O terceiro problema é o que definiu o resto do desenho: a tela nova não podia ser só o
painel antigo em outro endereço. A pergunta que a equipe faz antes de emitir em lote é
**"quantos vão receber, quantos ficam de fora e por quê?"** — e o serviço de emissão
sabia a resposta e a **descartava** (`skipped += 1`). A tela da imagem pedia exatamente
o motivo do descarte. Daí a fatia 2: uma simulação que é o **mesmo serviço**, não uma
segunda regra; que **não grava nada**; que custa **O(1)** em vez de N × 7 consultas; e
que mede o tempo com o único dado real disponível, sem inventar capacidade de fila.

---

## 3. Decisões técnicas

### 3.1 A rota é do EVENTO — o escopo vem da URL, não de um `<select>`

A Server Action `issueEventCertificatesAction` sempre recebeu `eventId`; o que não
existia era uma tela cujo **endereço** fosse o evento. O painel antigo abria com um
`<select>` alimentado pelos **30 eventos mais recentes** da instituição — e um evento em
rascunho, criado há mais de 30 posições, simplesmente não aparecia para emitir.

A página nova:

- valida o `eventId` com `requireUuidParam` **antes** da guarda e antes da consulta
  (a régua da FASE 76: texto malformado é 404, não `P2023` → 500);
- usa `requirePagePermission({ permission: CERTIFICATE_ISSUE })`, a **mesma** permissão
  que o cartão declara e que a action exige;
- consulta o evento com `getAdminEvent(tenantId, eventId)` — o `tenantId` no `where` é o
  pertencimento, e o `deletedAt` a exclusão lógica; evento de outra instituição e evento
  apagado são o mesmo **404** para quem está ali;
- passa o evento como **texto** e o `eventId` como campo oculto. Um `<select>` de um item
  só convidaria a trocar o que a rota já decidiu.

**Alternativa descartada:** manter o painel em `/certificados` e só trocar o `href` do
cartão para lá com `?evento=`. O participante continuaria vendo o painel de lote (a
permissão o escondia, mas a tela era dele) e a pergunta "os meus documentos" continuaria
dividindo espaço com "os documentos do evento" — duas perguntas de donos diferentes na
mesma página.

### 3.2 A simulação é o MESMO serviço e a MESMA regra

`previewEventCertificates` **não decide elegibilidade**. Ele monta os fatos e chama
`evaluateEligibility` — a mesma função pura que `requestCertificate` chama. A montagem
também é compartilhada: `baseFactsFrom` extraiu do `loadFacts` individual o objeto que a
regra consome, e os dois caminhos passam por ele. O que muda entre eles é a **consulta**
(uma pessoa × o evento inteiro), não a **forma do fato**.

```text
requestEventCertificates → loadFacts (7 consultas por pessoa) → baseFactsFrom → evaluateEligibility
previewEventCertificates → loadEventFacts (6 consultas fixas) → baseFactsFrom → evaluateEligibility
```

Sem essa unificação, a diferença apareceria como "a tela disse 3 e emitiu 2" — sem erro,
sem log, descoberta no dia do evento. A prova não é argumento: é a catraca de integração
(§5, lição 4), que compara **pares pessoa × tipo** e o **texto do motivo**.

**Alternativa descartada:** a tela recalcular a elegibilidade no cliente com os dados que
já tem. Isso criaria uma segunda verdade — e a primeira vez que a regra mudasse, as duas
divergiriam em silêncio.

### 3.3 A população vem dos FATOS, não das inscrições

Os candidatos são a **união** que `requestEventCertificates` já percorre: presença ∪
palestrante ∪ parecer submetido ∪ autor de trabalho aceito. As próprias consultas de
fatos são a fonte dos candidatos; não existe uma consulta separada de "quem são".

Contar `_count.registrations` seria mais barato e **mentiria**: a inscrição em uma
atividade é uma linha de `registrations`, então o "escopo" ficaria maior do que a
população que a emissão examina. A prova está na integração: **Fausto** tem somente
credenciamento no evento (linha com `activityId` nulo) e **não** entra no escopo — a
emissão nunca o examina, porque não há fato de atividade, palestra, parecer ou autoria.

Um detalhe reproduzido de propósito: a consulta de candidatos por autoria **aceita**
trabalho excluído (o `loadFacts` individual não filtra `deletedAt` na consulta de
candidatos; ele filtra na contagem). Reproduzir isso é obrigatório — filtrar a submissão
excluída já na consulta tiraria a pessoa do **escopo**, e a tela mostraria uma população
menor do que a que a emissão percorre. O `deletedAt` é selecionado e a exclusão acontece
**na contagem**, no mesmo ponto em que o caminho individual a faz.

### 3.4 O custo é O(1): 6 chamadas fixas contra 7 por pessoa

`loadFacts` custa **sete consultas por pessoa**. Numa tela, um evento de 300 pessoas
faria **2.100 idas ao banco** para desenhar uma prévia que ninguém pediu para gravar.
`loadEventFacts` lê o evento inteiro em **seis chamadas Prisma** — e o custo não cresce
com N.

A régua é de **fonte**, não de comando SQL: o teste unitário lê o bloco marcado
(`<!-- f85-projecao-inicio -->` … `<!-- f85-projecao-fim -->`) e conta as chamadas
`tx.<modelo>.<operação>(`. Medido com log de query no evento vazio: **6 chamadas → 13
comandos**, porque os `select` aninhados (atividade, usuário, avaliador) viram comandos
separados no driver. O que importa é que **13 comandos são 13 para 3 ou para 300**.

Duas consultas merecem nota:

- **`review.findMany` em vez de `groupBy`**: além da contagem, a linha traz o **nome** do
  revisor — sem uma sétima consulta só para nomes. A contagem é feita em memória, sobre
  exatamente as mesmas linhas que o `count` individual enxergaria.
- **`event.findFirst` com as atividades de minicurso filtradas**: o fato do evento (fim e
  número de minicursos) sai numa leitura só; o tamanho da lista filtrada é a contagem, com
  o mesmo filtro do `activity.count` individual.

### 3.5 O motivo do descarte deixou de ser jogado fora

`evaluateEligibility` sempre devolveu `{ eligible, reason }`. A emissão em lote fazia:

```ts
if (result.ok) { … } else { skipped += 1; }
```

O `reason` — "Nenhuma atividade com presença suficiente (mínimo de 75 % da carga)." —
era descartado. A tela da imagem pedia exatamente esse texto: "não elegível" sem motivo
manda a equipe abrir chamado.

Agora `BatchIssueOutput.discarded` carrega `{ userId, kind, reason }`, e `skipped` passa
a ser `discarded.length` — **as duas não podem divergir**. A resposta da action conta os
descartes e aponta para a lista acima. O contrato antigo (`skipped: number`) continua
existindo; o novo campo é aditivo.

### 3.6 O tempo é SOMA DE TRABALHO, não relógio

Não há coluna de duração em `Certificate`; a única fonte real é o tempo dos jobs que a
fila ainda retém. `certificateDurationSample()` lê os **200 últimos** jobs concluídos
(o mesmo teto de `removeOnComplete`) e mede `finishedOn − processedOn` — o tempo que o
worker levou para pegar o job e terminar o PDF, incluindo storage.

`estimateGenerationTime` multiplica N pela média **somente** com amostra de **5** ou
mais (`MIN_GENERATION_SAMPLE`). Abaixo disso, a tela diz "Ainda sem medição: a estimativa
aparece quando houver ao menos 5 PDFs concluídos na fila". O número **não é dividido
pela concorrência**: o processo web não observa `WORKER_CONCURRENCY`, então qualquer
divisão seria um chute com cara de medição. A frase da tela diz o que o número é: "É a
soma do tempo de geração, não o relógio: o worker processa em paralelo."

Medição da fase: **200 jobs concluídos, média de 70 ms** (mínimo 35 ms, máximo 196 ms).
É esse o dado que a tela usa — não uma constante.

### 3.7 A fila mostra o que `certificateQueueStats` devolve — e só isso

A tela não mostra "capacidade da fila" (não existe: a fila é criada sem `limiter`,
`maxLen` ou `maxmemory`), não mostra "concurrency" (o processo web não a observa), não
mostra "PDFs/s" (sem amostra não há taxa) e não cita "Chromium" (detalhe de
implementação do worker, não fato da operação). O que aparece é o que o serviço devolve:
`waiting`, `active`, `completed`, `failed` e `workers`, com a frase **"janela retida"** —
`completed`/`failed` são os últimos 200/500, não o histórico.

Zero workers é dito com todas as letras ("Nenhum worker registrado: os documentos ficam
aguardando até um subir"), porque é a informação que a equipe precisa antes de fechar o
evento. Redis fora do ar devolve `null` e a tela diz que o disparo gera na hora, no
processo web — em vez de inventar número.

### 3.8 A fração é elegíveis ÷ escopo — e o rótulo diz isso

O **96,3 %** da imagem não é presença. É `eligiblePeople / scope`: de cada 100 pessoas
que a emissão examina, quantas têm ao menos um documento a receber. Presença média é
outro número, com outro denominador (minutos) e outro significado.

A tela rotula os dois números de forma diferente de propósito:

- **"Pessoas no escopo"** — com presença, palestra, parecer ou autoria aceita no evento;
- **"Elegíveis"** — com ao menos um tipo aprovado, e a fração no `hint` ("50 % do escopo
  (pessoas com ao menos um tipo aprovado)").

Sem escopo, a fração é **`null`** — "não há denominador" não é 0 %. A frase vira "sem
pessoas no escopo para calcular a fração", e o contador de certificados a emitir é 0.

### 3.9 `?evento=` é filtro real (a investigação dizia o contrário)

A fatia 1 levantou a hipótese de que o `?evento=` do inventário fosse decorativo, porque
a tela não mudava de conteúdo no E2E. A investigação da fatia 2 **corrigiu** o
diagnóstico: o filtro existe de verdade — `resolveUuidQueryFilter` aplica o valor, e
`listCertificatesForAdmin({ eventId })` o usa no `where`; o que faltava era o **link**
levá-lo. O E2E novo prova o caminho inteiro: o link do painel carrega
`?evento=<uuid>`, a URL é a esperada e a lista mostra o documento recém-emitido.

O valor **malformado** é outra pergunta: a FASE 76 decidiu que ele é descartado com
aviso (a lista existe), não 404. A tela do evento não muda essa régua.

**Decisão registrada:** a consulta de **30 eventos** da tela `/certificados` continua
existindo, mas alimenta o **formulário individual** (`RequestCertificateForm`) — não o
lote. O lote deixou de depender de qualquer lista de eventos: o evento é o da rota.
Manter a consulta para o pedido individual é correto; usá-la para o lote era o que
escondia eventos antigos.

### 3.10 O `eyebrow` é `operacao` — porque "Resultado" não existe na navegação

O `PageHeader` da FASE 78 exige que o `eyebrow` venha de `TENANT_NAV_GROUPS` (a catraca
reprova literal). O cartão está no grupo **RESULTADO**, mas esse grupo é do **catálogo de
áreas do evento**, não da navegação da instituição. A tela irmã do mesmo grupo
(`reconhecimento`) usa `operacao`. Inventar um grupo "Resultado" em `TENANT_NAV_GROUPS`
seria criar uma quinta lista que envelhece sozinha — e mexeria na navegação de todas as
telas para acomodar uma delas. A escolha é `operacao`, com a decisão escrita no código.

### 3.11 A regra de presença é por LINHA — e isso é dívida declarada, não conserto

`computeWorkload` trata **cada linha** de `attendances` como uma entrada. Quem tem duas
visitas de **30 min** na mesma atividade de **60** não soma 60: cada linha fica abaixo
dos **45** exigidos (75 % da carga) e nenhuma conta. A agregação por pessoa × atividade
existe no **credenciamento** (`credential-service.ts`), em outro caminho.

A FASE 85 **não conserta** isso. Consertar mudaria quem recebe certificado — é decisão de
negócio, não de tela — e faria a simulação divergir da emissão se só um dos lados
mudasse. A simulação **reproduz** a regra de hoje, e a catraca de integração prende o
caso: **Gabi** (duas visitas de 30 min) aparece descartada **duas vezes**. O sintoma
medido, o custo e o caminho do conserto estão na dívida **E92** (§8).

### 3.12 A tela que dispara também é a que revalida

A action revalidava `/certificados` — a tela pessoal, que não mostra resultado de lote
nenhum. Agora revalida a **página do evento** (a que disparou) e o **inventário** (onde
os documentos emitidos aparecem). A lista de descartados é uma **foto do render**: se a
pessoa marcar outros tipos e disparar, a action recalcula com os tipos do formulário e a
resposta diz o que aconteceu de verdade. A tela diz isso — o N do botão não promete ser
o número final.

---

## 4. ADRs

### ADR-384 — A emissão em lote é do EVENTO, e a simulação é o MESMO serviço

**Contexto.** O cartão "Certificados" do grupo RESULTADO da raiz do evento apontava para
`/administracao/certificados` (o inventário da instituição) e o painel de lote morava em
`/certificados` (a tela pessoal). Duas perguntas de donos diferentes na mesma página, e
um cartão que prometia emissão e entregava listagem. Nenhum teste abria o painel. A
pergunta que a equipe faz antes do lote — "quantos recebem, quantos ficam de fora e por
quê?" — não tinha resposta na tela, embora o serviço soubesse o motivo de cada recusa e
o descartasse.

**Decisão.**

1. A emissão em lote tem **rota própria do evento**:
   `/t/<slug>/administracao/eventos/<eventId>/certificados`, com `certificate:issue`, o
   `eventId` validado antes da consulta e o pertencimento conferido no `where`. O
   `eventId` viaja no formulário como campo oculto — nenhuma mudança no caminho de
   emissão.
2. A tela **simula antes de disparar**, e a simulação é o **mesmo serviço**
   (`previewEventCertificates`) alimentando a **mesma** função de domínio
   (`evaluateEligibility`) pela **mesma** montagem de fatos (`baseFactsFrom`). Nada é
   decidido no cliente.
3. O preview **não grava nada**: sem `requestCertificate`, sem fila, sem PDF. A
   igualdade com a emissão é catraca de integração, não argumento.
4. A projeção é **O(1)**: seis chamadas Prisma fixas para o evento inteiro, contra sete
   por pessoa na emissão (2.100 num evento de 300).
5. A população é a **união de fatos** que a emissão percorre (presença ∪ palestra ∪
   parecer ∪ autoria aceita), não as inscrições — `_count.registrations` incluiria a
   inscrição de atividade e inflaria o escopo.
6. O **motivo do descarte** passa a ser resultado (`discarded`), e `skipped` é
   `discarded.length`.
7. A tela **não afirma** o que não mede: sem capacidade de fila, sem concorrência, sem
   PDFs/s sem amostra, sem "Chromium".

**Justificativa.** O cartão é o contrato de descoberta: o que ele promete tem de ser o
que a tela entrega. A simulação só é útil se for **verdadeira**; uma segunda regra
mentiria na primeira mudança de critério. O custo O(1) é o que permite a simulação rodar
em **todo render** em vez de virar um botão "calcular" que ninguém aperta.

**Consequências.**

- O inventário continua existindo com o seu papel (listar, filtrar, baixar o ZIP) e é
  alcançado por um link que já leva `?evento=<id>`.
- O painel deixa de listar eventos: o evento é o da rota. Evento em rascunho ou antigo
  não some mais da emissão por causa do `take: 30`.
- A Server Action revalida a página do evento **e** o inventário.
- A consulta de 30 eventos de `/certificados` permanece, agora só para o **pedido
  individual**.
- Duas superfícies novas no portão de acessibilidade e na tabela do id malformado.
- A simulação **reproduz** a regra de presença por linha; mudá-la é a dívida **E92**, com
  decisão de negócio e conserto nos **dois** caminhos.

### ADR-385 — O descarte tem motivo, e o tempo é soma de trabalho — não relógio

**Contexto.** O lote devolvia `skipped: number`. O `reason` que o domínio produzia era
jogado fora, e a tela não podia dizer por que alguém ficou de fora. Ao mesmo tempo, a
tela precisava estimar quanto tempo o lote levaria — e não existe coluna de duração em
`Certificate`; a única fonte real são os jobs que a fila ainda retém.

**Decisão.**

1. `BatchIssueOutput.discarded` carrega `{ userId, kind, reason }`, com o **texto do
   domínio** — não uma frase da tela. `skipped` passa a ser `discarded.length`.
2. A lista é `<details>`/`<summary>` nativo (funciona sem JavaScript, é focável e o
   leitor de tela anuncia o estado), com `<ul>/<li>` — nada de `<div>` clicável.
3. A **única** fonte de tempo é `Job.processedOn`/`finishedOn` dos jobs concluídos que a
   fila retém (teto de 200). `estimateGenerationTime` devolve `totalMs`, `averageMs` e
   `sampleSize`.
4. Sem **5** amostras (`MIN_GENERATION_SAMPLE`), não há estimativa: a tela diz "Ainda sem
   medição". Média zero/negativa também não vira número.
5. O total é **N × média**, e a frase diz que é a **soma do trabalho**, não o relógio: não
   se divide pela concorrência porque o processo web não a observa.
6. A fila mostra só `certificateQueueStats` (`waiting`, `active`, `completed`, `failed`,
   `workers`), com "janela retida" e o aviso explícito quando há **zero workers**.

**Justificativa.** Um motivo é um fato que a equipe usa para agir ("falta presença",
"não há minicurso"); uma contagem sem motivo manda abrir chamado. E é melhor não ter
número do que ter um número inventado: uma estimativa de 1 PDF multiplicada por 300 não
descreve nada, e dividir por uma concorrência que a tela não conhece produziria um
relógio fictício. A amostra mínima e a frase são o contrato de honestidade da tela.

**Consequências.**

- A resposta da action conta os descartes e aponta para a lista.
- A lista é renderizada com a simulação (aberta pelo usuário), e o portão `axe` a mede
  **aberta** — conteúdo escondido em `<details>` fechado não é medido.
- O número da estimativa pode ser **0 s** em lotes pequenos; isso é medição, não erro.
- A tela não promete o futuro: a simulação é uma foto do render e o disparo recalcula com
  os tipos marcados.
- `certificateDurationSample` degrada para `null` com Redis fora do ar, sem derrubar a
  tela e sem impedir o disparo (a fila cai para geração inline).

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção / prova |
|---|---|---|---|
| 1 | **A área já existia e apontava para a tela errada.** O organizador clicava em "Certificados" no grupo Resultado esperando emitir e recebia o inventário da instituição | O `href` do cartão era `/administracao/certificados` (listagem), enquanto o `purpose` prometia "a emissão em lote do evento". A catraca da F53 prova que não há endereço repetido e que todo propósito existe — **não** prova que o endereço entrega o propósito | `EVENT_AREAS.certificados.href` passou a `route(context, '/certificados')` (a rota do evento), com o propósito reescrito. O E2E **entra pelo cartão** e verifica a URL e o painel |
| 2 | **Zero teste cobria o painel de lote.** Mover o painel para outra tela não quebrou nada e não provou nada | A busca por `issue-batch\|issue-panel\|issue-feedback` em `tests/` devolvia **0**; as specs que pareciam cobri-lo usavam o formulário **individual** de `/certificados`, com `data-testid` diferente | Três casos em `f85-emissao-do-evento.spec.ts`: o caminho pelo cartão com emissão real (linha em `certificates`), o evento sem elegível (0 documentos) e o evento de outra instituição (404) |
| 3 | **O motivo do descarte existia e era jogado fora.** A tela da imagem pedia exatamente o motivo; a resposta do lote dizia só "N participante(s) não elegível(is)" | `evaluateEligibility` devolvia `reason`, e o laço do lote fazia `skipped += 1`. O texto morria ali; nem a ação nem a simulação podiam exibi-lo | `BatchIssueOutput.discarded = { userId, kind, reason }`, com o texto do domínio; `skipped = discarded.length`. A lista é `<details>` nativo e a resposta da action conta os descartes |
| 4 | **A pré-validação é a MESMA regra, não uma segunda.** Se a tela reimplementasse a elegibilidade, a simulação mentiria na primeira mudança de critério | O caminho individual e o preview têm consultas diferentes; se cada um montasse os fatos por conta própria, a diferença apareceria como "disse 3, emitiu 2" — sem erro e sem log | `baseFactsFrom` é compartilhado e `previewEventCertificates` chama `evaluateEligibility`. Prova de integração: **6 pessoas / 1 elegível**, **12 pares**, **2 emitidos = 2 previstos**, **10 descartes com o motivo idêntico texto a texto** e o preview escrevendo **0** certificados |
| 5 | **O custo da pré-validação é O(1), não O(N).** A tentação era chamar `loadFacts` por pessoa e desenhar a prévia | `loadFacts` custa **7 consultas por pessoa**; num evento de 300 seriam **2.100** idas ao banco para uma tela que ninguém pediu para gravar | `loadEventFacts` faz **6 chamadas Prisma fixas** (13 comandos com os `select` aninhados) para o evento inteiro, preso por catraca de fonte (`≤ 6`), com prova de que 13 comandos servem para 3 ou 300 |
| 6 | **O tempo é soma de trabalho, não relógio — e sem amostra de 5 não há número.** A tentação era uma constante ("~200 ms por PDF") ou dividir pela concorrência | Não há coluna de duração em `Certificate`; a única fonte é `Job.processedOn`/`finishedOn`, e a fila retém só os 200 últimos jobs. Média de 1 ou 2 amostras não descreve nada, e o processo web não observa `WORKER_CONCURRENCY` | `certificateDurationSample()` mede os jobs retidos (medianos **70 ms** em **200**); `MIN_GENERATION_SAMPLE = 5`; abaixo disso, "Ainda sem medição"; a frase diz "soma do tempo de geração, não o relógio" |
| 7 | **A regra de presença é por ATIVIDADE e por LINHA de attendance.** Gabi tem duas visitas de 30 min na mesma atividade de 60 e aparece **descartada 2×** | `computeWorkload` trata cada linha de `attendances` como uma entrada; duas linhas de 30 não somam 60 e cada uma fica abaixo dos 45 exigidos. A agregação por pessoa × atividade existe no credenciamento, em outro caminho | **Declarado, não consertado**: a simulação **reproduz** a regra de hoje e a integração prende o caso (2 descartes da Gabi). O conserto é a dívida **E92**, e mexer nele muda quem recebe certificado |
| 8 | **O 96,3 % da imagem não é presença.** O número era lido como "comparecimento" | A fração é `eligiblePeople / scope` — elegíveis ÷ pessoas no escopo. Presença média tem outro denominador (minutos) e outro significado; chamar a primeira de "presença" inventa uma taxa que ninguém calculou | Dois rótulos distintos: "Pessoas no escopo" (com presença, palestra, parecer ou autoria) e "Elegíveis" (com ao menos um tipo aprovado, fração no `hint`); sem escopo, a fração é `null` — não 0 % |

---

## 6. Evidência de verificação

### 6.1 A bateria

```text
npm run lint ................. 0 erros, 0 warnings
npm run typecheck ............ 0 erros
npm test ..................... 4563 testes em 256 arquivos — 0 vermelhos
npm run build ................ Compiled successfully; a rota nova listada
npm run db:verify ............ Contrato íntegro.
npm run db:verify:isolation .. 9/9 verificações passaram.
npm run db:partitions ........ Partições do mês atual e dos seguintes criadas.
```

### 6.2 Os testes novos, por arquivo

| Arquivo | Casos | O que prende |
|---|---|---|
| `tests/unit/f85-simulacao-da-emissao.test.ts` | 12 | a contagem (pessoas × pares, motivo preservado, fração `null` sem escopo), a estimativa (amostra mínima, zero, média inválida) e a catraca de fonte da projeção (`≤ 6` chamadas, preview sem escrita) |
| `tests/integration/f85-preview-e-emissao.test.ts` | 3 | a igualdade preview × emissão: escopo 6, 1 elegível, 12 pares, 2 emitidos = 2 previstos, 10 descartes texto a texto, preview escrevendo 0 |
| `tests/e2e/f85-emissao-do-evento.spec.ts` | 3 | o caminho pelo cartão + emissão real + inventário filtrado; evento sem elegível (0 documentos); evento de outra instituição (404) |
| `tests/e2e/accessibility.spec.ts` | +1 | a tela nova no portão WCAG AA, com os quatro contadores e a lista de descartados **aberta** |
| `tests/e2e/f76-id-malformado.spec.ts` | +1 | o id malformado da rota nova responde 404 (a tabela vai de 35 para 36 casos) |

### 6.3 As catracas que a fase moveu

```text
f76 · catálogo de ids ....... 23 → 24 páginas · 24 → 25 params · 28 → 29 encontrados
f76 · tabela do E2E ......... 35 → 36 casos (24 → 25 de página, 11 de API)
f78 · topo único ............ 96 → 97 páginas · 81 → 82 migradas · 15 exceções (sem mudança)
f77 · áreas do evento ....... 17 cartões — confirmado (nenhuma área nova; só o href mudou)
axe ......................... 39 → 40 telas no portão
```

### 6.4 A suíte E2E inteira

```text
npm run test:e2e ............ 492 casos — **491 passando + 1 skip**, 0 vermelhos (11,5 min)
                               (F84: 487 passando + 1 skip; a F85 acrescentou 3 casos do spec
                               novo e 1 caso no portão de acessibilidade)
```

A suíte roda contra o **container de produção** (`eventflow/web:local`), não contra o
`npm run dev`. A imagem foi reconstruída ao fim da fatia 2 e os testes mediram o código
novo; nesta fase de fechamento (documento, estado e dívida) **não houve mudança de
código de produto**, então não foi preciso `--build` de novo.

**A imagem e a rota, conferidas.** `eventflow/web:local` foi criada em **2026-10-29
23:10:36** (ID `7a2c3976490f`) e o container `eventflow-web` está no ar desde então; o
`build` lista a rota nova (`ƒ /t/[tenantSlug]/administracao/eventos/[eventId]/certificados`)
e, sem sessão, ela responde **307** (login) — não 404 —; com sessão, o E2E mediu **200**.

**Um vermelho medido e tratado como flake, com prova.** A primeira execução completa
teve **1 vermelho** em `content-and-media.spec.ts` — "copiar um patrocinador de outro
evento" (o `<select>` não achou a opção do patrocinador recém-criado). O caso **passou
isolado** (`1 passed`, 4,2 s) e a **segunda execução completa fechou 491 + 1 skip, sem
vermelho**. O vermelho não tem relação com a F85 (o arquivo e o fluxo são da F17/F41) e
é a mesma família de corrida de `select` controlado já registrada nas armadilhas 106 e
na dívida I3; ficou registrado aqui para não ser confundido com regressão da fase.

### 6.5 A imagem da fase

`docs/imagens/f85-emissao-do-evento.png` foi capturada da **tela real** do container, com um
spec temporário (apagado depois da captura) que montou um evento de **12 pessoas no escopo**:
8 com presença completa, 3 abaixo do mínimo e **Gabi** com as duas visitas de 30 min da dívida
**E92**. A imagem mostra os quatro contadores (**12 · 8 · 8 · 16**), o tempo estimado
(**~1 s — média de 200 PDFs recentes**, com a frase "é a soma do tempo de geração, não o
relógio"), a fila real (**200 concluídos · 0 falhas · 1 worker**) e a lista de descartados
**aberta**, com Gabi aparecendo **duas vezes** (presença e minicurso).

O **antes** (o painel na tela da instituição) não entra na imagem: ele deixou de existir no
código desta fase, e reproduzi-lo exigiria reconstruir a imagem antiga do container. O registro
do antes é o diff — o painel saiu de `/certificados` e o cartão passou a apontar para a rota do
evento —, e a prova do depois é a captura.

### 6.6 O que a fase NÃO mudou

- **A regra de elegibilidade**: `evaluateEligibility` e `computeWorkload` estão intactos.
  A simulação consome os dois, não os reescreve.
- **A soma por linha de attendance**: é o comportamento de hoje e vira a dívida **E92**.
- **`globals.css` e `playwright.config.ts`**: não foram tocados.
- **O caminho de emissão**: a Server Action continua lendo `tenantSlug`, `eventId` e
  `kinds`; o `kinds` e o `eventId` continuam vindo do formulário.
- **O inventário**: a página, o filtro e o ZIP continuam como estavam; só ganharam o link
  de volta.

---

## 7. Comandos operacionais

```bash
# a rota do evento (com sessão de quem tem certificate:issue)
# /t/<slug>/administracao/eventos/<eventId>/certificados

# os testes da simulação, sem banco
npx vitest run tests/unit/f85-simulacao-da-emissao.test.ts

# a catraca da igualdade preview × emissão (banco real)
npx vitest run tests/integration/f85-preview-e-emissao.test.ts

# as catracas que a fase moveu
npx vitest run tests/unit/f76-catalogo-de-ids.test.ts tests/unit/f78-topo-unico.test.ts tests/unit/f77-exportacao-do-evento.test.ts

# o caminho do organizador no navegador
npx playwright test tests/e2e/f85-emissao-do-evento.spec.ts

# o portão de acessibilidade da tela nova
npx playwright test tests/e2e/accessibility.spec.ts

# a suíte inteira (o container precisa estar com o código novo)
docker compose --profile app up -d --build web worker
docker images | grep eventflow/web
npm run test:e2e

# reprocessar os certificados presos (a tela de inventário tem o botão por documento)
# e ver o estado da fila no Redis
docker compose exec redis redis-cli ZCARD bull:certificates:completed
```

---

## 8. Dívidas técnicas e pontos de atenção

### 8.1 Dívida nova: **E92** — a soma por LINHA de attendance

**O que é.** `computeWorkload` avalia cada **linha** de `attendances` como uma entrada
independente. Quem tem duas visitas de **30 min** na mesma atividade de **60** tem duas
entradas de 30 — cada uma abaixo dos **45** exigidos (75 % da carga) — e **nenhuma**
conta. A agregação por pessoa × atividade existe no credenciamento
(`credential-service.ts`), mas não no caminho do certificado.

**Sintoma medido (não hipótese).** Na fixture da integração, **Gabi** tem duas linhas de
30 min na atividade de 60. Ela aparece **descartada 2×** (tipos `ATTENDANCE` e
`MINI_COURSE`), e o escopo mede **6 pessoas / 1 elegível / 12 pares**. Se as duas visitas
fossem somadas, Gabi teria 60 de 60 e receberia **2 certificados** — a tela diria 4
emitidos, não 2. O caso está preso em
`tests/integration/f85-preview-e-emissao.test.ts` (bloco "a prova de que a projeção
reproduz a regra de hoje").

**Custo do conserto.** Agregar as linhas por `(userId, activityId)` **antes** de montar os
fatos, nos **dois** caminhos (individual e projeção), e atualizar as provas:

- `loadFacts` (individual) e `loadEventFacts` (lote) precisam da mesma agregação, senão a
  simulação e a emissão divergem — a catraca de igualdade reprovaria;
- `computeWorkload` continua puro, recebendo uma entrada por pessoa × atividade;
- o teste de integração muda de expectativa (2 → 4 certificados no cenário da Gabi) e o
  E2E precisa de um caso com duas visitas;
- **quem já foi recusado não recebe retroativo**: emitir em lote de novo cria os
  documentos que faltavam, mas os já negados não têm "segunda chance" automática;
- a decisão é de **negócio** (a regra dos 75 % é por visita ou por permanência na
  atividade?). O caminho escrito é agregar por atividade; a alternativa — manter por
  linha e documentar — é a atual.

**Declarada em:** `docs/dividas-tecnicas.md` (item E92, tema E, esforço M).

### 8.2 O limite da estimativa

A estimativa é a **soma** do trabalho, não o relógio: com o worker processando em
paralelo, o tempo real de parede é menor. A tela diz isso, mas quem lê um número pode
ignorar a frase. O caminho para o relógio seria o worker publicar a concorrência e a
taxa — **não** foi feito, porque o processo web não observa `WORKER_CONCURRENCY` e a
tela não pode afirmar o que não lê.

### 8.3 A lista de descartados é uma foto do render

O preview roda com os tipos **padrão** (`ATTENDANCE` + `MINI_COURSE`) e o filtro é o do
render. Se a pessoa marcar `ORGANIZER` e disparar, a lista exibida não corresponde ao
disparo — a action recalcula e a resposta informa o que aconteceu, mas a lista continua
sendo a da simulação anterior. O caminho seria simular sob demanda por tipo (mais uma
query string ou uma Server Action de leitura); ficou fora porque a tela **diz** que o
disparo recalcula.

### 8.4 O que a fase não tocou

- A **capacidade da fila** não existe e não foi criada (sem `limiter`, `maxLen` ou
  `maxmemory`): a tela não a inventa.
- O **evento de outra instituição** responde 404 pela consulta, não pela tela: a tela não
  repete a checagem de pertencimento.
- O **`?evento=` malformado** do inventário continua descartado com aviso (régua da F76),
  não 404.
- O **link do inventário** é o único caminho de volta para a lista; a tela do evento não
  lista documentos já emitidos (quem quiser o histórico vai ao inventário filtrado).

---

## 9. Checklist de aceite

- [x] O cartão "Certificados" do grupo RESULTADO aponta para a **página do evento**.
- [x] A página nova exige `certificate:issue` e responde **404 antes da consulta** para id
      malformado, e **404** para evento de outra instituição.
- [x] O `PageHeader` é o topo único, com `eyebrow` `operacao` (fonte única) e a trilha do
      evento.
- [x] O `IssueBatchPanel` é componente de evento, com o `eventId` da rota em campo oculto
      e o evento como texto.
- [x] A tela `/certificados` perdeu o lote e mantém o pedido individual, a lista e a
      revogação.
- [x] A simulação usa `previewEventCertificates` + `evaluateEligibility` +
      `baseFactsFrom`; **não grava nada**.
- [x] A projeção faz **6 chamadas Prisma** fixas, presas por catraca de fonte.
- [x] O preview devolve `discarded` com o **motivo do domínio**; a emissão devolve
      `discarded` e `skipped = discarded.length`.
- [x] A integração prova **6 pessoas / 1 elegível / 12 pares / 2 emitidos = 2 previstos /
      10 descartes texto a texto / 0 certificados escritos pelo preview**.
- [x] A estimativa usa `Job.processedOn`/`finishedOn`, amostra mínima **5**, e a frase
      "soma do trabalho, não o relógio".
- [x] A fila mostra só `certificateQueueStats`, com "janela retida" e o aviso de zero
      workers.
- [x] A fração é elegíveis ÷ escopo, com rótulos distintos; sem escopo é `null`, não 0 %.
- [x] `?evento=` é filtro real, provado pelo E2E do link do inventário.
- [x] A consulta de 30 eventos alimenta o formulário individual, não o lote.
- [x] A tela nova entrou no portão `axe` (39 → 40) e na tabela do id malformado (35 → 36).
- [x] As catracas `f76` (24 páginas/25 params), `f78` (97/82) e `f77` (17) estão
      atualizadas/confirmadas.
- [x] A dívida **E92** está declarada em `docs/dividas-tecnicas.md` e no `AGENTS.md` §9;
      a contagem vai de **46 para 47**.
- [x] A bateria completa da §4 passou — lint, typecheck, Vitest, build, db:verify,
      db:verify:isolation, db:partitions e a suíte E2E inteira.
- [x] A imagem `docs/imagens/f85-emissao-do-evento.png` foi capturada da tela real, com o
      spec temporário apagado.
