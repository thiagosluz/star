# FASE 42 — Experiência do patrocinador (QR, consentimento e leads)

> **Tema novo, pedido pelo humano:** *"quero uma área para Experiência do Patrocinador… vincular um
> usuário que tenha papel de Patrocinador(a) a um patrocinador cadastrado… ele vai poder ver as
> informações que a organização cadastrou para ele com dados e cotas adquiridas, mas sem modificar,
> apenas leitura… uma parte de gamificação, onde o participante pode ganhar XP ou cartas específicas
> ao ler um qrcode que a organização cadastrar para o patrocinador, mas lembrando da questão da
> LGPD, e ao ler esse qrcode, os dados do participante aparecem como lead para o patrocinador"*.

---

## 1. Sumário executivo

O patrocinador deixou de ser só um cadastro comercial: ele passou a ter **área própria** (leitura do
que a organização registrou para ele), **QR de estande** que credita o participante e **contatos
autorizados por ele mesmo** — com consentimento registrado, com prazo e revogável.

### Entregas

| # | Entrega |
|---|---|
| 1 | **Vínculo pessoa × patrocinador** (`sponsor_users`) por **dois caminhos**: convite com token hasheado (aceite exige o e-mail da conta) e vínculo direto pela equipe (exige conta com vínculo na instituição) |
| 2 | **Área do patrocinador** em `/t/<slug>/patrocinador` — **só leitura**: cota, benefícios, valor e vigência do contrato, QR codes e contatos autorizados, com seletor quando a pessoa patrocina mais de um |
| 3 | **QR do estande** (`sponsor_qr_codes`): código público de 8 caracteres, XP por visita (0–500) e/ou carta do catálogo, prazo de autorização (1–365 dias), ativar/desativar/excluir |
| 4 | **Página pública de leitura** `/t/<slug>/patrocinio/<codigo>` — quem não está logado entra com volta; quem está escolhe entre **autorizar** e **registrar sem compartilhar** |
| 5 | **Crédito idempotente**: um XP e/uma carta por pessoa por QR (índice único + chave de fato do XP), com releitura registrada como repetição |
| 6 | **Lead com consentimento**: nome + e-mail (e nada mais), texto lido gravado literalmente, versão, prazo e revogação |
| 7 | **Meus compartilhamentos** `/t/<slug>/meus-compartilhamentos` — a tela do participante, com revogação em um clique |
| 8 | **Painel da organização** na tela de patrocínio: criar/desativar/excluir QR, convidar/vincular/remover acesso e ver os contatos vigentes, com **exportação em CSV** (`/api/t/<slug>/patrocinadores/contatos`) |
| 9 | **Menu** com as duas portas: "Área do patrocinador" (papel ou convite pendente) e "Meus compartilhamentos" |
| 10 | **A peça do estande** (revisão pedida pelo humano antes da aprovação): a **imagem do QR** gerada no servidor — no painel da organização **e** na área do patrocinador —, com o endereço absoluto à vista e **download em PNG e SVG** (`/api/t/<slug>/patrocinadores/qr/<qrId>`); quem lê o código é a câmera do participante, e o código em texto não é peça de estande |

### Números da fase

| | |
|---|---|
| Arquivos novos | **18** — 2 de domínio (`sponsor-experience-rules`, `invite-token-rules`), 3 de serviço/arquivo (`sponsor-portal-service`, `sponsor-qr-sheet`, `sponsor-qr-share`), 1 de ações, 2 rotas de API, 4 páginas, 3 componentes, a migração e os **3** arquivos de teste |
| Arquivos alterados | **9** — `schema.prisma`, o contrato de schema, `types.ts` e `xp-rules.ts` (gamificação), `speaker-rules` (reuso do token), a página de patrocinadores, o menu do shell, o layout `(app)` e o **seed** |
| Migrações | **1** — 3 tabelas novas + 2 valores de enum (36 → **37**) |
| Tabelas de tenant | **52 → 55** (`sponsor_users`, `sponsor_qr_codes`, `sponsor_scans`, todas sob RLS + FORCE) |
| Testes novos | **46** — 27 unitários, 16 de integração e **3 E2E** (a suíte vai de **2159** para **2202**; o E2E, de **143** para **146**) |
| Defeitos reais encontrados | **2** — a transação que virava `ROLLBACK` em silêncio (armadilha **97**) e **o QR que existia como código e não como imagem** (achado na revisão do humano, §5); mais 2 defeitos do PRÓPRIO cenário E2E |
| Dívidas quitadas | **nenhuma** — a fase não estava amarrada a dívida |
| Dívidas novas | **2** — **E56** (o aceite do convite cria vínculo `PARTICIPANT`, que não conta na quota — falta confirmar a regra com o humano) e **E57** (não há limite de QRs por patrocinador nem aviso de QR duplicado por evento) |
| Armadilhas novas | **1** — **97** (erro engolido dentro da transação) |
| ADRs | **230 … 232** (a próxima é 233) |

