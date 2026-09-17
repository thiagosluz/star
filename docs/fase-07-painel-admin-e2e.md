# FASE 7 — Painel Administrativo do Tenant e E2E Completo

> **Status:** concluída · aguardando `APROVADO: AVANÇAR`
> **Pré-requisitos:** FASES 1 a 6 aprovadas e verificadas
> **Stack desta fase:** Next.js Server Actions + Zod, Vitest e Playwright contra o
> container de produção

---

## 1. Sumário executivo

Até aqui a plataforma **funcionava**, mas só era possível alimentá-la por script. Esta
fase fecha o ciclo: a instituição administra o próprio conteúdo pela interface, e a
suíte E2E passa a cobrir a **ligação entre os módulos** — que é onde os defeitos de
integração aparecem.

| Área | Entrega |
|---|---|
| Painel | `/administracao` com números da instituição, áreas de gestão e **trilha de auditoria** |
| Eventos | Criar, editar e publicar: dados, período, fuso, vagas, cor, janelas de inscrição e de chamada |
| Atividades | Programação com tipo, carga horária, sala, vagas e lista de espera |
| Salas | Capacidade por sala |
| Trilhas | Chamada de trabalhos com rubrica, quórum e limiares |
| Cartas | Catálogo com raridade, gatilho, paleta, arte, tiragem — **renderizado com a paleta real** |
| Missões | Metas, recompensa, periodicidade e visibilidade, com contagem de conclusões e resgates |
| Certificados | Filtros, falhas do worker com motivo, reprocessamento e revogação |
| Credenciamento | **Check-in por crachá** (leitor de QR Code) além da busca por nome |
| Auditoria | `AuditLog` (modelado na FASE 1, sem uso até agora) gravado em toda mutação |
| Validações ligadas | `checkScheduleConflict` e `evaluateRoomFit` deixaram de ser código morto |

Números desta fase:

```text
Serviços novos                   3   (audit, catalog-service, gamification-admin-service)
Server Actions novas            11   (evento, sala, atividade, trilha, carta, missão, certificado, crachá)
Páginas novas                    6   (/administracao, /eventos, /eventos/[id], /cartas, /missoes, /certificados)
Componentes novos                2   (AdminForm + campos, formulário de crachá)
Validações ligadas               2   (conflito de agenda e lotação × sala — escritas na FASE 3)
Testes novos                    24   (20 de integração + 2 E2E) — e 2 E2E de regressão de RBAC
Migração                         0   (nenhuma tabela nova; a trilha já existia)
```

---

## 2. O problema desta fase

Um painel administrativo parece trabalho de interface. Não é. Três decisões
definem se ele ajuda ou atrapalha:

1. **Onde a validação mora.** Validar no formulário é conveniência; validar no
   SERVIDOR é garantia. Entre abrir o formulário e salvar, outra pessoa pode ter
   criado a atividade conflitante — e é exatamente nessa janela que o conflito
   nasce.
2. **O que fica registrado.** Um painel que altera sem deixar rastro transforma
   qualquer erro em discussão sem prova. A trilha de auditoria foi modelada na FASE
   1 e ficou sem uso até agora; esta fase a liga.
3. **O que o organizador VÊ.** Rubrica inválida, carta ilegível e certificado preso
   na fila precisam aparecer na tela de quem pode corrigir — não no relato do
   participante.

---

## 3. As validações da FASE 3 finalmente ligadas

`evaluateRoomFit` e `checkScheduleConflict` foram escritos e testados na FASE 3, mas
nunca chamados: não havia UI de criação de atividade para exercitá-los. Agora:

```text
createActivity/updateActivity
   ├─ a atividade está dentro do período do evento?
   ├─ a sala comporta a lotação prevista?      (evaluateRoomFit)
   └─ a sala já está ocupada nesse horário?     (checkScheduleConflict)
```

Três detalhes que os testes fixam:

- **Atividades adjacentes são permitidas.** Terminar às 11h e a próxima começar às
  11h não é conflito — o domínio trata intervalos como `[início, fim)`.
- **A edição não conflita consigo mesma:** o candidato carrega o próprio `id` e o
  domínio o exclui da comparação.
- **A atividade fora da janela do evento é recusada.** Um minicurso marcado para
  depois do encerramento apareceria na agenda pública em um dia em que não há
  evento — e o participante não teria como saber qual informação está certa.

---

## 4. Trilha de auditoria

```text
CREATE/UPDATE + entityType + entityId + { campo: { de, para } } + autor + horário
```

