# FASE 86 — O certificado é do evento: o corpo, o modelo e a régua

> **Tema:** o certificado deixou de ser um desenho da instituição com uma frase gerada
> em código. O organizador escreve o **corpo** do documento (um gabarito com as
> variáveis do catálogo), o **modelo** passa a ter endereço dentro do **evento** e a
> regra que decide quem recebe — os **75 %** e o piso de **30 min** — virou **política
> do evento**, congelada no documento no dia da emissão.
>
> **Cinco fatias, um fechamento.** A fase começou pela dívida **E92** (a presença
> somada por LINHA de `attendances`), seguiu para o corpo como elemento `BODY`, para o
> editor com as duas prévias, para a rota de modelos do evento e terminou na política
> configurável. A ordem não foi arbitrária: cada fatia só podia existir depois que a
> anterior provasse que o **hash dos documentos antigos não muda** — a régua que
> governa todas as decisões deste documento.
>
> **Base:** a FASE 40 criou o editor visual e a precedência
> EVENTO+TIPO → EVENTO → INSTITUIÇÃO+TIPO → INSTITUIÇÃO; a FASE 70 fixou que a
> configuração do evento mora em `Event.settings`; a FASE 72 mostrou o leitor
> tolerante (`readEventApiConfig`) e a chave selada por evento; a FASE 76 fixou
> "404 antes da consulta"; a FASE 78 unificou o topo; a FASE 85 fez a emissão ser do
> evento e declarou a **E92**. Esta fase **usa essas réguas** — não inventa outra
> ordem de guarda, outro leitor de `settings` nem outro caminho de emissão.
>
> **ADRs 386, 387 e 388.** A próxima é a **389**.

---

## 1. Sumário executivo

| Entrega | Onde | Prova |
|---|---|---|
| **E92 quitada**: a presença é agregada por `(userId, activityId)` antes dos fatos, com teto na janela real da atividade e na carga declarada; a linha do evento (`activityId` nulo) soma separada; `computeWorkload` intacto | `src/domain/certificates/attendance-aggregate.ts` (novo) e os dois caminhos do serviço (`loadFacts` e `loadEventFacts`) | unit `f86-agregacao-de-presenca.test.ts`; integração `f85-preview-e-emissao.test.ts` — a Gabi deixa de ser descartada 2× e o evento passa de **2 para 4 certificados** (8 descartes, 2 elegíveis, 12 pares, 6 pessoas) |
| O **corpo** virou elemento `BODY`, com gabarito `{{chave}}`, **12 variáveis canônicas** (as de conteúdo menos `corpo`), limite de **2.000 caracteres medido contra a página**, validação pura e "não cabe" estruturado (mede, não trunca) | `certificate-layout-rules.ts` e `src/domain/documents/text-measure-rules.ts` (novo) | unit `f86-corpo-do-certificado.test.ts` (38 casos); a medição é a MESMA do desenho (`fitTextInBox`), importada pelo renderizador |
| A resolução acontece **uma vez**, na emissão: o texto interpolado vai para `bodyText` **e** para `variableSnapshot.corpo`, os dois assinados; o `layoutSnapshot` guarda o **gabarito**, provando de onde o texto saiu | `certificate-service.ts` | integração `f86-corpo-do-certificado.test.ts` (8 casos): PDF com o texto resolvido e sem `{{`, reemissão com o mesmo hash, reverificação verde |
| **O hash dos certificados antigos não muda**: nenhuma variável nova no catálogo e nenhum campo novo na serialização do layout; os **5 modelos prontos** têm hash preso e o `OLD_LAYOUT_JSON` é reverificado `VALID` | `certificate-layout-rules.ts` e o catálogo | unit: hashes fixos dos 5 presets, JSON do layout preso palavra por palavra e as **13 chaves canônicas** na mesma ordem |
| O **editor**: `textarea` com o gabarito, legenda das 12 variáveis com inserção no cursor, contador, erros do domínio e as **duas prévias** (FULL × WORST_CASE); aviso "não cabe" com os números e a ação **"Aumentar a caixa"** (altura calculada no domínio) | `certificate-template-editor.tsx` | E2E `f86-corpo-do-certificado.spec.ts` (9 casos), inclusive **sem JavaScript**; portão `axe` da página de modelos |
| `BODY` + a variável `{{corpo}}` é **recusado ao salvar** (o texto sairia duas vezes); o gabarito só com opcionais **não bloqueia** — avisa que o corpo pode sair vazio | `validateLayout` e o editor | unit `f86-editor-do-corpo.test.ts` (8 casos) e E2E casos 7 e 8 |
| A rota **`.../eventos/[eventId]/certificados/modelos`** nasce com `EVENT_MANAGE` como primeira e única guarda, 404 antes da consulta, `max-w-7xl` e o mesmo editor da instituição | `src/app/.../certificados/modelos/page.tsx` (novo) e `certificate-templates-screen.tsx` (novo) | E2E `f85-emissao-do-evento.spec.ts` caso 4 (precedência na tela **e** no documento); catracas `f76` (25 páginas/26 params) e `f78` (98/83) |
| A instituição virou **"Modelos padrão da instituição"**: só `eventId = null`; a tela do evento mostra os modelos **do evento** e os **herdados** que ainda valem, com o alvo sendo a rota (texto + campo oculto, não `<select>`) | `modelos/page.tsx` e `certificate-templates-screen.tsx` | E2E `f86-corpo` caso 1 e `certificate-template.spec.ts` (o caminho pelo cartão → emissão → modelos) |
| **Posse do `eventId` validada**: evento de outra instituição e evento excluído devolvem `NOT_FOUND` **sem criar linha**; o alvo de um modelo existente é imutável e toda escrita (arte, remoção, exclusão) leva o alvo esperado | `certificate-template-service.ts` | integração `f86-modelos-do-evento.test.ts` (8 casos) |
| A seção **"Modelo deste evento"** na emissão diz qual desenho vale por tipo, separa `TEMPLATE` de `DEFAULT` e denuncia `INVALID` ("usando o desenho padrão"); o link dos modelos só existe para quem `can(EVENT_MANAGE)` | `event-template-summary.tsx` (novo) e a página de emissão | unit `f86-modelos-do-evento.test.ts` (3 casos); E2E caso 4; `f72` prende o par cartão × sub-rota |
| A **política de presença** em `Event.settings.certificatePolicy`: leitor tolerante (`readCertificatePolicy`) com recusas declaradas, `computeWorkload`/`evaluateEligibility` recebendo política **opcional** (default = hoje), três caminhos com a mesma regra | `certificate-policy-rules.ts` (novo) e `certificate-rules.ts` | unit `f86-politica-de-presenca.test.ts`; integração `f86-politica-do-evento.test.ts` (9 casos) |
| O detalhamento congela `{ policy, entries }` e **não é assinado**; a tela mostra a política em vigor, edita só com `EVENT_MANAGE` (CHAIR lê e não recebe formulário), faz **merge** das outras chaves do `settings` e audita na mesma transação | `certificate-policy-service.ts` (novo), `certificate-policy-panel.tsx` (novo) e `saveCertificatePolicyAction` | integração: adulterar a política mantém `signatureValid`; E2E `f86-politica-de-presenca.spec.ts` (2 casos) |
| A imagem da fase: o corpo editável (textarea, legenda, contador e as duas prévias) e a política em vigor na tela de emissão | `docs/imagens/f86-certificados-por-evento.png` | spec temporário **apagado** depois da captura |

