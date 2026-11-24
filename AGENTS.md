# AGENTS.md — Protocolo de trabalho da Koveno

> **Este arquivo é o primeiro que uma sessão de agente deve ler.**
> Ele existe porque a memória durável deste projeto é o **repositório**, não a
> conversa: uma sessão nova não lembra de nada do chat anterior, mas encontra aqui o
> combinado de como trabalhar, o que verificar e onde as coisas estão.

---

## 1. O que é este projeto

**Koveno** (ex-**EventFlow**) — plataforma SaaS multi-tenant para eventos acadêmicos, corporativos e
comunitários: eventos e inscrições, submissão de trabalhos com avaliação por pares,
gamificação (XP, cartas, missões) e certificação com validação pública por QR Code.

**Estado atual:**

```text
Fases concluídas ........ 1 a 17, 21 a 25, **29 a 125** (**F56 a F125 entregues**)
Testes ................. **5006** (Vitest: unit + integração, 309 arquivos) + **569** (Playwright E2E) + 1 skip
ADRs ................... 504 (numeração GLOBAL e sequencial — a próxima é ADR-505)
Permissões ............. 66 (11 papéis, 4 escopos)
Tabelas de tenant ...... 65 sob RLS + FORCE (+ as partições mensais de audit_logs)
Tabelas de plataforma .. job_runs, two_factor, identity_audit_logs e cookie_consents — sem RLS (ou sem tenant) e SEM acesso para a role de runtime (verificado no contrato)
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
fases **1 a 25**, **29 a 30**, **31 a 35**, **36 a 42**, **43 a 49**, **50 a 59**, **60**, **61 a 62**, **63 a 65**, **66 a 67**, **68 a 69**, **70 a 71**, **72 a 74**, **75 a 76**, **77 a 78**, **79 a 80**, **81 a 82**, **83** (FASE 101), **84** (FASE 102), **85** (FASE 103), **86** (FASE 104), **87** (FASE 106), **88** (FASE 107), **89** (FASE 108), **90 a 91** (FASE 109), **92 a 93** (FASE 110), **94 a 95** (FASE 111), **96 a 97** (FASE 113), **98 a 99** (FASE 114) **100** (FASE 115), **101** (FASE 116), **102** (FASE 117), **103** (FASE 118), **104** (FASE 119), **105** (FASE 122), **106** (FASE 123), **107** (FASE 124) e **108** (FASE 125),
movidas como estavam — o cabeçalho de lá registra cada movimento e o byte count —
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
npm test              # esperado: 4999 testes passando (308 arquivos)
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
npm run test:e2e      # esperado: **565 passando + 1 skip** (566 casos); medido na F116: +1 cenário novo (em f116);
                      # nenhum vermelho
```

**Armadilha crítica de verificação:** se o `--build` falhar, o `docker compose`
**mantém o container anterior no ar** e o E2E passa a medir código que não existe.
Um `docker compose ps` dizendo "healthy" **não prova** que a imagem é a nova. Por
isso: (a) leia a saída completa do build, (b) confirme a data da imagem,
(c) confirme que a rota nova responde (307/200, não 404).

---

## 5. Armadilhas conhecidas (custaram depuração real)

> **A tabela COMPLETA — 107 armadilhas, cada uma com sintoma, causa raiz e correção — vive em
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

> As fases **1 a 25**, **29 a 30**, **31 a 35**, **36 a 42**, **43 a 49**, **50 a 59**, **60**, **61 a 62**, **63 a 65**, **66 a 67**, **68 a 69**, **70 a 71**, **72 a 74**, **75 a 76**, **77 a 78**, **79 a 80**, **81 a 82**, **83** (FASE 101), **84** (FASE 102), **85** (FASE 103), **86** (FASE 104), **87** (FASE 106), **88** (FASE 107), **89** (FASE 108), **90 a 91** (FASE 109), **92 a 93** (FASE 110), **94 a 95** (FASE 111), **96 a 97** (FASE 113), **98 a 99** (FASE 114), **100** (FASE 115), **101** (FASE 116), **102** (FASE 117), **103** (FASE 118), **104** (FASE 119), **105** (FASE 122), **106** (FASE 123), **107** (FASE 124) e **108** (FASE 125) foram movidas
> **como estavam** para [`docs/fases-historico.md`](docs/fases-historico.md); o cabeçalho de lá
> registra cada movimento e o byte count. O registro de cada uma segue em `docs/fase-NN-*.md`
> e no `README.md`. A tabela abaixo é a corrente (**109 a 125**).

