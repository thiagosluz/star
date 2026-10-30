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
Fases concluídas ........ 1 a 17, 21 a 25, **29 a 85** (**F56 a F85 entregues**)
Testes ................. **4563** (Vitest: unit + integração, 256 arquivos) + **491** (Playwright E2E) + 1 skip
ADRs ................... 385 (numeração GLOBAL e sequencial — a próxima é ADR-386)
Permissões ............. 66 (11 papéis, 4 escopos)
Tabelas de tenant ...... 60 sob RLS + FORCE (+ as partições mensais de audit_logs)
Tabelas de plataforma .. job_runs, two_factor e identity_audit_logs — sem RLS (ou sem tenant) e SEM acesso para a role de runtime (verificado no contrato)
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

**O teto deste arquivo: ~64.800 bytes.** O harness corta o `AGENTS.md` em **65.244 bytes** — e
o corte **apaga conteúdo em silêncio** (aconteceu na FASE 68: uma linha da tabela de fases
desapareceu, e o arquivo continuou válido, só menor do que deveria). Por isso quem atualiza o
estado **confere o tamanho no fim** (`(Get-Item AGENTS.md).Length`) e, se passar do teto, a
primeira opção é **mover o próximo bloco para o histórico**, não condensar: o mais antigo ainda
na tabela da §9 vai para [`docs/fases-historico.md`](docs/fases-historico.md), que guarda as
fases **1 a 25** (FASE 79), **29 a 30** (FASE 82), **31 a 35** (FASE 83), **36 a 42** (FASE 84) e **43 a 49** (FASE 85, quando a linha 85 levou o arquivo a 65.986 bytes), movidas como estavam,
e a **§9 carrega a tabela corrente**
(as fases recentes) + o ponteiro para o histórico. Condensar **apaga detalhe**; mover
**preserva**. Só quando não der para mover é que se **condensa a linha mais antiga ainda na tabela** —
corte em ~300 caracteres, num limite de palavra, fechando a linha com ` … | ✅ |` —, e o
registro completo do que foi condensado segue no `docs/fase-NN-*.md` e no `README.md`.

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
npm test              # esperado: 4563 testes passando (256 arquivos)
npm run build         # esperado: "Compiled successfully" e a rota nova listada
npm run db:verify     # esperado: "Contrato íntegro." (inclui: nenhuma tabela de plataforma
                      #           alcançável pela role de runtime)
npm run db:verify:isolation   # esperado: "9/9 verificações passaram."
npm run db:partitions         # esperado: partições do mês atual e dos seguintes já criadas

# Pooling (opcional, exige o perfil `pooler` no ar) — rode com a árvore PARADA
# (armadilha 85: ele escolhe os tenants por conta própria e o cleanup do E2E apaga um deles):
docker compose --profile pooler up -d pooler
npm run db:verify:pooling     # esperado: "Pooling íntegro: contexto por transação preservado sob PgBouncer."

# E2E exige o container rodando o código NOVO:
docker compose --profile app up -d --build web worker
docker images | grep eventflow/web        # conferir que a imagem é recente
npm run test:e2e      # esperado: **491 passando + 1 skip** (492 casos); medido na F85: os 4
                      # casos novos são 3 do spec da emissão do evento + 1 no portão de
                      # acessibilidade; nenhum vermelho
