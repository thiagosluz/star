# FASE 45 — Equipe do evento na página pública

> **Pedido do humano, verbatim:** *"mais uma modificação que precisamos, é que os organizadores
> apareçam na pagina publica do evento, em um Blocos que o organizador pode colocar ou não,
> tipo esse exemplo que enviei aqui"* — com a imagem de uma grade de retratos, cada um com a
> **etiqueta da área** ("Presidente", "Programação", "Logística e Infraestrutura / Mostra") e
> ícones de contato.
>
> **Decisões do humano:** o bloco mostra **as equipes do EVENTO**; **nome e equipe sempre**,
> **foto e contatos só com autorização da pessoa** (a matriz do perfil público da FASE 44).

---

## 1. Sumário executivo

A equipe já existia — a FASE 38 a criou para organizar as demandas internas — e **não tinha
vitrine**. Esta fase dá à mesma lista um bloco na página pública: um cartão por pessoa, o
**nome da equipe como etiqueta da foto** (que é exatamente o que o exemplo pedia), líder
primeiro, e o contato só saindo quando a **própria pessoa** autoriza.

### Entregas

| # | Entrega |
|---|---|
| 1 | **Bloco "Equipe do evento"** (`TEAM`) no editor da página: o organizador **adiciona ou não**, escolhe o título, o texto de apoio e, se quiser, **uma** equipe (como o bloco de patrocínio filtra por cota) |
| 2 | **O corpo do bloco é a equipe REAL** — as mesmas `event_teams` das demandas, lidas na renderização: quem sai da equipe sai da página, sem ninguém editar texto |
| 3 | **A etiqueta é o nome da equipe** e a ordem é explicável: equipe (A→Z) → **líder primeiro** → nome → id (o id no fim é o que torna a ordem estável entre requisições) |
| 4 | **Pessoa em duas equipes aparece UMA vez**, com as duas etiquetas juntas ("Logística e Infraestrutura / Mostra", como no exemplo) |
| 5 | **Nome e equipe são do evento; foto e contato são da pessoa**: a foto sai com o campo `Foto` público e o contato com o campo novo **`E-mail e redes sociais`** — que **nasce fechado** (ADR-139) |
| 6 | **Contatos no perfil da pessoa**: LinkedIn, Instagram, GitHub e YouTube (`user.publicSocialLinks`), validados por host e exibidos **na página do perfil e no cartão da equipe** — uma decisão, dois lugares |
| 7 | **Quem perdeu o vínculo com a instituição sai da vitrine** (a linha da equipe fica: o histórico do quadro depende dela) — o `user` é global e a RLS não segura isso |
| 8 | **A tela de equipes diz o que vai para a página pública**, com link para o perfil público de cada pessoa |
| 9 | **A demonstração passa a mostrar o bloco** (o seed adiciona "A equipe por trás do evento" à página do congresso, que já tem uma equipe com líder) |

### Números da fase

| | |
|---|---|
| Arquivos novos | **10** — 3 de código (regra da equipe, contatos públicos, leitura das equipes para o editor), 2 migrações, 3 de teste e esta documentação |
| Arquivos alterados | **15** — `schema.prisma`, domínio da página (tipo de bloco, rótulo, schema, descrição), repositório do evento, renderizador de blocos, campos do bloco, valores do bloco, action da página, editor da página, tela de equipes, regras do perfil, serviço do perfil, action do perfil, tela do perfil público e página pública do perfil, além do seed |
| Migrações | **2** — `user.publicSocialLinks` (JSONB) e o valor `TEAM` em `PageBlockType` (39 → **40**) |
| Tabelas de tenant | **55** (nenhuma nova) |
| Permissões | **66** (nenhuma nova: o bloco usa `page:manage`, que já existe) |
| Testes novos | **30** — 16 unitários, 12 de integração e **2 E2E** (a suíte vai de **2272** para **2300**; o E2E, de **150** para **152**) |
| Defeitos reais encontrados | **2 de produto** — o **leitor de contatos que não era tolerante** (§5.1) e o **campo novo obrigatório que quebrou chamadas existentes** (§5.2) — **+ 2 de teste** (§5.3 e §5.4) |
| Dívidas quitadas | **nenhuma** — a fase não estava amarrada a dívida |
| Dívidas novas | **2** — **E63** (o bloco não tem ordem manual) e **E64** (quem está na equipe aparece com o nome, sem opt-out próprio) |
| Armadilhas novas | **0** — a fase anda em cima de armadilhas conhecidas (75, valor sem leitor; a régua do consentimento que nasce ligado) |
| ADRs | **244 … 247** (a próxima é 248) |

