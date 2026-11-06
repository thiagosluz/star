# FASE 90 — Separação do Cadastro de Evento (`/eventos/novo`) e Cockpit Limpo do Acervo (`/eventos`)

> **Estado:** Concluída e verificada · **Data:** 05 de novembro de 2026  
> **ADR:** ADR-397 (numeração sequencial global)  
> **Testes:** 4.738 testes Vitest (268 arquivos) + 510 testes Playwright E2E (+ 1 skip)  
> **Dívidas quitadas:** Nenhuma dívida numerada quitada (melhoria arquitetural e de UX aprovada pelo usuário)  
> **Dívidas abertas:** 44 itens mantidos (A=4, B=5, C=1, D=3, E=25, F=5, H=0, I=1)

---

## 1. Sumário executivo

A **FASE 90** atacou uma sobrecarga cognitiva e estrutural no gerenciamento de eventos da instituição (`/t/<slug>/administracao/eventos`): até a FASE 89, a página acumulava a listagem de todos os eventos cadastrados da instituição e, logo abaixo, o formulário extenso de cadastro com 17 campos. Conforme o acervo de eventos crescia, o formulário competia com a lista e ficava empurrado para o rodapé, forçando scroll desnecessário e gerando ruído de interface.

A fase separou as duas responsabilidades:
1. **A listagem (`/t/<slug>/administracao/eventos`) virou um cockpit limpo e focado**: lista todos os eventos com links de gestão e métricas, adiciona o botão de ação primária `Novo evento` (`data-testid="btn-novo-evento"`) no slot `actions` do `PageHeader` e, no estado vazio, orienta a criação do primeiro evento (mantendo o link para a tela de demonstração fictícia da F77).
2. **O cadastro ganhou rota dedicada (`/t/<slug>/administracao/eventos/novo`)**: Server Component protegido por `requirePagePermission(PERMISSIONS.EVENT_UPDATE)`, estruturado em layout espaçoso de duas colunas, com `PageHeader` semântico (`eyebrow="OPERAÇÃO"` da fonte única e breadcrumb com volta automática para a lista de eventos) e formulário `<AdminForm action={saveEventAction} testId="create-event">`.

### Tabela de entregas da fase

