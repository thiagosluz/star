# FASE 53 — Painel de prontidão e áreas de gestão do evento

> **Escopo definido pelo humano, depois de uma tentativa rejeitada.** A primeira
> abordagem desta fase criou um "casco" com **navegação lateral em todas as telas do
> evento** — e ela foi **desfeita**: *"a navegação lateral ocupando espaço em toda tela
> (...) ficava parecendo que tínhamos dois sidebar, além que o espaço pareceu estar mais
> apertado"*. O que ficou do pedido original: **um painel de prontidão na raiz do evento**
> e uma forma melhor de agrupar os atalhos — a divisão em quatro blocos
> (Configurar · Vitrine · Operar · Resultado) foi aprovada, e a **referência visual** é a
> tela de administração da instituição ("Áreas de gestão"), elogiada como *"bonita, clean
> e operacional"*.

---

## 1. Sumário executivo

| Entrega | O que mudou | Onde |
|---|---|---|
| **Painel de prontidão** | *"O que falta para este evento ficar pronto"*: cada pendência com ícone de estado, o efeito concreto em uma linha e **o caminho que resolve** (link para a fila, para a seção ou para a tela). Sem pendência, o painel **diz que está tudo certo** — e não desaparece | Raiz do evento |
| **Áreas de gestão em grade** | A faixa de links soltos virou **cartões** (ícone, título, o que se faz ali) nos **quatro grupos do trabalho** — o **mesmo desenho** da tela de administração da instituição | Raiz do evento |
| **Rótulo desambiguado** | *"Página pública →"* (que abria o **editor**) virou **"Editar página →"**; *"Ver página pública"* continua sendo o **site**, em outra aba | Raiz do evento |
| **Regras no domínio** | `event-readiness.ts` (o que é pendência, com que gravidade e para onde aponta) e `event-areas.ts` (o catálogo das áreas) — **15 testes de unidade** provam as duas sem navegador | `src/domain/events/**` |

**O que NÃO mudou — e é a parte mais importante:** nenhum `layout`, nenhum casco, nenhuma
navegação lateral, **nenhuma outra tela**. A única rota tocada é
`/administracao/eventos/<id>`.

**Números:** 2 arquivos de domínio novos, 1 tela alterada, 1 teste de unidade novo (15
casos), 1 spec E2E novo (3 casos). **Nenhuma migração.**

---

## 2. O problema mais difícil: o que **não** é pendência

Um painel que lista o que falta é fácil de escrever e fácil de estragar. A parte difícil
foi decidir **o que não entra** — porque cada item a mais ensina o organizador a ignorar o
painel:

| Tentação | Por que ficou de fora |
|---|---|
| "Não há trilha cadastrada" | Trilha é eixo temático da **ciência**. Evento corporativo ou comunitário não tem — e a trilha só é obrigatória quando há **chamada científica publicada**. A regra cobra a trilha nesse caso, e só nele |
| "Nenhum patrocinador cadastrado" | Patrocínio é oportunidade comercial, não requisito de evento pronto |
| "Nenhuma atividade na programação" | Só vale quando o evento **já está no ar**. Rascunho em montagem tem programação vazia **por definição** — e acusar isso é acusar o organizador de não ter terminado o que ele acabou de começar |
| "Nenhuma inscrição" | Mesma régua: só depois que o evento está no ar |

A ordem também é decisão: **vagas retidas vêm primeiro**, porque elas **vencem sozinhas** e
devolvem o lugar para a lista de espera. Configuração pode esperar a semana que vem;
prazo vencido, não.

E há a assimetria que dá sentido ao painel: ele **precisa saber dizer "está tudo certo"**.
Um painel que só sabe acusar é um painel que ninguém consulta quando está tudo bem — e aí
ninguém vê o aviso quando não está.

---

## 3. Decisões técnicas

### 3.1 O painel não faz consulta nova

Todos os fatos vêm do que a tela **já carregou** (`getAdminEvent`): contagens, salas,
atividades, prazos de inscrição e de chamada, e a contagem de vagas retidas que a página
já calculava para o texto da faixa. O painel é **leitura**, não uma segunda fonte de
verdade — e por isso não pode divergir do que a tela mostra logo abaixo.

### 3.2 A regra é do domínio, e o ícone é da tela

`eventReadiness(fatos)` devolve uma lista de pendências (`id`, título, detalhe, gravidade,
**alvo**). O domínio **não conhece React** — nem ícone, nem `href`. A tela resolve o alvo:
se o `targetTestId` corresponde ao atalho de uma área, o título vira **link** para aquela
tela; se é uma seção desta página, o item fica como texto (o caminho está logo abaixo).

