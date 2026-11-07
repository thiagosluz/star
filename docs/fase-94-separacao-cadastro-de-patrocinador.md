# FASE 94 — Separação do cadastro de patrocinador (/patrocinadores/novo) e cockpit limpo de patrocinadores (/patrocinadores)

> **Status:** Concluída e Verificada  
> **Data:** Novembro de 2026  
> **Escopo:** Interface (RSC), App Router, UX, Design Tokens, Formulários Complexos, Retrocompatibilidade e Bateria de Testes  
> **ADRs adicionadas:** ADR-401 (numeração global sequencial)

---

## 1. Sumário executivo

A **FASE 94** modernizou a experiência de gestão de patrocínios do evento ([`src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/page.tsx)), separando o formulário denso de cadastro de patrocinador e a rotina de cópia de edições anteriores em uma página dedicada ([`src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/novo/page.tsx`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/novo/page.tsx)), e transformando o endereço `/patrocinadores` em um **cockpit executivo limpo e rápido**.

Antes desta fase, a tela acumulava 5 fluxos distintos: gestão de cotas (tiers), lista de patrocinadores com upload de logo e edição, painel de experiência do estande (QRs, leads, equipe, exports) e, enterrados no rodapé após centenas de pixels de rolagem, o formulário de "Novo patrocinador" (com 12+ campos) e o formulário de "Copiar de outro evento".

Com a refatoração:
1. O cadastro foi isolado em `/patrocinadores/novo`, estruturado em cards brancos elevados do design system (`bg-card rounded-xl border border-border shadow-sm p-6`), com `PageHeader` semântico e breadcrumbs de retorno;
2. A tela `/patrocinadores` recebeu botão primário destacado de ação no cabeçalho (`data-testid="btn-novo-patrocinador"`), itens da listagem em cards brancos elevados individuais e um *empty state* contextual com CTA para cadastro;
3. A rota `/patrocinadores` deixou de rodar consultas desnecessárias a outros eventos (`listSponsorCandidates`), acelerando o carregamento do cockpit;
4. 100% dos seletores contratuais e fluxos E2E existentes foram preservados.

### Tabela de entregas e números da fase

| Entrega | Arquivo | Responsabilidade |
|---|---|---|
| **Página dedicada de criação** | `src/.../eventos/[eventId]/patrocinadores/novo/page.tsx` | Server Component com `PageHeader`, breadcrumbs, container card branco para dados do patrocinador e container para cópia de outro evento |
| **Cockpit limpo de patrocinadores** | `src/.../eventos/[eventId]/patrocinadores/page.tsx` | Botão primário `btn-novo-patrocinador` no cabeçalho, remoção dos formulários do rodapé, cards brancos individuais para cotas e patrocinadores e empty state estilizado |
| **Revalidação em Server Actions** | `src/app/actions/sponsor-actions.ts` | Adicionada revalidação da rota `/patrocinadores/novo` em `revalidateSponsors` |
| **Testes unitários da fase** | `tests/unit/f94-separacao-cadastro-de-patrocinador.test.ts` | 7 testes cobrindo botão no cabeçalho, ausência do form inline no cockpit, cards brancos elevados, empty state, breadcrumbs, campos de criação e cópia |
| **Teste E2E da fase** | `tests/e2e/f94-novo-patrocinador-separado.spec.ts` | Cenário Playwright no navegador verificando cockpit limpo, navegação para `/patrocinadores/novo`, preenchimento, submissão e retorno à listagem |
| **Ajustes de testes E2E legados** | `tests/e2e/landing-page.spec.ts`, `tests/e2e/content-and-media.spec.ts`, `tests/e2e/media-and-window.spec.ts` | Atualização dos fluxos de criação e cópia para utilizarem a nova rota `/patrocinadores/novo` via botão ou navegação direta |
| **Catraca de catálogo de IDs** | `tests/unit/f76-catalogo-de-ids.test.ts` | Atualização da contagem para 28 páginas com `[id]` e 29 parâmetros validados |
| **Catraca de topo único** | `tests/unit/f78-topo-unico.test.ts` | Atualização da contagem para 102 páginas no total e 87 migradas para `PageHeader` |
| **Catraca de fases** | `tests/unit/f79-fases-no-arquivo-certo.test.ts` | Atualização do histórico (70 e 71 movidas) e tabela corrente iniciando em 72 |
| **Histórico de fases** | `docs/fases-historico.md` | Fases 70 e 71 arquivadas mantendo `AGENTS.md` sob o teto de 64.800 bytes |
| **Documentação da fase** | `docs/fase-94-separacao-cadastro-de-patrocinador.md` | Este documento com sumário, decisões, ADR-401 e evidências |

### Números da fase

* **Arquivos modificados/criados:** 11 arquivos
* **Testes Vitest:** 4.761 passando (+7 novos unitários) em 272 arquivos
* **Testes Playwright E2E:** 514 passando (+1 novo) + 1 skip
* **ADR:** ADR-401
* **Dívidas técnicas:** 44 abertas (inalterado)

---

## 2. O problema mais difícil e por que ele define o desenho

O problema central da FASE 94 foi o **desacoplamento de múltiplos fluxos de criação e cópia** sem fragmentar a sincronia de cotas (tiers) e o modelo contratual de patrocínio.

Cadastrar um patrocinador envolve duas operações muito distintas:
1. **Cadastro Novo:** Preenchimento de 12+ campos de negócio (nome, cota selecionável de `board.tiers`, URL de site, ordem de exibição, nome do contato, e-mail do contato, telefone, CPF/CNPJ com mascaramento e regras de preservação, valor comercial do contrato, vigência contratual com início e fim, descrição institucional e visibilidade pública);
2. **Cópia de Outro Evento:** Seleção a partir de um pool de patrocinadores de edições passadas (`listSponsorCandidates`), importando logotipo e contatos, mas entrando obrigatoriamente como cadastro inativo e sem valor de contrato fixado (já que contratos são renegociados a cada edição).

Na implementação anterior, ambos os formulários ficavam espremidos no final de uma página verticalmente imensa. Quem acessava a tela para acompanhar a captação de patrocinadores ou gerenciar os leads do estande tinha que conviver com dois formulários estáticos abertos no rodapé.

A decisão arquitetural foi isolar ambos os formulários em [`/patrocinadores/novo`](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/novo/page.tsx), apresentados em cards brancos separados e focados, aliviando a carga do cockpit principal.

---

## 3. Decisões técnicas explicadas

### 3.1 Página Dedicada `/patrocinadores/novo` em Server Component Puro
A rota `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/novo/page.tsx` foi criada como Server Component com `dynamic = 'force-dynamic'`, importando `requireUuidParam`, `requirePagePermission(SPONSOR_MANAGE)`, `getAdminEvent`, `listSponsorBoard` e `listSponsorCandidates`.
O formulário de cadastro principal fica em `data-testid="create-sponsor-section"` e o de cópia em `data-testid="copy-sponsor-section"`.

### 3.2 Cockpit com Botão Primário no Header
Em `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/page.tsx`, o cabeçalho recebeu:
```tsx
actions={
  <Link
    href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/patrocinadores/novo`)}
    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    data-testid="btn-novo-patrocinador"
  >
    <Plus className="size-4" aria-hidden />
    Novo patrocinador
  </Link>
}
```

### 3.3 Cards Brancos Elevados e Empty State Contextual
Tanto as seções de Cotas e Patrocinadores quanto cada item de patrocinador na lista foram elevados com:
```tsx
className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm"
```
Quando nenhum patrocinador está cadastrado, o `empty-sponsors` exibe um contêiner tracejado elegante com botão direto para `/patrocinadores/novo`.

---

## 4. Registro de Decisões Arquiteturais (ADRs)

### ADR-401 — Separação da criação e cópia de patrocinadores em rota dedicada `/patrocinadores/novo`

* **Contexto:** A tela `/patrocinadores` reunia configuração de cotas, listagem de marcas apoiadoras, upload de logos, controle de estandes e leads, além de dois formulários no rodapé (novo patrocinador e cópia de outro evento). Isso causava confusão visual e rolagem excessiva.
* **Decisão:** Mover os formulários de cadastro de patrocinador e de cópia de edição anterior para a rota `/patrocinadores/novo`, colocando um botão primário de ação no cabeçalho de `/patrocinadores` e padronizando os cartões com fundo branco elevado (`bg-card rounded-xl border border-border shadow-sm`).
* **Justificativa:** Reduz a sobrecarga cognitiva do organizador, melhora a velocidade de renderização da página principal eliminando consultas periféricas de candidatos a cópia, e mantém a consistência visual adotada nas Fases 90, 91, 92 e 93.
* **Consequências:** Navegação clara entre acompanhamento e cadastro; preservação de todos os seletores contratuais; catracas de topo único e IDs atualizadas.

---

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` no teste unitário | Mock de cota retornou escala `'HERO'` que não existe em `SPONSOR_LOGO_SCALE_LABELS` | Ajustado para escala válida `'FEATURE'` |
| `Error: invariant expected app router to be mounted` no teste unitário | `AssetUploader` renderizado no teste chamava `useRouter()` sem contexto do App Router | Mock de `AssetUploader` e `next/navigation` adicionado na suíte unitária |
| Falha no teste E2E existente de landing page | Teste buscava `create-sponsor` no cockpit que foi limpo | Atualizado o teste para navegar via `btn-novo-patrocinador` para `/patrocinadores/novo` |

---

## 6. Evidência de verificação

Comandos executados e aprovados:
* `npm run lint`: 0 erros, 0 avisos.
* `npm run typecheck`: 0 erros.
* `npm test`: 272 arquivos de teste passando, 4.761 testes passando.
* `npm run build`: Compiled successfully.
* `npm run db:verify`: Contrato íntegro (0 tabelas expostas).
* `npm run db:verify:isolation`: 9/9 verificações passaram.
* `npm run db:partitions`: Partições íntegras.
* `npm run test:e2e`: 514 passando + 1 skip.

---

## 7. Comandos operacionais

```bash
# Executar a nova suíte unitária da FASE 94
npx vitest run tests/unit/f94-separacao-cadastro-de-patrocinador.test.ts

# Executar a nova suíte E2E da FASE 94
npm run test:e2e -- tests/e2e/f94-novo-patrocinador-separado.spec.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

Nenhuma nova dívida técnica introduzida. A rota `/patrocinadores/novo` foi integrada nativamente às catracas de segurança, IDs de URL e topo único.

---

## 9. Checklist de aceite

- [x] Rota `/patrocinadores/novo` criada com Server Component puro e `PageHeader` semântico
- [x] Formulário de cadastro de patrocinador isolado em card branco elevado
- [x] Formulário de cópia de patrocinador de outro evento isolado em card branco elevado
- [x] Botão primário `btn-novo-patrocinador` adicionado ao cabeçalho de `/patrocinadores`
- [x] Formulários densos inline removidos do rodapé de `/patrocinadores`
- [x] Cards de cotas e patrocinadores padronizados com `bg-card border shadow-sm`
- [x] Estado vazio de patrocinadores com CTA para cadastro dedicado
- [x] Revalidação da nova rota em `sponsor-actions.ts`
- [x] Testes unitários dedicados em `tests/unit/f94-separacao-cadastro-de-patrocinador.test.ts`
- [x] Teste E2E dedicado em `tests/e2e/f94-novo-patrocinador-separado.spec.ts`
- [x] Suítes E2E legadas atualizadas e verdes
- [x] Catracas `f76`, `f78` e `f79` verdes
- [x] Arquivo `AGENTS.md` com tamanho controlado sob ~64.800 bytes

