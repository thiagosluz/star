# FASE 87 — O rebrand que fecha: a marca visível × o identificador de memória

> **Tema:** o produto já se chamava **Koveno** na tela, mas o nome antigo ainda saía no
> **remetente do e-mail**, no **rótulo do aplicativo autenticador**, nos **metadados dos PDFs**,
> no **`PRODID` do `.ics`** e em um punhado de **documentos vivos** — e, ao mesmo tempo, uma
> família inteira de **identificadores** precisava continuar se chamando `eventflow` para não
> custar sessão, migração, arquivo órfão ou link já emitido. Esta fase separou as duas coisas
> e fechou a primeira.
>
> **Duas fatias, um fechamento.** A **fatia 1** mexeu no **código e no ambiente** (o
> `EMAIL_FROM`, o `appName`/`issuer` do 2FA, os três renderizadores de PDF, o `PRODID` do
> `.ics` e a amostra do certificado). A **fatia 2** mexeu nos **documentos vivos** (README,
> AGENTS, DESIGN, design-system, armadilhas, roadmap, análise e o `package.json` do MinIO) e
> escreveu a **nota de rebrand** nos dois lugares onde ela é lida. O fechamento é este
> documento, o estado da §9 do `AGENTS.md` e a imagem da fase.
>
> **Base:** a FASE 15 fixou o driver de e-mail e o outbox; a FASE 47 fixou o TOTP e o `issuer`;
> a FASE 51 fixou o veredito público com assinatura; a FASE 65 fixou o `.ics`; a FASE 40 fixou
> o renderizador de PDF; a FASE 86 fechou o corpo do certificado. Esta fase **usa essas
> réguas** — não inventa outro caminho de envio, de validação nem de assinatura.
>
> **ADRs 389 e 390.** A próxima é a **391**.

---

## 1. Sumário executivo

| Entrega | Onde | Prova |
|---|---|---|
| **`EMAIL_FROM` = Koveno** no `.env`, no `.env.example` e nos **dois** serviços do compose (web e worker), com o **endereço mantido** (`onboarding@resend.dev` no `.env`, `nao-responda@eventflow.test` como default do compose — o endereço é infraestrutura, não marca) | `.env:84`, `.env.example:138`, `docker-compose.yml:374` e `:465` | `docker exec eventflow-web printenv EMAIL_FROM` → `Koveno <onboarding@resend.dev>`; a **função real** `emailFromAddress()` devolve o mesmo com o `.env` carregado |
| **`appName`/`issuer` = `'Koveno'`** no Better Auth, com a URI `otpauth://` atualizada e o teste da URI ajustado; a **verificação do TOTP não depende do issuer** | `src/lib/auth/auth.ts:92` e `:344`; `tests/unit/account-rules.test.ts:83` | o `issuer` só entra em `createOTP(...).url(...)` (a URI); a verificação compara o código com o **segredo** — a biblioteca foi lida, não presumida |
| **`/Creator` e `/Producer` = `Koveno`** nos **três** renderizadores de PDF (certificado fixo, layout e crachá/folha), sem tocar no **hash** nem na assinatura | `renderer.ts:243`, `layout-renderer.ts:133`, `badge-renderer.ts:349` e `:448` | o conteúdo canônico é montado **dos valores** (e a verificação recomputa do **banco**) — provado com um certificado real emitido e lido do MinIO |
| **`PRODID` = Koveno** no `.ics`, com o **`UID_DOMAIN = 'eventflow'` preservado** | `src/lib/calendar/ics.ts:68-70`; `tests/unit/f65-ics.test.ts:107` e `:330` | o `PRODID` identifica quem gerou; o `UID` ancora a atualização no cliente — trocá-lo faria evento já importado virar duplicata |
| **Amostra do certificado** (`url_validacao`) em `https://koveno.test/validar/...` | `src/domain/certificates/certificate-layout-rules.ts:410` | o **sha do JSON de amostras** no `tests/unit/f86-corpo-do-certificado.test.ts:614-616` foi atualizado para o novo valor |
| **Documentos vivos** atualizados: `README` (título e estado), `AGENTS` (título e §1), `DESIGN.md` (4), `docs/design-system.md`, `docs/armadilhas.md`, `docs/roadmap-de-produto.md` (6), `docs/analise-competitiva-e-roadmap.md` (11) e `docker/minio/package.json` | os oito arquivos | `git diff` mostra a troca de prosa, nenhuma mudança de identificador |
| **Nota de rebrand** no `README.md` §11 e no cabeçalho de `docs/fases-historico.md`, sem criar linha de fase | `README.md:491-498` e `docs/fases-historico.md:40-42` | os **96 documentos de fase** ficam intactos; a nota diz por que e aponta para este documento |
| **Estado** fechado: `AGENTS.md` com a linha 87, as fases **29 a 87**, a **F60 movida** para o histórico (a tabela corrente começa na 61), a catraca `f79` estendida até a 87 e o ponteiro do histórico corrigido (**50 a 85 → 61 a 87**) | `AGENTS.md`, `docs/fases-historico.md`, `tests/unit/f79-fases-no-arquivo-certo.test.ts` | `(Get-Item AGENTS.md).Length` = **63.048 bytes**; catraca `f79` **5/5** |
| **Dívida declarada: E95** — a senha de fixture/seed ainda diz `EventFlow#2026`/`EventFlow@2026` em **18 arquivos** | `docs/dividas-tecnicas.md` | contagem **48 → 49** (E=27); o §8.1 explica por que é estética, não segurança |
| A imagem da fase: antes × depois do remetente e do título | `docs/imagens/f87-rebrand-koveno.png` | captura da tela real + trechos reais de `git show HEAD:` — o spec/script temporário foi apagado |

