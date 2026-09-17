# FASE 8 — Motor de Sorteios por Evento, Dia e Atividade

> **Status:** concluída · aguardando `APROVADO: AVANÇAR`
> **Pré-requisitos:** FASES 1 a 7 aprovadas e verificadas
> **Stack desta fase:** Prisma 7 + PostgreSQL 18 (RLS, `SELECT FOR UPDATE`), Server Actions,
> Vitest e Playwright contra o container de produção

---

## 1. Sumário executivo

Sorteio em evento presencial é um **ato público**: há pessoas olhando, e quem perde
precisa poder aceitar o resultado. Esta fase entrega o motor que sustenta essa
confiança — elegibilidade verificável, aleatoriedade honesta e resultado auditável.

| Área | Entrega |
|---|---|
| Escopos | `EVENT` (todo o evento), `DAY` (um dia) e `ACTIVITY` (uma atividade), com piso de minutos configurável |
| Elegibilidade | Lida de `attendances`: **quem não compareceu não concorre**; presença `ABSENT` é descartada; piso de minutos respeitado, com motivo por participante |
| Antiduplicação | Amostragem **sem reposição** + índice único `(raffleId, userId)` no banco; e exclusão de ganhadores anteriores do mesmo evento (`allowPriorEventWinners`) |
| Aleatoriedade | Fisher-Yates com `crypto.randomInt` (gerador injetável para testes) |
| Concorrência | `SELECT … FOR UPDATE` + `UPDATE` condicional `DRAFT → DRAWN`: dois cliques simultâneos geram **uma** apuração |
| Auditoria | Hash SHA-256 do resultado canônico (regras + vencedores na ordem) + entrada na trilha de auditoria |
| Interface | `/administracao/eventos/[id]/sorteios`: conferir elegíveis → sortear com revelação animada → histórico com hash |
| RLS | Tabelas `raffles` e `raffle_winners` no contrato; **a lista de tabelas do provisionamento passou a ser descoberta por introspecção** |

Números desta fase:

```text
Modelos Prisma novos            2   (Raffle, RaffleWinner) + 2 enums (RaffleScope, RaffleStatus)
Migração                        1   (20260917101154_phase8_raffles)
Módulo de domínio novo          1   (raffle-rules: elegibilidade, sorteio, hash)
Serviço novo                    1   (raffle-service) + 3 Server Actions
Páginas/componentes novos       1 rota + 2 componentes (console com revelação, histórico)
Permissão nova                  1   (`event:manage`)
Testes novos                   61   (40 unitários + 18 de integração) + 3 E2E
```

---

## 2. O problema desta fase

Sortear parece `array.sort(() => Math.random() - 0.5)`. Em um evento com 300 pessoas
na plateia, essa linha falha em quatro frentes ao mesmo tempo:

1. **Elegibilidade.** Se "inscrito que não apareceu" concorre com quem passou quatro
   horas no minicurso, o sorteio pune exatamente quem participou.
2. **Aleatoriedade.** `Math.random` é previsível; com algumas saídas observadas é
   possível antecipar o próximo número — e antecipar o resultado de um sorteio é
   fraude.
3. **Concorrência.** Dois organizadores anunciando o sorteio, ou um duplo clique:
   sem coordenação, saem dois resultados diferentes para o mesmo sorteio.
4. **Prova.** Depois do evento, alguém pergunta "como foi sorteado?". Uma lista de
   nomes não responde: é o resultado, não o processo.

As quatro respostas estão nas seções seguintes.

---

## 3. Elegibilidade: presença real, com recorte explícito

```text
EVENT     → qualquer presença válida no evento
DAY       → presença em atividades do DIA escolhido (dia LOCAL da instituição)
ACTIVITY  → presença NA atividade, com o piso de minutos cumprido
```

Regras que os testes fixam:

- **`ABSENT` não comprova nada.** Presença marcada como ausente é descartada mesmo
  com 120 minutos registrados — o dado existe, mas afirma o contrário do que o
  sorteio precisa.
