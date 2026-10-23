# FASE 79 — O `AGENTS.md` volta a respirar: as fases 1–25 ganham arquivo próprio

> **Fase de documentação.** Não tocou `src/**` (nem `globals.css`, nem
> `playwright.config.ts`, nem nenhum `docs/fase-NN-*.md` existente). O que mudou foi
> **onde** o registro das fases 1 a 25 vive — e a prova de que nenhuma linha se perdeu.

---

## 1. Sumário executivo

O `AGENTS.md` estava em **64.791 bytes** contra o teto de **~64.800** (o harness corta em
**65.244** e **apaga em silêncio**). A causa não era redação: a tabela da §9 carregava
**todas** as fases desde a 1. A F78 já tinha condensado a linha 76 para a 78 caber, e a
próxima fase não caberia sem apagar detalhe útil.

A F79 resolve por **estrutura**: as linhas das fases **1 a 25** — **23 linhas** — saíram da
tabela **como estavam** e passaram a viver em **`docs/fases-historico.md`**; no lugar delas,
um **ponteiro de 3 linhas**; a tabela do `AGENTS.md` ficou **corrente** (29 a 79) e ainda
ganhou a **linha 79** — que só entra **porque** o movimento abriu espaço.

### Entregas

| Entrega | Arquivo | Números |
|---|---|---|
| Registro histórico das fases 1–25 | `docs/fases-historico.md` (novo) | 23 linhas movidas · 4.821 bytes · 1 cabeçalho de 4 parágrafos |
| `AGENTS.md` com a tabela corrente | `AGENTS.md` | **64.791 → 61.830 bytes** (−2.961) · 51 linhas na tabela (29–79) · ponteiro de 3 linhas |
| Índice da documentação | `README.md` | **1 linha** (a do arquivo novo) |
| Catraca do lugar das fases | `tests/unit/f79-fases-no-arquivo-certo.test.ts` (novo) | **5 casos** · 1 arquivo · reprova nos dois sentidos |
| Este documento + **ADR-375** | `docs/fase-79-o-agents-que-respira.md` | 9 seções |

**Números da fase:** 0 arquivos de código · 0 migrações · **1 arquivo de teste** com
**5 casos** · **23 linhas movidas** · **2.961 bytes liberados** · 4 linhas de contagem
atualizadas na §1/§4 · **ADR-375**.

### O diff do `AGENTS.md`, em uma linha

**9 inserções / 27 remoções** — as 23 linhas movidas + as 4 contagens que saíram, o ponteiro
(3 linhas + a linha em branco), a linha 79 e as 4 contagens que entraram. **Nada mais.**

---

## 2. O problema mais difícil da fase

Não foi editar o `AGENTS.md` (são quatro mudanças). Foi **provar o movimento** — e o
obstáculo é que a prova precisa de um "antes" que deixa de existir no instante em que a
edição acontece.

A regra da fase era "movidas como estão hoje": uma linha reescrita, um acento corrigido, um
espaço a mais, e o movimento vira uma reescrita silenciosa de 23 registros. Isso descarta
copiar/colar à mão. A solução foi **extrair as linhas por programa** do `AGENTS.md` **antes**
de tocá-lo e gerar o arquivo novo a partir delas, sem passar por digitação em nenhum ponto.
O `AGENTS.md` foi então editado por outro programa que **aborta** se o arquivo não estiver
exatamente no estado esperado (73 linhas de fase, bloco contíguo, as 23 primeiras na série
`1…17, 23, 24, 25, 21, 22`).

A segunda dificuldade é onde colocar o ponteiro. **Não dá para inserir um `>` no meio de uma
tabela markdown**: o bloco de citação quebraria a tabela em duas. O ponteiro tem de ficar
antes (ou depois) do bloco — e antes é onde ele é lido por quem procura a fase antiga. É por
isso que a §9 abre com o aviso e só então desenha a tabela.

A terceira é o que impede a regressão. A catraca não pode derivar a lista de fases de
`docs/fase-NN-*.md`: existem documentos de **plano** (como `docs/fase-77-plano.md`) que
exigiriam uma linha de fase entregue. A lista é **explícita**, e o gesto de acrescentar a
fase nova a ela é parte do ritual da fase.

