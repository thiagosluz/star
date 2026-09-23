# FASE 37 — Crachá em etiqueta adesiva e impressora térmica · Confirmação de vaga por item

> **Escopo definido pelo humano**, na mesma lista que originou a FASE 36: *"Impressão do
> crachá em papel adesivo Pimaco e impressão térmica (ZPL)"* e *"confirmação por item
> individual de exigência"*.
>
> **Duas decisões escolhidas pelo humano antes do código:** a folha de etiquetas é
> **configurável na tela**, com o padrão **63,5 × 33,9 mm em 3 colunas × 8 linhas (A4)**; a
> impressora térmica também é **configurável**, com o padrão **ZPL II genérico (203 dpi,
> etiqueta de 100 × 50 mm)**. Nenhuma marca ou modelo entra no código.

---

## 1. Sumário executivo

Duas dívidas abertas em fases anteriores fecham aqui, e as duas têm a mesma forma: **uma
decisão que estava no lugar errado**.

A primeira é a **E41** (FASE 31). O crachá existia em PDF, numa folha A4 com oito etiquetas e
marcas de corte — e a secretaria cortava 300 etiquetas na tesoura. A impressão de etiqueta
adesiva e a impressora térmica existem, custam pouco e resolvem isso; o que faltava era o
arquivo certo. O lugar errado aqui é o **desenho**: as medidas de uma folha adesiva variam por
modelo, por lote e por impressora, então uma grade fixa no código estaria errada para quase
todo mundo. A folha passou a ser **dado** (colunas, linhas, tamanho e margens, em milímetros)
e a etiqueta térmica também (dpi, largura, altura e ampliação do QR) — com um padrão que
preenche o que o operador não digitar e o botão de baixar ao lado dos números.

A segunda é a **E48** (FASE 34). A confirmação de vaga era do CONJUNTO: numa campanha com
três itens, quem entregou dois ficava no mesmo estado de quem não entregou nada, e o balcão
resolvia no olho. Agora cada exigência vira uma **linha da inscrição** (snapshot do que foi
cobrado daquela pessoa), marcada uma a uma no balcão — e a vaga continua sendo UMA: quando
todas as obrigatórias estão satisfeitas, **ela se confirma sozinha**, pelo mesmo caminho que a
equipe usaria.

### Entregas