- **O dia é LOCAL.** Uma atividade que começa às 23h em Salvador (UTC−3) já é o dia
  seguinte em UTC. O recorte usa o fuso da instituição, senão o "sorteio de sábado"
  deixaria de fora quem estava lá no sábado à noite.
- **O piso de minutos é o critério, e `0` tem significado.** Com piso `0`, basta ter
  presença registrada: quem foi ao evento e não teve a saída registrada tem `0`
  minuto **medido**, mas compareceu — e excluí-lo puniria o participante por uma
  falha de operação do credenciamento.
- **Cada descartado recebe UM motivo, e na ordem certa.** O recorte de escopo é
  avaliado antes do piso de minutos: dizer "abaixo do piso" para quem nem estava no
  dia sorteado seria um fato verdadeiro aplicado ao motivo errado.
- **O dia vem da atividade, com o credenciamento como alternativa.** Para presenças
  sem atividade vinculada (check-in no evento), a referência é o horário da entrada.

A tela mostra os **elegíveis** e os **descartados com o motivo**. É o que permite ao
organizador perceber, antes de sortear, que o piso estava alto demais ou que o
credenciamento está incompleto.

---

## 4. Amostragem sem reposição

```ts
selectWinners(pool, count, randomInt)   // Fisher-Yates
```

- **Sem reposição por construção:** cada índice sorteado sai do intervalo, então a
  mesma pessoa não pode sair duas vezes — a propriedade não depende de uma checagem
  posterior. Há teste que percorre **todas** as combinações de índices para um pool
  de três e confirma que nunca há repetição.
- **Gerador criptográfico injetável.** Em produção, `crypto.randomInt`; nos testes,
  uma sequência fixa. Mesma decisão do sorteio de cartas da FASE 5 — sem injeção,
  testar ordem e distribuição seria impossível (ou testaria o mock).
- **Entrega o que existe.** Se o organizador pede 10 vencedores e há 4 elegíveis, o
  sorteio entrega 4 e **informa** (`shortfall`). Falhar e não sortear ninguém seria
  pior: o evento está acontecendo.
- **Quórum zero bloqueia.** Sem nenhum elegível, a apuração é recusada com a
  orientação de conferir credenciamento e piso — e o sorteio **permanece** como
  rascunho, para ser apurado depois (a configuração não se perde).

---

## 5. Uma única apuração, mesmo com dois cliques

```
BEGIN (contexto de tenant)
  SELECT id FROM raffles WHERE id = $1 AND "tenantId" = $2 FOR UPDATE   ← trava
  ... lê configuração, presenças e ganhadores anteriores
  ... sorteia
  UPDATE raffles SET status='DRAWN' WHERE id = $1 AND status='DRAFT'    ← condicional
  INSERT INTO raffle_winners (...)
COMMIT
```

Três barreiras, da mais provável à mais improvável:

1. **A trava pessimista** serializa apurações do mesmo sorteio. A segunda transação
   espera, encontra `DRAWN` e é recusada **antes** de sortear.
2. **O `UPDATE` condicional** (`WHERE status = 'DRAFT'`) cobre a janela entre a
   leitura e a escrita: 0 linhas afetadas significa "outra pessoa apurou" e a
   apuração é abortada antes de gravar vencedores órfãos.
3. **Os índices únicos** `(raffleId, userId)` e `(raffleId, position)` são a garantia
   final: mesmo que a aplicação falhe, o banco recusa o vencedor repetido ou duas
   pessoas na mesma posição.

Há teste de integração que dispara **duas apurações simultâneas** com
`Promise.all` e exige exatamente um sucesso e uma recusa `ALREADY_DRAWN`, com as
posições e os usuários sem repetição.

E a segunda apuração sequencial também é recusada, com a mensagem que diz **quando**
o sorteio foi apurado — cancelar um resultado já anunciado não é permitido (o
resultado é público; se for o caso, cria-se outro sorteio).

---

## 6. O hash do resultado: a prova que fica

```text
conteúdo canônico = JSON de ordem fixa:
  { validationVersion, raffleId, tenantId, eventId, scope, activityId,
    referenceDate, minAttendanceMinutes, winnersCount, allowPriorEventWinners,
    eligibleCount, drawnAt, winners[{position, userId, minutes}] }

resultHash = SHA-256(conteúdo canônico)
```