---

## 2. O problema mais difícil da fase

### 2.1 Duas verdades sobre a mesma pessoa

A pessoa aparece na página pública de duas formas: **como ela quer ser vista** (o perfil da
FASE 44, com quinze campos de visibilidade que ela mesma escolhe) e **como o evento a
apresenta** (a equipe, que o organizador cadastra). Misturar as duas é o erro fácil: ou o
organizador ganha o poder de publicar a foto e o e-mail de alguém, ou a pessoa ganha o poder
de apagar o próprio nome da equipe que a organiza.

O desenho separa pelo **tipo de informação**:

| Dado | De quem é a decisão | Por quê |
|---|---|---|
| Nome, etiqueta (nome da equipe), ordem, líder | **Do evento** | É a mesma informação do crachá e da camiseta da equipe: quem organiza precisa poder dizer quem organiza |
| Foto, e-mail, LinkedIn, Instagram, GitHub, YouTube | **Da pessoa** | É dado pessoal de contato, publicado na internet aberta |

Consequência prática: um cartão pode mostrar "Diego Programação" com as **iniciais** no lugar da
foto e **sem um único ícone** — e isso não é um cartão quebrado, é o cartão de alguém que não
autorizou. A tela de equipes explica isso antes de o organizador estranhar.

### 2.2 O `user` é global, e a equipe não é

A linha que liga uma pessoa a uma equipe (`event_team_members`) **não é apagada** quando a
pessoa é removida da instituição (FASE 21): o quadro de demandas depende dela para o histórico,
e apagar a linha reescreveria o passado do trabalho. Mas a página pública não pode continuar
exibindo o nome e a foto de quem não trabalha mais aqui — e a RLS **não segura isso**, porque
`user` é global (a mesma armadilha que a ficha 360 e o perfil público documentam).

A guarda é uma leitura explícita: só entra quem tem **vínculo ativo nesta instituição**. É um
teste de integração, não um comentário: a pessoa removida perde o cartão, e a linha dela
continua no banco.

### 2.3 Um valor sem leitor, do lado do contato

A FASE 45 acrescenta o campo `contacts` (e-mail e redes). Um campo novo de privacidade precisa
nascer **fechado** e precisa ter **leitor** nos dois lugares onde a pessoa aparece — senão a
tela mostra um interruptor que não faz nada (armadilha 75). Por isso a fase toca a página
pública do perfil **e** o cartão da equipe, e há teste garantindo que o mesmo consentimento
acende os dois.

---

## 3. Decisões técnicas

### 3.1 O bloco guarda decoração e filtro; o corpo é lido na renderização

`TEAM` segue a régua do bloco de chamadas (ADR-168): o conteúdo gravado é `{ title?,
description?, teamId? }`, e a lista de pessoas vem do banco na hora de renderizar. Copiar nomes
para dentro do bloco é a tentação que "economiza uma consulta" e continua mostrando quem saiu
da equipe em março.

### 3.2 A ordem é derivada, e é estável

Equipe (A→Z) → líder primeiro → nome (pt-BR) → id. Três decisões dentro de uma:

* **por equipe** e não por ordem de cadastro: a vitrine fica legível e cada equipe aparece
  junta, como no exemplo (`Presidente`, `Programação`, `Logística…`);
* **líder primeiro**: é a única hierarquia que o sistema conhece (`isLead`, um por equipe);
* **id no fim**: sem ele, duas pessoas com o mesmo nome trocam de lugar entre requisições — a
  mesma família da armadilha 96 (chave que empata).

### 3.3 Foto e contato passam pela régua do perfil — inclusive `ATTENDEES_ONLY`

O cartão pergunta à matriz da pessoa, não decide sozinho. `avatar` público → foto; `contacts`
público → e-mail e redes. **`ATTENDEES_ONLY` não vale no bloco**: a página do evento é pública e
não conhece o visitante, então "só quem participa" vira ausência (e não um vazamento). É a
diferença entre uma regra conservadora e uma regra que finge saber quem está olhando.

### 3.4 O contato vive na PESSOA, não no vínculo

`publicSocialLinks` está em `user` (global), e não em `event_team_members`. A pergunta "onde as
pessoas me encontram?" tem uma resposta só, e ela vale no perfil público e em **todas** as
equipes de **todos** os eventos. Gravar por vínculo faria a pessoa preencher o mesmo LinkedIn
em cada evento em que entra — e as cópias divergiriam.

### 3.5 O que ficou de fora, de propósito

| Item | Por que não entrou |
|---|---|
| **Ordem manual dos cartões** | A ordem derivada resolve o caso comum; arrastar cartões exige guardar a ordem (e um bloco que guarda ordem de PESSOAS envelhece quando alguém sai). Declarado como **E63** |
| **Opt-out individual do nome** | O humano escolheu "nome e equipe sempre" (é informação do evento). A pessoa que não quiser aparecer pede para sair da equipe — o que é uma decisão de operação, e não um interruptor. Declarado como **E64**, com o caminho (um campo por vínculo) escrito |
| **Cargo livre por pessoa** ("Diretora de Marketing") | A etiqueta é o nome da EQUIPE, que já é o rótulo que a instituição usa em todo o resto (demandas, quadros, avisos). Um cargo livre por vínculo criaria uma segunda taxonomia para a mesma pessoa |
| **Fotos próprias da equipe** (diferentes da foto do perfil) | A foto é a da pessoa; permitir outra faria a instituição publicar uma imagem que ela não escolheu |
| **Telefone/WhatsApp** | Contato direto de voz é o dado mais sensível do conjunto; e-mail e rede social já resolvem o "como falar com quem organiza" |

---

## 4. ADRs

### ADR-244 — A equipe da página é a MESMA `EventTeam` das demandas

**Contexto.** O organizador já cadastra equipes por evento (FASE 38) para distribuir trabalho.
A página pública precisa de "quem organiza", e a saída fácil seria um cadastro novo — mais
campos, mais uma tela, e duas listas de pessoas que divergem na primeira mudança.

**Decisão.** O bloco `TEAM` lê `event_teams` + `event_team_members` (só equipe **ativa** e só
vínculo **ativo** com a instituição). O nome da equipe é a etiqueta do cartão; `isLead` decide
quem vem primeiro. A tela de equipes ganhou uma frase dizendo que essa lista também aparece na
página pública.

**Justificativa.** É a mesma régua dos palestrantes desde a FASE 17/25: o corpo de um bloco que
espelha a operação é DADO, e não texto. Quem organiza o evento com a equipe não deve ter de
digitar os nomes de novo para mostrar que organiza.

**Consequências.** (a) Equipe desativada sai das duas coisas ao mesmo tempo; (b) criar equipe
virou ato com consequência pública, e a tela diz isso; (c) o líder é a única hierarquia exibida.

### ADR-245 — Nome e equipe são do evento; foto e contato são da pessoa

