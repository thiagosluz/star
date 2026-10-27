# FASE 80 — O ESLint 10: a subida que não mudou uma linha de código

> **Fase de manutenção.** Nenhum arquivo de `src/**` foi tocado — e a prova é o
> `git status --porcelain`, que só lista `package.json` e `package-lock.json`. O
> ESLint subiu de **9.39.5** para **10.13.0** com a bateria inteira medida: **920
> arquivos lintados, 0 erros, 0 warnings**, `typecheck` 0, `build` 0, **4389 testes**
> verdes e `npm ci` limpo com o lock novo.

---

## 1. Sumário executivo

| Entrega | Arquivo | Números |
|---|---|---|
| ESLint 10.13.0 | `package.json` | **1 linha** (`^9.39.5` → `^10.13.0`) |
| Lockfile reconciliado | `package-lock.json` | 20 pacotes adicionados, 29 removidos, 17 alterados (779 linhas no diff) |
| Lint (antes × depois) | — | **920 → 920 arquivos** · **0/0 → 0/0** |
| Suíte inteira | — | **4389 testes em 246 arquivos**, 0 vermelhos (222,96 s) |
| Build | — | **"✓ Compiled successfully in 44s"**, 116 rotas |
| Banco | — | contrato íntegro · **9/9** isolamento · partições em dia |
| `npm ci` limpo | cópia em `%TEMP%` | **689 pacotes**, exit 0, e o lint depois **920/0/0** |
| Imagem | `eventflow/web:local` · `eventflow/worker:local` | **24/10/2026 13:42:53** · **13:43:01** |
| E2E | — | **470 no total: 463 passando + 1 skip + 6 vermelhos diagnosticados** (§6.6) |
| Documento + **ADR-376** | `docs/fase-80-eslint-10.md` | 9 seções |

**Números da fase:** 0 arquivos de código · 0 migrações · 0 testes novos · **1
dependência** (linha do `package.json`) · **0 mudanças em `src/**`**.

### O diff do `package.json`, em uma linha

```diff
-    "eslint": "^9.39.5",
+    "eslint": "^10.13.0",
```

**Nada mais.** `git diff --stat`:

```text
 package-lock.json | 779 ++++++++++++++++++++++--------------------------------
 package.json      |   2 +-
 2 files changed, 321 insertions(+), 460 deletions(-)
```

E `git status --porcelain`:

```text
 M package-lock.json
 M package.json
```

**Nenhum arquivo de `src/`** — nem `globals.css`, nem `playwright.config.ts`.
A saída acima foi capturada **logo após o `npm install`**, antes de qualquer edição
de documentação; `git status --porcelain -- src` continua **vazio** no estado final.

---

## 2. O problema mais difícil da fase

Não foi instalar o ESLint 10 — foi **decidir se era seguro**, porque a evidência
contrária está escrita no próprio `node_modules`: os três plugins que o
`eslint-config-next` carrega declaram peer **até `^9`**, e o npm emite três avisos
`ERESOLVE overriding peer dependency` em toda instalação.

A tentação é "resolver" o aviso: `overrides` no `package.json`, um
`peerDependenciesMeta` com `optional`, ou esperar os plugins. As três escondem o
fato em vez de registrá-lo. Um `overrides` faria o npm parar de avisar **sem**
tornar o plugin compatível; esperar deixaria o projeto num major do linter que o
próprio `eslint-config-next` já aceita (`peer eslint >=9.0.0`) por causa de três
plugins de terceiros que só declaram o intervalo antigo.

O que definiu o desenho foi **medir em vez de confiar no intervalo**: a regra do
projeto é reportar números reais, não esperados. A medição — 920 arquivos, 0/0,
`typecheck`, `build`, 4389 testes, `npm ci` e o E2E — é a única coisa que
transforma "o peer diz que não" em "o plugin roda". O aviso **fica**: ele é o
registro de que a compatibilidade é de comportamento, não de declaração, e o dia
em que um dos três quebrar é o dia em que o lint falha — que é quando tem de falhar.

