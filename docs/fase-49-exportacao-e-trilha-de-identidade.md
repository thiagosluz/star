# FASE 49 — Exportação com marca d'água e prazo · Trilha de identidade

> Duas dívidas declaradas em fases anteriores, quitadas na mesma entrega: **E44**
> (o arquivo exportado não tem prazo nem controle de destino) e **E67** (as mudanças
> de identidade não entram na trilha). As duas têm a mesma raiz: **um fato que sai do
> escopo de uma instituição** — o arquivo que circula fora da plataforma e a conta que
> existe sem instituição nenhuma.

---

## 1. Sumário executivo

### 1.1 O que a fase entrega

| # | Entrega | Onde |
|---|---|---|
| 1 | **Marca d'água de procedência**: autor, instituição, instante, filtros e validade no topo do CSV | `src/domain/exports/export-rules.ts` |
| 2 | **A marca em CADA linha** (coluna final), para sobreviver à cópia de uma linha | idem |
| 3 | **Prazo de 24 h** por exportação, decidido no pedido e conferido no download | `src/lib/exports/export-service.ts` |
| 4 | **Pedido auditado** (`data_exports`): autor, filtros, nº de linhas, downloads, revogação | `prisma/migrations/20260929100000_data_exports` |
| 5 | **Download por sessão** (não por link assinado): a rota reconfere a permissão do tipo | `src/app/api/t/[tenantSlug]/exportacoes/[exportId]/arquivo/route.ts` |
| 6 | **Revogação** que corta o acesso antes do prazo, com motivo na trilha | `revokeDataExport` |
| 7 | **Lista de exportações recentes** na própria tela, com prazo, contagem e revogar | `src/components/exports/export-panel.tsx` |
| 8 | **Escape único**: o CSV do patrocinador passa a usar o `csvCell` do domínio (acaba a segunda implementação) | `sponsor-portal-service.ts` |
| 9 | **Trilha de identidade** sem `tenantId`, com catálogo de 15 fatos de segurança e gravidade | `src/domain/identity/identity-audit-rules.ts` |
| 10 | **Sanitização obrigatória**: senha, token, código e semente TOTP nunca chegam à trilha | `sanitizeIdentityDetails` |
| 11 | **Gravação no ponto que conhece o ato**: ações de conta, redefinição, desafio de 2FA e códigos | `src/lib/auth/identity-audit.ts` + ações |
| 12 | **Tela de auditoria da plataforma** (trilha de governança + trilha de identidade, com filtros e página) | `/superadmin/auditoria` |
| 13 | **Histórico de segurança da própria pessoa** em `/conta` (por posse) | `src/app/conta/page.tsx` |
| 14 | **Correção de um defeito real de privilégio**: `db:rls` religava o acesso à role de runtime em `two_factor` | `docker/postgres/init/00-roles.sql` |

### 1.2 Números da fase

| | |
|---|---|
| Arquivos novos | **16** — 10 de código, 2 migrações, 3 de teste, 1 documento |
| Arquivos modificados | **14** de código/configuração + **2** de teste, mais **4** de documentação |
| Arquivos removidos | **2** (as rotas antigas de download direto) |
| Migrações | **45 → 47** (`data_exports`, `identity_audit_logs`) |
| Tabelas de tenant | **56 → 57** (`data_exports`) |
| Tabelas restritas ao runtime | **1 → 3** (`two_factor` e `identity_audit_logs` no `IDENTITY_ONLY_TABLES`) |
| Testes novos | **+41** — 24 unitários, 13 de integração e 4 E2E |
| Suíte | **2436** testes (Vitest) · **166** (Playwright) |
| ADRs | **267 a 273** |
| Dívidas | **E44 e E67 quitadas**; **E72 e E73 declaradas** (o total segue 67 · fases quitadas 16 → 18) |
| Defeitos reais encontrados | **1** (privilégio religado pelo provisionamento, herdado da FASE 47) |
| Permissões | 66 (nenhuma nova — a exportação usa a permissão da tela que exporta) |

---

## 2. O problema mais difícil da fase

