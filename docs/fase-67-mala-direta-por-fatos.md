# FASE 67 — Mala direta por fatos reais

> **Estado: ENTREGUE.** O plano e as decisões do humano estão em
> [`docs/fase-67-plano.md`](fase-67-plano.md), que continua sendo a fonte do recorte.
> Este documento é a entrega: as quatro fatias, as decisões com o "porquê", os três
> ADRs, as lições que **aconteceram**, a evidência de verificação e as dívidas.

---

## 1. Sumário executivo

### 1.1 O que a fase entrega

| Fatia | Entrega | Onde |
|---|---|---|
| **1 — Fundação** | Catálogo de **15 condições** como regra de domínio pura (id estável, rótulo, parâmetros declarados, **frase explicativa**), composição com "exceto quem…" que **recusa** em vez de falhar aberto, avaliação sob `withTenant` com **máscara** da F60, tabela de campanhas com o **snapshot dos fatos**, e o descadastro por instituição (`communication_unsubscribes`, RLS + FORCE) | `src/domain/communication/segments.ts`, `campaign-rules.ts`, `unsubscribe-rules.ts`, `src/lib/communication/{segment-service,campaign-service,unsubscribe-service}.ts` |
| **2 — A aba "Segmentos"** | Aba em `?aba=segmentos` com form `GET` (endereço compartilhável), contagem antes do envio, frases com o nome no lugar do uuid, prévia mascarada, teste só para si, disparo em lotes com limite de ritmo e histórico com as frases congeladas | `src/app/t/[tenantSlug]/(app)/administracao/comunicacao/page.tsx`, `src/lib/communication/segment-form.ts`, `src/components/admin/campaign-send-form.tsx` |
| **3 — Descadastro** | **Token determinístico** por (instituição, pessoa) com HMAC-SHA256, rodapé no `CAMPAIGN_MESSAGE` (e só nele), **página sem login** `/t/<slug>/descadastro/<token>`, envio que pula quem saiu, caminho de volta, e **marcadores por destinatário** (`{nome}`, `{instituicao}`, `{evento}`) | `src/domain/communication/{unsubscribe-rules,campaign-markers,email-templates}.ts`, `src/app/t/[tenantSlug]/(public)/descadastro/[token]/page.tsx`, `src/app/actions/unsubscribe-actions.ts`, `src/components/communication/unsubscribe-forms.tsx`, `src/lib/communication/campaign-service.ts` |
| **4 — Catracas e documento** | **Cobertura das 15 condições auditada** condição por condição (os dois sentidos, e o **isolamento entre instituições** para todas), portão **WCAG AA** de 20 → **23 casos** (a aba "Segmentos" e a página de descadastro nos dois estados), regressão visual de 19 → **21 linhas de base**, este documento e as atualizações de `AGENTS.md`, `README.md` e `docs/dividas-tecnicas.md` | `tests/integration/f67-segmentos.test.ts`, `tests/unit/f67-descadastro.test.ts`, `tests/e2e/f67-descadastro.spec.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/f62-regressao-visual.spec.ts` |

### 1.2 Números da fase

| Medida | Antes | Depois |
|---|---|---|
| Condições no catálogo | — | **15** (as 12 do plano mais as três que o recorte do produto pediu) |
| Condições com prova **dos dois lados** contra fatos semeados | — | **15 de 15** |
| Condições com prova de **isolamento entre instituições** | 1 (`xp-acima`) | **15 de 15** |
| Testes Vitest (unit + integração) | 3221 | **3350** (+129) |
| Casos no portão WCAG AA | 20 | **23** (`ISENCOES = []` — nenhuma isenção nova) |
| Linhas de base da regressão visual | 19 | **21** |
| ADRs | 337 | **340** (a próxima é **341**) |
| Permissões | 66 | **66** (nenhuma permissão nova: o disparo usa `participant:message`, que já existia) |
| Migrações | — | **nenhuma** (as duas tabelas nasceram na fatia 1) |

---

## 2. O problema mais difícil da fase — e por que ele define o desenho

> **O endereço de descadastro precisa existir antes de a pessoa sair.**

Todo e-mail de campanha leva o caminho de saída — e o e-mail é montado **antes** de a
pessoa sair. A tabela `communication_unsubscribes` só ganha linha quando ela sai. As
saídas ruins dessa armadilha são conhecidas, e todas piores do que o custo de um token
derivado:

| Caminho descartado | Por que não |
|---|---|
| **Criar a linha no envio** ("pré-descadastro") | Marca como fora quem nunca pediu nada; o disparo passaria a pular a instituição inteira |
| **`userId` na URL** (`?pessoa=<uuid>`) | Identificador adivinhável e correlacionável entre instituições — é o mesmo motivo pelo qual o `.ics` da FASE 65 não leva id nenhum |
| **Tabela de tokens** por destinatário | Uma segunda fonte de verdade para o mesmo fato, com dado pessoal parado no banco, e **a linha ainda não existiria** no momento do envio |
| **Token aleatório na linha, criado no envio** | É o caminho do "pré-descadastro" com outro nome: a linha nasceria antes da decisão |

### 2.1 O desenho escolhido, e a prova

**Token determinístico por (instituição, pessoa)** — HMAC-SHA256 de um rótulo próprio
(`eventflow:descadastro:`) derivado de `BETTER_AUTH_SECRET`, sobre o par
`tenantId:userId`, em base64url (43 caracteres). Mesmo desenho do token `.ics` da FASE
65 e do selo da carta da FASE 48, com **rótulo próprio** para que vazar um caminho não
abra o outro.

A derivação é **pura e testável sem banco**, e o que ela garante está preso em
`tests/unit/f67-descadastro.test.ts`:

