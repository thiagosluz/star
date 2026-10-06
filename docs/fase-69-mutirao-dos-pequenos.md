# FASE 69 — mutirão dos pequenos

> **Estado: ENTREGUE.** Seis fatias, cinco dívidas quitadas por inteiro (**E86, E82, E83,
> E88 e E84**) e os **quatro pontos de atenção da FASE 68** fechados. O plano que a
> originou é `docs/fase-69-plano.md`.
>
> **A fatia 5 morreu sem escrever nada** e foi absorvida pela fatia 6 (o fechamento). O
> custo real disso é uma das lições da fase (§5.10) — e é a razão de este documento
> existir com os números medidos em vez de com a intenção das fatias.

---

## 1. Sumário executivo

### 1.1 O que a fase entregou

| # | Dívida / ponto | O que mudou | Onde vive |
|---|---|---|---|
| 1 | **E86** | A **margem de deslocamento entre salas** virou **parâmetro da regra pura**, com o padrão **declarado** no domínio (`ROOM_TRAVEL_MARGIN_MINUTES = 15`). Quem termina numa sala e começa em outra com **menos** de 15 minutos entre o fim de um e o início do outro passa a ser avisado — e o aviso diz que o motivo é o deslocamento, com o número no texto. **Margem ZERO reproduz exatamente a régua da FASE 65** (preso por teste), e **não há configuração por evento** | `src/domain/agenda/overlap-rules.ts`, `agenda-rules.ts`, `agenda-view.ts`, `agenda-clash-notice.tsx` |
| 2 | **E82** | O **ranking de revisores** deixou de citar por inteiro quem a moderação ocultou: passou a ler o nome pela fonte única da ocultação (`leaderboardIdentity`, a mesma do ranking de XP), **mascarando a identidade e preservando posição, contagem e elegibilidade** — na lista e no painel de premiação | `src/lib/gamification/achievement-service.ts` |
| 3 | **E84** (por inteiro) | O **claro/escuro do visitante** deixou de pintar dentro do tema do organizador: o escopo do evento passou a **republicar os papéis semânticos da plataforma** no **modo do TEMA** — a mesma régua que a FASE 64 usou na página da instituição | `src/domain/events/event-page-theme-rules.ts`, `src/components/events/theme-scope.tsx` |
| 4 | **E83** | Os **quatro pontos da família** passaram a repetir o **GESTO** até o fato (a régua do ADR-327): as duas teclas e o arrasto no editor de certificado, e a troca de categoria do crachá, que agora repete a sequência inteira (escolher → salvar → recarregar → conferir) | `tests/e2e/certificate-template.spec.ts`, `tests/e2e/f51-credential-badge.spec.ts` |
| 5 | **E88** | A página de **descadastro** (sem login) passou a **perguntar o motivo**: quatro opções em português mais "prefiro não dizer", nenhuma obrigatória e nenhum rádio `required`; o motivo viaja no **mesmo `POST`** da saída e a coluna `reason` — que só era escrita no caminho `MANUAL` — passou a ser gravada no caminho `LINK` | `src/domain/communication/unsubscribe-reason-rules.ts`, `unsubscribe-service.ts`, `unsubscribe-forms.tsx`, aba "Segmentos" |
| 6 | **F68.1** | O evento de demonstração que publica chamadas nasce com `usesCall: true` no `prisma/seed.ts` (§8.6) | `prisma/seed.ts` |
| 7 | **F68.2** | **"Presencial · Online · Híbrido" virou fonte única** no domínio, com o fallback do desenho antigo PRESERVADO; as **seis** cópias (três `<select>` e três etiquetas públicas) passaram a ler de lá, e a catraca varre o `src/` inteiro | `src/domain/events/event-modality-rules.ts` |
| 8 | **F68.3** | O **endereço da sala online apareceu na "minha agenda"**: a MESMA régua e o MESMO serviço da FASE 68, aplicados sobre outra projeção; quem não tem lugar **não recebe o endereço** — ele não existe no HTML | `online-room-service.ts`, `agenda-service.ts`, `minha-agenda/page.tsx` |
| 9 | **F68.4** | O **bloco de LOCAL** (`VenueBlock`) ganhou **linha de base visual** — a captura que não existia porque `?aba=agora` não renderiza blocos | `tests/e2e/f62-regressao-visual.spec.ts` + `evento-bloco-de-local-chromium-win32.png` |
| 10 | Fechamento | A linha de base do **descadastro** foi **medida antes de regerada** (§3.7); o **portão WCAG AA** ganhou o caso do **tema ESCURO do organizador**; `AGENTS.md`, `README.md` e `docs/dividas-tecnicas.md` atualizados | este documento, §6 |

### 1.2 Números da fase (medidos, não estimados)

| O quê | Número | Comparação |
|---|---|---|
| Suíte Vitest | **188 arquivos / 3498 casos, 3498 passando, 0 falhando** | F68 fechou em 181/3410 → **+7 arquivos, +88 casos** |
| Casos novos (Vitest) | **35** em 3 arquivos novos: **17** em `tests/unit/f69-margem-de-deslocamento.test.ts` (E86), **18** em `tests/unit/f69-contraste-do-tema-do-evento.test.ts` (E84), **15** em `tests/unit/f69-motivo-do-descadastro.test.ts` (E88), mais **5** em `tests/unit/f69-e82-ranking-de-revisores.test.ts` e **5** em `tests/integration/f69-e82-ranking-de-revisores.test.ts` (E82) e **20** desta fatia (`f69-rotulos-de-modalidade` 10 + `f69-sala-online-na-agenda` 10) | — |
| Portão WCAG AA | **26 → 28 casos**, `ISENCOES = []` (nenhuma isenção nova) | F68 fechou em 26 |
| Regressão visual | **21 → 22 linhas de base**; **1 criada** (`evento-bloco-de-local`) e **3 regeradas** (`minha-agenda-claro`, `minha-agenda-escuro`, `descadastro`) — todas **medidas antes** | F68 fechou em 21 |
| Migrações | **Nenhuma** — a fase não altera o schema | — |
| ADRs | **3** (ADR-344, ADR-345, ADR-346 — a próxima é a **347**) | F68 fechou em 343 |
| Permissões / tabelas | **66** e **60** — inalteradas | — |
| `AGENTS.md` | **64.594 → 64741 bytes**, abaixo do teto de ~64.800 (§8.5) | o teto real é 65.244 |

---

## 2. O problema mais difícil da fase — e por que ele define o desenho

**O defeito mais grave desta fase era invisível para TODAS as catracas do projeto.**

A dívida E84 dizia, em uma linha, que o token de texto da plataforma desenhado dentro do
tema do organizador media **2,10:1** sobre a `--ef-background` e **1,86:1** sobre o
`.ef-card` — metade do mínimo que o WCAG AA pede para texto pequeno. E o projeto tinha,
naquele momento, um portão de **26 casos** de `axe` **sem nenhuma isenção** que passava.
Os dois fatos são verdadeiros ao mesmo tempo, e a explicação é o problema da fase:

```
    o portão media as telas do evento no tema PADRÃO (claro, `colorMode: 'light'`)
    com o visitante no claro — as duas metades CLARAS do par.
    O defeito vivia na metade que ninguém abria: organizador ESCURO.
```

É a mesma forma do defeito da FASE 66, dita com outras palavras: *o defeito não sobreviveu
por ser sutil — sobreviveu porque a tela onde ele mora não era medida*. Lá a dimensão que
faltava era a **aba**; aqui, o **modo**.

Consertar não bastava, e é isso que define o desenho desta fase: **antes de consertar, a
fase teve de construir o instrumento**. Três instrumentos, na verdade, e cada um nasceu de
uma medição:

1. **A causa raiz teve de ser entendida** — e ela é uma regra do CSS, não um token errado:
   **o `var()` é substituído no elemento onde a DECLARAÇÃO é feita**. O `globals.css`
   declara os apelidos semânticos (`--muted-foreground`, `--card`, `--border`) na **raiz**
   (`globals.css:194-256`), e a página do evento sobrescreve os `--ef-*` num **descendente**
   (`theme-scope.tsx:67` no arquétipo pré-fase). Os apelidos continuam resolvidos na raiz,
   pelo modo do **visitante** — e é por isso que a tinta clara da plataforma caía sobre a
   superfície escura do organizador. Sem essa explicação, o conserto teria sido "trocar os
   tokens dos componentes um a um", que é a correção que volta a quebrar no componente
   seguinte.
2. **O portão ganhou o caso que faltava** (§4, ADR-345 e §6.3): um evento de tema escuro
   varrido pelo `axe`, provado por mutação.
3. **A linha de base visual do bloco de LOCAL nasceu** (§3.6): o `VenueBlock` é onde o
   endereço da sala online aparece, e ele **nunca teve pixel medido** — a única superfície
   do evento nesta suíte era a aba "acontecendo agora", que **não renderiza blocos**. O
   vazamento que a FASE 68 fechou (`Event.onlineUrl` desenhado para qualquer visitante)
   atravessou todas as catracas de imagem sem tocar nenhuma porque não havia imagem dele.

E há a segunda metade do problema mais difícil, que não é técnica: **a fatia 5 morreu sem
escrever uma linha**. Os quatro pontos de atenção da FASE 68 (o seed, os rótulos, o
endereço na agenda e a linha de base do `VenueBlock`) ficaram parados num agente que
explorou e não voltou, e o fechamento os absorveu (§5.10). A fase terminou com o trabalho
feito — mas o custo foi o tempo de uma fatia inteira, e ele é honestamente registrado.

---

## 3. Decisões técnicas (o porquê, e o que foi descartado)

### 3.1 A margem de deslocamento é do DOMÍNIO, com o padrão declarado e sem configuração (E86)

`intervalsClash(a, b, margin)` e `findClashPairs(items, interval, margin)` passaram a
receber a margem, com o **padrão declarado** em `ROOM_TRAVEL_MARGIN_MINUTES = 15`
(`overlap-rules.ts:201`). A regra é pura: sem Prisma, sem Next, sem relógio.

**Por que 15, e não 30.** É a **menor** margem que resolve o caso real da dívida (duas
salas no mesmo prédio, uma sessão que termina e outra que começa no minuto seguinte). 30
minutos acusariam salas **vizinhas** — e aviso que aparece em todo par é o mesmo que aviso
nenhum. O número é **declarado, não medido**: o sistema não conhece distância, andar nem
meio de transporte, e fingir que mede seria pior do que escolher e dizer que escolheu.

