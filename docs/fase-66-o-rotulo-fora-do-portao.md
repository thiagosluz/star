# FASE 66 — O rótulo que ficou fora do portão (e a família da opacidade sobre o tema)

> **Fase curta e cirúrgica: nenhuma funcionalidade nova, nenhuma mudança de produto.**
> Quatro itens já medidos por outra pessoa, todos conferidos aqui antes de agir: (1) o
> contraste do rótulo de seção da página do evento, **pela causa** e varrendo a família;
> (2) a aba **"Programação"** no portão WCAG AA (19 → **20 casos**, sem isenção);
> (3) os **20 artefatos do Playwright versionados** em `.tmp-e2e/` desde a FASE 63;
> (4) a **defasagem de contagem** das dívidas (42 anunciados × 43 na tabela).
>
> **Nenhuma dívida foi declarada nesta fase — e o motivo está medido no §8**: o item 1
> fechou, e o que sobrou da varredura não é um item novo, é o escopo que a dívida
> **E84** já registra.

---

## 1. Sumário executivo

| Entrega | Onde | Situação |
|---|---|---|
| O **rótulo de seção** (`SectionHeading`) sai da opacidade e passa a usar o papel do tema | `src/components/events/theme-scope.tsx` | ✅ `ef-muted` (5,08:1 no claro · 5,91:1 no escuro) |
| A **varredura da família**: todo texto com `opacity` abaixo de 70% no tema do organizador | `block-renderer.tsx`, `speaker-gallery.tsx`, `registration-form.tsx`, `event-registration-form.tsx` (+ o rótulo) | ✅ **18 nós** corrigidos; os ≥70% ficam, **medidos** |
| O papel do tema para o texto sobre o **CARTÃO** (o `.ef-muted` de 60% mede 4,24:1 ali) | `event-theme.css` → `.ef-muted-on-card` | ✅ 5,84:1 sobre o cartão · 7,00:1 sobre o fundo (claro) |
| A **catraca** do par, nos dois modos e nas duas superfícies | `tests/unit/f66-contraste-do-rotulo.test.ts` | ✅ 9 casos, com os valores do NAVEGADOR presos |
| A aba **"Programação"** no portão WCAG AA | `tests/e2e/accessibility.spec.ts` | ✅ **20 casos**, `ISENCOES = []` |
| **Mutação provada** (o `opacity-60` de volta) | catraca de unidade + portão | ✅ 2 falhas de 9 · 1 violação `color-contrast` real, desfeita |
| **Limpeza dos artefatos versionados** | `git rm -r --cached .tmp-e2e` + `.gitignore` | ✅ 20 arquivos fora do índice e da árvore |
| **A contagem das dívidas** | `docs/dividas-tecnicas.md` + `AGENTS.md` | ✅ **43 → 41** (linhas de I1 e I2 marcadas como quitadas na F60) |

**Números da fase:** 6 arquivos de código/CSS tocados · 1 teste de unidade novo (9 casos) ·
1 caso novo no portão (19 → 20) · 0 migrações · 0 dívidas declaradas · 0 isenções de
acessibilidade.

**Sobre as contagens publicadas no `AGENTS.md`:** a bateria COMPLETA é do humano (e esta fase
não a rodou, por instrução). O que se soma é o que foi medido: **3221** testes de
unidade/integração (os **3212** do estado da FASE 65 + os **9** deste arquivo novo) e **341**
E2E (os **340** + o caso novo do portão). Os números desta fase — `9 passed`, `20 passed`,
`19 passed` — são saída real dos comandos do §6.

---

## 2. O problema mais difícil da fase

**Não foi achar o defeito — foi descobrir que a correção da fase anterior não servia para
metade da família.**

O item 1 chegou com o diagnóstico pronto: o `eyebrow` do `SectionHeading` usa `opacity-60`,
mede **4,44:1** sobre `#f9f9ff`, e "a correção é a mesma classe que a FASE 65 criou"
(`.ef-muted`). A primeira metade é verdadeira. A segunda **não é** — e só aparece quando se
mede, em vez de se acreditar:

```text
.ef-muted (60% da tinta)     sobre --ef-background .... 5,08:1  ✅
.ef-muted (60% da tinta)     sobre .ef-card ............ 4,24:1  ❌
opacity-60                   sobre .ef-card ............ 4,17:1  ❌
```

