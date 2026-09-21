# FASE 30 — Sorteio ao vivo, em rodadas

> **Tema:** o sorteio deixou de ser **um** momento. A operação pediu o que o palco faz
> de verdade — sortear o primeiro brinde, depois o segundo, cada um com o seu prêmio e
> o seu patrocinador —, e pediu que a página do telão existisse **antes** da apuração,
> com uma roleta passando nomes para dar o suspense do anúncio.
>
> O pedido do humano, nas palavras dele: *"a página do sorteio para o telão está sendo
> criada depois que já foi sorteado, o que não faz muito sentido… a ideia é que essa
> página esteja sendo exibida em um telão… e rolar alguma animação para passar nomes
> para dar essa impressão de sorteio"*; *"pode ter um mesmo ganhador para o mesmo
> sorteio, não sendo sorteado ao mesmo tempo, adicionando um novo ganhador a um
> sorteio… queria uma opção de fazer em momentos separados"*; *"acrescentar um campo
> opcional para descrever o prêmio e escolher patrocinador já cadastrado que deu"*.

---

## 1. Sumário executivo

| Entrega | Item | Arquivo-chave |
|---|---|---|
| **Rodadas**: cada sorteio tem N momentos, cada um com o próprio compromisso, semente, lista e resultado assinado | Rodadas | `round-rules.ts`, `raffle_rounds` (migração `20260921190000`) |
| **"Criar para o palco"**: o sorteio nasce em rascunho, com a rodada 1 preparada — o telão tem o que mostrar ANTES da apuração | Operação | `createRaffleForStageAction`, `raffle-console.tsx` |
| **Preparar a próxima rodada** (semente nova, prêmio novo) e **sortear a rodada** pela tela | Operação | `prepareRound`, `drawRound`, `raffle-history.tsx` |
| **Roleta no telão**: passa os nomes REAIS da lista publicada, desacelerando, e para no ganhador — depois do resultado assinado | Palco | `raffle-stage.tsx`, `globals.css` §7.1 |
| **Prêmio e patrocinador por rodada** (opcionais), anunciados na parede e no resultado | Anúncio | `prizeFields`, `normalizePrizeTitle`, telão e resultado |
| **Posições que continuam** entre as rodadas (a entrega do prêmio é por posição, desde a FASE 16) | Rodadas | `drawRound` (`firstPosition`) |
| **Ninguém ganha duas vezes no mesmo sorteio** — no domínio (motivo dito na tela) e no banco | Rodadas | `sameRaffleWinnerIds`, `loadRaffleWinnerIds` |
| **Payload versão 4**: o documento assinado declara QUAL rodada descreve | Auditoria | `raffle-rules.ts` |
| **Auditoria por rodada**: uma seção por momento, com o compromisso, a lista e a reprodução de cada uma | Auditoria | `auditoria/page.tsx`, `raffle-audit.tsx` |
| **Resultado público por rodada**, com o prêmio de cada momento | Público | página do resultado, `raffle-results.tsx` |
| **Ao vivo por rodada**: a assinatura do fluxo muda quando a RODADA muda (o status do sorteio não basta) | Palco | rota `.../ao-vivo` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **5** — 1 de domínio (`round-rules`), 1 migração (`20260921190000_raffle_rounds`), 2 de teste, 1 documento de fase |
| Arquivos alterados | **13** desta fase + 6 que a FASE 29 criou e esta revisou (telão, auditoria, painel do palco, rotas públicas) |
| Migrações | **1** — `20260921190000_raffle_rounds` (tabela `raffle_rounds` + `raffle_winners."roundNumber"` + backfill da rodada 1) — total **24** |
| Permissões | 58 (nenhuma nova: as rodadas usam `event:manage`, o telão segue público) |
| Tabelas de tenant | **38** sob RLS + FORCE (a nova entra pelo `db:rls`, conferida pelo `db:verify`) |
| ADRs | **144 … 147** (a próxima é a 148) |
| Testes novos | 24 unitários + 14 de integração + 1 E2E reescrito e ampliado = **38 novos; o E2E total segue 97** |
| Testes | **1531** (Vitest, 64 arquivos) · **97** (Playwright E2E) |
| Defeitos reais encontrados pelos testes | **4** (telão preso na rodada 1, revelação com dados antigos, rodada 1 sem procedência na trilha, formatação do serviço reescrita por `prettier`) |
| Dívidas quitadas | nenhuma deste levantamento — o escopo veio do humano; a fase declarou **E38** e **E39** |

