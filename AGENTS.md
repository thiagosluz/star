# AGENTS.md — Protocolo de trabalho do EventFlow

> **Este arquivo é o primeiro que uma sessão de agente deve ler.**
> Ele existe porque a memória durável deste projeto é o **repositório**, não a
> conversa: uma sessão nova não lembra de nada do chat anterior, mas encontra aqui o
> combinado de como trabalhar, o que verificar e onde as coisas estão.

---

## 1. O que é este projeto

**EventFlow** — plataforma SaaS multi-tenant para eventos acadêmicos, corporativos e
comunitários: eventos e inscrições, submissão de trabalhos com avaliação por pares,
gamificação (XP, cartas, missões) e certificação com validação pública por QR Code.

**Estado atual:**

```text
Fases concluídas ........ 1 a 17, 21, 22, 23, 25, 29, 30, 31 e 32 (F15, F21, F22, F29, F30, F31 e F32 entregues; a F18+ é a próxima)
Testes ................. 1638 (Vitest: unit + integração) + 107 (Playwright E2E)
ADRs ................... 157 (numeração GLOBAL e sequencial — a próxima é ADR-158)
Permissões ............. 60 (11 papéis, 4 escopos)
Tabelas de tenant ...... 40 sob RLS + FORCE (+ as partições mensais de audit_logs)
Qualidade .............. ESLint 0 · tsc 0 · next build OK
```

Stack: Next.js 16 (App Router, Server Actions) · React 19 · PostgreSQL 18 com
Row-Level Security · Prisma 7 · Redis + BullMQ · MinIO · Tailwind 4 · Vitest · Playwright.

---

## 2. O PROTOCOLO DE FASES (leia antes de escrever código)

O projeto é construído em **fases numeradas**, com um contrato rígido:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. O humano define a fase (requisitos, entregáveis obrigatórios).          │
│  2. O agente entrega a fase COMPLETA:                                       │
│        • código (domínio → aplicação → interface)                           │
│        • testes (unitários + integração + E2E)                              │
│        • documentação em docs/fase-NN-*.md                                  │
│        • comandos exatos de verificação                                     │
│  3. O agente PARA e escreve: "Aguardando APROVADO: AVANÇAR".                │
│  4. Só com a string literal "APROVADO: AVANÇAR" a próxima fase começa.      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Regras que não se negociam:**

- **Nunca** gerar o sistema inteiro de uma vez, nem "adiantar" partes da fase
  seguinte sem autorização.
- **Nunca** iniciar uma fase nova sem a string de aprovação da anterior — mesmo que
  o pedido pareça implícito ("e agora?").
- Se a fase for interrompida (falha, reinício da máquina), **retomá-la e concluí-la**
  antes de qualquer outra coisa.
- Ao terminar: rodar a bateria de verificação da seção 4 e **reportar os números
  reais**, não os esperados.

### Documento de fase — estrutura esperada

`docs/fase-NN-<tema>.md` deve conter:

1. Sumário executivo com **tabela de entregas** e **números da fase** (arquivos,
   testes, migrações).
2. O problema mais difícil da fase e por que ele define o desenho.
3. Decisões técnicas explicadas (o "porquê", com alternativas descartadas).
4. **ADRs** — contexto, decisão, justificativa, consequências. Numeração global.
5. **Lições aprendidas** — tabela de defeitos REAIS encontrados por testes, com
   sintoma → causa raiz → correção. Sem inventar: só o que aconteceu.
6. **Evidência de verificação** — saída real dos comandos.
7. Comandos operacionais.
8. **Dívidas técnicas** e pontos de atenção.
9. **Checklist de aceite** com todos os requisitos marcados.

Depois de criar/atualizar uma fase, **atualizar o `README.md`**: índice da
documentação, capacidades e contagens.

---

## 3. Convenções de código

| Regra | Detalhe |
|---|---|
| **Idioma** | Português em código, comentários, mensagens de erro, documentação e UI (produto para instituições brasileiras) |
| **Comentários** | Explicam **POR QUE**, nunca "o que". O código já diz o que faz. Comentário que só repete o código é ruído — e é removido |
| **Domínio puro** | `src/domain/**` não importa Prisma nem Next. Regras são funções puras, testáveis sem infraestrutura |
| **Sem `any`** | Tipos explícitos; uniões de string espelham os enums do schema (o domínio não importa o ORM) |
| **Erros como valor** | Serviços devolvem `{ ok: true, ... } | { ok: false, code, message, details? }` — não lançam para o chamador |
| **Comentários de bloco** | Decisões não óbvias ganham um bloco `// ───` explicando a armadilha evitada |
| **Nomes de arquivo** | `kebab-case.ts`; domínio em `src/domain/<área>/<área>-rules.ts` |
| **Seed** | `prisma/seed.ts` executa os **serviços reais** (não grava à mão) para que o dado de demonstração nasça consistente |

---

## 4. Bateria de verificação (rodar SEMPRE antes de declarar concluído)

```bash
npm run lint          # esperado: 0 erros, 0 warnings
npm run typecheck     # esperado: 0 erros
npm test              # esperado: 1638+ testes passando
npm run build         # esperado: "Compiled successfully" e a rota nova listada
npm run db:verify     # esperado: "Contrato íntegro."
npm run db:verify:isolation   # esperado: "9/9 verificações passaram."
npm run db:partitions         # esperado: partições do mês atual e dos seguintes já criadas

# Pooling (opcional, exige o perfil `pooler` no ar):
docker compose --profile pooler up -d pooler
npm run db:verify:pooling     # esperado: "Pooling íntegro: contexto por transação preservado sob PgBouncer."

# E2E exige o container rodando o código NOVO:
docker compose --profile app up -d --build web
docker images | grep eventflow/web        # conferir que a imagem é recente
npm run test:e2e      # esperado: 107+ testes passando
```

**Armadilha crítica de verificação:** se o `--build` falhar, o `docker compose`
**mantém o container anterior no ar** e o E2E passa a medir código que não existe.
Um `docker compose ps` dizendo "healthy" **não prova** que a imagem é a nova. Por
isso: (a) leia a saída completa do build, (b) confirme a data da imagem,
(c) confirme que a rota nova responde (307/200, não 404).

---

## 5. Armadilhas conhecidas (custaram depuração real)

> **A tabela COMPLETA — 72 armadilhas, cada uma com sintoma, causa raiz e correção — vive em
> [`docs/armadilhas.md`](docs/armadilhas.md).** Ela saiu deste arquivo para o protocolo caber
> no orçamento de leitura de uma sessão nova (o `AGENTS.md` era truncado no fim, escondendo a
> seção 10). Os números são estáveis e citados no código e nos documentos de fase — não
> renumere. **Antes de mexer numa área, procure ali o que já quebrou nela.** Abaixo ficam as
> mais recentes, que são as que uma sessão nova tem mais chance de repetir.