| Propriedade | O que impede |
|---|---|
| Mesmo par → mesmo token | O rodapé de hoje é o mesmo do dia em que a pessoa sair |
| **Outra pessoa**, mesma instituição → outro token | O endereço de um não desinscreve o outro |
| **Mesma pessoa, outra instituição** → outro token | O slug é público: sem o `tenantId` no HMAC, sair da casa A tiraria a pessoa da casa B |
| Trocar o segredo invalida todos os endereços | Custo declarado, igual ao do `.ics` |
| **Sem segredo utilizável** (ou curto demais) → `null` | A mensagem sai **sem** o link; melhor do que publicar um endereço que qualquer um forja |
| A **caixa** do uuid não muda o token | O `id` que volta do banco pode vir em maiúsculas; sem normalizar, o dono do endereço recebia 404 (**defeito real, achado no E2E**) |

E a **resolução** (`resolveUnsubscribeUser`) confere o HMAC **antes de ler qualquer
coisa**: token com forma impossível nem chega ao banco; com forma válida, a leitura
percorre apenas os **vínculos ativos daquela instituição** (`user_tenant_profiles`, que
tem `tenantId` e portanto entra por RLS) e compara em **tempo constante**
(`timingSafeEqual`). A tabela `user` é global e a RLS não a protege — por isso a
resolução nunca a varre inteira.

**A prova de que token de outra instituição/pessoa não passa** (integração, com o
serviço real e o banco real):

```
o endereço do rodapé resolve a pessoa, e não resolve mais ninguém
  → o token da pessoa resolve para ela
  → o token DERIVADO de outra pessoa resolve para a outra, e não para ela
  → o token derivado para a CASA VIZINHA não resolve cá (e o de cá não resolve lá)
  → um caractere trocado no fim, o token vazio e 'x'.repeat(43) → null
```

**O que a linha guarda é o SHA-256 dele** (`tokenHash`, `CHAR(64)`, único por
(instituição, pessoa)) — o banco sozinho não vira uma lista de endereços prontos para
desfazer descadastros. A partir da fatia 3, `unsubscribePerson` grava o hash do token
que **originou** a saída quando ele é conhecido (o caminho do rodapé) e sorteia um novo
quando não é (o pedido registrado pela equipe por telefone) — sempre há um segredo
gravado, e ele nunca é o valor em claro.

### 2.2 Onde o token NÃO aparece

| Superfície | Decisão |
|---|---|
| **Log** | Nada registra a URL, e o `logger` já redige qualquer chave com `token`/`secret`/`hmac` no nome — o teste do serviço confere a mensagem, nunca o valor |
| **`Referer`** | A página **não carrega recurso externo nenhum** (nem imagem remota, nem fonte, nem script de terceiro): sem subrecurso externo não há requisição com referenciador para fora. O único caminho de saída é um link **interno**, com `rel="noreferrer"` |
| **Prévia da tela de comunicação** | O rodapé aparece com um token de **EXEMPLO** (`PREVIEW_UNSUBSCRIBE_TOKEN`), do mesmo formato e que não resolve ninguém: a prévia prova o formato, e não entrega credencial de terceiro |
| **Metadados** | `generateMetadata` não lê o token, e a página sai com `robots: { index: false, follow: false }` |

---

## 3. Decisões técnicas explicadas

### 3.1 O catálogo **recusa** em vez de falhar aberto

`composeSegment` trata quatro bordas, e **três delas recusam**:

1. **lista vazia** → `SEGMENTO_VAZIO`. "Todas as condições valem" com zero condições é
   verdade vazia, e o `E` vazio **selecionaria a instituição inteira**;
2. **parâmetro inválido ou não declarado** → `DEFINICAO_INVALIDA`. Descartar em silêncio
   enviaria para mais gente do que o pedido;
3. **exclusão inválida** → recusa, e a exclusão **não** é aplicada como nula (seguir sem
   ela mandaria a mensagem justamente para quem o organizador excluiu);
4. **condição repetida** (mesmo id e mesmos parâmetros) → **aviso**, não erro: `E` é
   idempotente, e manter as duas só faria a contagem parecer maior. Mesmo id com
   parâmetros **diferentes** são dois filtros de verdade.

A mesma régua vale na leitura do snapshot: `parseStoredDefinition` transforma um
`definition` corrompido em **lista vazia** — e a composição recusa. Nada de
"adivinhar o que a definição queria dizer".

### 3.2 A catraca entre o catálogo e os construtores

`SEGMENT_BUILDERS` é `Record<SegmentConditionId, SegmentBuilder>`: o **`tsc` reprova**
a condição sem construtor **e** o construtor sem condição. É o mesmo desenho do
`JOB_CATALOG` das rotinas. O teste de unidade confere as duas direções em tempo de
execução (`segmentBuilderIds()` × `segmentCatalogIds()`), para o caso de alguém afrouxar
o tipo com um `as`.

E o **recorte de evento** tem catraca própria: o catálogo declara `requiresEvent` e o
teste confere que o construtor declara o mesmo — uma condição que passasse a exigir
evento sem dizê-lo cairia no `eventScoped` e devolveria "selecione ninguém" no lugar de
uma recusa.

### 3.3 A máscara da F60 vale na lista, e não no envio

Quem **ocultou o perfil RECEBE**: a ocultação da F60 é sobre **visibilidade pública**,
não sobre receber o que é da instituição da pessoa. O que muda é a **tela interna**
(prévia, lista do segmento, e a prévia da mensagem) — e a régua não é reescrita:
`isPersonPubliclyVisible` decide e `maskPersonName` mascara, as duas da fonte única onde
a E79 as juntou. O `select` pede `publicProfileHiddenAt` **de propósito**: é campo
obrigatório de `segmentRecipientIdentity`, e o `tsc` acusa quem o esquecer.

### 3.4 O corpo é por destinatário, e o assunto não

