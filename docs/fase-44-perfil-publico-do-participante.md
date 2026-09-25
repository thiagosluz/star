# FASE 44 — Perfil público do participante

> **Pedido do humano, verbatim:** *"criar um perfil publico do participante, onde ele
> escolheria se quer ser publico ou não, escolheria o username, dados, mostraria o seu xp, o
> nivel que ele está, as cartas conquistadas, palestras e eventos que participou, seus
> principais interesses, e demais coisas para gamificar e tornar interessante para o
> participante"*.
>
> **Decisões do humano:** as escolhas são **campo a campo** (três níveis), e o perfil é
> **por instituição com um `@handle` global**.

---

## 1. Sumário executivo

A fase dá **dono** ao perfil que existia pela metade: `publicHandle`, `bio`, `headline`,
`orcidId`, `lattesId` e `isPublicProfile` estavam no modelo desde as primeiras fases e **não
tinham tela nem leitor** (a `bio` e o `headline` não eram lidos por ninguém). Agora existe o
lugar onde a pessoa decide — e a página onde a decisão aparece.

### Entregas

| # | Entrega |
|---|---|
| 1 | **Tela "Meu perfil público"** (`/t/<slug>/meu-perfil-publico`): `@handle`, título, bio, interesses, site, ORCID e Lattes **de verdade** (os dois identificadores eram campos editáveis que ninguém gravava), escolha do evento a evento, diretório da instituição e buscadores |
| 2 | **Quinze campos, cada um com o próprio nível de visibilidade** — `PUBLIC` (qualquer pessoa na internet) · `ATTENDEES_ONLY` (só quem participa desta instituição) · `PRIVATE` (só eu) — com o vocabulário que o material do palestrante (FASE 25) já usava |
| 3 | **Página pública** (`/t/<slug>/u/<handle>`): identidade, nível, título de nível, prestígio, cartas em destaque, resumo da coleção, certificados com link de validação, interesses, links acadêmicos e os eventos que a pessoa autorizou |
| 4 | **O pacote é montado campo a campo** (`buildPublicProfile`), com uma **allowlist** (`PUBLIC_PROFILE_SHARE_KEYS`) e teste de igualdade: campo novo no modelo que não tenha decisão de visibilidade **reprova** em vez de vazar |
| 5 | **A página só existe onde a pessoa PARTICIPA** (vínculo ativo ou inscrição): o `user` é global e a RLS não o protege, então o `@handle` não pode ser uma janela para dentro de uma instituição onde a pessoa nunca esteve |
| 6 | **Perfil todo privado responde 404** — nunca "existe, mas você não pode ver": a segunda resposta já revelaria o handle que a pessoa decidiu não revelar |
| 7 | **`@handle` global e único sem diferenciar maiúscula** (índice parcial `lower("publicHandle")`), com **palavras reservadas** (as rotas da própria plataforma) e **espera de 30 dias** entre trocas — troca de verdade, não salvar o mesmo handle |
| 8 | **Ordem e honestidade**: XP, dias seguidos, coleção, lista de eventos e posição relativa são `ATTENDEES_ONLY` por padrão; identidade, nível, cartas fixadas, certificados, interesses, links e contagem de eventos são `PUBLIC`; **diretório e buscadores nascem DESLIGADOS** |
| 9 | **Consentir não paga XP**: nenhum fato de gamificação é emitido ao publicar o perfil (a FASE 42 estabeleceu que consentimento não é pedágio) |
| 10 | **A trilha guarda a DECISÃO, não o conteúdo**: quem divulgou quais campos, quando, e a leitura de perfil alheio entra como `READ` — a bio e o ORCID **não** são copiados para a auditoria |
| 11 | **A dívida E35 está quitada**: existe o caminho de interface para quem quer se identificar (era o item aberto desde a FASE 22) |

### Números da fase

| | |
|---|---|
| Arquivos novos | **10** — 6 de código (domínio, serviço, action, 2 páginas e a migração), 3 de teste (unitário, integração e E2E) e esta documentação |
| Arquivos alterados | **8** — `schema.prisma`, permissões, `auth.ts` (campos de saída), `admin-form.tsx`, navegação, `README.md`, `AGENTS.md` e dívidas técnicas |
| Migrações | **1** — 7 colunas em `user` (`profileAudiences`, `publicInterests`, `publicSiteUrl`, `profileIndexable`, `usernameChangedAt`) e 2 em `user_tenant_profiles` (`listedInDirectory`, `publicEventIds`), mais o índice único `lower("publicHandle")` (38 → **39**) |
| Tabelas de tenant | **55** (nenhuma nova) |
| Permissões | 65 → **66** (`profile:manage:own`, pessoal, concedida a 7 papéis) |
| Testes novos | **46** — 26 unitários, 18 de integração e **2 E2E** (a suíte vai de **2228** para **2272**; o E2E, de **148** para **150**) |
| Defeitos reais encontrados | **4 de produto** (§5.1 a §5.4) **+ 3 de teste/fixture** (§5.5 a §5.7) — a **posição relativa invertida**, a **página aparecendo em instituição onde a pessoa nunca esteve**, os **dois campos de identificador acadêmico sem gravador**, o **rótulo duplicado** na tela de visibilidade, e três armadilhas de E2E (localizador por substring, cenário dependente de outro e base de uma pessoa só) |
| Dívidas quitadas | **1** — **E35** (a tela para autorizar o nome público, aberta pela FASE 22) |
| Dívidas novas | **3** — **E60** (não há mensagem entre participantes), **E61** (não há visão da pessoa entre instituições) e **E62** (não há moderação nem denúncia do que é público) |
| Armadilhas novas | **0** — a fase anda em cima de armadilhas conhecidas (75, do valor sem leitor; 58, do consentimento que nasce ligado) e do aviso da FASE 32 sobre o `user` global |
| ADRs | **236 … 243** (a próxima é 244) |

