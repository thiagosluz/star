# FASE 58 — As telas novas entram no portão de acessibilidade

> **Estado: ENTREGUE** — `/demandas` (nas três vistas) e `/superadmin/denuncias` varridas pelo
> `axe` no portão WCAG AA, com o defeito de contraste encontrado **corrigido** (não isentado).

## 1. Sumário executivo

O portão de acessibilidade nasceu na dívida **H5** (FASE 50) com seis telas, ficou **sem isenções**
na FASE 52, e desde então o sistema ganhou telas que ele não via. Esta fase fecha o buraco para as
duas últimas: o **quadro de demandas** (FASE 57, que passou a ter três vistas) e a **fila de
denúncias** da plataforma (FASE 56, dívida E62).

| Entrega | Onde |
|---|---|
| Varredura das TRÊS vistas de `/demandas` (Kanban, Gantt, calendário) | `tests/e2e/accessibility.spec.ts` |
| Varredura de `/superadmin/denuncias` | o mesmo arquivo (bloco de plataforma) |
| Fixtures com CONTEÚDO: quadro com barra, marco e "sem data"; fila com uma denúncia | `beforeAll` do mesmo arquivo |
| **Defeito corrigido**: contraste dos dias do mês vizinho no calendário | `src/components/admin/demand-calendar.tsx` |

Números: o portão passa de **6 para 11 testes**, e a lista de isenções **continua vazia**.

## 2. O problema: portão que não cobre a tela nova não é portão

A varredura responde "esta tela pode ser usada por quem navega por teclado ou leitor de tela?" — e
a resposta só existe para as telas que alguém **lembrou de listar**. Nas duas fases anteriores
(F56 e F57) telas novas nasceram fora do portão, e o custo disso é conhecido: a FASE 50 achou
contraste de **2,89:1** numa tela que já existia havia 20 fases.

Duas armadilhas específicas desta fase:

1. **varrer a rota, e não a vista.** `/demandas` é uma rota com TRÊS superfícies — Kanban, Gantt e
   calendário. Varrer só a URL padrão deixaria fora exatamente o que a FASE 57 criou (eixo de dias,
   barra, célula de mês);
2. **varrer tela vazia.** Fila de denúncias sem denúncia e Gantt sem demanda passam no `axe` e não
   provam nada: o que quebra acessibilidade é o conteúdo (rótulo do formulário de decisão, texto
   pequeno da barra, célula com prazo).

As fixtures desta fase existem para as duas telas terem o que mostrar: **três demandas** (uma barra
que atravessa o período, um marco de um dia e uma **sem prazo** — a faixa "sem data") e **uma
denúncia** na fila, com o formulário de decisão.

## 3. Decisões técnicas

- **Uma varredura por vista, com nome próprio.** Cada teste diz QUAL vista falhou
  (`quadro de demandas · Gantt`), e não "a tela de demandas" — a mensagem do portão tem de levar
  direto ao componente.
- **A fixture é criada pelos SERVIÇOS** (`createDemand`, `reportPublicProfile`), como o seed faz:
  a tela é varrida no estado em que o uso a produz, e não num HTML montado à mão.
- **A isenção continua sendo por NÓ e a lista continua vazia.** O defeito encontrado foi corrigido
  no componente; isentar o nó teria trocado um problema de leitura por um número verde.
- **O portão não cobre o sistema inteiro, e não finge que cobre.** São 10 telas escolhidas por
  densidade (as que concentram filtro, formulário e tabela), não as ~85 páginas. A cobertura cresce
  a cada fase — e a lista está no arquivo, à vista de quem for mexer.

## 4. ADRs

### ADR-317 — A varredura cobre a VISTA, e a tela nova entra no portão na fase que a cria

**Contexto.** O portão lista telas por URL. A FASE 57 transformou uma tela em três vistas na mesma
rota, e a FASE 56 criou uma tela de plataforma; nenhuma das duas entrou na lista.

**Decisão.** Cada **vista** com desenho próprio é um teste — `/demandas` entra três vezes (Kanban,
Gantt, calendário), porque cada uma desenha o que a outra não desenha. E a regra passa a valer para
a frente: **tela nova entra no portão na fase que a cria**, não numa dívida depois.

**Consequências.** O portão cresce com o produto (6 → 11 testes) e continua sendo amostra
declarada, não varredura total: as telas escolhidas são as densas, e a lista é explícita para
ninguém supor cobertura que não existe. O custo é ~40 s de suíte.

