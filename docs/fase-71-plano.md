# FASE 71 — A vitrine viva da plataforma · Descoberta de eventos e expansão institucional (PLANO)

> **Estado: PLANO PROPOSTO — Aguardando aprovação do humano.**
> Este documento registra as decisões tomadas no brainstorm, os limites de segurança (RLS/segredos),
> o desenho do banco e a divisão em 4 fatias de execução.

---

## 1. As decisões do humano (Brainstorm)

1. **Estrutura (Opção A)**:
   - `/` — Nova Landing Page da plataforma: atrativa para o participante (busca rápida, eventos em destaque algorítmicos, vitrine interativa da jornada com cartas fictícias e métricas agregadas da plataforma), com faixa de conversão para instituições.
   - `/eventos` — Explorador unificado de eventos com filtros por URL (sem obrigação de JS no cliente) e aba integrada de instituições (redirecionando amigavelmente a antiga `/organizacoes`).
   - `/para-instituicoes` — Página institucional dedicada a gestores e organizadores, detalhando os 5 diferenciais técnicos (gamificação, avaliação cega, QR Code público, crachás/presença e isolamento multi-tenant) com formulário de contato.
2. **Tema do evento**: Lista fixa da plataforma no domínio (`EventCategory`), com taxonomia inicial padronizada de 10 categorias e seleção no cadastro/edição do evento.
3. **Fale conosco**: Formulário com caixa de entrada dedicada no `/superadmin/leads`, armazenado em tabela de plataforma restrita (`institution_leads`).
4. **Visibilidade de eventos**: Abertos para instituições com vitrine ligada (`tenant.isPublic = true`), status publicado (`PUBLISHED` ou `REGISTRATION_OPEN`) e não excluídos.
5. **Métricas agregadas**: Somam todas as instituições operantes (inclusive `isPublic = false`), pois a métrica é um total anônimo da plataforma, com cache global e contadores de impacto.
6. **Escopo**: FASE 71 completa dividida em 4 fatias rigorosas, cobrindo banco, domínio, aplicação, UI, superadmin, testes unitários, de contrato e E2E.

---

## 2. Taxonomia de temas (`EventCategory`)

Categorias propostas para cobrir eventos acadêmicos, corporativos e comunitários:

| Identificador | Rótulo de exibição | Descrição / Exemplo |
|---|---|---|
| `TECNOLOGIA` | Tecnologia & Inovação | Software, Inteligência Artificial, Startups, Hardware |
| `CIENCIA_ACADEMICO` | Ciência, Pesquisa & Academia | Congressos, Simpósios, Encontros Científicos, Trabalhos |
| `SAUDE_BEM_ESTAR` | Saúde, Medicina & Bem-estar | Medicina, Enfermagem, Psicologia, Esporte |
| `EDUCACAO` | Educação & Pedagogia | Formação de Professores, Práticas Pedagógicas, Escolas |
| `NEGOCIOS_GESTAO` | Negócios & Empreendedorismo | Finanças, Liderança, Marketing, Vendas |
| `ENGENHARIA_INDUSTRIA` | Engenharia & Indústria | Civil, Elétrica, Mecânica, Produção, Manufatura |
| `DIREITO_GOVERNANCA` | Direito & Governança | Jurídico, Políticas Públicas, Terceiro Setor, Compliance |
| `ARTE_CULTURA` | Artes, Design & Cultura | Cinema, Teatro, Design, Música, Literatura |
| `MEIO_AMBIENTE` | Sustentabilidade & Meio Ambiente | Ecologia, Agro, Transição Energética, ESG |
| `OUTROS` | Outros temas | Eventos de variedades ou multidisciplinares |

---

## 3. Riscos de segurança e contratos de banco

### R1. Vazamento do `onlineUrl` (armadilha 9 e ADR-187/F68)
- **Risco**: Uma consulta pública global que faz `SELECT *` de eventos vazaria o link da sala fechada do evento online/híbrido.
- **Defesa**: O repositório global `searchPublicEvents` projeta **exclusivamente** os campos da vitrine (`id`, `slug`, `tenantSlug`, `tenantName`, `title`, `summary`, `coverImageUrl`, `modality`, `category`, `city`, `state`, `startsAt`, `endsAt`, `registrationClosesAt`). O campo `onlineUrl` **não é selecionado**. Um teste de contrato e unitário verifica que o objeto retornado não contém `onlineUrl`.

### R2. Tabela de plataforma `institution_leads` (armadilhas 82, 101 e ADR-191)
- **Risco**: Uma tabela sem `tenantId` criada no schema nasce automaticamente com permissões para a role de runtime `eventflow_app`. O contrato (`npm run db:verify`) reprova se a tabela não tiver seus privilégios revogados.
- **Defesa**:
  1. A tabela é declarada em `PLATFORM_ONLY_TABLES` no `src/lib/db/schema-contract.ts`.
  2. A migração SQL executa `REVOKE ALL ON institution_leads FROM eventflow_app`.
  3. `docker/postgres/init/00-roles.sql` e scripts de teste de contrato garantem a ausência de privilégio para a role de runtime.
  4. Somente a conexão administrativa (`adminPrisma`) acessa `institution_leads` na criação via Server Action pública e na gestão pelo `/superadmin/leads`.

