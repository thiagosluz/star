# FASE 22 — Operação de palco

> **Estado:** entregue. Fecha as seis dívidas do tema de sorteios (**G8–G13**): desfazer
> uma entrega registrada por engano, buscar no histórico, premiar mais de um revisor,
> endereço próprio do resultado publicado, rotação versionada da chave do cofre de
> sementes e prévia ao vivo sem polling.

---

## 1. Sumário executivo

| Entrega | Item | Arquivo-chave |
|---|---|---|
| Desfazer a entrega do prêmio **com motivo obrigatório**, preservando as duas pontas na trilha | **G8** | `reversePrizeDelivery` (`raffle-service.ts`), `spec` 4 |
| Histórico filtrável por **situação** e **período**, no fuso da instituição | **G9** | `parseRaffleHistoryFilter` (`stage-rules.ts`), `listRaffles` |
| Premiar **N** revisores pela tela, com o corte antecipado | **G10** | `resolveReviewerAwardCount`, `reviewer-award.tsx` |
| **Página pública de um sorteio**, com a prova da semente | **G11** | `getPublicRaffleResult`, nova rota pública |
| Chave do cofre **versionada**, girada sem invalidar compromisso publicado | **G12** | `seed-key-rules.ts`, `seed-vault.ts`, `RAFFLE_SEED_KEYS` |
| Prévia ao vivo por **SSE**, com polling como caminho de volta | **G13** | `raffle-live/route.ts`, `raffle-console.tsx` |
| Correção de privacidade encontrada no caminho: o **consentimento de perfil público** nascia ligado | ADR-139 | `User.isPublicProfile` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | 5 de produção/UI + 3 de teste |
| Arquivos alterados | 12 |
| Migrações | **2** — `20260921160000_raffle_seed_key_version` e `20260921170000_public_profile_default_false` |
| Permissões | 58 (nenhuma nova: a operação usa `event:manage` e `card:grant`, que já existiam) |
| Testes | **1454** (Vitest) · **94** (Playwright E2E) |
| Testes novos | 27 unitários + 13 de integração + 5 E2E = **45** |
| Dívidas quitadas | G8, G9, G10, G11, G12, G13 |
| Dívidas novas | E35 (não há tela para a pessoa autorizar o nome no resultado público) |
| Build/imagem | `Dockerfile` corrigido no caminho: o estágio do worker deixou de instalar `tsx` pela rede (cópia do estágio `deps` + árvore de produção completa + prova de boot no build) — armadilha 61 |

### O que mudou para quem opera

```text
Antes                                        Depois
─────────────────────────────────────────    ─────────────────────────────────────────────
entrega marcada errada = SQL                 "Desfazer" com MOTIVO; a trilha guarda as
                                             duas pontas (F22/G8)

achar um sorteio = navegar página a página   filtro por situação e período, no endereço
                                             (compartilhável, sobrevive ao recarregar) (G9)

premiar 3 revisores = chamar o serviço       campo "quantos reconhecer", com o corte dito
                                             antes do clique (G10)

resultado publicado = seção no meio da       endereço próprio do sorteio, para projetar e
página do evento                             compartilhar, com a prova da semente (G11)

trocar o segredo = compromisso de todo o     chaveiro versionado: girar a chave não
histórico deixa de abrir                     invalida semente já selada (G12)

número atualiza a cada 5 s por tela          uma conexão SSE por tela; o polling continua
aberta (N×12 req/min)                        como caminho de volta se o fluxo cair (G13)
```

---

## 2. O problema mais difícil: **o que se pode desfazer sem apagar a história**

A FASE 16 gravou a entrega do prêmio como **registro imutável** (ADR-086), e a intenção
estava certa: um recibo que pode ser reescrito em silêncio não serve como recibo. O que
faltou foi o outro lado do balcão — alguém marca "entregue" na posição errada (o nome
parecido, a lista fora de ordem) e a única saída era SQL. No dia do evento isso é uma
fila parada.

