# FASE 110 — Privacidade, Consentimento Real, Autoatendimento de Conta e Observabilidade

> **Data:** 2026-11-14 · **Situação:** entregue · **ADRs desta fase:** ADR-449 … ADR-452

---

## 1. Sumário Executivo

Esta fase fecha lacunas de conformidade LGPD, controle real do visitante sobre preferências, transparência contratual e operabilidade de métricas e logs estruturados:

| Bloco / Frente | Onde foi aplicado | Resultado direto |
|---|---|---|
| **Bloco A — Privacidade, Termos, Acessibilidade e Cookies com Escolha Real** (`ADR-449`) | `src/domain/privacy/privacy-consent-rules.ts`, `src/lib/privacy/cookie-consent-service.ts`, `prisma/schema.prisma` (`cookie_consents` em `PLATFORM_ONLY_TABLES`, revogada para `eventflow_app`), `src/app/actions/privacy-actions.ts`, `src/components/privacy/cookie-consent-banner.tsx`, `src/components/privacy/public-legal-links.tsx`, `src/app/privacidade/page.tsx`, `src/app/termos/page.tsx`, `src/app/acessibilidade/page.tsx`, `theme-mode-server.ts`, `nav-mode-server.ts`, `theme-actions.ts`, `nav-actions.ts`, `ThemeChoice`, `AppShell`, `NavCollapseToggle` | Páginas públicas versionadas (`/privacidade`, `/termos`, `/acessibilidade`) ligadas nos rodapés; banner `<aside>` não-modal funcional sem JavaScript; recusa de preferências (`ESSENTIAL_ONLY`) remove e bloqueia gravação/leitura de `ef_tema` e `ef_nav`, sem nunca classificar tema visual como essencial |
| **Bloco B — Consentimento Versionado de Inscrição e IP Mascarado** (`ADR-450`) | `src/domain/events/registration-consent-rules.ts`, `src/domain/privacy/ip-privacy-rules.ts`, `prisma/migrations/20261114093000_f110_privacy_consent_and_ip_mask/migration.sql` (`consentVersion`, `consentText` + backfill SQL de IPs), `registration-service.ts`, `registration-read-service.ts`, `minhas-inscricoes/page.tsx`, `EventRegistrationForm`, `RegistrationForm`, `EventRegistrationDataForm`, `src/lib/admin/audit.ts`, `src/lib/platform/identity-audit-service.ts`, `src/lib/auth/account-service.ts` | Toda inscrição registra exatamente qual versão (`2026.11-v1`) e texto foram aceitos, visíveis em `/t/[tenantSlug]/minhas-inscricoes`; endereços IP passam por `maskIpAddress` (IPv4 `/24`, IPv6 `/48`) antes da persistência em `audit_logs`, `identity_audit_logs`, `cookie_consents` e na exibição de sessões em `/conta` |
| **Bloco C — Exclusão e Anonimização Própria em `/conta`** (`ADR-451`) | `src/domain/identity/account-deletion-rules.ts`, `src/domain/identity/identity-audit-rules.ts` (`ACCOUNT_DELETED`), `src/lib/auth/account-service.ts` (`deleteOwnAccount`), `src/app/actions/account-actions.ts` (`deleteOwnAccountAction`), `src/components/account/account-forms.tsx` (`AccountDeletionForm`), `src/app/conta/page.tsx` | Titular encerra a própria conta com frase `EXCLUIR MINHA CONTA` e senha atual (bloqueado se único `OWNER` ativo de alguma instituição); cancela inscrições futuras liberando lista de espera, apaga respostas/favoritos/avatar, revoga vínculos/papéis/sessões/2FA e anonimiza `User` (`deleted-<id>@anon.invalid`), mantendo integridade referencial de certificados já emitidos |
| **Bloco D — Quitação de B9 (Alertas em `/api/metrics`) e B6 (Migração Integral para `logger`)** (`ADR-452`) | `src/domain/observability/alert-rules.ts`, `src/lib/observability/metrics.ts`, `src/lib/observability/alerts.ts`, `src/app/api/metrics/route.ts`, `src/app/superadmin/metricas/page.tsx`, `src/workers/index.ts` e **84** arquivos de servidor em `src/lib`, `src/app/actions` e `src/app/api` | Regras de alerta (`BullMQNoWorkers`, `BullMQFailedJobsBacklog`, `Http5xxSpike`, `MetricsScrapeDeniedSpike`) publicam gauges Prometheus `eventflow_alert_firing` e `eventflow_alerts_firing_total` em `/api/metrics` (mantendo 404 sem `METRICS_TOKEN` em produção) e cartões de alerta em `/superadmin/metricas`; **238** chamadas `console.*` de servidor migradas para `logger` estruturado com catraca AST em teste unitário |

