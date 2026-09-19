# FASE 3 — Eventos, Atividades, Inscrições e Landing Pages Públicas

> **Status:** ✅ Concluída e verificada contra ambiente real (container de produção)
> **Data:** Setembro/2026
> **Pré-requisito:** FASES 1 e 2 aprovadas (infraestrutura + RLS + auth/RBAC)

---

## 1. Sumário executivo

Esta fase entrega o coração do produto: a **jornada pública do participante**,
da descoberta do evento até a inscrição confirmada — com controle de lotação que
**não permite superlotações**, mesmo sob concorrência real.

| Entregável | Arquivo | Estado |
|---|---|---|
| Domínio: eventos e atividades | `src/domain/events/event-rules.ts` | ✅ 46 testes |
| Domínio: lotação e lista de espera | `src/domain/events/registration-rules.ts` | ✅ 29 testes |
| Domínio: tema e blocos | `src/domain/events/landing-page.ts` | ✅ 31 testes |
| Repositório público (RLS) | `src/lib/events/event-repository.ts` | ✅ |
| Serviço de inscrição | `src/lib/events/registration-service.ts` | ✅ |
| Actions de inscrição | `src/app/actions/registration-actions.ts` | ✅ |
| Landing page modular | `src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/page.tsx` | ✅ |
| Listagem de eventos | `src/app/t/[tenantSlug]/(public)/eventos/page.tsx` | ✅ |
| Detalhe + inscrição | `.../atividades/[activitySlug]/page.tsx` | ✅ |
| Minhas inscrições | `src/app/t/[tenantSlug]/(app)/minhas-inscricoes/page.tsx` | ✅ |
| Testes unitários | `tests/unit/event-rules.test.ts` etc. | ✅ **106 novos** |
| Teste de concorrência | `tests/integration/registration-concurrency.test.ts` | ✅ **8 testes** |
| Testes E2E | `tests/e2e/registration-journey.spec.ts` | ✅ **9 testes** |

**Resultado central:** **20 tentativas simultâneas de inscrição em uma atividade
com 5 vagas resultam em exatamente 5 confirmadas** — nunca 6. O teste roda contra
PostgreSQL real, com transações concorrentes de verdade.

---

## 2. O problema mais difícil desta fase: superlotações

### 2.1 O padrão que falha

O caminho ingênuo para inscrever alguém é:

```ts
// ❌ NÃO FASCINA — mas está errado
const inscritos = await prisma.registration.count({ where: { activityId } });
if (inscritos < activity.capacity) {
  await prisma.registration.create({ ... });
}
```

Duas requisições simultâneas leem `49` (de 50), ambas concluem que cabe, ambas
inserem — e a atividade termina com **51 inscritos**. É o bug clássico de
*check-then-act*, e qualquer teste de carga com concorrência encontra.

### 2.2 A solução: reserva atômica via UPDATE condicional

Adicionamos um contador denormalizado (`confirmedCount`) e reservamos a vaga com
**uma única instrução**:

```sql
UPDATE activities
   SET "confirmedCount" = "confirmedCount" + 1
 WHERE id = $1
   AND ("capacity" IS NULL OR "confirmedCount" < "capacity")
```

O PostgreSQL serializa UPDATEs concorrentes **na mesma linha**. A segunda
transação bloqueia, reavalia o predicado já com o contador atualizado e afeta
**0 linhas**. Zero linhas significa "não havia vaga" — de forma determinística,
sem `SELECT FOR UPDATE`, sem lock explícito e sem retry loop para o caso comum.

```
        Tempo ──────────────────────────────────────────────────────►

  T1  ──[UPDATE: 49→50, 1 linha]─────────────────────────────────────
                │
  T2  ──────────┼──[bloqueia na linha]──[reavalia: 50 < 50 = falso]──► 0 linhas
                │
         (T1 commitou)                                    → REJEITADO
```

### 2.3 Ordem das operações importa

A versão inicial criava a inscrição e **depois** tentava reservar a vaga,
apagando a inscrição quando não havia vaga. Isso produzia um efeito colateral
sutil: a linha apagada deixava rastro no índice único parcial, e o INSERT
seguinte (na lista de espera) **colidia consigo mesmo**.

A correção foi **reservar primeiro, inserir depois**:

```
  ┌─ 1. UPDATE condicional no contador
  │      ├─ 1 linha  → INSERT da inscrição CONFIRMED
  │      └─ 0 linhas → (não há vaga)
  │                      ├─ lista de espera desabilitada → REJEITA
  │                      └─ habilitada → INSERT da inscrição WAITLISTED
```

No caminho de espera, a **única** escrita é o INSERT da própria lista de espera.
Sem ida e volta, sem colisão artificial.

### 2.4 A prova

`tests/integration/registration-concurrency.test.ts` dispara 20 inscrições
simultâneas (`Promise.all`) em uma atividade com 5 vagas:

```text
✓ 20 tentativas simultâneas em 5 vagas resultam em EXATAMENTE 5 confirmadas
✓ excedente vai para a lista de espera, com posições FIFO contíguas
✓ capacidade ILIMITADA (null) não rejeita ninguém
✓ capacidade ZERO rejeita todas as tentativas
✓ o mesmo usuário tentando 10 vezes simultâneas gera UMA única inscrição
✓ cancelar libera a vaga e promove o primeiro da fila
✓ cancelar não infla a lotação disponível (transição inválida é recusada)
✓ usuário não pode cancelar a inscrição de outra pessoa
```

O teste também verifica que o **contador denormalizado bate com a contagem real
de linhas** — um contador que divergisse da realidade seria pior que não existir.

---

## 3. Semântica de capacidade: `null` ≠ `0`

Esta distinção é pequena na aparência e crítica na prática:

| Valor | Significado |
|---|---|
| `null` | **ILIMITADO** — aceita qualquer número |
| `0` | **ESGOTADO** — não aceita ninguém |
| `n > 0` | `n` vagas no total |

Tratar `0` como "ilimitado" liberaria inscrições em uma atividade configurada
como lotada. Há teste dedicado, e o predicado SQL vive em **um único lugar**
(`SEAT_AVAILABLE_PREDICATE`), com teste que garante que a regra em TypeScript e a
expressão SQL continuam expressando a mesma coisa.

---

## 4. Lista de espera: o segundo problema de concorrência

Com a reserva de vaga resolvida, restava um TOCTOU na **posição** da fila:

```ts
const max = await tx.registration.aggregate({ _max: { waitlistPosition: true } });
const proxima = (max._max.waitlistPosition ?? 0) + 1;   // ← duas transações leem o mesmo
```

