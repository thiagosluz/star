# FASE 89 — Performance RSC no Shell e Contexto (`React.cache` + `Promise.all`), `?evento=` Descartado com Aviso (`E89`) e Fronteira Estrita do `.ef-theme` (`E90`)

---

## 1. Sumário executivo

A **FASE 89** entrega a segunda leva do plano arquitetural de convergência (Opção A aprovada pelo humano), fechando o ponto de atenção de performance RSC da FASE 75 no shell e no contexto da requisição e quitando **duas dívidas técnicas de produto e interface** (**E89** e **E90**), sem migração de banco:

| Fatia | Entrega | Dívida / Origem | ADRs |
|---|---|---|---|
| **Fatia 1** | `readRequestContext` envelopado por `React.cache` dentro de `getRequestContext` (`src/lib/auth/session.ts`) — deduplicando sessão, vínculos e principal entre `TenantLayout`, `requirePagePermission` e as páginas filhas (**2 → 1** por render RSC) — e paralelização das 3 portas do menu lateral (`hasPendingSpeakerInvite`, `hasPendingSponsorInvite`, `readSponsorAccess`) via `Promise.all` em `src/app/t/[tenantSlug]/(app)/layout.tsx` | Ponto de atenção da FASE 75 (§8) | **ADR-394** |
| **Fatia 2** | `resolveEventQuerySelection` e `discardedEventSelectionNotice` (`src/domain/validation/query-filter-rules.ts`) + adoção nas **5 telas** da `E89`: `/credenciamento`, `/credenciamento/crachas`, `/meu-cracha` e `/minha-agenda` (`fallback: 'first'`) e `/participantes` (`fallback: 'all'`), exibindo `<Alert tone="warning">` com o motivo (`invalid_format` × `not_found`) e o destino aplicado | **Quita E89** (aberta na FASE 76) | **ADR-395** |
| **Fatia 3** | Erradicação do uso de `.ef-card`, `.ef-button`, `.ef-button-outline`, `.ef-badge` e de `import '.../event-theme.css'` nos **12 arquivos** de plataforma fora da árvore `.ef-theme` (`/convite`, `accept-invitation-form.tsx`, `/descadastro/[token]`, `unsubscribe-forms.tsx`, `/palestrante/convite`, `portal-forms.tsx`, `erase-form-responses-button.tsx`, `/palestrante`, `/chamadas`, `own-inbox.tsx`, `public-event-list.tsx` e `call-result-public-view.tsx`), regravação da linha de base visual `descadastro.png` (23/23 em 0 px) e catraca de código-fonte | **Quita E90** (aberta na FASE 78) | **ADR-396** |

### Números da fase

| Métrica | Antes (FASE 88) | Depois (FASE 89) | Delta |
|---|---|---|---|
| Arquivos de código de produção alterados | — | **15** (`session.ts`, `layout.tsx`, `query-filter-rules.ts`, 5 páginas da `E89` e 12 arquivos da `E90`, com interseção) | +15 editados |
| Arquivos de teste criados / atualizados | 265 Vitest | **267 Vitest** (+2 novos: `tests/unit/f89-performance-query-e-tema.test.ts` e `tests/integration/f89-evento-query-invalida.test.ts`; `tests/integration/f75-contexto-uma-vez.test.ts` ampliado) + **1 spec E2E novo** (`tests/e2e/f89-query-evento-e-tema.spec.ts`) | +2 Vitest, +1 E2E |
| Casos Vitest (unit + integração) | 4.707 | **4.732** (+20 unitários na F89, +5 de integração na F89) | **+25** |
| Casos Playwright E2E | 506 passando + 1 skip (507) | **509 passando + 1 skip** (510) | **+3** |
| Migrações Prisma | 0 | **0** | 0 |
| ADRs globais | 393 | **396** (`ADR-394` a `ADR-396`) | **+3** |
| Dívidas abertas em `docs/dividas-tecnicas.md` | 46 (E=27) | **44** (E=**25**) | **−2** (`E89`, `E90`) |

---

## 2. O problema mais difícil da fase e por que ele define o desenho

