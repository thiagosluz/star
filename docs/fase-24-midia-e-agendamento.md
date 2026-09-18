# FASE 24 — Mídia e agendamento

> **Itens quitados:** E14 (biblioteca de mídia), E15 (sincronia do patrocinador copiado),
> E16 (janela de exibição) e E17 (fuso do agendamento).
> **ADRs:** 107 a 112 (6 decisões) · **Migrações:** 1 (tabela + 2 colunas).
> **Testes novos:** 20 unitários + 20 de integração + 5 E2E.

---

## 1. Sumário executivo

A FASE 23 entregou a operação do editor de página. Esta fase fecha as quatro pontas que
ela declarou em aberto — todas consequências diretas de decisões que ela mesma tomou:

| Dívida da FASE 23 | O que foi feito |
|---|---|
| "o bucket é a biblioteca" | Tabela `media_assets`: a imagem passa a ter registro (autor, tamanho, checksum, finalidade), com **reaproveitamento do mesmo arquivo** e **exclusão que confere o uso** |
| "a cópia não acompanha a origem" | `sponsors.sourceSponsorId` + **sincronizar**: o vínculo com a edição de origem propaga os dados da empresa sob demanda |
| "a página não sai do ar sozinha" | `EventPage.unpublishAt`: **janela de exibição** decidida na leitura, com validação cruzada das duas datas |
| "o fuso do agendamento vem do navegador" | A data digitada é interpretada no **fuso do EVENTO**, e a mensagem diz em que fuso foi lida |

### 1.1 Entregas

| # | Entrega | Onde |
|---|---|---|
| E14 | Tabela `media_assets` (RLS + policy), registro em **todo** envio e dedupe por checksum | migração `20260918120000` · `src/lib/admin/media-asset-service.ts` · `registerAsset` em `asset-service.ts` |
| E14 | Tela do acervo com uso por imagem, soma do storage, cópia da URL e exclusão que recusa quando em uso | `.../eventos/[eventId]/pagina/midia/page.tsx` |
| E14 | Reuso no bloco de galeria por seletor do acervo | `src/components/admin/block-content-fields.tsx` |
| E15 | Vínculo com a origem na cópia + `syncSponsorFromSource` com plano de mudanças | `planSponsorSync` em `sponsor-rules.ts` · `sponsor-service.ts` · botão "Sincronizar" |
| E16 | `unpublishAt` + `planPublication`/`resolvePublicationState` com estado `WINDOW_CLOSED` | `src/domain/events/landing-page.ts` · `event-repository.ts` · editor |
| E17 | `zonedWallTimeToInstant`/`instantToZonedWallTime` (com horário de verão) e campo oculto com o fuso do evento | `src/domain/events/scheduling-rules.ts` · `landing-actions.ts` · editor |
| — | Demonstração: página do simpósio com janela completa de 7 a 21 dias | `prisma/seed.ts` |

### 1.2 Números da fase

```text
Arquivos novos ............ 8 (1 migração · 1 de domínio · 1 de serviço · 1 de página ·
                              3 de teste · este documento)
Arquivos alterados ........ 19 (schema, contrato de schema, seed, 3 de domínio,
                              5 serviços, repositório público, 2 ações, 2 telas e
                              1 componente, e os 3 documentos de acompanhamento)
Migrações ................. 1 (tabela `media_assets` + `event_pages."unpublishAt"` +
                              `sponsors."sourceSponsorId"`)
ADRs ...................... 6 (107–112) → o próximo é o ADR-113
Testes novos .............. 45 (20 unitários · 20 de integração · 5 E2E)
Totais após a fase ........ 48 arquivos de teste · 1157 testes Vitest · 69 E2E ·
                              16 migrações · 33 tabelas de tenant sob RLS
```

---

## 2. O problema mais difícil da fase

**Uma referência que é URL não pode ser protegida pelo banco.**

As outras três dívidas eram trabalhosas, mas lineares: uma tabela nova, um vínculo a mais,
uma data a comparar. E14 era diferente, porque a biblioteca de mídia tem uma contradição
interna:

- para **reaproveitar** e **apagar** arquivos, a imagem precisa de identidade no banco;
- na prática, a página **referencia a imagem pela URL** — e isso não é um descuido: o
  conteúdo do bloco aceita imagem externa (a instituição pode usar uma foto do próprio
  site), e mudar para "id do arquivo" quebraria toda página já publicada.

Ou seja: o registro existe, mas **a chave estrangeira não existe**. Apagar uma imagem em
uso não seria barrado pelo banco — ele nem sabe que há uso. O resultado seria uma página
pública com um ícone quebrado e um organizador sem explicação.

A resposta foi aceitar a assimetria e **procurar o uso antes de apagar**: o serviço varre a
capa do evento, o logotipo dos patrocinadores e o conteúdo dos blocos, e recusa dizendo
onde a imagem está. É mais caro do que um `ON DELETE` e é o comportamento correto — a
tela responde a pergunta que o organizador tem ("posso apagar isto?"), em vez de deixá-lo
descobrir.

E17 tinha o mesmo formato de armadilha: um campo que parece inofensivo (`datetime-local`) e
grava a hora errada por três horas, sem erro nenhum. A correção não é "usar o fuso do
navegador" (o organizador marca a data do EVENTO, não do seu laptop): é usar o fuso do
evento, o mesmo que a página pública anuncia no rodapé — e fazer a mensagem dizer qual foi,
porque conversão de fuso que não se confere é fé, não engenharia.

---

## 3. Decisões técnicas

### 3.1 O acervo é da INSTITUIÇÃO, não do evento (E14)

`media_assets.tenantId` é a fronteira (RLS + FORCE + policy); `eventId` é apenas "onde foi
enviada" e vira nulo se o evento for removido. Motivo prático: uma imagem enviada na edição
passada é exatamente o que se quer reaproveitar agora — e a pergunta "onde mais posso usar
esta foto?" só tem resposta se o acervo não estiver preso a um evento.

A tela do evento mostra o acervo inteiro com o rótulo de origem de cada imagem.

### 3.2 Dedupe: o mesmo arquivo não ocupa dois objetos

Todo envio passa por `registerAsset`, que procura o mesmo **checksum** (+ tamanho e tipo)
na instituição. Se encontrar, apaga o objeto recém-enviado e devolve a URL existente.

É o ganho direto de ter o registro: subir a mesma foto para a capa e para a galeria deixou
de criar dois objetos iguais, cobrados duas vezes. Limite honesto: reencodar a mesma foto
muda o checksum e gera um segundo objeto (declarado como consequência, não como surpresa).

### 3.3 Exclusão confere o uso (§2)

`collectUsages` carrega eventos, patrocinadores e blocos da instituição **de uma vez** e
monta um mapa URL → usos. O uso é calculado uma vez por listagem, e não uma consulta por
imagem.

As URLs do conteúdo dos blocos são **extraídas** (regex) em vez de o mapa ser varrido bloco
a bloco: o custo cai de (blocos × imagens) para o número de URLs escritas — e uma URL que o
acervo não conhece (imagem externa) também passa a constar, o que protege a exclusão de
liberar uma imagem em uso que ainda não foi registrada.

A remoção é **lógica no registro** (o histórico de quem enviou permanece) e **física no
objeto** (o que custa dinheiro). A ordem é: apagar o objeto, marcar o registro e auditar —
na mesma transação, para uma falha do storage não deixar o acervo mentindo.

### 3.4 Janela de exibição: duas datas, cinco regras (E16)

A visibilidade pública passou a ser:

```text
(publicada agora OU com data de entrada vencida)
E (sem data de entrada futura)
E (sem data de término vencida)
```

`planPublication` ganhou `unpublishAt` com duas validações novas:

- **término depois do início** — comparado com o **início efetivo** (a data agendada, se
  houver; senão agora). Uma janela invertida nunca existiria no ar, e o organizador
  concluiria que "o agendamento não funciona";
- **término já vencido ao publicar é recusado** — aceitar gravaria uma página "publicada"
  que nunca aparece: a tela diria uma coisa e o site faria outra.

Despublicar continua limpando **as duas** datas (a regra da FASE 23), e o estado resolvido
ganhou `WINDOW_CLOSED`: a página está configurada, publicada e fora do ar pela data — o
editor diz exatamente isso, em vez de mostrar "rascunho" e fazer o organizador procurar o
que ele não despublicou.

