# FASE 31 — Credenciamento e frequência por crachá

> **Tema:** o crachá deixou de ser um campo que ninguém emitia e passou a ser o que ele
> é na porta do evento: **um código por pessoa**, lido pela câmera do celular ou por um
> leitor USB, com o monitor escolhendo ONDE a leitura vale. E o sistema passou a
> distinguir dois fatos que estavam misturados: **chegar ao evento** e **estar na
> atividade**.
>
> O pedido do humano, nas palavras dele: *"no credenciamento tem a implementação do
> leitor de qrcode usando a câmera do computador ou celular, onde os monitores poderão
> fazer a leitura dos qrcodes dos crachás, para isso precisa de uma área onde mostrará
> todos os participantes inscritos no evento e nas atividades, e com a possibilidade de
> emitir individual ou em massa os qrcodes para crachás. no crachá é bom ter na etiqueta
> além do qrcode, o Código do crachá, nome da pessoa. na área do participante, gerar um
> crachá online, para o próprio participante exibir. existe uma diferença entre fazer
> credenciamento e coletar frequência? como coletar para as atividades diferentes que os
> participantes possa ter? temos que criar um fluxo que seja fácil para os monitores que
> vão trabalhar com essa parte. é um crachá só?? ou um qrcode para cada atividade?"*

---

## 1. Sumário executivo

| Entrega | Item | Arquivo-chave |
|---|---|---|
| **Crachá por pessoa no evento** (`event_credentials`), com código opaco `CR-XXXX-XXXX` | Crachá | `credential-rules.ts`, migração `20260921200000` |
| **Área de crachás**: todos os inscritos (no evento e nas atividades) + quem recebeu à mão, com emissão individual/em massa | Operação | `credenciamento/crachas/page.tsx`, `credential-service.ts` |
| **Folha de crachás em PDF** (A4, 8 por página): QR Code, **código do crachá** e **nome** | Impressão | `badge-renderer.ts`, rota `.../crachas/folha` |
| **Modo monitor**: contexto (portaria × atividade) + leitura por **câmera** (API nativa + `jsqr`), leitor USB ou digitação, com feedback grande | Balcão | `monitor-console.tsx`, `qr-camera-reader.tsx` |
| **Credenciamento ≠ frequência**: a chegada é um fato; a sessão na atividade é outro, com entrada, saída e minutos | Modelo | `credential-service.ts`, `attendance-rules.ts` |
| **Presença de quem não tem inscrição** é registrada, com aviso na tela | Regra | `recordCredentialPresence` |
| **Janela da atividade** respeitada (`checkInEnabled`/`checkInOpensAt`/`checkInClosesAt`), que **nenhum caminho consultava** | Regra | `canRecordAttendance` |
| **Minutos com teto no fim da atividade** (o esquecimento não vira tempo) | Correção | `sessionMinutes`, `checkOut` |
| **Fechamento automático** das presenças abertas no worker + botão no painel | Operação | `attendance-sweep.ts`, `src/workers/index.ts` |
| **Crachá online** do participante (QR na tela, com o código por extenso) | Participante | `meu-cracha/page.tsx`, `own-badge.tsx` |
| **Revogação** com motivo na trilha; o crachá segue identificando a pessoa e deixa de valer | Operação | `revokeCredential` |
| Guarda de Server Action **compartilhada**, com escopo de EVENTO (a equipe do dia) | Plataforma | `guard-action.ts` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **16** — 1 de domínio (regras do crachá), 1 migração, 4 de aplicação (serviço, varredura, guarda, primitivas de PDF), 1 renderizador de PDF, 4 de UI, 1 rota, 2 páginas novas, 3 de teste, 1 documento de fase |
| Arquivos alterados | **17** (credenciamento, navegação, regras de presença, serviço de presença, renderizador de certificado, fila de e-mail, worker, seed, schema, contrato de RLS, `package.json`/`package-lock` do `jsqr`, E2E da jornada, README, AGENTS, dívidas, armadilhas) |
| Migrações | **1** — `20260921200000_event_credentials` (tabela + enum + backfill do legado) — total **25** |
| Tabelas de tenant | **39** sob RLS + FORCE |
| Permissões | 58 (nenhuma nova: o balcão usa `registration:checkin`/`checkout`, a emissão usa `attendance:manage`) |
| Dependências novas | **1** — `jsqr` (MIT, ~30 kB, decodificador local; a API nativa do navegador é tentada primeiro) |
| ADRs | **148 … 152** (a próxima é a 153) |
| Testes novos | 30 unitários + 26 de integração + 5 E2E = **61** |
| Testes | **1587** (Vitest, 67 arquivos) · **102** (Playwright E2E) |
| Defeitos reais encontrados | **6** (crachá que ninguém emitia; segunda visita bloqueada; rota derrubando o build; relógio impuro no render; teste medindo sessão alheia; crachá legado invisível por causa da caixa) |
| Dívidas quitadas | nenhuma deste levantamento — o escopo veio do humano; a fase declarou **E40**, **E41**, **E42** e **E43** |

