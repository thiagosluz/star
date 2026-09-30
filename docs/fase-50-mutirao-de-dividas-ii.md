# FASE 50 — Mutirão de dívidas II: correção, acessibilidade e alcance

> Segunda edição do mutirão (a primeira foi a FASE 12, com oito dívidas rápidas). Esta
> entrega pega **onze dívidas** em dois blocos escolhidos pelo humano: **correção e
> confiabilidade** (o que estava errado de verdade) e **acessibilidade e operação sem
> JavaScript** (o que excluía gente). Os Blocos 3 e 4 — alcance rápido e o fechamento da
> FASE 49 — ficaram para a fase seguinte, já autorizados.

---

## 1. Sumário executivo

### 1.1 As onze dívidas quitadas

| Dívida | O que era | O que ficou |
|---|---|---|
| **C7** | Remover alguém da equipe tirava **junto** o acesso de participante (o vínculo é uma linha por instituição × pessoa) | Ação **"Converter em participante"**: sai da equipe, perde todos os papéis e **mantém** inscrições, certificados e cartas |
| **E71** | A suíte de credenciamento dependia da **ordem** dos testes: rodar um caso com `-t` falhava com `Cannot read properties of null` | A fixture pertence ao `describe` que a usa (`ensureEventCredentials`); **6 casos rodam isolados** e o arquivo inteiro segue verde |
| **E53** | A contagem que congela a rubrica da **trilha** incluía pareceres de submissões que avaliam pela rubrica da **chamada** | A contagem olha a rubrica **EFETIVA** (`rubricIsCustom`, a mesma pergunta da precedência) — na gravação e na lista |
| **E59** | Cancelar a inscrição **não devolvia** os 30 XP da vaga | Estorno no livro-razão (lançamento negativo, origem `REGISTRATION_REVERTED`), idempotente, e **reinscrever paga de novo** (a vaga voltou) |
| **E49** | O prazo de confirmação podia vencer **depois** de a atividade começar | O prazo tem **teto no início da atividade** (e nunca é anterior à inscrição) |
| **E26** | A integridade do upload conferia só o **tamanho**: o `PUT` assinado não levava checksum | O `x-amz-checksum-sha256` entra **assinado** no PUT: o storage calcula, recusa corpo divergente e devolve o valor na inspeção |
| **E50** | O clique na ação em linha "antes do bundle" não virava requisição | Medido e documentado: **sem JavaScript funciona** (catraca no E2E); a janela do meio ficou como **E76**, com o número medido |
| **E51** | O quadro de demandas só reordenava **com o mouse** | **Alt + ↑/↓** reordena dentro da coluna, com o foco de volta no cartão e anúncio em região viva |
| **E55** | O palco do editor de certificado só movia com ponteiro | **Setas = 1 mm · Shift+setas = 10 mm**, com a régua de posição unificada no domínio (o arrastar passou a usá-la) |
| **H5** | Não havia teste de acessibilidade | `@axe-core/playwright` com portão **WCAG AA** em 6 telas, isenção **por nó** e catraca de isenções (≤ 2) |
| **E52** | O quadro de demandas trazia **todas** as demandas do evento | Teto por coluna (50, ajustável na URL) com aviso **"mostrando N de M"** e link **"Ver mais"** que preserva os filtros |

### 1.2 Números da fase

| | |
|---|---|
| Arquivos novos | **8** — 6 de código, 1 de teste unitário, 1 documento (fora os specs de E2E) |
| Arquivos modificados | **24** (código, testes e configuração) |
| Migrações | **47 → 48** (origem `REGISTRATION_REVERTED` no enum de XP) |
| Tabelas de tenant | **57** (nenhuma nova) |
| Testes novos | **+39** — 24 unitários, 13 de integração e 2 E2E desta fase (mais os 14 unitários e 12 E2E do teclado, e os 7 do portão de acessibilidade) |
| ADRs | **274 a 279** |
| Dívidas | **11 quitadas**; **3 declaradas** (E74 contraste do token de aviso, E75 `<main>` duplicado, E76 ação em linha antes do bundle) |
| Defeitos reais encontrados | **5** — ver §5 |

---

## 2. O problema mais difícil da fase

