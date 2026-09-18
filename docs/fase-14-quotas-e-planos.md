# FASE 14 — Quotas e planos

> **Itens quitados:** C1 (aplicar `maxMembers`), C3 (edição de plano e quotas pela UI),
> I4 (distinguir participante de membro).
> Vêm do levantamento consolidado em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md).
>
> **Nota de numeração:** o levantamento chamava este conjunto de "**F15 — Quotas e
> planos**" (o rótulo ficou defasado quando a operação e segurança virou FASE 13). O
> que foi aprovado com essa etiqueta está entregue aqui como **FASE 14**, e o
> levantamento passou a numerar os candidatos com o número da fase que será entregue
> — para que a etiqueta e a fase não voltem a divergir.

---

## 1. Sumário executivo

### 1.1 Entregas

| # | Entrega | Onde | Estado |
|---|---|---|---|
| I4 | Natureza do vínculo como **dado** (`MembershipKind`: `MEMBER` / `PARTICIPANT`), com backfill dos dados existentes | `prisma/schema.prisma` · `prisma/migrations/20260917210000_membership_kind/` | ✅ |
| I4 | Regras puras do vínculo (contagem na quota, não-rebaixamento, classificação por papel) | `src/domain/tenancy/membership-rules.ts` | ✅ |
| I4 | Inscrição pública cria `PARTICIPANT` e **nunca** rebaixa quem é da equipe | `src/lib/events/registration-service.ts` | ✅ |
| I4 | Contadores e listas separados: equipe × público, no painel de plataforma e na instituição | `src/lib/platform/global-repository.ts` · `src/lib/admin/member-service.ts` | ✅ |
| I4 | Tela **Equipe e participantes** na instituição (leitura sob RLS, quota visível) | `src/app/t/[tenantSlug]/(app)/administracao/equipe/page.tsx` | ✅ |
| C1 | Quota de membros no domínio (`evaluateMemberQuota`) e uso da quota para exibição | `src/domain/platform/platform-rules.ts` | ✅ |
| C1 | **Caminho de escrita real** de vínculo de equipe, com a quota aplicada, auditoria e idempotência | `src/lib/platform/tenant-service.ts` (`addTenantMember`) | ✅ |
| C3 | Provisionamento grava as **três** quotas do plano (o armazenamento estava de fora) | `src/lib/platform/tenant-service.ts` · `planQuotas` | ✅ |
| C3 | Troca de plano e edição de quotas, com avisos de redução abaixo do uso | `updateTenantPlan` · `TenantPlanForm` · `updateTenantPlanAction` | ✅ |
| C3 | Formulário de vínculo de membro no painel de governança | `TenantMemberForm` · `addTenantMemberAction` | ✅ |
| — | Seed de contas de teste usando a MESMA regra de classificação da migração | `prisma/seed-dev-users.ts` | ✅ |
| — | Testes novos (unit + integração + E2E) | `tests/unit/plan-quota-rules.test.ts` · `tests/integration/tenant-quota.test.ts` · `tests/e2e/tenant-plan.spec.ts` | ✅ |

### 1.2 Números da fase

| Métrica | Antes | Depois |
|---|---|---|
| Testes (Vitest: unit + integração) | 832 | **870** (+38: 23 unitários + 15 de integração) |
| Testes E2E (Playwright) | 47 | **51** (+4) |
| Migrações | 12 | **13** (+1: `membership_kind`) |
| ADRs | 79 | **84** (ADR-080 a ADR-084) |
| Permissões | 54 | 54 (nenhuma nova — a guarda da tela de equipe reusa `tenant:member:invite`) |
| Arquivos novos | — | 7 (1 de domínio, 1 de serviço, 1 tela, 1 migração, 3 de teste) |

---

## 2. O problema mais difícil da fase

**Aplicar uma quota que não tinha onde ser aplicada — e descobrir por que ela não
podia ser contada.**

O item C1 dizia "nenhum caminho conta vínculos nem recusa". Investigando, a
dificuldade não era contar: era que **contar vínculos era a coisa errada a fazer**.

