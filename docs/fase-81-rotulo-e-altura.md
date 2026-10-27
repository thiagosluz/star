# FASE 81 — O rótulo que cabe no nome, e a altura que não depende do dado

> **Tema:** os três `aria-label` de exportação que a WCAG 2.5.3 reprova e a seção
> de destaques da raiz que crescia com o banco. **ADR-377.**
> **Base:** os 6 vermelhos medidos na F80 (§6.6 de `docs/fase-80-eslint-10.md`).

---

## 1. Sumário executivo

| Entrega | Onde | Prova |
|---|---|---|
| Os **3 `aria-label`** passaram a **começar** pelo texto visível | `src/components/events/activity-export-links.tsx` (linhas 117, 172, 184) | `accessibility.spec.ts` **39/39**, sem isenção |
| Catraca de **fonte** que reprova o nome que não começa pelo visível | `tests/unit/f81-rotulo-no-nome.test.ts` (**6 casos**) | falha de propósito com o rótulo antigo (medido) |
| Seção de destaques com **altura fixa de desenho** | `src/app/page.tsx` | `f62` **23/23**; página **3334 px** com 0–6 eventos |
| Um evento a mais no banco, `f62` **duas vezes** | fixture temporária pelo caminho do E2E | **0 px** nas duas |
| O intermitente de minuto do `f65` | `tests/e2e/f65-exportacao.spec.ts` | a expectativa usa o instante **gravado**, não `Date.now()` |
| `AGENTS.md` com a linha 81 e a **catraca f79 estendida** | `AGENTS.md`, `tests/unit/f79-...` | `AGENTS.md` em **63.795 bytes** |

**Números da fase**

```text
Arquivos de código tocados ...... 2 (componente + página) + 1 de teste E2E
Testes novos .................... 6 (1 arquivo de catraca)
Testes Vitest ................... 4395 em 247 arquivos (eram 4389 em 246) — 0 vermelhos
E2E ............................. 469 passando + 1 skip (470) — os 6 da F80 fechados (11.9m)
Baselines do f62 ................ 23/23, SEM re-base
Portão WCAG AA .................. 39/39, sem isenção
Migrações ....................... 0
```

---

## 2. O problema mais difícil: a baseline mede LAYOUT, e o layout lia o banco

A baseline `rodape-publico-claro/escuro` fotografa a **página inteira** (`fullPage`)
e mascara os dois blocos dinâmicos da raiz. A máscara esconde **pixel**, não
**espaço**: a seção `featured-events-section` continua empurrando o rodapé, que é o
alvo real da linha de base. A pergunta da fase era "por que a altura acompanha o
dado?" — e a resposta **não** é a que o comentário da F78 registrava ("o mesmo
número de cartões").

**Medido no navegador (antes, com o container da F80 rodando):**

```text
página 3362 px · seção 742 px · grade 526 px
cartões: [273, 273, 273, 229, 229]  →  2 fileiras (273 + 24 + 229)
resumos: 2 eventos com 2 linhas, 3 sem resumo
```

**A baseline tem 3334 px e a seção dela tem 714 px** (medido na imagem: a máscara
termina na linha 1488; a grade mede 498 = 273 + 24 + **201**). A conta fecha:

- o **cap de itens existe** (`getFeaturedPublicEvents(6)`, chamado com 6): 0–3
  eventos → 1 fileira; **4–6 → 2 fileiras**; o 7º não entra;
- "mais eventos no banco" não acrescenta fileira depois de 6 — **troca QUEM são os
  6** (ordem por `startsAt`, de todas as instituições públicas). Os eventos que a
  suíte de integração do Vitest deixa para trás (`Congresso de Comunicação
  4aedc12e`, 33 caracteres) entraram na lista e o título passou a ocupar **duas
  linhas** em vez de uma;
- uma linha de `text-lg` mede **28 px** — exatamente a diferença. A altura do cartão
  é `título (1–2 linhas) + resumo (0–2 linhas) + ficha`, e o resumo de duas linhas
  vale 44 px (32 + o vão). A seção crescia com o **texto**, não com a contagem; a
  contagem só muda a altura ao cruzar de 3 para 4 (uma fileira inteira, ~250 px).