**Números da fase**

```text
Arquivos novos ................... 18 (8 de produto, 10 de teste)
Testes novos (Vitest) ............ 127 (101 unit + 25 integração + 1 catraca)
Vitest ........................... 4690 em 264 arquivos — 0 vermelhos
E2E .............................. 507 casos — 506 passando + 1 skip, 0 vermelhos
Migrações ........................ 0
ADRs ............................. 3 (ADR-386, ADR-387 e ADR-388) — a próxima é a 389
Dívidas .......................... 1 quitada (E92) e 2 declaradas (E93 e E94):
                                   a contagem vai de 46 para 48
Consultas da projeção ............ 6 chamadas Prisma (a agregação e a política entram
                                   nos `select` que já existiam — nenhuma consulta nova)
Variáveis do gabarito ............ 12 (as 13 de conteúdo menos `corpo`)
Limite do gabarito ............... 2.000 caracteres (medido contra a página)
```

---

## 2. O problema mais difícil: **mudar o corpo sem mudar o hash de ninguém**

O pedido parecia simples: o organizador quer escrever o texto do certificado. O
caminho óbvio — acrescentar uma variável `corpo` ao catálogo e deixar o editor
preencher — está **errado**, e o motivo é a regra mais antiga do documento: o hash
cobre o conteúdo canônico, e `serializeContentValues` percorre o catálogo **ATUAL**,
gravando `''` para toda chave ausente. Uma variável a mais no catálogo mudaria o
payload de **todo** certificado versão 2 já emitido; a reverificação os marcaria como
`TAMPERED`, e o produto acusaria de adulteração documentos que ninguém tocou.

O mesmo vale para campo novo em `serializeLayout`: o `layoutSnapshot` é serializado
pelo mesmo código que calcula o hash, então acrescentar `templateBody`, `bodyStyle` ou
qualquer propriedade nova reprovaria o passado. **O corpo tinha de caber no que o
layout já sabia serializar.**

A saída foi o elemento: `kind: 'BODY'` com o texto-gabarito no campo `text`, que o
layout **já** tinha. Um modelo gravado antes da fase nunca tem `BODY`, logo serializa
exatamente como antes. O corpo não é uma variável nova; é um **elemento** novo, e o
elemento só existe no modelo que o organizador criar a partir de agora.

O segundo problema é o irmão do primeiro: **quando** interpolar. Se o renderizador
lesse o gabarito do snapshot e interpolasse na hora de desenhar, o documento impresso
dependeria do dado **atual** (nome do evento, CPF, título da apresentação) e não do
que foi assinado — dois documentos com o mesmo hash poderiam sair diferentes. A
resolução acontece **uma vez**, na emissão, depois da alocação do código de validação:

```text
layoutSnapshot ................. o GABARITO, com {{chave}} (é o que o hash cobre)
bodyText ....................... o texto RESOLVIDO (entra no conteúdo canônico)
variableSnapshot.corpo ......... o MESMO texto resolvido (entra no conteúdo canônico)
elementText(BODY) .............. values.corpo — o renderizador NUNCA reinterpreta
```

A prova não é argumento: os cinco modelos prontos têm hash preso, o JSON de um layout
antigo é reverificado com o serializador de **hoje** e o certificado criado com ele
continua `ok` e `signatureValid`; e uma emissão nova, reemitida, mantém o mesmo hash.

O terceiro problema é o que a fatia 5 acrescentou: a régua dos 75 % virou **dado do
evento**. Ela precisa ser lida na emissão, aplicada na simulação e gravada no
detalhamento — mas o detalhamento **não entra no conteúdo canônico**. Congelar a
política ali explica o documento sem assiná-lo. Essa é uma consequência declarada
(§8): quem alterar o JSON do banco muda a explicação, não o que o documento afirma.

---

## 3. Decisões técnicas

### 3.1 A presença soma por PESSOA × ATIVIDADE, com teto na janela

`attendances` guarda uma linha por **visita** (ADR-149). `computeWorkload` avalia uma
entrada por linha — é a assinatura dele, e ela não muda. O que mudou foi o que se
entrega a ele: `aggregateAttendanceByActivity` agrupa por `(userId, activityId)`, soma
os minutos medidos, aplica o teto e devolve uma linha por par.

Três decisões dentro da função:

- **sem check-out a linha vale zero** — o documento atesta tempo cumprido, e tempo não
  medido não é tempo cumprido;
- **o teto é o menor entre a carga declarada e a janela real** (`endsAt − startsAt`) —
  somar visitas abriria a porta para minutos que não existiram na sala; uma janela de
  duração zero é tratada como **ausente**, não como teto zero, porque zerar a presença
  recusaria o documento de todo mundo por causa de uma agenda quebrada;
- **`activityId` nulo é uma chave própria** — a linha da portaria é o fato do EVENTO,
  não de uma atividade; misturá-la daria à pessoa minutos que ela não passou naquela
  sala. O certificado de PARTICIPAÇÃO continua decidido por `eventCheckedIn`.

A saída é ordenada por `userId` e `activityId` com comparação de caractere (não
`localeCompare`): a simulação e a emissão leem o mesmo dado em ordens que o banco não
promete, e duas leituras têm de produzir os mesmos fatos. A agregação é **em memória**
— nenhuma consulta nova, e a régua de 6 chamadas Prisma da projeção continua fechando.

### 3.2 O corpo é ELEMENTO, e o gabarito tem lista canônica

`BODY` entra em `CERTIFICATE_ELEMENT_KINDS` com rótulo humano. `validateLayout`
garante **um** corpo por modelo (`DUPLICATE_BODY`), recusa corpo vazio e valida o
gabarito. O `BODY` **não substitui o bloco probatório**: QR e as variáveis
`codigo_validacao`/`url_validacao` continuam obrigatórios, e um `{{codigo_validacao}}`
escrito **dentro** do corpo é texto do organizador — não conta como bloco.

A lista do gabarito é **derivada** do catálogo de conteúdo, menos `corpo`:

```text
nome · cpf · titulo_apresentacao · titulo · evento · atividade
carga_horaria · periodo · data_emissao · instituicao
codigo_validacao · url_validacao
```

