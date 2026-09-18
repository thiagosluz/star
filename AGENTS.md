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
Fases concluídas ........ 1 a 14, 16, 17, 23 e 24 (F15 pendente: Comunicação)
Testes ................. 1157 (Vitest: unit + integração) + 69 (Playwright E2E)
ADRs ................... 112 (numeração GLOBAL e sequencial — a próxima é ADR-113)
Permissões ............. 54 (11 papéis, 4 escopos)
Tabelas de tenant ...... 33 sob RLS + FORCE (+ as partições mensais de audit_logs)
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
npm test              # esperado: 1157+ testes passando
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
npm run test:e2e      # esperado: 69+ testes passando
```

**Armadilha crítica de verificação:** se o `--build` falhar, o `docker compose`
**mantém o container anterior no ar** e o E2E passa a medir código que não existe.
Um `docker compose ps` dizendo "healthy" **não prova** que a imagem é a nova. Por
isso: (a) leia a saída completa do build, (b) confirme a data da imagem,
(c) confirme que a rota nova responde (307/200, não 404).

---

## 5. Armadilhas conhecidas (custaram depuração real)

| # | Armadilha | Regra |
|---|---|---|
| 1 | `.env` define `NODE_ENV=development`, carregado pelo Next no build | Use **`npm run build`** (aplica `cross-env NODE_ENV=production`); `npx next build` direto quebra em `/_global-error` |
| 2 | Tabela nova com `tenantId` nasce **sem policy** (fail-closed: a app não lê nada) | Rode `npm run db:rls` e depois `npm run db:verify` (o provisionamento descobre tabelas por introspecção desde a FASE 8) |
| 3 | Build falho + Compose preserva o container antigo → rota nova responde 404 com processo "saudável" | Confirme a imagem recriada **e** o build bem-sucedido antes do E2E |
| 4 | Arquivo `'use server'` exportando função não-async | `tsc` e ESLint **não** pegam; só o `next build` recusa ("Server Actions must be async functions") |
| 5 | React 19 **reseta o formulário** depois de uma action | Se duas ações compartilham o formulário (conferir → executar), os campos precisam ser **controlados**, senão o segundo passo usa valores padrão |
| 6 | `zod` valida objeto de forma **tudo-ou-nada** | Um campo inválido descarta os válidos: valide campo a campo quando quiser preservar o resto |
| 7 | `unknown`/objeto simples não é aceito como JSON do Prisma | Faça o cast explícito (`as unknown as object`) ao gravar em colunas `Json` |
| 8 | `lastIndexOf('xref')` acha o `xref` dentro de `startxref` | Em análise de formato, ancore a busca (`\nxref\n`) |
| 9 | Múltiplos cadastros no mesmo contexto de navegador E2E reutilizam a sessão | `page.request.post('/api/auth/sign-out')` antes de cada login |
| 10 | Rate limiter do Better Auth é em memória/por processo | `RATE_LIMIT_ENABLED=false` no container para os E2E |
| 11 | `docker compose ps` esconde erro de build quando a saída é filtrada | Nunca filtre (`Select-Object -Last 3`) a saída de um `--build` |
| 12 | Contagens escritas em prosa envelhecem (o doc da F2 dizia "50 permissões"; o código tinha 52 desde então) | **Confira no código**: `npx tsx -e "import {ALL_PERMISSIONS} from '@/domain/rbac/permissions'; console.log(ALL_PERMISSIONS.length)"` |
| 13 | No Next.js 16 `revalidateTag(tag)` exige 2 argumentos (o segundo é um perfil de `cacheLife`) | Use `revalidateTag(tag, 'max')` e `revalidatePath()` das telas afetadas |
| 14 | O Next.js empacota Proxy, páginas e Server Actions em **bundles separados**: cada um tem a própria instância dos módulos, então um `Map` de cache invalidado em uma Server Action **não** alcança o Proxy | Não coloque decisão de acesso em cache de módulo. O status do tenant é relido a cada resolução (`tenant-resolver.ts`); o cache guarda só a identidade, e vive no `globalThis` para ser um só por processo |
| 15 | `unstable_cache` **serializa** o valor: uma `Date` pode voltar como string | Cacheie números/strings (ex.: `getTime()`) e converta na leitura — `getTime()` em string estoura só em produção |
| 16 | Diagnóstico de depuração deixado na interface: a página pública exibia `cap=… mem=… can=…` para qualquer visitante | Estado interno vai para atributos `data-*`, nunca para texto visível; o teste E2E lê atributo com `evaluate`, não `innerText` |
| 17 | Dois cenários E2E com o mesmo `label` colidem no slug da instituição (`tenants_slug_key`) | Rótulo ÚNICO por cenário (`publica-inscricao`, não `publica`) |
| 18 | Cor e tamanho escritos à mão em componente (`text-gray-500`, `#4F46E5`, `text-[13px]`) sobrevivem a qualquer revisão e apodrecem o visual | **Antes de qualquer tela nova:** leia `docs/design-system.md`, importe de `@/components/ui` e rode `npx vitest run tests/unit/design-system-guard.test.ts` — a trava reprova paleta crua, hexadecimal e tamanho arbitrário |
| 19 | Comentário de bloco contendo `/t/*/admin`: a sequência `*/` **fecha o comentário** e o resto vira código (`TS1161: Unterminated regular expression literal`) | Nunca escreva `*/` dentro de comentário; em texto use `/t/<curinga>/admin` |
| 20 | `PATH_TENANT_PREFIX` vale `'/t'` (**com barra** — é prefixo de path), não `'t'` | Ao comparar com um SEGMENTO de URL, remova a barra (`PATH_TENANT_PREFIX.replace(/^\//, '')`); comparar `'t' === '/t'` é sempre falso e falha em silêncio |
| 21 | O PostgreSQL **não aceita parâmetro** em DDL: `CREATE TABLE … PARTITION OF … FOR VALUES FROM ($1) TO ($2)` falha com "bind message supplies 2 parameters, but prepared statement requires 0" | Interpole o limite de partição como literal (`'2026-11-01'`), gerado de uma `Date` calculada no processo |
| 22 | Consulta de introspecção filtrando `relkind = 'r'` **ignora tabela particionada** (`relkind = 'p'`) — o contrato passou a acusar `audit_logs` como ausente e o loop de RLS deixou de cobrir o pai | Use `relkind IN ('r','p') AND NOT c.relispartition` para tabelas-base e verifique as partições separadamente (`relispartition`) |
| 23 | `tenants` tem policy `USING (true)` **por desenho** (a resolução de slug → id acontece antes de existir contexto) | Um teste de isolamento que lê `tenants` **não prova nada**: use uma tabela de tenant de verdade (ex.: `events."tenantId"`) como leitura discriminante |
| 24 | `tenant:read` **não** significa "pode ver tudo da instituição": o papel `PARTICIPANT` tem essa permissão (precisa ler evento e inscrição) | Antes de guardar uma tela com `tenant:read`, pergunte se o público do evento pode ver aquilo. Lista de equipe, papéis e e-mails pedem a permissão da seção de administração |
| 25 | Variável de módulo preenchida no primeiro teste E2E **não existe** no teste seguinte (o worker pode ser recriado) e o sintoma é um `500` com `invalid input syntax for type uuid: "undefined"` | Em E2E, o estado durável é o BANCO: resolva a entidade pelo slug a cada uso (`findUniqueOrThrow`) em vez de guardar o id numa `let` |
| 26 | **Um teste E2E que falha reinicia o worker**: `beforeAll` roda DE NOVO e recria o fixture, então o teste seguinte opera numa instituição vazia e falha por um motivo que não é o dele | Corrija o PRIMEIRO teste que falhou (o resto é cascata) e confirme com um log temporário do estado do banco (`count` = 0 vs `count` global > 0) antes de suspeitar do código de produção |
| 27 | Ao mudar o **conteúdo assinado** por hash (payload de auditoria, documento canônico), toda verificação antiga passa a acusar adulteração | Versione o payload (`resultVersion`/`validationVersion`), grave a versão junto do hash e reconstrua na versão certa — teste de integração que remonta o payload deve ler a versão do BANCO |
| 28 | Parâmetro com nome ambíguo (`winnerId` para uma LINHA enquanto a tela manda o id da PESSOA) produz `NOT_FOUND` silencioso | Nomeie pelo que a coluna É (`positionId`) e deixe o teste de integração cruzar o que a UI envia com o que o serviço procura |
| 29 | Assertiva de E2E do tipo "o último bloco do tipo X está visível" passa apontando para o elemento ANTIGO quando já existe um do mesmo tipo na tela — o teste edita o item errado e a falha só aparece 60 s depois, num locator que parece correto | Ao adicionar um item novo numa lista que já tem itens do mesmo tipo, espere pela CONTAGEM (`toHaveCount(anterior + 1)`) antes de usar `.last()`. Visibilidade não prova que o item novo existe |
| 30 | `<input type="color">` **não tem estado vazio**: um campo não preenchido envia `#000000` | Para cor OPCIONAL, use campo de texto com amostra; vazio significa "usar o token do sistema". O seletor nativo só serve quando a cor é obrigatória |
| 31 | Trocar a ordem de duas linhas num índice único (`(submissionId, authorOrder)`) viola a restrição **no meio** da operação — o PostgreSQL verifica a unicidade a cada `UPDATE` | Substitua o conjunto inteiro na mesma transação (`deleteMany` + `createMany`) em vez de atualizar linha a linha; e preserve os vínculos que seriam perdidos na recriação |
| 32 | Campo opcional de formulário chega como STRING VAZIA, não como ausente: `z.email()` recusa `'  '`, e `?? null` APAGA o valor gravado quando a tela mostra o dado mascarado | Trate vazio como ausente na entrada (`optionalText`) e defina a semântica da escrita: `undefined` = preservar o valor atual, `''` = limpar |
| 33 | O Playwright **dispensa diálogos automaticamente** quando ninguém os trata, e um `window.confirm` dispensado devolve `false` | Se a ação pede confirmação nativa, o teste precisa de `page.on('dialog', (d) => d.accept())`. O sintoma engana: a ação **não chega ao servidor**, então não há erro no log nem mensagem na tela — parece que a funcionalidade não existe |
| 34 | `setInputFiles` num input de arquivo ESCONDIDO cujo `onChange` depende de um clique anterior (índice da linha) não dispara nada | Reproduza o fluxo real: `page.waitForEvent('filechooser')` + clique no botão + `chooser.setFiles(...)`. Definir o arquivo direto pula o estado que o clique monta |
| 35 | Editar uma migração **depois de aplicada** quebra `prisma migrate dev` ("modified after it was applied") mesmo com o banco correto — o ledger guarda o checksum do conteúdo original | Nunca edite migração aplicada: corrija com migração nova. Para um banco de desenvolvimento fora de sincronia, `migrate deploy` aplica o que falta e `prisma migrate reset --force` reaplica a cadeia inteira, realinhando o ledger (e provando que ela funciona do zero) |
| 36 | Estado derivado de dois campos (`isPublished` + `publishAt`) precisa de uma regra que LIMPE o segundo | Se "despublicar" só desmarca o primeiro, o segundo (data já vencida) republica no instante seguinte. Encode a transição numa função pura com teste — e faça a tela dizer que a data foi limpa |
| 37 | A armadilha 34 tem um GÊMEO: assumir que todo input de arquivo é escondido. O `AssetUploader` tem o `<input type="file">` **visível** (escolhe e depois envia), então `waitForEvent('filechooser')` **nunca** dispara e o teste morre no timeout de 60 s | Antes de escrever o E2E de upload, olhe o componente: input visível → `setInputFiles` direto no input; input escondido acionado por clique → `filechooser`. Não existe "o jeito certo" único, e o erro aparece longe da causa |
| 38 | `new Date('2027-03-10T18:00')` de um `<input type="datetime-local">` **usa o fuso do PROCESSO** (UTC no container): a data gravada sai deslocada em horas, sem erro nenhum, e o teste que só compara "existe uma data" passa | Converta explicitamente no fuso da ENTIDADE (aqui, `Event.timezone`) com `zonedWallTimeToInstant`, em **duas passagens** — o deslocamento depende do instante, que depende do deslocamento, e é isso que faz o horário de verão funcionar. Faça o caminho de volta e o teste conferir o INSTANTE gravado |
| 39 | Referência por **URL** não tem chave estrangeira: o banco não sabe que uma imagem está em uso, então `DELETE` do registro + do objeto deixa a página pública com ícone quebrado e nenhum erro no log | Se a referência é uma URL (campo livre, conteúdo de bloco, coluna sem FK), a exclusão precisa **procurar o uso** antes — e recusar explicando ONDE. Varra por listagem (uso calculado uma vez) e extraia as URLs do conteúdo em vez de varrer bloco a bloco |

