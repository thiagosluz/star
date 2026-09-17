# FASE 1 — Arquitetura de Infraestrutura & Modelagem de Dados

> **Status:** ✅ Concluída e verificada contra ambiente real
> **Data:** Setembro/2026
> **Pré-requisito:** nenhum (fase inicial)

---

## 1. Sumário executivo

Esta fase entrega a fundação sobre a qual todas as demais se apoiam:

| Entregável | Arquivo | Estado |
|---|---|---|
| Stack de containers | `docker-compose.yml` | ✅ 4 serviços saudáveis |
| Provisionamento de roles | `docker/postgres/init/00-roles.sql` | ✅ verificado |
| Extensões e parâmetros | `docker/postgres/init/01-database.sql` | ✅ verificado |
| Row-Level Security | `docker/postgres/init/02-rls-policies.sql` | ✅ 27 tabelas |
| Modelo de dados | `prisma/schema.prisma` | ✅ 32 tabelas, válido |
| Migração inicial | `prisma/migrations/20260916201435_init/` | ✅ aplicada |
| Cliente com contexto de tenant | `src/lib/db/tenant-client.ts` | ✅ 8 testes passando |
| Contrato de isolamento | `src/lib/db/schema-contract.ts` | ✅ verificável |
| Provas de isolamento | `prisma/scripts/assert-*.mjs` | ✅ 9/9 ataques bloqueados |
| Provisionamento de buckets | `docker/minio/provision.mjs` | ✅ 5 buckets |

**Resultado central:** o isolamento entre instituições é garantido **pelo banco de
dados**, não por disciplina de código. Nove vetores de ataque foram simulados
contra um PostgreSQL real e todos foram bloqueados (§7).

---

## 2. Versões verificadas

Todas as versões abaixo foram confirmadas executando o ambiente, não copiadas de
documentação.

| Componente | Versão | Observação |
|---|---|---|
| Node.js | 26.2.0 | runtime local; imagem `node:24-alpine` no container |
| PostgreSQL | **18.6** (Debian) | `postgres:18-trixie` |
| Redis | **8.10.1** | `redis:8-alpine` |
| MinIO | **RELEASE.2026-07-17** | `cgr.dev/chainguard/minio` |
| Next.js | 16.3.5 | instalado na FASE 2 |
| React | 19.3.0 | instalado na FASE 2 |
| Prisma | 7.10.0 | CLI **e** client na mesma versão |
| TypeScript | 5.9.3 | não usar 7.x ainda (ver §8) |
| Vitest | 5.0.1 | |
| Docker Engine | 29.5.2 | Docker Compose v5.1.3 |

### Digests para reprodutibilidade

```text
postgres:18-trixie                        postgres@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280
redis:8-alpine                            redis@sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576
node:24-alpine                            node@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81
cgr.dev/chainguard/minio:latest           cgr.dev/chainguard/minio@sha256:29bbe439d3a3c41afac869973c08a70b1a7e7e6a3822015a110bf53df7e3e66c
cgr.dev/chainguard/minio-client:latest    cgr.dev/chainguard/minio-client@sha256:63006e6144cabe63d5b511de2697e8037f711694a220e324f43c834490c7a3f5
```

Para congelar as imagens em CI/produção, substitua as tags pelos digests acima.

---

## 3. Estratégia de isolamento multi-tenant

### 3.1 A decisão

**Shared Database + Shared Schema + coluna `tenantId` + Row-Level Security.**

Cada tabela de domínio possui `tenantId UUID NOT NULL`. O PostgreSQL aplica uma
policy que compara `"tenantId"` com uma variável de sessão (`app.tenant_id`) que
a aplicação define no início de cada transação.

### 3.2 As três alternativas avaliadas

| Abordagem | Isolamento | Custo operacional | Migrações | Veredito |
|---|---|---|---|---|
| **Database por tenant** | Máximo | Altíssimo: N bancos, N pools, N migrações | N execuções por deploy | ❌ Inviável para SaaS com muitos tenants pequenos |
| **Schema por tenant** | Alto | Alto: `search_path` dinâmico, milhares de tabelas | N execuções por deploy | ❌ Escala mal e complica connection pooling |
| **Shared schema + RLS** | Alto (garantido no banco) | Baixo: um pool, uma migração | Uma execução | ✅ **Escolhido** |

### 3.3 Por que RLS e não apenas `WHERE tenantId = ?`

