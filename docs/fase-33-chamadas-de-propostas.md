# FASE 33 — Chamadas de propostas (call for proposals)

> **Escopo definido pelo humano.** *"Hoje temos a submissão de artigos/trabalhos, quero um
> call for papers mais abrangente, para que se possa ter chamadas para palestrantes,
> minicursos e outras atividades para o evento. Esse call for papers deve ir para a página
> pública do evento depois, onde o organizador escolhe onde colocar, como já temos aquela
> edição de Blocos da página pública."*
>
> **Acréscimo aprovado junto:** *"o protocolo de aceite permite o organizador escolher se
> quer criar a atividade e enviar convite para o palestrante."*
>
> As decisões de desenho foram escolhidas pelo humano antes do código (§3.8).

---

## 1. Sumário executivo

Até esta fase, o evento tinha **uma** chamada: a janela em `Event.cfpOpensAt`/`cfpClosesAt`, e
as regras de avaliação (rubrica, cegueira, limite por autor) presas à **trilha**. Quem quisesse
convidar um palestrante ou receber propostas de minicurso não tinha onde: a janela era uma só, o
formulário era o de artigo, e **não havia formulário público nenhum** — submeter exigia conta,
vínculo e navegação até o painel.

Esta fase transforma a chamada em **entidade**: cada chamada tem o próprio TIPO, o próprio texto,
a própria janela, a própria cegueira, a própria rubrica e o próprio limite por autor. A proposta
é uma submissão (o motor de avaliação da FASE 4 continua sendo o único), a porta é **pública**
(com conta criada no próprio caminho), o organizador escolhe **onde** o bloco de chamadas aparece
na página do evento — e o **protocolo de aceite** fecha o ciclo: aceitar é a decisão do comitê;
criar a atividade na programação e convidar o proponente como palestrante são **escolhas do
organizador**, nunca consequências automáticas.

### Entregas