**Cancelar não devolvia nada — e não deixava voltar.** A dívida E59 dizia que o XP da
inscrição não era estornado. Ao escrever o teste que inscreve, cancela e se inscreve de
novo, apareceu o segundo defeito, maior: a **checagem da aplicação recusava qualquer
linha existente** de inscrição (inclusive `CANCELED`), enquanto o **índice único parcial
do banco** já permitia uma linha nova. Ou seja: o banco tinha sido desenhado para
permitir a volta (a migração da FASE 3 diz, com todas as letras, que a unicidade global
"impedia reinscrição após cancelar"), e a aplicação bloqueava.

O efeito prático era pior do que "não ganhar XP": quem tinha a vaga liberada pelo
**prazo da FASE 34** — cancelamento automático, sem culpa da pessoa — ficava **banido
daquela atividade para sempre**, e a mensagem ainda dizia "você já está inscrito".

A correção é uma função de domínio, `registrationIsLive(status)`, que é a **mesma
pergunta** que o índice parcial faz (`WHERE status IN ('PENDING','CONFIRMED','WAITLISTED','ATTENDED')`).
Aplicação e banco não podem mais divergir — e é isso que o teste prende.

O estorno veio depois, e com uma decisão de desenho: o livro-razão é **append-only**
(é o que permite auditar saldo), então devolver XP é **lançar um negativo**, não apagar o
crédito. E a chave do estorno é derivada da chave do **crédito**
(`<crédito>:reversal`), o que resolve os dois casos de uma vez: cancelar duas vezes não
estorna duas vezes, e quem volta depois de cancelar recebe uma **geração nova** de
crédito (`<base>:retry:<n>`).

---

## 3. Decisões técnicas

### 3.1 O checksum tem de ser do STORAGE (E26)

O caminho óbvio era gravar `x-amz-meta-sha256` no PUT assinado e comparar esse metadado
na confirmação. **É uma armadilha**: o metadado é o que o *cliente* escreveu, então a
comparação seria "declaração do cliente × declaração do cliente" — passaria sempre, e
ainda **esconderia** a conferência por tamanho que existia antes. Seria pior que não
conferir, porque fingiria conferir.

O que verifica é o checksum do storage (`x-amz-checksum-sha256`): o MinIO calcula o
SHA-256 do corpo recebido, **recusa** o PUT quando não casa (`BadDigest`) e grava o valor
calculado no objeto. A confirmação compara o declarado com o **calculado** — dois lados
independentes.

E aí veio a segunda descoberta: o objeto passa a carregar o checksum, mas o `HeadObject`
**só devolve** valores de checksum quando a leitura pede por eles (`x-amz-checksum-mode:
ENABLED`). Sem isso, a correção ficaria invisível — e o teste desta fase foi quem pegou.

### 3.2 Teclado é a terceira porta (E51, E55)

O arrastar é atalho; o formulário é o caminho sem JavaScript; o **teclado** é a porta de
quem não usa ponteiro. Nos dois casos o acorde escolhido foi o que **não conflita** com o
que já existe: no quadro, `Alt + ↑/↓` (a seta sozinha rola a página e é usada pelo
`<select>` que vive dentro do cartão); no palco, setas de 1 mm e `Shift`+setas de 10 mm.

Nos dois, a regra de posição passou a ser **uma só**: o arrastar do palco (que tinha dois
`clamp` inline) usa agora `nudgeElementPosition`/`clampElementPosition` do domínio, e o
teclado usa a mesma conta — ponteiro e teclado não podem divergir.

### 3.3 O portão de acessibilidade mede, não decora (H5)

`@axe-core/playwright` com as tags do **WCAG AA** (2.0, 2.1 e 2.2), reprovando impacto
`critical`/`serious`. `best-practice` fica **fora** do portão (recomendação não é
requisito), e a isenção é **por nó**, nunca `disableRules` amplo — com um teste afirmando
que a lista de isenções continua ≤ 2.

Um achado real: o **token de aviso** (`text-warning-strong` sobre `bg-warning-soft`) dá
**2,89:1** (AA pede 4,5:1) no painel claro — e **4,15:1** sobre a superfície escura do
telão. Ou seja: **não existe valor único** que sirva às duas superfícies; escurecer para o
painel derruba o telão a 1,9:1. A correção é separar o token em ~40 pontos e revisar a
paleta documentada — virou a dívida **E74**, com os números medidos.

A varredura também é **determinística**: `reducedMotion: 'reduce'` + corte de transições
(para o axe não ler cor no meio de uma animação) e uma espera de **quiescência do DOM**
(`MutationObserver` com 120 ms de silêncio), que elimina a corrida que fazia a mesma tela
passar três vezes e falhar na quarta sob carga.

### 3.4 A janela de cartões diz o que escondeu (E52)