| Entrega | Onde |
|---|---|
| Regra pura da impressão: milímetros → pontos (PDF) e → pontos da impressora, grade da folha, validação do que cabe em A4, posições em ordem de leitura, e leitura dos parâmetros da URL com padrão | `src/domain/events/badge-print-rules.ts` |
| Regra pura do ZPL: catálogo de dpi, validação da etiqueta, escape de texto (`^FH` + hexadecimal, `^CI28`), quebra de linha por largura, escolha do corpo do nome que caiba na largura **e** na altura, e o rótulo do crachá (QR + nome + código + origem) | `src/domain/events/badge-print-rules.ts` |
| Renderizador da folha de ETIQUETAS (sem moldura e sem cabeçalho: a etiqueta é a página) e o desenho do crachá proporcional à etiqueta | `src/lib/credentials/badge-renderer.ts` |
| Preparação do lote compartilhada pelas duas rotas de impressão (quem entra, o que marcar como impresso, o nome do arquivo) | `src/lib/events/badge-print-service.ts` |
| Rota `GET /api/t/<slug>/credenciamento/crachas/impressao?formato=etiquetas\|zpl` (PDF em fluxo ou ZPL em texto, com o lote no cabeçalho `x-crachas-no-lote`) | `src/app/api/t/[tenantSlug]/credenciamento/crachas/impressao/route.ts` |
| Painel das medidas na área de crachás (grade da folha adesiva e rolo da térmica, editáveis, levando a seleção da lista) | `src/components/credentials/badge-roster.tsx` |
| Migração à mão: `registration_confirmation_items` (posição, tipo, rótulo, observação, obrigatória, estado, quem resolveu e quando), com RLS + FORCE, concessões e **backfill** das inscrições pendentes a partir do JSON da atividade | `prisma/migrations/20260923164202_registration_confirmation_items/` |
| Regra pura do checklist: estados, snapshot das exigências, progresso, "quem ainda segura a vaga" e a decisão de confirmar sozinha | `src/domain/events/confirmation-item-rules.ts` |
| Snapshot criado **nos dois caminhos que criam inscrição** (inscrição retida e promoção da lista de espera) e leitura do checklist na tela do participante | `src/lib/events/registration-service.ts` |
| Marcação do item com escrita condicional, trilha própria e confirmação automática pelo caminho de sempre; a fila da equipe passa a devolver o checklist de cada inscrição | `src/lib/events/confirmation-service.ts` |
| Server Action da marcação e a chave "esta exigência é obrigatória" no cadastro da atividade | `src/app/actions/admin-actions.ts`, `src/components/admin/confirmation-fields.tsx` |
| Checklist item a item na fila do balcão e na tela do participante | `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/confirmacoes/page.tsx`, `src/app/t/[tenantSlug]/(app)/minhas-inscricoes/page.tsx` |
| Testes: 22 unitários da impressão, 18 do checklist, 13 de integração e 5 E2E (o balcão marcando item por item e os dois arquivos de impressão baixados e conferidos) | `tests/unit/badge-print-rules.test.ts`, `tests/unit/confirmation-item-rules.test.ts`, `tests/integration/confirmation-items.test.ts`, `tests/e2e/badge-print-and-items.spec.ts` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **9** — 2 de domínio, 2 de aplicação, 1 rota, 1 migração, 3 de teste (2 unitários + 1 de integração), mais os 5 E2E num arquivo |
| Arquivos alterados | **13** — `schema.prisma`, o contrato de schema, as regras da confirmação (F34), o renderizador do crachá, o serviço de inscrições, o de confirmações, as actions de administração, os campos da confirmação, as duas páginas, o painel de crachás, a rota da folha A4 e o teste unitário da F34 |
| Migrações | **1** nova — total **33** |
| Tabelas sob RLS | **41 → 42** (`registration_confirmation_items`) |
| Testes novos | **54** no Vitest (41 unitários + 13 de integração, mais 1 expectativa ajustada no teste da F34) + **5** E2E — a suíte foi de **1865/83** para **1919/86**, e o E2E de **123** para **128** |
| Defeitos reais encontrados | **6** — a caixa "é obrigatória" que nascia desmarcada e gravava toda exigência como opcional; o DPI inválido que caía para 203 em silêncio (etiqueta fisicamente menor); a medida não numérica que virava o padrão; o nome longo cortado no ZPL; o bloco de quatro linhas que empurrava o código para fora da etiqueta; e a divisão de testes publicada no `README` que não fechava com a medição |
| Dívidas quitadas | **2** — **E41** (etiqueta adesiva e impressão térmica) e **E48** (confirmação por item). A **E42** fica **pela metade**: a escolha de lente da câmera continua aberta, e a identidade visual do crachá também |
| Dívida nova | **1** — **E50** (ação em linha só existe depois de hidratada) |
| ADRs | **192 … 199** (a próxima é 200) |

---

## 2. O problema mais difícil: **a mesma medida significa coisas diferentes em cada mundo**

A impressão pareceu, no começo, um exercício de desenho de PDF. Não é: o problema de verdade é
que **milímetro não é a unidade de nenhum dos dois destinos**.

No PDF, a unidade é o **ponto** (72 por polegada), e a folha é uma superfície conhecida (A4) onde
a posição de cada etiqueta é aritmética. Na impressora térmica, a unidade é o **ponto do
equipamento** — que depende do DPI: os mesmos 100 mm são 799 pontos a 203 dpi e 1.181 a 300 dpi.
E `^PW`/`^LL` (o tamanho do rótulo) são escritos em PONTOS, não em milímetros: **mandar 800 numa
impressora de 300 dpi imprime 67 mm**, e a etiqueta sai menor do que o rolo, sem erro nenhum.