A saída óbvia — permitir apagar a entrega — destruiria a garantia: o registro que existe
para provar que o prêmio saiu passaria a poder desaparecer. A saída oposta — nunca
corrigir — deixa o erro registrado para sempre.

O desenho entregue separa **o que aconteceu** de **o que está valendo**:

- a **posição sorteada** nunca é tocada: a pessoa continua sendo a ganhadora daquele
  lugar no sorteio;
- o que se desfaz é o **registro de retirada** (`deliveredAt`, `deliveredById`,
  `deliveryNote` voltam a nulo);
- e a **trilha guarda as duas pontas**: a entrega original (com autor e horário) e a
  reversão (com autor, horário e **motivo**). Nada é apagado, e a pergunta que uma
  auditoria faz — "por que esta entrega foi desfeita?" — tem resposta no sistema.

O motivo é **obrigatório** (`evaluateDeliveryReversal`, mínimo de 5 caracteres). Não é
burocracia: é o único campo que separa "corrigi um erro no balcão" de "apaguei um
registro", e é ele que impede o clique reflexo de desfazer um fato consumado.

---

## 3. Entregas em detalhe

### 3.1 G8 — desfazer a entrega

`reversePrizeDelivery({ tenantId, raffleId, positionId, actorId, reason })`:

1. carrega o sorteio e a posição (o id é o da **posição**, não o da pessoa — armadilha 28);
2. recusa quando não há entrega (`NOT_DELIVERED`) ou quando o motivo é curto
   (`REASON_REQUIRED`), com a mensagem que explica por que ele é exigido;
3. limpa o recibo e grava a trilha com `entregaDesfeitaEm`, `entreguePorAnteriormente`,
   `observacaoDaEntregaAnterior` e `motivoDaReversao`.

Depois da reversão, **registrar a entrega de novo funciona** — é o caminho de quem
corrigiu: entrega para a pessoa certa, com a observação certa.

### 3.2 G9 — busca no histórico

O filtro tem dois eixos: **situação** (`DRAFT` / `DRAWN` / `CANCELED`) e **período de
criação**. O recorte acontece no `where` do banco, junto com a contagem — filtrar em
memória daria "página 1 de 7" com três itens, porque o total e a página teriam sido
calculados sobre conjuntos diferentes.

Duas decisões que o teste unitário fixou:

- **o dia é o da INSTITUIÇÃO** (armadilha 38): `2026-10-18` digitado por quem está em
  `America/Bahia` começa às 03:00Z e termina às 02:59:59Z do dia seguinte. Com
  `new Date('2026-10-18')`, o filtro começaria às 21h do dia ANTERIOR e quem sorteou às
  22h de terça sumiria de um filtro por "quarta";
- o rótulo do filtro usa o **texto digitado**, não o instante: o fim do dia local cai no
  dia seguinte em UTC, e reformatar o instante mostraria "criado até 19/10" para quem
  filtrou 18/10 (foi o teste unitário que pegou, antes de chegar à tela).

O filtro vive no **endereço** (`?situacao=DRAWN&de=…&ate=…`): o link é compartilhável, o
botão "voltar" funciona, e a paginação carrega o recorte adiante. Período invertido é
**recusado** com mensagem própria, em vez de devolver lista vazia — que pareceria defeito.

### 3.3 G10 — premiar N revisores

O painel premiava exatamente uma pessoa (`<input type="hidden" name="top" value="1">`).
Agora há um campo numérico cujo teto vem do **domínio** (`MAX_REVIEWER_AWARDS = 10`), e a
tela usa a MESMA função que o servidor (`resolveReviewerAwardCount`) para dizer, antes do
clique, quantos serão premiados. "Pedi 5, o ranking tem 3" é uma decisão informada, não
uma surpresa.

### 3.4 G11 — página própria do resultado

`/t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>` — pública, sem login, com os
titulares, os suplentes em `<details>`, e a **prova** logo abaixo: hash do resultado,
compromisso e semente revelada.

A seção da página do evento continua existindo (é a divulgação de TODOS os resultados) e
cada item agora leva ao endereço próprio — que é o que se projeta no telão e se cola no
grupo do evento.