> O limite da prova está escrito no teste: a catraca prende o **lugar** das fases. O
> "movido como estava" foi provado uma vez, pelo script da fase, comparando **texto a texto**
> contra `HEAD` e contra a árvore de antes — não é o que o teste refaz todo dia.

---

## 3. Decisões técnicas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| **Mover as fases 1–25**, não condensar | Condensar é **apagar detalhe** para caber; o registro de fase é memória do projeto. A §2 mandava condensar — e cada condensação só se recupera no doc da fase, se alguém procurar | Condensar mais uma linha (a F78 já condensara a 76) — empurraria o mesmo problema para a fase seguinte, apagando mais um registro |
| **Mover como estão**, sem resumo novo | Um resumo novo é uma segunda versão do registro, que divergiria da primeira no primeiro dia. O arquivo histórico é **movimento**, não redação | Reescrever as 23 linhas em forma curta "para caber melhor" |
| **Ordem cronológica** da tabela | É a ordem que a tabela já tinha — e a que a nota "numeração de tema, não de ordem" explica. A 21 e a 22 vêm depois da 25 de propósito | Reordenar por número (perderia o fato de que a 21 foi a última entregue do bloco) |
| **Ponteiro antes da tabela** | `>` no meio quebra a tabela em duas. Antes, ele é lido por quem chega procurando a fase 3 | Ponteiro depois da nota de numeração (longe de onde a ausência é notada) |
| **`AGENTS.md` fica com a tabela corrente** | É o arquivo que a sessão nova lê primeiro: ele precisa do **estado** e do **caminho** para a história, não da história inteira | Um `docs/fases.md` único com tudo (não libera o teto de leitura do agente, que é o arquivo em questão) |
| **Catraca com lista explícita** de fases correntes | Documento de plano existe (`docs/fase-NN-plano.md`) e não é fase entregue — derivar de `docs/` reprovaria por um plano | Derivar as fases de `docs/fase-NN-*.md` |
| **§2 e §10 intocadas** | Escopo declarado da fase: só a tabela da §9 e as contagens que a fase exige. Mexer nelas seria "aproveitar a viagem" | Atualizar a §2 (o remédio) e a §10 (a última fase) nesta mesma fase — ficou registrado como ponto de atenção (§8) |

---

## 4. ADRs

### ADR-375 — O registro de fase não se apaga, muda de arquivo

**Contexto.** O `AGENTS.md` chegou a **64.791 bytes** contra o teto de ~64.800, com o corte
do harness em **65.244** apagando conteúdo em silêncio (aconteceu na FASE 68). A causa
estrutural: a tabela da §9 acumulava **todas** as fases desde a 1. A regra vigente (§2) dizia
para **condensar linhas históricas** quando passasse do teto — a F78 condensou a linha 76 para
a 78 caber, e a fase seguinte não caberia sem apagar mais detalhe.

**Decisão.** O registro histórico **sai do arquivo que carrega o estado corrente** e passa a
viver em `docs/fases-historico.md`, com as linhas **movidas como estão**. A tabela da §9 fica
corrente (29 a 79), com um **ponteiro de 3 linhas** para o arquivo novo. Uma **catraca**
(`tests/unit/f79-fases-no-arquivo-certo.test.ts`) reprova fase ≤ 25 na tabela corrente, fase
> 25 ausente dela, fase > 25 no arquivo histórico e ponteiro ausente.

**Justificativa.** O problema é de **estrutura**, não de redação: um arquivo que cresce sem
limite porque carrega a história inteira. Condensar **perde informação para caber**; mover
**reorganiza para caber**. O `AGENTS.md` é lido primeiro por toda sessão nova, e o que ele
precisa entregar é o estado atual + o caminho para o resto — não o resto. A linha nova da
fase entra **porque** o movimento abriu espaço: é o teste de que a folga é real (2.970 bytes
sobraram depois de acomodar a própria F79).

**Consequências.**

- O `AGENTS.md` mede **61.830 bytes**; a folga é de **2.970 bytes** até o teto e **3.414**
  até o corte duro — **≈ 8 a 10 fases** na média medida da tabela corrente (278,5 bytes/linha).
