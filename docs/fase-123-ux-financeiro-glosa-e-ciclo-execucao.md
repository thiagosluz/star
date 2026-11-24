# FASE 123 — Refinamento de UX Operacional, Prevenção Proativa de Glosa e Ciclo Completo de Execução Financeira

> **Escopo:** Elevar a ergonomia operacional de `/t/[tenantSlug]/administracao/eventos/[eventId]/financeiro` com prevenção proativa de glosa e estouro de teto *antes* do envio do formulário (*Poka-Yoke*), reset automático de formulários controlados em lançamentos em lote, campos adaptativos por tipo (`INCOME` × `EXPENSE`) e situação (`PLANNED`/`COMMITTED`/`SETTLED`), ciclo completo no livro-razão (`Empenhar`, `Liquidar com Nº NF/OB` e `Cancelar`), subtotais do recorte filtrado, datas em formato brasileiro (`DD/MM/AAAA`), *drill-down* clicável nos gráficos/fontes e guia inicial de onboarding.

---

## 1. Sumário Executivo e Entregas

| Frente / Alvo | Arquivos Criados / Modificados | Resultado Objetivo | ADR |
|---|---|---|---|
| **Domínio de Prevenção de Glosa (*Poka-Yoke*), Datas PT-BR e Subtotais do Filtro** | `src/domain/finance/event-finance-rules.ts` | `evaluateEntryCompliance` (aviso prévio de rubrica proibida e saldo projetado do teto da fonte), `isEntryCategoryViolation`, `computeFilteredLedgerTotals`, `categoriesForEntryType` e `formatIsoDatePtBr` (`AAAA-MM-DD` → `DD/MM/AAAA` sem desvio de fuso) | `ADR-493` |
| **Ciclo Completo de Execução (`PLANNED` → `COMMITTED` → `SETTLED` → `CANCELED`) com Comprovante na Liquidação** | `src/lib/finance/event-finance-service.ts`, `src/app/actions/finance-actions.ts`, `src/components/finance/financial-entries-ledger.tsx` | `updateFinancialEntryStatus` e `updateFinancialEntryStatusAction` aceitam `documentNumber` opcional ao liquidar e auditam a mudança; livro-razão ganha botões `Empenhar`, `Marcar como pago` / `Confirmar recebimento` (com campo inline `Nº NF-e / OB`), `Cancelar`, badge `Rubrica fora do edital` na linha infratora e barra de subtotais do filtro | `ADR-494` |
| **Formulários Adaptativos com Reset em Lote no Render** | `src/components/finance/funding-sources-panel.tsx`, `src/components/finance/financial-entry-create-form.tsx` | Limpeza automática dos campos de texto/valor quando `state?.ok === true` (preservando `useActionState(action, null)` direto para SSR/No-JS e mantendo fonte/tipo/rubrica para digitação em lote), ocultação de `settledOn` fora de `SETTLED`, rótulos dinâmicos `INCOME` × `EXPENSE`, prévia em `R$` ao vivo e banner preventivo de glosa antes do submit | `ADR-495` |
| **Onboarding Inicial, Escopo de Exportação e *Drill-Down* Clicável nos Gráficos** | `src/components/finance/finance-kpi-cards.tsx`, `src/components/finance/finance-charts-panel.tsx`, `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/financeiro/page.tsx`, `tests/unit/f123-*.test.ts`, `tests/e2e/f123-*.spec.ts` | Guia de 3 passos (`finance-onboarding-guide`) no estado inicial vazio, selo `Exportando recorte filtrado` vs `Exportando todos os lançamentos`, links clicáveis `?fonte=` e `?categoria=` nos gráficos/fontes, **4 testes unitários/SSR** e **1 cenário E2E completo com axe-core WCAG AA** | `ADR-496` |

### Números da FASE 123
- **Arquivos criados / modificados:** 9 arquivos de código modificados (`event-finance-rules.ts`, `event-finance-service.ts`, `finance-actions.ts`, os 5 componentes em `src/components/finance/` e `financeiro/page.tsx`) + 2 novos arquivos de teste (`tests/unit/f123-ux-financeiro-glosa-e-ciclo.test.ts`, `tests/e2e/f123-ux-financeiro-glosa-e-ciclo.spec.ts`) e expansão de `tests/integration/f122-event-finance-service.test.ts`.
- **Testes adicionados:** **4 Vitest** (`4990 → 4994` testes, `306 → 307` arquivos) + **1 cenário Playwright E2E** (`566 → 567` passando + `1` skip).
- **Dívidas técnicas:** 39 dívidas abertas mantidas.

---

## 2. O Problema Mais Difícil da Fase

