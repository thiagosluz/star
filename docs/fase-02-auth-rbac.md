# FASE 2 — Base Next.js 16, Multi-tenancy, Autenticação e RBAC

> **Status:** ✅ Concluída e verificada contra ambiente real (dev **e** container de produção)
> **Data:** Setembro/2026
> **Pré-requisito:** FASE 1 aprovada (infraestrutura + RLS)

---

## 1. Sumário executivo

Esta fase entrega a espinha dorsal da aplicação: **quem é o usuário**, **em qual
instituição ele está operando** e **o que ele pode fazer ali**.

| Entregável | Arquivo | Estado |
|---|---|---|
| Base Next.js 16 + React 19 | `next.config.ts`, `tsconfig.json` | ✅ build de produção OK |
| Design system (Tailwind 4) | `src/app/globals.css` | ✅ |
| Domínio: catálogo de permissões | `src/domain/rbac/permissions.ts` | ✅ 10 papéis, 50 permissões |
| Domínio: motor de autorização | `src/domain/rbac/authorization.ts` | ✅ |
| Domínio: resolução de tenant | `src/domain/tenancy/resolution.ts` | ✅ |
| Proxy (Middleware) de tenancy | `src/proxy.ts` | ✅ Node.js runtime |
| Autenticação | `src/lib/auth/auth.ts` | ✅ Better Auth 1.7.5 + Prisma 7 |
| Contexto de sessão | `src/lib/auth/session.ts` | ✅ cookie assinado (HMAC) |
| Troca de contexto | `src/app/actions/context-actions.ts` | ✅ sem perda de sessão |
| Testes unitários | `tests/unit/*.test.ts` | ✅ **68 testes** |
| Testes de integração | `tests/integration/*.test.ts` | ✅ **8 testes** |
| Testes E2E | `tests/e2e/auth-tenancy.spec.ts` | ✅ **12 testes** |
| Imagem de produção | `Dockerfile` | ✅ multi-stage, 313 MB |

**Resultado central:** o **acúmulo de papéis com escopo** e a **troca de contexto
sem perda de sessão** funcionam de ponta a ponta. Os 12 testes E2E rodam contra o
container de produção e provam, com um navegador real, que trocar de instituição
**não** recria a sessão — o cookie de sessão permanece byte a byte idêntico, só o
papel e o contexto mudam.

---

## 2. Versões verificadas

| Componente | Versão | Observação |
|---|---|---|
| Next.js | **16.3.5** | Turbopack; Proxy em runtime Node.js |
| React | **19.3.0** | React Compiler habilitado |
| Better Auth | **1.7.5** | `@better-auth/prisma-adapter` 1.7.5 |
| Tailwind CSS | **4.3.3** | configuração em CSS (`@theme inline`) |
| Zod | **4.6.5** | validação das Server Actions |
| Prisma | **7.10.0** | driver adapter `@prisma/adapter-pg` |
| TypeScript | **5.9.3** | |
| Vitest | **5.0.1** | 76 testes |
| Playwright | **1.63.0** | 12 testes E2E |
| Node.js | 26.2.0 (local) / **24-alpine** (imagem) | |

---

## 3. Arquitetura de código

Clean Architecture adaptada ao App Router. **A regra que organiza tudo: o domínio
não conhece o framework.**

```text
src/
├── domain/                       ← PURO: sem Next, sem Prisma, sem React
│   ├── rbac/
│   │   ├── permissions.ts        catálogo de permissões + mapa papel→permissões
│   │   └── authorization.ts      motor de decisão (can / requirePermission)
│   └── tenancy/
│       └── resolution.ts         host + path → identificador de instituição
│
├── lib/                          ← INFRAESTRUTURA: adaptadores concretos
│   ├── auth/
│   │   ├── auth.ts               Better Auth + adapter Prisma
│   │   ├── session.ts            contexto da requisição (usuário+tenant+papéis)
│   │   └── auth-client.ts        cliente para componentes de cliente
│   ├── db/
│   │   ├── tenant-client.ts      withTenant() → RLS por transação
│   │   ├── admin-client.ts       conexão admin (CLI/seed/auth)
│   │   └── schema-contract.ts    fonte de verdade das tabelas com RLS
│   ├── tenancy/tenant-resolver.ts  slug/domínio → Tenant (com cache)
│   └── utils/cn.ts
│
├── app/                          ← APRESENTAÇÃO: rotas, Server Actions, UI
│   ├── actions/                  casos de uso expostos ao browser
│   ├── api/                      route handlers (auth, health)
│   ├── t/[tenantSlug]/           rotas de instituição
│   └── proxy.ts                  resolução de tenant na borda  ← ver nota
│
├── components/                   ← UI reutilizável
└── workers/index.ts              ← processo de background
```