| Entrega | O que mudou | Arquivos tocados |
|---|---|---|
| **Rota dedicada de criação (`/eventos/novo`)** | Página Server Component isolada para cadastro de eventos com formulário de 17 campos, cálculo de datas padrão (`defaultEventPeriod`), tratamento de sala online (`onlineRoomFieldVisibility`) e breadcrumb com volta nativa | `src/app/t/[tenantSlug]/(app)/administracao/eventos/novo/page.tsx` |
| **Cockpit limpo de acervo (`/eventos`)** | Remoção de toda a `<section>` do formulário, eliminação de código e dependências não utilizadas no render da listagem, adição do botão primário `Novo evento` no `PageHeader` e atualização da mensagem de estado vazio | `src/app/t/[tenantSlug]/(app)/administracao/eventos/page.tsx` |
| **Harmonização da tela de edição (`/eventos/[eventId]/dados`)** | Padronização com a mesma estrutura de card (`rounded-xl border border-border bg-card p-6 shadow-sm`), cabeçalho de seção (`<h2>Dados do evento</h2>`), largura (`max-w-4xl`), ícone de calendário no `PageHeader` e rótulos unificados (`Identificador (URL)` e vagas/cores) | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/dados/page.tsx` |
| **Ajuste de Catracas e Domínio** | Migração do oráculo de `administracao/eventos/page.tsx` para `administracao/eventos/novo/page.tsx` na catraca de rótulos de modalidade e atualização da âncora de páginas no `f78-topo-unico` (98 → 99 páginas, 83 → 84 migradas) | `tests/unit/f69-rotulos-de-modalidade.test.ts`, `src/domain/events/event-modality-rules.ts`, `tests/unit/f78-topo-unico.test.ts` |
| **Cobertura de Testes Unitários e E2E** | Criação de 6 testes unitários para a separação (`f90-novo-evento-separado.test.ts`), adaptação da jornada completa da plataforma (`platform-journey.spec.ts`) e criação de spec E2E dedicado (`f90-novo-evento-separado.spec.ts`) | `tests/unit/f90-novo-evento-separado.test.ts`, `tests/e2e/platform-journey.spec.ts`, `tests/e2e/f90-novo-evento-separado.spec.ts` |

---

## 2. O problema mais difícil da fase e por que ele define o desenho

O problema central foi a **escolha da fronteira de UX entre Modal vs. Página Dedicada**:

Em aplicações administrativas, a primeira tentação comum é abrir um modal (dialog) ao clicar em "Novo evento". No entanto, o formulário de cadastro de evento na Koveno envolve **17 campos complexos**: identificador (slug com regex restrito), título, resumo, local, endereço de sala online (visível condicionalmente), cidade, UF, data/hora de início e término (`datetime-local`), fuso horário, lotação, cor temática da marca, janelas de inscrição, seletor de modalidade, seletor de status, seletor de categoria temática e flags de chamada de trabalhos e vínculo institucional.

Num modal:
- O risco de perda acidental de dados é altíssimo (um clique fora do modal no backdrop ou um pressionamento de `ESC` fecha a caixa e descarta 15 campos preenchidos).
- No mobile, cria-se o anti-pattern de *nested scroll* (scroll do modal competindo com scroll da janela) e o teclado virtual encobre campos de data e selects.
- Do ponto de vista de arquitetura de Server Components no Next.js App Router, um modal exigiria transformar a página em Client Component com estado local (`isOpen`), ferindo a diretriz de manter o topo e as páginas administrativas puras e sem overhead de hidratação.

A criação em **Página Dedicada (`/administracao/eventos/novo`)** define o desenho: mantém 100% da arquitetura em Server Components puros, preserva histórico de navegação, oferece espaço confortável em desktop e mobile e utiliza o slot `actions` do `PageHeader` para uma navegação semântica e sem atrito.

---

## 3. Decisões técnicas explicadas

1. **Botão `Novo evento` no slot `actions` do `PageHeader`**:
   O `PageHeader` padronizado na FASE 78 já possui o slot `actions?: ReactNode`. Em vez de inventar uma barra de ferramentas secundária ou botões flutuantes, o link para `/administracao/eventos/novo` foi colocado diretamente no cabeçalho unificado da página.
2. **Volta nativa pelo Breadcrumbs**:
   A nova rota `/administracao/eventos/novo` declara a trilha `[Painel, Administração, Eventos, Novo evento]`. O `PageHeader` deriva automaticamente o botão `← Voltar para Eventos` a partir do penúltimo item da trilha, dispensando botões adicionais de cancelamento e respeitando a acessibilidade do produto.
3. **Preservação do estado vazio e porta do exemplo (F77)**:
   A lista vazia mantém o link `data-testid="events-empty-demo-link"` para a rota `/exemplo`, garantindo que o organizador recém-chegado continue tendo acesso ao evento fictício para demonstração sem criar nada no banco.

---

## 4. ADR-397 — Separação da Rota de Cadastro de Evento (`/eventos/novo`)

### Contexto
Até a FASE 89, a rota `/t/[tenantSlug]/administracao/eventos` renderizava simultaneamente a lista de eventos da instituição e o formulário de cadastro de novo evento. Conforme o número de eventos aumentava, a página ficava longa e desorganizada, misturando a intenção de consultar/gerenciar o acervo existente com a intenção de preencher um formulário extenso.

### Decisão
1. Isolar a criação de eventos na rota `/t/[tenantSlug]/administracao/eventos/novo`, implementada como Server Component protegido por `requirePagePermission({ tenantSlug, permission: PERMISSIONS.EVENT_UPDATE })`.
2. Limpar a página de listagem `/t/[tenantSlug]/administracao/eventos`, posicionando o botão `Novo evento` no slot `actions` do `PageHeader`.
3. Atualizar a catraca de rótulos de modalidade (`tests/unit/f69-rotulos-de-modalidade.test.ts`) e a âncora de páginas do topo único (`tests/unit/f78-topo-unico.test.ts`).
4. Atualizar a jornada E2E da plataforma (`tests/e2e/platform-journey.spec.ts`) e cobrir a navegação e criação no novo spec `tests/e2e/f90-novo-evento-separado.spec.ts`.

### Justificativa
- Elimina sobrecarga cognitiva na gestão do acervo.
- Previne perda de dados comum em modais.
- Mantém o padrão de Server Components do Next.js 16 sem ilhas desnecessárias de cliente.

### Consequências
- A rota `/administracao/eventos` fica mais leve e rápida de renderizar.
- O formulário de criação ganha foco total e URL própria.
- O total de páginas do produto passa de 98 para 99 (83 para 84 migradas no `PageHeader`).

---

## 5. Lições aprendidas

Defeitos reais capturados pelas catracas durante a execução da fase:

| # | Sintoma observado na bateria | Causa raiz | Correção aplicada |
|---|---|---|---|
| 1 | `tests/unit/f69-rotulos-de-modalidade.test.ts` falhou em `expect(fonte).toContain('EVENT_MODALITY_OPTIONS')` | O teste inspecionava `src/app/t/[tenantSlug]/(app)/administracao/eventos/page.tsx` para garantir que o formulário lia `EVENT_MODALITY_OPTIONS` do domínio. Como o formulário saiu daquela página, o teste falhou | Atualizada a lista de arquivos verificados pelo teste para apontar para `src/app/t/[tenantSlug]/(app)/administracao/eventos/novo/page.tsx` |
| 2 | `tests/unit/f78-topo-unico.test.ts` falhou com `expected 99 to be 98` em `PAGINAS.length` e `expected 84 to be 83` em `MIGRADAS.length` | A catraca da F78 ancora a contagem total de páginas e páginas migradas para garantir que nenhuma tela nova nasça sem `PageHeader` | Atualizada a contagem na âncora do teste documentando que a nova rota `/eventos/novo` já nasceu migrada com o `PageHeader` e `eyebrow="OPERAÇÃO"` |
| 3 | `tests/e2e/platform-journey.spec.ts` falhou ao procurar `create-event` diretamente em `/administracao/eventos` | O teste E2E histórico preenchia o formulário diretamente na página de listagem | O teste passou a clicar em `btn-novo-evento`, preencher o formulário na rota `/novo`, submeter e retornar à listagem pelo link `Voltar para Eventos` |

---

## 6. Evidência de verificação

Saídas reais medidas na bateria completa da seção 4 do `AGENTS.md`:

- **`npm run lint`**: `0` erros, `0` warnings.
- **`npm run typecheck`**: `0` erros (`tsc --noEmit`).
- **`npm test`**: **268 arquivos passando (268)** · **4.738 testes passando (4.738)** (`317.98s`).
- **`npm run build`**: compilado com sucesso (`✓ Compiled successfully in 10.1s`, `Finished TypeScript in 9.9s`, rota `/t/[tenantSlug]/administracao/eventos/novo` listada).
- **`npm run db:verify`**: `Contrato íntegro.` (5/5 verificações).
- **`npm run db:verify:isolation`**: `9/9 verificações passaram. Isolamento entre tenants garantido pelo banco.`
- **`npm run db:partitions`**: `todas as partições do intervalo já existiam` (`total: 172031 linha(s)`).
- **Regressão visual (`tests/e2e/f62-regressao-visual.spec.ts`)**: **23/23 passando em 0 px de diferença** (`34.8s`).
- **E2E da FASE 90 + jornada (`tests/e2e/f90-novo-evento-separado.spec.ts` e `platform-journey.spec.ts`)**: **3 passed (`35.8s`)**.
- **`npm run test:e2e`**: **510 passando + 1 skip** (`511` casos).
- **Tamanho do `AGENTS.md`**: monitorado e mantido abaixo do teto de `64.800` bytes.

---

## 7. Comandos operacionais

```bash
# Teste unitário da FASE 90:
npx vitest run tests/unit/f90-novo-evento-separado.test.ts