**Contexto.** Publicar a equipe na internet envolve dado pessoal. Dois extremos são tentadores:
deixar o organizador publicar tudo (rápido, e é o erro que a FASE 22 corrigiu com consentimento
que nascia ligado) ou exigir que cada pessoa autorize o próprio nome (correto na privacidade e
inviável na operação — o bloco ficaria vazio até todo mundo lembrar de configurar).

**Decisão.** O bloco publica **sempre** nome e etiqueta (informação do evento, como o crachá) e
**só com autorização** foto e contatos, lendo a matriz de visibilidade do perfil público
(`avatar` e o novo campo `contacts`, que nasce `PRIVATE`). O `contacts` publica o **e-mail de
conta** e as quatro redes; `website`, Lattes e ORCID continuam nas colunas próprias do perfil,
para não haver duas fontes do mesmo link.

**Justificativa.** Consentimento é sobre o que é da pessoa. O que ela faz no evento (estar na
equipe) é fato público do evento; como falar com ela é decisão dela. E o mesmo interruptor vale
no perfil e na vitrine: uma decisão, dois lugares — em vez de dois consentimentos que podem
divergir.

**Consequências.** (a) Cartão sem foto mostra **iniciais** (nunca um buraco); (b) `ATTENDEES_ONLY`
não vale no bloco (a página é pública); (c) autorizar contato no perfil liga o ícone em todos os
eventos em que a pessoa estiver numa equipe — o que é coerente, e está dito na tela.

### ADR-246 — Quem perdeu o vínculo com a instituição sai da vitrine (a linha da equipe fica)

**Contexto.** `event_team_members` guarda quem estava na equipe, e a remoção de um membro da
instituição (FASE 21) **não** apaga essa linha: o quadro de demandas, os cartões atribuídos e o
histórico do trabalho continuam apontando para ela. Só que a página pública passaria a exibir o
nome e a foto de quem não trabalha mais aqui.

**Decisão.** A leitura da vitrine exige **vínculo ativo** (`user_tenant_profiles` com
`status = ACTIVE` e `deletedAt` nulo) na instituição do evento. Conta excluída também fica de
fora.

**Justificativa.** O `user` é global e a RLS não o protege: sem essa checagem, "a pessoa saiu da
instituição" não teria efeito nenhum na internet. É a mesma guarda de pertencimento que o perfil
público faz (ADR-237), aplicada ao vínculo.

**Consequências.** (a) A vitrine e o quadro de demandas passam a discordar de propósito — um
mostra o trabalho, o outro mostra quem trabalha ali hoje; (b) recontratar a pessoa a traz de
volta ao cartão sem nenhuma ação; (c) há teste de integração prendendo as duas metades.

### ADR-247 — O contato é uma coluna JSON na pessoa, validada por host

**Contexto.** O perfil do palestrante (FASE 25) já guarda `socialLinks` como JSON com allowlist
de host por rede. A pessoa (não o palestrante) não tinha onde guardar as próprias redes: site,
Lattes e ORCID têm colunas desde a FASE 44, e LinkedIn/Instagram/GitHub/YouTube não existiam.

**Decisão.** `user.publicSocialLinks` (JSONB, `{}` por padrão) com **quatro** redes, validadas
pelo domínio no mesmo formato do palestrante (`https://` assumido quando falta o esquema,
`@usuario` expandido no Instagram e no YouTube, só http(s) de host conhecido, escrita estrita e
**leitura tolerante**). A decisão de publicar é o campo `contacts` da matriz.

**Justificativa.** Uma tabela de links traria junção, ordenação e RLS para um dado lido sempre
junto do perfil, com conjunto de redes fechado no código. E a régua de host **não** foi
reimplementada: duplicar a lista deixaria uma rede sair da outra em silêncio, com o rótulo
"LinkedIn" apontando para um domínio que ninguém confere.

**Consequências.** (a) A leitura descarta **rede a rede** (um valor ruim não apaga os outros);
(b) `@usuario` é aceito onde é endereço de verdade; (c) quatro redes agora, e acrescentar uma
exige tocar domínio, tela, bloco e teste — de propósito.

