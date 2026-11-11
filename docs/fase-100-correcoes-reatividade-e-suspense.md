# FASE 100 — Correções Críticas de Reatividade, Suspense Cirúrgico e Comportamento Operacional (Next.js 16 / React 19)

## 1. Sumário Executivo

A **FASE 100** consolida correções arquiteturais profundas de reatividade e streaming, sanando três inconsistências estruturais identificadas na auditoria crítica da FASE 99:

1. **Suspense Cirúrgico e Streaming Real no Comitê Científico (`/comite` — ADR-420)**:
   - Na FASE 98/99, a página executava um `await withTenant` antes de retornar qualquer JSX no Server Component `ComitePage`. Como resultado, o boundary `<Suspense fallback={<SubmissionsListSkeleton />}>` nunca entrava em estado de espera, bloqueando o Time to First Byte (TTFB) de todo o shell.
   - A página agora entrega o cabeçalho e os seletores da `ComiteFilterBar` no fluxo imediato, delegando a consulta de submissões e o cálculo de métricas agregadas ao Server Component assíncrono `ComiteResults`.
   - O `<SubmissionsListSkeleton />` agora simula tanto os 3 cartões de métricas quanto a listagem de artigos com `data-testid="submissions-skeleton"`, permitindo streaming contínuo via RSC sem layout shift (CLS).
2. **Tratamento Unificado de Erros no Balcão com `useOptimistic` e `useActionState` (ADR-421)**:
   - Em `checkin-queue.tsx`, a separação entre dois `useActionState` independentes (`inState` e `outState`) chaveados pelo booleano otimista fazia com que, ao ocorrer uma falha na Server Action (ex.: atividade lotada ou QR inválido), o rollback automático de `optimisticInside` revertesse a visualização para o estado alternativo (vazio), ocultando a mensagem de erro do operador.
   - O despachante foi unificado em um único `useActionState`, preservando o resultado da Server Action independentemente do rollback otimista, mantendo `role="alert"` e exibição persistente no balcão.
3. **Barra de Progresso Global Resiliente e Filtros com Debounce Seguro (ADR-422)**:
   - `NavigationProgressBar` migrou o interceptador de cliques para a fase de borbulhamento (bubble phase, não capture), respeitando fielmente `e.defaultPrevented` e evitando que links interceptados travassem a barra por 8 segundos.
   - Implementado suporte nativo a navegações programáticas via `startNavigationProgress()`, disparado na transição de filtros em `ComiteFilterBar`.
   - `ComiteFilterBar` agora sincroniza valores em `latestFiltersRef` para evitar closures desatualizadas no debounce de 300ms, limpa o campo e a query com a tecla `Escape`, protege o atalho `/` contra interceptação em `isContentEditable` e anuncia atualizações a tecnologias assistivas via `aria-live="polite"`.
   - Ambas as interfaces receberam classes `motion-reduce` para conformidade estrita com acessibilidade.

| Entregável | Arquivo(s) Principal(is) | Situação |
|---|---|---|
| Desacoplamento da busca de submissões sob Suspense real | `src/app/t/[tenantSlug]/(app)/comite/page.tsx` | ✅ |
| Skeleton com suporte a métricas e listagem | `src/components/review/submissions-list-skeleton.tsx` | ✅ |
| Unificação de despachante em `CheckinQueue` com persistência de erro | `src/components/gamification/checkin-queue.tsx` | ✅ |
| Borbulhamento, navegação programática e `motion-reduce` na barra | `src/components/ui/navigation-progress-bar.tsx` | ✅ |
| Debounce seguro com refs, limpeza com `Esc` e acessibilidade em filtros | `src/components/review/comite-filter-bar.tsx` | ✅ |
| Reexportação de helpers no sistema de UI | `src/components/ui/index.ts` | ✅ |
| Bateria de testes unitários da FASE 100 | `tests/unit/f100-correcoes-reatividade-e-suspense.test.ts` | ✅ |
| Bateria de testes E2E da FASE 100 com Playwright | `tests/e2e/f100-ux-reatividade-e-comportamento.spec.ts` | ✅ |

