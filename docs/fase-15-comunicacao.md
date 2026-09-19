# FASE 15 — Comunicação (e-mail transacional com Resend)

> **Estado:** entregue. E-mail transacional com fila e outbox, convite de equipe pela
> interface, verificação de e-mail e as quatro notificações que faltavam (avaliação
> atribuída, prazo de parecer, carta conquistada e certificado emitido).
> **Envio real verificado contra a conta de teste do Resend** (§5).

---

## 1. Sumário executivo

| Entrega | Item do levantamento | Arquivo-chave |
|---|---|---|
| E-mail transacional com fila, outbox e dois drivers (`resend`/`log`) | **D1** | `src/lib/communication/mailer.ts`, `email-queue.ts`, `email-service.ts` |
| Convite de equipe pela interface, com aceite e quota no aceite | **D2** | `src/lib/communication/invitation-service.ts`, `(app)/administracao/equipe/page.tsx` |
| Aviso de avaliação atribuída | **D3** | `notifyReviewAssigned` (chamada em `review-service.assignReviewer`) |
| Lembrete e vencimento de prazo de parecer | **D4** | `src/lib/communication/reminder-service.ts` + job repetível |
| Aviso de carta conquistada | **D5** | `notifyCardGranted` (chamada em `reward-engine.grantCardForTrigger`) |
| Aviso de certificado emitido | **D6** | `notifyCertificateIssued` (chamada em `certificate-service.generateCertificate`) |
| Verificação de e-mail **sem bloquear** o login | **A5** | `auth.ts` (`emailVerification` + `sendOnSignUp`) |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | 20 (7 de produção, 7 de UI/actions, 6 de teste) |
| Arquivos alterados | 14 |
| Migrações | 1 (`20260920140000_phase15_communication_email_and_invites`) — total do projeto: **19** |
| Tabelas novas | 2 (`email_messages`, `tenant_invitations`), ambas sob RLS + FORCE |
| Enums novos | 2 (`EmailStatus`, `InvitationStatus`) |
| Templates de e-mail | 8 |
| Permissões | 57 → **58** (`communication:read`), 11 papéis, 4 escopos |
| Testes | **1338** (Vitest: unit + integração) · **82** (Playwright E2E) |
| Testes novos | 36 unitários + 19 de integração + 3 E2E = **58** |
| Dependência nova | `resend@6.28.1` (SDK oficial; 2 dependências pequenas) |
| Dívidas quitadas | D1, D2, D3, D4, D5, D6, A5 |
| Dívidas novas | D7 (sem domínio verificado), D8 (sem webhooks de entrega), D9 (sem preferências/opt-out) |

### O caminho do e-mail

```text
ação/fato  →  queueEmail()            →  linha em email_messages (QUEUED)      ┐
              ├─ render (domínio puro)  • assunto, HTML e TEXTO gravados      │ outbox
              ├─ insert (withTenant | platform-mail)                          ┘
              └─ enqueueEmailDelivery()  →  fila `emails` (BullMQ)
                                              │
                       worker  →  deliverEmail()  →  driver resend | log
                                              │
                                    email_messages (SENT | FAILED + motivo)
```

---

## 2. O problema mais difícil da fase: **um e-mail enviado é irreversível**

Toda a decisão de desenho desta fase vem de uma assimetria: **não existe `rollback`
para mensagem entregue**. Gravar errado no banco corrige-se com uma migração; um
e-mail para 300 participantes com o link errado, não. Três consequências diretas:

1. **O padrão é NÃO enviar.** O driver só é `resend` quando alguém declarou
   `EMAIL_DRIVER=resend` (ou está em produção com a chave presente). Em qualquer outro
   caso o driver é `log`: a mensagem existe, fica registrada e legível na caixa de
   saída — e não sai da máquina. Um ambiente mal configurado não manda e-mail para
   endereço de pessoa de verdade.
2. **A falha de envio não derruba nada.** Nenhuma função de notificação lança: elas
   devolvem aviso ou engolem o erro no log. A carta já é da pessoa, o certificado já
   está no storage, a avaliação já foi atribuída — comunicação é consequência do fato,
   não pré-requisito dele (invariante nº 8, a mesma regra da gamificação).
