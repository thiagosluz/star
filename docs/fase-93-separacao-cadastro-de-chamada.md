# FASE 93 — Separação do cadastro de chamada (/chamadas/nova) e cockpit limpo de chamadas (/chamadas)

> **Status:** Concluída e Verificada  
> **Data:** Novembro de 2026  
> **Escopo:** Interface (RSC), App Router, UX, Design Tokens, Formulários Complexos, Retrocompatibilidade e Bateria de Testes  
> **ADRs adicionadas:** ADR-400 (numeração global sequencial)

---

## 1. Sumário executivo

A **FASE 93** resolveu a sobrecarga cognitiva e a poluição visual da página de gestão de chamadas de propostas ([`src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/page.tsx)) separando o cadastro em uma página dedicada ([`src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/nova/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/nova/page.tsx)) e transformando a tela de chamadas em um **cockpit executivo limpo**.

Diferente de entidades leves como salas (que possuem apenas 2 campos e foram mantidas *in-page* na FASE 92), uma chamada de propostas possui **11 campos de configuração** (tipo, slug, título, resumo, orientações, datas de abertura e encerramento, revisão cega, limite de propostas por autor, trilha) mais um **editor aninhado de rubrica de avaliação** (critérios, pesos e notas máximas). Manter todo esse formulário dentro de um `<details>` retrátil no topo da listagem gerava uma experiência confusa, onde a criação competia com o painel de propostas recebidas e o cockpit de resultados da chamada.

Com a refatoração:
1. O formulário foi isolado em `/chamadas/nova`, encapsulado no card branco padrão da plataforma (`bg-card rounded-xl border border-border shadow-sm p-6`), com `PageHeader` semântico e breadcrumbs de volta nativa;
2. A tela `/chamadas` recebeu um botão primário destacado de ação no topo (`data-testid="btn-nova-chamada"`), listagem em cards brancos destacados e um *empty state* contextual com botão de criação;
3. 100% dos seletores contratuais e fluxos de teste legados foram preservados.

### Tabela de entregas e números da fase

| Entrega | Arquivo | Responsabilidade |
|---|---|---|
| **Página dedicada de criação** | `src/.../eventos/[eventId]/chamadas/nova/page.tsx` | Server Component com `PageHeader`, breadcrumbs, container card branco e formulário `create-call` com 11 campos + `RubricEditor` |
| **Cockpit limpo de chamadas** | `src/.../eventos/[eventId]/chamadas/page.tsx` | Remoção do formulário retrátil do topo, botão primário `btn-nova-chamada` no `PageHeader.actions`, cards brancos de chamadas e empty state atualizado |
| **Testes unitários da fase** | `tests/unit/f93-separacao-cadastro-de-chamada.test.ts` | 6 testes cobrindo botão no cabeçalho, ausência do form antigo, cards brancos, empty state, breadcrumbs e os 11 campos de criação |
| **Teste E2E da fase** | `tests/e2e/f93-nova-chamada-separada.spec.ts` | Cenário Playwright no navegador verificando cockpit limpo, navegação para `/chamadas/nova`, preenchimento, submissão e retorno à listagem |
| **Ajuste de teste E2E legado** | `tests/e2e/call-for-proposals.spec.ts` | Atualização do fluxo de criação para utilizar o botão `btn-nova-chamada` e a rota `/chamadas/nova` |
| **Catraca de catálogo de IDs** | `tests/unit/f76-catalogo-de-ids.test.ts` | Atualização da contagem para 27 páginas com `[id]` e 28 parâmetros validados |
| **Catraca de topo único** | `tests/unit/f78-topo-unico.test.ts` | Atualização da contagem para 101 páginas no total e 86 migradas para `PageHeader` |
| **Catraca de fases** | `tests/unit/f79-fases-no-arquivo-certo.test.ts` | Atualização do histórico (68 e 69 movidas) e tabela corrente iniciando em 70 |
| **Histórico de fases** | `docs/fases-historico.md` | Fases 68 e 69 arquivadas mantendo `AGENTS.md` sob o teto de 64.800 bytes |
| **Documentação da fase** | `docs/fase-93-separacao-cadastro-de-chamada.md` | Este documento com sumário, decisões, ADR-400 e evidências |

### Números da fase

* **Arquivos modificados/criados:** 10 arquivos (`chamadas/nova/page.tsx`, `chamadas/page.tsx`, `call-for-proposals.spec.ts`, `f93-*.test.ts`, `f93-*.spec.ts`, `f76-*.test.ts`, `f78-*.test.ts`, `f79-*.test.ts`, `fases-historico.md`, `AGENTS.md`, `README.md`)
* **Testes Vitest:** 4.754 passando (+6 novos unitários) em 271 arquivos
* **Testes Playwright E2E:** 513 passando (+1 novo) + 1 skip
* **ADR:** ADR-400
* **Dívidas técnicas:** 44 abertas (inalterado)

