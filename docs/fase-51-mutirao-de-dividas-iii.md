# FASE 51 — Mutirão de dívidas II: alcance rápido e fechamento da FASE 49

> Terceira e última edição do mutirão (FASE 12, FASE 50, FASE 51). Esta entrega pega
> **onze dívidas** em dois blocos que o humano escolheu: **alcance rápido** (o que estava
> pronto mas não chegava à tela) e o **fechamento da FASE 49** (o que a exportação com
> prazo deixou em aberto). **B8** (retenção da auditoria) e **E72** (expurgo e alerta da
> trilha de identidade) ficam **fora**, por decisão consciente: são política de retenção,
> não alcance.

---

## 1. Sumário executivo

### 1.1 As onze dívidas quitadas

| Dívida | O que era | O que ficou |
|---|---|---|
| **E70** | O link compartilhado da carta **não expirava nem era medido** | Validade **opcional** ("sem prazo" é o padrão), **contador de acessos** e última abertura visíveis ao dono; a página pública responde **igual** para link inexistente, expirado e revogado |
| **E73** | A lista de exportações dizia **quantos** downloads, não **quem** baixou | A lista mostra os últimos downloaders (nome + quando), lidos da trilha numa **consulta só** para toda a lista |
| **E58** | Exclusão lógica sem lista de arquivados: quem excluía por engano dependia de `UPDATE` no banco | Filtro **"arquivados"** na própria listagem, com **quando/por quem** e botão **Restaurar** |
| **E19** | O acervo de mídia trazia as 200 mais recentes, sem filtro | **Busca e filtros** (texto, tipo, evento, em uso × não usado) aplicados **no banco**, com contagem e "mostrando N de M" |
| **E7** | O serviço de validação existia; faltava conferir **uma lista** | Tela de **conferência em lote** por lista de códigos, com o motivo de cada recusa e o limite que evita enumeração |
| **E32** | A **trilha** do rascunho não podia ser trocada: quem errava excluía e recomeçava | Troca liberada **enquanto nada depende dela** (rascunho, sem parecer e sem atribuição), com a tela dizendo o motivo e o caminho quando não pode |
| **E37** | O telão do sorteio respondia desde a criação, mostrando o título do prêmio | **Interruptor** do telão; desligado, a página não vaza prêmio nem elegíveis e diz que está desligado (não é 404) |
| **E42** | A etiqueta era "funcional e fria" e a câmera só usava a lente traseira | **Categoria** do crachá (escolhida, não deduzida) com **faixa de cor** e identidade do evento na folha A4, na etiqueta, no ZPL e no crachá online; **escolha da lente** no balcão |
| **E57** | Nada avisava sobre **QR repetido** do mesmo patrocinador no evento | Aviso com o número e a consequência, e **confirmação explícita** para prosseguir (sem teto fixo, por decisão do humano) |
| **E63** | A ordem da equipe na vitrine era só derivada | **Ordem manual por EQUIPE** (`event_teams.displayOrder`), com o líder primeiro dentro de cada equipe |
| **E66** | A autorização da foto era **declarada**, não guardada | **Declaração guardada** com texto, **versão**, canal e data — o mesmo desenho do consentimento do QR (FASE 42) |

### 1.2 Números da fase

| | |
|---|---|
| Migrações | **48 → 49** (cinco colunas, todas aditivas e com padrão que preserva o existente) |
| Tabelas de tenant | **57** (nenhuma nova) |
| ADRs | **280 a 288** |
| Dívidas | **11 quitadas**; **1 declarada** (E74 do logo em imagem — ver §8) |
| Defeitos reais encontrados | **7** (inclui o defeito de INTEGRIDADE do certificado) — ver §5 |

---

## 2. O problema mais difícil da fase

**A trilha do rascunho: editar não é reclassificar.** A trilha ficou fora da edição de
conteúdo desde a revisão da FASE 4 — e por um motivo que continua verdadeiro: trocá-la muda
a **rubrica** de avaliação, o **requisito de versão cega** e a **fila de revisores**. Só que
a consequência prática era desproporcional: quem errava um seletor **excluía o rascunho e
recomeçava**, e recomeçar do zero por causa de um campo é como se perde um trabalho.

