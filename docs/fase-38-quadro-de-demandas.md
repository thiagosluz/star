# FASE 38 — Quadro de demandas internas do evento

> **Escopo definido pelo humano**, com sete decisões escolhidas antes do código: um
> quadro **por evento**, tarefa interna chamada **demanda**, **colunas configuráveis**
> (nascendo com um conjunto padrão), só a **equipe ativa da instituição** pode ser
> atribuída, **equipe do evento** como entidade (nome, líder e membros), **início +
> prazo + concluído em** com atraso no fuso do evento, comentário com **@menção**
> avisando por e-mail e caixa de entrada, e **arrastar e soltar + botões** com o quadro
> funcionando **sem JavaScript**.

---

## 1. Sumário executivo

A instituição já sabia **o que** vai acontecer (a programação) e **quem** vem (as
inscrições). Faltava o que fica no meio: **o trabalho da equipe**. Quem faz o quê, até
quando, o que travou e o que já foi entregue — a pergunta que, até aqui, só se
respondia em planilha paralela e grupo de mensagens.

Esta fase entrega o quadro: uma diretoria por coluna, cartões com responsáveis, prazo,
equipe, conversa e histórico. E entrega com três decisões que evitam os defeitos
clássicos de um Kanban:

* **a coluna é o estado, e `isDone` é dado** — renomear "Concluído" para "Feito" não
  pode zerar o histórico de quem terminou;
* **mover é escrita condicional** pelo que a tela viu: dois monitores arrastando o
  mesmo cartão produzem **um** movimento, e o segundo recebe "alguém moveu antes de
  você";
* **o cartão funciona sem JavaScript** — o arrastar é atalho, o formulário do cartão é
  o caminho. É o que quita a dívida **E50 no quadro** (a raiz, `InlineActionForm`,
  continua aberta e está declarada).

### Entregas