```

**Armadilha crítica de verificação:** se o `--build` falhar, o `docker compose`
**mantém o container anterior no ar** e o E2E passa a medir código que não existe.
Um `docker compose ps` dizendo "healthy" **não prova** que a imagem é a nova. Por
isso: (a) leia a saída completa do build, (b) confirme a data da imagem,
(c) confirme que a rota nova responde (307/200, não 404).

---

## 5. Armadilhas conhecidas (custaram depuração real)

> **A tabela COMPLETA — 106 armadilhas, cada uma com sintoma, causa raiz e correção — vive em
> [`docs/armadilhas.md`](docs/armadilhas.md)**, e a seção 10 manda lê-la antes de mexer em
> qualquer coisa. Os números são estáveis e citados no código e nos documentos de fase — não
> renumere. As duas mais recentes, como amostra do que a regra protege:

* **100 — Satori exige `display: flex` em `<div>` com mais de um filho**: `Conquistada por {nome}`
  são DOIS nós, a rota de imagem responde 500 e a prévia do link nasce vazia. O erro não aparece no
  `build` nem no `tsc`; o E2E **baixa o `og:image`** anunciado na página, e é isso que prende.
* **101 — O provisionamento RELIGA o privilégio que a migração revogou**: o `db:rls` (parte de
  `db:setup`) concede CRUD em TODAS as tabelas e depois revoga as restritas — e a lista tinha só
  `job_runs`, então a tabela da semente TOTP voltava a ser alcançável pela role de runtime a cada
  subida. Corrigir caso a caso garante que o próximo caso volte: a lista sai da FONTE ÚNICA
  (`PLATFORM_ONLY_TABLES` + `IDENTITY_ONLY_TABLES`) e um teste catraca a prende.

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

`/api/metrics` expõe métricas no formato Prometheus. **Sem `METRICS_TOKEN` definido, em produção,
o endpoint responde 404** — de propósito (em desenvolvimento responde 200, para inspeção local).
As métricas são **por processo** (o coletor soma): o Proxy conta requisição por rota/método/status
(o slug do tenant vira curinga) e o scrape lê `getJobCounts()`/`getWorkersCount()` do BullMQ —
é assim que se sabe se o worker está vivo. O log estruturado redige senha/token e mascara
e-mail.

### PgBouncer (FASE 13)

Pool em modo **transação**: seguro porque o contexto de tenant é `SET LOCAL` (invariante nº 2) e o
projeto não usa recurso de sessão (advisory lock, `LISTEN`/`NOTIFY`, prepared statement nomeado).
Prova: `npm run db:verify:pooling`.

### Partições da auditoria (FASE 13 · operação desde a FASE 36)

`audit_logs` é particionada por mês em `createdAt`, com partição `DEFAULT` para que gravar
auditoria nunca falhe. **Quem mantém é a rotina `audit-partitions` do WORKER** (diária às 3h,
registrada em `job_runs`): cria o mês atual e os seguintes e resgata o que caiu na `DEFAULT`,
aplicando RLS + FORCE e concessões em cada partição nova. A CLI `npm run db:partitions` chama o
MESMO serviço. Retenção é `DROP TABLE audit_logs_<AAAA_MM>` — decisão em aberto (dívida B8): a
manutenção **cria** e nunca **apaga**.

### Inspeção antivírus (FASE 36)

O arquivo de terceiro passa por inspeção antes de ser servido ao comitê, **quando a inspeção está
ligada**. O driver padrão é `none` — **não inspecionar** —, e aí o arquivo nasce `SKIPPED` ("não
inspecionado"), é servido normalmente e a tela diz isso.

```bash
docker compose --profile av up -d clamav   # perfil próprio; ~1 GB de assinaturas
# .env: SCAN_DRIVER=clamav · CLAMAV_HOST=clamav · CLAMAV_PORT=3310
```

Três regras que quebram fácil: **`INFECTED` nunca é servido** (nem com a inspeção desligada
depois); **`PENDING` só é bloqueado ENQUANTO a inspeção está ligada** (sem inspeção, o estado
honesto é `SKIPPED`); e **inspeção indisponível NÃO é veredito** — o arquivo segue `PENDING` para
a próxima passada. O portão vale onde a aplicação media os bytes (submissão e material de
palestrante) e **não** em `media_assets`, bucket público (ADR-187).

### Rotinas automáticas (FASE 36)

As cinco rotinas — prazos de parecer, presenças em aberto, confirmação de vaga, inspeção de
arquivos e partições — abrem e fecham um registro em `job_runs`.

```bash
# /superadmin/rotinas  → catálogo, saúde, histórico e "Executar agora"
psql "$DATABASE_URL" -c 'SELECT job, status, trigger, items, error FROM job_runs ORDER BY "startedAt" DESC LIMIT 20'
```

Quatro regras que quebram fácil: **a linha em `job_runs` é o registro E a reserva** (índice único
parcial `WHERE status = 'RUNNING'`, e **não** advisory lock — o PgBouncer em transação não preserva
lock de sessão, ADR-183); **execução órfã tem prazo de validade** (meia hora; sem isso o worker que
morre trava a rotina para sempre); **a tela lê o CATÁLOGO, não as execuções** (ADR-184); e **o atraso
é medido contra a cadência da rotina** (ADR-185). O botão do painel **enfileira** e responde na hora: quem
roda é o worker (ADR-186). `job_runs` é **tabela de plataforma**: sem RLS e **sem privilégio para
a role de runtime**, com a revogação em `docker/postgres/init/00-roles.sql` e a verificação de
contrato reprovando se ela voltar (ADR-191, armadilhas 82–83).


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


### Crachá

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

Cinco regras que quebram fácil: **o crachá é da PESSOA no evento** (um código por par evento ×
pessoa em `event_credentials`), e é o **CONTEXTO da leitura** que decide onde o fato é gravado
(ADR-148) — com o código na inscrição, quem tivesse evento + 2 minicursos teria três crachás;
**chegada ≠ frequência** (ADR-149): a portaria grava com `activityId` nulo, a atividade grava
**uma sessão por visita** (entrada, saída, minutos) e a chave de idempotência é a SESSÃO, nunca a
inscrição — usar `checkIn` na 2ª visita respondia "já credenciado" e a tarde da pessoa
desaparecia; **os minutos têm teto no fim da ATIVIDADE** (ADR-150); **leitura fora da inscrição
registra e AVISA** (ADR-151) — a presença existe, o XP não; e **o QR carrega só o código**
(ADR-152), sem dado pessoal.

### Central do participante

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
na ficha; **o recado é o FATO e o e-mail é consequência** — a mensagem nasce em
`participant_messages` e o e-mail sai pelo outbox com `dedupeKey` do ID DA MENSAGEM, então falha
de provedor não apaga a comunicação; **a caixa de entrada é aberta por POSSE** (o `userId` vem da
sessão) enquanto ENVIAR exige `participant:message`; e **`null` não é `0`** — taxa de
comparecimento e média de minutos vêm `null` sem denominador, e a tela mostra "—".


### Chamadas de propostas (FASE 33)

A chamada deixou de ser UMA (a janela do evento) e de servir só ao artigo: cada chamada tem
tipo, texto, janela, cegueira, rubrica e limite por autor próprios — e a proposta entra pelo
MESMO motor de avaliação da FASE 4.

```
Painel .................. /t/<slug>/administracao/eventos/<eventId>/chamadas
                           → criar/editar/publicar/despublicar/excluir (event:manage),
                             rubrica própria da chamada, e as propostas recebidas
Formulário público ...... /t/<slug>/eventos/<eventSlug>/chamada/<callSlug>
                           → ler é público; enviar exige sessão (login/signup com volta)
Bloco na página ......... "Chamadas de propostas" no editor de blocos (FASE 17)
Aceite .................. /t/<slug>/comite/<submissionId> → "Protocolo de aceite"
```

Cinco regras que quebram fácil: **a chamada é ENTIDADE, não trilha** (a trilha é o eixo
temático e é permanente; a chamada é temporária e pode não ter tema — ADR-158); **a
precedência da rubrica e da cegueira é CHAMADA → TRILHA → PADRÃO**
(`resolveEffectiveRubric`), usada pelos três caminhos — sem ela a rubrica da chamada seria
coluna sem leitor (armadilha 75); **fora da ciência (`PAPER`/`POSTER` são científicos)
trilha não é obrigatória e "sem arquivo" é AVISO, não bloqueio** (ADR-162); **a proposta É
uma `Submission`** (`callId` nulável + `proposalData` JSON) e o **limite por autor conta
NESTA chamada** (ADR-161/164); e **o aceite registra a decisão pelo motor do comitê e trata
criar a atividade e convidar o palestrante como ESCOLHAS do organizador** — a atividade
nasce com a carga horária DECLARADA na proposta e a agenda é da organização, e a falha dela
não desfaz a decisão (vira aviso) — ADR-165/166. O convite por e-mail quita a dívida
**E25** (ADR-167).

A página pública lê a chamada na RENDERIZAÇÃO (o bloco guarda só decoração e o filtro
"incluir encerradas") — copiá-la para o bloco mentiria sobre o prazo no dia seguinte (ADR-168).

### Vaga com prazo

A inscrição deixou de ser um ato único: quando a atividade cobra algo para valer (taxa,
doação, item), a vaga fica **RETIDA** até a equipe registrar a confirmação — e vence sozinha.

```
Escolha do organizador .... Programação → criar/editar atividade → "Confirmação de vaga"
                              (Automática × Exige confirmação · prazo 1–30 dias ·
                               o que é preciso · onde confirmar)
Fila da equipe ............ /t/<slug>/administracao/eventos/<eventId>/confirmacoes
Participante .............. /t/<slug>/minhas-inscricoes (prazo, checklist e local, SEM botão)
Relógio (produção) ........ npm run registrations:expire [-- --lembretes] [-- --agora=<ISO>]
                              + job do worker de hora em hora