### 3.5 Fuso do evento, não do navegador (E17)

`<input type="datetime-local">` envia hora de parede sem fuso. Três candidatos:

| Candidato | Por que não |
|---|---|
| fuso do processo | é o defeito (UTC em produção; três horas de erro silencioso) |
| fuso do navegador | o organizador agenda o EVENTO, não a própria agenda — e quem viaja marcaria outra hora |
| **fuso do evento** | é o que a página pública anuncia no rodapé e em que a instituição pensa |

`zonedWallTimeToInstant` converte em **duas passagens** (o deslocamento depende do instante,
que depende do deslocamento) e é isso que faz o horário de verão funcionar — Lisboa é
UTC+0 em janeiro e UTC+1 em julho, e o teste cobre os dois.

O fuso viaja em campo oculto no formulário, porque é ele que a tela MOSTROU. Sem JavaScript
ou com valor adulterado, cai-se em UTC e a mensagem de sucesso diz o fuso usado: o
organizador confere em vez de descobrir depois. O caminho de volta (`instantToZonedWallTime`)
faz o campo mostrar a mesma hora que foi digitada — sem ele, reabrir o formulário e salvar
deslocaria a data de novo.

### 3.6 Sincronizar é explícito, e só o que é da empresa (E15)

A cópia passou a guardar `sourceSponsorId`. Não é uma tabela de vínculo N:N: compartilhar a
linha faria o histórico de uma edição mudar quando a outra fosse editada.

`planSponsorSync` compara campo a campo e devolve **o que mudaria**; o serviço aplica e
audita. O conjunto sincronizável é explícito (`SPONSOR_SYNC_FIELDS`): nome, descrição, site,
logotipo e contato. Cota, valor do contrato, vigência, ordem e exibição **não entram no
plano** — nem existem no tipo.

Dois cuidados: sincronizar sem diferença não escreve (e diz "nada a sincronizar"), e origem
removida **desfaz o vínculo** com a explicação — manter um vínculo pendurado faria a tela
oferecer um botão que nunca funciona.

---

## 4. ADRs

### ADR-107 — A imagem passa a ter registro, com reaproveitamento por checksum

**Contexto.** Até a FASE 23 o bucket era a biblioteca: a URL era gravada na coluna do evento
ou no conteúdo do bloco, e ninguém sabia o que havia sido enviado, por quem, quanto pesava
nem onde era usado.

**Decisão.** Tabela `media_assets` (tenant-scoped, com RLS) alimentada por **todo** envio
(capa, logotipos e galeria). Mesmo checksum + tamanho + tipo → o objeto novo é apagado e o
registro existente é devolvido.

**Justificativa.** Sem identidade no banco, não há reaproveitamento nem exclusão consciente;
e a deduplicação por conteúdo é o que impede a mesma foto de ocupar dois objetos pagos.

**Consequências.** (+) Acervo consultável, reuso por seletor e economia de storage.
(−) Reencodar a mesma imagem gera um segundo objeto (checksum diferente) e o envio ganhou
uma escrita a mais.

### ADR-108 — A exclusão de mídia confere o USO, porque a referência é a URL

**Contexto.** O conteúdo do bloco aceita imagem externa e a referência é a URL — não há
chave estrangeira para o banco proteger.

**Decisão.** Antes de apagar, o serviço varre capa/logo do evento, logotipo de patrocinador e
conteúdo dos blocos da instituição; recusa com a lista de usos quando encontra. Remoção
lógica do registro, física do objeto, na mesma transação.

**Justificativa.** Apagar uma imagem em uso deixaria a página pública com ícone quebrado sem
explicação. A tela responde a pergunta que o organizador tem ("posso apagar isto?") em vez
de deixá-lo descobrir depois.

**Consequências.** (+) Nenhuma imagem em uso é removida; o acervo mede espaço real.
(−) A listagem faz uma varredura a mais (mitigada por calcular o uso uma vez por listagem) e
uma imagem referenciada por texto em campo livre só é detectada se estiver como URL http(s).

### ADR-109 — Janela de exibição decidida na leitura, com validação cruzada