3. **O registro é o que saiu.** O HTML e o texto são renderizados no ENFILEIRAMENTO e
   gravados na linha. Renderizar na entrega faria uma correção de template reescrever o
   passado, e a pergunta "o que essa pessoa recebeu?" deixaria de ter resposta.

O segundo problema difícil é o **convite para quem ainda não tem conta**, e ele define
o modelo de dados (§4, ADR-127).

---

## 3. Entregas em detalhe

### 3.1 Outbox (`email_messages`)

Cada mensagem nasce como linha, **antes** do envio:

| Coluna | Por quê |
|---|---|
| `tenantId` (nulo = plataforma) | Mensagem de identidade (verificação, senha) não pertence a instituição. A policy de RLS **sozinha** a esconde de toda instituição — nenhuma instituição vê recado que não é dela |
| `template` + `payload` | Reconstruir a mensagem sem depender do HTML, e auditar o que foi dito |
| `subject`/`html`/`text` | O que **realmente saiu** (ver §2.3) |
| `status` | `QUEUED` → `SENT` \| `FAILED` \| `SKIPPED` |
| `dedupeKey` (único) | O mesmo FATO não vira duas mensagens, nem com dois cliques ou retry do job |
| `driver`/`providerId`/`error`/`attempts` | Diagnóstico: por qual driver saiu, qual id o provedor devolveu, por que falhou e quantas tentativas |

### 3.2 Entrega: fila opcional, e-mail não

O envio passa por uma fila `emails` (BullMQ) com **5 tentativas e backoff exponencial**
— provedor de e-mail tem limite de taxa, e insistir rápido piora. Se o Redis estiver
fora, `enqueueEmailDelivery` devolve `false` e o chamador entrega **na hora**, no
próprio processo: indisponibilidade de infraestrutura não vira indisponibilidade de
produto (mesma decisão da fila de certificados, FASE 6).

Falha **transitória** (rede, 429, 5xx) volta para a fila e a linha permanece `QUEUED`
com o motivo gravado — marcar `FAILED` diria "desisti" enquanto o BullMQ ainda ia
tentar. Falha **definitiva** (chave inválida, remetente não verificado, endereço
recusado) vira `FAILED` e **não** é retentada: insistir só gasta cota e polui o log.

### 3.3 Templates (8)

`EMAIL_VERIFICATION`, `PASSWORD_RESET`, `MEMBER_INVITATION`, `REVIEW_ASSIGNED`,
`REVIEW_DUE_SOON`, `REVIEW_OVERDUE`, `CARD_GRANTED`, `CERTIFICATE_ISSUED`.

São **funções puras** `(payload) => { subject, html, text }` no domínio
(`src/domain/communication/email-templates.ts`): testáveis sem rede, sem renderizador e
sem banco, e determinísticas — o mesmo payload produz sempre o mesmo HTML, que é o que
permite gravá-lo como registro do envio. O payload carrega **strings já formatadas**
(data no fuso do evento, rótulo em português): o template monta, não decide regra.

O layout usa tabela com estilo embutido, porque cliente de e-mail não resolve variável
CSS. Como isso exige valor literal de cor, a paleta vive em **um** lugar
(`email-theme.ts`) e um teste lê o `globals.css` e falha se algum valor divergir do
token — a marca continua tendo uma fonte da verdade (§7, lição 21).

### 3.4 Convite de equipe (D2)

A FASE 14 tinha deixado escrito, na tela de equipe, que convidar quem não tem conta
"é o desenho da fase de Comunicação". O desenho entregue:

```text
instituição  →  /administracao/equipe  →  e-mail + papel + recado
                                            │
                    tenant_invitations (PENDING, token só como SHA-256, 7 dias)
                                            │
                    e-mail com /t/<slug>/convite?codigo=<token>
                                            │
convidado    →  entra (ou cria a conta) com O ENDEREÇO CONVIDADO
             →  aceita  →  vínculo MEMBER + papel TENANT + quota conferida
```

- **Convite ≠ vínculo.** Enquanto `PENDING`, não ocupa vaga na quota de membros e não
  cria conta nenhuma. A quota é aplicada no **aceite** — o mesmo critério do painel de
  governança (`MEMBER` ativo ou convidado).
