# FASE 111 — Publicação de Anais, Citações e Indexação (Custo Zero)

> **Estado:** Concluída
> **Tema:** Publicação acadêmica de anais por evento, formatos de citação (ABNT, APA, BibTeX, RIS), envio de versão final (`CAMERA_READY`) com termo de autorização de publicação, streaming de PDF público, OAI-PMH 2.0 (`oai_dc`), metatags Highwire Press / Dublin Core / JSON-LD (`ScholarlyArticle`) e SEO (`sitemap.xml` / `robots.txt`) — sem dependências pagas ou custo adicional de infraestrutura.
> **ADRs desta fase:** ADR-453 a ADR-456
> **Dívidas técnicas:** 42 dívidas abertas mantidas (sem quitação nem declaração de novas dívidas em `docs/dividas-tecnicas.md`).

---

## 1. Sumário Executivo

A FASE 111 fecha o ciclo científico da Koveno transformando trabalhos aprovados em **anais públicos indexáveis e citáveis** sem introduzir custos de infraestrutura externa (sem DOI pago automático, sem CDN/bucket público adicional para submissões, sem motor de busca externo).

### Tabela de entregas

| Eixo | Entregas | Camada |
|---|---|---|
| **Modelo de dados e isolamento** | Enum `ProceedingsStatus` (`DRAFT`, `PUBLISHED`), `SubmissionFileKind.CAMERA_READY`, tabelas `proceedings_volumes` e `proceedings_entries` sob RLS + FORCE, campos de autorização (`proceedingsPermissionAcceptedAt`, `proceedingsPermissionVersion`) em `submissions`, novos eventos em `AuditAction` (`PROCEEDINGS_VOLUME_UPDATED`, `PROCEEDINGS_PUBLISHED`, `PROCEEDINGS_UNPUBLISHED`, `PROCEEDINGS_ENTRY_UPDATED`, `PROCEEDINGS_PERMISSION_ACCEPTED`) | `prisma/schema.prisma`, `migration.sql`, `schema-contract.ts` |
| **Domínio puro** | Regras de cegueira/snapshot/paginação/DOI/ISSN/arquivo permitido (`proceedings-rules.ts`), formatadores ABNT / APA / BibTeX / RIS (`citation-rules.ts`), geradores de metatags Highwire Press (`citation_*`), Dublin Core (`DC.*`), JSON-LD `ScholarlyArticle` e XML OAI-PMH 2.0 (`indexing-rules.ts`), regra `canUploadSubmissionFile` (`submission-rules.ts`) e card `'anais'` no grupo `RESULTADO` (`event-areas.ts`) | `src/domain/proceedings/*`, `src/domain/review/submission-rules.ts`, `src/domain/events/event-areas.ts` |
| **Aplicação e segurança** | Fluxo `CAMERA_READY` + `recordProceedingsPermission` em `submission-service.ts`; administração de anais, importação de aprovados (`snapshotAuthors`, `snapshotAbstract`, `snapshotKeywords`, páginas, ordem, arquivo escolhido com bloqueio estrito de `BLIND_PDF`), publicação/despublicação e resolução pública fail-closed (`assertProceedingsSemCampoProibido`, `canServeFile`) em `proceedings-service.ts`; índice de sitemap e OAI-PMH global via `systemClient()` + `withTenant` (`indexing-service.ts`) | `src/lib/proceedings/*`, `src/lib/review/submission-service.ts`, `src/lib/events/event-area-counts.ts`, `src/lib/events/event-repository.ts` |
| **APIs e SEO público** | `/sitemap.xml`, `/robots.txt`, `/api/oai` (global), `/api/t/[tenantSlug]/eventos/[eventSlug]/oai` (por evento), `/api/t/[tenantSlug]/eventos/[eventSlug]/anais/[protocol]/arquivo` (streaming inline seguro do PDF) e `/api/t/[tenantSlug]/eventos/[eventSlug]/anais/[protocol]/citacao` (`?formato=bibtex|ris`) | `src/app/sitemap.ts`, `src/app/robots.ts`, `src/app/api/**` |
| **Interface (UI)** | Painel administrativo `/t/[slug]/administracao/eventos/[eventId]/anais`, seção de versão final (`CAMERA_READY`) + termo em `/t/[slug]/submissoes/[submissionId]`, anais públicos `/t/[slug]/eventos/[eventSlug]/anais`, página individual do trabalho `/t/[slug]/eventos/[eventSlug]/anais/[protocol]` (`CitationBox` + `generateMetadata` + `<script type="application/ld+json">`) e link condicional na landing do evento (`[data-testid="event-proceedings-link"]`) | `src/app/t/[tenantSlug]/**`, `src/components/proceedings/*`, `src/components/events/event-landing.tsx` |
| **Testes** | Suite unitária (formatadores, regras puras, OAI-PMH, proteção contra vazamento de PII), integração contra PostgreSQL real + RLS + uploads, atualização da catraca de topo único (`f78`) + fases (`f79`) e suíte E2E ponta a ponta com auditoria `axe-core` WCAG AA | `tests/unit/f111-*`, `tests/integration/f111-*`, `tests/e2e/f111-*` |

