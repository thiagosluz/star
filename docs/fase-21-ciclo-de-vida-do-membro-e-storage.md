# FASE 21 — Ciclo de vida do membro e armazenamento

> **Estado:** entregue. A quota de armazenamento do plano passou a ser **aplicada** (com a
> medição de tudo o que a instituição ocupa) e a equipe ganhou **ciclo de vida pela
> interface** — trocar papéis e remover acesso, sem SQL, com as travas de segurança.
> Quita os itens **C4** e **C5** do levantamento.

---

## 1. Sumário executivo

| Entrega | Item | Arquivo-chave |
|---|---|---|
| Quota de armazenamento **medida** (quatro fontes) e **aplicada** nos três caminhos de upload | **C4** | `src/lib/storage/storage-quota.ts`, `evaluateStorageQuota` (`platform-rules.ts`) |
| Troca de **papéis** de escopo da instituição pela tela de equipe | **C5** | `src/lib/admin/member-service.ts`, `src/components/admin/member-actions.tsx` |
| **Remoção** de membro com revogação de todos os papéis e devolução da vaga | **C5** | `removeMember` + `removeMemberAction` |
| Painel com o uso de armazenamento e aviso de plano esgotado | **C4** | `(app)/administracao/page.tsx` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | 4 de produção/UI + 3 de teste |
| Arquivos alterados | 11 |
| Migrações | **0** — a quota já existia na coluna (`Tenant.maxStorageBytes`) e o ciclo de vida usa o que a FASE 2/14 criou |
| Permissões | 58 (nenhuma nova: `tenant:role:assign` e `tenant:member:remove` são da FASE 2 e **finalmente** têm tela) |
| Testes | **1381** (Vitest) · **85** (Playwright E2E) |
| Testes novos | 25 unitários + 18 de integração + 3 E2E = **46** |
| Dívidas quitadas | C4, C5 |
| Dívidas novas | C6 (reconciliação banco × bucket) e C7 (remover membro não preserva o acesso de participante) |

### O que mudou para quem opera

```text
Antes                                        Depois
─────────────────────────────────────────    ─────────────────────────────────────────────
quota de armazenamento era só um número      o upload é RECUSADO quando não cabe, com a
no painel de governança                      conta do que falta e o caminho (F21/C4)

trocar papel de alguém = SQL                 /administracao/equipe → "Papéis e acesso"
                                             (caixas por papel de instituição)

tirar o acesso de quem saiu = SQL            "Remover acesso" com diálogo que diz a
                                             consequência e devolve a vaga da quota
```

---

## 2. O problema mais difícil: **medir é fácil, decidir quando recusar é que não**

A quota de armazenamento parecia a mais simples das três: soma bytes, compara com o teto.
As decisões que a tornaram difícil foram outras três.

**1. O que conta.** Medir só o que a instituição *enviou* deixaria o número abaixo do real
— o teto do plano é sobre bytes guardados, não sobre bytes escolhidos. Então a conta inclui
**PDFs de submissão, acervo de mídia, materiais de palestrante e certificados emitidos**.

**2. O que o estouro bloqueia.** Aqui a resposta óbvia estava errada. Bloquear *todo*
caminho de escrita incluiria a **emissão de certificado** — e o certificado é a promessa do
produto: o documento do participante não pode ficar refém da decisão de armazenamento da
organização. A decisão entregue: a quota recusa **envios** (onde alguém escolhe adicionar
bytes) e **mede** os certificados (para o número ser honesto). Quando o certificado leva a
instituição acima do teto, o que acontece é o próximo envio ser recusado — que é o sinal
certo para a organização, não uma retenção de documento.

**3. Onde a verificação acontece.** Recusar **depois** do upload deixaria o arquivo no
bucket: pago, órfão e sem registro — a recusa viraria lixo. Como o tamanho já é declarado
pelo cliente para assinar a URL (`ContentLength`), a decisão acontece **antes** de assinar,
nos três caminhos (`requestUpload`, `requestAssetUpload`, `requestMaterialUpload`).

O caso especial que exigiu cuidado: em **rascunho**, o reenvio do PDF substitui o MESMO
objeto (a versão não incrementa). Sem descontar os bytes do arquivo anterior, trocar um PDF
de 5 MB por outro de 5 MB seria recusado numa instituição no limite — um falso negativo que
só apareceria no pior momento possível.

---

## 3. Entregas em detalhe

### 3.1 A medição (C4)

