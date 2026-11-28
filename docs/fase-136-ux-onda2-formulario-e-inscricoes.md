# FASE 136 — Auditoria UX Onda 2 (Formulário Progressivo, Presets, Minhas Inscrições e Confirmações)

> **Escopo:** Reduzir a carga cognitiva na configuração do formulário de inscrição do evento (revelação progressiva por tipo + 5 presets seguros em 1 clique + atalho para ver a página pública de inscrição), dar leitura visual imediata de situação em `/minhas-inscricoes` e corrigir o link quebrado no estado vazio da fila de confirmações.

---

## 1. Sumário executivo

| Entrega | Arquivo(s) | Resultado |
|---|---|---|
| Domínio puro da Onda 2 | [`src/domain/events/registration-ux-rules.ts`](../src/domain/events/registration-ux-rules.ts) | `REGISTRATION_FIELD_PRESETS` (5 presets seguros), `fieldControlsForType`, `summarizeMyRegistrations`, `registrationStatusTone` |
| Editor progressivo de campos | [`src/components/admin/registration-form-editor.tsx`](../src/components/admin/registration-form-editor.tsx) | Mostra só os controles do tipo selecionado + chips de preset em 1 clique quando JS ativo; preserva fallback No-JS completo no SSR |
| Atalho para página pública | [`src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/formulario/page.tsx`](../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/formulario/page.tsx) | Botão **"Ver página de inscrição"** (`registration-form-view-public`) no `PageHeader` |
| Resumo e badges semânticos | [`src/app/t/[tenantSlug]/(app)/minhas-inscricoes/page.tsx`](../src/app/t/[tenantSlug]/(app)/minhas-inscricoes/page.tsx) | Faixa `my-registrations-summary` + tons semânticos (`success`/`warning`/`info`/`neutral`) em `registration-status` |
| Correção de link no estado vazio | [`src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/confirmacoes/page.tsx`](../src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/confirmacoes/page.tsx) | Botão do estado vazio agora aponta para `/administracao/eventos/${eventId}/programacao` |
| Testes unitários + SSR | [`tests/unit/f136-ux-onda2-formulario-e-inscricoes.test.ts`](../tests/unit/f136-ux-onda2-formulario-e-inscricoes.test.ts) | 4 novos casos cobrindo presets, visibilidade por tipo, resumo/tons e SSR No-JS |

**Números da fase:** 1 módulo de domínio novo · 4 arquivos de UI atualizados · 1 arquivo de teste novo (+4 testes) · 0 migrações · 2 ADRs (`ADR-529`, `ADR-530`).

---

## 2. O problema mais difícil e decisões técnicas

As capturas reais da tela `/administracao/eventos/<id>/formulario` expuseram dois atritos imediatos para organizadores leigos:
1. O formulário de **"Novo campo"** exibia simultaneamente `Limite de caracteres`, `Valor mínimo`, `Valor máximo`, `Opções da escolha única` e `Finalidade do dado` mesmo quando o tipo selecionado era `Texto curto` — forçando o usuário a ler cinco explicações do tipo *"Só para o tipo Número..."* ou *"Só para o tipo Escolha única..."*.
2. Criar perguntas clássicas de evento (Instituição, Curso/área, Tamanho da camiseta, Restrição alimentar, Como soube) exigia preencher manualmente rótulo, tipo, ajuda e opções a cada vez.

No lado do participante, `/minhas-inscricoes` renderizava todas as situações (`Confirmada`, `Presença registrada`, `Aguardando confirmação`, `Lista de espera`) com o mesmo badge neutro cinza, sem um resumo rápido no topo. E na fila de `/confirmacoes`, quando nenhuma atividade exigia confirmação, o botão **"Configurar na programação"** apontava para o resumo do evento em vez de `/programacao`.

### Alternativas descartadas
- **Ocultar controles via CSS fixo no SSR:** quebraria navegadores sem JavaScript (contrato No-JS da F70). Em vez disso, `useIsInteractive()` mantém todos os controles presentes no HTML inicial do servidor e ativa a revelação progressiva após hidratação.
- **Presets que salvam direto no banco sem revisão:** reduziria a transparência sobre o aviso LGPD e sobre os textos exibidos ao participante. Os chips apenas preenchem o formulário de novo campo para o organizador revisar e clicar em **"Acrescentar campo"**.

---

## 3. ADRs

