# FASE 36 — Operação das rotinas automáticas, inspeção de arquivos, lote de certificados e aviso de decisão

> **Escopo definido pelo humano.** *"Agendamento de Tarefas Automáticas para Liberação
> automática de vagas expiradas, Manutenção e criação de partições do PostgreSQL, Varredura
> diária de prazos de pareceres e avisos, Fechamento de presenças em aberto no balcão"* — e,
> na mesma lista: **Varredura de Antivírus (ClamAV)**, **Exportação de Certificados em Lote
> (.ZIP)** e **Aviso de Decisão na Chamada de Propostas (CFP)**.
>
> **Decisões escolhidas pelo humano antes do código:** a lista foi dividida em **duas fases**
> — esta (F36: operação e segurança) e a **F37** (impressão de crachás em papel adesivo e
> térmica + confirmação por item individual de exigência) · a inspeção antivírus fica atrás
> de um **driver cujo padrão é NÃO inspecionar** · o painel das rotinas vive em
> **`/superadmin`**, porque uma passada atende todas as instituições.

---

## 1. Sumário executivo

Quatro rotinas já existiam e rodavam desde fases diferentes — prazos de parecer, presenças em
aberto, confirmação de vaga — e **nenhuma delas sabia responder quando rodou pela última vez**.
Quem operava só tinha o `console.log` de dentro do container: para descobrir se a varredura das
3h tinha rodado era preciso ler o log do worker, e para saber *por que* falhou, também. Pior: a
criação das partições mensais da auditoria morava na **máquina de quem instalou** (cron do
host), e o mês virando sem partição é a falha que só aparece quando alguém tenta auditar.

Esta fase transforma "rotina que roda" em **operação**: cada passada abre e fecha um registro
em `job_runs` (histórico), a linha é também a **exclusão mútua** (uma execução por rotina,
decidida pelo banco), a manutenção das partições vem para dentro do worker e existe um painel
de governança com saúde, histórico e um botão de "executar agora".

E ela quita duas dívidas que estavam abertas desde a FASE 4 e a FASE 33: o antivírus (a coluna
`scanStatus` existia desde a migração inicial e **ninguém inspecionava nada**) e o aviso de
decisão ao proponente (a proposta tinha comprovante de envio e **nenhuma resposta**).

### Entregas

| Entrega | Onde |
|---|---|
| Migração à mão: `job_runs` + índice único parcial `WHERE status = 'RUNNING'` (a reserva), e as colunas de veredito em `submission_files` e `speaker_materials` | `prisma/migrations/20260923133056_jobs_and_file_scan/` |
| Migração à mão: revogação do acesso da role de runtime a `job_runs`, e a verificação de contrato que passou a exigir isso | `prisma/migrations/20260923154500_job_runs_platform_only/`, `docker/postgres/init/00-roles.sql`, `src/lib/db/schema-contract.ts`, `prisma/scripts/assert-schema-contract.mjs` |
| Catálogo puro das rotinas: chave, rótulo, descrição, cadência, o que ela conta, estados, gatilhos, saúde e leitura da expressão cron | `src/domain/platform/job-catalog.ts` |
| Registro e reserva das execuções (claim, fechamento condicional, reaproveitamento da execução órfã, histórico, última por rotina) | `src/lib/platform/job-runs.ts` |
| Manutenção das partições mensais de `audit_logs` como SERVIÇO (criação, concessões, RLS + FORCE, resgate da DEFAULT) | `src/lib/platform/partition-service.ts`, `prisma/scripts/ensure-audit-partitions.ts` |
| Regra pura da inspeção: estados, estado de nascimento, portão do download e leitura da resposta do clamd | `src/domain/review/file-scan-rules.ts` |
| Driver de inspeção (padrão `none`; `clamav` por `zINSTREAM`, com o corpo lido do storage EM FLUXO) | `src/lib/storage/scan-service.ts` |
| Rotina de inspeção cross-tenant (submissões e material de palestrante), com trilha da ameaça | `src/lib/review/file-scan-service.ts` |
| Portão aplicado nos DOIS caminhos que servem bytes de terceiro (comitê e material do palestrante) | `src/lib/review/submission-service.ts`, `src/lib/speakers/material-service.ts` |
| Escritor de ZIP sem dependência (STORE, CRC-32, diretório central, nome seguro contra *zip slip*) | `src/lib/documents/zip-writer.ts` |
| Plano do lote de certificados do evento (quem entra, com que nome, quantos ficaram de fora) | `src/lib/certificates/certificate-service.ts` |
| Rota de download do lote, com trilha `EXPORT` | `src/app/api/t/[tenantSlug]/certificados/zip/route.ts` |
| Botão do lote na tela de certificados da equipe (só com evento escolhido) | `src/app/t/[tenantSlug]/(app)/administracao/certificados/page.tsx` |
| Painel de governança das rotinas (`/superadmin/rotinas`): saúde, catálogo, histórico e "executar agora" | `src/app/superadmin/rotinas/page.tsx`, `src/components/platform/job-run-button.tsx`, `src/app/actions/platform-actions.ts` |
| Cinco rotinas agendadas a partir de UMA lista, com rastreio de execução no worker | `src/lib/communication/email-queue.ts`, `src/workers/index.ts` |
| Aviso que avisa o portador do arquivo bloqueado **por quê** | `src/app/t/[tenantSlug]/(app)/revisoes/[submissionId]/page.tsx` |
| Serviço de aviso compartilhado (caixa de entrada + e-mail com a mesma `dedupeKey`), extraído da FASE 34 | `src/lib/communication/notice-service.ts` |
| Texto e regra da decisão da proposta, e o aviso ao proponente | `src/domain/review/decision-notice-rules.ts`, `src/lib/review/proposal-notices.ts` |
| Template `PROPOSAL_DECIDED` (catálogo de 16 → 17) e o gancho fora da transação do `recordDecision` | `src/domain/communication/email-templates.ts`, `src/lib/review/review-service.ts` |
| ClamAV em perfil próprio no compose, com volume de assinaturas; variáveis do driver no web e no worker | `docker-compose.yml`, `.env.example` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **26** — 2 migrações, 3 de domínio, 7 de aplicação (serviços, escritor de ZIP, driver), 3 de interface (rota, componente, página), 11 de teste (4 unitários, 5 de integração, 2 E2E) + este documento |
| Arquivos alterados | **24** — `schema.prisma`, `package.json`, o contrato de schema e a verificação de contrato, o init de roles do PostgreSQL, o serviço de submissão, o de material de palestrante, o de certificados, o de review, o de avisos da FASE 34, a fila de e-mail, os templates, o worker, as actions de plataforma, a navegação do painel, duas páginas, o compose, o `.env.example`, o teste de comunicação e três de documentação |
| Arquivos removidos | **1** — `prisma/scripts/ensure-audit-partitions.mjs` (virou serviço + CLI em TypeScript) |
| Migrações | **2** novas — total **32** |
| Templates de e-mail | **16 → 17** |
| Rotinas no catálogo | **3 → 5** (entraram a inspeção de arquivos e as partições) |
| Testes novos | **93** no Vitest (53 unitários + 39 de integração + 1 no catálogo de templates) + **7** E2E — a suíte foi de **1772/74** para **1865/83**, e o E2E de **116** para **123** |
| Defeitos reais encontrados | **6** — a leitura de cron que não reconhecia `0 * * * *` e lia a semanal como diária (dois defeitos na mesma função), o nome `...` que passava pelo filtro do ZIP, o contador de certificados em geração que nunca contava nada, o `entityId` textual que apagava a trilha em silêncio e a tabela de plataforma que nasceu alcançável pela role de runtime |
| Dívidas quitadas | **2** — **A3** (inspeção antivírus) e **E47** (o proponente não era avisado da decisão) |
| ADRs | **183 … 191** (a próxima é 192) |

