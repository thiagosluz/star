# FASE 11B — Propagação do design e quitação da dívida

> **Leia junto com:** [`docs/design-system.md`](design-system.md) (o contrato),
> [`docs/fase-11a-identidade-visual.md`](fase-11a-identidade-visual.md) (a fundação)
> e [`DESIGN.md`](../DESIGN.md) (os valores da marca).

---

## 1. Sumário executivo

A FASE 11A instalou a identidade e os primitivos, e deixou uma **catraca**: uma lista
explícita de dívida (arquivo → teto de ocorrências) que impedia a migração de travar o
desenvolvimento, mas que só podia encolher. Esta fase **zera essa lista**.

Ao final, não existe no código de interface uma única cor da paleta crua do Tailwind,
nem um único tamanho de fonte fora da escala, nem hexadecimal. O mecanismo da catraca
continua no teste — com os mapas **vazios**, que é a forma totalmente apertada dele.

### Entregas

| # | Entrega | Resultado |
|---|---|---|
| 1 | Cores cruas do Tailwind substituídas por tokens semânticos | 31 arquivos, 133 substituições |
| 2 | Tamanhos arbitrários substituídos pela escala tipográfica | 22 arquivos, 75 substituições |
| 3 | Raridade (cartas) migrada para os tokens de **tier**, não de estado | `card-visual.tsx` |
| 4 | `Field`/`SelectField`/`CheckboxField` do painel passaram a DELEGAR aos primitivos do sistema | `admin-form.tsx` (5 páginas beneficiadas sem alteração) |
| 5 | Tema do evento deixou de reimportar o Tailwind | `event-theme.css` |
| 6 | Catraca com dívida **zerada** (proibição absoluta para código novo) | `tests/unit/design-system-guard.test.ts` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos alterados | 42 (31 pela migração de cor, 22 pela de tipografia, com sobreposição) |
| Substituições | **208** (133 de cor + 75 de tamanho) |
| Arquivos criados | 1 (esta documentação) |
| Testes Vitest | 775 (a trava continua com 5 casos) |
| Testes E2E | 42 |
| Migrações | nenhuma |
| ADRs | 67 → **70** |
| Dívida restante | **zero** em cor e tipografia |

---

## 2. O problema mais difícil da fase

**Migrar 208 ocorrências em 42 arquivos sem quebrar telas que ninguém está olhando — e
sem trocar o SIGNIFICADO das cores.**

O caminho perigoso era a substituição "inteligente": `blue` pode ser informação ou
marca; `violet` pode ser marca ou **raridade épica**; `amber` pode ser atenção ou
**raridade lendária**. Uma regex que mapeasse por matiz acertaria a estética e erraria o
produto — uma carta lendária passaria a parecer um aviso do sistema, e a fronteira
entre "mérito do participante" e "estado operacional" (que o `DESIGN.md` trata como
princípio) desapareceria sem ninguém notar.

A saída foi: **levantar primeiro, decidir uma vez, aplicar depois.** O script temporário
listou as 41 classes distintas existentes (não 208 decisões — 41), e cada uma ganhou um
destino escrito à mão em um mapa. A migração então aplicou o mapa e imprimiu cada troca
para revisão.

O segundo ponto de atenção veio dessa revisão: `card-visual.tsx` tinha, sim, caído no
token de estado (`LEGENDARY → warning`, `RARE → secondary`). Corrigido para
`tier-legendary` / `tier-rare` — o registro está na lição 1 abaixo.

---

## 3. Decisões técnicas

### 3.1 Mapa explícito, não heurística

41 classes → 41 destinos, com o porquê de cada família:

| Família | Destino | Motivo |
|---|---|---|
| `green*`, `emerald*` | `success`, `success-strong`, `success-soft` | Confirmação, verificação, aprovação |
| `amber*`, `orange*` | `warning`, `warning-strong`, `warning-soft` | Espera, análise, rascunho — **exceto** em carta, onde é raridade |
| `blue*` | `secondary`, `secondary-strong` | Informação, telemetria, sessão |
| `violet*`, `pink*` | `tier-epic`, `tier-mythic` | Raridade (não marca) |
| `slate*`, `gray*` | `surface*`, `muted-foreground`, `border` | Camadas e texto |

### 3.2 Unificar por delegação, não por reescrita