Na prestação de contas acadêmica (FAPEG, CNPq, CAPES, FUNAPE), o erro mais caro ocorre **no momento do lançamento em lote**:
1. **Descoberta tardia da glosa:** avisar que uma despesa de *Alimentação* foi alocada num edital que só permite *Passagens e diárias* **depois** que o lançamento já foi salvo obriga o coordenador a procurar a linha no livro-razão, excluí-la e redigitá-la. O cálculo precisava ser uma função pura de domínio (`evaluateEntryCompliance`) compartilhável entre o formulário cliente (feedback instantâneo enquanto escolhe fonte, rubrica e valor) e o motor de auditoria.
2. **Reset de formulário controlado sem quebrar `$ACTION_*` do React 19:** para preservar os dados digitados quando uma Server Action devolve `{ ok: false }`, os inputs são controlados por `useState`. Porém, quando a action devolve `{ ok: true }`, manter os valores anteriores nos campos causa lançamentos duplicados, enquanto envolver a Server Action num closure cliente dentro de `useActionState` quebraria a referência serializada para No-JS. A reconciliação de estado diretamente na fase de render (`if (state !== lastHandledState) { setLastHandledState(state); if (state?.ok) { ... } }`) limpa os campos de descrição/valor/documento no exato frame da resposta `{ ok: true }`, mantendo a referência direta da Server Action e preservando `sourceId`/`type`/`category` para o próximo lançamento do lote.

---

## 3. Decisões Técnicas e Alternativas Descartadas

1. **Prevenção de glosa *in-place* via `evaluateEntryCompliance` + sufixo nas opções do `<select>`:**
   - *Alternativa descartada:* Bloquear rigidamente (`disabled`) as rubricas fora do edital no `<select>`.
   - *Decisão:* Em alguns convênios há aditivos ou remanejamento autorizado; por isso o `<select>` sinaliza `(Permitida no edital)` vs `(Fora do edital)` e exibe o alerta preventivo com o saldo projetado do teto (`finance-entry-compliance-warning`), alertando sem travar operações excepcionais justificadas nas observações.
2. **Anexo inline de Nº NF / Ordem Bancária na própria ação de liquidação (`updateFinancialEntryStatus`):**
   - *Alternativa descartada:* Exigir excluir o lançamento `PLANNED`/`COMMITTED` e criar outro `SETTLED` quando a Nota Fiscal é emitida.
   - *Decisão:* Quando o lançamento ainda não possui `documentNumber`, o botão `Marcar como pago` / `Confirmar recebimento` exibe um campo compacto inline (`name="documentNumber"`) no mesmo `<InlineActionForm>`, gravando a transição de status, a data de liquidação e o documento fiscal numa única transação auditada.

---

## 4. Registros de Decisão Arquitetural (ADRs)

- **ADR-493 — Avaliação prévia pura de conformidade (`evaluateEntryCompliance`), subtotais do filtro e datas PT-BR sem fuso:** funções puras no domínio para calcular antes do submit o saldo projetado da fonte e violações de `restrictedCategories`, somar entradas/saídas do recorte filtrado (`computeFilteredLedgerTotals`) e formatar `AAAA-MM-DD` em `DD/MM/AAAA` (`formatIsoDatePtBr`).
- **ADR-494 — Ciclo completo no livro-razão (`PLANNED` → `COMMITTED` → `SETTLED` → `CANCELED`) com comprovante inline:** extensão de `updateFinancialEntryStatus` para receber `documentNumber` opcional na liquidação e exposição dos botões `Empenhar`, `Marcar como pago` (com input de NF/OB) e `Cancelar` + badge `Rubrica fora do edital` por linha.
- **ADR-495 — Reset inteligente em lote na fase de render e formulário adaptativo por tipo/situação:** limpeza automática dos campos descritivos pós-sucesso `{ ok: true }` sem `useEffect` e sem closure sobre a Server Action, ocultação de `settledOn` fora de `SETTLED` e adaptação dinâmica dos rótulos para `INCOME` × `EXPENSE`.
- **ADR-496 — Guia de onboarding no estado vazio, indicador de escopo de exportação e *drill-down* por URL nos gráficos:** exibição do passo a passo inicial quando `sourcesCount === 0 && activeEntriesCount === 0`, selo explícito de exportação filtrada vs completa e links `?fonte=` / `?categoria=` nos gráficos SVG e cartões de fonte.

---

