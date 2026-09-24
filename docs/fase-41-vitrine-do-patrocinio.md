# FASE 41 — Vitrine do patrocínio (cor e tamanho por cota)

> **Tema novo.** A pergunta que abriu a fase foi de quem usa: *"no cadastro de cotas não
> conseguimos alterar a cor de cada cota… no site público deveria ter alguma diferenciação de
> tamanhos de logos de acordo com a cota contratada… poderíamos fazer algo parecido, com tamanhos
> e cores dos cards de acordo com a cota"* — com uma página de referência de outro evento, em que
> cada faixa (Realização, Apoio, Ouro, Prata) tem cartões com **fundo tingido** e **logos de
> tamanhos diferentes**.

---

## 1. Sumário executivo

A cota deixou de ser só **ordem e limite**: ela passou a definir a **vitrine** — a cor que
identifica o nível de patrocínio e o **tamanho da logo** na página pública. E o achado que
organizou a fase: **a cor já existia no banco e no formulário, mas não tinha leitor**.

### Entregas

| # | Entrega |
|---|---|
| 1 | `SponsorTier.logoScale` — degrau da logo (`SMALL` · `MEDIUM` · `LARGE` · `FEATURE`), com altura e largura máxima calibradas por degrau |
| 2 | `sponsorTierTint(color)` — função pura que traduz a cor da cota no tom do cartão, com a cor validada e a cor cheia **fora** de trás de texto |
| 3 | **Cor e tamanho no cadastro de cota NOVA** (antes a cor existia só dentro do "Editar cota", recolhido, e o tamanho não existia) |
| 4 | **Prévia do cartão** no próprio formulário, reagindo à cor e ao degrau (as amostras são atalho: o campo é texto e funciona sem JavaScript) |
| 5 | **Página pública**: uma faixa por cota, com marcador na cor, descrição da cota e **cartões tingidos** com a logo no tamanho contratado |
| 6 | **Nome dimensionado** pela escala quando não há arquivo de logo — sem isso a hierarquia só existiria para quem já subiu a marca |
| 7 | Descrição de apoio opcional no **bloco** de patrocinadores (`content.description`) |
| 8 | Migração, testes (unit + integração + E2E) e este documento |

### Números da fase

| | |
|---|---|
| Arquivos novos | **2** — `src/components/admin/sponsor-tier-style.tsx` e a migração |
| Arquivos alterados | **9** — `sponsor-rules.ts` (domínio), `sponsor-service.ts`, `sponsor-actions.ts`, `event-repository.ts`, `block-renderer.tsx`, `block-content-fields.tsx`, `landing-page.ts`, a página de patrocinadores, o seed e a suíte (unit/integração/E2E) |
| Migrações | **1** — `sponsor_tiers.logoScale` (35 → **36**) |
| Tabelas de tenant | **52** (sem tabela nova) |
| Testes novos | **+14** — 10 unitários, 3 de integração e 1 E2E (a suíte Vitest vai de **2146** para **2159**; o E2E, de **142** para **143**) |
| Defeitos reais encontrados | **3** — ver §5 |
| Dívidas quitadas | **nenhuma** — a fase não estava amarrada a dívida |
| Dívidas novas | **nenhuma** |
| Armadilhas novas | **nenhuma** — o que apareceu coube nas armadilhas 87 (medida que o sistema não entende) e 96 (ordem/decisão por chave) já registradas |
| ADRs | **227 … 229** (a próxima é 230) |

---

## 2. O problema mais difícil: **a coluna que ninguém lia**

`sponsor_tiers.color` existe desde a modelagem da FASE 17, o `colorSchema` a valida, o serviço a
grava — e **a página pública a ignorava por completo**: o bloco de patrocinadores desenhava todo
mundo com `h-10`, agrupado por nome de cota, sem cartão e sem cor. Do ponto de vista de quem
opera, o resultado era exatamente o que o humano descreveu: *"não conseguimos alterar a cor de
cada cota"*. Não era falta de campo — era falta de **leitor**.

É a mesma família de defeito que o projeto já catalogou (coluna lida por todos e escrita por
ninguém, e o inverso): **dado sem consumidor não é funcionalidade, é promessa**. A fase só fecha
o ciclo quando o valor entra no documento que a pessoa vê — e é por isso que o critério de aceite
aqui é *a página pública* e não o formulário.