Duas requisições simultâneas calculam `1` e ambas gravam — a fila fica com
posições duplicadas e a ordem FIFO (que decide quem é promovido quando uma vaga
abre) vira arbitrária.

### 4.1 Garantia no banco

```sql
CREATE UNIQUE INDEX "registrations_waitlist_position_key"
  ON "registrations" ("activityId", "waitlistPosition")
  WHERE status = 'WAITLISTED' AND "waitlistPosition" IS NOT NULL;
```

O filtro `IS NOT NULL` é essencial: inscrições `CONFIRMED` têm posição nula, e no
PostgreSQL múltiplos `NULL`s **não conflitam** em índice único — exatamente o
comportamento desejado.

### 4.2 Retry com SAVEPOINT e backoff

A camada de aplicação captura a violação, recalcula a posição e tenta de novo.
Dois detalhes que só aparecem na prática:

1. **SAVEPOINT é obrigatório.** No PostgreSQL, um erro dentro de uma transação a
   ABORTA: todas as instruções seguintes falham com *"current transaction is
   aborted"*. Sem `SAVEPOINT` + `ROLLBACK TO SAVEPOINT`, a segunda tentativa
   falharia sempre.

2. **Backoff com jitter é necessário.** Sem ele, os N escritores recalculam no
   mesmo instante e voltam a colidir em "manada". Com backoff exponencial
   (2ms→250ms) mais aleatoriedade, a fila converge rapidamente.

---

## 5. Índice único parcial: por que o global não servia

O índice `(activityId, userId)` sem filtro impedia um participante de se
inscrever novamente **depois de cancelar** — porque a linha do cancelamento
permanece (CANCELED é estado terminal, para preservar histórico e auditoria de
promoções).

A solução é a unicidade valer apenas entre inscrições **vivas**:

```sql
CREATE UNIQUE INDEX "registrations_live_activity_user_key"
  ON "registrations" ("activityId", "userId")
  WHERE status IN ('PENDING', 'CONFIRMED', 'WAITLISTED', 'ATTENDED');
```

Isso é a garantia **definitiva** contra inscrição duplicada: mesmo que a checagem
em JavaScript perca a corrida, o banco rejeita. O teste "mesmo usuário tentando
10 vezes" comprova.

---

## 6. Landing page modular e personalizável

### 6.1 Tema é DADO, nunca CÓDIGO

Cada evento tem cores, tipografia, raio, densidade, estilo de hero e animação. O
tema é um objeto JSON validado por Zod, e a renderização o traduz em **CSS custom
properties** sob o prefixo `--ef-`.

O prefixo não é cosmético: isola as variáveis do evento das variáveis do design
system da plataforma, impedindo que um evento sobrescreva estilos de outra parte
da aplicação.

### 6.2 Segurança do tema — dois vetores reais

**Vetor 1 — injeção em custom property.** Cores são validadas contra uma
allowlist de formato (hexadecimal ou `oklch()`). Valores como
`red; background: url(//evil)` ou `#fff} body{display:none}` são **rejeitados** —
sem a allowlist, o valor escaparia do contexto e injetaria regras CSS.

```ts
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
```

**Vetor 2 — XSS via URL.** Descoberto escrevendo os testes:
`z.string().url()` **aceita `javascript:alert(1)`**, `data:text/html,...` e
`vbscript:`. Como essas URLs viram `src` de imagem na página pública, aceitá-las
seria XSS armazenado atingindo todos os visitantes. A validação agora exige
protocolo `http:` ou `https:` explicitamente.

**Vetor 3 — HTML do organizador.** O bloco `CUSTOM_HTML` existe no enum, mas é
renderizado como **texto pré-formatado**, nunca como HTML. Um atacante com acesso
de organização comprometeria todos os visitantes se interpretássemos o conteúdo.

### 6.3 Um tema inválido nunca quebra a página

`resolveTheme()` devolve o padrão em vez de lançar: uma página pública com a
aparência da plataforma é melhor que um erro 500 na vitrine do cliente.

### 6.4 Página sem configuração continua decente

Se o organizador nunca montou a página, caímos em uma composição padrão
(hero + sobre + programação + patrocinadores). Isso atende "modular e altamente
personalizável" sem deixar quem nunca configurou nada com uma página vazia.

---

## 7. Separação entre layout público e autenticado

### 7.1 O problema

A landing page de um evento é uma **vitrine**: quem chega vem de campanha, rede
social ou link compartilhado. Exigir login destruiria a conversão.

Originalmente todas as rotas de `/t/[tenantSlug]` ficavam sob o layout
autenticado, então `/t/ufba/eventos` **redirecionava para o login**. Descoberto
ao rodar o E2E.

### 7.2 A solução: route groups com a mesma URL

```
src/app/t/[tenantSlug]/
├── (public)/
│   ├── layout.tsx              valida tenant, NÃO exige login
│   └── eventos/...             landing page, listagem, detalhe de atividade
│
├── (app)/
│   ├── layout.tsx              exige auth + vínculo ATIVO + carrega Principal
│   ├── dashboard/...
│   └── minhas-inscricoes/...
│
└── page.tsx                    redireciona para o painel
```

Os parênteses **não aparecem na URL**: `/t/ufba/eventos` continua igual. O layout
público ainda valida que a instituição existe e está ativa — isso não é
autorização de usuário, é validade de conteúdo — e responde 404 quando não é.

---

## 8. A jornada de inscrição

```
  Visitante anônimo
        │
        ▼
  Landing page do evento  ──►  Detalhe da atividade
        │                            │
        │                            ├─ Anônimo? → "Entrar e continuar"
        │                            │     (preserva o destino no redirectTo)
        │                            │
        │                            ├─ Sem vínculo ativo? → aviso
        │                            │
        │                            ├─ Sem permissão RBAC? → aviso
        │                            │
        │                            ├─ Lotada sem espera? → "Atividade lotada"
        │                            │
        │                            └─ Pode inscrever? → formulário
        │                                     │
        │                                     ├─ Consentimento LGPD (2 camadas)
        │                                     ▼
        │                            ┌─────────────────────┐
        │                            │ CONFIRMED           │
        │                            │   ou WAITLISTED     │
        │                            └─────────────────────┘
        ▼
  Minhas inscrições  ──►  Cancelar  ──►  promove o próximo da fila
```

### 8.1 Consentimento LGPD em duas camadas

1. **Cliente:** o checkbox tem `required`, então o navegador bloqueia o envio e
   exibe *"Preencha este campo"*. Feedback imediato, sem ida ao servidor.
2. **Servidor:** a Server Action valida de novo e devolve `CONSENT_REQUIRED`.

O E2E verifica **as duas**: primeiro que o envio é bloqueado (e nada é
persistido), depois — contornando a validação nativa com `novalidate` — que o
servidor recusa igualmente. A segunda camada é a que realmente protege.

