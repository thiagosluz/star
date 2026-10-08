# FASE 70 — a inscrição que não deixa buraco · o formulário que o organizador monta (PLANO)

> **Estado: PLANO APROVADO, aguardando armar o objetivo** (a ferramenta de objetivo exige turno
> humano direto e o pedido veio numa continuação automática). As decisões abaixo são do humano.

## As decisões do humano

1. **O defeito**: inscrever-se numa atividade com inscrição própria **materializa a inscrição no
   evento**, e o conserto é **mover a reserva de vaga** — NÃO criar a linha "só criando a linha".
2. **A brecha do vínculo**: `registrationRequiresMembership` passa a ser aplicado **NO SERVIDOR**
   nesta fase.
3. **Tipos de campo**: **allowlist** (texto curto, escolha única, Sim/Não, número, data) **com texto
   livre liberado e AVISO** na tela do organizador; os tipos sensíveis ficam **proibidos por
   construção**.
4. **Eliminação**: entra — a pessoa pode **apagar as respostas sem cancelar a inscrição**.

## O que a investigação mediu (o mapa, com caminho:linha)

**É BURACO, não regra** — nenhum documento, ADR ou teste afirma que inscrever-se numa atividade
dispensa a inscrição no evento. O que **é** declarado é o crachá aceitar quem tem inscrição no evento
**ou** em atividade (`credential-service.test.ts:249`, comentário em `:233-238`, texto em
`meu-cracha/page.tsx:111-112`).

- **Onde se decide**: `registration-actions.ts:126` → `registration-service.ts:245` (`:311`
  `attemptRegistration`) → `domain/events/registration-rules.ts:180`. A entrada de `decideRegistration`
  (`:155-170`) **não tem conceito de "inscrição no evento"**.
- **Trilha de checagens** (`attemptRegistration`): `:339` evento · `:367` atividade · `:384-389`
  aberta → `ACTIVITY_OPEN` · `:392-410` janela · `:421-432` vínculo · `:450-477` duplicidade ·
  `:480-506` vaga da ATIVIDADE · **`:520-529` vaga do EVENTO (já reserva!)** · `:531` vínculo.
- **`EVENT_AUTO` só nasce de inscrição no EVENTO** (`:1440-1453`, `:1531-1544`); os **6**
  `registration.create` do `src/` estão nesse arquivo. **Não existe caminho atividade → evento.**
- **Medido no banco de dev**: **3 de 3 (100%)** das inscrições em atividade sem inscrição no evento
  (`PENDING 1 · CONFIRMED 1 · ATTENDED 1`; `congresso-2026`: `capacity NULL`, `confirmedCount 2`,
  linhas vivas 3, linhas do evento 0).
- **Consequências reais**: quem só entrou numa oficina **pode emitir o certificado de participação do
  evento** (`certificate-service.ts:129-132` + `attendance-service.ts:261-263`) e o emite **sem CPF**,
  porque o CPF só é lido da linha do evento (`:603-612`, `:642`) e a atividade não tem campo de CPF;
  o **painel conta LINHAS** (`catalog-service.ts:409/426`, `:618/699`) misturando atividade e evento;
  a **catraca** `registration-confirmation.test.ts:686-700` prende `confirmedCount` contando as duas.
- **`registrationRequiresMembership` é só de tela** (`atividades/[activitySlug]/page.tsx:650`,
  `inscricao/page.tsx:306`); nem `guardSelfServiceAction` (`guard-action.ts:153-188`) nem os dois
  `attempt*` conferem.
- **Correção à minha premissa**: **não existe** política de confirmação de vaga por EVENTO —
  `confirmationPolicy`/`confirmationWindowDays` são colunas de `Activity` (`schema.prisma:1816`); o
  evento só tem a retenção de 48 h da promoção da fila (`registration-rules.ts:125-129`).

## O formulário — onde vive e o que reusar

- **Hoje**: tela `(public)/eventos/[eventSlug]/inscricao/page.tsx` (`:335-340`) + cliente
  `event-registration-form.tsx` (campos: `cpf` `:127-152`, `accessibilityNotes` `:154-173`,
  `consentData` `:178-184`, `consentImage` `:186-192`); zod na action (`registration-actions.ts:238-250`);
  **o serviço recebe `formResponses` opaco** (`registration-service.ts:1092`, grava em `:1327`);
  depósito `registrations.formResponses` Json (`schema.prisma:2647`). **Leitor único: o CPF do
  certificado** (`certificate-service.ts:603-612` → `registration-form-rules.ts:78`).
  **`dietaryNotes` é coluna morta** (`schema.prisma:2644`) — a dieta é digitada em `accessibilityNotes`.
- **Precedentes a somar**: `PROPOSAL_KIND_FIELDS` + `validateProposalData` (catálogo em CÓDIGO e
  validador que devolve **só o aceito** — `domain/proposals/call-rules.ts:164-275`, `:304-360`) e o
  editor de blocos (validação **por tipo** em zod, `landing-page.ts:452`, `:583-596`). Mais o leitor
  **tolerante** de `Event.settings` (`public-registration-rules.ts:162-172`) — config por evento
  **sem migração**, inválido cai no padrão. **O que nenhum tem: a lista ser DADO do evento.**
- **Anti-precedente a respeitar**: `domain/communication/segments.ts:71` — um tipo a mais abriria a
  porta para um filtro que ninguém explica.
- **Dado pessoal**: a ocultação **não lê** `formResponses` (o risco é o texto livre *carregar* o dado
  que a ocultação protege); o CSV da F49 tem allowlist fixa que **não** inclui CPF nem `formResponses`
  (ordem das colunas é contrato — `participant-service.ts:355-371`); o pacote do perfil público tem
  teste de igualdade que **reprova em vez de vazar**; a ficha 360 não seleciona `formResponses` e
  abrir a ficha entra na trilha; **não existe exclusão de inscrição** (cancelar é `status='CANCELED'`,
  `registration-service.ts:1742-1748`).

