# FASE 116 — Cache de Leitura Pública, API v1 no Redis e Otimização de Payload/Streaming no Balcão

> **Entrega:** 18/11/2026 · **ADRs:** ADR-469, ADR-470, ADR-471 · **Dívidas técnicas:** 42 mantidas (0 abertas)

---

## 1. Sumário Executivo

A FASE 116 nasce diretamente de um **teste de carga exploratório (baseline F115)** que provou que o gargalo da plataforma sob picos de tráfego **não estava no PostgreSQL nem na RLS** (que operava com 3–8 conexões ativas, 99,99% de cache hit e 0 deadlocks), mas sim na **re-renderização SSR sem cache de dados**, na **execução dupla de `getPublicEventView`** (`generateMetadata` + `Page`), na **serialização de `242 KB` de HTML no balcão** e no **cálculo de ETag da API v1 após consultas completas no banco**.

### Tabela de entregas

| Camada | Arquivos | Responsabilidade |
|---|---|---|
| **Domínio puro** | `src/domain/cache/public-cache-rules.ts` | Chaves versionadas, tags canônicas, TTLs (`60s`), elegibilidade do diretório (`/eventos`), política anti-flood de certificados (`NOT_FOUND`/`NOT_ISSUED` nunca cacheados), `isWallClockNow`, teto inicial do balcão (`25` × `60`) e serialização JSON com preservação explícita de `Date` (`__efDate`). |
| **Infraestrutura de cache** | `src/lib/cache/redis-json-cache.ts`, `src/lib/cache/public-read-cache.ts` | Cache JSON distribuído em Redis com **invalidação O(1) por contador de versão** (`INCR ef:cache:ver:<ns>:<scope>`), modo **fail-open** (`enableOfflineQueue: false`, `connectTimeout: 500ms`) e fachada coordenada (`invalidatePublicEventCache`, `invalidatePublicEventCacheBySlug`, `invalidatePublicDirectoryCache`, `invalidatePublicCertificateCache` + `safeRevalidateTag`). |
| **Páginas públicas & serviços** | `src/lib/events/event-repository.ts`, `src/lib/events/public-event-view.ts`, `src/lib/raffles/raffle-public-view-service.ts`, `src/lib/proposals/call-service.ts`, `src/lib/certificates/certificate-service.ts`, `src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/page.tsx`, `src/app/(public)/eventos/page.tsx`, `next.config.ts` | `React.cache` em `getTenantContext` e `getPublicEventView` anônimo; `Promise.all` em `PublicEventPage`; cache versionado de `getPublicEvent`, `listPublicRaffleResults`, `listPublicCalls` e visão padrão de `/eventos`; cache direto de `getPublicCertificate` (com expurgo imediato em `revokeCertificate`) e `Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=60` apenas em `/validar/:code`. |
| **API Pública v1** | `src/lib/api/event-api-http.ts`, `src/lib/api/event-api-route-handlers.ts`, `src/lib/api/event-api-key-service.ts` | Cache de envelope pré-serializado `{ etag, bodyJson }` no Redis após as portas de segurança (`rate limit → tenant ativo → verifyEventApiKey → interruptor da seção`), atendendo `200` e `304 Not Modified` sem re-executar a projeção no Postgres. |
| **Invalidação nas mutações** | `admin-actions.ts`, `landing-actions.ts`, `sponsor-actions.ts`, `speaker-actions.ts`, `call-actions.ts`, `raffle-actions.ts`, `registration-actions.ts`, `team-order-actions.ts`, `event-api-actions.ts`, `platform-actions.ts` | Invalidação aguardada (`await`) antes do retorno de toda Server Action que altera conteúdo público ou API v1. |
| **Balcão `/credenciamento`** | `src/app/t/[tenantSlug]/(app)/credenciamento/page.tsx`, `src/components/credentials/checkin-queue-section.tsx` | Paralelização de `getSelfCheckinStatusSummary` no `Promise.all`, isolamento de `CheckinDeskSummarySection` em `<Suspense>`, eliminação de alocação da aba inativa e redução da janela inicial sem busca de `60 → 25` participantes (mantendo `60` com `?q=`). |
| **Testes** | `tests/unit/f116-cache-leitura-publica-e-balcao.test.ts`, `tests/integration/f116-api-v1-cache-e-invalidacao.test.ts`, `tests/e2e/f116-cache-publico-api-e-balcao.spec.ts` | **6** unitários + **2** integração contra Postgres + Redis reais + **1** E2E Playwright. |

### Números da fase

- **Testes adicionados:** `+8` Vitest (`6` unit + `2` integração) e `+1` E2E → **4.946** Vitest (`299` arquivos) + **565** E2E (`+1` skip).
- **Migrações de banco:** `0` (nenhuma alteração de schema).
- **ADRs:** `3` novos (**ADR-469** a **ADR-471**, total **471**).