Um teto silencioso seria pior que a lentidão: quem organiza concluiria que a demanda
sumiu. A coluna truncada mostra **"mostrando N de M"** e o link **"Ver mais"** — que é um
parâmetro de URL, então funciona sem JavaScript —, preservando os filtros da tela (perder
o filtro ao pedir mais mostraria outra lista, e a pessoa acharia que o quadro mudou
sozinho).

---

## 4. ADRs

### ADR-274 — Sair da equipe e continuar participante são atos diferentes

**Contexto.** O vínculo com a instituição é UMA linha por (instituição, pessoa) e `kind`
separa EQUIPE de PÚBLICO. Remover gravava `status = REMOVED`, e o acesso de participante
ia junto: quem tinha inscrição e certificado perdia a própria área.

**Decisão.** `demoteMemberToParticipant` muda `kind` para `PARTICIPANT`, **mantém**
`status = ACTIVE`, revoga **todas** as concessões (instituição, evento e atividade) e
libera a vaga da quota. As travas são as mesmas da remoção (`evaluateMemberRemoval`):
não a si mesmo, não ao último proprietário.

**Consequências.** A tela de equipe passa a oferecer duas saídas, e a menos destrutiva vem
primeiro. Trocar a trava aqui abriria a porta que a FASE 21 fechou — por isso a decisão é
do domínio, não da tela.

### ADR-275 — O estorno de XP é um lançamento, e a chave dele é do crédito

**Contexto.** Ver §2.

**Decisão.** O livro-razão continua **append-only**: o estorno é uma linha negativa com
origem própria (`REGISTRATION_REVERTED`) e valor igual ao crédito estornado (não uma
constante — se o valor da inscrição mudar, o estorno acompanha). A chave é
`<chave do crédito>:reversal`, e o próximo crédito usa uma geração nova.

**Consequências.** Cancelar duas vezes não estorna duas vezes; reinscrever depois de
cancelar paga de novo (a vaga voltou a ser usada); o extrato conta a história inteira. O
saldo nunca fica negativo — se o XP já tiver sido consumido por um ajuste, o estorno
devolve o que existe e registra o valor REAL.

### ADR-276 — A regra de "inscrição viva" é a mesma do índice do banco

**Contexto.** O índice único parcial do banco define uma inscrição viva por (atividade,
pessoa) com quatro estados. A aplicação tinha a sua própria noção — e mais restritiva.

**Decisão.** `registrationIsLive(status)` no domínio, com o comentário apontando a
migração e o índice. A checagem da aplicação usa **só** ela.

**Consequências.** `CANCELED` e `NO_SHOW` passam a ser histórico, não bloqueio: quem
cancelou (ou perdeu a vaga pelo prazo) pode voltar. É o que faz o estorno da E59 ter
sentido — devolver o XP e impedir a volta seria o pior dos dois mundos.

### ADR-277 — O checksum assinado é o do STORAGE

**Contexto.** Ver §3.1.

**Decisão.** `createUploadUrl` aceita o SHA-256 declarado e o inclui como
`x-amz-checksum-sha256` **assinado** (em `signableHeaders`); a inspeção lê com
`ChecksumMode: 'ENABLED'`. Metadado próprio (`x-amz-meta-*`) fica **fora** da verificação
— seria tautologia —, mas continua sendo lido para não perder o checksum de objeto antigo.

**Consequências.** Corpo diferente do hash assinado é recusado pelo PRÓPRIO storage
(`BadDigest`), e a confirmação compara declarado × calculado. Os quatro fluxos de upload
(submissão, mídia, foto do palestrante e foto de perfil) passaram a declarar o hash no
pedido.

### ADR-278 — O prazo de confirmação tem teto no início da atividade

**Contexto.** O organizador escolhia "5 dias" e quem se inscrevia no último dia ficava com
prazo **depois** de a atividade começar: a vaga seguia retida por uma confirmação que já
não servia para ninguém.

**Decisão.** `confirmationDueAt` recebe `notAfter` e devolve o **menor** entre o prazo
calculado e o início da atividade; nunca antes da própria inscrição (quem entra numa
atividade já começada recebe o prazo na hora).

**Consequências.** O teto é TETO, não substituição — devolver o `notAfter` direto
**esticaria** o prazo de quem tem janela curta (o defeito apareceu no primeiro teste da
regra).

### ADR-279 — A coluna truncada se anuncia

**Contexto.** O quadro trazia todas as demandas do evento numa consulta.