### ADR-529 — Revelação progressiva e presets de 1 clique em `RegistrationFieldForm`
- **Contexto:** O formulário de criação/edição de campos de inscrição mostrava controles incompatíveis com o tipo selecionado (`min`/`max`, `options`, `maxLength`), gerando ruído visual.
- **Decisão:** Centralizar em `src/domain/events/registration-ux-rules.ts` a matriz pura `fieldControlsForType(type)` e os 5 presets seguros `REGISTRATION_FIELD_PRESETS`. Em `RegistrationFieldForm`, aplicar a visibilidade progressiva e exibir os chips de preset somente após hidratação (`useIsInteractive()`), preservando o fallback completo No-JS no SSR.
- **Consequências:** Organizadores veem apenas os campos pertinentes ao tipo escolhido e podem montar perguntas comuns em 1 clique sem violar a política anti-dados-sensíveis nem o contrato No-JS da F70.

### ADR-530 — Resumo e badges semânticos em `/minhas-inscricoes` e correção do link em `/confirmacoes`
- **Contexto:** Todas as inscrições do participante compartilhavam o mesmo badge neutro, dificultando distinguir pendências de confirmação e presenças; além disso, o estado vazio de `/confirmacoes` direcionava o organizador para a página errada.
- **Decisão:** Adicionar `summarizeMyRegistrations` e `registrationStatusTone` no domínio puro para renderizar a faixa `my-registrations-summary` e tons semânticos via tokens do Design System em `registration-status`; corrigir o `href` do estado vazio de `/confirmacoes` para `/administracao/eventos/${eventId}/programacao`.
- **Consequências:** Leitura imediata de pendências e confirmações sem introduzir cores fora dos tokens semânticos, e fluxo direto da fila vazia para a tela onde a exigência de confirmação é configurada.

---

## 4. Lições aprendidas

| Sintoma | Causa raiz | Correção |
|---|---|---|
| E2E `f70-formulario-do-organizador.spec.ts` (caso 2) falhou esperando `"Texto longo sem finalidade declarada"` em `new-field-form-feedback` e recebeu `"Campo salvo no formulário."` | O atributo HTML5 `required={purposeRequired}` no `<Textarea name="purpose">` fazia o navegador bloquear o envio do formulário antes de chegar à Server Action quando o tipo era `LONG_TEXT`, impedindo o validador de domínio de exibir a recusa LGPD | Substituído `required={purposeRequired}` por `aria-required={purposeRequired \|\| undefined}`, mantendo o rótulo visual `(obrigatória)` e deixando o validador de domínio produzir a mensagem oficial |

---

## 5. Evidência de verificação

| Comando | Resultado real observado |
|---|---|
| `npm run lint` | 0 erros, 0 warnings |
| `npx tsc --noEmit --noUnusedLocals` | 0 erros |
| `npm test` | **323 arquivos / 5064 testes passando** (`239.90s`; +4 novos em `f136-ux-onda2-formulario-e-inscricoes.test.ts`, revalidado após o ajuste de `aria-required` em `2.60s`) |
| `npm run db:verify` | `Contrato íntegro.` |
| `npm run db:verify:isolation` | `9/9 verificações passaram.` |
| `npm run db:partitions` | Todas as partições do intervalo já existiam (`274.475` linhas totais) |
| `docker compose --profile app up -d --build web` | `eventflow/web:local` construída (`next build` OK em `43.4s`) e container `eventflow-web` recriado e iniciado |
| `npx playwright test tests/e2e/f70-formulario-do-organizador.spec.ts tests/e2e/f70-formulario-do-participante.spec.ts tests/e2e/registration-confirmation.spec.ts --reporter=list` | **12 passed** (`23.3s`) |
| Tamanho de `AGENTS.md` | **63.016 bytes** (`< 64.800` bytes; F118 movida para `docs/fases-historico.md`) |

---

## 6. Comandos operacionais

```bash
npm run lint
npx tsc --noEmit --noUnusedLocals
npm test
npm run db:verify
npm run db:verify:isolation
npm run db:partitions
docker compose --profile app up -d --build web
npx playwright test tests/e2e/f70-formulario-do-organizador.spec.ts tests/e2e/f70-formulario-do-participante.spec.ts tests/e2e/registration-confirmation.spec.ts --reporter=list
```

---

## 7. Dívidas técnicas

Nenhuma dívida nova aberta; contagem global mantida em **36 dívidas abertas**.

---

## 8. Checklist de aceite

- [x] `src/domain/events/registration-ux-rules.ts` puro (sem Prisma/Next) com presets, visibilidade por tipo, resumo e tons.
- [x] `RegistrationFieldForm` progressivo com 5 presets de 1 clique e fallback No-JS preservado.
- [x] Botão **"Ver página de inscrição"** no cabeçalho de `/administracao/eventos/[eventId]/formulario`.
- [x] Faixa de resumo e badges semânticos em `/minhas-inscricoes`.
- [x] Link do estado vazio de `/confirmacoes` corrigido para `/programacao`.
- [x] Testes unitários e SSR da FASE 136 adicionados.
- [x] Bateria completa de verificação e E2E da Onda 2 verdes.
