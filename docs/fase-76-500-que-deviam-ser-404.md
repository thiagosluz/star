# FASE 76 — O mutirão dos 500 que deviam ser 404

> **Estado: ENTREGUE.** Quatro fatias: o helper e as páginas, a query que não é
> endereço, o envelope único da API e as duas catracas. ADR-366 … 368.

---

## 1. Sumário Executivo

Um **id malformado na URL** chegava ao Prisma e o Postgres respondia
`invalid input syntax for type uuid` (armadilha 25). O `notFound()` que já existia
em cada página ficava **depois** da consulta que estourava — nunca era alcançado.
A fase mediu o universo, consertou as portas, unificou o envelope de erro da API e
construiu as duas catracas que impedem a volta. O número que abre o documento é o
número que fechou o diagnóstico: **25 das 42 URLs medidas davam 500**, e o controle
com uuid **válido e inexistente** dava 404 nas oito testadas.

### O que foi entregue

| Fatia | Entrega | Números medidos |
|---|---|---|
| **1** | O helper em duas partes: `isUuid` puro no domínio + `requireUuidParam` (que chama `notFound()`) na aplicação; as **três cópias** da regex mortas | **23 páginas / 24 params** validados; **3** módulos com a regex removida; as três políticas preservadas |
| **2** | A query não é endereço: **filtro malformado é ignorado e ANUNCIADO**; as três telas de query; o envelope único `/api/t/**` | **3 telas** com aviso (`certificados`, `modelos`, `pagina/midia`); **51 chamadas** de `tenantApiError` em **9 rotas** (48 em 8 na fatia 2 + 3 na fatia 3); o QR mudou de contrato |
| **3** | A **catraca de fonte** e a **tabela de comportamento** — e os dois buracos que a catraca achou | **23 páginas / 24 params + 9 rotas / 11 params**, igualdade exata; **35 casos / 36 testes** de E2E; **2 buracos** fechados (`zip?evento=`, `raffle-live?activityId=`) |
| **4** | A página de erro não perdeu cobertura quando o 500 virou 404: **fixture preso ao componente** | **1 fixture** + igualdade exata no unit; jsdom mede a estrutura, o Chromium mede o contraste |

### Números da fase (medidos nesta árvore)

```text
Arquivos de produção tocados ..... 41 (4 novos + 23 páginas de id no caminho +
                                    2 telas de query + 9 rotas + 3 módulos com a regex)
Telas com id no caminho .......... 23 páginas, 24 params (demandas valida dois)
Rotas de API com id .............. 9 rotas, 11 params (5 de caminho + 6 de query)
Telas de query ................... 3 (certificados, modelos e o acervo de mídia)
Casos novos (Vitest) ............. 100 em 8 arquivos
Suíte Vitest ..................... 235 arquivos · 4257 testes · 0 vermelhos
Casos novos (E2E) ................ 36 em 1 spec (35 da tabela + a contagem)
Suíte E2E ........................ 453 no total: 450 passando + 2 pré-existentes + 1 skip
                                    (eram 417 na F75; o `f62` é o vermelho pré-existente)
ADRs ............................. 366, 367 e 368 (a próxima é a 369)
Migrações ........................ nenhuma
```

### 1.1 Arquivos da fase

**Produção — o helper e a query (fatias 1 e 2)**

```text
src/domain/validation/id-rules.ts ............... 48 linhas (novo) — a forma do uuid
src/domain/validation/query-filter-rules.ts .... 97 linhas (novo) — filtro não é endereço
src/lib/validation/id.ts ........................ 60 linhas (novo) — a política (404)
src/lib/api/tenant-api-error.ts ................. 84 linhas (novo) — o envelope
src/domain/events/media-filter-rules.ts ......... a cópia da regex saiu; o filtro descarta
src/domain/communication/segments.ts ............ a cópia saiu; o parâmetro recusa
src/lib/communication/segment-form.ts ........... a cópia saiu; o formulário valida
```

**Produção — as páginas e as rotas**

```text
src/app/**/page.tsx ............................. 23 páginas com `requireUuidParam` (24 params)
src/app/**/certificados/page.tsx ................ `?evento=` descartado e anunciado
src/app/**/certificados/modelos/page.tsx ........ `?modelo=` descartado e anunciado
src/app/**/pagina/midia/page.tsx ................ `?evento=` deixa de alargar em silêncio
src/app/api/**/route.ts .......................... 9 rotas com `isUuid` + `tenantApiError`
```

**Testes**

```text
tests/unit/f76-id-validation.test.ts ............ 16 casos (a regra e as três políticas)
tests/unit/f76-envelope-de-erro.test.ts ......... 14 casos (um envelope, todos os status)
tests/unit/f76-query-ignorada.test.ts ........... 10 casos (a decisão pura)
tests/unit/f76-catalogo-de-ids.test.ts .......... 15 casos (a catraca de fonte)
tests/unit/f76-pagina-de-erro-axe.test.ts ....... 6 casos (fixture + axe em jsdom)
tests/integration/f76-paginas-com-id.test.ts .... 11 casos (4 páginas, uuid torto × válido)
tests/integration/f76-rotas-de-api.test.ts ...... 21 casos (9 rotas, formato × existência)
tests/integration/f76-query-ignorada.test.ts .... 7 casos (3 telas renderizadas)
tests/e2e/f76-id-malformado.spec.ts ............. 36 casos (35 da tabela + a contagem)
tests/e2e/fixtures/f76-area-error-app.html ...... o HTML do componente, preso por igualdade
```

---

## 2. O Problema Mais Difícil da Fase

**Como separar "formato inválido" de "recurso inexistente" quando as duas coisas
chegam pelo mesmo lugar — e provar que a separação vale em toda a árvore.**

O sintoma enganava. Um `where: { id }` com texto torto **não** devolve "nenhum
resultado": o Prisma tenta converter o parâmetro para o tipo `uuid` da coluna, o
Postgres recusa o texto e o driver embrulha a recusa em `P2023`. O caminho de
leitura não tem `catch`, então a exceção sobe e a resposta é **500**. O
`if (!x) notFound()` que existia em cada página era, portanto, **código morto no
caso do formato**: ele fica depois da consulta, e a consulta é justamente quem
estoura. O defeito não era "faltou um `notFound()`"; era **a ordem** — e a ordem
só se conserta antes de consultar.