# Catraca de topo único:
npx vitest run tests/unit/f78-topo-unico.test.ts

# Testes E2E da FASE 90:
npx playwright test tests/e2e/f90-novo-evento-separado.spec.ts tests/e2e/platform-journey.spec.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

- **Dívidas quitadas nesta fase:** Nenhuma dívida numerada quitada (refatoração de arquitetura de telas e UX). O total em `docs/dividas-tecnicas.md` permanece em **44 itens abertos** (A=4, B=5, C=1, D=3, E=25, F=5, H=0, I=1).
- **Nenhuma dívida nova foi criada.**

---

## 9. Checklist de aceite

- [x] Rota `/t/[tenantSlug]/administracao/eventos/novo` criada como Server Component protegido com `PageHeader` semântico.
- [x] Formulário de 17 campos isolado em `/novo` com validações, datas padrão e tratamento de modalidade.
- [x] Página `/t/[tenantSlug]/administracao/eventos` limpa, exibindo apenas o acervo de eventos e o botão primário `Novo evento`.
- [x] Tela de edição `/t/[tenantSlug]/administracao/eventos/[eventId]/dados` harmonizada em card padronizado (`rounded-xl border border-border bg-card p-6 shadow-sm`) idêntico ao cadastro.
- [x] Catracas `f69-rotulos-de-modalidade` e `f78-topo-unico` atualizadas e verdes.
- [x] Testes unitários (`f90-novo-evento-separado.test.ts`) e E2E (`f90-novo-evento-separado.spec.ts` e `platform-journey.spec.ts`) passando.
- [x] Bateria de testes e builds 100% verde.

