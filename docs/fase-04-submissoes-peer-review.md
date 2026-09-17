# FASE 4 — Submissão de Trabalhos e Avaliação por Pares

> **Status:** concluída · aguardando `APROVADO: AVANÇAR`
> **Pré-requisitos:** FASES 1, 2 e 3 aprovadas e verificadas
> **Stack desta fase:** Next.js Server Actions + S3/MinIO (URL pré-assinada), Prisma 7,
> PostgreSQL 18 com RLS, Vitest (unit + integração) e Playwright (E2E)

---

## 1. Sumário executivo

Esta fase entrega o **processo científico** da plataforma: chamada de trabalhos por
trilha, submissão com versão cega, distribuição de revisores por afinidade,
detecção de conflito de interesse, parecer com nota ponderada, consenso,
divergência e decisão do comitê.

O que foi construído:

| Área | Entrega |
|---|---|
| Trilhas (Call for Papers) | `Track` com rubrica, nº de pareceres exigidos, limiares de aceite/rejeição e limite por autor |
| Submissão | Rascunho → envio, protocolo público, versão cega e identificada, versionamento de arquivos |
| Arquivos | Upload **direto ao storage** com URL pré-assinada, SHA-256 no navegador e confirmação de integridade no servidor |
| Distribuição | Painel do comitê com **elegíveis**, **bloqueados com o motivo** e **sugestões por afinidade** |
| Conflito de interesse | 6 tipos, com nível de certeza, revalidação dentro da transação e override assimétrico |
| Parecer | Rubrica validada, nota ponderada calculada **no servidor**, recomendação sugerida |
| Revisão cega | Remoção **estrutural** da autoria e bloqueio da versão identificada na emissão da URL |
| Decisão | Quórum por trilha, consenso, detecção de divergência e estados terminais |
| Autorização de páginas | Guarda de permissão no servidor antes de consultar dados (o painel do comitê não é visível a participante) |

Números desta fase:

```text
Arquivos de domínio novos        4   (review-rules, submission-rules, conflict-of-interest, affinity)
Serviços de aplicação novos      2   (submission-service, review-service)
Server Actions novas             7   (submissão, upload, parecer, atribuição, decisão)
Páginas novas                    7   (/submissoes, /revisoes, /comite e detalhes)
Modelos Prisma novos             2   (ReviewerExpertise, ReviewerConflictDeclaration)
Campos novos em modelos         10
Migração                         1   (20260917000946_phase4_peer_review)
Testes novos                   193   (175 unitários + 18 de integração) + 5 E2E
```

---

## 2. O problema mais difícil desta fase

Na FASE 3 o inimigo era a **corrida** (duas pessoas ocupando a mesma vaga). Aqui o
inimigo é a **confiança**: um parecer só vale se for possível demonstrar que o
revisor estava apto, que ele leu a versão certa e que ele não tinha impedimento.

Três perguntas definem o desenho:

1. **Quem pode avaliar isto?** → conflito de interesse (bloqueio) + afinidade (sugestão).
2. **O que o revisor pode ver?** → revisão cega aplicada no servidor, inclusive na URL do arquivo.
3. **A nota é confiável?** → calculada no servidor a partir da rubrica, com versão do arquivo registrada no parecer.

Cada uma delas tem uma decisão de arquitetura própria (ADRs 019 a 024).

---

## 3. O fluxo de upload, em três etapas

### 3.1 Por que o arquivo NÃO passa pela aplicação

```text
      1. requestUpload    → valida (PDF, tamanho) e devolve URL pré-assinada
      2. (navegador)      → PUT direto no MinIO/S3
      3. confirmUpload    → confere o objeto armazenado e registra o artefato
```

Se o PDF atravessasse o processo Node, um arquivo de 25 MB ocuparia 25 MB de heap
por requisição simultânea — e um envio de 20 arquivos derrubaria a instância. Com a
URL pré-assinada, o corpo do arquivo nunca entra na aplicação.

### 3.2 O que torna a etapa 3 obrigatória

Um arquivo no bucket não é um artefato: é um blob sem proveniência. A confirmação é
o que transforma o upload em registro auditável, porque ela:

1. pergunta ao storage o tamanho e o checksum **do objeto realmente armazenado**;
2. compara com o que o cliente declarou (`verifyStoredObject`);
3. **descarta o objeto** quando a integridade falha, em vez de deixá-lo no bucket;
4. só então grava `SubmissionFile` com `checksum`, `sizeBytes`, `bucket` e `version`.

O checksum é calculado **no navegador** (Web Crypto) porque o servidor não vê o
conteúdo. Sem ele, a única verificação possível seria o tamanho — e um arquivo de
mesmo tamanho com conteúdo diferente passaria.

### 3.3 O tamanho é assinado, não apenas checado

O `ContentLength` faz parte da URL assinada. Um PUT com corpo maior que o declarado
é recusado **pelo próprio storage** (HTTP 403), antes de qualquer byte ser
persistido. Validação de tamanho apenas no cliente é uma sugestão, não uma regra.

### 3.4 Idempotência da confirmação

Uma resposta de rede perdida faz o navegador repetir a confirmação. Sem proteção, a
segunda tentativa colidiria com o índice único `(submissionId, kind, version)` e o
autor veria erro em uma operação que já havia dado certo.

A confirmação é idempotente **pela chave do objeto**: reconfirmar o mesmo upload
devolve o registro existente; confirmar um objeto diferente cria versão nova.

---

## 4. Versionamento: o parecer aponta para a versão que foi lida

| Situação | Efeito |
|---|---|
| Reenvio antes do envio | Substitui a versão corrente |
| Reenvio depois de enviado | Cria **nova versão**; a anterior continua existindo, marcada como não-corrente |
| Parecer | Grava `submissionVersion`, o número exato da versão avaliada |

`isCurrent` existe para que "o arquivo atual" seja uma consulta direta, sem depender
de ordenação por versão em cada leitura. O histórico é o que permite responder, meses
depois, *qual* PDF o revisor leu quando deu nota 9 em metodologia.

---

## 5. Nota ponderada — e por que o cliente nunca a envia

A rubrica é uma lista de critérios com peso e escala, definida por trilha:

```json
[
  { "key": "originality", "label": "Originalidade", "weight": 3, "maxScore": 10 },
  { "key": "methodology", "label": "Metodologia",  "weight": 2, "maxScore": 10 },
  { "key": "clarity",     "label": "Clareza",      "weight": 1, "maxScore": 10 }
]
```

A nota final **não é média**: é

```text
score = Σ (nota / máximo × peso) / Σ peso × 100
```

Com pesos 3/2/1, um 10 em metodologia vale mais que um 10 em clareza. Uma média
simples trataria os dois como equivalentes e mudaria a decisão de aceite.

**O formulário envia apenas as notas por critério** (`score_originality`, …). A nota
final, a recomendação sugerida e o `scoreBreakdown` são calculados no servidor
(`computeWeightedScore` + `suggestRecommendation`) e persistidos. Aceitar uma nota
final do cliente permitiria "ajustar" a decisão por requisição forjada — e o
`scoreBreakdown` existe para que a nota seja auditável critério a critério.

Notas fora da escala da rubrica são **recusadas** (`validateScores`), não truncadas:
truncar silenciosamente transformaria um erro de formulário em um parecer válido.

---

## 6. Distribuição por afinidade — sugestão, nunca decisão

```text
afinidade = 0,40 × sobreposição de palavras-chave
          + 0,35 × trilha declarada
          + 0,15 × semelhança com o título
          + 0,10 × experiência (pareceres concluídos, satura em 10)
          − penalidade de carga (6 por parecer ativo, teto 30)
```

Faixas: `EXCELLENT ≥ 70`, `GOOD ≥ 50`, `FAIR ≥ 25`, abaixo disso `WEAK` (não é
sugerido — `MIN_USEFUL_AFFINITY`).

Duas decisões de projeto merecem registro:

1. **A trilha declarada pesa quase tanto quanto as palavras-chave.** Um revisor que
   diz "avalia esta trilha" fez uma declaração explícita; a inferência por texto é
   palpite. Quando as duas discordam, a declaração é a evidência melhor.
