# FASE 9 — Diretório público de organizações e governança global (SuperAdmin)

> **Leia junto com:** `docs/fase-02-autenticacao-rbac-tenancy.md` (RBAC e escopos),
> `docs/fase-01-infra-e-modelagem.md` (RLS e o par de roles do banco) e `AGENTS.md`.

---

## 1. Sumário executivo

A FASE 9 fecha o lado **plataforma** do produto. Até aqui, cada instituição existia
isolada: criada à mão no seed, sem painel que a governasse e sem qualquer porta de
entrada pública que não fosse o link direto para um evento. Esta fase entrega:

1. **Governança global** — um papel (`SUPERADMIN`) em um escopo novo (`PLATFORM`) que
   provisiona, mede, suspende e reativa instituições, sem ser administrador de
   nenhuma delas.
2. **Diretório público** (`/organizacoes`) — a vitrine que descobre instituições e o
   que está acontecendo agora, fora de qualquer contexto de tenant.
3. **Corte de tráfego imediato** — a suspensão vale na requisição seguinte, com
   página de bloqueio explicando o motivo.

### Entregas

| # | Entrega | Onde |
|---|---|---|
| 1 | Escopo `PLATFORM` + papel `SUPERADMIN` + permissão `platform:manage` | `src/domain/rbac/{permissions,authorization}.ts` |
| 2 | Regras puras da plataforma (slug, planos, ciclo de vida, diretório) | `src/domain/platform/platform-rules.ts` |
| 3 | Migração: `RoleAssignment.tenantId` anulável + perfil público + ciclo de vida em `Tenant` | `prisma/migrations/20260917101151_phase9_platform_governance/` |
| 4 | Leitura global (métricas, listagens, diretório, auditoria) | `src/lib/platform/global-repository.ts` |
| 5 | Serviços de governança (provisionar, suspender, reativar, perfil, SuperAdmins) | `src/lib/platform/tenant-service.ts` |
| 6 | Diretório cacheado (contagem) + leitura fresca (visibilidade) | `src/lib/platform/directory-service.ts` |
| 7 | Guarda de plataforma com resposta **404** | `src/lib/platform/guard.ts` |
| 8 | Server Actions de governança | `src/app/actions/platform-actions.ts` |
| 9 | Painel `/superadmin`, `/superadmin/metricas`, `/superadmin/tenants`, `/superadmin/tenants/[tenantId]`, `/superadmin/governanca` | `src/app/superadmin/**` |
| 10 | Diretório público e página de bloqueio | `src/app/(public)/organizacoes/page.tsx`, `src/app/instituicao-bloqueada/page.tsx` |
| 11 | Corte de tráfego no Proxy e nos layouts | `src/proxy.ts`, `(public)/layout.tsx`, `(app)/layout.tsx` |
| 12 | Testes: 48 unitários, 22 de integração, 6 E2E | `tests/**` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos criados | 14 (7 de aplicação/domínio, 6 de interface, 1 de documentação) |
| Arquivos alterados | 14 (RBAC, schema, migração, proxy, layouts, seed, testes da F2) |
| Migrações | 1 (`20260917101151_phase9_platform_governance`) |
| Permissões | 53 → **54** (`platform:manage`) |
| Papéis | 10 → **11** (`SUPERADMIN`) |
| Escopos | 3 → **4** (`PLATFORM`) |
| Testes Vitest | 675 → **745** (24 arquivos) |
| Testes E2E | 35 → **41** (9 arquivos) |
| ADRs | 49 → **59** |

---

## 2. O problema mais difícil da fase

**Uma linha de banco (`role_assignments.tenant_id IS NULL`) precisa ser invisível
para o runtime, legível para a governança e incapaz de virar acesso universal.**

A governança da plataforma não pertence a instituição nenhuma — logo, não há
`app.tenant_id` que a represente. Todas as alternativas óbvias foram descartadas:

| Alternativa | Por que não |
|---|---|
| Criar uma instituição "plataforma" e conceder o papel lá | O SuperAdmin passaria a ser membro de uma instituição de verdade; qualquer consulta sob aquele contexto devolveria dados dela, e a RLS deixaria de distinguir "dono da instituição técnica" de "governo da plataforma". |
| Fazer o papel de plataforma cobrir também `TENANT` | Qualquer SuperAdmin se tornaria administrador de **todas** as instituições (leria submissões, inscritos, certificados de terceiros). É o oposto do princípio que a fase deveria instalar. |
| Criar tabela `platform_role_assignments` | Duplicaria o modelo de autorização: duas trilhas de concessão, dois lugares para revogar, e o `can()` teria que consultar as duas. |
| Desligar a RLS para a linha | Impossível por role: a policy vale para `eventflow_app`; e desligar RLS é exatamente o que o contrato de isolamento proíbe. |

A decisão foi manter **uma única tabela de concessões**, com `tenant_id` anulável, e
apoiar-se na própria RLS para o isolamento: a policy compara `tenant_id` com o
contexto da transação, e `NULL = 'uuid'` nunca é verdadeiro. A linha de plataforma é,
portanto, **invisível para a role de runtime por construção** — não por um `if` que
alguém pode esquecer. A governança a lê pela conexão administrativa, que é o mesmo
caminho do provisionamento.

O segundo problema, e o que dá sentido ao primeiro: **o papel de plataforma não pode
ser um superpoder sobre dados de terceiros.** Um SuperAdmin provisiona, mede e
suspende. Ele não abre o painel de uma instituição, não lê uma submissão, não vê um
inscrito. Isso é garantido por `scopeCovers('PLATFORM', 'TENANT') === false` — o
escopo de plataforma não cobre o de instituição — e é testado no domínio puro.

---

## 3. Decisões técnicas

### 3.1 O escopo PLATFORM fica FORA da hierarquia

A hierarquia de escopos era `TENANT ⊃ EVENT ⊃ ACTIVITY`. `PLATFORM` foi adicionado
**acima, mas não contendo** os demais:

```
PLATFORM            (governa a plataforma; não enxerga conteúdo de instituição)
TENANT ⊃ EVENT ⊃ ACTIVITY
```

`scopeCovers(assignment, required)` trata `PLATFORM` explicitamente: um papel de
plataforma cobre pedidos de escopo `PLATFORM` e **nada mais**. A tentação de "quem
pode mais, pode menos" produziria um SuperAdmin onisciente.

### 3.2 `TENANT_PERMISSIONS` em vez de `ALL_PERMISSIONS`

`ROLE_PERMISSIONS.OWNER` era `ALL_PERMISSIONS`. Com a permissão nova, todo dono de
instituição ganharia `platform:manage` (gerenciar a plataforma) sem que ninguém
tivesse decidido isso. A correção foi explícita: `TENANT_PERMISSIONS =
ALL_PERMISSIONS.filter(p => p !== PLATFORM_MANAGE)`, e `OWNER` e `ADMIN` derivam dela.
O comentário no código registra o motivo, e o teste da FASE 2 que afirmava "OWNER tem
todas as permissões" foi **reescrito** para fixar a fronteira.

### 3.3 Duas leituras do diretório, com naturezas diferentes

| Dado | Decide | Cache |
|---|---|---|
| Quem aparece (`status = ACTIVE AND isPublic`) | acesso | **não** — consulta indexada por requisição |
| Quantos eventos abertos | apenas a ordem | sim (tag `public-tenants`, teto de 5 min) |

Se a visibilidade viesse do cache, uma suspensão demoraria até cinco minutos para
sumir da vitrine — e uma suspensão que demora a valer não é uma suspensão. A
separação custa uma consulta a mais por acesso ao diretório e elimina a única janela
em que a vitrine mostraria uma instituição bloqueada.

### 3.4 O corte de tráfego acontece no caminho, não na tela

A suspensão é imposta em três pontos, do mais externo ao mais interno:
`src/proxy.ts` (toda requisição), `(public)/layout.tsx` e `(app)/layout.tsx`
(renderização). Nenhum deles confia no anterior: o Proxy é "checagem otimista" por
definição do Next.js, e um layout pode ser renderizado em um caminho que não passou
por ele.

