# FASE 6 — Certificação Automática com Assinatura Digital e Validação Pública

> **Status:** concluída · aguardando `APROVADO: AVANÇAR`
> **Pré-requisitos:** FASES 1 a 5 aprovadas e verificadas
> **Stack desta fase:** BullMQ (fila + worker), MinIO/S3, HMAC-SHA256, geração própria
> de PDF e SVG, QR Code, PostgreSQL 18 com RLS, Vitest e Playwright

---

## 1. Sumário executivo

Esta fase transforma presença e produção científica em **documentos verificáveis**:
certificado em PDF assinado, com carga horária medida, hash de integridade, QR Code
e uma página pública de validação que funciona **sem login**.

| Área | Entrega |
|---|---|
| Elegibilidade | 8 tipos de certificado, cada um com regra explícita e recusa **com motivo** |
| Carga horária | Somada das presenças REAIS, com teto na carga declarada de cada atividade |
| Conteúdo | Snapshot imutável + conteúdo canônico determinístico (base do hash) |
| Assinatura | HMAC-SHA256 com `keyId` (rotação auditável) e comparação em tempo constante |
| Documento | PDF A4 paisagem e SVG, ambos **determinísticos** e sem dependência de biblioteca |
| QR Code | Vetorial (retângulos), apontando para a validação pública |
| Fila | BullMQ `certificates` + worker com retry, backoff e shutdown gracioso |
| Validação pública | `/validar/<código>` sem autenticação, com verificação de assinatura e revogação |
| Revogação | Documento passa a ser inválido na hora, com motivo publicado |
| Emissão em lote | Todos os elegíveis de um evento, num clique, com contagem de ignorados |

Números desta fase:

```text
Módulos de domínio novos        1   (certificate-rules)
Renderizadores novos            1   (PDF + SVG + QR, sem dependência)
Serviços novos                  3   (certificate-service, signer, queue)
Worker                          1   (fila de certificados registrada)
Server Actions novas            4   (emitir, lote, revogar, download)
Páginas/rotas novas             2   (/certificados, /validar/[code]) + 1 rota de API
Policy de RLS nova              1   (certificate_public_validation)
Migração                        0   (o modelo Certificate veio da FASE 1)
Testes novos                   91   (67 unitários + 24 de integração) + 2 E2E
Dependência nova                1   (qrcode — ver ADR-037)
```

---

## 2. O problema mais difícil desta fase

Três exigências brigam entre si quando se emite um documento:

1. **O documento não pode mudar.** Um certificado é prova. Se editar o evento
   depois alterasse o certificado, dois documentos do mesmo evento discordariam.
2. **O documento não pode ser forjado.** Precisa haver algo que um terceiro possa
   conferir sem conhecer o sistema por dentro.
3. **O documento não pode depender de quem o gerou.** Se o PDF só existe porque um
   worker estava de pé naquele instante, o participante fica sem prova.

As decisões abaixo (ADRs 032 a 038) existem para atender às três ao mesmo tempo.

---

## 3. Elegibilidade: cada tipo com uma regra explícita

| Tipo | Regra | Carga horária |
|---|---|---|
| `ATTENDANCE` | ao menos uma atividade com ≥ 75 % da carga | soma das atividades cumpridas |
| `MINI_COURSE` | ao menos um minicurso com ≥ 75 % | soma dos minicursos |
| `PARTICIPATION` | credenciamento no evento **ou** presença em atividade | soma do evento |
| `SPEAKER` | consta como palestrante | carga declarada do palestrante |
| `REVIEWER` | ao menos um parecer concluído | — |
| `AUTHOR` | ao menos um trabalho aceito | — |
| `ORGANIZER` | papel de organização (verificado na emissão) | — |
| `MERIT` | **nunca automático** — decisão do comitê | — |

Duas escolhas deliberadas:

- **A recusa é textual.** "Não elegível" sem motivo obriga o participante a abrir
  um chamado para descobrir que faltaram 12 minutos de presença.
