# FASE 105 — Polimento de UX, Acessibilidade Assistiva e Guardião de Rascunhos

> **Sumário executivo:** A FASE 105 consolida o refinamento final de acessibilidade por teclado, leitores de tela e proteção de formulários na plataforma Koveno. Foram corrigidos quatro pontos reais de fricção operacional: (1) eliminação do sequestro de `Enter` e `Espaço` por listeners globais quando o foco do usuário está em links, botões ou elementos interativos em `ParticipantDirectory` e `CheckinQueue`, somada ao ajuste de limites (`clampListIndex`) quando a lista encolhe após filtragem; (2) cobertura integral do campo `keywords` (`KeywordsInput`) no rastreamento de alterações não salvas (`isDirty`) de `SubmissionDraftForm`, além do rótulo explícito `"Salvando…"` no botão durante `pending`; (3) prevenção de falsos positivos de `useUnsavedChanges` quando o usuário abre links em nova aba (`Ctrl`/`Cmd`/`Shift`+clique ou botão auxiliar) ou clica na mesma URL atual; e (4) silêncio inicial da região `aria-live="polite"` de `FavoriteButton` até a primeira interação na sessão, evitando poluição auditiva em leitores de tela ao percorrer listas de atividades.

---

## 1. Entregas e Números da Fase

| Entregável | Arquivos Modificados / Criados | Responsabilidade Principal |
|---|---|---|
| **Guardas de Teclado em Listas (ADR-435)** | `src/hooks/keyboard-navigation.ts`<br>`src/components/participants/participant-directory.tsx`<br>`src/components/gamification/checkin-queue.tsx` | Utilitários `shouldIgnoreListKeyEvent` e `clampListIndex` evitando sequestro de foco em links/botões e índices fora de faixa. |
| **Silêncio Inicial de `aria-live` (ADR-436)** | `src/components/events/favorite-button.tsx` | Estado `hasInteracted` mantém `<span aria-live="polite">` vazio até o primeiro clique na sessão. |
| **Cobertura de `keywords` e Feedback `Salvando…`** | `src/components/review/keywords-input.tsx`<br>`src/components/review/submission-draft-form.tsx` | Suporte a valor controlado em `KeywordsInput`, inclusão de `keywords` no `isDirty`/`lastSaved` e rótulo `"Salvando…"` em `SaveButton`. |
| **Prevenção de Falso Positivo em Rascunhos** | `src/hooks/use-unsaved-changes.ts` | Ignora cliques com teclas modificadoras (`Ctrl`/`Meta`/`Shift`/`Alt`), botão auxiliar e cliques para a URL corrente. |
| **Testes Automatizados** | `tests/unit/f105-polimento-ux-acessibilidade.test.ts`<br>`tests/e2e/f105-polimento-ux-acessibilidade.spec.ts`<br>`tests/unit/f104-refinamento-ux-e-resiliencia.test.ts` | 8 novos testes unitários (Vitest) + 2 novos cenários E2E (Playwright) validando teclado, `aria-live` e guardião de rascunho. |

### Números da Fase
- **Arquivos criados na aplicação:** 1 (`src/hooks/keyboard-navigation.ts`)
- **Arquivos modificados na aplicação:** 5 (`favorite-button.tsx`, `checkin-queue.tsx`, `participant-directory.tsx`, `keywords-input.tsx`, `submission-draft-form.tsx`, `use-unsaved-changes.ts` — 6 arquivos no total com o hook)
- **Novos arquivos de teste:** 2 (`tests/unit/f105-polimento-ux-acessibilidade.test.ts` e `tests/e2e/f105-polimento-ux-acessibilidade.spec.ts`)
- **Novos testes unitários:** 8
- **Novos testes E2E:** 2
- **Total da suíte Vitest:** 4.842 testes passando (283 arquivos)
- **Total da suíte Playwright:** 532 testes passando + 1 skip (533 cenários)
- **Migrações de banco:** 0
- **ADRs introduzidas:** 2 (ADR-435, ADR-436 — numeração global sequencial)

---

## 2. O Problema Mais Difícil da Fase