| # | Armadilha | Regra |
|---|---|---|
| 61 | **O build da imagem TRAVAVA no estágio do worker** (dez minutos no mesmo passo) e, quando destravava, o `next build` caía com "Failed to fetch Inter from Google Fonts" | O passo de build **não alcança o registro npm** (um `wget` ao `registry.npmjs.org` dentro de um `RUN` estoura o tempo, embora funcione de um `docker run` comum); `npx` e o Prisma sondam a rede antes de rodar; e o `npm install tsx` do worker, além de instalar, **consertava** o `node_modules` parcial do `.next/standalone` — traço do Next sem `ioredis`, com `bullmq` pela metade e `dotenv` sem `package.json` | O build não depende mais da rede: o `tsx` é **copiado** do estágio `deps`, o worker usa a **árvore de produção completa** (`npm prune --omit=dev --offline`, que só REMOVE), o Prisma é chamado por caminho com `CHECKPOINT_DISABLE=1`, e uma **prova de boot** no build recusa `ERR_MODULE_NOT_FOUND`. As fontes do `next/font` seguem sendo a única dependência externa: **repetir o build é a resposta, não mexer no código** |
| 62 | **Um teste E2E falhou e os três seguintes falharam com sintomas sem relação com ele** ("não há lista publicada", "o painel não lista sorteio nenhum", contagem de elegíveis zerada) | **Depois de um teste que falha, o Playwright reinicia o worker** — e o sufixo único do arquivo (`RUN_ID`) é gerado no carregamento do módulo. O worker novo roda o `beforeAll` outra vez e cria uma fixture NOVA (instituição, evento e contas diferentes), **sem os dados que os cenários anteriores deixaram** | Cenário E2E que precisa de dado **monta o próprio dado**, ou afirma a premissa em voz alta (a falha então diz o que faltou). E, ao depurar, imprima o IDENTIFICADOR (`eventId`, `tenantId`), não o conteúdo: quando dois testes seguidos discordam sobre o banco, o que mudou foi o contexto |
| 63 | O telão do sorteio ficou 30 s em "aguardando" **com o sorteio já apurado no banco**, sem receber nenhum evento | A rota do fluxo calculava o estado uma vez, na abertura da conexão, e só reamostrava a contagem de elegíveis: o cliente recebia para sempre a fotografia do carregamento | O estado passou a ser **relido a cada amostra**, e o fluxo para de amostrar quando o sorteio deixa de ser rascunho. **Fluxo ao vivo que reporta um campo que não relê não é ao vivo** |
| 64 | **`npx prettier --write` reescreveu o estilo de um arquivo inteiro** (`raffle-service.ts`): ~2.000 linhas de diff, aspas simples virando duplas e objeto de uma linha virando sete | O repositório **não tem configuração de prettier**, então o comando aplicou o PADRÃO da ferramenta (aspas duplas, largura 80) sobre um projeto que usa outro estilo. O formatador do projeto é o **ESLint** (`npm run lint`) — o prettier nunca fez parte da esteira | Se a intenção é formatar, use **as flags do projeto** (`npx prettier --single-quote --print-width 110 <arquivo>`) e **confira o diff**: o jeito barato de descobrir o estilo real é formatar a versão do `HEAD` do mesmo arquivo com as flags candidatas e contar as linhas que mudam (com essas, foram 3 em vez de 2.000) |
| 65 | A auditoria de um sorteio novo mostrava **"Trilha: —"** na rodada 1: sem data e sem autor do compromisso | A página lê a procedência do compromisso no registro `CREATE` da **RODADA**, mas a rodada 1 nasce em `createRaffle`, e aquele caminho gravava só o registro do SORTEIO — o registro da rodada existia apenas para as rodadas criadas depois, por `prepareRound`. A prova existia; a procedência dela, não | Quando uma entidade nova passa a ser a fonte de um dado (o compromisso saiu da raffle para a rodada), **todos os caminhos que criam essa entidade precisam gravar o registro dela** — inclusive o mais antigo, que é o que ninguém revisita. Teste de integração prende `commitmentRecordedAt`/`commitmentRecordedBy` de cada rodada |
| 66 | O E2E do telão passava, e **a funcionalidade que ele descrevia não existia na interface**: o sorteio só era alcançável já apurado | O cenário montava o rascunho por escrita direta no banco (`tx.raffle.create({ status: 'DRAFT' })`) e testava a PÁGINA — o **caminho que produz aquele estado** (um botão que cria sem apurar) não existia, e nenhum teste olhava para ele | Cenário que precisa de um estado deve produzi-lo **pelo caminho que a pessoa usa** quando é esse caminho que está sob suspeita. Fixture por escrita direta isola a tela, mas **não é evidência de que a tela é alcançável** — e o buraco entre "a página funciona" e "dá para chegar nela" é onde o produto fica sem a funcionalidade |
| 67 | **Um campo que TODO MUNDO lê e NINGUÉM escreve**: `Registration.badgeToken` era usado pela fila, pelo check-in por crachá e pelos testes, e nenhum caminho do sistema o gerava | O fluxo do crachá só funcionava com dado gravado à mão: o teste escrevia o token na fixture, o seed escrevia o token, e o produto não tinha emissão. Mesma classe do telão que nascia sorteado (66) | A FASE 31 criou a emissão real e o seed passou a usá-la. **Ao achar um campo misterioso no schema, pergunte quem ESCREVE nele** |
| 68 | A **segunda visita** à mesma atividade não abria sessão: a pessoa saía para o almoço e a tarde dela desaparecia da conta de minutos | O caminho de entrada chamava `checkIn`, idempotente por `registration.checkedInAt` — certo para a chegada ao evento, errado para a frequência, que se repete | `checkIn` só na primeira vez; depois, a sessão é criada pelo serviço de crachá. **Comando idempotente usado para um fato que se repete tem a chave errada**: a chave da frequência é a sessão aberta |
| 69 | **Dois nomes de segmento dinâmico no mesmo nível derrubam o build**: *"You cannot use different slug names for the same dynamic path ('eventSlug' !== 'eventId')"* | Já existia `/api/t/[tenantSlug]/eventos/[eventSlug]/...` e a rota nova nasceu com `[eventId]` ali. O erro é da árvore inteira, não da rota nova | A rota foi para o namespace da própria tela, com o evento por parâmetro validado no banco. **Antes de nomear um segmento dinâmico, olhe como o mesmo nível é nomeado no resto da árvore** |
| 70 | `npm run lint` recusou a página com *"Cannot call impure function during render: `Date.now`"* | O React Compiler trata o corpo do Server Component como render, e a tela precisava de "agora" para sugerir a atividade em curso | O instante passou a vir do **relógio do banco** (`SELECT now()`), o mesmo que carimba as presenças. **Relógio do processo no lugar de dado** é impureza no render — e o relógio certo é o de quem grava |
| 71 | **O crachá LEGADO deixou de ser encontrado** no balcão: o E2E da jornada da plataforma (FASE 7) reprovou dizendo que o crachá não existia, enquanto todos os testes da fase passavam | A busca montava os candidatos como `[normalizado, raw.toUpperCase()]`. Normalizar serve para o código NOVO (`CR-…`, que é nosso), mas o token da coluna antiga é **string opaca**: `badge-plat-a1b2c3` virava `BADGE-PLAT-A1B2C3` e a linha nunca casava. O caminho legado estava documentado e **nenhum teste olhava para ele** | O candidato na **caixa exata** entrou na busca, com o porquê no código, e um teste de integração novo prende o token de caixa mista — verificado nos dois sentidos: sem a correção reprova, com ela passa. **Identificador opaco não se normaliza**: a etiqueta impressa é lida letra por letra |
| 72 | **A própria pessoa recebia "permissão negada"** ao pedir o próprio recurso: o botão "Marcar como lida" não fazia nada (nem erro na tela), e o "Gerar meu crachá" da FASE 31 estava quebrado do mesmo jeito, sem teste que clicasse nele | `guardAction` chamava `can(permissão, { scope })` **sem passar o dono** — e `can()` recusa permissão `:own` sem `ownerId` (fail-closed, invariante nº 4). A guarda de PÁGINA já resolvia isso desde a FASE 25; a de ACTION ficou com metade da lição, e o defeito era silencioso | `guardAction` passa `ownerId: user.id` para permissões `:own` (o dono do RECURSO continua sendo conferido no serviço, com o id do banco), e o cenário E2E que só olhava a tela passou a **clicar no botão**. **Guardas gêmeas precisam da mesma regra, e botão sem clique é caminho sem teste** |

---

## 6. Ambiente e acesso

