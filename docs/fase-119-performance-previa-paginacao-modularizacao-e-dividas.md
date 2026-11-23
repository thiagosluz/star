# FASE 119 — Performance da Prévia da API (`B11`), Paginação do Acervo de Mídia, Modularização Interna de Serviços e Fechamento de `I8` + `E95`

> **Escopo:** Reduzir de `5×` para `1×` as leituras de banco na prévia da API do evento (`B11`, `ADR-477`), entregar paginação real por query string (`?pagina=N`) sem JavaScript na Biblioteca de Mídia (`ADR-478`), modularizar internamente `registration-service.ts` e `certificate-service.ts` sem alterar contratos públicos nem quebrar catracas AST (`ADR-479`), atualizar a senha legada de fixture/seed para `Koveno` (`E95`) e blindar por catraca a sincronia documental entre `AGENTS.md`, `README.md`, `docs/dividas-tecnicas.md` e `docs/armadilhas.md` (`I8`, `ADR-480`).

---

## 1. Sumário Executivo e Entregas

| Frente / Dívida | Arquivos Principais | Resultado Objetivo | ADR |
|---|---|---|---|
| **Quitação de `B11` (Prévia da API em leitura única)** | `src/lib/api/event-api-route-handlers.ts`, `src/lib/api/event-api-organizer-preview.ts` | `buildEventApiPreviews` compartilha `resolveTenant`, `verifyKey` e `loadProjections` memoizados por render para todos os 5 recursos (`5× → 1×`), mantendo 100% das portas HTTP da rota | `ADR-477` |
| **Paginação Real no Acervo de Mídia** | `src/domain/events/media-filter-rules.ts`, `src/lib/admin/media-asset-service.ts`, `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/pagina/midia/page.tsx` | `parseMediaPage`, `computeMediaPagination`, `buildMediaPageHref`, `skip`/`take` no Prisma e barra `<nav data-testid="media-pagination">` sem JS preservando filtros ativos em `?pagina=N` | `ADR-478` |
| **Modularização de `registration-service.ts` e `certificate-service.ts`** | `src/lib/events/registration-types.ts`, `src/lib/events/registration-participant-link.ts`, `src/lib/events/registration-service.ts`, `src/lib/certificates/certificate-read-service.ts`, `src/lib/certificates/certificate-service.ts` | `registration-service.ts` cai de `2993 → 2322` linhas (`-671`) e `certificate-service.ts` cai de `2303 → 1568` linhas (`-735`), com zero ciclos e 100% de compatibilidade via reexportação | `ADR-479` |
| **Quitação de `E95` e `I8` (Catraca documental + Rebrand completo nas fixtures)** | `prisma/seed-dev-users.ts`, `docs/contas-de-teste.md`, 35 specs em `tests/e2e/`, `README.md`, `AGENTS.md`, `docs/dividas-tecnicas.md`, `tests/unit/f119-*.test.ts` | Padrão `EventFlow@2026`/`EventFlow#2026` substituído por `Koveno@2026`/`Koveno#2026`; catraca trava sincronia entre `AGENTS.md`, `README.md`, `docs/dividas-tecnicas.md` e `docs/armadilhas.md`. Dívidas abertas: **42 → 39** (Tema I **zerado**) | `ADR-480` |

### Números da FASE 119
- **Novos arquivos de código/teste:** 4 (`registration-types.ts`, `registration-participant-link.ts`, `certificate-read-service.ts`, `f119-previa-api-paginacao-midia-modularizacao-e-dividas.test.ts`) + 1 doc de fase.
- **Testes adicionados:** **8 Vitest** (**7** unitários em `f119-previa-api-paginacao-midia-modularizacao-e-dividas.test.ts` + **1** de integração em `tests/integration/f51-media-filters.test.ts`) + extensão de navegação paginada No-JS em `tests/e2e/f51-media-filters.spec.ts`.
- **Dívidas técnicas abertas:** **42 → 39** (`A=4, B=2, C=1, D=3, E=24, F=5, G=0, H=0, I=0`).
- **Migrações Prisma:** 0.

---

## 2. O Problema Mais Difícil da Fase

