# FASE 32 — Central do participante e inteligência da instituição

> **Escopo definido pelo humano.** *"Preciso de um novo módulo, que é para ter uma visão de
> todos os participantes, eventos que ele participou, certificados que foram gerados para ele,
> conquistas, cartas, envio de email e mensagem, e demais estatísticas, além de uma visão geral
> com as estatísticas da vida da instituição. Cada instituição verá os participantes de todos os
> seus eventos."*
>
> As cinco decisões de desenho foram escolhidas pelo humano antes do código (§3.9).

---

## 1. Sumário executivo

A instituição só conseguia ver pessoas **por evento**: a lista de inscritos, a lista de crachás, a
lista de certificados. A PESSOA — quem participou de quatro eventos ao longo de dois anos — não
tinha um lugar onde aparecesse inteira. Esta fase cria esse lugar: um **diretório** que atravessa
todos os eventos da instituição, uma **ficha 360** de cada pessoa, uma **caixa de entrada** de
recados, e um **panorama** com a vida da instituição por período.

### Entregas

| Entrega | Onde |
|---|---|
| Domínio puro: taxa de comparecimento, engajamento, máscara, limites, chave de deduplicação, CSV seguro, período no fuso da instituição | `src/domain/participants/participant-rules.ts` |
| Diretório cross-evento com agregação no banco (união vínculo ∪ inscrição), busca, filtros, paginação | `src/lib/participants/participant-service.ts` |
| Ficha 360 com **leitura auditada** (inscrições, frequência, certificados, cartas, XP, comunicação) | idem |
| Exportação CSV com escape, teto e registro na trilha | idem |
| Inteligência da instituição: totais + série por evento, recorte de período no fuso da instituição | `src/lib/participants/insight-service.ts` |
| Recado: mensagem na plataforma + e-mail enfileirado, lote com teto, caixa de entrada por posse | `src/lib/participants/message-service.ts` |
| Nono template de e-mail (o assunto é escrito pela instituição) | `src/domain/communication/email-templates.ts` |
| Actions: envio do recado (instituição) e leitura do recado (posse) | `src/app/actions/participant-actions.ts` |
| Rota de exportação CSV | `src/app/api/t/[tenantSlug]/participantes/exportar/route.ts` |
| Telas: diretório, ficha, panorama, minhas mensagens | `src/app/t/[tenantSlug]/(app)/participantes/**`, `.../panorama`, `.../minhas-mensagens` |
| Componentes: diretório com seleção, compositor de recado, caixa de entrada | `src/components/participants/*` |
| Duas permissões novas e a tela que usa `tenant:analytics:read` | `src/domain/rbac/permissions.ts` |
| Migração à mão: tabela + 4 índices + ação `READ` na trilha | `prisma/migrations/20260921201401_participant_center/` |
| **A correção de uma recusa silenciosa** em `guardAction` (permissão `:own` sem dono) | `src/lib/auth/guard-action.ts` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **18** — 1 de domínio, 1 migração, 3 de aplicação (diretório/ficha, inteligência, mensagens), 1 de actions, 1 rota, 4 de UI (3 componentes + a navegação), 4 de página, 3 de teste, 1 documento de fase |
| Arquivos alterados | **11** (permissões, template de e-mail, guarda das actions, enum da trilha, schema, contrato de RLS, navegação, seed, E2E da F31, testes de comunicação e de e-mail) |
| Migrações | **1** — `20260921201401_participant_center` (tabela + 4 índices + `AuditAction.READ`) — total **26** |
| Tabelas de tenant | **40** sob RLS + FORCE |
| Permissões | **60** (`participant:read`, `participant:message`; nenhuma outra mudou) — 11 papéis, 4 escopos |
| Templates de e-mail | **9** (`PARTICIPANT_MESSAGE`) |
| Dependências novas | **nenhuma** |
| ADRs | **153 … 157** (a próxima é a 158) |
| Testes novos | 33 unitários + 17 de integração + 1 caso de template + 5 E2E = **56** |
| Testes | **1638** (Vitest, 69 arquivos) · **107** (Playwright E2E) |
| Defeitos reais encontrados | **5** (a guarda recusava a própria pessoa; o total de recados ignorava o recado institucional; o `person."userId"` que não existe; o seed que não terminava; dois testes em corrida com o worker) |
| Dívidas quitadas | nenhuma deste levantamento — o escopo veio do humano; a fase declarou **E44** e **E45** |

