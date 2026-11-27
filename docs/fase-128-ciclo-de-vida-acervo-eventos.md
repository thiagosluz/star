# FASE 128 — Ciclo de Vida no Acervo de Eventos

## 1. Sumário executivo

Em `/t/<slug>/administracao/eventos` o acervo só permitia **criar** e **gerenciar**. A fase
acrescenta o ciclo de vida completo, sem sair da lista.

| Entrega | Onde |
|---|---|
| Atalho **Editar dados** em cada linha | `administracao/eventos/page.tsx` |
| **Clonar** dados básicos em `DRAFT` | `cloneEventBasicData` · `cloneEventAction` |
| **Arquivar / Restaurar** + abas `?situacao=todos\|ativos\|arquivados` | `archiveEvent` · `archiveEventAction` |
| **Exclusão segura** (palavra `EXCLUIR` + senha atual) | `deleteEventSecurely` · `deleteEventAction` |
| Regras puras | `src/domain/events/event-lifecycle-rules.ts` |
| Serviço sob RLS + auditoria | `src/lib/admin/event-lifecycle-service.ts` |
| Server Actions | `src/app/actions/event-lifecycle-actions.ts` |
| Modais cliente | `src/components/admin/event-lifecycle-actions.tsx` |

Números: **6** Vitest unitários + **3** de integração (Postgres real) + **4** E2E; sem migração.

## 2. O problema mais difícil

Excluir é irreversível para quem clica, mas o evento é a raiz de inscrições, financeiro e
certificados. A exclusão é **lógica** (`deletedAt`), e o **slug é liberado** (`<slug>-del-<id8>`)
para que a instituição recrie a próxima edição com o mesmo endereço.

## 3. Decisões e ADRs

- **ADR-511 — Clonar copia estrutura, não operação.** Copia identificação, modalidade, local, tema
  e `settings` seguras (`registrationRequiresMembership`, `registrationForm`, `certificatePolicy`).
  **Nunca** copia `settings.api` (chave selada/hash), inscrições, atividades, finanças ou
  certificados; contadores nascem zerados e o status é `DRAFT`. A quota de eventos é conferida.
  Alternativa descartada: clonar tudo — herdaria credenciais e dados de participantes.
- **ADR-512 — Arquivar é status, não exclusão.** `ARCHIVED` ↔ `DRAFT`, filtro por query string SSR
  (sem JS, compartilhável), contagem por aba.
- **ADR-513 — Exclusão exige dois fatores de intenção.** Palavra `EXCLUIR` (sem diferenciar
  caixa) **e** senha verificada por `auth.api.verifyPassword`; a verificação entra no serviço como
  callback para manter o domínio testável. Trilha `DELETE`. Modais só montam o `<form>` quando
  abertos, preservando a invariante da F90 (zero `<form>` no SSR da lista).

## 4. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `tsc`: módulo `@/domain/shared/record` inexistente | o helper vive em `json-record.ts` | import corrigido |
| `tsc`: `SubmitButton` sem `children` | o primitivo usa a prop `label` | `label` + `pendingLabel` |
| Integração: `category` inválida | `category` é enum `EventCategory` | fixture usa `TECNOLOGIA` |
| Integração: valor longo demais | `country` é `VarChar(2)` | fixture usa `BR` |
| Catraca `f107`: import `next/link` em Client Component | `EventLifecycleActions` usou `Link` diretamente | migrado para `AppLink` de `@/components/ui` |
| E2E `f128`: campo `EXCLUIR` limpo após erro de senha | React 19 reseta inputs não controlados após `<form action>` | campos de clonagem e `confirmationWord` controlados com `useState` |

## 5. Evidência de verificação

- `npm run lint`: `0` erros, `0` warnings
- `npx tsc --noEmit --noUnusedLocals`: `0` erros
- `npm test`: `313 passed (313)` · **`5024 passed (5024)`**
- `npm run build`: `Compiled successfully` (`/t/[tenantSlug]/administracao/eventos` listada)
- `docker compose --profile app up -d --build web`: imagem `eventflow/web:local` (`2026-11-26 18:37:57 -0300`)
- `npm run db:verify`: `Contrato íntegro.`
- `npm run db:verify:isolation`: `9/9 verificações passaram.`
- `npm run db:partitions`: `todas as partições do intervalo já existiam`
- `npm run test:e2e`: **`575 passed` + `1 skipped`** (`10.8m`)
- `(Get-Item AGENTS.md).Length`: **`63323` bytes** (abaixo do teto de ~64.800 bytes)

## 6. Comandos

```bash
npx vitest run tests/unit/f128-ciclo-de-vida-eventos.test.ts tests/integration/f128-event-lifecycle.test.ts
npx playwright test tests/e2e/f128-ciclo-de-vida-eventos.spec.ts
```

## 7. Dívidas e pontos de atenção

- Não há tela de "lixeira": a exclusão lógica só é desfeita por operação direta no banco.
- Dependentes (inscrições, certificados) permanecem no banco após a exclusão lógica.

## 8. Checklist de aceite

- [x] Atalho Editar dados
- [x] Excluir com `EXCLUIR` + senha
- [x] Arquivar/Restaurar + filtro
- [x] Clonar dados básicos sem segredos