---

## 2. O problema mais difícil: **creditar e frequentar eram o mesmo clique**

A FASE 3 modelou o credenciamento e a FASE 7 entregou a tela. As duas coisas tratavam
**um** fato só: `checkIn(registrationId)` marcava `registration.checkedInAt` e criava uma
linha em `attendances` com o `activityId` **daquela inscrição**.

Isso funciona enquanto "credenciar" e "marcar presença na atividade" forem a mesma
coisa. No evento, não são:

| Fato | Pergunta | Quantas vezes | O que alimenta |
|---|---|---|---|
| **Credenciamento** | "esta pessoa chegou (e o crachá é dela)?" | uma, na portaria | XP de check-in, fila do balcão, "quem veio" |
| **Frequência** | "esta pessoa esteve NESTA atividade, por N minutos?" | uma por visita, por atividade | carga do certificado (FASE 6), peso do sorteio (FASE 16/30), carta de presença total (FASE 16) |

Três defeitos concretos nasciam dessa mistura:

1. **Credenciar na portaria não registrava frequência nenhuma.** A inscrição do evento
   tem `activityId` nulo, então a presença criada também — e é a presença COM atividade
   que compõe certificado, sorteio e carta. O organizador credenciava 300 pessoas e o
   certificado de ninguém tinha carga;
2. **O crachá morava na inscrição.** Como a inscrição é por (pessoa × evento) **e** por
   (pessoa × atividade), quem se inscrevia no evento e em dois minicursos tinha **três**
   `badgeToken` diferentes — e a portaria não sabia qual ler;
3. **A janela de credenciamento da atividade não era consultada por ninguém.**
   `checkInEnabled`, `checkInOpensAt` e `checkInClosesAt` existiam desde a FASE 3 e
   nenhum caminho os lia: dava para desligar o credenciamento de uma atividade e
   continuar credenciando nela, sem aviso.

E um quarto, que só apareceu quando fui ver o que existia: **nenhum caminho do sistema
gerava `badgeToken`**. A tela tinha o campo, o serviço tinha a busca por token, os testes
gravavam o token à mão — e a emissão do crachá não existia. Era a mesma classe de defeito
que a FASE 29/30 encontraram: a funcionalidade descrita numa ponta e nunca produzida na
outra.

---

## 3. Decisões técnicas

### 3.1 Um crachá por pessoa, e o CONTEXTO na leitura

O crachá é da PESSOA no EVENTO: `event_credentials` tem um código por par
(evento, pessoa), e o monitor escolhe **onde a leitura vale** — a portaria do evento ou a
atividade que está acontecendo.

Por que não um QR por atividade: o crachá é impresso **antes** do evento (a grade ainda
muda); a pessoa é a mesma na porta; e a linha de presença já é por (pessoa × atividade),
então é o CONTEXTO que decide onde gravar, não o código lido. Imprimir N etiquetas por
pessoa também faria a pessoa procurar o QR certo na fila — o pior lugar para isso.

### 3.2 O que é gravado em cada contexto

| Contexto | O que grava | Chave de idempotência |
|---|---|---|
| **Portaria** | presença com `activityId` nulo **+** `registration.checkedInAt` da inscrição no evento (quando existe) — via `checkIn`, que é quem credita XP e alimenta a fila | a inscrição/chegada: uma por pessoa |
| **Atividade** | **uma sessão por visita**: `attendances` com `activityId`, `registrationId` (quando há inscrição), `checkedInAt`, `checkedOutAt` e minutos | a SESSÃO aberta, não a inscrição |