## Fatias

| # | Fatia | Entrega |
|---|---|---|
| 1 | **Domínio puro do formulário** | `registration-form-rules.ts`: spec de campo (`key/label/type/required/options/maxLength/help/finalidade`) + `validateFormResponses(fields, raw)` devolvendo **só o aceito** + `readRegistrationForm(settings)` tolerante. Allowlist de tipos, texto livre com finalidade declarada, sensíveis **proibidos** |
| 2 | **A inscrição automática com a reserva MOVIDA** | `ensureEventRegistration(...)` no serviço reaproveitando `attemptEventRegistration`; a inscrição na atividade **deixa de reservar** vaga de evento e a linha do evento passa a reservar (idempotente por `(eventId,userId)`); evento lotado → **fila do evento** (`:1267-1313`); consentimentos copiados; CPF declarado como "só na inscrição do evento, completável depois"; revisar a catraca `registration-confirmation.test.ts:686-700` e o E2E `registration-journey.spec.ts:474` |
| 3 | **`registrationRequiresMembership` no servidor** + tela do organizador do formulário | A checagem no(s) caminho(s) de escrita, com a mensagem que a tela já usa; e a tela em `eventos/[eventId]` para criar/ordenar/remover campos, com `EVENT_UPDATE` e trilha |
| 4 | **Fim a fim + dado pessoal** | A action valida e grava; o componente renderiza os campos declarados (com `values` de volta para não apagar o digitado); **eliminação das respostas sem cancelar a inscrição**; decisão escrita: não sai no CSV nem no perfil público; e o aviso ao organizador sobre texto livre |
| 5 | **Catracas e documento** | Unidade do validador; integração do fluxo automático (inclusive **fila** e **idempotência**) e da eliminação; E2E do formulário; **caso novo no portão WCAG AA para a tela de inscrição** (hoje fora do portão); `docs/fase-70-*.md` (ADR-347+); README/AGENTS/dívidas |

## Riscos medidos (a fatia 5 paga estes)

- **Dupla contagem de vaga** se a linha automática nascer sem mover a reserva → catraca
  `registration-confirmation.test.ts:686-700` reprova e o evento "encolhe" duas vezes por pessoa.
- **CPF perdido** no certificado de quem só passou pela atividade (E54).
- **`f56-fatia-3.spec.ts:159`** usa **igualdade** sobre `formResponses` → campo novo quebra por
  motivo legítimo; o teste muda **na mesma fatia**.
- **A tela de inscrição não está no portão nem tem linha de base visual** → campo novo nasce sem
  catraca; é preciso criar as duas.
- **`Event.capacity` default 0 × NULL** — a medir: se nascer 0 (= esgotado por
  `SEAT_AVAILABLE_PREDICATE`, `registration-rules.ts:376`), o caminho de atividade pode estar sendo
  recusado por "lotação do evento" desde o primeiro dia.

## Invariantes

- **Uma reserva por pessoa por evento** (a vaga do evento é da linha do evento, nunca das duas).
- **Nunca recusar a atividade por lotação do evento**: enfileira.
- **O vínculo é conferido no SERVIDOR**, não só na tela.
- **Campos sensíveis proibidos por construção** — não por aviso.
- **O que se oculta fica oculto**: respostas **não** entram no HTML público nem no perfil público.
- Sem `any`, `kebab-case.ts`, erros como valor, comentários explicam **POR QUE**, tudo em português.
- **`AGENTS.md` ≤ ~64.800 bytes** (o harness corta em 65.244 e o corte apaga conteúdo em silêncio).

## Estado resgatado (agentes que morreram sem relatar)

**Dois agentes morreram sem relatório**: o da FATIA DO DEFEITO (caminho crítico) e o dos dois
fechamentos (chave derivada do rótulo + selo de contagem). **Verifiquei a árvore depois das mortes**:

- `npm run typecheck` -> limpo; `npm run lint` -> limpo.
- `npx vitest run tests/unit/f70-formulario-do-evento.test.ts tests/unit/f70-formulario-do-organizador.test.ts tests/integration/f70-atividade-materializa-evento.test.ts`
  -> **3 arquivos / 99 casos passando**. O teste de integração do defeito EXISTE e passa.

Ou seja: o trabalho foi escrito, mas **os relatórios não vieram**. O que segue **NÃO confirmado** por
medição minha e precisa ser conferido por quem retomar:

1. se as catracas revisadas pelo agente do defeito ficaram verdes (`registration-confirmation.test.ts`,
   `public-registration.test.ts`, `tests/e2e/registration-journey.spec.ts`) — a suíte completa **não** foi rodada;
2. se a reserva de vaga foi de fato MOVIDA (uma reserva por pessoa por evento) e se a fila do evento
   é o caminho quando ele está lotado (o invariante central da fase);
3. se `registrationRequiresMembership` passou a ser conferido NO SERVIDOR, e onde;
4. se a chave derivada do rótulo foi acrescentada ao domínio (`registration-form-spec-rules.ts` foi
   tocado às 14:37) e se ela PRESERVA a chave já gravada (com teste);
5. se o selo de contagem da área `formulario` entrou e se a catraca da F54 continua verde;
6. **o número da capacidade** (`Event.capacity` 0 x NULL) que a fatia do defeito devia medir ANTES de codar.

Faltam ainda as fatias 4 (leitura pelo participante + ELIMINAÇÃO das respostas) e 5 (portão WCAG da
tela de inscrição, documento, estado e a bateria completa).