**Números da fase:**
- **Migrações de banco:** **1** (`prisma/migrations/20261114093000_f110_privacy_consent_and_ip_mask/migration.sql`)
- **Nova tabela de plataforma:** `cookie_consents` (sem RLS e sem acesso para `eventflow_app`, protegida em `PLATFORM_ONLY_TABLES` e `docker/postgres/init/00-roles.sql`)
- **Novos testes:** **10** unitários + **4** integração + **5** E2E (`tests/unit/f110-privacidade-consentimento-e-observabilidade.test.ts`, `tests/integration/f110-privacidade-banco.test.ts`, `tests/e2e/f110-privacidade-e-conta.spec.ts`)
- **ADRs da fase:** **4** (`ADR-449` … `ADR-452`, total do projeto: **452**)
- **Dívidas técnicas quitadas:** **2** (**B6** e **B9**; total em aberto reduzido de **44 para 42** em `docs/dividas-tecnicas.md`)

---

## 2. O Problema Mais Difícil da Fase

Equilibrar **controle real de preferências de cookies sem JavaScript**, **anonimização com preservação referencial** e **compatibilidade visual/navegacional sem bloquear o visitante** exigiu três decisões estruturais interligadas:

1. **Separar recusa real de cookies de preferências sem quebrar o SSR sem JS:** Classificar tema visual (`ef_tema`) e estado recolhido da barra lateral (`ef_nav`) como "essenciais" seria desonesto com o visitante. Ao mesmo tempo, como `/privacidade` e os rodapés públicos operam via `<form action>` antes da hidratação, o bloqueio precisou viver no servidor (`readThemeMode`, `readNavMode`, `setThemeAction`, `setNavModeAction` e `recordCookieConsent`), removendo imediatamente `ef_tema`/`ef_nav` ao escolher `ESSENTIAL_ONLY` e recusando gravá-los até nova autorização em `/privacidade#cookies`.
2. **Anonimizar a conta sem corromper certificados públicos já emitidos:** Certificados e pareceres históricos referenciam `User` para validação pública (`CERT-*`). Em vez de `DELETE FROM "user"` em cascata (que quebraria validações de terceiros ou apagar-se-ia com bloqueio de FK), `deleteOwnAccount` executa cancelamento real de inscrições futuras (promovendo a lista de espera), apagamento de respostas de formulários/favoritos/avatar, revogação de vínculos/papéis/sessões/2FA e anonimização irreversível (`email = deleted-<id>@anon.invalid`, `banned = true`, `deletedAt = now()`).

---

## 3. Decisões Técnicas Explicadas

- **`cookie_consents` como tabela de plataforma (`adminPrisma`):** O consentimento pertence ao visitante (anônimo ou autenticado, inclusive antes de existir instituição selecionada), nunca a um tenant. Colocá-la sob `PLATFORM_ONLY_TABLES` e revogar privilégios da role `eventflow_app` preserva o contrato de isolamento validado pelo `db:verify`.
- **Snapshot contratual de inscrição (`consentVersion` + `consentText`):** Armazenar apenas `consentAcceptedAt` não prova qual redação vigorava no momento da inscrição caso o texto evolua. Persistir o par imutável na linha de `registrations` torna cada comprovante autocontido em `/t/[tenantSlug]/minhas-inscricoes`.
- **Mascaramento irreversível de IP antes da gravação (`maskIpAddress`):** Logs de aplicação (`logger.ts`) já redigem dados sensíveis, mas trilhas persistidas em banco configuram tratamento contínuo de dado pessoal. Normalizar IPv4 para `/24` e IPv6 para `/48` (inclusive formatos `::ffff:`, porta e lista `X-Forwarded-For`) preserva diagnóstico de sub-rede e proteção contra abuso sem guardar o endereço exato do titular.
- **Banner em `<aside>` fora de modal (`sticky bottom-4`):** Posicionar o banner como elemento `<aside>` não-modal abaixo do conteúdo principal no `RootLayout` evita diálogos bloqueantes e impede sobreposição sobre links inferiores de páginas curtas (como `/validar/[code]`).

