# FASE 23 — Conteúdo e mídia

> **Itens quitados:** E9 (pré-visualização da página), E10 (upload de imagem na galeria),
> E11 (reaproveitar patrocinador entre eventos), E12 (histórico de versões),
> E13 (publicação agendada).
> **ADRs:** 100 a 106 (7 decisões) · **Migrações:** 1 (tabela nova + coluna).
> **Testes novos:** 34 unitários + 23 de integração + 5 E2E.

---

## 1. Sumário executivo

A FASE 17 entregou o editor da página pública. Esta fase entrega o que faltava para
OPERAR esse editor no dia a dia: ver antes de publicar, enviar imagem sem depender de
hospedagem externa, reaproveitar o cadastro comercial da edição anterior, voltar atrás
quando um conteúdo é sobrescrito e deixar a página entrar no ar sozinha na data marcada.

### 1.1 Entregas

| # | Entrega | Onde |
|---|---|---|
| E9 | **Pré-visualização do rascunho** em rota autenticada, renderizada pelo MESMO componente da página pública | `src/components/events/event-landing.tsx` · `.../eventos/[eventId]/pagina/previa/page.tsx` · `getEventForPreview` em `src/lib/events/event-repository.ts` |
| E10 | **Upload de imagem na galeria**, com a esteira de três etapas extraída para uso compartilhado | `src/components/admin/asset-upload.ts` · `block-content-fields.tsx` · alvo `GALLERY` em `src/domain/events/image-rules.ts` e `src/lib/admin/asset-service.ts` |
| E11 | **Copiar patrocinador** de outro evento, com cota casada por categoria e cadastro oculto | `listSponsorCandidates`/`copySponsorToEvent` em `src/lib/admin/sponsor-service.ts` · `planSponsorCopy` em `src/domain/events/sponsor-rules.ts` |
| E12 | **Histórico de versões** com restauração, retenção limitada e deduplicação por checksum | `prisma/migrations/20260918090000_page_versions_and_schedule/` · `src/lib/admin/page-version-service.ts` · `src/domain/events/page-version-rules.ts` · painel no editor |
| E13 | **Publicação agendada** decidida na leitura, sem agendador | `EventPage.publishAt` · `planPublication`/`resolvePublicationState` em `src/domain/events/landing-page.ts` · consulta pública em `event-repository.ts` |
| — | Dados de demonstração: página do simpósio **agendada** e histórico com 11 versões | `prisma/seed.ts` |

### 1.2 Números da fase

```text
Arquivos novos ............ 8 (3 de domínio/serviço · 1 de componente compartilhado ·
                              1 de rota de prévia · 3 de teste)
Arquivos alterados ........ 12 (schema, repositório, serviços, ações, telas, seed, docs)
Migrações ................. 1 (tabela `event_page_versions` + coluna `event_pages.publishAt`)
ADRs ...................... 7 (100–106) → o próximo é o ADR-107
Testes novos .............. 62 (34 unitários · 23 de integração · 5 E2E)
Totais após a fase ........ 46 arquivos · 1117 testes Vitest · 64 E2E · 15 migrações
```

**O ADR-100 desta fase é simbólico:** o projeto chegou a cem decisões registradas, cada
uma com contexto, alternativas descartadas e consequências.

---

## 2. O problema mais difícil da fase

**Publicar era a única forma de ver o que seria publicado.**

Todo o resto decorre disso. O organizador montava a página às cegas, publicava para
conferir, e despublicava depois — e nesse intervalo a página incompleta ficava no ar, com
o endereço já circulando entre os inscritos. A prévia (E9) parece um item de conforto;
era o item que destravava a operação real do editor.

E ele trouxe a decisão estrutural da fase: **a página pública deixou de ser uma tela e
passou a ser um componente**. A alternativa era uma segunda tela "parecida com a
pública" — que começa idêntica e termina diferente, e a diferença aparece justamente
quando o organizador aprova na prévia algo que o site não mostra. Com um componente e
dois consumidores, a única diferença entre prévia e produção é QUAL página chega: a
publicada (site) ou a atual, ainda rascunho (prévia).

