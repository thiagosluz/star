# FASE 17 — Página pública e patrocínio

> **Itens quitados:** E3 (editor visual da landing page), E4 (upload de imagem de capa),
> E5 (cadastro de patrocinadores pela UI), E6 (edição de coautores pela UI).
> **ADRs:** 092 a 099 (8 decisões) · **Migrações:** nenhuma.
> **Testes novos:** 91 unitários + 48 de integração + 4 E2E.

---

## 1. Sumário executivo

`EventPage`, `PageBlock`, `SponsorTier`, `Sponsor` e `SubmissionAuthor` existem desde as
FASES 3 e 4. A landing page renderiza blocos e patrocinadores desde então. **Nenhum
código da aplicação jamais criou um registro nesses modelos** — os dados existiam por
seed e por SQL. Esta fase entrega o caminho de escrita: a instituição monta a própria
página, cadastra quem patrocina e corrige a autoria do trabalho.

### 1.1 Entregas

| # | Entrega | Onde |
|---|---|---|
| E3 | Editor da página: criar (rascunho), adicionar/editar/reordenar/ocultar/remover blocos, composição sugerida, publicar | `src/lib/admin/landing-service.ts` · `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/pagina/page.tsx` · `src/app/actions/landing-actions.ts` |
| E3 | Conteúdo de bloco validado **por tipo**, no domínio | `src/domain/events/landing-page.ts` (`blockContentSchemas`, `validateBlockContent`, `moveBlockId`, `assignDisplayOrder`, `summarizeBlockContent`) |
| E3 | Blocos que faltavam passaram a renderizar: palestrantes, trilhas e chamada de inscrição | `src/components/events/block-renderer.tsx` |
| E3 | Tema visual editável (cores, tipografia, densidade, cabeçalho, animação) com amostra ao vivo | `src/components/admin/landing-theme-fields.tsx` |
| E4 | Upload direto ao storage de capa e logotipo, com validação de imagem | `src/lib/admin/asset-service.ts` · `src/components/admin/asset-uploader.tsx` · `src/domain/events/image-rules.ts` |
| E5 | Cotas e patrocinadores: criar, editar, limitar vagas, exibir/ocultar, remover, logotipo, contrato e contato | `src/lib/admin/sponsor-service.ts` · `src/app/actions/sponsor-actions.ts` · `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/page.tsx` |
| E5 | Regras puras de patrocínio (cota, ordem de exibição, máscara de documento, vigência) | `src/domain/events/sponsor-rules.ts` |
| E6 | Editor de coautores na tela da submissão: ordem de crédito, correspondente, vínculo de conta | `src/lib/review/author-service.ts` · `src/components/review/author-editor.tsx` · `src/domain/review/author-rules.ts` |
| — | Dados de demonstração criados pelos **serviços reais** | `prisma/seed.ts` (5 blocos publicados, 1 cota e 2 patrocinadores) |

### 1.2 Números da fase

```text
Arquivos novos ............ 16 (4 de domínio · 4 de aplicação · 1 de ações · 5 de UI · 2 de página)
Arquivos alterados ........ 8 (landing-page, block-renderer, event-repository, review-actions,
                              submission detail, event admin, seed, AGENTS/README/docs)
Migrações ................. 0 — o modelo da F3/F4 já previa tudo (ver §2)
ADRs ...................... 8 (092–099) → o próximo é o ADR-100
Testes novos .............. 139 (91 unitários · 48 de integração · 4 E2E)
Totais após a fase ........ 43 arquivos · 1060 testes Vitest · 59 E2E
```

**A fase não precisou de migração.** `EventPage.isPublished`, `PageBlock.content`,
`Sponsor.maxSponsors`, `Sponsor.deletedAt`, `SubmissionAuthor.authorOrder` e
`SubmissionAuthor.isCorresponding` já estavam no schema desde as FASES 3 e 4 — foram
desenhados e nunca usados. Quando a modelagem está certa, a fase que a usa não paga DDL.

---

## 2. O problema mais difícil da fase

**Um editor de página é um formulário que escreve na vitrine da instituição — e a
vitrine está no ar.**

Três forças puxam em direções diferentes:

1. **O organizador precisa de liberdade.** Ele quer escolher os blocos, a ordem, as
   cores, o texto de cada seção. Um editor restrito não é um editor.