Gravada **na mesma transação** da alteração: se a alteração falhar, a trilha não
registra um fato que não aconteceu. Três decisões de projeto:

1. **Escrita pela aplicação, não por gatilho do banco.** O gatilho sabe o que mudou;
   ele não sabe QUEM pediu, de qual IP, nem com que intenção. Em plataforma
   multi-tenant, "quem" é a informação que decide se a alteração foi legítima.
2. **Segredos nunca entram.** Uma lista de campos proibidos (`password`, `token`,
   `signature`, `badgeToken`…) é mascarada mesmo que o chamador a envie. Trilha que
   copia dado sensível para outra tabela é problema de privacidade, não auditoria.
3. **Valores resumidos.** Textos longos são truncados: a trilha precisa ser legível,
   não virar um segundo banco de dados.

Aparece na **tela inicial** do painel, e não atrás de um menu: quem administra precisa
ver, sem procurar, que tudo fica registrado.

---

## 5. Cartas e missões: o organizador vê o que cria

O catálogo de cartas renderiza cada carta com a **paleta real**, usando o mesmo
componente do álbum do participante. Uma tabela de códigos hexadecimais não diz se a
carta ficou legível — e quem descobriria isso seria o participante, sem poder
reclamar.

A paleta e a arte passam por `resolvePalette`/`resolveArt` **na gravação**: cor fora
do formato (hex ou `oklch()`) cai para o padrão da raridade, e URL com protocolo
perigoso é descartada. O teste de integração confirma que a cor inválida **não chega
ao banco** — o organizador vê o problema ao salvar, não o participante ao abrir o
álbum.

As missões mostram **conclusões × resgates**. A diferença entre os dois números é
operacional: muitas conclusões sem resgate indicam que a recompensa não está sendo
percebida — e a correção é de comunicação, não de regra.

---

## 6. Credenciamento por crachá (leitor de QR Code)

No balcão, o equipamento real é um **leitor USB**, que se comporta como teclado: lê o
QR Code e digita o conteúdo no campo focado, terminando com Enter. O formulário de
crachá (`autoFocus` + Enter) atende esse fluxo sem exigir câmera, permissão de vídeo
e uma API de decodificação que varia por navegador — e funciona igual em tablet sem
câmera traseira, ou digitando o código quando o leitor falha.

O campo vem **antes** da busca por nome: no balcão, o fluxo comum é o QR; a busca é o
caminho de exceção (crachá perdido, leitor quebrado), não o contrário.

O token é único e a busca acontece sob RLS: crachá de outra instituição não é
encontrado. A entrada é registrada com `UPDATE` condicional (`WHERE checkedInAt IS
NULL`), então dois leitores simultâneos produzem UMA presença.

---

## 7. Certificados na visão da equipe

A tela existe por causa da coluna de **falha**: um certificado preso em "na fila" sem
explicação é descoberto por reclamação do participante. Aqui o operador vê
`failureReason`, o número de tentativas, e reprocessa com um clique —
`retryCertificateGeneration` tenta a fila e, se o Redis estiver fora, gera na hora
(herdando a decisão de resiliência da FASE 6).

Revogar exige motivo com no mínimo 8 caracteres, e o documento passa a ser inválido
na página pública **e** no download.

---

## 8. Evidência de verificação

### 8.1 Suíte completa (Vitest)

```text
tests/integration/admin-panel.test.ts              20 testes  ✓   (FASE 7)
tests/unit/certificate-rules.test.ts               40 testes  ✓   (FASE 6)
tests/unit/certificate-renderer.test.ts            27 testes  ✓   (FASE 6)
tests/integration/certification.test.ts            24 testes  ✓   (FASE 6)
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
                                         Total: 617 testes
```

Destaques do que é **provado** nesta fase:

- duas atividades na mesma sala e no mesmo horário são **recusadas**, e a mensagem
  cita a atividade que já ocupa a sala;
- atividades **adjacentes** são aceitas (fim de uma = início da outra);
- atividade **maior que a sala** é recusada com o número de lugares;
- atividade **fora do período do evento** é recusada;
- rubrica com peso zero é **recusada** (e não substituída em silêncio pela padrão);
- paleta inválida **não chega ao banco**; URL `javascript:` não é gravada;
- meta de missão com quantidade zero é recusada com o motivo;
- **cada mutação** aparece na trilha com autor e campos alterados, em ordem
  decrescente de horário;
- credenciamento por crachá funciona e **não credita duas vezes**; token desconhecido
  é recusado;
- o painel de uma instituição **não vê** eventos nem trilha de outra.

### 8.2 E2E — contra o container de PRODUÇÃO