### 8.2 Autorização verificada no servidor

Cada action chama `guard(slug, permissão)`, que carrega o `Principal` sob RLS e
aplica `can()`. Esconder um botão na UI é conveniência; a autorização real está
no servidor, perto do dado.

---

## 9. Tipos de evento e regras de agenda

### 9.1 Armazenamento em UTC, apresentação no fuso do evento

`startsAt`/`endsAt` são `TIMESTAMPTZ` (UTC no disco). O campo `timezone` (IANA)
serve à **apresentação**. Comparar `startsAt < endsAt` é sempre correto, mesmo
atravessando horário de verão — comparar strings de data local seria o bug
clássico. Há teste com `Europe/Lisbon` em verão e inverno comprovando a conversão
por fuso IANA.

### 9.2 Janela de inscrição: a ordem das checagens importa

`evaluateRegistrationWindow` decide se a inscrição está aberta. Casos cobertos:

- cancelamento tem **precedência** sobre qualquer outra razão;
- atividade cancelada bloqueia mesmo com o evento aberto;
- **inscrição em atividade continua válida durante o evento**, desde que a
  atividade não tenha começado — é normal se inscrever na oficina da tarde
  durante a manhã do primeiro dia;
- `allowAfterStart` é um bypass **administrativo** deliberado para o
  credenciamento presencial (FASE 7), que inscreve alguém no balcão depois do
  início.

### 9.3 Conflito de sala

`checkScheduleConflict` detecta duas atividades na mesma sala e horário. Regras:

- **sem sala definida não há conflito** (não há espaço a disputar);
- intervalos que apenas se **tocam** não conflitam — atividades em sequência na
  mesma sala são o caso normal;
- editar uma atividade não a conflita consigo mesma.

Conflito de **participante** não é verificado: ter duas atividades no mesmo
horário é escolha do participante, não erro de cadastro.

---

## 10. Evidência de verificação

### 10.1 Suíte completa

```text
tests/unit/event-rules.test.ts                  46 testes  ✓
tests/unit/registration-rules.test.ts           29 testes  ✓
tests/unit/landing-page.test.ts                 31 testes  ✓
tests/unit/rbac-authorization.test.ts           41 testes  ✓
tests/unit/tenant-resolution.test.ts            27 testes  ✓
tests/integration/registration-concurrency.test.ts  8 testes  ✓
tests/integration/tenant-isolation.test.ts       8 testes  ✓
                                                    ─────────
                                           Total: 190 testes
```

### 10.2 E2E — contra o container de PRODUÇÃO

```text
auth-tenancy.spec.ts (12 testes, FASE 2 preservada)              ✓
registration-journey.spec.ts (9 testes)                          ✓

✓ landing page pública › visitante anônimo vê a página e navega até a atividade
✓ landing page pública › evento inexistente responde 404
✓ landing page pública › evento em rascunho não é visível publicamente
✓ jornada › cadastro a partir da atividade retorna à atividade, e a inscrição é confirmada
✓ jornada › a vaga é decrementada e o último lugar fecha a atividade
✓ jornada › atividade lotada com lista de espera aceita entrar na fila
✓ cancelamento e promoção › cancelar libera a vaga, promove a espera
✓ RBAC na inscrição › usuário com vínculo mas sem permissão não consegue se inscrever
✓ RBAC na inscrição › usuário sem vínculo ativo não consegue se inscrever

21 passed
```

### 10.3 Qualidade

```text
ESLint       0 erros, 0 warnings
tsc          0 erros
next build   ✓ compilado, 15 rotas
```

### 10.4 Garantias das fases anteriores

```text
CONTRATO DE ISOLAMENTO MULTI-TENANT          Contrato íntegro.
ISOLAMENTO MULTI-TENANT (9 ataques)          9/9 verificações passaram.
```

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

### 11.2 Dados de demonstração

O seed cria duas instituições com eventos publicados, salas e atividades —
incluindo um minicurso com 30 vagas e **lista de espera habilitada**:

```text
Contas de demonstração:
  ana@example.test    → ADMIN em ufba-demo · CHAIR + PARTICIPANT em fiocruz-demo
  bruno@example.test  → ORGANIZER + REVIEWER + STAFF em ufba-demo
  carla@example.test  → PARTICIPANT em ufba-demo (convite PENDENTE)

Páginas públicas:
  http://localhost:3000/t/ufba-demo/eventos
  http://localhost:3000/t/ufba-demo/eventos/congresso-2026
  http://localhost:3000/t/ufba-demo/eventos/congresso-2026/atividades/minicurso-rust

Subdomínios (com ROOT_DOMAIN=lvh.me):
  http://ufba-demo.lvh.me:3000/eventos
  http://fiocruz-demo.lvh.me:3000/eventos
```

### 11.3 Testes

```bash
npm test                  # Vitest: 190 testes (unit + integração)
npm run test:e2e          # Playwright: 21 testes contra o container
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
npm run build             # build de produção (força NODE_ENV=production)
```

### 11.4 Stack completa em containers

```bash
docker compose --profile app up -d --build
docker compose --profile app ps
```

---

## 12. ADRs — decisões desta fase

### ADR-014 — Contador denormalizado com reserva atômica

**Contexto:** impedir superlotação sob concorrência.
**Decisão:** `confirmedCount` denormalizado, reservado por UPDATE condicional; o
retorno de 0 linhas é a decisão de "não há vaga".
**Justificativa:** a decisão passa a ser tomada pelo banco, numa instrução
atômica, em vez de em JavaScript com uma janela de corrida.
**Consequências:** o contador precisa ser mantido sincronizado com as linhas
reais. Há teste de integração verificando essa consistência após carga
concorrente. Índices liderados por `tenantId` mantêm o custo baixo.

### ADR-015 — Unicidade de inscrição por índice parcial

**Contexto:** impedir duplicidade sem bloquear reinscrição após cancelamento.
**Decisão:** índice único parcial filtrando status vivos.
**Justificativa:** CANCELED é estado terminal e a linha permanece para auditoria;
um índice global impediria reinscrição legítima.
**Consequências:** o Prisma Schema Language não expressa índices parciais, então
a migração é escrita à mão (`prisma/migrations/..._registration_live_unique`).

### ADR-016 — Ordem da lista de espera garantida no banco

**Contexto:** posições duplicadas corrompem a ordem FIFO sob concorrência.
**Decisão:** índice único parcial em `(activityId, waitlistPosition)` + retry com
SAVEPOINT e backoff na aplicação.
**Justificativa:** FIFO é uma promessa ao participante; "quem chegou primeiro" não
pode depender de sorte de agendamento.
**Consequências:** custo de uma tentativa extra sob disputa. SAVEPOINT é
obrigatório para manter a transação utilizável após o erro.