**Um arquivo que já saiu não volta.** O CSV nasce com e-mail completo — é o insumo da
ação, e a decisão de entregá-lo está tomada desde a FASE 32. Só que, depois de baixado,
ele vive em pasta compartilhada, anexo de e-mail e pen drive, e **nada no arquivo dizia
de onde ele veio**. A trilha registrava *quem exportou* e *quantas linhas*; não impedia
nada e não acompanhava nada.

A saída óbvia — "colocar prazo no arquivo" — não existe: o arquivo é um pedaço de texto
no disco de alguém. Foi preciso separar **duas coisas que estavam juntas**:

| O que | Onde vive | Como se controla |
|---|---|---|
| O **arquivo** | fora da plataforma, para sempre | **marca d'água**: procedência no topo e autor + validade em CADA linha |
| O **direito de baixar de novo** | na plataforma, e só lá | **prazo de 24 h** + revogação, conferidos no download |

Disso saiu a decisão que define o desenho: **o arquivo não é guardado**. O que o banco
guarda é o ATO (quem pediu, o que, com que filtros, até quando vale, quantos downloads).
O CSV é **regerado** no momento do download. Duas consequências, as duas deliberadas:

1. não existe cópia do dado pessoal parada no banco ou no bucket esperando alguém
   lembrar de apagar;
2. **o prazo passa a ter sentido** — expirar só é aceitável porque regerar é possível.
   Passado o prazo, baixar exige uma NOVA exportação, e isso é o ponto: cada liberação
   de dado pessoal é um ato com autor e hora.

### O segundo problema: uma trilha sem instituição

`audit_logs` é por instituição — tem `tenantId` e RLS. Senha, segundo fator, códigos de
recuperação, troca de e-mail e sessões encerradas são fatos da **CONTA**, que existe sem
instituição (ADR-002). A pergunta *"de onde veio esta troca de senha?"* não tinha onde
ser respondida (dívida E67).

E não adianta inventar uma policy: **não há `tenantId` por onde isolar**. A tentação era
gravar na trilha da instituição "ativa" do momento — e isso mentiria: a mesma conta troca
a senha em `/conta`, que é global, sem instituição escolhida. Então a proteção mudou de
natureza: **não é RLS, é privilégio**. A role de runtime não tem `SELECT`, `INSERT`,
`UPDATE` nem `DELETE` em `identity_audit_logs`; quem escreve e lê é a conexão de
plataforma (`adminPrisma`, invariante nº 1), como já acontecia com `two_factor` e
`job_runs`.

---

## 3. Decisões técnicas

### 3.1 Trilha própria, e não `audit_logs` com `tenantId` nulo

`audit_logs` já aceita `tenantId` nulo (é assim que a governança registra na FASE 9).
Gravar ali seria uma linha a menos de código e três problemas: a tabela é **particionada
por mês** com RLS por instituição, a leitura de plataforma precisa de uma consulta
privilegiada de qualquer forma, e — o decisivo — **o vocabulário é outro**. A trilha de
instituição fala de `entityType`/`entityId` de domínio (evento, submissão, carta); a de
identidade fala de **fatos da conta**, com gravidade própria. Misturar os dois faria a
tela de auditoria filtrar "evento de segurança" por convenção de string.

### 3.2 Sem chave estrangeira, de propósito

`userId` e `actorId` são UUIDs **sem FK**. Com `ON DELETE CASCADE` o fato sumiria junto
com quem ele descreve; com `SET NULL`, a investigação perderia o alvo. A trilha de
segurança precisa **sobreviver à exclusão da conta** — e o teste prende isso: a linha
continua, com o identificador e sem o nome.

### 3.3 Quem grava é o ponto que conhece o ato