Essa diferença é o coração da fase — e foi ela que produziu o defeito nº 2 das lições
(ver §5): usar a inscrição como chave de idempotência da frequência faz a SEGUNDA visita
à mesma atividade não abrir sessão nenhuma.

### 3.3 Os minutos têm teto no fim da atividade

A regra antiga era `minutos = agora − entrada`. Quem esquecia de registrar a saída saía
com o tempo todo: a oficina de 60 min rendia 180 minutos na conta — e é essa conta que
**pesa no sorteio** (chance proporcional ao tempo), que compõe a **carga do certificado**
e que decide a **carta de presença total**.

Agora existe uma regra só, no domínio (`sessionMinutes`), com dois tetos: o fim da
atividade e um limite absoluto de 12 h. Ela vale nos três caminhos — saída pelo balcão,
fechamento automático e a varredura do worker — porque duas versões da mesma regra
divergem (armadilha 55).

### 3.4 A câmera: API nativa com decodificador local de reserva

`BarcodeDetector` (Chrome/Edge/Android) é tentada primeiro: rápida, sem bundle, roda no
hardware quando há suporte. Onde ela não existe (**Firefox e Safari**), entra o `jsqr` —
decodificador em JavaScript, empacotado no projeto, **sem rede** (MIT, ~30 kB).

O leitor USB continua sendo o caminho mais rápido do balcão, e ele "digita" no campo
focado: o campo de texto atende os três caminhos (câmera, USB e digitação à mão), e por
isso não foi removido. A tela declara qual decodificador está em uso (`data-decoder`),
porque quando um crachá não é lido quem opera precisa saber por onde a leitura está indo.

A leitura roda a cada **400 ms** (e não a 60 fps): a câmera fica aberta o evento inteiro, e
decodificar quadro a quadro esquentaria o celular do monitor sem ganho — ninguém passa um
crachá em 16 ms. O mesmo código lido de novo é ignorado por 2,5 s, senão o mesmo crachá
viraria entrada e saída no mesmo segundo.

### 3.5 O fluxo do monitor não pede confirmação

Com fila, um "confirma?" por pessoa dobra o tempo de cada leitura. O que protege contra o
erro é o contrário: o resultado aparece **grande**, com o **nome** e o que aconteceu
(entrada/saída/minutos/avisos), e o monitor vê na hora que leu o crachá errado. O botão
principal é único e decide sozinho — entra quem está fora, sai quem está dentro.

O contexto vem **primeiro** na tela (e a atividade que está acontecendo já vem sugerida,
pelo relógio do banco): escolher depois da leitura seria pedir ao monitor que guardasse na
cabeça o que ele acabou de ler.

### 3.6 O fechamento automático roda no worker, e grava o FIM da atividade

Quem esquece de sair é fechado por uma varredura periódica (`attendance-sweep`), agendada
no worker que já existe — a mesma fila de manutenção que varre prazos de parecer. A
varredura é cross-tenant (lista os tenants ativos e abre uma transação por instituição com
`withTenant`; a RLS continua valendo) e grava `checkedOutAt = fim da atividade`, nunca a
hora em que ela rodou: o número tem de ser o mesmo todas as vezes que a conta for refeita.
Há também o botão no painel, que usa a MESMA regra.

### 3.7 Uma regra só para presença: `checkIn`/`checkOut` continuam sendo o caminho

Quando a pessoa TEM inscrição no contexto, quem grava é o serviço de presença de sempre —
XP, cartas, fila do balcão e conquista de presença total continuam vindo de um lugar só.
Sem inscrição, a sessão é gravada direto pelo serviço de crachá (com aviso na tela): a
presença de quem apareceu sem inscrição é um **fato real**, e recusá-la na porta seria
pior que registrá-la.

### 3.8 A leitura repetida do MESMO crachá (a pergunta do balcão)

A pergunta que a operação faz — *"e se a pessoa já foi credenciada e eu ler de novo?"* — tem
resposta diferente por modo de leitura, e é o **estado da pessoa NAQUELE contexto** que decide:

| Estado no contexto escolhido | `IN` (entrada explícita) | `TOGGLE` (o botão único do balcão) | `OUT` ("Registrar saída") |
|---|---|---|---|
| **Fora**, primeira vez e com inscrição | Entrada — pelo `checkIn` de sempre (marca a inscrição, credita XP) | Entrada | "não tinha entrada registrada neste contexto" |
| **Fora**, mas já credenciada antes (sessão já fechada) | **Entrada NOVA** — outra visita, **sem XP de novo** | **Entrada NOVA** — outra visita, **sem XP de novo** | "não tinha entrada registrada neste contexto" |
| **Dentro** (sessão aberta) | "Entrada já registrada às HH:MM" (`ALREADY_INSIDE`) — **nada é gravado** | **SAÍDA**: fecha a sessão, com os minutos | Saída |