O segundo problema foi o **E2E**: a suíte não fechou verde por motivos que **não
são o ESLint** (6 vermelhos: 3 de acessibilidade, 2 de imagem e 1 intermitente de
minuto; §6.6). Diagnosticar antes de declarar era parte do pedido — e o diagnóstico
mudou o que a fase pode afirmar.

---

## 3. Decisões técnicas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Subir para **`^10.13.0`**, o alvo medido | É a versão que passou na bateria inteira; o `^` preserva o costume do projeto | `^10.0.0` ou `latest` — obrigaria a remedir o que não foi medido |
| **Não** usar `overrides`/`peerDependenciesMeta` | O aviso é a evidência de que a compatibilidade é **medida**, não declarada; escondê-lo tiraria o único sinal do dia em que quebrar | Forçar o peer no `package.json` para "limpar" a saída do npm |
| **Não** tocar em `eslint.config.mjs` | O flat config já é o formato do ESLint 9/10 e não há `.eslintrc*` nem `eslint-env` a migrar | Rodar o codemod (não haveria o que migrar) |
| **Zero mudança em `src/**`** | O baseline provou 920/0/0 com o 10.13.0; qualquer edição seria ruído | "Aproveitar" para ajustar regra ou estilo |
| **Não** corrigir os 3 vermelhos de a11y do E2E | São um defeito **anterior** à fase, exposto pelo `axe-core` 4.14 (bump já commitado); a correção é em `src/**`, que o escopo proíbe | Corrigir `aria-label` por conta própria (escopo indevido) ou isentar a regra (esconderia violação real) |
| **Não** mexer em `eslint-config-next` | Ele é quem traz os três plugins; subir/forçar versão mudaria mais que o pedido | Atualizar o preset "junto" |

---

## 4. ADRs

### ADR-376 — O linter sobe major antes dos plugins, com o aviso à vista

**Contexto.** O `eslint` estava em `^9.39.5`. O `eslint-config-next@16.4.3` — o
preset do projeto — aceita `eslint >=9.0.0`, então o ESLint 10 é um alvo legítimo.
Mas três plugins que ele carrega ainda declaram peer **até `^9`**:

| Plugin | Versão instalada | Peer de `eslint` declarado |
|---|---|---|
| `eslint-plugin-import` | **2.32.0** | `^2 \|\| ^3 \|\| ^4 \|\| ^5 \|\| ^6 \|\| ^7.2.0 \|\| ^8 \|\| ^9` |
| `eslint-plugin-jsx-a11y` | **6.10.2** | `^3 \|\| ^4 \|\| ^5 \|\| ^6 \|\| ^7 \|\| ^8 \|\| ^9` |
| `eslint-plugin-react` | **7.37.5** | `^3 \|\| ^4 \|\| ^5 \|\| ^6 \|\| ^7 \|\| ^8 \|\| ^9.7` |

O npm resolve a árvore assim mesmo, com `eslint@10.13.0` no topo, e emite **três
avisos** (um por plugin). O aviso completo do `eslint-plugin-react`, transcrito do
`npm ci` da cópia limpa:

```text
npm warn ERESOLVE overriding peer dependency
npm warn While resolving: eslint-plugin-react@7.37.5
npm warn Found: eslint@10.13.0
npm warn node_modules/eslint
npm warn   dev eslint@"^10.13.0" from the root project
npm warn   10 more (@eslint-community/eslint-utils, ...)
npm warn
npm warn Could not resolve dependency:
npm warn peer eslint@"^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7" from eslint-plugin-react@7.37.5
npm warn node_modules/eslint-config-next/node_modules/eslint-plugin-react
npm warn   eslint-plugin-react@"^7.37.0" from eslint-config-next@16.4.3
npm warn   node_modules/eslint-config-next
npm warn
npm warn Conflicting peer dependency: eslint@9.39.5
npm warn node_modules/eslint
npm warn   peer eslint@"^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7" from eslint-plugin-react@7.37.5
npm warn   node_modules/eslint-config-next/node_modules/eslint-plugin-react
npm warn     eslint-plugin-react@"^7.37.0" from eslint-config-next@16.4.3
npm warn     node_modules/eslint-config-next
```