- Quem procurar a F3 no `AGENTS.md` encontra o ponteiro; a F3 está a um clique.
- As 23 linhas passam a ter **dois lugares possíveis**, e é a catraca que impede o retorno.
- **A §2 continua descrevendo a condensação como remédio** e a **§10 continua apontando a F78**
  como última fase entregue: as duas ficaram byte a byte por escopo declarado, e a próxima
  fase que puder tocar o `AGENTS.md` deve atualizá-las (ponto de atenção, §8).

---

## 5. Lições aprendidas

**Nenhum defeito de produto** — a fase não toca código (o único desvio foi um *warning* de
lint no arquivo de teste, corrigido antes de fechar). O que os comandos **ensinaram**
(medido, não estimado):

| Sintoma | Causa raiz | Correção |
|---|---|---|
| As 23 linhas somam **3.564 bytes** de texto (3.610 com as quebras de linha) — não os ~7–9 KB que "300–400 bytes por linha" sugeria | A distribuição é **bimodal**: metade das linhas é de uma frase (mínimo **44 bytes**; mediana **152**), e só as condensadas chegam a 318–327 | A folga foi **medida** (2.970 bytes ≈ 8–10 fases a 278,5 bytes/linha), não projetada pela média da fase anterior |
| `npm run lint` reprovou com **1 warning**: `FASES_HISTORICAS` não usada | A lista foi escrita para a asserção de **ordem**, e a de **conjunto** ficou com a lista literal embutida | A constante passou a ser usada na asserção de conjunto (ordenada numericamente); a ordem ficou com `ORDEM_CRONOLOGICA` |

---

## 6. Evidência de verificação

### 6.1 Tamanho — antes e depois

```text
(Get-Item AGENTS.md).Length
  antes (HEAD) ...... 64.032  (árvore de trabalho, antes da F79: 64.791)
  depois ............ 61.830
  teto .............. 64.800  → folga de 2.970 bytes
  corte do harness .. 65.244  → folga de 3.414 bytes
  tabela corrente ... 51 linhas · 14.206 bytes · média 278,5 bytes/linha
  linha 79 .......... 362 bytes
  ponteiro .......... 278 bytes (3 linhas)
  arquivo histórico . 23 linhas · 4.821 bytes
```

**Para quantas fases dá:** `2.970 / 278,5 = 10,7` → **≈ 10 fases** na média real da tabela
corrente; na faixa de 300–400 bytes/linha, **7,4 a 9,9** → **≈ 8 a 10 fases**.

### 6.2 A prova conjunta — nenhuma linha se perdeu (8/8)

Script: extrai as linhas `| NN |` de **HEAD**, da **árvore de antes** e dos **dois arquivos
de depois**, e compara **conjunto a conjunto** (e o texto, linha por linha).

```text
══════════════════════════════════════════════════════════════════════
 FASE 79 · A PROVA — nenhuma linha da tabela da §9 se perdeu
══════════════════════════════════════════════════════════════════════
  ANTES  (HEAD) ............. 71 linhas | fases ≤ 25: 23
  ANTES  (árvore) ........... 73 linhas | fases ≤ 25: 23 | fases > 25: 50
  DEPOIS (AGENTS.md) ........ 51 linhas | fases ≤ 25: 0 | fases > 25: 51
  DEPOIS (histórico) ........ 23 linhas | fases: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11A, 11B, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25

1) O arquivo histórico recebeu as fases ≤ 25 do estado anterior
  [OK  ] conjunto de fases ≤ 25 (árvore) == conjunto do histórico — conjuntos idênticos
  [OK  ] conjunto de fases ≤ 25 (HEAD) também está todo no histórico — conjuntos idênticos

2) O AGENTS.md não guardou NENHUMA fase ≤ 25 como linha de tabela
  [OK  ] fases ≤ 25 na tabela do AGENTS.md: nenhuma — nenhuma

3) As fases > 25 continuam TODAS no AGENTS.md
  [OK  ] conjunto de fases > 25 (árvore) == conjunto do AGENTS.md (menos a 79 nova) — conjuntos idênticos
  [OK  ] a fase 79 entrou na tabela corrente — linha presente

4) O arquivo histórico não contaminou o presente
  [OK  ] fases > 25 no arquivo histórico: nenhuma — nenhuma

5) O TEXTO foi movido como estava (byte a byte, linha por linha)
  [OK  ] as 23 linhas do histórico são idênticas às da árvore de antes — 23/23 idênticas
  [OK  ] as linhas correntes não foram reescritas — nenhuma divergência

──────────────────────────────────────────────────────────────────────
 RESULTADO: 8/8 verificações passaram.
──────────────────────────────────────────────────────────────────────
```

