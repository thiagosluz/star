# FASE 121 — Modularização SRP das Frentes 2 (Client) e 3 (Server Pages & God Modules)

> **Escopo:** Concluir o ciclo de modularização SRP iniciado na FASE 120 decompondo os 7 arquivos restantes mais extensos entre Client Components (`RaffleHistory`, `SelfCheckinManager`, `BlockContentFields`) e Server Pages / módulos de apresentação (`BlockRenderer`, página da atividade, central de comunicação e quadro de demandas), mantendo 100% do comportamento, `data-testid`s, compatibilidade sem JavaScript e todas as catracas existentes.

---

## 1. Sumário Executivo e Entregas

| Frente / Alvo | Arquivos Criados / Refatorados | Resultado Objetivo | ADR |
|---|---|---|---|
| **`RaffleHistory` (Frente A)** | `src/components/raffles/{raffle-history-types.ts,raffle-rounds-section.tsx,raffle-winner-item.tsx,raffle-row.tsx,raffle-history.tsx}` | Orquestrador cai de `1094 → 182` linhas (`jsxDepth = 4`), isolando rodadas/apuração e entregas/reversões inline mantendo `<GetSearchForm>` e `<AppLink>` na fachada | `ADR-485` |
| **`SelfCheckinManager` & `BlockContentFields` (Frente A)** | `src/components/credentials/{self-checkin-policy-form.tsx,self-checkin-point-row.tsx,self-checkin-manager.tsx}` + `src/components/admin/block-fields/{block-field-shell.tsx,faq-block-fields.tsx,gallery-block-fields.tsx,simple-block-fields.tsx}` + `block-content-fields.tsx` | `SelfCheckinManager` cai de `843 → 154` linhas (`jsxDepth = 5`) e `BlockContentFields` de `513 → 66` linhas (`jsxDepth = 3`) com upload presigned/FAQ isolados por domínio de bloco | `ADR-485` |
| **`BlockRenderer` & Atividade Pública (Frente B)** | `src/components/events/{block-content-renderers.tsx,block-activities-section.tsx,block-sponsors-section.tsx,block-calls-section.tsx,block-community-sections.tsx,block-renderer.tsx}` + `{activity-detail-sections.tsx,activity-registration-sidebar.tsx}` + `atividades/[activitySlug]/page.tsx` | `BlockRenderer` cai de `1439 → 109` linhas (`jsxDepth = 1`) como despachante puro e a página pública da atividade cai de `755 → 211` linhas mantendo todas as classes `.ef-*` declaradas em `f89` | `ADR-486` |
| **Comunicação & Demandas (Frente B)** | `src/components/communication/{outbox-panel.tsx,segment-condition-fields.tsx,campaign-history-panel.tsx,segments-panel.tsx}` + `comunicacao/page.tsx` + `src/components/demands/{demands-summary-section.tsx,demands-create-details.tsx,demands-kanban-board.tsx,demands-timeline-views.tsx,demands-columns-config.tsx}` + `demandas/page.tsx` | `comunicacao/page.tsx` cai de `1364 → 129` linhas (`jsxDepth = 3`) e `demandas/page.tsx` de `907 → 331` linhas (`jsxDepth = 5`), preservando `KEYBOARD_HINT_ID` no servidor e `<GetSearchForm>` no pai | `ADR-487` |
| **Testes + Catracas (Frente C)** | `tests/unit/f121-modularizacao-frentes-client-e-server.test.ts` + atualização das catracas `f73`, `f89`, `f109`, `f114`, `f79` | **7 novos testes Vitest** (4 contratos SSR em JSDOM + 2 catracas AST cobrindo os 7 alvos e os 26 submódulos + preservação das fachadas) | `ADR-488` |

### Números da FASE 121
- **Submódulos criados:** **26 novos arquivos** coesos sob `src/components/{raffles,credentials,admin/block-fields,events,communication,demands}` + `tests/unit/f121-modularizacao-frentes-client-e-server.test.ts` + documento da fase.
- **Redução consolidada nos 7 orquestradores/páginas:** `6915 → 1182` linhas (`-5733` linhas, `-82,9%`).
- **Testes adicionados:** **7 Vitest** em `f121-modularizacao-frentes-client-e-server.test.ts` (`4976 → 4983`, `303 → 304` arquivos).
- **Migrações Prisma / Dívidas:** 0 migrações · 39 dívidas abertas mantidas.

---

## 2. O Problema Mais Difícil da Fase