A medição fechou o diagnóstico com um controle que qualquer um pode repetir:

| Grupo | O que foi medido |
|---|---|
| **42 URLs com `nao-e-uuid`** | **25 × 500**, 8 × 404, **5 × 200 com painel de erro**, 3 × 400 e 1 × 403 — só **13 das 42** respondiam o que deviam |
| **Controle: uuid bem formado e inexistente** | **404** nas 8 URLs testadas |
| **Conclusão** | O 500 era **exclusivo do FORMATO**. Recurso ausente já era 404; formato inválido não era tratado como pergunta de endereço |

**Por que isso define o desenho.** Se o 500 fosse "recurso não encontrado", o
conserto seria um `catch` — e o `catch` esconderia falha real de banco como 404. A
fase recusou o `catch` como resposta geral e escolheu o caminho oposto: **o formato
é uma pergunta que se responde sem tocar o banco**. A regra ("tem forma de uuid?")
é pura e mora no domínio; a política ("formato inválido na URL = 404") depende do
framework e mora na aplicação. A existência continua sendo respondida pela consulta,
no lugar dela. São duas perguntas, com dois donos, e cada uma responde a sua.

A segunda dificuldade foi o **alcance**. Consertar 23 páginas à mão é fácil; a
próxima página que alguém criar é o problema. Por isso a fase tem duas catracas: a
de **fonte** (o inventário) e a de **comportamento** (a resposta). A primeira acha o
que ninguém lembrou de listar; a segunda impede que a lista e o código concordem
sobre uma resposta errada.

---

## 3. Decisões Técnicas Explicadas

### 3.1 O helper em duas partes — e as três cópias da regex

A mesma pergunta era feita em **três módulos**, cada um com a própria cópia da
regex: o filtro do acervo de mídia (`media-filter-rules.ts`), a validação dos
parâmetros de segmento (`segments.ts`) e o formulário de segmento
(`segment-form.ts`). Três cópias de uma regex de formato são três chances de
divergir — e a divergência aqui não é cosmética: é a diferença entre uma consulta
que o banco aceita e uma que ele recusa.

A separação é a decisão central:

```text
src/domain/validation/id-rules.ts   isUuid(value)        — a REGRA, pura, sem Next
src/lib/validation/id.ts            requireUuidParam(...) — a POLÍTICA, chama notFound()
```

`requireUuidParam` cobre os quatro casos do caminho: **ausente** (`undefined`),
**vazio** (`''`), **repetido** (`string[]`) e **texto torto**. O array é recusado
mesmo que o primeiro item seja um uuid: a URL com o segmento repetido não tem UM
id, tem vários, e escolher o primeiro em silêncio seria inventar qual recurso a
pessoa pediu.

**As três cópias morreram, mas as três políticas ficaram** — cada chamador decide o
que fazer com a resposta, e é isso que o helper não pode decidir por ele:

| Chamador | Política preservada |
|---|---|
| Filtro do acervo | faz `trim` e **descarta** o malformado (filtro não é endereço) |
| Parâmetro de segmento | faz `trim`, **baixa a caixa** e **recusa** (com o código da casa) |
| Formulário de segmento | aceita **ausente** e recusa torto **sem** `trim` |

O `isUuid` **não faz `trim` de propósito**: `" <uuid> "` não é um endereço. Quem
recebe texto digitado decide se limpa antes — e cada chamador já decidia, cada um
com a própria política. O domínio é o lugar certo porque a pergunta é sobre
**formato**, não sobre HTTP: a mesma função serve à página (404), ao formulário
(recusa) e ao filtro (ignora).

### 3.2 Filtro não é endereço — a query ignorada e ANUNCIADA

Um id no **caminho** identifica o recurso pedido: formato inválido ali é 404,
decidido antes de consultar. Um id na **query** é outra coisa: é **filtro** — a
lista existe com ou sem ele. Tratar os dois igual produzia o pior dos três mundos:

- `?evento=nao-e-uuid` em certificados e modelos descia ao Prisma e a tela
  respondia **500**;
- `?evento=nao-e-uuid` no acervo de mídia era descartado em **silêncio**: a lista
  aparecia inteira e ninguém dizia que o filtro pedido não foi aplicado — o
  **alargamento silencioso**, o mesmo defeito sem 500;
- responder 404 seria mentir sobre a lista, que existe.

A regra da casa resolve os dois: **filtro malformado é filtro ignorado, e o que a
tela esconde, ela anuncia**. A decisão vive no domínio
(`resolveUuidQueryFilter`), com a frase única (`discardedFilterNotice`), e devolve
três estados: `applied`, `discarded` e `null` (ausência — não há o que anunciar).

Três detalhes que o teste fixou:

- **`trim` aqui, e não no caminho.** `?evento=" <uuid> "` vem de URL copiada à mão;
  limpar evita 500 por um espaço invisível. A política é deste chamador; a regra de
  formato continua uma só.
- **Parâmetro repetido (`?evento=a&evento=b`) é descarte**, não "o primeiro": não
  existe UM filtro pedido, existem dois.
- **`extraValues` para os sentinelas legítimos.** O acervo tem `sem-evento`, que não
  é uuid e é uma escolha de verdade. Sem ele, o aviso mentiria sobre a própria tela.

E o valor descartado **não vaza para o próximo gesto**: em certificados, sem evento
válido escolhido, o botão do lote em ZIP não aparece e a tela mostra a instrução —
senão o filtro descartado continuaria virando uma URL de download inválida.

### 3.3 Um envelope, e o corpo vazio é o pior contrato

Antes da fase, a API da instituição errava de **quatro** formas diferentes: **500
sem corpo nem `content-type`** (cinco rotas), **403 com `{code:"INTERNAL"}`**,
**200 com `{ok:false}` no corpo** e um 404 com envelope próprio — além do `{error}`
exclusivo do QR. Quem consome a API não tinha como distinguir "erro do servidor" de
"arquivo vazio", e o mesmo defeito aparecia com quatro contratos.

