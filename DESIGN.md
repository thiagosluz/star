---
version: alpha
name: EventFlow Identity
description: >-
  Identidade visual da plataforma EventFlow (instituições de ensino e eventos
  acadêmicos). Duas escalas — clara e escura — com os MESMOS papéis. Os valores
  abaixo são os que o `src/app/globals.css` implementa; a igualdade é verificada
  por `tests/unit/design-system-guard.test.ts` (escala clara), por
  `tests/unit/f61-escala-escura.test.ts` (cobertura da escura) e por
  `tests/unit/f61-contraste-dos-dois-modos.test.ts` (contraste dos pares nos dois
  modos).

colors:
  # ─── Escala CLARA — paleta crua (o `:root` de globals.css) ───────────────────
  surface: "#f9f9ff"
  surface-dim: "#d7dae5"
  surface-bright: "#f9f9ff"
  surface-lowest: "#ffffff"
  surface-low: "#f1f3ff"
  surface-container: "#ebedfa"
  surface-high: "#e5e8f4"
  # ─── A superfície FLUTUANTE (menu, gaveta, modal) — FASE 62 · dívida E81 ─────
  # No CLARO ela é o mesmo branco do cartão (lá quem eleva é a sombra); no ESCURO
  # ela é o degrau acima do cartão, porque no escuro quem eleva é o TOM.
  surface-popover: "#ffffff"
  surface-highest: "#dfe2ee"
  surface-variant: "#dfe2ee"
  on-surface: "#181c24"
  on-surface-variant: "#464555"
  inverse-surface: "#2c3039"
  inverse-on-surface: "#eef0fc"
  outline: "#777587"
  outline-variant: "#83808f"
  primary: "#3525cd"
  on-primary: "#ffffff"
  primary-container: "#4f46e5"
  primary-hover: "#4338ca"
  on-primary-container: "#dad7ff"
  inverse-primary: "#c3c0ff"
  primary-fixed: "#e2dfff"
  primary-fixed-dim: "#c3c0ff"
  on-primary-fixed: "#0f0069"
  on-primary-fixed-variant: "#3323cc"
  surface-tint: "#4d44e3"
  secondary: "#00668a"
  on-secondary: "#ffffff"
  secondary-container: "#40c2fd"
  on-secondary-container: "#004d6a"
  secondary-fixed: "#c4e7ff"
  secondary-fixed-dim: "#7bd0ff"
  on-secondary-fixed: "#001e2c"
  on-secondary-fixed-variant: "#004c69"
  tertiary: "#005338"
  on-tertiary: "#ffffff"
  tertiary-container: "#006e4b"
  on-tertiary-container: "#67f4b7"
  tertiary-fixed: "#6ffbbe"
  tertiary-fixed-dim: "#4edea3"
  on-tertiary-fixed: "#002113"
  on-tertiary-fixed-variant: "#005236"
  error: "#ba1a1a"
  on-error: "#ffffff"
  error-container: "#ffdad6"
  on-error-container: "#93000a"
  success: "#10b981"
  success-strong: "#047857"
  warning: "#f59e0b"
  warning-strong: "#92400e"
  warning-strong-on-dark: "#fcd34d"
  danger: "#ef4444"
  danger-strong: "#b91c1c"
  tier-common-from: "#64748b"
  tier-common-to: "#94a3b8"
  tier-rare-from: "#0284c7"
  tier-rare-to: "#38bdf8"
  tier-epic-from: "#7c3aed"
  tier-epic-to: "#a855f7"
  tier-legendary-from: "#d97706"
  tier-legendary-to: "#fbbf24"
  tier-mythic-from: "#e11d48"
  tier-mythic-mid: "#f43f5e"
  tier-mythic-to: "#fb7185"

  # ─── Escala ESCURA — os mesmos papéis (o bloco `.dark`) ──────────────────────
  dark-surface: "#17181e"
  dark-surface-dim: "#121319"
  dark-surface-bright: "#23252d"
  dark-surface-lowest: "#23252d"
  dark-surface-low: "#1d1f26"
  dark-surface-container: "#262831"
  dark-surface-high: "#2a2c35"
  dark-surface-popover: "#2f323c"
  dark-surface-highest: "#31333d"
  dark-surface-variant: "#3a3d47"
  dark-on-surface: "#e1e2ec"
  dark-on-surface-variant: "#c5c6d0"
  dark-outline: "#8b90a1"
  dark-outline-variant: "#7a7f8d"
  dark-primary: "#a5b4fc"
  dark-on-primary: "#ffffff"
  dark-primary-container: "#2b1fa8"
  dark-primary-hover: "#4236c4"
  dark-on-primary-container: "#dad7ff"
  dark-inverse-primary: "#c3c0ff"
  dark-primary-fixed: "#2b1fa8"
  dark-primary-fixed-dim: "#c3c0ff"
  dark-on-primary-fixed: "#dad7ff"
  dark-on-primary-fixed-variant: "#c3c0ff"
  dark-surface-tint: "#a5b4fc"
  dark-secondary: "#7dd3fc"
  dark-on-secondary: "#00344a"
  dark-secondary-container: "#075985"
  dark-on-secondary-container: "#e0f2fe"
  dark-secondary-fixed: "#164e63"
  dark-secondary-fixed-dim: "#0e7490"
  dark-on-secondary-fixed: "#c4e7ff"
  dark-on-secondary-fixed-variant: "#a5f3fc"
  dark-tertiary: "#5eead4"
  dark-on-tertiary: "#00281c"
  dark-tertiary-container: "#0d4f3a"
  dark-on-tertiary-container: "#6ffbbe"
  dark-tertiary-fixed: "#0d4f3a"
  dark-tertiary-fixed-dim: "#2dd4bf"
  dark-on-tertiary-fixed: "#6ffbbe"
  dark-on-tertiary-fixed-variant: "#a7f3d0"
  dark-error: "#ffb4ab"
  dark-on-error: "#690005"
  dark-error-container: "#93000a"
  dark-on-error-container: "#ffdad6"
  dark-success: "#34d399"
  dark-success-strong: "#6ee7b7"
  dark-warning: "#fbbf24"
  dark-warning-strong: "#fcd34d"
  dark-danger: "#f87171"
  dark-danger-strong: "#fca5a5"