Daí a decisão que atravessa a fase: **a medida em milímetros é a fonte, e a conversão acontece
onde é usada** (`mmToPt`, `mmToDots`). Isso parece detalhe e é o que decide o desenho todo,
porque significa que o valor que o operador digita na tela é o que ele confere com a régua — e
não um número em pontos que ninguém sabe conferir.

O segundo problema difícil é o **nome**. Um crachá é lido na porta, por uma pessoa com pressa, e
o crachá que não diz o nome inteiro não serve: "Maria da Conceição Aparecida dos Santos Oliveira
Albuquerque" precisa caber numa etiqueta de 100 × 50 mm junto com o QR e o código. O ZPL não
quebra linha sozinho, e a saída ingênua (cortar o que não couber) produz o pior silêncio
possível: o nome sai pela metade e ninguém percebe até alguém não ser encontrado na porta. A
resposta está na ADR-195: **quebra por largura, corpo que encolhe até o nome inteiro caber, e a
última linha leva o resto em vez de perder palavra** — além de o bloco do nome respeitar a
ALTURA que sobra depois do código e da origem (o ZPL imprime o que passa da borda, e o que
passa da borda some).

O terceiro é o **snapshot**. A confirmação por item não podia ler a configuração ATUAL da
atividade: o organizador que edita as exigências amanhã mudaria o que quem já está na fila
deve — e o balcão conferiria contra uma lista que a pessoa nunca viu. O que a pessoa deve é o
que a atividade pedia **no dia em que ela se inscreveu**, e é isso que a tabela guarda.

---

## 3. Decisões técnicas

### 3.1 A geometria é dado, com padrão

`LabelSheetLayout` (colunas, linhas, largura, altura, margens, espaçamentos) e
`ThermalLabelConfig` (dpi, largura, altura, ampliação do QR) são lidos da query string por
`labelLayoutFromParams` e `thermalConfigFromParams`. **Campo ausente usa o padrão** — um link
sem `margem-esquerda` impresso com margem zero sairia colado na borda sem ninguém ter mexido
em nada — e **campo presente que o sistema não entende é recusado** (ADR-193).

A grade padrão (3 × 8 de 63,5 × 33,9 mm) fica centralizada em A4: a sobra de 19,5 mm na largura
e 25,8 mm na altura divide-se igualmente. É a única margem que dá para afirmar sem conhecer a
folha — e quem tem uma folha com margem própria ajusta dois números na tela, conferindo na
primeira impressão, que é como isso se acerta de verdade.

A alternativa descartada foi **fixar uma marca** ("Pimaco 6180", "Zebra ZD220"). Ela teria dado
um resultado melhor na primeira tentativa para quem tem exatamente aquele material e um arquivo
errado para todo o resto — e trocar de lote no meio do evento exigiria deploy.

### 3.2 O arquivo errado custa mais caro que a recusa

Uma folha de etiqueta adesiva não se reaproveita. Por isso a validação acontece **antes** de
gerar o arquivo e diz o que não cabe, com números:

```text
A grade não cabe em A4 (210 × 297 mm): ocuparia 300,0 × 284,1 mm.
Reduza o tamanho da etiqueta, o número de colunas/linhas ou as margens.
```

A ordem das checagens é deliberada: primeiro a forma (inteiros, faixas), depois o encaixe. Uma
largura de 500 mm não é "não cabe em A4" — é uma medida que o produto não aceita, e a mensagem
diz o intervalo. E a validação da geometria vem **depois** da autorização: erro de forma não
pode revelar se o evento existe para quem não tem permissão.

### 3.3 O lote é o mesmo nas três saídas