---

## 2. O problema mais difícil: **pessoa não é linha de tabela**

O participante é um `User` **global** (a conta existe na plataforma) com vínculo por instituição,
N inscrições, N presenças, N certificados. A ficha 360 é uma **agregação por (instituição ×
pessoa)**, e três coisas podem dar errado em silêncio:

**1. Quem é "participante" da instituição?** Nem todo mundo tem vínculo `PARTICIPANT`: a inscrição
pública cria o vínculo desde a FASE 10, mas existe gente com inscrição e SEM vínculo (equipe que se
inscreveu, dado anterior à fase, inscrição lançada pela organização), e existe gente com vínculo e
SEM inscrição (quem se cadastrou e ainda não escolheu nada — justamente a quem a instituição quer
mandar um convite). Um diretório que olhasse só o vínculo esconderia a lista de presença; só a
inscrição esconderia o convite. A resposta é uma **união declarada** (§3.2), com teste prendendo os
dois lados.

**2. "Não tem" × "não vi".** Sob RLS, um filtro esquecido devolve zero e a tela afirma "esta pessoa
não tem certificado". Por isso toda consulta da ficha roda na MESMA transação que valida o
pertencimento, e o teste de isolamento usa **duas instituições de verdade** — o `user` é global, e
é ele que poderia vazar por `userId` se a união não estivesse no caminho.

**3. Custo.** Não existia índice para "presenças de UMA pessoa no tenant" (`attendances` tinha
`[tenantId, activityId, userId]`) nem para "e-mails desta pessoa" (`email_messages` tinha `[to]`).
Sem eles, a ficha varre a tabela — e o modo de falha é **lento, não errado**: ninguém percebe até o
dia do evento. Os dois índices entraram na migração; a agregação acontece no banco, em uma consulta
por seção (nada de N+1).

---

## 3. Decisões técnicas

### 3.1 A agregação acontece no BANCO, em SQL, e não em laço

`listParticipants` monta **uma** consulta: CTEs por seção (inscrições, presenças, certificados,
cartas, XP) reunidas por pessoa, com `LIMIT/OFFSET` e ordenação por `lower(nome), id`. O
desempate por `id` não é enfeite: sem ele, duas pessoas homônimas trocam de lugar entre páginas e
uma delas aparece duas vezes (é o mesmo cuidado da reordenação de blocos da FASE 17).

Alternativa descartada: trazer as pessoas e consultar cada uma. Com 40 pessoas passa; com 400 o
diretório fica inutilizável — e, como o resultado continua certo, o defeito só aparece no dia do
evento.

### 3.2 O diretório é uma UNIÃO, e a ficha exige pertencer

`PARTICIPANT_UNION_SQL` é uma constante usada pelo diretório, pela ficha, pelo envio de recado e
pela contagem do panorama. `UNION` (e não `UNION ALL`) porque a pessoa costuma estar nas duas
pontas, e sem o `DISTINCT` ela apareceria duas vezes — e a contagem de participantes mentiria.

A ficha confere o pertencimento **antes** de ler qualquer seção: sem isso, quem tem o `userId` na
mão abriria a ficha de uma pessoa de fora, e a RLS não barraria — a policy protege as tabelas com
`tenantId`, e o `user` não tem uma.

### 3.3 A leitura da ficha entra na trilha; o e-mail aparece mascarado na lista

O enum `AuditAction` ganhou **`READ`**: até aqui a trilha só sabia registrar escrita, e abrir a
ficha de alguém ficava invisível. A tela diz em voz alta que a consulta é registrada — é o que
separa "conferir" de "vasculhar".

Na **lista**, o e-mail sai mascarado (`maskEmail`, no domínio): é a tela mais copiada, printada e
projetada da instituição, e para responder "quem é esta pessoa?" o domínio do endereço basta. O
endereço completo é dado de contato, e dado de contato se vê na ficha de quem decidiu abrir aquele
cadastro (o mesmo espírito do nome mascarado no resultado público — ADR-139).

### 3.4 O recado é o FATO; o e-mail é consequência