As outras quatro entregas compartilham o mesmo tema: **operações que precisam ser
reversíveis ou verificáveis antes de virarem consequência** — voltar um conteúdo (E12),
entrar no ar na data sem ninguém clicando (E13), subir a imagem sem hospedar fora (E10) e
não redigitar o cadastro comercial (E11).

---

## 3. Decisões técnicas

### 3.1 A prévia renderiza o MESMO componente (E9)

`EventLanding` recebe `event` e desenha hero, blocos, resultados de sorteio e rodapé. A
rota pública e a rota de prévia montam esse `event` de fontes diferentes:

| | Leitura | Página incluída |
|---|---|---|
| Pública | `getPublicEvent(tenantId, slug)` — só status públicos | publicada **ou** agendada já vencida |
| Prévia | `getEventForPreview(tenantId, eventId)` — por id, **sem** filtro de status | a atual, mesmo rascunho |

O mapeamento vive em um só lugar (`loadEventDetail`), com o mesmo `select`: duas
projeções paralelas divergiriam no primeiro campo acrescentado, e a prévia "quase certa"
é pior do que não ter prévia.

A prévia é **rota de administração** (sob `administracao`, exigindo `page:manage`) e
mostra um selo dizendo o estado real da página. Sem o selo, duas abas abertas (prévia e
site) seriam indistinguíveis.

A prévia de uma página SEM blocos avisa explicitamente: o que aparece é a composição
padrão, e o organizador não pode aprovar achando que montou algo.

### 3.2 Publicação agendada decidida na LEITURA (E13)

`publishAt` não é um job: a consulta pública inclui a página quando
`isPublished = true OR publishAt <= now()`. Três motivos:

1. a plataforma **não tem agendador** — a manutenção de partições da auditoria já depende
   de cron externo (dívida B7);
2. um agendador que não roda deixaria a campanha fora do ar **sem ninguém perceber no
   dia** — o pior modo de falha possível para uma data marcada;
3. o relógio do banco é a fonte da verdade, e a regra fica testável sem esperar.

O estado da página é derivado por `resolvePublicationState`: `PUBLISHED`, `SCHEDULED` ou
`DRAFT`. E `planPublication` decide o que GRAVAR com três regras que evitam defeitos
concretos:

- **publicar agora + agendar é recusado** — o sistema não escolhe pelo organizador;
- **despublicar LIMPA a data** — sem isso, `publishAt` já vencido republicaria a página no
  instante seguinte ao "tirar do ar";
- **data no passado é publicação imediata** — tratá-la como "agendada no passado"
  deixaria a página fora do ar para sempre.

### 3.3 Histórico por snapshot da página, com checksum (E12)

A unidade de recuperação é a **página inteira**, não o bloco: restaurar um bloco isolado
exige decidir o que fazer com a ordem, com os blocos removidos depois e com os
acrescentados — decisões que ninguém quer tomar no meio de um evento.

Cada versão guarda um snapshot (título, SEO, publicação, blocos com ordem e visibilidade)
e o **SHA-256 do snapshot canonicalizado** (chaves ordenadas recursivamente). O checksum
serve para duas coisas:

- **deduplicar**: salvar o formulário sem mexer em nada não cria versão — em uma tarde de
  ajustes, vinte versões idênticas escondem a que importa;
- **marcar o estado atual**: a versão mais recente cujo conteúdo é o vigente recebe o selo.

A ordenação dos blocos no snapshot é a MESMA da renderização (`displayOrder`, desempate
por `id`) — sem isso, dois caminhos calculariam checksums diferentes para o mesmo estado e
o selo "estado atual" nunca apareceria.

Retenção: `MAX_PAGE_VERSIONS = 20`, as mais recentes. Sem teto, o histórico de uma página
editada por anos cresceria sem limite dentro do banco transacional.

A **restauração não mexe em publicação**: voltar um texto não deve republicar (nem
despublicar) a página. É substituição total dos blocos (`deleteMany` + `createMany`), e a
própria restauração grava uma versão nova — sem isso o histórico teria um salto e o
próximo leitor concluiria que o estado atual é o antigo.

### 3.4 Upload de galeria com a esteira compartilhada (E10)

