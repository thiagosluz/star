# FASE 88 — Leitura única no render (`I10`), `signOut` único na suíte (`I9`) e varredura dos `catch` silenciosos (`B10`)

> **Tema:** um diagnóstico arquitetural externo foi confrontado linha por linha com o código real
> da Koveno. O que já estava resolvido (**E92**, fechada na FASE 86) e o que era decisão de
> produto (**E91**, o papel `FINANCE` sem tela de financeiro) ficaram separados do que era
> **dívida técnica real, medida e reprodutível**: a leitura duplicada de `sponsor_users` entre
> casca e página no mesmo render RSC (**I10**), os cinco blocos `catch` que engoliam falha de
> infraestrutura/banco sem registro nas contagens e leituras tolerantes (**B10**), e o
> `POST /api/auth/sign-out` sem corpo JSON que respondia `415 Unsupported Media Type` em
> **100 chamadas de 80 arquivos E2E**, transformando o logout da suíte num no-op silencioso
> (**I9**).
>
> **Três fatias técnicas, zero migração.** A **fatia 1** unificou a leitura de `sponsor_users`
> no render RSC com `readSponsorAccess` (`React.cache` com dois argumentos primitivos
> `(tenantId, userId)`), preservando `listSponsorAccess` pura para chamadas imperativas. A
> **fatia 2** varreu todos os blocos `catch` em `src/lib/**` e fechou os **5** que devolviam
> valor degradado (`null`/`false`) sem log. A **fatia 3** criou o helper único `signOut(page,
> origin)` em `tests/e2e/helpers.ts` (enviando `data: {}` + `headers: { origin }` e afirmando
> `response.ok()`) e migrou as **101 chamadas** em **81 arquivos `.spec.ts`**.
>
> **Base:** a FASE 59 colocou o item "Patrocínio" do menu sob o vínculo `sponsor_users`; a
> FASE 70 abriu a `B10` ao encontrar o primeiro `catch` silencioso em `getEventAreaCounts`; a
> FASE 75 fixou a prova de consultas por render (`f75-contexto-uma-vez.test.ts`); a FASE 82
> mediu o `415` do `sign-out` sem corpo e abriu a `I9`; a FASE 84 mediu a segunda consulta a
> `sponsor_users` no painel e abriu a `I10`.
>
> **ADRs 391, 392 e 393.** A próxima é a **394**.

---

## 1. Sumário executivo

| Entrega | Onde | Prova |
|---|---|---|
| **`readSponsorAccess` (`I10`)** — leitor de `sponsor_users` memoizado por requisição RSC via `React.cache((tenantId: string, userId: string) => listSponsorAccess(tenantId, userId))`, mantendo `listSponsorAccess` pura | `src/lib/sponsors/sponsor-portal-service.ts`, `src/app/t/[tenantSlug]/(app)/layout.tsx`, `src/app/t/[tenantSlug]/(app)/dashboard/page.tsx`, `src/app/t/[tenantSlug]/(app)/patrocinador/page.tsx` | `tests/integration/f75-contexto-uma-vez.test.ts` — `TenantLayout + DashboardPage` e `TenantLayout + SponsorAreaPage` executam `sponsorUser.findMany` **1 vez** (`contagem.sponsorAccess === 1`); catraca de fonte em `tests/unit/f88-suite-cache-e-catches.test.ts` |
| **Varredura e fechamento dos `catch` silenciosos (`B10`)** — log estruturado obrigatório nos **5** blocos `catch` que devolviam `null`/`false` em falha de banco ou Redis sem registrar o erro | `src/lib/certificates/queue.ts` (`certificateQueueStats`, `certificateDurationSample`), `src/lib/communication/email-queue.ts` (`emailQueueStats`), `src/lib/auth/entry-destination.ts` (`resolveEntryDestinationForUser`), `src/lib/auth/auth.ts` (`isEmailChange`) | `tests/unit/f88-suite-cache-e-catches.test.ts` — teste unitário exercitando a falha de `loadPlatformPrincipal` + catraca de fonte nos quatro arquivos |
| **Helper único `signOut` na suíte E2E (`I9`)** — `signOut(page, origin)` envia `POST /api/auth/sign-out` com `headers: { origin }` e `data: {}` e afirma `expect(response.ok()).toBe(true)`; **101 chamadas** em **81 arquivos `.spec.ts`** migradas | `tests/e2e/helpers.ts` + 81 arquivos em `tests/e2e/*.spec.ts` | `tests/unit/f88-suite-cache-e-catches.test.ts` — 0 ocorrências de `/api/auth/sign-out` direto nos 102 arquivos `.spec.ts`; os 81 specs que chamam `signOut` o importam de `./helpers` |
| **Dívidas quitadas: `I10`, `B10` e `I9`** — zero dívidas novas declaradas; contagem cai de **49 para 46** (`A=4, B=5, C=1, D=3, E=27, F=5, H=0, I=1`) | `docs/dividas-tecnicas.md`, `AGENTS.md`, `README.md` | conferência linha a linha na §3 e §4 de `docs/dividas-tecnicas.md` |