A mensagem nasce em `participant_messages` (a caixa de entrada) e o e-mail é **enfileirado** a
partir dela, pelo outbox da FASE 15. A ordem importa: endereço inválido, fila fora do ar ou domínio
não verificado (o caso do Resend hoje) fazem o e-mail falhar — e a pessoa continua vendo o recado
na plataforma. O `dedupeKey` do outbox é derivado do **id da mensagem**, não do par
(pessoa, assunto): sem isso, dois recados com o mesmo assunto no mesmo dia virariam um só, e o
segundo desapareceria sem ninguém entender por quê.

O envio em massa tem teto (`MESSAGE_BATCH_LIMIT = 200`) e o que passa dele é **reportado**, não
silenciado; cada destinatário é conferido contra a mesma união do diretório (um `userId` de fora
não recebe nada nem descobre que a instituição existe). Nada lança: falha de e-mail vira número no
resultado (invariante nº 8).

### 3.5 A caixa de entrada é aberta por POSSE, não por permissão de instituição

Quem **envia** precisa de `participant:message` no escopo da instituição. Quem **lê o próprio
recado** não precisa de permissão de instituição nenhuma: a porta é a posse, conferida com o
`userId` da SESSÃO contra o `userId` da mensagem (`updateMany` com o dono no filtro — `count = 0` é
resposta de negócio). É a decisão do portal do palestrante (FASE 25): a permissão abre a porta, a
posse decide o que está atrás dela.

### 3.6 O CSV leva o e-mail COMPLETO

A tela mascara o endereço; o arquivo **não**. É a diferença entre MOSTRAR e ENTREGAR: o CSV é o
insumo de uma ação (conferir quem não foi, importar numa mala direta), e um arquivo com
`m***@ufba.br` não serve para nada. O risco não some por mascarar — só muda de lugar. O que protege
é o registro: `AuditAction.EXPORT` grava autor, instante, filtros e número de linhas, e o teto
(`CSV_MAX_ROWS`) impede a extração da base inteira num clique.

O escape do CSV tem duas defesas: aspas/ponto e vírgula (que desmontam a coluna) e **fórmula** —
campo que começa com `=`, `+`, `-`, `@`, tabulação ou retorno passa a ser fórmula ao abrir no
Excel. Nome de pessoa é dado de fora do sistema.

### 3.7 O panorama recorta por PERÍODO e por EVENTO

Um total sozinho não distingue "a instituição cresceu" de "um evento gigante aconteceu". Por isso
a tela mostra os dois: totais do período e a série por evento (inscrições, presenças, taxa,
minutos, certificados, recados).

A janela é resolvida no **fuso da instituição** (`Tenant.timezone`) e vira instantes no domínio —
"os últimos 30 dias" precisa significar a mesma coisa para quem lê o relatório e para quem grava a
presença (armadilha 38). O fim é o **início do dia seguinte** e a consulta usa `< to`: o dia inteiro
entra, sem depender de acertar o último segundo (armadilha 57). O rótulo do período personalizado
usa o **texto digitado**, não o instante convertido.

### 3.8 O relógio vem do banco

`SELECT now()` na página do panorama, e não `new Date()` no corpo do componente: o React Compiler
trata o corpo de um Server Component como render e recusa função impura (armadilha 70). Além disso,
o período precisa ser o MESMO relógio que carimba as presenças.

### 3.9 As cinco decisões do humano

| Pergunta | Decisão |
|---|---|
| O que é "mensagem"? | **E-mail + mensagem interna com caixa de entrada** (tabela própria) |
| Como autorizar? | **`participant:read`** (ver) e **`participant:message`** (falar) novos; a visão geral sob **`tenant:analytics:read`**, que existia desde a FASE 2 e nenhuma tela usava |
| Quem enxerga? | **Só o escopo da INSTITUIÇÃO**; a equipe do dia continua apenas no credenciamento |
| Privacidade | **Abertura da ficha na trilha** e **e-mail mascarado na lista** |
| Exportação | **CSV com registro na trilha** |

---

## 4. ADRs

### ADR-153 — Ver a pessoa é uma permissão própria, separada de operar a inscrição

