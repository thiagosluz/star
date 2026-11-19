# FASE 118 — Faxina de Código Morto e Redução de Superfície de Server Actions

---

## 1. Sumário Executivo

A **FASE 118** executou a limpeza estrutural a partir de uma varredura AST sobre todos os **668 arquivos** `.ts`/`.tsx` de `src/` (cruzada com `tests/`, `prisma/`, `scripts/` e `package.json`), removendo código morto comprovado, fechando **7 endpoints POST órfãos** em arquivos `'use server'` e travando a base com catraca AST contra o retorno de Server Actions ou componentes sem consumidor.

| Entrega | Escopo | Resultado |
|---|---|---|
| **Superfície de Server Actions e componente órfão (`ADR-475`)** | Exclusão de `src/components/gamification/badge-checkin-form.tsx` (`112` linhas); remoção das 6 Server Actions órfãs (`loadAccount`, `checkInByBadgeAction`, `requestCertificateDownloadAction`, `enterTenantAction`, `adjustXpAction`, `saveSponsorQrAction`); remoção de `export` em `deleteCertificateTemplateAction` e em 5 componentes internos (`ActivityCard`, `SpeakerCard`, `ShellNav`, `InviteTokenBox`, `PublicEventCard`) | **-7** endpoints `'use server'` sem consumidor; **0** arquivos de componente órfãos |
| **Limpeza de funções mortas (`ADR-476`)** | Remoção de **32 funções** exportadas com `0` chamadores em filas, infra, serviços e domínio + **18 imports/helpers** que ficaram órfãos em cascata (`formatMinutes`, `bufferToStream`, `ListObjectsV2Command`, etc.) | `tsc --noEmit --noUnusedLocals` = `0` erros; base enxuta e tree-shaking limpo |
| **Catraca AST anti-regressão** | `tests/unit/f118-codigo-morto-e-superficie-actions.test.ts` (`3` testes) | Falha no Vitest se surgir Server Action exportada sem consumidor em `src/` ou arquivo `.tsx` órfão em `src/components/` |

**Números da fase:** `1` arquivo órfão excluído · `38` funções/actions mortas + `18` imports/helpers em cascata removidos · `0` migrações de banco · **`+3` testes Vitest** (`301` arquivos · **`4.961` testes**) · **`565` E2E passando + `1` skip** (`23/23` em `f62` sem regerar snapshots).

---

## 2. O Problema Mais Difícil da Fase

Distinguir **código realmente morto** de símbolos consumidos indiretamente (via `await import(...)`, re-export por barrel `@/components/ui` ou convenções do Next.js como `GET`/`POST`/`generateMetadata`) e garantir que a limpeza em cascata não remova utilitários referenciados por testes ou catracas de fases anteriores. A verificação combinou análise de grafo de imports AST com checagem textual global em `src/`, `tests/`, `prisma/`, `scripts/` e `package.json`, seguida de `tsc --noEmit --noUnusedLocals`.

---

## 3. Decisões Técnicas (e Alternativas Descartadas)

- **Fechar `deleteCertificateTemplateAction` em vez de removê-la:** ela é chamada internamente por `deleteCertificateTemplateFormAction` (ponte No-JS do `<form action>`). Remover apenas o `export` fecha o segundo endpoint POST ocioso preservando o fluxo da galeria.
- **Manter `CardFooter` (`src/components/ui/card.tsx`):** primitivo mínimo (`6` linhas) do design system `Card`; mantê-lo evita churn futuro caso uma tela precise de rodapé estruturado em cartão.
- **Preservar os 234 `useState` e comentários de decisão:** a auditoria AST confirmou `0` estados não lidos/nunca alterados, `0` imports não usados e `0` blocos de código comentado órfão em `src/`.

---

## 4. ADRs

### ADR-475 — Catraca AST sobre superfície de Server Actions e componentes órfãos
- **Contexto:** No Next.js App Router, toda função `export async function` em arquivo `'use server'` gera um endpoint HTTP POST acessível em produção. A auditoria encontrou 6 Server Actions sem UI consumidora (`loadAccount`, `checkInByBadgeAction`, `requestCertificateDownloadAction`, `enterTenantAction`, `adjustXpAction`, `saveSponsorQrAction`), 1 `export` redundante (`deleteCertificateTemplateAction`) e 1 componente cliente inteiro órfão (`badge-checkin-form.tsx`).
- **Decisão:** Remover os 6 endpoints órfãos e o componente legado, remover `export` de `deleteCertificateTemplateAction` e dos 5 componentes estritamente internos, e instalar a catraca AST `tests/unit/f118-codigo-morto-e-superficie-actions.test.ts`.
- **Justificativa:** Reduz a superfície de ataque HTTP das Server Actions e impede acúmulo silencioso de telas/ações abandonadas após migrações de UX.
- **Consequências:** Toda nova função exportada em `src/app/actions/*.ts` ou componente `.tsx` em `src/components/` precisa estar ligada a um consumidor real em `src/` para o `npm test` passar.

