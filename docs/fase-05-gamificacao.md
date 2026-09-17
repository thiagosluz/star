# FASE 5 — Gamificação: Cartas Colecionáveis, Motor de XP, Missões e Prestígio

> **Status:** concluída · aguardando `APROVADO: AVANÇAR`
> **Pré-requisitos:** FASES 1 a 4 aprovadas e verificadas
> **Stack desta fase:** Prisma 7 + PostgreSQL 18 (RLS), Server Actions, Canvas Confetti,
> Vitest (unit + integração) e Playwright (E2E)

---

## 1. Sumário executivo

Esta fase dá **retorno visível** a quem participa: presença, submissão, parecer e
conclusão de minicurso deixam de ser apenas registros e passam a produzir XP,
cartas colecionáveis, missões cumpridas, níveis e prestígio.

| Área | Entrega |
|---|---|
| Motor de recompensas | Um fato do mundo → **uma transação** com três efeitos: XP, carta e progresso de missão |
| XP | Livro-razão append-only, crédito idempotente, bônus de ofensiva, temporada por trimestre |
| Níveis | Curva linear configurável, **nível derivado do saldo** (nunca atribuído) |
| Prestígio | 10 ciclos de 50 níveis, com título por faixa |
| Cartas | 5 raridades, sorteio ponderado com redistribuição, variante **foil**, tiragem limitada, paleta e arte validadas |
| Álbum | Obtidas, faltantes, segredos ocultos, conclusão por raridade, destaque no perfil |
| Missões | Diárias, semanais, de evento e conquistas; progresso por gatilho; **resgate explícito** |
| Credenciamento | Check-in/check-out com carga horária **real** — a fonte dos gatilhos do participante |
| Autorização | Páginas com guarda de permissão (com posse automática para `:own`) e Server Actions guardadas |

Números desta fase:

```text
Módulos de domínio novos        4   (types, xp-rules, card-rules, task-rules)
Serviços de aplicação novos     5   (reward-engine, xp, card, task, attendance + hooks)
Server Actions novas            5   (resgatar missão, destacar carta, ajustar XP, conceder carta, check-in/out)
Páginas novas                   3   (/conquistas, /cartas, /credenciamento)
Componentes novos               6   (carta, barra de XP, missões, fila de credenciamento, destaque, confete)
Migração                        0   (os modelos vieram da modelagem da FASE 1 e já estavam no contrato de RLS)
Testes novos                  123   (83 unitários + 40 de integração) + 2 E2E
```

---

## 2. O problema mais difícil desta fase

Gamificação parece fácil — "dá ponto quando acontece" — e é justamente por isso
que costuma apodrecer. Três armadilhas definem o desenho:

1. **Contador que anda sozinho.** Se o nível é *atribuído* em um lugar e o XP é
   somado em outro, os dois divergem no primeiro retry de rede. Aqui o nível é
   **função pura do saldo**: não existe caminho de código capaz de gravar nível
   incoerente.
2. **Crédito duplicado.** Duplo clique, retry de job, rede instável. A defesa é
   uma **chave de idempotência derivada do fato** (não do momento) com índice
   único no banco.
3. **Recompensa patrocinando fraude.** Se "aparecer todo dia" ou "repetir a mesma
   ação" rende XP infinito, a estratégia racional do jogo deixa de ser aprender.
   Daí tetos de ofensiva, gatilhos de limiar que só disparam no **cruzamento** e
   uma carta por evento.

Cada uma dessas armadilhas tem uma decisão de arquitetura própria (ADRs 025 a 031).

---

## 3. Motor de recompensas — um fato, uma transação, três efeitos

```text
awardForEvent(fato)
   │
   ├─ 1. XP        lançamento no livro-razão + incremento atômico do perfil
   ├─ 2. CARTAS    no máximo UMA, do gatilho mais específico que tiver candidata
   └─ 3. MISSÕES   avanço do progresso das metas afetadas
```

Fazer isso em três operações separadas produziria **estados impossíveis**:
participante com a carta e sem o XP; missão completa sem o lançamento que a
completou. Um fato do mundo tem um efeito contábil — e ele é atômico.

### 3.1 A ordem interna é deliberada

```text
1. chave de idempotência já existe?  → devolve "já creditado", sem tocar em nada
2. lança no livro-razão              (é o registro que NÃO pode se perder)
3. incrementa o perfil               (increment resolvido pelo BANCO)
4. recalcula nível/prestígio         (a partir do total JÁ SOMADO, não do lido antes)
5. sorteia e registra carta          (reserva de tiragem condicional)
6. avança missões                    (uma linha por período, nunca duplicada)
```