| Fonte | Coluna | O que é |
|---|---|---|
| `submission_files` | `sizeBytes` (`BigInt`) | PDFs cego e identificado dos trabalhos |
| `media_assets` | `sizeBytes` (`Int`, respeita `deletedAt`) | Capas, logotipos e galeria |
| `speaker_materials` | `sizeBytes` (`Int?`, respeita `deletedAt`) | Slides, apostilas e anexos |
| `certificates` | `sizeBytes` (`BigInt?`) | PDF/SVG emitidos (só os que têm arquivo) |

Quatro agregações em uma transação com contexto (`withTenant`), e o número sai do **banco**,
não de uma varredura do bucket: o certo é reconciliar o que existe sem registro, não somar
o que ninguém registrou (dívida C6).

### 3.2 A decisão (`evaluateStorageQuota`)

Recebe `currentBytes`, `incomingBytes` e `maxBytes` — o tamanho do arquivo entra na conta,
porque a pergunta é "cabe mais este?". `null` é ilimitado; `0` recusa qualquer byte; e
"cabe exatamente" é **permitido** (a instituição fica no limite, e o próximo byte não cabe).
A mensagem é acionável: diz o teto, o uso, o tamanho do arquivo e o que fazer.

### 3.3 O ciclo de vida do membro (C5)

**Trocar papéis** substitui o conjunto: concede o que falta e **revoga** o que sobra. A
revogação é `revokedAt` (nunca `DELETE`) — quem perdeu o acesso aparece no histórico, que é
exatamente o que uma investigação procura. Papel de **EVENTO** ou **ATIVIDADE** não é
tocado: quem é `STAFF` do dia continua sendo, mesmo que a equipe reescreva os papéis de
instituição.

**Remover** é remoção LÓGICA: o vínculo vira `REMOVED` + `deletedAt` (sai da lista e
**devolve a vaga** para a quota) e **todas** as concessões vigentes da instituição são
revogadas — inclusive as de evento e atividade, porque quem perdeu o acesso não pode
continuar credenciando um dia de evento.

Duas travas de segurança, ambas no domínio, com a contagem de proprietários lida **na mesma
transação**:

1. **ninguém remove a si mesmo** (a pessoa se trancaria fora);
2. **ninguém remove o último proprietário** (instituição sem dono não tem quem a administre,
   e o caminho de volta seria SQL).

### 3.4 A assimetria de permissões veio da FASE 2, e é mantida

| Ação | Permissão | Quem tem |
|---|---|---|
| Trocar papéis | `tenant:role:assign` | **OWNER** (o ADMIN não tem, desde a FASE 2, junto com excluir instituição e mexer em cobrança) |
| Remover acesso | `tenant:member:remove` | **OWNER e ADMIN** |

Não é descuido: promover alguém a ADMIN é mudar quem manda; tirar o acesso de quem saiu é
operação do dia. A tela mostra o que cada perfil pode e **cada ação reconfere** no servidor —
a página até explica, em texto, por que o editor de papéis não aparece para um ADMIN.

### 3.5 A consequência que a tela passou a dizer em voz alta

O vínculo é **uma linha por (instituição, pessoa)**. Remover alguém da equipe tira junto o
acesso de **participante**: quem tem inscrição em eventos deixa de ver as próprias inscrições
e certificados. Isso era um efeito silencioso e virou aviso no diálogo, com a **contagem de
inscrições** da pessoa (uma consulta agrupada a mais na tela de equipe):

> *Atenção: esta pessoa tem 3 inscrição(ões) em eventos desta instituição. Ela perde também o
> acesso à área de participante (as inscrições e os certificados continuam registrados na
> instituição).*

Preservar o acesso de participante exigiria separar as duas relações em duas linhas (ou uma
ação "rebaixar para participante") — decisão de modelo declarada como **dívida C7**.

---

## 4. ADRs

### ADR-131 — A quota de armazenamento mede tudo e bloqueia ENVIO, nunca a emissão de certificado

**Contexto.** `Tenant.maxStorageBytes` existia desde a FASE 14 e nunca era consultado. Havia
três caminhos de escrita que guardam bytes no bucket: submissão, imagem do evento e material
de palestrante — mais os certificados, que a plataforma gera sozinha.

**Decisão.** A medição soma as **quatro** fontes. O bloqueio vale para os **três caminhos de
upload**, decidido **antes** de assinar a URL. A emissão de certificado **não** é bloqueada.

**Alternativas descartadas.**
- *Medir só o que foi enviado*: o número ficaria abaixo do real — o teto é de bytes, não de
  escolhas — e a instituição descobriria o estouro pelo provedor.
- *Bloquear tudo, inclusive certificado*: o documento do participante ficaria refém da
  decisão de armazenamento de quem organiza. Reprovar o evento por causa disso é pior do que
  o excesso de bytes.
