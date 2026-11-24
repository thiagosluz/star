# FASE 124 — Abas por Intenção, Rotas Dedicadas de Edição e Checklist de Conformidade Financeira

> **Escopo:** Reduzir a carga cognitiva de `/t/[tenantSlug]/administracao/eventos/[eventId]/financeiro` separando os três modos mentais em abas reais por URL (`?aba=resumo|lancamentos|fontes`), movendo os formulários densos para rotas dedicadas (`/fontes/nova`, `/fontes/[sourceId]/editar`, `/lancamentos/novo`, `/lancamentos/[entryId]/editar`) para permitir editar fontes (termos aditivos) e reatribuir lançamentos com glosa, adicionando checklist de prontidão documental com filtros rápidos (`GLOSA`, `MISSING_DOCUMENT`, `UNASSIGNED_SOURCE`), exportação CSV colada ao filtro e paginação (`20` itens/página) no livro-razão.

---

## 1. Sumário Executivo e Entregas

| Frente / Alvo | Arquivos Criados / Modificados | Resultado Objetivo | ADR |
|---|---|---|---|
| **Domínio de Abas, Conformidade e Paginação** | `src/domain/finance/event-finance-rules.ts` | `resolveFinanceTab` (abre `lancamentos` automaticamente quando há filtro ativo), `buildEventFinanceHref`, `FINANCE_COMPLIANCE_FILTERS` (`GLOSA`, `MISSING_DOCUMENT`, `UNASSIGNED_SOURCE`), `complianceCounts` em `computeEventFinanceSummary`, `parseFinancePage` e `paginateFinancialEntries` (`20`/página) | `ADR-497` |
| **Edição de Fontes/Lançamentos e Filtro de Conformidade** | `src/lib/finance/event-finance-service.ts`, `src/app/actions/finance-actions.ts`, `src/app/api/t/[tenantSlug]/financeiro/exportar/route.ts` | `getFundingSourceForEdit`, `updateFundingSource`, `getFinancialEntryForEdit`, `updateFinancialEntry`, `updateFundingSourceAction`, `updateFinancialEntryAction` com auditoria `UPDATE`, filtro `compliance` em `filterFinancialEntries` e suporte a `?conformidade=` na exportação CSV | `ADR-498` |
| **Abas no Cockpit e Rotas Dedicadas `/novo` e `/editar`** | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/financeiro/{page.tsx,fontes/nova/page.tsx,fontes/[sourceId]/editar/page.tsx,lancamentos/novo/page.tsx,lancamentos/[entryId]/editar/page.tsx}`, `src/components/finance/{funding-source-form.tsx,funding-sources-panel.tsx,financial-entry-create-form.tsx,finance-kpi-cards.tsx,finance-charts-panel.tsx,finance-ledger-filters.tsx,financial-entry-row-actions.tsx,financial-entries-ledger.tsx}` | Faixa executiva fixa + 3 abas (`Visão geral e prestação`, `Livro-razão`, `Fontes e editais`) sem JS de formulário nas abas; checklist documental clicável (`Revisar →`); exportação CSV colada ao `<GetSearchForm>`; Lei de Hick na linha (`EntryRowActions` com menu `Mais` nativo); 4 rotas dedicadas validadas por `requireUuidParam` e `<PageHeader>` | `ADR-499` |
| **Catracas e Suítes de Teste** | `tests/unit/f76-catalogo-de-ids.test.ts`, `tests/unit/f78-topo-unico.test.ts`, `tests/unit/f123-*.test.ts`, `tests/unit/f124-abas-edicao-e-conformidade-financeira.test.ts`, `tests/integration/f122-event-finance-service.test.ts`, `tests/e2e/f122-*.spec.ts`, `tests/e2e/f123-*.spec.ts`, `tests/e2e/f124-abas-edicao-e-conformidade-financeira.spec.ts` | Catálogo `f76` (`38` páginas / `41` params) e `f78` (`120` páginas / `105` migradas) atualizados; **4 testes unitários/SSR** + **1 teste de integração** + **1 cenário E2E completo com axe-core WCAG AA** | `ADR-500` |

### Números da FASE 124
- **Novas rotas App Router:** 4 rotas dedicadas (`/financeiro/fontes/nova`, `/financeiro/fontes/[sourceId]/editar`, `/financeiro/lancamentos/novo`, `/financeiro/lancamentos/[entryId]/editar`).
- **Testes adicionados:** **5 Vitest** (`4` unitários + `1` integração em `1` novo arquivo: `4994 → 4999` testes, `307 → 308` arquivos) + **1 cenário Playwright E2E** (`567 → 568` passando + `1` skip).
- **Dívidas técnicas:** 39 dívidas abertas mantidas.

---

## 2. O Problema Mais Difícil da Fase

A página única da FASE 122/123 empilhava três modos mentais incompatíveis (configuração inicial de editais, operação diária de tesouraria e prestação de contas executiva), separava o filtro do livro-razão do botão de exportação CSV por mais de 1.200 px e não possuía edição de fontes ou lançamentos — obrigando o coordenador a excluir e redigitar 12 campos para corrigir uma glosa de rubrica.

---

## 3. Decisões Técnicas e Alternativas Descartadas

1. **Abas reais por query (`?aba=resumo|lancamentos|fontes`) + resolução inteligente quando há filtro ativo (`resolveFinanceTab`):**
   - *Alternativa descartada:* Abas client-side com `useState` carregando todos os painéis e formulários no mesmo HTML.
   - *Decisão:* Renderização 100% no servidor pela URL: se o usuário chega via link de filtro (`?fonte=...`, `?categoria=...`, `?conformidade=...`) sem informar `aba`, `resolveFinanceTab` abre diretamente `lancamentos`.
2. **Desconto do valor original na prévia de teto ao editar despesa (`adjustedSource`):**
   - Ao editar uma despesa ativa que já pertence à mesma fonte em `FinancialEntryCreateForm`, o saldo projetado devolve o `amountCents` original antes de subtrair o novo valor digitado, evitando falso alarme de estouro de teto.

---

## 4. Registros de Decisão Arquitetural (ADRs)

- **ADR-497 — Abas por intenção, filtro de pendências (`GLOSA`, `MISSING_DOCUMENT`, `UNASSIGNED_SOURCE`) e paginação (`20`/página) no domínio financeiro.**
- **ADR-498 — Serviços e Server Actions de edição (`updateFundingSource` e `updateFinancialEntry`) com trilha `UPDATE` e suporte a `?conformidade=` na exportação CSV.**
- **ADR-499 — Rotas dedicadas `/novo` e `/editar`, checklist documental clicável, exportação colada ao filtro e Lei de Hick na linha (`EntryRowActions`).**
- **ADR-500 — Atualização das catracas `f76`/`f78` e cobertura unitária, integração e E2E para edição, reatribuição de glosa e conformidade.**

---

## 5. Lições Aprendidas (Defeitos Reais Encontrados na Execução)

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `finance-kpi-cards.tsx` atingiu `299` linhas contra o teto de `290` linhas da catraca `f122` | A adição do `ComplianceChecklistSection` elevou a contagem bruta de linhas | Extraídas constantes `KPI_CARD_CLS`/`KPI_HEADER_CLS` e compactada a formatação, reduzindo o arquivo abaixo de `290` linhas |
| `renderToStaticMarkup(<FinanceLedgerFilters />)` falhou com `invariant expected app router to be mounted` no Vitest | `FinanceLedgerFilters` usa `<GetSearchForm>`, Client Component que chama `useRouter()` | Testada `buildFinanceExportHref` diretamente na unidade e o render completo de `FinanceLedgerFilters` no E2E |
| `npm run build` dentro do sandbox Windows falhou com `TurbopackInternalError: Acesso negado (os error 5)` ao criar junction point | Política do sandbox Windows bloqueia criação de junction points do Turbopack em `.next/node_modules` | Executado `npm run build` com `BypassSandbox: true` conforme regra do ambiente |

---

## 6. Evidência de Verificação

- `npm run lint`: **0 erros, 0 warnings**.
- `npx tsc --noEmit --noUnusedLocals`: **0 erros**.
- `npm test`: **308 arquivos aprovados, 4999 testes passando** (`453.11s`).
- `npm run build`: **Compiled successfully in 10.1s** (rotas `/fontes/nova`, `/fontes/[sourceId]/editar`, `/lancamentos/novo` e `/lancamentos/[entryId]/editar` listadas).
- `npm run db:verify`: **`Contrato íntegro.`**
- `npm run db:verify:isolation`: **`9/9 verificações passaram.`**
- `npm run db:partitions`: partições verificadas (`253155` linhas na saída de verificação).
- Container local: imagens `eventflow/web:local` (`f8765c573014`) e `eventflow/worker:local` (`c802265eed11`) reconstruídas e saudáveis.
- `npx playwright test tests/e2e/f122-gestao-financeira-evento.spec.ts tests/e2e/f123-ux-financeiro-glosa-e-ciclo.spec.ts tests/e2e/f124-abas-edicao-e-conformidade-financeira.spec.ts`: **3 passed (13.8s)**.
- `npm run test:e2e`: **568 passed, 1 skipped (10.9m)**.
- `(Get-Item AGENTS.md).Length`: **64.273 bytes** (abaixo do teto de ~64.800 bytes).

---

## 7. Comandos Operacionais

```bash
npm run lint && npx tsc --noEmit --noUnusedLocals
npx vitest run tests/unit/f122-gestao-financeira-e-fomento.test.ts tests/unit/f123-ux-financeiro-glosa-e-ciclo.test.ts tests/unit/f124-abas-edicao-e-conformidade-financeira.test.ts tests/integration/f122-event-finance-service.test.ts
npm test
npm run build
docker compose --profile app up -d --build web worker
npx playwright test tests/e2e/f122-gestao-financeira-evento.spec.ts tests/e2e/f123-ux-financeiro-glosa-e-ciclo.spec.ts tests/e2e/f124-abas-edicao-e-conformidade-financeira.spec.ts
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- Mantidas as **39 dívidas abertas** em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md).

---

## 9. Checklist de Aceite

- [x] Abas por URL (`?aba=resumo|lancamentos|fontes`) e faixa executiva fixa em `/financeiro`.
- [x] Rotas dedicadas `/fontes/nova`, `/fontes/[sourceId]/editar`, `/lancamentos/novo`, `/lancamentos/[entryId]/editar` com `requireUuidParam` e `<PageHeader>`.
- [x] Checklist documental clicável, filtro de pendências (`GLOSA`, `MISSING_DOCUMENT`, `UNASSIGNED_SOURCE`), exportação colada ao filtro, paginação (`20`/página) e Lei de Hick na linha (`EntryRowActions`).
- [x] Bateria completa de verificação (lint, typecheck, Vitest unit + integração, `next build`, contratos DB, container build e E2E Playwright) aprovada.