`corpo` fica fora porque seria recursão (o gabarito é o corpo); `hash`, `assinatura` e
`chave` ficam fora porque são auditoria — nascem do documento e não podem ser
interpolados nele (o hash entraria na conta dele mesmo). Eles continuam imprimíveis
como elementos `VARIABLE` no bloco probatório.

O limite de **2.000** é do **gabarito**, não do texto resolvido. Foi medido contra a
página A4 paisagem: o corpo padrão dos modelos prontos comporta ~520 caracteres; uma
caixa generosa de 249 × 140 mm a 10 pt comporta ~4.470; a página inteira a 9 pt,
~10.670. Dois mil é ~4× o corpo padrão e menos da metade da caixa generosa — cabe com
folga e para de valer como "texto formal" antes de virar um documento colado dentro do
certificado. Não se reusa `MAX_ELEMENT_TEXT` (600), calibrado para rótulo curto.

**Token desconhecido é recusa, nunca "apaga em silêncio".** A mensagem diz qual token
não existe e lista os válidos; um `{{` sobrando também é recusado. Um documento
formal com um buraco onde deveria estar o nome do evento é pior do que um erro de
digitação visível antes de emitir.

### 3.3 A medição mora no domínio — e mede, não trunca

A medição de texto nasceu em `layout-draw.ts`/`pdf-text.ts`, junto do desenho. O corpo
precisou da mesma conta **no domínio** para responder "o gabarito cabe na caixa?"
antes de emitir. Duas saídas foram descartadas: reimplementar a conta no domínio
(duas réguas divergem no primeiro ajuste) e deixar a regra na camada de desenho (o
domínio passaria a depender de infraestrutura). A medição foi para
`src/domain/documents/text-measure-rules.ts` e o desenho a **importa** — é a mesma
conta nos dois lados.

`fitTextInBox` devolve `lines`, `maxLines`, `lineCount`, `overflowLines` e `fits`;
`measureCertificateBody` acrescenta o aviso estruturado `BODY_DOES_NOT_FIT`.
**Medir ≠ truncar**: o desenho corta o que não couber e marca a última linha com "…"
(comportamento certo do PDF); o aviso é o outro lado, para quem está montando o modelo
ver os números **antes** de emitir.

A ação "Aumentar a caixa" também é domínio: `bodyBoxHeightForLines` é a inversa da
mesma régua (`sizePt × lineHeight` por linha), arredondada **para cima** em 0,1 mm e
presa à página a partir do topo do elemento. Quando a página não comporta, devolve
`clamped` — a tela oferece o caminho manual em vez de prometer um ajuste impossível.

### 3.4 A prévia é DUPLA, e resolve o gabarito pelo caminho da emissão

A prévia antiga usava `sampleVariableValues()` — todas as variáveis preenchidas. Ela
continua existindo (`FULL`), e ganhou a irmã `WORST_CASE`, que esvazia as variáveis de
**conteúdo** que podem faltar. É o pior caso real do documento (atividade de evento
inteiro, evento sem datas, pessoa sem CPF, autor sem trabalho) e é onde o organizador
vê se o texto fica com buraco. As variáveis de auditoria **não** são esvaziadas: elas
são linhas de prova, não frase.

A prévia **não** usa o exemplo do catálogo para `corpo`: passa por
`certificatePreviewSample`, que resolve o gabarito e mede o texto resolvido. Se
entregasse o exemplo, o organizador aprovaria uma prévia e emitiria outra coisa.

**A prévia é uma foto do render**, não um cálculo a cada tecla: o SVG vem do servidor
(e o editor mede o texto localmente para o aviso "não cabe"). Recalcular o SVG a cada
caractere pagaria um round-trip por tecla; a decisão está declarada no §8.

### 3.5 O editor: o `textarea` e as duas armadilhas reais

O gabarito é texto formal, com parágrafos: um `<input>` de uma linha apagaria as
quebras que `wrapToWidth` usa. O campo é `textarea`, controlado, com contador e erros
do domínio. A legenda das 12 variáveis insere `{{chave}}` **na posição do cursor** e
devolve o foco depois do render — o próximo token entra depois do que acabou de ser
inserido, não no fim do texto. Sem JavaScript, a legenda continua visível e o token é
digitado à mão no mesmo campo; não há um segundo formulário que gravaria outro corpo.

**Duas armadilhas apareceram no caminho:**

1. **O CRLF do `textarea`.** O HTML codifica o valor do formulário com `\r\n`, em
   qualquer sistema. Guardar o CRLF faria o layout — e o hash — depender do navegador
   que salvou o modelo, e o `\r` sobraria no fim de cada linha impressa. A porta do
   formulário (`buildLayoutFromRows`) normaliza `\r\n?` para `\n`; a conversão é na
   porta, não em `normalizeLayout`, para nenhum layout já gravado mudar de
   serialização.
2. **O desalinhamento de `elementText`/`elementKind`.** `buildLayoutFromRows` lê
   listas paralelas por índice. A linha `VARIABLE` não enviava `elementText`, e a
   `QR` também não; a linha seguinte herdava o texto da anterior — o corpo salvaria na
   linha errada. Cada tipo que não usa o campo passou a mandar um `<input type="hidden">`
   vazio, mantendo as colunas alinhadas. O E2E que insere duas variáveis e confere o
   JSON gravado prende isso.

O conflito `BODY` + `{{corpo}}` é recusado **antes do envio** na tela e **no
servidor**. A recusa não converte em silêncio: os dois elementos ocupam posições
absolutas diferentes, e escolher um apagaria a decisão de posição do organizador.

### 3.6 O modelo é do EVENTO, e a posse do `eventId` é do `where`

O dado sempre soube ser por evento (`CertificateTemplate.eventId` nulável, índices
únicos parciais, precedência testada). O que faltava era **endereço**: a única tela de
modelos era a da instituição, e o organizador criava ali um modelo "do evento"
escolhendo no `<select>` — sem que nada conferisse que o evento era desta instituição.
A chave estrangeira garante que o evento **existe**, não que ele é **desta casa**: um
uuid de outra instituição virava uma linha que a resolução nunca alcançava, e o
certificado continuava saindo no padrão, sem erro nenhum.

A correção tem quatro partes:

- `saveCertificateTemplate` valida `{ id, tenantId, deletedAt: null }` **antes** do
  `create`/`update`; evento de outra instituição e evento excluído são `NOT_FOUND`
  **sem linha criada**;
- o alvo de um modelo existente é **imutável** (`eventId` diferente é `INVALID_INPUT`):
  mover um modelo por formulário forjado trocaria o desenho de documentos futuros em
  silêncio;
