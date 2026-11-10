# FASE 98 — Destravar `/submissoes` (Visão do Autor), Cockpit do Comitê Científico (`/comite`) e Concorrência de Consultas (`/revisoes` e `/administracao/equipe`)

## 1. Sumário Executivo

A **FASE 98** resolve três pontos críticos de fluxo, governança acadêmica e eficiência em consultas concorrentes:

1. **Destravar `/submissoes` na Visão do Autor (ADR-412)**:
   - Antes da FASE 98, a tela `/submissoes` realizava 3 consultas desacopladas em transações separadas de banco. Mais grave: se o participante já possuía submissões anteriores, a tela escondia completamente as chamadas de propostas abertas (FASE 33), e no estado vazio apenas alertava sobre eventos com CFP legado sem fornecer links de submissão direta para as novas chamadas de propostas.
   - A rota foi consolidada em **1 única transação `withTenant`** que busca simultaneamente a listagem paginada do autor, os eventos legados e as chamadas de propostas ativas (`openCalls`).
   - O cabeçalho agora oferece ação primária inteligente: quando há uma única chamada aberta, aponta diretamente para o formulário de submissão (`/t/<slug>/eventos/<eventSlug>/chamada/<callSlug>`); quando há múltiplas, direciona para a seção de chamadas. Tanto no estado vazio quanto no rodapé de quem já possui trabalhos, uma nova seção (`#chamadas-abertas`) lista todas as chamadas vigentes com prazo, tipo e botão direto de envio, preservando o seletor `data-testid="no-open-cfp"` quando não houver chamadas ativas.
2. **Cockpit de Avaliação do Comitê Científico (`/comite` — ADR-413)**:
   - O coordenador de comitê científico em instituições com múltiplos eventos simultâneos enfrentava uma listagem plana e desordenada sem saber a qual evento cada artigo pertencia e sem filtros por evento, busca textual ou quórum de avaliação.
   - `listSubmissionsForChair` em `src/lib/review/review-service.ts` foi refatorado para aceitar `options: { eventId?: string; search?: string; status?: string; client?: TxClient }`, enriquecendo cada submissão com `eventId`, `eventTitle`, `eventSlug` e `callTitle`.
   - `/comite/page.tsx` foi unificado em 1 única transação `withTenant` e recebeu uma barra completa de filtros (`?evento=`, `?status=`, `?busca=`), além de cartões de métricas no topo com contagens em tempo real ("Total", "Sem pareceristas suficientes", "Prontas para decisão", "Decididas") e atalhos rápidos de navegação.
3. **Otimização Concorrente de Consultas (`/revisoes` e `/administracao/equipe` — ADR-414)**:
   - Em `/revisoes`, `listReviewerTasks` executava duas transações `withTenant` consecutivas para ler pareceres atribuídos e pareceres concluídos. Agora roda em 1 única transação atômica. A página `/revisoes/page.tsx` ganhou cartões de visão rápida no topo ("Pareceres pendentes", alertando pareceres atrasados, e "Pareceres concluídos") com identificação explícita de evento e trilha em cada card.
   - Em `/administracao/equipe/page.tsx`, a leitura da visão geral da equipe (`getTeamOverview`) e a listagem de convites pendentes (`listInvitations`) eram executadas sequencialmente via `await`. Foram paralelizadas via `Promise.all`, reduzindo a latência de carregamento da página.

| Entregável | Arquivo(s) Principal(is) | Situação |
|---|---|---|
| Suporte a `client?: TxClient` em `listMySubmissions` | `src/lib/review/submission-service.ts` | ✅ |
| Cockpit do autor em 1 transação + links diretos de submissão | `src/app/t/[tenantSlug]/(app)/submissoes/page.tsx` | ✅ |
| Enriquecimento com evento, chamada e filtros em `listSubmissionsForChair` | `src/lib/review/review-service.ts` | ✅ |
| Cockpit com filtros por evento/status/busca e cards de métricas em `/comite` | `src/app/t/[tenantSlug]/(app)/comite/page.tsx` | ✅ |
| Agregação em 1 transação de `listReviewerTasks` + métricas em `/revisoes` | `src/lib/review/review-service.ts`, `src/app/t/[tenantSlug]/(app)/revisoes/page.tsx` | ✅ |
| Paralelização com `Promise.all` em `/administracao/equipe` | `src/app/t/[tenantSlug]/(app)/administracao/equipe/page.tsx` | ✅ |
| Bateria de testes unitários da FASE 98 | `tests/unit/f98-submissoes-comite-e-concorrencia.test.ts` | ✅ |

---

## 2. O Problema Mais Difícil da Fase

### Como compatibilizar o modelo legado de CFP por evento com o modelo moderno de `CallForProposals` sem criar becos sem saída para o autor e sem quebrar os contratos de teste existentes

No modelo inicial da plataforma (FASE 4), submissões eram vinculadas diretamente a um evento com janela única de CFP (`event.cfpOpensAt` e `event.cfpClosesAt`). Na FASE 33, introduziu-se a entidade `CallForProposals`, permitindo múltiplas chamadas por evento, com tipos distintos (`TALK`, `WORKSHOP`, `PAPER`, `PANEL`), regras de cegueira próprias e rubricas dedicadas.

