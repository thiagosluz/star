# FASE 84 — O painel é do perfil, e a prova do RBAC é da identidade

> **Tema:** o painel da instituição deixou de ser a **parede de permissões** que provava o
> motor de RBAC (65 chaves cruas, UUID de evento ao lado de cada papel, um contador de
> "Permissões efetivas") e passou a responder à pergunta de quem abre o sistema de manhã —
> **"o que, para MIM, importa aqui?"**. Quais atalhos aparecem, em que ordem, quantos cabem e
> quantos ficaram de fora é **regra pura** (`dashboardBlocksFor`, teto 5, colapso de destino
> repetido **antes** do teto e anúncio do que sobrou); a prova do RBAC mudou de casa para
> `/conta`, que é **global**, com o papel pelo **rótulo** (`roleLabel`) e um **número** de
> permissões efetivas. **ADR-382 e ADR-383.**
> **Base:** a FASE 83 fechou o vínculo com significado (desempate + pergunta); esta fase usa
> os fatos que a casca já resolvia (`context.principal`, `context.memberships`) e **mede** o
> que a tela lê. A FASE 75 já tinha removido a segunda leitura do principal das três telas de
> gestão e do shell — o painel era a **duplicata que ficou de fora**, e entrou na catraca.
> **Fatias:** 1 (regra pura + `access-summary` + o cartão "Seus acessos" em `/conta`),
> 2 (o painel reconstruído + botão de contexto + baselines). As duas entregues; a fase fecha
> com a bateria completa e a suíte E2E inteira.

---

## 1. Sumário executivo

| Entrega | Onde | Prova |
|---|---|---|
| O **catálogo de 9 blocos** com precedência declarada, **teto 5**, **colapso de destino repetido antes do teto** e a frase "e mais N atalhos" — tudo em domínio puro, sem banco, sem sessão e sem Next | `src/domain/platform/dashboard-blocks.ts` (novo) | **46 casos** em `f84-painel-do-perfil.test.ts` |
| O **résumé do vínculo** para a pessoa: papel pelo **rótulo** do catálogo (nunca a chave crua), chave fora do catálogo **descartada** e o **número** de permissões EFETIVAS (união, não soma) | `src/domain/rbac/access-summary.ts` (novo) | os mesmos 46 casos (bloco "o resumo do vínculo") |
| O **7º cartão "Seus acessos"** em `/conta`: instituição pelo nome, situação por Badge, papéis por `roleLabel`, nº de permissões e o link de volta — pagando **UMA** consulta (a de vínculos que a página já fazia) | `src/app/conta/page.tsx` | E2E `auth-tenancy` reaponteado para `/conta` (47 = 43 do organizador + 8 do revisor − 4 repetidas) |
| **O painel reconstruído**: saíram `role-summary`, `permissions`, o cartão "Permissões efetivas", o rodapé com o placeholder falso e a URL canônica; entraram até 5 cartões por perfil (`dashboard-block-<id>`), `stats` só na gestão (de `getAdminOverview`, que filtra `deletedAt`), a frase do que ficou de fora e o estado vazio com link para `/conta#seus-acessos` | `src/app/t/[tenantSlug]/(app)/dashboard/page.tsx` | **6 casos** em `f84-painel-do-perfil.spec.ts` + **9 catracas de fonte** em `f84-painel-da-fatia-2.test.ts` |
| O **botão de contexto** no slot `actions` do `PageHeader` — nome da instituição + "Trocar" (com "de instituição" em `sr-only`), `data-testid` **novo** (`dashboard-context`) | `src/components/shell/dashboard-context.tsx` (novo) | catraca de fonte: não reusa `active-tenant` nem `admin-stats`; E2E dos 6 perfis |
| A **segunda leitura do principal removida** do painel, com a catraca de integração da FASE 75 **estendida** a ele (1 + 1, não 2 + 2) | `tests/integration/f75-contexto-uma-vez.test.ts` | caso "o painel da instituição: 1 memberships + 1 principal" |
| **4 baselines do painel refeitas** porque a tela mudou de conteúdo (não de token) | `f62-regressao-visual.spec.ts` + 4 PNGs | duas execuções seguidas a **0 px** |
| A imagem **antes × depois** do painel + o cartão de `/conta` | `docs/imagens/f84-painel-e-acessos.png` | spec temporário **apagado** |

**Números da fase**

```text
Arquivos de código .............. 5 (3 novos: dashboard-blocks, access-summary,
                                     dashboard-context; 2 alterados: dashboard/page, conta/page)
Testes novos .................... 55 no Vitest (46 + 9) + 1 caso novo na catraca da F75
                                     + 6 no E2E (a suíte Vitest cresceu 56: 4548 em 254)
Vitest .......................... 4548 em 254 arquivos — 0 vermelhos
E2E ............................. 487 (486 passando + 1 skip), ZERO vermelhos
Migrações ....................... 0
ADRs ............................ 2 (ADR-382, ADR-383) — a próxima é a 384
Dívidas novas ................... 2 (E91 e I10) — a contagem vai de 44 para 46
Fontes de leitura no pior perfil  6 (declarado; em comandos SQL seriam ~20)
```

---

## 2. O problema mais difícil: **um atalho é uma tela que existe**

O painel nasceu na FASE 2 como **demonstração verificável do RBAC**: ele mostrava os papéis
acumulados com escopo (e o UUID do evento ao lado de cada um) e a lista crua de **todas** as
permissões efetivas. Durante oitenta e duas fases isso foi útil — era a tela em que se
depurava autorização sem abrir o banco. O problema não era ela existir; era ela ser a
**primeira tela que todo mundo abre**.

A tentação natural da fase era a simétrica da anterior: se o painel mostrava **permissões**,
que ele mostrasse **um cartão por permissão**. A medição derrubou a ideia em três pontos:

1. **A permissão não é um destino.** `tenant:billing:manage` existe no catálogo, está no
   pacote do `FINANCE` e **não tem leitor nenhum** no produto: não há tela de financeiro nem
   de cobrança no App Router. Um cartão "Financeiro" prometeria uma tela que não existe — e
   o pior defeito de um atalho é parecer que funciona. É a régua da **armadilha 75** ("uma
   coluna que o schema promete e ninguém lê"), aplicada a uma **permissão** em vez de a uma
   coluna. O papel `FINANCE` tem **oito** permissões e **nenhuma** tela própria de finanças.
2. **O pacote mínimo faz o cartão mentir.** Todo `OWNER` recebe `TENANT_PERMISSIONS` inteiro —
   **65** permissões —, inclusive `speaker:profile:update:own`. Deduzir "Portal do
   palestrante" da permissão faria **todo dono** ver o cartão sem ter perfil de palestrante.
   O fato certo é o **papel `SPEAKER`**, que nasce no aceite do convite (FASE 25).
3. **A tela não pode ser a mesma para todo mundo.** O dono, o revisor e o participante viam
   exatamente a mesma lista. Nenhum dos três conseguia responder à pergunta que faz abrir o
   sistema de manhã.

O problema mais difícil da fase, então, não foi desenhar cartões: foi **decidir o que é um
atalho**. A resposta que o desenho adotou tem três condições, e cada uma custou uma decisão
declarada: o destino **existe** (FINANCE fica em estado vazio), o destino **abre para aquele
perfil** (`/administracao` exige `tenant:member:invite`, que o `ORGANIZER` não tem — por isso
o bloco de gestão aponta para `/administracao/eventos`), e o fato que liga o cartão é um
**fato do produto** (o vínculo de patrocinador, o papel de palestrante, o convite pendente),
nunca uma permissão larga que todo mundo carrega.

O segundo problema — menor, mas que define o orçamento da tela — é que o painel é a superfície
mais aberta do sistema. Ele precisava provar, no código e no relatório, **quantas leituras**
custa. A resposta não é um número solto: é uma **régua** (§3.7).

---

## 3. Decisões técnicas

### 3.1 A decisão é do domínio, e a página só desenha

`dashboardBlocksFor(subject)` recebe os fatos **já apurados** (`roles`, `hasDeadlineAction`,
`hasSpeakerProfile`, `hasSponsorLink`, `hasPendingInvite`) e devolve
`{ blocks, hidden }`. Ela **não lê sessão, não lê banco e não decide autorização**.

**Por que uma função pura, e não `if` na página:** a matriz é **onze papéis × combinações**, e
o teste tem de prová-la sem banco, sem sessão e sem Next. Uma regra dentro do Server Component
só seria exercitável com infraestrutura — e é justamente a matriz que precisa de prova
barata. Com a regra no domínio, **46 casos** rodam em milissegundos e um papel novo no
catálogo faz o caso "cobre os ONZE papéis" reprovar até alguém declarar o comportamento dele.

**Alternativa descartada:** calcular os blocos na página com uma cadeia de `if` por papel.
Passaria no E2E e seria intestável — a primeira condição nova (um vínculo, um prazo) entraria
sem prova de que não quebrou as outras dez.

### 3.2 A precedência, o teto de cinco e o anúncio do que ficou de fora

A ordem **é** o contrato, e ela também decide quem sobrevive ao teto:

| # | Bloco | Gatilho | Destino |
|---|---|---|---|
| 1 | `acuacao-prazo` | algo com **prazo** esperando a pessoa (vaga retida, oferta da fila) | `/minhas-inscricoes` |
| 2 | `gestao` | papel de gestão (`OWNER`/`ADMIN`/`ORGANIZER`, ou `event:manage`) | `/administracao/eventos` |
| 3 | `participacao` | `registration:read:own` | `/minhas-inscricoes` |
| 4 | `submissoes` | `submission:read:own` | `/submissoes` |
| 5 | `pareceres` | `review:submit:own` **ou** `submission:read:any` | `/revisoes` |
| 6 | `palestrante` | **perfil** de palestrante (papel `SPEAKER`) | `/palestrante` |
| 7 | `patrocinador` | **vínculo** `sponsor_users` ativo | `/patrocinador` |
| 8 | `equipe` | `registration:checkin` | `/credenciamento` |
| 9 | `convite` | convite de equipe `INVITED` | `/conta#seus-acessos` |

**O teto é cinco** porque o painel não é um catálogo: a partir da sexta fileira o olho lê
"menu" e não "o que importa". O que fica de fora é sempre a **cauda** da precedência — e a
tela **anuncia** quantos atalhos ficaram (`dashboardHiddenPhrase`), pela regra da F50/F51 ("o
que a tela esconde, ela anuncia"). A frase é do **domínio**, e não da página, porque o número
que ela diz é o número que a **regra** cortou: se a página fizesse `slice(0, 5)` por conta
própria, o anúncio poderia divergir do corte no dia em que o teto mudasse.

**O colapso acontece ANTES do teto.** Dois blocos podem apontar para a mesma tela
(`acuacao-prazo` e `participacao` levam a `/minhas-inscricoes` quando a pendência é uma vaga
retida). Dois cartões para o mesmo destino não são dois atalhos: são o mesmo atalho dito duas
vezes, e ocupariam vaga. O colapso deixa o de **maior precedência** e o outro **não entra em
`hidden`** — ele não é um atalho escondido, é o mesmo atalho. Com os nove gatilhos ligados, os
destinos distintos são oito: cinco cabem e **três** são anunciados (não quatro).

**Alternativa descartada:** cortar em cinco e anunciar `selected.length - 5` **sem** colapsar.
O número anunciado seria um a mais e a pessoa procuraria um atalho que não existe em lugar
nenhum.

### 3.3 A prova do RBAC mudou de casa — e virou um número com nome

`/conta` é **global**: a identidade vale em qualquer instituição, e é o único lugar onde os
vínculos de casas diferentes convivem. O 7º cartão, **"Seus acessos"**, mostra por vínculo:
instituição pelo **nome**, situação por **Badge** ("Ativo" × "Convite pendente"), os papéis
pelo **rótulo** do catálogo (`roleLabel`: `OWNER` → "Proprietário(a)"; `PARTICIPANT` →
"Participante") e **quantas permissões efetivas** o conjunto soma.

- As **chaves cruas** (`submission:decide`) saíram da interface. O que o produto já sabia
  traduzir na equipe (`roleLabel`, em uso desde a F15) passou a valer também aqui.
- O número é a **união** dos pacotes (dois papéis que compartilham `tenant:read` somam uma
  permissão, não duas). Medido: **14** = `PARTICIPANT_PERMISSIONS`; **65** =
  `TENANT_PERMISSIONS`; e o par ORGANIZER + REVISOR dá **47** (43 + 8 − 4 repetidas).
- **Chave fora do catálogo é DESCARTADA**, não exibida: um papel que não existe não tem
  rótulo em português nem pacote. Se um dia houver papel legado no banco, o lugar de tratá-lo
  é uma migração — não a tela da pessoa.
- A ordem é **alfabética pelo rótulo**, e não a de chegada do banco: os papéis vêm de um `Set`
  e sem ordenação declarada a mesma pessoa veria "Revisor(a) · Coordenação" hoje e o inverso
  amanhã.
- **Uma consulta**: a seção usa a lista de vínculos que a página já carrega. Um cartão novo na
  tela da identidade não podia custar uma leitura nova.

**Por que um NÚMERO, e não a lista:** a lista crua era o que o painel desenhava; reproduzi-la
em `/conta` só mudaria a parede de lugar. O número responde "o que eu posso aqui?" sem virar
texto ilegível, e o detalhe continua acessível pelo caminho normal (a tela da instituição, a
equipe, o catálogo).

**Alternativa descartada:** manter a lista completa em `/conta` atrás de um `<details>`. O
componente medeia ~65 chips por vínculo e o `<details>` fechado é o mesmo conteúdo invisível —
o problema não era estar escondido, era existir como prova em vez de resposta.

### 3.4 O convite é um fato GLOBAL, e por isso o bloco não aponta para a instituição

Oito dos nove blocos apontam para uma tela **dentro** da instituição, e `dashboardBlockHref`
monta o caminho com `tenantPath` — nenhuma página repete `/t/<slug>`. A exceção é `convite`:
o convite de **equipe** pendente é um fato da PESSOA (o vínculo `INVITED` pode ser de outra
casa) e o aceite exige o **código que só existe no e-mail**. A rota `t/<slug>/convite` sem
código responde "convite não encontrado", e mandar alguém para lá seria um link que parece
funcionar e não funciona. O destino é `/conta#seus-acessos`, onde os acessos — inclusive os
pendentes — passam a ser listados.

**Consequência aceita:** o bloco aparece no painel de uma instituição para um convite de
OUTRA. É o comportamento correto (o fato é da pessoa) e está provado no E2E, caso 6.

### 3.5 A casca ainda cola chave crua e plano — e `PROFESSIONAL` não é papel

A linha secundária do bloco de contexto (`app-shell.tsx`, alimentado por
`src/app/t/[tenantSlug]/(app)/layout.tsx:121`) compõe literalmente
`` `${membership.roles.join(' · ')} · ${tenant.plan}` ``. Duas coisas erram ali: o papel sai
como **chave** (`OWNER`, `PARTICIPANT`) e o **plano** (`FREE`, `PROFESSIONAL`) aparece colado
na mesma frase, com a mesma forma, como se fosse mais um papel. "OWNER · FREE" é o que a
imagem "antes" da fase mostra.

**Não foi consertado nesta fase, de propósito.** A correção da linha mexe no bloco da casca,
que é fotografado em **12+ baselines** e é lido por `auth-tenancy:192,202`; é um movimento
próprio, com o mesmo cuidado de re-basear que esta fase teve com 4 imagens. Fica declarado no
§8.2, com o desenho do conserto (rótulo pelo catálogo; o plano em palavra do produto, não em
enum).

O que a fase mostrou é que os **números do catálogo** são a régua para qualquer tradução:
**14** é o pacote de participante e **65** o de instituição — se uma frase nova disser outro
número para esses mesmos papéis, ela está errada.

### 3.6 As decisões declaradas de perfil: CHAIR, FINANCE e o que ficou fora

Três perfis exigiram decisão, e as três foram **de escopo**, não de código:

1. **CHAIR fica no estado vazio honesto.** A cadeira tem `submission:read:any` e trabalha no
   **comitê** (`/comite`), não na fila de pareceres. A regra tem **um `path` por bloco**, e o
   bloco `pareceres` aponta para `/revisoes` — que abre para qualquer vínculo e mostra a lista
   honesta (mesmo vazia). A alternativa seria um cartão com dois destinos, o que a regra não
   representa. O E2E clica no cartão e **mede** o estado vazio de `/revisoes` em vez de
   supor. O **bloco `comite`** (gatilho `submission:read:any` → `/comite`) fica **proposto
   para uma fase futura**, com a pergunta de produto que ele exige: o mesmo perfil veria
   "Meus pareceres" e "Comitê científico" — dois cartões para o mesmo trabalho?
2. **FINANCE fica em estado vazio até existir tela de financeiro.** Oito permissões, nenhuma
   tela de cobrança. O painel mostra o estado vazio com o link para `/conta#seus-acessos` em
   vez de um cartão quebrado. A dívida nova **E91** registra o que falta (§8.1).
3. **`listAdminEvents` fica fora.** Seria a **7ª fonte** de leitura no pior perfil, e o bloco
   de gestão **não desenha linhas** — o cartão diz "2 eventos no ar" (de `getAdminOverview`,
   que a gestão já paga) e o destino é a lista. Pagar uma consulta de eventos para escrever
   dois nomes num cartão de atalho é o oposto do orçamento da tela.

### 3.7 O orçamento de leitura: 6 fontes — e a régua, não o número solto

O pior perfil (OWNER/ADMIN, que vê cinco blocos) paga **seis** fontes de leitura:

```text
1. inscrições ........ listMyRegistrations      (decide hasDeadlineAction E alimenta `participacao`)
2. certificados ...... listCertificates          (fato do bloco `participacao`)
3. submissões ........ listMySubmissions         (bloco `submissoes`)
4. pareceres ......... listReviewerTasks         (bloco `pareceres`)
5. visão geral ....... getAdminOverview          (contadores da gestão, com `deletedAt`)
6. patrocinador ...... listSponsorAccess         (o VÍNCULO que liga o bloco `patrocinador`)
```

Três regras sustentam o número:

- **o contexto resolve UMA vez** e o principal vem dele — a página **não** chama
  `loadPrincipal` (§4, ADR-383);
- **as leituras dos blocos só acontecem se o bloco existir no plano**: o participante puro não
  paga `getAdminOverview`, `listReviewerTasks`, `listMySubmissions` nem `listCertificates`; e
  `hasPendingInvite` e `hasSpeakerProfile` custam **zero** consulta (saem de
  `context.memberships` e dos papéis do principal);
- **o que NÃO entra**, e por quê: prontidão por evento (12+ leituras — o painel não abre
  evento nenhum); `getMyAgenda` (exige `eventId`; agenda é tela, não bloco); `getSponsorPortal`
  (3+ leituras — o bloco leva à área, que paga o portal); `listAdminEvents` (§3.6).

**A régua importa mais que o número.** "Seis fontes" **não** são "seis comandos SQL":
`listReviewerTasks` abre **duas** transações (duas leituras) e `getAdminOverview` roda **doze**
`count`s numa transação. Quem ler o número como "seis queries" subestima o painel; quem ler
como "seis idas ao banco" superestima. A régua é: **seis SERVIÇOS de leitura, cada um com o
custo próprio, e nenhum deles novo nesta fase** — todos já existiam e já eram pagos por outras
telas. O que a fase fez foi **parar de pagar o que não precisava** (o principal duas vezes, a
contagem sem `deletedAt`, o render completo para todo perfil).

O `listSponsorAccess` do layout (o item do menu) e o da página são **duas leituras da mesma
tabela** em camadas que não se falam. A duplicata é conhecida e **não** foi paga: virou a
dívida **I10** (§8.1), porque resolvê-la exige um contrato novo de casca (a página não recebe
dados do layout).

### 3.8 `hasSpeakerProfile` pelo PAPEL, não pela permissão — e o limite declarado

A permissão `speaker:profile:update:own` parecia o atalho óbvio. Medido no catálogo: o `OWNER`
recebe `TENANT_PERMISSIONS` inteiro (65) e o `ADMIN`, tudo menos três — **os dois incluem essa
permissão**. Usá-la faria todo dono e todo administrador verem o cartão "Portal do palestrante
— seu perfil, os materiais das suas atividades e o certificado" sem ter perfil nenhum.

O papel `SPEAKER` é concedido no **aceite/reivindicação** do perfil (`speaker-service.ts`,
FASE 25), com escopo de ATIVIDADE: ele só existe para quem tem perfil. É o mesmo fato com uma
fonte que não vaza para a gestão — e **sem consulta nenhuma**, porque os papéis já vieram no
principal.

**O limite, declarado:** palestrante **com perfil e zero atividades** não tem o papel (ele
nasce por atividade). Esse perfil vê o painel sem o cartão do portal e chega lá pelo menu, que
desde a FASE 25 abre para o convite pendente e para quem tem permissão. Fechar o buraco exige
uma consulta a `speaker_profiles` no painel — a 7ª fonte, exatamente o que o orçamento recusa
— ou um fato novo no principal. Fica como ponto de atenção (§8.3).

---

## 4. ADRs

### ADR-382 — O painel é do PERFIL, e a prova do RBAC é da IDENTIDADE

**Contexto.** O painel da instituição era, desde a FASE 2, a demonstração verificável do motor
de RBAC: "Papéis acumulados neste contexto" com o UUID de evento e de atividade ao lado de cada
papel, a lista crua das permissões efetivas e o contador "Permissões efetivas" (65 para um
dono). Era ótimo para depurar autorização e péssimo como tela de trabalho: **todo perfil via a
mesma coisa**, e a única superfície do produto que mostrava permissões efetivas era também a
que mostrava as **chaves cruas** — enquanto o produto já tinha `roleLabel()` em uso na tela de
equipe. O rodapé dizia "Próximas fases adicionam eventos, submissões e certificados a este
painel" **ao lado** de um contador chamado "Eventos": o placeholder se contradizia com a
própria tela.

**Decisão.**
1. A prova do RBAC **muda de casa** para `/conta` (global), no 7º cartão "Seus acessos":
   instituição pelo nome, situação por Badge, papéis pelo **rótulo** e um **número** de
   permissões efetivas — sem UUID e sem chave crua.
2. O painel passa a ser **do perfil**: um catálogo de **9 blocos** com precedência declarada,
   **teto 5**, colapso de destino repetido **antes** do teto e a frase "e mais N atalhos" —
   tudo em **regra pura** (`dashboardBlocksFor`), desenhada pela página.
3. **Um bloco só existe se houver tela**: `FINANCE` fica em **estado vazio honesto** (oito
   permissões, nenhuma tela de cobrança), `CHAIR` fica no estado vazio de `/revisoes` (o bloco
   `comite` fica **proposto** para uma fase futura) e `listAdminEvents` **não entra** (seria a
   7ª fonte, e o bloco não desenha linhas).
4. O **convite pendente** é fato **global** e aponta para `/conta#seus-acessos`, não para a
   rota sem código.
5. As **chaves cruas saem da interface**; o que traduz é o catálogo (`roleLabel`,
   `permissionsForRole`).

**Justificativa.** A pergunta de quem abre o painel de manhã não é "que permissões eu tenho" —
é "o que, para MIM, importa aqui". A lista de 65 chaves responde a primeira pergunta para
qualquer perfil e a segunda para nenhum. A prova do motor não se perdeu: ela foi para a
**identidade**, que é onde os papéis realmente se acumulam (a mesma pessoa pode ser
organizadora de uma casa e revisora de outra) e onde o número tem nome em português. O
critério "um bloco só existe se houver tela" é o que impede o painel de prometer o que o
produto não tem — a alternativa (um cartão por permissão) produziria cartões quebrados
(`tenant:billing:manage`) e cartões que mentem (todo `OWNER` veria "Portal do palestrante",
porque o pacote dele inclui a permissão). As alternativas descartadas: (a) manter as duas
telas — o painel continuaria sendo a parede, e a fase não teria entregue nada; (b) mover a
lista crua para `/conta` atrás de um `<details>` — mudaria a parede de lugar; (c) derivar o
bloco de palestrante da permissão — faria o cartão aparecer para toda a gestão; (d) desenhar
"Financeiro" mesmo sem tela — um atalho que não leva a lugar nenhum.

**Consequências.** (1) O dono, o revisor, o participante e o financeiro veem painéis
**diferentes**, e o do financeiro é um estado vazio que explica onde estão os acessos. (2) O
`data-testid="role-summary"`/`"permissions"` deixa de existir no painel — os specs que os
usavam foram reaponteados (`auth-tenancy` para `/conta`), e a prova de negação ("o painel NÃO
tem a prova de RBAC") ficou no E2E e na catraca de fonte. (3) O teto de 5 é anunciado: nenhum
atalho some em silêncio. (4) O catálogo é o **único** lugar a mudar quando um papel novo
aparecer — e o caso "cobre os ONZE papéis" reprova até alguém declarar o comportamento dele.
(5) A dívida **E91** registra o que falta para o FINANCE ter para onde ir.

### ADR-383 — O painel lê o contexto UMA vez e conta na fonte que filtra `deletedAt`

**Contexto.** A FASE 75 mediu que as telas de gestão e o shell resolviam o principal **duas
vezes** por render: `getRequestContext()` já o carrega, e a página chamava `loadPrincipal`
logo abaixo com os **mesmos argumentos** — 2 + 2 em vez de 1 + 1. O painel **ficou de fora**
daquele movimento: continuava chamando `loadPrincipal(context.user.id, tenantId, status)` por
fora do contexto pronto, pagando uma transação de `role_assignments` a mais sem chance de a
resposta divergir. No mesmo arquivo, os contadores vinham de `tx.event.count()` e
`tx.activity.count()` **sem filtro de `deletedAt`** — podiam contar evento excluído e divergir
do número que `/administracao` mostra. E dois fatos que ligam blocos (palestrante,
patrocinador) estavam a um passo de serem deduzidos de **permissão** em vez do fato real.

**Decisão.**
1. O painel usa **`context.principal`** e a catraca de integração da FASE 75 passou a cobri-lo
   (caso "o painel da instituição: 1 memberships + 1 principal"), junto com a catraca de fonte
   que proíbe `loadPrincipal` na página.
2. Os contadores vêm **de `getAdminOverview`** — a **única** fonte, que filtra `deletedAt` e
   roda 12 `count`s numa transação. `tx.event.count()`/`tx.activity.count()` **saíram**, e a
   catraca de fonte reprova a volta.
3. `hasSpeakerProfile` vem do **papel `SPEAKER`** (não da permissão, que a gestão toda tem) e
   `hasSponsorLink`, do **vínculo** `sponsor_users` ativo (não de `sponsor:read`, que está no
   pacote mínimo — a lição da FASE 59).
4. `hasPendingInvite` sai de **`context.memberships`**: zero consulta.
5. As leituras dos blocos **só acontecem se o bloco existir no plano**, e o orçamento é
   **declarado como régua** (6 serviços de leitura no pior perfil), não como número solto.

**Justificativa.** O painel é a tela que **todo mundo** abre: cada leitura repetida é paga por
todos os perfis, em todo carregamento. A segunda resolução do principal era a mais barata de
remover (o dado já estava no contexto) e a mais fácil de reintroduzir (copiar o bloco de outra
página) — por isso a decisão virou **duas** catracas (a de integração, com banco, e a de fonte,
sem banco). O contador sem `deletedAt` era um defeito **já medido** na prática: o painel podia
dizer "5 eventos" com 4 na administração; ter uma fonte só é o que impede a divergência entre
duas telas que mostram o mesmo número. Os fatos por vínculo/papel seguem a régua de três fases
(F59 patrocinador, F42 vínculo × permissão, F25 papel de palestrante): **a permissão diz o que
a pessoa PODE; o vínculo diz o que ela É** — e o cartão do painel promete uma área, não uma
capacidade. As alternativas descartadas: (a) manter `loadPrincipal` "porque o painel pode
precisar de mais dados" — não precisa, e o contexto é a fonte única; (b) contar com
`withTenant` no painel — duplicaria a fonte dos contadores; (c) derivar palestrante da
permissão — todo dono veria o cartão; (d) medir "6 queries" e publicar o número — seria falso
(§3.7).

**Consequências.** (1) O painel faz uma transação de principal por render, não duas. (2) O
número de eventos do painel e o de `/administracao` não podem divergir. (3) A catraca de fonte
(`f84-painel-da-fatia-2.test.ts`, 9 casos) reprova a volta do `loadPrincipal`, do
`tx.event.count`, da prova de RBAC no painel e do testid reusado. (4) O `listSponsorAccess`
continua pago **duas vezes** (layout e página) — declarado como **I10**, porque resolver exige
contrato novo de casca. (5) A imagem "antes" da fase é, literalmente, o painel que esta ADR
aposenta: 65 chaves cruas e o contador sem filtro.

---

## 5. Lições aprendidas

> Só o que aconteceu: cada linha é um achado **medido** nesta fase, com a correção e a prova.
> Onde o achado veio de leitura de código/catálogo (e não de um teste vermelho), a coluna diz.

| # | O que foi medido | Causa raiz | Correção | Prova |
|---|---|---|---|---|
| 1 | **O painel era a ÚNICA superfície do produto com permissões efetivas — e mostrava as chaves cruas** (`submission:decide`) enquanto o produto tinha `roleLabel()` em uso na equipe | a tela nasceu (F2) como prova do motor e nunca foi revisitada; a tradução existia só onde a equipe lia papéis | a prova mudou para `/conta`, com **rótulo** e **número**; as chaves saíram da interface | 46 casos de `access-summary` + E2E `auth-tenancy` lendo "Organizador(a)"/"Revisor(a)" e **47 permissões efetivas** — sem chave crua |
| 2 | **A duplicata que a F75 deixou de fora**: o painel chamava `loadPrincipal` de novo (2 + 2 em vez de 1 + 1) e a catraca não o cobria | o movimento da F75 cobriu as três telas de gestão e o shell, não o painel; a chamada "funcionava", então nada acusava | `context.principal` + catraca de integração **estendida** ao painel + catraca de fonte | `f75-contexto-uma-vez.test.ts`: `memberships = 1`, `principals = 1`, `sessoes = 1`; `f84-painel-da-fatia-2`: `not.toContain('loadPrincipal')` |
| 3 | **O contador sem `deletedAt` podia divergir do número de `/administracao`** (`tx.event.count()`/`tx.activity.count()` crus) | a contagem nasceu antes da exclusão lógica e ninguém a revisitou quando `deletedAt` entrou no modelo | fonte única: `getAdminOverview` (12 `count`s, todos com `deletedAt` onde vale) | catraca de fonte proíbe `tx.event.count`/`tx.activity.count`/`withTenant` no painel; E2E do gestor exige `stats` com a fixture de 1 evento e 2 atividades |
| 4 | **`PROFESSIONAL` não é papel, é plano** — e a casca cola `` `${roles.join(' · ')} · ${tenant.plan}` `` na mesma linha (`layout.tsx:121`) | a linha secundária do bloco de contexto foi escrita quando plano e papel eram os dois "texto curto"; a chave crua e o enum em inglês ficaram lado a lado | **não consertado** (mexe em 12+ baselines e em `auth-tenancy:192,202`): declarado no §8.2. Os números do catálogo são a régua — **14** = `PARTICIPANT_PERMISSIONS`, **65** = `TENANT_PERMISSIONS` | imagem "antes" da fase mostra `OWNER · FREE`; os mesmos 65 aparecem como número em `/conta` |
| 5 | **O placeholder era falso e se contradizia com a própria tela**: "Próximas fases adicionam eventos, submissões e certificados a este painel" convivia com um contador **"Eventos"** | o rodapé nasceu como recado de roadmap na F2 e a tela cresceu em volta dele; ninguém leu os dois textos juntos | o rodapé inteiro saiu (com ele a URL canônica, que era dado técnico) | diff do painel + `f62` sem a máscara `mascaraDaUrlCanonica`; a baseline "depois" não tem `code.code-data` |
| 6 | **`tenant:billing:manage` não tem leitor** — achado ao decidir o perfil `FINANCE`: não existe tela de financeiro, e por isso o cartão "Financeiro" seria mentira | a permissão foi criada com o catálogo (F2) e o FINANCE a recebe; nenhuma superfície a consulta. É a **armadilha 75** aplicada a uma permissão | `FINANCE` fica no **estado vazio honesto**, com o caminho para `/conta#seus-acessos`; dívida **E91** declarada | `grep TENANT_BILLING_MANAGE`: 3 ocorrências, todas no catálogo (definição, exclusão do ADMIN, concessão ao FINANCE) — **nenhum leitor**; E2E caso 4 mede `dashboard-empty` |
| 7 | **A régua do teto**: "6 fontes de leitura" **≠** "6 comandos SQL" — `listReviewerTasks` abre **2 transações** e `getAdminOverview` roda **12 counts** | o número de *serviços* é o que a página importa; o de *comandos* depende de cada serviço. Publicar "6 queries" seria falso nos dois sentidos | o relatório declara a **régua** (6 serviços, nenhum novo) e o custo interno dos dois que mais pesam | leitura da página (6 chamadas) + `review-service.ts:889/927` (2 `withTenant`) + `catalog-service.ts:1740-1760` (12 `count`) |
| 8 | **`hasSpeakerProfile` pelo PAPEL, não pela permissão** — todo `OWNER` tem `speaker:profile:update:own`, então a permissão faria todo dono ver "Portal do palestrante" | o pacote de gestão inclui as permissões de participante e de palestrante; a permissão diz o que a pessoa PODE, não o que ela É | o gatilho é o **papel `SPEAKER`** (nasce no aceite, escopo de atividade) — zero consulta | caso "STAR: o bloco não nasce de papel — só de perfil/vínculo" e a matriz dos onze papéis: `OWNER` **não** produz `palestrante` |

Duas lições de método, que não são defeito de produto:

- **Testar a regra pura não basta quando o dado vem de fora.** A matriz de 46 casos prova
  *quais* blocos cada perfil vê; ela não provaria que a página **não** paga a segunda leitura
  do principal nem que o contador filtra `deletedAt`. Para isso existem as duas catracas de
  fonte e o caso de integração com contagem — três provas para três riscos diferentes.
- **O anúncio tem de vir da mesma decisão que o corte.** A frase "e mais N atalhos" só é
  honesta porque o `hidden` é calculado **junto** com o `blocks`, na regra. Se a página
  contasse de novo, o número poderia divergir do corte no dia em que o teto mudasse — é a
  mesma classe da F50/F51 ("o que a tela esconde, ela anuncia"), agora presa pelo tipo de
  retorno.

---

## 6. Evidência de verificação

### 6.1 A bateria

```text
npm run lint ........................ 0 erros, 0 avisos
npm run typecheck ................... 0 erros
npm test ............................ 254 arquivos, 4548 testes, 0 vermelhos
npm run build ....................... "✓ Compiled successfully in 6.0s" (exit 0)
npm run db:verify ................... "Contrato íntegro."
npm run db:verify:isolation ......... "9/9 verificações passaram."
npm run db:partitions ............... mês atual e os seguintes criados (139.768 linhas de auditoria)
```

### 6.2 Os testes novos, por arquivo

```text
tests/unit/f84-painel-do-perfil.test.ts ............. 46 passed
  · a matriz perfil × blocos (11 papéis + combinações)  18
  · o teto de cinco e a frase do "e mais N" ...........  5
  · o catálogo de blocos (destino é tela real) ........  5
  · o resumo do vínculo para "Seus acessos" ........... 10
  · catracas de fonte (domínio puro, /conta, <ul>/<li>)   8
tests/unit/f84-painel-da-fatia-2.test.ts .............  9 passed
  · a página consome a regra e não a reescreve .........  6
  · o botão de contexto é peça NOVA (de topo) ..........  3
tests/integration/f75-contexto-uma-vez.test.ts ........  5 passed
  · o painel entrou na catraca: 1 memberships + 1 principal
tests/e2e/f84-painel-do-perfil.spec.ts ................  6 passed
```

### 6.3 A suíte E2E inteira

```text
npm run test:e2e -- --output %TEMP%\f84-e2e-out
  487 testes: **486 passed + 1 skipped, ZERO failed**

  por spec, o que a fase toca:
    tests/e2e/f84-painel-do-perfil.spec.ts .......  6 passed (novo)
    tests/e2e/auth-tenancy.spec.ts ...............  12 passed (a prova de RBAC foi para /conta)
    tests/e2e/f62-regressao-visual.spec.ts .......  23 passed (4 baselines do painel refeitas)
    tests/e2e/account-area.spec.ts ...............   4 passed (intocado nesta fase)
```

### 6.4 As baselines do painel e a imagem da fase

```text
docs/imagens/f84-painel-e-acessos.png
  ANTES  — o painel até a FASE 83, exatamente como a última execução da suíte o mediu:
           a parede de 65 permissões, "Papéis acumulados neste contexto" com o escopo,
           o cartão "Permissões efetivas: 65" e o rodapé com o placeholder falso.
  DEPOIS — o mesmo painel, do MESMO perfil (OWNER, mesma instituição, mesmo viewport):
           o botão de contexto no topo, os contadores só da gestão e os cinco atalhos do
           perfil, cada um com o seu fato.
  CONTA  — o 7º cartão "Seus acessos" de `/conta`: instituição, papel pelo rótulo, as 65
           permissões efetivas como NÚMERO e o link de volta.
```

O "antes" é a baseline de pixel da suíte (`f62-regressao-visual`, commit anterior a esta
fase) — **a tela real**, capturada pela própria suíte, com o e-mail mascarado. O "depois" é a
baseline nova, do mesmo perfil e do mesmo viewport, o que torna o par comparável sem
reconstruir cenário. O cartão de `/conta` foi capturado por um spec **temporário**
(`tmp-captura-f84.spec.ts`), apagado depois de gerar a imagem — a mesma prática da F83.

### 6.5 O que a fase NÃO mudou, e a prova de que não mudou

```text
globals.css ................. intocado (nenhum token novo; a fase não é de design)
playwright.config.ts ........ intocado
topo do painel .............. mesmo título e mesmo `eyebrow` (pinned por 4 provas)
shell ....................... intocado (o botão de contexto é peça NOVA, não a casca)
migrações ................... 0
```

As **4 baselines** do painel foram refeitas porque a tela mudou de **conteúdo** (saíram duas
seções, entrou a fileira de atalhos) — não por token. A estabilidade foi medida **duas** vezes
seguidas na fatia 2, com `maxDiffPixelRatio: 0`: **0 px** de diferença entre execuções. E esta
bateria revalidou as quatro **dentro da suíte inteira**, com a mesma tolerância zero: as 23
linhas do `f62` passaram.

---

## 7. Comandos operacionais

```bash
# a matriz perfil × blocos e o resumo do vínculo (sem banco, sem sessão, sem Next)
npx vitest run tests/unit/f84-painel-do-perfil.test.ts

# as catracas de fonte do painel (sem banco: o que o código PODE voltar a fazer)
npx vitest run tests/unit/f84-painel-da-fatia-2.test.ts

# o contexto resolvido UMA vez, com banco (inclui o painel desde esta fase)
npx vitest run tests/integration/f75-contexto-uma-vez.test.ts

# os seis perfis no navegador
npx playwright test tests/e2e/f84-painel-do-perfil.spec.ts

# a regressão visual do painel (as 4 linhas refeitas nesta fase)
npx playwright test tests/e2e/f62-regressao-visual.spec.ts

# a suíte inteira, com a saída FORA da árvore
npm run test:e2e -- --output %TEMP%\f84-e2e-out
```

```text
Regra ............ src/domain/platform/dashboard-blocks.ts   (pura; não lê banco/sessão/Next)
Résumé ........... src/domain/rbac/access-summary.ts          (puro; tradução e união)
Acessos .......... src/app/conta/page.tsx                     (cartão "Seus acessos", 1 consulta)
Painel ........... src/app/t/[tenantSlug]/(app)/dashboard/page.tsx
Contexto ......... src/components/shell/dashboard-context.tsx (peça NOVA de topo, não a casca)
Catracas ......... tests/unit/f84-painel-da-fatia-2.test.ts · tests/integration/f75-contexto-uma-vez.test.ts
```

---

## 8. Dívidas técnicas e pontos de atenção

### 8.1 Dívidas novas: **E91** e **I10**

**E91 — `tenant:billing:manage` não tem leitor (não existe tela de financeiro).**
O papel `FINANCE` recebe `tenant:billing:manage` desde o catálogo da F2, e **nenhuma superfície
do produto a consulta**: são três ocorrências no código, todas no próprio catálogo (a
definição, a exclusão do pacote do `ADMIN` e a concessão ao `FINANCE`). O efeito medido nesta
fase é o painel do financeiro: **oito permissões e nenhum destino**, por isso o estado vazio
honesto em vez de um cartão quebrado. O caminho é a **tela de financeiro** (faturas, cobrança,
situação do plano) ou — se ela não vier — **retirar a permissão do catálogo**, para o papel
não prometer o que o produto não faz. É a régua da **armadilha 75** aplicada a uma permissão.

**I10 — `listSponsorAccess` é pago DUAS vezes no mesmo render (layout + página).**
O layout lê a tabela para decidir o **item do menu** (F59) e o painel lê de novo para decidir
o **bloco `patrocinador`**. São duas leituras da mesma tabela em camadas que não se falam: a
casca não passa dados para a página, e a alternativa — cache de requisição — seria um contrato
novo de casca. A duplicata foi **declarada, não paga**, e o número de fontes do painel (§3.7)
já a conta como a 6ª. O caminho é um contrato de "fatos da casca" (ou `cache()` do React no
leitor), que a F75 já tinha no radar e não fechou.

**A contagem vai de 44 para 46** (A=4, B=6, C=1, D=3, **E=24**, F=5, H=0, **I=3**).

### 8.2 O `PROFESSIONAL` da casca: **não consertado**, e por quê

A linha secundária do bloco de contexto mostra `OWNER · FREE` — a **chave crua** do papel e o
**enum do plano**, colados. O conserto é de uma linha (`roleLabel` no papel; uma palavra do
produto no plano), mas o bloco é fotografado em **12+ baselines** e o texto é asserido em
`auth-tenancy:192,202`. Fazer isso dentro desta fase misturaria duas mudanças de tela numa
re-baseline só — exatamente o que a fase evitou ao manter o topo do painel intacto. Fica como
ponto de atenção declarado; o desenho do conserto é: papel pelo **catálogo** (`roleLabel`) e
plano pela **palavra do produto** (`TENANT_PLAN_LABELS`, em `platform-rules.ts`).

### 8.3 O limite do bloco de palestrante

`hasSpeakerProfile` é o **papel `SPEAKER`**, e o papel nasce por **atividade** no aceite do
convite. Um palestrante **com perfil e zero atividades** não tem o papel e não vê o cartão no
painel — chega ao portal pelo menu (que abre para o convite pendente e para quem tem a
permissão). Fechar esse caso custaria uma consulta a `speaker_profiles` no painel (a 7ª fonte,
que o orçamento recusa) ou um fato novo no principal. Declarado, não escondido.

### 8.4 O `comite` e o CHAIR: proposta, não entrega

O bloco `comite` (gatilho `submission:read:any` → `/comite`) fica **proposto para uma fase
futura**, com a pergunta de produto que ele exige: com ele, a cadeira veria "Meus pareceres" e
"Comitê científico" — dois cartões para o mesmo trabalho? A fase preferiu o estado vazio
honesto de `/revisoes`, que o E2E **mede**.

### 8.5 O que a fase não tocou

`globals.css` e `playwright.config.ts` **intocados**, por decisão. As decisões das fatias 1 e 2
(regra, teto, colapso, catálogo, estado vazio, testid novo) são as entregues e não foram
reabertas por esta tarefa de fechamento — o que este documento faz é **medir**, não redesenhar.

---

## 9. Checklist de aceite

- [x] `dashboardBlocksFor(subject)` devolve `{ blocks, hidden }` em **domínio puro** — teto
      **5**, **colapso de destino repetido antes do teto**, precedência declarada e
      `DASHBOARD_BLOCK_META` como fonte única de título/descrição/caminho
- [x] `dashboardBlockHref` monta o caminho com `tenantPath` (a exceção do convite é declarada)
      e `dashboardHiddenPhrase` devolve a frase — ou `null`, nunca string vazia
- [x] `access-summary.ts`: papel pelo **rótulo**, chave fora do catálogo **descartada**, ordem
      alfabética pelo rótulo e o **número** de permissões efetivas por **união**
- [x] O 7º cartão **"Seus acessos"** em `/conta` — instituição · Badge · papéis · nº de
      permissões · link — pagando **1 consulta** (a de vínculos que a página já fazia)
- [x] O painel **saiu** `role-summary`, `permissions`, o cartão "Permissões efetivas", o
      rodapé com o placeholder falso e a URL canônica
- [x] O painel **entrou** até 5 cartões por perfil (`dashboard-block-<id>`), `stats` **só** na
      gestão (de `getAdminOverview`, com `deletedAt`), a frase do que ficou de fora e o estado
      vazio com link para `/conta#seus-acessos`
- [x] `DashboardContextLink` no slot `actions` do `PageHeader`, com testid **novo**
      (`dashboard-context`) e nome acessível que começa pelo texto visível
- [x] A **segunda leitura do principal** saiu do painel: `context.principal`, catraca de
      integração **estendida** (1 + 1) e catraca de fonte proibindo `loadPrincipal`
- [x] **6 fontes de leitura** no pior perfil, com a **régua** declarada (não o número solto) e
      as leituras condicionadas ao plano
- [x] As decisões declaradas: **CHAIR** no estado vazio (bloco `comite` proposto), **FINANCE**
      no estado vazio até existir tela, **`listAdminEvents` fora** (7ª fonte)
- [x] **4 baselines** do painel refeitas, com duas execuções a **0 px**
- [x] E2E novo com **6 casos** (participante, gestor, teto, FINANCE, CHAIR, convite) e
      `auth-tenancy` reaponteado para `/conta`
- [x] `docs/imagens/f84-painel-e-acessos.png` (antes × depois + `/conta`), spec temporário
      **apagado**
- [x] Dívidas novas **E91** e **I10** declaradas em `docs/dividas-tecnicas.md` (§3, §4 e
      contagem) e na linha das dívidas do `AGENTS.md` §9
- [x] `lint` 0/0 · `typecheck` 0 · `npm test` **4548 em 254** ·
      `build` OK · `db:verify` contrato íntegro · isolamento **9/9** · partições do mês e dos
      seguintes
- [x] Suíte E2E **inteira** verde: **487 = 486 + 1 skip**, zero vermelhos
- [x] `AGENTS.md` (estado, §9 com a linha 84, dívidas e §10), `README.md` (narrativa, índice e
      as **duas** cópias das contagens) e `docs/fases-historico.md` atualizados