### ADR-017 — Route groups para separar público de autenticado

**Contexto:** a landing page precisa ser pública, mas compartilha o prefixo
`/t/[tenantSlug]` com o painel autenticado.
**Decisão:** `(public)` e `(app)` como route groups, cada um com seu layout.
**Justificativa:** preserva as URLs e mantém o layout autenticado (auth + RBAC +
cabeçalho) sem contaminar a vitrine.
**Consequências:** dois layouts para manter. A regra de negócio de tenant
(existe? está ativa?) é duplicada em ambos — aceitável porque a checagem é
barata e o cache do resolver absorve o custo.

### ADR-018 — Tema validado por allowlist, não por sanitização

**Contexto:** o organizador personaliza cores e URLs da página pública.
**Decisão:** allowlist de formato (hex/oklch para cores; http/https para URLs),
em vez de tentar sanitizar entrada livre.
**Justificativa:** allowlist é verificável e não tem bypass conhecido;
sanitização de CSS/URL é uma corrida armamentista.
**Consequências:** organizadores não podem usar `rgb()` nem nomes de cor.
Documentado na UI de edição (FASE 7).

---

## 13. Lições aprendidas — defeitos reais encontrados nesta fase

Todos foram encontrados por testes (principalmente E2E) e custaram depuração.
Registrado porque cada um pode voltar.

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 1 | Criação de inscrição → `registrations_live_activity_user_key` | Ordem errada: criava e apagava a inscrição antes de reservar | Reservar a vaga **primeiro**, inserir depois |
| 2 | Fila de espera com posições duplicadas | TOCTOU em `MAX(posição) + 1` | Índice único parcial + retry |
| 3 | Retry de posição falhava sempre | PostgreSQL aborta a transação após erro | `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` |
| 4 | Retry não reconhecia a violação | Driver adapter aninha o índice em `meta.driverAdapterError.cause.constraint.index`, não em `meta.target` | `violatedIndexName()` lê as duas formas |
| 5 | Páginas públicas redirecionavam para `/login` | Estavam sob o layout autenticado | Route groups `(public)` / `(app)` |
| 6 | Build falhava em `/_global-error` (`useContext` null) | `.env` define `NODE_ENV=development`, carregado no build | `cross-env NODE_ENV=production` no script |
| 7 | Atividade lotada **oferecia** inscrição | Faltava o ramo `isFull && !waitlistEnabled` | Ramo "Atividade lotada" |
| 8 | Atividade com espera mostrava "lotada" | O ramo novo não excluía `waitlistEnabled` | Condição inclui `!waitlistEnabled` |
| 9 | Cancelamento sempre negado | `can()` chamado para permissão `:own` **sem** `ownership` | Passar `{ ownerId: <da sessão> }` |
| 10 | Cancelamento travava o teste | `page.once('dialog')` já consumido → diálogo aberto bloqueia o browser | `page.on('dialog')` |
| 11 | CSS não resolvia (`Module not found`) | Import relativo com profundidade errada | Import por alias `@/`, independente de profundidade |
| 12 | `Error: style prop expects a mapping` | Passado string CSS ao prop `style` do React | Usar `themeToCssVariables()` (objeto) |
| 13 | Todas as tabelas com `tenant_id` sem RLS | Novo recurso exigia reaplicar as policies | `npm run db:rls` (documentado) |
| 14 | `ActivitySpeaker` sem relação com `User` | Lacuna da FASE 1 | Relação adicionada |

Os itens **7 e 9 são bugs de aplicação** que só apareceram porque os testes E2E
executam um navegador real e verificam o estado do banco.

---

## 14. Dívidas técnicas e trabalho adiado

**Adiado conscientemente:**

1. **Barra de progresso de ocupação na UI** — a landing page mostra "N de M
   inscritos", mas um indicador visual (quase lotado) ajudaria a conversão.
   Depende do design system completo (FASE 7).
2. **Paginação na listagem pública** — hoje carrega todos os eventos visíveis da
   instituição. Suficiente para dezenas; precisa de paginação na casa dos
   milhares.
3. **Fila de espera com prazo de confirmação** — quando uma vaga abre, o
   promovido é confirmado automaticamente. O ideal é dar um prazo (ex.: 48h) para
   ele confirmar, promovendo o próximo se não responder. Exige um job agendado.
4. **Edição de atividades pela UI** — a FASE 3 entrega o lado público. O painel
   de gestão (criar/editar evento, atividade, sala, página) entra na FASE 7.
5. **Upload de imagens de capa** — o modelo suporta `coverImageUrl`, mas o upload
   para o MinIO só será ligado na FASE 4 (mesma infraestrutura das submissões).
6. **Bloqueio de conflito de agenda na criação** — `checkScheduleConflict` existe
   e está testado, mas ainda não é chamado porque não há UI de criação de
   atividade. Será ligado na FASE 7.
7. **Testes de acessibilidade** — recomendo `@axe-core/playwright` antes da
   FASE 7. A landing page tem estrutura semântica (headings, `dl`, `nav`), mas
   isso não foi verificado automaticamente.

**Pontos de atenção:**

- O rate limiter do Better Auth é **em memória e por processo**: em produção real
  ele não protege entre instâncias. Deve migrar para Redis antes de escalar
  horizontalmente. Há comentário no código e a variável `RATE_LIMIT_ENABLED`.
- `NODE_ENV=development` no `.env` quebra `npx next build` direto. Use
  `npm run build` (que força o ambiente correto).

---

## 15. Checklist de aceite da FASE 3

- [x] Domínio de eventos com ciclo de vida derivado do relógio
- [x] Janela de inscrição com precedência correta de motivos
- [x] Conflito de sala detectado, com intervalos adjacentes não conflitando
- [x] Armazenamento em UTC com apresentação no fuso do evento (testado com DST)
- [x] **Sem superlotação sob concorrência real** (20 tentativas / 5 vagas)
- [x] Semântica `null` = ilimitado e `0` = esgotado, com teste dedicado
- [x] Lista de espera FIFO com posições únicas garantidas no banco
- [x] Cancelamento libera vaga e promove o próximo automaticamente
- [x] Cancelar duas vezes não infla a lotação disponível
- [x] Usuário não cancela inscrição de terceiro
- [x] Landing page modular: tema + blocos ordenados e personalizáveis
- [x] Tema validado por allowlist (cores e URLs) — XSS prevenido
- [x] `CUSTOM_HTML` renderizado como texto, nunca como HTML
- [x] Tema inválido cai no padrão em vez de quebrar a página
- [x] Páginas públicas acessíveis sem login (route groups)
- [x] Evento em rascunho não vaza publicamente (404)
- [x] Jornada de inscrição completa: anônimo → cadastro → inscrição
- [x] Consentimento LGPD validado em cliente **e** servidor
- [x] RBAC aplicado no servidor (vínculo + permissão)
- [x] SEO com Open Graph e descrição em cascata
- [x] **190 testes** unitários e de integração passando
- [x] **21 testes E2E** passando contra o container de produção
- [x] ESLint 0 erros · `tsc` 0 erros · `next build` OK
- [x] Garantias das FASES 1 e 2 preservadas
- [x] Documentação com ADRs, diagramas e comandos

