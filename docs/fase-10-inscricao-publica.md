# FASE 10 — Inscrição pública e vínculo automático de participante

> **Leia junto com:** `docs/fase-03-eventos-inscricoes.md` (inscrição e lotação),
> `docs/fase-02-autenticacao-rbac-tenancy.md` (RBAC, vínculo e papéis) e `AGENTS.md`.

---

## 1. Sumário executivo

A FASE 3 entregou a jornada pública do participante — mas com uma porta fechada: para
se inscrever, era preciso ter **vínculo ATIVO com a instituição**, e o vínculo só
nascia de um convite feito por dentro. Quem chegava por um link compartilhado via:

> "Sem vínculo com a instituição. Sua conta ainda não tem acesso ativo a
> Universidade Federal da Bahia. **Peça um convite à organização do evento.**"

Ou seja: para se inscrever sozinha, a pessoa precisava pedir a alguém de dentro que a
cadastrasse. Em um produto cujos eventos são **públicos**, isso é um beco sem saída —
e foi o que apareceu no primeiro teste de uso real.

Esta fase abre a porta **sem abrir o portão**: quem se inscreve em atividade de evento
público passa a ser **PARTICIPANTE** da instituição, na mesma transação da inscrição.
A instituição continua decidindo quem **não** entra: vínculo suspenso ou removido é
bloqueio, e é respeitado.

### Entregas

| # | Entrega | Onde |
|---|---|---|
| 1 | Regra pura de decisão do vínculo (`CREATE`/`ACTIVATE`/`ALREADY_MEMBER`/`BLOCKED`) | `src/domain/events/public-registration-rules.ts` |
| 2 | Vínculo aplicado na MESMA transação da inscrição (`upsert` + concessão de papel + auditoria) | `src/lib/events/registration-service.ts` |
| 3 | Guarda de ação com dois caminhos: pessoa de fora (público) e membro (RBAC) | `src/app/actions/registration-actions.ts` |
| 4 | Página da atividade: aviso de vínculo, e "bloqueado" separado de "sem vínculo" | `src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/atividades/[activitySlug]/page.tsx` |
| 5 | **Correção de defecto:** remoção do diagnóstico que aparecia na tela pública | mesma página |
| 6 | Testes: 16 unitários, 9 de integração, 2 E2E (um deles substituindo o que afirmava o comportamento antigo) | `tests/**` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos criados | 3 (1 de domínio, 2 de teste) + esta documentação |
| Arquivos alterados | 6 (serviço, ação, página, teste E2E, README, AGENTS) |
| Migrações | **nenhuma** — a fase não muda o banco |
| Permissões | 54 (inalterado) |
| Papéis concedidos automaticamente | 1 (`PARTICIPANT`, escopo TENANT) |
| Testes Vitest | 745 → **770** (26 arquivos) |
| Testes E2E | 41 → **42** (9 arquivos) |
| ADRs | 59 → **63** |

---

## 2. O problema mais difícil da fase

**Abrir a inscrição para quem não tem vínculo sem transformar isso em porta de entrada
para quem foi banido.**

O vínculo era a única coisa que separava "membro da comunidade" de "visitante". Removê-lo
como pré-requisito parecia significar remover também a capacidade de a instituição dizer
"esta pessoa não entra" — e, de fato, a primeira versão da regra tinha esse defeito em
potencial: a tela tratava **todo** mundo sem vínculo ATIVO da mesma forma, com a mesma
mensagem ("peça um convite").

São três situações diferentes escondidas em uma:

| Situação | O que a instituição quer | O que a fase faz |
|---|---|---|
| Nunca teve relação com a instituição | que a pessoa se inscreva (evento é público) | cria vínculo + `PARTICIPANT` |
| Foi convidada e não aceitou ainda | que ela entre | a inscrição é o aceite (`INVITED` → `ACTIVE`) |
| Foi suspensa ou removida | que ela **não** entre | bloqueio, com mensagem própria |

