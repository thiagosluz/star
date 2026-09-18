# FASE 16 — Sorteios de ponta a ponta

> **Itens quitados:** G1 (suplentes) · G2 (registro de entrega do prêmio) · G3 (sorteio
> ponderado por minutos) · G4 (commit-reveal da semente) · G5 (exibição pública do
> resultado) · G6 (paginação do histórico) · G7 (prévia ao vivo do credenciamento) ·
> F1 (gatilhos `EVENT_ATTENDANCE_FULL` e `REVIEWER_TOP`).
> Vêm do levantamento consolidado em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md).
>
> **Numeração:** o tema tem número fixo no levantamento (F16). A FASE 15 (Comunicação)
> segue pendente, e a tabela do `AGENTS.md` mostra a situação de cada tema — o número
> identifica o tema, não a ordem de entrega.

---

## 1. Sumário executivo

### 1.1 Entregas

| # | Entrega | Onde | Estado |
|---|---|---|---|
| G1 | Suplentes sorteados na mesma apuração, com papel por posição (`WINNER`/`ALTERNATE`) e exclusão de ganhadores anteriores contando só titulares | `prisma/schema.prisma` (`RaffleWinnerKind`) · `raffle-rules.ts` · `raffle-service.ts` | ✅ |
| G2 | Registro de entrega do prêmio por POSIÇÃO, com autor, horário, observação e trilha; recibo que não se reescreve | `markPrizeDelivered` · `RaffleHistory` | ✅ |
| G3 | Sorteio ponderado por minutos (opcional), com peso = tempo assistido e piso 1 | `selectWeightedWinners` · `participantWeight` | ✅ |
| G4 | **Commit-reveal**: compromisso publicado na criação, semente selada (AES-256-GCM) e revelada na apuração, com payload de auditoria **versionado** | `seed-vault.ts` · `createSeededRandomInt` · `resultVersion` | ✅ |
| G5 | Publicação do resultado na página do evento (opt-in por sorteio), com **nome mascarado** por padrão e a prova junto | `listPublicRaffleResults` · `RaffleResults` | ✅ |
| G6 | Histórico paginado com total e página limitada ao intervalo válido | `resolveRafflePage` · `listRaffles` · `RaffleHistory` | ✅ |
| G7 | Prévia ao vivo: contagem de elegíveis reconsultada a cada 5s, com horário da amostra e último check-in | `GET /api/events/[eventId]/raffle-live` · `LiveEligibility` | ✅ |
| F1 | `EVENT_ATTENDANCE_FULL` dispara no check-out que fecha a última atividade exigida | `evaluateFullAttendance` · `grantFullAttendanceCard` · `attendance-service` | ✅ |
| F1 | `REVIEWER_TOP` premiado por ranking de pareceres concluídos, com piso lido da própria carta | `rankReviewers` · `awardTopReviewers` · painel no evento | ✅ |
| — | Testes novos (unit + integração + E2E) | `raffle-end-to-end.test.ts` (unit e integração) · `raffle-end-to-end.spec.ts` | ✅ |

### 1.2 Números da fase

| Métrica | Antes | Depois |
|---|---|---|
| Testes (Vitest: unit + integração) | 870 | **921** (+51: 38 unitários + 13 de integração) |
| Testes E2E (Playwright) | 51 | **55** (+4) |
| Migrações | 13 | **14** (+1: `raffle_end_to_end`) |
| ADRs | 84 | **91** (ADR-085 a ADR-091) |
| Permissões | 54 | 54 (nenhuma nova) |
| Arquivos novos | — | 8 (1 de domínio, 1 de vault, 1 de conquistas, 1 rota, 3 de UI, 1 migração) |

---

## 2. O problema mais difícil da fase

**Fazer um sorteio auditável DEPOIS de já ser auditável — e sem quebrar a auditoria
que existe.**

O motor da FASE 8 já provava integridade: hash do resultado canônico, trilha, trava
pessimista. A dívida registrada era outra, e mais sutil: *"o hash prova que o
resultado não foi alterado; não prova que o sorteio aconteceu depois do fechamento do
credenciamento"*. Quem tivesse acesso ao banco podia apurar, ver quem ganhou e refazer
até gostar — e o hash da última tentativa conferiria perfeitamente.