A esteira (assina → navegador envia → servidor confere e grava) saiu do componente da capa
para `asset-upload.ts`. A galeria precisa das mesmas etapas, e uma segunda cópia
divergiria no primeiro ajuste — provavelmente nos **magic bytes**, que é justamente a
parte que impede servir um arquivo disfarçado de imagem.

Diferença de destino: capa, logotipo e logotipo de patrocinador têm COLUNA onde a URL é
gravada; a imagem da galeria, não — ela vive dentro do `content` do bloco. Então o alvo
`GALLERY` devolve a URL ao formulário e **não grava nada**; o vínculo acontece quando o
bloco é salvo, passando pela validação do domínio (que só aceita URL http(s)). A mesma
regra vale para imagem enviada e para imagem colada de outro site.

Limite próprio de 3 MB: são fotos, e várias na MESMA página — o peso soma.

### 3.5 Reaproveitar patrocinador é COPIAR (E11)

O modelo tem `Sponsor.eventId`, não uma tabela de vínculo N:N. Então reaproveitar é criar
um cadastro no evento de destino — o que é o comportamento certo para patrocínio: cada
edição tem contrato, valor e vigência próprios, e o histórico de uma edição não pode mudar
quando a outra é editada.

O que vai e o que não vai:

| Vai | Não vai |
|---|---|
| nome, site, logotipo, descrição | **valor do contrato** (renegociado por edição) |
| contato (nome, e-mail, telefone) | **cota** (é do evento de destino) |
| documento fiscal | |

A cota é casada pela **chave** (`GOLD` → `GOLD`), não pelo nome: o nome é livre e editável
("Ouro", "Cota Ouro"), e casar por nome acertaria por sorte. Sem correspondência, o
cadastro entra sem cota — estado válido — e a resposta AVISA, para o organizador não
descobrir depois.

O cadastro nasce **oculto**: quem copia está montando a próxima edição, e exibir de
imediato publicaria uma marca no site sem contrato fechado.

### 3.6 O que a fase NÃO fez (e por quê)

- **Biblioteca de mídia** (tabela de arquivos com reuso e exclusão): o bucket é a
  biblioteca nesta fase. Uma imagem enviada e não usada fica sem referência — declarado
  como dívida.
- **`unpublishAt`** (janela de exibição): o caso real é "entrar no ar na data"; sair
  sozinho é outro produto.
- **Versionamento por bloco**: a unidade é a página (§3.3).
- **Arrastar e soltar no editor**: a lista ordenada com "subir/descer" funciona no teclado
  e responde "o que está na página, em que ordem" (§ da FASE 17).

---

## 4. ADRs

### ADR-100 — A pré-visualização usa o MESMO componente da página pública

**Contexto.** Publicar era a única forma de ver a página montada; o rascunho ficava no ar
no intervalo entre publicar e despublicar.

**Decisão.** Extrair a página pública para `EventLanding`, consumido pela rota pública e
pela rota de prévia (`/administracao/eventos/<id>/pagina/previa`, exigindo `page:manage`).
A diferença entre as duas é apenas QUAL página chega ao componente. O mapeamento do evento
é único (`loadEventDetail`).

**Justificativa.** Uma segunda tela "parecida" com a pública divergiria, e a divergência
aparece quando o organizador aprova na prévia algo que o site não mostra. Um componente,
dois consumidores: a prévia é a produção com outro dado.

**Consequências.** (+) Prévia fiel sem manutenção duplicada; a página pública ficou menor e
testável isoladamente. (−) A rota de prévia precisa de guarda de permissão explícita —
está implementada e coberta por E2E.

### ADR-101 — A visibilidade agendada é decidida na leitura, sem agendador

**Contexto.** A plataforma não tem scheduler (a manutenção de partições depende de cron
externo). Uma campanha com data marcada precisa entrar no ar sem intervenção.

**Decisão.** `publishAt` entra na consulta pública (`isPublished OR publishAt <= now`) e o
estado é derivado por `resolvePublicationState`. `planPublication` decide o que gravar e
**limpa a data ao despublicar**; publicar agora e agendar ao mesmo tempo é recusado; data
no passado publica imediatamente.

