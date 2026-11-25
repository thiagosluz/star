# FASE 126 — Panorama Executivo e Painel Gráfico na Raiz do Evento

## 1. Sumário Executivo

A página raiz do evento (`/t/[tenantSlug]/administracao/eventos/[eventId]`) concentrava os números do evento apenas no subtítulo discreto do `<PageHeader>` (`X inscrição(ões) · Y atividade(s) · Z trilha(s)`), obrigando o organizador a abrir múltiplas telas secundárias para responder às perguntas executivas do evento atual (lotação, comparecimento, produção acadêmica, situação financeira e andamento da programação).

A FASE 126 entrega o **Panorama Executivo do Evento** diretamente abaixo do `<PageHeader>` e acima de `event-readiness`, preservando 100% da integridade estrutural das áreas e dos testes existentes.

### Tabela de Entregas

| Camada | Arquivo | Entregável |
|---|---|---|
| Domínio | [`src/domain/events/event-overview-rules.ts`](../src/domain/events/event-overview-rules.ts) | Projeção pura `computeEventOverviewSummary`, teto efetivo da atividade (`resolveEffectiveActivityCapacity`), formatadores `formatOverviewCurrencyBrl`/`formatOverviewMinutes` e guardas `null !== 0` |
| Aplicação | [`src/lib/events/event-area-counts.ts`](../src/lib/events/event-area-counts.ts) | Extensão de `getEventAreaCounts` na mesma transação `withTenant` (`Promise.all`) para consolidar `overview: EventOverviewDbMetrics` (inscrições no evento, frequência distinta/minutos, submissões enviadas, demandas concluídas, teto e caixa liquidado) |
| Interface SSR | [`src/components/admin/event-overview-panel.tsx`](../src/components/admin/event-overview-panel.tsx) | Painel Server Component puro (0 Client JS) com 4 cartões de KPI executivos e 3 gráficos vetoriais SVG (`Funil de participação`, `Ocupação da programação` e `Termômetro financeiro & pulso`) |
| Rota | [`src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/page.tsx`](../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/page.tsx) | Integração do `<EventOverviewPanel>` logo abaixo do `<PageHeader>`, com fallback seguro e guarda RBAC (`PERMISSIONS.SPONSOR_MANAGE`) |
| Testes | [`tests/unit/f126-panorama-executivo-do-evento.test.ts`](../tests/unit/f126-panorama-executivo-do-evento.test.ts) · [`tests/e2e/f126-panorama-executivo-do-evento.spec.ts`](../tests/e2e/f126-panorama-executivo-do-evento.spec.ts) | 5 testes unitários/SSR + 1 cenário E2E completo contra o container |

### Números da Fase
- **Arquivos criados:** 4 (`event-overview-rules.ts`, `event-overview-panel.tsx`, `f126-panorama-executivo-do-evento.test.ts`, `f126-panorama-executivo-do-evento.spec.ts`) + este documento.
- **Testes adicionados:** **5** testes Vitest unitários/SSR + **1** teste Playwright E2E.
- **Migrações:** 0 (reutiliza integralmente os modelos existentes sob RLS + FORCE).

---

## 2. O Problema Mais Difícil da Fase

Preservar simultaneamente os **dois invariantes estruturais rígidos** da raiz do evento:
1. **`tests/integration/f77-caminho-de-partida.test.ts`:** exige exatamente **5 elementos `<section>`** no HTML renderizado de `AdminEventDetailPage` (`event-readiness` + os 4 grupos de áreas `CONFIGURAR`, `VITRINE`, `OPERAR`, `RESULTADO`).
2. **`tests/e2e/f53-painel-e-areas.spec.ts`:** exige **0 elementos `<details>`** dentro de `<main>` e preserva a ordenação vertical das seções de configuração e vitrine.

Por isso, `<EventOverviewPanel>` foi construído inteiramente com `<div role="region" aria-label="Panorama executivo do evento">` e `<svg>` puros — **nenhum `<section>` e nenhum `<details>`**, mantendo a árvore semântica estável sem quebrar os contratos de DOM nem injetar JavaScript de cliente na rota.

---

## 3. Decisões Técnicas (ADRs)

### ADR-505 — Consolidação de Métricas do Painel Executivo dentro da Mesma Transação de `getEventAreaCounts`
- **Contexto:** `AdminEventDetailPage` já executa `getAdminEvent` e `getEventAreaCounts` (uma transação `withTenant` com `Promise.all`). Abrir uma terceira transação `withTenant` para buscar inscrições, frequência, submissões e resumo financeiro acrescentaria latência e uma nova conexão no pool por carregamento da raiz do evento.
- **Decisão:** Estender `getEventAreaCounts` para retornar `overview: EventOverviewDbMetrics` dentro do mesmo `Promise.all`, preservando `counts` e o tratamento de erro silencioso para a tela.
- **Alternativa descartada:** Criar um serviço `getEventOverviewSummary` separado com transação própria.
- **Consequência:** Zero transações extras no Postgres e retrocompatibilidade imediata com `f54-area-counts.test.ts` e `f77-caminho-de-partida.test.ts`.