O ponto mais delicado da FASE 105 foi garantir **ergonomia de atalhos globais sem violar a fronteira de acessibilidade e arquitetura cliente/servidor**:

1. **Fronteira de foco no DOM:** Listeners globais em `window` (`ArrowDown`, `ArrowUp`, `Enter`, `Espaço`) oferecem velocidade operacional no balcão e no diretório, mas quando o usuário navega via `Tab` para fora da lista (ex.: menu lateral, paginação, botão de exportar) e pressiona `Enter`, o listener não pode interceptar o evento — caso contrário, o usuário nunca consegue acionar o link focado pelo teclado.
2. **Fronteira arquitetural (`@/hooks` vs `@/lib`):** Inicialmente o helper compartilhado foi criado em `src/lib/utils/keyboard-navigation.ts`, mas a catraca AST da FASE 96 (`f96-arquitetura-pool-payload-hidratacao-e-fronteira.test.ts`) bloqueou o import por Client Components para impedir vazamento de módulos de servidor. Mover o helper puramente de UI para `src/hooks/keyboard-navigation.ts` preservou a regra arquitetural sem abrir exceções na allowlist.

---

## 3. Decisões Técnicas Explicadas

### 3.1 Derivação de índice limitado (`clampListIndex`) durante o render
Em vez de adicionar um `useEffect` chamando `setState` quando `entries.length` diminui após uma busca, o componente calcula `clampListIndex(rawIndex, entries.length)` diretamente durante a renderização. Isso segue o modelo idiomático do React 19 (estado derivado sem render duplo) e impede que `entries[activeIndex]` acesse posição inexistente.

### 3.2 Controle opcional em `KeywordsInput`
Para não quebrar outros consumidores de `KeywordsInput` que dependem apenas de `defaultValue`, o componente passou a aceitar `value` e `onValueChange` opcionais, operando como não-controlado quando `value` não é informado e como controlado dentro de `SubmissionDraftForm`.

---

## 4. ADRs da Fase

### ADR-435 — Guardas de Alvo Interativo e Limite de Índice em Atalhos Globais de Lista
- **Contexto:** Listeners de teclado em `window` em `ParticipantDirectory` e `CheckinQueue` filtravam apenas `input`, `textarea` e `select`, sequestrando `Enter` e `Espaço` quando o foco estava em `<a>`, `<button>`, `[role="button"]`, `<summary>` ou `contentEditable`.
- **Decisão:** Centralizar em `src/hooks/keyboard-navigation.ts` as funções puras `shouldIgnoreListKeyEvent` (que respeita `defaultPrevented`, teclas modificadoras, campos editáveis e elementos interativos ancestrais para `Enter`/`Espaço`) e `clampListIndex` (para manter o índice dentro de `entries.length`).
- **Justificativa:** Garante navegação previsível por `Tab` + `Enter` em toda a página sem perder o fluxo rápido com setas na tabela.
- **Consequências:** Operadores de teclado e tecnologias assistivas navegam livremente entre a lista e o restante da interface sem ações inesperadas.

### ADR-436 — Silêncio Inicial de Regiões `aria-live` em Controles de Lista
- **Contexto:** `FavoriteButton` preenchia `<span aria-live="polite" className="sr-only">` já no HTML inicial com `"Atividade removida da sua agenda"` antes de qualquer interação, gerando ruído repetitivo na navegação sequencial por leitor de tela.
- **Decisão:** Rastrear `hasInteracted` localmente e manter o conteúdo da região `aria-live` vazio (`""`) até a primeira submissão do botão na sessão.
- **Justificativa:** Anúncios de estado em regiões vivas devem comunicar mudanças resultantes de ações do usuário, não poluir a leitura passiva de cards não interagidos.
- **Consequências:** Leitura limpa em grades com dezenas de atividades, preservando o anúncio imediato ao favoritar ou desfavoritar.

---

## 5. Lições Aprendidas

