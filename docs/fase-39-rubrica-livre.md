# FASE 39 — Rubrica com número livre de critérios

> **Escopo definido pelo humano**, com cinco decisões escolhidas antes do código: a rubrica
> **congela a partir do primeiro parecer** (com a contagem na recusa), teto de **12 critérios**
> (mínimo 1), **chave derivada do rótulo**, **acrescentar/remover funcionando sem JavaScript**, e
> a rubrica livre vindo junto com a **edição de trilha** (que não existia).

---

## 1. Sumário executivo

A rubrica de avaliação tinha **três critérios fixos** — nos dois lugares em que ela vive: a
trilha (a chamada de trabalhos) e a chamada de propostas. Nenhuma instituição avalia por
exatamente três critérios, e quem precisava de cinco improvisava: virava um critério com dois
assuntos dentro, ou os revisores combinavam no corredor o que fazer com o terceiro.

A fase abriu o número — e o trabalho de verdade não foi desenhar mais linhas. Foi descobrir que
**o motor já aceitava N critérios** (o domínio valida e calcula sobre a lista que receber;
as Actions leem `formData.getAll('rubricKey')`) e que **o número livre torna alcançável um
defeito que antes era improvável**: `computeWeightedScore` devolve `null` quando qualquer
critério está sem nota, e renormaliza pelo peso total. Acrescentar um critério a uma trilha já
avaliada **zeraria a nota de todos os pareceres enviados**; remover mudaria o significado das
notas dadas. E não há como reconstruir o passado: `Review.scores` é chaveado por critério e o
parecer **não guarda a rubrica com que foi dado**.

Daí o desenho da fase: número livre **enquanto ninguém avaliou**, forma imutável depois — e a
tela diz isso em vez de oferecer campos que o servidor recusaria.

### Entregas

