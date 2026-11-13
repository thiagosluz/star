# FASE 109 — Fechamento Final de UX, React 19 & App Router

> **Data:** 2026-11-13 · **Situação:** entregue · **ADRs desta fase:** ADR-446 … ADR-448

---

## 1. Sumário Executivo

Esta fase fecha as pontas soltas de experiência de usuário, compatibilidade com o ciclo de reset de formulários do React 19, navegação contínua no Next.js App Router e hidratação determinística de datas:

| Bloco / Frente | Onde foi aplicado | Resultado direto |
|---|---|---|
| **Bloco A — Guardião pós-salvamento, seleção acoplada e preservação pós-erro React 19** (`ADR-446`) | `AdminForm` (remoção de `&& !state?.ok` em `useUnsavedChanges`), `warnUnsaved` em `dados/page.tsx` e `meu-perfil-publico/page.tsx`, `CreateSubmissionForm` (trilhas filtradas por evento + ressincronização de `trackId`), `requestPasswordResetAction`/`RequestResetForm`, `TwoFactorChallengeForm`, `completeEventRegistrationDataAction`/`EventRegistrationDataForm`, `saveCertificatePolicyAction`/`CertificatePolicyPanel`, `updateLeadStatusAction`/`LeadStatusForm`, `claimSpeakerInviteAction`/`ClaimInviteForm` | Edições subsequentes após salvar mantêm o guardião ativo; seleção de trilha impede `TRACK_NOT_FOUND` entre eventos; e retornos `{ ok: false }` preservam campos e checkboxes (`defaultValue`/`defaultChecked`) após o reset nativo do React 19 |
| **Bloco B — Navegação SPA contínua (`GetSearchForm`, `AppLink`, `startTransition`)** (`ADR-447`) | `GetSearchForm` (preservação do `submitter` `name`/`value` para formulários GET com múltiplas ações) em todas as 9 rotas/componentes GET restantes (`comunicacao`, `demandas`, `pagina/midia`, `meu-cracha`, `minha-agenda`, `panorama`, `validar/lote`, `RaffleHistory`, `CheckinFilterBar`); `<AppLink>` nos 4 componentes clientes remanescentes (`AccountForms`, `SponsorQrCreateForm`, `RaffleHistory`, `RaffleStage`); e `startTransition` em `UnsavedChangesDialog` e `ClaimSpeakerInviteForm` (sem `router.refresh()` redundante) | Pesquisas GET e links internos mantêm barra de progresso global, guardião de rascunhos e progressive enhancement `<form method="get">` sem recarregamentos completos de página |
| **Bloco C — Estado `pending` uniforme em Server Components e clientes** (`ADR-448`) | Novo primitivo `<FormStatusButton>` (`useFormStatus()`) nos formulários Server (`AccountBlock`, `/conta`, `/selecionar-instituicao`, `NavCollapseToggle`, `ThemeChoice`), além de rótulos `pending` dinâmicos em `AccountPasswordForm`, `AccountTwoFactorPanel`, `AcceptInvitationForm` e `ScanForm` | Ações de sessão, tema e barra lateral exibem estado de envio no cliente mantendo `<button type="submit">` idêntico no SSR sem JavaScript |
| **Bloco D — Datas determinísticas no fuso e `suppressHydrationWarning`** (`ADR-448`) | `/t/[tenantSlug]/(app)/meu-cracha` (`timezone` selecionado nos eventos + `formatZonedDateTime` + `timeZone` explícito em `startsAtLabel`) e `suppressHydrationWarning` em 6 componentes clientes com `.toLocale*String('pt-BR')` (`CheckinFilterBar`, `ParticipantFilterBar`, `RaffleConsole`, `RaffleStage`, `AdminSpeakerPanel`, `ClaimSpeakerInviteForm`) | Opções de evento respeitam o fuso cadastrado e elementos renderizados em cliente deixam de divergir na hidratação SSR |