- `getCertificateTemplate`, `deleteCertificateTemplate`, `setTemplateBackground` e
  `clearTemplateBackground` aceitam o **alvo esperado** — a tela do evento não abre
  nem apaga o modelo de outro evento trocando o `templateId`;
- a tela da instituição lista só `eventId = null`; a do evento lista o que é dela e os
  padrões que **ainda valem** para algum tipo, calculados pela mesma
  `selectEffectiveTemplate` da emissão.

A rota nova nasce com `EVENT_MANAGE` como **primeira e única** guarda, `requireUuidParam`
antes de tudo e `getAdminEvent` com o `tenantId` no `where`. O alvo é a rota: o campo
"Vale para" virou texto + `input` oculto — um `<select>` de um item convidaria a trocar
o que o endereço já decidiu.

### 3.7 "Modelo deste evento": a emissão deixa de esconder o desenho

`resolveTemplateWithTx` devolve `null` tanto para "não há modelo" quanto para "o
modelo escolhido tem layout ilegível", e a emissão caía no desenho padrão **em
silêncio**. `resolveEventTemplateKinds` usa a **mesma precedência** e separa os três
estados (`TEMPLATE`, `DEFAULT`, `INVALID`), com a origem (`EVENT` × `INSTITUTION`) e o
nome do modelo. É leitura, não decisão: o caminho de emissão continua intacto.

O link para os modelos é decidido por `can(EVENT_MANAGE)`, não pela permissão da
página. `certificate:issue` (a guarda da emissão) não implica `event:manage` — o
**CHAIR** emite e não desenha. Mostrar o link a quem não pode abrir seria o defeito da
F72 dentro da própria seção.

### 3.8 A política é do evento, e o leitor é tolerante com direção

`Event.settings.certificatePolicy` guarda quatro campos: `minRatio` (0,5–1,0),
`minMinutes` (1–240), `requireCheckOut` (forçado `true`) e `aggregateBy` (só
`ACTIVITY`). O leitor (`readCertificatePolicy`) devolve `{ policy, problems }` e
**nunca lança**: `settings` torto cai no padrão e declara o motivo. A tolerância tem
direção — cada campo inválido cai no **padrão**, não é "aceito mais ou menos".

As recusas respondem a danos reais:

- `minRatio = 0` é proibido: com zero, todo mundo com uma presença de zero minuto
  "cumpre" a carga, e o certificado passa a atestar participação de quem não
  participou;
- `minRatio > 1` promete documento que ninguém pode receber;
- `minMinutes = 0` transforma uma atividade sem carga em "qualquer minutagem vale";
- `requireCheckOut: false` aceitaria comparecimento presumido como presença — o
  campo existe para a evolução e é **forçado** para `true`;
- `aggregateBy` diferente de `ACTIVITY` reabriria a soma por LINHA que a E92 acabou de
  fechar.

`computeWorkload` e `evaluateEligibility` recebem a política como **segundo argumento
opcional**. Omiti-la equivale a `policyDefaults()` (75 % e 30 min) — exatamente a régua
anterior. O modo de falha que a assinatura opcional evita é o mesmo da F85: se só um
caminho lesse a política, a simulação diria "2" e a emissão emitiria 1. Os três
caminhos (individual, lote e simulação) passam a ler a mesma política.

### 3.9 O congelamento é `{ policy, entries }` — e o detalhamento NÃO é assinado

O detalhamento responde "por que este documento tem 40 h". Sem a política, um
documento emitido sob 90 % seria lido depois de o evento voltar para 75 % e pareceria
recusar alguém que cumpriu a regra vigente. O formato novo é `{ policy, entries }`,
com `readWorkloadBreakdown` tolerando o formato antigo (lista pura) — documentos
emitidos antes da fase continuam legíveis, e `policy: null` significa "anterior ao
congelamento", não "a política era a padrão".

`buildCanonicalPayload`/`V2` **não leem** `workloadBreakdown`. Congelar a política ali
não muda hash nem assinatura de documento nenhum. A consequência é declarada: **a
política gravada não tem prova criptográfica**; quem alterar o JSON muda a explicação
sem invalidar a assinatura. O número que o documento **afirma** (`workloadMinutes`)
continua assinado. Criar a v3 do documento só para assinar o detalhamento foi
descartado — é dívida **E93**, não decisão escondida.

### 3.10 Na tela, a regra vem antes dos números

A página de emissão mostra a **política em vigor** antes dos contadores da simulação:
os quatro números são o resultado daquela régua, e quem lê precisa poder ver — e, com
`event:manage`, mudar — o critério que os produziu. A leitura é de quem tem
`certificate:issue`; a edição exige `event:manage` (instituição **ou** evento). O CHAIR
lê a regra e vê por que não pode mexer, em vez de um formulário que o servidor
recusaria.

`requireCheckOut` e `aggregateBy` aparecem como "fixo nesta versão": mostrar um
checkbox que o servidor recusaria seria prometer uma escolha que não existe. Os campos
do formulário falam em **percentual** (50–100) e o domínio guarda **fração** (0,5–1,0);
a conversão acontece num lugar só.

A gravação usa `readCertificatePolicy` — o **mesmo** leitor da emissão. Merge, não
substituição: `settings` guarda chaves de outras fases (`registrationRequiresMembership`,
`registrationForm`, `api`), e escrever só a chave nova apagaria as demais. A trilha
(`UPDATE` em `event`, com `from`/`to`) entra na **mesma transação**: se a gravação
falhar, a trilha não registra um fato que não aconteceu.

---

## 4. ADRs

### ADR-386 — A presença soma por PESSOA e ATIVIDADE, com teto na janela da atividade

**Contexto.** `attendances` tem uma linha por visita. `computeWorkload` avaliava cada
linha como uma entrada independente: duas visitas de 30 min na mesma atividade de 60
viravam duas entradas de 30, cada uma abaixo dos 45 exigidos (75 % da carga), e
**nenhuma** contava. A pessoa esteve a atividade inteira e ficou sem o documento; o
descarte ainda aparecia duas vezes. A FASE 85 mediu o sintoma e o reproduziu de
propósito (dívida E92) porque consertar muda quem recebe certificado.

**Decisão.**

1. `aggregateAttendanceByActivity` agrupa por `(userId, activityId)` e soma os minutos
   medidos **antes** de montar os fatos, nos **dois** caminhos (`loadFacts` individual
   e `loadEventFacts` da projeção).
2. O teto é o **menor** entre a carga declarada e a janela real da atividade
   (`endsAt − startsAt`); janela de duração zero é tratada como ausente.
3. Sem check-out a linha contribui com zero; minutos negativos não viram carga.
4. `activityId` nulo é a linha do **EVENTO** e soma separada das atividades; o
   certificado de PARTICIPAÇÃO continua decidido por `eventCheckedIn`.