---

## 2. O problema mais difícil da fase

### 2.1 O `user` é global e a RLS não o protege

Este é o mesmo terreno da ficha 360 (FASE 32), e ele define o desenho. Duas decisões do
humano — "o `@handle` é global" e "o perfil é por instituição" — só convivem se a **página**
tiver uma guarda de pertencimento: sem vínculo nem inscrição naquela instituição, o perfil
**não existe** ali.

Sem essa guarda, o resultado é um vazamento silencioso e grave: o endereço
`/t/<qualquer-instituição>/u/<handle>` mostraria o nome, a foto, a bio e os interesses de
qualquer pessoa da plataforma — inclusive de quem nunca teve relação com aquela casa. A RLS
não impede, porque `user` não tem `tenantId`; o filtro que existiria por acidente não é um
filtro. **A guarda é de domínio (`evaluatePublicProfile`), não de banco**, e o teste de
integração com duas instituições de verdade é o que a prende.

O que fica global e o que fica por instituição:

| Dado | Onde vive | Por quê |
|---|---|---|
| `@handle`, bio, título, interesses, links, matriz de visibilidade, "achável em buscadores" | `user` (**global**) | É a pessoa: a decisão é uma só, e repetir a mesma escolha em N instituições só criaria divergência |
| Aparecer no diretório · quais eventos desta casa listar | `user_tenant_profiles` (**por instituição**) | É a participação: fazer parte da comunidade de uma casa não diz nada sobre outra |

### 2.2 Consentimento não é pedágio

A fase anterior (FASE 42) fixou a régua: o QR do patrocinador credita igual para quem
autoriza e para quem não autoriza, porque consentimento não pode ser comprado (LGPD art. 8º
§3º). Aqui a tentação é a mesma e o desenho é explícito: **publicar o perfil não dá XP**. Um
"bônus por ser público" colocaria quem quer privacidade em desvantagem no ranking — e
transformaria um direito em moeda. A vitrine tem moldura, nível e cartas; o ato de autorizar,
não.

Há um teste para isso (§6.3): publicar o perfil com **tudo** visível não muda o XP total nem
cria fato no livro-razão.

### 2.3 Interesse é declarado, nunca inferido

"Mostraria os seus principais interesses" tem duas leituras, e só uma é aceitável. Derivar
interesses do que a pessoa assistiu é criar **perfil comportamental** — dado inferido, e mais
sensível que o declarado, porque a pessoa não sabe que ele existe e não pode corrigi-lo. O
campo `publicInterests` é texto escrito pela pessoa, limitado a 6 itens, e o sistema **não
tem** caminho que escreva ali a partir de comportamento. A tela diz isso na cara do campo
("Escritos por você — o sistema não deduz interesse do que você assistiu").

---

## 3. Decisões técnicas

### 3.1 O pacote é montado campo a campo, com allowlist e teste de igualdade

`buildPublicProfile({ source, visibleFields })` recebe a **fonte completa** (tudo o que a
pessoa tem) e os campos autorizados, e devolve **só** o que passou pela régua. Os campos do
tipo de retorno são opcionais de propósito: a página é obrigada a tratar a ausência, em vez de
renderizar `undefined` no lugar de um dado que não foi autorizado.

`PUBLIC_PROFILE_SHARE_KEYS` existe para o **teste de igualdade**: com tudo autorizado, as
chaves do pacote são exatamente as 20 da lista. É a mesma família da lição da FASE 43 (um
valor novo sem leitor não reprovava nada): aqui, um campo novo no modelo que ninguém decidir
**reprova** em vez de sair sozinho.

### 3.2 404 é a resposta de um perfil privado

Perfil com todos os campos em `PRIVATE` (ou pessoa que não participa da instituição) devolve
`NOT_FOUND`, e não "existe, mas você não pode ver". A diferença importa: a segunda resposta
confirma a existência daquele `@handle` — e a existência é justamente o que a pessoa decidiu
não revelar. Pela mesma razão, a página é `noindex` por padrão e a instituição inexistente
responde o **mesmo** 404 de handle inexistente.

O dono é a exceção: ele vê sempre a própria página. É a **prévia** do que ele configurou, e sem
ela a tela de escolha seria um formulário às cegas. A volta é garantida: a página mostra o
aviso de prévia com o link para editar.

### 3.3 A matriz é de campo × visitante, e o visitante é classificado por POSSE e VÍNCULO

