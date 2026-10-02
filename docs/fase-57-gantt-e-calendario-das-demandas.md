# FASE 57 — Gantt e calendário das demandas do evento

> **Estado: EM ANDAMENTO** — vista de Gantt e vista de calendário no quadro de demandas,
> ao lado do Kanban, escolhidas em `?vista=`.

## 1. Sumário executivo

O quadro de demandas (FASE 38) nasceu Kanban: colunas configuráveis, cartões com
responsáveis, prazo e conversa. Kanban responde bem "o que está em cada etapa" e mal duas
outras perguntas que a organização faz todo dia:

- **"o que atravessa o mês, e o que começa antes do que?"** — é o GANTT;
- **"o que vence nesta semana, dia a dia?"** — é o CALENDÁRIO.

Esta fase acrescenta as duas vistas **na mesma tela**, com seletor de vista que preserva
os filtros, sem consulta nova (as três leem o MESMO carregamento do quadro) e sem
JavaScript para navegar.

| Entrega | Onde |
|---|---|
| Régua das duas vistas (janela do eixo, barra, grade do mês) | `src/domain/events/demand-timeline-rules.ts` |
| Uma leitura → três vistas | `src/lib/events/demand-timeline.ts` + `loadDemandBoard` (existente) |
| Seletor de vista | `src/components/admin/demand-view-switcher.tsx` |
| Gantt (eixo de dias, barras, faixa "sem data") | `src/components/admin/demand-gantt.tsx` |
| Calendário (mês, células, contagens) | `src/components/admin/demand-calendar.tsx` |
| Tela do quadro com `?vista=`, `?de=`, `?mes=` | `.../administracao/eventos/[eventId]/demandas/page.tsx` |

## 2. O problema mais difícil: **a barra precisa de um dia, e a demanda não tem prazo**

Duas armadilhas aparecem na primeira hora de quem desenha um Gantt de demandas:

1. **o início.** O modelo tem `startAt` desde a FASE 38, mas o formulário nunca o exigiu —
   quase toda demanda existente tem só `dueAt`. Um Gantt que começasse "hoje" para todas
   seria uma coluna de barras empilhadas, sem informação nenhuma;
2. **o prazo ausente.** Boa parte das demandas internas não tem prazo (é trabalho de
   organização, não compromisso com data).

A decisão foi **não inventar dado**: a barra sem início declarado começa no dia da
CRIAÇÃO e **é marcada como estimada** (borda tracejada e "(início estimado)" no título), e
a demanda **sem prazo não entra no eixo** — ela vai para a faixa "sem data", que diz
quantas são. Um gráfico que desenha um período que ninguém declarou mente sobre o
planejamento, e é exatamente esse o dado que a organização usaria para cobrar.

E o que fica **fora** do período (ou do mês) nunca some: o Gantt devolve `outside` e o
calendário também, com a contagem na tela.

## 3. Decisões técnicas

- **A régua é de DOMÍNIO, não de componente.** As perguntas "o que cabe nesta janela" e
  "em que coluna começa esta barra" são regra, e a conta é entre CHAVES DE DIA no fuso do
  EVENTO — a mesma régua que já decide "atrasada" e "vence hoje" no Kanban
  (`demandSituation`). Com duas implementações, o Kanban diria que vence hoje e o
  calendário desenharia em outro dia (é a armadilha 5 do projeto, outra vez).
- **Datas sem `Date` local.** `daysInMonth` (com a regra dos séculos), `weekdayOf`
  (Sakamoto) e `shiftMonthKey` são puros: a grade do calendário não pode mudar de lugar
  porque o servidor está em UTC, e o teste roda igual em qualquer máquina.
- **Uma leitura, três vistas.** O Gantt e o calendário usam as demandas que o quadro já
  carregou (`loadDemandBoard`): é impossível a vista divergir do Kanban, e nenhuma
  consulta nova entra na tela mais pesada do evento.
- **Navegação por URL.** `?de=` anda o eixo do Gantt e `?mes=` anda o mês do calendário;
  os links de vista PRESERVAM `responsavel`, `equipe`, `situacao`, `busca` e `cartoes`,
  como o "ver mais" da FASE 50 já fazia.
- **O Kanban não muda.** Todo o markup e os `data-testid` do quadro continuam iguais
  quando `vista=kanban` (o padrão) — a fase acrescenta, não substitui.

