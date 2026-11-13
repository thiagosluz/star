# FASE 107 — Fechamento de Preservação de Estado, `pending` em Diálogos, `AppLink` Canônico, `popstate` e Alinhamento de Filtros

> **Data:** 2026-11-13 · **Situação:** entregue · **ADRs desta fase:** ADR-439 … ADR-441

---

## 1. Sumário Executivo

Esta fase fecha as últimas pontas soltas de experiência de usuário, resiliência de formulários e navegação no ecossistema React 19 / Next.js App Router:

| Frente entregue | Onde foi aplicada | Resultado direto |
|---|---|---|
| **Preservação de estado em formulários críticos** (`ADR-439`) | `AdminForm`, `MessageComposer`, `SpeakerProfileForm`, `SpeakerNotesForm`, `ProposalAcceptancePanel`, `RegistrationForm`, `ShareCardPanel`, `AuthForm` | Retornos `{ ok: false }` preservam campos preenchidos sem o reset nativo do React 19, preservando também o HTML `$ACTION_*` para submissão sem JavaScript |
| **Interceptação de `popstate` (botão Voltar)** (`ADR-440`) | `src/hooks/use-unsaved-changes.ts`, `src/components/ui/unsaved-changes-dialog.tsx` | Pressionar Voltar no navegador com rascunho não salvo abre `<UnsavedChangesDialog />` do sistema antes do App Router trocar de rota |
| **Bloqueio de duplo clique (`pending`) em diálogos e botões** (`ADR-441`) | `InlineActionForm`, `AcceptPromotionButton`, `CancelRegistrationButton`, `DeleteDraftButton`, `WithdrawSubmissionButton`, `StageLinkPanel`, `AdminSpeakerPanel`, `AccountForms`, `CampaignSendForm` | Botões críticos e de confirmação ficam desabilitados com rótulo de progresso até o fim da transição/action |
| **Migração canônica de `<AppLink>` + catraca AST** (`ADR-441`) | `ProposalForm`, `AreaError` e demais componentes `'use client'` + `tests/unit/f107-ux-formularios-transicoes-e-popstate.test.ts` | Zero componentes cliente importam `next/link` diretamente fora de `src/components/ui/app-link.tsx` |
| **Paridade operacional em filtros** (`ADR-441`) | `ParticipantFilterBar` | `aria-live="polite"` silencioso antes da primeira interação, guarda `isContentEditable` no `/`, botão `(×)` e cancelamento de debounce em `Escape`/unmount |

**Números da fase:**
- **Arquivos de produção modificados:** **21**
- **Novos arquivos de teste:** **2** ([`tests/unit/f107-ux-formularios-transicoes-e-popstate.test.ts`](../tests/unit/f107-ux-formularios-transicoes-e-popstate.test.ts) com **7** testes + [`tests/e2e/f107-ux-formularios-transicoes-e-popstate.spec.ts`](../tests/e2e/f107-ux-formularios-transicoes-e-popstate.spec.ts) com **3** cenários E2E)
- **Migrações de banco:** **0**
- **Dívidas técnicas:** **44** mantidas (`docs/dividas-tecnicas.md`)

---

## 2. O Problema Mais Difícil da Fase

Dois comportamentos específicos do navegador e do React 19 / Next.js interagiam contra o esperado:

1. **Ordem de execução de `popstate` no Chromium (`target === currentTarget`):** no objeto `window`, o Chromium executa ouvintes `popstate` na ordem de registro ignorando `{ capture: true }` quando o alvo já está em `AT_TARGET`. Como `<AppRouter>` registra seu próprio ouvinte no `useEffect` de montagem, um ouvinte registrado depois em outro `useEffect` (mesmo com `capture: true`) rodava **tarde demais** — o Next.js já tinha iniciado a navegação de volta antes de `stopImmediatePropagation()`. A solução foi instalar **um único interceptador global** (`ensurePopstateInterceptor()`) na avaliação do módulo `src/hooks/use-unsaved-changes.ts` (carregado pelo `RootLayout` via `<UnsavedChangesDialog />`), garantindo registro anterior ao efeito do roteador.
2. **Wrapper `async` em `useActionState` anula progressive enhancement sem JavaScript:** envolver a prop `action` de uma Server Action em `async (prev, fd) => { const res = await action(prev, fd); ... }` dentro de `useActionState` impede o Next.js SSR de reconhecer a referência de Server Action e emitir os campos ocultos `$ACTION_*`. Sem JS (`javaScriptEnabled: false`), `<AdminForm>` parava de gravar (`f70` caso 3 e `rubric-criteria` casos 2–4). Passar `action` **diretamente** para `useActionState(action, null)` e sincronizar o estado no render (`if (state?.ok && state !== lastSavedState)`) resolveu os dois mundos: 100% funcional sem JS e sem perda de rascunho em `{ ok: false }` com JS.