**Números da fase**

```text
Arquivos tocados ................. 96 (2 novos: tests/unit/f88-suite-cache-e-catches.test.ts e este documento)
  • código de produção ........... 8 (sponsor-portal-service, layout, dashboard, patrocinador,
                                      certificates/queue, communication/email-queue,
                                      auth/entry-destination, auth/auth)
  • suíte E2E .................... 82 (tests/e2e/helpers.ts + 81 arquivos .spec.ts; 101 chamadas migradas)
  • testes Vitest ................ 2 (1 novo unitário + 1 integração estendido)
  • documentação e catracas ...... 4 (dividas-tecnicas, AGENTS, README, este documento)
Testes novos (Vitest) ............ 17 (15 em tests/unit/f88-suite-cache-e-catches.test.ts +
                                       2 em tests/integration/f75-contexto-uma-vez.test.ts)
Vitest ........................... 4707 testes passando em 265 arquivos — 0 vermelhos
E2E .............................. 507 casos (506 passando + 1 skip)
Migrações ........................ 0
ADRs ............................. 3 (ADR-391, ADR-392 e ADR-393) — a próxima é a 394
Dívidas .......................... 3 quitadas (I10, B10, I9) e 0 declaradas: 49 → 46
```

---

## 2. O problema mais difícil: **como `React.cache` realmente indexa argumentos em `react-server` (e por que o teste em Vitest precisa simular o despachante)**

Unificar a leitura de `sponsor_users` entre `TenantLayout` e `DashboardPage`/`SponsorAreaPage`
parecia uma linha de código (`cache(listSponsorAccess)`), mas esconde três armadilhas de
execução real no React 19:

1. **Dois mundos de `react` no mesmo repositório.** O Next.js executa Server Components com a
   condição de exportação `--conditions react-server` (`react/cjs/react.react-server.development.js`),
   onde `React.cache(fn)` consulta `ReactSharedInternals.A` (o `AsyncLocalStorage` da requisição
   HTTP corrente). Já o Node padrão — usado pelo **worker BullMQ** e pelo **Vitest**
   (`react/cjs/react.development.js`) — exporta um `cache(fn)` que é **pass-through puro**:
   `function(fn) { return function() { return fn.apply(null, arguments); }; }`.
   - **Consequência boa:** importar `cache` de `'react'` em `sponsor-portal-service.ts` **nunca**
     cria estado global compartilhado entre jobs do worker ou entre processos Node. Fora de uma
     requisição RSC, `readSponsorAccess` simplesmente executa `listSponsorAccess`.
   - **Consequência perigosa para o teste:** um teste de integração em Vitest que chame
     `TenantLayout` + `DashboardPage` sem instalar um despachante equivalente ao `react-server`
     mediria o pass-through do Node — e reprovaria (ou aprovaria um mock errado).
2. **`Map` para primitivos × `WeakMap` para objetos no despachante `react-server`.** No código
   real do `react-server`, a árvore de cache de cada função tem dois ramos em cada nó:
   `node.p` (`Map`, para argumentos primitivos ou `null`/`undefined`) e `node.o` (`WeakMap`,
   para `typeof arg === 'object' || typeof arg === 'function'`).
   - Se a assinatura fosse `readSponsorAccess({ tenantId, userId })`, o layout e a página
     passariam **duas referências distintas de objeto literal** `{ tenantId, userId }`. Ambas
     cairiam no `WeakMap` (`node.o`) e a segunda chamada **erraria o cache 100% das vezes**.
   - Com dois argumentos primitivos `(tenantId: string, userId: string)`, ambas percorrem
     `node.p.get(tenantId).p.get(userId)` (`Map` por igualdade de valor `SameValueZero`) e a
     segunda chamada recebe a mesma `Promise` em voo ou resolvida.