Ou seja: a baseline da F78 foi gerada com um dado que produzia 498 px de grade. Ela
não é uma medida do desenho; é uma fotografia do banco daquele dia — e a F80 a viu
mudar por causa do texto de um evento de fixture.

---

## 3. Decisões técnicas

### 3.1 O nome acessível começa pelo texto visível

| `data-testid` | Texto visível (copiado do JSX) | Antes | Depois |
|---|---|---|---|
| `exportar-ics-atividade` | `Baixar .ics` | `Baixar o arquivo .ics desta atividade: {título}` | `Baixar .ics desta atividade: {título}` |
| `exportar-google-grade` | `Adicionar a próxima ao Google Calendar` | `Adicionar ao Google Calendar a próxima atividade: {próxima}` | `Adicionar a próxima ao Google Calendar: {próxima}` |
| `exportar-ics-grade` | `Baixar a minha agenda (.ics)` | `Baixar o arquivo .ics da minha agenda em {evento}` | `Baixar a minha agenda (.ics) de {evento}` |
| `exportar-google` | `Adicionar ao Google Calendar` | `Adicionar ao Google Calendar: {título}` (já passava) | inalterado |

O complemento **não** saiu: o nome continua dizendo de QUE atividade/agenda é o
link. O que mudou é a **ordem** — a regra `label-content-name-mismatch` (WCAG 2.5.3)
exige o texto visível como subsequência **contígua a partir do início**; "contém"
não basta. O portão de acessibilidade é a prova final; a catraca de fonte
(`f81-rotulo-no-nome`) é o feedback barato — lê o componente, extrai o texto visível
do JSX e reprova com `startsWith`. Ela foi **provada reprovando** (o rótulo antigo
voltou por um instante e o caso ficou vermelho; ver §6).

### 3.2 A altura da seção é a do desenho, não a do banco

Escolha: **(b) + (c)** — `min-height` dimensionado ao desenho **e** o conteúdo do
cartão limitado ao que o desenho promete.

- o cartão passa a medir **237 px** (`min-h-[237px]`, `flex` com o rodapé colado
  embaixo). O conteúdo máximo é **225 px** — o `min-h` é **maior** que o conteúdo,
  então **não corta nada**;
- o resumo passa a **uma linha** (`line-clamp-1`): era o único bloco do cartão cuja
  altura variava com o DADO (2 linhas em uns eventos, nenhuma em outros). O desenho
  já recortava em duas; agora recorta em uma, e o recorte é explícito;
- a grade reserva **498 px** (`min-h-[498px]`, `content-center`) = **2 × 237 + o vão
  de 24** — as duas fileiras que o desenho de três colunas promete. Com 0–3 cartões
  a fileira é centrada no espaço reservado; com 4–6 ela o preenche exatamente;
- o estado vazio (0 eventos) também reserva **498 px** — a seção não muda de altura
  entre "nenhum evento" e "seis eventos".

Geometria final medida: **seção 714 px** (64 de padding + 56 de cabeçalho + 32 do
`space-y-8` + 498 da grade + 64) → **página 3334 px**, exatamente a baseline.

**Alternativas descartadas:**

- **capar em 3 cartões** (uma fileira): a página cairia para **3109 px** e a
  baseline teria de ser re-baseada — proibido. Mostrar 3 de 6 também esconderia
  eventos que o desenho comporta;
- **reservar duas fileiras do cartão MÁXIMO (570 px)**: página **3406 px**, também
  contra a baseline; e é a mesma conta que faria a página crescer 72 px "para
  sempre";
- **altura fixa com `overflow: hidden`**: cortaria o resumo/título — proibido;
- **rolagem interna**: proibido, e esconderia conteúdo;
- **re-basear**: o objetivo é a página parar de crescer, não congelar a foto do
  banco de hoje.

### 3.3 O intermitente de minuto do `f65` — corrigido, não declarado

A fixture grava `startsAt = Date.now() - 20 min` e o caso (e) **recalculava a mesma
conta** na asserção. Se o minuto virasse entre a criação e a leitura, a página
mostrava `13:30` e a expectativa pedia `13:31`. A correção honesta é comparar a
**janela exibida** com o instante que a gerou: `agoraInicio` guarda o valor gravado
no `beforeAll`, e a asserção (rótulo e hora local) usa ele. Não é "uma linha" —
são três (a variável, a gravação e o uso) —, mas é a mesma ideia: **o dado, não o
relógio**.