> Nota de leitura: `HEAD` é o estado **versionado** (o da pergunta), e ele é anterior à F78 —
> por isso mostra 71 linhas e a árvore mostra 73 (as linhas 77 e 78 já estavam na árvore,
> não versionadas). A comparação **canônica** é contra a árvore de antes, que é o "como estão
> hoje" do pedido; a de `HEAD` confirma que nada do bloco histórico se perdeu em relação ao
> que estava commitado.

### 6.3 O diff do `AGENTS.md` — só as 4 mudanças esperadas

```text
$ git diff --no-index --numstat <árvore de antes> AGENTS.md
9       27      AGENTS.md
```

```diff
@@ §1  (3 linhas de contagem)
- Fases concluídas ........ 1 a 17, 21 a 25, **29 a 78** (**F56 a F78 entregues**)
- Testes ................. **4384** (Vitest: unit + integração, 245 arquivos) + ...
- ADRs ................... 374 (numeração GLOBAL e sequencial — a próxima é ADR-375)
+ Fases concluídas ........ 1 a 17, 21 a 25, **29 a 79** (**F56 a F79 entregues**)
+ Testes ................. **4389** (Vitest: unit + integração, 246 arquivos) + ...
+ ADRs ................... 375 (numeração GLOBAL e sequencial — a próxima é ADR-376)

@@ §4  (1 linha de contagem)
- npm test              # esperado: 4384 testes passando (245 arquivos)
+ npm test              # esperado: 4389 testes passando (246 arquivos)

@@ §9  (o ponteiro, 3 linhas + a linha em branco)
+ > As fases **1 a 25** não estão mais nesta tabela: na **FASE 79** elas foram movidas **como
+ > estavam** para [`docs/fases-historico.md`](docs/fases-historico.md) — o registro completo de
+ > cada uma segue em `docs/fase-NN-*.md` e no `README.md`. A tabela abaixo é a corrente.

@@ §9  (as 23 linhas movidas — 0 contextos, 23 remoções)
- | 1 | … | ✅ |
- …
- | 22 | … | ✅ |

@@ §9  (a linha nova, no fim da tabela)
+ | 79 | **O `AGENTS.md` volta a respirar** — … ADR-375 | ✅ |
```

O diff anterior a esta edição (contra `HEAD`) mostra também as mudanças **já existentes na
árvore**, da F77 e da F78 (linhas 77 e 78, contagens, a linha 76 condensada e a §10) — elas
**não** são desta fase.

A prova de que **nada mais** mudou é por seção: o hash de cada `## N.` antes × depois.

```text
IGUAL  cabeçalho · §2 · §3 · §5 · §6 · §7 · §8 · §10   (byte a byte)
MUDOU  §1 (3 linhas de contagem) · §4 (1 linha) · §9 (as 23 movidas, o ponteiro e a linha 79)
```

Os cinco trechos do diff, na íntegra: `§1` (3−/3+), `§4` (1−/1+), o ponteiro (0−/4+), as 23
linhas (23−/0+) e a linha 79 (0−/1+) — nada fora deles.

### 6.4 A catraca nova — 5 casos verdes