### Números da fase

- **Migração:** 1 (`20261114140000_f111_proceedings_and_indexing`), 2 novas tabelas sob RLS + FORCE (`proceedings_volumes`, `proceedings_entries`).
- **Novos testes adicionados na fase:** **8** unitários (`f111-anais-citacoes-e-indexacao.test.ts`), **2** de integração (`f111-anais-banco.test.ts`), **5** E2E (`f111-anais-publicacao-e-indexacao.spec.ts`).
- **Contagem final após a fase:** **4895 testes** Vitest (291 arquivos) e **554 testes E2E** passing (+ 1 skip, total de 555 casos); **456 ADRs** (ADR-453 a ADR-456); **62 tabelas de tenant** sob RLS + FORCE.

---

## 2. O Problema Mais Difícil da Fase e Como Ele Define o Desenho

O problema central da publicação científica sobre uma base de avaliação por pares existente é **garantir o isolamento absoluto entre o processo de revisão duplo-cego/identificado e o acervo público indexável, sem exigir uma segunda infraestrutura de armazenamento**.

Três riscos concretos exigiam solução arquitetural na raiz:

1. **Vazamento do arquivo cego (`BLIND_PDF`) nos anais públicos:** na Koveno, trabalhos avaliados em modo cego possuem um PDF sem autoria (`BLIND_PDF`) e, opcionalmente, o arquivo identificado (`IDENTIFIED_PDF`). Se a publicação escolhesse "o último arquivo" sem filtro de finalidade, um PDF anônimo ou uma versão de rascunho pré-revisão poderia ir a público — ou, pior, expor dados internos caso se servisse qualquer `SubmissionFile` sem guarda. Por isso, `canUseFileKindInProceedings` recusa estritamente `BLIND_PDF` tanto no domínio quanto na importação e resolução do serviço.
2. **Estabilidade de URLs para Google Scholar e indexadores sem exposição do bucket MinIO:** o bucket de submissões é privado e URLs pré-assinadas S3/MinIO expiram rapidamente e contêm credenciais na query string (`X-Amz-Signature`), invalidando a metatag `citation_pdf_url` e o `<link>` em crawlers. A solução escolhida cria um endpoint HTTP público de streaming inline (`/api/t/[slug]/eventos/[eventSlug]/anais/[protocol]/arquivo`) que valida a publicação do volume, a inclusão da entrada, o gênero de arquivo permitido e o portão antivírus (`canServeFile`), transmitindo os bytes do MinIO sem redirecionar para URL pré-assinada nem expor o bucket inteiro.
3. **Imutabilidade da publicação frente a edições posteriores de perfil/submissão:** quando o autor altera seu resumo ou instituição meses após o evento, ou quando o organizador ajusta o evento, os anais já publicados não devem mutar silenciosamente nem vazar `email`, `userId`, pareceres (`reviews`) ou decisão interna. Ao importar/publicar, o volume gera um **snapshot próprio** em `proceedings_entries` (`snapshotAuthors`, `snapshotAbstract`, `snapshotKeywords`), e a leitura pública aplica `assertProceedingsSemCampoProibido` em desenvolvimento/teste para garantir por construção que nenhum campo interno chegue ao payload ou XML OAI-PMH.