> **Nota sobre a localização do Proxy:** o Next.js 16 exige `proxy.ts` no mesmo
> nível de `app/`, ou na raiz, ou dentro de `src/`. Como usamos `src/app`,
> o arquivo vive em `src/proxy.ts`. Ele **não** é lógica de domínio — apenas lê a
> requisição, chama `resolveTenant()` do domínio e reescreve a URL.

### 3.1 Por que separar assim

O motor de autorização é a peça mais crítica do ponto de vista de segurança.
Mantê-lo puro traz três ganhos concretos:

1. **Testabilidade.** 68 testes rodam em ~10 ms, sem banco e sem servidor.
   Regra de permissão com bug é o tipo de defeito que só aparece em produção —
   aqui ele aparece no `npm test`.
2. **Impossibilidade de contorno.** Nenhuma página pode "resolver permissão do
   seu jeito"; existe uma função e ela é a única.
3. **Portabilidade.** A FASE 6 roda o mesmo domínio dentro do worker do BullMQ,
   fora do Next.js, sem alteração. O worker já comprova isso: importa
   `@/lib/db/tenant-client` e inicializa normalmente.

---

## 4. O modelo de permissões

### 4.1 Formato

Toda permissão é uma string tipada `recurso:ação[:escopo]`:

```text
event:create            ação global
registration:checkin    ação global
submission:read:any     qualquer submissão dentro do escopo do papel
submission:read:own     apenas as submissões do próprio usuário
review:submit:own       apenas os próprios pareceres
```

O sufixo `:own` **não é decorativo**. Ele obriga a checagem a receber a posse do
recurso; sem essa informação, `can()` retorna `false` (fail-closed):

```ts
// REVIEWER recebe `review:read:own`, nunca `:any`.
// Sem `ownership`, a decisão é negada — não há como "esquecer" a checagem.
can(principal, PERMISSIONS.REVIEW_READ_OWN, scope)                    // false
can(principal, PERMISSIONS.REVIEW_READ_OWN, scope, { ownerId: outro }) // false
can(principal, PERMISSIONS.REVIEW_READ_OWN, scope, { ownerId: eu })    // true
```

### 4.2 Os 10 papéis

| Papel | Essência | Destaque |
|---|---|---|
| `OWNER` | Todas as permissões | Único com `tenant:delete` |
| `ADMIN` | OWNER **sem** os poderes destrutivos/financeiros | `tenant:delete`, `tenant:billing:manage` e `tenant:role:assign` removidos |
| `ORGANIZER` | Operação do evento | Eventos, atividades, inscrições, check-in, certificados, patrocinadores |
| `CHAIR` | Coordenação científica | Decide submissões e atribui revisores; **não** opera o evento |
| `REVIEWER` | Emissão de pareceres | Só lê `submission:read:reviewable` — nunca a base inteira |
| `SPEAKER` | Apresentação | Gerencia o próprio material |
| `STAFF` | Credenciamento | Check-in/check-out e presença |
| `FINANCE` | Comercial | Patrocínios e relatórios |
| `PARTICIPANT` | Base | Inscrição, submissão própria, próprios certificados |

`ADMIN` é derivado do catálogo (`ALL_PERMISSIONS.filter(...)`) em vez de ser uma
lista escrita à mão. Assim, uma permissão nova adicionada ao catálogo entra
automaticamente no `OWNER` e no `ADMIN` — sem risco de esquecimento.

### 4.3 Escopos e acúmulo