A folha A4 (FASE 31) não mudou de endereço nem de comportamento. As duas saídas novas
compartilham com ela a **preparação** (`prepareBadgePrint`): quem entra no lote (só crachá
`ACTIVE`, e a seleção da tela quando existe), o que fica de fora com o motivo, e o
`printedAt`/`printedById` marcados **nos três casos** — o ZPL inclusive: ele É a impressão, e
quem manda o arquivo para a térmica não quer o crachá aparecendo como "não impresso" na tela.

### 3.4 O checklist é snapshot, e a vaga é uma só

`registration_confirmation_items` guarda **uma linha por exigência da inscrição**, com posição
fixa (a tela nunca reordena), o texto que a pessoa foi cobrada, se é obrigatória e o estado
(`PENDING`, `RECEIVED`, `WAIVED`, com quem resolveu e quando). O estado da VAGA continua sendo
um só (`registrations.status`): o que mudou foi o caminho até ele.

O snapshot nasce **no mesmo lugar em que a inscrição nasce** — e isso são DOIS caminhos:
inscrição numa atividade que retém a vaga, e **promoção da lista de espera**. O segundo entrou
depois, e por um motivo simples: sem ele, a única pessoa do evento sem checklist seria a última
a ser chamada, justamente quem o balcão precisa conferir (armadilha 65).

### 3.5 A confirmação automática é o caminho de sempre

Quando a última exigência obrigatória é satisfeita, o serviço chama **`confirmRegistration`** —
a função que a equipe já usava. Ela é quem faz a transição condicional, grava quem confirmou,
escreve a trilha e enfileira o recibo; reimplementar "só a parte do `update`" aqui daria duas
confirmações no sistema, e a segunda esqueceria o aviso ou a trilha (armadilha 55).

A ordem também importa: **marca primeiro, confirma depois**. O item é gravado e só então o
checklist é relido para decidir; decidir antes de gravar deixaria a vaga confirmada com o item
ainda em aberto se a gravação falhasse.

---

## 4. ADRs

### ADR-192 — A geometria da impressão é dado configurável, não constante

**Contexto.** As medidas de folha adesiva (Pimaco e similares) e de rolo térmico variam por
modelo, por lote e por impressora. Um número fixo no código estaria errado para quase todo
mundo.

**Decisão.** A folha é uma grade em milímetros e a etiqueta térmica é um conjunto
(dpi, largura, altura, ampliação do QR); os dois vêm da query string, com padrão documentado
(3 × 8 de 63,5 × 33,9 mm centralizados em A4; 203 dpi com 100 × 50 mm). A tela expõe os
números ao lado dos botões de download, e a seleção da lista viaja com eles.

**Consequências.** O operador acerta a impressão sem deploy, conferindo na primeira folha; o
custo é uma tela a mais para preencher (com o padrão já preenchido). O padrão não é uma
recomendação de marca: é o formato mais comum de folha adesiva A4 e o crachá de cordão mais
comum.

### ADR-193 — Medida declarada que o sistema não entende é RECUSADA, não substituída

**Contexto.** `readNumber` devolvia o padrão quando o texto não era número e o DPI caía para
203 quando não estava na lista. Nos dois casos o arquivo saía, com a medida errada.

**Decisão.** `null` (ausente ou vazio, como o formulário manda) usa o padrão; **texto que não
vira número e valor fora do conjunto fechado de DPI são recusados**, com o campo nomeado na
mensagem.

**Justificativa.** `^PW`/`^LL` são contagens de pontos: a mesma etiqueta de 100 mm impressa a
203 dpi numa impressora de 300 dpi sai com 67 mm. Substituir em silêncio produz um resultado
fisicamente errado, sem erro em lugar nenhum — e o operador só descobre com o rolo na mão.

**Consequências.** Um link antigo com DPI inválido passa a falhar com mensagem em vez de
imprimir torto. A tela oferece só 203 e 300, então o caso normal não muda.

### ADR-194 — O ZPL é gerado como TEXTO seguro, com UTF-8 declarado