---

## 2. O Problema Mais Difícil da Fase

### Como viabilizar o streaming sob Suspense sem duplicar conexões desnecessárias no banco nem violar a integridade multi-tenant RLS

No Next.js 16 com App Router, se um Server Component de nível de rota (`page.tsx`) aguarda uma promessa pesada no topo de sua função antes de retornar o JSX, o motor de streaming HTTP não consegue enviar os primeiros bytes (o shell estático) para o navegador. Em fases anteriores, para evitar múltiplas transações com o pooler (PgBouncer), as consultas de eventos e submissões foram agregadas em um único `withTenant` dentro da `ComitePage`.

Isso gerava um paradoxo: para entregar o esqueleto de carregamento com `<Suspense>`, a promessa precisava ser adiada, mas separar as consultas poderia abrir transações adicionais sem isolamento coordenado.

A solução da FASE 100 consistiu em:
1. Executar a consulta leve de eventos (necessária para que o organizador veja imediatamente os nomes dos eventos no `<select>`) no shell da página com `withTenant`.
2. Encapsular a consulta analítica de submissões (`listSubmissionsForChair`) e o cálculo de quórum dentro de um componente assíncrono dedicado (`ComiteResults`), envolvido por `<Suspense key={filterKey} fallback={<SubmissionsListSkeleton />}>`.
3. Dessa forma, o shell (título, navegação, filtros e controles) chega instantaneamente ao cliente com HTTP 200 e streaming aberto, enquanto a lista e os cartões de métricas chegam no segundo chunk via RSC streaming sem travar o navegador.

---

## 3. Decisões de Arquitetura (ADRs)

### ADR-420: Desacoplamento da Renderização de `/comite` com Suspense e Streaming Real
- **Contexto:** `comite/page.tsx` executava `await withTenant` antes de retornar qualquer nó JSX, inutilizando o boundary `<Suspense fallback={<SubmissionsListSkeleton />}>` introduzido na FASE 99.
- **Decisão:** Separar a página em um shell imediato (`ComitePage`) e um boundary assíncrono (`ComiteResults`). `ComitePage` obtém os eventos e renderiza os filtros. `ComiteResults` executa a consulta analítica de submissões sob `withTenant`. `SubmissionsListSkeleton` cobre tanto as métricas quanto a listagem de trabalhos.
- **Justificativa:** Restaura o comportamento esperado do React 19 e App Router do Next.js 16, fornecendo resposta imediata ao usuário e esqueleto visual consistente durante carregamento e filtragem.
- **Consequências:** Navegação sem bloqueios perceptíveis e eliminação de Content Layout Shift (CLS).

### ADR-421: Despachante Unificado de Ações com `useOptimistic` e `useActionState` no Balcão
- **Contexto:** `QueueRow` chaveava entre dois `useActionState` (`inState` e `outState`) com base no valor de `optimisticInside`. Quando a ação falhava no servidor, o rollback revertia o valor booleano, fazendo a tela ler o estado da ação oposta (que estava nula) e engolindo a mensagem de erro (ex.: "Atividade lotada").
- **Decisão:** Unificar a ação em um único `useActionState`, passando o modo pretendido via FormData. O estado de retorno da Server Action persiste no componente e é exibido diretamente abaixo da linha com `role="alert"` e `text-destructive`.
- **Justificativa:** No balcão de eventos de alta cadência, erros de credenciamento nunca podem falhar em silêncio. O operador precisa de feedback explícito imediato.
- **Consequências:** Operação segura no balcão e recuperação tátil em casos de inconsistência ou lotação.