Commit-reveal resolve isso, mas cria um problema novo, que é o verdadeiro nó da fase:
**o conteúdo assinado precisa mudar** (suplentes, peso, papel por posição) **sem
invalidar o hash de nenhuma apuração já feita**. Se os campos novos entrassem na
versão 1 do payload, todo sorteio apurado antes passaria a acusar "resultado
adulterado" da noite para o dia — o oposto do que a auditoria serve para fazer.

A saída foi tratar o payload como **contrato versionado**: `resultVersion` na linha do
sorteio diz qual forma usar, `buildResultPayload` reconstrói a versão certa, e
`verifyResult` funciona para as duas. O teste de integração que reconstruía o payload
"na mão" foi o primeiro a quebrar — e a correção dele (ler `resultVersion` do banco) é
exatamente o que um auditor faria.

A segunda dificuldade foi de desenho, não de criptografia: **quem pode ser premiado
duas vezes?** O suplente não ganhou nada — é reserva. Tirá-lo do páreo dos sorteios
seguintes puniria quem ficou em segundo na ordem e esvaziaria o pool nos eventos com
muitos sorteios. A exclusão de ganhadores anteriores passou a olhar só para titulares,
e há teste para isso.

---

## 3. Decisões técnicas

### 3.1 Suplentes na mesma apuração, com papel por posição

O suplente é sorteado no mesmo ato, logo depois dos titulares, e ocupa posição
própria com `kind = ALTERNATE`. Alternativa descartada: sortear suplentes depois, sob
demanda — isso exigiria uma segunda apuração sobre um universo que já mudou (gente
saindo do evento), e "quem era o reserva na hora do sorteio" deixaria de ter resposta.
A tabela continua se chamando `raffle_winners`: renomear tabela sob RLS mexeria em
policies e grants para ganhar nada, e a distinção está no dado.

### 3.2 Peso é o tempo, e ninguém elegível tem peso zero

Ligado, o sorteio ponderado retira pontos de um intervalo cujo tamanho é a soma dos
minutos; desligado, continua o embaralhamento uniforme. Quem é elegível com `0` minuto
(só possível com piso zero) tem peso **1**, não zero: zerar o peso excluiria alguém que
está na lista de elegíveis, e excluir não é o que "ponderado" significa.

### 3.3 A semente: compromisso antes, revelação depois

Na criação, uma semente de 32 bytes é gerada, seu `sha256` é **publicado** (e entra na
trilha, com data e autor) e a semente vai **selada** para o banco (AES-256-GCM, chave
derivada de `BETTER_AUTH_SECRET` com rótulo próprio — a chave do cofre não é a chave de
sessão). Na apuração o sorteio passa a ser **determinístico** a partir dela, e a
semente é revelada junto do resultado. Quem confere faz duas contas: `sha256(semente
revelada) == compromisso` e "rodar o sorteio com a mesma semente reproduz os mesmos
vencedores".

Sem o segredo configurado, o sorteio continua funcionando com o gerador do sistema e
**sem compromisso** — a tela diz que a auditoria é degradada. Auditoria declarada vale
mais que auditoria que finge existir.

### 3.4 Nome público mascarado, publicação opt-in

Publicar o resultado é decisão **por sorteio** (não um padrão da instituição), e o nome
sai mascarado (`Ana Souza` → `Ana S.`) exceto para quem tem perfil público — que é
consentimento explícito e verificável. Nome de uma palavra é preservado: mascarar
viraria `A.`, que não serve nem para quem estava no palco.

### 3.5 Prévia ao vivo por polling, com a MESMA contagem da apuração

A contagem é reconsultada a cada 5 segundos por uma rota autenticada, e reusa
`previewEligibility` — duas implementações divergiriam, e o organizador veria um número
na tela e outro no resultado. A tela mostra o horário da amostra e o último check-in,
em vez de fingir tempo real. SSE foi descartado: conexão aberta por tela, heartbeat,
reconexão e timeout de infraestrutura para uma contagem que muda quando alguém passa na
catraca.

