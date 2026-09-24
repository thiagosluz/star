# FASE 40 — Editor visual do certificado (arte de fundo e variáveis)

> **Entregue em:** FASE 40 · **ADRs:** 219 … 226 (a próxima é a 227)
> **Migração:** `20260924004155_certificate_templates` (1 tabela + 3 colunas em `certificates`)
> **Testes:** +131 no Vitest (unitários + integração) e +5 E2E

---

## 1. Sumário executivo

O certificado deixou de ter **um** desenho escrito no código. Cada instituição tem identidade
rígida — logotipo no topo, chancelas de reitoria no rodapé, texto formal com número de portaria —
e essa identidade não cabia em constantes de programa. Agora o organizador:

* sobe a **arte de fundo** (JPEG) da própria instituição;
* monta o texto com **variáveis** (nome, evento, atividade, carga horária, período, data, código de
  validação, QR) em vez de escrever o documento inteiro à mão;
* posiciona os elementos **arrastando** no palco **ou** digitando as medidas em milímetros — o
  formulário funciona **sem JavaScript**;
* parte de **cinco modelos prontos** e personaliza, ou começa do zero;
* vê uma **prévia** gerada pelo **mesmo renderizador** que produz o PDF emitido.

E nada disso muda o que já foi emitido: o desenho é **congelado em cada certificado** no ato da
emissão.

### Entregas

| # | Entrega | Onde |
|---|---|---|
| 1 | Regras puras do layout: página em mm, catálogo fechado de variáveis, limites, validação, montagem a partir das linhas do formulário, serialização canônica e **cinco modelos prontos** | `src/domain/certificates/certificate-layout-rules.ts` |
| 2 | Leitura de JPEG em Node puro: medidas, componentes de cor e **orientação EXIF** | idem (`readJpegInfo`) |
| 3 | Desenho do layout nos **dois formatos** a partir da mesma geometria (wrapping, alinhamento, matriz de posicionamento, QR) | `src/lib/documents/layout-draw.ts` |
| 4 | Renderizador da **versão 2** do documento: SVG autossuficiente e PDF com a arte embutida (`/DCTDecode`) | `src/lib/certificates/layout-renderer.ts` |
| 5 | Serviço do modelo: criar/editar/excluir, upload da arte validada pelos bytes, resolução por precedência e leitura da arte | `src/lib/certificates/certificate-template-service.ts` |
| 6 | Migração com a tabela `certificate_templates` (RLS + FORCE + 4 índices únicos parciais) e o snapshot no certificado | `prisma/migrations/20260924004155_certificate_templates/` |
| 7 | Emissão: conteúdo canônico **versão 2** (layout + variáveis congeladas) e verificação compatível com a versão 1 | `src/lib/certificates/certificate-service.ts`, `certificate-rules.ts` |
| 8 | Tela de modelos: galeria, editor com palco arrastável, formulário numérico, arte de fundo e prévia | `src/app/t/[tenantSlug]/(app)/administracao/certificados/modelos/page.tsx`, `src/components/admin/certificate-template-editor.tsx` |
| 9 | Arte do modelo entrando na **quota de armazenamento** da instituição (5ª fonte) | `src/lib/storage/storage-quota.ts` |
| 10 | Testes: 66 + 38 unitários, 27 de integração e 5 E2E | `tests/unit/certificate-layout*.test.ts`, `tests/integration/certificate-template.test.ts`, `tests/e2e/certificate-template.spec.ts` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **12** — 5 de aplicação/domínio, 1 componente, 1 página, 1 migração, 3 de teste e este documento |
| Arquivos alterados | **17** — os 15 da entrega (`schema.prisma`, o contrato de schema, o renderizador antigo, o renderizador de crachá e as primitivas de PDF (as fontes separadas), o serviço de certificados e as regras canônicas, a quota de armazenamento, as Server Actions de certificado, a tela de administração, o seed e os quatro documentos (README, AGENTS, armadilhas, dívidas)) mais **2 do ajuste pós-entrega**: o serviço da fila de confirmações (desempate da ordenação) e o teste dela |
| Migrações | **1** — `certificate_templates` + `certificates.templateId/layoutSnapshot/variableSnapshot` |
| Tabelas de tenant | **51 → 52** (`certificate_templates` sob RLS + FORCE) |
| Testes novos | **131** no Vitest (104 unitários + 27 de integração) e **5** E2E — a suíte vai de **2014/90** para **2145/93**, e o E2E de **137** para **142**; depois do defeito 13 (regressão da ordenação da fila) a suíte ficou em **2146/93** |
| Defeitos reais encontrados | **13** — 12 desta fase e 1 de fase anterior, encontrado na bateria (§5) |
| Dívidas quitadas | **nenhuma** — a fase não estava amarrada a dívida |
| Dívidas novas | **2** — **E54** (CPF e título da apresentação sem fonte) e **E55** (mover pelo teclado no palco) |
| Armadilhas novas | **4** — **93** (`Number('')` é `0`), **94** (client do Prisma desatualizado), **95** (`setState` em efeito para detectar hidratação) e **96** (ordem por chave que empata) |
| ADRs | **219 … 226** (a próxima é 227) |