- **`ORGANIZER` não depende de presença.** Quem organiza pode ter passado o evento
  inteiro resolvendo problema nos bastidores — exigir presença puniria exatamente
  quem fez o evento acontecer.

---

## 4. Carga horária: medida, não presumida

```text
mínimo para contar = max(30 min, 75 % da carga da atividade)
minutos contados   = min(minutos medidos, carga declarada)
```

- **O teto importa.** Quem ficou 300 minutos em um minicurso de 240 não tem 300
  minutos de minicurso: tem 240. Sem o teto, um evento com uma atividade longa
  emitiria certificados com carga maior que a própria atividade.
- **Sem check-out, o tempo é ZERO** — não "indefinido". Assumir presença completa
  sem saída registrada seria emitir certificado por comparecimento presumido, que é
  exatamente o que a regra dos 75 % existe para impedir.
- **O detalhamento vai junto.** `workloadBreakdown` guarda cada atividade, os
  minutos medidos, os minutos contados e o MOTIVO de eventual descarte. A página
  pública mostra a composição: quem valida consegue ver de onde saiu cada hora.
- **A constante é compartilhada** com a gamificação (FASE 5) e o credenciamento.
  Uma definição só evita o absurdo de "ganhou XP mas não tem direito ao certificado".

---

## 5. O conteúdo canônico: a base do hash e da assinatura

```text
conteúdo canônico = JSON com ordem FIXA de chaves
   { version, validationCode, tenantId, eventId, userId, activityId,
     kind, recipientName, title, bodyText, workloadMinutes, issuedAt }

contentHash = SHA-256(conteúdo canônico)
signature   = HMAC-SHA256(segredo, "<keyId>.<contentHash>")
```

Três consequências:

1. **O hash cobre o CONTEÚDO, não o arquivo.** O mesmo certificado pode ser
   renderizado em PDF e em SVG e ambos continuam verificáveis contra o mesmo hash —
   o renderizador vira detalhe de apresentação.
2. **O `keyId` entra na mensagem assinada.** Trocar a chave sem trocar o
   identificador produziria assinaturas indistinguíveis, e a rotação de chaves
   ficaria inauditável.
3. **A comparação é em tempo constante** (`timingSafeEqual`). Comparar strings com
   `===` vaza tempo e permite, em tese, descobrir a assinatura byte a byte; o custo
   de usar a comparação segura é zero.

A verificação pública **recalcula o conteúdo a partir do banco**. Se alguém alterar
`bodyText` ou a carga horária por fora, o hash deixa de casar e a assinatura não
confere — que é exatamente o que a assinatura existe para detectar. Há teste de
integração que adultera a linha no banco e prova a detecção.

**O `issuedAt` é gravado na SOLICITAÇÃO**, não na renderização. Isso não é detalhe:
ele faz parte do conteúdo assinado, e a primeira versão só o definia na geração —
o que fazia a verificação recalcular o hash com outro instante e reprovar **todo**
certificado (defeito real, encontrado pelo teste de integração; ver lição nº 1).

---

## 6. O documento: PDF e SVG determinísticos, escritos à mão

```
PDF = %PDF-1.4 + catálogo/páginas/página + stream de conteúdo + xref + trailer
SVG = 1123 × 794 (A4 paisagem) com texto e o QR em retângulos
```

**Por que não usar uma biblioteca de PDF:** um documento com valor probatório
precisa de **determinismo** — o mesmo conteúdo tem de produzir bytes idênticos. Com
bibliotecas, isso depende de metadados internos (IDs, datas, versões da lib) que
mudam entre execuções. Aqui o arquivo é gerado por ~200 linhas legíveis, e o
`CreationDate` do PDF vem do `issuedAt` do conteúdo, não do relógio.

Detalhes que os testes cobrem:

- **fontes padrão** (Helvetica) — não embutidas, porque uma fonte embutida
  colocaria um binário no arquivo e o hash passaria a depender dele;
- **tabela `xref` com offsets reais** — um `xref` incorreto faz leitores estritos
  recusarem o arquivo, e o defeito é invisível em visualizadores tolerantes;
