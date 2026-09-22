# FASE 34 — Confirmação de vaga com prazo

> **Escopo definido pelo humano.** *"Algumas atividades que fazem inscrições precisam de
> confirmação, e se não confirmarem dentro do prazo, a vaga é liberada automaticamente.
> Isso deve ser uma escolha do organizador na hora de cadastrar a atividade na
> programação: se é uma atividade confirmável, qual período para confirmação (1,2,3,4
> dias, etc), o que é preciso para confirmar (pagamento, doação de item, alimento,
> brinquedo, etc) e onde/local para confirmar. Se o organizador não escolher essa opção
> de confirmação, então as vagas são autoconfirmáveis no ato da inscrição. Para essas
> atividades que precisam de confirmação, é bom avisar o participante por e-mail e na
> plataforma que ele precisa confirmar, senão a vaga será liberada."*
>
> **Decisões escolhidas pelo humano antes do código:** quem confirma é **só a equipe**
> (no local informado) · o prazo conta **da inscrição de cada pessoa** · as exigências
> são **lista estruturada + onde confirmar** · a vaga liberada **promove o próximo da
> lista de espera e avisa os dois** · a confirmação **vale em atividade sem lotação**,
> com a tela avisando que liberar não abre vaga.

---

## 1. Sumário executivo

A inscrição sempre foi um ato único: quem clicava ficava com a vaga. Só que uma parte das
atividades cobra algo para valer — a taxa do minicurso, o quilo de alimento da campanha,
o brinquedo do natal solidário — e a vaga ficava presa com quem nunca apareceu para
entregar. O organizador descobria a desistência no dia, com a fila cheia de gente que
poderia ter ocupado aquele lugar.

Esta fase separa dois fatos que estavam juntos: **INSCREVER-SE** (o pedido, que reserva a
vaga) e **CONFIRMAR-SE** (o comparecimento ao local e ao prazo ditos pelo organizador, que
transforma a reserva em direito). E o ciclo fecha sozinho: vencido o prazo, a vaga volta
para a fila, quem esperava é promovido, e **os dois** são avisados.

### Entregas

| Entrega | Onde |
|---|---|
| Domínio puro: política (`AUTO`/`REQUIRED`), janela de 1 a 30 dias, prazo no fuso do evento, estados, recusas, exigências e textos derivados | `src/domain/events/confirmation-rules.ts` |
| Migração à mão: enum `ConfirmationPolicy`, cinco colunas em `activities`, quatro em `registrations`, índice da varredura e FK de quem confirmou | `prisma/migrations/20260922115154_registration_confirmation/` |
| A inscrição nasce `PENDING` **retendo a vaga** (e o lugar no evento) quando a política exige confirmação | `src/lib/events/registration-service.ts` |
| Confirmação pela equipe (transição atômica), fila de confirmações, varredura de vencidos e lembrete | `src/lib/events/confirmation-service.ts` |
| Os cinco avisos (pendente, lembrete, confirmada, liberada, promovida) nos dois canais, com `dedupeKey` do fato | `src/lib/events/registration-notices.ts` |
| Cinco templates de e-mail (catálogo de 11 → 16) | `src/domain/communication/email-templates.ts` |
| Campos da política no cadastro da atividade (criar e editar) | `src/components/admin/confirmation-fields.tsx`, `src/app/actions/admin-actions.ts` |
| Fila de confirmações da equipe — **a primeira lista de inscritos do painel** | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/confirmacoes/` |
| Prazo, checklist e local na tela de minhas inscrições (sem botão de confirmar) | `src/app/t/[tenantSlug]/(app)/minhas-inscricoes/page.tsx` |
| Job repetível no worker (de hora em hora) e CLI de produção | `src/lib/communication/email-queue.ts`, `src/workers/index.ts`, `prisma/scripts/expire-registrations.ts` |
| Dado de demonstração: uma oficina que exige doação, com uma vaga RETIDA e o prazo impresso | `prisma/seed.ts` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **11** — 10 de código e teste (1 de domínio, 1 migração, 3 de aplicação — serviço, avisos, script —, 1 de componente, 1 de página, 3 de teste) + este documento |
| Arquivos alterados | **19** — 15 de código e teste (`schema.prisma`, `seed.ts`, `package.json`, o serviço de inscrição, o catálogo de atividades, as duas actions, o formulário público, a página da atividade, a tela de minhas inscrições, o painel do evento, o catálogo de e-mail, a fila de e-mail, os templates e o worker) + 4 de documentação |
| Migrações | **1** nova — total **30** |
| Templates de e-mail | **11 → 16** |
| Testes novos | **69** no Vitest (44 de domínio + 20 de integração + 5 no catálogo de templates) + **5** E2E — a suíte foi de **1690/71** para **1759/73** |
| Defeitos reais encontrados | **3** — a promoção da lista de espera que não devolvia o lugar no evento (armadilha **79**), a fila que abria pela agenda em vez da urgência (armadilha **80**) e o bloco novo de formulário que tornou ambíguo o rótulo `Tipo` e quebrou seis cenários E2E de outra fase (armadilha **81**); a armadilha **76** reapareceu e o cenário novo aprendeu a mesma lição |
| Dívidas quitadas | nenhuma deste levantamento — a fase declarou **E48** e **E49** |
| ADRs | **170 … 178** (a próxima é a 179) |

---

## 2. O problema mais difícil: **a vaga retida é um compromisso, e o relógio é de quem confirma**

O pedido tem uma tensão interna que decidiu o desenho todo: a vaga precisa ficar **presa**
com quem se inscreveu (senão o prazo não devolve nada) e precisa ser **devolvida** quando o
prazo vence (senão o prazo não serve para nada).

```
   inscrição (PENDING)              prazo vence                varredura
        │                               │                         │
        ├── vaga da atividade  +1        │                         │
        ├── lugar no evento    +1        │                         │
        │                                │                         ▼
        │                          (nada acontece             cancela + devolve
        │                           até a passada)            + promove o próximo
        ▼                                                      + avisa os DOIS
   a pessoa vê o prazo, o checklist e o local