**Números da fase**

```text
Arquivos tocados ................. 28 (2 novos: este documento e a imagem)
Testes novos (Vitest) ............ 0 — a fase não muda comportamento; 3 testes existentes
                                    ajustados (URI otpauth, PRODID e pin do sha) + 1 catraca
Vitest ........................... 4690 em 264 arquivos — 0 vermelhos
E2E .............................. 507 casos — 506 passando + 1 skip, 0 vermelhos
f62 (regressão visual) ........... 23/23, SEM re-basear (as 23 baselines mantêm o mtime)
Migrações ........................ 0
ADRs ............................. 2 (ADR-389 e ADR-390) — a próxima é a 391
Dívidas .......................... 0 quitadas e 1 declarada (E95): a contagem vai de 48 para 49
Código de produto ................ 0 mudanças de comportamento (só strings de marca e metadados)
Identificadores renomeados ....... 0 (de propósito — ver o §8)
```

---

## 2. O problema mais difícil: **decidir o que NÃO se renomeia**

O rebrand não foi difícil por causa das strings — foram dezenas, todas triviais. Foi difícil
porque a pergunta certa não é "onde ainda está escrito EventFlow?", e sim **"quem lê esse
nome?"**.

O inventário da abertura mostrou a escala:

| Família | Ocorrências | Arquivos | O que é |
|---|---|---|---|
| `EventFlow` (capitalizado) | **85** | **46** | marca em prosa, título, remetente, metadados |
| `eventflow` (minúsculo) | **605** | **~175** | roles, banco, buckets, domínios de e-mail, hosts de container |
| `--ef-*` | **700** | **62** | tokens e classes do design system |
| Documentos de fase | **96** | — | registro do que foi entregue (8 ocorrências na prosa de 4 docs vivos) |
| `event_flow` | **0** | 0 | **não existe** |
| `ENV EF_*` | **0** | 0 | **não existe** — as variáveis são `EMAIL_FROM`, `E2E_BASE_URL`, … |

A tentação é óbvia: um `sed` global e o nome antigo desaparece. **Cada linha minúscula dessa
tabela tem um custo concreto** se for renomeada:

- **Cookie (`ef_tema`, `ef_tenant`, `ef_nav`)** — renomear **derruba a sessão** de todo mundo
  que já escolheu aparência, instituição ou barra. O ganho é invisível: ninguém lê o nome do
  cookie.
- **Role de banco (`eventflow_app`, `eventflow_admin`)** — renomear é **migração de
  privilégio**: as policies, os `GRANT`s, a `DATABASE_URL` e o contrato de verificação falam
  esses nomes. O ganho é invisível: ninguém lê o nome da role.
- **Bucket (`eventflow-*`)** — renomear é **arquivo órfão**: os objetos já gravados continuam
  no bucket antigo, e o novo nasce vazio (ou exige cópia de tudo). O ganho é invisível.
- **Rótulo de token (`eventflow:*`, o prefixo dos tokens de convite/verificação)** — renomear
  **invalida os links já emitidos**: o token foi selado com um contexto que inclui o rótulo.
- **`UID` do `.ics` (`...@eventflow`)** — renomear faz o cliente de calendário tratar cada
  evento como **novo**: o compromisso já importado vira duplicata e para de atualizar.
- **`@eventflow.test`** — é o **domínio de e-mail de fixture**; trocar mexe em 16 specs, no
  seed, na doc e em quem já tem a conta gravada no banco de desenvolvimento (sem ganho de
  produto: o domínio `.test` não é público).
- **`--ef-*` / `ef-card`** — é o **namespace do design system**, preso por guarda de CSS e por
  **23 baselines visuais**. Renomear é churn de 700 ocorrências com risco de regressão visual
  e zero de leitura.
- **Senha de fixture (`EventFlow#2026`/`EventFlow@2026`)** — é digitada por gente, mas por
  gente **testando**; o custo é 18 arquivos e a senha gravada (o `db:seed:dev` regrava). Ficou
  como **E95**: é a única sobra "visível" que a fase decidiu não pagar agora.

E o outro lado: o que a pessoa **lê** e o rebrand deixou para trás. O caso mais grave era o
**remetente**: a tela já dizia Koveno, o rodapé do e-mail já dizia Koveno, e a caixa de entrada
mostrava `EventFlow <onboarding@resend.dev>`. O rebrand não estava "faltando" — estava
**incompleto no lugar em que a marca encontra a pessoa fora do site**.