---

## 2. O problema mais difícil: **uma rotina que ninguém vê é uma rotina que não existe**

O pedido tinha quatro itens que pareciam independentes — liberar vaga vencida, criar partição,
avisar prazo de parecer, fechar presença aberta — e todos já funcionavam. O que faltava não era
código de varredura: era **saber**. A pergunta real de quem opera é

> "a rotina das 3h rodou ontem, quantas vagas liberou e por que falhou na terça?"

e nenhuma das quatro conseguia responder. A resposta estava em `docker logs`, que é onde a
informação está **depois** de alguém já desconfiar do problema.

Disso saíram as três decisões que definem o desenho todo:

1. **a linha em `job_runs` é o registro E a reserva** — não existe "registrar depois": quem
   abre o registro é quem ganhou o direito de rodar. Um mecanismo, dois efeitos, e a garantia
   no banco (índice único parcial) em vez de na disciplina de quem escreve a próxima rotina;
2. **a falha é contida e fica escrita** — uma varredura que explode vira `FAILED` com o motivo
   gravado, não derruba o worker nem a próxima rotina, e aparece na tela;
3. **a tela mostra o catálogo, não o histórico** — uma rotina que NUNCA rodou precisa aparecer
   como "nunca rodou". Listar execuções esconderia exatamente o caso que exige ação (o worker
   não subiu? o agendador não foi registrado?).

O segundo problema mais difícil foi a **exclusão mútua**, e ele tem uma armadilha de
infraestrutura específica deste projeto: o pool roda sob **PgBouncer em modo transação**, onde
a conexão troca entre comandos — e `pg_advisory_lock` (escopo de SESSÃO) simplesmente não
sobrevive à troca. Dois workers acreditariam ter o lock. A resposta está na ADR-183.

---

## 3. Decisões técnicas

### 3.1 Uma tabela faz o registro e a garantia

`job_runs` guarda `job`, `status`, `trigger`, `startedAt`, `finishedAt`, `items`, `error`,
`triggeredById` e `host`. E o índice parcial

```sql
CREATE UNIQUE INDEX "job_runs_running_key" ON "job_runs" ("job") WHERE "status" = 'RUNNING';
```

é o que transforma a tabela em mecanismo de exclusão mútua. O caminho normal é um `INSERT` que
o índice aceita; quando ele é recusado, há duas possibilidades — e as duas importam:

* **outra instância está rodando agora** → a passada é PULADA (`SKIPPED`). A rotina é periódica:
  a próxima passada pega o trabalho, e insistir só gastaria o mesmo recurso duas vezes;
* **a execução anterior morreu no meio** (worker reiniciado, OOM) → a linha ficou `RUNNING`
  para sempre e a rotina **nunca mais rodaria**. A execução velha é encerrada como `FAILED`
  ("o worker que a iniciou não a concluiu") e a reserva é tentada de novo.

O teto de meia hora (`JOB_STALE_AFTER_MS`) é o que separa os dois casos. Sem ele, o
reaproveitamento viraria o oposto do pretendido: dois workers rodando a mesma varredura porque
o primeiro "parecia" morto.

### 3.2 O fechamento é condicional, e o motivo é truncado

`finishJobRun` faz `updateMany` com `where: { id, status: 'RUNNING' }`. Se o coletor de
execuções órfãs já fechou a linha, a atualização afeta **0 linhas** — e isso é resposta de
negócio, não erro (invariante nº 5). O `error` é cortado em 2000 caracteres: o registro precisa
ser legível, não virar um despejo de stack trace.

### 3.3 As partições saem do host e viram serviço

A FASE 13 deixou a criação das partições para o cron do host. Esta fase trouxe a rotina para o
worker (`audit-partitions`, todo dia às 3h) **e manteve a CLI** para quem opera sem worker — as
duas chamam o mesmo serviço. O que o serviço faz, em ordem, por mês que falta:

1. conta as linhas do intervalo que caíram na partição `DEFAULT` (existe justamente para que
   gravar auditoria nunca falhe);
2. guarda essas linhas numa tabela temporária, apaga da `DEFAULT`, cria a partição e reinsere —
   **na mesma transação**, porque a auditoria não pode se perder no meio do caminho;
3. concede os privilégios da role de runtime e aplica **RLS + FORCE** com a policy
   `tenant_isolation`.

O passo 3 não é formalidade: uma partição nova nasce "crua", e sem RLS ela seria uma **porta
lateral** para a auditoria de todas as instituições — a tabela-mãe tem a policy, e a partição
precisa da dela.

**Retenção continua fora de escopo** (dívida B8): a manutenção cria e nunca apaga.

### 3.4 O driver de inspeção, com o padrão em NÃO inspecionar

Mesma decisão do driver de e-mail (ADR-128): o sistema **não pode fingir** que inspecionou. Com
`SCAN_DRIVER=none` (o padrão), o arquivo nasce `SKIPPED` — "não inspecionado" — é servido
normalmente, e a tela diz isso. Nada é bloqueado por um serviço que não está no ar, e nada é
declarado limpo sem ter sido olhado.

