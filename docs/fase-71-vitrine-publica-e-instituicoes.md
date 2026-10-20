# FASE 71 — A Vitrine Viva da Plataforma · Descoberta de Eventos e Expansão Institucional

> **Entrega:** Outubro de 2026  
> **Status:** Concluída · Código, migração, testes e documentação entregues  
> **Testes:** 3656 (Vitest: unitários e integração) + 388 (Playwright E2E) + 1 skip  
> **ADRs:** ADR-350 a ADR-353 (353 ADRs acumuladas no projeto)

---

## 1. Sumário Executivo

A **FASE 71** transforma a experiência pública e o posicionamento institucional do EventFlow. Até a Fase 70, a raiz (`/`) era uma tela técnica voltada a login e seleção de tenant, a descoberta de eventos ocorria em silo separado do diretório de organizações (`/organizacoes`), eventos não possuíam taxonomia temática padronizada no domínio e não havia funil estruturado para captação e qualificação de novas instituições interessadas na plataforma.

Esta fase entregou:
1. **Unificação da Descoberta Pública (`/eventos`):** Fusão harmônica da busca e filtragem de eventos com o diretório de instituições sob abas (`?aba=eventos` vs `?aba=instituicoes`), mantendo retrocompatibilidade total com contratos E2E legados e redirecionamento permanente HTTP 308 de `/organizacoes` para `/eventos?aba=instituicoes`.
2. **Taxonomia Padronizada de Categorias de Evento:** Criação do enum `EventCategory` com 10 áreas temáticas formais no banco e domínio puro, validação sem `any`, e proteção estrita contra vazamento de links de transmissão (`onlineUrl`) em consultas públicas de descoberta.
3. **Nova Landing Page Raiz (`/`):** Vitrine viva com busca rápida de eventos, carrossel de temas frequentes, vitrine de eventos com inscrições abertas, 4 pilares da jornada do participante, métricas públicas agregadas e banner de conversão para organizadores.
4. **Página de Expansão Institucional (`/para-instituicoes`) e Gestão de Leads:** Apresentação clara de diferenciais técnicos e planos institucionais, formulário público seguro para captação de leads (`InstitutionLeadForm`), e painel de triagem no SuperAdmin (`/superadmin/leads`) com controle de status (`OPEN`, `CONTACTED`, `QUALIFIED`, `ARCHIVED`) e anotações internas.

### Números da Fase

| Métrica | Antes (F70) | Depois (F71) | Variação |
|---|---|---|---|
| **Testes Vitest (unit + int)** | 3631 | 3656 | +25 |
| **Testes Playwright E2E** | 384 | 388 | +4 |
| **ADRs registradas** | 349 | 353 | +4 (ADR-350 a ADR-353) |
| **Tabelas de Tenant (com RLS)** | 60 | 60 | 0 (preservado) |
| **Tabelas de Plataforma (sem RLS)** | `job_runs`, `two_factor`, `identity_audit_logs` | + `institution_leads` | +1 (bloqueada para runtime role) |
| **Rotas Públicas e Administrativas** | — | `/eventos`, `/para-instituicoes`, `/superadmin/leads` | +3 rotas chave |

---

## 2. O Problema Mais Difícil da Fase

O problema mais complexo da FASE 71 foi **conciliar a expansão da vitrine pública e a coleta aberta de leads sem violar os princípios fundacionais de segurança do SaaS**:
1. **Isolamento de Dados Sensíveis da Vitrine Pública:** Na busca global de eventos, eventos são organizados por diferentes instituições (tenants). O repositório global precisava pesquisar entre múltiplos tenants sem permitir que campos restritos a inscritos confirmados — especialmente `onlineUrl` (link direto para salas virtuais, transmissões Zoom/Meet/YouTube) — fossem expostos antes do momento devido. A solução foi criar uma projeção estrita no `global-repository.ts` onde `onlineUrl` sequer é selecionado do PostgreSQL para a vitrine pública.
2. **Segurança de Tabelas de Plataforma para Leads:** O formulário de expansão institucional recebe contatos de instituições externas que ainda não possuem tenant nem usuário criado. Gravar esses dados em uma tabela comum com `tenantId` nulo em um banco com RLS criaria brechas ou exigiria policies perigosas. A solução adotada seguiu o padrão rigoroso de plataforma: `institution_leads` nasceu sem RLS, mas com **privilégio de acesso completamente revogado** para a role de runtime `eventflow_app`, acessível unicamente via `adminPrisma` / SuperAdmin, assegurado pela catraca `npm run db:verify`.