```

Cinco regras que quebram fácil: **a inscrição `PENDING` RETÉM a vaga** — da atividade **e** o
lugar no evento (ADR-171); **quem confirma é a EQUIPE**, então o aviso ao participante é
INSTRUÇÃO e a transição é `updateMany` condicional (ADR-172); **o prazo é por inscrição, no fuso
do evento, vencendo às 23:59 do dia local**, com o rótulo pronto do serviço (ADR-173);
**`REQUIRED` exige dizer o que e onde**, e desligar a política com pendentes é RECUSADO (ADR-174);
e **a liberação é idempotente e promove o próximo na MESMA transação** (ADR-175/178). Os cinco
avisos saem por e-mail **e** na caixa de entrada com a mesma `dedupeKey` do fato (ADR-176). A fila
ordena por **urgência**, não por agenda (ADR-177 / armadilha 80).

### Crachá em etiqueta e impressora térmica · Confirmação por item (FASE 37)

A impressão deixou de ser só a folha A4 para recortar, e a confirmação de vaga deixou de ser do
conjunto: cada exigência tem estado próprio, e a vaga se confirma quando as obrigatórias acabam
— pelo mesmo caminho que a equipe usaria.

```
Etiquetas e térmica .... /t/<slug>/credenciamento/crachas → "Etiqueta adesiva e impressora
                          térmica (medidas)" (grade da folha e rolo, editáveis)
Rota ................... GET /api/t/<slug>/credenciamento/crachas/impressao?eventId=<id>
                          &formato=etiquetas|zpl + as medidas (ou userIds) na query
Balcão (item por item) . /t/<slug>/administracao/eventos/<eventId>/confirmacoes
Participante ........... /t/<slug>/minhas-inscricoes (checklist com estado, SEM botão)
```

Quatro regras que quebram fácil: **a geometria é DADO, não constante** — folhas e rolos variam
por modelo, então mm é a fonte e o padrão é 3 × 8 de 63,5 × 33,9 mm (A4) e 203 dpi · 100 × 50 mm
(ADR-192); **medida que o sistema não entende é RECUSADA**, não substituída: DPI fora de
{203, 300} imprimiria a etiqueta fisicamente menor (ADR-193 / armadilha 87); **o nome sai INTEIRO
no ZPL** (ADR-194/195); e **o checklist é SNAPSHOT da inscrição**, criado na inscrição retida **e**
na promoção da lista de espera — a vaga continua sendo `registrations.status`, confirmada por
`confirmRegistration` quando as obrigatórias acabam, com `WAIVED` valendo como resolvido
(ADR-196…199).

### Quadro de demandas internas do evento (FASE 38)

O trabalho da EQUIPE ganhou lugar: um quadro por evento
(`/t/<slug>/administracao/eventos/<eventId>/demandas`, com `/equipes` ao lado), com colunas
configuráveis, cartões com responsáveis, prazo, equipe, conversa e histórico. **Não confunda
com a Programação**: "atividade" é a sessão com sala, vagas e presença; a demanda é o trabalho
da organização. A rotina `demand-due` avisa os prazos de hora em hora.

Cinco regras que quebram fácil: **a coluna é o estado e `isDone` é DADO** — renomear
"Concluído" não pode zerar o histórico (ADR-201); **mover é escrita CONDICIONAL** pelo que a tela
viu, e o segundo movimento recebe `ALREADY_MOVED` (ADR-203); **a posição não é única** e reordenar
reescreve o bloco de 10 em 10 (ADR-202); **o prazo é o fim do DIA local do evento** e "vence hoje"
não é atrasado (ADR-207); e **a menção é LINHA, não texto procurado** (ADR-204). Quem é atribuído
é **vínculo `MEMBER` ativo** (ADR-205) e o **líder da equipe** é DADO (`isLead`, um por equipe por
índice único parcial — ADR-206). O quadro **funciona sem JavaScript**: quitou a METADE da **E50**.

### Rubrica com número livre de critérios (FASE 39)

O organizador escolhe **quantos critérios** a rubrica tem — de **1 a 12** (ADR-214) — na chamada e
na **trilha**, que ganhou **tela de edição** (antes a trilha nunca podia ser editada). Quatro
regras: **a chave do critério é DERIVADA do rótulo**, e a chave já gravada é PRESERVADA quando o
formulário a manda — renomear o rótulo não pode invalidar o parecer que a referencia (ADR-213);
**a rubrica CONGELA no primeiro parecer** (chaves, pesos e notas máximas; rótulo, descrição e
ORDEM seguem livres — ADR-215/216) e a comparação usa a rubrica **EFETIVA** (CHAMADA → TRILHA →
PADRÃO); **o editor funciona sem JavaScript** (12 linhas no `<noscript>`, linha sem rótulo
descartada — ADR-218); e **peso ou nota que não é número cai no padrão**, em vez de virar `NaN`.

### Editor visual do certificado (FASE 40)

O desenho do certificado deixou de ser código: **arte de fundo** da instituição e elementos
posicionados em **milímetros**, com o texto montado por **variáveis**.

```
Modelos ..... /t/<slug>/administracao/certificados/modelos  (galeria, editor e prévia)
```

Quatro regras que quebram fácil: **o desenho é DADO e vive CONGELADO no certificado**
(`layoutSnapshot` + as variáveis de conteúdo gravadas na emissão — editar o modelo não muda
documento emitido); **o documento tem VERSÃO** — com layout é a 2, sem layout continua a 1, e a
versão é DERIVADA do snapshot, nunca uma coluna; **a arte entra no PDF como está**
(`/DCTDecode`, sem recomprimir) e a orientação EXIF vira matriz, com CMYK e progressivo
RECUSADOS (a régua da armadilha 87); e **sem modelo configurado vale o desenho fixo da FASE
6** — o editor é opt-in. A precedência é EVENTO+TIPO → EVENTO → INSTITUIÇÃO+TIPO → INSTITUIÇÃO
→ padrão, com UM modelo por combinação garantido por índices únicos parciais.



### Comunicação (FASE 15)

O e-mail transacional saiu do papel: **Resend** atrás de um driver com o padrão em **não
enviar**, fila `emails` no BullMQ e um **outbox** (`email_messages`) que guarda o assunto,
o HTML e o texto de cada mensagem **antes** da entrega.

```
Fila e entrega .......... src/lib/communication/{mailer,email-queue,email-service}.ts
Templates (23) .......... src/domain/communication/email-templates.ts   (funções puras)
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
`onboarding@resend.dev` e a entrega só alcança o endereço dono da conta (qualquer outro volta
403, falha DEFINITIVA visível em "Falhas"). O driver `log` é o modo de desenvolvimento e de
teste — a suíte **força** `log`, para uma chave real no `.env` nunca disparar e-mail de teste.

### Carta premium e compartilhamento (FASE 48)

```
Álbum ................. /t/<slug>/cartas            → inclina sob o ponteiro
A carta ............... /t/<slug>/cartas/<slug>     → palco 3D, ficha, destaque, link
Link público .......... /t/<slug>/carta/<TOKEN>     → só a carta, sem sessão (+ og:image)
Opt-in ................ /t/<slug>/administracao/cartas → brilho, inclinação, arte do verso
```