```

Três consequências que o código teve de respeitar:

1. **`PENDING` PRECISA CONTAR na vaga.** O contador que a reserva atômica incrementa é o
   mesmo que a página pública usa para dizer "lotada". Se a inscrição pendente não
   contasse, o prazo não teria o que devolver — e a atividade aceitaria mais gente do que
   cabe enquanto as confirmações não chegassem.
2. **O lugar no EVENTO também é retido.** Toda inscrição confirmada de atividade ocupa a
   vaga da atividade **e** um lugar na lotação do evento. Tratar `PENDING` como "ainda não
   é gente" faria o contador do evento divergir do de cancelamento — que decrementa os
   dois (`cancelReleasesSeat` inclui `PENDING` desde a FASE 1).
3. **A liberação é a MESMA esteira do cancelamento**, e por isso ela foi reusada em vez de
   reescrita: devolve a vaga da atividade, devolve o lugar no evento, promove o primeiro
   da lista de espera e reindexa as posições — tudo numa transação. Uma vaga devolvida
   pela metade é uma vaga que ninguém consegue ocupar.

E há o outro lado do relógio: **quem confirma é a equipe**, num local físico. Isso tirou do
participante qualquer botão de confirmar (o que ele assinaria sozinho não é prova de
pagamento para quem cobra) e transformou o aviso em **instrução**: o que levar, até quando
e onde ir.

---

## 3. Decisões técnicas

### 3.1 A confirmação é um ESTADO da inscrição, não uma entidade nova

`RegistrationStatus` já tinha `PENDING` — ocioso desde a FASE 1 — e a transição
`PENDING → CONFIRMED` já estava modelada. Criar uma tabela `RegistrationConfirmation`
(com data, autor e exigências cumpridas) duplicaria a chave da inscrição, exigiria um JOIN
em toda listagem e abriria a porta para "confirmação sem inscrição". O que a fase
acrescentou foram **carimbos** na própria inscrição (`confirmationDueAt`, `confirmedAt`,
`confirmedById`, `confirmationReminderAt`) e a **política** na atividade.

**Descartado:** uma tabela de confirmações por item de exigência ("recebi 1 kg de arroz",
"recebi o brinquedo"). Seria fiel ao mundo real e é caro: cada exigência viraria uma linha,
a tela do balcão viraria um checklist com N caixas, e a pergunta que a operação faz de
verdade — "esta vaga está confirmada?" — continuaria com uma resposta só. Isso é dívida
declarada (**E48**).

### 3.2 `PENDING` retém a vaga — e o lugar no evento

Ver o §2. No código, a inscrição nasce `PENDING` **na mesma transação** que reserva a vaga,
e `attemptRegistration` passou a reservar o lugar no evento para `PENDING` também.

### 3.3 O prazo é por inscrição, no FUSO DO EVENTO, vencendo no FIM DO DIA

"3 dias para confirmar" é o dia inteiro, não 72 horas: quem se inscreve às 22h de segunda
tem até o fim de quinta. E a data é a da INSTITUIÇÃO (armadilha 38): o processo roda em UTC
no container, e formatar o prazo com o fuso do processo daria duas respostas para a mesma
pergunta — a da tela errada. Por isso o serviço devolve o rótulo **já formatado**
(`confirmationDueLabel`), e não só o instante.

A conversão reusa as duas passagens de `zonedWallTimeToInstant` (horário de verão) em vez
de somar `24h × N`: somar horas erra o dia exatamente nas viradas.

### 3.4 Quem confirma é a equipe, e a transição é atômica

`confirmRegistration` faz `updateMany({ where: { id, status: 'PENDING' } })`. Duas pessoas
no balcão clicando ao mesmo tempo produzem **um** efeito; a segunda recebe "já foi
confirmada por outra pessoa". A checagem de leitura (`canConfirmRegistration`) existe só
para dar mensagem boa — prazo vencido, atividade cancelada, política automática. A decisão
é do banco (invariante nº 5).

A permissão é `registration:update:any`, a mesma de quem corrige uma inscrição pelo painel:
confirmar é atualizar a situação de uma inscrição que a pessoa já fez. Nenhuma permissão
nova.

### 3.5 Exigências estruturadas + local, validados juntos

`[{ kind, label, note }]` com quatro tipos (pagamento, doação, item, outro) e um campo de
**onde confirmar**. A validação recusa `REQUIRED` **sem exigência e sem local** — "exige
confirmação" sem dizer o que nem onde produz o pior aviso possível: a pessoa é avisada de
que vai perder a vaga e não tem como obedecer. Já `AUTO` **descarta** os campos do assunto
em vez de recusá-los: desligar a política é decisão legítima e não pode ficar presa a um
campo que só existe do outro lado.

**Atividade ABERTA** (`requiresRegistration = false`) não aceita confirmação: quem entra
nela vem da inscrição no evento, e não há formulário onde reservar uma vaga para depois
confirmar.

### 3.6 A vaga liberada promove o próximo, e os DOIS são avisados

A liberação roda na mesma transação da promoção. A promoção já existia desde a FASE 3 —
mas era **silenciosa**: a pessoa descobria entrando na plataforma por acaso. O aviso fecha
o outro lado.

### 3.7 Os avisos: mensagem é o fato, e-mail é consequência

Cinco marcos, nos dois canais, com a **mesma** `dedupeKey` (a regra da FASE 32): pendente,
lembrete, confirmada, liberada e promovida. O aviso nasce em `participant_messages` (a
caixa de entrada) com `sentById` **nulo** — não há pessoa que enviou: o aviso é do sistema,
no prazo que a organização escolheu, e atribuí-lo a alguém seria inventar autoria.

**O carimbo do lembrete vem DEPOIS do envio.** Marcar antes perderia o aviso para sempre se
o processo caísse no meio; enviar antes de marcar só repetiria a TENTATIVA — e a repetição
não produz segunda mensagem, porque a `dedupeKey` é única no outbox e na caixa de entrada.
Entre perder o aviso e repetir a tentativa, repetir é o barato.

### 3.8 A varredura é idempotente pela chave do FATO

O cancelamento é um `updateMany` condicional por `status = 'PENDING'`: rodar duas vezes (ou
duas instâncias do worker ao mesmo tempo) libera a vaga **uma** vez — a mesma proteção que
o `drawnAt IS NULL` dá à apuração do sorteio (armadilha 68: comando idempotente precisa da
chave certa).

Ela é **cross-tenant** como as outras varreduras do worker (presenças, prazos de parecer):
o worker não tem instituição, então lista os tenants ativos e abre **uma transação por
instituição** com `withTenant`. Nenhuma linha é lida fora do contexto de tenant.

### 3.9 A fila de confirmações é a PRIMEIRA lista de inscritos do painel

Até aqui a Programação mostrava contagens ("12 inscritos") e não havia onde olhar quem são.
A confirmação tornou a lista inevitável — e ela nasceu ordenada por **urgência** (pendentes
primeiro, pelo prazo mais curto), não por agenda: quem abre essa tela vem trabalhar
(armadilha 80). O e-mail sai mascarado na lista, como no diretório de participantes
(FASE 32); a busca casa nome ou endereço completo.

---

## 4. ADRs

### ADR-170 — A confirmação é um estado da INSCRIÇÃO

**Contexto.** A fase precisa registrar que uma vaga foi confirmada, por quem e quando, e
precisa de um prazo por pessoa.

**Decisão.** `RegistrationStatus.PENDING` (que já existia) + carimbos na própria inscrição
(`confirmationDueAt`, `confirmedAt`, `confirmedById`, `confirmationReminderAt`). A política
e as exigências ficam na ATIVIDADE.

**Justificativa.** A pergunta da operação é uma só — "esta vaga está confirmada?" — e ela
vive na inscrição. Uma entidade paralela duplicaria a chave, exigiria JOIN em toda listagem
e permitiria confirmação órfã.

**Consequências.** O estado `PENDING` deixa de ser ocioso e passa a significar "vaga
retida"; toda leitura de inscrição precisa saber disso (a tela de minhas inscrições, a
página da atividade, a lista da equipe). Confirmar por ITEM de exigência fica para a
dívida **E48**.

### ADR-171 — `PENDING` retém a vaga E o lugar no evento

**Contexto.** Duas opções: a inscrição pendente ocupa lugar (e o prazo devolve), ou não
ocupa (e o prazo só cancela uma linha).

**Decisão.** Ocupa os dois: a vaga da atividade e o lugar na lotação do evento.

**Justificativa.** Sem reter, o prazo não teria consequência — a atividade aceitaria mais
gente do que cabe enquanto as confirmações não chegassem. E o cancelamento devolve os dois
contadores desde a FASE 1; reservar só um lado faria o contador do evento afundar a cada
prazo vencido.

**Consequências.** O contador da atividade inclui pendentes (a página pública diz "lotada"
enquanto houver vaga retida — que é a verdade). A liberação automática devolve exatamente o
que a ocupação tomou, e há teste de integração fechando a conta.

### ADR-172 — Quem confirma é a equipe (decisão do humano)

**Contexto.** Três desenhos possíveis: só a equipe, só o participante, ou os dois.

**Decisão.** Só a equipe, no local informado.

**Justificativa.** A confirmação é o registro de que a instituição RECEBEU (pagamento,
doação, item). O que a pessoa assinaria sozinha não é prova para quem cobra. Também
simplifica o desenho: não há caminho de autosserviço, não há `:own` para confirmar, e a
trilha responde "quem recebeu este pagamento?" com o `userId` da equipe.

**Consequências.** O aviso ao participante é INSTRUÇÃO (o que levar, até quando, onde ir),
e a tela dele não tem botão de confirmar. O participante PODE cancelar a própria inscrição
pendente — desistir é melhor que deixar a vaga presa até o prazo.

### ADR-173 — O prazo é por inscrição, no fuso do evento, vencendo no fim do dia

**Contexto.** O prazo poderia ser uma data-limite única da atividade, N dias da inscrição,
ou os dois.

**Decisão.** N dias contados da inscrição de cada pessoa (1 a 30, padrão 3), vencendo às
23:59 do dia local.

**Justificativa.** É a leitura humana de "3 dias para confirmar": o dia inteiro, não 72
horas. E o fuso é o da instituição (armadilha 38) — o processo roda em UTC no container.

**Consequências.** O rótulo do prazo é formatado no serviço (`confirmationDueLabel`) e
viaja pronto para a tela; a tela nunca formata com o fuso do processo. O prazo não é
limitado pela data da atividade: quem decide se ainda dá tempo é o organizador, ao escolher
os dias, e a inscrição só é aceita enquanto a janela está aberta.

### ADR-174 — `AUTO` é o padrão, e `REQUIRED` exige dizer o que e onde

**Decisão.** Política `AUTO` por padrão (o comportamento de tudo o que já existia);
`REQUIRED` exige janela válida **e** (ao menos uma exigência **ou** um local).

**Justificativa.** Recusar "exige confirmação" sem dizer o que nem onde evita o pior aviso
possível — o que não tem como ser obedecido. E `AUTO` descartar os campos do assunto (em
vez de recusá-los) permite desligar a política sem apagar o que estava escrito.

**Consequências.** Desligar a política com inscrições `PENDING` é **recusado**
(`INVALID_PENDING_CONFIRMATIONS`): essas inscrições ficariam sem saída — segurando vaga, sem
prazo e sem ninguém que possa confirmá-las. A tela mostra quantas são.

### ADR-175 — Liberação automática idempotente, com promoção na mesma transação

**Decisão.** A varredura cancela por `updateMany` condicional (`status = 'PENDING'`),
devolve os dois contadores, promove o primeiro da lista de espera e reindexa — tudo numa
transação por instituição; depois do commit, avisa os dois.

**Justificativa.** Rodar duas vezes não pode liberar duas vagas; e uma vaga devolvida sem a
promoção é uma vaga que ninguém ocupa (ou pior: dois caminhos que divergem sobre a
lotação).

**Consequências.** O job repetível roda de hora em hora (`0 * * * *`) e há CLI
(`npm run registrations:expire`, com `--agora` para conferir cenários) — o cron do host é o
caminho de produção, como nas partições da auditoria. Falha de AVISO não muda o código de
saída da CLI: o fato de negócio aconteceu.

### ADR-176 — Cinco avisos, dois canais, chave do FATO

**Decisão.** Pendente, lembrete, confirmada, liberada e promovida — cada um com mensagem na
caixa de entrada e e-mail no outbox, com a MESMA `dedupeKey` (`registration-…-<id>`).

**Justificativa.** Sem o aviso, a pessoa só descobre que precisava confirmar quando a vaga
já foi liberada. Com dois canais e uma chave, o aviso chega mesmo com o provedor fora, e o
reenvio do job não duplica.

**Consequências.** O carimbo do lembrete vem depois do envio (repetir a tentativa é barato;
perder o aviso não). `sentById` fica nulo nos avisos automáticos: não há autor humano.

### ADR-177 — A fila ordena por URGÊNCIA, não por agenda

**Decisão.** Atividades com pendentes primeiro, ordenadas pelo prazo mais curto; o próximo
vencimento aparece no cartão. A seleção inicial é essa.

**Justificativa.** A tela existe para uma fila com prazo. A primeira atividade por data de
início costuma ser a que tem menos pendências, e o organizador leria "Ninguém aguardando"
enquanto uma vaga vencia na atividade seguinte (armadilha 80 — encontrada pelo E2E).

**Consequências.** Depois de confirmar, a fila "anda sozinha" para quem ainda espera — quem
está trabalhando não volta ao topo a cada clique.

### ADR-178 — A promoção da lista de espera também ocupa o lugar no evento

**Contexto.** Encontrado ao implementar a liberação: `promoteNextFromWaitlist` reservava só
a vaga da atividade.

**Decisão.** Reservar o lugar no evento ANTES da vaga da atividade; se a vaga tiver sido
levada por outra transação, devolver o lugar do evento antes de desistir.

**Justificativa.** A promoção transforma a linha em inscrição CONFIRMADA, e toda inscrição
confirmada ocupa lugar no evento. Sem isso, o contador do evento fica abaixo do real a cada
vaga devolvida e reocupada — e o sintoma só aparece depois de muitos cancelamentos
(armadilha 79).

**Consequências.** A ordem das reservas virou parte do contrato do código (documentada no
próprio serviço), e um teste de integração fecha a conta: depois de liberar e promover, o
contador do evento é igual ao número de inscrições vivas.

---

## 5. Lições aprendidas

Defeitos REAIS encontrados nesta fase.

| Sintoma | Causa raiz | Correção |
|---|---|---|
| **O contador do EVENTO afundava** a cada vaga devolvida e reocupada: quem entrava pela lista de espera virava inscrição confirmada, mas o lugar na lotação do evento não era reservado de volta | O cancelamento devolvia os DOIS contadores (o da atividade e o do evento) e a promoção — que existe desde a FASE 3 — reservava só o da atividade. Encontrado ao implementar a liberação automática, que precisa devolver exatamente o que a ocupação tomou; o sintoma real só aparece depois de muitos cancelamentos ("o painel diz que há vaga e a inscrição no evento é recusada") | `promoteNextFromWaitlist` reserva o lugar no evento antes da vaga da atividade e o devolve se a vaga tiver sido levada por outra transação, com a ordem escrita no código. Teste de integração novo fecha a conta. Armadilha **79** |
| **A fila de confirmações abria em quem não tinha nada a fazer**: o E2E entrou na tela e leu "Ninguém aguardando confirmação" com uma vaga vencendo na atividade seguinte | A seleção padrão pegava a primeira atividade por **data de início** — a agenda, não o trabalho. A atividade mais próxima do início não é a mais urgente: numa programação de três dias, a primeira costuma ser a que tem menos pendências | A fila ordena por pendentes primeiro e pelo prazo mais curto (`_min(confirmationDueAt)` no mesmo `groupBy` dos contadores), com o próximo vencimento no cartão da atividade. Armadilha **80** |
| **O cartão de sucesso da inscrição desaparecia** antes de o teste conseguir lê-lo: a tela passava a mostrar "Vaga reservada — falta confirmar" no lugar do formulário | **Reincidência da armadilha 76**: a Server Action revalida a rota, o servidor relê a inscrição (agora `PENDING`) e a página substitui o formulário — o estado de sucesso do `useActionState` vive no componente que saiu de cena. Quem falhou foi o TESTE, que afirmava a mensagem transitória; o comportamento do produto estava certo (nada de prometer "confirmado" para uma vaga que ainda depende do balcão) | Os cenários passaram a afirmar o ESTADO DURÁVEL (`registration-status` com "falta confirmar"), como já fazia o cenário da jornada de inscrição desde a revisão da FASE 3 |
| O cenário E2E recebeu **"a lotação total do evento foi atingida"** ao se inscrever, com o evento recém-criado e vazio | A fixture do evento **omitiu** `capacity`, e o default do modelo é `0` — que significa ESGOTADO (a distinção `null` = ilimitado × `0` = esgotado está documentada no schema desde a FASE 3). O produto estava certo ao recusar | `capacity: null` explícito na fixture, com o porquê escrito no arquivo. Mesma classe da armadilha 74: **fixture incoerente com as regras do produto mede a própria fixture** |
| O E2E recusou `Tipo` como ambíguo (`Tipo`, `Tipo 1`, `Tipo 2`, `Tipo 3`) | O bloco de confirmação usa rótulos numerados para as linhas de exigência, e o casamento de rótulo do Playwright (e de leitor de tela) é por substring | Os três rótulos viraram `Categoria da exigência N`, `Descrição da exigência N` e `Observação da exigência N` — específicos e sem conter um ao outro. Armadilha **81** |
| **A correção do rótulo reintroduziu a ambiguidade**, agora dentro do próprio bloco: `Exigência 1` é substring de `Categoria da exigência 1`, e o `fill` recusou os dois campos | A mesma regra vale para o bloco novo: rótulo é identificador, e um rótulo "específico" que contém outro continua ambíguo. O E2E da fase pegou na execução seguinte | Os três rótulos passaram a não se conter (`Descrição da exigência N` no lugar de `Exigência N`), com o porquê escrito no componente. Armadilha **81** |
| **Seis cenários E2E de OUTRA fase quebraram** (`speaker-portal.spec.ts`): a organização não conseguia mais cadastrar a atividade do palestrante, e os cinco cenários seguintes falharam em cascata | A ambiguidade de rótulo, vista de fora: quem procurava `getByLabel('Tipo')` — o campo da atividade — passou a encontrar quatro campos. O código novo funcionava; o que quebrou foi a INTERAÇÃO com o que já existia, e só a bateria completa mostrou | Rótulos únicos (armadilha **81**) e a lição de método: **a fase não é medida só pelos testes dela** — a suíte inteira é quem prova que o que já funcionava continua funcionando |
| O catálogo de e-mails **quebrou** ao acrescentar cinco templates | O teste enumera o catálogo de propósito — "template novo sem exemplo quebra ali, em vez de passar despercebido" (FASE 15). Eu havia acrescentado os cinco avisos sem dar payload de exemplo | Os cinco exemplos entraram no teste, e a contagem do catálogo subiu para 16. O teste fez o trabalho dele |

---

## 6. Evidência de verificação

### 6.1 Bateria (árvore final)

```text
npm run lint                  → 0 erros, 0 warnings
npm run typecheck             → 0 erros
npm test                      → 73 arquivos · 1759 testes passando (era 71/1690)
npm run build                 → Compiled successfully, com a rota nova listada:
                                /t/[tenantSlug]/administracao/eventos/[eventId]/confirmacoes