```bash
cp .env.example .env
npm install
docker compose up -d            # postgres, redis, minio (+ provisionamento de buckets)
npm run db:setup                # migrate + rls + verify + isolation + seed
npm run dev                     # http://localhost:3000
docker compose --profile app up -d --build   # + web e worker (certificados e e-mails)
docker compose --profile pooler up -d pooler # + PgBouncer (opcional, porta 6432)
```

Portas: **3000** app · **5432** postgres · **6379** redis · **9000/9001** MinIO ·
**6432** PgBouncer (perfil `pooler`, opcional).

### Observabilidade (FASE 13)

`/api/metrics` expõe métricas no formato Prometheus. **Sem `METRICS_TOKEN` definido,
em produção, o endpoint responde 404** — de propósito. Em desenvolvimento responde
200 sem token, para inspeção local. As métricas são **por processo** (o coletor soma):
o Proxy conta requisição por rota/método/status (com o slug do tenant virando
curinga), e o scrape lê `getJobCounts()`/`getWorkersCount()` do BullMQ para saber
tamanho da fila e se o worker está vivo. O log estruturado (`src/lib/observability/logger.ts`)
redige senha/token e mascara e-mail; o worker de fila loga job iniciado, concluído e
falhado com `certificateId`, `tenantId` e duração.

### PgBouncer (FASE 13)

Pool em modo **transação**: seguro aqui porque o contexto de tenant é `SET LOCAL`
(invariante nº 2) e o projeto não usa recurso de sessão (advisory lock,
`LISTEN`/`NOTIFY`, prepared statement nomeado). Para o runtime usá-lo, aponte
`APP_DATABASE_URL` para a porta 6432. Prova automatizada: `npm run db:verify:pooling`.

### Partições da auditoria (FASE 13)

`audit_logs` é particionada por mês em `createdAt`, com partição `DEFAULT` para que
gravar auditoria nunca falhe. **Agende `npm run db:partitions`** (host/cron): ele cria
o mês atual e os seguintes e resgata linhas que caíram na `DEFAULT`. Retenção é
`DROP TABLE audit_logs_<AAAA_MM>` — decisão de negócio, ainda em aberto (dívida B8).

### Quotas e planos (FASE 14)

O plano da instituição define **três** quotas, e `planQuotas(plan)` é a fonte única
(o provisionamento já nasceu errado uma vez por não gravar `maxStorageBytes`):
eventos, **membros da equipe** e armazenamento — **todas aplicadas** desde a FASE 21.
A quota de membros conta vínculos `kind = MEMBER` com situação `ACTIVE` ou `INVITED`
— **participante de evento não consome quota**, senão um evento de 300 pessoas
estouraria o plano gratuito sozinho.

```
Painel de governança ....... /superadmin/tenants/<id>  → "Plano e quotas" e "Vincular membro"
Instituição ................ /t/<slug>/administracao/equipe  (tenant:member:invite)
```

Vincular quem **já tem conta** é ato de PLATAFORMA (`addTenantMember`), e é onde a quota
é aplicada; convidar quem não tem conta é a F15 (Comunicação), porque exige e-mail e
prova de posse do endereço. `MembershipKind` (`MEMBER` × `PARTICIPANT`) é o que separa
equipe de público — regra pura em `src/domain/tenancy/membership-rules.ts`, com a
mesma função usada pela migração de backfill e pelo seed de teste.

### Membros e armazenamento (FASE 21)

A FASE 14 vinculava membro; a FASE 21 fecha o ciclo — **trocar papéis** e **remover** pela
tela de equipe, e a quota de armazenamento **aplicada** de verdade em todo envio.

```
Equipe ................. /t/<slug>/administracao/equipe  → coluna "Ações" (papéis e remoção)
Armazenamento .......... /t/<slug>/administracao         → seção "Armazenamento"
```

Quatro regras que quebram fácil: **a decisão de papéis recebe `RoleRef = { role, scope }`**,
nunca só o NOME do papel — `REVIEWER` por EVENTO tem o mesmo nome do papel de instituição e
seria revogado em silêncio (ADR-132 / armadilha 52); **a remoção é LÓGICA** (`status =
'REMOVED'` + `deletedAt`, com **todas** as concessões revogadas por `revokedAt`, em qualquer
escopo) e as guardas são conferidas **nesta ordem**: SELF antes de LAST_OWNER, senão quem se
remove por último recebe a mensagem errada (ADR-133); **a quota mede TUDO o que a instituição
guarda** — submissão, mídia, material de palestrante e certificado — e **bloqueia só o
upload novo**, nunca a emissão de certificado: o documento do participante não pode depender
da decisão de armazenamento da instituição (ADR-131); e a conferência acontece **antes de
assinar a URL de upload** nos três caminhos (submissão, mídia, material), com desconto do
arquivo substituído no rascunho — código `QUOTA_EXCEEDED`.

**Manter o RBAC como está é decisão, não esquecimento:** `OWNER` tem `tenant:role:assign`,
`ADMIN` só tem `tenant:member:remove`. Trocar papéis é ato de dono; a tela esconde o que a
action recusaria.

### Salas e vagas (revisão da FASE 3)

A sala ganhou ciclo de vida próprio e passou a ser o **teto das vagas** da atividade que
acontece nela.

```
Salas .................. /t/<slug>/administracao/eventos/<eventId>  → seção "Salas"
                         (cada linha: "Editar sala" e "Excluir")
Vagas da atividade ..... mesma tela → seção "Programação" → "Vagas"
```

Quatro regras que quebram fácil: **a capacidade é OPCIONAL e vazio significa "sem limite"**
(`null`; `0` e negativo são normalizados na escrita — a coluna nasceu com `DEFAULT 0`, que
fazia a sala afirmar "zero lugares"); **o limite EFETIVO da atividade é o menor entre a
lotação declarada e a sala** (`effectiveActivityCapacity`), e é ele que a página pública
anuncia e que a mensagem de lotação usa; **a sala entra no predicado ATÔMICO da reserva de
vaga** (`RESERVE_ACTIVITY_SEAT_SQL` + `ROOM_SEAT_AVAILABLE_PREDICATE`, ADR-135) — uma
checagem em JavaScript antes do `UPDATE` reabriria a janela de superlotação sob concorrência;
e **a sala em uso recusa a exclusão**, com a contagem e o caminho (trocar a sala das
atividades) — a FK é `ON DELETE SET NULL` e sem a guarda a sala sumiria da programação em
silêncio (ADR-136).

**Atividade ABERTA é a exceção deliberada:** ela recebe quem se inscreveu no evento e não tem
fila, então o teto da sala não a bloqueia — o painel **avisa** quando o público excede a sala
(dívida E34). Negar acesso em silêncio a quem já está inscrito seria pior que o aviso.

### Palco e auditoria (FASE 29)

O sorteio deixou de ser uma promessa auditável: a **lista publicada** passou a ser
gravada e assinada, o **telão** mostra o compromisso antes da apuração e a **auditoria**
refaz as contas no navegador de quem lê.

```
Telão ................... /t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>/palco
Auditoria ............... /t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>/auditoria
Ao vivo (público) ....... GET /api/t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>/ao-vivo (JSON **ou** SSE)
Link + QR do telão ...... /t/<slug>/administracao/eventos/<eventId>/sorteios → "Palco e auditoria"
Conferir fora do site ... npx tsx prisma/scripts/audit-raffle.ts --semente <hex> --lista lista.json
```