- **escape de `(`, `)` e `\`** no texto do PDF, e de `&`, `<`, `>` no SVG;
- **acentuação** via `/Encoding /WinAnsiEncoding`;
- **determinismo** conferido por teste (`render(doc) === render(doc)`).

---

## 7. QR Code: vetor, e por que uma biblioteca

O QR é desenhado como **retângulos** (SVG `<rect>` e operadores `re f` no PDF
content stream), não como imagem embutida: um QR é preto e branco por definição, e
embutir um bitmap exigiria um XObject com os bits da imagem — mais complexo, maior
e sem ganho.

A codificação usa a biblioteca `qrcode` (ADR-037). Implementar QR à mão é viável,
mas um QR sutilmente incorreto **falha em silêncio**: o documento parece perfeito na
tela e nenhum leitor de celular consegue ler. Diferente de um bug de layout, esse
erro não aparece em revisão nem em teste de unidade — aparece no dia do evento, com
a fila de pessoas segurando o papel. O que É verificado por teste é o que a
biblioteca não pode garantir: os **padrões localizadores** (o "olho" do QR) e a
contagem de módulos escuros desenhados.

---

## 8. A fila: BullMQ — e a emissão que não depende dela

```text
requestCertificate  → linha QUEUED com snapshot + código + hash + assinatura  (barato)
generateCertificate → renderiza → envia ao storage → ISSUED                   (pesado)
```

**Por que duas fases.** O documento passa a existir (com código válido e conteúdo
congelado) **antes** de o arquivo existir. Se o worker estiver fora do ar, o
participante vê "em processamento" em vez de nada — e o QR nunca aponta para um
código inexistente.

**A fila é opcional; a emissão não.** `enqueueCertificate` devolve `false` quando o
Redis não responde, e o chamador então gera **inline**. Gamificação e certificado
são funcionalidades do produto: depender de um broker para que funcionem
transformaria indisponibilidade de infraestrutura em indisponibilidade de produto.
O que se perde é escala; o que se ganha é que o certificado sai de qualquer maneira.

O worker:

- registra a fila `certificates` com concorrência configurável (`WORKER_CONCURRENCY`);
- usa `jobId = certificate:<id>` — enfileirar duas vezes **não** cria dois jobs (a
  idempotência do banco estendida à fila);
- tem 3 tentativas com backoff exponencial; falha é gravada em `failureReason` para
  que o operador veja o motivo, em vez de um certificado eternamente pendente;
- fecha com `worker.close()`, que espera o job em andamento terminar (matar no meio
  deixaria um certificado preso em `GENERATING`);
- **cada operação abre a própria transação com `withTenant`**: não existe "worker
  global" lendo dados de todos os tenants.

---

## 9. Validação pública: o código é a capacidade

```
/validar/CERT-ABCD2345      → página pública, sem login
/api/certificados/<código>/arquivo → download por link assinado (5 min)
```

Quem valida é tipicamente um **terceiro**: um empregador, uma banca, um órgão de
fomento. Exigir cadastro destruiria o propósito — e o código impresso no documento
é a credencial.

O problema técnico: a RLS é fail-closed e o validador **não sabe a qual instituição
o documento pertence**. A solução segue o padrão já usado para resolver `tenants`
antes do contexto existir (FASE 1): uma policy ADICIONAL de leitura.

```sql
CREATE POLICY certificate_public_validation ON public.certificates
  FOR SELECT TO eventflow_app
  USING ("validationCode" = NULLIF(current_setting('app.validation_code', true), ''));