**Contexto.** `^` e `~` iniciam comando em ZPL; `_` é o caractere de escape do próprio `^FH`; e
acento depende de página de código. Um nome com `^` poderia virar comando e derrubar o lote.

**Decisão.** O rótulo abre com `^CI28` (UTF-8) e todo texto passa por `zplFieldText`, que
codifica em bytes UTF-8 e transforma tudo o que não é ASCII imprimível simples — incluindo
`^`, `~` e `_` — em par hexadecimal (`_C3_A9` para "é"). O QR leva `^FDLA,<código>` (o código do
crachá, sem dado pessoal, como na ADR-152).

**Consequências.** O arquivo continua legível por uma pessoa (`^FH^FD` e os pares hexadecimais
aparecem no meio) e a impressora recebe os bytes certos. O QR é limitado a 30 mm ou 40% da
largura, o que for menor: num rótulo de 100 × 50 mm ele chegaria a 44 mm e comeria o nome.

### ADR-195 — O nome do crachá sai INTEIRO: quebra por largura e corpo que encolhe

**Contexto.** O ZPL não quebra linha sozinho. Cortar o que não cabe faz o crachá perder o nome
exatamente onde ele é usado — na porta.

**Decisão.** `wrapZplText` quebra por largura em pontos; quando as linhas permitidas acabam, a
última recebe o resto INTEIRO (uma linha larga é visível na primeira impressão; uma palavra
ausente não é). `fitZplName` tenta as proporções de altura da maior para a menor e aceita a
primeira em que o nome inteiro caiba **na largura e no orçamento de altura** que sobra depois do
código e da origem. O piso (~4,5 mm num rótulo de 50 mm) é o limite de leitura a um braço.

**Consequências.** Nome curto sai grande; nome longo sai em até quatro linhas menores; e o
código e a origem nunca são empurrados para fora da etiqueta.

### ADR-196 — O checklist de confirmação é SNAPSHOT da inscrição

**Contexto.** A lista de exigências vivia só em `activities.confirmationRequirements`. Lê-la na
hora de conferir faria o balcão cobrar de quem já está na fila algo que a atividade passou a
pedir depois — ou deixar de cobrar o que foi combinado.

**Decisão.** `registration_confirmation_items` guarda uma linha por exigência, criada junto com
a inscrição (e na promoção da lista de espera), com posição fixa. A atividade continua sendo a
ORIGEM do texto; a inscrição guarda o que foi cobrado dela.

**Consequências.** Editar a atividade não reescreve o passado — e a tela do participante mostra
o snapshot quando ele existe, caindo na lista atual da atividade só para inscrições anteriores à
fase. A migração fez o backfill das pendentes a partir do JSON.

### ADR-197 — A confirmação da vaga é DERIVADA: todas as obrigatórias satisfeitas

**Contexto.** A equipe confirmava a vaga inteira. Registrar item a item exige decidir quando o
conjunto está cumprido sem criar um segundo estado de vaga.

**Decisão.** `canAutoConfirm` responde à pergunta sobre o checklist, e o serviço chama
`confirmRegistration` quando ela aprova. `WAIVED` conta como satisfeito (a organização abriu mão,
e o registro diz que foi ela); item opcional não bloqueia; sem checklist não há confirmação
automática (`NO_ITEMS`) — "nada a receber" não é o mesmo que "recebi tudo".

**Consequências.** A vaga continua com UM estado, e o histórico tem as duas pontas: cada item
com autor e hora, e a confirmação da inscrição. Marcar o último item de uma inscrição já
confirmada (o caso do promovido) devolve `ALREADY_CONFIRMED`, que o serviço absorve como
sucesso do item.

### ADR-198 — A obrigatoriedade nasce verdadeira no domínio E na tela

**Contexto.** O campo `required` é opcional no JSON e o domínio lê "ausente = obrigatória" para
o dado das fases anteriores continuar valendo. Na tela, a caixa da linha nova nascia
desmarcada — e o formulário grava o que está na tela.

