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
| E. Jornada do participante | 26 | 6 | Médio — atrito e listas sem paginação; o acervo cresce sem miniatura nem busca, o convite de palestrante é manual (e, sem verificação de e-mail, a entrada por ele se apoia no endereço da conta), não há como retirar uma submissão enviada, a trilha do rascunho só muda recriando, o evento lotado não tem fila de espera, a sala de uma atividade aberta não limita o público do evento, não há tela para autorizar o nome no resultado público, a lista auditável do sorteio não pode ser comprometida antes da apuração, não há interruptor para manter o telão fora do ar, o prêmio anunciado de uma rodada não pode ser corrigido pela tela, a roleta do telão não pode ser repetida nem desligada e o balcão não deixa pedir "só entrada" |
| F. Gamificação | 5 | 0 | Baixo — mecânicas já existem sem gatilho automático |
| G. Sorteios | 0 | 0 | ~~Médio~~ **Zerado na FASE 22**: as seis dívidas do tema (G8–G13) foram quitadas — desfazer entrega, busca no histórico, premiar N revisores, página do resultado, chave versionada e prévia ao vivo |
| H. Design e acessibilidade | 4 | 1 | Baixo — aparência consistente; composição heterogênea |
| I. Plataforma e diretório | 1 | 0 | Baixo — resta a sigla × nome na detecção de conflito |
| **Total** | **50** | **15** | (8 quitados na FASE 12 · 5 na FASE 13 · 3 na FASE 14 · 7 na FASE 15 · 8 na FASE 16 · 4 na FASE 17 · 2 na FASE 21 · 6 na FASE 22 · 5 na FASE 23 · 4 na FASE 24 · o escopo próprio da FASE 25, mais o que cada uma declarou de novo) |

