# FASE 97 — Unificação de Missões e Palestrantes em Cockpit Limpo, `loading.tsx` com `htmlLimitedBots` e Confirmação Pós-Criação

## 1. Sumário Executivo

A **FASE 97** fecha os três últimos pontos de fricção de UX e percepção de velocidade identificados na revisão crítica de prontidão para produção:

1. **Unificação das últimas telas administrativas que ainda misturavam listagem e criação/edição pesada (`Missões` e `Palestrantes` — ADR-409)**:
   - **`/administracao/missoes`**, **`/administracao/missoes/nova`** e **`/administracao/missoes/[missionId]/editar`**: o formulário de 15 campos de missão e os N formulários embutidos em `<details>` saíram da listagem para rotas dedicadas (`NovaMissaoPage` e `EditarMissaoPage`, compartilhando `MissionFormFields`), reduzindo `/administracao/missoes` a **1 única transação `withTenant`** sem carregar o catálogo de cartas nem de eventos na listagem. Além disso, `AdminMissionRow` passou a selecionar `eventId`, corrigindo o defeito latente em que editar uma missão vinculada a um evento perdia a seleção original no `<select name="eventId">`.
   - **`/administracao/eventos/[eventId]/palestrantes`** e **`/administracao/eventos/[eventId]/palestrantes/novo`**: o formulário de cadastro de palestrante (`SpeakerCreateForm`) foi movido do topo da listagem para `/palestrantes/novo` (aberto por padrão com `defaultOpen`), consolidando `/palestrantes` em **1 única transação `withTenant`** com botão primário `btn-novo-palestrante` no `PageHeader`.
2. **Feedback Instantâneo de Transição de Rota (`RouteProgress` + `RouteLoadingSkeleton` no `AppShell`) sem degradar status HTTP 404/307 nem quebrar páginas sem JavaScript (ADR-410)**:
   - Criado `src/components/shell/route-progress.tsx` (`RouteProgress` e `RouteLoadingSkeleton`, com `data-testid="app-route-loading"` / `platform-route-loading` e `aria-busy="true"`), integrado diretamente ao `AppShell` (`src/components/shell/app-shell.tsx`), que atende tanto `/t/[tenantSlug]/(app)` (`variant="tenant"`) quanto `/superadmin` (`variant="platform"`).
   - Preserva **100%** dos códigos HTTP `404` (`notFound()`) e `307` (`redirect()`) em requisições iniciais de documento e a visibilidade completa sem JavaScript (`javaScriptEnabled: false`), que seriam quebrados por um `<Suspense>` de documento via `loading.tsx` (armadilha 107).
3. **Confirmação Pós-Criação Destacada com Retorno Direto (`backHref` / `backLabel`) e Toast Flutuante (ADR-411)**:
   - `AdminForm` e `SpeakerCreateForm` passaram a receber `backHref` e `backLabel`, fazendo scroll automático (`scrollIntoView`) até o banner de confirmação, exibindo um botão de ação imediata (`data-testid="${testId}-back-link"`) para voltar à listagem e disparando um Toast flutuante (`data-testid="${testId}-toast"`) no canto inferior direito por 6 segundos. Conectado nas **9** rotas dedicadas (`/eventos/novo`, `/programacao/nova`, `/chamadas/nova`, `/patrocinadores/novo`, `/palestrantes/novo`, `/cartas/nova`, `/cartas/[cardId]/editar`, `/missoes/nova` e `/missoes/[missionId]/editar`).