O envelope `{ ok: false, code, message }` já era a resposta certa em 35 sítios
escritos **à mão** em 9 arquivos (e é o que a rota `ao-vivo` do palco usa). Ele
virou **uma** função (`tenantApiError`), com `cache-control: no-store` no erro:
resposta de erro carrega mensagem sobre o **recurso** e a **autorização** de quem
pediu; guardá-la em cache intermediário manteria a recusa de uma pessoa servível a
outra.

O `code` é a chave **estável** que o cliente testa; a `message` é a frase em
português que a tela pode mostrar. A união de status é fechada de propósito — um
status fora dela é erro de digitação, não uma decisão nova de contrato.

**A régua 400 × 404** nasceu de um caso experimental da tabela (ver §3.5):

| Pergunta | Resposta | Exemplo |
|---|---|---|
| O id é **entrada obrigatória da operação**? | **400 `INVALID_INPUT`** | `credenciamento/crachas/folha?eventId=` (sem ele não há folha); `certificados/zip?evento=` (o lote é por evento); `raffle-live?activityId=` no escopo de atividade |
| O id é o **endereço do recurso**? | **404** | `agenda/ics?atividade=` (o arquivo pedido é aquela atividade); `agenda/ics?evento=`; `midia/[assetId]/miniatura`; `exportacoes/[exportId]/arquivo` |

O formato não muda a natureza do pedido: o mesmo texto torto é 400 onde é entrada e
404 onde é endereço. **O QR do patrocinador mudou de contrato** (`{error}` →
`{ok:false,code,message}`), e isso está declarado para quem consome.

### 3.4 A catraca de FONTE — e os dois buracos que ela achou

A catraca lê a árvore, extrai os segmentos `[<x>Id]` e o que cada arquivo chama,
e compara com a lista positiva: **23 páginas / 24 params** e **9 rotas / 11 params**,
por **igualdade exata**. Página ou rota nova **reprova**; item da lista que perdeu a
chamada também. A lista é o contrato: mudá-la é um ato deliberado, com o motivo
escrito.

As exceções são **declaradas**, não esquecidas:

- `blockId` (JSON do editor), o `id` do lead, `lattesId`/`orcidId`/`taxId`
  (identificadores externos) e `presetId` (nome do modelo) **não** são uuid de
  endereço;
- `[eventSlug]`, `[activitySlug]`, `[callSlug]`, `[cardSlug]`, `[token]`, `[code]`,
  `[username]` e `[tenantSlug]` são endereço, mas não são id de chave primária;
- as **quatro páginas públicas** que já respondem 404 por `catch` do serviço
  (`[speakerId]` e `[raffleId]` ×3) continuam fora, com o catch-all declarado como
  ponto de atenção;
- a rota `sorteios/[raffleId]/ao-vivo` fica fora com motivo (o serviço engole o erro
  e responde 404; a fatia 2 declarou "já responde certo, não tocar").

**A lição que a fase não esperava:** a catraca não só impediu a volta — ela **achou
buraco**. Dois params que a lista da fatia 2 não viu:

1. `certificados/zip?evento=` — o texto torto descia ao Prisma, o serviço engolia o
   `P2023` e a resposta era **400 `INTERNAL`**, um erro de banco disfarçado de
   pedido inválido;
2. `raffle-live?activityId=` — **500 `INTERNAL`** no escopo de atividade.

Os dois foram fechados e movidos para a lista **positiva**. A catraca de fonte não
serve só para prender o que já foi corrigido; ela é também uma varredura que
encontra o que a lista anterior não viu.

### 3.5 A tabela de comportamento — e a prova de que não é tautológica

A tabela é uma `for` de `test()` sobre **35 casos**: **24 de página** (23 páginas;
`demandas/[demandId]` tem dois ids, e cada um ganha o seu caso) e **11 de API**
(9 rotas; a agenda tem dois params e a prévia do sorteio tem o `eventId` do caminho
e o `?activityId=`). Cada caso mede o **resultado**, não a chamada:

- página: o status decidido, o `data-testid` da área de não encontrado, a frase, e
  a ausência da página padrão do framework em inglês;
- API: status, `content-type: application/json`, `cache-control: no-store`,
  `ok:false`, o `code` esperado e uma `message` não vazia.

**O caso experimental esperava 404 e recebeu 400 — e ficou vermelho.** Era o lote
de certificados (`zip?evento=`): o evento é **entrada obrigatória** da operação, e
o formato inválido é `INVALID_INPUT`; a expectativa de 404 é que estava errada. Só
depois de a régua ser escrita (§3.3) o caso entrou na tabela, com 400. É a prova de
que a tabela **não é tautológica**: ela reprovou uma expectativa de quem a escreveu.
**Uma tabela de comportamento que nunca reprovou é uma tabela que nunca testou
nada.**

A contagem também é contrato: o primeiro teste do spec afirma `35`, `24` e `11`. Se
alguém acrescentar um caso, o número obriga a atualizar o comentário e a saber o que
se está medindo.

### 3.6 A fixture presa ao componente — quando o 500 que dava acesso à tela some

A F75 media a página de erro (`area-error-app`) por uma rota que **estourava de
verdade**: o id malformado descia ao Prisma e virava 500. A fatia 1 fechou esse
caminho — agora o malformado é 404 —, e o caso do E2E perdia a página de erro. A
cobertura não podia cair em silêncio.

Não existe rota feita para falhar, e inventar uma seria medir o teste. O caminho
honesto é renderizar o **componente** com `renderToStaticMarkup` e rodar o `axe`
sobre o HTML que ele produz. Mas o Playwright **não renderiza o `.tsx` do app no
próprio processo**: o transform de JSX dele devolve um objeto
`{__pw_type, type, props, key}`, não um elemento do React — medido. Daí a divisão:

```text
tests/unit/f76-pagina-de-erro-axe.test.ts   renderiza o componente; prova que o HTML é o dele
tests/e2e/fixtures/f76-area-error-app.html  o HTML medido no Chromium, preso por IGUALDADE EXATA
tests/e2e/accessibility.spec.ts             mede o fixture com o CSS da casa (color-contrast)
```