3. **Pureza da função de serviço.** Quem chama `listSponsorAccess` fora de RSC (ou em testes de
   integração que criam um vínculo de patrocinador entre duas chamadas na mesma função de teste)
   precisa ler o estado novo do banco. Por isso `listSponsorAccess` continua **pura** (sem
   `cache`), e `readSponsorAccess` é o leitor de render consumido por `TenantLayout`,
   `DashboardPage` e `SponsorAreaPage`.

---

## 3. Decisões técnicas

### 3.1 `I10` — `readSponsorAccess` com primitivos para o render RSC e `listSponsorAccess` pura para serviços

```ts
// src/lib/sponsors/sponsor-portal-service.ts
export const readSponsorAccess = cache(
  (tenantId: string, userId: string): Promise<SponsorPortalAccess[]> =>
    listSponsorAccess(tenantId, userId),
);
```

Três lugares no ciclo de render RSC liam `sponsor_users` para a mesma pessoa na mesma
instituição:

- `TenantLayout` (`src/app/t/[tenantSlug]/(app)/layout.tsx`) — sempre lê para decidir se o item
  **"Patrocínio"** aparece na barra lateral (FASE 59);
- `DashboardPage` (`src/app/t/[tenantSlug]/(app)/dashboard/page.tsx`) — lê para decidir se o
  bloco `patrocinador` entra nos atalhos do perfil (FASE 84);
- `SponsorAreaPage` (`src/app/t/[tenantSlug]/(app)/patrocinador/page.tsx`) — lê para montar a
  própria área do patrocinador (FASE 42).

Com `readSponsorAccess(tenantId, userId)` nos três pontos:

- abrir `/t/<slug>/dashboard` executa `sponsorUser.findMany` **1 vez** (antes: 2);
- abrir `/t/<slug>/patrocinador` executa `sponsorUser.findMany` **1 vez** (antes: 2).

**Alternativas descartadas:**

1. **Passar `sponsorAccess` de `TenantLayout` para `Page` via props** — no App Router do Next.js,
   `layout.tsx` recebe `children: ReactNode` já construído pelo roteador e **não** injeta props
   nas páginas filhas.
2. **Envelopar a própria `listSponsorAccess` em `cache()`** — misturaria o contrato de serviço
   imperativo com memoização de render; qualquer caller que altere vínculos e releia na mesma
   requisição receberia o snapshot antigo.
3. **Cache em memória de módulo (`Map` global com TTL)** — violaria o isolamento entre
   requisições concorrentes no mesmo processo Node e criaria janela de dado obsoleto após
   revogação de acesso.

### 3.2 `B10` — Varredura completa dos `catch` em `src/lib/**` e log obrigatório nas degradações silenciosas

A varredura inspecionou todos os blocos `catch` de `src/lib/**` e os classificou em três grupos:

1. **Já possuíam log estruturado (`logger.*` ou `console.error`/`warn`):**
   - `src/lib/events/event-area-counts.ts` (`console.error` adicionado na FASE 70)
   - `src/lib/auth/rate-limit-storage.ts` (`logger.warn` no fallback de Redis)
   - `src/lib/observability/metrics.ts` (`logger.warn` no scrape das filas)
   - `src/lib/audit/audit-service.ts`, `src/lib/notifications/*.ts`, `src/lib/storage/*.ts`
2. **Normalização pura de entrada/formato (não é falha de infraestrutura e não deve poluir log):**
   - `JSON.parse` / `new URL` / decodificação de token malformado ou cursor inválido (onde o
     input externo inválido é caminho normal de validação).
3. **Leituras de banco ou fila que engoliam erro operacional em silêncio devolvendo `null` ou
   `false` (os 5 alvos corrigidos nesta fase):**

| Arquivo | Função | Retorno degradado | Log adicionado |
|---|---|---|---|
| `src/lib/certificates/queue.ts` | `certificateQueueStats()` | `null` (painel oculta contadores da fila) | `logger.warn('certificate_queue_stats_failed', { error })` |
| `src/lib/certificates/queue.ts` | `certificateDurationSample()` | `null` (painel oculta estimativa de duração) | `logger.warn('certificate_duration_sample_failed', { error })` |
| `src/lib/communication/email-queue.ts` | `emailQueueStats()` | `null` (caixa de saída oculta contadores da fila) | `logger.warn('email_queue_stats_failed', { error })` |
| `src/lib/auth/entry-destination.ts` | `resolveEntryDestinationForUser()` | continua sem principal (`platformPrincipal = null`) | `console.error('[entrada] falha ao consultar o principal de plataforma: ...')` |
| `src/lib/auth/auth.ts` | `isEmailChange()` | `false` (assume primeiro cadastro/confirmação) | `console.error('[auth] falha ao conferir troca de e-mail: ...')` |