A página responde **404** quando o sorteio não existe, não foi apurado ou não foi
publicado. Não há página explicando "existe, mas não está publicado": isso já seria
informação demais para quem não organiza (mesma decisão do material de palestrante de
inscritos, FASE 25).

### 3.5 G12 — chave do cofre com versão

`RAFFLE_SEED_KEYS` declara o chaveiro (`versão:segredo`, separado por vírgula). A versão
**atual** é a maior; os sorteios novos selam com ela e gravam a versão em
`raffles."seedKeyVersion"`. Abrir uma semente usa a versão **gravada**, nunca a atual — é
isso que permite girar a chave sem invalidar compromisso já publicado.

A versão `0` é a **legada** (`sha256('eventflow:raffle-seed:' + BETTER_AUTH_SECRET)`), byte
a byte igual à fórmula anterior: é ela que abre todo sorteio criado antes desta fase. A
tela de sorteios mostra a situação do chaveiro — versão em uso, versões disponíveis e os
**problemas de formatação** (entrada malformada, segredo curto, versão repetida) — porque
um erro de digitação na variável de ambiente, sem isso, só apareceria na hora de abrir a
semente, com o público esperando.

### 3.6 G13 — prévia ao vivo por SSE

A rota `/api/events/<eventId>/raffle-live` **negocia o transporte**: quem manda
`Accept: text/event-stream` recebe o fluxo; qualquer outra coisa recebe o JSON de sempre,
com o mesmo corpo. Nada quebra, e o comportamento novo é opt-in de quem sabe pedir.

O servidor consulta a cada 3 s e **emite só quando o número muda** (uma tela parada recebe
silêncio, não repetição), com heartbeat a cada 20 s para proxy que fecha conexão ociosa. O
encerramento vem do `request.signal` do runtime — sem isso, o intervalo continuaria
consultando o banco para um cliente que não existe.

No cliente, o `EventSource` é o caminho principal e o **polling de 5 s é o caminho de
volta**: se o fluxo for derrubado por um proxy que não o suporta, a tela volta a
perguntar em vez de congelar o número no meio da apresentação. O atributo
`data-transport` e o texto ("ao vivo" × "consultado") dizem qual dos dois está em uso.

---

## 4. ADRs

### ADR-137 — Desfazer a entrega limpa o RECIBO e mantém as duas pontas na trilha

**Contexto.** A entrega do prêmio é registro imutável desde a FASE 16 (ADR-086), e o erro
de balcão não tinha correção pela interface: só SQL.

**Decisão.** `reversePrizeDelivery` limpa `deliveredAt`/`deliveredById`/`deliveryNote` da
posição — que continua existindo — e grava na trilha a entrega desfeita e o motivo
obrigatório. Depois da reversão, a entrega pode ser registrada de novo.

**Alternativas descartadas.** *Apagar a linha da posição*: apagaria o resultado do
sorteio, que é o registro auditável. *Permitir editar a entrega*: um recibo editável não
é recibo. *Reverter sem motivo*: viraria um clique capaz de apagar um fato consumado sem
deixar uma frase sequer de justificativa. *Exigir um segundo aprovador*: no palco não há
duas pessoas com a mesma permissão — a trava real é o motivo escrito.

**Consequências.** O ADR-086 continua valendo para o que ele protegia (o registro não é
reescrito em silêncio) e ganha a válvula que faltava. A trilha do `rafflePrize` passa a
ter dois eventos por reversão; quem lê precisa distinguir pelo nome do campo, e é por isso
que eles nomeiam o fato (`entregaDesfeitaEm`, `motivoDaReversao`) em vez de "de → para".

### ADR-138 — A prévia ao vivo negocia o transporte na mesma rota

**Contexto.** A FASE 16 escolheu polling de 5 s e escreveu por que não usar SSE (ADR-090):
uma conexão aberta por tela traria reconexão, heartbeat e timeout de infraestrutura. Com
N telas no mesmo evento (palco, balcão, coordenação), o polling é N×12 requisições por
minuto, cada uma refazendo a consulta de elegibilidade.