---

## 2. O problema mais difícil e por que ele define o desenho

O problema central da FASE 93 foi o **desacoplamento cirúrgico de um formulário com editor aninhado de sub-entidades (rubricas)** sem quebrar o ecossistema de avaliação, aceite e publicação de chamadas.

A chamada de trabalhos/propostas não é um cadastro comum:
1. Ela dita como os revisores pontuam propostas através do `RubricEditor` (que serializa uma estrutura JSON aninhada de critérios, pesos e notas máximas);
2. Ela condiciona o aceite de propostas (`/comite/[submissionId]`);
3. Ela condiciona o painel de deliberação e resultado (`CallResultCard`);
4. A tela anterior colocava o formulário de criação em um `<details data-testid="create-call-section">` logo acima da listagem. Quando a lista tinha chamadas com dezenas de propostas, o topo da página ficava pesado, com dropdowns de cegueira, orientações longas e critérios de rubrica misturados com as ações de governança.

O desafio era mover esse formulário para uma rota filha sem duplicar a lógica de opções de trilhas, cegueira (`defaultBlindFor`), nem alterar os nomes contratuais dos campos de Server Actions (`saveCallAction`). Ao mesmo tempo, no cockpit `/chamadas`, as linhas existentes precisavam continuar suportando a edição em linha (`call-edit-${call.id}`) para pequenos ajustes sem que o usuário precisasse sair da visão de conjunto.

A solução adotada preservou a consistência contratual: a criação foi para `/chamadas/nova`, o cockpit foi limpo, e todos os `data-testid` permaneceram idênticos.

---

## 3. Decisões técnicas explicadas

### 3.1 Página Dedicada `/chamadas/nova` em Server Component Puro
A rota `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/nova/page.tsx` foi construída como Server Component com `dynamic = 'force-dynamic'`, importando e executando `requireUuidParam`, `requirePagePermission(EVENT_MANAGE)` e `getAdminEvent` para carregar o evento e suas trilhas.
O formulário foi envolvido em `<section className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6" data-testid="create-call-section">`, oferecendo contraste e foco exclusivo na tarefa de configuração.

### 3.2 Cockpit de Chamadas com Botão Primário no Header
Em `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/page.tsx`, o slot `actions` do `PageHeader` recebeu:
```tsx
actions={
  <div className="flex flex-wrap items-center gap-3">
    <Link
      href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/pagina`)}
      className="text-sm underline underline-offset-4 text-muted-foreground hover:text-foreground"
      data-testid="calls-to-page-editor"
    >
      Editar a página pública →
    </Link>
    <Link
      href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/chamadas/nova`)}
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover"
      data-testid="btn-nova-chamada"
    >
      <Megaphone className="size-4" aria-hidden />
      Nova chamada
    </Link>
  </div>
}
```
Isso desobstrui completamente o topo da tela.

### 3.3 Cards Brancos Destacados para Cada Chamada
Cada chamada listada agora reside em:
```tsx
<li
  key={call.id}
  className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm"
  data-testid={`call-row-${call.id}`}
  data-call-state={call.state}
  data-call-published={String(call.isPublished)}
>
```
Isso cria separação visual nítida entre a chamada, suas propostas recebidas e seu painel de publicação de resultados.

---

## 4. ADRs (Architectural Decision Records)

### ADR-400 — Separação do cadastro de chamada (/chamadas/nova) e cockpit limpo (/chamadas)

* **Contexto:** A tela `/chamadas` misturava a criação de chamadas (um formulário extenso de 11 campos mais editor de rubrica em sanfona) com a lista de chamadas ativas, a visualização de propostas recebidas e a publicação de resultados do comitê. Isso gerava sobrecarga visual severa.
* **Decisão:** Separar a criação em uma rota dedicada (`/administracao/eventos/[eventId]/chamadas/nova`) dentro de um card branco de destaque com `PageHeader` semântico, adicionando o botão primário `btn-nova-chamada` no cabeçalho de `/chamadas` e padronizando os itens da lista em cards brancos destacados.
* **Justificativa:** Diferente do cadastro de salas (que possui 2 campos e foi mantido in-page na FASE 92), a criação de uma chamada é um processo denso de governança acadêmica/conteúdo que demanda foco isolado. A separação alinha `/chamadas` ao mesmo padrão consagrado em `/eventos` (FASE 90) e `/programacao` (FASE 91).
* **Consequências:** Clareza operacional na gestão de propostas; contraste e hierarquia visual aprimorados; retrocompatibilidade contratual total preservada para Server Actions e suíte de testes.