---

## 5. Lições aprendidas — defeitos REAIS encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | **Um link estragado apagava TODAS as redes do contato** — a página mostrava o cartão sem nenhum ícone, mesmo com LinkedIn válido gravado | `readPublicContacts` (leitura) delegava para `sanitizePublicContacts` (escrita), e a escrita recusa o **conjunto** quando encontra um valor ruim: o `{ ok: false }` virava `{}`. O comentário do código prometia tolerância que o código não tinha — **achado pelo teste unitário**, que comparou o valor lido com o gravado | A leitura passou a validar **rede a rede** (só o valor ruim some), como o `readSocialLinks` do palestrante faz desde a FASE 25. O teste ficou: `linkedin` válido + `github` inválido ⇒ o LinkedIn continua |
| 2 | **15 testes da FASE 44 quebraram com `TypeError: Cannot read properties of undefined`** ao rodar a suíte inteira, depois do campo novo | O campo `contacts` entrou **obrigatório** no contrato de `savePublicProfile`, e as chamadas antigas não o passavam. O `npm run typecheck` **não pega isso**: ele cobre `src/**` e `prisma/**`, e **`tests/**` está fora do `include`** — o contrato só quebra em tempo de execução | Duas correções: o domínio passou a aceitar entrada ausente (`sanitizePublicContacts` nunca lança) e o campo virou **opcional com "ausente preserva"** — a mesma régua do `taxId` do patrocinador (FASE 17), porque mapa vazio LIMPA e omissão não pode apagar contato de ninguém. **Lição de processo:** mudar contrato de serviço exige rodar a suíte, não só o `typecheck` |
| 3 | **O E2E esperava 60 s por um campo "Título" que existia com outro nome** | O rótulo do título é **"Título da seção"** para quase todo tipo de bloco, e "Título" só no bloco de texto livre (onde o padrão é outro). O teste apontava para o texto genérico | O teste passou a usar o rótulo REAL — que sai do mesmo componente que o servidor usa para validar. **Lição:** localizador de teste que "adivinha" o rótulo mede a imaginação de quem escreveu o teste |
| 4 | **O E2E verificava o LinkedIn no "primeiro link" do cartão e encontrava o `mailto:`** | A ordem dos ícones no cartão é e-mail **e depois** as redes — e a asserção por POSIÇÃO amarrou o teste a uma decisão de layout que não é o que ele quer provar | A asserção passou a ser por **seletor** (`a[href*="linkedin.com"]`) e ganhou uma a mais: o e-mail **não** aparece como texto solto no cartão (só no `href`/`title` do ícone) |

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 101 arquivos · 2300 testes passando
npm run build ..................... ✓ Compiled successfully
npm run db:verify ................. Contrato íntegro.
npm run db:verify:isolation ....... 9/9 verificações passaram.
npm run db:partitions ............. partições do mês atual e dos seguintes garantidas
npx prisma migrate status ......... 40 migrations found · Database schema is up to date!
npm run db:seed ................... ✓ 7 blocos na página do congresso (com o bloco de equipe)
npm run test:e2e .................. 152 passed
npx playwright test tests/e2e/event-team-block.spec.ts
                                   → 2 passed · o organizador põe o bloco e a equipe aparece
                                     com a etiqueta; o contato autorizado acende o ícone
