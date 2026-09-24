# FASE 43 — Catálogo de gamificação: editar, excluir e cobrir os fatos

> **Pedido do humano, verbatim:** *"verifique se os gatilhos de Nova carta e Nova missão
> contemplam tudo que temos dentro do nosso sistema e que os participantes podem fazer.
> outra coisa é que Missões definidas e as cartas colecionáveis não tem opção de deletar ou
> editar, e precisamos ter."*

---

## 1. Sumário executivo

A fase nasceu de uma **auditoria** e virou três entregas: os fatos que a gamificação não
enxergava passaram a valer, o catálogo ganhou **editar** e **excluir**, e duas promessas
falsas saíram do formulário de missão.

### Entregas

| # | Entrega |
|---|---|
| 1 | **Editar carta e missão pela tela**: o serviço e a action já aceitavam o id (a tela é que não oferecia) — agora cada item tem o formulário preenchido, no mesmo lugar onde aparece, compartilhando os campos com o formulário de criação para os dois não divergirem |
| 2 | **Excluir carta** (lógica, com guarda de uso): sai do catálogo e deixa de ser concedida; **recusada** quando é prêmio de missão ou de QR de patrocinador, com a contagem; **o álbum de quem já ganhou não muda** |
| 3 | **Excluir missão** (lógica, com aviso): sai das duas listas (admin e participante), o progresso e o XP resgatado ficam |
| 4 | **Inscrição confirmada** vale **30 XP** — nas três portas: inscrição direta, promoção da lista de espera e confirmação de vaga (FASE 34) |
| 5 | **Certificado emitido** vale **50 XP**, uma vez por documento, no ponto por onde passam a emissão da tela **e** a geração do worker |
| 6 | **Sorteio ganho** vale **0 XP** e concede a **carta de "sorteado"** e progresso de missão — o prêmio já é a recompensa, e pontos por sorte premiariam o acaso. Só o ganhador: suplente é reserva |
| 7 | **Proposta de chamada** passou a valer o mesmo que o artigo: enviar paga `SUBMISSION_SUBMITTED` e **aceitar pelo protocolo da chamada paga `SUBMISSION_ACCEPTED`** — a mesma decisão valia XP por uma porta e nada pela outra |
| 8 | **Duas origens aposentadas**: "Indicação" e "Bônus" saíram do formulário de missão (nenhum caminho do sistema as emite); a lista do formulário passou a ser curada, e um teste prende que oferecida ∪ aposentada = todas as origens |

### Números da fase

| | |
|---|---|
| Arquivos novos | **4** — o teste unitário dos fatos, o teste de integração e o E2E do catálogo, além desta documentação |
| Arquivos alterados | **18** — domínio (tipos, XP, cartas, metas), motor de recompensas, ganchos, 5 serviços (inscrição, confirmação, certificado, sorteio, propostas), 2 actions, 2 telas do catálogo, serviço de cartas (álbum), serviço de admin, contrato de erro, schema e migração |
| Migrações | **1** — 3 valores em `XpSourceKind` + 3 em `CardTrigger` (37 → **38**), sem tabela nem coluna nova |
| Tabelas de tenant | **55** (nenhuma nova) |
| Testes novos | **25** — 14 unitários (12 dos fatos + 2 da regressão de meta), 11 de integração e **2 E2E** (a suíte vai de **2203** para **2228**; o E2E, de **146** para **148**) |
| Defeitos reais encontrados | **2** — **o gatilho novo aparecendo cru em duas telas** (achado na auditoria, corrigido antes desta fase) e **a criação de missão pela tela sendo impossível** com "Minutos mínimos" em branco (§5) |
| Dívidas quitadas | **nenhuma** — a fase não estava amarrada a dívida |
| Dívidas novas | **2** — **E58** (não há lista de arquivados nem restauração do que foi excluído) e **E59** (não há estorno do XP de inscrição quando a pessoa cancela) |
| Armadilhas novas | **0** — a 97 (FASE 42) e a 75 (valor sem leitor) explicam os dois defeitos |
| ADRs | **233 … 235** (a próxima é 236) |

---

## 2. O que a auditoria mostrou

O pedido tinha duas metades, e a primeira era uma pergunta: *os gatilhos contemplam tudo?*
A resposta honesta era **não**, e a auditoria precisou de três perguntas separadas:

**1. Todo gatilho de carta tem quem o conceda?** Sim — os 13 originais eram alcançáveis
(6 pelo motor, 2 por lote de marco, 3 derivados do saldo, 1 manual, e a visita do
patrocinador pela FASE 42). Nenhum gatilho morto.