A saída não foi "liberar a trilha", foi **perguntar pelo que depende dela**:
`canChangeSubmissionTrack({ status, reviewCount, assignmentCount })`. A troca passa
enquanto nada foi construído sobre a classificação (rascunho, zero pareceres, zero
atribuições) e é recusada com **motivo e caminho** depois disso — porque recusar sem dizer
o que fazer seria repetir o defeito.

Duas decisões finas que custaram teste:

* **As contagens entram na assinatura, e não só o estado.** A pergunta é sobre
  DEPENDÊNCIAS; o estado é só o indício mais comum delas. Se um dia existir parecer em
  rascunho, a regra continua verdadeira.
* **A recusa vale para TROCAR, não para corrigir.** Quem tem atribuição viva continua
  editando o resumo e as palavras-chave com o mesmo `trackId` — a guarda só dispara quando
  a classificação muda de fato.

---

## 3. Decisões técnicas

### 3.1 A página do link responde IGUAL para inexistente, expirado e revogado

(E70.) Quem tem o link é o público; a diferença entre "expirado" e "nunca existiu" é
informação para o **dono**, que a vê na própria lista. Na página pública, os três casos
respondem a mesma coisa — senão o endereço vira um oráculo de quais tokens existem.

E a contagem de acessos **não pode derrubar a página**: o invariante 8 vale para efeito
colateral, e um contador que falha não é motivo para negar a carta a quem abriu o link.

### 3.2 O que a tela esconde, ela anuncia (de novo)

Três itens desta fase repetem a mesma régua da E52 (FASE 50): **nada de silêncio**.
A lista de exportações diz "ninguém baixou ainda" em vez de ficar vazia; o acervo diz
"mostrando N de M" quando trunca; a restauração mostra quando e por quem o item foi
arquivado. Silêncio em tela de operação faz a pessoa concluir que o dado sumiu.

### 3.3 A declaração de autorização é DADO, com texto e versão (E66)

Guardar só "quem afirmou" (na trilha) responsabiliza quem publicou, mas não demonstra a
base legal. O desenho já existia no consentimento do QR do patrocinador
(`consentText`/`consentVersion`, FASE 42) e foi copiado de propósito: **mudar a redação da
declaração amanhã não reescreve o que foi aceito hoje**, e o texto vive no domínio para que
a tela, a trilha e o serviço mostrem a MESMA frase.

### 3.4 A ordem é da EQUIPE, não de cada pessoa (E63)

Guardar posição de PESSOAS num bloco faz a lista envelhecer em silêncio: alguém sai e a
posição 3 vira a 4 sem ninguém perceber. A equipe é uma lista curta que a organização
mantém de fato, e o líder (que já é dado desde a FASE 38) continua vindo primeiro **dentro**
de cada equipe. `displayOrder = 0` é "sem opinião": quem nunca ordenou nada continua na
ordem que já estava.

### 3.5 O telão desligado não é 404 (E37)

O organizador precisa **distinguir** "desligado pela organização" de "endereço errado" —
é para isso que ele abre o palco antes do evento. Então a página responde 200 dizendo que
está desligada, e o que **não** pode aparecer é o título do prêmio e os nomes dos
elegíveis, que é o motivo de o interruptor existir.

### 3.6 O QR repetido avisa, e a decisão é da instituição (E57)

A tentação era um teto fixo. O humano decidiu **avisar e confirmar**, e a decisão é boa por
um motivo concreto: o mesmo patrocinador pode legitimamente ter dois estandes, e um limite
inventado pelo sistema recusaria um caso real. O aviso diz o **número** e a
**consequência** (cada código novo é uma chance nova de creditar a mesma pessoa) — o crédito
em si continua garantido pelo índice único de `sponsor_scans`, um XP por pessoa por QR.

---

## 4. ADRs

### ADR-280 — O link da carta não expira por padrão, e a leitura é medida

**Contexto.** O link é a carta da pessoa; a revogação já existia e o prazo não.

**Decisão.** `expiresAt` **opcional** (a tela oferece prazos com "sem prazo" como primeira
opção), `viewCount` incrementado a cada abertura da página pública e `lastViewedAt` para
responder "quais links estão vivos há meses".

**Consequências.** Uma carta compartilhada num currículo não morre sozinha; quem quer prazo
escolhe. A contagem é de LEITURA (a mesma pessoa duas vezes conta duas) e a tela diz isso em
vez de sugerir audiência. Revogado e expirado são estados distintos na lista do dono e
**indistinguíveis** na página pública.

