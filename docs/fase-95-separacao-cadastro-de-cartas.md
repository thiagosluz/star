# FASE 95 — Separação do cadastro de cartas colecionáveis (/cartas/nova) e cockpit limpo de cartas (/cartas)

> **Status:** Concluída e Verificada  
> **Data:** Novembro de 2026  
> **Escopo:** Interface (RSC), App Router, UX, Design Tokens, Formulários Complexos de Gamificação, Efeitos Holográficos 3D e Bateria de Testes  
> **ADRs adicionadas:** ADR-402 (numeração global sequencial)

---

## 1. Sumário executivo

A **FASE 95** modernizou a experiência de gestão do acervo de cartas colecionáveis da instituição ([`src/app/t/[tenantSlug]/(app)/administracao/cartas/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/administracao/cartas/page.tsx)), separando o formulário volumoso de 26 campos de cadastro de cartas em uma página dedicada ([`src/app/t/[tenantSlug]/(app)/administracao/cartas/nova/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/administracao/cartas/nova/page.tsx)) e transformando o endereço `/cartas` em um **cockpit executivo limpo, leve e focado na curadoria da coleção**.

Antes desta fase, a tela acumulava múltiplos fluxos conflitantes: galeria de cartas com física 3D interativa (`HoloCard`), alternância de arquivo morto (`?arquivados=1`), formulário expansível via `<details>` dentro de cada célula do grid (quebrando o alinhamento da galeria quando aberto), formulário denso de "Nova carta" enterrado no rodapé com 26 campos e ferramenta de concessão manual com consulta a 200 participantes.

Com a refatoração:
1. O cadastro de novas cartas foi isolado em `/cartas/nova`, estruturado em container card branco do design system (`bg-card rounded-xl border border-border shadow-sm p-6`), com `PageHeader` semântico e breadcrumbs de retorno;
2. Os campos do formulário foram unificados no componente compartilhado [`CardFormFields`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/gamification/card-form-fields.tsx), garantindo a regra de ouro de *"campos da carta em um lugar só"*, prevenindo drift entre criação e edição;
3. A rota `/cartas` recebeu botão primário destacado de ação no cabeçalho (`data-testid="btn-nova-carta"`), itens da listagem em cards brancos elevados individuais (`data-testid="admin-card-${card.id}"`), empty state contextual com CTA direto e card limpo para concessão manual;
4. 100% dos seletores contratuais e fluxos de teste foram preservados com retrocompatibilidade total.

### Tabela de entregas e números da fase

| Entrega | Arquivo | Responsabilidade |
|---|---|---|
| **Componente unificado de campos** | `src/components/gamification/card-form-fields.tsx` | Fonte única dos 26 campos de carta (identificação, narrativa, regras, arte 3D e visibilidade) usada na criação e na edição |
| **Página dedicada de criação** | `src/.../administracao/cartas/nova/page.tsx` | Server Component com `PageHeader`, breadcrumbs com volta, container card branco e formulário estruturado `create-card` |
| **Cockpit limpo de cartas** | `src/.../administracao/cartas/page.tsx` | Botão primário `btn-nova-carta` no cabeçalho, remoção do formulário denso do rodapé, cards brancos elevados na listagem, empty state com CTA e seção de concessão manual limpa |
| **Revalidação em Server Actions** | `src/app/actions/admin-actions.ts`, `src/app/actions/catalog-archive-actions.ts` | Revalidação da rota `/cartas/nova` junto à rota `/cartas` ao salvar, excluir ou restaurar cartas |
| **Testes unitários da fase** | `tests/unit/f95-separacao-cadastro-de-cartas.test.ts` | 6 testes cobrindo botão no cabeçalho, ausência do form inline no rodapé, cards brancos, empty state, navegação via breadcrumbs e campos estruturados |
| **Teste E2E da fase** | `tests/e2e/f95-nova-carta-separada.spec.ts` | Cenário Playwright no navegador verificando cockpit limpo, navegação para `/cartas/nova`, preenchimento, submissão e retorno à listagem |
| **Ajuste de teste E2E legado** | `tests/e2e/gamification-catalog.spec.ts` | Atualização do fluxo de criação de carta para navegar via `btn-nova-carta` e verificar o card criado na listagem |
| **Catraca de topo único** | `tests/unit/f78-topo-unico.test.ts` | Atualização da contagem para 103 páginas no total e 88 migradas para `PageHeader` |
| **Catraca de fases e histórico** | `tests/unit/f79-fases-no-arquivo-certo.test.ts`, `docs/fases-historico.md` | Fases 72 a 74 arquivadas mantendo `AGENTS.md` sob o teto de 64.800 bytes e tabela corrente iniciando em 75 |
| **Documentação da fase** | `docs/fase-95-separacao-cadastro-de-cartas.md` | Este documento com sumário, decisões, ADR-402 e evidências |

### Números da fase

* **Arquivos modificados/criados:** 10 arquivos
* **Testes Vitest:** 4.767 passando (+6 novos unitários) em 273 arquivos
* **Testes Playwright E2E:** 515 passando (+1 novo) + 1 skip
* **ADR:** ADR-402
* **Dívidas técnicas:** 44 abertas (inalterado)

---

## 2. O problema mais difícil e por que ele define o desenho

O problema central da FASE 95 foi o **gerenciamento de uma entidade com 26 parâmetros complexos sem duplicar a definição dos campos nem quebrar o layout da galeria**.

Uma Carta Colecionável integra:
1. Parâmetros contratuais estritos de banco (slug, trigger, rarity, eventId);
2. Parâmetros visuais finos (paletas cromáticas oklch/hex, partículas, animações CSS);
3. Parâmetros físicos holográficos 3D da FASE 48 (`artSheen`, `artTilt`, `artHolo`, `artBackUrl`);
4. Condições dinâmicas de gatilho (`XP_THRESHOLD`, `STREAK`, `LEVEL_UP`).