**2. Toda origem de missão tem quem a emita?** **Não.** O formulário oferecia
`REFERRAL` ("Indique alguém", 250 XP na tabela) e `BONUS`, e **nenhum caminho do sistema os
emitia**: a missão nascia impossível de completar, e o organizador só descobria quando
ninguém progredia. Uma missão que promete e não cumpre é pior que uma missão ausente.

**3. Todo fato do participante tem gatilho?** **Não** — e eram os mais óbvios: inscrever-se,
emitir o certificado, ganhar um sorteio. A auditoria também encontrou uma **inconsistência
de porta**: aceitar uma proposta pelo protocolo da chamada (FASE 33) não pagava o XP que a
mesma decisão paga na tela do comitê, porque o prêmio morava na *action* de uma das portas.

### O que ficou de fora, de propósito

| Fato | Por que não entrou |
|---|---|
| **Inscrição automática em atividade aberta** (`EVENT_AUTO`) | Não é ato do participante: a linha nasce da inscrição no evento, e a instituição pode criar uma atividade aberta depois (`syncOpenActivityEnrollments`) — creditar ali pagaria por atividades que a pessoa nunca escolheu |
| **Palestrante: perfil e material** | É trabalho de organização, e o certificado de palestrante já premia o que importa |
| **Aceitar convite (equipe/palestrante/patrocinador)** | Somar XP a um aceite administrativo convidaria a criar contas só para pontuar |
| **Perfil público / completar perfil** | Ainda não há tela para o consentimento de nome público (dívida **E35**) — não se premia o que não se pode fazer |
| **Coautoria** | Decisão da FASE 4, mantida: a lista de autoria mistura gente sem conta, e distribuir por coincidência de nome seria pior que não distribuir |

---

## 3. Decisões técnicas

### 3.1 A chave de idempotência da inscrição é o ALVO, não a linha

A inscrição confirmada tem **três portas** (inscrição direta, promoção da lista de espera e
confirmação de vaga). A chave derivada da INSCRIÇÃO faria as três creditarem uma vez — e
faria também **cancelar e voltar a se inscrever pagar de novo**, porque a reinscrição cria
linha nova. Seriam 30 XP por volta, sem nenhum fato novo: farm trivial.

A chave é `registration:<tenant>:<user>:<alvo>`, onde o alvo é a **atividade** (quando há
uma) e o **evento** (na inscrição do evento). Cada vaga paga uma vez, para sempre. O teste
prende a escolha no próprio livro-razão: a chave gravada cita a atividade, e não o id da
inscrição.

### 3.2 O certificado credita na GERAÇÃO, não no pedido

Havia duas janelas possíveis: `requestCertificate` (cria a linha em `QUEUED`) e
`generateCertificate` (grava `ISSUED` com o arquivo no storage). A segunda é a certa por
dois motivos: o pedido pode nunca virar documento (falha de geração deixa a linha em
`QUEUED` com o motivo), e **é por ela que passam os dois caminhos** — a emissão imediata da
tela e a geração pelo worker. Registrar no pedido pagaria por um PDF que pode falhar.

### 3.3 O sorteio vale 0 XP — e o fato existe assim mesmo

Ser sorteado não é mérito, é acaso: dar pontos por sorte premiaria a aleatoriedade e
distorceria o ranking de quem estudou, avaliou e compareceu. Mas o fato precisa existir,
porque é ele que **concede a carta de "sorteado"** e move as missões de participação. É a
mesma régua de `TASK_COMPLETED` e `BONUS`: o valor vem do caso concreto, e aqui o caso não
pede pontos.

**Suplente não entra.** Ele é a reserva; creditá-lo premiaria um prêmio que talvez nunca
exista — e a entrega do prêmio (FASE 16/22) é outro fato, que não muda a posição.

### 3.4 Excluir carta: lógica, com guarda de PROMESSA

Duas coisas precisam continuar verdadeiras depois de uma exclusão:

1. **O que a pessoa conquistou não desaparece.** A carta sai do catálogo e para de ser
   concedida — mas continua no álbum de quem a ganhou. Sem isso, excluir uma carta apagaria
   do álbum alheio o que a pessoa conquistou, e uma coleção que apaga conquistas não é uma
   coleção. Por isso `getAlbum` passou a incluir a carta retirada **quando a pessoa a tem**.