Quatro regras: **a apresentação é DADO no `art`** (`holo`, `sheen`, `tilt`, `backUrl`), então carta
gravada antes da fase não muda e não há migração de dado; **o efeito é enfeite** — sem JavaScript e
com movimento reduzido a carta e a ficha continuam na página, e a ficha sai do MESMO
`cardBackContent` que o verso; **foil acende o brilho sozinho** e a raridade não mexe na
intensidade; e **o link é POR CARTA**, com token SELADO (AES-GCM: o dono reexibe, o banco sozinho
não abre), índice por SHA-256, revogação imediata e o nome pela régua da FASE 44. A prévia do link
é imagem vetorial gerada no servidor (`next/og`).

### Exportação com prazo e trilha de identidade (FASE 49)

```
Diretório ....... /t/<slug>/participantes → "Gerar exportação" (+ "Exportações recentes")
Contatos ........ patrocínio → "Exportar contatos (CSV)"    (mesmo prazo e mesma marca)
Download ........ GET /api/t/<slug>/exportacoes/<exportId>/arquivo   (sessão; 410 se vencida)
Auditoria ....... /superadmin/auditoria  → governança + segurança das contas
Histórico ....... /conta → "Segurança e acessos"
```

Quatro regras: **o arquivo não é guardado** — o que expira é o direito de baixar de novo;
**a marca d'água vai no topo E em cada linha** (a cópia de uma linha sobrevive) e sempre na
ÚLTIMA coluna, porque a ordem das colunas do dado é contrato; **o download é por SESSÃO, não
por link assinado** (a fase existe para saber quem baixou); e **a trilha de identidade não tem
`tenantId`** — a proteção é o PRIVILÉGIO (armadilha 101) e ela **nunca grava segredo**.

### Mutirão de dívidas II (FASE 50)

```
Equipe .......... /t/<slug>/administracao/equipe → "Converter em participante"
Quadro .......... Alt + ↑/↓ reordena na coluna · ?cartoes=N ajusta a janela
Certificado ..... setas movem a caixa (1 mm; Shift = 10 mm) no palco
Acessibilidade ... npx playwright test tests/e2e/accessibility.spec.ts  (WCAG AA)
```

Quatro regras: **sair da equipe não é perder o acesso de participante** (o vínculo vira
`PARTICIPANT` e as inscrições, certificados e cartas continuam); **cancelar devolve o XP** por
lançamento no livro-razão (append-only) e **quem cancelou pode voltar** — a regra de "inscrição
viva" é a MESMA do índice parcial do banco (armadilha 103); **o checksum da conferência é o do
STORAGE** (armadilha 102) — metadado declarado pelo cliente seria tautologia; e **o que a tela
esconde, ela anuncia** (coluna truncada mostra "N de M" e o caminho para ver o resto).

### Mutirão de dívidas III (FASE 51)

```
Carta .......... /t/<slug>/cartas/<cardSlug> → "Compartilhar" (prazo, aberturas, histórico)
Rascunho ....... /t/<slug>/submissoes/<id>  → campo "Trilha" (só sem parecer/atribuição)
Sorteios ....... /t/<slug>/administracao/eventos/<eventId>/sorteios → interruptor do telão
Equipes ........ /t/<slug>/administracao/eventos/<eventId>/equipes → ordem ↑/↓
Acervo ......... .../pagina/midia?busca=&tipo=&evento=&emUso=1
Arquivados ..... /t/<slug>/administracao/cartas?arquivados=1  (e /missoes)
Certificados ... /validar/lote   (até 50 códigos por consulta)
```

Quatro regras: **a integridade faz parte da autenticidade** — a assinatura entrou no veredito
público e no download (conteúdo alterado responde `TAMPERED` e não é baixável; certificado sem
assinatura gravada é "não verificável", não adulterado); **cada dívida de alcance usou a régua
que já existia** (a restauração usa as permissões e a trilha da exclusão; os filtros usam o
`collectUsages` da própria tela; a ordem das equipes usa a reescrita da FASE 38; o lote chama a
mesma validação de um código); **o que a tela esconde, ela anuncia** (arquivados com data e autor,
"N de M" no acervo, "ninguém baixou ainda" na exportação); e **a trilha do rascunho só troca
enquanto nada depende dela** — depois, a resposta diz que é do comitê.

### Fechar o que abrimos (FASE 52)

```
Aviso .......... dois tons medidos: `warning-strong` (#92400e) no claro, `-on-dark` (#fcd34d) no telão
Acessibilidade . npx playwright test tests/e2e/accessibility.spec.ts   (SEM isenções)
Landmark ....... um único <main> por tela — a casca deixou de ser o landmark
Crachá ......... /t/<slug>/credenciamento/crachas → emissão à mão aceita inscrição ∪ vínculo
```

Quatro regras: **não existe um tom de aviso que sirva às duas superfícies** (2,89:1 no painel
claro e 4,15:1 no telão escuro com o mesmo `#d97706`) — a escolha é **medida** e presa por
catraca que lê o CSS e calcula o contraste do WCAG; **a casca não é o landmark** (o `<main>` é o
conteúdo da tela, e a auditoria das 82 páginas achou 16 sem nenhum — dívida I2); **a emissão à
mão usa a população da TELA** (`registration` ∪ `user_tenant_profile`): a secretaria escolhia a
pessoa inscrita e recebia "nenhum participante"; e **teste que interage com formulário
controlado precisa da prova de que o React assumiu** — a caixa marcada no DOM e vazia no estado
envia o formulário vazio (armadilha 106).


### Painel de prontidão e áreas do evento (FASE 53)

```
Prontidão ..... /t/<slug>/administracao/eventos/<eventId> → o que falta para o evento ficar pronto
Áreas ......... a mesma tela: grade de cartões em Configurar · Vitrine · Operar · Resultado
Vitrine ....... Editar página (o editor) × Ver página pública (o site, outra aba)
Regras ........ npx vitest run tests/unit/f53-prontidao-e-areas.test.ts
Navegador ..... npx playwright test tests/e2e/f53-painel-e-areas.spec.ts
```

Quatro regras: **a prontidão é REGRA DE DOMÍNIO com alvo declarado** (o que falta, por que
importa, com que gravidade e onde se resolve — provado sem navegador); **pendência que não é
acionável não entra** (trilha só com chamada científica publicada, patrocínio nunca,
programação e inscrição vazias só depois que o evento está no ar) — painel que acusa o que
não importa ensina a ser ignorado; **o painel é LEITURA do que a tela já carrega** (nenhuma
consulta nova: é impossível divergir do que está logo abaixo); e **a navegação do evento NÃO
vira casco** — o casco lateral foi tentado nesta mesma fase, rejeitado no uso e desfeito
(ADR-297): quem já tem sidebar não ganha um segundo.
### Selo de contagem nos cartões (FASE 54)