### 3.6 Gatilhos de marco fora do crédito de XP

`EVENT_ATTENDANCE_FULL` e `REVIEWER_TOP` não são pontuação: são reconhecimento. Criar um
lançamento de XP de valor zero só para reusar o caminho poluiria o livro-razão, então
eles usam `grantCardForTrigger`. Como esse caminho grava com `ON CONFLICT ... quantity
+ 1`, repetir a chamada AUMENTARIA as cópias — e por isso as duas concessões checam
antes se a pessoa já tem carta daquele gatilho naquele evento. "Esteve em tudo" é um
fato que acontece uma vez.

---

## 4. ADRs

### ADR-085 — Suplente é posição sorteada, não segundo sorteio

**Contexto.** "Só titulares são sorteados" era a dívida (G1): quando o titular não
aparecia para retirar o prêmio, a instituição refazia o sorteio no palco — sobre um
universo já diferente.

**Decisão.** `alternatesCount` na configuração; a apuração sorteia
`titulares + suplentes` de uma vez, em posições próprias com `kind`. A exclusão de
ganhadores anteriores considera apenas `kind = WINNER`.

**Justificativa.** Sortear suplentes depois exigiria uma segunda apuração sobre outro
universo e destruiria a resposta a "quem era o reserva na hora do sorteio". Excluir o
suplente dos sorteios seguintes puniria quem não ganhou nada.

**Consequências.** (+) Reserva registrada e auditável; entrega decidida no balcão com
a lista na mão. (−) A tabela `raffle_winners` guarda titulares E suplentes (nome
mantido para não renomear tabela sob RLS); toda leitura nova precisa olhar `kind` para
não confundir reserva com ganhador.

### ADR-086 — A entrega do prêmio é um recibo, e o recibo é por posição

**Contexto.** Não havia registro de retirada: "fulano já pegou?" dependia da memória de
quem estava no balcão.

**Decisão.** `deliveredAt`, `deliveredById` e `deliveryNote` na posição sorteada,
gravados por `markPrizeDelivered` com trilha. O identificador é o da POSIÇÃO.

**Justificativa.** A mesma pessoa pode ocupar posições diferentes em sorteios
diferentes, e quem entrega está olhando para uma posição daquele sorteio. A primeira
versão recebia `winnerId` e comparava com o id da LINHA enquanto a tela enviava o id da
PESSOA — um `NOT_FOUND` silencioso que o teste de integração pegou; o parâmetro passou
a se chamar `positionId`.

**Consequências.** (+) Recibo com autor e horário, visível para o próximo plantão.
(−) Marcar duas vezes devolve `ALREADY_DELIVERED` em vez de sobrescrever: um recibo que
pode ser reescrito em silêncio não é recibo — e um clique errado exige correção por
SQL (dívida declarada).

### ADR-087 — Peso por minutos é opção explícita, com piso 1

**Contexto.** Todos os elegíveis tinham a mesma chance, mesmo quem passou 8 horas no
evento contra quem apareceu 10 minutos.

**Decisão.** `weightByMinutes` (desligado por padrão); ligado, a chance é proporcional
ao tempo assistido. `participantWeight` aplica piso 1.

**Justificativa.** Ligar por padrão mudaria o resultado de sorteios já combinados com o
público ("todo mundo tem a mesma chance") sem que ninguém tivesse pedido. O piso existe
porque zerar o peso de alguém ELEGÍVEL seria excluí-lo por outra via.

**Consequências.** (+) Eventos longos podem premiar presença prolongada. (−) Peso
proporcional é fácil de explicar e difícil de auditar visualmente: a prova continua
sendo a semente e o payload (que registra `weightByMinutes`), não a intuição.

### ADR-088 — Commit-reveal com semente selada e payload versionado

**Contexto.** O hash provava integridade, não anterioridade. E os campos novos
(suplentes, peso, papel) precisavam entrar no conteúdo assinado sem invalidar o hash de
apurações antigas.

**Decisão.** Compromisso `sha256(semente)` publicado na criação e na trilha; semente
selada com AES-256-GCM (chave derivada de `BETTER_AUTH_SECRET` + rótulo); revelação na
apuração; RNG determinístico `HMAC-SHA256(semente, contador)`; `resultVersion` na linha
e payload reconstruído na versão certa.