---

## 6. Ambiente e acesso

```bash
cp .env.example .env
npm install
docker compose up -d            # postgres, redis, minio (+ provisionamento de buckets)
npm run db:setup                # migrate + rls + verify + isolation + seed
npm run dev                     # http://localhost:3000
docker compose --profile app up -d --build   # + web e worker (fila de certificados)
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
eventos, **membros da equipe** e armazenamento (esta última ainda não aplicada).
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
exibição (ADR-111). O acervo **mede** o armazenamento (`sumMediaBytes`), mas **não aplica**
a quota do plano: impor o limite é decisão de produto da F21 (ADR-112 / dívida C4).

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
registradas. Percursos em `README.md` §6.

---

## 7. Onde as coisas estão

```
docs/                  documentação por fase (ADRs, lições, evidências)
README.md              instalação, seed, contas, variáveis, scripts, índice dos docs
src/domain/**          regras puras por área (tenancy, rbac, events, review,
                       gamification, certificates, raffles, platform)
src/lib/**             aplicação e infraestrutura (db, auth, events, review,
                       gamification, certificates, raffles, admin, storage)
src/lib/platform/**    governança global (único uso de adminPrisma na aplicação)
src/app/actions/**     Server Actions — TODA autorização é verificada aqui
src/app/t/[slug]/**    (public) landing pages · (app) painel autenticado
src/app/(public)/organizacoes/**  diretório público de instituições
src/app/superadmin/**  painel de governança (404 para quem não é SuperAdmin)
src/app/instituicao-bloqueada/**  página de bloqueio de instituição suspensa
src/app/validar/**     validação pública de certificado (sem login)
src/workers/           worker BullMQ (fila de certificados)
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
8. **A recompensa nunca derruba o fluxo acadêmico:** ganchos de gamificação falham em
   silêncio (log), nunca bloqueiam submissão ou parecer.

---

## 9. Estado por fase e próximos passos

| Fase | Tema | Situação |
|---|---|---|
| 1 | Infraestrutura, modelagem, RLS | ✅ |
| 2 | Autenticação, RBAC, multi-tenancy | ✅ |
| 3 | Eventos, inscrições, landing pages | ✅ |
| 4 | Submissões e avaliação por pares | ✅ |
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
| 15 | Comunicação (D1–D6, A5: e-mail transacional, notificações, convite de membros, verificação de e-mail) | ⏳ |
| 16 | Sorteios de ponta a ponta (G1–G7 + F1: suplentes, entrega do prêmio por posição, peso por minutos, commit-reveal, resultado público mascarado, prévia ao vivo, gatilhos de marco) | ✅ |
| 17 | Página pública e patrocínio (E3–E6: editor de blocos com validação por tipo, tema visual, capa e logotipo por upload, cotas e patrocinadores com limite de vagas, edição de coautores com ordem de crédito) | ✅ |
| 23 | Conteúdo e mídia (E9–E13: pré-visualização do rascunho pelo mesmo componente da página pública, upload de imagem na galeria, cópia de patrocinador entre eventos, histórico de versões com restauração, publicação agendada decidida na leitura) | ✅ |
| 24 | Mídia e agendamento (E14–E17: biblioteca de mídia com reaproveitamento por checksum e exclusão que confere o uso, sincronia do patrocinador copiado, janela de exibição com `unpublishAt`, data agendada no fuso do evento) | ✅ |
| 18+ | *a definir pelo humano* | ⏳ |

> **Numeração de tema, não de ordem.** Cada tema tem um número **FIXO**: o número
> identifica o tema, não a ordem de entrega. Por isso a FASE 16, a FASE 17, a FASE 23 e a
> FASE 24 foram entregues antes da F15 — o humano escolheu o tema pelo nome dele. A tabela
> acima segue a ordem cronológica; a numeração é a do tema.

**Dívidas técnicas:** o levantamento consolidado (**40 itens abertos**, soma das
tabelas de tema — o levantamento original menos o que as FASES 12, 13, 14, 16, 17, 23 e 24
quitaram, mais o que cada uma declarou de novo; verificado no código, com esforço e
fases candidatas numeradas como as fases que serão entregues — **F15 Comunicação** ·
~~F16 Sorteios de ponta a ponta~~ (entregue) · ~~F17 Landing page e patrocínio~~
(entregue) · F18 Segurança de documentos · F19 Gamificação avançada · F20 Observabilidade
de segunda ordem · F21 Ciclo de vida do membro e storage · F22 Operação de palco ·
~~F23 Conteúdo e mídia~~ (entregue) · ~~F24 Mídia e agendamento~~ (entregue) ·
F25 Acervo de mídia: miniaturas, busca e sincronia em lote) está em
**`docs/dividas-tecnicas.md`**.
Leia antes de propor a próxima fase: ele já diz o que falta, o que foi quitado e a
ordem sugerida.

---

## 10. Primeira ação de uma sessão nova

1. Ler `README.md`, `docs/design-system.md`, `docs/dividas-tecnicas.md` e o documento da **última fase entregue** (`docs/fase-24-midia-e-agendamento.md` — a F15 segue pendente).
2. Rodar a bateria da seção 4 para confirmar que a árvore está verde **antes** de
   mexer em qualquer coisa (se algo falhar, isso é o primeiro trabalho).
3. Apresentar ao humano o **plano da fase pedida** (domínio → aplicação → interface →
   testes → documentação) e **aguardar** a definição/requisitos dela.
4. Implementar, verificar, documentar e **parar** em `Aguardando APROVADO: AVANÇAR`.