**Decisão.** Subir o `eslint` para `^10.13.0`, manter os três plugins nas versões
que o preset fixa, **não** mascarar o peer e **não** mudar uma linha de código. A
compatibilidade é afirmada pela bateria medida (920 arquivos/0/0, `tsc`, `build`,
4389 testes, `npm ci` e E2E), não pelo intervalo declarado.

**Justificativa.** O intervalo de peer é **declaração**, não contrato de execução:
ele diz até onde o mantenedor testou, e o plugin continua usando a API pública de
regras que o ESLint 10 mantém. Esconder o aviso com `overrides` trocaria um sinal
visível por uma compatibilidade presumida — e o dia em que um plugin quebrasse, o
sintoma seria uma regra que **deixa de disparar** (lint silenciosamente mais
frouxo), não um erro. Deixar o aviso tem o efeito oposto: ele aparece em todo
`npm install`, em todo `npm ci` e no build da imagem, e é o lembrete de que a
próxima subida de `eslint-config-next` precisa ser olhada.

**Consequências.**

- Toda instalação (e o build Docker) imprime **3 avisos ERESOLVE**; nenhum falha.
- Com `--strict-peer-deps`, o `npm ci` **falharia** — o projeto não usa essa flag,
  e o Dockerfile usa `npm ci --ignore-scripts --no-audit --no-fund`.
- O lock fixa `eslint@10.13.0`; voltar é reverter os dois arquivos e reinstalar (§7).
- O risco residual está escrito na §8: nada hoje; o dia em que um dos três quebrar
  será o lint que acusa, não o npm.

---

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção / leitura |
|---|---|---|
| `npm install` imprime três `ERESOLVE overriding peer dependency` **sem o detalhe** (nem "While resolving", nem o peer) | O npm 12.0.2 abrevia o aviso no caminho do `install`, mas o **`npm ci`** da cópia limpa imprime o bloco completo | Transcrever o bloco a partir do `npm ci` (§4) — o aviso é o mesmo, a saída é que é mais ou menos detalhada |
| `npm install --dry-run` falhou com `EALLOWREMOTE` ao buscar `@tailwindcss/oxide-wasm32-wasi` | O npm 12 recusa tarball opcional "remote" no `--dry-run`; não é falha do lock (o `install` real e o `ci` passaram) | Não usar `--dry-run` como prova; a prova é `npm ci` em cópia limpa |
| Os 3 vermelhos de a11y do E2E (`label-content-name-mismatch`) | O `axe-core` **4.13.0** marcava a regra como `experimental`; o **4.14.0** removeu a tag, e o `withTags([... wcag21a ...])` passou a executá-la. O bump `^4.13.0 → ^4.14.0` é do commit `f97fad0` (23/10 18:25), **anterior** à F80 — o último E2E verde foi medido antes dele | Diagnóstico na §6.6; a correção mínima (três `aria-label`) é em `src/**`, fora do escopo desta fase |
| O baseline e o depois dão **o mesmo número de arquivos** (920) | O ESLint 10 não mudou o conjunto de arquivos que o `ignores` do projeto cobre | A comparação de contagem é o que prova que nenhum arquivo deixou de ser lintado |
| `@types/node` local é 24.13.5, mas o Node da máquina é 26.2.0 | O tipo acompanha o **runtime do container** (`node:24-alpine`), não o Node de quem desenvolve | É exatamente o gatilho nº 1 da §8: só subir o tipo quando o runtime subir |

**Nenhum defeito de produto foi introduzido** — não havia regra nova do
`eslint:recommended` pegando código, e nenhum `eslint-disable` foi espalhado.

---

## 6. Evidência de verificação

### 6.1 A subida e os avisos

```text
$ npm install
npm warn ERESOLVE overriding peer dependency
npm warn ERESOLVE overriding peer dependency
npm warn ERESOLVE overriding peer dependency

added 20 packages, removed 29 packages, changed 17 packages, and audited 690 packages in 16s

184 packages are looking for funding
  run `npm fund` for details

1 moderate severity vulnerability
```