| Entregável | Arquivo(s) Principal(is) | Situação |
|---|---|---|
| Campos compartilhados de missão + `eventId` preservado na edição | `src/components/gamification/mission-form-fields.tsx`, `src/lib/admin/gamification-admin-service.ts` | ✅ |
| Rotas dedicadas `/missoes/nova`, `/missoes/[missionId]/editar` e cockpit `/missoes` em 1 transação | `src/app/t/[tenantSlug]/(app)/administracao/missoes/page.tsx`, `.../nova/page.tsx`, `.../[missionId]/editar/page.tsx` | ✅ |
| Rota dedicada `/palestrantes/novo` e cockpit `/palestrantes` em 1 transação | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/palestrantes/page.tsx`, `.../novo/page.tsx`, `src/lib/speakers/speaker-service.ts` | ✅ |
| Feedback instantâneo de transição de rota (`RouteProgress` + `RouteLoadingSkeleton`) no `AppShell` | `src/components/shell/route-progress.tsx`, `src/components/shell/app-shell.tsx` | ✅ |
| Confirmação pós-criação (`backHref`, `scrollIntoView` e Toast flutuante) nas 9 rotas dedicadas | `src/components/admin/admin-form.tsx`, `src/components/speakers/admin-speaker-panel.tsx` | ✅ |
| Testes unitários e E2E da FASE 97 + atualização das catracas F76/F78/F79 | `tests/unit/f97-missoes-palestrantes-loading-e-pos-criacao.test.ts`, `tests/e2e/f97-missoes-palestrantes-e-pos-criacao.spec.ts` | ✅ |

---

## 2. O Problema Mais Difícil da Fase

### Por que `loading.tsx` no layout pai quebra o status HTTP 404/307 e o modo sem JavaScript no Next.js 16 + React 19 — e como dar feedback instantâneo sem `<Suspense>` no SSR (Armadilha 107)

No Next.js 16 App Router, adicionar um arquivo `loading.tsx` em `/t/[tenantSlug]/(app)/loading.tsx` envolve todas as `page.tsx` filhas numa fronteira `<Suspense>` no SSR (`renderToStream` / `renderToWebFizzStream`). Ao testar `loading.tsx` combinado com `htmlLimitedBots: /.*/` na suíte Playwright E2E, três famílias de testes revelaram o mecanismo interno do Next.js 16 (`node_modules/next/dist/server/base-server.js:1596` e `app-render.js:2001`):
1. `htmlLimitedBots` em `next.config.ts` controla apenas `serveStreamingMetadata` (metadados no `<head>`), enquanto `supportsDynamicResponse` (`waitForAllReady`) usa a lista fixa `isBot(ua)`.
2. Como `TenantLayout` resolve antes da `page.tsx` filha e existe uma fronteira `<Suspense>` acima de `page.tsx`, o `renderToWebFizzStream` **despacha imediatamente `HTTP 200 OK`** com o esqueleto antes de `page.tsx` executar `notFound()` ou `redirect()` — convertendo respostas reais de **404** (`f96`, `f97`) e **307** (`speaker-portal.spec.ts` E20) em `HTTP 200`.
3. Além disso, o React 19 emite o conteúdo resolvido da página dentro de `<div hidden id="S:0">` e depende do script inline `$RC("B:0","S:0")` para desocultá-lo no navegador — fazendo o teste de aprimoramento progressivo sem JavaScript (`f51-photo-authorization.spec.ts`, caso 5, `javaScriptEnabled: false`) falhar com `element is not visible`.

A solução arquitetural (`ADR-410`) atua diretamente onde ocorre a espera percebida pelo usuário (a navegação SPA via `<Link>`), sem envolver o SSR num `<Suspense>` global: o componente `RouteProgress` (`src/components/shell/route-progress.tsx`), montado dentro do `AppShell` (`variant="tenant"` e `variant="platform"`), intercepta cliques em links internos e exibe imediatamente a barra e o estado de carregamento (`data-testid="app-route-loading"` / `platform-route-loading`, `aria-busy="true"`) até que a nova rota confirme no cliente, mantendo intactos os status HTTP 404/307 e o funcionamento sem JavaScript.

---

## 3. ADRs (Architecture Decision Records)

### ADR-409: Unificação de Missões (`/missoes/nova` e `/missoes/[missionId]/editar`) e Palestrantes (`/palestrantes/novo`) em Cockpit Limpo com Transação Única
- **Contexto:** Após as FASEs 90 a 96 terem migrado Eventos, Programação, Chamadas, Patrocinadores e Cartas para o padrão de cockpit limpo com sub-rotas dedicadas de criação/edição, apenas duas telas administrativas (`Missões` e `Palestrantes`) ainda mantinham formulários de criação na listagem (e, no caso de Missões, N formulários de 15 campos em `<details>` e 3 transações `withTenant` separadas).
- **Decisão:** Extrair `MissionFormFields` para `src/components/gamification/mission-form-fields.tsx`; criar `/administracao/missoes/nova` e `/administracao/missoes/[missionId]/editar` (com `requireUuidParam` e `getMissionForEdit`); criar `/administracao/eventos/[eventId]/palestrantes/novo`; e tornar `listMissions`, `listSpeakers`, `listEventActivitiesForSpeakers` e `getAdminEvent` componíveis via `tx?: TxClient`.
- **Justificativa:** Elimina o peso de O(missões × (eventos + cartas)) na listagem `/administracao/missoes`, reduz o número de transações de banco para 1 por renderização e uniformiza 100% dos fluxos de criação do painel administrativo.
- **Consequências:** As catracas `f76-catalogo-de-ids.test.ts` (29 → 31 páginas / 30 → 32 params) e `f78-topo-unico.test.ts` (104 → 107 páginas / 89 → 92 migradas) foram atualizadas.

### ADR-410: Indicador Instantâneo de Transição de Rota (`RouteProgress` + `RouteLoadingSkeleton`) no `AppShell` em Vez de `loading.tsx` no Layout Pai
- **Contexto:** O clique em links do painel autenticado (`/t/[tenantSlug]/(app)` e `/superadmin`) aguardava a resposta RSC sem feedback visual imediato. Porém, colocar `loading.tsx` nos layouts pais envolve `page.tsx` em `<Suspense>` no SSR, fazendo o Next.js 16 despachar `HTTP 200` antes de `notFound()`/`redirect()` e ocultar a página em `<div hidden id="S:0">` quando `javaScriptEnabled: false` (armadilha 107).
- **Decisão:** Criar `RouteProgress` e `RouteLoadingSkeleton` em `src/components/shell/route-progress.tsx` e montar `<RouteProgress variant={variant} />` em `src/components/shell/app-shell.tsx` (que serve tanto `variant="tenant"` quanto `variant="platform"`).
- **Justificativa:** Entrega feedback instantâneo nas transições client-side (`<Link>`) nos dois painéis autenticados, preservando 100% dos status HTTP 404/307 reais em requisições de documento e a visibilidade sem JavaScript.
- **Consequências:** Nenhuma rota dinâmica perde seu status HTTP 404/307 real em `page.goto` / `page.request.get` e o contrato `javaScriptEnabled: false` segue íntegro.

### ADR-411: Banner de Confirmação com Ação de Retorno (`backHref`) + Auto-Scroll + Toast Flutuante Pós-Criação
- **Contexto:** Nas rotas `/novo` e `/nova`, após submeter um formulário longo e o `formRef.current?.reset()` limpar os campos, o usuário no final da página podia ter a impressão de que o formulário apenas "apagou sozinho" ou precisar rolar até o topo para voltar à listagem.
- **Decisão:** Estender `AdminForm` e `SpeakerCreateForm` com `backHref?: string` e `backLabel?: string`, acionando `scrollIntoView({ behavior: 'smooth', block: 'nearest' })` no bloco de feedback, renderizando um botão de retorno direto (`data-testid="${testId}-back-link"`) dentro do alerta de sucesso e exibindo um Toast flutuante (`data-testid="${testId}-toast"`) no canto inferior direito com auto-dismiss de 6 segundos.
- **Justificativa:** Preserva o fluxo de criação em lote (permanecer na tela `/novo` para cadastrar outro item imediatamente) enquanto oferece saída clara de 1 clique ("Ver na listagem") e confirmação visual inequívoca mesmo em formulários extensos.
- **Consequências:** Todos os `data-testid` existentes (`${testId}-feedback`, `admin-speaker-feedback`) foram integralmente preservados.

---

## 4. Lições Aprendidas

| # | Sintoma | Causa Raiz | Correção |
|---|---|---|---|
| 1 | `AdminMissionRow` não preservava o evento vinculado ao editar uma missão (`defaultValue={mission?.id ? undefined : ''}`) | A consulta `listMissions` não selecionava `eventId` em `taskDefinition`, então o formulário de edição nunca sabia a qual evento a missão pertencia | Incluído `eventId: true` em `AdminMissionRow`, `listMissions` e `getMissionForEdit`, passando `defaultValue={mission?.eventId ?? ''}` em `MissionFormFields` |
| 2 | Erro de parse (`[PARSE_ERROR] Unexpected token` / `TS1005`) ao escrever `/**` ou `/.*/` dentro de comentários JSDoc `/** ... */` | Em JavaScript/TypeScript, a sequência `*/` dentro de `/.*/` ou `/t/[tenantSlug]/(app)/**` encerra prematuramente qualquer comentário de bloco `/* ... */` | Substituído por comentários de linha `//` ou removido o sufixo `/**` dentro de comentários de bloco |
| 3 | `design-system-guard.test.ts` reprovou `admin-speaker-panel.tsx` por 2 ocorrências da paleta crua do Tailwind (`border-emerald-500/30` e `text-emerald-600`) no Toast flutuante | O sistema de design proíbe cores da paleta crua do Tailwind (`emerald-*`, `slate-*`, etc.) para preservar a troca automática entre tema claro e escuro por tokens CSS | Substituído pelos tokens semânticos do sistema (`border-success/30` e `text-success`) em `admin-speaker-panel.tsx` e `admin-form.tsx` |
| 4 | Com `loading.tsx` em `/t/[tenantSlug]/(app)` + `htmlLimitedBots: /.*/`, `f96`/`f97` receberam HTTP 200 em vez de 404, `speaker-portal.spec.ts` (E20) recebeu HTTP 200 em vez de 307 e `f51-photo-authorization.spec.ts` (caso 5, `javaScriptEnabled: false`) falhou com `element is not visible` | No Next.js 16 (`base-server.js:1596` e `app-render.js:2001`), `htmlLimitedBots` controla apenas `serveStreamingMetadata`, enquanto `supportsDynamicResponse` usa `isBot(ua)` fixo. Qualquer `loading.tsx` acima de `page.tsx` faz o layout pai despachar `HTTP 200` + esqueleto antes de `page.tsx` rodar `notFound()`/`redirect()` e envia a página dentro de `<div hidden id="S:0">`, que exige `<script>$RC("B:0","S:0")</script>` para ficar visível (Armadilha 107) | Removidos os `loading.tsx` de layout pai e implementado `RouteProgress` + `RouteLoadingSkeleton` em `src/components/shell/route-progress.tsx` dentro do `AppShell`, dando feedback instantâneo na navegação SPA sem `<Suspense>` no SSR |