Quem fecha a sessão de uma entrada repetida é a **sessão aberta**, nunca a inscrição: é por
isso que a pessoa pode entrar e sair várias vezes no mesmo dia e cada visita vira uma linha
com os próprios minutos (ADR-149). E o XP não se repete em nenhuma das leituras, porque ele
é creditado por **fato** (chave de idempotência), não por leitura.

**A parte incômoda, dita em voz alta:** a tela manda `TOGGLE` no botão principal, então no
balcão o "já credenciado" **não aparece** — ler duas vezes quem já está dentro **fecha a
chegada**. O serviço responde `ALREADY_INSIDE` para quem pede entrada explícita (`IN`), e
nenhum caminho da tela pede. Na prática o erro é pequeno (o painel diz "Saída registrada"
com os minutos, e a câmera ignora o MESMO código por 2,5 s, o que impede o bipe duplo do
leitor de virar saída), mas a distinção depende de o monitor ler o painel. A possibilidade de
pedir **só entrada** na tela ficou registrada como dívida **E43**.

---

## 4. ADRs

### ADR-148 — O crachá é da PESSOA no EVENTO, e o contexto da leitura decide o fato

**Contexto.** O código do crachá vivia na inscrição (`Registration.badgeToken`), e a
inscrição existe por (pessoa × evento) e por (pessoa × atividade). Na prática, uma pessoa
inscrita no evento e em dois minicursos teria três crachás.

**Decisão.** `event_credentials` guarda **um** código por par (evento, pessoa), único
globalmente (a busca não depende de contexto; a RLS limita à instituição). O monitor
escolhe o contexto — portaria ou atividade —, e é ele que decide onde o fato é gravado.
`registrations.badgeToken` fica como **legado congelado**, e a migração traz cada token
existente para a tabela nova (a inscrição no evento tem preferência).

**Consequências.**

- Um crachá serve para todas as atividades; a etiqueta é impressa uma vez;
- A leitura aceita o código novo, o código legado (backfill) e o token antigo ainda na
  coluna da inscrição — nada que já foi impresso deixa de funcionar;
- A presença continua por (pessoa × atividade), então o histórico e as contas
  (certificado, sorteio) não mudaram de forma;
- **Custo aceito**: uma tabela a mais e a leitura com um parâmetro de contexto.

### ADR-149 — Credenciamento e frequência são fatos distintos

**Contexto.** Um clique marcava "chegou" e criava presença com o `activityId` da
inscrição. Credenciar na portaria (inscrição do evento, `activityId` nulo) não registrava
frequência em atividade nenhuma — e é a frequência que compõe a carga do certificado, o
peso do sorteio e a carta de presença total.

**Decisão.** Dois fatos, dois registros: a **chegada** é presença com `activityId` nulo
(mais a inscrição do evento marcada, para a fila e para o XP de check-in); a **frequência**
é uma sessão por visita, com entrada, saída e minutos, ligada à inscrição da atividade
quando ela existe.

**Consequências.**

- O certificado e o sorteio passam a ver a frequência real, mesmo quando ninguém passou
  pela portaria — e vice-versa;
- A pessoa pode entrar e sair da mesma atividade (almoço, sessão dupla): cada visita é uma
  sessão, e os minutos somam;
- **Custo aceito**: a tela de balcão precisa dizer ONDE a leitura vale, e o monitor tem de
  escolher o contexto.

### ADR-150 — Os minutos de uma sessão têm teto no fim da ATIVIDADE

**Contexto.** `checkOut` calculava `agora − entrada`, premiando o esquecimento: a oficina
de 60 min rendia 180 minutos para quem não registrava a saída, e essa conta é a que pesa
no sorteio e compõe a carga do certificado.

**Decisão.** `sessionMinutes` (domínio) limita os minutos ao **fim da atividade** e a um
teto absoluto de 12 h, e é usada pela saída no balcão, pelo fechamento automático e pela
varredura do worker.

**Consequências.**