O hash cobre **as regras aplicadas** e **os vencedores na ordem sorteada**. Isso
responde à pergunta que vem depois do evento ("como foi sorteado?") e detecta
qualquer alteração posterior: trocar um vencedor, inverter a ordem, mudar o piso de
minutos ou a data de referência muda o hash.

Os testes adulteram o resultado de dez maneiras diferentes e verificam que **todas**
mudam o hash; e a verificação formal (`verifyResult`) reconfere o que está no banco a
partir do dado persistido.

Além do hash, a apuração grava entrada na **trilha de auditoria** (FASE 7) com o ator,
a transição `DRAFT → DRAWN`, a contagem de elegíveis, a lista de vencedores e o
próprio hash — o histórico completo de quem apurou o quê.

---

## 7. Interface: conferir → sortear → provar

```text
1. CONFERIR   lista de elegíveis (com minutos) e de descartados (com motivo)
2. SORTEAR    revelação escalonada, um vencedor por vez, com confete
3. PROVAR     histórico com escopo, piso, quem apurou, quem ganhou e o hash
```

O passo 1 não é enfeite: **descobrir no palco que a lista estava errada não tem
volta**. O organizador confere o universo, ajusta o piso se for o caso, e só então
executa.

A revelação respeita `prefers-reduced-motion`: quem pediu menos movimento vê a lista
completa de uma vez, sem suspense.

### 7.1 O defeito que o E2E encontrou

A primeira versão usava campos não controlados (`defaultValue`). O React 19 **reseta
o formulário** depois que uma action termina — então clicar em "Conferir elegíveis"
apagava tudo o que o organizador tinha digitado: o piso de minutos voltava a `0` e o
sorteio seguinte usava **outra configuração**, entregando um resultado diferente do
que a prévia tinha mostrado.

O E2E pegou isso pela divergência exata: a prévia dizia "1 elegível" e o banco
registrou `eligibleCount = 2`. A correção foi tornar os campos **controlados** —
o comportamento que qualquer pessoa espera de um assistente em dois passos.

---

## 8. RLS: a lista de tabelas deixou de ser escrita à mão

O provisionamento (`docker/postgres/init/02-rls-policies.sql`) iterava sobre um
**array literal** de nomes de tabela. Na FASE 8, `raffles` e `raffle_winners`
nasceram sem policy — o array não foi atualizado. A assertiva da seção 6 barrou a
aplicação com a mensagem exata:

```text
FALHA: tabelas com tenantId SEM RLS habilitada: raffle_winners, raffles
```

O bloqueio funcionou, mas o defeito era de **manutenção**: uma lista que precisa ser
lembrada. O bloco passou a **descobrir** as tabelas por introspecção
(`pg_attribute` com a coluna `tenantId`) e a habilitar `ENABLE`/`FORCE ROW LEVEL
SECURITY` + a policy `tenant_isolation` em cada uma. Criar tabela nova passou a ser
suficiente.

O contrato em `src/lib/db/schema-contract.ts` continua sendo a checagem
**independente** (em JS), e as duas verificações precisam concordar — é isso que
torna o esquecimento impossível de passar em silêncio.

---

## 9. Permissão: `event:manage`

Sortear afeta **pessoas** e produz resultado auditável — não é o mesmo que editar o
cadastro do evento. Por isso a fase introduz `event:manage`, separada de
`event:update`:

| Papel | `event:update` | `event:manage` |
|---|---|---|
| ADMIN / OWNER | ✅ | ✅ |
| ORGANIZER | ✅ | ✅ |
| CHAIR | ❌ | ❌ |
| REVIEWER / PARTICIPANT | ❌ | ❌ |

Conceder "cuida do evento" sem conceder "pode sortear" agora é possível — e o
coordenador de trilha científica (CHAIR) não ganha, por tabela, o poder de sortear
brindes.

---

## 10. Evidência de verificação

### 10.1 Suíte completa (Vitest)

