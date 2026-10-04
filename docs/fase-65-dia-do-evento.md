# FASE 65 — O dia do evento na mão do participante

> **Estado: ENTREGUE** (fatias 1 a 5). O participante passou a ter **a grade do dia**:
> ele marca o que quer acompanhar (**favoritar não reserva vaga**), a sobreposição de
> horário **avisa e nunca bloqueia**, a grade sai em **arquivo `.ics`** e em **link do
> Google**, e a página do evento ganhou a aba **"Acontecendo agora"** — decidida **no
> servidor, no fuso do evento**.
>
> Este documento traz os números REAIS, os defeitos REAIS que os testes pegaram, as
> decisões (com as alternativas descartadas) e o que ficou aberto.

---

## 1. Sumário executivo

### O que o participante ganhou

```text
Minha agenda .......... /t/<slug>/minha-agenda?evento=<id>      (painel, sessão)
Aba do agora .......... /t/<slug>/eventos/<eventSlug>?aba=agora (público, sem sessão)
Arquivo da grade ...... GET /api/t/<slug>/agenda/ics?token=<…>&evento=<id>
Arquivo da atividade .. GET /api/t/<slug>/agenda/ics?atividade=<id>
Porta de entrada ...... "Ver a minha agenda do dia" em /minhas-inscricoes
                        e "Ver a minha agenda deste evento" no topo da programação
Tabela ................ activity_favorites (RLS + FORCE, uma linha por pessoa × atividade)
```

São duas perguntas diferentes, e a fase inteira vive da separação:

- **favoritar é INTENÇÃO** — a pessoa marca o que quer acompanhar enquanto decide, e a
  marca é dela (não aparece para a instituição, não consome vaga, não entra em loteria);
- **inscrever-se é LUGAR** — quem garante lugar é a inscrição, com o motor de sempre
  (lotação atômica, lista de espera, quota de plano intactos).

A "minha agenda" é a **UNIÃO** das duas, com marcas distintas, os quatro contadores e o
bloco de choque; a aba "Acontecendo agora" é a resposta a "onde eu deveria estar neste
minuto?", agrupada por **sala** (que é como quem está no evento procura a informação).

### Tabela de entregas

| # | Fatia | Entrega | Onde |
|---|---|---|---|
| 1 | Fundação | Domínio puro (sobreposição com as bordas decididas, grade = favoritos ∪ inscrições, "agora" com instante injetado), tabela `activity_favorites` (RLS + FORCE) com migração, serviços por `withTenant` e o **gerador `.ics`** (RFC 5545) com teste contra os casos do RFC | `src/domain/agenda/{overlap-rules,agenda-rules,now-rules}.ts`; `src/lib/events/agenda-service.ts`; `src/lib/calendar/ics.ts`; `prisma/migrations/20261004041647_f65_favoritos_da_atividade/` |
| 2 | Minha agenda e favoritar | Botão de favoritar que **funciona sem JavaScript** (form + Server Action, com `?agenda=<id>` na volta), **aviso de choque** que informa e não bloqueia, e a tela `/minha-agenda` com resumo, as duas marcas e o par em choque | `src/app/actions/agenda-actions.ts`; `src/components/events/{favorite-button,agenda-marks,agenda-clash-notice}.tsx`; `src/app/t/[tenantSlug]/(app)/minha-agenda/page.tsx`; `src/lib/events/agenda-view.ts` |
| 3 | Exportação 1-clique | Rota pública do `.ics` (grade inteira e uma atividade), link do Google Calendar, token derivado e resolução por vínculo ativo | `src/app/api/t/[tenantSlug]/agenda/ics/route.ts`; `src/lib/events/agenda-export.ts`; `src/components/events/activity-export-links.tsx` |
| 4 | Acontecendo agora | Aba na página do evento, faixa no topo da programação, atividades em curso **por sala**, barra de progresso acessível (tempo restante em texto) e os dois caminhos (crachá e balcão, com permissão) | `src/components/events/happening-now.tsx`; `src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/page.tsx` |
| 5 | Catracas e documento | Unidade + integração (RLS, favoritar/desfavoritar, isolamento) + E2E, **portão WCAG AA** com as duas telas, **regressão visual** dos dois modos e da aba do agora, **a migração do drift da FASE 64**, este documento e as atualizações de `README.md`, `AGENTS.md` e dívidas | `tests/{unit,integration,e2e}/f65-*`; `tests/e2e/accessibility.spec.ts`; `tests/e2e/f62-regressao-visual.spec.ts`; `prisma/migrations/20261004120000_f64_updatedat_sem_default/` |

### Números da fase

| Medida | Antes da fase | Depois da fase |
|---|---|---|
| Vitest (unit + integração) | 3.105 | **3.212** (+107) |
| Arquivos de teste do Vitest | 165 | **171** (+6) |
| Playwright E2E | 317 | **340** (+23) |
| Casos no portão WCAG AA (`accessibility.spec.ts`) | 17 | **19** (+2), `ISENCOES` continua `[]` |
| Linhas de base da regressão visual (`f62`) | 16 | **19** (+3) |
| Tabelas de tenant sob RLS + FORCE | 59 | **60** (+1) |
| Migrações | 51 | **53** (+2: a tabela nova e a correção do drift) |
| ADRs | 333 | **336** (334, 335 e 336 nesta fase) |

Os **107** casos do Vitest estão em 6 arquivos:

```text
tests/unit/f65-sobreposicao-e-grade.test.ts ............ 20
tests/unit/f65-ics.test.ts ............................. 23
tests/unit/f65-exportacao-de-agenda.test.ts ............ 13
tests/unit/f65-aviso-de-choque.test.ts ................. 11
tests/unit/f65-acontecendo-agora.test.ts ............... 24
tests/integration/f65-favoritos.test.ts ................ 16
                                                  total  107
```

