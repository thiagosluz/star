# FASE 108 — Polimento Final de UX, React 19 & App Router

> **Data:** 2026-11-13 · **Situação:** entregue · **ADRs desta fase:** ADR-442 … ADR-445

---

## 1. Sumário Executivo

Esta fase conclui o polimento final de experiência de usuário, resiliência de formulários React 19 e navegação no Next.js App Router:

| Bloco / Frente | Onde foi aplicado | Resultado direto |
|---|---|---|
| **Bloco A — `TenantMenu` e `useActionState` sem closures async** (`ADR-442`) | `TenantMenu` (`SwitchTenantOptionButton` com `useFormStatus()` dentro do `<form>`, `<AppLink>`, fechamento por `Escape`, `pointerdown` externo e mudança de rota via `usePathname()`), `MemberRolesForm` (`src/components/admin/member-actions.tsx`), `InviteMemberForm` (`src/components/communication/invite-member-form.tsx`) | Troca de instituição mostra feedback imediato de envio, menu fecha de forma previsível e os formulários passam a Server Action diretamente ao `useActionState`, preservando `$ACTION_*` no SSR (mantendo `checkin-queue.tsx` intocado por `ADR-427`) |
| **Bloco A — Preservação de entrada pós-erro (`values`) e estados `pending`** (`ADR-443`, `ADR-445`) | `InstitutionLeadForm` (`src/components/platform/lead-form.tsx`), `AccountProfileForm`, `AccountEmailForm`, `EventRegistrationForm` (`src/components/events/event-registration-form.tsx`), `EventApiSectionsForm` (`src/components/admin/event-api-sections-form.tsx`), `ConfirmSubmitButton`, `RequestResetForm`, `ResetPasswordForm`, `ClaimSpeakerInviteForm` | Retornos `{ ok: false }` preservam campos e seleções de checkbox (`defaultChecked`) mesmo após o `form.reset()` do React 19, enquanto botões e diálogos críticos bloqueiam cliques duplos com rótulo `pending` |
| **Bloco B — Proteção de rascunho e `MobileNav` acessível** (`ADR-444`) | `AuthorEditor`, `EventApiSectionsForm`, `SubmissionUploader` (`disabled={isBusy}` no `<input type="file">`) e `MobileNav` | Edições não salvas acionam `useUnsavedChanges`, envio de arquivo bloqueia reentrada durante upload e a gaveta móvel aplica `role="dialog"`, `aria-modal`, focus trap (`Tab`/`Shift+Tab`), `inert` no fundo, retorno de foco ao `openButtonRef` em `Escape`/backdrop e fechamento em troca de rota |
| **Bloco C — Navegação progressiva `<GetSearchForm>` e `RouteProgress` sem `loading.tsx`** (`ADR-445`) | `<GetSearchForm>` nas 7 rotas de busca GET (incluindo `certificados/page.tsx`), `ClaimSpeakerInviteForm` (`startNavigationProgress()`) e `AppShell` (`RouteProgress` + `RouteLoadingSkeleton`) | Pesquisas GET mantêm `<form method="get">` no SSR sem JavaScript, disparam `startTransition` + `startNavigationProgress()` + `router.push()` no cliente, e evitam `loading.tsx` em layouts pais (Armadilha 107 / `ADR-410`) |

**Números da fase:**
- **Novos arquivos de teste:** **2** ([`tests/unit/f108-polimento-ux-react19-e-app-router.test.ts`](../tests/unit/f108-polimento-ux-react19-e-app-router.test.ts) com **8** testes + [`tests/e2e/f108-polimento-ux-react19-e-app-router.spec.ts`](../tests/e2e/f108-polimento-ux-react19-e-app-router.spec.ts) com **3** cenários E2E)
- **Testes ajustados por contrato:** [`tests/integration/f76-query-ignorada.test.ts`](../tests/integration/f76-query-ignorada.test.ts) (`useRouter` e `usePathname` no mock parcial de `next/navigation`) e [`tests/unit/f79-fases-no-arquivo-certo.test.ts`](../tests/unit/f79-fases-no-arquivo-certo.test.ts) (F108 na lista corrente e F89 movida para [`docs/fases-historico.md`](fases-historico.md))
- **Migrações de banco:** **0**
- **ADRs da fase:** **4** (`ADR-442` … `ADR-445`, total do projeto: **445**)
- **Dívidas técnicas:** **44** mantidas (`docs/dividas-tecnicas.md`)