> O total é a **soma das tabelas de tema** (4+5+2+3+26+5+0+4+1 = 50 — o tema G ficou
> vazio depois da FASE 22), e não a subtração do
> número original: cada fase que quita itens também descobre outros (a FASE 13 acrescentou
> B6–B9, a FASE 14 acrescentou C4–C5, a **FASE 15 acrescentou D7–D9**, a FASE 16
> acrescentou G8–G13, a FASE 17 acrescentou
> E9–E13, a **FASE 21 quitou C4–C5 e acrescentou C6–C7**, a **FASE 22 quitou G8–G13 e
> acrescentou E35**, a FASE 23 acrescentou E14–E17, a FASE 24 acrescentou E18–E20 e a FASE 25
> acrescentou E25–E29 — mais o E30, que a **revisão** da FASE 25 declarou, o E31 e o E32,
> que a **revisão** da FASE 4 declarou, o E33, que a **primeira revisão** da FASE 3 declarou,
> o E34, que a **segunda revisão** da FASE 3 (ciclo de vida da sala) declarou, e o **E36 e o
> E37**, que a FASE 29 declarou — esta última sem quitar nenhuma dívida anterior: o escopo
> dela veio do humano, e o que ela fechou foi um defeito de honestidade na auditoria, não um
> item deste levantamento).
>
> **A FASE 31** (credenciamento e frequência por crachá) veio do humano e **não quitou item
> deste levantamento**: ela corrigiu a mistura entre "chegou ao evento" e "esteve na
> atividade", fez o crachá existir de verdade (a coluna era lida por todos e escrita por
> ninguém) e declarou **E40** (credenciamento offline), **E41** (impressão em etiqueta)
> e **E42** (identidade visual do crachá e escolha de lente), mais o **E43** (o botão único do
> balcão fecha a presença na segunda leitura: não há como pedir "só entrada" na tela).
> O consolidado passa de 46 para **50**.
>
> **A FASE 30** (sorteio ao vivo, em rodadas) também veio do humano e **não quitou item
> deste levantamento**: ela revisou a FASE 29 (o telão só era alcançável com o resultado já
> apurado) e declarou **E38** (o prêmio e o patrocinador de uma rodada não podem ser
> corrigidos depois do anúncio) e **E39** (a roleta tem duração fixa e não pode ser
> reexecutada nem desligada pelo operador). O consolidado passa de 44 para **46**.
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
| E34 | **A sala de uma atividade ABERTA não limita o público do evento** | FASE 3 (revisão da sala, ADR-135) | O teto da sala é aplicado na reserva de vaga das atividades com inscrição própria. Atividade ABERTA recebe automaticamente quem se inscreveu no evento (ADR-124) e não tem fila: aplicar o teto ali significaria negar acesso em silêncio a quem já está inscrito. Hoje o painel **avisa** quando o público do evento excede a sala (`activity-room-overflow`), mas não bloqueia nem redistribui | O público pode passar do que a sala comporta e a organização só descobre pelo aviso da tela — a decisão (sala maior, atividade com vagas ou limite no evento) fica com quem organiza | M | Sim |
| E35 | **Não há tela para autorizar o nome no resultado público** | FASE 22 (novo, ADR-139) | `User.isPublicProfile` existe, o domínio o respeita (nome completo × mascarado) e o padrão passou a ser NÃO publicar — o campo nasceu `true` e o efeito era o oposto do documentado. Falta o caminho de interface para quem QUER se identificar | Quem gostaria de aparecer com o nome completo no resultado do sorteio não tem como pedir: depende de SQL. O sentido atual é o seguro (mascara mais), mas a escolha fica inacessível. **A FASE 29 agravou o alcance**: a lista publicada da auditoria também mostra nomes (mascarados), então a decisão de consentimento passou a valer para mais uma tela pública | P | Sim |
| E36 | **A lista publicada do sorteio não pode ser comprometida antes da apuração** | FASE 29 (novo, ADR-142) | O compromisso assina a SEMENTE (`sha256` publicado na criação). A lista de elegíveis é gravada na apuração, entra no payload do resultado (versão 3) e é publicada com o hash — mas só existe no momento da apuração, porque o credenciamento continua aberto até lá. Quem tem acesso ao banco poderia montar a lista e escolher a semente até gostar do resultado, desde que publique o compromisso depois | A auditoria prova que a semente foi fixada antes, que a lista publicada gerou o resultado e que nada mudou depois — **e declara na própria página que não prova a autenticidade da lista**. O caminho forte (notarização externa do compromisso, ou congelamento antecipado do credenciamento com segunda cerimônia) exige mudar o produto | G | Sim |
| E37 | **Não há interruptor para manter o telão fora do ar** | FASE 29 (novo, ADR-141) | O palco (`.../sorteios/<id>/palco`) responde desde a criação do sorteio e mostra o título do prêmio, para que o organizador teste o endereço antes do evento e projete o mesmo link no dia. Não há como negar o acesso até a instituição decidir ligar o telão | Quem tem o link (UUID não enumerável, página com `noindex`) vê o título do prêmio antes da apuração. Quem quiser anunciar só na hora não tem como | P | Sim |
| E38 | **O prêmio e o patrocinador de uma rodada não podem ser corrigidos depois do anúncio** | FASE 30 (novo, ADR-145) | A rodada guarda o prêmio (título e descrição) e o patrocinador como ANÚNCIO — fora do documento assinado, justamente para que corrigir o texto não invalide um resultado publicado. Só que não existe caminho de escrita: a rodada é imutável, e um typo no telão ou no resultado só sai com SQL | O dado que a ADR-145 declarou "corrigível sem invalidar nada" é o único que não pode ser corrigido pela tela. O caminho é uma ação `updateRoundAnnouncement` gravando na trilha (o hash não muda) | P | Sim |
| E40 | **O credenciamento não funciona sem rede** | FASE 31 (novo, ADR-149) | A leitura grava direto no servidor: sem wi-fi no evento (ou com a operadora saturada), o monitor não registra nada e a fila para. Não há fila local nem indicador de "leitura pendente" | O cenário mais provável num pavilhão cheio acontece no pior momento: sem fila local, a saída é papel e digitação depois — com os minutos errados. O caminho é uma fila no navegador (IndexedDB) com sincronização idempotente por (crachá, contexto, instante) | G | Sim |
| E41 | **A impressão é folha A4 para recortar, não etiqueta adesiva** | FASE 31 (novo, ADR-152) | A folha de crachás sai em PDF A4 com 8 etiquetas por página e marcas de corte — e a secretaria corta 300 etiquetas na tesoura. Crachá de papel solta, molha e rasga | Gerar ZPL para impressora térmica de etiquetas, ou PDF com as medidas das folhas adesivas comerciais (Pimaco e similares) | M | Sim |
| E42 | **O crachá não tem identidade visual do evento, e a câmera não deixa escolher a lente** | FASE 31 (novo, ADR-152) | A etiqueta é funcional e fria (sem logo, cor do tema ou faixa por categoria) e o leitor usa sempre a câmera traseira (`facingMode: environment`), sem seleção de dispositivo | Num evento grande, a cor por categoria (palestrante, imprensa, equipe) economiza tempo na porta; e um notebook com duas câmeras pode abrir a errada. O projeto já tem o tema do evento (`ThemeScope`), e `enumerateDevices` resolve a lente | P | Sim |
| E43 | **O balcão não deixa pedir "só entrada": o botão único FECHA a presença na segunda leitura** | FASE 31 (novo, §3.8) | O botão principal manda `TOGGLE` (entra quem está fora, sai quem está dentro) e a tela não oferece o modo `IN`. O serviço sabe responder "já credenciado" (`ALREADY_INSIDE`), mas nenhum caminho da tela pede isso — ler o mesmo crachá duas vezes seguidas fecha a chegada em vez de avisar | Quem lê sem olhar o painel (o bipe duplo do leitor, a câmera em rajada, dois monitores no mesmo posto) encerra a presença de quem acabou de chegar — e a saída fica com minutos errados. A câmera ignora o MESMO código por 2,5 s, o que cobre o caso mais comum; a correção seria um seletor de modo na tela (ou um "já credenciado" com confirmação explícita para fechar) | M | Sim |
| E39 | **A roleta tem duração fixa e não pode ser reexecutada nem desligada** | FASE 30 (novo, ADR-146) | A animação roda quando o telão percebe a apuração ao vivo, por ~3 s, e quem abre o link depois vê o resultado direto (decisão consciente). Não há controle para repetir a roleta (telão recarregado no meio do anúncio) nem para apresentá-la sem animação | O suspense do anúncio é o que o pedido queria, e o operador não tem como ajustá-lo ao palco: uma projeção que reinicia perde a roleta, e não há como forçá-la de novo | P | Sim |

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
| ~~G8~~ | ~~**Desfazer uma entrega registrada por engano**~~ | FASE 16 | **Quitado na FASE 22**: `reversePrizeDelivery` limpa o recibo e guarda as duas pontas na trilha, com motivo obrigatório (ADR-137) | — | — | — |
| ~~G9~~ | ~~**Busca e filtro no histórico de sorteios**~~ | FASE 16 | **Quitado na FASE 22**: filtro por situação e período no `where` do banco, no fuso da instituição, com o recorte no endereço | — | — | — |
| ~~G10~~ | ~~**Premiar mais de um revisor pela tela**~~ | FASE 16 | **Quitado na FASE 22**: campo numérico com teto no domínio (`MAX_REVIEWER_AWARDS`) e o corte dito antes do clique | — | — | — |
| ~~G11~~ | ~~**Página própria do resultado publicado**~~ | FASE 16 | **Quitado na FASE 22**: `/t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>`, com a prova da semente e 404 para o resto | — | — | — |
| ~~G12~~ | ~~**Rotação do segredo do cofre de sementes**~~ | FASE 16 | **Quitado na FASE 22**: `RAFFLE_SEED_KEYS` versionado, versão gravada no sorteio e situação do chaveiro na tela (ADR-138) | — | — | — |
| ~~G13~~ | ~~**Prévia ao vivo por evento em vez de polling**~~ | FASE 16 | **Quitado na FASE 22**: a rota existente negocia SSE e mantém o polling como caminho de volta (ADR-138) | — | — | — |

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
| **F22 — Operação de palco** | Desfazer entrega registrada, busca no histórico, premiar N revisores, página pública do sorteio, chave do cofre versionada, prévia ao vivo | G8–G13 | **Concluída como FASE 22** — `docs/fase-22-operacao-de-palco.md`. As seis dívidas do tema de sorteios foram quitadas; a fase declarou **E35** (não há tela para a pessoa autorizar o nome no resultado público) |
| ~~**F23 — Conteúdo e mídia**~~ | Prévia da página, upload na galeria, reuso de patrocinador entre eventos, versões da página, publicação agendada | E9–E13 | **Concluída como FASE 23** — `docs/fase-23-conteudo-e-midia.md`. A página pública virou componente compartilhado, e o histórico exigiu a primeira tabela nova desde a FASE 16 |
| ~~**F24 — Mídia e agendamento**~~ | Biblioteca de mídia, vínculo de patrocinador entre eventos, janela de exibição, fuso do agendamento | E14–E17 | **Concluída como FASE 24** — `docs/fase-24-midia-e-agendamento.md`. O bucket deixou de ser a biblioteca: a imagem passou a ter registro, com reaproveitamento por checksum e exclusão que confere o uso |
| ~~**F25 — Portal do palestrante**~~ | Perfil do palestrante, convite e vínculo de conta, portal com posse, materiais com visibilidade, vitrine e certificado | E21–E24 (escopo definido pelo humano) | **Concluída como FASE 25** — `docs/fase-25-portal-do-palestrante.md`. O palestrante deixou de ser uma linha da atividade e passou a ser uma pessoa da instituição, com portal próprio |
| **F26 — Acervo de mídia (segunda ordem)** | Miniaturas, busca e filtro no acervo, sincronia em lote | E18–E20 | O que a FASE 24 declarou em aberto: são melhorias de USO do acervo, não requisitos — cabem como carona na F21 (entregue) ou num mutirão de meio dia |
| **F27 — Material e convite do palestrante** | Convite por e-mail, integridade forte no upload, foto por URL, convite em lote, colunas legadas | E25–E29 (+ E30) | O que a FASE 25 declarou em aberto (e a revisão dela, o E30). A **FASE 15 entregou a esteira de e-mail**, então E25/E28 agora só precisam do template e do gatilho; a verificação de e-mail também já existe como caminho de confirmação do E30 — o que falta nele é o bloqueio de login |
| **F28 — Entrega de e-mail de segunda ordem** | Domínio verificado no provedor, webhook de entrega (bounce/reclamação), preferências e opt-out | D7, D8, D9 | O que a FASE 15 declarou em aberto. D7 é operação de conta (verificar domínio e trocar `EMAIL_FROM`); D8 e D9 são produto e cabem juntos num mutirão |
| ~~**F29 — Palco público e auditoria do sorteio**~~ | Página de telão do sorteio com efeitos, link e QR na tela de sorteios, lista publicada assinada no resultado e auditoria que qualquer pessoa confere | Escopo definido pelo humano (não vinha deste levantamento) | **Concluída como FASE 29** — `docs/fase-29-palco-e-auditoria.md`. Fechou um defeito de honestidade da FASE 22 (a página prometia uma reprodução que ninguém podia conferir) e declarou **E36** e **E37** |
| ~~**F30 — Sorteio ao vivo, em rodadas**~~ | Rodadas no mesmo sorteio (cada uma com o próprio compromisso, prêmio e resultado assinado), "criar para o palco", roleta com os nomes reais no telão e prêmio/patrocinador por momento | Escopo definido pelo humano (não vinha deste levantamento) | **Concluída como FASE 30** — `docs/fase-30-sorteio-ao-vivo-em-rodadas.md`. Revisou a FASE 29 (o telão só era alcançável com o resultado já apurado) e declarou **E38** e **E39** |
| ~~**F31 — Credenciamento e frequência por crachá**~~ | Leitura de QR pela câmera, área de crachás com emissão individual e em massa, etiqueta com QR + código + nome, crachá online do participante e a separação entre credenciamento e frequência | Escopo definido pelo humano (não vinha deste levantamento) | **Concluída como FASE 31** — `docs/fase-31-credenciamento-e-frequencia.md`. O crachá passou a existir de verdade (a coluna era lida por todos e escrita por ninguém) e declarou **E40**, **E41** e **E42** |
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

