# FASE 13 — Operação e segurança

> **Itens quitados:** A1 (rate limit distribuído) · B1 (observabilidade) ·
> B2 (RLS nas migrações) · B3 (particionamento do `AuditLog`) · B4 (PgBouncer).
> Todos vêm do levantamento consolidado em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md),
> que os classificava como "os itens que **impedem produção com mais de uma instância**".
>
> **Regra da fase cumprida:** cada item foi implementado, verificado contra a
> infraestrutura real (PostgreSQL, Redis, PgBouncer, container de produção) e
> registrado aqui com a saída dos comandos — não com a expectativa deles.

---

## 1. Sumário executivo

### 1.1 Entregas

| # | Entrega | Onde | Estado |
|---|---|---|---|
| A1 | Rate limit do Better Auth contando no Redis, com operação atômica (Lua) e falha aberta | `src/lib/auth/rate-limit-storage.ts` · `src/lib/auth/auth.ts` | ✅ |
| B1 | Registro de métricas em processo com exposição no formato Prometheus | `src/lib/observability/metrics.ts` · `src/app/api/metrics/route.ts` | ✅ |
| B1 | Log estruturado com redação de PII e de segredo | `src/lib/observability/logger.ts` | ✅ |
| B1 | Instrumentação do Proxy (contagem e duração por rota/método/status) | `src/lib/observability/route-label.ts` · `src/proxy.ts` | ✅ |
| B1 | Gauges da fila no scrape (`waiting`, `active`, `completed`, `failed`, `workers`, `up`) | `src/lib/certificates/queue.ts` · `src/app/api/metrics/route.ts` | ✅ |
| B2 | Policies de RLS dentro de uma migração; `migrate deploy` cria um banco íntegro | `prisma/migrations/20260917191000_rls_policies/` · `prisma/scripts/apply-rls.mjs` | ✅ |
| B3 | `audit_logs` particionada por mês, com PK composta e partição `DEFAULT` | `prisma/migrations/20260917200000_audit_logs_partitioning/` | ✅ |
| B3 | Manutenção de partições: cria as futuras e resgata linhas da `DEFAULT` | `prisma/scripts/ensure-audit-partitions.mjs` (`npm run db:partitions`) | ✅ |
| B4 | PgBouncer em modo transação no perfil `pooler` do compose | `docker-compose.yml` | ✅ |
| B4 | Prova de que o contexto de tenant não vaza entre transações sob pooling | `prisma/scripts/verify-pooling.mjs` (`npm run db:verify:pooling`) | ✅ |
| — | Contrato de schema ciente de partições (RLS exigida na filha) | `prisma/scripts/assert-schema-contract.mjs` · `src/lib/db/schema-contract.ts` | ✅ |
| — | Testes novos (unit + integração + E2E) | `tests/unit/observability.test.ts` · `tests/unit/rate-limit-storage.test.ts` · `tests/integration/observability.test.ts` · `tests/e2e/operations.spec.ts` | ✅ |

### 1.2 Números da fase

| Métrica | Antes | Depois |
|---|---|---|
| Testes (Vitest: unit + integração) | 799 | **832** (+33) |
| Testes E2E (Playwright) | 44 | **47** (+3) |
| Migrações | 10 | **12** (+2: `rls_policies`, `audit_logs_partitioning`) |
| ADRs | 74 | **79** (ADR-075 a ADR-079) |
| Endpoints HTTP instrumentados | — | 1 novo (`/api/metrics`) + 100% da navegação medida pelo Proxy |
| Arquivos novos | — | 12 (3 de código de observabilidade, 1 de rate limit, 1 rota, 2 migrações, 2 scripts, 4 de teste) |

---

## 2. O problema mais difícil da fase

**Particionar `audit_logs` sem quebrar o isolamento multi-tenant — nem o ORM.**

O particionamento em si é mecânico. O que decide o desenho é a soma de três
restrições que só aparecem juntas:

1. **O PostgreSQL exige que a chave de particionamento faça parte de toda chave
   única.** Particionando por `createdAt`, a PK deixa de ser `(id)` e passa a ser
   `(id, createdAt)`. Isso atravessa a fronteira do banco e chega ao Prisma:
   `@@id([id, createdAt])`, e nenhum `findUnique({ id })` em `audit_logs` — que
   hoje não existe, mas passaria a ser um erro de tipo se alguém escrevesse.
2. **Nada pode apontar para `audit_logs` com FK.** Uma tabela particionada não
   pode ser referenciada por chave estrangeira (o alvo precisaria de uma chave
   única global). Verificado antes de migrar: **não há FK de entrada**.
3. **A auditoria não pode falhar.** O caminho de escrita é o mesmo da operação
   auditada: se o `INSERT` em `audit_logs` estourar porque a partição do mês não
   existe, a operação de negócio morre junto. Por isso existe uma partição
   `DEFAULT` — e por isso o script de manutenção precisa saber **mover** linhas que
   caíram nela quando a partição definitiva é criada (o PostgreSQL recusa criar
   uma partição cujo intervalo colida com linhas já na `DEFAULT`).

O desenho final: tabela nova particionada criada com `LIKE ... INCLUDING DEFAULTS
INCLUDING CONSTRAINTS` (forma copiada da definição real, não reescrita à mão),
partições para todo mês presente no legado + mês atual + próximo, `DEFAULT`,
cópia dos dados, `DROP` do legado (que libera os nomes de índice — o namespace de
índice é global no schema) e só então PK, FKs, índices, RLS e GRANTs.

**Resultado medido:** 381 linhas preservadas, 100% em `audit_logs_2026_09`,
contrato de isolamento íntegro, `db:verify:isolation` 9/9.

---

## 3. Decisões técnicas

### 3.1 Rate limit: uma operação, não `get` + `set`

O contrato do Better Auth 1.7 é `consume(key, { window, max })` — uma chamada que
**conta e decide**. Implementado com `INCR` + `PEXPIRE` (só na primeira contagem) +
`PTTL` dentro de um script Lua, que o Redis executa como operação isolada. Lida e
depois escrita, N requisições simultâneas leriam o mesmo valor e todas se achariam
dentro do limite.

O `PEXPIRE` na primeira contagem define **janela fixa**. Renovar o TTL a cada
requisição transformaria a janela em "tempo desde a última tentativa" — e quem
insistisse nunca seria bloqueado. Há teste para isso (`define o TTL UMA vez por
janela`).

### 3.2 Observabilidade: registro próprio, sem SDK

Três perguntas precisavam de resposta (o processo está de pé? quanto entra e quanto
é bloqueado? a fila cresce ou falha?) e nenhuma exigia dependência nova. O registro
vive no `globalThis` do processo e exporta **texto Prometheus** — contrato estável,
lido por qualquer coletor sem plugin. Teto de 500 séries: rótulo livre é vazamento
de memória com outro nome, e o rótulo de rota **substitui o slug do tenant por
curinga** (`/t/<curinga>/admin`).

O endpoint é fechado por `METRICS_TOKEN`; **sem token, em produção, responde 404** —
não 401. Um 401 confirma a existência da rota e convida a tentar tokens.

Os contadores do **worker não são exportados**: o worker é outro processo, e expor
métricas ali exigiria publicar uma porta HTTP só para isso. O BullMQ é a fonte
compartilhada — o scrape lê `getJobCounts()` e `getWorkersCount()`, e
`bullmq_queue_workers` responde "o worker está vivo?" (o tamanho da fila, sozinho,
demora a perceber a queda: `waiting` cresce com o worker morto).

### 3.3 PgBouncer em modo transação — e por que aqui é seguro

Em modo sessão o pool é por cliente e o ganho desaparece; em modo transação a
conexão volta ao pool no `COMMIT`, o que só é seguro porque **o contexto de tenant
é `SET LOCAL`** (invariante nº 2 do `AGENTS.md`). Auditoria de código antes de
adotar: não há `pg_advisory_lock`, `LISTEN`/`NOTIFY` nem prepared statement nomeado
— nada que dependa de estado de sessão. `SERVER_RESET_QUERY = DISCARD ALL` fecha a
porta do que sobrar.