---

## 3. Decisões Técnicas Explicadas

- **Interceptação via `onSubmit` no `AdminForm` mantendo `useActionState(action, null)` direto:** em JavaScript ativo, `handleSubmit` intercepta o envio nativo para evitar que o React 19 limpe os inputs não controlados após retorno `{ ok: false }`, disparando `startTransition(() => formAction(new FormData(event.currentTarget)))`. Sem JavaScript, o `<form action={formAction}>` envia nativamente com os campos `$ACTION_*` preservados.
- **Sincronização de `dirty` e campos limpos em render (sem `setState` em `useEffect`):** comparar `state !== lastSavedState` (ou `lastClearedState` / `lastSyncedState`) evita tanto o wrapper `async` no `useActionState` quanto violações das regras do React Compiler para `setState` dentro de `useEffect`.
- **Guarda unificada por referência de estado ativa (`activePopstateGuard`):** em vez de adicionar/remover múltiplos listeners em `window`, o despachante único lê `activePopstateGuard` (atualizado pelo `useEffect` de `useUnsavedChanges`), restaura a URL com `window.history.pushState` quando necessário e dispara `koveno:unsaved-leave-request` com `mode: 'history-back'`.
- **Catraca AST/textual no Vitest para `<AppLink>`:** em vez de depender só de revisão manual, `tests/unit/f107-ux-formularios-transicoes-e-popstate.test.ts` varre todos os componentes `'use client'` de `src/` e reprova qualquer import direto de `next/link` fora de `src/components/ui/app-link.tsx`.

---

## 4. ADRs da Fase

### ADR-439 — Preservação de estado pós-erro `{ ok: false }` com progressive enhancement intacto
- **Contexto:** `AdminForm`, `MessageComposer`, `SpeakerProfileForm`, `SpeakerNotesForm`, `ProposalAcceptancePanel`, `RegistrationForm`, `ShareCardPanel` e `AuthForm` ainda sofriam reset automático do React 19 em erro de validação ou não rastreavam alterações não salvas.
- **Decisão:** passar a Server Action diretamente a `useActionState(action, null)` para preservar `$ACTION_*` no HTML SSR; interceptar o `onSubmit` no cliente em formulários não controlados (`AdminForm`) e controlar/sincronizar valores em formulários de texto crítico (`MessageComposer`, `SpeakerProfileForm`, `SpeakerNotesForm`, `ProposalAcceptancePanel`, `RegistrationForm`).
- **Consequências:** Zero perda de dados em validações `{ ok: false }`, UX consistente com rascunhos protegidos e submissão 100% íntegra quando JavaScript está desabilitado.

### ADR-440 — Interceptador determinístico de `popstate` em módulo para `useUnsavedChanges`
- **Contexto:** Clicar no botão Voltar do navegador enquanto um formulário tinha `dirty === true` burlava o modal do sistema porque o `useEffect` do `AppRouter` registrava seu ouvinte `popstate` antes dos efeitos de página, e o Chromium não prioriza `capture: true` quando `target === currentTarget` (`window`).
- **Decisão:** instalar `ensurePopstateInterceptor()` na avaliação de módulo de `src/hooks/use-unsaved-changes.ts` (importado pelo `<UnsavedChangesDialog />` do `RootLayout`), gerenciando `activePopstateGuard` e liberando a volta via `allowNextPopstate()` após confirmação no diálogo do sistema.
- **Consequências:** Tanto navegação por links internos quanto o histórico do navegador (`popstate` / `history.back()`) passam pelo mesmo diálogo padrão Koveno.

