# FASE 115 — Sincronização de Contexto (Portaria × Atividade), Registro Manual Contextual e Fila Escalável no Credenciamento

## 1. Sumário Executivo

Esta fase elimina a desconexão histórica entre o **Modo monitor** (refeito na FASE 31 para operar por contexto: Portaria vs. Atividade) e a fila lateral **Sem crachá à mão? Busque pelo nome** (que ainda listava linhas brutas de `registrations` da FASE 4). Agora, a fila manual consolida **1 card por participante** em ordem alfabética (**A–Z**), sincroniza instantaneamente com o seletor **Onde esta leitura vale** do Modo monitor, registra entrada/saída tanto na **Portaria do evento** quanto em **qualquer atividade** (inclusive palestras/cerimônias abertas sem inscrição específica ou 2ª sessão de oficina) e contém a lista em área com rolagem própria (`max-h-[520px]`) para eventos de 500+ participantes.

| Entrega | Arquivo(s) |
|---|---|
| Regras puras de chave de contexto, destino manual e vínculo por atividade | [checkin-console-rules.ts](file:///c:/Users/thiago/Documents/Projetos/star/src/domain/events/checkin-console-rules.ts) |
| Deduplicação por pessoa (`deduplicateByUser`), mapas por contexto e `checkIn`/`checkOut` contextuais | [attendance-service.ts](file:///c:/Users/thiago/Documents/Projetos/star/src/lib/events/attendance-service.ts) |
| Server Actions de presença manual com `contextKind` e `targetActivityId` | [attendance-actions.ts](file:///c:/Users/thiago/Documents/Projetos/star/src/app/actions/attendance-actions.ts) |
| Emissão de evento de contexto (`CHECKIN_CONTEXT_EVENT`) no Modo monitor | [monitor-console.tsx](file:///c:/Users/thiago/Documents/Projetos/star/src/components/credentials/monitor-console.tsx) |
| Banner de destino, selo de vínculo, chave contextual em `QueueRow` e scroll contido (`max-h-[520px]`) | [checkin-queue.tsx](file:///c:/Users/thiago/Documents/Projetos/star/src/components/gamification/checkin-queue.tsx), [checkin-queue-section.tsx](file:///c:/Users/thiago/Documents/Projetos/star/src/components/credentials/checkin-queue-section.tsx), [page.tsx](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/%5BtenantSlug%5D/(app)/credenciamento/page.tsx) |
| Testes unitários (`6`), integração (`3`) e E2E (`1`) | [f115-contexto-sincronizado-e-fila-escalavel.test.ts](file:///c:/Users/thiago/Documents/Projetos/star/tests/unit/f115-contexto-sincronizado-e-fila-escalavel.test.ts), [f115-checkin-contexto-e-deduplicacao.test.ts](file:///c:/Users/thiago/Documents/Projetos/star/tests/integration/f115-checkin-contexto-e-deduplicacao.test.ts), [f115-contexto-sincronizado-balcao.spec.ts](file:///c:/Users/thiago/Documents/Projetos/star/tests/e2e/f115-contexto-sincronizado-balcao.spec.ts) |

---

## 2. O Problema Mais Difícil da Fase

Na operação real (e visível no seed `ufba-demo`), um participante inscrito no evento e em oficinas aparecia multiplicado na lista da direita, enquanto palestras abertas como a *Cerimônia de abertura e conferência magna* (`requiresRegistration = false`) não possuíam linha de `registration` própria e ficavam inacessíveis pela busca por nome. Pior: clicar em **Credenciar** num card cuja linha veio de um minicurso já encerrado batia em `if (located.checkedInAt) return alreadyCheckedIn` e não registrava a chegada na Portaria nem abria presença na Cerimônia.

Ao mesmo tempo, seis suítes E2E legadas (`certification`, `gamification`, `f101` a `f104`) criam apenas 1 inscrição de atividade no banco e clicam em `Credenciar` sem tocar no seletor do Modo monitor, esperando `+50 XP` e vínculo com `registrationId`, enquanto `gamification-services.test.ts` chama `listCheckinQueue` diretamente esperando as linhas brutas da pessoa.

---

## 3. Decisões Técnicas Explicadas

- **Sincronização cliente 0ms via `CHECKIN_CONTEXT_EVENT` + mapas pré-computados por participante:** como `listCheckinQueue` traz no máximo 60 participantes por busca, enviar `openSessionsByContext` e `registrationIdByContext` em cada `QueueEntry` permite que a troca entre `Portaria` e qualquer `Atividade` no `MonitorConsole` atualize instantaneamente o banner de destino, o estado `data-inside` e os botões de todos os 60 cards sem nova viagem ao servidor e sem corrida de transição (`router.replace`) durante leituras rápidas de crachá.
- **`deduplicateByUser: true` opt-in na camada de apresentação (`CheckinQueueSection`):** preserva o retorno bruto de `listCheckinQueue` quando chamada sem a flag em testes de serviço legados, enquanto a tela de credenciamento consolida **1 card por `userId`** ordenado por `user.name ASC`.
- **Resolução contextual em `checkIn` e `checkOut`:** quando acionado com `contextKind = 'ACTIVITY'` e `targetActivityId`, valida a janela da atividade (`canRecordAttendance`), usa a inscrição específica da atividade na 1ª visita (concedendo XP) ou abre sessão direta de `Attendance` para atividades abertas/avulsas/2ª visita. Quando em `contextKind = 'EVENT'`, preserva o `checkIn` clássico na 1ª visita de inscrições ainda não credenciadas e abre sessão de Portaria (`activityId: null`) caso a inscrição de oficina já tivesse sido usada anteriormente.

---

## 4. Registros de Decisão Arquitetural (ADRs)

### ADR-466 — Consolidação de 1 Card por Participante (`deduplicateByUser`) e Ordenação Alfabética na Fila Manual
- **Contexto:** Eventos com 500 participantes inscritos em múltiplas atividades geravam milhares de linhas repetidas para as mesmas pessoas em `CheckinQueue`, ordenadas por data de criação.
- **Decisão:** Adicionar `deduplicateByUser: true` em `listCheckinQueue` para agrupar inscrições por `userId` em ordem alfabética (`user.name ASC`), elegendo a inscrição de evento (`activityId === null`) ou a primeira inscrição ativa como `registrationId` primário e anexando `registeredActivityIds`, `activityTitles`, `registrationIdByContext` e `openSessionsByContext`.
- **Consequências:** Cada participante aparece uma única vez na busca por nome, preservando os seletores `data-testid="queue-<registrationId>"` e o contrato bruto de chamadas legadas sem a flag.

### ADR-467 — Sincronização Instantânea de Contexto (`Portaria` × `Atividade`) entre `MonitorConsole` e `CheckinQueue`
- **Contexto:** Mudar o seletor `"Onde esta leitura vale"` no `Modo monitor` não refletia na coluna `"Sem crachá à mão? Busque pelo nome"`, induzindo o operador a credenciar participantes no local errado.
- **Decisão:** Emitir `CHECKIN_CONTEXT_EVENT` (`'ef:checkin-context'`) no `MonitorConsole`, exibir o banner `queue-context-banner` e selos de vínculo (`Inscrito nesta atividade`, `Atividade aberta do evento`, `Sem inscrição nesta atividade`) no `CheckinQueue`, chavear `<QueueRow key="${registrationId}:${contextKey}">` e enviar `contextKind` + `targetActivityId` nas Server Actions `checkInAction` e `checkOutAction`.
- **Consequências:** O operador enxerga e confirma entradas/saídas exatamente na Portaria ou na Atividade selecionada (aberta ou restrita), com troca em 0ms.

### ADR-468 — Contenção de Scroll Vertical (`max-h-[520px]`) na Fila Manual do Balcão
- **Contexto:** Renderizar até 60 cards em altura livre na coluna direita esticava a página por mais de 4.000px e desalinhava o layout de duas colunas com o `Modo monitor`.
- **Decisão:** Aplicar `max-h-[520px] overflow-y-auto pr-1` em `<ul data-testid="checkin-queue">`, mantendo `scrollIntoView({ block: 'nearest' })` na navegação por teclado (`ArrowDown`/`ArrowUp`).
- **Consequências:** O cabeçalho de busca, os filtros de situação e o `Modo monitor` permanecem sempre visíveis na viewport em eventos com centenas de inscritos.

---

## 5. Lições Aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| Risco de regressão em `gamification-services.test.ts:329` ao deduplicar `listCheckinQueue` | O teste de integração existente cria 2 inscrições para o mesmo usuário e verifica `entries.length >= 2` chamando `listCheckinQueue` sem opções extras | Tornada a consolidação por pessoa explícita via `deduplicateByUser: true` em `CheckinQueueSection`, mantendo o modo bruto quando omitida |
| No seed `ufba-demo`, clicar em `Credenciar` em `Bruno Souza` na Portaria respondia `"já estava credenciado"` sem abrir presença | `Bruno Souza` só possuía inscrição de minicurso com `checkedInAt` preenchido e sessão encerrada; `checkIn` parava em `if (located.checkedInAt)` | Em `checkIn`, quando `contextKind === 'EVENT'` e `located.checkedInAt` já existe, verifica e abre sessão de Portaria (`activityId: null`) se não houver sessão aberta |

---

## 6. Evidência de Verificação

- `npm run lint`: `0` erros, `0` warnings
- `npm run typecheck`: `0` erros
- `npm run build`: compilado com sucesso
- `npm run db:verify` / `npm run db:verify:isolation` / `npm run db:partitions`: `Contrato íntegro.` / `9/9 verificações passaram.`
- `npm test`: `297` arquivos passando (`4938` testes, incluindo `6` novos unitários e `3` de integração da F115)
- `npm run test:e2e`: `564` passando + `1` skip (`565` casos, incluindo o novo cenário E2E em `f115-contexto-sincronizado-balcao.spec.ts`)

---

## 7. Comandos Operacionais

```bash
npm run lint
npm run typecheck
npm test
npm run build
docker compose --profile app up -d --build web worker
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- Nenhuma dívida técnica nova aberta; o quadro permanece em **42 itens abertos** (`docs/dividas-tecnicas.md`).

---

## 9. Checklist de Aceite

- [x] Deduplicação de 1 card por participante em ordem alfabética (`user.name ASC`) na fila manual (`deduplicateByUser: true`).
- [x] Sincronização em tempo real entre `Modo monitor` (`Onde esta leitura vale`) e `CheckinQueue` (`queue-context-banner` e selos de vínculo).
- [x] Registro manual de entrada e saída funcionando tanto na **Portaria do evento** quanto em **Atividades abertas** (ex.: *Cerimônia de abertura*) ou **Atividades com inscrição**.
- [x] Scroll vertical contido (`max-h-[520px] overflow-y-auto`) na lista `checkin-queue` para eventos com 500+ participantes.
- [x] Testes unitários (`6`), integração (`3`) e E2E (`1`) verdes junto com toda a bateria global.
