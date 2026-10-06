# FASE 69 — mutirão dos pequenos (PLANO)

> **Estado: ENTREGUE.** O documento final é `docs/fase-69-mutirao-dos-pequenos.md`, com as
> 9 seções, os ADR-344/345/346 e os números medidos. Este arquivo fica como o PLANO que
> originou a fase (as quatro fatias paralelas e o estado de cada uma durante a execução).

## O que esta fase quita

| Dívida | O que é (resumo real da tabela) | Onde ela vive |
|---|---|---|
| **E86** | O choque de horário não considera a **margem de deslocamento entre salas** — a régua é `intervalsOverlap` sobre o intervalo puro | `src/domain/agenda/overlap-rules.ts`, `agenda-rules.ts` (regra pura) + o aviso na tela (`agenda-clash-notice.tsx`) |
| **E82** | O **ranking de revisores cita quem foi ocultado** | `getReviewerRanking` (`src/lib/gamification/achievement-service.ts:232`) — deve passar pela fonte única da ocultação (F60/E79) |
| **E83** | A **espera por GESTO** em cenários vizinhos: aperta a tecla uma vez e repete só a asserção | `tests/e2e/certificate-template.spec.ts:433-446`, `tests/e2e/f51-credential-badge.spec.ts` |
| **E88** | O **descadastro não pergunta o motivo** — a coluna `reason` existe e só é gravada no caminho `MANUAL` | a página de descadastro da F67 + `unsubscribe-service.ts` |
| **E84** (só a página do EVENTO) | O **claro/escuro do visitante não vence a paleta do organizador** ali. Medido na F66: **2,10:1** no fundo e **1,86:1** no cartão | o tema do evento (`theme-scope.tsx`, `event-theme.css`) — a F64 resolveu o mesmo na página da INSTITUIÇÃO (republish dos papéis semânticos) |

## Os quatro pontos de atenção da F68 (não são dívidas, são o que ficou aberto)

1. **`prisma/seed.ts`**: o evento de demonstração que publica chamadas deve nascer com `usesCall: true` (hoje o dado é `false` porque foi semeado antes da fase).
2. **`VenueBlock` sem linha de base visual** — `?aba=agora` não renderiza blocos, então prendê-lo exige **criar** uma captura.
3. **Rótulos de modalidade duplicados** em quatro telas (`eventos/page.tsx:25-29`, `dados/page.tsx:14-18`, `programacao/page.tsx:43`) e o mapa "ONLINE→'Online'" em três componentes → **fonte única no domínio**.
4. **O endereço da sala online não aparece na "minha agenda"** do participante — é um dos lugares em que ele é mais útil; usar a MESMA régua (`registrationSeesOnlineRoom`) e provar no E2E que anônimo e lista de espera não veem.

## Fatias

| # | Fatia | Entrega |
|---|---|---|
| 1 | **E86** | A margem vira parâmetro da regra pura (padrão declarado e justificado), com prova dos DOIS lados (com margem é choque × sem margem não é), o texto do aviso dizendo que há margem, e a dívida quitada |
| 2 | **E82** | O ranking passa pela fonte única da ocultação, com catraca provada por mutação (esconder a pessoa tira o nome do ranking) |
| 3 | **E84 (página do evento)** | O claro/escuro do visitante vence a paleta do organizador na página do EVENTO, com o par **medido nos dois modos** e preso por catraca; a régua é a que a F64 usou na página da instituição |
| 4 | **E88 + E83** | O motivo no descadastro (campo + gravação + E2E, reaproveitando a coluna existente) e a espera por gesto corrigida nos cenários vizinhos (mecânica, declarada) |
| 5 | **Os quatro da F68** | `seed.ts`, a linha de base do `VenueBlock`, a fonte única dos rótulos de modalidade e o endereço na "minha agenda" |
| 6 | **Catracas, documento e estado** | Bateria da §4, `docs/fase-69-*.md` (ADR-344+), README/AGENTS/dívidas (**quitando E86, E82, E83, E88 e E84 por inteiro**) e o **teto real do `AGENTS.md` = 65.244 bytes** escrito como regra (descoberto na F68: o harness truncou em 65.244 e apagou uma linha de fase por engano) |

