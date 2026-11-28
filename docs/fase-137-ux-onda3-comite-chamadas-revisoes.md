# FASE 137 — Auditoria UX Onda 3 (Comitê Científico, Chamadas de Propostas, Formulário Público e Pareceres)

> **Escopo:** Eliminar enums técnicos em inglês no painel do Comitê Científico, modernizar o cadastro de Nova Chamada (Título primeiro + auto-slug + orientações multilinha + dica por tipo + remoção de link voltar duplicado), adicionar contadores ao vivo de caracteres e palavras-chave no formulário público de proposta e melhorar o feedback de progresso e seleção no formulário de parecer do revisor.

---

## 1. Sumário executivo

| Entrega | Arquivo(s) | Resultado |
|---|---|---|
| Domínio puro da Onda 3 | [`src/domain/review/review-ux-rules.ts`](../src/domain/review/review-ux-rules.ts) | `formatRecommendationLabel`, `formatAssignmentStatusLabel`, `formatSubmissionStatusLabel`, `submissionStatusTone`, `countProposalKeywords`, `describeProposalKindDefaults` |
| Painel da submissão no comitê | [`src/app/t/[tenantSlug]/(app)/comite/[submissionId]/page.tsx`](../src/app/t/[tenantSlug]/(app)/comite/[submissionId]/page.tsx) | Badge semântico `panel-submission-status`, tradução de `assignment.status` e `review.recommendation`, e orientação clara entre `Decisão do comitê` e `Protocolo de aceite` |
| Consenso e sugestão em português | [`src/components/review/decision-form.tsx`](../src/components/review/decision-form.tsx) | Distribuição e sugestão automática traduzidas (`Aceitar: 2`, `Aceitar com revisões menores`, etc.) |
| Nova chamada reativa + sem duplicata | [`src/components/admin/call-create-fields.tsx`](../src/components/admin/call-create-fields.tsx), [`src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/nova/page.tsx`](../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/nova/page.tsx) | Título primeiro com auto-slug, dica contextual por tipo (`call-kind-hint`), `Orientações ao proponente` em `<Textarea>` e remoção do link duplicado `← Voltar para Chamadas` |
| Contadores ao vivo na proposta pública | [`src/components/proposals/proposal-form.tsx`](../src/components/proposals/proposal-form.tsx) | Contadores ao vivo em Resumo (`proposal-abstract-counter`) e Palavras-chave (`proposal-keywords-counter`) |
| Progresso e slider destravado no parecer | [`src/components/review/review-form.tsx`](../src/components/review/review-form.tsx) | Indicador `review-progress` (`X de N critérios avaliados`) e registro imediato ao clicar no ponto médio do slider |
| Testes unitários + SSR | [`tests/unit/f137-ux-onda3-comite-chamadas-revisoes.test.ts`](../tests/unit/f137-ux-onda3-comite-chamadas-revisoes.test.ts) | 4 novos casos cobrindo tradução de enums, contagem de keywords, dicas por tipo e SSR |

**Números da fase:** 1 módulo de domínio novo · 1 componente cliente novo · 5 arquivos de UI atualizados · 1 arquivo de teste novo (+4 testes) · 0 migrações · 2 ADRs (`ADR-531`, `ADR-532`).

---

## 2. O problema mais difícil e decisões técnicas

A inspeção de código cruzada com 12 capturas reais da jornada de Chamadas → Submissão Pública → Comitê → Pareceres expôs atritos concretos para coordenadores e autores:
1. **Vazamento de enums em inglês no Comitê:** status de atribuição (`ASSIGNED`, `SUBMITTED`), recomendações dos pareceres (`ACCEPT`, `MINOR_REVISION`, `MAJOR_REVISION`, `REJECT`) e a própria sugestão automática de consenso apareciam em inglês técnico cru.
2. **Nova Chamada repetindo o padrão invertido da Onda 1:** pedia `Identificador na URL` antes do `Título da chamada`, sem auto-slug, usava `<input>` de 1 linha para `Orientações ao proponente` e exibia dois links `← Voltar` lado a lado no topo.
3. **Formulário público sem feedback enquanto digita:** exigia `150 a 5000 caracteres` no resumo e `3 a 8 palavras-chave`, mas só revelava erro após o clique em Enviar.
4. **Dupla seção de decisão sem ponte explicativa:** quando a proposta vinha de uma chamada, `Decisão do comitê` e `Protocolo de aceite` apareciam empilhados sem orientar qual usar para aprovar vs rejeitar/solicitar revisão.

---

## 3. ADRs

### ADR-531 — Fonte única em português para enums do Comitê e orientação entre Decisão × Protocolo de Aceite
- **Contexto:** Enums internos do Prisma/domínio (`ASSIGNED`, `ACCEPT`, `MINOR_REVISION`, etc.) vazavam diretamente no JSX do painel do comitê e do `DecisionForm`, e o cabeçalho da submissão omitia a situação atual da proposta.
- **Decisão:** Centralizar em `src/domain/review/review-ux-rules.ts` os mapas e formatadores (`formatRecommendationLabel`, `formatAssignmentStatusLabel`, `formatSubmissionStatusLabel`, `submissionStatusTone`), exibir o badge semântico `panel-submission-status` no `PageHeader` e acrescentar orientação explícita entre `Decisão do comitê` e `Protocolo de aceite` quando a proposta pertence a uma chamada.
- **Consequências:** Zero enums técnicos em inglês na superfície do comitê e clareza imediata do estado da submissão sem alterar nenhum contrato de Server Action ou payload de banco.