---

## 2. O Problema Mais Difícil da Fase

Dois mecanismos nativos do React 19 e do Next.js App Router produziram regressões silenciosas fora de testes isolados quando confrontados com a suíte E2E completa:

1. **`form.reset()` automático do React 19 em checkboxes de formulários com `action={formAction}`:** no `EventRegistrationForm` e no `EventApiSectionsForm`, controles vinculados apenas a estado React ou `checked` desacoplado do atributo HTML `defaultChecked` voltavam ao estado inicial falso após o React 19 resetar o `<form>` no retorno `{ ok: false }` de uma Server Action. Trocar os checkboxes LGPD de `EventRegistrationForm` para `defaultChecked={Boolean(state?.values?.consentData)}` / `defaultChecked={Boolean(state?.values?.consentImage)}` (retornados por `registerForEventAction`) e os toggles de `EventApiSectionsForm` para `defaultChecked={draft[info.section]}` (mantendo `onChange` para rastrear alterações em `useUnsavedChanges`) fez o reset nativo restaurar exatamente os valores preservados, sem quebrar a submissão sem JavaScript.
2. **Armadilha 107 reintroduzida por `loading.tsx` em layouts pais:** adicionar `src/app/t/[tenantSlug]/(app)/loading.tsx` e `src/app/superadmin/loading.tsx` fez **64 cenários E2E** falharem no container de produção porque o boundary `<Suspense>` de layout faz `notFound()` e `redirect()` devolverem HTTP 200 e envolve a resposta SSR sem JS em `<div hidden id="S:0">`. Remover ambos os arquivos (usando `Remove-Item -LiteralPath` no PowerShell para `[tenantSlug]` não virar curinga de classe de caracteres) e travar `existsSync(...loading.tsx) === false` na catraca unitária manteve a sinalização de transição exclusivamente em `<RouteProgress>` e `<RouteLoadingSkeleton>` no `AppShell` (`ADR-410`).

---

## 3. Decisões Técnicas Explicadas

- **`TenantMenu` com `useFormStatus()` dentro do `<form>` e fechamento multi-sinal:** mover o indicador de envio para o componente filho `SwitchTenantOptionButton` permite usar `useFormStatus()` de forma nativa sem estado manual duplicado; links internos usam `<AppLink>` para respeitar o guardião de rascunhos e a barra global; `Escape`, `pointerdown` externo e troca de `usePathname()` fecham o menu com previsibilidade.
- **Passagem direta da Server Action ao `useActionState` em `MemberRolesForm` e `InviteMemberForm`:** remover closures `async` ao redor de `updateMemberRolesAction` e `inviteMemberAction` preserva os campos ocultos `$ACTION_*` no HTML SSR para ambientes sem JS, mantendo intacta a exceção documentada de `checkin-queue.tsx` protegida pelos ratchets `f100`/`f101`/`f102` (`ADR-424`/`ADR-427`).
- **`<GetSearchForm>` com degradação graciosa para `<form method="get">`:** renderizar `<form method="get">` nativo garante funcionamento total sem JavaScript; quando há JS ativo, a submissão entra em `startTransition`, aciona `startNavigationProgress()` e navega via `router.push()`, unificando as 7 telas de busca por query string.
- **Acessibilidade completa da `MobileNav`:** a gaveta móvel implementa diálogo modal real (`role="dialog"`, `aria-modal`), ciclo de foco por `Tab`/`Shift+Tab`, aplicação de `inert` nos demais filhos diretos de `document.body`, retorno de foco ao `openButtonRef` em `Escape`/clique no backdrop e fechamento sincronizado por `usePathname()` em render.

---

## 4. ADRs da Fase

### ADR-442 — `TenantMenu` resiliente e `useActionState` direto sem closures async em equipe/convites
- **Contexto:** `TenantMenu` usava vínculo HTML comum sem retorno de envio por opção nem fechamento consistente por teclado/`pointerdown`/navegação; além disso, `MemberRolesForm` e `InviteMemberForm` encapsulavam suas Server Actions em closures `async`, escondendo os tokens `$ACTION_*` no SSR sem JS.
- **Decisão:** extrair `SwitchTenantOptionButton` com `useFormStatus()`, trocar o link da conta para `<AppLink>`, fechar o menu em `Escape`/`pointerdown`/mudança de `pathname` e passar `updateMemberRolesAction` e `inviteMemberAction` diretamente para `useActionState` (mantendo `checkin-queue.tsx` sob o contrato `ADR-427`).
- **Consequências:** troca de instituição exibe feedback de carregamento imediato e os formulários administrativos de equipe e convites funcionam com e sem JavaScript.

