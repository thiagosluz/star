# EventFlow

Plataforma SaaS multi-tenant para gestão de **eventos acadêmicos, corporativos e
comunitários** — da inscrição ao certificado, passando por submissão de trabalhos,
avaliação por pares e gamificação.

> **Estado:** FASES 1 a 10 concluídas · **770 testes** unitários/integração · **42 testes E2E**
> · ESLint e `tsc` sem erros · isolamento multi-tenant provado contra o banco real

---

## Índice

1. [O que a plataforma faz](#1-o-que-a-plataforma-faz)
2. [Stack](#2-stack)
3. [Requisitos](#3-requisitos)
4. [Instalação inicial (passo a passo)](#4-instalação-inicial-passo-a-passo)
5. [Stack completa em containers (com worker)](#5-stack-completa-em-containers-com-worker)
6. [Dados de demonstração (seed)](#6-dados-de-demonstração-seed)
7. [Usuários padrão do seed](#7-usuários-padrão-do-seed)
8. [Variáveis de ambiente](#8-variáveis-de-ambiente)
9. [Scripts disponíveis](#9-scripts-disponíveis)
10. [Testes](#10-testes)
11. [Documentação centralizada](#11-documentação-centralizada)
12. [Arquitetura em uma página](#12-arquitetura-em-uma-página)
13. [Segurança e isolamento multi-tenant](#13-segurança-e-isolamento-multi-tenant)
14. [Solução de problemas](#14-solução-de-problemas)
15. [Limitações conhecidas](#15-limitações-conhecidas)

---

## 1. O que a plataforma faz

| Domínio | Capacidade |
|---|---|
| **Multi-tenancy + RBAC** | Uma base, várias instituições isoladas por Row-Level Security; 11 papéis e 54 permissões, com acúmulo de papéis e troca de contexto sem perder a sessão |
| **Eventos e inscrições** | Eventos, atividades, salas, vagas sem superlotação (mesmo sob concorrência), lista de espera FIFO, landing pages públicas personalizáveis e **inscrição aberta**: quem se inscreve passa a ser participante da instituição (vínculo suspenso ou removido continua bloqueado) |
| **Submissão e avaliação** | Chamada de trabalhos por trilha, upload de PDF direto ao storage, revisão cega, rubrica com nota ponderada, conflito de interesse e decisão do comitê |
| **Gamificação** | XP com livro-razão idempotente, cartas colecionáveis com raridade e foil, missões, ofensiva, níveis e prestígio |
| **Certificação** | PDF/SVG assinado (HMAC-SHA256), hash de integridade, QR Code e **validação pública sem login** |
| **Credenciamento** | Check-in/check-out com carga horária real, por busca ou por leitor de QR Code |
| **Painel administrativo** | Eventos, salas, programação, trilhas, cartas, missões e certificados pela interface, com trilha de auditoria |
| **Sorteios** | Sorteio por evento, dia ou atividade, elegível apenas por **presença real**, com amostragem criptográfica, hash auditável e revelação animada |
| **Governança da plataforma** | Papel `SUPERADMIN` em escopo próprio (`PLATFORM`), provisionamento atômico de instituições, métricas consolidadas, suspensão com corte imediato de tráfego e **diretório público** de instituições em `/organizacoes` |

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Aplicação | Next.js 16 (App Router, Server Components, Server Actions, Route Handlers) · React 19 |
| Arquitetura | Clean Architecture / DDD adaptado ao Next.js (domínio puro, aplicação, infraestrutura) |
| Banco | PostgreSQL 18 com **Row-Level Security** · Prisma 7 (driver adapter `pg`) |
| Cache e filas | Redis 8 · BullMQ (geração de certificados) |
| Storage | MinIO (S3-compatível), buckets privados com URLs pré-assinadas |
| Interface | Tailwind CSS 4 · Shadcn/UI (primitivas) · Lucide · Canvas Confetti |
| Autenticação | Better Auth 1.7 + adapter Prisma |
| Qualidade | Vitest · Testing Library · Playwright |
| Infra | Docker · Docker Compose multi-stage |

---

## 3. Requisitos

| Requisito | Versão | Observação |
|---|---|---|
| Node.js | **≥ 24** | `package.json` declara `engines.node` |
| npm | ≥ 10 | os comandos deste README usam `npm` (o projeto versiona `package-lock.json`) |
| Docker + Compose | Docker Desktop recente | precisa estar **em execução** |
| Portas livres | 3000, 5432, 6379, 9000, 9001 | configuráveis em `.env` |

---

## 4. Instalação inicial (passo a passo)

```bash
# 1. Variáveis de ambiente
cp .env.example .env
#    O .env.example já traz valores funcionais para desenvolvimento local.
#    Leia a seção 8 antes de subir para qualquer ambiente compartilhado.

# 2. Dependências
npm install

# 3. Infraestrutura (PostgreSQL, Redis, MinIO + provisionamento de buckets)
docker compose up -d
docker compose ps          # aguarde os três serviços como "healthy"

# 4. Banco: migrações, RLS, verificação do contrato, prova de isolamento e seed
npm run db:setup

# 5. Aplicação
npm run dev                # http://localhost:3000
```

O que o passo 4 faz, em ordem:

| Comando interno | O que garante |
|---|---|
| `db:migrate` | aplica as migrações e regenera o cliente Prisma |
| `db:rls` | (re)aplica as policies de Row-Level Security — **rode sempre que criar tabela com `tenantId`** |
| `db:verify` | falha se alguma tabela de tenant estiver sem RLS/policy ou se a role de runtime puder ignorar a RLS |
| `db:verify:isolation` | executa **9 ataques** reais de isolamento entre instituições |
| `db:seed` | popula os dados de demonstração (seção 6) |

**URLs depois de subir:**

```text
Aplicação .......... http://localhost:3000
Landing pages ...... http://localhost:3000/t/ufba-demo/eventos
Console do MinIO ... http://localhost:9001   (eventflow_minio / eventflow_minio_secret)
Subdomínios ........ http://ufba-demo.lvh.me:3000/eventos   (ROOT_DOMAIN=lvh.me)
```

---

## 5. Stack completa em containers (com worker)

Na FASE 6 a geração de certificados passou a rodar em um **worker BullMQ** separado.
Para exercitar esse caminho (e rodar os E2E), suba a stack completa:

```bash
docker compose --profile app up -d --build
docker compose --profile app ps
docker logs eventflow-worker --tail 30     # fila "certificates"
```

> **Atenção:** se o `--build` falhar, o Compose **mantém o container anterior no ar**.
> Um `docker compose ps` mostrando "healthy" não prova que a imagem é a nova. Confira
> com `docker images | grep eventflow/web` antes de concluir que o código subiu.

---

## 6. Dados de demonstração (seed)

`npm run db:seed` recria **dois** tenants de demonstração de forma idempotente
(remove e recria os dados identificados pelos slugs/e-mails do seed).

### Instituições

| Slug | Nome | Fuso |
|---|---|---|
| `ufba-demo` | Universidade Federal da Bahia | America/Bahia |
| `fiocruz-demo` | Fundação Oswaldo Cruz | America/Sao_Paulo |

### Conteúdo criado

```text
Eventos ......... 2 (Congresso de Tecnologia e Educação 2026 · Simpósio de Saúde Coletiva 2026)
Salas ........... 2 no congresso (Auditório 300 lugares · Sala de Oficinas 40)
Atividades ...... 4 (abertura, minicurso Rust com 30 vagas + lista de espera, mesa-redonda, palestra)
Chamada ......... 1 trilha "Tecnologia Educacional": rubrica de 4 critérios (pesos 3/3/1/1),
                  2 pareceres exigidos, aceite ≥ 70, rejeição < 45, revisão cega
Revisores ....... 2 perfis: Bruno declara a UFBA (gera conflito no painel do comitê)
                  e Diego é de outra instituição (candidato elegível)
Gamificação ..... 7 cartas (comum → mítica; duas com tiragem limitada de 50 e 10),
                  6 missões e 9 fatos de XP — Ana com 700 XP/nível 5/2 cartas,
                  Bruno com 920 XP/nível 5/3 cartas (1 foil)
Certificação .... presença medida de 240 min (Bruno) + 1 trabalho aceito (Ana)
                  e 2 certificados emitidos, com código e PDF válidos
```

Os **códigos de validação** dos certificados são aleatórios a cada execução e são
impressos no fim do seed:

```text
Certificação (FASE 6):
  Bruno (minicurso): CERT-XXXXXXXX (emitido) · http://localhost:3000/validar/CERT-XXXXXXXX
  Ana (autoria):     CERT-YYYYYYYY (emitido) · http://localhost:3000/validar/CERT-YYYYYYYY
```

Abra a URL em uma **janela anônima**: a validação pública funciona sem login.

### Percursos de demonstração

```text
Painel público ..... /t/ufba-demo/eventos
Landing do evento .. /t/ufba-demo/eventos/congresso-2026
Inscrição .......... /t/ufba-demo/eventos/congresso-2026/atividades/minicurso-rust
Submissões ......... /t/ufba-demo/submissoes        (autor)
Revisões ........... /t/ufba-demo/revisoes          (revisor)
Comitê ............. /t/ufba-demo/comite            (presidente do comitê)
Conquistas ......... /t/ufba-demo/conquistas        (XP, missões, ranking)
Cartas ............. /t/ufba-demo/cartas            (álbum)
Certificados ....... /t/ufba-demo/certificados
Credenciamento ..... /t/ufba-demo/credenciamento    (equipe: busca e leitor de QR)
Painel admin ....... /t/ufba-demo/administracao     (gestão + trilha de auditoria)
Sorteios ........... /t/ufba-demo/administracao/eventos/<id>/sorteios
Validação pública .. /validar/<código>              (sem login)
Diretório público .. /organizacoes                  (sem login: todas as instituições)
Governança ......... /superadmin                    (só SuperAdmin; 404 para os demais)
Instituição suspensa /instituicao-bloqueada?slug=<slug>
```

---

## 7. Usuários padrão do seed

> ### ✅ Quer entrar e testar agora? Use as **contas de teste**
>
> ```bash
> npm run db:seed:dev     # uma conta por perfil, todas com senha EventFlow@2026
> ```
>
> Tabela completa (perfil → o que testar → onde clicar) em
> [`docs/contas-de-teste.md`](docs/contas-de-teste.md). O script **se recusa a rodar
> em produção**.
>
> As contas abaixo são as do seed principal, que servem para exercitar RBAC no banco —
> e que **não têm senha**, de propósito.

| Conta | Papéis | Vínculo |
|---|---|---|
| `ana@example.test` | ADMIN em `ufba-demo` · CHAIR + PARTICIPANT em `fiocruz-demo` | dois tenants ativos |
| `bruno@example.test` | ORGANIZER + REVIEWER + STAFF (escopo de evento) em `ufba-demo` | ativo |
| `carla@example.test` | PARTICIPANT em `ufba-demo` | **convite PENDENTE** |
| `diego@example.test` | REVIEWER em `ufba-demo` | ativo |

> ### ⚠️ Essas contas **não têm senha**
>
> Elas existem para exercitar **RBAC, multi-tenancy e gamificação**, não para login
> por senha: uma conta só consegue autenticar se tiver uma linha em `account`
> (`providerId = 'credential'`), e o seed não cria nenhuma para elas. Tentar entrar com
> qualquer senha falha, e isso é intencional.
>
> **Para usar a interface com um usuário real:** crie uma conta em `/signup` e
> vincule-a à instituição de demonstração:
>
> ```bash
> # 1. crie a conta pela interface: http://localhost:3000/signup
> # 2. descubra o id do usuário e vincule + conceda papel (exemplo com psql via container)
> docker exec -it eventflow-postgres psql -U eventflow_admin -d eventflow -c \
>   "SELECT id, email FROM \"user\" WHERE email = 'seu.email@exemplo.test';"
> ```
>
> Com o `id` em mãos, use o Prisma Studio (`npm run db:studio`) para inserir a linha
> em `user_tenant_profiles` (`status = ACTIVE`) **com `tenantId` preenchido** e a
> linha correspondente em `role_assignments` (`role = 'ADMIN'`, `scope = 'TENANT'`).
> Também é possível reaproveitar `tests/e2e/helpers.ts`, que faz exatamente isso
> (`linkUser` + `grantRole`).
>
> **Observação sobre `carla@example.test`:** o vínculo com status `INVITED` **não
> concede contexto** — a plataforma é *fail-closed*: sem vínculo ativo, a
> instituição não aparece no seletor e o acesso é negado.

### Primeiro SuperAdmin (governança da plataforma)

O seed **não** cria um SuperAdmin, e isso é deliberado: a primeira concessão não pode
depender de alguém que já a tenha. Crie a conta em `/signup` e conceda o papel pela
conexão administrativa (a única que enxerga concessões de plataforma, que têm
`tenantId = NULL`):

```bash
docker exec -it eventflow-postgres psql -U eventflow_admin -d eventflow -c "
INSERT INTO role_assignments (id, \"tenantId\", \"userId\", role, scope, \"grantedAt\", \"updatedAt\", reason)
SELECT gen_random_uuid(), NULL, id, 'SUPERADMIN', 'PLATFORM', now(), now(), 'Concessão inicial'
FROM \"user\" WHERE email = 'seu.email@exemplo.test';"
```

A partir daí o painel `/superadmin/governanca` concede e revoga os demais — e
`/superadmin` responde **404** para quem não tem o papel.

---

## 8. Variáveis de ambiente

O `.env.example` é a fonte da verdade; abaixo estão as que realmente importam para
entender o comportamento do sistema.

### Banco de dados — **dois papéis, de propósito**

| Variável | Papel |
|---|---|
| `MIGRATE_DATABASE_URL` | role **admin/dona do schema** (`eventflow_admin`): usada por CLI, seed e Better Auth |
| `APP_DATABASE_URL` | role de **runtime** (`eventflow_app`, `NOSUPERUSER`, `NOBYPASSRLS`): é a conexão que sofre RLS |

Usar a mesma conexão para tudo faria a RLS perder sentido: o dono da tabela a ignora
sem `FORCE ROW LEVEL SECURITY`, e o runtime **nunca** pode ter esse privilégio.

### Segredos

| Variável | Observação |
|---|---|
| `BETTER_AUTH_SECRET` | obrigatória em qualquer ambiente real; o build falha com o valor padrão |
| `CERTIFICATE_SIGNING_KEY_ID` | identificador da chave de assinatura (permite rotação auditável) |
| `CERTIFICATE_HMAC_SECRET` | segredo HMAC dos certificados — **o web e o worker precisam do MESMO valor**, senão todo certificado parece adulterado |
| `RATE_LIMIT_ENABLED` | nos E2E precisa ser `false` (o rate limiter é em memória e por processo) |

### Serviços e portas

| Variável | Padrão |
|---|---|
| `APP_PORT` / `APP_URL` | `3000` / `http://localhost:3000` |
| `POSTGRES_PORT` | `5432` |
| `REDIS_URL` | `redis://localhost:6379` |
| `MINIO_API_PORT` / `MINIO_CONSOLE_PORT` | `9000` / `9001` |
| `S3_ENDPOINT` / `S3_PUBLIC_ENDPOINT` | `http://localhost:9000` |
| `S3_BUCKET_SUBMISSIONS` / `_CERTIFICATES` / `_ASSETS` / `_AVATARS` | buckets privados |
| `ROOT_DOMAIN` / `NEXT_PUBLIC_ROOT_DOMAIN` | `lvh.me` (subdomínios por instituição) |
| `E2E_BASE_URL` | base usada pelos testes Playwright |

---

## 9. Scripts disponíveis

| Script | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção (**usa `cross-env NODE_ENV=production`** — não rode `next build` direto, veja a seção 14) |
| `npm run start` | serve o build de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:setup` | `migrate` + `rls` + `verify` + `verify:isolation` + `seed` |
| `npm run db:setup:dev` | o de cima + contas de teste com senha (ver `docs/contas-de-teste.md`) |
| `npm run db:migrate` | migrações + regeneração do cliente Prisma |
| `npm run db:rls` | reaplica as policies de RLS (idempotente) |
| `npm run db:verify` | verifica o contrato de isolamento (tabelas, policies, roles) |
| `npm run db:verify:isolation` | 9 ataques de isolamento entre tenants |
| `npm run db:seed` | dados de demonstração |
| `npm run db:seed:dev` | **só em desenvolvimento**: uma conta por perfil, com senha padrão (recusa-se a rodar em produção) |
| `npm run db:studio` | Prisma Studio |
| `npm test` | Vitest (unit + integração) |
| `npm run test:e2e` | Playwright (contra o container em `http://localhost:3000`) |
| `npm run test:e2e:ui` / `:report` | modo interativo / relatório |
| `npm run infra:up` / `down` / `reset` / `logs` / `ps` | atalhos do Docker Compose |
| `npm run infra:buckets` | reprovisiona os buckets do MinIO |

---

## 10. Testes

```bash
npm test                  # 770 testes (26 arquivos) — unit + integração com banco real
npm run test:e2e          # 42 testes E2E contra o container de produção
npm run typecheck         # 0 erros
npm run lint              # 0 erros / 0 warnings
npm run db:verify         # contrato de RLS íntegro
npm run db:verify:isolation   # 9/9 ataques de isolamento barrados
```

- **Integração** roda contra o PostgreSQL e o MinIO **reais** (a RLS é a fronteira de
  segurança; testá-la com mock testaria o mock).
- **E2E** exige a stack no ar (`docker compose --profile app up -d --build`) e cobre,
  entre outros: isolamento entre instituições, jornada de inscrição, avaliação por
  pares, gamificação, certificação e a jornada administrativa completa.
- `tests/unit/**` não toca banco; `tests/integration/**` exige a infraestrutura.

---

## 11. Documentação centralizada

> **Trabalhando com um agente de código?** Leia primeiro o [`AGENTS.md`](AGENTS.md):
> ele traz o protocolo de fases, a bateria de verificação, as convenções e as
> armadilhas conhecidas do projeto.

Toda a documentação técnica vive em `docs/`, uma fase por arquivo. Cada documento
traz **ADRs** (decisões com contexto e consequências), **lições aprendidas** (defeitos
reais encontrados por testes), **evidências de verificação** e **comandos**.

| Documento | Conteúdo | ADRs |
|---|---|---|
| [`docs/fase-01-infra-e-modelagem.md`](docs/fase-01-infra-e-modelagem.md) | Docker Compose, PostgreSQL 18, roles `admin`/`app`, RLS com `FORCE`, modelagem completa (34+ modelos), contrato de isolamento | ADR-001 … 008 |
| [`docs/fase-02-auth-rbac.md`](docs/fase-02-auth-rbac.md) | Better Auth, 10 papéis de instituição (54 permissões hoje, incluindo a de plataforma), escopos, acúmulo de papéis, troca de contexto por cookie assinado | ADR-009 … 013 |
| [`docs/fase-03-eventos-inscricoes.md`](docs/fase-03-eventos-inscricoes.md) | Ciclo de vida do evento, lotação sob concorrência, lista de espera FIFO, landing page modular com tema validado | ADR-014 … 018 |
| [`docs/fase-04-submissoes-peer-review.md`](docs/fase-04-submissoes-peer-review.md) | Chamada de trabalhos, upload direto ao storage, rubrica ponderada, conflito de interesse, revisão cega, decisão | ADR-019 … 024 |
| [`docs/fase-05-gamificacao.md`](docs/fase-05-gamificacao.md) | Motor de recompensas, XP idempotente, curva de níveis, prestígio, cartas, foil, missões, credenciamento | ADR-025 … 031 |
| [`docs/fase-06-certificacao.md`](docs/fase-06-certificacao.md) | Elegibilidade, carga horária real, conteúdo canônico, assinatura HMAC, PDF/SVG, QR, fila BullMQ, validação pública | ADR-032 … 038 |
| [`docs/fase-07-painel-admin-e2e.md`](docs/fase-07-painel-admin-e2e.md) | Painel administrativo, trilha de auditoria, validações de agenda ligadas, E2E completo e estado final do projeto | ADR-039 … 043 |
| [`docs/fase-08-motor-de-sorteios.md`](docs/fase-08-motor-de-sorteios.md) | Sorteios por evento/dia/atividade, elegibilidade por presença real, amostragem criptográfica, trava pessimista na apuração, hash auditável e RLS por introspecção | ADR-044 … 049 |
| [`docs/fase-09-diretorio-e-superadmin.md`](docs/fase-09-diretorio-e-superadmin.md) | Escopo `PLATFORM`, SuperAdmin, provisionamento atômico, suspensão com corte imediato de tráfego, métricas consolidadas e diretório público de instituições | ADR-050 … 059 |
| [`docs/fase-10-inscricao-publica.md`](docs/fase-10-inscricao-publica.md) | Inscrição aberta em evento público, vínculo automático de participante na mesma transação, bloqueio da instituição com precedência e aviso ao participante | ADR-060 … 063 |
| [`docs/contas-de-teste.md`](docs/contas-de-teste.md) | **Guia operacional:** uma conta por perfil com senha padrão, o que testar em cada uma, comportamento das contas de borda e como o script cria as credenciais | — |

> A numeração de ADRs é **sequencial e global** ao projeto (não reinicia por fase):
> são **63 decisões** registradas até aqui.

### Convenções da documentação

- **Português** em código, comentários de decisão, documentação e mensagens de erro
  (o produto é para instituições brasileiras).
- Comentários explicam **por que**, nunca "o que" — o código já diz o que faz.
- Decisões não óbvias viram **ADR**; defeitos encontrados por testes viram **lição
  aprendida** com sintoma, causa raiz e correção.
- Números de teste nas evidências são os **reais** do momento da fase.

---

## 12. Arquitetura em uma página

```text
src/
├── domain/            regras puras, sem Prisma e sem Next (testáveis isoladamente)
│   ├── tenancy/       resolução de instituição, slugs e validação
│   ├── rbac/          papéis, permissões e o `can()` (fail-closed)
│   ├── events/        ciclo de vida, inscrições, agenda, landing page
│   ├── review/        submissão, rubrica, afinidade, conflito de interesse
│   ├── gamification/  XP, níveis, cartas, missões
│   └── certificates/  elegibilidade, carga horária, código e conteúdo canônico
├── lib/               aplicação e infraestrutura
│   ├── db/            cliente com contexto de tenant (RLS), cliente admin, erros do Prisma
│   ├── auth/          sessão, guarda de páginas
│   ├── events/        inscrições, credenciamento
│   ├── review/        submissões e avaliação por pares
│   ├── gamification/  motor de recompensas, serviços, ganchos
│   ├── certificates/  assinatura, renderização (PDF/SVG), serviço, fila
│   ├── admin/         trilha de auditoria e catálogo do painel
│   ├── platform/      governança global: repositório administrativo, serviços,
│   │                  diretório público e guarda de plataforma (404)
│   ├── storage/       cliente S3/MinIO (URLs pré-assinadas)
│   └── tenancy/       resolução e cache de instituição
├── app/               Next.js
│   ├── actions/       Server Actions (toda autorização é verificada aqui)
│   ├── api/           Route Handlers (auth, health, download de certificado)
│   ├── (public)/organizacoes     diretório público de instituições
│   ├── superadmin/               painel de governança da plataforma
│   ├── instituicao-bloqueada/    página de bloqueio (instituição suspensa)
│   ├── t/[tenantSlug]/(public)  landing pages sem autenticação
│   ├── t/[tenantSlug]/(app)     painel autenticado
│   └── validar/[code]           validação pública de certificado
├── components/        UI por domínio (review, gamification, certificates, admin…)
└── workers/           entrypoint do worker BullMQ
prisma/
├── schema.prisma      modelo de dados
├── migrations/        migrações (incluindo índices parciais e policies escritas à mão)
├── scripts/           RLS, verificação de contrato, prova de isolamento
└── seed.ts            dados de demonstração
tests/
├── unit/              603 testes de regra pura (domínio, sem banco)
├── integration/       167 testes com banco e storage reais
└── e2e/               42 testes Playwright contra o container
```

**Cinco decisões que explicam o resto:**

1. **Domínio puro e sem ORM.** As regras (`src/domain`) não importam Prisma nem Next,
   então podem ser testadas isoladamente e reusadas no cliente (paleta de carta,
   tema de página).
2. **Todo acesso a dados passa por `withTenant()`.** O contexto da instituição é
   aplicado por transação (`SET LOCAL app.tenant_id`), propagado por
   `AsyncLocalStorage` — nunca por `SET` global, que vazaria entre requisições.
3. **A RLS é a última linha de defesa, não a única.** Autorização é verificada em
   layouts, páginas e Server Actions; a policy garante que um filtro esquecido não
   vire vazamento.
4. **O banco decide o que é concorrência.** Vaga, posição na fila, tiragem de carta e
   crédito de XP usam índice único e `UPDATE` condicional — o retorno de 0 linhas é a
   resposta de negócio.
5. **Documento é dado, não tela.** Certificado tem snapshot imutável, hash e
   assinatura sobre conteúdo canônico; o renderizador (PDF/SVG) é apresentação.

---

## 13. Segurança e isolamento multi-tenant

```bash
npm run db:verify              # contrato: RLS + FORCE + policy em toda tabela de tenant
npm run db:verify:isolation    # 9 ataques reais entre instituições
```

Os 9 cenários provam, contra o banco real:

```text
[A1] sem contexto de tenant, nenhuma linha é visível (fail-closed)
[A2] tenant A enxerga apenas os próprios eventos
[A3] UPDATE em dado de outro tenant afeta 0 linhas
[A4] DELETE em dado de outro tenant afeta 0 linhas
[A5] INSERT com tenantId de outro tenant é rejeitado pelo WITH CHECK
[A6] vínculos de usuário isolados
[A7] COUNT(*) agregado conta apenas o próprio tenant
[A8] contexto não vaza para a conexão seguinte do pool (SET LOCAL)
[A9] a role de runtime não desliga a RLS nem escala privilégio
```

Duas consequências práticas:

- **Criou tabela com `tenantId`?** Rode `npm run db:rls` e depois `npm run db:verify`.
  Uma tabela com RLS habilitada e sem policy é *fail-closed*: a aplicação não lê nada.
- **Nunca** conceda `BYPASSRLS` ou `SUPERUSER` à role de runtime: `db:verify` falha e
  o isolamento deixa de existir.

---

## 14. Solução de problemas

| Sintoma | Causa | Solução |
|---|---|---|
| Container `postgres` reinicia em loop | Volume montado em `/var/lib/postgresql/data`; o PostgreSQL 18 usa `/var/lib/postgresql` (diretório pai) | Corrija o volume em `docker-compose.yml` ou recrie com `npm run infra:reset` |
| Build falha em `/_global-error` com `useContext` nulo | `.env` define `NODE_ENV=development`, carregado pelo Next durante o build | Use `npm run build` (aplica `NODE_ENV=production`) — **não** rode `next build` direto |
| Build falha com "You are using the default secret" | `BETTER_AUTH_SECRET` ausente no momento do build | Defina a variável no `.env` (e nos `args` do Dockerfile em produção) |
| Rota nova responde **404** e o container parece saudável | O `--build` falhou e o Compose manteve o container anterior | Veja o log completo do build; confirme `docker images \| grep eventflow/web` e recrie |
| "Server Actions must be async functions" | Arquivo `'use server'` exporta função não-async | Torne a função `async` ou mova o utilitário para outro módulo |
| Tabela nova não retorna nada | RLS habilitada sem policy (fail-closed) | `npm run db:rls` → `npm run db:verify` |
| E2E derruba com HTTP 429 | Rate limiter do Better Auth (em memória, por processo) | `RATE_LIMIT_ENABLED=false` no `.env` do container |
| Certificado inválido na página pública | Chaves de assinatura diferentes entre web e worker | Use o mesmo `CERTIFICATE_HMAC_SECRET` (e `KEY_ID`) nos dois serviços |
| Seed falha com "nenhuma linha visível" | O seed precisa de contexto: ele usa `set_config` por tenant | Rode via `npm run db:seed` (nunca copie o SQL sem o contexto) |
| `docker compose up` sem MinIO | As imagens oficiais do MinIO foram removidas do Docker Hub/Quay (2025) | O projeto já usa a imagem da Chainguard + `docker/minio/Dockerfile.probe`; rode `docker compose build minio` |

---

## 15. Limitações conhecidas

Registradas nas dívidas técnicas de cada fase — nenhuma escondida:

1. **Assinatura de certificado é HMAC (simétrica).** Permite à instituição validar os
   próprios documentos; validação offline por terceiros que não confiam na instituição
   exigiria PKCS#7/CMS com X.509 (o campo `signatureAlg` já está preparado).
2. **Rate limiter em memória e por processo** — precisa migrar para Redis antes de
   escalar horizontalmente.
3. **Editor visual da landing page** e cadastro de patrocinadores pela interface ainda
   não existem (o domínio e a renderização estão prontos desde a FASE 3).
4. **Convites de membros, edição de coautores e upload de capa** pela UI estão
   pendentes.
5. **Paginação** nas listagens administrativas é por limite de consulta.
6. **Auditoria de leitura**: a trilha registra mutações; visualização de dado pessoal
   não é registrada (exceto o contador de validação pública).
7. **Antivírus nos arquivos de submissão** (`scanStatus = SKIPPED`, marcado
   honestamente em vez de afirmar "limpo").
8. **Notificações por e-mail** (atribuição de parecer, certificado emitido) dependem
   do worker; a fila existe, o envio não.

---

**Próximos passos sugeridos:** fechar as dívidas acima por prioridade de risco
(rate limit em Redis e PKCS#7 primeiro), adicionar observabilidade (OpenTelemetry,
métricas de fila) e preparar o deploy com segredos gerenciados por cofre.

