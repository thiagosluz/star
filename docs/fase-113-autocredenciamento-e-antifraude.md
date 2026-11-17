# FASE 113 — Autocredenciamento, Autocheck-in em Atividades e Cartazes por QR Code com Antifraude

## 1. Sumário Executivo

| Entrega | Camada | Arquivos Principais | Status |
|---|---|---|---|
| **Modelo `self_checkin_points` + índices únicos parciais + RLS + FORCE + GRANTs** | Banco / Contrato | `prisma/schema.prisma`, `prisma/migrations/20261117160000_f113_self_checkin/migration.sql`, `src/lib/db/schema-contract.ts` | ✅ Concluído |
| **Domínio puro de autocredenciamento e antifraude (token `PA-`, PIN, Haversine GPS, precisão, anti-ubiquidade e cooldown)** | Domínio | `src/domain/events/self-checkin-rules.ts` | ✅ Concluído |
| **Motor TOTP HMAC-SHA256 de 60 s para Modo Telão e comparação em tempo constante** | Aplicação (Crypto) | `src/lib/events/self-checkin-totp.ts` | ✅ Concluído |
| **Serviço transacional de pontos, política antifraude e submissão com reuso de `checkIn`/`checkOut` (`SELF_DECLARED`)** | Aplicação | `src/lib/events/self-checkin-service.ts`, `src/lib/events/attendance-service.ts` | ✅ Concluído |
| **Renderizador vetorial A4 em PDF, PNG e SVG para cartazes imprimíveis** | Aplicação (Documentos) | `src/lib/events/self-checkin-poster.ts`, `src/app/api/t/[tenantSlug]/credenciamento/cartaz/route.ts` | ✅ Concluído |
| **Painel no `/credenciamento`, Modo Telão ao vivo e página pública do participante (`/presenca/[token]`)** | Server Actions / UI | `src/app/actions/self-checkin-actions.ts`, `src/app/t/[tenantSlug]/(app)/credenciamento/page.tsx`, `.../telao/[pointId]/page.tsx`, `src/app/t/[tenantSlug]/(public)/presenca/[token]/page.tsx`, `src/components/credentials/self-checkin-*.tsx` | ✅ Concluído |
| **Testes Unitários, Integração com Postgres/RLS, Catracas F76/F78/F79 e E2E com Geolocalização** | Testes | `tests/unit/f113-autocredenciamento-e-antifraude.test.ts`, `tests/integration/f113-self-checkin-banco.test.ts`, `tests/e2e/f113-autocredenciamento.spec.ts` | ✅ Concluído |

### Números da Fase
- **Testes Vitest (unitários + integração):** `4.920` passando (`294` arquivos; `+14` novos testes: `11` unitários + `3` de integração)
- **Testes Playwright E2E:** `561` passando + `1` skip (`562` casos; `+4` novos cenários E2E em `f113-autocredenciamento.spec.ts`)
- **ADRs registradas:** `ADR-460` a `ADR-462` (total global: `462`)
- **Migrações de banco:** `1` (`20261117160000_f113_self_checkin`)
- **Dívidas técnicas abertas:** `42` (mantidas)

---

## 2. O Problema Mais Difícil da Fase e Por Que Ele Define o Desenho

Um cartaz impresso fixado na entrada de um auditório ou de uma sala é, por natureza, um **artefato estático**. Sem verificações adicionais, qualquer participante pode fotografar o cartaz, enviar no grupo de mensagens do evento e permitir que ausentes registrem presença à distância — comprometendo carga horária de certificados, saldo de XP e pesos em sorteios auditados.

Ao mesmo tempo, em salas universitárias com concreto espesso ou subsolo, confiar exclusivamente em GPS pode bloquear participantes legitimamente presentes. Por isso, a arquitetura adotou **defesa em profundidade configurável em 4 camadas**:

1. **Identidade e Vínculo (`guardAction` + `Event.settings.selfCheckin`)**: apenas contas autenticadas na instituição registram a própria presença (sem passar o segredo do ponto para o navegador do participante), respeitando janela (`canRecordAttendance`), inscrição confirmada (com opção explícita para modo aberto sem inscrição) e pré-requisito opcional de passagem pela portaria antes das atividades (`requireEventArrivalBeforeActivity`).
2. **Geofencing Esférico (Haversine) + Filtro de Precisão (`maxAccuracyMeters`)**: calcula a distância real em metros entre `Event.latitude`/`longitude` e o dispositivo, e **rejeita** coordenadas com precisão degradada (> `300 m` por padrão) típicas de geolocalização aproximada por IP em computadores remotos.
3. **Prova de Sala Presencial (PIN Estático e/ou TOTP Dinâmico de 60 s)**: para cartazes impressos, o organizador pode exigir um PIN numérico de 4 dígitos anunciado verbalmente ou no quadro (e trocável em 1 clique); para salas com projetor, o **Modo Telão** exibe um código TOTP HMAC-SHA256 de 6 dígitos renovado a cada 60 segundos, inutilizando capturas de tela antigas.
4. **Anti-Ubiquidade Física e Cooldown de Saída**: bloqueia abertura de presença em uma segunda atividade enquanto houver outra sessão aberta sem check-out (`CONCURRENT_ACTIVITY_OPEN`) e protege contra toque duplo acidental logo após a entrada (`checkoutCooldownMinutes`), enquanto índices únicos parciais no PostgreSQL impedem duplicidade em rajadas simultâneas.

---

## 3. Decisões Técnicas Explicadas

- **Reuso estrito de `checkIn` / `checkOut` e das colunas já modeladas em `Attendance`**: em vez de criar uma tabela paralela de presenças ou uma segunda cópia das regras de XP/minutos, `checkIn` passou a aceitar `source?: 'MANUAL_STAFF' | 'QR_CODE_CHECKIN' | 'SELF_DECLARED'`, `latitude`, `longitude` e `notes`. Assim, tanto o balcão com monitor quanto o autocheck-in compartilham o mesmo motor transacional de recompensa e teto de carga horária (`sessionMinutes`).
- **Endpoint de cartaz vetorial em PDF/SVG/PNG sem dependências externas**: `renderSelfCheckinPosterPdf` usa as mesmas primitivas (`assemblePdf`, `buildQrMatrix`) da folha de crachás e certificados para gerar cartazes A4 nítidos diretamente no servidor.
- **Privacidade (LGPD) em IP e exposição de segredos**: o IP do dispositivo na leitura é mascarado via `maskIpAddress` (`/24` em IPv4 e `/48` em IPv6) antes de ir para `attendances.ipAddress`; e `getPublicSelfCheckinPoint` jamais serializa `pinCode` ou `totpSecret` para o participante.

---

## 4. ADRs (Architecture Decision Records)

### ADR-460: Tabela `self_checkin_points` sob RLS + FORCE e Índices Únicos Parciais por Portaria e Atividade
- **Contexto:** Era necessário armazenar tokens opacos revogáveis (`PA-XXXX-XXXX`), estado ativo/pausado, PIN de sala e segredo TOTP tanto para a portaria geral do evento quanto para cada atividade, com revogação instantânea quando um cartaz vazar.
- **Decisão:** Criar a tabela `self_checkin_points` com `tenantId`, RLS + FORCE, policy `tenant_isolation`, registro em `TENANT_SCOPED_TABLES` (`src/lib/db/schema-contract.ts`) e dois índices únicos parciais (`WHERE "activityId" IS NULL AND "revokedAt" IS NULL` e `WHERE "activityId" IS NOT NULL AND "revokedAt" IS NULL`).
- **Consequências:** Cada ponto tem no máximo um QR Code ativo por vez, regenerar revoga imediatamente todos os cartazes antigos, e uma instituição nunca enxerga ou consome pontos de outra.

### ADR-461: Segurança Antifraude em 4 Camadas Configuráveis (GPS Haversine, PIN/TOTP, Anti-Ubiquidade e Cooldown)
- **Contexto:** Diferentes formatos de evento exigem diferentes níveis de atrito no check-in (congresso em campus aberto usa GPS; sala fechada usa PIN falado ou Telão TOTP de 60 s; auditórios simultâneos exigem bloquear presença duplicada).
- **Decisão:** Concentrar todas as avaliações puras em `src/domain/events/self-checkin-rules.ts` (Haversine, filtro de `accuracyMeters`, `evaluateAntiUbiquity`, `evaluateCheckoutCooldown`, normalização de política em `Event.settings.selfCheckin`) e o TOTP HMAC-SHA256 em `src/lib/events/self-checkin-totp.ts`.
- **Consequências:** A organização ativa/combina as camadas conforme a realidade de cada evento/sala e todas as regras têm cobertura determinística sem banco no Vitest.