### Segunda revisão da FASE 3 — ciclo de vida da SALA e o teto das vagas (concluído)

O relato veio do uso, com a tela na mão: faltava **editar e excluir sala** (a ATIVIDADE já tinha
ganhado as duas na primeira revisão, e a sala — cadastrada na MESMA tela — ficou para trás), a
capacidade deveria ser **opcional** ("sem limite") e as **vagas da atividade não poderiam passar da
sala**, "para não ocorrer de ter mais inscritos que a capacidade da sala". A revisão está registrada
na **seção 20** do documento da fase, com os ADRs 134 a 136:

1. `rooms."capacity"` virou `Int?` sem `DEFAULT` (**ADR-134**) — a sala sem número declarado afirma
   "sem limite", e não "zero lugares"; o `0` legado é normalizado para `NULL` sem mudar comportamento;
2. o **limite efetivo** da atividade é o menor entre a lotação declarada e a sala
   (`effectiveActivityCapacity`, **ADR-135**), aplicado no MESMO predicado atômico que reserva a vaga
   — a prova é uma atividade ILIMITADA numa sala de 2 confirmar exatamente 2, com a terceira recusada;
3. a sala em uso **recusa a exclusão** e a redução de capacidade **recusa abaixo do que já existe**
   (**ADR-136**), com o número e a atividade na mensagem.

