# FASE 55 — As seções viram páginas com cartão (o padrão da tela)

> **Escopo definido pelo humano:** *"Dados do evento, Salas, Programação, Reconhecimento do comitê
> científico ainda parecem destoar diferente de como estamos trabalhando em outras partes nessa
> página, será que poderemos criar páginas próprias para elas e adicionar cards igual o restante da
> página? dessa forma teríamos um padrão estético?"* — aprovado em **4 fatias**, da menos para a
> mais entrelaçada.
>
> **Estado: ENTREGUE — as 4 fatias concluídas.** A raiz do evento tem ZERO sanfonas.

---

## 1. O que a fase é

A raiz do evento já tem um padrão: **cartão com ícone, uma linha de propósito e o selo do que há lá
dentro → uma tela própria**. Menos quatro coisas, que continuavam como **sanfonas `<details>`
empilhadas** dentro da página — e era isso que destoava:

| Seção | Vira | Grupo | Selo | Situação |
|---|---|---|---|---|
| Reconhecimento do comitê | `/eventos/<id>/reconhecimento` | Resultado | — (por ora) | ✅ **fatia 1** |
| Dados do evento | `/eventos/<id>/dados` | Configurar | — (é identidade) | ✅ **fatia 2** |
| Salas | `/eventos/<id>/salas` | Configurar | "N salas" | ✅ **fatia 3** |
| Programação | `/eventos/<id>/programacao` | Configurar | "N atividades" | ✅ **fatia 4** |

No fim, a raiz fica sendo **prontidão + mapa**: o painel do que falta e a grade de 14 cartões.
Nada mais.

---

## 2. Por que fatiar, e não mover tudo de uma vez

O levantamento antes de começar (não por estimativa — por contagem):

```
room-lifecycle.spec.ts .......... 18 ocorrências das quatro seções
rubric-criteria.spec.ts ......... 11
platform-journey.spec.ts ........  9
registration-confirmation .......  4
badge-print-and-items ...........  3   speaker-portal ......... 3
f53-painel-e-areas ..............  3   raffle-end-to-end ...... 2
registration-journey ............  2
```

As quatro seções somam **~430 linhas** dentro da página, usam **5 actions** (`saveEventAction`,
`saveRoomAction`, `deleteRoomAction`, `saveActivityAction`, `deleteActivityAction`) e são o alvo de
nove specs. Uma mudança única disso é exatamente o movimento que **quebrou duas páginas** na FASE 53
quando tentei por corte de linha. A ordem escolhida é do **menos entrelaçado** para o mais:

1. **Reconhecimento do comitê** (2 specs) — prova o padrão
2. **Dados do evento** (`platform-journey`)
3. **Salas** (`room-lifecycle`, 18 — o spec inteiro muda de endereço)
4. **Programação** (6 specs, a maior seção)

---

## 3. Fatia 1 — Reconhecimento do comitê (ENTREGUE)

A seção saiu da raiz e virou página própria, com cartão no grupo **Resultado**:

- **Página** `.../eventos/[eventId]/reconhecimento/page.tsx` — exige `CARD_GRANT`
  (a mesma permissão da concessão da carta), carrega o ranking e renderiza o **mesmo**
  `ReviewerAwardPanel`. Tem `<main>` (invariante da FASE 52).
- **Cartão** no catálogo (`event-areas.ts`): grupo `RESULTADO`, `permission: CARD_GRANT`,
  `href` para a página. Como todas as outras áreas, ele é filtrado por permissão — quem não pode
  conceder carta não vê o cartão.
- **O `data-testid="reviewer-award-section"` foi preservado** na página nova: os specs da F16/F22
  navegam por ele, e mudar de endereço não é motivo para quebrar contrato.
- **A raiz ficou 27 linhas menor** (857 → 830) e devolveu o que só essa seção usava:
  `getReviewerRanking`, `ReviewerAwardPanel` e o cálculo de `canAward`.