O `axe` em jsdom mede estrutura, rótulos, landmarks e ordem de títulos; ele **não**
mede `color-contrast`, porque o jsdom não faz layout. A regra é desligada **de
propósito** no unit e medida no E2E, no Chromium, sobre o **mesmo** HTML. Quem
quiser o caminho completo lê os dois arquivos juntos. Se o componente mudar (uma
classe, uma frase, um link) e o fixture não, a igualdade reprova no unit antes de o
E2E medir um retrato velho.

### 3.7 As quatro páginas que mudam de observável — declarado

Quatro telas respondiam **200 com painel de erro** quando o id era malformado: elas
engoliam a falha do banco e mostravam uma tela vazia como se o recurso não tivesse
dado. Com a validação, passam a responder **404** com a página de não encontrado da
área:

```text
/t/<slug>/administracao/eventos/<id>/api        (a prévia da API)
/t/<slug>/administracao/eventos/<id>/reconhecimento
/t/<slug>/comite/<submissionId>
/t/<slug>/participantes/<userId>
```

É mudança de comportamento **observável** e está declarada: 200 + painel → 404. Não
é regressão; é a resposta certa no lugar de uma tela que mentia.

### 3.8 O que ficou de fora, de propósito

- **As quatro páginas de catch-all** (`[speakerId]` e `[raffleId]` ×3) respondem 404
  **pelo motivo errado**: o `catch` do serviço transforma qualquer falha em "não
  encontrado", inclusive uma falha real de banco. A fase não as tocou — está
  declarado como ponto de atenção (§8), não consertado aqui.
- **`ao-vivo`** responde 404 pelo `catch` e **não usa o envelope**. Ficou fora da
  lista positiva com o motivo escrito; se alguém a fechar, a catraca manda movê-la.
- **A heurística da query**: a catraca reconhece chaves terminadas em `Id` e as duas
  da agenda (`atividade`, `evento`). Uma chave nova sem sufixo `Id` não é adivinhada
  — é o limite declarado da descoberta.
- **O alias do valor validado**: a catraca prova que a chamada existe, com o **nome**
  do segmento, não que o valor validado é o valor usado. `const id =
  requireUuidParam(...)` seguido de `where: { id: outroTexto }` passa na catraca e
  estoura no banco. Quem fecha essa distância é o comportamento.
- **O fallback silencioso de `?evento=`** em cinco telas — declarado como **E89**
  (§8).

---

## 4. Registro de Decisões de Arquitetura (ADRs)

### ADR-366 — O formato do id é pergunta de ENDEREÇO: a regra pura no domínio, a política na aplicação e o 404 antes da consulta

**Contexto.** `where: { id }` com texto que não é uuid não devolve "nenhum
resultado": o Prisma tenta converter o parâmetro, o Postgres recusa
(`invalid input syntax for type uuid`) e o driver embrulha em `P2023`. Sem `catch`
no caminho de leitura, a resposta é 500. O `if (!x) notFound()` já existia em cada
página, mas **depois** da consulta — nunca era alcançado no caso do formato. A
medição mostrou 25 de 42 URLs com 500, e o controle com uuid válido e inexistente
dando 404: o defeito era **exclusivo do formato**.

**Decisão.** Duas peças, com donos diferentes:

- `isUuid(value)` em `src/domain/validation/id-rules.ts` — a **regra** pura (a regex
  canônica 8-4-4-4-12, sem `trim`, sem validar existência nem versão);
- `requireUuidParam(params, chave)` em `src/lib/validation/id.ts` — a **política**
  ("formato inválido na URL = 404"), que chama `notFound()` e devolve o valor quando
  ele é uuid.

As **três cópias** da regex foram mortas e as três políticas preservadas: o filtro
do acervo **descarta**, o parâmetro de segmento **recusa**, o formulário **valida**.

**Justificativa.**

- O formato é uma pergunta que se responde **sem tocar o banco**. colocá-la antes da
  consulta é o que impede o `P2023` de virar 500 — e o `catch` como resposta geral
  esconderia falha real de banco como 404.
- A regra é pura e testável sem infraestrutura; a política depende do framework
  (`notFound()`), e o domínio não importa `next/navigation`.
- Uma regex, uma forma: três cópias de formato são três chances de divergir; e a
  divergência aqui é a diferença entre uma consulta que o banco aceita e uma que ele
  recusa.
- A existência continua sendo respondida pela consulta, no lugar dela: uuid bem
  formado e inexistente segue 404, como antes. **São duas perguntas, não uma.**

**Consequências.**

- ✔ 23 páginas / 24 params validados; o 500 do formato deixou de existir nas rotas
  cobertas.
- ✔ O array repetido é recusado mesmo que o primeiro item seja uuid: a URL não tem
  UM id, tem vários.
- ✔ As três políticas de chamador continuam explícitas e testadas (16 casos).
- ⚠ A catraca de fonte prova que a chamada existe com o **nome** do segmento, não
  que o valor validado é o usado. O limite está declarado (ADR-368).
- ⚠ As quatro páginas de catch-all seguem dando 404 pelo motivo errado (§8).

### ADR-367 — Um envelope para a API da instituição, e a régua 400 × 404

**Contexto.** A API da instituição errava de quatro formas: **500 sem corpo nem
`content-type`** (cinco rotas), **403 com `{code:"INTERNAL"}`**, **200 com
`{ok:false}` no corpo** e um 404 com envelope próprio — além do `{error}` exclusivo
do QR. Quem consome não tinha como distinguir "erro do servidor" de "arquivo vazio",
e o mesmo defeito aparecia com quatro contratos.

**Decisão.** Uma função, `tenantApiError(status, code, message, headers?)`, com o
corpo `{ ok: false, code, message }` e `cache-control: no-store` no erro. As 9 rotas
com id usam `isUuid` **antes** de qualquer consulta e respondem por ela. E a régua de
status:

- **400 `INVALID_INPUT`** quando o id é **entrada obrigatória da operação**
  (`folha?eventId=`, `impressao?eventId=`, `zip?evento=`, `raffle-live?activityId=`);
