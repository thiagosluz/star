# FASE 92 — Padronização em cards brancos e cadastro in-page de salas

> **Status:** Concluída e Verificada  
> **Data:** Novembro de 2026  
> **Escopo:** Interface (RSC), UX, Design Tokens, Retrocompatibilidade e Bateria de Testes  
> **ADRs adicionadas:** ADR-399 (numeração global sequencial)

---

## 1. Sumário executivo

A **FASE 92** padronizou a página de gestão de salas físicas do evento ([`src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/salas/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/salas/page.tsx)) em **dois cards brancos destacados (`bg-card rounded-xl border border-border shadow-sm`)**, alinhando seu padrão visual e contraste com as páginas recém-refatoradas de eventos e programação.

Diante da análise sincera de experiência do usuário (UX), a criação de uma rota separada `/salas/nova` foi descartada em favor de manter o cadastro **in-page**: como a sala é uma entidade de catálogo rápido com apenas **2 campos** (`name` e `capacity` opcional), forçar a navegação para uma nova página a cada sala adicionada geraria atrito severo (*over-navigation*) no setup em lote de um evento. O verdadeiro problema da tela era a ausência de hierarquia e container visual. A refatoração organizou a tela no padrão **Card 1 (Listagem de salas cadastradas + badges + empty state)** e **Card 2 (Formulário in-page de cadastro rápido com cabeçalho dedicado)**, preservando 100% dos seletores contratuais e fluxos E2E existentes.

### Tabela de entregas e números da fase

| Entrega | Arquivo | Responsabilidade |
|---|---|---|
| **Página de salas padronizada** | `src/.../eventos/[eventId]/salas/page.tsx` | Estruturação em duplo card branco (`bg-card rounded-xl border border-border shadow-sm`), cabeçalho de seção claro, empty state em card e formulário in-page |
| **Testes unitários da fase** | `tests/unit/f92-padronizacao-cards-de-salas.test.ts` | 4 testes cobrindo renderização dos dois cards brancos, badges de capacidade, empty state e preservação dos `data-testid` |
| **Teste E2E da fase** | `tests/e2e/f92-padronizacao-salas.spec.ts` | Cenário Playwright no navegador verificando empty state em card, cadastro de primeira sala com capacidade, cadastro de segunda sala sem limite e validação visual de card |
| **Catraca de fases** | `tests/unit/f79-fases-no-arquivo-certo.test.ts` | Atualização para contemplar movimento de F66/F67 para histórico e corrente 68..92 |
| **Histórico de fases** | `docs/fases-historico.md` | Fases 66 e 67 movidas como estavam |
| **Documentação da fase** | `docs/fase-92-padronizacao-cards-de-salas.md` | Este documento com sumário, decisões, ADR-399 e evidências |

### Números da fase

* **Arquivos modificados/criados:** 7 arquivos (`salas/page.tsx`, `f92-*.test.ts`, `f92-*.spec.ts`, `f79-*.test.ts`, `fases-historico.md`, `AGENTS.md`, `README.md`)
* **Testes Vitest:** 4.748 passando (+4 unitários) em 270 arquivos
* **Testes Playwright E2E:** 512 passando (+1 novo) + 1 skip
* **ADR:** ADR-399
* **Dívidas técnicas:** 44 abertas (inalterado)

---

## 2. O problema mais difícil e por que ele define o desenho

O problema central da FASE 92 não foi técnico, mas de **equilíbrio entre coerência arquitetural e atrito de usabilidade (UX)**.

Nas fases anteriores (FASE 90 e FASE 91), retiramos os formulários de cadastro de evento e de atividade das suas respectivas páginas de listagem e os transformamos em páginas dedicadas (`/eventos/novo` e `/programacao/nova`). A tentação ingênua seria aplicar cegamente a mesma regra para salas (`/salas/nova`).

Contudo, a análise da jornada do usuário revelou que:
1. Cadastrar um **evento** envolve mais de 17 campos (datas, fuso, endereço, cores, regras de submissão);
2. Cadastrar uma **atividade** envolve mais de 15 campos mais um checklist aninhado dinâmico de confirmação de vaga;
3. Cadastrar uma **sala** envolve apenas **2 campos** (`name` e `capacity`).
4. Um organizador que prepara o evento cria tipicamente de 3 a 6 salas em lote. Se cada sala exigisse uma navegação de página cheia (`/salas` → `/salas/nova` → submit → `/salas` → `/salas/nova`), o custo de troca de contexto e latência tornaria a plataforma cansativa e truncada.

Com as Server Actions do Next.js 16 (`saveRoomAction`), o formulário in-page executa a mutação no banco e revalida a rota instantaneamente. Bastou encapsular o formulário e a listagem em **cards brancos semanticamente delimitados** para eliminar a poluição visual sem impor atrito de navegação.

---

## 3. Decisões técnicas explicadas

### 3.1 Duplo Card Branco (`bg-card rounded-xl border border-border shadow-sm`)
Em vez de deixar a lista e o formulário misturados soltos no fundo da página, a tela foi dividida em dois blocos limpos:
- **Card 1 (Listagem de Salas):** `<ul>` encapsulada com `divide-y divide-border rounded-xl border border-border bg-card shadow-sm`. Cada item possui badge de capacidade (`code-data inline-flex items-center rounded-md border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-mono`), `<details>` de edição estilisado e botão de exclusão destrutivo com confirmação.
- **Card 2 (Novo Espaço):** `<div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">` com título semântico `<h2>Cadastrar nova sala</h2>`, subtítulo instrutivo e grid responsivo com os dois campos e botão `Salvar sala`.

### 3.2 Empty State em Card Acolhedor
Quando `event.rooms.length === 0`, em vez de um simples `<p className="text-sm text-muted-foreground">` solto, a tela exibe um container card branco (`data-testid="rooms-empty"`) com ícone `DoorOpen`, título em destaque e texto descritivo, preservando a substring exigida pelos testes E2E (`Nenhuma sala cadastrada.`).

---

## 4. ADRs (Architectural Decision Records)

### ADR-399 — Padronização em dois cards brancos e manutenção do cadastro in-page de salas

* **Contexto:** A tela `/salas` apresentava inconsistência visual com as páginas recentes de eventos e programação por não utilizar cards brancos (`bg-card rounded-xl border border-border shadow-sm`) e por ter o formulário de cadastro posicionado solto no rodapé. Avaliou-se se a criação deveria ir para uma nova rota `/salas/nova`.
* **Decisão:** Manter o cadastro de salas na mesma página `/salas`, estruturando a tela em dois cards brancos destacados: (1) Card de salas cadastradas com empty state dedicado; (2) Card de criação de sala com título de seção e layout em grid responsivo.
* **Justificativa:** A entidade Sala possui apenas 2 campos e é configurada em lote. Criar uma nova rota introduziria atrito severo de navegação (*over-navigation*). As Server Actions já revalidam a página instantaneamente após a submissão, proporcionando o melhor fluxo operacional possível.
* **Consequências:** Visual 100% harmonizado com a plataforma; contraste corrigido; zero quebras nos contratos contratuais e nos testes E2E legados (`room-lifecycle.spec.ts` e `platform-journey.spec.ts`).

---

## 5. Lições aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| O `AGENTS.md` bateria no teto de 64.800 bytes (64.625 + nova linha) | O arquivo acumulou muitas fases na tabela corrente da §9 | Conforme protocolo da §2, as fases 66 e 67 foram movidas como estavam para `docs/fases-historico.md`, mantendo `AGENTS.md` em 64.591 bytes |
| Testes E2E de ciclo de vida de salas exigiam presença de `rooms-empty` com texto exato | `room-lifecycle.spec.ts` valida `rooms.toContainText('Nenhuma sala cadastrada')` | O card de empty state preservou a frase exata "Nenhuma sala cadastrada." garantindo integridade de regressão |

---

## 6. Evidência de verificação

Comandos executados e seus resultados reais:

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
   # 4748 passed (270 test files)
   ```
4. **Build de produção Next.js:**
   ```bash
   npm run build
   # Compiled successfully in 5.8s
   ```
5. **Verificação de banco e isolamento:**
   ```bash
   npm run db:verify
   # Contrato íntegro.
   npm run db:verify:isolation
   # 9/9 verificações passaram.
   npm run db:partitions
   # Partições íntegras.
   ```
6. **E2E Playwright:**
   ```bash
   docker compose --profile app up -d --build web worker
   npm run test:e2e
   # 512 passed, 1 skipped (513 casos)
   ```

---

## 7. Comandos operacionais

```bash
# Rodar testes unitários de salas da F92:
npx vitest run tests/unit/f92-padronizacao-cards-de-salas.test.ts

# Rodar teste E2E Playwright da F92:
npx playwright test tests/e2e/f92-padronizacao-salas.spec.ts --project=chromium

# Rodar todos os testes de ciclo de vida de salas:
npx playwright test tests/e2e/room-lifecycle.spec.ts --project=chromium
```

---

## 8. Dívidas técnicas e pontos de atenção

* A contagem consolidada de dívidas permanece estável em **44 itens abertos** (nenhum item novo adicionado, nenhum item do catálogo quitado).
* As salas físicas continuam funcionando como o teto atômico de vagas das atividades vinculadas.

---

## 9. Checklist de aceite

- [x] Contraste e fundo branco (`bg-card rounded-xl border border-border shadow-sm`) aplicados na listagem de salas.
- [x] Empty state de salas encapsulado em container card acolhedor.
- [x] Formulário de nova sala estruturado em card dedicado com cabeçalho semântico e grid harmônico.
- [x] Decisão de manter in-page justificada técnica e operacionalmente (ADR-399).
- [x] 100% dos seletores contratuais preservados (`rooms-section`, `room-list`, `create-room`, `room-row-*`, etc.).
- [x] Testes unitários da FASE 92 criados e passando (4/4).
- [x] Teste E2E da FASE 92 criado e passando.
- [x] Regressão zero nos testes E2E legados (`room-lifecycle.spec.ts` e `platform-journey.spec.ts`).
- [x] Catraca de fases `f79-fases-no-arquivo-certo.test.ts` passando (5/5).
- [x] Bateria de verificação completa executada com sucesso.