**E a decisão de acesso não vem de cache.** Este foi o defeito mais instrutivo da
fase. O resolvedor de tenant (`src/lib/tenancy/tenant-resolver.ts`) cacheia a
instituição por 30 s — uma otimização legítima da FASE 1, quando o cache guardava
apenas nome, tema e fuso. A FASE 9 passou a usar o mesmo objeto para decidir se o
tráfego passa, e o cache virou um problema de segurança: o Next.js empacota Proxy,
páginas e Server Actions em **bundles separados**, cada um com a própria instância do
módulo, de modo que `invalidateTenantCache()` chamado dentro de uma Server Action não
alcançava o cache do Proxy. Resultado: a instituição suspensa continuava servindo
páginas por até 30 segundos (o E2E pegou — `expected 403, received 200`).

A correção separa as duas coisas pelo custo: o cache guarda a **identidade** (nome,
tema, fuso, plano — muda raramente e não decide acesso), e o **status é relido a cada
resolução** com uma consulta por chave primária. Custa uma leitura indexada por
requisição e elimina a janela em qualquer bundle e em qualquer instância, sem
depender de invalidação. O `invalidateTenantCache` continua sendo chamado como
caminho rápido (descarta também a identidade), mas o corte **não depende dele**.

---

## 4. ADRs

### ADR-050 — Governança em um escopo próprio (`PLATFORM`), fora da hierarquia de tenant

**Contexto.** Era preciso representar autoridade sobre a plataforma sem conceder
autoridade sobre as instituições.

**Decisão.** Novo escopo `PLATFORM` e novo papel `SUPERADMIN`, com a única permissão
`platform:manage`. `scopeCovers` faz `PLATFORM` cobrir somente `PLATFORM`.

**Justificativa.** Autoridade sobre a plataforma e autoridade dentro de uma
instituição são eixos diferentes: quem suspende uma instituição não deve poder ler as
submissões dela. Fazer `PLATFORM` conter `TENANT` transformaria o papel de governança
em acesso universal — o risco exato que a fase deveria evitar.

**Consequências.** O SuperAdmin não vê nenhuma tela de instituição; para agir sobre
uma, usa o painel de plataforma. Um SuperAdmin que também administre uma instituição
precisa de duas concessões (uma de cada tipo) — o que é correto e explícito.

### ADR-051 — `role_assignments.tenant_id` anulável; a RLS é o isolamento da linha de plataforma

**Contexto.** As concessões de plataforma não têm instituição.

**Decisão.** `tenantId String?`, com `scope = PLATFORM` sempre acompanhado de
`tenantId = NULL`. Nenhuma policy nova, nenhum `WITH CHECK` especial.

**Justificativa.** A policy de isolamento compara `tenant_id` com
`current_setting('app.tenant_id')`; com `NULL` o resultado é desconhecido, nunca
verdadeiro. A role de runtime simplesmente não vê essas linhas — fail-closed, sem
código adicional. O teste de integração prova isso consultando `role_assignments`
dentro de uma transação de instituição.

**Consequências.** Toda leitura de plataforma passa pela conexão administrativa
(`adminPrisma`), o que está documentado em `admin-client.ts` e concentrado em um
único módulo (`src/lib/platform/global-repository.ts`). Auditoria de plataforma usa
`audit_logs.tenant_id = NULL` e tem o mesmo comportamento.

### ADR-052 — Operações globais pela conexão administrativa, com campos declarados

**Contexto.** Métricas consolidadas e diretório somam dados de todas as instituições.
Sob RLS, com contexto de uma instituição, o `COUNT` das outras seria **zero** — uma
resposta errada, não uma negação.

**Decisão.** `src/lib/platform/global-repository.ts` é o único módulo de aplicação que
usa `adminPrisma`; toda consulta declara os campos que devolve e nenhum deles é dado
pessoal de participante.

**Justificativa.** A alternativa (uma role de banco "leitora global" com policies de
agregação) adicionaria um terceiro papel ao contrato de banco para resolver um
problema de aplicação. Concentrar o uso administrativo em um arquivo, com o porquê no
cabeçalho, mantém o invariante "runtime nunca usa a role admin" auditável por leitura.