**Decisão.** A MESMA rota responde JSON ou SSE conforme o `Accept`. O servidor amostra a
cada 3 s e emite só na mudança; o cliente usa `EventSource` com o polling como caminho de
volta, e diz na tela qual está em uso.

**Alternativas descartadas.** *Trocar a rota por SSE puro*: quebraria clientes e testes
existentes, e o JSON continua sendo a resposta certa para uma leitura pontual. *Rota nova
(`/stream`)*: dois endereços com a mesma autorização e a mesma consulta, que divergiriam
no primeiro ajuste de permissão. *WebSocket*: exigiria um processo novo na stack para um
fluxo que só vai do servidor para o cliente.

**Consequências.** O polling deixa de ser o caminho principal e continua existindo como
degradação declarada. A tela não pode mais dizer "amostrado às…" sem distinguir: o texto
diz "ao vivo" quando o fluxo está aberto e "consultado" quando caiu para o polling — uma
tela parada não pode parecer viva.

### ADR-139 — O consentimento para publicar o nome nasce DESLIGADO

**Contexto.** `User.isPublicProfile` nasceu `BOOLEAN NOT NULL DEFAULT true` na migração
inicial, e o domínio do sorteio lê o campo como consentimento explícito: ligado, o
resultado público mostra o nome completo; desligado, mascara. Como **nenhum** caminho do
sistema escreve essa coluna, toda conta nasceu com `true` — o efeito real era o oposto do
documentado ("nome mascarado por padrão"): nome completo publicado por um consentimento
que ninguém deu.

O defeito sobreviveu à FASE 16 porque o teste de integração **gravava** `isPublicProfile:
false` na fixture, em vez de deixar o padrão do banco valer: a suíte escrevia o valor que
o domínio esperava e nunca exercitava o default.

**Decisão.** O padrão passa a ser `false`, e as linhas existentes com `true` voltam para
`false` — porque não podem representar escolha. Quem quiser publicar o nome passa a ter de
ligar o campo (tela própria, dívida **E35**).

**Alternativas descartadas.** *Só trocar o default e deixar as linhas antigas*: manteria
o vazamento para todo mundo que já existe, que é justamente o universo afetado. *Trocar o
default e preservar `true` como opt-in presumido*: presume consentimento a partir de um
valor que ninguém escolheu. *Mascarar sempre*: tiraria de quem quer se identificar a
possibilidade de fazê-lo.