2. **O conteúdo é público e persistente.** Um bloco publicado errado fica no ar com o
   nome da instituição; uma imagem enviada fica no bucket público indefinidamente.
3. **Quem opera não é desenvolvedor.** Um campo de "conteúdo (JSON)" transferiria para
   ele a responsabilidade de respeitar o contrato do sistema.

A resposta desta fase tem quatro partes, e cada uma virou uma decisão:

- **O contrato de conteúdo vive no domínio, por tipo de bloco** (§3.1 / ADR-094). A tela
  reflete o schema; ela não o define. Nenhum caminho de escrita grava conteúdo que a
  renderização vá recusar depois.
- **Publicar é um ato separado de montar** (§3.2 / ADR-092). A página nasce como
  rascunho, e a página pública já lia só páginas publicadas desde a FASE 3.
- **O editor não oferece o que a página não desenha** (§3.3 / ADR-093). Isso obrigou a
  implementar três renderizadores que faltavam (palestrantes, trilhas, chamada) em vez de
  deixar o bloco como enfeite de configuração.
- **Tipo de arquivo é verificado nos BYTES, não no formulário** (§3.4 / ADR-096). O
  upload vai direto ao bucket público; a única checagem que vale é a assinatura real do
  arquivo.

O detalhe que quase passou: a lista de blocos se parece com uma lista de itens comuns, e
não é. `displayOrder` empata (dado antigo), e trocar dois valores empatados não muda nada
na tela — o organizador clica de novo e conclui que o sistema travou. Por isso mover um
bloco **reescreve a ordem inteira** (§3.5 / ADR-092), sempre visível.

---

## 3. Decisões técnicas

### 3.1 Conteúdo de bloco: um schema FECHADO por tipo

`PageBlock.content` é `Json` livre no banco e sempre foi validado "pela camada de
aplicação" — camada que não existia. Aqui ela passa a existir, com doze schemas:

| Tipo | Conteúdo aceito |
|---|---|
| `HERO` | título, subtítulo, rótulo e URL do botão (sem renderizador próprio — §3.3) |
| `RICH_TEXT` | título + corpo (até 8000 caracteres) |
| `FAQ` | até 30 pares pergunta/resposta, **item estrito, lista pode ser vazia** |
| `GALLERY` | até 24 imagens por URL **http(s)** com legenda |
| `SPONSORS` | título + filtro opcional por cota |
| `COUNTDOWN` | título + rótulo |
| `REGISTRATION_CTA` | título, descrição e rótulo do botão |
| `CUSTOM_HTML` | título + código (renderizado como TEXTO) |
| `SCHEDULE`, `SPEAKERS`, `TRACKS`, `VENUE_MAP` | só um título: o corpo são os dados do evento |

**Alternativa descartada:** um único campo de texto com o JSON do bloco. Descartada por
dois motivos: quem opera não escreve JSON, e um campo livre faria o organizador ser a
única barreira entre um dado inválido e a página pública.

**Alternativa descartada:** validar só na tela. Descartada porque a tela não é o único
caminho de escrita — a Server Action é um endpoint, e o seed chama o serviço direto.

A normalização acontece **antes** da validação e descarta linhas totalmente vazias
(§5, lição 1): o formulário envia todas as linhas que estão na tela, inclusive as que o
organizador adicionou e não preencheu. "Não preenchi esta" e "preenchi pela metade" são
coisas diferentes, e a segunda continua sendo erro — com a linha identificada.

### 3.2 A página nasce despublicada

`ensureHomePage` cria a página com `isPublished = false`. Montar é um processo: cria-se a
página, adicionam-se blocos, alguns ficam pela metade. Se a criação publicasse, o primeiro
bloco salvo apareceria para os visitantes com o texto em branco — a vitrine da instituição
no ar, meio pronta.

A leitura pública já exigia `isPublished` desde a FASE 3 (`getPublicEvent`), então a fase
não precisou mudar nada no lado público: bastou **não** publicar por acidente.

`ensureHomePage` também é idempotente. Um duplo clique criaria duas páginas `isHome`, e a
leitura pública pega a primeira — a segunda viraria um fantasma impossível de explicar.

### 3.3 Bloco que a tela oferece precisa de renderizador

Antes desta fase, `SPEAKERS`, `TRACKS` e `REGISTRATION_CTA` eram tipos válidos no enum,
apareciam na ordem recomendada e **não renderizavam nada** (o `switch` caía em `null`).
Enquanto não havia UI, isso era invisível. Com o editor, viraria um formulário que mente:
o organizador escolhe "Trilhas temáticas", preenche o título e não vê nada na página.