**Decisão.** A caixa nasce **marcada** (`requirement?.required !== false`), e só o `false`
explícito torna a exigência opcional, nos dois lados.

**Consequências.** Toda exigência criada pela tela continua segurando a vaga, como na FASE 34; o
"traz se puder" é uma escolha explícita do organizador. O teste E2E prende o JSON gravado, e não
o texto da tela.

### ADR-199 — O item é escrito com transição condicional e trilha própria

**Contexto.** Duas pessoas no balcão clicam "Recebido" no mesmo item; ou a mesma pessoa clica
duas vezes porque a tela demorou.

**Decisão.** A escrita é `updateMany` com `where: { id, status: 'PENDING' }`; zero linhas é
resposta de negócio (`ALREADY_RESOLVED`), e a marcação entra na trilha com o estado anterior e
o novo — inclusive a obrigatoriedade. A leitura do checklist para decidir a confirmação acontece
**depois** da gravação.

**Consequências.** Um efeito por clique, como em toda transição deste projeto (invariante nº 5).
A trilha responde "quem recebeu o quê e quando" sem depender do estado atual da linha.

---

## 5. Lições aprendidas — defeitos REAIS encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | A exigência criada pela tela era gravada como **opcional** — a vaga deixava de ser segurada por quem a FASE 34 já segurava, sem nenhuma tela dizendo isso | A caixa "é obrigatória" nascia **desmarcada** na linha nova (`requirement ? ... : false`) e o formulário grava o que está na tela; o domínio lê "ausente = obrigatória", e a tela mandava `false` | `defaultChecked={requirement?.required !== false}` e um E2E que prende o JSON gravado (ADR-198) |
| 2 | `dpi=150` gerava arquivo em vez de recusar: o valor caía para 203 em silêncio | `thermalConfigFromParams` tratava DPI inválido como "usa o padrão"; os pontos são fixos e a medida em mm é física — a etiqueta sairia MENOR | DPI passou a ser conjunto fechado validado; valor presente e fora dele é recusado com a lista do que aceita |
| 3 | `largura=6 3,5` imprimia a folha inteira com 63,5 mm | `readNumber` devolvia o padrão quando o texto não virava número | `null` distingue "ausente" (padrão) de "não é número" (recusa), em todos os campos |
| 4 | Nome longo saía **cortado** no ZPL ("Albuquerque" desaparecia) | `wrapZplText` descartava o que passava do limite de linhas | Quando as linhas acabam, a última leva o resto inteiro — linha larga é visível, palavra ausente não |
| 5 | Nome grande em quatro linhas empurrava o **código e a origem para fora** da etiqueta | `fitZplName` aceitava a proporção só por caber na largura | `maxBlockDots`: a proporção só vence se o bloco do nome couber também na altura que sobra |
| 6 | O `README` publicava **1331** testes unitários e **588** de integração — a soma dava 1919, e por isso o erro passou por duas fases | a divisão por pasta foi herdada de uma contagem antiga e nunca reconferida: o total (`npm test`) estava certo e a abertura estava errada, que é o pior lugar para um número errado — ele parece conferido | medido por projeto (`npx vitest run tests/unit` e `npx vitest run tests/integration`): **48 arquivos · 1330** e **38 arquivos · 589**; o `README` §12 passou a trazer o número **e a contagem de arquivos**, que é a parte que denuncia a soma que não fecha |

Duas lições de **teste**, que não são defeito do produto e mudaram o desenho dos cenários:

* **o recado transitório de um formulário que a releitura remove não existe** (armadilha 76, de
  novo): depois de marcar o item, a fila relê e a linha volta sem o formulário do item resolvido
  — o `-feedback` do cliente sai de cena junto. A asserção passou a ser o **estado durável**
  (`data-item-status`, o resumo do checklist e o recado do servidor);
