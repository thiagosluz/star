# FASE 82 — A porta de entrada: o destino de quem entra é uma decisão, e a porta de volta

> **Tema:** todo fluxo de autenticação (cadastro, login, segundo fator e as próprias telas
> de entrada) terminava num `redirect` **incondicional** para `/selecionar-instituicao` — e a
> tela do seletor não tinha caminho para o painel. **ADR-378 e ADR-379.**
> **Plano:** `docs/fase-82-plano.md` (medido antes de escrever código).
> **Base:** a vitrine deixou de redirecionar na FASE 75; o `redirectTo` do login já estava
> morto antes desta fase começar.

---

## 1. Sumário executivo

| Entrega | Onde | Prova |
|---|---|---|
| A **regra pura** `resolveEntryDestination`, com cinco degraus de precedência | `src/domain/platform/entry-destination-rules.ts` (novo) | **52 casos** em `f82-destino-de-entrada.test.ts` |
| O **adaptador** que apura os três fatos (vínculos, plataforma, `redirectTo`) sem derrubar o login | `src/lib/auth/entry-destination.ts` (novo) | **10 casos** com dublês, sem banco |
| Os **cinco destinos** ligados: cadastro, login, segundo fator, `/login` e `/signup` | `src/app/actions/auth-actions.ts`, `src/app/login/**`, `src/app/signup/**` | E2E 1–4, no navegador |
| O **`redirectTo` do login**, que estava morto, voltou a valer **antes** do branch de `tenantSlug` | `signInAction` | unit: a regra **nem é consultada** quando o destino é válido |
| O **link do seletor** nos três ramos ("Ir ao painel da instituição" / "Explorar eventos") | `src/app/selecionar-instituicao/page.tsx` | E2E 5–7 |
| A **porta de volta do superadmin**: o layout de `/superadmin` passa `memberships` ao `AccountBlock` | `src/app/superadmin/layout.tsx`, `account-block.tsx`, `tenant-menu.tsx` | E2E 8 |
| `/eventos` no portão WCAG — que **achou e corrigiu** `select-name` nos três filtros | `src/app/(public)/eventos/page.tsx`, `tests/e2e/accessibility.spec.ts` | portão **40/40**, isenção vazia |
| As **duas dívidas da fatia 1** pagas, com catraca contra a volta | `platform-nav-rules.ts`, `active-membership.ts` (novos) | catracas de fonte (4 + 2 casos) |

**Números da fase**

```text
Arquivos de código .............. 15 (4 novos de domínio/aplicação + 11 alterados)
Testes novos .................... 62 no Vitest (2 arquivos) + 9 no E2E (8 + 1 do portão)
Vitest .......................... 4457 em 249 arquivos (eram 4395 em 247) — 0 vermelhos
E2E ............................. 479 (470 + 9) — 478 passando + 1 skip, ZERO vermelhos (12,2 min)
Migrações ....................... 0
ADRs ............................ 2 (ADR-378, ADR-379) — a próxima é a 380
```

---

## 2. O problema mais difícil: **qual pergunta vem primeiro**

O destino de quem entra parecia um detalhe de uma linha (`redirect('/selecionar-instituicao')`).
Não era. O diagnóstico medido no plano (`docs/fase-82-plano.md`) mostrou **três sintomas e duas
causas**: (a) o destino era uma **constante**, sem um único branch de decisão; (b) o link do
rodapé do seletor apontava para `/` **literal**, que desde a FASE 75 é a vitrine e não redireciona
ninguém.

O que fez a fase ser difícil não foi escrever a função: foi decidir **a ordem das perguntas**.
Cada ordem errada produz um defeito **silencioso** — a página abre, ninguém vê erro, e a pessoa
cai no lugar errado:

- **`redirectTo` em último** (como o pedido original supunha): quem veio de uma atividade perde o
  contexto. A `registration-journey:475-519` existe exatamente para garantir "voltei para a
  atividade onde eu estava"; e quem entra por convite ou por chamada de proposta também não pode
  perder o destino;
- **plataforma depois do vínculo**: o SuperAdmin pode pertencer a instituições, e o painel de
  governança **não tem link a partir da área da instituição** — o operador só o alcança digitando
  a URL. Mandá-lo ao painel de uma instituição é esconder a casa dele;