No desenho anterior, o mesmo bloco de inputs era embutido dentro de um `<details>` retrátil em cada célula do grid de cartas. Ao abrir a edição, um único card pulava de 200px para 1.200px de altura, estragando a grade de exibição. No rodapé, o formulário de criação exigia rolar toda a galeria.

A solução foi separar o fluxo de criação em uma página dedicada `/cartas/nova`, encapsular os campos em [`CardFormFields`](file:///c:/Users/thiago/Documents/Projetos/star/src/components/gamification/card-form-fields.tsx) com suporte a agrupamento estruturado por domínios e transformar o cockpit em um ambiente leve com botão de ação direta no topo.

---

## 3. Decisões técnicas explicadas

* **Por que extrair `CardFormFields` para `src/components/gamification/`?**
  Para preservar a regra arquitetural da FASE 43: *"os campos da carta em um lugar só"*. Se o formulário de edição e o de criação fossem arquivos separados com campos digitados à mão, qualquer novo campo de gamificação adicionado no futuro esqueceria uma das pontas, resultando em perda silenciosa de dados ao salvar.
* **Por que mover o cadastro para `/cartas/nova` em vez de manter inline como em `/salas`?**
  Salas possuem apenas 3 campos primitivos (nome, capacidade, online), onde o cadastro in-page agrega agilidade sem poluição. Cartas possuem 26 campos abrangendo 4 áreas técnicas e criativas distintas; manter 26 campos inline no rodapé sufoca a experiência da galeria.
* **Por que manter a seção de concessão manual no cockpit?**
  Conceder uma carta é um ato operacional direto de gestão (um administrador premiando um participante específico), não uma criação de modelo de catálogo. Ela permanece no rodapé em container branco limpo e delimitado.

---

## 4. ADRs

### ADR-402 — Separação da criação de cartas colecionáveis em `/cartas/nova` e cockpit limpo em `/cartas`

* **Contexto:** A tela `/administracao/cartas` misturava galeria 3D, formulário de 26 campos no rodapé e edição expansível no grid.
* **Decisão:** Mover a criação de cartas para a rota dedicada `/t/[tenantSlug]/(app)/administracao/cartas/nova`, com `PageHeader`, breadcrumbs semânticos e container card elevado. No cockpit `/cartas`, adicionar botão primário `btn-nova-carta` no cabeçalho, elevar cards da galeria para o padrão branco e remover o formulário inline do rodapé. Compartilhar os campos via `CardFormFields`.
* **Justificativa:** Reduz a sobrecarga cognitiva do organizador, previne quebras de layout na galeria e diminui o peso de renderização do Server Component.
* **Consequências:** Navegação mais intuitiva e desacoplada; necessidade de atualizar a contagem de páginas da catraca de topo único (103 páginas).

---

## 5. Lições aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| A catraca `f79-fases-no-arquivo-certo.test.ts` acusou estouro de tamanho no `AGENTS.md` (64.901 bytes). | A adição da linha 95 e a documentação na tabela de fases elevaram o tamanho do arquivo acima do teto seguro de 64.800 bytes. | As fases 72 a 74 foram movidas para `docs/fases-historico.md` como estavam, reduzindo o arquivo para 64.628 bytes. |

---

## 6. Evidência de verificação

```bash
npm run lint          # 0 erros, 0 warnings
npm run typecheck     # 0 erros
npm test              # 4767 testes passando (273 arquivos)
npm run build         # Compilado com sucesso (Turbopack, rota /cartas/nova registrada)
npm run db:verify     # Contrato de isolamento íntegro
npm run db:verify:isolation   # 9/9 verificações passaram
npm run db:partitions # Partições íntegras
npm run test:e2e      # 515 passando + 1 skip (0 falhas)
```

---

## 7. Comandos operacionais

```bash
# Execução dos testes unitários da fase e das catracas
npx vitest run tests/unit/f95-separacao-cadastro-de-cartas.test.ts tests/unit/f78-topo-unico.test.ts tests/unit/f79-fases-no-arquivo-certo.test.ts

# Execução do teste E2E Playwright da fase
npx playwright test tests/e2e/f95-nova-carta-separada.spec.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

* Nenhuma dívida técnica nova declarada nesta fase (total mantido em 44 abertas).
* Ponto de atenção: O seletor de participante na concessão manual continua com `take: 200`. Conforme a base de usuários cresça além desse número em uma instituição, a concessão manual poderá se beneficiar de busca com autocomplete ou paginação assíncrona.

---

## 9. Checklist de aceite

- [x] Rota `/t/[tenantSlug]/(app)/administracao/cartas/nova` criada como Server Component com `PageHeader` e breadcrumbs.
- [x] Formulário `create-card` estruturado em cards brancos elevados com os 26 campos organizados logicamente.
- [x] Componente `CardFormFields` compartilhado entre `/cartas/nova` e a edição expansível em `/cartas`.
- [x] Botão `btn-nova-carta` no cabeçalho de `/administracao/cartas` apontando para a nova rota.
- [x] Formulário de criação removido do rodapé do cockpit `/cartas`.
- [x] Galeria e empty state com cards brancos elevados no padrão do design system.
- [x] Catracas de topo único (`f78`) e fases (`f79`) atualizadas e verdes.
- [x] Tamanho do `AGENTS.md` mantido estritamente abaixo de 64.800 bytes (64.628 bytes).
- [x] Testes unitários (6 novos) e E2E (1 novo) criados e passando.