* **o clique antes da hidratação é absorvido pelo React.** O formulário da ação em linha já
  está no HTML, mas quem o envia é o cliente: com o bundle ainda carregando, o clique não vira
  requisição nenhuma (o E2E provou isso — a trilha de rede não tinha POST). Para quem opera é
  "cliquei e não aconteceu nada", e a pessoa clica de novo; o teste faz o mesmo, em vez de medir
  o tempo de carregamento do bundle. Virou a dívida **E50** e a armadilha 88.

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 86 arquivos · 1919 testes passando
npm run build ..................... Compiled successfully
                                    ƒ /api/t/[tenantSlug]/credenciamento/crachas/impressao
npm run db:verify ................. Contrato íntegro.
npm run db:verify:isolation ....... 9/9 verificações passaram.
npm run db:partitions ............. todas as partições do intervalo já existiam
                                    (9 partições · audit_logs_2026_09 com 30507 linhas)
npm run db:verify:pooling ......... Pooling íntegro: contexto por transação preservado sob PgBouncer.
npx prisma migrate status ......... 33 migrations found · Database schema is up to date!
npm run db:seed ................... OK (2 chamadas, 1 proposta, 1 vaga RETIDA)
npm run test:e2e .................. 128 passed (2.6m)

# A divisão por pasta, medida por projeto (é ela que o README §12 publica):
npx vitest run tests/unit ......... 48 arquivos · 1330 testes passando
npx vitest run tests/integration .. 38 arquivos ·  589 testes passando
                                    1330 + 589 = 1919 · 48 + 38 = 86 arquivos
```

Duas verificações que a bateria da seção 4 do protocolo exige e que valem registro, porque o
`--build` bem-sucedido **não** prova sozinho que o E2E mediu o código novo:

```text
docker images ..................... eventflow/web:local 43 seconds ago · eventflow/worker:local 37 seconds ago
GET .../crachas/impressao?formato=zpl (anônimo, sem eventId) ...... 400 INVALID_INPUT — NÃO 404:
      a rota nova está no ar, e a recusa é da FORMA da requisição (falta o evento), que não
      revela nada; a geometria continua sendo validada DEPOIS da autorização (linha 100)
```

E o seed, que passa pelos **serviços reais** (invariante de seed do projeto), criou o checklist
da vaga RETIDA ao criar a inscrição — a prova de que o snapshot não depende de migração:

```text
SELECT position, label, required, status FROM registration_confirmation_items …
  0 | 1 kg de alimento não perecível    | t | PENDING
  1 | 1 brinquedo novo ou em bom estado | t | PENDING
```

Os cinco cenários do E2E da fase, do ponto de vista de quem usa:

1. a organização declara as exigências na programação e diz qual é obrigatória — e o JSON
   gravado é `required: true` / `required: false`;
2. a pessoa se inscreve, a vaga fica retida e ela vê o **checklist item a item** na própria
   tela, sem botão para marcar (quem marca é a equipe);
3. o balcão marca o **opcional** (a vaga continua retida), depois o obrigatório — e a vaga se
   confirma sozinha, com o recibo saindo uma vez só;
4. a folha de **etiquetas** sai em PDF (com o lote no cabeçalho) e o arquivo **ZPL** sai em
   texto, com `^XA`/`^CI28`/`^BQN`, o código do crachá e o nome inteiro — e o crachá passa a
   constar como impresso;
5. medida fora da faixa e medida que não cabe são **recusadas** com o motivo, e uma folha de
   outro material (2 × 4 de 90 × 50 mm) é gerada normalmente.

---

## 7. Comandos operacionais

```bash
# Etiquetas adesivas (PDF) e impressora térmica (ZPL) — a tela monta a URL com as medidas
/t/<slug>/credenciamento/crachas?evento=<eventId>   → "Etiqueta adesiva e impressora térmica (medidas)"

GET /api/t/<slug>/credenciamento/crachas/impressao?eventId=<id>&formato=etiquetas
      &colunas=3&linhas=8&largura=63,5&altura=33,9
      &margem-esquerda=9,75&margem-superior=12,9&espaco-horizontal=0&espaco-vertical=0