**Próximo passo:** FASE 4 — Módulo de Submissão de Trabalhos e fluxo completo de
Avaliação por Pares (Peer Review), com upload no MinIO/S3, versão cega,
atribuição por afinidade, regras anti-conflito de interesse e testes de
integridade de arquivos.

---

## 19. Revisão pós-entrega — inscrição no EVENTO e atividades abertas

> **Natureza:** revisão do MESMO tema (F3), a partir do uso real. **Uma migração**
> (`20260920120000_event_registration_and_open_activities`). Nenhuma permissão nova.
> **ADRs:** 124 a 126 · **Testes novos:** 12 unitários + 9 de integração + 2 E2E.

### 19.1 O que o uso revelou

Três queixas, com a tela na mão:

- *"hoje estamos cadastrando atividade por atividade. Precisa ter um cadastro no evento geral, e
  algumas atividades não terão inscrições individuais, sendo automaticamente cadastrado todos os
  participantes do evento."*
- *"precisa ter também uma opção para excluir ou editar atividades."*
- *"aproveite para ver: o tipo da atividade está em inglês — `LECTURE`, `ROUND_TABLE`… é para
  ficar em português do Brasil."*

| # | Relato | Causa raiz | Correção |
|---|---|---|---|
| 1 | Só havia inscrição POR ATIVIDADE | O modelo nasceu assim na F3: `Registration.activityId` sempre preenchido, e nenhum conceito de "atividade aberta". Inscrever-se numa palestra de abertura exigia uma linha de inscrição sem sentido (ninguém controla o público de uma palestra) | Inscrição **do evento** (`activityId` nulo, com o crachá), coluna `Activity.requiresRegistration` e inscrição AUTOMÁTICA (`origin = EVENT_AUTO`) nas atividades abertas |
| 2 | Não havia como editar nem excluir atividade | `saveActivity` já aceitava `activityId` (edição existia no serviço), mas nenhuma tela a usava; exclusão não existia | Formulário de edição por atividade na lista da programação e exclusão lógica, com o diálogo do sistema |
| 3 | O painel mostrava `LECTURE`, `ROUND_TABLE` | O mapa de tradução existia em QUATRO arquivos de tela — e faltava justamente na lista que o organizador mais lê | Um mapa só, no domínio (`ACTIVITY_TYPE_LABELS`), com `Record<ActivityType, string>` (tipo novo sem rótulo não compila) e um teste que exige rótulo para todo valor do enum |

### 19.2 Decisões

#### ADR-124 — A inscrição no evento MATERIALIZA as atividades abertas

**Contexto.** Duas leituras eram possíveis para "quem se inscreve no evento entra nas atividades
abertas": (a) **deduzir** na leitura — a pessoa está no evento, logo pode entrar; (b)
**materializar** — criar a linha de inscrição em cada atividade aberta.

**Decisão.** Materializar. A inscrição no evento cria uma linha `EVENT_AUTO` em cada atividade
aberta (`requiresRegistration = false`, exceto cancelada), e a linha do evento é a que carrega o
crachá.

**Alternativas descartadas.** A dedução economiza linhas — e obriga TODA leitura a saber que uma
atividade aberta tem, como público, os inscritos do evento: lista de presença, credenciamento,
apuração de carga horária, certificado, exportação. Uma regra a mais repetida em cada consulta é
uma regra a mais para esquecer em uma delas. Materializando, a atividade aberta tem inscritos de
verdade e o resto do sistema — inclusive o credenciamento, que já existia — não precisa saber que
ela é diferente. O custo (linhas duplicadas de consentimento) é aceito e visível: `origin` diz de
onde cada linha veio.

**Consequências.** A atividade aberta publicada DEPOIS precisa alcançar quem já estava no evento —
é o que `syncOpenActivityEnrollments` faz ao criar/tornar aberta uma atividade (fora da transação
de escrita, porque abre a própria — armadilha 41). E cancelar a inscrição do evento cancela as
linhas `EVENT_AUTO` que ele criou, **preservando** as escolhas individuais.

#### ADR-125 — O tipo define o PADRÃO de inscrição individual; a instituição decide

**Contexto.** O relato pede que palestras e mesas-redondas não tenham inscrição individual e que
minicursos continuem tendo.

**Decisão.** `Activity.requiresRegistration` é uma COLUNA (a decisão é da instituição), com padrão
derivado do tipo por `defaultRequiresRegistration`: a lista é a das atividades ABERTAS
(`LECTURE`, `ROUND_TABLE`, `POSTER_SESSION`, `ORAL_PRESENTATION`, `CULTURAL`, `OTHER`), e um tipo
desconhecido exige inscrição — o fail-closed evita liberar a entrada de todos numa atividade que
talvez tenha turma contada.

**Alternativas descartadas.** Decidir pelo tipo em tempo de execução (sem coluna) engessaria o
caso legítimo da palestra com lugar limitado; derivar do tipo na LEITURA faria a mudança de tipo
alterar retroativamente quem está inscrito.

**Consequências.** Atividade aberta não aplica vagas nem lista de espera (o número na tela é
informativo, e o contador continua sendo mantido porque é ele que a lista de presença mostra). A
tela do organizador exibe o selo "Aberta a todos os inscritos" e a criação traz a caixa "Exige
inscrição individual" marcada, com a explicação de quando desmarcar.

#### ADR-126 — Excluir atividade é para o cadastro errado; cancelar é para a que tem gente

**Contexto.** Pedido explícito de exclusão de atividades. `onDelete: Cascade` tornaria a operação
trivial — e destruiria registro científico.

**Decisão.** `canDeleteActivity` recusa quando há inscrição viva ou presença registrada, com a
contagem na mensagem e o caminho alternativo ("cancele a atividade"). Sem ninguém, a exclusão é
LÓGICA (`deletedAt`), com o fato na trilha; atividade excluída sai da programação do organizador.

**Alternativas descartadas.** Cascata (apaga a presença que sustenta carga horária, XP e
certificado); bloquear a exclusão sempre (obrigaria a cancelar um cadastro duplicado, poluindo a
agenda).