O passo 4 tem uma sutileza que vale explicar: `totalXp: { increment }` é resolvido
pelo PostgreSQL, então dois créditos simultâneos **não se perdem** (um
read-modify-write perderia um deles). Nível e prestígio, por serem derivados, são
recalculados do total devolvido pelo próprio incremento — e reconferidos
imediatamente depois.

### 3.2 Idempotência: o índice único é a garantia

A consulta prévia é só o caminho rápido. A garantia real é
`XpTransaction.idempotencyKey` ser **UNIQUE**: sob concorrência, quem perde a
corrida recebe `P2002`, a transação inteira é desfeita (inclusive o incremento do
perfil) e a resposta é "já creditado".

As chaves são derivadas do **fato**, e todas começam pelo tenant — porque o índice
é global e o mesmo check-in em duas instituições não pode colidir:

```text
checkin:<tenant>:<registration>          attendance:<tenant>:<registration>
minicourse:<tenant>:<registration>       review:<tenant>:<review>
submission:<tenant>:<submission>:submitted   submission:<tenant>:<submission>:accepted
task:<tenant>:<progress>                 manual:<tenant>:<user>:<uuid>
```

### 3.3 Tabela de XP

| Origem | XP | Racional |
|---|---|---|
| `CHECKIN` | 50 | presença é fácil; vale pouco |
| `ACTIVITY_ATTENDANCE` | 40 | por atividade com carga horária cumprida |
| `MINI_COURSE_COMPLETION` | 150 | exige tempo e conclusão |
| `SUBMISSION_SUBMITTED` | 200 | escrever um trabalho é trabalho |
| `REVIEW_COMPLETED` | 300 | avaliar é o trabalho invisível que sustenta a ciência |
| `SUBMISSION_ACCEPTED` | 500 | o resultado que o evento existe para produzir |
| `REFERRAL` | 250 | crescimento |
| `TASK_COMPLETED`, `BONUS`, `ADMIN_ADJUSTMENT` | 0 | o valor vem do caso concreto (`xpReward`/`amount`) |

`TASK_COMPLETED`, `BONUS` e `ADMIN_ADJUSTMENT` **valem zero de propósito**: um
padrão aqui creditaria XP em dobro (missão) ou crédito fantasma (ajuste).

---

## 4. Níveis, prestígio e ofensiva

### 4.1 A curva — e o defeito que ela escondeu

```text
xpParaConcluirNível(n) = 100 + (n − 1) × 50      → 100, 150, 200, …
xpParaEstarNoNível(n)  = 25n² + 25n − 50          (forma fechada, conferida contra o somatório)
ciclo de prestígio     = xpParaEstarNoNível(51) = 66.250
```

A primeira versão devolvia `0` no nível 50 ("não existe nível 51"). O efeito era
perverso: **o nível 50 era inalcançável**, porque o prestígio subia exatamente no
instante em que ele seria atingido — e o título "Lenda" nunca apareceria. O teste
unitário de fronteira pegou isso antes de qualquer usuário. Agora o nível 50 tem
custo de conclusão como qualquer outro, e a barra do último nível aponta para o
prestígio em vez de nascer cheia.

### 4.2 Prestígio é derivado, não conquistado por botão

```text
prestígio = ⌊XP efetivo / 66.250⌋        (máximo 10)
XP no ciclo = XP efetivo − prestígio × 66.250
nível = nívelDoXp(XP no ciclo)
```

Um prestígio "manual" criaria estado inconsistente: bastaria um ajuste de XP para
o nível e o prestígio discordarem. Como é derivado, um **estorno administrativo
derruba o nível e o prestígio automaticamente** — o que é o comportamento correto
quando uma fraude é descoberta depois.

### 4.3 Ofensiva (streak) no dia LOCAL da instituição

Um check-in às 22h em Salvador (UTC−3) é do dia 22h local — não do dia seguinte
em UTC. Usar UTC quebraria a ofensiva de quem participou corretamente, então o
cálculo usa o **fuso da instituição** (`Intl.DateTimeFormat` com `timeZone`, sem
dependência externa):

```text
mesma data local    → nada muda (várias ações no dia contam 1)
dia anterior        → +1
mais antigo         → recomeça em 1 (o RECORDE nunca diminui)
```

O bônus de ofensiva cresce em degraus e **satura** (30/60/100/150/200/300 XP): sem
teto, "aparecer todo dia" viraria a única estratégia racional e a gamificação
competiria com o conteúdo em vez de reforçá-lo.

