# FASE 91 — Separação do Cadastro de Atividade (`/programacao/nova`) e Cockpit Limpo da Programação (`/programacao`)

> **Estado:** Concluída e verificada · **Data:** 06 de novembro de 2026  
> **ADR:** ADR-398 (numeração sequencial global)  
> **Testes:** 4.744 testes Vitest (269 arquivos) + 511 testes Playwright E2E (+ 1 skip)  
> **Dívidas quitadas:** Nenhuma dívida numerada quitada (melhoria arquitetural e de UX aprovada pelo usuário)  
> **Dívidas abertas:** 44 itens mantidos (A=4, B=5, C=1, D=3, E=25, F=5, H=0, I=1)

---

## 1. Sumário executivo

A **FASE 91** estendeu o padrão arquitetural e de experiência do usuário estabelecido na FASE 90 para a gestão da grade de programação do evento (`/t/<slug>/administracao/eventos/[eventId]/programacao`): até a FASE 90, a página exibia toda a lista de atividades cadastradas, cada uma com seus formulários sanfonados de edição in-place, e, no rodapé absoluto da listagem, o formulário de cadastro de nova atividade com 15+ campos (identificador, título, tipo, situação, modalidade, sala, sala online, início, término, carga horária, vagas, flags de inscrição e credenciamento, além do bloco dinâmico de confirmação de vaga por item).

Conforme a programação de um evento acadêmico ou conferência cresce (frequentemente contendo de 20 a 80+ atividades entre palestras, minicursos, mesas-redondas e oficinas), a presença do formulário no rodapé forçava o organizador a percorrer toda a lista para criar uma nova atividade, misturando a visão analítica da grade com a entrada de dados.

A fase separou as duas responsabilidades e padronizou o contêiner visual:
1. **O cockpit da programação (`/programacao`) ficou limpo e focado**: exibe a grade de atividades com filtros e ações de edição/exclusão, adiciona o botão primário `Nova atividade` (`data-testid="btn-nova-atividade"`) no slot `actions` do `PageHeader` e, no estado vazio, apresenta um convite direto com link para a rota dedicada de cadastro.
2. **O cadastro ganhou rota própria (`/programacao/nova`)**: Server Component puro com `PageHeader` semântico (`eyebrow="OPERAÇÃO"` da fonte única e breadcrumb com volta automática `← Voltar para Programação`), com o formulário encapsulado dentro do card padrão da plataforma (`rounded-xl border border-border bg-card p-6 shadow-sm`) encabeçado por `<h2>Dados da atividade</h2>`.

### Tabela de entregas da fase

| Entrega | O que mudou | Arquivos tocados |
|---|---|---|
| **Rota dedicada de cadastro (`/programacao/nova`)** | Server Component puro com `PageHeader` padronizado, breadcrumbs para programação, checagem de permissão `EVENT_UPDATE`, cálculo de término sugerido (+1h), opções de sala com rótulo de capacidade, bloco condicional de sala online e formulário `<AdminForm action={saveActivityAction} testId="create-activity">` dentro de card | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/programacao/nova/page.tsx` |
| **Cockpit limpo da programação (`/programacao`)** | Remoção do formulário `<AdminForm testId="create-activity">` do rodapé, adição do botão `Nova atividade` no slot `actions` do `PageHeader` (`data-testid="btn-nova-atividade"`), padronização da listagem (`activity-list`) e do estado vazio (`activities-empty`) dentro de card branco com elevação e bordas suaves (`rounded-xl border border-border bg-card shadow-sm`) e link direto para `/programacao/nova` | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/programacao/page.tsx` |
| **Atualização de Catracas** | Inclusão da nova página na catraca de rótulos de modalidade (`f69-rotulos-de-modalidade.test.ts`), atualização da âncora de páginas no `f78-topo-unico.test.ts` (99 → 100 páginas totais, 84 → 85 migradas), e atualização da catraca de governança `f79-fases-no-arquivo-certo.test.ts` com deslocamento seguro das fases 63 a 65 para `docs/fases-historico.md` | `tests/unit/f69-rotulos-de-modalidade.test.ts`, `tests/unit/f78-topo-unico.test.ts`, `tests/unit/f79-fases-no-arquivo-certo.test.ts`, `docs/fases-historico.md`, `AGENTS.md` |
| **Bateria de Testes Unitários e E2E** | Criação de 6 testes unitários dedicados em `f91-nova-atividade-separada.test.ts`, adaptação de 5 suítes E2E legadas que realizavam criação de atividades, e criação de spec E2E dedicado `f91-nova-atividade-separada.spec.ts` | `tests/unit/f91-nova-atividade-separada.test.ts`, `tests/e2e/f91-nova-atividade-separada.spec.ts`, `tests/e2e/platform-journey.spec.ts`, `tests/e2e/badge-print-and-items.spec.ts`, `tests/e2e/registration-confirmation.spec.ts`, `tests/e2e/room-lifecycle.spec.ts`, `tests/e2e/speaker-portal.spec.ts` |

---

## 2. O problema mais difícil da fase e por que ele define o desenho