E `SCAN_DRIVER=clamav` **sem** `CLAMAV_HOST` falha com o motivo escrito, em vez de cair para
`none` em silêncio: quem ligou o antivírus precisa saber que ele não está lá.

O tempo limite (60 s) é **constante de domínio**, e não variável de ambiente — de propósito.
Uma configuração que ninguém lê é pior que um valor fixo (armadilha 67).

### 3.5 As duas regras do portão, e onde ele vale

```
INFECTED  → nunca é servido, com a inspeção ligada OU desligada
PENDING   → só é bloqueado ENQUANTO a inspeção está ligada
```

A primeira é a razão de a inspeção existir: o que já foi identificado como malicioso não volta
a circular porque alguém desligou o antivírus. A segunda é a promessa do pedido ("antes de
disponibilizá-los aos comitês"), e ela não pode virar bloqueio eterno: com o driver desligado,
travar tudo quebraria o produto — e o estado honesto do arquivo, nesse caso, é `SKIPPED`.

O portão vale onde **a aplicação media os bytes**: arquivo de submissão (comitê) e material de
palestrante (inscritos). Não vale em `media_assets`: aquele bucket é de leitura pública e a
imagem não passa pelo processo (a FASE 17 já valida a assinatura real do arquivo). Proposta não
tem anexo (**E46**), então não há o que inspecionar ali. São limites declarados, não
esquecimentos.

E o arquivo bloqueado **diz por quê**: quando o portão recusa, a tela do revisor mostra o motivo
no lugar do botão de download — antes, o artefato aparecia sem link e sem explicação.

### 3.6 O ZIP é escrito à mão, e o corpo é um fluxo

Nenhuma dependência nova: o formato clássico do ZIP é cabeçalho local (30 bytes), nome,
conteúdo, diretório central e registro de fim — e o CRC-32 é uma tabela de 256 entradas. São
~220 linhas previsíveis contra uma dependência que precisaria ser auditada.

O que decide a arquitetura não é o formato: é a **memória**. Um evento de 3.000 participantes
tem 3.000 PDFs, e montar o lote em memória funciona no evento de 30 pessoas e derruba o
servidor no dia da entrega. Por isso `planEventCertificateZip` devolve só o **plano** (bucket,
chave e nome de arquivo) e o corpo é produzido por um gerador assíncrono: cada PDF é lido do
storage e escrito no ZIP enquanto é enviado — **um arquivo por vez**.

E um objeto que falhou é **pulado**, com o motivo no log e a contagem no cabeçalho
`x-certificados-fora-do-lote`: um PDF ausente no bucket não pode impedir a instituição de
baixar os outros 299. Um ZIP menor sem explicação é o defeito que ninguém consegue diagnosticar
depois.

### 3.7 O lote é por EVENTO, e a trilha guarda o lote

A rota vive no mesmo nível da tela (`/certificados/zip`) com o evento na **query** — pela
armadilha 69, o Next não aceita dois nomes de segmento dinâmico no mesmo nível, e já existe
`/api/t/[tenantSlug]/eventos/[eventSlug]/...`. A autorização é `certificate:issue` (quem emite
é quem entrega), e o acesso entra na trilha como `EXPORT` com o evento, quantos certificados
foram e **quem baixou** — a mesma decisão do CSV da FASE 32. Documento com dado pessoal saindo
em lote é exatamente o fato que a instituição precisa poder conferir depois.

Na tela, o botão só aparece com um **evento escolhido** no filtro; sem ele, a tela diz o que
fazer. Um ZIP com a instituição inteira não é o que a instituição entrega.

### 3.8 O aviso de decisão: o outro lado do protocolo

A FASE 33 fez a proposta ter **protocolo** — o envio tem comprovante, e é por ele que a pessoa
pergunta depois. A resposta, porém, morria no painel do comitê. Numa chamada com pedido de
ajustes, o prazo corria **contra quem não sabia** que precisava mexer em alguma coisa.

O aviso sai pelo mesmo serviço da FASE 34 (mensagem é o fato, e-mail é consequência) e a
`dedupeKey` carrega a **decisão**, não só a proposta: pedir ajustes e depois aceitar são dois
fatos, e os dois precisam chegar. O **parecer do comitê vai junto** — "Ajustes solicitados" sem
dizer o que ajustar obriga a pessoa a abrir a plataforma para descobrir se precisa fazer algo,
e o texto já é visível a ela na tela da proposta.

O disparo é **fora da transação** do `recordDecision` e só acontece quando a submissão tem
`callId` — ou seja, quando ela nasceu de uma **chamada**. O artigo do fluxo acadêmico continua
como estava: é um limite declarado (invariante nº 8: comunicação é consequência, nunca
condição).

### 3.9 A regra do aviso saiu de dentro do arquivo da FASE 34

`registration-notices.ts` tinha a própria cópia de "grava na caixa de entrada e enfileira o
e-mail com a mesma chave". Quando esta fase precisou da mesma regra, a escolha era copiar de
novo (duas cópias que divergem na primeira manutenção — armadilha 55) ou extrair. Está
extraído em `src/lib/communication/notice-service.ts`, e a FASE 34 passou a usá-lo.

---

## 4. ADRs

### ADR-183 — A reserva da rotina é uma linha com índice único parcial, e NÃO um advisory lock

**Contexto.** As varreduras agora rodam em mais de um processo possível (o worker do compose, um
segundo worker, uma execução pedida pelo painel) e precisam de exclusão mútua.

**Decisão.** A reserva é um `INSERT` em `job_runs` com `status = 'RUNNING'`, protegido por um
índice único **parcial** (`WHERE status = 'RUNNING'`). Recusa do índice = outra execução em
andamento.

**Justificativa.** O pool roda sob PgBouncer em **modo transação**: a conexão volta ao pool a
cada COMMIT, e `pg_advisory_lock` (escopo de SESSÃO) **não sobrevive à troca** — dois workers
acreditariam ter o lock, que é o pior desfecho possível para uma garantia. `pg_advisory_xact_lock`
resolveria a sessão, mas amarraria a exclusão à transação inteira da varredura, que é longa e
faz várias escritas por instituição. A linha com índice parcial não tem nenhum dos dois
problemas e ainda deixa o **histórico** — o mesmo mecanismo responde "está rodando?" e "quando
rodou?".

**Consequências.** Uma tabela de plataforma a mais (`job_runs`, sem `tenantId`, acessada com
`adminPrisma` como o resto de `src/lib/platform/**`). A execução órfã precisa de teto de tempo
(`JOB_STALE_AFTER_MS`) para não travar a rotina para sempre. Toda rotina nova passa a ter
histórico de graça.

### ADR-184 — A tela lê o CATÁLOGO, não as execuções

**Contexto.** O painel de rotinas precisa mostrar a saúde de cada rotina.

**Decisão.** `lastRunPerJob` percorre as chaves do catálogo e busca a última execução de cada
uma; uma rotina sem execução aparece como `NEVER` ("nunca rodou").

**Justificativa.** Listar as execuções esconderia exatamente o caso que exige ação: a rotina que
nunca rodou (o worker não subiu, o agendador não foi registrado). "Nunca rodou" é um resultado,
não um erro.

**Consequências.** O catálogo (`src/domain/platform/job-catalog.ts`) passa a ser a fonte única
de rótulo, descrição, cadência e unidade dos itens — o worker agenda a partir dele e a tela
mostra a partir dele, então acrescentar rotina é acrescentar uma linha.

### ADR-185 — O atraso é medido contra a cadência da própria rotina

**Contexto.** A tela precisa dizer se uma rotina está atrasada. A tentação é comparar com um
limite fixo ("não roda há uma hora → atrasada").

**Decisão.** `jobHealthOf` traduz a expressão cron da própria rotina em um intervalo aproximado
(`cronIntervalMinutes`) e acusa atraso depois de **duas** passadas perdidas. Quando a expressão
não é reconhecida, devolve `null` e a saúde é `OK` — sem opinar.

**Justificativa.** Uma rotina de 15 minutos que não roda há 2 horas está atrasada; uma diária que
não roda há 2 horas não está. E um alarme que sempre toca é um alarme que ninguém olha — o
teste pegou duas leituras erradas da primeira versão (ver §5).

**Consequências.** O leitor de cron é intencionalmente parcial: passo nos minutos, passo de horas
com o minuto zerado, hora cheia e horário fixo diário, **sempre com dia, mês e dia da semana
irrestritos**. Expressão fora disso não é interpretada — melhor não opinar sobre atraso do que
inventar.

### ADR-186 — O `jobId` da fila não carrega `:` (e a fila de e-mail é a das rotinas)

**Contexto.** O painel pede a execução imediata de uma rotina.

**Decisão.** A tela **enfileira** (`enqueueJobRun`, `jobId = job-<rotina>-<epoch>`) e responde
na hora; quem roda é o worker, na fila `emails`, que já é a fila de manutenção da plataforma.

**Justificativa.** As rotinas são cross-tenant e passam por todas as instituições: executá-las
dentro da requisição prenderia a resposta por minutos e daria ao processo web uma conexão de
plataforma que ele não tem. O `:`, que o BullMQ recusa em `jobId`, é substituído por `-`
(armadilha 49).

**Consequências.** O retorno da ação **não** é "concluído": é "pedido enviado ao worker", e o
registro aparece no histórico quando o worker terminar. O componente se atualiza sozinho depois
da resposta (armadilha 78: "ainda não chegou" não é "não aconteceu").

### ADR-187 — O ClamAV vive num perfil próprio, e o produto funciona sem ele

**Contexto.** A inspeção antivírus é exigência de instituição, e o daemon carrega ~1 GB de
assinaturas na memória.

**Decisão.** O serviço `clamav` fica no perfil `av` do compose (não sobe por padrão, não sobe
junto de `app`) e o driver padrão é `none`. Ligar a inspeção é explícito:
`docker compose --profile av up -d clamav` + `SCAN_DRIVER=clamav`. A base de assinaturas vive
num volume nomeado, para não ser rebaixada a cada subida.

**Justificativa.** Subir 1 GB de RAM em toda máquina de desenvolvimento, para inspecionar o
arquivo de teste de quem está mexendo numa tela, é custo sem contrapartida. E o produto **não
pode fingir**: com o driver desligado o arquivo é `SKIPPED` e a tela diz que não houve inspeção.

**Consequências.** O worker precisa das mesmas variáveis do web (ele é quem varre). A ameaça
detectada entra na trilha de auditoria; arquivo limpo não gera linha (auditoria de rotina vira
ruído). O tempo limite é constante de domínio.

### ADR-188 — O lote de certificados é montado em FLUXO, e o que falha é pulado

**Contexto.** A instituição precisa entregar os certificados de um evento de uma vez.

**Decisão.** `planEventCertificateZip` devolve só o plano (bucket, chave, nome) e o corpo é um
gerador assíncrono lido pelo `Response` — um PDF por vez. Objeto que falha é pulado, com o
motivo no log e a contagem no cabeçalho.

**Justificativa.** Montar 3.000 PDFs em memória derruba o processo. E um arquivo ausente no
bucket não pode impedir a entrega dos outros 299.

**Consequências.** O ZIP é **STORE** (sem compressão): PDF já é comprimido, e comprimir de novo
gastaria CPU para ganhar pouco. O teto do formato clássico (60.000 entradas, 4 GB por arquivo)
é verificado no escritor, com mensagem legível — Zip64 está fora de escopo.

### ADR-189 — O aviso de decisão é do PROPONENTE, e só da proposta de chamada

**Contexto.** A dívida **E47**: o proponente não era avisado da decisão.

**Decisão.** `recordDecision`, depois do commit, dispara `notifyProposalDecided` **apenas** quando
a submissão tem `callId`. A `dedupeKey` carrega a decisão (`proposal-decided-<id>-<DECISÃO>`), e
o parecer do comitê vai no aviso.

**Justificativa.** O aviso é disparado do caminho único da decisão (comitê e protocolo de aceite
passam por ele), então não há segunda lista de "quem avisa". O artigo do fluxo acadêmico
permanece como estava: quem o submeteu acompanha a avaliação na tela de submissões, e mudar isso
mexeria no fluxo que as fases 4 e 33 fecharam. Decisões diferentes são fatos diferentes e geram
avisos diferentes; a mesma decisão repetida, não.

**Consequências.** Um limite declarado (artigo sem chamada não é avisado) e um aviso que nunca
lança: a decisão já está registrada, e falha de e-mail vira log.

### ADR-190 — A regra do aviso é compartilhada, e a FASE 34 passou a usá-la

**Contexto.** Três fases chegaram à mesma rotina "grava a mensagem na caixa de entrada, enfileira
o e-mail com a mesma chave".

**Decisão.** A rotina vira `deliverNotice` em `src/lib/communication/notice-service.ts`; a FASE 34
passa a importá-la (o tipo `NoticeOutcome` continua reexportado de onde nasceu).

**Justificativa.** Armadilha 55: duas cópias da mesma regra divergem na primeira manutenção. A
ordem "grava o FATO, enfileira a consequência" precisa existir em um lugar só.

**Consequências.** Uma refatoração em código já entregue e coberto — os testes da FASE 34 são
quem prova que nada mudou de comportamento.

### ADR-191 — Tabela de plataforma sem RLS tem o privilégio REVOGADO, e o contrato verifica isso

**Contexto.** `job_runs` não tem `tenantId` (uma passada de rotina atende todas as instituições),
logo não há como aplicar RLS. O provisionamento do banco concede `SELECT, INSERT, UPDATE, DELETE`
a **toda tabela nova** para a role de runtime (é o que faz as tabelas de instituição funcionarem
antes de receberem RLS).

**Decisão.** A role de runtime **não tem privilégio algum** em `job_runs`: a revogação mora na
migração que criou o acesso indevido (`20260923154500_job_runs_platform_only`) **e** no
`docker/postgres/init/00-roles.sql`, logo abaixo do `GRANT ... ON ALL TABLES`. Uma verificação
nova no contrato (`assert-schema-contract.mjs`, seção 10) reprova a bateria se qualquer tabela de
`PLATFORM_ONLY_TABLES` voltar a ter privilégio para o runtime.

**Justificativa.** Sem a revogação, o runtime leria o **histórico operacional** (host, erro,
rotina de todas as instituições) e poderia **travar uma rotina** inserindo uma linha `RUNNING` —
a mesma linha que serve de exclusão mútua. E a revogação precisa estar também no arquivo de init
porque `npm run db:migrate:deploy` termina em `npm run db:rls`, que reexecuta aquele arquivo: um
`REVOKE` só na migração era desfeito pela execução seguinte (foi o que aconteceu na primeira
versão da fase). **Quem concede é quem tem de revogar.**

**Consequências.** Toda tabela de plataforma futura entra em `PLATFORM_ONLY_TABLES` e precisa da
mesma revogação — a verificação não deixa esquecer. O acesso continua pela conexão de plataforma
(`adminPrisma`), o mesmo caminho da governança (invariante nº 1).

---

## 5. Lições aprendidas

Defeitos REAIS encontrados nesta fase, todos por testes.

| Sintoma | Causa raiz | Correção |
|---|---|---|
| A rotina de **confirmação de vaga** aparecia sem avaliação de atraso na tela, e o teste de catálogo reprovou a cadência dela | `cronIntervalMinutes` só reconhecia `*/N` nos minutos, `0 */N` nas horas e um número nas horas. A expressão `0 * * * *` (de hora em hora — hora `*`, minuto `0`) caía no `null`: a rotina que mais roda no catálogo ficava **sem** o dado que a tela existe para mostrar | O caso `minute === '0' && hour === '*'` passou a valer 60 minutos. O teste de catálogo percorre TODAS as rotinas e exige cron legível — foi ele que pegou. ADR-185 |
| Uma rotina **semanal** (`0 3 * * 1`) era lida como **diária** e apareceria "atrasada" todos os dias, menos no dia em que rodasse | Mesma função: ela lia apenas os campos de minuto e hora e **ignorava** dia, mês e dia da semana. Um alarme que sempre toca é um alarme que ninguém olha | Dia, mês e dia da semana precisam ser `*` para o intervalo ser uniforme; fora disso, `null` (não opinar). Teste unitário prende as três formas lidas e as cinco não lidas |
| Um nome de arquivo `...` dentro do ZIP passava pelo filtro de *zip slip* | O filtro descarta as partes `''`, `'.'` e `'..'`, mas `'...'` não é nenhuma delas: sobrava um nome que não é nome | O resultado só vale se tiver ao menos **uma letra ou número**; sem isso, `arquivo.pdf`. O teste do escritor percorre `..`, `.`, `...`, `'   '` e `/etc/shadow` |
| O lote de certificados dizia "os N certificado(s) ainda estão sendo gerados" e contava **0** — nunca, em nenhum cenário | `pending` era incrementado apenas para certificados `ISSUED` **sem** `storageKey` (um estado que quase não existe), enquanto "ainda sendo gerados" é `QUEUED`/`GENERATING` — outra população. O teste de integração do lote falhou com `expected +0 to be 1` | O contador soma as DUAS populações, com o porquê escrito no código. Sem o teste, a mensagem existiria para nunca aparecer — e o lote sairia vazio com a explicação errada |
| O compose anunciava `SCAN_TIMEOUT_MS` e **ninguém** lia essa variável | Eu publiquei a variável por reflexo ("tempo limite costuma ser configurável") antes de o serviço precisar dela. É a armadilha 67 pelo avesso: campo que todo mundo configura e ninguém lê é promessa falsa | A variável saiu do compose e do `.env.example`, e o tempo limite ficou declarado como constante de domínio — com o motivo escrito nos dois lugares |
| O container do worker **não tinha credencial de plataforma** | Ele só rodava varreduras pela role de runtime. Esta fase o fez escrever `job_runs` e criar partições (DDL) — operações que não pertencem a instituição nenhuma e por isso não cabem em `withTenant`. No ambiente de desenvolvimento funcionava **por acidente** (o fallback do cliente admin usa exatamente as credenciais padrão do compose) | `MIGRATE_DATABASE_URL` passou a ser declarada no serviço `worker`, com o porquê escrito ao lado. O E2E que clica "executar agora" e espera a execução no histórico é quem prova a cadeia inteira |
| **A trilha do pedido de execução não existia** — e o painel dizia que tinha dado certo | `entityId` é uma coluna `uuid` e eu passei a CHAVE da rotina (`audit-partitions`) ali. O `INSERT` falhou — e, como `recordAudit` **nunca lança** (invariante 8: auditoria não derruba operação), a falha apareceu como **ausência de linha**, não como erro. Quem pegou foi o E2E, que afirma a linha na TABELA em vez de afirmar a tela ("a ação é auditada") | `entityId` nulo e a chave em `changes.chave`, com o motivo no código. Armadilha **84** |
| **A verificação de contrato reprovou a fase**: `job_runs` é tabela sem RLS e **alcançável pela role de runtime** | O provisionamento concede `SELECT, INSERT, UPDATE, DELETE` a **toda** tabela nova (`ALTER DEFAULT PRIVILEGES`), o que é certo para tabela de instituição (que ganha RLS logo depois) e um buraco para tabela de plataforma: o runtime podia ler o histórico operacional e reservar uma rotina inserindo uma linha `RUNNING` | Revogação na migração **e** no `00-roles.sql` (ver a linha seguinte), com uma verificação NOVA no contrato: tabela de plataforma com privilégio para o runtime **reprova** a bateria. Armadilha **82** |
| A revogação da migração **funcionava e depois voltava sozinha**: o contrato reprovava de novo logo após o `db:migrate:deploy` | `npm run db:migrate:deploy` termina em `npm run db:rls`, que reexecuta os arquivos de `docker/postgres/init` — e o `GRANT ... ON ALL TABLES` de `00-roles.sql` passa por cima do `REVOKE` da migração. O `initdb` do container só roda no primeiro boot, então o projeto reaplica as policies por script: **quem concede é quem tem de revogar** | O `REVOKE` foi para `00-roles.sql`, logo abaixo do `GRANT` em massa, com guarda de `to_regclass` (na primeira subida do container as tabelas ainda não existem) e o episódio escrito no comentário. Armadilha **83** |
| `npm run db:verify:pooling` **reprovou** o isolamento ("a contagem de eventos sob RLS não corresponde ao tenant") | O script escolhe os dois primeiros tenants por slug e mede; a suíte E2E completa estava rodando **em paralelo** e o `cleanupRun()` apagou um deles no meio da verificação. O isolamento estava íntegro: o que a medição pegou foi **outra suíte mexendo no banco** | Rodado de novo com a árvore parada: `Pooling íntegro`. Armadilha **85** — verificação que compartilha o banco com outra suíte mede o estado da outra suíte |
| Um cenário do E2E de **outra fase** falhou na bateria completa (`content-and-media`, cópia de patrocinador) e passou **isolado**, duas vezes | Não foi regressão: o cenário espera um `<select>` recém-renderizado por um formulário que a própria action revalida. Foi a primeira execução depois de 8 cenários novos entrarem na fila do mesmo worker do Playwright | Registrado como flutuação observada, com a evidência (passa isolado e passa na repetição da bateria completa, que fechou em **123 passed**). Sem "correção" inventada |
| O teste E2E da inspeção comparava o corpo recebido pelo clamd falso com **um** PDF e falhava | A varredura é cross-tenant: o mesmo daemon atende os arquivos pendentes de todas as instituições, e o `received` acumulava os dois PDFs do cenário | A conferência passou a ser "contém", com o porquê escrito — o que se quer provar é que **este** arquivo chegou inteiro (o que prova o enquadramento `INSTREAM`) |
| A fixture de submissão era recusada com "Revise os dados da submissão" e depois com "Decida sem o quórum..." | Três regras do produto que as fixtures não respeitavam: mínimo de **3** palavras-chave, justificativa obrigatória para decidir sem quórum, e o credenciamento vivendo em `registration.checkedInAt` (e não numa linha de `attendance` com `activityId` nulo). O produto estava certo nas três | Fixtures corrigidas, com o porquê em cada arquivo. Mesma classe da armadilha 74: **fixture incoerente com as regras do produto mede a própria fixture** |
| **O cenário de "executar agora" passava sem que o clique fizesse nada** | Ele afirmava "existe uma execução MANUAL concluída" — e o registro de uma execução ANTERIOR satisfazia a afirmação. A repetição da bateria tornou isso visível (o cenário passou a levar 900 ms, sem esperar worker nenhum) | O cenário passou a contar as execuções **antes** do clique e a exigir que o número AUMENTE. Um teste que passa por acidente é pior que um teste vermelho |

---

## 6. Evidência de verificação

### 6.1 Bateria (árvore final)

```text
npm run lint                  → 0 erros, 0 warnings
npm run typecheck             → 0 erros
npm test                      → 83 arquivos · 1865 testes passando (era 74/1772)
npm run build                 → ✓ Compiled successfully, com as rotas novas listadas:
                                ƒ /api/t/[tenantSlug]/certificados/zip
                                ƒ /superadmin/rotinas
npm run db:verify             → Contrato íntegro.
                                (inclui a verificação NOVA: nenhuma tabela de plataforma
                                 alcançável pela role de runtime — sem ela, a fase reprovava)
npm run db:verify:isolation   → 9/9 verificações passaram.
npm run db:partitions         → 29.077 linhas · partições de set/2026 a nov/2026 + as criadas
                                nos testes (2027_03, 2027_04, 2027_05, 2028_07, 2029_05)
npm run db:verify:pooling     → Pooling íntegro: contexto por transação preservado sob PgBouncer.
npx prisma migrate status     → 32 migrations · "Database schema is up to date!"
npm run db:seed               → 2 chamadas publicadas · 1 proposta (protocolo 2026-7P8G) ·
                                1 vaga RETIDA (carla@example.test), prazo 26/09/2026 23:59
npm run registrations:expire  → Liberadas: 0 vaga(s) em 262 instituição(ões) · 0 promoção(ões)
npm run test:e2e              → 123 passed (7 novos desta fase; era 116)
```

**Uma nota de honestidade sobre a bateria.** Na PRIMEIRA execução completa do E2E, o cenário
`copiar um patrocinador de outro evento` (FASE 23/24, outra fase) falhou por tempo de espera do
`<select>` e a bateria fechou em 122 passed / 1 failed. O cenário passa **isolado** (duas vezes)
e as duas execuções seguintes da bateria inteira fecharam em **123 passed / 0 failed** — a
última delas depois de todas as correções da fase. Fica registrado como flutuação observada, e
não como "verde por sorte": o número reportado é o da execução verde, com a anterior declarada.

E o `db:verify:pooling` reprovou uma vez **enquanto a suíte E2E rodava em paralelo** (o script
escolhe dois tenants por slug e o `cleanupRun()` do E2E apagou um deles no meio da medição). Com
a árvore parada: íntegro. Ver armadilha 85.

### 6.2 O painel de rotinas, com dado real

O painel não tem teste de mentira: ele lê `job_runs`. O E2E clica "executar agora" na rotina das
partições, o **worker** (container separado) pega o job, roda de verdade e grava o registro —
e o cenário exige que a contagem de execuções MANUAIS **aumente** e que a linha com
`data-trigger="MANUAL"` e `data-status="OK"` apareça no histórico. É a cadeia inteira: ação →
fila → worker → banco → tela.

O que a árvore tinha no fim da verificação (a rotina de inspeção roda de 5 em 5 minutos pelo
relógio, e as partições foram pedidas pelo painel):

```text
       job        | status | trigger  |         startedAt          | items
------------------+--------+----------+----------------------------+-------
 file-scan        | OK     | SCHEDULE | 2026-09-23 14:25:00.064+00 |     0
 audit-partitions | OK     | MANUAL   | 2026-09-23 14:23:20.128+00 |     0
 file-scan        | OK     | SCHEDULE | 2026-09-23 14:20:00.075+00 |     0
 audit-partitions | OK     | MANUAL   | 2026-09-23 14:18:11.229+00 |     0
 attendance-sweep | OK     | SCHEDULE | 2026-09-23 14:15:00.04+00  |     0
```

### 6.3 Testes novos

| Arquivo | Testes | O que prende |
|---|---|---|
| `tests/unit/file-scan-rules.test.ts` | 16 | os quatro estados e seus rótulos; valor desconhecido vira `PENDING` e **nunca** `CLEAN`; o estado de nascimento (`PENDING` com inspeção, `SKIPPED` sem); o portão nas quatro combinações (incluindo `INFECTED` bloqueado **com a inspeção desligada**); a leitura da resposta do clamd (`stream: OK`, `... FOUND`, e o que **não** é aprovação: vazio, erro, truncado) |
| `tests/unit/zip-writer.test.ts` | 15 | CRC-32 contra o valor publicado pela norma; o *zip slip* em quatro formas; o ZIP lido de volta por um leitor escrito no teste (nome, conteúdo, tamanho, CRC, método `STORE`, diretório central e EOCD); ZIP vazio válido; entrada de 1 byte e de 64 KB; a data da entrada no formato do MS-DOS; os dois tetos do formato; o fluxo web entregando os mesmos bytes |
| `tests/unit/job-catalog.test.ts` | 13 | todo item do catálogo tem rótulo, descrição, cadência e unidade; as três formas de cron lidas e as cinco recusadas; a saúde nas cinco transições (falha > em andamento > atraso com folga de duas passadas > em dia); o prazo da execução órfã |
| `tests/unit/decision-notice-rules.test.ts` | 9 | as três decisões com rótulo e orientação **distintos**; o template no catálogo; o assunto começando pela situação; o parecer literal e escapado; sem parecer, o destaque não vira "null" |
| `tests/integration/job-runs.test.ts` | 12 | a reserva abre o registro com gatilho e autor; **uma execução por rotina**; a execução órfã é encerrada como falha e a rotina volta a rodar; execução **recente** não é reaproveitada; o fechamento é condicional e não sobrescreve; o motivo é truncado; o ciclo completo (`runTrackedJob`) nos três desfechos; a última execução existe para **toda** rotina do catálogo |
| `tests/integration/file-scan.test.ts` | 6 | com um **clamd falso** que fala o protocolo de verdade: o arquivo nasce `SKIPPED`/`PENDING` conforme a configuração; `PENDING` não é servido com a inspeção ligada; o clamd recebe os **bytes** do objeto (o que prova o enquadramento `zINSTREAM`); a ameaça vira `INFECTED` com assinatura na trilha e continua bloqueada **depois** de desligar o antivírus; inspeção indisponível **não é veredito** (fica `PENDING`); só o que está `PENDING` entra na passada |
| `tests/integration/partition-service.test.ts` | 8 | nome e início do mês (com virada de ano); a criação do mês e dos seguintes e a **idempotência**; o teto respeitado; a partição nova nasce com privilégio, **RLS + FORCE e policy**; o **resgate** das linhas que caíram na `DEFAULT`; o relatório sem tropeçar nos índices particionados (o defeito que a CLI pegou na FASE 13) |
| `tests/integration/certificate-zip.test.ts` | 8 | o plano do lote (quem entra, quem fica de fora, o revogado não entra, evento de outra instituição é `NOT_FOUND`); o nome `<código>-<nome-sem-acento>.pdf`; evento sem certificado explica o que falta; a montagem com os PDFs reais do bucket; o nome hostil não escapa; objeto ausente é **pulado** e o ZIP sai válido |
| `tests/integration/proposal-decided.test.ts` | 5 | a decisão avisa nos dois canais com o parecer; a mesma decisão repetida não gera segundo aviso; aceitar depois dos ajustes é um **segundo** fato e avisa de novo; a recusa usa o texto de recusa; o **artigo sem chamada não é avisado** (limite declarado) |
| `tests/unit/email-communication.test.ts` (+1) | 45 | o catálogo de templates enumera 16 → **17**, e o novo renderiza assunto, HTML e texto sem placeholder |
| `prisma/scripts/assert-schema-contract.mjs` (+1 verificação) | — | **seção 10**: nenhuma tabela de `PLATFORM_ONLY_TABLES` tem privilégio para a role de runtime. A verificação nasceu desta fase e foi ela que encontrou a abertura de `job_runs` |
| `tests/e2e/automation-routines.spec.ts` | 4 | a tela é 404 para quem não é da plataforma; as **cinco** rotinas aparecem com cadência em português, saúde e o item de menu; "executar agora" enfileira, o **worker** roda e a contagem de execuções manuais **aumenta**; o pedido fica na trilha de plataforma (com a chave em `changes`, porque `entityId` é uuid) |
| `tests/e2e/certificate-batch.spec.ts` | 3 | o participante pede o certificado e o **worker** gera o PDF; a equipe baixa o lote do evento e o ZIP contém o PDF com o nome certo; o lote é auditado; **sem** evento escolhido a tela não oferece o botão; quem não tem `certificate:issue` recebe 403; evento sem certificado recebe 409 com a explicação |

### 6.4 Testes existentes que precisaram mudar (e por quê)

| Arquivo | Mudança | Motivo |
|---|---|---|
| `tests/unit/email-communication.test.ts` | catálogo de 16 para **17** templates, com payload de exemplo | O teste enumera o catálogo de propósito: template novo sem exemplo **quebra** ali |
| `tests/integration/registration-confirmation.test.ts` (FASE 34) | nenhuma mudança necessária | A extração de `deliverNotice` (ADR-190) foi coberta pelos testes que já existiam — era exatamente o que se queria provar |

---

## 7. Comandos operacionais

```bash
# ── AS ROTINAS (painel de governança) ────────────────────────────────────────────
# /superadmin/rotinas
#   → as cinco rotinas, com cadência, saúde, última passada, resultado e observação
#   → "Executar agora" (enfileira; quem roda é o worker)
#   → histórico das 40 passadas mais recentes, com gatilho e host

# ── A INSPEÇÃO DE ARQUIVOS (opcional, desligada por padrão) ──────────────────────
docker compose --profile av up -d clamav     # sobe o daemon (perfil próprio)
# e então, no .env:
#   SCAN_DRIVER=clamav
#   CLAMAV_HOST=clamav        (dentro do compose)  |  localhost (fora dele)
#   CLAMAV_PORT=3310
docker compose --profile app up -d --build web worker   # os dois precisam da variável
# Sem clamav: SCAN_DRIVER=none (padrão) → os arquivos nascem SKIPPED e são servidos.

# ── AS PARTIÇÕES DA AUDITORIA ────────────────────────────────────────────────────
npm run db:partitions        # a CLI (quem opera sem worker); o worker roda às 3h

# ── O LOTE DE CERTIFICADOS ───────────────────────────────────────────────────────
# /t/<slug>/administracao/certificados → escolha o EVENTO no filtro
#   → "Baixar todos em ZIP"  → /api/t/<slug>/certificados/zip?evento=<eventId>

# ── O BANCO: o que as rotinas fizeram ────────────────────────────────────────────
psql "$DATABASE_URL" -c '
  SELECT job, status, trigger, "startedAt", "finishedAt", items, left(error, 80) AS erro
    FROM job_runs
   ORDER BY "startedAt" DESC LIMIT 20'

# A ameaça detectada (a trilha guarda o arquivo, a assinatura e a referência):
psql "$DATABASE_URL" -c '
  SELECT "entityType", "entityId", changes, "createdAt"
    FROM audit_logs
   WHERE action = ''UPDATE'' AND changes ? ''ameaca''
   ORDER BY "createdAt" DESC LIMIT 20'

# ── O AVISO AO PROPONENTE ────────────────────────────────────────────────────────
psql "$DATABASE_URL" -c '
  SELECT template, status, "dedupeKey", "to"
    FROM email_messages
   WHERE template = ''PROPOSAL_DECIDED''
   ORDER BY "createdAt" DESC LIMIT 20'
```

---

## 8. Dívidas técnicas e pontos de atenção

**Quitadas nesta fase**

* **A3 — inspeção antivírus.** A coluna `scanStatus` existia desde a migração inicial e era
  gravada como `SKIPPED` com o comentário certo ("não afirmar algo que não verificamos"). Agora
  há driver, rotina, portão nos dois caminhos que servem bytes de terceiro e trilha da ameaça.
* **E47 — o proponente não era avisado da decisão.** Fechado para a proposta de **chamada**;
  o artigo do fluxo acadêmico continua acompanhando pela tela de submissões (limite declarado
  na ADR-189).

**Pontos de atenção (declarados, não esquecidos)**

* **E46 (antiga)** — a proposta não aceita anexo; quando aceitar, o caminho da inspeção precisa
  cobrir o anexo da proposta também.
* **`media_assets` fica fora do portão.** O bucket é de leitura pública e a imagem não passa
  pelo processo; a validação de assinatura real (FASE 17) é o que existe ali.
* **B8 (retenção das partições)** continua aberta: a manutenção **cria** e nunca **apaga**.
  Apagar partição é decisão de negócio (quanto tempo de auditoria a instituição precisa guardar).
* **Zip64 fora de escopo.** O lote é o formato clássico: até 60.000 arquivos e 4 GB por arquivo,
  com recusa legível acima disso.
* **A inspeção não roda dentro do upload.** Com o driver ligado, o arquivo fica invisível ao
  comitê até a passada (de 5 em 5 minutos) dar o veredito. Inspecionar na hora exigiria o
  conteúdo passando pela aplicação, que é justamente o que a FASE 4 evitou.
* **A fila das rotinas é a mesma dos e-mails.** Uma varredura longa atrasa e-mails (e o
  contrário). Foi decisão de simplicidade: as varreduras são limitadas por lote e a fila tem
  concorrência 4.

---

## 9. Checklist de aceite

| Requisito do humano | Situação |
|---|---|
| **Agendamento de tarefas automáticas** com histórico e operação | ✅ `job_runs` + `/superadmin/rotinas` + "executar agora" (ADR-183/184/186) |
| **Liberação automática de vagas expiradas** | ✅ já existia (FASE 34); agora **registrada** em `job_runs`, com exclusão mútua e reaproveitamento da execução órfã |
| **Manutenção e criação de partições do PostgreSQL** | ✅ virou serviço do worker (`audit-partitions`, diário às 3h) e a CLI continua para quem opera sem worker (ADR-183, §3.3) |
| **Varredura diária de prazos de pareceres e avisos** | ✅ já existia; agora registrada e visível, com a cadência em português no painel |
| **Fechamento de presenças em aberto no balcão** | ✅ já existia; agora registrado, com a unidade do que ele conta ("sessões fechadas") no painel |
| **Varredura de Antivírus (ClamAV)** | ✅ driver com padrão em NÃO inspecionar, rotina a cada 5 minutos, portão nos dois caminhos, trilha da ameaça, perfil `av` no compose (ADR-187) |
| **Exportação de Certificados em Lote (.ZIP)** | ✅ rota por evento, escrita à mão, montada em fluxo, com trilha `EXPORT` e botão na tela (ADR-188) |
| **Aviso de Decisão na Chamada de Propostas (CFP)** | ✅ template `PROPOSAL_DECIDED`, aviso ao proponente nos dois canais, fora da transação, só para proposta de chamada (ADR-189) |
| **Painel das rotinas em `/superadmin`** | ✅ com catálogo, saúde, histórico e execução manual |
| Português em código, comentários, mensagens, UI e documentação | ✅ |
| Testes (unitários, integração e E2E) e documentação da fase | ✅ 101 novos no Vitest + 8 E2E · este documento |
| Bateria da seção 4 do `AGENTS.md` com números reais | ✅ §6.1 |

---

## 10. O que fica para a FASE 37 (já combinado com o humano)

* **Impressão de crachás em papel adesivo** (folhas Pimaco, com os modelos reais a informar) e
  **impressão térmica em ZPL** (marca/modelo da impressora a informar) — hoje existe a folha A4
  para recortar (dívidas E41/E42).
* **Confirmação por item individual de exigência** (dívida **E48**): hoje a exigência é um
  checklist que a equipe marca como um todo; a F37 registra **item por item** e, quando todos os
  itens obrigatórios estiverem recebidos, a vaga se confirma sozinha.
