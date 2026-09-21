# FASE 29 — Palco público e auditoria do sorteio

> **Tema:** o sorteio deixou de ser uma promessa auditável e passou a ser uma conta
> que qualquer pessoa refaz. Duas entregas pedidas pelo humano: a **página de telão**
> que o público acompanha no dia do evento, com os efeitos e o endereço à mão do
> administrador, e a **auditoria conferível** — o que de fato se confere, e com quais
> informações.

---

## 1. Sumário executivo

| Entrega | Item | Arquivo-chave |
|---|---|---|
| **Telão público** do sorteio, com três estados (aguardando, revelado, cancelado) | Palco | `palco/page.tsx`, `raffle-stage.tsx` |
| Compromisso da semente **visível ANTES da apuração** (o elo que faltava) | Palco | `getRaffleStageView` (`raffle-service.ts`) |
| Contagem de elegíveis **ao vivo** no telão, e revelação automática quando a apuração acontece | Palco | rota pública `.../ao-vivo`, SSE com polling de volta |
| Efeitos próprios: confetes em `<canvas>` + revelação escalonada, com `prefers-reduced-motion` | Palco | `confetti-burst.tsx`, `globals.css` §7 |
| Link + **QR Code** do telão e endereço da auditoria na tela de Sorteios | Operação | `stage-link-panel.tsx`, `stage-links.ts` |
| **Auditoria pública** com a cadeia de prova inteira (compromisso, semente, lista, resultado) | Auditoria | `auditoria/page.tsx` |
| Conferência **no navegador** de quem lê: `sha256` da semente, `sha256` da lista e reprodução do sorteio | Auditoria | `raffle-audit.tsx`, `web-seeded-random.ts` |
| **Lista publicada** (ordem, código opaco e minutos) gravada na apuração e assinada no resultado | Auditoria | `pool-rules.ts`, migração `20260921180000` |
| Reprodução fora do site, com script que **importa** a regra (sem cópia) | Auditoria | `prisma/scripts/audit-raffle.ts` |
| Correção: o compromisso aparecia só **depois** da apuração na tela do administrador | Auditoria | `raffle-history.tsx` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **17** — 3 de domínio (`draw-selection`, `pool-rules`, `web-seeded-random`), 2 de aplicação (`public-url`, `stage-links`), 1 migração, 1 script de auditoria, 3 de página/rota (telão, auditoria, ao vivo), 4 de UI (telão, auditoria, painel de links, confetes), 2 de teste, 1 documento de fase |
| Arquivos alterados | **16** (15 desta fase + o documento da FASE 22, que estava pendente na árvore) |
| Migrações | **1** — `20260921180000_raffle_pool_snapshot` (`raffles."poolSnapshot"`, `raffles."poolHash"`) |
| Permissões | 58 (nenhuma nova: o palco e a auditoria são públicos; a tela de sorteios usa `event:manage`) |
| ADRs | **140 … 143** (a próxima é a 144) |
| Testes novos | 27 unitários + 12 de integração + 3 E2E = **42** |
| Testes | **1493** (Vitest) · **97** (Playwright E2E) |
| Testes novos | 27 unitários + 12 de integração + 3 E2E = **42** |
| Dívidas quitadas | nenhuma deste levantamento — o escopo veio do humano; a fase declarou E36 e E37 |
| Dívidas novas | E36 (a lista não pode ser comprometida antes) e E37 (não há interruptor para manter o telão fora do ar) |

---

## 2. O problema mais difícil: **a auditoria que prometia o que não entregava**

A página pública do resultado (FASE 22) publicava três hashes e escrevia, em letras
claras:

> "O `sha256` da semente revelada é igual ao compromisso publicado antes da apuração,
> e o resultado se reproduz rodando o sorteio com ela."

A primeira metade era verdadeira e verificável por qualquer pessoa, com uma linha de
`node` ou `sha256sum`. A segunda **não era**: ninguém podia conferi-la. Faltava a
ENTRADA do sorteio — quem eram os elegíveis, em que ordem e com quantos minutos cada
um. O sistema calculava essa lista na apuração e **jogava fora**, guardando apenas a
contagem (`eligibleCount`).

O problema é de honestidade, não de criptografia: uma página que promete uma
conferência que o leitor não consegue fazer ensina o leitor a não conferir nada. A
FASE 29 fechou isso por três caminhos ao mesmo tempo:

1. a lista passa a ser **gravada** na apuração, no formato em que o sorteio a
   consumiu (ordem, código público e minutos);
