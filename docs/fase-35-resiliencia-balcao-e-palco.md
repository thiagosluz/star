# FASE 35 — Resiliência de Balcão e Palco

> **Escopo definido pelo humano.**
> *"preciso de umas modificações.*
> ***Credenciamento Offline-First (IndexedDB)**: Criação de uma fila de leituras de QR Codes persistida localmente no navegador dos monitores para permitir o credenciamento mesmo quando o wi-fi ou o sinal de telefonia do pavilhão oscilarem, sincronizando os dados de forma idempotente assim que a conexão retornar.*
> ***Controle Estrito de Modos no Balcão**: Seletor explícito de sentido de leitura na interface do monitor (Somente Entrada / Somente Saída / Alternado) para evitar que bipes duplos ou leituras em rajada fechem indevidamente o credenciamento do participante.*
> ***Edição e Ajustes Dinâmicos de Anúncios no Telão**: Permitir a correção imediata de textos de prêmios/patrocinadores pela interface e incluir botões para reexecutar ou pausar a animação da roleta do sorteio durante a apresentação ao vivo"*

---

## 1. Sumário executivo

O pavilhão de um evento presencial e o palco de um auditório são os dois ambientes de maior estresse operacional de uma conferência. No balcão de credenciamento, a internet oscila devido ao congestionamento de rádio em grandes aglomerações e leitores de código de barras podem disparar bipes duplos em rajada, encerrando acidentalmente a presença de um participante recém-chegado. No palco, o apresentador pode precisar corrigir no calor do momento o nome de um prêmio oferecido por um patrocinador de última hora ou pausar/repetir a animação da roleta de sorteio para sincronizar o suspense com os microfones da transmissão.

A **FASE 35** entrega uma camada robusta de resiliência e controle operacional para ambos os cenários, eliminando 4 dívidas técnicas prioritárias (**E40, E43, E38, E39**), mantendo 100% da integridade criptográfica e auditoria da plataforma sem concessões de segurança.

### Entregas

| Entrega | Onde |
|---|---|
| **Fila Local Offline-First (IndexedDB)**: store `credential_scans` em IndexedDB assíncrono com índice multi-tenant, ordenação cronológica FIFO e chave de idempotência `idempotencyKey` | `src/lib/offline/credential-offline-queue.ts` |
| **Hook Reativo de Conectividade e Sincronização**: detecção online/offline, auto-sync periódico com backoff, monitoramento de pendências e expurgo automático | `src/components/credentials/use-offline-queue.ts` |
| **Idempotência no Servidor e Preservação de Timestamp**: aceitação de `readAt` físico da leitura e deduplication via `Attendance.qrNonce` | `src/lib/events/attendance-service.ts`, `src/lib/events/credential-service.ts` |
| **Action de Sincronização em Lote**: Server Action com processamento em lote para drenar a fila local | `src/app/actions/credential-actions.ts` |
| **Controle Estrito de Sentidos no Balcão**: Seletor com 3 modos (`Somente Entrada (IN)`, `Alternado (TOGGLE)`, `Somente Saída (OUT)`), persistência no `localStorage`, badge de status da conexão e feedback de fila | `src/components/credentials/monitor-console.tsx` |
| **Edição Desacoplada de Anúncios de Rodada**: Serviço e action `updateRoundAnnouncement` com auditoria detalhada `RAFFLE_ROUND_ANNOUNCEMENT_UPDATED` sem violar hashes criptográficos assinados | `src/lib/raffles/raffle-service.ts`, `src/app/actions/raffle-actions.ts` |
| **Reatividade SSE para Anúncios no Telão**: inclusão do prêmio na assinatura hash da rota `/ao-vivo`, transmitindo alterações instantaneamente ao palco | `src/app/api/t/[tenantSlug]/eventos/[eventSlug]/sorteios/[raffleId]/ao-vivo/route.ts` |
| **Formulário Inline no Painel Administrativo de Sorteios**: Edição imediata de prêmio, patrocinador e descrição em rodadas preparadas e apuradas | `src/components/raffles/raffle-history.tsx`, `src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/sorteios/page.tsx` |
| **Controle Interativo da Roleta no Palco**: Botões de Pausar/Continuar (`stage-pause-roleta`/`stage-resume-roleta`), Repetir Animação (`stage-replay-roleta`) e atalhos de teclado (`Espaço` e `R`) | `src/components/raffles/raffle-stage.tsx` |

### Números da fase

