# FASE 102 — Consolidação de Progresso Global, Check-in Idiomático React 19 e Filtros Operacionais Reativos

> **Status:** Entregue  
> **Data:** 11/11/2026  
> **Tema:** Consolidação da experiência de navegação global, unificação de link canônico (`AppLink`), acessibilidade semântica de rota (`RouteProgress`), check-in 100% idiomático no React 19 com `useActionState` e rollback seguro, e filtros operacionais reativos de alta densidade no balcão e participantes.

---

## 1. Sumário Executivo

A FASE 102 consolida as melhorias de UX e reatividade iniciadas nas Fases 99 a 101, eliminando duplicações arquiteturais, simplificando o modelo mental de formulários assíncronos no React 19 e estendendo a experiência de filtros instantâneos com debounce e atalhos de teclado para o balcão de credenciamento e o diretório de participantes.

| Entrega | Arquivos | Resumo |
|---|---|---|
| **Link Canônico e Proteção de Rota** | [`src/components/ui/app-link.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/ui/app-link.tsx)<br>[`src/components/ui/navigation.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/ui/navigation.tsx) | **ADR-426:** `<AppLink>` recebe guarda contra navegação para a mesma URL (`targetPath !== currentPath && url.origin === window.location.origin`), impedindo disparos desnecessários de barra de progresso. Adoção imediata em `NavLink` e `TabNav`. |
| **Acessibilidade Semântica de Rota** | [`src/components/shell/route-progress.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/shell/route-progress.tsx) | **ADR-426:** Remoção da barra de progresso visual duplicada de `RouteProgress`, unificando a apresentação visual em `NavigationProgressBar`. `RouteProgress` é mantido como âncora semântica de acessibilidade (`sr-only`) com `role="status"`, `aria-live="polite"` e suporte a eventos globais (`KOVENO_NAVIGATION_START_EVENT` e `KOVENO_NAVIGATION_STOP_EVENT`). |
| **Check-in 100% Idiomático no React 19** | [`src/components/gamification/checkin-queue.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/gamification/checkin-queue.tsx) | **ADR-427:** Refatoração de `QueueRow` para utilizar `useActionState` de forma direta e idiomática conectado ao `<form action={formAction}>`, disparando a atualização otimista `setOptimisticInside` de forma síncrona dentro da transição do formulário. Bloqueio estrito via `disabled={busy}` (`pending || isPending`), com rollback automático do React 19 e persistência de mensagens de erro com `role="alert"`. |
| **Transição Cirúrgica no Comitê** | [`src/app/t/[tenantSlug]/(app)/comite/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/comite/page.tsx) | **ADR-428:** Remoção de `key={filterKey}` da casca do `<Suspense>`, posicionando-o diretamente no componente de resultados `<ComiteResults>`. Isso preserva os filtros e o cabeçalho interativos e estáveis durante a transição do Next.js sem flash do esqueleto completo. |
| **Filtros Operacionais no Balcão** | [`src/components/credentials/checkin-filter-bar.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/credentials/checkin-filter-bar.tsx)<br>[`src/app/t/[tenantSlug]/(app)/credenciamento/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/credenciamento/page.tsx) | **ADR-428:** Criação de `CheckinEventFilter` e `CheckinSearchFilter` com submissão automática via `useTransition`, debounce de 300ms na digitação, tecla de atalho `/` para foco imediato, `Escape` para limpar e preservação do botão de submissão para SSR/No-JS. |
| **Filtros Operacionais em Participantes** | [`src/components/participants/participant-filter-bar.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/participants/participant-filter-bar.tsx)<br>[`src/app/t/[tenantSlug]/(app)/participantes/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/participantes/page.tsx) | **ADR-428:** Criação de `ParticipantFilterBar` unificando busca textual, seleção de evento, filtros rápidos de certificado e presença com sincronização bidirecional, debounce e atalhos operacionais. |
| **Testes e Governança** | [`tests/unit/f102-progresso-unificado-checkin-idiomatico-e-filtros-operacionais.test.ts`](file:///c:/Users/thiago/Documents/Projetos/star/tests/unit/f102-progresso-unificado-checkin-idiomatico-e-filtros-operacionais.test.ts)<br>[`tests/e2e/f102-progresso-unificado-e-filtros-operacionais.spec.ts`](file:///c:/Users/thiago/Documents/Projetos/star/tests/e2e/f102-progresso-unificado-e-filtros-operacionais.spec.ts) | 7 testes unitários novos (totalizando 4.820 testes passando na suíte Vitest) e 3 cenários E2E cobrindo unificação visual de progresso, `useActionState` no credenciamento e filtros operacionais reativos. |

---

## 2. O Problema Mais Difícil da Fase

O desafio central desta fase residiu em **equilibrar a pureza idiomática do React 19 com as exigências de tempo real e tolerância a falhas em operações de alta densidade no balcão**:

1. **A tentação de sobreposições manuais:** Em versões anteriores, para garantir que o botão ficasse desabilitado durante a requisição assíncrona, havia sido criado um despachante customizado com `useState` e `startTransition(async () => ...)` manual fora do `useActionState`. Embora funcional, essa abordagem contornava o modelo mental canônico do React 19 e gerava estados redundantes. O desafio foi reconectar o formulário diretamente ao `useActionState` (`<form action={formAction}>`), acoplando `setOptimisticInside` de maneira síncrona dentro do ciclo da transição e utilizando simultaneamente `isPending` e `useFormStatus().pending` para garantir imunidade absoluta a cliques repetidos durante latência de rede.
2. **Duplicidade oculta de indicadores visuais de rota:** Existiam dois componentes concorrentes gerenciando progresso de tela: `NavigationProgressBar` (no topo da tela, acionado por cliques globais e eventos customizados) e `RouteProgress` (no shell da aplicação, renderizando uma barra azul redundante). Essa duplicação causava descompassos visuais e comportamentais. A solução elegante foi transformar `RouteProgress` em uma âncora puramente semântica e de acessibilidade (`sr-only`), ouvindo os mesmos eventos globais e informando tecnologias assistivas via `aria-live="polite"`.

---

## 3. Decisões Técnicas Explicadas

- **Adoção do `AppLink` em Componentes de Navegação do Shell:** `NavLink` e `TabNav` foram migrados para utilizar `AppLink`. Com isso, todas as transições de abas e menus secundários passam pela proteção de igualdade de URL (`targetPath !== currentPath`) e acionam o feedback suave de transição de rota de maneira uniforme.
- **Sincronização de Estado na Fase de Render em Filtros Reativos:** Para atender às diretrizes estritas do React 19 e do ESLint (`react-hooks/set-state-in-effect`), os componentes de filtro (`CheckinSearchFilter`, `ParticipantFilterBar`, `RouteProgress`) sincronizam mudanças vindas das props durante a fase de render (`if (prevProp !== prop) { setPrev(prop); setState(prop); }`), eliminando chamadas síncronas a `setState` em efeitos colaterais.
- **Isolamento de Suspense em Resultados (`<ComiteResults key={...}>`):** Na página de comitê, mover o `key={filterKey}` da fronteira `<Suspense>` para dentro do componente filho `<ComiteResults>` garante que o React mantenha os filtros e o cabeçalho interativos e montados durante a transição com `useTransition`, evitando que a página inteira pisque em branco ou exiba o esqueleto do topo.
- **Filtros Operacionais Acessíveis com SSR Fallback:** Tanto o filtro do balcão de credenciamento quanto o de participantes mantêm formulários com botões de submissão normais (marcados com classes utilitárias acessíveis e estilizadas) para garantir que ambientes sem JavaScript continuem funcionais. Nos navegadores modernos, a digitação é interceptada com debounce e os seletores disparam a transição de rota automaticamente via `useTransition`.

---

## 4. Decisões Arquiteturais Registradas (ADRs)

### ADR-426: Unificação do Progresso de Navegação e Adoção Canônica do AppLink
- **Contexto:** Havia concorrência visual entre `NavigationProgressBar` (global) e `RouteProgress` (shell), além do risco de cliques em links apontando para a página atual dispararem a barra sem que uma navegação ocorresse.
- **Decisão:** Inserir guarda de URL em `AppLink` (`targetPath !== currentPath && url.origin === window.location.origin`) e adotá-lo em `NavLink` e `TabNav`. Converter `RouteProgress` em um componente semântico exclusivamente voltado para leitores de tela (`sr-only`), mantendo a barra visual de progresso sob governança exclusiva de `NavigationProgressBar`.
- **Justificativa:** Centraliza o controle visual em um único componente e assegura suporte de primeira classe à acessibilidade sem duplicar elementos no DOM.
- **Consequências:** Fim de conflitos visuais e feedback auditivo confiável para navegação assistiva.

### ADR-427: Fila de Check-in 100% Idiomática no React 19 com useActionState e Rollback Seguro
- **Contexto:** A fila rápida de credenciamento no balcão demandava atualização otimista imediata, prevenção contra submissões simultâneas e exibição confiável de erros de validação/rede, sem violar as convenções do React 19.
- **Decisão:** Integrar o `useActionState` nativamente ao `<form action={formAction}>`, disparando a mutação otimista de forma síncrona dentro da transição do formulário. Desabilitar a interação quando qualquer indicador de pendência estiver ativo (`pending || isPending`), aproveitando o rollback automático do React 19 e sinalizando mensagens de retorno através de `<p role={state.ok ? 'status' : 'alert'}>`.
- **Justificativa:** Alinha o código ao estado da arte do React 19, reduz complexidade e garante tolerância estrita a falhas operacionais em campo.
- **Consequências:** Código limpo, manutenível e robusto contra condições de corrida no balcão.

### ADR-428: Filtros Operacionais Reativos com useTransition, Debounce e Suspense Cirúrgico
- **Contexto:** As páginas de credenciamento e participantes exigiam recargas manuais ou submissões explícitas de formulário, contrastando com a agilidade introduzida no comitê. Adicionalmente, a fronteira de Suspense no comitê provocava flash desnecessário de casca.
- **Decisão:** Mover `key={filterKey}` da casca do `<Suspense>` diretamente para `<ComiteResults>`. Implementar `CheckinEventFilter`, `CheckinSearchFilter` e `ParticipantFilterBar` com submissão automatizada via `useTransition`, debounce de 300ms, teclas de atalho de foco e limpeza (`/` e `Escape`) e preservação de capacidade No-JS.
- **Justificativa:** Proporciona experiência fluida e veloz para operadores com grandes volumes de participantes e credenciais.
- **Consequências:** Operação de balcão e gestão de participantes mais ágil e sem quebra de contexto visual.

---

## 5. Lições Aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| Erro de compilação TS `TS2322: Type 'string \| null' is not assignable to type 'string \| undefined'` em `CheckinEventFilter` | A rota `credenciamento/page.tsx` passava `selectedEventId` como `string \| null`, mas a interface do componente aceitava apenas `string \| undefined`. | Alinhada a interface para aceitar `string \| null \| undefined`. |
| Falha no ESLint `react-hooks/set-state-in-effect` em `route-progress.tsx` e `checkin-filter-bar.tsx` | Sincronização de props via `useEffect` chamando `setState` diretamente, violando as regras estritas do React 19 contra renderizações em cascata. | Adotada a técnica de reconciliação de estado na fase de render (`const [prev, setPrev] = useState(prop); if (prev !== prop) { ... }`) e `useCallback` nos manipuladores de busca. |
| Testes de integração `f75` e `f89` falhando com `No "useRouter" export is defined on the "next/navigation" mock` | Os testes mockavam `next/navigation` apenas parcialmente; ao adotar `AppLink` em `NavLink`, componentes de navegação passaram a acessar `useRouter()`. | Adicionados mocks completos de `useRouter`, `useSearchParams` e `usePathname` nas suítes de integração afetadas. |

---

## 6. Evidência de Verificação

### 6.1 Testes Unitários e Integração (Vitest)
```bash
npm test
# Saída real:
# Test Files  280 passed (280)
#      Tests  4820 passed (4820)
#   Duration  266.40s
```

### 6.2 Testes Unitários FASE 102
```bash
npx vitest run tests/unit/f102-progresso-unificado-checkin-idiomatico-e-filtros-operacionais.test.ts
# Saída real:
# ✓ tests/unit/f102-progresso-unificado-checkin-idiomatico-e-filtros-operacionais.test.ts (7 tests)
# Tests: 7 passed (7)
```

### 6.3 Qualidade Estática
```bash
npm run typecheck   # 0 erros
npm run lint        # 0 erros, 0 warnings
```

---

## 7. Comandos Operacionais

```bash
# Rodar testes unitários e de integração
npm test

# Rodar especificamente os testes da F102
npx vitest run tests/unit/f102-progresso-unificado-checkin-idiomatico-e-filtros-operacionais.test.ts

# Validação estática
npm run typecheck
npm run lint

# Build de produção
npm run build

# Validação do contrato do banco de dados e isolamento
npm run db:verify
npm run db:verify:isolation
npm run db:partitions

# Testes ponta a ponta E2E
npm run test:e2e tests/e2e/f102-progresso-unificado-e-filtros-operacionais.spec.ts
```

---

## 8. Dívidas Técnicas

- **Dívida F102-1:** Estender gradualmente o `<AppLink>` para os blocos da página pública e formulários de submissão que ainda utilizam `<Link>` padrão do Next.js.
- **Dívida F102-2:** Avaliar a unificação dos hooks de debounce em um helper compartilhado (`useDebouncedCallback`) entre os módulos de comitê, balcão e participantes.

---

## 9. Checklist de Aceite

- [x] `<AppLink>` possui guarda estrita contra navegação para mesma URL (`targetPath !== currentPath`).
- [x] `NavLink` e `TabNav` integrados com `<AppLink>`.
- [x] `RouteProgress` convertido em âncora de acessibilidade semântica (`sr-only`), eliminando duplicidade visual.
- [x] `QueueRow` refatorado para uso idiomático de `useActionState` com rollback seguro no React 19.
- [x] `key={filterKey}` realocado da casca do `<Suspense>` para `<ComiteResults>`.
- [x] Filtros operacionais implementados no balcão de credenciamento (`CheckinEventFilter`, `CheckinSearchFilter`).
- [x] Filtros operacionais implementados no diretório de participantes (`ParticipantFilterBar`).
- [x] Atalhos de teclado (`/` para focar, `Escape` para limpar) disponíveis nos filtros.
- [x] Testes unitários cobrindo todos os novos comportamentos criados e passando (7 novos testes, total 4.820).
- [x] Testes E2E cobrindo a suíte da FASE 102 criados.
- [x] `npm run typecheck` e `npm run lint` limpos (0 erros, 0 warnings).

