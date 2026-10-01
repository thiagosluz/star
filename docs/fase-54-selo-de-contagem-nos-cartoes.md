# FASE 54 — O selo de contagem nos cartões

> **Escopo definido pelo humano:** *"o selo de contagem nos cartões"* — aprovado com a string
> literal **APROVADO: AVANÇAR**, logo depois da FASE 53 (painel de prontidão e grade de áreas).

---

## 1. Sumário executivo

| Entrega | O que mudou | Onde |
|---|---|---|
| **Selo de contagem** | Cada cartão de área diz **quanto há lá dentro** — "3 chamadas", "nenhuma vaga retida", "publicada" — em vez de só o propósito | Grade da raiz do evento |
| **Contagem por EVENTO, em uma leitura** | `getEventAreaCounts({ tenantId, eventId })` conta chamadas, equipes, patrocinadores, palestrantes, demandas abertas, crachás e certificados na **mesma transação de tenant** | `src/lib/events/event-area-counts.ts` |
| **A frase é regra de domínio** | `eventAreaMetric(areaId, contagens)`: singular, plural, zero com sentido, `null` = **sem selo** | `src/domain/events/event-areas.ts` |
| **A fila não é contada duas vezes** | As vagas retidas vêm do número que a tela **já calculou**; o serviço devolve `null` nesse campo, de propósito | Página do evento |

**Números da fase:** 1 serviço novo, 1 arquivo de domínio estendido (não novo), 1 tela alterada,
**8 testes de unidade** + **5 de integração** novos, 3 asserções novas no E2E. **Nenhuma migração.**

---

## 2. O problema mais difícil: um número que mente é pior que número nenhum

Escrever `{n} itens` no cartão é trivial e **prejudica o produto**. O selo é a única frase da tela
que o organizador lê **sem clicar**, e por isso cada decisão dele foi sobre não enganar:

| Armadilha | Por que era mentira | O que ficou |
|---|---|---|
| Zero tratado como "sem dado" (`{n \|\| ''}`) | O cartão fica **vazio** e o organizador conclui que o sistema não carregou — quando a resposta é "não há nada, crie" | **Zero aparece**: "nenhuma chamada" |
| `null` tratado como zero (`?? 0`) | A tela afirma "nenhuma chamada" num evento que tem três, só porque a consulta caiu | **`null` = sem selo**; zero é "contei e não há" |
| `{n} chamadas` para `n = 1` | "1 chamadas" faz o produto parecer quebrado no **primeiro** uso, que é o que decide a confiança | Singular e plural por substantivo |
| Contar a INSTITUIÇÃO em vez do evento | "3 patrocinadores" num evento que não tem nenhum — e o organizador procura onde não há | Todo filtro leva `eventId` |
| Contar o que está fora do ar | Patrocinador inativo e equipe desativada não existem para quem abre o evento | `isActive`, `deletedAt` e `status` entram no filtro |
| Contar blocos da página | "7 blocos" não diz a ninguém se o site está **no ar** | A página ganha **estado**: "publicada" × "em rascunho" |

E a decisão que fecha a coerência: **a fila de confirmações não é contada de novo**. A tela do
evento já calcula `pendingConfirmations` para o painel de prontidão; repetir a conta no serviço
criaria **duas verdades sobre o mesmo fato** — e no dia em que divergissem, o organizador veria
"3 vagas retidas" no selo e "2" no painel. O serviço devolve `null` nesse campo e o chamador
injeta o número que já tem (há teste de integração prendendo exatamente isso).

---

## 3. Decisões técnicas

### 3.1 Uma leitura, na transação de tenant

Sete contagens em `Promise.all` dentro de **um** `withTenant` — uma ida ao contexto de tenant, e a
RLS valendo para todas (há teste que prova que **outra instituição não enxerga nada**, mesmo com o
`eventId` na mão).

### 3.2 Falha de leitura não derruba a tela

O serviço devolve `{ ok: false }` e a página desenha os cartões **sem selo**, a partir de
`EMPTY_EVENT_AREA_COUNTS`. O selo é informação; a tela de gerenciar evento é o trabalho — e o
trabalho não pode parar porque um número não veio.

### 3.3 O domínio conhece a frase, a aplicação conhece o banco

`eventAreaMetric` é função pura sobre `EventAreaCounts`: nenhum import de Prisma, nenhuma consulta,
testável sem infraestrutura. O serviço só **conta** e devolve números crus. Foi assim que 8 dos 13
testes novos rodam em milissegundos e prendem a redação (o que ninguém prende com teste de banco).

### 3.4 Palestrante é da atividade, não do evento

Contar `SpeakerProfile` da instituição inflaria o número com gente que não pisa naquele evento: o
vínculo real é `ActivitySpeaker` → atividade → evento.

---

## 4. ADRs