Três visitantes: `OWNER` (a própria pessoa), `AUDIENCE` (autenticado **com** vínculo ativo ou
inscrição na instituição) e `ANONYMOUS` (todo o resto — inclusive quem está logado em outra
instituição). O nível `ATTENDEES_ONLY` responde "só quem participa desta instituição", e a
régua é a mesma do material `ATTENDEES_ONLY` do palestrante (FASE 25), de propósito: a
plataforma tem um vocabulário só para "quem pode ver".

**Estar logado não é ser da casa.** É o primeiro mal-entendido possível da tela, e o teste de
integração o prende: uma pessoa autenticada sem vínculo com a instituição vê exatamente o que
o anônimo vê.

### 3.4 O `@handle` é o endereço, e por isso tem regras de endereço

Ele é único **globalmente** e a unicidade é **sem diferenciar maiúscula** — garantida por um
índice parcial (`WHERE "publicHandle" IS NOT NULL`) sobre `lower("publicHandle")`, porque
`Ana` e `ana` seriam a mesma pessoa para quem lê e duas para o banco. A normalização
(minúsculas, sem acento, hífen no lugar de espaço e símbolo) e a validação vivem no domínio; a
recusa de `TAKEN` consulta o banco e o **índice é a palavra final** (invariante 5: duas
pessoas podem confirmar no mesmo instante — a violação de unicidade é traduzida para a mesma
resposta).

Palavras **reservadas** não são preciosismo: `admin`, `api`, `painel`, `validar` e `u` são
rotas reais desta plataforma, e um perfil em `/t/<slug>/u/admin` confundiria gente e ferramenta.

Trocar de handle tem **espera de 30 dias**, e a espera é da TROCA: salvar o formulário sem
mexer no campo não consome nada (o serviço compara com o valor gravado antes de conferir o
prazo). O handle é o endereço do perfil — trocá-lo quebra todo link já compartilhado, e o prazo
impede que alguém "colecione" endereços que os outros já usam para chegar até ele.

### 3.5 O diretório nasce desligado, e ele não é o ranking

`listDirectoryProfiles` lista quem **ligou** o diretório naquela instituição **e** tem página
(al menos um campo não privado), ordenado por **`joinedAt`** e exibindo o **nível**, sem XP:
é um diretório de participação, não um pódio. Duas autorizações independentes, porque "ter
página" e "aparecer numa lista" são coisas diferentes.

### 3.6 A posição relativa sai como FATIA, nunca como ranking

O campo `standing` mostra "top 10% de 42 pessoas com XP". Ele é calculado contra a
instituição e nunca copiado do ranking: mostrar "você está em 3º" exige mostrar de quem são o
1º e o 2º, e essas pessoas não autorizaram nada. Sem base (menos de duas pessoas com XP) o
campo é `null`, e `null` não é "primeiro lugar" — a página simplesmente não mostra a linha.

### 3.7 O que ficou de fora, de propósito

| Item | Por que não entrou |
|---|---|
| **XP por publicar / completar o perfil** | Consentimento não é pedágio (§2.2) |
| **Interesses inferidos do comportamento** | Dado inferido é vigilância com outro nome (§2.3) |
| **Nome de exibição próprio (separado do cadastro)** | O nome da plataforma é o que vale em certificado, crachá e sorteio; um segundo nome criaria duas identidades para a mesma pessoa. A escolha aqui é **mostrar ou não** o nome do cadastro — e a privacidade do nome é do campo `Nome` |
| **Perfil de EQUIPE / institucional** | É outro produto: identidade da instituição, não da pessoa |
| **Mensagem entre participantes e "seguir"** | Redes sociais dentro do evento é outro escopo — declarado como dívida **E60** |
| **Moderação e denúncia do que é público** | Não há canal de denúncia de perfil nem de conteúdo — declarado como dívida **E62** |
| **Visão da pessoa entre instituições** | O `@handle` é global, mas não há um "hub" que reúna a participação em todas as casas — declarado como dívida **E61** |

---

## 4. ADRs

### ADR-236 — O perfil público é da PESSOA, e a decisão de quem vê é dela, campo a campo

**Contexto.** O modelo tinha `bio`, `headline`, `orcidId`, `lattesId` e `publicHandle` desde as
primeiras fases, e `isPublicProfile` desde a FASE 16 — nenhum com tela. O que existia era uma
decisão binária ("sou público") que não dizia **o que** era público, e a FASE 22 já havia
mostrado o custo disso: o campo nasceu `true` e o nome dos ganhadores saía completo por um
consentimento que ninguém deu (ADR-139, armadilha 58).

**Decisão.** Três níveis por campo (`PUBLIC`, `ATTENDEES_ONLY`, `PRIVATE`), com o mesmo
vocabulário do material do palestrante, e uma matriz gravada em `User.profileAudiences`. Os
padrões são conservadores: identidade, nível, cartas fixadas, certificados, interesses, links e
contagem de eventos são públicos; **XP, dias seguidos, coleção, lista de eventos e posição
relativa** são só para quem participa da instituição; **diretório e buscadores** nascem
desligados.