Cinco regras que quebram fácil: **a seleção do sorteio vive em `draw-selection.ts`, sem
import de runtime**, e é ela que o servidor E o navegador usam — reimplementar no cliente
faria a auditoria validar outra regra; **o documento canônico da lista é
`[{ index, code, minutes }]`** (o `userId` fica fora do hash: não decide o sorteio);
**o payload do resultado é versão 4 desde a FASE 30**, com o hash da lista e o NÚMERO DA
RODADA assinados (a 3, a 2 e a 1 seguem verificáveis, cada uma no seu formato); **o código público (`P-…`) é derivado de
(sorteio, participante)** e é o que liga a linha da lista à posição do ganhador; e **a
auditoria declara o que NÃO prova** — o compromisso amarra a semente, não a lista, porque
o credenciamento continua até a apuração (dívida E36). O telão é público desde a criação
(dívida E37) e **não relaxa a privacidade**: o nome chega mascarado do servidor.

### Sorteio ao vivo, em rodadas (FASE 30)

O sorteio deixou de ser UM momento: cada apuração é uma **rodada**, com o próprio
compromisso de semente, o próprio prêmio, o próprio patrocinador e o próprio resultado
assinado. Quem ganhou uma rodada não concorre nas seguintes.

```
Painel .................. /t/<slug>/administracao/eventos/<eventId>/sorteios
                           → "Criar para o palco" (não apura), "Preparar próxima rodada",
                             "Sortear a rodada N" e a lista de rodadas do sorteio
Telão ................... mesmo endereço: anuncia a rodada em cartaz, ROLA a roleta com
                           os nomes da lista publicada e para no ganhador
Auditoria ............... uma seção por rodada (compromisso, lista e reprodução de cada)
```

Cinco regras que quebram fácil: **cada rodada tem a PRÓPRIA semente** — revelar a da rodada
1 entregaria os ganhadores da 2 a quem lesse o telão (ADR-144); **as POSIÇÕES continuam entre
as rodadas** (a rodada 2 entrega a 2ª posição do sorteio, e a entrega do prêmio é por
`positionId` desde a FASE 16); **o prêmio e o patrocinador são ANÚNCIO e ficam FORA do
documento assinado** — corrigir o texto não pode invalidar um resultado publicado (ADR-145),
e há teste unitário prendendo isso; **a roleta é apresentação, não sorteio**: ela passa os
nomes REAIS da lista publicada daquela rodada, depois de o servidor assinar o resultado
(ADR-146), e uma rodada sem lista publicada revela direto em vez de inventar nomes; e **uma
rodada preparada por vez** — dois compromissos no ar deixariam o telão sem saber o que
anunciar.

A rodada 1 do histórico foi **copiada** pela migração para `raffle_rounds`, com os mesmos
valores que estavam em `raffles`: as colunas de semente/lista do sorteio são **legado
congelado** desde então, e a fonte de verdade é a rodada. O fluxo ao vivo assina por RODADA
(`pendingRound`/`lastDrawnRound`), porque o status do sorteio fica `DRAWN` para sempre depois
da primeira apuração.

### Credenciamento por crachá (FASE 31)

O crachá passou a existir de verdade — a coluna `registrations.badgeToken` era **lida por todos
e escrita por ninguém** (não havia emissão) — e o sistema separou dois fatos que estavam
misturados: **chegar ao evento** e **estar na atividade**.

```
Crachás ................. /t/<slug>/credenciamento/crachas?evento=<eventId>
                           → emitir (individual/em massa), imprimir a folha, revogar
Folha em PDF ............ /api/t/<slug>/credenciamento/crachas/folha?eventId=<id>
                           → A4, 8 por página: QR + CÓDIGO do crachá + NOME
Balcão (modo monitor) ... /t/<slug>/credenciamento?evento=<eventId>
                           → contexto (portaria × atividade) + câmera/leitor USB/digitação
Crachá do participante .. /t/<slug>/meu-cracha?evento=<eventId>
```

Cinco regras que quebram fácil: **o crachá é da PESSOA no evento**, um código por par
(evento, pessoa) em `event_credentials`, e é o **CONTEXTO da leitura** que decide onde o fato
é gravado (ADR-148) — a inscrição é por pessoa × evento E por pessoa × atividade, e com o
código na inscrição quem tivesse evento + 2 minicursos teria três crachás; **chegada é
diferente de frequência** (ADR-149): a portaria grava presença com `activityId` nulo (e marca a
inscrição, onde vivem o XP e a fila), a atividade grava **uma sessão por visita**, com entrada,
saída e minutos — e a chave de idempotência da frequência é a SESSÃO, nunca a inscrição (usar
`checkIn` na segunda visita respondia "já credenciado" e a tarde da pessoa desaparecia);
**os minutos têm teto no fim da ATIVIDADE** (ADR-150), porque a conta antiga premiava o
esquecimento e é ela que pesa no sorteio e compõe o certificado; **leitura fora da inscrição
registra e AVISA** (ADR-151) — a presença de quem apareceu sem inscrição é um fato real, e o
que não acontece sem inscrição é XP, porque não há chave para creditar; e **o QR carrega só o
código** (ADR-152), sem dado pessoal — a etiqueta leva nome e código porque é lida por GENTE.

Duas decisões de operação: a câmera tenta a **API nativa** do navegador e cai para o `jsqr`
local (Firefox e Safari não têm `BarcodeDetector`), com o leitor USB e a digitação como
caminhos de volta; e quem esquece de registrar a saída é fechado no **fim da atividade** pela
varredura do worker (ou pelo botão do painel), com o MESMO número sempre.

### Central do participante (FASE 32)

A instituição só via pessoas **por evento**; esta fase deu a visão da PESSOA — e um canal de
comunicação com ela dentro da plataforma.

```
Diretório ............... /t/<slug>/participantes?busca=&evento=&certificado=1&presente=1&pagina=
                           → abrir ficha · enviar recado (seleção) · exportar CSV
Ficha 360 ............... /t/<slug>/participantes/<userId>
Panorama ................ /t/<slug>/panorama?periodo=ALL|30D|90D|YEAR|CUSTOM&de=&ate=
Caixa de entrada ........ /t/<slug>/minhas-mensagens        (participante)
Exportação CSV .......... /api/t/<slug>/participantes/exportar?<mesmos filtros>
```

Cinco regras que quebram fácil: **quem é participante é uma UNIÃO** (vínculo `PARTICIPANT` ∪
qualquer inscrição) — olhar só um lado esconde gente real —, e a ficha confere o pertencimento
antes de ler qualquer seção (o `user` é global: a RLS não o protege); **a leitura da ficha entra
na trilha** (`AuditAction.READ`, criada aqui) e o e-mail sai **mascarado na lista**, completo só
na ficha, que é a decisão de olhar uma pessoa; **o recado é o FATO e o e-mail é consequência** —
a mensagem nasce em `participant_messages` e o e-mail sai pelo outbox com `dedupeKey` derivado do
ID DA MENSAGEM, então falha de provedor não apaga a comunicação e dois recados com o mesmo
assunto continuam sendo dois fatos; **a caixa de entrada é aberta por POSSE** (o `userId` vem da
sessão, nunca do formulário) enquanto ENVIAR exige `participant:message` no escopo da
instituição; e **`null` não é `0`** — taxa de comparecimento e média de minutos vêm `null` sem
denominador, e a tela mostra "—" em vez de inventar 0% para quem não teve oportunidade.

A visão geral é a única tela que usa `tenant:analytics:read`, permissão que existia desde a
FASE 2 sem consumidor. E a guarda das Server Actions passou a tratar permissão `:own`
(armadilha 72).

### Operação de palco (FASE 22)

O sorteio ganhou o que a OPERAÇÃO pede — e o tema de sorteios fechou: as seis dívidas
(G8–G13) foram quitadas.

```
Painel .................. /t/<slug>/administracao/eventos/<eventId>/sorteios
                           → filtro do histórico, "Desfazer" entrega, situação do chaveiro
Resultado público ....... /t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>
Prévia ao vivo .......... GET /api/events/<eventId>/raffle-live (JSON **ou** SSE)
Reconhecimento .......... mesmo painel do evento → quantos revisores premiar
```

