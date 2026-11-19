# FASE 117 — Consolidação DRY de Primitivos de UI, Hooks e Utilitários Compartilhados

---

## 1. Sumário Executivo

A **FASE 117** eliminou os **9 focos reais de código duplicado** levantados nos **655 arquivos** `.ts`/`.tsx` de `src/` — preservando **zero regressão visual** (`0 px` nos 23 baselines de `f62-regressao-visual.spec.ts`), a pureza de `src/domain/**` e todos os contratos de `data-testid` e Server Actions — e instalou uma **catraca estrutural** que impede o retorno das cópias duplicadas.

| Entrega | Arquivos criados / migrados | Resultado |
|---|---|---|
| **Domínio compartilhado (`ADR-472`)** | `src/domain/shared/json-record.ts`, `number-rules.ts`, `text-rules.ts`, `date-format.ts`, `parseImageMime` (`image-rules.ts`), `buildPublicAssetUrl` (`s3-client.ts`), `getRedisUrl` (`src/lib/redis/config.ts`) | Eliminou 8 cópias de `settingsObject`/`asRecord`, 4 de `round2`, 3 de `asImageMime`, 3 de `redisUrl`, 3 de `formatMoment` e 3 de `toLocalInput` |
| **HTTP, Actions e Crypto de Cliente (`ADR-473`)** | `src/lib/http/form-data.ts`, `src/lib/http/request-meta.ts`, `src/lib/client/file-crypto.ts` + 25 arquivos de Server Actions, rotas e uploaders | Eliminou 8 cópias de `nullable`, 15 leituras manuais de `x-forwarded-for`, 4 cópias de `sha256Hex`/`readMagicBytes` e unificou `*ActionState` sobre `ActionGuardState` |
| **Hooks e Primitivos de UI (`ADR-474`)** | `src/hooks/use-is-interactive.ts`, `src/hooks/use-copy-to-clipboard.ts`, `src/components/ui/copy-button.tsx`, `action-feedback.tsx`, `submit-button.tsx` | Eliminou 3 cópias de `useIsInteractive`, 6 implementações manuais de `navigator.clipboard.writeText`, 3 banners `Feedback` e definições repetidas de `SubmitButton` |
| **Testes e Catraca DRY** | `tests/unit/f117-dry-utilitarios-hooks-e-ui.test.ts` (`12` testes) | Valida bordas de todos os utilitários e impede estaticamente o retorno de cópias duplicadas em `src/` |

**Números da fase:** `12` módulos canônicos novos · `~50` arquivos migrados · `0` migrações de banco · **`+12` testes Vitest** (`300` arquivos · **`4.958` testes**) · **`565` E2E passando + `1` skip** (`23/23` em `f62` sem regerar snapshots).

---

## 2. O Problema Mais Difícil da Fase

Consolidar abstrações transversais em uma base madura de 116 fases sem quebrar três fronteiras invisíveis:
1. **Fronteira de domínio puro (`src/domain/**`)** — utilitários de formatação de data, JSON seguro e arredondamento precisam funcionar no domínio, no servidor e no cliente sem importar Prisma ou Next.
2. **Fronteira ESM do Playwright** — `src/lib/http/request-meta.ts` é importado por rotas e serviços; importar `next/headers` estaticamente quebraria specs E2E que importam `src/lib/**` diretamente no Node ESM (lição herdada da F116).
3. **Fronteira visual e de contrato (`f62-regressao-visual.spec.ts` e `data-testid`)** — substituir `SubmitButton` e `Feedback` locais por primitivos de `@/components/ui` não pode alterar um único pixel dos 23 snapshots existentes nem quebrar os seletores `data-testid`/`data-ok` das 119 suítes E2E.

---

## 3. Decisões Técnicas (e Alternativas Descartadas)