```

- sem a variável de sessão, `current_setting(..., true)` é NULL → a comparação nunca
  é verdadeira → **nada** é visível (fail-closed como todo o resto);
- a capacidade é definida por TRANSAÇÃO (`set_config(..., true)` é local), então ela
  morre no COMMIT e não vaza no pool de conexões;
- a policy é **somente SELECT**: quem valida lê o documento pelo código, mas o
  contador de validações é atualizado depois, dentro do contexto de tenant já
  resolvido — o tenant responde pela escrita.

**O que a página NÃO mostra:** e-mail, documento, endereço, id interno. Mostra o que
já está IMPRESSO no certificado (nome, evento, carga horária, código, hash).
Publicar mais do que o documento expõe seria vazamento disfarçado de transparência.

### 9.1 Alfabeto do código

```
23456789ABCDEFGHJKMNPQRTUVWXY   (29 símbolos, 8 posições ≈ 5 × 10¹¹ combinações)
```

Foram removidos `0/O`, `1/I/L`, `5/S` e `2/Z` — os pares que se confundem quando o
código é lido em voz alta, transcrito à mão ou lido de um QR impresso.

**Caracteres parecidos NÃO são "corrigidos".** Mapear `O`→`Q` transformaria um erro
de digitação em OUTRO código válido — possivelmente de outra pessoa. Mostrar o
certificado de um estranho por causa de um typo é pior do que dizer "código
inválido": o formato simplesmente reprova e a página orienta a conferência.

### 9.2 Revogação

Revogar torna o documento inválido **na hora**, com o motivo publicado, e bloqueia o
download tanto na página quanto na rota de arquivo — quem guardou o link direto não
continua baixando um documento revogado. A distinção entre "não existe" e "existe
mas foi revogado" é essencial: quem recebeu um certificado revogado precisa entender
que o documento é falso **agora**, mesmo tendo sido emitido de fato.

---

## 10. Evidência de verificação

### 10.1 Suíte completa (Vitest)

```text
tests/unit/certificate-rules.test.ts               40 testes  ✓
tests/unit/certificate-renderer.test.ts            27 testes  ✓
tests/integration/certification.test.ts            24 testes  ✓
tests/unit/xp-rules.test.ts                        25 testes  ✓   (FASE 5)
tests/unit/card-rules.test.ts                      34 testes  ✓   (FASE 5)
tests/unit/task-rules.test.ts                      24 testes  ✓   (FASE 5)
tests/integration/gamification.test.ts             19 testes  ✓   (FASE 5)
tests/integration/gamification-services.test.ts    21 testes  ✓   (FASE 5)
tests/unit/review-rules.test.ts                    52 testes  ✓   (FASE 4)
tests/unit/submission-and-affinity.test.ts         72 testes  ✓   (FASE 4)
tests/unit/conflict-of-interest.test.ts            51 testes  ✓   (FASE 4)
tests/unit/event-rules.test.ts                     46 testes  ✓   (FASE 3)
tests/unit/rbac-authorization.test.ts              41 testes  ✓   (FASE 2)
tests/unit/landing-page.test.ts                    31 testes  ✓   (FASE 3)
tests/unit/registration-rules.test.ts              29 testes  ✓   (FASE 3)
tests/unit/tenant-resolution.test.ts               27 testes  ✓   (FASE 2)
tests/integration/peer-review.test.ts              18 testes  ✓   (FASE 4)
tests/integration/registration-concurrency.test.ts  8 testes  ✓   (FASE 3)
tests/integration/tenant-isolation.test.ts          8 testes  ✓   (FASE 1)
                                                  ─────────
                                         Total: 597 testes