- **O endereço é a prova de posse.** Aceitar com outra conta é recusa, e a ordem das
  recusas importa: endereço errado é respondido **antes** de "já é membro", para que
  ninguém descubra o estado do vínculo de outra pessoa por uma mensagem mais específica.
- **Um convite pendente por endereço**, garantido por índice único **parcial**
  (`WHERE status = 'PENDING'`): o mesmo endereço pode ter convites antigos aceitos ou
  revogados, e reconvidar quem saiu precisa continuar possível. Regerar **revoga** o
  anterior na mesma transação — é o que mantém o índice satisfeito.
- **O código aparece uma vez** (o banco guarda o hash, ADR-114 estendido). "Reenviar"
  é **gerar outro** e mostrar o novo link: o antigo deixa de funcionar.
- **Papéis convidáveis**: todos os de equipe, menos `OWNER` (propriedade se transfere,
  não se convida), `SUPERADMIN` (papel de plataforma) e `PARTICIPANT` (é o público do
  evento, não a equipe — a distinção que a FASE 14 criou).

### 3.5 Verificação de e-mail (A5) **sem** bloquear login

`sendOnSignUp: true` faz o cadastro já disparar a confirmação; o token vale 24 h (o
padrão da biblioteca é 1 h — curto demais para um e-mail que chega no meio de uma
aula). A página `/verificacao` é o destino do link nas duas situações: confirmado e
"o link não valeu" (o parâmetro `error` vem do próprio Better Auth).

`requireEmailVerification: false` é **decisão consciente** e está travada por teste
(`certification`/`communication.test.ts`): ligar o bloqueio trancaria fora toda conta
existente — inclusive as 16 de teste —, porque `emailVerified` nasce falso e ninguém foi
convidado a confirmar. O que a plataforma faz: envia, avisa no shell (todas as telas da
instituição) e permite reenviar. Sem aviso, quem cria a conta entra direto e nunca
confirma.

### 3.6 As quatro notificações

| Item | Gatilho | Onde é disparada | Idempotência |
|---|---|---|---|
| D3 | avaliação atribuída | `assignReviewer`, **depois do commit** | `review-assigned:<assignmentId>` |
| D4 | prazo próximo / vencido | job repetível `review-deadlines` (6/6 h) | `review-due:<id>:<AAAA-MM-DD>` |
| D5 | carta conquistada | `grantCardForTrigger`, depois do commit | `card-granted:<tenant>:<user>:<evento>:<carta>` |
| D6 | certificado emitido | `generateCertificate`, depois do commit | `certificate-issued:<certificateId>` |

Dois detalhes que valem o registro:

- **O aviso sai DEPOIS do commit** (armadilha 41): a notificação abre a própria
  transação, e chamá-la de dentro da transação que cria o fato faria a leitura não
  enxergar o que ainda não foi confirmado.
- **D5 filtra a duplicata.** Sortear de novo a carta que já está no álbum aumenta a
  quantidade e **não** é conquista: anunciar "você conquistou" seria mentira.

### 3.7 A varredura de prazos percorre instituição por instituição

A tentação era uma consulta só, com a conexão administrativa, buscando "todas as
avaliações a vencer". Funcionaria — e abriria mão do isolamento no caminho de um job
automático, que é justamente onde ninguém está olhando. O desenho entregue: a lista de
**instituições** é lida pela role de runtime (a policy de `tenants` permite, porque a
resolução de slug precisa dela) e cada instituição é varrida **numa transação com
contexto**. Nenhuma linha de dado de instituição é lida sem contexto de instituição —
nem por um job. Uma instituição com problema não interrompe as outras.

---

## 4. ADRs

### ADR-127 — O convite de equipe vive em tabela própria, e o vínculo nasce no aceite

**Contexto.** A instituição precisa trazer a própria equipe, e o convidado normalmente
**ainda não tem conta**. `user_tenant_profiles` exige `userId`, então "convidar" não
cabia no vínculo.

**Decisão.** Tabela `tenant_invitations` (instituição, e-mail, papel, token em hash,
validade, quem convidou) e vínculo criado **no aceite**, quando a pessoa entra com a
conta daquele endereço.

**Alternativas descartadas.**
- *Criar a conta-fantasma no ato do convite*: ocuparia vaga na quota por alguém que
  talvez nunca aceite, e deixaria usuários sem senha circulando na base.