2. **A comparação é Jaccard sobre conjuntos de tokens**, com *stemming* mínimo
   (apenas plurais e gerúndio) e lista de palavras vazias em português **e** inglês.
   É conservador de propósito: prefiro sugerir um revisor razoável a sugerir um
   revisor errado com confiança alta. O comitê revisa a sugestão — ela é um ponto de
   partida, não uma ordem.

O resultado é sempre uma **lista ordenada com o motivo de cada nota**, exibida como
sugestão. Não existe atribuição automática: quem responde pelo parecer é o comitê.

---

## 7. Conflito de interesse — a assimetria é deliberada

### 7.1 Seis tipos, dois níveis de certeza

| Tipo | Detecção | Certeza | Exemplo |
|---|---|---|---|
| `SELF_DECLARED` | DECLARED | CERTAIN | O revisor declara conflito |
| `COAUTHOR` | AUTOMATIC | CERTAIN | Revisor é autor (ou o correspondente) |
| `ADVISOR_ADVISEE` | AUTOMATIC | CERTAIN | Orientação registrada |
| `FINANCIAL_TIE` | DECLARED | CERTAIN | Consultoria, bolsa, vínculo |
| `PERSONAL_RELATIONSHIP` | DECLARED | CERTAIN | Relação pessoal declarada |
| `SAME_INSTITUTION` | AUTOMATIC | CERTAIN ou UNCERTAIN | Afiliação declarada (certa) ou domínio de e-mail (heurística) |

`BLOCK_ON_UNCERTAIN_CONFLICT = true`: **na dúvida, bloqueia**. A pergunta certa não é
"é quase certo que não há conflito?", e sim "alguém consegue demonstrar que não há?".
Conflito incerto bloqueia e aparece no painel com o motivo — o comitê decide com
informação, não no escuro.

### 7.2 Override permitido apenas para o incerto

```text
conflito CERTAIN    → nunca sobreponível (é fato, não heurística)
conflito UNCERTAIN  → sobreponível com flag explícita, registrada no matchReason
```

Permitir override de conflito certo abriria a porta para "autorizar" alguém a
avaliar o próprio trabalho — com um clique e sem mentira explícita. Já o conflito
heurístico (dois `@ufba.br` que não se conhecem) precisa de saída: sem ela, o comitê
ficaria travado por um palpite do sistema.

### 7.3 A detecção é revalidada DENTRO da transação

```text
1. FILTRAR conflito   (monta o painel)
2. PONTUAR afinidade  (sugere)
3. ATRIBUIR           (REVALIDA o conflito na transação)
```

A revalidação não é redundância: entre ver o painel e clicar em "atribuir" o revisor
pode ter declarado um conflito novo, ou a lista de autores pode ter mudado. Uma
verificação feita apenas na leitura é uma verificação que o tempo contorna.

### 7.4 Instituição: duas passagens, da evidência forte para a fraca

1. **Afiliação declarada contra afiliação declarada** → CERTAIN
   (tolerante a "UFBA" ⊂ "Universidade Federal da Bahia - UFBA" e a siglas).
2. **Domínio de e-mail institucional** → UNCERTAIN.

A ordem importa: se a heurística de domínio fosse avaliada junto, um caso com
evidência CERTA disponível seria classificado como incerto e o comitê leria a
mensagem mais fraca das duas.

O domínio **declarado substitui** o domínio do e-mail (não se soma a ele), e
domínios reservados de teste/rede interna (`*.test`, `*.example`, `intranet`, …) são
recusados como evidência. Ver a lição nº 2 — essa regra existe por causa de um
defeito real encontrado pelo E2E.

---

## 8. Revisão cega: remoção estrutural, não cosmética

```text
AUTOR       → vê tudo (a autoria é dele)
REVISOR     → só BLIND_PDF enquanto a revisão é cega
COMITÊ      → vê tudo (precisa decidir)
```

Duas barreiras independentes:

1. **Remoção estrutural** (`redactForBlindReview`): os campos `authors` e
   `submittedById` são *removidos do objeto*, não apenas escondidos na UI. Campo
   presente e não renderizado é vazamento por serialização — basta um
   `console.log`, um dump de props ou um erro de hidratação para expor a autoria.
2. **A regra vive onde a URL é emitida** (`getFileDownloadUrl` exige
   `{ role, isBlind }`). Uma URL pré-assinada é acesso direto ao objeto: se a regra
   existisse só na montagem da lista, qualquer ponto de uso futuro (route handler,
   e-mail, relatório) emitiria a URL da versão identificada sem violar nada.
   Exigir o par na assinatura da função faz o **compilador** cobrar a decisão.

`SUPPLEMENTARY`, `PRESENTATION` e `CAMERA_READY` são negados ao revisor cego por
padrão: costumam conter nomes, afiliações e agradecimentos.

---

## 9. Consenso, divergência e decisão

- **Quórum:** definido por trilha (`Track.requiredReviews`, padrão 2). Decidir sem
  quórum exige `overrideQuorum` **e justificativa** — a exceção existe para o mundo
  real (prazo estourando), mas deixa rastro.
- **Consenso:** média dos pareceres com desvio-padrão.
- **Divergência:** desvio-padrão ≥ 15 pontos sinaliza pareceres que **não** podem ser
  tratados como consenso. Um 95 e um 35 dão média 65 — e média nenhuma deveria
  esconder que dois revisores discordam frontalmente. O painel mostra a divergência
  para o comitê decidir com essa informação.
- **Estados terminais:** `ACCEPTED`, `REJECTED`, `WITHDRAWN` e `CANCELED` não voltam
  atrás (`ALLOWED_TRANSITIONS`). Reabrir é ação administrativa explícita, não
  transição silenciosa.

---

## 10. Autorização das telas do comitê

O menu esconde o link do comitê de quem não é do comitê — mas **esconder link não é
autorização**: quem digita a URL entra. O painel revela títulos, resumos, lista
nominal de revisores, motivos de bloqueio e o conteúdo dos pareceres.

Por isso `/comite` e `/comite/[submissionId]` passam por
`requirePagePermission(...)` **antes** de qualquer consulta:

```text
/comite                    exige submission:read:any
/comite/[submissionId]     exige submission:assign-reviewer
```

Sem permissão, a página redireciona para o painel **sem carregar dado algum** —
negar depois de buscar a lista seria negar com o dado já em memória (e no
histórico de cache). O `Principal` já vem resolvido no contexto da requisição, então
a guarda não custa uma segunda ida ao banco.

---

## 11. Máquina de estados da submissão

```text
DRAFT ──► SUBMITTED ──► UNDER_REVIEW ──┬──► ACCEPTED   (terminal)
  │           │              │          └──► REJECTED   (terminal)
  │           │              └──► REVISION_REQUESTED ──► SUBMITTED
  ├──► WITHDRAWN (terminal)
  └──► CANCELED  (terminal)
```

`REVISION_REQUESTED` devolve a submissão ao autor **sem apagar o histórico**: o
reenvio cria nova versão de arquivo e o parecer anterior continua apontando para a
versão que ele avaliou.

---

## 12. Evidência de verificação

### 12.1 Suíte completa (Vitest)

```text
tests/unit/review-rules.test.ts                    52 testes  ✓
tests/unit/submission-and-affinity.test.ts         72 testes  ✓
tests/unit/conflict-of-interest.test.ts            51 testes  ✓
tests/unit/event-rules.test.ts                     46 testes  ✓
tests/unit/rbac-authorization.test.ts              41 testes  ✓
tests/unit/landing-page.test.ts                    31 testes  ✓
tests/unit/registration-rules.test.ts              29 testes  ✓
tests/unit/tenant-resolution.test.ts               27 testes  ✓
tests/integration/peer-review.test.ts              18 testes  ✓
tests/integration/registration-concurrency.test.ts  8 testes  ✓
tests/integration/tenant-isolation.test.ts          8 testes  ✓
                                                   ─────────
                                          Total: 383 testes
```