```

Destaques do que é **provado**:

- o teto da carga horária funciona (300 min em minicurso de 240 → certificado de 240);
- presença abaixo do mínimo não conta, **com o motivo registrado**;
- pedir o mesmo certificado duas vezes devolve **o mesmo documento e o mesmo código**;
- a emissão é **bloqueada** sem segredo de assinatura configurado;
- gerar duas vezes produz o **mesmo hash** (documento reprodutível);
- o objeto existe **de verdade** no bucket, com o tamanho declarado;
- **adulterar o conteúdo no banco faz a assinatura não conferir**;
- a validação pública funciona **sem contexto de tenant** e atravessa instituições;
- o contador de validações cresce a cada consulta;
- código malformado é recusado **sem tocar no banco**;
- revogação torna o documento inválido e **bloqueia o download**;
- o download é negado a terceiros e permitido ao dono;
- um certificado de outro tenant não aparece na listagem;
- o `xref` do PDF aponta para offsets REAIS (o teste percorre cada objeto);
- o SVG/PDF contêm o número exato de retângulos escuros do QR.

### 10.2 E2E — contra o container de PRODUÇÃO

```text
auth-tenancy.spec.ts          (12 testes, FASES 2 preservadas)   ✓
registration-journey.spec.ts  ( 9 testes, FASE 3 preservada)     ✓
peer-review.spec.ts           ( 5 testes, FASE 4 preservada)     ✓
gamification.spec.ts          ( 2 testes, FASE 5 preservada)     ✓
certification.spec.ts         ( 2 testes)                        ✓

✓ certificação de ponta a ponta › credencia, emite, gera pela fila e valida publicamente
✓ certificação de ponta a ponta › código inexistente não valida nada

30 passed
```

A jornada percorre a pilha inteira: a equipe credencia e registra a saída (60 min
medidos) → o participante emite pela tela → o **worker da fila** gera o arquivo e a
tela passa a oferecer o PDF → o PDF baixado começa com `%PDF-` → um **contexto de
navegador anônimo** (sem cookie, sem login) valida o documento pelo código e vê a
assinatura conferida.

### 10.3 Qualidade

```text
ESLint       0 erros, 0 warnings
tsc          0 erros
next build   ✓ compilado (rotas novas: /certificados, /validar/[code], /api/certificados/[code]/arquivo)
```

### 10.4 Garantias das fases anteriores

```text
CONTRATO DE ISOLAMENTO MULTI-TENANT          Contrato íntegro.
ISOLAMENTO MULTI-TENANT (9 ataques)          9/9 verificações passaram.
```

A policy nova é **aditiva**: ela não afrouxa o isolamento, cria uma porta estreita e
fail-closed para exatamente uma linha. As assertivas do provisionamento passaram a
exigir a existência dela — sem isso, o QR impresso não validaria em lugar nenhum.

O worker da fila abre transações com contexto de tenant por operação; não há leitura
global de dados de tenant em nenhum ponto do processo.

---

## 11. Comandos operacionais

### 11.1 Ambiente completo

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:setup          # migrate + rls + verify + isolation + seed
npm run dev               # http://localhost:3000
```

### 11.2 Dados de demonstração (FASE 6)

O seed cria **fatos reais** (presença medida do Bruno no minicurso de 240 min e um
trabalho aceito da Ana na trilha) e emite os documentos pelo caminho de produção:

```text
Certificação (FASE 6):
  Bruno (minicurso): CERT-XXXXXXXX (emitido) · http://localhost:3000/validar/CERT-XXXXXXXX
  Ana (autoria):     CERT-YYYYYYYY (emitido) · http://localhost:3000/validar/CERT-YYYYYYYY
```

Os códigos são impressos no fim da execução do seed — abra a URL em uma **janela
anônima** para ver a validação pública funcionando sem sessão.

### 11.3 Testes

```bash
npm test                  # Vitest: 597 testes (unit + integração)
npm run test:e2e          # Playwright: 30 testes contra o container
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
npm run build             # build de produção (força NODE_ENV=production)
npm run db:verify         # contrato de RLS (inclui a policy de validação pública)
npm run db:verify:isolation  # 9 ataques de isolamento entre tenants
```

### 11.4 Stack completa (web + worker)

```bash
docker compose --profile app up -d --build
docker compose --profile app ps
docker logs eventflow-worker --tail 30     # fila de certificados
```

### 11.5 Variáveis de assinatura

```bash
CERTIFICATE_SIGNING_KEY_ID=dev-key-2025-01
CERTIFICATE_HMAC_SECRET=dev-hmac-secret-change-me
```