Os marcadores são resolvidos **no disparo**, um corpo por destinatário, **antes do
`queueEmail`**: o outbox grava o HTML/Texto já personalizado, e a linha continua
respondendo "o que esta pessoa recebeu?". O **assunto não é personalizado** — ele viaja
num cabeçalho, e o `subject` do outbox é a chave pela qual a operação reconhece a
campanha; "Sua vaga, Ana" e "Sua vaga, Bruno" pareceriam duas campanhas na caixa de
saída.

### 3.5 O link do rodapé e o "pula quem saiu" saem da MESMA derivação

Não são duas regras que precisam concordar: é uma só. O rodapé usa
`unsubscribeUrlFor({ tenantSlug, tenantId, userId })` e o filtro de exclusão consulta
`communication_unsubscribes` com `resubscribedAt: null`. O teste de integração prende as
duas pontas: o endereço que o disparo escreveu no e-mail é **igual** ao que o serviço
deriva para a mesma pessoa (E2E, caso 1), e a campanha seguinte **não** alcança quem saiu
(E2E, caso 2 — com os números do outbox).

### 3.6 A transacional não sabe do descadastro — e isso é requisito

O aviso de vaga retida, o de prazo, o de confirmação/liberação, a promoção da lista de
espera, o material de apoio e o certificado continuam saindo. Não é teimosia: calar
esses avisos faria alguém perder a vaga por não ter sido avisado de que precisava
confirmar, e faria o certificado existir sem que ninguém soubesse.

A lista do que continua chegando é **código** (`TRANSACTIONAL_EMAILS`, no serviço), e
não texto copiado na página: a mesma frase aparece no rodapé do e-mail que trouxe a
pessoa e nos dois blocos da tela, e duas cópias divergiriam no dia em que o produto
mudasse. O que a página diz, ao usuário, é literalmente isto:

> **O que deixa de chegar** — os **recados em massa** de *instituição*: campanhas,
> divulgação de atividades, avisos gerais e convites que a instituição mande para um
> grupo de pessoas.
>
> **O que continua chegando** — os avisos que são **obrigação da instituição com você**
> — eles não são divulgação, e por isso não dependem desta escolha:
> • Aviso de que a sua vaga está retida e precisa de confirmação, com o prazo.
> • Aviso de que a vaga foi confirmada, liberada ou que você saiu da lista de espera.
> • Material de apoio das atividades em que você se inscreveu ou das quais é palestrante.
> • Certificado emitido, com o código de validação.
>
> Se você quer parar de receber também esses avisos, fale com a instituição: eles
> envolvem vaga, prazo e documento, e a conversa é com uma pessoa.

E o e-mail diz o mesmo, em duas linhas do rodapé — incluindo "os avisos da sua vaga, os
prazos, o material das atividades e o certificado **continuam chegando**".

### 3.7 A permissão do disparo é `participant:message`, e não `communication:read`

Hoje OWNER, ADMIN e ORGANIZER têm as duas, então a escolha não muda quem passa. Ela muda
o **significado**, e é o significado que sobrevive à próxima concessão: a caixa de saída é
**conferência** ("o que a plataforma enviou?"), e campanha é **comunicação em massa**, com
efeito fora da plataforma. O catálogo de permissões já declara exatamente essa distinção
na justificativa de `participant:message`: *"quem só precisa conferir não deve poder
disparar e-mail em massa"*. Escolher `communication:read` faria a primeira concessão
estreita ("dá para ela ver a caixa de saída") entregar, de brinde, o botão de mandar
mensagem para a instituição inteira.

**O que a tela esconde, ela anuncia:** a aba some para quem não pode enviar, e a Server
Action **reconfere** a permissão do zero (uma Server Action é um endpoint HTTP).

### 3.8 Alternativas descartadas, com o motivo

| Alternativa | Por que não |
|---|---|
| **`TabNav` compartilhado** para as abas `?aba=saida\|segmentos` | O `TabNav` da casa navega por **rota** (`href` de página), e as abas da comunicação são **query string** na mesma rota. Usá-lo exigiria duas rotas novas (`/comunicacao/segmentos`) e quebraria o `aria-current` de "Caixa de saída" — que é o endereço padrão. A navegação por **link com `aria-current`**, montada na própria tela, é a mesma forma dos filtros da caixa de saída e preserva o endereço compartilhável |
| **Construtor booleano livre** | Filtro que ninguém lê e que não se explica seis meses depois. O catálogo de condições com frase própria produz uma seleção que se lê em voz alta |
| **Mostrar a frase do catálogo em cada filtro do formulário** | A frase troca o parâmetro pelo **nome** da coisa, e o nome depende de uma consulta de rótulos que só existe no resultado. Sem ela, "Quem está inscrito `9a48279c-…`" é o que apareceria — um uuid cru na tela. As frases **resolvidas** aparecem no resultado, que é onde o organizador as lê antes de enviar |
| **Apagar marcador desconhecido** | Produz "nos vemos em ." — um e-mail que parece certo e diz menos. O literal aparece e o erro é corrigível |
| **Recusar o envio por marcador desconhecido** | Uma chave a mais no texto derrubaria uma campanha de mil pessoas já revisada; marcador é enfeite, e enfeite não derruba fluxo (invariante nº 8) |
| **Recalcular "tem presença suficiente" na condição de certificado** | Seria uma **segunda régua** de elegibilidade, que divergiria da tela do certificado no primeiro dia. A condição seleciona o FATO que existe ("registrou presença e não tem certificado") e a frase diz exatamente isso |

### 3.9 As três condições que saíram do plano — por falta de fato

O plano da fase propunha três recortes que o schema **não sustenta**, e inventar a tabela
que faltava seria criar um fato falso. A recusa está escrita no cabeçalho de
`segments.ts`:

| Condição proposta | O que falta |
|---|---|
| **"certificado emitido e nunca baixado"** | Não existe registro de download **por certificado**. `certificates.validationCount`/`lastValidatedAt` são da página PÚBLICA de validação, e `downloadCount`/`lastDownloadedAt` existem apenas em `data_exports` (exportação de dado pessoal da FASE 49). Sem o fato, a condição diria "nunca baixou" sobre quem baixou |
| **"inscritos numa trilha"** | A `Track` é o eixo temático do trabalho científico e se liga a `submissions` e a `call_for_proposals`; **não há caminho dela para `registrations` nem para `activities`** (a inscrição é por ATIVIDADE). O catálogo recorta por TRILHA onde a trilha de fato existe (autor de submissão, parecer) e por ATIVIDADE onde o que existe é a inscrição |
| **"com presença suficiente"** (para o certificado) | É o **veredito** de `evaluateEligibility` (presenças, carga horária, vínculo de palestrante, pareceres, fim do evento). Recriá-lo aqui criaria a segunda régua da linha acima |

---

## 4. ADRs

### ADR-338 — O token do descadastro é DERIVADO, e não uma linha que nasce depois

**Contexto.** Todo e-mail de campanha precisa levar o endereço de saída, e o e-mail é
montado antes de a pessoa sair. A linha em `communication_unsubscribes` só existe depois
da decisão: um token guardado nela não tem como estar no rodapé.

**Decisão.** O token é **determinístico por (instituição, pessoa)**: HMAC-SHA256 de um
rótulo próprio (`eventflow:descadastro:`) derivado de `BETTER_AUTH_SECRET`, sobre
`tenantId:userId`, em base64url (43 caracteres). A comparação é em **tempo constante**
(`timingSafeEqual`), a resolução percorre apenas os **vínculos ativos da instituição do
endereço** (nunca a tabela `user` inteira, que é global e a RLS não protege), e a caixa
do uuid é normalizada nos dois lados. Quando a pessoa sai, a linha grava o **SHA-256
desse token**.

**Justificativa.** É o único desenho em que o endereço existe antes do fato sem inventar
uma linha ("pré-descadastro" marcaria como fora quem nunca pediu), sem identificador
adivinhável na URL (o `userId` seria correlacionável entre instituições) e sem uma
segunda fonte de verdade para o mesmo fato.

**Consequências.**
- **Não há revogação individual do endereço.** O token vale enquanto o vínculo valer;
  desativar a pessoa corta o acesso na hora (a resolução confere os vínculos ATIVOS),
  mas "gerar um link novo" não existe. É o mesmo custo declarado do `.ics` da FASE 65.
- **Trocar `BETTER_AUTH_SECRET` invalida todos os endereços já entregues.** A pessoa
  recupera o endereço sozinha, abrindo a tela de novo, ou pela próxima campanha.
- **O rótulo é próprio.** Sem ele, o `BETTER_AUTH_SECRET` faria o token da agenda abrir o
  descadastro e vice-versa — os dois são HMAC do mesmo segredo.
- **Sem segredo utilizável não há link**: `unsubscribeUrlFor` devolve `null` e o rodapé
  diz que o descadastro está indisponível no ambiente, em vez de mostrar um botão que não
  abre. Segredo abaixo de 16 caracteres é recusado (um HMAC com chave curta é adivinhado
  por força bruta, e a consequência aqui não é ler um dado: é desinscrever alguém).

### ADR-339 — Marcador desconhecido fica LITERAL, e a substituição é de UMA passada

**Contexto.** O corpo da campanha aceita `{nome}`, `{instituicao}` e `{evento}`, e é
substituído **por destinatário** no disparo — é o que faz uma mala direta de verdade. O
texto é escrito por uma pessoa, e ela vai escrever marcador que não existe.

**Decisão.** (a) Marcador conhecido **sem valor** (o `{evento}` da campanha da instituição
inteira) e marcador **desconhecido** ficam **literais** no que sai. (b) A substituição é
de **uma passada** (`String.replace` com callback), e não um laço de `replaceAll` por
marcador.

**Justificativa.** (a) Apagar produz um e-mail que **parece** certo e diz menos do que o
organizador escreveu ("nos vemos em ."), e quem recebe não avisa; recusar o envio faria
uma chave a mais derrubar uma campanha inteira. O literal aparece no lugar onde o erro
pode ser corrigido — e a tela de comunicação ainda **anuncia** os marcadores desconhecidos
antes do envio. (b) O laço foi escrito primeiro e **reprovou no teste**: com o valor de
`{nome}` igual a `{evento}`, a passada seguinte trocava o que tinha acabado de entrar, e
o resultado passava a depender da ORDEM do catálogo — ordem não é contrato, e um catálogo
reordenado mudaria e-mails já prontos.

**Consequências.**
- O assunto **não** é personalizado (ele é a chave pela qual a operação reconhece a
  campanha no outbox).
- O marcador literal é um efeito visível na mensagem que a pessoa recebe: é o preço
  escolhido, e é menor do que o de um e-mail que mente.
- O teste `o VALOR inserido não é reprocessado` é o que prende (b), e ele nasceu
  reprovando.

### ADR-340 — O descadastro vale para o recado em massa; o transacional continua

**Contexto.** A fase dá à pessoa o direito de parar de receber os e-mails da instituição.
Levado ao pé da letra, esse direito calaria também o aviso de que a vaga dela precisa de
confirmação — e ela perderia a vaga por não ter sido avisada.

**Decisão.** O descadastro é **por instituição e por canal** e alcança apenas as
**campanhas segmentadas**. Os avisos transacionais (vaga retida e prazo, confirmação,
liberação, promoção da lista de espera, material de apoio, certificado emitido) **não
consultam** o descadastro e continuam chegando. A lista do que continua é **código**
(`TRANSACTIONAL_EMAILS`) e é dita nos dois lugares: no rodapé do e-mail de campanha e nos
dois blocos da página de descadastro.

**Justificativa.** O transacional é **obrigação da instituição com a pessoa**, e não
divulgação: ele existe para que a pessoa não perca o que é dela. Além disso, o
descadastro é um direito sobre **comunicação de marketing/recado em massa**; prometer que
"nenhum e-mail" chegaria seria prometer o que a instituição não pode cumprir — e a
promessa quebrada é o caminho mais curto para a marca de spam, que é justamente o que
esta fase existe para evitar.