```text
auth-tenancy.spec.ts          (12 testes, FASES 2 preservadas)   ✓
registration-journey.spec.ts  ( 9 testes, FASE 3 preservada)     ✓
peer-review.spec.ts           ( 5 testes, FASE 4 preservada)     ✓
gamification.spec.ts          ( 2 testes, FASE 5 preservada)     ✓
certification.spec.ts         ( 2 testes, FASE 6 preservada)     ✓
platform-journey.spec.ts      ( 2 testes, FASE 7)                ✓

✓ jornada completa › a administração monta o evento e o participante percorre a jornada
✓ jornada completa › PARTICIPANTE não acessa o painel administrativo

32 passed
```

A jornada da FASE 7 percorre a **ligação entre os módulos**: a administração cria
evento, sala, atividade e trilha pela interface → o servidor **recusa** a atividade
conflitante na mesma sala → a página pública mostra o evento e a atividade **sem
login** → a equipe credencia pelo **crachá** e o participante recebe 50 XP → a trilha
de auditoria registra quem criou o quê. E um participante que digita as URLs do
painel é devolvido ao dashboard em **todas** as rotas administrativas.

### 8.3 Qualidade

```text
ESLint       0 erros, 0 warnings
tsc          0 erros
next build   ✓ compilado (rotas novas: /administracao e suas 5 sub-rotas)
```

### 8.4 Garantias das fases anteriores

```text
CONTRATO DE ISOLAMENTO MULTI-TENANT          Contrato íntegro.
ISOLAMENTO MULTI-TENANT (9 ataques)          9/9 verificações passaram.
```

Nenhuma tabela nova nesta fase; a trilha de auditoria já estava no contrato de RLS e
passou a ser **escrita** (e lida) sob contexto de tenant — a listagem de outra
instituição retorna vazio, como prova o teste de integração.

---

## 9. Comandos operacionais