---

## 3. Decisões Técnicas Explicadas

### Snapshot editorial desacoplado (`ProceedingsVolume` + `ProceedingsEntry`)
- **Alternativa descartada:** publicar uma flag `publishedInProceedings` diretamente em `Submission` e renderizar a página pública lendo `Submission` + `SubmissionAuthor` + `User` em tempo real.
- **Por que descartamos:** misturaria mutações do ciclo de revisão/rascunho/perfil do usuário com o documento publicado; além disso, impediria ordenação editorial personalizada, paginação (`startPage`/`endPage`), DOI/ISBN/ISSN do volume, e obrigaria expor consultas complexas com risco de incluir campos internos.

### Fluxo explícito de `CAMERA_READY` + Termo de Autorização pós-aceite
- **Alternativa descartada:** permitir o upload de `CAMERA_READY` em qualquer status da submissão ou reutilizar sempre o `IDENTIFIED_PDF` enviado na submissão inicial.
- **Por que descartamos:** antes do aceite (`SubmissionStatus.ACCEPTED`), os autores frequentemente precisam incorporar correções solicitadas pelos pareceristas. Liberar `CAMERA_READY` apenas em `ACCEPTED` (`canUploadSubmissionFile`) e exigir registro versionado do termo (`proceedingsPermissionAcceptedAt`, `proceedingsPermissionVersion`) garante rastreabilidade editorial e base legal explícita antes de incluir o trabalho nos anais.

### Indexação OAI-PMH 2.0 e `sitemap.xml` com isolamento multi-tenant preservado (`systemClient` + `withTenant`)
- **Alternativa descartada:** consultar `proceedings_volumes` globais desabilitando RLS via conexão superuser fora do padrão do repositório.
- **Por que descartamos:** quebraria o contrato multi-tenant descrito em `AGENTS.md`. O endpoint global `/api/oai` e `/sitemap.xml` usam `systemClient()` apenas para listar IDs de tenants ativos/publicáveis e entram em `withTenant(tenantId, ...)` para cada instituição, reutilizando as mesmas consultas RLS-safe das páginas do evento. O repositório completo de um único evento (`/api/t/[slug]/eventos/[eventSlug]/oai`) permanece 100% isolado no tenant resolvido pelo slug.

### Custo Zero em DOI, Citações e SEO
- **Decisão:** em vez de acoplar integrações pagas (Crossref/DataCite API) ou bibliotecas pesadas de formatação CSL em runtime, a camada pura `citation-rules.ts` gera ABNT (NBR 6023), APA 7, BibTeX e RIS diretamente em TypeScript, enquanto `ProceedingsVolume.doiPrefix` e `ProceedingsEntry.doi` permitem registrar prefixos/DOIs institucionais já obtidos (ex.: Zenodo/CrossRef institucional) quando existirem, mantendo campo opcional sem exigir chave paga.

---

## 4. ADRs da Fase

### ADR-453 — Modelo editorial desacoplado (`ProceedingsVolume` e `ProceedingsEntry`) com snapshot congelado
- **Contexto:** Trabalhos aceitos precisam virar publicação científica estável, com metadados bibliográficos de volume (ISSN/ISBN, ano, prefácio, prefixo DOI) e ordenação/paginação independente do fluxo de avaliação.
- **Decisão:** Criar `proceedings_volumes` (1:1 por evento sob RLS + FORCE) e `proceedings_entries` (N:1 para volume/submissão/arquivo sob RLS + FORCE), armazenando `snapshotAuthors`, `snapshotAbstract` e `snapshotKeywords` na importação/publicação.
- **Justificativa:** Desacopla ciclo de vida da revisão (e alterações futuras no cadastro de usuários) do registro bibliográfico público, permitindo retirar ou republicar um volume sem perder a estrutura editorial.
- **Consequências:** Toda listagem pública e exportação OAI-PMH lê o snapshot editorial; eventuais retificações pós-importação passam por atualização explícita da entrada no painel de anais.