Três renderizadores foram implementados:

- **`SPEAKERS`** — derivado das ATIVIDADES (`ActivitySpeaker`), sem repetir nomes. Não há
  cadastro paralelo de palestrante para a landing page: duas listas da mesma pessoa
  divergiriam justamente na página pública.
- **`TRACKS`** — trilhas ativas com descrição, cor e contagem de trabalhos submetidos (o
  único sinal público de que a chamada está viva).
- **`REGISTRATION_CTA`** — o texto é do organizador, **o botão é da plataforma**: o destino
  é sempre a programação do evento. Deixar o organizador informar a URL levaria a
  inscrição para um formulário de terceiros, e a vaga, a presença e o certificado
  deixariam de existir.

Só o `HERO` continua sem renderizador, e agora o editor **diz isso** na lista
(`data-testid="block-pending-<id>"`): o cabeçalho do evento já cumpre o papel.

### 3.4 Imagem: allowlist de tipo + assinatura real

O upload de capa e logotipo reusa o fluxo de três etapas do PDF de submissão (URL
pré-assinada → navegador envia → confirmação lê o objeto), mas o motivo principal é
outro: a imagem vai ser servida **pública e indefinidamente** pelo bucket de assets
(que é `public-read` desde a FASE 1).

Duas decisões:

- **`Content-Type` declarado não é prova.** A assinatura do arquivo é conferida nos
  primeiros bytes (PNG, JPEG, WebP, AVIF). Se o cliente envia bytes e eles **não** são de
  nenhuma imagem aceita, a validação recusa — mesmo que a extensão diga `.png` e o tipo
  declarado diga `image/png`. Aceitar seria servir `text/html` no domínio da instituição.
- **SVG está fora da allowlist**, com mensagem explícita. SVG é um documento XML que aceita
  `<script>` e `onload`; servi-lo seria XSS armazenado com outro nome.

O caminho mais fraco (tipo declarado + extensão coerente) só vale quando os bytes **não**
chegaram. O tipo GRAVADO é sempre o tipo real detectado, e a extensão do objeto vem dele.

### 3.5 Ordem dos blocos: reescrever, não trocar

`movePageBlock` recalcula a ordem inteira e regrava `displayOrder` de todos os blocos
(0, 10, 20, …), em vez de trocar dois valores. Motivo concreto: dois blocos com a mesma
`displayOrder` (dado antigo, ou criado por script) fariam a troca de valores ser um no-op —
e o organizador clicaria de novo achando que a tela travou. Reescrever é idempotente e
sempre visível.

Mover na ponta é **no-op com sucesso, e sem entrada na trilha**: não é erro do usuário, e
registrar "ordem alterada" para um fato que não aconteceu é ruído na auditoria.

### 3.6 Tema é do EVENTO — um só lugar

O editor grava o tema no **evento** (`Event.theme`), e não em `EventPage.theme`. A página
pública resolve um tema por evento; manter dois níveis de tema para a mesma cor criaria
duas fontes de verdade — o defeito clássico de "mudei a cor e não mudou nada".
`EventPage.theme` continua reservado e sem uso (ver §8).

As cores são campos de TEXTO com amostra, e não `<input type="color">`. O seletor nativo
não tem estado vazio: um campo sem valor envia `#000000`. Num formulário cujo vazio
significa "usar o token da plataforma", isso transformaria "não mexi na cor" em "pintei
tudo de preto" — e não há como desfazer, porque não existe como apagar um `type="color"`.

### 3.7 Patrocínio: o limite é decidido no banco

`maxSponsors` é cláusula comercial ("só um Diamante por edição"), não preferência de
layout. A contagem acontece **dentro da transação da gravação**, com o contexto de
instituição aplicado — mesmo raciocínio da reserva de vaga em atividade e da quota de
membros do plano. Contar e gravar em transações separadas deixaria dois cadastros
simultâneos furarem o limite.

Na edição, o próprio patrocinador não ocupa vaga contra ele mesmo (`excluding`): sem isso,
corrigir o telefone de alguém que já está numa cota cheia seria recusado.

Reduzir o limite abaixo do que já está ocupado também é recusado — aceitar deixaria a cota
"estourada", um estado que o próprio sistema considera inválido, e a tela passaria a
mostrar "0 vagas" para uma cota com 3 patrocinadores.

