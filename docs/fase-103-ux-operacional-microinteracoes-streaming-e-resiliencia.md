# FASE 103 — Excelência de UX Operacional: Micro-interações Otimistas, Streaming de Dados, Teclado Power-User e Proteção de Rascunho

> **Data de entrega:** 11 de novembro de 2026  
> **Estado:** Entregue e verificada  
> **ADRs introduzidas:** ADR-429, ADR-430 e ADR-431 (numeração global: 429 a 431)  
> **Bateria de verificação:** ESLint 0 · tsc 0 · 4827 testes Vitest passando (281 arquivos) · 527 testes Playwright E2E (+ 1 skip)

---

## 1. Sumário Executivo

A FASE 103 consolida um salto qualitativo na reatividade e ergonomia do Koveno sob Next.js 16 (App Router) e React 19, atacando seis gargalos operacionais identificados em auditoria de UX:

1. **`FavoriteButton` 100% Otimista no React 19 (ADR-429):** Transforma o botão de favoritar em um Client Component interativo com `useOptimistic` e `useTransition` para resposta em 0ms (preenchimento do ícone de coração, texto visível e `aria-pressed`), preservando rigorosamente o `<form action={toggleFavoriteAction}>` nativo para garantir 100% de compatibilidade com ambientes No-JS (`javaScriptEnabled: false` no E2E da F65);
2. **Streaming e Suspense Granular em `/participantes` (ADR-430):** Desacopla as pesadas agregações históricas da base (visitas, minutos, certificados, cartas colecionáveis e XP) em um Server Component isolado (`ParticipantResults`), envolvido por `<Suspense fallback={<ParticipantSkeleton />}>` com chaveamento de filtros, entregando o cabeçalho (`PageHeader`) e a barra de filtros (`ParticipantFilterBar`) no milissegundo zero;
3. **Fila de Confirmação de Vagas Reativa e Otimista (ADR-429):** Substitui as submissões isoladas de itens da fila por `ConfirmationItemsChecklist`, que utiliza `useOptimistic` para tachar itens e atualizar contagens instantaneamente na transição do operador, eliminando o recarregamento total da página de administração a cada item recebido;
4. **Expansão Canônica do `AppLink` para Breadcrumbs e Links de Tabela (ADR-426):** Adota `<AppLink>` nos breadcrumbs e link de retorno do `PageHeader` padrão e na paginação de tabelas, integrando o progresso visual de navegação determinístico do Next.js 16 e preservando a catraca estrita de Server Component (zero hooks e sem `'use client'` em `page-header.tsx`);
5. **Navegação Operacional por Teclado nas Filas (`ArrowUp` / `ArrowDown` + `Enter` · ADR-431):** Introduz atalhos de alta produtividade em `CheckinQueue` e `ParticipantDirectory`, permitindo aos operadores percorrer pessoas com as setas direcionais (destaque visual `data-active-row="true"` e anel de foco) e executar a ação primária (credenciar ou abrir ficha 360) pressionando `Enter`;
6. **Prevenção de Perda de Rascunho em Editores Críticos (`useUnsavedChanges` · ADR-431):** Cria hook reutilizável com escuta em `beforeunload` e interceptação na fase de captura de cliques de links internos para proteger editores complexos (como o diagramador visual de certificados) contra navegação acidental ou fechamento involuntário de aba.

### Tabela de Entregas

| Componente / Módulo | Caminho | O que faz |
|---|---|---|
| `FavoriteButton` | `src/components/events/favorite-button.tsx` | Client Component com `useOptimistic` 0ms e formulário progressivo No-JS nativo |
| `ParticipantSkeleton` | `src/components/participants/participant-skeleton.tsx` | Esqueleto acessível com `aria-busy` e placeholders animados para streaming |
| `ParticipantResults` | `src/components/participants/participant-results.tsx` | Server Component assíncrono isolado para streaming de dados em `/participantes` |
| `ParticipantsPage` | `src/app/t/[tenantSlug]/(app)/participantes/page.tsx` | Shell imediato com `<Suspense>` cirúrgico sob chave de filtros composta |
| `ConfirmationItemsChecklist` | `src/components/admin/confirmation-items-checklist.tsx` | Checklist otimista com `useOptimistic` para itens de comprovação de vaga |
| `PageHeader` & `Breadcrumbs` | `src/components/ui/page-header.tsx` | Adoção canônica de `<AppLink>` preservando contrato estrito de Server Component |
| `CheckinQueue` | `src/components/gamification/checkin-queue.tsx` | Navegação por `ArrowDown`/`ArrowUp` + `Enter` com dica visual e `data-active-row` |
| `ParticipantDirectory` | `src/components/participants/participant-directory.tsx` | Navegação por setas + `Enter` para abrir ficha e `Espaço` para selecionar |
| `useUnsavedChanges` | `src/hooks/use-unsaved-changes.ts` | Hook de proteção contra perda de rascunhos em navegações acidentais |
| `CertificateTemplateEditor` | `src/components/admin/certificate-template-editor.tsx` | Integração de proteção `useUnsavedChanges` em modificações no layout |
| Testes Unitários | `tests/unit/f103-ux-operacional-microinteracoes-streaming-e-resiliencia.test.ts` | 6 testes provando contrato otimista, No-JS, esqueleto e teclado |
| Testes E2E | `tests/e2e/f103-ux-operacional-microinteracoes-streaming-e-resiliencia.spec.ts` | 3 cenários em navegador real cobrindo favoritar, filas e streaming |