**Contexto.** A central precisa de duas capacidades distintas — ler o histórico de uma pessoa e
falar com ela —, e já existia `registration:read:any`, usada pela operação de inscrição de um
evento.

**Decisão.** Criar `participant:read` (diretório e ficha) e `participant:message` (recado), e usar
`tenant:analytics:read` — que existia, era concedida e nenhuma tela consumia — para o panorama.
`registration:read:any` **não** dá acesso ao diretório.

**Justificativa.** A ficha reúne dado pessoal que nenhuma outra tela junta (todos os eventos, toda
a comunicação, todos os documentos). Herdar isso de uma permissão de operação faria quem organiza
a fila de um evento enxergar a vida inteira da pessoa. E separar LER de FALAR impede que quem só
confere dispare e-mail em massa.

**Consequências.** 58 → 60 permissões; `PARTICIPANT` não recebe nenhuma das duas (o que é dele é
aberto por posse); ORGANIZER recebe as duas, pelo mesmo argumento que já lhe dá
`communication:read`. A visão geral passa a ter tela, o que fecha um buraco antigo: permissão
concedida e nenhum caminho que a honrasse.

### ADR-154 — O diretório é a UNIÃO de vínculo e inscrição

**Contexto.** Duas fontes dizem que alguém participa da instituição: o vínculo
(`user_tenant_profiles`, kind `PARTICIPANT`) e a inscrição.

**Decisão.** O diretório (e a ficha, e o recado, e a contagem do panorama) usam a **união** das
duas, com `UNION` — uma pessoa, uma linha, venha ela de onde vier.

**Justificativa.** Dado real do sistema: há quem tenha inscrição e não tenha vínculo, e quem tenha
vínculo e nenhuma inscrição. Escolher uma das fontes esconderia gente de verdade — e o modo de
falha seria uma lista plausível e incompleta, que ninguém confere.

**Consequências.** A origem aparece na tela ("vínculo de participante" × "só inscrição") para que a
organização saiba com quem está falando. A união é uma constante única, usada por quatro caminhos.

### ADR-155 — A leitura da ficha é um fato auditável, e a lista mascara o e-mail

**Contexto.** A trilha registrava apenas escrita. A ficha do participante é a primeira tela cuja
função é LER dado pessoal agregado.

**Decisão.** `AuditAction` ganha `READ`, e toda abertura de ficha grava um registro com autor,
instante e a pessoa consultada. Na lista, o e-mail sai mascarado; completo apenas na ficha.

**Justificativa.** Consultar o histórico de alguém é um acesso que a instituição precisa poder
conferir depois. E a lista é uma tela de trabalho que circula (print, tela compartilhada,
planilha); para o que ela responde, o domínio do endereço basta.

**Consequências.** O enum `AuditAction` muda por migração (só `ADD VALUE`, sem uso na mesma
transação). `EMAIL_MESSAGES`/ficha mostram o endereço completo a quem tem a permissão — e essa
abertura fica registrada. O CSV é a exceção declarada (ADR-157).

### ADR-156 — O recado é um FATO da plataforma; o e-mail é consequência

**Contexto.** O e-mail transacional da FASE 15 é disparado por um FATO do sistema (convite,
certificado, carta). Um recado escrito por uma pessoa da instituição não é isso: o conteúdo é
autoral, e o destinatário pode não ter e-mail válido ou o provedor pode estar fora.

**Decisão.** A mensagem nasce em `participant_messages` (a caixa de entrada do participante) e o
e-mail é enfileirado a partir dela, com `dedupeKey` derivado do **id da mensagem**. O lote tem
teto (200) e o resultado diz quantos saíram, quantos falharam e quantos ficaram fora.

**Justificativa.** A comunicação interna não pode depender do provedor externo. E a chave de
deduplicação precisa carregar o FATO: se fosse (pessoa, assunto), dois recados com o mesmo assunto
no mesmo dia virariam um só — a lição do `dedupeKey` da FASE 15, aplicada a um fato novo.

**Consequências.** Uma tabela nova com RLS (39 → 40), um template novo (9º), e nenhuma nova
dependência. O reenvio do job é idempotente pelo mesmo `dedupeKey` que o outbox já usa.

### ADR-157 — O CSV leva o e-mail completo, com registro e teto