Dividir páginas extensas de servidor e renderizadores públicos sem quebrar **quatro invariantes transversais** do repositório:
1. **Rastreio nominal de arquivos em catracas AST (`f69`, `f73`, `f89`, `f109`, `f114`, `f118`):** componentes públicos que usam tokens `.ef-*` precisam morar em `src/components/events/*.tsx` e constar em `ARQUIVOS_DENTRO_DE_EF_THEME` na `f89`; nenhum `.tsx` sob `src/components/` pode ficar sem importador (`f118`); e `f109` exige literalmente `<GetSearchForm` e `<AppLink` em alvos nominais (`demandas/page.tsx`, `raffle-history.tsx`, `segments-panel.tsx`).
2. **Fronteira Server vs. Client sem closures em props:** no `demandas/page.tsx`, os links de "Ver mais" por coluna (`Kanban`) e por período (`Gantt`/`Calendário`) antes chamavam uma função local `moreCardsQuery(total)`. Ao fatiar em `DemandsKanbanBoard` e `DemandsTimelineViews`, pré-computamos `moreCardsHrefByColumnId: Record<string, string>` e `timelineMoreCardsHref: string` na página, mantendo 100% de props serializáveis e mantendo `KEYBOARD_HINT_ID` no servidor.
3. **Derivação segura de tipos de repositório sem alterar assinaturas:** `getPublicActivity`, `listActivityMaterials` e `loadActivityNotes` não exportavam nomes auxiliares `PublicActivityDetail` / `ActivityMaterialView` / `ActivityNotesView`. Tipamos os props de `ActivityDetailSections` por `NonNullable<Awaited<ReturnType<typeof ...>>>`, evitando mudanças desnecessárias nos serviços.
4. **Discriminação estrita em `evaluateRegistrationWindow`:** ao repassar `windowMessage` para `ActivityRegistrationSidebar`, `WindowDecision` só possui `.message` quando `window.open === false`; ajustar a prop para `string | null` eliminou erros de `tsc`.

---

## 3. Decisões Técnicas e Alternativas Descartadas

1. **Manter `<GetSearchForm>` e `<AppLink>` na fachada de `RaffleHistory` e no topo de `demandas/page.tsx`:**
   - *Alternativa descartada:* Extrair a barra de filtros de `RaffleHistory` e `demandas/page.tsx` para componentes separados e alterar vários testes literais da `f109`.
   - *Decisão:* Apenas `segments-panel.tsx` e `block-calls-section.tsx` tiveram seus caminhos atualizados em `f109` e `f73`, enquanto `raffle-history.tsx` e `demandas/page.tsx` mantiveram a barra de filtros no orquestrador sem inflar seu tamanho (`182` e `331` linhas).
2. **Manter `ActivityDetailSections` e `ActivityRegistrationSidebar` como Server Components sob `src/components/events/`:**
   - *Decisão:* Preserva zero JavaScript extra no bundle público da página da atividade e mantém o isolamento de tema `.ef-*` coberto por `f69` e `f89`.
3. **Pré-computar URLs `moreCardsHrefByColumnId` no servidor para `DemandsKanbanBoard`:**
   - Evita passar callbacks/closures entre módulos e mantém idêntico o comportamento sem JavaScript do "Ver mais" (`?cartoes=N`) nas três vistas (Kanban, Gantt e Calendário).

---

## 4. Registros de Decisão Arquitetural (ADRs)

- **ADR-485 — Modularização SRP dos Client Components da Frente A (`RaffleHistory`, `SelfCheckinManager`, `BlockContentFields`):** isolamento dos estados inline de rodada/entrega/reversão em sorteios (`raffle-rounds-section.tsx`, `raffle-winner-item.tsx`, `raffle-row.tsx`), separação entre política antifraude e linha de ponto no autocredenciamento (`self-checkin-policy-form.tsx`, `self-checkin-point-row.tsx`), e divisão do formulário de blocos por tipo sob `block-fields/` preservando `f109` e `f114`.
- **ADR-486 — Decomposição do `BlockRenderer` e da página pública da atividade em subcomponentes de servidor:** fragmentação dos 11 tipos de bloco publicados em 5 módulos coesos por domínio visual (`block-content-renderers`, `block-activities-section`, `block-sponsors-section`, `block-calls-section`, `block-community-sections`) e separação da ficha da atividade entre conteúdo (`ActivityDetailSections`) e conversão (`ActivityRegistrationSidebar`) registrados em `f73` e `f89`.
- **ADR-487 — Fatiamento modular das páginas operacionais de Comunicação e Demandas:** extração de `OutboxPanel`, `SegmentConditionFields`, `CampaignHistoryPanel` e `SegmentsPanel` em `/administracao/comunicacao`, e de `DemandsSummarySection`, `DemandsCreateDetails`, `DemandsKanbanBoard`, `DemandsTimelineViews` e `DemandsColumnsConfig` em `/administracao/eventos/[eventId]/demandas` sem alteração de `data-testid`s, permissões ou fluxos No-JS.
- **ADR-488 — Catraca AST e contratos SSR da FASE 121 (`f121-modularizacao-frentes-client-e-server.test.ts`):** trava teto máximo de linhas e `maxJsxDepth` para os 7 alvos originais, limita os 26 submódulos a `<= 520` linhas e garante renderização SSR + preservação de exportações públicas.

---