**Contexto.** `publishAt` (FASE 23) já entrava no ar sozinho; faltava sair.

**Decisão.** `unpublishAt` entra na MESMA condição de leitura. `planPublication` valida
término depois do início efetivo e recusa término já vencido ao publicar; despublicar limpa
as duas datas. Estado resolvido ganhou `WINDOW_CLOSED`.

**Justificativa.** Simetria com a entrada e com o motivo dela: um agendador que não roda
deixaria a promoção no ar DEPOIS do prazo — e promoção vencida publicada é pior do que
promoção atrasada. Aceitar uma janela invertida ou já vencida criaria uma página
"publicada" que nunca aparece.

**Consequências.** (+) Campanha com prazo sem intervenção manual; a tela explica por que a
página saiu do ar. (−) A condição de visibilidade tem três cláusulas na consulta, e a mesma
regra existe na tela — as duas têm teste.

### ADR-110 — A data do agendamento é interpretada no fuso do EVENTO

**Contexto.** `datetime-local` não carrega fuso; `new Date(texto)` usa o do processo (UTC em
produção) e deslocava o agendamento em três horas, sem erro.

**Decisão.** Conversão por `zonedWallTimeToInstant` (duas passagens, correta em horário de
verão) usando `Event.timezone`, que viaja em campo oculto no formulário. O caminho de volta
formata a data no mesmo fuso, e a mensagem de sucesso nomeia o fuso usado.

**Justificativa.** O organizador marca a data do EVENTO — o fuso em que a instituição pensa
é o do evento, o mesmo que a página anuncia no rodapé. Fuso do navegador seria a agenda
pessoal de quem clica.

**Consequências.** (+) Hora gravada igual à digitada, com conferência na mensagem.
(−) O campo oculto é uma dependência do formulário: sem ele, cai-se em UTC e a mensagem
avisa (documentado, não silencioso).

### ADR-111 — Sincronizar a cópia é explícito e limitado aos dados da empresa

**Contexto.** A cópia da FASE 23 era independente: corrigir o site na origem não alcançava as
outras edições.

**Decisão.** `sponsors.sourceSponsorId` guarda a origem; `syncSponsorFromSource` aplica os
campos de `SPONSOR_SYNC_FIELDS` (nome, descrição, site, logotipo, contato, documento) com o
plano de mudanças auditado. Origem removida desfaz o vínculo e explica.

**Justificativa.** Vínculo N:N faria o histórico de uma edição mudar quando a outra fosse
editada; contrato, valor e vigência são de cada evento. Sincronizar sob demanda dá controle
sem tirar a independência.

**Consequências.** (+) Propagação em um clique, com "nada a sincronizar" quando não há
diferença. (−) Instituição com muitas edições sincroniza uma cópia por vez (dívida E20).

### ADR-112 — O acervo mede o armazenamento, mas não aplica a quota

**Contexto.** A quota de armazenamento do plano (`maxStorageBytes`) é registrada desde a
FASE 14 e nunca aplicada (dívida C4, candidata F21).

**Decisão.** `sumMediaBytes` mede o acervo e a tela mostra o total. **Nada recusa envio** por
quota nesta fase, e a tela diz isso.

**Justificativa.** Aplicar quota exige decidir o que acontece com o que já excede, quem é
avisado e em que momento o upload é recusado — decisão de produto que pertence à F21, junto
com o resto do ciclo de vida do membro e do storage. Medir sem bloquear é honesto e já
resolve a pergunta "quanto eu ocupo?".