Isso mantém o teste honesto: ele prova *quais* pendências aparecem, *com que gravidade* e
*para onde apontam* — sem montar tela.

### 3.3 Os atalhos antigos continuam existindo

A primeira tentativa desta fase removeu a faixa de links e **quebrou nove cenários E2E** de
outras fases que navegavam por ela (`calls-link`, `confirmations-link`). Os cartões
preservam **todos** os identificadores antigos (`legacyTestId` no catálogo), e há um teste
de unidade que **exige a lista completa** — se alguém apagar o campo ao renomear um cartão,
o teste acusa antes do E2E.

### 3.4 Grade de cartões, não abas

A divisão em quatro grupos foi aprovada; **abas** foram cogitadas e descartadas: abas
escondem áreas atrás de um clique e não cabem bem em tela estreita. As quatro seções
empilhadas deixam tudo visível de uma vez — e a grade de duas colunas é a mesma da tela de
administração, então quem aprendeu a ler uma sabe ler a outra.

---

## 4. ADRs

**ADR-293 — A prontidão do evento é REGRA DE DOMÍNIO, com alvo declarado.** Cada pendência
diz o que falta, por que importa, com que gravidade e **onde se resolve**. Consequência: o
painel não pode "esquecer" o caminho, e o teste prova cada regra sem navegador.

**ADR-294 — Pendência que não é acionável não entra.** Trilha só com chamada científica
publicada; patrocínio nunca; programação e inscrição vazias só depois que o evento está no
ar. Consequência: o painel mantém o valor informativo — e o silêncio dele significa algo.

**ADR-295 — O painel é LEITURA do que a tela já carrega.** Nenhuma consulta nova para dizer
o que falta. Consequência: impossível divergir do que a tela mostra; e o custo de abrir a
raiz do evento não cresce.

**ADR-296 — As áreas de gestão são DADO, agrupadas pelo trabalho.** O catálogo é uma lista
única em `event-areas.ts`, com propósito em uma linha, permissão da tela e os identificadores
que os testes já usavam. Consequência: um cartão novo é uma entrada na lista — e a grade, o
agrupamento e os atalhos saem dela.

**ADR-297 — A navegação do evento NÃO vira casco.** A tentativa de um casco com navegação
lateral foi rejeitada pelo humano e **desfeita** (dois sidebars, espaço apertado). A
navegação do evento mora na **raiz**; as telas internas seguem com os seus próprios
caminhos. Consequência: nenhuma tela nova ganha cromo por existir.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | **"Parecia que tínhamos dois sidebar"** — a navegação lateral em toda tela foi rejeitada no uso | Um casco de navegação dentro de um produto que **já tem** shell lateral dobra a moldura e aperta o conteúdo | Revertido; a navegação ficou onde já existia — na raiz — e virou **grade de cartões** |
| 2 | Nove cenários E2E de outras fases quebraram numa tentativa anterior | A faixa de links foi removida, e os `data-testid` que os specs usavam sumiram com ela | Os cartões **preservam** os identificadores (`legacyTestId`), com teste de unidade exigindo a lista completa |
| 3 | Duas entradas quase idênticas para a mesma coisa (`Ver página pública` × `Página pública`) | O rótulo dizia o **assunto**, não o **verbo**: uma abria o site, a outra o editor | `Editar página` para o editor; `Ver página pública ↗` para o site |
| 4 | O painel corria o risco de virar lista de reclamações | Pendências não acionáveis (trilha sem chamada, patrocínio, rascunho vazio) | A régua do §2: só entra o que **atrapalha o fluxo** — e o teste prova cada exclusão |

---

## 6. Evidência de verificação

```text
npm run lint ....................... 0 erros, 0 warnings
npm run typecheck .................. 0 erros
npm test ........................... 132 arquivos · 2721 testes passando
npm run build ...................... ✓ Compiled successfully
npx vitest run tests/unit/f53-prontidao-e-areas.test.ts ........ 15 passed
npx playwright test tests/e2e/f53-painel-e-areas.spec.ts ....... 3 passed
npx playwright test call-for-proposals + registration-confirmation + landing-page ... 14 passed
npm run test:e2e (suíte completa) .. 212 passed · 6 skipped · 0 failed
```

---

## 7. Comandos operacionais