---

## 5. Cartas colecionáveis

### 5.1 O sorteio é injetável

```ts
pickCard(candidatas, { random, userLevel, now })
```

Em produção `random` é `secureRandom()` (`randomInt` criptográfico); nos testes é
uma sequência fixa. Sem isso, testar distribuição de raridade seria impossível — e
a alternativa usual (mockar o módulo) testa o mock, não a regra.

O domínio **não importa `node:crypto`**: componentes de cliente importam as regras
de carta para renderizar paleta e raridade, e um import de módulo Node ali
quebraria o bundle do navegador. Quem sorteia é a camada de aplicação.

### 5.2 Raridade sem carta não some

```text
COMMON 60 % · RARE 25 % · EPIC 10 % · LEGENDARY 4 % · MYTHIC 1 %
```

Se a instituição não cadastrou nenhuma carta épica, os 10 % da faixa épica são
**redistribuídos proporcionalmente** entre as que existem. Caso contrário, 10 %
dos sorteios não produziriam carta alguma e o participante receberia "nada" sem
entender por quê.

Dentro da raridade, `dropWeight` decide — onde **maior peso significa mais comum**.

### 5.3 Escassez reservada no banco

`maxSupply` é conferido por `UPDATE` condicional, o mesmo padrão da lotação de
atividades (ADR-014):

```sql
UPDATE "card_templates" SET "mintedCount" = "mintedCount" + 1
 WHERE "id" = $1 AND "isActive" AND ("maxSupply" = 0 OR "mintedCount" < "maxSupply")
```

`0` linhas afetadas **é** a resposta "tiragem esgotada". Contar em JavaScript e
inserir depois tem janela de corrida — e carta limitada é exatamente o que a
corrida ataca. Quando a última unidade é levada por outra pessoa entre a leitura e
a reserva, o motor tenta outra candidata (até três tentativas) em vez de perder a
recompensa inteira.

E, importante: **a escassez da carta não pune o participante** — o XP do fato é
creditado de qualquer maneira (há teste para isso).

### 5.4 Foil é item separado na coleção

`isFoil` faz parte da chave única `(tenantId, userId, cardTemplateId, isFoil)`. A
versão holográfica da mesma carta é um **item distinto** no álbum; se fosse a
mesma linha, quem tirou a foil veria apenas "quantity 2" e não saberia que
completou a variante rara. A chance cresce com a raridade (3 % comum → 20 % mítica)
e nunca chega a 100 %: garantia transforma variante em requisito.

### 5.5 Paleta e arte: allowlist, campo a campo

As cores passam por `colorSchema` (hex ou `oklch()`) e as URLs por `safeUrlSchema`
(http/https apenas) — a mesma política do tema da landing page (ADR-018). O
componente aplica a paleta como **variáveis CSS** (`--card-primary` etc.), nunca
como string de estilo.

Um detalhe que só apareceu no teste: `zod` valida objeto de forma **tudo-ou-nada**.
Validar a paleta inteira fazia um `glow` inválido **apagar as outras três cores**.
A validação passou a ser campo a campo: o dado ruim é descartado, o dado bom é
preservado.

### 5.6 Álbum

- cartas **secretas não descobertas** ficam fora do denominador (senão 100 % seria
  inalcançável sem o participante saber o que falta — e coleção que não pode ser
  completada deixa de ser coleção);
- contagem por raridade, foils, duplicatas e destaques;
- no máximo **3 cartas destacadas** no perfil: mais que isso e o "destaque" deixa
  de destacar.

---

## 6. Missões

### 6.1 A armadilha do `periodKey` nulo

`UserTaskProgress` tem `@@unique([tenantId, userId, taskDefinitionId, periodKey])`.
Em PostgreSQL, **NULL não colide com NULL**: se as missões de uso único usassem
`periodKey = NULL`, cada avaliação criaria uma LINHA NOVA e o mesmo participante
teria dezenas de progressos da mesma missão.

Por isso toda missão recebe chave **não nula**, inclusive as de uso único, que usam
o sentinela `once`:

```text
DAILY   → 2026-09-17            (dia local da instituição)
WEEKLY  → 2026-W38              (semana ISO)
a cada N horas → r<bloco>
demais  → once
```

### 6.2 Progresso, janela e expiração

- o progresso **nunca passa do alvo** (7/3 não significa nada) e nunca regride
  depois de concluído, resgatado ou expirado;