Quatro regras que quebram fácil: **desfazer entrega limpa o RECIBO, não o sorteio** — a
posição continua sendo a ganhadora, e a trilha guarda as duas pontas com o **motivo
obrigatório** (ADR-137); **o filtro do histórico é o dia da INSTITUIÇÃO** (armadilha 38) e
o rótulo usa o TEXTO digitado, porque o fim do dia local cai no dia seguinte em UTC
(armadilha 57); **a chave do cofre tem VERSÃO** (`RAFFLE_SEED_KEYS`, a maior é a atual) e a
abertura usa a versão GRAVADA no sorteio — sem isso, girar a chave apagava a prova de todo
o histórico (ADR-138); e **a prévia ao vivo negocia o transporte** na mesma rota (SSE com o
polling como caminho de volta declarado em `data-transport`).

**Privacidade:** `User.isPublicProfile` nasceu `true` e ninguém podia escolher — o nome dos
ganhadores saía COMPLETO no resultado público, contra a regra documentada. O padrão passou a
`false` e as linhas existentes foram normalizadas (ADR-139, armadilha 58). Falta a tela para
quem QUER se identificar (dívida E35).

### Sorteios (FASE 16)

O motor da FASE 8 ganhou operação completa: **suplentes** sorteados na mesma apuração
(`raffle_winners.kind` = `WINNER`/`ALTERNATE`), **entrega do prêmio** registrada por
POSIÇÃO (`positionId`, não `userId`), **chance proporcional aos minutos** quando
`weightByMinutes` está ligado, **commit-reveal** (compromisso `sha256` da semente na
criação, semente selada em AES-256-GCM com chave derivada de `BETTER_AUTH_SECRET`, e
revelação na apuração), **resultado público** opt-in com nome mascarado por padrão,
**histórico paginado** e **prévia ao vivo** do credenciamento em
`GET /api/events/[eventId]/raffle-live`.

```
Painel .................. /t/<slug>/administracao/eventos/<eventId>/sorteios
Reconhecimento do comitê  /t/<slug>/administracao/eventos/<eventId>  → seção "comitê científico"
```

Duas regras que quebram fácil: **o payload de auditoria é versionado**
(`raffle.resultVersion`; a versão 1 continua verificável e a 2 inclui suplentes, peso e
papel) e **suplente não conta como ganhador anterior** (só `kind = WINNER` sai do
páreo). Os gatilhos de carta de marco (`EVENT_ATTENDANCE_FULL` e `REVIEWER_TOP`) são
concedidos por `src/lib/gamification/achievement-service.ts`, com checagem explícita de
idempotência — `grantCardForTrigger` sozinho AUMENTARIA as cópias da carta.

### Página pública e patrocínio (FASE 17)

A instituição monta a própria vitrine. A página (`EventPage`) **nasce como rascunho** e só
vai ao ar quando publicada — a leitura pública já filtrava `isPublished` desde a FASE 3.
Cada bloco (`PageBlock`) tem o conteúdo validado **por tipo** no domínio
(`blockContentSchemas`), a ordem é **reescrita** ao mover (0, 10, 20…, para o empate não
virar no-op) e o editor **avisa** quando o bloco está vazio ou quando o tipo não tem
renderizador (só o `HERO`, porque o cabeçalho do evento já cumpre o papel).

```
Editor ................. /t/<slug>/administracao/eventos/<eventId>/pagina      (page:manage)
Patrocínio ............. /t/<slug>/administracao/eventos/<eventId>/patrocinadores (sponsor:manage)
Autoria ................ /t/<slug>/submissoes/<submissionId> → seção "Autoria"
```

Três regras que quebram fácil: **imagem é validada pela assinatura real do arquivo** (SVG é
recusado porque pode conter script, e o tipo GRAVADO é o detectado, não o declarado);
**`maxSponsors` é aplicado dentro da transação** (é cláusula de contrato, não layout) e
`taxId` ausente **preserva** o documento já gravado (a tela só mostra a máscara, então
`?? null` apagaria o CNPJ); e **autoria é substituída por inteiro** (`deleteMany` +
`createMany`) porque o índice único `(submissionId, authorOrder)` seria violado ao trocar
duas posições linha a linha — com o vínculo de conta preservado por e-mail.

O tema é do **evento**, em um único lugar (`Event.theme`); `EventPage.theme` segue
reservado e sem uso, para não existirem duas fontes de verdade para a mesma cor.

### Conteúdo e mídia (FASE 23)

A operação do editor: **pré-visualização** do rascunho, **upload na galeria**, **cópia de
patrocinador**, **histórico de versões** e **publicação agendada**.

```
Prévia ................. /t/<slug>/administracao/eventos/<eventId>/pagina/previa (page:manage)
Histórico .............. mesma tela do editor → seção "Histórico de versões"
Agendamento ............ mesma tela → "Agendar para entrar no ar"
Cópia de patrocinador .. /t/<slug>/administracao/eventos/<eventId>/patrocinadores
```

Quatro regras que quebram fácil: **a página pública é um COMPONENTE** (`EventLanding`)
consumido pela rota pública e pela prévia — a única diferença entre elas é qual página
chega (`docs/fase-23-conteudo-e-midia.md`, ADR-100); **a visibilidade agendada é decidida
na LEITURA** (`isPublished OR publishAt <= now`, sem agendador) e **despublicar LIMPA a
data**, senão a página volta ao ar sozinha (ADR-101 / armadilha 36); **o histórico é
snapshot da PÁGINA INTEIRA**, deduplicado pelo SHA-256 da versão canonicalizada (mudar a
ordem das chaves invalidaria a marcação de "estado atual") e restaurar **não mexe em
publicação** (ADRs 102–103); e **a cópia de patrocinador é uma CÓPIA** — cota casada pela
CHAVE, sem valor de contrato e nascendo oculta (ADR-105).

O alvo `GALLERY` do upload **não grava URL no banco**: ele devolve o endereço ao
formulário, e o vínculo acontece na validação do conteúdo do bloco (ADR-104).

### Biblioteca de mídia e agendamento (FASE 24)

A imagem deixou de existir só como URL no bucket: **todo envio** (capa, logotipo de
patrocinador e galeria) registra uma linha em `media_assets`, com autor, tamanho, tipo,
checksum, finalidade e o evento de origem (`eventId` é só procedência — o acervo é da
**instituição**). A tela do acervo mostra onde cada imagem é usada, copia a URL e recusa
excluir o que está em uso.

```
Acervo ................. /t/<slug>/administracao/eventos/<eventId>/pagina/midia (page:manage)
Janela de exibição ..... editor da página → "Agendar para entrar no ar" + "Sair do ar em"
Sincronizar cópia ...... patrocinadores → "Sincronizar" (só em cadastro copiado)
```

Quatro regras que quebram fácil: **a referência é a URL, não uma chave estrangeira**
(o conteúdo do bloco aceita imagem externa), então a exclusão **procura o uso** em vez de
confiar no banco e recusa dizendo onde a imagem aparece (ADR-108 / armadilha 39);
**mesmo checksum + tamanho + tipo reaproveita o registro** e apaga o objeto recém-enviado
(ADR-107) — reencodar a mesma foto gera outro objeto, e isso é esperado; **a janela de
exibição é decidida na LEITURA** com `isPublished OR publishAt <= now` **E**
`publishAt` futuro **E** `unpublishAt` futuro, sem agendador, com término antes do início
ou já vencido **recusado** e o estado `WINDOW_CLOSED` explicando a página fora do ar
(ADR-109); e **a data do agendamento é interpretada no fuso do EVENTO**, não no do
processo (UTC no container) nem no do navegador — o fuso viaja em campo oculto, a
conversão é em duas passagens (horário de verão) e a mensagem de sucesso diz qual fuso foi
usado (ADR-110 / armadilha 38).