2. o **hash da lista entra no conteúdo assinado** do resultado (payload versão 3),
   então trocar a lista muda o hash — antes, trocá-la deixava o hash intacto;
3. a página de auditoria **refaz as três contas** — duas no navegador de quem lê
   (WebCrypto) e uma no servidor — e publica o documento canônico da lista, para
   quem quiser conferir fora do site.

### O que continua não sendo provado (e agora está escrito na tela)

O compromisso amarra a **semente**, não a lista. O credenciamento continua até o
momento da apuração, então não existe um "antes" em que a lista pudesse ser
comprometida. Quem tinha acesso ao banco poderia, em tese, montar a lista e escolher
uma semente até gostar do resultado — desde que o compromisso fosse publicado depois
disso. O que a auditoria garante é: a semente foi fixada antes (a trilha tem data e
autor), a lista publicada é a que gerou o resultado gravado, e nada mudou depois.

A alternativa "resolver de verdade" seria **fechar o credenciamento antes do
sorteio** — e aí o sorteio deixaria de ser "por presença real", que é o produto. A
página diz isso em voz alta (ADR-142): um limite declarado não é uma falha; uma
promessa impossível é.

---

## 3. Decisões técnicas

### 3.1 A seleção saiu para um módulo puro, para rodar nos DOIS lados

A conferência no navegador exige rodar a seleção sem `node:crypto`. A tentação era
escrever uma segunda implementação em JavaScript para o cliente — e aí a auditoria
passaria a validar uma regra que pode não ser a que rodou (o defeito que a própria
FASE 22 documentou para a contagem de elegíveis: duas implementações divergem).

A seleção (`selectWinners`, `selectWeightedWinners`, `participantWeight` e o novo
`reproduceFromPool`) mudou para `src/domain/raffles/draw-selection.ts`, **sem nenhuma
dependência de runtime**, e os dois lados chamam as mesmas funções:

| Lado | Gerador |
|---|---|
| Servidor (apuração e veredito da página) | `createSeededRandomInt` — HMAC-SHA256 em `node:crypto` |
| Navegador (conferência de quem lê) | `prepareWebRandomInt` — HMAC-SHA256 em WebCrypto |

O que muda é só o **adaptador de aleatoriedade**, e há teste comparando as duas
sequências, valor por valor, para o mesmo par (semente, teto). Sem esse teste, a
auditoria poderia acusar divergência num sorteio correto — o pior defeito possível
numa página de auditoria.

### 3.2 O código público do participante, e por que o `userId` sai do documento

A lista canônica é `[{ index, code, minutes }]`. O `code` (`P-` + 12 dígitos
hexadecimais) é derivado de `sha256(sorteio + participante)`, o que dá três
propriedades de uma vez:

- **estável** — o resultado publica o MESMO código, e é assim que a auditoria liga a
  linha da lista à posição do ganhador sem precisar de identidade;
- **opaco** — não revela `userId` nem a ordem de credenciamento;
- **conferível** — cada pessoa consegue se localizar na lista, e quem estava na sala
  reconhece quem subiu, sem que o site publique o cadastro de ninguém.

O `userId` fica gravado ao lado, no banco, apenas para a tela resolver o **nome de
exibição** com a regra de consentimento (`publicWinnerName`, o mesmo dos ganhadores).
Ele **não entra no documento canônico**: não é entrada do sorteio, e incluí-lo faria
o hash depender de dado que não decide nada.

### 3.3 Payload versão 3: por que subir a versão, e não mudar a 2

O `poolHash` e o `poolCount` entraram no conteúdo assinado. Mudar a versão 2 no lugar
teria invalidado o hash de **toda** apuração já feita, e a trilha de auditoria das
fases anteriores viraria "resultado adulterado" da noite para o dia. Com a versão 3,
`verifyResult` reconstrói cada payload na versão GRAVADA no sorteio — a 1 e a 2
continuam verificáveis, exatamente como a 1 continuou quando a 2 nasceu (FASE 16).

### 3.4 Duas rotas de "ao vivo", dois públicos

A prévia da FASE 16/22 (`/api/events/<id>/raffle-live`) exige sessão e `event:manage`
e recebe o recorte pelos campos do formulário — porque o sorteio ainda não existe
enquanto o organizador preenche a tela. O telão é o oposto: público, e o recorte vem
do **sorteio**, não da URL. Aceitar o recorte por parâmetro permitiria um telão
exibindo "42 elegíveis" de um recorte que não é o que será apurado.