- O esquecimento deixa de inflar tempo, sorteio e certificado;
- Uma sessão registrada **depois** do fim da atividade rende 0 minuto (o teto vale nos dois
  sentidos) — e a tela mostra o número, em vez de escondê-lo;
- **Correção de comportamento existente**: é uma mudança deliberada da conta de quem já
  usava o sistema, documentada no documento da fase.

### ADR-151 — Leitura fora da inscrição REGISTRA e AVISA

**Contexto.** A presença em atividade só existia por inscrição. No evento, gente aparece
na oficina sem inscrição (lista de espera, convite de última hora, participante que trocou
de sala).

**Decisão.** A leitura registra a presença mesmo sem inscrição e devolve **aviso** na tela
("presença registrada SEM inscrição nesta atividade"); a sessão nasce com
`registrationId` nulo. Inscrição em lista de espera ou pendente também é registrada, com o
aviso dizendo qual é a situação.

**Consequências.**

- A fila não para por causa de uma inscrição que não existe — a organização decide depois,
  com o aviso na frente;
- O que NÃO acontece sem inscrição: XP (não há chave de idempotência nem inscrição para
  creditar) — e a tela não promete recompensa quando não há;
- **Trade-off aceito**: registrar a mais é corrigível (a presença tem `validatedById` e a
  trilha); negar acesso a quem está na porta não é.

### ADR-152 — O QR carrega SÓ o código; a etiqueta leva nome e código porque é para GENTE

**Contexto.** A etiqueta precisa identificar a pessoa para quem está na porta, e o QR
precisa ser lido por câmera, leitor USB e digitação.

**Decisão.** O conteúdo do QR é o **código**, e nada mais (nada de nome, e-mail ou
identificador de pessoa). A etiqueta impressa leva **QR + código por extenso + nome**. O
alfabeto do código não tem `I`, `L`, `O`, `U`, `0` nem `1` — o crachá é digitado à mão
quando o leitor falha.

**Consequências.**

- Nenhum dado pessoal circula em papel nem em aplicativo de leitor de terceiros (o mesmo
  cuidado do código `P-…` da lista publicada da FASE 29);
- O código é digitável sem ambiguidade, e o crachá online mostra o código por extenso
  embaixo do QR para o leitor que não enxerga tela;
- **Custo aceito**: uma câmera genérica de celular não "abre" nada ao ler o crachá (é um
  código, não uma URL) — e isso é intencional: o QR do crachá é para o sistema da
  organização, não para o navegador de quem passa.

---

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| O crachá não existia na prática: nenhuma tela emitia, e o `badgeToken` só aparecia em teste e no seed | O campo era **lido** por todos (busca da fila, check-in por token) e **escrito por ninguém** — a emissão nunca foi implementada. Mesma classe dos defeitos da FASE 29/30: a funcionalidade descrita numa ponta e não produzida na outra | `event_credentials` + `issueCredentials` + a área de crachás, com emissão individual, em massa e o crachá online do participante. **Campo que todo mundo lê e ninguém escreve é funcionalidade que não existe** |
| A SEGUNDA visita à mesma atividade não abria sessão: a pessoa saía para o almoço e voltava, e a tarde inteira desaparecia da conta | O caminho de entrada chamava `checkIn`, que é idempotente por `registration.checkedInAt` — e respondia "já credenciado" SEM criar presença. A chave de idempotência certa para a chegada é a inscrição; para a FREQUÊNCIA, é a **sessão aberta** | `checkIn` só na PRIMEIRA vez (quando a inscrição ainda não foi credenciada); depois disso a sessão é criada pelo serviço de crachá, ligada à inscrição. Teste de integração prende as duas visitas e a soma dos minutos |
| `next dev` e o build morreram com *"You cannot use different slug names for the same dynamic path ('eventSlug' !== 'eventId')"* | A rota da folha de crachás nasceu em `/api/t/[tenantSlug]/eventos/[eventId]/crachas/folha`, e já existia `/api/t/[tenantSlug]/eventos/[eventSlug]/...` (o ao vivo do palco). O Next exige o MESMO nome de segmento dinâmico no mesmo nível | A rota foi para o namespace da própria tela (`/api/t/[tenantSlug]/credenciamento/crachas/folha?eventId=…`), com o evento validado no banco. **Dois nomes para o mesmo nível dinâmico derrubam o build, não só a rota nova** |
| `npm run lint` recusou `Date.now()` no corpo da página: *"Cannot call impure function during render"* | O React Compiler trata o corpo do Server Component como render e recusa função impura — e a sugestão de "atividade acontecendo agora" precisa de um relógio | O "agora" passou a vir do **relógio do banco** (`SELECT now()`), que é o mesmo que carimba as presenças. **Dado do banco no lugar de relógio do processo**: a sugestão não pode discordar do horário gravado |
| Um teste de integração mediu "a última sessão da pessoa" e passou a medir a sessão de OUTRO cenário | O teste ordenava por `checkedInAt desc` em vez de usar o `attendanceId` que ele mesmo acabara de criar — e outro cenário abriu uma sessão depois | A asserção passou a usar o id devolvido pela leitura. **A armadilha 62 de novo, agora dentro do mesmo arquivo**: cenário que mede "o último" mede o de quem veio depois |
| O E2E da jornada da plataforma (FASE 7) reprovou: o balcão **não encontrava um crachá legado** cujo token tinha letras minúsculas | `resolveCredential` montava os candidatos de busca como `[normalizado, raw.toUpperCase()]` — o código NOVO é nosso e pode ser normalizado, mas o token da coluna antiga é uma **string opaca**, e promovê-lo a maiúsculas mudava o texto procurado: a linha com `badge-plat-a1b2c3` nunca era encontrada. O caminho legado estava documentado e **nenhum teste de integração olhava para ele** | O candidato na caixa EXATA entrou na lista (`typed`), com a explicação no código, e um teste de integração novo prende o token de caixa mista — verificado nos dois sentidos: sem a correção o teste reprova (`read.ok === false`), com ela passa. **Texto opaco não se normaliza: quem lê a etiqueta impressa lê letra por letra** |