E os **23** casos E2E da fase: 11 em `f65-exportacao.spec.ts`, 7 em
`f65-minha-agenda.spec.ts`, 2 no portão de acessibilidade e 3 na regressão visual.

---

## 2. O problema mais difícil da fase

**O relógio.** A fase inteira é sobre um instante que ninguém controla — e há três
consequências dele, cada uma resolvida num lugar diferente.

### 2.1 Quem decide o "agora" (e onde a decisão pode divergir)

"O que está acontecendo agora?" parece a pergunta mais simples do produto, e é a mais
traiçoeira, por três motivos que se somam:

1. **o instante é do servidor** — `Date.now()` dentro do componente faria duas partes da
   mesma tela discordarem sobre "agora" (a barra de uma e o rótulo de outra), e a aba
   mentiria para quem abre a página com o relógio adiantado. A decisão é tomada UMA vez
   por renderização, no servidor, e desce pronta para a tela (a mesma régua da F24/F57);
2. **o fuso é do EVENTO** — a página do evento é um cartaz que o organizador desenha, e
   quem diz "10:00" é o fuso que ele declarou, nunca o do processo (o container roda em
   UTC: sem `timeZone`, uma atividade das 10:00 em Salvador aparece às 13:00);
3. **a regra não pode ler o relógio** — `buildHappeningNow` recebe `now` por parâmetro
   (`NowActivityFact` + instante). É isso que permite ao teste varrer as bordas do
   intervalo (começar agora, terminar agora, cancelada, sem horário) sem depender da hora
   em que a suíte roda — e é a razão de o domínio não importar Prisma nem Next.

**As bordas são a decisão de produto que a fase tomou, e elas NÃO são as da
sobreposição.** Em `now-rules` começar exatamente agora é **estar em curso**
(`startsAt <= now`) e terminar exatamente agora **não é** (`endsAt > now`): às 11:00 em
ponto, a atividade que acabava às 11:00 acabou, e a sala já é da próxima. Em
`overlap-rules` a mesma vizinhança responde outra pergunta — "dois itens disputam o mesmo
tempo?" — e lá **encostar não é choque**. Reusar uma régua na outra faria o "agora"
anunciar o que terminou e o aviso de choque acusar dois itens em sequência. Duas
perguntas, duas réguas, e a proximidade no mesmo formato (início inclusivo, fim
exclusivo).

### 2.2 A cor sobre uma superfície que a plataforma não conhece

A aba do "agora" é a **primeira peça do produto com `role="progressbar"` dentro do tema
do EVENTO** — e o tema é do organizador. O cartão ali é `.ef-card`, cujo fundo é
`color-mix(in oklab, var(--ef-background) 92%, var(--ef-text) 8%)`: uma superfície que
**nenhum token da plataforma conhece**.