O cartão do tema **não é o fundo**: ele é `color-mix(in oklab, var(--ef-background) 92%,
var(--ef-text) 8%)` — 8% de tinta já dentro dele. Um texto que se afasta da tinta na direção
do fundo perde contraste nos DOIS sentidos quando o fundo já está mais perto dele. Aplicar
`.ef-muted` no formulário de inscrição, no cartão do palestrante, na trilha e na chamada —
que é onde a varredura da família chegou — teria **movido** o defeito de 4,17:1 para 4,24:1:
um número diferente, o mesmo vermelho.

O que define o desenho da fase é isso: **o papel do texto secundário depende da superfície em
que ele é desenhado**, e a página do evento tem duas superfícies (o fundo e o cartão), dois
modos (o organizador escolhe) e nenhum lugar onde a plataforma possa adivinhar a cor. A
resposta foi declarar o SEGUNDO papel no CSS do tema, com o peso medido nas quatro
combinações — e prender cada um separadamente, porque um papel que "serve" para as duas
superfícies seria, no melhor caso, um papel que passa raspando numa delas.

**A segunda descoberta da fase é de processo, e é a lição que fica:** o defeito não
sobreviveu por ser sutil. Ele sobreviveu porque a aba onde ele mora (a "Programação") não
estava no portão de acessibilidade — a FASE 65 varreu a aba irmã, corrigiu quatro nós do
mesmo caminho e deixou o quinto ali, **medido e registrado no §8 do documento dela**, à
espera de quem aprovasse. Um defeito que ninguém mede não é um defeito pequeno: é um
defeito invisível. A correção e o portão são as duas metades da mesma entrega, e é por isso
que esta fase não aceitou fechar uma sem a outra.

---

## 3. Decisões técnicas (o "porquê", e o que foi descartado)

### 3.1 Corrigir pela CAUSA: a cor sai da opacidade e passa a ser declarada no tema

**Decisão.** O `opacity-60` do rótulo vira `.ef-muted` (o papel que a FASE 65 criou), e os
nós de texto sobre o **cartão** passam a um papel novo, `.ef-muted-on-card`
(`color-mix(in oklab, var(--ef-text) 70%, var(--ef-background))`).

**Por que não escolher outro tom da plataforma.** `opacity` e token de plataforma são a mesma
armadilha por dois caminhos: os dois devolvem uma cor que **não** vem do organizador. A
opacidade compõe a tinta com o fundo que ele escolheu (e a catraca não consegue prever o
resultado); o token da plataforma é uma cor fixa sobre uma superfície variável. A FASE 65 já
tinha escrito isso para o token de aviso e para o "tempo restante"; repetir o erro com outro
hex seria trocar o sintoma de lugar.

**Por que não aumentar o `.ef-muted` de 60% para 70%.** Seria uma linha em vez de um papel
novo — e quebraria três coisas: (a) os valores presos na catraca da FASE 65 (`5,08` e `5,91`)
e a asserção de que o peso é `0,6`; (b) o tom que a FASE 65 escolheu de propósito para
reproduzir o desenho anterior à correção; (c) a separação de papéis, que é justamente o que
esta fase descobriu que faltava. Uma fase posterior não reescreve o número de quem veio
antes para caber no problema dela.

**Alternativa descartada: usar `opacity-70` nos cartões** (mede 5,66:1 no claro e 8,31:1 no
escuro, passa). Foi descartada porque mantém o MECANISMO que produziu o defeito: uma cor
composta com um fundo que a plataforma não controla. Ela passa no tema PADRÃO — e é
exatamente essa a margem que o organizador come quando escolhe um fundo um pouco diferente.
A régua da varredura ficou em 70% por isso: **a opacidade que passa está medida e declarada
com o número** (6,16:1 sobre o fundo), mas nenhum texto do tema desce abaixo dela.

### 3.2 A varredura da família: uma régua medida, não uma lista de nós

**Decisão.** A varredura mede a matriz inteira da opacidade nos dois modos e nas duas
superfícies, e prende o resultado em três casos:

```text
opacidade   sobre --ef-background   sobre .ef-card   (tema padrão CLARO)
   50%            3,24:1                3,10:1
   55%            3,81:1                3,60:1
   60%            4,44:1  ✗             4,17:1  ✗
   65%            5,22:1                4,85:1
   70%            6,16:1                5,66:1   ← a régua
   75%            7,34:1                6,62:1
   80%            8,72:1                7,75:1
   90%           12,22:1               10,53:1
```

No modo ESCURO todas passam (a de 50% inclusive: 4,98:1 sobre o fundo e 4,86:1 sobre o
cartão) — o defeito é de UM modo, e é por isso que o par se mede nos dois.