```

### 6.1 O que os testes unitários provam (16)

1. equipe **inativa** sai da vitrine — junto com quem só está nela;
2. pessoa em duas equipes aparece **uma vez**, com as duas etiquetas;
3. a ordem é equipe → líder → nome → id, e **repetir a montagem devolve a mesma sequência**;
4. o líder de qualquer equipe do bloco fica à frente;
5. o filtro por equipe mostra só aquela equipe;
6. o teto de cartões existe (equipe de 400 pessoas não é vitrine, é lista);
7. **foto** só com `avatar` público — e `ATTENDEES_ONLY` não vale em página pública;
8. **contato** só com o campo próprio autorizado, e o padrão do campo é `PRIVATE`;
9. o nome do campo de contato existe na matriz (renomear quebra o teste em vez de vazar);
10. contatos: host conhecido, `@usuario` expandido, `javascript:` recusado, vazio = ausente,
    e todos os motivos devolvidos de uma vez;
11. rede fora do perfil (`website`/`lattes`) é ignorada — elas têm coluna própria;
12. a **leitura** é tolerante (rede a rede) e não lança com entrada inválida;
13. `hasPublicContacts` e `teamInitials` (nome simples, composto e vazio).

### 6.2 O que os testes de integração provam (12)

1. `TEAM` está no catálogo de blocos, com rótulo, descrição, conteúdo padrão e schema;
2. o seletor do editor lista só equipe **ativa**, com a contagem de pessoas, e não mistura
   eventos nem instituições;
3. a vitrine chega com a etiqueta do nome da equipe e o líder marcado;
4. **quem perdeu o vínculo sai da página pública** — e a linha da equipe continua no banco;
5. a equipe de outro evento/instituição não contamina a página;
6. equipe desativada não aparece, e quem está nela e numa ativa aparece **uma vez**;
7. sem autorização, foto e contato não saem (nem o e-mail no JSON do payload);
8. autorizar o contato faz e-mail e redes chegarem à vitrine;
9. voltar para `PRIVATE` tira tudo da vitrine **e mantém o link gravado**;
10. `ATTENDEES_ONLY` não vale no bloco;
11. o mesmo consentimento produz o mesmo pacote no perfil público da pessoa.

### 6.3 O que o E2E prova (2)

1. o organizador **adiciona o bloco**, escreve título e texto de apoio, escolhe a equipe,
   **publica a página** — e um visitante **anônimo** vê a equipe com a etiqueta "Presidência",
   os dois nomes, nenhuma foto (ninguém subiu) e **nenhum ícone de contato**;
2. a pessoa autoriza LinkedIn + "E-mail e redes sociais" no próprio perfil: o contato aparece
   **na página dela** e **no cartão da equipe do evento**; ao voltar para privado, some dos dois.

---

## 7. Comandos operacionais

```bash
# O organizador monta a equipe e o bloco
/t/<slug>/administracao/eventos/<eventId>/equipes            # quem é a equipe (F38)
/t/<slug>/administracao/eventos/<eventId>/pagina             # "Equipe do evento" na lista de blocos

# A pessoa decide publicar o contato
/t/<slug>/meu-perfil-publico                                 # "Como falar com você" + visibilidade

# O que o visitante vê
/t/<slug>/eventos/<eventSlug>                                # bloco "Equipe do evento"
/t/<slug>/u/<handle>                                         # perfil da pessoa

# Conferir no banco o que a vitrine lê
psql "$DATABASE_URL" -c 'SELECT t.name, count(m.*) FROM event_teams t
  LEFT JOIN event_team_members m ON m."teamId" = t.id
  WHERE t."isActive" = true GROUP BY t.name'

psql "$DATABASE_URL" -c 'SELECT "name", "publicSocialLinks", "profileAudiences"->>'"'"'contacts'"'"' AS contato
  FROM "user" WHERE "publicSocialLinks" <> '"'"'{}'"'"'::jsonb'