| Entrega | Onde |
|---|---|
| Chave do critério derivada do rótulo (acento, símbolo, colisão, teto de 40) e o teto de 12 critérios validado no domínio | `src/domain/review/review-rules.ts` |
| Leitura das linhas do formulário em um lugar só: chave preservada na linha que já existe, derivada na nova, linha sem rótulo descartada | `src/domain/review/review-rules.ts` (`buildRubricFromRows`) |
| Comparação da FORMA (chave, peso, nota máxima) e o congelamento com a contagem de pareceres | `src/lib/review/rubric-guard.ts` |
| `saveTrack` e `saveCall` recusam a mudança de forma com `RUBRIC_FROZEN`, comparando contra a rubrica **em vigor** (CHAMADA → TRILHA → PADRÃO) | `src/lib/admin/catalog-service.ts`, `src/lib/proposals/call-service.ts` |
| Editor de rubrica único das duas telas: N linhas, soma dos pesos, acrescentar/remover e as linhas do teto disponíveis **sem JavaScript** | `src/components/admin/rubric-editor.tsx` |
| **Edição de trilha** pela tela (a lista ganhou "Editar trilha"), com a rubrica gravada carregada e o estado congelado | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/page.tsx` |
| A chamada de propostas passa a usar o mesmo editor e mostra o congelamento | `.../chamadas/page.tsx` |
| A consulta do evento devolve a rubrica, a descrição, a cor, o limite por autor e a cegueira de cada trilha (a edição precisa dos campos) | `src/lib/admin/catalog-service.ts` |
| Seed: a chamada de minicursos nasce com **5 critérios**, passando pelo `saveCall` da tela | `prisma/seed.ts` |
| Testes: **25** unitários, **12** de integração e **4** E2E (cinco critérios pela tela, sem JavaScript, trilha editável e a rubrica congelada) | `tests/unit/rubric-free.test.ts`, `tests/integration/rubric-freeze.test.ts`, `tests/e2e/rubric-criteria.spec.ts` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **6** — 1 de aplicação (guarda), 1 componente, 3 de teste e este documento |
| Arquivos alterados | **12** — as regras de avaliação, os dois serviços, as duas Actions, as duas páginas, o seed e os quatro documentos (README, AGENTS, armadilhas, dívidas) |
| Migrações | **0** — a rubrica já era um JSON de N critérios (`track.reviewRubric`, `call.reviewRubric`) |
| Testes novos | **37** no Vitest (25 unitários + 12 de integração) e **4** E2E — a suíte vai de **1977/88** para **2014/90**, e o E2E de **133** para **137** |
| Defeitos reais encontrados | **6** — o rótulo acessível que colidia entre o formulário de criação e os de edição; dois erros do lint do React Compiler no editor; a consulta do evento sem os campos que a edição precisa; o teste que compartilhava uma trilha e media o estado do teste anterior; a fixture que não publicava a chamada nem respeitava os mínimos da submissão; e uma **conclusão errada tirada de um timeout** (armadilha 92) |
| Dívidas quitadas | **nenhuma** — a fase não estava amarrada a dívida |
| Dívida nova | **1** — **E53** (a contagem do congelamento da trilha é conservadora) |
| ADRs | **213 … 218** (a próxima é 219) |

---

## 2. O problema mais difícil: **a rubrica é a régua da nota, e a nota já foi dada**

Exibir mais linhas é fácil. O problema é que a rubrica **não é decoração**: é a régua com que
cada nota foi produzida.

`computeWeightedScore(rubric, scores)` faz duas coisas que transformam a edição em risco:

1. **devolve `null` se qualquer critério da rubrica estiver sem nota** — o que acontece
   exatamente quando se ACRESCENTA um critério a uma trilha que já tem pareceres: todos os
   pareceres existentes passam a ter um critério em branco, e a nota deles deixa de ser
   calculável;
2. **normaliza pelo peso total** — o que acontece quando se REMOVE um critério: os pesos
   restantes são redistribuídos, e as mesmas notas passam a valer outra coisa.

E não existe rede de proteção: o parecer guarda `scores` (um JSON chaveado por critério) e
`scoreBreakdown`, mas **não guarda a rubrica do dia**. O que o revisor leu não está gravado em
lugar nenhum — então não há como recalcular o passado "com a régua da época".

As duas saídas honestas eram **fotografar a rubrica em cada parecer** (permitir editar sempre) ou
**congelar a forma depois do primeiro parecer**. A primeira resolve o cálculo e cria um problema
pior: a média final passaria a comparar notas dadas em réguas diferentes, e o comitê decidiria
sobre números que não são a mesma coisa sem que a tela dissesse isso.

A fase congelou. E o que faz o congelamento ser aceitável é o **caminho declarado**: antes do
primeiro parecer a rubrica é livre (é quando a instituição está montando a avaliação), e depois
dela a saída é criar outra trilha ou outra chamada — o que a mensagem diz, junto com a contagem
de pareceres que a bloqueou.

---

## 3. Decisões técnicas

### 3.1 O motor já era livre — o limite era de tela

`validateRubric` aceitava qualquer lista (≥ 1, chaves únicas, peso > 0, nota máxima > 0) e as
duas Actions já liam listas paralelas com `getAll`. O três estava **só** no JSX: um
`[0, 1, 2].map(...)` na tela do evento e um `Math.max(3, criteria.length)` no painel da chamada.
Saber disso mudou o tamanho da fase: ela é de interface e de **regra de segurança**, não de
reescrita do motor de notas.

### 3.2 A chave do critério deixou de ser digitada

A chave (`originality`) é o campo de `Review.scores` e obedece a um regex técnico. Pedir que
quem organiza digite isso é pedir que erre — e o erro só aparecia **depois** do envio ("chave
inválida", "chave repetida"). Agora ela nasce do rótulo: "Originalidade e relevância" →
`originalidade_e_relevancia`, com colisão resolvida por sufixo (`_2`) em vez de recusa.

**Menos JSON e mais planilha de papel?** O campo da chave continua existindo no formulário — como
campo **oculto**, preenchido nas linhas que já existem. É o que permite corrigir um rótulo depois
de avaliado sem que a chave mude (e a chave é parte da forma congelada). Linha nova manda vazio e
a derivação acontece.

### 3.3 O que congela é o que entra na conta

Congelam: **o conjunto de chaves**, o **peso** e a **nota máxima**. Não congelam: **rótulo**,
**descrição** e **ordem**.

O critério é o mesmo em cada caso: o que entra em `computeWeightedScore` congela; o que é
leitura, não. Corrigir "Clareza" para "Clareza e organização" não reescreve nota nenhuma, e
travar a correção de um erro de digitação seria pior que a divergência cosmética. E a ordem é
indiferente para a soma — congelá-la impediria o organizador de melhorar o formulário de quem
avalia.

### 3.4 A comparação é contra a rubrica EM VIGOR

Comparar o `reviewRubric` gravado não bastaria: uma trilha **sem rubrica própria usa a PADRÃO**
(três critérios do código), e gravar cinco critérios nela é mudança de forma como qualquer
outra — só que o `before` é a padrão, não o JSON vazio. A guarda passa os dois lados pela mesma
precedência que o revisor usa (`resolveEffectiveRubric`: CHAMADA → TRILHA → PADRÃO), então não
existem duas noções de "rubrica em vigor".

### 3.5 Sem JavaScript, o editor oferece o teto — e nenhum botão morto

Os controles de acrescentar/remover (e a soma dos pesos) só aparecem **depois da hidratação**:
um botão que não faz nada é pior que um botão ausente. No lugar deles, um bloco `<noscript>`
traz as linhas que faltam até o teto — quem está sem JavaScript preenche quantas quiser, e as
vazias são descartadas (linha sem rótulo não é critério). O E2E mede as duas coisas: **doze
linhas** disponíveis e a trilha criada de verdade por esse caminho.

---

## 4. ADRs

### ADR-213 — A chave do critério nasce do RÓTULO, e é preservada quando já existe

**Contexto.** A chave é técnica (campo de `Review.scores`, regex `^[a-z][a-z0-9_]{0,39}$`) e era
digitada à mão — um erro que só aparecia depois do envio, e que ficou mais provável quando o
número de critérios passou a ser livre.

**Decisão.** `criterionKeyFromLabel` deriva a chave do rótulo (sem acento, minúsculas, `_`),
resolve colisão com sufixo numérico e prefixa quando o rótulo começa com número. Nas linhas que
**já existem** a chave viaja num campo oculto e é preservada — porque ela é parte da forma
congelada, e recalculá-la faria a correção de um rótulo ser lida como mudança de forma.

**Consequências.** O organizador escreve o que as pessoas leem; a chave é assunto do sistema. Um
rótulo renomeado mantém a chave antiga, o que é o comportamento desejado (é o mesmo critério).

### ADR-214 — A rubrica tem TETO: 12 critérios, validado no domínio

**Contexto.** "Número livre" sem teto não é escolha, é um campo onde cabe qualquer coisa. E o
teto precisa existir onde o dado entra — não só na tela, porque a Server Action e o serviço
aceitam o mesmo formulário.

**Decisão.** `MAX_RUBRIC_CRITERIA = 12`, validado por `validateRubric` (`TOO_MANY`, com a
contagem na mensagem). A tela avisa o teto na legenda e desabilita o botão ao alcançá-lo.

**Consequências.** Doze cabem numa tela, num parecer e na leitura de quem avalia. O E2E prova que
a recusa vem do serviço: treze critérios são recusados mesmo fora da tela.

### ADR-215 — A FORMA da rubrica congela a partir do primeiro parecer

**Contexto.** Acrescentar critério deixa todo parecer existente sem nota em um deles (a nota vira
`null`); remover renormaliza os pesos e muda o significado das notas dadas. O parecer não guarda a
rubrica do dia, então não há como recalcular o passado.

**Decisão.** Existe parecer (linha em `Review`, criada no ENVIO do parecer) ⇒ a forma não muda:
conjunto de chaves, pesos e notas máximas. A recusa é `RUBRIC_FROZEN`, com a contagem e a
descrição da mudança recusada, e o caminho (criar outra trilha/chamada).

**Justificativa.** A alternativa (snapshot da rubrica em cada parecer) permitiria editar sempre,
mas faria a média final comparar notas de réguas diferentes — um problema de decisão, não de
cálculo.

**Consequências.** A rubrica é livre enquanto ninguém avaliou e imutável depois; quem precisa de
outra régua cria outro alvo. Convite aceito e rascunho de parecer **não** congelam: só o envio.

### ADR-216 — Rótulo, descrição e ORDEM não congelam

**Contexto.** O congelamento poderia ser total (qualquer mudança recusada). Seria mais simples de
explicar e pior de usar.

**Decisão.** `rubricShapeDiff` compara apenas `key`, `weight` e `maxScore`, sem se importar com a
ordem nem com o texto. Corrigir um rótulo ou reordenar os critérios continua funcionando depois
de avaliado.

**Consequências.** O organizador conserta um erro de digitação sem criar outra trilha; o preço é
que o texto lido pelo revisor pode ter mudado desde o parecer — declarado, e menor que o custo de
travar a correção.

### ADR-217 — A contagem do congelamento da trilha é CONSERVADORA, de propósito

**Contexto.** A rubrica de uma submissão resolve por precedência CHAMADA → TRILHA → PADRÃO. Em
tese, uma submissão de uma chamada com rubrica própria não é afetada pela trilha — e contá-la
assim exigiria resolver a rubrica de CADA submissão para saber quem realmente usa a da trilha.

**Decisão.** A trilha conta **pareceres de submissões dela**, sem essa distinção (e a chamada
conta os das submissões dela). A mensagem diz o que foi contado.

**Consequências.** A guarda erra para o lado de congelar — o lado seguro — e custa precisão:
uma trilha pode congelar por causa de um parecer que usava a rubrica da chamada. É a dívida
**E53**, com o caminho de correção escrito.

### ADR-218 — Um editor para as duas telas, e sem JavaScript ele oferece as LINHAS DO TETO

**Contexto.** A trilha e a chamada desenhavam a rubrica com código próprio (um `[0,1,2].map` e um
`Math.max(3, n)`), e o número livre exigiria acrescentar/remover em ambos.

**Decisão.** `RubricEditor` é o editor único: N linhas, soma dos pesos, acrescentar/remover (só
depois da hidratação) e um bloco `<noscript>` com as linhas restantes até o teto. Os campos do
`<noscript>` existem no DOM também com JavaScript — vazios, e por isso descartados —, o que
mantém a hidratação idêntica.

**Consequências.** Quem está sem JavaScript declara de 1 a 12 critérios e envia o formulário pelo
caminho nativo (o E2E prova: a trilha nasce com cinco). Nenhum controle morto na tela. O custo é
o `<noscript>` dentro de um componente de cliente, que precisa de um comentário explicando por
que os campos vazios não atrapalham.

---

## 5. Lições aprendidas — defeitos REAIS encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | O E2E reprovou com `strict mode violation`: "Rótulo do critério 1" casava **dois** elementos | A tela do evento tem o formulário de criação **e** um editor por trilha — todos com campos de mesmo rótulo. É a armadilha **81** outra vez: rótulo de formulário é identificador único na tela inteira | O editor passou a receber `scopeLabel` (o nome da trilha/chamada) e os rótulos acessíveis viraram "Trilha X: rótulo do critério 2" |
| 2 | `npm run lint` reprovou o editor com **dois erros do React Compiler**: `setState` dentro de efeito (render em cascata) e acesso a variável antes da declaração | Eu detectava "o JavaScript carregou?" com `useState(false)` + `useEffect(() => setInteractive(true))`, e a função de soma estava declarada depois do efeito que a usava | `useSyncExternalStore` (o jeito idiomático de perguntar se hidratou, sem `setState`) e a função de soma movida para o escopo do módulo |
| 3 | A tela de edição da trilha não tinha os campos para preencher: a consulta do evento trazia só id, slug, nome, limites e contagem | A edição de trilha **não existia** — o formulário só criava, então a consulta nunca precisou desses campos | `getAdminEvent` passou a devolver descrição, cor, limite por autor, cegueira e a rubrica (por `parseRubric`, para a tela receber critérios e não `JsonValue`) |
| 4 | Os testes de integração do congelamento falharam em cascata: os últimos mediam um estado que os primeiros tinham mudado | Todos compartilhavam UMA trilha, e o cenário "sem parecer, editar é livre" já tinha trocado a rubrica de 3 para 4 critérios — então "remover" e "salvar a mesma" mediam outra coisa | Cada cenário cria a PRÓPRIA trilha com a rubrica de base (`trackWithReview`): o teste deixa de depender da ordem |
| 5 | A fixture não conseguia criar a proposta: "Esta chamada ainda não foi publicada", e antes disso o domínio recusou o resumo curto | Duas regras do produto que a fixture não respeitava: só chamada publicada recebe proposta (F33) e o resumo exige 150 caracteres com 3 palavras-chave (F4) | A fixture publica a chamada (`setCallPublished`) e escreve um resumo no mínimo — o teste passou a nascer respeitando o produto |
| 6 | Eu concluí, de um **timeout**, que o formulário do painel **não envia** sem JavaScript — e estava pronto para documentar isso como limitação | O timeout não dizia o motivo: o que faltava era o **locator** (a linha do `<noscript>` não tinha o rótulo com prefixo). Medido de novo, o envio funciona e cria a trilha | A conclusão errada virou a armadilha **92**: antes de documentar uma limitação, meça o FATO (e o cenário passou a prender o envio sem JavaScript como comportamento) |

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 90 arquivos · 2014 testes passando
npm run build ..................... Compiled successfully
npm run db:verify ................. Contrato íntegro.
npm run db:verify:isolation ....... 9/9 verificações passaram.
npm run db:partitions ............. partições do mês atual e dos seguintes garantidas
npm run db:verify:pooling ......... Pooling íntegro: contexto por transação preservado sob PgBouncer.
npx prisma migrate status ......... 34 migrations found · Database schema is up to date!
npm run db:seed ................... OK (a chamada de minicursos nasce com 5 critérios)
npm run test:e2e .................. 137 passed
```