| Entrega | Onde |
|---|---|
| Domínio puro: 7 tipos de proposta, campos por tipo, validação, estados e janela da chamada, contagem, limite por autor, plano do aceite, título da atividade | `src/domain/proposals/call-rules.ts` |
| Domínio: prontidão de envio ciente do TIPO (não científica não exige trilha; arquivo é aviso, não bloqueio) | `src/domain/review/submission-rules.ts` |
| Domínio: precedência de rubrica **CHAMADA → TRILHA → PADRÃO** | `src/domain/review/review-rules.ts` (`resolveEffectiveRubric`) |
| Aplicação: CRUD da chamada, publicação, exclusão protegida, listagem pública, lista de propostas | `src/lib/proposals/call-service.ts` |
| Aplicação: envio da proposta pelo caminho da submissão, com vínculo de participante e e-mail de confirmação | `src/lib/proposals/proposal-service.ts` |
| Aplicação: protocolo de aceite (decisão pelo motor da FASE 16 + atividade + convite) e o contexto que o painel lê | `src/lib/proposals/acceptance-service.ts` |
| Aplicação: guarda compartilhada da **ação pública autenticada** (`guardSelfServiceAction`) | `src/lib/auth/guard-action.ts` |
| Actions: painel (salvar/publicar/excluir), proposta pública, aceite | `src/app/actions/call-actions.ts` |
| Telas: painel de chamadas do evento, página pública da chamada com formulário, protocolo de aceite no painel do comitê | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/`, `.../(public)/eventos/[eventSlug]/chamada/[callSlug]/`, `.../(app)/comite/[submissionId]/` |
| Componentes: formulário público da proposta (campos por tipo vindos do domínio) e painel do aceite | `src/components/proposals/*` |
| Bloco novo da página pública `CALL_FOR_PROPOSALS`, com editor (título, texto de apoio, incluir encerradas) | `src/domain/events/landing-page.ts`, `src/components/events/block-renderer.tsx`, `src/components/admin/block-content-fields.tsx` |
| Dois templates de e-mail: `PROPOSAL_RECEIVED` e `SPEAKER_INVITATION` — o segundo **quita a dívida E25** | `src/domain/communication/email-templates.ts` |
| Migrações à mão: tabela + enum `ProposalKind` + colunas em `submissions` + o valor de enum do bloco + a coluna `deletedAt` que faltava | `prisma/migrations/20260922010530_call_for_proposals/`, `20260922023000_call_block_type/`, `20260922024500_call_deleted_at/` |
| Dado de demonstração: 2 chamadas publicadas, 1 proposta com protocolo e o bloco na página do congresso | `prisma/seed.ts` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **16** — 15 de código e teste (3 migrações, 1 de domínio, 3 de aplicação, 1 de actions, 2 de componente, 2 de página, 3 de teste) + este documento |
| Arquivos alterados | **32** — 28 de código e teste (`schema.prisma`, `seed.ts`, contrato de schema, guia de blocos, renderizador, editor de bloco, landing, **seis** páginas existentes, **quatro** domínios de avaliação e de eventos, **cinco** serviços, guarda das actions, templates de e-mail, **o telão do sorteio** — pela armadilha 78 — e **quatro** arquivos de teste) + 4 de documentação |
| Migrações | **3** — `20260922010530_call_for_proposals`, `20260922023000_call_block_type`, `20260922024500_call_deleted_at` — total **29** |
| Tabelas de tenant | **41** sob RLS + FORCE |
| Permissões | **60** (nenhuma nova: `event:manage` para a chamada, `submission:create` para propor, `submission:decide` para o aceite) |
| Templates de e-mail | **11** (`PROPOSAL_RECEIVED`, `SPEAKER_INVITATION`) |
| Dependências novas | **nenhuma** |
| ADRs | **158 … 169** (a próxima é a 170) |
| Testes novos | **52** no Vitest (dois arquivos novos: 26 de domínio e 16 de integração, mais 10 casos acrescentados a arquivos existentes) + **4** E2E — a suíte foi de **1638/69** para **1690/71** |
| Defeitos reais encontrados | **6** com número de armadilha — a coluna `deletedAt` ausente na migração (toda escrita falhava), o resumo com mínimo de 30 na tela contra 150 no domínio, a rubrica da chamada sem quem a lesse, o painel de aceite que desaparecia sem confirmação, a fixture que vencia à meia-noite e a roleta do telão que às vezes não rodava (armadilhas **73 a 78**) —, mais três defeitos menores que os testes da fase pegaram: a leitura de uma instituição vizinha respondendo erro de infraestrutura, os códigos do plano de aceite achatados em `INVALID_INPUT` e a fixture do aceite incoerente com as regras do produto |
| Dívidas quitadas | **E25** (convite de palestrante não saía por e-mail) — a fase declarou **E46** e **E47** |

---

## 2. O problema mais difícil: **a chamada não é uma trilha, e a proposta não é um artigo**

A tentação era evidente: "chamada" já existia como `Track` (que tem rubrica, cegueira e limite) e
a janela já existia no evento. Bastaria acrescentar um campo "tipo de proposta" na trilha.

O que impede essa solução é que as três coisas que definem uma chamada — **o que se pede**, **quem
julga** e **para que serve o resultado** — não andam juntas na trilha:

1. **A trilha é o eixo temático, e é por ela que o revisor é escolhido.** A afinidade (FASE 4) é
   calculada pela trilha. Uma chamada de minicurso, de palestrante ou de mesa **não tem eixo
   temático** — e forçá-la numa trilha faria a escolha de revisores acontecer por um tema que não
   existe, ou obrigaria a criar trilhas fictícias ("Palestrantes", "Minicursos") que apareceriam
   na página pública como se fossem temas científicos.
2. **A trilha é permanente; a chamada é temporária.** A trilha continua valendo na próxima edição;
   a chamada fecha, é despublicada e refeita. Amarrar a janela à trilha faria a instituição apagar
   a trilha para fechar a chamada.
3. **A pergunta feita ao proponente muda com o tipo** — e a resposta precisa ser validada por
   tipo. Carga horária e público-alvo (minicurso), minibiografia e temas (palestrante), formato e
   duração (mesa). Um campo livre "observações" transferiria para a organização a tarefa de
   descobrir, na leitura, qual número é qual.

A decisão, então, foi criar a entidade — e, ao mesmo tempo, **não** duplicar o motor de avaliação:
a proposta **é** uma `Submission` com `callId` e um JSON de campos do tipo. Isso preserva tudo o
que a FASE 4 construiu (pareceres, quórum, revisão cega, nota ponderada, decisão com auditoria) e
mantém **uma** pergunta "por que critérios esta proposta foi julgada?".

O segundo problema é o **aceite**, e ele é de natureza diferente. Aceitar uma proposta de minicurso
não termina na decisão: a atividade precisa entrar na programação e o proponente precisa ser
convidado como palestrante. Fazer isso automaticamente seria errado por dois motivos concretos —
a proposta **não pede horário** (quem monta a grade é a organização, e criar uma atividade em 1970
ou num horário conflitante é pior do que não criar), e o convite **manda e-mail** para uma pessoa
real (que pode ainda não ter sido aprovada na grade final). Daí o protocolo ser de **escolhas**:
a decisão é uma, e o que vem depois dela é o organizador quem determina.

---

## 3. Decisões técnicas

### 3.1 A chamada é uma entidade própria (`call_for_proposals`)

`CallForProposals` guarda `kind`, `slug`, `title`, `summary`, `instructions`, `opensAt`,
`closesAt`, `isPublished`, `requiresBlindReview`, `reviewRubric`, `maxSubmissionsPerAuthor`,
`trackId` (opcional) e `createdById`. O índice único é `(eventId, slug)` — o slug é o endereço
público do formulário, e dois eventos da mesma instituição podem ter a mesma chamada.

`Event.cfpOpensAt`/`cfpClosesAt` **não foram removidos**: a submissão de artigo pelo painel
continua usando a janela do evento, e apagar a coluna reescreveria o histórico de quem já
submeteu. A trilha continua com `maxSubmissionsPerAuthor`, `requiredReviews` e os limiares — a
chamada **não** redefine quórum (§8).

### 3.2 Sete tipos, e o mapa tipo → tipo de atividade

`PROPOSAL_KINDS` = `PAPER`, `SPEAKER`, `MINICOURSE`, `WORKSHOP`, `ROUNDTABLE`, `POSTER`, `OTHER`.
O `OTHER` existe porque a lista fechada sem saída obriga a instituição a mentir sobre o que está
pedindo — e o rótulo é explícito na tela ("Outra atividade").

Cada tipo traz três decisões no domínio:

- **`PROPOSAL_KIND_ACTIVITY_TYPE`** — o tipo de atividade que a proposta aceita vira na
  programação (`SPEAKER → LECTURE`, `MINICOURSE → MINI_COURSE`, `ROUNDTABLE → ROUND_TABLE`…). É o
  que faz o aceite criar a atividade já no lugar certo, com o organizador podendo trocar.
- **`PROPOSAL_KIND_FIELDS`** — o que a chamada pede ALÉM do comum (título, resumo, palavras-chave,
  idioma). Validado por `validateProposalData`, que **descarta campos que não são do tipo** (um
  `workloadMinutes` enviado numa chamada de palestrante não é gravado).
- **`defaultBlindFor`** — cego por padrão para artigo e pôster; aberto para os demais. A chamada
  pode forçar qualquer um dos dois.

### 3.3 A proposta é uma `Submission` — com cegueira e rubrica **por chamada**

`Submission` ganhou `callId` (nulável, `ON DELETE SET NULL`) e `proposalData` (JSON). O
`submitSubmission` já avaliava a prontidão com `requiresBlindReview`; ele passou a preferir a
chamada: `call ?? track ?? true`. A rubrica ganhou a mesma precedência, agora explícita em
`resolveEffectiveRubric`:

```
CHAMADA  →  TRILHA  →  PADRÃO
```

A função é usada pelos **três** caminhos que precisam dela (o parecer do revisor, o painel do
comitê e as telas de submissão), e a chamada pode apontar uma trilha **e** ter rubrica própria: a
trilha serve à afinidade dos revisores, a rubrica própria serve ao julgamento.

Uma rubrica de chamada **malformada** cai para a da trilha (e não direto para o padrão): jogar
fora uma configuração válida da trilha por causa de um erro em outro lugar seria o pior dos dois
mundos. Teste unitário prende os quatro casos.

### 3.4 Não científica: a trilha deixa de ser obrigatória, e o arquivo vira aviso

`evaluateSubmissionReadiness` exigia `trackId` — correto para artigo, impossível para palestrante.
Agora ela recebe `proposalKind` e, quando o tipo **não é científico** (`PAPER` e `POSTER` são):

- **trilha ausente deixa de ser bloqueio**;
- **nenhum arquivo anexado passa a ser AVISO**, não bloqueio — um resumo de palestra é avaliável
  sem PDF, e a mensagem diz isso ao comitê em vez de impedir o envio.

Para o trabalho científico, nada mudou: trilha obrigatória e arquivo obrigatório continuam
bloqueando. Um teste unitário prende os dois lados, inclusive o caso do arquivo suplementar (que
**conta** como arquivo anexado — ele existir já é meio caminho).

### 3.5 A porta é pública, e a conta nasce no caminho

`submitProposalAction` usa **`guardSelfServiceAction`**, extraída da inscrição pública da FASE 10:
quem tem vínculo ativo passa pela permissão (`submission:create`); quem **não tem vínculo** passa
direto e o serviço aplica os bloqueios (vínculo suspenso ou removido) sob RLS. Exigir vínculo
recusaria o caso normal — a pessoa de fora que recebeu o convite por e-mail.

É a **segunda** cópia da mesma autorização (a primeira era local em `registration-actions.ts`), e
por isso a FASE 33 a moveu para `guard-action.ts` e apagou a cópia: guardas gêmeas divergem na
primeira manutenção (armadilha 55/72).

A página pública mostra a chamada para LER sem sessão; para ENVIAR, o servidor exige sessão e a
tela oferece `/login` e `/signup` com o caminho de volta para a chamada. O vínculo de participante
nasce da proposta, com a regra compartilhada (`linkParticipantIfEligible`).

### 3.6 O limite por autor é POR CHAMADA

`canSubmitToCall` conta as propostas vivas do autor **naquela chamada** (`WITHDRAWN`, `CANCELED` e
`REJECTED` não contam). Contar no evento faria o limite de uma chamada consumir a cota da outra —
e a mensagem que a pessoa lê fala da chamada que ela abriu.

### 3.7 O protocolo de aceite: decisão pelo motor, e duas escolhas explícitas

`acceptProposal`:

1. carrega proposta, chamada, evento e proponente (autor de ordem 1);
2. valida o **plano** (`planAcceptance`): criar atividade sem agenda e convidar sem e-mail são
   recusados **antes** da decisão, com o código do domínio preservado (`MISSING_SCHEDULE`,
   `INVALID_SCHEDULE`, `MISSING_EMAIL`) — achatar tudo em `INVALID_INPUT` faria a tela perder a
   diferença entre dois problemas com correções diferentes;
3. registra a decisão por **`recordDecision`** (a mesma função do comitê, com a mesma trilha), com
   `overrideQuorum: true` — aceitar uma proposta é ato de organização, e o quórum de pareceres não
   se aplica a uma palestra convidada;
4. **se o organizador pediu**, cria a atividade com título, resumo, tipo e **carga horária
   declarada na proposta** (`proposedWorkload`), na agenda que ele informou;
5. **se o organizador pediu**, cadastra o perfil do palestrante, vincula à atividade criada e
   enfileira o convite por e-mail;
6. audita o conjunto (`entityType: 'proposalAcceptance'`).

**A falha da atividade não desfaz a decisão**: ela entra em `warnings` e o organizador cria a
atividade pela programação (o motivo mais provável é conflito de sala). Recusar o aceite inteiro
por causa da grade seria pior — a proposta está aceita, e isso é um fato.

### 3.8 As decisões que o humano tomou (e o que foi descartado)

| Decisão | Escolha | Alternativa descartada |
|---|---|---|
| Onde mora a chamada | **Entidade nova** (`CallForProposals`, evento × tipo) | Reusar `Track` (a trilha é permanente e tem eixo temático) ou `Event` (uma janela só) |
| Catálogo de tipos | **7 valores fixos**, com `OTHER` | Texto livre (impossível validar campos por tipo) |
| Quem pode propor | **Qualquer pessoa**, com conta criada no caminho (padrão F10) | Só quem tem vínculo (recusaria o convidado de fora) |
| Motor de avaliação | **O mesmo da FASE 4**, com cegueira e rubrica por chamada | Um motor novo para propostas (duas verdades sobre nota e quórum) |
| Onde aparece na página | **Bloco novo** `CALL_FOR_PROPOSALS`, com o organizador escolhendo a posição | Lista automática no cabeçalho do evento (tiraria do organizador a decisão de onde) |
| Campos | **Comuns + campos por tipo** | Só comuns (a organização perderia carga horária e público-alvo) |
| Aceite | **Decisão + escolhas** (atividade e convite são do organizador) | Criar atividade e convidar automaticamente |

### 3.9 O bloco da página pública lê o dado, não guarda cópia

`CALL_FOR_PROPOSALS` guarda apenas o que é decoração (título, texto de apoio) e o filtro
`includeClosed`. O corpo — tipo, prazo, estado e contagem — vem do **banco, na renderização**,
pela mesma leitura do painel (`listPublicCalls`). Uma chamada copiada para dentro do bloco
continuaria anunciando "até 30/11" em dezembro, e o visitante só descobriria depois de preencher o
formulário. Por padrão o bloco mostra só as chamadas **abertas e agendadas**; incluir as encerradas
é escolha explícita do organizador.

---

## 4. ADRs

### ADR-158 — A chamada de propostas é uma ENTIDADE, não uma configuração do evento

**Contexto.** A chamada existia como janela no evento (`cfpOpensAt`/`cfpClosesAt`) e as regras de
avaliação viviam na trilha. O pedido do humano é por chamadas para palestrantes, minicursos e
outras atividades — cada uma com tipo e texto próprios.

**Decisão.** Criar `CallForProposals` (evento × tipo), com janela, publicação, cegueira, rubrica e
limite por autor próprios. `Event.cfp*` e `Track` permanecem intactos.

**Justificativa.** A trilha é permanente e tem eixo temático (é por ela que a afinidade dos
revisores é calculada); o evento tem UMA janela. Nenhum dos dois comporta N chamadas temporárias
com perguntas diferentes.

**Consequências.** O painel ganha uma tela própria por evento; a proposta passa a ter `callId`
(nulável — o histórico anterior não é reescrito). A dívida E46 registra o que ficou de fora: o
anexo de arquivo.

### ADR-159 — Sete tipos de proposta, com `OTHER` e um mapa para o tipo de atividade

**Contexto.** O formulário e a validação precisam saber o que perguntar; a programação precisa
saber o que criar quando a proposta é aceita.

**Decisão.** `PROPOSAL_KINDS` com sete valores, `PROPOSAL_KIND_FIELDS` por tipo e
`PROPOSAL_KIND_ACTIVITY_TYPE` ligando cada tipo ao tipo de atividade correspondente.

**Justificativa.** Tipo fixo é o que permite validar campo por campo (o domínio descarta campos
estranhos ao tipo) e o que faz o aceite criar a atividade já no lugar certo. `OTHER` fecha a lista
sem obrigar a instituição a mentir.

**Consequências.** Acrescentar um tipo é uma migração de enum (como o bloco de página) e um mapa a
mais no domínio — barato e explícito.

### ADR-160 — Cegueira e rubrica são da CHAMADA, com precedência CHAMADA → TRILHA → PADRÃO

**Contexto.** A trilha define `requiresBlindReview` e `reviewRubric`. Uma chamada de minicurso
pode apontar a trilha "Extensão" para achar revisores afins e ainda assim julgar por critérios de
oficina.

**Decisão.** A chamada pode ter rubrica e cegueira próprias; quando tem, vencem as da trilha;
quando não tem, valem as da trilha; sem trilha, a rubrica padrão e a cegueira pressuposta. A regra
vive em `resolveEffectiveRubric` e é usada pelos três caminhos.

**Justificativa.** Sem a precedência, a coluna `reviewRubric` da chamada seria uma promessa de
schema (armadilha 75). Com ela, os critérios da chamada são os que o revisor vê e os que o comitê
lê.

**Consequências.** O painel da chamada ganhou o editor de rubrica (quatro colunas por linha, o
mesmo da trilha). Rubrica de chamada malformada cai para a da trilha, e não para o padrão.

### ADR-161 — A proposta É uma `Submission`

**Contexto.** Propostas precisam de avaliação por pares (a mesma das submissões de artigo):
pareceres, cegueira, quórum, nota ponderada e decisão auditada.

**Decisão.** `Submission` ganhou `callId` (nulável) e `proposalData` (JSON), e a proposta entra
pelo mesmo motor. O aceite registra a decisão por `recordDecision`.

**Justificativa.** Um motor paralelo criaria duas verdades sobre nota, quórum e transição de
situação — e a segunda não teria teste nem auditoria. A coluna nulável preserva o histórico.

**Consequências.** O JSON do tipo não é pesquisável por SQL direto (aceitável: os campos são de
exibição e de decisão, e o índice `(tenantId, callId, status)` cobre as listas). Quórum e limiares
continuam vindo da trilha, com os padrões quando não há trilha.

### ADR-162 — Fora da ciência, trilha não é obrigatória e arquivo é aviso

**Contexto.** `evaluateSubmissionReadiness` exigia trilha e arquivo — correto para artigo,
impossível para palestrante e minicurso.

**Decisão.** A prontidão recebe o tipo da proposta; para tipo não científico, trilha ausente não
bloqueia e "nenhum arquivo" vira aviso. Para artigo e pôster, tudo continua bloqueando.

**Justificativa.** Um resumo de palestra é avaliável sem PDF, e o comitê precisa saber que não há
anexo — não ser impedido de aceitar por isso. O trabalho científico continua exigindo o documento
que a revisão cega avalia.

**Consequências.** A mensagem de aviso aparece no painel de envio; o arquivo suplementar conta
como arquivo anexado (teste prende).

### ADR-163 — Qualquer pessoa pode propor; a conta nasce no formulário

**Contexto.** O convite a um palestrante externo chega por e-mail a alguém que quase nunca tem
conta na plataforma.

**Decisão.** A leitura da chamada é pública; o envio exige sessão, e a tela oferece entrar ou criar
conta com o caminho de volta. A autorização usa `guardSelfServiceAction` (com vínculo ativo, vale
`submission:create`; sem vínculo, o serviço decide sob RLS).

**Justificativa.** É o mesmo desenho da inscrição pública (FASE 10), e a regra agora é uma só nos
dois caminhos. O vínculo de participante nasce da proposta.

**Consequências.** A guarda local de `registration-actions.ts` foi apagada em favor da
compartilhada — duas cópias da mesma autorização divergem na primeira manutenção.

### ADR-164 — O limite de propostas por autor é POR CHAMADA

**Contexto.** A trilha já tem `maxSubmissionsPerAuthor`, contado por trilha.

**Decisão.** `canSubmitToCall` conta as propostas vivas do autor naquela chamada; propostas
retiradas, canceladas ou rejeitadas não contam. Os códigos de recusa são os da chamada
(`CALL_NOT_PUBLISHED`, `CALL_NOT_OPEN`, `CALL_CLOSED`, `AUTHOR_LIMIT_REACHED`).

**Justificativa.** A chamada promete "até 2 propostas por pessoa nesta chamada". Contar no evento
faria o limite de uma consumir a cota da outra — e a mensagem fala da chamada que a pessoa abriu.

**Consequências.** O mesmo autor pode propor em várias chamadas; o painel mostra o total por
chamada.

### ADR-165 — Aceitar é a decisão do comitê; criar atividade e convidar são ESCOLHAS

**Contexto.** Aceitar uma proposta de minicurso não termina na decisão: a atividade precisa entrar
na grade e o proponente precisa ser convidado.

**Decisão.** O protocolo de aceite registra a decisão por `recordDecision` (`ACCEPTED`,
`overrideQuorum: true`) e então, **apenas se o organizador marcou**, cria a atividade e/ou convida.
A falha da atividade não desfaz a decisão — vira aviso na resposta.

**Justificativa.** A proposta não pede horário; criar atividade com data inventada coloca uma linha
falsa na programação pública. E o convite manda e-mail para uma pessoa real, que pode ainda não
estar confirmada na grade. Automação aqui transformaria uma decisão em duas consequências não
pedidas.

**Consequências.** A tela do aceite tem duas caixas (ambas marcadas por serem o desfecho comum) e a
resposta diz o que ficou pendente. Sem agenda, a atividade não é criada e a mensagem diz por quê.

### ADR-166 — A atividade criada herda o que a proposta declarou; a agenda é da organização

**Contexto.** O título do formulário é longo; a carga horária foi declarada pelo proponente; o
horário, não.

**Decisão.** A atividade nasce com `activityTitleFromProposal` (título aparado em 300), descrição
do resumo (teto de 1.200 caracteres), tipo mapeado do tipo da proposta e **carga horária de
`proposedWorkload`** (o campo do tipo, com o padrão do tipo como reserva). Horário, sala, vagas e
exigência de inscrição vêm do organizador.

**Justificativa.** Carga horária é dado da proposta (o proponente é quem sabe quanto dura o
minicurso); agenda é dado da organização (só ela conhece a grade e a sala). Inventar qualquer um
dos dois produziria dado falso na programação pública.

**Consequências.** O painel do aceite mostra o título que será criado e a carga horária herdada,
para o organizador conferir antes de confirmar.

### ADR-167 — O convite do palestrante por e-mail quita a dívida E25

**Contexto.** Desde a FASE 25 o convite de palestrante existia como token, e **nunca** era
enviado: a organização copiava o link e mandava por fora (dívida E25, declarada quando a esteira de
e-mail da FASE 15 ainda não existia).

**Decisão.** O aceite gera o convite (token em claro devolvido **uma vez**) e enfileira o
`SPEAKER_INVITATION` com o link do portal, `dedupeKey` derivado do perfil e da data de expiração
(14 dias).

**Justificativa.** A esteira de e-mail existe desde a FASE 15; o que faltava era o template e o
gatilho. Prometer um convite e não enviá-lo era a plataforma empurrando trabalho manual para a
instituição.

**Consequências.** E25 **quitada**. Se o e-mail falhar, a resposta diz que o convite foi gerado e o
link continua disponível na tela de palestrantes (regerar invalida o anterior).

### ADR-168 — O bloco `CALL_FOR_PROPOSALS` lê a chamada na renderização

**Contexto.** A página pública é montada por blocos (FASE 17) e o organizador escolhe onde cada um
fica.

**Decisão.** O bloco guarda só apresentação (título, texto de apoio) e o filtro `includeClosed`; as
chamadas publicadas são lidas do banco na renderização, com estado, prazo e contagem calculados
pelo servidor. O padrão mostra apenas abertas e agendadas.

**Justificativa.** Uma chamada copiada para dentro do bloco mentiria sobre o prazo no dia seguinte
— a mesma razão pela qual os blocos de agenda e de trilhas leem o dado real. E o organizador
continua decidindo a POSIÇÃO do bloco, que era o pedido.

**Consequências.** `EventLanding` passou a receber `publicCalls` (como já recebia `publicRaffles`);
a prévia do rascunho mostra as mesmas chamadas publicadas.

### ADR-169 — O painel de aceite MOSTRA o estado decidido em vez de desaparecer

**Contexto.** Depois do aceite, o organizador precisa de confirmação: a decisão é irreversível
pela tela e as duas escolhas (criar atividade, convidar) podem ter ficado pendentes. A primeira
versão escondia a seção assim que a proposta ganhava decisão — e, como o Server Component é
re-renderizado depois da Server Action, o efeito era o painel sumir **sem nenhuma mensagem**,
levando junto o estado de sucesso do formulário (armadilha 76).

**Decisão.** A seção do protocolo continua na tela para toda proposta de chamada, e o painel
escolhe o que renderizar a partir da situação atual: formulário (sem decisão), bloco de sucesso
(resposta da action) ou aviso "já decidida" com a situação, a data, o caminho da programação e a
indicação de que o resto está na trilha. A action, por sua vez, deixou de revalidar a própria rota
do painel (e continua revalidando a página pública do evento).

**Justificativa.** Sumir é a pior forma de dizer "deu certo": a decisão está gravada, mas quem
operou não vê nada. E oferecer o formulário de novo seria mentir sobre a possibilidade — o motor de
decisão recusaria a transição de `ACCEPTED` para `ACCEPTED`.

**Consequências.** O E2E aceita as duas formas de confirmação (bloco de sucesso **ou** aviso de
decidida) e continua prendendo os fatos no banco: atividade criada com a carga declarada, convite
no outbox e decisão pelo motor do comitê.

---

## 5. Lições aprendidas

Defeitos REAIS encontrados nesta fase, com o sintoma e a correção.

| Sintoma | Causa raiz | Correção |
|---|---|---|
| **Nenhuma chamada podia ser criada**: `The column call_for_proposals.deletedAt does not exist in the current database`. A tabela existia, `npm run db:verify` dizia "Contrato íntegro" e os testes de domínio passavam | A migração foi escrita à mão (armadilha 53) e a coluna `deletedAt` não entrou no `CREATE TABLE` — mas o `schema.prisma`, os serviços e TODAS as consultas a usam. O contrato de schema confere `tenantId` + RLS, não a forma da tabela; o Prisma Client é gerado do modelo, então `tsc` também não vê. Nenhum teste tocava a tabela: o defeito vivia entre "o modelo está certo" e "o banco está certo" | Migração corretiva com `ADD COLUMN` + índice, e o **primeiro teste de integração da fase** é quem pega essa classe (é o único que escreve de verdade). Armadilha **73** |
| O formulário público aceitava um resumo de **30 caracteres** e a recusa só vinha no fim, com "Revise os dados da submissão" — e o texto digitado era perdido | `minLength={30}`/`maxLength={6000}` escritos à mão na tela, enquanto `validateSubmissionContent` (o domínio, executado por `createSubmission`) exige **150 a 5000**. Duas cópias da mesma regra, e a da tela era a errada | Os limites vieram do DOMÍNIO (`MIN_ABSTRACT_LENGTH`, `MAX_ABSTRACT_LENGTH`, `MIN_KEYWORDS`, `MAX_KEYWORDS`), com a regra escrita ao lado do campo. Armadilha **74** |
| A **rubrica da chamada não existia para o motor de avaliação**: o painel do comitê mostrava os critérios da trilha mesmo com `call_for_proposals.reviewRubric` preenchida — e nem havia caminho para preenchê-la | `resolveRubric` e o painel liam **só** `track.reviewRubric`, e `saveCall` não aceitava rubrica. A coluna foi criada pela migração e documentada, mas não tinha quem a escrevesse nem quem a lesse (o inverso da armadilha 67) | `resolveEffectiveRubric` (CHAMADA → TRILHA → PADRÃO) usada pelos três caminhos, `reviewRubric` em `SaveCallInput` com validação do domínio, e o editor de rubrica no painel da chamada. Armadilha **75** |
| A leitura de chamadas por uma instituição vizinha respondia **"não foi possível carregar as chamadas"** (erro de infraestrutura) em vez de "não existe" | O fuso do evento era lido com `findFirstOrThrow`: sob RLS, o evento de outra instituição não aparece e a exceção subia. O teste de isolamento com duas instituições de verdade foi quem expôs — sem ele, o caso nunca aconteceria em produção (a tela sempre resolve o evento no tenant certo) | `eventTimeZone` devolve `null` e as duas listagens respondem `NOT_FOUND` com "Evento não encontrado." — a diferença entre uma resposta e um alarme falso |
| As recusas do aceite chegavam achatadas: convidar quem não tem e-mail e criar atividade sem agenda devolviam o mesmo `INVALID_INPUT` | `acceptProposal` traduzia qualquer falha do `planAcceptance` para `INVALID_INPUT` — dois problemas com correções diferentes e uma mensagem de erro só | `ProposalErrorCode` ganhou `MISSING_SCHEDULE`, `INVALID_SCHEDULE` e `MISSING_EMAIL`, e o código do domínio sobe inteiro |
| **O painel de aceite desaparecia sem confirmação**: o organizador clicava em "Registrar aceite", a decisão era gravada, a atividade criada e o convite enfileirado — e a tela simplesmente removia o painel, sem mensagem nenhuma | A action revalidava `/comite/<id>`, a **própria rota do painel**. O painel só é renderizado enquanto a proposta não tem decisão; com o `revalidatePath`, o Server Component releu o status (`ACCEPTED`), desmontou o painel — e o estado de sucesso do `useActionState` foi junto, porque vive no componente desmontado. O afazer mais importante da tela terminava em silêncio — e tirar o `revalidatePath` sozinho não bastou: a página também é re-renderizada pelo servidor depois de qualquer Server Action | A action deixou de revalidar a rota do painel (a página pública do evento continua revalidada, que é outra rota) **e** o painel passou a renderizar o estado "já decidida" (situação, data e caminho da programação), escolhido a partir da situação que o servidor manda (ADR-169). **Revalidar a rota cujo render depende do estado que a action acabou de mudar apaga o retorno da própria action**. Armadilha **76** |
| O teste de aceite reprovou duas vezes por **fixture**, não por produto: a atividade estava fora do período do evento, e as propostas usavam menos de 3 palavras-chave e resumo com menos de 150 caracteres | A fixture nasceu antes de o teste exercitar as regras reais de `saveActivity` e `validateSubmissionContent`. O produto estava certo nos dois casos | A fixture passou a respeitar o que o domínio exige (atividade dentro do período, resumo ≥ 150, três palavras-chave), com o porquê escrito no arquivo. **Teste que mede o produto precisa de fixture coerente com as regras do produto** — senão ele mede a própria fixture |
| A suíte completa passou a reprovar **depois da meia-noite**, num arquivo que esta fase não tocou: `tests/integration/participant-center.test.ts` esperava 3 mensagens na janela e encontrava 0 (`expected 0 to be greater than or equal to 3`) — de dia passava | A fixture gravava `sentAt` com o **relógio real** (`new Date()`), enquanto a janela consultada vinha de um `now` fixo. Enquanto o dia do relógio coincidiu com o do `now` fixo, os dois concordaram; virou o dia e a mensagem saiu da janela | O `beforeAll` passou a **re-carimbar** `sentAt` com o mesmo instante fixo da janela. **Fixture que mistura o relógio real com uma janela fixa é armadilha com prazo de validade** — e o prazo vence à meia-noite. Armadilha **77** |
| **A roleta do telão às vezes não rodava** — a parede ia de "aguardando" direto para o ganhador, sem suspense. O E2E da roleta (FASE 29/30), que já existia, **falhou** na bateria desta fase com o telão em `REVELADO` e a assertiva esperando `SORTEANDO`; na execução anterior o mesmo cenário havia passado | Defeito PRÉ-EXISTENTE, encontrado aqui. O aviso ao vivo chega por SSE e o modelo da página só é relido no `router.refresh()` agendado **250 ms** depois. Nessa janela o componente ainda tem em mãos a rodada **ANUNCIADA**, e `rollNames` sai da lista publicada — que só é gravada na APURAÇÃO. Sem nomes, o efeito caía no ramo "sem lista publicada: revela direto", feito para o histórico antigo. Quando o `refresh` vencia a corrida, a roleta acontecia: **o teste media quem ganhava a corrida, não a roleta** | O efeito passou a distinguir **"não há lista publicada"** (rodada apurada sem `poolSnapshot`: revela direto, comportamento antigo preservado) de **"a lista ainda não chegou"** (a rodada em cartaz é o anúncio, `drawnAtIso` nulo: pede a releitura e ESPERA). Verificado por três execuções do arquivo E2E da roleta (`--repeat-each=3`). Armadilha **78** |

---

## 6. Evidência de verificação

### 6.1 Bateria (árvore final)

```text
npm run lint                  → 0 erros, 0 warnings
npm run typecheck             → 0 erros
npm test                      → 71 arquivos · 1690 testes passando (era 69/1638)
npm run build                 → Compiled successfully (rotas /administracao/eventos/[eventId]/chamadas
                                e /eventos/[eventSlug]/chamada/[callSlug] listadas)
npm run db:verify             → Contrato íntegro.
npm run db:verify:isolation   → 9/9 verificações passaram.
npm run db:partitions         → partições do mês atual e dos seguintes criadas
npm run db:seed               → 2 chamadas publicadas · 1 proposta (protocolo 2026-…)
npx prisma migrate status     → 29 migrations · "Database schema is up to date!"
npm run test:e2e              → 111 passed (4 novos desta fase)
npx playwright test tests/e2e/raffle-end-to-end.spec.ts --repeat-each=3
                              → 36 passed (12 cenários × 3, já com a correção da armadilha 78)
```

### 6.2 Testes novos

| Arquivo | Testes | O que prende |
|---|---|---|
| `tests/unit/call-rules.test.ts` | 26 | catálogo de tipos e o mapa para atividade, cegueira padrão por tipo, os quatro estados da chamada (inclusive nas bordas exatas da janela), as quatro recusas de `canSubmitToCall`, validação de campos por tipo (com descarte de campo estranho), carga horária declarada × padrão do tipo, rótulo da janela em `America/Bahia`, contagem regressiva, janela invertida, plano do aceite (agenda ausente, agenda invertida, e-mail ausente) e o título da atividade |
| `tests/unit/review-rules.test.ts` (+4) | 56 | precedência CHAMADA → TRILHA → PADRÃO, incluindo a rubrica de chamada malformada que cai para a da trilha |
| `tests/unit/submission-and-affinity.test.ts` (+4) | 79 | prontidão da proposta não científica: sem trilha passa, sem arquivo passa com aviso, arquivo suplementar conta como anexo, e o trabalho científico continua bloqueando |
| `tests/unit/email-communication.test.ts` (9 → 11) | 39 | os dois templates novos com payload de exemplo — o teste enumera o catálogo de propósito |
| `tests/integration/call-proposals.test.ts` | 16 | CRUD + publicação (rascunho não aparece na lista pública), janela invertida recusada, exclusão recusada com propostas, proposta gravando `callId`/`proposalData` e criando o vínculo de participante, campo obrigatório do tipo recusado **sem gravar nada**, chamada não publicada, chamada encerrada, limite por autor **por chamada**, RLS com duas instituições (`NOT_FOUND`), submissão científica sem chamada intacta, rubrica da chamada vencendo a da trilha no painel do comitê, rubrica inválida recusada com motivo, e o aceite (atividade com a carga declarada + vínculo do palestrante + convite **no outbox** + decisão pelo motor do comitê; aceitar sem nada; recusar convite sem e-mail **sem** registrar a decisão) |
| `tests/e2e/call-for-proposals.spec.ts` | 4 | a organização cria e publica a chamada pela tela (do painel do evento ao endereço público), o bloco da página pública mostra a chamada aberta e leva ao formulário, a pessoa de fora envia a proposta e recebe o protocolo (com o vínculo de participante no banco), e o aceite cria a atividade na grade e envia o convite |

### 6.3 Testes existentes que precisaram mudar (e por quê)

| Arquivo | Mudança | Motivo |
|---|---|---|
| `tests/unit/email-communication.test.ts` | catálogo de 9 para **11** templates, com payload de exemplo para os dois novos | O teste enumera o catálogo: template novo sem exemplo **quebra** ali, em vez de passar despercebido |
| `tests/unit/submission-and-affinity.test.ts` | `evaluateSubmissionReadiness` passou a receber `proposalKind` | O parâmetro novo é o que distingue "faltou trilha" (bloqueio no artigo) de "não tem trilha" (normal na proposta) |
| `tests/unit/review-rules.test.ts` | quatro casos novos de `resolveEffectiveRubric` | A precedência é regra nova e é usada por três caminhos |
| `tests/unit/landing-editor.test.ts` / `landing-page.test.ts` | passaram a iterar um tipo de bloco a mais (`CALL_FOR_PROPOSALS`) | Os testes percorrem `PAGE_BLOCK_TYPES` exigindo rótulo, descrição, conteúdo inicial e validação — o tipo novo é coberto automaticamente |

---

## 7. Comandos operacionais

```bash
# ── O PAINEL DA CHAMADA (organização) ──────────────────────────────────────────────
# /t/<slug>/administracao/eventos/<eventId>            → "Chamadas de propostas →"
# /t/<slug>/administracao/eventos/<eventId>/chamadas
#   → criar chamada (tipo, texto, janela, cegueira, limite, trilha, rubrica própria)
#   → publicar/despublicar · editar · excluir (recusada quando já há propostas)
#   → "Propostas recebidas" por chamada → "Analisar e aceitar" (painel do comitê)

# ── A PÁGINA PÚBLICA ───────────────────────────────────────────────────────────────
# Bloco "Chamadas de propostas" no editor:
#   /t/<slug>/administracao/eventos/<eventId>/pagina     → adicionar/mover o bloco
# O formulário público de uma chamada:
#   /t/<slug>/eventos/<eventSlug>/chamada/<callSlug>
#   (ler é público; enviar exige sessão, com /login?redirectTo=… e /signup?redirectTo=…)

# ── O ACEITE (organização) ─────────────────────────────────────────────────────────
# /t/<slug>/comite/<submissionId>   → "Protocolo de aceite"
#   [x] Criar a atividade na programação   (agenda, sala, vagas, inscrição própria)
#   [x] Convidar o proponente como palestrante (gera o convite e enfileira o e-mail)

# ── O BANCO: chamadas, propostas e convites ────────────────────────────────────────
psql "$DATABASE_URL" -c '
  SELECT c.kind, c.slug, c."isPublished", c."opensAt"::date, c."closesAt"::date,
         count(s.id) AS propostas
    FROM call_for_proposals c
    LEFT JOIN submissions s ON s."callId" = c.id AND s."deletedAt" IS NULL
   WHERE c."tenantId" = ''<tenantId>'' AND c."deletedAt" IS NULL
   GROUP BY c.id ORDER BY c."createdAt" DESC'

# Os convites de palestrante que SAÍRAM (a dívida E25 quitada nesta fase):
psql "$DATABASE_URL" -c '
  SELECT m.to, m.template, m.status, m."dedupeKey", m."createdAt"
    FROM email_messages m
   WHERE m."tenantId" = ''<tenantId>'' AND m.template = ''SPEAKER_INVITATION''
   ORDER BY m."createdAt" DESC LIMIT 20'
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Dívida | Impacto | Caminho |
|---|---|---|---|
| **E46** | **A proposta não aceita anexo.** O formulário público pede texto e campos do tipo, e não tem upload — diferente da submissão de artigo, que anexa o PDF. Quem propõe um minicurso não pode enviar o plano de aula; quem propõe uma palestra não pode enviar o currículo | A organização decide sobre um resumo de 150 caracteres e uma minibiografia, sem o material que costuma acompanhar a proposta — e a decisão do comitê fica mais pobre justamente nas chamadas em que ela é mais subjetiva. O caminho existe e é conhecido (a esteira de upload da FASE 23/24, com quota e checagem de assinatura); falta ligá-lo ao formulário público e à prontidão não científica (que hoje só AVISA sobre a ausência) | Reusar `requestUploadAction`/`confirmUploadAction` no formulário público, com um campo de anexo por tipo e visibilidade decidida como no material do palestrante |
| **E47** | **O proponente não é avisado da decisão.** Aceitar ou rejeitar registra a decisão e a auditoria, e nenhum e-mail sai: quem propôs descobre o resultado entrando na plataforma com o protocolo em mãos | Expectativa quebrada no ponto mais sensível: a pessoa enviou uma proposta e ficou sem resposta. Um e-mail de recusa bem escrito é metade do trabalho de organizar uma chamada — e hoje ele é escrito à mão, fora da plataforma, quando existe | Template `PROPOSAL_DECIDED` disparado por `recordDecision` (com o mesmo cuidado da FASE 15: fora da transação, com `dedupeKey` por proposta e decisão), com o parecer resumido quando houver |

Pontos de atenção que **não** são dívidas novas, mas valem registro:

- **Quórum e limiares continuam na TRILHA.** A chamada define tipo, cegueira, rubrica e limite por
  autor; `requiredReviews` (padrão 2), `acceptanceThreshold` (70) e `rejectThreshold` (45) vêm da
  trilha e, numa chamada **sem** trilha (palestrante, minicurso), valem os padrões do domínio. É
  deliberado: a chamada não redefine o motor, e o aceite de proposta usa `overrideQuorum`.
- **`Event.cfpOpensAt`/`cfpClosesAt` seguem valendo** para a submissão de artigo pelo painel. Duas
  janelas convivem: a do evento (artigo, caminho antigo) e a de cada chamada.
- **O JSON `proposalData` não é pesquisável por SQL direto.** Os campos são de exibição e de
  decisão; filtrar por eles exigiria índice GIN e uma consulta por chave — não há caso de uso hoje.
- **A chamada apagada é lógica** (`deletedAt`) e propostas impedem a exclusão: despublicar é o
  caminho para tirar do ar sem perder histórico.
- **A proposta não tem tela de edição pelo autor** depois do envio: o autor vê a lista em
  "Minhas submissões" e edita pelo caminho da FASE 4 (rascunho), mas o formulário público cria e
  envia em um passo.

---

## 9. Checklist de aceite

- [x] **Chamadas por tipo** (artigo, palestrante, minicurso, oficina, mesa-redonda, pôster e outra
      atividade), cada uma com título, resumo, orientações, janela, cegueira, limite por autor,
      trilha opcional e rubrica própria
- [x] **Publicação explícita**: a chamada nasce em rascunho, não aparece em lugar nenhum antes de
      publicada, e despublicar tira do ar sem perder propostas
- [x] **Campos por tipo**, validados no domínio, com descarte de campo estranho ao tipo
- [x] **Avaliação pelo mesmo motor** (pareceres, cegueira, quórum, nota ponderada, decisão
      auditada), com cegueira e rubrica **por chamada** (precedência CHAMADA → TRILHA → PADRÃO)
- [x] **Fora da ciência, trilha não é obrigatória** e a ausência de arquivo é aviso, não bloqueio
- [x] **Formulário público** por chamada, com leitura pública e envio autenticado, conta criada no
      caminho e vínculo de participante nascendo da proposta
- [x] **Limite de propostas por autor POR CHAMADA**, com recusa nomeada
- [x] **Bloco `CALL_FOR_PROPOSALS` na página pública**, com o organizador escolhendo onde ele fica
      e se as encerradas aparecem; o bloco lê o dado real (prazo e estado calculados no servidor)
- [x] **Proposta visível dentro da chamada**, no painel, com os campos do tipo rotulados e o
      caminho para o painel do comitê
- [x] **Protocolo de aceite**: a decisão é do motor do comitê; **criar a atividade** e **convidar o
      palestrante** são escolhas do organizador, com o que ficou pendente dito na resposta
- [x] **A atividade criada herda o que a proposta declarou** (título, resumo, tipo e carga
      horária) e recebe a agenda da organização — nunca um horário inventado
- [x] **Convite de palestrante enviado por e-mail** com link do portal e expiração (dívida **E25**
      quitada), com o token aparecendo uma vez na tela
- [x] **Auditoria** das escritas da chamada e do aceite (`callForProposals`,
      `proposalAcceptance`), com IP e agente do pedido no aceite
- [x] **RLS + FORCE** na tabela nova, com o contrato de schema verde e isolamento verificado por
      teste de integração com duas instituições
- [x] **Doc, README e `AGENTS.md` atualizados**, com as armadilhas novas (73 a 78)