| Métrica | Valor |
|---|---|
| Arquivos novos | **2** de código (`src/lib/offline/credential-offline-queue.ts`, `src/components/credentials/use-offline-queue.ts`), **1** de teste (`tests/unit/offline-queue.test.ts`) + este documento |
| Arquivos alterados | **9** de código e teste (`attendance-service.ts`, `credential-service.ts`, `credential-actions.ts`, `monitor-console.tsx`, `raffle-service.ts`, `raffle-actions.ts`, `/ao-vivo/route.ts`, `raffle-stage.tsx`, `raffle-history.tsx`, `credential-service.test.ts`, `raffle-rounds.test.ts`) |
| Migrações | **0** novas (reaproveitamento da coluna indexada `Attendance.qrNonce` para `idempotencyKey`) |
| Testes novos | **13** testes passando (8 unitários + 5 de integração) — a suíte passou de **1759** para **1772** testes no Vitest |
| Qualidade | ESLint **0** erros / **0** warnings · tsc **0** erros · build Next.js **OK** |
| Dívidas técnicas quitadas | **4** dívidas quitadas: **E40**, **E43**, **E38** e **E39** |

---

## 2. O problema mais difícil da fase e por que ele define o desenho

O problema mais difícil foi a **sincronização assíncrona com reconciliação cronológica sob falha de rede sem criar sessões duplicadas ou fantasmas**.

Em credenciamento presencial, os fatos acontecem no relógio do mundo real: um participante bipou na portaria às 08:02 e entrou na sala às 08:15. Se a rede do pavilhão estiver fora do ar entre 08:00 e 08:30:
1. Se as leituras fossem processadas com `new Date()` no momento do recebimento do sync pelo servidor, a entrada física às 08:02 seria gravada como 08:31, encurtando indevidamente a presença auditável e afetando a elegibilidade do participante a sorteios por tempo e certificados.
2. Se a rede oscilar durante a transmissão de um lote de 50 leituras e a resposta HTTP cair após a gravação no banco, o navegador do monitor tentará reenviar a mesma fila na próxima janela de reconexão. Sem uma chave de idempotência determinística vinculada à leitura original, esse reenvio tentaria abrir uma segunda presença ou inverter o sentido (no modo TOGGLE), fechando imediatamente o credenciamento de quem acabou de chegar.

A solução foi estruturar o objeto de leitura no IndexedDB com o carimbo temporal original `readAt` e derivar deterministicamente a chave:
```text
idempotencyKey = `${eventId}:${code}:${context}:${readAt}`
```
No backend, o predicado atômico confere se já existe um registro em `Attendance` com esse `qrNonce`. Existindo, o servidor devolve confirmação de sucesso com aviso de idempotência, sem criar linhas adicionais nem fechar sessões abertas. Quando a leitura é nova, `Attendance.checkedInAt` grava o exato `readAt` físico capturado pelo monitor.

---

## 3. Decisões técnicas explicadas

### 3.1 IndexedDB vs localStorage vs Service Worker Background Sync
- **Alternativa descartada (localStorage)**: O `localStorage` tem limite rígido de ~5 MB, é totalmente síncrono (bloqueia a thread de renderização a cada gravação de QR Code, travando o scanner de vídeo) e não oferece suporte a índices estruturados.
- **Alternativa descartada (Background Sync API via Service Worker)**: O Background Sync tem suporte restrito (ausente no Safari iOS, que é comum em tablets usados por monitores em eventos).
- **Decisão adotada (IndexedDB puro)**: O IndexedDB é assíncrono, suporta dezenas de milhares de registros sem degradação e funciona em todos os navegadores modernos (Chrome, Firefox, Safari iOS/macOS, Edge). A fila implementa índices por `(tenantSlug, eventId, status)` e `readAt`.

### 3.2 Seletor Estrito de Modos no Balcão
- No modo `TOGGLE`, bipes duplos rápidos causavam o encerramento indevido da visita.
- No modo `IN`, a leitura de quem já está dentro retorna `ALREADY_INSIDE` e preserva a sessão aberta.
- No modo `OUT`, a leitura de quem não possui entrada aberta retorna `NOT_INSIDE` com aviso em tela, prevenindo a criação de sessões com minutos negativos ou fantasmas.
- A preferência de modo é guardada no `localStorage` por evento (`eventflow_monitor_mode_${eventId}`) para que o monitor não perca sua configuração caso a aba recarregue.