**Consequências.**
- **A dívida D9 fica parcialmente quitada e precisa ser reescrita:** existe central de
  opt-out para o recado em massa, e continua não existindo para o transacional nem para a
  celebração de carta (D5).
- Quem quiser parar **também** com o transacional tem de falar com a instituição — a
  página diz isso, com todas as letras, em vez de oferecer um botão que não cumpre.
- O teste do portão de acessibilidade e o E2E do descadastro prendem as duas pontas: o
  aviso de vaga retida é **enfileirado para quem saiu**, com a subjetiva de que o HTML
  dele **não** tem rodapé de descadastro.

---

## 5. Lições aprendidas — defeitos REAIS encontrados por testes

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | O teste de unidade `o VALOR inserido não é reprocessado` reprovou: `{evento} e Instituto…` no lugar de `{evento} e …` | `renderCampaignMarkers` substituía marcador por marcador num laço; o valor inserido por uma passada era trocado pela seguinte, e o resultado dependia da ORDEM do catálogo | Substituição de **uma passada** com `String.replace` e callback; o caso ficou como catraca |
| 2 | O E2E `o endereço do rodapé resolve a pessoa` devolvia `null` para o token que ele mesmo tinha acabado de gerar | **A caixa do uuid**: a fixture cria a pessoa com `randomUUID()` (minúsculas) e o `id` que volta em alguns caminhos vem em MAIÚSCULAS; o HMAC de `A1B2…` e o de `a1b2…` são tokens diferentes para a MESMA pessoa | `toLowerCase()` nos dois lados, dentro do domínio; o caso `a CAIXA do uuid não muda o token` ficou como catraca |
| 3 | O E2E da página de descadastro reprovou `toHaveAttribute('data-out','false')` **depois** de a ação responder sucesso | O POST de uma Server Action sem `revalidatePath` deixava o cliente servir a versão anterior do `Router Cache` — o banco ficava certo e a TELA afirmava o oposto | `revalidatePath` com o caminho da própria página nas duas ações |
| 4 | Os testes `a contagem acompanha a seleção` e mais seis reprovaram com `expected 6 to be 5` | A fixture nova do descadastro foi inscrita na **mesma atividade** do cenário, e as contagens de "quem tem vaga na oficina" são contrato de sete casos | A pessoa do descadastro ganhou **atividade própria** (com a mesma `confirmationPolicy`): reescrever a régua para caber a fixture é o caminho mais curto para a régua deixar de medir |
| 5 | O `beforeAll` da integração reprovou com `Unique constraint failed: registrations_live_event_user_key` | O cenário tentou semear quatro inscrições do mesmo vizinho no mesmo evento com `activityId` nulo — e o índice é único por (evento, pessoa) enquanto o status é vivo (cancelamento é terminal) | Cada estado vivo ganhou a **própria atividade** (é o que o índice está dizendo); a cancelada ficou no nível do evento |
| 6 | O E2E `duas pessoas recebem corpos diferentes` reprovou por vacuidade: `expected 1 to be greater than 1` | O segmento da fixture tinha **uma** pessoa só — e "duas pessoas recebem corpos diferentes" não se prova com uma | Uma segunda pessoa na mesma atividade |
| 7 | O E2E do "caminho de volta" reprovou com `No record was found` | O helper buscava o endereço numa **campanha anterior**, e o Playwright não promete ordem entre `test()`; a pessoa ainda não tinha recebido campanha nenhuma | O endereço passou a ser **derivado** pelo serviço (o token é determinístico) e os quatro casos viraram um percurso `describe.serial`, com a dependência declarada |
| 8 | O E2E reprovou `getByTestId('unsubscribe-feedback')` com "element(s) not found" **quando a tela estava certa** | O `revalidatePath` faz a página voltar REDESENHADA, e o formulário que produziu a mensagem sai de cena levando a mensagem junto | A asserção passou a medir o ESTADO (`data-out`) e o BANCO (a linha), que é o que a tela afirma; a mensagem transitória não é o fato |
| 9 | O portão WCAG AA reprovou a página de descadastro com **três nós de `color-contrast`** | O par `opacity-60`/`opacity-75` que as páginas públicas da casa herdaram: `opacity` não escolhe cor, ela COMPÕE o texto com o fundo, e o resultado fica abaixo de 4,5:1 | O texto passou a `text-muted-foreground` (`--ef-on-surface-variant`, `#464555`), o token de TINTA secundária — o mesmo papel que o rótulo do grupo de aparência recebeu na FASE 63 |
| 10 | A primeira correção do item 9 usou `.ef-muted` / `.ef-muted-on-card` e "passou" — mas por ACIDENTE | As duas classes resolvem em `color-mix(… var(--ef-text) … var(--ef-background))`, e essas variáveis **só existem dentro de `.ef-theme`** (a página do EVENTO). Aqui a declaração de cor era **inválida**, o navegador a descartava e o texto caía na cor herdada | Trocar por um token que existe no escopo da página. Lição: um par que depende de variável inexistente é um par que ninguém está medindo |
| 11 | A linha de base `comunicacao-segmentos` reprovou com **214 pixels** diferentes na segunda execução | O e-mail de quem está logado na barra lateral **não estava mascarado** naquele caso, e o bloco da prévia tinha um pixel de borda instável | Entrou a `mascaraDoEndereco(barraLateral(page))` e a data do histórico ganhou `data-testid` próprio para ser mascarada sem tapar o autor; duas execuções seguidas deram **zero pixel** |
| 12 | O teste de unidade `o separador do par não colide` reprovou | A premissa estava errada: `'a'` + `'b:c'` e `'a:b'` + `'c'` concatenam em `a:b:c` — o `:` não separa nada. O que garante a unicidade do par é o **formato** dos dois lados (uuid: hexadecimal e hífen) | O caso foi reescrito para prender a propriedade que existe: o par é **ordenado**, e trocar instituição por pessoa muda o token |
| 13 | O teste `a chave usada em código NÃO é marcador` reprovou: `${x}` **é** lido como marcador | O padrão casa `{` + letra + `}` e o `$` fica FORA do casamento. O produto se comporta certo (`x` não é marcador conhecido, então sai literal), mas a asserção afirmava outra coisa | O caso passou a prender o comportamento real: `${x}` é lido, **não é conhecido** e sai literal |