| Fase | Tema | Situação |
|---|---|---|
| 109 | **Fechamento Final de UX, React 19 & App Router** — `AdminForm` mantendo `useUnsavedChanges` após salvamento (`warnUnsaved` em `dados` e `meu-perfil-publico`), `CreateSubmissionForm` filtrando trilhas por evento e preservação pós-erro `{ ok: false }` (`values`/`defaultChecked`) em `RequestResetForm`, `EventRegistrationDataForm`, `CertificatePolicyPanel`, `LeadStatusForm` e `ClaimInviteForm` (ADR-446); `<GetSearchForm>` preservando `submitter` em 9 rotas/componentes GET, `<AppLink>` em 4 clientes (`AccountForms`, `SponsorQrCreateForm`, `RaffleHistory`, `RaffleStage`) e `startTransition` programático em `UnsavedChangesDialog`/`ClaimSpeakerInviteForm` (ADR-447); `<FormStatusButton>` (`useFormStatus()`) em Server forms, rótulos `pending` alinhados, fuso explícito em `meu-cracha` e `suppressHydrationWarning` em 6 clientes `.toLocale*String('pt-BR')` (ADR-448). **7 testes Vitest** + **3 E2E**; Vitest **4871** (287 arquivos); E2E **544 passando + 1 skip** (545 casos). ADR-446 … 448 | ✅ |
| 110 | **Privacidade, Consentimento Real, Autoatendimento de Conta e Observabilidade** — `/privacidade` (inventário `2026.11-v1`), `/termos` e `/acessibilidade` sob `<PageHeader>` nos rodapés + tabela de plataforma `cookie_consents` (`PLATFORM_ONLY_TABLES`, revogada em `00-roles.sql`) + banner `<aside>` não-modal No-JS onde `ESSENTIAL_ONLY` apaga e bloqueia `ef_tema`/`ef_nav` (ADR-449); snapshot `consentVersion`/`consentText` em `registrations` visível em `minhas-inscricoes` + `maskIpAddress` (`/24` e `/48`) em trilhas, cookies e `/conta` (ADR-450); exclusão/anonimização própria em `/conta` (`deleteOwnAccount`, guarda de último `OWNER`, cancelamento de vagas futuras) (ADR-451); alertas em `/api/metrics` e `/superadmin/metricas` (**B9**) + migração de 238 `console.*` para `logger` com catraca AST (**B6**, ADR-452). **10 Vitest** + **4 integr.** + **5 E2E**; Vitest **4885** (289 arquivos); E2E **549 passando + 1 skip** (550 casos); 42 dívidas abertas. ADR-449 … 452 | ✅ |
| 111 | **Publicação de Anais, Citações e Indexação (Custo Zero)** — modelos `proceedings_volumes` e `proceedings_entries` sob RLS + FORCE com snapshot editorial imutável (`snapshotAuthors`/`snapshotAbstract`/`snapshotKeywords`, ADR-453); fluxo pós-aceite em `submissoes/[id]` para envio de `CAMERA_READY` (`canUploadSubmissionFile`) e termo versionado (`proceedingsPermissionAcceptedAt`/`Version`), com exclusão estrita de `BLIND_PDF` (`canUseFileKindInProceedings`, ADR-454); painel do evento (`/administracao/eventos/[id]/anais`), vitrine pública (`/anais` e `/anais/[protocol]`), caixa/download de citações (ABNT, APA, `.bib`, `.ris`), streaming inline seguro de PDF (`/anais/[protocol]/arquivo` sob `canServeFile` para `citation_pdf_url`, ADR-455), metatags Highwire Press + Dublin Core + JSON-LD `ScholarlyArticle`, `sitemap.xml`/`robots.txt` e OAI-PMH 2.0 (`/api/oai` via `systemClient` + `withTenant` e por evento, ADR-456). **8 Vitest** + **2 integr.** + **5 E2E**; Vitest **4895** (291 arquivos); E2E **554 passando + 1 skip** (555 casos); 42 dívidas mantidas. ADR-453 … 456 | ✅ |
| 112 | **O Bloco do Comitê Científico (`CHAIR`) no Painel e Fechamento do Fluxo Editorial** — bloco `'comite'` (`/comite`) separado de `'pareceres'` (`/revisoes`) em `dashboard-blocks.ts`, com fato dinâmico real da fila (`listSubmissionsForChair`) em `DashboardPage` e suporte ao perfil acumulado `CHAIR + REVIEWER` sem alterar os 5 blocos de `OWNER`/`ADMIN` (ADR-457); curadoria e publicação de Anais (`/administracao/eventos/[id]/anais`, `EVENT_AREAS` e 5 Server Actions em `proceedings-actions.ts`) abertas para `PERMISSIONS.SUBMISSION_DECIDE`, com atalho direto no topo de `/comite` (`chair-proceedings-links`) e trilha de retorno ao comitê (ADR-458); e eliminação de 2ª chamada a `getRequestContext()` após `requirePagePermission` em `/comite/[submissionId]` e `/reconhecimento` (ADR-459). **11 Vitest** + **3 E2E**; Vitest **4906** (292 arquivos); E2E **557 passando + 1 skip** (558 casos); 42 dívidas mantidas. ADR-457 … 459 | ✅ |
| 113 | **Autocredenciamento e Autocheck-in por QR Code com Segurança Antifraude** — tabela `self_checkin_points` sob RLS + índices parciais para pontos ativos (`ADR-460`); regras puras (`self-checkin-rules.ts`), TOTP HMAC-SHA256 60s e PIN (`self-checkin-totp.ts`), extensão de `checkIn` (`SELF_DECLARED`, `ADR-462`), geofencing Haversine + `maxAccuracyMeters`, anti-ubiquidade (`CONCURRENT_ACTIVITY_OPEN`), cooldown de saída e IP LGPD (`self-checkin-service.ts`, `self-checkin-actions.ts`); cartaz A4 PDF/SVG/PNG (`/api/t/[tenantSlug]/credenciamento/cartaz`), Telão dinâmico (`/credenciamento/telao/[pointId]` + `/api/...`), portal móvel (`/presenca/[token]`) e painel em `/credenciamento` (`ADR-461`). **14 Vitest** + **4 E2E**; Vitest **4920** (294 arquivos); E2E **561 passando + 1 skip**. ADR-460 … 462 | ✅ |
| 114 | **Ergonomia de Balcão, Abas por URL e Refinos de App Router no Credenciamento** — separação em abas reais por query (`?aba=balcao` vs `?aba=autocredenciamento`), grid desktop `lg:grid-cols-12`, `<CheckinQueueSection>` sob `<Suspense>` com filtro `statusFilter` (`Todos`/`Aguardando`/`Presentes`), aviso de truncamento e consolidação em 1 transação `withTenant` sem 2º `getRequestContext()` (`ADR-463`); `monitor-feedback` acima de `<ScanGate>`, saída imediata pontual (`modeInputRef`) sem corromper `localStorage`, trava `scanInFlightRef` e `ConfirmSubmitButton` no fechamento em massa (`ADR-464`); política antifraude recolhível (`<details>`), filtro de atividades, `Copiar link`, `Cartaz com PIN`, exclusão com `<ConfirmDialog>` (`deleteSelfCheckinPoint`/`deleteSelfCheckinPointAction`), correção de `lastActionKind` e fuso explícito em `SelfCheckinManager` (`ADR-465`). **8 Vitest** + **2 E2E**; Vitest **4929** (295 arquivos); E2E **563 passando + 1 skip**. ADR-463 … 465 | ✅ |
| 115 | **Sincronização de Contexto (Portaria × Atividade), Registro Manual Contextual e Fila Escalável no Credenciamento** — consolidação opt-in de 1 card por participante (`deduplicateByUser: true`) ordenado por `user.name ASC` com mapas pré-computados `registrationIdByContext` e `openSessionsByContext` (`ADR-466`); sincronização instantânea entre `MonitorConsole` e `CheckinQueue` via `CHECKIN_CONTEXT_EVENT` (`queue-context-banner` + selos de vínculo) e suporte a `contextKind`/`targetActivityId` em `checkIn`/`checkOut` (`attendance-service.ts`, `attendance-actions.ts`) para registrar chegada na Portaria ou frequência em atividades abertas/restritas (`ADR-467`); e contenção de scroll vertical (`max-h-[520px] overflow-y-auto`) na fila manual (`ADR-468`). **9 Vitest** (`6` unit. + `3` integr.) + **1 E2E**; Vitest **4938** (297 arquivos); E2E **564 passando + 1 skip**. ADR-466 … 468 | ✅ |
| 116 | **Cache de Leitura Pública, API v1 no Redis e Otimização de Payload/Streaming no Balcão** — regras puras em `public-cache-rules.ts` + cache JSON distribuído em Redis com invalidação O(1) por versão (`INCR`) e falha aberta (`redis-json-cache.ts`, `public-read-cache.ts`), `React.cache` + `Promise.all` na página pública (sem vazar sessão/`onlineUrl`) e `Cache-Control` CDN em `/validar/:code` sem cachear `NOT_FOUND` (`ADR-469`); cache de envelope + `ETag` no Redis pós-portas de segurança na API v1 (`event-api-route-handlers.ts`, `6,1×` vazão, `ADR-470`); e streaming de `CheckinDeskSummarySection` em `<Suspense>` + janela inicial de `25` cards sem busca em `/credenciamento` (`-35%` HTML, `ADR-471`). **8 Vitest** (`6` unit. + `2` integr.) + **1 E2E**; Vitest **4946** (299 arquivos); E2E **565 passando + 1 skip**. ADR-469 … 471 | ✅ |
| 117 | **Consolidação DRY de Primitivos de UI, Hooks e Utilitários Compartilhados** — utilitários puros em `src/domain/shared/` (`asRecord`/`asRecordOrNull`, `round2`, `stripDiacritics`, `date-format` com `Intl.DateTimeFormat` cacheado), `parseImageMime` (`image-rules.ts`), `buildPublicAssetUrl` (`s3-client.ts`) e `getRedisUrl` (`redis/config.ts`) (`ADR-472`); `form-data.ts`, `request-meta.ts` (`import("next/headers")` preguiçoso + `extractClientIp`), `file-crypto.ts` (`sha256Hex`/`readMagicBytes`) e unificação de `*ActionState` sobre `ActionGuardState` (`ADR-473`); hooks `useIsInteractive` e `useCopyToClipboard` + primitivos `<CopyButton>`, `<ActionFeedback>` e `<SubmitButton>` em `@/components/ui`, com `0 px` de diferença visual em `f62` e catraca estrutural DRY (`ADR-474`). **12 Vitest**; Vitest **4958** (300 arquivos); E2E **565 passando + 1 skip**. ADR-472 … 474 | ✅ |
| 118 | **Faxina de Código Morto e Redução de Superfície de Server Actions** — exclusão do componente órfão `badge-checkin-form.tsx` (`112` linhas), remoção das 6 Server Actions `use server` sem consumidor (`loadAccount`, `checkInByBadgeAction`, `requestCertificateDownloadAction`, `enterTenantAction`, `adjustXpAction`, `saveSponsorQrAction`), fechamento do `export` em `deleteCertificateTemplateAction` e em 5 componentes internos (`ActivityCard`, `SpeakerCard`, `ShellNav`, `InviteTokenBox`, `PublicEventCard`), com catraca AST travando ações e componentes órfãos (`ADR-475`); remoção de 32 funções mortas (0 chamadores em todo o repositório) + 18 imports/helpers em cascata até `tsc --noEmit --noUnusedLocals` zerar (`ADR-476`). **3 Vitest**; Vitest **4961** (301 arquivos); E2E **565 passando + 1 skip**. ADR-475 … 476 | ✅ |
| 119 | **Performance da Prévia da API (`B11`), Paginação do Acervo de Mídia, Modularização de Serviços e Quitação de `I8` + `E95`** — leitura única compartilhada (`resolveTenant`/`verifyKey`/`loadProjections` memoizados) na prévia de `/administracao/eventos/[id]/api` mantendo as 5 portas HTTP (`5× → 1×`, quita **B11**, `ADR-477`); paginação real `?pagina=N` sem JS em `/pagina/midia` (`parseMediaPage`, `computeMediaPagination`, `buildMediaPageHref`, `ADR-478`); fatiamento de `registration-service.ts` (`registration-types.ts` + `registration-participant-link.ts`, `-671` linhas) e `certificate-service.ts` (`certificate-read-service.ts`, `-735` linhas) mantendo reexportações e catracas F75/F85 (`ADR-479`); senha padrão `Koveno@2026`/`Koveno#2026` no seed/doc/35 specs (**E95**) e catraca de sincronia `AGENTS.md × README.md × dividas-tecnicas × armadilhas` (**I8**, `ADR-480`). **8 Vitest**; Vitest **4969** (302 arquivos); E2E **565 passando + 1 skip**; **39 dívidas abertas**. ADR-477 … 480 | ✅ |
| 120 | **Modularização SRP de Client Components Críticos e Redução de Profundidade JSX** — fatiamento de `certificate-template-editor.tsx` (`1381 → 250` linhas, `jsxDepth 13 → 7`) em 8 submódulos sob `certificate-template/` com migração das exceções de papel em `f61` (`ADR-481`); extração em `RaffleStage` (`722 → 181` linhas) dos hooks `useRaffleLiveStream` e `useRaffleRoulette` + views (`ADR-482`); isolamento do motor de câmera em `useQrCameraScanner` (`qr-camera-reader.tsx` `511 → 120`) e subcomponentes do `MonitorConsole` (`602 → 341`) preservando `f99`/`f114`/`f115` (`ADR-483`); e catraca AST de linhas/aninhamento em `f120-modularizacao-srp-client-components.test.ts` (`ADR-484`). **7 Vitest**; Vitest **4976** (303 arquivos); E2E **565 passando + 1 skip**; **39 dívidas abertas**. ADR-481 … 484 | ✅ |
| 121 | **Modularização SRP das Frentes 2 (Client) e 3 (Server Pages & God Modules)** — fatiamento de `RaffleHistory` (`1094 → 182`), `SelfCheckinManager` (`843 → 154`) e `BlockContentFields` (`513 → 66`) em submódulos coesos preservando `f109`/`f114` (`ADR-485`); decomposição de `BlockRenderer` (`1439 → 109`, `jsxDepth 1`) e da página da atividade (`755 → 211`) sob `events/` com registro em `f73`/`f89` (`ADR-486`); extração dos painéis de `comunicacao/page.tsx` (`1364 → 129`) e `demandas/page.tsx` (`907 → 331`, props serializáveis para "Ver mais", `ADR-487`); e suíte SSR + catraca AST dos 7 alvos (`6915 → 1182`, 26 submódulos) em `f121-*.test.ts` (`ADR-488`). **7 Vitest**; Vitest **4983** (304 arquivos); E2E **565 passando + 1 skip**; **39 dívidas abertas**. ADR-485 … 488 | ✅ |
| 122 | **Gestão Financeira, Fomento e Prestação de Contas do Evento** — domínio puro em centavos inteiros (`event-finance-rules.ts`) com 3 estágios (`PLANNED`/`COMMITTED`/`SETTLED`), teto e carimbo de rubricas por edital (`restrictedCategories`, FAPEG/CNPq/CAPES/FUNAPE/UF/IF) e exportadores CSV UTF-8 BOM (`ADR-489`); tabelas `event_funding_sources` e `event_financial_entries` sob RLS + FORCE (`63 → 65` tabelas), importação em 1 clique de `Sponsor.contractValueCents` e guarda `SOURCE_HAS_ENTRIES` (`ADR-490`); cartão `"Finanças e fomento"` em `EVENT_AREAS` (`SPONSOR_MANAGE`) + 6 Server Actions + `/api/t/[tenantSlug]/financeiro/exportar` com trilha `EXPORT` (`ADR-491`); e cockpit `/administracao/eventos/[eventId]/financeiro` com 5 componentes (`<= 290`L) e 3 gráficos SVG vetoriais SSR (`ADR-492`). **7 Vitest** (`6` unit. + `1` integr.) + **1 E2E**; Vitest **4990** (306 arquivos); E2E **566 passando + 1 skip**; **39 dívidas abertas**. ADR-489 … 492 | ✅ |
| 123 | **Refinamento de UX Operacional, Prevenção Proativa de Glosa e Ciclo Completo de Execução Financeira** — funções puras `evaluateEntryCompliance` (aviso prévio de rubrica proibida e saldo projetado do teto antes do envio), `isEntryCategoryViolation`, `computeFilteredLedgerTotals`, `categoriesForEntryType` e `formatIsoDatePtBr` (`DD/MM/AAAA`, `ADR-493`); ciclo completo no livro-razão (`PLANNED` → `COMMITTED` → `SETTLED` com `documentNumber` inline → `CANCELED`), badge `Rubrica fora do edital` por linha e subtotais do recorte filtrado (`ADR-494`); reset automático em lote na fase de render pós-`{ ok: true }`, campos adaptativos `INCOME` × `EXPENSE` e ocultação de `settledOn` fora de `SETTLED` (`ADR-495`); guia de onboarding no estado vazio, selo de escopo na exportação CSV e *drill-down* clicável `?fonte=` / `?categoria=` nos gráficos (`ADR-496`). **4 Vitest** + **1 E2E**; Vitest **4994** (307 arquivos); E2E **567 passando + 1 skip**; **39 dívidas abertas**. ADR-493 … 496 | ✅ |
| 124 | **Abas por Intenção, Rotas Dedicadas de Edição e Checklist de Conformidade Financeira** — separação de `/financeiro` em 3 abas por URL (`?aba=resumo\|lancamentos\|fontes` com `resolveFinanceTab` abrindo `lancamentos` sob filtro), filtros de pendência (`GLOSA`, `MISSING_DOCUMENT`, `UNASSIGNED_SOURCE`) e paginação (`20`/página, `ADR-497`); edição de fontes (`updateFundingSource` para aditivos) e lançamentos (`updateFinancialEntry` para reatribuir glosas) com auditoria `UPDATE` (`ADR-498`); 4 rotas `/novo` e `/editar` dedicadas com `requireUuidParam` + `<PageHeader>`, checklist documental clicável, exportação CSV colada ao filtro e menu `Mais` na linha (`ADR-499`); catracas `f76`/`f78` e suítes F124 (`ADR-500`). **5 Vitest** (`4` unit. + `1` integr.) + **1 E2E**; Vitest **4999** (308 arquivos); E2E **568 passando + 1 skip**; **39 dívidas abertas**. ADR-497 … 500 | ✅ |
| 125 | **Cockpit de Patrocinadores por Intenção, Rotas Dedicadas de Cotas/Edição e Ergonomia de Estandes & Leads** — 3 abas por URL (`?aba=patrocinadores\|cotas\|estandes` com promoção de `?confirmarQr=`/`?exportacao=`/`?erro=` em `resolveSponsorTab`) e KPIs executivos com ponte `/financeiro` (`computeSponsorKpiSummary`, `ADR-501`); leituras unitárias (`getSponsorTierForEdit`/`getSponsorForEdit`), contagem única `getEventSponsorExperienceCounts` em 1 transação e `revalidatePath(..., 'layout')` (`ADR-502`); `SponsorKpiCards`, 3 rotas `/cotas/nova`, `/cotas/[tierId]/editar` e `/[sponsorId]/editar` (`requireUuidParam` + `<PageHeader>`), `<AssetUploader>` recolhido após envio e filtro `?patrocinador=`/pré-preenchimento de `contactEmail` (`ADR-503`); catracas `f76`/`f78`/`f94` e suítes F125 (`ADR-504`). **7 Vitest** + **1 E2E**; Vitest **5006** (309 arquivos); E2E **569 passando + 1 skip**; **39 dívidas abertas**. ADR-501 … 504 | ✅ |
> **Numeração de tema, não de ordem.** O número identifica o TEMA, e o humano o escolhe
> pelo nome: por isso a F16, a F17, a F23, a F24 e a F25 vieram antes da F15, e a F21 foi
> entregue depois de todas. A tabela segue a ordem cronológica.