5. A saída é ordenada por `userId`/`activityId` com comparação de caractere, para a
   simulação e a emissão produzirem os mesmos fatos em qualquer ordem de leitura.
6. `computeWorkload` fica **intacto** — recebe uma entrada por par.
7. A agregação é em memória: nenhuma consulta nova e a régua de 6 chamadas da
   projeção não muda.

**Justificativa.** A regra dos 75 % é sobre a **permanência na atividade**, não sobre
cada passagem pela porta. Somar é o que descreve o fato que o documento atesta. O teto
existe porque somar visitas abre a porta para minutos que não existiram na sala. E a
decisão é a mesma nos dois caminhos porque a simulação precisa continuar sendo o mesmo
serviço — se só um lado agregasse, a tela prometeria um certificado que a emissão
recusaria.

**Consequências.**

- Quem tinha duas visitas curtas passa a receber: na fixture, o evento foi de **2 para
  4 certificados** (2 elegíveis, 8 descartes, 12 pares, 6 pessoas).
- Quem tem uma linha por atividade recebe **exatamente** o mesmo conjunto de antes
  (provado em cinco casos de não regressão).
- **Não há retroativo**: quem já foi recusado precisa de nova emissão.
- A política continua podendo mudar a régua (ADR-388), mas a **forma** da agregação é
  fixa nesta versão (`aggregateBy: 'ACTIVITY'`).

### ADR-387 — O corpo do certificado é um ELEMENTO com gabarito, resolvido uma vez — e o hash dos documentos antigos não muda

**Contexto.** O texto formal do certificado era uma frase gerada em código
(`buildCertificateText`) impressa pela variável `corpo`. O organizador não tinha como
dizer o que o próprio documento afirma. Acrescentar uma variável ao catálogo mudaria o
conteúdo canônico de todo certificado versão 2 já emitido — `serializeContentValues`
percorre o catálogo atual e grava `''` para chave ausente —, e a reverificação os
marcaria como `TAMPERED`. Campo novo no layout teria o mesmo efeito sobre o
`layoutSnapshot`.

**Decisão.**

1. O corpo é um **elemento** `kind: 'BODY'`, com o gabarito no campo `text` que o
   layout **já** serializava. Modelo sem `BODY` serializa exatamente como antes.
2. O gabarito aceita as **12 chaves de conteúdo menos `corpo`**; `hash`, `assinatura`
   e `chave` ficam fora porque são auditoria; `corpo` fica fora porque seria recursão.
3. `validateBodyTemplate` recusa vazio, token desconhecido (listando os válidos),
   `{{`/`}}` sobrando e mais de **2.000** caracteres.
4. A resolução acontece **uma vez**, na emissão, depois da alocação do código de
   validação: o texto interpolado vai para `bodyText` **e** para
   `variableSnapshot.corpo`, os dois no conteúdo canônico.
5. O `layoutSnapshot` guarda o **gabarito**; o renderizador imprime `values.corpo` e
   **nunca** reinterpreta o `BODY`.
6. O `BODY` não substitui o bloco probatório; `{{codigo_validacao}}` dentro do corpo é
   texto, não elemento.
7. Corpo próprio + elemento `VARIABLE` com `corpo` é **recusado** — o texto sairia duas
   vezes em posições diferentes.
8. A medição do "cabe?" é a **mesma** do desenho (`fitTextInBox`), no domínio; mede e
   avisa, não trunca. A altura de "aumentar a caixa" é a inversa da mesma régua.

**Justificativa.** O hash é contrato: documento emitido não pode virar `TAMPERED`
porque o produto melhorou. Usar um campo que já existia é o que permite evoluir o
corpo sem tocar no passado. E resolver na emissão é o que garante que o papel impresso
é o que foi assinado — a alternativa (interpolar no renderizador) faria o mesmo hash
sair diferente depois de uma edição de cadastro.

**Consequências.**

- Os **5 modelos prontos** mantêm o hash de antes (preso em teste) e o
  `OLD_LAYOUT_JSON` continua verificando; nenhuma migração.
- O PDF de um modelo com corpo imprime o texto do organizador, sem `{{`.
- Reemitir o mesmo certificado não muda o hash.
- A tela ganhou duas prévias: a completa e a de opcionais vazios.
- O gabarito é limite de **entrada**; o tamanho do texto resolvido é problema do
  "cabe?" e do renderizador.

### ADR-388 — A régua de presença é POLÍTICA DO EVENTO: congelada no detalhamento, mas não assinada

**Contexto.** `MIN_ATTENDANCE_RATIO` (0,75) e `MIN_ATTENDANCE_MINUTES` (30) eram
constantes: todo evento emitia e recusava pela mesma régua. Um simpósio de dois dias que
exige presença integral e uma mostra de pôsteres que exige metade não tinham como
coexistir sem abrir chamado. A política é configuração de negócio do evento, como a
política de inscrição (F12), o formulário do organizador (F70) e a chave da API (F72) —
e a casa é `Event.settings`.

**Decisão.**

1. `Event.settings.certificatePolicy` com `minRatio` (0,5–1,0), `minMinutes` (1–240),
   `requireCheckOut` (forçado `true`) e `aggregateBy` (só `ACTIVITY`).
2. `readCertificatePolicy` é o **único** leitor — tolerante, com `problems`, e usado
   tanto na emissão quanto na gravação.
3. `computeWorkload`/`evaluateEligibility` recebem a política **opcional**; o default é
   a régua de sempre, provado com `toEqual` nos mesmos casos.
4. A política vale nos **três** caminhos (individual, lote e simulação); a igualdade da
   F85 continua verde.
5. O detalhamento congela `{ policy, entries }`, com leitor do formato antigo; **não**
   entra no conteúdo canônico.
6. A tela mostra a política em vigor; a edição exige `EVENT_MANAGE` (instituição ou
   evento) e faz merge do `settings`, com trilha na mesma transação.

**Justificativa.** A régua é decisão do organizador, não do código. Mas o documento
precisa explicar por que aquele número saiu: congelar a política no detalhamento
responde "por que 40 h" meses depois. Assinar o detalhamento exigiria uma v3 do
documento e mudaria o hash de tudo — o detalhamento é **explicação**, não afirmação.
O que o documento afirma é `workloadMinutes`, e esse continua assinado.

**Consequências.**

- **A política congelada não tem prova criptográfica** (dívida E93): quem alterar o
  JSON do banco muda a explicação sem invalidar a assinatura. É escopo declarado, não
  descuido.
- Mudar a política **não** altera documento já emitido (o congelamento é do dia).
- **Não há retroativo**: quem foi recusado sob a régua antiga precisa de nova emissão.
- `requireCheckOut` e `aggregateBy` são fixos nesta versão — os campos existem para a
  evolução, mas a política não pode enfraquecer a prova da saída nem reabrir a E92.