**A exceção declarada, e por que ela é estreita.** `opacity-60` continua no produto em ícones
**decorativos** (`aria-hidden`) ao lado do texto que diz a mesma coisa. O WCAG isenta o que é
decorativo, e o ícone não é texto: quem não o vê lê a palavra. A catraca cobra a marca
`aria-hidden` na mesma linha (ou nas duas seguintes, para o atributo quebrado em outra
linha): um ícone "decorativo" que perca a marca reprova. Os cinco que restam no tema são
todos desse tipo — `FileText`, `Link2`, `Lock`, `MapPin`, `Mic` — e os cinco estão no
cabeçalho da catraca com o motivo.

### 3.3 O portão: um caso novo, sem isenção, e a fixture que ele precisa

**Decisão.** A aba "Programação" entra em `tests/e2e/accessibility.spec.ts` como o **20º
caso**, com as mesmas fixtures (o evento da FASE 65, que já tem duas atividades em choque),
e o caso **afirma o conteúdo antes de varrer**: a aba ativa (`aria-current`, que vem do
servidor), a seção `#programacao` com o rótulo do cabeçalho e as duas atividades na grade.

**Por que afirmar o conteúdo.** O `axe` mede o que está no DOM: se a aba perdesse a grade —
ou se o cabeçalho de seção deixasse de ser desenhado — a varredura passaria IGUAL, e o nó
que esta fase corrigiu nem estaria na página. Um portão que passa numa tela vazia não é um
portão.

**Por que não isentar nada.** `ISENCOES` continua `[]` e o teto de duas linhas continua sem
uso. Isentar o rótulo seria silenciar exatamente o defeito que a fase existe para prender.

### 3.4 O resíduo: `git rm --cached`, `.gitignore` — e a pergunta feita ANTES

**Decisão.** Antes de mexer, a pergunta obrigatória: **alguém ESCREVE em `.tmp-e2e/`?**
Resposta medida — `git grep -n "tmp-e2e"` (índice e árvore) devolve **zero** ocorrências:
não há script no `package.json`, nem no `playwright.config.ts`, nem em workflow, nem em
documento que use a pasta como entrada. Ela é a saída de execuções antigas
(`--output=.tmp-e2e/...`), digitada à mão em algum momento da FASE 63 — resíduo, não
configuração.

Só então: `git rm -r --cached .tmp-e2e`, a pasta apagada da árvore e a linha `.tmp-e2e/` no
`.gitignore`, junto das outras entradas de artefato de teste (`playwright-report/`,
`test-results/`, `blob-report/`, `.playwright/`). **Nada de `git rm --cached` em arquivo que
não seja artefato**: a varredura dos outros resíduos da mesma família (§6.5) não achou
nenhum, e o que não é artefato fica.

### 3.5 A contagem: o caminho de corrigir a TABELA, não o anúncio

**Decisão.** Marcar as linhas de **I1** e **I2** como quitadas (elas foram quitadas na FASE
60, e o documento daquela fase diz isso com todas as letras: "Quitadas: E79, I2, I3 e I1")
e publicar a contagem **medida** — **41**.

**Por que este caminho e não "corrigir o anúncio para 42".** Ajustar o número anunciado
seria escolher o número que já estava escrito e manter duas linhas mentindo sobre o estado
do produto: quem lê a tabela para escolher o próximo trabalho veria "Cenários E2E em
`test.fixme`" e "16 páginas sem landmark" como abertos — e os dois foram fechados há seis
fases. O documento é a memória durável: ele corrige a tabela, e o anúncio segue a tabela.

**A medição (linha por linha, a régua do próprio documento).** Descontadas as linhas
riscadas e contadas as abertas: A=3 · B=4 · C=1 · D=3 · **E=24** · F=5 · H=1 · **I=0** =
**41**. Duas observações, medidas e ditas:

1. o total anunciado era **42**, e ele estava errado por dois motivos que se cancelavam: as
   linhas de I1/I2 contavam como abertas (43 no total) e o tema E tinha **24** abertos, não
   os 25 anunciados;
2. **nenhuma linha além de I1 e I2 foi tocada** — as outras 41 continuam como estavam.

---

## 4. ADRs

### ADR-337 — O papel do texto secundário depende da SUPERFÍCIE: o cartão não é o fundo