Então a fase criou `.../sorteios/<raffleId>/ao-vivo`, pública, com SSE e polling de
volta declarado na tela — em vez de abrir a rota autenticada "pela metade".

### 3.5 O telão não decide consentimento

O nome chega ao componente **já mascarado** pelo servidor. Uma tela que o evento
inteiro vê não é lugar de decidir privacidade: quem autorizou o perfil público aparece
inteiro, quem não autorizou aparece abreviado — inclusive na parede.

### 3.6 Efeitos: implementação própria, sem dependência nova

Os confetes são ~100 linhas de `<canvas>` no repositório, com as **cores lidas das
variáveis do tema do evento** (`--ef-*`) — o componente não conhece hexadecimal
nenhum. Quem pediu menos movimento (`prefers-reduced-motion`) recebe a revelação sem
confete e sem animação, decidido no componente e no CSS.

O QR Code também é gerado **no servidor**, com a biblioteca que já assina os
certificados: um serviço externo de QR faria o endereço do evento sair para terceiros.

---

## 4. ADRs

### ADR-140 — A lista publicada é assinada no resultado, e a reprodução usa a MESMA seleção nos dois lados

**Contexto.** A auditoria prometia reprodução e publicava só os hashes. Faltava a
entrada do sorteio, e não havia como conferi-la fora do servidor.

**Decisão.** A apuração grava a lista (`raffles."poolSnapshot"`) com o hash dela
(`raffles."poolHash"`); esses dois valores entram no payload do resultado (versão 3);
a reprodução roda sobre a lista publicada, usando as funções puras de
`draw-selection.ts` — no servidor com `node:crypto`, no navegador com WebCrypto.

**Justificativa.** É a única forma de a frase "o resultado se reproduz com a semente"
ser verdadeira para quem lê. Manter UMA implementação da seleção elimina a classe de
defeito em que a auditoria valida uma regra diferente da que apurou.

**Consequências.** Apurações anteriores ficam com as colunas nulas e seguem
verificáveis na versão que usaram; a página explica por que não há lista em vez de
mostrar uma lista vazia. O payload ganhou uma versão nova (nada de retroagir).

### ADR-141 — O palco é público, existe desde a criação do sorteio e mostra o compromisso antes da apuração

**Contexto.** O compromisso era gerado na criação, mas a única tela que o exibia só o
mostrava **depois** da apuração. Compromisso que ninguém viu antes não prova que a
semente foi escolhida antes — a prova existia no banco e não existia para as pessoas.

**Decisão.** O endereço do telão existe desde a criação (três estados: aguardando,
revelado, cancelado), é público, e mostra o compromisso e a contagem ao vivo enquanto
o público espera. A tela de sorteios passou a exibir o compromisso desde a criação, e
o link/QR do telão ficam ali para o organizador.

**Justificativa.** O telão é o momento em que o compromisso ganha sentido: é ele que
dá ao público a chance de registrar o número ANTES do resultado. Fixar o endereço
desde a criação evita o passo "ligar o telão" que alguém esquece no meio da abertura.

**Consequências.** O título do prêmio é acessível a quem tem o link (UUID não
enumerável) antes da apuração — é o que o telão anuncia, e está registrado como dívida
E37 (não há interruptor para manter o telão fora do ar). A página pede `noindex`.

### ADR-142 — A auditoria declara o que NÃO prova

**Contexto.** Toda peça de prova tem um limite, e o limite desta é estrutural: o
credenciamento continua até a apuração, então a lista não tem um "antes" para ser
comprometida. O compromisso amarra a semente.

**Decisão.** A página de auditoria publica, em texto, o que ela prova (semente fixada
antes; lista publicada é a entrada do resultado; nada mudou depois) e o que ela não
prova (que a lista não tenha sido editada por quem tinha acesso ao banco antes de ser
gravada; que o credenciamento tenha registrado presença corretamente).

**Justificativa.** Auditoria que só lista virtudes treina o leitor a confiar; auditoria
que declara o próprio limite permite que ele decida o quanto confia. A alternativa
técnica (fechar a lista antes) descaracterizaria o produto — e foi descartada
explicitamente.

**Consequências.** A honestidade do limite virou dívida declarada (E36), com o
caminho de mitigação escrito: notarização externa do compromisso ou congelamento
antecipado do credenciamento.

### ADR-143 — O código público do participante é derivado, e o documento canônico não carrega o `userId`