---

## 5. Lições aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| A catraca `f76-catalogo-de-ids.test.ts` falhou com 26 páginas em vez de 27 | A nova página `chamadas/nova/page.tsx` possui o parâmetro de rota `[eventId]` e utiliza `requireUuidParam` | O catálogo de rotas auditadas no teste foi estendido para 27 páginas e 28 parâmetros validados |
| A catraca `f78-topo-unico.test.ts` falhou com 100 páginas em vez de 101 | A nova página adicionou um novo arquivo `page.tsx` com `PageHeader` | A contagem esperada foi ajustada de 100 para 101 páginas totais (86 migradas) |
| O arquivo `AGENTS.md` ultrapassou 64.800 bytes (64.914 bytes) | A adição da linha da F93 excedeu a margem de segurança do harness | As fases 68 e 69 foram movidas para `docs/fases-historico.md` conforme protocolo da §2, trazendo `AGENTS.md` de volta para 64.611 bytes |
| O mock de propostas falhou no render estático por falta de campos opcionais | O componente `EventCallsPage` acessa `proposal.data.length` e `proposal.finalScore.toFixed()` | O mock nos testes unitários incluiu `data: []` e `finalScore: null` garantindo integridade |

---

## 6. Evidência de verificação

1. **Linting:**
   ```bash
   npm run lint
   # 0 errors, 0 warnings
   ```
2. **Typecheck:**
   ```bash
   npm run typecheck
   # 0 errors
   ```
3. **Bateria de testes Vitest:**
   ```bash
   npm test
   # 4754 passed (271 files)
   ```
4. **Build de produção:**
   ```bash
   npm run build
   # Compiled successfully, rota /t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/nova listada
   ```
5. **Verificação do contrato do banco e isolamento:**
   ```bash
   npm run db:verify
   # Contrato íntegro.
   npm run db:verify:isolation
   # 9/9 verificações passaram.
   npm run db:partitions
   # Partições íntegras.
   ```
6. **Suíte Playwright E2E:**
   ```bash
   npm run test:e2e
   # 513 passed + 1 skip (call-for-proposals e f93-nova-chamada-separada verdes)
   ```

---

## 7. Comandos operacionais

```bash
# Rodar testes da F93
npx vitest run tests/unit/f93-separacao-cadastro-de-chamada.test.ts
npx playwright test tests/e2e/f93-nova-chamada-separada.spec.ts

# Bateria geral
npm run lint
npm run typecheck
npm test
npm run build
npm run db:verify
npm run test:e2e
```

---

## 8. Dívidas técnicas

O catálogo consolidado permanece com **44 dívidas técnicas abertas** (A=4, B=5, C=1, D=3, E=25, F=5, H=0, I=1). A FASE 93 não declarou novas dívidas nem quitou itens de catálogo anteriores, mantendo a contagem rigorosamente estável.

---

## 9. Checklist de aceite

- [x] Rota dedicada `/administracao/eventos/[eventId]/chamadas/nova` criada como Server Component
- [x] Formulário de criação `create-call` encapsulado em card branco (`bg-card rounded-xl border border-border shadow-sm p-6`)
- [x] `PageHeader` semântico na página de criação com breadcrumb funcional de volta para `/chamadas`
- [x] Cockpit `/chamadas` limpo com botão primário no slot `actions` (`data-testid="btn-nova-chamada"`)
- [x] Formulário retrátil antigo de criação removido do topo da listagem de chamadas
- [x] Cards de chamadas existentes padronizados com container branco de destaque
- [x] Estado vazio `calls-empty` atualizado com container em card e link para criar primeira chamada
- [x] Contratos de seletores e Server Actions preservados (`create-call`, `btn-nova-chamada`, `call-row-*`)
- [x] Testes unitários novos criados e passando (`tests/unit/f93-separacao-cadastro-de-chamada.test.ts`)
- [x] Teste E2E novo criado e passando (`tests/e2e/f93-nova-chamada-separada.spec.ts`)
- [x] Teste E2E legado `call-for-proposals.spec.ts` atualizado e passando
- [x] Catracas `f76`, `f78` e `f79` atualizadas e passando
- [x] Tamanho do `AGENTS.md` controlado em 64.611 bytes (<= 64.800 bytes)
- [x] `README.md` atualizado com estado da fase e índice na §11