- **Todo cartão passou a ter identificador estável**: `data-testid={legacyTestId ?? `event-area-${id}`}`
  — antes, só os que herdaram o identificador da faixa antiga eram alcançáveis por teste; agora os
  14 são, e é assim que o E2E prende o cartão novo.
- **A sanfona deixou de existir**: numa página, o conteúdo está aberto. Os dois pontos do spec que
  clicavam em `summary` foram substituídos por um comentário explicando o porquê — não por um clique
  cego em outro elemento.

---

## 3b. Fatia 2 — Dados do evento (ENTREGUE)

A identidade do evento saiu da raiz e virou `/eventos/<id>/dados` (exige `EVENT_UPDATE`), com o
cartão no grupo **Configurar**:

- **O formulário é o MESMO** (`AdminForm` + `saveEventAction`, testId `edit-event`) — só mudou de
  lugar. Levou junto as três dependências de módulo que ele usava: `MODALITY`, `EVENT_STATUS` e o
  helper `toLocalInput`. Ele **parecia** autocontido e não era: uma seção extraída carrega o que
  estava no escopo do arquivo, e o `typecheck` foi quem apontou as três.
- **A raiz ficou 54 linhas menor** (831 → 777) e devolveu `saveEventAction`, o ícone e a constante
  de situações.
- **Os PRAZOS DE INSCRIÇÃO ficaram com os dados** (decisão do humano): a janela de **submissão** é da
  chamada e tem tela própria em `/chamadas`; a janela de **inscrição** é do evento — quem se inscreve
  precisa dela. A página termina com um caminho explícito para as chamadas, para não haver dúvida.
- **O painel de prontidão ficou melhor de graça**: a pendência "as inscrições não têm data de
  encerramento" apontava para uma seção da própria página; agora aponta para o **cartão**
  (`event-area-dados`), ou seja, **leva à página que resolve**. A busca do atalho passou a aceitar
  tanto o identificador herdado quanto o do cartão (`legacyTestId ?? event-area-<id>`).
- **Specs reapontados**: `platform-journey` desce até `/dados`, confere o formulário e volta ao
  evento para seguir a jornada (2 passed); o spec do painel usa a **Programação** como âncora das
  seções que ainda vivem na raiz, e confere o cartão dos dados (3 passed).

**Lições desta fatia** (já registradas no §5): o PowerShell comeu o *template literal* de novo
(`` `event-area-${area.id}` `` virou texto literal dentro do `find`) — é a terceira vez, e a regra
passou a ser: **template literal em TSX se escreve com a ferramenta de edição, nunca por substituição
de string no PowerShell**; e o `EVENT_STATUS` veio truncado na primeira cópia porque o intervalo de
linhas terminava antes do `];` — recortar por âncora (o `];` seguinte) e não por faixa fixa.
## 3c. Fatia 3 — Salas (ENTREGUE)

A seção saiu da raiz e virou `/eventos/<id>/salas` (exige `EVENT_UPDATE`), com cartão no grupo
**Configurar** e o **selo "N salas"** — o primeiro selo calculado fora da FASE 54, e o primeiro a
usar o caminho novo (`rooms` no serviço de contagens + a frase no domínio).

- **O `data-testid="rooms-section"` foi preservado** na página — é o que os specs do ciclo de vida
  da sala usam (ADR-302).
- **A capacidade ganhou a explicação que faltava no cartão**: a página diz, em uma linha, que
  capacidade vazia significa "sem limite" e que a sala é o **teto das vagas** da atividade. Era
  conhecimento que só existia no código (revisão da FASE 3).
- **A raiz ficou 109 linhas menor** (777 → 668) e devolveu `saveRoomAction`, `deleteRoomAction`,
  `InlineActionForm`, `roomCapacityLabel` e o bloco de salas.
- **A prontidão linka para o cartão**: "N salas estão sem capacidade definida" agora abre `/salas`.

**As três armadilhas desta fatia, todas reais:**