### Números da Fase

```text
Arquivos criados ......... 4 (participant-skeleton.tsx, participant-results.tsx, confirmation-items-checklist.tsx, use-unsaved-changes.ts)
Arquivos editados ........ 7 (favorite-button.tsx, page-header.tsx, checkin-queue.tsx, participant-directory.tsx, certificate-template-editor.tsx, confirmacoes/page.tsx, participantes/page.tsx)
Testes novos ............. 6 Vitest + 3 cenários Playwright E2E
Contagem total ........... 4827 Vitest (281 arquivos) + 527 Playwright E2E (+ 1 skip)
ADRs novas ............... ADR-429, ADR-430, ADR-431 (numeração global: 429 a 431)
```

---

## 2. O Problema Mais Difícil da Fase

O desafio arquitetural central foi **unificar micro-interações otimistas instantâneas com progressive enhancement estrito sem regressão No-JS**:

No Next.js 16 com React 19, `useOptimistic` exige execução dentro de uma transição (`startTransition` ou React Action). Ao mesmo tempo, a suíte de testes de ponta a ponta da FASE 65 (`tests/e2e/f65-minha-agenda.spec.ts`) executa intencionalmente com `javaScriptEnabled: false` para garantir que pessoas e ambientes sem JavaScript consigam favoritar e navegar na programação.

Se o componente `FavoriteButton` fosse transformado em um controle puramente baseado em `onClick` ou se o `<form action={toggleFavoriteAction}>` fosse substituído por uma closure de cliente simples, o Next.js não emitiria no HTML inicial os campos e a rota POST de progressive enhancement durante o SSR, quebrando imediatamente o teste sem JavaScript.

A solução arquitetada em ADR-429 mantém o `<form action={toggleFavoriteAction}>` diretamente no elemento JSX para geração SSR de progressive enhancement, e adiciona `onSubmit={(e) => { e.preventDefault(); ... startTransition(...) }}` para que, no navegador com JavaScript hidratado, a submissão nativa seja interceptada para acionar o `useOptimistic` em 0ms e executar a Server Action com redirecionamento suave no cliente.

---

## 3. Decisões Técnicas Explicadas

1. **Preenchimento Otimista Sem Falso Negativo de Rede:** Ao alternar favoritos ou checklist, `useOptimistic` atualiza o DOM antes da viagem de rede. Como a Server Action subjacente é idempotente (`favoriteActivity` e `resolveConfirmationItemAction`), se houver qualquer divergência ou reconexão, o estado real retornado pelo servidor sincroniza o valor sem deixar o usuário em estado órfão.
2. **Key Composta no Componente Interno de Resultados em Vez da Raiz:** Em `/participantes`, a prop `key={filterKey}` foi posicionada diretamente no Server Component `<ParticipantResults key={filterKey} ...>` dentro do `<Suspense fallback={<ParticipantSkeleton />}>`. Isso preserva o comportamento estabelecido na FASE 102 (ADR-428): em navegações iniciadas por `useTransition`, o React 19 mantém os resultados anteriores visíveis até que o novo payload esteja pronto, evitando o "flicker" ou flash branco desnecessário de esqueletos.
3. **Navegação por Teclado Ignora Elementos Editáveis:** Os listeners de `ArrowDown`, `ArrowUp` e `Enter` em `CheckinQueue` e `ParticipantDirectory` verificam se o `event.target` é um `HTMLInputElement`, `HTMLTextAreaElement` ou `HTMLSelectElement`, garantindo que o operador possa digitar buscas e notas sem que o cursor do teclado movimente a seleção das linhas da tabela.

---

## 4. Architectural Decision Records (ADRs)

### ADR-429 — Micro-interações Otimistas com useOptimistic e Progressive Enhancement Híbrido
- **Contexto:** Botões de favoritar e marcação de itens de checklist exigem resposta tátil de 0ms para eliminar hesitação do usuário, mas não podem quebrar o suporte a No-JS.
- **Decisão:** Manter `<form action={ServerAction}>` declarativo com `onSubmit` com `e.preventDefault()` chamando `startTransition` com `useOptimistic`.
- **Justificativa:** Garante 0ms de latência percebida com JavaScript ativo e integridade funcional com JavaScript desativado.
- **Consequências:** Atende integralmente aos testes com `javaScriptEnabled: false` e oferece experiência moderna de aplicativo no cliente.