Desde a FASE 10, quem se inscreve em evento aberto ganha um vínculo ATIVO com a
instituição — decisão correta, que dá acesso de participante sem trabalho manual. Mas
esse vínculo era o MESMO tipo de vínculo do membro da equipe. Consequências medidas no
banco de desenvolvimento: uma instituição de demonstração com 4 pessoas na equipe
aparecia com 22 "membros", porque 18 inscritos de eventos de teste estavam contados
como equipe.

Aplicar `maxMembers` sobre essa contagem seria pior que não aplicar: um evento de 300
pessoas estouraria o plano gratuito (100 membros) **sozinho**, e a plataforma estaria
cobrando por público em vez de por acesso. Ou seja: os dois itens do levantamento
(C1 e I4) não eram dois trabalhos — eram um, e a ordem importava. Primeiro a natureza
do vínculo vira dado; depois a quota passa a ter um número honesto para comparar; e
só então faz sentido existir um caminho que a aplique.

O segundo problema, prático: **a quota precisa de um caminho de escrita que um humano
use**. Vincular alguém era SQL ou seed, então não havia o que recusar. Era preciso
entregar a operação de vincular — e decidir onde ela mora. A decisão (ADR-082) foi
mantê-la no painel de plataforma, e não na instituição, porque "procurar uma pessoa
pelo e-mail" é varredura da base global de identidade: a plataforma já faz isso no
provisionamento, com auditoria; um administrador de instituição fazendo o mesmo teria
um verificador de existência de contas alheias. O convite *pela* instituição — com
prova de posse do endereço — é o desenho da fase de Comunicação.

---

## 3. Decisões técnicas

### 3.1 A natureza do vínculo é dado, não dedução

Poderia ser derivada ("membro é quem tem papel vigente"), o que dispensaria migração.
Foi descartado por dois motivos: (a) convite aceito cujo papel ainda não foi concedido
é equipe — e a dedução o esconderia justamente de quem precisa terminar de
configurá-lo; (b) `kind` é indexável, e a contagem de quota roda em toda tentativa de
vínculo. A coluna tem `MEMBER` como default, então convite, provisionamento e seed
continuaram corretos sem mudança, e só a inscrição pública grava `PARTICIPANT`
explicitamente.

O backfill dos dados existentes usa o único vestígio disponível: **vínculo cujo único
papel vigente é `PARTICIPANT` nasceu de inscrição pública**. A regra está em código
testado (`classifyMembershipKind`) e o SQL da migração é a expressão dela — não uma
segunda definição. O seed de contas de teste passou a chamar a mesma função.

### 3.2 Dois caminhos, duas regras — e a assimetria é explícita

| Caminho | Efeito sobre `kind` |
|---|---|
| Inscrição pública | cria `PARTICIPANT`; **nunca** rebaixa nem promove |
| Vínculo de equipe (plataforma) | sempre `MEMBER`; **promove** quem era participante |

`kindAfterPublicRegistration` existe para que a ordem dos acontecimentos não mude o
resultado: quem se inscreve antes de entrar para a equipe é participante e é promovido
depois; quem já é da equipe e se inscreve continua membro, e continua contando na
quota. As duas situações têm teste.

### 3.3 Quotas: `null` é ilimitado, `0` é nenhum, vazio é "não mexi"

A mesma semântica já usada em `Event.capacity`, agora explícita no formulário de plano:
com "usar as quotas do plano" marcado, os campos são ignorados e as quotas do plano são
aplicadas; desmarcado, o número informado vale (e `0` significa zero). A quota de
**membros tem mínimo 1** — o provisionamento designa um proprietário na mesma
transação, então `maxMembers = 0` seria um plano em que a instituição já nasce fora do
próprio plano. Zero **evento**, por outro lado, é legítimo.

### 3.4 Reduzir quota abaixo do uso é permitido — com aviso

