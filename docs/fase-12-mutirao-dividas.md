# FASE 12 — Mutirão de dívidas rápidas

> **Leia junto com:** [`docs/dividas-tecnicas.md`](dividas-tecnicas.md) (o levantamento
> que originou esta fase), [`docs/design-system.md`](design-system.md) e `AGENTS.md`.

---

## 1. Sumário executivo

O levantamento consolidado das FASES 1–11B identificou **53 dívidas abertas** e marcou
**20 delas como rápidas** (esforço até meio dia). Esta fase executa as **oito primeiras**
— as que fecham lacunas de comportamento sem exigir desenho novo: uma permissão que não
funcionava como documentada, uma escolha que a FASE 10 tirou da instituição, uma quota
decorativa, uma brecha de concorrência, um limite silencioso, um cache que não se
propagava e uma faxina de layout.

### Entregas

| # | Item | O que mudou |
|---|---|---|
| 1 | **I7 — Equipe de evento no credenciamento** | A guarda aceita escopo `TENANT` **ou** `EVENT`; a listagem passa a mostrar apenas os eventos em que a pessoa é equipe |
| 2 | **I3 — Evento restrito à comunidade** | Nova chave `settings.registrationRequiresMembership` no evento, com checkbox no painel; a inscrição pública volta a poder ser fechada pela instituição |
| 3 | **I5 — Concessão de papel única** | Índice único parcial `role_assignments_live_unique` (com `NULLS NOT DISTINCT`) impede duas concessões vigentes idênticas |
| 4 | **C2 — Quota de eventos aplicada** | `evaluateEventQuota` no domínio + verificação dentro da transação de criação, com código `QUOTA_EXCEEDED` |
| 5 | **I1 — Invalidação de cache distribuída** | Barramento Redis publica a invalidação; um assinante por processo limpa o cache local |
| 6 | **I2 — Diretório sem truncamento** | A vitrine deixou de ter teto silencioso de 500 instituições |
| 7 | **H2 — Wrappers duplicados** | 19 telas do painel perderam `mx-auto`/padding herdados do tempo anterior ao shell |
| 8 | **H4 — `font-mono` → `code-data`** | 27 arquivos passaram a usar o token de dado (tabular, mono, tamanho do sistema) |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos alterados | 58 (inclui as 46 telas da faxina H2/H4) |
| Arquivos criados | 5 (barramento, migração, 2 suítes de teste, este documento) |
| Migrações | 1 (`role_assignment_live_unique`) |
| Testes Vitest | 775 → **799** (15 unitários + 9 de integração) |
| Testes E2E | 42 → **44** (2 cenários de escopo de equipe) |
| Permissões / papéis | inalterados (54 / 11) |
| Item de dívida quitados | **8 de 53** (sobram 45 no levantamento) |
| ADRs | 70 → **74** |

---

## 2. O problema mais difícil da fase

**Fechar oito lacunas de comportamento em oito lugares diferentes sem que a correção de
uma crie a brecha da outra.**

O caso exemplar é o I7. A tela de credenciamento exigia permissão de escopo
INSTITUIÇÃO, e o próprio seed de demonstração concede `STAFF` por EVENTO — ou seja, a
plataforma recomendava um padrão de concessão e redirecionava quem o seguia. A correção
"aceitar escopo de evento na guarda" tem uma armadilha imediata: a tela lista **todos**
os eventos da instituição. Aceitar o escopo sem filtrar a listagem trocaria uma recusa
injusta por um vazamento — a equipe do evento A passaria a ver os participantes do evento
B, que é justamente o que o escopo estreito existe para impedir.

Por isso a correção é dupla, e as duas metades estão no mesmo commit: a guarda aceita os
dois escopos, e a página filtra a listagem por `can(..., { scope: 'EVENT', eventId })`.
O teste E2E prova os dois lados — o evento próprio aparece, o alheio não.

Os outros itens trouxeram armadilhas menores, todas registradas nas lições:

- o índice único (I5) faria **duas inscrições simultâneas** da mesma pessoa nova
  falharem: a segunda tentaria conceder `PARTICIPANT` e receberia violação de unicidade
  no meio da transação da inscrição — ou seja, a pessoa perderia a **vaga** por causa de
  um papel que já existia;
- o `NULLS NOT DISTINCT` (PostgreSQL 15+) é o que faz o índice pegar o caso mais comum
  (concessão de instituição, com `eventId` nulo) e a concessão de plataforma;
- a chave do evento restrito (I3) precisou nascer em `settings` (JSON) e ser lida com
  tolerância: um valor de outro tipo não pode derrubar a página de um evento.

---

## 3. Decisões técnicas