### 5.1 O que a auditoria das 15 condições encontrou (Tarefa B6)

**As 15 têm prova dos DOIS lados** — `tests/integration/f67-segmentos.test.ts`,
`describe('cada condição do catálogo seleciona quem deve e não seleciona quem não deve')`.
Cada caso declara **testemunhas**: quem a condição tem de pegar e quem ela **não** pode
pegar. As negativas são "quase-acertos" de propósito — o da lista de espera, o que já
confirmou, o que voltou à tarde, o que tem material —, porque é aí que um filtro errado
passaria despercebido.

| Condição | Prova positiva | Testemunhas negativas |
|---|---|---|
| `inscricao-sem-confirmacao` | a vaga retida | o que confirmou, o da espera, o que cancelou, o que compareceu |
| `inscricao-em-espera` | o da lista de espera | o retido, o confirmado, o que compareceu |
| `inscricao-cancelada` | o que cancelou | o confirmado, o da espera, o retido |
| `presenca-manha-sem-tarde` | o que veio de manhã e não voltou | o que voltou à tarde, o que só veio à tarde, o que nunca veio, o confirmado |
| `nunca-credenciado` | o inscrito sem nenhuma presença | o que veio de manhã, o que veio à tarde, o que cancelou |
| `minutos-abaixo` | o de 50 min e o de 0 min | o de 170 min, o de 120 min, o que cancelou |
| `autor-aprovado-sem-material` | o aprovado sem material na sessão | o que tem material, o aprovado **sem sessão** (não há onde o material viver), o confirmado |
| `revisor-com-parecer-pendente` | o convidado a avaliar | o que já submeteu, o confirmado |
| `proposta-em-rascunho` | o rascunho de chamada | a proposta enviada, o confirmado |
| `inscrito-na-atividade` | os com vaga na oficina | o da espera, o que cancelou, o de outra atividade |
| `inscrito-na-sala` | o da oficina (Sala A) | o de outra sala, o de outra atividade, o da espera |
| `presenca-sem-certificado` | os que registraram presença | o que tem certificado, o que nunca veio, o confirmado |
| `perfil-incompleto` | o sem foto e sem bio | o de perfil completo |
| `xp-acima` | o de 500 XP | o de 10 XP, o confirmado, o **vizinho** de 900 XP |
| `carta-conquistada` | o que tem a carta | o confirmado, o de XP alto |

Além da tabela, os casos que fecham as bordas: a **janela da manhã no FUSO DO EVENTO**
(em UTC o check-in de 12:00Z cairia fora e a condição selecionaria NINGUÉM), o parâmetro
que **recorta de verdade** (a mesma condição com e sem filtro), a contagem que acompanha
a seleção, a lista limitada que informa que truncou, a condição de evento **sem evento**
(`EVENT_REQUIRED`, e não "todo mundo"), o evento de OUTRA instituição (`NOT_FOUND`, a
leitura é sob RLS) e o snapshot com condição que o catálogo não tem (`INVALID_SEGMENT`, e
não erro interno).

**A lacuna que a auditoria achou — e que foi fechada nesta fatia:** o isolamento entre
instituições tinha prova para **uma** condição (`xp-acima`). O que a pergunta certa é
outra: **cada um dos quinze construtores carrega a cerca?** São quinze consultas escritas
à mão — quatro delas em SQL —, e é exatamente o tipo de código em que uma cerca esquecida
passa despercebida: o filtro continua parecendo certo, a contagem continua plausível, e a
campanha sai para o público de outra instituição.

O caso novo (`nenhuma das 15 condições deixa vazar gente da instituição vizinha`) monta um
vizinho com o **mesmo fato que cada condição procura** — inscrição retida, em espera,
cancelada e com presença; presença FORA da janela da manhã e dentro da tarde; submissão
aprovada sem material **com** atividade; parecer pendente; proposta em rascunho;
certificado; perfil incompleto; XP e carta — e pergunta, condição por condição, se algum
deles vaza. O `Record<SegmentConditionId, …>` já obriga o `tsc` a cobrir o catálogo
inteiro, e uma linha confere a mesma coisa em tempo de execução (um catálogo que cresça
sem caso aqui **reprova** em vez de passar em silêncio).

E um segundo caso — `os fatos do vizinho EXISTEM` — conta o que foi semeado do lado de
lá. Sem ele, "a seleção não trouxe ninguém de fora" seria verdade também se o vizinho não
tivesse fato nenhum: **o teste passaria por vacuidade**. Foi exatamente o defeito que o
caso 6 da tabela de lições encontrou no E2E.

**Nenhuma condição ficou sem prova, e nenhuma foi declarada impossível.**

---

## 6. Evidência de verificação

### 6.1 A bateria da §4 do `AGENTS.md`

```
npm run lint       →  0 erros, 0 warnings
npm run typecheck  →  0 erros
npm test           →  176 arquivos · 3350 testes passando
npm run build      →  ✓ Compiled successfully in 12.9s
                       ├ ƒ /t/[tenantSlug]/descadastro/[token]      ← a rota nova, listada
npm run db:verify  →  Contrato íntegro.
npm run db:verify:isolation → 9/9 verificações passaram.
```

### 6.2 O portão WCAG AA — **23 casos**, `ISENCOES = []`