O `eslint` instalado: **10.13.0**. O `eslint-config-next`: **16.4.3**.

### 6.2 Lint — antes × depois

```text
# antes (eslint 9.39.5)
arquivos=920 erros=0 warnings=0

# depois (eslint 10.13.0)
eslint=10.13.0 arquivos=920 erros=0 warnings=0
```

`npm run lint` (o comando do script, `eslint .`) sai com **0** e não imprime
problema nenhum — o resumo acima vem do `--format json`, que conta os arquivos.

### 6.3 Typecheck, suíte e build

```text
$ npm run typecheck
(exit 0, sem saída = 0 erros)

$ npm test
 Test Files  246 passed (246)
      Tests  4389 passed (4389)
   Duration  222.96s

$ npm run build
 ✓ Compiled successfully in 44s
...
├ ƒ /t/[tenantSlug]/administracao/eventos/[eventId]/palestrantes
...
└ ƒ /verificacao

ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand
```

**116 rotas** listadas no bloco `Route (app)`, `exit=0`.

### 6.4 Banco

```text
$ npm run db:verify
  ✓  RLS habilitada + FORCE em todas as tabelas com tenantId
  ✓  Nenhuma tabela com RLS ficou sem policy
  ✓  Role "eventflow_app" sem superuser e sem BYPASSRLS
  ✓  GRANTs mínimos presentes, TRUNCATE ausente
  ✓  Tabela(s) de plataforma inalcançável(is) pela role "eventflow_app"
  Contrato íntegro.

$ npm run db:verify:isolation
  ✓  [A7] COUNT(*) agregado conta apenas o próprio tenant
  ✓  [A8] Contexto de tenant não vaza para a transação seguinte (SET LOCAL)
  ✓  [A9] Role de runtime não consegue desligar a RLS nem escalar privilégio
  9/9 verificações passaram.

$ npm run db:partitions
  (partições do mês corrente e dos seguintes criadas; total: 117963 linha(s))
  A retenção continua sendo decisão de negócio: esta manutenção CRIA e mantém,
  e nunca apaga.
```

### 6.5 `npm ci` numa cópia limpa (o comando do Dockerfile)

```text
$ npm ci --ignore-scripts --no-audit --no-fund      # em %TEMP%\eventflow-f80-ci
npm warn ERESOLVE overriding peer dependency        # ×3, um por plugin
added 689 packages in 56s
exit=0

$ npm run lint                                       # depois do ci
arquivos=920 erros=0 warnings=0
```

O `--ignore-scripts` é o do Dockerfile (o estágio `deps`); o lock é o mesmo que o
build usou. O `package-lock.json` novo **resolve por inteiro**. No build da imagem
o mesmo `npm ci` do estágio `deps` instalou **690 pacotes em 20 s** e imprimiu os
**três avisos ERESOLVE** de novo (6 no total, contando o estágio `deps-prod`).

### 6.6 E2E — a imagem, a contagem e os 6 vermelhos

```text
$ docker compose --profile app up -d --build web worker
 Image eventflow/web:local Built
 Image eventflow/worker:local Built
 Container eventflow-web Recreated
 Container eventflow-worker Recreated
 Container eventflow-web Started
 Container eventflow-worker Started
exit=0

$ docker images
eventflow/worker:local criada=2026-10-24 13:43:01 -0300
eventflow/web:local    criada=2026-10-24 13:42:53 -0300

$ docker compose ps web worker
eventflow-web      ... Up (healthy)   0.0.0.0:3000->3000/tcp
eventflow-worker   ... Up

$ Invoke-WebRequest http://localhost:3000   → 200

$ npx playwright test --output C:\...\Temp\f80-e2e-results
Running 470 tests using 1 worker
...
  6 failed
    [chromium] › tests\e2e\accessibility.spec.ts:1909:3 › a tela "minha agenda" não tem violação crítica
    [chromium] › tests\e2e\accessibility.spec.ts:1968:3 › a aba "Programação" não tem violação crítica
    [chromium] › tests\e2e\accessibility.spec.ts:2185:3 › o bloco de local com a sala online não tem violação crítica
    [chromium] › tests\e2e\f62-regressao-visual.spec.ts:2085:3 › 13. o rodapé público da raiz no claro
    [chromium] › tests\e2e\f62-regressao-visual.spec.ts:2105:3 › 14. o rodapé público da raiz no escuro
    [chromium] › tests\e2e\f65-exportacao.spec.ts:717:3 › a aba "Acontecendo agora"
  1 skipped
  463 passed (12.7m)
EXIT=1
```