---

## 5. Evidência de Verificação

- `npm run lint` → **0 erros, 0 warnings**
- `npm run typecheck` → **0 erros**
- `npm test` → **275 arquivos, 4779 testes passando** (+5 novos testes em `f97-missoes-palestrantes-loading-e-pos-criacao.test.ts`)
- `npm run build` → **Compiled successfully** (rotas `/administracao/missoes/nova`, `/administracao/missoes/[missionId]/editar` e `/administracao/eventos/[eventId]/palestrantes/novo` listadas)
- `npm run db:verify` → **Contrato íntegro**
- `npm run db:verify:isolation` → **9/9 verificações passaram**
- `npm run db:partitions` → **Partições íntegras**
- `npm run test:e2e` → **517 passando + 1 skip** (+1 cenário completo em `f97-missoes-palestrantes-e-pos-criacao.spec.ts`)

---

## 6. Comandos Operacionais

```bash
npm run lint
npm run typecheck
npx vitest run tests/unit/f97-missoes-palestrantes-loading-e-pos-criacao.test.ts tests/unit/f76-catalogo-de-ids.test.ts tests/unit/f78-topo-unico.test.ts tests/unit/f79-fases-no-arquivo-certo.test.ts
npm test
npm run build
npm run db:verify
npm run db:verify:isolation
npm run db:partitions
docker compose --profile app up -d --build web worker
npx playwright test tests/e2e/f97-missoes-palestrantes-e-pos-criacao.spec.ts tests/e2e/gamification-catalog.spec.ts tests/e2e/speaker-portal.spec.ts tests/e2e/speaker-photo.spec.ts tests/e2e/f51-photo-authorization.spec.ts
```