`AUTH_TYPE = scram-sha-256` porque é assim que o PostgreSQL 18 grava a senha da
role de aplicação: com `md5` o PgBouncer não verifica o hash e todo login falha.

### 3.4 RLS na migração (B2)

As policies viviam em `docker/postgres/init/` e dependiam de `npm run db:rls`: um
banco criado por `prisma migrate deploy` nascia **sem RLS**. A migração
`20260917191000_rls_policies` passou a conter o arquivo inteiro (o `\set
ON_ERROR_STOP on` do psql foi removido — meta-comando não é SQL), o init virou um
stub que aponta para ela e `db:migrate:deploy` encadeia `db:rls` por garantia.

---

## 4. ADRs

### ADR-075 — Rate limit distribuído no Redis, com falha aberta

**Contexto.** O limitador do Better Auth era em memória, por processo. Com duas
instâncias, cada uma contava metade das tentativas: o limite efetivo dobrava. Em
endpoint de login, isso não é degradação — é a proteção desaparecendo.

**Decisão.** `customStorage` apontando para Redis, com `INCR`+`PEXPIRE`+`PTTL`
atômicos em Lua, chave prefixada (`ef:rl:`), e **falha aberta** quando o Redis não
responde (métrica `rate_limit_unavailable_total` + log de aviso uma única vez).

**Justificativa.** Limite de tentativas é mitigação de força bruta; autorização é o
RBAC, que não depende de Redis. Falhar fechado trocaria "sem proteção contra força
bruta" por "produto fora do ar" — negócio pior. O prefixo separa domínios de chave
no mesmo Redis (um `DEL` de manutenção em cache não apaga contadores).

**Consequências.** (+) Limite vale entre instâncias e sobrevive a restart. (−) Uma
indisponibilidade do Redis deixa o login sem limite — visível por métrica, que é o
que permite alertar. (−) Exige Redis na rota de autenticação; o `enableOfflineQueue:
false` garante que a requisição falhe rápido em vez de esperar reconexão.

### ADR-076 — Métricas em processo no formato Prometheus, endpoint fechado por token

**Contexto.** Nenhuma métrica existia; o único sinal operacional era `console.*`.

**Decisão.** Registro próprio (`globalThis`), contadores/gauges/histograma, exposição
em `/api/metrics` com `METRICS_TOKEN` obrigatório; sem token, 404 em produção.

**Justificativa.** O formato de exposição é contrato do Prometheus, não do projeto:
qualquer coletor lê sem plugin e a migração para OpenTelemetry no futuro exporta a
partir do mesmo registro. O 404 (e não 401) evita anunciar a rota a quem sonda.

**Consequências.** (+) Latência, taxa de erro, bloqueio de tenant suspenso e
profundidade da fila passam a ser observáveis. (−) É estado por processo: com N
instâncias há N conjuntos, e quem soma é o coletor — comportamento esperado no
Prometheus, mas exige que o coletor descubra as instâncias. (−) O `guarda-chuva` de
um SDK (trace distribuído, exemplars) continua ausente.

### ADR-077 — PgBouncer em modo transação, sustentado por `SET LOCAL`

**Contexto.** Cada processo Node abre o próprio pool; web (N instâncias) + worker
esgotam `max_connections=200` antes de a carga justificar. O contexto de tenant por
transação já é compatível com pooling em modo transação — faltava a peça.

**Decisão.** Serviço `pooler` (perfil `pooler`, porta 6432) com `POOL_MODE=transaction`,
`DEFAULT_POOL_SIZE=5`, `AUTH_TYPE=scram-sha-256` e prova automatizada em
`npm run db:verify:pooling`.

**Justificativa.** Alternativa descartada: modo sessão (sem ganho real de
multiplexação). Alternativa descartada: aumentar `max_connections` (empurra o custo
de memória por conexão para o banco e não resolve o N+1 de pools por processo).

**Consequências.** (+) 8 clientes simultâneos couberam em 5 conexões de servidor,
medido em `pg_stat_activity`. (−) Duas configurações de URL (`APP_DATABASE_URL` e
`DATABASE_URL_POOLED`): apontar o runtime para o pooler é decisão de implantação,
documentada e não automática.

