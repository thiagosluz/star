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
| **Valores** | `DESIGN.md` (YAML) | A identidade em si: paleta (clara **e escura**), tipografia, espaçamento, elevação |
| **Tokens** | `src/app/globals.css` | Traduz os valores em variáveis e apelidos semânticos, nas duas escalas |
| **Primitivos** | `src/components/ui/**` | Componentes que já usam os tokens — a única forma de montar tela |
| **Trava** | `tests/unit/design-system-guard.test.ts` · `f61-escala-escura.test.ts` · `f61-contraste-dos-dois-modos.test.ts` | Impede cor crua, tamanho arbitrário, dívida que cresce, escala escura incompleta e contraste abaixo do AA |

Um módulo novo **não escolhe cor, tamanho de fonte nem sombra**. Ele escolhe
componentes e, no máximo, tokens semânticos (`bg-card`, `text-muted-foreground`).
E **não escolhe modo**: o tema escuro não é uma tela, é a outra metade da escala
(seção 3).

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
| `border-border` | `#83808f` | Hairline estrutural e borda de campo (`--input`) |
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
| sucesso | `bg-success` `#10b981` | `text-success-strong` `#047857` | `bg-success-soft` | Confirmado, verificado, aprovado |
| atenção | `bg-warning` `#f59e0b` | `text-warning-strong` `#92400e` | `bg-warning-soft` | Espera, em análise, rascunho |
| perigo | `bg-destructive` `#b91c1c` | `text-destructive` | `bg-destructive-soft` | Recusado, bloqueado, expirado |
| informação | `bg-secondary` | `text-secondary-strong` | `bg-secondary/25` | Informação neutra |

Os valores de texto dos estados mudaram na FASE 61 (`#059669` → `#047857` e
`#dc2626` → `#b91c1c`) porque a catraca de contraste mediu o par de cada um contra
o fundo lavado e contra a superfície: ver a seção 8 (dívida quitada).

### Raridade (gamificação) — só para conquista

`tier-common` · `tier-rare` · `tier-epic` · `tier-legendary` · `tier-mythic` (classes
de gradiente em `globals.css`) e `RarityBadge` no catálogo de primitivos.
**Status operacional nunca usa gradiente** — a fronteira entre "estado do sistema" e
"mérito do participante" é parte do produto. A raridade é **arte de carta**, não
texto sobre superfície, e por isso é a mesma nos dois modos.

---

## 3. O modo escuro é uma ESCALA, não uma tela (FASE 61 · dívida H3)

O sistema tem duas escalas completas. O modo escuro redefine **apenas a camada
`--ef-*`**: o `@theme inline` é escrito uma vez, os componentes escrevem os mesmos
papéis (`bg-card`, `border-border`, `text-warning-strong`) e não têm — nem podem
ter — condicional de tema. Isso é o ADR-324, e é o que impediu a fase inteira de
virar uma segunda interface que envelhece separada da primeira.

| Papel (token de uso) | Claro | Escuro |
|---|---|---|
| `bg-surface` (canvas) | `#f9f9ff` | `#17181e` |
| `bg-surface-low` (agrupamento) | `#f1f3ff` | `#1d1f26` |
| `bg-card` (cartão, o padrão) | `#ffffff` | `#23252d` |
| `bg-surface-high` (hover, realce) | `#e5e8f4` | `#2a2c35` |
| `bg-surface-highest` (separador forte) | `#dfe2ee` | `#31333d` |
| `bg-surface-dim` (superfície que recua) | `#d7dae5` | `#121319` |
| `text-foreground` | `#181c24` | `#e1e2ec` |
| `text-muted-foreground` | `#464555` | `#c5c6d0` |
| `border-border` (hairline e borda de campo) | `#83808f` | `#6b7280` |
| `border-border-strong` | `#777587` | `#8b90a1` |
| `bg-primary` (ação) | `#4f46e5` | `#2b1fa8` |
| `text-primary-foreground` | `#ffffff` | `#ffffff` |
| `bg-primary-hover` | `#4338ca` | `#4236c4` |
| `text-brand` (link, item ativo) | `#3525cd` | `#a5b4fc` |
| `bg-primary-soft` | `#e2dfff` | 12% do preenchimento sobre o cartão |
| `text-secondary-strong` | `#00668a` | `#7dd3fc` |
| `text-tertiary-strong` | `#005338` | `#5eead4` |
| `bg-success` / `text-success-strong` | `#10b981` / `#047857` | `#34d399` / `#6ee7b7` |
| `bg-warning` / `text-warning-strong` | `#f59e0b` / `#92400e` | `#fbbf24` / `#fcd34d` |
| `bg-destructive` / `text-destructive` | `#b91c1c` | `#93000a` / `#fca5a5` |
| `--ring` (anel de foco) | `#4f46e5` | `#a5b4fc` |
| `--shadow-card` | preto a 5% | preto a 50% (sombra sobre escuro precisa de densidade) |