- *Recusar depois do upload*: o objeto ficaria no bucket, sem registro e sem dono — a recusa
  produziria lixo pago.

**Consequências.** A instituição acima do teto continua com tudo o que já existe (nada é
apagado nem escondido) e passa a ser recusada em envio novo, com a conta do que falta. O
número exibido é honesto e inclui o que a plataforma gerou. A assimetria "mede mas não
bloqueia" para certificados é **deliberada** e está escrita na tela do painel.

### ADR-132 — O plano da troca de papéis recebe o ESCOPO, não só o nome do papel

**Contexto.** `planRoleChange` nasceu recebendo `string[]` de nomes de papel. O teste
unitário reprovou o caso real: `REVIEWER` concedido por **EVENTO** tem o mesmo nome do papel
de instituição, e reescrever a equipe revogaria a avaliação de uma trilha — em silêncio,
porque para o domínio eram dois nomes iguais.

**Decisão.** A função recebe `RoleRef[]` (`{ role, scope }`). O que não é `scope = 'TENANT'`
fica fora do plano **por construção** — a chamada perigosa deixou de ser expressável.

**Alternativas descartadas.** *Documentar que o chamador deve filtrar*: a regra passaria a
depender de quem chama, e o defeito não apareceria em nenhum teste — foi exatamente o estado
em que o código estava.

**Consequências.** O serviço monta o contexto com as concessões vivas completas (e deriva
`tenantRoles` para a tela). Um teste de integração prende o caso: a equipe é reescrita e o
papel por evento continua vivo.

### ADR-133 — Remover membro é remoção LÓGICA, com os papéis revogados e a vaga devolvida

**Contexto.** `tenant:member:remove` existia desde a FASE 2 sem tela: reduzir a equipe (e
portanto a quota) era SQL. `DELETE` apagaria o rastro de que a pessoa já teve acesso.

**Decisão.** O vínculo vira `REMOVED` + `deletedAt` e **todas** as concessões vigentes da
instituição são revogadas (`revokedAt`), inclusive as de evento e atividade. A trilha de
auditoria registra a ação; readmitir é um convite novo.

**Alternativas descartadas.** *Apagar as linhas*: perderia a prova de acesso anterior e
quebraria a trilha (que aponta o `entityId`). *Recusar quando a pessoa tem inscrição em
evento*: bloquearia a remoção de quem se inscreveu num evento aberto — o caso mais comum —
sem resolver o problema real, que é a pessoa perder o acesso de participante (dívida C7).

**Consequências.** A vaga volta para a quota imediatamente (o contador ignora `REMOVED` e
`deletedAt`); o histórico permanece; e a tela **avisa** que a pessoa perde também a área de
participante quando tem inscrições, com a contagem.

---

## 5. Evidência de verificação

### 5.1 Bateria (árvore final)

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 57 arquivos, 1381 testes passando (+43 nesta fase)
npm run build                → Compiled successfully
npm run db:migrate:status    → 19 migrations found · Database schema is up to date!
npm run db:verify            → Contrato íntegro.
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:partitions        → partições do mês atual e dos seguintes em dia
npm run test:e2e             → 85 passed (82 anteriores + 3 desta fase)
```

A imagem usada pelo E2E foi **reconstruída** antes da suíte (`docker compose --profile app
up -d --build web worker`, exit 0): `eventflow/web:local` de 2026-09-19 10:51 e
`eventflow/worker:local` de 10:53; os contêineres subiram `healthy` e as rotas da fase
respondem **307** para anônimo (`/t/ufba-demo/administracao` e
`/t/ufba-demo/administracao/equipe`) — não 404, que é o sintoma da armadilha nº 3.

**Nenhuma migração nesta fase** — e isso é evidência, não omissão: a coluna
`Tenant.maxStorageBytes` foi criada na FASE 14, e o ciclo de vida do membro usa
`user_tenant_profiles.status/deletedAt` (FASE 1/14) e `role_assignments.revokedAt` (FASE 2,
com o índice parcial de concessão viva da FASE 12). A fase inteira cabia no modelo que já
existia — o que faltava era a decisão e a tela.

### 5.2 Testes novos

```text
Unitários (25) — tests/unit/member-lifecycle-and-storage.test.ts
✓ plano sem teto nunca recusa; "cabe exatamente" é permitido e um byte a mais não
✓ a recusa diz o teto, o uso e o tamanho do arquivo
✓ instituição JÁ acima do teto não recebe nem 1 KB (mensagem sem número negativo)
✓ situação exibida e decisão usam a MESMA aritmética (AT_LIMIT vs EXCEEDED)
✓ formatBytes fala a língua da quota (GB antes de MB)
✓ o plano concede o que falta, revoga o que sobra, ignora repetido e não escreve quando é igual
✓ papel de EVENTO não é tocado na reescrita (defeito real: nome igual, escopo diferente)
✓ SUPERADMIN e PARTICIPANT fora do editor de equipe, com motivos distintos
✓ retirar o papel do último proprietário é recusado; com dois, é permitido
✓ remover: recusa a si mesmo, recusa o último proprietário, aceita convite pendente
✓ a trava "é você mesmo" vem ANTES da de último proprietário (a mensagem certa)