### ADR-078 — `audit_logs` particionada por mês, PK composta e partição `DEFAULT`

**Contexto.** `audit_logs` é a única tabela que cresce para sempre: sem exclusão,
sem arquivamento, uma linha por operação sensível. Descartar um ano exigia `DELETE`
massivo — que incha a tabela em vez de devolver espaço.

**Decisão.** `PARTITION BY RANGE ("createdAt")` com partições mensais, `@@id([id,
createdAt])` no schema, partição `DEFAULT` para que a escrita nunca falhe, e
`npm run db:partitions` criando os meses futuros (resgatando linhas da `DEFAULT`
quando o mês virou sem manutenção).

**Justificativa.** Retenção passa a ser `DROP TABLE audit_logs_2026_09` —
instantâneo e sem bloat. Alternativa descartada: particionar por `tenantId` (poucos
tenants grandes, faixas desiguais e nenhuma política de retenção por data).
Alternativa descartada: não ter `DEFAULT` (um mês não criado derrubaria a operação
auditada).

**Consequências.** (+) Manutenção e retenção proporcionais ao mês. (+) Índices do
tamanho de um mês. (−) **Toda chave única futura em `audit_logs` precisa incluir
`createdAt`** — restrição do PostgreSQL, não escolha. (−) Um job de manutenção
passa a existir e precisa ser agendado (o script avisa; não se agenda sozinho).
(−) `DROP`/`CREATE` de partição é DDL e exige a role admin — não é operação de runtime.

### ADR-079 — Policies de RLS vivem na migração; o init é um ponteiro

**Contexto.** `migrate deploy` sozinho criava um banco **sem RLS**: as policies
estavam apenas em `docker/postgres/init/`, executado na criação do volume. Quem
subisse um ambiente com `db:migrate:deploy` e esquecesse `db:rls` teria a aplicação
rodando com isolamento dependendo só do filtro da aplicação.

**Decisão.** A migração `20260917191000_rls_policies` contém as policies (a mesma
lista por introspecção, as de identidade e as assertivas), o init virou stub de 23
linhas e `db:migrate:deploy` passou a encadear `db:rls` — que reaplica o arquivo de
forma idempotente em bancos já existentes.

**Justificativa.** Migração é o mecanismo auditável e versionado; `init/` só roda
uma vez, na criação do volume, e nenhum ambiente real passa por ali de novo.