**Justificativa.** Um job que não roda falha em silêncio justamente no dia que importa.
Decidir na leitura usa o relógio do banco como fonte da verdade, não exige infraestrutura
nova e é testável sem esperar.

**Consequências.** (+) Agendamento confiável e testável. (−) A regra precisa estar na
consulta E no domínio (tela) — as duas foram testadas; e despublicar tem de limpar a data
(caso coberto por teste específico).

### ADR-102 — Histórico por snapshot da página inteira, deduplicado por checksum

**Contexto.** A trilha de auditoria registra QUE houve mudança, com resumo — não o
conteúdo anterior. Um bloco sobrescrito por engano só voltava com suporte.

**Decisão.** Tabela `event_page_versions` com snapshot (página + blocos em ordem canônica),
`checksum` SHA-256 do snapshot canonicalizado e `reason` legível. A gravação acontece na
MESMA transação da alteração; versões idênticas à última não são gravadas; a retenção é de
20 por página.

**Justificativa.** O snapshot responde "como a página estava" (inclusive para investigar
um problema), e a restauração vira aplicação direta. O checksum evita que vinte
salvamentos sem alteração escondam a versão que importa.

**Consequências.** (+) Restauração real, com histórico legível. (−) Uma cópia do conteúdo
por alteração relevante (limitada pela retenção) e a canonicalização passou a ser
CONTRATO: mudar a ordem das chaves invalidaria a marcação de "estado atual".

### ADR-103 — Restaurar substitui a página e NÃO mexe na publicação

**Contexto.** O organizador pode restaurar um conteúdo gravado quando a página estava em
rascunho, ou publicada.

**Decisão.** A restauração substitui título, SEO e TODOS os blocos (`deleteMany` +
`createMany`, reindexando a ordem) e deixa `isPublished`/`publishAt` como estão. A
restauração grava uma versão nova, marcada como "Restaurada de uma versão anterior".

**Justificativa.** Um "desfazer" que tira a página do ar (ou a publica) é uma surpresa
cara: o efeito colateral não tem relação com o que a pessoa pediu. E sem a versão nova, o
histórico teria um salto — o próximo leitor concluiria que o estado atual é o antigo.

**Consequências.** (+) Restauração previsível e história contínua. (−) Restaurar uma versão
antiga não devolve o estado de publicação daquele momento (é uma escolha, não uma
limitação).

### ADR-104 — A esteira de upload é uma só, e a galeria não grava URL no banco

**Contexto.** Capa e logotipos têm coluna; a imagem da galeria vive no `content` do bloco,
que só é gravado quando o organizador salva o bloco.

**Decisão.** Extrair a esteira (assinar → enviar → conferir) para `asset-upload.ts`, usada
por todos os alvos. O alvo `GALLERY` devolve a URL ao formulário e não grava nada; o
vínculo acontece na validação do conteúdo do bloco (`safeUrlSchema`).

**Justificativa.** Uma segunda cópia da esteira divergiria — provavelmente na verificação
da assinatura real do arquivo, que é o que impede servir um arquivo disfarçado de imagem.
E o destino da URL é uma questão de MODELO, não de validação: sem coluna, o formulário é o
destino.

**Consequências.** (+) Uma correção vale para os quatro alvos. (−) Imagem enviada e não
usada fica no bucket sem referência (dívida E14).

### ADR-105 — Reaproveitar patrocinador é copiar o cadastro, com cota pela chave

**Contexto.** `Sponsor.eventId` prende o cadastro a um evento; não há vínculo N:N. A mesma
empresa patrocina várias edições.

**Decisão.** `listSponsorCandidates` agrupa por nome e mostra em quais eventos o
patrocinador está; `copySponsorToEvent` cria um cadastro no destino com nome, site, logo,
contato e documento, cota casada pela CHAVE, **sem** valor de contrato e **oculto**.
Duplicidade por nome no destino é recusada.

**Justificativa.** Cada edição tem contrato e valor próprios; compartilhar a linha faria o
histórico de uma edição mudar ao editar a outra. Copiar oculto evita publicar marca sem
contrato fechado.

**Consequências.** (+) Cadastro da próxima edição em dois cliques, sem risco de publicação
acidental. (−) Os dados são copiados, não vinculados: corrigir o site do patrocinador em
uma edição não corrige as outras (dívida E15).