### ADR-318 — Atenuação de conteúdo inativo vai na BORDA e no FUNDO, nunca no alfa do TEXTO

**Contexto.** O calendário da FASE 57 atenua os dias do mês vizinho com `text-muted-foreground/60`
— o token com 60% de alfa. A varredura mediu **2,9:1** sobre `bg-muted/20`, abaixo do mínimo AA
(4,5:1 para texto pequeno), em quatro nós.

**Decisão.** O texto usa o token **sem alfa** (`text-muted-foreground`), e a atenuação fica onde não
custa leitura: **borda tracejada** e **fundo** mais claro. Vale para toda célula "fora do período":
a data está na tela, então ela é legível.

**Consequências.** O calendário continua distinguindo o que é do mês e o que é vizinho, sem
sacrificar leitura — e o padrão fica dito para as próximas vistas com célula inativa. Texto
pequeno com alfa é o caminho mais curto para reprovar o portão: o alfa reduz o contraste do TEXTO,
que é justamente o que a WCAG mede.

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| **`color-contrast` (serious) em 4 nós** — os dias 27 a 30 do mês anterior, `2,9:1` (mínimo 4,5:1) | `text-muted-foreground/60`: o token de texto com 60% de alfa sobre `bg-muted/20`. O alfa escurece o texto em direção ao fundo — e a célula "inativa" é onde a tentação de esmaecer o texto é maior | Texto no token **sem alfa**; a atenuação foi para a **borda tracejada** e o **fundo** (ADR-318). O portão voltou a 11/11 **sem isenção nova** |
| A varredura não cobria as telas das duas fases anteriores | O portão é uma LISTA, e lista não se atualiza sozinha: a FASE 57 mudou uma rota em três vistas e a FASE 56 criou uma tela de plataforma, sem que nenhuma entrasse | As quatro varreduras entraram, e a regra ficou escrita (ADR-317): tela nova entra no portão na fase que a cria |

## 6. Evidência de verificação

```text
npm run lint ................... 0 erros, 0 warnings
npm run typecheck .............. 0 erros
npm test ....................... 143 arquivos · 2858 testes passando
npm run build .................. Compiled successfully
npx playwright test tests/e2e/accessibility.spec.ts ... 11 passed (era 6)
   ├ telas públicas .................................... 4 passed
   ├ painel e diretório de participantes ............... 2 passed
   ├ demandas · Kanban / Gantt / Calendário ............ 3 passed  (novos)
   └ fila de denúncias (/superadmin/denuncias) ......... 1 passed  (novo)
npx vitest run tests/unit/design-system-guard.test.ts .. 5 passed
```

Antes da correção, a mesma varredura acusava: `1 failed` (calendário, `color-contrast`, 4 nós).

## 7. Comandos operacionais

```bash
# O portão inteiro (~40 s)
npx playwright test tests/e2e/accessibility.spec.ts

# Só as telas novas
npx playwright test tests/e2e/accessibility.spec.ts -g "demandas|denúncias"
```

Para **acrescentar** uma tela ao portão: crie a fixture no `beforeAll` (com CONTEÚDO — a tela
vazia não prova nada), navegue com `signInAs` + `page.goto`, espere o elemento que identifica a
tela e chame `expectNoCriticalViolations(page, '<nome legível> (<url>)')`. Se o `axe` reprovar,
**corrija o componente** — `ISENCOES` é para exceção medida e justificada, com teto de duas.

## 8. Dívidas técnicas

Nenhuma dívida nova. O limite declarado continua: o portão cobre **10 telas escolhidas por
densidade**, e não as ~85 páginas do sistema — a cobertura cresce por fase (ADR-317), e a lista
está à vista em `tests/e2e/accessibility.spec.ts`.

## 9. Checklist de aceite

- [x] `/demandas` varrida nas TRÊS vistas (Kanban, Gantt, calendário), cada uma como teste próprio
- [x] `/superadmin/denuncias` varrida com uma denúncia na fila (o formulário de decisão em cena)
- [x] As fixtures são criadas pelos serviços reais (`createDemand`, `reportPublicProfile`)
- [x] O defeito de contraste encontrado foi CORRIGIDO no componente, sem isenção nova
- [x] A lista de isenções continua **vazia** (teto de duas, preso por teste)
- [x] `npm run lint`, `npm run typecheck`, `npm test` e o guard do design system verdes
- [x] O portão passa 11/11 com o container reconstruído
