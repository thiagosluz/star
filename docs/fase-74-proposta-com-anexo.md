# FASE 74 — A proposta que exige anexo e não pede

> **Estado: ENTREGUE.** Fatias 1–5 verdes, mais o conserto da fila determinado pelo
> humano (tratado aqui como **fatia 6**), o documento, a bateria da §4 e as imagens.
> **ADRs 360, 361 e 362** — a próxima numeração é **ADR-363**.

---

## 1. Sumário Executivo

O relato que abriu a fase é curto e completo: o autor preenche uma proposta numa
chamada de **trabalho científico**, clica em enviar e recebe *"A submissão está
incompleta. A trilha exige revisão cega: anexe a versão sem identificação dos
autores."* — e o formulário público **não tem onde anexar**. O envio já criou um
rascunho, mas nada na tela dizia onde ele estava. A pessoa escreveu 3.000 caracteres
e ficou sem caminho.

A investigação da fase mediu quatro coisas que transformaram um problema de tela em
um problema de **verdade distribuída**:

1. o upload não conferia a **posse do alvo** — um membro do tenant com o UUID de
   outra pessoa podia anexar (e apagar) arquivo na submissão dela;
2. a página `/submissoes/<id>` filtrava só por **instituição** — qualquer membro com
   o UUID lia título, resumo, autores e nota de um trabalho alheio;
3. a recusa era um **beco**: o rascunho existia, ninguém o oferecia, e a tela do
   rascunho ainda escrevia os bloqueios à mão, sem a trilha que o serviço cobrava;
4. o rascunho criado pela recusa era contado e listado como **proposta recebida** —
   e consumia o limite por autor. A pessoa se trancava fora **tentando** entrar.

A fase fecha os quatro e mais dois que apareceram no caminho: a **cegueira da
chamada** não conseguia herdar da trilha (a coluna era `boolean NOT NULL`), e a
**atribuição de revisor** lia a cegueira só da trilha, produzindo parecer não cego
numa chamada cega. O princípio que organiza o desenho:

> **A tela não pode contar uma verdade que o servidor não vai cobrar.** Quando as
> duas precisam da mesma resposta, elas leem a **mesma função** — ou divergem no dia
> seguinte.

A decisão de escopo revista pelo humano está registrada na §3.9: o anexo **não** foi
para a página pública (decisão A), a **E46 não foi quitada** — foi re-escopada — e o
caminho do autor (aviso → rascunho → anexo → envio) é o que fecha o beco.

### O que foi entregue

| Fatia | Entrega | Situação |
|---|---|---|
| 1 | **A posse do upload**: `requestUpload` e `confirmUpload` conferem `submittedById` (fail-closed, código `NOT_OWNER`) e a conferência de `confirmUpload` roda **antes** do `inspectObject` — o caminho de integridade apaga o objeto; 5 testes de integração, com a submissão do dono intacta | ✅ |
| 2 | **A falha acionável**: a recusa `NOT_READY` devolve o `submissionId`, a tela oferece "Continuar na área do autor" como link real, o `redirectTo` do sucesso aponta para `/submissoes/<id>` (e não para a rota inexistente `/minhas-submissoes`), a página da chamada anuncia o que o envio exige e a do rascunho usa a **mesma** `evaluateSubmissionReadiness`; a página da submissão passa a conferir a **posse** | ✅ |
| 3 | **O rascunho honesto**: uma régua de domínio única (`proposal-receipt-rules`) para lista, contagem, selo e limite por autor; rascunho com arquivo é "trabalho em andamento", contado à parte; `findReusableDraft` impede um rascunho por tentativa; o `authorSubmissions: 0` da retomada foi corrigido | ✅ |
| 4 | **O aviso e o teto**: a página da chamada diz, **antes do formulário**, que a proposta científica se completa na área do autor (decisão A); cada autor pode manter **5 rascunhos com arquivo** por chamada, porque a quota da F21 é compartilhada; a E46 foi **re-escopada**, não quitada | ✅ |
| 5 | **A herança da trilha**: `CallForProposals.requiresBlindReview` virou nulável, `resolveRequiresBlindReview` devolve valor **e** `source` (CHAMADA → TRILHA → PADRÃO do tipo), o painel oferece "Herdar da trilha" × "Padrão do tipo", o anúncio público lê a cegueira **efetiva** e o `isBlind` da atribuição usa a mesma função; migração **sem backfill** | ✅ |
| 6 | **A fila honesta** (conserto determinado pelo humano): a lista de propostas volta a mostrar **tudo o que foi enviado**, com o **status na linha** (rótulo do domínio); o selo e o limite contam a mesmíssima coisa (`DRAFT` continua fora); a régua foi renomeada (`NOT_SENT_SUBMISSION_STATUSES`) para o nome não mentir; teste com recusada + retirada + enviada | ✅ |
| 7 | **Documento, catracas e bateria**: este documento, ADRs 360–362, README/AGENTS/dívidas sob o teto, bateria da §4, E2E inteira, as duas imagens e a limpeza | ✅ |

### Números da fase (medidos nesta árvore)

| Medida | Número |
|---|---|
| Migrações | **1** (`20261022150000_f74_chamada_herda_da_trilha`) — um `ALTER COLUMN ... DROP NOT NULL`, **sem backfill** |
| Arquivos de código **novos** | **3** (2 de domínio: `proposal-receipt-rules.ts` e `proposal-draft-rules.ts`; 1 de aplicação: `submission-access.ts`) |
| Arquivos de código **tocados** | **16** (os 3 novos + 13 alterados; 5 deles compartilham a árvore com a F73: schema, `call-actions`, as duas páginas de chamada e `call-service`) |
| Arquivos de teste **novos** | **10** (4 unitários + 6 de integração) |
| Testes Vitest da fase | **94** (53 unitários + 41 de integração) |
| Specs E2E novos | **1** (`f74-proposta-ciencia.spec.ts`) com **2 casos** |
| Specs E2E reapontados | **1** (`peer-review.spec.ts` — a asserção prendia a frase escrita à mão que a fatia 2 substituiu) |
| Suíte Vitest inteira | **4033 testes / 219 arquivos** |
| Suíte E2E inteira | **402 ativos + 1 skip (403 no total)**; medido: **400 passando + 2 vermelhos PRÉ-EXISTENTES** (o snapshot do rodapé da raiz, claro e escuro) |
| Portão WCAG AA | **32 casos**, sem isenção nova (a F74 não abriu tela nova; a F73 deixou 30 → 32) |
| `globals.css` / `playwright.config.ts` | **não tocados** (regra da fase) |
| `AGENTS.md` | **64.794 bytes** (teto ~64.800; o harness corta em 65.244) — a §10 termina em `Aguardando APROVADO: AVANÇAR` |

### 1.1 Arquivos da fase

**Domínio (puro — sem Prisma, sem Next, sem relógio):**

- `src/domain/proposals/proposal-receipt-rules.ts` — a régua de "proposta recebida":
  `DRAFT` é o único estado não enviado, `proposalReceipt` distingue recebida ×
  trabalho em andamento × não recebida, e as frases do selo saem daqui (fatias 3 e 6);