**Consequências.** A mudança é no sentido seguro (mascara mais, nunca menos) e reversível.
Fica declarada a dívida **E35**: sem tela, o consentimento não pode ser dado por quem
gostaria — o campo existe e o domínio o respeita, mas não há caminho de interface.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 31 | O teste unitário reprovou o rótulo do filtro: quem filtrava `criado até 18/10` lia "criado até **19/10**" | O fim do dia LOCAL é 02:59:59Z do dia SEGUINTE, e o rótulo formatava o INSTANTE em UTC. A conversão estava certa para a consulta e errada para o texto: o dado certo, exibido de volta, contradizia o campo que a pessoa acabou de preencher | O filtro passa a carregar também o **texto digitado** (`fromDay`/`toDay`) e o rótulo formata esse texto. Instante para consultar, texto para exibir |
| 32 | O teste de integração da página pública reprovou: o nome do ganhador saía COMPLETO, contra a regra "mascarado por padrão" | `User.isPublicProfile` nasce `true` desde a migração inicial, e nenhum caminho do sistema escreve a coluna — todo mundo "consentiu" sem escolher. A fixture da FASE 16 gravava `isPublicProfile: false` explicitamente, então o default nunca foi exercitado | O padrão passou a `false`, as linhas existentes foram normalizadas e a migração explica por quê (ADR-139). A lição: **fixture que escreve o valor esperado esconde o default do banco** — o cenário que pegou o defeito criou as contas pelo caminho normal |
| 33 | O `drawRaffle` de um sorteio selado na versão 1, depois de a chave girar, não abria a semente | A versão não era gravada: a abertura usava a chave ATUAL. Como o cofre não falha alto (cai para o gerador do sistema, para não travar o palco), a degradação era silenciosa — o sorteio acontecia, sem a prova de commit-reveal | `raffles."seedKeyVersion"` grava a versão no ato do selo, e `sealSeed` devolve selo E versão na mesma estrutura: gravar um sem o outro deixou de ser possível por construção. Teste de integração prende o giro com a versão antiga ainda declarada |
| 34 | Sem `RAFFLE_SEED_KEYS` válido, o sorteio continuava apurando — e o operador não tinha como saber que a prova tinha se perdido | O cofre degrada em silêncio por decisão (não travar o palco), mas a degradação só aparecia no resultado, no meio da apresentação | A tela de sorteios passou a mostrar a **situação do chaveiro** (versão em uso, versões disponíveis, problemas de formatação) ANTES da apuração. A lição é a mesma do e-mail da FASE 15: configuração que degrada em silêncio precisa de um lugar na tela que diga que degradou |
| 35 | O `docker compose build worker` ficou **mais de dez minutos no mesmo passo**, sem saída, e quando a internet oscilou o `next build` caiu com "Failed to fetch Inter from Google Fonts". O worker chegou a subir em laço de reinício com `Cannot find module '/app/node_modules/dotenv/config'` | O passo de build **não alcança o registro npm** (um `wget` ao registro dentro de um `RUN` estoura o tempo; o mesmo `wget` de um `docker run` comum responde), `npx` e o Prisma sondam a rede antes de rodar, e o `npm install tsx` do estágio do worker — além de instalar — **consertava** o `node_modules` parcial do `.next/standalone`: o traço do Next não tem `ioredis`, tem `bullmq` pela metade e tem `dotenv` sem `package.json` (por isso o subcaminho `dotenv/config` não resolvia quando o install virou cópia) | O build deixou de depender do registro: o `tsx` e o `esbuild` são **copiados** do estágio `deps` para `/tools`, o `node_modules` do worker passou a ser a **árvore de produção completa** (`npm prune --omit=dev --offline`, que só REMOVE), o Prisma é chamado por caminho com `CHECKPOINT_DISABLE=1` e uma **prova de boot** no build recusa `ERR_MODULE_NOT_FOUND` — peça faltando derruba o build, em vez de o worker morrer no primeiro job (armadilha 61) |
| 36 | O E2E reprovou o SSE (`data-transport` ficou em `polling`) e o `curl` com `Accept: text/event-stream` recebeu **JSON** — como se a negociação não existisse no código | A negociação existia; quem não tinha era o **container**. O `docker images` mostrava a imagem `web` construída às 13:40 com todo o código da fase, e o container seguia rodando a imagem ANTERIOR (criada às 14:33 a partir de outra construção, e nunca recriada porque o build de então foi interrompido). O E2E estava medindo código de duas horas antes — a armadilha 3 acontecendo com o build **parcialmente** concluído, quando a data da tag parece boa | A prova passou a ser o **ID da imagem do container** (`docker inspect eventflow-web --format '{{.Image}}'`) comparado ao ID da tag, e não a data dela; e, para uma funcionalidade específica, um `grep` do marcador dentro do container em execução (`docker exec eventflow-web grep -rl x-accel-buffering .next`). Com o container recriado, o mesmo `curl` recebeu `content-type: text/event-stream` e o primeiro `event: live` |
| 37 | O E2E do resultado público reprovou com `expect(naoPublicado).toBeDefined()` → `undefined` | O cenário contava com o estado que OUTRO teste deixou, e nenhum teste deste arquivo cria um sorteio **apurado e NÃO publicado** (o único apurado é publicado pelo próprio fluxo). A busca devolvia `undefined` — e o ramo que ele existe para provar (404 do não publicado) ficava sem sujeito: o teste passaria a medir nada | O cenário cria a própria fixture (o sorteio apurado e fechado, direto no banco, como o cenário do filtro já fazia) e aponta para ele. **Cenário que depende do estado deixado por outro precisa que alguém produza esse estado** — a lição já estava escrita no arquivo desde a FASE 14 e voltou a morder por outro caminho |
| 38 | O E2E do painel de reconhecimento reprovou: com 3 digitado, a tela dizia **"informe ao menos 1"** | O texto era FIXO para qualquer recusa do domínio. Com o ranking vazio, a recusa era `NO_RANKING` ("nenhum revisor atingiu o mínimo de pareceres"), e a tela mostrava a instrução do outro motivo — orientação errada, sem relação com o que a pessoa tinha digitado. O cenário também não tinha ranking nenhum: ele pedia o corte anunciado num evento sem comitê | A tela passou a exibir a mensagem do PRÓPRIO domínio (`decision.message`, a mesma que o servidor usaria) e o cenário passou a criar o ranking (3 pareceres submetidos, que é o piso), provando o corte: pedindo 5 com 1 no ranking, a tela anuncia "serão premiados 1" e "o ranking tem 1 revisor(es)". **Quando a decisão já traz a mensagem, a tela não deve reescrevê-la** — texto fixo mente quando há mais de um motivo de recusa |

