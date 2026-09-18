# Levantamento de dívidas técnicas — o que falta implementar

> **Documento vivo.** Reúne as dívidas e pontos de atenção declarados nas FASES 1 a 11B,
> verifica quais continuam abertos **no código de hoje** e propõe um agrupamento para
> implementação. Atualize-o quando uma fase quitar itens — o histórico do que já foi
> resolvido está na seção 2, para que este documento não repita trabalho feito.
>
> Levantamento feito em **2025-09-17**, sobre a árvore em `FASES 1 a 11B (70 ADRs)`.
> Atualizado após a **FASE 12** (8 itens), a **FASE 13** (A1, B1, B2, B3, B4), a
> **FASE 14** (C1, C3, I4), a **FASE 16** (G1–G7 + F1), a **FASE 17** (E3, E4, E5, E6), a
> **FASE 23** (E9–E13) e a **FASE 24** (E14–E17).
>
> **Numeração dos temas:** cada tema tem um número FIXO — o número identifica o tema, não a
> ordem de entrega. A FASE 15 (Comunicação) segue pendente e a FASE 16 (Sorteios) foi
> entregue antes dela por decisão do humano. Os rótulos anteriores estavam defasados em um
> (a "F12 — Operação e segurança" virou FASE 13 e a "F15 — Quotas e planos" virou FASE 14),
> e essa distância foi a origem de uma dúvida real na hora de aprovar uma fase — por isso o
> número passou a ser do tema, e a situação de cada um vive na tabela do `AGENTS.md`.

---

## 1. Como este levantamento foi feito

1. **Extração** da seção "Dívidas técnicas e pontos de atenção" (ou "trabalho adiado",
   nas fases 1–8) de cada `docs/fase-*.md`.
2. **Verificação no código** de cada item que pudesse ter sido resolvido por uma fase
   posterior — com busca dirigida em `src/**` (ex.: `maxMembers`, `REVIEWER_TOP`,
   `scanStatus`, `unstable_cache`, `SPONSOR_MANAGE`, `axe-core`, `pgbouncer`).
3. **Classificação** por tema, impacto e esforço, com a coluna **"verificado"**
   indicando se a ausência foi confirmada no código ou se é decorrência declarada.

**Esforço:** `P` ≈ até meio dia · `M` ≈ 1–2 dias · `G` ≈ 3+ dias ou exige desenho novo.

---

## 2. Já quitado desde os documentos de fase (não repetir)