- `Activity.minAttendancePercent`/`requiresAttendance` continuam **sem leitor**
  (dívida E94): a política é por evento; por atividade é outra decisão.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção / prova |
|---|---|---|---|
| 1 | **A presença somada por LINHA (E92) descartava a Gabi 2×.** A pessoa esteve a atividade inteira (2 × 30 min em 60) e não recebeu documento; o descarte aparecia duas vezes | `computeWorkload` avalia uma entrada por linha de `attendances`, e cada visita de 30 ficava abaixo dos 45 exigidos (75 % de 60) | `aggregateAttendanceByActivity` soma por `(userId, activityId)` antes dos fatos, com teto na janela e na carga. Medido: o evento da F85 passou de **2 para 4 certificados**, **10 → 8 descartes**; a Ana (uma linha) manteve exatamente o mesmo conjunto |
| 2 | **O CRLF do `textarea` faria o hash depender do navegador.** O valor do formulário chega com `\r\n`; o `\r` ficaria no fim de cada linha impressa e na serialização do layout | O HTML codifica o valor com CRLF por especificação, e a porta do formulário não normalizava | `buildLayoutFromRows` troca `\r\n?` por `\n` **na porta** (não em `normalizeLayout`, para não mudar layout já gravado); o E2E compara o texto gravado com `\n`, e o unit `f86-editor-do-corpo` prende a conversão |
| 3 | **`elementText`/`elementKind` desalinhados salvariam o corpo na linha errada.** A linha `VARIABLE` não enviava `elementText`; a seguinte herdava o texto da anterior | `buildLayoutFromRows` lê listas paralelas por índice; cada tipo que não usa o campo precisa enviar o campo vazio | `VARIABLE` e `QR` passaram a mandar `<input type="hidden" name="elementText" value="">`; o E2E insere duas variáveis e confere o JSON gravado, e o caso sem JavaScript salva o texto na linha certa |
| 4 | **O componente assíncrono quebrou `renderToStaticMarkup`** com "A component suspended…" no teste de integração | A página é `async` e a bancada (`CertificateTemplatesScreen`) era um componente assíncrono filho: `renderToStaticMarkup` não espera suspensão | A bancada foi dividida em `loadCertificateTemplatesScreen` (async, faz as leituras) + `CertificateTemplatesScreen` (**síncrona**, só desenha). A integração renderiza o elemento devolvido pela página sem suspender, e as duas rotas compartilham a mesma tela |
| 5 | **O `eventId` sem posse gravaria modelo em outra instituição.** O organizador salvava, o modelo nascia, e o certificado continuava saindo no padrão — sem erro | `saveCertificateTemplate` gravava o uuid que o formulário mandasse; a FK garante que o evento existe, não que é desta casa | Validação `{ id, tenantId, deletedAt: null }` antes do `create`/`update` (`NOT_FOUND` sem linha), alvo imutável, alvo esperado em `get`/`delete`/arte/remoção. Integração `f86-modelos-do-evento`: **8 casos**, incluindo outra instituição sem criar linha |
| 6 | **O `axe` na página de modelos revelou o contraste do rótulo do palco.** A tela nova entrou no portão e o rótulo da caixa usava `element.color` — uma tinta clara escolhida para o papel ficava ilegível sobre o painel | O palco herdava a cor do **documento** para desenhar o rótulo da **interface**; a tela nunca tinha passado pelo `axe` | O rótulo passou a `text-foreground` (token da interface) e a tela entrou no portão com o campo `BODY` aberto; o caso da página de modelos **e** o da sub-rota do evento medem a superfície nova (39 → 41 telas). O mesmo passe revelou que a tela da instituição precisava separar o alvo (fatia 4) |
| 7 | **As 23 baselines do wordmark "Koveno"** foram refeitas: uma mudança de marca feita **fora do fluxo de fases** mudou todos os pixels de todas as telas | O wordmark da plataforma virou "Koveno" num commit anterior (a descoberta pública de eventos), e a suíte visual da F62 compara pixel a pixel com `maxDiffPixelRatio: 0` | As 23 imagens foram regeradas **uma vez**, depois de medir que a diferença era o wordmark e não uma regressão de layout; o `f62` rodou duas vezes a 0 px. É a prova de que a marca é decisão do humano — e que mudá-la fora do fluxo custa uma re-base da suíte inteira |

---

## 6. Evidência de verificação

### 6.1 A bateria

```text
npm run lint ................. 0 erros, 0 warnings
npm run typecheck ............ 0 erros
npm test ..................... 4690 testes em 264 arquivos — 0 vermelhos
npm run build ................ Compiled successfully; a rota nova listada
npm run db:verify ............ Contrato íntegro.
npm run db:verify:isolation .. 9/9 verificações passaram.
npm run db:partitions ........ Partições do mês atual e dos seguintes criadas.
```

### 6.2 Os testes novos, por arquivo

| Arquivo | Casos | O que prende |
|---|---|---|
| `tests/unit/f86-agregacao-de-presenca.test.ts` | 17 | 2 × 30 min → 60 e passa o limiar de 45; teto na carga e na janela; três visitas; ordem invertida; linha do evento separada; uma visita idêntica a hoje |
| `tests/unit/f86-corpo-do-certificado.test.ts` | 38 | o elemento `BODY` (um por modelo, não substitui o bloco probatório), a lista canônica de 12, a validação (token desconhecido com a lista, `{{` sem fechar, vazio, 2.000), a resolução, o "cabe?", o renderizador, a prévia dupla e o hash dos documentos antigos (5 presets + JSON preso) |
| `tests/unit/f86-editor-do-corpo.test.ts` | 8 | o conflito `BODY` + `{{corpo}}` recusado; o CRLF normalizado; a altura sugerida é a inversa da régua e realmente cabe; `clamped` quando a página não comporta |
| `tests/unit/f86-modelos-do-evento.test.ts` | 3 | a seção "Modelo deste evento": origem, estado `INVALID` com aviso e caminho, link só com `event:manage` |
| `tests/unit/f86-politica-de-presenca.test.ts` | 35 | o leitor tolerante e cada recusa; o default idêntico ao de hoje; a régua diferente mudando quem passa; o detalhamento congelado e o formato antigo |
| `tests/integration/f86-corpo-do-certificado.test.ts` | 8 | `bodyText` e `corpo` resolvidos, `layoutSnapshot` com o gabarito, reverificação, reemissão com o mesmo hash, PDF sem `{{`, modelo sem corpo e certificado antigo |
| `tests/integration/f86-modelos-do-evento.test.ts` | 8 | a posse do `eventId` (outra instituição e evento excluído), o alvo imutável, a edição presa à rota, a exclusão com alvo errado e a resolução `INVALID` |
| `tests/integration/f86-politica-do-evento.test.ts` | 9 | a política nos três caminhos, a recusa com o motivo novo, o congelamento e a adulteração que **não** invalida a assinatura; gravação com merge e trilha |
| `tests/e2e/f86-corpo-do-certificado.spec.ts` | 9 | o caminho completo no editor, a inserção no cursor, o token recusado no servidor, o contador, as duas prévias, o "não cabe" com a ação, o conflito, o gabarito só com opcional e o **sem JavaScript** |
| `tests/e2e/f86-politica-de-presenca.spec.ts` | 2 | o organizador muda 75 % → 90 %, recarrega e vê; os quatro contadores mudam (2 → 1 elegível, 2 → 4 descartes, 4 → 2 certificados) e o `settings` preserva a chave de outra fase; o CHAIR lê e não recebe o formulário |