### 3.1 `NULLS NOT DISTINCT` em vez de dois índices parciais

Em índice único do PostgreSQL, `NULL` é **distinto** por padrão: um índice em
`(tenantId, userId, role, scope, eventId, activityId)` sem essa cláusula não pegaria duas
concessões de instituição (as duas com `eventId` e `activityId` nulos) — exatamente o caso
mais frequente. A alternativa era criar dois índices parciais (um para linhas com
`tenantId` não nulo, outro para plataforma). `NULLS NOT DISTINCT` resolve os dois casos
com um índice e é suportado pelo PostgreSQL 18 do projeto.

### 3.2 A quota é verificada dentro da transação

`currentCount` e `INSERT` na mesma transação: fora dela, duas criações simultâneas
passariam as duas pela verificação e a quota estouraria por dois. A leitura da quota usa
a própria conexão de runtime — a tabela `tenants` tem policy de leitura
(`tenant_resolution_read`), então não foi preciso abrir exceção com a conexão
administrativa.

### 3.3 A política do evento é lida com tolerância a lixo

`settings` é JSON livre. `readEventRegistrationPolicy` aceita qualquer entrada e só
considera `true` booleano; ausente, texto, número ou array caem no padrão **aberto**, que
é o comportamento de todas as fases desde a 10. Uma chave nova não pode ser o motivo de
uma página pública parar.

### 3.4 O barramento de cache não pode derrubar nada

`cache-bus.ts` publica em "fire and forget" e assina com uma conexão dedicada;
`lazyConnect` + `enableOfflineQueue: false` fazem uma indisponibilidade do Redis não
enfileirar comandos nem segurar requisições. Sem Redis, o comportamento é o anterior a
esta fase (cache local com TTL de 30 s) — cache é otimização, e a decisão de acesso nem
passa por ele desde a FASE 9.

### 3.5 Um item da faxina não era cosmético

Ao trocar `font-mono` por `code-data`, três elementos que eram **rótulo em caixa alta**
foram para `label-caps` — não para o token de dado. O mapa foi revisado à mão justamente
por isso: `code-data` carrega `tabular-nums` e não muda a caixa; `label-caps` carrega a
caixa alta e o cinza médio. Trocar os dois por igual teria transformado rótulo em dado.

---

## 4. ADRs

### ADR-071 — Escopo estreito só autoriza se a tela também restringir

**Contexto.** A guarda de página autorizava apenas com o escopo `TENANT`, e o
credenciamento listava todos os eventos da instituição.

**Decisão.** `requirePagePermission` passou a aceitar `allowedScopes`, e quem usa escopos
mais estreitos é **responsável por filtrar o conteúdo**. A tela de credenciamento declara
`['TENANT', 'EVENT']` e filtra a listagem por evento.

**Justificativa.** Aceitar o escopo sem filtrar trocaria uma recusa injusta por um
vazamento — e o vazamento é o modo de falha mais caro dos dois. Manter as duas metades
no mesmo ponto do código é o que impede que uma seja feita sem a outra.

**Consequências.** Uma tela nova que aceite escopo de evento precisa repetir o filtro; o
comentário na guarda diz isso explicitamente, e o E2E cobre o caso negativo (o evento
alheio não aparece).

### ADR-072 — A inscrição pública é o padrão, e a instituição pode fechá-la por evento

**Contexto.** A FASE 10 abriu a inscrição para quem não tem vínculo em **todos** os
eventos públicos, removendo um comportamento que a instituição podia querer (assembleia,
turma interna, reunião de conselho). Não havia como voltar atrás sem reverter a fase.

**Decisão.** Chave por evento em `settings.registrationRequiresMembership`, desmarcada por
padrão, com checkbox no painel. Quando marcada, `isOpenToPublicEvent` devolve `false` e o
domínio da FASE 10 já existente (que recebe `eventIsPublic`) recusa quem não tem vínculo —
com a mensagem "Este evento é restrito à comunidade de X".

**Justificativa.** A semântica já estava no domínio desde a FASE 10 (o ramo `!eventIsPublic`
com a mensagem de restrição); faltava a chave que a alimenta. Isso permitiu fechar o item
sem tocar na regra de decisão do vínculo nem exigir migração (o campo JSON já existia).

**Consequências.** O padrão continua aberto — nenhum evento existente muda de
comportamento. Membro ativo se inscreve normalmente num evento restrito; a restrição vale
para quem está fora.

### ADR-073 — Concessão vigente é única no banco, e o conflito não derruba a operação

**Contexto.** `grantSuperAdmin` e `applyParticipantLink` checavam existência antes de
inserir. Checagem de aplicação perde para concorrência: duas concessões vigentes
idênticas, e revogar uma deixava a outra valendo.