A ordem das verificações é a regra: **bloqueio → membro ativo → convite pendente →
criação**. Inverter qualquer par produziria o efeito errado — "ativar" um vínculo
suspenso seria desfazer, na prática, a decisão da instituição.

O segundo problema, mais sutil: **o vínculo criado não pode mexer no RBAC de quem já é
membro**. O sistema acumula papéis; se a inscrição concedesse `PARTICIPANT` a todo
mundo, um patrocinador com vínculo e **sem** `registration:create` (caso coberto por
teste E2E desde a FASE 3) passaria a poder se inscrever, porque o acúmulo lhe daria a
permissão. Por isso o papel só é concedido a quem **não tem papel nenhum** na
instituição — e a fronteira entre "é membro" e "pode agir" continua onde estava.

---

## 3. Decisões técnicas

### 3.1 O vínculo nasce na mesma transação da inscrição

`decideParticipantLink` roda **antes** da reserva de vaga (para que um bloqueio não
consuma vaga nem crie linha de inscrição) e `applyParticipantLink` roda **depois** de a
inscrição existir (para que uma reserva recusada não deixe ninguém como participante).
As duas leituras estão na transação que a FASE 3 já usava — não há segunda transação,
nem compensação, nem estado intermediário.

Tudo acontece sob RLS, com a role de runtime: `user_tenant_profiles` e
`role_assignments` têm `tenantId`, e a policy cobre `INSERT`/`UPDATE`. A regra que
**amplia** acesso é executada com o mesmo privilégio do resto do fluxo — o que é uma
boa propriedade a se preservar.

### 3.2 `upsert`, não `create`

Duas inscrições simultâneas da mesma pessoa nova (duas abas) leriam "sem vínculo" ao
mesmo tempo. `create` faria a segunda falhar com violação de unicidade e derrubaria a
inscrição; `upsert` vira `ON CONFLICT DO UPDATE` e o PostgreSQL resolve a corrida. O
teste de integração dispara as duas em paralelo: **um** vínculo, **um** papel, **duas**
inscrições.

### 3.3 Dois caminhos de autorização, que não se misturam

| Quem | Regra |
|---|---|
| Sem vínculo ativo | inscrição pública: basta estar autenticado; o serviço decide o vínculo |
| Com vínculo ATIVO | continua valendo `registration:create` (RBAC) |

A FASE 10 abriu a porta para quem está **fora**; não reescreveu as regras de quem está
**dentro**. Foi essa separação que preservou, sem alteração, o E2E "usuário com vínculo
mas sem permissão não consegue se inscrever".

### 3.4 O aviso vem antes, não depois

O formulário exibe, para quem não é membro: *"Ao confirmar, sua conta será vinculada
como participante de X…"*. Criar vínculo sem avisar seria inscrever a pessoa em algo
que ela não pediu.

---

## 4. ADRs

### ADR-060 — Inscrição pública cria o vínculo de participante

**Contexto.** Eventos da plataforma são públicos, mas a inscrição exigia vínculo ATIVO
com a instituição — obtido apenas por convite interno. O resultado era um beco sem
saída para quem chegava por link.

**Decisão.** Quem se inscreve em atividade de evento público passa a ser `PARTICIPANT`
da instituição, criado na mesma transação da inscrição (`UserTenantProfile` ACTIVE +
`RoleAssignment` `PARTICIPANT`, escopo TENANT), com registro na trilha de auditoria da
instituição.

**Justificativa.** As alternativas eram: (a) manter o convite obrigatório — inviável para
evento aberto, pois transfere ao organizador um trabalho manual por participante;
(b) abrir a inscrição **sem** criar vínculo — o que deixaria a pessoa sem acesso a
"Minhas inscrições", certificados, cartas e conquistas, exigindo exceções de acesso em
todas essas rotas; (c) criar uma "conta de evento" paralela — duplicaria o modelo de
identidade. Criar o vínculo de participante usa o modelo que já existe, faz o resto da
plataforma funcionar sem caso especial e mantém um único lugar onde a instituição pode
bloquear alguém: o status do vínculo.