2. **A promessa em vigor não pode ficar sem prêmio.** Carta usada como prêmio de missão ou
   de QR de patrocinador **recusa** a exclusão, com a contagem — quem completasse a missão
   receberia nada, e o estande anunciaria uma carta inexistente. É a régua da sala em uso
   (ADR-136): recusar dizendo o número, e não apagar em silêncio.

### 3.5 Excluir missão: permitido, com o histórico dito em voz alta

Nada aponta para uma missão — o que existe é o **progresso** das pessoas. Por isso a
exclusão é permitida, o diálogo **avisa** quantas progrediram e quantos resgataram, e nada
é apagado: o progresso fica, e o XP já creditado **não é estornado**. Cancelar conquista
alheia seria outra operação, e ela tem nome — ajuste de XP (que existe, com trilha).

### 3.6 O formulário de missão passa a ser uma lista CURADA

`MISSION_TRIGGER_KINDS` (domínio) é a lista que o formulário oferece, e um teste prende a
união: **oferecidas ∪ aposentadas = todas as origens do enum**. Ou seja, uma origem nova
não pode ser esquecida em silêncio (o teste reprova) e uma origem sem emissor não pode ser
oferecida (o teste reprova). Os valores `REFERRAL` e `BONUS` continuam no enum — há
histórico gravado com eles, e o extrato precisa continuar legível.

---

## 4. ADRs

### ADR-233 — O crédito da gamificação sai DEPOIS do commit do fato

**Contexto.** Três fatos novos entraram em fluxos que já existiam: inscrição (com reserva
atômica de vaga), certificado (com storage) e sorteio (com resultado assinado e anunciado).

**Decisão.** Todo gancho novo roda **depois do commit** do fato e **nunca lança** — a mesma
regra do invariante nº 8, aplicada aos três. Quando o fluxo é transacional e o gancho
precisa de dados de dentro dele, o gancho **relê o estado no banco** (`...ById`) em vez de
receber o contexto por parâmetro.

**Justificativa.** É a lição da armadilha 97 ao contrário: um erro de recompensa dentro da
transação do fato aborta o fato. E a releitura não é desconfiança — é o que permite chamar
o mesmo gancho de portas diferentes (as três da inscrição) sem que cada uma carregue o
contexto até lá; se a linha não estiver `CONFIRMED`, não há fato e a resposta é `null`.

**Consequências.** (a) O crédito pode atrasar segundos em relação ao fato, e é idempotente,
então reprocessar é seguro; (b) falha de gamificação não aparece na tela do fato (só no
log), porque o fato está consumado; (c) o teste de integração chama o **serviço real**
(inscrição, certificado, sorteio) e confere o livro-razão, e não o gancho isolado.

### ADR-234 — A origem nova é explícita, e a lista de missões é curada

**Contexto.** A auditoria mostrou duas origens oferecidas sem emissor (`REFERRAL`,
`BONUS`) e três fatos sem origem nenhuma.

**Decisão.** Cada fato novo ganhou **origem própria** (`REGISTRATION_CONFIRMED`,
`CERTIFICATE_ISSUED`, `RAFFLE_WON`) em vez de reaproveitar `BONUS`, e o formulário de missão
passou a oferecer só as origens com emissor declarado.

**Justificativa.** "Bônus" não diz de quê: reaproveitar apagaria a origem no extrato e
tornaria impossível responder à pergunta que a instituição faz primeiro — *de onde vem o XP
deste evento?*. E oferecer uma origem que ninguém emite é uma promessa que o produto não
cumpre: o organizador configura, ninguém progride, e a conclusão dele é que a plataforma
não funciona.

**Consequências.** (a) Migração de enum (2 tipos, 6 valores), sem tabela nem coluna; (b) o
mapeamento `XP_SOURCE_TO_CARD_TRIGGER` cresceu junto — sem o valor do lado da carta, uma
colecionável de "sorteado" não teria como ser configurada; (c) `SPONSOR_QR` continua **fora**
do mapeamento automático, porque a carta da visita é concedida pelo próprio fluxo da
leitura (mapear daria duas concessões por leitura).

### ADR-235 — Excluir é retirar de circulação, não apagar

**Contexto.** Os dois catálogos (cartas e missões) não tinham exclusão, e ambos são
referenciados por fatos já acontecidos: `user_cards` (o álbum), `user_task_progress` (quem
progrediu) e, no caso da carta, missões e QRs de patrocinador.