**Contexto.** A FASE 65 criou o papel `.ef-muted`
(`color-mix(in oklab, var(--ef-text) 60%, var(--ef-background))`) para substituir `opacity-60`
no texto secundário da página do evento, e o prendeu em 5,08:1 (claro) e 5,91:1 (escuro). A
FASE 66 varreu a família inteira dessa opacidade e achou dois grupos: os nós desenhados sobre
a `--ef-background` (o rótulo de seção, o nome da cota de patrocínio, o aviso do bloco de
HTML) e os nós desenhados **dentro de cartões** (o formulário de inscrição, o cartão do
palestrante, a trilha, a chamada, o botão "Indisponível"). O mesmo `.ef-muted` que resolve o
primeiro grupo mede **4,24:1** no segundo — abaixo do AA —, porque o `.ef-card` já é a mistura
do fundo com 8% da tinta e o texto que se afasta da tinta na direção do fundo perde contraste
mais rápido ali.

**Decisão.** O tema publica **dois papéis** de texto secundário, e o componente usa o papel da
superfície em que desenha:

```css
.ef-muted         { color: color-mix(in oklab, var(--ef-text) 60%, var(--ef-background)); }
.ef-muted-on-card { color: color-mix(in oklab, var(--ef-text) 70%, var(--ef-background)); }
```

O peso de cada um é MEDIDO nas duas superfícies e nos dois modos (o catálogo está no §6.3) e
preso em `tests/unit/f66-contraste-do-rotulo.test.ts`, que lê o peso **do CSS** em vez de
repeti-lo: mudar a receita reprova na catraca, e não só no olho de quem revisou.

**Justificativa.** (a) Um único papel não serve às duas superfícies por uma razão
geométrica, não estética: o cartão está entre o fundo e a tinta, então a distância que o
texto precisa manter é maior; (b) escolher o papel pela superfície mantém a decisão onde ela
é verificável — no CSS, com número — em vez de espalhar `opacity-70` e `opacity-80` pelos
componentes, cada um com o valor que parecia certo no dia; (c) a alternativa de aumentar o
`.ef-muted` para 70% e usar um papel só mudaria o tom do que a FASE 65 já tinha entregue e
preso, e faria a correção de uma fase reescrever o contrato da anterior; (d) a opacidade
continua proibida para texto porque ela compõe a cor com um fundo que a plataforma não
controla — passar no tema padrão não é passar no tema do organizador.

**Consequências.** (a) São **dois** números a manter em vez de um, e a catraca prende os
dois, incluindo a asserção de que o `.ef-muted` continua em 60% (o papel do fundo não pode
ser "ajustado" para cobrir o cartão); (b) a varredura da família virou uma régua: nenhum
texto do tema usa opacidade abaixo de 70%, e a exceção (ícone decorativo com `aria-hidden`)
é cobrada pela marca no próprio código; (c) o limite declarado segue o da FASE 61 — a mistura
é sobre a paleta do organizador, e um tema com contraste base baixo derruba qualquer tom
derivado; o portão mede o tema PADRÃO, o de quem não escolheu nada; (d) **a plataforma
continua entrando no tema por outro caminho**, e isso NÃO é desta ADR: os componentes do
evento ainda usam `text-muted-foreground`, `bg-card` e `border-border` em alguns nós, e no
modo ESCURO do organizador esses pares desabam (2,10:1 sobre o fundo, 1,86:1 sobre o cartão).
O escopo está medido no §8 e pertence à dívida **E84** — o conserto é o tema publicar também
os papéis semânticos, e não trocar um token por outro.

---