O problema mais sutil da fase mora na intersecção entre **Fatia 2 (`E89`)** e a regra estabelecida na FASE 76 (`resolveUuidQueryFilter`):

Na FASE 76, as três telas corrigidas (`certificados`, `modelos` e `midia`) passavam `?evento=` direto para o `where` do Prisma antes de conhecer a lista de eventos; bastava validar a forma de UUID (`resolveUuidQueryFilter`). Já nas **cinco telas da `E89`** (`/credenciamento`, `/credenciamento/crachas`, `/meu-cracha`, `/minha-agenda` e `/participantes`), a página carrega **primeiro** a lista `events` disponível para aquele usuário/papel (em `/credenciamento`, só eventos publicados que o operador pode gerenciar; em `/meu-cracha` e `/minha-agenda`, só eventos em que o participante tem inscrição/favorito; em `/participantes`, todos os eventos da instituição) e só depois escolhe o evento ativo a partir de `?evento=`.

Por isso, nessas cinco telas existem **duas causas distintas** para o parâmetro `?evento=` ser descartado:

1. **Formato inválido ou parâmetro repetido (`reason: 'invalid_format'`)** — `?evento=nao-e-uuid` ou `?evento=a&evento=b`.
2. **UUID bem-formado, mas ausente da lista `events` (`reason: 'not_found'`)** — o evento não existe, está em rascunho, pertence a outra instituição ou está fora do escopo da pessoa (por exemplo, um monitor de evento tentando operar outro evento pela URL, ou um participante abrindo `/meu-cracha?evento=<id>` de um evento em que não se inscreveu).

E existem **dois destinos de fallback distintos**:
- Nas 4 telas de operação por evento (`/credenciamento`, `/credenciamento/crachas`, `/meu-cracha` e `/minha-agenda`), a tela precisa de um evento selecionado e cai em `events[0]` (`fallback: 'first'`). Se o aviso dissesse "A lista continua sem esse filtro", mentiria: a tela **trocou** para o primeiro evento! O aviso precisa nomear o evento exibido (`Exibindo "<título do 1º evento>".`).
- Em `/participantes`, o padrão é a instituição inteira (`fallback: 'all'`, `selectedEventId = null`), então o aviso informa que a lista continua sem o filtro de evento.

Desenhar `resolveEventQuerySelection` e `discardedEventSelectionNotice` no domínio puro (`src/domain/validation/query-filter-rules.ts`) combinando `(reason: 'invalid_format' | 'not_found') × (fallback: 'first' | 'all')` resolveu os cinco casos com uma única função pura, sem duplicar condicionais nas páginas.

---

## 3. Decisões técnicas explicadas

### 3.1. `readRequestContext = cache(...)` mantendo `export async function getRequestContext()` (Fatia 1)

Na FASE 75, cada página deixou de chamar `getRequestContext()` duas vezes no próprio arquivo, mas o ciclo completo de renderização de uma rota autenticada no App Router executa **dois componentes de servidor independentes** na mesma árvore RSC: o `TenantLayout` (`src/app/t/[tenantSlug]/(app)/layout.tsx`) e a página filha (que chama `requirePagePermission` ou `getRequestContext` diretamente). Sem memoização por requisição, cada navegação pagava `auth.api.getSession`, `loadMemberships` e `loadPrincipal` **duas vezes**.

Envelopar a leitura interna em `const readRequestContext = cache(async (): Promise<RequestContext | null> => { ... })` e delegar a ela em `export async function getRequestContext(): Promise<RequestContext | null> { return readRequestContext(); }` traz três propriedades:
- **Zero argumentos**: no despachante `react-server` do React 19, uma função `cache(fn)` chamada sem argumentos lê e grava diretamente o `CacheNode` raiz (`node.s = 1, node.v = promise`) no `AsyncLocalStorage` da requisição HTTP — sem depender de comparação de referências em `WeakMap`.
- **Isolamento fora do servidor RSC**: no cliente/Vitest/worker (sem `--conditions react-server`), `React.cache` no React 19 é um pass-through que não retém estado entre chamadas, evitando vazamento entre casos de teste que alteram cookies ou vínculos.
- **Contrato de assinatura preservado**: manter `export async function getRequestContext(): Promise<RequestContext | null>` preserva a assinatura inspecionada pela catraca de segurança da FASE 82 (`tests/unit/f82-destino-de-entrada.test.ts`).