Porque o filtro na aplicação depende de disciplina humana, e ela falha:

- um `findMany()` novo sem filtro → vazamento silencioso;
- um `JOIN` que esquece o `WHERE` da tabela associada → vazamento;
- um endpoint de exportação/relatório → vazamento;
- uma migração ou script ad-hoc executado sem filtro → vazamento.

Com RLS, mesmo que a query ignore completamente o `tenantId`, o banco retorna
apenas as linhas do tenant ativo. **A garantia deixa de ser um invariante de
código e passa a ser um invariante de dados.** É a diferença entre "esperamos que
ninguém erre" e "errar é impossível".

### 3.4 O mecanismo exato

```text
   Requisição HTTP  ──►  Middleware resolve o tenant (subdomínio/path)
                                    │
                                    ▼
                     withTenant(tenantId, () => { ... })
                                    │
                    ┌───────────────┴────────────────┐
                    │  prisma.$transaction(async tx => {              │
                    │    SET LOCAL app.tenant_id = '<uuid>'           │
                    │    ...todo o trabalho de banco...               │
                    │  })                                             │
                    └───────────────┬────────────────┘
                                    │  COMMIT / ROLLBACK
                                    ▼
                    SET LOCAL é DESCARTADO pelo PostgreSQL
                    A conexão volta LIMPA para o pool
```

Três detalhes que fazem isso funcionar corretamente:

1. **`SET LOCAL`, não `SET`.** Um `SET` comum ficaria "grudado" na conexão física
   e vazaria para a próxima requisição que reutilizasse aquela conexão do pool —
   potencialmente de outro tenant. `SET LOCAL` é desfeito no fim da transação.
   O teste **A8** prova isso.

2. **Uma transação, uma conexão.** Dentro de `$transaction()` o Prisma fixa uma
   única conexão, então o `SET LOCAL` e as queries de domínio rodam na mesma
   sessão do PostgreSQL. Fora de uma transação, cada query poderia cair em uma
   conexão diferente do pool.

3. **`set_config(..., true)` é parametrizável.** O valor do tenant é enviado como
   *bind parameter*, nunca interpolado na string SQL. Não há superfície de
   injeção, mesmo que o valor venha de input do usuário.

### 3.5 Fail-closed: o comportamento sem contexto

Quando `app.tenant_id` não está definido, `app_current_tenant_id()` retorna
`NULL`. Como `"tenantId" = NULL` nunca é verdadeiro:

- `SELECT` → zero linhas
- `UPDATE` / `DELETE` → zero linhas afetadas
- `INSERT` → rejeitado pelo `WITH CHECK`

**Esquecer de definir o contexto resulta em nenhum dado, nunca em dados de outro
tenant.** O modo de falha é "vazio", não "vazamento". Complementarmente, o proxy
`db` em `tenant-client.ts` **lança exceção** fora de um contexto, para que o erro
apareça em desenvolvimento em vez de virar uma lista vazia misteriosa.

---

## 4. Diagrama conceitual de entidades