## Invariantes

- **Nada de afrouxar critério**: dívida de acessibilidade se conserta **pela causa** e o par entra na catraca.
- **O que se oculta fica oculto**: nome de quem ocultou o perfil não sai por nenhuma superfície nova.
- **Regra pura continua pura**: E86 é domínio, sem Prisma, sem Next, sem relógio.
- **Sem `any`**, `kebab-case.ts`, erros como valor, comentários explicam **POR QUE**, tudo em português.
- **Nenhuma isenção nova** no portão WCAG AA; catraca nova só vale **provada por mutação**.
- Bateria da §4 com os **números reais**; vermelho só é vermelho depois de **rodado isolado** (imagem velha do container e carga já produziram falso vermelho aqui).
- **O `AGENTS.md` não pode passar de ~64.800 bytes** (o teto real é 65.244 e o corte apaga conteúdo em silêncio).

## Estado das fatias (atualizado durante a execução)

- **Fatia 1 — E86 ENTREGUE**: padrão **15 minutos** declarado no domínio (`ROOM_TRAVEL_MARGIN_MINUTES`,
  `src/domain/agenda/overlap-rules.ts:201`), regra nova `intervalsClash(a,b,margin)` /
  `findClashPairs(...,margin)` com `<` estrito, **margem 0 ≡ a régua da F65** (preso em 9 pares); prova
  dos dois lados (17 casos) + tela (18) + E2E com cenário novo; três testes da F65 mudaram (a fixture
  emendada partida em dois, o default 0 do helper, a asserção do texto) — **declarados**; suíte completa
  **3460 testes passando** naquele momento. Padrão a confirmar pelo humano.
- **Fatia 2 — E82 ENTREGUE**: `getReviewerRanking` passou a ler o nome por `leaderboardIdentity`
  (`src/domain/gamification/leaderboard-rules.ts:103`, a mesma régua do ranking de XP), mascarando e
  **preservando posição/contagem/elegibilidade**, na lista E no painel de premiação; **mascarar DEPOIS
  de ordenar** (antes, `Ana Souza` e `Ana Silva` colidiriam e o prêmio cairia na ordem do banco);
  mutação provada (5 falhas / 5 passes). Aberto declarado: `/comite/<submissionId>` ainda nomeia o
  revisor atribuído (tela de trabalho — decisão, não dívida).
- **Fatias 3 (E84) e 4 (E88+E83)** — em andamento quando esta nota foi escrita. A fatia 4 avisou que as
  opções de motivo mudam os pixels da linha de base `descadastro.png` (teste 21) e que **regenerar é do
  fechamento**.
- **Fatia 5 — MORREU sem escrever nada** (conferido na árvore: sem `usesCall` no seed, sem fonte única de
  modalidade, sem `onlineUrl` em `agenda-service.ts`). Absorvida pela fatia 6.
- **Fatia 6 (fechamento)** — em andamento: os quatro pontos da F68, a linha de base do `VenueBlock`, a
  regeneração do `descadastro.png` **depois de medir**, o portão, a bateria, o documento (ADR-344+) e o
  estado. **Tem de apagar dois resíduos**: `.f69-fatia1-relatorio.md` (raiz, criado pela fatia 1) e
  `tests/e2e/tmp-f69-medicao-contraste.spec.ts` (sonda da fatia 3).
- **A árvore ficou temporariamente quebrada** durante a fatia 5/6: `agenda-service.ts` não devolvia
  `onlineRooms`/`eventOnlineUrl` que a interface já exigia (`TS2322`). Quem retomar, **rode o typecheck
  primeiro**.