**Consequências.** (+) Banco novo nasce íntegro com um comando. (+) O loop de
introspecção agora também cobre tabelas **particionadas** (`relkind IN ('r','p')`),
que é o caso do `audit_logs` desde a ADR-078. (−) O arquivo de RLS é grande e
duplicaria se alguém voltar a editar o init — o stub existe para impedir isso.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | `tsc` acusou `TS1161: Unterminated regular expression literal` em `src/proxy.ts` | Um comentário de bloco continha `/t/*/admin`: a sequência `*/` **fechou o comentário** e o resto virou código | Não escrever `*/` em comentário; no texto virou `/t/<curinga>/admin` |
| 2 | Healthcheck do PgBouncer sempre `starting`, porta 6432 publicada sem resposta | A imagem escuta em **5432** por padrão; o `LISTEN_PORT` não estava definido, então o `nc -z 127.0.0.1 6432` do probe nunca encontrava ninguém | `LISTEN_PORT: "6432"` no serviço — a porta publicada e a porta interna passaram a coincidir |
| 3 | `npm run db:partitions` falhou com `bind message supplies 2 parameters, but prepared statement requires 0` | Limite de partição é DDL: o PostgreSQL **não aceita parâmetro** em `FOR VALUES FROM ($1) TO ($2)` | Limite interpolado como literal `'YYYY-MM-DD'`, gerado de uma `Date` calculada no processo |
| 4 | Teste unitário reprovou: `routeLabel('/t/ufba-demo')` devolvia `/t` | `PATH_TENANT_PREFIX` vale `'/t'` (**com barra**, é prefixo de path) e era comparado com um **segmento** de URL: `'t' === '/t'` é sempre falso | Constante derivada `TENANT_SEGMENT = PATH_TENANT_PREFIX.replace(/^\//, '')` — defeito real, encontrado pelo teste antes de ir para produção |
| 5 | Teste do histograma não encontrava `le=25` na exposição | Todo valor de rótulo sai entre aspas, inclusive o `le` do balde | Expectativa corrigida para `le="25"` (formato do Prometheus confirmado na saída real) |
| 6 | A prova de pooling "passava" lendo instituições, sem discriminar nada | A policy de `tenants` é `USING (true)` **por desenho** (a resolução de slug → id acontece antes de existir contexto): a leitura devolvia a mesma linha para todos | A leitura discriminante passou a ser o `tenantId` de `events`; o teste documenta por que `tenants` não serve |
| 7 | `db:verify` passou a avisar "Declaradas no contrato mas ainda sem coluna tenantId: audit_logs" | As consultas filtravam `relkind = 'r'`; a tabela particionada é `relkind = 'p'` e **saiu** do contrato e do loop de RLS | `relkind IN ('r','p') AND NOT c.relispartition`, mais a seção 3b exigindo RLS/FORCE/policy em **toda partição** |
| 8 | `TS2322: Type 'string \| null' is not assignable to type 'string \| undefined'` no log do worker | `LogFields` tipa `tenantId?: string`; passar `null` viola o tipo | `?? undefined` nos campos indexados do log — o tipo do campo pegou o engano na compilação |
| 9 | Esperava-se que `recordAudit` lançasse ao violar RLS; o teste não via erro | `recordAudit` **nunca lança** (falha de auditoria não desfaz operação de negócio) | As asserções de RLS usam `withTenant` + Prisma direto; o teste do serviço real verifica **onde a linha foi gravada** |

---

## 6. Evidência de verificação

### 6.1 Bateria completa

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 32 arquivos, 832 testes passando
npm run build                → ✓ Compiled successfully · ƒ /api/metrics na listagem
npm run db:verify            → Contrato íntegro.
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:verify:pooling    → Pooling íntegro: contexto por transação preservado sob PgBouncer.
npm run test:e2e             → 47 passed (1.1m)
```

### 6.2 Particionamento (B3)

```text
$ npm run db:partitions
  partição                       linhas     tamanho
  audit_logs_2026_09                381     0.27 MB
  audit_logs_2026_10                  0     0.04 MB
  audit_logs_2026_11                  0     0.04 MB
  audit_logs_default                  0     0.09 MB
  total: 381 linha(s)

$ psql -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='audit_logs'::regclass"
  audit_logs_pkey          | PRIMARY KEY (id, "createdAt")
  audit_logs_tenantid_fkey | FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE SET NULL
  audit_logs_userid_fkey   | FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE SET NULL

$ psql -c "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname LIKE 'audit_logs%'"
  audit_logs           | (particionada, relkind = 'p')
  audit_logs_2026_09   | t | t   (1 policy)
  audit_logs_2026_10   | t | t   (1 policy)
  audit_logs_2026_11   | t | t   (1 policy)
  audit_logs_default   | t | t   (1 policy)
```

O caminho de resgate foi exercitado de verdade: uma linha com `createdAt` em
`2027-01-15` caiu em `audit_logs_default`, e `npm run db:partitions -- --months=6`
criou `audit_logs_2027_01` movendo a linha:

```text
  ✓ audit_logs_2027_01 criada (1 linha(s) resgatada(s) da DEFAULT)