Além deles, a fase acrescentou **1 caso** na catraca `f72` (a sub-rota de modelos é
detalhe do cartão e tem a guarda mais forte), **2 casos** no portão `axe` (a página de
modelos e a do evento), **1 caso** na tabela do id malformado (25 → 26 páginas) e
**1 caso** no E2E da emissão do evento (a precedência na tela e no documento).

### 6.3 As catracas que a fase moveu

```text
f76 · catálogo de ids ....... 24 → 25 páginas · 25 → 26 params · 29 → 30 encontrados
f76 · tabela do E2E ......... 36 → 37 casos (25 → 26 de página, 11 de API)
f78 · topo único ............ 97 → 98 páginas · 82 → 83 migradas · 15 exceções
f72 · cartão × sub-rota ..... +1 caso (certificados × modelos do evento)
axe ......................... 39 → 41 telas no portão
f62 · regressão visual ...... 23 baselines refeitas (wordmark "Koveno")
```

### 6.4 A suíte E2E inteira

```text
npm run test:e2e ............ 507 casos — **506 passando + 1 skip**, 0 vermelhos
                               (F85: 491 passando + 1 skip; a F86 acrescentou 9 do corpo,
                               2 da política, 2 no portão e 1 na tabela do id malformado)
```

A suíte roda contra o **container de produção** (`eventflow/web:local`), não contra o
`npm run dev`. A imagem foi construída **depois** da última alteração de produto
(`certificate-rules.ts`, 10:53; imagem às 11:01) e **antes** deste fechamento, que só
mexe em documento, estado, dívida e captura — portanto **não foi preciso `--build` de
novo**. A conferência foi feita nos três níveis que importam: a data da imagem, o
`docker inspect` do container apontando para o mesmo ID e o código novo **dentro** do
container em execução (`docker exec eventflow-web grep -rl certificatePolicy .next/server`
devolveu os chunks da política).

**A rota nova, conferida.** `build` lista
`ƒ /t/[tenantSlug]/administracao/eventos/[eventId]/certificados/modelos`; sem sessão
ela responde **307** (login), não 404; o E2E mede **200** com a sessão da ADMIN.

### 6.5 A imagem da fase

`docs/imagens/f86-certificados-por-evento.png` foi capturada da **tela real** do
container, com um spec temporário (apagado depois da captura). A imagem mostra o
**corpo editável** — o `textarea` com o gabarito de duas variáveis e duas linhas, a
legenda das 12 variáveis, o contador e as **duas prévias** lado a lado (com todos os
dados × com os opcionais vazios) — e, no mesmo quadro, a **política em vigor** na tela
de emissão (75 % da carga · piso de 30 min · check-out obrigatório · soma por
atividade).

O **antes** não entra na imagem: o corpo não existia (era a frase gerada em código) e a
política não tinha tela. O registro do antes é o diff — o elemento novo, a rota nova e
o painel —, e a prova do depois é a captura.

### 6.6 O que a fase NÃO mudou

- **`computeWorkload`**: intacto; recebe uma entrada por pessoa × atividade.
- **A precedência de modelos**: EVENTO+TIPO → EVENTO → INSTITUIÇÃO+TIPO → INSTITUIÇÃO
  → padrão; a fase só deu endereço e visibilidade.
- **O caminho de emissão**: a Server Action continua lendo `tenantSlug`, `eventId` e
  `kinds`; o `eventId` do modelo agora vem da rota.
- **`globals.css` e `playwright.config.ts`**: não foram tocados.
- **O wordmark "Koveno"**: não foi renomeado; a decisão do nome do produto segue
  aberta (§8).

---

## 7. Comandos operacionais

```bash
# a tela de modelos DO EVENTO (com sessão de quem tem event:manage)
# /t/<slug>/administracao/eventos/<eventId>/certificados/modelos

# a emissão do evento (com a política em vigor e a seção "Modelo deste evento")
# /t/<slug>/administracao/eventos/<eventId>/certificados

# os testes da agregação, sem banco
npx vitest run tests/unit/f86-agregacao-de-presenca.test.ts

# o corpo, o editor e o hash preso
npx vitest run tests/unit/f86-corpo-do-certificado.test.ts tests/unit/f86-editor-do-corpo.test.ts tests/unit/f86-politica-de-presenca.test.ts

# as integrações que tocam banco e storage
npx vitest run tests/integration/f86-corpo-do-certificado.test.ts tests/integration/f86-modelos-do-evento.test.ts tests/integration/f86-politica-do-evento.test.ts

# as catracas que a fase moveu
npx vitest run tests/unit/f76-catalogo-de-ids.test.ts tests/unit/f78-topo-unico.test.ts tests/unit/f72-cartao-esconde-o-que-a-tela-recusa.test.ts

# o navegador
npx playwright test tests/e2e/f86-corpo-do-certificado.spec.ts tests/e2e/f86-politica-de-presenca.spec.ts
npx playwright test tests/e2e/accessibility.spec.ts

# a suíte inteira (o container precisa estar com o código novo)
docker compose --profile app up -d --build web worker
docker inspect eventflow-web --format '{{.Image}}'
docker images | grep eventflow/web
npm run test:e2e
```

---

## 8. Dívidas técnicas e pontos de atenção

### 8.1 Dívida quitada: **E92** — a presença somada por LINHA

A fatia 1 pagou a dívida que a FASE 85 declarou. A presença é agregada por pessoa ×
atividade, com teto na janela e na carga; a simulação e a emissão passam pela **mesma**
função; `computeWorkload` não mudou. Quem já foi recusado **não recebe retroativo** —
precisa de uma nova emissão, e a nova emissão cria o documento que faltava.

### 8.2 Dívida nova: **E93** — o detalhamento não é assinado

O `workloadBreakdown` congela `{ policy, entries }` e **não** entra em
`buildCanonicalPayload`/`V2`. A consequência é a declarada na ADR-388: quem alterar o
JSON do banco muda a **explicação** do documento sem invalidar `contentHash` nem
assinatura. O que o documento afirma (`workloadMinutes`) continua assinado. O caminho
do conserto é uma **v3** do conteúdo canônico que inclua o detalhamento — e isso muda o
hash de todo documento emitido, então é decisão de produto, não de tela.