### ADR-454 — Exclusão estrita de `BLIND_PDF` e liberação de `CAMERA_READY` pós-aceite com termo versionado
- **Contexto:** Submissões em duplo-cego possuem `BLIND_PDF` sem identificação de autores, e autores precisam enviar versão final diagramada após aprovação sem contaminar versões em avaliação.
- **Decisão:** Restringir `SubmissionFileKind.CAMERA_READY` apenas quando `Submission.status === 'ACCEPTED'` (`canUploadSubmissionFile`), registrar aceite versionado do termo de publicação em anais (`recordProceedingsPermission`), e proibir `BLIND_PDF` em `canUseFileKindInProceedings` tanto na regra pura quanto na importação e streaming público.
- **Justificativa:** Previne vazamento acidental de arquivo cego nos anais e garante que apenas versões finais identificadas (ou `IDENTIFIED_PDF` quando autorizado) fiquem acessíveis após aceite.
- **Consequências:** Entradas importadas sem arquivo compatível ficam listadas no rascunho administrativo como pendentes de versão final até o envio pelo autor ou associação explícita pelo organizador.

### ADR-455 — Streaming público inline sem URL pré-assinada para PDF de anais (`citation_pdf_url`)
- **Contexto:** Indexadores acadêmicos (Google Scholar / Highwire Press) exigem URL estável e direta em `citation_pdf_url` com resposta `application/pdf`, incompatível com URLs pré-assinadas S3/MinIO temporárias e com o bucket privado de submissões.
- **Decisão:** Expor `/api/t/[tenantSlug]/eventos/[eventSlug]/anais/[protocol]/arquivo` que resolve volume publicado + entrada incluída + arquivo válido (`canUseFileKindInProceedings` + `canServeFile`) e transmite o stream do MinIO com `Content-Disposition: inline`, `Content-Type: application/pdf` e cache público moderado.
- **Justificativa:** Mantém o bucket privado protegido, honra o bloqueio antivírus (`INFECTED` nunca servido, `PENDING` bloqueado com scanner ativo) e entrega URL permanente para indexadores.
- **Consequências:** O tráfego de download de PDFs dos anais passa pelo servidor web Next.js; caso haja alta escala no futuro, um proxy/CDN HTTP com respeito a headers de cache resolve sem mudar a arquitetura de dados.

### ADR-456 — Indexação custo zero via Highwire Press, JSON-LD, Sitemap dinâmico e OAI-PMH 2.0 sob `withTenant`
- **Contexto:** Repositórios institucionais e agregadores acadêmicos (OASISBR, LA Referencia, Google Scholar) consomem metadados padronizados (`citation_*`, `DC.*`, Schema.org `ScholarlyArticle`, `sitemap.xml` e protocolo OAI-PMH 2.0 `oai_dc`).
- **Decisão:** Gerar metatags Highwire Press + Dublin Core + JSON-LD na página pública do trabalho (`/anais/[protocol]`), expor `/sitemap.xml` e `/robots.txt` dinâmicos (`force-dynamic`) e implementar handlers OAI-PMH 2.0 por evento (`/api/t/[slug]/eventos/[eventSlug]/oai`) e agregado (`/api/oai`) iterando tenants via `systemClient()` + `withTenant`.
- **Justificativa:** Garante interoperabilidade imediata com indexadores sem custo de serviços externos e sem abrir brecha no isolamento multi-tenant do PostgreSQL.
- **Consequências:** Como `robots.ts` e `sitemap.ts` consultam apenas volumes `PUBLISHED`, eventos em rascunho ou privados nunca aparecem no índice público.

---

## 5. Lições Aprendidas (Defeitos Reais Encontrados Nesta Fase)