- **convite depois da descoberta**: quem não tem vínculo mas foi convidado precisa da tela do
  convite, que é `auth-tenancy:340-364` quem prova; mandá-lo a `/eventos` esconderia a única tela
  capaz de resolver o vínculo dele;
- **a plataforma em qualquer lugar** custa uma consulta **administrativa** por render. Colocá-la
  no `getRequestContext()` pagaria esse preço em **toda página autenticada** do produto para
  melhorar o destino de uma tela.

Ou seja: a fase **não** é "um `if` a mais no redirect". É uma regra de domínio com precedência
declarada e um adaptador que só a chama na **entrada** — as duas decisões que os ADR-378 e
ADR-379 registram.

---

## 3. Decisões técnicas

### 3.1 A precedência, e por que `redirectTo` é **override** (não fallback)

| # | Pergunta | Destino | Por que nesta posição |
|---|---|---|---|
| 1 | Há `redirectTo` **válido**? | o próprio destino (com query e hash) | é a **única** resposta que a pessoa escolheu — vence inclusive o SuperAdmin |
| 2 | É operador de plataforma? | `PLATFORM_HOME_PATH` (`/superadmin/metricas`) | a governança é a casa dele, e não há link para lá a partir da instituição |
| 3 | Tem vínculo `ACTIVE`? | `tenantDashboardPath(slug)` | o destino de sempre da maioria, e o MESMO caminho do CTA "Minha área" |
| 4 | Só convite pendente? | `SELECT_INSTITUTION_PATH` | é onde o convite aparece e pode ser aceito |
| 5 | Nada disso | `ENTRY_DISCOVERY_PATH` (`/eventos`) | público, entrega descoberta **e** inscrição — e a inscrição cria o vínculo que falta |

O `redirectTo` era tratado como "fallback" no pedido; a casa prova o contrário. Por isso ele é o
**primeiro** degrau e a regra preserva a string **original** (com `?busca=ana&pagina=2` ou
`#programacao`): é para isso que ela foi gravada. O `signUpAction` continua com o branch rápido de
destino (evita pagar duas leituras para quem já sabe para onde vai), e a equivalência é **total**
porque os dois lados chamam a mesma `isSafeEntryRedirect`.

### 3.2 O flag de plataforma **não** entra no `getRequestContext()`

A tentação era colocar "é SuperAdmin?" no contexto e deixar a casca decidir. Seria uma consulta
administrativa por render de **toda página autenticada** — o preço de um painel que quase ninguém
abre. O contexto responde "onde estou e o que posso AQUI"; o operador de plataforma é um fato da
**entrada**. O adaptador `resolveEntryDestinationForUser` é chamado **só** pelo fluxo de entrada, e
nenhum layout o importa — a catraca de fonte prende isso (`f82-destino-de-entrada.test.ts`, bloco
"catraca do render normal", 3 casos).

### 3.3 Uma só validação: `isSafeEntryRedirect`, e as **14 recusas**

A checagem estava escrita à mão em **quatro portas de entrada** (`signUpAction`, `signInAction`,
`/login` e `/signup`) — e, nas **duas camadas** de `/login/dois-fatores`, só a **metade** dela
(`startsWith('/')`), que é justamente a metade que aceita `//evil.test`.

Agora há **uma** função pura, com a lista de recusas **tabelada em teste**:

| Recusa | O que fecha |
|---|---|
| vazio / não-string | ausência, não destino |
| qualquer branco (espaço, tab, quebra de linha) | valor que não foi pensado como caminho |
| não começa com `/` | `https://…` e `javascript:…` são outro sítio/esquema |
| começa com `//` | URL relativa a protocolo: outro **host** (open redirect clássico) |
| começa com `/\` | a barra invertida vira `/` no navegador e o valor vira `//` |
| contém `://` | endereço absoluto dentro da query não tem caso de uso |
| aponta para `/login` ou `/signup` (por **pathname**) | voltar ao formulário que a pessoa acabou de preencher é laço |

São **14 casos** na matriz (`https://`, `//`, `/\`, `javascript:`, vazio, espaços, espaço no meio,
quebra de linha, sem barra inicial, `://` na query, `/login`, `/signup`, `/login?redirectTo=…`,
`/login/dois-fatores`), e o teste do login repete **6** deles para provar que a action recusa antes
de consultar a regra.