**Contexto.** A lista mascara o e-mail; a exportação existe para gerar um arquivo que circula fora
da plataforma.

**Decisão.** O CSV leva o endereço **completo**, a exportação entra na trilha (`EXPORT`, com autor,
filtros e linhas) e tem teto de linhas. O arquivo é servido como *download*, nunca como texto na
aba.

**Justificativa.** Mascarar no arquivo não protege nada: quem exporta precisa do endereço, e quem
não precisasse usaria a tela. O controle real é saber QUEM tirou o quê — e limitar o tamanho de uma
extração acidental.

**Consequências.** A instituição consegue trabalhar (mala direta, conferência) sem que a plataforma
finja proteger o que ela mesma entrega. A dívida E44 registra o que ainda falta: uma política de
retenção/expiração para arquivos exportados.

---

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| O botão **"Marcar como lida"** não fazia nada: o participante clicava e a mensagem continuava não lida, sem erro na tela | `guardAction` chamava `can(permissão, { scope })` sem passar o dono — e `can()` **recusa** permissão `:own` sem `ownerId` (fail-closed, invariante nº 4). A guarda de PÁGINA já resolvia isso desde a FASE 25; a de ACTION, criada na FASE 31, não. O mesmo defeito deixava **quebrado o "Gerar meu crachá"** da FASE 31, que nenhum teste clicava | `guardAction` passa `ownerId: user.id` para permissões `:own` (o dono do RECURSO continua sendo conferido no serviço, com o id do banco). Um clique novo no E2E da FASE 31 prende o caso — o cenário que só olhava a tela não via o defeito |
| O panorama mostrava **0 recados** mesmo com recados enviados | O total era a soma da série por evento, e o recado da INSTITUIÇÃO (sem evento) não pertence a nenhum item da série. O número estava "certo" pela soma e errado pelo fato | O total passou a ser contado **sem o recorte de evento** (`count` próprio no período), e a série continua contando por evento. Teste de integração prende os dois números |
| A consulta do diretório estourava com **`column person.userId does not exist`** ao filtrar por evento | O filtro nasceu como `fr."userId" = person."userId"`, confundindo a CTE (`people`, cuja coluna é `userId`) com a linha de `user` (cuja chave é `id`). Só aparecia COM filtro de evento | O filtro compara com `people."userId"`. O caso só foi pego porque o teste filtra por um evento específico — o caminho sem filtro passava |
| `npm run db:seed` **nunca terminava** (10 minutos e o processo vivo, com o relatório já impresso) | O seed passou a enfileirar e-mail de verdade (o recado de demonstração), e o BullMQ mantém uma conexão com o Redis aberta. O `finally` do seed só fechava o Prisma | `closeEmailQueue()` no `finally`. Num script de provisionamento (`db:setup`), isso travaria a esteira inteira — e o sintoma não é erro, é silêncio |
| A suíte completa ficava **intermitente**: 1 a 2 testes falhavam em rodadas alternadas, sempre em asserção de `status === 'QUEUED'` | Dois testes (um da FASE 15 e um desta fase) enfileiravam um e-mail e conferiam o estado logo depois — com o **worker no ar**, ele pode entregar a mensagem nesse intervalo. O teste passava ou falhava conforme a máquina estivesse ocupada, e o defeito não era do produto: o fato é o mesmo nos dois estados | As asserções passaram a aceitar `QUEUED` **ou** `SENT`, mantendo o que interessa (a linha do outbox com o HTML do envio, o template, a `dedupeKey`), com o porquê escrito no teste. **Teste que mede o estado de um job concorrente mede a máquina, não o código** |

---

## 6. Evidência de verificação

### 6.1 Bateria (árvore final)

```text
npm run lint                  → 0 erros, 0 warnings
npm run typecheck             → 0 erros
npm test                      → 69 arquivos · 1638 testes passando (duas rodadas seguidas, para
                                provar que a intermitência foi embora)
npm run build                 → Compiled successfully (rotas /participantes, /participantes/[userId],
                                /panorama, /minhas-mensagens e /api/.../participantes/exportar listadas)
npm run db:verify             → Contrato íntegro.
npm run db:verify:isolation   → 9/9 verificações passaram.
npm run db:partitions         → partições do mês atual e dos seguintes criadas
npm run db:verify:pooling     → Pooling íntegro: contexto por transação preservado sob PgBouncer.
npx prisma migrate status     → 26 migrations · "Database schema is up to date!"
npm run db:seed               → 13 s, com "✓ recado de demonstração: 1 mensagem(ns), 1 e-mail(s) na fila"
npm run test:e2e              → 107 passed (5 novos desta fase)
```