```
Selo .......... /t/<slug>/administracao/eventos/<eventId> → "3 chamadas", "nenhuma vaga retida"
Contagem ...... src/lib/events/event-area-counts.ts (uma leitura, por EVENTO, só o que vale)
Frase ......... src/domain/events/event-areas.ts → eventAreaMetric (zero ≠ null)
Regras ........ npx vitest run tests/unit/f54-selo-de-contagem.test.ts
Banco ......... npx vitest run tests/integration/f54-area-counts.test.ts
```

Duas regras: **zero e `null` são coisas diferentes** — zero é "contei e não há" e aparece no selo
("nenhuma chamada"); `null` é "não contei" e o cartão sai **sem selo**, porque afirmar um número não
conferido é pior do que não afirmar nada; e **fato contado pela tela não é recontado pelo serviço** —
as vagas retidas vêm do número que a página já calculou (o serviço devolve `null` ali, com teste
prendendo), senão o selo e o painel de prontidão poderiam divergir no dia seguinte.
### As seções da raiz viram páginas (FASE 55)

```
Reconhecimento ... /t/<slug>/administracao/eventos/<eventId>/reconhecimento   (CARD_GRANT)
Dados do evento ... /t/<slug>/administracao/eventos/<eventId>/dados            (EVENT_UPDATE)
Salas ............ /t/<slug>/administracao/eventos/<eventId>/salas            (EVENT_UPDATE)
Programação ...... /t/<slug>/administracao/eventos/<eventId>/programacao    (EVENT_UPDATE)
Cartões .......... identificador estável: `legacyTestId ?? event-area-<id>`
Navegador ........ npx playwright test tests/e2e/f53-painel-e-areas.spec.ts
```

**Cada área da raiz é um cartão que leva a uma tela** — nada volta a ser sanfona embutida
(ADR-301); **mover uma seção não muda o `data-testid` dela** (ADR-302) e a ordem das fatias é por
ENTRELAÇAMENTO (ADR-303). **As quatro fatias estão entregues.**

### Contas do seed — **não têm senha**

`ana@`, `bruno@`, `carla@`, `diego@example.test` existem para exercitar RBAC e tenancy;
elas **não têm linha em `account`**, então login por senha falha — é intencional. Para
usá-las na interface: crie uma conta em `/signup`, vincule-a (`user_tenant_profiles`, `status =
ACTIVE`, com `tenantId`) e conceda um papel (`role_assignments`) — o caminho rápido é
`tests/e2e/helpers.ts`.

### Contas de teste com senha

`npm run db:seed:dev` cria **16 contas** `@eventflow.test` (uma por perfil, mais os estados de borda; nomes e papéis em `docs/contas-de-teste.md`), com a senha de `SEED_TEST_PASSWORD` no `.env`. O script é idempotente, **regrava a senha** em cada execução e **recusa rodar com `NODE_ENV=production`**. Ele apaga e recria as PRÓPRIAS concessões (marcadas por `reason`), então mudar um escopo no script não deixa a concessão antiga vigente.
Sobre a senha: ela vive em `account.password` (scrypt do Better Auth); `user.passwordHash` é
**legado e não é usado**.

### Dados de demonstração

Dois tenants (`ufba-demo`, `fiocruz-demo`), 2 eventos, **5 atividades** (uma com confirmação de
vaga), 1 trilha com rubrica, 2 perfis de revisor, 7 cartas, 6 missões, 9 fatos de XP, **2
certificados**, **1 sorteio apurado**, **1 página pública publicada** (tema próprio, **2 cotas de
patrocínio com cor e tamanho diferentes**), **11 versões no histórico**, a página do simpósio com
**janela de exibição** (fuso `America/Bahia`), o **acervo de mídia**, **1 palestrante** (Bruno) com
perfil, vínculo, conta e material, **2 chamadas publicadas** com **1 proposta recebida**, **1 vaga
RETIDA** (carla) e **1 QR de estande** (FASE 42). Percursos no `README.md` §6.

---

## 7. Onde as coisas estão