typography:
  display:
    fontFamily: Plus Jakarta Sans
    fontSize: 56px
    fontWeight: 700
    lineHeight: 64px
    letterSpacing: -0.03em
  display-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: 700
    lineHeight: 48px
    letterSpacing: -0.025em
  title-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: 600
    lineHeight: 36px
    letterSpacing: -0.02em
  title:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.06em
  code-data:
    fontFamily: ui-monospace
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px

rounded:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px

spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  content-max: 1600px
  gutter: 24px
  gutter-lg: 32px

components:
  button-primary:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
    height: 44px
    padding: 20px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  card:
    backgroundColor: "{colors.surface-lowest}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
  # A superfície que FLUTUA (menu, gaveta, modal) — FASE 62 · dívida E81. No claro
  # resolve no branco do cartão (a sombra eleva); no escuro, num degrau de tom acima.
  floating-surface:
    backgroundColor: "{colors.surface-popover}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    border: "{colors.outline-variant}"
  input:
    backgroundColor: "{colors.surface-lowest}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    height: 44px
  chip-info:
    backgroundColor: "{colors.secondary-fixed}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.md}"
  alert-success:
    backgroundColor: "{colors.surface-lowest}"
    textColor: "{colors.success-strong}"
    rounded: "{rounded.md}"
  alert-warning:
    backgroundColor: "{colors.surface-lowest}"
    textColor: "{colors.warning-strong}"
    rounded: "{rounded.md}"
  alert-danger:
    backgroundColor: "{colors.surface-lowest}"
    textColor: "{colors.danger-strong}"
    rounded: "{rounded.md}"
  bigscreen:
    backgroundColor: "{colors.inverse-surface}"
    textColor: "{colors.inverse-on-surface}"
    rounded: "{rounded.md}"
---

# Identidade visual do EventFlow

> **Este arquivo é a fonte dos VALORES.** O que traduz valor em token é
> `src/app/globals.css`; o que impede a regressão são os testes de `tests/unit/`.
> A leitura para quem vai escrever tela é `docs/design-system.md`.
>
> **Nota de proveniência (FASE 61).** O repositório referenciava este arquivo
> desde a FASE 11A, mas ele nunca foi versionado (`git log -- DESIGN.md` é vazio) —
> os valores sempre viveram apenas no `:root` do `globals.css`, que a própria
> documentação declara serem "os do DESIGN.md". Este texto foi reconstruído a
> partir dessa fonte única na FASE 61, para que a escala escura tivesse contra o
> que ser documentada. Os valores da escala clara são **exatamente** os que a
> catraca já prendia; nenhum tom de identidade foi alterado.

## Overview

EventFlow é um SaaS multi-tenant para eventos acadêmicos, corporativos e
comunitários, usado por instituições brasileiras. A interface é **de trabalho**:
tabelas densas, estados operacionais, documentos e auditoria. A identidade é
sóbria — indigo de marca, cinzas frios, verde de confirmação — e o destaque é
reservado para o que exige decisão.