Sincronizar cópia é **explícito e limitado** (`SPONSOR_SYNC_FIELDS`): nome, descrição,
site, logotipo, contato e documento — nunca cota, valor de contrato, vigência, ordem ou
exibição (ADR-111). O acervo **mede** o armazenamento (`sumMediaBytes`), e desde a FASE 21 a
quota do plano é **aplicada** em todo envio (ADR-131): medir e bloquear passaram a ser a
mesma esteira.

### Portal do palestrante (FASE 25)

O palestrante deixou de ser uma linha de `activity_speakers` e passou a ser uma **pessoa da
instituição** (`speaker_profiles`): a organização cadastra o perfil, **vincula** a uma ou
mais atividades e gera um **código de convite**; o palestrante assume o perfil, edita bio e
foto, publica materiais e emite o próprio certificado.

```
Cadastro ............... /t/<slug>/administracao/eventos/<eventId>/palestrantes (speaker:manage)
Convite ................ /t/<slug>/palestrante/convite?codigo=<TOKEN>  (público, autenticado)
Portal ................. /t/<slug>/palestrante
Vitrine ................ bloco "Palestrantes" da página pública
Ficha .................. /t/<slug>/eventos/<eventSlug>/palestrantes/<speakerId>
Download de material ... /api/t/<slug>/palestrantes/materiais/<materialId>/arquivo
```

Quatro regras que quebram fácil: **o convite é guardado como HASH** (`inviteTokenHash`) e
aparece UMA vez; regerar invalida o anterior (ADR-114) — quando a busca é pelo hash e nada
casa, a resposta é "convite não encontrado", não "código inválido"; **o aceite exige token E
e-mail** (o token prova a posse do link, o e-mail da conta prova quem é), roda numa **página
pública autenticada** — porque quem aceita pode ainda não ter vínculo — e o vínculo nasce
como consequência, com `kind = PARTICIPANT` (convidado de minicurso não consome a quota de
equipe) e papel `SPEAKER` no escopo **ACTIVITY**, um por atividade (ADR-115); **material tem
visibilidade própria** (`PUBLIC` / `ATTENDEES_ONLY` / `PRIVATE`) decidida por VISITANTE no
servidor, com 401 para o anônimo no material de inscritos, 403 para quem não é inscrito e
403 até para o inscrito no rascunho (404 nunca, porque o rascunho não é informação de quem
não organiza) — o bucket é privado e todo download passa por rota que assina URL temporária
(ADR-116); e **a carga do palestrante soma só o que foi ministrado**: atividade cancelada ou
ainda não concluída fica FORA, com o motivo no `workloadBreakdown`, e o certificado exige
evento encerrado + credenciamento registrado (ADR-117/118).

O portal é aberto por `holdsPermission` ("é palestrante em algum lugar?"), porque o papel é
concedido por ATIVIDADE; **cada escrita** reconfere a posse com o `userId` do BANCO. Exigir
escopo de tenant na entrada recusaria o caso normal — foi um dos defeitos que o E2E da fase
pegou (armadilha 42 mostra a outra metade, no `Field`).

**Duas portas para o portal.** Além de quem já é palestrante, entra quem tem **convite
pendente para o e-mail da conta** (`userId` nulo + `inviteTokenHash` gravado + e-mail igual):
o papel nasce com o aceite, então exigir o papel para chegar ao convite era um impasse. A
mesma condição (`pendingInviteWhere`, em `speaker-portal-service.ts`) decide a guarda, o item
do menu e a lista — e o item do menu segue a porta ("Convite de palestrante" antes do aceite,
"Portal do palestrante" depois, com o LAYOUT revalidado no aceite). Quem ainda não tem vínculo
aceita pela página pública do convite, que lista os convites do e-mail da conta logada
(ADR-119/120, `docs/fase-25-portal-do-palestrante.md` §10).


### Comunicação (FASE 15)

O e-mail transacional saiu do papel: **Resend** atrás de um driver com o padrão em **não
enviar**, fila `emails` no BullMQ e um **outbox** (`email_messages`) que guarda o assunto,
o HTML e o texto de cada mensagem **antes** da entrega.

```
Fila e entrega .......... src/lib/communication/{mailer,email-queue,email-service}.ts
Templates (9) ........... src/domain/communication/email-templates.ts   (funções puras)
Convite de equipe ....... /t/<slug>/administracao/equipe   → /t/<slug>/convite?codigo=<TOKEN>
Caixa de saída .......... /t/<slug>/administracao/comunicacao   (communication:read)
Confirmação de e-mail ... /verificacao  (destino do link; sem login)
```

Quatro regras que quebram fácil: **o driver só é `resend` com declaração explícita** (ou
produção com chave) — em qualquer outro caso `log` grava e não envia, e
`EMAIL_DRIVER=resend` **sem** chave falha com o motivo escrito em vez de cair para `log`
(ADR-128); **o HTML é gravado no enfileiramento** e o `dedupeKey` (único) carrega o FATO,
não o momento — é o que impede a mesma conquista de virar duas mensagens; **o convite é
promessa, não vínculo** (`tenant_invitations`, token só como SHA-256, um PENDENTE por
endereço por índice parcial, `MEMBER` + papel criados **no aceite**, onde a quota do plano
é aplicada — ADR-127); e **nenhuma notificação lança** (D3/D5/D6 são disparadas do serviço
que já conhece o fato, **fora** da transação — ADR-129).

A conta do Resend **ainda não tem domínio verificado**: o remetente tem de ser
`onboarding@resend.dev` e a entrega só alcança o endereço dono da conta (qualquer outro
volta 403, classificado como falha DEFINITIVA e visível em "Falhas"). Enquanto isso, o
driver `log` é o modo de operação de desenvolvimento e de teste — a suíte **força**
`log`, para que uma chave real no `.env` nunca dispare e-mail de teste.

### Contas do seed — **não têm senha**

`ana@`, `bruno@`, `carla@`, `diego@example.test` existem para exercitar RBAC e
tenancy; elas **não têm linha em `account`**, então login por senha falha — e isso é
intencional. Para usar a interface com elas:

1. crie uma conta em `/signup`;
2. vincule-a (`user_tenant_profiles`, `status = ACTIVE`, com `tenantId`) e conceda um
   papel (`role_assignments`, ex. `role = 'ADMIN'`, `scope = 'TENANT'`).

O caminho mais rápido é reaproveitar `tests/e2e/helpers.ts` (`linkUser` + `grantRole`)
ou o Prisma Studio (`npm run db:studio`).

### Contas de teste com senha — o caminho rápido para testar a interface

```bash
npm run db:seed:dev      # uma conta por perfil (os 10 papéis + estados de borda)
# senha de todas: a de SEED_TEST_PASSWORD no .env   ·   doc: docs/contas-de-teste.md
```

16 contas `@eventflow.test`: `superadmin@`, `owner@`, `admin@`, `organizador@`,
`organizador-evento@`, `presidente@`, `revisor@`, `palestrante@`, `equipe@`,
`equipe-evento@`, `participante@`, `patrocinador@`, `multi@`, `convidado@`, `suspenso@`, `semvinculo@`.
O script é idempotente, **regrava a senha** em cada execução e **recusa rodar com
`NODE_ENV=production`**. Ele apaga e recria as PRÓPRIAS concessões (marcadas por
`reason`), então mudar um escopo no script não deixa a concessão antiga vigente.