### 3.8 Autoria: substituição total, com vínculo de conta preservado

`submission_authors` tem índice ÚNICO em `(submissionId, authorOrder)`. Atualizar a ordem
linha a linha, trocando dois autores (1↔2), violaria o índice **no meio da operação**: o
PostgreSQL verifica a unicidade a cada `UPDATE`, não no fim da transação. A edição remove
todas as linhas da submissão e recria na ordem nova, dentro da mesma transação.

Recriar derrubaria o `userId` de quem tem conta (é ele que dá ao coautor acesso ao próprio
crédito). Por isso os vínculos existentes são lidos por e-mail antes do `deleteMany` e
reaplicados nas linhas novas; a busca de contas na plataforma é restrita à instituição —
casar e-mail contra a base global revelaria a existência de contas de outras instituições.
E a tela **não lista a equipe**: quem submete um trabalho é, no papel `PARTICIPANT`, público
do evento (armadilha 24 do `AGENTS.md`).

O nome de quem tem conta não é editável no editor de autoria, e a tela diz por quê: o
crédito usa o nome do perfil. Permitir digitar outro nome criaria a expectativa de que ele
valeria.

---

## 4. ADRs

### ADR-092 — A página pública é montada pelo organizador e nasce como rascunho

**Contexto.** `EventPage` e `PageBlock` existiam desde a FASE 3 e nunca tiveram caminho de
escrita na aplicação. A página pública renderiza os blocos quando existem e cai numa
composição padrão quando não existem.

**Decisão.** O editor cria a página com `isPublished = false` e exige um ato explícito para
publicar. Reordenar blocos reescreve a ordem inteira, de `BLOCK_ORDER_STEP` em
`BLOCK_ORDER_STEP`. `ensureHomePage` é idempotente.

**Justificativa.** Montar é um processo com etapas intermediárias inválidas; publicar é uma
decisão. A leitura pública já filtrava `isPublished`, então o rascunho não vaza por
construção. A reescrita da ordem elimina o no-op invisível do empate.

**Consequências.** (+) Nada aparece no site sem decisão explícita; a ordem é sempre
previsível. (−) Para ver o resultado antes de publicar, o organizador precisa publicar e
despublicar (dívida E9, §8).

### ADR-093 — Bloco que o editor oferece precisa de renderizador

**Contexto.** `SPEAKERS`, `TRACKS` e `REGISTRATION_CTA` eram tipos válidos e não
renderizavam nada. Sem editor, isso era invisível.

**Decisão.** Implementar os três renderizadores antes de oferecer os tipos na UI.
`SPEAKERS` deriva das atividades; `TRACKS` mostra trilhas ativas com contagem de
submissões; `REGISTRATION_CTA` tem texto livre mas destino fixo (a programação do evento).
O `HERO` permanece sem renderizador e o editor avisa isso em cada bloco.

**Justificativa.** Oferecer um bloco que não aparece é um formulário que mente. O destino
fixo da chamada de inscrição protege o fluxo acadêmico: uma inscrição fora do sistema não
tem vaga, presença nem certificado.

**Consequências.** (+) A UI não promete o que não entrega; o organizador não perde tempo
preenchendo bloco inerte. (−) O editor precisa manter a lista de tipos sem renderizador em
sincronia com o dispatcher (`BLOCK_WITHOUT_RENDERER` tem teste unitário).

### ADR-094 — Conteúdo de bloco é validado por tipo, no domínio

**Contexto.** `content` é `Json` livre, escrito pelo organizador e renderizado na página
pública. A FASE 3 deixou a validação "para a camada de aplicação".

**Decisão.** Doze schemas Zod, um por tipo (`blockContentSchemas`), com
`validateBlockContent` normalizando antes de validar (descarta linhas de lista totalmente
vazias) e devolvendo erros com o caminho do campo. URLs passam pela allowlist de protocolo
http(s) que já existia para o tema.

**Justificativa.** A tela não é o único caminho de escrita: a Server Action é um endpoint e
o seed chama o serviço direto. Validar no domínio garante que a mesma regra vale para
todos, e é o que permite os schemas fechados por tipo descartarem campos de outros tipos.

**Consequências.** (+) Nenhum caminho grava conteúdo que a página recusaria; o erro diz
qual campo falhou. (−) Um tipo novo de bloco exige schema, renderizador e rótulo — o que é
o objetivo.