---

## 3. Decisões Técnicas Explicadas

- **Redirecionamento Permanente 308 de `/organizacoes`:** Mantém o link histórico de motores de busca e marcadores sem quebrar integrações, preservando parâmetros de consulta e redirecionando para `/eventos?aba=instituicoes`.
- **Formulários Funcionais sem JavaScript (Progressive Enhancement):** O formulário de busca de `/eventos` opera como formulário GET nativo do HTML. Usuários sem JavaScript ou robôs conseguem filtrar categorias, modalidades e cidades de forma transparente.
- **Domínio Puro sem Dependência de Framework:** Módulos em `src/domain/events/event-category-rules.ts`, `src/domain/platform/lead-rules.ts` e `src/domain/platform/platform-metrics-rules.ts` contêm apenas TypeScript puro, sem referências ao Prisma ou Next.js.
- **Acessibilidade e Contraste WCAG AA no Tema Escuro:** Em vez de usar classes primárias puras (`text-primary`) diretamente sobre fundos escuros de cards (que reprovariam na razão mínima de 4.5:1 do WCAG), adotou-se o uso de botões primários com alto contraste (`bg-primary text-primary-foreground`) e badges com contorno e texto mudo legível.

---

## 4. Registro de Decisões de Arquitetura (ADRs)

### ADR-350 — Unificação da Descoberta Pública em `/eventos` com Redirecionamento Permanente 308

- **Contexto:** Anteriormente existiam duas superfícies públicas desconectadas: a listagem simples de eventos em um tenant e a lista de organizações em `/organizacoes`. Os visitantes não tinham um catálogo unificado para navegar por simpósios, conferências e instituições em um único destino.
- **Decisão:** Unificar a experiência em `/eventos`, provendo abas chave ("Eventos" e "Instituições") com formulários de busca integrados, preservando os seletores e `data-testid` legados (`organizations-directory`, `directory-card`, `directory-search`, etc.), e aplicando `permanentRedirect('/eventos?aba=instituicoes')` (HTTP 308) em `/organizacoes`.
- **Justificativa:** Centraliza o SEO e a jornada do usuário em uma única rota canônica de descoberta, sem quebrar links antigos indexados ou testes de governança existentes.
- **Consequências:** Todas as buscas públicas de eventos e organizações convergem para `/eventos`.

### ADR-351 — Taxonomia Padronizada de Categorias e Ocultação Estrita de `onlineUrl` na Descoberta

- **Contexto:** Os eventos cadastrados anteriormente possuíam apenas tipificação por modalidade (`PRESENTIAL`, `ONLINE`, `HYBRID`) e texto livre, dificultando filtros temáticos nacionais e arriscando vazamento de salas virtuais fechadas.
- **Decisão:** Criar o enum `EventCategory` no Prisma com 10 categorias temáticas principais (`TECHNOLOGY_INNOVATION`, `SCIENCE_ACADEMIA`, `HEALTH_MEDICINE`, `EDUCATION_PEDAGOGY`, `BUSINESS_ENTREPRENEURSHIP`, `ENGINEERING_INDUSTRY`, `LAW_GOVERNANCE`, `ARTS_CULTURE`, `SUSTAINABILITY_ENVIRONMENT`, `OTHER`). No `searchPublicEvents`, aplicar projeção estrita que exclui explicitamente o campo `onlineUrl`.
- **Justificativa:** Categorização padronizada permite navegação rica por temas de interesse. Ocultar o link online garante que salas fechadas só sejam acessadas por quem possui credencial confirmada no evento.
- **Consequências:** Organizadores selecionam a categoria temática na criação/edição do evento; a vitrine exibe tags temáticas confiáveis.

### ADR-352 — Vitrine Viva e Agregação Segura de Métricas Públicas na Landing Page