**Consequências.** Quem cadastrou errado corrige rápido; quem já tem público cancela — e cancelar
já existia como estado. A edição ganhou duas travas: a lotação não pode ficar ABAIXO das
inscrições ativas, e a mudança de horário continua passando pela checagem de sala e de janela do
evento.

### 19.3 Lições aprendidas (revisão)

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 18 | E2E: editar uma atividade recém-criada era recusado com "a atividade precisa acontecer dentro do período do evento" | A atividade foi criada no MESMO instante do início do evento (+30 dias); o `<input type="datetime-local">` tem precisão de MINUTO, então o valor devolvido pelo formulário caía segundos ANTES da abertura | A fixture marca a atividade para o dia seguinte (+31) — o arredondamento do campo deixa de importar. Diagnóstico no dado: a tela mostrava o horário certo, e a diferença era invisível |
| 19 | E2E: `/signup` do segundo usuário não tinha formulário e o teste morria esperando "Nome completo" | `/signup` com sessão ativa REDIRECIONA (a pessoa já está dentro) — a tela de cadastro não existe para quem está logado | A segunda pessoa nasce pela API de cadastro (`/api/auth/sign-up/email`), como nas outras specs; a tela de cadastro tem cenário próprio e não é o que aquele teste mede |
| 20 | A lista de atividades do organizador continuava mostrando atividade EXCLUÍDA | `getAdminEvent` não filtrava `deletedAt` nas atividades (a exclusão lógica preserva o dado, mas ele não pode continuar na tela) | `where: { deletedAt: null }` no select — e o teste de integração prende os dois lados: some da lista do organizador E continua no banco |

### 19.4 Evidência de verificação

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 53 arquivos, 1283 testes passando (+21 nesta revisão)
npm run build                → ✓ Compiled successfully
npm run test:e2e             → 79 passed
npm run db:migrate:status    → 18 migrations found · Database schema is up to date!
npm run db:verify            → Contrato íntegro. (RLS + FORCE, policy em toda tabela)
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run db:partitions        → audit_logs_2026_09/10/11 já existem (3.979 linhas)
rota nova no container       → GET /t/ufba-demo/eventos/congresso-2026/inscricao = 200

E2E dos caminhos novos (contra o container de produção):
✓ a inscrição no evento entra nas atividades abertas e deixa os minicursos para escolha própria
✓ o painel do evento mostra o tipo em português, edita e recusa excluir com inscritos

Integração (banco real):
✓ inscreve no evento E nas atividades abertas, deixando as de inscrição própria vazias
✓ RECUSA a segunda inscrição no mesmo evento
✓ quem JÁ tinha inscrição na atividade aberta não ganha uma segunda linha
✓ RECUSA inscrição individual em atividade aberta, apontando o caminho
✓ o evento respeita a própria lotação
✓ cancela o que o evento criou e PRESERVA as escolhas individuais
✓ sincroniza quem já estava no evento ao criar uma atividade aberta
✓ RECUSA excluir atividade com inscritos, e exclui a que não tem ninguém
✓ RECUSA reduzir a lotação abaixo das inscrições já ativas