```text
tests/unit/raffle-rules.test.ts                    40 testes  ✓   (FASE 8)
tests/integration/raffle.test.ts                   18 testes  ✓   (FASE 8)
tests/integration/admin-panel.test.ts              20 testes  ✓   (FASE 7)
tests/unit/certificate-rules.test.ts              40 testes  ✓   (FASE 6)
tests/unit/certificate-renderer.test.ts            27 testes  ✓   (FASE 6)
tests/integration/certification.test.ts            24 testes  ✓   (FASE 6)
tests/unit/xp-rules.test.ts                        25 testes  ✓   (FASE 5)
tests/unit/card-rules.test.ts                      34 testes  ✓   (FASE 5)
tests/unit/task-rules.test.ts                      24 testes  ✓   (FASE 5)
tests/integration/gamification.test.ts             19 testes  ✓   (FASE 5)
tests/integration/gamification-services.test.ts    21 testes  ✓   (FASE 5)
tests/unit/review-rules.test.ts                    52 testes  ✓   (FASE 4)
tests/unit/submission-and-affinity.test.ts         72 testes  ✓   (FASE 4)
tests/unit/conflict-of-interest.test.ts            51 testes  ✓   (FASE 4)
tests/unit/event-rules.test.ts                     46 testes  ✓   (FASE 3)
tests/unit/rbac-authorization.test.ts              41 testes  ✓   (FASE 2)
tests/unit/landing-page.test.ts                    31 testes  ✓   (FASE 3)
tests/unit/registration-rules.test.ts              29 testes  ✓   (FASE 3)
tests/unit/tenant-resolution.test.ts               27 testes  ✓   (FASE 2)
tests/integration/peer-review.test.ts              18 testes  ✓   (FASE 4)
tests/integration/registration-concurrency.test.ts  8 testes  ✓   (FASE 3)
tests/integration/tenant-isolation.test.ts          8 testes  ✓   (FASE 1)
                                                  ─────────
                                         Total: 675 testes
```

Destaques do que é **provado**:

- quem tem presença `ABSENT` **não** concorre, mesmo com minutos registrados;
- o piso de minutos exclui quem cumpriu pouco, **com o motivo citando os dois números**;
- piso `0` inclui quem compareceu sem check-out (o participante não é punido por
  falha de operação);
- o escopo `DAY` usa o **dia local**: presença às 22h30 conta para o dia certo;
- a explicação segue o recorte (não diz "abaixo do piso" para quem estava em outro dia);
- **nenhuma combinação de índices repete participante** (teste exaustivo);
- o pedido maior que o universo entrega o que existe e informa quantos faltaram;
- **quórum zero** bloqueia a apuração e **preserva** a configuração em rascunho;
- ganhadores anteriores são excluídos — e **incluídos** quando a flag está ligada;
- **dois disparos simultâneos → uma apuração** (um sucesso, uma recusa `ALREADY_DRAWN`);
- apurar duas vezes o mesmo sorteio é recusado, com a data da primeira apuração;
- o hash gravado **confere** com o resultado persistido e **muda** em qualquer
  alteração (dez cenários de adulteração);
- cancelar um sorteio **já apurado** é recusado (o resultado é público);
- a trilha registra criação e apuração, com vencedores e hash;
- sorteio e presenças de outra instituição **não** aparecem (RLS).

### 10.2 E2E — contra o container de PRODUÇÃO

```text
auth-tenancy.spec.ts          (12 testes, FASES 2 preservadas)   ✓
registration-journey.spec.ts  ( 9 testes, FASE 3 preservada)     ✓
peer-review.spec.ts           ( 5 testes, FASE 4 preservada)     ✓
gamification.spec.ts          ( 2 testes, FASE 5 preservada)     ✓
certification.spec.ts         ( 2 testes, FASE 6 preservada)     ✓
platform-journey.spec.ts      ( 2 testes, FASE 7 preservada)     ✓
raffle.spec.ts                ( 3 testes, FASE 8)                ✓

✓ sorteio por presença real › conferência, apuração e histórico
✓ sorteio por presença real › BLOQUEIA o sorteio quando ninguém cumpre o piso
✓ sorteio por presença real › PARTICIPANTE não acessa a tela de sorteios

35 passed
```