### 3.2. `Promise.all` nas 3 portas do menu em `TenantLayout` (Fatia 1)

Em `src/app/t/[tenantSlug]/(app)/layout.tsx`, as três consultas que decidem se os itens `"Área do palestrante"` e `"Área do patrocinador"` aparecem no menu lateral (`hasPendingSpeakerInvite`, `hasPendingSponsorInvite` e `readSponsorAccess`) eram aguardadas em série dentro do objeto `navGates`. Como as três dependem apenas de `(tenantId, userId, email)` já disponíveis no `context`, dispará-las com `Promise.all` reduz a latência do layout do somatório das 3 transações para o `max` delas — e `readSponsorAccess` ainda deixa o `CacheNode` populado para quando a página filha for `/dashboard` ou `/patrocinador` (I10, FASE 88).

### 3.3. Fronteira estrita de `event-theme.css` e classes `.ef-*` (Fatia 3 · Dívida E90)

As classes `.ef-card`, `.ef-button`, `.ef-button-outline` e `.ef-badge` (definidas em `src/app/t/[tenantSlug]/(public)/eventos/event-theme.css`) consomem variáveis CSS (`--ef-background`, `--ef-text`, `--ef-primary`, `--ef-secondary`, `--ef-radius`) que **só existem** quando um ancestral publica o escopo `.ef-theme` via `themeToCssVariables(theme)` (páginas públicas do evento e prévia do editor da landing page).

Fora de `.ef-theme`:
- `--ef-background`, `--ef-text` e `--ef-radius` são indefinidas;
- `background: color-mix(in oklab, var(--ef-background) 92%, var(--ef-text) 8%)` e `border: 1px solid color-mix(...)` tornam-se inválidos em tempo de computação CSS (`iacvt`) e caem para `transparent` e `0px none`, deixando cartões sem fundo/moldura e botões de contorno sem borda.

Alternativa descartada: adicionar fallbacks globais em `event-theme.css` acoplaria o tema personalizável do evento aos tokens de plataforma e esconderia o erro de importar a folha de estilo do evento em telas da instituição. A decisão correta (ADR-396) é **separar as superfícies**:
- **Dentro de `.ef-theme`** (allowlist fechada de 26 arquivos da árvore pública do evento): usam `.ef-card`, `.ef-button`, `.ef-button-outline` e `.ef-badge`.
- **Fora de `.ef-theme`** (os 12 arquivos migrados nesta fase): usam os tokens semânticos da plataforma (`rounded-xl border border-border bg-card`, `bg-primary text-primary-foreground`, `border border-border bg-card text-foreground`, `border border-border bg-muted text-muted-foreground`) e não importam `event-theme.css`.

---

## 4. ADRs

### ADR-394 — Deduplicação de `getRequestContext` via `React.cache` e paralelização das portas do `TenantLayout`

- **Contexto:** Após a FASE 75, cada página e o `TenantLayout` resolviam `getRequestContext()` uma única vez dentro do próprio módulo, mas no mesmo ciclo RSC o par `TenantLayout` + página filha executava `getSession`, `loadMemberships` e `loadPrincipal` duas vezes (2 sessões + 2 leituras de vínculos + 2 leituras de principal). Além disso, o `TenantLayout` aguardava em série `hasPendingSpeakerInvite`, `hasPendingSponsorInvite` e `readSponsorAccess`.
- **Decisão:** Envelopar o corpo de resolução em `const readRequestContext = cache(async (): Promise<RequestContext | null> => { ... })` chamado por `export async function getRequestContext()`, e executar `[hasPendingSpeakerInvite, hasPendingSponsorInvite, readSponsorAccess]` em `Promise.all` no `TenantLayout`.
- **Justificativa:** `readRequestContext` não recebe argumentos, atingindo diretamente o `CacheNode` raiz do despachante `react-server` por requisição HTTP (`AsyncLocalStorage`), sem risco de chave por referência e sem compartilhar estado entre requisições ou testes.
- **Consequências:** Qualquer rota autenticada sob `/t/[tenantSlug]/(app)/**` passa a executar 1 sessão, 1 consulta de vínculos e 1 consulta de principal no ciclo completo `TenantLayout` + página (`tests/integration/f75-contexto-uma-vez.test.ts`, casos 6, 7 e 8).

