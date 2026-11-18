# FASE 114 — Ergonomia de Balcão, Abas por URL e Refinos de App Router no Credenciamento

## 1. Sumário Executivo

Esta fase reestrutura a experiência e a arquitetura React 19 / Next.js 16 de `/t/[tenantSlug]/credenciamento` para eliminar o conflito entre **operação de campo em tempo real** (leitura de crachá e busca manual de exceção) e **configuração pré-evento** (política antifraude GPS e geração de cartazes QR/Telão), entregando layout desktop em duas colunas, streaming granular com `<Suspense>` e correções pontuais de estado no cliente e no servidor.

| Entrega | Arquivo(s) |
|---|---|
| Regras puras do console, abas e filtros da fila | [checkin-console-rules.ts](file:///c:/Users/thiago/Documents/Projetos/star/src/domain/events/checkin-console-rules.ts) |
| Filtro de situação e resumo ao vivo na fila | [attendance-service.ts](file:///c:/Users/thiago/Documents/Projetos/star/src/lib/events/attendance-service.ts) |
| Resumo leve + reutilização de atividades sem query duplicada | [self-checkin-service.ts](file:///c:/Users/thiago/Documents/Projetos/star/src/lib/events/self-checkin-service.ts) |
| Fila lateral assíncrona isolada em `<Suspense>` | [checkin-queue-section.tsx](file:///c:/Users/thiago/Documents/Projetos/star/src/components/credentials/checkin-queue-section.tsx) |
| Abas reais por URL (`?aba=`), chips de situação e fallback no-JS | [checkin-filter-bar.tsx](file:///c:/Users/thiago/Documents/Projetos/star/src/components/credentials/checkin-filter-bar.tsx) |
| Feedback acima da câmera, saída pontual sem alterar modo e confirmação | [monitor-console.tsx](file:///c:/Users/thiago/Documents/Projetos/star/src/components/credentials/monitor-console.tsx) |
| Política recolhível, busca de atividades, link/Cartaz PIN e correção de feedback | [self-checkin-manager.tsx](file:///c:/Users/thiago/Documents/Projetos/star/src/components/credentials/self-checkin-manager.tsx) |
| Consolidação em 1 transação `withTenant` sem 2º `getRequestContext()` | [page.tsx](file:///c:/Users/thiago/Documents/Projetos/star/src/app/t/%5BtenantSlug%5D/(app)/credenciamento/page.tsx) |
| Testes unitários (`8`) e E2E (`2`) | [f114-credenciamento-ux-app-router.test.ts](file:///c:/Users/thiago/Documents/Projetos/star/tests/unit/f114-credenciamento-ux-app-router.test.ts), [f114-credenciamento-ux.spec.ts](file:///c:/Users/thiago/Documents/Projetos/star/tests/e2e/f114-credenciamento-ux.spec.ts) |

---

## 2. O Problema Mais Difícil da Fase

Na versão anterior, `SelfCheckinManager` ficava empilhado entre `MonitorConsole` e `CheckinQueue`, empurrando a busca manual por nome milhares de pixels para baixo em eventos com múltiplas atividades. Além disso, o formulário de política antifraude fechando automaticamente após o salvamento esconderia o feedback de sucesso caso permanecesse dentro de `<details>`, e o evento trocado no topo manteria o `useState` anterior do `SelfCheckinManager` se não houvesse `key={eventId}` explícita no componente cliente.

Separar **Balcão ao vivo** (padrão) e **Autocredenciamento & Cartazes** (`?aba=autocredenciamento`) via abas reais de URL mantém `MonitorConsole` e `CheckinQueue` visíveis lado a lado sem rolagem no desktop (`lg:grid-cols-12`) enquanto preserva o comportamento esperado por todas as suítes legadas e garante funcionamento sem JavaScript.

---

## 3. Decisões Técnicas Explicadas

- **Abas por query string (`?aba=balcao | autocredenciamento`) via `<AppLink>`:** evita fragmentar permissões e catálogo de páginas (`f76`/`f78`), mantém o seletor de evento compartilhado no topo e permite pular `getSelfCheckinConsoleData` na aba operacional carregando apenas `getSelfCheckinStatusSummary`.
- **Feedback acima de `<ScanGate>` no `MonitorConsole`:** quando a câmera QR está aberta em notebooks/tablets, o resultado de entrada/saída aparece imediatamente abaixo do input de código, acima do quadro de vídeo.
- **Saída pontual (`handleOneShotCheckout`) via DOM `modeInputRef`:** clicar em `"Registrar saída imediata"` envia `mode=OUT` na submissão corrente (ou fila offline) sem gravar `'OUT'` no `localStorage`, preservando `IN` / `TOGGLE` para os leitores seguintes na fila.
- **Política antifraude recolhível com feedback externo ao `<details>`:** nasce aberta quando o evento ainda está desativado ou sem coordenadas GPS, recolhe automaticamente nas recargas seguintes priorizando a grade de cartazes/Telão, e mantém o `<Alert>` de confirmação fora da área colapsável.

---

## 4. Registros de Decisão Arquitetural (ADRs)

### ADR-463 — Separação de Balcão ao Vivo e Autocredenciamento via Aba de URL e `<Suspense>` Granular
- **Contexto:** Empilhar política antifraude e catálogo de QR Codes acima da fila manual degradava o tempo de resposta do operador de portaria e forçava a casca inteira da página a esperar `listCheckinQueue` a cada tecla digitada na busca.
- **Decisão:** Introduzir `CheckinTab` (`?aba=balcao | autocredenciamento`), grade desktop em 2 colunas na aba `balcao`, extrair `CheckinQueueSection` como Async Server Component sob `<Suspense key={queueFilterKey}>`, e unificar as consultas da casca em uma única transação `withTenant` sem 2ª chamada a `getRequestContext()`.
- **Consequências:** Zero consultas duplicadas a `activity.findMany`, feedback imediato de busca na fila lateral com aviso explícito de truncamento em 60 registros (`checkin-queue-truncation`), e preservação de 100% dos fluxos No-JS.

### ADR-464 — Ergonomia Não-Destrutiva e Proteção de Lote no `MonitorConsole`
- **Contexto:** O atalho `"Registrar saída imediata"` sobrescrevia o modo persistido em `localStorage`, o feedback de leitura nascia abaixo do preview da câmera e `"Fechar as presenças abertas deste contexto"` disparava sem confirmação.
- **Decisão:** Mover `monitor-feedback` acima de `<ScanGate>`, isolar o override pontual de `'OUT'` via `modeInputRef`, proteger duplo disparo síncrono de câmera com `scanInFlightRef`, e adotar `ConfirmSubmitButton` (com fallback `<noscript>`) no fechamento em massa de sessões abertas.
- **Consequências:** Fluxo contínuo de portaria e salas sem inversão silenciosa de modo e sem encerramentos acidentais por clique isolado.

### ADR-465 — Estado Correto de Feedback, Fuso Explícito e Filtro Rápido no `SelfCheckinManager`
- **Contexto:** `const feedback = regenState ?? state` ocultava retornos futuros de *Pausar/PIN/Telão* após uma regeneração de QR Code; além disso, horários de atividade usavam fuso local do processo/navegador sem `eventTimeZone` e faltavam atalhos para copiar link e baixar Cartaz com PIN (`?incluirPin=1`).
- **Decisão:** Rastrear `lastActionKind` em `PointRow`, formatar horários com `timeZone: eventTimeZone` + `suppressHydrationWarning`, exibir `Cartaz com PIN` quando `pinRequired` está ativo, adicionar botão `Copiar link` e filtro cliente por nome/sala/QR gerado, e aplicar `key={eventId}` em `SelfCheckinManager`.
- **Consequências:** Estado consistente entre troca de eventos, zero risco de mismatch de hidratação SSR/CSR por fuso e operação direta para impressão de cartazes em eventos grandes.

---

## 5. Lições Aprendidas

| Sintoma | Causa Raiz | Correção |
|---|---|---|
| `SyntaxError` ao executar `f114-credenciamento-ux.spec.ts` na importação de `PASSWORD` | `PASSWORD` era constante local em `f113-autocredenciamento.spec.ts` e não um export de `tests/e2e/helpers.ts` | Definida constante local `PASSWORD` em `f114-credenciamento-ux.spec.ts` |
| Chip `Presentes agora` retornando `0` no primeiro ensaio E2E da F114 | A oficina seedada estava ativa no momento do teste (`isNow = true`), fazendo `MonitorConsole` abrir em `ACTIVITY` enquanto a participante possuía inscrição apenas no evento (`activityId = null`) | Seleção explícita do contexto `Portaria` (`EVENT`) no cenário 1 de `f114-credenciamento-ux.spec.ts` |
| Política antifraude reabria ou mantinha resumo `"GPS opcional"` no cenário 2 E2E da F114 | No ensaio do teste 2, latitude/longitude foram preenchidas sem marcar a caixa `self-checkin-policy-require-geo` (`requireGeo` continuou `false`) | Marcado `self-checkin-policy-require-geo` antes de salvar a política no teste E2E |

---

## 6. Evidência de Verificação

- `npm run lint`: `0` erros, `0` warnings
- `npm run typecheck`: `0` erros
- `npm run build`: compilado com sucesso
- `npm run db:verify` / `npm run db:verify:isolation` / `npm run db:partitions`: `Contrato íntegro.` / `9/9 verificações passaram.`
- `npm test`: `295` arquivos passando (`4929` testes, incluindo `8` novos em `f114-credenciamento-ux-app-router.test.ts` e exclusão de QR em `f113-self-checkin-banco.test.ts`)
- `npm run test:e2e`: `563` passando + `1` skip (`564` casos, incluindo `2` novos cenários em `f114-credenciamento-ux.spec.ts`)

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
- **Ponto de atenção:** Ao alterar labels ou headings em componentes compartilhados de `/credenciamento`, evitar usar o termo literal `"evento"` dentro de `<label>` ou `"credenciamento"` em sub-headings `<h2>`/`<h3>` para não colidir com seletores estritos de acessibilidade do Playwright (`getByLabel('Evento')`, `getByRole('heading', { name: 'Credenciamento' })`).

---

## 9. Checklist de Aceite

- [x] Separação dos fluxos em abas de URL (`Balcão ao vivo` e `Autocredenciamento & Cartazes`) preservando `?evento=` e No-JS.
- [x] Layout desktop 2 colunas na aba `Balcão ao vivo` com `<MonitorConsole>` à esquerda e busca manual por nome à direita sob `<Suspense>`.
- [x] `monitor-feedback` posicionado acima da câmera `<ScanGate>`, saída imediata pontual sem adulterar `localStorage` e fechamento em massa protegido por `ConfirmSubmitButton`.
- [x] Resumo operacional do evento (`Confirmados`, `Sessões abertas agora`, `QR autoatendimento`) e chips rápidos de fila (`Todos`, `Aguardando entrada`, `Presentes agora`) com aviso explícito de truncamento acima de 60 linhas.
- [x] Política antifraude recolhível no `SelfCheckinManager` (aberta só quando não configurada), filtro de atividades, `Copiar link`, `Cartaz com PIN`, correção de `lastActionKind` e `timeZone` explícito do evento.
- [x] Eliminação da chamada duplicada a `getRequestContext()` e da consulta duplicada a `activity.findMany` em `credenciamento/page.tsx`.
- [x] Testes unitários (`8`), atualização do fluxo E2E F113, novos testes E2E F114 (`2`) e bateria global verde.