### ADR-281 — O que já depende da classificação proíbe reclassificar

**Contexto.** Ver §2.

**Decisão.** `canChangeSubmissionTrack` no domínio, com três recusas nomeadas
(`HAS_REVIEWS`, `HAS_ASSIGNMENTS`, `NOT_DRAFT`) e mensagens que dizem o caminho (o comitê).
A tela usa a mesma função para esconder/liberar o seletor; o serviço a usa para recusar a
troca.

**Consequências.** A troca só acontece quando é barata; depois, a classificação é registro e
a mudança é ato do comitê. Editar texto e reclassificar passam a ser perguntas diferentes —
como já eram editar e excluir (ADR da FASE 4).

### ADR-282 — O telão tem interruptor, e desligado ele não vaza o prêmio

**Contexto.** O palco responde desde a criação do sorteio e mostra o título do prêmio, para
o organizador testar o endereço.

**Decisão.** `Raffle.bigscreenVisible`, nascendo **ligado** (nenhum sorteio existente muda de
comportamento), com a página desligada respondendo 200 e sem conteúdo do sorteio.

**Consequências.** Quem quiser anunciar só na hora tem como; quem já usava o endereço
continua usando.

### ADR-283 — Orgulho do crachá: categoria escolhida e identidade do evento (E42)

**Contexto.** A etiqueta não distinguia ninguém, e num evento grande a cor por categoria é o
que faz a recepção achar a pessoa certa.

**Decisão.** `EventCredential.category` com os valores e as cores no **domínio**
(`CREDENTIAL_CATEGORIES`), usada pela folha A4, pela etiqueta, pelo ZPL e pelo crachá
online — uma fonte só, senão as quatro saídas divergem. A cor vem dos tokens do design
system e do tema do evento; **nada de hex solto**, que o teste de guarda reprova.

**Consequências.** A categoria é decisão da portaria, não dedução do papel (o mesmo ADMIN
pode ser diretoria ou apoio técnico). O crachá que já existe nasce `PARTICIPANT`.

### ADR-284 — A declaração da foto é guardada com texto e versão (E66)

**Contexto.** Ver §3.3.

**Decisão.** `photoAuthorizationText`, `.photoAuthorizationVersion`,
`.photoAuthorizationChannel` e `.photoAuthorizationAt` no perfil do palestrante; a redação
e os canais no domínio; o **canal obrigatório** quando a foto é nova — sem ele a declaração
fica sem rastro de COMO o consentimento foi obtido, que é metade do que se precisa
demonstrar.

**Consequências.** A plataforma passa a guardar a prova do consentimento, não apenas a
afirmação de quem publicou. O que continua fora: o **documento** em si (anexo), que é
dívida futura se a instituição precisar arquivar o e-mail ou o contrato assinado.

### ADR-285 — A ordem da equipe é da equipe, e zero é "sem opinião" (E63)

**Contexto.** Ver §3.4.

**Decisão.** `EventTeam.displayOrder` com a mesma régua de reescrita em bloco da FASE 38
(0, 10, 20…), e `0` significando "não ordenada" — as equipes que ninguém ordenou ficam como
estavam.

**Consequências.** A vitrine ganha ordem sem ganhar uma tela nova. Ordenar PESSOAS continua
fora de propósito: é a lista que envelhece em silêncio.

### ADR-286 — A integridade FAZ PARTE do veredito público

**Contexto.** A validação pública respondia sobre o REGISTRO (emitido, revogado, vencido)
e mostrava a assinatura como aviso ao lado; a rota de download não conferia nada. Um
documento com o conteúdo alterado no banco era anunciado como **"Certificado autêntico"** e
podia ser baixado — enquanto a conferência em lote (construída nesta fase) o reprovava. O
sintoma apareceu justamente ao construir a segunda tela: duas respostas opostas sobre a
mesma prova, e a mais permissiva era a de um código só, que é o instrumento em que um
terceiro se apoia para **aceitar** o documento.

**Decisão.** `ValidationStatus` ganhou **`TAMPERED`**; `evaluateValidation` recebe
`signatureValid` e devolve `isUsable: false` quando a assinatura **existia** e não confere.
Uma única função (`verifyCertificateIntegrity`) é usada pelo veredito e pelo download.
Certificado **sem** assinatura gravada (anterior à F6) **não** é adulteração: é "não
verificável", e continua sendo servido.