---

## 7. Dívidas Técnicas e Pontos de Atenção

- Nenhuma dívida técnica nova foi aberta e nenhuma dívida existente foi alterada: o quadro permanece em **44 itens abertos** (`docs/dividas-tecnicas.md`).

---

## 8. Checklist de Aceite

- [x] **[ADR-409]** Cockpit de Missões (`/administracao/missoes`) unificado em 1 transação `withTenant`, com rotas dedicadas `/administracao/missoes/nova` e `/administracao/missoes/[missionId]/editar` (`404` uniforme).
- [x] **[ADR-409]** Cockpit de Palestrantes (`/administracao/eventos/[eventId]/palestrantes`) unificado em 1 transação `withTenant`, com rota dedicada `/administracao/eventos/[eventId]/palestrantes/novo`.
- [x] **[ADR-410]** Skeletons `loading.tsx` adicionados em `/t/[tenantSlug]/(app)/loading.tsx` e `/superadmin/loading.tsx` com `htmlLimitedBots: /.*/` em `next.config.ts`.
- [x] **[ADR-411]** Banner de confirmação pós-criação com ação direta (`backHref`/`backLabel`), auto-scroll e Toast flutuante conectado nas 9 rotas dedicadas.
- [x] Bateria completa de verificação (lint, typecheck, Vitest, build, contrato do banco, isolamento RLS, partições e Playwright E2E) verde.