### ADR-441 — Consolidação de `pending` em diálogos, `<AppLink>` obrigatório no cliente e paridade de filtros
- **Contexto:** Faltavam estados `pending` e rótulos de carregamento consistentes em botões/diálogos críticos, alguns links em componentes `'use client'` ainda importavam `next/link` diretamente (`ProposalForm`, `AreaError`), e `ParticipantFilterBar` ainda anunciava `aria-live` inicial antes de qualquer interação.
- **Decisão:** propagar `pending` por `useFormStatus`/`useActionState` nos botões e confirmações críticos, migrar todos os links cliente remanescentes para `<AppLink>` com catraca no Vitest, e alinhar `ParticipantFilterBar` à mesma régua de `ComiteFilterBar` (`aria-live` silencioso inicial, `isContentEditable` no `/`, `(×)` e `Escape`/unmount cancelando debounce).
- **Consequências:** Cliques duplos em mutações destrutivas ou financeiras/acadêmicas ficam bloqueados durante a transição e todo link SPA aciona a barra global e respeita o guardião de rascunho.

---

## 5. Lições Aprendidas (Defeitos Reais Encontrados por Testes)

| Defeito observado | Sintoma nos testes | Causa raiz real | Correção aplicada |
|---|---|---|---|
| **Botão Voltar furava o modal** | `f107` cenário 1 (`window.history.back()`) navegava direto mesmo com `addEventListener('popstate', ..., true)` | No Chromium, ouvintes em `window` (`AT_TARGET`) rodam na ordem de registro ignorando `capture: true`; o `AppRouter` registrava antes no `useEffect` | `ensurePopstateInterceptor()` único executado na carga do módulo `use-unsaved-changes.ts` antes da montagem dos efeitos do roteador |
| **Regressão sem JS no `AdminForm`** | `f70` caso 3 e `rubric-criteria` casos 2–4 falhavam com `javaScriptEnabled: false` | Envolver `action` em `async (prev, fd) => ...` dentro de `useActionState` ocultava a referência da Server Action no SSR | Passagem direta `useActionState(action, null)` em `AdminForm`, `MessageComposer`, `SpeakerProfileForm` e `SpeakerNotesForm`, com sync em render (`state !== lastSavedState`) |
| **Aviso residual em `MessageComposer`** | `useUnsavedChanges(isDirty && !state?.ok)` desarmava o guardião permanentemente ao digitar uma 2ª mensagem após sucesso | `state.ok` permanecia `true` após o primeiro envio bem-sucedido até nova submissão | Uso direto de `useUnsavedChanges(isDirty)`, já que os campos limpos no sucesso garantem `isDirty === false` até nova edição |

---

## 6. Evidência de Verificação

```text
npm run lint                 → exit 0 (0 erros, 0 warnings)
npm run typecheck            → exit 0 (0 erros)
npm test                     → Test Files  285 passed (285) · Tests  4856 passed (4856) (277.95s)
npm run build                → ✓ Compiled successfully in 5.3s · Generating static pages (19/19) in 392ms
npm run db:verify            → "Contrato íntegro." (exit 0)
npm run db:verify:isolation  → "9/9 verificações passaram." (exit 0)
npm run db:partitions        → 211287 linha(s), exit 0
docker images eventflow/web  → eventflow/web:local (1a925662ee86)
npm run test:e2e             → 538 passed, 1 skipped (539 casos, 10.2m)
```

---

## 7. Comandos Operacionais

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run db:verify
npm run db:verify:isolation
npm run db:partitions
docker compose --profile app up -d --build web worker
npx playwright test tests/e2e/f107-ux-formularios-transicoes-e-popstate.spec.ts
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- As **44 dívidas técnicas** catalogadas em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md) permanecem inalteradas nesta fase (nenhuma nova dívida aberta).
- Manter o critério de nunca envolver Server Action props em closures client dentro de `useActionState` para preservar o atributo/campo `$ACTION_*` sem JavaScript.

---

## 9. Checklist de Aceite

- [x] `AdminForm`, `MessageComposer`, `SpeakerProfileForm`, `SpeakerNotesForm`, `ProposalAcceptancePanel`, `RegistrationForm`, `ShareCardPanel` e `AuthForm` preservam dados e protegem rascunhos sem quebrar No-JS
- [x] `useUnsavedChanges` + `<UnsavedChangesDialog />` interceptam navegação SPA, unload externo e `popstate` (Voltar do navegador)
- [x] Botões e diálogos de confirmação críticos respeitam `pending` contra duplo clique
- [x] Zero componentes `'use client'` importam `next/link` fora de `AppLink` (preso por catraca Vitest)
- [x] `ParticipantFilterBar` alinhado com silêncio inicial `aria-live`, `isContentEditable`, `(×)` e `Escape`
- [x] Documentação (`docs/fase-107-*.md`, `README.md`, `AGENTS.md`) e bateria completa verificadas