GET /api/t/<slug>/credenciamento/crachas/impressao?eventId=<id>&formato=zpl
      &dpi=203&largura=100&altura=50&ampliacao-qr=3
      [&userIds=<uuid>,<uuid>]     # sem a lista, o lote é todo crachá válido do evento

# Conferir o lote sem gastar etiqueta: o ZPL é texto
curl -s ".../impressao?eventId=<id>&formato=zpl" | head -20

# Checklist item a item: a fila mostra o que falta e quem espera
/t/<slug>/administracao/eventos/<eventId>/confirmacoes
```

---

## 8. Dívidas técnicas e pontos de atenção

* **E41 quitada**: a folha adesiva e o ZPL existem, com as medidas na tela.
* **E48 quitada**: cada exigência tem estado próprio, e a vaga é derivada das obrigatórias.
* **E42 continua aberta, e agora pela metade**: a escolha de lente da câmera no credenciamento
  não entrou nesta fase; a **identidade visual do crachá** (logo, cor do tema, faixa por
  categoria) também não — as duas saídas novas desenham o mesmo crachá funcional da FASE 31.
* **E50 (nova)** — a ação em linha só existe depois de hidratada: um clique antes de o bundle
  carregar não vira requisição. Vale para TODAS as telas de operação (`InlineActionForm`), não
  só para as desta fase; o caminho é um formulário que funcione sem JavaScript (ou um aviso de
  "carregando" que bloqueie o clique).
* **Promovido × checklist**: quem é promovido da lista de espera recebe o checklist com a vaga
  JÁ confirmada (decisão da promoção, FASE 34). O item é registro do que foi entregue, e não
  segura nada — se o produto quiser cobrar a entrega de quem foi promovido, isso é uma decisão
  de negócio, não um defeito desta fase.
* **Retenção das etiquetas**: o arquivo baixado não tem prazo nem marca d'água (mesma família da
  **E44**, que trata do CSV de participantes).

---

## 9. Checklist de aceite

- [x] A folha de etiquetas adesivas sai em PDF, com a grade **configurável** e o padrão
      3 × 8 de 63,5 × 33,9 mm em A4
- [x] A impressão térmica sai em **ZPL II**, com dpi, medida e ampliação do QR
      **configuráveis** e o padrão 203 dpi · 100 × 50 mm
- [x] **Nenhuma marca ou modelo** no código; a tela expõe os números e a primeira impressão os
      confere
- [x] Medida que não cabe (ou que o sistema não entende) é **recusada** com o motivo, antes de
      gerar o arquivo
- [x] O ZPL declara UTF-8, escapa os caracteres de controle e leva o **nome inteiro** e o código
      do crachá
- [x] A folha A4 da FASE 31 continua no mesmo endereço e com o mesmo resultado
- [x] O lote marca `printedAt`/`printedById` nas **três** saídas (folha, etiqueta e ZPL)
- [x] Cada exigência da atividade vira uma **linha da inscrição**, com snapshot no momento da
      inscrição (e na promoção da lista de espera)
- [x] O balcão marca **item a item** (recebido ou dispensado), com autor, hora e observação
- [x] A vaga se confirma **sozinha** quando todas as obrigatórias estão satisfeitas, pelo mesmo
      caminho da confirmação manual (trilha e recibo incluídos)
- [x] Item **opcional** aparece no checklist e **não** segura a vaga; "sem exigências" continua
      sendo confirmação da equipe
- [x] Dois cliques no mesmo item produzem **um** efeito, e a trilha registra quem marcou
- [x] O participante vê o checklist com o estado de cada item, **sem** botão para marcar
- [x] A RLS responde "não existe" para o item da instituição vizinha, e o contrato de schema
      cobre a tabela nova
- [x] A suíte inteira continua verde (1919 testes + 128 E2E), com os testes da FASE 34 ajustados
      para a tela nova