**Os mesmos papéis, as mesmas relações.** No claro o texto é o tom mais escuro e o
fundo o mais claro; no escuro isso se inverte, e a escada continua ascendente — o
cartão é sempre um degrau acima do canvas. O que muda é o valor, nunca o contrato.

**Os tokens que NÃO mudam têm motivo escrito** (`DESIGN.md`, seção de cores): o
`inverse-surface` é a superfície que já é escura por definição — o **telão do
sorteio** e as cápsulas sobre imagem —, a raridade é arte de carta, e
`warning-strong-on-dark` é o par de aviso medido da FASE 52. Inverter qualquer um
deles apagaria a operação de palco.

### Como o modo é decidido (e o que NÃO é desta camada)

| Estado | O que existe no CSS | Quem responde |
|---|---|---|
| **Sistema** (padrão, sem escolha gravada) | `@media (prefers-color-scheme: dark)` | a preferência do sistema operacional, **sem JavaScript e sem cookie** — é o defeito que a H3 descrevia |
| **Escuro** (escolha manual) | `.dark` no `<html>` | a classe que a fiação grava |
| **Claro** (escolha manual) | nada | a ausência da classe |

`color-scheme` acompanha: `light` no `:root` e `dark` nos dois blocos escuros. Sem
ele, `select`, barra de rolagem, seletor de data e o fundo do autofill continuam
claros dentro de uma tela escura — o campo de e-mail preenchido pelo navegador vira
um retângulo branco no meio da página.

Duas exceções por desenho, e as duas são verificadas por teste:

1. **O telão do sorteio** (`--inverse-surface`, `--warning-strong-on-dark`, as
   classes `.ef-stage-*`) é escuro nos DOIS modos — a F52 mediu o par (9,17:1).
2. **Documento impresso não tem modo escuro**: certificado e crachá saem em PDF/ZPL
   renderizados no servidor para papel branco, e não leem token de tema.
3. **A página pública do evento mantém o tema do organizador**
   (`event-theme.css`, `theme-scope.tsx`): as cores que ele escolheu não são
   invertidas nem recalculadas. Como variável declarada no elemento vence a herdada
   de `:root`, o escopo do evento continua com as cores dele enquanto a plataforma
   em volta (casco, login, inscrição, área de conta) segue o modo.

---

## 4. Tipografia

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

## 5. Primitivos — o catálogo

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

## 6. Navegação — os três shells

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

## 7. Receita: um módulo novo em 6 passos

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

## 8. Proibido (a trava reprova)

| Proibido | Por quê | Faça |
|---|---|---|
| `text-gray-500`, `bg-slate-100`, `border-emerald-500/40` | Paleta crua do Tailwind: 150 ocorrências herdadas das fases 1–10 | `text-muted-foreground`, `bg-surface-low`, `border-success/40` |
| `#4F46E5`, `bg-[#fff]` em componente | Cor literal não pertence a componente | Token (exceções: `globals.css`, tema do evento, guia de estilo, `global-error.tsx`) |
| `text-[13px]`, `text-[11px]` | Quebra a escala tipográfica | `text-sm`, `label-caps`, `code-data` |
| Segundo botão preenchido na mesma tela | Disputa a ação principal | `variant="outline"` / `"ghost"` |
| Cartão dentro de cartão com sombra | Achatamento visual | `elevated={false}` |
| Gradiente fora de conquista | Borra a fronteira estado × mérito | `Badge` com `tone` |
| Condicional de tema em componente (`dark:`) ou segundo `@theme` | Cria uma segunda interface, que envelhece separada da primeira (ADR-324) | papéis (`bg-card`, `text-muted-foreground`) — a escala escura responde por eles |

### Dívida aberta (a catraca)

