# FASE 75 — o refactor que mede antes (PLANO)

> **Estado: PLANO APROVADO pelo humano.** Pronto para executar.

## Decisões do humano

1. **As 17, com os testes antes** — o par permitido × recusado das 21 guardas é a rede; migram só as 17
   que cabem em `TENANT + 1 permissão + principal`; as **4 exceções** ficam locais **de propósito** e
   declaradas (2 sem permissão, 1 com OU de permissões, 1 com `holdsPermission` sem alvo); catraca
   impede guarda local nova fora delas.
2. **Só a leitura, com a escrita intacta** — ≈1.064 linhas do raffle e ≈330 do registration saem para
   serviços irmãos (o precedente é `registration-response-service.ts`); os blocos de escrita **não** se
   separam, porque dividem **uma** transação — e há um teste por bloco crítico provando que continua
   atômico.
3. **O contexto duplicado** — o ganho de performance é este, não o esqueleto: `getRequestContext` roda
   duas vezes por render no evento, na administração e em participantes. Medir, ler o motivo do "de
   propósito" em `session.ts:300` e fazer a guarda de página **devolver o contexto**.
4. **As páginas de erro entram** — `error.tsx` e `not-found.tsx` por área (hoje são **0** no app:
   `notFound()` cai na página padrão do Next e um erro de rota sobe para o `global-error`). **Os
   esqueletos ficam de fora**: em rota de 27–57 ms eles produzem flash e quebram o `f62` (diff 0).

## As três propostas do revisor externo, e o que a medição diz

| Proposta | O que o revisor disse | O que foi medido |
|---|---|---|
| Unificar as guardas | "17 `async function guard`; ~1.500 linhas a menos" | **21** guardas locais; as **17** que chamam `can()` somam **872 linhas**; o universo real é **1.033**; a redução de 1.500 **não existe** |
| Fracionar os dois serviços | "subserviços de regras puras + persistência" | As **regras já estão no domínio** (`raffle-rules` 882, `draw-selection`, `pool-rules`, `round-rules`); o que resta é **leitura: ≈1.064 linhas** (raffle) e **≈330** (inscrições) |
| `loading.tsx` nas rotas de métricas | "melhora o Time to Interactive" | Essas rotas levam **27–57 ms**; esqueleto = flash; e **`loading.tsx` não muda TTI** (muda percepção) |

## O que a fase faz — e por que nesta ordem

### Fatia 1 — a rede antes do salto (a mais importante)
**19 das 21 guardas não têm teste de comportamento** (só E2E de caminho feliz). Migrar sem isso é
refactor cego que pode **ampliar acesso**. A fatia escreve, por guarda, o par **permitido × recusado**
(a recusa com o código da casa), no padrão de `f74-posse-do-upload` — e esse é o contrato que a
fatia 2 tem de preservar.

### Fatia 2 — unificar as 17, com as 4 exceções declaradas
Migrar só as que cabem em `TENANT + 1 permissão + principal` (o `guardAction` já resolve `:own`
sozinho). **Ficam de fora, de propósito e com o motivo escrito**:
- `sponsor-portal.guardAuthenticated` e `guardSession` — **não têm permissão** (sessão + vínculo);
- `demand-actions` — **OU de permissões** (`demand:assign` × `demand:assign:own-team`);
- `speaker-actions.speakerGuard` — `holdsPermission` **sem alvo** (papel concedido **por atividade**;
  `can` com escopo TENANT recusaria o caso normal).

**Catraca**: nenhum `async function guard*` novo fora destas 4 exceções (a lista é a exceção explícita).

### Fatia 3 — fracionar só a leitura
Extrair de `raffle-service.ts` e `registration-service.ts` **apenas leitura e helpers puros**
(≈1.394 linhas), no precedente de `registration-response-service.ts` (F70) e `registration-notices.ts`.
**Os blocos de escrita ficam onde estão**, porque compartilham UMA transação: `createRaffle`,
`prepareRound`, `drawRound`, `markPrizeDelivered`/reverse, `cancelRaffle`; e `attemptRegistration`,
`tryReserveSeat` (SAVEPOINT **dentro do tx do chamador**), `admitToEventRegistration`,
**`cancelRegistration` (status + contador + promoção na MESMA transação — ADR-175/178)**,
`updateEventRegistrationData`, `syncOpenActivityEnrollments`, `acceptPromotion`, e os
`promoteNextFrom*`/`reindexWaitlist`/`enrollEventRegistrationInOpenActivities`, que **recebem `tx`**.
**Catraca**: a lista das funções que não podem ganhar transação própria, e um teste por bloco crítico
provando que a escrita continua atômica.

### Fatia 4 — o ganho real de performance (o que a proposta 3 achou sem querer)
`getRequestContext` **não é memoizado** e as páginas chamam `requirePagePermission` **e**
`getRequestContext` → **memberships + principal duas vezes por render** no evento, na administração e
em participantes; o layout `(app)` soma `lookupTenant`, `loadPrincipal` e dois checks de convite.
**Medir, ler o motivo** de o contexto não ser `cache()` (há um "de propósito" em `session.ts:300`) e
**fazer a guarda de página devolver o contexto** (uma leitura, duas necessidades) — sem cache novo se
o motivo for bom.

### Fatia 5 — esqueleto só onde houver espera medida [DECIDIR]
Se entrar: **só** rota comprovadamente lenta (volume real, não seed), com `aria-busy`, respeito a
`prefers-reduced-motion`, e **sem** quebrar o `f62` (o snapshot captura o esqueleto). Fora isso,
**não entra** — e o `error.tsx`/`not-found.tsx` ausentes em todo o app viram **dívida declarada**
(0 arquivos hoje).

## Invariantes

- **A guarda autoriza a PESSOA; a posse do ALVO é do serviço** (a lição da F74). Unificar não pode
  borrar essa linha — e `:own` continua exigindo `ownerId`.
- **Decompor por pureza, nunca por tamanho de arquivo** — e **jamais** separar o que divide uma
  transação.
- **Nada de esqueleto em rota de 30 ms**: o que melhora percepção em cima de espera inexistente
  piora.
- **Refactor sem teste é aposta**: cada fatia entrega a rede antes do movimento.
- Bateria da §4 e `f62` **medidos** (o anonimato byte-idêntico não substitui a medição).