```text
TENANT (3)  ⊃  EVENT (2)  ⊃  ACTIVITY (1)
```

Um papel concedido em escopo mais amplo vale nos mais estreitos. O contrário
**nunca** vale: ser `ORGANIZER` no evento A não dá poder nenhum no evento B nem
no tenant.

O acúmulo é livre: `assignments` é uma lista, e o usuário recebe a **união** das
permissões de todos os papéis vigentes. Um usuário pode ser, ao mesmo tempo:

```text
ORGANIZER  @ evento "Congresso 2026"
REVIEWER   @ evento "Congresso 2026"     ← mesmo alvo, papéis diferentes
STAFF      @ evento "Congresso 2026"  expira em 31 dias
ADMIN      @ tenant
```

`can()` percorre todas as concessões e libera se **qualquer** uma autorizar — o
que é exatamente o comportamento desejado para acúmulo.

### 4.4 Vigência e fail-closed

Três condições independentes podem negar acesso, e todas são testadas:

- **Vínculo não-`ACTIVE`** → `INVITED`, `SUSPENDED` e `REMOVED` não autorizam
  nada. Um convite não aceito **não** é acesso.
- **Concessão revogada** (`revokedAt`) → ignorada.
- **Concessão expirada** (`expiresAt`) → ignorada.

---

## 5. Multi-tenancy: três estratégias de resolução

O `proxy.ts` roda no **runtime Node.js** (padrão no Next.js 16) e por isso fala
com o Prisma diretamente — sem hop HTTP nem cache distribuído só para resolver
tenant.

### 5.1 Ordem de precedência

| # | Estratégia | Exemplo | Observação |
|---|---|---|---|
| 1 | **Header** `x-ef-tenant` | `localhost:3000` + header | Só em host raiz. Usado por E2E e dev sem DNS wildcard |
| 2 | **Path** `/t/<slug>` | `localhost:3000/t/ufba/dashboard` | Já é a URL canônica |
| 3 | **Domínio customizado** | `eventos.ufba.br` | Busca por `customDomain` |
| 4 | **Subdomínio** | `ufba.eventflow.app` | Busca por `slug` |

**O header de override é deliberadamente restrito ao host raiz.** Um tenant não
pode forjar contexto dentro do próprio domínio — isso está coberto por teste:

```ts
// Host de tenant + header apontando para outro tenant → o header é IGNORADO.
resolveTenant({ host: 'ufba.lvh.me', forcedTenantHeader: 'uneb' })
// → { source: 'subdomain', identifier: 'ufba' }
```

### 5.2 Slugs reservados

`www`, `api`, `admin`, `login`, `app`, `dashboard`, `t`, `_next`… não podem virar
nome de instituição, senão colidiriam com rotas do sistema. A lista está em
`RESERVED_SLUGS` e há teste iterando por **todos** os itens.

### 5.3 O que o Proxy NÃO faz

**O Proxy não autoriza.** A documentação do Next.js é explícita: Proxy serve para
verificações *otimistas*, não como solução de autorização. Ele apenas:

- descobre a instituição;
- reescreve a URL para `/t/<slug>` quando ela vem do host;
- injeta headers (`x-ef-tenant-id`, `x-ef-tenant-slug`, `x-ef-tenant-source`);
- responde 404 em rotas de instituição quando não há instituição no host.

A autorização real vive em `src/app/t/[tenantSlug]/layout.tsx` e nas Server
Actions, **perto do dado** — que é a prática recomendada (Data Access Layer).

### 5.4 Cache de resolução

`lookupTenant` mantém um `Map` com TTL de 30 s e limite de 500 entradas. Sem ele,
**cada** visita a uma landing page pública geraria um `SELECT` em `tenants`.
Resultados de erro **não** são cacheados (falha de conexão não pode ficar presa).
É um único módulo a trocar quando houver Redis em produção.

---

## 6. Autenticação

### 6.1 Better Auth sobre Prisma 7