No entanto, a tela do autor (`/submissoes/page.tsx`) mantinha um comportamento misto:
1. Verificava eventos legados com CFP aberto (`openEvents`) e chamadas abertas (`openCalls`), mas se o usuário já possuía qualquer submissão (`submissions.length > 0`), as chamadas abertas eram completamente omitidas da renderização.
2. O botão primário do cabeçalho só era exibido se `openEvents.length > 0` (modelo legado), deixando o autor sem botão de ação caso a instituição utilizasse exclusivamente as novas `CallForProposals`.
3. No estado vazio (`submissions.length === 0`), caso houvesse chamadas abertas mas nenhum evento legado com CFP, o componente exibia uma mensagem genérica sem nenhum botão clicável para submeter.
4. Ao mesmo tempo, os testes existentes de FASEs anteriores (`f78-topo-unico.test.ts` e outros) e de contratos de regressão esperavam que a mensagem "Não há chamadas para submissão abertas neste momento." e o seletor `data-testid="no-open-cfp"` existissem quando de fato nenhuma oportunidade de submissão estivesse aberta.

A solução da FASE 98 (`ADR-412`) unificou a consulta em uma única transação `withTenant(tenantId, async (tx) => ...)`. Na renderização:
- Se houver `openCalls` vigentes, o cabeçalho calcula o link ideal: se for apenas 1 chamada, aponta direto para `/t/<slug>/eventos/<eventSlug>/chamada/<callSlug>`; se forem várias, aponta para a âncora `#chamadas-abertas`.
- Uma seção dedicada de chamadas abertas (`#chamadas-abertas`) exibe cards com título da chamada, nome do evento, badge de modalidade, data limite formatada em português e botão com link direto para o formulário público da chamada.
- Quando não há eventos com CFP legado nem chamadas abertas, o estado vazio renderiza o aviso tradicional mantendo estritamente o seletor `data-testid="no-open-cfp"`, satisfazendo os contratos existentes de E2E e unitários.

---

## 3. ADRs (Architecture Decision Records)

### ADR-412: Unificação da Visão do Autor (`/submissoes`) em Transação Única com Links Diretos para Chamadas de Propostas
- **Contexto:** A tela `/submissoes` realizava consultas fragmentadas e deixava o participante sem links clicáveis para chamadas de propostas (FASE 33), tanto quando ele já tinha trabalhos submetidos quanto no estado vazio se o evento usava o modelo de `CallForProposals`.
- **Decisão:** Permitir que `listMySubmissions` receba um `client?: TxClient` opcional. Na página `submissoes/page.tsx`, agrupar as buscas de submissões do usuário, eventos com CFP legado e chamadas de propostas ativas em uma única chamada `withTenant`. Renderizar botões de ação e cards interativos apontando diretamente para `/t/<slug>/eventos/<eventSlug>/chamada/<callSlug>`, mantendo `data-testid="no-open-cfp"` preservado para casos de ausência total de oportunidades abertas.
- **Justificativa:** Reduz o número de conexões ao banco de 3 para 1, elimina o beco sem saída da UX do autor acadêmico e garante interoperabilidade transparente entre eventos legados e chamadas da F33.
- **Consequências:** Autores agora descobrem e submetem trabalhos diretamente a partir do seu painel de submissões com um único clique.

### ADR-413: Cockpit de Avaliação do Comitê Científico (`/comite`) com Filtros por Evento, Situação e Busca Textual
- **Contexto:** Coordenadores de comitê científico precisavam avaliar centenas de trabalhos em uma listagem corrida, sem possibilidade de filtrar por evento específico, sem busca por título/autor e sem indicação clara no card sobre qual evento aquele trabalho pertencia.
- **Decisão:** Estender `listSubmissionsForChair` em `src/lib/review/review-service.ts` para suportar `options.eventId`, `options.search`, `options.status` e `options.client?: TxClient`. Enriquecer o retorno com `eventId`, `eventTitle`, `eventSlug` e `callTitle`. Atualizar `/comite/page.tsx` para rodar em 1 única transação `withTenant`, renderizar barra de filtros (`evento`, `status`, `busca`) e exibir cartões de métricas agregadas ("Total", "Sem pareceristas suficientes", "Prontas para decisão", "Decididas") no topo.
- **Justificativa:** Fornece governança e produtividade reais para os chairs de comitê científico, permitindo triagem instantânea de submissões em eventos concorrentes.
- **Consequências:** Cada card de submissão informa explicitamente o evento e chamada de origem, com links diretos para o protocolo de aceite e revisão.