- **404** quando o id é o **endereço do recurso** (`agenda/ics?atividade=`,
  `agenda/ics?evento=`, `miniatura`, `exportacoes`, `material`, `qr`).

**Justificativa.**

- O envelope já era a resposta certa em 35 sítios escritos à mão em 9 arquivos; a
  função o torna **um** contrato, e a próxima rota não inventa um quarto formato.
- **Corpo vazio é o pior contrato**: não há o que o cliente teste, nem o que a tela
  mostre. `code` é a chave estável; `message`, a frase em português.
- O `no-store` é parte do erro: a mensagem diz sobre o **recurso** e a
  **autorização** de quem pediu; cachear a recusa a serviria a outra pessoa.
- A régua 400 × 404 **não é cosmética**: o mesmo texto torto é entrada inválida numa
  operação e endereço ausente num recurso. Misturar os dois faz o cliente tratar
  "pedido errado" como "não existe" — e o teste do lote de certificados forçou a
  distinção (§3.5).

**Consequências.**

- ✔ 51 chamadas de `tenantApiError` em 9 rotas (48 em 8 na fatia 2 + 3 na fatia 3:
  duas no ZIP e uma no `activityId` da prévia).
- ✔ O QR mudou de `{error}` para o envelope — **mudança de contrato declarada**.
- ✔ O `zip?evento=` deixou de responder 400 `INTERNAL` (erro de banco disfarçado) e
  passou a 400 `INVALID_INPUT`, antes de consultar.
- ⚠ `ao-vivo` segue fora do envelope, com o motivo escrito; quem a fechar move a
  linha para a lista positiva.
- ⚠ A API responde 400/404 com o envelope, mas o **sucesso** de cada rota mantém o
  contrato que já tinha (arquivo binário, JSON de prévia) — a fase não unificou
  sucesso.

### ADR-368 — Duas catracas e um limite declarado: o inventário de fonte e a tabela de comportamento

**Contexto.** Consertar 23 páginas e 9 rotas à mão resolve o presente e não o
futuro: a próxima página com `[eventId]` esquece a validação e o 500 volta pela
porta dos fundos. E uma lista que só compara nomes pode concordar com um código que
valida o param errado. A fase precisava de duas provas diferentes: a de que **toda
porta** chama a validação, e a de que **a resposta** é a decidida.

**Decisão.** Duas catracas, com papéis distintos:

1. **Fonte** (`tests/unit/f76-catalogo-de-ids.test.ts`): lê a árvore, extrai os
   segmentos `[<x>Id]` e o que cada arquivo chama, e compara com a lista positiva
   por **igualdade exata** — **23 páginas / 24 params** e **9 rotas / 11 params**.
   Página nova reprova; item que perdeu a chamada reprova. As exceções
   (`blockId`, lead `id`, `lattesId`/`orcidId`/`taxId`, `presetId`, slugs, `[token]`,
   `[code]`, `[username]`, as 4 de catch-all e `ao-vivo`) estão **declaradas com o
   motivo**.
2. **Comportamento** (`tests/e2e/f76-id-malformado.spec.ts`): uma tabela de **35
   casos** (24 de página + 11 de API) que mede o **status** e o **envelope** de cada
   endereço com `nao-e-uuid`. A contagem é contrato (o primeiro teste afirma 35, 24 e
   11).

**Justificativa.**

- A catraca de fonte é a única que **acha o que ninguém listou**: foi ela que
  encontrou `zip?evento=` e `raffle-live?activityId=`, dois params fora da lista da
  fatia 2. Uma catraca que só impede a volta já se paga; uma que acha buraco se paga
  duas vezes.
- A tabela de comportamento é a única que prova a **resposta**: status, página de
  erro, `content-type`, `no-store`, `code` e `message`. A catraca de fonte poderia
  passar com o valor trocado; o E2E não.
- A tabela **não é tautológica** porque o caso experimental do ZIP esperava 404,
  recebeu 400 e ficou **vermelho** — e só entrou na tabela depois de a régua 400 ×
  404 ser escrita. Uma tabela que nunca reprovou nunca testou nada.

**Consequências.**

- ✔ A árvore tem exatamente as páginas e rotas da lista; as exceções são visíveis.
- ✔ Os dois buracos fechados estão presos como positivos, para a lição não se perder.
- ✔ O caso do F75 que media o 500 foi **reapontado** para 404, sem `test.skip` e sem
  espera condicional; a cobertura da página de erro foi para o render + fixture
  (ADR-365 e §3.6).
- ⚠ **Limite 1 — o alias do valor.** A catraca prova que a chamada existe, com o
  nome do segmento; não prova que o valor validado é o usado.
- ⚠ **Limite 2 — a descoberta de query é heurística.** Só chaves `*Id` e
  `atividade`/`evento` são reconhecidas. Uma chave nova sem sufixo `Id` entra por
  decisão humana, não por acidente.
- ⚠ A tabela depende de sessões reais (admin, staff, superadmin, anônimo) e da
  fixture do E2E; ela mede o container, não o componente isolado.

---

## 5. Lições Aprendidas

### 5.1 As lições, com a evidência de cada uma