- *Reusar `user_tenant_profiles` com colunas de token*: só funcionaria para quem já tem
  conta — exatamente o caso que o pedido não cobre.
- *Convidar `OWNER`*: quem aceitasse poderia remover quem convidou. Propriedade se
  transfere, não se convida.

**Consequências.** Convite pendente não consome quota (bom) e a instituição pode ter
vários convites abertos sem efeito no plano (bom); em troca, aceitar exige uma segunda
etapa e a tela precisa mostrar convite pendente, vencido e aceito como estados
distintos. O token em hash significa que o link **não** pode ser reexibido: reenviar é
gerar outro.

### ADR-128 — O driver de e-mail é escolhido com o padrão em NÃO enviar

**Contexto.** Um sistema mal configurado que envia é pior do que um que não envia:
mensagem real para pessoa real, sem ninguém esperando por ela e sem como desfazer.

**Decisão.** `resolveEmailDriver`: (1) `EMAIL_DRIVER` explícito manda; (2) sem ele, só
`resend` em produção **e** com `RESEND_API_KEY`; (3) em qualquer outro caso, `log` —
grava no outbox e não sai da máquina. `EMAIL_DRIVER=resend` **sem** chave não cai para
`log`: falha com `EMAIL_NOT_CONFIGURED` gravado na linha, porque cair para `log` em
silêncio faria o operador acreditar que os e-mails estão saindo.

**Alternativas descartadas.** *Enviar sempre que houver chave* (dev passaria a mandar
e-mail real para endereço de teste); *exigir configuração e recusar a operação sem
provedor* (a funcionalidade ficaria indisponível por falta de credencial, e o produto
tem um modo de operação legítimo sem envio externo).

**Consequências.** A caixa de saída mostra o aviso "envio real desligado" quando o
driver é `log`, e as mensagens ficam legíveis — é o que permite desenvolver, testar e
demonstrar o fluxo inteiro sem provedor. O teste de integração **força** o driver para
`log`, para que uma chave real no `.env` de quem desenvolve nunca dispare e-mail de
teste.

### ADR-129 — Onde a notificação mora: no ponto único que já conhece o fato

**Contexto.** D5 (carta concedida) tem quatro chamadores; D6 (certificado) tem dois
caminhos (inline e worker); D3 tem um.

**Decisão.** Disparar no **ponto mais baixo que já conhece o fato e é comum a todos os
chamadores**: `grantCardForTrigger` (motor de recompensas), `generateCertificate`
(certificado) e `assignReviewer` (atribuição) — sempre **fora** da transação, nunca em
cada tela. Quem escreve uma tela nova que concede carta ganha o aviso sem saber que ele
existe.

**Alternativas descartadas.** *Disparar nas Server Actions*: a segunda tela que
concedesse carta esqueceria o aviso; e o caminho do worker (certificado) não passa por
action nenhuma.

**Consequências.** Os serviços de domínio-adjacente ficaram com uma dependência de
comunicação (import de `notification-service`). Aceito de propósito: é a única forma de
o aviso ser consequência do fato, e não da tela por onde ele entrou.

### ADR-130 — `communication:read` é permissão nova, e a caixa de saída é da instituição

**Contexto.** O outbox mostra assunto, endereço (mascarado) e o texto do que saiu.

**Decisão.** Permissão própria (`communication:read`), concedida a quem administra e
opera a instituição (OWNER/ADMIN por derivação do catálogo, ORGANIZER explicitamente).
Não `tenant:read` — esse é do PARTICIPANT (armadilha 24) e entregaria a comunicação
inteira ao público de qualquer evento aberto.

**Consequências.** 58 permissões; o item de menu "Comunicação" e a página usam a MESMA
permissão e o mesmo predicado (armadilha 44).

---

## 5. Evidência de verificação

### 5.1 Bateria (árvore final)

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 55 arquivos, 1338 testes passando (+55 nesta fase)
npm run build                → Compiled successfully (rotas /t/[tenantSlug]/convite,
                               /t/[tenantSlug]/administracao/comunicacao e /verificacao listadas)
