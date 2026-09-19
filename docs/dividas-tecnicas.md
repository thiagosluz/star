# Levantamento de dívidas técnicas — o que falta implementar

> **Documento vivo.** Reúne as dívidas e pontos de atenção declarados nas FASES 1 a 11B,
> verifica quais continuam abertos **no código de hoje** e propõe um agrupamento para
> implementação. Atualize-o quando uma fase quitar itens — o histórico do que já foi
> resolvido está na seção 2, para que este documento não repita trabalho feito.
>
> Levantamento feito em **2025-09-17**, sobre a árvore em `FASES 1 a 11B (70 ADRs)`.
> Atualizado após a **FASE 12** (8 itens), a **FASE 13** (A1, B1, B2, B3, B4), a
> **FASE 14** (C1, C3, I4), a **FASE 16** (G1–G7 + F1), a **FASE 17** (E3, E4, E5, E6), a
> **FASE 23** (E9–E13), a **FASE 24** (E14–E17), a **FASE 25** (escopo próprio: E21–E24), a
> **FASE 15** (D1–D6 + A5) e a **FASE 21** (C4–C5), com as **revisões pós-entrega** da FASE 25
> (E30), da FASE 4 (E31–E32) e da FASE 3 (E33).
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
| **D1 — E-mail transacional (nenhum existia)** | F2, F6, F9, F10 | **FASE 15** — provedor Resend atrás de um driver com o padrão em NÃO enviar (`resend` \| `log`), fila `emails` no BullMQ com 5 tentativas e backoff, **outbox** `email_messages` (assunto, HTML e texto gravados no enfileiramento), 8 templates em funções puras e redefinição de senha que finalmente avisa alguém |
| **D2 — Convites de membros pela UI** | F2, F7, F9, F10 | **FASE 15** — tabela `tenant_invitations` (token só como SHA-256, 7 dias, um convite PENDENTE por endereço por índice parcial), convite na tela de equipe, página pública de aceite, revogação e novo link; o vínculo `MEMBER` + papel nasce **no aceite**, e é lá que a quota do plano é aplicada |
| **D3 — Notificação de atribuição de revisão** | F4 | **FASE 15** — `notifyReviewAssigned` disparada por `assignReviewer` depois do commit, com prazo no fuso do evento e idempotência por atribuição |
| **D4 — Lembrete e expiração de prazo de parecer** | F4 | **FASE 15** — job repetível `review-deadlines` (de 6 em 6 horas, via `upsertJobScheduler`) + `runReviewDeadlineScan`, que percorre instituição por instituição **sob RLS** e avisa prazo próximo e vencido uma vez por dia por atribuição |
| **D5 — Notificação de conquista/carta** | F5 | **FASE 15** — `notifyCardGranted` no ponto único do motor de recompensas (`grantCardForTrigger`), celebrando apenas carta NOVA (duplicata aumenta quantidade e não é conquista) |
| **D6 — Notificação de certificado emitido** | F6 | **FASE 15** — `notifyCertificateIssued` em `generateCertificate` (vale para a emissão inline e para o worker), com código de validação e link de conferência pública |
| **A5 — Verificação de e-mail** | F2 | **FASE 15** — `emailVerification.sendOnSignUp` envia a confirmação no cadastro (token de 24 h), página `/verificacao` para o resultado e aviso no shell com reenvio; `requireEmailVerification` continua **false** de propósito, e a decisão está travada por teste |

---

## 3. Resumo por tema