O mesmo arquivo tinha um caso (c) que exigia o **`aria-label` antigo** do botão do
Google da agenda (`Adicionar ao Google Calendar a próxima atividade: …`). O nome
acessível é **contrato** do componente: o E2E que o lia passou a exigir o nome novo.
O vermelho apareceu na primeira execução desta fase (§6.4) e foi corrigido no teste —
não no componente que a acessibilidade exige.

---

## 4. ADR-377 — A seção de destaques reserva a altura do desenho, não a do banco

**Contexto.** A raiz da plataforma lê "eventos em destaque" a cada render desde a
F71, e o `f62` fotografa a página inteira. A máscara cobre os dois blocos
dinâmicos, mas o espaço que eles ocupam desloca o rodapé — que é o alvo da linha
de base. A seção media 742 px com o dado da F80 e 714 px na baseline; a diferença
de 28 px era uma linha de título. A suíte de integração do Vitest deixa eventos no
banco, então a altura da página dependia de QUAIS eventos estavam publicados.

**Decisão.** A seção passa a ter altura de DESENHO: o cartão mede 237 px (título em
até duas linhas, resumo em uma, ficha e rodapé), a grade reserva 498 px (duas
fileiras + vão) e o estado vazio reserva o mesmo espaço. A página mede 714 px de
seção / 3334 px no total para qualquer quantidade de 0 a 6 eventos.

**Justificativa.** A linha de base visual serve para medir o DESENHO; uma seção cuja
altura é função do texto de um dado de fixture mede o banco, não a tela — e o custo
aparece como um vermelho que não é regressão. A alternativa "não re-basear e
corrigir a página" só é possível se a altura for independente do dado; e a
alternativa "cortar o conteúdo" (altura fixa com `overflow`) trocaria um defeito de
teste por um defeito de produto. O `min-h` escolhido é **maior** que o conteúdo
máximo do cartão (237 ≥ 225): ele reserva espaço, não esconde texto. O resumo de uma
linha é o recorte declarado que remove a última fonte de variação — e o texto
completo continua na página do evento.

**Consequências.**

- A página da raiz não muda de altura entre 0 e 6 eventos **no desenho de três
  colunas**; em 1–2 colunas (celular/tablet) o cartão empilha e a seção cresce com a
  lista — congelar ali exigiria esconder cartões ou rolagem interna, os dois
  recusados (§8).
- O resumo dos cartões de destaque passa a uma linha (era duas) — mudança visível,
  dentro da seção mascarada, e o restante do texto continua na página do evento.
- O `f62` volta a medir o desenho fixo em volta (herói, jornada, banner e rodapé) e
  não precisa de re-base.
- Um eventual aumento do número de destaques (>6) continua limitado pelo cap de 6;
  mudar o cap exige rever as duas fileiras e a prova de altura.

---

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção / leitura |
|---|---|---|
| O `f62` da raiz falhava por **28 px** e o comentário da F78 dizia "depende do número de cartões" | O cap de 6 já existia; a diferença vinha do **texto** (título de 2 linhas em vez de 1 e resumo de 2 linhas) de um evento de fixture que entrou na lista | Medir o mecanismo antes de corrigir: 5 cartões, 2 fileiras, fileira 2 de 273 → 229. A correção é a altura do desenho, não o número de cartões |
| A catraca `f79-fases-no-arquivo-certo` estava **vermelha antes desta fase** | A F80 acrescentou a linha 80 à §9 do `AGENTS.md` e não estendeu `FASES_CORRENTES` (que ia até 79) | Estender a lista até 81 (`length: 53`) e deixar o comentário dizendo o porquê — o teste reprovava com `expected [ '80' ] to deeply equal []` |
| O `f65` reprovou um caso que **não** era o intermitente de minuto | O caso (c) exigia o `aria-label` antigo (`Adicionar ao Google Calendar a próxima atividade: …`), e o nome novo é o contrato do componente | O teste passou a exigir o nome novo; o `aria-label` é contrato e o E2E o prende (§6.4) |
| O `axe-core` 4.14 expôs 3 violações que o 4.13 não via | A regra `label-content-name-mismatch` perdeu a tag `experimental`; os nomes **continham** o texto visível, mas não começavam por ele | Nome = texto visível + complemento; catraca de fonte com `startsWith` (o "contém" deixaria passar o defeito) |
| O teste de minuto do `f65` falhava de vez em quando | A expectativa recalculava `Date.now() - 20 min` em vez de usar o instante gravado pela fixture | Guardar `agoraInicio` e comparar com ele; a janela exibida é a do dado |
| A primeira tentativa de protótipo com o cartão de resumo em 2 linhas media **245–247 px** por fileira | O cálculo de padding/linhas não fechava em 237; a grade estourava 498 e a página ia para 3342–3344 | Medir no navegador antes de editar: o resumo de 1 linha + `p-4`/`space-y-2`/`mt-3` fecha em 225, com 12 px de folga |