### 8.3 Dívida nova: **E94** — `Activity.minAttendancePercent`/`requiresAttendance` sem leitor

O schema da atividade ainda declara os dois campos, e **nenhum caminho do produto os
lê**: a régua passou a ser por **evento** (`settings.certificatePolicy`). Manter os
campos sem leitor é a armadilha 75 aplicada a duas colunas — ou eles ganham um caminho
(regra por atividade, com a precedência EVENTO → ATIVIDADE a decidir) ou saem do
schema. Por atividade é **outra decisão**, e a fase não a tomou.

### 8.4 Os limites declarados da política

- **`requireCheckOut` é fixo em `true`.** O campo existe para a evolução; aceitar
  `false` seria aceitar comparecimento presumido como presença.
- **`aggregateBy` só aceita `ACTIVITY`.** Outro valor reabriria a soma por LINHA que a
  E92 fechou.
- **Não há retroativo.** Mudar a política não reavalia documento emitido; o
  congelamento é do dia. Quem foi recusado sob a régua antiga precisa de nova emissão.
- **A política gravada é lida com tolerância.** Configuração torta cai no padrão e a
  tela mostra os problemas; ela não derruba a emissão.

### 8.5 A prévia SVG não recalcula a cada tecla

O SVG das duas prévias vem do servidor ao abrir a tela e ao clicar em "Atualizar
prévia"; o editor mede o texto localmente para o contador e para o aviso "não cabe".
Recalcular o SVG a cada caractere pagaria um round-trip por tecla e faria a prévia
piscar. O caminho seria um render local do mesmo layout — trabalho de outra fase.

### 8.6 "Reduzir a fonte" não existe como ação

O aviso de "não cabe" oferece **"Aumentar a caixa"** (altura calculada no domínio) e,
quando a página não comporta, diz para reduzir o corpo da fonte ou encurtar o texto —
mas **não há botão** que reduza a fonte: a escolha do tamanho é do organizador, e um
botão que mexesse nela mudaria o desenho inteiro sem ele pedir.

### 8.7 O nome do produto: **"Koveno" na tela, "EventFlow" nos documentos**

O wordmark da plataforma é **"Koveno"** (`src/components/ui/brand-mark.tsx`,
`src/app/layout.tsx` e a landing), enquanto o repositório, o README e todos os
documentos de fase continuam dizendo **"EventFlow"**. Não é um defeito de código: é
uma **decisão pendente do humano**. Esta fase **não renomeia nada** — nem a marca, nem
os documentos — e registra a divergência para que ela não seja resolvida por acidente
numa próxima faxina de texto.

### 8.8 O que a fase não tocou

- A **capacidade da fila** e a **concorrência** do worker continuam fora da tela (a
  F85 já as declarou).
- O **inventário** de certificados continua com o seu papel (listar, filtrar, ZIP); a
  rota do evento emite.
- O **evento de outra instituição** responde 404 pela consulta, não pela tela.
- A **arte de fundo** continua JPEG (PDF não embute WebP) e a validação dela é a mesma
  da F40.
- As **23 baselines** foram refeitas por causa do wordmark, não por causa desta fase:
  nenhum layout desta fase entrou no `f62`.

---

## 9. Checklist de aceite

- [x] `aggregateAttendanceByActivity` soma por `(userId, activityId)`, com teto na carga
      e na janela, linha do evento separada e ordem determinística.
- [x] A agregação é aplicada nos **dois** caminhos (`loadFacts` e `loadEventFacts`);
      `computeWorkload` não mudou e a régua de 6 chamadas da projeção foi mantida.
- [x] A **E92** está quitada; a Gabi deixou de ser descartada 2× e o evento da fixture
      passou de **2 para 4 certificados** (10 → 8 descartes).
- [x] O corpo é o elemento `BODY`, com gabarito `{{chave}}`, **12 variáveis** canônicas
      e limite de **2.000** medido contra a página.
- [x] `validateBodyTemplate` recusa vazio, token desconhecido (listando os válidos),
      chaves sobrando e excesso de tamanho; `measureCertificateBody` mede e avisa, não
      trunca.
- [x] A resolução acontece **uma vez**, na emissão; `bodyText` e
      `variableSnapshot.corpo` são assinados; o `layoutSnapshot` guarda o gabarito.
- [x] O hash dos **5 modelos prontos** é o mesmo de antes; o `OLD_LAYOUT_JSON` continua
      `VALID`; reemitir não muda o hash.
- [x] O editor tem `textarea`, legenda com inserção no cursor, contador, erros, duas
      prévias, aviso de "não cabe" com a ação "Aumentar a caixa" e o conflito
      `BODY` + `{{corpo}}` recusado na tela e no servidor.
- [x] O gabarito só com opcionais **avisa** que pode sair vazio e **não bloqueia**.
- [x] A rota `.../certificados/modelos` existe com `EVENT_MANAGE` como primeira e única
      guarda, 404 antes da consulta e `max-w-7xl`.
- [x] A instituição virou **"Modelos padrão da instituição"** e só lista `eventId = null`.
- [x] A **posse do `eventId`** é validada (outra instituição e evento excluído →
      `NOT_FOUND` sem linha); o alvo de um modelo existente é imutável.
- [x] A seção **"Modelo deste evento"** separa `TEMPLATE`/`DEFAULT`/`INVALID`, denuncia
      o inválido e limita o link a quem tem `event:manage`.
- [x] A política vive em `Event.settings.certificatePolicy`, é lida pelo leitor
      tolerante e aplicada nos **três** caminhos com a igualdade da F85 verde.
- [x] As recusas cobrem razão 0 ou > 1, piso 0 ou > 240, `requireCheckOut: false` e
      `aggregateBy: 'ROW'`.
- [x] O detalhamento congela `{ policy, entries }` e **não** é assinado (adulterar a
      política mantém `signatureValid`).
- [x] A tela mostra a política em vigor, edita só com `EVENT_MANAGE` (CHAIR lê e não
      recebe o formulário), faz merge das outras chaves e audita na mesma transação.
- [x] As catracas `f76` (25/26), `f78` (98/83), `f72` (+1) e o portão `axe` (41) estão
      atualizadas.
- [x] As dívidas **E93** e **E94** estão declaradas em `docs/dividas-tecnicas.md` e no
      `AGENTS.md` §9; a contagem vai de **46 para 48**.
- [x] A bateria completa da §4 passou — lint, typecheck, Vitest, build, db:verify,
      db:verify:isolation, db:partitions e a suíte E2E inteira.
- [x] A imagem `docs/imagens/f86-certificados-por-evento.png` foi capturada da tela
      real, com o spec temporário apagado.
