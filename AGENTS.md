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
Fases concluídas ........ 1 a 17, 21 a 25, 29 a 43 (F15, F21–F25, F29–F43 entregues; a F44+ é a próxima)
Testes ................. 2228 (Vitest: unit + integração) + 148 (Playwright E2E)
ADRs ................... 235 (numeração GLOBAL e sequencial — a próxima é ADR-236)
Permissões ............. 65 (11 papéis, 4 escopos)
Tabelas de tenant ...... 55 sob RLS + FORCE (+ as partições mensais de audit_logs)
Tabelas de plataforma .. job_runs — sem RLS e SEM acesso para a role de runtime (verificado no contrato)
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
npm test              # esperado: 2228+ testes passando
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
npm run test:e2e      # esperado: 148+ testes passando
```

**Armadilha crítica de verificação:** se o `--build` falhar, o `docker compose`
**mantém o container anterior no ar** e o E2E passa a medir código que não existe.
Um `docker compose ps` dizendo "healthy" **não prova** que a imagem é a nova. Por
isso: (a) leia a saída completa do build, (b) confirme a data da imagem,
(c) confirme que a rota nova responde (307/200, não 404).

---

## 5. Armadilhas conhecidas (custaram depuração real)

> **A tabela COMPLETA — 97 armadilhas, cada uma com sintoma, causa raiz e correção — vive em
> [`docs/armadilhas.md`](docs/armadilhas.md)**, e a seção 10 manda lê-la antes de mexer em
> qualquer coisa. Os números são estáveis e citados no código e nos documentos de fase — não
> renumere. As duas mais recentes, como amostra do que a regra protege:

* **96 — Ordem por chave que empata**: quando a ordem decide QUAL registro é o escolhido por
  padrão, a chave precisa ser única (início → criação → id); `ORDER BY startsAt` sozinho devolve
  ordem arbitrária entre iguais, e a tela abre num registro diferente a cada consulta.
* **97 — Erro engolido DENTRO da transação**: um `catch` que só registra o erro não ressuscita a
  transação — e o `COMMIT` de uma transação abortada é `ROLLBACK` **sem erro** no PostgreSQL. O
  serviço responde `ok` e nada foi gravado. Concessão de papel, auditoria e efeito colateral vão
  **DEPOIS do commit**, e quem confere antes de inserir não precisa de `catch`.

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
(com o slug do tenant virando curinga) e o scrape lê `getJobCounts()`/`getWorkersCount()` do
BullMQ — é assim que se sabe se o worker está vivo. O log estruturado
(`src/lib/observability/logger.ts`) redige senha/token e mascara e-mail.

### PgBouncer (FASE 13)

Pool em modo **transação**: seguro porque o contexto de tenant é `SET LOCAL` (invariante nº 2) e o
projeto não usa recurso de sessão (advisory lock, `LISTEN`/`NOTIFY`, prepared statement nomeado).
Prova: `npm run db:verify:pooling`.

### Partições da auditoria (FASE 13 · operação desde a FASE 36)

`audit_logs` é particionada por mês em `createdAt`, com partição `DEFAULT` para que gravar
auditoria nunca falhe. **Quem mantém é a rotina `audit-partitions` do WORKER** (diária às 3h,
registrada em `job_runs`): cria o mês atual e os seguintes e resgata o que caiu na `DEFAULT`,
aplicando RLS + FORCE e concessões em cada partição nova. A CLI `npm run db:partitions` chama o
MESMO serviço para quem opera sem worker. Retenção é `DROP TABLE audit_logs_<AAAA_MM>` — decisão
de negócio em aberto (dívida B8): a manutenção **cria** e nunca **apaga**.

### Inspeção antivírus dos arquivos (FASE 36)

O arquivo de terceiro passa por inspeção antes de ser servido ao comitê, **quando a inspeção está
ligada**. O driver padrão é `none` — **não inspecionar** —, e aí o arquivo nasce `SKIPPED` ("não
inspecionado"), é servido normalmente e a tela diz isso.

```bash
docker compose --profile av up -d clamav   # perfil próprio; ~1 GB de assinaturas
# .env: SCAN_DRIVER=clamav · CLAMAV_HOST=clamav · CLAMAV_PORT=3310
```

Três regras que quebram fácil: **`INFECTED` nunca é servido** (nem com a inspeção desligada
depois); **`PENDING` só é bloqueado ENQUANTO a inspeção está ligada** (o estado honesto do arquivo
sem inspeção é `SKIPPED`); e **inspeção indisponível NÃO é veredito** — o arquivo continua
`PENDING` para a próxima passada. O portão vale onde a aplicação media os bytes (submissão e
material de palestrante) e **não** em `media_assets`, bucket público (ADR-187).

### Tarefas automáticas e painel de rotinas (FASE 36)

As cinco rotinas — prazos de parecer, presenças em aberto, confirmação de vaga, inspeção de
arquivos e partições — abrem e fecham um registro em `job_runs`.

```bash
# /superadmin/rotinas  → catálogo, saúde, histórico e "Executar agora"
psql "$DATABASE_URL" -c 'SELECT job, status, trigger, items, error FROM job_runs ORDER BY "startedAt" DESC LIMIT 20'
```

Quatro regras que quebram fácil: **a linha em `job_runs` é o registro E a reserva** (índice único
parcial `WHERE status = 'RUNNING'`, e **não** advisory lock — o PgBouncer em modo transação não
preserva lock de sessão, ADR-183); **execução órfã tem prazo de validade** (meia hora; sem isso o
worker que morre no meio trava a rotina para sempre); **a tela lê o CATÁLOGO, não as execuções** —
rotina que nunca rodou aparece como "nunca rodou" (ADR-184); e **o atraso é medido contra a
cadência da própria rotina** (ADR-185). O botão do painel **enfileira** e responde na hora: quem
roda é o worker (ADR-186). `job_runs` é **tabela de plataforma**: sem RLS e **sem privilégio para
a role de runtime**, com a revogação em `docker/postgres/init/00-roles.sql` e a verificação de
contrato reprovando se ela voltar (ADR-191, armadilhas 82–83).

### Lote de certificados em ZIP (FASE 36)

GET `/api/t/<slug>/certificados/zip?evento=<eventId>` (`certificate:issue`) monta o lote em
**fluxo** (um PDF por vez, nada de lote em memória), contando o que ficou de fora no cabeçalho
`x-certificados-fora-do-lote` e registrando `EXPORT` na trilha (ADR-188).

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

A sala ganhou ciclo de vida próprio e passou a ser o **teto das vagas** da atividade que acontece
nela: `/t/<slug>/administracao/eventos/<eventId>` → "Salas" (editar e excluir) e "Programação" →
"Vagas".

Quatro regras que quebram fácil: **capacidade vazia é "sem limite"** (`null`; `0` e negativo são
normalizados na escrita — a coluna nasceu com `DEFAULT 0`, que fazia a sala afirmar "zero
lugares"); **o limite EFETIVO é o menor entre a lotação declarada e a sala**
(`effectiveActivityCapacity`), e é ele que a página pública anuncia; **a sala entra no predicado
ATÔMICO da reserva** (`RESERVE_ACTIVITY_SEAT_SQL` + `ROOM_SEAT_AVAILABLE_PREDICATE`, ADR-135) —
checar em JavaScript antes do `UPDATE` reabriria a superlotação; e **a sala em uso recusa a
exclusão**, com a contagem e o caminho (ADR-136) — a FK é `ON DELETE SET NULL` e sem a guarda a
sala sumiria da programação em silêncio. **Atividade ABERTA é a exceção deliberada:** ela recebe
quem se inscreveu no evento e não tem fila, então o painel **avisa** quando o público excede a
sala (dívida E34) em vez de bloquear.

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
(ADR-146), e **a lista nasce na APURAÇÃO** — enquanto o telão ainda tem em mãos a rodada
anunciada ele ESPERA a releitura em vez de revelar sem roleta (a rodada apurada sem lista,
do histórico antigo, é que revela direto, em vez de inventar nomes — armadilha 78); e **uma
rodada preparada por vez** — dois compromissos no ar deixariam o telão sem saber o que
anunciar.

A rodada 1 do histórico foi **copiada** pela migração para `raffle_rounds`, e as colunas de
semente/lista do sorteio são **legado congelado** desde então. O fluxo ao vivo assina por
RODADA, porque o status do sorteio fica `DRAWN` para sempre depois da primeira apuração.

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

A guarda das Server Actions trata permissão `:own` (armadilha 72); a visão geral usa
`tenant:analytics:read`, permissão que existia desde a FASE 2 sem consumidor.

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
"incluir encerradas"), pela mesma razão dos blocos de agenda e de trilhas: uma chamada
copiada para dentro do bloco mentiria sobre o prazo no dia seguinte (ADR-168).

### Confirmação de vaga com prazo (FASE 34)

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

Quatro regras que quebram fácil: **desfazer entrega limpa o RECIBO, não o sorteio** — a posição
continua sendo a ganhadora, e a trilha guarda as duas pontas com o **motivo obrigatório**
(ADR-137); **o filtro do histórico é o dia da INSTITUIÇÃO** (armadilhas 38 e 57); **a chave do
cofre tem VERSÃO** (`RAFFLE_SEED_KEYS`, a maior é a atual) e a abertura usa a versão GRAVADA no
sorteio — sem isso, girar a chave apagava a prova de todo o histórico (ADR-138); e **a prévia ao
vivo negocia o transporte** na mesma rota (SSE com o polling como caminho de volta em
`data-transport`).

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
concedido por ATIVIDADE; **cada escrita** reconfere a posse com o `userId` do BANCO (armadilha 42).

**Duas portas para o portal.** Além de quem já é palestrante, entra quem tem **convite
pendente para o e-mail da conta** — o papel nasce com o aceite, então exigi-lo para chegar ao
convite era um impasse. A mesma condição (`pendingInviteWhere`) decide a guarda, o item do
menu (que segue a porta) e a lista (ADR-119/120, `docs/fase-25-portal-do-palestrante.md` §10).


### Comunicação (FASE 15)

O e-mail transacional saiu do papel: **Resend** atrás de um driver com o padrão em **não
enviar**, fila `emails` no BullMQ e um **outbox** (`email_messages`) que guarda o assunto,
o HTML e o texto de cada mensagem **antes** da entrega.

```
Fila e entrega .......... src/lib/communication/{mailer,email-queue,email-service}.ts
Templates (16) .......... src/domain/communication/email-templates.ts   (funções puras)
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
| 3 | Eventos, inscrições, landing pages (chamada por trilha, lotação atômica, lista de espera, landing modular) — **+ duas revisões pós-entrega**: inscrição no EVENTO incluindo as atividades abertas (`EVENT_AUTO`), editar/excluir atividade e **ciclo de vida da SALA** (capacidade opcional = sem limite; a sala é o teto das vagas, aplicado na reserva atômica) — ADR-124/125/126, 134/135/136 | ✅ |
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
| 24 | Mídia e agendamento (E14–E17: biblioteca de mídia com reaproveitamento por checksum e exclusão que confere o uso, sincronia do patrocinador copiado, janela de exibição com `unpublishAt`, data agendada no fuso do evento) | ✅ |
| 25 | Portal do palestrante (E21–E24: perfil do palestrante como pessoa da instituição, convite por token hasheado e vínculo de conta em dois caminhos, portal com posse verificada no banco, materiais com visibilidade por visitante, vitrine com foto e bio, certificado `SPEAKER` com carga apurada) — **+ revisão pós-entrega**: o item de menu voltou a aparecer para as permissões pessoais e o convite pendente virou porta de entrada (ADR-119/120) | ✅ |
| 21 | Ciclo de vida do membro e storage (C4, C5: troca de papéis e remoção lógica do membro pela tela de equipe com posse do OWNER protegida, quota de **armazenamento aplicada de verdade** em todo envio — submissão, mídia e material de palestrante — medida sobre tudo o que a instituição guarda) | ✅ |
| 22 | Operação de palco (G8–G13: **desfazer** a entrega com motivo na trilha, filtro do histórico por situação e período, premiar N revisores, **endereço próprio** do resultado publicado, chave do cofre **versionada** e prévia ao vivo por SSE com polling de volta) — **+ correção de privacidade**: o consentimento de perfil público passou a nascer DESLIGADO (ADR-139) | ✅ |
| 29 | Palco público e auditoria do sorteio (**telão** com compromisso antes da apuração, contagem ao vivo e revelação automática; **link + QR** na tela de sorteios; **lista publicada** gravada na apuração e assinada no resultado; **auditoria** que refaz as contas no navegador e receita para conferir fora do site) — escopo definido pelo humano | ✅ |
| 30 | Sorteio ao vivo, em rodadas (cada rodada com o próprio compromisso, prêmio, patrocinador e resultado assinado; **"Criar para o palco"** para o telão existir antes da apuração; **roleta** com os nomes reais da lista publicada parando no ganhador; **payload v4** declarando o momento; auditoria e resultado público **por rodada**) — escopo definido pelo humano; **+ revisão da FASE 29**: o telão só era alcançável já apurado | ✅ |
| 31 | Credenciamento e frequência por crachá (**um código por pessoa** no evento, com o **contexto da leitura** decidindo o fato; **chegada ≠ frequência**, com sessão por visita e minutos com teto no fim da atividade; área de crachás com emissão em massa, **folha A4** em PDF, **crachá online** e **modo monitor** com câmera, leitor USB e digitação) — escopo definido pelo humano | ✅ |
| 32 | Central do participante e inteligência da instituição (**diretório** de todos os participantes — união de vínculo e inscrição —, **ficha 360** com eventos, frequência, certificados, cartas, XP e comunicação, **recado** por e-mail e caixa de entrada, **panorama** com taxa de comparecimento no fuso da instituição, **exportação em CSV** com trilha e abertura de ficha auditada) — escopo definido pelo humano | ✅ |
| 33 | Chamadas de propostas (**chamada como entidade** com tipo, janela, cegueira, **rubrica própria** — CHAMADA → TRILHA → PADRÃO — e limite por autor POR CHAMADA; a proposta **é uma submissão** com campos por tipo e **formulário público**; bloco posicionado pelo organizador; **protocolo de aceite** com a decisão do comitê e criar a atividade/convidar o palestrante como escolhas — o convite quita **E25**) — escopo definido pelo humano | ✅ |
| 34 | Confirmação de vaga com prazo (**escolha do organizador** por atividade: automática × exige confirmação, com prazo, o que é preciso e onde confirmar; a inscrição nasce **retendo a vaga**; **avisos por e-mail e na plataforma**; vencido o prazo a vaga é **liberada**, o próximo da lista de espera é promovido e os dois são avisados; **fila** ordenada pela urgência) — escopo definido pelo humano | ✅ |
| 35 | Resiliência de balcão e palco (**operação sem rede** no credenciamento, **sentido da leitura** no balcão — entrada × saída × alternar —, prêmio e patrocinador da rodada corrigíveis pela tela e **controles do palco** com pausa/replay/atalhos; quitou **E38, E39, E40 e E43**) — escopo definido pelo humano | ✅ |
| 36 | Operação das rotinas automáticas (**histórico, saúde e "executar agora"** em `/superadmin/rotinas`, com a linha em `job_runs` servindo de registro E de exclusão mútua), **inspeção antivírus** dos arquivos (driver com o padrão em NÃO inspecionar, portão nos dois caminhos e ClamAV sob perfil), **lote de certificados em ZIP** montado em fluxo e **aviso de decisão ao proponente** da chamada; quitou **A3, B7 e E47**) — escopo definido pelo humano | ✅ |
| 37 | Crachá em **etiqueta adesiva** (PDF com grade configurável) e em **impressora térmica** (ZPL II configurável), e **confirmação de vaga por ITEM** (checklist snapshot da inscrição, com a vaga confirmada quando as obrigatórias acabam); quitou **E41** e **E48**) — escopo definido pelo humano | ✅ |
| 38 | **Quadro de demandas internas do evento** (Kanban por evento com colunas configuráveis, equipes com líder, prazo no fuso do evento, comentários com menção avisando por e-mail e caixa de entrada, e o cartão movido por arrastar **ou** por formulário — o quadro funciona sem JavaScript); quitou a METADE da **E50** e declarou **E51** e **E52**) — escopo definido pelo humano | ✅ |
| 39 | **Rubrica com número livre de critérios** (1 a 12 critérios, com a chave **derivada do rótulo**; a **edição de trilha**, que não existia; e a rubrica **congelada a partir do primeiro parecer** — só rótulo, descrição e ordem seguem livres); declarou **E53**) — escopo definido pelo humano | ✅ |
| 40 | **Editor visual do certificado** (arte de fundo da instituição, texto por **variáveis**, posicionamento **arrastando ou digitando milímetros** — funciona sem JavaScript —, cinco modelos prontos, prévia pelo mesmo renderizador do PDF e bloco probatório obrigatório; o desenho **congela no certificado** e sem modelo vale o desenho antigo); declarou **E54** e **E55**) — escopo definido pelo humano | ✅ |
| 41 | **Vitrine do patrocínio** (a cota define **cor** e **tamanho da logo** na página pública — Pequena · Média · Grande · Destaque —, com **prévia do cartão** no cadastro e amostras de cor como atalho; a página desenha uma faixa por cota com **cartões tingidos**; a coluna de cor existia desde a FASE 17 e **não tinha leitor**); não declarou dívida) — escopo definido pelo humano | ✅ |
| 42 | **Experiência do patrocinador** (área de **só leitura** aberta por **vínculo** — convite hasheado ou vínculo direto pela equipe — e não pelo papel; **QR do estande** com **imagem pronta para imprimir** (PNG/SVG), XP e/ou carta **uma vez por pessoa por QR**; na leitura a pessoa escolhe **autorizar** ou não, com o MESMO crédito (LGPD art. 8º §3º); lead de **nome e e-mail** com prazo e **revogação**; painel com QR, equipe e **CSV** dos contatos vigentes); declarou **E56/E57** e achou a **armadilha 97**) — escopo definido pelo humano | ✅ |
| 43 | **Catálogo de gamificação** (auditoria dos gatilhos → **editar** e **excluir** carta e missão, com exclusão **LÓGICA**: a carta sai do catálogo mas **fica no álbum de quem a ganhou**, e é recusada quando é prêmio de missão/QR; a missão preserva progresso e XP resgatado); e os fatos que não moviam nada: **inscrição confirmada** (30 XP nas três portas, chave no ALVO contra farm), **certificado emitido** (50 XP na geração), **sorteio ganho** (0 XP + carta, só o ganhador) e **proposta de chamada** (enviar e aceitar); tirou "Indicação" e "Bônus" do formulário (sem emissor) e achou o defeito que impedia **criar missão pela tela**; declarou **E58/E59**) | ✅ |
| 44+ | *a definir pelo humano* | ⏳ |