| Entrega | Onde |
|---|---|
| Regra pura do quadro: prioridade, colunas, ordenação em bloco de 10 em 10, prazo do dia inteiro no fuso do evento, situação derivada, menções, liderança de equipe e resumo por equipe/pessoa | `src/domain/events/demand-rules.ts` |
| Aplicação: quadro (nascendo na primeira leitura), demanda, movimento condicional, atribuição, comentário com menção, colunas, equipes, liderança e a varredura de prazos | `src/lib/events/demand-service.ts` |
| Quatro avisos (atribuição, menção, prazo próximo, atraso) pelo caminho compartilhado `deliverNotice` (caixa de entrada + outbox) | `src/lib/events/demand-notices.ts` |
| Quatro templates de e-mail puros (17 → 21 no catálogo) | `src/domain/communication/email-templates.ts` |
| Migração à mão: **9 tabelas** com RLS + FORCE, políticas, concessões e o **índice único parcial** que garante UM líder por equipe | `prisma/migrations/20260923190000_event_demand_board/` |
| Cinco permissões novas (`demand:read`, `demand:manage`, `demand:assign`, `demand:assign:own-team`, `demand:team:manage`) | `src/domain/rbac/permissions.ts` |
| Server Actions do quadro (demanda, movimento em duas portas, atribuição, comentário, colunas e equipes) | `src/app/actions/demand-actions.ts` |
| Quadro (resumo, filtros, cartões, configuração de colunas), ficha da demanda (edição, responsáveis, conversa, histórico) e equipes do evento | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/demandas/**`, `.../equipes/page.tsx` |
| Arrastar e soltar por delegação de evento, com o formulário do cartão como caminho sem JavaScript | `src/components/admin/demand-board-dnd.tsx` |
| Rotina `demand-due` no worker e no painel de rotinas (5 → 6 rotinas) | `src/domain/platform/job-catalog.ts`, `src/lib/communication/email-queue.ts`, `src/workers/index.ts` |
| Testes: **34** unitários, **20** de integração e **5** E2E (o quadro pela tela, o movimento sem JavaScript, o arrastar, a menção e o atraso) | `tests/unit/demand-rules.test.ts`, `tests/integration/demand-board.test.ts`, `tests/e2e/demand-board.spec.ts` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **12** — 1 de domínio, 2 de aplicação, 1 de actions, 1 componente, 3 páginas, 1 migração e 3 de teste |
| Arquivos alterados | **11** — `schema.prisma`, o contrato de schema, o catálogo de permissões, a guarda de página, os templates de e-mail, o catálogo de rotinas, a fila, o worker, a página do evento, o seed e o teste de e-mail |
| Migrações | **1** nova — total **34** |
| Tabelas sob RLS | **42 → 51** (quadro, colunas, demandas, responsáveis, comentários, menções, linha do tempo, equipes e membros) |
| Permissões | **60 → 65** |
| Templates de e-mail | **17 → 21** |
| Rotinas automáticas | **5 → 6** |
| Testes novos | **58** no Vitest (34 unitários + 20 de integração + 4 do catálogo de e-mail) — a suíte foi de **1919/86** para **1977/88** — e **5** E2E (128 → 133) |
| Defeitos reais encontrados | **8** — a demanda nasceu sem `eventId` (a varredura de prazos não tinha o fuso do evento por linha); a guarda de página devolvia `Principal | null`; **seis** tamanhos de fonte fora da escala tipográfica reprovados pelo guard do design system; o catálogo de e-mail cresceu para 21 e o teste de enumeração não; a suíte inteira mediu a primeira passada da rotina recém-registrada no worker; uma asserção de E2E que casava o *slug* da instituição em vez do destino; o E2E da FASE 36, que contava cinco rotinas, reprovou com a sexta; e o teste da varredura afirmava contagem global numa função cross-tenant com banco compartilhado |
| Dívidas quitadas | **nenhuma integralmente** — a **E50** fica **pela metade** (ver §8) |
| Dívidas novas | **2** — **E51** (reordenar sem mouse) e **E52** (quadro sem paginação) |
| ADRs | **200 … 212** (a próxima é 213) |

---

## 2. O problema mais difícil: **mover o cartão é uma decisão de concorrência**

Um Kanban parece uma tela de arrastar caixas. Não é: é um sistema de **estado
compartilhado com escrita otimista**, e as duas pessoas que olham o mesmo quadro ao
mesmo tempo são o caso NORMAL — não a exceção. O coordenador move "Fechar o contrato
do som" para "Em andamento" enquanto a equipe, no balcão, arrasta o mesmo cartão para
"Bloqueado". Os dois estão certos: cada um agiu sobre o que estava vendo.

A resposta em JavaScript (ler a coluna, comparar, decidir) perde exatamente nessa
janela: as duas leituras acontecem antes das duas escritas, e as duas gravam. O quadro
terminaria com a coluna de quem o banco atendeu por último — e nenhuma das duas
pessoas saberia que o outro movimento existiu.

Por isso a escrita **condicional**: `UPDATE … WHERE id = ? AND "columnId" = ?`, onde o
segundo valor é a coluna **que a tela viu** (o formulário carrega a coluna de origem; o
arrastar manda a coluna de onde o cartão foi pego). Zero linhas não é erro de
infraestrutura: é a resposta de negócio `ALREADY_MOVED`, que a tela transforma em
"recarregue o quadro". É o invariante nº 5 do projeto aplicado a um cartão.

O segundo problema difícil é o **significado de "atrasada"**. O prazo é o DIA inteiro
no fuso do evento (mesma decisão da FASE 34): quem tem prazo hoje ainda está dentro
dele às 22h. Comparar o INSTANTE do prazo com o agora acusaria atraso na manhã do
próprio dia — e uma tela que chama de atrasado quem está no prazo ensina a operação a
ignorar o alerta. A comparação é entre **chaves de dia locais** (`"2026-09-26"`),
nunca entre instantes.

O terceiro é a **ordem**. Reordenar cartão linha a linha viola qualquer índice de
posição e transforma um arrastar em N escritas concorrentes. A posição anda de 10 em
10 — inserir entre dois vizinhos é uma escrita — e, quando a folga acaba, o serviço
reescreve a coluna inteira em uma transação (o mesmo caminho dos blocos de página da
FASE 17). `positionBetween` devolver `null` é o sinal de "reescreva"; a folga não é
enfeite, é o que evita a reescrita na maioria dos movimentos.

---

## 3. Decisões técnicas

### 3.1 O nome: "demanda", e não "tarefa"

`TaskDefinition` e `UserTaskProgress` **já existem** desde a FASE 5 — são as missões da
gamificação —, e `task:manage` é a permissão de quem as cadastra. Chamar de "tarefa" o
trabalho da equipe criaria duas entidades diferentes com o mesmo nome no schema, na
permissão e no menu. O humano escolheu "demanda", e o código seguiu: `Demand`,
`demand:*`, `/demandas`.

### 3.2 A situação é derivada, nunca gravada

`demandSituation` responde `DONE`, `OVERDUE`, `DUE_TODAY` ou `OPEN` a cada leitura, a
partir do prazo, da conclusão e do dia local. Gravada, ela mentiria no dia seguinte: um
cartão que "vence hoje" continuaria com a linha dizendo isso amanhã. Concluída vence o
atraso: quem resolveu não segue sendo acusado.

### 3.3 O líder é DADO, não papel

Líder de equipe é uma linha em `event_team_members` com `isLead`, e o banco garante
**um por equipe** com um índice único parcial (`WHERE "isLead"`). O RBAC não conhece
equipes: `demand:assign:own-team` diz que o papel *pode tentar*, e a **posse** é
conferida no serviço (`leadsTeam`, contra a liderança real de quem age). Criar um papel
por equipe obrigaria a mexer no catálogo de permissões a cada equipe nova — o invariante
nº 4 resolvido com dado em vez de configuração.

### 3.4 A menção é LINHA, não texto procurado

Varrer o corpo do comentário atrás de `@` e casar com nomes quebra de três jeitos: duas
"Ana Paula" viram sorteio; "João" casa com "João Pedro"; e o acento da digitação deixa
de fora justamente quem se escreve com acento. O formulário manda os **ids** de quem foi
escolhido (num `<select multiple>`, que funciona sem JavaScript) e o `@Nome` no texto é
conveniência de leitura. A lista é filtrada contra a equipe ativa da instituição e
contra o próprio autor.

### 3.5 O quadro nasce na primeira leitura

Criar o quadro junto com o evento obrigaria a migrar todos os eventos que já existem e a
manter o gancho em todo caminho que cria evento. Preguiçoso, a área nova não toca em
nada do que já funcionava — e é **idempotente** por construção: `@@unique([eventId])` no
quadro e `skipDuplicates` nas colunas fazem dois pedidos simultâneos produzirem um
quadro com cinco colunas.

### 3.6 Duas portas para a mesma escrita

`<form action={fn}>` no React só aceita `(formData) => void`, e a ação com
`useActionState` recebe `(prev, formData)`. Em vez de escolher uma (perdendo o arrastar
com aviso **ou** o quadro operável sem JavaScript), `moveDemandAction` e
`moveDemandFormAction` chamam o MESMO serviço. O formulário do cartão mostra o
resultado; o arrastar devolve a mensagem para quem arrastou.

---

## 4. ADRs

### ADR-200 — A tarefa interna se chama DEMANDA, para não colidir com a gamificação

**Contexto.** `task:manage`, `TaskDefinition` e `UserTaskProgress` já nomeiam as missões
da FASE 5. Um segundo conceito chamado "tarefa" apareceria no mesmo catálogo de
permissões e no mesmo schema.

**Decisão.** O trabalho da equipe é **demanda** em todo lugar: modelo (`Demand`),
permissões (`demand:*`), rota (`/demandas`) e tela.

**Consequências.** Nenhuma ambiguidade para quem lê o código; o custo é um nome a mais
para aprender. A regra de rótulo único (armadilha 81) vale também para nomes de
conceito, não só para rótulos de formulário.

### ADR-201 — A coluna é o estado e `isDone` é dado

**Contexto.** As colunas são configuráveis: o organizador renomeia, cria, reordena e
exclui. Se "concluído" fosse o NOME de uma coluna, renomeá-la apagaria o significado.

**Decisão.** Cada coluna carrega `isDone`; entrar numa coluna `isDone` grava
`completedAt`, sair limpa. Desmarcar a última coluna de conclusão é recusado
(`DONE_COLUMN_REQUIRED`) — o quadro ficaria sem lugar para concluir.

**Consequências.** O nome é rótulo e a conclusão é dado; o organizador pode chamar a
coluna de "Feito", "Entregue" ou "Publicado" sem perder o histórico.

### ADR-202 — A posição NÃO é única, e reordenar reescreve o bloco

**Contexto.** Uma restrição de unicidade sobre `(boardId, position)` exigiria constraint
`DEFERRABLE` para sobreviver ao meio da transação de reordenação (o banco vê cada
comando, não o resultado final).

**Decisão.** `position` é índice simples e a leitura ordena por `(position, id)`;
reordenar reescreve o bloco inteiro em 10, 20, 30…, como `PageBlock.displayOrder`
(FASE 17).

**Consequências.** Nenhuma constraint exótica e ordem determinística. Empates são
possíveis em teoria e desempatados pelo id.

### ADR-203 — Mover é escrita CONDICIONAL pelo que a tela viu

**Contexto.** Duas pessoas movem o mesmo cartão a partir do mesmo estado de tela.

**Decisão.** `updateMany` com `where: { id, columnId: <coluna de origem que a tela
mostra> }`. Zero linhas é `ALREADY_MOVED` — resposta de negócio com mensagem para
recarregar o quadro.

**Consequências.** Um movimento por vez, sem travar a linha e sem `SELECT FOR UPDATE`;
o segundo movimento não é silenciosamente perdido, ele é recusado com explicação.

### ADR-204 — A menção é LINHA, e o texto não menciona ninguém

**Contexto.** Casar `@` com nomes é ambíguo (homônimos, prefixos, acentos) e falha em
silêncio quando não encontra.

**Decisão.** `demand_mentions` guarda quem foi mencionado e quando foi avisado; o
formulário manda ids. `normalizeMentionIds` filtra contra a equipe ativa e contra o
autor. O `@Nome` no texto é leitura, não fato.

**Consequências.** Menção determinística e aviso idempotente (`dedupeKey` = id da
menção). Não há "menção que não avisou ninguém por causa de um acento".

### ADR-205 — Só vínculo MEMBER ATIVO pode ser atribuído, entrar em equipe ou ser mencionado

**Contexto.** Participante de evento e palestrante convidado têm vínculo `PARTICIPANT`.
A lista de responsáveis poderia ser "todos os usuários da instituição".

**Decisão.** A definição de "quem trabalha aqui" é UMA (`activeMembers`): vínculo
`MEMBER` com situação `ACTIVE`. Vale para atribuição, equipe e menção.

**Consequências.** A lista de responsáveis é a equipe de verdade; a quota de equipe do
plano não é consumida por quem só se inscreveu (F14/F21).

### ADR-206 — O líder de equipe distribui dentro da PRÓPRIA equipe, com a posse conferida no serviço

**Contexto.** "Divisão de equipes" (decisão do humano) pede que alguém distribua trabalho
dentro da equipe sem receber a permissão de coordenar o evento inteiro.

**Decisão.** `demand:assign:own-team` existe no catálogo e o serviço verifica a posse
(`isLead` da equipe da demanda) e a pertinência dos atribuídos (membros daquela equipe).
Recusa com `NOT_LEADER`.

**Justificativa.** É o invariante nº 4 (permissão `:own` sem posse explícita nega)
aplicado a um alvo que não é o usuário: o RBAC compara `:own` com o `userId`, e "minha
equipe" é um fato do dado.

**Consequências.** Nenhum papel novo por equipe criada; e a promessa é estreita — o líder
não recruta gente de fora da própria equipe.

### ADR-207 — O prazo é o fim do DIA LOCAL do evento, e "vence hoje" não é atraso

**Contexto.** Prazo é lido por gente, no fuso do evento (armadilha 38).

**Decisão.** `dueAtFromDay` converte `"AAAA-MM-DD"` no instante de 23:59 no fuso do
evento (duas passagens, horário de verão), e a comparação de atraso é entre **chaves de
dia** locais, com `daysLate` contando dias de calendário.

**Consequências.** Quem tem prazo hoje não aparece como atrasado; o aviso de prazo usa o
dia local na `dedupeKey`, então a rotina horária avisa uma vez por dia.

### ADR-208 — O quadro nasce na primeira LEITURA, de forma idempotente

**Contexto.** Criar o quadro no cadastro do evento exigiria backfill e ganchos em todos os
caminhos que criam evento.

**Decisão.** `ensureDemandBoard` faz `upsert` pelo `eventId` (relendo quando perde a
corrida para o índice único) e cria as colunas padrão com `skipDuplicates`.

**Consequências.** A área nova não toca no que já existia; duas abas abrindo o quadro
simultaneamente terminam com um quadro e cinco colunas.

### ADR-209 — Os avisos usam o caminho compartilhado, com a chave do FATO

**Contexto.** Quatro avisos novos (atribuição, menção, prazo próximo e atraso), dois deles
disparados por uma rotina horária.

**Decisão.** Todos passam por `deliverNotice` (mensagem na caixa de entrada + e-mail no
outbox com a MESMA `dedupeKey`). A chave carrega o fato: o instante da linha de
responsável, o id da menção, ou o **dia local** nos avisos de prazo.

**Consequências.** Rotina horária produz um aviso por dia; reatribuir depois notifica de
novo (é outro fato); falha de e-mail não desfaz movimento (invariante 8).

### ADR-210 — Quem responde é quem é avisado; sem responsável, o líder da equipe

**Contexto.** Um cartão sem dono é o que o coordenador precisa descobrir — e avisar a
equipe inteira encheria a caixa de todo mundo com o que é de um.

**Decisão.** A varredura avisa as PESSOAS atribuídas; sem ninguém atribuído, o líder da
equipe da demanda; sem equipe, ninguém (e a demanda aparece como "sem responsável" no
resumo). O resumo por pessoa tem a linha `SEM_RESPONSAVEL`.

**Consequências.** O aviso é acionável; "sem responsável" vira uma métrica visível em vez
de silêncio.

### ADR-211 — Equipe em uso e coluna com cartões recusam a exclusão

**Contexto.** As FKs são `SET NULL`/`CASCADE`: excluir uma equipe devolveria as demandas
para "sem equipe" em silêncio, e excluir uma coluna apagaria os cartões junto.

**Decisão.** As duas exclusões são guardadas no serviço, com a contagem no motivo
(`TEAM_IN_USE`), e a FK continua sendo a rede de segurança. Mesma escolha da sala em uso
(F3 revisão).

**Consequências.** Perda de dado por um clique distraído deixa de ser possível.

### ADR-212 — A rotina de prazos entra no worker e no catálogo

**Contexto.** A FASE 36 centralizou as rotinas em `job_runs` + catálogo, com exclusão
mútua e painel.

**Decisão.** `demand-due` (de hora em hora) entra em `JOB_CATALOG` e em `SCHEDULED_JOBS`,
com contagem de avisos como métrica da passada.

**Consequências.** Aparece em `/superadmin/rotinas` com histórico, saúde e "executar
agora" sem nenhum código de tela novo.

---

## 5. Lições aprendidas — defeitos REAIS encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | A varredura de prazos não conseguia ler o fuso do evento de cada demanda — o `select` com `event` não existia e o typecheck reprovou | O modelo `Demand` nasceu pendurado só no QUADRO: o `eventId` era alcançável por `board.eventId`, o que obriga a atravessar o quadro a cada linha da varredura | `eventId` na demanda (redundante de propósito com `board.eventId`, que nunca muda), com relação, FK e índice `(tenantId, eventId, completedAt)` |
| 2 | `requirePagePermission` não conseguia devolver o principal para a página decidir o que MOSTRAR | O retorno era tipado `principal: Principal \| null` (a guarda já redireciona quando o principal é nulo, mas o tipo não sabia) | Checagem explícita de nulo antes do retorno, com o comentário do porquê |
| 3 | **Seis** ocorrências de `text-[10px]`/`text-[11px]` nas telas novas reprovadas pelo guard do design system | Texto pequeno escrito à mão em vez da escala tipográfica — o guard existe exatamente para isso | `text-xs` nos seis lugares; a tela não inventa tamanho de fonte |
| 4 | O teste de enumeração dos templates de e-mail reprovou ao acrescentar os quatro avisos | O catálogo foi de 17 para 21 e o teste (que fixa o tamanho e exige fixture para todo tipo) não foi atualizado junto | Fixtures dos quatro avisos e o número 21, com o comentário da conta por fase |
| 5 | A suíte inteira reprovou **uma** vez em `confirmation-items` (F37), e passou nas duas execuções seguintes | O container do worker tinha acabado de ser reconstruído: a rotina recém-registrada no agendador roda na PRIMEIRA passada e mexeu em inscrições `PENDING` do teste vizinho — a mesma família da armadilha 85 (a suíte divide o banco com outro ator) | Repetir a bateria com o agendador já registrado; a lição ficou na armadilha **89** |
| 6 | O cenário 5 do E2E falhava mesmo com a guarda funcionando (o participante ERA redirecionado) | A asserção era `not.toHaveURL(/demandas/)` e o **slug da instituição** do teste continha "demandas" | Afirmar o DESTINO (`/dashboard$`) em vez da ausência de uma palavra — armadilha **90** |
| 7 | O E2E da **FASE 36** reprovou: o painel de rotinas mostrava `data-value="6"` e o teste esperava **5** ("o operador vê as cinco rotinas") | O cenário daquela fase tem a PRÓPRIA lista das cinco rotinas (de propósito: se a tela montasse a lista a partir do domínio, um erro de digitação no catálogo não apareceria). A rotina `demand-due` nasceu nesta fase e a lista do teste vizinho não sabia dela | A lista do E2E da F36 ganhou `demand-due`, e o nome do cenário passou a dizer "seis". É a armadilha **81** de novo: **a fase não é medida só pelos testes dela** — a suíte inteira prova que o que já funcionava continua funcionando |
| 8 | O teste da varredura reprovou com `expected 2 to be 1` no contador de avisos — e o produto estava certo | A asserção era sobre o contador GLOBAL (`sweep.dueSoon === 1`), e a varredura é **cross-tenant por desenho**: o seed da demonstração (rodado minutos antes) tinha deixado uma demanda atrasada em `ufba-demo`, que também foi contada | O contador virou `toBeGreaterThanOrEqual(1)` e a asserção forte passou a ser a mensagem da MINHA demanda, pela `dedupeKey` do dia local — que é exata. **Teste de função cross-tenant não afirma contagem absoluta num banco compartilhado** (armadilha 85) |

Uma lição de **teste** que não é defeito do produto: o arrastar e soltar de HTML5 não é
confiável via `dragTo` (mouse) dentro do Docker, e o componente guarda o cartão arrastado
em ESTADO do React — um `drop` disparado no mesmo tique do `dragstart` veria o estado
anterior e não faria nada. O teste constrói os eventos com `DataTransfer` e espera entre
eles, que é o que um arrastar humano faz.

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 88 arquivos · 1977 testes passando
npm run build ..................... Compiled successfully
                                    ƒ /t/[tenantSlug]/administracao/eventos/[eventId]/demandas
                                    ƒ /t/[tenantSlug]/administracao/eventos/[eventId]/demandas/[demandId]
                                    ƒ /t/[tenantSlug]/administracao/eventos/[eventId]/equipes
npm run db:verify ................. Contrato íntegro.
npm run db:verify:isolation ....... 9/9 verificações passaram.
npm run db:partitions ............. todas as partições do intervalo já existiam
npm run db:verify:pooling ......... Pooling íntegro: contexto por transação preservado sob PgBouncer.
npx prisma migrate status ......... 34 migrations found · Database schema is up to date!
npm run db:seed ................... OK (equipe com líder + 3 demandas: 2 em aberto, 1 atrasada,
                                    1 concluída — e a vaga RETIDA da FASE 37)
npm run test:e2e .................. 133 passed
```

Os cinco cenários do E2E da fase, do ponto de vista de quem usa:

1. a organização cria a **equipe** com líder e membros e a **demanda** com prazo, equipe
   e responsável — o cartão nasce na primeira coluna e o responsável recebe a mensagem
   na caixa de entrada;
2. **sem JavaScript** (contexto com `javaScriptEnabled: false`), o formulário do cartão
   move a demanda de verdade — a coluna muda no banco e a linha do tempo registra;
3. **arrastar e soltar** move o cartão de coluna, e a coluna de conclusão carimba
   `completedAt` (o resumo passa a contar 1 concluída);
4. comentar com **menção** registra a conversa, marca `notifiedAt` e cria **uma** mensagem
   para quem foi mencionado;
5. o prazo vencido aparece como **"Atrasada"** no cartão e no resumo, e quem só participa
   do evento é mandado para o painel em vez de ver o quadro.

---

## 7. Comandos operacionais

```bash
# Quadro da equipe (o quadro e as cinco colunas nascem na primeira visita)
/t/<slug>/administracao/eventos/<eventId>/demandas
# Ficha da demanda (edição, responsáveis, conversa com menção, histórico)
/t/<slug>/administracao/eventos/<eventId>/demandas/<demandId>
# Equipes do evento (nome, líder e membros; só vínculo MEMBER ativo)
/t/<slug>/administracao/eventos/<eventId>/equipes

# A rotina dos prazos aparece no painel de rotinas e roda de hora em hora:
/superadmin/rotinas                       # histórico, saúde e "Executar agora"
psql "$DATABASE_URL" -c \
  'SELECT kind, count(*) FROM demand_events GROUP BY kind ORDER BY 2 DESC'
```

Para conferir o aviso de prazo sem esperar o relógio: crie uma demanda com prazo para
ontem ou para amanhã e rode a rotina pelo painel (`MANUAL`) — a linha aparece em
`job_runs` com a contagem de avisos enviados.

---

## 8. Dívidas técnicas e pontos de atenção

* **E50 fica PELA METADE, e isso é reportado como está.** O quadro é operável **sem
  JavaScript** (é o que o cenário 2 do E2E prova, com o bundle desligado), mas o
  componente compartilhado `InlineActionForm` — usado por uma dúzia de telas de operação
  — continua dependendo da hidratação: o `<form action={formAction}>` do
  `useActionState` recebe `(prev, formData)` e não pode virar um POST nativo sem
  reescrever cada chamador. Quitar a raiz é uma fase própria (converter as ações de
  linha para `(formData) => void` e mover a mensagem para o servidor), e ficou
  declarado em vez de prometido.
* **E51 (nova)** — o arrastar reordena, mas **quem não usa mouse não reordena** dentro da
  coluna: o formulário do cartão só troca de coluna. Falta um caminho por teclado
  ("mover para cima/baixo").
* **E52 (nova)** — o quadro carrega **todos** os cartões do evento. Um evento com centenas
  de demandas abertas vai pesar; o caminho é paginar por coluna (as demandas concluídas
  são as candidatas naturais a ficar de fora do primeiro carregamento).
* **A equipe não tem hierarquia além do líder.** Não há sub-equipes nem líder de líder; se
  o produto pedir, é modelagem nova, não um ajuste.
* **O histórico do cartão sai com ele.** Excluir a demanda apaga a linha do tempo dela
  (cascade) e o que sobra é a trilha de auditoria. É decisão declarada: quem apaga um
  cartão espera que ele saia da tela.
* **Sem ligação com a programação.** A demanda não aponta para uma atividade ou sala; o
  organizador escreve o título. Foi deixado fora de escopo de propósito (a ligação
  convida a automações que a fase não teria como testar).

---

## 9. Checklist de aceite

- [x] Um quadro por evento, criado na primeira visita, com **colunas configuráveis** e um
      conjunto padrão já pronto
- [x] A **coluna** decide a conclusão (`isDone`), gravando e limpando `completedAt`, e o
      quadro recusa ficar sem coluna de conclusão
- [x] **Arrastar e soltar** move o cartão, e o quadro funciona **sem JavaScript** pelo
      formulário de cada cartão
- [x] Mover é **escrita condicional**: dois movimentos a partir do mesmo estado produzem
      um efeito, e o segundo recebe `ALREADY_MOVED` com mensagem
- [x] A ordem da coluna é reescrita em bloco de 10 em 10, sem índice de posição único
- [x] A demanda tem **início, prazo e concluído em**, com atraso calculado no **fuso do
      evento** e "vence hoje" diferente de "atrasada"
- [x] **Equipe do evento** é entidade com nome, **um líder** (garantido por índice único
      parcial) e membros; a demanda pode ser da equipe e/ou de pessoas
- [x] Só vínculo **MEMBER ativo** é atribuído, entra em equipe ou é mencionado
- [x] O **líder** distribui apenas dentro da própria equipe e entre os membros dela
      (posse conferida no serviço, recusa `NOT_LEADER`)
- [x] Comentário com **@menção**, com a menção gravada como linha e o aviso saindo por
      e-mail **e** na caixa de entrada
- [x] Avisos de atribuição, menção, prazo próximo e atraso, idempotentes pela chave do
      fato, **fora da transação** e sem nunca derrubar a operação
- [x] Rotina `demand-due` no worker e no painel de rotinas, com histórico em `job_runs`
- [x] Resumo do quadro por situação e **por equipe e por pessoa**, ordenado por urgência
- [x] Filtros por responsável, equipe, situação e busca
- [x] RLS + FORCE nas nove tabelas novas, contrato de schema atualizado e verificado
- [x] Equipe em uso e coluna com cartões **recusam** a exclusão, com a contagem no motivo
- [x] A suíte inteira continua verde (**1977** testes + **133** E2E), com os testes de
      e-mail e do design system atualizados