### 4.1 Visão macro dos domínios

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  PLATAFORMA (global, sem RLS)                                               │
│                                                                             │
│   ┌──────────┐        ┌─────────────────┐       ┌──────────────────────┐    │
│   │  User    │◄──────►│ Account         │       │ Verification         │    │
│   │          │        │ Session         │       │ (tokens de e-mail)   │    │
│   └────┬─────┘        └─────────────────┘       └──────────────────────┘    │
│        │  identidade GLOBAL: a mesma pessoa existe uma única vez            │
└────────┼────────────────────────────────────────────────────────────────────┘
         │
         │  UserTenantProfile   (vínculo pessoa ↔ instituição, COM RLS)
         │  RoleAssignment      (papéis por escopo,          COM RLS)
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TENANT (instituição)                                                       │
│                                                                             │
│   ┌──────────┐                                                              │
│   │  Tenant  │  slug, customDomain, plano, quotas                          │
│   └────┬─────┘                                                              │
│        │                                                                    │
│        ▼                                                                    │
│   ┌──────────┐   ┌──────────┐   ┌──────────────┐   ┌──────────────────┐     │
│   │  Event   │──►│  Room    │   │  Track       │   │ SponsorTier      │     │
│   │          │   └──────────┘   │ (trilhas/CFP)│   └────────┬─────────┘     │
│   │          │──►┌──────────┐   └──────┬───────┘            ▼               │
│   │          │   │ Activity │          │            ┌──────────────┐        │
│   │          │   │(palestra,│          │            │  Sponsor     │        │
│   │          │   │ minicurso│          │            └──────────────┘        │
│   │          │   │ workshop)│          │                                    │
│   │          │   └────┬─────┘          │                                    │
│   │          │──►┌──────────────┐      │                                    │
│   │          │   │ EventPage    │      │                                    │
│   │          │   │  └ PageBlock │      │                                    │
│   │          │   │ (landing     │      │                                    │
│   │          │   │  modular)    │      │                                    │
│   └────┬─────┘   └──────────────┘      │                                    │
│        │                               │                                    │
│        ├──────────►┌──────────────┐    │      ┌─────────────────────┐        │
│        │           │ Registration │    │      │ Submission          │        │
│        │           │  └ Attendance│    │      │  ├ SubmissionAuthor │        │
│        │           │  (QR Code,   │    │      │  ├ SubmissionFile   │        │
│        │           │   presença)  │    │      │  └ ReviewConflict   │        │
│        │           └──────┬───────┘    └─────►│                     │        │
│        │                  │                   └──────┬──────────────┘        │
│        │                  │                          │                       │
│        │                  │              ┌───────────┴──────────────┐        │
│        │                  │              │ ReviewAssignment         │        │
│        │                  │              │   └ Review               │        │
│        │                  │              │ (parecer, notas, rubrica)│        │
│        │                  │              └──────────────────────────┘        │
│        │                  │                                                  │
│        ▼                  ▼                                                  │
│  ┌──────────────────────────────────┐   ┌──────────────────────────────┐    │
│  │  GAMIFICAÇÃO                     │   │  CERTIFICAÇÃO                │    │
│  │  CardTemplate ──► UserCard       │   │  Certificate                 │    │
│  │  TaskDefinition ─► UserTaskProgress│  │   validationCode (QR público)│    │
│  │  UserXpProfile  (agregado)       │   │   contentHash (SHA-256)      │    │
│  │  XpTransaction  (razão append-   │   │   signature + keyId          │    │
│  │                  only, idempot.) │   │   workloadMinutes            │    │
│  └──────────────────────────────────┘   └──────────────────────────────┘    │
│                                                                             │
│   AuditLog (trilha imutável de toda operação sensível)                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Decisões de modelagem que merecem destaque

**`User` é global e NÃO tem `tenantId`.** Uma pessoa pode ser participante na
UFBA, palestrante na FIOCRUZ e revisora na USP sem duplicar cadastro. O vínculo
com cada instituição vive em `UserTenantProfile`, que é tenant-scoped. Sem isso,
o requisito de "troca dinâmica de contexto sem perda de sessão" seria
impossível — haveria N contas para a mesma pessoa.

**`RoleAssignment` tem escopo triplo.** `role` + `scope` (`TENANT` | `EVENT` |
`ACTIVITY`) + alvo opcional. Isso permite acúmulo de papéis (Palestrante **e**
Organizador no mesmo evento) e papéis granulares (coordenador de um único
minicurso), sem uma tabela por combinação. `expiresAt` cobre papéis temporários
como staff do dia.

**`tenantId` é denormalizado deliberadamente.** `Submission` tem `eventId` e
`tenantId`, embora o tenant seja derivável do evento. Isso mantém a policy de RLS
como um predicado de **uma única coluna**, barato e impossível de contornar por um
JOIN esquecido. Integridade é garantida por FK, não por normalização.

**`XpTransaction` é append-only e idempotente.** `idempotencyKey` é `UNIQUE`, o
que impede crédito duplicado (ex.: dois check-ins no mesmo QR Code, retry de job).
`UserXpProfile` é um agregado denormalizado para leitura O(1) no perfil público.

**`Certificate` guarda um snapshot imutável.** `title`, `recipientName`,
`bodyText` e `workloadBreakdown` são copiados no momento da emissão. Editar o
evento depois não pode alterar um certificado já emitido — é um documento legal.

**`Attendance` suporta múltiplos registros por atividade.** Check-in e check-out
são linhas distintas, permitindo calcular a carga horária **real** cumprida, não
apenas presença binária. `qrNonce` impede replay de QR Code.

**`SubmissionFile` guarda `checksum` SHA-256.** Detecta substituição de arquivo
após a submissão e permite deduplicação.

---

## 5. Contrato de dados

### 5.1 Classificação das tabelas