```

### 6.3 Pooling (B4)

```text
$ npm run db:verify:pooling
  tenant A: fiocruz-demo (1 eventos)
  tenant B: ufba-demo (1 eventos)

  ✓ 1. dentro da transação o contexto é o do tenant — 143e6c03-113c-46dd-8e30-73d50bb1aa7b
  ✓ 1. depois do COMMIT a mesma conexão não carrega contexto — current_setting = (vazio)
  ✓ 2. nenhuma das 8 transações concorrentes viu o contexto de outra
  ✓ 2. cada transação enxergou apenas dados do próprio tenant — tenants distintos vistos: 2 (esperado 2)
  ✓ 2. a contagem de eventos sob RLS corresponde ao tenant de cada transação — fiocruz-demo=1 · ufba-demo=1 · …
  ✓ 2. 8 clientes simultâneos couberam em no máximo 5 conexões de servidor — sessões ativas no PostgreSQL: 5
  ✓ 3. no contexto do tenant A, linhas do tenant B são invisíveis — count = 0

  Pooling íntegro: contexto por transação preservado sob PgBouncer.
```

### 6.4 Endpoint de métricas no container de PRODUÇÃO (B1)

Sem token — o comportamento que o E2E trava:

```text
$ curl -i http://localhost:3000/api/metrics
HTTP/1.1 404 Not Found
```

Com token, em um container efêmero (`docker compose run --rm -e METRICS_TOKEN=… -p 3010:3000 web`),
depois de uma navegação em `/t/ufba-demo`:

```text
$ curl -s -H "Authorization: Bearer token-verificacao" http://localhost:3010/api/metrics
# TYPE eventflow_uptime_seconds gauge
eventflow_uptime_seconds 21
# TYPE http_requests_total counter
http_requests_total{route="/t/*",method="GET",status="200"} 1
http_requests_total{route="/t/*/dashboard",method="GET",status="200"} 1
http_requests_total{route="/login",method="GET",status="200"} 1
# TYPE bullmq_queue_up gauge
bullmq_queue_up{queue="certificates"} 1
# TYPE bullmq_queue_workers gauge
bullmq_queue_workers{queue="certificates"} 1
http_request_duration_ms_count{route="/t/*"} 1
```

Duas coisas ficam provadas aqui, e as duas eram risco declarado: (a) o Proxy e a
rota de API são **bundles separados** no Next.js 16 e ainda assim compartilham o
registro — o `globalThis` é o mesmo processo (armadilha nº 14 do `AGENTS.md`); (b)
`bullmq_queue_workers 1` mostra o worker registrado no Redis, ou seja, "a fila
anda" e não apenas "a fila existe".

---

## 7. Comandos operacionais

```bash
# ── Rate limit distribuído (A1) ────────────────────────────────────────────────
# Ligado quando NODE_ENV=production && RATE_LIMIT_ENABLED != 'false'.
# As chaves vivem em ef:rl:<rota>:<ip>; inspecionar:
redis-cli --scan --pattern 'ef:rl:*' | head
redis-cli ttl 'ef:rl:/sign-in/email:127.0.0.1'

# ── Métricas (B1) ──────────────────────────────────────────────────────────────
export METRICS_TOKEN=$(openssl rand -hex 24)      # no .env, para o container
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3000/api/metrics
# Sem token em produção: 404 (proposital). Em dev: 200, sem token.

# ── RLS nas migrações (B2) ─────────────────────────────────────────────────────
npm run db:migrate:deploy    # migrate deploy + generate + db:rls
npm run db:verify            # contrato de isolamento (inclui partições)

# ── Partições da auditoria (B3) ────────────────────────────────────────────────
npm run db:partitions                # mês atual + PARTITION_MONTHS_AHEAD (padrão 2)
npm run db:partitions -- --months=6  # seis meses à frente
# Agende no host/cron. A retenção é DDL e é decisão de negócio:
#   DROP TABLE audit_logs_2025_01;   -- instantâneo, sem bloat