- a **expiração é derivada na leitura** (`withExpiry`), não depende de um job ter
  rodado: missão diária de ontem aparece expirada hoje sem intervenção;
- metas aceitam filtros (`activityType`, `trackId`, `minutes`), então "conclua um
  minicurso" não é cumprida por uma palestra.

### 6.3 Resgate explícito

A missão completa sozinha (`COMPLETED`) e o participante **resgata** a recompensa.
Não é enfeite: é a diferença entre "o sistema me deu pontos" e "eu conquistei
isso" — e é o momento em que o extrato fica auditável.

A operação é idempotente em duas camadas:

1. o XP usa a chave `task:<progressId>` (repetir não credita);
2. a marcação `COMPLETED → CLAIMED` é um `UPDATE` condicional: dois cliques
   simultâneos resultam em UM resgate.

**A recompensa é creditada ANTES da marcação.** Nessa ordem, uma falha no meio
deixa a missão resgatável de novo e o crédito já é idempotente; na ordem inversa,
uma falha perderia o XP para sempre — o pior dos dois mundos.

---

## 7. Credenciamento — por que entrou nesta fase

Sem presença não existe gatilho para o **participante comum**: submissão e parecer
pertencem a autores e revisores, que são minoria. O check-in é o fato que move a
maioria — e a FASE 3 o havia apenas modelado (`Attendance`, `checkInEnabled`,
`badgeToken`).

O que a FASE 5 entrega é o **núcleo**: registrar presença de forma idempotente e
auditável e, como consequência, distribuir XP, cartas e progresso de missão. O
painel completo (leitura de QR Code, etiqueta de crachá, indicadores) entra na
FASE 7.

### 7.1 A carga horária é real, não presumida

```text
mínimo para valer XP = max(30 min, 75 % da carga da atividade)
```

Check-in e check-out definem `minutesAttended`; a presença só pontua acima do
limiar. Sem esse piso, bastaria "bipar" a entrada para receber recompensa — e a
gamificação premiaria o comparecimento simbólico. O mesmo limiar será usado pela
FASE 6 na emissão de certificado: uma constante só evita o absurdo de "ganhou XP
mas não tem direito ao certificado".

Presença insuficiente **fica registrada** (é um fato) e simplesmente não pontua.

### 7.2 Idempotência no balcão

`registration.checkedInAt` já preenchido → devolve o estado atual; e o `UPDATE`
condicional (`WHERE checkedInAt IS NULL`) garante que dois leitores de QR
simultâneos resultem em UMA presença. O XP tem chave própria por inscrição.

---

## 8. Ganchos nos fluxos acadêmicos — a recompensa nunca derruba o fluxo

```text
SUBMISSION_SUBMITTED  → quem submeteu (o trabalho de escrever é dele)
REVIEW_COMPLETED      → quem avaliou (avaliar é o trabalho)
SUBMISSION_ACCEPTED   → quem escreveu (só o ACEITE credita)
```

Todas as funções de gancho **engolem o próprio erro** e registram no log. Um
timeout ao sortear uma carta não pode impedir alguém de submeter um trabalho
científico; o fato acadêmico permanece e a recompensa pode ser reconciliada depois
(a chave de idempotência permite reprocessar).

Rejeição **não** retira XP: a avaliação por pares já é o resultado, e transformar
rejeição em penalidade de pontos desencorajaria a submissão de trabalhos
arriscados.

Coautores não recebem automaticamente: a lista de autoria pode misturar pessoas sem
conta na plataforma, e distribuir XP para contas por coincidência de nome seria
pior do que não distribuir.

---

## 9. Autorização das telas novas

| Rota | Permissão | Observação |
|---|---|---|
| `/conquistas` | `xp:read:own` | página pessoal |
| `/cartas` | `card:read:own` | página pessoal |
| `/credenciamento` | `registration:checkin` | operação da equipe |

A guarda de página passou a resolver a **posse automaticamente** para permissões
`:own` (o dono, numa página pessoal, é o usuário da sessão). Sem isso, `can()`
negaria — e a negação é intencional — deixando todas as páginas "minhas"
inacessíveis.

As Server Actions de gamificação têm guarda própria: esconder botão não impede a
chamada, porque uma Server Action é um endpoint HTTP como qualquer outro. O
credenciamento é operado pela **equipe**, nunca pelo próprio participante:
auto-credenciamento transformaria presença em declaração.

---

## 10. Evidência de verificação

### 10.1 Suíte completa (Vitest)