Duas regras de caráter:

1. **A plataforma é uma só.** Toda tela do sistema (casco, painéis, área de conta)
   pertence à identidade da plataforma; o que muda por instituição é o **tema da
   página pública do evento**, que o organizador escolhe e que a plataforma não
   inverte nem recalcula.
2. **O documento é dado, não tela.** Certificado e crachá são PDF/ZPL renderizados
   no servidor para papel branco: eles não leem token de tema, e por isso não têm
   modo escuro.

## Colors

A cor é publicada em três camadas, e essa separação é o que permite o modo escuro
existir sem tocar em componente: **paleta crua** (`--ef-*`, os valores das tabelas
abaixo) → **apelido semântico** (`--card`, `--border`, `--muted-foreground`, o
vocabulário que os componentes usam) → **utilidade do Tailwind** (`bg-card`,
`text-muted-foreground`), publicada uma única vez no `@theme inline`.

O modo escuro redefine **apenas a primeira camada**. Um componente escreve
`bg-card` e recebe `#ffffff` no claro e `#23252d` no escuro sem saber que o modo
existe.

**Quem decide o modo** (três estados, sem JavaScript): a escolha manual escreve a
classe `.dark` no `<html>`; sem escolha, `@media (prefers-color-scheme: dark)`
responde pela preferência do sistema operacional; e a escolha explícita de CLARO
desliga essa media query, porque sem isso quem escolheu claro num sistema escuro
continuaria vendo escuro. O `color-scheme` acompanha cada modo, senão `select`,
barra de rolagem e o fundo do autofill continuam claros dentro da tela escura.

### Superfícies (a escada de profundidade)

| Papel | Claro | Escuro |
|---|---|---|
| Canvas da página (nível 0) | `#f9f9ff` | `#17181e` |
| Agrupamento, cabeçalho de tabela | `#f1f3ff` | `#1d1f26` |
| **Cartão** (nível 2, o padrão) | `#ffffff` | `#23252d` |
| **Superfície flutuante** (popover, menu, gaveta, modal) | `#ffffff` | `#2f323c` |
| Hover, realce, chip neutro | `#e5e8f4` | `#2a2c35` |
| Separador forte | `#dfe2ee` | `#31333d` |
| Superfície que RECUA | `#d7dae5` | `#121319` |
| Texto principal | `#181c24` | `#e1e2ec` |
| Texto secundário | `#464555` | `#c5c6d0` |
| Hairline estrutural e borda de campo | `#83808f` | `#7a7f8d` |
| Contorno de ênfase | `#777587` | `#8b90a1` |

**A escada é ascendente nos dois modos**: o cartão é mais claro que o canvas tanto
no claro quanto no escuro. No escuro, "mais claro" quer dizer *um degrau acima do
fundo*, não "uma cor clara" — é o que preserva a leitura de profundidade.

**A elevação do escuro é por TOM, e a do claro é por SOMBRA** (FASE 62 · dívida
E81). No claro a superfície flutuante é o mesmo branco do cartão e quem a levanta é
a sombra; no escuro a sombra preta não desenha degrau nenhum sobre superfície já
escura, então cada nível sobe um degrau de tom — `#17181e` (fundo) → `#23252d`
(cartão) → `#2f323c` (flutuante). A sombra continua no escuro como **reforço** do
que flutua sobre conteúdo. Medir essa decisão teve uma consequência: com a
superfície flutuante mais clara que o cartão, a **hairline** do escuro media 2,64:1
sobre ela (abaixo dos 3:1 do AA non-text) e subiu de `#6b7280` para `#7a7f8d` —
3,20:1 sobre o flutuante, 4,43:1 sobre o canvas e 3,82:1 sobre o cartão. A ordem da
escada e os dois saltos de elevação (1,16:1 e 1,20:1) são catraca em
`tests/unit/f62-elevacao-do-escuro.test.ts`.

### Marca e ações

| Papel | Claro | Escuro |
|---|---|---|
| Ação (preenchimento do botão) | `#4f46e5` | `#2b1fa8` |
| Texto sobre a ação | `#ffffff` | `#ffffff` |
| Hover da ação | `#4338ca` | `#4236c4` |
| Marca em texto (link, item ativo) | `#3525cd` | `#a5b4fc` |
| Fundo suave de marca | `#e2dfff` | mistura 12% do preenchimento sobre o cartão |
| Telemetria, sessão ao vivo | `#00668a` | `#7dd3fc` |
| Confirmação institucional | `#005338` | `#5eead4` |