**Decisão.** Teto por coluna (padrão 50, ajustável por `?cartoes=` até 500) e aviso
"mostrando N de M" com link que reabre o quadro com mais, **preservando os filtros**.

**Consequências.** O `totalCards` é a verdade e `cards` é a janela: a tela compara os
dois, e é o único jeito de o aviso não mentir.

---

## 5. Lições aprendidas — os defeitos REAIS da fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | **Quem cancelava nunca mais se inscrevia** na atividade ("você já está inscrito" com a linha `CANCELED`) | A checagem da aplicação aceitava **qualquer** linha existente; o índice único parcial do banco só considera vivas as de quatro estados | `registrationIsLive` no domínio, usando a **mesma** definição do índice (ADR-276) |
| 2 | O upload "conferia" o hash e **nunca** falhava por conteúdo | O metadado `x-amz-meta-sha256` é a declaração do cliente: comparar com ele é tautologia | Checksum **do storage** assinado no PUT, com `BadDigest` recusando corpo divergente (ADR-277) |
| 3 | A inspeção devolvia `checksum: null` mesmo com o objeto carregando o checksum | `HeadObject` exige `ChecksumMode: 'ENABLED'` para devolver valores de checksum | `ChecksumMode` na inspeção (o teste desta fase pegou) |
| 4 | O prazo de 1 dia virava **outubro** quando o teto era outubro | O teto estava implementado como substituição, não como mínimo | `min(calculado, teto)`, com o caso no teste unitário (ADR-278) |
| 5 | A suíte inteira passou a falhar em `gamification-facts` depois da origem nova de XP | A origem do estorno entrou em `XP_SOURCE_KINDS` e ficou FORA das listas que fecham a união (missão × aposentada) — o teste existente exigia que toda origem estivesse em uma delas | Terceira categoria explícita `NON_MISSION_XP_SOURCE_KINDS`, com o porquê: tem emissor (o cancelamento) e **não pode** virar gatilho de missão |

### Defeitos de TESTE (quatro, e nenhum era do produto)

| Sintoma | Causa raiz | Correção |
|---|---|---|
| A varredura de acessibilidade reprovava uma tela e passava nas outras duas | O axe lê a cor **computada**: no meio de uma transição/animação o valor é do instante (corrida, agravada sob carga) | `reducedMotion: 'reduce'` + transições desligadas + espera de quiescência do DOM |
| `rowCount`/`totalXp` com o valor errado no primeiro caso novo | A fixture não criava o que o caso lia (itens do checklist; a **vaga única** já ocupada por outro caso do arquivo) | A fixture do caso passou a ser dele: `createMany` dos itens e a oficina de 10 vagas |
| O E2E do quadro não achava coluna com dois cartões | O caso dependia do que os casos anteriores deixaram criado (o mesmo vício da **E71**) | O caso cria os próprios cartões, direto no banco (é fixture, não comportamento sob teste) |
| `expect(page.locator('[data-testid^=…]'))` não achava o botão depois de resolver o item | A asserção procurava um botão que **deixa de existir** quando o item é resolvido (a lista é dos pendentes) | A asserção passou a medir o **estado no banco** (`itemStatus`), que é o fato |

---

## 6. Evidência de verificação

```text
npm run lint ....................... 0 erros, 0 warnings
npm run typecheck .................. 0 erros
npm test ........................... 112 arquivos · 2475 testes passando
npm run build ...................... ✓ Compiled successfully
npm run db:verify .................. Contrato íntegro.
npm run db:verify:isolation ........ 9/9 verificações passaram.
npm run db:partitions .............. todas as partições do intervalo já existiam
npx prisma migrate status .......... 48 migrations · Database schema is up to date!
npm run db:seed .................... ✓ (ufba-demo e fiocruz-demo)
docker compose --profile app up -d --build web worker   ✓ (imagem "43 seconds ago")
npm run test:e2e ................... 177 passed · 1 skipped   (o skipped é o fixme da E76)
```

> **Os 2475 e os 177 são os números REAIS desta árvore**, medidos depois da última
> alteração de código — não os esperados. O `skipped` é deliberado: é o caso da dívida E76,
> que MEDE a janela que ainda não está fechada, e está marcado `fixme` com o motivo escrito.

---

## 7. Comandos operacionais