| Classe | Tabelas | RLS | Justificativa |
|---|---|---|---|
| **Tenant-scoped** (27) | `user_tenant_profiles`, `role_assignments`, `events`, `rooms`, `activities`, `activity_speakers`, `event_pages`, `page_blocks`, `sponsor_tiers`, `sponsors`, `registrations`, `attendances`, `tracks`, `submissions`, `submission_authors`, `submission_files`, `review_assignments`, `reviews`, `review_conflicts`, `card_templates`, `user_cards`, `user_xp_profiles`, `xp_transactions`, `task_definitions`, `user_task_progress`, `certificates`, `audit_logs` | ✅ `ENABLE` + `FORCE` | Possuem `tenantId NOT NULL` |
| **Global com RLS** (3) | `user`, `session`, `tenants` | ✅ policies próprias | Identidade e resolução de tenant |
| **Global sem RLS** (2) | `account`, `verification` | ❌ | Operadas só pela lib de auth, antes de existir tenant ativo |

### 5.2 Enums (25)

Domínio, status e tipos são enums PostgreSQL nativos — não strings livres. Isso
torna estados inválidos impossíveis no nível do banco.

`TenantStatus`, `TenantPlan`, `MembershipStatus`, `RoleKey`, `RoleScope`,
`EventStatus`, `EventModality`, `ActivityType`, `ActivityStatus`,
`RegistrationStatus`, `AttendanceSource`, `AttendanceStatus`, `SubmissionStatus`,
`SubmissionFileKind`, `ReviewRecommendation`, `ReviewStatus`, `ConflictType`,
`CardRarity`, `CardTrigger`, `XpSourceKind`, `TaskKind`, `TaskProgressStatus`,
`CertificateKind`, `CertificateStatus`, `SponsorTierKey`, `PageBlockType`,
`AuditAction`

### 5.3 Índices

Todo índice começa por `tenantId` quando a tabela é tenant-scoped, porque **toda
query da aplicação passa por esse predicado** (é o que a RLS impõe). Um índice
que não comece por `tenantId` seria inútil nessas tabelas.

Exemplos representativos:

```prisma
@@unique([tenantId, slug])              // Event: slug único POR instituição
@@index([tenantId, eventId, status])    // Activity
@@index([tenantId, userId, createdAt])  // XpTransaction
@@index([tenantId, totalXp])            // UserXpProfile (ranking)
@@unique([tenantId, userId, cardTemplateId, isFoil])  // UserCard
@@index([status, createdAt])            // Certificate (fila do worker)
```

Destaque: `@@unique([activityId, userId])` em `Registration` impede inscrição
duplicada **no banco**, não apenas na aplicação.

### 5.4 Convenção de nomes — atenção

O Prisma gera colunas em **camelCase entre aspas** (`"tenantId"`, `"createdAt"`),
não em snake_case, porque o schema não usa `@map`. Nomes de **tabela** estão em
snake_case via `@@map` (`user_tenant_profiles`).

Consequência prática: **SQL cru precisa citar os identificadores camelCase.**

```sql
-- ✅ correto
SELECT * FROM events WHERE "tenantId" = $1;
-- ❌ falha: column "tenant_id" does not exist
SELECT * FROM events WHERE tenant_id = $1;
```

Isso está documentado no topo de cada script SQL para evitar a confusão.

---

## 6. Estrutura criada

```text
.
├── docker-compose.yml                  # 4 serviços + perfis web/worker
├── Dockerfile                          # (FASE 2) build multi-stage standalone
├── prisma.config.ts                    # Prisma 7: URL fora do schema
├── prisma/
│   ├── schema.prisma                   # 32 tabelas, 25 enums
│   ├── migrations/20260916201435_init/ # migração inicial aplicada
│   └── scripts/
│       ├── apply-rls.mjs               # reaplica as policies (idempotente)
│       ├── assert-schema-contract.mjs  # verifica o contrato de isolamento
│       └── assert-tenant-isolation.mjs # 9 ataques cross-tenant
├── docker/
│   ├── postgres/init/
│   │   ├── 00-roles.sql                # roles admin/app + GRANTs
│   │   ├── 01-database.sql             # extensões e parâmetros
│   │   └── 02-rls-policies.sql         # policies + assertivas
│   └── minio/
│       ├── Dockerfile                  # minio-init (node + mc)
│       ├── Dockerfile.probe            # minio + mc (para o healthcheck)
│       └── provision.mjs               # 5 buckets, políticas e versionamento
├── src/lib/db/
│   ├── schema-contract.ts              # fonte de verdade das tabelas com RLS
│   ├── admin-client.ts                 # conexão admin (CLI/seed/testes)
│   └── tenant-client.ts                # withTenant() + AsyncLocalStorage
├── tests/integration/
│   └── tenant-isolation.test.ts        # 8 testes contra o banco real
└── docs/fase-01-infra-e-modelagem.md   # este documento
```