**O web e o worker precisam das MESMAS chaves**: a assinatura nasce na requisição
(web) e é verificada na validação pública (web); chaves divergentes fariam todo
certificado parecer adulterado. Em produção, o segredo vem de um cofre — e trocá-lo
exige trocar o `keyId` (é o que torna a rotação auditável).

---

## 12. ADRs — decisões desta fase

### ADR-032 — Snapshot imutável do conteúdo

**Contexto:** o certificado referencia evento, atividade e participante; todos podem
ser editados depois.
**Decisão:** título, nome, texto, carga horária e detalhamento são **copiados** no
momento da emissão e nunca mais lidos das tabelas originais.
**Justificativa:** um documento com valor probatório não pode mudar porque alguém
corrigiu o título do evento. Sem snapshot, dois certificados do mesmo evento
discordariam entre si.
**Consequências:** correções precisam **revogar e reemitir** (com rastro), não editar.

### ADR-033 — Hash e assinatura sobre o conteúdo canônico, não sobre o arquivo

**Contexto:** o mesmo certificado é oferecido em PDF e SVG.
**Decisão:** o hash SHA-256 e a assinatura cobrem um JSON canônico de ordem fixa; os
renderizadores são apresentação.
**Justificativa:** assinar o arquivo amarraria a validade ao formato — e qualquer
mudança de layout invalidaria documentos já emitidos.
**Consequências:** a ordem das chaves do JSON é parte do contrato (mudá-la muda o
hash de todo o acervo). Há teste que confere que **qualquer** campo alterado muda o
hash.

### ADR-034 — Assinatura HMAC-SHA256 com `keyId` (e o caminho para PKCS#7)

**Contexto:** certificado digital pode ser simétrico (HMAC) ou assimétrico (CMS/X.509).
**Decisão:** HMAC-SHA256 com `keyId` incluído na mensagem assinada.
**Justificativa:** HMAC não exige autoridade certificadora nem cofre de chave privada,
e resolve o caso real (a instituição valida o próprio documento). Assinatura
assimétrica permitiria validação offline por terceiros que não confiam na instituição
— e está registrada como evolução, com o campo `signatureAlg` já preparado.
**Consequências:** a verificação exige o segredo (feita pela aplicação). O limite é
**documentado na própria página pública**, que diz "assinatura verificada pela
instituição" em vez de prometer algo que HMAC não entrega.

### ADR-035 — PDF e SVG gerados pelo próprio código

**Contexto:** gerar PDF determinístico e auditável.
**Decisão:** escritor mínimo de PDF (fontes padrão, sem embutir fonte) e SVG, ambos
sem dependência externa.
**Justificativa:** determinismo (mesmo conteúdo → mesmos bytes) e auditabilidade
(~200 linhas legíveis) importam mais que conveniência num documento probatório.
**Consequências:** recursos avançados de PDF (fontes embutidas, imagens) exigiriam
mais código. O QR é desenhado como vetor, o que dispensa XObject de imagem.

### ADR-036 — Validação pública por policy dedicada, com o código como capacidade

**Contexto:** validar um QR exige ler um documento sem saber a instituição e sem
sessão — e a RLS é fail-closed.
**Decisão:** policy ADICIONAL de SELECT em `certificates`, liberando a linha cujo
`validationCode` é igual à variável de sessão `app.validation_code` (definida por
transação).
**Justificativa:** é o mesmo padrão já usado para resolver `tenants` antes do
contexto (FASE 1), é fail-closed por construção e não exige uma segunda conexão com
privilégios elevados.
**Consequências:** a policy é somente leitura; a escrita (contador de validações)
acontece no contexto de tenant já resolvido. O provisionamento passa a **exigir** a
policy, senão o QR não valida.

### ADR-037 — Codificação de QR por biblioteca consolidada

**Contexto:** o certificado precisa de QR Code legível por celular.
**Decisão:** usar `qrcode` para a matriz, desenhando-a como vetor.
**Justificativa:** um QR sutilmente incorreto **falha em silêncio** — o documento
parece perfeito e nenhum leitor consegue ler. Implementá-lo à mão (Reed-Solomon,
máscaras, formato) trocaria uma dependência pequena e estável por um risco que só se
materializa no dia do evento.
**Consequências:** uma dependência a mais no bundle (server-side apenas). O que a
biblioteca não garante continua testado: padrões localizadores e contagem de módulos.