- **Dois leitores de registro JSON (`asRecordOrNull` × `asRecord`):** regras de domínio distinguem "ausente/inválido (`null`)" de objeto válido, enquanto serviços de escrita fazem merge (`{ ...asRecord(settings), ... }`). Expor ambas evita coerções silenciosas.
- **`import('next/headers')` preguiçoso em `readRequestMeta()`:** mantém `extractClientIp(headers)` 100% puro e livre de `next/headers`, evitando erros de loader ESM em testes fora do runtime Next.js.
- **O que ficou explicitamente fora (anti-over-engineering):** `maskEmail` (`logger.ts` vs `participant-rules.ts`) foi mantido separado por ter contratos distintos (log técnico `[omitido]` vs tabela de UI `'—'`); as três esteiras de upload compartilham apenas `file-crypto.ts` preservando seus fluxos específicos de formulário.

---

## 4. ADRs

### ADR-472 — Utilitários puros compartilhados em `src/domain/shared/` e helpers canônicos de mídia/Redis
- **Contexto:** Funções idênticas (`settingsObject`/`asRecord`, `round2`, `formatMoment`, `toLocalInput`, `asImageMime`, `redisUrl`) estavam copiadas entre 3 e 10 módulos distintos, criando risco de divergência (ex.: `-0` em `round2` tratado só em `card-presentation.ts`).
- **Decisão:** Criar `src/domain/shared/{json-record,number-rules,text-rules,date-format}.ts` (100% puros, com `Intl.DateTimeFormat` cacheado por `(preset, timeZone)`), `parseImageMime` em `image-rules.ts`, `buildPublicAssetUrl` em `s3-client.ts` e `getRedisUrl` em `src/lib/redis/config.ts`.
- **Justificativa:** Garante normalização consistente (como `-0 → 0` em todo `round2` e allowlist única de MIME de imagem) sem violar a pureza de `src/domain/**`.
- **Consequências:** Novos módulos de domínio, servidor ou cliente devem importar esses utilitários; a catraca em `f117-dry-utilitarios-hooks-e-ui.test.ts` falha se cópias locais reaparecerem.

### ADR-473 — Padronização de `FormData`, metadados HTTP, `ActionGuardState` e Web Crypto de upload
- **Contexto:** 8 arquivos de Server Actions copiavam `nullable`, 12 arquivos liam `x-forwarded-for` manualmente (com divergências como `participant-actions.ts:230` sem `.split(',')[0]`), 4 arquivos copiavam `sha256Hex`/`readMagicBytes` e 25+ actions redeclaravam a mesma interface `*ActionState`.
- **Decisão:** Centralizar `src/lib/http/form-data.ts`, `src/lib/http/request-meta.ts` (com `import('next/headers')` preguiçoso), `src/lib/client/file-crypto.ts` e unificar `*ActionState` como alias ou extensão de `ActionGuardState`.
- **Justificativa:** Fecha inconsistências reais (como `formInt('', fallback)` e `x-forwarded-for` multi-hop), reduz código repetido em Server Actions e torna todo estado de ação compatível com `<ActionFeedback>`.
- **Consequências:** Toda nova Server Action deve reutilizar `form-data.ts`, `readRequestMeta()`/`extractClientIp()` e `ActionGuardState`.

### ADR-474 — Hooks `useIsInteractive` / `useCopyToClipboard` e primitivos `CopyButton`, `ActionFeedback` e `SubmitButton`
- **Contexto:** `useSyncExternalStore` de hidratação estava copiado em 3 componentes, `navigator.clipboard.writeText` em 6 (alguns sem `clearTimeout` no unmount), `Feedback` em 5 e `SubmitButton` em 25 arquivos.
- **Decisão:** Criar `src/hooks/use-is-interactive.ts`, `src/hooks/use-copy-to-clipboard.ts` e os primitivos `'use client'` `CopyButton`, `ActionFeedback` e `SubmitButton` reexportados pelo ponto único `@/components/ui`.
- **Justificativa:** Elimina vazamentos de timer em unmount, uniformiza acessibilidade (`aria-hidden`, `data-ok`, `disabled` durante `pending`) e preserva a fronteira server/client do barrel `@/components/ui`.
- **Consequências:** Novos botões de cópia, banners de ação e botões de envio devem compor esses primitivos em vez de duplicar estado local.

---