---

## 6. Evidência de verificação

### 6.1 Bateria (árvore final)

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 60 arquivos, 1454 testes passando (+40 nesta fase)
npm run build                → ✓ Compiled successfully
npm run db:migrate:status    → 22 migrations found · Database schema is up to date!
npm run db:verify            → Contrato íntegro.
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:partitions        → partições do mês atual e dos seguintes em dia
npm run test:e2e             → 94 passed
```

As imagens foram reconstruídas e os containers RECRIADOS — a prova é o ID, não a data:

```text
docker compose build worker   → "grafo de módulos do worker carregado por inteiro" (prova de boot no build)
docker inspect eventflow-web --format '{{.Image}}'  → sha256:9e1b525d… = eventflow/web:local
docker exec eventflow-web grep -rl x-accel-buffering .next                  → .next/server/chunks/_0lexm0m._.js
docker exec eventflow-web grep -rl data-transport .next/static/chunks       → 174zkbhj-6w34.js
curl -H 'Accept: text/event-stream' …/raffle-live?tenantSlug=ufba-demo      → content-type: text/event-stream
                                                                              x-accel-buffering: no
                                                                              event: live  (primeira amostra)
```

Duas migrações nesta fase, ambas escritas à mão e aplicadas com `db:migrate:deploy`:

```text
20260921160000_raffle_seed_key_version     → raffles."seedKeyVersion" (default 0 = chave legada)
20260921170000_public_profile_default_false → user."isPublicProfile" default false + normalização
```

### 6.2 Testes novos

```text
Unitários (27) — tests/unit/stage-operation.test.ts
✓ desfazer exige entrega registrada e motivo com tamanho mínimo; motivo válido volta sem espaços
✓ motivo gigante é truncado no teto da coluna
✓ o filtro usa o DIA DA INSTITUIÇÃO (18/10 em America/Bahia = 03:00Z … 02:59:59Z do dia 19)
✓ situação inválida, data fora do formato e período invertido são recusados, cada um com seu código
✓ o rótulo do filtro mostra o dia DIGITADO, não o instante
✓ premiar: zero/negativo recusado, ranking vazio explicado, pedido maior que o ranking avisa e corta
✓ o teto do domínio limita o pedido de prêmios
✓ resultado só aparece publicado E apurado; o estado distingue "não publicado" de "não apurado"
✓ chaveiro: vazio, versão 0 reservada, versão não inteira, segredo curto, versão repetida (vale a 1ª)
✓ o segredo pode conter ":" — a divisão é no PRIMEIRO