### 6.2 Testes novos

| Arquivo | Testes | O que prende |
|---|---|---|
| `tests/unit/participant-rules.test.ts` | 33 | taxa com denominador zero (ausência de dado ≠ 0%), pisos dos rótulos de engajamento, máscara de e-mail (inclusive o caso de uma letra), média de minutos, cobertura de certificado, limites e validação do recado, chave de deduplicação sem `:` (armadilha 49), escape de CSV (fórmula, aspas, ponto e vírgula, BOM/CRLF), paginação e período no fuso (Bahia, UTC e Lisboa com horário de verão) |
| `tests/integration/participant-center.test.ts` | 17 | união vínculo ∪ inscrição, agregação através de eventos, filtros (evento, certificado, presença), busca, paginação sem repetir, **RLS com duas instituições**, ficha completa, **leitura auditada**, pertencimento negado, recado gravado + e-mail **enfileirado** (`queued === true`), destinatário de fora ignorado, entrada inválida recusada, posse na caixa de entrada (a mensagem alheia não é marcada), totais e série do panorama, período que exclui evento (sem dado ≠ 0%), CSV com escape e **trilha `EXPORT`** |
| `tests/e2e/participant-center.spec.ts` | 5 | diretório com e-mail mascarado e taxa, ficha com eventos e certificado, recado enviado pela ficha, participante lendo e marcando como lida, panorama com totais e série, CSV baixado com rastro, e **a permissão negada** (nem pelo menu, nem pela URL) |

### 6.3 Testes existentes que precisaram mudar (e por quê)

| Arquivo | Mudança | Motivo |
|---|---|---|
| `tests/e2e/credential-flow.spec.ts` | o cenário do crachá online passou a **clicar em "Gerar meu crachá"** e conferir a resposta | O botão nunca foi exercitado, e era exatamente ali que a recusa silenciosa da guarda vivia. Sem esse clique, a correção não teria como ser provada |
| `tests/unit/email-communication.test.ts` | o catálogo passou de 8 para **9 templates** e ganhou o payload de exemplo do recado | O teste é uma enumeração exaustiva de propósito: template novo sem payload de exemplo **quebra** ali, em vez de passar despercebido |
| `tests/integration/communication.test.ts` | a asserção do estado do outbox aceita `QUEUED` **ou** `SENT` | Corrida com o worker no ar — ver a lição §5 |

---

## 7. Comandos operacionais