A jornada da FASE 8: a organizadora configura o sorteio por atividade com piso de
120 min → a **conferência** mostra 1 elegível (240 min) e dois descartados com motivo
("abaixo do piso", "ausente") → a apuração revela o vencedor na tela → o banco
confirma 1 vencedor, 240 min e hash SHA-256 → o histórico exibe a apuração para quem
quiser conferir. E um participante que digita a URL é devolvido ao dashboard.

### 10.3 Qualidade

```text
ESLint       0 erros, 0 warnings
tsc          0 erros
next build   ✓ compilado (rota nova: /administracao/eventos/[eventId]/sorteios)
```

### 10.4 Garantias das fases anteriores

```text
CONTRATO DE ISOLAMENTO MULTI-TENANT          Contrato íntegro (31 tabelas de tenant).
ISOLAMENTO MULTI-TENANT (9 ataques)          9/9 verificações passaram.
```

---

## 11. Comandos operacionais

### 11.1 Aplicar a fase em um ambiente existente

```bash
npx prisma migrate deploy     # cria raffles e raffle_winners
npm run db:rls                # aplica a policy nas tabelas novas (agora por introspecção)
npm run db:verify             # confirma o contrato de isolamento
npm run db:verify:isolation   # 9 ataques entre instituições
```

### 11.2 Demonstração

O seed cria e **apura** um sorteio real:

```text
Sorteios (FASE 8):
  1 vencedor(es) entre 1 elegíveis (hash 39ddf307a794a8fe…)
  /t/ufba-demo/administracao/eventos/<id>/sorteios
```

Com os dados semeados, apenas Bruno cumpre o piso de 120 min no minicurso (240 min
medidos) — o resultado é **verificável**: quem abrir a lista de elegíveis verá
exatamente uma pessoa, e ela é o vencedor.

### 11.3 Testes

```bash
npm test                       # Vitest: 675 testes (unit + integração)
npm run test:e2e               # Playwright: 35 testes contra o container
npm run test -- raffle         # apenas os testes de sorteio
npm run typecheck && npm run lint && npm run build
```

---

## 12. ADRs — decisões desta fase

### ADR-044 — Elegibilidade lida da presença real, com piso configurável

**Contexto:** sorteio em evento presencial precisa excluir quem não compareceu.
**Decisão:** o universo vem de `attendances` (nunca de `registrations`), com recorte
por escopo, piso de minutos configurável e descarte explícito de `ABSENT`.
**Justificativa:** inscrição é intenção; presença é fato. Sortear por inscrição
puniria quem participou de fato.
**Consequências:** `minAttendanceMinutes = 0` significa "basta ter presença
registrada" — quem compareceu sem check-out conta. A tela mostra os descartados com
o motivo, para que o organizador perceba um credenciamento incompleto antes de
sortear.

### ADR-045 — Amostragem sem reposição com gerador criptográfico injetável

**Contexto:** o resultado precisa ser aleatório de verdade e testável.
**Decisão:** Fisher-Yates sobre o pool de elegíveis, com `randomInt` injetado
(`crypto.randomInt` em produção, sequência fixa nos testes).
**Justificativa:** a sem-reposição passa a ser propriedade da construção (não de uma
checagem posterior), e a injeção permite testar ordem e distribuição — mesma decisão
do sorteio de cartas (FASE 5).
**Consequências:** `Math.random` nunca é usado. O sorteio entrega o que existe quando
o pedido excede os elegíveis, informando quantos faltaram.

### ADR-046 — Uma apuração por sorteio, garantida em três camadas

**Contexto:** dois organizadores (ou um duplo clique) podem disparar a apuração ao
mesmo tempo.
**Decisão:** `SELECT … FOR UPDATE` na linha do sorteio dentro da transação com
contexto de tenant, `UPDATE` condicional `DRAFT → DRAWN` e índices únicos
`(raffleId, userId)` / `(raffleId, position)`.
**Justificativa:** a trava resolve a corrida no caso normal; o `UPDATE` condicional
cobre a janela entre ler e escrever; os índices únicos garantem o invariante mesmo se
a aplicação falhar.
**Consequências:** a segunda apuração recebe `ALREADY_DRAWN` com a data da primeira —
o resultado anunciado não muda.