| Tema | Itens abertos | Dos quais rápidos (P) | Risco se ficar como está |
|---|---|---|---|
| A. Segurança e conformidade | 4 | 0 | Alto — arquivos sem varredura; assinatura de certificado ainda simétrica |
| B. Confiabilidade e operação | 5 | 3 | Baixo — log estruturado parcial, partições sem agendamento e sem coletor |
| C. Quotas e billing | 2 | 0 | Médio — quota de armazenamento e ciclo de vida do membro entregues na FASE 21; restam a reconciliação banco × bucket e o acesso de participante na remoção |
| D. Comunicação e comunidade | 3 | 1 | Médio — o e-mail agora sai, mas sem domínio verificado só chega a um endereço, e não há webhook de entrega nem preferências |
| E. Jornada do participante | 16 | 3 | Médio — atrito e listas sem paginação; o acervo cresce sem miniatura nem busca, o convite de palestrante é manual (e, sem verificação de e-mail, a entrada por ele se apoia no endereço da conta), não há como retirar uma submissão enviada, a trilha do rascunho só muda recriando e o evento lotado não tem fila de espera |
| F. Gamificação | 5 | 0 | Baixo — mecânicas já existem sem gatilho automático |
| G. Sorteios | 6 | 3 | Médio — o sorteio está completo; falta o descarte de uma entrega registrada por engano |
| H. Design e acessibilidade | 4 | 1 | Baixo — aparência consistente; composição heterogênea |
| I. Plataforma e diretório | 1 | 0 | Baixo — resta a sigla × nome na detecção de conflito |
| **Total** | **46** | **13** | (8 quitados na FASE 12 · 5 na FASE 13 · 3 na FASE 14 · 7 na FASE 15 · 8 na FASE 16 · 4 na FASE 17 · 2 na FASE 21 · 5 na FASE 23 · 4 na FASE 24 · o escopo próprio da FASE 25, mais o que cada uma declarou de novo) |

> O total é a **soma das tabelas de tema** (4+5+2+3+16+5+6+4+1 = 46), e não a subtração do
> número original: cada fase que quita itens também descobre outros (a FASE 13 acrescentou
> B6–B9, a FASE 14 acrescentou C4–C5, a **FASE 15 acrescentou D7–D9**, a FASE 16
> acrescentou G8–G13, a FASE 17 acrescentou
> E9–E13, a **FASE 21 quitou C4–C5 e acrescentou C6–C7**, a FASE 23 acrescentou E14–E17, a FASE 24 acrescentou E18–E20 e a FASE 25
> acrescentou E25–E29 — mais o E30, que a **revisão** da FASE 25 declarou, o E31 e o E32,
> que a **revisão** da FASE 4 declarou, e o E33, que a **revisão** da FASE 3 declarou).
>
> **Nota de contagem (FASE 25):** a fase do portal do palestrante entregou um escopo que
> **não vinha deste levantamento** (foi definido diretamente pelo humano: E21 perfil e
> vínculo de conta, E22 portal e posse, E23 materiais com visibilidade, E24 vitrine e
> certificado de palestrante). Por isso esses quatro **não** entram como linha quitada na
> seção 2 — não eram itens abertos aqui —, mas os cinco que a fase declarou de novo
> (E25–E29) entram na tabela do tema E. O identificador `E21` foi escolhido para não
> colidir com os E18–E20 da FASE 24, que continuam abertos.
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

> **C4 e C5 foram quitados na FASE 21** — `docs/fase-21-ciclo-de-vida-do-membro-e-storage.md`.
> A quota de armazenamento passou a ser medida (submissões + mídia + materiais +
> certificados) e **aplicada** antes de assinar cada URL de upload; o ciclo de vida do membro
> ganhou tela (trocar papéis e remover acesso). O que a fase declarou de novo está abaixo.

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| C6 | **Reconciliação entre banco e bucket** | FASE 21 (novo) | A quota mede o BANCO: objeto que ficou no bucket sem registro (falha no meio do upload) não conta, e excluir o registro não apaga o objeto — a limpeza é manual | O uso medido pode divergir do real, e a diferença só aparece na conta do provedor | M | Sim |
| C7 | **Remover membro não preserva o acesso de participante** | FASE 21 (novo) | O vínculo é UMA linha por (instituição, pessoa): remover a equipe tira junto a área de participante (as inscrições continuam registradas). Falta a ação "rebaixar para participante" (ou separar as duas relações em duas linhas) | Quem era equipe e público perde o acesso às próprias inscrições e certificados — hoje **avisado** no diálogo, mas sem alternativa | M | Sim |