---

## 4. ADRs da Fase

### ADR-449 — Páginas legais públicas versionadas, `cookie_consents` de plataforma e escolha real de preferências
- **Contexto:** Não havia páginas `/privacidade`, `/termos` e `/acessibilidade` com inventário versionado, nem registro de aceite de cookies com distinção honesta entre cookies essenciais e cookies de preferência (`ef_tema`, `ef_nav`).
- **Decisão:** Criar `/privacidade`, `/termos` e `/acessibilidade` sob `<PageHeader eyebrow={PLATFORM_NAV_GROUP} />`, adicionar `cookie_consents` a `PLATFORM_ONLY_TABLES` (com revogação em `00-roles.sql`), exibir o banner não-modal `<CookieConsentBanner />` via `<form action>` funcional sem JS e bloquear leitura/escrita de `ef_tema`/`ef_nav` quando `ESSENTIAL_ONLY` estiver ativo.
- **Consequências:** Visitantes têm escolha efetiva e auditável sobre preferências de interface desde a primeira requisição HTML sem bloquear a leitura da página.

### ADR-450 — Snapshot versionado do termo de inscrição e mascaramento de IP em banco (`/24` e `/48`)
- **Contexto:** `registrations` gravava `consentDataAt`/`consentImageAt` sem versão nem texto aceito, e `audit_logs`, `identity_audit_logs` e sessões exibiam/persistiam IPs completos em claro.
- **Decisão:** Incluir `consentVersion` e `consentText` em `registrations` (gerados via `buildRegistrationConsentSnapshot` em todas as portas de inscrição e exibidos em `/t/[slug]/minhas-inscricoes`), aplicar `maskIpAddress` em todos os gravadores e na leitura de sessões em `/conta`, e executar backfill SQL na migração da fase.
- **Consequências:** Inscrições anteriores e futuras ficam comprováveis por versão/texto, e novos/antigos registros de trilha não retêm endereço IP completo.

### ADR-451 — Autoatendimento de exclusão e anonimização de conta em `/conta`
- **Contexto:** Titulares podiam exportar seus dados pela equipe ou apagar respostas de inscrição, mas não conseguiam encerrar a própria conta com autonomia.
- **Decisão:** Implementar regra pura (`evaluateAccountDeletionEligibility`, `buildAnonymizedAccountPayload`) e serviço `deleteOwnAccount` em `/conta`, exigindo frase `EXCLUIR MINHA CONTA` + senha atual (quando configurada), bloqueando único `OWNER` ativo, cancelando inscrições futuras com promoção da fila, limpando dados pessoais/OAuth/2FA/sessões e registrando `ACCOUNT_DELETED` na trilha de identidade com IP mascarado.
- **Consequências:** Exercício direto do direito de eliminação/anonimização prevista na LGPD sem quebrar certificados públicos já emitidos.

### ADR-452 — Alertas operacionais em `/api/metrics` e `/superadmin/metricas` (B9) e migração completa para `logger` (B6)
- **Contexto:** Dívidas históricas **B6** (206+ chamadas `console.*` em serviços/rotas/worker) e **B9** (métricas expostas sem regras de alerta nem visibilidade em painel) seguiam abertas desde a FASE 13.
- **Decisão:** Avaliar regras de alerta no domínio (`evaluateOperationalAlerts`), exportar `eventflow_alert_firing` e `eventflow_alerts_firing_total` em `/api/metrics` (mantendo HTTP 404 sem `METRICS_TOKEN` em produção), exibir alertas ativos em `/superadmin/metricas`, migrar todas as chamadas `console.*` do código de servidor para `logger.*` e travar a conquista com catraca AST no Vitest.
- **Consequências:** Dívidas **B6** e **B9** quitadas; tentativas futuras de introduzir `console.*` no servidor quebram imediatamente no `npm test`.

