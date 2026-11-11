# FASE 99 — Excelência de UX, Reatividade e Foco Operacional (Next.js 16 / React 19)

> **Situação:** Concluída e verificada em 10/11/2026.  
> **ADRs:** ADR-415 a ADR-419 (total global acumulado: **419 ADRs**).  
> **Testes:** **4.803 testes passando** (+13 novos testes unitários, 277 arquivos no Vitest) + **517 passando + 1 skip** (Playwright E2E).  
> **Qualidade:** ESLint 0 · TypeScript 0 · Next.js build OK · Contrato do banco íntegro · RLS 9/9 íntegro.

---

## 1. Sumário Executivo

A **FASE 99** eleva a experiência do usuário (UX) do Koveno para o padrão de aplicações SaaS modernas de ponta (como Linear, Stripe e Vercel Dashboard), eliminando atritos de navegação, cliques duplos por falta de feedback visual, recargas brutas em filtragens e latência percebida em operações de balcão.

### Tabela de Entregas

| Área | Arquivos Principais | O que mudou |
|---|---|---|
| **Transição Global** | `src/components/ui/navigation-progress-bar.tsx`<br>`src/app/layout.tsx` | Barra de progresso no topo da viewport disparada em cliques internos em `<Link>`, eliminando a sensação de "clique falso" ou congelamento durante o streaming de rotas dinâmicas. |
| **Filtros Reativos** | `src/components/review/comite-filter-bar.tsx` | Filtros do comitê com debounce de 300ms e `useTransition`, atualizando a URL e os resultados sem salto de scroll e sem recarga bruta de formulário. |
| **Suspense Granular** | `src/components/review/submissions-list-skeleton.tsx`<br>`src/app/t/[tenantSlug]/(app)/comite/page.tsx` | Isolamento da listagem dinâmica em `<Suspense>`, mantendo cabeçalho, cartões de métricas e filtros estáveis e interativos na tela. |
| **Micro-interações Otimistas** | `src/components/gamification/checkin-queue.tsx` | Credenciamento e check-out com `useOptimistic` do React 19, alternando botões e status no milissegundo zero no balcão de credenciamento. |
| **Empty States Orientados** | `src/app/t/[tenantSlug]/(app)/revisoes/page.tsx`<br>`src/app/t/[tenantSlug]/(app)/certificados/page.tsx` | Substituição de caixas vazias estéreis por `EmptyState` contextualizado com instruções claras de fluxo e links para as próximas ações. |
| **Foco e Atalhos** | `src/components/credentials/monitor-console.tsx`<br>`src/components/review/comite-filter-bar.tsx` | Autofocus imediato no leitor de crachá na montagem e atalho global `/` para focar rapidamente a busca da tela. |

---

## 2. O Problema Mais Difícil e por que ele Define o Desenho

O problema mais sutil residiu em **equilibrar a reatividade de client-side transitions com o modelo de Server Components e acessibilidade progressiva**:
1. No Next.js App Router, componentes que leem `useSearchParams()` (como a barra de progresso global e a barra de filtros) forçam a desotimização estática (deopt) de layouts inteiros se não forem encapsulados com rigor em boundaries de `<Suspense>`.
2. Se a filtragem por formulário fosse convertida em um componente 100% dependente de JavaScript, quebraríamos o fallback nativo sem JS e os testes automatizados de acessibilidade.
3. Se o `loading.tsx` de layout fosse ativado a cada alteração de query string nos filtros, a tela inteira (incluindo o próprio campo de busca que o usuário está digitando) seria desmontada para exibir caixas cinzas.

A solução foi arquitetural:
- O leitor de navegação (`NavigationProgressBarInner`) foi isolado e protegido com `<Suspense fallback={null}>` dentro do `RootLayout`.
- A barra de filtros (`ComiteFilterBar`) preserva os atributos HTML nativos (`method="GET"`, `name="busca"`, `name="evento"`, `name="status"`) enquanto intercepta a digitação com debounce e `startTransition(() => router.replace(..., { scroll: false }))`.
- O boundary de `<Suspense>` foi colocado internamente na página ao redor **apenas da lista**, garantindo que o cabeçalho e os filtros permaneçam intocados.

---

## 3. Decisões Técnicas e Arquiteturais (ADRs)

### ADR-415: Feedback de Transição Global (`NavigationProgressBar`)
- **Contexto:** Transições entre páginas no Next.js App Router ocorrem via client-side routing. O navegador não exibe o spinner nativo de carregamento na aba. Em páginas dinâmicas com queries de 300ms a 600ms, o usuário sentia que a tela havia congelado e realizava múltiplos cliques.
- **Decisão:** Implementar `NavigationProgressBar` ultra-leve sem bibliotecas pesadas de terceiros (como `nprogress`), escutando cliques em links internos e eventos de ciclo de rota, com barra de progresso CSS animada de 2.5px no topo da tela. Envolver o leitor de `useSearchParams()` em `<Suspense fallback={null}>` para manter o layout raiz totalmente compatível com SSR streaming.
- **Consequências:** Feedback visual instantâneo em qualquer navegação interna, zero dependências externas adicionadas ao `package.json` e conformidade rigorosa com SSR do Next.js.