Destaques do que é provado (não apenas executado):

- a nota ponderada é calculada no servidor e o detalhamento é persistido;
- notas fora da escala da rubrica são **recusadas**;
- quem não está atribuído **não** consegue dar parecer;
- o parecer de revisor em conflito **não** é aceito nem com override;
- aceitar a versão identificada pelo revisor cego retorna `FORBIDDEN`;
- a versão cega continua acessível ao revisor (o sigilo não impede o trabalho);
- `ACCEPTED` e `REJECTED` são terminais;
- decidir sem quórum exige justificativa;
- o consenso sinaliza divergência entre pareceres.

### 12.2 E2E — contra o container de PRODUÇÃO

```text
auth-tenancy.spec.ts          (12 testes, FASES 2 preservadas)   ✓
registration-journey.spec.ts  ( 9 testes, FASE 3 preservada)     ✓
peer-review.spec.ts           ( 5 testes)                        ✓

✓ submissão de trabalho › autor cria rascunho, anexa o PDF e envia para avaliação
✓ submissão de trabalho › recusa arquivo que não é PDF (validação no navegador)
✓ conflito de interesse no comitê › comitê vê o conflito BLOQUEANDO o revisor, com a razão
✓ conflito de interesse no comitê › PARTICIPANTE não acessa o painel do comitê
✓ revisão cega › revisor em revisão cega NÃO recebe a versão identificada

26 passed
```

O teste de submissão verifica o banco depois do envio: status `SUBMITTED`,
`submittedAt` preenchido, exatamente um arquivo `BLIND_PDF`, checksum SHA-256 em
hexadecimal e tamanho igual ao do PDF enviado. O teste de conflito entra
**explicitamente como presidente do comitê** (a última conta criada ficaria
autenticada, e o teste acabaria verificando a tela com o papel errado) e confirma
que o revisor conflitado **não** aparece entre os elegíveis e **sim** entre os
bloqueados, com a instituição citada na razão. O teste de RBAC confirma que um
participante que digita a URL do comitê é devolvido ao painel, sem que a fila seja
renderizada.

### 12.3 Qualidade

```text
ESLint       0 erros, 0 warnings
tsc          0 erros
next build   ✓ compilado, 21 rotas (FASE 3: 15)
```

### 12.4 Garantias das fases anteriores

```text
CONTRATO DE ISOLAMENTO MULTI-TENANT          Contrato íntegro.
ISOLAMENTO MULTI-TENANT (9 ataques)          9/9 verificações passaram.
```

As tabelas novas (`reviewer_expertise`, `reviewer_conflict_declarations`) entraram
no contrato de RLS: `npm run db:rls` reaplica as policies e o verificador falha se
alguma tabela com `tenantId` ficar sem `FORCE ROW LEVEL SECURITY`.

---

## 13. Comandos operacionais

### 13.1 Ambiente completo

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:setup          # migrate + rls + verify + isolation + seed
npm run dev               # http://localhost:3000
```

### 13.2 Dados de demonstração (FASE 4)

O seed cria, além do que já existia, **uma chamada de trabalhos** e **dois perfis de
revisor** em instituições diferentes:

```text
Contas de demonstração:
  ana@example.test    → ADMIN + CHAIR em ufba-demo · CHAIR + PARTICIPANT em fiocruz-demo
  bruno@example.test  → ORGANIZER + REVIEWER + STAFF em ufba-demo (declara a UFBA)
  carla@example.test  → PARTICIPANT em ufba-demo (convite PENDENTE)
  diego@example.test  → REVIEWER em ufba-demo (Universidade Estadual de Feira de Santana)

Trilha semeada:
  "Trilha de Tecnologia Educacional" — rubrica de 4 critérios (pesos 3/3/1/1),
  2 pareceres exigidos, aceite ≥ 70, rejeição < 45, revisão cega obrigatória

Fluxo demonstrável:
  /t/ufba-demo/submissoes        criar rascunho, anexar PDF, enviar
  /t/ufba-demo/comite            ver elegíveis, bloqueados (Bruno × autor da UFBA) e sugestões
  /t/ufba-demo/revisoes          dar parecer com rubrica e recomendação