Nenhuma migração foi escrita: a rubrica já era JSON de N critérios, e a fase **não tocou no
banco** — o que é a evidência mais direta de que o limite de três era de tela.

Os quatro cenários do E2E, do ponto de vista de quem usa:

1. a trilha nasce com **cinco** critérios pela tela, com as chaves derivadas dos rótulos
   (`originalidade`, `metodo`, `clareza`, `impacto`, `viabilidade`);
2. **sem JavaScript**, o editor oferece as doze linhas do teto, nenhum controle morto aparece, e
   o formulário **envia** — a trilha é criada com os cinco critérios preenchidos, e as linhas
   vazias são descartadas;
3. a trilha é **editável** e o formulário abre com a rubrica gravada; salvar sem tocar na rubrica
   mantém os cinco critérios;
4. com **um parecer enviado**, a rubrica aparece congelada com a contagem ("congelada por 1
   parecer"), sem campos de edição — a tela não oferece o que o servidor recusaria.

---

## 7. Comandos operacionais

```bash
# A rubrica de uma trilha (chamada de trabalhos) e de uma chamada de propostas
/t/<slug>/administracao/eventos/<eventId>            → "Chamada de trabalhos" → criar/Editar trilha
/t/<slug>/administracao/eventos/<eventId>/chamadas   → criar/editar chamada

# O que está gravado, e quantos pareceres seguram a rubrica
psql "$DATABASE_URL" -c \
  'SELECT slug, jsonb_array_length("reviewRubric") AS criterios FROM tracks ORDER BY slug'
psql "$DATABASE_URL" -c \
  'SELECT count(*) FROM reviews r JOIN submissions s ON s.id = r."submissionId"
    WHERE s."trackId" IS NOT NULL'
```

Quem precisa de **outra régua** depois de haver parecer cria outra trilha (ou outra chamada):
a rubrica é a régua da nota, e a nota já foi dada.

---

## 8. Dívidas técnicas e pontos de atenção

* **A contagem do congelamento da trilha é conservadora (E53, nova).** Ela conta pareceres de
  submissões da trilha sem verificar se aquela submissão usa mesmo a rubrica da trilha (uma
  chamada com rubrica própria vence a da trilha). Erra para o lado seguro, e a correção é
  resolver a rubrica por submissão na contagem.
* **A tela do revisor não mudou** — e não precisava: `review-form.tsx` já renderiza e soma a
  rubrica que recebe, com qualquer número de critérios. Com doze critérios o formulário fica
  longo, e não há limite de rolagem nem agrupamento: quem quiser melhorar isso mexe na tela de
  quem avalia, não na rubrica.
* **Não existe biblioteca de rubricas.** Cada trilha e cada chamada define a sua; copiar a rubrica
  de outro evento é redigitar. Ficou fora de escopo (o padrão do código continua sendo o ponto de
  partida de quem deixa a rubrica vazia).
* **Trocar a rubrica de uma avaliação em andamento exige criar outro alvo.** É a decisão
  (ADR-215), não um defeito — mas convém saber que não há caminho de "reabrir a avaliação".

---

## 9. Checklist de aceite

- [x] A rubrica aceita de **1 a 12 critérios**, na trilha e na chamada, e o teto é validado no
      **serviço** (não só na tela)
- [x] A **chave** do critério nasce do rótulo (acento, símbolo, colisão e teto de 40 tratados) e é
      **preservada** nas linhas que já existem
- [x] Linha **sem rótulo** é descartada; peso e nota máxima vazios usam o padrão, e presente e
      inválido é **recusado** com o motivo
- [x] A **forma** da rubrica (chaves, pesos e notas máximas) congela a partir do primeiro parecer,
      com a contagem na mensagem e o caminho declarado (`RUBRIC_FROZEN`)
- [x] **Rótulo, descrição e ordem** continuam editáveis depois de avaliado
- [x] A comparação é contra a rubrica **em vigor** (CHAMADA → TRILHA → PADRÃO): trilha sem rubrica
      própria congela a partir da padrão
- [x] A **trilha é editável** pela tela, com a rubrica carregada no formulário
- [x] O editor é **um só** para as duas telas, com soma dos pesos visível
- [x] **Sem JavaScript**: as linhas até o teto estão disponíveis, nenhum controle morto aparece, e
      o envio funciona (provado pelo E2E)
- [x] A tela **congelada** mostra a rubrica em vigor e a contagem, e manda os valores atuais em
      campos ocultos (salvar o resto do formulário não altera a rubrica)
- [x] Toda a suíte continua verde (**2014** testes + **137** E2E), com os testes da FASE 4
      (avaliação por pares) e da FASE 33 (chamadas) intactos