### ADR-462: Convergência com `checkIn`/`checkOut` (`source = SELF_DECLARED`) e Rota Dedicada de Telão sob `requireUuidParam`
- **Contexto:** Separar o cálculo de XP/certificado para autocheck-in criaria divergência com o modo monitor (armadilha 55). Além disso, telas e APIs com UUID na URL precisam cumprir o contrato de validação da FASE 76 e o `<PageHeader>` único da FASE 78.
- **Decisão:** Estender `checkIn` com parâmetros opcionais de origem, coordenadas e notas (gravando `SELF_DECLARED` e `validatedById = null`), montar `/t/[tenantSlug]/presenca/[token]` na área pública com retorno de login, e proteger `/credenciamento/telao/[pointId]` e `/api/t/[tenantSlug]/credenciamento/cartaz` com `isUuid` / `requireUuidParam` + `PERMISSIONS.REGISTRATION_CHECKIN`.
- **Consequências:** Gamificação, carga horária de certificado e sorteios funcionam de forma idêntica para presenças de portaria, monitor e autocheck-in, e todas as catracas do repositório seguem íntegras.

---

## 5. Lições Aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| `TS2322` no `tsc` ao montar `<ConfirmDialog>` para regeneração do QR Code | A prop de cancelamento/fechamento de `ConfirmDialog` em `src/components/ui/dialog.tsx` é `onCancel`, e não `onOpenChange` | Substituído `onOpenChange` por `onCancel={() => setRegenOpen(false)}` em `SelfCheckinManager` |
| Falha no E2E completo em `f102` e `team-scope` (`strict mode violation` no Playwright em `/credenciamento`) | Substrings `"credenciamento"` nos headings (`Autocredenciamento...`, `Portaria...`) e `"evento"` nos `<label>` dos checkboxes colidiram com `getByRole('heading', { name: 'Credenciamento' })` e `getByLabel('Evento')` | Ajustados os títulos de seção e os rótulos de formulário em `SelfCheckinManager` (`Check-in autônomo...`, `Portaria e entrada geral` e remoção de `"evento"` dos checkboxes), preservando intactos os specs legados |

---

## 6. Evidência de Verificação

- `npx prisma validate` / `npm run db:migrate:deploy` / `npm run db:rls`: aplicados e validados sem erros
- `npm run db:verify`: `Contrato íntegro.` (`63` tabelas de tenant sob RLS + FORCE)
- `npm run db:verify:isolation`: `9/9 verificações passaram.`
- `npm run lint`: `0` erros, `0` warnings
- `npm run typecheck`: `0` erros
- `npm test`: `294` arquivos passando (`4.920` testes)
- `npm run build`: compilado com sucesso (todas as 4 novas rotas listadas)
- `npm run test:e2e`: `561` passando + `1` skip (`562` casos, `0` falhas)

---

## 7. Comandos Operacionais

```bash
npm run db:migrate:deploy
npm run db:verify
npm run db:verify:isolation
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test tests/e2e/f113-autocredenciamento.spec.ts
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- Nenhuma dívida técnica nova foi aberta; o quadro permanece em **42 itens abertos** (`docs/dividas-tecnicas.md`).
- **Ponto de atenção:** Ao imprimir cartazes pela URL `/api/t/<slug>/credenciamento/cartaz?pointId=<uuid>`, por padrão o PIN estático da sala **não** é impresso no papel para impedir vazamento por foto antes da palestra; para imprimi-lo no cartaz (ex.: cartaz colado pelo palestrante dentro da sala), anexe `&incluirPin=1`.

---

## 9. Checklist de Aceite

- [x] Modelo `SelfCheckinPoint` (`self_checkin_points`) com migração, RLS + FORCE + política + `schema-contract.ts`.
- [x] Regras puras em `src/domain/events/self-checkin-rules.ts` (Haversine GPS, precisão, PIN, anti-ubiquidade, cooldown e política).
- [x] TOTP rotativo de 60 s no servidor (`self-checkin-totp.ts`) para projeção no **Modo Telão**.
- [x] Renderização vetorial A4 em PDF, SVG e PNG (`/api/t/[tenantSlug]/credenciamento/cartaz`) e atualização ao vivo (`/api/t/[tenantSlug]/credenciamento/telao/[pointId]`).
- [x] Painel completo de gestão no `/t/[tenantSlug]/credenciamento`, página `/t/[tenantSlug]/credenciamento/telao/[pointId]` e página mobile-first `/t/[tenantSlug]/presenca/[token]`.
- [x] Testes unitários (`11`), integração com banco real/RLS (`3`) e E2E com geolocalização no Playwright (`4`), mais bateria global verde.