**Números da fase:**
- **Novos arquivos criados:** **3** ([`src/components/ui/form-status-button.tsx`](../src/components/ui/form-status-button.tsx), [`tests/unit/f109-fechamento-ux-react19-e-app-router.test.ts`](../tests/unit/f109-fechamento-ux-react19-e-app-router.test.ts) com **7** testes e [`tests/e2e/f109-fechamento-ux-react19-e-app-router.spec.ts`](../tests/e2e/f109-fechamento-ux-react19-e-app-router.spec.ts) com **3** cenários E2E)
- **Migrações de banco:** **0**
- **ADRs da fase:** **3** (`ADR-446` … `ADR-448`, total do projeto: **448**)
- **Dívidas técnicas:** **44** mantidas (`docs/dividas-tecnicas.md`)

---

## 2. O Problema Mais Difícil da Fase

Dois comportamentos sutis entre Server Components, Progressive Enhancement e formulários React 19 exigiram ajuste estrutural:

1. **`GetSearchForm` com múltiplos botões de submissão em GET (`segment-form`):** Em `administracao/comunicacao/page.tsx`, o formulário de prévia/contagem de segmento usa `<button type="submit" name="revisar" value="1">`. Quando `GetSearchForm` construía `new FormData(form)` sem inspecionar `(event.nativeEvent as SubmitEvent).submitter`, o parâmetro `revisar=1` era descartado no cliente, funcionando apenas no caminho sem JS. Incluir `submitter.name` / `submitter.value` explicitamente quando `submitter` é `HTMLButtonElement` ou `HTMLInputElement` sem `disabled` alinhou os comportamentos com e sem JavaScript mantendo `FormData(form)` compatível com JSDOM.
2. **Desarme permanente do guardião em `AdminForm` após o 1º salvamento bem-sucedido:** Como `AdminForm` já redefine `lastSavedState` após uma resposta `{ ok: true }`, a condição extra `&& !state?.ok` passava a desligar `useUnsavedChanges` para qualquer edição subsequente na mesma visita. Remover `&& !state?.ok` mantém o formulário limpo imediatamente após salvar e reativa o diálogo `<UnsavedChangesDialog />` assim que a pessoa começa uma segunda alteração.

---

## 3. Decisões Técnicas Explicadas

- **`CreateSubmissionForm` acoplando evento e trilha:** Filtrar `tracks` por `selectedEvent.tracks` e atualizar `trackId` quando `eventId` muda elimina a possibilidade de escolher na UI uma trilha pertencente a outro evento (`TRACK_NOT_FOUND` no servidor), mantendo o fallback seguro para o evento selecionado.
- **`values` nos retornos `{ ok: false }`:** Estender o contrato de preservação pós-erro já usado nas fases anteriores para `requestPasswordResetAction`, `claimSpeakerInviteAction`, `completeEventRegistrationDataAction`, `saveCertificatePolicyAction` e `updateLeadStatusAction`, ligando os inputs a `defaultValue` e `defaultChecked` para sobreviverem ao `form.reset()` do React 19 sem converter formulários inteiros em controlados ou quebrar a submissão sem JS.
- **`FormStatusButton` como ilha mínima de cliente:** Como `AccountBlock`, `/conta`, `/selecionar-instituicao`, `NavCollapseToggle` e `ThemeChoice` renderizam formulários diretamente em Server Components, encapsular `useFormStatus()` em `<FormStatusButton>` evita transformar árvores inteiras em `'use client'` e mantém `<button type="submit">` idêntico no SSR.
- **Fuso explícito em `meu-cracha` e `suppressHydrationWarning` em clientes:** Garantir que a lista de eventos de `/t/[slug]/meu-cracha` carregue `event.timezone` e formate datas com `formatZonedDateTime(event.startsAt, event.timezone)` unifica servidor e fuso do evento; nos 6 componentes clientes com `.toLocale*String('pt-BR')` sobre timestamps, `suppressHydrationWarning` evita alertas de hidratação quando o navegador usa fuso local diferente do servidor.

---