**Justificativa.** Sem versionar o payload, toda apuração anterior passaria a acusar
adulteração. Alternativa descartada: guardar a semente em claro (um dump do banco
revelaria o resultado antes da hora) e usar `Math.random` semeado (não reproduzível por
terceiros).

**Consequências.** (+) Qualquer pessoa confere o compromisso e reproduz o resultado.
(+) A auditoria histórica continua válida (versão 1 preservada). (−) Uma variável de
ambiente a mais no caminho crítico (o segredo de sessão): sem ela, o sorteio roda sem
compromisso e a tela avisa. (−) Semente revelada e compromisso publicados no resultado
público — é intencional.

### ADR-089 — Resultado público: opt-in por sorteio e nome mascarado por padrão

**Contexto.** O resultado vivia só no painel (G5), e publicar nome de ganhador é dado
pessoal que ninguém consentiu ao se credenciar.

**Decisão.** `isPublic` por sorteio (só depois de apurado) e `publicWinnerName`: nome
completo apenas para quem tem `isPublicProfile`; os demais saem como `Ana S.`. A prova
(hash, compromisso e semente) acompanha o resultado.

**Justificativa.** Alternativa descartada: publicar sempre (exposição sem
consentimento) ou nunca (a instituição não tem onde apontar). Publicar só o nome
transformaria o sorteio em promessa; com a prova, qualquer pessoa confere.

**Consequências.** (+) A instituição decide e o público confere. (−) Publicar é ato
deliberado por sorteio: um sorteio novo nasce não publicado, e quem esquecer de
publicar não verá o resultado na vitrine (a tela do painel diz isso).

### ADR-090 — Prévia ao vivo reusa a contagem da apuração (polling)

**Contexto.** A prévia era calculada no carregamento; no palco o número envelhecia em
segundos e a saída era recarregar a página (G7).

**Decisão.** Rota `GET /api/events/[eventId]/raffle-live` (sessão + `event:manage`,
sob RLS) que devolve contagem, último check-in e horário da amostra; a tela consulta a
cada 5 segundos.

**Justificativa.** Reusar `previewEligibility` garante que a tela e a apuração usem o
MESMO critério. SSE foi descartado (conexão aberta, heartbeat, reconexão) por ganho
imperceptível numa contagem de catraca.

**Consequências.** (+) A tela acompanha o credenciamento sem recarregar e diz quando
amostrou. (−) Cada tela aberta faz 12 requisições por minuto enquanto está visível; a
consulta é limitada (`MAX_INSPECTED_ATTENDANCES`) e roda sob RLS.

### ADR-091 — Gatilhos de marco: concessão idempotente fora do crédito de XP

**Contexto.** `EVENT_ATTENDANCE_FULL` e `REVIEWER_TOP` eram selecionáveis no catálogo e
NUNCA disparavam: o organizador montava a carta e ela não saía.

**Decisão.** `grantFullAttendanceCard` (avaliado no check-out, com a regra
"todas as atividades exigidas + nenhuma pendente") e `awardTopReviewers` (ranking com
piso lido do `triggerCondition.threshold` da própria carta, premiando o top N). Ambos
usam `grantCardForTrigger` e checam antes se a conquista daquele evento já existe.

**Justificativa.** São reconhecimento, não pontuação: creditar XP de valor zero para
reusar o caminho do motor poluiria o livro-razão. E `grantCardForTrigger` incrementa
`quantity` a cada chamada, o que para um marco único estaria errado.