**Contexto.** Publicar a lista exige identificar cada linha, mas o identificador
interno (`userId`) não deve virar dado público, e o `userId` também não é entrada do
sorteio.

**Decisão.** Cada linha leva `code = sha256(sorteio + participante)` truncado em 12
hexadecimais, prefixado com `P-`. O documento canônico assinado contém apenas
`{ index, code, minutes }`. O `userId` é gravado no snapshot fora do canônico, só para
resolver o nome de exibição.

**Justificativa.** O código é estável (liga lista e resultado), opaco (não revela
cadastro) e permite que cada pessoa se localize. Excluir o `userId` do canônico
mantém o hash preso ao que decide o sorteio: ordem e minutos.

**Consequências.** Colisão de digest é improvável, não impossível: `findDuplicateCodes`
detecta e a página avisa em vez de publicar uma lista ambígua. A apuração NÃO é
recusada por causa disso — travar o sorteio no palco por um digest seria trocar um
risco remoto por um defeito certo.

---

## 5. Lições aprendidas

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 39 | O E2E do telão ficou 30 s esperando a revelação, com o sorteio **já apurado** no banco | A rota do palco calculava o estado do sorteio **uma vez, na abertura da conexão**, e só reamostrava a contagem de elegíveis. O telão recebia para sempre a fotografia do momento em que a página carregou | O estado passou a ser **relido a cada amostra** (uma consulta por chave primária a cada 3 s, enquanto o sorteio está em rascunho) e o fluxo para de amostrar quando ele deixa de ser rascunho. É a lição do "estado congelado na abertura": fluxo ao vivo que não relê o que mudou não é ao vivo |
| 40 | Três cenários seguintes falharam com sintomas que não tinham relação entre si (auditoria sem lista, painel sem sorteios, contagem zerada) | **Depois de um teste que falha, o Playwright reinicia o worker** — e o `RUN_ID` do arquivo (gerado no carregamento do módulo) muda. Os cenários seguintes passaram a rodar sobre uma fixture NOVA, criada do zero, sem os sorteios que os anteriores tinham deixado | O diagnóstico veio de um `beforeEach` temporário que imprimia `evento` e contagem de sorteios: o `eventId` tinha mudado. A correção foi de desenho: os cenários da F29 **montam as próprias fixtures** (o sorteio da auditoria é criado e apurado pela tela dentro do cenário; o do painel é criado no próprio teste), em vez de herdar estado de outro teste |
| 41 | O cenário da auditoria falhou duas vezes seguidas por motivos opostos: primeiro "não há lista publicada", depois "nenhum participante elegível" | A primeira versão dependia do sorteio apurado por outro cenário (que sumiu com o reinício do worker — lição 40). Ao criar o próprio sorteio, ele passou a depender das presenças do arquivo e do fato de aquela pessoa **não ter ganhado antes**: o painel não permite ganhador anterior, e quem ganha o sorteio anterior depende da semente sorteada | O cenário passou a credenciar uma **pessoa nova**, criada por ele: quem depende de "alguém que pode ter ganhado antes" depende da semente alheia. Fixture própria, resultado determinístico |
| 42 | O teste de adulteração da lista **passou** com a lista adulterada | A adulteração trocava os MINUTOS das duas primeiras linhas — mas o sorteio daquele cenário era de chance igual (`weightByMinutes: false`), e nesse modo os minutos não influenciam nada. O teste media a coisa errada e não provava nada | A adulteração passou a trocar os CÓDIGOS de todas as linhas: qualquer que seja a semente, a lista publicada deixa de ser a lista que gerou o resultado. **Teste que adultera tem de adulterar o que a regra realmente usa** |
| 43 | Três testes de integração existentes reprovaram ao subir a versão do payload | Eles fixavam `resultVersion == 2` e reconstruíam o payload com `validationVersion === 2 ? 2 : 1` — afirmações corretas até a versão mudar. O número da versão é uma decisão de compatibilidade, e estava escrito em três lugares | Os testes passaram a reconstruir na versão GRAVADA (3 → 2 → 1) e a afirmar a versão corrente (3). A pergunta que faltava no código: "quem fixa esse número?" — hoje só o domínio |

---

## 6. Evidência de verificação