## 5. Lições Aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `formInt('', 7)` devolveu `0` em vez do `fallback` `7` no teste unitário | `Number('')` em JavaScript retorna `0` (`Number.isFinite(0) === true`), bug herdado do `toInt` antigo de `admin-actions.ts` | Extrair com `formNullableText(value)` antes de chamar `Number(text)`, preservando `formInt('0', 7) === 0` e `formInt('', 7) === 7` |
| `tsc --noEmit` reportou `Cannot find name 'setCopied'` em `share-card-panel.tsx:134` | Um `useEffect` antigo de limpeza do estado `copied` sobreviveu após migrar para `useCopyToClipboard(2_500)` | Remoção do `useEffect` redundante (agora gerenciado pelo hook com `clearTimeout` no unmount) |
| ESLint acusou `useState` não usado em `proceedings-admin-panel.tsx:3` | `copiedOai` era o único `useState` do componente antes da migração para `useCopyToClipboard` | Remoção do import `useState` não utilizado |
| Catraca AST da F96 (`f96-arquitetura-pool-payload-hidratacao-e-fronteira.test.ts`) bloqueou `@/lib/client/file-crypto` em 2 Client Components | Todo import de valor de `@/lib/*` por arquivo `'use client'` exige declaração explícita em `CLIENT_LIB_VALUE_ALLOWLIST` | Registro explícito de `@/lib/client/file-crypto` (módulo 100% Web Crypto/Blob, sem dependências de servidor) na allowlist da F96 |
| E2E `peer-review.spec.ts` e `f111-anais-publicacao-e-indexacao.spec.ts` falharam com `"Too big: expected array to have <=8 items"` no upload de PDF | `readMagicBytes(selected)` usou o padrão de 16 bytes (necessário para AVIF/imagens), excedendo o teto `max(8)` do schema Zod de submissões em `review-actions.ts` | Passar explicitamente `readMagicBytes(selected, 5)` em `submission-uploader.tsx` preservando a assinatura de 5 bytes do PDF (`%PDF-`) |

---

## 6. Evidência de Verificação

- `(Get-Item AGENTS.md).Length`: verificado ≤ `64.800` bytes
- `npm run lint`: 0 erros, 0 warnings
- `npm run typecheck`: 0 erros
- `npm test`: **300 arquivos · 4.958 testes passando**
- `npm run build`: Compiled successfully
- `npm run db:verify`: Contrato íntegro
- `npm run db:verify:isolation`: 9/9 verificações passaram
- `npm run db:partitions`: partições do intervalo já criadas
- `npm run test:e2e`: **565 passando + 1 skip** (`566` casos, incluindo `23/23` em `f62-regressao-visual.spec.ts` sem regerar snapshots)

---

## 7. Comandos Operacionais

```bash
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

- **42 dívidas técnicas mantidas** (fase puramente estrutural DRY, sem abertura de novas dívidas).
- **Migração gradual restante:** os demais `SubmitButton` locais com marcação muito específica de tela e as chamadas pontuais de `.toLocale*String('pt-BR')` podem adotar `<SubmitButton>` e `date-format.ts` oportunisticamente quando essas telas forem editadas em fases futuras.

---

## 9. Checklist de Aceite

- [x] `src/domain/shared/**` 100% puro (sem Prisma, Next ou `@/lib`), preso por catraca
- [x] `asRecord`/`asRecordOrNull`, `round2`, `stripDiacritics`, `date-format`, `parseImageMime`, `buildPublicAssetUrl` e `getRedisUrl` extraídos e aplicados
- [x] `form-data.ts`, `request-meta.ts` (lazy `next/headers`), `file-crypto.ts` e unificação de `ActionGuardState` aplicados
- [x] `useIsInteractive`, `useCopyToClipboard`, `<CopyButton>`, `<ActionFeedback>` e `<SubmitButton>` publicados em `@/hooks` e `@/components/ui`
- [x] Catraca estrutural DRY verde impedindo o retorno das cópias duplicadas
- [x] `f62-regressao-visual.spec.ts` passando `23/23` sem `--update-snapshots`
- [x] Bateria completa de verificação verde (`lint`, `typecheck`, `npm test`, `build`, `db:verify*`, `test:e2e`)