Integração (13) — tests/integration/stage-operation.test.ts
✓ G8 — recusa desfazer sem motivo, e o motivo fica na trilha quando a reversão acontece
✓ G8 — a POSIÇÃO continua existindo (desfez-se o recibo, não o sorteio)
✓ G8 — desfazer duas vezes é recusado; a entrega pode ser registrada DE NOVO depois
✓ G9 — o filtro recorta no banco (o total acompanha o filtro)
✓ G9 — o período usa o dia da instituição, e o filtro do domínio alimenta a consulta
✓ G11 — só devolve resultado publicado E apurado (404 para o resto, inclusive despublicado)
✓ G11 — sorteio de outra instituição não é alcançado
✓ G12 — sem chaveiro, o sorteio sela na chave legada (versão 0)
✓ G12 — com chaveiro, a versão ATUAL (a maior) vai gravada no sorteio
✓ G12 — GIRAR a chave não invalida a semente selada com a versão antiga (`seeded = true`)
✓ G12 — sem a chave da versão, a apuração avisa em vez de mentir (e não quebra)
✓ G12 — o chaveiro declara os problemas de formatação em vez de ignorá-los
✓ G12 — a versão gravada continua legível depois de o chaveiro ser limpo

E2E (5) — tests/e2e/raffle-end-to-end.spec.ts (bloco "operação de palco")
✓ G13 — a prévia ao vivo chega por SSE (`data-transport="sse"`) e a tela diz "ao vivo às…"
✓ G8 — desfazer a entrega exige motivo e a posição volta a "não entregue", com o motivo na trilha
✓ G9 — o histórico é filtrável por situação e período; recarregar mantém o recorte; período
  invertido é recusado com mensagem
✓ G11 — o resultado publicado tem endereço próprio (200, com a prova da semente e nome
  mascarado) e o não publicado responde 404
✓ G10 — o painel deixa escolher QUANTOS premiar, com o teto do domínio (10) e o corte dito
  ANTES do clique: pedindo 5 com 1 revisor no ranking, anuncia "serão premiados 1"
```

---

## 7. Comandos operacionais

```bash
# Chaveiro do cofre: declarar versões (a MAIOR é a que os sorteios novos usam)
#   RAFFLE_SEED_KEYS=1:<segredo antigo>,2:<segredo novo>
# Girar a chave SEM perder o histórico: mantenha a versão antiga declarada enquanto
# houver semente selada com ela. A situação do chaveiro aparece na tela de sorteios.