A modularização de `registration-service.ts` (~3.000 linhas) e `certificate-service.ts` (~2.300 linhas) não podia ser um fatiamento ingênuo:
1. A catraca AST da **FASE 75** (`tests/unit/f75-servicos-fracionados.test.ts`) exige que todas as funções transacionais listadas em `ESCRITAS_DA_INSCRICAO` e todas as recebedoras de `tx: TxClient` da inscrição permaneçam declaradas no mesmo escopo transacional em `registration-service.ts`, garantindo que ninguém mova `cancelRegistration` ou `promoteNextFromWaitlist` para fora da transação única.
2. A catraca de **FASE 85** (`tests/unit/f85-simulacao-da-emissao.test.ts`) lê diretamente os marcadores `<!-- f85-projecao-inicio -->` / `<!-- f85-projecao-fim -->` e `previewEventCertificates` em `certificate-service.ts` para garantir `<= 6` chamadas Prisma e 0 escritas no preview.

Portanto, o desenho vencedor separou em submódulos **apenas os blocos ortogonais sem ciclo de importação**: contratos/erros puros (`registration-types.ts`), gestão de vínculo de participante (`registration-participant-link.ts`) e leituras/validação pública/revogação de certificados (`certificate-read-service.ts`), mantendo as fachadas originais reexportando todos os símbolos públicos.

---

## 3. Decisões Técnicas e Alternativas Descartadas

1. **Prévia da API (`B11`) por memoização injetada em `EventApiRouteDeps`, em vez de cache com TTL ou query paralela:**
   - *Alternativa descartada:* Criar uma consulta dedicada só para a prévia quebraria o invariante da F72 (capturado pela catraca `f72-catraca-divergencia.test.ts`), e colocar TTL mascararia mudanças imediatas no interruptor de seção ("o que o cliente recebe hoje").
   - *Decisão:* Injetar `resolveTenant`, `verifyKey` e `loadProjections` opcionais em `createEventApiRouteHandlers` e compartilhar as mesmas `Promise`s entre os 5 recursos dentro de `buildEventApiPreviews`.

2. **Paginação no acervo de mídia compatível com a janela padrão `MEDIA_LIBRARY_LIMIT = 200`:**
   - *Alternativa descartada:* Encolher o limite padrão para 20 ou 50 quebraria os contratos medidos em `f51-media-filters.test.ts` e `f51-media-filters.spec.ts` (200 itens por página, truncando o acervo de 205 e anunciando "Mostrando 200 de 205 imagens").
   - *Decisão:* Preservar `MEDIA_LIBRARY_LIMIT = 200` como `pageSize` padrão, adicionar `page`/`pageSize`/`skip`/`take` via `computeMediaPagination` e exibir controles de navegação acessíveis sem JavaScript (`?pagina=N`) mantendo todos os filtros ativos na URL.

---

## 4. Registros de Decisão Arquitetural (ADRs)

- **ADR-477 — Compartilhamento de loaders por requisição na prévia da API do evento (`B11`):** `EventApiRouteDeps` aceita `resolveTenant`, `verifyKey` e `loadProjections` opcionais; `buildEventApiPreviews` memoiza as três promises por renderização para que os cinco recursos compartilhem 1 única leitura mantendo integralmente autorização por chave, interruptores por seção, 404 uniforme, envelope e `ETag`.
- **ADR-478 — Paginação progressiva baseada em URL (`?pagina=`) na Biblioteca de Mídia:** `parseMediaPage`, `computeMediaPagination` e `buildMediaPageHref` em `media-filter-rules.ts` calculam `skip`/`take` no banco com clamp em `1..totalPages`, mantendo `MEDIA_LIBRARY_LIMIT = 200` e links `<a>` server-side para operação com `javaScriptEnabled: false`.
- **ADR-479 — Fatiamento ortogonal dos serviços de inscrição e certificação sob fachada compatível:** extração de `registration-types.ts`, `registration-participant-link.ts` e `certificate-read-service.ts` formando grafo acíclico estrito (leitura/tipos/vínculo não importam os serviços principais), com 100% de reexportação nas fachadas e aderência integral às catracas F75 e F85.
- **ADR-480 — Fechamento de `E95` (senha padrão `Koveno`) e `I8` (catraca automática de sincronia documental):** substituição mecânica de `EventFlow@2026`/`EventFlow#2026` por `Koveno@2026`/`Koveno#2026` no seed de dev, doc e 35 specs E2E + teste catraca garantindo alinhamento numérico entre `AGENTS.md`, `README.md`, `docs/dividas-tecnicas.md` e `docs/armadilhas.md`.