### D. Comunicação e comunidade

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| D7 | **Domínio de envio não verificado** | FASE 15 (novo) | A conta do Resend é de **teste**: o remetente tem de ser `onboarding@resend.dev` e a entrega só alcança o endereço dono da conta. Falta verificar um domínio em `resend.com/domains` e trocar `EMAIL_FROM` | Convite, aviso de avaliação e certificado só chegam a UM endereço enquanto isso | P | Sim |
| D8 | **Sem webhook de entrega** | FASE 15 (novo) | `SENT` significa "aceito pelo provedor"; não há webhook de `delivered`/`bounced`/`complained` nem supressão de endereço inválido | Mensagem aceita e não entregue só aparece no painel do provedor; endereço que quica continua recebendo tentativa | M | Sim |
| D9 | **Sem preferências nem opt-out** | FASE 15 (novo) | Todos os avisos são transacionais e não há central de preferências; a celebração de carta (D5) não pode ser desligada | Quem não quiser a celebração não tem como desligá-la | P | Sim |

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
| E25 | **Convite de palestrante não sai por e-mail** | FASE 25 (novo) | O código de convite é entregue à mão: a plataforma não tem provedor de e-mail (dívida D1/F15) | Evento com 40 palestrantes exige 40 entregas manuais | M | Sim |
| E26 | **Integridade do upload confere só o tamanho quando o storage não reporta checksum** | FASE 25 (novo) | O `PUT` assinado não inclui `x-amz-meta-sha256`; `verifyStoredObject` cai no tamanho (mesmo caminho desde a FASE 4) | Um objeto trocado por outro de MESMO tamanho passaria — hoje nenhum caminho do sistema o produz | M | Sim |
| E27 | **Foto do palestrante só entra por upload** | FASE 25 (novo) | Não há campo de URL para quem hospeda a foto fora (decisão de segurança: a esteira valida a assinatura real) | Quem tem a foto em outro site precisa baixá-la e enviá-la | P | Sim |
| E28 | **Convite em lote / reenvio automático** | FASE 25 (novo) | Cada convite é gerado por palestrante, e regerar invalida o anterior (ADR-114) | Turma grande de convidados exige repetir o fluxo | M | Sim |
| E29 | **`activity_speakers` mantém as colunas legadas duplicadas** | FASE 25 (novo) | Nome, e-mail, instituição e bio existem no perfil e no vínculo, sincronizados por dois caminhos de escrita (ADR-113) | Duas fontes do mesmo dado; a divergência exigiria um backfill | M | Sim |
| E30 | **O convite aberto pelo e-mail da conta se apoia em endereço não verificado** | FASE 25 (revisão, ADR-120) | Quem cria uma conta com o endereço que a organização cadastrou entra no portal e assume o perfil — o mesmo grau de confiança do aceite pelo painel, mas sem a prova de posse do endereço, que é a verificação de e-mail da F15 | Sem F15, um terceiro que consiga criar conta com o e-mail do convidado assume o perfil; a auditoria registra o aceite, e a organização pode desvincular | M | Sim |
| E31 | **O autor não consegue RETIRAR uma submissão já enviada** | FASE 4 (revisão, ADR-122) | A máquina de estados tem `WITHDRAWN` (e o limite da trilha já o ignora na contagem), mas não existe serviço nem tela que o produza — só a comissão pode cancelar, e não há caminho de autor | Quem enviou por engano depende de um pedido manual à comissão, e o trabalho fica no páreo até alguém agir; a tela de exclusão manda falar com a comissão porque não pode oferecer o que não existe | M | Sim |
| E32 | **A trilha do rascunho não pode ser trocada pela interface** | FASE 4 (revisão, ADR-123) | Título, resumo, palavras-chave e idioma são editáveis; a trilha ficou de fora porque trocá-la muda a rubrica de avaliação, o requisito de versão cega e a fila de revisores (decisão do comitê) | Quem escolheu a trilha errada precisa excluir o rascunho e recomeçar — a edição cobre o texto, não a classificação | P | Sim |
| E33 | **Não há lista de espera no nível do EVENTO** | FASE 3 (revisão, ADR-124/125) | A fila existe por ATIVIDADE (com vaga e promoção automática); a inscrição no evento, criada nesta revisão, consome a lotação do evento e, quando ela acaba, **recusa** em vez de enfileirar — quem não coube não entra em fila nenhuma | Evento lotado perde o interessado: não há como saber quem esperava nem promover ninguém quando uma vaga abre; a organização só descobre a demanda por fora | M | Sim |

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
| ~~**F15 — Comunicação**~~ | E-mail transacional + as notificações que dependem dele + convite de membros pela instituição + verificação de e-mail | D1, D2, D3, D4, D5, D6, A5 | **Concluída como FASE 15** — `docs/fase-15-comunicacao.md`. Sem e-mail, convite era manual e metade das fases futuras ficava travada; a fase destravou A5 e D3–D6 de uma vez e fechou a lacuna que a FASE 14 deixou explícita (convidar de dentro da instituição). Declarou D7–D9 |
| ~~**F16 — Sorteios de ponta a ponta**~~ | Suplentes, entrega de prêmio, pesos, commit-reveal, exibição pública, prévia ao vivo | G1–G7 + F1 | **Concluída como FASE 16** — `docs/fase-16-sorteios-de-ponta-a-ponta.md`. Entregue antes da F15 por decisão do humano: o tema estava maduro e não dependia de e-mail |
| ~~**F17 — Landing page e patrocínio**~~ | Editor visual, upload de capa, patrocinadores, coautores | E3, E4, E5, E6 | **Concluída como FASE 17** — `docs/fase-17-pagina-publica-e-patrocinio.md`. A fase não precisou de migração: o modelo da F3/F4 já previa tudo |
| **F18 — Segurança de documentos** | Assinatura assimétrica, antivírus, auditoria de leitura, ZIP, validação em lote | A2, A3, A4, E7, E8 | Documento assinado e arquivo varrido: pré-requisito para uso institucional sério |
| **F19 — Gamificação avançada** | Trocas/crafting, níveis de carta, temporadas, ranking por evento, antifraude de proximidade | F2–F6 | Mecânicas novas; depende de dados reais de uso para calibrar economia |
| **F20 — Observabilidade de segunda ordem** | Trace distribuído, coletor/alerta, adoção do `logger` nos serviços, agendamento da manutenção de partições, política de retenção | B6–B9 | A FASE 13 entregou o sinal; esta fase faz alguém **reagir** a ele |
| ~~**F21 — Ciclo de vida do membro e storage**~~ | Remover/editar papel de membro pela UI e aplicar a quota de armazenamento | C4, C5 | **Concluída como FASE 21** — `docs/fase-21-ciclo-de-vida-do-membro-e-storage.md`. Fechou o que a FASE 14 declarou em aberto: a plataforma vinculava, mas ninguém removia pela interface, e a quota de storage era registrada e não aplicada. Declarou C6–C7 |
| **F22 — Operação de palco** | Desfazer entrega registrada, busca no histórico, premiar N revisores, página pública do sorteio | G8–G11 | Itens que só aparecem DEPOIS de operar sorteio de verdade: nasceram da FASE 16 e são baratos |
| ~~**F23 — Conteúdo e mídia**~~ | Prévia da página, upload na galeria, reuso de patrocinador entre eventos, versões da página, publicação agendada | E9–E13 | **Concluída como FASE 23** — `docs/fase-23-conteudo-e-midia.md`. A página pública virou componente compartilhado, e o histórico exigiu a primeira tabela nova desde a FASE 16 |
| ~~**F24 — Mídia e agendamento**~~ | Biblioteca de mídia, vínculo de patrocinador entre eventos, janela de exibição, fuso do agendamento | E14–E17 | **Concluída como FASE 24** — `docs/fase-24-midia-e-agendamento.md`. O bucket deixou de ser a biblioteca: a imagem passou a ter registro, com reaproveitamento por checksum e exclusão que confere o uso |
| ~~**F25 — Portal do palestrante**~~ | Perfil do palestrante, convite e vínculo de conta, portal com posse, materiais com visibilidade, vitrine e certificado | E21–E24 (escopo definido pelo humano) | **Concluída como FASE 25** — `docs/fase-25-portal-do-palestrante.md`. O palestrante deixou de ser uma linha da atividade e passou a ser uma pessoa da instituição, com portal próprio |
| **F26 — Acervo de mídia (segunda ordem)** | Miniaturas, busca e filtro no acervo, sincronia em lote | E18–E20 | O que a FASE 24 declarou em aberto: são melhorias de USO do acervo, não requisitos — cabem como carona na F21 (entregue) ou num mutirão de meio dia |
| **F27 — Material e convite do palestrante** | Convite por e-mail, integridade forte no upload, foto por URL, convite em lote, colunas legadas | E25–E29 (+ E30) | O que a FASE 25 declarou em aberto (e a revisão dela, o E30). A **FASE 15 entregou a esteira de e-mail**, então E25/E28 agora só precisam do template e do gatilho; a verificação de e-mail também já existe como caminho de confirmação do E30 — o que falta nele é o bloqueio de login |
| **F28 — Entrega de e-mail de segunda ordem** | Domínio verificado no provedor, webhook de entrega (bounce/reclamação), preferências e opt-out | D7, D8, D9 | O que a FASE 15 declarou em aberto. D7 é operação de conta (verificar domínio e trocar `EMAIL_FROM`); D8 e D9 são produto e cabem juntos num mutirão |
| **Transversal (sem fase)** | Composição das telas antigas, tema escuro, `use cache`, paginação, fila com prazo (atividade e evento), `@axe-core`, regressão visual | H1, H3, H5, H6, I6, B5, E1, E2, E33 | Itens rápidos que não justificam fase própria: entram como carona nas fases acima ou em "mutirões" de meio dia |

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
novas da fase (C4 e C5 — **quitadas na FASE 21**) e a dependência que ficou explícita:
convidar gente nova de dentro da instituição é a F15 (Comunicação).