**Decisão.** Exclusão **lógica** nos dois casos (`deletedAt` + `isActive: false`), com
trilha; **guarda de uso** só para a carta (prêmio de missão/QR ⇒ recusa com contagem), e
**aviso** para a missão (quantas pessoas progrediram). O álbum passa a mostrar a carta
retirada para quem a possui.

**Justificativa.** O invariante nº 7 vale aqui: o que aconteceu é dado. Apagar a linha
levaria junto o álbum de terceiros e o histórico de progresso — e a guarda existe porque
uma carta-promessa precisa continuar existindo enquanto a promessa existir.

**Consequências.** (a) Não há tela de arquivados nem restauração — quem excluir por engano
precisa de suporte (dívida **E58**); (b) a carta retirada some do catálogo para quem não a
tem, e fica para quem a tem; (c) `CARD_IN_USE` entrou no contrato de erro do admin, ao lado
de `ROOM_IN_USE`.

---

## 5. Lições aprendidas — defeitos REAIS encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | **`SPONSOR_QR` aparecia CRU no seletor de "Nova carta" e na frase da missão do participante** (achado na auditoria que abriu a fase) | Os dois mapas de rótulo eram `Record<string, string>` e caíam no `?? trigger`: acrescentar um valor ao enum **não reprovava nada**, e o fallback escondia a falta. Família da armadilha 75, do lado do rótulo | Os mapas passaram a ser **fechados pelo tipo** (`Record<CardTrigger, string>` e `Record<XpSourceKind, string>`): gatilho sem rótulo **não compila**. `AdminCardRow.trigger` virou tipo do domínio para permitir o índice fechado, e um teste prende os mapas do domínio contra o enum cru |
| 2 | **Criar missão pela TELA era impossível: "Meta inválida. `minutes` deve ser um inteiro maior que zero"** — com o campo "Minutos mínimos" em branco, que é o caso normal. **Achado pelo E2E novo**, na primeira execução | O formulário manda a chave `minutes` **sempre**, com `null` quando vazio; o `parseTaskTarget` só olhava `!== undefined`, então `null` caía na validação, `Number(null)` dava `0` e o domínio recusava. O tipo do alvo diz `minutes: number \| null` — ou seja, `null` É "sem limite", e a validação contradizia o próprio contrato | `null` passou a ser tratado como ausente (nas duas chaves numéricas), e o valor inválido de verdade (zero, negativo, texto) continua recusado. Dois testes unitários prendem os dois lados. **O defeito existia desde que o formulário de missão nasceu**: nenhum teste o pegava porque o único E2E de gamificação criava missões pelo banco — o caminho da TELA nunca era exercitado |

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 97 arquivos · 2228 testes passando
npm run build ..................... ✓ Compiled successfully
npm run db:verify ................. Contrato íntegro.
npm run db:verify:isolation ....... 9/9 verificações passaram.
npm run db:partitions ............. partições do mês atual e dos seguintes garantidas
npx prisma migrate status ......... 38 migrations found · Database schema is up to date!
npm run db:seed ................... ✓ gamificação: 7 cartas, 6 missões e 9 fatos de XP
npm run test:e2e .................. 148 passed
npx playwright test tests/e2e/gamification-catalog.spec.ts
                                   → 2 passed · a organização edita e exclui carta e missão
                                     pela tela, e a inscrição confirmada aparece no extrato
                                     do participante com 30 XP
```

O que os testes provam, do ponto de vista de quem usa:

1. a organização **cria**, **edita** (o mesmo id, o nome novo) e **exclui** carta e missão
   pela tela — a missão some da lista, e o banco mostra `deletedAt` preenchido (exclusão
   lógica);
2. o participante se inscreve numa atividade pela **página pública** e vê **30 XP** com a
   origem "Inscrição confirmada" no extrato de conquistas;
3. a exclusão da carta **não** tira do álbum de quem a ganhou, **para** de concedê-la, e é
   **recusada** quando ela é prêmio de missão ou de QR de patrocinador;
4. quem sai da lista de espera só recebe o crédito quando a vaga é confirmada, e a vaga
   retida só credita no balcão (FASE 34);
5. o certificado credita na geração (uma vez por documento), e o sorteio credita o
   **ganhador** com 0 XP, concedendo a carta de "sorteado" — o suplente não recebe nada em
   nenhum dos dois fatos.

---

## 7. Comandos operacionais

```bash
# Onde a organização edita e exclui
/t/<slug>/administracao/cartas
/t/<slug>/administracao/missoes