### ADR-414: Otimização Concorrente de Consultas em `/revisoes` e `/administracao/equipe`
- **Contexto:** Em `/revisoes`, `listReviewerTasks` realizava duas consultas separadas em duas transações `withTenant` distintas (`assignments` e `submitted`). Em `/administracao/equipe/page.tsx`, `getTeamOverview` e `listInvitations` eram executados sequencialmente.
- **Decisão:** Consolidar `listReviewerTasks` para executar as buscas de atribuições e revisões submetidas dentro de uma única transação `withTenant`. Em `/revisoes/page.tsx`, exibir cartões de métricas no topo para pareceres pendentes (com badge para pendências atrasadas) e pareceres concluídos. Em `/administracao/equipe/page.tsx`, executar `getTeamOverview` e `listInvitations` em paralelo via `Promise.all`.
- **Justificativa:** Elimina idas e vindas redundantes ao pool de conexões do PostgreSQL e diminui o Time-to-First-Byte (TTFB) dessas páginas no Next.js Server Components.
- **Consequências:** Menor overhead no pooler (PgBouncer) e carregamento perceptivelmente mais ágil para revisores e administradores de equipe.

---

## 4. Lições Aprendidas

| # | Sintoma | Causa Raiz | Correção |
|---|---|---|---|
| 1 | Erro de tipagem TypeScript em `submissoes/page.tsx`: `Property 'proposalKind' does not exist in type 'CallForProposalsSelect'` | No schema Prisma, o campo em `CallForProposals` é denominado `kind: ProposalKind`, e não `proposalKind` | Corrigido para `kind: true` na cláusula `select` de `CallForProposals` |
| 2 | Erro TS7006: `Parameter 'row' implicitly has an 'any' type` ao implementar o padrão `client?: TxClient` com função auxiliar `runner` | Criar funções genéricas de alta ordem para envelopar queries pode perder a inferência dos tipos gerados pelo Prisma Client | Substituído o helper genérico por `const rows = client ? await query(client) : await withTenant(tenantId, query);` onde `query` é tipada diretamente com `(tx: TxClient)` |
| 3 | Falha no teste unitário `f98-submissoes-comite-e-concorrencia.test.ts` ao conferir assinatura de `listMySubmissions` via regex | Expressão regular contendo `.*` sem a flag dotAll (`s`) falhava ao encontrar quebras de linha entre os parâmetros de `options` | Ajustado o regex para utilizar `[\s\S]*?` garantindo correspondência multiline robusta |
| 4 | `tests/integration/f71-vitrine-e-leads.test.ts` falhou com `expected undefined to be defined` ao buscar evento de tecnologia em `getFeaturedPublicEvents(10)` | Existiam mais de 10 eventos futuros com data anterior (`+3 dias`) no banco local de testes e o evento do teste usava `+5 dias`, caindo fora da janela `take: 10` ordenada por `startsAt: 'asc'` | Ajustada a data de início do evento de teste para `+1 dia`, garantindo que fique no topo da listagem de destaques ordenados por proximidade temporal |

---

## 5. Evidência de Verificação

- `npm run lint` → **0 erros, 0 warnings**
- `npm run typecheck` → **0 erros**
- `npx vitest run tests/unit/f98-submissoes-comite-e-concorrencia.test.ts` → **11 testes passando**
- `npm test` → **4790 testes passando (276 arquivos)** (+11 testes novos)
- `npm run build` → **Compiled successfully**
- `npm run db:verify` → **Contrato íntegro**
- `npm run db:verify:isolation` → **9/9 verificações passaram**
- `npm run test:e2e` → **517 passando + 1 skip**

---

## 6. Comandos Operacionais

```bash
npm run lint
npm run typecheck
npx vitest run tests/unit/f98-submissoes-comite-e-concorrencia.test.ts tests/unit/f78-topo-unico.test.ts
npm test
npm run build
npm run db:verify
npm run db:verify:isolation
docker compose --profile app up -d --build web worker
npx playwright test tests/e2e/f97-missoes-palestrantes-e-pos-criacao.spec.ts tests/e2e/peer-review.spec.ts
```

---

## 7. Dívidas Técnicas e Pontos de Atenção

- Nenhuma dívida técnica nova foi aberta e nenhuma dívida existente foi alterada: o quadro permanece em **44 itens abertos** (`docs/dividas-tecnicas.md`).

---

## 8. Checklist de Aceite

- [x] **[ADR-412]** `/submissoes` unificada em 1 transação `withTenant` com `openCalls` e links diretos clicáveis para chamadas abertas.
- [x] **[ADR-412]** Estado vazio e rodapé de submissoes mantendo `data-testid="no-open-cfp"` quando não houver chamadas.
- [x] **[ADR-413]** `listSubmissionsForChair` enriquecida com filtros por `eventId`, `search`, `status` e identificadores do evento.
- [x] **[ADR-413]** Cockpit do comitê (`/comite`) em 1 transação com barra de filtros, cards de métricas no topo e indicação do evento nos cards.
- [x] **[ADR-414]** `listReviewerTasks` consolidada em 1 transação `withTenant` e cards de métricas em `/revisoes`.
- [x] **[ADR-414]** `getTeamOverview` e `listInvitations` em `/administracao/equipe` paralelizados com `Promise.all`.
- [x] Bateria completa de verificação (lint, typecheck, Vitest, build, contrato do banco, isolamento RLS, Playwright E2E) verde.