1. **O bloco tinha um `<details>` ANINHADO** (a edição de cada sala). Meu primeiro corte parou no
   primeiro `</details>` — o interno — e a página nasceu truncada, com o `typecheck` apontando oito
   "JSX element has no closing tag". O corte certo é o **último `</details>` antes da seção
   seguinte**, não o primeiro depois do início.
2. **O build foi engolido por um `Select-Object -Last 1`** e o compose manteve o container antigo —
   o spec falhou com **404** na rota nova. A armadilha é antiga e está no `AGENTS.md` §4; o que
   faltava era a disciplina de **ler a saída do build**, não só a última linha dela. O screenshot do
   Playwright (404) foi o que apontou o diagnóstico em um passo.
3. **O spec do ciclo de vida é MISTO**: ele cria salas (que mudaram de página) e atividades (que
   ainda vivem na raiz). A navegação única do helper virou três idas e voltas, e cada volta ficou
   comentada com o porquê — inclusive a que confere as **vagas reais** na Programação.

Também um aviso de lint **lido antes da escrita** (o `DoorOpen` apareceu como não usado porque o
`eslint .` rodou na mesma invocação das edições) — e um parágrafo explicativo que se perdeu no
recorte e deixou o ícone órfão: **cortar por linha exige conferir a PONTAS depois**, não só o meio.
## 3d. Fatia 4 — Programação (ENTREGUE)

A última sanfona da raiz — e a maior (241 linhas: cada atividade tem o seu painel de horário, sala,
vagas, confirmação de vaga por item, carga horária) — virou `/eventos/<id>/programacao`
(`EVENT_UPDATE`), com cartão no grupo **Configurar** e o selo **"N atividades"**.

- **A raiz do evento ficou em 341 linhas** (contra 955 quando a FASE 53 começou) e **não tem mais
  nenhuma `<details>`** — o E2E prende isso (`expect(page.locator('main details')).toHaveCount(0)`).
  Ela é, agora, exatamente o que o painel promete: **prontidão + mapa**.
- **Três ajudantes saíram do arquivo da página** para `src/lib/events/activity-presentation.ts`
  (`toLocalInput`, `activitySeatsLabel`, `openActivityOverflowsRoom`): o primeiro já era usado pelo
  formulário de dados do evento, e copiá-lo entre páginas garantiria divergência — a vaga efetiva é
  a MESMA conta do servidor (`effectiveActivityCapacity`).
- **O selo "N atividades"** entrou pelo caminho da FASE 54 (leitura única + frase no domínio).
- **Sete specs** usam a Programação; cinco deles navegam por um helper de URL (`scheduleUrl()`), e
  dois por URL literal (`room-lifecycle`, `registration-journey`) — todos reapontados, com os
  cliques de sanfona removidos (não há mais o que abrir) e **os trechos que voltam à RAIZ** para
  conferir o atalho da fila de confirmações ou o resumo do evento.

**As lições desta fatia:**

1. **"Nenhum atividade"** — o teste de unidade pegou o erro de português na primeira execução. A
   frase do zero era DEDUZIDA da terminação do singular (`endsWith('a')`), e "atividade" não segue
   a regra que "chamada" e "sala" seguem. **A frase do zero passou a ser argumento explícito** de
   `quantidade(...)`, e o comentário explica por quê.
2. **Remover a sanfona quebra mais do que o clique**: um spec usava a rolagem implícita do
   `summary` para chegar ao formulário; sem ele, o alvo passou a ser visível de imediato — e a
   suíte inteira ficou mais rápida (a spec de confirmação caiu de 4 min para 13 s).
3. **Cinco falhas eram UMA**: quatro testes caíram em cascata porque o primeiro não voltava à raiz
   para conferir o cartão da fila. O sinal foi o mesmo padrão de erro em testes diferentes — e a
   correção, uma linha.
## 4. ADRs

**ADR-301 — Cada área da raiz é um CARTÃO que leva a uma tela; nada fica embutido na raiz.** A raiz
do evento responde duas perguntas ("o que falta?" e "onde fica cada coisa?") e nenhuma terceira.
Consequência: nenhuma seção volta a ser sanfona na raiz, e uma área nova nasce como entrada do
catálogo + página — nunca como `<details>` no meio das outras.