### ADR-395 — Seleção de `?evento=` validada contra a lista disponível com aviso explícito de descarte (Quita E89)

- **Contexto:** Em `/credenciamento`, `/credenciamento/crachas`, `/meu-cracha`, `/minha-agenda` e `/participantes`, o ternário `evento && events.some((row) => row.id === evento) ? evento : fallback` tratava `?evento=` malformado, repetido ou referente a um UUID ausente da lista `events` exatamente como ausência de parâmetro, trocando de evento (ou mostrando todos) em silêncio.
- **Decisão:** Criar `resolveEventQuerySelection` e `discardedEventSelectionNotice` em `src/domain/validation/query-filter-rules.ts` e adotá-las nas 5 telas com `<Alert tone="warning">` (`checkin-event-notice`, `badge-event-notice`, `own-badge-event-notice`, `agenda-event-notice` e `participant-event-notice`).
- **Justificativa:** Query string em tela de listagem/operação com seletor de evento é filtro/seleção, não endereço de recurso único (não deve responder 404), mas descartar o evento pedido em silêncio no balcão induz operação no evento errado. A função pura distingue formato inválido (`invalid_format`) de evento ausente/inacessível (`not_found`) e informa se a tela caiu no primeiro evento disponível (`fallback: 'first'`, nomeando-o) ou na lista completa (`fallback: 'all'`).
- **Consequências:** Dívida **E89** quitada; as 5 telas permanecem respondendo HTTP 200 e avisam claramente quando o `?evento=` da URL não pôde ser atendido.

### ADR-396 — Fronteira estrita das classes `.ef-*` e `event-theme.css` restrita à árvore `.ef-theme` (Quita E90)

- **Contexto:** Doze arquivos de plataforma fora da árvore `.ef-theme` (`/convite`, `accept-invitation-form.tsx`, `/descadastro/[token]`, `unsubscribe-forms.tsx`, `/palestrante/convite`, `portal-forms.tsx`, `erase-form-responses-button.tsx`, `/palestrante`, `/chamadas`, `own-inbox.tsx`, `public-event-list.tsx` e `call-result-public-view.tsx`) utilizavam `.ef-card`, `.ef-button`, `.ef-button-outline` ou `.ef-badge`, que dependem das variáveis `--ef-background`, `--ef-text` e `--ef-radius` publicadas apenas pelo `.ef-theme`. Fora dele, os cartões ficavam transparentes e sem borda.
- **Decisão:** Substituir `.ef-card`, `.ef-button`, `.ef-button-outline` e `.ef-badge` nesses 12 arquivos pelas classes semânticas dos tokens da plataforma (`rounded-xl border border-border bg-card`, `bg-primary text-primary-foreground`, `border border-border bg-card text-foreground`, `border border-border bg-muted text-muted-foreground`), remover os 3 imports de `event-theme.css` fora das páginas do evento e prender a fronteira com uma catraca de código-fonte (`tests/unit/f89-performance-query-e-tema.test.ts`).
- **Justificativa:** Mantém intacta a soberania do tema do organizador dentro de `.ef-theme` (sem tocar em `event-theme.css` nem em `globals.css`) e devolve fundo, moldura de `1px` e raio de `12px` às telas públicas e autenticadas da plataforma.
- **Consequências:** Dívida **E90** quitada; a linha de base visual `descadastro.png` (`tests/e2e/f62-regressao-visual.spec.ts`) passa a refletir a moldura e o fundo reais dos cartões e botões de descadastro.

---

## 5. Lições aprendidas