Foi por isso que o portão WCAG AA reprovou a tela, e é o problema mais difícil da fatia:
não existe UM tom da plataforma que sirva às duas superfícies possíveis (o organizador
pode ter escolhido claro ou escuro), e a resposta da casa já estava escrita desde a FASE
52 ("não existe um tom de aviso que sirva às duas superfícies") e desde a FASE 61 ("na
página do evento quem responde pela paleta é o organizador"). A fase aplicou a mesma
conclusão: **dentro do tema, a cor vem do próprio tema** — `currentColor` no texto e uma
classe de mistura declarada (`.ef-muted`) para o texto secundário, ambas medidas nos dois
modos. Ver §3.4 e as lições em §5.

### 2.3 A linha de base de pixel de uma tela relativa ao relógio

A catraca visual da FASE 62 fotografa telas e compara pixel a pixel com
`maxDiffPixelRatio: 0`. Uma tela cujo conteúdo depende do relógio é, por definição, uma
tela que muda sozinha. A fase encarou isso de frente em vez de deixar a aba fora da
catraca, e o caminho está em §3.7 — incluindo o erro que a primeira tentativa cometeu
(a máscara que se mexe, lição 7 em §5).

---

## 3. Decisões técnicas (o "porquê", e o que foi descartado)

### 3.1 Favoritar é marca pessoal, e não reserva vaga

`activity_favorites` é uma tabela **independente** de `registrations`: três colunas
(`tenantId`, `activityId`, `userId`), RLS + FORCE, `@@unique([activityId, userId])` e
`@@index([userId, tenantId])`. Nenhum serviço de favorito toca em
`activities."confirmedCount"`, e a prova está no teste de integração: favoritar uma
atividade **LOTADA** funciona e a contagem não muda.

Descartado: **uma coluna `favorite` em `registrations`**. Seria a mistura das duas
coisas — e o efeito apareceria no dia em que a pessoa marcasse uma atividade lotada:
"não consigo me inscrever" antes de ela decidir se quer. Também descartado: guardar
`eventId` no favorito (o evento é derivado da atividade; uma cópia poderia divergir e a
grade mostraria o mesmo item em dois dias).

**Desfavoritar é `DELETE`, e o índice único é TOTAL** — o oposto da inscrição, onde a
exclusão é lógica e o índice é parcial porque cancelar é terminal (armadilha 103). Aqui
não há história a preservar: o favorito é preferência pessoal e reversível, e a
unicidade total é o que garante a idempotência **no banco** (`INSERT … ON CONFLICT DO
NOTHING`), e não numa checagem de leitura que duas requisições simultâneas atravessariam.

### 3.2 O choque AVISA — e as bordas são do domínio

`intervalsOverlap` decide "sobrepõe?" com as bordas já fixadas na fatia 1: **encostar
não é choque, conter É, sem horário não choca**. A tela nunca recusa, nunca desabilita o
botão e nunca pede confirmação: ela diz QUAL atividade disputa o mesmo horário, com o
horário ao lado, e a Server Action grava de qualquer jeito.

Descartado: **bloquear**. A casa não decide o que o participante vai assistir, e um
bloqueio teria de escolher por ele (qual das duas é "a certa"?). Descartado também:
recalcular a sobreposição na tela — a comparação existe em UM lugar, e a segunda cópia
avisaria choque onde não há no dia em que a régua mudasse.

Cancelada não gera aviso **dos dois lados** (avisar choque contra o que não vai acontecer
manda a pessoa mexer num plano que não existe) — a mesma exclusão que o cálculo de pares
da grade faz, de propósito.

### 3.3 O "agora" é do servidor, e a aba é NAVEGAÇÃO por link

A aba viaja em `?aba=agora` e é desenhada com **dois `<a>` com `aria-current`**, não com
botões e estado de cliente. Três razões, todas de requisito: a pessoa precisa poder
**mandar o endereço da aba** para outra ("o que está acontecendo agora?" chega por
mensagem); a aba tem de funcionar **sem JavaScript** (como o resto das telas públicas); e
o HTML sai pronto do servidor — quem abre com o relógio adiantado vê o mesmo que o
servidor decidiu.

A visão é agrupada por **SALA**, e não pela ordem da grade: quem está no evento pergunta
"o que tem no auditório agora?". Uma sala sem nada em curso **não aparece** (a pergunta é
"o que está acontecendo", e uma lista de salas vazias é a resposta errada com boa
aparência), e cada sala diz o que **começa em seguida** nela — o que a pessoa tem de
fazer no minuto seguinte.

A **barra de progresso** é acessível de verdade: `role="progressbar"` com
`aria-valuemin`/`aria-valuemax`/`aria-valuenow` e um `aria-valuetext` que diz o TEMPO
("termina em 1 h 20 min"), porque porcentagem não é resposta para quem vai à sala. O
tempo restante existe também **em texto**, fora da barra: quem não vê a barra lê a frase,
e é ela que o E2E funcional confere.

### 3.4 Dentro do tema do EVENTO, a cor vem do TEMA

Esta é a correção que o portão exigiu, e ela é maior do que a aba — vale para a página do
evento inteira:

| Papel | Antes | Depois |
|---|---|---|
| Tempo restante do cartão | `text-success-strong` (token da PLATAFORMA) | `currentColor` (a tinta do tema) |
| Migalha "← Todos os eventos de …" | `opacity-60` | `ef-muted` |
| Rodapé (contagem e "Horários em …") | `opacity-60` | `ef-muted` |

`opacity` **não escolhe cor**: ela compõe o texto com o fundo, e o fundo é a
`--ef-background` que o organizador escolheu. No tema padrão claro a composição media
**4,44:1** (`#72747c` sobre `#f9f9ff`), abaixo dos 4,5:1 do AA. A classe `.ef-muted`
declara a MESMA ideia com valor explícito e medido —
`color-mix(in oklab, var(--ef-text) 60%, var(--ef-background))`, que dá **5,08:1** no
claro (`#686b73`) e **5,91:1** no escuro (`#8b8d8f`).

Descartado: **escolher outro tom da plataforma**. O par que reprovava media 4,36:1 sobre
o cartão do evento, e qualquer tom da plataforma escolhido "no olho" reprovaria no tema
que o organizador escolher amanhã — o organizador pode ter tema claro ou escuro, e os
tokens de estado da plataforma são dois (`warning-strong` para claro,
`warning-strong-on-dark` para o telão). Não existe um que sirva aos dois: a medição está
na lição 4.

A catraca disso ficou em `tests/unit/f65-acontecendo-agora.test.ts`, com a conta do
`color-mix(in oklab, …)` implementada no teste (o navegador não existe em teste de
unidade) e **conferida contra o que o navegador computou** na página real:
`.ef-muted` → `oklab(0.529122 …)` = `#686b73` e `.ef-card` → `oklab(0.923186 …)` =
`#e4e5eb`. Foi por isso que o `LIMITE` do `.ef-muted` ficou declarado no CSS: a mistura é
sobre a paleta do organizador, e um tema com contraste base baixo derruba qualquer tom
derivado — quem responde pela paleta dele é ele.

### 3.5 O arquivo `.ics`: a forma é do RFC, a decisão é do domínio

`src/domain/agenda/agenda-rules.ts` decide **quem** entra na grade, com que marca e em
que ordem; `src/lib/calendar/ics.ts` **formata** um padrão externo. A separação não é
estética: um `.ics` malformado não dá erro em lugar nenhum — o arquivo abre, o programa
não reclama e o compromisso simplesmente não aparece.

Quatro armadilhas do RFC 5545 estão tratadas ali, cada uma com teste:

1. **CRLF em toda linha** (há cliente que descarta o arquivo inteiro se a primeira linha
   vier com `\n`) — a quebra é montada UMA vez, no fim;
2. **dobra em 75 octetos**, contada em BYTES e sem partir caractere UTF-8 (lição 1);
3. **escape de `\`, `,`, `;` e quebra de linha** — sem ele, "Silva, Ana" vira dois
   valores e um título com `;` transforma o resto em parâmetro;
4. **`UID` estável**, derivado do ID da atividade e de mais nada — é ele que faz o
   aplicativo ATUALIZAR o compromisso em vez de criar outro a cada edição.

O `DTSTART`/`DTEND` saem em **UTC** (é o que o cliente precisa), e o fuso do evento entra
no **rótulo legível da descrição** ("Horário local: … (America/Bahia)"), que é o que a
pessoa lê no celular. O `DTSTAMP` é injetável (`now`): teste com relógio de parede é
teste que falha no dia seguinte.

### 3.6 O token é DERIVADO, e a rota é pública de propósito

Quem baixa o arquivo é o navegador no clique — mas quem o reabre nos dias seguintes é o
Apple Calendar, o Outlook ou o Thunderbird, **sem cookie de sessão**. Uma rota
autenticada por sessão funcionaria no clique e falharia em toda tentativa seguinte.
Então a rota é pública e a credencial é o **token na URL** (a mesma escolha do link da
carta e do QR do estande).

O token é `HMAC-SHA256` sobre `tenantId:userId`, com rótulo próprio derivado de
`BETTER_AUTH_SECRET` — sem id dentro, sem `userId` na URL e sem tabela nova. A resolução
recalcula o token dos **vínculos ativos daquela instituição** (`user_tenant_profiles`,
que tem `tenantId` e entra por RLS) e compara em tempo constante
(`timingSafeEqual`); o `SELECT` é por vínculo, nunca sobre a tabela `user` inteira, que é
global. A resposta leva `cache-control: no-store`: o conteúdo depende do vínculo, que
pode ser desativado a qualquer momento.

O endereço do arquivo de UMA atividade **não** leva token: o arquivo é o mesmo para todo
mundo e não carrega nada de ninguém — é isso que permite mandá-lo num e-mail para a turma
ou num QR na porta da sala.

**A consequência declarada:** não há revogação individual (§5, lição 5).

### 3.7 Uma linha de base de pixel para uma tela relativa ao relógio

A aba do "agora" entrou na catraca visual com **quatro máscaras** — e a escolha de QUAIS
nós mascarar é a decisão técnica:

| Máscara | Por quê |
|---|---|
| a barra INTEIRA (o trilho) | o preenchimento muda de largura a cada minuto |
| a linha de informação do cartão (`dl`) | o horário é relativo a agora |
| o texto do tempo restante | muda a cada minuto |
| a linha do "a seguir nesta sala" | imprime a hora de início da próxima |

As quatro são **contêineres de largura fixa**. A primeira versão mascarou o `<dd>` do
horário e o preenchimento — os nós cujo CONTEÚDO muda — e a medição entre duas execuções
mostrou **822 pixels diferentes**: a caixa da máscara mudava de largura e empurrava o
nome da sala ao lado. Máscara de nó que muda de tamanho é máscara que se mexe (lição 7).

O que a imagem ainda mede, e é bastante: as duas abas com o estado ativo, o título e a
legenda da seção, o cabeçalho da SALA, o cartão inteiro (título, etiqueta "Em curso", os
ícones), o trilho da barra e a geometria do preenchimento, os dois caminhos (crachá e
balcão) e o rodapé com a contagem de atividades.

**O que a imagem NÃO prova, e quem prova:** o TEXTO do tempo restante e o
`aria-valuetext` são conferidos pelo E2E funcional (`f65-exportacao.spec.ts`, bloco (e):
`aria-valuenow` entre 25 e 45, `aria-valuetext` igual ao texto visível, "termina em N
min"), e os atributos ARIA da barra, pelo portão de acessibilidade. A cor da barra é
presa pela catraca de unidade (4,49:1 no claro, 9,12:1 no escuro).

---

## 4. ADRs

### ADR-334 — Favoritar é marca pessoal e NÃO reserva vaga

**Contexto.** A fase precisa de "quero acompanhar isto" antes (ou sem) a inscrição. O
caminho barato seria uma coluna em `registrations` ou um `status` novo na inscrição.

**Decisão.** `activity_favorites` é uma tabela própria, com `(activityId, userId)` único e
TOTAL, sem `eventId` e sem contato com o motor de inscrição. Desfavoritar é `DELETE`.
Nenhum serviço de favorito escreve em `activities."confirmedCount"`.

**Justificativa.** Favoritar não pode consumir vaga, entrar em loteria, ocupar lista de
espera nem contar quota: se consumisse, a pessoa receberia "não consigo me inscrever"
antes de decidir se quer — e um evento de 300 pessoas com o hábito de marcar candidatas
estouraria o plano sem uma inscrição sequer. A separação também deixa os dois fatos com
régua própria: a inscrição tem história (exclusão lógica, índice parcial) porque cancelar
é terminal; o favorito é reversível e sem efeito para a instituição, e por isso a
unicidade é total e a idempotência é do BANCO (`ON CONFLICT DO NOTHING`).

**Consequências.** (a) A "minha agenda" é uma UNIÃO, e a tela precisa de duas marcas — um
rótulo combinado perderia a informação de qual dos dois fatos existe; (b) duas consultas
a mais por renderização da página do evento (favoritos e inscrições da pessoa), ambas
sob RLS; (c) a instituição **não** vê a lista de favoritos de ninguém: é dado da pessoa.

### ADR-335 — O "agora" é do servidor; a aba é navegação por link

**Contexto.** "Acontecendo agora" depende de um instante. O caminho barato seria calcular
no cliente (`useEffect` + `Date.now()`), que é o que a maioria dos produtos faz.

**Decisão.** O instante entra na regra por parâmetro, decidido UMA vez por renderização no
servidor, com o fuso do EVENTO para formatar. A aba é `?aba=agora`, navegada por dois
`<a>` com `aria-current`, e a barra de progresso carrega os atributos ARIA com o tempo
restante em TEXTO. As bordas: começar agora é estar em curso; terminar agora não é.

**Justificativa.** Um "agora" calculado no cliente faz duas partes da mesma tela
discordarem (a barra de uma, o rótulo de outra), mente para quem abre a página com o
relógio adiantado e obriga o bundle a existir para a tela funcionar. E a aba precisa ser
um ENDEREÇO: a pergunta "o que está acontecendo agora?" chega por mensagem, e quem
recebe o link tem de cair na mesma vista. As bordas não são as da sobreposição porque a
pergunta é outra (ver §2.1); reusá-las faria o cartão dizer "em curso" para o que acabou.

**Consequências.** (a) A página do evento ficou `force-dynamic` (já era: a janela de
inscrição e a contagem regressiva já dependiam do instante); (b) a visão vazia é explícita
(`EMPTY_HAPPENING_NOW`) e a pré-visualização do rascunho a usa — ela não afirma "3
atividades em curso" sobre um relógio que ninguém pediu; (c) a barra é REFORÇO: o tempo
restante em texto é a informação, e é isso que a torna acessível sem cor.

### ADR-336 — A agenda sai por ARQUIVO e por link do Google; a assinatura `webcal` fica declarada

**Contexto.** O participante quer a grade no calendário do celular. Havia três caminhos
possíveis: (a) uma **assinatura** (`webcal://`) que o cliente atualiza sozinho; (b) um
**arquivo** `.ics` baixado, com o link do Google ao lado; (c) os dois.

**Decisão.** (b), agora. O `.ics` é gerado no servidor a cada requisição, em duas rotas:
a grade inteira (token da pessoa) e uma atividade (id público, sem dado de ninguém). A
**assinatura fica declarada como dívida (E85)**, junto com a revogação individual do
endereço.

**Justificativa.** A assinatura exige um endereço ESTÁVEL e um cliente que o releia — o
que, com o token atual, significa: token determinístico que não pode ser revogado
individualmente (o endereço vale enquanto o vínculo valer) e nenhuma noção de "assinatura
ativa ou cancelada". Entregar `webcal` sem isso seria prometer uma revogação que não
existe. O arquivo + o Google cobrem o caminho real de hoje (o Google por URL cria UM
compromisso, e é honesto oferecer o PRÓXIMO item, não "a grade"; a grade inteira vai pelo
arquivo, que o Google importa em massa e que o Apple/Outlook leem sozinhos).

**Consequências.** (a) O botão do Google na "minha agenda" oferece o **próximo** item
(o primeiro cujo fim ainda não passou), nunca "a grade" — prometer a grade num botão que
cria um evento seria uma mentira que só apareceria no dia do evento; (b) trocar
`BETTER_AUTH_SECRET` invalida todos os endereços já entregues (o mesmo custo do link da
carta e do cofre do sorteio; a pessoa recupera o endereço abrindo a tela de novo);
(c) a dívida E85 ganhou os dois lados que faltam para a assinatura.

---

## 5. Lições aprendidas (defeitos REAIS, com o número)

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | A atividade **"Introdução à Computação"** chegou ao calendário **sem nome**, e o cliente não deu erro nenhum | A dobra da linha em 75 octetos estava contando CARACTERES. `ç` e `ã` ocupam 2 octetos cada: a linha estourava o limite antes do que a contagem sugeria, e o corte ingênuo por bytes **partia o caractere UTF-8 no meio** — sequência inválida, propriedade descartada pelo cliente | `foldIcsLine` percorre CODE POINTS (`for…of`) e mede cada um com `TextEncoder`: a primeira linha usa 75 octetos, as continuações usam 74 (o espaço inicial conta), e um caractere nunca é partido. Preso em `tests/unit/f65-ics.test.ts` |
| 2 | A primeira barra de progresso media **1,96:1** e era praticamente invisível no claro | O par escolhido por intuição foi `--ef-success` (`#10b981`) sobre o trilho `--ef-surface-variant` (`#dfe2ee`). O mínimo do AA para componente de interface é 3:1 — e o preenchimento é DADO (quanto falta), não enfeite | Medição antes da escolha: `--success-strong` (`#047857`) sobre `--surface-high` (`#e5e8f4`) = **4,49:1** no claro e **9,12:1** no escuro, presos um a um na catraca |
| 3 | O cartão da programação mostrava **13:00** para uma atividade das **10:00** — e o rodapé da mesma página prometia "Horários em America/Bahia" | O cartão formatava o horário **sem `timeZone`**, ou seja, no fuso do PROCESSO (o container roda em UTC). O mesmo defeito tinha um irmão no `<select>` de evento da "minha agenda", que imprime a data de abertura | A régua passou a ser `formatZonedDateTime` com o fuso do EVENTO — a MESMA da grade e da visão do "agora". Preso no E2E funcional (bloco (d)) nos dois lugares |
| 4 | O aviso da plataforma **não serve sobre o fundo que o organizador escolheu** | O par de aviso da plataforma é de duas águas: `warning-strong` (`#92400e`) mede 5,64:1 sobre o cartão claro do evento e **2,46:1** sobre o escuro; `warning-strong-on-dark` (`#fcd34d`) mede 12,11:1 sobre o escuro e **1,15:1** sobre o claro. O organizador pode ter escolhido qualquer um dos dois — não existe um tom que sirva | O aviso de choque, na variante do tema, desenha-se com o `currentColor` do próprio tema (borda e fundo tirados do texto) e a informação fica no ÍCONE + na PALAVRA + nos dois títulos. A variante do painel segue com os tokens medidos da F52 |
| 5 | O endereço do `.ics` não pode ser **revogado individualmente** | O token é `HMAC-SHA256(tenantId:userId)` — derivado, determinístico e sem tabela. Desativar o vínculo corta o acesso na hora (a resolução confere o vínculo a cada requisição), mas "gerar um link novo" não existe | Não é defeito escondido: é **dívida declarada (E85)**, com o desenho alternativo escrito (token aleatório em tabela exigiria a migração que a fatia 1 fechou). O `cache-control: no-store` impede que o arquivo sobreviva ao vínculo |
| 6 | O portão WCAG AA ficou **VERMELHO** e a catraca de unidade ficou **quebrada** — sem ninguém para relatar | O agente anterior morreu no meio da fatia 5: deixou `tests/unit/f65-acontecendo-agora.test.ts` chamando `EVENT_THEME_PALETTE`, `corDoCss`, `misturarOklab` e `contrasteRgb` — **quatro símbolos que não existiam** (`ReferenceError`, 1 de 19 casos), e a aba do "agora" reprovando o portão com 4 nós | A catraca foi terminada (a régua reaproveitada do domínio + a conta do `color-mix(in oklab)` conferida contra o navegador) e o portão fechou sem isenção. **A lição não é sobre o código**: um agente que morre sem relatar deixa um estado que PARECE pronto (os arquivos existem, o teste "existe") e não está — quem retoma precisa rodar a bateria inteira, e não confiar no que a fatia anterior disse ter feito |
| 7 | Duas execuções seguidas da MESMA tela deram **822 pixels diferentes** numa linha de base que deveria ser estável | A máscara estava no `<dd>` do horário (o nó cujo TEXTO muda). O dado saiu tapado, mas a CAIXA da máscara mudou de largura junto com o texto e **empurrou o nome da sala ao lado** — a diferença apareceu a 137 px de distância do nó mascarado | Mascarar CONTÊINERES de largura fixa (o trilho inteiro, a linha de informação, o parágrafo, a linha do "a seguir"). O dado continua tapado e a caixa passa a MEDIR o desenho: uma barra que engorda ou uma linha que quebra mudam a caixa magenta e reprovam |
| 8 | A asserção das duas marcas dizia `Received: 2` para uma marca que existe em UM cartão | O `data-mark` existe no `<li>` (a marca do item) e no distintivo dentro dele. O seletor pelo atributo solto contava o cartão **e** o rótulo — a asserção media "quantos elementos têm a marca", não "quantos itens da grade são de cada tipo" | `li[data-mark="…"]`: o teste pergunta o que quer saber. (É a versão barata da lição 103: o seletor tem de casar com o FATO, não com o texto do atributo) |

---

## 6. Evidência de verificação (saída real)

### Banco: a migração do drift, o status e a prova de que não sobra diferença

```text
$ npx prisma migrate status
53 migrations found in prisma/migrations
Database schema is up to date!

$ npx prisma migrate deploy
53 migrations found in prisma/migrations
No pending migrations to apply.

$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
No difference detected.
exit=0
```

A migração `20261004120000_f64_updatedat_sem_default` corrige o drift da FASE 64 — a
coluna nasceu com `DEFAULT CURRENT_TIMESTAMP` na migração e `@updatedAt` no schema. No
banco de hoje:

```text
$ SELECT column_name, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_name='tenant_public_pages' AND column_name='updatedAt';

 column_name | column_default | is_nullable
-------------+----------------+-------------
 updatedAt   |                | NO
```

### Contrato e isolamento

```text
$ npm run db:verify
  ✓  RLS habilitada + FORCE em todas as tabelas com tenantId
  ✓  Nenhuma tabela com RLS ficou sem policy
  ✓  Role "eventflow_app" sem superuser e sem BYPASSRLS
  ✓  GRANTs mínimos presentes, TRUNCATE ausente
  ✓  Tabela(s) de plataforma inalcançável(is) pela role "eventflow_app"
  Contrato íntegro.

$ npm run db:verify:isolation
  ✓  [A1] Sem contexto de tenant, nenhuma linha é visível (fail-closed)   count = 0
  ✓  [A2] Tenant A enxerga apenas os próprios eventos                     viu 1 evento(s)
  ✓  [A3] UPDATE em evento de outro tenant afeta 0 linhas                 rowCount = 0
  ✓  [A4] DELETE em evento de outro tenant afeta 0 linhas                 rowCount = 0
  ✓  [A5] INSERT com tenantId de outro tenant é rejeitado pelo WITH CHECK
  ✓  [A6] Tenant A enxerga apenas os próprios vínculos de usuário         viu 1 vínculo(s)
  ✓  [A7] COUNT(*) agregado conta apenas o próprio tenant                 count = 1
  ✓  [A8] Contexto de tenant não vaza para a transação seguinte (SET LOCAL)
  ✓  [A9] Role de runtime não consegue desligar a RLS nem escalar privilégio
  9/9 verificações passaram.
```

### Qualidade

```text
$ npm run lint          → exit 0 (0 erros, 0 warnings)
$ npm run typecheck     → exit 0 (0 erros)
$ npm test
  Test Files  171 passed (171)
       Tests  3212 passed (3212)
    Duration  192.69s

$ npm run build
  ✓ Compiled successfully in 11.4s
  ├ ƒ /api/t/[tenantSlug]/agenda/ics
  ├ ƒ /t/[tenantSlug]/minha-agenda
```

### As catracas da fase

```text
$ npx vitest run tests/unit/f65-*.test.ts tests/integration/f65-favoritos.test.ts
  ✓ tests/integration/f65-favoritos.test.ts (16 tests)
  ✓ tests/unit/f65-ics.test.ts (23 tests)
  ✓ tests/unit/f65-acontecendo-agora.test.ts (24 tests)
  ✓ tests/unit/f65-sobreposicao-e-grade.test.ts (20 tests)
  ✓ tests/unit/f65-exportacao-de-agenda.test.ts (13 tests)
  ✓ tests/unit/f65-aviso-de-choque.test.ts (11 tests)
  Test Files  6 passed (6) · Tests  107 passed (107)

$ npx playwright test tests/e2e/accessibility.spec.ts
  19 passed (19 casos, ISENCOES = [])

$ npx playwright test tests/e2e/f62-regressao-visual.spec.ts
  19 passed (19 linhas de base)

$ npx playwright test --output=<dir fora da árvore>       (a suíte INTEIRA)
  1 skipped
  339 passed (8.2m)
```

A suíte inteira foi rodada **duas vezes**, e a segunda está registrada porque ela é o caso da
dívida **I3** ("vermelho só é vermelho depois de rodado isolado"):

```text
$ docker compose --profile app up -d --build web worker   (imagem de 2026-10-04 08:40:32)
$ npx playwright test --output=<dir fora da árvore>
  1 failed   › f51-credential-badge.spec.ts:439 › 3. trocar a categoria de UM crachá não troca o código
  1 skipped
  338 passed (8.5m)

$ npx playwright test tests/e2e/f51-credential-badge.spec.ts --grep "trocar a categoria de UM crachá"
  ✓  1 ... (2.7s)   → 1 passed (4.7s)
```

O vermelho **não** é da fase: é a spec e o mecanismo já declarados na dívida **E83** (o clique
tardio do laço do `<select>` do crachá, que floca sob carga e passa isolado), e o arquivo não foi
tocado por esta fase. Fica dito com as duas medições, porque um vermelho sem a rodada isolada é
exatamente o falso vermelho que a I3 descreve.

Os dois últimos comandos rodam contra o **container** (`docker compose --profile app up -d
--build web worker`): o portão e a catraca visual medem a tela renderizada, e o E2E mede o
servidor de produção. A armadilha da §4 do `AGENTS.md` vale aqui — se o `--build` falhasse, o
container ANTERIOR ficaria no ar e a suíte mediria código que não existe. Conferido:

```text
$ docker images eventflow/web:local --format "{{.Repository}}:{{.Tag}} criada em {{.CreatedAt}}"
eventflow/web:local criada em 2026-10-04 08:00:21 -0300
```

E a rota nova respondeu 200 já na primeira execução do portão (a tela "minha agenda" é afirmada
por conteúdo — `#minha-agenda`, os quatro contadores —, e um container velho daria 404).

### A catraca nova MORDE (mutação real na interface)

Três mutações, uma por decisão que a catraca da fase prende, e as três reprovaram:

```text
1. `.ef-muted` de 60% para 40% (event-theme.css)
   ✗ o `.ef-muted` passa nos dois modos … expected 2.74 to be >= 4.5
   ✗ a conta da mistura reproduz o MOTOR … expected '#9698a0' to be '#686b73'
   → 2 falhas de 24

2. a migalha de volta para `opacity-60` (event-landing.tsx)
   ✗ o `ef-muted` é o mecanismo do texto secundário … not to contain 'opacity-60'
   → 1 falha de 24

3. `text-success-strong` de volta no tempo restante (happening-now.tsx)
   ✗ o semáforo do "em curso" é a BARRA e o TEXTO … not to contain 'text-success-strong'
   → 1 falha de 24

(as três mutações foram desfeitas; a árvore voltou a 24/24 verde)
```

---

## 7. Comandos operacionais

```bash
# As catracas da fase
npx vitest run tests/unit/f65-sobreposicao-e-grade.test.ts
npx vitest run tests/unit/f65-ics.test.ts
npx vitest run tests/unit/f65-exportacao-de-agenda.test.ts
npx vitest run tests/unit/f65-aviso-de-choque.test.ts
npx vitest run tests/unit/f65-acontecendo-agora.test.ts
npx vitest run tests/integration/f65-favoritos.test.ts

# O portão de acessibilidade e a catraca visual
npx playwright test tests/e2e/accessibility.spec.ts
npx playwright test tests/e2e/f62-regressao-visual.spec.ts

# O E2E funcional da fase (o .ics, o Google, a minha agenda, a aba do agora)
npx playwright test tests/e2e/f65-minha-agenda.spec.ts tests/e2e/f65-exportacao.spec.ts

# A migração e o contrato
npx prisma migrate deploy && npx prisma migrate status
npm run db:verify && npm run db:verify:isolation

# Regenerar as linhas de base (ABRA as imagens depois — ver o cabeçalho do f62)
npx playwright test tests/e2e/f62-regressao-visual.spec.ts --update-snapshots
```

O E2E exige o container servindo o código novo (`docker compose --profile app up -d
--build web worker`); o portão e a catraca visual também, porque medem a tela renderizada.

---

## 8. Dívidas técnicas e pontos de atenção

Declaradas nesta fase (as duas últimas linhas do levantamento, com os códigos conferidos
— o último usado era **E84**):

| Item | O que é | Por que ficou | Esforço |
|---|---|---|---|
| **E85** | **A assinatura `webcal` e a revogação individual do endereço de exportação** | O token é derivado (HMAC), não revogável um a um; a assinatura precisa de endereço estável e de um cliente que o releia. Os dois lados estão escritos no ADR-336 | M |
| **E86** | **A margem de deslocamento entre salas no choque** | O aviso usa o **intervalo puro**: duas atividades em salas DIFERENTES que terminam e começam no mesmo minuto não são choque, mas na prática a pessoa não tem tempo de atravessar o campus. A decisão do humano foi avisar sobre o intervalo puro e declarar a margem como dívida | S |

Pontos de atenção medidos, que **não** são dívidas de produto e ficam registrados para a
próxima fase decidir:

1. **A aba "Programação" da página do evento está fora do portão WCAG AA — e tem uma
   violação séria.** Medido com o `axe` (mesmo conjunto de tags do portão) na fixture
   desta fase:

   ```text
   color-contrast (serious) — 1 nó
     <p class="text-xs font-semibold uppercase tracking-wider opacity-60">Programação</p>
     fgColor #72747c · bgColor #f9f9ff · contrastRatio 4.44 · esperado 4.5:1
   ```

   O nó é o `eyebrow` do `SectionHeading` (`src/components/events/theme-scope.tsx:118`),
   um componente **anterior a esta fase** (arquivo não tocado por ela) usado por todos os
   cabeçalhos de bloco da página — "Programação", "Patrocinadores", "Chamadas de
   propostas"… É a MESMA causa dos três nós que a fatia 5 corrigiu (`opacity-60` sobre a
   `--ef-background` do organizador, 4,44:1) e a correção seria a MESMA classe
   (`ef-muted`). Não foi corrigido aqui por estar **fora do escopo desta fatia**, e é
   corrigi-lo exige levar a aba "Programação" ao portão (o 20º caso) — decisão de quem
   aprova, com o número na mão.