### ADR-443 — Preservação de estado pós-erro (`values`) e `defaultChecked` sob React 19
- **Contexto:** `InstitutionLeadForm`, `AccountProfileForm`, `AccountEmailForm`, `EventRegistrationForm` e `EventApiSectionsForm` perdiam entradas digitadas ou marcações de checkbox quando a Server Action retornava `{ ok: false }`, devido ao reset automático de `<form>` do React 19.
- **Decisão:** retornar `values` nos resultados de erro das actions correspondentes (incluindo `registerForEventAction`) e vincular inputs e checkboxes a `defaultValue` / `defaultChecked` derivados desses `values` (mantendo `onChange` apenas para rastreamento de `dirty` quando necessário).
- **Consequências:** validações malsucedidas preservam todos os campos e consentimentos preenchidos no DOM após o reset do React 19 sem sacrificar progressive enhancement.

### ADR-444 — Guardião de alterações e upload em rascunhos + `MobileNav` acessível
- **Contexto:** `AuthorEditor`, `EventApiSectionsForm` e `SubmissionUploader` ainda não integravam `useUnsavedChanges` ou deixavam o seletor de arquivo habilitado durante upload; a `MobileNav` móvel não isolava o fundo nem prendia o foco dentro do painel.
- **Decisão:** integrar `useUnsavedChanges` em `AuthorEditor`, `EventApiSectionsForm` e `SubmissionUploader` (com `disabled={isBusy}` no `<input type="file">`), e transformar `MobileNav` em diálogo modal (`role="dialog"`, `aria-modal`, focus trap `Tab`/`Shift+Tab`, `inert` no restante do `document.body`, restauração de foco para `openButtonRef` e fechamento por `usePathname()`).
- **Consequências:** perda acidental de edições e reenvios durante upload ficam bloqueados e usuários de teclado/leitor de tela navegam na `MobileNav` sem escapar para o conteúdo oculto.

### ADR-445 — `<GetSearchForm>` progressivo, `pending` global e preservação de `RouteProgress` sem `loading.tsx`
- **Contexto:** buscas GET não acionavam a barra de progresso global no App Router, alguns fluxos (`ClaimSpeakerInviteForm`, `ConfirmSubmitButton`, `RequestResetForm`, `ResetPasswordForm`) ainda careciam de sinalização uniforme de `pending`/transição, e a tentativa de introduzir `loading.tsx` em layouts pais violou a Armadilha 107.
- **Decisão:** criar `<GetSearchForm>` (`<form method="get">` SSR + `startTransition` + `startNavigationProgress()` + `router.push()`) nas 7 rotas GET, propagar `pending`/`startNavigationProgress()` nos fluxos remanescentes, e proibir `loading.tsx` nos layouts `t/[tenantSlug]/(app)` e `superadmin`, preservando `<RouteProgress>` e `<RouteLoadingSkeleton>` no `AppShell` (`ADR-410`).
- **Consequências:** filtros e buscas GET respondem imediatamente com feedback visual no cliente mantendo compatibilidade SSR sem JS, enquanto códigos HTTP 404/307 e renderização SSR permanecem íntegros.

---

## 5. Lições Aprendidas (Defeitos Reais Encontrados por Testes)