### ADR-506 — Painel Executivo SSR Puro sem `<section>` e com Guarda RBAC para Finanças (`SPONSOR_MANAGE`)
- **Contexto:** Nem todo papel com permissão `EVENT_UPDATE` para gerenciar a programação do evento possui acesso ao livro-razão financeiro (`PERMISSIONS.SPONSOR_MANAGE`). Além disso, a raiz do evento possui catraca explícita de 5 `<section>`.
- **Decisão:** Renderizar o painel em Server Component puro usando `<div role="region">` (0 `<section>`, 0 `<details>`) e alternar o 4º KPI e o 3º bloco gráfico via `can(principal, PERMISSIONS.SPONSOR_MANAGE, { scope: 'TENANT' })`: usuários autorizados veem **Caixa & Fomento** + **Termômetro financeiro**, enquanto demais perfis veem **Operação & Equipes** + **Pulso operacional**.
- **Consequência:** Nenhum valor financeiro é exposto a quem não tem permissão e a árvore HTML mantém 0 bytes de Client JS para gráficos.

### ADR-507 — Semântica `null !== 0` e Teto Efetivo nas Barras da Programação
- **Contexto:** Eventos recém-criados ou atividades sem limite de vagas (`capacity = null` ou `requiresRegistration = false`) poderiam exibir `0%` enganoso nos cartões e gráficos.
- **Decisão:** Manter `occupationPercent` e `attendanceRatePercent` como `number | null` no domínio, renderizando `"Sem teto"`, `"Aberta ao evento"` ou `"—"` na interface quando aplicável, e calcular `effectiveCapacity` como o menor valor positivo entre `activity.capacity` e `activity.roomCapacity`.
- **Consequência:** Coerência absoluta entre os números do painel executivo, o módulo de Programação e as regras de lotação (ADR-136 / ADR-157).

---

## 4. Lições Aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| Risco de quebra da catraca de 5 `<section>` em `f77-caminho-de-partida.test.ts` | Uso intuitivo de `<section>` no novo painel de KPIs e gráficos | Adoção explícita de `<div role="region">` em `EventOverviewPanel`, travada por teste unitário SSR |
| Necessidade de filtrar rascunhos e excluídos em `Submission` | `Submission` possui `deletedAt` além de `status: 'DRAFT'` | Consulta explícita `{ ...escopo, deletedAt: null, status: { not: 'DRAFT' } }` confirmada no schema antes da implementação |
| Catraca `f69-contraste-do-tema-do-evento` falhou ao colocar o painel em `src/components/events/` | `f69` trata todo `.tsx` direto em `src/components/events/` como componente da vitrine pública sujeita ao `ThemeScope` | Realocação para [`src/components/admin/event-overview-panel.tsx`](../src/components/admin/event-overview-panel.tsx), mantendo coerência com `sponsor-kpi-cards.tsx` e `event-api-key-panel.tsx` |
| Barras SVG horizontais começavam deslocadas no meio da trilha nos dois painéis (`event-overview-panel` e `finance-charts-panel`) | Uso de `viewBox="0 0 200 8"` sem `preserveAspectRatio="none"` em `<svg className="w-full h-2">`: o padrão SVG `xMidYMid meet` centraliza horizontalmente o quadro interno quando a caixa real (~35:1) é mais larga que o `viewBox` (25:1) | Remoção de `viewBox="0 0 200 ..."` com uso de coordenadas percentuais 1:1 (`x="0%"`/`x="0"`, `width="${pct}%"`, `height="100%"`), além de largura mínima visual de `3%` e preenchimento sutil para atividades `"Aberta ao evento"`, travado em `f122` e `f126` |

---

## 5. Evidência de Verificação

> Preenchida com as saídas reais executadas após a última edição.

- `npm run lint` → 0 erros, 0 warnings
- `npx tsc --noEmit --noUnusedLocals` → 0 erros
- `npm test` → **5011** testes passando (**310** arquivos)
- `npm run build` → Compiled successfully (`✓ Generating static pages using 15 workers (19/19)`)
- `npm run db:verify` → Contrato íntegro
- `npm run db:verify:isolation` → 9/9 verificações passaram
- `npm run db:partitions` → Partições em dia (`258444` linha(s) preservadas)
- `docker compose --profile app up -d --build web` → Imagem nova (`eventflow/web:local` `31cbaa8c301d`) em execução
- `npx playwright test tests/e2e/f126-panorama-executivo-do-evento.spec.ts` → **1 passed** (2.6s)
- `npx playwright test tests/e2e/f53-painel-e-areas.spec.ts` → **3 passed**
- `npm run test:e2e` → **569 passed, 1 skipped** (em 571 casos; único timeout no caso `f63#3` por suspensão da máquina durante a execução); reexecução imediata isolada `npx playwright test tests/e2e/f63-aparencia-do-visitante.spec.ts` → **6 passed** (26.5s)

---

## 6. Comandos Operacionais

```bash
npx vitest run tests/unit/f126-panorama-executivo-do-evento.test.ts
npx playwright test tests/e2e/f126-panorama-executivo-do-evento.spec.ts
```

---

## 7. Checklist de Aceite

- [x] 4 KPIs executivos no topo da raiz do evento com escopo estrito no evento atual
- [x] 3 painéis gráficos SSR (Funil de participação, Ocupação da programação, Termômetro financeiro & pulso) com 0 bytes de Client JS
- [x] Guarda RBAC diferenciando visão financeira (`SPONSOR_MANAGE`) e visão operacional
- [x] Zero `<section>` e zero `<details>` adicionados no componente do painel (invariantes F53/F77 mantidas)
- [x] Testes unitários, integração e E2E verdes
