# FASE 56 — Mutirão de dívidas da Jornada do participante

> **Estado: EM ANDAMENTO — fatia 4 (E62 + E45) em fechamento** (E33 + E1 · E2 + E31 · E18 + E65 + E54 entregues).

Este mutirão nasceu de uma pergunta simples — *"o que temos de dívidas na Jornada do
participante?"* — e da resposta: **26 das 48 dívidas abertas** estavam no tema E, o maior
bloco do levantamento. Nove delas foram escolhidas para atacar os três momentos em que a
pessoa **perde** alguma coisa:

| Momento | Dívida | O que a pessoa perdia |
|---|---|---|
| Quer entrar | **E33** fila de espera no nível do EVENTO | **a vaga**: evento lotado recusava, e o interessado desaparecia |
| Quer entrar | **E1** promoção com prazo | **a vez**: quem não respondia segurava a vaga, e a fila inteira esperava |
| Enquanto procura | **E2** paginação das listagens públicas | **o tempo**: listas carregavam tudo |
| Enquanto participa | **E31** retirar a submissão | **o próprio trabalho**: só a comissão cancelava |
| Depois | **E18/E65** peso das imagens | **a paciência**: acervo antigo em PNG/JPEG e sem miniatura |
| Depois | **E54** CPF e título no certificado | **o documento**: variável que não existia |
| Em público | **E62** denúncia e moderação | **a segurança**: texto livre publicado sem freio |
| Entre pessoas | **E45** resposta ao recado | **a conversa**: recado era mão única |

## 1. Números da fatia 1

| | |
|---|---|
| Arquivos tocados | 9 (2 de domínio, 3 de serviço/ação, 4 de interface/teste) |
| Linhas no serviço de inscrição | +157 (fila do evento, promoção com prazo, aceite, reindexação por escopo) |
| Testes | **2736** unit+integração (+2) · **E2E novo**: `event-waitlist.spec.ts` (2 cenários) |
| Defeitos reais encontrados | **2** (a vaga ofertada sem quem a confirmasse; a tela pública mentindo "inscrição ativa") |
| Migrações | **nenhuma** — a fila do evento usa a coluna `waitlistPosition` que já existia |

## 2. O problema mais difícil da fatia — e por que ele define o desenho

A fila de espera **já existia inteira** no nível da ATIVIDADE: `WAITLISTED` com posição,
índice único parcial de posição, `SAVEPOINT` com releitura do máximo para a corrida,
`promoteNextFromWaitlist`, reindexação por `ROW_NUMBER()`, e a liberação por prazo da
FASE 34 promovendo o próximo **na mesma transação** (ADR-175/178).

O problema não era construir a fila: era **não construir a segunda fila**. A inscrição do
EVENTO é uma linha de `registrations` com `activityId` NULO — e a partir daí TODA leitura
precisa saber que existem duas filas no mesmo lugar. A decisão que define o desenho foi
tratar as duas como o MESMO mecanismo com ESCOPO:

- `promoteNextFromEventWaitlist` é irmã de `promoteNextFromWaitlist` — não um `if` dentro
  dela. A irmã faz três coisas que a outra não faz (reserva o lugar no evento, retém com
  prazo, e só então inscreve nas atividades abertas), e um `if` misturaria os dois fluxos
  num caminho que ninguém consegue ler;
- `reindexWaitlist` recebeu **escopo** (`{ activityId }` | `{ eventId }`) em vez de um
  `string | null`. A assinatura antiga voltava cedo no nulo, e "nulo" significava duas
  coisas ao mesmo tempo ("sem atividade" e "sem escopo") — a fila do evento ficaria sem
  reindexação em silêncio, com posições cheias de buracos na tela;
- o cancelamento passou a devolver **todas** as vagas e a chamar **todas** as filas:
  `promoted` virou LISTA, porque cancelar a inscrição do evento devolve o lugar no evento
  E a vaga de cada atividade aberta que ela criou.

## 3. Decisões técnicas

### 3.1 Um evento COM lotação tem fila — e a decisão não é da tela

`eventHasWaitlist(capacity)` responde a única pergunta que o serviço faz antes de
enfileirar: **este evento tem lotação?** Sem lotação não há vaga contada para faltar, e
enfileirar quem nunca seria recusado seria inventar espera.

A decisão NÃO é um `if` sobre o contador: quem decide se há vaga continua sendo o `UPDATE`
condicional (`RESERVE_EVENT_SEAT_SQL`) — o banco serializa, a segunda transação reavalia o
predicado e afeta 0 linhas. A regra pura só escolhe entre **enfileirar** e **recusar**.

**Alternativa descartada:** um interruptor por evento ("aceitar fila?"), como o da
atividade. Fila que precisa ser ligada é fila que não existe no dia em que o evento lota
por surpresa — e o organizador descobriria a demanda tarde demais, que é exatamente o
problema que a dívida descreve.

### 3.2 48 horas, no domínio, e não a política de confirmação de vaga

O prazo de quem é promovido é **fixo em 48 h** (`PROMOTION_WINDOW_HOURS`), e isso é
decisão, não preguiça: o prazo da FILA não pode ser o mesmo campo da política de
confirmação (FASE 34), que é sobre **o que a atividade cobra**. Amarrar os dois faria a
política de cobrança governar a fila em silêncio — quem cobrasse 30 dias daria 30 dias de
fila parada, e quem não cobrasse nada faria a fila vencer por um prazo que ninguém
configurou.

