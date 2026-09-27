# FASE 48 — Carta colecionável premium: palco 3D, holografia e compartilhamento

> **Tema escolhido pelo humano**, com referência visual (cartas holográficas com
> "arraste para explorar 360°") e o pedido: *"ter uma opção do participante compartilhar
> nas redes sociais, para ele poder mostrar"*.
>
> O escopo foi fechado com quatro decisões do humano antes do código: **palco 3D na
> página da carta + inclinação leve no álbum**, **verso com a ficha da conquista e arte
> opcional da instituição**, **link público por carta com token revogável — sem exigir
> perfil público**, e **imagem de prévia com arte, nome, raridade e instituição gerada
> no servidor**.

---

## 1. Sumário executivo

### 1.1 O que entrou

| # | Entrega | Onde |
|---|---|---|
| 1 | **Palco 3D da carta**: arrastar gira, brilho holográfico que segue o ponteiro, partículas, **Virar**, **Reiniciar** e **Luz e brilho** | `src/components/gamification/holo-card.tsx` |
| 2 | **Geometria no domínio**: `resolveCardStage` e `tiltFromPointer` (funções puras, o mesmo cálculo no navegador e no teste) | `src/domain/gamification/card-presentation.ts` |
| 3 | **Verso com a ficha da conquista** (gatilho, data no fuso da instituição, variante, cópias) + **arte de verso opcional** da instituição | `card-presentation.ts` · `card-visual.tsx` (medidas) |
| 4 | **Apresentação é DADO**: `holo`, `sheen`, `tilt`, `backUrl` no JSON `art`, validados campo a campo — **sem migração de dado** | `src/domain/gamification/card-rules.ts` |
| 5 | **Opt-in da instituição** no catálogo: brilho, intensidade, inclinação, arte do verso e **prévia com o efeito real** | `administracao/cartas/page.tsx` · `saveCardTemplateAction` |
| 6 | **Página da carta** (`/t/<slug>/cartas/<slug>`) com palco, ficha em texto, destaque e compartilhamento | `(app)/cartas/[cardSlug]/page.tsx` |
| 7 | **Link público POR CARTA**, com token **selado** (AES-256-GCM) e índice por hash, revogável | `src/lib/gamification/card-share-service.ts` · `card-share-token.ts` |
| 8 | **Página pública** `/t/<slug>/carta/<token>`: só a carta, com o nome pela régua da FASE 44 | `(public)/carta/[token]/page.tsx` |
| 9 | **Imagem de prévia** desenhada no servidor (`next/og`) — o link aparece com a carta no WhatsApp/X | `(public)/carta/[token]/opengraph-image.tsx` |
| 10 | **Compartilhar** para WhatsApp, X, LinkedIn, Telegram e e-mail, com **copiar link**, **revogar** e o aviso do que o link mostra | `src/components/gamification/share-card-panel.tsx` |
| 11 | **Correção de um defeito real do balcão**: a corrida da SEGUNDA visita criava duas sessões (índice único parcial + tratamento da violação) | `src/lib/events/credential-service.ts` · migração `20260928120000_open_session_unique` |

### 1.2 Números da fase

| | |
|---|---|
| Arquivos novos | **15** — 9 de código, 2 migrações, 3 de teste e 1 documento (este) |
| Arquivos modificados | **11** de código/configuração e **1** de teste, mais **4** de documentação (`README.md`, `AGENTS.md`, `docs/dividas-tecnicas.md`, `docs/armadilhas.md`) |
| Migrações | **43 → 45** (`card_share_links`, `open_session_unique`) |
| Testes novos | **51** — 33 unitários, 15 de integração e **3 E2E** |
| Suíte | **108 arquivos · 2399 testes** (de 2351) · E2E **162** (de 159) |
| ADRs | **260 a 266** (a próxima é a 267) |
| Permissões / tabelas de tenant | **66** (inalterada) · **55 → 56** |
| Templates de e-mail | **22** (inalterados) |
| Defeitos reais encontrados | **4** (1 de produto alheio à fase, 2 de produto desta fase, 1 de teste) — seção 5 |
| Dívidas declaradas | **E69**, **E70** e **E71** |

