# FASE 101 — Correção Empírica da Reatividade, Interceptação Real de Links e useOptimistic Estável

> **Status:** Entregue  
> **Data:** 11/11/2026  
> **Tema:** Reatividade empírica, interceptação real de links no Next.js 16 App Router, `useOptimistic` com transição assíncrona estável no balcão e testes comportamentais ponta a ponta.

---

## 1. Sumário Executivo

A FASE 101 corrige com rigor empírico as regressões sutis introduzidas nas FASES 99 e 100 decorrentes de premissas teóricas não testadas contra a mecânica interna do App Router do Next.js 16 e do React 19.

| Entrega | Arquivos | Resumo |
|---|---|---|
| **Interceptação Real de Navegação** | [`src/components/ui/navigation-progress-bar.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/ui/navigation-progress-bar.tsx)<br>[`src/components/ui/app-link.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/ui/app-link.tsx)<br>[`src/components/ui/index.ts`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/ui/index.ts) | **ADR-423:** Restauração do listener na fase de captura (`capture: true`) com guardas granulares (`e.button === 0`, sem modificadores, sem `_blank`/`download`, ignorando `data-no-progress`, `role="button"` e URLs idênticas), impedindo que o `e.preventDefault()` intrínseco do `<Link>` do Next.js mutasse a barra. Criação do componente canônico `<AppLink>` com prop `onNavigate` nativa do Next.js 16 e conclusão via `requestAnimationFrame`. |
| **Micro-interação Otimista no Balcão** | [`src/components/gamification/checkin-queue.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/gamification/checkin-queue.tsx) | **ADR-424:** Substituição do despachante `useActionState` instantâneo por transição assíncrona real (`startTransition(async () => { ... await action(...) })`). O estado "Credenciando agora…" com indicador de pulso permanece estável durante toda a latência de rede/banco, e o botão é desabilitado via `disabled={busy}` (`pending || isPending`), impedindo duplo clique com inversão de modo. Em caso de falha, o erro permanece visível com `role="alert"` e `text-destructive`. |
| **Idempotência em Filtros** | [`src/components/review/comite-filter-bar.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/review/comite-filter-bar.tsx) | **ADR-425:** `applyFilters` compara a URL alvo com a URL corrente (`targetUrl === currentUrl`). Se forem idênticas, aborta imediatamente sem disparar transição nem progresso que ficaria travado em 80% até o timeout. |
| **Testes Unitários & Integração** | [`tests/unit/f101-reatividade-empirica-e-testes-comportamentais.test.ts`](file:///c:/Users/thiago/Documents/Projetos/star/tests/unit/f101-reatividade-empirica-e-testes-comportamentais.test.ts)<br>[`tests/unit/f100-correcoes-reatividade-e-suspense.test.ts`](file:///c:/Users/thiago/Documents/Projetos/star/tests/unit/f100-correcoes-reatividade-e-suspense.test.ts)<br>[`tests/unit/f79-fases-no-arquivo-certo.test.ts`](file:///c:/Users/thiago/Documents/Projetos/star/tests/unit/f79-fases-no-arquivo-certo.test.ts) | 5 testes unitários dedicados da F101 cobrindo `AppLink`, validações de captura em `NavigationProgressBar`, fluxo assíncrono em `CheckinQueue` e idempotência de filtros. Catraca de fases expandida para 19 fases correntes (83 a 101). |
| **Testes Comportamentais E2E** | [`tests/e2e/f101-reatividade-empirica-e-comportamento.spec.ts`](file:///c:/Users/thiago/Documents/Projetos/star/tests/e2e/f101-reatividade-empirica-e-comportamento.spec.ts) | 3 cenários E2E reais no Chromium validando aparição da barra de progresso no DOM via MutationObserver durante clique em link, fluxo completo de credenciamento e saída com botão desabilitado em trânsito, e idempotência de filtros. |

---

## 2. O Problema Mais Difícil da Fase

O problema mais sutil decorreu da **diferença entre a teoria do DOM nativo e a arquitetura de eventos do React / Next.js**:
1. **O paradoxo do `defaultPrevented`:** No App Router do Next.js, todo componente `<Link>` anexa um listener de clique que chama obrigatoriamente `e.preventDefault()`, pois se não o fizesse o navegador realizaria uma navegação MPA bruta com reload completo. Ao tentar resolver um problema puramente teórico de links cancelados por modais mudando o listener para a fase de borbulhamento com `if (e.defaultPrevented) return;`, o listener passou a ser executado após a delegação do React no `document`, onde `e.defaultPrevented` já era `true` para 100% dos cliques em links do Next.js. A barra global foi silenciada em todo o sistema.
2. **A armadilha do `useActionState` com `useOptimistic`:** O despachante retornado por `useActionState` devolve `void` de forma síncrona. Quando encapsulado em uma função `async handleFormAction(formData) { setOptimistic(...); await formAction(formData); }`, o `await` resolvia em 0ms, finalizando a transição do formulário imediatamente e revertendo o `useOptimistic` antes mesmo de a requisição HTTP sair do navegador.

A solução exigiu provar o comportamento com testes reais em Chromium em vez de apenas asserções textuais sobre código-fonte.

---

## 3. Decisões Técnicas Explicadas

- **Fase de Captura com Guardas Estritas em vez de Borbulhamento com `defaultPrevented`:** A fase de captura (`capture: true`) no `document` intercepta o evento antes que o roteador chame `preventDefault()`. Para evitar disparos indevidos, foram implementadas guardas completas: clique com botão esquerdo primário, sem teclas modificadoras (`meta`, `ctrl`, `shift`, `alt`), sem atributos `download`, destino diferente de `_blank`, esquemas inválidos descartados (`#`, `javascript:`, `mailto:`, `tel:`), exclusão de elementos com `role="button"` ou `data-no-progress`, e verificação de que `targetPath !== currentPath`.
- **Componente Canônico `<AppLink>` via `onNavigate`:** Para novos componentes e locais que desejam controle explícito, o `<AppLink>` utiliza a prop `onNavigate` do Next.js 16, disparada diretamente pelo roteador interno do Next.js apenas quando uma navegação no cliente vai de fato ser iniciada.
- **Transição Assíncrona Nativa (`startTransition(async () => ...))`) no Balcão:** No React 19, `startTransition` aceita funções assíncronas nativamente. Ao executar `setOptimisticInside` e em seguida `await action(...)` dentro da transição, o React mantém a transição pendente (`isPending = true`) durante todo o tempo de espera do servidor, preservando a indicação visual de "Credenciando agora…" e permitindo desabilitar o botão com `disabled={pending || isPending}`.

---

## 4. Decisões Arquiteturais Registradas (ADRs)

### ADR-423: Interceptação Fidedigna de Navegação com Fase de Captura e Componente Canônico AppLink
- **Contexto:** Na FASE 100, a alteração do listener para fase de borbulhamento com checagem de `e.defaultPrevented` silenciou a barra global de progresso para todos os componentes `<Link>` do Next.js 16, pois o roteador invoca `e.preventDefault()` para gerenciar o roteamento no cliente.
- **Decisão:** Retornar o listener de `NavigationProgressBar` para a fase de captura (`true`) protegido por guardas exaustivas (origem, modificadores, role="button", data-no-progress e igualdade de URLs). Disponibilizar o componente canônico `<AppLink>` utilizando a prop `onNavigate` do Next.js 16. Concluir transições com `requestAnimationFrame` sem cascading renders.
- **Justificativa:** Restaura o feedback visual de transição de rota em 100% da aplicação sem exigir refatoração massiva de centenas de tags `<Link>` existentes.
- **Consequências:** Resposta visual imediata e confiável em toda a navegação client-side.

### ADR-424: Transições Assíncronas e useOptimistic Estável no Balcão de Credenciamento
- **Contexto:** A ação do formulário em `CheckinQueue` invocava `await formAction(formData)` sobre o despachante do `useActionState`, que devolve `void`. A transição finalizava no mesmo tick, revertendo o estado otimista antes da resposta do servidor e reabilitando o botão para cliques duplos perigosos.
- **Decisão:** Adotar `startTransition(async () => { ... await action(...) })` com `useOptimistic`, gerenciar o feedback em estado local `state` com `useState` e desabilitar o botão por `pending || isPending`.
- **Justificativa:** O operador do balcão precisa de confirmação tátil contínua durante a latência de rede e não pode correr o risco de submeter uma saída acidental com um segundo clique.
- **Consequências:** Operação segura, sem race conditions e com exibição persistente de erros via `role="alert"`.

### ADR-425: Idempotência de URL em Filtros Reativos do Comitê
- **Contexto:** Submeter o formulário de filtros do comitê com os mesmos parâmetros disparava `startNavigationProgress()`, mas como a rota não sofria alteração (`pathname` e `searchParams` iguais), o efeito de conclusão nunca era acionado, mantendo a barra presa em 80% até o timeout.
- **Decisão:** Em `ComiteFilterBar`, comparar a URL calculada (`targetUrl`) com a URL corrente (`currentUrl`). Se forem idênticas, interromper a execução imediatamente sem iniciar progresso nem transição.
- **Justificativa:** Elimina barras fantasmas e poupa ciclos de renderização desnecessários.
- **Consequências:** Comportamento determinístico e livre de artefatos visuais.

---

## 5. Lições Aprendidas

| # | Sintoma | Causa Raiz | Correção |
|---|---|---|---|
| 1 | A barra de progresso global não aparecia em cliques normais em `<Link>` no app. | No App Router do Next.js, `<Link>` chama `e.preventDefault()` no clique nativo para evitar reload de página; na fase de borbulhamento no `document`, o listener via o evento já cancelado e abortava. | Listener retornado para a fase de captura (`capture: true`) com guardas estritas de link interno, aliado ao componente canônico `<AppLink>` via `onNavigate`. |
| 2 | O indicador otimista "Credenciando agora…" revertia instantaneamente e o botão reabilitava antes da resposta do servidor. | O despachante do `useActionState` devolve `void`. O `await` na função do form resolvia imediatamente, finalizando o ciclo otimista em 0ms. | Ação encapsulada em `startTransition(async () => { ... await action(...) })`, mantendo `isPending` e o estado otimista ativos durante toda a viagem de rede. |
| 3 | Aviso no lint `react-hooks/exhaustive-deps` em `navigation-progress-bar.tsx`. | `startProgress` e `completeProgress` não estavam memorizados com `useCallback` e faltavam nas dependências do `useEffect`. | Memorizadas ambas com `useCallback` e adicionadas às dependências do efeito. |

---

## 6. Evidência de Verificação

### 6.1 Qualidade Estática
- `npm run lint`: 0 erros, 0 warnings.
- `npm run typecheck`: 0 erros.

### 6.2 Testes Unitários e de Integração (Vitest)
- 279 arquivos de teste aprovados, 4.813 testes passando (100%).

### 6.3 Testes E2E (Playwright)
- `tests/e2e/f101-reatividade-empirica-e-comportamento.spec.ts`: 3/3 cenários aprovados em Chromium.
- Total da suíte: 521 testes passando + 1 skip.

---

## 7. Comandos Operacionais

```bash
# Validação de qualidade estática
npm run lint
npm run typecheck

# Execução dos testes unitários da fase
npm test tests/unit/f101-reatividade-empirica-e-testes-comportamentais.test.ts

# Bateria completa de testes e validação de banco
npm test
npm run db:verify
npm run db:verify:isolation

# Validação ponta a ponta com Playwright
npm run test:e2e tests/e2e/f101-reatividade-empirica-e-comportamento.spec.ts
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

1. **Unificação da barra no topo com `RouteProgress`:** O `AppShell` ainda continha o `RouteProgress` da F97 enquanto o `RootLayout` continha o `NavigationProgressBar`, gerando sobreposição visual consolidada na F102.
2. **Uso amplo de `AppLink`:** Criado na F101, o `AppLink` precisava de guarda de rota idêntica e adoção nos componentes de navegação (`NavLink` e `TabNav`), endereçado na F102.
3. **Idiomaticidade do React 19:** O `CheckinQueue` utilizava `startTransition` manual dentro de um handler cliente em vez de `useActionState` direto ligado ao `<form action>`, endereçado na F102.

---

## 9. Checklist de Aceite

- [x] Barra de navegação global intercepta cliques em links internos reais via fase de captura com guardas completas.
- [x] Componente canônico `<AppLink>` criado e exportado em `@/components/ui` com integração `onNavigate`.
- [x] `CheckinQueue` adota transição assíncrona real, mantém o indicador otimista ativo durante a requisição e desabilita o botão contra duplo clique.
- [x] Feedback de erro com `role="alert"` e `text-destructive` persiste na linha em caso de falha de credenciamento.
- [x] `ComiteFilterBar` verifica idempotência de URL antes de ativar a barra de navegação.
- [x] Testes comportamentais E2E reais validando a barra no DOM e o fluxo de credenciamento.
- [x] Bateria completa de verificação (lint, typecheck, vitest, contrato de banco, next build e E2E) aprovada.