Sobre a senha: ela vive em `account.password` (`providerId = 'credential'`, hash scrypt
do Better Auth, via `better-auth/crypto`). O campo `user.passwordHash` é **legado e não
é usado pela biblioteca** — não perca tempo com ele ao depurar login.

### Dados de demonstração

Dois tenants (`ufba-demo`, `fiocruz-demo`), 2 eventos, 4 atividades, 1 trilha com
rubrica, 2 perfis de revisor, 7 cartas, 6 missões, 9 fatos de XP, 2 certificados
emitidos (códigos impressos no fim do seed), **1 sorteio apurado**, **1 página pública
publicada** (5 blocos, tema próprio, 1 cota com 2 patrocinadores), **11 versões no
histórico** dessa página, a página do simpósio com **janela completa de exibição**
(entra no ar em 7 dias, sai em 21 — datas no fuso `America/Bahia` do evento) e o
**acervo de mídia** da instituição com as imagens de capa, logotipos e galeria
registradas, e **1 palestrante** (Bruno, no minicurso de Rust) com perfil, vínculo com a
atividade, conta vinculada e um material público de apoio. Percursos em `README.md` §6.

---

## 7. Onde as coisas estão

```
docs/                  documentação por fase (ADRs, lições, evidências)
README.md              instalação, seed, contas, variáveis, scripts, índice dos docs
src/domain/**          regras puras por área (tenancy, rbac, events, review,
                       gamification, certificates, raffles, platform, communication)
src/lib/**             aplicação e infraestrutura (db, auth, events, review,
                       gamification, certificates, raffles, admin, storage, communication)
src/lib/platform/**    governança global (único uso de adminPrisma na aplicação — inclui o
                       e-mail de plataforma: verificação e redefinição de senha)
src/app/actions/**     Server Actions — TODA autorização é verificada aqui
src/app/t/[slug]/**    (public) landing pages · (app) painel autenticado
src/app/verificacao/** resultado da confirmação de e-mail (Better Auth redireciona para cá)
src/app/(public)/organizacoes/**  diretório público de instituições
src/app/superadmin/**  painel de governança (404 para quem não é SuperAdmin)
src/app/instituicao-bloqueada/**  página de bloqueio de instituição suspensa
src/app/validar/**     validação pública de certificado (sem login)
src/workers/           worker BullMQ (filas `certificates` e `emails` + varredura de prazos)
prisma/schema.prisma   modelo de dados (camelCase citado nas colunas)
prisma/migrations/**   migrações (algumas escritas à mão: índices parciais, policies,
                       particionamento de audit_logs)
docker/postgres/init/  roles, extensões e parâmetros (as policies de RLS migraram para
                       a migração 20260917191000; 02-rls-policies.sql é só um ponteiro)
src/lib/observability/ métricas (Prometheus), log estruturado e rótulo de rota
tests/{unit,integration,e2e}
```

---

## 8. Invariantes do sistema (não quebre)

1. **RUNTIME NUNCA** usa a role admin: `withTenant()` (role `eventflow_app`, sujeita
   a RLS) para tudo da aplicação; `adminPrisma` só para CLI/seed/provisionamento e
   para `src/lib/platform/**` (governança/diretório — operação global que, sob o
   contexto de UMA instituição, devolveria contagem zero em vez de negar).
2. **Contexto de tenant por transação** (`set_config(..., true)` = `SET LOCAL`). Nunca
   `SET` global — vaza entre requisições no pool.
3. **RLS é a última linha, não a única:** layout, páginas e Server Actions autorizam;
   a policy garante que um filtro esquecido não vire vazamento.
4. **Permissão `:own` exige posse explícita** (`can(..., { ownerId })`); sem isso a
   negação é intencional (fail-closed).
5. **Concorrência é decidida no banco:** índice único parcial, `UPDATE` condicional,
   `SELECT ... FOR UPDATE`. O retorno de 0 linhas é resposta de negócio.
6. **Idempotência por chave do fato** (XP, certificado, sorteio): repetir não duplica.
7. **Documento é dado, não tela:** snapshot imutável + hash sobre conteúdo canônico;
   renderizador (PDF/SVG) é apresentação. Ordem de chaves canônicas é CONTRATO.
8. **A recompensa nunca derruba o fluxo acadêmico:** ganchos de gamificação **e de
   comunicação** falham em silêncio (log), nunca bloqueiam submissão, parecer, emissão de
   certificado ou aceite de convite.

---

## 9. Estado por fase e próximos passos