---

## 2. O problema mais difícil da fase

**Compartilhar exige um endereço público — e o perfil público deste projeto nasce
FECHADO.**

A FASE 44 entregou o perfil público com quinze campos de visibilidade e uma decisão
explícita (ADR-139): **nada nasce exposto**. As "cartas em destaque" são um campo como
os outros, e destaque é uma exposição PERMANENTE. O pedido, porém, é outro: mostrar UMA
carta num grupo de WhatsApp — e uma pessoa pode perfeitamente querer mostrar a carta
Lendária que ganhou sem abrir o álbum, o XP, os eventos que participou e o próprio nome.

Três caminhos foram considerados:

1. **Reaproveitar o perfil público** ("compartilhe suas cartas em destaque"). Descartado:
   exigiria publicar o perfil inteiro para mostrar uma carta, e o link do grupo levaria a
   pessoa para uma página com muito mais informação do que a carta.
2. **Guardar só o HASH do token** (o padrão do convite do palestrante, ADR-114). Descartado
   por um detalhe de uso: o convite chega por e-mail e aparece UMA vez; **o link é do dono**,
   e ele precisa poder copiá-lo de novo amanhã. Com hash, a única saída seria regerar — e
   regerar invalida o endereço que já está no grupo.
3. **Guardar o token em CLARO** (como o `badgeToken` do crachá). Descartado pelo outro
   extremo: o crachá é impresso em papel e o segredo já circula fisicamente; o link não.
   Em claro, qualquer leitura do banco (relatório, suporte, despejo) vira uma lista de
   links prontos para abrir a coleção de alguém.

A resposta está no meio e já tinha precedente no projeto: **o token vive em duas formas**.
O **SHA-256** indexa a leitura pública (achar a linha não exige decifrar nada) e o
**selo AES-256-GCM** permite ao dono reexibir o endereço — com a chave derivada de
`BETTER_AUTH_SECRET` por um rótulo próprio, como o cofre da semente do sorteio (FASE 16).
Um vazamento do banco, sozinho, não abre link nenhum.

O segundo problema difícil é o que a fase NÃO podia quebrar: **o efeito precisa ser
enfeite**. Sem JavaScript, a coleção continua sendo HTML — a carta estática e a ficha em
texto estão na página; com `prefers-reduced-motion`, o giro e as partículas desligam e
**virar continua funcionando** (é troca de conteúdo, não movimento). E a geometria do
movimento mora no domínio, porque "para onde a carta vai quando o ponteiro está ali?" é
pergunta com resposta certa — e resposta certa se prende em teste.

---

## 3. Decisões técnicas

### 3.1 A apresentação premium é dado, no MESMO JSON da arte

`holo`, `sheen`, `tilt` e `backUrl` entraram no `art` (JSON) em vez de virar colunas: a
carta é item de coleção, e o que a instituição escolhe é como ela aparece. A validação
continua **campo a campo** (`readField`), então um `sheen: 900` digitado por engano é
DESCARTADO (cai no padrão 60) sem derrubar a paleta, a arte e o resto. **Carta gravada
antes desta fase não tem as chaves e aparece exatamente como era** — sem migração de dado
e sem `UPDATE` em massa.

### 3.2 A variante foil acende o brilho sozinha; a raridade não mexe na intensidade

Desde a FASE 5, foil É a "variante holográfica". Exigir um segundo interruptor para a
carta que já é holográfica seria pedir confirmação do óbvio — e as cartas foil concedidas
antes desta fase apareceriam sem efeito. Já a raridade **não** entra na conta: ela governa
anel, brilho e cor há três fases, e somar "quanto de holografia" ao mesmo eixo faria uma
mítica com `sheen: 0` brilhar mais que uma lendária com `sheen: 100`, tirando da
instituição o controle que ela acabou de receber.