npm run db:migrate:status    → 19 migrations found · Database schema is up to date!
npm run db:verify            → Contrato íntegro.
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:partitions        → partições de set/out/nov já existem
npm run test:e2e             → 82 passed (79 anteriores + 3 desta fase)
```

### 5.2 Testes novos

```text
Unitários (36) — tests/unit/email-communication.test.ts
✓ todo template do catálogo renderiza assunto, HTML e texto, sem placeholder
✓ marcação não escapa como texto (defeito real: o negrito saía visível) e o negrito sai como tag
✓ texto de usuário entra ESCAPADO (título com <img onerror> não vira HTML)
✓ a paleta do e-mail espelha o globals.css, token por token
✓ driver: explícito manda; produção sem chave NÃO envia; valor desconhecido não vira envio
✓ retentativa: 429/5xx/timeout sim; 403/422 (chave, domínio) não
✓ máscara, normalização e plausibilidade de endereço
✓ convite: estado derivado do relógio, aceite com endereço errado recusado ANTES de já-membro
✓ papéis convidáveis excluem OWNER, SUPERADMIN e PARTICIPANT
✓ remetente de teste do Resend reconhecido

Integração (19) — tests/integration/communication.test.ts
✓ registra a mensagem ANTES de enviar, guarda o HTML e a fila ACEITA o job
✓ o mesmo fato não gera duas mensagens (dedupeKey é índice único)
✓ RECUSA endereço implausível sem criar linha
✓ caixa de saída resume por situação e filtra
✓ reenviar só alcança o que falhou ou está na fila
✓ mensagem de PLATAFORMA é invisível para qualquer instituição (RLS)
✓ a decisão de não bloquear login sem verificação está travada por teste
✓ convite: pendente sem vínculo; aceite cria MEMBER + papel TENANT; endereço errado recusado;
  regerar invalida o anterior; cancelar impede o aceite; quota aplicada no ACEITE;
  um único PENDENTE por endereço
✓ D3, D4 (com idempotência por dia), D5 e D6 gravam a mensagem certa para a pessoa certa
✓ uma instituição não enxerga o outbox nem os convites da outra

E2E (3) — tests/e2e/communication.spec.ts
✓ convida, o convidado aceita e passa a ser membro da equipe (link mostrado uma vez,
  caixa de saída com endereço mascarado, aceite leva ao painel)
✓ cancelar um convite pendente usa o diálogo do sistema
✓ o shell avisa que o e-mail não está confirmado e permite reenviar
```

### 5.3 Envio real pelo Resend (conta de teste, sem domínio verificado)

Executado à mão contra a conta de teste do provedor, com o worker parado para não haver
corrida (o container usa o driver `log`). Saiu da árvore depois da verificação
(script temporário).

```text
remetente: EventFlow <onboarding@resend.dev>

1) para o dono da conta (filhodaluz8@gmail.com)
   ok=true driver=resend providerId=01a0b971-aedd-7471-8594-56ac3f454d0a

2) para terceiro (destinatario.qualquer@exemplo.test)
   ok=false driver=resend code=PROVIDER_REJECTED retryable=false
   motivo: validation_error: You can only send testing emails to your own email address
           (filhodaluz8@gmail.com). To send emails to other recipients, please verify a
           domain at resend.com/domains...

3) outbox → entrega (a mesma esteira da aplicação)
   emailMessageId=869632e9-... queued=true
   entrega: ok=true status=SENT driver=resend
   banco: status=SENT driver=resend providerId=01a0b971-b327-72c2-a4c7-bada2d0951e1 tentativas=1 erro=—
```

**Leitura do resultado:** o caminho real funciona (a mensagem 1 e a 3 foram aceitas
pelo Resend e têm id de provedor), e a recusa do modo de teste é classificada como
**definitiva** — nada de retentar cinco vezes o que só se resolve verificando domínio.
O motivo que o provedor devolveu fica gravado na linha e aparece na caixa de saída.

### 5.4 Como ligar o envio real hoje

```bash
# 1. no .env (ou exportado no shell)
EMAIL_DRIVER=resend
RESEND_API_KEY=re_...
EMAIL_FROM="EventFlow <onboarding@resend.dev>"