### ADR-430 — Streaming Granular e Isolamento de Agregação em Diretórios
- **Contexto:** Telas com consolidação de histórico completo (`/participantes`) bloqueavam o carregamento do cabeçalho e da barra de filtros durante cálculos pesados de banco.
- **Decisão:** Extrair a consulta de listagem para `<ParticipantResults>` envolvido em `<Suspense fallback={<ParticipantSkeleton />}>` com `PageHeader` imediato.
- **Justificativa:** O usuário percebe a interface responsiva instantaneamente e a barra de busca pode ser interagida enquanto a tabela carrega em streaming.
- **Consequências:** Elimina travamentos na navegação inicial e nas trocas de paginação.

### ADR-431 — Atalhos de Teclado Operacionais e Proteção de Rascunho
- **Contexto:** Operadores de credenciamento e atendimento manipulam centenas de cadastros em filas rápidas, enquanto diagramadores de modelos de certificados correm risco de perda de trabalho por recarga inadvertida.
- **Decisão:** Introduzir atalhos de setas e Enter em filas e tabelas (`CheckinQueue` e `ParticipantDirectory`) e criar hook `useUnsavedChanges` com guardas de `beforeunload` e links.
- **Justificativa:** Aumenta a velocidade de atendimento em balcões sem mouse e evita frustração por perda de dados em editores ricos.
- **Consequências:** Fluxo de trabalho otimizado para operadores de alta cadência e resiliência contra acidentes de navegação.

---

## 5. Lições Aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| `TS2322: Type 'string \| null' is not assignable to 'string \| undefined'` em `page.tsx` | `resolveEventQuerySelection` retorna `selectedEventId` como `string \| null` | Passado `selectedEventId={selectedEventId ?? undefined}` na chamada do componente filho |
| `TS2322: Signature provides too few arguments` em `ConfirmationItemsChecklist` | `resolveConfirmationItemAction` requer 2 argumentos (`_prev, formData`) de `useActionState` | Envolvido em handler de formulário React 19 `(formData) => handleResolve(...)` passando `null` no primeiro argumento |
| Foco preso em input impedindo atalhos de navegação | Foco automático no input de busca capturava `ArrowDown`/`ArrowUp` | Adicionada guarda explícita ignorando eventos quando disparados dentro de `INPUT` ou `TEXTAREA` |

---

## 6. Evidência de Verificação

### 1. ESLint e Typecheck
```text
npm run lint: 0 erros, 0 warnings
npm run typecheck: 0 erros
```

### 2. Vitest
```text
npm test: 4827 testes passando em 281 arquivos
```

### 3. Build Turbopack
```text
npm run build: Compiled successfully
```

### 4. Integridade de Banco e Isolamento RLS
```text
npm run db:verify: Contrato íntegro.
npm run db:verify:isolation: 9/9 verificações passaram.
npm run db:partitions: 11 partições íntegras.
```

### 5. Playwright E2E
```text
docker compose --profile app up -d --build web worker
npm run test:e2e: 527 testes passando + 1 skip (528 casos totais)
```

---

## 7. Comandos Operacionais

```bash
# Rodar testes unitários da F103:
npx vitest run tests/unit/f103-ux-operacional-microinteracoes-streaming-e-resiliencia.test.ts

# Rodar testes E2E da F103:
npm run test:e2e tests/e2e/f103-ux-operacional-microinteracoes-streaming-e-resiliencia.spec.ts

# Reconstruir containers de aplicação:
docker compose --profile app up -d --build web worker
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

1. **44 dívidas técnicas consolidadas:** O saldo de dívidas do projeto permanece em 44 itens abertos (nenhuma dívida nova introduzida; todos os componentes criados possuem testes unitários e E2E correspondentes).
2. **Preservação de Tamanho do `AGENTS.md`:** A Fase 85 foi movida para `docs/fases-historico.md`, mantendo `(Get-Item AGENTS.md).Length` em 63.375 bytes (abaixo do teto de 64.800 bytes).

---

## 9. Checklist de Aceite

- [x] `FavoriteButton` atualizado com `useOptimistic` e `useTransition` preservando `<form action={toggleFavoriteAction}>`
- [x] Streaming de dados com `<Suspense>` e `ParticipantSkeleton` em `/participantes`
- [x] `ConfirmationItemsChecklist` otimista na fila de confirmações de vaga
- [x] `PageHeader` e `Breadcrumbs` atualizados com `<AppLink>` mantendo contrato de Server Component
- [x] Navegação por teclado (`ArrowDown`, `ArrowUp`, `Enter`) em `CheckinQueue` e `ParticipantDirectory`
- [x] Hook `useUnsavedChanges` criado e integrado a `CertificateTemplateEditor`
- [x] Suíte de testes unitários criada e validada (`f103-ux-operacional-microinteracoes-streaming-e-resiliencia.test.ts`)
- [x] Suíte de testes E2E criada e validada (`f103-ux-operacional-microinteracoes-streaming-e-resiliencia.spec.ts`)
- [x] Documento da fase criado com as 9 seções obrigatórias e ADRs 429 a 431
- [x] `README.md`, `AGENTS.md` e `docs/fases-historico.md` sincronizados
- [x] Bateria de verificação (§4) executada com 100% de aprovação