**Justificativa.** "Ser público" não é uma decisão só, é uma dúzia — e quem quer mostrar o
nível não necessariamente quer mostrar o número de XP. Padrão conservador com escolha ao
alcance é a única combinação que respeita quem não vai mexer na tela.

**Consequências.** (a) A tela tem 15 seletores; (b) a matriz é **global** (a decisão é da
pessoa, não de cada casa), enquanto o diretório e a lista de eventos são por instituição;
(c) `isPublicProfile` (nome no resultado do sorteio) **continua sendo outra decisão** — a
dívida E35 pedia a tela dela, e esta fase a quitou: a mesma tela traz o interruptor do nome
público no resultado.

### ADR-237 — A página pública só existe onde a pessoa participa

**Contexto.** O `@handle` é global, e a tabela `user` não tem `tenantId`: **a RLS não a
protege**. A FASE 32 já tinha documentado esse buraco para a ficha 360 ("o `user` é global", e
por isso a ficha confere o pertencimento antes de ler qualquer seção). A pergunta aqui é
literalmente a mesma, com uma diferença que agrava: a página é **pública**, sem login.

**Decisão.** `evaluatePublicProfile` recebe `belongsToInstitution` (vínculo ativo **ou**
qualquer inscrição não excluída na instituição) e responde `NOT_FOUND` quando é falso — para
anônimo e para quem é da casa. Exceção única: o **dono**, que vê a própria prévia.

**Justificativa.** Sem a guarda, o handle vira uma janela para o nome, a foto e a bio de
qualquer pessoa dentro do site de qualquer instituição. O filtro "que existiria por acidente"
não é um filtro, e a decisão do humano ("perfil por instituição") só é verdadeira se o perfil
de fato **não existir** onde a pessoa não está.

**Consequências.** (a) Quem participa de duas casas tem a mesma página em duas URLs, com os
dados daquela casa (eventos e diretório diferentes); (b) publicar o perfil antes de se
inscrever em qualquer evento não cria página — a inscrição é o que a cria; (c) a guarda é
consultada **antes** de qualquer leitura de conquista, então nem a consulta acontece onde a
página não existe.

### ADR-238 — Consentir não paga XP

**Contexto.** A gamificação tem um motor de fatos com chave de idempotência, e "completar o
perfil" é o tipo de coisa que plataformas costumam premiar. A FASE 42 já havia decidido o
contrário no caso do QR do patrocinador (autorizar ou não autoriza dá o MESMO crédito).

**Decisão.** Publicar, alterar a visibilidade ou completar o perfil **não emite fato nenhum**:
não há `XpSourceKind` para isso, e um teste de integração prende que o XP total e o livro-razão
não mudam depois de salvar o perfil com tudo visível.

**Justificativa.** LGPD art. 8º §3º: o consentimento deve ser livre, e um bônus por consentir
torna a recusa custosa. Num sistema com ranking, "pague 50 XP para ser público" é coação
econômica dentro do jogo.

**Consequências.** (a) Nenhuma obra de gamificação nova nesta fase; (b) a tela diz, em texto,
que publicar não dá XP — a pessoa não precisa deduzir; (c) se um dia houver premiação de
"perfil completo", ela terá de ser decidida explicitamente contra esta ADR.

### ADR-239 — Interesse é declarado, nunca inferido

**Contexto.** "Mostrar os principais interesses" pode ser lido como "deduza dos eventos e
atividades em que a pessoa esteve" — tecnicamente fácil (o sistema tem tudo) e juridicamente
outra coisa: dado inferido, que a pessoa não sabe que existe e não pode corrigir.

**Decisão.** `publicInterests` é lista escrita pela pessoa (até 6, sem repetição e sem caixa
duplicada). **Não existe** caminho que escreva ali a partir de comportamento, e a tela afirma
isso no campo.

**Justificativa.** Perfil comportamental é a fronteira entre personalização e vigilância. O
que a pessoa escreve é dela; o que o sistema deduz é do sistema — e quem não vê o dado não
pode consentir com ele.

**Consequências.** (a) A página mostra só o que foi declarado, e pode ficar vazia (a seção
simplesmente não aparece); (b) a moderação de conteúdo declarado **não existe** (dívida E62).

### ADR-240 — O pacote público é allowlist, e a allowlist tem teste de igualdade

**Contexto.** Uma página pública é o pior lugar para um vazamento por descuido: o dado sai para
a internet. A forma ingênua de montar o retorno (espalhar o objeto do banco e apagar o que é
privado) erra por omissão — basta um campo novo no modelo.

**Decisão.** Montagem **explícita** campo a campo (`SHARE_KEYS_BY_FIELD`), a partir da lista de
campos autorizados; tipo de retorno com **todos os campos opcionais**; e um teste de igualdade
entre as chaves do pacote completo e `PUBLIC_PROFILE_SHARE_KEYS`.

**Justificativa.** Erro por omissão vira erro de compilação/teste em vez de vazamento. A mesma
régua da FASE 43 com os mapas de rótulo fechados pelo tipo: o valor novo que ninguém decidiu
**reprova**.

