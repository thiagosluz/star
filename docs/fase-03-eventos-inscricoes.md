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

Aguardando **"APROVADO: AVANÇAR"**.