Nenhum dos cinco passou a lançar exceção — a resiliência da tela (degradação graciosa) é
preservada —, mas nenhuma falha de Redis ou PostgreSQL passa mais sem rastro no log.

### 3.3 `I9` — Por que `POST /api/auth/sign-out` sem corpo respondia `415` e como `signOut(page, origin)` fecha a brecha

A inspeção do roteador do Better Auth (`node_modules/better-auth`) mostrou a causa exata do
`415 Unsupported Media Type`: a rota `/api/auth/sign-out` declara `body: signOutBodySchema`.
Quando o Playwright chama `page.request.post('/api/auth/sign-out', { headers: { origin } })`
**sem `data`**, a requisição vai sem `Content-Type: application/json` e sem corpo; o parser da
biblioteca rejeita a requisição com **HTTP 415** *antes* de entrar no handler, e
`deleteSessionCookie(ctx)` **nunca é executado**.

Quando `data: {}` está presente:

- o Playwright serializa `{}` e envia `Content-Type: application/json`;
- o handler do Better Auth limpa o cookie de sessão e responde **`200 OK` `{ success: true }`**
  — inclusive se chamado sem sessão prévia (idempotente).

O helper único em `tests/e2e/helpers.ts`:

```ts
export async function signOut(page: Page, origin: string = DEFAULT_E2E_ORIGIN): Promise<void> {
  const response = await page.request.post('/api/auth/sign-out', {
    headers: { origin },
    data: {},
  });
  expect(response.ok(), `sign-out falhou com HTTP ${response.status()}`).toBe(true);
}
```

Todas as **101 chamadas** em **81 arquivos `.spec.ts`** (as 100 que iam sem `data: {}` e a de
`f82-porta-de-entrada.spec.ts` que já enviava `data: {}` inline) foram migradas para
`await signOut(page)` (ou `await signOut(page, ORIGIN)`/`ORIGEM` onde o spec usa origem própria).
Das 100 chamadas que antes recebiam 415, **20** ficavam antes de asserções de visitante anônimo
(que até aqui rodavam ainda autenticadas!).

---

## 4. ADRs

### ADR-391 — `readSponsorAccess` usa `React.cache` com argumentos primitivos para deduplicar o render RSC sem poluir `listSponsorAccess`

**Contexto.** Desde a FASE 59 o `TenantLayout` consulta `sponsor_users` (`listSponsorAccess`)
para decidir o item "Patrocínio" do menu lateral, e desde a FASE 84 a `DashboardPage` (além da
`SponsorAreaPage`, FASE 42) faz a mesma consulta no mesmo render HTTP (dívida **I10**). No App
Router do Next.js, o `layout.tsx` não passa props para `page.tsx`.

**Decisão.** Exportar `readSponsorAccess = cache((tenantId: string, userId: string) => listSponsorAccess(tenantId, userId))`
em `src/lib/sponsors/sponsor-portal-service.ts` e consumi-la nos três pontos de render RSC
(`TenantLayout`, `DashboardPage` e `SponsorAreaPage`), mantendo `listSponsorAccess` pura.

**Justificativa.**
1. Os dois parâmetros são `string` primitivos: no despachante `react-server`, primitivos são
   indexados em `Map` por valor (`SameValueZero`), garantindo hit entre layout e página; um
   objeto `{ tenantId, userId }` cairia no `WeakMap` por referência e erraria o cache.
2. O escopo do `React.cache` em `react-server` é o `AsyncLocalStorage` da requisição HTTP:
   termina com o render e nunca vaza entre usuários ou requisições.
3. No Node padrão (worker BullMQ e testes fora de RSC), `React.cache` é pass-through sem estado.

**Consequências.**
- *Positivas:* `TenantLayout + DashboardPage` e `TenantLayout + SponsorAreaPage` caem de 2 para
  **1 consulta** a `sponsor_users` por render; `listSponsorAccess` continua pura para chamadas
  imperativas.
- *Negativas:* testes de integração em Vitest que medem o render composto precisam instalar um
  despachante `Map`/`WeakMap` por render (feito em `tests/integration/f75-contexto-uma-vez.test.ts`).

### ADR-392 — Degradação graciosa em contagens e leituras opcionais exige log estruturado no `catch`

