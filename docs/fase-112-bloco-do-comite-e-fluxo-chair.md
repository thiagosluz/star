# FASE 112 — O Bloco do Comitê Científico (`CHAIR`) no Painel e Fechamento do Fluxo Editorial

## 1. Sumário Executivo

| Entrega | Camada | Arquivos Principais | Status |
|---|---|---|---|
| **Bloco `'comite'` (`/comite`) separado de `'pareceres'` (`/revisoes`) no domínio do painel** | Domínio | `src/domain/platform/dashboard-blocks.ts` | ✅ Concluído |
| **Fato dinâmico da fila do comitê (`listSubmissionsForChair`) no card `'comite'` do Painel** | Aplicação / UI | `src/app/t/[tenantSlug]/(app)/dashboard/page.tsx` | ✅ Concluído |
| **Abertura da curadoria de Anais para o `CHAIR` (`PERMISSIONS.SUBMISSION_DECIDE`) e trilha adaptativa** | Domínio / App / UI | `src/domain/events/event-areas.ts`, `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/anais/page.tsx`, `src/app/actions/proceedings-actions.ts` | ✅ Concluído |
| **Atalho contextual direto `/comite` → Anais do evento (`chair-proceedings-links`)** | UI (RSC) | `src/app/t/[tenantSlug]/(app)/comite/page.tsx` | ✅ Concluído |
| **Eliminação de 2ª resolução de `getRequestContext()` após `requirePagePermission` em telas científicas** | Aplicação (RSC) | `src/app/t/[tenantSlug]/(app)/comite/[submissionId]/page.tsx`, `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/reconhecimento/page.tsx` | ✅ Concluído |
| **Toast flutuante de erro (`submission-error-toast`) + auto-scroll em `/submissoes/nova`** | UI (Client) | `src/components/review/create-submission-form.tsx` | ✅ Concluído |
| **Seletor visual de cor (`<input type="color">` sem `name`) + paleta de sugestões clicáveis (`THEME_COLOR_PRESETS`) + botão `"Padrão"` nos editores de página** | Domínio / UI | `src/domain/events/landing-page.ts`, `src/components/admin/landing-theme-fields.tsx`, `src/components/admin/tenant-theme-fields.tsx` | ✅ Concluído |
| **Suíte de Testes Unitários, Catracas de Fonte e E2E da Jornada do `CHAIR`** | Testes | `tests/unit/f112-bloco-do-comite-e-fluxo-chair.test.ts`, `tests/unit/f84-painel-do-perfil.test.ts`, `tests/e2e/f112-bloco-do-comite-e-fluxo-chair.spec.ts`, `tests/e2e/f84-painel-do-perfil.spec.ts`, `tests/e2e/peer-review.spec.ts` | ✅ Concluído |

### Números da Fase
- **Testes Vitest (unitários + integração):** `4.906` passando (`292` arquivos; `+11` novos testes)
- **Testes Playwright E2E:** `557` passando + `1` skip (`558` casos; `+3` novos cenários E2E)
- **ADRs registradas:** `ADR-457` a `ADR-459` (total global: `459`)
- **Migrações de banco:** `0` (evolução pura de domínio, RBAC e RSC)
- **Dívidas técnicas abertas:** `42` (mantidas)

---

## 2. O Problema Mais Difícil da Fase e Por Que Ele Define o Desenho

Na **FASE 84**, quando o painel da instituição deixou de exibir a listagem crua de permissões do RBAC e passou a exibir até **5 blocos por perfil** (`DASHBOARD_BLOCK_LIMIT = 5`), o bloco `'pareceres'` (`path: '/revisoes'`) foi configurado com o gatilho:

```ts
holdsPermission(subject.roles, PERMISSIONS.REVIEW_SUBMIT_OWN) ||
  holdsPermission(subject.roles, PERMISSIONS.SUBMISSION_READ_ANY)
```

Isso criou duas distorções reais na jornada da **Coordenação Científica (`CHAIR`)**:

1. **O desvio para uma fila vazia (`/revisoes` em vez de `/comite`):** No catálogo RBAC (`src/domain/rbac/permissions.ts`), `CHAIR` possui `submission:read:any`, `submission:assign-reviewer` e `submission:decide`, mas **não** possui `review:submit:own` (que pertence a `REVIEWER`). Ao entrar no painel e clicar em **"Meus pareceres"**, o coordenador científico caía em `/revisoes` vendo o estado vazio *"Você não tem pareceres atribuídos no momento"*, enquanto sua verdadeira mesa de trabalho (`/comite`) ficava escondida no menu lateral.
2. **A colisão com o teto de 5 blocos do gestor geral (`OWNER`/`ADMIN`) e a regressão visual (`f62`):** Se o novo bloco `'comite'` fosse disparado indiscriminadamente para qualquer detentor de `submission:read:any`, todo `OWNER` e `ADMIN` (que detêm todas as permissões da instituição) passaria a ter 6 blocos elegíveis (`gestao`, `participacao`, `submissoes`, `comite`, `pareceres`, `equipe`), atingindo o teto de 5 blocos, empurrando `'equipe'` (*Credenciamento*) para fora do painel (`"e mais 1 atalho"`) e quebrando os snapshots visuais de referência do `f62`.
3. **O beco sem saída entre a decisão (`/comite`) e a publicação dos Anais (`/anais`):** Na **FASE 111**, a curadoria e publicação de Anais (`/administracao/eventos/[eventId]/anais` e as 5 actions de `proceedings-actions.ts`) foi protegida com `PERMISSIONS.EVENT_MANAGE` — permissão operacional de sorteios que `OWNER`, `ADMIN` e `ORGANIZER` possuem, mas que o **`CHAIR` não possui**. Além disso, como `/administracao/eventos` exige `event:update`, o `CHAIR` não tinha caminho de navegação nem permissão para publicar os anais dos trabalhos que ele mesmo aceitou no comitê.