## 5. Lições Aprendidas (Defeitos Reais Encontrados na Execução)

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `edit_file` duplicou o bloco de `isEntryCategoryViolation`/`evaluateEntryCompliance` em `event-finance-rules.ts` | O alvo `return \`\\uFEFF${[header, ...rows].join('\\r\\n')}\\r\\n\`;` aparecia no fim das duas funções geradoras de CSV (`buildFinancialEntriesCsv` e `buildAccountabilityReportCsv`) | Removida a ocorrência duplicada mantendo as novas funções apenas no final do módulo |
| `funding-sources-panel.tsx` (`321` linhas) e `financial-entry-create-form.tsx` (`310` linhas) ultrapassaram o teto de `290` linhas da catraca AST `f122` após a inclusão dos novos recursos de UX | A repetição de classes longas de input e quebras de linha verticais inflou a contagem bruta de linhas dos dois componentes | Extraída a constante `INPUT_CLS` e compactada a formatação vertical, deixando todos os 6 arquivos abaixo de `290` linhas e `jsxDepth <= 7` |
| `f107-ux-formularios-transicoes-e-popstate.test.ts` (`nenhum componente cliente além de AppLink importa next/link diretamente`) reprovou `funding-sources-panel.tsx` | Como `funding-sources-panel.tsx` é um Client Component (`'use client'`), a catraca `ADR-441` exige o uso de `<AppLink>` de `@/components/ui` para preservar o feedback global da `NavigationProgressBar` | Substituído `import Link from 'next/link'` por `{ AppLink } from '@/components/ui'` em `funding-sources-panel.tsx` |
| `f119-previa-api-paginacao-midia-modularizacao-e-dividas.test.ts` acusou falta de `'567 testes Playwright'` na árvore de diretórios da §12 do `README.md` | A linha `└── e2e/ 566 testes Playwright contra o container` na §12 do `README.md` ainda carregava a contagem da FASE 122 | Atualizada a linha 685 do `README.md` para `567 testes Playwright contra o container` |

---

## 6. Evidência de Verificação

- **`(Get-Item AGENTS.md).Length`**: `64.393` bytes (abaixo do teto de `64.800` bytes; FASE 106 movida para `docs/fases-historico.md`).
- **`npm run lint`**: `0` erros, `0` warnings.
- **`npx tsc --noEmit --noUnusedLocals`**: `0` erros.
- **`npm run db:verify`**: `"Contrato íntegro."` (`65` tabelas de tenant sob RLS + FORCE, tabelas de plataforma/identidade inacessíveis à role `eventflow_app`).
- **`npm run db:verify:isolation`**: `"9/9 verificações passaram."`
- **`npm run db:partitions`**: `"todas as partições do intervalo já existiam (total: 250243 linha(s))"`.
- **`npm test` (Vitest unit + integração)**:
  - `Test Files  307 passed (307)`
  - `Tests  4994 passed (4994)` (`Duration 325.24s`)
- **`npm run build` (Next.js 16.4.5 Turbopack)**:
  - `"Compiled successfully in 6.2s"`, TypeScript em `4.7s`, `19/19` páginas estáticas geradas (`307ms`).
- **`docker compose --profile app up -d --build web worker` & `npm run test:e2e`**:
  - Imagens `eventflow/web:local` (`4284078674f3`) e `eventflow/worker:local` (`f94dcbeaae0e`) reconstruídas e containers `Healthy`.
  - `npx playwright test tests/e2e/f122-gestao-financeira-evento.spec.ts tests/e2e/f123-ux-financeiro-glosa-e-ciclo.spec.ts`: `2 passed (9.9s)`.
  - `npm run test:e2e`: `567 passed`, `1 skipped` (`12.1m`, `Running 568 tests using 1 worker`).

---

## 7. Comandos Operacionais

```bash
npm run lint && npx tsc --noEmit --noUnusedLocals
npx vitest run tests/unit/f122-gestao-financeira-e-fomento.test.ts tests/unit/f123-ux-financeiro-glosa-e-ciclo.test.ts tests/integration/f122-event-finance-service.test.ts
npm test
npm run build
docker compose --profile app up -d --build web worker
npx playwright test tests/e2e/f122-gestao-financeira-evento.spec.ts tests/e2e/f123-ux-financeiro-glosa-e-ciclo.spec.ts
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- Mantidas as **39 dívidas abertas** em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md).

---

## 9. Checklist de Aceite

- [x] Funções puras de prevenção proativa de glosa (`evaluateEntryCompliance`, `isEntryCategoryViolation`), subtotais do filtro (`computeFilteredLedgerTotals`), priorização de rubricas (`categoriesForEntryType`) e datas PT-BR (`formatIsoDatePtBr`).
- [x] Reset automático dos formulários controlados após `{ ok: true }`, campos adaptativos `INCOME` × `EXPENSE` e ocultação de `settledOn` quando `status !== 'SETTLED'`.
- [x] Ciclo completo no livro-razão (`Empenhar`, `Marcar como pago` com `documentNumber` inline, `Cancelar`), badge `Rubrica fora do edital` na linha e barra de subtotais do recorte filtrado.
- [x] Guia de onboarding no estado vazio, selo de escopo na barra de exportação CSV e links de *drill-down* (`?fonte=` e `?categoria=`) nos gráficos e cartões de fonte.
- [x] Bateria completa de verificação (lint, typecheck, Vitest unit + integração, `next build`, contratos DB, container build e E2E Playwright) aprovada.