---

## 2. O Problema Mais Difícil da Fase

A sugestão inicial era colar `'use cache'` + `Cache-Control: public` nas três rotas públicas. A auditoria do código revelou **dois bloqueios estruturais reais**:

1. **Incompatibilidade de `'use cache'` com 126 rotas `force-dynamic`:** no Next.js 16, `'use cache'` exige `cacheComponents: true` em `next.config.ts`, o que quebra no build qualquer rota que exporte `export const dynamic = 'force-dynamic'`.
2. **Risco de vazamento de sessão e sala online em `/t/[slug]/eventos/[eventSlug]`:** `PublicEventPage` e `PublicTenantLayout` leem `getAuthenticatedUser()` para entregar `onlineUrl` apenas a inscritos confirmados (FASE 68) e o token pessoal de agenda ICS (`agendaIcsToken`). Emitir `Cache-Control: public, s-maxage=...` na página do evento causaria cache poisoning em CDN/proxy compartilhado.

Por isso, a fronteira correta de cache foi desenhada **na camada de dados anônimos compartilháveis (Redis versionado + `React.cache`)**, deixando o estado pessoal (`onlineUrl`, `minhaAgenda`, `canOperateCounter`) fora de cache compartilhado e restringindo `Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=60` exclusivamente a `/validar/:code` (rota 100% anônima, sem cookies).

---

## 3. Comparativo Real de Teste de Carga (Antes × Depois)

Mesmo hardware, mesmo container Docker em produção (`eventflow-web` standalone + `eventflow-postgres` 18 + `eventflow-redis` 8) e mesma fixture isolada de **500 participantes / 750 inscrições**:

| Cenário / Estágio | Baseline (F115) | Pós-otimização (F116) | Ganho medido |
|---|---|---|---|
| **1A.** Página pública do evento (`20 VUs`) | `21,5 req/s` · `p95 1.203 ms` | **`56,7 req/s`** · **`p95 429 ms`** | **2,6× vazão · -64% p95** |
| **1A.** Página pública do evento (`50 VUs`) | `23,6 req/s` · `p95 2.447 ms` | **`61,6 req/s`** · **`p95 1.033 ms`** | **2,6× vazão · -58% p95** |
| **1A.** Página pública do evento (`100 VUs`) | `25,5 req/s` · `p50 3.798 ms` · PG ativo `4` | **`65,2 req/s`** · **`p50 1.460 ms`** · PG ativo **`1`** | **2,6× vazão · -62% p50** |
| **1B.** Diretório `/eventos` (`50 VUs`) | `98,1 req/s` · `p95 638 ms` | **`169,3 req/s`** · **`p95 327 ms`** | **1,7× vazão · -49% p95** |
| **2A.** `/validar/CERT` (`50 VUs`) | `82,5 req/s` · `p95 696 ms` | **`248,3 req/s`** · **`p95 260 ms`** | **3,0× vazão · -63% p95** |
| **2A.** `/validar/CERT` (`100 VUs`) | `81,9 req/s` · `p95 1.531 ms` | **`264,4 req/s`** · **`p95 423 ms`** | **3,2× vazão · -72% p95** |
| **2B-1.** API v1 latência `200 OK` (1 IP) | `p50 18,6 ms` · `p95 25,8 ms` | **`p50 3,6 ms`** · **`p95 4,6 ms`** | **5,6× mais rápida (-82% p95)** |
| **2B-2.** API v1 `GET evento` (`50 VUs`) | `116,8 req/s` · `p95 473 ms` | **`713,4 req/s`** · **`p95 90,2 ms`** | **6,1× vazão · -81% p95** |
| **2B-3.** API v1 `If-None-Match` (`304`, `50 VUs`) | `123,5 req/s` · `p95 475 ms` | **`659,7 req/s`** · **`p95 102,7 ms`** | **5,3× vazão · -78% p95** |
| **3A.** Balcão 500 inscritos (`20 VUs`) | `26,8 req/s` · `p95 866 ms` · `242 KB` | **`41,9 req/s`** · **`p95 542 ms`** · **`157 KB`** | **+56% vazão · -35% HTML** |
| **3A.** Balcão 500 inscritos (`50 VUs`) | `27,3 req/s` · `p95 1.956 ms` · `242 KB` | **`43,2 req/s`** · **`p95 1.244 ms`** · **`157 KB`** | **+58% vazão · -36% p95** |
| **3B.** Busca `?q=` em 500 inscritos (`30 VUs`) | `34,1 req/s` · `p95 1.003 ms` · PG ativo `8` | **`49,6 req/s`** · **`p95 670 ms`** · PG ativo **`3`** | **+45% vazão · -33% p95** |
| **3C.** Escrita concorrente de crachás (20 monitores) | `71,1/s` · `p95 403 ms` · `0` erros | **`120,9/s`** · **`p95 257 ms`** · **`0` erros** | **7.254 check-ins/min · 0 deadlocks** |