O segundo problema foi de **desenho**: como diferenciar tamanhos sem abrir a porta para a página
virar colagem? A resposta foi trocar "número de pixels" por **degrau**, e a cor por **tom**
(`color-mix` com a cor cheia reservada ao marcador), pelas razões das ADRs 227 e 228.

---

## 3. Decisões técnicas

### 3.1 A escala é da COTA, e é degrau — não número

O tamanho da logo é a **hierarquia comprada** ("Diamante aparece maior que Prata"), e quem
cadastra a empresa não é quem negociou a cota. Por isso o campo vive na cota
(`logoScale`), e não no patrocinador — e é um **degrau** (`SMALL` 28 px, `MEDIUM` 44 px,
`LARGE` 64 px, `FEATURE` 96 px, com largura máxima por degrau), não um número livre.

Um número livre entregaria "controle total" e o primeiro `400` digitado por engano quebraria a
seção; medida que o sistema não entende é o que a armadilha 87 manda **recusar**, não acomodar.

### 3.2 O tom do cartão vem de `color-mix`, e a cor cheia não fica atrás de texto

`sponsorTierTint(color)` devolve `{ surface, border, accent }`, com o fundo em
`color-mix(in oklab, <cor> 16%, transparent)`. Três razões:

* **funciona nos dois temas** — a mistura é com `transparent` por cima do fundo da seção, então o
  mesmo valor serve para tema claro e escuro, sem ninguém recalcular nada;
* **funciona nos dois formatos** de cor aceitos (`#rrggbb` e `oklch()`), sem conversão em
  JavaScript;
* **a cor cheia fica no marcador** (a barra ao lado do título) e nunca atrás de texto: `#facc15`
  com texto branco é ilegível, e legibilidade não é escolha do organizador.

A força do tom (**16%** de fundo, **45%** de borda) está no domínio, em constantes, e nasceu de
**ver a tela**: a primeira versão usava 10% e os cartões saíram quase brancos — a hierarquia não
aparecia. Está registrado aqui porque "10% parecia suficiente" é exatamente o tipo de decisão que
se perde sem registro.

### 3.3 A cor é validada antes de virar CSS

A cor vem do banco e entra num `style` inline. `sponsorTierTint` só devolve valor depois do
`colorSchema` (a mesma allowlist da página pública: hexadecimal ou `oklch()`, nada de `rgb()`,
nomes ou qualquer coisa com `;`/`}`/`url(`). Cota sem cor — ou com cor inválida — devolve `null` e
o cartão fica **neutro**: não escolher cor é resposta legítima, não campo pendente.

### 3.4 Sem arquivo de logo, o NOME é dimensionado pela escala

Metade dos patrocinadores de um evento em começo de temporada não tem arquivo de marca. Se a
escala valesse só para `<img>`, a hierarquia desapareceria justamente para eles — e o cartão do
patrocinador "sem logo" sairia idêntico em qualquer cota. O nome passou a usar a **escala
tipográfica do sistema** por degrau (`text-sm` → `text-xl`), o que mantém a trava do design
system valendo (nada de pixel arbitrário).

### 3.5 O agrupamento passou a ser por `tierId`, e a ordem continua a do repositório

O bloco agrupava por **nome** da cota. Dois problemas: nome é editável (renomear a cota partia o
grupo em dois na mesma página) e nomes parecidos de cotas diferentes se misturavam. Agora o
agrupamento é por `tierId` — a vitrine (cor, escala, descrição) viaja com o id —, preservando a
ordem em que o repositório entregou (`sortSponsorsForDisplay`: rank da cota → ordem → nome). Uma
segunda regra de ordenação no componente seria como as duas versões divergem.

### 3.6 O formulário ganhou prévia, e as amostras não substituem o campo

Cor e tamanho só fazem sentido juntos: a pergunta do organizador é "como esta cota vai aparecer?",
e a resposta é o cartão. A prévia fica no mesmo componente dos dois campos. As **amostras**
(Ouro, Prata, Bronze, Azul, Verde, Vinho, Grafite) escrevem no campo de texto, que é quem carrega
o valor para o servidor — sem JavaScript, o campo continua ali com o valor gravado, e a cor livre
(hexadecimal ou `oklch()`) segue possível: a identidade da instituição não cabe numa lista de sete.

---

## 4. ADRs

### ADR-227 — A escala da logo é um DEGRAU da cota, não um número livre