| Item | Origem | Onde foi resolvido |
|---|---|---|
| Lista de tabelas de RLS escrita à mão (tabela nova nascia sem policy) | F1 | **F8** — o provisionamento descobre tabelas por introspecção |
| Cache de resolução de tenant com status obsoleto (suspensão não valia) | F9 (achado em E2E) | **F9** — status relido a cada resolução |
| Diagnóstico de depuração visível na página pública (`cap=… mem=…`) | F3 | **F10** — removido; atributos `data-*` |
| `OWNER = ALL_PERMISSIONS` daria `platform:manage` a todo dono | F2 | **F9** — `TENANT_PERMISSIONS` |
| Dockerfile da aplicação, seed, fila real do worker | F1, F2 | **F2, F6, F7** |
| Bloqueio de conflito de agenda e edição de atividades pela UI | F3 | **F7** |
| Painel administrativo de cartas/missões/certificados | F5, F6, F7 | **F7** |
| Cor crua (150 ocorrências), tamanho arbitrário, dois `Field`, Tailwind duplicado no tema do evento, raridade fora dos tokens de tier | F11A | **F11B** |
| Contagens de documentação desatualizadas (permissões, testes) | F2 | Corrigidas; a trava de fase agora confere no código |
| **Mutirão de 8 itens rápidos**: I7 (equipe de evento no credenciamento), I3 (evento restrito), I5 (índice único de concessão), C2 (quota de eventos), I1 (cache distribuído), I2 (diretório sem truncamento), H2 (wrappers), H4 (`code-data`) | Levantamento F1–11B | **FASE 12** — `docs/fase-12-mutirao-dividas.md` |
| **A1 — Rate limit distribuído** | F2, F3, F4 | **FASE 13** — `INCR`+`PEXPIRE`+`PTTL` atômicos em Lua, falha aberta; `src/lib/auth/rate-limit-storage.ts` |
| **B1 — Observabilidade** | Dívida geral | **FASE 13** — métricas no formato Prometheus em `/api/metrics` (fechado por token), log estruturado com redação, Proxy instrumentado |
| **B2 — RLS fora das migrações** | F1 | **FASE 13** — policies na migração `20260917191000_rls_policies`; o init virou stub |
| **B3 — Particionamento do `AuditLog`** | F1 | **FASE 13** — partição mensal + PK `(id, createdAt)` + partição `DEFAULT` + `npm run db:partitions` |
| **B4 — PgBouncer (transaction pooling)** | F1, F2 | **FASE 13** — perfil `pooler` no compose + `npm run db:verify:pooling` |
| **C1 — `maxMembers` não era aplicado** | F10 | **FASE 14** — `evaluateMemberQuota` + caminho de escrita real (`addTenantMember`) no painel de plataforma, auditado |
| **C3 — Edição de plano e quotas pela UI** | F9 | **FASE 14** — `updateTenantPlan` + "Plano e quotas" no detalhe da instituição, com avisos de redução |
| **I4 — Lista de membros poluída por participantes** | F10 | **FASE 14** — `MembershipKind` (equipe × público), backfill, contadores separados e tela de equipe |
| **G1–G7 — Sorteios de ponta a ponta** | F8 | **FASE 16** — suplentes, entrega do prêmio, peso por minutos, commit-reveal, resultado público com nome mascarado, paginação do histórico e prévia ao vivo do credenciamento |
| **F1 — Gatilhos `REVIEWER_TOP` e `EVENT_ATTENDANCE_FULL`** | F5 | **FASE 16** — presença total concedida no check-out que fecha a última atividade e revisor destaque premiado por ranking com piso |
| **E3 — Editor visual da landing page** | F7 | **FASE 17** — `landing-service` + editor em `/administracao/eventos/<id>/pagina`, com conteúdo validado por tipo no domínio, ordem reescrita, publicação explícita e composição sugerida |
| **E4 — Upload de imagem de capa** | F3, F7 | **FASE 17** — upload direto ao bucket público de assets, com allowlist de tipo e verificação da assinatura real do arquivo (`image-rules`) |
| **E5 — Cadastro de patrocinadores pela UI** | F7 | **FASE 17** — cotas e patrocinadores em `/administracao/eventos/<id>/patrocinadores`, com limite de vagas na transação, logotipo por upload, contrato e documento fiscal mascarado |
| **E6 — Edição de coautores pela UI** | F4, F7 | **FASE 17** — editor de autoria na tela da submissão, com ordem de crédito reindexada, autor correspondente único, vínculo de conta preservado e edição restrita ao estado editável |
| **E9 — Pré-visualização da página** | FASE 17 (novo) | **FASE 23** — a página pública virou componente (`EventLanding`) consumido pela rota pública e pela prévia autenticada; a prévia mostra o rascunho com selo de estado e avisa quando a página está vazia |
| **E10 — Upload de imagem na galeria** | FASE 17 (novo) | **FASE 23** — a esteira de upload foi extraída (`asset-upload`) e o alvo `GALLERY` devolve a URL ao formulário, sem coluna; o vínculo passa pela validação do conteúdo do bloco |
| **E11 — Reaproveitar patrocinador entre eventos** | FASE 17 (novo) | **FASE 23** — `listSponsorCandidates` + `copySponsorToEvent`: cópia com cota casada pela CHAVE, cadastro oculto e sem valor de contrato, duplicidade recusada |
| **E12 — Histórico de versões da página** | FASE 17 (novo) | **FASE 23** — tabela `event_page_versions` com snapshot, checksum, motivo e autor; restauração por substituição total, 20 versões por página, deduplicação por checksum |
| **E13 — Publicação agendada** | FASE 17 (novo) | **FASE 23** — `EventPage.publishAt` decidido na LEITURA (`publishAt <= now`), sem agendador; despublicar limpa a data |
| **E14 — Biblioteca de mídia** | FASE 23 (novo) | **FASE 24** — tabela `media_assets` com RLS: todo envio (capa, logotipos, galeria) passa a registrar autor, tamanho, checksum e finalidade; mesma imagem é reaproveitada e a exclusão **confere o uso** antes de apagar |
| **E15 — Patrocinador copiado não acompanhava a origem** | FASE 23 (novo) | **FASE 24** — `sponsors.sourceSponsorId` + `planSponsorSync`: sincronizar propaga só os dados da empresa (nome, descrição, site, logotipo, contato, documento), preservando cota, contrato, vigência e exibição |
| **E16 — Sem `unpublishAt`** | FASE 23 (novo) | **FASE 24** — `EventPage.unpublishAt` na MESMA condição de leitura; janela invertida e término vencido são recusados, e o estado `WINDOW_CLOSED` explica a página fora do ar |
| **E17 — Fuso do agendamento vinha do navegador** | FASE 23 (novo) | **FASE 24** — a data digitada é interpretada no **fuso do EVENTO** (`zonedWallTimeToInstant`, duas passagens, correto em horário de verão), com o fuso viajando em campo oculto e nomeado na mensagem de sucesso |