### ADR-106 — A prévia de página vazia avisa que o visitante veria a composição padrão

**Contexto.** Sem blocos visíveis, a página pública cai na composição padrão (resumo,
programação, patrocinadores). A prévia faz o mesmo — e o organizador poderia aprovar
achando que montou uma página.

**Decisão.** Quando não há bloco visível, a prévia mostra um aviso explícito
(`preview-empty-warning`) explicando que aquilo é a composição padrão, e a lista de blocos
já marca cada bloco vazio.

**Justificativa.** Uma tela que mostra conteúdo que NÃO é do organizador precisa dizer de
onde ele vem. É o mesmo raciocínio do selo de prévia: estado interno nunca fica implícito.

**Consequências.** (+) O organizador sabe exatamente o que publicou. (−) Um aviso a mais na
tela quando a página está vazia — que é exatamente quando ele é necessário.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | `prisma migrate dev` recusou: "The migration `20260917191000_rls_policies` was modified after it was applied" | O arquivo daquela migração foi editado DEPOIS de aplicado (sessão anterior), e o ledger guarda o checksum do conteúdo original | A migração nova foi aplicada com `migrate deploy` e, no fim da fase, a cadeia inteira foi reaplicada do zero (`migrate reset`) — o ledger voltou a casar com os arquivos. **Migração aplicada não se edita**; corrigir é migração nova |
| 2 | Duas versões apareciam marcadas como "estado atual" no histórico | Publicar, editar e restaurar devolve exatamente o estado publicado: duas versões com o mesmo conteúdo | A marcação passou a ser aplicada só à versão MAIS RECENTE que casa com o estado vigente |
| 3 | E2E: clicar em "Restaurar" não restaurava nada — sem erro no servidor e sem mensagem na tela | O botão pede confirmação com `window.confirm`, e o **Playwright dispensa diálogos automaticamente** quando ninguém os trata; um diálogo dispensado devolve `false` e o formulário cancela a submissão | `page.on('dialog', (d) => d.accept())` no cenário, com o motivo escrito no teste — nada chegava ao servidor, então não havia o que depurar no log |
| 4 | E2E: o upload da galeria não acontecia e nenhuma mensagem aparecia | O `<input type="file">` é único e escondido, e cada botão guarda o ÍNDICE da linha. Definir o arquivo direto no input pulava o clique, o índice ficava nulo e o envio retornava sem fazer nada | O cenário passou a usar o fluxo real: `waitForEvent('filechooser')` + clique no botão + `chooser.setFiles(...)` |
| 5 | E2E: publicar depois de agendar falhava com "escolha uma coisa: publicar agora ou agendar" | O campo de data continuava preenchido com o valor salvo, e o domínio recusa as duas intenções juntas (comportamento correto) | O cenário limpa a data antes de publicar; e a dica do campo passou a dizer as duas opções e como despublicar |
| 6 | E2E: `selectOption({ label: RegExp })` falhou com "options[0].label: expected string, got object" | A API do Playwright aceita `label` apenas como string | O cenário passou a selecionar pelo **valor** (o id do patrocinador, que é o dado enviado pelo formulário) |
| 7 | O cenário do histórico não conseguia nem abrir o editor de bloco | O cenário anterior falhou, o Playwright reiniciou o worker e o `beforeAll` recriou o fixture — sem a página criada pelo primeiro cenário (armadilha 26 do `AGENTS.md`) | Corrigido o PRIMEIRO defeito (a confirmação nativa); os cenários seguintes voltaram a passar sem alteração |

---

## 6. Evidência de verificação

### 6.1 Bateria completa

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 46 arquivos, 1117 testes passando (+57)
npm run build                → ✓ Compiled successfully
                               ƒ /t/[tenantSlug]/administracao/eventos/[eventId]/pagina/previa