---

## 7. Evidência de verificação

### 7.1 Contrato de isolamento

```text
──────────────────────────────────────────────────────────────
  CONTRATO DE ISOLAMENTO MULTI-TENANT
──────────────────────────────────────────────────────────────
  ✓  RLS habilitada + FORCE em todas as tabelas com tenant_id
  ✓  Nenhuma tabela com RLS ficou sem policy
  ✓  Role "eventflow_app" sem superuser e sem BYPASSRLS
  ✓  GRANTs mínimos presentes, TRUNCATE ausente

  Contrato íntegro.
──────────────────────────────────────────────────────────────
```

### 7.2 Ataques cross-tenant (9/9 bloqueados)

| # | Ataque simulado | Resultado |
|---|---|---|
| A1 | Ler eventos sem contexto de tenant | ✅ 0 linhas (fail-closed) |
| A2 | Tenant A listar eventos do Tenant B | ✅ viu apenas o próprio |
| A3 | Tenant A **atualizar** evento do Tenant B | ✅ 0 linhas afetadas |
| A4 | Tenant A **apagar** evento do Tenant B | ✅ 0 linhas afetadas |
| A5 | Tenant A **inserir** linha carimbada como B | ✅ rejeitado pelo `WITH CHECK` |
| A6 | Tenant A listar vínculos de usuário de B | ✅ viu apenas o próprio |
| A7 | `COUNT(*)` agregado vazar volume de B | ✅ contou 1 de 2 existentes |
| A8 | Contexto vazar para a transação seguinte | ✅ conexão voltou limpa (prova do `SET LOCAL`) |
| A9 | Role de runtime desligar RLS / escalar privilégio | ✅ todas as tentativas rejeitadas |

Frase literal do A5, vinda do PostgreSQL:

```text
new row violates row-level security policy for table "events"
```

### 7.3 Testes da camada de dados (`npm test`)

```text
✓ rejeita acesso a dados fora de um contexto de tenant (falha ruidosa)
✓ expõe apenas os eventos do tenant informado
✓ não permite ler um evento de outro tenant nem por id explícito
✓ não permite atualizar um evento de outro tenant
✓ não permite apagar um evento de outro tenant
✓ tem acesso de escrita ao próprio tenant
✓ mantém contextos isolados em execuções concorrentes (AsyncLocalStorage)
✓ não vaza o contexto para a chamada seguinte

Test Files  1 passed (1)
     Tests  8 passed (8)
```

### 7.4 Serviços

```text
SERVICE      STATUS
minio        Up (healthy)
minio-init   Exited (0)          # provisionou 5 buckets
postgres     Up (healthy)        # PostgreSQL 18.6
redis        Up (healthy)        # Redis 8.10.1 (PONG)
```

Buckets provisionados:

```text
✓ eventflow-submissions     policy=private       versioning=on
✓ eventflow-certificates    policy=private       versioning=on
✓ eventflow-assets          policy=public-read   versioning=on
✓ eventflow-avatars         policy=private       versioning=on
✓ eventflow-temp            policy=private       versioning=on  expira=7d
```

---

## 8. ADRs — decisões de arquitetura

### ADR-001 — Shared schema com Row-Level Security

**Contexto:** escolher o modelo de isolamento multi-tenant.
**Decisão:** banco e schema compartilhados, coluna `tenantId` em toda tabela de
domínio, RLS aplicada pelo PostgreSQL.
**Justificativa:** um único pool de conexões, uma única execução de migração por
deploy, e isolação garantida no nível de dados em vez de disciplina de código.
**Consequências:** toda query de tenant precisa de uma transação com contexto
definido (custo de uma transação por unidade de trabalho). Aceito: a correção vale
mais que a micro-otimização. Índices liderados por `tenantId` mantêm o desempenho.

### ADR-002 — Identidade de usuário é global