- `src/domain/proposals/proposal-draft-rules.ts` — o teto de
  `MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL = 5`, com a frase que diz o número e o
  caminho (fatia 4);
- `src/domain/review/submission-rules.ts` — `submissionArtifactRequirements` (a
  exigência e a recusa na mesma função), `proposalAttachmentStepNotice` e a
  `evaluateSubmissionReadiness` lendo a lista (fatia 2);
- `src/domain/proposals/call-rules.ts` — `resolveRequiresBlindReview` com
  `BlindReviewSource` (fatia 5).

**Aplicação:**

- `src/lib/review/submission-access.ts` — a posse da página da submissão, com o tipo
  da chamada na mesma leitura (fatia 2);
- `src/lib/review/submission-service.ts` — `NOT_OWNER`, posse nas duas etapas do
  upload, teto de rascunhos, limite pela régua nova e a cegueira efetiva (fatias 1,
  3, 4, 5);
- `src/lib/review/review-service.ts` — o `isBlind` da atribuição pela precedência
  (fatia 5);
- `src/lib/proposals/proposal-service.ts` — `findReusableDraft`, a recusa que devolve
  o rascunho, a retomada com limite (fatias 2, 3);
- `src/lib/proposals/call-service.ts` — `effectiveRequiresBlindReview`, contagens e
  `proposalsInProgress`, a lista com o status na linha, a guarda de exclusão (fatias
  3, 5, 6);
- `src/app/actions/call-actions.ts` — `submissionId` na recusa, `redirectTo` real e o
  terceiro estado de cegueira (`inherit`) (fatias 2, 5);
- `src/app/actions/review-actions.ts` — o caminho da recusa de posse (fatia 1/2).

**Interface:**

- `src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/chamada/[callSlug]/page.tsx` —
  o aviso do anexo e as exigências do domínio (fatias 2, 4, 5);
- `src/app/t/[tenantSlug]/(app)/submissoes/[submissionId]/page.tsx` — os bloqueios
  da régua e a posse (fatia 2);
- `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/page.tsx` —
  o status na linha e os três estados de cegueira (fatias 5, 6);
- `src/components/proposals/proposal-form.tsx` — o link para o rascunho (fatia 2);
- `prisma/schema.prisma` + a migração (fatia 5).

---

## 2. O Problema Mais Difícil da Fase

O problema mais difícil não foi "falta um upload". Foi **a mesma verdade contada por
três leitores diferentes** — e a fase só fica verde quando os três concordam.

A exigência de anexo nasce no **domínio** (`evaluateSubmissionReadiness`), é aplicada
pelo **serviço** (`submitSubmission`) e precisa ser **anunciada** pela **tela** (a
página da chamada e a página do rascunho). Antes da fase, cada um dizia uma coisa:

- o serviço cobrava a **trilha** e o **PDF anonimizado**;
- a página do rascunho escrevia à mão três condições (autores, PDF cego, PDF
  identificado) e **não** tinha a trilha — numa chamada científica sem trilha, ela
  dizia "Tudo pronto para o envio" e o servidor recusava;
- a página da chamada listava só os campos do formulário e **não** mencionava o
  arquivo que a recusa ia cobrar;
- a atribuição de revisor lia a cegueira **só da trilha**, então uma chamada cega
  sobre trilha aberta virava parecer **não cego**;
- a lista do painel e a contagem do selo liam réguas diferentes para "proposta
  recebida".

O desenho da fase é, por isso, uma **operação de fonte única** em cinco pontos:
`submissionArtifactRequirements` (exigência + frase), `evaluateSubmissionReadiness`
(bloqueios da tela e do serviço), `resolveRequiresBlindReview` (envio, anúncio,
atribuição e painel), `proposal-receipt-rules` (lista, contagem, selo e limite) e
`loadSubmissionPageAccess` (posse + tipo). Cada ponto tem uma catraca que reprova se
a segunda cópia voltar.

E há a dimensão de **segurança**, que define a ordem: a posse precisava vir antes de
qualquer superfície nova de upload. Se a fase tivesse entregado o aviso e o link
primeiro, o IDOR ganharia alcance — mais gente clicando em "continuar" com UUID de
outra pessoa. A ordem do plano (fatia 1 antes da 2) não foi estética.

O segundo problema é de **produto**: uma recusa sem saída é o defeito; uma recusa que
devolve o rascunho e o caminho é a correção. Mas o rascunho que a recusa cria não
pode, ele mesmo, virar uma proposta recebida — senão o caminho de volta vira uma
cota consumida. A fase separou três fatos que estavam no mesmo número: **recebida**
(saiu da mão do autor), **em andamento** (rascunho com arquivo) e **não recebida**
(rascunho vazio, resto de tentativa reciclado).

---

## 3. Decisões Técnicas Explicadas

### 3.1 A posse vem antes de olhar o objeto — e antes de assinar

`requestUpload` devolvia a URL pré-assinada depois de achar a submissão **por
instituição**. A permissão `submission:update:own` é conferida pela action com o
`ownerId` da **sessão**, não com o dono do recurso: ela autoriza a **pessoa**, não o
**alvo**. Quem tinha o UUID anexava na submissão de outra pessoa.

A correção tem duas metades, e a **ordem** é a segunda:

1. `requestUpload` compara `submittedById` com o usuário da sessão **antes** de
   reservar a chave e assinar a URL. Conceder a pré-assinada já é abrir o furo,
   mesmo que a confirmação fosse recusar depois — o objeto passaria a existir.
2. `confirmUpload` compara a posse **antes** de `inspectObject`. O motivo é concreto:
   quando a integridade falha (tamanho ou checksum divergentes), o caminho chama
   `deleteObject` e **apaga o objeto do bucket**. Se a posse fosse conferida depois,
   um terceiro com a chave de um objeto alheio passaria um checksum errado e apagaria
   o arquivo do dono — a submissão ficaria intacta no banco e quebrada no storage.
   A leitura de posse vem primeiro porque é ela que garante que **nada** é tocado.

A posse é reconferida **dentro da transação que grava** (defesa em profundidade: a
primeira leitura protege o storage; a segunda protege a escrita). O código é
`NOT_OWNER`, e não `FORBIDDEN`: a recusa é sobre o **recurso**, não sobre o papel —
`FORBIDDEN` faria a pessoa procurar um problema de permissão que ela não tem.
"Submissão inexistente" e "de outro tenant" continuam `NOT_FOUND` (a RLS esconde a
linha antes da comparação); só "existe, é deste tenant e não é sua" chega ao
`NOT_OWNER`.

**Prova vermelha registrada na investigação:** sem a correção, a pré-assinada era
**concedida** ao intruso. O teste que prende a correção é
`tests/integration/f74-posse-do-upload.test.ts` (5 testes): o dono anexa; outra
pessoa recebe `NOT_OWNER` **nas duas etapas** e a submissão do dono fica intacta; sem
sessão continua `NOT_AUTHENTICATED`; inexistente e outro tenant respondem a mesma
coisa.

### 3.2 O segundo vazamento, um nível acima