### 3.3 Edição Desacoplada de Anúncio e Reatividade no Telão
- O prêmio e o patrocinador são dados de **anúncio** e residem fora do compromisso criptográfico de semente e do hash assinado do resultado (ADR-145).
- A nova função `updateRoundAnnouncement` permite a retificação do texto tanto em rodadas preparadas quanto já apuradas, gerando trilha de auditoria (`RAFFLE_ROUND_ANNOUNCEMENT_UPDATED`).
- A rota `/ao-vivo` incorporou o título do prêmio na assinatura hash da rodada (`signatureOf`), permitindo que a conexão Server-Sent Events (SSE) notifique imediatamente o telão sem necessidade de refresh manual.

### 3.4 Controles Interativos da Roleta no Palco
- O componente `RaffleStage` agora desacopla a rotação visual da apuração criptográfica, permitindo pausar e continuar (`isPausedRef`) para criar suspense com o público ou aguardar a fala no palco.
- O botão "Repetir animação da roleta" (`stage-replay-roleta`) permite reexecutar a roleta para a mesma rodada apurada de forma determinística sobre a lista publicada de nomes reais.
- Atalhos de teclado ergonômicos (`Espaço` e `R`) permitem operação remota por apresentadores via passadores de slides ou teclado sem fio.

---

## 4. ADRs (Architectural Decision Records)

### ADR-179: Fila local em IndexedDB com sincronização idempotente cronológica
- **Contexto**: A rede Wi-Fi e 4G/5G em pavilhões de eventos sofre frequentes quedas e saturação. Leituras perdidas paralisam as filas de credenciamento e impedem a comprovação de horário de chegada.
- **Decisão**: Criar um banco IndexedDB local (`eventflow_offline_v1`) no navegador do monitor com tabela `credential_scans`. Leituras capturadas sem rede ou com erro de conexão são enfileiradas com status `PENDING`, carimbo `readAt` e chave única `idempotencyKey`. Um hook com listener de rede e timer sincroniza o lote em ordem FIFO tão logo o sinal retorne, reutilizando `Attendance.qrNonce` para garantir idempotência contra reenvios.
- **Consequências**: Operação ininterrupta do balcão sem dependência de conectividade constante; garantia de que instantes de chegada não sejam adulterados por atrasos de sincronização.

### ADR-180: Seletor estrito de sentido no balcão e contenção de bipes em rajada
- **Contexto**: Leitores de código de barras e câmeras de alta taxa de quadros podem emitir múltiplos bipes em frações de segundo. No modo alternado (`TOGGLE`), o segundo bipe fecha a sessão que o primeiro acabou de abrir.
- **Decisão**: Implementar seletor explícito de sentido no topo do console do monitor com 3 modos: `IN` (somente entrada), `TOGGLE` (alternado) e `OUT` (somente saída). O modo `IN` trata bipes repetidos com `ALREADY_INSIDE`, recusando fechar a sessão. O modo `OUT` trata leituras sem sessão com `NOT_INSIDE`.
- **Consequências**: Fim dos encerramentos acidentais de presença; eliminação da dívida E43; facilidade para postos dedicados (ex.: catracas exclusivas de entrada ou saída).

### ADR-181: Edição desacoplada de anúncios de rodada com reatividade SSE
- **Contexto**: Correções de grafia de prêmios ou ajustes no patrocinador de uma rodada de sorteio não podiam ser feitos pela interface sem intervenção direta no banco de dados, pois a entidade era imutável pós-criação.
- **Decisão**: Criar o serviço `updateRoundAnnouncement` com auditoria dedicada. Como o texto do prêmio não compõe o hash assinado da rodada (ADR-145), a alteração é segura. A rota SSE `/ao-vivo` passa a incluir o prêmio em sua assinatura de mudança, propagando as edições ao telão instantaneamente.
- **Consequências**: Eliminação da dívida E38; flexibilidade para operadores de palco; telão e histórico mantêm consistência em tempo real.

### ADR-182: Controle interativo de palco para a roleta do sorteio (pausa e replay)
- **Contexto**: A roleta do sorteio rodava por 3 segundos fixos sem possibilidade de intervenção do mestre de cerimônias. Falhas no projetor ou pausas no roteiro deixavam a plateia sem a animação do anúncio.
- **Decisão**: Adicionar controle de estado de animação (`isPaused`, `replayRoulette`) no componente `RaffleStage`. O loop de desaceleração preserva o passo e delay atuais na pausa. O replay reinicia a animação sobre os nomes reais da lista publicada daquela rodada, encerrando no ganhador assinado. Atalhos `Espaço` e `KeyR` são interceptados com salvaguarda para campos de entrada.
- **Consequências**: Eliminação da dívida E39; apresentação visual refinada e controlável para eventos de grande porte.

