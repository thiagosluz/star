# FASE 68 — o evento que não era de três dias (PLANO aprovado + investigação)

> **Estado: EM ANDAMENTO.** Este arquivo é a memória durável da fase: as decisões do humano, o que a
> **fatia 0 mediu** (com caminho:linha), as fatias, os riscos e os invariantes. O documento final
> (`docs/fase-68-*.md`) nasce na entrega, com ADRs, lições e evidências.

## 1. Decisões do humano (não reabrir)

1. **A chamada de trabalhos vira interruptor explícito por evento** ("Este evento recebe trabalhos"),
   ligando/desligando os campos da chamada — para o painel de prontidão (F53) e a vitrine
   distinguirem **"não usa"** de **"não configurou"**.
2. **O caminho antigo sobrevive, SEM prazo**: o painel continua aceitando "Nova submissão" por trilha
   (é o que os testes de revisão por pares exercitam), e **a `CallForProposals` (F33) passa a ser a
   única fonte da verdade** sobre "a chamada está aberta".
3. **As duas colunas do evento (`cfpOpensAt`/`cfpClosesAt`) são REMOVIDAS** numa migração, com os
   fixtures de integração ajustados. Coluna que ninguém escreve é como nasceram as três armadilhas
   que já nos morderam.
4. **O link da sala online entra nos DOIS**: no **evento** (criando o ESCRITOR da coluna que já
   existe) e na **atividade** (campo novo).
5. **Quem vê o link**: inscrição **CONFIRMED** + inscrição **retendo vaga** (`PENDING`) + a **equipe
   do evento**. **Lista de espera NÃO vê.** O endereço **nunca entra no HTML público**.
6. **O formulário do evento nasce com um dia** (início e término no mesmo dia), com hora explícita.
7. **O defeito de data em UTC na descrição/SEO do evento é consertado nesta fase** (fatia 4).

## 2. O que a fatia 0 mediu (fatos com caminho:linha)

### 2.1 A janela da chamada: DOIS caminhos vivos, que não se cruzam

| | Colunas do evento | Entidade F33 |
|---|---|---|
| Onde | `Event.cfpOpensAt`/`cfpClosesAt` (`prisma/schema.prisma:1622-1623`, migração `20260916201435_init`) | `CallForProposals` (`schema.prisma:2926`), janela em `:2942-2943`, `isPublished` em `:2946` |
| Régua | F4: `cfpClosesAt > agora` **apenas no filtro da consulta** | `callStateOf` (`src/domain/proposals/call-rules.ts:404-412`), aplicada em `src/lib/proposals/call-service.ts:158, 295-339, 347` e no servidor da escrita em `src/lib/review/submission-service.ts:243-294` (**só com `callId`**) |
| Portão no servidor | **NÃO EXISTE**: `CFP_CLOSED` é declarado em `submission-service.ts:90` e **nunca devolvido** (grep: só a declaração; nenhum teste o cita) | Existe |

Leitores das colunas do evento: `catalog-service.ts:127-128, 176-177, 376-377, 466-467, 579-580`;
`admin-actions.ts:237-238`; formulários `administracao/eventos/page.tsx:142-143` e
`.../eventos/[eventId]/dados/page.tsx:106-107`; filtros do F4 `submissoes/page.tsx:80-83, 90` e
`submissoes/nova/page.tsx:17, 43`; **prontidão** `.../eventos/[eventId]/page.tsx:118-119`.

Evidência no banco de dev: 365 eventos, 1 com cfp, 2 chamadas F33 publicadas — e **cada caminho tem
exatamente o que o outro não tem** (`congresso-2026`: 2 chamadas, 0 cfp; `evento-peer`: cfp, 0
chamadas). A tela de edição **já diz** que a janela mora em `/chamadas` (`dados/page.tsx:125-135`) e
mantém os dois campos acima. Existe ainda um **terceiro discurso**: o bloco `TRACKS`
(`src/components/events/block-renderer.tsx:903-947`) anuncia "Chamada de trabalhos" **sem janela,
sem estado e sem link**.

### 2.2 `Event.onlineUrl`: UM leitor, ZERO escritores