### ADR-047 — Hash determinístico do resultado para auditoria

**Contexto:** depois do evento, é preciso demonstrar COMO o sorteio foi feito.
**Decisão:** SHA-256 de um conteúdo canônico de ordem fixa contendo as regras
aplicadas e os vencedores na ordem sorteada, persistido em `Raffle.resultHash`.
**Justificativa:** uma lista de nomes é o resultado, não o processo. O hash cobre
também o piso de minutos, o escopo e a data — mudar qualquer um deles é detectável.
**Consequências:** a ordem das chaves do JSON é parte do contrato. O `drawVersion`
permite distinguir reconfigurações (um sorteio cancelado e refeito é outro sorteio).

### ADR-048 — RLS descoberta por introspecção, não por lista literal

**Contexto:** o provisionamento iterava sobre um array de nomes de tabela; tabelas
novas nasciam sem policy (foi o que aconteceu com `raffles` e `raffle_winners`).
**Decisão:** o bloco descobre as tabelas pela presença da coluna `tenantId`
(`pg_attribute`) e aplica `ENABLE`/`FORCE` + policy em cada uma.
**Justificativa:** uma lista que precisa ser lembrada é um defeito esperando para
acontecer; a assertiva bloqueou a aplicação, mas o custo de manter a lista continuava
existindo.
**Consequências:** criar tabela de tenant passou a ser suficiente. O contrato em
`schema-contract.ts` permanece como verificação independente (e precisa concordar).

### ADR-049 — `event:manage` como permissão própria

**Contexto:** sortear afeta pessoas e produz resultado público; editar cadastro não.
**Decisão:** permissão nova `event:manage`, concedida a ADMIN/OWNER e ORGANIZER.
**Justificativa:** permite conceder administração operacional sem conceder o poder de
sortear — e evita que o CHAIR (trilha científica) ganhe a capacidade por tabela.
**Consequências:** o RBAC passa de 52 para 53 permissões; a tela e as Server Actions de
sorteio exigem `event:manage`, e não `event:update`.

---

## 13. Lições aprendidas — defeitos reais encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | A prévia dizia "1 elegível" e a apuração considerou **2** | O React 19 reseta o formulário depois de cada action: com campos não controlados, "Conferir" apagava o piso de minutos (voltava a 0) antes do sorteio | Campos controlados no console (o organizador mantém o que digitou) |
| 2 | Duas tabelas novas nasceram **sem RLS** | O provisionamento usava um array literal de tabelas, e o array não foi atualizado | Lista substituída por introspecção de `pg_attribute` (ADR-048) |
| 3 | `allowPriorEventWinners` não mudava nada | A flag era validada e gravada, mas o filtro de ganhadores anteriores era aplicado **incondicionalmente** | Filtro condicionado à flag — configuração que não altera comportamento é pior que configuração ausente |
| 4 | Três testes E2E colidiam em `tenants_slug_key` | O helper derivava o slug do rótulo, e os três testes usavam o mesmo | Rótulo único por cenário |
| 5 | ESLint recusou `setState` síncrono em efeito (revelação) | Animação implementada com `setRevealed` dentro do efeito | Animação por timers assíncronos + remontagem por `key` do hash |

O item **1** é o mais valioso: é um defeito de UX que só aparece quando **duas ações
usam o mesmo formulário** — nenhum teste unitário ou de integração pegaria, e o
usuário final descobriria no palco, com o resultado já anunciado.

---

## 14. Dívidas técnicas e trabalho adiado

1. **Sorteio com reservas (suplentes)** — hoje o sorteio entrega apenas os titulares.
   Um evento pode precisar de lista de espera de premiados.
2. **Entrega do prêmio** — não há registro de retirada/entrega, nem vínculo com
   inscrição ou credencial.
3. **Sorteio por faixa de minutos (pesos)** — hoje todos os elegíveis têm a mesma
   chance; ponderar por tempo assistido é uma evolução pedida em alguns eventos.