```ts
database: prismaAdapter(adminPrisma, { provider: 'postgresql' }),
emailAndPassword: { enabled: true, minPasswordLength: 10 },
session: { expiresIn: 7 dias, cookieCache: { maxAge: 5 min } },
advanced: { database: { generateId: 'uuid', joins: true } },
plugins: [nextCookies()],
```

**Por que a conexão admin.** O login acontece *antes* de existir tenant ativo —
não há `app.tenant_id` para definir. Aplicar RLS aqui seria um impasse. Isso é
seguro porque as tabelas que a biblioteca toca (`user`, `account`, `session`,
`verification`) são **globais por arquitetura** (ADR-002) e não contêm dado de
instituição. O isolamento nas 27 tabelas de domínio continua intacto.

**`generateId: 'uuid'` é obrigatório neste projeto.** O padrão do Better Auth são
nanoids (`"bgi3nD9cwZyjM15p4jxksCCuVvXK1RQG"`); nossas colunas são `@db.Uuid`, e
o PostgreSQL rejeitava com `invalid input syntax for type uuid`, fazendo o
cadastro falhar com **422**. Descoberto durante a execução dos testes E2E.

### 6.2 Tabela `session` — decisão de projeto

O **tenant ativo não é gravado na sessão.** Existe apenas `lastTenantId`, para
telemetria. Motivo (ADR-009): o contexto precisa ser revalidado contra os
vínculos reais a cada requisição. Guardá-lo no banco criaria uma janela em que um
usuário removido da instituição continuaria operando com o contexto antigo.

---

## 7. Troca de contexto sem perda de sessão

### 7.1 O mecanismo

O contexto ativo vive em um **cookie assinado** (`ef_tenant`), com HMAC-SHA256
usando `BETTER_AUTH_SECRET`. Trocar de instituição é **reescrever um cookie**:

```text
   Trocar de contexto                    NÃO é:
   ────────────────────                  ────────
   • sobrescreve ef_tenant               • novo login
   • sessão intacta                      • novo token
   • 1 redirect                          • recriação de sessão
   • nenhuma escrita no banco            • logout
   • O(1)
```

### 7.2 Defesa em profundidade

Duas camadas **independentes** protegem o contexto:

1. **Assinatura HMAC.** Um cookie adulterado não passa por
   `parseActiveTenant()` e é tratado como ausente.
2. **Revalidação de vínculo.** Mesmo que alguém forjasse a assinatura, a troca
   revalida no banco que o vínculo existe **e** está `ACTIVE`. E o
   `getRequestContext()` revalida de novo a cada requisição.

O E2E prova a camada 1: com o cookie reescrito para outra instituição, o usuário
continua na instituição original — o nome da outra **não aparece em lugar algum**.

### 7.3 Assimetria importante no redirecionamento

Este é o bug mais sutil encontrado nesta fase, e vale registrar porque é fácil de
reintroduzir:

```ts
// ❌ ERRADO — redirecionar para um caminho "cru"
redirect('/dashboard');
```

`/dashboard` no domínio raiz é uma rota **exclusiva de instituição**; o Proxy
responde **404** quando não há instituição no host. Pior: o Next resolve
redirecionamentos relativos contra o **host atual**, então, vindo de um
subdomínio, o usuário cairia no painel da instituição **errada**.

```ts
// ✅ CORRETO — ancorar no caminho canônico do NOVO contexto
redirect(tenantPath(target.tenantSlug, innerPath));
```

Isso funciona nos dois modos (path e subdomínio). O teste E2E "troca entre duas
instituições" falhava exatamente por isso, e foi o que revelou o defeito.

---

## 8. Evidência de verificação

### 8.1 Testes automatizados

```text
tests/unit/rbac-authorization.test.ts    41 testes   ✓
tests/unit/tenant-resolution.test.ts     27 testes   ✓
tests/integration/tenant-isolation.test.ts 8 testes  ✓
                                                ─────────
                                       Total: 76 testes
```

### 8.2 Testes E2E — contra o container de PRODUÇÃO