```text
tests/unit/xp-rules.test.ts                        25 testes  ✓
tests/unit/card-rules.test.ts                      34 testes  ✓
tests/unit/task-rules.test.ts                      24 testes  ✓
tests/integration/gamification.test.ts             19 testes  ✓
tests/integration/gamification-services.test.ts    21 testes  ✓
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
                                         Total: 506 testes
```

Destaques do que é **provado** (não apenas executado):

- crédito repetido com a mesma chave **não** move o saldo (e a corrida devolve
  "já creditado" em vez de erro);
- o nível sobe exatamente na fronteira (`xpParaEstarNoNível(n)` → nível `n`;
  um XP a menos → nível `n − 1`);
- prestígio sobe **no custo exato do ciclo** e um estorno o derruba;
- tiragem limitada é respeitada em tentativas repetidas, **sem** prejudicar o XP;
- o gatilho de limiar dispara no **cruzamento** e não farma depois;
- carta de outro evento não cai neste evento;
- foil cria **linha própria** e conta como item separado;
- missão de uso único tem **uma só** linha de progresso, com `periodKey` não nulo;
- resgate credita uma única vez, mesmo chamado duas vezes;
- presença abaixo do limiar não pontua, mas fica registrada;
- check-in repetido não duplica presença nem XP;
- ranking não vaza participante de outra instituição;
- o saldo do extrato fecha com a soma dos lançamentos (`balanceAfter`).

### 10.2 E2E — contra o container de PRODUÇÃO

```text
auth-tenancy.spec.ts          (12 testes, FASES 2 preservadas)   ✓
registration-journey.spec.ts  ( 9 testes, FASE 3 preservada)     ✓
peer-review.spec.ts           ( 5 testes, FASE 4 preservada)     ✓
gamification.spec.ts          ( 2 testes)                        ✓

✓ jornada de gamificação › credenciamento gera XP e carta, e a missão é resgatada
✓ jornada de gamificação › PARTICIPANTE não acessa o credenciamento

28 passed
```

A jornada E2E percorre a pilha inteira: equipe credencia pela tela → banco confirma
XP 50, 1 carta, 1 presença e missão `COMPLETED` → participante entra e vê nível 1
com 50 XP → resgata a missão → 150 XP, missão `CLAIMED` → recarrega a página e o
valor **não** muda (idempotência visível) → a carta aparece no álbum.

### 10.3 Qualidade

```text
ESLint       0 erros, 0 warnings
tsc          0 erros
next build   ✓ compilado (rotas novas: /conquistas, /cartas, /credenciamento)
```

### 10.4 Garantias das fases anteriores

```text
CONTRATO DE ISOLAMENTO MULTI-TENANT          Contrato íntegro.
ISOLAMENTO MULTI-TENANT (9 ataques)          9/9 verificações passaram.
CONCORRÊNCIA DE INSCRIÇÃO (8 testes)         preservada após refatoração
```

Nenhuma tabela nova entrou nesta fase: as cinco tabelas de gamificação
(`card_templates`, `user_cards`, `user_xp_profiles`, `xp_transactions`,
`task_definitions`, `user_task_progress`) vieram da modelagem da FASE 1 e já
estavam no contrato de RLS — o `db:verify` continua cobrindo todas.

O utilitário de leitura de erro do driver do Prisma (`isUniqueViolation`,
`violatedIndexName`, `isTransientDbError`) foi extraído de `registration-service`
para `src/lib/db/prisma-errors.ts`, para não duplicar a leitura do formato interno
do adapter em cada serviço. Os 8 testes de concorrência de inscrição continuam
passando após a extração.

---

## 11. Comandos operacionais

### 11.1 Ambiente completo

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:setup          # migrate + rls + verify + isolation + seed
npm run dev               # http://localhost:3000
```

### 11.2 Dados de demonstração (FASE 5)

O seed passou a semear gamificação **executando o motor de recompensas**, e não
gravando XP à mão: o dado de demonstração nasce com a mesma consistência do dado
de produção.

```text
7 cartas: comum → mítica, com duas de tiragem limitada (50 e 10 unidades)
6 missões: credenciamento, presença tripla (premia carta), minicurso,
           submissão, pareceres e uma missão diária
9 fatos de XP para ana e bruno → ana 700 XP (nível 5, 2 cartas)
                                 bruno 920 XP (nível 5, 3 cartas, 1 foil)

Páginas:
  /t/ufba-demo/conquistas       XP, nível, ofensiva, missões, extrato e ranking
  /t/ufba-demo/cartas           álbum com obtidas, faltantes e destaque
  /t/ufba-demo/credenciamento   credenciamento da equipe (check-in/check-out)
