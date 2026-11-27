# FASE 129 — Painel Operacional de Alertas, Streaming e Ergonomia em `/superadmin/metricas`

## 1. Sumário executivo

A seção de **Alertas operacionais** em `/superadmin/metricas` espelhava diretamente nomes
Prometheus em inglês (`BullMQNoWorkers`) e expressões booleanas cruas em um grid 3×2 com
célula vazia, além de acoplar a consulta ao Redis ao TTFB dos KPIs de governança.

| Entrega | Onde |
|---|---|
| Projeção pura de apresentação e agrupamento | `src/domain/observability/alert-rules.ts` |
| Server Component isolado para `<Suspense>` | `src/components/platform/operational-alerts-section.tsx` |
| Botão de atualização sob demanda (`router.refresh()`) | `src/components/platform/refresh-metrics-button.tsx` |
| Streaming `<Suspense>`, `force-dynamic` e datas `pt-BR` | `src/app/superadmin/metricas/page.tsx` |

Números: **4** Vitest unitários/SSR + **2** E2E; sem migração; contratos de `/api/metrics` e
`data-testid` (`f110`, `f60`) 100% preservados.

## 2. O problema mais difícil

Manter uma **única fonte de verdade** com os gauges Prometheus (`eventflow_alert_firing`)
sem vazar sintaxe de PromQL para o primeiro nível de leitura do operador, e sem permitir que
uma lentidão do Redis bloqueie o primeiro byte da página de governança.

## 3. Decisões e ADRs

- **ADR-514 — Linguagem operacional humana + detalhes Prometheus recolhidos.** `presentOperationalAlerts`
  e `groupOperationalAlerts` (`src/domain/observability/alert-rules.ts`) mapeiam cada regra para
  título em português, categoria semântica (`Filas & Workers` × `Aplicação & Segurança`), leitura
  observada sem ambiguidade (`1 worker(s) · 0 na fila`, `Conectado`, `0 / 20`), severidade visível,
  ordenação `firing` primeiro e link acionável para `/superadmin/rotinas`. O identificador técnico e
  a expressão PromQL vivem em `<details>` recolhido por padrão.
- **ADR-515 — Isolamento por `<Suspense>` e revalidação sob demanda em `/superadmin/metricas`.**
  A consulta ao Redis (`readOperationalAlertReport`) foi desacoplada do `Promise.all` principal para
  `OperationalAlertsSection` sob `<Suspense fallback={<OperationalAlertsSkeleton />}>`, com
  `export const dynamic = 'force-dynamic'`, botão leve `RefreshMetricsButton` (`useTransition` +
  `router.refresh()`) e datas formatadas em `pt-BR` via `formatDateTimePtBr`.

## 4. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `eslint`: erro de parsing em `f129-alertas-operacionais-ux.test.ts` | uso de JSX em arquivo `.test.ts` | trocado para `createElement(...)` |
| E2E `automation-routines.spec.ts`: `getByRole('link', { name: 'Rotinas' })` resolveu para 4 links | rótulos dos atalhos de alerta continham a palavra `rotinas` (match por substring) | renomeados para `Ver fila`, `Painel do worker` e `Inspecionar jobs` |

## 5. Evidência de verificação

- `npm run lint`: `0` erros, `0` warnings
- `npx tsc --noEmit --noUnusedLocals`: `0` erros
- `npm test`: `314 passed (314)` · **`5028 passed (5028)`** (`314.80s`)
- `npm run build`: `Compiled successfully` (`/superadmin/metricas` listada)
- `docker compose --profile app up -d --build web`: imagem `eventflow/web:local` (`2026-11-27 10:48:11 -0300`)
- `npm run db:verify`: `Contrato íntegro.`
- `npm run db:verify:isolation`: `9/9 verificações passaram.`
- `npm run db:partitions`: `todas as partições do intervalo já existiam` (`263228` linhas)
- `npm run test:e2e`: **`577 passed` + `1 skipped`** (`10.8m`)
- `(Get-Item AGENTS.md).Length`: **`64109` bytes** (abaixo do teto de ~64.800 bytes)

## 6. Comandos

```bash
npx vitest run tests/unit/f129-alertas-operacionais-ux.test.ts
npx playwright test tests/e2e/f129-superadmin-metricas-alertas.spec.ts tests/e2e/f110-privacidade-e-conta.spec.ts
```

## 7. Dívidas e pontos de atenção

- Os contadores `Http5xxSpike` e `MetricsScrapeDeniedSpike` continuam por processo Node.js (como
  documentado no `/api/metrics`), o que agora fica explícito na UI e na orientação do sensor.

## 8. Checklist de aceite

- [x] Títulos humanos em português e leituras observadas sem ambiguidade
- [x] Layout agrupado sem buraco no grid e ordenação com alertas ativos no topo
- [x] Detalhes Prometheus recolhidos em `<details>`
- [x] Streaming com `<Suspense>` + botão `Atualizar leitura` + atalho `/superadmin/rotinas`
- [x] Formatação `pt-BR` nas datas da página