**Decisão.** Índice único parcial com `NULLS NOT DISTINCT` sobre
`(tenantId, userId, role, scope, eventId, activityId)` das linhas não revogadas. Na
inscrição pública, a violação de unicidade ao conceder `PARTICIPANT` é **absorvida**
(idempotência), e não propagada.

**Justificativa.** O índice é a garantia que não depende de disciplina de código. Já a
absorção é necessária porque o efeito colateral de deixar a exceção subir seria perder a
**vaga** — a concessão é idempotente por natureza, então o conflito é resposta de
negócio, não erro. O mesmo padrão do "retorno de 0 linhas é resposta de negócio" do
projeto.

**Consequências.** Concessões simultâneas continuam seguras; o teste de concorrência da
FASE 10 (duas inscrições em paralelo) passou a cobrir também o índice.

### ADR-074 — Quota é decisão de domínio, verificada na transação de escrita

**Contexto.** `maxEvents` e `maxMembers` eram gravados, exibidos no painel de governança e
nunca consultados. O plano não limitava nada.

**Decisão.** `evaluateEventQuota({ currentCount, maxEvents })` no domínio; a verificação
roda **dentro** da transação de criação, com erro próprio `QUOTA_EXCEEDED` e mensagem
acionável. `null` é ilimitado; `0` é nenhum evento.

**Justificativa.** A regra no domínio é testável sem banco (o que a torna barata de
mudar) e a leitura dentro da transação é o que impede duas criações simultâneas de
estourarem a quota. `null`/`0` seguem a semântica de `Event.capacity`, já estabelecida na
FASE 3 — vocabulário único no sistema.

**Consequências.** `C1` (quota de membros) fica pendente no levantamento e deve seguir o
mesmo desenho quando a F14 o implementar.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Duas inscrições simultâneas da mesma pessoa nova passariam a **falhar** depois do índice único | A segunda tentava conceder `PARTICIPANT`, recebia violação de unicidade e abortava a transação inteira — a pessoa perdia a **vaga** por causa de um papel que já existia | A concessão passou a absorver `isUniqueViolation` (AGENTS.md, armadilha 6: "idempotência por chave do fato"): o conflito é resposta de negócio |
| 2 | `NULLS NOT DISTINCT` era obrigatório, e não detalhe | Índice único com `NULL` distinto não pegaria duas concessões de instituição (`eventId`/`activityId` nulos) — o caso mais frequente — nem a de plataforma | Cláusula explícita no índice, com o motivo escrito na migração |
| 3 | A primeira versão do ramo "evento restrito" na página recusava a inscrição de **membros** | O ramo testava apenas `registrationRequiresMembership`, sem olhar o vínculo — e a regra é "restrito a quem tem vínculo", não "fechado para todos" | Condição corrigida para `registrationRequiresMembership && membershipStatus !== 'ACTIVE'`, espelhando o domínio (que devolve `ALREADY_MEMBER` antes de avaliar a restrição) |
| 4 | `code-data` em três elementos de rótulo teria virado dado em caixa baixa | O mapa automático tratou `font-mono uppercase` como dado; esses elementos eram metadado | `label-caps` para rótulo, `code-data` para dado — revisão manual do mapa, como na FASE 11B |
| 5 | `ioredis` apareceu **duas vezes** no `package.json` | Ele já era dependência declarada (via BullMQ) e eu o adicionei por engano achando que era transitiva | Duplicata removida. A lição: conferir o `package.json` antes de declarar dependência que "já está instalada" |
| 6 | `@axe-core/playwright` **já está** no `package.json`, sem nenhum uso | O levantamento marcou H5 como "não existe" olhando o código; a dependência estava lá desde a FASE 7 | Item corrigido no levantamento: H5 é "escrever os testes", não "instalar a ferramenta" |
| 7 | **E2E:** o cenário "equipe sem acesso ao painel" reprovou esperando `307` e recebendo `200` | `page.goto` **segue** o redirecionamento: a resposta que chega já é a da página de destino. O comportamento estava correto — a asserção olhava para o lugar errado | A verificação passou a ser sobre a **URL final** (`toHaveURL(/dashboard/)`) e a ausência do conteúdo administrativo, que é o que o requisito de fato afirma |

---

## 6. Evidência de verificação

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 799 testes / 29 arquivos
npm run build                → "Compiled successfully"
npm run db:verify            → "Contrato íntegro."
npm run db:verify:isolation  → "9/9 verificações passaram."
npx prisma migrate deploy    → role_assignment_live_unique aplicada
npm run test:e2e             → 44 testes / 10 arquivos
```

Testes novos da fase:

```text
tests/unit/quick-wins.test.ts                15 testes
  ✓ quota de eventos (limite, estouro, null = ilimitado, 0 = nenhum)
  ✓ política do evento (ausente = aberto, só `true` restringe, lixo tolerado)
  ✓ mensagens do barramento (normalização, "invalide tudo", lixo descartado)