**Os 3 vermelhos de acessibilidade, com o diagnóstico.** A MESMA regra —
`label-content-name-mismatch` — em **três `aria-label`** do mesmo componente de
exportação:

| `data-testid` | texto visível | `aria-label` | por que falha |
|---|---|---|---|
| `exportar-ics-atividade` | `Baixar .ics` | `Baixar o arquivo .ics desta atividade: <título>` | o visível não é subseqüência contígua do nome |
| `exportar-google-grade` | `Adicionar a próxima ao Google Calendar` | `Adicionar ao Google Calendar a próxima atividade: <título>` | idem |
| `exportar-ics-grade` | `Baixar a minha agenda (.ics)` | `Baixar o arquivo .ics da minha agenda em <evento>` | idem |

(A regra de Label in Name — WCAG 2.5.3 — exige que o texto visível esteja
**contido** no nome acessível. O link `exportar-google` da atividade passa: o
`aria-label` dele começa pelo texto visível. É um defeito real, anterior à F80.)

Por que ele aparece **agora** e não no último E2E verde: a regra existe desde
antes, mas o `axe-core` **4.13.0** a marcava com a tag **`experimental`** — e
`withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])` não inclui
experimental. O **4.14.0** removeu a tag:

```text
4.13.0  tags: [ 'cat.semantics', 'wcag21a', 'wcag253', ..., 'experimental' ]
4.14.0  tags: [ 'cat.semantics', 'wcag21a', 'wcag253', ... ]
```

E o bump `@axe-core/playwright ^4.13.0 → ^4.14.0` está no commit `f97fad0`
(23/10/2026 18:25) — **antes** desta fase; a última medição verde (F78) foi feita
antes dele (a F79 não rodou E2E, como o próprio documento dela registra). O ESLint
10 não tem relação com o DOM, com o `aria-label` ou com o `axe`.

**A correção mínima (três `aria-label`, não aplicada por escopo):** fazer o nome
acessível conter o texto visível — `Baixar .ics desta atividade: ${title}`,
`Adicionar a próxima ao Google Calendar: ${nextTitle}` e
`Baixar a minha agenda (.ics) de ${eventTitle}` — nas linhas **109, 164 e 176** de
`src/components/events/activity-export-links.tsx`. Como é `src/**`, a decisão é do
humano; a alternativa — isentar a regra no portão — esconderia uma violação real e
não foi feita.

**Os 2 vermelhos visuais, com o diagnóstico.** `f62-regressao-visual.spec.ts`,
testes 13 e 14 (rodapé público da raiz, claro e escuro):

```text
Error: expect(page).toHaveScreenshot(expected) failed
  Expected an image 1440px by 3334px, received 1440px by 3362px.
  226036 pixels (ratio 0.05 of all image pixels) are different.
```