`/t/<slug>/submissoes/<submissionId>` chamava `getSubmission(tenantId, id)` e
renderizava o detalhe. O filtro era por **instituição** — e a submissão É da
instituição, então a RLS não tinha o que esconder. Qualquer membro do tenant com o
UUID (que circula em e-mail, conversa e link copiado) lia título, resumo inteiro,
autores com **e-mail**, nomes de arquivo, nota e decisão.

A correção não foi um `if` no JSX: a posse virou uma **regra de aplicação**,
`loadSubmissionPageAccess`, que devolve `ok: false` para "não existe", "de outra
instituição" e "de outra pessoa" — as três com a mesma resposta, para a página não
virar oráculo de existência. A página chama a regra **antes** de `getSubmission`:
recusar depois de ler os metadados seria confiar que nada no caminho até o
`notFound()` vaza (a lista de bloqueios, a rubrica e a autoria já viriam carregadas).
O tipo da chamada vem na mesma leitura, porque é ele que decide quais bloqueios a
tela mostra.

Não há leitor legítimo que não seja o autor nesta tela: o comitê trabalha em
`/comite/<submissionId>`, com permissão e serviço próprios. `f74-pagina-da-submissao`
tem 4 testes; em `f74-proposta-ciencia` o autor passa e o outro membro do **mesmo**
tenant recebe `{ ok: false }` (sem nem o tipo).

### 3.3 A recusa entrega o rascunho, e o sucesso entrega a rota real

O envio pela chamada pública grava o rascunho **antes** de validar a prontidão — é o
que permite continuar o que já foi escrito. O que faltava era dizer isso. Agora:

- a recusa `NOT_READY` devolve `submissionId`; as outras recusas **não** devolvem id
  (não há rascunho para continuar, e um id que não serve seria outra mentira);
- o formulário mostra "Continuar na área do autor" como **link** para
  `/t/<slug>/submissoes/<id>` — o teste lê o `href` **antes** do clique, porque é
  esse endereço que a pessoa copiaria;
- o `redirectTo` do sucesso apontava para `/minhas-submissoes`, rota que **nunca
  existiu**; passou a apontar para a página da submissão que acabou de ser criada.

O teste E2E (`f74-proposta-ciencia`, 2 casos) prova o percurso inteiro: a recusa
aparece com o link, o clique chega ao rascunho, e a segunda tentativa **não** cria
outro (o `findReusableDraft` retoma o vazio). A integração prende o `submissionId`
só na recusa de prontidão e o reaproveitamento.

### 3.4 Uma função para a exigência e para a recusa

`submissionArtifactRequirements({ requiresBlindReview, proposalKind })` devolve a
lista que a página da chamada **anuncia** e de onde `evaluateSubmissionReadiness`
tira os bloqueios e os avisos. Cada item carrega `label` (a frase da tela), `required`
e a `refusal`/`notice` correspondente. A página não escreve "anexe a versão cega" à
mão; ela mapeia a lista.

Três regras da lista:

- **cegueira manda**: uma chamada cega exige o `BLIND_PDF` mesmo quando o tipo não é
  científico (um minicurso numa chamada cega também precisa da versão anonimizada);
- **o identificado é recomendação**, não bloqueio: o revisor cego julga a
  anonimizada, mas é a identificada que vai para a publicação;
- **fora da ciência e sem cegueira, não há exigência de arquivo**: a lista vazia é a
  afirmação de que um minicurso se descreve, não se anexa (ADR-162).

A igualdade que a fase precisava provar está em
`tests/integration/f74-proposta-ciencia.test.ts`:
`expect(daTela.blockers).toEqual(doServico.details)` — a mesma função, os mesmos
textos, na mesma ordem.

### 3.5 "Recebida" é o que foi ENVIADO — a fila e o selo pela mesma régua

A régua vive em `proposal-receipt-rules`. A definição, depois do conserto da fatia 6:

```
Recebida  = a proposta saiu da mão do autor = status != DRAFT
Em andamento = DRAFT com arquivo (trabalho que existe e não se recicla)
Não recebida = DRAFT vazio (resto de tentativa, reciclado por findReusableDraft)
```

Consequências, todas presas por teste:

- a **lista** do painel mostra `SUBMITTED`, `UNDER_REVIEW`, `REVISION_REQUESTED`,
  `ACCEPTED`, **`REJECTED`, `WITHDRAWN` e `CANCELED`** — todas foram enviadas —, com
  o **status na linha** (rótulo de `SUBMISSION_STATUS_LABELS`, nunca o enum cru);
- o **selo** conta a mesma coisa (`call.proposals`): a catraca
  `listCallProposals().length === call.proposals` continua valendo;
- o **limite por autor** conta a mesma coisa: a cota é do **envio**, não do desfecho
  — retirar ou ser recusado não devolve a vaga;
- o rascunho **com arquivo** ganha contagem própria (`proposalsInProgress`) e frase
  própria; o vazio não aparece em lugar nenhum;
- a **retomada** do rascunho vazio também confere o limite (ver §3.6).

A fatia 3 tinha feito o alinhamento pelo lado de MENOS: para a lista bater com a
contagem antiga, escondeu retirada, cancelada e recusada. O humano determinou o
conserto: uma proposta recusada **foi recebida**, e sumir com ela da fila tira
informação do organizador. A correção mudou a **definição** (recebida = enviada), não
o filtro; a constante foi renomeada de `NOT_RECEIVED_SUBMISSION_STATUSES` para
`NOT_SENT_SUBMISSION_STATUSES`, e o que mudou em cada leitor está na tabela da §5
(lição 4). **`DRAFT` continua fora**, pela decisão do humano.

### 3.6 O rascunho vazio é reciclado; o com arquivo tem teto

`findReusableDraft` procura, nesta chamada e para esta pessoa, um `DRAFT` **sem
arquivo nenhum** e o retoma: o conteúdo é o que a pessoa acabou de mandar, e repetir
a tentativa não cria outro. Um rascunho **com** arquivo **não** é reusado — o PDF é
de um trabalho específico, e anexá-lo a outro texto faria a prontidão passar com o
arquivo errado. Ele sobrevive; é trabalho em andamento.

Como ele sobrevive, cada nova tentativa de quem já tem arquivo cria um **novo**
rascunho. Sem teto, uma pessoa poderia consumir sozinha a quota de armazenamento da
instituição (F21, compartilhada) com rascunhos abandonados — e a instituição inteira
ficaria sem anexar. O teto de **5 rascunhos com arquivo por autor por chamada**
(`proposal-draft-rules`) não substitui a quota; impede que UM autor a consuma. A
contagem roda no `createSubmission`, na mesma transação, **depois** do limite de
propostas: quando a pessoa já usou as propostas que a chamada permite, essa é a
verdade principal. A recusa (`DRAFT_FILE_LIMIT_REACHED`) diz o número e o caminho
(enviar ou excluir um rascunho), com link para a lista.

A corrida de duas abas pode criar um a mais. É deliberado e declarado: o teto é
proteção de armazenamento, não direito do autor; o custo de um excesso de uma
unidade é menor do que travar quem está tentando enviar. **Não há teste paralelo
disso** (ver §5.3).