No escuro, **ação e marca em texto se separam de propósito**: o indigo claro
(`#a5b4fc`) é o que sobrevive como texto e anel de foco sobre fundo escuro, e o
indigo escuro (`#2b1fa8`) é o que sustenta o rótulo branco do botão (11,27:1).
Um valor só não fecha os dois papéis — a mesma conclusão que a FASE 52 tirou do
token de aviso.

### Estados

| Estado | Fill (ícone/barra) | Texto acessível | Fundo lavado | Contraste do texto |
|---|---|---|---|---|
| sucesso | `#10b981` / `#34d399` | `#047857` / `#6ee7b7` | 12% do fill sobre o cartão | 5,23:1 na tela · 5,48:1 no cartão · 5,09:1 no suave (5,44:1 no escuro) |
| atenção | `#f59e0b` / `#fbbf24` | `#92400e` / `#fcd34d` | 14% do fill sobre o cartão | 6,76:1 · 7,09:1 · 6,44:1 (5,38:1 no escuro) |
| perigo | `#ef4444` / `#f87171` | `#b91c1c` / `#fca5a5` | 12% do fill sobre o cartão | 6,17:1 · 6,47:1 · 5,90:1 (5,24:1 no escuro) |
| erro (Material 3) | `#ba1a1a` / `#ffb4ab` | `#93000a` sobre `#ffdad6` / `#ffdad6` sobre `#93000a` | — | 7,24:1 nos dois modos |

Os três papéis são **três valores diferentes de propósito**: o fill é a cor do
ícone e da barra, o `-strong` é o texto sobre o fundo lavado (mais escuro no
claro, mais claro no escuro) e o suave é a mistura com a superfície de leitura do
modo. O aviso tem ainda um quarto tom — `warning-strong-on-dark`, `#fcd34d` — que
existe só porque o **telão do sorteio** é escuro nos DOIS modos (FASE 52).

**O texto de sucesso e o de perigo mudaram de valor na FASE 61** (`#059669` →
`#047857` e `#dc2626` → `#b91c1c`), e a **hairline** foi de `#c7c4d8` para
`#83808f`. Não foi gosto: a catraca de contraste dos dois modos mediu os pares e
os antigos reprovavam no AA — o texto de sucesso media 3,59:1 sobre a tela,
3,77:1 sobre o cartão e 3,49:1 sobre o próprio fundo lavado; o de perigo, 4,41:1
sobre o fundo lavado; e a borda de campo (que é o `--input`), 1,63:1, quando o AA
non-text pede 3:1. A mudança é **visível** no modo claro — verde e vermelho um tom
mais escuros e borda mais firme — e é o preço de o contraste medido vencer o valor
documentado (a mesma régua que a FASE 52 aplicou ao aviso).

### Tokens que NÃO mudam entre os modos, e por quê

| Token | Valor | Motivo |
|---|---|---|
| `inverse-surface` / `inverse-on-surface` | `#2c3039` / `#eef0fc` | é a superfície que já é escura por definição: telão do sorteio e cápsulas sobre imagem (legenda de capa, contador do álbum, véu da gaveta) |
| `warning-strong-on-dark` | `#fcd34d` | o par de aviso daquela superfície, medido em 9,17:1 |
| `tier-*` | os gradientes de raridade | é a ARTE da carta (cor de conquista), não texto sobre superfície |
| `surface-bright` / `surface-tint` | `#23252d` / `#a5b4fc` | direções da escada e destaque tonal da marca — mudam de valor, mas continuam nomeando a MESMA direção |
| `on-primary` | `#ffffff` | o rótulo do botão é branco nos dois modos, sobre indigos diferentes |

## Typography

| Papel | Classe | Fonte | Tamanho |
|---|---|---|---|
| Herói de página pública | `text-display` | Plus Jakarta Sans | 56/64, −0.03em |
| Número de indicador | `text-display-sm` | Plus Jakarta Sans | 40/48 |
| Título de página | `text-title-lg` | Plus Jakarta Sans | 28/36 |
| Título de seção/cartão | `text-title` | Plus Jakarta Sans | 20/28 |
| Corpo | `text-sm` / `text-body-lg` | Inter | 14 · 16 |
| Metadado | `label-caps` | Inter | 11, caixa alta, 0.06em |
| Dado técnico | `code-data` | mono, tabular | 13 |

As fontes são carregadas por `next/font` em `src/app/layout.tsx`. A escala é
fechada: tamanho de fonte arbitrário (`text-[13px]`) reprova na catraca.

## Layout

- **Contêiner de conteúdo**: uma largura máxima para todo o sistema — 1600px
  (`.content-container`), com gutter de 24px (32px a partir de 1024px).