## 5. Lições aprendidas (defeitos REAIS, com o número)

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | O rótulo "Programação" media **4,44:1** sobre `#f9f9ff` e reprovava o AA — e sobreviveu a uma fase inteira que corrigiu QUATRO nós da mesma família | A aba "Programação" **não estava no portão WCAG AA**. A FASE 65 varreu a aba irmã ("Acontecendo agora"), achou os quatro nós que passavam por ali e registrou o quinto no §8 do documento dela, com o número — à espera de decisão. Defeito fora do portão não é defeito pequeno: é defeito invisível | O rótulo passou a `.ef-muted` (5,08:1 claro · 5,91:1 escuro) **e** a aba entrou no portão como o 20º caso, sem isenção. As duas metades na mesma fase, porque uma sem a outra deixa o defeito voltar em silêncio |
| 2 | "A correção é a mesma classe da fase anterior" — e **não era**: `.ef-muted` mede **4,24:1** sobre o `.ef-card`, abaixo do AA. Aplicá-la nos 11 nós que vivem dentro de cartões teria trocado 4,17:1 por 4,24:1 | O cartão do tema não é o fundo: ele é `color-mix(… var(--ef-background) 92%, var(--ef-text) 8%)`. Um texto que se afasta da tinta na direção do fundo perde contraste nos DOIS sentidos quando o fundo já está mais perto dele — e a FASE 65 só tinha medido a superfície de fundo | O tema ganhou um SEGUNDO papel (`.ef-muted-on-card`, 70% da tinta: 5,84:1 sobre o cartão no claro, 7,17:1 no escuro) e a catraca prende cada um separadamente, inclusive a impossibilidade de o papel do fundo cobrir o cartão |
| 3 | O caso novo do portão reprovou na PRIMEIRA execução — e não era o `axe`: `locator('#programacao').locator('header p')` resolveu **2 elementos** (o rótulo e a descrição) e o `toHaveText` estourou em *strict mode violation* | A asserção perguntou "quantos `<p>` o cabeçalho tem", e não "qual é o rótulo". É a mesma família da lição que mede a coisa errada: o seletor tem de casar com o FATO, não com a forma do DOM | `locator('header p', { hasText: 'Programação' })` com `toHaveCount(1)` e `toHaveText` — o filtro por TEXTO é o que diz qual dos dois parágrafos está sendo medido |
| 4 | **20 arquivos de artefato do Playwright** (`trace.zip`, `test-failed-1.png`, `error-context.md`, `.last-run.json`) estavam COMMITADOS desde a FASE 63 e sobreviveram a **três** limpezas anteriores | A pasta `.tmp-e2e/` nasceu de um `--output` digitado à mão; o `.gitignore` cobria `*.log` (os seis logs dela nunca entraram) mas não a PASTA, e nada no repositório a citava — então nem o `git grep` a encontrava como configuração, nem quem limpava tinha motivo para olhar para ela | `git rm -r --cached .tmp-e2e`, a pasta apagada da árvore e `.tmp-e2e/` no `.gitignore` junto das outras saídas de teste — **depois** de confirmar, com `git grep`, que nenhum script, workflow ou documento a usa como entrada |
| 5 | O `AGENTS.md` anunciava **42** dívidas abertas e a tabela contava **43** | As linhas de **I1** e **I2** ficaram sem o risco de quitadas desde a FASE 60 — e o anúncio ainda trazia o tema E com **25** quando a tabela tem **24** abertos. Dois erros de sinais opostos que se cancelavam: o total parecia quase certo, e as duas contagens por tema estavam erradas | A tabela passa a dizer a verdade (I1 e I2 quitadas na F60, com o que a fase fez escrito na linha) e a contagem publicada vira a MEDIDA: **41** (A=3 · B=4 · C=1 · D=3 · E=24 · F=5 · H=1 · I=0). Nenhuma outra linha foi tocada |

---

## 6. Evidência de verificação (saída real)

### 6.1 Qualidade

```text
$ npm run typecheck
> tsc --noEmit
(exit 0 — nenhum erro)

$ npm run lint
> eslint .
(exit 0 — 0 erros, 0 avisos)
```

### 6.2 A catraca de unidade da fase