### 9.1 Ambiente completo

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:setup          # migrate + rls + verify + isolation + seed
npm run dev               # http://localhost:3000
```

### 9.2 Testes

```bash
npm test                  # Vitest: 617 testes (unit + integração)
npm run test:e2e          # Playwright: 32 testes contra o container
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
npm run build             # build de produção (força NODE_ENV=production)
npm run db:verify         # contrato de RLS
npm run db:verify:isolation  # 9 ataques de isolamento entre tenants
```

### 9.3 Stack completa (web + worker)

```bash
docker compose --profile app up -d --build
docker compose --profile app ps
docker logs eventflow-worker --tail 30
```

### 9.4 Percurso de demonstração

```text
1. http://localhost:3000/t/ufba-demo/administracao        painel + trilha de auditoria
2. .../administracao/eventos                              criar/gerenciar evento
3. .../administracao/eventos/<id>                         salas, programação e trilhas
4. .../administracao/cartas                               catálogo renderizado + concessão manual
5. .../administracao/missoes                              metas com conclusões × resgates
6. .../administracao/certificados                         falhas, reprocessar, revogar
7. .../credenciamento                                     credenciar pelo crachá (leitor de QR)
```

---

## 10. ADRs — decisões desta fase

### ADR-039 — Validação de agenda no servidor, não no formulário

**Contexto:** a programação tem conflito de sala e de período, e o formulário é
aberto antes do salvamento.
**Decisão:** `checkScheduleConflict` e `evaluateRoomFit` rodam dentro da transação de
gravação, considerando as atividades já persistidas.
**Justificativa:** validar apenas na interface deixa a janela entre abrir e salvar —
que é exatamente onde o conflito nasce (duas pessoas programando ao mesmo tempo).
**Consequências:** a mensagem de erro precisa ser específica ("a sala já está ocupada
por X nesse horário"), porque ela é a única coisa que o organizador vê.

### ADR-040 — Trilha de auditoria escrita pela aplicação, na mesma transação

**Contexto:** `AuditLog` existia desde a FASE 1 e nada escrevia nele.
**Decisão:** toda mutação administrativa grava a entrada DENTRO da transação, com
autor, campos alterados e resumo dos valores; segredos são mascarados por lista de
proibição.
**Justificativa:** gatilho de banco não sabe quem pediu, de qual IP nem com que
intenção — e "quem" é o que decide se a alteração foi legítima. Gravar fora da
transação registraria fatos que não aconteceram.
**Consequências:** campos novos precisam ser declarados no `diffFields` do serviço
para aparecerem na trilha (o teste verifica os principais). A trilha é lida na tela
inicial do painel.

### ADR-041 — Rubrica inválida é recusada, não substituída pela padrão

**Contexto:** `parseRubric` devolve a rubrica padrão em dois casos muito diferentes:
nada foi informado, ou algo inválido foi informado.
**Decisão:** erro de validação **recusa** o salvamento; a rubrica padrão só é aplicada
quando nenhum critério foi enviado.
**Justificativa:** substituir em silêncio faria o organizador acreditar que a rubrica
dele foi salva quando o sistema gravou OUTRA — e ele descobriria isso ao ver os
pareceres calculados por critérios que não definiu.
**Consequências:** o formulário precisa exibir os motivos da recusa (o `AdminForm`
mostra a lista de detalhes).

### ADR-042 — Credenciamento por token de crachá, e não por câmera no navegador

**Contexto:** o QR Code do crachá precisa ser lido no balcão.
**Decisão:** campo de token com `autoFocus` (leitor USB digita e envia com Enter),
além do token digitado à mão.
**Justificativa:** o equipamento real é um leitor que se comporta como teclado; ler
câmera exigiria permissão de vídeo e uma API de decodificação que varia por
navegador — e falharia justamente no tablet sem câmera traseira do credenciamento.
**Consequências:** o QR precisa conter o token puro (não uma URL). Se um dia o crachá
passar a conter URL, o formulário precisará extrair o token.

### ADR-043 — Um componente de formulário para todo o painel

**Contexto:** evento, sala, atividade, trilha, carta e missão têm o mesmo ciclo
(enviar, "salvando", sucesso/erro, revalidar).
**Decisão:** um `AdminForm` genérico que recebe os campos como filhos renderizados no
servidor.
**Justificativa:** seis componentes quase idênticos divergiriam no primeiro ajuste — e
a divergência apareceria como um formulário que não mostra o erro.
**Consequências:** comportamentos específicos (ex.: rubrica em listas paralelas) ficam
nas páginas, não no componente.

---

## 11. Lições aprendidas — defeitos reais encontrados nesta fase

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Rota `/administracao` respondia **404** no container, com o processo "saudável" | O `next build` FALHOU (export não-async em arquivo `'use server'`) e o `docker compose up --build` **preservou o container anterior**; o E2E rodou contra a imagem antiga | Helper removido + verificação explícita de que o build passou E a imagem foi recriada antes de rodar E2E |
| 2 | Rubrica inválida digitada pelo organizador era substituída pela padrão em silêncio | Condição invertida: `errors.length > 0 && !usedDefault` nunca recusava (o caso de erro vem com `usedDefault: true`) | Recusa sempre que há erro; padrão só quando nada foi informado (ADR-041) |
| 3 | `checkScheduleConflict`/`evaluateRoomFit` chamados com assinatura errada | Supus parâmetros nomeados; o domínio usa posicional (sala) e `{candidate, existing}` (agenda) | Chamadas corrigidas conforme o domínio da FASE 3 (que já estava testado) |
| 4 | Asserção da agenda pública mirava um `link` | O bloco `SCHEDULE` pode renderizar o título sem link | Asserção por texto: o que importa é o conteúdo chegar à vitrine |
| 5 | Painel novo não tinha trilha de auditoria para mostrar | Instituição recém-criada, nenhuma mutação ainda | O teste verifica a SEÇÃO no início e os REGISTROS ao final da jornada |
| 6 | `docker compose ... | Select-Object -Last 3` escondeu o erro de build | A saída do build foi truncada pela filtragem | Conferir o resultado da imagem (`docker images`) e o comportamento real da rota |

O item **1 é o mais importante desta fase**, e não é um defeito de código: é um
defeito de **verificação**. Um build que falha silenciosamente em um pipeline que
preserva o container antigo produz a pior classe de falso positivo — o teste passa a
medir uma versão que não é a que foi escrita. Foi por isso que a checagem passou a
incluir "a imagem foi recriada?" e "a rota nova responde?" além do resultado do
Playwright.

---

## 12. Dívidas técnicas e trabalho adiado

**Adiado conscientemente:**

1. **Editor de página (landing page)** — os blocos e o tema têm domínio pronto desde
   a FASE 3 (`PageBlock`, `themeSchema`, `resolveTheme`), mas a UI de composição
   (arrastar blocos, pré-visualizar) não entrou. Hoje a página usa a composição
   padrão; o tema pode ser ajustado pelo campo de cor.
2. **Patrocinadores pela UI** — `SponsorTier`/`Sponsor` existem no modelo e a landing
   page já renderiza o bloco; falta a tela de cadastro.
3. **Edição de coautores** — a lista de autoria é criada no envio; editar ordem e
   coautores segue pendente (herdado da FASE 4).
4. **Upload de imagem de capa** — o campo existe no modelo; a infraestrutura de
   storage está pronta (FASE 4), falta a tela.
5. **Convites de membros pela UI** — o papel e a permissão existem
   (`tenant:member:invite`, que guarda o painel), mas o fluxo de convite não está
   implementado.
6. **Paginação** nas listagens administrativas — hoje há limite de 100–200 registros
   por consulta, suficiente para o porte atual.
7. **Métricas e gráficos** — o resumo mostra contadores; séries temporais
   (inscrições por dia, taxa de aceite) exigiriam consultas agregadas dedicadas.
8. **Auditoria de leitura** — a trilha registra MUTAÇÕES. Quem visualizou dados
   pessoais não é registrado (o contador de validação pública de certificado é a
   única exceção).

**Pontos de atenção:**

- **Nunca** troque a ordem de `startsAt`/`endsAt`: o domínio trata intervalos como
  `[início, fim)`, e a adjacência é permitida de propósito.
- O `AdminForm` é o único lugar que decide como erros aparecem: um formulário novo
  deve usá-lo, sob pena de não exibir os motivos da recusa.
- `npm run build` é obrigatório antes de subir containers: o `next build` valida
  regras que `tsc` e ESLint não validam (Server Actions precisam ser `async`, por
  exemplo).

---

## 13. Checklist de aceite da FASE 7

- [x] Painel administrativo com números da instituição e áreas de gestão
- [x] Trilha de auditoria visível na tela inicial, com autor, horário e campos
- [x] `AuditLog` finalmente em uso, gravado na mesma transação da mutação
- [x] Segredos mascarados na trilha; valores resumidos
- [x] Evento: criar, editar, publicar, com período, fuso, vagas, cor e janelas
- [x] Salas com capacidade
- [x] Atividades com tipo, carga, sala, vagas, lista de espera e destaque
- [x] **Conflito de sala recusado no servidor**, citando a atividade ocupante
- [x] Atividades adjacentes permitidas (fim de uma = início da outra)
- [x] Atividade maior que a sala recusada
- [x] Atividade fora do período do evento recusada
- [x] Trilhas com rubrica, quórum e limiares; rubrica inválida **recusada**
- [x] Cartas com raridade, gatilho, paleta, arte, tiragem e nível — renderizadas
- [x] Paleta/arte validadas na GRAVAÇÃO (cor inválida não chega ao banco)
- [x] Concessão manual de carta respeitando nível, janela e tiragem
- [x] Missões com meta, recompensa, periodicidade e visibilidade
- [x] Contagem de conclusões × resgates por missão
- [x] Certificados: filtros, falhas com motivo, reprocessar e revogar
- [x] Credenciamento por **crachá** (leitor de QR), idempotente
- [x] Painel inacessível a participante em **todas** as rotas administrativas
- [x] Página pública mostra o conteúdo criado no painel, sem login
- [x] **617 testes** unitários e de integração passando
- [x] **32 testes E2E** passando contra o container de produção
- [x] ESLint 0 erros · `tsc` 0 erros · `next build` OK
- [x] Contrato de RLS íntegro · isolamento 9/9 (FASES 1–6 preservadas)
- [x] Documentação com ADRs, lições aprendidas e comandos

---

## 14. Estado final do projeto (FASES 1 a 7)

```text
FASE 1  Infraestrutura e modelagem            RLS, roles, 34+ modelos, contrato de isolamento
FASE 2  Autenticação, RBAC e multi-tenancy    10 papéis, 50 permissões, troca de contexto O(1)
FASE 3  Eventos, inscrições e landing pages   vagas sem superlotação, lista de espera FIFO, página modular
FASE 4  Submissões e avaliação por pares      upload direto, rubrica ponderada, conflito de interesse, revisão cega
FASE 5  Gamificação                           XP idempotente, cartas com raridade, missões, prestígio
FASE 6  Certificação                          PDF/SVG assinado, QR Code, validação pública, fila
FASE 7  Painel administrativo e E2E completo  gestão pela interface, auditoria, jornada E2E de ponta a ponta

617 testes automatizados · 32 testes E2E · 0 erros de lint e de tipos
```

O ciclo está fechado: a instituição configura pela interface, o participante se
inscreve e comparece, o comitê avalia, a gamificação recompensa e a certificação
emite um documento que qualquer terceiro pode conferir.

Aguardando **"APROVADO: AVANÇAR"**.