---

## 2. O problema mais difícil: **o dado pessoal que precisa circular — e só com autorização**

Até aqui, o dado pessoal do participante vivia **dentro** da instituição: ele via os próprios
certificados, a instituição via a lista de inscritos, e a RLS garantia que ninguém de fora
enxergasse nada. Esta fase quebra essa parede de propósito — o patrocinador é **terceiro**, e o que
ele recebe é nome e e-mail de gente que não é dele.

A tentação é juntar as duas coisas: "quem quer XP, autoriza". Isso seria **consentimento
condicionado a benefício**, e a LGPD (art. 8º, §3º) exige consentimento livre, informado e
destacado — não pedágio. O desenho inteiro saiu dessa decisão:

```
LÊ O QR ──► CRÉDITO (XP e/ou carta)  ── independe da escolha
        └─► ESCOLHA ──► AUTORIZA ──► lead com nome + e-mail, com prazo e revogável
                    └─► NÃO AUTORIZA ► visita CONTADA, pessoa não identificada
```

Três consequências técnicas que definem a fase:

1. **O crédito é da VISITA, o contato é do CONSENTIMENTO** — a leitura é gravada sempre (é ela que
   credita e conta), e o consentimento é o que pode faltar na linha;
2. **a visibilidade é decidida na LEITURA** (`evaluateLeadAccess`), e não por um *job* que expira
   contatos: revogação e vencimento valem no mesmo instante em que a tela é aberta;
3. **o pacote compartilhado é montado campo a campo** (`buildLeadShare`), com um teste que quebra se
   alguém acrescentar telefone, documento ou instituição ao que o patrocinador recebe.

---

## 3. Decisões técnicas

### 3.1 Crédito e consentimento moram na MESMA linha, e a linha é única por (QR, pessoa)

`sponsor_scans` tem `UNIQUE (qrCodeId, userId)`. Essa única restrição resolve três coisas:
**idempotência do crédito** (o QR do estande é público; reler não pode pagar de novo — é a trava do
farm de XP), **unicidade do contato** na lista do patrocinador (dois toques no celular não criam dois
leads) e **o registro da visita** para quem não autorizou (a linha existe, com os campos de
consentimento nulos). O XP usa, além disso, uma chave de fato própria
(`sponsor-scan:<qrId>:<userId>`): duas leituras simultâneas chegam ao motor de XP com a mesma chave e
ele credita uma vez — a mesma família do `dedupeKey` da FASE 15.

### 3.2 A carta sai só na primeira leitura

O motor de cartas (`grantCardForTrigger`) **não recebe chave de fato do chamador**: ele gera uma
interna. Chamá-lo de novo concederia outra cópia da mesma carta. Por isso o cartão é concedido
apenas no ramo `creditForScan(...).credits === true` — a trava é o registro da leitura, e não o
motor. Está documentado no código porque é o tipo de acoplamento que se perde na primeira refatoração.

### 3.3 O prazo é por QR, e o padrão é 90 dias

Quem decide por quanto tempo o contato fica visível é a organização, por QR (1 a 365 dias, padrão
90). Motivo prático: um estande de feira e um patrocínio anual têm janelas comerciais muito
diferentes, e um prazo único obrigaria um dos dois a mentir. O vencimento é calculado na leitura
(`consentExpiryFrom`) e **avaliado na leitura da lista** — não há rotina de expurgo para depender de
worker no ar.