```text
✓ autenticação › página inicial oferece entrada e cadastro
✓ autenticação › cadastro cria conta e leva ao seletor de instituição
✓ autenticação › senha curta é rejeitada pela validação do cliente
✓ autenticação › login com credenciais inválidas mostra erro sem revelar detalhes
✓ acesso a instituições › rota de instituição exige autenticação
✓ acesso a instituições › instituição inexistente responde 404
✓ acesso a instituições › rota de instituição no domínio raiz sem contexto responde 404
✓ troca de contexto › troca entre duas instituições mantendo a sessão e mudando os papéis
✓ troca de contexto › papéis com escopo de evento aparecem com seu alvo no painel
✓ isolamento › usuário sem vínculo é redirecionado ao seletor, não recebe acesso
✓ isolamento › cookie de contexto adulterado é rejeitado (assinatura HMAC)
✓ isolamento › convite pendente não concede contexto operacional (fail-closed)

12 passed (16.1s)
```

O teste central afirma, literalmente, que o cookie de sessão **não muda**:

```ts
const sessionBefore = cookiesBefore.find(c => c.name.includes('session_token'));
// ... troca de instituição pelo menu ...
const sessionAfter = cookiesAfter.find(c => c.name.includes('session_token'));

expect(sessionAfter?.value).toBe(sessionBefore?.value);   // ← mesmo byte a byte
```

### 8.3 Garantias da FASE 1 preservadas

```text
CONTRATO DE ISOLAMENTO MULTI-TENANT
  ✓  RLS habilitada + FORCE em todas as tabelas com tenantId
  ✓  Nenhuma tabela com RLS ficou sem policy
  ✓  Role "eventflow_app" sem superuser e sem BYPASSRLS
  ✓  GRANTs mínimos presentes, TRUNCATE ausente
  Contrato íntegro.

ISOLAMENTO MULTI-TENANT — PROVA CONTRA O BANCO REAL
  9/9 verificações passaram.
```

### 8.4 Stack completa em containers

```text
SERVICE    STATUS
minio      Up (healthy)
postgres   Up (healthy)      # PostgreSQL 18.6
redis      Up (healthy)      # Redis 8.10.1
web        Up (healthy)      # Next.js 16 standalone — imagem de 313 MB
worker     Up                # Redis ✓ PostgreSQL ✓
```

---

## 9. Comandos operacionais

### 9.1 Primeira execução

```bash
cp .env.example .env
npm install
docker compose up -d            # infraestrutura
npm run db:setup                # migrate + rls + verify + isolation + seed
npm run dev                     # http://localhost:3000
```

### 9.2 Contas de demonstração (criadas pelo seed)

| Conta | Contexto |
|---|---|
| `ana@example.test` | **ADMIN** em `ufba-demo` · **CHAIR + PARTICIPANT** em `fiocruz-demo` |
| `bruno@example.test` | **ORGANIZER + REVIEWER + STAFF** no evento de `ufba-demo` |
| `carla@example.test` | **PARTICIPANT** em `ufba-demo` com **convite PENDENTE** (não utilizável) |

O seed não define senha — essas contas existem para exercitar RBAC e tenancy.
Para testar o fluxo de autenticação, crie uma conta pela interface (`/signup`).

### 9.3 Acessar as instituições

```text
Por path (funciona sempre):
  http://localhost:3000/t/ufba-demo
  http://localhost:3000/t/fiocruz-demo

Por subdomínio (requer ROOT_DOMAIN=lvh.me):
  http://ufba-demo.lvh.me:3000
  http://fiocruz-demo.lvh.me:3000
```

### 9.4 Testes

```bash
npm test                        # Vitest: 76 testes (unit + integração)
npm run test:e2e                # Playwright: 12 testes E2E
npm run test:e2e:ui             # modo interativo
npm run typecheck               # tsc --noEmit
npm run build                   # build de produção
```

### 9.5 Stack completa em containers

```bash
docker compose --profile app up -d --build
docker compose --profile app ps
docker compose logs -f web worker
```

### 9.6 Atalho de verificação integral

```bash
npm run db:setup && npm test && npm run test:e2e
```

---

## 10. ADRs — decisões desta fase

### ADR-009 — Contexto ativo em cookie assinado, não na sessão