### R3. Preservação de RLS e Performance de Cache
- **Métricas agregadas**: O cache de métricas (`getPlatformPublicMetrics`) utiliza `unstable_cache` com tags `platform-metrics` e tempo de expiração de segurança (3600 segundos). Não consulta dados identificáveis de participantes ou instituições privadas individualmente.
- **Busca por URL**: Paginação e filtros são feitos via formulário GET, funcionando sem client JS e produzindo URLs linkáveis e indexáveis por motores de busca.

---

## 4. As 4 fatias de implementação

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ Fatia 1: Schema, Domínio, Segurança e Repositórios Globais                              │
│ • Migração Prisma:                                                                      │
│     - Event: category EventCategory?                                                    │
│     - Tenant: coverImageUrl, segment, city, state                                       │
│     - Tabela institution_leads com índices e REVOKE da role de runtime                  │
│ • Domínio puro:                                                                         │
│     - src/domain/events/event-category-rules.ts (taxonomia e opções)                    │
│     - src/domain/platform/lead-rules.ts (validação e status do lead)                    │
│     - src/domain/platform/platform-metrics-rules.ts (formatação e agregados)            │
│ • Repositórios em src/lib/platform/global-repository.ts (searchPublicEvents, etc.)      │
│ • Atualização de src/lib/db/schema-contract.ts e bateria db:verify passando.           │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ Fatia 2: /eventos — Explorador Unificado de Eventos & Vitrine de Instituições           │
│ • Rota /eventos/page.tsx:                                                               │
│     - Filtros por URL: busca textual, categoria, modalidade, cidade/UF, data            │
│     - Cards ricos de eventos (capa, data no fuso, badge de modalidade e tema)           │
│     - Alternância de abas: "Eventos" e "Instituições"                                   │
│     - Cards de instituições enriquecidos (capa, segmento, localização, total eventos)   │
│ • Redirecionamento 308 de /organizacoes para /eventos?aba=instituicoes                  │
│ • Form de edição de evento ganha seleção de categoria em eventos/[eventId]/configuracoes│
│ • Form de edição de tenant ganha capa, segmento, cidade e estado no superadmin/painel   │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ Fatia 3: / — Nova Landing Page com Foco no Participante & Vitrine Viva                  │
│ • Hero dinâmico com campo de busca direcionando para /eventos                           │
│ • Carrossel / grid de Eventos em Destaque (algoritmo: abertos + mais próximos)          │
│ • Jornada do Participante visual e interativa:                                          │
│     - Inscrição em 1 clique                                                             │
│     - Crachá digital e credenciamento ágil                                              │
│     - Gamificação: exibição de Cards colecionáveis fictícios (CardPreview real)         │
│     - Certificado seguro com QR Code público                                            │
│ • Números agregados da plataforma (contador formatado e cacheado)                       │
│ • Apresentação dos diferenciais e CTA institucional para /para-instituicoes             │
│ • Design Tailwind 4 com gradientes, dark/light mode e acessibilidade (motion-reduce)    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ Fatia 4: /para-instituicoes, Caixa do Superadmin & Bateria de Verificação               │
│ • Rota pública /para-instituicoes/page.tsx:                                             │
│     - Apresentação dos 5 pilares para gestores, organizadores e reitorias               │
│     - Apresentação de planos ("Gratuito" / "Sob medida")                                │
│     - Formulário de contato "Fale conosco" com Server Action segura                     │
│ • Painel do Superadmin: /superadmin/leads                                               │
│     - Listagem de leads com badges de status, data e dados da organização               │
│     - Visualização detalhada e atualização de status (OPEN, CONTACTED, etc.) e notas    │
│ • Bateria de testes completa:                                                           │
│     - Unitários e integração (domínio, busca, contrato, proteção onlineUrl)             │
│     - E2E Playwright: busca de eventos, filtros, envio de lead e triagem superadmin     │
│ • Documentação: docs/fase-71-vitrine-publica-e-instituicoes.md e atualização README.md  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. ADRs da fase (numeração global a partir de 350)

- **ADR-350**: Unificação da descoberta pública em `/eventos` com filtros GET sem JavaScript obrigatório e preservação de links antigos.
- **ADR-351**: Taxonomia fechada de categorias de evento (`EventCategory`) no domínio e repositório global.
- **ADR-352**: Métricas públicas agregadas anônimas e projeção estrita contra vazamento de `onlineUrl`.
- **ADR-353**: Segregação de leads institucionais (`institution_leads`) em tabela de plataforma restrita sem acesso para a role de runtime.