**Consequências.** O arquivo é o ponto a revisar em qualquer mudança de governança.
Campos novos exigem declaração explícita — `SELECT *` não é usado.

### ADR-053 — O painel de governança responde 404, nunca 403

**Contexto.** Rotas de plataforma não devem ser descobertas por quem não as usa.

**Decisão.** `requirePlatformPermission()` chama `notFound()`. Sem sessão, sem
concessão, com concessão revogada ou expirada: a resposta é a mesma página 404
pública.

**Justificativa.** Um 403 confirma a existência da rota — informação suficiente para
mapear o alvo. O 404 é indistinguível de um endereço inexistente, e o E2E verifica o
status exato.

**Consequências.** Suporte e monitoramento não distinguem "não autorizado" de "não
existe" pelos logs de acesso; a trilha de auditoria cobre o que importa (ações
efetivamente realizadas).

### ADR-054 — Suspensão exige justificativa e vale na requisição seguinte

**Contexto.** Suspender uma instituição afeta pessoas: quem trabalha nela perde o
acesso no mesmo instante.

**Decisão.** `evaluateSuspension` exige motivo com no mínimo 8 caracteres; o motivo é
gravado em `tenants.suspensionReason` e exibido na página `/instituicao-bloqueada`.
O corte é verificado no Proxy e nos dois layouts, e o resolvedor de tenant **relê o
status a cada resolução** (o cache guarda apenas a identidade da instituição). A
resposta do bloqueio é **403** com a página amigável.

**Justificativa.** O dono da instituição vai ler essa frase; "manutenção" não explica
nada e o suporte, meses depois, não consegue reconstituir a decisão. Quanto ao status
HTTP: 404 faria o dono acreditar que os dados foram apagados, e a página de bloqueio
diz explicitamente que nada foi removido. Sobre o cache: um dado que decide ACESSO
não pode depender de invalidação entre bundles/instâncias — a releitura do status
custa uma consulta por chave primária e elimina a classe inteira de erro.

**Consequências.** Uma consulta indexada a mais por requisição de tenant: é o preço da
garantia. Quando o Redis entrar em produção, o status pode voltar ao cache com
invalidação distribuída; até lá ele é sempre fresco.

### ADR-055 — Provisionamento é atômico e exige conta existente para o proprietário

**Contexto.** "Criar instituição e designar dono" precisa ser uma operação, e a
identidade (`user`) é global na plataforma (ADR-002).

**Decisão.** Uma transação cria `Tenant` + `UserTenantProfile` (ACTIVE) +
`RoleAssignment` (OWNER, escopo TENANT). Se o e-mail do proprietário não tiver conta,
a operação é **recusada com mensagem acionável** e nada é criado.

**Justificativa.** A alternativa "criar um usuário convidado com senha nula" produz um
beco sem saída: `user.email` é único e o cadastro (Better Auth) recusa e-mail já
existente — a pessoa não conseguiria entrar nem se cadastrar, e o endereço ficaria
bloqueado para sempre. Recusar com "peça o cadastro em /signup e tente de novo" é
honesto e reversível. A atomicidade é o outro lado: instituição sem dono é um órfão
que ninguém consegue administrar. A corrida por um mesmo slug é decidida pelo índice
único do banco, com rollback completo — provado por teste.

**Consequências.** O provisionamento depende de um passo prévio (cadastro do dono). O
painel explica isso no formulário e nos detalhes do erro.

### ADR-056 — O último SuperAdmin não pode ser revogado

**Contexto.** A revogação é uma operação de um clique.

**Decisão.** `revokeSuperAdmin` conta as concessões vigentes de plataforma e recusa
quando a revogação deixaria zero.

**Justificativa.** Sem a trava, um clique removeria a capacidade de governar a
plataforma, e não haveria caminho de volta pela interface — só por SQL direto no
banco. É a mesma lógica de "não remova o último proprietário" das instituições.