| Sintoma | Causa raiz | Correção aplicada |
|---|---|---|
| Teste de integração `f111-anais-banco.test.ts` falhou no setup ao criar usuário de teste (`emailVerified` inválido) | No `schema.prisma`, `User.emailVerified` é `DateTime?`, e não booleano | Passado `new Date()` na fixture de usuário do teste de integração |
| Upload de arquivo PDF sintético em teste de integração falhou na validação de magic bytes | `confirmUpload` valida os primeiros **5 bytes** `%PDF-`, enquanto o fixture enviou apenas 4 bytes (`%PDF`) | Atualizado o payload do fixture para começar com `%PDF-1.4` |
| Erro de tipo em `proceedings-service.ts` ao chamar `recordAudit` | A assinatura canônica é `recordAudit(input, tx?)` com parâmetro `userId` e objeto `changes`, e não propriedades planas | Ajustadas as chamadas em `proceedings-service.ts` e `submission-service.ts` para `recordAudit({ ..., userId, changes }, tx)` |
| Erro de compilação TypeScript em `Event.country` no gerador de contexto bibliográfico | `Event.country` no schema Prisma é nulável (`string | null`) | Aplicado fallback `country: event.country ?? 'BR'` na montagem do `ProceedingsPublicationContext` |
| Erro de assinatura em `proceedings/page.tsx` e `AdminPanel` (`requireUuidParam` e `<Field>`) | `requireUuidParam` recebe `(params, key)` e `<Field>` do design system usa `label` em vez de `title` | Alinhadas chamadas para `requireUuidParam(params, 'eventId')` e propriedades de `<Field>` para `label`/`htmlFor`/`hint` |
| `getEventAreaCounts` falhou em runtime nos testes `f54-area-counts` e `f77-caminho-de-partida` | `tx.proceedingsEntry.count({ where: { ...escopo, includeInProceedings: true } })` espalhou `{ tenantId, eventId }`, mas `ProceedingsEntry` não tem coluna `eventId` (pertence a `volume`, que tem `eventId`), gerando erro `Unknown argument eventId` no Prisma ignorado pelo spread estrutural no TypeScript | Alterada a consulta em `src/lib/events/event-area-counts.ts` para `where: { tenantId: input.tenantId, includeInProceedings: true, volume: { tenantId: input.tenantId, eventId: input.eventId } }` |
| Catraca `f78-topo-unico.test.ts` apontou páginas não inventariadas após criação das novas telas | Toda nova `page.tsx` precisa estar declarada no catálogo de `PAGINAS` + `MIGRADAS` (quando usa `<PageHeader>`) em `f78-topo-unico.test.ts` | Adicionadas as 3 rotas novas (`administracao/eventos/[eventId]/anais` migrada; páginas públicas de anais declaradas como exceção com `EventLanding`/renderer público) em `f78-topo-unico.test.ts` |
| Regressão visual `f62` reprovou 2 snapshots públicos do evento (`evento-aba-agora.png` e `evento-bloco-de-local.png`) por deslocamento vertical de 8 px | A barra `<nav>` em `EventLanding` trocou `mx-auto max-w-5xl` por `flex items-center` mesmo sem anais publicados, comprimindo a line-box de `24px` do link `text-xs` para `16px` e deslocando toda a hero para cima | Aplicado `flex items-center` na barra `<nav>` de `EventLanding` apenas quando `event.hasPublishedProceedings` for verdadeiro, mantendo pixel-parity absoluta nos eventos sem anais publicados |

---

## 6. Evidência de Verificação

```text
npm run lint
→ Command exited with code 0 (0 erros, 0 warnings)

npm run typecheck
→ Command exited with code 0 (tsc --noEmit sem erros)

npm test
→ Test Files  291 passed (291)
→ Tests       4895 passed (4895)

npm run db:verify
→ Contrato íntegro. (RLS habilitada + FORCE, policies, role eventflow_app sem superuser/BYPASSRLS, tabelas de plataforma inalcançáveis)

npm run db:verify:isolation
→ 9/9 verificações passaram. Isolamento entre tenants garantido pelo banco.

npm run db:partitions
→ todas as partições do intervalo já existiam (total: 222659 linha(s) em audit_logs)

npm run build
→ Compiled successfully in 2.8s · Finished TypeScript in 4.4s · Generating static pages (19/19) in 387ms
→ Rotas listadas: /api/oai, /api/t/[tenantSlug]/eventos/[eventSlug]/oai, /api/t/[tenantSlug]/eventos/[eventSlug]/anais/[protocol]/arquivo, /api/t/[tenantSlug]/eventos/[eventSlug]/anais/[protocol]/citacao, /robots.txt, /sitemap.xml, /t/[tenantSlug]/administracao/eventos/[eventId]/anais, /t/[tenantSlug]/eventos/[eventSlug]/anais, /t/[tenantSlug]/eventos/[eventSlug]/anais/[protocol]

docker compose --profile app up -d --build web worker
→ Image eventflow/web:local & eventflow/worker:local construídas e containers ativos (eventflow-web healthy na porta 3000)
→ Probes HTTP reais: /robots.txt (200 OK), /sitemap.xml (200 OK), /api/oai?verb=Identify (200 OK application/xml)

npm run test:e2e
→ 554 passed · 1 skipped (555 casos em 9.7m) — inclui os 5 cenários novos de F111 (7.5s) e 23/23 regressão visual f62 (0 re-baseline)
```