---

## 6. Evidência de verificação

### 6.1 A catraca de fonte — verde e **provando que reprova**

```text
$ npx vitest run tests/unit/f81-rotulo-no-nome.test.ts
 ✓ tests/unit/f81-rotulo-no-nome.test.ts (6 tests) 4ms
 Test Files  1 passed (1)
      Tests  6 passed (6)

# com o rótulo ANTIGO de volta, só para provar a catraca:
(6 tests | 1 failed)
   × o nome de "exportar-ics-atividade" começa pelo texto visível
```

### 6.2 Bateria

```text
$ npm run lint
(0 erros, 0 warnings)

$ npm run typecheck
0 erros

$ npm test
 Test Files  247 passed (247)
      Tests  4395 passed (4395)
 Duration  186.92s

$ npm run build
 exit=0 · 116 rotas (a lista termina com ƒ Proxy (Middleware))

$ npm run db:verify
  Contrato íntegro.

$ npm run db:verify:isolation
  9/9 verificações passaram.

$ npm run db:partitions
  (partições do mês corrente e dos seguintes criadas; a retenção não apaga)
```

### 6.3 A altura — a medição antes e depois

```text
# ANTES (container da F80, dado de hoje)
página 3362 · seção 742 · grade 526 · cartões [273,273,273,229,229] · resumos [32,16]

# DEPOIS (build de produção desta fase, dado de hoje)
página 3334 · seção 714 · grade 498 · cartões [237,237,237,237,237] · resumos [16,16]
```

### 6.4 O E2E

```text
$ docker compose --profile app up -d --build web worker
 Container eventflow-postgres Healthy
 Container eventflow-redis Healthy
 Container eventflow-web Started
 Container eventflow-worker Started
 exit=0
 # (a saída do build em si não foi capturada; a prova da imagem nova são as datas
 #  abaixo e o código novo respondendo — as duas coisas medidas)

$ docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}'
 eventflow/worker:local 2026-10-24 14:59:42 -0300
 eventflow/web:local    2026-10-24 14:59:20 -0300
$ docker compose ps web worker           → Up (healthy) · raiz 200

$ npx playwright test tests/e2e/accessibility.spec.ts
 39 passed (1.2m)

$ npx playwright test tests/e2e/f62-regressao-visual.spec.ts
 23 passed (36.8s)

# a prova: o evento a mais pelo caminho do E2E (createTenant + createEvent)
$ npx playwright test tests/e2e/tmp-f81-evento-extra.spec.ts
 1 passed (975ms)                       ← 6 destaques, título longo, resumo longo
$ node "$env:TEMP\medir-final.js"       → página 3334 · seção 714 · grade 498 · 6 cartões de 237
$ npx playwright test tests/e2e/f62-regressao-visual.spec.ts
 23 passed (37.5s)                      ← 1ª, com o dado diferente
$ npx playwright test tests/e2e/f62-regressao-visual.spec.ts
 23 passed (37.5s)                      ← 2ª, com o dado diferente

$ npx playwright test tests/e2e/f65-exportacao.spec.ts
 11 passed (8.6s)                       ← inclui "Acontecendo agora"

# a suíte INTEIRA, depois da limpeza da fixture temporária
$ npx playwright test
 1 skipped
 469 passed (11.9m)
```

---

## 7. Comandos operacionais

