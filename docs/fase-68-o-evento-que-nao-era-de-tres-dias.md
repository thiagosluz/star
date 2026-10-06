# FASE 68 — o evento que não era de três dias

> **Estado: ENTREGUE.** Documento único da fase (fatias 0 a 5), consolidado a partir do plano
> (`docs/fase-68-plano.md`), do código e dos testes na árvore. Onde algo não pôde ser
> estabelecido com o que existe, está escrito — em vez de preenchido com plausibilidade.

---

## 1. Sumário executivo

### 1.1 O que a fase entrega

A fase tem duas metades, e as duas nasceram de **defeitos medidos**, não de funcionalidade nova:

1. **A chamada de trabalhos era opcional de fato e obrigatória no papel.** O evento não tinha
   como declarar "não recebo trabalhos", e a janela de submissão existia em DOIS lugares que não
   se cruzavam. A fase cria o interruptor (`Event.usesCall`), **remove as duas colunas** do
   evento com migração, faz a `CallForProposals` (F33) ser a única fonte da verdade e
   **ressuscita o `CFP_CLOSED`** — que era declarado e nunca devolvido.
2. **O endereço da sala online tinha UM leitor e ZERO escritores** — e o leitor o mostrava a
   qualquer anônimo. A fase cria o escritor no evento **e** na atividade, e fecha o vazamento
   com uma regra pura de visibilidade resolvida no servidor.

E, no caminho, dois defeitos de data e um de formulário:

3. **O formulário de criação nascia com três dias** (e com a hora do relógio de render), o que
   fazia todo evento criado por descuido anunciar três dias na página pública. Passa a nascer com
   **um dia: 09:00 → 18:00**.
4. **O rótulo da raiz do painel** dizia "05/11/2026 a 05/11/2026" num evento de um dia e usava o
   fuso do PROCESSO. Passa a usar `formatEventPeriod` (fuso do evento).
5. **A descrição/SEO do evento formatava a data em UTC**, e um evento das 21:00 em Salvador
   aparecia no dia seguinte — no Google e no cartão de compartilhamento.

### 1.2 Números da fase

| | |
|---|---|
| Migrações | **2** (`20261006101717_f68_usescall_e_fim_da_janela_do_evento`, `20261006134940_f68_endereco_da_sala_online`) |
| Arquivos novos | **14** (6 de código de produção, 6 de teste, 2 migrações) |
| Arquivos alterados | **33** |
| Testes novos (Vitest) | **58 casos** em 5 arquivos: **7** em `tests/unit/f68-chamada-opcional.test.ts`, **23** em `tests/unit/f68-sala-online.test.ts`, **12** em `tests/unit/f68-dia-padrao.test.ts`, **13** em `tests/integration/f68-sala-online.test.ts` e **3** em `tests/integration/f68-dia-padrao.test.ts`. A fase também **acrescentou 1 caso** a `tests/unit/landing-page.test.ts` e **mudou 1** cuja asserção estava errada desde sempre (§5, lição 3 do ADR-343) |
| E2E novos | **4** (`tests/e2e/f68-sala-online.spec.ts`) |
| Portão WCAG AA | de **23** para **26 casos**, `ISENCOES = []` |
| Regressão visual | **21 linhas de base** (nenhuma nova; **1 regerada com medição**) |
| Colunas removidas | **2** (`Event.cfpOpensAt`, `Event.cfpClosesAt`) |
| Colunas criadas | **2** (`Event.usesCall`, `Activity.onlineUrl`) |
| ADRs | **3** (ADR-341, ADR-342, ADR-343 — a próxima é a **344**) |

---

## 2. O problema mais difícil da fase — e por que ele define o desenho

**O `CFP_CLOSED` existia como código e nunca chegava a ninguém.**

A fatia 0 mediu com `grep`: o código de erro estava DECLARADO em
`src/lib/review/submission-service.ts:90` e não havia **nenhum** ponto que o devolvesse, nem
**nenhum** teste que o citasse. O prazo da chamada existia só no filtro da CONSULTA da tela
(`src/app/t/[slug]/(app)/submissoes/page.tsx:80-83, 90` e `.../nova/page.tsx:17, 43`): quem
conhecesse a Server Action — ou qualquer cliente futuro que falasse com o serviço — submetia
trabalho fora do prazo, e o servidor aceitava. Era uma regra de produto **escrita no lugar
errado**: na tela em vez de no serviço.

Ele define o desenho da fase por três razões, e as três são estruturais:

1. **Regra que só existe no filtro não é regra.** O portão tem de estar no serviço, que é o
   único caminho de escrita — e a fase o põe lá (`src/domain/events/call-optional-rules.ts` +
   `submission-service.ts:243-262`). O que a tela mostra passa a ser consequência, e não a
   barreira.
2. **O vazamento do `onlineUrl` nasceu do mesmo descuido.** A coluna `Event.onlineUrl` existia
   desde a primeira migração com um leitor (`VenueBlock`) e **zero escritores** — logo, ninguém
   nunca perguntou quem podia vê-la, e o bloco a mostrava a qualquer visitante. **Coluna sem
   escritor é coluna sem dono**, e a fase trata as duas coisas juntas: quem escreve o endereço
   e quem pode lê-lo.