**Consequências.** (+) Número real disponível para a fase que aplicar a quota. (−) O limite
do plano continua sendo exibido sem ser imposto — declarado na tela e no `README`.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | E2E do acervo travou esperando `filechooser` por 60 s | O `AssetUploader` tem o `<input type="file">` **visível** (escolhe e envia), enquanto o bloco de galeria tem o input **escondido** com clique prévio. O teste aplicou o fluxo do segundo no primeiro | `setInputFiles` no input visível + clique em "Enviar imagem"; cada tela tem o seu fluxo, e o teste agora diz qual é qual (armadilha 34) |
| 2 | Os quatro cenários seguintes falharam em cascata | O primeiro falhou, o Playwright reiniciou o worker e o `beforeAll` recriou o fixture — sem a página criada pelo cenário 1 (armadilha 26) | Corrigir o PRIMEIRO defeito bastou: os outros quatro passaram sem alteração |
| 3 | `vitest` recusou compilar o teste: "`await` is only allowed within async functions" | O `await pageIdOf()` estava dentro do callback **síncrono** de `withTenant`, e não da função de teste | O id passou a ser resolvido antes (`const pageId = await pageIdOf()`), e o callback ficou síncrono como os outros |
| 4 | Teste do acervo dependia de o MinIO estar alcançável (a exclusão apaga o objeto) | O teste de integração roda contra banco real; o storage pode não estar no ar | O cenário aceita as duas realidades (excluído → some do acervo; sem storage → erro explícito), e **nunca** uma exclusão silenciosa |

---

## 6. Evidência de verificação

### 6.1 Bateria completa

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 48 arquivos, 1157 testes passando (+40)
npm run build                → ✓ Compiled successfully
                               ƒ /t/[tenantSlug]/administracao/eventos/[eventId]/pagina/midia
npm run db:verify            → Contrato íntegro.
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:verify:pooling    → Pooling íntegro: contexto por transação preservado sob PgBouncer.
npm run db:partitions        → partições em dia (461 linhas de auditoria)
npm run test:e2e             → 69 passed (1.8m)
npm run db:migrate:status    → 16 migrations found · Database schema is up to date!
npm run db:seed              → 11 versões no histórico · simpósio SCHEDULED de 25/09 a 09/10
```

### 6.2 E2E dos itens novos (contra o container de produção)

```text
✓ a imagem enviada entra no acervo e pode ser reaproveitada na galeria (E14)
✓ a imagem EM USO não pode ser excluída, e a tela diz onde ela está (E14)
✓ a página sai do ar sozinha na data de término, sem perder a configuração (E16)
✓ a data agendada é gravada no FUSO DO EVENTO, não em UTC (E17)
✓ o patrocinador copiado sincroniza com a origem, preservando cota e contrato (E15)
```

O cenário do fuso é o mais direto: preenche `2027-03-10T18:00` no campo e confere no banco
`2027-03-10T21:00:00.000Z` — três horas de diferença, que é o deslocamento de Salvador.

### 6.3 Integração (banco real)

```text
✓ o envio registra a imagem no acervo com autor, tamanho e checksum
✓ o MESMO arquivo (mesmo checksum) é reaproveitado em vez de duplicar
✓ a soma do acervo considera só o que não foi excluído
✓ relata o USO da imagem na capa do evento
✓ relata o uso no LOGOTIPO DE PATROCINADOR e no CONTEÚDO do bloco
✓ RECUSA excluir imagem em uso, dizendo onde ela está
✓ exclui a imagem LIVRE e ela sai do acervo
✓ não enxerga o acervo de OUTRA instituição
✓ a página com término no PASSADO já não é a página do site
✓ a página com término no FUTURO continua no ar
✓ agendar entrada e saída deixa a página fora do ar até a data
✓ RECUSA término antes do início e término vencido
✓ grava a data interpretada no fuso do EVENTO (e não em UTC)
✓ o editor devolve o fuso do evento para o formulário
✓ prepara a origem e copia para o segundo evento
✓ a cópia guarda de ONDE veio
✓ sincroniza os dados da EMPRESA e preserva cota, contrato e exibição
✓ sincronizar sem diferença não escreve nada
✓ recusa sincronizar um cadastro que NÃO foi copiado
✓ origem removida DESFAZ o vínculo e explica
```

---

## 7. Comandos operacionais

```bash
# ── Biblioteca de mídia ───────────────────────────────────────────────────────
# /t/<slug>/administracao/eventos/<eventId>/pagina/midia
#   Enviar imagem · ver onde cada uma é usada · copiar a URL · excluir (só as livres)

# ── Reuso no bloco de galeria ─────────────────────────────────────────────────
# Editor → bloco "Galeria" → "Usar imagem do acervo…" (preenche a URL da linha)

# ── Janela de exibição ────────────────────────────────────────────────────────
# Editor → "Agendar para entrar no ar" + "Sair do ar em" (ambas opcionais).
# As datas são lidas e mostradas no FUSO DO EVENTO (o rodapé da página informa qual).