A alternativa era um gancho genérico do adaptador (`user.update.after`) e ela é pior por
dois motivos: auditoria de "algo mudou" não diz **o quê** (e o que importa é "senha
alterada", "2FA desligado", "sessões encerradas"), e um gancho de tabela registraria
também o que não é segurança (trocar o nome, aceitar convite). São **13 pontos de
chamada**, cada um no lugar que sabe o que aconteceu — inclusive o gancho
`sendResetPassword`, que é o único que vê o pedido de redefinição.

Para o fato "senha redefinida pelo link" foi preciso resolver o alvo **sem sessão**: o
token de redefinição é uma linha de `verification` cujo `identifier` é
`reset-password:<token>` e cujo `value` **é o `userId`** (conferido na implementação da
biblioteca) — lido ANTES do `resetPassword`, porque depois a linha já não existe.

### 3.4 Download por sessão, e não por URL assinada

A alternativa óbvia era assinar a URL (como o material do palestrante). Aqui ela seria
**pior**: uma URL assinada é credencial que circula sem dono, e o objetivo da fase é
saber quem baixou. A rota exige sessão e **reconfere a permissão do tipo de exportação**
— inclusive o vínculo do patrocinador, que é o caminho pelo qual ele exporta os contatos
da própria empresa. O endereço não vale nada sem sessão (e o E2E prova: sai da conta,
toma 401).

### 3.5 Onde a marca d'água aparece

| Opção | Por que não |
|---|---|
| Só o cabeçalho | Morre na primeira linha copiada — e copiar cinco nomes para um grupo é o vazamento comum |
| Só a coluna por linha | Perde o contexto (instituição, filtros, validade) que a investigação precisa |
| **Cabeçalho + coluna final + rodapé** | **Escolhida**: o bloco conta a história, a coluna sobrevive à cópia e o rodapé fecha o arquivo |

A coluna da marca vai **sempre no fim**, porque a ordem das colunas do dado é contrato
(quem importa a planilha importa por posição).

### 3.6 Escape é um só

O CSV do diretório usava `csvCell` do domínio e o de contatos do patrocinador tinha a
**própria** versão de escape (`"${campo.replace(/"/g,'""')}"`). Duas cópias da mesma
regra divergem — e a que divergiria primeiro é a de **fórmula** (`=`, `+`, `-`, `@`), que
é justamente a que impede o nome de uma pessoa virar execução na máquina de quem abre a
planilha. Agora as duas passam por `buildWatermarkedCsv`, que aplica `csvCell` a tudo —
**inclusive à marca d'água**, porque o nome de quem exportou também é texto de fora.

---

## 4. ADRs

### ADR-267 — A exportação de dado pessoal é um PEDIDO com prazo, e não um link de download

**Contexto.** A rota de exportação devolvia o arquivo direto (`GET .../exportar`). A
trilha registrava autor, filtros e linhas — e nada depois disso: o arquivo passava a
existir sem controle de destino (dívida E44).

**Decisão.** Exportar cria uma linha em `data_exports` (autor, filtros, nº de linhas,
`expiresAt`, contador de downloads, revogação) e devolve o identificador do pedido. O
arquivo é gerado no DOWNLOAD, a partir dos filtros gravados.

**Por quê.** O que se controla não é o arquivo (impossível: ele sai da plataforma), e sim
o direito de obtê-lo de novo. Guardar o ARQUIVO seria pior em todos os sentidos: cópia de
dado pessoal parada no banco ou no bucket, com prazo varrido por rotina e sem garantia de
que o binário apagado é o mesmo que circulou.

**Consequências.** Cada download é um ato identificado (sessão + permissão reconferida) e
o arquivo reflete o dado do MOMENTO do download — o cabeçalho diz quando foi gerado e o
pedido diz até quando vale. Exportar de novo é um pedido novo, com autor e hora novos.

### ADR-268 — O download é autorizado por sessão e reconfere a permissão DO TIPO

**Contexto.** A permissão de exportar o diretório (`participant:read`) não é a de exportar
contatos de patrocinador — que tem DOIS públicos (a organização com `sponsor:manage` e o
patrocinador pelo vínculo).

**Decisão.** A rota de download resolve primeiro o PEDIDO (para saber o tipo) e só então
autoriza, com a mesma função que a Server Action usa (`authorizeDataExport`). Exportação
de outra instituição responde 404 (a RLS não a encontra).

**Por quê.** É a rota que um atacante chama, não o botão. Duas cópias da regra divergem, e
a que divergiria é a do patrocinador — exatamente a que tem duas portas.

### ADR-269 — `data_exports` guarda o ATO, não o arquivo

**Contexto.** Ver ADR-267.

**Decisão.** A tabela tem autor, tipo, filtros, nº de linhas, `expiresAt`,
`downloadCount`, `lastDownloadedAt` e `revokedAt`. Nenhum conteúdo de arquivo.

**Consequências.** O expurgo é trivial (não há dado pessoal na linha — os filtros podem
conter uma busca, que é o recorte, não o dado). E o `rowCount` é a fotografia do pedido: se
o diretório crescer entre o pedido e o download, o arquivo mostra o estado atual e a tela
avisa que o total mudou.

### ADR-270 — Marca d'água em duas camadas: procedência e linha

**Contexto.** O CSV é o insumo da ação e circula fora da plataforma.

**Decisão.** Bloco de procedência (autor + e-mail, instituição, instante no fuso da
instituição, filtros e validade) + coluna final em CADA linha, com autor, instante,
validade e identificador curto da exportação.

**Por quê.** O cabeçalho MORRE na primeira linha copiada. A coluna por linha é o que liga
um recorte copiado à exportação que o originou — e o identificador curto liga o arquivo à
linha da trilha.

### ADR-271 — A trilha de identidade é uma tabela sem `tenantId` e sem FK, protegida por PRIVILÉGIO

**Contexto.** Dívida E67. A conta é global (ADR-002) e os fatos de segurança não pertencem
a instituição nenhuma.

**Decisão.** `identity_audit_logs` sem `tenantId`, sem RLS (não haveria com o que
comparar), com a role de runtime **sem privilégio** (`IDENTITY_ONLY_TABLES`) e sem chave
estrangeira para `user`.

**Consequências.** Quem lê é o painel de plataforma; a trila sobrevive à exclusão da conta;
a proteção é o privilégio, e o provisionamento ganhou a revogação explícita (ver 5.1).

### ADR-272 — A trilha grava o FATO, nunca o segredo

**Contexto.** A tentação de "guardar para conferir depois" (o código usado, o token
gerado) é permanente.

**Decisão.** `sanitizeIdentityDetails` troca por `[removido]` toda chave da lista negra
(`password`, `token`, `secret`, `backupCodes`, `recoveryCode`, `code`, `otp`, `cookie`,
`signature`, `sessionToken`, `apiKey`) em **qualquer profundidade**, corta texto em 300
caracteres e lista em 20 itens. O que fica é o estado alterado (`{ from, to }`) e a
origem (IP, user-agent).

**Consequências.** Um teste unitário varre o objeto serializado procurando a senha e o
token usados — a "melhoria" futura de gravar o código para auditar quebra o teste.

### ADR-273 — A tela de auditoria é de plataforma, e o histórico da pessoa é por posse

**Contexto.** Trilha sem leitor não existe para quem responde ao incidente.

**Decisão.** `/superadmin/auditoria` lê as duas trilhas (identidade e governança) com
filtros por pessoa, tipo e período, com paginação. Em `/conta`, a pessoa vê **os próprios
fatos** — o `userId` vem da sessão, nunca da URL.

**Por quê.** Antes, a trilha de plataforma aparecia espremida em "Métricas" (10 linhas) e
"Governança" (20), sem filtro. E ver o próprio histórico é o que permite responder "eu
não fiz isso" no minuto em que a pessoa desconfia.

---

## 5. Lições aprendidas

### 5.1 O privilégio revogado VOLTOU no `db:rls` — defeito herdado da FASE 47

| | |
|---|---|
| **Sintoma** | `npm run db:rls` seguido de `npm run db:verify`: **2 violações** — `two_factor` e `identity_audit_logs` com `SELECT, INSERT, UPDATE, DELETE` para `eventflow_app` |
| **Causa raiz** | `docker/postgres/init/00-roles.sql` concede CRUD em **todas** as tabelas e depois revoga só as restritas — e a lista do REVOKE tinha **apenas `job_runs`**. A FASE 47 revogou `two_factor` na MIGRAÇÃO, e o `db:rls` (que faz parte de `db:setup` e de `db:migrate:deploy`) reabria o acesso a cada execução |
| **Correção** | A lista virou um array (`job_runs`, `two_factor`, `identity_audit_logs`) percorrido por `FOREACH`, e um **teste unitário catraca** passou a exigir que toda tabela de `PLATFORM_ONLY_TABLES`/`IDENTITY_ONLY_TABLES` esteja no REVOKE do provisionamento |

O mesmo defeito tinha acontecido na FASE 36 com `job_runs` (está escrito no comentário do
arquivo). Ele voltou porque a correção foi um `IF` para uma tabela, e não uma **regra**.
A catraca agora é o que impede a terceira vez: quem acrescentar uma tabela restrita sem
tocar no provisionamento quebra o teste — e não o contrato, já em produção.

> **Semente TOTP alcançável pelo runtime** é o achado mais grave: quem lê `two_factor`
> gera códigos válidos e entra na conta de qualquer pessoa. O `db:setup` de uma máquina
> nova abria essa porta **sem que nada falhasse** — o `db:verify` a fecha, mas ele roda
> depois.

### 5.2 `tests/**` não passa pelo `typecheck` — de novo

Ao remover `exportParticipantsCsv`, o `tsc` continuou verde e **dois testes de integração
da FASE 32** apontavam para uma função que não existia mais. Só rodar a suíte pegou
(armadilha 99 revisitada, agora do lado do teste: renomear API sem ver o `tsc` reclamar).

### 5.3 Defeitos de TESTE (três — os dois primeiros por expectativa minha, o terceiro por medição errada)

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `rowCount` 0 no pedido | O teste combinou `query: 'Bruno'` com `onlyWithCertificate: true` — e ninguém tem certificado na fixture. A asserção mediu a própria consulta, não o serviço | O filtro saiu; a poda de filtros vazios ficou presa na asserção de `filters` gravado |
| Linha de metadado contada como linha de dado | O filtro `line.includes('@exemplo.test')` casava também com `# Exportado por: … <…@exemplo.test>` | Linha de dado é a que **não começa com `#`** |
| **"O download exige sessão" passava com 200** | O teste saía da conta com `sign-out` e reusava o MESMO contexto do Playwright — que continuava com a sessão. Ele media a própria requisição autenticada, não a ausência de sessão | Um `browser.newContext()` **sem cookie nenhum**: é a única prova honesta de que o endereço, sozinho, não baixa nada (401) |

---

## 6. Evidência de verificação

```text
npm run lint ....................... 0 erros, 0 warnings
npm run typecheck .................. 0 erros
npm test ........................... 110 arquivos · 2436 testes passando
npm run build ...................... ✓ Compiled successfully (77 s)
                                     (+ /superadmin/auditoria, /api/t/[tenantSlug]/exportacoes/[exportId]/arquivo)
npm run db:verify .................. Contrato íntegro. (data_exports sob RLS; identity_audit_logs e
                                     two_factor inalcançáveis pela role de runtime)
npm run db:verify:isolation ........ 9/9 verificações passaram.
npm run db:partitions .............. partições do mês e dos seguintes · 24.074 linhas
npx prisma migrate status .......... 47 migrations · Database schema is up to date!
npm run db:seed .................... ✓
npm run db:rls + npm run db:verify .. Contrato íntegro. (é a prova do defeito 5.1: antes, 2 violações)
docker compose --profile app up -d --build web worker   ✓
npm run test:e2e ................... 166 passed (5,0 min)
```

---

## 7. Comandos operacionais

```bash
# A trilha de identidade (plataforma) — o painel lê o mesmo dado:
#   /superadmin/auditoria            → filtros por pessoa, tipo e período
psql "$DATABASE_URL" -c 'SELECT event, "userId", "ipAddress", "createdAt" FROM identity_audit_logs ORDER BY "createdAt" DESC LIMIT 20'

# O histórico da própria pessoa:
#   /conta → "Segurança e acessos"

# As exportações de uma instituição (o que foi liberado, por quem e até quando):
psql "$DATABASE_URL" -c 'SELECT kind, "rowCount", "downloadCount", "expiresAt", "revokedAt" FROM data_exports ORDER BY "createdAt" DESC LIMIT 20'

# A trilha da instituição registra o PEDIDO (CREATE) e cada DOWNLOAD (EXPORT):
#   /t/<slug>/participantes → "Exportações recentes", ou a trilha da instituição

# Provar que a role de runtime NÃO lê a trilha de identidade:
npm run db:verify
```

---

## 8. Dívidas técnicas e pontos de atenção

**Quitadas nesta fase:**

| Dívida | Como foi quitada |
|---|---|
| **E44** — *o arquivo exportado não tem prazo nem controle de destino* | Marca d'água (procedência + coluna por linha), prazo de 24 h conferido no download, pedido auditado com revogação e lista de exportações recentes na tela |
| **E67** — *as mudanças de identidade não entram na trilha* | `identity_audit_logs` (sem `tenantId`, sem privilégio para o runtime) + 15 fatos catalogados, gravados nos 13 pontos que conhecem o ato, lidos pelo SuperAdmin e pela própria pessoa |

**Declaradas:**

| Dívida | O que falta | Por que não entrou |
|---|---|---|
| **E72** | **A trilha de identidade não tem expurgo nem alerta.** Não há prazo de retenção (mesma decisão em aberto da trilha de instituição, dívida B8) e um fato `CRITICAL` (2FA desligado, senha trocada, código de recuperação usado) **não avisa ninguém** — aparece na tela para quem for olhar | A retenção é decisão de negócio e o alerta precisa de um canal (e-mail de plataforma, rotina `job_runs`): as duas coisas são fase própria |
| **E73** | **A tela mostra quantos downloads, não quem baixou.** O autor de cada download está na trilha da instituição (`AuditAction.EXPORT` com `entityId` = exportação), mas exige sair da tela para ver | A lista de exportações recentes já carrega o essencial; juntar as duas fontes numa visão só pede uma consulta à trilha por linha |

**Pontos de atenção para quem mexer aqui:**

* **A ordem das colunas do CSV é contrato** — a marca vai SEMPRE no fim;
* **a lista de tabelas restritas tem catraca** (`00-roles.sql` + teste unitário): tabela
  nova em `IDENTITY_ONLY_TABLES` sem REVOKE quebra o teste;
* **o arquivo não é guardado**: se um dia alguém decidir guardá-lo, o prazo e a revogação
  passam a precisar de expurgo de binário — e a decisão de não guardar é justamente o que
  evita isso;
* **`rowCount` é fotografia do pedido**: o arquivo pode ter mais ou menos linhas se o dado
  mudar entre o pedido e o download (o cabeçalho diz quando o arquivo foi gerado).

---

## 9. Checklist de aceite

- [x] A exportação de dados pessoais (diretório e contatos de patrocinador) tem **prazo** declarado e aplicado
- [x] O arquivo sai com **marca d'água**: autor, instituição, instante, filtros e validade no topo
- [x] A marca aparece **em cada linha**, sobrevivendo à cópia de uma linha
- [x] O prazo é conferido no **download**, e vencido recusa com a instrução de exportar de novo
- [x] O download exige **sessão** e reconfere a permissão do tipo (inclusive o vínculo do patrocinador)
- [x] Exportação de outra instituição não é encontrada (RLS)
- [x] O pedido é **auditado** (CREATE) e cada download também (EXPORT), com autor e nº de linhas
- [x] A **revogação** corta antes do prazo e a linha continua como histórico
- [x] A tela lista as **exportações recentes** com prazo, contagem, download e revogar
- [x] O CSV do patrocinador passou a usar a **mesma** regra de escape (`csvCell`)
- [x] Existe tabela de auditoria **sem restrição de tenant** para mutações globais de segurança
- [x] A trilha cobre **2FA, senhas, códigos de recuperação, e-mail, sessões e redefinição**
- [x] A trilha **nunca** grava senha, token, código ou semente (sanitização testada)
- [x] A role de runtime **não alcança** a trilha, e o provisionamento revoga (com catraca de teste)
- [x] A trilha sobrevive à exclusão da conta (sem FK)
- [x] O **SuperAdmin** lê as duas trilhas em `/superadmin/auditoria`, com filtros e paginação
- [x] A **própria pessoa** vê o próprio histórico em `/conta`, por posse
- [x] **E44** e **E67** quitadas no `docs/dividas-tecnicas.md`; **E72/E73** declaradas
- [x] `README.md` e `AGENTS.md` atualizados (números, capacidade e índice)
- [x] Bateria da seção 4 do `AGENTS.md` verde, com números reais