npm run db:verify            → Contrato íntegro.
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:verify:pooling    → Pooling íntegro: contexto por transação preservado sob PgBouncer.
npm run db:partitions        → partições em dia (1483 linhas de auditoria)
npm run test:e2e             → 64 passed (1.7m)
npm run db:migrate:status    → 15 migrations found · Database schema is up to date!
npx prisma migrate reset     → cadeia inteira reaplicada do zero (15 migrações)
npm run db:seed              → 11 versão(ões) no histórico · simpósio SCHEDULED para +7 dias
```

### 6.2 E2E dos itens novos (contra o container de produção)

```text
✓ a pré-visualização mostra o rascunho e não interfere na página pública (E9)
✓ agendar deixa a página fora do ar e publicar a coloca no ar (E13)
✓ o histórico de versões lista as alterações e restaura o conteúdo anterior (E12)
✓ o envio de imagem da galeria passa pela esteira real e aparece no site (E10)
✓ copiar um patrocinador de outro evento cria o cadastro oculto com a cota certa (E11)
```

O cenário do upload é o único que atravessa o storage de verdade: o arquivo é assinado,
enviado ao MinIO pelo navegador, conferido pelo servidor, e o teste **busca a URL pública**
e confirma `200` com `content-type: image/png`.

### 6.3 Integração (banco real)

```text
✓ a página criada já tem a primeira versão
✓ salvar sem mudança não cria versão (deduplicação por checksum)
✓ alteração recusada não gera versão (mesma transação)
✓ restaurar devolve o conteúdo e NÃO mexe na publicação
✓ a restauração grava uma versão nova, que passa a ser a atual
✓ recusa versão de outra instituição e de outro evento
✓ retenção mantém 20 versões, descartando as mais antigas
✓ a tabela nova respeita a RLS (contagem zero sob outro contexto)
✓ agendar para o futuro mantém a página fora do ar; a prévia mostra o rascunho
✓ data no passado publica; despublicar limpa a data e a página não volta ao ar
✓ publicar agora + agendar é recusado
✓ cópia casa a cota pela chave, nasce oculta e não leva o valor do contrato
✓ cópia recusa duplicidade por nome no destino
✓ instituição não enxerga patrocinadores de outra
```

---

## 7. Comandos operacionais

```bash
# ── Ver antes de publicar ──────────────────────────────────────────────────────
# /t/<slug>/administracao/eventos/<eventId>/pagina  → "Pré-visualizar →"
# A prévia mostra o estado ATUAL (mesmo rascunho) com o selo de estado no topo.

# ── Agendar ───────────────────────────────────────────────────────────────────
# Editor → "Agendar para entrar no ar" (data/hora). Para publicar na hora, APAGUE a
# data e marque "Publicar a página agora". Para despublicar, apague a data e desmarque.

# ── Voltar atrás ──────────────────────────────────────────────────────────────
# Editor → "Histórico de versões" → "Restaurar". Restaurar NÃO mexe em publicação.

# ── Imagem na galeria ─────────────────────────────────────────────────────────
# Bloco "Galeria" → "Enviar imagem" (vai direto ao bucket de assets) ou cole a URL.
# Limite: 3 MB. PNG, JPEG, WebP ou AVIF — SVG é recusado.

# ── Copiar patrocinador de outro evento ───────────────────────────────────────
# /t/<slug>/administracao/eventos/<eventId>/patrocinadores → "Copiar de outro evento"

# ── Recriar o banco do zero (valida a cadeia de migrações) ────────────────────
npx prisma migrate reset --force
npm run db:rls && npm run db:verify && npm run db:verify:isolation
npm run db:seed && npm run db:seed:dev
```

```sql
-- Versões de uma página (mais recente primero), com o autor:
SELECT v."createdAt", v.reason, v.checksum, u.name AS autor,
       jsonb_array_length(v.snapshot->'blocks') AS blocos
  FROM event_page_versions v LEFT JOIN "user" u ON u.id = v."createdById"
 WHERE v."pageId" = '<pageId>' ORDER BY v."createdAt" DESC LIMIT 20;