# ── Sincronizar um patrocinador copiado ───────────────────────────────────────
# /t/<slug>/administracao/eventos/<eventId>/patrocinadores → "Sincronizar"
```

```sql
-- Acervo da instituição, com o que está em uso:
SELECT m."fileName", m."sizeBytes", m.target, m."createdAt", u.name AS enviado_por
  FROM media_assets m LEFT JOIN "user" u ON u.id = m."uploadedById"
 WHERE m."tenantId" = '<tenantId>' AND m."deletedAt" IS NULL
 ORDER BY m."createdAt" DESC;

-- Soma do armazenamento por instituição (a quota do plano ainda não bloqueia — dívida C4):
SELECT "tenantId", pg_size_pretty(sum("sizeBytes")::bigint) AS acervo
  FROM media_assets WHERE "deletedAt" IS NULL GROUP BY "tenantId";

-- Páginas com janela de exibição configurada:
SELECT e.title, p."publishAt", p."unpublishAt", p."isPublished"
  FROM event_pages p JOIN events e ON e.id = p."eventId"
 WHERE p."unpublishAt" IS NOT NULL ORDER BY p."unpublishAt";
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Item | Por que ficou | Impacto se ficar |
|---|---|---|---|
| 1 | **Miniaturas no acervo (E18)** | A lista carrega a imagem INTEIRA para mostrar um quadrado de 80 px | Acervo com 20 fotos de 3 MB baixa ~60 MB para desenhar a tela |
| 2 | **Busca e filtro no acervo (E19)** | A listagem traz as 200 mais recentes, sem filtro por tipo, evento ou uso | Acervo grande exige rolar e comparar a olho |
| 3 | **Sincronizar todas as cópias de uma vez (E20)** | A sincronia é por patrocinador (ADR-111) | Instituição com muitas edições sincroniza uma cópia por vez |
| 4 | **Deduplicação por checksum exato** | Reencodar a mesma foto muda o conteúdo (ADR-107) | Uma foto reprocessada ocupa dois objetos — comportamento esperado, declarado na tela não |
| 5 | **Quota de armazenamento segue medida, não aplicada** | Fronteira com a F21 (ADR-112 / dívida C4) | O limite do plano é exibido sem ser imposto |

---

## 9. Checklist de aceite

- [x] **E14** — tabela `media_assets` com RLS + FORCE + policy, `tenantId` como fronteira
- [x] **E14** — todo envio (capa, logotipos, galeria) registra a imagem no acervo
- [x] **E14** — mesmo checksum reaproveita o registro e remove o objeto duplicado
- [x] **E14** — tela do acervo com uso por imagem, soma do storage e cópia da URL
- [x] **E14** — exclusão RECUSADA quando em uso, com a lista de onde ela está
- [x] **E14** — reuso no bloco de galeria por seletor do acervo
- [x] **E15** — a cópia guarda a origem e a tela mostra de onde veio
- [x] **E15** — sincronizar aplica só os dados da empresa e preserva cota, contrato e exibição
- [x] **E15** — "nada a sincronizar" quando não há diferença; origem removida desfaz o vínculo
- [x] **E16** — `unpublishAt` na condição de leitura (a página sai do ar sozinha)
- [x] **E16** — término antes do início e término vencido são recusados, com mensagem própria
- [x] **E16** — despublicar limpa as duas datas; estado `WINDOW_CLOSED` explicado na tela
- [x] **E17** — data interpretada no fuso do EVENTO, com conversão correta em horário de verão
- [x] **E17** — ida e volta do campo preserva a hora digitada; a mensagem diz o fuso usado
- [x] Toda mutação auditada (mídia, página, patrocinador), com resumo e sem dado sensível
- [x] Seed demonstra a janela de exibição completa (entrada e saída)
- [x] Testes novos: 20 unitários + 20 de integração + 5 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 6
- [x] `README.md`, `AGENTS.md` e `docs/dividas-tecnicas.md` atualizados
- [x] Imagem `eventflow/web:local` reconstruída e E2E rodando contra ela

---

**Aguardando APROVADO: AVANÇAR**