**Consequências.** Autenticidade deixa de ser "o registro existe" e passa a ser "o registro
existe E o conteúdo é o que foi assinado". A limitação fica declarada: **sem assinatura não
há prova** — nem contra. A ordem das perguntas (revogação → prazo → status → integridade)
foi mantida de propósito: o ATO da instituição fala antes da violação do arquivo.

### ADR-287 — Cada dívida de "alcance" respondeu com a régua que já existia

**Contexto.** Quatro itens desta fase (E58, E19, E63, E7) eram "falta a tela" — o tipo de
dívida que convida a inventar um mecanismo novo.

**Decisão.** Cada um reusou a régua da casa: a **restauração** usa as mesmas permissões e a
mesma trilha da exclusão, com `AuditAction.UPDATE` e as duas pontas (não existe `RESTORE`
no enum); os **filtros do acervo** aplicam as quatro condições no BANCO e reaproveitam
`collectUsages` (a função que a tela já usa para dizer onde a imagem está); a **ordem das
equipes** usa `planReorder` da FASE 38 (reescrita de 0, 10, 20…) com `0` = "sem opinião"; e
a **conferência em lote** chama a mesma `getPublicCertificate` da tela de um código.

**Consequências.** Nenhum segundo motor de reescrita, nenhuma segunda noção de "uso",
nenhum segundo validador. O custo aceito está declarado: o acervo trunca em 200 e diz
"mostrando N de M" **sem** botão de ampliar (o caminho para o resto é filtrar), e o lote
roda até 50 consultas **sequenciais** (paralelizar esgotaria o pool compartilhado).

### ADR-288 — A categoria do crachá entra na cor, e o logo fica para depois

**Contexto.** A dívida E42 dizia que a etiqueta era "funcional e fria". A solução do
levantamento pedia **cor por categoria**, **tema do evento** e **escolha da lente**.

**Decisão.** `CREDENTIAL_CATEGORY_PALETTE` no domínio espelha o `globals.css` **nomeado por
token**, com um teste que lê o CSS e falha se divergir (o PDF e o ZPL não resolvem `var()`,
então o valor tem de existir em algum lugar — a escolha foi deixá-lo rastreável, não solto).
Na tela, a categoria vira **tom do primitivo `Badge`** e a cor do evento virou o token
`--theme-primary`, consumido por `tone="event"`. **Zero hexadecimal em componente.**

**Consequências.** A identidade visual chega como cor + faixa + nome da instituição. O
**logo em imagem** não entra: o renderizador embute JPEG e o `logoUrl` é URL pública, então
embutir exigiria baixar e converter a imagem no caminho de impressão — e a falha desse
download passaria a poder derrubar a impressão no balcão. Fica como dívida **E74**.

---