4. **Semente pública verificável (commit-reveal)** — o hash prova que o resultado não
   foi alterado, mas não que foi sorteado *depois* de a lista ser fechada. Publicar
   previamente o hash da lista de elegíveis resolveria isso.
5. **Exibição pública do resultado** — o sorteio aparece no painel; mostrar os
   vencedores na landing page do evento exigiria decidir sobre consentimento de
   exposição do nome.
6. **Paginação do histórico** — hoje limitado a 100 sorteios por evento.
7. **Sorteio integrado ao credenciamento em tempo real** — o organizador precisa
   recarregar a prévia para ver presenças recém-registradas.

**Pontos de atenção:**

- **Nunca** apure por `registrations`: inscrição é intenção, presença é fato (ADR-044).
- Alterar `minAttendanceMinutes` **antes** da apuração é permitido; depois, só com
  outro sorteio — o hash já cobre o valor aplicado.
- A ordem das chaves do conteúdo canônico é CONTRATO: mudá-la invalida a
  verificação de todos os sorteios já apurados.
- Criar tabela com `tenantId` **não** exige mais editar o SQL de RLS, mas exige
  rodar `npm run db:rls` (e o `db:verify` precisa passar).

---

## 15. Checklist de aceite da FASE 8

- [x] Modelagem `raffles` e `raffle_winners` com migração aplicada
- [x] Tabelas integradas ao contrato de RLS e verificadas (`db:verify` + isolamento)
- [x] Provisionamento de RLS **descoberto por introspecção** (fim da lista estática)
- [x] Escopos `EVENT`, `DAY` e `ACTIVITY` com recorte próprio
- [x] Elegibilidade lida de `attendances` — quem não compareceu não concorre
- [x] Presença `ABSENT` descartada mesmo com minutos registrados
- [x] Piso de minutos configurável; `0` = basta presença registrada
- [x] Recorte `DAY` no fuso da instituição (dia local, não UTC)
- [x] Motivo individual para cada participante descartado
- [x] **Amostragem sem reposição** com Fisher-Yates e `crypto.randomInt`
- [x] Gerador injetável (testes determinísticos)
- [x] Índice único `(raffleId, userId)` — mesma pessoa nunca duas vezes
- [x] Índice único `(raffleId, position)` — duas pessoas nunca na mesma posição
- [x] Exclusão de ganhadores anteriores do evento, com flag para permitir
- [x] **Trava pessimista** (`SELECT FOR UPDATE`) na apuração
- [x] `UPDATE` condicional `DRAFT → DRAWN` como segunda barreira
- [x] Dois disparos simultâneos produzem **uma** apuração
- [x] Apuração repetida é recusada com a data da primeira
- [x] Cancelamento só antes da apuração, com motivo
- [x] Quórum zero bloqueia a apuração e **preserva** a configuração
- [x] Pedido maior que o universo entrega o que existe e informa o faltante
- [x] Hash SHA-256 do resultado canônico (regras + vencedores na ordem)
- [x] `verifyResult` reconfere o resultado persistido
- [x] Trilha de auditoria com ator, transição, vencedores e hash
- [x] Permissão própria `event:manage` (ADMIN/OWNER/ORGANIZER)
- [x] Tela de sorteios no painel, com conferência antes de sortear
- [x] Revelação animada, respeitando `prefers-reduced-motion`
- [x] Histórico com escopo, piso, quem apurou, vencedores e hash
- [x] Seed cria e apura um sorteio real e verificável
- [x] **675 testes** unitários e de integração passando
- [x] **35 testes E2E** passando contra o container de produção
- [x] ESLint 0 erros · `tsc` 0 erros · `next build` OK
- [x] Contrato de RLS íntegro · isolamento 9/9 (FASES 1–7 preservadas)
- [x] Documentação com ADRs, lições aprendidas e comandos

**Próximo passo sugerido:** FASE 9 — entrega de prêmios e sorteios com suplentes,
ou as dívidas de maior risco das fases anteriores (rate limit em Redis, PKCS#7 para
certificados e observabilidade).

Aguardando **"APROVADO: AVANÇAR"**.