---

## 2. O problema mais difícil: **o documento é probatório, e agora o desenho é dado**

Até aqui o desenho era **código**: para mover o nome, mexia-se no renderizador. Passar o desenho
para o banco parece só "mais uma tela" — e não é, porque o certificado tem três propriedades que a
tela não tem:

1. **Determinismo.** O mesmo conteúdo precisa produzir os mesmos bytes. O hash do documento é
   conferido pela validação pública, e o renderizador é escrito à mão exatamente para isso.
2. **Imutabilidade.** Documento emitido não muda. Nem quando o evento é renomeado, nem quando o
   organizador troca a arte no ano seguinte.
3. **Valor formal.** Uma arte com as cores da instituição erradas, um texto cortado no meio ou um
   certificado que perdeu o QR são defeitos que só aparecem no papel — e no papel já é tarde.

Cada um desses pontos virou uma decisão estrutural, e é isso que este documento explica.

---

## 3. Decisões técnicas

### 3.1 O desenho virou DADO, em milímetros

`CertificateLayout` é página + arte + lista de elementos, **tudo em milímetros**, com origem no canto
superior esquerdo (o espaço em que a tela pensa). O renderizador obedece; ele não decide nada.

Alternativa descartada: posições relativas em porcentagem. Porcentagem é cómoda na tela e péssima na
impressão: "3 mm fora" é um defeito de impressão, e a única unidade em que ele se mede é a física.

### 3.2 A versão do documento é DERIVADA do snapshot

O conteúdo canônico ganhou a **versão 2** (layout + variáveis congeladas). A versão 1 continua
verificável exatamente como nasceu — recalculá-la com campos a mais reprovaria a assinatura de todo
certificado existente (o mesmo problema que a FASE 30 resolveu no sorteio, ADR-144).

E a versão **não** é uma coluna: `layoutSnapshot` presente ⟺ versão 2. Uma coluna a mais criaria o
estado incoerente "versão 2 sem layout".

### 3.3 O que o desenho imprime está congelado — inclusive o que vem de fora

Aqui estava a lacuna que o layout **revelou**: o nome do evento, o nome da instituição e o título da
atividade eram lidos **na hora de renderizar**. Enquanto o desenho era fixo e não os mostrava, isso
não aparecia; com variáveis, renomear o evento faria o MESMO documento (mesmo hash) sair impresso
diferente — e o hash deixaria de provar coisa alguma.

Então as 11 variáveis de **conteúdo** são gravadas em `variableSnapshot` na emissão, e entram no
conteúdo assinado. As 3 de **auditoria** (hash, assinatura e chave) saem do próprio documento e
ficam **fora** do payload: o hash não pode depender de si mesmo.

### 3.4 A arte entra como está; a orientação EXIF vira matemática