- **Contexto:** A página inicial `/` anterior exibia apenas o card de autenticação e links de entrada, sem evidenciar a vitalidade e abrangência dos eventos hospedados no EventFlow.
- **Decisão:** Reestruturar `/` com: (1) hero section com busca rápida por título, tema ou cidade; (2) atalhos para categorias frequentes; (3) carrossel de eventos com inscrições abertas; (4) os quatro pilares da jornada (Inscrições, Crachá Digital, Gamificação/XP, Certificação Oficial); (5) agregação pública segura de métricas (número de instituições ativas, eventos realizados, inscrições processadas e certificados emitidos); (6) chamada para ação institucional.
- **Justificativa:** Valoriza o ecossistema SaaS, gera atração orgânica para participantes e credibilidade imediata para novos organizadores.
- **Consequências:** A raiz do produto se torna a porta de entrada pública para a descoberta de conteúdo e eventos.

### ADR-353 — Funil de Expansão Institucional e Tabela `institution_leads` Segregada da Runtime Role

- **Contexto:** Instituições interessadas em adotar o EventFlow precisavam de um canal direto para solicitar contato, demonstração ou proposta de implantação sob medida.
- **Decisão:** Criar a tabela `institution_leads` como tabela de plataforma (sem RLS), explicitamente revogada da role de banco `eventflow_app` e do schema público na migração `20261008220000_f71_vitrine_publica_e_leads`. Criar o formulário público em `/para-instituicoes` com Server Action validada e o painel administrativo de gestão em `/superadmin/leads`.
- **Justificativa:** Leads não pertencem a nenhum tenant individual e dados de contato comercial não devem ser consultáveis por queries com contexto de tenant, preservando o princípio de menor privilégio.
- **Consequências:** Gestão segura do pipeline de novas instituições restrita ao SuperAdmin.

---

## 5. Lições Aprendidas

| Sintoma | Causa Raiz | Correção Aplicada |
|---|---|---|
| Falha no teste `design-system-guard.test.ts` acusando cores não padronizadas (`text-emerald-*`) e fontes arbitrárias (`text-[10px]`). | Uso inicial de utilitários de cor direta do Tailwind em badges e fontes fracionadas em tags. | Substituição por tokens semânticos do Design System (`text-success`, `text-xs`), em conformidade estrita com o guard. |
| Testes E2E falhando inicialmente com erro 404 para `/para-instituicoes` e `/superadmin/leads`. | O container Docker `eventflow-web` em execução na porta 3000 havia sido construído antes da F71, e o Playwright conectou nele devido a `reuseExistingServer: true`. | Reconstrução das imagens com `docker compose --profile app up -d --build web worker`, conforme previsto no protocolo do `AGENTS.md`. |
| Falha no teste unitário `f60-landmark-unico.test.ts` ao avaliar `/organizacoes`. | O teste inspecionava se páginas sem `<main>` tinham redirecionamento via regex `redirect\(`, mas `/organizacoes` utilizou `permanentRedirect(`. | Atualização da expressão regular para `/(?:permanentRedirect|redirect)\(/`, cobrindo ambos os métodos padrão do Next.js. |
| Violação de modo estrito no Playwright em `f71-vitrine-e-leads.spec.ts` ao buscar `text=Em contato`. | A tela continha tanto o badge `<span ...>Em contato</span>` quanto o option `<option value="CONTACTED">Em contato</option>`. | Uso de seletor específico por `data-testid^="lead-status-badge-"` com asserção `toHaveText('Em contato')`. |
| Violação séria de acessibilidade (`color-contrast` no axe) no modo escuro em `/` e `/eventos`. | Links e tags com `text-primary` sobre fundos escuros de cards não atingiam o ratio mínimo WCAG AA (4.5:1). | Substituição por botões primários com contraste certificado (`bg-primary text-primary-foreground`) e badges com texto mudo legível. |
| Regressão visual na suíte `f62-regressao-visual.spec.ts` nos testes 13 e 14 de rodapé da raiz. | A nova landing page rica da F71 alterou a altura da página de 1200px para 3242px, divergindo dos snapshots legados da tela inteira. | Atualização oficial dos snapshots com `--update-snapshots` após validação da integridade visual e de acessibilidade. |

---

## 6. Evidência de Verificação

### 1. `npm run lint`
```text
npm notice run eventflow@0.1.0 lint
npm notice run eslint .
# Exit code: 0 (0 erros, 0 warnings)
```

### 2. `npm run typecheck`
```text
npm notice run eventflow@0.1.0 typecheck
npm notice run tsc --noEmit
# Exit code: 0 (0 erros de compilação TypeScript)
```