### ADR-095 — Tema é do evento, em um único lugar

**Contexto.** `Event.theme` e `EventPage.theme` existiam. A página pública resolve apenas
`Event.theme`.

**Decisão.** O editor grava em `Event.theme`, com validação por `resolveTheme` (a mesma da
renderização). Cores são campos de texto com amostra; vazio significa "usar o token do
sistema".

**Justificativa.** Dois níveis de tema para a mesma cor produzem duas fontes de verdade e o
sintoma clássico de "mudei e não mudou nada". O `<input type="color">` não tem estado
vazio e enviaria `#000000` para um campo que o organizador não tocou.

**Consequências.** (+) Uma cor, um lugar, um valor. (−) `EventPage.theme` continua
reservado e sem uso (dívida em §8); uma página de campanha com aparência própria exigirá
retomar o override.

### ADR-096 — Tipo de imagem é o que os BYTES dizem

**Contexto.** Capa, logotipo e logotipo de patrocinador são servidos pelo bucket público de
assets. O upload não passa pela aplicação.

**Decisão.** Allowlist fechada (PNG, JPEG, WebP, AVIF) e verificação da assinatura real do
arquivo. Bytes enviados que não são imagem → recusa, sem exceção. SVG fora da allowlist com
mensagem explícita. O tipo gravado é o detectado, e a extensão do objeto vem dele. A
confirmação reconfere o `Content-Type` do objeto armazenado.

**Justificativa.** O `Content-Type` declarado é arbitrário, e uma imagem servida pública é
XSS se o navegador interpretar o conteúdo como documento. SVG é XML executável.

**Consequências.** (+) Arquivo renomeado não engana o sistema; a página anuncia o tipo real.
(−) Formatos legítimos fora da allowlist (GIF, TIFF) são recusados — a allowlist é fechada
por decisão, não por esquecimento.

### ADR-097 — Patrocínio: limite de vagas na transação, remoção lógica

**Contexto.** `SponsorTier.maxSponsors` é cláusula comercial. `Sponsor` tem `deletedAt` e
carrega contrato e valor.

**Decisão.** O limite é verificado dentro da transação da gravação, contando o que já está
na cota (excluindo o próprio patrocinador na edição). Remover cota com patrocinadores é
recusado. Remover patrocinador é remoção LÓGICA. O documento fiscal é gravado, exibido
mascarado e mantido quando o formulário não o reenvia.

**Justificativa.** Contar e gravar separadamente deixa dois cadastros simultâneos furarem
um limite que é contrato. A FK de cota é `onDelete: SetNull`: o banco aceitaria apagar a
cota e o patrocínio pago desceria para o agrupamento genérico sem ninguém pedir. O
histórico financeiro não pode evaporar por um clique na tela errada, e o CNPJ não precisa
circular inteiro numa tela aberta no balcão.

**Consequências.** (+) O limite vale sob concorrência; o histórico permanece; o documento
não vaza na tela nem na trilha. (−) Patrocinadores removidos continuam ocupando a contagem
da cota (o filtro é `deletedAt: null`), o que exige reaproveitar o cadastro em vez de
recriar.

### ADR-098 — Autoria: substituição total com vínculo de conta preservado

**Contexto.** `submission_authors` tem índice único em `(submissionId, authorOrder)` e, até
esta fase, uma única linha criada no envio. A ordem de crédito é informação acadêmica.

**Decisão.** Editar autoria remove e recria todas as linhas na mesma transação, na ordem
recebida (reindexada 1..N), com exatamente um autor correspondente (sem marcação, o
primeiro assume). O vínculo de conta é preservado casando o e-mail contra as contas **da
instituição**. A edição só é permitida ao autor que submeteu e apenas enquanto a submissão
está em estado editável.

**Justificativa.** A atualização linha a linha viola o índice único ao trocar dois autores.
A recriação sem preservar o vínculo derrubaria o acesso do coautor ao próprio crédito. A
busca global de e-mail revelaria contas de outras instituições. Depois do envio, o
`blindSnapshot` congela a autoria avaliada — mudá-la faria o parecer apontar para outra
lista.

**Consequências.** (+) Trocar ordem é trivial e seguro; o coautor com conta mantém o
crédito. (−) Salvar sem mudança não escreve nem audita (comparação por conteúdo), então a
trilha não registra operação vazia.