Declarou **uma** dívida nova, o **E34**: a sala de uma atividade ABERTA não limita o público do
evento — o painel avisa, e a decisão fica com quem organiza (negar acesso em silêncio a quem já está
inscrito seria pior).

### Fase de operação de palco executada na FASE 22 (concluído)

As **seis** dívidas do tema de sorteios (G8–G13) foram implementadas na FASE 22 — o que só aparece
depois de operar sorteio de verdade:

1. **G8** — desfazer a entrega registrada por engano deixou de exigir SQL: `reversePrizeDelivery`
   limpa o RECIBO (a posição sorteada continua existindo) e guarda as duas pontas na trilha, com
   **motivo obrigatório** (ADR-137);
2. **G9** — o histórico é filtrável por situação e período, no **fuso da instituição**, com o
   recorte no `where` do banco e no endereço (compartilhável e sobrevive ao recarregar);
3. **G10** — o painel de reconhecimento premia N revisores, com o teto no domínio e o corte do
   ranking dito **antes** do clique;
4. **G11** — o resultado publicado ganhou **endereço próprio**
   (`/t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>`), com a prova da semente e 404 para todo o
   resto;
5. **G12** — a chave do cofre de sementes passou a ser **versionada** (`RAFFLE_SEED_KEYS`), com a
   versão gravada no sorteio: girar a chave não invalida mais compromisso publicado (ADR-138);
6. **G13** — a prévia ao vivo deixou de ser polling: a rota existente **negocia SSE** e mantém o
   JSON e o polling como caminho de volta declarado (ADR-138).

O registro completo (ADRs 137–139, lições 31–34 e evidências) está em
[`docs/fase-22-operacao-de-palco.md`](fase-22-operacao-de-palco.md). A fase declarou **uma** dívida
nova, o **E35** — e, no caminho, corrigiu um defeito de privacidade que a FASE 16 não pegou: o
consentimento de perfil público (`User.isPublicProfile`) nascia **ligado**, então o nome dos
ganhadores saía completo no resultado público contra a regra documentada (ADR-139).

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