### 3.3 A luz da carta sai da paleta DELA, não de um arco-íris fixo

O brilho é um foco branco que segue o ponteiro somado a uma faixa construída com
`--card-glow` e `color-mix`, em `mix-blend-mode: screen`. Um arco-íris fixo brigaria com o
tema da instituição (que é escolhido por ela, FASE 17) e com os tokens de raridade do
projeto. O CSS mora no `globals.css` — onde os valores da identidade vivem e onde o teste
de design permite valor literal —, e o componente só escreve **variáveis** (`--card-*`,
`--ef-holo-*`), como já fazia o `CardVisual`.

### 3.4 O palco é o MESMO componente em dois pesos

`HoloCard` tem duas variantes: `hover` (álbum e catálogo — inclina, sem arrastar, sem
virar, sem controles) e `stage` (página da carta — arrastar, virar, reiniciar, luz). Numa
grade de trinta cartas, trinta palcos interativos seriam trinta animações disputando a
GPU; na página da carta, o palco é o assunto. O desenho da FRENTE é o mesmo componente do
resto do sistema (`CardVisual`): a face não foi reescrita, e as medidas saem de
`CARD_DIMENSIONS` para que a carta não mude de tamanho ao virar.

### 3.5 O verso é a ficha da conquista — e a MESMA ficha aparece em texto

`cardBackContent` monta o verso (rótulos do domínio, data no fuso da instituição, cópias
só quando existem) e a página renderiza a MESMA estrutura num `<dl>`. Duas montagens
divergiriam no primeiro ajuste de rótulo — e a que divergiria é a que a pessoa lê sem
JavaScript, com leitor de tela ou com movimento reduzido.

### 3.6 O nome no link segue a régua da FASE 44, em vez de uma nova