# ── PgBouncer (B4) ─────────────────────────────────────────────────────────────
docker compose --profile pooler up -d pooler
npm run db:verify:pooling
# Para o runtime usar o pooler, aponte APP_DATABASE_URL para a 6432 (ver .env.example).
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Item | Por que ficou | Impacto se ficar |
|---|---|---|---|
| 1 | **Adoção do `logger` nos ~66 `console.*` de serviço** | A fase migrou os pontos de operação (fila, worker, rate limit). Os serviços (`catalog-service`, `certificate-service`, `raffle-service`, …) continuam com `console.error` | Log sem estrutura nem redação nesses caminhos: um erro de serviço imprime a mensagem crua, sem `requestId`/`tenantId` correlacionáveis |
| 2 | **Agendamento do `npm run db:partitions`** | Não há scheduler no projeto (nem cron no container) | Mês sem partição cai na `DEFAULT`; o resgate funciona, mas a `DEFAULT` cresce e o `DROP` por mês perde o sentido |
| 3 | **Política de retenção da auditoria** | É decisão de negócio (LGPD × exigência de guarda), não técnica | Nada é descartado: o particionamento prepara o terreno, mas não o usa |
| 4 | **Coletor de métricas (Prometheus/Grafana)** | Fora do escopo de código do produto — o endpoint é o contrato | Métrica existe e ninguém lê; `bullmq_queue_up 0` não vira alerta |
| 5 | **Trace distribuído (OpenTelemetry)** | O registro próprio responde as três perguntas da fase; trace é outro nível | Investigação de latência ponta a ponta depende de log correlacionado |
| 6 | **`DATABASE_URL_POOLED` não é o padrão do runtime** | Apontar o runtime para o pooler é decisão de implantação (e o pooler não sobe por padrão) | Em escala, o teto de conexões volta a aparecer sem que ninguém tenha mexido em nada |
| 7 | **`session`/`account` do Better Auth fora do escopo de RLS** | Decisão da FASE 2 mantida: o login acontece antes de existir tenant | Sem mudança; registrado para não ser "descoberto" como novidade |
| 8 | **Editar migração já aplicada não é bloqueado pelo Prisma 7** | `migrate deploy` não revalida checksum de migração aplicada — a correção do loop de RLS (`relkind IN ('r','p')`) foi feita no arquivo | Bancos existentes recebem a correção via `npm run db:rls`; bancos novos já nascem certos. Ainda assim: **não edite migração aplicada sem registrar o porquê** |

---

## 9. Checklist de aceite

- [x] **A1** — rate limit do Better Auth conta no Redis, com decisão atômica e janela fixa
- [x] **A1** — falha aberta documentada, com métrica `rate_limit_unavailable_total` e log único
- [x] **A1** — testes unitários (Redis injetado) e de integração (Redis real, TTL real)
- [x] **B1** — registro de métricas com contador, gauge e histograma; rotação de série limitada
- [x] **B1** — endpoint `/api/metrics` no formato Prometheus, fechado por `METRICS_TOKEN` (404 sem token em produção)
- [x] **B1** — Proxy instrumentado por rota/método/status, sem cardinalidade de slug de tenant
- [x] **B1** — gauges da fila no scrape, incluindo `workers` (worker vivo)
- [x] **B1** — log estruturado com redação de segredo e de e-mail, em qualquer profundidade
- [x] **B2** — policies de RLS dentro de migração; `docker/postgres/init/02-rls-policies.sql` virou stub
- [x] **B2** — `db:migrate:deploy` encadeia `db:rls`; `db:verify` e `db:verify:isolation` verdes
- [x] **B3** — `audit_logs` particionada por mês, dados preservados (381 linhas), PK `(id, createdAt)`
- [x] **B3** — partição `DEFAULT` criada e caminho de resgate exercitado de ponta a ponta
- [x] **B3** — `npm run db:partitions` idempotente, com relatório de linhas e tamanho por partição
- [x] **B3** — contrato de schema e testes exigem RLS + FORCE + policy em toda partição
- [x] **B4** — PgBouncer em modo transação no perfil `pooler`, com healthcheck verde
- [x] **B4** — prova de que `SET LOCAL` não vaza entre transações e de que houve multiplexação (8 → 5)
- [x] Testes novos: 13 unitários (observabilidade) + 9 unitários (rate limit) + 11 de integração + 3 E2E
- [x] Bateria completa executada com os números reais reportados na seção 6
- [x] `README.md`, `AGENTS.md` e `docs/dividas-tecnicas.md` atualizados
- [x] Imagem `eventflow/web:local` reconstruída e E2E rodando contra ela (armadilha nº 3)

---

**Aguardando APROVADO: AVANÇAR**