Recusar prenderia a plataforma entre "não posso reduzir" e "apague dados do cliente
para reduzir". A redução passa a valer para o que é NOVO (o acesso ao que já existe não
é revogado por mudança de plano), e o serviço devolve `warnings` descrevendo exatamente
o que ficou bloqueado. O aviso vai no `details` de uma resposta `ok` — não é erro, é
efeito colateral que o operador precisa ler.

### 3.5 Uma fonte para as quotas do plano

`planQuotas(plan)` é usada pelo provisionamento, pela troca de plano e pelas dicas da
tela. Existe porque o provisionamento gravava `maxEvents` e `maxMembers` do plano e
deixava `maxStorageBytes` no default do schema: uma instituição PROFESSIONAL nascia com
5 GiB — quota de plano gratuito — e a tela mostrava isso como se fosse o contratado.

---

## 4. ADRs

### ADR-080 — `MembershipKind`: equipe e público são vínculos diferentes

**Contexto.** A FASE 10 passou a criar vínculo ATIVO para quem se inscreve em evento
aberto. O vínculo de participante e o de equipe eram indistinguíveis, o que encheu a
lista de "quem responde pela instituição" com inscritos anônimos e tornou a quota
`maxMembers` impossível de contar.

**Decisão.** Coluna `kind` (`MEMBER` | `PARTICIPANT`) com default `MEMBER`; inscrição
pública grava `PARTICIPANT`; backfill classifica como participante o vínculo cujo único
papel vigente é `PARTICIPANT`.

**Justificativa.** Alternativa descartada: derivar de "tem papel vigente?". Ela erraria
o convite pendente de papel e não é indexável. Alternativa descartada: tabela separada
para participantes — duplicaria o modelo de vínculo e a RLS de `user_tenant_profiles`,
que já é a fronteira correta.

**Consequências.** (+) A quota tem um número honesto para comparar; listas e contadores
separam equipe de público. (+) Uma promoção (participante → equipe) é uma linha
alterada, com trilha. (−) Duas naturezas no mesmo modelo: toda consulta nova que liste
vínculos precisa dizer qual delas quer (o default do banco é `MEMBER`, então o
esquecimento erra para o lado restritivo). (−) O backfill é uma **aproximação** do
dado histórico, documentada em código e no SQL.

### ADR-081 — A quota de membros conta equipe, não público

**Contexto.** `maxMembers` era gravado, herdado do plano e exibido — e nunca
consultado. Se fosse aplicado sobre "vínculos", um evento de 300 pessoas derrubaria o
plano gratuito sozinho.

**Decisão.** `evaluateMemberQuota` conta vínculos `kind = MEMBER` com situação
`ACTIVE` ou `INVITED` (convite pendente já reserva lugar; `SUSPENDED` e `REMOVED` não).
Participante não consome.

**Justificativa.** A quota do plano é sobre quem administra a instituição. Cobrar por
público de evento exigiria outro produto (e outro preço), não a mesma coluna.

**Consequências.** (+) A inscrição pública continua funcionando em instituição com a
equipe no teto — há teste de integração exatamente para isso. (−) A contagem precisa do
critério replicado em três lugares (quota, contador do painel, visão da instituição);
todos usam as mesmas constantes de situação e `kind`, e o teste de integração compara
os três.

### ADR-082 — Vincular membro é ato de plataforma; convidar é ato da instituição (fase futura)

**Contexto.** A quota precisava de um caminho de escrita real. Os candidatos eram o
painel de plataforma (SuperAdmin) e o painel da instituição (ADMIN).

**Decisão.** O vínculo de equipe — pessoa **com conta** — passa a ser feito pelo painel
de governança, com busca por e-mail, quota aplicada, papel concedido e trilha. A
instituição recebe a tela de **leitura** da equipe. O convite pela instituição (para
quem não tem conta, com prova de posse do endereço) fica para a fase de Comunicação.

**Justificativa.** Procurar por e-mail é varredura da base global de identidade. A
plataforma já faz isso no provisionamento do proprietário, operação auditada; dar a
mesma capacidade a qualquer ADMIN de instituição criaria um verificador de existência
de contas — inclusive para descobrir quem trabalha na instituição concorrente.
Alternativa descartada: deixar a instituição convidar por e-mail agora, sem e-mail
transacional, o que apenas moveria a sondagem de lugar.