O JPEG é embutido no PDF escrito à mão no `/DCTDecode`, **sem recomprimir** — é o que mantém os
bytes estáveis. Foto de celular costuma vir "deitada" com a rotação no EXIF, e o PDF não lê EXIF:
recodificar para endireitar mudaria os bytes, então a rotação e o espelho entram na **matriz** de
posicionamento (a mesma que o SVG usa; os dois formatos só diferem na unidade e na inversão do eixo
Y).

`COVER` usa **um** fator de escala para os dois eixos: esticar deforma o logotipo, e nenhuma
instituição aceita a própria marca achatada.

### 3.5 CMYK e JPEG progressivo são RECUSADOS, não convertidos

É a mesma régua da medida de etiqueta que o sistema não entende (armadilha 87, ADR-193): a
alternativa não é um erro visível, é um documento formal com as cores da instituição erradas — que
ninguém percebe olhando a tela. A recusa diz o que fazer ("exporte em RGB", "exporte como JPEG
padrão").

### 3.6 O palco posiciona; o número é o caminho que sempre funciona

A tela tem duas camadas que não competem: o **palco** (arrastar, com a caixa **presa à página**: o
gesto não deixa o elemento sair dos limites) e as **linhas do formulário** (X, Y, largura, altura,
corpo, cor). Arrastar **escreve nos campos** — nunca em estado paralelo —, então o mesmo formulário
funciona sem JavaScript: sem script, os botões de arrastar não aparecem e o organizador digita as
medidas.

O palco é **esquemático** de propósito. Quem mostra o documento é a **prévia**, gerada no servidor
pelo mesmo renderizador que produz o PDF. Um desenho paralelo no navegador faria o organizador
aprovar na tela um certificado que não é o que sai. Ele também é **proporcional**: as posições são
percentuais e o palco mantém a proporção da página, então o desenho cabe em qualquer largura — e o
gesto converte pixel em milímetro pela medida real (a primeira versão, em pixels absolutos,
recortava as caixas e o arrastar não alcançava nada). Quem decide **quanto** de largura o palco
recebe é a §3.9 — e essa decisão mudou depois do primeiro uso real.

### 3.7 Sem modelo configurado, vale o desenho antigo

O editor é **opt-in**: instituição que não abriu a tela continua emitindo no desenho fixo da FASE 6,
com o mesmo hash da versão 1. Trocar o visual de todo certificado da plataforma sem ninguém pedir
seria exatamente o tipo de mudança silenciosa que este projeto evita.

### 3.8 A tela tem que ser ALCANÇÁVEL, e isso é parte da entrega

O editor chegou a existir com rota, testes e documentação — e **sem link nenhum**: só por endereço
digitado. Corrigido com "Modelos de certificado" na lista de áreas de gestão **e** na tela de
certificados, e o E2E passou a **começar no painel e clicar** até o editor. Uma funcionalidade que
só existe na barra de endereços não existe para quem opera.

### 3.9 A bancada vem primeiro, e ocupa a largura — o palco é o trabalho, não um acessório

O primeiro desenho punha palco e prévia numa coluna de **360 px**, ao lado de uma tabela que pede
860 px. O organizador abriu a tela e resumiu: *"essa parte de arrastar e prévia está em uma posição
ruim e tamanho pequeno, ficando um pouco confuso"* — e estava certo. A 360 px de largura, um
elemento de 4 mm vira um risco de 8 px, e a prévia ficava **espremida embaixo** do palco, sem
relação visível com o que se arrastava.

O desenho passou a ser, de cima para baixo:

```
1. BANCADA — palco e prévia lado a lado, metade da largura cada (empilhados em tela
   estreita): é aqui que o organizador TRABALHA, e é por isso que vem antes de tudo;
2. FORMULÁRIO — as 24 linhas de medidas, agora com a largura toda (a tabela de 860 px
   respirava mal em 620 px e vivia com barra de rolagem);
3. ARTE DE FUNDO — upload e a arte atual, na coluna da direita do formulário.
```

Três decisões dentro disso: a página do editor usa `max-w-7xl` (é a **única** tela que desenha uma
página física em milímetros — a largura extra é requisito, não enfeite); o palco numera as caixas
(`3. codigo_validacao`), porque a caixa selecionada no palco e a linha da tabela precisam ser
reconhecidamente **a mesma coisa**; e o palco saiu da frente do upload, para que trocar a arte não
empurre o que se está arrastando para fora da tela.

### 3.10 Depois de criar, a pessoa está NA coisa criada

**Contexto.** Salvar um modelo **novo** deixava a página onde ela estava: a URL continuava
`?novo=<modelo pronto>`, e **é a URL que monta o editor**. O modelo passava a existir no banco
enquanto a tela seguia desenhando "modelo novo" — a caixa de arte dizia *"salve o modelo primeiro"*
**depois** de salvar, não havia `templateId` para o upload, e o organizador tinha de recarregar a
página para continuar o trabalho que ele acabara de começar. O sintoma é do tipo que se aprende a
conviver ("ah, tem que dar F5"), e é exatamente por isso que vale consertar.

**Decisão.** O salvamento de um modelo **novo** navega para o endereço do modelo
(`?modelo=<id>&salvo=1`). A edição de um modelo existente continua respondendo **na própria tela**,
com a mensagem de sucesso — ali não há nada para onde navegar, e recarregar apagaria o que a pessoa
está vendo.

**Por que assim, e não só uma mensagem.** Navegar resolve as três coisas de uma vez: a tela reabre
com o identificador, com a arte que houver e com o layout gravado. É o **mesmo caminho do rascunho
de submissão** (revisão da FASE 4: "o rascunho cai direto na página da submissão"): criar não é um
estado provisório que a pessoa abandona, é o começo do trabalho sobre a coisa criada.

**Consequências.** (a) O aviso de sucesso viaja **na URL** (`salvo=1`), porque o estado da Server
Action não sobrevive à navegação — e ele se apaga sozinho no primeiro clique da galeria, que não
carrega o parâmetro. (b) Um `?novo=` **não** sobrevive ao salvamento: o modelo criado passa a ser o
assunto da tela. (c) O E2E do cenário 1 prende as duas pontas — o endereço com `modelo=<id>` e a
caixa de arte **liberada** (`background-file` visível, `background-needs-save` ausente), que era o
sintoma visível do defeito.

---

## 4. ADRs

### ADR-219 — O layout é DADO em milímetros, e vive no snapshot do certificado

**Contexto.** O desenho fixo obrigava a mexer no código para cada ajuste de posição, e cada
instituição tem identidade própria (chancelas, portaria, logotipo).

**Decisão.** `CertificateLayout` (página, arte e elementos em mm) é dado gravado em
`certificate_templates.layout` e copiado para `certificates.layoutSnapshot` na emissão.

**Consequências.** O renderizador passa a ser genérico e o ajuste é do organizador. Em troca, o
banco guarda geometria — e por isso a validação é obrigatória na entrada (§3.1).

### ADR-220 — O conteúdo canônico ganha a versão 2, e a versão é DERIVADA

**Contexto.** Ligar o layout ao hash muda o documento; certificados existentes têm o hash no formato
antigo.

**Decisão.** `buildCanonicalPayloadV2` inclui `layout` (serialização canônica, com a impressão da
arte) e `content` (variáveis congeladas). A verificação reconstrói a versão 1 quando **não há**
`layoutSnapshot`, e a 2 quando há.

**Consequências.** Nada do passado muda; documentos novos são verificáveis com o mesmo rigor. Não
existe coluna de versão, então não existe o estado "versão 2 sem layout".

### ADR-221 — As variáveis que o desenho imprime são CONGELADAS na emissão

**Contexto.** Evento, instituição e atividade vivem em outras tabelas e eram lidos na renderização.

**Decisão.** As 11 variáveis de conteúdo entram em `variableSnapshot` e no payload assinado; as 3 de
auditoria (hash, assinatura, chave) ficam fora, derivadas do próprio documento.

**Consequências.** O hash cobre exatamente o que se lê no papel. Renderizar um certificado com layout
e **sem** o snapshot falha em vez de improvisar com os dados de hoje.

### ADR-222 — A arte entra no PDF como está, e a orientação EXIF vira matriz

**Contexto.** O PDF é escrito à mão para ser determinístico; a arte precisa entrar sem quebrar isso.

**Decisão.** Bytes originais no `/DCTDecode` (sem recomprimir), com o XObject montado à mão; a
orientação EXIF (1–8) é aplicada na **matriz** de desenho, lida no upload e guardada como dado.

**Consequências.** O arquivo emitido é reproduzível byte a byte (há teste de determinismo com e sem
arte). O `/Length` do stream passa a ser medido em bytes, e o `assemblePdf` aceita `Buffer`.

### ADR-223 — CMYK e JPEG progressivo são recusados

**Contexto.** Um JPEG CMYK embutido como RGB, ou um progressivo que alguns leitores não abrem,
produzem documento formal errado sem erro visível.

**Decisão.** A validação recusa com o caminho da correção (exportar em RGB / JPEG padrão), e exige
resolução mínima de 150 dpi para a página escolhida — com a orientação EXIF considerada na conta.

**Consequências.** O organizador pode precisar reexportar a arte. O documento nunca sai com a cor
errada. Mesma régua da armadilha 87.

### ADR-224 — Sem modelo configurado, vale o desenho fixo da FASE 6

**Contexto.** O editor poderia passar a valer para todo mundo, mudando o visual de certificados de
instituições que nunca abriram a tela.

**Decisão.** A ausência de modelo significa versão 1 do documento (desenho fixo).

**Consequências.** A fase é opt-in e não muda nada do que já existe. O seed cria um modelo de
demonstração para o caminho novo ficar visível.

### ADR-225 — A precedência do modelo é do mais específico ao mais genérico

**Contexto.** Uma instituição pode querer um desenho geral e outro só para o minicurso de um evento.

**Decisão.** `EVENTO+TIPO → EVENTO → INSTITUIÇÃO+TIPO → INSTITUIÇÃO → padrão do código`, resolvido
por função pura, com a **exclusividade de cada combinação garantida por quatro ÍNDICES ÚNICOS
PARCIAIS** no banco (o PostgreSQL trata NULLs como distintos em índice único).

**Consequências.** Não há ambiguidade nem desempate por `updatedAt`; dois modelos para o mesmo alvo
são recusados pelo banco, com mensagem. Editar o modelo **sem** mandar o alvo o move para
"instituição/qualquer tipo" — e o banco recusa se o lugar estiver ocupado (a tela pré-preenche os
seletores para isso não acontecer por acidente).

### ADR-226 — O palco posiciona, a prévia documenta, e o número é o caminho sem JavaScript

**Contexto.** Arrastar é a interação pedida, mas o projeto tem a régua de que a tela funciona sem
JavaScript quando a operação é possível por formulário (FASE 38, E50).

**Decisão.** O palco escreve nos campos numéricos do mesmo formulário que o envio usa; sem script,
os controles de arrastar não aparecem e a tela mostra as 24 linhas do teto; a prévia sai do
renderizador do servidor.

**Consequências.** Dois caminhos, uma fonte de verdade. O que **não** existe é mover pelo teclado no
palco (dívida **E55**).

---

## 5. Lições aprendidas — defeitos REAIS encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Elemento gravado com **corpo 0 pt** — invisível, e sem erro nenhum | `Number('')` devolve `0`, e `0` é finito: o "valor inválido cai no padrão" não pegava campo **vazio** | Campo vazio passou a ser tratado como AUSENTE antes da conversão (armadilha **93**) |
| 2 | O texto que não cabia na altura era cortado **sem** as reticências que o código dizia acrescentar | O marcador não cabia na última linha (que já encostava na largura) e o plano B requebrava o texto **sem** o marcador | `ellipsize`: apara palavras (ou caracteres, no caso de uma palavra só) até o marcador caber |
| 3 | Matriz "igual" reprovada em teste por `-0` | `Math.round(Math.sin(0))` deixa sinal negativo no coeficiente | Normalização de `-0` na própria função de matriz |
| 4 | `COVER` cobria a página com `209.99999999999997` mm de altura | Ruído de ponto flutuante na escala | Medidas arredondadas ao mícron na geometria |
| 5 | `The column certificate_templates.backgroundKey does not exist in the current database` — e só no **update** | O client do Prisma foi gerado antes de a migração ser ajustada; o `create` não tocava nas colunas removidas, mas o `update` retorna a linha inteira | `prisma generate` depois de mexer no schema (armadilha **94**) |
| 6 | Duas suítes de integração quebrando com "Já existe um modelo para este evento e este tipo" | As fixtures criavam modelos para alvos que já estavam ocupados — o **banco** recusando, como projetado | Fixtures reorganizadas por combinação (evento+tipo), e a resolução passou a ser usada para achar o modelo em vez de criar outro |
| 7 | Salvar o modelo pelo serviço movia o alvo para "instituição/qualquer tipo" sem querer | A edição mandava `eventId`/`kind` vazios, e vazio significa "não especificado" | O teste passou a mandar o alvo (como a tela faz, com os seletores pré-preenchidos) e a fase documenta a armadilha |
| 8 | `npm run lint` reprovou o editor com erro do React Compiler: `setState` dentro de efeito | Eu guardava a prévia em estado e a atualizava num efeito quando a do servidor chegava | A prévia passou a ser **derivada** (`serverPreview ?? model.previewSvg`) — mais simples, e uma prévia recusada não apaga a última boa (armadilha **95**) |
| 9 | Os testes do renderizador antigo reprovaram a contagem de objetos do PDF | As três fontes novas do editor entravam no documento da versão 1, mudando os bytes de um documento que já existe | `PDF_TEXT_FONT_OBJECTS` (as duas de sempre) para os documentos antigos; as cinco só no layout |
| 10 | **O arrastar não fazia nada** — o campo X não mudava, e a leitura natural era "o arrastar não funciona" | O palco posicionava as caixas em PIXELS (3,2 px/mm) e se limitava à largura da COLUNA: as caixas passavam da borda, ficavam recortadas pelo `overflow-hidden` e o ponteiro caía fora delas. Medir o alvo do `pointerdown` mostrou que ele era o `html` | O palco virou PROPORCIONAL (posições em `%`, `aspect-ratio` da página) e o gesto converte pixel em milímetro pela medida real do palco — o desenho cabe em qualquer coluna |
| 11 | Depois de corrigir o palco, o E2E continuava sem mover a caixa | O palco fica abaixo da dobra, e `page.mouse.move` **não rola a página** (o `locator.hover()` rola) — o gesto acontecia fora da área visível, e o alvo voltava a ser o `html` | `scrollIntoViewIfNeeded()` antes de medir e arrastar. **Medir o alvo do evento em vez de concluir pelo sintoma** — a mesma régua da armadilha 92, aplicada ao gesto |
| 12 | **O editor não era alcançável por link nenhum.** A pergunta do humano foi direta: *"qual a rota para editar os certificados?"* | A tela de modelos foi entregue, ganhou rota, testes e documentação — e **nenhuma outra tela apontava para ela**. A lista de áreas de gestão (`/administracao`) não a tinha, e a tela de certificados (onde a emissão acontece) também não | Link "Modelos de certificado" nas **duas** telas de partida, com a permissão certa (`event:manage`), mais a contagem de modelos no resumo do painel; e o E2E passou a **começar no painel e clicar até o editor**, em vez de abrir a URL direta. **Funcionalidade entregue que ninguém alcança não existe para quem opera** — a rota só está pronta quando há um caminho de clique até ela |
| 13 | **A bateria reprovou em `confirmation-items.test.ts` sem que a FASE 40 tivesse tocado nele** — e o teste oscilava: verde em três execuções, vermelho na quarta, sempre em `expect(comChecklist.length).toBeGreaterThan(0)`. Repetir não era resposta, e "teste instável" também não: **era defeito de produto** (o teste só estava no lugar errado para mostrá-lo) | A fila da equipe seleciona `activities[0]` quando ninguém escolheu atividade, e a ordem vinha de `ORDER BY startsAt`. As atividades do cenário nascem **todas com o mesmo `startsAt`** e, como o prazo é o fim do dia local (ADR-173), as duas pendentes empatavam também no prazo: `Postgres` não promete ordem entre iguais e devolvia ora a atividade com checklist, ora a "só local" (sem exigência nenhuma) — a tela abria numa fila vazia de itens, sem erro (armadilha **96**) | Desempate **total** e igual nas duas pontas: `orderBy: [{ startsAt }, { createdAt }, { id }]` no banco e o comparador repetindo os três critérios; teste novo que afirma a atividade selecionada **e** que as concorrentes estão de fato empatadas. Diagnosticado com **dado**, não com opinião: um log temporário do `status`/`items.length` de cada linha e das datas de vencimento mostrou os dois prazos idênticos ao milissegundo |

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 93 arquivos · 2146 testes passando
npm run build ..................... ✓ Compiled successfully (rota /administracao/certificados/modelos listada)
npm run db:verify ................. Contrato íntegro.
npm run db:verify:isolation ....... 9/9 verificações passaram.
npm run db:partitions ............. partições do mês atual e dos seguintes garantidas
npm run db:verify:pooling ......... Pooling íntegro: contexto por transação preservado sob PgBouncer.
npx prisma migrate status ......... 35 migrations found · Database schema is up to date!
npm run db:seed ................... OK (modelo visual do minicurso criado; 2 certificados)
npm run test:e2e .................. 142 passed
```

Depois do ajuste de bancada (§3.9) e do ajuste de endereço (§3.10), a bateria foi repetida inteira
na árvore com o código novo (imagem `eventflow/web:local` de 08:50, container reconstruído): `lint`
0/0 · `typecheck` 0 · `npm test` **93 arquivos · 2146 testes** · `build` ✓ · E2E **142 passed**, com o
spec do editor **5/5** rodado à parte antes da suíte. O desenho novo foi conferido em tela de
1440 × 900 (palco e prévia lado a lado, tabela de 11 colunas sem barra de rolagem horizontal), e a
captura foi descartada — o que fica é o código e este registro.

Os cinco cenários do E2E, do ponto de vista de quem usa:

1. o organizador parte de um **modelo pronto** pela tela, dá nome, escolhe o evento e salva — o
   layout gravado já traz o bloco probatório (QR + código + endereço);
2. a **prévia** mostra o documento em milímetros, com os dados de exemplo do catálogo ("Ana Souza");
3. **arrastar** a caixa no palco escreve nos campos numéricos, e a posição arrastada é a que fica
   gravada;
4. **sem JavaScript**, o palco e os botões de arrastar não aparecem, as 24 linhas estão no
   formulário, e trocar a variável e a coordenada pelo caminho nativo grava o modelo;
5. a **arte** CMYK é recusada com o motivo ("exporte em RGB") e o JPEG RGB de 3508 × 2480 entra — a
   galeria passa a mostrar o tamanho da arte.

---

## 7. Comandos operacionais

```bash
# A tela de modelos (arte, variáveis, modelos prontos, prévia) — chega-se por
# /administracao → "Modelos de certificado", ou pela tela de certificados
/t/<slug>/administracao/certificados/modelos

# Direto num modelo
/t/<slug>/administracao/certificados/modelos?modelo=<templateId>
# Começando de um modelo pronto
/t/<slug>/administracao/certificados/modelos?novo=classico-institucional

# O que está gravado: layout, arte e alvo de cada modelo
psql "$DATABASE_URL" -c \
  'SELECT name, "eventId", kind, jsonb_array_length(layout->''elements'') AS elementos,
          layout->''background''->>''checksum'' AS arte
     FROM certificate_templates ORDER BY name'

# Quais certificados já saíram com desenho próprio (versão 2 do documento)
psql "$DATABASE_URL" -c \
  'SELECT "validationCode", "templateId", ("layoutSnapshot" IS NOT NULL) AS com_layout
     FROM certificates ORDER BY "createdAt" DESC LIMIT 20'

# Quanto a instituição ocupa com arte de modelo
psql "$DATABASE_URL" -c 'SELECT sum("backgroundBytes") FROM certificate_templates'
```

**Cinco modelos prontos:** Clássico institucional · Faixa lateral · Minimalista · Diploma · Formal
com portaria. Nenhum traz arte — a arte é da instituição, e todos deixam o topo (até 40 mm) e o
rodapé livres para ela.

**Variáveis disponíveis (todas com fonte declarada na tela):** nome · título · corpo · evento ·
atividade · carga horária · período · data de emissão · instituição · código de validação · endereço
de validação · impressão do conteúdo · assinatura · chave.

---

## 8. Dívidas técnicas e pontos de atenção

* **CPF e "título da apresentação" NÃO estão no catálogo (E54, nova).** O participante não tem campo
  de documento e o certificado não se liga à submissão. Uma variável sem fonte sairia como rótulo
  vazio em documento formal — então ela não é oferecida, e a dívida registra as duas fontes que
  faltam.
* **Mover pelo teclado no palco não existe (E55, nova).** O formulário numérico cobre o caso sem
  JavaScript (e o teclado funciona nele), mas o palco em si exige ponteiro. Mesma família da **E51**.
* **Só as 14 fontes padrão do PDF.** Serifa e monoespaçada entraram; a fonte da instituição
  (arquivo `.ttf`) exigiria embutir o binário — e aí o hash do documento passaria a depender dele.
* **Teto de 24 elementos por modelo**, com o editor mostrando as 24 linhas sem JavaScript. Mais que
  isso, o formulário sem script fica impraticável antes de o desenho ficar.
* **A arte não tem histórico de versões.** Trocar a arte apaga a anterior (e o objeto no bucket):
  guardar versões faria a instituição pagar por artes que ninguém consegue escolher. Certificado já
  emitido não depende dela — o layout congelado aponta para a chave da época, e é por isso que
  excluir um modelo **não** apaga objetos.
* **O palco é esquemático.** Ele posiciona; a prévia (servidor) documenta. Quem confere fidelidade
  olha a prévia, não o palco.
* **`certificate_templates.backgroundBytes` é derivado do layout.** Existe para a quota somar sem
  varrer JSON; a fonte de verdade da arte continua sendo o layout.

---

## 9. Checklist de aceite

* [x] O organizador sobe a **arte de fundo** (JPEG) e ela entra no PDF emitido
* [x] O texto usa **variáveis** — nome, evento, atividade, carga horária, período, data, código e QR
* [x] Os elementos são posicionados em **milímetros**, por arrastar **e** por formulário
* [x] **Sem JavaScript** o editor funciona: 24 linhas, nenhum controle morto, envio nativo
* [x] **Cinco modelos prontos** para escolher, e o organizador personaliza a partir deles
* [x] O **bloco probatório** (QR, código, endereço) é obrigatório e o layout sem ele é recusado
* [x] A **prévia** sai do mesmo renderizador do documento, com dados de exemplo do catálogo
* [x] O desenho é **congelado no certificado** na emissão; editar o modelo não muda o emitido
* [x] O conteúdo canônico é **versão 2** com layout e variáveis, e a **versão 1 continua verificável**
* [x] A **validação pública** confere a assinatura do certificado com layout
* [x] A **precedência** do modelo é a mais específica primeiro, sem ambiguidade (índices parciais)
* [x] O **palco e a prévia** ficam lado a lado na bancada, com a largura da página física, e o palco numera as caixas na mesma ordem da tabela (§3.9)
* [x] Salvar um modelo **novo** cai no endereço do modelo (`?modelo=<id>`), com a arte já liberada (§3.10)
* [x] CMYK, JPEG progressivo, arte pequena demais e arquivo que não é JPEG são **recusados** com motivo
* [x] A arte do modelo **conta na quota** de armazenamento da instituição
* [x] A **RLS** isola os modelos entre instituições (verificado em teste)
* [x] A trava do **sistema de design** continua verde (tokens, escala tipográfica, zero cor literal)
* [x] Toda a suíte verde (**2146** testes + **142** E2E), com os testes das fases anteriores intactos
* [x] Documentação da fase, README, `AGENTS.md`, armadilhas (93–96) e dívidas (E54, E55) atualizados