### ADR-476 — Remoção controlada de funções mortas e limpeza em cascata com `--noUnusedLocals`
- **Contexto:** 32 funções exportadas em `src/domain/`, `src/lib/` e `src/components/` acumularam `0` referências em todo o repositório após refatorações das fases anteriores, mantendo 18 imports e helpers privados (`formatMinutes`, `bufferToStream`, `ListObjectsV2Command`, etc.) artificialmente vivos.
- **Decisão:** Remover as 32 funções verificadas por AST + busca global e executar `npx tsc --noEmit --noUnusedLocals` para eliminar toda a cascata residual.
- **Justificativa:** Menos código sem dono para manter, menor grafo de módulos e zero surpresas para quem navega serviços e domínio.
- **Consequências:** Serviços e domínio mantêm apenas contratos vivos; nenhuma regra ativa ou teste de contrato foi enfraquecido.

---

## 5. Lições Aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| A 1ª varredura AST apontou `enqueueCertificate`, `scheduleAutomationJobs`, `runFileScanSafely`, `appUrl` e `isPrivileged` como sem import estático | Eram carregadas por `await import(...)` dinâmico ou consumidas via acesso qualificado em outros módulos | Cruzamento obrigatório de grafo AST com busca de identificador em todo o repositório (`src/`, `tests/`, `prisma/`, `scripts/`, `package.json`) antes de qualquer remoção |
| Após remover as 38 funções/actions mortas, surgiram 18 erros `TS6133`/`TS6196` sob `--noUnusedLocals` | Helpers privados (`formatMinutes`, `bufferToStream`) e imports (`ListObjectsV2Command`, `Readable`, `checkInByBadgeToken`, etc.) só eram usados pelas funções removidas | Limpeza completa em cascata até `npx tsc --noEmit --noUnusedLocals` sair com código `0` |
| `f75-catalogo-de-guardas.test.ts` e `f88-suite-cache-e-catches.test.ts` falharam no `npm test` | As catracas históricas citavam a permissão `xp:adjust` (única da removida `adjustXpAction`) e o log de `emailQueueStats` (removida) | Atualização cirúrgica dos dois catálogos de catraca para refletir as portas e logs vivos da base |

---

## 6. Evidência de Verificação

- `(Get-Item AGENTS.md).Length`: verificado ≤ `64.800` bytes
- `npx tsc --noEmit --noUnusedLocals`: 0 erros
- `npm run lint`: 0 erros, 0 warnings
- `npm run typecheck`: 0 erros
- `npm test`: **301 arquivos · 4.961 testes passando**
- `npm run build`: Compiled successfully
- `npm run db:verify`: Contrato íntegro
- `npm run db:verify:isolation`: 9/9 verificações passaram
- `npm run db:partitions`: partições do intervalo já criadas
- `npm run test:e2e`: **565 passando + 1 skip** (`566` casos, `23/23` em `f62-regressao-visual.spec.ts` sem regerar snapshots)

---

## 7. Comandos Operacionais

```bash
npx tsc --noEmit --noUnusedLocals
npm run lint
npm run typecheck
npm test
npm run build
docker compose --profile app up -d --build web worker
npm run test:e2e
npm run db:verify
npm run db:verify:isolation
npm run db:partitions
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- **42 dívidas técnicas mantidas** (limpeza estrutural sem abertura de novas dívidas).
- As demais ~58 funções utilitárias com `export` usado apenas no próprio arquivo podem ter o `export` removido oportunisticamente conforme os arquivos forem tocados.

---

## 9. Checklist de Aceite

- [x] `src/components/gamification/badge-checkin-form.tsx` removido
- [x] 6 Server Actions órfãs removidas + `export` fechado em `deleteCertificateTemplateAction` e nos 5 componentes internos
- [x] 32 funções mortas + 18 imports/helpers em cascata removidos
- [x] Catraca AST `tests/unit/f118-codigo-morto-e-superficie-actions.test.ts` verde
- [x] `npx tsc --noEmit --noUnusedLocals`, `npm run lint`, `npm run typecheck`, `npm run build` verdes
- [x] `npm test` (`301` arquivos · `4.961` testes) e `npm run test:e2e` (`565` passando + `1` skip) verdes
- [x] `db:verify`, `db:verify:isolation` (`9/9`) e `db:partitions` verdes
- [x] `AGENTS.md` ≤ `64.800` bytes e `README.md` atualizado