**Consequências.** (+) A quota tem um gate real, auditado e alcançável. (−) A
instituição depende da plataforma para trazer gente nova até a fase de Comunicação —
declarado como dependência, não escondido. (−) Um vínculo promovido (`PARTICIPANT` →
`MEMBER`) passa a ocupar vaga, o que é o comportamento correto e tem teste.

### ADR-083 — Plano editável com `useDefaults`; redução abaixo do uso é permitida com aviso

**Contexto.** Trocar o plano de uma instituição exigia SQL. As quotas por plano eram
definidas em `PLAN_DEFINITIONS` e aplicadas só no provisionamento, parcialmente (o
armazenamento nunca era gravado).

**Decisão.** `updateTenantPlan` com `useDefaults` (aplica as quotas do plano) ou quotas
explícitas; as três quotas vêm de `planQuotas`; a redução abaixo do uso atual é aceita e
devolve `warnings`; toda mudança grava trilha de plataforma com antes/depois.

**Justificativa.** Separar "herdar do plano" de "acordo específico" evita a armadilha de
campo vazio virar "ilimitado" (que é `null`, não vazio). Recusar a redução deixaria a
plataforma sem saída sem apagar dados do cliente.

**Consequências.** (+) Operação comercial deixa de depender de SQL e fica auditada.
(+) O defeito do armazenamento foi corrigido e coberto por teste. (−) A quota de
armazenamento é registrada e **não aplicada** em nenhum caminho: quem lê a tela pode
supor que bloqueia upload. A tela diz isso explicitamente e o item entrou no
levantamento como dívida C4.

### ADR-084 — A tela de equipe exige permissão de administração de membros

**Contexto.** A tela `/t/<slug>/administracao/equipe` nasceu com guarda `tenant:read`,
que parece a escolha óbvia para "listar o que é da instituição". O teste E2E
`participante não entra na tela de equipe` reprovou: o papel `PARTICIPANT` **tem**
`tenant:read` (ele precisa ler o evento e a própria inscrição), então o público de
qualquer evento aberto — que ganha acesso automaticamente desde a FASE 10 — abriria a
tela e leria nome, e-mail e papéis de toda a equipe.

**Decisão.** A guarda da tela e do item de menu é `tenant:member:invite`, a mesma da
seção "Administração". Nenhuma permissão nova foi criada.

**Justificativa.** Lista de equipe é dado de administração de pessoas, não dado público
da instituição. Alternativa descartada: criar `tenant:member:read` — semanticamente
bonito, mas mexeria na contagem de permissões e no mapa de papéis para resolver algo
que a permissão existente já resolve.

**Consequências.** (+) O público do evento não enxerga a equipe; quem administra vê.
(−) `CHAIR`, `REVIEWER`, `FINANCE` e `SPONSOR` (que têm `tenant:read` mas não
`tenant:member:invite`) não veem a lista de equipe. É aceitável hoje: nenhum deles
administra pessoas, e quem precisar do dado pede ao administrador.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | E2E `participante não entra na tela de equipe` falhou: o participante abriu a tela e leu a equipe | A guarda era `tenant:read` — e `PARTICIPANT_PERMISSIONS` **inclui** `tenant:read` (o participante precisa ler evento e inscrição). Minha leitura inicial do mapa de papéis estava errada | Guarda trocada para `tenant:member:invite` (ADR-084); o teste que encontrou o defeito ficou |
| 2 | E2E do plano devolveu **500** com `invalid input syntax for type uuid: "undefined"` | O id da instituição era guardado numa variável de módulo preenchida pelo primeiro teste; o quarto recebeu `undefined` — a suíte só passava na ordem em que foi escrita | O id é resolvido pelo slug no banco a cada uso (`tenantRef()`), como já recomendava o E2E da FASE 9 |
| 3 | Instituição PROFISSIONAL nascia com 5 GiB de armazenamento | O provisionamento gravava `maxEvents` e `maxMembers` do plano e **omitia** `maxStorageBytes`, que ficava no default do schema | `planQuotas(plan)` como fonte única das três quotas + teste de regressão no provisionamento |
| 4 | `expect(promise).resolves.toBe(...)` não é confiável no Playwright | O `expect` do Playwright não é o do Vitest; a asserção não espera a promessa | `const count = await ...; expect(count).toBe(0)` |
| 5 | Asserção por `getByText` com regex falhou mesmo com o texto na tela | O texto estava dividido por `<strong>` e a redação real era outra; regex sobre texto fragmentado é frágil | Asserção passou a mirar o contêiner por `data-testid` e um trecho estável |
| 6 | O backfill classificou `carla@example.test` (convite pendente com papel `PARTICIPANT`) como participante | A regra é "único papel vigente é `PARTICIPANT`"; o convite do seed de demonstração concede esse papel, então ele é público pelo critério — e isso é coerente com o que a conta representa hoje | Regra mantida; o caso ficou visível na verificação manual do backfill (22 vínculos, 6 participantes) e o seed de teste passou a derivar `kind` da mesma função |