### ADR-422: Interceptador de Borbulhamento, Navegação Programática e Debounce Resiliente
- **Contexto:** `NavigationProgressBar` escutava cliques na fase de captura (`true`), desconsiderando `e.defaultPrevented` de links que cancelavam a navegação. Além disso, filtros executados por código (`router.replace`) não ativavam a barra. Em `ComiteFilterBar`, o timer de 300ms de debounce lia valores de closure que poderiam estar defasados.
- **Decisão:** Alterar o listener para a fase de borbulhamento (`false`), expor `startNavigationProgress()` via evento global `koveno:navigation-start` e utilizá-lo nas transições de filtro. Em `ComiteFilterBar`, adotar `latestFiltersRef` para leitura fresca, tecla `Escape` para limpeza real de busca e proteção de atalho em elementos `isContentEditable`.
- **Justificativa:** Elimina barras presas na tela e garante sincronização atômica entre digitação rápida e dropdowns.
- **Consequências:** UX consistente e sem comportamentos fantasmas em conexões lentas ou operações rápidas de teclado.

---

## 4. Lições Aprendidas

| # | Sintoma | Causa Raiz | Correção |
|---|---|---|---|
| 1 | Erro no teste unitário `f99-ux-reatividade-e-foco-operacional.test.ts` ao conferir exportações de `src/components/ui/index.ts`. | O teste realizava asserção exata por linha contínua `"export { NavigationProgressBar } from './navigation-progress-bar';"` e a quebra em múltiplas linhas quebrou o matching. | Mantida a linha de exportação individual de `NavigationProgressBar` idêntica ao esperado e adicionada linha contínua para os novos helpers. |
| 2 | Barra de progresso global ficava ativa por 8 segundos em links interceptados por diálogos modais. | O listener em `NavigationProgressBar` escutava na fase de captura (`capture: true`), executando antes dos handlers dos componentes filhos que invocavam `e.preventDefault()`. | Mudado o listener para a fase de borbulhamento (`capture: false`), garantindo que `if (e.defaultPrevented) return;` funcione de forma determinística. |
| 3 | Ao credenciar uma inscrição em atividade lotada, o botão revertia sem exibir o alerta de erro. | `QueueRow` selecionava dinamicamente entre `inState` e `outState` baseado em `optimisticInside`. Ao reverter para `false`, passava a ler `outState` que estava nulo. | Unificado o hook em um único `useActionState` com despachante condicional interno, mantendo o erro retornado visível na linha. |

---

## 5. Evidência de Verificação

### 5.1 Lint e Tipagem
- `npm run lint`: 0 erros, 0 warnings.
- `npm run typecheck`: 0 erros.

### 5.2 Bateria de Testes Vitest
- Todos os testes unitários e de integração passaram com sucesso:
  - `tests/unit/f100-correcoes-reatividade-e-suspense.test.ts`: 5/5 passando.
  - `tests/unit/f99-ux-reatividade-e-foco-operacional.test.ts`: 13/13 passando.
  - `tests/unit/f98-submissoes-comite-e-concorrencia.test.ts`: 11/11 passando.
  - `tests/unit/f79-fases-no-arquivo-certo.test.ts`: 5/5 passando.
  - `tests/unit/design-system-guard.test.ts`: 5/5 passando.

---

## 6. Checklist de Aceite

- [x] O boundary `<Suspense fallback={<SubmissionsListSkeleton />}>` em `/comite` envolve componente assíncrono real (`ComiteResults`), viabilizando streaming e exibição do esqueleto.
- [x] `SubmissionsListSkeleton` cobre tanto os 3 cards de métricas quanto os itens da lista, respeitando `motion-reduce:animate-none`.
- [x] `CheckinQueue` unifica o despachante em um único `useActionState`, preservando a mensagem de erro (role="alert") após o rollback do `useOptimistic`.
- [x] `NavigationProgressBar` escuta na fase de borbulhamento, respeita `defaultPrevented`, exporta `startNavigationProgress()` e respeita `motion-reduce`.
- [x] `ComiteFilterBar` utiliza `latestFiltersRef` para leitura fresca no debounce, limpa a busca com a tecla `Escape`, não intercepta `isContentEditable` e avisa leitores de tela via `aria-live="polite"`.
- [x] Bateria de testes unitários e E2E cobrindo todas as correções.