---

## 7. Comandos Operacionais

```bash
# Aplicar migração e validar contrato RLS/isolamento
npx prisma migrate deploy
npm run db:verify
npm run db:verify:isolation

# Testes específicos da FASE 111
npx vitest run tests/unit/f111-anais-citacoes-e-indexacao.test.ts
npx vitest run tests/integration/f111-anais-banco.test.ts
npx playwright test tests/e2e/f111-anais-publicacao-e-indexacao.spec.ts

# Endpoints OAI-PMH e SEO (com app no ar em http://localhost:3000)
curl -s "http://localhost:3000/robots.txt"
curl -s "http://localhost:3000/sitemap.xml"
curl -s "http://localhost:3000/api/oai?verb=Identify"
curl -s "http://localhost:3000/api/oai?verb=ListRecords&metadataPrefix=oai_dc"
```

---

## 8. Dívidas Técnicas e Pontos de Atenção

- **Nenhuma dívida técnica aberta foi quitada nem declarada na FASE 111** (mantidas **42 dívidas abertas** em `docs/dividas-tecnicas.md`).
- **Pontos de atenção:**
  - O preenchimento de `DOI`, `ISSN`/`ISBN` e prefixo institucional depende de o organizador possuir os códigos junto ao provedor externo (ex.: Zenodo/CrossRef/IBICT); a plataforma não emite DOI pago automaticamente por premissa de custo zero.
  - O endpoint de streaming `/api/.../anais/[protocol]/arquivo` serve os bytes pelo processo Node/Next.js com `Cache-Control: public, max-age=300, stale-while-revalidate=3600`; em eventos com pico extremo de downloads simultâneos de PDFs grandes, recomenda-se cache reverso (CDN/Nginx) na frente.
  - `ProceedingsEntry.snapshotAuthors` congela autores no momento da importação/publicação; mudanças posteriores no perfil do autor não alteram os anais já publicados a menos que o organizador reimporte ou atualize a entrada.

---

## 9. Checklist de Aceite

- [x] Modelo de dados (`ProceedingsVolume`, `ProceedingsEntry`, `SubmissionFileKind.CAMERA_READY`, termo em `Submission`) com RLS + FORCE e migração aplicada
- [x] Domínio puro em `src/domain/proceedings/*` (regras de anais, ABNT/APA/BibTeX/RIS, Highwire Press, Dublin Core, JSON-LD, OAI-PMH) sem dependência de Prisma ou Next
- [x] Fluxo pós-aceite em `/t/[slug]/submissoes/[submissionId]` com envio de `CAMERA_READY` e aceite versionado de publicação em anais
- [x] Painel do organizador em `/t/[slug]/administracao/eventos/[eventId]/anais` integrado ao mapa do evento (`event-areas.ts` + `event-area-counts.ts`)
- [x] Vitrine pública de anais (`/anais` e `/anais/[protocol]`), caixa de citações/exportação `.bib`/`.ris`, metatags `citation_*`/`DC.*`, JSON-LD `ScholarlyArticle`, `sitemap.xml`, `robots.txt` e OAI-PMH 2.0
- [x] Streaming seguro de PDF público sem vazamento de `BLIND_PDF`, URLs pré-assinadas expiradas ou arquivos bloqueados pelo antivírus
- [x] Bateria completa da seção 4 (`lint`, `typecheck`, `test`, `build`, `db:verify*`, `db:partitions`, Docker rebuild + `test:e2e`) verde após a última edição