A régua que resolve os dois lados é a **ADR-389**.

---

## 3. Decisões técnicas

### 3.1 A régua: marca visível × identificador de memória

| O que a pessoa **lê** (renomeia) | O que o sistema **lembra** (mantém) |
|---|---|
| wordmark, `<title>`, README, DESIGN, docs vivos | cookies (`ef_tema`, `ef_tenant`, `ef_nav`) |
| `EMAIL_FROM` (nome de exibição do remetente) | roles (`eventflow_app`, `eventflow_admin`) e o banco `eventflow` |
| `appName`/`issuer` do 2FA (rótulo no app autenticador) | buckets (`eventflow-*`) |
| `/Creator`, `/Producer`, `/Title` dos PDFs | rótulos de token (`eventflow:*`) |
| `PRODID` do `.ics` | `UID` do `.ics` (`...@eventflow`) |
| amostra `url_validacao` (`koveno.test`) | domínio de fixture (`@eventflow.test`) |
| prosa dos documentos vivos | namespace `--ef-*`/`ef-card` e a senha de fixture |

O critério não é semântico, é de **custo de memória**: se renomear pode invalidar uma sessão,
uma migração, um objeto já guardado ou um link já emitido, o nome **fica** — e o documento
explica por quê. Se o nome só é lido e não é usado para lembrar nada, ele **acompanha a marca**.

### 3.2 O remetente que ficou para trás (e os três ângulos da prova)

O default do código **já era Koveno** desde antes da fase:

```ts
// src/lib/communication/mailer.ts:66-69
export function emailFromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || 'Koveno <nao-responda@eventflow.test>';
}
```

Mas o `.env` e o compose **sobrepunham** o default com `EventFlow <...>`. Ou seja: a fase não
precisou mudar o código do remetente; precisou mudar **quem vence a variável**. E a prova não
podia ser o outbox: `EmailMessage` **não guarda remetente** — ele guarda `to`, `template`,
`subject`, `payload`, `html`, `text`, `status`, `dedupeKey`. O remetente é **envelope**: vive
no ato do envio, não na mensagem. Por isso a prova exigiu **três ângulos**:

1. **A configuração resolvida** — `docker compose --profile app config`, com a variável do
   shell removida, mostra `EMAIL_FROM: Koveno <onboarding@resend.dev>` nos dois serviços.
2. **O processo real** — `docker exec eventflow-web printenv EMAIL_FROM` (e o worker) devolve
   `Koveno <onboarding@resend.dev>`.
3. **A função real** — `emailFromAddress()` executada com o ambiente do processo devolve o
   mesmo valor; executada com o `EMAIL_FROM` antigo do shell devolve `EventFlow <...>`.

Um quarto ângulo, que não é do remetente mas fecha a história: o **rodapé** do e-mail
(`renderEmail` → `Koveno · mensagem automática, não responda a este endereço.`) **já era
Koveno**. O defeito era a divergência entre envelope e corpo, não a ausência do nome novo.

### 3.3 A armadilha do ambiente do processo (a que quase desfez o rebrand)

O compose usa `${EMAIL_FROM:-Koveno <...>}` — e **o ambiente do processo vence o `.env`**.
`dotenv` não sobrescreve variável já exportada, e o compose interpola a variável do shell
antes de ler o `.env`. No dia da fatia 1, o shell tinha `EMAIL_FROM="EventFlow <...>"` e
recriar os containers sem removê-la teria **revertido** o rebrand:

```text
shell EMAIL_FROM: EventFlow <onboarding@resend.dev>
docker compose --profile app config   → EMAIL_FROM: EventFlow <onboarding@resend.dev>
Remove-Item Env:EMAIL_FROM
docker compose --profile app config   → EMAIL_FROM: Koveno <onboarding@resend.dev>
```