**Consequências.** (a) Acrescentar um campo ao perfil exige três edições conscientes (lista de
campos, mapa de chaves, allowlist) — de propósito; (b) a página não tem `if` de visibilidade:
ela renderiza o que chegou, e o que não chegou não existe.

### ADR-241 — `@handle` global, único sem diferenciar maiúscula, com espera entre trocas

**Contexto.** O handle é o **endereço** da página e a identidade da pessoa em todas as
instituições (decidido pelo humano). A coluna existe desde a FASE 16 com índice `@unique`
sensível a caixa.

**Decisão.** Unicidade **global** garantida por índice parcial sobre `lower("publicHandle")`;
normalização e validação no domínio; lista de palavras reservadas (as rotas da plataforma);
**30 dias** entre trocas, medidos a partir de `usernameChangedAt`, e handle igual ao atual não
conta como troca.

**Justificativa.** `Ana` e `ana` são a mesma pessoa para quem lê o endereço — e duas para o
banco, o que permitiria a um terceiro se passar por alguém. As reservadas evitam colisão com
rotas reais. A espera protege os links já compartilhados e impede a "coleção" de endereços.

**Consequências.** (a) O índice parcial tem de ser criado por migração escrita à mão (o Prisma
não expressa `lower()`); (b) o handle antigo **não** redireciona — vira 404 (não há apelido
histórico, e a tela avisa); (c) o índice é a palavra final em corrida, com a violação de
unicidade traduzida para `USERNAME_TAKEN`.

### ADR-242 — Perfil privado responde 404, e o mesmo 404 de perfil inexistente

**Contexto.** Um `@handle` reservado é informação: confirma que aquela pessoa está na
plataforma. A tela oferecia duas respostas possíveis para "perfil todo privado": "não existe" ou
"existe, mas você não pode ver".

**Decisão.** `NOT_FOUND` — o **mesmo** corpo e o mesmo status de um handle inexistente,
inclusive quando a instituição do endereço não existe. O dono vê a própria página sempre.

**Justificativa.** A segunda resposta entrega o que a pessoa decidiu esconder. É a régua do
material do palestrante e das rotas de licitação equivalente: negar não pode informar.

**Consequências.** (a) Não há "modo visitante" para o dono ver como anônimo — a página dele
sempre mostra tudo (a prévia é o que ele configurou); o que ele vê é a página real, com os
campos que os outros veriam **mais** os privados; (b) `generateMetadata` responde `noindex`
quando o perfil não é acessível, para não deixar rastro.

### ADR-243 — O diretório e a lista de eventos são POR INSTITUIÇÃO; a matriz é uma só

**Contexto.** Duas decisões do humano se cruzam: "o `@handle` é global" e "o perfil é por
instituição". Era preciso escolher onde cada dado mora.

**Decisão.** `listedInDirectory` e `publicEventIds` vivem em `user_tenant_profiles` (**por
instituição**); handle, bio, título, interesses, links, matriz de visibilidade e "achável em
buscadores" vivem em `user` (**global**). Os eventos escolhidos são validados contra as
inscrições **daquela** instituição — id de outro tenant é descartado em silêncio.

**Justificativa.** A pessoa é uma; a participação é que é de cada casa. "Aparecer no diretório
da comunidade X" é uma escolha sobre a comunidade X, e "quais eventos mostrar" é
necessariamente por casa (a pessoa não participou do mesmo evento em todas). Já a bio e a
visibilidade do XP são sobre ela — repetir a escolha N vezes só criaria divergência entre
cópias da mesma decisão.

**Consequências.** (a) A tela avisa onde cada decisão vale (a matriz é uma, a lista de eventos
é "desta instituição"); (b) um evento de outra instituição não entra nem por chamada direta ao
serviço; (c) trocar de instituição na navegação muda o diretório e a lista de eventos, e não o
perfil.

---