# Quais sorteios foram selados com cada versão?
docker exec eventflow-postgres psql -U eventflow_admin -d eventflow -c "
  SELECT \"seedKeyVersion\", count(*) AS sorteios,
         count(*) FILTER (WHERE \"seedRevealed\" IS NOT NULL) AS revelados
    FROM raffles GROUP BY 1 ORDER BY 1;"

# Entregas desfeitas (quem reverteu, quando e por quê) — a trilha tem as duas pontas
docker exec eventflow-postgres psql -U eventflow_admin -d eventflow -c "
  SELECT \"entityId\", \"userId\", changes, \"createdAt\"
    FROM audit_logs
   WHERE \"entityType\" = 'rafflePrize'
     AND changes::text LIKE '%motivoDaReversao%'
   ORDER BY \"createdAt\" DESC LIMIT 20;"

# Quem autorizou o nome completo no resultado público (deve ser um conjunto pequeno)
docker exec eventflow-postgres psql -U eventflow_admin -d eventflow -c "
  SELECT count(*) FILTER (WHERE \"isPublicProfile\") AS publicos, count(*) AS total FROM \"user\";"
```

---

## 8. Dívidas técnicas e pontos de atenção

**Nova (entra no levantamento):**

| # | Item | O que falta | Impacto |
|---|---|---|---|
| E35 | **Não há tela para a pessoa autorizar o nome no resultado público** | `User.isPublicProfile` existe, o domínio o respeita (nome completo × mascarado) e o padrão passou a ser NÃO publicar (ADR-139). Falta o caminho de interface para quem QUER se identificar | Quem gostaria de aparecer com o nome completo no resultado do sorteio não tem como pedir — depende de SQL |

**Pontos de atenção para quem for mexer:**

1. **Desfazer entrega não apaga a posição.** Quem for reconciliar dados precisa lembrar
   que a posição continua sendo a ganhadora, e que a trilha do `rafflePrize` tem DUAS
   linhas por reversão (a entrega e a reversão) — elas se distinguem pelo nome do campo.
2. **A chave do cofre não pode sumir do ambiente enquanto houver selo dela.** Se a chave
   da versão gravada não estiver disponível, a apuração cai para o gerador do sistema e o
   sorteio perde a prova — a tela avisa, mas o aviso só serve antes do palco.
3. **A versão 0 é intocável.** A fórmula legada
   (`sha256('eventflow:raffle-seed:' + BETTER_AUTH_SECRET)`) abre todo sorteio criado antes
   desta fase; mudá-la invalidaria o histórico inteiro de compromissos.
4. **O filtro do histórico é por `createdAt`**, no fuso da instituição. Filtrar por
   `drawnAt` seria outra consulta (e outra decisão): hoje um rascunho de ontem aparece em
   "criado ontem", que é o que a tela promete.
5. **SSE tem caminho de volta.** Se um proxy derrubar o fluxo, a tela volta ao polling de
   5 s e diz isso (`data-transport="polling"`). Teste que assumir `sse` como único
   transporte vai falhar em ambiente com proxy que bufferiza.
6. **O build da imagem não fala com o registro npm** (armadilha 61). O `tsx` do worker é
   copiado do estágio `deps` e o `node_modules` dele é a árvore de produção completa; um
   `npm install` novo no estágio do worker volta a pendurar o build. A única dependência
   externa que sobrou é a busca das fontes do `next/font` — quando a internet oscila, o
   `next build` falha com "Failed to fetch Inter from Google Fonts", e a resposta é
   **repetir o build**. O `generate` do Prisma também espera ~2 min sem rede: é sondagem,
   não travamento.
7. **A data da imagem não prova qual código o container está rodando** (armadilha 3). Antes
   de culpar o código por um E2E que falha, compare o ID: `docker inspect eventflow-web
   --format '{{.Image}}'` contra o ID de `eventflow/web:local`.

---

## 9. Checklist de aceite

- [x] **G8** — desfazer a entrega de uma posição, com motivo obrigatório
- [x] **G8** — a posição sobrevive; o recibo é limpo; as duas pontas ficam na trilha
- [x] **G8** — registrar a entrega de novo depois da reversão funciona
- [x] **G9** — filtro por situação e por período, no fuso da instituição
- [x] **G9** — total e página calculados sobre o conjunto FILTRADO
- [x] **G9** — o filtro vive no endereço e sobrevive à paginação e ao recarregar
- [x] **G9** — período invertido recusado com mensagem própria
- [x] **G10** — premiar N revisores pela tela, com teto no domínio
- [x] **G10** — a tela antecipa o corte do ranking e o avisa
- [x] **G11** — página pública do resultado de um sorteio, com a prova da semente
- [x] **G11** — nome mascarado por padrão; 404 para não publicado/não apurado/cancelado
- [x] **G12** — chaveiro versionado por `RAFFLE_SEED_KEYS`, com a versão gravada no sorteio
- [x] **G12** — girar a chave não invalida semente selada com versão anterior
- [x] **G12** — a tela mostra a situação do chaveiro (incluindo erros de formatação)
- [x] **G13** — prévia ao vivo por SSE na rota existente, com JSON preservado
- [x] **G13** — polling como caminho de volta, declarado na tela (`data-transport`)
- [x] Correção de privacidade: consentimento de perfil público nasce desligado (ADR-139)
- [x] Imagens `web` e `worker` reconstruídas e **containers recriados**, com a prova pelo
      ID da imagem e pela presença do marcador do código novo dentro do container
- [x] Testes: 27 unitários, 13 de integração, 5 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 6
- [x] `README.md`, `AGENTS.md` e `docs/dividas-tecnicas.md` atualizados

---

Aguardando **"APROVADO: AVANÇAR"**.