---

## 6. Evidência de verificação

### 6.1 Bateria (árvore final)

```text
npm run lint                  → 0 erros, 0 warnings
npm run typecheck             → 0 erros
npm test                      → 67 arquivos · 1587 testes passando
npm run build                 → Compiled successfully (rota /credenciamento/crachas/folha listada)
npm run db:verify             → Contrato íntegro.
npm run db:verify:isolation   → 9/9 verificações passaram.
npm run db:partitions         → partições do mês atual e dos seguintes criadas
npx prisma migrate status     → 25 migrations · "Database schema is up to date!"
npm run test:e2e              → 102 passed
```

### 6.2 Testes novos

| Arquivo | Testes | O que prende |
|---|---|---|
| `tests/unit/credential-rules.test.ts` | 22 | formato e alfabeto do código, normalização do que o balcão manda, QR com o código e **sem** dado pessoal, estado/revogação, janela da atividade, minutos com teto e o fechamento automático determinístico |
| `tests/unit/badge-renderer.test.ts` | 8 | PDF válido e **multipágina** (1 crachá = 1 página; 9 crachás = 2), nome + código + QR na etiqueta, escape do texto, mesmos bytes para o mesmo lote |
| `tests/integration/credential-service.test.ts` | 26 | lista e emissão (idempotente, individual e em massa, auditada), leitura que identifica sem gravar, RLS/código global, **token legado na caixa exata**, chegada ≠ frequência, **segunda visita**, **leitura repetida nos três modos** (o botão único fecha quem já está dentro, `IN` responde "já credenciado", e depois da saída a leitura abre uma visita nova sem repetir XP), minutos com teto, presença sem inscrição com aviso, janela respeitada, concorrência (uma sessão para dois leitores), varredura e botão de fechamento, revogação/reemissão, crachá online |
| `tests/e2e/credential-flow.spec.ts` | 5 | área de crachás emitindo e mostrando o código, folha em PDF pela rota, monitor registrando chegada **e** frequência com o mesmo crachá, atividade desligada recusando com o motivo, crachá online do participante, crachá revogado identificando sem registrar |

### 6.3 Testes existentes que precisaram mudar (e por quê)