### ADR-038 — A fila é opcional; a emissão não

**Contexto:** a geração do arquivo é pesada e foi para o worker (BullMQ).
**Decisão:** `enqueueCertificate` devolve `false` se o Redis não responder e o
chamador gera **inline**.
**Justificativa:** funcionalidade do produto não pode depender da disponibilidade de
um broker. O que se perde na geração inline é escala; o que se ganha é que o
certificado sai.
**Consequências:** sob Redis indisponível, requisições de emissão ficam mais lentas
(~200 ms por documento). A emissão em lote tenta a fila por certificado.

---

## 13. Lições aprendidas — defeitos reais encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | **Todo** certificado reprovava na verificação de assinatura | O `issuedAt` faz parte do conteúdo canônico, mas só era gravado na GERAÇÃO; a verificação recalculava com `createdAt` (ms depois) e o hash não fechava | `issuedAt` gravado na SOLICITAÇÃO (o documento passa a existir ali) |
| 2 | O resultado do check-out nunca aparecia na tela do credenciamento | `inState ?? outState` preferia para sempre o resultado da entrada | Resultado derivado do estado da linha (quem está dentro acabou de entrar) |
| 3 | O botão continuava oferecendo "Registrar saída" após a saída | `isInside` era derivado de `registration.checkedInAt`, que nunca é limpo no check-out | `isInside` derivado da última `Attendance` sem `checkedOutAt` |
| 4 | `status: 'COMPLETED'` recusado no fixture | Valor inventado; o enum é `SUBMITTED` | Uso do valor real do enum (`ReviewStatus`) |
| 5 | Teste de `xref` passava por engano / expectativas de contagem erradas | `lastIndexOf('xref')` encontra o `xref` dentro de `startxref`; contagens fixas de retângulos presumidas | Busca por `\nxref\n` e contagens conferidas contra a matriz do QR |
| 6 | Alfabeto do código ainda continha `S` e `Z` | Remoção incompleta dos pares ambíguos | Alfabeto de 29 símbolos, com teste que percorre cada símbolo |

Os itens **1, 2 e 3 são defeitos de produto** — e os três passariam por qualquer
teste que não exercitasse o fluxo completo. O nº 1 é o mais grave: ele invalidaria
**todos** os certificados emitidos pelo sistema, e só apareceu porque o teste de
integração verifica a assinatura a partir do que está GRAVADO, não do que foi
calculado em memória. O nº 3 mostra o valor de testar o ciclo inteiro: o check-out
existia desde a fase anterior e nunca havia sido exercitado de ponta a ponta.

---

## 14. Dívidas técnicas e trabalho adiado

**Adiado conscientemente:**