### 3.7 `null` = herdar; o último degrau é o padrão do TIPO

A precedência do ADR-160 (CHAMADA → TRILHA → PADRÃO) existia no documento, mas o
código escrevia:

```ts
call?.requiresBlindReview ?? track?.requiresBlindReview ?? true
```

Como a coluna da chamada era `boolean NOT NULL`, o `??` **nunca** chegava na trilha:
a chamada sempre vencia, mesmo calada. A chamada de minicursos do seed (trilha cega,
chamada aberta) era avaliada como aberta, em silêncio — o caso ambíguo vivo.

A fase tirou o `NOT NULL` (`20261022150000_f74_chamada_herda_da_trilha`) e escreveu a
precedência em uma função, `resolveRequiresBlindReview`, que devolve
`{ requiresBlindReview, source }`:

| Chamada | Trilha | Tipo | Vale | Fonte |
|---|---|---|---|---|
| `true` | qualquer | qualquer | cega | CALL |
| `false` | qualquer | qualquer | aberta | CALL |
| `null` | `true` | qualquer | cega | TRACK |
| `null` | `false` | qualquer | aberta | TRACK |
| `null` | ausente | PAPER/POSTER | cega | TYPE |
| `null` | ausente | os demais | aberta | TYPE |
| ausente | ausente | ausente (legado) | cega | TYPE (`?? true` da F4) |

O último degrau é o **padrão do tipo**, e não `false`. Se fosse `false`, toda chamada
de artigo sem trilha abriria a autoria em silêncio — o **mesmo defeito virado do
avesso**: em vez de a chamada calada vencer a trilha, ela venceria o tipo. O legado
sem chamada e sem trilha cai no mesmo degrau com `kind` nulo, e aí vale `true` — o
`?? true` da FASE 4, preservado para que um trabalho antigo não mude de regime.

No **seed**, a chamada de minicursos continua **`false`** (decisão dela, gravada pelo
`saveCall`): a migração **não faz backfill**. As linhas existentes mantêm o valor que
tinham; herdar é uma **escolha do organizador** na tela, não um efeito colateral de
subir a fase. A chamada de artigos do seed continua `true`.

### 3.8 O terceiro leitor: o `isBlind` da atribuição

O envio, o anúncio e o painel liam a precedência; a **atribuição de revisor** não.
`assignReviewer` gravava `isBlind: submission.track?.requiresBlindReview ?? true`.
Numa chamada cega sobre trilha aberta, a atribuição nascia **não cega** — o revisor
via a autoria, e o `BLIND_PDF` que o envio cobrou deixava de proteger alguma coisa.
A correção usa a **mesma** `resolveRequiresBlindReview`, com o `kind` da chamada
incluído (é o último degrau). `f74-chamada-herda-da-trilha` prova os dois sentidos:
chamada calada + trilha cega → parecer **cego**; chamada dizendo aberta sobre a mesma
trilha → parecer **aberto**.

### 3.9 A decisão A: o caminho, não a segunda esteira

A decisão do humano foi **A**: o anexo **não** vai para a página pública. A página
avisa, o rascunho fica salvo e o autor continua na área onde o upload e o envio já
existem inteiros. O custo de **B** (anexo inline na chamada), medido no código:

- **três ações novas** na página pública para repetir o que a área do autor já faz
  (`requestUpload`, `confirmUpload` e o envio, com autorização e validação próprias);
- **conclusão duplicada**: a proposta continuaria precisando de um segundo passo para
  ser enviada, e a tela pública passaria a ter dois estados de "pronto" (dados ×
  arquivo) que a área do autor já resolve num lugar só;
- **JavaScript obrigatório**: o formulário público é HTML puro e funciona sem JS;
  upload de arquivo com progresso exige JS. A página que hoje funciona sem
  JavaScript passaria a ter um passo que não funciona — e o envio continuaria fora
  dela.

O que a fase entregou no lugar: o **aviso** antes do formulário (domínio,
`proposalAttachmentStepNotice`), a **recusa com id e link**, a **lista de exigências**
e o **rascunho retomável**. O beco está fechado.

**A E46 não foi quitada — foi re-escopada.** O que continua fora é o **anexo inline
na página pública da chamada** (com a visibilidade e o portão de inspeção da F36). O
que a fase fechou é o caminho: hoje a pessoa anexa e envia, e o teste E2E prova o
percurso. O registro da dívida em `docs/dividas-tecnicas.md` diz exatamente isso, com
o custo de B. "Quitada" seria mentira; "re-escopada" é o fato.

### 3.10 O limite de leitura das listas — anterior à fase, só declarado

Não é decisão desta fase: `CALL_LIST_LIMIT` continua 50 por evento, e a lista de
propostas continua limitada a 300 (`limit` padrão 100). O teste da catraca usa
chamadas pequenas; acima do limite, `listCallProposals().length` pode ser menor que
`call.proposals`. Isso **já era** o comportamento antes da fase e não foi alterado.
Fica declarado como ponto de atenção na §8, não como defeito novo.

---

## 4. Registro de Decisões de Arquitetura (ADRs)

### ADR-360 — A posse do alvo vem antes do storage: o IDOR do upload e a ordem que impede apagar o arquivo do dono

**Contexto.** `requestUpload` e `confirmUpload` liam a submissão por instituição e
conferiam a permissão `submission:update:own` com o usuário da **sessão**. A
permissão autoriza a pessoa, não o alvo: qualquer membro do tenant que soubesse o
UUID podia anexar na submissão de outra pessoa. A investigação provou que a
pré-assinada era **concedida** ao intruso. No mesmo nível, a página
`/submissoes/<id>` filtrava só por tenant e expunha os metadados a qualquer membro
com o UUID.

**Decisão.** A posse é conferida no **serviço**, com `submittedById === userId`:
`requestUpload` recusa **antes** de reservar a chave e assinar a URL;
`confirmUpload` recusa **antes** de `inspectObject` e reconfere dentro da transação
que grava. O código é `NOT_OWNER`; "inexistente" e "de outro tenant" continuam
`NOT_FOUND`. A página da submissão usa uma regra própria
(`loadSubmissionPageAccess`) que confere a posse **antes** de carregar o detalhe e
devolve `ok: false` para "não existe", "de outra instituição" e "de outra pessoa" —
as três com a mesma resposta, 404.

**Justificativa.** Conceder a pré-assinada já é abrir o furo, mesmo que a confirmação
fosse recusar depois: o objeto passaria a existir. E a ordem no `confirmUpload` não é
estética: o caminho de falha de integridade **apaga o objeto** (`deleteObject`); se a
posse fosse conferida depois, um terceiro com checksum errado apagaria o arquivo do
dono. A leitura de posse primeiro garante que nada — banco ou bucket — é tocado.

**Consequências.** O dono não percebe mudança; o intruso recebe uma recusa que fala
do **recurso**, não do papel. A comparação vive no serviço, então a próxima
superfície que reusar o upload nasce protegida. A página deixa de ser oráculo de
existência. Custo: uma leitura extra de `submittedById` nas duas etapas do upload e
uma na página. `f74-posse-do-upload` (5 testes) e `f74-pagina-da-submissao` (4)
prendem.