**Alternativa descartada:** mais um campo configurável por atividade. Menos campos novos,
sim — mas dois prazos com significados diferentes no mesmo formulário é o tipo de coisa
que o organizador configura errado uma vez e ninguém entende depois.

### 3.3 A vaga ofertada reusa `PENDING` — e o aceite é da PESSOA

A promoção grava `PENDING` com `confirmationDueAt`, que é o estado que a FASE 34 já sabe
liberar e promover de novo. A máquina existia; faltava quem a acionasse pela fila.

**O defeito que isso revelou, na hora, pelas catracas da FASE 43:** `canConfirmRegistration`
recusa confirmar quando a atividade não exige conferência ("esta atividade confirma a vaga
automaticamente") e **sempre** recusa a inscrição do evento. Ou seja: a vaga ofertada numa
atividade gratuita (ou no evento) **não tinha quem a confirmasse** — venceria em 48 h, iria
para o próximo, venceria de novo, para sempre.

A distinção que resolveu é a mesma da FASE 34, um nível acima: **a equipe confere o que a
atividade COBRA; a pessoa decide se ainda QUER a vaga.**

| Situação | Quem confirma | Caminho |
|---|---|---|
| Atividade **com** exigências | a equipe | resolver o último item obrigatório **auto-confirma** a vaga (FASE 34/37, já existia) |
| Atividade **sem** exigências, ou o EVENTO | a própria pessoa | `acceptPromotion` — botão "Aceitar a vaga", com o prazo ao lado |

`canAcceptPromotion` é regra pura e testada sem banco: recusa quando não há oferta, quando
o prazo venceu, quando a vaga já está resolvida e quando quem confirma é a equipe (nesse
caso a tela mostra o checklist da F34, não o botão).

### 3.4 A varredura precisava alcançar a linha do EVENTO

Dois detalhes que só aparecem em produção:

1. **Filtro de relação descarta o nulo.** A varredura filtrava
   `activity: { status: { not: 'CANCELED' } }` — e no Prisma isso vira JUNÇÃO, que exclui
   a inscrição do evento (`activityId` nulo). A vaga promovida **nunca venceria**;
2. **`releaseSeatForExpiry` devolvia vaga de atividade sempre.** Para a linha do evento
   não há vaga de atividade a devolver — o `UPDATE` com `null::uuid` casaria com zero
   linhas (inofensivo, mas mentiroso). Agora a função aceita `activityId: null` e devolve
   só o lugar no evento.

## 3e. Fatia 2 — paginação pública e a retirada pelo autor (ENTREGUE)

### E31 — o autor retira o próprio trabalho

A máquina de estados previa `WITHDRAWN` desde a revisão da FASE 4, o limite por trilha já a
ignorava na contagem, e **não havia caminho**: só a comissão conseguia cancelar. Quem
enviava por engano ficava esperando um pedido manual — e o trabalho seguia na fila dos
revisores enquanto isso.

Agora: `canWithdrawSubmission` (domínio) + `withdrawSubmission` (serviço, com posse
conferida no `where` e escrita condicional pelo estado que a tela viu) + `withdrawSubmissionAction`
(`submission:update:own` com posse obrigatória) + botão com diálogo que escreve a
consequência antes do clique. O trabalho **sai do páreo**, o protocolo **fica**, e o motivo
vai para a trilha.

**Rascunho não se retira, se exclui.** Os dois caminhos levam ao mesmo lugar, mas o
rascunho nunca foi enviado: não há parecer, atribuição nem protocolo a preservar — e dois
botões que parecem a mesma coisa não são. A régua ficou no domínio (e o teste prende).

### E2 — as listas públicas paginam

`listPublicEvents` e `listMySubmissions` liam **tudo** para desenhar uma dúzia: a lista de
eventos carregava todos os eventos publicados (cada um com a contagem de atividades por
evento) e a lista de submissões do autor, todas as linhas. Agora o `skip`/`take` vão para o
SQL, e o `count` sai **na mesma transação** — o total anunciado e a fatia desenhada não
podem divergir.

A fórmula da paginação virou **uma só** (`pagination-rules.ts`): `normalizePageSize` já
existia embutida dentro do `buildDirectory`, e lista nova que precisasse paginar copiaria a
conta — ou esqueceria o teto. O `buildDirectory` passou a chamar a mesma função.

**E o filtro de visibilidade tinha DUAS listas.** O repositório filtrava por
`PUBLIC_EVENT_STATUSES` e a tela filtrava por `isPubliclyVisible`, com os mesmos cinco
status em arquivos diferentes. Com paginação, uma divergência faria a página contar o que a
tela esconde: a lista virou uma só, exportada do domínio, e o conjunto deriva dela.

**O endereço é canônico:** a página 1 não carrega `?pagina=1` — `/eventos` e
`/eventos?pagina=1` seriam a mesma tela em dois endereços, e o "Anteriores" da página 2
volta para o endereço limpo (mesma régua do diretório de instituições).
## 3f. Fatia 3 — o acervo em miniatura, o acervo antigo em WebP e o CPF no certificado (ENTREGUE)

### E18 — a galeria pede a MINIATURA

A galeria desenhava cada imagem **inteira** dentro de um quadrado de 80 px: abrir o acervo com
vinte fotos de 3 MB baixava dezenas de megabytes para mostrar vinte quadrados — e repetia o
download a cada visita, porque não havia cabeçalho de cache.

Agora existe uma rota (`/api/t/<slug>/midia/<assetId>/miniatura`) com `page:manage`, a MESMA
permissão da tela. Ela **deriva na primeira visita** (320 px, `cover`, WebP q70) e guarda o
resultado no próprio bucket, em `thumbs/…`: a segunda visita é um `HEAD`. Derivar na leitura —
e não no envio — é o que faz o acervo **anterior à FASE 46** ganhar miniatura sem migração de
dado e sem uma coluna nova.

### E65 — o acervo antigo vira WebP

A esteira da FASE 46 converte a partir do próximo envio; o que já estava no bucket ficou em
PNG/JPEG para sempre, sem CLI de reprocessamento. Entrou `npm run media:reprocess`
(`--dry-run`, `--limit=`, `--tenant=`), com a REGRA num serviço testável
(`reprocessMediaAssets`).

**Chave NOVA, nunca a mesma** — um `.png` com bytes de WebP é a mentira que a FASE 46 recusou.
E é justamente essa regra que obriga a pular **imagem em uso**: a URL está gravada na capa do
evento, no logotipo do patrocinador, na foto do palestrante e no JSON dos blocos da página.
O relatório CONTA as puladas, e a pendência tem nome (dívida **E78**): reescrever referências
é outro trabalho, com risco próprio. A ordem das escritas é objeto novo → linha apontando
para ele → só então o original sai; invertida, uma falha no meio deixaria a linha apontando
para um objeto inexistente.

### E54 — CPF e título da apresentação no certificado

O editor de modelos não tinha as duas variáveis porque **não havia fonte** — havia até um teste
dizendo isso. A fonte escolhida para o CPF é o **formulário de inscrição no evento** (e não o
perfil): o CPF entra em documento, a LGPD manda recolher o mínimo para a finalidade, e o perfil
é global — guardado na inscrição, ele tem propósito, dono e prazo.

- `isValidCpf` confere os DOIS dígitos verificadores e recusa a sequência repetida
  (`111.111.111-11` passa nas contas e não é CPF de ninguém). O valor é gravado em DÍGITOS e
  formatado na impressão;
- a variável `titulo_apresentacao` vem do trabalho que a pessoa enviou no evento (rascunho,
  retirada e cancelamento ficam fora — não são apresentação);
- as duas entram em `CONTENT_VARIABLE_KEYS`: são **conteúdo congelado**, porque corrigir o
  formulário depois não pode reescrever um documento já assinado.

**O detalhe que só o E2E pegaria:** um CPF recusado chegava com o campo VAZIO, porque o React 19
zera os campos do formulário quando a Server Action responde. A action passou a devolver o que a
pessoa digitou, e o formulário a preencher de volta.
## 3g. Fatia 4 — a conversa de mão dupla e a moderação do que é público

### E45 — a pessoa responde o recado

O recado era **mão única**: a instituição falava, a pessoa lia, e a dúvida sobre
credenciamento virava ligação para a secretaria — fora do registro. "Não lido" também não é
"não recebido", e nenhum dos dois dizia se a pessoa havia **respondido**.

Agora a resposta entra na MESMA conversa: `direction` diz quem falou (`OUTBOUND` da
instituição, `INBOUND` da pessoa) e `parentId` aponta para o **recado raiz** — não para a
mensagem respondida.

**Por que a raiz, e não a mensagem anterior:** a alternativa forma uma ÁRVORE, e numa caixa
de entrada árvore é o que ninguém quer — desenhar a conversa exigiria percorrer níveis, e a
pergunta "esta conversa foi respondida?" deixaria de caber numa consulta. Com o ponteiro para
a raiz, a conversa é uma lista, e o indicador "respondeu" é barato nas duas telas que o
mostram (a caixa de entrada e a ficha da instituição).

Três detalhes que os testes prendem:

- **o assunto ganha `Re:` UMA vez** (`replySubjectFor`), e é truncado no teto da coluna —
  responder a uma resposta não empilha prefixos;
- **a resposta não infla o "não lida" de quem a escreveu**: `readAt` continua sendo o marcador
  da PESSOA, e a resposta nasce não lida para a EQUIPE (é ela que ainda não leu);
- **responder não tem permissão nova**: é ato de POSSE (`userId` da sessão, conferido de novo
  no `where`). Inventar `participant:reply` criaria um papel que ninguém precisa ter para
  responder o que já é seu.
### E62 — denúncia e moderação do que é público

O perfil público é a primeira superfície em que o **conteúdo é da PESSOA** e o **endereço é da
INSTITUIÇÃO**: bio, título profissional e interesses são texto livre publicado na internet, sem
canal de denúncia, sem fila de revisão e sem caminho para tirar do ar.

**Quem decide é a PLATAFORMA, e isso é decisão de desenho** — não preguiça de escopo. O
`@handle` é GLOBAL (ADR-002): se cada instituição decidisse, o mesmo conteúdo seria julgado de
formas diferentes e quem fosse ocultado numa casa seguiria publicado na vizinha, sem que
ninguém enxergasse o conjunto. Então a denúncia **nasce na casa** (sob RLS, com a trilha dela)
e a **decisão é de plataforma** (`src/lib/platform/**`, lida em `/superadmin/denuncias`).

Três partes, como a dívida pedia:

- **denúncia** — qualquer pessoa autenticada, com categoria fechada (5) e relato. O domínio
  exige detalhe no `OTHER`, recusa **auto-denúncia** e recusa a **segunda denúncia aberta do
  mesmo denunciante** contra o mesmo perfil (`ALREADY_REPORTED`): sem isso, a fila vira arma de
  repetição;
- **fila de revisão** — `/superadmin/denuncias`, com resumo por categoria, a origem (de qual
  casa veio), quem denunciou e o relato. A decisão é **dispensar** ou **ocultar**, sempre com
  nota (mínimo 10 caracteres): decisão de moderação sem justificativa não se audita;
- **efeito** — ocultar grava `User.publicProfileHiddenAt/Reason`. **Ocultar não é apagar**: o
  `publicHandle` continua reservado (ninguém toma o nome de quem foi ocultado), a página passa a
  dizer "Este perfil está oculto por decisão da moderação" sem renderizar o conteúdo, e o
  **diretório** deixa de listá-lo — vitrine que ignorasse a moderação seria uma segunda régua de
  visibilidade.

O `UPDATE` da decisão é **condicional em `status = 'OPEN'`**, na mesma transação que grava o
efeito no perfil: dois moderadores clicando juntos decidem UMA vez, e o segundo recebe
`ALREADY_DECIDED` em vez de reescrever a história.

**Resíduo declarado (E79):** o bloco "Equipe do evento" (FASE 45) e o link público selado da
carta continuam mostrando nome e equipe de quem está oculto. O efeito desta dívida é sobre o
PERFIL PÚBLICO; estender a moderação a toda superfície que cita a pessoa é outra varredura — e
ela está declarada, não esquecida.
## 4. ADRs

### ADR-304 — A inscrição no evento entra na FILA quando a reserva falha

**Contexto.** A fila existia por atividade. Quando a lotação do EVENTO acabava, a
inscrição era recusada (`FULL`) e o interessado desaparecia: não havia onde guardá-lo, nem
como saber quem esperava, nem a quem entregar a vaga de quem desistisse. A instituição
descobria a demanda por fora e refazia à mão o trabalho que o sistema já sabia fazer.

**Decisão.** A inscrição do evento nasce `WAITLISTED` com posição no fim da fila do evento
(escopo: `activityId IS NULL`), **sem** inscrever nas atividades abertas — quem espera não
tem lugar. A posição é disputada no banco (`SAVEPOINT` + releitura do máximo, com o índice
único parcial decidindo a corrida). Evento **sem** lotação não tem fila: continua recusando
o impossível, que ali não existe.

**Consequências.** O evento lotado passa a ter uma lista visível (nome e posição) na tela de
confirmações; a promoção é automática quando uma vaga é devolvida; e a linha `EVENT_AUTO`
das atividades abertas passa a ser criada **na promoção**, e não no ato — o que exige que
`promoteNextFromEventWaitlist` faça as três coisas na ordem certa.

### ADR-305 — A promoção da fila retém a vaga com prazo de 48 h

**Contexto.** A promoção era silenciosa e definitiva: quem era chamado virava `CONFIRMED`
no mesmo instante. Quem não queria mais a vaga — ou não viu o aviso — ficava com ela, e a
fila inteira atrás esperava por quem não vinha. A vaga que não se perdia no fim da fila se
perdia no começo.

**Decisão.** A promoção grava `PENDING` com `confirmationDueAt` em `PROMOTION_WINDOW_HOURS`
(48 h), reusando a máquina da FASE 34, que já sabe liberar e promover o próximo na mesma
transação. O prazo é fixo no domínio, e **não** a política de confirmação de vaga.

**Consequências.** Quem é promovido tem uma janela; passada ela, a vaga vai para o próximo
(que também tem 48 h). Numa atividade com exigências, a promoção passou a **respeitar o
portão da F34** — antes, quem entrava pela fila furava a conferência da taxa; agora o
checklist nasce junto com a promoção e a equipe confirma resolvendo o obrigatório.

### ADR-306 — O aceite da vaga ofertada é ato da PESSOA

**Contexto.** Com a promoção retendo a vaga, a vaga ofertada ficou **sem quem a
confirmasse**: `canConfirmRegistration` recusa quando a atividade não exige conferência, e
sempre recusa a inscrição do evento. A vaga venceria em 48 h, iria para o próximo e
venceria de novo — a fila giraria para sempre e ninguém entraria. O defeito foi encontrado
pelas catracas da FASE 43 no mesmo dia em que a retenção entrou.

**Decisão.** `acceptPromotion` (serviço) + `acceptPromotionAction` (permissão
`registration:create` com POSSE explícita, `userId` no `where` da escrita condicional) +
botão "Aceitar a vaga" em "Minhas inscrições", com o prazo ao lado. A régua de quem pode
aceitar é `canAcceptPromotion`, no domínio. Onde a atividade exige conferência da equipe, o
aceite não é o portão: o botão não aparece e quem fala é o aviso da F34, com o checklist.

**Consequências.** Cada uma das duas confirmações tem um dono explícito, e nenhuma vaga
fica sem caminho. O campo `promotion` da linha do participante é separado de `confirmation`
de propósito: um é a decisão da PESSOA, o outro é a conferência da EQUIPE.

### ADR-307 — Cancelar devolve TODAS as vagas e chama TODAS as filas

**Contexto.** Cancelar a inscrição no evento leva junto as linhas `EVENT_AUTO` das
atividades abertas (decisão da FASE 3) e devolve o lugar no evento. As vagas de atividade
devolvidas não eram oferecidas a ninguém: a fila existia e ninguém a chamava — a mesma
perda de antes, um nível abaixo.

**Decisão.** `CancelOutcome.promoted` virou **lista**: cada vaga devolvida (o lugar no
evento e a vaga de cada atividade aberta) tenta promover a sua fila, e a mensagem da ação
fala no singular ou no plural conforme o número. A promoção de atividade reserva lugar no
evento também, então as tentativas seguintes devolvem `null` em vez de estourar a lotação.

**Consequências.** Um cancelamento pode promover mais de uma pessoa, e cada promoção recebe
o seu aviso (a `dedupeKey` é por inscrição, então nada duplica) e o seu crédito de XP
quando a vaga é confirmada.

### ADR-308 — A retirada do trabalho é ato do AUTOR, e o rascunho se exclui

**Contexto.** `WITHDRAWN` existia na máquina de estados desde a revisão da FASE 4, sem
caminho de autor: quem enviava na chamada errada dependia de um pedido manual à comissão, e
o trabalho seguia no páreo até alguém agir.

**Decisão.** `withdrawSubmission` (serviço) + `withdrawSubmissionAction` (`submission:update:own`
com posse obrigatória) + botão na página do trabalho, com diálogo que escreve a consequência.
O estado vai para `WITHDRAWN`, o protocolo fica, e o motivo entra na trilha. Depois de
`ACCEPTED`/`REJECTED` o autor não retira — a decisão do comitê não se reescreve pelo botão.
**Rascunho não se retira, se exclui**: os dois caminhos tiram o trabalho do páreo, mas o
rascunho nunca foi enviado, e dois botões para a mesma coisa confundem.

**Consequências.** O autor resolve sozinho o que era pedido manual; a comissão ganha o
motivo na trilha em vez de um e-mail; e a tabela de transições continua sendo a fonte única
da régua (`canWithdrawSubmission` sai dela).

### ADR-309 — A paginação é regra do domínio, e o endereço da lista é canônico

**Contexto.** O diretório de instituições paginava desde a FASE 9, com a conta embutida
dentro do `buildDirectory`. Eventos públicos e submissões do autor liam tudo: a página
ficava mais lenta a cada evento cadastrado, sem que ninguém percebesse a causa.

**Decisão.** `pagination-rules.ts` passa a ser a **única fórmula** (`normalizePage`,
`normalizePageSize`, `paginationWindow`), e o `buildDirectory` chama a mesma função. As duas
listas leem em página (`skip`/`take`) com o `count` na MESMA transação, e a lista de status
publicamente visíveis vira uma só, exportada do domínio. A página 1 não carrega
`?pagina=1`: `/eventos` e `/eventos?pagina=1` seriam a mesma tela em dois endereços.

**Consequências.** A lista não cresce com o acervo; o total e a fatia não divergem; e o
endereço é compartilhável no estado em que a pessoa está. Página além do fim cai na última
(em vez de lista vazia com "página 99 de 3"), e lista vazia tem uma página vazia — nunca
"página 1 de 0".
### ADR-310 — O CPF vive na INSCRIÇÃO, e não no perfil

**Contexto.** O certificado precisa do CPF para valer como documento (ata, lista de presença,
conferência do participante). O perfil da pessoa é **global**: vale em todas as instituições,
para sempre, e é lido por telas que não têm nada a ver com aquele evento.

**Decisão.** O CPF é pedido no formulário de **inscrição no evento**, gravado em
`registration.formResponses` (dígitos, sem máscara) e validado pelos dois dígitos verificadores.
A variável `cpf` do certificado lê essa inscrição — a do EVENTO (`activityId: null`) —, e o
título da apresentação lê o trabalho enviado.

**Consequências.** O dado tem finalidade declarada na tela, dono (a inscrição) e prazo (o
evento); a pessoa que não informa continua se inscrevendo, e o certificado sai sem a linha do
CPF. O perfil não ganha campo sensível novo. Em troca, o mesmo CPF é digitado a cada evento —
e é o preço aceito por não carregar documento no cadastro global.

### ADR-311 — A miniatura é DERIVADA na leitura e guardada no bucket

**Contexto.** A galeria do acervo carregava a imagem inteira para desenhar 80 px, e o acervo
anterior à FASE 46 nunca passou pela esteira do WebP.

**Decisão.** Uma rota autenticada (`page:manage`) deriva a miniatura na **primeira visita**
(320 px, `cover`, WebP q70), grava em `thumbs/<chave>.webp` no MESMO bucket e responde com cache
de um mês. A segunda visita é um `HEAD`.

**Consequências.** Nenhuma coluna nova, nenhuma migração, e o acervo ANTIGO ganha miniatura na
primeira abertura. O original permanece — é ele que a página pública renderiza. Falha ao guardar
a miniatura não nega a imagem (o `catch` registra e serve assim mesmo): quem pediu precisa dela
agora, e a próxima visita paga o custo de novo.

### ADR-312 — O reprocessamento troca a CHAVE, e por isso pula o que está em uso

**Contexto.** Converter o acervo antigo exige escolher entre sobrescrever o objeto (mantendo a
URL) ou gravar em chave nova (mantendo a honestidade da extensão). A FASE 46 já decidiu que um
`.png` com bytes de WebP é mentira gravada no bucket — mas a URL está gravada nas referências.

**Decisão.** Chave NOVA (`webpKeyFor`) e **imagem em uso é pulada**, com o número no relatório.
A ordem é: objeto novo → linha apontando para ele → original apagado.

**Consequências.** O acervo livre converte com segurança e idempotência; o que está publicado
continua pesado até alguém reescrever as referências — e isso é a dívida **E78**, declarada em
vez de escondida. Reescrever referência exige tocar em JSON de blocos, capa, logotipos e fotos:
um trabalho com risco próprio, que não cabia dentro de um mutirão de dívidas.
### ADR-313 — A resposta aponta para a RAIZ da conversa, e responder é posse

**Contexto.** O recado nasceu em mão única (FASE 32, ADR-156): a instituição falava e a pessoa
só lia. A dívida E45 pede a resposta "na própria caixa de entrada (uma thread por mensagem) e o
indicador de resposta na ficha".

**Decisão.** `participant_messages` ganha `direction` (`OUTBOUND`/`INBOUND`) e `parentId`, que
aponta sempre para o **recado raiz** — responder a uma resposta não cria um nível novo. O
assunto ganha `Re:` uma vez (`replySubjectFor`), a resposta nasce com `readAt` nulo (marcador da
EQUIPE, que ainda não leu) e a ação NÃO exige permissão nova: responder é ato de posse, com o
`userId` vindo da sessão e conferido de novo no `where`.

**Consequências.** A conversa é uma lista de duas consultas, e o indicador "respondeu" cabe numa
leitura — nas duas telas que o mostram (a caixa da pessoa e a ficha da instituição). A
alternativa (árvore, com o pai sendo a mensagem anterior) foi descartada justamente por isso:
todo leitor teria de percorrer níveis para responder "esta conversa foi respondida?".
### ADR-314 — A denúncia nasce na casa e a decisão é da plataforma

**Contexto.** O perfil público mistura conteúdo da PESSOA com endereço da INSTITUIÇÃO, e a
dívida E62 pede denúncia, fila de revisão e o poder de ocultar. Havia duas leituras possíveis:
fila por instituição ("ocultar nesta casa") ou fila de plataforma.

**Decisão.** Denúncia com o contexto de quem denunciou (tabela `profile_reports`, sob RLS, com
trilha na casa) e **decisão de plataforma** (`/superadmin/denuncias`, `adminPrisma` em
`src/lib/platform/**`), que oculta o perfil para TODAS as casas. A trilha da decisão grava
`tenantId: null` — é ato de plataforma, e aparece em `/superadmin/auditoria`; a da denúncia fica
na casa.

**Consequências.** O mesmo conteúdo é julgado uma vez, com um dono visível. Em troca, a
instituição não decide sozinha o que aparece no domínio dela — e é por isso que a fila mostra a
ORIGEM de cada denúncia e a nota da decisão é obrigatória: quem foi afetado consegue reconstruir
o caminho. Ocultar preserva o `publicHandle` (reserva do nome) e é reversível limpando as duas
colunas, sem apagar a história, que vive em `profile_reports`.
## 5. Lições aprendidas (defeitos REAIS, encontrados por testes)

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `expected 'PENDING:-' to be 'CONFIRMED:-'` em dois testes de integração da F34/F37, e um de gamificação sem crédito de XP | A promoção passou a reter a vaga, mas **quem confirma `PENDING` é a equipe** — e ela só confirma quando a atividade exige conferência. Numa atividade gratuita (ou no evento) a vaga ofertada **não tinha quem a confirmasse**: ciclaria a cada 48 h | `acceptPromotion` + `canAcceptPromotion` + botão "Aceitar a vaga"; onde há exigências, a marcação do item obrigatório auto-confirma (F34), e os testes passaram a medir os DOIS caminhos |
| E2E novo: a segunda pessoa lia **"Sua inscrição no evento está ativa"** estando apenas na fila | A tela pública tratava `WAITLISTED` como inscrição ativa (o mesmo `if` que cobria `PENDING` e `CONFIRMED`) | A tela passou a ter estado próprio: "Você está na lista de espera do evento", com a POSIÇÃO e o prazo de 48 h de quando for chamada |
| `expected 1 to be 2` na conferência de contadores | O teste contava linhas `CONFIRMED` para medir quem ocupava vaga; a vaga promovida agora é `PENDING` (que também retém, desde a F34) | O teste passou a medir `seatedRows` (`PENDING`+`CONFIRMED`+`ATTENDED`) **e** `confirmedRows`, com o comentário do porquê |
| `expected 2 to be 1` no empate da fila de confirmações | A promoção da fila **cria pendência** (a vaga retida com prazo próprio), e o teste procurava um empate no conjunto inteiro — o id fixo de antes virou dependência entre testes | O empate passou a ser procurado no **menor prazo**, que é o critério com que a fila escolhe a atividade que abre |
| Teste de idempotência da varredura falhou ao rodar o relógio a +10 dias | A promoção tem janela própria de 48 h: a +10 dias ela vence **de verdade**, e a vaga é devolvida — não é uma segunda liberação, é a próxima | A segunda varredura passou a cair **dentro** da janela (+1 dia), e o comentário explica por que o instante do teste mudou com a dívida |
| Aviso de promoção dizendo "a próxima pessoa" quando três foram chamadas | `promoted` era singular e a mensagem, fixa | A mensagem fala no singular e no plural, com a contagem |

| E2E novo: `createSubmission` recusou com **"Revise os dados da submissão"** | O fixture tinha resumo de ~130 caracteres e 2 palavras-chave; o domínio exige **150** e **3** | O fixture passou a citar os mínimos no próprio comentário, para o próximo que escrever um não tropeçar neles |
| E2E novo: **"Selecione a trilha temática da submissão"** | Submeter exige trilha, e o cenário não criava nenhuma | A trilha entrou no `beforeAll`, com o limite por autor alto e o motivo escrito |
| E2E novo: **"Permissão negada: submission:update:own"** para a autora do próprio trabalho | A fixture vinculava a pessoa como `MEMBER` **sem papel**: vínculo não é permissão. As permissões saem dos PAPÉIS (`ROLE_PERMISSIONS`), e o mínimo do público vive no papel `PARTICIPANT` | `linkUser(..., kind: 'PARTICIPANT')` **e** `grantRole(..., role: 'PARTICIPANT')` — a fixture passou a representar uma pessoa real |
| Teste de paginação passou com `-t` e falhou no arquivo inteiro (ou o contrário) | O total esperado contava submissões criadas por OUTROS testes | O teste cria as três de que precisa e afirma `>=`, em vez de depender de ordem de execução |
| E54: o catálogo do editor **não tinha** CPF nem título da apresentação — e um teste dizia exatamente isso | A dívida era conhecida e estava presa por catraca; faltava a FONTE, e o teste antigo era a prova de que a ausência era intencional | O teste foi INVERTIDO: agora prende que as duas variáveis existem, que cada uma declara a `source` e que as duas podem ficar vazias |
| Snapshot do certificado saiu **sem** as variáveis novas | `contentValuesFrom` congela apenas `CONTENT_VARIABLE_KEYS` — o teste provou que o snapshot não muda se a variável não entra na lista do conteúdo | As duas entraram em `CONTENT_VARIABLE_KEYS` com a razão escrita: são conteúdo, e conteúdo congela |
| E2E: CPF recusado e o **campo vazio** na mensagem seguinte | O React 19 zera os campos do formulário quando a Server Action responde; a mensagem pedia para conferir um número que tinha sumido | A action devolve `values` no estado de erro e o formulário usa `defaultValue` — corrigir um dígito não custa redigitar tudo |
| E45: a resposta da pessoa ia inflar o "não lida" DELA mesma | `readAt` é o marcador do DESTINATÁRIO e a resposta nasce com ele nulo — quem ainda não leu é a EQUIPE. Reaproveitar a coluna faria o autor da resposta ver "1 não lida" na própria caixa | O não lido filtra `parentId: null` (só recados), a régua ficou no domínio e o teste de integração prende o número (1, e não 2) |
| **Terceira vez**: `prisma migrate dev` sem `generate` deixou o client velho | O typecheck acusou "propriedade `parentId` não existe" em código CORRETO — o client em `src/generated/prisma` era o anterior | `npx prisma generate` explícito depois de toda mudança de schema (armadilha **106**, registrada porque já custou três vezes) |
| E62: a decisão de moderação precisava de `UPDATE` condicional, não de leitura-e-escrita | Dois moderadores decidindo ao mesmo tempo reescreveriam a mesma denúncia; a leitura prévia não é decisão | `updateMany` com `status: 'OPEN'` no filtro, na MESMA transação que grava o efeito no perfil: o segundo recebe `ALREADY_DECIDED` || E2E: esperava o cartão de sucesso do formulário e a página mostrava "inscrição ativa" | A inscrição no EVENTO revalida a página, e o formulário sai de cena — o sucesso é o estado da PÁGINA, não do componente | A asserção passou a olhar `event-registration-status`, que é o que a pessoa realmente vê |
| Galeria: `eslint-disable` do `<img>` ficou órfão e o aviso voltou | O comentário estava acima do bloco novo, e a diretiva precisa ficar IMEDIATAMENTE acima do elemento | Diretiva movida para a linha anterior ao `<img>` || **Duas vezes**: varredura de linha em `peer-review.test.ts` cortou linhas de OUTRO teste (o de conflito, que precisa enviar arquivo), e o arquivo parou de compilar | Mesma armadilha do corte por linha, agora em arquivo grande: a condição de âncora casou em mais de um lugar | Reparo ancorado no texto exato, lido antes — e a regra de método (linha única ou `edit` ancorado) vale também para TESTE |**E a lição de método, que custou três tentativas no mesmo arquivo:** editar teste com
varredura de linha e `continue` sobre blocos de comentário **é a mesma armadilha do corte
por linha** que já tinha custado a fatia 3 da FASE 55. O caminho que funciona é a
substituição de **linha única** ou a edição **ancorada** (com o texto exato lido antes) —
nunca o descarte por varredura.

```text
# FATIA 1 (E33 + E1)
npm run typecheck .............. 0 erros
npm run lint ................... 0 erros, 0 warnings
npm test ....................... 134 arquivos · 2736 testes passando
npm run build .................. Compiled successfully
npx playwright test event-waitlist.spec.ts ............ 2 passed
npx playwright test registration-journey registration-confirmation event-waitlist ... 19 passed

# FATIA 2 (E2 + E31)
npm run typecheck .............. 0 erros
npm run lint ................... 0 erros, 0 warnings
npm test ....................... 135 arquivos · 2754 testes passando
npx vitest run tests/unit/pagination-rules.test.ts .... 10 passed
npx vitest run tests/integration/peer-review.test.ts .. 33 passed (retirada + paginação)
npx playwright test f56-fatia-2.spec.ts ............... 2 passed
npx playwright test f56-fatia-2 peer-review f51-submission-track registration-journey ... 23 passed

```text
# FATIA 3 (E18 + E65 + E54)
npm run typecheck .............. 0 erros
npm run lint ................... 0 erros, 0 warnings
npm test ....................... 137 arquivos · 2771 testes passando
npm run build .................. Compiled successfully (rota da miniatura no manifesto)
npx vitest run tests/unit/registration-form-rules.test.ts ......... 13 passed
npx vitest run tests/integration/media-reprocess.test.ts .......... 3 passed
npx vitest run tests/integration/certificate-template.test.ts ..... 28 passed
npx playwright test tests/e2e/f56-fatia-3.spec.ts ................. 2 passed
npm run media:reprocess -- --dry-run .............................. relatório sem escrever nada
```npm run test:e2e (suíte completa) ..................... 216 passed · 6 skipped · 0 failed
```
## 7. Comandos operacionais

```bash
# As regras da fila e do prazo, sem banco
npx vitest run tests/unit/registration-rules.test.ts

# O caminho inteiro no banco: enfileirar, promover, vencer, promover de novo
npx vitest run tests/integration/event-registration.test.ts

# Pelo navegador: fila, visão da instituição e aceite
npx playwright test tests/e2e/event-waitlist.spec.ts
```

## 8. Dívidas e pontos de atenção

- **E33 e E1 quitadas** nesta fatia. As outras sete seguem abertas (E2, E31, E18, E65, E54,
  E62, E45) e são as fatias 2 a 4 deste mutirão.
- **A fila do evento não tem aviso de "ainda estou esperando"** — quem entra na fila recebe
  o aviso da promoção, e nada entre um e outro. Se o evento demorar a liberar vaga, a
  pessoa não sabe se ainda está na fila: a tela diz a posição, mas não há lembrete
  periódico (a FASE 34 tem lembrete de prazo; a fila não tem).
- **A promoção não é oferecida por ordem de "quem mais quer"** — é a posição, e ponto. Não
  há como o organizador escolher a próxima pessoa à mão (o que seria útil quando a
  instituição sabe que alguém desistiu).
- **O aceite usa `registration:create`** por não existir `registration:update:own` no
  catálogo: aceitar a vaga é o ato de completar a própria inscrição. Se um papel futuro
  precisar aceitar sem poder se inscrever, a permissão própria terá de ser criada.

## 9. Checklist de aceite

- [x] Evento com lotação enfileira em vez de recusar, com POSIÇÃO disputada no banco
- [x] Evento sem lotação continua recusando o impossível (não inventa fila)
- [x] Quem espera **não** é inscrito nas atividades abertas
- [x] A promoção reserva o lugar no evento, retém com prazo e **então** inscreve nas abertas
- [x] A promoção da ATIVIDADE também retém com prazo
- [x] Prazo de 48 h no domínio (`PROMOTION_WINDOW_HOURS`), com teste
- [x] A varredura de expiração alcança a linha do EVENTO (filtro de relação não descarta o nulo)
- [x] Cancelar devolve todas as vagas e chama todas as filas, com aviso e XP por promoção
- [x] A pessoa aceita a vaga ofertada (serviço, action com posse, botão com prazo)
- [x] Onde a equipe confirma, o aceite não aparece e o checklist da F34 fala
- [x] A instituição vê quem espera, com nome e posição
- [x] A tela pública diz a verdade sobre a fila (não é "inscrição ativa")
- [x] Testes de unidade, integração e E2E da fatia
- [x] `typecheck`, `lint`, `npm test` e `build` verdes
- [x] **Fatia 2** (E2 + E31): paginação com endereço canônico e retirada pelo autor
- [x] **Fatia 3** (E18 + E65 + E54): miniatura no acervo, reprocessador do acervo antigo e as duas variáveis novas do certificado
- [x] **Fatia 4** (E62 + E45): resposta ao recado com thread e indicador na ficha, e denúncia com fila de moderação da plataforma