A página da carta é lida por visitante **anônimo**, então é essa a régua aplicada
(`visibleProfileFields({ viewer: 'ANONYMOUS' })`): nome publicado aparece; nome privado vira
`@handle` — exatamente como a FASE 44 promete na própria tela ("Privado, a página mostra só
o seu @handle"). Quem não tem handle e não publica o nome aparece como *"Uma pessoa desta
instituição"*: inventar o nome de cadastro seria publicar justamente o que a pessoa
escondeu. A página da carta **não linka o perfil** — o endereço do perfil é uma escolha
separada, e o link da carta não é atalho para ela.

### 3.7 A leitura pública não usa a conexão de plataforma

O caminho óbvio para achar um token global seria `adminPrisma`. Não foi usado: a
instituição vem do **slug da URL**, então a consulta roda sob `withTenant` e a RLS é quem
garante o isolamento — token de outra instituição simplesmente **não é encontrado**
(fail-closed, verificado nos testes). É a mesma decisão tomada na FASE 48 para a tabela
nova, que nasce como tabela de instituição com RLS + FORCE.

### 3.8 A imagem da prévia é DESENHADA, não fotografada

A prévia é vetor (`next/og`): fundo com a paleta da carta, os anéis concêntricos, o nome, a
raridade, o nome público e a instituição — com a arte do template ao fundo quando ela
existe. Gerar a partir do HTML exigiria um navegador no servidor; a partir da arte, uma
busca de rede a cada raspagem (e a falha silenciosa cairia na prévia de quem compartilhou).
A fonte é a que o `next/og` já embute (Geist): arrastar um arquivo de fonte para o
repositório só para isso seria peso em todo deploy por um detalhe que ninguém compara lado
a lado com a interface. Nenhum hex literal entrou em `src/app`: as cores são as da carta
(vindas do domínio) e neutras em `rgb()`.

---

## 4. ADRs

### ADR-260 — A apresentação premium da carta é DADO no JSON da arte

**Contexto.** O efeito holográfico e a inclinação poderiam ser colunas novas
(`holo Boolean`, `sheen Int`…) ou campos do JSON `art` que já guarda imagem, moldura,
animação, partícula e foil.

**Decisão.** Campos no JSON, validados campo a campo por `resolveArt`, com padrões
(`holo: false`, `sheen: 60`, `tilt: 50`, `backUrl: null`).

**Justificativa.** É a mesma natureza dos campos existentes (apresentação), não há
consulta por eles, e a alternativa exigiria migração de dado + backfill para uma escolha
visual. Carta antiga continua idêntica sem `UPDATE` em massa.

**Consequências.** Não é possível consultar "todas as cartas com brilho ligado" por SQL
direto (é JSON); a tela do catálogo resolve isso lendo o catálogo inteiro, que é o que ela
já faz.

### ADR-261 — O efeito é enfeite: sem JavaScript e com movimento reduzido o conteúdo continua

**Contexto.** Carta que só existe depois da hidratação, ou giro que não desliga, quebra a
coleção de quem tem conexão ruim, leitor de tela ou sensibilidade a movimento.

**Decisão.** O `HoloCard` é renderizado no servidor como qualquer componente (a carta
estática está no HTML); `prefers-reduced-motion` desliga inclinação e partículas, mantendo
virar/reiniciar; teclado faz tudo o que o ponteiro faz (setas inclinam, Enter/V vira, R
reinicia); a ficha aparece em `<dl>` fora do palco; `touch-action: none` só durante o
arrasto.

**Justificativa.** O invariante do produto é que documento e coleção não dependem de
apresentação. O E2E prova o caminho sem JavaScript, como já faz o quadro de demandas
(dívida E50).

**Consequências.** O componente é maior do que um efeito puramente visual, e a ficha
aparece duas vezes na página (no verso e em texto) — de propósito.

### ADR-262 — Foil acende o brilho sozinho; a raridade não influencia a intensidade

**Contexto.** Duas tentações: exigir o interruptor também para foil, e escalar o brilho
pela raridade.

**Decisão.** `holo = art.holo || isFoil`, com bônus de 25 na intensidade para foil (teto
100); a raridade não entra no cálculo.

**Justificativa.** Foil É a variante holográfica desde a FASE 5, e cartas foil concedidas
antes desta fase precisam aparecer com efeito. A raridade já governa anel/brilho/cor; um
segundo eixo tiraria da instituição o controle recém-criado.

**Consequências.** Uma carta comum em foil brilha mais que a mesma carta normal — que é o
significado de "variante".

### ADR-263 — O link é POR CARTA, com token selado (nem hash, nem claro)

**Contexto.** Ver seção 2. O perfil público nasce fechado; o convite hasheado aparece uma
vez só; o crachá em claro circula em papel.

**Decisão.** Tabela `card_share_links` (RLS + FORCE), com `tokenHash` (SHA-256, índice da
leitura pública) e `tokenSealed` (AES-256-GCM com chave derivada de `BETTER_AUTH_SECRET`
por rótulo próprio). Revogação por `revokedAt`, com a linha preservada como histórico.
Compartilhar é **idempotente**: clicar de novo devolve o MESMO endereço.

**Justificativa.** O dono precisa reexibir o link (hash não permite) e o banco sozinho não
pode abrir a coleção de ninguém (claro não permite). A idempotência evita invalidar em
silêncio um endereço já publicado — trocar o endereço é um ato (revogar).

**Consequências.** O segredo da aplicação passa a ser necessário para criar links; sem ele
(aplicando `SEAL_UNAVAILABLE`) a criação é recusada com o motivo na tela, em vez de gravar
em claro. Segredo girado: o link antigo continua abrindo (a leitura só usa o hash), mas o
dono não o reexibe — revogar e criar outro é o caminho, e o teste cobre o estado.

### ADR-264 — A página pública mostra SÓ a carta, e o nome segue a régua da FASE 44

**Contexto.** Um link que circula em grupo é a superfície mais exposta do sistema, e a
pessoa que o cria não vê a página antes de enviar.

**Decisão.** `readSharedCard` devolve um objeto FECHADO (carta, paleta, arte, palco, ficha,
nome público, foto só se o campo estiver público, data de criação do link). O nome sai por
`visibleProfileFields({ viewer: 'ANONYMOUS' })` + `resolvePublicDisplayName`; sem nome
público e sem handle, um rótulo neutro. A página não linka o perfil, e a tela de
compartilhamento **avisa antes** o que o link vai mostrar.

**Justificativa.** O que não está na assinatura da função não tem como escapar para a
tela — o teste de integração compara as CHAVES do retorno, e o E2E procura o e-mail e o
caminho `/u/` no HTML público. Distinguir "não existe" de "existe e é de outra
instituição" também conta informação: tudo responde 404.

**Consequências.** Uma pessoa sem handle e com nome privado compartilha uma carta sem
identidade — declarado na tela, e preferível a publicar o que ela escondeu.

### ADR-265 — A imagem da prévia é vetorial, gerada no servidor

**Contexto.** Link sem imagem vira tarja cinza; e o servidor não tem navegador nem fonte
própria.

**Decisão.** Rota `opengraph-image` com `next/og`: carta desenhada (gradiente da paleta,
anéis, losango), fatos em texto e a arte do template ao fundo quando existe.

**Justificativa.** Sem dependência nova, sem arquivo de fonte no repositório, e o desenho
não depende de a arte estar alcançável (se estiver, entra; se não, a carta ainda aparece).

**Consequências.** A fonte da prévia (Geist, embutida) difere da interface (Inter/Jakarta) —
aceito conscientemente. O satori exige `display: flex` em `<div>` com mais de um filho: o
texto "Conquistada por {nome}" são dois nós, e sem isso a rota responde 500 (defeito real
da fase, seção 5).

### ADR-266 — A corrida do balcão é decidida pelo banco (defeito anterior, corrigido aqui)

**Contexto.** A bateria da fase fez falhar, de forma intermitente, o teste que exige UMA
sessão para dois leitores do mesmo crachá (FASE 31). Reprodução dirigida: **1 em 5
execuções** produzia `['CHECKED_IN','CHECKED_IN']` e **duas sessões abertas**.

**Causa raiz.** O caminho da PRIMEIRA visita é seguro (o `updateMany` condicional do
credenciamento decide). O caminho da SEGUNDA visita — e o de quem não tem inscrição —
**lia antes de inserir**: dois leitores liam "não há sessão aberta" e inseriam os dois. É a
violação do invariante nº 5 ("concorrência é decidida no banco"), e o efeito no produto é
frequência contada em dobro.

**Decisão.** Dois índices **únicos parciais** — `(tenantId, activityId, userId)` e
`(tenantId, eventId, userId)` para a portaria, ambos `WHERE "checkedOutAt" IS NULL` — e o
`catch` da violação FORA da transação (armadilha 97), respondendo o mesmo que o caminho
"já está dentro", com a sessão que o vencedor abriu.

**Justificativa.** Sessões FECHADAS repetidas são o funcionamento normal (as visitas do
dia), então o índice precisa ser parcial. Conferido antes de aplicar: nenhuma linha
existente violava os índices.

**Consequências.** O teste que antes era flaky virou determinístico, e ganhou um irmão que
monta a fixture da segunda visita por conta própria (o anterior dependia da ordem dos
testes). A dívida **E71** registra que a fixture compartilhada do arquivo continua
impedindo rodar um teste isolado com `-t`.

---

## 5. Lições aprendidas — defeitos REAIS

| # | Defeito | Sintoma | Causa raiz | Correção |
|---|---|---|---|---|
| 1 | **A corrida do balcão criava duas sessões** (código da FASE 31/35) | O teste "dois leitores do mesmo crachá produzem UMA sessão" falhou na bateria completa (`['CHECKED_IN','CHECKED_IN']`); reprodução dirigida: 1 em 5 execuções, **2 linhas abertas** | O caminho da segunda visita **lia antes de inserir** — sem índice único parcial e sem `UPDATE` condicional, dois leitores simultâneos não competiam por nada | Índices únicos parciais + tratamento da violação como "já está dentro" (ADR-266) + teste determinístico da segunda visita |
| 2 | **O painel mostrava o link REVOGADO como se estivesse vivo** | O E2E revogava, a mensagem "Link revogado" aparecia — e o endereço continuava na tela, pronto para ser copiado | Os dois `useActionState` são independentes: `created.data.url` continuava preenchido depois da revogação, e a leitura do painel consultava a criação primeiro | A revogação passou a ter precedência sobre o resultado antigo da criação |
| 3 | **A imagem de prévia respondia 500 e o link nascia sem imagem** | `socket hang up` ao baixar o `og:image`; no log do container: *"Expected `<div>` to have explicit display: flex … if it has more than one child node"* | O texto "Conquistada por {nome}" são DOIS nós filhos dentro de um `<div>` sem `display` explícito — restrição do satori | `<div display: flex>` com dois `<span>`, e o comentário registra a restrição no ponto |
| 4 | **O `select` aninhado do Prisma não era conferido pelo `tsc`** | `Unknown argument 'username'` só apareceu ao rodar o teste de integração — o `typecheck` passou | `SHARE_NAME_SELECT` é um objeto comum espalhado (`{...SHARE_NAME_SELECT}`) dentro do select aninhado: o tipo largou os literais e o Prisma aceitou qualquer chave | Campo correto (`publicHandle`) e o teste de integração como a rede que pega isso — o `tsc` não pega |

**Defeitos de teste:**

| # | Defeito | Sintoma | Causa raiz | Correção |
|---|---|---|---|---|
| 5 | **`expect(...).toBeDisabled()` "provava" a revogação antes de ela acontecer** | O teste seguia para checar o link e recebia 200 | O botão nasce desabilitado enquanto a Server Action está em voo; a asserção passava no estado pendente | Esperar o painel voltar ao estado "criar link" e consultar o endereço público com `expect.poll` |
| 6 | **`-0` no giro da carta** | Teste unitário reprovou `rotateX(-0deg)` | `Math.round(-0.001 * 100) / 100` devolve `-0`, e `Object.is(-0, 0)` é falso | `round2` normaliza zero — e o comentário explica por que o valor importa |

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 108 arquivos · 2399 testes passando
npm run build ..................... ✓ Compiled successfully
                                     rotas novas: /t/[tenantSlug]/cartas/[cardSlug]
                                                  /t/[tenantSlug]/carta/[token]
                                                  /t/[tenantSlug]/carta/[token]/opengraph-image
npm run db:verify ................. Contrato íntegro. (card_share_links sob RLS + FORCE)
npm run db:verify:isolation ....... 9/9 verificações passaram.
npx prisma migrate status ......... 45 migrations · Database schema is up to date!
docker compose --profile app up -d --build web worker   ✓ (imagem reconstruída)
npm run test:e2e .................. 162 passed
npx playwright test tests/e2e/card-premium.spec.ts → 3 passed:
                                     (1) o álbum inclina, a carta gira (giro medido na
                                         variável CSS), o verso mostra a ficha, o link abre
                                         deslogado mostrando só a carta, o og:image responde
                                         PNG e revogar devolve 404;
                                     (2) SEM JavaScript a carta e a ficha continuam na página
                                         e o link é criado por POST de formulário;
                                     (3) nome privado vira @handle e o nome de cadastro não vaza
```

### 6.1 O que os testes unitários provam (33)

A arte antiga continua idêntica; percentual fora de 0–100 é descartado (não recortado) e um
campo ruim não derruba os outros; a arte do verso passa pela mesma allowlist de protocolo;
foil acende o brilho e soma o bônus sem passar de 100; a raridade não muda a intensidade;
`tilt: 0` para o palco; o centro não inclina e o brilho fica no meio; o lado sob o ponteiro
recua; ponteiro fora da caixa é preso à borda; caixa sem medida devolve a carta parada (e
nunca `NaN`); o verso traz os fatos, a data no fuso da instituição e "—" quando não há
carimbo; cópias só aparecem quando existem; o texto do compartilhamento leva nome, carta,
raridade e instituição — e mais nada; todo canal monta intenção com texto e link; o
LinkedIn não promete texto; o token aceito é só o base64url que o serviço gera.

### 6.2 O que os testes de integração provam (15)

O token não é gravado em claro e o selo devolve o mesmo endereço; compartilhar duas vezes
devolve o MESMO link (uma linha no banco); carta de outra pessoa não gera link; a criação
entra na trilha sem o token; a leitura pública traz a ficha, a paleta e o palco resolvidos;
**o retorno tem exatamente as chaves esperadas** (nem XP, nem álbum, nem e-mail); token
inventado não acha nada; **token de outra instituição não é encontrado pela RLS**; nome
privado sai como `@handle`; sem handle, rótulo neutro; revogar corta na hora e preserva a
linha; depois de revogar, compartilhar de novo cria endereço NOVO e o antigo morre; não se
revoga link alheio; o dono lê o endereço pronto para copiar. Mais o teste determinístico da
**corrida da segunda visita** no arquivo do credenciamento (30 testes no arquivo).

---

## 7. Comandos operacionais

```bash
# A coleção do participante
# /t/<slug>/cartas .................... álbum (inclinação ao passar o ponteiro)
# /t/<slug>/cartas/<slug> ............. a carta: palco 3D, ficha, destaque e link
# /t/<slug>/carta/<token> ............. página pública (sem sessão)

# Ligar o efeito numa carta (catálogo da instituição)
# /t/<slug>/administracao/cartas → Editar carta
#   "Brilho holográfico ligado" · "Brilho holográfico (0–100)" ·
#   "Inclinação 3D (0–100)" · "URL da arte do verso"
#   (a prévia do catálogo já mostra o efeito)

# Links criados, selados e revogados
psql "$DATABASE_URL" -c 'SELECT "userCardId", "createdAt", "revokedAt",
  (length("tokenSealed") > 0) AS selado,
  (length("tokenHash") = 64)  AS indexado
  FROM card_share_links ORDER BY "createdAt" DESC LIMIT 10'

# Nada em claro: o token NÃO aparece em nenhuma coluna
psql "$DATABASE_URL" -c "SELECT count(*) FROM card_share_links WHERE \"tokenSealed\" LIKE '%carta%'"

# A prévia que o link anuncia (o que a rede social baixa)
curl -sI "http://localhost:3000/t/<slug>/carta/<token>/opengraph-image" | grep -i content-type

# Sessões abertas por pessoa e atividade (o índice que fechou a corrida)
psql "$DATABASE_URL" -c 'SELECT "tenantId", "activityId", "userId", count(*)
  FROM attendances WHERE "checkedOutAt" IS NULL AND "activityId" IS NOT NULL
  GROUP BY 1,2,3 HAVING count(*) > 1'
```

---

## 8. Dívidas técnicas e pontos de atenção

### 8.1 Declaradas nesta fase

| Código | Dívida |
|---|---|
| **E69** | **A arte da carta entra por URL, não pelo acervo.** Frente e verso são endereços http(s) validados — como a frente é desde a FASE 5. Uma imagem externa colada ali não passa pela conversão WebP da FASE 46 nem entra em `media_assets`, então não conta quota nem é reaproveitada por checksum. Levar a arte da carta para a esteira do acervo exige um alvo sem evento (a carta pode ser da instituição, não de um evento), o que a esteira de hoje não cobre. |
| **E70** | **O link compartilhado não expira nem é medido.** Há revogação (imediata) e histórico, mas não há prazo de validade, limite de aberturas nem contagem de acessos — a instituição não consegue responder "quantas vezes esta carta foi vista?" nem "quais links estão vivos há meses". Um `expiresAt` opcional e um contador de leituras são o caminho. |
| **E71** | **A suíte de credenciamento depende da ORDEM dos testes.** A fixture é compartilhada entre os `describe` do arquivo: rodar um teste isolado com `-t` falha porque a pessoa/inscrição que ele usa foi montada por um teste anterior (aconteceu ao investigar o defeito nº 1). O teste novo da segunda visita monta a própria fixture; os antigos, não. |

### 8.2 Pontos de atenção

* **O link mostra a carta, não o perfil.** Quem quiser mostrar a coleção inteira continua
  dependendo do perfil público (FASE 44) — e o link da carta deliberadamente não é atalho
  para ele.
* **A imagem de prévia não carrega a FOTO da pessoa**, só o nome público: a foto depende do
  campo `avatar` estar público, e a prévia é buscada por rastreador, sem sessão. É
  conservador de propósito.
* **A prévia usa a fonte embutida do `next/og` (Geist)**, e não a da interface (Inter/
  Plus Jakarta). Decisão registrada na ADR-265: a alternativa seria versionar um arquivo de
  fonte no repositório.
* **O giro é `rotateX`/`rotateY` sobre a arte** — não há 360° real com verso desenhado por
  ângulo, nem vídeo. "Explorar 360°" aqui significa girar a carta em dois eixos com o verso
  aparecendo no `Virar`.
* **`sheen` e `tilt` valem por carta, não por raridade.** Ligar a holografia em todas as
  cartas é uma edição por carta no catálogo; um "ligar em todas" seria uma tela de lote
  (não pedida).
* **O `-0` do giro** foi normalizado no domínio; o componente escreve a variável CSS, e a
  asserção do E2E lê essa variável — a alternativa (comparar classes) passaria com o
  cálculo quebrado.

---

## 9. Checklist de aceite* [x] A carta tem **efeito 3D** (arrastar gira em dois eixos) com brilho holográfico que
      segue o ponteiro, na página da carta e com inclinação leve no álbum.
* [x] **Virar** mostra o VERSO com a ficha da conquista (gatilho, data, variante, cópias) e
      **Reiniciar** volta à frente; **Luz e brilho** acende o palco.
* [x] A **arte do verso** pode ser cadastrada pela instituição (URL validada) e substitui a
      ficha como fundo.
* [x] **Sem JavaScript** a carta e a ficha continuam na página (provado em E2E).
* [x] **Movimento reduzido** desliga giro e partículas, mantendo virar/reiniciar e teclado.
* [x] O **opt-in da instituição** (brilho, intensidade, inclinação, verso) está no catálogo,
      com prévia do efeito real, e carta antiga não muda sem configuração.
* [x] **Compartilhar**: WhatsApp, X, LinkedIn, Telegram, e-mail, **copiar link**, com aviso
      do que o link mostra — e a possibilidade de **revogar**.
* [x] O **link público** abre sem sessão, mostra **apenas aquela carta** e não exige ligar o
      perfil público.
* [x] A **imagem de prévia** é gerada no servidor e responde PNG (verificado baixando o
      `og:image` anunciado na página).
* [x] O **nome** no link segue a régua da FASE 44 (`@handle` quando o nome é privado; rótulo
      neutro sem handle), e o nome de cadastro não vaza.
* [x] **Revogar** corta o acesso na hora, e o painel não mostra mais o endereço morto.
* [x] O token **não é gravado em claro**, o índice é o SHA-256 e o selo permite reexibir.
* [x] **Defeito do balcão corrigido**: dois leitores simultâneos na segunda visita produzem
      UMA sessão (índice único parcial + resposta "já está dentro").
* [x] Nenhuma permissão nova (66) e uma tabela de instituição nova (56, sob RLS + FORCE).
* [x] Suíte verde: **2399 testes + 162 E2E**, com a imagem reconstruída.
* [x] Documentação, README e dívidas (**E69**, **E70**, **E71**) atualizados.