3. **A duplicação foi RESOLVIDA, não documentada.** Os dois caminhos da janela da chamada
   (colunas do evento × entidade F33) conviviam, e o banco de desenvolvimento provou que não se
   cruzavam: **365 eventos, 1 com a janela do evento, 2 chamadas publicadas — e cada caminho
   com exatamente o que o outro não tinha** (`congresso-2026`: 2 chamadas, 0 janela;
   `evento-peer`: janela, 0 chamadas). A resposta não foi reconciliar os dois: foi **remover
   um** (migração que derruba `cfpOpensAt`/`cfpClosesAt`, com `migrate diff --exit-code` = 0).

---

## 3. Decisões técnicas explicadas

### 3.1 O interruptor é COLUNA, e o ausente NÃO desliga

`Event.usesCall` é `BOOLEAN NOT NULL DEFAULT false` — e não uma chave em `settings`. O fato é de
primeira classe: decide o que a prontidão (F53) cobra, o que a vitrine anuncia e o que os
formulários oferecem. Num JSON opaco, toda leitura passaria por um parser e nenhuma consulta
poderia filtrar por ele.

E a gravação distingue **ausente** de **falso**:

```ts
...(input.usesCall === undefined ? {} : { usesCall: input.usesCall }),
```

`undefined` é "este formulário não fala sobre isso"; `false` é "o organizador desmarcou a
caixa". Gravar o ausente como `false` faria **qualquer edição de título desligar a chamada** de
um evento que a usa — e o modo de falha seria silencioso: o painel pararia de cobrar a trilha e
a vitrine pararia de anunciar a submissão sem ninguém ter pedido.