---

## 3. Resumo por tema

| Tema | Itens abertos | Dos quais rápidos (P) | Risco se ficar como está |
|---|---|---|---|
| A. Segurança e conformidade | 4 | 0 | Alto — arquivos sem varredura; assinatura de certificado ainda simétrica |
| B. Confiabilidade e operação | 5 | 3 | Baixo — log estruturado parcial, partições sem agendamento e sem coletor |
| C. Quotas e billing | 2 | 0 | Médio — quota de armazenamento registrada e não aplicada; ciclo de vida do membro só por SQL |
| D. Comunicação e comunidade | 6 | 3¹ | Alto para adoção — não há um único e-mail; convite é manual |
| E. Jornada do participante | 7 | 2 | Médio — atrito e listas sem paginação; o acervo cresce sem miniatura nem busca |
| F. Gamificação | 5 | 0 | Baixo — mecânicas já existem sem gatilho automático |
| G. Sorteios | 6 | 3 | Médio — o sorteio está completo; falta o descarte de uma entrega registrada por engano |
| H. Design e acessibilidade | 4 | 1 | Baixo — aparência consistente; composição heterogênea |
| I. Plataforma e diretório | 1 | 0 | Baixo — resta a sigla × nome na detecção de conflito |
| **Total** | **40** | **12** | (8 quitados na FASE 12 · 5 na FASE 13 · 3 na FASE 14 · 8 na FASE 16 · 4 na FASE 17 · 5 na FASE 23 · 4 na FASE 24, mais o que cada uma declarou de novo) |

> O total é a **soma das tabelas de tema** (4+5+2+6+7+5+6+4+1 = 40), e não a subtração do
> número original: cada fase que quita itens também descobre outros (a FASE 13 acrescentou
> B6–B9, a FASE 14 acrescentou C4–C5, a FASE 16 acrescentou G8–G13, a FASE 17 acrescentou
> E9–E13, a FASE 23 acrescentou E14–E17 e a FASE 24 acrescentou E18–E20).
>
> **Correção de contagem (FASE 23):** o total anterior dizia 46 com o tema E valendo 13,
> mas a tabela de E tinha NOVE linhas (E1, E2, E7, E8, E9–E13) — o número foi escrito a
> partir da soma esperada, não da contagem real. Com E3–E6 quitados na FASE 17 e E9–E13
> quitados nesta, a tabela de E ficou com oito itens e o consolidado voltou a 41. O rodapé
> anterior já registrava esse mesmo tipo de erro ("dizia 40 enquanto a soma dava 44"); a
> regra continua sendo **contar as linhas**, não somar de cabeça.
>
> **Correção de contagem (FASE 24):** a coluna "rápidos (P)" foi **recontada a partir da
> coluna "Esforço"** de cada tabela, porque a distribuição por tema não batia com as linhas
> (dizia B=1, C=1, F=2 e H=2, quando as tabelas têm B=3, C=0, F=0 e H=1). O total por acaso
> já era 12 e continua 12 — o que estava errado era onde os itens estavam. A marca **¹**
> em D lembra que os três itens rápidos de comunicação (D3, D5, D6) são rápidos **só depois
> de D1**, que é esforço G: a F15 continua sendo a fase grande que destrava as outras.