# 2. o container lê o .env do compose; recrie web E worker
docker compose --profile app up -d --force-recreate web worker
```

**A conta do Resend ainda não tem domínio verificado** (conta de teste, dona
`filhodaluz8@gmail.com`), então: o remetente tem de ser `onboarding@resend.dev` e **só
o endereço dono da conta recebe**. Para enviar a qualquer destinatário, verifique um
domínio em resend.com/domains e troque `EMAIL_FROM` (dívida **D7**).

> **Armadilha:** variável **já exportada no shell vence o `.env`** — `dotenv` não
> sobrescreve. Foi o que fez a primeira tentativa de envio real falhar com "the
> eventflow.test domain is not verified" mesmo com o `.env` correto (armadilha 50).

---

## 6. Comandos operacionais

```bash
# Aplicar a migração e a RLS (o contrato descobre as tabelas por introspecção)
npm run db:migrate:deploy     # migrate deploy + generate + rls
npm run db:verify             # contrato íntegro (email_messages e tenant_invitations entram sozinhos)

# Ver a fila e o outbox
docker compose logs -f worker            # entregas, varredura de prazos, falhas
docker exec eventflow-postgres psql -U eventflow_admin -d eventflow -c \
  'SELECT status, driver, count(*) FROM email_messages GROUP BY 1,2 ORDER BY 1;'

# Forçar a varredura de prazos agora (não espere as 6 h)
docker exec eventflow-redis redis-cli KEYS 'bull:emails:*' | head
# ou, em desenvolvimento, chame runReviewDeadlineScan() de um script tsx