| Arquivo | Mudança | Motivo |
|---|---|---|
| `tests/unit/certificate-renderer.test.ts` | nenhuma — **27 testes passando sem alteração** | As primitivas de PDF (QR, escape, quebra de linha, montagem) saíram para `@/lib/documents/pdf-text` e o renderizador de certificado as re-exporta: a API e os bytes continuam iguais |
| `prisma/seed.ts` | o crachá do demo passa a nascer por `issueCredentials` (e o `badgeToken` deixa de ser escrito à mão) | O dado de demonstração tem de nascer do caminho real (convenção do projeto) — e a coluna antiga é legado congelado |
| `src/lib/events/attendance-service.ts` | `checkOut` passa a usar `sessionMinutes` | Uma regra só para os minutos, com o teto do fim da atividade |
| `tests/e2e/platform-journey.spec.ts` | o passo de credenciamento passou a dirigir o **balcão do monitor** (`monitor-context-kind`/`monitor-code`/`presence-submit`/`monitor-feedback`), com o contexto dito em voz alta | A tela de check-in que ele usava foi substituída pela FASE 31. O cenário mantém o mesmo intento (chegada pelo crachá ⇒ 50 XP) e passou a **afirmar** que lê na portaria, em vez de depender do palpite do padrão |

---

## 7. Comandos operacionais

```bash
# ── ANTES DO EVENTO: emitir e imprimir ─────────────────────────────────────────────
# /t/<slug>/credenciamento/crachas?evento=<eventId>
#   → "Emitir crachás que faltam" (todos os inscritos sem crachá)
#     ou marque pessoas e emita só para elas (equipe, palestrante, imprensa)
#   → "Imprimir a folha" (A4, 8 crachás por página: QR + código + nome)
# Folha direto pela rota (o navegador abre para Ctrl+P):
#   /api/t/<slug>/credenciamento/crachas/folha?eventId=<id>[&userIds=<id>,<id>]

# ── NO DIA: o balcão ──────────────────────────────────────────────────────────────
# /t/<slug>/credenciamento?evento=<eventId>
#   1. escolha o contexto: "Portaria do evento" OU a atividade
#   2. leia pela câmera ("Ler pela câmera"), pelo leitor USB ou digitando o código
#   3. o resultado aparece com o NOME, a ação e os avisos — e o campo volta ao foco
#   "Registrar saída" fecha a sessão e diz os minutos
#   "Fechar as presenças abertas deste contexto" encerra quem esqueceu de sair
#
#   ATENÇÃO (dívida E43): o botão principal ALTERNA. Quem já está dentro e é lido de
#   novo recebe SAÍDA — leia o painel antes de repetir a leitura (§3.8).

# ── O PARTICIPANTE ────────────────────────────────────────────────────────────────
# /t/<slug>/meu-cracha?evento=<eventId>   → QR na tela + código por extenso

# ── O BANCO: o que aconteceu no balcão ────────────────────────────────────────────
# Crachás do evento (emitidos, impressos, revogados):
psql "$DATABASE_URL" -c '
  SELECT u.name, c.code, c.status, c."printedAt" IS NOT NULL AS impresso, c."issuedAt"::date
    FROM event_credentials c JOIN "user" u ON u.id = c."userId"
   WHERE c."eventId" = ''<eventId>'' ORDER BY u.name'

# Chegada (activityId NULL) e frequência (por atividade), com minutos:
psql "$DATABASE_URL" -c '
  SELECT u.name, COALESCE(a.title, ''PORTARIA'') AS contexto,
         att."checkedInAt", att."checkedOutAt", att."minutesAttended"
    FROM attendances att
    JOIN "user" u ON u.id = att."userId"
    LEFT JOIN activities a ON a.id = att."activityId"
   WHERE att."eventId" = ''<eventId>''
   ORDER BY u.name, att."checkedInAt"'

# Presenças AINDA abertas (o que a varredura vai fechar):
psql "$DATABASE_URL" -c '
  SELECT count(*) FROM attendances WHERE "checkedOutAt" IS NULL AND "activityId" IS NOT NULL'
```

---

## 8. Dívidas técnicas e pontos de atenção