### Fase de ciclo de vida do membro e armazenamento executada na FASE 21 (concluído)

Os dois itens que a FASE 14 declarou em aberto (C4 e C5) foram implementados na FASE 21. A
quota de armazenamento deixou de ser um número decorativo: o uso passou a **somar** o que a
instituição ocupa (PDFs de submissão, acervo de mídia, materiais de palestrante e
certificados emitidos) e cada um dos três caminhos de upload é **recusado antes de assinar a
URL** quando o arquivo não cabe — nunca a emissão de certificado, que é a promessa do produto
(ADR-131). Do outro lado, o ciclo de vida do membro saiu do SQL: a tela de equipe troca
papéis de escopo da instituição (revogando com `revokedAt`, preservando o histórico e sem
tocar em papel de evento) e remove acesso com remoção lógica, devolvendo a vaga para a quota,
com as travas de "não removo a mim mesmo" e "não removo o último proprietário" (ADR-133). O
registro completo (ADRs 131–133, lições 27–30 e evidências) está em
[`docs/fase-21-ciclo-de-vida-do-membro-e-storage.md`](fase-21-ciclo-de-vida-do-membro-e-storage.md).
A fase declarou **duas** dívidas novas: **C6** (a quota mede o banco, não o bucket: falta
reconciliar objeto órfão e apagar o arquivo quando o registro sai) e **C7** (o vínculo é uma
linha por instituição + pessoa, então remover a equipe tira o acesso de participante — a tela
avisa, mas falta a ação "rebaixar para participante").

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