### ADR-361 — A proposta científica se completa na área do autor: o beco vira caminho e o rascunho deixa de mentir

**Contexto.** O formulário público nunca teve upload (E46, desde a F33). A recusa de
prontidão cobrava o `BLIND_PDF` sem dizer onde anexar, e o rascunho que a própria
recusa criava era listado e contado como proposta recebida — e consumia o limite por
autor. A tela do rascunho, por sua vez, escrevia os bloqueios à mão e esquecia a
trilha. A decisão revista pelo humano foi **A**: não duplicar a esteira de upload na
página pública.

**Decisão.** (1) A página da chamada **avisa**, antes do formulário, que a proposta
com exigência de arquivo se completa na área do autor; a frase vem de
`proposalAttachmentStepNotice`, a mesma função que decide a exigência. (2) A recusa
`NOT_READY` devolve o `submissionId` e a tela oferece um link real; o sucesso
redireciona para `/submissoes/<id>`. (3) A tela do rascunho e o serviço leem a
**mesma** `evaluateSubmissionReadiness`; a lista de exigências da chamada e a recusa
saem da mesma `submissionArtifactRequirements`. (4) **Recebida = enviada**: a régua
única (`proposal-receipt-rules`) decide lista, contagem, selo e limite; `DRAFT` fica
fora, o rascunho com arquivo é contado à parte, e a lista mostra o status na linha.
(5) O rascunho vazio é **reutilizado** (`findReusableDraft`) e o com arquivo tem
**teto de 5** por autor por chamada (`proposal-draft-rules`), porque a quota da F21 é
compartilhada.

**Alternativas descartadas.** **B** (anexo inline na página pública): custaria três
ações novas, uma conclusão duplicada e um passo que só funciona com JavaScript numa
página que hoje funciona sem ele — e o **envio** continuaria fora dela. Publicar o
rascunho como "proposta recebida" para dar visibilidade ao trabalho em andamento:
seria voltar ao defeito original e afirmar que entrou no páreo o que ninguém enviou.

**Consequências.** A E46 **não foi quitada**: o anexo inline segue fora, e o documento
de dívidas diz isso com o custo de B. O beco está fechado pelo caminho do autor. O
rascunho deixou de trancar a pessoa fora tentando enviar; a retomada confere o limite
(o `authorSubmissions: 0` era um furo de cota introduzido pela fatia 2). O teto de
rascunhos protege a quota compartilhada, com a corrida de duas abas declarada. A
catraca `lista.length === selo` e o teste com recusada + retirada + enviada prendem a
fila honesta.

### ADR-362 — A chamada que cala: `null` herda da trilha, o último degrau é o padrão do tipo, e o terceiro leitor

**Contexto.** O ADR-160 declara CHAMADA → TRILHA → PADRÃO para a cegueira. A coluna
da chamada era `boolean NOT NULL`, então a chamada sempre vencia: a trilha cega nunca
era lida, e a chamada de minicursos do seed (trilha cega, chamada aberta) era
avaliada como aberta em silêncio. Além disso, `assignReviewer` lia a cegueira **só da
trilha**, produzindo parecer não cego de uma chamada cega.