### 6.1 Bateria (árvore final)

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 62 arquivos, 1493 testes passando (+39 nesta fase)
npm run build                → ✓ Compiled successfully
npm run db:migrate:status    → 23 migrations found · Database schema is up to date!
npm run db:verify            → Contrato íntegro.
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:partitions        → partições do mês atual e dos seguintes em dia
npm run test:e2e             → 97 passed (97 ✓ · 0 falhas)
```

As imagens foram reconstruídas e os containers RECRIADOS — a prova é o ID, não a data
(armadilha 3):

```text
docker compose build web worker → "grafo de módulos do worker carregado por inteiro"
docker inspect eventflow-web --format '{{.Image}}'  → = eventflow/web:local  (IDs conferidos)
docker exec eventflow-web grep -rl 'ao-vivo' .next/server/app → rota do palco no ar
```

Uma migração nesta fase, escrita à mão e aplicada com `db:migrate:deploy`:

```text
20260921180000_raffle_pool_snapshot → raffles."poolSnapshot" (jsonb) e raffles."poolHash" (char 64)
```

### 6.2 Testes novos

```text
Unitários (27) — tests/unit/raffle-audit.test.ts
✓ o código público é estável, prefixado, opaco, distinto por sorteio e por pessoa
✓ o documento canônico tem ordem de campos fixa; trocar duas linhas muda o hash
✓ mudar um MINUTO muda o hash; lista vazia tem hash próprio; códigos repetidos acusados
✓ a reprodução é determinística e não repete participante
✓ a reprodução usa a MESMA seleção do domínio (nenhuma cópia da regra)
✓ o gerador do NAVEGADOR (WebCrypto) produz a MESMA sequência do servidor (node:crypto)
✓ o sorteio inteiro reproduzido no navegador dá o mesmo resultado do servidor
✓ o orçamento de blocos do navegador acaba em erro, não em repetição silenciosa
✓ a comparação aponta QUAL posição divergiu, e trata o que falta dos dois lados
✓ o payload v3 assina a lista; v1, v2 e v3 continuam verificáveis cada uma no seu formato

Integração (12) — tests/integration/raffle-audit.test.ts
✓ a apuração grava a lista na ordem do sorteio, com código, minutos e o hash dela
✓ o hash do resultado assina a lista (versão 3) e continua conferindo
✓ a trilha registra o hash e o tamanho da lista no ato da apuração
✓ a auditoria reproduz o resultado gravado, posição a posição
✓ o CÓDIGO liga cada linha da lista à posição do resultado
✓ ACUSA divergência quando a lista gravada é adulterada
✓ apuração anterior a esta fase não inventa lista: a auditoria explica
✓ não publica nome de quem não autorizou o perfil público
✓ o palco mostra o compromisso ANTES da apuração (rascunho → revelado no mesmo endereço)
✓ sorteio cancelado tem estado próprio
✓ o ao vivo devolve o recorte do SORTEIO, não o da URL
✓ o documento publicado reconstrói o mesmo hash do banco

E2E (3) — tests/e2e/raffle-end-to-end.spec.ts (bloco "palco e auditoria")
✓ o telão mostra o compromisso, a contagem ao vivo e se revela sozinho
  (a apuração acontece com a página aberta; `data-stage-state` vira REVELADO)
✓ a auditoria reproduz o resultado e confere os dois hashes no navegador
  (selo verde no `sha256` da semente, no da lista e na reprodução posição a posição)
✓ a tela de sorteios entrega o link do telão, o QR e o endereço da auditoria
  (e o compromisso aparece desde a criação, com "ainda selada")
```

---

## 7. Comandos operacionais

```bash
# O telão do sorteio (projete; o endereço é o mesmo desde a criação)
#   /t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>/palco
# A auditoria (para quem quiser conferir as contas)
#   /t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>/auditoria

# Conferir um sorteio FORA do site, com o documento canônico salvo em lista.json:
npx tsx prisma/scripts/audit-raffle.ts --semente <hex> --lista lista.json --vagas 3
# e, com os códigos publicados, o script dá o veredito posição a posição:
npx tsx prisma/scripts/audit-raffle.ts --semente <hex> --lista lista.json \
  --resultado P-AAAAAAAAAAAA,P-BBBBBBBBBBBB

# As duas primeiras contas são shell puro:
printf '%s' "<semente revelada>" | sha256sum     # == compromisso publicado
sha256sum lista.json                            # == poolHash assinado no resultado