## 5. Lições aprendidas — defeitos REAIS encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | **A posição relativa saía INVERTIDA: o primeiro colocado via "top 100%" e o último "top 1%"** — achado ao escrever o teste unitário de `standingFromRank` | O serviço contava as pessoas com **mais** XP (`totalXp: { gt: … }`) e passava o número como `betterThan` para uma fórmula que esperava "quantos eu supero" (`(total - betterThan) / total`). Os dois lados estavam coerentes **consigo mesmos** e errados juntos: `Nível 1` de uma pessoa no topo aparecia como top 100% | A consulta passou a contar quem tem **menos** XP (`lt`), o parâmetro ficou documentado com o significado exato na assinatura e um teste prende a **monotonicidade** (superar mais gente nunca piora a fatia). O teste de integração confere o número contra o banco (400/100/50 XP ⇒ top 34%) |
| 2 | **A página pública apareceria em instituição onde a pessoa NUNCA participou** (nome, foto e bio dela dentro do site de outra casa) — encontrado ao desenhar o teste de isolamento entre duas instituições | O `user` é global e a busca por `publicHandle` acontece sob o contexto do tenant, mas o `user` **não tem `tenantId`**: a RLS não filtra nada ali. A primeira versão do serviço só olhava a matriz de visibilidade, e a matriz de ana (público) valia para qualquer endereço de instituição | Entrou a guarda de pertencimento no domínio (`belongsToInstitution`, ADR-237), com um teste de integração de duas instituições: o MESMO handle responde 404 na casa onde a pessoa não participa, para anônimo e para quem é da casa |
| 3 | **Os campos de ORCID e Lattes eram editáveis na tela e o serviço não os gravava** — a pessoa preenchia, salvava, e o dado sumia sem aviso (achado ao escrever o teste de integração) | O `SavePublicProfileInput` **não tinha** os dois campos: o formulário os mandava, a action os descartava e o serviço escrevia só headline/bio/interesses/site. A coluna `user.orcidId` era lida por três lugares e **não tinha escritor nenhum** desde o começo (família da armadilha 75) | Os dois entraram no contrato do serviço, com validação de formato no domínio (`normalizeOrcidId`/`normalizeLattesId`): vazio **limpa**, inválido **recusa com o formato esperado** — nunca descarta em silêncio. O E2E confere a gravação no banco |
| 4 | **Dois controles com o MESMO nome acessível na mesma página**: "Título profissional" e "Sobre você" nomeavam o campo de texto **e** o seletor de visibilidade — o E2E parou com `strict mode violation` | O seletor de visibilidade usava o rótulo do campo direto (`PUBLIC_PROFILE_FIELD_LABELS`), e o mesmo texto nomeava o campo de conteúdo logo acima. Para quem usa leitor de tela, dois alvos com o mesmo nome são indistinguíveis | O seletor passou a se chamar `Visibilidade: <campo>`, o que resolve o leitor de tela e a leitura da tela **e** o localizador. **É o tipo de defeito que só aparece quando um teste precisa APONTAR para o controle** — nenhum teste anterior apontava |
| 5 | **`getByLabel('Título profissional')` continuava resolvendo DOIS elementos depois do prefixo** — o E2E morria na primeira tentativa de preencher o campo | O `getByLabel` do Playwright casa por **substring**, e `Visibilidade: Título profissional` contém `Título profissional`. O prefixo resolveu o problema de acessibilidade, mas **não** o do localizador: o teste é que precisava pedir casamento exato | `getByLabel(..., { exact: true })` nos três rótulos que colidem (título, bio e ORCID), com o comentário dizendo por quê. **Lição de teste:** rótulo que é prefixo de outro rótulo é armadilha de localizador — e a asserção precisa ser explícita sobre o que quer |
| 6 | **O segundo cenário do E2E clicava em "Salvar" e nada acontecia** — nenhuma requisição, nenhuma mensagem, 30 s de espera | O cenário dependia do handle que o **primeiro** teste gravaria; como o primeiro falhava antes de salvar (lição 4), o campo `@handle` estava vazio e o `required` do HTML **bloqueou o envio sem requisição** — o sintoma foi "cliquei e não aconteceu nada", exatamente o padrão da dívida E50 | O cenário preenche o handle por conta própria (e agora mede o 404, que é o que ele quer medir). **Lição:** cenário de E2E não pode depender do que outro deixou no banco — o teste que passa "por sorte de ordem" reprova no dia em que a ordem muda |
| 7 | **A seção de posição relativa não aparecia nem para quem é da casa** (`profile-standing` ausente) | A fixture tinha **uma só** pessoa com XP na instituição, e `standingFromRank` devolve `null` quando a base é de uma pessoa — de propósito: "top 1% de 1" não é posição, é eco. O produto estava certo e o cenário, pobre | A fixture passou a criar o perfil de XP do **visitante também** (duas pessoas na base), e o comentário no teste explica que a posição só existe a partir de duas |

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 99 arquivos · 2272 testes passando
npm run build ..................... ✓ Compiled successfully (a rota /t/[tenantSlug]/u/[username] listada)
npm run db:verify ................. Contrato íntegro.
npm run db:verify:isolation ....... 9/9 verificações passaram.
npm run db:partitions ............. partições do mês atual e dos seguintes garantidas
npm run db:verify:pooling ......... Pooling íntegro: contexto por transação preservado sob PgBouncer.
npx prisma migrate status ......... 39 migrations found · Database schema is up to date!
npm run db:seed ................... ✓ (7 cartas, 6 missões e os fatos de XP; 13 versões no histórico)
npm run test:e2e .................. 150 passed
npx playwright test tests/e2e/public-profile.spec.ts
                                   → 2 passed · a pessoa publica o perfil e cada visitante vê o
                                     que foi autorizado; perfil privado responde 404