```text
$ npx vitest run tests/unit/f66-contraste-do-rotulo.test.ts
 ✓ tests/unit/f66-contraste-do-rotulo.test.ts (9 tests) 12ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

### 6.3 O catálogo MEDIDO da família (o que ficou e o que saiu)

Medido com a régua da casa (`paraRgb`/`razaoDeContraste` do domínio + a conta do
`color-mix(in oklab, …)`), nos dois modos e nas duas superfícies do tema:

```text
                                sobre --ef-background   sobre .ef-card
         CLARO (tema padrão #f9f9ff / cartão #e4e5eb)
opacity-50 ............................ 3,24:1          3,10:1   ✗
opacity-60 ............................ 4,44:1  ✗       4,17:1   ✗   ← o defeito
opacity-70 ............................ 6,16:1          5,66:1   ✅ (fica)
opacity-80 ............................ 8,72:1          7,75:1   ✅ (fica)
.ef-muted (60%, o papel do FUNDO) ..... 5,08:1  ✅      4,24:1   ✗
.ef-muted-on-card (70%, o do CARTÃO) .. 7,00:1  ✅      5,84:1   ✅
         ESCURO (tema padrão #090b0f / cartão #171a1e)
opacity-50 ............................ 4,98:1          4,86:1   ✅
opacity-60 ............................ 6,75:1          6,43:1   ✅ (o defeito era de UM modo)
opacity-70 ............................ 8,96:1          8,31:1   ✅
.ef-muted (60%) ....................... 5,91:1          5,24:1   ✅
.ef-muted-on-card (70%) ............... 8,08:1          7,17:1   ✅
```

**O que ficou de fora, com o número:**

* **`opacity-70` e acima** (o rótulo da aba inativa, a descrição do cabeçalho, a descrição
  do cartão, o resumo do formulário): 6,16:1 sobre o fundo no claro e 8,96:1 no escuro, e
  5,66:1 / 8,31:1 sobre o cartão. Passam com margem, e a fase não mexe no que passa.
* **Ícones decorativos com `aria-hidden`** (`FileText`, `Link2`, `Lock`, `MapPin`, `Mic`,
  `ExternalLink`, `Eye`): não são texto, e quem não os vê lê a palavra ao lado. A catraca
  cobra a marca `aria-hidden` no próprio código.
* **Token de texto da PLATAFORMA dentro do tema** (`text-muted-foreground`, `bg-card`,
  `border-border`): no modo CLARO do organizador os pares passam (8,93:1 sobre o fundo e
  7,45:1 sobre o cartão, para o `--ef-on-surface-variant` claro); no modo **ESCURO** do
  organizador o token continua sendo o claro e o par desaba — **2,10:1** sobre o fundo e
  **1,86:1** sobre o cartão. A correção não é a desta fase: é o escopo da dívida **E84**
  (§8), e os números ficaram presos na catraca para a próxima decisão começar pela medição.

### 6.4 A medição do rótulo NO NAVEGADOR (antes e depois, nos dois modos)

`getComputedStyle` no Chromium, na página pública de um evento real servida pelo container,
com o tema do organizador em `light` e em `dark`. O nó é o mesmo
(`<p class="… uppercase tracking-wider …">Programação</p>`) e a superfície é a
`--ef-background`:

```text
ANTES (opacity-60)
  claro   color rgb(24, 28, 36)          opacity 0.6   sobre #f9f9ff   → 4,44:1  ✗
  escuro  color oklch(0.97 0 0)          opacity 0.6   sobre #090b0f   → 6,75:1  ✅

DEPOIS (ef-muted)
  claro   color oklab(0.529122 -0.00011043 -0.0130331) = #686b73   opacity 1  → 5,08:1
  escuro  color oklab(0.642 -0.000348623 -0.00398478)  = #8b8d8f   opacity 1  → 5,91:1
```

E o fundo do cartão que a conta da catraca tem de reproduzir (lido no mesmo
`getComputedStyle`): `oklab(0.923186 0.0019489 -0.00832323)` no claro — o MESMO valor que a
FASE 65 prendeu — e `oklab(0.2156 -0.000801833 -0.00916499)` no escuro. Os dois `L` do oklab
e os dois hexadecimais estão presos em `MEDIDO_NO_NAVEGADOR`, na catraca.

### 6.5 O portão WCAG AA — 19 → 20 casos

```text
$ docker compose --profile app up -d --build web worker
$ docker images eventflow/web:local --format "{{.CreatedAt}}"
2026-10-04 10:12:16 -0300        (código desta fase)

$ npx playwright test tests/e2e/accessibility.spec.ts --output=<dir FORA da árvore>
  ✓  14 [chromium] › telas autenticadas › a aba "Programação" não tem violação crítica (3.3s)
  ...
  20 passed (59.9s)
```

Nenhuma isenção foi acrescentada (`ISENCOES = []`, teto de 2 linhas sem uso) e o caso novo
junta-se aos dezenove — o mesmo arquivo, o mesmo `expectNoCriticalViolations`, a mesma régua
de landmark (`exatamente 1 <main>`, que a página do evento já satisfazia).

### 6.6 A catraca MORDE — a mutação provada (e desfeita)

1) O `opacity-60` de volta no rótulo (`theme-scope.tsx`), e a catraca de unidade:

```text
$ npx vitest run tests/unit/f66-contraste-do-rotulo.test.ts
 Tests  2 failed | 7 passed (9)

 FAIL  … > o rótulo do `SectionHeading` usa o papel do tema, e não uma opacidade
   expect(linha, 'o rótulo não usa opacidade').not.toContain('opacity…')

 FAIL  … > nenhum texto do tema usa opacidade abaixo de 70% (a que passa foi medida)
   AssertionError: Opacidade abaixo de 70% em texto do tema (o papel do tema é medido; a opacidade não):
   theme-scope.tsx:134 → <p className="text-xs font-semibold uppercase tracking-wider opacity-60">
   : expected [ Array(1) ] to deeply equal []
```

2) A mesma mutação no container (`--build` novo, imagem de 10:18:14) e o **portão**:

```text
$ npx playwright test tests/e2e/accessibility.spec.ts --grep "Programação" --output=<dir FORA da árvore>
  ✘  1 … a aba "Programação" não tem violação crítica (9.5s)

    Error: Acessibilidade em aba "programação" (/t/acessibilidade-…/eventos/<slug>): 1 violação(ões) de impacto crítico/sério

      ✗ color-contrast (serious) — Elements must meet minimum color contrast ratio thresholds
        o que corrigir: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
        elementos (1):
          .uppercase
            <<p class="text-xs font-semibold uppercase tracking-wider opacity-60">Programação</p>>
        regra: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=playwright

  1 failed
```

3) A mutação desfeita (o diff do componente volta a ter só a correção), o container
reconstruído (imagem de 10:20:57) e a prova de que o verde voltou:

```text
$ git diff src/components/events/theme-scope.tsx
-        <p className="text-xs font-semibold uppercase tracking-wider opacity-60">
+        <p className="ef-muted text-xs font-semibold uppercase tracking-wider">

$ npx playwright test tests/e2e/accessibility.spec.ts --grep "Programação"
  ✓  1 … a aba "Programação" não tem violação crítica (3.6s)  → 1 passed

$ npx vitest run tests/unit/f66-contraste-do-rotulo.test.ts
  Tests  9 passed (9)
```

### 6.7 A regressão visual não mudou um pixel

A mudança é de COR em nós que vivem na página do evento — e a única linha de base desta casa
que desenha o tema do evento é a da aba "Acontecendo agora" (a "Programação" não tem linha de
base). Rodada inteira, sem atualizar snapshot nenhum:

```text
$ npx playwright test tests/e2e/f62-regressao-visual.spec.ts --output=<dir FORA da árvore>
  19 passed (47.2s)
```

### 6.8 A limpeza dos artefatos

```text
$ git grep -n "tmp-e2e"          → nenhuma ocorrência (índice e árvore)
$ git ls-files .tmp-e2e | count  → 20 arquivos versionados
$ Get-ChildItem -Recurse .tmp-e2e → 26 arquivos na árvore (os 6 `.log` nunca foram
                                     versionados: o `.gitignore` já cobria `*.log`)

$ git rm -r --cached .tmp-e2e    → 20 remoções no índice
$ Remove-Item -Recurse -Force .tmp-e2e   → a pasta some da árvore
$ git check-ignore -v .tmp-e2e/x.log
.gitignore:34:.tmp-e2e/   .tmp-e2e/x.log

$ git status --short | Select-String "tmp-e2e"
D  .tmp-e2e/… (as 20 remoções do `git rm --cached`, que é o efeito pedido)
```

**Varredura dos outros resíduos da mesma família:** `git ls-files` não tem nada em
`coverage/`, `playwright-report/`, `test-results/`, `blob-report/` nem `.playwright/`; os
únicos `.png` versionados são as **19 linhas de base** da regressão visual (F62/F64/F65) e as
imagens de `docs/imagens/`; nenhum `.zip`, `trace`, `error-context` ou `.last-run.json` fora
do `.tmp-e2e`. **Nada mais foi removido** — e nada que não fosse artefato foi tocado.

---

## 7. Comandos operacionais

```bash
# A catraca da fase (o rótulo, o papel do cartão e a varredura da família)
npx vitest run tests/unit/f66-contraste-do-rotulo.test.ts

# O portão de acessibilidade — agora com a aba "Programação" (20 casos, sem isenção)
npx playwright test tests/e2e/accessibility.spec.ts --output=<dir FORA da árvore>

# A regressão visual (não deve mudar um pixel: a correção é de cor e não de layout)
npx playwright test tests/e2e/f62-regressao-visual.spec.ts --output=<dir FORA da árvore>

# Qualidade
npm run typecheck && npm run lint
```

O portão e a regressão visual **exigem o container servindo o código novo**
(`docker compose --profile app up -d --build web worker`) e a data da imagem conferida: um
`--build` que falha deixa o container ANTERIOR no ar e a suíte mede código que não existe
(§4 do `AGENTS.md`). Foi por isso que as duas execuções da mutação (§6.6) foram precedidas da
conferência de `docker images`.

---

## 8. Dívidas técnicas e pontos de atenção

**Nenhuma dívida declarada nesta fase.** O **E87** só existiria se o item 1 não fechasse — e
ele fechou, com a medição antes e depois e a mutação provada. Criar dívida para algo quitado
na mesma fase seria inflar o levantamento com trabalho feito.

**O que a varredura da família achou e NÃO é desta fase** (medido, para a próxima decisão
começar pelo número, e não pela suspeita):

1. **O token de texto da PLATAFORMA dentro do tema do evento, no modo ESCURO do
   organizador.** Os componentes da página do evento ainda leem a escala do `html` em alguns
   nós (`text-muted-foreground`, `bg-card`, `border-border`), e o organizador escolhe o modo
   DELE (`colorMode`). Medido: o token claro (`#464555`) sobre a `--ef-background` de um tema
   escuro = **2,10:1**, e sobre o `.ef-card` escuro = **1,86:1**; o mesmo token no modo claro
   do organizador passa (8,93:1 e 7,45:1). O conserto não é trocar um token por outro: é o
   tema publicar também os papéis SEMÂNTICOS (`card`, `border`, `muted-foreground`), como ele
   já publica os `--ef-*` desde a FASE 61 — e **isso é o escopo que a dívida E84 já
   registra** (o claro/escuro do visitante na página do evento, onde o modo é do
   organizador). Fica aqui a medição; a decisão é de quem aprova a próxima fase.
2. **O visitante em modo escuro sobre a página de um evento claro.** O `<html>` recebe
   `class="dark"` da escolha do VISITANTE e os mesmos tokens da plataforma viram claros
   (`#c5c6d0` sobre a `--ef-background` clara do organizador = **1,62:1**). É a outra face do
   item acima, e a razão pela qual a E84 continua aberta para a página do evento.
3. **A contagem das dívidas.** O documento agora mede **41** itens abertos. As linhas de I1 e
   I2 foram marcadas como quitadas (a FASE 60 as fechou) e nenhuma outra linha foi tocada; o
   `AGENTS.md` passou a publicar a contagem medida, com os totais por tema conferidos linha
   por linha.

---

## 9. Checklist de aceite

| Requisito (do pedido da fase) | Situação |
|---|---|
| O `eyebrow` do `SectionHeading` medida **antes** (4,44:1) e **depois** (5,08:1), nos dois modos | ✅ §6.4, com os valores do `getComputedStyle` de antes e de depois |
| Corrigido **pela causa** (a plataforma fora do par: a cor vem do tema) | ✅ `.ef-muted`, e nenhum token novo da plataforma |
| A **família varrida** em `src/components/events/**` e no CSS do tema, com os que ficam **medidos** | ✅ 18 nós corrigidos; `opacity ≥ 70%` e ícones `aria-hidden` declarados com número (§6.3) |
| O par **preso numa catraca**, na régua da casa (`paraRgb`/`razaoDeContraste` + a conta do `color-mix(in oklab)`) | ✅ `tests/unit/f66-contraste-do-rotulo.test.ts`, 9 casos, com os valores do NAVEGADOR presos |
| A aba **"Programação"** no portão, com conteúdo de fixture | ✅ 20º caso em `tests/e2e/accessibility.spec.ts`, sem isenção nova |
| A catraca **morde** — mutação que reintroduz o defeito, com a saída real, desfeita, e `git diff` limpo no componente | ✅ §6.6: 2 falhas de 9 na unidade, 1 violação `color-contrast` real no portão, mutação desfeita |
| `.tmp-e2e/` limpo: ninguém escreve ali, fora do índice, fora da árvore, no `.gitignore` | ✅ §6.8 — `git grep` zerado, 20 arquivos desversionados, pasta apagada, linha no `.gitignore` |
| Outro resíduo da mesma família conferido e relatado | ✅ §6.8 — nenhum outro; nada de artefato sobrou versionado |
| A contagem das dívidas corrigida pelo caminho certo, sem tocar em outra linha | ✅ I1 e I2 marcadas como quitadas (F60) e a contagem medida: **41** (§3.5) |
| `docs/fase-66-*.md` com as 9 seções e **ADR-337** | ✅ este documento; a próxima ADR é a **338** |
| `AGENTS.md` com o estado, a linha 66, o §10 apontando para este documento e o orçamento respeitado | ✅ (ver o tamanho final no relatório da fase) |
| `README.md` com o estado e a linha no índice de documentação | ✅ |
| `docs/dividas-tecnicas.md` com a narrativa da fase | ✅ |
| **Nada de funcionalidade nova, nada de layout além da cor do rótulo** | ✅ `f62` 19/19 sem atualizar linha de base (§6.7) — nenhum pixel mudou |
| `globals.css` e `playwright.config.ts` intocados | ✅ `git status` limpo para os dois |
| Specs de outras fases intocadas (exceção: `accessibility.spec.ts`) | ✅ só `tests/e2e/accessibility.spec.ts` mudou |

**Aguardando APROVADO: AVANÇAR**