### 3.4 O vínculo concede o papel `SPONSOR`, mas QUEM ele vê é o vínculo

O papel `SPONSOR` (que existe desde a FASE 2) abre `sponsor:read` no escopo da instituição. A área do
patrocinador **não** usa isso para decidir o que mostrar: cada consulta filtra pelos vínculos
`ACTIVE` daquela pessoa (`listSponsorAccess`). Sem essa separação, um patrocinador leria a lista do
concorrente — o mesmo raciocínio do portal do palestrante (FASE 25).

### 3.5 O aceite cria o vínculo com a instituição (`PARTICIPANT`)

O contato comercial da empresa costuma não ter vínculo nenhum com a instituição. Exigir vínculo para
aceitar criaria o impasse já conhecido ("sem vínculo não se aceita, e sem aceitar não há vínculo"),
então o aceite faz o `upsert` de `user_tenant_profiles` com `kind = PARTICIPANT` — a mesma régua da
inscrição pública (FASE 10) e do convite de palestrante (FASE 25). **`PARTICIPANT` não consome a quota
de membros** do plano; é por isso que o tipo é esse e não `MEMBER` (dívida **E56** para confirmar a
regra com o humano).

### 3.6 O token do convite é o MESMO do portal do palestrante

O gerador, o alfabeto e o prazo saíram do módulo do palestrante para
`src/domain/tenancy/invite-token-rules.ts`, e `speaker-rules.ts` **reexporta** o que já exportava.
Duas cópias divergiriam no primeiro ajuste — e divergir aqui significa que um dos convites passa a ser
mais fácil de adivinhar que o outro.

---

## 4. ADRs

### ADR-230 — O crédito é da visita; o contato é do consentimento

**Contexto.** O QR do patrocinador faz duas coisas ao mesmo tempo: credita o participante e entrega o
contato dele a um terceiro.

**Decisão.** São independentes. A leitura registra a visita e credita XP/carta **sempre**; o
compartilhamento de nome e e-mail depende de autorização explícita, dada na mesma tela, com o texto à
vista e duas opções de peso igual.

**Justificativa.** Condicionar a recompensa à autorização transformaria o dado pessoal em preço de
entrada — consentimento não livre (LGPD, art. 8º, §3º). Além disso, a visita é um fato do evento (o
patrocinador pagou por ela) e o contato é um ato da pessoa: misturar os dois faz o número de leads
deixar de significar "quantos quiseram falar com você".

**Consequências.** (a) A tela mostra **visitas** e **contatos** como números separados — a diferença
entre eles é o que as pessoas decidiram não compartilhar; (b) o serviço grava a leitura sem
consentimento (campos nulos) e o patrocinador não a identifica; (c) teste de integração prende as
duas pontas: XP igual nos dois caminhos, contato só com autorização.

### ADR-231 — A visibilidade do lead é decidida na leitura, com prazo e revogação

**Contexto.** Consentimento que não pode ser retirado não é consentimento; e um prazo que só vale
depois de uma rotina noturna é um prazo que mente durante o dia.

**Decisão.** `evaluateLeadAccess({ consentedAt, expiresAt, revokedAt, now })` é a **única** régua: a
lista do patrocinador, a exportação em CSV e a tela do participante passam por ela. Revogar carimba
`revokedAt` (o primeiro carimbo, não o último) e o contato sai da lista na próxima leitura.

**Justificativa.** Decidir na leitura elimina a dependência de agendador, mantém o comportamento
idêntico em qualquer ambiente e faz a revogação ter efeito imediato — que é o que a pessoa espera ao
clicar em "Revogar".

**Consequências.** (a) A ordem das checagens importa para a MENSAGEM: revogado vem antes de vencido
(a pessoa agiu; o prazo é passivo); (b) revogado/vencido não aparece nem no CSV (o arquivo é cópia do
que a tela mostra, não uma segunda porta); (c) a visita continua contada sem identificação.