### 3.4 A porta de volta: **onde** ela mora e **quanto** custa

O beco medido no plano não estava no pedido: **não existia link para `/superadmin` a partir da área
da instituição**, e o shell da plataforma montava o `AccountBlock` **sem `memberships`** — o valor
ausente apagava o menu de conta inteiro. Quem entrava direto em `/superadmin` ficava sem `/conta` e
sem caminho de volta: só "sair" ou digitar a URL.

A porta saiu de onde ela **já existe em todas as telas**: o bloco de conta. Três mudanças pequenas,
e uma delas é um contrato novo:

1. o layout de `/superadmin` lê os vínculos e passa `memberships` ao `AccountBlock`;
2. `AccountBlock` distingue **ausente** (esta casca não tem contexto de instituição, não desenhe o
   menu) de **array, mesmo vazio** (a casca sabe quais são os vínculos — desenhe as portas globais);
3. `TenantMenu` aceita `currentSlug` **opcional**: sem slug, **todas** as linhas ativas viram botão,
   inclusive quando há **um só** vínculo — é o caminho direto de volta para `/t/<slug>/dashboard`,
   pelo mesmo `switchTenantAction` de sempre.

**O custo, medido e dito sem eufemismo:** é **uma execução a mais do leitor canônico de vínculos**
(`loadMemberships`, **uma** consulta) **no layout de `/superadmin`, uma por render, e só para quem é
operador**. Não é "consulta zero", e o texto desta fase não diz isso em lugar nenhum. O que **não**
se paga é o caminho inverso (§8.1), que custaria uma consulta administrativa em **toda** página da
instituição.

### 3.5 O rótulo diz o destino

"Página inicial" era falso duas vezes: em produto, "página inicial" é `/`; e o link levava
exatamente para `/`, a vitrine — que não redireciona desde a F75. O rótulo passou a nomear o que o
link faz ("Ir ao painel da instituição"), e o href vem de `tenantDashboardPath` (nunca
`/dashboard` cru, que responde 404 sem host de instituição — `proxy.ts`). No ramo sem vínculo, o
rótulo é "Explorar eventos": o nome que a tela de destino usa, e o convite a **fazer** algo dali.

### 3.6 `/eventos` no portão — e o `select-name` que a mudança de **papel** expôs

`/eventos` não estava no portão `axe` porque era só a vitrine de descoberta. Quando ela passou a ser
a **tela de entrada** de quem não tem vínculo (degrau 5), entrou no portão — e o `axe` reprovou os
**três** filtros (categoria, modalidade e período) com `select-name` (**crítico**): o leitor de tela
anunciava "caixa de combinação" sem dizer de quê. A correção foi `aria-label` nos três, sem mudar um
pixel — e a isenção do portão continuou **vazia**.

A lição não é "faltou `aria-label`": é que a **cobertura veio porque a tela mudou de papel**. É a
mesma forma do defeito da FASE 66 (o rótulo que ficou fora do portão) e da FASE 70 (a página de
inscrição fora do `axe`).

### 3.7 O que a fase **não** fez, de propósito

A porta **inversa** (o link "Painel da plataforma" dentro da área da instituição) não foi entregue:
ela exige saber "esta pessoa é operadora?" no render de **toda** página da instituição, e isso é a
consulta administrativa que o §3.2 recusa. O custo está medido no §8.1, com o número.

---

## 4. ADRs

### ADR-378 — O destino de quem entra é uma decisão com precedência, e `redirectTo` é **override**

**Contexto.** Três portas de entrada (cadastro, login e segundo fator) e duas telas de entrada
(`/login` e `/signup`, para quem já tem sessão) terminavam em `redirect('/selecionar-instituicao')`
— sem nenhuma pergunta sobre quem entrou. Efeitos medidos: o SuperAdmin caía no seletor e ficava
sem porta de volta; quem não tinha vínculo caía numa tela que só oferecia "Sair da conta"; o
`redirectTo` do login estava **morto** (só era lido dentro do branch de `tenantSlug`, prop que
nenhuma tela envia); e `/login/dois-fatores` aceitava `//evil.test` porque a checagem era
`startsWith('/')` sem a segunda metade.