**Contexto:** onde guardar "em qual instituição o usuário está".
**Decisão:** cookie `ef_tenant` assinado com HMAC + revalidação de vínculo por
requisição.
**Justificativa:** (a) segurança — o contexto é revalidado sempre, então remover
um usuário tem efeito imediato; (b) desempenho — trocar de contexto é O(1), sem
escrita no banco nem recriação de sessão.
**Consequências:** a assinatura exige `BETTER_AUTH_SECRET` presente; o cookie é
`httpOnly` + `SameSite=Lax` e `Secure` em produção.

### ADR-010 — Permissões declarativas com sufixo de posse

**Contexto:** como expressar "revisor vê apenas o que lhe foi atribuído".
**Decisão:** permissões no formato `recurso:ação:escopo`, com `:own` exigindo
posse explícita do recurso; sem ela, a decisão é negada.
**Justificativa:** transforma um requisito de negócio sutil em uma checagem de
tipo, impossível de esquecer silenciosamente.
**Consequências:** toda chamada `can()` para permissões `:own` precisa fornecer
`ownerId`. É mais verboso e é intencional.

### ADR-011 — Proxy no runtime Node.js

**Contexto:** o Middleware do Edge não pode usar Prisma nem drivers TCP.
**Decisão:** adotar `proxy.ts` (novo nome no Next.js 16) no runtime Node.js.
**Justificativa:** permite resolver o tenant com uma consulta real ao banco, sem
hop HTTP interno nem cache distribuído só para isso.
**Consequências:** o Proxy não pode rodar em Edge Runtime. Como o deploy é
Node.js/Docker (não Edge), isso não é limitação. Se um dia for necessário deploy
em Edge, a resolução precisa migrar para fetch de uma API interna.

### ADR-012 — Autorização na camada de dados, não no Proxy

**Contexto:** onde aplicar a checagem de permissão.
**Decisão:** o Proxy só resolve tenant; autorização vive no layout da instituição
e nas Server Actions.
**Justificativa:** segue a recomendação explícita da documentação do Next.js. O
Proxy é uma verificação otimista de UX; tratar como fronteira de segurança é uma
vulnerabilidade conhecida.
**Consequências:** cada página/ação protegida repete a checagem. É proposital:
defesa em profundidade. O cabeçalho filtra links apenas por UX, e há comentário
no código deixando isso explícito para não induzir a erro.

### ADR-013 — Better Auth usa a conexão admin

**Contexto:** o login ocorre antes de existir contexto de tenant.
**Decisão:** a biblioteca usa `eventflow_admin`.
**Justificativa:** as tabelas de identidade são globais (ADR-002) e não carregam
dado de instituição; aplicar RLS ali quebraria o login sem ganho de segurança.
**Consequências:** qualquer código de **domínio** que use o cliente admin é bug.
O cabeçalho de `admin-client.ts` diz isso em maiúsculas.

---

## 11. Dívidas técnicas e trabalho adiado

**Adiado conscientemente:**

1. **Fila real no worker.** O processo existe, valida dependências e encerra com
   graciosidade, mas ainda não registra consumidores — as filas chegam nas FASES
   5 e 6.
2. **Verificação de e-mail.** `requireEmailVerification: false` porque não há
   provedor de e-mail configurado. A tabela `verification` já suporta o fluxo.
3. **Login social (Google, ORCID).** A tabela `account` já é multi-provedor; o
   catálogo pronto para uso fica para quando houver credenciais.
4. **Rate limiting distribuído.** Hoje usamos o limitador em memória do Better
   Auth. Em múltiplas instâncias é preciso mover para Redis (já disponível).
5. **Convivência de RLS com PgBouncer.** O contexto por transação já é
   compatível com *transaction pooling*; a peça não foi adicionada ainda.
6. **Design system completo.** Só o essencial foi implementado (tokens Tailwind +
   componentes de auth/tenancy). A biblioteca Shadcn/UI completa e os componentes
   de charts entram na FASE 7.
7. **Testes de acessibilidade.** Não incluídos. Recomendado adicionar
   `@axe-core/playwright` na suíte E2E antes da FASE 7.

**Pontos de atenção:**