## 4. ADRs da Fase

### ADR-446 — Guardião contínuo em `AdminForm`, acoplamento evento→trilha em `CreateSubmissionForm` e preservação pós-erro React 19
- **Contexto:** Após uma primeira atualização com `{ ok: true }`, `AdminForm` mantinha `useUnsavedChanges` desativado (`&& !state?.ok`); `dados/page.tsx` e `meu-perfil-publico/page.tsx` não passavam `warnUnsaved`; `CreateSubmissionForm` misturava trilhas de todos os eventos em `<select name="trackId">`; e 5 fluxos restantes (`RequestResetForm`, `EventRegistrationDataForm`, `CertificatePolicyPanel`, `LeadStatusForm`, `ClaimInviteForm`) ainda perdiam valores ou checkboxes após `{ ok: false }`.
- **Decisão:** Remover `&& !state?.ok` de `AdminForm`, ativar `warnUnsaved` em `dados` e `meu-perfil-publico`, filtrar trilhas pelo `selectedEvent` em `CreateSubmissionForm` e devolver/vincular `values` (`defaultValue`/`defaultChecked`) nas actions e componentes afetados.
- **Consequências:** Nenhuma edição posterior ao salvamento foge do guardião de saída, trilhas inválidas de outro evento não aparecem na UI e entradas digitadas sobrevivem a erros de validação mantendo suporte No-JS.

### ADR-447 — `<GetSearchForm>` com preservação de `submitter`, `<AppLink>` canônico em clientes e `startTransition` programático
- **Contexto:** 9 formulários `<form method="get">` e 4 componentes clientes com `<a href>` ainda executavam navegação cheia do navegador (perdendo barra de progresso e interceptação de alterações não salvas), enquanto `GetSearchForm` ainda descartava o `name`/`value` do botão acionador em formulários com múltiplas ações.
- **Decisão:** Capturar `submitter` em `GetSearchForm`, migrar os 9 GET forms e os 4 componentes clientes remanescentes para `<GetSearchForm>` e `<AppLink>`, e envolver `router.push()` em `UnsavedChangesDialog` e `ClaimSpeakerInviteForm` com `startTransition` (removendo `router.refresh()` redundante).
- **Consequências:** Navegações de busca e atalhos internos passam integralmente pelo App Router com sinalização uniforme de progresso e proteção contra saída com alterações não salvas.

### ADR-448 — `<FormStatusButton>` em Server Components e formatação determinística de datas/hidratação
- **Contexto:** Formulários renderizados em Server Components (logout em `AccountBlock`, `/conta`, `/selecionar-instituicao`; alternância em `NavCollapseToggle` e `ThemeChoice`) não exibiam estado `pending` nem bloqueavam reenvio durante o envio; `meu-cracha` formatava datas sem selecionar `event.timezone`; e 6 componentes clientes chamavam `.toLocale*String('pt-BR')` sem `suppressHydrationWarning`.
- **Decisão:** Criar `<FormStatusButton>` com `useFormStatus()`, aplicá-lo nos formulários Server (junto a rótulos `pending` explícitos em `AccountPasswordForm`, `AccountTwoFactorPanel`, `AcceptInvitationForm` e `ScanForm`), buscar `timezone` em `meu-cracha` com `formatZonedDateTime`, e adicionar `suppressHydrationWarning` nos elementos de data/hora renderizados em cliente.
- **Consequências:** Feedback de envio uniforme em toda a aplicação sem perder compatibilidade SSR sem JavaScript, com formatação de horários coerente ao fuso do evento e livre de mismatch de hidratação.

---

## 5. Lições Aprendidas (Defeitos Reais Encontrados por Testes)