---

## 4. ADRs

### ADR-469 — Cache de dados anônimos versionado em Redis O(1) + `React.cache` em vez de `Cache-Control: public` na página do evento
- **Contexto:** A página pública `/t/[slug]/eventos/[eventSlug]` mistura projeção pública do evento com dados pessoais de sessão (`onlineUrl`, `minhaAgenda`, `agendaIcsToken`) e `generateMetadata` + `PublicEventPage` executavam `getPublicEventView` duas vezes sem deduplicação. Além disso, `cacheComponents: true` conflita com 126 rotas `force-dynamic`.
- **Decisão:** Adotar cache JSON versionado em Redis (`INCR ef:cache:ver:<namespace>:<scopeId>`) na camada de dados públicos anônimos (`getPublicEvent`, `listPublicRaffleResults`, `listPublicCalls`, diretório padrão `/eventos`, `getPublicCertificate`) com preservador explícito de `Date` (`__efDate`), falha aberta (`enableOfflineQueue: false`), deduplicação por requisição (`React.cache`) e `Promise.all` na página do evento. Restringir `Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=60` a `/validar/:code`.
- **Justificativa:** Garante escalabilidade multi-instância, invalidação O(1) instantânea sem `KEYS`/`SCAN`, zero vazamento de dados autenticados em CDN e compatibilidade integral com `f72-catraca-divergencia.test.ts` e as 126 rotas existentes.
- **Consequências:** Toda nova Server Action que altere conteúdo público de evento deve chamar `invalidatePublicEventCache` / `invalidatePublicEventCacheBySlug`. Em suítes Vitest o cache fica desligado por padrão (ativado via `force: true` nos testes da F116) para não interferir em fixtures que mutam Prisma diretamente.

### ADR-470 — Cache de envelope pré-serializado (`{ etag, bodyJson }`) na API v1 pós-portas de segurança
- **Contexto:** Antes da F116, requisições `304 Not Modified` na API v1 executavam `loadEventApiProjections` inteira no Postgres antes de comparar `If-None-Match` (`123,5` vs `116,8 req/s`).
- **Decisão:** Cachear o par `{ etag, bodyJson }` por `(tenantId, eventSlug, resource)` no Redis versionado (`namespace = 'api-v1'`, TTL `60s`) estritamente **após** rate limit, resolução de tenant ativo, `verifyEventApiKey` e checagem de interruptor da seção.
- **Justificativa:** Preserva `401` imediato para chaves revogadas e `404` imediato para seções desligadas, enquanto elimina projeções no Postgres, `JSON.stringify` e SHA-256 em hits `200`/`304` (ganho medido de **6,1×** em vazão e **-81%** no `p95`).
- **Consequências:** Mutações de evento, programação, palestrantes, patrocinadores, chamadas e seções da API invalidam o namespace `api-v1` do tenant em O(1).

### ADR-471 — Streaming do resumo operacional e janela inicial de 25 cards sem busca no balcão `/credenciamento`
- **Contexto:** Com 500 participantes, `/credenciamento` serializava 60 cards completos (com mapas de contexto por atividade) tanto no HTML quanto no flight payload RSC (`242 KB`), além de aguardar `getSelfCheckinStatusSummary` em cascata após `Promise.all`.
- **Decisão:** Paralelizar `getSelfCheckinStatusSummary` no `Promise.all` do `bootstrap`, isolar `CheckinDeskSummarySection` em `<Suspense>` próprio, evitar alocar `monitorActivities`/`queueActivities` na aba `autocredenciamento` e aplicar `resolveCheckinInitialQueueLimit(query)` (`25` sem busca, `60` com busca `?q=`).
- **Justificativa:** Reduz o HTML inicial de `242 KB` para `157 KB` (-35%) e aumenta a vazão do balcão em **+56%** mantendo o aviso honesto de truncamento e a busca completa no banco.
- **Consequências:** Operadores veem os primeiros 25 nomes em ordem alfabética ao abrir o balcão e digitam na busca (que traz até 60 correspondências) para localizar qualquer participante em eventos de grande porte.

---