---

## 6. Evidência de verificação

### 6.1 Bateria completa

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 34 arquivos, 870 testes passando
npm run build                → ✓ Compiled successfully · ƒ /t/[tenantSlug]/administracao/equipe
npm run db:verify            → Contrato íntegro.
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:verify:pooling    → Pooling íntegro: contexto por transação preservado sob PgBouncer.
npm run db:partitions        → partições 2026_09 / 2026_10 / 2026_11 + DEFAULT, 489 linhas
npm run test:e2e             → 51 passed (1.4m)
```

### 6.2 Backfill da migração (dados reais)

```text
$ psql -c "SELECT kind, count(*) FROM user_tenant_profiles GROUP BY 1"
    kind     | count
-------------+-------
 PARTICIPANT |     6
 MEMBER      |    16

$ psql -c "SELECT p.kind, t.slug, u.email, string_agg(ra.role::text, ',') ..."
 MEMBER      | ufba-demo    | ana@example.test                  | ADMIN,CHAIR
 PARTICIPANT | ufba-demo    | participante@eventflow.test       | PARTICIPANT
 PARTICIPANT | ufba-demo    | carla@example.test                | PARTICIPANT
 MEMBER      | fiocruz-demo | ana@example.test                  | CHAIR,PARTICIPANT
```

`ana@example.test` tem `CHAIR` **e** `PARTICIPANT` na FIOCRUZ e continua MEMBRO; quem só
tem `PARTICIPANT` virou público. O critério fez exatamente o que promete.

### 6.3 A quota recusando e liberando (E2E, contra o container de produção)

```text
✓ 1. a instituição nasce com as quotas do plano e o SuperAdmin as edita
✓ 2. a instituição vê equipe e participantes separados
✓ 3. participante não entra na tela de equipe
✓ 4. a quota recusa o vínculo, avisa na redução e libera no ajuste
```

O caso 4 verifica, no navegador: quota cheia ⇒ mensagem `Membros hoje: 1 de 1` e
**nenhuma** linha gravada no banco; ajuste do plano ⇒ vínculo criado como `MEMBER` com
papel `ADMIN`; redução abaixo do uso ⇒ aviso "novos vínculos de equipe ficam
bloqueados"; e a equipe da instituição passa a mostrar 2 membros e 1 participante.

### 6.4 A quota não bloqueia o público (integração, banco real)

```text
✓ a instituição no limite de membros continua aceitando inscrição pública
✓ quem já é membro e se inscreve continua MEMBRO (não é rebaixado)
✓ a lista de membros da plataforma traz equipe, não inscritos
✓ promover um participante a membro o faz contar na quota
```

---

## 7. Comandos operacionais

```bash
# ── Ver o efeito da fase nos dados ─────────────────────────────────────────────
# Membros x participantes por instituição (contrato de leitura do painel):
psql "$MIGRATE_DATABASE_URL" -c "SELECT t.slug, p.kind, p.status, count(*) \
  FROM user_tenant_profiles p JOIN tenants t ON t.id = p.tenant_id GROUP BY 1,2,3 ORDER BY 1;"