O desafio de design mais crítico residiu na **coexistência entre edição in-place na listagem e criação em rota dedicada**:

Na programação do evento, cada atividade cadastrada já possui seu próprio painel colapsável `<details>` com o formulário de edição completo (horário, sala, vagas, confirmação de vaga, carga horária e flags). Se a criação continuasse no rodapé da mesma página, o DOM acumulava dezenas de formulários idênticos com centenas de inputs concorrentes, aumentando o tempo de renderização e hidratação e gerando frequentes conflitos de seletores e foco.

Por outro lado, migrar imediatamente a *edição* de cada atividade existente para `/programacao/[activityId]` quebraria a ergonomia de conferência rápida da grade que os organizadores utilizam no dia a dia do evento (abrir um item, ajustar a sala e salvar mantendo a visão do conjunto).

A solução adotada preservou o melhor dos dois mundos:
- **Criação isolada**: A intenção de adicionar uma nova atividade é um ato de expansão da grade, merecendo foco total em rota dedicada (`/programacao/nova`), livre de distrações e do peso da lista existente.
- **Edição mantida no cockpit**: A listagem `/programacao` mantém suas sanfonas `<details>` por atividade para edições rápidas in-place, preservando os testids duráveis (`activity-row-*`, `edit-activity-*`, `activity-form-*`) e eliminando apenas a sanfona solitária e deslocada de cadastro.
- **Card padronizado**: O formulário na rota dedicada foi encapsulado no card padrão da plataforma (`rounded-xl border border-border bg-card p-6 shadow-sm`) encabeçado por `<h2>Dados da atividade</h2>`, alinhando-se visualmente ao formulário de eventos (`/eventos/novo` e `/eventos/[eventId]/dados`).

---

## 3. Decisões técnicas explicadas

1. **Botão `Nova atividade` no slot `actions` do `PageHeader`**:
   Seguindo o design system do `PageHeader` (consolidado na F78), o botão de criação primário é injetado via propriedade `actions`. Ele utiliza estilos do botão primário do tema (`bg-primary text-primary-foreground`) e possui atributo `data-testid="btn-nova-atividade"`.
2. **Volta automática via Breadcrumbs**:
   A rota `/programacao/nova` declara a trilha hierárquica `[Painel, Administração, Eventos, <Título do Evento>, Programação, Nova atividade]`. O componente `PageHeader` deriva o link `← Voltar para Programação` a partir do penúltimo elemento, garantindo acessibilidade nativa por teclado e navegação previsível.
3. **Encapsulamento em Card Semântico**:
   Em concordância com o padrão visual estabelecido pelo usuário, a tela `/programacao/nova` envelopa o `<AdminForm>` em um elemento `<section className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm" aria-labelledby="nova-atividade">` encabeçado por `<h2 id="nova-atividade" className="text-base font-semibold tracking-tight text-foreground">Dados da atividade</h2>`.
4. **Governança de Memória do `AGENTS.md` (Movimento F63–F65)**:
   Ao registrar a FASE 91, o arquivo `AGENTS.md` atingiu 64.855 bytes, encostando no teto seguro de ~64.800 bytes (próximo do limite de 65.244 bytes onde o harness corta em silêncio). Conforme o protocolo da §2, as três fases mais antigas na tabela corrente (**F63, F64 e F65**) foram transferidas como estavam para `docs/fases-historico.md`, mantendo `AGENTS.md` saudável em 64.625 bytes com a catraca de governança `tests/unit/f79-fases-no-arquivo-certo.test.ts` totalmente verde.

---

## 4. ADR-398 — Separação da Rota de Cadastro de Atividade (`/programacao/nova`)

### Contexto
Na arquitetura legada da plataforma, a tela `/administracao/eventos/[eventId]/programacao` agrupava a visualização da grade com o formulário de cadastro de atividade no rodapé. Essa disposição causava fadiga de scroll e quebrava o padrão estabelecido na FASE 90 de separar acervo e criação em rotas dedicadas.

### Decisão
1. Criar a rota `/t/[tenantSlug]/administracao/eventos/[eventId]/programacao/nova` como Server Component dedicado, protegido por `requirePagePermission({ tenantSlug, permission: PERMISSIONS.EVENT_UPDATE })`.
2. Envelopar o formulário de criação no card padrão da plataforma (`rounded-xl border border-border bg-card p-6 shadow-sm`) com cabeçalho semântico `<h2>Dados da atividade</h2>`.
3. Limpar a página `/administracao/eventos/[eventId]/programacao`, removendo o formulário do rodapé e adicionando o botão de ação primária `Nova atividade` (`data-testid="btn-nova-atividade"`) no `PageHeader`.
4. Adaptar as 5 suítes E2E legadas que realizavam criação de atividades para navegar pela nova rota e criar o teste E2E dedicado `tests/e2e/f91-nova-atividade-separada.spec.ts`.

### Justificativa
- Reduz a sobrecarga cognitiva do organizador ao consultar a programação do evento.
- Evita a multiplicação de formulários complexos simultâneos no mesmo DOM.
- Mantém o padrão visual uniforme e consistente em todas as telas administrativas.

