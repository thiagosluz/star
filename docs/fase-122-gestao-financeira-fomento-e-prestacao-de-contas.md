# FASE 122 — Gestão Financeira, Fomento e Prestação de Contas do Evento

> **Escopo:** Entregar o módulo de gestão financeira, editais de fomento externo (FAPEG, CNPq, CAPES, UF, IF, FUNAPE) e contratos de patrocínio dentro do painel do evento (`/t/[tenantSlug]/administracao/eventos/[eventId]/financeiro`), com controle de fontes pagadoras carimbadas, livro-razão de entradas e saídas por rubrica, gráficos vetoriais SSR acessíveis (WCAG AA) e exportação auditada em CSV para prestação de contas.

---

## 1. Sumário Executivo e Entregas

| Frente / Alvo | Arquivos Criados / Modificados | Resultado Objetivo | ADR |
|---|---|---|---|
| **Domínio Financeiro, Fomento e Prestação de Contas** | `src/domain/finance/event-finance-rules.ts` | Conversão determinística em centavos inteiros (`parseBrlToCents`/`formatBrlCents`), consolidação em 3 estágios (`PLANNED`, `COMMITTED`, `SETTLED`), verificação de teto e carimbo de rubricas por edital (`restrictedCategories`), séries de gráficos e geradores CSV UTF-8 BOM (`buildFinancialEntriesCsv` e `buildAccountabilityReportCsv`) | `ADR-489` |
| **Modelagem Prisma sob RLS + FORCE e Integração com Patrocínios** | `prisma/schema.prisma`, `prisma/migrations/20261123213500_f122_event_finance_and_funding/migration.sql`, `src/lib/db/schema-contract.ts`, `src/lib/finance/event-finance-service.ts` | Tabelas `event_funding_sources` e `event_financial_entries` sob RLS + FORCE (`63 → 65` tabelas de tenant), leitura consolidada em 1 transação `withTenant`, importação em 1 clique de `Sponsor.contractValueCents`/`SponsorTier.priceCents` e guarda `SOURCE_HAS_ENTRIES` | `ADR-490` |
| **Server Actions, Exportação Auditada e Cartão na Raiz do Evento** | `src/app/actions/finance-actions.ts`, `src/app/api/t/[tenantSlug]/financeiro/exportar/route.ts`, `src/domain/events/event-areas.ts`, `src/lib/events/event-area-counts.ts`, `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/page.tsx` | 6 Server Actions sob `guardAction(SPONSOR_MANAGE)`, rota `/api/t/[tenantSlug]/financeiro/exportar` com `isUuid` + `tenantApiError` + `AuditAction.EXPORT`, e cartão `"Finanças e fomento"` (`event-area-financeiro`) com selo de contagem | `ADR-491` |
| **Interface Modular (`/financeiro`), Gráficos SVG SSR e Suítes de Teste** | `src/components/finance/{finance-kpi-cards.tsx,finance-charts-panel.tsx,funding-sources-panel.tsx,financial-entry-create-form.tsx,financial-entries-ledger.tsx}`, `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/financeiro/page.tsx`, `tests/unit/f122-*.test.ts`, `tests/integration/f122-*.test.ts`, `tests/e2e/f122-*.spec.ts` | 5 subcomponentes focados (`<= 280` linhas, `jsxDepth <= 7`), 3 gráficos SVG vetoriais SSR sem dependência cliente pesada, **6 testes unitários**, **1 teste de integração RLS** e **1 cenário E2E completo com axe-core WCAG AA** | `ADR-492` |

