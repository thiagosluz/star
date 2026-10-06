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
Fases concluídas ........ 1 a 17, 21 a 25, **29 a 69** (**F56 a F69 entregues**)
Testes ................. 3498 (Vitest: unit + integração) + **375** (Playwright E2E) + 1 skip
ADRs ................... 346 (numeração GLOBAL e sequencial — a próxima é ADR-347)
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
estado **confere o tamanho no fim** (`(Get-Item AGENTS.md).Length`) e, se passar do teto,
**condensa linhas históricas da tabela da §9** — corte em ~300 caracteres, num limite de
palavra, fechando a linha com ` … | ✅ |` — em vez de deixar o corte escolher o que sai. O
registro completo do que foi condensado vive no documento de cada fase e no `README.md`.

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
npm test              # esperado: 3105+ testes passando
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
npm run test:e2e      # esperado: 375 passando + 1 skip (376 no total)
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

| Fase | Tema | Situação |
|---|---|---|
| 1 | Infraestrutura, modelagem, RLS | ✅ |
| 2 | Autenticação, RBAC, multi-tenancy | ✅ |
| 3 | Eventos, inscrições, landing pages (chamada por trilha, lotação atômica, lista de espera, landing modular) — **+ duas revisões pós-entrega**: inscrição no EVENTO incluindo as atividades abertas (`EVENT_AUTO`), editar/excluir atividade e **ciclo de vida da SALA** (capacidade opcional = sem … | ✅ |
| 4 | Submissões e avaliação por pares (chamada por trilha, upload direto com SHA-256, afinidade, conflito de interesse, revisão cega, nota ponderada no servidor, decisão com quórum) — **+ revisão pós-entrega**: o rascunho cai direto na página da submissão, não nasce inválido e pode ser editado/excluído | ✅ |
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
| 24 | Mídia e agendamento (E14–E17: acervo com reaproveitamento por checksum, sincronia da cópia, janela de exibição e agendamento no fuso do evento) | ✅ |
| 25 | Portal do palestrante (E21–E24: perfil do palestrante como pessoa da instituição, convite por token hasheado e vínculo de conta em dois caminhos, portal com posse verificada no banco, materiais com visibilidade por visitante, vitrine com foto e bio, certificado `SPEAKER` com carga apurada) — **+ revisão pós-entrega**: o item de menu voltou a aparecer para as permissões pessoais e o convite pendente virou porta de entrada (ADR-119/120) | ✅ |
| 21 | Ciclo de vida do membro e storage (C4, C5: troca de papéis e remoção lógica do membro pela tela de equipe com posse do OWNER protegida, quota de **armazenamento aplicada de verdade** em todo envio — submissão, mídia e material de palestrante — medida sobre tudo o que a instituição guarda) | ✅ |
| 22 | Operação de palco (G8–G13: **desfazer** a entrega com motivo na trilha, filtro do histórico por situação e período, premiar N revisores, **endereço próprio** do resultado publicado, chave do cofre **versionada** e prévia ao vivo por SSE com polling de volta) — **+ correção de privacidade**: o consentimento de perfil público passou a nascer DESLIGADO (ADR-139) | ✅ |
| 29 | Palco público e auditoria do sorteio (**telão** com compromisso antes da apuração, contagem ao vivo e revelação automática; **link + QR** na tela de sorteios; **lista publicada** gravada na apuração e assinada no resultado; **auditoria** que refaz as contas no navegador e receita para conferir fora do site) — escopo definido pelo humano | ✅ |
| 30 | Sorteio ao vivo, em rodadas (cada rodada com o próprio compromisso, prêmio, patrocinador e resultado assinado; **"Criar para o palco"** para o telão existir antes da apuração; **roleta** com os nomes reais da lista publicada parando no ganhador; **payload v4** declarando o momento; auditoria e resultado público **por rodada**) | ✅ |
| 31 | Credenciamento e frequência por crachá (**um código por pessoa** no evento, com o **contexto da leitura** decidindo o fato; **chegada ≠ frequência**, com sessão por visita e minutos com teto no fim da atividade; área de crachás com emissão em massa, **folha A4** em PDF, **crachá online** e **modo monitor** com câmera, leitor USB e digitação) — escopo definido pelo humano | ✅ |
| 32 | Central do participante e inteligência da instituição (**diretório** de todos os participantes — união de vínculo e inscrição —, **ficha 360** com eventos, frequência, certificados, cartas, XP e comunicação, **recado** por e-mail e caixa de entrada, **panorama** com taxa de comparecimento no fuso da instituição, **exportação em CSV** com trilha e abertura de ficha auditada) — escopo definido pelo humano | ✅ |
| 33 | Chamadas de propostas (**chamada como entidade** com tipo, janela, cegueira, **rubrica própria** — CHAMADA → TRILHA → PADRÃO — e limite por autor POR CHAMADA; a proposta **é uma submissão** com campos por tipo e **formulário público**; bloco posicionado pelo organizador; **protocolo de aceite** com a decisão do comitê e criar a atividade/convidar o palestrante como escolhas — o convite quita **E25**) — escopo definido pelo humano | ✅ |
| 34 | Confirmação de vaga com prazo (**escolha do organizador** por atividade: automática × exige confirmação, com prazo, o que é preciso e onde confirmar; a inscrição nasce **retendo a vaga**; **avisos por e-mail e na plataforma**; vencido o prazo a vaga é **liberada**, o próximo da lista de espera é promovido e os dois são avisados; **fila** ordenada pela urgência) — escopo definido pelo humano | ✅ |
| 35 | Resiliência de balcão e palco (**operação sem rede** no credenciamento, **sentido da leitura** no balcão — entrada × saída × alternar —, prêmio e patrocinador da rodada corrigíveis pela tela e **controles do palco** com pausa/replay/atalhos; quitou **E38, E39, E40 e E43**) — escopo definido pelo humano | ✅ |
| 36 | Operação das rotinas automáticas (**histórico, saúde e "executar agora"** em `/superadmin/rotinas`, com a linha em `job_runs` servindo de registro E de exclusão mútua), **inspeção antivírus** dos arquivos (driver com o padrão em NÃO inspecionar, portão nos dois caminhos e ClamAV sob perfil), … | ✅ |
| 37 | Crachá em **etiqueta adesiva** (PDF com grade configurável) e em **impressora térmica** (ZPL II configurável), e **confirmação de vaga por ITEM** (checklist snapshot da inscrição, com a vaga confirmada quando as obrigatórias acabam); quitou **E41** e **E48**) — escopo definido pelo humano | ✅ |
| 38 | **Quadro de demandas internas do evento** (Kanban por evento com colunas configuráveis, equipes com líder, prazo no fuso do evento, comentários com menção avisando por e-mail e caixa de entrada, e o cartão movido por arrastar **ou** por formulário — o quadro funciona sem JavaScript); quitou a METADE da **E50** e declarou **E51** e **E52**) — escopo definido pelo humano | ✅ |
| 39 | **Rubrica com número livre de critérios** (1 a 12 critérios, com a chave **derivada do rótulo**; a **edição de trilha**, que não existia; e a rubrica **congelada a partir do primeiro parecer** — só rótulo, descrição e ordem seguem livres); declarou **E53**) — escopo definido pelo humano | ✅ |
| 40 | **Editor visual do certificado** (arte de fundo da instituição, texto por **variáveis**, posicionamento **arrastando ou digitando milímetros** — funciona sem JavaScript —, cinco modelos prontos, prévia pelo mesmo renderizador do PDF e bloco probatório obrigatório; o desenho **congela no certificado** e sem modelo vale o desenho antigo); declarou **E54** e **E55**) — escopo definido pelo humano | ✅ |
| 41 | **Vitrine do patrocínio** (a cota define **cor** e **tamanho da logo** na página pública — Pequena · Média · Grande · Destaque —, com **prévia do cartão** no cadastro e amostras de cor como atalho; a página desenha uma faixa por cota com **cartões tingidos**; a coluna de cor existia desde a FASE 17 e **não tinha leitor**); não declarou dívida) — escopo definido pelo humano | ✅ |
| 42 | **Experiência do patrocinador** (área de **só leitura** aberta por **vínculo** — convite hasheado ou vínculo direto pela equipe — e não pelo papel; **QR do estande** com **imagem pronta para imprimir** (PNG/SVG), XP e/ou carta **uma vez por pessoa por QR**; na leitura a pessoa escolhe … | ✅ |
| 43 | **Catálogo de gamificação** (auditoria dos gatilhos → **editar** e **excluir** carta e missão, com exclusão **LÓGICA**: a carta sai do catálogo mas **fica no álbum de quem a ganhou**, e é recusada quando é prêmio de missão/QR; a missão preserva progresso e XP resgatado); e os fatos que não … | ✅ |
| 44 | **Perfil público do participante** — `/u/<handle>` com **quinze campos** em três níveis (internet · quem participa da instituição · só eu), pacote **campo a campo** por allowlist testada, **404 para perfil todo privado**, e a página **só existe onde a pessoa participa** (o `user` é global: a … | ✅ |
| 45 | **Equipe do evento na página pública** — bloco que o organizador adiciona ou não, com o corpo lido das equipes REAIS do evento na renderização; a etiqueta é o nome da equipe (quem está em duas aparece uma vez com as duas), líder … | ✅ |
| 46 | **Imagens em WebP e a foto do palestrante sem conta** — toda imagem é **reconvertida no servidor** na confirmação (o original é apagado, perda calibrada na foto e nenhuma no logotipo, metadados descartados e orientação EXIF … | ✅ |
| 47 | **Área de conta e segurança da identidade** — `/conta` é **GLOBAL** (a identidade vale em qualquer instituição e existe sem vínculo): dados com confirmação no endereço novo e a senha atual como prova, foto em WebP, troca de senha … | ✅ |
| 48 | **Carta colecionável premium e compartilhamento** — palco **3D** com brilho holográfico e verso, geometria no DOMÍNIO; a apresentação é DADO (`holo`, `sheen`, `tilt`, `backUrl`) e o foil acende o brilho sozinho; o link é **POR … | ✅ |
| 49 | **Exportação com marca d'água e prazo · Trilha de identidade** (o CSV de dado pessoal virou **PEDIDO** com prazo de 24 h: `data_exports` guarda o ATO — autor, filtros, linhas, downloads e revogação — e o arquivo é **regerado no … | ✅ |
| 50 | **Mutirão de dívidas II** — onze dívidas (**C7, E26, E49, E50, E51, E52, E53, E55, E59, E71 e H5**), com **cinco defeitos reais** no caminho. Detalhe em `docs/fase-50-mutirao-de-dividas-ii.md` | ✅ |
| 51 | **Mutirão de dívidas III** — onze dívidas (**E7, E19, E32, E37, E42, E57, E58, E63, E66, E70 e E73**) e um **defeito real de INTEGRIDADE** (a assinatura entrou no veredito público e no download). Detalhe em `docs/fase-51-mutirao-de-dividas-iii.md` | ✅ |
| 52 | **"Fechar o que abrimos"** — a **dívida que nós criamos**: o **token de aviso** separado em claro × escuro com o contraste **medido** e preso por catraca que lê o CSS (6,44:1 / 7,09:1 no claro; 9,17:1 no telão), deixando o **portão WCAG AA sem isenções**; **um único `<main>` por tela** (a … | ✅ |
| 53 | **Painel de prontidão e áreas do evento** — a raiz do evento diz **o que falta para o evento ficar pronto** (pendências com efeito, gravidade, ordem e o caminho que resolve, e a régua do que NÃO é pendência), e a faixa de links virou **grade de cartões nos quatro grupos do trabalho**, … | ✅ |
| 54 | **O selo de contagem nos cartões** — cada área da raiz diz **quanto há lá dentro** ("3 chamadas", "nenhuma vaga retida"), contado **por evento** e só sobre o que vale, em **uma leitura**. A frase é regra de domínio: **zero aparece** e **`null` é "não sei" e vira SEM SELO**; as vagas retidas são o número que a tela já calculou (o serviço devolve `null`, com teste) | ✅ |
| 55 | **As seções da raiz viram páginas com cartão** — as quatro sanfonas da raiz do evento viraram **páginas com cartão** e a raiz ficou **prontidão + mapa**: 341 linhas (eram 955) e **ZERO `<details>`**, preso no E2E. `data-testid` preservados, 7 specs reapontados | ✅ |
| 56 | **Mutirão de dívidas da Jornada do participante** — nove dívidas do tema E, em 4 fatias, **TODAS ENTREGUES**: fila de espera no EVENTO + promoção com prazo e aceite da pessoa (E33/E1); paginação das listas públicas + retirada da submissão pelo autor (E2/E31); miniatura do acervo e reprocessamento em WebP; e os demais itens de alcance | ✅ |
| 57 | **Gantt e calendário das demandas** — duas vistas novas no quadro da F38 (`?vista=kanban\|gantt\|calendario`): eixo de dias no fuso do evento, barra começando em `startAt` ou na criação (**marcada como estimada**) e calendário com as demandas no dia do PRAZO. Uma leitura, três vistas, navegação por link | ✅ |
| 58 | **As telas novas no portão de acessibilidade** — `/demandas` (três vistas) e `/superadmin/denuncias` no `axe` WCAG AA, com fixtures; o **contraste do calendário (2,9:1)** foi corrigido, sem isenção nova. ADR-317/318 | ✅ |
| 59 | **O item do patrocinador e a barra que recolhe** — o item do menu passou a depender do **VÍNCULO** (`sponsor_users` ativo), não de `sponsor:read` (permissão do pacote mínimo, que fazia a área aparecer para revisor e dono); e a barra lateral ganhou dois estados (`full` × `rail`), com o estado em **cookie lido no servidor** | ✅ |
| 60 | **O que se oculta fica oculto · toda tela tem landmark · a suíte E2E para de mentir** — **E79**: a ocultação passou a valer em toda superfície que cita a pessoa (bloco Equipe, link selado da carta e o **sorteio público**, que publicava o nome inteiro), por fonte única no domínio; e **I2** … | ✅ |
| 61 | **Modo noturno (dívida H3)** — a escala escura troca **só a camada de tokens**, com **três estados** (Claro · Escuro · Sistema), o sistema valendo **sem cookie e sem JavaScript** e a escolha de Claro vencendo o escuro; controle no menu de conta e em `/conta`, com contraste **medido nos dois … | ✅ |
| 62 | **A tela medida · a suíte honesta · dois fechamentos** — **H6**: regressão visual com `toHaveScreenshot` (12 snapshots, `maxDiffPixelRatio: 0`, `threshold` 0,04 **medido**); **I3**: espera que repete o gesto, `workers: 1` **com número** e `npm run e2e:clean`; **E80** e **E81** | ✅ |
| 63 | **A aparência do visitante** — o visitante **anônimo** escolhe a aparência no **rodapé** das páginas públicas da plataforma (`/`, `/organizacoes`, `/validar/<código>`, `/validar/lote`): **um componente só**, **sem JavaScript**, no **mesmo cookie** `ef_tema` (a escolha **sobrevive ao login**). A **página do evento ficou de fora** (o modo é do organizador) e um teste prende isso | ✅ |
| 64 | **A página pública da instituição** — `/t/<slug>` deixou de ser `redirect` e virou a **vitrine da casa** (capa, identidade, os **três grupos por DATA** na renderização e blocos do editor; sem página publicada o endereço segue servindo a listagem). Rascunho × publicado é SNAPSHOT na mesma … | ✅ |
| 65 | **O dia do evento na mão do participante** — favoritar é **INTENÇÃO** e inscrever-se é **LUGAR** (`activity_favorites`, RLS + FORCE, não consome vaga); a **"minha agenda"** une as duas marcas com o **aviso de choque que nunca bloqueia**; a grade sai em **`.ics`** (dobra em BYTES) e no … | ✅ |
| 66 | **O rótulo que ficou fora do portão** — o `eyebrow` do `SectionHeading` media **4,44:1** sobre a `--ef-background` do organizador e sobreviveu à F65 porque a aba **"Programação"** não estava no portão: passou a usar o papel do tema (`.ef-muted`, **5,08:1** no claro e **5,91:1** no escuro), a … | ✅ |
| 67 | **Mala direta por fatos reais** — catálogo de **15 condições** de domínio com frase explicativa, composição que **recusa** em vez de falhar aberto e catraca catálogo↔construtor nos dois sentidos; aba **"Segmentos"** com a contagem antes do envio, prévia mascarada pela F60 e disparo em lotes pelo outbox da F15; e **descadastro** com token próprio e envio que pula quem saiu. Portão 20 → **23**; visual 19 → **21**. ADR-338 … 340 | ✅ |
| 68 | **O evento que não era de três dias** — a chamada vira **interruptor do evento** (`usesCall`; ausente **não** desliga) e as **duas colunas da janela são REMOVIDAS**; a chamada da F33 passa a ser a única fonte da verdade e o **`CFP_CLOSED`, declarado e nunca devolvido, passa a ser devolvido … | ✅ |
| 69 | **Mutirão dos pequenos** — cinco dívidas quitadas por inteiro: **E86** (a **margem de deslocamento** entre salas virou parâmetro da regra pura, com **15 min** declarados no domínio e **margem zero ≡ régua da F65**, presa em 9 pares — e **sem configuração por evento**), **E82** (o **ranking de revisores** deixou de citar quem a moderação ocultou: lê o nome pela fonte única e **mascara DEPOIS de ordenar**, preservando posição, contagem e elegibilidade), **E84 por inteiro** (o escopo do evento passou a **republicar os papéis semânticos da plataforma no modo do TEMA** — o texto secundário saiu de **2,10:1** / **1,86:1** para **11,59:1** / **10,28:1** —, e o portão ganhou **2 casos** novos com **mutação provada**), **E83** (os quatro pontos da família repetem o **GESTO** até o fato) e **E88** (o **descadastro pergunta o motivo** — quatro opções, nenhuma obrigatória, e a saída **nunca atrasa**). Os **quatro pontos da FASE 68**: o seed cria o evento que publica chamadas com **`usesCall: true`**, os **rótulos de modalidade** ganharam **fonte única no domínio** (fallback preservado e provado pelo ternário antigo como oráculo), o **endereço da sala online apareceu na "minha agenda"** reusando a régua e o serviço da F68 (a **lista de espera e o anônimo não o recebem**: `page.content()` prova nos dois sentidos) e o **bloco de LOCAL** ganhou **linha de base visual**. Portão WCAG AA de 26 → **28 casos** (sem isenção); visual de 21 → **22 linhas de base**, com a do `descadastro` regerada **depois de medir** (38.174 px). A fatia 5 **morreu sem escrever nada** e foi absorvida pelo fechamento. ADR-344 … 346 | ✅ |
> **Numeração de tema, não de ordem.** O número identifica o TEMA, e o humano o escolhe
> pelo nome: por isso a F16, a F17, a F23, a F24 e a F25 vieram antes da F15, e a F21 foi
> entregue depois de todas. A tabela segue a ordem cronológica.

**Dívidas técnicas:** o levantamento consolidado (**38 itens abertos**; A=3, B=4, C=1, D=3, E=21, F=5, H=1, I=0) está em **`docs/dividas-tecnicas.md`**. A contagem é **medida linha por linha**, e a tabela da §3 daquele documento passou a bater com ela (a defasagem que vinha da FASE 51 foi corrigida na FASE 69).
Quitados recentemente: **F51**, **F52**, **F56** (as nove do tema E), **F60** (**E79, I1, I2, I3**), **F61** (**H3**), **F62** (**H6, I3, E80, E81**), **F64** (**E84 para a PÁGINA DA INSTITUIÇÃO**) e **F69** (**E86, E82, E83, E88 e E84 por inteiro** — o claro/escuro do visitante dentro do tema do organizador). A **F66** não quitou nem declarou item: fechou o rótulo de seção (que não estava no levantamento) e corrigiu a contagem.
Seguem abertas: **E76, E77, E78, E85** (assinatura `webcal` + revogação individual do endereço de exportação da agenda — FASE 65) e **E87** (sem revogação individual do endereço de descadastro — FASE 67).

---

## 10. Primeira ação de uma sessão nova

1. Ler `README.md`, `docs/design-system.md`, `docs/dividas-tecnicas.md`,
   `docs/armadilhas.md` (a tabela COMPLETA das 106 armadilhas) e o documento da **última
   fase entregue** (`docs/fase-69-mutirao-dos-pequenos.md`; antes, F68, F67, F66, F65 e F64; a
   comunicação é `docs/fase-15-comunicacao.md`).
2. Rodar a bateria da seção 4 para confirmar que a árvore está verde **antes** de
   mexer em qualquer coisa (se algo falhar, isso é o primeiro trabalho).
3. Apresentar ao humano o **plano da fase pedida** (domínio → aplicação → interface →
   testes → documentação) e **aguardar** a definição/requisitos dela.
4. Implementar, verificar, documentar e **parar** em `Aguardando APROVADO: AVANÇAR`.
