# FASE 135 — Auditoria UX Onda 1: Criação de Evento, Nova Atividade, Confirmação Progressiva e Grade por Dia

## 1. Sumário executivo

Executa a Onda 1 do plano de auditoria visual e de UX real nas telas de entrada do organizador: simplifica o cadastro de eventos e atividades com geração automática de slug, carga horária calculada automaticamente, modalidade reativa (link online), confirmação de vaga progressiva (1 linha no padrão `AUTO`), grade de programação agrupada por dia e ponte direta de Salas para Programação.

| Entrega | Onde |
|---|---|
| Domínio puro de UX (`slugifyTitle`, `computeDurationMinutes`, `formatWorkloadHuman`, `groupActivitiesByDay`, `summarizeSchedule`) | `src/domain/events/schedule-ux-rules.ts` |
| `EventCreateFields` progressivo em `/administracao/eventos/novo` (Título primeiro, auto-slug, modalidade reativa para `onlineUrl`, avançados em `<details>`) | `src/components/admin/event-create-fields.tsx` · `eventos/novo/page.tsx` |
| `ActivityCreateFields` progressivo em `/administracao/eventos/[id]/programacao/nova` (Título primeiro, auto-slug, auto-carga horária com rótulo humano, atalho para `/salas`) | `src/components/admin/activity-create-fields.tsx` · `programacao/nova/page.tsx` |
| `ConfirmationFields` progressivo: 1 linha quando `AUTO` com JS ativo; revela prazo/local/exigências ao selecionar `REQUIRED` (e tudo aberto sem JS) | `src/components/admin/confirmation-fields.tsx` |
| Grade de programação agrupada cronologicamente por dia com resumo de carga/salas e badges escaneáveis + botão `Ir para a programação` em `/salas` | `programacao/page.tsx` · `salas/page.tsx` |

Números: **5** Vitest unitários/SSR; sem migração de banco.

## 2. O problema mais difícil

Reduzir a sobrecarga cognitiva das telas de cadastro (18 campos planos em Novo Evento; 15 campos vazios de confirmação de vaga em Nova Atividade; `Identificador` manual antes do `Título`) sem quebrar os 7 specs E2E que preenchem `Identificador` antes de `Título` ou selecionam `REQUIRED` em `ConfirmationFields`, e mantendo 100% de funcionalidade sem JavaScript.

## 3. Decisões e ADRs

- **ADR-527 — Auto-slug respeitando edição manual, carga horária derivada do intervalo e agrupamento cronológico da grade.**
  `EventCreateFields` e `ActivityCreateFields` geram `slug` a partir de `Título` apenas enquanto `slugTouched === false` (se um usuário ou teste preencher `Identificador` primeiro, o valor manual é preservado); `workloadMinutes` acompanha `endsAt - startsAt` enquanto `workloadTouched === false`; e `groupActivitiesByDay` + `summarizeSchedule` estruturam `/programacao` por dia no fuso do evento preservando todos os `data-testid` contratuais.
- **ADR-528 — `ConfirmationFields` progressivo (`AUTO` compacto × `REQUIRED` expandido, fallback completo sem JS).**
  Usa `useIsInteractive()` para ocultar prazo, local e as 3 linhas de exigência enquanto `confirmationPolicy === 'AUTO'` no cliente, revelando-os instantaneamente ao escolher `REQUIRED` — eliminando 15 campos vazios da criação de atividades comuns sem alterar nenhum teste E2E nem quebrar o envio sem JavaScript.

## 4. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| `f90-novo-evento-separado.test.ts` e `f91-nova-atividade-separada.test.ts` falharam procurando `data-field="slug"` | Os testes unitários SSR mockam `Field` e `SelectField` de `admin-form.tsx`, e os novos componentes client tinham usado `<Input>`/`<Select>` diretos nos campos controlados | Adicionado suporte opcional a `value`/`onChange` em `Field`/`SelectField` (`admin-form.tsx`) e migrados os campos controlados para usá-los |
| `f69-rotulos-de-modalidade.test.ts` apontou que `eventos/novo/page.tsx` e `programacao/nova/page.tsx` não tinham mais `options={EVENT_MODALITY_OPTIONS}` diretamente | Os dois formulários passaram a delegar para `EventCreateFields` e `ActivityCreateFields` | Atualizados os dois caminhos delegados na catraca `f69` para os novos componentes (que continuam usando a fonte única `EVENT_MODALITY_OPTIONS`) |

## 5. Evidência de verificação

- `npm run lint` — **0 erros, 0 warnings**
- `npx tsc --noEmit --noUnusedLocals` — **0 erros**
- `npm test` — **5060 testes (322 arquivos)** verdes (5057/5060 na rodada completa + `f69`, `f90`, `f91` e `f135` revalidados **27/27 em 3.23s**)
- `docker compose --profile app up -d --build web` — `next build` concluído no container em **47.2s** e `eventflow-web` recriado e `healthy`
- `npm run db:verify` — **Contrato íntegro.**
- `npm run db:verify:isolation` — **9/9 verificações passaram.**
- `npm run db:partitions` — partições mensais em dia (`todas as partições do intervalo já existiam`)
- `npx playwright test` (`f90-novo-evento-separado`, `f91-nova-atividade-separada`, `registration-confirmation`, `room-lifecycle`) — **11/11 passando em 23.0s** contra `eventflow-web` atualizado
- `AGENTS.md` — **63.128 bytes** (abaixo do teto de `64.800` bytes; FASE 117 movida para `docs/fases-historico.md`)

## 6. Comandos

```bash
npx vitest run tests/unit/f135-ux-onda1-eventos-e-programacao.test.ts
```

## 7. Checklist de aceite

- [x] `Título` primeiro + auto-geração de `slug` em Novo Evento e Nova Atividade
- [x] `onlineUrl` reativo ao selecionar Online/Híbrido na criação de evento e atividade
- [x] Carga horária recalculada automaticamente em Nova Atividade + atalho para `/salas` quando vazio
- [x] `ConfirmationFields` compacto em `AUTO` e expansível em `REQUIRED` (fallback completo sem JS)
- [x] Programação agrupada por dia com resumo + ponte `Ir para a programação` em `/salas`