O painel administrativo tinha `Field`, `SelectField` e `CheckboxField` próprios desde a
FASE 7, com marcação e classes próprias — dois "campos" no mesmo produto, com alturas e
comportamento de foco diferentes, e sem `aria-describedby`.

Reescrever as cinco páginas que os usam seria a unificação "pura", com risco em telas já
testadas. A alternativa escolhida foi **fazer o componente antigo delegar** ao primitivo
do sistema, mantendo `label`/`name`/`hint` como contrato: as cinco páginas ganharam
acessibilidade e altura de campo corretas sem uma linha alterada nelas.

### 3.3 A catraca permanece — vazia

Remover o mecanismo seria perder a proteção que a 11A construiu. Mantivemos os dois
mapas (`RAW_COLOR_DEBT` e `ARBITRARY_TEXT_DEBT`) **vazios**: como o teto padrão de
qualquer arquivo é zero, o efeito é proibição absoluta, e o dia em que uma migração
grande precisar de exceção o lugar dela já existe e é visível.

### 3.4 O tema do evento deixou de duplicar o Tailwind

`event-theme.css` fazia `@import 'tailwindcss'` — um segundo carregamento do framework
dentro do bundle das páginas públicas. Como o `globals.css` já é carregado pelo layout
raiz, o import era redundante e inflava o CSS dessas rotas.

---

## 4. ADRs

### ADR-068 — Migração de design é mapa explícito, jamais heurística de matiz

**Contexto.** 208 ocorrências de cor/tamanho cru em 42 arquivos, escritas ao longo de 10
fases, com significados diferentes para a mesma matiz (âmbar é "pendente" na revisão e
"lendária" na carta).

**Decisão.** Levantar as classes distintas, decidir o destino de cada uma em um mapa
revisado, aplicar e revisar o log de trocas.

**Justificativa.** A heurística acerta a aparência e erra o significado. Trocar o
significado de uma cor é uma mudança de produto disfarçada de faxina — e o tipo de erro
que passa em revisão de código porque "é só uma cor".

**Consequências.** Migração em duas etapas (levantar/decidir e aplicar). O script foi
temporário e foi removido; o mapa ficou registrado nesta documentação.

### ADR-069 — Raridade usa tokens de tier; estado operacional nunca

**Contexto.** Depois da migração mecânica, `card-visual.tsx` ficou com
`LEGENDARY → shadow-warning/40` e `RARE → ring-secondary/50`.

**Decisão.** Raridade usa `tier-common|rare|epic|legendary|mythic` para anel, brilho e
gradiente. A separação é verificada pela revisão da migração e pelo guia de estilo.

**Justificativa.** O `DESIGN.md` reserva brilho e gradiente para conquista. Se uma carta
lendária usa a cor de "atenção", o painel de revisão e a coleção passam a falar a mesma
língua visual para coisas diferentes — e o participante perde a pista de que aquilo é
mérito, não pendência.

**Consequências.** Qualquer componente novo de gamificação deve usar `RarityBadge` ou os
tokens `tier-*`; a revisão disso está no guia de estilo.

### ADR-070 — Unificação de primitivo por delegação, preservando o contrato de quem usa

**Contexto.** Dois conjuntos de campos de formulário coexistindo (painel e sistema).

**Decisão.** O componente do painel passa a **usar os controles do sistema**
(`Input`/`Select`/`Checkbox`) com moldura própria de rótulo envolvente (sem
`htmlFor`/`id`), mantendo a assinatura pública (`label`/`name`/`hint`).

**Justificativa.** O objetivo é uma única aparência e uma única regra de acessibilidade,
não uma única assinatura — e há uma restrição concreta: o painel tem vários formulários
na mesma página repetindo nomes de campo (`capacity`), então ids derivados de `name`
colidiriam e o `for` apontaria para o controle de outro formulário. Rótulo envolvente
nomeia o controle sem id único; `Field` + `fieldAria` continua sendo o caminho
recomendado para telas novas, que têm um formulário por página.