**Contexto.** Serviços de contagem de fila (`certificateQueueStats`, `certificateDurationSample`,
`emailQueueStats`) e leituras auxiliares de autenticação (`resolveEntryDestinationForUser`,
`isEmailChange`) capturam falhas de infraestrutura (Redis/PostgreSQL) e devolvem `null` ou
`false` para não derrubar a página ou o login. Porém, os 5 blocos `catch` não registravam o
erro (dívida **B10**, aberta na FASE 70).

**Decisão.** Manter o retorno degradado (`null`/`false`) e exigir chamada explícita de log
(`logger.warn` nos serviços de fila; `console.error` com prefixo de área e `errorMessage(error)`
nos serviços de autenticação) em cada um dos 5 blocos, prendendo a regra por catraca de fonte.

**Justificativa.** Falha silenciosa sem log torna indisponibilidade de Redis, erro de coluna ou
timeout de banco indistinguível de "fila vazia" ou "usuário comum". O log preserva a
observabilidade operacional sem sacrificar a resiliência da tela.

**Consequências.**
- *Positivas:* zero falhas silenciosas sem log nos serviços de contagem e leitura tolerante;
  degradação graciosa intacta.
- *Negativas:* testes unitários que exercitam propositalmente o ramo de erro emitem uma linha de
  log se não espiarem `console.error`/`logger.warn`.

### ADR-393 — Logout programático na suíte E2E passa exclusivamente pelo helper `signOut(page, origin)`

**Contexto.** O endpoint `POST /api/auth/sign-out` do Better Auth exige `Content-Type:
application/json` (corpo JSON, mesmo vazio `{}`). Na suíte E2E, **100 chamadas em 80 arquivos**
faziam `page.request.post('/api/auth/sign-out', { headers: { origin } })` sem `data: {}`,
recebiam `415 Unsupported Media Type` em silêncio e não limpavam o cookie de sessão (dívida
**I9**, medida na FASE 82).

**Decisão.** Centralizar o logout de teste em `signOut(page, origin = DEFAULT_E2E_ORIGIN)` em
`tests/e2e/helpers.ts`, enviando `data: {}` + `headers: { origin }` e afirmando
`expect(response.ok()).toBe(true)`. Migrar todas as **101 chamadas** em **81 arquivos `.spec.ts`**
e proibir chamadas diretas a `/api/auth/sign-out` nos specs por catraca de fonte.

**Justificativa.** Um helper que afirma `response.ok()` transforma um no-op silencioso de
protocolo HTTP em falha imediata e legível, e garante que os 20 cenários que testam visitante
anônimo após logout meçam de fato um navegador sem sessão.

**Consequências.**
- *Positivas:* 101 chamadas de logout limpam a sessão de verdade e validam o status HTTP;
  catraca impede regressão em specs novos.
- *Negativas:* cada `signOut` agora falha imediatamente se o servidor responder `>= 400` (o que
  é o comportamento desejado).

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Em Vitest, `React.cache(fn)` não deduplicava chamadas mesmo dentro da mesma função de teste | A condição padrão de exportação do pacote `react` no Node (`react.development.js`) define `exports.cache` como pass-through; a memoização por requisição vive exclusivamente em `react.react-server.development.js` | Documentar o comportamento dual e simular na suíte de integração (`f75-contexto-uma-vez.test.ts`) o despachante `Map` (primitivos) / `WeakMap` (objetos) do `react-server` dentro de `renderComoNext` |
| 2 | Passar `{ tenantId, userId }` para uma função envelopada em `React.cache` erraria o cache entre `TenantLayout` e `DashboardPage` | O despachante `react-server` guarda argumentos de tipo `object` em `WeakMap` (identidade de referência) e primitivos em `Map` (`SameValueZero`) | Assinatura de `readSponsorAccess(tenantId: string, userId: string)` com dois primitivos e comentário de bloco explicando a armadilha |
| 3 | **20 cenários E2E** que testavam comportamento de visitante anônimo logo após `POST /api/auth/sign-out` estavam rodando **ainda logados** | Sem `data: {}`, o Playwright não envia `Content-Type: application/json` e o Better Auth devolve `415 Unsupported Media Type` antes de apagar o cookie | Migração das 101 chamadas para `signOut(page)` com `data: {}` e `expect(response.ok()).toBe(true)`, mais reexecução dos specs afetados contra o container |

---

## 6. Evidência de verificação

### 6.1 Bateria estática e testes Vitest (`AGENTS.md` §4)