**Por que NÃO é configuração por evento.** Seria a alternativa óbvia ("deixe o organizador
escolher"). Ela foi descartada por três razões: (a) o produto não tem onde guardar o dado
sem uma coluna e uma tela novas; (b) uma margem por evento transfere ao organizador uma
decisão que ele não tem como calibrar melhor do que o padrão; e (c) o aviso é **informativo
e nunca bloqueia** — errar para mais custa uma linha de texto, errar para menos custa uma
sessão perdida. Fica registrado como ponto de atenção (§8.3): se alguém quiser a margem por
evento, o caminho é a coluna + a decisão, não um `if` na tela.

**A borda que a fase inteira depende: encostar NÃO é choque SEM margem.** Isso continua
verdade, e é o que a prova dos DOIS lados prende:

| Par | Margem 0 (régua da F65) | Margem 15 (régua da F69) |
|---|---|---|
| 21:00–22:00 e 22:00–23:00 (encostados) | **não** é choque | **é** choque (0 min de folga) |
| 21:00–22:00 e 23:00–00:00 (60 min de folga) | não é choque | **não** é choque |
| 13:00–17:00 e 14:00–15:00 (contido) | é choque | é choque |

A coluna da esquerda é a FASE 65 inteira: `margem zero ≡ régua da F65`, preso por teste em
**9 pares**. Sem essa coluna, "avisar sempre" passaria — e a fase teria trocado um defeito
por outro.

### 3.2 Os rótulos de modalidade: função pura com o fallback PRESERVADO (F68.2)

`"Presencial · Online · Híbrido"` estava digitado à mão em **seis** lugares: três
`<select>` de administração (a mesma lista, na mesma ordem) e três etiquetas públicas (o
mesmo ternário aninhado). Nada divergia hoje — o defeito era o dia seguinte, quando um
quarto valor entrasse num lugar e não nos outros.

A fonte única é `src/domain/events/event-modality-rules.ts`: o mapa, a **lista ordenada** do
`<select>` e `eventModalityLabel(modality)`. Três decisões dentro dela:

- **É função, e não um `Record` exportado**, porque as etiquetas recebem `string` do banco
  (o domínio não importa o ORM) e indexar um `Record` tipado com uma `string` exigiria um
  `as` — o `any` disfarçado desta casa.
- **O fallback é o do desenho antigo**: valor desconhecido, vazio ou `null` cai em
  **Presencial**, exatamente como o ternário fazia. A troca de seis cópias por uma função
  **não podia mudar uma palavra na tela**, e o teste prende isso com o ternário antigo
  reescrito como **oráculo** para uma matriz de 11 entradas (inclusive `'TELEPATIA'`,
  `'online'` e `null`).
- **A união `EventModalityValue` passou a ser declarada UMA vez** (aqui) e
  `event-form-defaults.ts` a **re-exporta**. Duas declarações da mesma união compilam as
  duas e divergem em silêncio — o defeito que a fase veio fechar, na escala do tipo.

A catraca varre **todos** os `.ts`/`.tsx` do `src/` (sem comentários) atrás de
`'Presencial'`/`'Híbrido'` fora do módulo da fonte: qualquer reincidência do ternário cai
nela, porque o ternário antigo **sempre** escrevia uma das duas palavras. `'Online'` fica
de fora de propósito — o console do monitor de credenciamento diz "Online" para o estado da
**rede**, e varrer por ela reprovaria um texto que não tem nada a ver com modalidade.

### 3.3 O endereço da sala online na "minha agenda": a MESMA régua sobre OUTRA projeção (F68.3)

A tela que a pessoa abre cinco minutos antes da sessão era a única das superfícies úteis
sem o endereço. A correção **não** escreveu uma segunda pergunta "quem vê a sala?": ela
reusa `resolveOnlineRoomViewer` (a leitura dos fatos no banco) e a régua do domínio, e a
projeção por atividade passou a ter **um lugar só de decisão** —
`visibleOnlineRoomsByActivity` (`online-room-service.ts`), que `applyOnlineRoomVisibility`
(a página pública, o "acontecendo agora" e a prévia) também usa.

Decisões dentro dela, e o que foi descartado:

- **A lista de espera NÃO vê** — e a régua é *derivada* de `registrationIsLive` menos
  `WAITLISTED`, em vez de uma quarta lista de situações. Quem espera não tem lugar: entregar
  o endereço seria prometer o que o sistema não confirmou e publicar a sala para muito mais
  gente do que ela comporta.
- **A atividade ABERTA é liberada pela inscrição no EVENTO** (`requiresRegistration =
  false`) — a mesma decisão da revisão da FASE 3 para o material de palestrante. Por isso o
  fato `requiresRegistration` viaja na projeção: sem ele, a tela chutaria.
- **O endereço cru sai do serviço e a visibilidade é resolvida na PÁGINA.** A alternativa
  era o serviço receber o visitante — e aí a leitura da grade passaria a depender de uma
  consulta de permissão, duas perguntas de naturezas diferentes na mesma transação. O que
  sai do serviço é o mesmo que já saía para a página pública: dado no servidor, num retorno
  que **nunca** é serializado para o cliente.
- **Não há `hidden`, não há CSS, não há condição de JSX.** O que não pode ser visto não é
  entregue: para quem não tem lugar, o valor não existe no documento — e o E2E prova com
  `page.content()` nos dois sentidos (o endereço **está** para quem tem lugar, e **não
  está** para a lista de espera, para o só-favorito e para o anônimo).
- **Uma leitura a mais no banco é o preço de a pergunta ter UMA resposta.** Ela é a mesma
  que a página pública já faz.

### 3.4 O motivo do descadastro: a frase É o valor gravado, e a saída nunca atrasa (E88)

A coluna `reason` existia desde a FASE 67 e só era escrita no caminho `MANUAL`. Duas
decisões que a fase tomou e que valem como contrato:

- **A frase é o VALOR GRAVADO.** Não há enum de motivo no banco: o que a pessoa lê é o que
  fica registrado. Renomear uma opção, portanto, é **migração de dado** — não é ajuste de
  texto. A regra é pura (`unsubscribe-reason-rules.ts`): valor desconhecido vira `null` e
  **nunca** recusa a saída.
- **A saída é IDEMPOTENTE e o motivo nunca pode atrasá-la.** Sair de novo não regrava o
  motivo, nenhum rádio é `required` e o campo de texto livre é opcional. Um formulário que
  exigisse a justificativa para deixar de receber e-mail seria a barreira que a LGPD e o bom
  senso proíbem: quem quer sair, sai — com ou sem motivo.

### 3.5 O ranking: mascarar DEPOIS de ordenar (E82)

`getReviewerRanking` passou a ler o nome por `leaderboardIdentity`
(`src/domain/gamification/leaderboard-rules.ts:103`), a **mônima** régua da ocultação que o
ranking de XP já usava. Duas coisas NÃO mudaram, e são o ponto: **a posição, a contagem e a
elegibilidade** — quem foi ocultado continua ocupando o seu lugar e contando para o piso; o
que muda é o nome, que sai mascarado.

**A ordem importa, e é a lição (§5.6):** mascarar **depois** de ordenar. O desempate do
ranking é alfabético; mascarar antes faria `Ana Souza` e `Ana Silva` colidirem, e o prêmio
cairia na ordem do banco — um bug que só aparece quando duas pessoas ocultadas empatam.

### 3.6 A linha de base do `VenueBlock`: fixture própria, num evento que já existia (F68.4)

O bloco de LOCAL só é renderizado quando o evento tem **página publicada com o bloco
`VENUE_MAP`** — e a única superfície do evento que esta suíte fotografava é a aba
"acontecendo agora" (`?aba=agora`), que **não renderiza blocos**. A captura foi criada, e
três decisões a sustentam:

- **Um evento da fixture, não a página do evento em geral.** O arquétipo já excluía a página
  do evento por medição: ela carrega a identidade visual que o ORGANIZADOR escolheu, e
  mediria a cor de outra pessoa. O que entra é **um bloco** de **um evento da fixture**, com
  o tema **padrão** (o evento não declara `theme`) e janela **fixa**.
- **A página foi publicada no evento ANTIGO** (`Bienal do Recôncavo`), e não no evento que a
  "minha agenda" e a aba do "agora" medem. Publicar uma página com blocos lá mudaria o
  desenho de **três** linhas de base alheias (a agenda passaria a desenhar o link da sala do
  evento, porque a dona da conta é a EQUIPE e vê tudo): é a lição que a FASE 67 pagou duas
  vezes — **o conserto é de FIXTURE**. O evento antigo já está na vitrine como cartão de
  "Edições anteriores", e o conteúdo do cartão não depende da página nem de `venueAddress`
  (`venueName` continua `null`, que é o campo que o cartão imprime).
- **A página e o bloco nascem pelos SERVIÇOS REAIS** (`ensureHomePage` + `addPageBlock` +
  `savePageSettings`): a validação de tema, a trilha e a versão da página são as do editor.
  Inserir as linhas por `e2eDb` mediria uma página que o editor nunca produziria.

**E uma fixture nova quebra contagens alheias — a lição (§5.11).** O evento de tema escuro
que o portão ganhou (§6.3) nasce **em curso**, porque é a janela que faz a aba do "agora"
desenhar; a página pública da instituição passou a ter **três** cartões no grupo "acontecendo
agora" e a asserção de contagem da FASE 64 (exata, `toHaveCount(2)`) reprovou. O conserto
**não** foi afrouxar para `> 0`: foi atualizar o número **e dizer por quê**, mantendo a
contagem exata — que é justamente a catraca que avisou.

### 3.7 Regerar depois de MEDIR — e as três imagens desta fase

A regra da casa (a F66 e a F67 pagaram por ela) é medir a **caixa dos pixels diferentes**
antes de regenerar. As três imagens desta fase, medidas com o PNG de `diff` que a própria
suíte escreve (o vermelho do `pixelmatch`, contado pixel a pixel):

| Linha de base | Pixels diferentes | Caixa (x, y, largura × altura) | Causa medida |
|---|---|---|---|
| `minha-agenda-claro` | **93.986** | x=320, y=542, **896 × 563** | o TEXTO do aviso de choque mudou (E86): "Choque de horário com …" → "Horários próximos demais para o deslocamento (margem de 15 minutos) com …". O texto mais longo quebra em mais linhas e **empurra a grade** — não é degradê nem token |
| `minha-agenda-escuro` | **108.048** | x=320, y=542, **896 × 563** | a mesma causa, na escala escura |
| `descadastro` | **38.174** | x=0, y=873, **1440 × 561** | o bloco de **motivo** (E88): a página passou de **1440 × 1200** para **1440 × 1460**, e o que muda começa em y=873, onde o formulário ganhou as cinco opções e o campo de texto |

Nenhuma das três foi regerada "para ficar verde": **cada uma tem a caixa medida acima**, e a
imagem nova foi aberta e conferida. E o outro lado da régua: **sete** outras linhas de base
foram reexecutadas contra a árvore nova e **não mudaram um pixel** — entre elas
`evento-aba-agora`, que a FASE 68 tinha acabado de regerar. Quando a FASE 69 mexeu no tema do
evento (E84), a rampa clara republicada é, **valor a valor**, a do `:root` (é o que a catraca
de unidade cobra): a imagem não tinha por que mudar, e não mudou.

---

## 4. ADRs

### ADR-344 — A margem de deslocamento entre salas é PARÂMETRO da regra pura, com o padrão declarado no domínio e sem configuração por evento

**Contexto.** A dívida E86 registrava que o aviso de choque usava `intervalsOverlap` sobre o
intervalo puro: duas sessões em salas diferentes, uma terminando no minuto em que a outra
começa, davam "sem choque". É o caso real de quem tem 15 minutos para atravessar um campus —
e o sistema dizia que estava tudo bem.

**Decisão.** A margem entra como **parâmetro** de `intervalsClash`/`findClashPairs`, com o
padrão `ROOM_TRAVEL_MARGIN_MINUTES = 15` declarado no domínio; o texto do aviso passa a dizer
que o motivo é o **deslocamento** e cita o número (que sai da constante, não da tela).

**Justificativa.** (a) **Regra pura continua pura** — a margem é um número, e quem decide as
bordas continua sendo o domínio, testável sem banco e sem navegador; (b) **margem zero ≡ a
régua da FASE 65**, o que permite à fase provar que não trocou um defeito por outro e deixa
a régua antiga alcançável por quem precisar dela; (c) o número é o **menor** que resolve o
caso real — 30 minutos acusariam salas vizinhas; (d) o aviso **informa e nunca bloqueia**,
então a escolha erra para o lado barato.

**Consequências.** (1) Três testes da FASE 65 mudaram (declarados na §5.4) — a fase antiga
teve de dizer em que régua rodava. (2) A margem **não é configurável por evento** (§8.3).
(3) `intervalsTouch`/`findOverlapPairs` ficaram sem leitor de produção (§8.2).

---

### ADR-345 — Dentro do tema do organizador, a plataforma republica os papéis semânticos no modo DELE: uma autoridade só sobre claro/escuro

**Contexto.** A dívida E84 media **2,10:1** (fundo) e **1,86:1** (cartão) para o texto
secundário da plataforma dentro de um tema de evento **escuro** — e **1,62:1** e **1,35:1**
no caso espelhado (organizador claro com o visitante no escuro). A causa raiz não é um token
errado: **o `var()` é substituído no elemento onde a declaração é feita**. O `globals.css`
declara os apelidos semânticos na **raiz** (`globals.css:194-256`) e o escopo do evento
sobrescreve os `--ef-*` num **descendente** (`theme-scope.tsx:67`) — os apelidos continuam
resolvidos na raiz, pelo modo do VISITANTE.

**Decisão.** O escopo do evento passa a publicar também os **papéis semânticos da
plataforma** (`--muted-foreground`, `--card`, `--border`, …), resolvidos no **modo que o
TEMA declarou** (`data-theme-mode`). É o mesmo movimento que a FASE 64 fez na página da
instituição — lá eles continuam vindo da plataforma porque lá o modo da página **já é** o do
visitante; aqui não é.

**Justificativa.** (a) **Uma autoridade só**: quem decide claro/escuro dentro da página do
evento é `resolveEventThemeMode`, e o mapa de papéis é derivado dela — um quarto estado
("decidir a rampa pela luminância da cor de fundo escolhida") criaria uma **segunda
autoridade** brigando com o `data-theme-mode`; (b) conserta **pela causa**: os componentes
do sistema que vivem dentro do tema (cartão do "acontecendo agora", galeria de palestrantes,
marca de agenda, botão de favorito) param de depender de onde a declaração foi feita;
(c) a identidade do organizador **continua vencendo** (`--ef-*` e a cor primária seguem
dele), e isso está preso por teste e pelo E2E da FASE 61.

**Consequências.** (1) O portão WCAG AA ganhou **dois** casos (§6.3) — o defeito era
invisível para os 26 anteriores; (2) existe um **limite declarado**: um organizador que
declara `dark` e pinta um fundo claro (ou o inverso) fica **fora** da régua, porque a rampa
sai do MODO DECLARADO e não da luminância da superfície — é decisão, não dívida (§8.4);
(3) a catraca nova é `tests/unit/f69-contraste-do-tema-do-evento.test.ts` (**18 casos**),
que copia a rampa presa contra o `globals.css` **valor a valor**, com mutação provada.

---

### ADR-346 — O endereço da sala online é projetado POR SUPERFÍCIE, e o que não pode ser visto não é entregue (nem por CSS, nem por payload)

**Contexto.** O endereço da sala online nasceu como coluna lida por todos e escrita por
ninguém; a FASE 68 lhe deu escritor **e** régua de visibilidade, resolvida no servidor sobre
a projeção. Faltava a superfície em que ele é mais útil — a "minha agenda" — e o risco de
cada superfície nova era reescrever a pergunta "quem vê?", criando uma segunda resposta que
divergiria da primeira no dia seguinte.

**Decisão.** A régua e o serviço da FASE 68 são **reusados**; a projeção por atividade passa
a ter **um lugar só** (`visibleOnlineRoomsByActivity`) consumido pela página pública, pelo
"acontecendo agora", pela prévia **e** pela "minha agenda". O endereço **não é escondido**:
para quem não tem lugar ele não existe no retorno, e portanto não chega ao HTML, ao `Ctrl+U`
nem ao payload de um Client Component.

**Justificativa.** (a) **Segurança por construção**: `hidden`, `display: none` ou uma
condição no JSX deixariam o endereço no documento — a primeira pessoa que abrir o código-fonte
lê o link; (b) **uma resposta só** para "quem vê a sala": a lista de espera não vê, a
inscrição que retém vaga vê, a equipe vê, a atividade aberta é liberada pela inscrição no
evento — e essa resposta é a **mesma** na página do evento, na página da atividade, na aba
do "agora" e na agenda; (c) **o endereço não atravessa fronteira de cliente**: onde a visão
precisa ser serializável (o cartão do "acontecendo agora"), ele viaja num mapa que só o
Server Component consome.

**Consequências.** (1) O E2E prova com `page.content()` **nos dois sentidos** — o endereço
está para quem tem lugar e não está para a lista de espera, para o só-favorito e para o
anônimo (**7 casos**); (2) a projeção ganhou teste de unidade direto (**10 casos**) com
mutação provada; (3) **não há configuração por evento** para a visibilidade: ela é derivada
da inscrição e da equipe, e não de um interruptor.

---

## 5. Lições aprendidas (defeitos REAIS, com sintoma → causa raiz → correção)

### 5.1 O portão passava com um par de 2,10:1 — o defeito morava no modo que ninguém media

| | |
|---|---|
| **Sintoma** | 26 casos de `axe` **sem isenção**, todos verdes, e um par de texto a **2,10:1** / **1,86:1** em produção |
| **Causa raiz** | Todos os casos de tela do evento abriam o tema **padrão (claro)** com o visitante claro. O defeito só existe em `colorMode: 'dark'` do organizador |
| **Correção** | Dois casos novos no portão (§6.3), com fixture de evento de tema escuro e com o visitante no escuro, e **mutação provada**: devolvendo o comportamento pré-fase, o `axe` acusa exatamente **1** violação `color-contrast` em `p[data-testid="agora-legenda"]` |

### 5.2 O CSS substitui `var()` no elemento onde a DECLARAÇÃO é feita

| | |
|---|---|
| **Sintoma** | Sobrescrever `--ef-muted-foreground` no escopo do evento não mudou a tinta dos componentes do sistema |
| **Causa raiz** | Os apelidos semânticos são declarados na **raiz** (`globals.css:194-256`); a resolução acontece lá, não no descendente que redefine `--ef-*` (`theme-scope.tsx:67`). É a mesma causa raiz da FASE 64, agora explicada com caminho:linha |
| **Correção** | O escopo do evento publica os apelidos **no modo do tema** (ADR-345) em vez de reescrever os tokens dos componentes um a um — que voltaria a quebrar no componente seguinte |

### 5.3 "Encostar não é choque" continua verdade — com margem ZERO

| | |
|---|---|
| **Sintoma** | Ao introduzir a margem, a tentação era fazer de "encostado" um choque **sempre** |
| **Causa raiz** | A FASE 65 decidiu, com teste, que encostar não é choque: dois itens que se tocam não disputam tempo nenhum |
| **Correção** | A margem é **parâmetro**: com 15 min, encostado é conflito (0 min de folga para atravessar); com **0**, a régua é exatamente a da FASE 65 — presa em 9 pares. A frase do aviso passou a dizer **deslocamento**, e não "choque de horário", porque há um caso novo em que os relógios não se cruzam |

### 5.4 Mudança ADITIVA obriga a fase ANTIGA a declarar em que régua ela roda

| | |
|---|---|
| **Sintoma** | Três testes da FASE 65 passaram a falhar/duvidar quando o default ganhou margem, e a frase do aviso mudou |
| **Causa raiz** | Um default novo muda o significado de código antigo que não disse qual régua queria — e o teste que não declara a régua passa a medir a régua de quem veio depois |
| **Correção** | A fatia declarou os três: o caso do "emendado 18:00" foi **partido em dois** (margem declarada × margem 0); o default do helper `gradeCom` passou a **0** (para os casos da F65 rodarem na régua daquela fase); e o E2E `f65-minha-agenda.spec.ts` deixou de exigir "Choque de horário" onde o texto novo diz outra coisa. Nenhum deles foi "consertado" para ficar verde: cada um passou a dizer **qual** régua mede |

### 5.5 O comentário envelheceu e passou a mentir sobre a régua do piso

| | |
|---|---|
| **Sintoma** | O docblock de `getReviewerRanking` dizia que o piso é o **MAIOR** entre `MIN_REVIEWS_FOR_TOP` e o `threshold` da carta; o código usa o **threshold da carta sozinho** |
| **Causa raiz** | O comentário descrevia uma versão anterior do código, e a FASE 16 prende o comportamento atual (`minReviews = 2` com threshold 2) — o **teste** é o contrato, o comentário tinha envelhecido |
| **Correção** | O **docblock** foi corrigido para dizer o que o código faz. O código **não** foi tocado: mudá-lo por causa de um comentário seria trocar o contrato pela documentação |

### 5.6 Mascarar DEPOIS de ordenar

| | |
|---|---|
| **Sintoma** | A correção "fácil" da E82 seria mascarar o nome antes de montar a lista |
| **Causa raiz** | O desempate do ranking é **alfabético**: dois nomes ocultados que colidem passam a empatar, e o prêmio cai na **ordem do banco** |
| **Correção** | A identidade é resolvida **depois** da ordenação, preservando posição, contagem e elegibilidade — e a catraca prende os dois sentidos |

### 5.7 A frase É o valor gravado — renomear opção é migração de dado

| | |
|---|---|
| **Sintoma** | O motivo do descadastro poderia ter virado um enum no banco, com a frase na tela |
| **Causa raiz** | A coluna `reason` já existia como TEXTO e já era gravada no caminho `MANUAL`; normalizar agora criaria migração de dado e um segundo lugar onde a frase vive |
| **Correção** | O que a pessoa lê é o que fica registrado. A regra é pura, valor desconhecido vira `null` e **nunca** recusa a saída. Fica dito: renomear uma opção é **migração**, não ajuste de texto |

### 5.8 O motivo nunca pode atrasar a saída

| | |
|---|---|
| **Sintoma** | Um formulário de saída com "por que você está saindo?" convida a exigir a resposta |
| **Causa raiz** | É a barreira clássica do descadastro: pedir justificativa para deixar de receber e-mail |
| **Correção** | Nenhum rádio `required`, o texto livre é opcional, e a saída é **idempotente**: sair de novo não regrava o motivo. A pergunta é uma cortesia, e a cortesia não pode virar pedágio |

### 5.9 A espera por GESTO: repetir o gesto, não a asserção

| | |
|---|---|
| **Sintoma** | Cenários vizinhos apertavam a tecla uma vez e repetiam só a asserção — e passavam (ou falhavam) por corrida com a hidratação |
| **Causa raiz** | Com o bundle atrasado, o React absorve o gesto e o reexecuta depois; a asserção repetida mede a espera, não o efeito |
| **Correção** | A régua do ADR-327 aplicada aos quatro pontos: **repetir o gesto até o fato**. A repetição é guardada por **leitura do campo** (o movimento é relativo): duas teclas e um arrasto no editor de certificado e a sequência inteira no crachá (escolher → salvar → recarregar → conferir). No editor o palco só existe depois da hidratação (**7.771 ms** medidos), então ali a correção é defesa contra a **classe** |

### 5.10 **A fatia que morreu sem escrever nada** — o custo real de um agente que morre na exploração

| | |
|---|---|
| **Sintoma** | A fatia 5 (os quatro pontos de atenção da FASE 68) foi dada como "em andamento" e, quando o fechamento conferiu a árvore, **não havia uma linha**: `prisma/seed.ts` sem `usesCall`, nenhuma fonte única de modalidade, e `agenda-service.ts` sem `onlineUrl` |
| **Causa raiz** | O agente morreu **durante a exploração** — antes de escrever. Não houve erro, não houve teste vermelho, não houve aviso: o trabalho simplesmente não existia, e a única testemunha era o estado da árvore. Três outros agentes rodavam em paralelo e tinham entregado, o que fazia a fase **parecer** em andamento |
| **Correção** | O fechamento absorveu o trabalho inteiro. A lição que fica para a próxima fase é de PROCESSO: (a) **o estado da ÁRVORE é a verdade**, e "a fatia está rodando" não é evidência de nada; (b) uma fase com fatias paralelas precisa de um **ponto de conferência no meio** (o documento do plano dizia "em andamento" para a fatia morta até alguém abrir os arquivos); (c) o custo é o tempo de uma fatia inteira — e o que o pagou foi a margem que o fechamento tinha, não uma detecção automática. Nada aqui substitui a conferência humana do que foi escrito |

### 5.11 Uma fixture nova quebra contagens alheias — e a contagem exata é a catraca que avisa

| | |
|---|---|
| **Sintoma** | O caso da página pública da instituição no portão reprovou: `tenant-group-ongoing` com **3** cartões onde a asserção esperava **2** |
| **Causa raiz** | O evento de tema escuro da E84 nasce **em curso** (é a janela que faz a aba do "agora" desenhar), e todo evento público em curso aparece na vitrine |
| **Correção** | O número subiu para **3**, com o porquê escrito ao lado — e a contagem **exata** ficou. A alternativa (afrouxar para `> 0`) teria escondido exatamente o que a asserção existe para pegar |

### 5.12 O teto do `AGENTS.md`: 65.244 bytes, e o corte apaga conteúdo em silêncio

| | |
|---|---|
| **Sintoma** | Na FASE 68, uma linha da tabela de fases **desapareceu** do `AGENTS.md` depois de uma atualização |
| **Causa raiz** | O harness trunca o arquivo em **65.244 bytes** — e o corte não avisa: o arquivo continua válido, só menor do que deveria |
| **Correção** | O teto de trabalho passou a ser **~64.800 bytes**, escrito como regra no §2 do próprio arquivo. Quem atualiza o estado confere o tamanho no fim e **condensa linhas históricas** (corte em ~300 caracteres, num limite de palavra, fechando com ` … | ✅ |`) em vez de deixar o corte escolher |

---

## 6. Evidência de verificação

Ambiente: árvore em `C:\Users\thiago\Documents\Projetos\star`, container **reconstruído
sem cache** (`docker compose --profile app build --no-cache web worker`) — imagem do `web`
de **06/10/2026 19:46:14** e do `worker` de **19:46:29** —, Postgres 18, Redis e MinIO do
`docker compose`, suíte contra o container.

### 6.1 A bateria da §4 (saída real)

```text
npm run lint                 → exit 0 (0 erros, 0 warnings)
npm run typecheck            → exit 0 (0 erros)
npm test                     → 188 arquivos, 3498 casos, 3498 passando, 0 falhando (177,41 s)
npm run build                → "✓ Compiled successfully in 9.4s" · exit 0
npm run db:verify            → "Contrato íntegro." · exit 0
npm run db:verify:isolation  → "9/9 verificações passaram." · exit 0
npm run db:seed              → exit 0 · congresso-2026 com usesCall = t (conferido em psql)
npx playwright test          → 375 passando + 1 skip (376 no total)
```

**Nenhum vermelho nesta fase**, e nenhum vermelho foi "resolvido" afrouxando teste: as
duas reprovações que existiram no caminho (a contagem do grupo "acontecendo agora" e a
mutação do portão) foram tratadas na causa — a primeira com o número correto e o porquê, a
segunda era a **prova** de que a catraca morde.

### 6.2 Suítes por assunto

```text
npx vitest run tests/unit/f69-margem-de-deslocamento.test.ts        # 17 casos — E86
npx vitest run tests/unit/f69-e82-ranking-de-revisores.test.ts      #  5 casos — E82 (unidade)
npx vitest run tests/integration/f69-e82-ranking-de-revisores.test.ts # 5 casos — E82 (banco)
npx vitest run tests/unit/f69-contraste-do-tema-do-evento.test.ts   # 18 casos — E84
npx vitest run tests/unit/f69-motivo-do-descadastro.test.ts         # 15 casos — E88
npx vitest run tests/unit/f69-rotulos-de-modalidade.test.ts         # 10 casos — os rótulos
npx vitest run tests/unit/f69-sala-online-na-agenda.test.ts         # 10 casos — a projeção
npx playwright test tests/e2e/f69-sala-online-na-minha-agenda.spec.ts   # 7 casos
npx playwright test tests/e2e/f69-descadastro-motivo.spec.ts            # o motivo na tela
npx playwright test tests/e2e/accessibility.spec.ts                     # 28 casos, SEM isenção
npx playwright test tests/e2e/f62-regressao-visual.spec.ts              # 22 linhas de base
```

### 6.3 O portão WCAG AA — de 26 para **28 casos**, `ISENCOES = []`

Os dois casos novos são o mesmo par medido nos dois sentidos, e existem porque o defeito da
E84 era **invisível** para os 26 anteriores:

| Caso | O que ele abre | Por que ele é necessário |
|---|---|---|
| `a aba "Acontecendo agora" num evento de tema ESCURO` | o evento de tema escuro da fixture, com o **visitante claro** | é o par da medição original (2,10:1 / 1,86:1) — a combinação que nenhum caso abria |
| `a aba "Acontecendo agora" com o VISITANTE no escuro` | o evento em curso da F65 com `ef_tema=escuro` | é o outro lado (1,62:1 / 1,35:1): a rampa escura da plataforma dentro de um escopo de evento claro |

Os dois afirmam o nó que a dívida media (`agora-legenda`, o token de texto da plataforma
dentro do escopo do evento) **antes** de varrer — sem isso, uma tela que perdesse a legenda
passaria igual, porque ausência de nó não é violação de regra nenhuma.

**A mutação (prova de que a catraca morde).** Removido o `...PAPEIS_DA_PLATAFORMA[mode]` do
escopo do tema (`event-page-theme-rules.ts`) — isto é, devolvido o comportamento pré-fase — o
caso novo reprova com **exatamente 1 violação**:

```text
✗ color-contrast (serious) — Elements must meet minimum color contrast ratio thresholds
    p[data-testid="agora-legenda"]
      <<p class="text-sm text-muted-foreground" data-testid="agora-legenda">1 atividade
      em curso neste momento · horários em America/Bahia</p>>
```

É o **mesmo nó** que a medição da E84 apontou. Depois da reversão, os 28 casos voltam a
passar.

### 6.4 As catracas novas desta fatia, provadas por mutação

| Catraca | Mutação aplicada | Resultado medido |
|---|---|---|
| `f69-rotulos-de-modalidade` (fonte única) | o ternário antigo devolvido a `public-event-list.tsx` | **2 de 10** casos reprovam: a varredura do `src/` aponta o arquivo e o caso por componente cobra a função do domínio. Revertida, 10/10 verdes |
| `f69-sala-online-na-agenda` (a projeção) | `visibleOnlineRoomsByActivity` devolvendo tudo o que tem endereço (a régua ignorada) | **5 de 10** casos reprovam — o anônimo, a lista de espera, o só-favorito, o espelho `aberta` e a igualdade "o mapa concorda com a régua". Revertida, 10/10 verdes |
| portão WCAG AA (tema escuro) | `PAPEIS_DA_PLATAFORMA` fora do escopo do tema | 1 violação `color-contrast` em `agora-legenda` (acima). Revertida, 28/28 verdes |

### 6.5 A regressão visual

```text
npx playwright test tests/e2e/f62-regressao-visual.spec.ts --update-snapshots  → 22 passaram (regeneração MEDIDA, §3.7)
npx playwright test tests/e2e/f62-regressao-visual.spec.ts                     → 22 passaram, ZERO pixel de diferença na segunda execução
```

A segunda execução, sem `--update-snapshots`, é a prova de que as linhas de base **não
piscam** — o que a suíte não aceita é linha de base que muda sozinha.

---

## 7. Comandos operacionais

```bash
# A fase inteira, por assunto (o que cada comando prova)
npx vitest run tests/unit/f69-margem-de-deslocamento.test.ts          # a margem e as bordas
npx vitest run tests/unit/f69-rotulos-de-modalidade.test.ts           # a fonte única dos rótulos
npx vitest run tests/unit/f69-sala-online-na-agenda.test.ts           # a projeção da sala
npx vitest run tests/unit/f69-contraste-do-tema-do-evento.test.ts     # a rampa do tema do evento
npx vitest run tests/unit/f69-motivo-do-descadastro.test.ts           # o motivo (regra pura)
npx vitest run tests/unit/f69-e82-ranking-de-revisores.test.ts \
              tests/integration/f69-e82-ranking-de-revisores.test.ts # o ranking mascarado

# O endereço da sala online na agenda (a régua e o documento)
npx playwright test tests/e2e/f69-sala-online-na-minha-agenda.spec.ts

# O portão e a catraca visual
npx playwright test tests/e2e/accessibility.spec.ts
npx playwright test tests/e2e/f62-regressao-visual.spec.ts

# Atualizar uma linha de base (SEMPRE depois de medir a caixa dos pixels — §3.7)
npx playwright test tests/e2e/f62-regressao-visual.spec.ts -g "o bloco de local" --update-snapshots
```

**O container tem de rodar o código NOVO.** O `--build` que falha **mantém o container
anterior no ar**, e o E2E passa a medir código que não existe: leia a saída do build,
confirme a data da imagem e só então rode a suíte. Nesta fase, a reconstrução final foi
`docker compose --profile app build --no-cache web worker` justamente para a data da imagem
não ser herdada do cache (o BuildKit reaproveita a camada quando o conteúdo é idêntico, e o
`CreatedAt` da imagem passa a ser o da build antiga).

---

## 8. Dívidas técnicas e pontos de atenção

### 8.1 Dívidas quitadas nesta fase

| Dívida | Frase de quitação |
|---|---|
| **E86** | Quitada na FASE 69: a margem de deslocamento entre salas virou **parâmetro da regra pura** (`intervalsClash`/`findClashPairs`), com o padrão **declarado** no domínio (`ROOM_TRAVEL_MARGIN_MINUTES = 15`, `src/domain/agenda/overlap-rules.ts:201`); quem termina numa sala e começa em outra com **menos** de 15 minutos entre o fim de um e o início do outro **avisa**, e o aviso diz que o motivo é o deslocamento, com o número no texto; **margem zero ≡ régua da FASE 65** (preso por teste) e **não há configuração por evento** |
| **E82** | Quitada na FASE 69: o ranking de revisores deixou de citar por inteiro quem a moderação ocultou — `getReviewerRanking` passou a ler o nome pela fonte única da ocultação (`leaderboardIdentity`, a mesma do ranking de XP), mascarando a identidade e **preservando posição, contagem e elegibilidade**, na lista e no painel de premiação; provado por catraca nos dois sentidos e por mutação. E a lição que vale registrar: **mascarar depois de ordenar**, nunca antes — o desempate é alfabético e o prêmio cairia na ordem do banco |
| **E83** | Quitada na FASE 69: os QUATRO pontos da família passaram a repetir o **GESTO** até o fato (a régua do ADR-327) — as duas teclas e o arrasto no `certificate-template.spec.ts` e a troca de categoria do crachá no `f51-credential-badge.spec.ts`, que agora repete a sequência inteira (escolher → salvar → recarregar → conferir). A repetição é guardada por leitura do campo, porque o movimento é relativo. Medição com bundle atrasado: no editor o palco só existe DEPOIS da hidratação (7.771 ms), então ali a correção é defesa contra a CLASSE — o vermelho medido era o do quadro de demandas; na f51 fecha a corrida do `select` controlado (medida na F52) |
| **E88** | Quitada na FASE 69: a página sem login pergunta o motivo (quatro opções em português + "prefiro não dizer", nenhuma obrigatória e nenhum rádio `required`), o motivo viaja no MESMO `POST` da saída e a coluna `reason` — que existia desde a F67 e só era escrita no caminho `MANUAL` — passa a ser gravada no caminho `LINK`; a regra é pura no domínio (valor desconhecido vira `null` e NUNCA recusa a saída) e a equipe lê o agregado na aba "Segmentos", com o texto livre do telefone na mesma frase |
| **E84** | **QUITADA POR INTEIRO na FASE 69.** O claro/escuro do visitante deixou de pintar dentro do tema do organizador: o escopo do evento passou a republicar os papéis semânticos da plataforma (`--muted-foreground`, `--card`, `--border`, …) no modo do TEMA — a mesma régua que a FASE 64 usou na página da instituição, no caso em que ela não se resolve sozinha. Medido no navegador, o texto secundário sobre a `--ef-background` e sobre o `.ef-card` saiu de **2,10:1** e **1,86:1** (organizador escuro · visitante claro) e de **1,62:1** e **1,35:1** (organizador claro · visitante escuro) para **11,59:1** / **10,28:1** e **8,93:1** / **7,45:1**; os dois estados do visitante agora dão o MESMO número em cada modo. A identidade do organizador continua vencendo (preso por teste e pelo E2E da F61, verde) e a catraca nova é `tests/unit/f69-contraste-do-tema-do-evento.test.ts` (18 casos, cópia da rampa presa contra o `globals.css` valor a valor, com mutação provada) |

### 8.2 `/comite/<submissionId>` continua nomeando o revisor ATRIBUÍDO — **decisão, não dívida**

A E82 fechou o ranking. A tela `/comite/<submissionId>` continua mostrando o nome do revisor
**atribuído** à submissão, e isso é **decisão declarada**, não dívida:

- é **tela de trabalho**, não superfície pública: quem a abre é a comissão, com a permissão
  de revisão;
- a comissão **precisa** da identidade para redistribuir, cobrar prazo e resolver conflito —
  mascarar ali destruiria a função da tela;
- a ocultação do perfil (F60/E79) existe para o que é **exibição pública** da pessoa; a
  atribuição de um parecer é ato administrativo com nome, e o próprio sistema o registra na
  trilha.

Se um dia a instituição quiser anonimato **interno**, isso é uma decisão nova (e uma coluna
nova), não um vazamento desta.

### 8.3 A margem de deslocamento NÃO é configurável por evento — ponto de atenção

Registrado como ponto de atenção, não como dívida: o padrão de 15 minutos é **declarado** e
vale para todo evento, e o sistema não conhece distância, andar nem transporte. Quem quiser
a margem por evento precisará de coluna, tela e uma decisão de produto — e o lugar de
mudar o padrão hoje é **uma constante** (`ROOM_TRAVEL_MARGIN_MINUTES`), o que é uma virtude
enquanto ninguém precisa de dois valores.

### 8.4 O limite declarado da E84 — organizador que declara `dark` e pinta claro

A rampa republicada sai do **MODO DECLARADO** (`colorMode`), não da luminância da cor de
fundo escolhida. Um organizador que declara `dark` e pinta um fundo claro (ou o inverso)
fica **fora** da régua. A alternativa — decidir a rampa pela cor de fundo — criaria uma
**segunda autoridade** sobre claro/escuro, brigando com o `data-theme-mode`, e foi rejeitada
na fase. É decisão declarada, e o caminho (se algum dia for preciso) é a tela avisar sobre a
incoerência, não o CSS adivinhar.

### 8.5 O teto do `AGENTS.md` (regra escrita no §2 do próprio arquivo)

O `AGENTS.md` **não pode passar de ~64.800 bytes**: o harness corta em **65.244** e o corte
apaga conteúdo **em silêncio** (aconteceu na FASE 68 — uma linha de fase foi apagada). Quem
atualiza o estado confere o tamanho no fim e **condensa linhas históricas** (corte em ~300
caracteres, num limite de palavra, fechando com ` … | ✅ |`) em vez de deixar o corte
escolher. Nesta fase: **64.594 → 64741 bytes**.

### 8.6 O seed precisa ser rodado em bases anteriores à FASE 68

O `prisma/seed.ts` passou a criar o **`congresso-2026`** com `usesCall: true`, e o
`setCallPublished` da FASE 68 também o liga ao publicar. Mas **nada conserta o dado já
gravado**: quem semeou o banco antes da FASE 68 tem `usesCall = false` num evento que publica
chamadas, e nenhuma migração tem como adivinhar quais eventos são esses. Medido nesta
máquina: **antes** do seed, `congresso-2026 → f`; **depois**, `t` (e o `simposio-2026`
continua `f`, que é o correto — ele não tem chamada). **Rodar `npm run db:seed` é
necessário** em qualquer ambiente cujo banco nasceu antes da FASE 68.

### 8.7 Resíduos e limpeza

- `.f69-fatia1-relatorio.md` (relatório solto na raiz, criado pela fatia 1) — **apagado**; a
  casa não deixa resíduo na árvore.
- `tests/e2e/tmp-f69-medicao-contraste.spec.ts` (sonda temporária da fatia 3) e
  `tests/e2e/zz-medicao-e83.spec.ts` (sonda da fatia 4) — **apagados pelos próprios donos**
  antes do fechamento; conferido na árvore.
- `playwright-report/` e `test-results/` — artefatos de execução dentro da árvore,
  **apagados** no fechamento (a suíte roda com `--output` fora da árvore).
- `test-run.log` e `tsconfig.tsbuildinfo`: existem na raiz e são **ignorados pelo git**
  (`.gitignore`), resíduo de execuções anteriores — não são desta fase.
- O banco de desenvolvimento acumula **eventos de fixtures antigas** (`evento-apertado-*`,
  `eventos-paginados-*`) de execuções anteriores à fase; a suíte E2E cria o próprio tenant e
  não depende deles. A limpeza existe (`npm run e2e:clean`) e **não foi rodada** nesta fase
  para não interferir em execuções vizinhas.

---

## 9. Checklist de aceite

- [x] **E86** quitada: margem como parâmetro da regra pura, padrão declarado (15 min), prova
      dos dois lados, margem zero ≡ F65, aviso com o número no texto, sem configuração por evento
- [x] **E82** quitada: o ranking lê o nome pela fonte única da ocultação, mascarando **depois**
      de ordenar e preservando posição/contagem/elegibilidade; mutação provada
- [x] **E83** quitada: os quatro pontos da família repetem o gesto até o fato
- [x] **E88** quitada: o motivo no descadastro (campo + gravação no caminho `LINK` + E2E), sem
      obrigatoriedade e sem atrasar a saída
- [x] **E84** quitada **por inteiro**: os papéis semânticos republicados no modo do tema, com o
      par medido nos dois sentidos e catraca de unidade provada por mutação
- [x] **F68.1** `prisma/seed.ts` com `usesCall: true` no evento que publica chamadas, e o
      número medido antes/depois (o seed precisa ser rodado)
- [x] **F68.2** "Presencial · Online · Híbrido" numa fonte única no domínio, com **prova de que
      nenhum rótulo mudou de texto** (o ternário antigo como oráculo) e catraca que varre o `src/`
- [x] **F68.3** o endereço da sala online na "minha agenda", resolvido no **servidor** com a
      régua e o serviço da FASE 68; o E2E prova que ele **não está no `page.content()`** da
      lista de espera e do só-favorito, e **está** para quem tem lugar
- [x] **F68.4** linha de base visual do `VenueBlock` criada (`evento-bloco-de-local`), com nota
      no cabeçalho do `f62-regressao-visual.spec.ts` (22 snapshots, 8 superfícies)
- [x] `descadastro.png` regerada **depois de medir** a caixa (38.174 px, 1440×1200 → 1440×1460,
      x=0 y=873 1440×561), e as duas da agenda com a causa declarada (o texto do aviso da E86)
- [x] Portão WCAG AA a **28 casos**, `ISENCOES = []`, com o caso do **tema escuro** e mutação
      provada (1 violação em `agora-legenda`)
- [x] Limpeza: sonda temporária, relatório solto na raiz, `playwright-report/` e `test-results/`
- [x] Bateria da §4 com os **números reais**, sem vermelho e sem teste afrouxado
- [x] `docs/fase-69-mutirao-dos-pequenos.md` com as **9 seções** e **ADR-344/345/346**
- [x] `AGENTS.md` atualizado (fases **29 a 69**, contagens medidas, `ADRs 346 → a próxima é
      347`, linha 69, dívidas quitando **E86, E82, E83, E88 e E84**), com o **teto de ~64.800
      bytes** escrito como regra e o tamanho final conferido
- [x] `README.md` e `docs/dividas-tecnicas.md` atualizados