**Decisão.** O destino é uma **função pura de domínio** (`resolveEntryDestination`), com a ordem
declarada no §3.1, e um adaptador (`resolveEntryDestinationForUser`) que apura os fatos apenas no
fluxo de entrada. `redirectTo` válido vence **todas** as perguntas, inclusive o operador de
plataforma. A validação de destino é **uma só** (`isSafeEntryRedirect`), com as 14 recusas testadas.

**Justificativa.** "Para onde eu vou" tem uma resposta que o **usuário escolheu** (o `redirectTo`) e
outras que o sistema **deriva** (plataforma, vínculo, convite). Uma função pura com a ordem presa em
teste é a única forma de as cinco portas concordarem — e de o defeito ser uma asserção em vez de uma
tela errada. As alternativas descartadas: (a) cinco `if`s copiados nas portas (divergem no primeiro
ajuste — a casa já pagou essa conta na cópia do `pickActiveMembership`); (b) `redirectTo` em último
(quebra a volta para a atividade, `registration-journey:475-519`); (c) o flag de plataforma dentro
de `getRequestContext()` (consulta administrativa por render de toda página); (d) validar com
`startsWith('/') && !startsWith('//')` espalhado (é o que aceitava `/\evil.test` e `/login`).

**Consequências.** (1) O login nunca falha por causa do destino: falha de leitura de plataforma vira
"não é operador", com `try/catch` no adaptador — o pior caso é um SuperAdmin cair na instituição e
chegar à governança pela URL. (2) O `redirectTo` volta a valer sem `tenantSlug`; o branch antigo
continua na árvore e está declarado no §8.3. (3) A matriz unitária (52 casos) roda sem banco, sem
cookie e sem Next. (4) Quem chama precisa do `userId` — por isso as actions passaram a extrair o id
da resposta da biblioteca com `userIdFromAuthResult`, sem `any`.

### ADR-379 — A porta de volta mora no bloco de conta, e o flag de plataforma fica **fora** do render comum

**Contexto.** O painel de plataforma é o único lugar do produto que um operador alcança **digitando
a URL**: não há link a partir da área da instituição. E o shell de `/superadmin` montava o
`AccountBlock` sem `memberships`, o que apagava o menu inteiro — nem `/conta`, nem a instituição.
Era um beco fechando outro beco.

**Decisão.** O bloco de conta é a porta: o layout de `/superadmin` lê os vínculos (com o leitor que
já existe, `loadMemberships`) e os passa; `AccountBlock` passa a distinguir **ausente** de **array
vazio**; `TenantMenu` aceita `currentSlug` **opcional** e, sem slug, lista **todos** os vínculos como
botão (inclusive quando há um só). O caminho **inverso** — link para a plataforma dentro da
instituição — **não** é entregue nesta fase: exigiria o flag de plataforma no render de toda página
da instituição.

**Justificativa.** O bloco de conta é o único elemento que existe em **todas** as telas: é onde uma
porta de saída/volta pertence. A leitura extra acontece no **layout de uma árvore só** (a da
plataforma), **uma vez por render**, e **só para operador** — que é um público pequeno e já pagou a
consulta de `requirePlatformPermission` na mesma requisição. A alternativa recusada é a simétrica e
cara: levar `PLATFORM_MANAGE` ao `getRequestContext()` para desenhar um item de menu na área da
instituição custaria **uma consulta administrativa a `role_assignments` com `tenant_id IS NULL` por
render de toda página da instituição** — o preço de um link.