**ADR-298 — O selo é REGRA DE DOMÍNIO, e `null` significa "não sei".** `eventAreaMetric` decide a
frase; `null` produz **ausência de selo**, e zero produz "nenhuma chamada". Consequência: nunca
existe um selo que afirme um número que o sistema não conferiu — e a diferença entre "não há" e
"não sei" é visível na tela, não só no código.

**ADR-299 — A contagem é do EVENTO e do que está VALENDO, em uma leitura.** Todos os filtros levam
`eventId` e o estado (`isActive`, `deletedAt`, `status`, `completedAt`); as sete contagens vão
juntas na mesma transação de tenant. Consequência: o selo mede o que o organizador vê na tela
seguinte; e o custo de abrir a raiz do evento não cresce com o número de cartões.

**ADR-300 — Fato contado pela tela não é recontado pelo serviço.** As vagas retidas ficam com o
número que a página já calculou (`null` no serviço). Consequência: uma verdade por fato — o selo e o
painel de prontidão não podem divergir, e um teste de integração prende o `null`.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | O teste de integração **não subia** (`Argument 'kind' is missing`) | A semente foi escrita por analogia (`name`, `type`, `tier`) em vez de conferir o schema: `CallForProposals` exige `kind` + `title`, `Sponsor` exige `slug` e **não tem** `tier` (é `tierId`) | Sementes conferidas **campo a campo** contra o `schema.prisma` antes de rodar; a modelagem do teste passou a ler o modelo, não a intuição |
| 2 | `Unknown argument 'color'` em `eventTeam.createMany` | Campo presumido por ser comum em outros modelos | O teste usa **só o que o modelo declara**; o que não importa para a contagem não é preenchido |
| 3 | `Demand` não nascia sem quadro e coluna | A demanda vive num **quadro** (FASE 38) — `boardId` e `columnId` são obrigatórios | A semente cria quadro e coluna; e a limpeza apaga na ordem inversa (demanda → coluna → quadro) |

Nenhuma dessas falhas chegou à tela: todas apareceram no `beforeAll` do teste de integração — que é
exatamente o trabalho dele.

---

## 6. Evidência de verificação

```text
npm run lint ......................... 0 erros, 0 warnings
npm run typecheck .................... 0 erros
npx vitest run tests/unit/f54-selo-de-contagem.test.ts ......... 8 passed
npx vitest run tests/integration/f54-area-counts.test.ts ....... 5 passed
npx playwright test tests/e2e/f53-painel-e-areas.spec.ts ....... 3 passed (com os selos)
npm test ............................. 132 arquivos · 2734 testes
npm run test:e2e ..................... 212 passed · 6 skipped · 0 failed
npm run build ........................ ✓ Compiled successfully
```

---

## 7. Comandos operacionais

```bash
# A frase do selo (singular, plural, zero, nulo) — sem banco
npx vitest run tests/unit/f54-selo-de-contagem.test.ts

# A contagem de verdade (evento × vizinho × outra instituição)
npx vitest run tests/integration/f54-area-counts.test.ts

# O selo na tela
npx playwright test tests/e2e/f53-painel-e-areas.spec.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

**Sorteios ficam sem selo.** A contagem de rodadas de sorteio não foi feita: a relação é via
`Raffle` do evento e não foi medida. O domínio devolve `null` para `sorteios` — o cartão sai limpo,
o que é honesto, mas é a única área da grade sem número.

**Palestrantes conta VÍNCULOS, não pessoas distintas.** `activitySpeaker.count` conta participações
em atividades: quem dá duas palestras aparece duas vezes. O rótulo ("N palestrantes") pode exagerar
em eventos com poucos palestrantes e muitas sessões. Distinguir pessoas exige `distinct` na
consulta — é a próxima melhoria natural deste selo, junto com os sorteios.

**O selo não se atualiza sozinho.** Ele é renderizado com a página (server component): quem
confirma uma vaga na tela de confirmações e volta vê o número novo, mas não há atualização ao vivo.
É o mesmo contrato do painel de prontidão (ADR-295).

---

## 9. Checklist de aceite

- [x] **Selo em cada cartão** de área, com a contagem daquele evento
- [x] **Zero aparece** ("nenhuma chamada") em vez de sumir
- [x] **`null` não vira zero** — não conferido significa **sem selo**
- [x] **Singular e plural** corretos por substantivo ("1 chamada" × "2 chamadas")
- [x] Contagem **do evento**, e só do que está valendo (inativo, excluído e desativado fora)
- [x] **Uma leitura** por tela, na transação de tenant (RLS provada por teste)
- [x] A **fila de confirmações** usa o número da própria tela — sem segunda verdade
- [x] **Falha de leitura não derruba a tela** (cartões sem selo)
- [x] A página ganha **estado** ("publicada" × "em rascunho"), não contagem
- [x] 8 testes de unidade + 5 de integração + 3 asserções E2E, verdes
- [x] Nenhuma migração; nenhuma tela além da raiz do evento alterada
