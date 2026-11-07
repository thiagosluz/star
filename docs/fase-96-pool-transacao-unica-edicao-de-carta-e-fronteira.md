# FASE 96 — Pool explícito, transação única por render, edição dedicada de carta (/cartas/[cardId]/editar), busca na concessão, hidratação determinística e fronteira cliente/servidor

> **Status:** Concluída e Verificada  
> **Data:** Novembro de 2026  
> **Escopo:** Persistência (`PrismaPg` + `withTenant`), Server Components (App Router), Hidratação SSR/CSR (React 19), Isolamento `AsyncLocalStorage`, Catraca AST Cliente × Servidor e Revalidação por Área  
> **ADRs adicionadas:** ADR-403 a ADR-408 (numeração global sequencial)

---

## 1. Sumário executivo

A **FASE 96** executa integralmente os **2 itens de prioridade Alta** e os **4 itens de prioridade Média** levantados na avaliação técnica criteriosa da arquitetura e da base de código:

1. **[Alta 1 — ADR-403] Pool explícito no `PrismaPg` e transação única por render:** [`src/lib/db/tenant-client.ts`](file:///c:/Users/thiago/Documents/Projetos/star/src/lib/db/tenant-client.ts) (`resolveRuntimePoolConfig`) e [`src/lib/db/admin-client.ts`](file:///c:/Users/thiago/Documents/Projetos/star/src/lib/db/admin-client.ts) (`resolveAdminPoolConfig`) passaram a dimensionar explicitamente `max`, `idleTimeoutMillis` e `connectionTimeoutMillis` do `pg.Pool` subjacente; `deleteCardTemplate` passou a executar as contagens sequencialmente na mesma conexão `tx`; `listCardTemplates`, `getCardTemplateForEdit` e `listAdminEvents` passaram a aceitar `tx?: TxClient` opcional para compor transações; e o carregamento de `/administracao/cartas` consolidou **4 transações `withTenant` separadas em 1 única transação**.
2. **[Alta 2 — ADR-404] Desacoplamento da edição de cartas (`/administracao/cartas/[cardId]/editar`) e busca de participantes na concessão:** A edição de 26 campos por carta saiu do `<details>` inline de cada item da galeria em [`src/app/t/[tenantSlug]/(app)/administracao/cartas/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/administracao/cartas/page.tsx) e virou a rota Server Component dedicada [`src/app/t/[tenantSlug]/(app)/administracao/cartas/[cardId]/editar/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/administracao/cartas/%5BcardId%5D/editar/page.tsx) (validada na porta com `requireUuidParam(resolvedParams, 'cardId')`, `PageHeader` semântico e 404 uniforme para carta inexistente ou arquivada). Na listagem, `resolveArt(card.art)` passou a ser computado uma única vez por item, a consulta de eventos (`listAdminEvents`) foi removida do cockpit e a seção de concessão manual ganhou filtro GET (`?participante=`) + contagem total (`totalParticipants`) + aviso explícito quando a lista supera 200 pessoas (`data-testid="grant-participants-truncated"`).
3. **[Média 3 — ADR-405] Eliminação das duas divergências de hidratação (`toLocale*` em Client Components):** [`ProposalAcceptancePanel`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/proposals/proposal-acceptance-panel.tsx) passou a formatar `decidedAt` explicitamente com `timeZone: eventTimeZone` (`formatDecisionDateInZone`), evitando que decisões tomadas após as 21h em `America/Bahia` (`UTC-3`) mudem de dia entre o SSR em UTC e a hidratação no navegador. Já [`ActiveSessionsList`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/account/account-forms.tsx) passou a envolver `formatMoment(session.lastUsedAt)` em `<time dateTime={session.lastUsedAt} suppressHydrationWarning>`.
4. **[Média 4 — ADR-406] Catraca AST da fronteira Cliente × Servidor:** Teste unitário por AST TypeScript varrendo todos os arquivos `'use client'` de `src/` e garantindo que nenhum importe valor (não-`type`) de `@/lib/**` fora da allowlist explícita (`@/lib/utils/cn`, `@/lib/offline/credential-offline-queue`) nem módulos de banco, fila ou storage.
5. **[Média 5 — ADR-407] Remoção do fallback `ambientTenantId` / `setAmbientTenant` / `clearAmbientTenant`:** Removida a variável global mutável de módulo em [`src/lib/db/tenant-client.ts`](file:///c:/Users/thiago/Documents/Projetos/star/src/lib/db/tenant-client.ts); `db` e `currentTenantId()` leem exclusivamente `contextStore.getStore()` (`AsyncLocalStorage`), eliminando qualquer possibilidade de condição de corrida entre chamadas concorrentes no mesmo processo Node.js.
6. **[Média 6 — ADR-408] Revalidação centralizada por área (`revalidateTenantArea`):** Criado [`src/lib/cache/revalidate-area.ts`](file:///c:/Users/thiago/Documents/Projetos/star/src/lib/cache/revalidate-area.ts) com `TENANT_CACHE_AREAS` e `revalidateTenantArea(tenantSlug, paths)` (invalidando cada rota + subárvore `'layout'`), aplicado nas mutações de cartas e missões em [`src/app/actions/admin-actions.ts`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/actions/admin-actions.ts) e [`src/app/actions/catalog-archive-actions.ts`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/actions/catalog-archive-actions.ts).

### Tabela de entregas e números da fase

| Entrega | Arquivo | Responsabilidade |
|---|---|---|
| **Pool explícito e fim do `ambientTenantId`** | `src/lib/db/tenant-client.ts`, `src/lib/db/admin-client.ts` | `resolveRuntimePoolConfig` (`DB_POOL_MAX`, `idleTimeoutMillis`, `connectionTimeoutMillis`), `resolveAdminPoolConfig` e remoção de `setAmbientTenant` / `clearAmbientTenant` / `ambientTenantId` |
| **Serviços componíveis em transação única** | `src/lib/admin/gamification-admin-service.ts`, `src/lib/admin/catalog-service.ts` | `tx?: TxClient` em `listCardTemplates`, `getCardTemplateForEdit` e `listAdminEvents`; contagens sequenciais na mesma conexão `tx` em `deleteCardTemplate` |
| **Rota dedicada de edição de carta** | `src/.../administracao/cartas/[cardId]/editar/page.tsx` | Server Component com `requireUuidParam`, `PageHeader`, transação única `withTenant` (carta + eventos), `CardFormFields` e 404 uniforme |
| **Cockpit de cartas em transação única + busca** | `src/.../administracao/cartas/page.tsx` | 1 transação `withTenant`, substituição dos N `<details>` de 26 campos por `<Link data-testid="card-edit-${card.id}">`, `resolveArt` único por card e busca `?participante=` com aviso de truncamento |
| **Hidratação determinística** | `src/components/proposals/proposal-acceptance-panel.tsx`, `src/components/account/account-forms.tsx` | `formatDecisionDateInZone(decidedAt, eventTimeZone)` e `<time dateTime={session.lastUsedAt} suppressHydrationWarning>` |
| **Revalidação centralizada por área** | `src/lib/cache/revalidate-area.ts`, `src/app/actions/admin-actions.ts`, `src/app/actions/catalog-archive-actions.ts` | `TENANT_CACHE_AREAS` e `revalidateTenantArea` invalidando rota e subárvore (`'layout'`) |
| **Testes unitários e catraca AST da F96** | `tests/unit/f96-arquitetura-pool-payload-hidratacao-e-fronteira.test.ts` | 7 testes cobrindo pool explícito, transação única em `/cartas`, rota `/cartas/[cardId]/editar`, fuso de `decidedAt` + `<time suppressHydrationWarning>`, catraca AST `'use client'`, ausência de `ambientTenantId` e `revalidateTenantArea` |
| **Teste E2E da fase** | `tests/e2e/f96-edicao-carta-e-busca-participante.spec.ts` | Cenário Playwright validando navegação para `/cartas/[cardId]/editar`, edição com persistência, filtro `?participante=` na concessão manual e 404 para UUID inexistente |
| **Atualização de catracas e testes existentes** | `tests/unit/f76-catalogo-de-ids.test.ts`, `tests/unit/f78-topo-unico.test.ts`, `tests/unit/f95-separacao-cadastro-de-cartas.test.ts`, `tests/e2e/gamification-catalog.spec.ts` | Inclusão de `administracao/cartas/[cardId]/editar/page.tsx` no catálogo de UUIDs (29 páginas / 30 params) e no topo único (104 páginas / 89 migradas) |
| **Documentação e histórico** | `docs/fase-96-pool-transacao-unica-edicao-de-carta-e-fronteira.md`, `AGENTS.md`, `docs/fases-historico.md`, `README.md` | Registro completo da fase, ADRs 403–408 e preservação do teto de bytes do `AGENTS.md` |

### Números da fase

* **Arquivos modificados/criados:** 17 arquivos
* **Testes Vitest:** 4.774 passando (+7 novos unitários/catracas) em 274 arquivos
* **Testes Playwright E2E:** 516 passando (+1 novo) + 1 skip
* **ADRs:** ADR-403 a ADR-408
* **Dívidas técnicas:** 44 abertas (e o ponto de atenção do truncamento silencioso de 200 participantes da FASE 95 foi resolvido com busca GET `?participante=` + aviso explícito)

---

## 2. O problema mais difícil e por que ele define o desenho

O problema mais delicado da FASE 96 foi **consolidar as leituras de um Server Component complexo em uma única transação RLS sem quebrar os chamadores existentes nem esgotar o pool de conexões sob concorrência**.

No modelo de isolamento do Koveno, cada chamada a `withTenant(tenantId, fn)` abre uma transação interativa e executa `SELECT set_config('app.current_tenant_id', $1, true)` antes das consultas. Quando uma página chamava `withTenant` para ler o fuso horário, depois chamava `listCardTemplates(tenantId)` (que abria seu próprio `withTenant`), depois `listAdminEvents(tenantId)` (3º `withTenant`) e depois `withTenant` para participantes (4º `withTenant`), um único render abria **4 transações seguidas** e fazia **16 idas ao PostgreSQL**. Pior: serviços que disparavam `Promise.all([tx.a.count(), tx.b.count()])` dentro da mesma transação interativa enfileiravam comandos na **mesma conexão física** retenida pelo `tx`, segurando a conexão do pool por mais tempo sob PgBouncer.

A solução combinou três movimentos coordenados:
1. Configurar explicitamente o pool de `PrismaPg` (`resolveRuntimePoolConfig` e `resolveAdminPoolConfig`) e serializar contagens na mesma conexão `tx`;
2. Tornar os serviços de leitura componíveis via parâmetro opcional `tx?: TxClient` (`if (tx) return run(tx); return withTenant(tenantId, run);`), preservando 100% da ergonomia para quem chama `listCardTemplates(tenantId, scope)` isoladamente e permitindo que páginas consolidadas passem o `tx` já aberto;
3. Desacoplar a edição de cartas para `/administracao/cartas/[cardId]/editar`, eliminando do cockpit tanto a leitura de eventos (`listAdminEvents`) quanto a renderização de $N \times 26$ campos de formulário ocultos em `<details>`.

---

## 3. Decisões técnicas explicadas

* **Por que catraca AST para a fronteira `'use client'` em vez do pacote `server-only`?**
  A suíte Vitest importa diretamente módulos de `src/lib/auth/**`, `src/lib/db/**` e `src/lib/admin/**` em ambiente Node.js fora do bundler do Next.js; o pacote `server-only` lança exceção em tempo de importação quando a condição `react-server` não está ativa, o que obrigaria mockar `server-only` em dezenas de suítes. A catraca AST TypeScript (`tests/unit/f96-arquitetura-pool-payload-hidratacao-e-fronteira.test.ts`) inspeciona estaticamente todos os arquivos `'use client'` em ~320 ms, diferencia `import type` (apagado em compilação) de importação de valor e falha imediatamente com o caminho exato se qualquer Client Component importar `@/lib/**` fora da allowlist.
* **Por que duas estratégias diferentes para corrigir as duas divergências de hidratação?**
  Porque a semântica de negócio é diferente nos dois lugares:
  - Em `ProposalAcceptancePanel`, a data da decisão (`decidedAt`) pertence ao registro oficial do evento — deve aparecer no **fuso do evento** (`eventTimeZone`) tanto no servidor quanto no cliente (`formatDecisionDateInZone`).
  - Em `ActiveSessionsList` (`/conta`), o instante do último acesso da sessão é relativo ao dispositivo do próprio usuário — usar `<time dateTime={session.lastUsedAt} suppressHydrationWarning>` preserva a semântica HTML5 e instrui o React 19 a aceitar a formatação local do navegador sem warning de hidratação.

---

## 4. ADRs

### ADR-403 — Configuração explícita de pool no `PrismaPg` e composição de leitura em transação única (`tx?: TxClient`)

* **Contexto:** `new PrismaPg({ connectionString })` utilizava os defaults implícitos de `pg.Pool` (`max: 10`, sem `connectionTimeoutMillis`), e páginas administrativas abriam até 4 transações `withTenant` distintas por renderização.
* **Decisão:** Definir `resolveRuntimePoolConfig` (`DB_POOL_MAX` default 20, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`) e `resolveAdminPoolConfig` (`DB_ADMIN_POOL_MAX` default 5), serializar contagens internas à mesma conexão `tx` em `deleteCardTemplate`, aceitar `tx?: TxClient` opcional em `listCardTemplates`, `getCardTemplateForEdit` e `listAdminEvents`, e unificar o render de `/administracao/cartas` em 1 única transação `withTenant`.
* **Justificativa:** Reduz o overhead de `BEGIN / set_config / COMMIT` em 75% na listagem de cartas e evita contenção silenciosa no pool de conexões.
* **Consequências:** Serviços de leitura podem ser chamados tanto de forma autônoma quanto dentro de uma transação já aberta pela página.

### ADR-404 — Rota dedicada de edição de carta (`/administracao/cartas/[cardId]/editar`) e busca GET na concessão manual

* **Contexto:** Mesmo após a FASE 95 separar `/cartas/nova`, cada item da galeria em `/administracao/cartas` ainda renderizava no servidor um `<details>` com `AdminActionForm` e `CardFormFields` (26 campos + `<select>` de eventos), e a concessão manual truncava `userTenantProfile` em `take: 200` sem busca nem aviso.
* **Decisão:** Criar `/t/[tenantSlug]/(app)/administracao/cartas/[cardId]/editar` com validação `requireUuidParam(resolvedParams, 'cardId')`, `PageHeader` semântico e 404 uniforme para carta inexistente ou arquivada; trocar o `<details>` inline por `<Link data-testid="card-edit-${card.id}">`; remover `listAdminEvents` da listagem; e adicionar busca GET `?participante=` com aviso `grant-participants-truncated` quando `totalParticipants > 200`.
* **Justificativa:** Elimina o payload RSC/HTML redundante proporcional a $N$ cartas e resolve o truncamento silencioso de participantes apontado no ponto de atenção da FASE 95.
* **Consequências:** `f76-catalogo-de-ids.test.ts` passa a vigiar 29 páginas (30 params) e `f78-topo-unico.test.ts` passa a vigiar 104 páginas (89 com `PageHeader`).

### ADR-405 — Formatação determinística de datas em Client Components (`timeZone` explícito vs. `<time suppressHydrationWarning>`)

* **Contexto:** Dois Client Components chamavam `toLocaleDateString('pt-BR')` / `toLocaleString('pt-BR', ...)` sem `timeZone` explícito durante o render, gerando divergência entre o container Docker (`TZ=UTC`) e navegadores em `America/Sao_Paulo` / `America/Bahia`.
* **Decisão:** Em `ProposalAcceptancePanel`, formatar `decidedAt` com `timeZone: eventTimeZone` (`formatDecisionDateInZone`). Em `ActiveSessionsList`, envolver o texto de `formatMoment(session.lastUsedAt)` em `<time dateTime={session.lastUsedAt} suppressHydrationWarning>`.
* **Justificativa:** Elimina warnings de hidratação do React 19 respeitando a semântica de cada tela (fuso oficial do evento no comitê vs. fuso do navegador na conta).
* **Consequências:** Nenhuma divergência de dia para decisões tomadas entre 21h00 e 23h59 no horário local do evento.

### ADR-406 — Catraca AST da fronteira Cliente × Servidor

* **Contexto:** Arquivos `'use client'` não tinham verificação automatizada que impedisse importar por engano um módulo de valor de `@/lib/**` (que por sua vez puxasse Prisma, Redis, BullMQ ou `node:crypto` para o bundle do navegador).
* **Decisão:** Instituir catraca por AST TypeScript em `tests/unit/f96-arquitetura-pool-payload-hidratacao-e-fronteira.test.ts` verificando todos os arquivos com diretiva `'use client'` em `src/` e permitindo apenas `import type` ou caminhos da allowlist (`@/lib/utils/cn`, `@/lib/offline/credential-offline-queue`).
* **Justificativa:** Garante em tempo de teste unitário que o grafo de módulos do cliente permaneça livre de infraestrutura de servidor.
* **Consequências:** Qualquer novo utilitário puramente cliente sob `@/lib` precisa ser deliberadamente declarado ou colocado em `@/domain` / `@/components`.

### ADR-407 — Remoção definitiva de `setAmbientTenant` / `clearAmbientTenant` / `ambientTenantId`

* **Contexto:** `src/lib/db/tenant-client.ts` mantinha uma variável de módulo `let ambientTenantId: string | null = null` como fallback de `contextStore.getStore()`, marcada `@deprecated`.
* **Decisão:** Remover `ambientTenantId`, `setAmbientTenant` e `clearAmbientTenant`. `db` e `currentTenantId()` consultam exclusivamente o `AsyncLocalStorage` (`contextStore.getStore()`).
* **Justificativa:** Variável mutável em escopo de módulo é compartilhada por todas as requisições concorrentes no mesmo worker Node.js; sua remoção fecha a brecha estruturalmente.
* **Consequências:** Todo acesso a `db` exige estar dentro de `withTenant(tenantId, fn)`, preso por catraca unitária.

### ADR-408 — Revalidação centralizada por área (`revalidateTenantArea`)

* **Contexto:** As Server Actions de administração repetiam blocos manuais de `revalidatePath` que esqueciam rotas filhas recém-extraídas (como `/cartas/[cardId]/editar`).
* **Decisão:** Criar `src/lib/cache/revalidate-area.ts` com `TENANT_CACHE_AREAS` e `revalidateTenantArea(tenantSlug, paths)`, invalidando cada caminho e sua subárvore (`'layout'`), e utilizá-lo nas actions de cartas, missões e arquivo do catálogo.
* **Justificativa:** Evita listas de `revalidatePath` dessincronizadas quando novas sub-rotas (`nova`, `[id]/editar`) são adicionadas a uma área.
* **Consequências:** Toda mutação de cartas ou missões invalida consistentemente o cockpit e suas rotas filhas usando o `tenantSlug` já higienizado.

---

## 5. Lições aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| `Invalid hook call: Cannot read properties of null (reading 'useActionState')` ao testar `ProposalAcceptancePanel` com `renderToStaticMarkup(ProposalAcceptancePanel({...}))`. | Chamar um componente React que usa hooks (`useActionState`, `useState`) diretamente como função JavaScript executa os hooks fora do dispatcher ativo do `renderToStaticMarkup`. | Passar `createElement(ProposalAcceptancePanel, {...})` para `renderToStaticMarkup`, permitindo que o React instancie o dispatcher de SSR antes de invocar o componente. |
| `error TS2352` ao fazer cast manual de `tx.userTenantProfile` para verificar `count` opcional em mocks. | O tipo `UserTenantProfileDelegate` do Prisma 7 já declara `.count` com assinatura genérica estrita (`Subset<T, UserTenantProfileCountArgs>`), incompatível com um tipo de função simplificado em `as`. | Usar `typeof tx.userTenantProfile.count === 'function'` diretamente sobre o delegate tipado, sem cast intermediário. |

---

## 6. Evidência de verificação

```bash
npm run lint                  # 0 erros, 0 warnings
npm run typecheck             # 0 erros
npm test                      # 4774 testes passando (274 arquivos)
npm run build                 # Compilado com sucesso (rota /administracao/cartas/[cardId]/editar registrada)
npm run db:verify             # Contrato de isolamento íntegro
npm run db:verify:isolation   # 9/9 verificações passaram
npm run db:partitions         # Partições íntegras
npm run test:e2e              # 516 passando + 1 skip (0 falhas)
```

---

## 7. Comandos operacionais

```bash
# Testes unitários da FASE 96 e catracas correlatas
npx vitest run tests/unit/f96-arquitetura-pool-payload-hidratacao-e-fronteira.test.ts tests/unit/f95-separacao-cadastro-de-cartas.test.ts tests/unit/f76-catalogo-de-ids.test.ts tests/unit/f78-topo-unico.test.ts tests/unit/f79-fases-no-arquivo-certo.test.ts

# Teste E2E da edição dedicada de carta e busca de participante
npx playwright test tests/e2e/f96-edicao-carta-e-busca-participante.spec.ts tests/e2e/gamification-catalog.spec.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

* Nenhuma dívida técnica nova declarada nesta fase (total mantido em **44 abertas**).
* O ponto de atenção registrado na FASE 95 sobre o truncamento silencioso de 200 participantes na concessão manual de cartas foi resolvido nesta fase com busca GET (`?participante=`), contagem total (`totalParticipants`) e aviso explícito (`grant-participants-truncated`).

---

## 9. Checklist de aceite

- [x] **[Alta 1 — ADR-403]** `resolveRuntimePoolConfig` e `resolveAdminPoolConfig` configurados no `PrismaPg`; contagens sequenciais em `deleteCardTemplate`; `listCardTemplates`, `getCardTemplateForEdit` e `listAdminEvents` componíveis com `tx?: TxClient`; `/administracao/cartas` consolidada em 1 única transação `withTenant`.
- [x] **[Alta 2 — ADR-404]** Rota dedicada `/t/[tenantSlug]/(app)/administracao/cartas/[cardId]/editar` criada com `requireUuidParam`, `PageHeader`, `CardFormFields` e 404 uniforme; `<details>` de 26 campos removido da galeria; busca `?participante=` e aviso de truncamento adicionados na concessão manual.
- [x] **[Média 3 — ADR-405]** `ProposalAcceptancePanel` formata `decidedAt` no `eventTimeZone` e `ActiveSessionsList` envolve `formatMoment` em `<time dateTime={...} suppressHydrationWarning>`.
- [x] **[Média 4 — ADR-406]** Catraca AST TypeScript garantindo que nenhum arquivo `'use client'` importe valor de `@/lib/**` fora da allowlist nem módulos de servidor.
- [x] **[Média 5 — ADR-407]** `ambientTenantId`, `setAmbientTenant` e `clearAmbientTenant` removidos de `src/lib/db/tenant-client.ts`.
- [x] **[Média 6 — ADR-408]** `revalidateTenantArea` e `TENANT_CACHE_AREAS` criados em `src/lib/cache/revalidate-area.ts` e aplicados nas Server Actions de cartas, missões e arquivo do catálogo.
- [x] Catracas `f76`, `f78` e `f79` atualizadas e verdes; `AGENTS.md` estritamente abaixo de 64.800 bytes.
- [x] Testes unitários (7 novos) e E2E (1 novo) criados e passando.