-- Páginas agendadas que ainda não entraram no ar:
SELECT p.id, e.title, p."publishAt", p."isPublished"
  FROM event_pages p JOIN events e ON e.id = p."eventId"
 WHERE p."publishAt" IS NOT NULL AND p."publishAt" > now()
 ORDER BY p."publishAt";
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Item | Por que ficou | Impacto se ficar |
|---|---|---|---|
| 1 | **Biblioteca de mídia (E14)** | O bucket é a biblioteca: não há tabela de arquivos, nem reuso, nem exclusão. `GALLERY` devolve a URL ao formulário (ADR-104) | Imagem enviada e não usada fica no bucket sem referência; a mesma foto enviada duas vezes ocupa dois objetos |
| 2 | **Patrocinador copiado não acompanha a origem (E15)** | A cópia é uma CÓPIA (ADR-105), não um vínculo N:N | Corrigir o site de um patrocinador em uma edição não corrige as outras |
| 3 | **Sem `unpublishAt` (janela de exibição)** | O caso real é "entrar no ar sozinha"; sair sozinho é outro produto | Campanha com data de encerramento exige alguém despublicando no dia |
| 4 | **Histórico limitado a 20 versões por página** | Retenção decidida em `MAX_PAGE_VERSIONS` (ADR-102) | Alteração relevante de mais de 20 mudanças atrás não é recuperável |
| 5 | **Restauração não devolve o estado de publicação** | Decisão explícita (ADR-103): `isPublished`/`publishAt` ficam como estão | Quem quer voltar "tudo" precisa publicar/despublicar depois |
| 6 | **A prévia não simula data futura** | O estado mostrado é o do instante da requisição (e o selo diz isso) | Conferir "como ficará quando a data chegar" exige esperar ou agendar e olhar depois |
| 7 | **Fuso do agendamento vem do navegador** | O `FormData` de `<input type="datetime-local">` não traz o fuso; a data é interpretada na hora local do PROCESSO (UTC em produção) | Agendamento pode sair deslocado em algumas horas; a tela mostra a data gravada para conferência |
| 8 | **Envio de imagem não gera versão da página** | A versão é gravada quando o BLOCO é salvo — é ele que contém a URL | A imagem fica no bucket mesmo que o bloco nunca seja salvo (mesma família da dívida 1) |

---

## 9. Checklist de aceite

- [x] **E9** — pré-visualização do rascunho renderizada pelo MESMO componente da página pública
- [x] **E9** — prévia exige `page:manage` e mostra selo com o estado real da página
- [x] **E9** — prévia de página vazia avisa que o visitante veria a composição padrão
- [x] **E9** — leitura de prévia por id, sem filtro de status, e o mapeamento do evento é único
- [x] **E10** — upload de imagem na galeria pela esteira real (assina → envia → confere)
- [x] **E10** — alvo `GALLERY` com limite próprio e URL validada pelo domínio ao salvar o bloco
- [x] **E10** — esteira extraída e compartilhada com capa e logotipos
- [x] **E11** — lista de candidatos agrupada por nome, com os eventos de cada um
- [x] **E11** — cópia com cota casada pela CHAVE, nascendo oculta e sem valor de contrato
- [x] **E11** — duplicidade por nome no destino recusada, com o motivo
- [x] **E12** — tabela `event_page_versions` com snapshot, checksum, motivo e autor; RLS + FORCE + policy
- [x] **E12** — versão gravada na MESMA transação da alteração, deduplicada por checksum
- [x] **E12** — histórico com no máximo 20 versões, marcando exatamente uma como estado atual
- [x] **E12** — restauração substitui o conteúdo e NÃO altera publicação; gera versão nova
- [x] **E13** — `publishAt` decidido na leitura, sem agendador
- [x] **E13** — despublicar limpa a data; publicar agora + agendar é recusado; data passada publica
- [x] **E13** — estado (rascunho/agendada/publicada) derivado e exibido no editor
- [x] Toda mutação auditada, com resumo do conteúdo (nunca o texto inteiro)
- [x] Seed de demonstração cria página AGENDADA e histórico pelos serviços reais
- [x] Cadeia completa de migrações reaplicada do zero (`migrate reset`) e verificada
- [x] Testes novos: 34 unitários + 23 de integração + 5 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 6
- [x] `README.md`, `AGENTS.md` e `docs/dividas-tecnicas.md` atualizados
- [x] Imagem `eventflow/web:local` reconstruída e E2E rodando contra ela

---

**Aguardando APROVADO: AVANÇAR**