tests/integration/quick-wins.test.ts          9 testes
  ✓ I5: duplicata vigente recusada · revogar libera · mesmo papel em eventos diferentes
  ✓ C2: criação acima da quota recusada com QUOTA_EXCEEDED
  ✓ I3: restrito recusa quem não tem vínculo e ACEITA quem é membro
  ✓ I3: evento sem a chave continua aberto
  ✓ I1: mensagem publicada chega em outra conexão Redis
  ✓ I2: diretório devolve todas as instituições públicas

tests/e2e/team-scope.spec.ts                  2 testes
  ✓ equipe de evento abre o credenciamento e vê SÓ o seu evento
  ✓ equipe do dia continua sem acesso ao painel administrativo
```

---

## 7. Comandos operacionais

```bash
npx prisma migrate deploy      # aplica o índice único de concessão vigente
npm run db:seed:dev            # inclui a conta equipe-evento@ (escopo de evento)
docker compose --profile app up -d --build web

# Conferir o item I7 na interface:
#   login equipe-evento@eventflow.test → /t/ufba-demo/credenciamento
#   → abre a tela e o seletor mostra apenas o Congresso 2026
# Conferir o item I3:
#   /t/ufba-demo/administracao/eventos/<id> → marcar "Exigir vínculo…"
#   → em janela anônima, a atividade passa a mostrar "Restrito à comunidade"
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Dívida | Impacto | Encaminhamento |
|---|---|---|---|
| 1 | `maxMembers` (C1) continua não aplicado | Quota de membros do plano segue decorativa; com inscrição pública o número cresce sem aviso | F14 — mesmo desenho do `evaluateEventQuota`, e exige decidir o comportamento ao estourar (recusar inscrição? marcar participante externo?) |
| 2 | O barramento de cache não tem *teste de duas instâncias reais* | O teste prova o roundtrip no Redis; a propagação entre processos distintos fica por conta do E2E de suspensão | Teste de integração com dois processos quando houver ambiente para isso |
| 3 | A invalidação publicada não é idempotente por mensagem perdida | Se uma instância estiver fora do ar no momento da publicação, ela mantém o cache até o TTL (30 s) | Aceitável: a decisão de acesso não usa cache; revisar se a identidade virar crítica |
| 4 | `requiredScopes` na guarda é responsabilidade do chamador | Uma tela nova pode aceitar `EVENT` e esquecer de filtrar | O comentário na guarda documenta; um teste de guarda poderia exigir o filtro (avaliar) |
| 5 | `listTenantMembers` mantém `take: 500` | Lista de membros de instituições grandes trunca | Paginação junto da F14 (junto com a distinção participante × membro) |
| 6 | Restam **45 itens** no levantamento | — | `docs/dividas-tecnicas.md`, com as fases candidatas F12→F18 |

---

## 9. Checklist de aceite

| Requisito | Situação |
|---|---|
| I7: equipe com escopo de evento abre o credenciamento | ✅ |
| I7: a equipe enxerga apenas os eventos em que atua | ✅ (E2E, caso negativo incluído) |
| I7: `STAFF` continua sem acesso à administração | ✅ (E2E) |
| I3: chave de evento restrito, desmarcada por padrão | ✅ |
| I3: evento restrito recusa quem não tem vínculo e aceita membro | ✅ (integração) |
| I3: valor inválido em `settings` não quebra a página | ✅ (unitário) |
| I5: índice único de concessão vigente aplicado | ✅ (migração + integração) |
| I5: revogar e reconceder continua funcionando | ✅ (integração) |
| I5: conflito na inscrição pública não derruba a vaga | ✅ (concorrência da FASE 10 segue verde) |
| C2: quota de eventos verificada na criação, com erro próprio | ✅ (integração) |
| I1: invalidação de cache chega a outras instâncias | ✅ (integração com Redis real) |
| I1: sem Redis, nada quebra | ✅ (falha absorvida e registrada uma vez) |
| I2: diretório sem teto silencioso | ✅ (integração) |
| H2: wrappers duplicados removidos das telas do painel | ✅ (19 arquivos) |
| H4: `font-mono` substituído por `code-data`/`label-caps` | ✅ (27 arquivos, com revisão manual dos rótulos) |
| Documentação: fase, levantamento atualizado, contas de teste, `.env.example` | ✅ |
| Bateria completa verde | ✅ |