### ADR-099 — Documento fiscal mascarado, ausente significa preservar

**Contexto.** O formulário de edição mostra o CNPJ/CPF mascarado — não tem como devolvê-lo
ao servidor.

**Decisão.** `taxId` ausente no payload **preserva** o valor gravado; o campo só é limpo com
string vazia explícita. A leitura devolve a máscara (`maskTaxId`), e a trilha de auditoria
nunca recebe o campo.

**Justificativa.** Ler o formulário e salvar apagaria o documento do patrocinador sem
ninguém pedir — um dado que existe para conferência fiscal. A trilha é lida por mais gente
do que o cadastro comercial, então o documento não entra nela nem mascarado.

**Consequências.** (+) Editar dados do patrocinador nunca destrói informação. (−) Não há
como limpar o documento pela tela (exige SQL) — decisão consciente: apagar dado fiscal é
ato deliberado, não efeito colateral de salvar.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Teste unitário de autoria falhou: autor com `email: '  '` era recusado como "e-mail inválido" | O schema usava `z.email()` sem tratar campo vazio: o formulário envia uma linha por autor, e o que ficou em branco chega como string vazia, não como campo ausente | `optionalText()` no domínio trata texto vazio como ausente — vazio é ausência, não erro |
| 2 | Teste unitário esperava recusa de `text/html` renomeado para `.png`; a validação **aceitava** | Bytes enviados e não reconhecidos caíam no caminho fraco (tipo declarado + extensão), que é o reservado para quando os bytes **não** chegam | A validação passou a recusar (`NOT_AN_IMAGE`) quando há bytes e eles não são imagem — o `detectImageMime` também caiu de 12 para 8 bytes mínimos, para não recusar PNG legítimo truncado |
| 3 | E2E do editor falhou com "element is not visible" no botão de salvar bloco, 60 s de espera | Os botões de `InlineActionForm` não tinham `data-testid` (só o `AdminForm` tinha), então a espera era por um botão inexistente | `data-testid="inline-submit"` no botão do formulário pontual |
| 4 | E2E preencheu o bloco ERRADO: a captura de tela mostrou o texto no bloco 2 (do seed), com o selo "vazio" ainda visível | `expect(últimoBlocoDeTexto).toBeVisible()` passava apontando para o bloco ANTIGO da composição sugerida — a asserção era vazia e o `.last()` resolvia antes de o bloco novo existir no DOM | A espera passou a ser pela **contagem** (`toHaveCount(initialCount + 1)`) antes de pegar o último bloco |
| 5 | E2E de autoria: `rows[0].guestName` era `null` onde o teste esperava o nome digitado | O primeiro autor tem CONTA: o crédito usa `user.name` e o campo digitado só é gravado como convidado quando não há vínculo | O teste passou a verificar o vínculo (`userId`) na posição 1; e a tela tornou o nome de quem tem conta somente leitura, explicando o motivo |
| 6 | Teste de integração de patrocínio falhou em `toBeGreaterThan(0)` com "received object" | O patrocinador escolhido havia sido editado com `contractValueCents: null`, e `typeof null === 'object'` | O cenário passou a criar o próprio patrocinador com valor — o teste é que dependia de estado de outro cenário |
| 7 | `npm run build` listou rotas novas, mas o E2E mediria código antigo se o container não fosse reconstruído | Armadilha 3 do `AGENTS.md`: um `--build` que falha mantém o container anterior no ar | Imagem reconstruída e conferida por data antes do E2E; as duas rotas novas (`/pagina`, `/patrocinadores`) aparecem no build |

---

## 6. Evidência de verificação

### 6.1 Bateria completa

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 43 arquivos, 1060 testes passando (+139)
npm run build                → ✓ Compiled successfully
                               ƒ /t/[tenantSlug]/administracao/eventos/[eventId]/pagina
                               ƒ /t/[tenantSlug]/administracao/eventos/[eventId]/patrocinadores