**Consequências.** Duas formas de rotular convivem, com a razão documentada em cada
arquivo. Texto de destaque e dica ficam idênticos aos do sistema; o que muda é só a
estratégia de associação rótulo↔controle.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | `card-visual.tsx` ficou com carta LENDÁRIA usando a cor de "atenção" e RARA usando "informação" | A migração mecânica mapeia por matiz, e âmbar/azul significam coisas diferentes em gamificação e em revisão | Revisão do log de substituições antes de considerar a migração concluída: raridade foi para `tier-legendary`/`tier-rare`. É o registro que sustenta a ADR-068 |
| 2 | A catraca reprovou 53 entradas obsoletas depois da migração | As listas de dívida descreviam o estado ANTERIOR; o teste exige que a lista só possa encolher | Mapas zerados: o mecanismo passa a ser proibição absoluta, e a dívida quitada virou histórico nesta documentação |
| 3 | `text-[11px]` → `label-caps` exigiu conferir se o elemento era mesmo metadado | `label-caps` carrega `text-transform: uppercase`; aplicá-lo a um valor de dado deixaria o conteúdo em caixa alta | O mapa levou os 61 usos para `text-xs` (o padrão seguro) e `label-caps` ficou reservado a rótulos, na revisão caso a caso |
| 4 | **E2E:** a jornada da FASE 7 estourou o tempo em `getByTestId('create-room').getByLabel('Capacidade')` | Ao unificar os campos do painel, usei `htmlFor={name}` + `id={name}`. O painel tem vários formulários na MESMA página repetindo `capacity`, então o documento ficou com **ids duplicados** e o `for` podia resolver para o controle de outro formulário — o rótulo visível não era mais o rótulo daquele campo | O campo do painel usa **rótulo envolvente sem id** (a mesma estratégia que já funcionava), com os controles do sistema; `Field` + `fieldAria` (id único) ficou como o caminho das telas novas, com a razão documentada nos dois arquivos |

---

## 6. Evidência de verificação

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 775 testes / 27 arquivos
npx vitest run tests/unit/design-system-guard.test.ts
                             → 5 testes, com RAW_COLOR_DEBT e ARBITRARY_TEXT_DEBT vazios
npm run build                → "Compiled successfully"
npm run db:verify            → "Contrato íntegro."
npm run test:e2e             → 42 testes / 9 arquivos
```

A prova da fase é a própria trava: ela **passa com os mapas vazios**, o que significa
que não existe mais nenhuma ocorrência de paleta crua, hexadecimal ou tamanho
arbitrário em `src/app` e `src/components`.

---

## 7. Comandos operacionais

```bash
docker compose --profile app up -d --build web
npx vitest run tests/unit/design-system-guard.test.ts   # a catraca (agora sem dívida)
# Conferência visual: /superadmin/design   (guia de estilo vivo)
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Dívida | Impacto | Encaminhamento |
|---|---|---|---|
| 1 | Telas das fases 3–10 foram **recoloridas e tipografadas**, mas mantêm a estrutura própria (cartões e cabeçalhos escritos à mão em vez de `PageHeader`/`SectionHeading`) | A aparência já é consistente; a **composição** de algumas telas ainda é heterogênea (títulos com pesos e espaçamentos levemente diferentes) | Migração estrutural incremental, tela a tela, sem fase dedicada — cada tela que for mexida adota `PageHeader` |
| 2 | Vários wrappers de página ainda usam `mx-auto max-w-*` herdado de antes do shell | Padding duplicado e largura mais estreita que a do conteúdo do shell | Remover ao tocar em cada página |
| 3 | Tema escuro continua não revisado | `prefers-color-scheme: dark` segue no claro | Definir a escala escura completa quando o produto decidir suportá-la |
| 4 | Componentes com `font-mono` ainda não usam `code-data` | Perde o `tabular-nums` em algumas listas de dados | Trocar quando a tela for tocada |
| 5 | Sem testes de regressão visual (snapshot de tela) | Uma cor trocada por engano em um componente só aparece em revisão manual | Avaliar Playwright com `toHaveScreenshot` para as telas-exemplo |

---

## 9. Checklist de aceite

| Requisito | Situação |
|---|---|
| Zero cores da paleta crua do Tailwind em `src/app` e `src/components` | ✅ |
| Zero tamanhos de fonte arbitrários | ✅ |
| Zero hexadecimal fora das exceções documentadas (tokens, tema do evento, guia, `global-error`) | ✅ |
| Raridade usando tokens de `tier-*` (não de estado) | ✅ |
| `Field`/`SelectField`/`CheckboxField` do painel delegando aos primitivos do sistema | ✅ |
| Tema do evento sem reimportar o Tailwind | ✅ |
| Catraca com dívida zerada (proibição absoluta) | ✅ |
| 42 testes E2E preservados (nenhuma quebra de contrato de teste) | ✅ |
| Documentação do sistema atualizada com o estado final | ✅ |