# O extrato do participante: as origens novas aparecem com nome em português
/t/<slug>/conquistas

# Conferir no banco o que a fase credita
psql "$DATABASE_URL" -c 'SELECT source, count(*), sum(amount) FROM xp_transactions WHERE source IN ('"'"'REGISTRATION_CONFIRMED'"'"','"'"'CERTIFICATE_ISSUED'"'"','"'"'RAFFLE_WON'"'"') GROUP BY source'
psql "$DATABASE_URL" -c 'SELECT slug, name, "deletedAt" FROM card_templates WHERE "deletedAt" IS NOT NULL ORDER BY "deletedAt" DESC'
psql "$DATABASE_URL" -c 'SELECT slug, name, "deletedAt" FROM task_definitions WHERE "deletedAt" IS NOT NULL ORDER BY "deletedAt" DESC'

# As origens oferecidas no formulário de missão (lista curada)
grep -A 15 'MISSION_TRIGGER_KINDS' src/domain/gamification/types.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

* **E58 (nova) — não há lista de arquivados nem restauração.** Excluir uma carta ou uma
  missão a tira das listas, e não há tela para vê-la de novo: quem excluir por engano
  depende de suporte (`UPDATE deleted_at = NULL`). O caminho é um filtro "arquivados" com
  o botão de restaurar — o `deletedAt` já guarda tudo o que é preciso.
* **E59 (nova) — o XP da inscrição não é estornado quando a pessoa cancela.** A chave é o
  alvo, então reinscrever-se não paga de novo; mas quem se inscreveu, recebeu 30 XP e
  cancelou fica com os pontos de uma vaga que não usou. Estorno é decisão de negócio (e o
  projeto nunca estorna XP por desenho: ajuste manual existe para corrigir caso a caso).
* **A origem do crédito é gravada, e não o alvo da vaga.** A chave de idempotência cita a
  atividade ou o evento, mas não há coluna dizendo "este XP é daquela vaga" — para
  reconciliar é preciso ler a chave. Registro por coluna é o caminho se algum dia houver
  estorno automático.
* **Excluir a carta deixa o `slug` ocupado.** O índice único `(tenantId, slug)` não
  considera `deletedAt`, então recriar uma carta com o mesmo identificador é recusado com
  "já existe uma carta com este identificador" — e a mensagem não diz que a anterior foi
  excluída (armadilha clássica de exclusão lógica). Vale uma mensagem específica.
* **As telas do catálogo não paginam.** `listCardTemplates` e `listMissions` trazem até 200
  itens com as contagens de uso por item; um catálogo grande vai pesar (mesma família da
  **E52**).
* **A trilha da exclusão guarda quem excluiu e quando**, e a restauração (quando existir)
  precisa entrar na mesma trilha — não é o caso hoje, porque restaurar não existe.

---

## 9. Checklist de aceite

* [x] **Editar** carta e missão pela tela, com o id preservado (editar não recria)
* [x] Os campos de criação e de edição são os **mesmos** (um componente), para não
      divergirem e apagarem o que não mostram
* [x] **Excluir** carta e missão pela tela, com confirmação e exclusão **lógica**
* [x] A carta que é **prêmio de missão ou de QR** recusa a exclusão, com a contagem
* [x] O **álbum de quem ganhou** a carta excluída continua mostrando a carta
* [x] A carta excluída **para de ser concedida** (não entra mais no sorteio de candidatas)
* [x] A missão excluída some das **duas** listas, e progresso e XP resgatado ficam
* [x] **Inscrição confirmada** credita 30 XP nas **três** portas, uma vez por vaga
* [x] **Certificado emitido** credita 50 XP uma vez por documento, nos dois caminhos de geração
* [x] **Sorteio ganho** credita o ganhador (0 XP) com a carta, e **não** o suplente
* [x] **Proposta** de chamada credita ao enviar e ao aceitar, com a chave da submissão
      (as duas portas de decisão não pagam em dobro)
* [x] **Indicação** e **Bônus** saíram do formulário, e um teste prende a união das listas
* [x] Todo gancho é **não-fatal** e roda **depois do commit** do fato
* [x] **A criação de missão pela tela funciona** com o campo de minutos em branco (defeito 2)
* [x] Nenhum rótulo de gatilho chega cru à tela (mapas fechados pelo tipo)
* [x] Toda a suíte verde (**2228** testes + **148** E2E), com os testes das fases anteriores intactos
* [x] Documentação da fase, README, `AGENTS.md` e dívidas (E58, E59) atualizados