## 4. ADRs

### ADR-315 — A barra sem início declarado começa na criação, e isso aparece no desenho

**Contexto.** O quadro tem `startAt` desde a FASE 38, mas o formulário nunca o exigiu: a
demanda nasce com prazo e sem início. Um Gantt precisa dos dois lados da barra.

**Decisão.** A barra começa em `startAt` e, quando ele é nulo, no dia da CRIAÇÃO — com
marca visual de início estimado (`estimatedStart` no domínio, `data-estimated="1"` e borda
tracejada na tela). Demanda sem `dueAt` **não entra no eixo**: vai para a faixa "sem data".

**Consequências.** O gráfico mostra todas as demandas sem exigir preenchimento retroativo,
e a estimativa é VISÍVEL — quem olha sabe qual barra foi declarada e qual foi deduzida.
Exigir `startAt` no formulário (a alternativa) mudaria o cadastro e deixaria as demandas
antigas de fora até alguém preencher uma por uma.

### ADR-316 — Uma leitura, três vistas (e a régua do tempo é do domínio)

**Contexto.** Gantt e calendário poderiam ter consultas próprias (`where` por período),
mais rápidas em teoria e sujeitas a divergir do Kanban: filtro aplicado em um lugar, não
no outro; situação calculada com `now` diferente.

**Decisão.** As duas vistas consomem o MESMO `loadDemandBoard` e o recorte de período
acontece no DOMÍNIO (`timelineWindow`/`ganttLayout`/`calendarMonth`), em chaves de dia do
fuso do evento. O que fica fora do recorte é CONTADO (`outside`), nunca escondido.

**Consequências.** É impossível o Kanban e o calendário discordarem, e a fase não
acrescenta consulta à tela mais pesada do evento. Em troca, o recorte é feito em memória:
com o teto por coluna da FASE 50 (`?cartoes=`, até 500) o volume continua o do quadro — e
se um dia o quadro paginar de verdade, o recorte migra para o SQL junto, sem tocar nas
vistas.


## 5. Lições aprendidas

Nesta fase a régua do domínio passou **37 de 37 na primeira execução** — nenhum defeito foi
encontrado por teste no núcleo (janela, barra, grade). As duas correções reais vieram da
REVISÃO do que o briefing não previa, e ficam registradas aqui com a origem declarada:

| Sintoma | Causa raiz | Correção |
|---|---|---|
| **"Filtrar" no Gantt devolvia o Kanban.** O formulário de filtros da tela manda os campos por `GET` e não conhecia a vista: ao filtrar a partir do Gantt, a URL nascia sem `vista` e a pessoa caía de volta no quadro — perdendo a vista em que estava | A vista vivia só no LINK do seletor; o filtro é outro caminho de navegação, e os dois precisam carregar o mesmo estado | `<input type="hidden" name="vista">` quando a vista NÃO é Kanban (no Kanban nada é renderizado: DOM e URL idênticos aos de antes) |
| **O tom por situação existiria em três cópias.** O helper `situationTone` estava solto dentro da página do quadro (F38) e o Gantt e o calendário precisavam do mesmo critério de cor | Duas telas novas + a antiga = três implementações da MESMA régua visual, que divergem na primeira manutenção (armadilha 5) | `demand-situation-tone.ts` como fonte única, com as classes idênticas às de antes — usada pelas três vistas |
| **"Achar o início mais cedo" podia abrir o eixo num período vazio.** A âncora do Gantt considerava toda demanda com `startAt`/`createdAt`, inclusive as SEM prazo — que não entram no eixo | A âncora escolhia entre demandas que a própria vista descarta | `ganttAnchorKey` ignora as sem prazo (só quem vai ser desenhado define a janela) |

| **Nove tamanhos de fonte fora da escala nos componentes novos** (`text-[10px]` ×6 no Gantt, ×3 no calendário): o `design-system-guard` reprovou a árvore, e é a MESMA classe da armadilha 91 | Escrever o Gantt "no olho" (eixo e rótulos de barra) leva a tamanhos que a escala não tem; o guard existe justamente porque a tentação é grande | Trocados por `text-xs` (o menor degrau da escala), com o guard de volta ao verde — e a correção é de CLASSE, sem tocar em comportamento |