**Consequências.** Trocar o responsável pela governança exige conceder antes de
revogar. O teste de integração isola o cenário (o banco é compartilhado com os E2E) e
restaura as demais concessões no `finally`.

### ADR-057 — Perfil público com URL validada por allowlist

**Contexto.** Descrição, logotipo e site da instituição vão para uma página pública,
como `src` de imagem e `href` de link.

**Decisão.** Reutilizar `safeUrlSchema` (o mesmo validador do tema da landing page,
FASE 3), que aceita apenas http(s) absoluto. `javascript:`, `data:` e `ftp:` são
recusados.

**Justificativa.** Um campo de URL livre em página pública é XSS refletido com outro
nome. Reutilizar o validador existente evita duas regras de segurança que divergem
com o tempo.

**Consequências.** O formulário exige URL absoluta (não aceita caminho relativo), o
que está dito na tela.

### ADR-058 — `/superadmin` redireciona para `/superadmin/metricas`

**Contexto.** O painel precisa de um endereço memorizável e de uma sub-rota de
métricas.

**Decisão.** `/superadmin/page.tsx` é um `redirect()` para `/superadmin/metricas`.

**Justificativa.** O painel abre na pergunta de quem governa ("como está a
plataforma?"), e duplicar a tela em dois arquivos garantiria que a segunda cópia
divergisse da primeira no primeiro ajuste.

**Consequências.** Um salto extra de redirecionamento no acesso pela raiz do painel.

### ADR-059 — A contagem do diretório é cacheada por tag; a visibilidade nunca

Ver a seção 3.3. A tag `public-tenants` é publicada pelas ações de provisionamento,
mudança de estado, perfil público e publicação de evento; o teto de 5 minutos é apenas
a rede de segurança para um caminho de escrita que esqueça de invalidar.

---

## 5. Lições aprendidas — defeitos REAIS encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Teste da F2 falhou: `permissionsForRole('OWNER')` deixou de ter o tamanho de `ALL_PERMISSIONS` | Ao adicionar `platform:manage`, `OWNER = ALL_PERMISSIONS` passou a conceder governança da plataforma a **todo dono de instituição**, silenciosamente | `TENANT_PERMISSIONS` exclui a permissão de plataforma; `OWNER`/`ADMIN` derivam dela. O teste foi reescrito para fixar a fronteira |
| 2 | `can(superAdmin, 'platform:manage', { scope: 'PLATFORM' })` devolvia `false`: o SuperAdmin não autorizava nada | `assignmentCoversScope` não tinha `case 'PLATFORM'` e caía no `default: return false` — o escopo existia no tipo e na hierarquia, mas não autorizava | `case 'PLATFORM': return true` com comentário explicando que o escopo não cobre tenant |
| 3 | Teste de slug falhou: `ns` era recusado com "pelo menos 3 caracteres" | `validateTenantSlug` checava **tamanho antes** de reserva, e `ns`/`ns1` (nameservers) têm menos de 3 caracteres | Ordem invertida para **reserva → formato → tamanho**; a mensagem "reservado" é a que resolve o problema de quem digita |
| 4 | **E2E:** depois de suspender, `/t/<slug>/administracao` respondia **200** em vez de 403 (e o teste seguinte não conseguia nem autenticar: a instituição continuava ativa para o Proxy) | O cache de resolução de tenant (30 s) era invalidado dentro da Server Action, mas o Next.js empacota Proxy, páginas e ações em **bundles separados** — cada bundle tem a própria instância do módulo, então o cache do Proxy nunca era invalidado. Um teste de integração anterior já tinha exposto a metade do problema (reativação presa no cache) | `lookupTenant` passou a **reler o status** a cada resolução (consulta por chave primária) e o cache ficou só com a identidade; o `Map` foi ancorado em `globalThis` (mesmo padrão do cliente Prisma) e "não encontrado" deixou de ser cacheado, para um slug recém-provisionado não responder 404 |
| 5 | `tsc`: `revalidateTag(tag)` — "Expected 2 arguments" | No Next.js 16 `revalidateTag` exige um perfil de `cacheLife` como segundo argumento | `revalidateTag(PUBLIC_TENANTS_TAG, 'max')` + `revalidatePath` das telas afetadas |
| 6 | `tsc`: `listPlatformAudit(10)` não era aceito | A assinatura passou a receber objeto de opções (`{ limit, entityId }`) para permitir filtrar por instituição | Chamadas atualizadas; o filtro por `entityId` alimenta a trilha da tela de detalhe |
| 7 | `tsc`: `Cannot find name 'DirectoryEntry'` no serviço de diretório | O tipo era usado na interface `PublicDirectory` e foi removido junto com uma função descartada durante a refatoração do cache | Import restaurado — e a refatoração separou "quem aparece" (leitura fresca) de "quantos eventos abertos" (contagem cacheada) |
| 8 | Defeito encontrado em revisão (antes de rodar): o formulário de perfil salvaria `logoUrl`/`websiteUrl` como `null` | A projeção de `TenantAdminRow` não trazia esses campos, e a página passava `null` para o formulário — salvar a descrição apagaria o logotipo | `logoUrl`/`websiteUrl` incluídos na projeção, com comentário sobre o defeito que isso evita |

---

## 6. Evidência de verificação

Saída real da bateria completa (container reconstruído a partir do código final):

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 745 testes / 24 arquivos
npm run build                → "Compiled successfully"
npm run db:verify            → "Contrato íntegro."
npm run db:verify:isolation  → "9/9 verificações passaram."
npm run test:e2e             → 41 testes / 9 arquivos (56,8 s)
npm run db:seed              → 2 tenants, 7 cartas, 6 missões, 2 certificados, 1 sorteio apurado
```

Rotas novas do `next build` (extrato do relatório):

```text
├ ƒ /instituicao-bloqueada
├ ƒ /organizacoes
├ ƒ /superadmin
├ ƒ /superadmin/governanca
├ ƒ /superadmin/metricas
├ ƒ /superadmin/tenants
├ ƒ /superadmin/tenants/[tenantId]
```

Testes específicos da fase:

```text
tests/unit/platform-rules.test.ts                    48 testes
tests/integration/platform-governance.test.ts        22 testes
  ✓ provisionamento atômico (6)
  ✓ ciclo de vida — suspensão e reativação (5)
  ✓ perfil público (3)
  ✓ papel de plataforma e isolamento (4)
  ✓ leitura do painel (4)
tests/e2e/platform-governance.spec.ts                 6 testes
  ✓ 1. o painel de governança não existe para quem não é da plataforma (1.8s)
  ✓ 2. o SuperAdmin provisiona a instituição e designa o proprietário (1.0s)
  ✓ 3. o proprietário designado administra a instituição nova (602ms)
  ✓ 4. o visitante anônimo encontra a instituição no diretório e a abre (851ms)
  ✓ 5. a suspensão corta a vitrine e o painel imediatamente (1.2s)
  ✓ 6. a reativação devolve o acesso (1.1s)
```

Sondagem das rotas no container em execução:

```text
/organizacoes               → 200
/superadmin                 → 404  (anônimo: o painel não existe para quem não é da plataforma)
/instituicao-bloqueada      → 404  (sem ?slug: nada a bloquear)
/t/ufba-demo/eventos        → 200
```

---

## 7. Comandos operacionais

```bash
# Aplicar a migração e regenerar o cliente
npx prisma migrate deploy
npx prisma generate

# Reaplicar as policies (a migração criou colunas, não tabelas — mas o comando é
# idempotente e verifica o contrato)
npm run db:rls
npm run db:verify
npm run db:verify:isolation

# Seed com o perfil público dos tenants de demonstração
npm run db:seed

# Subir a aplicação e ver o diretório
docker compose --profile app up -d --build web
# http://localhost:3000/organizacoes

# Testes
npm run test:unit
npx vitest run tests/integration/platform-governance.test.ts
npm run test:e2e -- tests/e2e/platform-governance.spec.ts
```

### Como obter o PRIMEIRO SuperAdmin

Não existe caminho pela interface — e isso é deliberado: a primeira concessão não
pode depender de alguém que já a tenha. Crie a conta em `/signup` e conceda o papel
direto no banco (a conexão administrativa é a única que enxerga `tenant_id = NULL`):

```bash
docker compose exec postgres psql -U eventflow_admin -d eventflow -c "
INSERT INTO role_assignments (id, \"tenantId\", \"userId\", role, scope, \"grantedAt\", \"updatedAt\", reason)
SELECT gen_random_uuid(), NULL, id, 'SUPERADMIN', 'PLATFORM', now(), now(), 'Concessão inicial'
FROM \"user\" WHERE email = 'seu-email@exemplo.br';"
```

Depois disso o painel (`/superadmin/governanca`) concede e revoga os demais.

---

## 8. Dívidas técnicas e pontos de atenção

| # | Dívida | Impacto | Encaminhamento sugerido |
|---|---|---|---|
| 1 | Cache de **identidade** de tenant é por processo (30 s) | Com múltiplas instâncias, uma troca de nome/tema/plano leva até 30 s para aparecer nas outras — **não afeta o acesso**, que relê o status sempre | Invalidação distribuída por Redis pub/sub (o Redis já está na stack), quando o status voltar ao cache |
| 2 | `unstable_cache` é a API legada de cache | Migração pendente para `use cache` + `cacheLife` (`cacheComponents`) | Fase de performance/observabilidade |
| 3 | Sem e-mail transacional | O convite do proprietário é uma mensagem na tela, não um e-mail; quem provisiona precisa avisar a pessoa | Fase de notificações |
| 4 | Sem convite pela interface | Vincular mais membros a uma instituição ainda é feito no banco/seed (a F2 previa convites) | Fase de gestão de membros |
| 5 | Diretório limitado a 500 instituições por entrada de cache | Acima disso, a vitrine truncaria silenciosamente a lista (o total continuaria correto) | Paginação no banco quando o volume justificar |
| 6 | Sem edição de plano/quotas pela interface | O plano é escolhido no provisionamento; mudar depois exige SQL | Fase de billing |

---

## 9. Checklist de aceite

| Requisito | Situação |
|---|---|
| `PLATFORM` em `RoleScope` e `SUPERADMIN` em `RoleKey` | ✅ |
| Concessão de plataforma com `scope = PLATFORM` e `targetId = null` | ✅ (`tenantId = NULL`) |
| Guarda `requirePlatformPermission(PLATFORM_MANAGE)` em Server Components e Server Actions, com **404** | ✅ |
| Provisionamento atômico (instituição → dono → vínculo ACTIVE → OWNER → auditoria) | ✅ |
| Suspensão com justificativa obrigatória cortando o tráfego imediatamente | ✅ (Proxy + 2 layouts + invalidação de cache) |
| Página de bloqueio amigável, fail-closed | ✅ (`/instituicao-bloqueada`) |
| Métricas consolidadas (instituições ativas/suspensas, usuários, eventos, certificados, submissões) | ✅ |
| Diretório público em `src/app/(public)/organizacoes/page.tsx`, fora de `/t/[tenantSlug]` | ✅ |
| Leitura com `status = ACTIVE AND isPublic = true` | ✅ |
| Novos campos `isPublic`, `description`, `logoUrl`, `websiteUrl` (allowlist) | ✅ |
| Busca por nome/sigla, paginada, ordenada por volume de eventos | ✅ |
| Agregação sem N+1 | ✅ (uma consulta de instituições + uma de eventos) |
| Cards com link para o caminho e para o subdomínio | ✅ |
| Cache com `revalidateTag('public-tenants')` na mudança de instituição e na publicação de evento | ✅ |
| Unitários: slugs reservados, autorização de plataforma, agregação pública | ✅ (48) |
| Integração: provisionamento atômico + OWNER, rollback de slug duplicado, corte com SUSPENDED | ✅ (22) |
| E2E: 5 cenários (404 no painel; provisionamento; dono administra; visitante no diretório; suspensão bloqueia tudo) | ✅ (6, incluindo a reativação) |
| Documentação da fase | ✅ (este arquivo) |
| Migração SQL versionada + `schema.prisma` atualizado | ✅ |