npm run db:verify             → Contrato íntegro.
npm run db:verify:isolation   → 9/9 verificações passaram.
npm run db:verify:pooling     → Pooling íntegro.
npm run db:partitions         → partições do mês atual e dos seguintes (23.387 linhas)
npx prisma migrate status     → 30 migrations · "Database schema is up to date!"
npm run db:seed               → 5 atividades (1 delas exige confirmação de vaga) ·
                                1 vaga RETIDA (carla@example.test) — prazo até 25/09/2026, 23:59 (America/Bahia)
npm run registrations:expire  → Liberadas: 0 vaga(s) · 0 promoção(ões) (nada vencido)
npm run test:e2e              → 116 passed (5 novos desta fase)
```

### 6.2 O caminho de produção do relógio, provado por dentro

O cenário 4 do E2E **não** grava o vencimento no banco: ele inscreve duas pessoas (a vaga
retenha e a lista de espera), roda a CLI de produção com o relógio avançado e afirma o
efeito —

```bash
npx tsx prisma/scripts/expire-registrations.ts --agora=2026-09-25T12:40:00.000Z
```

```text
  LIBERAÇÃO AUTOMÁTICA DAS VAGAS NÃO CONFIRMADAS (FASE 34)
  agora: 2026-09-25T12:40:00.000Z
  Liberadas: 1 vaga(s) em 223 instituição(ões) · 1 promoção(ões) da lista de espera · 0 aviso(s) não entregue(s)