npm run db:verify            → Contrato íntegro.
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:verify:pooling    → Pooling íntegro: contexto por transação preservado sob PgBouncer.
npm run db:partitions        → partições em dia (1047 linhas de auditoria)
npm run test:e2e             → 59 passed (1.7m)
npm run db:seed              → 5 bloco(s) e 1 cota (Ouro) e 2 patrocinadores publicados
```

### 6.2 E2E dos itens novos (contra o container de produção)

```text
✓ a página nasce como rascunho e não muda o site antes de publicar (E3)
✓ o organizador monta os blocos, reordena e publica; o site passa a renderizá-los (E3)
✓ o patrocinador cadastrado aparece na página e some ao ser ocultado (E4, E5)
✓ o autor edita a lista de coautores, com ordem e correspondente (E6)
```

### 6.3 Integração (banco real)

```text
✓ a página nasce despublicada e não é a página do evento no site
✓ criar a página de novo é idempotente (uma única página inicial)
✓ conteúdo inválido é recusado e não grava nada, nem pela metade
✓ a ordem persistida é a ordem que a renderização pública reproduz
✓ a composição sugerida só se aplica a página vazia
✓ publicar torna a página a página do evento; despublicar devolve a composição padrão
✓ tema fora da allowlist é recusado sem alterar o tema vigente
✓ recusa bloco de OUTRA instituição (RLS e filtro concordam)
✓ o limite de vagas da cota é respeitado, e a recusa cita o limite
✓ o mesmo nome de patrocinador em dois eventos recebe identificadores distintos
✓ o documento fiscal é preservado quando o formulário não o reenvia
✓ remover patrocinador é remoção lógica: a linha e o valor do contrato permanecem
✓ o documento fiscal nunca aparece na trilha de auditoria
✓ trocar a ordem de dois autores não colide no índice único
✓ a conta é vinculada pelo e-mail, mas só dentro da instituição
✓ a autoria fica congelada depois do envio
```

### 6.4 Verificação manual dos dados de demonstração

```text
GET /t/ufba-demo/eventos/congresso-2026           → 200
  "Sobre o congresso" ..................... presente (bloco RICH_TEXT)
  "Perguntas frequentes" .................. presente (bloco FAQ)
  "Garanta sua vaga" ...................... presente (bloco REGISTRATION_CTA)
  "Instituto de Tecnologia Aberta" ........ presente (patrocinador)
  "Editora Ciência Viva" .................. presente (patrocinador)
```

---

## 7. Comandos operacionais

```bash
# ── Editor da página pública ───────────────────────────────────────────────────
# /t/<slug>/administracao/eventos/<eventId>/pagina
#   1. "Criar página" (nasce rascunho)  ou  "Aplicar composição sugerida"
#   2. adicionar blocos, editar conteúdo, subir/descer, ocultar, remover
#   3. "Publicar a página" + "Salvar página"
# Aparência e SEO ficam na mesma seção; capa e logotipo na seção seguinte.

# ── Patrocínio ─────────────────────────────────────────────────────────────────
# /t/<slug>/administracao/eventos/<eventId>/patrocinadores
#   Cotas primeiro (definem ordem e limite de vagas), depois os patrocinadores.
#   O logotipo sobe direto para o bucket público de assets.

# ── Autoria de uma submissão ───────────────────────────────────────────────────
# /t/<slug>/submissoes/<submissionId> → seção "Autoria"
#   Ordem na tela = ordem de crédito. Edição só antes do envio.

# ── Reconstruir a imagem antes do E2E (armadilha 3) ────────────────────────────
docker compose --profile app up -d --build web
docker images | grep eventflow/web     # conferir a data
curl -s -o /dev/null -w '%{http_code}\n' \
  http://localhost:3000/t/ufba-demo/administracao/eventos/<eventId>/pagina   # 307 sem sessão
```

```sql
-- Blocos de um evento, na ordem em que a página renderiza:
SELECT b."displayOrder", b.type, b."isVisible", length(b.content::text) AS bytes
  FROM page_blocks b JOIN event_pages p ON p.id = b."pageId"
 WHERE p."eventId" = '<eventId>' ORDER BY b."displayOrder", b.id;

-- Patrocinadores com cota e contrato (o documento fiscal sai mascarado por decisão):
SELECT s.name, t.name AS cota, t.rank, s."isActive", s."contractValueCents",
       s."deletedAt"
  FROM sponsors s LEFT JOIN sponsor_tiers t ON t.id = s."tierId"
 WHERE s."eventId" = '<eventId>' ORDER BY t.rank NULLS LAST, s."displayOrder";