---

## 4. Levantamento detalhado

### A. Segurança e conformidade

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| A2 | **Assinatura assimétrica de certificado (PKCS#7/CMS)** | F1, F6 | Trocar HMAC por chave privada + certificado; `signatureAlg`/`keyId` já preparados; exige cofre de chave | Terceiros não validam offline sem confiar na instituição | G | Decorrente |
| A3 | **Antivírus nos arquivos de submissão** | F4, F6 | `scanStatus` é `SKIPPED` (`submission-service.ts`); integrar ClamAV ao worker | Arquivo malicioso armazenado e servido por URL assinada | M | Sim |
| A4 | **Auditoria de leitura de dados pessoais** | F7 | A trilha registra mutações; quem **visualizou** não é registrado | Sem rastro em incidente de acesso indevido | M | Decorrente |
| A6 | **Login social (Google/ORCID)** | F2 | Tabela `account` é multi-provedor; falta o provedor e as credenciais | Atrito de cadastro em público acadêmico | M | Sim |

> A5 (verificação de e-mail) continua agrupado com **D1** na F14 candidata: depende do
> provedor de e-mail, que é o item que a fase de Comunicação entrega primeiro.

### B. Confiabilidade e operação

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| B5 | **`unstable_cache` → `use cache`** | F9 | API legada no diretório público | Dívida de atualização do framework | P | Sim |
| B6 | **Adoção do `logger` nos serviços** | F13 (novo) | A FASE 13 migrou os pontos de operação; ~66 `console.*` seguem nos serviços (`catalog-service`, `certificate-service`, `raffle-service`, …) | Log sem estrutura nem redação nesses caminhos | M | Sim |
| B7 | **Agendamento da manutenção de partições** | F13 (novo) | `npm run db:partitions` precisa de cron/orquestrador; o projeto não tem scheduler | Mês sem partição cai na `DEFAULT`; o resgate funciona, mas a retenção por `DROP` perde o sentido | P | Sim |
| B8 | **Política de retenção da auditoria** | F13 (novo) | Decisão de negócio (LGPD × guarda): nada é descartado hoje | A `DEFAULT` e o histórico crescem sem limite definido | P | Decorrente |
| B9 | **Coletor de métricas (Prometheus/Grafana)** | F13 (novo) | O endpoint é o contrato; falta quem raspe e alerte | Métrica existe e ninguém lê; `bullmq_queue_up 0` não vira alerta | M | Decorrente |

### C. Quotas e billing

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| C4 | **Quota de armazenamento não é aplicada** | FASE 14 (novo) | `maxStorageBytes` é gravada do plano e exibida na tela de plano, mas nenhum caminho soma bytes antes de aceitar upload (submissões e avatares) | A tela sugere um limite que não existe; um cliente ocupa o storage sem teto | M | Sim |
| C5 | **Ciclo de vida do membro pela UI** | FASE 14 (novo) | `tenant:member:remove` e `tenant:role:assign` existem e não têm tela; a FASE 14 entregou vincular, não desvincular nem trocar papel | Reduzir a equipe (e portanto reduzir quota) continua sendo SQL | M | Sim |

### D. Comunicação e comunidade

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| D1 | **E-mail transacional (nenhum existe)** | F2, F6, F9, F10 | Provedor + templates (verificação, convite, certificado, prazo de parecer, conquista) | Toda comunicação depende de aviso manual; bloqueia metade das fases futuras | G | Sim |
| D2 | **Convites de membros pela UI** | F2, F7, F9, F10 | `tenant:member:invite` existe e guarda o painel; o fluxo não existe — vincular é SQL/seed | Instituição não consegue trazer a própria equipe | M | Sim |
| D3 | **Notificação de atribuição de revisão** | F4 | `dueAt` e `isOverdue` já existem; nada é enviado | Revisor só descobre entrando na tela | P¹ | Decorrente |
| D4 | **Lembrete e expiração de prazo de parecer** | F4 | Exige job agendado (BullMQ já de pé) | Prazos vencem sem aviso | M | Decorrente |
| D5 | **Notificação de conquista/carta** | F5 | Celebração é local (confete); nada sai da tela | Gamificação perde o efeito de surpresa | P¹ | Decorrente |
| D6 | **Notificação de certificado emitido** | F6 | É preciso entrar na tela para ver | Documento fica esquecido | P¹ | Decorrente |

¹ Depende de **D1** (sem provedor de e-mail, não há o que enviar).

### E. Jornada do participante

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| E1 | **Fila de espera com prazo de confirmação** | F3 | Hoje o promovido é confirmado automaticamente; falta prazo (ex.: 48 h) e promoção do próximo | Vaga fica presa com quem não responde | M | Decorrente |
| E2 | **Paginação das listagens públicas** | F3, F4, F7 | Eventos e submissões carregam tudo (limite 100–200); só o diretório pagina | Degrada na casa dos milhares | M | Sim |
| E7 | **Validação de certificados em lote** | F6 | Serviço existe; falta a tela que confere uma lista de códigos | Contratação verifica um por um | P | Sim |
| E8 | **Exportação de certificados em ZIP** | F6 | Nada no código (`zip|archiver|jszip` = 0) | Organizador baixa um a um | M | Sim |
| E18 | **Miniaturas no acervo de mídia** | FASE 24 (novo) | A lista do acervo carrega a imagem INTEIRA para desenhar um quadrado pequeno; falta gerar (ou servir) uma miniatura | Acervo com 20 fotos de 3 MB baixa dezenas de MB só para abrir a tela | M | Sim |
| E19 | **Busca e filtro no acervo de mídia** | FASE 24 (novo) | A listagem traz as 200 mais recentes, sem filtro por tipo, evento ou "em uso" (a tela mostra o uso, não filtra por ele) | Acervo grande exige rolar e comparar a olho | P | Sim |
| E20 | **Sincronizar todas as cópias de uma vez** | FASE 24 (novo) | A sincronia é por patrocinador (ADR-111); falta aplicar a mesma origem a todas as cópias de uma vez | Instituição com muitas edições sincroniza uma cópia por vez | M | Sim |

### F. Gamificação

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| F2 | **Trocas e crafting de duplicatas** | F5 | `UserCard.quantity` acumula; não há conversão nem troca | Duplicata sem valor percebido | G | Decorrente |
| F3 | **Níveis de carta** | F5 | `UserCard.level` existe e fica em 1 | Mecânica futura | M | Decorrente |
| F4 | **Histórico de temporadas** | F5 | `seasonXp`/`seasonKey` sem arquivo nem reset agendado | Sem memória de temporada | M | Decorrente |
| F5 | **Ranking por evento** | F5 | Ranking é da instituição; filtrar por evento exige decidir semântica do XP | Relatório por evento limitado | M | Decorrente |
| F6 | **Antifraude de proximidade no credenciamento** | F5 | `latitude`/`longitude`/`qrNonce` existem; validação não | Check-in pode ser feito de qualquer lugar | M | Decorrente |

### G. Sorteios

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| G8 | **Desfazer uma entrega registrada por engano** | FASE 16 (novo) | O recibo de entrega é imutável por decisão (ADR-086); corrigir exige SQL | Um clique errado no balcão fica registrado até alguém corrigir no banco | P | Sim |
| G9 | **Busca e filtro no histórico de sorteios** | FASE 16 (novo) | A paginação existe (G6); filtrar por status/período ainda não | Evento com muitos sorteios exige navegar página a página | P | Sim |
| G10 | **Premiar mais de um revisor pela tela** | FASE 16 (novo) | `awardTopReviewers` aceita `top` N, mas o painel fixa 1 | Premiar os 3 primeiros exige chamada direta ao serviço | P | Sim |
| G11 | **Página própria do resultado publicado** | FASE 16 (novo) | A seção na página do evento resolve a divulgação; não há página nem feed por sorteio | Quem acompanha um sorteio específico navega até o evento | M | Decorrente |
| G12 | **Rotação do segredo do cofre de sementes** | FASE 16 (novo) | A chave de selagem é derivada de `BETTER_AUTH_SECRET`; não há versão de chave | Trocar o segredo invalida a abertura de sementes ainda seladas | M | Decorrente |
| G13 | **Prévia ao vivo por evento em vez de polling** | FASE 16 (novo) | Polling de 5s por tela aberta (ADR-090); SSE/WebSocket é a evolução | 12 requisições/min por tela; número pode atrasar segundos em rede lenta | M | Decorrente |

### H. Design e acessibilidade

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| H1 | **Composição das telas antigas** | F11B | Cores e tipografia migradas; cartões e cabeçalhos ainda escritos à mão em vez de `PageHeader`/`SectionHeading` | Títulos e espaçamentos levemente heterogêneos | M | Sim |
| H3 | **Tema escuro completo** | F11A, F11B | `.dark` só evita variável indefinida; a escala escura não foi desenhada | Quem usa tema escuro do sistema vê o claro | M | Sim |
| H5 | **Testes de acessibilidade (`@axe-core/playwright`)** | F2, F3 | Recomendado desde a F2; não existe | Regressão de acessibilidade passa despercebida | P | Sim |
| H6 | **Regressão visual (`toHaveScreenshot`)** | F11B | Sem snapshot de tela | Troca de cor por engano só aparece em revisão manual | M | Sim |

### I. Plataforma e diretório

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| I6 | **Sigla × nome de instituição** | F4 | `institutionsMatch` não resolve "UFRJ" × nome completo; solução é tabela de instituições | Conflito de interesse com falso negativo | M | Decorrente |

---

## 5. Agrupamento proposto para implementação

Ordenado por **risco que elimina × dependência** (não por facilidade):

| Fase candidata | Tema | Itens | Por que nesta ordem |
|---|---|---|---|
| ~~**Operação e segurança**~~ | Rate limit em Redis, observabilidade, particionamento do `AuditLog`, RLS nas migrações, PgBouncer | A1, B1, B2, B3, B4 | **Concluída como FASE 13** — `docs/fase-13-operacao-e-seguranca.md` |
| ~~**Quotas e planos**~~ | `maxMembers` aplicado, edição de plano pela UI, distinção participante × membro | C1, C3, I4 | **Concluída como FASE 14** — `docs/fase-14-quotas-e-planos.md` |
| **F15 — Comunicação** | E-mail transacional + as notificações que dependem dele + convite de membros pela instituição + verificação de e-mail | D1, D2, D3, D4, D5, D6, A5 | É o maior bloqueio de adoção: sem e-mail, convite é manual e metade das fases futuras fica travada. Destrava A5 e D3–D6 de uma vez — e fecha a lacuna que a FASE 14 deixou explícita (convidar de dentro da instituição) |
| ~~**F16 — Sorteios de ponta a ponta**~~ | Suplentes, entrega de prêmio, pesos, commit-reveal, exibição pública, prévia ao vivo | G1–G7 + F1 | **Concluída como FASE 16** — `docs/fase-16-sorteios-de-ponta-a-ponta.md`. Entregue antes da F15 por decisão do humano: o tema estava maduro e não dependia de e-mail |
| ~~**F17 — Landing page e patrocínio**~~ | Editor visual, upload de capa, patrocinadores, coautores | E3, E4, E5, E6 | **Concluída como FASE 17** — `docs/fase-17-pagina-publica-e-patrocinio.md`. A fase não precisou de migração: o modelo da F3/F4 já previa tudo |
| **F18 — Segurança de documentos** | Assinatura assimétrica, antivírus, auditoria de leitura, ZIP, validação em lote | A2, A3, A4, E7, E8 | Documento assinado e arquivo varrido: pré-requisito para uso institucional sério |
| **F19 — Gamificação avançada** | Trocas/crafting, níveis de carta, temporadas, ranking por evento, antifraude de proximidade | F2–F6 | Mecânicas novas; depende de dados reais de uso para calibrar economia |
| **F20 — Observabilidade de segunda ordem** | Trace distribuído, coletor/alerta, adoção do `logger` nos serviços, agendamento da manutenção de partições, política de retenção | B6–B9 | A FASE 13 entregou o sinal; esta fase faz alguém **reagir** a ele |
| **F21 — Ciclo de vida do membro e storage** | Remover/editar papel de membro pela UI e aplicar a quota de armazenamento | C4, C5 | Fecha o que a FASE 14 declarou em aberto: a plataforma vincula, mas ninguém remove pela interface; a quota de storage é registrada e não aplicada |
| **F22 — Operação de palco** | Desfazer entrega registrada, busca no histórico, premiar N revisores, página pública do sorteio | G8–G11 | Itens que só aparecem DEPOIS de operar sorteio de verdade: nasceram da FASE 16 e são baratos |
| ~~**F23 — Conteúdo e mídia**~~ | Prévia da página, upload na galeria, reuso de patrocinador entre eventos, versões da página, publicação agendada | E9–E13 | **Concluída como FASE 23** — `docs/fase-23-conteudo-e-midia.md`. A página pública virou componente compartilhado, e o histórico exigiu a primeira tabela nova desde a FASE 16 |
| ~~**F24 — Mídia e agendamento**~~ | Biblioteca de mídia, vínculo de patrocinador entre eventos, janela de exibição, fuso do agendamento | E14–E17 | **Concluída como FASE 24** — `docs/fase-24-midia-e-agendamento.md`. O bucket deixou de ser a biblioteca: a imagem passou a ter registro, com reaproveitamento por checksum e exclusão que confere o uso |
| **F25 — Acervo de mídia (segunda ordem)** | Miniaturas, busca e filtro no acervo, sincronia em lote | E18–E20 | O que a FASE 24 declarou em aberto: são melhorias de USO do acervo, não requisitos — cabem como carona na F21 (storage) ou num mutirão de meio dia |
| **Transversal (sem fase)** | Composição das telas antigas, tema escuro, `use cache`, paginação, fila com prazo, `@axe-core`, regressão visual | H1, H3, H5, H6, I6, B5, E1, E2 | Itens rápidos que não justificam fase própria: entram como carona nas fases acima ou em "mutirões" de meio dia |

### Mutirão executado na FASE 12 (concluído)

Os oito itens abaixo eram o "primeiro mutirão" sugerido por este levantamento e **foram
implementados na FASE 12** — I7, I3, I5, C2, H2, H4, I1 e I2. O registro completo
(ADRs, lições e evidências) está em
[`docs/fase-12-mutirao-dividas.md`](fase-12-mutirao-dividas.md).

### Fase de operação executada na FASE 13 (concluído)

Os cinco itens de **operação e segurança** (A1, B1, B2, B3, B4) foram implementados na
FASE 13. O registro completo está em
[`docs/fase-13-operacao-e-seguranca.md`](fase-13-operacao-e-seguranca.md), que também
declara as dívidas **novas** que a própria fase criou (B6–B9, na seção B acima).

### Fase de quotas executada na FASE 14 (concluído)

Os três itens de **quotas e planos** (C1, C3, I4) foram implementados na FASE 14 — o que
este documento chamava de "F15". O registro está em
[`docs/fase-14-quotas-e-planos.md`](fase-14-quotas-e-planos.md), que declara as dívidas
novas da fase (C4 e C5, na seção C acima) e a dependência que ficou explícita: convidar
gente nova de dentro da instituição é a F15 (Comunicação).

### Fase de sorteios executada na FASE 16 (concluído)

Os oito itens de **sorteios de ponta a ponta** (G1–G7 + F1) foram implementados na FASE 16,
entregue antes da F15 (Comunicação) por decisão do humano: o tema estava maduro, não
dependia de e-mail e fechava a promessa que a FASE 8 deixou em aberto (o prêmio não era
entregue, o resultado não era público e dois gatilhos de carta nunca disparavam). O
registro está em [`docs/fase-16-sorteios-de-ponta-a-ponta.md`](fase-16-sorteios-de-ponta-a-ponta.md),
que declara as dívidas novas da fase (G8–G13, na seção G acima).

### Fase de página pública e patrocínio executada na FASE 17 (concluído)

Os quatro itens de **conteúdo do evento** (E3, E4, E5, E6) foram implementados na FASE 17: a
instituição monta a própria página pública, envia capa e logotipos, cadastra quem patrocina
e corrige a autoria do trabalho. O registro está em
[`docs/fase-17-pagina-publica-e-patrocinio.md`](fase-17-pagina-publica-e-patrocinio.md), que
declara as dívidas novas da fase (E9–E13, na seção E acima) e o motivo pelo qual a fase
**não teve migração**: `EventPage`, `PageBlock`, `SponsorTier`, `Sponsor` e
`SubmissionAuthor` já existiam desde as FASES 3 e 4, desenhados e sem uso.

### Fase de conteúdo e mídia executada na FASE 23 (concluído)

Os cinco itens que a FASE 17 declarou em aberto (E9–E13) foram implementados na FASE 23: a
pré-visualização do rascunho, o upload de imagem na galeria, a cópia de patrocinador entre
eventos, o histórico de versões com restauração e a publicação agendada. O registro está em
[`docs/fase-23-conteudo-e-midia.md`](fase-23-conteudo-e-midia.md), que declara as dívidas
novas da fase (E14–E17) — todas consequências diretas das decisões tomadas ali: cópia em vez
de vínculo entre evento e patrocinador, bucket como biblioteca de mídia e visibilidade
decidida na leitura (sem agendador).

### Fase de mídia e agendamento executada na FASE 24 (concluído)

Os quatro itens que a FASE 23 declarou em aberto (E14–E17) foram implementados na FASE 24: a
biblioteca de mídia com reaproveitamento e exclusão consciente do uso, a sincronia do
patrocinador copiado, a janela de exibição (entrada **e** saída) e a interpretação da data
agendada no fuso do evento. O registro está em
[`docs/fase-24-midia-e-agendamento.md`](fase-24-midia-e-agendamento.md), que declara as
dívidas novas da fase (E18–E20) e a fronteira que ela **não** cruzou de propósito: o acervo
mede o armazenamento, mas a quota do plano continua sem ser aplicada — decisão de produto
que pertence à F21 junto com o resto do ciclo de vida do membro (dívida C4).

---

## 6. Como manter este documento

1. Ao **iniciar** uma fase candidata: mover os itens dela para o topo do documento de fase
   (`docs/fase-NN-*.md`) com o requisito escrito.
2. Ao **concluir**: remover as linhas daqui e registrá-las na seção 2 (o que já foi
   quitado), com fase e evidência.
3. Item novo descoberto por teste ou uso entra **na seção do tema**, com a coluna
   "verificado" preenchida — foi assim que I7 entrou.
4. O rodapé de cada documento de fase continua sendo a fonte primária; este documento é o
   **consolidado** e não substitui o registro histórico de cada fase.