| Lição | A evidência |
|---|---|
| **O 500 era exclusivo do FORMATO** | 25 das 42 URLs com `nao-e-uuid` davam 500; o controle com uuid **válido e inexistente** dava 404 nas 8 testadas. O formato era a variável, e o controle isolou |
| **O `if (!x) notFound()` existente nunca era alcançado** | Ele vinha **depois** da consulta que estourava. A correção não foi acrescentar `notFound()`: foi movê-lo para **antes** de consultar |
| **A catraca de FONTE achou buraco** | Dois params fora da lista da fatia 2: `certificados/zip?evento=` (400 `INTERNAL`) e `raffle-live?activityId=` (500 `INTERNAL`), fechados e movidos para a lista positiva |
| **A tabela não é tautológica** | O caso experimental do ZIP esperava 404, recebeu **400** e ficou vermelho; só depois da régua 400 × 404 entrou na tabela. Uma tabela que nunca reprovou nunca testou nada |
| **Filtro não é endereço** | Query malformada é **ignorada e anunciada**, nunca 404. E o alargamento silencioso (`pagina/midia?evento`) era o mesmo defeito sem 500 — a lista era a mesma e nada dizia que o recorte caiu |
| **A régua 400 × 404** | Entrada obrigatória da operação → 400 (`crachás ?eventId=`, `zip ?evento=`, `raffle-live ?activityId=`); endereço do recurso → 404 (`agenda/ics ?atividade=`, `?evento=`) |
| **Um envelope, e o corpo vazio é o pior contrato** | Cinco rotas respondiam 500 **sem `content-type` nem corpo**; o mesmo defeito aparecia como 403 `INTERNAL`, 200 `{ok:false}` e 404 com envelope próprio. Agora 51 chamadas em 9 rotas usam `{ok:false,code,message}` |
| **O limite da catraca é declarado** | Ela prova a chamada com o nome do segmento, não o valor usado; a descoberta de query é heurística; e o alias (`const id = validado; where: { id: outro }`) passa na fonte e só o comportamento pega |
| **A fixture presa ao componente** | O Playwright não renderiza o `.tsx` do app; a cobertura da página de erro veio por `renderToStaticMarkup` + fixture com **igualdade exata** no unit, e o `axe` mede o HTML no Chromium |

### 5.2 Defeitos REAIS encontrados pelos testes

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `certificados/zip?evento=nao-e-uuid` respondia **400 `INTERNAL`** | A rota ficou fora das 8 da fatia 2; o texto descia ao Prisma, o serviço engolia o `P2023` e o erro de banco virava "pedido inválido" | `isUuid` antes de consultar + 400 `INVALID_INPUT` com o envelope; o caso entrou na tabela |
| `raffle-live?activityId=nao-e-uuid` respondia **500 `INTERNAL`** no escopo de atividade | O `activityId` era lido depois da guarda do `eventId` e ia direto à consulta | A mesma guarda, antes de consultar; 400 porque é entrada obrigatória |
| `pagina/midia?evento=nao-e-uuid` mostrava o acervo inteiro **sem avisar** | O filtro caía no `null` de "sem filtro" e alargava a consulta em silêncio | `resolveUuidQueryFilter` + aviso do domínio; o valor descartado não vira URL de download |
| O caso de erro do E2E (F75) ia medir uma tela que não existia mais | A F76 converteu o 500 em 404: o caminho que dava acesso ao boundary sumiu | Caso reapontado para 404 **sem skip**; a cobertura da página de erro foi para o render + fixture |
| O `axe` do E2E não conseguia renderizar o `.tsx` | O runtime de JSX do Playwright devolve `{__pw_type, type, props, key}`, não um elemento React | Fixture gerado por `renderToStaticMarkup` e preso ao componente por igualdade exata |
| Quatro telas respondiam **200 com painel de erro** | A leitura engolia a falha do banco e a tela dizia "sem parecer"/"não encontrado" | 404 decidido antes da consulta; a mudança observável está declarada (§3.7) |

### 5.3 O que NÃO foi medido

- **O tempo de resposta do 404 vs. 500.** A fase mede o status e o corpo, não a
  latência; a validação remove uma ida ao banco, mas o ganho não foi cronometrado.
- **A página de erro sob carga real.** O caminho foi exercitado pelo render e pelo
  portão, não sob concorrência.
- **O fallback silencioso das cinco telas de `?evento=`.** Ele foi **lido** no
  código (o `events[0]?.id` e o `null` de "todos"), não medido por teste nesta fase —
  é a E89, declarada para a próxima.
- **As quatro páginas de catch-all.** A fase não mediu se o `catch` do serviço
  esconde falha real; a leitura do código diz que sim, e o ponto está na §8.

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
 Test Files  235 passed (235)
      Tests  4257 passed (4257)
   Duration  188.54s
```

Os arquivos da fase, com a contagem por arquivo:

```text
 ✓ tests/unit/f76-id-validation.test.ts (16 tests)
 ✓ tests/unit/f76-catalogo-de-ids.test.ts (15 tests)
 ✓ tests/unit/f76-envelope-de-erro.test.ts (14 tests)
 ✓ tests/unit/f76-query-ignorada.test.ts (10 tests)
 ✓ tests/unit/f76-pagina-de-erro-axe.test.ts (6 tests)
 ✓ tests/integration/f76-rotas-de-api.test.ts (21 tests)
 ✓ tests/integration/f76-paginas-com-id.test.ts (11 tests)
 ✓ tests/integration/f76-query-ignorada.test.ts (7 tests)
```

**100 casos novos** (16 + 15 + 14 + 10 + 6 + 21 + 11 + 7), em **8 arquivos**;
a suíte passou de **227 para 235** arquivos e de **4157 para 4257** testes.

### 6.4 `npm run build`

```text
✓ Compiled successfully in 9.9s
Route (app) … ƒ /_not-found …
```

As rotas da fase continuam listadas (`/administracao/eventos/[eventId]`, as quatro
de non-found, etc.). Todas as rotas do projeto são dinâmicas — o layout raiz lê o
cookie de tema, e a fase não mudou isso.

### 6.5 `npm run db:verify`

```text
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
  · todas as partições do intervalo já existiam

  audit_logs_2026_09   43872 linhas   25.04 MB
  audit_logs_2026_10   61816 linhas   34.20 MB
  audit_logs_2026_11       0 linhas    0.04 MB
  audit_logs_2026_12       0 linhas    0.04 MB
  total: 105688 linha(s)
```

A fase não tem migração: as tabelas e as policies são as mesmas de antes. A rotina
**cria e mantém**, nunca apaga (dívida B8).

### 6.8 O container — a imagem é a nova

```text
 Image eventflow/web:local Built
 Image eventflow/worker:local Built
 Container eventflow-web Running
 Container eventflow-worker Recreated