```
Running 23 tests using 1 worker
  ✓  16 … a aba "Segmentos" da comunicação não tem violação crítica
  ✓  17 … a página de descadastro (recebendo) não tem violação crítica
  ✓  18 … a página de descadastro (fora da lista) não tem violação crítica
  23 passed (39.7s)
```

**A catraca mordeu, e o achado é o registro:** a primeira execução dos três casos novos
reprovou os **dois** de descadastro com

```
  ✗ color-contrast (serious) — Elements must meet minimum color contrast ratio thresholds
    elementos (3):
      .uppercase
        <p class="text-xs uppercase tracking-wide opacity-60">Instituição Acessível …</p>
```

**três nós** abaixo dos 4,5:1 do AA, causados por `opacity-60`/`opacity-75` no texto. A
correção (item 9 e 10 das lições) fez os 23 casos passarem. **Nenhuma isenção foi
adicionada** — a lista continua vazia, e o teto continua em 2.

### 6.3 A regressão visual — de 19 para **21 linhas de base**

```
20. a aba "Segmentos" com um segmento montado   →  comunicacao-segmentos.png
21. a página de descadastro                     →  descadastro.png
```

**A decisão de incluir, e a medição que a sustentou.** Duas coisas quase tiraram a aba da
suíte, e as duas foram resolvidas com medição em vez de opinião.

**(a) A data do histórico.** O arquivo já tinha a régua escrita: "data que muda todo dia não
é regressão visual". A primeira tentativa mascarou só o `<span>` da data — e ela **piscava**:
o carimbo tem largura variável (`10/03/2126, 14:05` e `… 09:05` não medem o mesmo), a caixa da
máscara acompanhava e a linha de base acusava **1.143 a 2.041 pixels** de diferença entre
execuções. É a lição das quatro máscaras da aba do "agora" cobrada de novo: **máscara de nó que
muda de tamanho é máscara que se mexe**. A máscara cresceu para a linha inteira
(`campaign-meta`), que é caixa estável — e o autor, dado de fixture, sai tapado junto.

**(b) O instante da última passada.** Depois disso sobravam **16 pixels** persistentes, sempre
depois do fim do `<li>` da passada. A leitura honesta: essa linha imprime **número de fixture
mais carimbo de relógio**, e o carimbo muda a cada execução. A máscara passou a cobrir a linha
dos números (`campaign-counts`) — e o que ela esconde é provado por asserção (o E2E da fase
prende "Selecionados: N" no histórico e o portão de acessibilidade varre esta mesma linha). O
que a imagem perde é um número; o que ela mantém é a linha, a altura e o desenho da campanha.

**O resultado, medido:** com as duas máscaras, **duas execuções seguidas deram ZERO pixel** nas
21 linhas de base (`maxDiffPixelRatio: 0`, `threshold: 0.04` — a tolerância medida na FASE 62).

**E o preço pago pelas linhas de base que já existiam** — nenhuma delas de desenho:

| Linha de base | O que mudou | Pixels diferentes | Ação |
|---|---|---|---|
| `painel-desktop-claro` | cartão "Atividades": 1 → 6 | **23** (na caixa do dígito) | regerada |
| `painel-desktop-escuro` | o mesmo | **15** | regerada |
| `participantes-desktop-claro` | a lista é união de vínculo e inscrição: +2 contas | **989** (na tabela) | regerada |
| `participantes-desktop-escuro` | o mesmo | **1004** | regerada |
| `evento-aba-agora` | rodapé do evento: "5 atividades · 9h" → "6 · 10h" | **781** (medidos) | **não tocada** — com a oficina em outro evento, o rodapé voltou ao anterior e a regeração saiu **idêntica** |
| `minha-agenda-claro/escuro` | **nada** — a oficina foi para um evento só dela | **0** | **defendida** |
| `pagina-da-instituicao-claro/escuro` | **nada** — o evento da oficina nasce RASCUNHO | **0** | **defendida** |

As duas últimas são o registro que importa: em vez de regerar, a **fixture** mudou. A primeira
versão pendurou a "Oficina dos segmentos" no evento da vitrine, e a "minha agenda" passou a
medi-la (3 itens, 2 inscritas, 3 choques); ajustar horários para os números voltarem virou caça
ao resultado. Com a oficina num evento só dela, os números da FASE 65 ficaram intactos. E, com
o evento dos segmentos **publicado**, a página da instituição piscava **1.886 pixels** — o
evento entrava em "Em breve" ao lado da vitrine, e os dois títulos começam por "Mostra de".
Rascunho não aparece em grupo nenhum, e nenhuma asserção de vitrine precisou mudar.

### 6.4 O E2E do descadastro — 4 casos, um percurso

```
Running 4 tests using 1 worker
  ✓  1. o endereço do rodapé abre a página, explica e confirma a saída (4.2s)
  ✓  2. quem saiu SOME do segmento, e o disparo seguinte não a alcança (1.3s)
  ✓  3. o TRANSACIONAL continua chegando para quem saiu (345ms)
  ✓  4. o caminho de volta devolve a pessoa à contagem e ao disparo (2.0s)
  4 passed (10.8s)
```

Os quatro são um **percurso** e por isso rodam em `describe.serial`: o caso 2 pergunta "depois
que ela saiu, o disparo a alcança?", e essa pergunta não existe se a saída não tiver acontecido.
A primeira versão eram quatro `test()` soltos, e o caso 2 mediu um banco em que a saída ainda
não tinha acontecido — o sintoma apareceu como "a contagem não caiu", que aponta para o produto
errado. A dependência agora é **declarada**.

---

## 7. Comandos operacionais