```text
npm run lint ................. 0 erros, 0 warnings (exit 0)
npm run typecheck ............ 0 erros (exit 0)
npm test ..................... 4707 testes passando em 265 arquivos — 0 vermelhos
npm run build ................ Compiled successfully (exit 0)
npm run db:verify ............ Contrato íntegro.
npm run db:verify:isolation .. 9/9 verificações passaram.
```

### 6.2 Os testes novos da FASE 88

```text
npx vitest run tests/unit/f88-suite-cache-e-catches.test.ts tests/integration/f75-contexto-uma-vez.test.ts
 ✓ tests/integration/f75-contexto-uma-vez.test.ts (7 tests)
 ✓ tests/unit/f88-suite-cache-e-catches.test.ts (15 tests)
 Test Files  2 passed (2)
      Tests  22 passed (22)
```

---

## 7. Comandos operacionais

```bash
# Catraca unitária da FASE 88 (I9 + I10 + B10)
npx vitest run tests/unit/f88-suite-cache-e-catches.test.ts

# Prova de integração de leitura única no render (TenantLayout + DashboardPage / SponsorAreaPage)
npx vitest run tests/integration/f75-contexto-uma-vez.test.ts

# Catraca do estado (fases no arquivo certo)
npx vitest run tests/unit/f79-fases-no-arquivo-certo.test.ts

# Specs E2E que exercitam signOut seguido de asserção de visitante anônimo
npx playwright test tests/e2e/f82-porta-de-entrada.spec.ts tests/e2e/f84-painel-do-perfil.spec.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

- **Três dívidas quitadas (`I10`, `B10` e `I9`) e nenhuma declarada:** o total aberto em
  `docs/dividas-tecnicas.md` cai de **49 para 46** (`A=4, B=5, C=1, D=3, E=27, F=5, H=0, I=1`).
- **`E91` (`tenant:billing:manage` / papel `FINANCE` sem tela de financeiro) permanece aberta
  de propósito:** decidir entre construir um módulo financeiro ou remover o papel/permissão do
  catálogo do RBAC é decisão de produto, não de higiene técnica (opção A escolhida pelo humano).
- **`B6` (adoção do `logger` estruturado nos ~206 `console.*` restantes dos serviços) segue
  separada de `B10`:** a `B10` tratava especificamente de blocos `catch` mudos que ocultavam
  falhas; nos módulos que já importavam `logger` (`certificates/queue.ts`,
  `communication/email-queue.ts`) usamos `logger.warn`, e nos módulos de autenticação que já
  usavam `console.error` com prefixo (`entry-destination.ts`, `auth.ts`) mantivemos o padrão do
  arquivo.

---

## 9. Checklist de aceite

- [x] **`I10` quitada:** `readSponsorAccess` exportada com `React.cache` sobre dois parâmetros
      primitivos `(tenantId: string, userId: string)`; `TenantLayout`, `DashboardPage` e
      `SponsorAreaPage` migrados; `listSponsorAccess` preservada pura.
- [x] **Prova de integração (`I10`):** `tests/integration/f75-contexto-uma-vez.test.ts` prova
      contra PostgreSQL real que `TenantLayout + DashboardPage` e `TenantLayout + SponsorAreaPage`
      executam **1 consulta** a `sponsor_users` por render (`contagem.sponsorAccess === 1`).
- [x] **`B10` quitada:** os 5 blocos `catch` silenciosos (`certificateQueueStats`,
      `certificateDurationSample`, `emailQueueStats`, `resolveEntryDestinationForUser`,
      `isEmailChange`) registram o erro sem perder o retorno degradado (`null`/`false`).
- [x] **`I9` quitada:** helper `signOut(page, origin)` criado em `tests/e2e/helpers.ts` com
      `data: {}` e `expect(response.ok()).toBe(true)`; todas as **101 chamadas** em **81 arquivos
      `.spec.ts`** migradas; zero chamadas diretas a `/api/auth/sign-out` nos specs.
- [x] **Catracas em `tests/unit/f88-suite-cache-e-catches.test.ts`:** 15 casos cobrindo `I9`,
      `I10` e `B10`.
- [x] **Documentação atualizada:** `docs/fase-88-leitura-unica-signout-e-catches.md`,
      `docs/dividas-tecnicas.md` (49 → 46), `AGENTS.md` e `README.md`.
- [x] **Bateria de verificação (§4):** `lint` 0, `typecheck` 0, `npm test` (4707 passando em 265
      arquivos), `build` OK, `db:verify` e `db:verify:isolation` íntegros, e specs E2E verdes.