Unitários:
✓ todo valor do enum tem rótulo em português (e nenhum é o próprio enum)
✓ minicurso/oficina/maratona exigem inscrição; palestra/mesa-redonda nascem abertas
✓ tipo desconhecido exige inscrição (fail-closed)
✓ exclusão recusada com presença e com inscrição, com a contagem na mensagem
```

### 19.5 Checklist da revisão

- [x] Inscrição no EVENTO (`activityId` nulo), com crachá e consentimentos próprios
- [x] `Activity.requiresRegistration` + padrão por tipo, editável por atividade
- [x] Inscrição automática nas atividades abertas, com `origin = EVENT_AUTO`
- [x] Atividade aberta publicada depois alcança quem já estava no evento
- [x] Cancelar a inscrição do evento cancela o que ela criou e preserva o resto
- [x] Atividade aberta não aplica vagas/lista de espera; o evento aplica a lotação dele
- [x] Editar atividade pela lista (mesmos campos da criação, com as travas de sala/janela/lotação)
- [x] Excluir atividade recusado com inscritos/presença, com o motivo escrito
- [x] Rótulos de tipo e situação em português, centralizados no domínio
- [x] `Credenciamento` continua funcionando sem mudança (as linhas automáticas aparecem na fila)
- [x] Testes: 12 unitários, 9 de integração, 2 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 19.4
- [x] `AGENTS.md`, `docs/dividas-tecnicas.md` e `README.md` atualizados

---

## 20. Revisão pós-entrega — ciclo de vida da SALA e o teto das vagas

> **Natureza:** revisão do MESMO tema (F3), a partir do uso real. **Uma migração**
> (`20260921100000_room_capacity_optional`). Nenhuma permissão nova.
> **ADRs:** 134 a 136 · **Testes novos:** 17 unitários + 16 de integração + 4 E2E.

### 20.1 O que o uso revelou

O relato veio com a tela na mão:

- *"nessa parte do gerenciamento de evento, no cadastro de sala, ter uma opção de deletar e editar
  sala"*;
- *"quando não digitar a capacidade é sem limite, o limite das vagas se dará pelo limite da
  atividade"*;
- *"o numero de vagas da atividade também não pode ultrapassar o limite da sala, para não ocorrer
  de ter mais inscritos que a capacidade da sala"*.

| # | Relato | Causa raiz | Correção |
|---|---|---|---|
| 1 | Não havia como editar nem excluir sala | O serviço `saveRoom` já aceitava `roomId` (edição existia desde a F7), mas **nenhuma tela a usava**; exclusão não existia. É o mesmo defeito que a revisão anterior corrigiu para a ATIVIDADE — e que ficou faltando na SALA, cadastrada na mesma tela | Formulário de edição por sala na lista e exclusão com o diálogo do sistema; `deleteRoom` recusa a sala em uso |
| 2 | A capacidade era obrigatória, com `min=1` | A coluna nasceu `Int NOT NULL DEFAULT 0`: a sala criada sem número declarado passava a afirmar "zero lugares" — e o domínio tinha de reinterpretar o 0 como "sem limite" para não bloquear tudo | `rooms."capacity"` virou `Int?`, o campo é OPCIONAL ("vazio = sem limite") e o `0` é normalizado para `NULL` na escrita |
| 3 | Nada impedia mais inscritos do que a sala comporta | `evaluateRoomFit` comparava a LOTação DECLARADA com a sala, **uma vez, ao salvar a atividade**. Atividade com `capacity = null` (ilimitada) numa sala de 40 não tinha teto nenhum — e o `UPDATE` que reserva a vaga só conhecia `activities.capacity` | O limite passou a ser o **efetivo** (`effectiveActivityCapacity`), aplicado no MESMO predicado atômico da reserva — e a página pública anuncia esse número, não o declarado |

### 20.2 Decisões

#### ADR-134 — Sala sem capacidade declarada é `NULL`, não zero

**Contexto.** `rooms."capacity"` nasceu `integer NOT NULL DEFAULT 0`. O `DEFAULT 0` era um problema
de SIGNIFICADO: a sala criada sem capacidade declarada passava a afirmar "zero lugares", e
`evaluateRoomFit` precisava ler `<= 0` como "sem limite" para que uma atividade pudesse acontecer
nela. Duas afirmações diferentes moravam no mesmo valor.

**Decisão.** A coluna passa a aceitar `NULL`, sem `DEFAULT`. `NULL` = a sala não declara limite (a
lotação da atividade manda); `n > 0` = a sala comporta n pessoas. Na escrita, valor não positivo é
normalizado para `NULL` (`normalizeRoomCapacity`), e o rótulo é `roomCapacityLabel` — "sem limite",
nunca "0 lugares".

**Alternativas descartadas.** *Manter `NOT NULL` com um sentinela* (0 ou −1): o sentinela precisa ser
lembrado em toda leitura, e a primeira que esquecer bloqueia a sala inteira. É a mesma razão pela
qual `Activity.capacity` já era `Int?` desde a F3 — e a assimetria entre as duas colunas era, por si
só, um convite ao erro. *Recusar o campo vazio com "informe a capacidade"*: contraria o pedido (a
sala sem número é uma configuração legítima, comum em salas cedidas sem planta) e obrigaria a
inventar um número.

**Consequências.** A migração normaliza os zeros existentes para `NULL` — e isso **não muda
comportamento nenhum**, porque o domínio já os lia assim. Nenhuma atividade perde vaga e nenhuma
inscrição é tocada.

#### ADR-135 — O limite EFETIVO da atividade é o da sala quando ela é menor, e vale na reserva atômica

**Contexto.** Havia duas respostas possíveis para "quantas pessoas cabem nesta atividade?": a
lotação declarada (`activities.capacity`) e a capacidade física da sala. A checagem de sala existia
só no salvamento, e o caminho de escrita da inscrição conhecia apenas a primeira — então uma
atividade ILIMITADA numa sala de 40 aceitava 300 inscritos.

**Decisão.** Existe **uma** função para isso, `effectiveActivityCapacity(activityCapacity,
roomCapacity)`: atividade ilimitada assume o teto da sala; ambos limitados devolvem o menor;
atividade `0` (esgotada) continua `0` — a sala não "devolve" vaga. O número efetivo é usado em TRÊS
lugares: no que a página pública anuncia, na mensagem de lotação e — o que fecha o buraco — no
`WHERE` do `UPDATE` que reserva a vaga (`RESERVE_ACTIVITY_SEAT_SQL`, com
`ROOM_SEAT_AVAILABLE_PREDICATE`).

**Alternativas descartadas.** *Checar a sala em JavaScript antes do UPDATE*: reabriria exatamente a
janela que a reserva atômica fecha (duas requisições leem "cabe", ambas reservam). *Copiar a
capacidade da sala para dentro da atividade* (coluna denormalizada): criaria duas fontes de verdade
para o mesmo número — reduzir a sala passaria a exigir reescrever as atividades, e a primeira que
ficasse para trás anunciaria vaga inexistente. *Bloquear a atividade sem vagas declaradas numa sala
com limite*: proibiria o caso mais comum (a sala é quem sabe o tamanho).

**Consequências.** A subconsulta do predicado enxerga os valores ANTIGOS da linha atualizada — é
assim que `UPDATE ... WHERE` funciona —, então a última vaga de uma sala de 2 é entregue UMA vez,
mesmo com três requisições simultâneas. O `RESERVE_ACTIVITY_SEAT_SQL` também acabou com as quatro
cópias do mesmo `UPDATE` escritas à mão no serviço de inscrição.

#### ADR-136 — A sala em uso recusa a exclusão; a redução recusa abaixo do que existe

**Contexto.** `activities."roomId"` é `ON DELETE SET NULL`: excluir uma sala usada por atividades não
falharia — ela sumiria da programação em silêncio, e a atividade passaria a "sem sala" sem ninguém
pedir. É a mesma classe de defeito que a exclusão de mídia da FASE 24 foi desenhada para não ter
(armadilha 39). Do outro lado, reduzir a capacidade de uma sala em uso recriaria a situação que o
ADR-135 existe para impedir: uma atividade com 50 vagas numa sala de 30, ou 12 inscritos numa sala
de 5.

**Decisão.** Duas guardas no domínio, com a leitura feita NA MESMA TRANSAÇÃO da escrita:

1. `evaluateRoomRemoval` recusa quando alguma atividade viva usa a sala, e a mensagem diz quantas e
   qual, com o caminho ("troque a sala dessas atividades ou deixe-as sem sala definida");
2. `evaluateRoomCapacityChange` recusa reduzir abaixo das VAGAS declaradas ou dos INSCRITOS já
   confirmados de qualquer atividade da sala — com o número que impede, porque quem digita precisa
   saber QUAL atividade trava.

**Alternativas descartadas.** *Exclusão lógica (como a atividade)*: a sala não tem histórico de gente
inscrita — quem tem é a atividade —, e o `@@unique([eventId, name])` faria um nome excluído bloquear
para sempre a criação de outro igual (a armadilha que a ATIVIDADE já tem, e que aqui seria evitável).
*Recusar quando a sala tem QUALQUER atividade, inclusive cancelada*: já é o comportamento adotado —
cancelar não libera a sala, porque a atividade cancelada continua sendo registro do que aconteceria
ali.

**Consequências.** Aumentar a capacidade ou tirar o limite é sempre permitido (nenhuma configuração
existente fica inválida). Atividades já EXCLUÍDAS (logicamente) não bloqueiam: saíram da programação
e o vínculo delas passa a nulo pela própria FK — mudança em registro que já estava fora de
circulação.

### 20.3 O caso da atividade ABERTA: aviso, não recusa

Atividade aberta (`requiresRegistration = false`) recebe automaticamente quem se inscreveu no evento
— é a decisão da revisão anterior (ADR-124), e ela não tem fila nem vagas. Aplicar o teto da sala
nessa entrega significaria **negar acesso em silêncio** a quem já está inscrito no evento, por causa
de uma sala escolhida depois.

A escolha foi **avisar**: o painel mostra, na linha da atividade, quando o público do evento excede a
capacidade da sala, com os dois números e o caminho ("uma sala maior ou uma atividade com inscrição
própria"). O aviso acontece antes do dia, que é quando ainda dá para resolver. Para as atividades com
inscrição própria (minicursos e oficinas — justamente as que acontecem em sala), o teto é aplicado
sem aviso nenhum: a vaga simplesmente não existe.

### 20.4 Lições aprendidas (revisão)

| # | Sintoma | Causa raiz | Correção |
|---|---|---|---|
| 31 | `prisma migrate dev` gerou uma migração que **derrubava quatro índices** e alterava colunas de seis tabelas alheias (`event_pages_tenantId_eventId_unpublishAt_idx`, `raffle_winners_raffleId_kind_idx`, `raffles_eventId_isPublic_status_idx`, `registrations_event_origin_idx`) | O projeto tem migrações **escritas à mão** (índices parciais, policies, partições) que o `schema.prisma` não declara. O Prisma compara o schema com o banco, vê o que não conhece e propõe REMOVER — a migração de uma coluna virava uma faxina destrutiva | A migração foi escrita à mão com as duas instruções que interessam, criada com `--create-only` e aplicada com `db:migrate:deploy`. A lição: **leia o SQL gerado antes de aplicar**; `migrate dev` não é seguro num projeto com DDL manual |
| 32 | A migração nasceu com carimbo de tempo ANTERIOR ao das duas últimas já aplicadas (`20260919141704` contra `20260920140000`) | O relógio da máquina está em 19/09 e as migrações anteriores foram nomeadas à mão com datas à frente (20/09). Prisma ordena por NOME, então a migração nova seria aplicada "no meio" do histórico | O diretório foi renomeado para `20260921100000_room_capacity_optional`: **a ordem é o nome**. Numa migração criada localmente, o carimbo precisa ser maior que o da última aplicada |
| 33 | Ao trocar o teto da atividade pelo limite EFETIVO, o `UPDATE` que reserva a vaga continuava conhecendo só `activities.capacity` | A mesma instrução estava escrita à mão em QUATRO pontos do serviço (inscrição, promoção da espera e as duas sincronizações de atividade aberta). A regra mudou em um lugar e três ficaram para trás — em silêncio, porque o teto da sala não era o caminho testado | As quatro viraram constantes nomeadas no domínio (`RESERVE_ACTIVITY_SEAT_SQL`, `RESERVE_OPEN_ACTIVITY_SEAT_SQL`, `RESERVE_EVENT_SEAT_SQL`), e o teste de integração prende o caso central: atividade ILIMITADA numa sala de 2 confirma exatamente 2 |

### 20.5 Evidência de verificação

```text
npm run lint                 → 0 erros, 0 warnings
npm run typecheck            → 0 erros
npm test                     → 58 arquivos, 1414 testes passando (+33 nesta revisão)
npm run build                → ✓ Compiled successfully
npm run db:migrate:status    → 20 migrations found · Database schema is up to date!
npm run db:verify            → Contrato íntegro.
npm run db:verify:isolation  → 9/9 verificações passaram.
npm run test:e2e             → 89 passed