### ADR-532 — `CallCreateFields` reativo, contadores ao vivo em `ProposalForm` e destravamento do slider em `ReviewForm`
- **Contexto:** `chamadas/nova` pedia slug antes do título e instruções em input de 1 linha; `ProposalForm` exigia mínimos/máximos de resumo e palavras-chave sem contador; e o slider de `ReviewForm` nascia na metade sem registrar o valor ao clique.
- **Decisão:** Extrair `CallCreateFields` com Título primeiro + auto-slug (`slugifyTitle`), `Textarea` para instruções e dica por tipo (`describeProposalKindDefaults`), remover o botão Voltar duplicado do `PageHeader`, adicionar contadores ao vivo em `ProposalForm` usando `countProposalKeywords` e exibir progresso + registro imediato no `onPointerDown` em `ReviewForm`.
- **Consequências:** Alinhamento completo da Onda 3 com o padrão de ergonomia das Ondas 1 e 2, preservando integralmente todos os `name` de formulário, `data-testid` existentes e funcionamento No-JS.

---

## 4. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `TS2322` / `TS2352` em `call-create-fields.tsx` no `next build` | `Field` e `SelectField` de `admin-form.tsx` esperam `ChangeEventHandler` padrão do React (`event.target.value`), não callback de `string` direto | Ajustados `handleTitleChange`, `handleSlugChange` e `onChange` de `SelectField` para ler `event.target.value` |
| `f93-separacao-cadastro-de-chamada.test.ts` falhou esperando `data-field="instructions"` | Ao trocar `<Field name="instructions">` por `<Textarea name="instructions">` diretamente, o wrapper perdeu o atributo `data-field="instructions"` usado pelo teste SSR da F93 | Adicionado `data-field="instructions"` no wrapper do `<Textarea>` em `CallCreateFields`, preservando o campo multilinha e o contrato da F93 |

---

## 5. Evidência de verificação

| Comando | Resultado real observado |
|---|---|
| `npm run lint` | 0 erros, 0 warnings |
| `npx tsc --noEmit --noUnusedLocals` | 0 erros |
| `npm test` | **324 arquivos / 5068 testes passando** (`324.06s`; +4 novos em `f137-ux-onda3-comite-chamadas-revisoes.test.ts`) |
| `npm run db:verify` | `Contrato íntegro.` |
| `npm run db:verify:isolation` | `9/9 verificações passaram.` |
| `npm run db:partitions` | Todas as partições do intervalo já existiam (`276.819` linhas totais) |
| `docker compose --profile app up -d --build web` | `eventflow/web:local` construída (`next build` OK em `40.6s`) e container `eventflow-web` recriado e iniciado |
| Playwright E2E Onda 3 (`peer-review.spec.ts` + `call-for-proposals.spec.ts` + `f112-bloco-do-comite-e-fluxo-chair.spec.ts` + `f74-proposta-ciencia.spec.ts` + `f93-nova-chamada-separada.spec.ts`) | **18 passed** (`7` em `12.2s` + `11` em `13.5s`) |
| Tamanho de `AGENTS.md` | **62.814 bytes** (`< 64.800` bytes; F119 movida para `docs/fases-historico.md`) |

---

## 6. Comandos operacionais

```bash
npm run lint
npx tsc --noEmit --noUnusedLocals
npm test
npm run db:verify
npm run db:verify:isolation
npm run db:partitions
docker compose --profile app up -d --build web
npx playwright test tests/e2e/peer-review.spec.ts tests/e2e/call-for-proposals.spec.ts tests/e2e/f112-bloco-do-comite-e-fluxo-chair.spec.ts tests/e2e/f74-proposta-ciencia.spec.ts tests/e2e/f93-nova-chamada-separada.spec.ts --reporter=list
```

---

## 7. Dívidas técnicas

Nenhuma dívida nova aberta; contagem global mantida em **36 dívidas abertas**.

---

## 8. Checklist de aceite

- [x] `src/domain/review/review-ux-rules.ts` puro com tradução de enums, tons semânticos, contagem de keywords e dicas por tipo.
- [x] Painel do comitê e `DecisionForm` livres de enums crus em inglês, com badge de status e orientação sobre Protocolo de aceite.
- [x] `chamadas/nova` com `CallCreateFields` (Título → auto-slug, `<Textarea>`, dica por tipo) e sem botão Voltar duplicado.
- [x] `ProposalForm` com contadores ao vivo de resumo e palavras-chave.
- [x] `ReviewForm` com contador de critérios avaliados e registro imediato no ponto médio do slider.
- [x] Testes unitários e SSR da FASE 137 adicionados.
- [x] Bateria completa de verificação e E2E da Onda 3 verdes.