---

## 2. Revisão da FASE 29: **o telão que nascia sorteado**

O defeito que o humano relatou tem uma causa exata, e ela não estava no telão.

A FASE 29 entregou a página do palco e a rota de ao vivo, e o teste E2E dela passava.
O que ninguém tinha notado é que **o console de sorteios só tinha uma porta**:
`createAndDrawRaffleAction` — "Sortear agora", que cria **e** apura no mesmo envio. Não
existia, em lugar nenhum da interface, um caminho que criasse um sorteio em rascunho.

Consequência prática: o telão — que existe para ser projetado **antes** do anúncio,
enquanto o público chega — só era alcançável com um resultado já apurado. A tela que
mostra o compromisso e a contagem ao vivo era, na vida real, uma tela de resultado.

O E2E não pegou porque **ele mesmo montava o rascunho por escrita direta no banco**
(`tx.raffle.create({ status: 'DRAFT', … })`). O cenário provava que a página funciona
com um rascunho; não provava que um rascunho era alcançável por quem opera. É a
armadilha 58 numa roupa nova: **fixture que escreve o estado esperado esconde o
caminho que produz esse estado**.

A correção não foi cosmética: a FASE 30 acrescentou o caminho que faltava ("Criar para
o palco") e reescreveu o cenário E2E para percorrê-lo pela TELA — criar, projetar,
apurar com a parede aberta, preparar a próxima rodada e apurar de novo.

---

## 3. O problema mais difícil: **a prova não podia continuar sendo uma só**

A FASE 29 fez a apuração gravar a lista publicada e assinar o hash dela (payload v3). O
raciocínio era: *o hash do resultado prova que o registro não mudou; a semente revelada
permite refazer a conta*.

Com **duas** rodadas, esse raciocínio quebra em um ponto que não é óbvio: a semente é
**revelada** em cada apuração. Se as duas rodadas usassem a mesma semente, quem lesse a
revelação da primeira — no telão, com a plateia olhando — calcularia os ganhadores da
segunda antes do anúncio. A prova de uma rodada destruiria o suspense da seguinte.

Três decisões caíram juntas:

1. **Cada rodada tem a própria semente**, com o próprio compromisso publicado antes
   dela (`raffle_rounds."seedCommitment"`, selo e versão da chave na mesma linha). A
   rodada 1 do histórico foi **copiada** para a tabela nova pela migração, com os
   mesmos valores que estavam em `raffles`;
2. **O documento assinado passou a declarar o momento** (payload v4, com
   `roundNumber`). Sem isso, dois documentos de rodadas diferentes seriam
   indistinguíveis — e trocar o resultado da rodada 2 pelo da 1 **conferiria
   perfeitamente**;
3. **As colunas de semente/lista em `raffles` ficaram congeladas** como legado. A
   migração copia e o código novo não escreve mais nelas; a fonte de verdade é a
   rodada. Duas fontes de verdade para a mesma prova fariam a rodada 2 sobrescrever o
   que a auditoria lê da rodada 1.

O que **não** mudou: as **posições** continuam sendo do SORTEIO, e não da rodada. A
segunda rodada entrega a posição 2 (ou 3, se a primeira deu dois brindes), e a entrega
do prêmio — registrada por `positionId` desde a FASE 16 — atravessa as rodadas sem
mudar de regra. Reiniciar a numeração em "1º" faria o balcão entregar o prêmio errado.

---

## 4. Decisões técnicas

### 4.1 Preparar é diferente de apurar, e a ordem é do domínio

`canPrepareRound` recusa preparar uma rodada enquanto houver outra preparada e não
apurada (*"A rodada 2 já está preparada e ainda não foi apurada"*): dois compromissos
no ar sem dizer qual está valendo deixariam o telão sem saber o que anunciar — e o
público, sem saber o que está concorrendo.

`canDrawRound` recusa apurar rodada já apurada (`ROUND_DRAWN`) e apurar sem rodada
preparada (`NO_ROUND` → código de serviço `NO_PENDING_ROUND`, e não `NOT_FOUND`: a
mensagem diz *"prepare a próxima rodada antes de apurar"*, que é a ação que resolve).

**Por que preparar existe**: o compromisso precisa ser publicado **antes** do resultado
existir. A rodada 1 nasce com o sorteio; as seguintes nascem do botão "Preparar próxima
rodada", com prêmio e contagem próprios.

### 4.2 Quem ganhou não volta — e o motivo dito na tela é o certo

A regra `sameRaffleWinnerIds` entrou **antes** do piso de minutos na cadeia de
exclusão. A ordem importa para a explicação: quem ganhou a rodada 1 tem 90 minutos e
sairia como *"abaixo do piso"* se o filtro de minutos viesse primeiro — uma explicação
errada sobre um fato correto. O motivo é *"Já ganhou uma rodada anterior deste
sorteio."*

No banco, o índice único `(raffleId, userId)` continua sendo a última linha de defesa —
a corrida entre duas rodadas apuradas no mesmo instante perde no `INSERT`, e a
transação inteira é desfeita.

### 4.3 A roleta é apresentação, e a tela diz isso

A animação **não** sorteia. O resultado é apurado e assinado no servidor quando alguém
clica em "Sortear a rodada N"; a roleta começa **depois**, passa os nomes da **lista
publicada daquela rodada** (gente que concorreu de verdade, mascarada pela regra de
sempre) e para no primeiro ganhador.

- **Nomes reais, não inventados**: quem está na sala vê o próprio nome passar, e a roda
  para em alguém que estava no páreo. Inventar nomes seria mais fácil e daria a
  impressão de um sorteio sobre gente que não concorria;
- **Determinística**: a sequência é um passo fixo sobre a lista (não `Math.random`), então
  o mesmo telão mostra sempre a mesma sequência — a animação não é uma segunda fonte de
  aleatoriedade disfarçada de sorteio;
- **Interrupção**: `prefers-reduced-motion` revela direto, sem roleta;
- **Quem chega tarde** (abre o link depois da festa) vê o resultado sem esperar o
  suspense: a roleta só roda quando a apuração é percebida **ao vivo** pelo fluxo.

### 4.4 O prêmio é anúncio, não entrada do sorteio

`prizeTitle`, `prizeDescription` e `sponsorId` ficam na **rodada** e entram na trilha de
auditoria, mas **não** no documento assinado (ADR-145). Corrigir "Fone Bluetooth" para
"Fone Bluetooth JBL" depois da apuração não pode invalidar um resultado que o público
já viu. O que é assinado é o que **decide** o sorteio: semente, lista, minutos e
posições.

O patrocinador é escolhido entre os já cadastrados no evento (`Sponsor`), e um id de
outro evento é recusado com `NOT_FOUND` — a checagem é feita na mesma transação, com o
`eventId` vindo do SORTEIO (não do formulário).

### 4.5 O ao vivo passou a assinar por RODADA — e a parar só no cancelamento

A rota `.../ao-vivo` relia o estado a cada amostra (armadilha 63), mas **parava de
amostrar** quando o sorteio deixava de ser rascunho. Com rodadas, isso é um defeito duplo:
o sorteio fica `DRAWN` **para sempre** depois da primeira apuração.

1. **A assinatura do fluxo passou a incluir a rodada** (pendente e última apurada), porque
   o status do sorteio não muda mais entre a rodada 1 e a 2;
2. **O fluxo só encerra no cancelamento.** A cadência passou a ser adaptativa: 3 s com
   rodada pendente (a contagem de elegíveis muda com o credenciamento) e 10 s sem ela —
   nesse ritmo, a única coisa que a parede pode ver mudar é uma rodada NOVA, que o
   operador prepara no meio do evento. Parar de amostrar ali deixava o telão preso no
   resultado da rodada 1 enquanto a 2 esperava (o E2E da fase pegou exatamente isso).

**Fluxo ao vivo que reporta um campo que não relê não é ao vivo** — a armadilha 63 valia
para o status; ela valia igual para a rodada, e agora vale também para o CICLO DE VIDA da
amostragem: encerrar cedo um fluxo que ainda pode ter novidade é a mesma classe de erro.

### 4.6 Duas leituras para o compromisso: a rodada em cartaz

O telão mostra o compromisso da rodada **em cartaz**: a preparada (é ela que o público
vai ver ser sorteada) ou, sem pendente, a última apurada. Com uma rodada preparada, o
estado do palco é `AGUARDANDO` mesmo com o sorteio `DRAWN` — ler o status do sorteio
faria a parede exibir o resultado anterior enquanto o próximo prêmio espera.

---

## 5. ADRs

### ADR-144 — Cada apuração é uma RODADA, com a própria semente e o próprio documento assinado

**Contexto.** O sorteio tinha uma apuração. Premiar de novo exigia criar outro sorteio —
e dois sorteios não se conhecem: o mesmo participante podia ganhar nos dois, e a
"segunda rodada" não tinha relação com a primeira. Além disso, a semente era revelada
na apuração: uma semente única para vários momentos entregaria os ganhadores seguintes
a quem lesse a revelação do primeiro.

**Decisão.** `raffle_rounds` guarda um MOMENTO: número, prêmio, patrocinador, contagem,
compromisso, selo, revelação, versão da chave, lista publicada (snapshot + hash),
resultado assinado e data. `raffle_winners."roundNumber"` diz de que rodada cada
posição veio. As colunas de semente/lista em `raffles` ficam **congeladas** como legado,
e a migração copia o que já existia para a rodada 1.

**Consequências.**

- A prova é por momento: a auditoria tem uma seção por rodada, e a reprodução de cada
  uma usa a sua lista e a sua semente;
- A rodada 1 do histórico nasce com os valores que estavam em `raffles` (payload 1, 2 ou
  3, conforme o que foi gravado), e continua auditável como sempre foi;
- O telemetria de estado passou a ser por rodada (`pendingRound` / `lastDrawnRound`);
- **Custo aceito**: uma tabela a mais, e o sorteio passa a ter duas leituras possíveis
  de "resultado" (o da última rodada e o de cada rodada). A tela escolhe: o cabeçalho
  usa a última, a auditoria usa todas.

### ADR-145 — O prêmio é ANÚNCIO e fica fora do documento assinado

**Contexto.** O pedido incluía descrever o prêmio e nomear o patrocinador. A tentação
era assinar isso também — "tudo o que a rodada tem, entra no hash". Só que o prêmio é
texto de vitrine: uma vírgula errada, um patrocinador grafado errado, um brinde
substituído por outro de valor parecido.

**Decisão.** `prizeTitle`, `prizeDescription` e `sponsorId` ficam na rodada, aparecem no
telão, no resultado e na trilha de auditoria, e **não** entram em `buildResultPayload`.

**Consequências.**

- Corrigir o texto do prêmio não invalida um resultado publicado — e a auditoria não
  acusa "resultado adulterado" por causa de um typo;
- A trilha registra o prêmio anunciado em cada momento, então a mudança de texto fica
  rastreável (quem mudou, quando);
- **O que não pode ser provado pelo hash**: que o prêmio anunciado no telão é o mesmo
  que a trilha guardou. É aceito e declarado: o que decide o sorteio é semente + lista +
  minutos, e é isso que a prova cobre.
- Teste unitário prende a decisão (`o PRÊMIO não entra no documento assinado`), para que
  ninguém "melhore" o payload depois sem perceber o efeito.

### ADR-146 — A roleta usa os nomes da lista PUBLICADA e roda depois do resultado assinado

**Contexto.** O pedido era *"rolar alguma animação para passar nomes fictícios na tela,
para dar essa impressão de sorteio"*. A palavra "fictícios" abria três caminhos:
inventar nomes, sortear no navegador, ou usar os nomes reais dos elegíveis.

**Decisão.** A roleta passa os nomes **reais** da lista publicada daquela rodada
(mascarados pelo servidor), desacelerando, e para no primeiro ganhador. Ela começa
depois que o servidor apurou e assinou.

**Consequências.**

- Quem está na plateia vê o próprio nome passar, e a roda para em alguém que concorreu;
- A animação não é uma segunda fonte de aleatoriedade: a sequência é determinística (um
  passo fixo sobre a lista), e o que está na parede é o que o banco decidiu;
- Uma rodada sem lista publicada (apuração anterior à FASE 29) revela **sem** roleta, em
  vez de inventar nomes;
- **O que a animação não prova**: ela não é o sorteio. Quem quiser conferir usa a
  auditoria — e o documento assinado existe independentemente de a animação ter rodado.

### ADR-147 — Quem ganhou uma rodada não concorre nas seguintes

**Contexto.** Com momentos separados, a mesma pessoa poderia ganhar o primeiro e o
segundo brinde da mesma cerimônia — não por acaso, mas porque os sorteios não se
conheciam. O humano pediu explicitamente que isso não acontecesse.

**Decisão.** Duas camadas: o domínio exclui os ganhadores anteriores **do mesmo
sorteio** com o motivo próprio (`sameRaffleWinnerIds`, checado antes do piso de
minutos), e o banco mantém o índice único `(raffleId, userId)` como última linha.

**Consequências.**

- Suplente **não** conta como ganhador anterior — ele é a reserva de quem não aparecer
  (a mesma decisão da FASE 16, agora por rodada);
- Quando todos os elegíveis já ganharam, a rodada é recusada com `NO_ELIGIBLE` e
  **continua preparada**: o compromisso publicado não se perde, e a organização decide o
  que fazer (nova data, outro recorte);
- Se um dia a regra precisar ser opcional ("pode ganhar duas vezes"), ela vira uma flag
  da rodada — e o lugar de fazê-lo é aqui, com o teste que já existe.

---

## 6. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| O telão só era alcançável com resultado apurado, e o E2E "do telão" passava | O console tinha **uma** porta (`createAndDrawRaffleAction`), e o cenário E2E montava o rascunho por escrita direta no banco: provava a página, não o caminho | "Criar para o palco" (`createRaffleForStageAction`) + cenário E2E percorrendo a TELA (criar → projetar → apurar → preparar → apurar) |
| Depois da rodada 1, o telão ficava preso no resultado e **nunca anunciava a rodada 2** | A rota de ao vivo **parava de amostrar** quando o sorteio deixava de ser rascunho. Com rodadas, o sorteio fica `DRAWN` para sempre depois da primeira — e a rodada seguinte só existe depois disso | A cadência passou a ser adaptativa (3 s com rodada pendente, 10 s sem ela) e o fluxo **só encerra no cancelamento**: um sorteio pode ganhar outra rodada minutos depois |
| O telão revelava a rodada 2 **sem ganhador nenhum**, com o banco já tendo gravado a posição 2 | `rolling` estava nas dependências do efeito do SSE. `setRolling(true)` re-renderiza → o efeito é reexecutado → o `cleanup` cancela o `setTimeout(router.refresh, 250)` recém-agendado. A página nunca era relida, e a roleta revelava com os dados ANTIGOS (rodada 2 ainda "preparada", sem lista) | O "está rolando" passou a ser lido por um `ref` (`rollingRef`), e as dependências do efeito voltaram a ser estáveis — a conexão não é reaberta a cada mudança de fase, e o refresh agendado sobrevive. **Refresh agendado dentro de efeito depende das dependências do efeito** |
| `npm run lint` acusou 3 imports não usados depois de um refactor | Sobras do próprio refactor | Removidos; o lint é a rede que pega isso antes do build |
| O `raffle-service.ts` inteiro trocou de aspas simples por duplas, com 2.000 linhas de diff | `npx prettier --write` **sem configuração no repositório**: o prettier aplicou o padrão dele (`doubleQuote`, largura 80), e o projeto não usa prettier — usa ESLint | Reformatado com `--single-quote --print-width 110` (o estilo real do repositório, conferido contra o `HEAD`), diff de volta às linhas da mudança. **O formatador é o ESLint; prettier só com as flags do projeto** |
| A auditoria da rodada 1 mostrava "Trilha: —" (sem data nem autor do compromisso) | `createRaffle` gravava **um** registro de auditoria (`entityType: 'raffle'`); a procedência do compromisso é lida no registro CREATE da **rodada** (é o que a FASE 30 introduziu para as rodadas seguintes) | `createRaffle` grava também o CREATE da rodada 1; teste de integração prende a procedência (`commitmentRecordedBy`) |
| Teste de integração da trilha falhou com "expected undefined to be defined" ao buscar o registro da rodada | O cenário dependia de registros deixados por provas anteriores, e a listagem é limitada às últimas N entradas da instituição | Cenário monta o PRÓPRIO sorteio e busca pelo `entityId` da rodada (armadilha 62 na prática) |
| `drawRaffle` num sorteio já apurado devolvia `NOT_FOUND` | A mensagem certa ("não há rodada preparada") chegava ao serviço com o código genérico de "não encontrado" | Código próprio `NO_PENDING_ROUND` (e `PENDING_ROUND` para preparar); a tela diz o próximo passo |
| Dois painéis de conferência na mesma página: `getByTestId('audit-run-checks')` casaria com N elementos | Os `data-testid` do painel de auditoria não tinham o número da rodada | Todos sufixados por rodada (`audit-run-checks-1`), e as entradas da lista por rodada **e** índice (`audit-pool-entry-1-3`) |

---

## 7. Evidência de verificação

### 7.1 Bateria (árvore final)

```text
npm run lint                  → 0 erros, 0 warnings
npm run typecheck             → 0 erros
npm test                      → 64 arquivos · 1531 testes passando
npm run build                 → Compiled successfully
npm run db:verify             → Contrato íntegro.
npm run db:verify:isolation   → 9/9 verificações passaram.
npm run db:partitions         → partições do mês atual e dos seguintes criadas
npx prisma migrate status     → 24 migrations · "Database schema is up to date!"
npm run test:e2e              → 97 passed
```

### 7.2 Testes novos

| Arquivo | Testes | O que prende |
|---|---|---|
| `tests/unit/raffle-rounds.test.ts` | 24 | guardas de ordem (uma rodada preparada por vez, rodada apurada não se apura), numeração, prêmio normalizado e **fora** do payload, v4 × v1–v3, exclusão de ganhador anterior com o motivo certo |
| `tests/integration/raffle-rounds.test.ts` | 14 | rodada 1 nasce com o sorteio (e as colunas da raffle ficam nulas), semente nova por rodada, posições que continuam, ninguém ganha duas vezes, `NO_ELIGIBLE` com a rodada ainda preparada, auditoria rodada a rodada, telão anunciando/revelando, assinatura do ao vivo por rodada, resumo do histórico |
| `tests/e2e/raffle-end-to-end.spec.ts` (reescrito e ampliado) | 1 cenário (o total do arquivo segue o mesmo; o que mudou foi a profundidade) | criar para o palco → telão em `AGUARDANDO` com prêmio e compromisso → apurar com a parede aberta → `SORTEANDO` (roleta) → `REVELADO` com confete → **o banco confirma as duas rodadas e as posições 1 e 2** → preparar a rodada 2 → `AGUARDANDO` com o novo prêmio e as anteriores listadas → apurar → posição 2 revelada |

### 7.3 Testes existentes que precisaram mudar (e por quê)

| Arquivo | Mudança | Motivo |
|---|---|---|
| `tests/integration/raffle-audit.test.ts` | passa a ler a RODADA (não a raffle) e a v4 | a prova mudou de lugar; ler a coluna congelada mediria `null` |
| `tests/integration/raffle.test.ts` | `ALREADY_DRAWN` → `NO_PENDING_ROUND`; trilha por rodada | a apuração é da rodada; o segundo clique não é "já foi apurado", é "prepare a próxima" |
| `tests/integration/raffle-end-to-end.test.ts` | selo/chave/versão lidos da rodada | idem |
| `tests/integration/stage-operation.test.ts` | versão da chave do cofre lida da rodada | idem |
| `tests/unit/raffle-audit.test.ts` | versão corrente 3 → 4; v4 no lugar de "v1 e v2" | o documento ganhou o número da rodada |

---

## 8. Comandos operacionais

```bash
# ── O CAMINHO DO PALCO (o que a FASE 30 acrescentou) ──────────────────────────────
# 1. Criar o sorteio para o palco (não apura):
#    /t/<slug>/administracao/eventos/<eventId>/sorteios
#      → preencha o título, o PRÊMIO (opcional) e o patrocinador (opcional)
#      → botão "Criar para o palco"
# 2. Projetar o telão (o endereço existe desde a criação):
#    /t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>/palco
#      → mostra o prêmio anunciado, o compromisso da rodada e a contagem ao vivo
# 3. Apurar a rodada 1 pelo painel ("Sortear agora") — a parede passa pela ROLETA e
#    revela sozinha.
# 4. Preparar a próxima rodada (prêmio e patrocinador próprios) e repetir o passo 3.
#
# ── CONFERIR ─────────────────────────────────────────────────────────────────────
# Auditoria (uma seção por rodada, com a reprodução de cada uma):
#   /t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>/auditoria
# Fora do site, com o documento canônico da lista da RODADA salvo em lista.json:
npx tsx prisma/scripts/audit-raffle.ts --semente <hex> --lista lista.json --vagas 2

# ── O BANCO ──────────────────────────────────────────────────────────────────────
# Rodadas de cada sorteio, com compromisso e resultado:
psql "$DATABASE_URL" -c '
  SELECT r."roundNumber", r."prizeTitle", r."seedCommitment" IS NOT NULL AS "selado",
         r."resultHash" IS NOT NULL AS "apurado", count(w.id) AS "posicoes"
    FROM raffle_rounds r LEFT JOIN raffle_winners w
      ON w."raffleId" = r."raffleId" AND w."roundNumber" = r."roundNumber"
   GROUP BY 1,2,3,4, r.id ORDER BY r."roundNumber"'

# Posições por rodada (a entrega do prêmio continua sendo por POSIÇÃO):
psql "$DATABASE_URL" -c '
  SELECT "roundNumber", position, kind, "deliveredAt" IS NOT NULL AS entregue
    FROM raffle_winners ORDER BY "raffleId", position'
```

---

## 9. Dívidas técnicas e pontos de atenção

| # | Dívida | Impacto | Caminho |
|---|---|---|---|
| **E38** | O prêmio e o patrocinador **não podem ser corrigidos** depois de anunciados: a rodada é imutável, e um typo no texto exige SQL | O anúncio fica errado no telão e no resultado até alguém mexer no banco — justamente o dado que a ADR-145 declarou "corrigível sem invalidar nada" | Uma ação `updateRoundAnnouncement` (prêmio, descrição e patrocinador) gravando na trilha; o payload não muda, então o resultado segue válido |
| **E39** | A roleta tem duração fixa (~3 s) e não pode ser reexecutada nem desligada pelo operador | Se o telão for recarregado no meio do anúncio (ou o operador quiser repetir), a animação não roda de novo — e quem chega depois vê o resultado direto (decisão consciente, mas sem controle) | Um parâmetro no palco (`?roleta=repetir`) e/ou um controle no painel ao lado do "Sortear a rodada" |

Pontos de atenção que **não** são dívidas novas, mas valem registro:

- **O sorteio continua tendo um `status` próprio** (`DRAFT`/`DRAWN`/`CANCELED`) além do
  estado de cada rodada. Ele não é redundante: `CANCELED` cancela o sorteio inteiro, e
  `DRAWN` é o que a página pública exige para publicar. Mas quem lê o banco precisa
  saber que **o resultado** não está em `raffles` desde a FASE 30;
- **A rodada 1 do histórico** tem payload v1, v2 ou v3 (o que estava gravado). A
  auditoria reconstrói na versão GRAVADA — subir a versão no banco faria a conferência
  acusar adulteração em sorteios íntegros;
- **A roleta não inventa nomes** (ADR-146). Numa rodada sem lista publicada, o telão
  revela direto. É a decisão certa e é uma diferença de experiência entre sorteios
  antigos e novos.

---

## 10. Checklist de aceite

- [x] Cada sorteio tem rodadas; cada rodada tem o próprio compromisso, semente, lista e
      resultado assinado (ADR-144)
- [x] A rodada 1 do histórico foi migrada com os MESMOS valores, e continua auditável
- [x] É possível **adicionar ganhadores a um sorteio já apurado**, em momentos separados
      ("Preparar próxima rodada" + "Sortear a rodada")
- [x] As **posições continuam** entre as rodadas (a entrega do prêmio por posição segue
      válida)
- [x] **Quem ganhou uma rodada não concorre nas seguintes**, com o motivo dito na tela
      (ADR-147)
- [x] O sorteio pode ser criado **para o palco** e o telão mostra o compromisso e a
      contagem ANTES da apuração (revisão da FASE 29)
- [x] O telão **rola uma animação** com os nomes reais da lista publicada e para no
      ganhador (ADR-146)
- [x] O telão anuncia o **prêmio** e o **patrocinador** da rodada em cartaz
- [x] Campo **opcional** de prêmio (título e descrição) e **escolha de patrocinador já
      cadastrado** no evento — na criação e em cada rodada nova
- [x] O prêmio e o patrocinador **não** entram no documento assinado (ADR-145)
- [x] A auditoria confere **rodada a rodada**, com a procedência do compromisso (data e
      autor) de cada uma
- [x] O resultado público mostra os momentos separados, com o prêmio de cada um
- [x] O **ao vivo** percebe a apuração de rodadas seguintes (assinatura por rodada)
- [x] Migração escrita à mão, com backfill e `COMMENT`s, aplicada por
      `npm run db:migrate:deploy` (24 migrações)
- [x] `raffle_rounds` sob RLS + FORCE + policy, no contrato de isolamento
- [x] Testes: 24 unitários + 14 de integração + E2E; **1531** testes Vitest e **97**
      Playwright passando
- [x] Documentação da fase, `AGENTS.md`, `README.md`, `docs/dividas-tecnicas.md` e
      `docs/armadilhas.md` atualizados