```powershell
# As três linhas do componente (o texto visível e o nome acessível)
Select-String src/components/events/activity-export-links.tsx -Pattern 'aria-label'

# A catraca dos rótulos (sem navegador)
npx vitest run tests/unit/f81-rotulo-no-nome.test.ts

# A geometria da seção, com o build de produção local
npx next start -p 3001
node "$env:TEMP\medir-final.js"        # imprime pagina/secao/grid/cards

# O f62 sozinho, contra o container
npx playwright test tests/e2e/f62-regressao-visual.spec.ts

# A prova da altura: um evento a mais pelo caminho do E2E e duas execuções
npx playwright test tests/e2e/tmp-f81-evento-extra.spec.ts   # cria e NÃO limpa
npx playwright test tests/e2e/f62-regressao-visual.spec.ts   # 1ª
npx playwright test tests/e2e/f62-regressao-visual.spec.ts   # 2ª
# limpeza do tenant da fixture:
docker exec eventflow-postgres psql -U eventflow_admin -d eventflow \
  -c "DELETE FROM tenants WHERE slug LIKE 'f81-extra-%';"
```

---

## 8. Dívidas técnicas e pontos de atenção

- **A altura fixa vale no desenho de TRÊS colunas** (lg). Em 1–2 colunas o cartão
  empilha e a seção cresce com o número de cartões — é o comportamento normal de
  uma grade que vira lista. Congelar ali exigiria esconder cartões ou rolagem
  interna, que a fase recusou. A baseline do `f62` mede 1440 px (três colunas).
- **O resumo dos cartões de destaque passou de duas linhas para uma.** É a remoção
  da última fonte de altura variável; o texto completo continua na página do evento.
  Mudança visível dentro da seção mascarada, declarada aqui e na ADR-377.
- **O estado vazio também reserva 498 px**: com zero eventos a seção tem a mesma
  altura, e o painel "Novos eventos sendo preparados" fica centralizado nela.
- **A catraca `f79` voltou ao verde** (a F80 a deixou vermelha ao acrescentar a
  linha 80 sem estender `FASES_CORRENTES`). A lista vai até 81; a próxima fase
  precisa estendê-la — é o gesto declarado que o próprio teste pede.
- **A dívida I8 continua aberta**: o `README.md` repete as contagens do
  `AGENTS.md` à mão. Esta fase atualizou as **duas cópias** (a linha de estado e a
  §10) e **não** resolveu a duplicação — mexer nela é outra fase.
- **`f65` corrigido, não declarado**: o intermitente de minuto deixa de existir;
  o `AGENTS.md` §4 passa a dizer que os 6 vermelhos da F80 estão fechados.

---

## 9. Checklist de aceite

- [x] Os 3 `aria-label` começam pelo texto visível, com o complemento mantido.
- [x] Teste de catraca em `tests/unit/f81-rotulo-no-nome.test.ts` (6 casos),
      provado reprovando com o rótulo antigo.
- [x] `tests/e2e/accessibility.spec.ts` **intocado** e verde, **sem isenção** (39).
- [x] O mecanismo da altura medido e escrito: cap de 6, 2 fileiras, 28 px = uma
      linha de título; a correção não foi cosmética.
- [x] Altura da seção independente do dado no desenho de 3 colunas: 714 px de seção
      / 3334 px de página; `min-h` 237 do cartão > conteúdo máximo 225.
- [x] Nenhuma altura fixa que corte conteúdo; nenhuma rolagem interna.
- [x] Um evento a mais pelo caminho do E2E + `f62` **duas vezes a 0 px**.
- [x] Baseline **não** re-baseada.
- [x] `f65` corrigido (instante gravado) — não apenas declarado.
- [x] Bateria: `lint` 0/0, `typecheck` 0, `npm test` 4395/247, `build` OK,
      `db:verify`, `:isolation` 9/9 e `:partitions` verdes.
- [x] Imagem do container reconstruída e datada; `accessibility` 39/39 e `f62` 23/23.
- [x] Suíte E2E inteira: **469 passando + 1 skip (470)** em 11,9 min.
- [x] `docs/fase-81-rotulo-e-altura.md` com 9 seções e **ADR-377**.
- [x] `AGENTS.md`: linha 81, `ADRs 377 → 378`, contagens novas e §10 — **63.795
      bytes** (teto 64.800).
- [x] `README.md`: as duas cópias das contagens atualizadas (I8 segue aberta).