| Defeito observado | Sintoma nos testes | Causa raiz real | Correção aplicada |
|---|---|---|---|
| **Mock parcial de `next/navigation` quebrou após `<GetSearchForm>`** | `tests/integration/f76-query-ignorada.test.ts` falhou na renderização de `certificados/page.tsx` por ausência de `useRouter` e `usePathname` | `<GetSearchForm>` (`'use client'`) consome `useRouter` e `usePathname`, que não estavam stubados no `vi.mock('next/navigation')` parcial do arquivo | Adicionados stubs de `useRouter` e `usePathname` em `f76-query-ignorada.test.ts`, restaurando `7 passed (7)` |
| **Reset de `<form>` do React 19 apagava checkboxes em `{ ok: false }`** | Cenário 1 do E2E `f108` mostrou checkboxes LGPD de `EventRegistrationForm` desmarcados após erro de validação; `EventApiSectionsForm` sofria do mesmo comportamento com `checked` controlado | React 19 chama `form.reset()` após `<form action={formAction}>`, revertendo checkboxes para `defaultChecked` em vez de manter `useState`/`checked` | Substituído `checked`/`useState` por `defaultChecked={Boolean(state?.values?.consentData)}` / `consentImage` em `EventRegistrationForm` e `defaultChecked={draft[info.section]}` em `EventApiSectionsForm`, alinhando as asserções do unit test `f108` |
| **Armadilha 107 disparada por `loading.tsx` em layouts pais + pegadinha `[tenantSlug]` no PowerShell** | Suite E2E em container caiu para `477 passed, 64 failed, 1 skipped` (SSR sem JS dentro de `<div hidden id="S:0">` e `notFound()`/`redirect()` com HTTP 200); `Remove-Item` sem `-LiteralPath` ignorou silenciosamente `[tenantSlug]` | Presença de `src/app/t/[tenantSlug]/(app)/loading.tsx` e `src/app/superadmin/loading.tsx` ativa o streaming Suspense no nível do layout; PowerShell interpreta `[tenantSlug]` como classe de caracteres se não usar `-LiteralPath` | Removidos ambos os `loading.tsx` com `Remove-Item -LiteralPath`, preservados `<RouteProgress>` + `<RouteLoadingSkeleton>` no `AppShell` e travada a ausência via `existsSync(...) === false` no unit test `f108` (`541 passed, 1 skipped` no E2E) |

---

## 6. Evidência de Verificação

```text
npm run lint                 → exit 0 (0 erros, 0 warnings)
npm run typecheck            → exit 0 (0 erros)
npm test                     → Test Files  286 passed (286) · Tests  4864 passed (4864) (265.42s)
npm run build                → ✓ Compiled successfully in 6.5s · Finished TypeScript in 4.5s · Generating static pages (19/19) in 366ms
npm run db:verify            → "Contrato íntegro." (exit 0)
npm run db:verify:isolation  → "9/9 verificações passaram." (exit 0)
npm run db:partitions        → total: 214653 linha(s) (exit 0)
docker images eventflow/web  → eventflow/web:local & eventflow/worker:local reconstruídos
npm run test:e2e             → 541 passed, 1 skipped (542 casos, 9.1m)
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
npx playwright test tests/e2e/f108-polimento-ux-react19-e-app-router.spec.ts
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- As **44 dívidas técnicas** catalogadas em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md) permanecem inalteradas nesta fase (nenhuma nova dívida aberta).
- Manter a proibição de `loading.tsx` em `src/app/t/[tenantSlug]/(app)` e `src/app/superadmin` (Armadilha 107 / `ADR-410`), travada pela catraca de [`tests/unit/f108-polimento-ux-react19-e-app-router.test.ts`](../tests/unit/f108-polimento-ux-react19-e-app-router.test.ts).

---

## 9. Checklist de Aceite

- [x] `TenantMenu`, `MemberRolesForm` e `InviteMemberForm` atualizados sem quebrar progressive enhancement nem `checkin-queue.tsx` (`ADR-442`)
- [x] `InstitutionLeadForm`, `AccountProfileForm`, `AccountEmailForm`, `EventRegistrationForm` e `EventApiSectionsForm` preservam valores e checkboxes após `{ ok: false }` (`ADR-443`)
- [x] `ConfirmSubmitButton`, `RequestResetForm`, `ResetPasswordForm` e `ClaimSpeakerInviteForm` exibem estado `pending` e bloqueiam duplo clique
- [x] `useUnsavedChanges` ativo em `AuthorEditor`, `EventApiSectionsForm` e `SubmissionUploader` (`disabled={isBusy}`), além de `MobileNav` modal acessível (`ADR-444`)
- [x] `<GetSearchForm>` progressivo nas 7 rotas GET e `RouteProgress`/`RouteLoadingSkeleton` preservados sem `loading.tsx` em layouts pais (`ADR-445`)
- [x] Documentação (`docs/fase-108-polimento-ux-react19-e-app-router.md`, `README.md`, `AGENTS.md`, `docs/fases-historico.md`) e bateria completa verificadas