E uma decisão que virou garantia: **`now` nasce UMA vez na página** e desce para o serviço. Sem
isso, o cartão (Kanban), a barra (Gantt) e o anel de "hoje" (calendário) poderiam discordar na
virada da meia-noite — três leituras do relógio, três respostas.

## 6. Evidência de verificação

```text
npm run lint ................... 0 erros, 0 warnings
npm run typecheck .............. 0 erros
npm test ....................... 143 arquivos · 2858 testes passando
npm run build .................. Compiled successfully
npx vitest run tests/unit/demand-timeline-rules.test.ts ....... 37 passed
npx vitest run tests/integration/demand-timeline.test.ts ...... 1 passed
npx vitest run (4 arquivos de demandas) ....................... 93 passed
npx vitest run tests/unit/design-system-guard.test.ts ......... 5 passed (depois da correção dos tamanhos de fonte)
npx playwright test f57-vistas-das-demandas demand-board ...... 9 passed (2 + 7, com a imagem reconstruída)
npm run test:e2e (suíte completa, ANTES da correção de fonte) .. 224 passed · 3 failed · 6 skipped
   └ as 3 falhas são do `demand-board.spec.ts`, que passa 7/7 ISOLADO (dívida I3, já declarada:
     interferência na suíte paralela; a rodada levou 14,6 min, contra ~6 min nas anteriores)
```
## 7. Comandos operacionais

```bash
# Kanban (o padrão), com os filtros de sempre
/t/<slug>/administracao/eventos/<eventId>/demandas

# Gantt — o eixo começa em `de` (AAAA-MM-DD) e anda 21 dias por clique
/t/<slug>/administracao/eventos/<eventId>/demandas?vista=gantt&de=2026-10-01

# Calendário — o mês em `mes` (AAAA-MM)
/t/<slug>/administracao/eventos/<eventId>/demandas?vista=calendario&mes=2026-10

# Os filtros valem nas três vistas (e os links de vista os preservam)
...&responsavel=<userId>&equipe=<teamId>&situacao=OVERDUE&busca=crachá
```

Regras de leitura das duas vistas:

- **sem prazo não entra no eixo**: a demanda vai para a faixa "sem data", com o número à vista;
- **a atrasada aparece no dia em que VENCEU**, não no dia de hoje: o calendário conta a
  história do que era para ter acontecido (para "o que está atrasado hoje" existe o filtro
  de situação do quadro);
- **fora do período/mês é contado** (`outside`), nunca escondido;
- **barra com início estimado** é desenhada tracejada e diz "(início estimado)".

## 8. Dívidas técnicas

Nenhuma dívida nova. O recorte das vistas é feito em memória, limitado pelo teto de cartões por
coluna (?cartoes=, até 500) — registrado como CONSEQUÊNCIA no ADR-316, e não como dívida:
quando o quadro paginar de verdade, o recorte migra para o SQL junto, sem tocar nas vistas.

## 9. Checklist de aceite

- [x] A tela do quadro escolhe a vista por `?vista=kanban|gantt|calendario`, com Kanban como padrão
- [x] O Kanban permanece idêntico (markup, `data-testid` e arrastar) quando é a vista ativa
- [x] Os filtros do quadro (`responsavel`, `equipe`, `situacao`, `busca`) valem nas três vistas e são preservados ao trocar de vista
- [x] O Gantt desenha o eixo de dias no fuso do EVENTO e uma barra por demanda que toca o período
- [x] A barra sem `startAt` começa na criação e é MARCADA como estimada
- [x] Demanda sem prazo vai para a faixa "sem data", com contagem
- [x] Barra cortada nas pontas é marcada (`clippedStart`/`clippedEnd`)
- [x] O calendário mostra o mês em semanas de 7 dias, com as demandas no dia do PRAZO e "hoje" destacado
- [x] Fora do período (Gantt) e fora do mês (calendário) são contados na tela
- [x] A navegação (período e mês) é por LINK, sem JavaScript
- [x] `startAt`, `dueAt` e `completedAt` continuam sendo DADO da demanda: a fase não grava situação derivada
- [x] Nenhuma consulta nova: as três vistas leem o mesmo `loadDemandBoard`
- [ ] Bateria completa verde (lint 0, typecheck 0, testes, build, E2E) — preencher na evidência