## 5. Lições Aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `GET /validar/CERT` travava em `82 req/s` sob 100 VUs | `getPublicCertificate` executava `UPDATE certificates SET validationCount = validationCount + 1` em toda leitura pública, gerando contenção de row lock na mesma linha | Cache direto em Redis (`60s`) apenas para estados estáveis (`VALID`/`REVOKED`/`EXPIRED`), com expurgo imediato em `revokeCertificate` (`82 → 264 req/s`, **3,2×**) |
| `tsc --noEmit` falhou com `TS2769` em `deserializeCachePayload` | `noUncheckedIndexedAccess: true` tipou o acesso indexado `record[DATE_MARKER_KEY]` como `unknown | undefined` | Extração para variável `const iso = record[DATE_MARKER_KEY]` com guarda `typeof iso === 'string'` |
| `f116-cache-publico-api-e-balcao.spec.ts` falhou ao localizar aviso de truncamento e input de busca | `data-testid` real em `CheckinQueueSection` é `checkin-queue-truncation` (texto `"Mostrando os 25 primeiros de 30..."`) e o campo de busca usa `getByLabel('Buscar')` | Alinhamento dos seletores do teste E2E aos contratos acessíveis existentes |
| Playwright ESM quebrou ao listar specs (`Cannot find module '.../next/cache'`) | `src/lib/cache/public-read-cache.ts` importava `revalidateTag` estaticamente de `next/cache`, carregado por specs que importam serviços de `src/lib/**` | Importação preguiçosa `await import('next/cache')` dentro de `safeRevalidateTag()` |
| `event-team-block.spec.ts` e `f60-ocultacao-do-perfil.spec.ts` leram perfil público/oculto desatualizado na página do evento | `savePublicProfileAction` (`public-profile-actions.ts`) e `decideReport` com `HIDE` (`profile-moderation.ts`) alteram dados exibidos na equipe do evento sem invalidar o cache público | Invalidação de `invalidatePublicEventCache` nos dois fluxos (e nos helpers de banco direto em `f51` e `f68`) |
| 10 snapshots visuais em `f62-regressao-visual.spec.ts` divergiram em `~1%` nos badges | A correção de `extendTailwindMerge` em `src/lib/utils/cn.ts` restaurou `text-label-caps` (`11px`, conforme `DESIGN.md`) em `<Badge>` que antes caía para `16px` | Atualização controlada dos baselines de `f62-regressao-visual.spec.ts` seguida de reexecução com `0 px` de diferença |

---

## 6. Evidência de Verificação

- `npm run lint`: 0 erros, 0 warnings
- `npm run typecheck`: 0 erros
- `npm test`: **299 arquivos · 4.946 testes passando**
- `npm run build`: Compiled successfully
- `npm run db:verify`: Contrato íntegro
- `npm run db:verify:isolation`: 9/9 verificações passaram
- `npm run db:partitions`: partições do intervalo já criadas
- `npm run test:e2e`: **565 passando + 1 skip** (`566` casos)

---

## 7. Comandos Operacionais

```bash
npm run lint
npm run typecheck
npm test
npm run build
docker compose --profile app up -d --build web worker
npm run test:e2e
npm run db:verify
npm run db:verify:isolation
npm run db:partitions
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- **Migração futura para `cacheComponents: true` (Next.js 16):** quando as 126 rotas `force-dynamic` forem migradas para streaming/Suspense, a camada `public-read-cache.ts` já isola as fronteiras de dados anônimos e facilita adotar `'use cache'` diretamente nos componentes públicos.
- **Escalabilidade horizontal em produção:** com o banco e o Redis já desacoplados do gargalo, subir 2+ réplicas de `eventflow-web` atrás de reverse proxy com o perfil `pooler` (PgBouncer) escala a vazão linearmente.

---

## 9. Checklist de Aceite

- [x] Regras puras em `src/domain/cache/public-cache-rules.ts` sem imports de Prisma/Next/Redis
- [x] Cache JSON distribuído em Redis com invalidação O(1) e falha aberta (fallback silencioso ao banco)
- [x] Deduplicação `React.cache` + `Promise.all` + cache anônimo nas páginas públicas sem vazar sessão/`onlineUrl`
- [x] `Cache-Control` CDN seguro (`max-age=0, s-maxage=30, stale-while-revalidate=60`) em `/validar/:code` sem cachear `NOT_FOUND`
- [x] Cache de envelope + ETag no Redis para API v1 mantendo ordem de segurança (`rate limit → key → section`)
- [x] Invalidação coordenada em todas as Server Actions mutadoras de conteúdo público e revogação de certificado
- [x] Streaming de `CheckinDeskSummarySection` em `<Suspense>` e janela inicial de `25` cards sem busca em `/credenciamento`
- [x] Re-execução do teste de carga provando ganho real em todos os 3 cenários (2,6× a 6,1×)
- [x] Bateria completa verde (`lint`, `typecheck`, `npm test`, `build`, `db:verify`, `db:verify:isolation`, `db:partitions`, `test:e2e`)