**Consequências.** (1) O custo declarado é **uma execução a mais do leitor canônico de vínculos por
render de página de plataforma, só para operador** — não "nenhuma consulta". (2) `ausente ≠ vazio`
virou contrato do `AccountBlock`, e o menu de plataforma passou a existir mesmo com zero vínculos
(a frase "Sua conta ainda não está vinculada a nenhuma instituição" substitui "Você tem acesso a
apenas esta instituição", que seria falsa). (3) A catraca de fonte prende o caminho: nenhum layout
importa o adaptador de entrada, e `getRequestContext()` não carrega `loadPlatformPrincipal`.

---

## 5. Lições aprendidas

> Só o que aconteceu: cada linha é um defeito medido, com a correção e a prova.

| # | Sintoma | Causa raiz | Correção | Prova |
|---|---|---|---|---|
| 1 | **O "Página inicial" ia para a vitrine** — e com **um** vínculo a linha do seletor é um `<span>` "Contexto atual", então a tela **não tinha nenhum caminho para o painel** | o link era `href="/"` **literal**; `/` deixou de redirecionar na F75 e virou a vitrine. O rótulo mentia no nome **e** no endereço | o link passou a `tenantDashboardPath(activeTenant.tenantSlug)` e o rótulo a "Ir ao painel da instituição"; no ramo sem vínculo, `/eventos` com "Explorar eventos" | E2E 5–7 + a imagem da fase (rodapé antes × depois) |
| 2 | **O `redirectTo` do login estava MORTO** | o branch que o aplicava dependia de `tenantSlug`, e **nenhuma tela envia essa prop** ao `AuthForm` — o `if` da linha antiga nunca rodava | o destino válido passou a vencer **antes** do branch de `tenantSlug`; o destino voltou a valer **sem a prop** | unit: `signInAction` com destino válido redireciona para ele e a **regra nem é consultada** (`expect(estado.regra).not.toHaveBeenCalled()`) |
| 3 | **`//evil.test` aceito na página de dois fatores** | a checagem `startsWith('/') && !startsWith('//')` estava **escrita à mão em 4 portas** — e nas duas camadas do 2FA só a metade dela, que é a que aceita `//` | **uma** função (`isSafeEntryRedirect`) com **14 recusas tabeladas**, usada nas duas camadas (página e action) | 14 casos de recusa na matriz + 6 no teste do login; o valor viaja na URL e é revalidado na action |
| 4 | **O portão `axe` achou `select-name` (crítico) nos três filtros de `/eventos`** — no mesmo dia em que a tela virou a porta de entrada | a tela estava **fora** do portão enquanto era só vitrine; a cobertura veio **porque** a tela mudou de papel | `aria-label` nos três `<select>`, sem mudar um pixel e sem isenção nova | portão **40/40** (era 39), com o caso novo afirmando formulário, cartão e controle de tema antes de varrer |
| 5 | **As duas dívidas da fatia 1**: o domínio importava de `src/components`, e `pickActiveMembership` existia **duas vezes** | a fatia 1 pegou o caminho de `/superadmin` de `PLATFORM_CRUMB` (componente) e copiou as seis linhas do vínculo ativo para o adaptador | o caminho virou `PLATFORM_HOME_PATH` no domínio (e o componente passou a importá-lo); o critério do vínculo ativo virou `pickActiveMembership`, consumido pelos **dois** lados | catracas de fonte: 4 casos (domínio puro, sem `/superadmin`, sem `@/components`, trilha = regra) + 2 casos (os dois lados consomem o helper e **nenhum** repete `membership.status === 'ACTIVE'`) |
| 6 | **"A porta de volta não custa consulta"** — a frase fácil, e falsa | o layout de `/superadmin` **lê os vínculos** para montar o menu; chamar isso de "nenhuma consulta" seria maquiar o custo | o texto (aqui e no §3.4) diz o fato: **uma execução a mais do leitor canônico de vínculos no layout de `/superadmin`, uma por render, só para operador** | leitura do código + a catraca que impede o flag de plataforma no render de toda página |

Três lições de método, que não são defeito de produto:

- **O plano mediu antes de escrever.** O beco do superadmin (§3.4) e o link do seletor não estavam no
  pedido; apareceram na leitura do código, e o desenho das fatias 2 e 3 saiu deles.
- **A dívida da fatia 1 foi paga dentro da fase** em vez de virar item novo no levantamento: eram
  duas cópias que podiam divergir em silêncio, e a catraca que as prende custou menos que uma linha
  no `docs/dividas-tecnicas.md`.
- **A catraca do vínculo ativo não mordia — e foi a MUTAÇÃO que mostrou.** Ela procurava a string
  `membership.status === 'ACTIVE'` e, no arquivo mutado, o `import` de `pickActiveMembership`
  continuava lá: a cópia com outro nome de variável (`m.status === 'ACTIVE'`) passava com **52/52
  verdes**. A catraca passou a prender o **critério** (`status === 'ACTIVE'`, sem o nome da
  variável) e a **chamada** (`pickActiveMembership(`), e a mesma mutação reprovou (**1 failed | 51
  passed**, §6.4). Catraca que não é exercitada por uma mutação é decoração.

---

## 6. Evidência de verificação

### 6.1 A bateria

```text
npm run lint ........................ 0 erros, 0 avisos
npm run typecheck ................... 0 erros
npm test ............................ 249 arquivos, 4457 testes, 0 vermelhos (189,36 s)
npm run build ....................... "✓ Compiled successfully in 14.1s" (18 páginas estáticas, exit 0)
npm run db:verify ................... "Contrato íntegro."
npm run db:verify:isolation ......... "9/9 verificações passaram."
npm run db:partitions ............... mês atual e os seguintes criados (127.090 linhas)
```

### 6.2 Os testes novos, por arquivo

```text
tests/unit/f82-destino-de-entrada.test.ts ....... 52 passed
  · a regra e os cinco degraus ..................  8
  · `redirectTo` é override .....................  4
  · as 14 recusas ............................... 16
  · o validador sozinho .........................  3
  · o adaptador com dublês ...................... 12
  · catracas de fonte (domínio, vínculo, render)  9
tests/unit/f82-login-honra-redirect.test.ts ..... 10 passed
tests/e2e/f82-porta-de-entrada.spec.ts ..........  8 passed
```

### 6.3 O E2E inteiro

```text
npm run test:e2e -- --output %TEMP%\f82-e2e-out
  479 testes em 12,2 min: **478 passed + 1 skipped, ZERO failed**

  por spec, o que a fase toca:
    tests/e2e/f82-porta-de-entrada.spec.ts .......  8 passed
    tests/e2e/accessibility.spec.ts .............. 40 passed   (era 39)
    tests/e2e/f60-landmark.spec.ts ............... 16 passed
    tests/e2e/f62-regressao-visual.spec.ts ....... 23 passed
```

O que a suíte inteira mede, além dos números: o caso 4 do spec da porta passa pelo formulário
**sem `tenantSlug`** — é exatamente a condição que fazia o destino ser ignorado antes; o caso 5
afirma que a linha do seletor **não tem** botão "Entrar" (é `<span>` "Contexto atual") antes de
clicar no link do rodapé, porque é isso que faz do rodapé o **único** caminho; e o caso 8 abre
`/superadmin/metricas` com uma conta recém-promovida a operadora e navega pelo bloco de conta até
`/t/<slug>/dashboard`.

### 6.4 As catracas, provadas por mutação

```text
árvore íntegra               f82-destino-de-entrada.test.ts  52 passed

MUTAÇÃO 1  o domínio volta a importar de src/components:
           entry-destination-rules.ts passa a ler PLATFORM_CRUMB de '@/components/shell/tenant-nav'
MUTADA                       6 failed | 46 passed
                             · 5 de COMPORTAMENTO (o operador deixa de ir à governança:
                               importar a interface no domínio quebra a regra no ambiente puro)
                             · 1 catraca: "o destino da plataforma NÃO é um literal repetido"

MUTAÇÃO 2  a cópia do vínculo ativo volta para session.ts, com OUTRO nome de variável:
           `m.status === 'ACTIVE'` no lugar da chamada a `pickActiveMembership`
MUTADA (1ª)                  52 passed  ← a catraca NÃO mordeu
           a catraca procurava a string `membership.status === 'ACTIVE'`, e o `import` de
           `pickActiveMembership` continuou na árvore: o teste passava sem a chamada.
           A catraca foi CORRIGIDA para prender o CRITÉRIO (`status === 'ACTIVE'`, sem o nome
           da variável) e a CHAMADA (`pickActiveMembership(`) — não o `import`.
MUTADA (2ª)                  1 failed | 51 passed  ← agora morde

RESTAURADA                   62 passed (62) — f82-destino (52) + f82-login (10)
```

### 6.5 A imagem da fase

```text
docs/imagens/f82-porta-de-entrada.png ... o rodapé do seletor, antes × depois,
                                           capturado da tela real (spec temporário apagado)
```

Antes: `Página inicial` → `href="/"` (a vitrine). Depois: `Ir ao painel da instituição` →
`href="/t/<slug>/dashboard"`. O `href` de cada lado foi **lido do atributo** na captura, não escrito
à mão na legenda. A conta é a mesma nos dois lados: um vínculo `ACTIVE` (a linha do seletor é
`<span>` "Contexto atual").

---

## 7. Comandos operacionais

```bash
# a regra e o adaptador (sem banco, sem navegador)
npx vitest run tests/unit/f82-destino-de-entrada.test.ts
npx vitest run tests/unit/f82-login-honra-redirect.test.ts

# a porta de entrada no navegador (8 casos)
npx playwright test tests/e2e/f82-porta-de-entrada.spec.ts

# o portão WCAG (o caso novo é o de /eventos)
npx playwright test tests/e2e/accessibility.spec.ts

# a imagem da fase foi capturada por um spec TEMPORÁRIO (tmp-captura-f82.spec.ts),
# apagado depois de gerar docs/imagens/f82-porta-de-entrada.png; não há comando a repetir.
```

```text
Regra ......... src/domain/platform/entry-destination-rules.ts  (pura; não lê nada)
Adaptador ..... src/lib/auth/entry-destination.ts               (só na entrada)
Portas ........ signUpAction · signInAction · verifyTwoFactorLoginAction · /login · /signup
Porta de volta  /selecionar-instituicao (3 ramos) · bloco de conta de /superadmin
Destinos ...... /superadmin/metricas · /t/<slug>/dashboard · /selecionar-instituicao · /eventos
```

---

## 8. Dívidas técnicas e pontos de atenção

### 8.1 A porta inversa **não entregue** — com o custo medido

O link "Painel da plataforma" **dentro da área da instituição** não existe e **não** foi entregue
nesta fase. O custo de existir é conhecido e não é de desenho: desenhar o item exige saber, no
render de **toda** página da instituição, se a pessoa é operadora — e isso é uma **consulta
administrativa a `role_assignments` com `tenant_id IS NULL` por render** (a leitura que
`loadPlatformPrincipal` faz), o oposto da decisão do ADR-379, que manteve o flag **fora** do caminho
comum. Fechar isso exige uma decisão de arquitetura (cache de plataforma por sessão, cookie de
plataforma assinado, ou um item que só apareça quando a pessoa já está na governança) — é fase
própria, não um link.

### 8.2 `/selecionar-instituicao` **fora** do portão `axe` e da tabela do `f60-landmark`

A tela do seletor **não** entrou no portão WCAG nem na tabela de landmark (`f60-landmark.spec.ts`,
17 caminhos de instituição). A fase vizinha (`/eventos`) entrou porque mudou de **papel**; o seletor
também mudou de papel (é a tela do convite e a única tela de quem tem só convite), e a mesma régua
recomendaria incluí-lo. Não foi feito nesta fase porque o escopo aprovado pedia `/eventos`, e a
declaração é o registro para a próxima passagem pelo portão — que deve incluir os **dois**.

### 8.3 O branch morto do `tenantSlug` continua na árvore

O `signInAction` ainda tem `if (tenantSlug) { …; redirect('/dashboard') }`. É **código morto hoje**
(nenhuma tela passa a prop) e ficou de pé de propósito, para não misturar remoção de caminho com a
fase que conserta o destino. **Se alguém passar a enviar `tenantSlug`**, esse branch volta a valer e
o `/dashboard` cru **não** está certo: sem host de instituição o proxy responde 404, e o destino
correto é `tenantDashboardPath(tenantSlug)`. Está declarado aqui para que a reativação não aconteça
por acidente.

### 8.4 As duas checagens ad-hoc que sobraram

`context-actions.ts:132` (redirect de troca de contexto) e `communication-actions.ts:377`
(`revalidatePath`) ainda escrevem `startsWith('/') && !startsWith('//')` à mão. Nenhuma das duas é
porta de **entrada**, e as duas têm contexto próprio (a primeira ancora em `tenantPath` logo abaixo;
a segunda valida um caminho de revalidação, não um destino de navegação) — por isso ficaram fora do
escopo. A régua para fechá-las é a mesma: **uma** função (`isSafeEntryRedirect`) e nenhuma cópia.

> Não confundir com `safeReturnTo` (`export-actions.ts:204`): aquela é outra regra — só caminho
> **interno da própria instituição** (`tenantPath(slug, '/')`), não a regra de entrada.

### 8.5 O gap honesto: **"pedir para entrar" não existe**

Não há `joinRequest` em `src/`. Quem não tem vínculo com uma instituição **não pode pedir** para
entrar: os caminhos reais são convite, `addTenantMember` pela plataforma, ou **inscrição pública** —
que já cria vínculo `ACTIVE` + papel `PARTICIPANT` automaticamente. Por isso `/eventos` entrega
**descoberta e inscrição**, e não uma solicitação de vínculo: é lacuna de **produto**, não de
navegação. O texto da tela diz isso ("Peça um convite ao organizador do evento…"), e a frase é
mantida de propósito até que exista um fluxo de pedido.

### 8.6 Dívida nova: **I9** — `sign-out` sem corpo responde 415 e não limpa a sessão

`POST /api/auth/sign-out` **sem corpo** responde **415** ("Content-Type is required") e **não limpa
cookie nenhum**. O padrão `post('/api/auth/sign-out', { headers: { origin } })` está em **77
arquivos de teste** (**99 chamadas**), e é um **no-op silencioso**: as specs continuam funcionando
porque o login seguinte sobrescreve o cookie de sessão. Medido nesta fase: só **3** chamadas mandam
corpo (a do spec novo, que confere o `response.ok()`, e duas que já existiam).

O defeito **não** é das specs que se sucedem no mesmo contexto: é de quem **precisa** de um visitante
de verdade depois do "sair" (foi o caso do E2E 4, que só passou com o corpo `{}`). O caminho é o
levantamento completo das 99 chamadas e a decisão entre (a) mandar corpo em todas e (b) trocar por um
helper único (`sairDaConta`) que **afirme** a resposta — a segunda é a que impede o próximo no-op.
**Código: I9.** A contagem do levantamento passa de **43 para 44**.

### 8.7 O CTA "Minha área" da vitrine continua com a regra dele

O plano pedia que o CTA da vitrine passasse a consultar `resolveEntryDestination`. **Não foi
feito**: `src/app/page.tsx` continua com `resolveVitrineAccountAction`, que manda quem tem sessão
e **nenhum** vínculo para `/selecionar-instituicao` — enquanto a entrada manda para `/eventos`.
Não há caminho quebrado (o seletor oferece "Explorar eventos", §3.5), mas são **duas decisões**
onde o plano queria uma só. Fechar é pequeno (o adaptador já apura os fatos no servidor), e ficou
fora para não reabrir, nesta fase, uma tela cuja linha de base visual a F81 acabou de medir.

---

## 9. Checklist de aceite

- [x] Uma **regra pura** de destino (`resolveEntryDestination`) com os cinco degraus, e um
      adaptador que só a chama na entrada
- [x] `redirectTo` válido vence **todos** os degraus (é override, não fallback), preservando query
      e hash
- [x] `redirectTo` inválido **não** desvia — 14 formas recusadas, tabeladas em teste
- [x] As cinco portas ligadas (cadastro, login, 2FA, `/login`, `/signup`)
- [x] O `redirectTo` do login **volta a valer sem `tenantSlug`** (provado por unit: a regra nem é
      consultada quando o destino é válido)
- [x] `/login/dois-fatores` **recusa** `//evil.test`, nas duas camadas
- [x] SuperAdmin entra e cai na **governança**; sem vínculo, a pessoa cai na **descoberta**
- [x] O link do seletor nomeia o destino nos **três ramos**, e o rodapé é caminho para o painel com
      **um** vínculo (quando a linha é `<span>`)
- [x] O **bloco de conta da plataforma** oferece `/conta` e a **volta à instituição**, inclusive com
      um vínculo só
- [x] `/eventos` no portão WCAG AA, com os três `select-name` corrigidos e **isenção vazia**
- [x] As **duas dívidas da fatia 1** pagas, com catraca contra a volta
- [x] `lint` 0/0 · `typecheck` 0 · `npm test` **4457** · `build` OK · `db:verify` contrato íntegro ·
      isolamento **9/9** · partições do mês e dos seguintes
- [x] E2E **inteiro** verde: **479 no total — 478 passando + 1 skip, zero vermelhos** (12,2 min);
      spec da porta **8/8**, portão **40/40**, `f60-landmark` **16/16**, `f62` **23/23**
- [x] `docs/imagens/f82-porta-de-entrada.png` (antes × depois do rodapé), com o spec temporário
      **apagado**
- [x] `AGENTS.md`, `README.md` e `docs/dividas-tecnicas.md` atualizados (contagens, linha 82, I9,
      §10)