---

## 3. Decisões Técnicas Explicadas

### 3.1. Separação ortogonal entre `'comite'` (`/comite`) e `'pareceres'` (`/revisoes`)
- **`'comite'` (`path: '/comite'`):** Dispara quando o sujeito detém `submission:read:any` e **não** pertence aos papéis executivos já cobertos pelo bloco `'gestao'` (`!subject.roles.some(isManagementRole)`).
  - Para `CHAIR` isolado: o painel exibe `['participacao', 'submissoes', 'comite']`.
  - Para `CHAIR + REVIEWER` acumulados: o painel exibe **ambos** os cartões acadêmicos (`['participacao', 'submissoes', 'comite', 'pareceres']`), levando tanto ao cockpit de coordenação (`/comite`) quanto à fila de avaliação própria (`/revisoes`).
  - Para `OWNER`, `ADMIN` e `ORGANIZER`: os 5 blocos existentes permanecem intocados (`['gestao', 'participacao', 'submissoes', 'pareceres', 'equipe']`), preservando o orçamento máximo de 6 leituras no painel e os 23 baselines visuais da suíte `f62`.

### 3.2. Fato dinâmico do bloco `'comite'` no `DashboardPage`
- Quando `visible('comite')` é verdadeiro no plano do painel, `DashboardPage` invoca `listSubmissionsForChair(tenantId)` no `Promise.all` e sintetiza o fato do cartão:
  - Ex.: `"1 trabalho na fila"` ou `"3 trabalhos na fila · 2 prontos para decisão"`.
- Como `'comite'` e `'gestao'` são disjuntos pela regra do domínio, o teto de consultas do painel nunca ultrapassa as 6 fontes originais da FASE 84.

### 3.3. Curadoria de Anais sob `PERMISSIONS.SUBMISSION_DECIDE` e Ponte `/comite` ↔ `/anais`
- A área `'anais'` em `EVENT_AREAS`, a página `/administracao/eventos/[eventId]/anais` e as 5 Server Actions em `proceedings-actions.ts` passaram a exigir `PERMISSIONS.SUBMISSION_DECIDE` (presente em `OWNER`, `ADMIN`, `ORGANIZER` e `CHAIR`).
- No cabeçalho de `/comite`, quem possui `submission:decide` vê o atalho contextual `data-testid="chair-proceedings-links"` apontando diretamente para `/administracao/eventos/[eventId]/anais`.
- Na página de Anais (`anais/page.tsx`), a trilha (`breadcrumbs`) adapta-se à permissão do usuário: quem tem `event:update` volta para a árvore do evento (`Painel → Eventos → Evento → Anais`); o `CHAIR` (sem `event:update`) recebe a trilha `Painel → Comitê científico (/comite?evento=...) → Anais`, evitando redirecionamento por falta de permissão na raiz de administração.

---

## 4. ADRs (Architecture Decision Records)

### ADR-457: Bloco `'comite'` no domínio do painel e separação entre coordenar (`/comite`) e avaliar (`/revisoes`)
- **Contexto:** Na FASE 84, o papel `CHAIR` caía no bloco `'pareceres'` (`/revisoes`), encontrando uma tela vazia por não possuir revisões individuais atribuídas.
- **Decisão:** Introduzir o identificador `'comite'` em `DashboardBlockId` e `DASHBOARD_BLOCK_META` apontando para `/comite`, acionado para detentores de `submission:read:any` que não possuem o bloco executivo `'gestao'`. Restringir o acionamento direto de `'pareceres'` a quem detém `review:submit:own` (ou gestores gerais).
- **Consequências:** O `CHAIR` aterrissa diretamente em `/comite` com a contagem real de trabalhos na fila; quem acumula `CHAIR + REVIEWER` vê os dois cartões; e o painel do `OWNER`/`ADMIN` preserva seus 5 cartões e seu orçamento de consultas.