```
docs/                  documentação por fase (ADRs, lições, evidências)
README.md              instalação, seed, contas, variáveis e índice dos docs
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

> As fases **1 a 25** (FASE 79), **29 a 30** (FASE 82), **31 a 35** (FASE 83), **36 a 42**
> (FASE 84) e **43 a 49** (FASE 85, quando a linha nova levou o arquivo a **65.986 bytes**)
> foram movidas **como estavam** para
> [`docs/fases-historico.md`](docs/fases-historico.md); o registro de cada uma segue em
> `docs/fase-NN-*.md` e no `README.md`. A tabela abaixo é a corrente (**50 a 85**).

| Fase | Tema | Situação |
|---|---|---|
| 50 | **Mutirão de dívidas II** — onze dívidas (**C7, E26, E49, E50, E51, E52, E53, E55, E59, E71 e H5**), com **cinco defeitos reais** no caminho. Detalhe em `docs/fase-50-mutirao-de-dividas-ii.md` | ✅ |
| 51 | **Mutirão de dívidas III** — onze dívidas (**E7, E19, E32, E37, E42, E57, E58, E63, E66, E70 e E73**) e um **defeito real de INTEGRIDADE** (a assinatura entrou no veredito público e no download). Detalhe em `docs/fase-51-mutirao-de-dividas-iii.md` | ✅ |
| 52 | **"Fechar o que abrimos"** — a **dívida que nós criamos**: o **token de aviso** em claro × escuro com contraste **medido** e catraca que lê o CSS (6,44:1 / 7,09:1 no claro; 9,17:1 no telão), com o **portão WCAG AA sem isenções**; **um único `<main>` por tela** … | ✅ |
| 53 | **Painel de prontidão e áreas do evento** — a raiz do evento diz **o que falta para o evento ficar pronto** (pendências com efeito, gravidade, ordem e o caminho que resolve), e a faixa de links virou **grade de cartões nos quatro grupos**, … | ✅ |
| 54 | **O selo de contagem nos cartões** — cada área da raiz diz quanto há lá dentro, contado por evento e só sobre o que vale, em uma leitura; a frase é regra de domínio (zero aparece, `null` é "não sei" e vira SEM SELO) | ✅ |
| 55 | **As seções da raiz viram páginas com cartão** — as quatro sanfonas viraram **páginas** e a raiz ficou **prontidão + mapa**: 341 linhas (eram 955), **ZERO `<details>`** no E2E, `data-testid` preservados e 7 specs reapontados | ✅ |
| 56 | **Mutirão de dívidas da Jornada do participante** — nove dívidas do tema E em 4 fatias (fila no EVENTO + promoção com prazo, paginação e retirada da submissão, miniatura e WebP). … | ✅ |
| 57 | **Gantt e calendário das demandas** — duas vistas novas no quadro da F38 (`?vista=kanban\|gantt\|calendario`): eixo de dias no fuso do evento, barra com `startAt` ou criação (**estimada**) e calendário no dia do PRAZO. Uma leitura, três vistas, links | ✅ |
| 58 | **As telas novas no portão de acessibilidade** — `/demandas` (três vistas) e `/superadmin/denuncias` no `axe` WCAG AA; o **contraste do calendário (2,9:1)** foi corrigido, sem isenção nova. ADR-317/318 | ✅ |
| 59 | **O item do patrocinador e a barra que recolhe** — o item do menu passou a depender do **VÍNCULO** (`sponsor_users` ativo), não de `sponsor:read` (pacote mínimo, que fazia a área aparecer para revisor e dono); e a barra lateral ganhou dois estados (`full` × `rail`), com o estado em **cookie no servidor** | ✅ |
| 60 | **O que se oculta fica oculto · landmark em toda tela · suíte E2E estável** — **E79**: a ocultação passou a valer em toda superfície que cita a pessoa, inclusive o **sorteio público**; **I2** … | ✅ |
| 61 | **Modo noturno (dívida H3)** — a escala escura troca **só a camada de tokens**, com **três estados** (Claro · Escuro · Sistema) valendo **sem cookie e sem JavaScript**; controle no menu de conta e em `/conta`, com contraste **medido**. … | ✅ |
| 62 | **A tela medida · a suíte honesta · dois fechamentos** — **H6**: regressão visual com `toHaveScreenshot` (12 snapshots, `maxDiffPixelRatio: 0`, `threshold` 0,04 **medido**); **I3**: espera que repete o gesto, `workers: 1` e `npm run e2e:clean`; **E80/E81** | ✅ |
| 63 | **A aparência do visitante** — o visitante anônimo escolhe a aparência no rodapé das páginas públicas da plataforma: um componente só, sem JavaScript, no mesmo cookie `ef_tema`; a página do evento ficou de fora (o modo é do organizador) e um teste prende isso | ✅ |
| 64 | **A página pública da instituição** — `/t/<slug>` virou a **vitrine da casa** (capa, identidade, três grupos por DATA e blocos do editor); sem página publicada serve a listagem. … | ✅ |
| 65 | **O dia do evento na mão do participante** — favoritar é **INTENÇÃO** e inscrever-se é **LUGAR**; a **"minha agenda"** une as duas marcas com **aviso de choque** sem bloquear; a grade sai em **`.ics`**. … | ✅ |
| 66 | **O rótulo que ficou fora do portão** — o `eyebrow` media **4,44:1** sobre a `--ef-background` e sobreviveu à F65 porque a aba **"Programação"** não estava no portão; passou a `.ef-muted` (**5,08:1** / **5,91:1**). … | ✅ |
| 67 | **Mala direta por fatos reais** — catálogo de 15 condições com frase explicativa, composição que recusa em vez de falhar aberto e catraca catálogo↔construtor; aba "Segmentos" com contagem, prévia mascarada e outbox; descadastro com token próprio. Portão 20 → 23; visual 19 → 21. ADR-338 … 340 | ✅ |
| 68 | **O evento que não era de três dias** — a chamada vira **interruptor do evento** (`usesCall`; ausente **não** desliga) e as **duas colunas da janela são REMOVIDAS**; a chamada da F33 é a única fonte da verdade e o **`CFP_CLOSED` passa a ser devolvido … | ✅ |
| 69 | **Mutirão dos pequenos** — cinco dívidas quitadas: **E86** (margem de deslocamento pura de 15 min), **E82** (ranking mascarado pós-ordem), **E84** (papéis semânticos no tema do evento, 2 casos WCAG AA), **E83** (gesto repetido) e **E88** (motivo do descadastro sem atraso). ADR-344 … 346 | ✅ |
| 70 | **A inscrição que não deixa buraco · o formulário que o organizador monta** — reserva de vaga movida para o evento (`EVENT_AUTO`), `registrationRequiresMembership` no servidor e formulário por evento com allowlist de 6 tipos (ADR-347 … 349) … | ✅ |
| 71 | **A vitrine viva da plataforma · Descoberta e expansão institucional** — descoberta unificada em `/eventos` (abas + redirect 308), taxonomia `EventCategory`, landing com destaques e `/para-instituicoes` com leads (ADR-350 … 353) … | ✅ |
| 72 | **A API de leitura do evento** — `/api/v1` por evento com **projeção única** (`getPublicEventView`), **chave selada por evento**, 5 rotas, ETag/304 sem `generatedAt`, `Vary: Authorization`, 120/min e 401 uniforme (ADR-354 … 356) … | ✅ |
| 73 | **O resultado da chamada que o organizador publica** — publicar deixou de ser decidir: `SEM_RESULTADO`/`RASCUNHO`/`PARCIAL`/**`FINAL` travado**, lista derivada mas **escolhida**, quatro gestos sem JavaScript (ADR-357 … 359) … | ✅ |
| 74 | **A proposta que exige anexo e não pede** — a POSSE do upload vem antes do `inspectObject`, a recusa `NOT_READY` devolve o rascunho e o link, rascunho deixa de ser proposta recebida e a cegueira HERDA da trilha. **E46 re-escopada** (ADR-360 … 362) … | ✅ |
| 75 | **O refactor que mede antes** — a rede de **66 casos** veio antes do movimento; **16** guardas migradas para `guardAction` (+ a `registration` traduzida), com **4 exceções declaradas** (−760 linhas, não 1.500) e catálogo que reprova a cópia nova; a **leitura** extraída dos dois serviços (−2.324 linhas, escrita na mesma transação, catraca por AST); o **contexto** resolvido uma vez por render (2 + 2 → 1 + 1, ≈8 ms — em HTTP é ruído); e as **páginas de erro por área** (0 → 6 arquivos). ADR-363 … 365 | ✅ |
| 76 | **O mutirão dos 500 que deviam ser 404** — o id malformado era **500 exclusivo do FORMATO** (25 de 42): `isUuid` no domínio + `requireUuidParam` (404 antes de consultar) em 23 páginas/24 params e 9 rotas/11 params; a query não é endereço (3 telas ignoram e anunciam), a API ganhou um envelope `{ok:false,code,message}` e a régua **400 = entrada × 404 = endereço**; a catraca achou 2 buracos e a tabela de 35 casos reprovou a si mesma. ADR-366 … 368 | ✅ |
| 77 | **O organizador novo** — o **caminho de partida** (3 fatias com os fatos do render, dentro da prontidão, "pronto" proibido por varredura e o alvo resolvido NO CATÁLOGO — o que consertou o link morto de `sem-programacao`); a **exportação na raiz** (o recorte na PROJEÇÃO, 3/3/210 → 2/2/90, o XP do livro-razão, 3 colunas fora e o `ATTENDANCES_CSV` em formato longo, com migração); e o **demo de LEITURA** (`/t/<slug>/exemplo` por vínculo + catraca de escrita provada por hash). ADR-369 … 371 | ✅ |
| 78 | **O topo único** — a dívida **H1** fechada: **PageHeader server** (split de `navigation.tsx`, sem ~96 ilhas de cliente), com `eyebrow` = grupo de navegação da fonte única, **volta derivada da trilha** e `descriptionTestId`; **81 das 96 páginas migradas** e **15 exceções** motivadas (tema do evento, heróis, renderizador próprio e redirects); **`text-headline`** (16px) eliminado e **6 telas sem `<h1>`** corrigidas. Catracas: **fonte** + **12 telas** no navegador. ADR-372 … 374 | ✅ |
| 79 | **O `AGENTS.md` volta a respirar** — as fases **1 a 25** saíram da tabela da §9 e foram **movidas como estavam** para `docs/fases-historico.md` (nenhuma linha reescrita), com um ponteiro de três linhas no lugar; a tabela corrente ficou com folga real e uma catraca nova reprova fase histórica na tabela e fase corrente no histórico. ADR-375 | ✅ |
| 80 | **O ESLint 10, sem mudar uma linha de código** — `eslint` de `^9.39.5` para `^10.13.0` (o alvo medido): **920 arquivos lintados, 0/0** (o mesmo número de antes), `typecheck` 0, **4389 testes**, `build` OK e `npm ci` limpo com o lock novo; os três plugins do `eslint-config-next` (react, jsx-a11y e import) ainda declaram peer `^9` e o npm avisa `ERESOLVE` sem falhar — compatibilidade medida, não declarada; o E2E mediu **6 vermelhos** (3 de `label-content-name-mismatch`, expostos pelo `axe-core` 4.14; 2 de imagem pela seção mascarada que cresce com o dado; 1 intermitente de minuto no `f65`), nenhum do ESLint. ADR-376 | ✅ |
| 81 | **O rótulo que cabe no nome · a altura que não depende do dado** — os **3 `aria-label`** passaram a **começar** pelo texto visível (`Baixar .ics…`, `Adicionar a próxima…`, `Baixar a minha agenda…`), com catraca de fonte de **6 casos**; a seção de destaques da raiz passou a reservar **duas fileiras de cartão** (498 px = 2 × 237 + vão) e o resumo a uma linha, então a página mede **714 px de seção / 3334 px de página** com 0 a 6 eventos — provado com **um evento a mais** e o `f62` **duas vezes a 0 px**, sem re-basear; o intermitente de minuto do `f65` virou determinístico (a expectativa usa o instante gravado); o portão fechou **39/39** e o `f62` **23/23**. ADR-377 | ✅ |
| 82 | **A porta de entrada** — o destino de quem entra virou **regra pura** (`resolveEntryDestination`: `redirectTo` **OVERRIDE** → plataforma → vínculo `ACTIVE` → convite → `/eventos`, com **14 recusas** de destino), consumida só na ENTRADA por um adaptador que não derruba o login; o **`redirectTo` do login, morto**, voltou a valer sem `tenantSlug` e o `//evil.test` do 2FA foi fechado por **uma** validação; o rodapé do seletor passou a **"Ir ao painel da instituição"** (com um vínculo a linha é `<span>`, então era o único caminho) e o bloco de conta de `/superadmin` ganhou a **porta de volta**; `/eventos` no portão achou `select-name` nos **3 filtros**. **62** testes unit + **8** E2E. ADR-378/379 | ✅ |
| 83 | **O vínculo com significado e o resíduo que ninguém apagava** — o contexto implícito deixou de ser "o primeiro vínculo `ACTIVE` na ordem alfabética" e passou a ter **desempate declarado** (`MEMBER` → `joinedAt` mais antigo → `tenantId`), com a **pergunta** (seletor) quando há **2+ vínculos e nenhuma escolha**; o cookie é a escolha já dada e vence a contagem. O vínculo criado por inscrição em `WAITLISTED` **permanece** (é como a pessoa vê a fila). **4 de 96 fixtures** (114 chamadas) deixaram de criar instituição sem apagar, presas por **catraca de AST** sem allowlist; o `joinedAt` deixou de ser reescrito pelo seed e pela inscrição (só o `create` o define), provado com o **seed real** e a data fixada em 2020; `docs/contas-de-teste.md:107` afirmava o contrário do código. **26 + 6 + 3** testes Vitest + **2** E2E; E2E **481 = 480 + 1 skip**. ADR-380/381 | ✅ |
| 84 | **O painel é do perfil, e a prova do RBAC é da identidade** — o painel deixou de ser a **parede de 65 permissões** (chave crua + UUID de papel) e passou a responder "o que importa para MIM": **regra pura** `dashboardBlocksFor` com **9 blocos**, precedência declarada, **teto 5**, **colapso de destino repetido ANTES do teto** e a frase "e mais N atalhos" (o anúncio sai da MESMA decisão do corte). A prova do RBAC mudou para `/conta` (global): 7º cartão **"Seus acessos"** com instituição, `roleLabel()` e **nº de permissões efetivas** (14 participante · 65 instituição · 47 organizador+revisor), pagando **1 consulta**. O painel saiu `role-summary`, `permissions`, o cartão "Permissões efetivas", o placeholder falso e a URL canônica; entraram `DashboardContextLink` (testid novo `dashboard-context`), `stats` só da gestão (de `getAdminOverview`, **com `deletedAt`**; o `tx.*.count()` sem filtro saiu) e estado vazio com link para `/conta#seus-acessos`. A **2ª leitura do principal** saiu (`context.principal`) e a catraca da F75 cobriu o painel (1 + 1). **6 fontes de leitura** no pior perfil, com a **régua** declarada (≠ 6 comandos SQL: `listReviewerTasks` abre 2 transações e `getAdminOverview` roda 12 counts); `hasSpeakerProfile` pelo **PAPEL** (a permissão faria todo OWNER ver o portal) e patrocinador pelo **vínculo**. Declarados: **CHAIR** no estado vazio (bloco `comite` proposto), **FINANCE** vazio e `listAdminEvents` fora. **4 baselines** refeitas (2 execuções a 0 px); **46 + 9** Vitest + **6** E2E; dívidas **E91** e **I10**. ADR-382/383 | ✅ |
| 85 | **A emissão é do evento, e a simulação é o mesmo serviço** — o cartão "Certificados" do grupo Resultado prometia a emissão do evento e entregava o **inventário** da instituição (defeito do catálogo, achado na tela); o painel de lote ganhou rota própria (`/administracao/eventos/<id>/certificados`, `certificate:issue`, 404 antes da consulta, topo único com `eyebrow` `operacao`) e a tela **simula antes de disparar**: **quatro contadores** (escopo · elegíveis · descartadas · a emitir), **`previewEventCertificates`** com a MESMA `evaluateEligibility` e os MESMOS fatos (`baseFactsFrom`), **6 chamadas Prisma fixas** contra 7 por pessoa (2.100 em 300), o **motivo do descarte** preservado (`discarded`, antes `skipped += 1`), estimativa por `Job.processedOn/finishedOn` com **amostra mínima 5** ("soma do trabalho, não o relógio") e a fila só com o que `certificateQueueStats` devolve; prova de igualdade: **6 pessoas / 1 elegível / 12 pares / 2 emitidos = 2 previstos / 10 descartes texto a texto / 0 escritos pelo preview**; dívida **E92** (soma por LINHA de attendance, declarada). **15 testes Vitest** + **4 E2E**; E2E **491 passando + 1 skip** (492 casos). ADR-384/385 | ✅ |
> **Numeração de tema, não de ordem.** O número identifica o TEMA, e o humano o escolhe
> pelo nome: por isso a F16, a F17, a F23, a F24 e a F25 vieram antes da F15, e a F21 foi
> entregue depois de todas. A tabela segue a ordem cronológica.