| # | Dívida | Impacto | Caminho |
|---|---|---|---|
| **E40** | **O credenciamento não funciona sem rede.** A leitura grava direto no servidor: se o wi-fi do evento cair (ou a operadora saturar), o monitor não registra nada — e a fila para | É o cenário mais provável num pavilhão cheio, e o pior momento possível: sem fila local, a saída é papel e digitação depois (com os minutos errados) | Fila local no navegador (IndexedDB) com sincronização idempotente por (crachá, contexto, instante) e um indicador honesto de "leitura pendente" na tela do monitor |
| **E41** | **A impressão é folha A4 para recortar**, não etiqueta adesiva | Crachá de papel solta, molha e rasga; a secretaria corta 300 etiquetas na tesoura | Gerar ZPL (impressora de etiquetas térmica) a partir do mesmo documento, ou PDF com medidas de etiqueta (Pimaco e similares) |
| **E42** | **O crachá não tem identidade visual do evento** (logo, cor do tema, faixa de categoria) e a câmera não deixa escolher a lente (usa sempre a traseira) | A etiqueta é funcional e fria; num evento grande a cor por categoria (palestrante, imprensa, equipe) economiza tempo na porta | Tema no renderizador (o `ThemeScope` já tem as cores do evento) e seleção de câmera no leitor (`enumerateDevices`); fundo colorido por papel/categoria |
| **E43** | **O balcão não deixa pedir "só entrada"**: o botão único manda `TOGGLE`, então **ler o mesmo crachá duas vezes seguidas FECHA a presença** em vez de avisar "já credenciado" (§3.8) | Quem lê sem olhar o painel (bipe duplo do leitor, câmera em rajada, dois monitores no mesmo posto) encerra a presença de quem acabou de chegar — e a saída fica com minutos errados | Seletor de modo na tela (`IN`/`TOGGLE`/`OUT`) ou "já credenciado" com confirmação explícita para fechar |

Pontos de atenção que **não** são dívidas novas, mas valem registro:

- **`registrations.badgeToken` continua no banco** e a leitura por ele funciona (o
  backfill trouxe os códigos para a tabela nova, e o token antigo é aceito na busca). Só
  não recebe escrita nova. Remover a coluna é trabalho de limpeza, não de produto;
- **A leitura de frequência não exige inscrição** (ADR-151). Quem quiser o comportamento
  rígido ("sem inscrição não entra") vai precisar de uma flag por atividade — hoje a
  decisão é registrar e avisar;
- **O fechamento automático depende do worker no ar.** Sem ele, as presenças continuam
  abertas e a conta só fecha pelo botão do painel (ou quando alguém registrar a saída).

---

## 9. Checklist de aceite

- [x] **Leitura por QR Code pela câmera** do computador ou do celular (API nativa +
      decodificador local de reserva), com leitor USB e digitação como caminhos de volta
- [x] **Área com todos os participantes** inscritos no evento **e** nas atividades, com
      situação de credenciamento, busca e filtro de "quem ainda não tem crachá"
- [x] **Emissão individual e em massa** dos códigos, com idempotência (emitir de novo não
      troca o crachá de ninguém) e revogação com motivo na trilha
- [x] **Etiqueta com QR Code, Código do crachá e nome** — em folha A4 de 8 por página
      (PDF multipágina), sem dado pessoal no QR (ADR-152)
- [x] **Crachá online** na área do participante, com o QR na tela e o código por extenso
- [x] **Credenciamento e frequência respondem perguntas diferentes** e são gravados como
      fatos distintos (ADR-149)
- [x] **Frequência por atividade**, com uma sessão por visita — inclusive as visitas
      seguintes (almoço, sessão dupla), com minutos somados
- [x] **Fluxo do monitor** pensado para a porta: contexto primeiro, resultado grande com o
      nome, botão único que entra/sai, sem confirmação por pessoa
- [x] **Um crachá por pessoa no evento** (ADR-148), com o contexto escolhido na leitura
- [x] **Presença de quem não tem inscrição** registrada, com aviso na tela (ADR-151)
- [x] **Janela da atividade respeitada** (`checkInEnabled`/`checkInOpensAt`/`ClosesAt`) —
      campos que existiam desde a FASE 3 e nenhum caminho consultava
- [x] **Minutos com teto no fim da atividade** (ADR-150), na saída, no botão e na varredura
- [x] **Fechamento automático** das presenças abertas no worker, com o número do fim da
      atividade (e o botão equivalente no painel)
- [x] Migração escrita à mão com backfill do legado, aplicada por
      `npm run db:migrate:deploy` (25 migrações), com `event_credentials` sob RLS + FORCE
      no contrato de isolamento
- [x] Testes: 30 unitários + 26 de integração + 5 E2E; **1587** testes Vitest e **102**
      Playwright passando
- [x] Documentação da fase, `AGENTS.md`, `README.md`, `docs/dividas-tecnicas.md` e
      `docs/armadilhas.md` atualizados