**Contexto:** um usuário pode atuar em várias instituições com papéis distintos.
**Decisão:** `User` é global e sem `tenantId`. O vínculo vive em
`UserTenantProfile`, tenant-scoped.
**Justificativa:** evita duplicação de cadastro e torna a troca de contexto
instantânea.
**Consequências:** `user` exige policies próprias (não usa `tenantId`). Consultas
cross-tenant de pessoas são possíveis para a aplicação e devem ser restritas por
regra de negócio — por isso o acesso sem contexto é limitado a SELECT/INSERT/UPDATE
do fluxo de autenticação, nunca DELETE.

### ADR-003 — Papéis com escopo (TENANT / EVENT / ACTIVITY)

**Contexto:** acúmulo de papéis no mesmo evento e papéis granulares.
**Decisão:** uma única tabela `RoleAssignment` com `role` + `scope` + alvo opcional
e vigência (`grantedAt`/`expiresAt`).
**Justificativa:** cobre todos os casos sem explosão de tabelas e permite papéis
temporários.
**Consequências:** a checagem de permissão precisa montar a resolução de escopo;
será encapsulada em um caso de uso na FASE 2.

### ADR-004 — Duas roles de banco (admin e runtime)

**Contexto:** RLS precisa ser forte para a aplicação, mas migrações precisam ver
todo o schema.
**Decisão:** `eventflow_admin` (superuser, dona do schema, **só** para CLI/seed) e
`eventflow_app` (`NOSUPERUSER`, `NOBYPASSRLS`, usada em runtime).
**Justificativa:** migrações funcionam sem afrouxar a RLS. `FORCE ROW LEVEL
SECURITY` garante que nem o dono da tabela escape.
**Consequências:** o seed e qualquer script administrativo operam sob RLS e
precisam definir contexto de tenant explicitamente — o que é desejável, porque
falha ruidosamente se esquecerem.

### ADR-005 — Buckets privados por padrão

**Contexto:** onde armazenar submissões, certificados, avatares e assets.
**Decisão:** apenas `eventflow-assets` é público. Os demais são privados e
acessados por URL assinada de curta duração.
**Justificativa:** submissões contêm artigos não publicados (versões cegas!) e
certificados contêm dados pessoais. A validação pública de certificado **não**
expõe o objeto: consulta-se o banco pelo `validationCode` e só então gera-se uma
URL assinada, mantendo o código não indexável.
**Consequências:** o front nunca recebe URL direta de PDF; um endpoint de
assinatura será criado na FASE 4.

### ADR-006 — MinIO via Chainguard, não via imagem oficial

**Contexto:** em **23/10/2025** a MinIO **removeu** as imagens Docker da edição
comunitária do Docker Hub e do Quay, e recusou corrigir a CVE-2025-62506 nas
imagens. Todas as tags remanescentes no Quay são de **fevereiro/2022**
(confirmado por consulta direta à API do registry).
**Decisão:** usar as imagens mantidas e sem CVE da Chainguard
(`cgr.dev/chainguard/minio`), de uso gratuito, rodando a versão
**RELEASE.2026-07-17**.
**Justificativa:** manter uma imagem congelada de 2022 com vulnerabilidade
conhecida não é aceitável; construir da fonte transfere a manutenção para nós.
**Consequências:** as imagens são **distroless** — sem shell, `curl` ou `wget`.
Isso obrigou duas adaptações: (a) o healthcheck do MinIO usa uma imagem própria
com o binário `mc` copiado (`docker/minio/Dockerfile.probe`), porque o healthcheck
do Compose roda *dentro* do container; (b) o provisionamento de buckets é feito em
Node (`provision.mjs`), não em shell. Como a MinIO é AGPLv3 e o projeto é um SaaS,
a licença deve ser revisada antes de oferta comercial (ou trocar por S3/R2/Wasabi,
que o código já suporta via variáveis `S3_*`).

### ADR-007 — Prisma 7: URL fora do schema e client gerado em TypeScript

**Contexto:** o Prisma 7 introduziu mudanças que quebram receitas antigas.
**Decisão:** adotar o modelo novo integralmente.
**Mudanças relevantes confirmadas executando a ferramenta:**

1. `datasource.url` **não é mais aceito** no `schema.prisma` — a CLI lê a conexão
   de `prisma.config.ts` (`datasource.url`), e o runtime usa driver adapter.
2. `.env` **não é mais carregado automaticamente** pela CLI — é preciso
   `import 'dotenv/config'` no `prisma.config.ts`.