**Dívidas técnicas:** o levantamento consolidado (**39 itens abertos**; A=4, **B=2**, C=1, D=3, **E=24**, F=5, **H=0**, **I=0**) está em **`docs/dividas-tecnicas.md`**; a contagem é **medida linha por linha** e a §3 daquele documento bate com ela desde a FASE 69. Quitados recentemente: **F51**, **F52**, **F56** (as nove do tema E), **F60** (**E79, I1, I2, I3**), **F61** (**H3**), **F62** (**H6, I3, E80, E81**), **F64** (a **E84** da página da instituição), **F69** (**E86, E82, E83, E88 e E84**), **F72** (o upload presigned do MinIO novo), **F78** (a **H1**), **F86** (a **E92**), **F88** (**I10, B10 e I9**), **F89** (**E89 e E90**), **F110** (**B6 e B9**) e **F119** (**B11, E95 e I8** — zerando o tema I). As fases **F66, F73, F74, F75, F77, F80, F81, F83, F87, F90, F91 e F92** não quitaram nem declararam item. Declaradas no caminho: **E91** (F84), **E93** e **E94** (F86).
Seguem abertas: **E76, E77, E78, E85** (assinatura `webcal` + revogação individual), **E87** (sem revogação individual do descadastro), **E91** (`tenant:billing:manage` sem leitor), **E93** (detalhamento congelado não assinado), **E94** (`Activity.minAttendancePercent`/`requiresAttendance` sem leitor) e **A7** (casamento por fragmento de tipo sensível).

---

## 10. Primeira ação de uma sessão nova

1. Ler `README.md`, `docs/design-system.md`, `docs/dividas-tecnicas.md`,
   `docs/armadilhas.md` (a tabela COMPLETA das 107 armadilhas) e o documento da **última
   fase entregue** (`docs/fase-124-abas-edicao-e-conformidade-financeira.md`; antes, F123, F122, F121, F120, F119, F118, F117, F116, F115, F114, F113, F112, F111, F110, F97, ..., F68; a
   comunicação é `docs/fase-15-comunicacao.md`).
2. Rodar a bateria da seção 4 para confirmar que a árvore está verde **antes** de
   mexer em qualquer coisa (se algo falhar, isso é o primeiro trabalho).
3. Apresentar ao humano o **plano da fase pedida** (domínio → aplicação → interface →
   testes → documentação) e **aguardar** a definição/requisitos dela.
4. Implementar, verificar, documentar e **parar** em `Aguardando APROVADO: AVANÇAR`.