**Alternativa descartada:** fazer a prontidão derivar de "existe chamada?" em vez do
interruptor. Isso confundiria **"não usa"** com **"não configurou"** — exatamente o falso alarme
que a fase existe para matar (o organizador de um congresso corporativo via "a chamada está
publicada e não há trilha cadastrada" para um evento que nunca receberia trabalho nenhum).

### 3.2 Quem vê o endereço: `CONFIRMED ∪ PENDING ∪ equipe`, derivada — nunca reescrita

A regra é pura (`src/domain/events/online-room-rules.ts`) e **deriva** de `registrationIsLive`:

```ts
return registrationIsLive(status) && status !== 'WAITLISTED';
```

`registrationIsLive` (`src/domain/events/registration-rules.ts:336-338`) é a fonte única do que
é "inscrição viva" — `PENDING | CONFIRMED | WAITLISTED | ATTENDED` — e é a MESMA definição do
índice único parcial do banco (armadilha 103). Ela **inclui a lista de espera**, então reescrever
a lista de situações na regra nova criaria a QUARTA cópia da mesma lista (a do domínio, a do
índice, a do `SEAT_AVAILABLE_PREDICATE` e a nova) — e a divergência apareceria no dia em que uma
delas mudasse. **Derivar e excluir é uma linha; reescrever é a divergência esperando a vez.**

Por que a espera não vê: quem espera **não tem lugar** — está numa fila que pode nunca andar.
Entregar o endereço a quem talvez não entre seria prometer o que o sistema não confirmou e
publicar o endereço para muito mais gente do que a sala comporta. `ATTENDED` segue vendo pelo
motivo oposto: quem já esteve na sala não perde o direito de reabrir o link.

### 3.3 O endereço NÃO é escondido — ele não é entregue

A decisão é do SERVIDOR e acontece **antes da renderização**: `applyOnlineRoomVisibility`
devolve uma projeção NOVA com `onlineUrl: null` onde a pessoa não tem lugar. Não há `hidden`,
não há CSS, não há JavaScript — não há o que esconder, porque o valor não foi entregue a nenhum
componente. É por isso que ele não aparece no `Ctrl+U` nem no payload de um Client Component.

O cuidado com o `HappeningNowView` (que é serializável e vai para o cliente) é o mesmo: o
endereço do cartão do "acontecendo agora" viaja num `Map` separado, consumido por um Server
Component — e `Map` é a escolha, não um detalhe, porque o React **recusa** serializar um `Map`:
se algum dia aquele componente virar Client Component, o erro é alto em vez de um vazamento
silencioso.

**Alternativa descartada:** uma condicional dentro do `VenueBlock`. Funcionaria — e deixaria o
endereço no HTML de quem não pode vê-lo, dependendo de o renderizador lembrar de não desenhá-lo.
A projeção é a barreira; o renderizador é o desenho.

### 3.4 O campo da sala online aparece por SERVIDOR, e "esconder" nunca esconde o DADO

Ajuste pedido pelo humano durante a execução: o campo só deve aparecer para preencher quando a
modalidade é `ONLINE` ou `HYBRID` — nos **dois** formulários (o do evento pela modalidade do
evento; o da atividade pela modalidade **daquela atividade**, porque um evento híbrido pode ter
uma oficina presencial).

A decisão é do servidor (`onlineRoomFieldVisibility`), na renderização: nada de CSS escondendo
campo obrigatório, nada de estado de cliente para divergir da regra — e por isso o formulário
funciona igual **sem JavaScript** (a marcação simplesmente não existe quando `show` é falso).
O preço é declarado: trocar a modalidade no `<select>` não faz o campo aparecer na hora; o
organizador escolhe "Online", salva, e o campo está lá. Uma volta a mais, em troca de **uma**
regra em vez de duas (servidor e cliente) que divergiriam.

**As duas condições, e a segunda é sobre o dado:**

1. modalidade `ONLINE`/`HYBRID` → o endereço é parte do que se preenche;
2. **já existe endereço gravado** → o campo continua na tela COM uma frase explicando por que
   ele está ali ("Este endereço continua gravado mesmo com a modalidade atual. Ele segue valendo
   para quem tem lugar; limpe o campo se a sala não existe mais.").

Sem a segunda condição, trocar a modalidade para Presencial **sumiria com o valor da tela sem
caminho de volta** — o defeito, não o conserto. E a contrapartida do lado do serviço entrou
junto: `saveEvent`/`saveActivity` distinguem ausente de vazio

```ts
onlineUrl: input.onlineUrl === undefined ? undefined : onlineUrl.url,
```

senão a modalidade presencial apagaria em silêncio o endereço de quem já o tinha. É a mesma
régua do `usesCall`, e a razão é a mesma.

**Isto NÃO é a barreira de segurança do endereço.** Esconder o campo é conveniência de
formulário; quem vê o endereço GRAVADO é decidido pela regra pura da fatia 3, sobre a projeção —
e ela vale igual para o endereço de um evento presencial que tenha ficado no banco.

### 3.5 As três superfícies do endereço, e uma prova por estado

| Superfície | `data-testid` | Quem vê |
|---|---|---|
| Bloco de LOCAL da página pública (`VenueBlock`) | `evento-sala-online` | equipe do evento **ou** inscrição no evento |
| Cartão do "acontecendo agora" (`NowCard`) | `agora-sala-online-<id>` | equipe **ou** inscrição NA ATIVIDADE **ou**, em atividade aberta, a do evento |
| Página da atividade | `atividade-sala-online` | a mesma régua da atividade |

A atividade que EXIGE inscrição própria **não** é liberada pela inscrição no evento: a pessoa
não tem lugar naquela sala, e o endereço é justamente o que se dá a quem tem. A atividade
ABERTA vai pelo caminho oposto e pela mesma razão de sempre (revisão da FASE 3): o público dela
É o do evento.

### 3.6 O padrão de um dia, com a hora decidida e não herdada

`defaultEventPeriod` (puro, em `src/domain/events/event-form-defaults.ts`) devolve
**09:00 → 18:00 no MESMO dia**, com o DIA a trinta dias de hoje. O DIA continua vindo do
relógio — não há outra fonte para "quando o organizador está criando isto". O que não pode vir
do relógio é a **HORA**: o minuto do render não é decisão de produto, e era ele que o print do
humano denunciava ("12:27").

O término nasce do início **já assentado** e recebe a hora própria (`setHours(18, 0, 0, 0)`), em
vez de somar horas: somar funcionaria hoje e quebraria em qualquer dia que não tivesse
exatamente 24 h (horário de verão), e o defeito seria "o evento termina às 17h" — que ninguém
ligaria à causa.

O fuso é o do PROCESSO, e isso é dito: o valor vai para um `<input type="datetime-local">`, lido
no relógio de quem usa a tela, e o evento **ainda não existe** (não há `Event.timezone` de onde
tirar fuso). O campo "Fuso horário" logo abaixo é que declara o fuso do evento.

### 3.7 O `timeZone` da descrição/SEO virou parâmetro OBRIGATÓRIO

`buildEventMetadata(input, timeZone)` — sem valor padrão, de propósito: com padrão, o próximo
chamador repetiria o defeito em silêncio. Obrigatório, o `tsc` obriga cada chamador a dizer de
que fuso está falando, e o único chamador real (a página pública do evento) já tem o fuso do
evento em mãos. Fuso inválido cai em `UTC` — a mesma leitura conservadora de
`formatZonedDateTime`: é melhor anunciar o dia em UTC do que derrubar a geração dos metadados de
uma página que já está no ar.

### 3.8 Alternativas descartadas, com o motivo

| Alternativa | Por que não |
|---|---|
| Guardar o interruptor em `Event.settings` (JSON) | Fato de primeira classe em JSON opaco: toda leitura passaria por parser e nenhuma consulta filtraria por ele |
| Manter as duas colunas da janela e "só parar de usá-las" | Coluna que ninguém escreve é como nasceram as três armadilhas que já nos morderam; a fase **remove** e prova com `migrate diff --exit-code` = 0 |
| Reescrever a lista de situações na regra de visibilidade | Quarta cópia da mesma lista; a fase **deriva** de `registrationIsLive` e exclui a espera |
| Condicional no `VenueBlock` para esconder o endereço | Deixaria o endereço no HTML, dependendo do renderizador; a projeção é a barreira |
| Esconder o campo da sala online só por modalidade (sem olhar o valor gravado) | Sumiria com o dado da tela sem forma de vê-lo ou limpá-lo |
| Condicional no CLIENTE para o campo da modalidade | Precisaria de `'use client'` e de estado; sem JavaScript o campo não apareceria — e mostrar a mais é seguro, esconder o que precisa ser preenchido não é |
| Uniformizar os rótulos de modalidade duplicados em três telas | Escopo extra, não autorizado pelo humano (§2.6 do plano) |

---

## 4. ADRs

### ADR-341 — A chamada de trabalhos é INTERRUPTOR do evento, e a janela é da chamada

**Contexto.** O evento nunca teve flag de "recebe trabalhos", e a janela de submissão vivia em
dois lugares: `Event.cfpOpensAt/cfpClosesAt` (primeira migração) e a `CallForProposals` da F33.
A fatia 0 mediu os dois caminhos com dados reais: 365 eventos, **1** com a janela do evento,
**2** chamadas publicadas — e cada caminho com exatamente o que o outro não tinha. O filtro do
F4 lia `cfpClosesAt` apenas na CONSULTA, e o código `CFP_CLOSED` era declarado e **nunca
devolvido**.

**Decisão.** (a) `Event.usesCall` (`BOOLEAN NOT NULL DEFAULT false`) passa a ser a declaração do
organizador; (b) as duas colunas são **removidas** numa migração; (c) a `CallForProposals` é a
única fonte da verdade sobre "a chamada está aberta"; (d) o **`CFP_CLOSED` passa a ser devolvido
pelo SERVIÇO**; (e) o interruptor só muda quando alguém o decide (ausente ≠ falso).

**Justificativa.** "Não usa chamada" e "não configurou a chamada" eram o MESMO estado no banco, e
a prontidão (F53) tratava os dois como falta de configuração. Manter as colunas "por
compatibilidade" manteria a segunda verdade viva — e o preço já estava visível na tela de
edição, que mostrava os dois campos logo abaixo de um aviso dizendo que a janela mora em
`/chamadas`.

**Consequências.** Os fixtures de integração que criavam eventos com a janela mudaram
(`peer-review.test.ts`, `rubric-freeze.test.ts`); os E2E que criam evento pela UI não mudaram
(a fatia 4 preservou `Início`/`Término`). Criar ou publicar uma chamada **liga** o interruptor
(o fato consumado); despublicar **não desliga** (a declaração é do organizador, e apagar a
intenção por causa de uma pausa seria decidir por ele).

### ADR-342 — O endereço da sala online é decidido no SERVIDOR, sobre a projeção, e a lista de espera não vê

**Contexto.** A coluna `Event.onlineUrl` existia desde a primeira migração com um leitor
(`VenueBlock`) e **zero escritores** — e o leitor a desenhava para QUALQUER visitante, inclusive
o anônimo. Criar o escritor sem resolver a visibilidade seria criar o vazamento: o organizador
digitaria o endereço e ele apareceria para a internet inteira.

**Decisão.** Uma regra pura (`online-room-rules.ts`) decide quem vê — **inscrição `CONFIRMED`,
inscrição que RETÉM vaga (`PENDING`) e a equipe do evento (`EVENT_UPDATE`/`EVENT_MANAGE`, nos
escopos `TENANT` e `EVENT`)**; a **lista de espera NÃO vê**. A decisão é aplicada à PROJEÇÃO
(`applyOnlineRoomVisibility`) antes da renderização: quem não tem lugar recebe `onlineUrl: null`
no evento e em cada atividade. O endereço não entra no HTML, nem em props de Client Component,
nem em metadados, nem no `.ics`.

**Justificativa.** Esconder por CSS/JS deixaria o valor no HTML e dependeria de o renderizador
lembrar de não desenhá-lo — a barreira seria o desenho, não a regra. A projeção inverte isso: o
que não pode ser visto **não é entregue**. A derivação de `registrationIsLive` menos
`WAITLISTED` evita a quarta cópia da lista de situações.

**Consequências.** O `.ics` público de uma atividade continua SEM o endereço (ele é o mesmo
arquivo para todo mundo); a visibilidade por atividade é um caminho separado do evento (a
atividade não herda o endereço do evento); e a atividade aberta aceita a inscrição no evento,
pela régua da FASE 3. O ajuste posterior do campo de formulário (só aparece em Online/Híbrido ou
quando já há endereço gravado) **não** é a barreira — é conveniência, e o `saveEvent` preserva o
valor quando o campo não é enviado.

### ADR-343 — O padrão do formulário de evento é UM dia, com hora explícita, e a data de SEO usa o fuso do evento

**Contexto.** Três defeitos medidos na fatia 0: (a) o término nascia em `início + 3 dias` e a
hora do início era o **minuto do render** (o print do humano mostrou "12:27"); (b) o rótulo da
raiz do painel escrevia `toLocaleDateString('pt-BR')` colado dos dois lados — "05/11/2026 a
05/11/2026" para um evento de um dia — e no fuso do PROCESSO; (c) a `fallbackDescription` do SEO
formatava a data com `timeZone: 'UTC'` FIXO, e um evento das 21:00 em Salvador (que é
`2026-04-02T00:00:00Z`) era anunciado como **02 de abril**.

**Decisão.** (a) `defaultEventPeriod` devolve **09:00 → 18:00 no mesmo dia** (dia a trinta dias
de hoje); (b) o rótulo da raiz passa a usar `formatEventPeriod`, que trata o mesmo dia e
formata no **fuso do evento**; (c) `buildEventMetadata` recebe o `timeZone` como **parâmetro
obrigatório**.

**Justificativa.** O (c) é o defeito de maior alcance: ele valia para **todo evento criado à
noite**, porque o padrão do formulário herdava o minuto do render. E o `timeZone` obrigatório é
o que impede a volta: com valor padrão, o próximo chamador repetiria o defeito em silêncio; sem
padrão, o `tsc` obriga cada chamador a dizer de que fuso está falando.

**Consequências.** O teste de unidade que prendia o comportamento antigo
(`tests/unit/landing-page.test.ts`, "ignora strings só com espaços") **mudou junto** — ele
afirmava `'Válido.'` para um subtítulo que sempre veio `'Válido'`, uma asserção que nunca passou
a rigor e que só sobreviveu porque o ramo não era exercitado. O `toLocalInput` duplicado em
`administracao/eventos/page.tsx` foi removido (era a terceira cópia) e o formulário passou a
importar o de `activity-presentation.ts`. O evento de um dia não quebra nenhum dos três
formatadores de período (todos já tinham ramo de mesmo dia: `formatEventPeriod`,
`formatTenantEventPeriod` e o `formatPeriod` do certificado — **nenhum deles foi tocado**).

---

## 5. Lições aprendidas — defeitos REAIS encontrados por testes

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | `CFP_CLOSED` era **declarado e nunca devolvido**: submeter fora do prazo pelo serviço era aceito, e nenhum teste citava o código | A regra do prazo existia **só no filtro da consulta da tela** (`submissoes/page.tsx:80-83, 90`, `nova/page.tsx:17, 43`); o SERVIÇO não tinha portão nenhum | O portão passou a existir no serviço (`call-optional-rules.ts` + `submission-service.ts:243-262`), com teste que prende os dois lados |
| 2 | `Event.onlineUrl` tinha **um leitor e nenhum escritor** — e o leitor mostrava o endereço a **qualquer anônimo** | A coluna nasceu na primeira migração e o `VenueBlock` desenhava `event.onlineUrl` sem perguntar nada; ninguém nunca escreveu nela, então ninguém nunca perguntou quem podia lê-la | Escritor criado (evento + atividade) **e** visibilidade resolvida no servidor sobre a projeção (`online-room-rules.ts` + `online-room-service.ts`); o E2E prova a ausência no HTML do anônimo e a presença para quem tem lugar |
| 3 | A janela da chamada tinha **dois caminhos vivos**, e o banco mostrou que **cada um tinha exatamente o que o outro não tinha** (`congresso-2026`: 2 chamadas, 0 janela; `evento-peer`: janela, 0 chamadas) | A F33 criou a entidade e ninguém removeu as colunas do evento; a tela de edição até avisava que a janela mora em `/chamadas`, e mantinha os dois campos | Migração que **remove as duas colunas**, com `migrate diff --exit-code` = 0 (zero drift) e os fixtures de integração ajustados |
| 4 | Editar o **título** de um evento poderia **desligar a chamada** em silêncio | `usesCall` ausente no `FormData` viraria `false` no `data` do update — `undefined` é "não falei sobre isso" e `false` é "desmarquei a caixa"; tratá-los igual é o defeito | `...(input.usesCall === undefined ? {} : { usesCall: input.usesCall })`, com teste que edita sem o campo e prende que o interruptor continua ligado |
| 5 | A regra nova de visibilidade poderia ter criado a **quarta cópia** da lista de situações de inscrição | `registrationIsLive` **inclui a lista de espera** (`PENDING \| CONFIRMED \| WAITLISTED \| ATTENDED`) e é a mesma definição do índice único parcial do banco (armadilha 103); reescrever a lista no novo módulo faria a divergência aparecer quando uma delas mudasse | A regra nova **deriva** dela e **exclui** a espera: `registrationIsLive(status) && status !== 'WAITLISTED'` |
| 6 | **`setCallPublished` publicava sem `eventId` do chamador** e devolvia `INTERNAL` — a suíte de outra fase (`rubric-freeze.test.ts`) ficava vermelha por um motivo que não tinha nada a ver com a chamada | A linha que liga o interruptor usava `input.eventId`, e o `where` do `update` recebia `id: undefined` → `PrismaClientValidationError`; o `updateMany` acima **não** pegava porque o filtro com `eventId: undefined` casa por `id` + `tenantId` e continua achando a linha | A linha passou a usar o `eventId` **DA PRÓPRIA CHAMADA**, lido na transação que já a toca: o dado que o chamador não mandou não pode ser o `where` do update |
| 7 | A varredura da **página da atividade** reprovou com `definition-list` (1 nó) e `dlitem` (10) — e a página nunca tinha passado por portão nenhum | A ficha era `<dl>` com `<div>` no meio (`dl > div > div > dt/dd`); o `axe` exige `dt`/`dd` como filhos DIRETOS do `dl` (sobe no máximo um `div` sem `role`) | A ficha virou `div` com rótulo/valor em `span` — as âncoras e os `data-testid` preservados. Não é lista de definições: são rótulos de ficha |
| 8 | A mesma varredura reprovou **`color-contrast`** em `.text-center` (o rótulo da inscrição da própria pessoa) | `opacity-60` — a mesma família do defeito da FASE 66: a opacidade COMPÕE o texto com o fundo em vez de escolher uma cor | `ef-muted`, o papel do tema que já existe para esta superfície (5,08:1 no claro) |
| 9 | O primeiro caso novo do portão do "agora" reprovou por **`strict mode`**: `agora-barra` resolvia para 2 elementos | A fixture do portão passou a criar **duas** atividades em curso, e a asserção da barra não estava escopada ao cartão | A asserção passou a ser feita DENTRO do `agora-item-<id>`; e o evento dedicado do endereço da sala online nasceu com SALA PRÓPRIA, para não multiplicar as contagens exatas de `agora-cracha-*`/`agora-balcao-*` |
| 10 | O `VenueBlock` **não era renderizado** na varredura (o `evento-sala-online` não existia no DOM) | Sem página publicada, a landing cai na composição padrão, que não tem o bloco de LOCAL | A fixture ganhou um **evento dedicado** com `EventPage` publicada e os blocos `SCHEDULE` + `VENUE_MAP` — e não o evento da F65, cuja página publicada trocaria o desenho das outras varreduras dele |

---

## 6. Evidência de verificação

### 6.1 A bateria da §4 do `AGENTS.md`

```text
npm run lint               → 0 erros, 0 warnings
npm run typecheck          → EXIT=0
npm test                   → 181 arquivos, 3410 casos, 3410 passando, 0 falhando
npm run build              → ✓ Compiled successfully in 12.9s · 16/16 páginas geradas
npm run db:verify          → "Contrato íntegro." (4 verificações, incluindo a role de runtime)
npm run db:verify:isolation → "9/9 verificações passaram."
```

O E2E inteiro: **ver §6.4**.

### 6.2 O portão WCAG AA — de 23 para **26 casos**, `ISENCOES = []`

Os **três** casos novos, e o que cada um prova:

| Caso | O que ele afirma antes de varrer |
|---|---|
| `a aba "Acontecendo agora" com a sala online` | o cartão em curso, o link `agora-sala-online-<id>` com o `href` **da atividade** e o grupo `agora-sala-<sala>` |
| `o bloco de local com a sala online` | o `evento-sala-online` com o `href` **do evento**, o endereço físico ao lado e o bloco `#local` |
| `a página da atividade com a sala online` | o `atividade-sala-online` com o `href` da atividade (inscrição CONFIRMADA da pessoa na fixture) |

**A catraca morde — provado por mutação.** A mutação foi `[color:#c9cbd1]` (um cinza claro) na
classe do link novo, com o container reconstruído e a varredura rodada. Saída real:

```text
Error: Acessibilidade em aba "acontecendo agora" com a sala online
(/t/acessibilidade-c83e5125/eventos/<slug>?aba=agora): 1 violação(ões) de impacto crítico/sério

  ✗ color-contrast (serious) — Elements must meet minimum color contrast ratio thresholds
    elementos (3):
      a[target="_blank"]
        <<a href="https://sala.exemplo..." target="_blank" rel="noopener noreferrer"
          class="inline-flex items-ce..." data-testid="agora-sala-online-28...">>
      .hover\:opacity-80.\[color\:\#c9cbd1\].border-current:nth-child(1)
        <<a class="inline-flex items-ce..." data-testid="agora-cracha-2827ee9...">>
      .hover\:opacity-80.\[color\:\#c9cbd1\].border-current:nth-child(2)
        <<a class="inline-flex items-ce..." data-testid="agora-balcao-2827ee9...">>

    - Expected  - 1
    + Received  + 3
    - Array []
    + Array ["color-contrast"]
 1 failed · 2 passed (12.0s)
```

O link novo é o **primeiro** nó da lista, e os três nós que reprovam são do MESMO cartão — a
mutação mostrou que o portão mede o nó da fase e os vizinhos. **A mutação foi desfeita** e a
árvore voltou a passar (`47 passed` na dupla a11y + visual).

### 6.3 A regressão visual — **21 linhas de base**, e **1 medida antes de regerar**

`evento-aba-agora.png` mudou porque o cartão do "acontecendo agora" passou a desenhar o link da
sala online. **A caixa dos pixels diferentes foi medida ANTES de qualquer regeração** — a mesma
regra que a F66 e a F67 já tinham pagado para aprender:

```text
antes : 1440x1338
depois: 1440x1338
pixels diferentes (limite 10/255 por canal): 70333 de 1926720
razao: 3.650401%  (maxDiffPixelRatio do projeto: 0)
caixa: x 208..1231 (largura 1024) · y 745..937 (altura 193)

perfil por faixas de linha (para dizer ONDE mudou):
linhas 745..774  (altura 30) · pixels  2827 · pico  293
linhas 782..833  (altura 52) · pixels 44456 · pico 1024
linhas 842..857  (altura 16) · pixels 16384 · pico 1024
linhas 883..898  (altura 16) · pixels  3845 · pico 1024
linhas 925..937  (altura 13) · pixels  2821 · pico  419
```

A leitura: o link novo entra **acima** do par crachá/balcão e empurra a linha deles ~28 px para
baixo; as faixas de pico 1024 são as **máscaras** de largura fixa (o trilho da barra, a linha de
informação do cartão e o "a seguir"), que mudaram de y junto com o conteúdo — que é exatamente o
que a F65 documentou ("máscara de nó que muda de tamanho é máscara que se mexe"). A linha de
base foi regerada **depois** da medição, e `abrirAbaDoAgora` ganhou a asserção do link novo
(exatamente um `agora-sala-online-*`, com o `href` conferido): uma tela que perdesse o link
deixaria a foto verde se ninguém o afirmasse.

**A prova de que a linha de base mede o link:** com o link deslocado por um `mt-1` (mutação de
1 px de margem), o teste reprovou com **22.398 pixels diferentes (ratio 0,02)**. A mutação foi
desfeita.

**O que ficou de fora, com o motivo:** o `VenueBlock` não atinge linha de base — com
`?aba=agora` os blocos não são renderizados, e a página do evento sem a aba **não está** entre as
21 linhas do arquivo. Prendê-lo exigiria **criar** uma linha de base nova (o §4 do plano já
avisava disso), e a decisão desta fatia foi **não** criar: o bloco entra no portão WCAG AA (com
a fixture publicada) e o `href` dele é afirmado lá. **Fica registrado como ponto de atenção**, e
não como dívida: o desenho do bloco é o mesmo `ef-card`/`.ef-muted` que a página pública já
tinha, e a superfície nova dele é o link, que está preso por atributo.

### 6.4 A suíte E2E inteira

```text
docker compose --profile app up -d --build web worker
eventflow/web:local  2026-10-06 11:43:12 -0300   ← a data foi CONFERIDA antes de rodar
npx playwright test --output=<dir FORA da árvore>
```

Os números e os vermelhos estão no §9 (checklist) e no relatório da sessão — inclusive os que
exigiram medição isolada.

---

## 7. Comandos operacionais

```bash
# A fase inteira, por camada
npx vitest run tests/unit/f68-chamada-opcional.test.ts      # 7 casos  — o interruptor
npx vitest run tests/unit/f68-sala-online.test.ts           # 23 casos — a regra do endereço
npx vitest run tests/unit/f68-dia-padrao.test.ts            # 12 casos — o dia e o campo
npx vitest run tests/integration/f68-sala-online.test.ts    # 13 casos — o banco e a RLS
npx vitest run tests/integration/f68-dia-padrao.test.ts     # 3 casos  — o saveEvent real

# As catracas
npx playwright test tests/e2e/accessibility.spec.ts         # 26 casos, SEM isenção
npx playwright test tests/e2e/f62-regressao-visual.spec.ts  # 21 linhas de base
npx playwright test tests/e2e/f68-sala-online.spec.ts       # 4 casos

# O E2E inteiro exige o container com o código NOVO
docker compose --profile app up -d --build web worker
docker images | grep eventflow/web        # conferir a data da imagem ANTES de rodar
npx playwright test --output=%TEMP%\e2e   # outputDir FORA da árvore (senão suja o repositório)

# Migrações (e o zero drift)
npm run db:migrate
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW" --exit-code
```

---

## 8. Dívidas técnicas e pontos de atenção

**Nenhuma dívida nova foi declarada nesta fase.** O que ficou aberto, e o que é decisão e não
pendência:

1. **O `VenueBlock` não tem linha de base visual** (medido, §6.3). Ele entra no portão de
   acessibilidade e o `href` é preso por atributo; criar a linha de base exigiria uma captura
   nova da página do evento na aba padrão. Não é dívida porque não há defeito: é cobertura a
   mais que a fase decidiu não pagar.
2. **O `prisma/seed.ts` não foi tocado** — o evento do seed que tem chamadas deveria nascer com
   `usesCall: true` para o bloco aparecer na página pública. Declarado pela fatia 1 e **não
   resolvido** aqui; é o mesmo tipo de "fato que o dado de demonstração não declara" que a
   prontidão existe para pegar.
3. **`saveCall` liga o interruptor** (e `setCallPublished` também): as duas linhas foram
   autorizadas e implementadas. **Não há caminho que DESLIGUE automaticamente** — desligar é ato
   do organizador no formulário do evento, que é a decisão registrada no ADR-341.
4. **A condicional do campo da sala online é do servidor**, então trocar a modalidade no
   `<select>` não revela o campo na hora (é preciso salvar). O preço está declarado no §3.4 e foi
   a escolha — uma regra em vez de duas.
5. **Os rótulos de modalidade continuam duplicados em quatro telas** (`eventos/page.tsx`,
   `dados/page.tsx`, `programacao/page.tsx` e o novo `event-form-defaults.ts`). Uniformizar é
   escopo extra e **não foi autorizado** (§2.6 do plano). O que a fase fez foi dar aos dois
   formulários **uma** função que decide o campo, em vez de espalhar a condição.
6. **A `Activity.modality` continua sem leitor PÚBLICO próprio na listagem**: o selo "Online" da
   atividade não produz nada na página dela além do endereço da sala. O plano registrou isso como
   escopo extra (§2.6) e a fase não o tocou.

---

## 9. Checklist de aceite

### Fatia 1 — a chamada vira interruptor

- [x] `Event.usesCall` (Boolean, NOT NULL, default false) com migração
- [x] `saveEvent` **não** desliga o interruptor quando o campo vem ausente (com teste)
- [x] Os dois campos da janela saem dos dois formulários
- [x] A prontidão (F53) deriva de **chamadas publicadas**, e não da janela do evento
- [x] **`CFP_CLOSED` devolvido de verdade** pelo serviço (era declarado e nunca devolvido)
- [x] A migração **remove as duas colunas**, com `migrate diff --exit-code` = 0
- [x] Catracas da F53/F54 atualizadas **ganhando** asserções

### Fatias 2 e 3 — o endereço e a visibilidade

- [x] Escritor de `Event.onlineUrl` (domínio → serviço → formulários)
- [x] `Activity.onlineUrl` com migração, serviço e programação
- [x] Projeções (`event-repository.ts`, `PublicActivitySummary`) carregando os dois
- [x] Regra pura `CONFIRMED ∪ PENDING ∪ equipe`, **derivada** de `registrationIsLive`
- [x] Resolução no servidor na página do evento, na aba "Acontecendo agora" e na atividade
- [x] **Vazamento do `VenueBlock` fechado** (o anônimo não recebe o endereço)
- [x] Prova por **estado de inscrição**: confirmada vê · retendo vaga vê · **espera não vê** ·
      equipe vê · anônimo não vê
- [x] Prova por **instituição**: a vizinha não vê (a mesma pessoa, lida sob a outra instituição)
- [x] E2E provando a **ausência no HTML** de quem não é inscrito e a presença para quem é
- [x] O endereço **não** entra no `.ics`, nem em metadados, nem em props de Client Component

### Fatia 4 — o dia como padrão e os dois consertos de data

- [x] O formulário nasce com **09:00 → 18:00 no mesmo dia** (`defaultEventPeriod`)
- [x] A hora do início **não** vem do minuto do render (com teste)
- [x] Um evento 09:00→18:00 no mesmo dia **passa** na validação (unidade **e** `saveEvent` real)
- [x] O rótulo da raiz do painel usa `formatEventPeriod` (mesmo dia + fuso do evento)
- [x] O `timeZone: 'UTC'` da descrição/SEO consertado, com `timeZone` obrigatório
- [x] Os três formatadores de período conferidos — os três já tratavam o mesmo dia,
      **nenhum foi tocado**

### Fatia 5 — catracas e documento

- [x] Portão WCAG AA a **26 casos**, `ISENCOES = []`
- [x] As três superfícies do endereço no portão, com a varredura afirmando o conteúdo antes
- [x] **Catraca provada por mutação** (com a saída real) e desfeita
- [x] Regressão visual com a **caixa dos pixels medida antes** de regerar (§6.3)
- [x] `abrirAbaDoAgora` afirma exatamente um `agora-cracha-*`, um `agora-balcao-*` e um
      `agora-sala-online-*` (prefixo distinto do grupo `agora-sala-*`)
- [x] A página da atividade consertada **pela causa**: `<dl>` → `div`, `opacity-60` → `.ef-muted`
- [x] `docs/fase-68-*.md` com as **9 seções** e **ADR-341/342/343**
- [x] `AGENTS.md`, `README.md` e `docs/dividas-tecnicas.md` atualizados
- [x] Nenhuma isenção nova, nenhum `fixme`/`skip` novo, nenhum critério afrouxado
- [x] Bateria da §4 com os **números reais**

---

## 10. Estado da fase

**ENTREGUE.** As seis fatias (0 a 5) estão na árvore, a bateria da §4 roda com os números do §6,
e o portão WCAG AA e a regressão visual estão verdes com as catracas provadas por mutação.

Aguardando APROVADO: AVANÇAR