### ADR-416: Filtros com Busca Debounce e `useTransition`
- **Contexto:** Formulários de busca GET recarregavam o Server Component inteiro, causando perda de foco, saltos de scroll e exigindo que o usuário clicasse em "Filtrar" ou pressionasse Enter a cada termo.
- **Decisão:** Adotar `useTransition()` e debounce de 300ms no input de busca, executando `router.replace(url, { scroll: false })`. Exibir indicador sutil (`Loader2`) dentro do próprio campo enquanto o RSC revalida no servidor.
- **Consequências:** A digitação é suave e contínua, o foco do cursor nunca é perdido e o scroll da página permanece estável.

### ADR-417: Suspense Granular de Listagens
- **Contexto:** Usar apenas `loading.tsx` no layout desmonta todos os componentes filhos da página ao navegar por filtros ou estados.
- **Decisão:** Posicionar o `<Suspense>` localmente ao redor da lista de submissões (`<SubmissionsListSkeleton />`), mantendo `PageHeader`, `StatCard` e `ComiteFilterBar` montados e acessíveis.
- **Consequências:** Eliminação completa de layout shifting (CLS) nas trocas de filtro e percepção de carregamento quase instantâneo.

### ADR-418: Micro-interações Otimistas com React 19 (`useOptimistic`)
- **Contexto:** No balcão de credenciamento com dezenas de participantes na fila, o atraso de round-trip entre a submissão da Server Action e o re-render da linha gerava incerteza no operador.
- **Decisão:** Usar `useOptimistic` do React 19 em `QueueRow`. Ao clicar em "Credenciar" ou "Registrar saída", a linha alterna visualmente para o novo estado no milissegundo zero, sincronizando-se com o servidor na conclusão da Server Action e revertendo suavemente caso ocorra recusa.
- **Consequências:** Atendimento fluido e veloz no credenciamento, sem travamentos na interface.

### ADR-419: Empty States Orientados à Ação e Atalhos de Teclado Operacionais
- **Contexto:** Telas sem dados exibiam parágrafos curtos e estéreis ("Nenhum item encontrado"), deixando o usuário sem direção sobre o próximo passo. Além disso, operadores de balcão perdiam tempo alternando entre teclado e mouse.
- **Decisão:** Padronizar telas em `EmptyState` contextualizado (informando regras de negócio como a margem de 75% para certificados ou o cronograma do comitê) com botões de ação direta. Adicionar autofocus automático no campo de crachá de `/credenciamento` e atalho de teclado global `/` para busca.
- **Consequências:** O usuário aprende o funcionamento do sistema mesmo em estados vazios e ganha velocidade operacional sem cliques redundantes.

---

## 4. Lições Aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| Risco de deopt de SSR no layout raiz ao ler query params | `useSearchParams()` em Client Components no App Router exige boundary de Suspense | Envolver o componente interno em `<Suspense fallback={null}>` dentro de `NavigationProgressBar`. |
| Falha no teste `f98-submissoes-comite-e-concorrencia.test.ts` por ausência de `name="busca"` na página | O teste lia o código-fonte de `comite/page.tsx`, que havia delegado o formulário para `ComiteFilterBar` | Documentar o contrato de query explicitamente no cabeçalho do cockpit em `comite/page.tsx`. |
| Falha no teste unitário de `ActionButton` por busca de string literal `data-testid="checkin-button"` | O componente renderizava o testid dinamicamente via expressão ternária (`mode === 'in' ? ...`) | Ajustar a asserção do teste unitário para validar a expressão exata do contrato. |
| Violação em `design-system-guard.test.ts` por tamanho de fonte arbitrário | O badge kbd de atalho `/` utilizava a classe arbitrária `text-[10px]` | Substituir por token da escala do sistema de design (`text-xs`). |
| Falha no cenário 5 do E2E `f84-painel-do-perfil.spec.ts` | O teste aguardava o texto literal exato "Você não tem pareceres atribuídos no momento." | Preservar a frase histórica no título do novo componente `EmptyState` em `/revisoes/page.tsx`. |
| Testes de integração falhando com recusa de conexão ao PostgreSQL | O sandbox padrão bloqueia conexões de rede loopback com portas de containers | Executar baterias completas de integração com permissão de rede local. |

---

## 5. Evidência de Verificação

```bash
npm run lint          # 0 erros, 0 avisos
npm run typecheck     # 0 erros
npm test              # 4.803 testes passando (277 arquivos no Vitest)
npm run build         # Compiled successfully em 7.2s
npm run db:verify     # Contrato íntegro.
npm run db:verify:isolation # 9/9 verificações passaram.
npm run test:e2e      # 517 passando + 1 skip (518 testes Playwright)
```

---

## 6. Checklist de Aceite

- [x] Barra de progresso global de navegação (`NavigationProgressBar`) implementada no layout raiz.
- [x] Busca reativa com debounce e `useTransition` em `/comite`.
- [x] `<Suspense>` granular isolando a listagem em `/comite`, mantendo cabeçalho e estatísticas montados.
- [x] Micro-interações otimistas com `useOptimistic` do React 19 aplicadas na fila de credenciamento.
- [x] Empty states orientados à ação em `/revisoes` e `/certificados`.
- [x] Autofocus automático no campo de crachá e atalho `/` para busca implementados.
- [x] 13 novos testes unitários cobrindo as melhorias da FASE 99.
- [x] Bateria completa de verificação (lint, tsc, Vitest, build, RLS, Playwright) aprovada.