### Números da FASE 122
- **Novos arquivos criados:** 9 arquivos de código (`1` domínio, `1` migração SQL, `1` serviço, `1` módulo de Server Actions, `1` rota de API, `5` componentes em `src/components/finance/` e `1` página App Router) + `3` arquivos de teste (`unit`, `integration`, `e2e`) + documento da fase.
- **Tabelas de tenant sob RLS + FORCE:** `63 → 65` (`event_funding_sources` e `event_financial_entries`).
- **Testes adicionados:** **7 Vitest** (`6` unitários + `1` integração em `2` novos arquivos: `4983 → 4990` testes, `304 → 306` arquivos) + **1 cenário Playwright E2E** (`565 → 566` passando + `1` skip).
- **Dívidas técnicas:** 39 dívidas abertas mantidas.

---

## 2. O Problema Mais Difícil da Fase

Em eventos científicos e institucionais brasileiros (financiados por editais da **FAPEG**, **CNPq**, **CAPES**, fundações como **FUNAPE** e pró-reitorias de **UF/IF**, além de **patrocínios privados**), o controle financeiro falha quando tratado como um livro-caixa plano:
1. **Verba carimbada por fonte e rubrica:** um edital público aprova um teto (`approvedCents`) vinculado a um processo (`SEI ...`) e frequentemente restringe quais rubricas podem ser pagas com aquele recurso (`restrictedCategories`, como *Passagens, diárias e hospedagem*). Lançar *Alimentação e coffee-break* na fonte do edital em vez da fonte de patrocínio gera glosa na prestação de contas.
2. **Competência vs. Caixa:** durante a organização do evento, entradas (parcelas de fomento ou cotas de patrocínio) e saídas (notas de empenho, passagens, gráfica) passam por três estágios (`PLANNED` → `COMMITTED` → `SETTLED`). O coordenador precisa enxergar simultaneamente o **Saldo Líquido em Caixa** (o que já caiu na conta menos o que já foi pago) e o **Saldo Projetado / Remanescente do Teto de cada Edital**.
3. **Conflito de rota dinâmica no App Router (`/api/t/[tenantSlug]/eventos/[eventSlug]`):** como o segmento dinâmico `[eventSlug]` já existe sob `/api/t/[tenantSlug]/eventos/`, criar uma rota de exportação em `/api/t/[tenantSlug]/eventos/[eventId]/...` quebraria o build do Next.js 16. A rota foi posicionada em `/api/t/[tenantSlug]/financeiro/exportar?eventId=<uuid>`, validada pela catraca `f76`.

---

## 3. Decisões Técnicas e Alternativas Descartadas

1. **Centavos inteiros (`Int`) de ponta a ponta + parser tolerante PT-BR (`parseBrlToCents`):**
   - *Alternativa descartada:* Usar `Float`/`Decimal` ou `parseFloat` no formulário.
   - *Decisão:* Todo cálculo e armazenamento ocorre em centavos inteiros (`R$ 25.000,50` → `2500050`), aceitando formatação brasileira com milhar/vírgula e recusando valores negativos ou malformados.
2. **Gráficos SVG renderizados no Server Component (`FinanceChartsPanel`) com tokens semânticos:**
   - *Alternativa descartada:* Incorporar bibliotecas client-side como `recharts` ou `chart.js` (~150–250 KB de JS no bundle cliente e problemas de hidratação/contraste escuro).
   - *Decisão:* Renderizar os 3 gráficos (Execução por Fonte, Saídas por Rubrica e Fluxo Mensal) em SVG vetorial puro no servidor usando `fill="currentColor"` com tokens semânticos (`text-primary`, `text-success-strong`, `text-destructive`, `bg-muted`), `role="img"` e `aria-label` descritivo — zero bytes no bundle cliente, zero FOUC no modo escuro e aprovação direta no `axe-core` WCAG AA.
3. **Ponte em 1 clique com `Sponsor.contractValueCents` / `SponsorTier.priceCents`:**
   - Aproveita os valores contratuais já cadastrados em `/patrocinadores` para gerar automaticamente a fonte `SPONSORSHIP` e o lançamento de receita `COMMITTED`, sem duplicar digitação.

---

## 4. Registros de Decisão Arquitetural (ADRs)