### ADR-232 — O QR é do EVENTO, e o código é público mas não enumerável

**Contexto.** O QR fica impresso num estande, à vista de qualquer pessoa. Ele precisa identificar o
patrocinador, o evento do crédito, quanto XP vale e por quanto tempo o contato fica visível.

**Decisão.** O QR pertence a um **evento** (o crédito tem contexto) e o código tem 8 caracteres de um
alfabeto de 32 símbolos (40 bits), no mesmo alfabeto sem `I`/`O`/`0`/`1` dos outros códigos impressos
— porque este vai ser ditado no balcão quando a câmera falhar.

**Justificativa.** O código **não é segredo** (está impresso): o que ele precisa é ser impossível de
enumerar por tentativa, e 40 bits bastam. Amarrar o QR a um evento é o que permite ao XP ter
`eventId` e ao patrocinador ver "quantas visitas naquele congresso".

**Consequências.** (a) O mesmo patrocinador pode ter vários QRs (um por evento, ou dois no mesmo
estande); (b) excluir o QR leva as leituras dele junto — a autorização foi dada **para aquele QR**, e
manter o contato sem a origem seria guardar dado sem base (por isso a tela diz o que a exclusão faz);
(c) desativar é o caminho normal para parar de creditar, e preserva o histórico.

---

## 5. Lições aprendidas — defeitos REAIS encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | **O serviço respondia `ok` e o vínculo não existia no banco** — o teste de integração falhou com "esperava 2 patrocinadores, veio 1", e a linha gravada simplesmente não estava lá | A concessão do papel `SPONSOR` tentou um `INSERT` que já existia (índice único parcial de concessão vigente) → erro de banco DENTRO da transação. O `recordAudit` seguinte engoliu o erro dele (auditoria nunca derruba o fluxo) e o `COMMIT` de uma transação abortada é um `ROLLBACK` **sem erro** no PostgreSQL. Duas armadilhas somadas: `catch` de `P2002` não ressuscita transação, e erro engolido **aborta tudo em silêncio** (armadilha **97**) | A concessão de papel saiu da transação do vínculo, roda depois do commit e **confere antes de inserir**. O vínculo é o fato (é ele que abre a área); o papel é catálogo. O teste ganhou a asserção que expõe o problema: "a mesma pessoa enxerga DOIS patrocinadores" |
| 2 | O cenário E2E travou preenchendo o campo do convite, com a tela **certa** na frente | O cenário clicava duas vezes no mesmo `<summary>` ("Convidar ou vincular pessoa"), e o segundo clique FECHAVA o `<details>` — o campo seguinte ficava invisível | O painel é aberto **uma vez** e os dois formulários (vínculo e convite) são usados dentro dele; o cenário passou a afirmar que o campo está visível antes de preencher. **Clicar em `<summary>` é alternar, não abrir** |
| 3 | O clique em "Revogar" não fazia nada no E2E | O botão do formulário em linha, quando tem confirmação, é o que ABRE o diálogo (`-open`); o envio é o botão de dentro dele. O cenário procurava o `inline-submit` que só existe sem confirmação | O teste clica no gatilho (`revoke-…-open`) e confirma no diálogo — medindo o caminho que a pessoa percorre, com a consequência escrita à vista |
| 4 | **O estande ficou sem peça: o QR existia como CÓDIGO e não como imagem.** O painel mostrava "QR criado. O código é 29SM4ZCR — imprima no estande", e não havia o que imprimir. **Achado na revisão do humano, antes da aprovação da fase** — nenhum teste pegou, porque todos mediam o que a fase tinha decidido medir (crédito, consentimento, lead) | A fase tratou o QR como DADO e parou aí: o endereço e o código saíram em texto, e o ato que a funcionalidade promete — **a câmera do participante lendo o código** — não tinha suporte. O sistema já sabia desenhar QR (certificado, folha de crachás, telão do sorteio), e nada disso foi usado aqui: **o teste do caminho de leitura começava depois do que a pessoa precisava fazer** | A imagem passou a ser gerada no servidor (`sponsor-qr-sheet`) e aparece nos DOIS lados (painel e área do patrocinador), com download em **PNG** (imprimir na hora) e **SVG** (cartaz, sem serrilhar). O E2E deixou de confiar no `data:` da imagem: ele **decodifica o QR com o mesmo `jsqr` do leitor de crachá** e compara com o endereço esperado — a única prova de que a peça aponta para o lugar certo |