---

## 5. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `react-hooks/set-state-in-effect` acusado pelo ESLint em `monitor-console.tsx` e `use-offline-queue.ts` | Chamadas síncronas a `setMode` e `setIsOnline` dentro de `useEffect` para sincronizar com `localStorage` e `navigator.onLine` | Substituição por inicializadores preguiçosos de estado (`useState(() => ...)`) que leem os recursos do navegador na montagem sem disparar render em cascata |
| `RangeError: Invalid time value` no teste de expurgo da fila offline | Passagem de milissegundos (`7 * 24 * 60 * 60 * 1000`) para a função `pruneSyncedScans(olderThanDays = 3)` que esperava o número de dias | Ajuste no teste para passar o valor escalar em dias (`7`) |
| `TypeError: Cannot read properties of undefined (reading 'target')` na iteração do cursor no mock do IndexedDB | O mock disparava `req.onsuccess?.()` sem argumentos, enquanto a implementação real do IndexedDB passa um evento com `event.target === req` | Configuração do mock para injetar o objeto de evento `{ target: req }` nas chamadas de sucesso do cursor |

---

## 6. Evidência de verificação

Saída real dos comandos executados no ambiente:

```text
> npm run typecheck
✓ tsc --noEmit (0 erros)

> npm run lint
✓ eslint . (0 erros, 0 warnings)

> npx vitest run tests/unit/offline-queue.test.ts
✓ tests/unit/offline-queue.test.ts (8 tests) 390ms

> npx vitest run tests/integration/raffle-rounds.test.ts
✓ tests/integration/raffle-rounds.test.ts (16 tests) 1020ms

> npx vitest run tests/integration/credential-service.test.ts
✓ tests/integration/credential-service.test.ts (29 tests) 3053ms

> npm test
Test Files  74 passed (74)
Tests       1772 passed (1772)
Duration    67.53s
```

---

## 7. Comandos operacionais

```bash
# Executar a suíte de testes completa
npm test

# Executar apenas testes da Fase 35
npx vitest run tests/unit/offline-queue.test.ts tests/integration/raffle-rounds.test.ts tests/integration/credential-service.test.ts

# Verificação de lint e tipos
npm run lint
npm run typecheck

# Build de produção
npm run build
```

---

## 8. Dívidas técnicas

### Dívidas quitadas nesta fase
- **E40**: Credenciamento Offline-First em IndexedDB com fila local persistida e sincronização idempotente cronológica.
- **E43**: Controle estrito de sentidos de leitura no balcão do monitor (`IN`, `TOGGLE`, `OUT`) com contenção de bipes em rajada e duplos.
- **E38**: Edição desacoplada de anúncios de rodada mantendo a integridade auditável do hash assinado e reatividade SSE.
- **E39**: Controles dinâmicos de palco na roleta do sorteio (Pausar/Continuar, Repetir animação e atalhos de teclado).

---

## 9. Checklist de aceite

- [x] Fila IndexedDB `credential_scans` implementada e testada com ordenação FIFO.
- [x] Hook `useOfflineQueue` gerenciando estados de conectividade e sincronização automática.
- [x] Idempotência de sincronização no backend garantida por `Attendance.qrNonce`.
- [x] Preservação do carimbo físico `readAt` na presença gravada.
- [x] Seletor de sentidos no monitor console (`IN`, `TOGGLE`, `OUT`) com persistência no `localStorage`.
- [x] Modo `IN` imune a bipes duplos/rajada (retorna `ALREADY_INSIDE` sem fechar sessão).
- [x] Modo `OUT` imune a leituras sem entrada (retorna `NOT_INSIDE` sem criar sessão).
- [x] Edição de prêmio e patrocinador de rodada preparada e apurada pela interface (`updateRoundAnnouncement`).
- [x] Atualização de anúncio refletida em tempo real no telão via SSE (`signatureOf`).
- [x] Controles de Pausa/Retomada e Repetir na roleta do palco com botões e atalhos de teclado.
- [x] Bateria de testes de unidade e integração aprovada com 1772 testes passando.
- [x] ESLint 0 erros e TypeScript 0 erros.
