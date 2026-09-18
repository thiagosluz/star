# Sistema de design do EventFlow

> **Leia antes de escrever qualquer tela nova.** Este documento é o contrato visual
> do produto: a fonte dos valores é o [`DESIGN.md`](../DESIGN.md) (na raiz do
> repositório), a implementação é `src/app/globals.css` + `src/components/ui/**`, e
> a **trava mecânica** é `tests/unit/design-system-guard.test.ts`.
>
> Referência viva: **`/superadmin/design`** — a identidade renderizada pelo próprio
> código, com todos os primitivos em todos os estados.

---

## 1. As três camadas (e por que existem três)

| Camada | Onde | O que garante |
|---|---|---|
| **Valores** | `DESIGN.md` (YAML) | A identidade em si: paleta, tipografia, espaçamento, elevação |
| **Tokens** | `src/app/globals.css` | Traduz os valores em variáveis e apelidos semânticos |
| **Primitivos** | `src/components/ui/**` | Componentes que já usam os tokens — a única forma de montar tela |
| **Trava** | `tests/unit/design-system-guard.test.ts` | Impede cor crua, tamanho arbitrário e dívida que cresce |

Um módulo novo **não escolhe cor, tamanho de fonte nem sombra**. Ele escolhe
componentes e, no máximo, tokens semânticos (`bg-card`, `text-muted-foreground`).

---

## 2. Paleta — os tokens que existem

Os valores abaixo são os do `DESIGN.md` e estão em `:root` no `globals.css`. Use o
**apelido semântico** (coluna "Token de uso"), nunca a cor crua.

### Superfícies (a escada de profundidade)

| Token de uso | Valor | Papel |
|---|---|---|
| `bg-surface` | `#f9f9ff` | Canvas da página (nível 0) |
| `bg-surface-low` | `#f1f3ff` | Agrupamento estático, cabeçalho de tabela (nível 1) |
| `bg-card` | `#ffffff` | Cartão elevado (nível 2) — **o padrão** |
| `bg-surface-high` | `#e5e8f4` | Hover, realce, fundo de chip neutro |
| `bg-surface-highest` | `#dfe2ee` | Separador forte |
| `text-foreground` / `text-on-surface` | `#181c24` | Texto principal |
| `text-muted-foreground` | `#464555` | Texto secundário, rótulo de metadado |
| `border-border` | `#c7c4d8` | Hairline estrutural |
| `border-border-strong` | `#777587` | Contorno de ênfase |

### Marca e ações

| Token de uso | Valor | Papel |
|---|---|---|
| `bg-primary` | `#4f46e5` | **Ação** (contraste branco garantido) |
| `bg-primary-hover` | `#4338ca` | Hover da ação |
| `text-brand` | `#3525cd` | Marca em texto (links, item ativo) |
| `bg-primary-soft` | `#e2dfff` | Fundo suave de marca (item ativo, avatar) |
| `text-secondary-strong` | `#00668a` | Telemetria, sessão ao vivo |
| `text-tertiary-strong` | `#005338` | Confirmação institucional |

### Estados

| Token | Fill | Texto acessível | Fundo suave | Uso |
|---|---|---|---|---|
| sucesso | `bg-success` `#10b981` | `text-success-strong` `#059669` | `bg-success-soft` | Confirmado, verificado, aprovado |
| atenção | `bg-warning` `#f59e0b` | `text-warning-strong` `#d97706` | `bg-warning-soft` | Espera, em análise, rascunho |
| perigo | `bg-destructive` `#dc2626` | `text-destructive` | `bg-destructive-soft` | Recusado, bloqueado, expirado |
| informação | `bg-secondary` | `text-secondary-strong` | `bg-secondary/25` | Informação neutra |

### Raridade (gamificação) — só para conquista

`tier-common` · `tier-rare` · `tier-epic` · `tier-legendary` · `tier-mythic` (classes
de gradiente em `globals.css`) e `RarityBadge` no catálogo de primitivos.
**Status operacional nunca usa gradiente** — a fronteira entre "estado do sistema" e
"mérito do participante" é parte do produto.

---

## 3. Tipografia

| Papel | Classe | Fonte |
|---|---|---|
| Herói de página pública | `text-display` (56/64, −0.03em) | Plus Jakarta Sans |
| Número de indicador | `text-display-sm` | Plus Jakarta Sans |
| Título de página | `text-title-lg` | Plus Jakarta Sans |
| Título de seção/cartão | `text-title` | Plus Jakarta Sans |
| Corpo | `text-sm` / `text-body-lg` | Inter |
| Metadado | `label-caps` (11px, caixa alta, `#464555`) | Inter |
| Dado técnico (hora, protocolo, hash) | `code-data` (tabular) | mono |

Carregadas em `src/app/layout.tsx` via `next/font`. Antes da FASE 11A **nenhuma**
fonte era carregada: o produto usava a fonte do sistema operacional.

---

## 4. Primitivos — o catálogo

Importe **sempre** de `@/components/ui`:

```tsx
import {
  Alert, Avatar, Badge, Button, Card, CardContent, CardHeader, CardTitle,
  ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Progress,
  RarityBadge, Select, SectionHeading, StatCard, Table, TBody, TD, TH, THead,
  TR, Textarea,
} from '@/components/ui';
```

| Primitivo | Quando usar | Regra que ele carrega |
|---|---|---|
| `PageHeader` | **Toda** tela começa por ele | Título, descrição, trilha e ações no mesmo lugar sempre |
| `Breadcrumbs` | Páginas com hierarquia (detalhe dentro de lista) | Último item não é link |
| `Card` + partes | Agrupar conteúdo | Nível 2; cartão dentro de cartão usa `elevated={false}` |
| `SectionHeading` | Seção dentro de uma página | Substitui `<h2>` com classes escolhidas a esmo |
| `Button` / `buttonClasses` | Ações e links que parecem ação | Um primário por tela; destrutivo é contorno |
| `Badge` | Estado ao lado de um dado | Sempre com rótulo escrito; `withDot` para estado |
| `RarityBadge` | Carta, selo, conquista | Gradiente é exclusivo de conquista |
| `Alert` | O que a pessoa precisa saber **agora** | Ícone + título; `role="alert"` no perigo |
| `EmptyState` | Lista vazia | Explica o que apareceria e oferece a ação |
| `StatCard` | Indicador de painel | Valor colorido, cartão neutro |
| `Table` + partes | Listagem densa | Cabeçalho `label-caps`, linha 52px, `numeric` para números |
| `Field` + `fieldAria` | Formulário | Rótulo, dica e erro amarram por `name` |
| `Input`/`Textarea`/`Select`/`Checkbox` | Campos | 44px, foco do sistema |
| `Progress` | Barra de avanço | `role="progressbar"` com valores |
| `Avatar` | Pessoa | Iniciais; sem upload nesta fase |
| `Skeleton` | Carregamento | Nunca um "carregando…" textual |
| `ConfirmDialog` (`Modal`) | Ação **sem volta** | Título com a pergunta, consequência escrita, botão que **nomeia** a ação e foco inicial em "Cancelar". `window.confirm` é proibido (ver abaixo) |

**Se falta um primitivo:** acrescente-o a `src/components/ui/**` e exporte no
`index.ts`. Não escreva a classe solta na tela — é assim que o padrão morre.

### Confirmações: nunca `window.confirm`

A caixa nativa do navegador é a única tela do sistema que o design não desenha: aparece
com o título "localhost:3000 diz", botões "OK/Cancelar" sem hierarquia e ordem diferente
em cada navegador — e não diz **o que** está sendo confirmado.

```tsx
// ✔ O padrão: o botão abre o diálogo; quem envia é o `requestSubmit()` do form
<InlineActionForm
  action={deleteBlockAction}
  submitLabel="Remover"
  variant="destructive"
  testId={`delete-block-${block.id}`}
  confirm={{
    title: `Remover o bloco “${BLOCK_LABELS[block.type]}”?`,
    description: 'O bloco sai da página na hora. O conteúdo continua no histórico.',
    confirmLabel: 'Remover bloco',
  }}
>
```

Regras que o primitivo já carrega:

1. **Texto que nomeia a ação** (`Remover bloco`, `Cancelar inscrição`) no lugar do "OK";
   quem lê a caixa sabe o que vai acontecer sem reler a tela atrás.
2. **Consequência escrita** — o que sai do ar, o que é preservado, o que não tem volta.
3. **Foco inicial em "Cancelar"** em ação destrutiva: `Enter` por reflexo não apaga nada.
4. **`<dialog>` nativo como mecanismo** (top layer, fundo inerte, foco preso, `Esc`) com
   o painel desenhado pelo produto — o que muda é o DESENHO, não a garantia.
5. No E2E, o teste clica em `<testid>-open` e confirma em `<testid>-confirm-confirm`;
   **não** existe mais `page.on('dialog')` a tratar.
6. **O painel só existe no DOM enquanto está aberto.** Um `<dialog>` fechado continua no
   documento com `aria-labelledby` apontando para o título ("Remover o bloco 'Texto'?") e
   `getByLabel('Texto')` passa a casar com **dois** elementos — o campo e o diálogo
   (`strict mode violation`, porque locator por nome acessível não filtra invisível).
   Montar sempre "porque é mais simples" quebra o E2E de telas que já existiam.
7. **O efeito que chama `showModal()` depende de `open`**, nunca de lista vazia: o `Modal`
   fica montado mesmo fechado (quem o esconde é o `return null`), então um efeito de
   montagem roda no primeiro render — quando `ref.current` ainda é `null` — e o diálogo
   aparece sem o atributo `open`, invisível e sem erro nenhum no console.

---

## 5. Navegação — os três shells