2. **As linhas de base de pixel valem para ESTE ambiente** (Chromium deste host + o
   servidor do projeto). Em outra máquina o sufixo de plataforma muda e o Playwright
   escreve um arquivo novo e FALHA — a falha é a mensagem certa (ver o cabeçalho do
   `f62-regressao-visual.spec.ts`).
3. **O ponto de entrada da "minha agenda" é um LINK, não um item de menu.** O caminho é
   `/minhas-inscricoes` → "Ver a minha agenda do dia" (e o topo da programação → "Ver a
   minha agenda deste evento"). Um item na barra lateral mexeria em ~10 linhas de base de
   pixel (barra inteira, recolhida, gaveta, painel e diretório, nos dois modos) para
   oferecer um caminho que já está a um clique — e a decisão está escrita no comentário da
   tela.
4. **A cor do organizador continua sendo responsabilidade dele.** As classes medidas
   (`.ef-muted`, `currentColor`) partem da paleta que o organizador escolheu; um tema com
   contraste base baixo derruba qualquer tom derivado. O portão mede o tema PADRÃO, que é
   o de quem não escolheu nada — e a régua da FASE 61 diz que na página do evento quem
   responde pela paleta é ele.

---

## 9. Checklist de aceite

| Requisito (do plano da fase) | Situação |
|---|---|
| "Minha grade" = FAVORITOS ∪ INSCRIÇÕES, com marcas visuais distintas | ✅ `buildMyAgenda` + `AgendaMarks`; os contadores e as duas marcas presos no E2E e na linha de base |
| **Favoritar NÃO consome vaga** (loteria, lista de espera e quota intactas) | ✅ `activity_favorites` independente; teste de integração com atividade LOTADA |
| O detector de choque **só avisa, nunca bloqueia** (na escolha, na agenda e no resumo) | ✅ `intervalsOverlap` no domínio, aviso com `role="note"`, Server Action grava de qualquer jeito; E2E marca a segunda atividade sobreposta COM o aviso |
| Aviso sobre o **intervalo puro**; margem de deslocamento entre salas como dívida | ✅ e **E86** declarada |
| Exportação: `.ics` por atividade **e** da grade inteira, botão do Google; Apple pelo próprio arquivo | ✅ duas rotas do `.ics` + `googleCalendarUrl`; E2E confere o CONTEÚDO do arquivo e a URL do Google |
| **Assinatura `webcal` fica como dívida declarada** | ✅ **E85** |
| "Acontecendo agora": aba na página do evento **+** faixa no topo da programação quando houver algo em curso | ✅ `?aba=agora` + `HappeningNowBanner` (que devolve `null` sem nada em curso) |
| O "agora" decidido **no servidor, no fuso do evento** | ✅ instante injetado em `buildHappeningNow`; teste do fuso (10:00, não 13:00) |
| Atividades **em andamento por sala** | ✅ agrupamento por sala, com o "a seguir nesta sala" |
| **Barra de progresso acessível** (tempo restante em texto, não decorativo) | ✅ `role="progressbar"` + `aria-valuetext` + `agora-restante`; E2E funcional e portão |
| Link direto para o **crachá do participante** ou o **balcão** (com permissão) | ✅ `agenda.authenticated` e `registration:checkin` conferidos no servidor (escopo de TENANT **e** de EVENTO) |
| Unidade + integração (RLS, favoritar/desfavoritar, isolamento) + E2E | ✅ 107 casos de Vitest (6 arquivos) e 23 de E2E |
| **Portão WCAG AA com as telas novas, sem isenção** | ✅ 19 casos, `ISENCOES = []` (a aba "Programação" **não** está no portão — ponto de atenção nº 1 da §8) |
| **Regressão visual** com a barra do "agora" mascarada | ✅ 19 linhas de base (+3), com as quatro máscaras e o motivo declarado |
| `docs/fase-65-dia-do-evento.md` (ADR-334+) + `README.md` + `AGENTS.md` + dívidas | ✅ este documento, ADR-334/335/336, as duas linhas novas (E85/E86) e as três atualizações |
| Regras da casa: runtime só por `withTenant`, sem `any`, erros como valor, comentários explicam POR QUE | ✅ a rota do `.ics` resolve o token e lê a grade por `withTenant`; os serviços devolvem `{ ok } \| { ok: false, code, message }` |
| "NÃO altere `playwright.config.ts` nem `src/app/globals.css`" | ✅ nenhum dos dois foi tocado (a única alteração de cor foi em `event-theme.css`, com a medição declarada) |

**O que esta fase NÃO tocou, e é decisão:** `playwright.config.ts`,
`src/app/globals.css` (nenhum token da plataforma mudou — a correção de contraste ficou no
CSS do TEMA), os serviços e as regras das fatias 1 a 4 (nenhum defeito foi achado neles) e
as specs de outras fases — a única exceção autorizada foi a **tabela de landmarks do
`f60-landmark.spec.ts`**, que não precisou mudar (a tela nova herda um `<main>` da
`EventLanding`).