| Defeito observado | Sintoma nos testes | Causa raiz real | Correção aplicada |
|---|---|---|---|
| **Divisão por seletores e acordeão fechado na suíte E2E nova (`f109`)** | A 1ª execução de `f109-fechamento-ux-react19-e-app-router.spec.ts` falhou nos cenários 1 e 3 esperando `[data-testid="admin-feedback-ok"]`, `[data-testid="speaker-portal-error"]` e `#token` visível sem clique prévio | `AdminForm` expõe `data-testid="${testId}-feedback"` (`edit-event-feedback`), `Feedback` em `portal-forms.tsx` expõe `speaker-feedback-error`, e `<details>` do código de convite inicia fechado quando não há `defaultToken` | Atualizados os seletores e adicionada abertura explícita de `summary:has-text("Tenho um código de convite")` na suíte E2E (`3 passed (9.5s)` isolado; `544 passed, 1 skipped` no conjunto completo) |
| **Aviso de lint em import não usado após migração para `<FormStatusButton>`** | `src/app/conta/page.tsx` manteve import de `Button` sem uso após substituir o botão cru por `<FormStatusButton>` | Limpeza incompleta de import ao trocar o componente de submissão | Removido o import não usado de `Button` em `src/app/conta/page.tsx`, restaurando `npm run lint` com 0 erros e 0 warnings |

---

## 6. Evidência de Verificação

*(Pós-documentação — resultados exatos observados no fim da sessão:)*

```text
npm run lint                 → exit 0 (0 erros, 0 warnings)
npm run typecheck            → exit 0 (0 erros)
npm test                     → Test Files  287 passed (287) · Tests  4871 passed (4871) (308.42s antes dos docs; reexecutado ao final)
npm run build                → ✓ Compiled successfully in 6.9s · Finished TypeScript in 12.7s · Generating static pages (19/19) in 527ms
npm run db:verify            → "Contrato íntegro." (exit 0)
npm run db:verify:isolation  → "9/9 verificações passaram." (exit 0)
npm run db:partitions        → total: 215768 linha(s) (exit 0)
docker images eventflow/web  → eventflow/web:local (ID fdb0708ee83f) & eventflow/worker:local reconstruídos
npm run test:e2e             → 544 passed, 1 skipped (545 casos, 10.8m)
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
npx playwright test tests/e2e/f109-fechamento-ux-react19-e-app-router.spec.ts
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- As **44 dívidas técnicas** catalogadas em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md) permanecem inalteradas nesta fase (nenhuma nova dívida aberta).
- Em ambientes Windows com restrição de criação de junction points NTFS em `.next/node_modules/*` dentro de sandbox, executar `npm run build` / build Docker com permissão padrão do host (`BypassSandbox`).

---

## 9. Checklist de Aceite

- [x] `AdminForm` preserva `useUnsavedChanges` após salvamentos `{ ok: true }`, com `warnUnsaved` em `dados` e `meu-perfil-publico`, e `CreateSubmissionForm` filtra trilhas pelo evento selecionado (`ADR-446`)
- [x] Preservação pós-erro `{ ok: false }` (`values` / `defaultChecked`) ativa em `RequestResetForm`, `ClaimInviteForm`, `EventRegistrationDataForm`, `CertificatePolicyPanel` e `LeadStatusForm` (`ADR-446`)
- [x] `GetSearchForm` preserva `submitter` e substitui os 9 `<form method="get">` remanescentes; `<AppLink>` substitui links internos nos 4 componentes clientes remanescentes; `startTransition` aplicado em `UnsavedChangesDialog` e `ClaimSpeakerInviteForm` (`ADR-447`)
- [x] `<FormStatusButton>` (`useFormStatus()`) aplicado em formulários Server e rótulos `pending` alinhados em `AccountPasswordForm`, `AccountTwoFactorPanel`, `AcceptInvitationForm` e `ScanForm` (`ADR-448`)
- [x] Fuso explícito em `meu-cracha` e `suppressHydrationWarning` em 6 componentes clientes com `.toLocale*String('pt-BR')` (`ADR-448`)
- [x] Documentação (`docs/fase-109-fechamento-ux-react19-e-app-router.md`, `README.md`, `AGENTS.md`, `docs/fases-historico.md`) e bateria completa verificadas