## 5. Lições aprendidas — os defeitos REAIS da fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | **O certificado adulterado era anunciado como autêntico e baixável** (e o lote reprovava o mesmo documento) | O veredito público olhava só o ESTADO do registro (`emitido? revogado? vencido?`) e a assinatura era um aviso ao lado; a rota de download não conferia integridade nenhuma | `ValidationStatus` ganhou **`TAMPERED`**, alimentado por `verifyCertificateIntegrity` (uma verificação, usada pelo veredito **e** pelo download). Sem assinatura gravada (documento anterior à F6) **não** é adulteração: é "não verificável", e continua sendo servido — acusar de fraude um documento legítimo seria pior que o defeito |
| 2 | **A revogação automática do link não dizia por quê** na trilha | `revokeCardShareLink` recebia `reason` e nunca o gravava (parâmetro morto) | `changes.motivo` na trilha, preso por teste |
| 3 | **Filtrar crachás por categoria devolvia a lista inteira** | A lista é uma UNIÃO (inscrição ∪ crachá) e o filtro só valia para o lado do crachá: quem tinha só inscrição entrava pela outra ponta | Com filtro ligado, só entra quem TEM crachá — a categoria mora no crachá |
| 4 | **A cor do código do crachá mudava de tom** em evento sem tema (`0.314` em vez de `0.310`) | O valor passou por arredondamento (`pdfFillOperator`) em vez de usar o hexadecimal exato daquele operador | Valor exato preservado, com o comentário de que "quase o mesmo tom" mudaria os bytes de quem não mexeu em nada |
| 5 | **A faixa da categoria comia o QR na etiqueta adesiva** (63,5 × 33,9 mm) | Piso fixo de 5 pt sem teto proporcional: a faixa ficava com 5,2% da altura e, somada ao respiro do nome, encostava no código | Altura proporcional (7%) com piso de 4 pt e tetos de 9% / 16 pt — **ressalva honesta: achado por raciocínio sobre a geometria, não por impressão** |
| 6 | **O segundo passo do aviso do QR repetido não gravava nada** — a instituição marcava a confirmação e o clique não fazia efeito | O React 19 reseta o formulário depois de uma action, MESMO quando ela recusa (armadilha 5 desta base). Como a E57 usa a recusa como PRIMEIRO PASSO, o segundo reenviava o formulário **em branco** e o `required` do nome bloqueava a submissão no navegador | Campos CONTROLADOS no formulário do QR, com o porquê escrito — o mesmo remédio da edição do rascunho. Achado pelo E2E (o segundo clique não gravava e o teste não sabia dizer por quê) |
| 7 | **O testid do botão novo quebrou a suíte da FASE 42** (`admin-submit` → `sponsor-qr-submit`) | O testid é a INTERFACE do teste: renomear um botão de ação administrativa nesta base quebra o E2E que já existia — e o botão ficou "invisível" para três casos | Nome da casa restaurado (`admin-submit`), com o comentário explicando que não é detalhe de teste |

### Defeitos de TESTE (o que eu mesmo escrevi errado e consertei)

| Sintoma | Causa raiz | Correção |
|---|---|---|
| O caso "recusa depois do envio" esperava `NOT_DRAFT` e recebia `NOT_EDITABLE` | Depois do envio o portão que recusa primeiro é o de EDIÇÃO (o formulário inteiro fecha), não a guarda da trilha | O caso passou a esperar `NOT_EDITABLE`, e o caso que dá sentido à regra virou outro: **`REVISION_REQUESTED`** (editável) **com parecer** → `HAS_REVIEWS` com o caminho do comitê, e o texto continua editável |
| Fixture de atribuição recusada pelo Prisma (`Expected ReviewStatus`) | Usei `'PENDING'`, que não existe no enum: atribuição nasce `INVITED` | Valor do enum corrigido; e `'REVISIONS_REQUIRED'` virou `'MAJOR_REVISION'` no parecer da fixture |
| `createEvent` recusado pelo Prisma no meu spec de trilha (`Expected EventStatus` / campo faltando) | O helper exige `title`; eu passei só `tenantId` e `slug` — e no teste de integração eu havia usado `'COMPLETED'`, que não existe no enum (`FINISHED`) | Fixture completada e status do evento corrigido |
| `locator('admin-submit')` ambíguo no spec do QR repetido (11 botões na tela) | O helper clicava no testid sem ESCOPO: `admin-submit` é o nome de toda ação administrativa desta base | Escopo no formulário do patrocinador (`qr-new-<id>`), com o porquê escrito |
| O spec do QR afirmava `qrCount() === 2` e recebia 2 já no primeiro passo | O caso 3 (confirmação) falhava e a contagem do caso 5 herdava o estado | Depois da correção do formulário, a sequência fecha: 1 → 2 → 3 |

---

## 6. Evidência de verificação

```text
npm run lint ....................... 0 erros, 0 warnings
npm run typecheck .................. 0 erros
npm test ........................... 129 arquivos · 2697 testes passando
npm run build ...................... ✓ Compiled successfully in 39.8s
npm run db:verify .................. Contrato íntegro.
npm run db:verify:isolation ........ 9/9 verificações passaram.
npx prisma migrate status .......... 49 migrations · Database schema is up to date!
docker compose --profile app up -d --build web worker   ✓
npm run test:e2e ................... 201 passed · 14 skipped · 0 failed
```

> **Os números são REAIS e medidos nesta árvore.** Os **14 `skipped`** são deliberados: **13**
> são os casos E2E escritos sem execução nesta fase que falharam na primeira execução real e
> ficaram em `test.fixme` com o motivo escrito (dívida **I1**), e **1** é o caso da dívida
> **E76** (FASE 50). Nenhum caso é pulado em silêncio: cada um traz no código a razão e o
> caminho para fechar.