```bash
# As regras do painel e o catálogo das áreas (ordem, gravidade, alvos, atalhos legados)
npx vitest run tests/unit/f53-prontidao-e-areas.test.ts

# O painel e a grade no navegador
npx playwright test tests/e2e/f53-painel-e-areas.spec.ts

# O contrato com as fases anteriores (os atalhos continuam existindo)
npx playwright test tests/e2e/call-for-proposals.spec.ts tests/e2e/registration-confirmation.spec.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

**RESOLVIDO — as seções de edição entraram no grupo Configurar.** As quatro seções que se editam na
própria tela (Dados do evento, Salas, Programação, Reconhecimento do comitê) agora aparecem **logo
abaixo dos cartões do grupo Configurar** e **antes da Vitrine** — e o E2E prende a ordem comparando
as coordenadas na tela (`yConfigurar < ySeções < yVitrine`), não a aparência.

O caminho foi o oposto do que quebrou duas vezes: em vez de mover ~400 linhas, a grade virou uma
**função local** (`grupoDeAreas`) e a página passou a renderizar **dois recortes dela** — Configurar
antes das seções, os outros três grupos depois. Nenhuma linha das seções mudou de lugar; só as duas
chamadas mudaram de posição, cada uma verificada com `typecheck` antes da seguinte. De quebra, a
pendência *"a chamada está publicada e não há trilha"* passou a apontar para o atalho de chamadas
(`calls-link`), já que a seção de trilhas mudou de tela na unificação.

**O RECONHECIMENTO DO COMITÊ FOI PARA O RESULTADO** (revisão do humano depois de ver a tela): a
seção não configura nada — ela **premia**. É o ranking de quem mais revisou e a concessão da carta
(`CARD_GRANT`), isto é, o que fica **depois** do trabalho do comitê, junto dos certificados. Ela
saiu do grupo Configurar (onde ficava ao lado de dados, salas e programação) e passou a aparecer
**depois dos cartões de Resultado** — com a ordem presa no E2E por coordenada na tela
(`yResultado < yReconhecimento`), e os specs da F16/F22 (que buscam `reviewer-award-section`)
seguindo verdes, porque movê-la não muda o identificador nem o conteúdo.

**HISTÓRICO — o que tinha dado errado antes:** as seções de edição ficaram no FIM da página. O humano apontou: *"ainda existe
essas opções no final da página, e deve ficar dentro de algum dos quatro grupos"*. Os cinco
`<details>` (Dados do evento, Salas, Programação, Chamada de trabalhos, Reconhecimento do comitê)
seguem empilhados depois da grade. O destino certo é o grupo **Configurar**, logo abaixo dos seus
cartões. Tentei a reordenação por cirurgia de linhas nesta rodada e **quebrei a página duas vezes**
(um `/**` de comentário perdido e um JSDoc cortado ao meio, que engoliu o resto do arquivo); restaurei
o estado bom e **não** deixei a árvore suja. O caminho seguro é reescrever o layout da página com os
blocos identificados por marcador (não por número de linha) — como as seções são grandes, o corte tem
de ser feito por âncora de texto, com `typecheck` entre cada passo.

**PENDENTE 2 — "Chamadas de trabalhos" precisa UNIFICAR trilhas.** O humano apontou: *"esse botão
Chamadas de trabalhos deve unificar, e permitir por exemplo criar trilhas"*. Hoje há **duas telas
para o mesmo assunto**: a seção "Chamada de trabalhos" desta página (que edita as TRILHAS e as
rubricas) e a tela `/chamadas` (que edita as CHAMADAS da FASE 33 — tipo, janela, cegueira, rubrica
própria, limite por autor). A trilha é o eixo temático que a chamada usa; mantê-las separadas obriga
o organizador a adivinhar onde criar cada uma. O caminho: **levar a seção de trilhas para
`/chamadas`** (com `event.tracks` e os formulários que já existem) e deixar esta página com os dados,
as salas e a programação. Isso move ~150 linhas de JSX, os imports das actions de trilha e o carregamento do evento na outra
tela — e os specs `call-for-proposals` e os de rubrica/trilha passam a ser a rede de segurança.

  **Progresso da unificação (feito em passos verificados, depois de duas tentativas quebradas por
  corte de linha):**
  - **Passo 1 ✅** — a seção virou o componente `src/components/admin/track-section.tsx`
    (`{ tenantSlug, eventId, tracks, reviewCounts }`), com o `data-testid="tracks-section"`
    preservado. Nasceu **sem uso**, para o erro de extração aparecer isolado. `typecheck`/`lint`
    limpos, 2721 testes e build verdes.
  - **Passo 2 ✅** — a tela do evento passou a renderizar `<TrackSection … />`: **955 → 815 linhas**
    (a seção virou 6), com o comportamento idêntico para quem usa. `rubric-criteria` (4) +
    `platform-journey` (2) = **6 passed**.
  - **Passo 3 ✅** — `/chamadas` passou a renderizar `<TrackSection … />` **abaixo da lista de
    chamadas**, com `SectionHeading` "Trilhas do evento": primeiro o convite (a chamada), depois o
    eixo que classifica a submissão (a trilha). A contagem de pareceres por trilha é calculada na
    própria tela (`trackReviewCounts`). Neste passo a seção existiu nos DOIS lugares, de propósito —
    e o spec da F53 prende o destino: ao clicar no cartão "Chamadas de trabalhos", a seção aparece
    em `/chamadas`. `call-for-proposals` (4) + `rubric-criteria` (4) + `f53-painel-e-areas` (3) =
    **11 passed**.
  - **Passo 4 ✅ (unificação fechada)** — a seção saiu da tela do evento (o `<TrackSection … />` e o
    `trackReviewCounts` que só ela usava; o arquivo ficou com **805 linhas**, contra 955 do início), e
    os dois specs que a buscavam lá passaram a buscá-la em `/chamadas`: `rubric-criteria.spec.ts`
    ganhou um `tracksUrl()` (os quatro cenários de trilha/rubrica navegam para a tela nova) e
    `platform-journey.spec.ts` desce até lá para criar a trilha. **13 cenários verdes** nos quatro
    specs que cobrem o movimento (`rubric-criteria` 4, `call-for-proposals` 4, `f53-painel-e-areas`
    3, `platform-journey` 2).

**Resultado da unificação:** criar trilha, editar trilha e configurar a rubrica passaram a acontecer
onde as chamadas acontecem — a trilha é o eixo que a chamada usa para classificar a submissão. O
`data-testid="tracks-section"` nunca mudou, então nenhuma cobertura se perdeu no caminho; e o teste
de unidade da F53 continua cobrando a lista dos atalhos legados.

**O que este movimento ensinou (armadilha 107):** mover um bloco de JSX de 148 linhas entre páginas
por **corte de linha** quebrou as duas telas de uma vez, porque a fronteira do bloco encosta no bloco
seguinte. A saída foi **extrair para componente** (arquivo não tem fronteira frágil) e trocar o USO
em cada tela, uma linha por vez, com `typecheck` entre os passos.

**Uma pendência prometida no plano ficou de fora: patrocinador.** O painel cobre seis
regras (vagas retidas, sala sem capacidade, programação vazia com o evento no ar,
inscrição sem prazo, chamada publicada sem prazo, chamada científica sem trilha, nenhuma
inscrição). "Nenhum patrocinador cadastrado" precisa de uma consulta que a tela não faz
hoje — e patrocínio é oportunidade comercial, não requisito (ADR-294). Acrescentar é uma
entrada na lista de regras **mais** a contagem no carregamento da página.

**A contagem dentro do cartão ainda não existe.** O plano previa mostrar "3" ao lado de
*Confirmações de vaga* e "7" em *Cartas*, como na tela de administração. O cartão hoje tem
ícone, título e propósito. O selo é a próxima melhoria natural — o dado da fila já está na
página (`pendingConfirmations`).

**A tela interna segue com o seu próprio caminho de volta.** Cada seção tem o link
"← Eventos" no topo; a grade da raiz é o mapa. Não há navegação entre seções sem passar
pela raiz — foi uma escolha depois da rejeição ao casco (ADR-297), e vale reavaliar só se o
uso pedir.

---

## 9. Checklist de aceite

- [x] **Painel de prontidão** na raiz do evento, com pendências, efeito e **caminho**
- [x] O painel **sabe dizer "está tudo certo"** (e o teste prova a lista vazia)
- [x] Regras com **gravidade** e **ordem** deliberadas (vagas retidas primeiro)
- [x] **Nada de pendência não acionável** (trilha só com chamada científica; patrocínio fora; rascunho vazio não acusa)
- [x] **Áreas em grade**, nos quatro grupos aprovados, no padrão visual da tela de administração
- [x] **Todos os atalhos antigos preservados** (`legacyTestId`) e exigidos por teste
- [x] Rótulo do editor desambiguado (**Editar página** × **Ver página pública**)
- [x] **Nenhum casco, nenhuma navegação lateral, nenhuma outra tela alterada**
- [x] 15 testes de unidade + 3 E2E novos, verdes
- [x] Os E2E que navegam pelos atalhos antigos continuam verdes