---

## 6. Evidência de verificação

```text
npm run lint ...................... 0 erros, 0 warnings
npm run typecheck ................. 0 erros
npm test .......................... 95 arquivos · 2202 testes passando
npm run build ..................... ✓ Compiled successfully · 7 rotas novas listadas
npm run db:verify ................. Contrato íntegro.
npm run db:verify:isolation ....... 9/9 verificações passaram.
npm run db:partitions ............. partições do mês atual e dos seguintes garantidas
npx prisma migrate status ......... 37 migrations found · Database schema is up to date!
npm run test:e2e .................. 146 passed
npm run db:seed ................... ✓ Experiência do patrocinador (FASE 42):
                                     Ler o QR:  http://localhost:3000/t/ufba-demo/patrocinio/9YDT4EYT
docker exec eventflow-web grep -rl 'qr-download-png' .next
                                   → o container em execução responde com o código novo
npx playwright test tests/e2e/sponsor-experience.spec.ts
                                   → 3 passed · a imagem do QR é DECODIFICADA (jsqr) e devolve o
                                     endereço absoluto; PNG e SVG baixam (200); sem vínculo, 403
```

Os três cenários do E2E, do ponto de vista de quem usa:

1. a organização **cria o QR** na tela de patrocínio (com XP por visita e prazo de autorização), **vê a
   imagem do código** — que o teste abre num canvas e decodifica, provando que ela leva ao endereço
   certo — **baixa o arquivo** em PNG e em SVG e **vincula o contato** que já tem conta; o painel
   mostra "ativo" e o convite por código continua disponível para quem ainda não tem;
2. o participante **lê o QR**, vê o texto do consentimento, autoriza e recebe o XP; o patrocinador
   entra na área dele, vê **a mesma imagem** (e também pode baixá-la, porque a peça do estande é dele),
   **1 visita e 1 contato** com o e-mail autorizado, e nenhum botão de editar — depois o participante
   **revoga** em "Meus compartilhamentos" e o contato sai da lista **mantendo a visita contada**;
3. uma segunda pessoa lê o MESMO QR e escolhe **não compartilhar**: recebe o mesmo XP, a visita passa
   a 2, os contatos continuam 0 — e, sem vínculo com o patrocinador, o download do arquivo responde
   **403** mesmo com o identificador do QR em mãos.

---

## 7. Comandos operacionais

```bash
# Área do patrocinador (leitura) e aceite do convite
/t/<slug>/patrocinador
/t/<slug>/patrocinador/convite?codigo=<TOKEN>

# A leitura do QR (o que a câmera do celular abre) e a tela do participante
/t/<slug>/patrocinio/<codigo>
/t/<slug>/meus-compartilhamentos

# Onde a organização opera tudo isso
/t/<slug>/administracao/eventos/<eventId>/patrocinadores

# Exportação dos contatos VIGENTES (organização ou o patrocinador dono)
GET /api/t/<slug>/patrocinadores/contatos?sponsorId=<id>

# O ARQUIVO DO QR, para imprimir ou mandar para a gráfica
# (organização: qualquer QR do evento · patrocinador: só o do patrocinador dele)
GET /api/t/<slug>/patrocinadores/qr/<qrId>            # PNG, 1024 px
GET /api/t/<slug>/patrocinadores/qr/<qrId>?formato=svg # vetor, para cartaz

# Conferir no banco: visitas, contatos vigentes e revogados
psql "$DATABASE_URL" -c 'SELECT s."sharedName", s."consentedAt", s."expiresAt", s."revokedAt", s."xpAwarded" FROM sponsor_scans s ORDER BY s."createdAt" DESC LIMIT 20'
psql "$DATABASE_URL" -c 'SELECT q.code, q.label, q."xpAmount", q."consentDays", q."isActive", count(s.id) AS visitas FROM sponsor_qr_codes q LEFT JOIN sponsor_scans s ON s."qrCodeId" = q.id WHERE q."deletedAt" IS NULL GROUP BY q.id'
```