```

Data das imagens, conferida **depois** do build:

```text
eventflow/web:local ....... 2026-10-23T10:38:18Z  (07:38 em America/Sao_Paulo)
eventflow/worker:local .... 2026-10-23T10:49:10Z  (07:49 em America/Sao_Paulo)
```

O build da `web` reaproveitou as camadas porque **nenhuma linha de produção mudou
nesta sessão** — o conteúdo da imagem é o mesmo que já continha o conserto das
fatias 1–3, construído às 07:38. O `worker` foi recriado às 07:49. O build **não**
falhou e o container está `healthy`.

### 6.9 E2E — a suíte inteira

```text
Running 453 tests using 1 worker

  2 failed
    [chromium] › tests\e2e\f62-regressao-visual.spec.ts:1969:3 › rodapé público da plataforma › 13. o rodapé público da raiz no claro
    [chromium] › tests\e2e\f62-regressao-visual.spec.ts:1982:3 › rodapé público da plataforma › 14. o rodapé público da raiz no escuro
  1 skipped
  450 passed (11.0m)
```

**453 casos** (`npx playwright test --list` → 453): **450 passando** + os **2 vermelhos
PRÉ-EXISTENTES** do rodapé + **1 skip** (a dívida E76). A fase acrescentou **36** casos
(35 da tabela + a contagem), e o total medido antes dela era **417** (414 + 2 + 1).
**Nenhum outro vermelho**: o `f76-id-malformado.spec.ts` passou inteiro (36/36), o
`f75-paginas-de-erro.spec.ts` reapontado passou, e o `accessibility.spec.ts` — incluindo o
caso da página de erro por fixture — passou nos 37 casos. O `f65` ("Acontecendo agora",
intermitente na virada do minuto) **não** reprovou nesta execução.

### 6.10 O `f62` (regressão visual), medido isolado

Rodado **sozinho**, como a fase exige:

```text
  2 failed
    [chromium] › tests\e2e\f62-regressao-visual.spec.ts:1969:3 › rodapé público da plataforma › 13. o rodapé público da raiz no claro
    [chromium] › tests\e2e\f62-regressao-visual.spec.ts:1982:3 › rodapé público da plataforma › 14. o rodapé público da raiz no escuro
  21 passed (47.3s)
```

Os dois números, **iguais** aos da execução dentro da suíte:

```text
13. rodapé público da raiz no claro
    Expected an image 1440px by 3262px, received 1440px by 3334px.
    233342 pixels (ratio 0.05 of all image pixels) are different.

14. rodapé público da raiz no escuro
    Expected an image 1440px by 3262px, received 1440px by 3334px.
    820309 pixels (ratio 0.18 of all image pixels) are different.
```

**Diagnóstico:** a página mede **lista e métricas dinâmicas** — a altura muda com o
conteúdo do momento (3334 px recebidos contra 3262 px de linha de base) e a diferença de
pixels acompanha. **Não é regressão da F76**: a fase não tocou a raiz pública, nem
`globals.css`, nem `playwright.config.ts`; e os dois vermelhos já estavam registrados na F75
com a mesma ordem de grandeza (233.049 px / 5% no claro e 820.021 px / 18% no escuro — a
diferença de dezenas de pixels entre as duas medições é o próprio conteúdo que muda). As
outras **21** linhas de base passaram sem um pixel de diferença, incluindo as telas que a
fase poderia ter mexido (painel, diretório de participantes, página da instituição).

### 6.11 As catracas, com a mutação

- **Catálogo de ids**: trocar a chamada de `requireUuidParam` da raiz do evento por
  `String(resolvedParams.eventId)` → reprova com a mensagem que ensina a corrigir:
  `chama requireUuidParam com [] e o segmento pede ["eventId"]`. Mutação desfeita.
- **Tabela de comportamento**: trocar o status esperado do ZIP de 400 para 404 →
  reprova com `respondeu 400` / `Expected: 404, Received: 400`. É a mesma prova de
  não-tautologia da §3.5, agora com a mutação controlada. Mutação desfeita.
- **Fixture**: trocar `Erro inesperado` por `Erro inesperado!` no HTML e não no
  componente → a igualdade exata do unit reprova. Mutação desfeita.

### 6.12 As imagens

`docs/imagens/f76-id-malformado.png` — a **mesma URL com id válido (200)** e com id
malformado (404), capturada da tela real, contra o container. O spec temporário de
captura foi **apagado** depois.

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
npx playwright test --output "$TEMP/ef-e2e-f76" --reporter=list

# A fase, por fatia
npx vitest run tests/unit/f76-id-validation.test.ts            # o helper (fatia 1)
npx vitest run tests/unit/f76-query-ignorada.test.ts           # a query (fatia 2)
npx vitest run tests/unit/f76-envelope-de-erro.test.ts         # o envelope (fatia 2)
npx vitest run tests/unit/f76-catalogo-de-ids.test.ts          # a catraca de fonte (fatia 3)
npx vitest run tests/integration/f76-paginas-com-id.test.ts    # 4 páginas (fatia 1)
npx vitest run tests/integration/f76-rotas-de-api.test.ts      # 9 rotas (fatias 2 e 3)
npx vitest run tests/integration/f76-query-ignorada.test.ts    # as 3 telas de query
npx vitest run tests/unit/f76-pagina-de-erro-axe.test.ts       # fixture + axe

# A tabela de comportamento no navegador
npx playwright test tests/e2e/f76-id-malformado.spec.ts
npx playwright test tests/e2e/f75-paginas-de-erro.spec.ts      # reapontado

# O visual, isolado (2 vermelhos pré-existentes)
npx playwright test tests/e2e/f62-regressao-visual.spec.ts
```

**Onde olhar na interface:**