---

## 5. Lições Aprendidas (Defeitos Reais Encontrados por Testes)

| Defeito observado | Sintoma nos testes | Causa raiz real | Correção aplicada |
|---|---|---|---|
| **`cancelRegistration` / `roleAssignment` divergentes no rascunho de `deleteOwnAccount`** | Erro de tipos e teste de integração de `deleteOwnAccount` ao cancelar inscrições e revogar papéis | `cancelRegistration` esperava o parâmetro `userId` (e não `participantId`), retorno `{ cancelled, promotedUserId }` (`cleaned.kept`) e `RoleAssignment` sem coluna `reason` | Assinatura e retorno ajustados para o contrato real de `registration-service` e `prisma/schema.prisma`, validados em `f110-privacidade-banco.test.ts` (`4 passed`) |
| **Constrangimentos reais do schema na integração (`audit_logs.entityId` e `IdentityAuditEvent`)** | Falha em `f110-privacidade-banco.test.ts` ao gravar `entityId` não-UUID e literal fora do enum de identidade | `audit_logs.entityId` exige UUID válido em PostgreSQL e `recordIdentityEvent` restringe o enum tipado | Fixture atualizada para UUID válido e evento `PASSWORD_CHANGED`, confirmando IP truncado em `/24` no PostgreSQL real |
| **Catraca de cabeçalho único (`f78`) e tokens tipográficos (`design-system-guard`)** | `f78-topo-unico.test.ts` reprovou as 3 páginas públicas novas e `design-system-guard.test.ts` reprovou `text-[11px]` | `/privacidade`, `/termos` e `/acessibilidade` foram escritas inicialmente com `<h1>`/`<header>` próprios e classe arbitrária `text-[11px]` | Migradas para `<PageHeader eyebrow={PLATFORM_NAV_GROUP} />` com `text-xs`, atualizando `PAGINAS`/`MIGRADAS` (`110`/`95`) em `f78-topo-unico.test.ts` |
| **Sobreposição de banner `fixed` e colisão estrita de `<form>` em E2E** | `f63` test 5 cronometrou 60s clicando em `Ir para a página inicial` em `/validar/[code]` interceptado por `<aside>` `fixed bottom-4`; `accessibility.spec.ts:1419` falhou por `locator('form')` resolver 2 forms em `/login` | O banner `position: fixed` cobria a parte inferior de páginas curtas e injetou um `<form>` global fora de `<main>` | `<CookieConsentBanner>` passou a `sticky bottom-4` abaixo do fluxo (`ZERO` sobreposição em `/validar`) e `accessibility.spec.ts:1419` passou a usar `locator('main form')` |
| **Contrato de seletores e rota de inscrição na suíte `f110` + 3 baselines visuais (`f62`)** | `f110` falhou em `consentData` (em `/eventos/[slug]` em vez de `/inscricao`), em `account-deletion-feedback` (vs `-error`), e em `/api/metrics` esperado `200` sem token; `f62` apontou diff em `rodape-publico-*` (+9px dos links legais) e `evento-inscricao.png` (+`(termo 2026.11-v1)`) | `<Feedback>` nomeia `data-testid="${testId}-error"`, formulário completo de inscrição vive em `/inscricao`, `/api/metrics` em produção sem `METRICS_TOKEN` devolve `404` intencional e os rodapés/formulário evoluíram intencionalmente | Ajustados os seletores/URL no `f110-privacidade-e-conta.spec.ts` e regeradas apenas as 3 linhas de base visuais afetadas, com reexecução limpa verificada em seguida |

---

## 6. Evidência de Verificação

