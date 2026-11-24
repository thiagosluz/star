# FASE 125 — Cockpit de Patrocinadores por Intenção, Rotas Dedicadas de Cotas/Edição e Ergonomia de Estandes & Leads

> **Escopo:** Reestruturar `/t/[tenantSlug]/administracao/eventos/[eventId]/patrocinadores` em um cockpit orientado por intenção com faixa executiva fixa (`SponsorKpiCards`) e ponte direta para `/financeiro`, 3 abas reais na URL (`?aba=patrocinadores|cotas|estandes` com `resolveSponsorTab`), 3 rotas dedicadas de criação/edição (`/cotas/nova`, `/cotas/[tierId]/editar`, `/[sponsorId]/editar`), redução de consultas SSR nas abas não operacionais (`getEventSponsorExperienceCounts`), recolhimento progressivo do upload de logo quando já existe e ergonomia nos estandes (filtro `?patrocinador=`, taxa de consentimento LGPD e pré-preenchimento de `contactEmail`).

---

## 1. Sumário Executivo e Entregas

| Frente / Alvo | Arquivos Criados / Modificados | Resultado Objetivo | ADR |
|---|---|---|---|
| **Domínio de Abas e KPIs Executivos** | `src/domain/events/sponsor-rules.ts` | `SPONSOR_TABS`, `SPONSOR_TAB_LABELS`, `resolveSponsorTab` (abre `estandes` automaticamente sob `?confirmarQr=`, `?exportacao=` ou `?erro=`), `buildEventSponsorsHref` e `computeSponsorKpiSummary` (`consentRatePercent: null` sem visitas) | `ADR-501` |
| **Leituras Unitárias e Contagem Única SSR** | `src/lib/admin/sponsor-service.ts`, `src/lib/sponsors/sponsor-portal-service.ts`, `src/app/actions/sponsor-actions.ts` | `getSponsorTierForEdit`, `getSponsorForEdit`, `getEventSponsorExperienceCounts` (1 transação no evento substituindo `3 × N` transações + SVG sheets fora da aba `estandes`) e `revalidatePath(..., 'layout')` em `revalidateSponsors` | `ADR-502` |
| **Cockpit por Abas + 3 Rotas Dedicadas** | `src/components/admin/{sponsor-kpi-cards.tsx,sponsor-experience-panel.tsx}`, `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/{page.tsx,[sponsorId]/editar/page.tsx,cotas/nova/page.tsx,cotas/[tierId]/editar/page.tsx}` | Faixa executiva com ponte `/financeiro`, 3 abas URL, cards em 2 colunas com `<AssetUploader>` recolhido após envio, filtro `?patrocinador=`, taxa de consentimento e pré-preenchimento de `contactEmail`; 3 rotas dedicadas validadas por `requireUuidParam` e `<PageHeader>` | `ADR-503` |
| **Catracas e Suítes de Teste** | `tests/unit/f76-catalogo-de-ids.test.ts`, `tests/unit/f78-topo-unico.test.ts`, `tests/unit/f94-separacao-cadastro-de-patrocinador.test.ts`, `tests/unit/f125-cockpit-patrocinadores-abas-e-rotas.test.ts`, `tests/e2e/{landing-page,sponsor-experience,f51-sponsor-qr-repeat,f125-cockpit-patrocinadores-abas-e-rotas}.spec.ts` | Catálogo `f76` (`41` páginas / `46` params) e `f78` (`123` páginas / `108` migradas) atualizados; **7 testes unitários/SSR** + **1 cenário Playwright E2E** completo cobrindo abas, `/cotas/nova`, `/cotas/[tierId]/editar`, `/[sponsorId]/editar` e filtro de estande | `ADR-504` |

### Números da FASE 125
- **Novas rotas App Router:** 3 rotas dedicadas (`/patrocinadores/cotas/nova`, `/patrocinadores/cotas/[tierId]/editar`, `/patrocinadores/[sponsorId]/editar`).
- **Testes adicionados:** **7 Vitest** em `1` novo arquivo (`4999 → 5006` testes, `308 → 309` arquivos) + **1 cenário Playwright E2E** (`568 → 569` passando + `1` skip).
- **Dívidas técnicas:** 39 dívidas abertas mantidas.