**Consequências.** (+) Os dois gatilhos passam a existir de fato, com trilha.
(−) `REVIEWER_TOP` é ato manual (o comitê encerra e premia), não automático — decisão
explícita, porque "ser destaque" é julgamento sobre o evento inteiro.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | `NOT_FOUND` ao registrar entrega do prêmio, com a posição existindo na tela | O serviço comparava `winnerId` com o id da LINHA e a tela enviava o id da PESSOA; o nome do parâmetro escondia a diferença | Parâmetro renomeado para `positionId` (ADR-086) e o id da posição passou a ser exposto na listagem |
| 2 | Teste de integração do hash falhou depois da mudança: "expected 9491… to be db58…" | O teste reconstruía o payload na versão 1; a apuração nova grava versão 2 com suplentes/peso/papel | O teste passou a ler `resultVersion` do banco — exatamente o que a versionagem existe para permitir |
| 3 | E2E: o terceiro cenário abriu uma instituição VAZIA, sem o sorteio do cenário anterior | O segundo cenário falhou e o **Playwright reinicia o worker** após uma falha: `beforeAll` rodou de novo e recriou o fixture, enquanto o teste seguinte seguiu com os novos ids | Diagnóstico por log temporário (`dbCount` = 0 vs `anyCount` = 2) e correção do PRIMEIRO defeito; os fixtures ficaram em `beforeAll` e a dependência é do banco |
| 4 | E2E: `positions.map(kind)` devolveu apenas `['WINNER']` | O cenário pedia 1 titular + 1 suplente com UM elegível; a regra (correta) dá prioridade ao titular e não sobra reserva | Cenário passou a credenciar duas pessoas — o teste é que estava errado, não a regra |
| 5 | E2E antigo (FASE 8) quebrou: esperava "1 vencedor" e recebeu "1 titular(es)" | A mensagem passou a usar a distinção titular/suplente sempre | A mensagem volta a dizer "vencedor(es)" quando NÃO há suplentes (e "titular/suplente" quando há) — precisão onde importa, compatibilidade onde não |
| 6 | `npm test` reprovou a trava de design: "tamanho de fonte vem da escala tipográfica" | Dois componentes novos usavam `text-[10px]` e `text-[11px]` | Trocados por `label-caps`/`text-xs` — a catraca da FASE 11B pegou o deslize antes da revisão |
| 7 | Teste de integração do ranking falhou com violação de `reviews_submissionId_reviewerId_key` | O cenário dava 3 pareceres à mesma pessoa na MESMA submissão, e o modelo permite um por (submissão, revisor) | O cenário passou a criar 3 submissões — que é como a revisão real funciona |

---

## 6. Evidência de verificação

### 6.1 Bateria completa

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 36 arquivos, 921 testes passando
npm run build                → ✓ Compiled successfully · ƒ /api/events/[eventId]/raffle-live
npm run db:verify            → Contrato íntegro.
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:verify:pooling    → Pooling íntegro: contexto por transação preservado sob PgBouncer.
npm run db:partitions        → partições em dia (820 linhas de auditoria)
npm run test:e2e             → 55 passed (1.4m)
```

### 6.2 E2E dos itens novos (contra o container de produção)

```text
✓ a contagem de elegíveis se atualiza sozinha com o credenciamento (G7)
✓ a apuração entrega titulares e suplentes, com a prova da semente (G1, G4)
✓ a entrega do prêmio é registrada e o resultado é publicado (G2, G5)
✓ a seção de reconhecimento do comitê existe no evento (F1)
```

O cenário de G7 é literal: a tela abre com `0 elegíveis`, alguém é credenciado no
banco, e a contagem passa para `1` e depois `2` **sem recarregar a página**.

### 6.3 Integração (banco real)

```text
✓ sorteia titulares e suplentes na MESMA apuração, com papel próprio
✓ suplente NÃO conta como ganhador anterior na apuração seguinte
✓ registra a retirada com autor, horário e trilha
✓ recusa registrar a entrega duas vezes (recibo não se reescreve)
✓ publica o compromisso na criação e revela a semente na apuração
✓ publica o resultado com nome mascarado (nome completo só para perfil público)
✓ pagina o histórico com total e sem perder o começo da lista
✓ concede a carta de presença total UMA vez
✓ rankeia por pareceres concluídos e premia o primeiro
```

---

## 7. Comandos operacionais

```bash
# ── Conferir a prova de um sorteio ─────────────────────────────────────────────
# No painel: Sorteios → o histórico mostra hash, compromisso e semente revelada.
# Conferência manual (duas contas):
node -e "const c=require('crypto');const s='<semente revelada>';
console.log(c.createHash('sha256').update(s).digest('hex') === '<compromisso>')"