3. `prisma migrate diff` renomeou `--to-schema-datamodel` → `--to-schema` e passou
   a usar `-o/--output`.
4. `prisma migrate dev` **removeu** a flag `--skip-seed`.
5. O gerador `prisma-client` emite **código TypeScript** (não JS compilado) em
   `src/generated/prisma/`, com imports terminando em `.ts` e `@ts-nocheck`.
6. `prisma migrate dev` **não** regenera o client de forma confiável — por isso os
   scripts `db:migrate`/`db:migrate:deploy` encadeiam `prisma generate`.

**Consequências:** `src/generated/` está no `.gitignore` e precisa ser gerado
(`npm run db:generate`) após o install. O TypeScript deve ser **5.9.x**: a versão
7.x é recente demais para ser assumida como compatível com Next 16 + Prisma 7.

### ADR-008 — PostgreSQL 18 exige novo ponto de montagem

**Contexto:** o container recusava iniciar com o volume em `/var/lib/postgresql/data`.
**Decisão:** montar o volume em **`/var/lib/postgresql`** (diretório pai).
**Justificativa:** a partir da imagem 18 o layout usa diretórios com o número da
major version, compatível com `pg_ctlcluster`, o que permite `pg_upgrade --link`
sem cruzar fronteira de montagem. Montar em `.../data` faz o container detectar um
volume "não utilizado" e abortar.
**Ref.:** <https://github.com/docker-library/postgres/pull/1259>
**Consequências:** volumes de PostgreSQL 17 não podem ser reaproveitados
diretamente; é preciso `pg_upgrade`.

---

## 9. Como executar — passo a passo

### Pré-requisitos

- Docker Desktop (ou Docker Engine + Compose v2) **em execução**
- Node.js **≥ 24** (testado com 26.2.0)
- Windows, macOS ou Linux

### 9.1 Preparar o ambiente

```bash
# a) Copiar as variáveis de ambiente
cp .env.example .env          # macOS/Linux
Copy-Item .env.example .env   # Windows (PowerShell)

# b) Instalar as dependências
npm install
```

### 9.2 Subir a infraestrutura

```bash
docker compose up -d
```

Aguarde ~20s e confirme que os 4 serviços estão saudáveis:

```bash
docker compose ps
```

Saída esperada:

```text
SERVICE      STATUS
minio        Up (healthy)
minio-init   Exited (0)
postgres     Up (healthy)
redis        Up (healthy)
```

> **Nota:** `minio-init` sair com código 0 é o comportamento correto — ele
> provisiona os buckets e encerra.

### 9.3 Criar o schema, aplicar a RLS e verificar

```bash
# Aplica a migração inicial e regenera o client
npm run db:migrate

# Aplica as policies de Row-Level Security
npm run db:rls

# Verifica o contrato de isolamento
npm run db:verify

# Simula 9 ataques cross-tenant contra o banco real
npm run db:verify:isolation
```

Ou tudo de uma vez:

```bash
npm run db:setup
```

### 9.4 Rodar os testes

```bash
npm test                 # Vitest (8 testes de isolamento)
npm run test:coverage    # com cobertura
```

### 9.5 Inspecionar o banco e o storage

```bash
npm run db:studio        # Prisma Studio em http://localhost:5555
```

- **MinIO Console:** <http://localhost:9001> (`eventflow_minio` / `eventflow_minio_secret`)
- **PostgreSQL:** `localhost:5432` / banco `eventflow`
- **Redis:** `localhost:6379`

### 9.6 Comandos operacionais úteis

```bash
npm run infra:logs       # logs de todos os serviços
npm run infra:ps         # status dos containers
npm run infra:buckets    # reprovisiona os buckets (idempotente)
npm run db:validate      # valida o schema.prisma
npm run db:generate      # regenera o client Prisma
npm run db:migrate:status # estado das migrações

docker compose down      # para os containers (preserva dados)
npm run infra:reset      # para E APAGA os volumes (começa do zero)
```

### 9.7 Verificar a saúde dos serviços manualmente

```bash
# PostgreSQL
docker exec eventflow-postgres pg_isready -U eventflow_admin -d eventflow

# Redis
docker exec eventflow-redis redis-cli ping          # esperado: PONG

# MinIO
curl http://localhost:9000/minio/health/live        # esperado: HTTP 200

# Confirmar que a role de runtime NÃO tem BYPASSRLS
docker exec eventflow-postgres psql -U eventflow_admin -d eventflow \
  -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'eventflow_app';"
```