**Decisão.** `CallForProposals.requiresBlindReview` passa a aceitar `NULL` — a
chamada não se pronuncia, e a trilha decide. `resolveRequiresBlindReview` é a única
implementação da precedência e devolve valor **e** `source` (`CALL`/`TRACK`/`TYPE`);
o envio, a página da submissão, o anúncio público, o painel e a atribuição leem essa
função. O último degrau é `defaultBlindFor(kind)` (e `true` quando não há tipo, para
o legado da F4). A migração **não faz backfill**: as linhas existentes mantêm o valor
que tinham, e herdar é uma escolha do organizador ("Herdar da trilha" × "Padrão do
tipo" na tela). A ação traduz `inherit` para `null` e a ausência de escolha para
`defaultBlindFor(kind)`; o painel mostra os três estados.

**Justificativa.** Sem o terceiro estado, "não me pronuncio" e "decidi aberta" são a
mesma coisa — e a trilha nunca volta a valer. Se o último degrau fosse `false`, toda
chamada de artigo sem trilha abriria a autoria em silêncio: o mesmo defeito virado
do avesso. O `source` permite à tela dizer de quem é a decisão sem inventar.

**Consequências.** O seed mantém a chamada de minicursos **`false`** (sem backfill) e
a de artigos `true`. O `isBlind` da atribuição passou a refletir a chamada cega sobre
trilha aberta. A tela do organizador tem três opções, e a página pública anuncia a
cegueira **efetiva** (não a declaração crua). Migração sem `UPDATE`; contrato de RLS
intacto (coluna de tabela que já tem RLS + FORCE). `f74-chamada-herda-da-trilha`
(14 unitários + 9 de integração) prende a matriz e os três leitores.

---

## 5. Lições Aprendidas

### 5.1 As nove lições, com a evidência de cada uma

| # | Sintoma | Causa raiz | Correção | Evidência |
|---|---|---|---|---|
| 1 | **IDOR do upload**: quem tinha o UUID anexava na submissão de outra pessoa, e podia apagar o objeto do dono passando checksum errado | A permissão `:own` era conferida com o usuário da **sessão**, não com o dono do **alvo**; e a posse, quando viesse, viria depois do caminho que apaga | Posse no serviço, fail-closed (`NOT_OWNER`), **antes** de assinar a URL e **antes** do `inspectObject`; reconferida na transação que grava | `f74-posse-do-upload` (5): as duas etapas recusam e a submissão do dono fica intacta. Prova vermelha da investigação: sem a correção, a pré-assinada era concedida |
| 2 | **Segundo vazamento, um nível acima**: título, resumo, autores com e-mail e nota de qualquer submissão do tenant para quem tivesse o UUID | A página filtrava por **instituição**; a RLS não protege o que é da própria instituição | `loadSubmissionPageAccess` como regra de aplicação, chamada **antes** do detalhe; 404 igual para "não existe", "outro tenant" e "outra pessoa" | `f74-pagina-da-submissao` (4) + `f74-proposta-ciencia`: o outro membro do mesmo tenant recebe `{ ok: false }` e nenhum metadado |
| 3 | **A falha acionável**: "anexe a versão cega" sem lugar para anexar; a tela do rascunho dizia "Tudo pronto" e o servidor recusava | O erro não devolvia o rascunho; a tela escrevia os bloqueios à mão (sem a trilha) e a página da chamada não anunciava a exigência | `submissionId` na recusa, link real, `redirectTo` correto; tela e serviço leem a **mesma** `evaluateSubmissionReadiness`; a chamada anuncia as exigências do domínio | `f74-proposta-ciencia` (8) com `expect(daTela.blockers).toEqual(doServico.details)`; E2E `f74-proposta-ciencia` 2/2; `f74-tela-da-proposta` (13) |
| 4 | **O rascunho honesto**: o rascunho da tentativa falha aparecia como "proposta recebida" e consumia a cota; e o conserto da fatia 3 escondeu a recusada e a retirada da fila | Duas réguas (lista × contagem) e uma definição de "recebida" que olhava o **desfecho**, não o **envio** | Uma régua (`proposal-receipt-rules`): recebida = enviada; lista/contagem/selo/limite leem a mesma fonte; status na linha; `DRAFT` fora; o nome da lista virou `NOT_SENT_…` | `f74-rascunho-honesto` (11 unitários + 9 de integração), incluindo recusada + retirada + enviada com o selo em 3 e a catraca `lista.length === selo` |
| 5 | **O `authorSubmissions: 0` da retomada**: com o limite cheio e um rascunho vazio esquecido, a retomada virava uma proposta **além** da cota | A fatia 2 declarou que "retomar não consome cota nova" sem contar a cota já consumida — o conserto de ontem virou o defeito de hoje | A retomada conta as recebidas do autor **pela mesma régua** e aplica `canSubmitToCall` | `f74-rascunho-honesto` (b): "a RETOMADA do rascunho não fura o limite"; segundo envio real recusado com `AUTHOR_LIMIT_REACHED` |
| 6 | **A matriz tipo × cegueira × caminho nunca foi cruzada**: a chamada cega de tipo não científico e a chamada calada sobre trilha cega não tinham teste | O E2E escolheu **PAPER** (científico e cego), que exercita o caminho do PDF; **MINICOURSE** (não científico) teria passado sem tocar a herança, e a atribuição não é alcançável pelo formulário público | Teste de matriz no domínio (chamada × trilha × tipo) e de integração no envio, no anúncio e na atribuição | `f74-chamada-herda-da-trilha` (14 + 9): "a matriz inteira", os dois sentidos e os três leitores. **A hipótese do E2E com MINICOURSE não foi executada** (§5.3) |
| 7 | **A herança e o terceiro leitor**: a trilha cega era ignorada quando a chamada tinha coluna; e a atribuição de uma chamada cega sobre trilha aberta saía **não cega** | `boolean NOT NULL` não expressa "não me pronuncio"; `assignReviewer` lia só a trilha | Coluna nulável, `resolveRequiresBlindReview` com `source`, tela com três estados, anúncio pela cegueira efetiva, `isBlind` pela mesma função; migração sem backfill | `f74-chamada-herda-da-trilha`: parecer **cego** quando herda de trilha cega; **aberto** quando a chamada diz aberta; seed com minicursos `false` |
| 8 | **A decisão A**: o anexo inline custaria uma segunda esteira de storage e um passo JS-only, sem resolver o envio | Duplicar a esteira na página pública não fecha o ciclo (o envio mora na área do autor) e quebra a promessa de funcionar sem JavaScript | Aviso antes do formulário, rascunho retomável, recusa com link, exigências do domínio; **E46 re-escopada**, não quitada | `f74-anexo-na-proposta` (15 unitários + 6 de integração): o caminho A de ponta a ponta; as catracas provam que a página não abriu upload |
| 9 | **O teto de 5**: rascunhos com arquivo sobrevivem e podem consumir a quota compartilhada da F21 | Rascunho com arquivo não é reciclado (o PDF é de um trabalho específico), então cada tentativa cria um; a quota é da instituição | Teto de 5 rascunhos com arquivo por autor por chamada, contado no serviço, com frase que diz o número e o caminho | `f74-anexo-na-proposta`: no teto a tentativa é recusada e nada é criado; o rascunho vazio não esbarra no teto; `f74-rascunho-honesto`: a cota de propostas continua barrando o segundo envio real |

### 5.2 Defeitos REAIS encontrados por testes

- **A recusa sem saída** (o relato): o teste E2E é a prova de que a pessoa consegue
  chegar ao rascunho pelo link; antes, o `href` não existia.
- **A tela do rascunho mentia**: o teste que compara `daTela.blockers` com
  `doServico.details` reprovava antes da fatia 2 (a tela não tinha "Selecione a
  trilha").
- **O `authorSubmissions: 0`**: o teste da retomada com limite cheio reprovava antes
  da fatia 3.
- **A cegueira da atribuição**: o teste de integração "a chamada que herda de trilha
  cega produz parecer CEGO" reprovava antes da fatia 5.
- **A fila escondia a recusada**: o teste novo da fatia 6 reprovava contra o estado
  da fatia 3 (a lista devolvia 1, não 3).
- **A asserção do E2E que prendia a frase antiga**: na bateria, `peer-review.spec.ts`
  reprovou porque a tela passou a mostrar a recusa do domínio ("revisão cega") em vez
  do texto escrito à mão ("versão cega"). Foi diagnosticado como **teste desatualizado**
  (o comportamento é o correto), não como regressão de produto; o spec foi reapontado e
  passou isolado em 1,4 s.

### 5.3 O que NÃO foi medido

- **A prova vermelha do IDOR não foi reexecutada** nesta árvore: a investigação
  registrou que, sem a correção, a pré-assinada era concedida ao intruso; o teste
  atual prova o estado corrigido, não o anterior. Reverter o código para medir de novo
  não foi feito.
- **A hipótese do E2E com MINICOURSE não foi executada**: ela é a explicação de por
  que o teste que faltava existiria; não há uma execução registrada de um E2E de
  minicurso que tenha passado antes da fase.
- **O custo de B** está medido em **estrutura** (três ações, conclusão duplicada,
  JS-only), não em horas de implementação.
- **A corrida do teto de 5** não tem teste paralelo: a declaração é de que um excesso
  de uma unidade é aceitável; nenhum teste coloca duas abas simultâneas.
- **O limite de `listCallProposals`** (100 padrão, 300 máximo) não foi medido contra
  uma chamada com mais propostas que o teto; a catraca `lista.length === selo` vale
  até o limite de leitura, e isso já era assim antes da fase.
- **O ganho de tempo do `findReusableDraft`** não foi medido; o teste prova o efeito
  (uma tentativa, um rascunho), não o custo.

---

## 6. Evidência de Verificação

### 6.1 `npm run lint`

```
> eventflow@0.1.0 lint
> eslint .
```

Sem saída: **0 erros, 0 warnings**.

### 6.2 `npm run typecheck`

```
> eventflow@0.1.0 typecheck
> tsc --noEmit
```

Sem saída: **0 erros**.

### 6.3 `npm test` — a suíte Vitest inteira

```
 Test Files  219 passed (219)
      Tests  4033 passed (4033)
   Duration  157.53s
```

Os **94 testes da fase** estão em 10 arquivos novos:

| Arquivo | Testes |
|---|---|
| `tests/unit/f74-tela-da-proposta.test.ts` | 13 |
| `tests/unit/f74-chamada-herda-da-trilha.test.ts` | 14 |
| `tests/unit/f74-anexo-na-proposta.test.ts` | 15 |
| `tests/unit/f74-rascunho-honesto.test.ts` | 11 |
| `tests/integration/f74-posse-do-upload.test.ts` | 5 |
| `tests/integration/f74-pagina-da-submissao.test.ts` | 4 |
| `tests/integration/f74-proposta-ciencia.test.ts` | 8 |
| `tests/integration/f74-anexo-na-proposta.test.ts` | 6 |
| `tests/integration/f74-chamada-herda-da-trilha.test.ts` | 9 |
| `tests/integration/f74-rascunho-honesto.test.ts` | 9 |

### 6.4 `npm run build`

`next build` concluiu:

```
✓ Compiled successfully in 6.7s
```

E a rota pública da chamada aparece na listagem:

```
├ ƒ /t/[tenantSlug]/eventos/[eventSlug]/chamada/[callSlug]
...
ƒ  (Dynamic)  server-rendered on demand
```

### 6.5 `npm run db:verify`

```
  ✓  Nenhuma tabela com RLS ficou sem policy
  ✓  Role "eventflow_app" sem superuser e sem BYPASSRLS
  ✓  GRANTs mínimos presentes, TRUNCATE ausente
  ✓  Tabela(s) de plataforma inalcançável(is) pela role "eventflow_app"

  Contrato íntegro.
```

### 6.6 `npm run db:verify:isolation`

```
  9/9 verificações passaram.
  Isolamento entre tenants garantido pelo banco.
```

### 6.7 `npm run db:partitions`

```
  audit_logs_2028_07                  0     0.04 MB
  audit_logs_2029_05                  0     0.08 MB
  audit_logs_default                  0     0.09 MB

  total: 101115 linha(s)
```

As partições do mês atual e dos seguintes já existem; a manutenção **cria e mantém**,
nunca apaga (B8 segue em aberto).

### 6.8 O container — a imagem é a nova

```
Image eventflow/web:local Built
Image eventflow/worker:local Built
Container eventflow-web Recreated
Container eventflow-worker Recreated
```

Data da imagem, conferida **depois** do build:

```
2026-10-22T18:54:09.000655011Z   (15:54:09 em America/Sao_Paulo)
```

Container `healthy` e a rota pública da chamada respondendo **200** — o build não
falhou por DNS e não ficou imagem velha no ar.

### 6.9 E2E — a suíte inteira

```
  2 failed
    [chromium] › tests/e2e/f62-regressao-visual.spec.ts:1969:3 › rodapé público da plataforma › 13. o rodapé público da raiz no claro
    [chromium] › tests/e2e/f62-regressao-visual.spec.ts:1982:3 › rodapé público da plataforma › 14. o rodapé público da raiz no escuro
  1 skipped
  400 passed (10.5m)
```

Os dois vermelhos são **pré-existentes** e medidos isolados na §6.10. O terceiro
vermelho da primeira execução (`peer-review.spec.ts`, asserção de texto) foi
diagnosticado e corrigido no spec; a execução repetida passou a 400.

### 6.10 Os vermelhos pré-existentes, medidos isolados

**`f62` — o rodapé público da raiz, claro:**

```
Expected an image 1440px by 3262px, received 1440px by 3334px.
233106 pixels (ratio 0.05 of all image pixels) are different.
```

**`f62` — o rodapé público da raiz, escuro:**

```
Expected an image 1440px by 3262px, received 1440px by 3334px.
820069 pixels (ratio 0.18 of all image pixels) are different.
```

Diagnóstico: a página mede **lista e métricas dinâmicas** — a altura muda com o
conteúdo do momento (3334 px recebidos contra 3262 px de linha de base), e a
diferença de pixels acompanha. Não é regressão da F74 (a fase não tocou a raiz
pública nem `globals.css`); é o vermelho já conhecido da F62, com números medidos
nesta árvore. O número registrado na temporada (~235.478 px/5% no claro e
~950.293 px/20% no escuro) foi medido em **outro estado do conteúdo** — a mesma
causa, o mesmo caráter dinâmico; não é um valor fixo a bater.

**`f65` — "Acontecendo agora":** não reprovou nesta execução; a intermitência é a da
virada do minuto (recalcula `Date.now()`), e a suíte roda com `workers: 1` e uma
tentativa. Rodado isolado (as duas asserções da aba) passou — o defeito é de janela
de tempo, não de produto.

**`peer-review.spec.ts:369`** (o terceiro vermelho da primeira execução):

```
Locator: getByTestId('submit-blockers')
Expected pattern: /versão cega/i
Received string: "A trilha exige revisão cega: anexe a versão sem identificação dos autores."
```

Diagnóstico: o comportamento está **correto** — a frase agora é a recusa do domínio,
a mesma que o serviço devolve; o teste prendia a cópia escrita à mão que a fatia 2
substituiu. O spec foi reapontado para `/revisão cega/i` e passou isolado:

```
✓  1 [chromium] › tests/e2e/peer-review.spec.ts:369:3 › ... (1.4s)
  1 passed (2.7s)
```

### 6.11 As catracas, com a mutação

- **Fonte única da exigência**: a página da chamada importa
  `submissionArtifactRequirements`; o teste de fonte reprova se a frase voltar ao
  JSX. Mutação: apagar a importação e escrever a frase à mão → reprova.
- **Fonte única da prontidão**: a página da submissão importa
  `evaluateSubmissionReadiness`; o teste compara `daTela.blockers` com
  `doServico.details`. Mutação: voltar a montar a lista à mão → reprova por diferença.
- **Fonte única da cegueira**: o serviço, o anúncio, o painel e a atribuição usam
  `resolveRequiresBlindReview`; o teste de fonte reprova a expressão inline. Mutação:
  voltar a `call ?? track ?? true` → reprova.
- **Fonte única da recepção**: lista, contagem, selo e limite usam
  `proposal-receipt-rules`; a catraca da F54 e o teste da fila reprovam se a lista
  divergir do selo. Mutação: filtrar `WITHDRAWN` na lista → reprova.
- **A posse**: `NOT_OWNER` nas duas etapas e a submissão do dono intacta; mutação:
  remover `ensureSubmissionOwnedBy` → o teste do intruso reprova.

---

## 7. Comandos Operacionais

```bash
# A bateria da §4, na ordem
npm run lint
npm run typecheck
npm test
npm run build
npm run db:verify
npm run db:verify:isolation
npm run db:partitions

# O container precisa rodar o código NOVO antes do E2E
docker compose --profile app up -d --build web worker
docker image inspect eventflow/web:local --format '{{.Created}}'   # conferir a data
docker compose ps web worker

# A suíte E2E inteira, com a saída FORA da árvore
npx playwright test --output "$TEMP/ef-e2e-f74" --reporter=list

# Só a fase
npx vitest run tests/unit/f74- tests/integration/f74-

# A fila honesta (o conserto da fatia 6)
npx vitest run tests/unit/f74-rascunho-honesto.test.ts tests/integration/f74-rascunho-honesto.test.ts

# A herança da trilha
npx vitest run tests/unit/f74-chamada-herda-da-trilha.test.ts tests/integration/f74-chamada-herda-da-trilha.test.ts

# A posse do upload
npx vitest run tests/integration/f74-posse-do-upload.test.ts tests/integration/f74-pagina-da-submissao.test.ts

# A página pública da chamada (o aviso do anexo)
npx playwright test tests/e2e/f74-proposta-ciencia.spec.ts

# Os vermelhos pré-existentes, isolados
npx playwright test tests/e2e/f62-regressao-visual.spec.ts -g "13\. o rodapé público da raiz no claro"
npx playwright test tests/e2e/f62-regressao-visual.spec.ts -g "14\. o rodapé público da raiz no escuro"
```

**Onde olhar na interface:**

```
Chamada pública ....... /t/<slug>/eventos/<eventSlug>/chamada/<callSlug>
                          → aviso "exige um arquivo" antes do formulário
                          → "O que esta chamada pede" com o PDF anonimizado (obrigatório)
                            e o identificado (recomendação)
Painel de chamadas ..... /t/<slug>/administracao/eventos/<eventId>/chamadas
                          → selo "N propostas recebidas · N decidida(s)"
                          → se a chamada tem rascunhos com arquivo:
                            "N rascunhos em andamento"
                          → "Propostas recebidas (N)" com o status na linha
                          → Revisão cega: Revisão cega · Revisão aberta ·
                            Herdar da trilha (cega/aberta) · Padrão do tipo
Rascunho do autor ...... /t/<slug>/submissoes/<submissionId>
                          → bloqueios e avisos da MESMA régua do serviço
                          → upload e envio
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- **E46 — RE-ESCOPADA, NÃO QUITADA.** O anexo **inline na página pública da
  chamada** continua fora (decisão A): a página avisa e manda ao rascunho, onde a
  esteira existe. O que a fase fechou foi o **beco**; o que falta é o upload no
  formulário público, com a visibilidade e o portão de inspeção da F36. O custo de B
  está registrado em `docs/dividas-tecnicas.md` (três ações, conclusão duplicada,
  JS-only). A contagem de dívidas **não muda**: 41 abertos.
- **O teto de 5 e a corrida:** duas abas podem criar um rascunho acima do teto por
  chamada; é deliberado (proteção de armazenamento, não direito), mas não há teste
  paralelo. Se o produto quiser rigidez, o caminho é índice/`UPDATE` condicional.
- **A retenção da auditoria (B8)** segue decisão de negócio em aberto; a rotina
  **cria** partições e nunca apaga.
- **O limite de leitura da lista de propostas** (100/300) pode fazer a catraca
  `lista.length === selo` divergir em chamadas muito grandes; o comportamento é
  anterior à fase e não foi alterado.
- **O seed da chamada de minicursos continua `false`.** Sem backfill: herdar é
  escolha do organizador. Quem quiser ver a herança em demonstração precisa editar a
  chamada e escolher "Herdar da trilha" (a trilha `trilha-tecnologia` é cega).
- **O `isBlind` das atribuições antigas** não é reescrito pela migração: as
  atribuições já gravadas mantêm o valor que tinham. A correção vale para as novas.
- **A frase "A trilha exige revisão cega"** permanece no domínio mesmo quando a
  cegueira vem do **tipo** (chamada sem trilha). É uma frase de produto que cita a
  trilha; mudá-la agora trocaria o texto de uma recusa que os testes e o E2E já
  prendem. Ponto de atenção de redação, não de regra.

---

## 9. Checklist de Aceite

| Requisito | Situação |
|---|---|
| **Fatia 1** — `requestUpload`/`confirmUpload` conferem `submittedById`, fail-closed, com `NOT_OWNER` | ✅ |
| A posse é conferida **antes** de `inspectObject` (o caminho de integridade apaga o objeto) | ✅ |
| Teste de integração com UUID alheio recusado nas duas etapas e a submissão do dono intacta | ✅ (5) |
| **Fatia 2** — a recusa `NOT_READY` devolve o `submissionId` e a tela oferece um link real | ✅ |
| O `redirectTo` do sucesso é uma rota existente | ✅ |
| A página da chamada anuncia a exigência do arquivo antes do formulário | ✅ |
| A página do rascunho usa a MESMA `evaluateSubmissionReadiness` do serviço | ✅ (`toEqual`) |
| A página `/submissoes/<id>` confere a posse antes de ler o detalhe | ✅ (4 testes) |
| **Fatia 3** — rascunho fora da lista, da contagem, do selo e do limite por autor | ✅ |
| Rascunho com arquivo contado à parte ("trabalho em andamento"), com frase própria | ✅ |
| `findReusableDraft` retoma o rascunho vazio e não o com arquivo | ✅ |
| O `authorSubmissions: 0` da retomada foi corrigido (limite conferido) | ✅ |
| **Fatia 4** — aviso do caminho do anexo na página da chamada (decisão A) | ✅ |
| Teto de 5 rascunhos com arquivo por autor por chamada, com frase e caminho | ✅ |
| A página pública **não** ganhou upload (catraca de fonte) | ✅ |
| **Fatia 5** — `requiresBlindReview` nulável e `resolveRequiresBlindReview` com `source` | ✅ |
| CHAMADA → TRILHA → PADRÃO do tipo, com o padrão do tipo no último degrau | ✅ |
| "Herdar da trilha" × "Padrão do tipo" na tela do organizador | ✅ |
| O anúncio público e o `isBlind` da atribuição leem a cegueira efetiva | ✅ |
| Migração **sem backfill**; seed mantém minicursos `false` | ✅ |
| **Fatia 6** — a lista mostra o que foi **enviado**, inclusive recusada e retirada | ✅ |
| O status na linha usa o rótulo do domínio (não o enum cru) | ✅ |
| O selo e a contagem contam a mesma coisa; catraca `lista.length === selo` | ✅ |
| `DRAFT` continua fora (decisão do humano) | ✅ |
| A régua foi renomeada (`NOT_SENT_…`) e cada leitor foi atualizado | ✅ |
| Teste: recusada e retirada aparecem com o rótulo; o rascunho não; o selo conta as três | ✅ |
| Documento com as 9 seções e ADRs 360, 361 e 362 (próxima 363) | ✅ |
| `AGENTS.md` com fases `29 a 74`, contagens medidas, ADRs `362 → 363`, linha 74, dívidas e §10 | ✅ |
| `AGENTS.md` sob o teto de ~64.800 bytes, §10 terminando em `Aguardando APROVADO: AVANÇAR` | ✅ |
| `README.md` e `docs/dividas-tecnicas.md` com a narrativa da F74 e a E46 re-escopada | ✅ |
| `npm run lint` / `typecheck` / `test` / `build` / `db:verify` / `db:verify:isolation` / `db:partitions` | ✅ |
| Suíte E2E inteira, container reconstruído e data da imagem conferida | ✅ |
| Vermelhos pré-existentes medidos isolados (`f62` claro/escuro) | ✅ |
| `docs/imagens/f74-proposta-exige-anexo.png` e `f74-chamada-herda-da-trilha.png` | ✅ |
| `globals.css` e `playwright.config.ts` intactos | ✅ |
| `playwright-report/`, `test-results*`, `.playwright*` limpos; `next-env.d.ts` intacto | ✅ |

---

**Aguardando APROVADO: AVANÇAR**