- **Ritmo vertical**: múltiplos de 4px; agrupamento em 16/24/32px.
- **Densidade de linha de tabela**: 52px, cabeçalho em `label-caps`.
- **Área de toque**: 44px de altura mínima em campo e botão.

## Elevation & Depth

| Nível | No claro | No escuro | Onde |
|---|---|---|---|
| 0 | canvas (`#f9f9ff`) | canvas (`#17181e`) | fundo da página |
| 1 | `surface-low` | `surface-low` | agrupamento, cabeçalho de tabela |
| 2 | `surface-lowest` + `shadow-card` | `surface-lowest` (o TOM eleva) | cartão — **o padrão** |
| 3 | `surface-lowest` + `shadow-modal` | `surface-popover` (o TOM eleva) | popover, menu, gaveta, modal |
| — | `surface-high` | `surface-high` | hover e realce DENTRO de um cartão |

**Quem eleva muda de modo, e isso é decisão, não descuido** (FASE 62 · dívida
E81). No claro, `--shadow-card` (`0 4px 6px -1px rgb(0 0 0 / 0.05)`) e
`--shadow-modal` (`0 20px 25px -5px rgb(0 0 0 / 0.1)`) são quem levanta a
superfície, e o branco do cartão é o mesmo branco do popover. No escuro a sombra
preta não desenha degrau sobre fundo escuro: a elevação é o **TOM**, um degrau por
nível (`#23252d` do cartão → `#2f323c` do que flutua), e a sombra fica como
**reforço** do que flutua sobre conteúdo — o que continua se enxergando, porque
escurece o que está atrás. Os dois saltos de elevação do escuro (fundo→cartão
1,16:1 e cartão→flutuante 1,20:1) e a ordem inteira da escada são catraca em
`tests/unit/f62-elevacao-do-escuro.test.ts`; os pares de texto e a hairline da
superfície flutuante são medidos pelo portão dos dois modos.

## Shapes

Raios em quatro degraus — `xs` 4px (chip pequeno, botão compacto), `sm` 8px
(botão padrão, campo), `md` 12px (cartão, alerta), `lg`/`xl` 16/24px (painel,
palco). A forma é contida: nada de cápsula fora de `Badge` e avatar.

## Components

| Componente | Regra |
|---|---|
| `Button` | Um primário por tela; o destrutivo é contorno e só preenche no hover; `danger` existe para confirmação sem volta |
| `Card` | Nível 2; cartão dentro de cartão usa `elevated={false}` |
| Diálogo, menu, gaveta | Nível 3: `bg-popover` + `shadow-modal` — no claro o popover é o branco do cartão e a sombra eleva; no escuro o tom dele é o degrau |
| `Badge` | Estado ao lado de um dado, sempre com rótulo escrito; `tone="event"` usa a cor do evento |
| `Alert` | O que a pessoa precisa saber agora; ícone + título, `role="alert"` no perigo |
| `Field`/`Input` | 44px, rótulo e erro amarrados por `name` |
| `Table` | Cabeçalho `label-caps`, linha 52px, coluna numérica com `numeric` |
| `ConfirmDialog` | Ação sem volta: título com a pergunta, consequência escrita e foco inicial em "Cancelar" |
| Telão (`RaffleStage`) | Escuro nos dois modos, tipografia em `clamp` com `vw`, lido a metros |

## Do's and Don'ts

- **Do** consumir apelido semântico (`bg-card`, `text-muted-foreground`,
  `border-border`); **don't** escrever hexadecimal nem a paleta crua do Tailwind
  em componente — a catraca reprova.
- **Do** criar token novo nas **duas** escalas; **don't** deixar um papel só no
  claro — é exatamente o defeito que a dívida H3 descreve, e a catraca de
  cobertura reprova.
- **Do** manter ≥ 4,5:1 para texto e ≥ 3:1 para borda, contorno e anel de foco,
  nos dois modos; **don't** trocar um tom por outro "mais bonito" sem medir — os
  pares estão presos por teste, com o número escrito ao lado.
- **Do** manter a página pública do evento com o tema do organizador; **don't**
  inverter as cores que ele escolheu nem fazer o PDF impresso ler token de tema.
- **Do** dar `bg-popover` ao que FLUTUA sobre conteúdo (menu, gaveta, modal);
  **don't** desenhar sobreposição com `bg-card` — no modo escuro ela perde o degrau,
  porque lá quem eleva é o tom e não a sombra (dívida E81).
- **Don't** usar gradiente fora de conquista: a fronteira entre "estado do
  sistema" e "mérito do participante" é parte do produto.