| Fase | Tema | Situação |
|---|---|---|
| 1 | Infraestrutura, modelagem, RLS | ✅ |
| 2 | Autenticação, RBAC, multi-tenancy | ✅ |
| 3 | Eventos, inscrições, landing pages (chamada por trilha, lotação atômica, lista de espera, landing modular) — **+ revisão pós-entrega**: **inscrição no EVENTO** que já inclui as atividades **abertas** (`requiresRegistration = false`, linhas `EVENT_AUTO`), **editar e excluir** atividade na programação (exclusão recusada com inscritos/presença) e rótulos de tipo/situação **em português** (ADR-124/125/126, §19 do doc) — **+ segunda revisão**: **ciclo de vida da SALA** (editar e excluir, com a exclusão recusada enquanto há atividade usando), **capacidade opcional** (vazio = sem limite) e a **sala como teto das vagas**, aplicado inclusive na reserva atômica da inscrição e anunciado na página pública (ADR-134/135/136, §20 do doc) | ✅ |
| 4 | Submissões e avaliação por pares (chamada por trilha, upload direto com SHA-256, afinidade, conflito de interesse, revisão cega, nota ponderada no servidor, decisão com quórum) — **+ revisão pós-entrega**: criar o rascunho cai direto na página da submissão, o rascunho **não nasce inválido** (a validação do envio vale na criação e na edição), o autor **edita** título/resumo/palavras-chave e pode **excluir rascunhos** (nunca o que já foi enviado) | ✅ |
| 5 | Gamificação (XP, cartas, missões) | ✅ |
| 6 | Certificação (PDF assinado, QR, fila) | ✅ |
| 7 | Painel administrativo + E2E completo | ✅ |
| 8 | Motor de sorteios por presença real | ✅ |
| 9 | Diretório público de organizações e governança global (SuperAdmin) | ✅ |
| 10 | Inscrição pública e vínculo automático de participante | ✅ |
| 11A | Identidade visual, primitivos de UI e shell de navegação | ✅ |
| 11B | Propagação do design a todas as telas e quitação da dívida (catraca zerada) | ✅ |
| 12 | Mutirão de dívidas rápidas (I7, I3, I5, C2, I1, I2, H2, H4) | ✅ |
| 13 | Operação e segurança (A1, B1, B2, B3, B4: rate limit em Redis, observabilidade, RLS na migração, particionamento da auditoria, PgBouncer) | ✅ |
| 14 | Quotas e planos (C1, C3, I4: quota de membros aplicada, plano e quotas editáveis pela UI, membro × participante no modelo e nas listas) | ✅ |
| 15 | Comunicação (D1–D6, A5: e-mail transacional com Resend atrás de um driver que por padrão NÃO envia, fila `emails` com outbox `email_messages`, 8 templates em funções puras, convite de equipe em `tenant_invitations` com aceite e quota no aceite, avisos de avaliação/prazo/carta/certificado e verificação de e-mail sem bloquear o login) | ✅ |
| 16 | Sorteios de ponta a ponta (G1–G7 + F1: suplentes, entrega do prêmio por posição, peso por minutos, commit-reveal, resultado público mascarado, prévia ao vivo, gatilhos de marco) | ✅ |
| 17 | Página pública e patrocínio (E3–E6: editor de blocos com validação por tipo, tema visual, capa e logotipo por upload, cotas e patrocinadores com limite de vagas, edição de coautores com ordem de crédito) | ✅ |
| 23 | Conteúdo e mídia (E9–E13: pré-visualização do rascunho pelo mesmo componente da página pública, upload de imagem na galeria, cópia de patrocinador entre eventos, histórico de versões com restauração, publicação agendada decidida na leitura) | ✅ |
| 24 | Mídia e agendamento (E14–E17: biblioteca de mídia com reaproveitamento por checksum e exclusão que confere o uso, sincronia do patrocinador copiado, janela de exibição com `unpublishAt`, data agendada no fuso do evento) | ✅ |
| 25 | Portal do palestrante (E21–E24: perfil do palestrante como pessoa da instituição, convite por token hasheado e vínculo de conta em dois caminhos, portal com posse verificada no banco, materiais com visibilidade por visitante, vitrine com foto e bio, certificado `SPEAKER` com carga apurada) — **+ revisão pós-entrega**: o item de menu voltou a aparecer para as permissões pessoais e o convite pendente virou porta de entrada do portal (ADR-119/120, §10 do doc) | ✅ |
| 21 | Ciclo de vida do membro e storage (C4, C5: troca de papéis e remoção lógica do membro pela tela de equipe com posse do OWNER protegida, quota de **armazenamento aplicada de verdade** em todo envio — submissão, mídia e material de palestrante — medida sobre tudo o que a instituição guarda) | ✅ |
| 22 | Operação de palco (G8–G13: **desfazer** a entrega com motivo na trilha, filtro do histórico por situação e período, premiar N revisores, **endereço próprio** do resultado publicado, chave do cofre **versionada** e prévia ao vivo por SSE com polling de volta) — **+ correção de privacidade**: o consentimento de perfil público passou a nascer DESLIGADO (ADR-139) | ✅ |
| 29 | Palco público e auditoria do sorteio (**telão** com compromisso antes da apuração, contagem ao vivo e revelação automática; **link + QR** na tela de sorteios; **lista publicada** gravada na apuração e assinada no resultado (payload v3); **auditoria** que refaz as contas no navegador e receita para conferir fora do site) — escopo definido pelo humano | ✅ |
| 30 | Sorteio ao vivo, em rodadas (cada rodada com o próprio compromisso, prêmio, patrocinador e resultado assinado; **"Criar para o palco"** para o telão existir antes da apuração; **roleta** com os nomes reais da lista publicada parando no ganhador; **payload v4** declarando o momento; auditoria e resultado público **por rodada**) — escopo definido pelo humano; **+ revisão da FASE 29**: o telão só era alcançável já apurado, e o E2E montava o rascunho por escrita direta | ✅ |
| 31 | Credenciamento e frequência por crachá (**um código por pessoa** no evento, com o **contexto da leitura** decidindo o fato; **área de crachás** com emissão individual e em massa e **folha A4** em PDF com QR + código + nome; **crachá online** do participante; **modo monitor** com câmera (API nativa + decodificador local), leitor USB e digitação; **chegada ≠ frequência**, com sessão por visita e minutos com teto no fim da atividade) — escopo definido pelo humano | ✅ |
| 32 | Central do participante e inteligência da instituição (**diretório** de todos os participantes da instituição — união de vínculo e inscrição —, **ficha 360** com eventos, frequência, certificados, cartas, XP e comunicação, **recado** por e-mail e mensagem na **caixa de entrada** do participante, **panorama** com taxa de comparecimento e série por evento no fuso da instituição, e **exportação em CSV** com trilha; abertura de ficha auditada e e-mail mascarado na lista) — escopo definido pelo humano | ✅ |
| 18+ | *a definir pelo humano* | ⏳ |

> **Numeração de tema, não de ordem.** Cada tema tem um número **FIXO**: o número
> identifica o tema, não a ordem de entrega. Por isso a FASE 16, a FASE 17, a FASE 23, a
> FASE 24 e a FASE 25 foram entregues antes da F15 — e a FASE 21, numerada no meio, foi
> entregue **depois** de todas elas. O humano escolheu o tema pelo nome
> dele. A tabela acima segue a ordem cronológica; a numeração é a do tema.

**Dívidas técnicas:** o levantamento consolidado (**52 itens abertos**, soma das
tabelas de tema — o tema G ficou ZERADO na FASE 22 — o levantamento original menos o que
as FASES 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 29, 30, 31 e 32 quitaram, mais o que cada uma declarou de
novo: a FASE 15 quitou os sete itens de
comunicação (D1–D6 + A5) e declarou D7–D9; **a FASE 21 quitou C4–C5 e declarou C6–C7**
(reconciliação banco × bucket e acesso de participante perdido na remoção); **a FASE 22
quitou G8–G13 e declarou o E35** (não há tela para a pessoa autorizar o nome no resultado
público); **as FASES 29, 30 e 31 não quitaram item deste levantamento** (o escopo veio do
humano) e declararam o **E36** (a lista auditável não pode ser comprometida antes da apuração) e o
**E37** (não há interruptor para manter o telão fora do ar), o **E38** (o prêmio anunciado de uma rodada não pode ser corrigido pela tela) e o **E39** (a roleta não pode ser repetida nem desligada pelo operador), o **E40** (o credenciamento não funciona sem rede), o **E41** (a impressão é folha A4 para recortar), o **E42** (o crachá não tem identidade visual do evento) e o **E43** (o botão único do balcão fecha a presença na segunda leitura: não há como pedir "só entrada" na tela); a FASE 25
declarou cinco itens, a revisão dela declarou o E30, as duas rodadas da revisão da FASE 4
declararam o E31 e o E32, a **primeira** revisão da FASE 3 declarou o E33 e a **segunda**
declarou o E34 (a sala de uma atividade ABERTA não limita o público do evento: o painel
avisa); verificado no código,
com esforço e
fases candidatas numeradas como as fases que serão entregues — ~~F15 Comunicação~~
(entregue) · ~~F16 Sorteios de ponta a ponta~~ (entregue) · ~~F17 Landing page e
patrocínio~~ (entregue) · F18 Segurança de documentos · F19 Gamificação avançada · F20
Observabilidade de segunda ordem · ~~F21 Ciclo de vida do membro e storage~~ (entregue) ·
~~F22 Operação de palco~~ (entregue) ·
~~F23 Conteúdo e mídia~~ (entregue) · ~~F24 Mídia e agendamento~~ (entregue) ·
~~F25 Portal do palestrante~~ (entregue) · F26 Acervo de mídia: miniaturas, busca e
sincronia em lote · F27 Material e convite do palestrante · F28 Entrega de e-mail de
segunda ordem · ~~F29 Palco público e auditoria do sorteio~~ (entregue) · ~~F30 Sorteio ao vivo, em rodadas~~ (entregue) · ~~F31 Credenciamento e frequência por crachá~~ (entregue)) está em
**`docs/dividas-tecnicas.md`**.
Leia antes de propor a próxima fase: ele já diz o que falta, o que foi quitado e a
ordem sugerida.

---

## 10. Primeira ação de uma sessão nova

1. Ler `README.md`, `docs/design-system.md`, `docs/dividas-tecnicas.md`,
   `docs/armadilhas.md` (a tabela COMPLETA das 72 armadilhas) e o documento da **última
   fase entregue** (`docs/fase-32-central-do-participante.md`; a referência de comunicação é
   `docs/fase-15-comunicacao.md`).
2. Rodar a bateria da seção 4 para confirmar que a árvore está verde **antes** de
   mexer em qualquer coisa (se algo falhar, isso é o primeiro trabalho).
3. Apresentar ao humano o **plano da fase pedida** (domínio → aplicação → interface →
   testes → documentação) e **aguardar** a definição/requisitos dela.
4. Implementar, verificar, documentar e **parar** em `Aguardando APROVADO: AVANÇAR`.