### Fase do portal do palestrante executada na FASE 25 (concluído)

O escopo veio **direto do humano** (não deste levantamento): o palestrante deixou de ser uma
linha de `activity_speakers` e passou a ser uma PESSOA da instituição (`speaker_profiles`), com
convite por token hasheado, reivindicação em dois caminhos, portal com posse verificada no banco,
materiais com visibilidade decidida por visitante (401/403/404), vitrine pública com foto e bio, e
certificado `SPEAKER` que exige evento encerrado e credenciamento registrado. O registro está em
[`docs/fase-25-portal-do-palestrante.md`](fase-25-portal-do-palestrante.md), que declara as dívidas
novas da fase (E25–E29) e a fronteira que ela **não** cruzou: o convite é entregue à mão porque não
há canal de e-mail (F15 pendente).

### Revisão da FASE 25 executada depois da entrega (concluído)

O uso real mostrou que o portal e o convite existiam e **não tinham porta**: o item de menu das
permissões pessoais era descartado (`can()` sem dono nega `:own`) e o convite só era visível para
quem já tinha o papel que o aceite concede. A revisão corrigiu o predicado do menu, fez do convite
pendente uma porta de entrada (guarda, menu e página pública) e está registrada na **seção 10** do
documento da fase, com os ADRs 119 e 120. Ela declarou **uma** dívida nova, o **E30** (a entrada
pelo convite se apoia em endereço que a F15 ainda não verifica).