# Reagendar/limpar o agendador da varredura
docker exec eventflow-redis redis-cli DEL bull:emails:repeat:review-deadlines-scheduler
```

---

## 7. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 21 | Teste (correto) reprovou o e-mail: o cliente mostraria `<strong style="color:#181c24">` como TEXTO no meio da frase | Cinco templates montavam `strong(...)` **dentro** de `paragraph(...)`, que escapa o que recebe. O HTML era válido — o texto é que ficava feio, e nada quebraria sem uma trava olhando para isso | `markup()` para o parágrafo que já contém marcação, e um teste que varre TODOS os templates procurando marcação escapada (`&lt;strong`, `&lt;p `, `&lt;a `) |
| 22 | `queueEmail` devolvia `queued: false` e o envio caía no caminho inline **em silêncio**; o teste de integração esperava `QUEUED` e recebeu `SENT` | O `jobId` era `email:<uuid>`, e o BullMQ **recusa** id customizado com `:` (é o separador de chave no Redis: `add` lança "Custom Id cannot contain :"). O `catch` do enqueue trata isso como "fila indisponível" e degrada para inline — funcionando, devagar e sem aviso | Separador hífen (`email-<uuid>`) e uma asserção `queued === true` no teste de integração, que é a trava contra a volta do defeito |
| 23 | O MESMO defeito existia na fila de **certificados** desde a FASE 6: `certificate:<uuid>` nunca enfileirou — a emissão sempre rodou inline, e o E2E que documenta "o worker gera o arquivo" passava porque inline também emite | Mesma causa da lição 22, encontrada ao consertar a fila de e-mails. **Corrigido aqui** (`certificate-<uuid>`) e o teste de integração de certificação passou a simular o worker (geração explícita quando `generated === false`), porque numa suíte não há worker para consumir a fila | Fila corrigida + teste adaptado; o E2E roda com o worker no ar e exercita o caminho real |
| 24 | E2E `auth-tenancy` reprovou ao clicar no menu de troca de instituição: "element is outside of the viewport", 116 tentativas | O painel do seletor abre para BAIXO (`mt-2`) a partir do ÚLTIMO elemento de uma barra lateral de altura total — em 720 px de altura ele nasce fora da tela. O item de menu novo ("Comunicação") tornou o caso reprodutível | Painel abre para CIMA (`bottom-full mb-2`) e `min-h-0` no contêiner rolável da navegação, para que um item a mais não empurre o rodapé da conta para fora da tela |
| 25 | O primeiro teste de envio real falhou com "the eventflow.test domain is not verified" mesmo com o `.env` apontando para `onboarding@resend.dev` | **Variável já exportada no shell vence o `.env`** — `dotenv` não sobrescreve o que já existe no ambiente. O valor antigo estava no processo | Documentado como armadilha 50. A verificação roda com o valor explícito (`$env:EMAIL_FROM=...`), e é a mesma pegadinha que faria alguém jurar que "o `.env` não está sendo lido" |
| 26 | O job de entrega de um tenant já removido registrou `warn: Mensagem não encontrada no outbox` | O job é durável e sobrevive ao dado: a instituição foi apagada (cascade), a linha sumiu e o worker ainda tinha o job enfileirado de uma execução anterior | Comportamento correto e mantido: a falha é **definitiva** (sem retry), o job conclui e o log diz exatamente o que aconteceu. Fila que insiste em dado inexistente é a que trava operação |

---

## 8. Dívidas técnicas e pontos de atenção

**Novas (entram no levantamento):**

| # | Item | O que falta | Impacto |
|---|---|---|---|
| D7 | **Domínio de envio não verificado** | A conta do Resend é de teste: remetente obrigatório `onboarding@resend.dev` e entrega **só** para o endereço dono da conta | Convite e demais avisos só chegam a um endereço até alguém verificar um domínio (`resend.com/domains`) |
| D8 | **Sem webhooks de entrega** | O status é "aceito pelo provedor" (`SENT`), não "entregue na caixa": não há webhook de `delivered`/`bounced`/`complained` | Mensagem aceita e não entregue só aparece se alguém olhar o painel do provedor |
| D9 | **Sem preferências nem opt-out** | Todos os avisos são transacionais e não há central de preferências; a celebração de carta não pode ser desligada | Quem não quiser a celebração não tem como desligá-la |

**Herdadas que esta fase reduziu:** E25 (convite de palestrante por e-mail) e E28
(convite em lote) agora têm a esteira pronta — falta ligá-las ao template, o que
pertence à **F27**; **E30** (o convite que se apoia em endereço não verificado) ganhou
a verificação de e-mail como caminho de confirmação, mas continua aberta enquanto o
bloqueio não existir.

**Pontos de atenção para quem for mexer:**

1. **Nunca ligue `requireEmailVerification`** sem antes avisar os usuários existentes,
   dar prazo e oferecer caminho de recuperação: hoje isso tranca toda conta sem
   confirmação (há teste prendendo a decisão).
2. **`dedupeKey` é contrato.** Ele carrega o FATO (não o momento). Mudar a chave de um
   gatilho faz a mesma conquista voltar a gerar mensagem.
3. **Toda notificação nova é fail-soft.** Função em `notification-service.ts` não
   lança, e o gatilho é chamado **fora** da transação (armadilha 41).
4. **A suíte nunca envia e-mail real**: `EMAIL_DRIVER` é forçado para `log` no teste de
   integração. Um teste que dispare para `@exemplo.test` gasta cota e queima reputação
   do domínio.

---

## 9. Checklist de aceite

- [x] **D1** — e-mail transacional com provedor (Resend), fila, outbox e driver de log
- [x] **D2** — convite de equipe pela UI, com aceite, revogação, novo link e quota no aceite
- [x] **D3** — aviso de avaliação atribuída, com prazo no fuso do evento
- [x] **D4** — lembrete de prazo e aviso de vencimento, uma vez por dia por atribuição
- [x] **D5** — aviso de carta conquistada (sem celebrar duplicata)
- [x] **D6** — aviso de certificado emitido, com código de validação
- [x] **A5** — verificação de e-mail enviada no cadastro, sem bloquear o login, com reenvio
- [x] Redefinição de senha passou a sair por e-mail (o fluxo existia e não avisava ninguém)
- [x] Caixa de saída da instituição com situação, filtro, máscara de endereço e reenvio
- [x] RLS + FORCE nas duas tabelas novas; mensagem de plataforma invisível para instituições
- [x] Idempotência por fato (`dedupeKey` único) e por entrega (status `SENT` não reenvia)
- [x] Falha transitória volta para a fila; definitiva é registrada e não é retentada
- [x] Envio real verificado contra o Resend (conta de teste) e recusa de sandbox classificada
- [x] Testes: 36 unitários, 19 de integração, 3 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 5
- [x] `README.md`, `AGENTS.md` e `docs/dividas-tecnicas.md` atualizados

---

Aguardando **"APROVADO: AVANÇAR"**.