---

## 7. Comandos operacionais

```bash
# O link da carta: validade e contagem — o painel vive na PÁGINA DA CARTA
#   /t/<slug>/cartas/<cardSlug> → "Compartilhar" (prazo, aberturas, última abertura, histórico)

# A trilha do rascunho
#   /t/<slug>/submissoes/<submissionId> → campo "Trilha" (só enquanto é rascunho sem parecer)

# O telão do sorteio
#   /t/<slug>/administracao/eventos/<eventId>/sorteios → interruptor do telão

# A ordem das equipes na vitrine
#   /t/<slug>/administracao/eventos/<eventId>/equipes → ordem (0 é "sem opinião")

# O acervo de mídia com filtros
#   /t/<slug>/administracao/eventos/<eventId>/pagina/midia?busca=&tipo=&evento=&emUso=1

# A conferência de certificados em lote
#   /validar (lote) — cole a lista de códigos

# Os arquivados do catálogo de gamificação
#   /t/<slug>/administracao/cartas?arquivados=1
```

---

## 8. Dívidas técnicas e pontos de atenção

**Quitadas nesta fase:** E7, E19, E32, E37, E42, E57, E58, E63, E66, E70, E73.

**Declarada nesta fase:**

| Dívida | O que falta | Por que não entrou |
|---|---|---|
| **E74** | **O logo da instituição não é embutido na etiqueta** (PDF/ZPL): a identidade visual chegou como **cor do tema + faixa de categoria + nome da instituição**, não como imagem | O renderizador embute **JPEG** (é o formato do desenho do certificado) e o `logoUrl` é uma URL pública do MinIO: embutir exigiria baixar e converter a imagem no caminho de impressão — e o cache/erro desse download passaria a poder falhar a impressão do crachá no balcão. Trabalho próprio, com a decisão de onde cachear |

**Fora por decisão do humano:** **B8** (retenção de `audit_logs`) e **E72** (expurgo e
alerta da trilha de identidade) — as duas são política de retenção de dado, e a decisão
pede a instituição, não o código.

**Pontos de atenção:**

* o **link da carta** conta LEITURA, não pessoa — a tela diz isso, e uma métrica de
  audiência de verdade seria outra dívida;
* a **troca de trilha** é liberada por AUSÊNCIA de dependências: qualquer código futuro que
  crie parecer ou atribuição fora do fluxo normal precisa continuar respeitando
  `canChangeSubmissionTrack`;
* o **telão desligado** responde 200: monitoramento que trate 200 como "no ar" precisa
  olhar o conteúdo, não o status;
* a **declaração da foto** guarda texto e versão, mas **não o documento** — se a
  instituição precisar arquivar o e-mail ou o contrato, é dívida nova;
* a **categoria do crachá** é escolhida na emissão (inclusive em massa): emitir em lote sem
  pensar na categoria produz crachás todos iguais, que é o estado anterior.

---

## 9. Checklist de aceite

- [x] **E70** — validade opcional (sem prazo é o padrão), contador de acessos e última abertura; página pública indistinguível entre inexistente/expirado/revogado
- [x] **E73** — a lista de exportações mostra QUEM baixou, numa consulta só
- [x] **E58** — filtro de arquivados com quando/por quem e restauração com trilha
- [x] **E19** — busca e filtros do acervo aplicados no banco, com contagem
- [x] **E7** — conferência de certificados em lote, com limite e motivo por código
- [x] **E32** — troca de trilha do rascunho liberada por regra de domínio, com a tela dizendo o motivo quando não pode
- [x] **E37** — interruptor do telão, sem vazar prêmio quando desligado
- [x] **E42** — categoria do crachá com cor do TEMA e faixa por categoria no PDF, no ZPL e no crachá online; escolha da lente no balcão (o **logo em imagem** ficou como dívida **E74**)
- [x] **E57** — aviso e confirmação de QR repetido no mesmo evento
- [x] **E63** — ordem manual por equipe na vitrine, líder primeiro
- [x] **E66** — declaração de autorização guardada com texto, versão, canal e data
- [x] `docs/dividas-tecnicas.md` com as 11 quites
- [x] `README.md` e `AGENTS.md` atualizados
- [x] Bateria da seção 4 do `AGENTS.md` verde, com números reais