### Revisão da FASE 4 executada depois da entrega (concluído)

Também veio do uso: criar um rascunho parava numa tela de "Rascunho criado" e o autor tinha de
voltar à lista para abrir a submissão e anexar o arquivo — e não havia como apagar um rascunho
errado. A revisão faz a criação terminar **na própria submissão** (redirecionamento no servidor),
entrega a **exclusão do rascunho** (sempre restrita a `DRAFT`, com o fato na trilha de auditoria)
e, na segunda rodada, faz a **validação do envio valer na criação e na edição** — o rascunho não
nasce mais inválido, e o autor corrige título, resumo e palavras-chave sem recomeçar. Está
registrada na **seção 18** do documento da fase, com os ADRs 121 a 123. Declarou **duas** dívidas
novas: o **E31** (retirar uma submissão enviada continua sem serviço e sem tela — e é por isso que
a tela de exclusão manda falar com a comissão) e o **E32** (a trilha do rascunho só muda
recriando, porque trocá-la mexeria na rubrica, no sigilo e na fila de revisores).

### Revisão da FASE 3 executada depois da entrega (concluído)

Veio de um pedido de uso: o cadastro era **atividade por atividade**, e faltava a inscrição no
EVENTO — que já deve incluir quem entra nas atividades sem inscrição própria (palestra, mesa-redonda)
—, além de **editar e excluir** atividade na programação e dos rótulos de tipo/situação em
português (a tela mostrava `LECTURE`, `ROUND_TABLE`). A inscrição no evento **materializa** uma
linha por atividade aberta (`origin = EVENT_AUTO`, ADR-124); `requiresRegistration` virou COLUNA
cujo padrão deriva do tipo (`defaultRequiresRegistration`, com fail-closed para tipo desconhecido) e
a atividade aberta não aplica vagas nem fila (ADR-125); a exclusão de atividade é **lógica** e
recusada quando há inscrição viva ou presença — a mensagem manda cancelar (ADR-126). Está registrada
na **seção 19** do documento da fase, com os ADRs 124 a 126. Declarou **uma** dívida nova, o
**E33**: a fila de espera existe por atividade, mas a inscrição no evento — que consome a lotação do
evento — **recusa** quando o evento lota, em vez de enfileirar.

### Fase de comunicação executada na FASE 15 (concluído)

Os sete itens de **comunicação** (D1–D6 + A5) foram implementados na FASE 15. O que existia e não
avisava ninguém passou a sair: verificação de e-mail no cadastro, redefinição de senha, convite de
equipe, avaliação atribuída, prazo de parecer, carta conquistada e certificado emitido. Três coisas
definem o desenho:

1. **Outbox, não log.** A mensagem nasce gravada (com o HTML que foi enviado) antes da entrega, e o
   `dedupeKey` único impede que o mesmo FATO vire duas mensagens. É o que responde "o que essa pessoa
   recebeu?" sem abrir o painel do provedor.
2. **O padrão do driver é NÃO enviar.** `resend` só com declaração explícita (ou produção com chave);
   fora disso `log` — grava e não sai da máquina. Um ambiente mal configurado não manda e-mail real
   para endereço de pessoa de verdade.
3. **O convite é promessa, não vínculo.** `tenant_invitations` guarda o token como hash; o vínculo
   `MEMBER` + papel nasce no ACEITE, e é lá que a quota do plano é aplicada (ADR-127).

O registro completo (ADRs 127–130, lições 21–26 e evidências, incluindo o **envio real verificado
contra a conta de teste do Resend**) está em
[`docs/fase-15-comunicacao.md`](fase-15-comunicacao.md). A fase declarou **três** dívidas novas:
**D7** (a conta do Resend é de teste: sem domínio verificado, só o endereço dono da conta recebe),
**D8** (não há webhook de entrega: `SENT` é "aceito pelo provedor", não "entregue na caixa") e
**D9** (não há preferências nem opt-out). Ela também **corrigiu um defeito antigo** encontrado pelos
seus próprios testes: o `jobId` da fila de certificados continha `:` e o BullMQ recusava o job — a
fila nunca enfileirou nada desde a FASE 6, e toda emissão rodou inline em silêncio.

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