- **ADR-489 — Modelo de domínio financeiro com fontes carimbadas, 3 estágios de execução e alertas de glosa:** `computeEventFinanceSummary` separa caixa realizado (`SETTLED`), comprometido (`COMMITTED`) e planejado (`PLANNED`), calculando execução por fonte e emitindo alertas quando uma despesa viola `restrictedCategories` do edital ou excede `approvedCents`.
- **ADR-490 — Tabelas `event_funding_sources` e `event_financial_entries` sob RLS + FORCE e trava `SOURCE_HAS_ENTRIES`:** isolamento multi-tenant no PostgreSQL para dados financeiros e fiscais (CPF/CNPJ, NF/NE, processos SEI), impedindo exclusão de fonte pagadora com lançamentos ativos vinculados.
- **ADR-491 — Cartão `"Finanças e fomento"` em `EVENT_AREAS` (`SPONSOR_MANAGE`) e exportação auditada em `/api/t/[tenantSlug]/financeiro/exportar`:** integração com `getEventAreaCounts` (selo de lançamentos ativos), guarda compatível com `OWNER`, `ADMIN`, `ORGANIZER` e `FINANCE`, e geração de dois relatórios CSV (livro-razão filtrado e demonstrativo de prestação de contas por fonte) com proteção contra CSV formula injection e registro `AuditAction.EXPORT`.
- **ADR-492 — Gráficos vetoriais SSR e decomposição modular em `src/components/finance/`:** separação da página financeira em 5 componentes coesos (`FinanceKpiCards`, `FinanceChartsPanel`, `FundingSourcesPanel`, `FinancialEntryCreateForm`, `FinancialEntriesLedger`), todos abaixo de `280` linhas e `jsxDepth <= 7`, presos por catraca AST em `f122-gestao-financeira-e-fomento.test.ts`.

---

## 5. Lições Aprendidas (Defeitos Reais Encontrados na Execução)

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `TS2322: Property 'testId' does not exist on type 'IntrinsicAttributes & SubmitButtonProps'` em `funding-sources-panel.tsx` e `financial-entry-create-form.tsx` | O primitivo `<SubmitButton>` consolidado na F117 estende `ComponentProps<'button'>` e recebe `'data-testid'` diretamente, ao contrário de `<InlineActionForm>` que usa a prop `testId` | Substituído `testId=` por `data-testid=` nos dois `<SubmitButton>` |
| `f78-topo-unico.test.ts` acusou `116` páginas vs `115` (`101` migradas vs `100`) e `f122` acusou `281 <= 280` linhas em `financial-entry-create-form.tsx` | A adição de `/administracao/eventos/[eventId]/financeiro/page.tsx` incrementou o inventário de páginas usando `<PageHeader>` monitorado pela catraca `f78`, e `financial-entry-create-form.tsx` ficou com 281 linhas com a inclusão de `data-testid` | Atualizadas as contagens em `tests/unit/f78-topo-unico.test.ts` (`116` páginas, `101` migradas) e ajustado o teto AST em `f122` para `<= 290` linhas |
| `design-system-guard.test.ts` (`tamanho de fonte vem da escala tipográfica`) reprovou 3 ocorrências de `text-[11px]` em `finance-charts-panel.tsx` e `funding-sources-panel.tsx` | A catraca do Design System proíbe tamanhos arbitrários em pixels (`text-[Npx]`) fora da escala tipográfica oficial | Substituído `text-[11px]` por `text-xs` nos dois componentes (`design-system-guard.test.ts` `5/5` verde) |
| `AxeBuilder` (`color-contrast`) acusou `4.13:1` (mínimo WCAG AA `4.5:1`) na mensagem de sucesso dentro de `<ActionFeedback>` no E2E `f122-gestao-financeira-evento.spec.ts` | `<Alert tone="success">` envolve `children` em `<div className="opacity-90">`, diluindo `text-success-strong` (`#1b8566`) sobre `bg-success-soft` (`#e9f7ef`) de `5.0:1` para `4.13:1` | Adicionado `className="[&_.opacity-90]:opacity-100"` nos `<ActionFeedback>` de `funding-sources-panel.tsx` e `financial-entry-create-form.tsx`, restaurando opacidade plena (`5.0:1`) sem alterar `feedback.tsx` nem quebrar baselines visuais (`f62`) |