---

## 2. O Problema Mais Difícil da Fase

A rota `/patrocinadores` concentrava em uma única página vertical **três momentos operacionais distintos** (modelagem visual de cotas, contratos/marcas e operação de estande/QRs/LGPD), repetia a lista inteira de patrocinadores em dois lugares do scroll, montava mais de 40 `<form>` simultâneos e abria `3 × N` transações `withTenant` além de gerar SVGs de todos os QRs em todo carregamento, mesmo quando o usuário só queria gerenciar cotas ou contratos. Ao mesmo tempo, fluxos No-JS legados (`?confirmarQr=` da F51 e `?exportacao=` / `?erro=` da F49) apontavam para a raiz `/patrocinadores`.

---

## 3. Decisões Técnicas e Alternativas Descartadas

1. **Abas reais via URL (`resolveSponsorTab`) com promoção automática para `estandes` sob query operacional:**
   - *Alternativa descartada:* Abas client-side que ocultariam conteúdo por CSS mantendo o peso de queries `3 × N` no servidor.
   - *Decisão:* `resolveSponsorTab` decide a aba no Server Component; parâmetros operacionais (`confirmarQr`, `exportacao`, `erro`) promovem automaticamente para `estandes`, mantendo os caminhos No-JS da F49/F51 funcionais mesmo sem `?aba=estandes`.
2. **Contagem agregada única (`getEventSponsorExperienceCounts`) + carregamento condicional de `SponsorExperiencePanel`:**
   - As abas `patrocinadores` e `cotas` pagam apenas **1 transação leve** de contagem para alimentar a faixa executiva fixa (`SponsorKpiCards`) e os contadores das abas, carregando lista de QRs, equipe B2B, leads e imagens `sponsorQrSheet` somente na aba `estandes`.
3. **Recolhimento progressivo de `<AssetUploader>` por existência de logo + `revalidatePath(..., 'layout')`:**
   - Quando `!sponsor.logoUrl`, a dropzone aparece aberta como convite de completude; após envio, recolhe-se em `<details>` (`Substituir logotipo`), mantendo o card limpo sem quebrar fluxos de cadastro recém-criado sem logo.

---

## 4. Registros de Decisão Arquitetural (ADRs)

- **ADR-501 — Abas por intenção (`patrocinadores`, `cotas`, `estandes`), promoção automática de parâmetros No-JS em `resolveSponsorTab` e KPIs executivos (`computeSponsorKpiSummary`).**
- **ADR-502 — Leituras unitárias de edição (`getSponsorTierForEdit`, `getSponsorForEdit`), contagem agregada única (`getEventSponsorExperienceCounts`) e revalidação de árvore em `revalidateSponsors`.**
- **ADR-503 — Cockpit em 3 abas, faixa executiva com ponte `/financeiro`, 3 rotas dedicadas de cota/edição e ergonomia de estande (`?patrocinador=`, taxa LGPD, pré-preenchimento de `contactEmail`).**
- **ADR-504 — Atualização das catracas `f76`/`f78`/`f94` e cobertura unitária/SSR + E2E da FASE 125.**

---

## 5. Lições Aprendidas (Defeitos Reais Encontrados na Execução)