```bash
# A conversão de acesso (equipe → participante), pela tela:
#   /t/<slug>/administracao/equipe → linha da pessoa → "Converter em participante"

# Conferir quem tem histórico vivo e quem só tem histórico (E59/C7):
psql "$DATABASE_URL" -c 'SELECT status, count(*) FROM registrations GROUP BY status ORDER BY 2 DESC'

# O estorno no extrato de XP de uma pessoa:
psql "$DATABASE_URL" -c 'SELECT source, amount, reason, "createdAt" FROM xp_transactions WHERE source = '"'"'REGISTRATION_REVERTED'"'"' ORDER BY "createdAt" DESC LIMIT 20'

# O portão de acessibilidade (telas públicas e autenticadas):
npx playwright test tests/e2e/accessibility.spec.ts

# A janela do quadro de demandas (ajustável na URL):
#   /t/<slug>/administracao/eventos/<eventId>/demandas?cartoes=100
```

---

## 8. Dívidas técnicas e pontos de atenção

**Quitadas nesta fase:** C7, E26, E49, E50 (metade medida), E51, E52, E53, E55, E59, E71, H5.

**Declaradas:**

| Dívida | O que falta | Por que não entrou |
|---|---|---|
| **E74** | **O token de aviso não passa no contraste AA no painel claro.** Medido: `#d97706` sobre `#fff2e4` = **2,89:1** (e 2,59:1 sob `opacity-90`); o MESMO token sobre a superfície escura do telão dá 4,15:1, e escurecer para 6,4:1 derruba o telão a 1,9:1 | Não existe valor único: exige **separar o token** (claro × escuro) em ~40 pontos e revisar a paleta documentada — é trabalho de sistema de design, com a tela de design junto |
| **E75** | **Dois landmarks `<main>` por página** (a casca e cada página) | É `best-practice`/moderate (o portão AA não reprova), mas quebra `locator('main')` no modo estrito; corrigir exige decidir qual lado perde o landmark e mexe em todas as telas autenticadas |
| **E76** | **A ação em linha antes do bundle**: com JavaScript ligado e o bundle ainda carregando, o React intercepta o `submit` para reexecutá-lo depois da hidratação — e sem hidratação não há reexecução. Medido: sem JavaScript o mesmo formulário **funciona**; nessa janela o item fica `PENDING`, sem erro e sem log | As duas saídas conhecidas (formulário com `action` de URL de verdade, ou caminho duplo React/nativo) mexem em **todas** as telas de operação; ficou com a medição no E2E (`test.fixme` documentado) |

**Pontos de atenção:**

* O **livro-razão de XP é append-only**: nunca apagar lançamento para "corrigir" saldo —
  usar estorno, com origem e motivo;
* o **teto do prazo de confirmação é `min`**, nunca substituição;
* a **janela da coluna** tem a verdade em `totalCards`: qualquer tela nova que a use
  precisa comparar os dois, senão esconde cartão em silêncio;
* o **portão de acessibilidade** isenta por NÓ: acrescentar isenção ampla desliga a
  catraca que existe justamente para isso.

---

## 9. Checklist de aceite

- [x] **C7** — sair da equipe preserva o acesso de participante, com ação, tela, trilha e teste
- [x] **E71** — os casos do credenciamento rodam **isolados** (`-t`) e o arquivo inteiro segue verde
- [x] **E53** — o congelamento da trilha conta só quem avalia por ela (na gravação **e** na lista)
- [x] **E59** — cancelar devolve o XP (lançamento negativo, idempotente) e reinscrever paga de novo
- [x] **E59 (defeito)** — quem cancelou pode voltar a se inscrever (`registrationIsLive`)
- [x] **E49** — o prazo de confirmação não passa do início da atividade e nunca é anterior à inscrição
- [x] **E26** — o checksum assinado é do storage; corpo divergente é recusado pelo próprio MinIO
- [x] **E50** — medido: sem JavaScript a ação em linha vira POST (catraca no E2E); a janela do meio virou **E76** com o número
- [x] **E51** — o quadro reordena **dentro da coluna** por teclado, com anúncio e foco preservado
- [x] **E55** — o palco do certificado move por teclado, com a régua de posição unificada no domínio
- [x] **H5** — portão WCAG AA em 6 telas, isenção por nó, catraca de isenções e varredura determinística
- [x] **E52** — teto por coluna com aviso "mostrando N de M" e link "Ver mais" que preserva filtros
- [x] `docs/dividas-tecnicas.md` com as 11 quites e as 3 novas
- [x] `README.md` e `AGENTS.md` atualizados (números, capacidade, índice e armadilhas 102–103)
- [x] Bateria da seção 4 do `AGENTS.md` verde, com números reais