Depois da **FASE 11B**, as duas listas (`RAW_COLOR_DEBT` e `ARBITRARY_TEXT_DEBT`) estão
**vazias** — isto é, o teto de qualquer arquivo é zero e a proibição é absoluta. O
mecanismo continua no teste de propósito: se uma migração futura precisar de exceção, o
lugar dela já existe, é explícito e só pode encolher depois.

**Contraste do modo claro (FASE 61 · QUITADO).** A catraca dos dois modos
(`f61-contraste-dos-dois-modos.test.ts`) mediu seis pares da escala **clara** abaixo
do AA. Eram dívida anterior à fase, e a decisão foi corrigir — a régua da casa
(FASE 52) é que o contraste medido vence o valor documentado:

| Par | Antes | Agora |
|---|---|---|
| `text-success-strong` sobre a tela | 3,59:1 (`#059669`) | **5,23:1** (`#047857`) |
| `text-success-strong` sobre o cartão | 3,77:1 | **5,48:1** |
| `text-success-strong` sobre o `success-soft` | 3,49:1 | **5,09:1** |
| `text-destructive` sobre o `destructive-soft` | 4,41:1 (`#dc2626`) | **5,90:1** (`#b91c1c`) |
| `border-border` (borda de campo) sobre a tela | 1,63:1 (`#c7c4d8`) | **3,67:1** (`#83808f`) |
| `border-border` sobre o cartão | 1,71:1 | **3,85:1** |

A lista de exceção saiu do teste: **nenhum** par dos dois modos está dispensado do
AA. A mudança é VISÍVEL no modo claro (verde e vermelho um tom mais escuros, borda
mais firme) — e é a segunda vez que a paleta muda por medição, como o aviso mudou
na FASE 52.

**Escolha explícita de CLARO (FASE 61).** A media query do sistema é
`:root:not([data-tema='claro'])`: sem essa guarda, `:root` e `:root` têm a mesma
especificidade e a media query vence por vir depois — num sistema operacional
escuro, quem escolheu "Claro" veria escuro (o defeito da H3 de cabeça para baixo).
A guarda lê o `data-tema` que a fiação grava sempre no `<html>`
(`claro` · `escuro` · `sistema`), e o `:not()` sobe a especificidade de (0,1,0) para
(0,2,0).

### Rótulo de campo: `id` ou envolvente

`Field` + `fieldAria` (recomendado) liga rótulo, dica e erro por `id`, e exige **ids
únicos na página**. Quando a MESMA página tem vários formulários repetindo nomes de
campo (o painel administrativo tem: sala, atividade e trilha usam `capacity`), use
rótulo **envolvente** (`<label>texto <input/></label>`), como faz
`src/components/admin/admin-form.tsx`. Ids duplicados fazem o `for` apontar para o
controle de outro formulário — e o rótulo visível deixa de ser o rótulo daquele campo.

---

## 9. Verificação

```bash
npx vitest run tests/unit/design-system-guard.test.ts            # a trava dos tokens
npx vitest run tests/unit/f61-escala-escura.test.ts              # a escala escura está completa
npx vitest run tests/unit/f61-contraste-dos-dois-modos.test.ts   # contraste nos DOIS modos
npx vitest run tests/unit/f52-warning-contrast.test.ts           # o par do aviso e do telão
npm run lint && npm run typecheck                                # tipos e estilo
# e, com o app rodando:
#   /superadmin/design   → a identidade renderizada
```

O que cada catraca prende:

| Teste | O que ele impede |
|---|---|
| `design-system-guard.test.ts` | paleta crua do Tailwind, hexadecimal em componente, tamanho de fonte fora da escala, token obrigatório ausente e **valor de identidade diferente do `DESIGN.md`** |
| `f61-escala-escura.test.ts` | token de cor que nasce só na escala clara (ou só na escura), bloco `.dark` divergente da media query do sistema, apelido misturado não reescrito no escuro, `@theme` duplicado e `color-scheme` ausente |
| `f61-contraste-dos-dois-modos.test.ts` | par texto/fundo abaixo de 4,5:1 e borda/contorno/anel abaixo de 3:1, **nos dois modos**, com o número medido preso linha a linha |
| `f52-warning-contrast.test.ts` | o aviso voltar a ter um tom só (o do painel claro reprovava no telão) |

Nenhum par entra na escala por olhômetro: o teste lê o `globals.css`, calcula a razão
do WCAG e reprova dizendo o número.