A primeira linha diferente entre esperado e real é a **1488** — e nela o real
ainda está **magenta** (a máscara), enquanto o esperado já tem conteúdo: a seção
mascarada `featured-events-section` ficou **28 px mais alta**. Medido agora na
raiz: página **3362 px**, seção de destaques **742 px**. A máscara esconde os
**pixels**, não o **layout**: a seção lê o banco ("eventos em destaque" e "a força
da nossa rede em números") e o banco tem mais eventos do que quando a baseline foi
gerada (a suíte de integração do Vitest deixa fixture — 4.410 contas `@exemplo.test`
medidas pelo `e2e:clean`). O `npm test` roda antes do E2E nesta bateria. Não é o
ESLint, não é código novo: é fragilidade de fixture (família da **I3**), e o
snapshot exige `maxDiffPixelRatio: 0`.

**O 6º vermelho, o intermitente de minuto.** `f65-exportacao.spec.ts:717`:

```text
Expected substring: "24/10/2026, 13:31"
Received string:    "24/10/2026, 13:30 – 24/10/2026, 14:30"
```

A fixture criou a atividade há 20 min; o teste recalcula `Date.now() - 20 min`
**no momento da asserção** (linha 774). Se o minuto virou entre a criação e a
asserção, o rótulo da página (`13:30`) e a expectativa (`13:31`) divergem — é o
intermitente já registrado na §4 do `AGENTS.md`, não uma regressão.

> **Conseqüência para o aceite:** o E2E **não** fechou 469 + 1 como o esperado.
> Fechou **463 + 1 skip + 6 vermelhos** (3 de acessibilidade + 2 de imagem + 1 de
> minuto), e nenhum é desta fase. O item correspondente do checklist (§9) fica
> **aberto**.

---

## 7. Comandos operacionais

```powershell
# O número de arquivos lintados (o script `eslint .` não imprime contagem)
$raw = npx eslint . --format json; $f = $raw | ConvertFrom-Json
"arquivos=$($f.Count) erros=$(($f | Measure-Object errorCount -Sum).Sum) warnings=$(($f | Measure-Object warningCount -Sum).Sum)"

# Quem está segurando o peer (as três versões e os três intervalos)
npm ls eslint
node -e "const p=require('./node_modules/eslint-config-next/package.json'); console.log(p.version)"

# A prova do lock em cópia limpa (o comando do Dockerfile)
robocopy . $env:TEMP\eventflow-f80-ci /E /XD node_modules .next .git
cd $env:TEMP\eventflow-f80-ci; npm ci --ignore-scripts --no-audit --no-fund; npm run lint

# A imagem e o E2E com a saída FORA da árvore
docker compose --profile app up -d --build web worker
docker images | Select-String "eventflow/(web|worker)"
npx playwright test --output "$env:TEMP\f80-e2e-results"

# Rollback (duas linhas): dos dois arquivos, ou do commit
git checkout -- package.json package-lock.json; npm ci
# ou: git revert <commit-da-F80>
```

---

## 8. Dívidas técnicas e pontos de atenção

### Os três plugins e o risco declarado

Hoje **nada morde**: o lint roda 920 arquivos com 0/0 usando as regras dos três
plugins. O risco é de **silêncio**, não de erro: se um deles começar a usar uma
API que o ESLint 10 removeu (ou mudou), a regra pode **deixar de disparar** sem
falhar — e o `0/0` não distingue "não há violação" de "a regra não rodou". O aviso
`ERESOLVE` é o único sinal visível; ele some no dia em que os plugins publicarem
suporte ao 10, que é o dia de remedir. Com `--strict-peer-deps` o `npm ci`
**falha** — o Dockerfile não usa a flag, mas quem a use precisa saber.

### Os dois gatilhos das outras duas atualizações medidas

**Gatilho 1 — `@types/node` 26.** Só quando o **runtime** for Node 26: trocar
`node:24-alpine` por `node:26-alpine` nos **três estágios** do `Dockerfile`
(`deps`, `builder`, `runner` — e o `worker` herda), subir o `engines` para
`>=26` e alinhar o Node local. Hoje o tipo descreveria uma API que o container
**não tem** (o tipo é 24.13.5 e o container é `node:24-alpine`, mesmo com o Node
local em 26.2.0); e **Node 24 é LTS enquanto 26 é Current** — a escolha é
consciente, não um upgrade de dependência.

**Gatilho 2 — `typescript` 7.** Só depois de o `typescript-eslint` suportar (a
issue **#10940** está aberta) — ou **antes**, com o alias **side-by-side**
(`typescript: npm:@typescript/typescript6@^6.0.2` +
`@typescript/native: npm:typescript@^7.0.2`, e **remover `baseUrl`** do
`tsconfig.json`), aceitando que **o lint e o `next build` continuam no TS 6** e o
ganho medido (**22,1 s → 2,9 s**) fica **só no `npm run typecheck`**.

### O que mais fica registrado

- **Os 6 vermelhos do E2E** (§6.6) são a pendência de aceite: **3** de
  acessibilidade (correção de três `aria-label` em
  `src/components/events/activity-export-links.tsx`; o escopo proibia `src/**`),
  **2** de imagem (a seção mascarada cresce com o dado — a máscara não prende
  layout; a baseline precisa de re-base ou de altura fixa, decisão humana) e **1**
  intermitente de minuto no `f65` "Acontecendo agora" (a fixture cria a atividade há
  20 min, mas o teste recalcula `Date.now() - 20 min` na asserção — se o minuto
  virou, o rótulo mostra `13:30` e a asserção pede `13:31`; é o intermitente já
  registrado na §4 do `AGENTS.md`).
- **O aviso `ERESOLVE` é permanente enquanto durar o peer `^9`** — não é dívida
  nova, é o estado medido; está na ADR-376.
- **`fast-uri@3.1.8` (moderate)** é pré-existente (via `prisma@7.10.1` →
  `@prisma/dev` → `ajv`); **não** veio do ESLint 10 e não foi tocado.
- **A dívida I8 continua aberta:** o `README.md` repete contagens do `AGENTS.md`
  à mão. Esta fase atualizou as duas cópias e **não** resolveu a duplicação.
- **`npm install --dry-run` não é prova** neste ambiente (npm 12 recusa o tarball
  opcional `@tailwindcss/oxide-wasm32-wasi` com `EALLOWREMOTE`); a prova é o
  `npm ci`.

---

## 9. Checklist de aceite

- [x] `package.json`: **uma linha** — `eslint` de `^9.39.5` para `^10.13.0`.
- [x] **Nenhuma outra dependência** mudou no `package.json`.
- [x] `npm install` rodou (16 s, 20 adicionados/29 removidos/17 alterados) e os
      **3 avisos ERESOLVE** foram registrados.
- [x] `npm run lint`: **920 arquivos, 0 erros, 0 warnings** — o mesmo número do
      baseline.
- [x] `npm run typecheck`: **0**.
- [x] `npm test`: **4389 testes em 246 arquivos**, 0 vermelhos.
- [x] `npm run build`: **"Compiled successfully in 44s"**, 116 rotas.
- [x] `npm run db:verify`: **"Contrato íntegro."**
- [x] `npm run db:verify:isolation`: **"9/9 verificações passaram."**
- [x] `npm run db:partitions`: partições criadas, retenção intacta.
- [x] `npm ci` em cópia limpa com o lock novo: **689 pacotes, exit 0**; lint
      depois: **920/0/0**.
- [x] Imagem reconstruída e datada: **web 24/10 13:42:53**, **worker 24/10
      13:43:01**; containers healthy; raiz responde **200**.
- [ ] **E2E 470 = 469 + 1 skip**: medido **463 + 1 skip + 6 vermelhos** — 3 de
      `label-content-name-mismatch` (defeito anterior, exposto pelo `axe-core`
      4.14; correção de três `aria-label` em `src/**`, fora do escopo), 2 de
      imagem (a seção mascarada cresce com o dado) e 1 intermitente de minuto no
      `f65`. **Aberto para decisão do humano.**
- [x] **Nenhuma linha em `src/**`** (nem `globals.css`, nem
      `playwright.config.ts`): o `git status --porcelain` logo após o `npm install`
      só tinha os dois arquivos, e `git status --porcelain -- src` segue vazio.
- [x] `docs/fase-80-eslint-10.md` com **9 seções** e **ADR-376**.
- [x] Os **dois gatilhos** (`@types/node` 26 e `typescript` 7) escritos com as
      condições exatas.
- [x] `AGENTS.md`: linha **80** na §9, ADRs **376** (próxima **377**), §10
      apontando esta fase; **63.052 bytes** medidos (folga de **1.748** até o teto
      de 64.800 e **2.192** até o corte de 65.244).
- [x] `README.md`: narrativa e índice atualizados; contagens repetidas
      conferidas nos dois arquivos.