### ADR-458: Curadoria e publicação de Anais autorizadas por `submission:decide` com trilha contextual para o `CHAIR`
- **Contexto:** Publicar os anais dos trabalhos aceitos é a etapa final da coordenação científica, mas a rota `/administracao/eventos/[eventId]/anais` e suas Server Actions exigiam `event:manage` (exclusiva de organização operacional), bloqueando o papel `CHAIR`.
- **Decisão:** Alinhar `EVENT_AREAS` (`id: 'anais'`), `anais/page.tsx` e `proceedings-actions.ts` para exigir `PERMISSIONS.SUBMISSION_DECIDE` (compartilhada por `OWNER`, `ADMIN`, `ORGANIZER` e `CHAIR`), adicionar atalho direto em `/comite` (`chair-proceedings-links`) e adaptar os breadcrumbs de `anais/page.tsx` para retornar a `/comite?evento=<id>` quando o operador não detiver `event:update`.
- **Consequências:** O `CHAIR` conduz o ciclo acadêmico completo (avaliação → decisão → curadoria e publicação dos anais) sem precisar de permissões operacionais de edição geral do evento, e a catraca `f72-cartao-esconde-o-que-a-tela-recusa` mantém 100% de paridade entre cartão e página.

### ADR-459: Reuso estrito do `principal` de `requirePagePermission` em `/comite/[submissionId]` e `/reconhecimento`
- **Contexto:** As páginas `/comite/[submissionId]` e `/administracao/eventos/[eventId]/reconhecimento` invocavam `requirePagePermission` e, logo abaixo, chamavam `await getRequestContext()` apenas para ler `context?.principal` e passar para `can()`.
- **Decisão:** Desestruturar `{ tenantId, principal }` diretamente do retorno de `requirePagePermission` e remover o import/chamada redundante de `getRequestContext()`.
- **Consequências:** Elimina chamadas redundantes na árvore RSC dessas duas telas científicas, alinhando-as ao contrato de resolução única de contexto da FASE 75/89.

---

## 5. Lições Aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| `CHAIR` não conseguia acessar `/administracao/eventos/[eventId]/anais` nem tinha link para ela a partir de `/comite` | Na FASE 111, a guarda de `anais` usou `PERMISSIONS.EVENT_MANAGE` (que o `CHAIR` não tem) e os breadcrumbs apontavam para `/administracao/eventos` (que exige `event:update`) | Guarda migrada para `PERMISSIONS.SUBMISSION_DECIDE` (mantendo paridade em `EVENT_AREAS` para a catraca `f72`), atalho adicionado no topo de `/comite` e breadcrumbs adaptativos em `anais/page.tsx` |

---

## 6. Evidência de Verificação

- `npm run lint`: `0` erros, `0` warnings
- `npm run typecheck`: `0` erros
- `npm test`: `292` arquivos passando (`4.906` testes)
- `npm run db:verify`: Contrato íntegro (`62` tabelas sob RLS + FORCE; tabelas restritas revogadas)
- `npm run db:verify:isolation`: `9/9` verificações passaram
- `npm run db:partitions`: partições criadas e íntegras
- `npm run build`: compilado com sucesso
- `npm run test:e2e`: `557` passando + `1` skip (`558` casos, `0` falhas)

---

## 7. Comandos Operacionais

```bash
npx vitest run tests/unit/f112-bloco-do-comite-e-fluxo-chair.test.ts tests/unit/f84-painel-do-perfil.test.ts tests/unit/f72-cartao-esconde-o-que-a-tela-recusa.test.ts
npx playwright test tests/e2e/f112-bloco-do-comite-e-fluxo-chair.spec.ts tests/e2e/f84-painel-do-perfil.spec.ts
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- Nenhuma dívida técnica nova foi introduzida; o total permanece em **42 itens abertos** em `docs/dividas-tecnicas.md`.
- **Ponto de atenção registrado:** No topo de `/comite`, quando nenhum filtro `?evento=` está ativo, são exibidos atalhos diretos de Anais para até 3 eventos recentes (`events.slice(0, 3)`); ao filtrar um evento específico no seletor de `/comite`, o botão passa a apontar exclusivamente para os Anais daquele evento.

---

## 9. Checklist de Aceite

- [x] Bloco `'comite'` (`/comite`) modelado no domínio (`dashboard-blocks.ts`) com título, descrição e regra pura testada.
- [x] `CHAIR` vê `'comite'` no painel com contagem dinâmica real da fila (`listSubmissionsForChair`), sem cair em `/revisoes` vazio.
- [x] `CHAIR + REVIEWER` vê tanto `'comite'` (`/comite`) quanto `'pareceres'` (`/revisoes`).
- [x] `OWNER`, `ADMIN` e `ORGANIZER` mantêm seus 5 blocos e baselines visuais (`f62`) intactos.
- [x] Curadoria e publicação de Anais (`/administracao/eventos/[eventId]/anais` e Server Actions) abertas para `PERMISSIONS.SUBMISSION_DECIDE` com ponte direta em `/comite` e trilha de retorno ao comitê.
- [x] Remoção de `getRequestContext()` redundante em `/comite/[submissionId]` e `/reconhecimento`.
- [x] Bateria completa de verificação (lint, typecheck, unit, integração, build, db:verify, E2E) 100% verde.