- `BETTER_AUTH_SECRET` de desenvolvimento está no `.env.example`. Gere um novo
  com `openssl rand -base64 48` antes de qualquer ambiente compartilhado.
- O cookie de contexto tem validade de 30 dias; ajuste conforme a política de
  sessão desejada.

---

## 12. Lições aprendidas (defeitos reais encontrados nesta fase)

Registrado porque cada um custou tempo de depuração e pode voltar:

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Cadastro retorna **422** | Better Auth gerava nanoid; colunas são `@db.Uuid` | `advanced.database.generateId: 'uuid'` |
| 2 | Better Auth loga *"Prisma schema mismatch"* | Faltava `verification.updatedAt` | Campo adicionado + migração |
| 3 | `/t/<slug>` responde **404** | Havia `layout.tsx` mas nenhum `page.tsx` | Criado `page.tsx` que redireciona ao painel |
| 4 | Troca de contexto cai em **404** | `redirect('/dashboard')` perdia o prefixo do tenant | `redirect(tenantPath(slug, destino))` |
| 5 | Build falha: *"Failed to resolve babel-plugin-react-compiler"* | `reactCompiler: true` exige a dependência | Instalado |
| 6 | Build falha: *"Unrecognized key: eslint"* | Next.js 16 removeu a chave do `next.config.ts` | Removida (lint roda separado) |
| 7 | `prisma migrate dev` não regenera o client | Comportamento do Prisma 7 | `db:migrate` encadeia `prisma generate` |
| 8 | `Cannot find module '@/domain/...'` nos testes | O module runner do Vitest não usa os aliases do Vite | Testes usam caminho relativo (documentado) |
| 9 | `Cannot find module '.../generated/prisma/client'` | Import do client externado pelo Vitest | Alias nativo `#db/prisma-client` no `package.json` |

Os itens 3 e 4 são **bugs reais de aplicação**, encontrados só porque os testes
E2E rodam um navegador de verdade. Testes unitários jamais os pegariam.

---

## 13. Checklist de aceite da FASE 2

- [x] Next.js 16 + React 19 com App Router, Server Components e Server Actions
- [x] Estrutura de pastas em camadas (domínio / infraestrutura / apresentação)
- [x] Domínio isolado do framework (testável sem Next, sem Prisma, sem React)
- [x] Proxy de tenancy resolvendo **subdomínio**, **path** e **domínio customizado**
- [x] Header de override restrito ao domínio raiz (não forjável por tenant)
- [x] Slugs reservados protegidos, com teste iterando pela lista completa
- [x] Autenticação funcional (cadastro, login, logout) com Better Auth + Prisma 7
- [x] RBAC com **10 papéis** e **50 permissões** declarativas
- [x] Permissões `:own` exigindo posse explícita (fail-closed sem ela)
- [x] Papéis com escopo `TENANT` / `EVENT` / `ACTIVITY` e hierarquia de cobertura
- [x] **Acúmulo de papéis** no mesmo alvo, com teste dedicado
- [x] **Troca de contexto sem perda de sessão** (cookie de sessão idêntico — provado)
- [x] Defesa em profundidade: assinatura HMAC + revalidação de vínculo
- [x] Convite pendente não concede contexto (fail-closed), com teste E2E
- [x] Cookie de contexto adulterado rejeitado, com teste E2E
- [x] RLS da FASE 1 preservada (contrato íntegro, 9/9 ataques bloqueados)
- [x] **76 testes** unitários e de integração passando
- [x] **12 testes E2E** passando **contra o container de produção**
- [x] `tsc --noEmit` sem erros
- [x] `next build` sem erros
- [x] Imagem Docker multi-stage com usuário não-root (313 MB)
- [x] Worker de background com shutdown gracioso e validação de dependências
- [x] Documentação com ADRs, contratos, lições aprendidas e comandos

**Próximo passo:** FASE 3 — domínio de Eventos, Atividades e Inscrições, com
renderização das landing pages públicas personalizadas via Server Components,
testes unitários das regras de lotação e E2E da jornada de inscrição.

Aguardando **"APROVADO: AVANÇAR"**.