Integração (18) — tests/integration/member-lifecycle.test.ts
✓ o uso soma as quatro fontes, respeita o teto e a exclusão de imagem sai da conta
✓ ensureStorageRoom recusa com QUOTA_EXCEEDED e explica
✓ submissão: nenhuma URL é assinada sem espaço
✓ imagem do evento: recusada antes de o navegador enviar qualquer byte (e permitida com espaço)
✓ material de palestrante: o caminho segue funcionando com espaço
✓ trocar papéis concede e revoga, com trilha de auditoria
✓ papel de EVENTO sobrevive à reescrita da equipe
✓ RECUSA retirar o papel do único proprietário; RECUSA papel de plataforma e de participante
✓ a lista da equipe informa as inscrições da pessoa (o aviso da remoção)
✓ remover: sai da equipe, perde TODOS os papéis, libera a vaga e registra auditoria
✓ vínculo removido não recebe papel nem é removido de novo
✓ com dois proprietários, um pode ser rebaixado e o outro permanece

E2E (3) — tests/e2e/member-lifecycle.spec.ts
✓ o proprietário troca papéis e remove o acesso, devolvendo a vaga (e a própria linha
  não oferece remover o próprio acesso)
✓ retirar o papel do único proprietário é explicado, e a seleção volta ao que está no banco
✓ sem espaço, o painel avisa e o envio de imagem é recusado sem entrar no acervo
```

---

## 6. Comandos operacionais

```bash
# Ver o uso de armazenamento de uma instituição (e o teto do plano)
docker exec eventflow-postgres psql -U eventflow_admin -d eventflow -c "
  SELECT t.slug, t.\"maxStorageBytes\",
         (SELECT COALESCE(SUM(f.\"sizeBytes\"),0) FROM submission_files f WHERE f.\"tenantId\" = t.id) AS submissoes,
         (SELECT COALESCE(SUM(m.\"sizeBytes\"),0) FROM media_assets m WHERE m.\"tenantId\" = t.id AND m.\"deletedAt\" IS NULL) AS midia,
         (SELECT COALESCE(SUM(s.\"sizeBytes\"),0) FROM speaker_materials s WHERE s.\"tenantId\" = t.id AND s.\"deletedAt\" IS NULL) AS materiais,
         (SELECT COALESCE(SUM(c.\"sizeBytes\"),0) FROM certificates c WHERE c.\"tenantId\" = t.id AND c.\"storageKey\" IS NOT NULL) AS certificados
  FROM tenants t ORDER BY t.slug;"

# Ajustar a quota (a plataforma faz isso pela tela "Plano e quotas")
#   /superadmin/tenants/<id>

# Ver quem foi removido da equipe e com que papéis (histórico, não exclusão)
docker exec eventflow-postgres psql -U eventflow_admin -d eventflow -c "
  SELECT p.\"tenantId\", u.email, p.status, p.\"deletedAt\"
  FROM user_tenant_profiles p JOIN \"user\" u ON u.id = p.\"userId\"
  WHERE p.kind = 'MEMBER' AND p.status = 'REMOVED';"
```

---

## 7. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 27 | Teste unitário reprovou: reescrever os papéis da equipe revogava um papel de **EVENTO** | `planRoleChange` recebia `string[]` de **nomes**, e `REVIEWER` de uma trilha tem o mesmo nome do papel de instituição. A informação que distinguia os dois (o escopo) não chegava à função — o defeito era invisível para o domínio, e nenhum outro teste olhava para ele | A função passou a receber `RoleRef[]` (`{ role, scope }`): o que não é `TENANT` fica fora do plano **por construção**, e a chamada perigosa não é mais expressável (ADR-132, armadilha 52) |
| 28 | E2E reprovou esperando o texto "não tem mais acesso" depois de remover um membro — e a remoção **tinha** funcionado (o membro sumiu da lista) | A confirmação vivia DENTRO da linha do membro; quando o vínculo é removido, a linha sai da lista e o elemento de feedback é desmontado junto. Esperar por ele é esperar por algo que o próprio fluxo apaga — a mesma classe da lição da FASE 4 | A sincronização passou a ser o efeito no DADO: `toHaveCount(0)` na linha + a contagem da quota caindo. O texto de sucesso não é sinal durável quando o elemento que o mostra desaparece |
| 29 | `tx.mediaAsset.create` e `tx.speakerMaterial.create` falharam nas fixtures por campos obrigatórios (`bucket`, `objectKey`) e argumento inexistente (`eventId`) | Os modelos da FASE 24/FASE 25 têm campos próprios (a mídia guarda `bucket`; o material guarda `storageKey` + `storageBucket` e **não** tem `eventId` — o evento vem da atividade) | As fixtures foram corrigidas pelo schema, e a lição que fica: **antes de escrever fixture de tabela que não é sua, leia o modelo** — o serviço de produção esconde esses campos, e o teste direto no Prisma não |
| 30 | O teste de integração esperava `EXCEEDED` para uma instituição com teto `0` e uso `0`, e recebeu `AT_LIMIT` | Zero usado com teto zero é **no limite**, não acima: `EXCEEDED` exige ultrapassar. As duas situações recusam o envio, mas não são o mesmo estado — e o teste estava afirmando o estado errado | A asserção passou a `AT_LIMIT` com o comentário da diferença; a decisão de envio continua recusando qualquer byte (o teste vizinho prende isso) |

---

## 8. Dívidas técnicas e pontos de atenção

**Novas (entram no levantamento):**

| # | Item | O que falta | Impacto |
|---|---|---|---|
| C6 | **Reconciliação entre banco e bucket** | A quota mede o BANCO: um objeto que ficou no bucket sem registro (falha no meio do upload) não conta, e excluir o registro não apaga o objeto — a limpeza do bucket é manual | O uso medido pode divergir do uso real; sem varredura, a diferença só aparece na conta do provedor |
| C7 | **Remover membro não preserva o acesso de participante** | O vínculo é UMA linha por (instituição, pessoa): remover a equipe tira junto a área de participante (as inscrições continuam registradas). Falta a ação "rebaixar para participante" (ou separar as duas relações em duas linhas) | Quem era equipe e público perde o acesso às próprias inscrições e certificados — hoje **avisado** no diálogo, mas sem alternativa |

**Pontos de atenção para quem for mexer:**

1. **A quota recusa ANTES de assinar a URL.** Se um caminho novo de upload nascer sem
   `ensureStorageRoom`, ele fura a quota em silêncio — os três caminhos existentes estão
   cobertos por teste de integração.
2. **`incomingBytes` desconta o que está sendo substituído** quando o objeto é o mesmo
   (rascunho). Caminho novo com sobrescrita precisa passar `replacingBytes`.
3. **Medir e bloquear são coisas diferentes aqui.** Certificado entra na conta e não é
   bloqueado de propósito (ADR-131): antes de "consertar" isso, leia o porquê.
4. **O domínio recebe `RoleRef`, não nome de papel** (ADR-132). Encurtar a assinatura
   reintroduz o defeito que o teste pegou.
5. **Remover é lógico e a vaga volta.** Quem for reconciliação de dados precisa lembrar que
   `status = 'REMOVED'` é gente que já teve acesso — e não lixo.

---

## 9. Checklist de aceite

- [x] **C4** — o uso de armazenamento soma submissões, mídia, materiais e certificados
- [x] **C4** — o envio é recusado quando não cabe, antes de assinar a URL, nos três caminhos
- [x] **C4** — a decisão considera o tamanho do arquivo e desconta a substituição do mesmo objeto
- [x] **C4** — o painel mostra o uso por origem e avisa quando o plano está esgotado
- [x] **C4** — a emissão de certificado **não** é bloqueada pela quota (decisão registrada)
- [x] **C5** — trocar papéis de instituição pela tela, com concessão e revogação auditadas
- [x] **C5** — papel de evento/atividade não é tocado pela tela de equipe
- [x] **C5** — remover membro: remoção lógica, papéis revogados, vaga devolvida, auditoria
- [x] **C5** — não é possível remover a si mesmo nem o último proprietário (com motivo escrito)
- [x] **C5** — a tela avisa a perda do acesso de participante, com a contagem de inscrições
- [x] RBAC respeitado: `tenant:role:assign` (OWNER) e `tenant:member:remove` (OWNER/ADMIN)
- [x] Testes: 25 unitários, 18 de integração, 3 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 5
- [x] `README.md`, `AGENTS.md` e `docs/dividas-tecnicas.md` atualizados

---

Aguardando **"APROVADO: AVANÇAR"**.