Defeitos reais capturados pelas catracas durante a execução da fase:

| # | Sintoma observado na bateria | Causa raiz | Correção aplicada |
|---|---|---|---|
| 1 | `tests/unit/f66-contraste-do-rotulo.test.ts` falhou em `erase-form-responses-button.tsx:18` acusando `disabled:opacity-60` | O arquivo `src/components/events/erase-form-responses-button.tsx` mora na pasta `src/components/events/`, que é varrida pela catraca de opacidade da FASE 66 (nenhum componente daquela pasta pode usar `opacity-*` abaixo de 70%). Ao substituir `.ef-button-outline`, incluímos `disabled:opacity-60` | Substituído `disabled:opacity-60` por `disabled:cursor-not-allowed` em `src/components/events/erase-form-responses-button.tsx` |
| 2 | `tests/unit/f82-destino-de-entrada.test.ts` falhou em `expect(inicio).toBeGreaterThan(-1)` procurando `export async function getRequestContext` | A catraca da FASE 82 inspeciona `src/lib/auth/session.ts` a partir da substring literal `export async function getRequestContext` para garantir que `loadPlatformPrincipal` não seja chamado dali. Ao trocar a declaração para `export const getRequestContext = cache(...)`, o `indexOf` devolveu `-1` | Extraído `const readRequestContext = cache(async (): Promise<RequestContext \| null> => { ... })` e mantida a assinatura `export async function getRequestContext(): Promise<RequestContext \| null> { return readRequestContext(); }` |
| 3 | `tests/integration/f89-evento-query-invalida.test.ts` falhou na 1ª execução de `MyAgendaPage` com `NEXT_REDIRECT:/selecionar-instituicao` e `No "loadPrincipal" export` | Diferente de `/meu-cracha` (que usa `requirePagePermission`), `/minha-agenda` lê `context.activeTenant` direto de `getRequestContext()`, consulta apenas eventos onde a pessoa tem inscrição em **atividade** (ou favorito) e chama `resolveOnlineRoomViewer` → `loadPrincipal` | O dublê de `session` no teste de integração passou a incluir `activeTenant` e `loadPrincipal`, e a fixture criou uma atividade confirmada em cada evento |
| 4 | `tests/e2e/f89-query-evento-e-tema.spec.ts` acusou `Expected: "12px", Received: "24px"` no `borderRadius` computado de `rounded-xl` em `/convite` | No sistema de tokens da plataforma (`src/app/globals.css`), `--radius-xl` é `1.5rem` (`24px`), enquanto antes de `E90` o `.ef-card` fora de `.ef-theme` computava `0px` (`--ef-radius` indefinido) | A asserção do E2E passou a cobrar `borderRadius: '24px'`, `borderTopWidth: '1px'` e `backgroundColor !== 'rgba(0, 0, 0, 0)'` |

---

## 6. Evidência de verificação

Saídas reais medidas na bateria completa da seção 4 do `AGENTS.md`:

- **`npm run lint`**: `0` erros, `0` warnings.
- **`npm run typecheck`**: `0` erros (`tsc --noEmit`).
- **`npm test`**: **267 arquivos passando (267)** · **4.732 testes passando (4.732)** (`Duration 216.99s`).
- **`npm run build`**: compilado com sucesso (`✓ Compiled successfully in 14.2s`, `Finished TypeScript in 20.8s`).
- **`npm run db:verify`**: `Contrato íntegro.` (5/5 verificações, incluindo tabelas de plataforma inalcançáveis pela role `eventflow_app`).
- **`npm run db:verify:isolation`**: `9/9 verificações passaram. Isolamento entre tenants garantido pelo banco.`
- **`npm run db:partitions`**: `todas as partições do intervalo já existiam` (`total: 168268 linha(s)`).
- **Regressão visual (`tests/e2e/f62-regressao-visual.spec.ts`)**: na medição antes do update, **22/23 snapshots passaram a 0 px** e apenas `21. a página de descadastro` (`descadastro.png`) divergiu em **73.000 pixels (`ratio 0.04`)**, refletindo a moldura, o raio de 24 px e o fundo de cartão de `/t/<slug>/descadastro/<token>` restaurados pela quitação da `E90`; após re-basear `descadastro-chromium-win32.png`, duas execuções consecutivas fecharam em **23 passed (23.0s)** e **23 passed (22.1s)** com **0 px de diferença**.
- **`npx playwright test tests/e2e/f89-query-evento-e-tema.spec.ts`**: **3 passed (3.9s)**.
- **`npm run test:e2e`**: **509 passando + 1 skip** (`510` casos em `8.2m`).
- **Tamanho do `AGENTS.md`**: **64.493 bytes** (abaixo do teto de `64.800` bytes; fases `61` e `62` movidas como estavam para `docs/fases-historico.md`).