```

### 6.1 O que os testes unitários provam (26)

1. com tudo autorizado, as chaves do pacote são **exatamente** a allowlist;
2. com só `level` e `pinnedCards`, a chave do XP **não existe** no retorno (não é `undefined`
   atribuído: a chave não está lá);
3. o `@handle` entra sempre — é o endereço da página;
4. sem nome de cadastro, o nome exibido é o próprio `@handle`;
5. **anônimo** vê `PUBLIC`; **quem participa** vê também `ATTENDEES_ONLY`; **o dono** vê tudo;
6. tudo privado ⇒ `pageVisible: false` para os outros e `true` para o dono;
7. **sem pertencimento à instituição ⇒ página não existe** (anônimo e da casa), e o dono
   continua vendo a prévia;
8. a matriz gravada é tolerante: campo desconhecido ou valor inválido cai no padrão, e o
   objeto resultante tem sempre os 15 campos;
9. normalização do handle (acento, espaço, caixa, hífen) e as recusas (curto, longo, vazio,
   reservado);
10. a espera de 30 dias: primeira troca livre, troca recente bloqueada com dias restantes,
    troca vencida liberada;
11. interesses: sem repetição, sem duplicata de caixa, com teto de 6 e descarte do que é curto
    ou longo demais;
12. site só `http`/`https` (`javascript:` nunca vira link) e identificadores acadêmicos com
    formato conferido — **vazio limpa, inválido recusa**;
13. `standingFromRank`: fatia, base dita, `null` sem base, e **monotonicidade** (a direção).

### 6.2 O que os testes de integração provam (18)

1. o handle é normalizado na gravação e o endereço sai em minúsculas, com `publicEventIds`
   filtrado para os eventos **desta** instituição;
2. handle reservado e handle já usado (com caixa diferente) são recusados, com a mensagem
   citando o handle em uso;
3. a espera de 30 dias vale para **troca**, e salvar o mesmo handle não a consome;
4. site sem `http(s)` e identificador acadêmico inválido são **recusados**, e nada é gravado;
5. o anônimo vê identidade, nível, cartas fixadas e certificados — e **não** vê XP, lista de
   eventos, coleção nem posição;
6. quem participa da instituição vê tudo isso, e **só o evento escolhido** aparece na lista
   (o outro conta na contagem, mas não é listado);
7. **quem está logado sem vínculo vê o mesmo que o anônimo**;
8. a matriz campo a campo é respeitada (com só `level` e `headline` públicos, o pacote tem
   **cinco** chaves e a bio não está entre elas);
9. tudo privado ⇒ 404 para anônimo e para a casa, e o dono vê a prévia;
10. **o mesmo handle responde 404 na instituição B** onde a pessoa não participa;
11. o diretório e a lista de eventos são por instituição, com a mesma pessoa listada numa casa
    e ausente na outra;
12. o diretório nasce **vazio** e só lista quem ligou **e** tem página; quem está todo privado
    não entra nem com a caixa ligada;
13. a posição relativa confere com o banco (400/100/50 XP ⇒ top 34%), e quem tem menos XP não
    pode ter fatia melhor;
14. publicar o perfil com tudo visível **não muda o XP** nem cria fato no livro-razão;
15. a auditoria guarda **a decisão** (handle, campos divulgados, campos privados, buscadores,
    diretório, quantos eventos) e **não** o conteúdo: a bio, o site e o ORCID não aparecem na
    trilha;
16. a leitura de perfil alheio entra na trilha como `READ`, com autor; a prévia do dono **não**;
17. instituição inexistente e handle inexistente respondem o **mesmo** 404.

### 6.3 O que o E2E prova (2)

1. a pessoa escolhe o handle, escreve título/bio/interesses/ORCID, marca **um** evento e salva
   pela tela; o endereço aparece, o banco confirma handle e ORCID e a matriz gravada; a prévia
   do dono mostra o aviso e os campos; o **anônimo** (contexto sem sessão) vê nome, nível 5 e o
   convite "há mais para quem participa", e **não** vê "400 XP", coleção nem posição; quem
   **participa** da instituição vê os três, e não vê o convite;
2. com os **15** níveis em `PRIVATE`, o anônimo recebe **HTTP 404** e a página não renderiza,
   enquanto o dono continua vendo a própria prévia.

---

## 7. Comandos operacionais

```bash
# Onde a pessoa decide
/t/<slug>/meu-perfil-publico

# A página pública
/t/<slug>/u/<handle>

# Conferir no banco a matriz de visibilidade de uma pessoa
psql "$DATABASE_URL" -c 'SELECT "publicHandle", "profileAudiences", "profileIndexable",
  "publicInterests", "publicSiteUrl" FROM "user" WHERE "publicHandle" IS NOT NULL'

# Quem está no diretório de uma instituição
psql "$DATABASE_URL" -c 'SELECT u."publicHandle", p."listedInDirectory", p."publicEventIds"
  FROM user_tenant_profiles p JOIN "user" u ON u.id = p."userId"
  WHERE p."listedInDirectory" = true'

# A decisão na trilha (sem conteúdo pessoal)
psql "$DATABASE_URL" -c 'SELECT action, "entityType", changes FROM audit_logs
  WHERE "entityType" = '"'"'user_public_profile'"'"' ORDER BY "createdAt" DESC LIMIT 10'

# A direção do cálculo da posição (a pessoa de maior XP tem a MENOR fatia)
psql "$DATABASE_URL" -c 'SELECT "userId", "totalXp", level FROM user_xp_profiles
  WHERE "totalXp" > 0 ORDER BY "totalXp" DESC LIMIT 10'