```bash
# ── O DIRETÓRIO ───────────────────────────────────────────────────────────────────
# /t/<slug>/participantes?busca=&evento=<id>&certificado=1&presente=1&pagina=2
#   → "Abrir ficha" por pessoa · "Exportar CSV" (com os filtros aplicados)
# Exportação direto pela rota (baixa o arquivo):
#   /api/t/<slug>/participantes/exportar?busca=&evento=&certificado=1&presente=1

# ── A FICHA ───────────────────────────────────────────────────────────────────────
# /t/<slug>/participantes/<userId>
#   → eventos e atividades, frequência, certificados, cartas, XP, recados e e-mails
#   → "Enviar recado para <nome>" (e-mail + caixa de entrada)

# ── O PANORAMA ────────────────────────────────────────────────────────────────────
# /t/<slug>/panorama?periodo=ALL|30D|90D|YEAR|CUSTOM&de=AAAA-MM-DD&ate=AAAA-MM-DD

# ── O PARTICIPANTE ────────────────────────────────────────────────────────────────
# /t/<slug>/minhas-mensagens   → recados, com "Marcar como lida"

# ── O BANCO: o que foi enviado e quem consultou ───────────────────────────────────
psql "$DATABASE_URL" -c '
  SELECT u.name, m.subject, m."sentAt"::date, m."readAt" IS NOT NULL AS lido
    FROM participant_messages m JOIN "user" u ON u.id = m."userId"
   WHERE m."tenantId" = ''<tenantId>'' ORDER BY m."sentAt" DESC LIMIT 20'

# Quem abriu ficha e quem exportou (a trilha registra LEITURA e EXPORTAÇÃO):
psql "$DATABASE_URL" -c '
  SELECT a."createdAt", a.action, a."entityType", u.name AS autor
    FROM audit_logs a LEFT JOIN "user" u ON u.id = a."userId"
   WHERE a."tenantId" = ''<tenantId>'' AND a.action IN (''READ'', ''EXPORT'')
   ORDER BY a."createdAt" DESC LIMIT 20'
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Dívida | Impacto | Caminho |
|---|---|---|---|
| **E44** | **O arquivo exportado não tem prazo nem controle de destino.** O CSV sai com e-mail completo e passa a viver em pasta compartilhada, e-mail e pen drive | É a maior superfície de vazamento da fase: o registro diz QUEM exportou, mas não impede que o arquivo circule anos depois | Marca d'água com autor e data no arquivo, prazo de validade declarado na tela, e uma política de retenção combinada com a instituição |
| **E45** | **Recado é mão única.** Não há resposta do participante, nem thread, nem confirmação de leitura por parte de quem enviou | A instituição fala e não ouve — e "não lido" no painel não é o mesmo que "não recebido" | Caixa de resposta (o participante responde na própria caixa de entrada) e um indicador de "respondeu" na ficha |

Pontos de atenção que **não** são dívidas novas, mas valem registro:

- **O recado depende do worker para virar e-mail.** Sem o worker no ar, a mensagem fica na
  plataforma e o e-mail fica `QUEUED` — a pessoa continua vendo o recado, que é o desenho;
- **A taxa de comparecimento usa a inscrição CONFIRMADA como denominador.** Presença registrada sem
  inscrição (ADR-151) não entra no denominador e é limitada a 100% na taxa; o número absoluto
  aparece na ficha;
- **`isPublicProfile` aparece na ficha** (autoriza ou não o nome no resultado público), mas
  continua sem tela para a PESSOA escolher — dívida E35, da FASE 22, segue aberta;
- **O diretório para em 500 linhas** (`PARTICIPANT_LIMIT`) e avisa; quem precisa do conjunto
  completo exporta o CSV, que tem o próprio teto (5.000 linhas).

---

## 9. Checklist de aceite

- [x] **Visão de todos os participantes** da instituição, atravessando todos os eventos, com busca,
      filtro por evento, por certificado e por presença, e paginação
- [x] **Eventos que a pessoa participou**, com inscrição, presença e minutos por evento
- [x] **Certificados gerados para ela**, com código de validação e carga horária
- [x] **Conquistas e cartas** (incluindo foil e quantidade) e o extrato recente de **XP**
- [x] **Envio de e-mail e mensagem** para o participante, individual e em massa, com a mensagem
      guardada na caixa de entrada dele e o e-mail no outbox
- [x] **Caixa de entrada do participante**, com marcação de lida por posse
- [x] **Demais estatísticas**: taxa de comparecimento, média de minutos, cobertura de certificado e
      rótulos de engajamento
- [x] **Visão geral da vida da instituição**: totais do período e série por evento, com recorte de
      período no fuso da instituição
- [x] **Cada instituição vê os participantes dos seus eventos** — e nunca os de outra (teste de
      isolamento com duas instituições)
- [x] Permissões novas aplicadas (`participant:read`, `participant:message`) e a visão geral sobre
      `tenant:analytics:read`, que passou a ter tela
- [x] Privacidade: abertura de ficha na trilha (`AuditAction.READ`) e e-mail mascarado na lista
- [x] Exportação em CSV com escape contra fórmula, teto de linhas e registro na trilha
- [x] Migração escrita à mão (lida linha por linha), com tabela sob RLS + FORCE e os dois índices que
      faltavam para a agregação por pessoa
- [x] Testes: 33 unitários + 17 de integração + 1 caso de template + 5 E2E; **1638** testes Vitest e
      **107** Playwright passando
- [x] Documentação da fase, `AGENTS.md`, `README.md`, `docs/dividas-tecnicas.md` e
      `docs/armadilhas.md` atualizados