## 5. Lições Aprendidas (Defeitos Reais Encontrados na Execução)

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `TS2339: Property 'message' does not exist on type 'WindowDecision'` em `atividades/[activitySlug]/page.tsx` | `evaluateRegistrationWindow` retorna união discriminada `{ open: true } \| { open: false; message: string }` | Passar `windowMessage={window.open ? null : window.message}` e tipar prop como `string \| null` em `ActivityRegistrationSidebar` |
| `TS2459`/`TS2724` em `demands-summary-section.tsx` e `demands-timeline-views.tsx` | `DemandSummary` é exportado por `@/domain/events/demand-rules` e `TimelineDemand` por `@/domain/events/demand-timeline-rules` (não pelos serviços em `@/lib/`) | Corrigidos os imports diretamente para os módulos de domínio |
| `TS2305` em `activity-detail-sections.tsx` por tipos não exportados (`PublicActivityDetail`, `ActivityMaterialView`, `ActivityNotesView`) | Os repositórios/serviços inferem os objetos diretamente via retorno das funções | Substituídos por tipos utilitários `NonNullable<Awaited<ReturnType<typeof ...>>>` preservando as assinaturas dos serviços intactas |
| `f66-contraste-do-rotulo.test.ts` acusou `<p className="text-xs opacity-60" data-testid="notes-author">` em `activity-detail-sections.tsx` | O texto original na página da atividade estava fora da varredura `src/components/events/*.tsx` e usava opacidade abaixo da régua WCAG AA (60% ≈ `4,44:1`) | Atualizado para `opacity-70` (medido em `6,16:1`), passando `f66` (`9/9`) e todo o portão E2E `accessibility.spec.ts` |

---

## 6. Evidência de Verificação

Saídas reais observadas após as modificações finais da FASE 121:

- **`npm run lint` (`eslint .`):** encerrado com código `0` (`0` erros, `0` warnings).
- **`npx tsc --noEmit --noUnusedLocals`:** encerrado com código `0` (`0` erros).
- **`npm run db:verify`:** `Contrato íntegro.` (RLS + FORCE, policies, grants mínimos, role runtime sem `SUPERUSER`/`BYPASSRLS`, tabelas de plataforma inalcançáveis).
- **`npm run db:verify:isolation`:** `9/9 verificações passaram. Isolamento entre tenants garantido pelo banco.`
- **`npm run db:partitions`:** partições mensais atuais e futuras de `audit_logs` garantidas (`total: 244811 linha(s)`).
- **`npm run build` (`NODE_ENV=production next build`):** `Compiled successfully in 5.8s`, TypeScript em `8.0s`, `19/19` páginas estáticas e todas as rotas dinâmicas listadas sem erro.
- **`npm test` (suíte Vitest completa — unit + integração):** `Test Files  304 passed (304)` · `Tests  4983 passed (4983)` em `388.26s`.
- **`docker compose --profile app up -d --build web worker`:** imagens `eventflow/web:local` (`0d6f596ecf57`, `367MB`) e `eventflow/worker:local` construídas com sucesso (`grafo de módulos do worker carregado por inteiro`).
- **E2E focado (`demand-board.spec.ts` + suíte completa `npm run test:e2e`):** `demand-board.spec.ts` revalidado com `7 passed (13.8s)`; suíte completa **`565 passed`** + **`1 skipped`** em `12.6m` (`Running 566 tests using 1 worker`).
- **`(Get-Item AGENTS.md).Length`:** `64084` bytes (abaixo do teto de `64.800` bytes).

---

## 7. Comandos Operacionais

```bash
npm run lint
npx tsc --noEmit --noUnusedLocals
npx vitest run tests/unit/f121-modularizacao-frentes-client-e-server.test.ts tests/unit/f119-previa-api-paginacao-midia-modularizacao-e-dividas.test.ts tests/unit/f79-fases-no-arquivo-certo.test.ts
npm test
npm run build
npm run db:verify && npm run db:verify:isolation && npm run db:partitions
docker compose --profile app up -d --build web worker
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- Mantidas todas as **39 dívidas abertas** registradas em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md) (nenhum item novo criado ou encerrado nesta refatoração estrutural).
- Caso surjam novos subcomponentes públicos com `.ef-*` sob `src/components/events/`, lembrar de cadastrá-los em `ARQUIVOS_DENTRO_DE_EF_THEME` na `f89`.

---

## 9. Checklist de Aceite

- [x] Frente A modularizada: `RaffleHistory` (`1094 → 182`), `SelfCheckinManager` (`843 → 154`) e `BlockContentFields` (`513 → 66`).
- [x] Frente B modularizada: `BlockRenderer` (`1439 → 109`), página de atividade (`755 → 211`), página de comunicação (`1364 → 129`) e página de demandas (`907 → 331`).
- [x] Frente C implementada: catracas atualizadas (`f73`, `f89`, `f109`, `f114`) + suíte `f121-modularizacao-frentes-client-e-server.test.ts`.
- [x] Bateria completa de verificação (lint, typecheck, Vitest completo, `next build`, contratos DB, container build e E2E Playwright) aprovada após o último ajuste.