Coluna em `schema.prisma:1630`, criada na **primeira migração** (`20260916201435_init/migration.sql:241`).
**Leitor:** `VenueBlock`, `src/components/events/block-renderer.tsx:788` e `800-810` ("Acessar
transmissão online"), alimentado por `event-repository.ts:347, 527, 1004`. **Escritores:** nenhum —
`EventInput` (`catalog-service.ts:105-136`) não tem o campo, `saveEvent` não grava, nenhum formulário,
nenhum seed. Banco de dev: **0 de 365**.

**Consequência de segurança:** o leitor existe e **mostra o endereço a qualquer visitante anônimo**.
Logo, a fatia 3 **não é só criar o link**: é também **fechar** esse caminho para quem não tem lugar.

### 2.3 Duração e agrupamento: um evento de um dia NÃO quebra nada

Não existe **nenhum** rótulo de duração do evento no sistema. Os três formatadores de período do
evento já têm ramo de mesmo dia: `formatEventPeriod` (`src/domain/events/event-rules.ts:602-632`),
`formatTenantEventPeriod` (`src/domain/tenancy/tenant-event-groups.ts:360-385`) e `formatPeriod` do
certificado (`src/domain/certificates/certificate-rules.ts:469-495`).

**Único lugar estranho:** `.../administracao/eventos/[eventId]/page.tsx:228` escreve
`"{startsAt.toLocaleDateString('pt-BR')} a {endsAt.toLocaleDateString('pt-BR')}"` →
"05/11/2026 a 05/11/2026", **e usa o fuso do PROCESSO** (a família de defeito já consertada duas
vezes) → trocar por `formatEventPeriod`.

**Correção ao enunciado da fase:** a vitrine da F64 agrupa por **SITUAÇÃO**
(`UPCOMING | ONGOING | PAST`, `tenant-event-groups.ts:56, 136-174`), **não por data**. O `.ics` da
F65 nunca emite o evento como `VEVENT` (só atividades, `src/lib/calendar/ics.ts:212-213`). "Acontecendo
agora" decide por atividade no fuso do evento (`src/domain/agenda/now-rules.ts:167-168`).

### 2.4 O formulário do evento

Criar: `.../administracao/eventos/page.tsx` — `defaultStart = now + 30 dias` (`:52`); Término em
`:130-136` com **`início + 3 * 86_400_000` (`:135`)** — e a hora do início é a do **relógio de
render** (por isso "12:27"). Editar: `.../eventos/[eventId]/dados/page.tsx:88-122`. Validação de
forma: `admin-actions.ts:169-185`; de regra: `catalog-service.ts:148-154` (`endsAt <= startsAt` →
`INVALID_INPUT`). Grava: `saveEventAction` (`admin-actions.ts:187-270`) → `saveEvent`.
**Um evento 09:00→18:00 no mesmo dia já passa hoje.**

### 2.5 A visibilidade: reusar a FORMA, não a régua

- `registrationIsLive` (`src/domain/events/registration-rules.ts:336-338`) = `PENDING | CONFIRMED |
  WAITLISTED | ATTENDED` — **inclui a espera**, então **não serve**: a regra nova é derivada dela
  **menos `WAITLISTED`** (documentando a exclusão), numa função pura nova em `src/domain/events/`.
- **Equipe do EVENTO no servidor (o padrão a copiar):** `canOperateCheckIn`,
  `.../(public)/eventos/[eventSlug]/page.tsx:40-54` — `loadPrincipal` e `can(...)` com escopo
  `TENANT` **ou** `EVENT`. Trocar a permissão por `EVENT_UPDATE`/`EVENT_MANAGE`.
- **Posse resolvida no banco (o manifesto):** `resolveActivityViewer`,
  `src/lib/speakers/material-service.ts:848-889` (a régua dele é `CONFIRMED|ATTENDED` — **não** serve
  verbatim, mas a forma sim).
- **Inscrição do visitante:** `findMyRegistrationFor` (`src/lib/events/registration-service.ts:2345-2363`)
  — **sem filtro de status**; quem julga é a tela. `getMyAgenda` (`agenda-service.ts:261-334`,
  julgamento em `:209`) faz igual de propósito (`:256-259`).
- **O molde da decisão no servidor:** `.../(public)/eventos/[eventSlug]/page.tsx:203-218` (o "agora")
  + `happening-now.tsx:214-289` (`showBadgeLink`/`showCounterLink`). `happening-now.tsx`,
  `event-landing.tsx` e `block-renderer.tsx` **não têm `'use client'`** → o que não é renderizado
  **não chega ao HTML**. É assim que a invariante se cumpre: **não renderizando**.
- **Cuidado:** `HappeningNowView` é serializável e vai para o cliente → **o endereço não pode viajar
  nele**.

### 2.6 Modalidade

Coluna `modality`, enum `EventModality { IN_PERSON, ONLINE, HYBRID }` (`schema.prisma:112-116`), no
**evento** (`:1610`) e na **atividade** (`:1759`). O evento é exibido como **selo, sem endereço**
(`event-landing.tsx:280-284`, `tenant-page.tsx:313-317`, `public-event-list.tsx:97-101`).
**`Activity.modality` não tem leitor público nenhum** (nenhuma ocorrência em
`.../atividades/[activitySlug]/page.tsx`) → hoje "Online" na atividade não produz nada na tela.
O visitante lê "Online" e **não sabe onde entrar**. Rótulos em português **duplicados em três telas**
(`eventos/page.tsx:25-29`, `dados/page.tsx:14-18`, `programacao/page.tsx:43`) — unificar é escopo
extra, **não fazer sem autorização**.

## 3. Fatias

| # | Fatia | Entrega |
|---|---|---|
| 1 | **Chamada opcional** | O interruptor no evento (coluna booleana — o evento nunca teve flag; `settings` seria JSON opaco para um fato de primeira classe), os campos retirados dos dois formulários (a tela já aponta para `/chamadas`), a prontidão derivando de **chamadas publicadas da F33** (mata o falso alarme atual), o filtro do F4 deixando de ler `cfpClosesAt` (e ressuscitando `CFP_CLOSED` **de verdade**, devolvido pelo serviço), o bloco `TRACKS` se calando quando o evento não usa chamada, e a **migração que remove as duas colunas** |
| 2 | **Endereço da sala online** | O **escritor** de `Event.onlineUrl` (campo em `EventInput`/`saveEvent`/formulários) + campo novo `Activity.onlineUrl` (migração, `catalog-service.ts`, programação) + projeções (`event-repository.ts`, `PublicActivitySummary`) |
| 3 | **Visibilidade do endereço** | Regra pura nova (`CONFIRMED ∪ PENDING ∪ equipe`, derivada de `registrationIsLive`) + resolução no servidor na página do evento e na **aba "Acontecendo agora"** (`NowCard`) + **fechar o vazamento do `VenueBlock`** que hoje mostra o endereço a anônimo. O endereço **não entra** no HTML de quem não tem lugar, nem em props de Client Component, nem em metadados, nem no `.ics` |
| 4 | **Um dia como padrão** | Default explícito (09:00 → 18:00 no mesmo dia) na linha 135 + hora do início sem o minuto do render + `formatEventPeriod` no rótulo da raiz do painel + **o conserto do `timeZone: 'UTC'`** em `landing-page.ts:952-958` |
| 5 | **Catracas e documento** | Unidade da regra de visibilidade, integração por estado de inscrição e por instituição, E2E provando a **ausência do endereço no HTML** de quem não é inscrito (e a presença para quem é), portão WCAG AA sem isenção, regressão visual, `docs/fase-68-*.md` (ADR-341+) e as atualizações de `README.md`, `AGENTS.md` e dívidas |

## 4. Riscos medidos (a fatia 5 paga estes)

1. **Prontidão**: `tests/unit/f53-prontidao-e-areas.test.ts:94-103, 105-134, 157-164` prende os ids
   `chamada-sem-prazo`/`chamada-sem-trilha` e o alvo `calls-link`; `tests/e2e/f53-painel-e-areas.spec.ts:88-104`
   afirma que o evento novo **não** tem `event-readiness-ok`. Mudar os fatos exige atualizar os dois.
2. **Selo de contagem**: `tests/e2e/f53-painel-e-areas.spec.ts:153` faz `toHaveText('nenhuma chamada')`
   — texto exato, catraca proposital.
3. **Regressão visual (21 linhas)**: `evento-aba-agora.png` (teste 19, `:1832-1838`) muda se o link
   entrar na aba do agora; `abrirAbaDoAgora` (`:1798-1827`) afirma **exatamente um** `agora-cracha-*`
   e **exatamente um** `agora-balcao-*` — nome novo com prefixo parecido quebra a contagem. O
   `VenueBlock` **não** atinge baseline (com `?aba=agora` os blocos não são renderizados,
   `event-landing.tsx:395-423`): prendê-lo exige **criar** uma linha de base.
4. **Portão WCAG AA**: cobre a aba "programação" (`:1199-1229`) e "acontecendo agora" (`:1231+`). Link
   novo dentro de cartão é a família do defeito da F66 → usar token do tema (`ef-muted-on-card`,
   `ef-button`), **nunca `opacity`**. A tela `.../[eventId]/dados` **não** está no portão.
5. **E2E presos a rótulo**: `platform-journey.spec.ts:110-125` preenche "Início"/"Término"
   explicitamente (não depende do default — a fatia 4 **não** o quebra, mas mexer nos `label` quebra);
   `rubric-criteria.spec.ts:125, 182` depende de "Chamada de trabalhos" e do `calls-link`.
6. **Remover os campos toca o caminho de TODOS os E2E que criam evento pela UI.** E
   `tests/integration/peer-review.test.ts:242-243` e `rubric-freeze.test.ts:258-259` criam eventos
   **com a janela** direto no banco → com a remoção das colunas, os dois fixtures mudam.
7. **Contrato de banco**: campos novos em `events`/`activities` não criam tabela nem RLS nova
   (armadilha 101 só vale para tabela nova); `npm run db:verify` confere privilégios.

## 5. Invariantes que esta fase NÃO pode quebrar

- **O que se oculta fica oculto**: o endereço **não é renderizado** para quem não tem lugar — nada de
  `hidden`/CSS/JS como única barreira.
- **A lista de espera não tem lugar** → não recebe endereço de sala.
- **Permissão `:own` exige posse explícita**, negação *fail-closed*.
- **Runtime só por `withTenant`**; nada de `adminPrisma`; sem `any`; erros como valor; comentários
  explicam **POR QUE**; tudo em português.
- **Nenhuma isenção nova** no portão; catraca nova só vale **provada por mutação**.
- **Regenerar linha de base visual nunca é o primeiro recurso**: medir a caixa dos pixels diferentes
  antes (a F66 e a F67 registraram esse preço).
- Bateria da §4 do `AGENTS.md` antes de declarar concluído, com os **números reais**.

## 6. Estado das fatias (atualizado durante a execução)

- **Fatia 0 — CONCLUÍDA** (read-only): os dois caminhos da janela da chamada, o `onlineUrl` com um
  leitor e nenhum escritor, e a ausência de rótulo de duração estão medidos no §2.
- **Fatia 1 — ENTREGUE**: `Event.usesCall` (Boolean, NOT NULL, default false; `saveEvent` **não**
  desliga quando o campo vem ausente); os dois campos de data saíram dos dois formulários; a
  prontidão passou a derivar de **chamadas publicadas** (`hasPublishedCall`/`callWithoutDeadline`);
  o **`CFP_CLOSED` passou a ser devolvido de verdade** (`src/domain/events/call-optional-rules.ts` +
  `submission-service.ts:243-262`) — o prazo existia só no filtro da tela; o bloco `TRACKS` ganhou
  três saídas (`SILENT`/`INVENTORY`/`ANNOUNCE`); a migração
  `20261006101717_f68_usescall_e_fim_da_janela_do_evento` **removeu as duas colunas** com
  `migrate diff --exit-code` = 0 (zero drift); catracas da F53/F54 atualizadas **ganhando asserções**;
  `npm test` **3358 passando**. Abertos declarados: `saveCall` não liga o interruptor (autorizado a
  ligar na fatia 2) e o `prisma/seed.ts` intocado (o evento do seed com chamadas deveria nascer com
  `usesCall: true` para o bloco aparecer na página pública).
- **Fatias 2 e 3 — na árvore, relatório pendente**: migração
  `20261006134940_f68_endereco_da_sala_online` (endereço na atividade), regra pura
  `src/domain/events/online-room-rules.ts`, resolução no servidor
  `src/lib/events/online-room-service.ts`, e as três provas escritas (`tests/unit/f68-sala-online.test.ts`,
  `tests/integration/f68-sala-online.test.ts`, `tests/e2e/f68-sala-online.spec.ts`), com
  `block-renderer.tsx`, `happening-now.tsx` e `event-repository.ts` ajustados.
- **Fatias 4 e 5 — EM ANDAMENTO** no fechamento (o dia como padrão, os dois consertos de data, as
  telas novas no portão, a regressão visual com medição, o documento com ADR-341+ e a bateria).
- **A bateria completa da §4 ainda NÃO foi rodada por mim** para esta fase; os números desta sessão
  são os das fatias (Vitest 3358) e o E2E depende de `docker compose --profile app up -d --build web worker`
  (a imagem estava com 44 h — armadilha da §4).