```

---

## 8. Dívidas técnicas e pontos de atenção

* **E63 (nova) — não há ordem manual dos cartões.** A ordem é derivada (equipe, líder, nome), e
  é o que dá conta do caso comum. Quem quiser "a presidente primeiro, depois a diretoria na
  ordem que eu decidir" não tem como — e o caminho não é trivial: guardar ordem de PESSOAS num
  bloco faz a lista envelhecer em silêncio quando alguém sai (a posição 3 vira a 4 e ninguém
  percebe). O caminho é a ordem por EQUIPE (um campo em `event_teams`) mais o líder já
  existente, com a mesma régua da FASE 38.
* **E64 (nova) — quem está na equipe aparece com o nome, sem opt-out próprio.** O consentimento
  cobre foto e contato; o NOME é informação do evento (decisão do humano). A pessoa que não
  quiser aparecer precisa pedir para sair da equipe. O caminho é um campo por vínculo
  (`showOnPublicPage`, padrão LIGADO, já que a equipe é pública por natureza) com a tela de
  equipes mostrando quem está oculto — e a decisão de negócio a tomar é se a instituição pode
  reverter isso.
* **A etiqueta acumula quando a pessoa está em muitas equipes.** Duas viram "A / B" (como no
  exemplo do humano); quatro viram uma faixa ilegível sobre a foto. O corte (mostrar duas e
  "mais 2") é apresentação, e ainda não existe.
* **O bloco não diz quantas pessoas ficaram de fora do teto.** `TEAM_CARD_LIMIT` (60) corta em
  silêncio: uma equipe maior perde gente na página e ninguém é avisado. O caminho é a mesma
  contagem explícita que o lote de certificados usa (`x-certificados-fora-do-lote`).
* **`contacts` publica o e-mail da CONTA.** Quem usa um endereço pessoal no cadastro e prefere um
  institucional na vitrine não tem campo separado: ou publica o da conta, ou não publica nada.
  Um "e-mail de contato" próprio é o caminho, e ele traz de volta a pergunta de verificação
  (FASE 15) — endereço publicado sem prova de posse é convite a erro.
* **`npm run typecheck` não cobre `tests/**`.** Foi o que deixou a lição 2 passar do compilador
  para a suíte. Incluir os testes no `tsc` é uma decisão de custo (o `next build` compila o
  app, não as specs) — mas é o único jeito de o contrato de um serviço quebrar no editor em vez
  de no `npm test`.
* **O bloco não tem renderizador próprio para "equipe sem membros".** Ele desaparece (como o de
  patrocinadores sem patrocinador) e o editor diz "Equipe do evento" no resumo — mas o
  organizador que criou equipe e não vê nada na página depende do texto de ajuda para entender.

---

## 9. Checklist de aceite

* [x] O organizador **adiciona ou não** o bloco de equipe na página do evento
* [x] O bloco mostra **as equipes do evento** (a mesma lista das demandas), sem segundo cadastro
* [x] A **etiqueta** de cada pessoa é o nome da equipe, e a pessoa em duas equipes aparece
      **uma vez** com as duas etiquetas
* [x] **Líder primeiro**, ordem estável e explicável (equipe → líder → nome → id)
* [x] Só equipe **ativa** e só vínculo **ativo** com a instituição entram na vitrine
* [x] **Nome e equipe sempre**; **foto e contatos só com autorização da pessoa**
* [x] Sem foto o cartão mostra **iniciais**; sem autorização não sai **nenhum** ícone
* [x] O campo de contato (`E-mail e redes sociais`) **nasce fechado** (ADR-139)
* [x] O mesmo consentimento vale **no perfil público e no cartão da equipe**
* [x] Contatos validados por host, `@usuario` aceito, `javascript:` recusado, e a leitura é
      **tolerante rede a rede**
* [x] O bloco guarda só **decoração e filtro**: o corpo é lido na renderização
* [x] O filtro "mostrar apenas uma equipe" funciona, com a contagem no seletor
* [x] A tela de equipes **avisa** que a lista pode ir para a página pública
* [x] O bloco aparece na **demonstração** (seed) e na bateria de E2E
* [x] Toda a suíte verde (**2300** testes + **152** E2E), com os testes das fases anteriores
      intactos
* [x] Documentação da fase, README, `AGENTS.md` e dívidas (E63, E64) atualizados