```

E o banco, depois: quem venceu ficou `CANCELED` com `cancelReason = 'Prazo de confirmação
vencido'`, quem esperava ficou `CONFIRMED`, o contador da atividade continua em **1** (a
vaga passou de mão, não sumiu) e o contador do evento continua igual ao número de inscrições
vivas. Os dois avisos existem no outbox, com as chaves `registration-released-<id>` e
`waitlist-promoted-<id>`.

### 6.3 Testes novos

| Arquivo | Testes | O que prende |
|---|---|---|
| `tests/unit/confirmation-rules.test.ts` | 44 | catálogo da política e dos tipos de exigência, validação (`REQUIRED` sem exigência e sem local, janela fora de 1–30, fração, teto de linhas, linha em branco descartada), leitura de JSON malformado, **o prazo no fuso do evento** (fim do dia, mesmo dia para quem se inscreve de madrugada, virada de horário de verão, fuso inválido), a contagem regressiva, o lembrete (só dentro da antecedência, nunca depois do vencimento, uma vez por carimbo), os seis estados da confirmação e as sete recusas de `canConfirmRegistration` |
| `tests/integration/registration-confirmation.test.ts` | 20 | a inscrição nasce `PENDING` **retendo a vaga** (contador da atividade **e** do evento) e avisa nos dois canais com a mesma chave; a segunda pessoa vai para a espera; o prazo é o fim do dia local; a equipe confirma (trilha com quem confirmou + recibo); confirmar de novo é recusado; **duas confirmações simultâneas = um efeito**; atividade automática não confirma; **prazo vencido não confirma** (e nada muda no banco); a instituição vizinha recebe `NOT_FOUND`; a varredura libera, promove, avisa os dois, **é idempotente** e o contador do evento fecha a conta; o lembrete sai uma vez e não sai para quem já confirmou; a fila não vaza a instituição vizinha, busca por nome e mascara o e-mail; `REQUIRED` sem nada é recusado, atividade aberta não aceita confirmação e **desligar a política com pendentes é recusado** |
| `tests/e2e/registration-confirmation.spec.ts` | 5 | a organização cria a atividade confirmável pela tela (e o resumo da programação assume a escolha); a pessoa se inscreve, vê o prazo/checklist/local **sem botão de confirmar** e recebe aviso no e-mail **e** na caixa de entrada; a equipe confirma na fila e a pessoa vê a vaga confirmada; o prazo vencido libera a vaga e promove quem esperava **pela CLI de produção**, com os dois avisos; rodar a liberação de novo não devolve uma segunda vaga |
| `tests/unit/email-communication.test.ts` (+5) | 44 | os cinco avisos novos renderizam assunto, HTML e texto — o teste enumera o catálogo (11 → 16), então template novo sem exemplo quebra ali |