```

---

## 8. Dívidas técnicas e pontos de atenção

* **E35 (quitada)** — existe o caminho de interface para quem quer se identificar: a mesma tela
  traz o interruptor do nome público no resultado do sorteio (`isPublicProfile`). O nome
  completo passa a ser uma escolha, e não um `UPDATE` no banco.
* **E60 (nova) — não há mensagem entre participantes.** A instituição fala com a pessoa (FASE
  32) e o perfil público existe, mas duas pessoas não conversam pela plataforma. É a metade
  social da gamificação, e ela traz junto moderação, bloqueio e denúncia — por isso ficou fora.
* **E61 (nova) — não há visão da pessoa entre instituições.** O `@handle` é global, mas não
  existe um "hub" que mostre a participação somada em todas as casas: a página é sempre de uma
  instituição. Um hub teria de decidir se XP e cartas somam entre tenants (e o XP é por
  instituição desde a FASE 5).
* **E62 (nova) — não há moderação nem denúncia do que é público.** Bio, título e interesses são
  texto livre publicado na internet, sem filtro, sem canal de denúncia e sem caminho para a
  instituição revisar o que aparece no seu domínio. A instituição também não consegue desligar o
  perfil público dentro da casa dela.
* **A matriz de visibilidade é GLOBAL, e a tela diz isso.** Quem participa de várias
  instituições tem a mesma escolha em todas — é a consequência de ADR-243, documentada na tela,
  mas é o ponto que mais se parece com uma surpresa se alguém esperar o contrário.
* **A foto vem do cadastro, e não há upload nesta tela.** `user.image` é global e alimentada
  pelo acervo da plataforma; quem não tem foto aparece com as iniciais. Não há controle de
  recorte nem de "esconder a foto" diferente do campo `Foto` (que é a decisão de visibilidade).
* **A página não pagina nem busca.** O diretório traz até 60 pessoas (`listDirectoryProfiles`) e
  **não tem consumidor de interface nesta fase** — ele nasceu para o diretório público e para a
  ficha 360 que vem depois; sem tela, ele é uma função testada e sem leitor.
* **A "posição relativa" conta XP > 0 da instituição inteira**, sem filtrar por período nem por
  evento: quem parou de participar continua na base da comparação. Uma janela móvel (o mesmo
  problema da FASE 32) é o caminho, e a página diz de quantas pessoas é a fatia.
* **O handle trocado não redireciona.** O endereço antigo vira 404. Redirecionar exigiria uma
  tabela de apelidos históricos, com a mesma decisão de privacidade do handle atual (o apelido
  antigo continuaria revelando a pessoa).
* **`publicHandle` virou campo só de saída no Better Auth** (`input: false`): a API de
  autenticação não consegue mais defini-lo, e o único escritor é `savePublicProfile`. É a
  garantia de que o handle passa pelas regras do domínio — e é preciso saber disso ao mexer em
  `auth.ts`.
* **ORCID e Lattes são globais e agora têm dois leitores**: a página pública e a detecção de
  conflito de interesse do comitê (FASE 4). Como o dado passa a ser autodeclarado, o valor que
  alimenta o COI é o que a pessoa escreveu — quem errar o próprio ORCID enfraquece a própria
  checagem (e continua havendo a declaração manual de conflito).

---

## 9. Checklist de aceite

* [x] A pessoa escolhe se quer ser pública, e **o que** fica público — 15 campos, três níveis
* [x] A pessoa escolhe o `@handle` (validado, normalizado, único sem caixa, com reservadas)
* [x] A escolha do `@handle` tem espera de 30 dias entre **trocas** (salvar o mesmo não conta)
* [x] A página mostra nível, título de nível, prestígio, XP, dias seguidos, cartas em destaque,
      resumo da coleção, eventos, certificados, interesses, links e posição relativa — **cada
      um conforme a autorização**
* [x] Os eventos listados são escolhidos **um a um**, e só os desta instituição
* [x] O diretório da instituição é uma escolha **separada** e nasce desligado
* [x] Ser achável em buscadores é uma escolha **separada** e nasce desligada (`noindex`)
* [x] Perfil todo privado responde **404**, igual a handle inexistente
* [x] A página só existe onde a pessoa **participa** da instituição (o `user` é global e a RLS
      não o protege)
* [x] Publicar **não dá XP** (consentimento não é pedágio — teste prende)
* [x] Interesses são **declarados**, sem nenhum caminho de inferência
* [x] O pacote é allowlist com **teste de igualdade** das chaves
* [x] A trilha guarda a **decisão** (campos divulgados/privados) e não o conteúdo (bio, site,
      identificadores); a leitura de perfil alheio entra como `READ`
* [x] A permissão `profile:manage:own` entra no catálogo (66), e a posse é conferida no serviço
      pelo `userId` da sessão (nunca de campo do formulário)
* [x] A tela não oferece campo que o serviço não grave (ORCID e Lattes passaram a gravar)
* [x] A **E35 está quitada** (a tela do nome público no resultado do sorteio)
* [x] Toda a suíte verde (**2272** testes + **150** E2E), com os testes das fases anteriores
      intactos
* [x] Documentação da fase, README, `AGENTS.md` e dívidas (E35 quitada; E60, E61 e E62
      declaradas) atualizados