-- Autoria de uma submissão (ordem de crédito):
SELECT a."authorOrder", COALESCE(u.name, a."guestName") AS autor,
       a."isCorresponding", a."userId" IS NOT NULL AS tem_conta
  FROM submission_authors a LEFT JOIN "user" u ON u.id = a."userId"
 WHERE a."submissionId" = '<submissionId>' ORDER BY a."authorOrder";
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Item | Por que ficou | Impacto se ficar |
|---|---|---|---|
| 1 | **Pré-visualização antes de publicar (E9)** | Publicar é o caminho hoje disponível para ver o resultado montado (ADR-092) | O organizador publica para conferir e despublica — janela em que a página incompleta fica no ar |
| 2 | **Galeria por URL, sem upload de imagem no bloco (E10)** | O upload desta fase cobre capa e logotipos; a galeria aceita imagens hospedadas fora | Bloco de galeria exige que a instituição hospede as fotos em outro lugar |
| 3 | **Reaproveitar patrocinador entre eventos pela tela (E11)** | O `slug` é por instituição e o cadastro é por evento; não há tela de "vincular existente" | Cadastrar o mesmo patrocinador em duas edições exige redigitar os dados |
| 4 | **Sem histórico de versões da página (E12)** | A trilha registra a mudança (com resumo do conteúdo), mas não há como voltar a uma versão anterior | Um bloco sobrescrito por engano só volta se alguém tiver o conteúdo antigo |
| 5 | **Publicação agendada (E13)** | Entregar "publicar agora/rascunho" resolve o caso comum | Campanha com data marcada exige alguém clicar no dia |
| 6 | **`EventPage.theme` continua reservado e sem uso** | Dois níveis de tema para a mesma cor criariam duas fontes de verdade (ADR-095) | Uma página de campanha com aparência própria precisará retomar o override |
| 7 | **Bloqueio de conflito de agenda na edição de atividade** | Existente desde a FASE 7 — não é desta fase | — (registrado para não ser confundido com regressão) |

---

## 9. Checklist de aceite

- [x] **E3** — página criada pelo serviço, **despublicada**, com criação idempotente
- [x] **E3** — blocos adicionados, editados, reordenados (ordem reescrita), ocultados e removidos
- [x] **E3** — conteúdo validado por tipo no domínio, com erro por campo e sem gravação parcial
- [x] **E3** — composição sugerida disponível apenas para página vazia
- [x] **E3** — publicar/despublicar altera o que o site mostra, sem sessão e sem cache antigo
- [x] **E3** — tema editável (cores, tipografia, densidade, cabeçalho, animação) validado pela mesma allowlist da renderização
- [x] **E3** — `SPEAKERS`, `TRACKS` e `REGISTRATION_CTA` passaram a renderizar; o `HERO` é declarado sem renderizador e o editor avisa
- [x] **E4** — upload de capa e logotipo direto ao storage, com tipo e tamanho travados por finalidade
- [x] **E4** — assinatura real do arquivo conferida; SVG recusado com motivo explícito
- [x] **E4** — confirmação lê o objeto, confere tamanho/checksum e só então grava a URL
- [x] **E5** — cotas criadas, editadas e removidas (remoção recusada quando há patrocinadores)
- [x] **E5** — limite de vagas aplicado dentro da transação, inclusive na edição
- [x] **E5** — patrocinadores criados, editados, exibidos/ocultados e removidos logicamente
- [x] **E5** — ordem de exibição pública por cota e depois por ordem dentro da cota
- [x] **E5** — documento fiscal mascarado, preservado quando ausente e fora da trilha
- [x] **E6** — coautores adicionados, removidos e reordenados com ordem de crédito reindexada
- [x] **E6** — exatamente um autor correspondente, decidido no domínio
- [x] **E6** — troca de ordem não colide no índice único `(submissionId, authorOrder)`
- [x] **E6** — vínculo de conta preservado e resolvido apenas dentro da instituição
- [x] **E6** — edição restrita ao autor que submeteu e ao estado editável
- [x] Toda mutação auditada, com resumo do conteúdo (nunca o texto inteiro, nunca o documento fiscal)
- [x] Seed de demonstração cria página publicada, cota e patrocinadores pelos **serviços reais**
- [x] Testes novos: 91 unitários + 48 de integração + 4 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 6
- [x] `README.md`, `AGENTS.md` e `docs/dividas-tecnicas.md` atualizados
- [x] Imagem `eventflow/web:local` reconstruída e E2E rodando contra ela

---

**Aguardando APROVADO: AVANÇAR**