**ADR-302 — Mover uma seção de tela não muda o `data-testid` dela.** Os identificadores que os specs
usam atravessam a mudança; o que muda é só o endereço onde a seção vive, e os specs são reapontados
para o endereço novo. Consequência: mudança de layout não vira reescrita de teste.

**ADR-303 — As fatias são verificadas uma a uma, e a ordem é por ENTRELAÇAMENTO.** O menor número de
specs afetados vem primeiro (Reconhecimento: 2), o maior por último (Programação: 6). Consequência:
o padrão é provado com risco baixo antes de ser aplicado onde dói mais.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | O Playwright recusou o spec: *"make sure that arguments are regular expressions matching test files"* | O corte do bloco de asserções deixou um **`);` órfão** — o arquivo não compilava, então nenhum teste era coletado; a mensagem do Playwright fala do ARGUMENTO, não do arquivo | Conferir o arquivo depois de cirurgia de linhas **antes** de rodar: a mensagem aponta para o lugar errado |
| 2 | Depois de corrigir o `);`, as asserções de selo iriam falhar | O bloco novo **clicava no cartão e navegava** — e as asserções seguintes medem selos na RAIZ | O bloco que navega vai **por último** no teste; asserção de página é o fim do cenário, não o meio |

---

## 6. Evidência de verificação (fatia 1)

```text
npm run typecheck ..................... 0 erros
npm run lint .......................... 0 erros, 0 warnings
npm run build ......................... ✓ (container reconstruído)
npx playwright test f53-painel-e-areas . 3 passed  (o cartão está em Resultado e leva à página)
npx playwright test raffle-end-to-end --grep "reconhecimento do comitê existe|premiar"
  ..................................... 2 passed  (a seção e o painel de premiação na página nova)
npx vitest run tests/unit/f53-prontidao-e-areas.test.ts tests/unit/f54-selo-de-contagem.test.ts
```

---

## 7. Comandos operacionais

```bash
# A página nova (precisa de CARD_GRANT)
#   /t/<slug>/administracao/eventos/<eventId>/reconhecimento

npx playwright test tests/e2e/f53-painel-e-areas.spec.ts
npx playwright test tests/e2e/raffle-end-to-end.spec.ts --grep "reconhecimento do comitê existe|premiar"
```

---

## 8. Dívidas técnicas e pontos de atenção

**O cartão do reconhecimento é o único da grade sem selo.** Não há contagem barata de "N revisores"
no serviço de contagens (o ranking é um serviço mais pesado, que a raiz deixou de chamar de
propósito). Fica sem selo — honesto — e a contagem entra se alguém pedir.

**Sorteios também seguem sem selo** (dívida declarada na FASE 54).

**As fatias 2 a 4 continuam pendentes** e cada uma vai repetir este caminho: extrair o bloco,
verificar compilando sem uso, criar a página, trocar o uso na raiz, pôr o cartão no grupo, apontar
os specs, rodar a bateria.

---

## 9. Checklist da fatia 1

- [x] A seção saiu da raiz e virou **página própria** com `<main>`
- [x] **Cartão** no grupo Resultado, no mesmo desenho das outras áreas
- [x] O cartão é **filtrado por permissão** (`CARD_GRANT`)
- [x] O `data-testid` da seção foi **preservado** (`reviewer-award-section`)
- [x] A raiz **devolveu** o que só essa seção usava (serviço, componente, `canAward`)
- [x] Todo cartão passou a ter **identificador estável** (`event-area-<id>`)
- [x] Os specs foram **reapontados** para o endereço novo (2 passed)
- [x] typecheck / lint / build verdes
- [x] **Fatia 2** (Dados do evento) entregue, com a prontidão linkando para o cartão
- [x] **Fatia 3** (Salas) entregue, com o selo "N salas" e a prontidão linkando para o cartão
- [x] **Fatia 4** (Programação) entregue — a raiz do evento tem ZERO sanfonas