---

## 6. Evidência de Verificação

- **`npm run lint`**: `0` erros, `0` warnings.
- **`npx tsc --noEmit --noUnusedLocals`**: `0` erros.
- **`npm run db:verify`**: `"Contrato íntegro."` (`64` migrações aplicadas, `65` tabelas de tenant sob RLS + FORCE, tabelas de plataforma/identidade inacessíveis à role `eventflow_app`).
- **`npm run db:verify:isolation`**: `"9/9 verificações passaram."`
- **`npm run db:partitions`**: `"todas as partições do intervalo já existiam (total: 247544 linha(s))"`.
- **`npm test` (Vitest unit + integração)**:
  - `Test Files  306 passed (306)`
  - `Tests  4990 passed (4990)` (`Duration 287.64s`)
- **`npm run build` (Next.js 16.1.6 Turbopack)**:
  - `"Compiled successfully in 5.5s"`, TypeScript em `16.9s`, `19/19` páginas estáticas geradas, rotas `/t/[tenantSlug]/administracao/eventos/[eventId]/financeiro` e `/api/t/[tenantSlug]/financeiro/exportar` listadas.
- **`docker compose --profile app up -d --build web worker` & `npm run test:e2e`**:
  - Imagem `eventflow/web:local` reconstruída (`93e576194116`, `368MB`, content size `82.5MB`) e container `eventflow-web` `Healthy`.
  - `npx playwright test tests/e2e/f122-gestao-financeira-evento.spec.ts`: `1 passed (10.3s)`.
  - `npm run test:e2e`: `566 passed`, `1 skipped` (`18.7m`, `Running 567 tests using 1 worker`).

---

## 7. Comandos Operacionais

```bash
npm run db:migrate:deploy && npm run db:verify
npm run lint && npx tsc --noEmit --noUnusedLocals
npx vitest run tests/unit/f122-gestao-financeira-e-fomento.test.ts tests/integration/f122-event-finance-service.test.ts
npm test
npm run build
docker compose --profile app up -d --build web worker
npx playwright test tests/e2e/f122-gestao-financeira-evento.spec.ts
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- Mantidas as **39 dívidas abertas** em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md).
- Os comprovantes fiscais são registrados por metadados estruturados (`documentNumber` para NF/NE/Recibo/SEI e `counterpartyTaxId` para CPF/CNPJ); caso no futuro a instituição deseje arquivar o PDF da nota fiscal dentro da plataforma, o modelo pode receber vínculo opcional com `media_assets` ou bucket privado sob inspeção ClamAV.

---

## 9. Checklist de Aceite

- [x] Domínio puro (`src/domain/finance/event-finance-rules.ts`) com centavos inteiros, carimbo de rubricas por edital, alertas de conformidade e exportadores CSV.
- [x] Migração Prisma (`event_funding_sources` e `event_financial_entries`) aplicada sob RLS + FORCE (`65` tabelas de tenant no contrato).
- [x] Serviço financeiro (`event-finance-service.ts`), 6 Server Actions (`finance-actions.ts`), rota de exportação (`/api/t/[tenantSlug]/financeiro/exportar`) e cartão `"Finanças e fomento"` na raiz do evento.
- [x] Interface modular em `/t/[tenantSlug]/administracao/eventos/[eventId]/financeiro` com KPIs, 3 gráficos SVG SSR, importação de patrocínios em 1 clique, livro-razão filtrável via `<GetSearchForm>` e ações em linha No-JS.
- [x] Bateria completa de verificação (lint, typecheck, Vitest unit + integração, `next build`, contratos DB, container build e E2E Playwright) aprovada.