---

## 8. Dívidas técnicas e pontos de atenção

* **E56 (nova) — o aceite cria vínculo `PARTICIPANT`, que não conta na quota de membros.** É a régua
  do palestrante e da inscrição pública, mas é uma decisão de negócio: a instituição pode querer
  contar contatos de patrocinador como equipe. Fica registrado para confirmação.
* **E57 (nova) — não há limite de QRs por patrocinador nem aviso de QR repetido no mesmo evento.** Um
  patrocinador pode ter dez QRs no mesmo estande; nada impede, nada avisa. O crédito continua
  correto (um por pessoa **por QR**), mas o patrocinador pode inflar visitas com dois códigos.
* **O contato vê o que a organização cadastrou, e não há campo livre para ele.** Se o comercial quiser
  registrar observações sobre um lead, não há onde — e isso é deliberado: a área é de leitura.
* **A exportação em CSV sai do mesmo dado que a tela mostra** (sem revisão de retenção). Marca
  d'água com autor e prazo é a dívida **E44**, que continua aberta.
* **O QR não tem folha pronta, como a de crachás.** O arquivo sai em PNG (1024 px) e SVG, e a
  diagramação — tamanho, moldura, "aponte a câmera" — fica com a organização. Uma folha de estande
  em PDF, com o QR grande e a instrução impressa, ainda não existe.
* **O QR baixado não entra na trilha.** A exportação de contatos registra `EXPORT`; o download do QR
  não, porque o que sai é a arte de um código que já está impresso na parede. Se a organização quiser
  saber quem baixou a peça, isso não está registrado.
* **A mesma armadilha 97 continua latente em `registration-service` e `speaker-service`**, onde a
  concessão de papel é absorvida por `catch` dentro da transação. A janela exige corrida real (as
  duas já conferem antes), e a correção é a mesma desta fase — mas não foi feita fora do escopo dela.

---

## 9. Checklist de aceite

* [x] Dá para **vincular pessoa a patrocinador** por convite (token + e-mail da conta) **e** por
      vínculo direto (conta já existente)
* [x] A área do patrocinador é **somente leitura**, com cota, benefícios, contrato, vigência e QR
* [x] O patrocinador vê **apenas os próprios** patrocinadores (vínculo, não papel) e escolhe entre eles
* [x] O organizador **cadastra o QR** do estande (nome, XP, carta opcional, prazo de autorização)
* [x] A **imagem do QR** aparece no painel da organização e na área do patrocinador, com o endereço
      absoluto — e o E2E a **decodifica** para provar que ela leva ao lugar certo
* [x] O QR **baixa em PNG e em SVG** para imprimir, e quem não é a organização nem o dono recebe 403
* [x] A leitura do QR credita **XP e/ou carta**, **uma vez por pessoa por QR**
* [x] Sem autorização: **crédito igual**, visita contada e **nenhum** dado pessoal entregue
* [x] Com autorização: nome e e-mail (só esses), com **texto lido gravado**, versão e prazo
* [x] O participante **revoga** em um clique, e o contato sai da lista do patrocinador na hora
* [x] Autorização **vencida** fecha o acesso sem depender de rotina
* [x] A exportação em CSV entrega **só os contatos vigentes** e exige vínculo (ou `sponsor:manage`)
* [x] A **RLS** isola as três tabelas novas (a vizinha não vê QR, vínculo nem leitura)
* [x] O menu tem as **duas portas** (papel ou convite pendente) e "Meus compartilhamentos"
* [x] A trava do **sistema de design** continua verde (tokens, escala, zero cor literal em componente)
* [x] Toda a suíte verde (**2202** testes + **146** E2E), com os testes das fases anteriores intactos
* [x] Documentação da fase, README, `AGENTS.md`, armadilha 97 e dívidas (E56, E57) atualizados