# Na interface:
#   /superadmin/tenants/<id>       plano, quotas, vínculo de membro, equipe
#   /t/<slug>/administracao/equipe equipe e público (requer tenant:member:invite)

# ── Trocar plano e quotas (interface) ──────────────────────────────────────────
# Painel de governança → instituição → "Plano e quotas".
#   "Usar as quotas padrão do plano" marcado  -> aplica PLAN_DEFINITIONS[plano]
#   desmarcado                                -> vale o número informado
#   quota de membros: mínimo 1 (o proprietário ocupa uma vaga)
```

```sql
-- Operação manual equivalente (a interface é o caminho, isto é o plano B):
UPDATE tenants SET plan = 'PROFESSIONAL', max_events = 50, max_members = 5000,
       max_storage_bytes = 107374182400 WHERE slug = 'instituicao';
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Item | Por que ficou | Impacto se ficar |
|---|---|---|---|
| 1 | **Quota de armazenamento não é aplicada (C4)** | `maxStorageBytes` é gravada do plano e exibida, mas nenhum caminho soma bytes antes de aceitar upload | A tela sugere um limite que não existe; um cliente pode ocupar o storage sem teto |
| 2 | **Remover membro e editar/revogar papel pela UI (C5)** | `tenant:member:remove` e `tenant:role:assign` existem e não têm tela; a fase entregou vincular e não desvincular | Reduzir a equipe continua sendo SQL — e reduzir quota exige reduzir equipe |
| 3 | **Convite pela instituição** | Depende de e-mail transacional e de prova de posse do endereço (fase de Comunicação, item D2) | Trazer gente nova continua dependendo da plataforma |
| 4 | **Sem paginação na lista de equipe** | `take: 500` nas duas leituras, como no resto do projeto (dívida E2) | Instituição com mais de 500 vínculos de equipe vê a lista truncada |
| 5 | **`kind` em consultas antigas** | Toda leitura nova precisa dizer qual natureza quer; o default do banco é `MEMBER` | O esquecimento erra para o lado restritivo (público não aparece) — não vaza, mas engana |
| 6 | **Critério de contagem replicado** | Quota, contador do painel e visão da instituição repetem `kind`/`status` | Divergência silenciosa se o critério mudar em um lugar só; o teste de integração compara os três hoje |

---

## 9. Checklist de aceite

- [x] **C1** — quota de membros avaliada no domínio, com mensagem acionável e `remaining`
- [x] **C1** — caminho de escrita real (`addTenantMember`) aplicando a quota, com auditoria e idempotência
- [x] **C1** — inscrição pública **não** consome a quota de membros (teste de integração)
- [x] **C1** — provisionamento recusa plano sem vaga para o proprietário (mínimo 1)
- [x] **C3** — provisionamento grava as três quotas do plano, inclusive armazenamento
- [x] **C3** — troca de plano e edição de quotas pela UI, com auditoria de plataforma
- [x] **C3** — redução abaixo do uso permitida com aviso explícito do que foi bloqueado
- [x] **I4** — `MembershipKind` no schema, com migração e backfill documentados
- [x] **I4** — inscrição pública cria `PARTICIPANT` e não rebaixa membro
- [x] **I4** — listas e contadores separam equipe de público (plataforma e instituição)
- [x] **I4** — tela de equipe na instituição, sob RLS, com uso da quota visível
- [x] — guarda da tela de equipe corrigida para `tenant:member:invite` (defeito achado por E2E)
- [x] — seed de contas de teste usa a mesma regra de classificação da migração
- [x] Testes novos: 23 unitários + 15 de integração + 4 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 6
- [x] `README.md`, `AGENTS.md` e `docs/dividas-tecnicas.md` atualizados
- [x] Imagem `eventflow/web:local` reconstruída e E2E rodando contra ela

---

**Aguardando APROVADO: AVANÇAR**