### 9.8 Solução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| `postgres` reiniciando em loop | Volume com layout do PG 17 | `npm run infra:reset` |
| `minio-init` com exit 1 | MinIO ainda subindo | `npm run infra:buckets` |
| `Cannot find module 'generated/prisma/client'` | Client não gerado | `npm run db:generate` |
| `Cannot resolve environment variable` | CLI não carrega `.env` | Confirme `import 'dotenv/config'` em `prisma.config.ts` |
| `column "tenant_id" does not exist` | SQL cru sem aspas | Use `"tenantId"` (camelCase) |
| `[ADIADO] As tabelas ainda nao existem` | Esperado no 1º boot | Rode `npm run db:migrate && npm run db:rls` |

---

## 10. Dívidas técnicas e trabalho adiado

**Adiado conscientemente** (não é esquecimento):

1. **`Dockerfile` da aplicação** (raiz) — criado na FASE 2, quando houver app
   Next.js para o build `standalone`. O `docker-compose.yml` já referencia os
   targets `runner` e `worker`, sob o perfil `app` (inativo por padrão), então o
   `docker compose up -d` da FASE 1 não é afetado.
2. **Seed de dados** — depende de decisões de auth da FASE 2 (hash de senha,
   formato de sessão). O contrato de dados já está fechado.
3. **Migration versionada para RLS** — hoje as policies vivem em
   `docker/postgres/init/` e são aplicadas por `npm run db:rls`. Na FASE 2 isso
   será reconciliado com `prisma migrate diff` para que `migrate deploy` cubra a
   RLS em ambientes novos.
4. **`AuditLog` sem particionamento** — a tabela cresce indefinidamente. Antes de
   produção, particionar por mês em `createdAt`.
5. **Sem `pgbouncer`** — com RLS por transação, *transaction pooling* é
   obrigatório em escala. O desenho atual (contexto por transação) já é
   compatível; a peça não foi adicionada ainda.

**Pontos de atenção para produção:**

- Trocar **todas** as senhas de `.env.example`.
- Revisar a licença AGPLv3 do MinIO ou migrar para S3/R2 (o código já abstrai via
  `S3_*`).
- O `CERTIFICATE_HMAC_SECRET` atual é de desenvolvimento; a assinatura real
  (PKCS#7/CMS) entra na FASE 6.

---

## 11. Resumo dos comandos desta fase

```bash
# ─── Ambiente ────────────────────────────────────────────────────────
cp .env.example .env
npm install

# ─── Infraestrutura ──────────────────────────────────────────────────
docker compose up -d
docker compose ps

# ─── Banco: schema + RLS + verificação ───────────────────────────────
npm run db:migrate            # migração + geração do client
npm run db:rls                # aplica as policies de RLS
npm run db:verify             # contrato de isolamento
npm run db:verify:isolation   # 9 ataques cross-tenant

# ─── Testes ──────────────────────────────────────────────────────────
npm test

# ─── Atalho: tudo acima de uma vez ───────────────────────────────────
npm run db:setup
```

---

## 12. Checklist de aceite da FASE 1

- [x] `docker compose up -d` sobe PostgreSQL 18, Redis 8, MinIO e provisiona buckets
- [x] Todos os serviços reportam `healthy` (ou `Exited (0)` para o init)
- [x] `prisma/schema.prisma` válido, com 32 tabelas, 25 enums e índices liderados por `tenantId`
- [x] Modelo cobre **todos** os domínios pedidos: Users, Tenants, Roles/Assignments, Events, Activities, Submissions, Reviews, Cards, Tasks/XP, Certificates, Sponsors
- [x] RLS habilitada **e** forçada em 27 tabelas de tenant
- [x] Role de runtime sem `SUPERUSER` e sem `BYPASSRLS` (verificado por assertiva)
- [x] Nenhuma tabela com RLS ficou sem policy (verificado por assertiva)
- [x] 9 vetores de ataque cross-tenant bloqueados contra banco real
- [x] 8 testes de integração da camada de dados passando
- [x] `tsc --noEmit` sem erros
- [x] Documentação com ADRs, contratos e comandos operacionais

**Próximo passo:** FASE 2 — base do Next.js 16 + React 19, middleware de tenancy,
autenticação e RBAC com troca dinâmica de contexto.

Aguardando **"APROVADO: AVANÇAR"**.