**Contexto.** O pedido era "escolher o tamanho que essa logo vai aparecer". O caminho óbvio é um
campo numérico em pixels, que dá controle total.

**Decisão.** Quatro degraus calibrados (`SMALL`, `MEDIUM`, `LARGE`, `FEATURE`), cada um com altura
e largura máxima definidas no domínio, e o valor gravado como texto (`VarChar(12)`) lido por
`parseSponsorLogoScale`, que cai no padrão quando não reconhece.

**Justificativa.** O tamanho aqui é hierarquia comercial, não layout: um número livre permite
"400" e a seção vira colagem; e a leitura tolerante mantém cota antiga (sem o campo) desenhando o
que já desenhava. Texto em vez de enum do banco porque acrescentar um degrau deve ser uma linha no
domínio, não uma migração de tipo.

**Consequências.** (a) A tela mostra a altura em pixels do degrau escolhido, então o organizador
sabe o que está escolhendo; (b) o teste unitário prende que a escala é **crescente** (o degrau
maior não pode ser menor que o anterior); (c) mudar de ideia sobre a calibração é uma constante.

### ADR-228 — A cor vira TOM de cartão; a cor cheia fica no marcador

**Contexto.** Com a cor finalmente lida na página, a tentação é pintar o cartão com a cor cheia e
o título com ela.

**Decisão.** O fundo é `color-mix` da cor com `transparent` (16%), a borda é 45%, e a cor cheia
aparece só numa barra ao lado do título da cota.

**Justificativa.** Cor cheia atrás de texto mata a legibilidade em cores claras (amarelo, prata), e
a página é pública — quem lê é o visitante, não o organizador. A mistura com `transparent` também
resolve tema claro/escuro e os dois formatos de cor sem cálculo em JavaScript.

**Consequências.** (a) O tom é discreto por construção e ajustável por constante; (b) a hierarquia
depende de **tamanho + tom + marcador**, e não de uma cor berrante; (c) cota sem cor rende cartão
neutro — o teste unitário prende isso.

### ADR-229 — A trilha compara cor e escala, e é por isso que a leitura as traz

**Contexto.** A auditoria da cota compara o que foi lido antes com o que está sendo gravado.

**Decisão.** O `select` da edição passou a trazer `color` e `logoScale`, e a lista de campos
comparados passou a incluí-los.

**Justificativa.** Campo fora do `select` chega `undefined` no diff e **toda** edição passa a
registrar "a cor mudou" — auditoria que mente sobre o que mudou é pior que auditoria ausente, e o
registro é lido em disputa comercial. Há teste de integração prendendo o caso: gravar duas vezes o
mesmo valor produz **uma** entrada de mudança, não duas.

**Consequências.** A trilha da cota passa a registrar as duas dimensões da vitrine, e o teste
correspondente é o que impede a regressão silenciosa.

---

## 5. Lições aprendidas — defeitos REAIS encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | *"Não conseguimos alterar a cor de cada cota"* — e a cor não aparecia na página | A coluna `sponsor_tiers.color` existia desde a FASE 17, com schema, serviço e um campo **dentro** do "Editar cota" recolhido; **a página pública ignorava o valor**. Não faltava campo: faltava leitor | Cor e tamanho entraram no cadastro de cota NOVA, com prévia, e a página pública passou a desenhar o cartão tingido. O critério de aceite da fase é a página, não o formulário |
| 2 | O campo "Cor" anunciava `oklch()` e a ação recusava qualquer coisa acima de 9 caracteres | A ação tinha `z.string().trim().max(9)` — um limite herdado de quando o campo era hexadecimal de 8 dígitos, enquanto o domínio aceitava `oklch()` | A ação passou a usar o **mesmo** `colorSchema` do domínio: a tela não pode anunciar um formato que o servidor não aceita |
| 3 | Os cartões saíram **quase brancos** na primeira versão — a hierarquia não aparecia | Tom de fundo a 10% da cor: pastel demais sobre o fundo claro da página | Tom a **16%**, borda a 45%, e a cor cheia num marcador ao lado do título. O ajuste saiu de **ver a tela**, não de deduzir do código |

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 93 arquivos · 2159 testes passando
npm run build ..................... ✓ Compiled successfully
npm run db:verify ................. Contrato íntegro.
npm run db:verify:isolation ....... 9/9 verificações passaram.
npm run db:partitions ............. partições do mês atual e dos seguintes garantidas
npx prisma migrate status ......... 36 migrations found · Database schema is up to date!
npm run db:seed ................... OK (2 cotas com cor e tamanho diferentes, 3 patrocinadores)
npm run test:e2e .................. 143 passed
```

O cenário novo do E2E, do ponto de vista de quem usa: o organizador cria **duas cotas** no
formulário de cota nova — uma **Destaque** com a cor digitada, outra **Pequena** com a cor vinda da
**amostra** —, cadastra um patrocinador em cada uma, sobe a **mesma imagem** (um PNG 1×1) nas duas
pelo envio real (assinatura do arquivo + bucket) e abre a página pública. A prova é **medida**: o
cartão da cota Destaque é mais alto que o da Pequena, com o mesmo arquivo de logo nas duas — se o
degrau não chegasse ao desenho, os dois cartões teriam a mesma altura.

---

## 7. Comandos operacionais

```bash
# A tela das cotas (cor, tamanho e prévia do cartão)
/t/<slug>/administracao/eventos/<eventId>/patrocinadores