```

### 11.3 Testes

```bash
npm test                  # Vitest: 506 testes (unit + integração)
npm run test:e2e          # Playwright: 28 testes contra o container
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
npm run build             # build de produção (força NODE_ENV=production)
npm run db:verify         # contrato de RLS
npm run db:verify:isolation  # 9 ataques de isolamento entre tenants
```

### 11.4 Stack completa em containers

```bash
docker compose --profile app up -d --build
docker compose --profile app ps
```

---

## 12. ADRs — decisões desta fase

### ADR-025 — Nível e prestígio derivados do saldo

**Contexto:** gamificação acumula estado (XP, nível, prestígio, temporada) e o
contador tende a divergir do histórico.
**Decisão:** `XpTransaction` é a verdade contábil; nível, prestígio e progresso são
**função pura** de `totalXp` (`resolveXpProgress`), recalculados a cada crédito.
**Justificativa:** elimina a classe inteira de bug do "contador que anda sozinho" —
não existe caminho de código capaz de gravar nível incoerente com o saldo.
**Consequências:** um ajuste administrativo negativo derruba o nível e o prestígio
na hora (é o comportamento desejado em caso de fraude). O perfil é denormalizado
para leitura O(1) no ranking, mas sempre reconciliável com o livro-razão.

### ADR-026 — A recompensa nunca derruba o fluxo acadêmico

**Contexto:** submeter trabalho e enviar parecer são operações críticas; conceder XP
é acessório.
**Decisão:** os ganchos de gamificação devolvem `null` em qualquer falha, registram
no log e **não propagam erro**.
**Justificativa:** um problema ao sortear uma carta não pode impedir alguém de
submeter um artigo científico.
**Consequências:** uma recompensa pode ser perdida se falhar — mitigado pela chave
de idempotência, que permite reprocessar o mesmo fato depois sem duplicar crédito.

### ADR-027 — Escassez de carta reservada por UPDATE condicional

**Contexto:** cartas com tiragem limitada são o alvo natural de corrida.
**Decisão:** `mintedCount` é incrementado por `UPDATE ... WHERE (maxSupply = 0 OR
mintedCount < maxSupply)`; 0 linhas afetadas significa "esgotado".
**Justificativa:** a decisão passa a ser tomada pelo banco, em uma instrução
atômica, exatamente como na lotação de atividades (ADR-014).
**Consequências:** quando a última unidade é levada na corrida, o motor tenta outra
carta (até 3 tentativas) em vez de perder a recompensa; e o XP do fato é creditado
de todo modo.

### ADR-028 — Aleatoriedade injetável no sorteio

**Contexto:** distribuição de raridade precisa ser testável e auditável.
**Decisão:** `pickCard(candidatas, { random })` recebe o gerador; produção usa
`secureRandom` (`randomInt` criptográfico), testes usam sequência fixa.
**Justificativa:** sem injeção, testar distribuição seria impossível (ou testaria o
mock). E `Math.random` é previsível — carta rara é justamente o que motiva trapaça.
**Consequências:** o domínio permanece isomórfico (nenhum import de `node:crypto`),
o que permite renderizar cartas no cliente com as mesmas regras.

### ADR-029 — Resgate explícito da missão

**Contexto:** recompensa automática é invisível.
**Decisão:** a missão completa (`COMPLETED`) e o participante **resgata** a
recompensa (`CLAIMED`), com XP creditado antes da marcação e `UPDATE` condicional
como garantia de resgate único.
**Justificativa:** transforma o cumprimento em momento — e mantém o extrato
auditável, com um lançamento por resgate.
**Consequências:** o participante precisa de uma ação extra; em troca, o sistema
tem um ponto natural para a celebração (confete) e para o registro contábil.

### ADR-030 — Chave de período com sentinela em vez de NULL

**Contexto:** missões diárias/semanais são repetíveis; as de uso único não.
**Decisão:** toda missão recebe `periodKey` **não nulo**; as de uso único usam o
sentinela `once`.
**Justificativa:** em PostgreSQL, NULL não colide com NULL em índice único — com
`periodKey = NULL`, cada avaliação criaria uma nova linha de progresso para a
mesma missão do mesmo participante.
**Consequências:** o `upsert` na chave composta passa a ser a operação natural e a
unicidade vale de fato. Documentado no topo de `task-rules.ts` e coberto por teste.

### ADR-031 — Credenciamento do núcleo dentro da fase de gamificação

**Contexto:** o participante comum não tinha nenhum fato que gerasse recompensa.
**Decisão:** implementar check-in/check-out com cálculo de carga horária real
(serviço + ação + tela mínima), deixando o painel completo para a FASE 7.
**Justificativa:** gamificação sem gatilho para a maioria dos participantes seria
uma fase de telas vazias; e a presença é insumo também da certificação (FASE 6).
**Consequências:** uma tela operacional entra fora da fase "administrativa"; em
troca, a FASE 6 herda presença auditável e a FASE 7 só amplia a interface.

---

## 13. Lições aprendidas — defeitos reais encontrados nesta fase

Todos foram encontrados por testes, e a maioria por testes **unitários de
fronteira** — que é exatamente onde esse tipo de erro mora.

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Nível 50 **inalcançável** e título "Lenda" inexistente | `xpToNextLevel(teto)` devolvia 0, então o prestígio subia no instante exato em que o nível 50 seria atingido | O teto passou a ter custo de conclusão; prestígio sobe ao completá-lo |
| 2 | Um `glow` inválido **apagava** as outras três cores da carta | `zod` valida objeto de forma tudo-ou-nada | Validação campo a campo (`readField`) preserva o que é válido |
| 3 | Teste de duplicata passava isolado e falhava na suíte | Fonte de aleatoriedade **compartilhada** entre testes: ao esgotar a sequência, devolvia `0` — que força foil | Aleatoriedade de teste virou fábrica (`deterministicRandom()`), nova a cada uso |
| 4 | Seed gerava foil "errado" de forma determinística | `demoRandom` criava uma sequência nova a cada número, devolvendo sempre o primeiro valor | Sequência única, avançada por cursor (e comentário explicando o porquê) |
| 5 | Teste de álbum estourava restrição única | Perfil de XP criado dentro do laço de cartas (`(tenantId, userId)` é único) | Perfil criado uma vez, fora do laço |
| 6 | `source: 'MANUAL'` recusado pelo banco | Valor inventado; o enum é `MANUAL_STAFF` | Uso do valor real do enum |
| 7 | Compilação recusou `status: { in: ['CONFIRMED','ATTENDED'] as const }` | Prisma tipa `in` como array MUTÁVEL | Tipo nomeado do domínio em vez de `as const` |
| 8 | Busca da fila de credenciamento não filtrava por usuário | Sintaxe de filtro em relação (`user: { name }`) em vez de `user: { is: { name } }` | Filtro corrigido com `is` |
| 9 | Resgate de missão recusado com "Não autorizado" para quem TINHA permissão | A guarda devolve `state` apenas em caso de falha, mas o consumidor testava `if (!auth.ok \|\| !auth.state)` — condenando também o sucesso | Condição reduzida a `if (!auth.ok)`, com o alerta registrado na própria guarda |

Os itens **1, 2, 3, 4 e 9** são os mais instrutivos: nenhum deles apareceria em um
teste "feliz". O item 1 era uma **regra de negócio quebrada**, o 2 um defeito de
validação que só se manifesta com dado parcialmente inválido, o 9 um erro de
contrato entre duas camadas (quem produz o retorno e quem o consome), e o 3 e o 4
são defeitos de **dado de teste** — a categoria que produz testes verdes que não
provam nada. Vale registrar que o item 9 atravessou 123 testes de unidade e
integração sem ser notado: só o E2E, com usuário real e permissão real, o expôs.

---

## 14. Dívidas técnicas e trabalho adiado

**Adiado conscientemente:**

1. **Cartas de `REVIEWER_TOP` e `EVENT_ATTENDANCE_FULL`** — os gatilhos existem no
   enum e o motor sabe concedê-los (`grantCardForTrigger`), mas o primeiro exige um
   job de apuração de ranking de revisores e o segundo ainda não está ligado ao
   check-out. Ambos documentados no código.
2. **Painel de administração de cartas e missões** — criar/editar carta com
   pré-visualização de paleta, tiragem e gatilho. As Server Actions de concessão
   manual e ajuste de XP já existem e estão testadas; falta a tela (FASE 7).
3. **Trocas e crafting** — `UserCard.quantity` já acumula duplicatas, mas não há
   conversão de duplicatas em recurso nem troca entre participantes. Exige desenho
   econômico (e antifraude) que não cabe nesta fase.
4. **Níveis de carta** — `UserCard.level` existe no modelo e permanece 1; evoluir
   carta consumindo duplicatas é uma mecânica futura.
5. **Histórico de temporadas** — o XP da temporada corrente é mantido
   (`seasonXp`/`seasonKey`), mas não há arquivo de temporadas passadas nem reset
   agendado.
6. **Notificações de conquista** — hoje a celebração é local (confete na tela).
   E-mail/push de "você desbloqueou uma carta" depende da fila da FASE 6.
7. **Antifraude de credenciamento** — o modelo tem `latitude`, `longitude` e
   `qrNonce`; a validação de proximidade e a leitura de QR entram com o painel da
   FASE 7. Hoje o check-in é manual e assinado pelo staff (`validatedById`).
8. **Ranking por evento** — o ranking é da instituição inteira; filtrar por evento
   exige decidir se o XP é por evento (hoje o XP é por instituição, com `eventId`
   apenas como referência de origem).

**Pontos de atenção:**

- **Nunca** troque o sentinela `once` por `null` no `periodKey` (ADR-030).
- Cartas com `maxSupply > 0` **exigem** o caminho de reserva condicional; inserir
  carta por fora (script, SQL manual) fura a escassez e o `mintedCount` divergirá.
- `NODE_ENV=development` no `.env` quebra `npx next build` direto: use `npm run build`.

---

## 15. Checklist de aceite da FASE 5

- [x] Motor único: um fato → XP + carta + missão **na mesma transação**
- [x] Crédito de XP idempotente por chave derivada do fato (índice único no banco)
- [x] Corrida de idempotência devolve "já creditado" em vez de erro
- [x] Perfil com incremento atômico e derivados recalculados do total real
- [x] Tabela de XP por origem, com `TASK_COMPLETED`/`BONUS`/ajuste valendo 0
- [x] Curva de níveis com forma fechada conferida contra o somatório
- [x] Nível 50 **alcançável**, com prestígio subindo ao completá-lo
- [x] Prestígio derivado do saldo; estorno derruba nível e prestígio
- [x] Ofensiva calculada no **fuso da instituição**, com recorde preservado
- [x] Bônus de ofensiva em degraus e com teto (não premia só "aparecer")
- [x] Temporada por trimestre, com virada zerando o acumulado
- [x] 5 raridades com distribuição documentada e **redistribuição** das ausentes
- [x] Sorteio com aleatoriedade injetável e gerador criptográfico em produção
- [x] Tiragem limitada reservada por `UPDATE` condicional (sem furar escassez)
- [x] Escassez não prejudica o XP do fato
- [x] Gatilhos de limiar/ofensiva só disparam ao **cruzar** o marco (sem farm)
- [x] Carta de outro evento não é distribuída neste evento
- [x] Variante **foil** como item separado no álbum
- [x] Paleta validada por allowlist e aplicada como variáveis CSS
- [x] URL de arte restrita a http(s) (sem `javascript:`/`data:`)
- [x] Álbum com obtidas, faltantes, segredos fora do denominador e conclusão
- [x] Destaque de no máximo 3 cartas, só do próprio álbum
- [x] Missões diárias, semanais, de evento, únicas e conquistas
- [x] `periodKey` **nunca nulo** (uma linha por missão/período)
- [x] Metas com filtro de tipo de atividade, trilha e minutos
- [x] Progresso limitado ao alvo e sem regressão após concluir/resgatar
- [x] Expiração derivada na leitura, sem depender de job
- [x] Resgate explícito, idempotente em duas camadas
- [x] Credenciamento com carga horária real e mínimo de 75 %
- [x] Presença insuficiente fica registrada e não pontua
- [x] Check-in repetido não duplica presença nem XP
- [x] Ganchos nos fluxos acadêmicos **não-fatais**; rejeição não retira XP
- [x] Páginas novas com guarda de permissão (com posse automática para `:own`)
- [x] Credenciamento restrito à equipe (participante é redirecionado)
- [x] Seed executa o motor real (dado de demonstração consistente)
- [x] **506 testes** unitários e de integração passando
- [x] **28 testes E2E** passando contra o container de produção
- [x] ESLint 0 erros · `tsc` 0 erros · `next build` OK
- [x] Contrato de RLS íntegro · isolamento 9/9 (FASES 1–4 preservadas)
- [x] Documentação com ADRs, diagramas e comandos

**Próximo passo:** FASE 6 — Certificação automática: PDF/SVG com assinatura
digital, hash criptográfico, validação pública por QR Code e cálculo de carga
horária real (usando a presença auditável construída nesta fase), processada por
fila BullMQ.

Aguardando **"APROVADO: AVANÇAR"**.