Todos os comandos abaixo foram executados integralmente após os últimos ajustes de código, testes e reconstrução da imagem de produção (`eventflow-web` + `eventflow-worker`):

| Verificação | Comando executado | Resultado observado |
|---|---|---|
| Lint | `npm run lint` | Saída `0` (0 erros, 0 warnings) |
| Tipagem | `npm run typecheck` | Saída `0` (`tsc --noEmit`) |
| Suíte Vitest (unit + integração) | `npm test` | **289 arquivos / 4885 testes passando** (`263.87s`) |
| Build de produção | `npm run build` | `Compiled successfully in 3.3s`, 19 páginas estáticas, rotas `/privacidade`, `/termos`, `/acessibilidade`, `/conta` e `/api/metrics` geradas |
| Contrato multi-tenant e plataforma | `npm run db:verify` | `Contrato íntegro.` (RLS + FORCE, `eventflow_app` sem superuser/BYPASSRLS, tabelas de plataforma inalcançáveis) |
| Prova de isolamento RLS | `npm run db:verify:isolation` | **9/9 verificações passaram** (`A1`–`A9`) |
| Partições mensais | `npm run db:partitions` | Todas as partições garantidas (`219636` linhas auditadas) |
| Imagem Docker em execução | `docker images eventflow/web:local` | `eventflow/web:local` ID `f0a71b191bb8` (`365MB`) |
| Suíte E2E completa (Playwright) | `npm run test:e2e` | **549 passed, 1 skipped** (`9.1m` sobre 550 casos, zero falhas) |

---

## 7. Comandos Operacionais

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run db:verify
npm run db:verify:isolation
npm run db:partitions
docker compose --profile app up -d --build web worker
npx playwright test tests/e2e/f110-privacidade-e-conta.spec.ts tests/e2e/f63-aparencia-do-visitante.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/f62-regressao-visual.spec.ts
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- **Quitadas na FASE 110:** **B6** (238 `console.*` de servidor migrados para `logger` estruturado, travado por catraca AST) e **B9** (regras de alerta operacional acopladas a `/api/metrics` + `/superadmin/metricas`).
- Total consolidado em [`docs/dividas-tecnicas.md`](dividas-tecnicas.md) cai de **44 para 42 itens abertos**.
- Em produção, o endpoint `/api/metrics` permanece fail-closed (`404`) quando `METRICS_TOKEN` não está configurado; ao definir `METRICS_TOKEN`, os gauges `eventflow_alert_firing` e `eventflow_alerts_firing_total` são entregues imediatamente para o scraper Prometheus/Alertmanager.

---

## 9. Checklist de Aceite

- [x] Páginas públicas `/privacidade`, `/termos` e `/acessibilidade` publicadas, versionadas e ligadas nos rodapés públicos (`ADR-449`)
- [x] Tabela de plataforma `cookie_consents` criada e protegida em `PLATFORM_ONLY_TABLES` e `00-roles.sql` (`ADR-449`)
- [x] Banner `<aside>` não-modal funcional sem JavaScript; recusa `ESSENTIAL_ONLY` apaga e bloqueia `ef_tema` e `ef_nav` (`ADR-449`)
- [x] Inscrições gravam e exibem `consentVersion` e `consentText` em `/t/[tenantSlug]/minhas-inscricoes` (`ADR-450`)
- [x] Endereços IP mascarados (`/24` IPv4 e `/48` IPv6) em `audit_logs`, `identity_audit_logs`, `cookie_consents` e `/conta` (`ADR-450`)
- [x] Titular exclui/anonimiza a própria conta em `/conta` (`deleteOwnAccount`) com guarda de último `OWNER` ativo (`ADR-451`)
- [x] Alertas operacionais publicados em `/api/metrics` e `/superadmin/metricas` (**B9 quitada**, `ADR-452`)
- [x] Chamadas `console.*` de servidor migradas para `logger` estruturado com catraca AST (**B6 quitada**, `ADR-452`)
- [x] Bateria completa de verificação e documentação final (549/549 ativos no E2E + 4885/4885 no Vitest + build + contrato DB verdes)