1. **Assinatura assimétrica (PKCS#7/CMS)** — permitiria validação offline por
   terceiros sem confiar na instituição. Exige autoridade certificadora e cofre de
   chave privada; o campo `signatureAlg` e a interface de verificação já estão
   preparados para a troca.
2. **Painel administrativo de certificados (FASE 7)** — buscar por evento/participante,
   ver falhas do worker (`failureReason`, `attempts`) e reenfileirar. As ações de
   emissão em lote e revogação já existem e estão testadas.
3. **Validação em lote** — conferir uma lista de códigos de uma vez (útil para
   contratação). O serviço é um `map` sobre o que existe; falta a tela.
4. **Certificado de mérito e de organização pela UI** — `MERIT` é decisão humana e
   `ORGANIZER` depende de papel; ambos exigem uma tela de emissão individual que
   entra com o painel da FASE 7.
5. **Assinatura visual (imagem de rubrica)** — o documento sai com o bloco de
   validação, mas sem rubrica digitalizada do responsável.
6. **Notificação de emissão** — hoje é preciso entrar na tela. E-mail com o PDF
   anexo/link depende da mesma fila (o worker já está de pé).
7. **Exportação em lote (ZIP)** — para o organizador baixar todos os certificados do
   evento.
8. **Antivírus/verificação de anexos** — segue como dívida da FASE 4 (arquivos de
   submissão); certificados são gerados pela aplicação e não recebem upload externo.

**Pontos de atenção:**

- Trocar `CERTIFICATE_HMAC_SECRET` **sem trocar o `keyId`** invalida a verificação de
  todos os documentos já emitidos. A rotação é: novo `keyId` + segredo novo, mantendo
  a chave antiga disponível para verificação (o `keyId` gravado diz qual usar).
- O web e o worker **precisam das mesmas chaves** de assinatura.
- Jamais remova a policy `certificate_public_validation`: sem ela, todo QR Code
  impresso aponta para uma página que não encontra o documento.
- `periodKey`/`issuedAt`/ordem das chaves canônicas são CONTRATO de dados: mudá-los
  altera hashes já emitidos.

---

## 15. Checklist de aceite da FASE 6

- [x] 8 tipos de certificado, cada um com regra de elegibilidade explícita
- [x] Recusa de elegibilidade **com motivo textual**
- [x] `MERIT` nunca automático (decisão humana)
- [x] Carga horária somada de presenças REAIS (entrada e saída medidas)
- [x] Teto na carga declarada da atividade
- [x] Presença abaixo de 75 % não conta, com o motivo no detalhamento
- [x] Sem check-out, o tempo é zero (nunca presença presumida)
- [x] Snapshot imutável do conteúdo (ADR-032)
- [x] Conteúdo canônico de ordem fixa; hash SHA-256 determinístico
- [x] Assinatura HMAC-SHA256 com `keyId` e comparação em tempo constante
- [x] `issuedAt` gravado na solicitação (assinatura reprodutível)
- [x] PDF determinístico, com fontes padrão e `xref` correto
- [x] SVG determinístico para a página pública
- [x] Escape correto em PDF e SVG (acentos, parênteses, `&`, `<`)
- [x] QR Code vetorial, com padrões localizadores verificados em teste
- [x] Fila BullMQ com retry, backoff, `jobId` idempotente e shutdown gracioso
- [x] Geração **inline** quando o Redis não responde (emissão não depende do broker)
- [x] Worker abre transação com contexto de tenant por operação
- [x] Emissão idempotente por chave natural (mesmo documento, mesmo código)
- [x] Emissão bloqueada sem segredo de assinatura configurado
- [x] Emissão em lote para os elegíveis de um evento, com contagem de ignorados
- [x] **Validação pública sem login**, por policy dedicada e fail-closed
- [x] Validação atravessa instituições (é o propósito do QR)
- [x] Assinatura verificada a partir do que está GRAVADO no banco
- [x] Adulteração do conteúdo detectada (teste de integração)
- [x] Código com alfabeto sem ambiguidade e sem "correção" de caracteres parecidos
- [x] Código malformado recusado sem consultar o banco
- [x] Revogação com motivo, invalidando a página **e** o download
- [x] Download por link assinado e temporário; negado a terceiros
- [x] Contador de validações registrado
- [x] Página pública não expõe dado além do que está impresso no documento
- [x] Seed emite certificados reais pelo caminho de produção
- [x] **597 testes** unitários e de integração passando
- [x] **30 testes E2E** passando contra o container de produção
- [x] ESLint 0 erros · `tsc` 0 erros · `next build` OK
- [x] Contrato de RLS íntegro · isolamento 9/9 (FASES 1–5 preservadas)
- [x] Documentação com ADRs, diagramas e comandos

**Próximo passo:** FASE 7 — Painel administrativo do tenant e E2E completo: gestão de
eventos, atividades, salas, trilhas e página; administração de cartas, missões e
certificados; credenciamento completo com leitura de QR Code; e a suíte E2E cobrindo
a plataforma inteira.

Aguardando **"APROVADO: AVANÇAR"**.