> **Numeração de tema, não de ordem.** Cada tema tem um número **FIXO**: o número
> identifica o tema, não a ordem de entrega. Por isso a FASE 16, a FASE 17, a FASE 23, a
> FASE 24 e a FASE 25 foram entregues antes da F15 — e a FASE 21, numerada no meio, foi
> entregue **depois** de todas elas. O humano escolheu o tema pelo nome
> dele. A tabela acima segue a ordem cronológica; a numeração é a do tema.

**Dívidas técnicas:** o levantamento consolidado (**56 itens abertos**; A=3, B=4, C=2, D=3,
E=34, F=5, G=0, H=4, I=1 — o tema G zerou na FASE 22) está em **`docs/dividas-tecnicas.md`**,
com o histórico do que cada fase quitou e declarou. O total publicado até a FASE 35 (55)
somava linhas **já riscadas**; vale a contagem linha a linha do documento. Quitados: **A3, B7,
E47** (F36) e **E41, E48** (F37). Declarados: **E50** (F37), **E51/E52** (F38), **E53** (F39),
**E54/E55** (F40), **E56/E57** (F42) e **E58/E59** (F43) — as FASES 41, 42 e 43 não quitaram
item deste levantamento. Leia antes de propor a próxima fase: ele diz o que falta e a ordem
sugerida.

---

## 10. Primeira ação de uma sessão nova

1. Ler `README.md`, `docs/design-system.md`, `docs/dividas-tecnicas.md`,
   `docs/armadilhas.md` (a tabela COMPLETA das 97 armadilhas) e o documento da **última
   fase entregue** (`docs/fase-43-catalogo-de-gamificacao.md`; a referência de comunicação é
   `docs/fase-15-comunicacao.md`).
2. Rodar a bateria da seção 4 para confirmar que a árvore está verde **antes** de
   mexer em qualquer coisa (se algo falhar, isso é o primeiro trabalho).
3. Apresentar ao humano o **plano da fase pedida** (domínio → aplicação → interface →
   testes → documentação) e **aguardar** a definição/requisitos dela.
4. Implementar, verificar, documentar e **parar** em `Aguardando APROVADO: AVANÇAR`.