| Shell | Onde | Composição |
|---|---|---|
| `AppShell` (instituição) | `/t/[slug]/(app)/**` | Barra lateral fixa, navegação **agrupada por intenção**, seletor de instituição, conta, gaveta no mobile |
| `AppShell` variante `platform` | `/superadmin/**` | Mesmo shell, acento de plataforma — governança e operação são o mesmo produto |
| `PublicHeader` + `PublicFooter` | `/t/[slug]/(public)/**` | Identidade da instituição, atalhos (Programação, Instituições), Entrar/Minha área |

Os grupos da navegação da instituição (definidos em
`src/components/shell/tenant-nav.tsx`):

1. **Geral** — Painel · Eventos
2. **Minha participação** — Minhas inscrições · Minhas submissões · Conquistas · Cartas · Certificados
3. **Comitê científico** — Pareceres e decisões · Minhas revisões
4. **Operação** — Credenciamento · Administração

Cada item declara a **mesma permissão que a página exige**; o filtro roda no
servidor com `can()`. Menu e página concordando é o que evita o link que só
redireciona e a tela inalcançável.

---

## 6. Receita: um módulo novo em 6 passos

1. **Página**: `export default async function Page()` começando por `PageHeader`
   (com `breadcrumbs` e `actions`). A rota herda o shell do layout — não monte
   cabeçalho.
2. **Permissão**: `requirePagePermission({ tenantSlug, permission })` e, se o módulo
   entra no menu, acrescente o item em `buildTenantNav` com a mesma permissão — e com o
   **mesmo predicado**: permissão pessoal (`:own`) é decidida por `holdsPermission`
   (posse), e permissão de instituição por `can(..., { scope: 'TENANT' })`, com `scopes`
   explícito quando a página aceita `EVENT` (`credenciamento`). Menu mais restritivo que a
   página esconde recurso de quem pode usá-lo; mais permissivo, oferece link que só
   redireciona — os dois já aconteceram (armadilha 44 do `AGENTS.md`).
3. **Conteúdo**: `Card` para agrupar, `SectionHeading` para separar seções,
   `Table` para lista densa, `EmptyState` para vazio.
4. **Ação**: `Button` (um primário por tela) + `Alert` para o retorno. Formulário com
   `Field` + `fieldAria`, erro vindo do servidor.
5. **Dados**: números com `numeric` na tabela ou `StatCard`; nada de cor escolhida à
   mão para "destacar" — use `tone`.
6. **Verificar**: `npx vitest run tests/unit/design-system-guard.test.ts` e abrir
   `/superadmin/design` para comparar com o padrão.

---

## 7. Proibido (a trava reprova)

| Proibido | Por quê | Faça |
|---|---|---|
| `text-gray-500`, `bg-slate-100`, `border-emerald-500/40` | Paleta crua do Tailwind: 150 ocorrências herdadas das fases 1–10 | `text-muted-foreground`, `bg-surface-low`, `border-success/40` |
| `#4F46E5`, `bg-[#fff]` em componente | Cor literal não pertence a componente | Token (exceções: `globals.css`, tema do evento, guia de estilo, `global-error.tsx`) |
| `text-[13px]`, `text-[11px]` | Quebra a escala tipográfica | `text-sm`, `label-caps`, `code-data` |
| Segundo botão preenchido na mesma tela | Disputa a ação principal | `variant="outline"` / `"ghost"` |
| Cartão dentro de cartão com sombra | Achatamento visual | `elevated={false}` |
| Gradiente fora de conquista | Borra a fronteira estado × mérito | `Badge` com `tone` |

### Dívida aberta (a catraca)

Depois da **FASE 11B**, as duas listas (`RAW_COLOR_DEBT` e `ARBITRARY_TEXT_DEBT`) estão
**vazias** — isto é, o teto de qualquer arquivo é zero e a proibição é absoluta. O
mecanismo continua no teste de propósito: se uma migração futura precisar de exceção, o
lugar dela já existe, é explícito e só pode encolher depois.

### Rótulo de campo: `id` ou envolvente

`Field` + `fieldAria` (recomendado) liga rótulo, dica e erro por `id`, e exige **ids
únicos na página**. Quando a MESMA página tem vários formulários repetindo nomes de
campo (o painel administrativo tem: sala, atividade e trilha usam `capacity`), use
rótulo **envolvente** (`<label>texto <input/></label>`), como faz
`src/components/admin/admin-form.tsx`. Ids duplicados fazem o `for` apontar para o
controle de outro formulário — e o rótulo visível deixa de ser o rótulo daquele campo.

---

## 8. Verificação

```bash
npx vitest run tests/unit/design-system-guard.test.ts   # a trava
npm run lint && npm run typecheck                       # tipos e estilo
# e, com o app rodando:
#   /superadmin/design   → a identidade renderizada
```

O teste verifica: ausência de paleta crua acima do teto, ausência de hexadecimal,
tamanho de fonte sempre da escala, presença dos tokens obrigatórios e **igualdade
dos valores** com o `DESIGN.md` — se alguém "ajustar" a marca sem atualizar o
documento, a suíte falha antes de 40 telas mudarem de cor.