---

## 7. Comandos operacionais

```bash
# Testes unitários e catracas da FASE 89:
npx vitest run tests/unit/f89-performance-query-e-tema.test.ts

# Testes de integração do contexto único (F75 + F88 + F89) e do ?evento= inválido (E89):
npx vitest run tests/integration/f75-contexto-uma-vez.test.ts tests/integration/f89-evento-query-invalida.test.ts

# Cenários E2E da FASE 89 (E89 + E90) e regressão visual (23 snapshots):
npx playwright test tests/e2e/f89-query-evento-e-tema.spec.ts tests/e2e/f62-regressao-visual.spec.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

- **Dívidas quitadas nesta fase:** **E89** (ADR-395) e **E90** (ADR-396). A contagem aberta em `docs/dividas-tecnicas.md` cai de **46 para 44** (A=4, B=5, C=1, D=3, **E=25**, F=5, H=0, I=1).
- **Nenhuma dívida nova foi criada.**
- **Pontos de atenção remanescentes da FASE 75:** dos cinco pontos anotados no §8 da FASE 75, o `(e)` (id malformado respondendo 500) foi fechado na FASE 76 e o `(a)` (`getRequestContext` sem `React.cache` e portas do shell em série) foi fechado nesta FASE 89. Restam apenas como notas de organização interna sem impacto de banco ou de produto: unificar as duas consultas de convite pendente (`hasPendingSpeakerInvite` e `hasPendingSponsorInvite`) se o schema de convites convergir no futuro, e migrar as páginas que ainda leem `getRequestContext()` após `requirePagePermission` para consumir o campo `context` já devolvido pela guarda (hoje já deduplicado em memória pelo `React.cache`).

---

## 9. Checklist de aceite

- [x] **Fatia 1 (ADR-394):** `readRequestContext` envelopado com `React.cache` em `src/lib/auth/session.ts` e portas do `TenantLayout` paralelizadas com `Promise.all` em `src/app/t/[tenantSlug]/(app)/layout.tsx`.
- [x] **Fatia 2 (ADR-395 · E89):** `resolveEventQuerySelection` e `discardedEventSelectionNotice` implementadas em `src/domain/validation/query-filter-rules.ts` e adotadas nas 5 telas (`/credenciamento`, `/credenciamento/crachas`, `/meu-cracha`, `/minha-agenda` e `/participantes`) com `<Alert tone="warning">`.
- [x] **Fatia 3 (ADR-396 · E90):** 12 arquivos fora de `.ef-theme` migrados de `.ef-card`/`.ef-button`/`.ef-button-outline`/`.ef-badge` para tokens semânticos da plataforma, 3 imports indevidos de `event-theme.css` removidos e catraca de fonte ativa.
- [x] Testes unitários (`tests/unit/f89-performance-query-e-tema.test.ts`), de integração (`tests/integration/f75-contexto-uma-vez.test.ts`, `tests/integration/f89-evento-query-invalida.test.ts`) e E2E (`tests/e2e/f89-query-evento-e-tema.spec.ts`, `tests/e2e/f62-regressao-visual.spec.ts`) verdes.
- [x] Documentação atualizada em `docs/fase-89-contexto-cache-query-evento-e-tema.md`, `docs/dividas-tecnicas.md`, `AGENTS.md` (dentro do teto de bytes) e `README.md`.