```

### 13.3 Testes

```bash
npm test                  # Vitest: 383 testes (unit + integração)
npm run test:e2e          # Playwright: 25 testes contra o container
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
npm run build             # build de produção (força NODE_ENV=production)
npm run db:verify         # contrato de RLS
npm run db:verify:isolation  # 9 ataques de isolamento entre tenants
```

### 13.4 Stack completa em containers

```bash
docker compose --profile app up -d --build
docker compose --profile app ps
```

---

## 14. ADRs — decisões desta fase

### ADR-019 — Upload direto ao storage com confirmação de integridade

**Contexto:** PDFs de até 25 MB precisam ser armazenados sem derrubar a aplicação.
**Decisão:** URL pré-assinada (PUT direto ao storage) + etapa obrigatória de
confirmação que verifica tamanho e SHA-256 do objeto armazenado.
**Justificativa:** o corpo do arquivo nunca ocupa heap do processo Node, e a
confirmação dá proveniência ao blob (sem ela, um arquivo no bucket não é auditável).
**Consequências:** a integridade depende do hash calculado no cliente; um cliente
malicioso pode declarar hash falso, mas o objeto é descartado quando não confere.
Tamanho assinado (`ContentLength`) recusa corpo maior no próprio storage (HTTP 403).

### ADR-020 — Nota final calculada exclusivamente no servidor

**Contexto:** a nota decide aceite e rejeição de trabalho científico.
**Decisão:** o cliente envia notas **por critério**; o servidor calcula a média
ponderada, sugere a recomendação e persiste o `scoreBreakdown`.
**Justificativa:** uma nota final vinda do cliente é uma decisão de terceiro
travestida de dado; o detalhamento por critério torna a nota auditável.
**Consequências:** mudar a fórmula exige recalcular pareceres antigos — por isso o
`scoreBreakdown` guarda pesos e contribuições usados no momento do parecer.

### ADR-021 — Afinidade sugere, o comitê decide

**Contexto:** distribuir dezenas de submissões entre revisores de áreas próximas.
**Decisão:** ranquear por afinidade e **exibir sugestões**, sem atribuição automática.
**Justificativa:** o sistema não tem informação suficiente para decidir sozinho
(conflitos não declarados, disponibilidade real, qualidade do parecer). Automatizar
transferiria ao algoritmo uma responsabilidade que é humana — e que precisa ter dono.
**Consequências:** custo operacional de um clique por atribuição; em troca, cada
atribuição tem autoria e motivo registrados (`matchReason`).

### ADR-022 — Conflito incerto bloqueia; override só para o incerto

**Contexto:** detectar conflito é heurístico em parte dos casos.
**Decisão:** `BLOCK_ON_UNCERTAIN_CONFLICT = true`; override permitido **apenas**
quando nenhum conflito é CERTAIN, com registro do motivo.
**Justificativa:** a pergunta relevante é "alguém consegue demonstrar que não há
conflito?", não "é provável que não haja?". E fato (autoria, orientação, declaração)
não se sobrepõe com um clique.
**Consequências:** o painel do comitê precisa mostrar os bloqueados **com a razão** —
esconder o motivo tornaria impossível perceber um falso positivo (ex.: homônimo).

### ADR-023 — Revisão cega aplicada na emissão da URL do arquivo

**Contexto:** a versão identificada não pode chegar ao revisor cego.
**Decisão:** `getFileDownloadUrl` exige `{ role, isBlind }` e aplica
`canAccessSubmissionFile`; `redactForBlindReview` remove a autoria estruturalmente.
**Justificativa:** uma URL pré-assinada é acesso direto ao objeto — a regra precisa
estar onde a URL nasce, não onde a lista é montada.
**Consequências:** todo novo ponto de uso é obrigado pelo compilador a declarar o
papel e o sigilo. O custo é uma assinatura mais longa; o benefício é não depender de
disciplina de quem escreve o próximo consumidor.

### ADR-024 — Parecer aponta para a versão do arquivo avaliada

**Contexto:** o autor pode reenviar o PDF depois de já haver parecer.
**Decisão:** `Review.submissionVersion` + versionamento de `SubmissionFile`, com
`isCurrent` marcando a versão corrente.
**Justificativa:** sem isso, um parecer sobre a versão 1 poderia ser usado para
decidir sobre a versão 2 — auditoria quebrada e decisão injusta.
**Consequências:** reenvio nunca sobrescreve; o bucket guarda todas as versões, e o
download sempre indica qual delas está sendo baixada.

---

## 15. Lições aprendidas — defeitos reais encontrados nesta fase

Todos foram encontrados por testes (integração e E2E), não por inspeção.

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Conflito por mesma instituição **nunca** disparava para autor com conta | O código lia só `guestEmail`/`guestName`; autor cadastrado tem esses campos nulos | `toAuthorContext` dá precedência aos dados da conta |
| 2 | Painel do comitê sem **nenhum** elegível | `example.test` era tratado como domínio institucional, e nos testes todos os e-mails o compartilham | Recusa de domínios reservados (RFC 2606/6761) + domínio declarado substitui o do e-mail |
| 3 | Após anexar o PDF, o envio continuava bloqueado | Bloqueios são calculados no componente de servidor; as actions são chamadas direto (sem `form action`), então nada revalidava | `router.refresh()` após a confirmação |
| 4 | `reviewRubric` inválido derrubava o cálculo da nota | Rubrica vinda do banco não era validada | `parseRubric` devolve `{ rubric, usedDefault, errors }` e cai no padrão |
| 5 | Reconfirmar um upload colidia com o índice único | A confirmação não era idempotente | Idempotência pela chave do objeto |
| 6 | Build falhava ao coletar dados de página | `requireEnv` de `S3_*` no topo do módulo lançava durante o build | Construção **lazy** do cliente S3 |
| 7 | Build falhava com "You are using the default secret" | Better Auth valida o segredo no build sem `BETTER_AUTH_SECRET` | `ARG`/`ENV` de build no Dockerfile |
| 8 | `prisma migrate diff` com flags inexistentes | Prisma 7 renomeou `--to-schema-datamodel` → `--to-schema` e `-o/--output` | Comandos atualizados na migração escrita à mão |
| 9 | E2E não conseguia cadastrar dois usuários | O segundo cadastro reutilizava a sessão por cookie | Cadastro via `page.request.post` + `signOut` explícito |
| 10 | Teste de integração esbarrava no limite da trilha | `maxSubmissionsPerAuthor` do fixture era baixo | Fixture ajustado (o limite tem cobertura própria no domínio) |
| 11 | `ReferenceError` ao usar um helper | `prepareSubmission` foi declarada dentro do `describe`, fora do escopo dos `it` | Movida para o escopo do módulo |
| 12 | Painel de bloqueados "sumia" no teste | O clique no `<summary>` foi feito duas vezes (depuração) e fechou o painel | Asserção com um único clique e `test-id` estável |

Os itens **1, 2 e 3 são bugs de produto**, não de teste: o 1 e o 2 afetavam a
correção da avaliação (falso negativo e falso positivo de conflito) e o 3 bloqueava
o fluxo principal do autor. Nenhum deles apareceria em teste unitário de domínio —
foi a combinação "banco real + navegador real" que os expôs.

---

## 16. Dívidas técnicas e trabalho adiado

**Adiado conscientemente:**

1. **Antivírus nos arquivos** — `scanStatus` é `SKIPPED`, marcado assim
   deliberadamente: melhor um campo honesto do que afirmar "limpo" sem ter varrido.
   Entra junto do worker da FASE 6 (ClamAV + BullMQ).
2. **Notificação ao revisor** — a atribuição não envia e-mail. Depende da fila
   (FASE 6); o `dueAt` já existe e o painel já calcula `isOverdue`.
3. **Lembrete e expiração de prazo de parecer** — exige job agendado.
4. **Auditoria de acesso a arquivo** — hoje a URL assinada vale 300 s e não há
   registro de quem baixou o quê. Para processo científico com sigilo, um log de
   acesso é o próximo passo natural.
5. **Edição de coautores pela UI** — o autor correspondente é criado no rascunho; a
   lista completa (ordem, coautores, ORCID) tem domínio e testes, mas ainda não tem
   tela. Entra na FASE 7.
6. **Sigla × nome completo de instituição** — `institutionsMatch` resolve contenção e
   siglas extraídas, mas "UFRJ" × "Universidade Federal do Rio de Janeiro" não é
   resolvível por comparação de strings. Mitigado pelo domínio institucional
   declarado; a solução definitiva é uma tabela de instituições.
7. **Paginação** nas listas de submissões, revisões e comitê.
8. **Rate limit em memória** — segue valendo o alerta da FASE 2: precisa migrar para
   Redis antes de escalar horizontalmente.
9. **Afinidade conservadora** — Jaccard dilui listas curtas de especialidade. Uma
   alternativa (BM25 ou embeddings) fica para quando houver dados reais de uso.

**Pontos de atenção:**

- `NODE_ENV=development` no `.env` quebra `npx next build` direto. Use `npm run build`.
- Ao criar tabela nova com `tenantId`, rode `npm run db:rls` — senão ela fica sem
  policy e o `db:verify` acusa (foi o que aconteceu nesta fase).

---

## 17. Checklist de aceite da FASE 4

- [x] Trilha (Call for Papers) com rubrica, quórum e limiares configuráveis
- [x] Submissão em rascunho com protocolo público
- [x] Validação de conteúdo mínimo (título, resumo, 3–8 palavras-chave)
- [x] Upload direto ao storage por URL pré-assinada (arquivo não passa pela aplicação)
- [x] SHA-256 calculado no navegador e **verificado no servidor**
- [x] Objeto descartado quando a integridade falha
- [x] Confirmação idempotente (retry de rede não gera erro nem duplicata)
- [x] Tamanho assinado: corpo maior é recusado pelo storage
- [x] Versionamento de arquivo; o parecer registra a versão avaliada
- [x] Envio bloqueado enquanto faltar o artefato exigido pela trilha
- [x] Painel do comitê com elegíveis, bloqueados **com motivo** e sugestões
- [x] Afinidade com pesos explícitos, penalidade de carga e faixas
- [x] **Nenhuma atribuição automática**: o comitê confirma cada designação
- [x] Conflito de interesse em 6 tipos, com nível de certeza
- [x] Conflito incerto **bloqueia** (fail-closed)
- [x] Override apenas para conflito incerto, registrado no histórico
- [x] Conflito revalidado **dentro** da transação de atribuição
- [x] Falso negativo corrigido: autor com conta não some do cálculo de conflito
- [x] Falso positivo corrigido: domínio reservado de teste não é institucional
- [x] Revisão cega com remoção **estrutural** da autoria
- [x] Versão identificada **negada** ao revisor cego na emissão da URL
- [x] Versão cega continua acessível ao revisor
- [x] Nota ponderada calculada no servidor, com detalhamento persistido
- [x] Notas fora da escala são recusadas
- [x] Parecer apenas de quem está atribuído
- [x] Consenso com detecção de divergência
- [x] Decisão sem quórum exige justificativa
- [x] Estados terminais não voltam atrás
- [x] Painel do comitê exige permissão no servidor (participante é barrado antes da consulta)
- [x] Seed de demonstração com trilha e dois revisores de instituições diferentes
- [x] **383 testes** unitários e de integração passando
- [x] **26 testes E2E** passando contra o container de produção
- [x] ESLint 0 erros · `tsc` 0 erros · `next build` OK (21 rotas)
- [x] Contrato de RLS íntegro com as tabelas novas
- [x] Isolamento multi-tenant: 9/9 verificações (FASE 1 preservada)
- [x] Documentação com ADRs, diagramas e comandos

**Próximo passo:** FASE 5 — Gamificação: cartas colecionáveis com raridade, motor de
XP, missões e níveis de prestígio, integrados aos eventos, inscrições e submissões já
existentes.

Aguardando **"APROVADO: AVANÇAR"**.