**Consequências.** A lista de membros da instituição passa a incluir quem se inscreveu
(auditada como `UserTenantProfile`/`CREATE` com origem "inscrição pública"). A quota
`maxMembers` do plano, hoje declarada mas não aplicada em nenhum caminho, passa a ser
um limite que pode ser atingido por inscrições — registrado como dívida técnica.

### ADR-061 — Bloqueio da instituição tem precedência sobre a inscrição pública

**Contexto.** Suspender ou remover um vínculo é a forma de a instituição dizer "esta
pessoa não entra".

**Decisão.** `evaluateParticipantLink` avalia, nesta ordem: `SUSPENDED`/`REMOVED` (e
vínculo apagado, tratado como removido) → `BLOCKED`; `ACTIVE` → nada a fazer;
`INVITED` → ativa; ausente → cria. O bloqueio devolve mensagem própria ("Seu acesso a
esta instituição está bloqueado. Fale com a organização do evento.") e a inscrição é
recusada **antes** de consumir vaga.

**Justificativa.** Se a criação viesse primeiro, a inscrição pública reverteria
silenciosamente uma suspensão: bastava se inscrever para voltar a ter acesso. É o tipo
de furo que não aparece em teste de caminho feliz — e por isso há teste para ele.

**Consequências.** A instituição ganha um controle efetivo sobre a porta pública; um
participante bloqueado recebe uma mensagem que explica o que fazer, em vez de um erro
genérico. Vínculos apagados (soft delete) contam como removidos — fail-closed.

### ADR-062 — O papel concedido é só `PARTICIPANT`, e só para quem não tem papel nenhum

**Contexto.** O sistema acumula papéis, e `PARTICIPANT` carrega `registration:create`,
`submission:create`, leituras `:own` e `tenant:read`.

**Decisão.** A concessão automática acontece **apenas** quando a pessoa não tem nenhum
papel vigente na instituição. Quem já tem papel (patrocinador, revisor, equipe) não
recebe nada — sua inscrição continua dependendo de `registration:create`.

**Justificativa.** Duas razões. Primeira: sem essa restrição, um patrocinador com
vínculo e sem permissão de inscrição ganharia a permissão "de brinde", e o E2E que
prova a fronteira "é membro ≠ pode agir" passaria a falhar — sinal de que a fronteira
havia sido apagada. Segunda: papel administrativo algum é concedido por inscrição; o
catálogo de `PARTICIPANT` não inclui `tenant:delete`, `tenant:member:remove`,
`tenant:role:assign`, `event:manage`, `certificate:issue` nem leitura `:any` — e o
teste de integração verifica exatamente essa lista negativa.

**Consequências.** Um membro que precise se inscrever e não tenha a permissão continua
dependendo da instituição — o que é o comportamento correto.

### ADR-063 — "Sem vínculo" e "bloqueado" são mensagens (e caminhos) diferentes

**Contexto.** A tela tratava qualquer pessoa sem vínculo ATIVO com o mesmo aviso:
"Sem vínculo com a instituição. Peça um convite à organização do evento."

**Decisão.** Dois ramos distintos na página: quem nunca teve vínculo vê o formulário
(com o aviso de que passará a ser participante); quem foi suspenso ou removido vê
"Acesso bloqueado".

**Justificativa.** Uma mensagem que serve para dois casos opostos — "se inscreva" e
"você não pode se inscrever" — garante que um deles estará errado. Além disso, dizer a
alguém banido que "peça um convite" é orientar a pessoa a tentar o caminho que a
instituição acabou de fechar.

**Consequências.** O visitante anônimo continua vendo "Entre para se inscrever" (o
convite a criar conta), e a ordem dos ramos na página passa a espelhar a ordem da regra
de domínio: bloqueio primeiro.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Um visitante via, na página pública, a linha `cap=150 conf=0 rem=150 full=false wl=false … mem=null can=false user=sim` | Diagnóstico temporário criado na depuração da FASE 3, marcado no código como "remover após depurar" e esquecido. Ele renderizava estado interno (lotação, janela, vínculo, permissão) para QUALQUER visitante | Diagnóstico movido para atributos `data-*` (que não renderizam); os testes E2E passaram a ler os atributos por `evaluate`, mantendo o poder de diagnóstico e tirando o dado interno da tela |
| 2 | **E2E:** duas instituições com o mesmo slug (`publica-<RUN>`) → `Unique constraint failed on tenants_slug_key` | Dois cenários da mesma suíte usavam o mesmo `label`, e o slug é derivado dele. O `RUN_ID` é igual para toda a execução | Rótulo novo e único por cenário (`publica-inscricao`). É a mesma armadilha documentada na FASE 8 — vale a pena reler antes de copiar um cenário |
| 3 | **Revisão:** a primeira versão do ramo público tratava `INVITED` como "sem vínculo" | O `findFirst` da página filtrava `deletedAt: null` e o código só testava `status !== 'ACTIVE'`, colapsando convite pendente, ausência de vínculo e vínculo removido na mesma caixa | A decisão foi extraída para o domínio (`evaluateParticipantLink`), com um caso por situação, e a página passou a ler o vínculo **sem** filtrar `deletedAt` — para distinguir "nunca teve" de "foi removido" |
| 4 | **Revisão:** a ação tratava "sem vínculo" como "não autenticado" e redirecionava ao login | `guard()` devolvia `null` para os dois casos, e a ação mandava ao `/login` — quem já estava logado e não tinha vínculo era convidado a entrar de novo, em laço | `guardSelfRegistration` separa os motivos (`NOT_AUTHENTICATED`, `TENANT_NOT_FOUND`, `FORBIDDEN`) do caminho público, e a ação decide por motivo |

---

## 6. Evidência de verificação

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 770 testes / 26 arquivos
npm run build                → "Compiled successfully"
npm run db:verify            → "Contrato íntegro."
npm run db:verify:isolation  → "9/9 verificações passaram."
npm run test:e2e             → 42 testes / 9 arquivos (56,7 s)
```

Testes específicos da fase:

```text
tests/unit/public-registration-rules.test.ts        16 testes
  ✓ decisão do vínculo (CREATE / ACTIVATE / ALREADY_MEMBER / BLOCKED)
  ✓ bloqueio tem precedência; soft delete é removido; evento não público é bloqueio
  ✓ concessão de papel só para quem não tem papel nenhum
  ✓ status desconhecido é tratado como não público (fail-closed)

tests/integration/public-registration.test.ts        9 testes
  ✓ cria vínculo ATIVO, concede PARTICIPANT e confirma a inscrição
  ✓ o papel concedido NÃO dá nenhuma permissão administrativa (lista negativa)
  ✓ registra o vínculo na trilha de auditoria da instituição
  ✓ a segunda inscrição não duplica vínculo nem papel
  ✓ convite PENDENTE é ativado pela inscrição
  ✓ vínculo SUSPENSO não se inscreve e não gera nada
  ✓ vínculo REMOVIDO (soft delete) não se inscreve nem é ressuscitado
  ✓ a recusa acontece ANTES de consumir vaga
  ✓ duas inscrições simultâneas da mesma pessoa nova não duplicam vínculo

tests/e2e/registration-journey.spec.ts (10 testes, os dois últimos da fase)
  ✓ visitante SEM vínculo se inscreve e passa a ser participante (FASE 10)
  ✓ vínculo SUSPENSO pela instituição continua bloqueado
```

O primeiro E2E é o que fecha o ciclo: ele **substitui** o cenário "usuário sem vínculo
ativo não consegue se inscrever", que até esta fase era a asserção correta — e que
agora descreveria o defeito.

---

## 7. Comandos operacionais

```bash
# Não há migração nesta fase. Basta reconstruir a aplicação:
docker compose --profile app up -d --build web

# Verificação
npx vitest run tests/unit/public-registration-rules.test.ts
npx vitest run tests/integration/public-registration.test.ts
npx playwright test tests/e2e/registration-journey.spec.ts
```

Percorrer o fluxo à mão:

```text
1. Crie uma conta nova em /signup (sem vínculo com ninguém).
2. Abra /t/ufba-demo/eventos/congresso-2026/atividades/minicurso-rust
   → o formulário aparece, com o aviso de vínculo de participante.
3. Confirme a inscrição.
4. Abra /t/ufba-demo/minhas-inscricoes → a inscrição está lá (o vínculo passou a existir).
5. Para testar o bloqueio: no banco, mude o vínculo para SUSPENDED e recarregue a
   atividade → "Acesso bloqueado", sem formulário.
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Dívida | Impacto | Encaminhamento sugerido |
|---|---|---|---|
| 1 | `Tenant.maxMembers` não é aplicado em nenhum caminho | A quota do plano é decorativa; com inscrição pública, o número de vínculos cresce sem limite e ninguém é avisado | Fase de billing/quotas: contar vínculos ativos e decidir o comportamento ao estourar (recusar inscrição? marcar como "participante externo"?) |
| 2 | Todo participante público entra na lista de membros da instituição | Instituições com muitos eventos acumulam milhares de vínculos, e a lista de membros deixa de ser "a equipe" | Campo/estado de vínculo para distinguir "participante de evento" de "membro da comunidade"; ou contagem de membros excluindo participantes sem papel administrativo |
| 3 | Não existe evento "restrito à comunidade" | Toda atividade de evento público aceita inscrição de fora; uma instituição que queira evento fechado não tem como marcar isso | Chave por evento (`settings.registrationRequiresMembership`), com o domínio já preparado: `evaluateParticipantLink` recebe `eventIsPublic` |
| 4 | A concessão de papel não é idempotente por índice único | Duas concessões simultâneas raríssimas poderiam criar duas linhas `PARTICIPANT` (a transação mitiga, mas não há índice) | Índice único parcial em `(tenantId, userId, role, scope)` para papéis vigentes |
| 5 | Sem e-mail de boas-vindas ao participante vinculado | A pessoa descobre que virou participante pela tela de confirmação, e nada mais | Fase de notificações |

---

## 9. Checklist de aceite

| Requisito | Situação |
|---|---|
| Inscrição em atividade de evento público não exige vínculo prévio | ✅ |
| Vínculo de participante criado na MESMA transação da inscrição | ✅ |
| Papel concedido é `PARTICIPANT`, escopo TENANT | ✅ |
| Papel **não** concede nenhuma permissão administrativa (verificado por lista negativa) | ✅ |
| Concessão não interfere no RBAC de quem já é membro | ✅ |
| Vínculo SUSPENDED/REMOVIDO (incluindo soft delete) bloqueia a inscrição | ✅ |
| Bloqueio acontece antes de consumir vaga | ✅ |
| Convite pendente (INVITED) é ativado pela inscrição | ✅ |
| Vínculo auditado na trilha da instituição (vínculo + mudança de permissão) | ✅ |
| Concorrência: duas inscrições simultâneas da mesma pessoa nova não duplicam vínculo | ✅ |
| Aviso ao participante de que a inscrição cria vínculo | ✅ |
| "Sem vínculo" e "acesso bloqueado" são mensagens distintas | ✅ |
| Diagnóstico interno removido da página pública | ✅ |
| Testes: 16 unitários + 9 de integração + 2 E2E (substituindo o que afirmava o antigo) | ✅ |
| Documentação da fase | ✅ |
| Sem migração (nenhuma mudança de schema) | ✅ |