```text
$ npx vitest run tests/unit/f79-fases-no-arquivo-certo.test.ts
 ✓ tests/unit/f79-fases-no-arquivo-certo.test.ts (5 tests) 10ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### 6.5 A catraca morde — com `| 12 | … | ✅ |` plantado no `AGENTS.md`

```text
 ❯ tests/unit/f79-fases-no-arquivo-certo.test.ts (5 tests | 2 failed) 14ms
 FAIL  … > não há fase ≤ 25 como linha de tabela no AGENTS.md
 AssertionError: estas fases voltaram para a tabela da §9; o lugar delas é o histórico:
 expected [ '12' ] to deeply equal []
 FAIL  … > todas as fases > 25 estão na tabela corrente do AGENTS.md
 AssertionError: linha de fase que a catraca não conhece (declare-a em FASES_CORRENTES):
 expected [ '12' ] to deeply equal []
      Tests  2 failed | 3 passed (5)
```

Desfeito em seguida — **hash idêntico** ao de antes da mutação
(`C840532C…C114207A6`), e o teste voltou a **5/5**.

### 6.6 Qualidade

```text
$ npm run typecheck
  (sem saída = 0 erros)

$ npm run lint
  (sem saída = 0 erros, 0 warnings)
```

**Não** foram rodados `npm test` completo nem E2E: **nada de produção mudou** (0 arquivos em
`src/**`, 0 migrações, 0 rotas). O número da §4 (`4389`, 246 arquivos) é **calculado**:
4.384 + os 5 casos do arquivo novo — e não medido pela suíte inteira, pelo escopo declarado.

---

## 7. Comandos operacionais

```powershell
# O tamanho é a régua do teto — confira SEMPRE depois de mexer no estado
(Get-Item AGENTS.md).Length            # 61830

# A catraca do lugar das fases (5 casos)
npx vitest run tests/unit/f79-fases-no-arquivo-certo.test.ts

# Onde está cada fase: as ≤ 25 no histórico, as > 25 na tabela corrente
Select-String -Path AGENTS.md -Pattern '^\| (?:[0-9]+[A-Z]?) \|'
Select-String -Path docs/fases-historico.md -Pattern '^\| (?:[0-9]+[A-Z]?) \|'

# A prova conjunta (reproduzível): extrai `| NN |` e compara antes × depois.
# O "antes" é um retrato do arquivo anterior ao movimento (aqui, o HEAD):
#   git show HEAD:AGENTS.md > "$env:TEMP\agentes-antes.md"
node -e "const fs=require('fs');const f=p=>[...fs.readFileSync(p,'utf8').matchAll(/^\|\s*(\d+[A-Z]?)\s*\|/gm)].map(m=>m[1]);const n=f=>parseInt(f,10);const antes=f(process.argv[1]),ag=f(process.argv[2]),hi=f(process.argv[3]);const h=antes.filter(x=>n(x)<=25),c=antes.filter(x=>n(x)>25);console.log({historicasNoHistorico:h.every(x=>hi.includes(x))&&hi.length===h.length,nenhumaHistoricaNoAgents:!ag.some(x=>n(x)<=25),correntesNoAgents:c.every(x=>ag.includes(x)),nenhumaCorrenteNoHistorico:!hi.some(x=>n(x)>25)})" "$env:TEMP\agentes-antes.md" AGENTS.md docs/fases-historico.md
```

---

## 8. Dívidas técnicas e pontos de atenção

A fase não abriu código nem débito de produto; a única dívida que ela **declarou** é a **I8**
(a segunda cópia das contagens), registrada ao fim desta seção. O que fica **registrado como
ponto de atenção**:

1. **A §2 ainda descreve a condensação como remédio do teto.** Ficou byte a byte por escopo
   declarado. A regra que a F79 inaugurou é outra (mover, não condensar), e a §2 deve ser
   atualizada pela próxima fase que puder tocar o arquivo.
2. **A §10 ainda aponta `docs/fase-78-topo-unico.md` como a última fase entregue.** Também
   ficou byte a byte por escopo. O documento desta fase (e o índice do `README.md`) já
   existem; a §10 é que não foi atualizada.
3. **A folga é de ~10 fases, não infinita.** Quando as fases 29–35 também envelhecerem, a
   mesma cirurgia se aplica a elas (ou a tabela se divide por década). O movimento de hoje
   comprou ~10 fases; não resolveu o teto para sempre.
4. **O `README.md` diz "365 decisões" no rodapé do índice** e o projeto está em **375**. É
   anterior a esta fase e não foi tocado (o escopo do `README.md` era **uma linha**).
5. **O número de testes da §1/§4 (`4389`) é calculado**, não medido pela suíte completa —
   rodar `npm test` ficou fora do escopo declarado da fase.

> **Fechado na sequência da F79:** as três incoerências dos itens **1, 2 e 4** (a §2, a §10 e
> o "365 decisões") foram corrigidas logo depois, junto com os três pontos do `README.md` —
> "Estado", contagem de testes e índice. O registro acima fica como o momento em que foram
> abertas.

> **Dívida declarada na sequência — I8 (a segunda cópia das contagens).** O `README.md`
> repete à mão as contagens que o `AGENTS.md` já é dono, e a evidência desta fase é a
> aritmética: **cinco números** estavam desatualizados **num único arquivo** — a faixa de
> fases ("29 a 78" quando o estado é **29 a 79**), o par de testes ("4384"/"245", que são
> **4389**/**246** — os 5 casos e o arquivo da catraca nova —, repetido no bloco de
> comandos), as decisões ("365", que são **375**), as armadilhas ("97", que são **106**) e
> os templates ("8 templates"/"vinte e duas", que são **23**). O que a dívida **não** é:
> "atualizar mais um número". É **eliminar a segunda cópia** — enquanto o `README.md`
> mantiver a mesma contagem escrita à mão em paralelo ao `AGENTS.md`, cada fase vai
> atualizar uma fonte com mais cuidado que a outra e a divergência volta. Registrada como
> **I8** em `docs/dividas-tecnicas.md`.