```text
Antes (500) .... /t/<slug>/administracao/eventos/nao-e-uuid            → 404 (painel)
Agora (404) .... /t/<slug>/administracao/eventos/<uuid inexistente>    → 404 (painel)
Query .......... /t/<slug>/administracao/certificados?evento=nao-e-uuid → 200 + aviso
API ............ /api/t/<slug>/midia/nao-e-uuid/miniatura              → 404 + envelope
Entrada ........ /api/t/<slug>/credenciamento/crachas/folha?eventId=nao-e-uuid → 400
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

**A contagem de dívidas muda: 41 → 42.** O fallback silencioso de `?evento=` foi
declarado como **E89** (tema E, jornada do participante), e não como simples ponto
de atenção, por uma razão: ele é um **defeito reprodutível**, não um limite de
desenho. Cinco telas recebem um evento que não existe — ou que a pessoa não pode
ver — e **caem em outro evento sem dizer**; a operação de balcão pode credenciar no
evento errado. Um "ponto de atenção" é para o que a fase decidiu não fazer; a E89 é
o que a fase **achou e não fechou**, e o levantamento é o lugar dele.

```text
E89 — O `?evento=` inválido cai em outro evento, em silêncio
Onde: /t/<slug>/credenciamento, /credenciamento/crachas, /meu-cracha e
      /minha-agenda caem em `events[0]?.id`; /participantes cai em "todos".
Por quê: `evento && events.some(...) ? evento : events[0]?.id ?? null` — o valor
         que não casa com um evento existente é tratado como AUSÊNCIA, não como
         filtro descartado.
Efeito: a pessoa pede um evento e vê outro; o balcão pode operar no evento errado.
Correção: a mesma régua da query (§3.2) — descartar e ANUNCIAR; nas telas de
          operação, decidir se o evento pedido é endereço (404) ou seleção (aviso).
```

**Pontos de atenção que ficam (sem código de dívida nova):**

- **`ao-vivo` sem envelope.** A rota responde 404 pelo `catch` do serviço e não usa
  `{ok:false,code,message}`. Ficou fora da lista positiva com o motivo escrito; se
  alguém a fechar, a catraca manda movê-la.
- **As 4 páginas e as rotas de catch-all dando 404 pelo motivo errado.** `[speakerId]`
  e `[raffleId]` ×3 (e o `ao-vivo`) transformam **qualquer** falha do serviço em
  "não encontrado". O 404 é a resposta certa; o motivo, não. Consertar exige separar
  "não existe" de "falhou" dentro do serviço — e é o mesmo tipo de decisão que a
  fase tomou para o formato.
- **A heurística da query.** A catraca reconhece `*Id` e `atividade`/`evento`; uma
  chave nova sem sufixo não é adivinhada. A lista é contrato; a descoberta é
  heurística.
- **O limite do alias.** A catraca prova a chamada com o nome do segmento, não que o
  valor validado é o usado. O comportamento cobre a distância hoje; a fonte não.
- **O fallback silencioso das cinco telas** — E89, acima.
- **Mudanças de contrato declaradas:** o QR (`{error}` → envelope), o ZIP de
  certificados (400 `INTERNAL` → 400 `INVALID_INPUT`), as quatro telas que passam de
  200 + painel para 404, e as duas rotas de crachá que passam de 500 mudo para 400
  com envelope.
- **O `trim` assimétrico** é decisão, não descuido: o caminho não limpa (endereço não
  tem espaço em volta) e a query limpa (URL copiada à mão). Quem ler os dois helpers
  precisa saber que a diferença é política do chamador.
- **A fixture é um retrato.** Se o componente mudar, a igualdade exata do unit
  reprova — regenerar é ato deliberado, como atualizar uma tabela de catálogo.

---

## 9. Checklist de Aceite

| Requisito | Situação |
|---|---|
| **Fatia 1** — `isUuid` puro no domínio + `requireUuidParam` que chama `notFound()` | ✅ (2 arquivos novos) |
| **23 páginas / 24 params** validados antes da consulta | ✅ (catraca de fonte) |
| As **3 cópias** da regex mortas, com as **3 políticas** preservadas | ✅ (16 casos de unidade) |
| **Fatia 2** — `certificados?evento=`, `modelos?modelo=` e `pagina/midia?evento=` com filtro **ignorado e anunciado** | ✅ (3 telas, 7 casos de integração) |
| Query malformada **nunca** vira 404; query válida continua filtrando | ✅ (200 + aviso; sem aviso no caso válido) |
| **Fatia 2** — envelope único `{ ok:false, code, message }` em `/api/t/**` | ✅ (51 chamadas em 9 rotas) |
| O QR mudou de `{error}` para o envelope, **declarado** | ✅ (contrato + 21 casos de rota) |
| A régua **400 = entrada obrigatória × 404 = endereço** | ✅ (tabela e testes; `agenda/ics` × crachás) |
| **Fatia 3** — catraca de fonte com **igualdade exata** (23/24 + 9/11) e exceções motivadas | ✅ (15 casos) |
| A catraca **achou** `zip?evento=` e `raffle-live?activityId=` e os dois foram fechados | ✅ (casos positivos + E2E) |
| **Tabela de comportamento**: 35 casos / 36 testes, não tautológica | ✅ (o ZIP reprovou 404 e virou 400) |
| O caso do F75 que media 500 foi **reapontado** para 404, sem skip | ✅ (`f75-paginas-de-erro.spec.ts`) |
| A página de erro coberta por **fixture preso ao componente** | ✅ (unit + portão WCAG AA) |
| As 4 telas 200 + painel → **404**, declaradas | ✅ (§3.7) |
| `docs/fase-76-500-que-deviam-ser-404.md` com as 9 seções e **ADR-366/367/368** | ✅ |
| `AGENTS.md` com fases **29 a 76**, contagens medidas, **ADRs 368 → 369**, linha 76, dívidas e §10 | ✅ (tamanho conferido no fim) |
| `README.md` e `docs/dividas-tecnicas.md` com a narrativa e a **E89** | ✅ |
| Bateria da §4 completa, com os números reais | ✅ (§6) |
| `f62` rodado isolado, com os 2 vermelhos pré-existentes medidos e diagnosticados | ✅ (§6.10) |
| Imagem `docs/imagens/f76-id-malformado.png` (id válido × malformado) | ✅ |
| Spec temporário apagado; `playwright-report/`, `test-results*`, `.playwright*` limpos | ✅ |
| `git status` sem resíduo e `next-env.d.ts` intacto | ✅ |
| **Nada** tocado em `src/app/globals.css` nem em `playwright.config.ts` | ✅ |
| Sem `any`; erros como valor; comentários explicam **POR QUE** | ✅ |

---

> **Aguardando APROVADO: AVANÇAR**