| Sintoma | Causa raiz | Correção |
|---|---|---|
| O teste No-JS da F51 concatenava `?confirmarQr=` após `?aba=estandes`, produzindo query inválida `?aba=estandes?confirmarQr=` | O helper `sponsorsUrl()` ganhou query `?aba=estandes` enquanto a linha do teste usava concatenação fixa com `?` | Mantido o endereço base com `?confirmarQr=` direto no cenário No-JS, testando inclusive a promoção automática de `resolveSponsorTab` |
| Ao editar cota em `/cotas/[tierId]/editar`, `saveTierAction` retornava `Too big: expected number to be <=100000000` | `defaultValue={(tier.priceCents / 100).toFixed(2)}` entregava ponto decimal (`12000.00`) enquanto `reaisToCents` em `sponsor-actions.ts` removia `.` incondicionalmente, multiplicando o valor por `100×` | Ajustado `reaisToCents` para só remover `.` de milhar quando houver `,`, além de formatar `defaultValue` com vírgula decimal nas rotas `/cotas/[tierId]/editar` e `/[sponsorId]/editar` |
| No upload de logotipo em `landing-page.spec.ts`, `asset-status-SPONSOR_LOGO` sumia após `router.refresh()` | Alternar a árvore entre `<AssetUploader />` e `<details><AssetUploader /></details>` conforme `sponsor.logoUrl` fazia o React desmontar o componente e perder o estado local de sucesso | Mantido `<AssetUploader />` na mesma posição da árvore dentro do cartão do patrocinador em `patrocinadores/page.tsx` |

---

## 6. Evidência de Verificação

- `npm run lint`: **0 erros, 0 warnings**.
- `npx tsc --noEmit --noUnusedLocals`: **0 erros**.
- `npm test`: **309 arquivos aprovados, 5006 testes passando** (`380.36s`).
- `npm run build`: **Compiled successfully in 4.1s / TypeScript 38.1s** (rotas `/patrocinadores/[sponsorId]/editar`, `/patrocinadores/cotas/[tierId]/editar` e `/patrocinadores/cotas/nova` listadas).
- `npm run db:verify`: **`Contrato íntegro.`**
- `npm run db:verify:isolation`: **`9/9 verificações passaram.`**
- `npm run db:partitions`: partições verificadas (`254539 linha(s)` na saída de verificação).
- Containers locais: `eventflow/web:local` (`49ee0c4411be`) e `eventflow/worker:local` (`beb23c247374`) reconstruídos e ativos.
- `npx playwright test` direcionado (`f125`, `f51`, `f94`, `landing-page`, `sponsor-experience`): **15 passed (38.8s)**.
- `npm run test:e2e`: **569 passed, 1 skipped (13.5m)**.
- `(Get-Item AGENTS.md).Length`: **64.143 bytes** (abaixo do teto de ~64.800 bytes).

---

## 7. Comandos Operacionais

```bash
npm run lint && npx tsc --noEmit --noUnusedLocals
npx vitest run tests/unit/f76-catalogo-de-ids.test.ts tests/unit/f78-topo-unico.test.ts tests/unit/f94-separacao-cadastro-de-patrocinador.test.ts tests/unit/f118-codigo-morto-e-superficie-actions.test.ts tests/unit/f125-cockpit-patrocinadores-abas-e-rotas.test.ts tests/unit/design-system-guard.test.ts
npm test
npm run build
docker compose --profile app up -d --build web worker
npx playwright test tests/e2e/f94-novo-patrocinador-separado.spec.ts tests/e2e/landing-page.spec.ts tests/e2e/sponsor-experience.spec.ts tests/e2e/f51-sponsor-qr-repeat.spec.ts tests/e2e/f125-cockpit-patrocinadores-abas-e-rotas.spec.ts
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- Mantidas as **39 dívidas abertas** em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md).

---

## 9. Checklist de Aceite

- [x] Faixa executiva fixa (`SponsorKpiCards` + atalho para `/financeiro`) e 3 abas por URL (`?aba=patrocinadores|cotas|estandes`) em `/patrocinadores`.
- [x] 3 novas rotas dedicadas (`/patrocinadores/cotas/nova`, `/patrocinadores/cotas/[tierId]/editar`, `/patrocinadores/[sponsorId]/editar`) com `requireUuidParam` e `<PageHeader>`.
- [x] Eliminação de consultas `3 × N` e geração de SVGs fora da aba `estandes` (`getEventSponsorExperienceCounts`).
- [x] Filtro `?patrocinador=`, taxa de consentimento LGPD e pré-preenchimento de `contactEmail` em `SponsorExperiencePanel`.
- [x] Bateria completa de verificação (`lint`, `typecheck`, `npm test`, `npm run build`, contratos DB, container build e `npm run test:e2e`) aprovada.