# ── Prévia ao vivo (mesma contagem da apuração) ────────────────────────────────
curl -s -b <cookie-de-sessao> \
  "http://localhost:3000/api/events/<eventId>/raffle-live?tenantSlug=<slug>&scope=EVENT"

# ── Resultado público ──────────────────────────────────────────────────────────
# Publicar é por sorteio (painel → histórico → "Publicar resultado").
# A página do evento mostra a seção quando existe resultado publicado.
```

```sql
-- Suplentes e entregas de um sorteio (auditoria direta):
SELECT w.position, w.kind, u.name, w."attendanceMinutes",
       w."deliveredAt", w."deliveryNote"
  FROM raffle_winners w JOIN "user" u ON u.id = w."userId"
 WHERE w."raffleId" = '<raffleId>' ORDER BY w.position;
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Item | Por que ficou | Impacto se ficar |
|---|---|---|---|
| 1 | **Desfazer uma entrega registrada por engano (G2)** | O recibo é imutável por decisão (ADR-086); corrigir exige SQL | Um clique errado no balcão fica registrado até alguém corrigir no banco |
| 2 | **Paginação do histórico é por página, sem busca nem filtro** | A fase entregou a paginação (G6); filtro por status/período é outra necessidade | Evento com muitos sorteios exige navegar página a página |
| 3 | **`REVIEWER_TOP` premia só o topo (N configurável no serviço, não na tela)** | O ato é manual e o padrão é 1 destaque | Premiar os 3 primeiros exige SQL/chamada direta ao serviço |
| 4 | **A prévia ao vivo é polling de 5s** | SSE traria reconexão/heartbeat sem ganho perceptível (ADR-090) | 12 requisições/min por tela aberta; em rede lenta o número pode atrasar alguns segundos |
| 5 | **Semente comprometida depende do segredo de sessão** | Reusar `BETTER_AUTH_SECRET` evitou variável nova; a chave é derivada com rótulo | Trocar o segredo invalida a abertura de sementes **seladas** (apurações futuras caem no gerador do sistema); apurações já reveladas continuam conferíveis |
| 6 | **Resultado público não tem página própria nem RSS** | A seção na página do evento resolve a divulgação; página dedicada é produto | Quem quer acompanhar um sorteio específico navega até o evento |

---

## 9. Checklist de aceite

- [x] **G1** — suplentes sorteados na mesma apuração, com papel por posição e limites validados
- [x] **G1** — exclusão de ganhadores anteriores considera apenas titulares (teste de integração)
- [x] **G2** — registro de entrega por posição, com autor, horário, observação e trilha
- [x] **G2** — segunda tentativa devolve `ALREADY_DELIVERED` sem sobrescrever
- [x] **G3** — sorteio ponderado por minutos, opcional, com peso mínimo 1 e teste de distribuição
- [x] **G4** — compromisso publicado na criação, semente selada e revelada na apuração
- [x] **G4** — resultado reproduzível a partir da semente e `verifySeed` conferindo o compromisso
- [x] **G4** — payload de auditoria versionado: apuração antiga continua verificável (teste unitário e de integração)
- [x] **G5** — publicação opt-in por sorteio, recusada antes da apuração
- [x] **G5** — nome público mascarado por padrão e completo só com perfil público
- [x] **G5** — seção de resultados na página pública do evento, sem sessão
- [x] **G6** — histórico paginado com total, página limitada e nenhum item repetido
- [x] **G7** — prévia ao vivo reusando a contagem da apuração, com horário da amostra
- [x] **G7** — E2E provando a atualização sem recarregar após credenciamento
- [x] **F1** — `EVENT_ATTENDANCE_FULL` concedido no check-out que fecha a última atividade exigida, uma única vez
- [x] **F1** — `REVIEWER_TOP` concedido por ranking com piso, idempotente, auditado
- [x] Testes novos: 38 unitários + 13 de integração + 4 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 6
- [x] `README.md`, `AGENTS.md` e `docs/dividas-tecnicas.md` atualizados
- [x] Imagem `eventflow/web:local` reconstruída e E2E rodando contra ela

---

**Aguardando APROVADO: AVANÇAR**