Integração (banco real) — tests/integration/room-lifecycle.test.ts:
✓ sala SEM capacidade é gravada como NULL (e não como zero lugares)
✓ capacidade ZERO é normalizada para NULL
✓ a edição troca nome e capacidade, e a trilha registra as duas mudanças
✓ RECUSA renomear uma sala para o nome de outra do mesmo evento (ROOM_NAME_TAKEN)
✓ RECUSA atividade com mais vagas do que a sala comporta
✓ ACEITA atividade sem vagas declaradas numa sala com limite (o limite efetivo é o da sala)
✓ RECUSA reduzir a sala abaixo das vagas já configuradas, dizendo qual atividade
✓ RECUSA reduzir a sala abaixo dos inscritos já confirmados
✓ atividade ILIMITADA numa sala de 2 lugares confirma exatamente 2 (a 3ª recebe FULL)
✓ a página pública anuncia o limite da SALA, não o da atividade
✓ a lista de espera é PROMOVIDA só até o teto da sala
✓ RECUSA excluir a sala em uso e diz quantas atividades a usam
✓ exclui depois que a atividade sai da sala, e registra na trilha
✓ o painel entrega capacidade (ou a ausência dela) e o teto da sala na atividade

Unitários (domínio) — 17 novos:
✓ vazio/zero/negativo significam SEM LIMITE; positivo é preservado; rótulo diz "sem limite"
✓ sala com limite é o teto da atividade sem vagas declaradas; sala menor manda; sem limite deixa a
  atividade decidir; atividade ESGOTADA (0) não é "devolvida" pela sala
✓ reduzir abaixo das vagas declaradas / dos inscritos confirmados é recusado, com o número
✓ TIRAR o limite é sempre permitido, mesmo com a sala cheia
✓ sala EM USO não pode ser excluída — e a recusa diz por quem

E2E (4) — tests/e2e/room-lifecycle.spec.ts:
✓ o ciclo inteiro pela tela (criar sem capacidade, editar, excluir), com "sem limite" na lista
✓ a lista volta ao estado de "nenhuma sala" depois de excluir a única sala
✓ vagas acima da sala são recusadas, e a sala em uso não pode ser excluída
✓ atividade aberta numa sala pequena: o painel avisa que o público do evento não cabe
```

### 20.6 Checklist da revisão

- [x] Editar sala pela lista (nome e capacidade), com os mesmos campos da criação
- [x] Excluir sala pelo diálogo do sistema, recusado quando alguma atividade a usa
- [x] Capacidade OPCIONAL: vazio = sem limite; `0` e negativo normalizados para `NULL`
- [x] `rooms."capacity"` nullable, sem `DEFAULT`, com os zeros existentes migrados para `NULL`
- [x] Limite EFETIVO da atividade = menor entre a lotação declarada e a sala (uma função só)
- [x] Vagas da atividade acima da sala: recusadas ao salvar, com os dois números na mensagem
- [x] A reserva de vaga (inscrição individual e promoção da lista de espera) respeita o teto da sala
- [x] A página pública anuncia o limite efetivo, dizendo quando a sala é quem limita
- [x] Reduzir a sala abaixo das vagas configuradas ou dos inscritos é recusado, com o número
- [x] Atividade aberta em sala pequena: aviso no painel, sem negar acesso em silêncio
- [x] Sala de OUTRO evento não é alcançada (o escopo é o evento)
- [x] Testes: 17 unitários, 16 de integração, 4 E2E
- [x] Bateria completa executada, com os números reais reportados na seção 20.5
- [x] `AGENTS.md`, `docs/dividas-tecnicas.md` e `README.md` atualizados

---

Aguardando **"APROVADO: AVANÇAR"**.