---

## 9. Checklist de aceite

- [x] `docs/fases-historico.md` criado com as linhas da §9 cujos números de fase são **≤ 25**
      — **23 linhas**, na ordem **cronológica** da tabela (21 e 22 depois da 25).
- [x] As linhas foram **movidas como estavam** (texto exato, inclusive as reticências ` … `
      das condensações) — provado **23/23 idênticas**, byte a byte.
- [x] O arquivo novo começa com um **cabeçalho curto**: o que é, por que saiu do `AGENTS.md`
      (FASE 79, teto), onde vive o registro completo (`docs/fase-NN-*.md` e `README.md`) e
      onde está a tabela corrente (§9 do `AGENTS.md`).
- [x] No `AGENTS.md`, **ponteiro de 3 linhas** no lugar das linhas movidas, com o link para o
      arquivo novo.
- [x] A nota **"numeração de tema, não de ordem"** foi preservada (intocada, no fim da §9).
- [x] **Linha 79** acrescentada no fim da tabela da §9.
- [x] `§1` e `§4` atualizados **só nas contagens** que a fase exige (4 linhas: fases, testes,
      ADRs e o `npm test`) — §2, §3, §5, §6, §7, §8 e §10 **byte a byte**.
- [x] `README.md` ganhou **uma linha** no índice da documentação.
- [x] `docs/fase-79-o-agents-que-respira.md` com **9 seções** e **ADR-375** (o registro não se
      apaga, muda de arquivo; o teto é estrutura, não redação; a linha nova entra porque o
      movimento abriu espaço).
- [x] **Prova conjunta antes/depois**: 8/8 verificações, com a saída neste documento.
- [x] **Diff do `AGENTS.md`** só com as 4 mudanças esperadas (9 inserções / 27 remoções).
- [x] **Tamanho final medido**: 61.830 bytes · folga de 2.970 (teto) / 3.414 (corte) ·
      ≈ 8–10 fases.
- [x] **Links**: `docs/fases-historico.md` existe; o ponteiro do `AGENTS.md` aponta para ele;
      as 23 fases históricas têm `docs/fase-NN-*.md` (verificado pela catraca).
- [x] Catraca em `tests/unit/f79-fases-no-arquivo-certo.test.ts`: **5/5 verdes** e **morde**
      (2 vermelhos com `| 12 |` plantado; desfeito com hash idêntico).
- [x] `npm run typecheck` **0** e `npm run lint` **0/0**.
- [x] **Nada** em `src/**`, `globals.css`, `playwright.config.ts` ou `docs/fase-NN-*.md`.
- [x] `npm test` completo e E2E **não** rodados — nada de produção mudou.