# Quais sorteios já têm lista assinada, e com qual versão de payload?
docker exec eventflow-postgres psql -U eventflow_admin -d eventflow -c "
  SELECT \"resultVersion\", count(*) AS sorteios,
         count(*) FILTER (WHERE \"poolHash\" IS NOT NULL) AS com_lista
    FROM raffles GROUP BY 1 ORDER BY 1;"
```

---

## 8. Dívidas técnicas e pontos de atenção

**Novas (entram no levantamento):**

| # | Item | O que falta | Impacto |
|---|---|---|---|
| E36 | **A lista publicada não pode ser comprometida antes da apuração** | O compromisso amarra a semente; a lista é gravada na apuração e assinada junto do resultado. Quem tem acesso ao banco poderia, em tese, montar a lista e escolher a semente até gostar do resultado. A página declara o limite (ADR-142); falta o caminho forte: notarização externa do compromisso (publicação em serviço de terceiro) ou congelamento antecipado do credenciamento com uma segunda cerimônia | Auditoria perfeita exigiria mudar o produto (sorteio por presença real acontece com o credenciamento aberto). Hoje o limite está declarado, não escondido |
| E37 | **Não há interruptor para manter o telão fora do ar** | O endereço do palco responde desde a criação do sorteio e mostra o título do prêmio (decisão da ADR-141). Falta a opção de manter o palco desligado até a instituição ligá-lo, para quem quiser anunciar o prêmio só na hora | Quem tem o link vê o título antes da apuração. O endereço é um UUID não enumerável e a página pede `noindex`, mas não há como negar o acesso |

**Pontos de atenção para quem for mexer:**

1. **`poolCount` e `eligibleCount` são o mesmo número na apuração** (a lista É o
   conjunto de elegíveis). Os dois estão no payload assinado de propósito: a lista
   assinada declara o próprio tamanho, e reconstruir o hash exige os dois.
2. **A lista é uma fotografia da apuração.** O credenciamento continua depois dela, e
   é por isso que a auditoria reproduz sobre a lista PUBLICADA, nunca sobre o
   credenciamento atual — que daria outro resultado e acusaria o sorteio de errado.
3. **O código público é derivado do par (sorteio, participante)**, então o mesmo
   participante tem códigos diferentes em sorteios diferentes. É deliberado: o código
   não é identidade global, é a linha daquela lista.
4. **`draw-selection.ts` não pode importar nada de runtime.** É ele que atravessa para
   o navegador; um `import` de `node:crypto` ali quebra a conferência no cliente sem
   quebrar o build do servidor.
5. **A conferência do navegador depende de contexto seguro** (`crypto.subtle`): em
   `http://localhost` funciona; em produção, HTTPS. A receita fora do site
   (`sha256sum` + script) continua valendo em qualquer ambiente.
6. **E35 continua aberta e ficou mais visível:** agora a lista de elegíveis também
   publica nomes (mascarados por padrão), então a ausência de uma tela para a pessoa
   AUTORIZAR o nome pesa mais do que pesava.

---

## 9. Checklist de aceite

- [x] **Palco** — página pública de UM sorteio, com endereço fixo desde a criação
- [x] **Palco** — três estados (aguardando, revelado, cancelado) e revelação automática
- [x] **Palco** — compromisso da semente visível ANTES da apuração
- [x] **Palco** — contagem de elegíveis ao vivo (SSE, com polling de volta declarado)
- [x] **Palco** — efeitos próprios (confetes + revelação escalonada), sem dependência nova
- [x] **Palco** — `prefers-reduced-motion` respeitado
- [x] **Palco** — cores do tema do evento; nomes pela regra de consentimento
- [x] **Operação** — link copiável + QR Code do telão e link da auditoria na tela de Sorteios
- [x] **Operação** — o compromisso aparece desde a criação na tela do administrador
- [x] **Auditoria** — lista publicada (ordem, código, minutos) gravada na apuração
- [x] **Auditoria** — hash da lista assinado no resultado (payload v3; v1 e v2 preservadas)
- [x] **Auditoria** — `sha256` da semente conferido no NAVEGADOR de quem lê
- [x] **Auditoria** — reprodução do sorteio no navegador, com a MESMA seleção do servidor
- [x] **Auditoria** — divergência acusada posição a posição quando a lista é adulterada
- [x] **Auditoria** — receita para conferir fora do site (`sha256sum` + script que importa a regra)
- [x] **Auditoria** — o que a página prova e o que NÃO prova, escrito na página
- [x] Testes: 27 unitários, 12 de integração, 3 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 6
- [x] Imagens reconstruídas e containers RECRIADOS (prova pelo ID da imagem)
- [x] `README.md`, `AGENTS.md` e `docs/dividas-tecnicas.md` atualizados

---

Aguardando **"APROVADO: AVANÇAR"**.