É a **armadilha 50** (já documentada na FASE 15: "variável já exportada no shell vence o
`.env`") aparecendo de novo, agora com o sinal invertido — antes ela fazia o `.env` "não ser
lido"; agora ela faria o rebrand "não valer". A correção operacional é **recriar sem a
variável** (e conferir com `printenv` dentro do container), não editar o `.env` de novo.

### 3.4 O `issuer` do 2FA não invalida TOTP existente

O `issuer` foi para `'Koveno'`, e a URI `otpauth://totp/Koveno:ana@example.test?...&issuer=Koveno`
foi atualizada no teste. A pergunta que importa: **quem já cadastrou o segundo fator perde o
acesso?** Não. A biblioteca (Better Auth) usa o `issuer` **só** para montar a URI:

```js
// node_modules/better-auth/dist/plugins/two-factor/index.mjs:169-172
const totpURI = createOTP(secret, { ... })
  .url(issuer || options?.issuer || ctx.context.appName, user.email);
```

A verificação compara o código com o **segredo gravado**, não com a URI. O efeito real é
outro: **o rótulo no aplicativo autenticador só muda em um enrollment novo** — quem já tem a
conta vê `EventFlow: e-mail` até recadastrar. É cosmético, e a fase não força recadastro (o
que seria pior: pedir o segundo fator de novo a quem já o usa).

### 3.5 `PRODID` muda, `UID` não

```ts
// src/lib/calendar/ics.ts:64-70
const DEFAULT_PRODID = '-//Koveno//Agenda do participante//PT-BR';
/** `UID` é ESTÁVEL: trocar o domínio faria o cliente criar eventos NOVOS. */
const DEFAULT_UID_DOMAIN = 'eventflow';
```

O `PRODID` diz **quem gerou o arquivo** (RFC 5545) e não entra na identidade do evento. O `UID`
é a identidade: o cliente usa `UID + SEQUENCE` para decidir se atualiza o evento existente ou
cria outro. Trocar o domínio do `UID` faria **todo evento já importado virar duplicata** e
**parar de atualizar** — o usuário teria dois cartões do mesmo minicurso e nenhum aviso de
que o horário mudou. O teste do `f65` prende o `PRODID` novo e continua prendendo o `UID` com
o domínio antigo.

### 3.6 O hash não vê `/Creator` nem `/Producer`

O conteúdo canônico do certificado é montado **dos valores** (`buildCanonicalPayload` /
`buildCanonicalPayloadV2`), e a verificação pública **recomputa do banco** — nunca dos bytes do
PDF:

```ts
// src/lib/certificates/certificate-service.ts:1961-2000 (resumo)
const canonical = storedLayout ? buildCanonicalPayloadV2({ ... }) : buildCanonicalPayload({ ... });
const recomputedHash = hashCanonicalPayload(canonical);
const hashMatches = recomputedHash === row.contentHash;
const signatureValid = hashMatches && ... verifySignature({ contentHash: recomputedHash, ... });
```

`/Creator` e `/Producer` são **apresentação** (metadado do PDF). Por isso a troca não muda
`contentHash`, não muda `signature` e não invalida documento nenhum. A prova foi um
**certificado real emitido**, baixado do MinIO e lido: o `contentHash` e a assinatura
continuaram os mesmos, e o PDF dizia `Koveno`. (A FASE 51 já tinha fixado a régua:
"integridade faz parte da autenticidade"; a FASE 86 a reusou para o corpo.)

### 3.7 Os documentos vivos e a nota de rebrand

A prosa viva foi atualizada onde o nome é **lido**: README (título e estado), AGENTS (título e
§1), DESIGN.md (4), design-system, armadilhas, roadmap (6) e análise competitiva (11). O
`docker/minio/package.json` (descrição do provisionamento) também.

Os **96 documentos de fase** — o registro do que foi entregue — **não se reescrevem**. Para
que ninguém leia `docs/fase-15-comunicacao.md`, veja `EventFlow` e conclua que o rebrand não
aconteceu, a nota foi escrita em **dois** lugares: o `README.md` §11 (onde o estado atual é
apresentado) e o **cabeçalho de `docs/fases-historico.md`** (onde os documentos antigos são
apresentados). A escolha é a **ADR-390**.

### 3.8 O que ficou de fora, de propósito

A lista completa está no §8. Em resumo: **roles, banco, buckets, cookies, rótulos
`eventflow:*`, o `UID` do `.ics`, `@eventflow.test`, a senha de fixture e o namespace
`--ef-*`**. Nenhum deles é lido por quem usa o produto; todos são usados pelo sistema para
lembrar alguma coisa. O namespace `--ef-*` tem, além disso, uma **guarda de design system** e
**23 baselines** — renomeá-lo seria uma fase de CSS com risco visual e nenhum ganho de marca.

---

## 4. ADRs

### ADR-389 — O nome é MARCA visível; o identificador é MEMÓRIA

**Contexto.** O produto passou a se chamar Koveno, mas o nome antigo continuava em dois
lugares de naturezas opostas: (a) superfícies que a pessoa **lê** — remetente de e-mail,
rótulo do autenticador, metadados de PDF, `PRODID` do calendário, documentos vivos; e (b)
**identificadores** que o sistema usa para reconhecer coisas entre execuções — cookies, roles,
buckets, rótulos de token, `UID` do `.ics`, domínio de fixture, namespace de CSS. Um `sed`
global trataria os dois como iguais.

**Decisão.** Renomeia-se o que a pessoa lê. **Não** se renomeia o que o sistema usa para
lembrar, quando o custo da troca é um dos quatro: **sessão** (cookie), **migração** (role,
banco), **arquivo órfão** (bucket, objeto no storage) ou **link já emitido** (rótulo de token,
`UID` de calendário). O nome antigo nesses lugares é **memória**, não marca; a divergência é
documentada e intencional.

**Justificativa.** O ganho de renomear um identificador invisível é zero; o custo é medido em
dado perdido, sessão derrubada ou documento que deixa de validar. O ganho de renomear o que a
pessoa lê é o rebrand inteiro — e é onde a incoerência aparece. A régua também dá um critério
para o **futuro**: identificador novo nasce com o nome novo; identificador antigo só muda com
uma fase que pague o custo (migração de role, cópia de bucket, versão de token), nunca "de
passagem" num rebrand.

**Consequências.**

- *Positivas:* zero sessão derrubada, zero migração de privilégio, zero objeto órfão, zero
  link invalidado, zero duplicata de calendário; o rebrand fecha onde a marca é lida.
- *Negativas:* dois nomes coexistem para sempre; quem lê o código ou o banco encontra
  `eventflow` e precisa conhecer esta ADR; a senha de fixture ainda diz o nome antigo (E95).
- *Neutras:* o `issuer` do 2FA muda a URI e **não** invalida TOTP; o rótulo no app autenticador
  só muda em enrollment novo; o `PRODID` muda e o `UID` não.

**Alternativas descartadas.**

1. **Renomear tudo** — o `sed` global. Custo: sessão, migração de roles/policies, cópia de
   buckets, invalidação de tokens e duplicata de calendário. Nenhum ganho de leitura.
2. **Não renomear nada** — deixar o remetente e o `PRODID` antigos. Custo: a marca aparece
   errada justamente na caixa de entrada e no calendário, que é onde ela é vista fora do site.
3. **Renomear com camada de compatibilidade** (cookie duplo, role nova com alias, bucket
   espelhado) — custo de infraestrutura permanente para resolver um problema de leitura; a
   memória do sistema passaria a ter duas fontes, que é o defeito que a fase evita.

### ADR-390 — A nota de rebrand mora no README e no histórico, não na AGENTS

**Contexto.** Os 96 documentos de fase continuam dizendo EventFlow (são registro). Era preciso
dizer isso em algum lugar que quem lê um documento antigo encontre — sem reescrever 96
arquivos e sem gastar o teto do `AGENTS.md`, que é um arquivo operacional com corte de harness.

**Decisão.** A nota vive em **dois** lugares: o `README.md` §11 (a apresentação do estado
atual, onde o leitor chega primeiro) e o **cabeçalho de `docs/fases-historico.md`** (o arquivo
que apresenta os documentos antigos). O `AGENTS.md` §1 carrega só a identidade — `**Koveno**
(ex-**EventFlow**)` —, não a nota.

**Justificativa.** Cada arquivo responde a uma pergunta diferente: o README diz "o que é o
produto hoje"; o histórico diz "o que são estes documentos antigos"; a AGENTS diz "como
trabalhar". Enfiar a nota na AGENTS custaria bytes de um arquivo que já move fases para o
histórico por causa do teto — e não é lá que o leitor de um documento de fase vai olhar.

**Consequências.**

- *Positivas:* nenhum documento de fase reescrito; o `AGENTS.md` fica com o orçamento para o
  estado; a nota fica onde o leitor de documento antigo a encontra.
- *Negativas:* quem abre `docs/fase-15-comunicacao.md` **direto** (sem passar pelo README ou
  pelo histórico) não vê a nota. É um limite aceito: 96 notas custariam 96 edições num
  registro, e o cabeçalho do histórico é o índice desse registro.
- *Neutras:* o `README.md` §11 passa a linkar este documento; a nota não cria linha de fase
  nem entra na contagem de ADRs por si.

**Alternativas descartadas.**

1. **A nota em cada um dos 96 documentos** — 96 edições num registro imutável, e a nota
   passaria a competir com o conteúdo de cada fase.
2. **A nota na `AGENTS.md`** — gasta o teto de um arquivo operacional e não é onde o leitor de
   documento antigo procura.
3. **Não escrever nota nenhuma** — deixaria a impressão de rebrand pela metade, que é
   exatamente o defeito que a fase corrige.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | O rebrand parecia "simples", mas o inventário mostrou **85 `EventFlow` em 46 arquivos**, **605 `eventflow` em ~175**, **700 `--ef-*` em 62** e **96 documentos** com o nome antigo — e **8 ocorrências na prosa de 4 docs vivos** | A pergunta "onde está o nome?" não separa **marca** de **identificador**; o número bruto assusta e o número útil é o que a pessoa lê | O inventário virou tabela por família; a régua (ADR-389) decidiu caso a caso. **`event_flow` e `ENV EF_*` não existem** — a busca também serve para matar suposição |
| 2 | O e-mail saía com `EventFlow <...>` mesmo com a tela e o rodapé dizendo Koveno | O **default do código já era Koveno**, mas o `.env` e o compose **sobrepunham** o valor antigo; e o **outbox não guarda remetente** (é envelope), então o banco não provava nada | Trocar `.env`/compose mantendo o endereço; provar por **3 ângulos**: compose config, `printenv` no container e a **função real** `emailFromAddress()` |
| 3 | Recriar o container a partir do shell "com tudo certo" traria o remetente antigo de volta | **O ambiente do processo vence o `.env`**: `dotenv` não sobrescreve variável exportada, e o compose interpola o shell antes de ler o `.env` (armadilha 50, agora ao contrário) | `Remove-Item Env:EMAIL_FROM` antes de recriar; a conferência é `printenv` **dentro** do container, não o `.env` no disco |
| 4 | O medo de que trocar o `issuer` do 2FA trancasse quem já usa TOTP | A biblioteca usa o `issuer` **só na URI** (`createOTP(...).url(...)`); a verificação compara o código com o **segredo gravado** | Trocar o `issuer` e a URI do teste; declarar que o **rótulo no app autenticador só muda em enrollment novo** (e não forçar recadastro) |
| 5 | O `.ics` com `PRODID` novo poderia duplicar eventos já importados | O `PRODID` identifica quem gerou; o **`UID`** é que ancora a atualização no cliente | Trocar **só** o `PRODID` e manter `UID_DOMAIN = 'eventflow'`; teste do `f65` prende os dois |
| 6 | A troca de `/Creator`/`/Producer` poderia invalidar certificado emitido | O hash é sobre o **conteúdo canônico dos valores**, e a verificação **recomputa do banco** — o PDF é apresentação | Trocar os metadados nos 3 renderizadores; provar com certificado **real** emitido e lido do MinIO (hash e assinatura intactos) |
| 7 | As **23 baselines do `f62`** "iam se mexer" por causa das strings novas | Nenhuma mudança foi **visual**: as strings trocadas não aparecem nas 23 telas medidas | `f62` **23/23 sem re-basear**; as 23 baselines mantêm o **mtime antigo** (04/11 09:34–09:35) contra as edições de 05/11 07:02–07:42 |

**A lição que amarra as sete:** o rebrand é um problema de **fronteira**, não de texto. O que
a pessoa lê muda; o que o sistema lembra fica. Cada uma das sete linhas é um lugar onde essa
fronteira quase foi cruzada.

---

## 6. Evidência de verificação

### 6.1 A bateria da §4

```text
npm run lint ................. 0 erros, 0 warnings (exit 0)
npm run typecheck ............ 0 erros (exit 0)
npm test ..................... 4690 testes em 264 arquivos — 0 vermelhos
npm run build ................ Compiled successfully (exit 0)
npm run db:verify ............ Contrato íntegro.
npm run db:verify:isolation .. 9/9 verificações passaram.
npm run db:partitions ........ partições do mês atual e dos seguintes criadas/confirmadas
npm run test:e2e ............. 507 casos — 506 passando + 1 skip, 0 vermelhos
f62 (regressão visual) ....... 23/23 — sem re-baseline
```

### 6.2 O `f62` sem re-basear (a prova por mtime)

```text
23 baselines em tests/e2e/f62-regressao-visual.spec.ts-snapshots/
  04/11/2026 09:34:36  barra-inteira-claro-chromium-win32.png
  …
  04/11/2026 09:35:52  evento-inscricao-chromium-win32.png
edição da fase:  auth.ts 05/11/2026 07:02 · ics.ts 07:03 · README 07:42 · compose 07:0x
```

Se qualquer mudança de marca tivesse chegado à tela medida, o `toHaveScreenshot` teria
reprovado (threshold 0,04 e `maxDiffPixelRatio: 0`). Não reprovou — e os arquivos **não foram
reescritos** nesta fase (o mtime é o de antes; as baselines já vinham modificadas das F84–F86,
e esta fase não as tocou).

### 6.3 O remetente, por três ângulos

```text
# 1. a configuração resolvida (sem a variável do shell)
docker compose --profile app config | Select-String EMAIL_FROM
  EMAIL_FROM: Koveno <onboarding@resend.dev>
  EMAIL_FROM: Koveno <onboarding@resend.dev>     (web e worker)

# 2. o processo real
docker exec eventflow-web printenv EMAIL_FROM    → Koveno <onboarding@resend.dev>
docker exec eventflow-worker printenv EMAIL_FROM → Koveno <onboarding@resend.dev>

# 3. a função real
npx tsx -e "import { emailFromAddress } from './src/lib/communication/mailer'; …"
  com o shell antigo ............................ EventFlow <onboarding@resend.dev>
  sem ele (dotenv carrega o .env) ............... Koveno <onboarding@resend.dev>
```

E o **outbox não guarda remetente**: `EmailMessage` tem `to`, `template`, `subject`, `payload`,
`html`, `text`, `status`, `dedupeKey` — nenhum campo de `from`. A prova do remetente **não
pode** vir do banco; tem de vir do ambiente e da função.

### 6.4 O container que rodou o E2E

```text
docker compose ps
  eventflow-web     eventflow/web:local      Up (healthy)
  eventflow-worker  eventflow/worker:local   Up
docker images | grep eventflow/web
  eventflow/web:local    2026-11-05 07:24:10 -0300   8b9517e68ae2
```

A imagem foi construída **depois** das edições de código da fatia 1 (07:02–07:43) e o E2E mediu
essa imagem. A armadilha do `--build` que falha e deixa o container anterior no ar **não**
ocorreu: a data da imagem é posterior ao código.

### 6.5 O que a fase NÃO mudou

```text
git diff --stat -- tests/e2e/f62-regressao-visual.spec.ts   → vazio
mtime das 23 baselines                                       → 04/11/2026 09:34–09:35
git diff -- src/app/globals.css                              → vazio (a fase não tocou no CSS)
git diff -- playwright.config.ts                             → vazio
```

As únicas mudanças em teste foram **strings de marca**: a URI `otpauth` no
`account-rules.test.ts`, o `PRODID` no `f65-ics.test.ts` e o pin do sha das amostras no
`f86-corpo-do-certificado.test.ts` (mais a catraca `f79`, que é de documentação). Nenhuma
asserção de **comportamento** mudou.

### 6.6 A imagem da fase

`docs/imagens/f87-rebrand-koveno.png` — o **antes** (valores reais de `git show HEAD:`) e o
**depois** (valores reais da árvore + a captura da home no container), com a lista do que
ficou como identificador. O script de captura foi **apagado** depois de gerar o PNG.

---

## 7. Comandos operacionais

```bash
# o remetente que o processo realmente usa (o `.env` NÃO é a resposta completa)
docker exec eventflow-web printenv EMAIL_FROM
docker exec eventflow-worker printenv EMAIL_FROM

# a configuração resolvida — rode SEM a variável no shell, ou ela vence o `.env`
docker compose --profile app config | grep EMAIL_FROM

# a função real, com o `.env` carregado
npx tsx -e "import 'dotenv/config'; import { emailFromAddress } from './src/lib/communication/mailer'; console.log(emailFromAddress())"

# a URI do 2FA (o issuer novo; o TOTP já cadastrado continua valendo)
npx vitest run tests/unit/account-rules.test.ts

# o calendário: PRODID novo, UID estável
npx vitest run tests/unit/f65-ics.test.ts

# o hash do certificado não depende de /Creator nem de /Producer
npx vitest run tests/unit/f86-corpo-do-certificado.test.ts

# a catraca do estado (fases no arquivo certo)
npx vitest run tests/unit/f79-fases-no-arquivo-certo.test.ts

# a regressão visual, sem re-basear
npx playwright test tests/e2e/f62-regressao-visual.spec.ts

# a suíte inteira (o container precisa estar com a imagem nova)
npm run test:e2e
```

**Ao recriar os containers**, confira o shell antes:

```powershell
Remove-Item Env:EMAIL_FROM -ErrorAction SilentlyContinue   # armadilha 50/87
docker compose --profile app up -d --build web worker
docker exec eventflow-web printenv EMAIL_FROM              # tem de dizer Koveno
```

---

## 8. Dívidas técnicas e pontos de atenção

### 8.1 Dívida declarada: **E95** — a senha de fixture/seed ainda diz o nome antigo

`EventFlow#2026` aparece em **16 specs** de E2E e no helper, e `EventFlow@2026` é o default de
`prisma/seed-dev-users.ts:70` e está em `docs/contas-de-teste.md:13` — **18 arquivos**. Não é
segredo de produção (a senha é pública e o script recusa `NODE_ENV=production`); é **estética
com custo de 18 arquivos**. Ficou declarada em vez de paga porque:

- a troca exige atualizar os 16 specs **e** o default **e** a doc **e** a senha já gravada no
  banco de desenvolvimento (o `db:seed:dev` regrava, então o caminho é rodá-lo de novo);
- o ganho é de coerência de leitura, não de segurança nem de comportamento.

A contagem de dívidas vai de **48 para 49** (E=27). O namespace `--ef-*`/`ef-card` **não**
entra na contagem — a ADR-389 o mantém de propósito.

### 8.2 O que ficou como identificador, e por quê

| Identificador | Por que fica | Custo se renomear |
|---|---|---|
| `eventflow_app`, `eventflow_admin` (roles) | privilégio de banco: policies, `GRANT`s, `DATABASE_URL`, contrato de verificação | migração de privilégio; o provisionamento religa o que a migração revoga (armadilha 101) |
| banco `eventflow` | nome do banco no volume e na `DATABASE_URL` | migração de banco inteiro, com downtime |
| buckets `eventflow-*` | objetos já gravados no MinIO | arquivo órfão ou cópia de tudo |
| cookies `ef_tema`, `ef_tenant`, `ef_nav` | preferência e contexto já gravados no navegador | sessão/aparência/instituição “esquecem” a escolha |
| rótulos `eventflow:*` (tokens) | o rótulo entra no selo/HMAC do token | links já emitidos deixam de abrir |
| `UID` do `.ics` (`...@eventflow`) | identidade do evento no cliente de calendário | evento importado vira duplicata e para de atualizar |
| `@eventflow.test` | domínio de e-mail de fixture (16 contas) | 16 specs + seed + doc + contas no banco de dev |
| `EventFlow#2026`/`EventFlow@2026` | senha de fixture/seed | 18 arquivos (E95) |
| `--ef-*`, `ef-card` | namespace do design system, com guarda de CSS e 23 baselines | churn de ~700 ocorrências, risco visual, ganho zero |

### 8.3 Os 96 documentos de fase

Não se reescrevem. São **registro do que foi entregue** — inclusive as decisões e os números
do tempo em que o produto se chamava EventFlow. A nota de rebrand está no `README.md` §11 e no
cabeçalho de `docs/fases-historico.md` (ADR-390); quem abre um documento de fase direto não a
vê, e isso é um limite aceito e declarado.

### 8.4 O ponteiro que mentia em `docs/fases-historico.md`

A linha do "Onde está a tabela corrente" dizia **"hoje, da 50 à 85"** — devia dizer 61 a 87
depois do movimento desta fase, e já estava errada antes (a F86 tinha movido 50 a 59 e a tabela
começava na 60). O ponteiro foi corrigido para **"da 61 à 87"** e o cabeçalho passou a registrar
o movimento da F60. É o tipo de número que ninguém confere porque não é código — e que, errado,
manda o leitor para a tabela errada.

### 8.5 O teto do `AGENTS.md` e o movimento da F60

A linha 87 (1.153 bytes) mais o parágrafo de dívidas levariam o arquivo acima do teto. O
movimento da **F60** (a mais antiga da tabela corrente, 206 bytes) para o histórico e a
**reescrita mais curta da narrativa de dívidas** devolveram a folga: o arquivo terminou em
**63.048 bytes** (o teto é ~64.800; o corte do harness é 65.244). A catraca `f79` foi estendida
(FASES_HISTORICAS + `60`, FASES_CORRENTES 61–87, ORDEM_CRONOLOGICA + `60`) e passa **5/5**.

### 8.6 Pontos de atenção

- **`EMAIL_FROM` no shell** continua sendo uma armadilha operacional: quem recriar o container
  com a variável antiga exportada reverte o remetente em silêncio. O §7 traz o comando.
- **O endereço `nao-responda@eventflow.test`** permanece como *fallback* do compose: é
  **endereço**, não marca (o `.env` usa `onboarding@resend.dev`). Trocar o endereço é decisão
  de infraestrutura, não de rebrand.
- **Literais `EventFlow <...>` no `tests/unit/email-communication.test.ts`** continuam lá de
  propósito: o teste prova que `isSandboxSender` olha o **domínio** (`resend.dev`), não o nome
  de exibição — trocar o literal não acrescentaria prova e apagaria a de que o nome é livre.
- **A nota de rebrand no README** é a única prosa viva que ainda diz “EventFlow”; é a nota, não
  um resíduo.
- **O rótulo do 2FA** em quem já cadastrou o autenticador continua `EventFlow: e-mail` até um
  enrollment novo. Não há migração de rótulo no app de terceiro.

---

## 9. Checklist de aceite

- [x] `EMAIL_FROM` = `Koveno <...>` no `.env`, no `.env.example` e nos dois serviços do compose,
      com o endereço mantido.
- [x] `appName` e `issuer` = `'Koveno'`; URI `otpauth` e teste ajustados; verificação do TOTP
      provada independente do `issuer`.
- [x] `/Creator` e `/Producer` = `Koveno` nos **três** renderizadores; hash e assinatura
      intactos (certificado real lido do MinIO).
- [x] `PRODID` = Koveno no `.ics`, com `UID_DOMAIN = 'eventflow'` preservado e teste prendendo
      os dois.
- [x] Amostra `url_validacao` em `koveno.test`, com o pin do sha das amostras atualizado.
- [x] Documentos vivos atualizados (README, AGENTS, DESIGN, design-system, armadilhas, roadmap,
      análise, `docker/minio/package.json`) e **nota de rebrand** no README §11 e no histórico.
- [x] `AGENTS.md`: linha 87, fases **29 a 87**, `F87 entregue`, ADRs **390** (próxima 391),
      dívidas 49, §10 → este documento; **F60 movida** e catraca `f79` atualizada.
- [x] Contagens do `README.md` (as **duas** cópias) atualizadas — a I8 não foi resolvida nem
      piorada.
- [x] **Nenhum identificador renomeado** (roles, banco, buckets, cookies, rótulos, `UID`,
      `@eventflow.test`, senha, `--ef-*`).
- [x] `docs/fases-historico.md`: F60 movida **como estava**, ponteiro **61 a 87** e cabeçalho
      com o movimento da F87.
- [x] Bateria da §4 inteira: `lint`, `typecheck`, `npm test`, `build`, `db:verify`,
      `db:verify:isolation`, `db:partitions` e a suíte **E2E inteira** (506 + 1 skip).
- [x] `f62` **23/23 sem re-basear**; `globals.css`, `playwright.config.ts` e baselines intactos.
- [x] Imagem `docs/imagens/f87-rebrand-koveno.png` capturada da tela/arquivos reais; script
      temporário apagado.
- [x] Limpeza de `playwright-report/`, `test-results*` e `.playwright*`; `git status` sem
      resíduo; `next-env.d.ts` intacto.
- [x] Dívida **E95** declarada e contabilizada (48 → 49).