```bash
# A fase inteira, por camada
npx vitest run tests/unit/f67-descadastro.test.ts            # o token e os marcadores (25)
npx vitest run tests/integration/f67-segmentos.test.ts       # as 15 condições, o disparo e o descadastro (44)
npx playwright test tests/e2e/f67-segmentos.spec.ts          # a aba, sem JavaScript
npx playwright test tests/e2e/f67-descadastro.spec.ts        # o descadastro de ponta a ponta

# As catracas
npx playwright test tests/e2e/accessibility.spec.ts          # WCAG AA, 23 casos, sem isenção
npx playwright test tests/e2e/f62-regressao-visual.spec.ts   # 21 linhas de base

# A rota nova (404 é a resposta CERTA para token que não presta)
curl -i "http://localhost:3000/t/<slug>/descadastro/<token>"
```

**Não há migração nesta fase** (as duas tabelas nasceram na fatia 1) e **não há rotina
nova** no worker: o disparo é uma Server Action e a entrega continua sendo o outbox da
FASE 15.

---

## 8. Dívidas técnicas e pontos de atenção

| # | Dívida | Por quê | Gravidade |
|---|---|---|---|
| **E87** (nova) | **Não há revogação individual do endereço de descadastro** | O token é derivado do par (instituição, pessoa) — o mesmo custo declarado do `.ics` da FASE 65. Desativar o vínculo corta o acesso na hora; "gerar um link novo" não existe | M |
| **E88** (nova) | **O descadastro não distingue o MOTIVO além de um campo de texto** | A tela não pede o motivo (o `reason` existe na coluna e é preenchido pelo caminho `MANUAL`). Quem quer entender *por que* as pessoas saem não tem o dado | P |
| **D9** (reescrita) | **Opt-out parcial** | O recado em massa tem caminho de saída; o transacional e a celebração de carta (D5) **não têm**, por decisão (ADR-340) | P |
| **B6** (mantida) | **`con` no lugar de `logger`** | O `campaign-service` e o `segment-service` seguem o padrão dos serviços de comunicação da casa (console), e não o `logger` estruturado | P |
| **Ponto de atenção** | **Reenviar uma campanha não confirma na tela** | `InlineActionForm` é `quietSuccess`: a resposta do reenvio aparece no `title`, e não como texto. É o comportamento compartilhado de todos os formulários inline do painel, e não um defeito desta fase — mas quem reenvia uma campanha de mil pessoas merece uma confirmação por extenso | P |
| **Ponto de atenção** | **O `TabNav` compartilhado não serve para abas por query** | Ele navega por ROTA. As abas da comunicação são query string na mesma rota, e continuam montadas na própria tela (§3.8) | — |

**Quitados nesta fase:** nenhum item do levantamento — a fase **declarou dois** (E87, E88)
e **reescreveu um** (D9).

---

## 9. Checklist de aceite

### Fatia 1 — Fundação

- [x] Catálogo de condições como regra de domínio pura, com `id` estável, rótulo, parâmetros declarados e **frase explicativa**
- [x] Composição com "todas valem" + um "exceto quem…", que **recusa** em vez de falhar aberto
- [x] Catraca catálogo ↔ construtor nos dois sentidos (o `tsc` e o teste)
- [x] Avaliação sob `withTenant`, com a cerca da instituição em um lugar só
- [x] Contagem, frases com o nome no lugar do uuid e a **máscara** da F60
- [x] Campanha com o **snapshot dos fatos** (e nunca a lista de ids)
- [x] Uma linha por destinatário no outbox existente, com `dedupeKey` da campanha
- [x] Descadastro por instituição em `communication_unsubscribes` (RLS + FORCE)

### Fatia 2 — A aba "Segmentos"

- [x] Aba em `?aba=segmentos`, com a navegação por link e `aria-current`
- [x] Formulário `GET` (endereço compartilhável) com os campos que o catálogo declara
- [x] **Contagem antes do envio**, frases resolvidas, prévia mascarada e sem e-mail de ninguém
- [x] Prévia da mensagem pelo MESMO modelo do disparo
- [x] "Enviar um teste só para mim", com o resultado real e o aviso do driver `log`
- [x] Disparo em lotes, com limite de ritmo, reserva com validade e reenvio que não duplica
- [x] Histórico com as frases **congeladas**, o autor e os números de cada passada

### Fatia 3 — Descadastro

- [x] O link no rodapé de **toda** mensagem de campanha — e **só** dela
- [x] Token determinístico por (instituição, pessoa), com HMAC, rótulo próprio e comparação em tempo constante
- [x] Página **sem login** que diz de que instituição é, o que para e o que **continua** chegando
- [x] Idempotente nos dois sentidos, com o estado vigente lido do banco
- [x] O **caminho de volta** ("voltar a receber"), inclusive para quem está dentro
- [x] O envio **pula** quem saiu, pela mesma derivação do rodapé
- [x] Token em log e em `Referer` — **não**: nada registra a URL, e a página não tem subrecurso externo
- [x] **Marcadores por destinatário** (`{nome}`, `{instituicao}`, `{evento}`), com duas pessoas recebendo corpos diferentes
- [x] Marcador desconhecido **não** vira texto vazio nem quebra o envio

### Fatia 4 — Catracas e documento

- [x] Cobertura das 15 condições auditada, com prova dos dois lados, e a lacuna de isolamento fechada
- [x] Portão WCAG AA com a aba "Segmentos" e a página de descadastro, nos dois estados, **sem isenção nova**
- [x] A catraca provou que morde (o achado real de `color-contrast` está registrado)
- [x] Regressão visual com as duas linhas de base, com a **medição** de estabilidade registrada
- [x] Este documento, com as 9 seções e os ADRs 338, 339 e 340
- [x] `AGENTS.md`, `README.md` e `docs/dividas-tecnicas.md` atualizados
- [x] A bateria da §4 rodada, com os números reais
- [x] Árvore limpa de `playwright-report/`, `test-results-*` e `.playwright*`

---

## 10. Estado da fase

**FASE 67 ENTREGUE — fatias 1, 2, 3 e 4.**

A próxima numeração de ADR é a **341**.

> Aguardando APROVADO: AVANÇAR