# O que está gravado: cor e degrau de cada cota do evento
psql "$DATABASE_URL" -c 'SELECT name, color, "logoScale", rank FROM sponsor_tiers ORDER BY rank'

# Quem está sem cor (o cartão sai neutro) ou no degrau padrão
psql "$DATABASE_URL" -c 'SELECT e.slug, t.name FROM sponsor_tiers t JOIN events e ON e.id = t."eventId" WHERE t.color IS NULL'

# A vitrine na página pública (bloco "Patrocinadores")
/t/<slug>/eventos/<eventSlug>#patrocinadores
```

---

## 8. Dívidas técnicas e pontos de atenção

* **A escala não muda o cartão quando o patrocinador não tem logo NEM nome longo** — o nome é
  dimensionado (ADR do §3.4), mas um nome de uma palavra em cota Pequena e em cota Destaque difere
  só pelo tamanho da fonte; é o esperado, e vale saber ao conferir a página.
* **Não há ordem manual dentro da faixa.** A ordem é `displayOrder` e, no empate, o nome. Arrastar
  patrocinadores dentro da cota (como o quadro de demandas faz com cartões) não existe — se o
  comercial quiser "esta marca antes daquela", hoje é o campo de ordem.
* **A largura máxima por degrau é fixa no domínio.** Uma marca muito deitada pode ficar menor que
  o degrau pede (o `object-contain` preserva a proporção). A alternativa — cortar ou esticar —
  deformaria a marca de terceiro, e isso não é escolha nossa.
* **O crachá e o certificado não usam a cor da cota.** A cor vive na vitrine da página pública e
  no cadastro; levar a hierarquia para a etiqueta do credenciamento é a dívida **E42** (identidade
  visual do crachá), que continua aberta.

---

## 9. Checklist de aceite

* [x] O organizador escolhe a **cor** da cota no cadastro de cota **nova** e na edição
* [x] O organizador escolhe o **tamanho da logo** por cota (Pequena · Média · Grande · Destaque)
* [x] A tela mostra **prévia do cartão** reagindo à cor e ao degrau
* [x] As amostras de cor são **atalho**, e o campo continua aceitando hexadecimal e `oklch()` — e funcionando sem JavaScript
* [x] A **página pública** desenha uma faixa por cota, com marcador na cor, descrição da cota e cartões tingidos
* [x] A **logo sai no tamanho contratado** — medido em E2E com o mesmo arquivo nas duas cotas
* [x] Cota **sem cor** rende cartão neutro (e a leitura devolve `tierColor: null`, não erro)
* [x] Cor **inválida** não vira CSS: o domínio recusa e o cartão fica neutro
* [x] O nome é dimensionado pela escala quando **não há arquivo** de logo
* [x] O agrupamento é por **`tierId`** — renomear a cota não parte o grupo
* [x] A **ordem** das faixas continua a do repositório (rank da cota → ordem → nome)
* [x] A **trilha** registra cor e escala quando mudam — e não quando não mudam (teste de integração)
* [x] A trava do **sistema de design** continua verde (tokens, escala tipográfica, zero cor literal em componente)
* [x] Toda a suíte verde (**2159** testes + **143** E2E), com os testes das fases anteriores intactos
* [x] Documentação da fase, README e `AGENTS.md` atualizados