**Dívidas técnicas:** o levantamento consolidado (**47 itens abertos**; A=4, B=6, C=1, D=3, **E=25**, F=5, **H=0**, **I=3**) está em **`docs/dividas-tecnicas.md`**. A contagem é **medida linha por linha**, e a tabela da §3 daquele documento bate com ela desde a FASE 69. A **F79** **declarou a I8** (a segunda cópia das contagens no `README.md`); a **F82** **declarou a I9** (o `sign-out` sem corpo responde 415 e não limpa sessão — 99 chamadas em 77 arquivos de teste): a contagem passa a **44**.
Quitados recentemente: **F51**, **F52**, **F56** (as nove do tema E), **F60** (**E79, I1, I2, I3**), **F61** (**H3**), **F62** (**H6, I3, E80, E81**), **F64** (a **E84** da página da instituição), **F69** (**E86, E82, E83, E88 e E84**), **F72** (o upload presigned do MinIO novo) e **F78** (a **H1** — o topo único). As fases **F66, F73, F74 e F75** não quitaram nem declararam item: deixaram pontos de atenção nos próprios documentos e a **F74** **re-escopou a E46** (o anexo inline na página pública continua fora). A **F76** fechou o id malformado (404 **antes** da consulta) e **declarou a E89** (o `?evento=` inválido cai em outro evento). A **F77** também não quitou nem declarou item: fechou o link morto e o recorte da projeção — defeitos que ela mesma mediu — e deixou declarado o que ficou aberto (§8 do doc). A **F78** fechou a **H1** (o topo único) e **declarou a E90** (as classes do tema do evento fora do `.ef-theme`). A contagem passa a **43** porque 42 + 1 = 43 (a **I8**). As fases **F80** (o ESLint 10) e **F81** (o rótulo no nome) não quitaram nem declararam item: os defeitos que elas fecharam não tinham código de dívida. A **F82** **declarou a I9** — o `POST /api/auth/sign-out` **sem corpo** responde **415** e não limpa sessão, no padrão de **99 chamadas em 77 arquivos de teste**: a contagem passa a **44** (I=2). A **F83** **não quitou nem declarou item**: o resíduo de **50 instituições** no banco de **desenvolvimento** é **dado local** (a catraca impede resíduo novo, e a limpeza está proposta em `docs/fase-83-vinculo-e-residuo.md` §8.1); a catraca por AST tem limite **declarado** (forma, não efeito) e a duplicação do menu de conta é ponto de atenção — **a contagem permanece 44**. A **F84** **declarou DUAS**: a **E91** — o `tenant:billing:manage` **não tem leitor** (o `FINANCE` recebe a permissão de cobrança e não existe tela de financeiro; o painel dele nasce vazio, de propósito) — e a **I10** — o `listSponsorAccess` é pago **duas vezes** no mesmo render (layout + página): a contagem passa a **46** (E=24, I=3). A **F85** **declarou UMA**: a **E92** — a soma por **LINHA** de `attendances` (duas visitas de 30 min na mesma atividade de 60 são avaliadas separadamente; a Gabi da fixture é descartada 2× e, somadas, seriam 4 certificados em vez de 2): a contagem passa a **47** (E=25).
Seguem abertas: **E76, E77, E78, E85** (assinatura `webcal` + revogação individual do endereço de exportação da agenda — FASE 65), **E87** (sem revogação individual do endereço de descadastro — FASE 67), **E89** (o `?evento=` inválido cai em outro evento, em silêncio — FASE 76), **E90** (o `.ef-card`/`.ef-button-outline` fora do tema — FASE 78), **I8** (a segunda cópia das contagens no `README.md` — FASE 79), **I9** (o `sign-out` sem corpo responde 415 e não limpa sessão: 99 chamadas em 77 arquivos de teste — FASE 82), **E91** (o `tenant:billing:manage` sem leitor: não existe tela de financeiro — FASE 84), **I10** (o `listSponsorAccess` pago 2× no render: layout + página — FASE 84), **E92** (a presença somada por LINHA de attendance: duas visitas de 30 min na mesma atividade de 60 são avaliadas separadamente — FASE 85), **A7** (o falso positivo do casamento por fragmento de tipo sensível), **B10** (a varredura dos `catch` silenciosos das contagens) e **B11** (o custo da prévia da API — 5 chamadas de handler por render — declarado na FASE 72).

---

## 10. Primeira ação de uma sessão nova

1. Ler `README.md`, `docs/design-system.md`, `docs/dividas-tecnicas.md`,
   `docs/armadilhas.md` (a tabela COMPLETA das 106 armadilhas) e o documento da **última
   fase entregue** (`docs/fase-85-emissao-do-evento.md`; antes, F84, F83, F82, F81, F80, F79, F78, F77, F76, F75, F74, F73, F72, F71, F70, F69 e F68; a
   comunicação é `docs/fase-15-comunicacao.md`).
2. Rodar a bateria da seção 4 para confirmar que a árvore está verde **antes** de
   mexer em qualquer coisa (se algo falhar, isso é o primeiro trabalho).
3. Apresentar ao humano o **plano da fase pedida** (domínio → aplicação → interface →
   testes → documentação) e **aguardar** a definição/requisitos dela.
4. Implementar, verificar, documentar e **parar** em `Aguardando APROVADO: AVANÇAR`.