### Consequências
- A contagem de páginas do produto passa de 99 para 100 (84 para 85 migradas no `PageHeader`).
- O cockpit de programação torna-se mais limpo e rápido de renderizar.
- As suítes de teste de integração e E2E mantêm-se 100% íntegras.

---

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| Suítes E2E falhavam ao procurar `create-activity` na URL da listagem | O formulário de criação de atividade foi removido da página `/programacao` e migrado para `/programacao/nova` | Atualização das suítes (`platform-journey`, `badge-print-and-items`, `registration-confirmation`, `room-lifecycle`, `speaker-portal`) para clicar no botão `btn-nova-atividade` antes de preencher o formulário |
| `f79-fases-no-arquivo-certo.test.ts` falhava por ausência da linha 91 | A catraca exige que toda fase declarada em `FASES_CORRENTES` esteja presente na tabela da §9 do `AGENTS.md` | Inclusão da linha 91 no `AGENTS.md` e extensão da lista de fases de forma sincronizada |
| `AGENTS.md` ultrapassou 64.800 bytes (64.855 bytes) ao adicionar a linha 91 | Acúmulo de fases na tabela corrente da §9 aproximou o arquivo do corte silencioso do harness | Deslocamento das fases 63, 64 e 65 para `docs/fases-historico.md` conforme protocolo da §2, reduzindo o arquivo para 64.625 bytes |
| `f78-topo-unico.test.ts` acusava divergência na contagem de páginas (100 vs 99) | A criação da rota `/programacao/nova/page.tsx` adicionou uma página Server Component com `PageHeader` | Atualização da âncora do teste para 100 páginas totais e 85 migradas |

---

## 6. Evidência de verificação

### 1. ESLint e Typecheck
```bash
npm run lint
# Resultado: 0 erros, 0 warnings (920 arquivos lintados)

npm run typecheck
# Resultado: 0 erros
```

### 2. Testes Unitários e de Integração (Vitest)
```bash
npm test
# Resultado: 4.744 testes passando (269 arquivos)
```

### 3. Build do Next.js
```bash
npm run build
# Resultado: Compiled successfully
# Rota listada: /t/[tenantSlug]/administracao/eventos/[eventId]/programacao/nova
```

### 4. Verificação de Banco e Isolamento
```bash
npm run db:verify
# Resultado: Contrato íntegro. Nenhuma tabela de plataforma alcançável pela role de runtime.

npm run db:verify:isolation
# Resultado: 9/9 verificações passaram.
```

### 5. Testes E2E (Playwright)
```bash
npm run test:e2e
# Resultado: 511 testes passando + 1 skip (512 casos totais)
```

---

## 7. Comandos operacionais

```bash
# Executar a suíte de testes unitários da separação
npm test tests/unit/f91-nova-atividade-separada.test.ts

# Executar a suíte E2E da nova rota
npx playwright test tests/e2e/f91-nova-atividade-separada.spec.ts

# Reconstruir o container web e validar a aplicação
docker compose --profile app up -d --build web
```

---

## 8. Dívidas técnicas e pontos de atenção

- **Contagem de dívidas mantida em 44 itens abertos** (A=4, B=5, C=1, D=3, E=25, F=5, H=0, I=1). A FASE 91 focou em melhoria de arquitetura, modularidade e consistência de experiência do usuário aprovada explicitamente pelo usuário, sem abrir nem quitar dívidas numéricas.
- **Ponto de atenção na edição de atividades:** Os formulários de edição das atividades existentes permanecem em sanfonas `<details>` in-place na listagem `/programacao`. Caso no futuro o volume de campos de edição aumente ou seja desejável unificar a edição em página própria, pode-se avaliar a rota `/programacao/[activityId]`.

---

## 9. Checklist de aceite

- [x] O formulário de criação de atividade foi retirado do rodapé da página `/administracao/eventos/[eventId]/programacao`.
- [x] A página `/administracao/eventos/[eventId]/programacao` possui o botão `Nova atividade` (`data-testid="btn-nova-atividade"`) no slot `actions` do `PageHeader`.
- [x] A rota dedicada `/administracao/eventos/[eventId]/programacao/nova` foi criada como Server Component protegido por `PERMISSIONS.EVENT_UPDATE`.
- [x] O formulário de criação está envelopado no card padrão da plataforma (`rounded-xl border border-border bg-card p-6 shadow-sm`) encabeçado por `<h2>Dados da atividade</h2>`.
- [x] A navegação de volta via breadcrumb (`← Voltar para Programação`) deriva automaticamente da trilha e preserva acessibilidade.
- [x] O estado vazio de programação (`data-testid="activities-empty"`) aponta com link direto para `/programacao/nova`.
- [x] As suítes E2E legadas foram adaptadas e o novo spec E2E `tests/e2e/f91-nova-atividade-separada.spec.ts` cobre o fluxo completo.
- [x] Todas as catracas do sistema (`f69`, `f78`, `f79`) e a bateria de verificação completa foram aprovadas.
- [x] Documentação em `docs/fase-91-separacao-cadastro-de-atividade.md`, `AGENTS.md` e `README.md` concluída com byte count seguro (64.625 bytes).