### 6.4 Testes existentes que precisaram mudar (e por quê)

| Arquivo | Mudança | Motivo |
|---|---|---|
| `tests/unit/email-communication.test.ts` | catálogo de 11 para **16** templates, com payload de exemplo para os cinco novos | O teste enumera o catálogo de propósito: template novo sem exemplo **quebra** ali, em vez de passar despercebido |

---

## 7. Comandos operacionais

```bash
# ── A ESCOLHA DO ORGANIZADOR (programação) ─────────────────────────────────────────
# /t/<slug>/administracao/eventos/<eventId>   → Programação → criar/editar atividade
#   → "Confirmação de vaga": Automática (no ato) × Exige confirmação
#     · Prazo para confirmar (1 a 30 dias)
#     · O que é preciso (tipo + descrição + observação)
#     · Onde confirmar (secretaria, balcão) e orientações

# ── A FILA DA EQUIPE ──────────────────────────────────────────────────────────────
# /t/<slug>/administracao/eventos/<eventId>/confirmacoes
#   → pendentes ordenadas pelo prazo, busca por nome/e-mail, "Confirmar vaga"

# ── O PARTICIPANTE ────────────────────────────────────────────────────────────────
# /t/<slug>/minhas-inscricoes     → prazo, checklist e local (sem botão de confirmar)
# /t/<slug>/minhas-mensagens      → os cinco avisos na caixa de entrada

# ── O RELÓGIO (produção) ──────────────────────────────────────────────────────────
npm run registrations:expire               # libera as vencidas (o cron chama isto)
npm run registrations:expire -- --lembretes   # + avisa quem está perto do prazo
npm run registrations:expire -- --agora=2026-09-25T12:00:00Z   # confere um cenário
# O worker também roda os dois de hora em hora (job "registration-confirmation-sweep").

# ── O BANCO: quem está retendo vaga ───────────────────────────────────────────────
psql "$DATABASE_URL" -c '
  SELECT a.title, r.status, r."confirmationDueAt", r."confirmedAt", u.name
    FROM registrations r
    JOIN activities a ON a.id = r."activityId"
    JOIN "user" u ON u.id = r."userId"
   WHERE r."tenantId" = ''<tenantId>'' AND r.status IN (''PENDING'',''CONFIRMED'')
     AND a."confirmationPolicy" = ''REQUIRED''
   ORDER BY r."confirmationDueAt" NULLS LAST'

# Os avisos que saíram (o mesmo dedupeKey liga a mensagem ao e-mail):
psql "$DATABASE_URL" -c '
  SELECT m.template, m.status, m."dedupeKey", m.to
    FROM email_messages m
   WHERE m."tenantId" = ''<tenantId>'' AND m."dedupeKey" LIKE ''registration-%''
   ORDER BY m."createdAt" DESC LIMIT 20'
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Dívida | Impacto | Caminho |
|---|---|---|---|
| **E48** | **A confirmação é do CONJUNTO, não de cada exigência.** A equipe confirma a vaga inteira; não há como registrar "recebeu o alimento, falta o brinquedo" | Numa campanha com três itens, quem entregou dois fica no mesmo estado de quem não entregou nada — e a equipe resolve no balcão, no olho, ou aceita a confirmação parcial sem registro. A tela do balcão mostraria N caixas e o histórico diria exatamente o que foi recebido | Tabela de confirmações por exigência (`registration_confirmation_items`), com a confirmação geral derivada da regra "todas as obrigatórias cumpridas" — o estado da INSCRIÇÃO continua sendo um só |
| **E49** | **Não há prazo-limite da atividade além dos N dias.** O organizador escolhe "5 dias", e quem se inscreve no último dia antes do evento tem prazo até depois do evento começar | Uma vaga retida pode ser liberada com a atividade já em andamento (a varredura não olha a data da atividade, só o prazo). Quem se inscreve em cima da hora e não confirma ocupa o lugar no dia | Campo opcional de data-limite na atividade; o prazo da pessoa é o MENOR entre "N dias" e a data-limite (é a terceira opção que o humano não escolheu nesta fase) |

Pontos de atenção que **não** são dívidas novas, mas valem registro:

- **Quem confirma é a equipe, por decisão de escopo.** O caminho do participante
  (autoconfirmação) existe como extensão natural — a transição `PENDING → CONFIRMED` é a
  mesma, e a trilha já grava quem confirmou. O que muda é a guarda e o texto do aviso.
- **A política vale para as inscrições NOVAS.** Ligar `REQUIRED` numa atividade que já tem
  gente confirmada não descon vida ninguém: as linhas antigas continuam `CONFIRMED`, e o
  prazo só nasce com a inscrição. Isso está dito na tela.
- **A vaga retida conta como ocupada na página pública** ("lotada" com pendentes). É
  deliberado: a vaga está presa, e anunciar disponibilidade que o servidor vai recusar
  seria pior.
- **O lembrete é um só**, 24 h antes do vencimento. Não há escalada ("vence hoje", "última
  hora") — cada aviso novo custa um template e uma chave de dedupe.
- **O aviso de promoção também saiu do silêncio** (o `WAITLIST_PROMOTED`), mas ele só
  existe para quem é promovido por VAGA LIBERADA POR PRAZO e por cancelamento manual — o
  caminho da promoção é único, então os dois casos avisam.

---

## 9. Checklist de aceite

- [x] **Escolha do organizador no cadastro da atividade**: `Automática (no ato)` ×
      `Exige confirmação`, com o padrão preservando o comportamento anterior
- [x] **Prazo configurável** de 1 a 30 dias, contado da inscrição de cada pessoa, vencendo
      no fim do dia **no fuso do evento**
- [x] **O que é preciso para confirmar** em lista estruturada (pagamento, doação, item,
      outro) com observação, e **onde confirmar** — recusando `REQUIRED` sem um dos dois
- [x] **A vaga fica RETIDA** com quem se inscreveu: `PENDING` ocupa a vaga da atividade e o
      lugar na lotação do evento
- [x] **A equipe confirma** na fila de confirmações, com transição atômica, auditoria de
      quem confirmou e e-mail de recibo; a pessoa **não** tem botão de confirmar
- [x] **Vencido o prazo, a vaga é liberada automaticamente**: os dois contadores voltam, o
      primeiro da lista de espera é promovido e o próximo é reindexado
- [x] **A liberação é idempotente** — duas passadas não devolvem duas vagas — e roda no
      worker (de hora em hora) **e** por CLI (o cron do host)
- [x] **Aviso por e-mail E na plataforma** em cinco marcos (pendente, lembrete, confirmada,
      liberada, promovida), com `dedupeKey` do FATO nos dois canais
- [x] **Fila de confirmações** com busca por nome/e-mail, e-mail mascarado, ordenada pela
      urgência do prazo — a primeira lista de inscritos do painel
- [x] **Minhas inscrições** mostra prazo, contagem regressiva, checklist e local, e o
      estado "vaga confirmada pela organização" depois
- [x] **Atividade aberta não aceita confirmação** e **desligar a política com pendentes é
      recusado**, com o número de quem espera
- [x] **Doc, README e `AGENTS.md` atualizados**, com as armadilhas novas (79, 80 e 81) e a
      reincidência da 76 registrada nas lições