| Sintoma Encontrado em Teste | Causa Raiz | Correção Aplicada |
|---|---|---|
| Falha na catraca AST de fronteira cliente/servidor (`tests/unit/f96-arquitetura-pool-payload-hidratacao-e-fronteira.test.ts`). | O helper `keyboard-navigation.ts` foi inicialmente colocado em `src/lib/utils/`, fora da allowlist de `@/lib` para Client Components. | Movido para `src/hooks/keyboard-navigation.ts` (camada exclusiva de cliente), mantendo a allowlist de `@/lib` intacta. |
| Quebra esperada no teste unitário da F104 (`f104-refinamento-ux-e-resiliencia.test.ts`) sobre texto inicial de `agenda-live`. | O teste da F104 validava que `aria-live` continha `'agenda'` na renderização estática inicial, comportamento alterado intencionalmente pela ADR-436. | Atualizada a asserção da F104 para validar o silêncio inicial (`''`) enquanto o teste E2E da F104 e da F105 valida o anúncio após o clique. |
| Falha intermitente em `tests/integration/f71-vitrine-e-leads.test.ts` (`getFeaturedPublicEvents`). | 50 instituições residuais de execuções E2E anteriores ocupavam os primeiros lugares da vitrine pública (limite de 10 destaques). | Executada limpeza explícita com `npm run e2e:clean -- --confirmar`, restaurando o banco limpo e passando 10/10 no teste. |

---

## 6. Evidência de Verificação

### 6.1 Testes Unitários e de Integração (Vitest)
```bash
npm test
```
*Resultado:*
- **283 arquivos de teste** executados.
- **4.842 testes passando** (100% verde).
- `tests/unit/f105-polimento-ux-acessibilidade.test.ts` com 8 testes cobrindo ADR-435, ADR-436, `useUnsavedChanges` e `SubmissionDraftForm`.

### 6.2 Testes E2E (Playwright)
```bash
npm run test:e2e
```
*Resultado:*
- **532 cenários passando**, **1 cenário ignorado (skip)** de um total de **533 cenários**.
- `tests/e2e/f105-polimento-ux-acessibilidade.spec.ts` validou em navegador real (Chromium):
  1. `FavoriteButton` inicia com `aria-live` vazio e anuncia somente após o clique otimista.
  2. `ParticipantDirectory` com linha ativa (`ArrowDown`) preserva a navegação via `Enter` em link focado do menu lateral.

### 6.3 Qualidade Estática, Build e Contrato de Banco
```bash
npm run lint                # 0 erros, 0 avisos
npm run typecheck           # 0 erros TypeScript
npm run build               # Compiled successfully in 3.7s (TypeScript 4.5s, 19/19 estáticas)
npm run db:verify           # Contrato íntegro
npm run db:verify:isolation # 9/9 verificações passaram
npm run db:partitions       # Partições ativas verificadas
```

---

## 7. Comandos Operacionais

```bash
# Testes específicos da FASE 105
npx vitest run tests/unit/f105-polimento-ux-acessibilidade.test.ts
npx playwright test tests/e2e/f105-polimento-ux-acessibilidade.spec.ts

# Bateria completa
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- **Contagem de dívidas técnicas:** Mantida em **44 itens** (nenhuma nova dívida criada).
- **Ponto de atenção:** Ao rodar testes de integração após múltiplas suítes E2E interrompidas, executar `npm run e2e:clean -- --confirmar` caso fixtures residuais ocupem o topo de queries públicas com `LIMIT`.

---

## 9. Checklist de Aceite

- [x] `shouldIgnoreListKeyEvent` e `clampListIndex` aplicados em `ParticipantDirectory` e `CheckinQueue`.
- [x] `FavoriteButton` com `aria-live="polite"` vazio até a primeira interação na sessão.
- [x] `SubmissionDraftForm` rastreando `keywords` em `isDirty`/`lastSaved` e exibindo `"Salvando…"` durante `pending`.
- [x] `useUnsavedChanges` ignorando cliques com modificadores (`Ctrl`/`Meta`/`Shift`/`Alt`), botão auxiliar e mesma URL.
- [x] Novos testes unitários (8) e E2E (2) criados e passando.
- [x] Bateria completa de verificação (lint, typecheck, Vitest, build, db:verify, db:verify:isolation, db:partitions e Playwright E2E) 100% verde.