### 3. `npm test`
```text
 Test Files  196 passed (196)
      Tests  3656 passed (3656)
   Duration  131.79s
# Exit code: 0
```

### 4. `npm run db:verify` & `npm run db:verify:isolation`
```text
──────────────────────────────────────────────────────────────────────────────
  CONTRATO DE ISOLAMENTO MULTI-TENANT
──────────────────────────────────────────────────────────────────────────────
  ✓  RLS habilitada + FORCE em todas as tabelas com tenantId
  ✓  Nenhuma tabela com RLS ficou sem policy
  ✓  Role "eventflow_app" sem superuser e sem BYPASSRLS
  ✓  GRANTs mínimos presentes, TRUNCATE ausente
  ✓  Tabela(s) de plataforma inalcançável(is) pela role "eventflow_app"

  Contrato íntegro.
──────────────────────────────────────────────────────────────────────────────
  9/9 verificações passaram.
  Isolamento entre tenants garantido pelo banco.
──────────────────────────────────────────────────────────────────────────────
```

### 5. `npm run build`
```text
▲ Next.js 16.3.6 (Turbopack)
✓ Compiled successfully in 9.8s
✓ Generating static pages using 15 workers (18/18) in 179ms
Route (app)
├ ƒ /
├ ƒ /eventos
├ ƒ /organizacoes
├ ƒ /para-instituicoes
├ ƒ /superadmin/leads
...
# Todas as rotas dinâmicas e estáticas geradas com sucesso.
```

### 6. `npm run test:e2e`
```text
  1 skipped
  388 passed (16.5m)
# Exit code: 0 (100% de aprovação nos 388 testes E2E ativos)
```

---

## 7. Comandos Operacionais

```bash
# Execução da bateria completa de testes unitários e integração
npm test

# Validação do isolamento de tenants e contratos de banco
npm run db:verify
npm run db:verify:isolation

# Reconstrução e subida dos serviços Docker
docker compose --profile app up -d --build web worker

# Execução dos testes E2E da vitrine viva e expansão
npx playwright test tests/e2e/f71-vitrine-e-leads.spec.ts

# Execução de toda a suíte E2E da plataforma
npm run test:e2e
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

1. **Filtro Geográfico com Base no IBGE:** O filtro de cidades e estados na barra de busca utiliza texto livre gravado no tenant/evento. Futuras iterações podem integrar a tabela padrão de municípios do IBGE para autocomplete de municípios brasileiros.
2. **Notificação por E-mail ao Receber Lead:** A criação do lead grava com segurança em `institution_leads`. Um job no outbox para avisar a equipe comercial via e-mail sobre novos contatos pode ser acoplado no worker nas próximas rotinas de plataforma.

---

## 9. Checklist de Aceite

- [x] Enum `EventCategory` com 10 áreas temáticas formais criado no schema e mapeado no domínio puro.
- [x] Tabela `institution_leads` criada como tabela de plataforma sem RLS e sem acesso para `eventflow_app`.
- [x] Repositório global `searchPublicEvents` com projeção estrita sem exposição de `onlineUrl`.
- [x] Rota `/eventos` unificada com abas "Eventos" e "Instituições", filtros por categoria, modalidade e localidade.
- [x] Rota `/organizacoes` com redirecionamento permanente HTTP 308 para `/eventos?aba=instituicoes`.
- [x] Landing Page `/` reformulada com busca rápida, temas frequentes, vitrine viva, 4 pilares e métricas públicas.
- [x] Página `/para-instituicoes` com diferenciais técnicos, planos e formulário funcional de captação de leads.
- [x] Painel `/superadmin/leads` com listagem, filtro por status, alteração de situação e anotações internas.
- [x] Suíte de testes unitários e de integração cobrindo domínio, repositório e contratos (`tests/unit/f71-*.ts` e `tests/integration/f71-*.ts`).
- [x] Suíte E2E com 4 cenários ponta a ponta (`tests/e2e/f71-vitrine-e-leads.spec.ts`) passando 100%.
- [x] Total de testes atualizado: 3656 testes Vitest + 388 testes Playwright E2E + 1 skip.
- [x] Contrato do banco íntegro (`npm run db:verify` e `npm run db:verify:isolation`).