---

## 5. Lições Aprendidas (Defeitos Reais Encontrados na Execução)

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `RegistrationStatus` não encontrado em `@/domain/events/event-rules` no `tsc --noUnusedLocals` após extrair `registration-types.ts` | O tipo `RegistrationStatus` pertence a `registration-rules.ts`, e `registration-service.ts` originalmente importava os dois blocos próximos | Corrigido o import para `@/domain/events/registration-rules` e removidos `RegistrationDecision`/`ConfirmationPolicy` não usados na fachada |
| Falha em `tests/unit/f79-fases-no-arquivo-certo.test.ts` ao mover a F104 para `docs/fases-historico.md` | A catraca da F79 exige atualização nominal das constantes declaradas `FASES_HISTORICAS`, `ORDEM_CRONOLOGICA` e `FASES_CORRENTES` | Registradas F104 no histórico e F119 na lista corrente em `tests/unit/f79-fases-no-arquivo-certo.test.ts` |

---

## 6. Evidência de Verificação

Saídas reais observadas na bateria final da fase:

- **`npm run lint` (`eslint .`):** encerrado com código `0` (`0` erros, `0` warnings).
- **`npx tsc --noEmit --noUnusedLocals`:** encerrado com código `0` (`0` erros).
- **`npm run db:verify`:** `Contrato íntegro.` (RLS + FORCE, `eventflow_app` sem privilégios elevados, tabelas de plataforma inalcançáveis).
- **`npm run db:verify:isolation`:** `9/9 verificações passaram. Isolamento entre tenants garantido pelo banco.`
- **`npm run db:partitions`:** `todas as partições do intervalo já existiam` (mês atual + 2 meses seguintes garantidos).
- **`npm test`:** `Test Files  302 passed (302)` · `Tests  4969 passed (4969)` (`Duration 449.41s`), incluindo `7` testes novos em `tests/unit/f119-previa-api-paginacao-midia-modularizacao-e-dividas.test.ts` e `20/20` em `tests/integration/f51-media-filters.test.ts`.
- **`docker compose --profile app up -d --build web worker` & `docker images eventflow/web`:** build concluído para `eventflow/web:local` (`969f884d50c9`, `367MB`) e `eventflow/worker:local`, com `eventflow-web` (`healthy`) e `eventflow-worker` recriados em execução.
- **`npx playwright test tests/e2e/f51-media-filters.spec.ts tests/e2e/f72-api-do-organizador.spec.ts`:** `7 passed (20.2s)`.
- **`npm run test:e2e`:** `565 passed` · `1 skipped` (`11.7m`), cobrindo os 35 specs migrados para `Koveno#2026` e a paginação No-JS do acervo de mídia.

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
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- **Quitadas nesta fase:** **B11** (custo `5×` da prévia da API), **E95** (senha legada `EventFlow` em fixture/seed) e **I8** (sincronia documental `AGENTS.md × README.md`). Total cai de **42 para 39** (`A=4, B=2, C=1, D=3, E=24, F=5, G=0, H=0, I=0`), zerando o Tema I.
- **Pontos de atenção remanescentes:** os submódulos internos podem continuar evoluindo para quebrar `requestCertificate`/`generateCertificate` e `cancelRegistration`/`tryReserveSeat` caso futuras fases ampliem esses fluxos, sempre preservando a catraca transacional da F75.

---

## 9. Checklist de Aceite

- [x] `B11` quitada com prova unitária (`resolveTenant`, `verifyKey`, `loadProjections` chamados 1× para os 5 recursos)
- [x] Paginação real (`?pagina=N`) no serviço e na interface da Biblioteca de Mídia funcionando sem JS
- [x] `registration-service.ts` e `certificate-service.ts` modularizados mantendo fachadas e catracas F75/F85
- [x] `E95` e `I8` quitadas com catraca de regressão e `docs/dividas-tecnicas.md` atualizado (39 abertas)
- [x] `lint`, `typecheck`, `npm test`, `next build`, `db:verify`, `db:verify:isolation`, `db:partitions` e E2E executados e documentados
