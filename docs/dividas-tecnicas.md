
> **Documento vivo.** Reúne as dívidas e pontos de atenção declarados nas FASES 1 a 11B,
> verifica quais continuam abertos **no código de hoje** e propõe um agrupamento para
> implementação. Atualize-o quando uma fase quitar itens — o histórico do que já foi
> resolvido está na seção 2, para que este documento não repita trabalho feito.
>
> Levantamento feito em **2025-09-17**, sobre a árvore em `FASES 1 a 11B (70 ADRs)`.
> Atualizado após a **FASE 12** (8 itens), a **FASE 13** (A1, B1, B2, B3, B4), a
> **FASE 14** (C1, C3, I4), a **FASE 16** (G1–G7 + F1), a **FASE 17** (E3, E4, E5, E6), a
> **FASE 23** (E9–E13), a **FASE 24** (E14–E17), a **FASE 25** (escopo próprio: E21–E24), a
> **FASE 15** (D1–D6 + A5) e a **FASE 21** (C4–C5), a **FASE 29**, a **FASE 30**, a **FASE 31**,
> a **FASE 32**, a **FASE 33** (que quitou o E25 e declarou E46–E47), a **FASE 34** (que
> declarou E48–E49) e a **FASE 35**, com a **FASE 36** (que quitou A3, B7 e E47) e a
> **FASE 37** (que quitou E41 e E48 e declarou o E50), a **FASE 38** (que quitou a METADE
> do E50 — o quadro de demandas funciona sem JavaScript — e declarou E51–E52), a **FASE 39**
> (que declarou **E53**, a contagem conservadora do congelamento da rubrica) e a **FASE 40**
> (que declarou **E54**, CPF e título da apresentação sem fonte, e **E55**, o palco do editor
> visual sem movimento por teclado), a **FASE 41** (que não mexeu neste levantamento) e a
> **FASE 42** (que declarou **E56**, o contato de patrocinador aceito sem quota de equipe, e
> **E57**, o teto de QRs por patrocinador que não existe) e a **FASE 43** (que declarou
> **E58**, a exclusão lógica sem lista de arquivados, e **E59**, o XP de inscrição sem
> estorno no cancelamento), a **FASE 44** (que **quitou o E35** — a tela do nome público no
> resultado do sorteio — e declarou **E60**, mensagem entre participantes, **E61**, visão da
> pessoa entre instituições, e **E62**, moderação e denúncia do que é público), a **FASE 45**
> (que declarou **E63**, ordem manual do bloco de equipe, e **E64**, opt-out do nome de quem
> está na equipe) e a **FASE 46** (que declarou **E65**, o acervo anterior à conversão WebP
> que não é reprocessado, e **E66**, a autorização da foto que é declarada e não guardada), com as
> **revisões
> pós-entrega** da FASE 25
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
| **E25 — Convite de palestrante não saía por e-mail** | FASE 25 | **FASE 33** — o protocolo de aceite gera o convite e enfileira o template `SPEAKER_INVITATION` (link do portal, validade de 14 dias, `dedupeKey` por perfil × data de expiração). A esteira de e-mail da FASE 15 já existia: o que faltava era o template e o gatilho |

---

## 3. Resumo por tema

| Tema | Itens abertos | Dos quais rápidos (P) | Risco se ficar como está |
|---|---|---|---|
| A. Segurança e conformidade | 3 | 0 | Médio — **a varredura de arquivos foi entregue na FASE 36**; resta a assinatura assimétrica do certificado, a auditoria de leitura e o login social |
| B. Confiabilidade e operação | 4 | 2 | Baixo — log estruturado parcial e sem coletor; **o agendamento das partições foi entregue na FASE 36** (rotina do worker) |
| C. Quotas e billing | 1 | 0 | Médio — quota de armazenamento e ciclo de vida do membro entregues na FASE 21; restam a reconciliação banco × bucket e o acesso de participante na remoção |
| D. Comunicação e comunidade | 3 | 2 | Médio — o e-mail agora sai, mas sem domínio verificado só chega a um endereço, e não há webhook de entrega nem preferências |
| E. Jornada do participante | 31 | 2 | Médio — atrito e listas sem paginação; o acervo cresce sem miniatura nem busca, não há como retirar uma submissão enviada, a trilha do rascunho só muda recriando, o evento lotado não tem fila de espera, a sala de uma atividade aberta não limita o público do evento, a lista auditável do sorteio não pode ser comprometida antes da apuração, o prêmio anunciado de uma rodada não pode ser corrigido pela tela, o balcão não deixa pedir "só entrada", o arquivo exportado não tem prazo nem controle de destino, o recado é mão única, a proposta de uma chamada não aceita anexo, não há prazo-limite da atividade, o quadro de demandas carrega todos os cartões de uma vez e não reordena por teclado, a contagem que congela a rubrica da trilha é conservadora, o contato de patrocinador aceito não consome quota de equipe, não há teto de QR por patrocinador, não há lista de arquivados nem restauração, o XP da inscrição não é estornado no cancelamento, **não há mensagem entre participantes**, **não há visão da pessoa entre instituições**, **não há moderação nem denúncia do que é público**, **o bloco de equipe não tem ordem manual**, **quem está na equipe aparece sem opt-out próprio do nome**, **o acervo anterior à FASE 46 não é reconvertido para WebP**, **a autorização da foto é declarada, não guardada**, **a arte da carta entra por URL sem passar pelo acervo**, **o link compartilhado não expira nem é medido** e **a suíte de credenciamento depende da ordem dos testes** |
| F. Gamificação | 5 | 0 | Baixo — mecânicas já existem sem gatilho automático |
| G. Sorteios | 0 | 0 | ~~Médio~~ **Zerado na FASE 22**: as seis dívidas do tema (G8–G13) foram quitadas — desfazer entrega, busca no histórico, premiar N revisores, página do resultado, chave versionada e prévia ao vivo |
| H. Design e acessibilidade | 3 | 0 | Baixo — aparência consistente; composição heterogênea |
| I. Plataforma e diretório | 2 | 0 | Baixo — resta a sigla × nome na detecção de conflito |
| **Total** | **48** | **6** | (as fases quitadas estão item a item nas tabelas: 8 na FASE 12 · 5 na FASE 13 · 3 na FASE 14 · 7 na FASE 15 · 8 na FASE 16 · 4 na FASE 17 · 2 na FASE 21 · 6 na FASE 22 · 5 na FASE 23 · 4 na FASE 24 · 1 na FASE 33 · **3 na FASE 36** — A3, B7 e E47 — · **2 na FASE 37** — E41 e E48 — · **1 na FASE 44** — E35 — mais o escopo próprio da FASE 25 e as revisões) |

> **Correção de contagem (FASE 36).** O total publicado aqui dizia **55**, e ele somava as
> linhas que já estavam **riscadas** — a FASE 35 quitou E38, E39, E40 e E43 e riscou as linhas
> sem atualizar o resumo, e a FASE 33 fez o mesmo com o E25. Contando o que está **aberto**,
> linha por linha, nas nossas próprias tabelas (a regra deste documento): o total era **50**
> antes daquela fase, passou a **48** com A3, B7 e E47 quitados lá, e passa a **47** com E41 e
> E48 quitados na FASE 37 (que declarou o E50). A **FASE 38** não quitou item nenhum
> integralmente — ela quitou a **metade do E50** que dá para quitar sem reescrever uma dúzia
> de telas (o quadro de demandas é operável sem JavaScript) — e declarou **E51** e **E52**,
> levando o total a **49**. A **FASE 39** não quitou nada e declarou **E53** (a contagem
> conservadora que congela a rubrica da trilha): **50**. A **FASE 40** também não quitou nada e
> declarou **E54** (CPF e título da apresentação sem fonte) e **E55** (o palco não move por
> teclado): **52**. A **FASE 41** (vitrine do patrocínio) não quitou nem declarou item nenhum —
> ela deu LEITOR à coluna de cor da cota, que existia sem consumidor desde a FASE 17. A **FASE 42**
> (experiência do patrocinador) também não quitou item deste levantamento e declarou **E56** (o
> contato de patrocinador aceito entra como `PARTICIPANT` e **não** consome a quota de equipe —
> decisão de negócio a confirmar) e **E57** (não há teto de QR por patrocinador nem aviso de QR
> repetido no mesmo evento): **54**. A **FASE 43** (catálogo de gamificação: editar, excluir e
> cobrir os fatos) não quitou item deste levantamento e declarou **E58** (não há lista de
> arquivados nem restauração — a exclusão é lógica e não tem volta pela tela) e **E59** (o XP
> da inscrição não é estornado quando a pessoa cancela): **56**. A **FASE 44** (perfil público
> do participante) **quitou o E35** — a tela que faltava para quem QUER se identificar no
> resultado público, aberta pela FASE 22 — e declarou **E60** (não há mensagem entre
> participantes), **E61** (não há visão da pessoa entre instituições) e **E62** (não há
> moderação nem denúncia do que é público): **58**. A **FASE 45** (equipe do evento na página
> pública) não quitou item deste levantamento e declarou **E63** (o bloco de equipe não tem
> ordem manual dos cartões) e **E64** (quem está na equipe aparece com o nome, sem opt-out
> próprio): **60**. A **FASE 46** (imagens em WebP e a foto do palestrante sem conta) também
> não quitou item deste levantamento e declarou **E65** (o acervo anterior à fase não é
> reconvertido — não há CLI de reprocessamento) e **E66** (a declaração de autorização da foto
> é uma caixa de seleção, não uma prova guardada): **62**. A **FASE 47** (área de conta) não
> quitou item deste levantamento — ela fechou um beco sem saída que NÃO estava na lista (o link
> de redefinição de senha caía em 404 desde a FASE 15) — e declarou **E67** (as mudanças de
> identidade não entram na trilha: `audit_logs` tem `tenantId` e RLS, e a identidade é global)
> e **E68** (quem perde o celular E os códigos de recuperação depende do suporte, e não há
> confiança de dispositivo): **64**. A **FASE 48** (carta premium e compartilhamento) não
> quitou item deste levantamento — ela corrigiu um defeito que NÃO estava na lista (a corrida
> do balcão criava duas sessões na segunda visita) — e declarou **E69** (a arte da carta entra
> por URL: não passa pelo WebP da FASE 46, não conta quota e não vai para o acervo), **E70**
> (o link compartilhado não expira, não mede acessos nem conta quantas vezes foi aberto) e
> **E71** (a suíte de credenciamento depende da ORDEM dos testes: rodar um caso isolado com
> `-t` falha porque a fixture é montada por testes anteriores): **67**.
>
> **FASE 49:** quitou **E44** (marca d'água, prazo de 24 h e revogação na exportação de
> dado pessoal) e **E67** (trilha de identidade sem `tenantId`), e declarou **E72** (a
> trilha não tem expurgo nem alerta) e **E73** (a tela mostra quantos downloads, não
> quem baixou). O total **não muda** — saíram duas, entraram duas —, mas as fases
> quitadas vão de **16** para **18**.
>
> **Correção de contagem (FASE 51).** O total publicado na FASE 50 dizia **59** por
> aritmética (67 − 11 + 3), e a contagem **linha por linha** — a regra deste documento —
> dá **49** antes dos dois itens novos desta fase (**50**): o número anterior estava
> inflado, provavelmente por linhas já riscadas contadas como abertas. Os totais por tema
> agora são medidos, não inferidos: A=3, B=4, C=1, D=3, E=31, F=5, G=0, H=3, I=2 = **47**.
>
> **FASE 51 (mutirão de dívidas III):** quitou **onze** — E7, E19, E32, E37, E42, E57, E58,
> E63, E66, E70 e E73 —, e declarou **E77** (o logo da instituição não entra na etiqueta) e
> **I1** (os cenários E2E escritos sem execução). O total **59 → 49**.
>
> **FASE 65 (o dia do evento na mão do participante):** não quitou nenhum item deste
> levantamento e **declarou dois** — **E85** (a assinatura `webcal` e a revogação
> individual do endereço de exportação da agenda) e **E86** (a margem de deslocamento
> entre salas no choque). Os dois nasceram do recorte aprovado pelo humano: a exportação
> desta fase entrega **arquivo `.ics` + link do Google** (o Apple entra pelo próprio
> arquivo) e a assinatura fica declarada, porque o token da fase é **derivado**
> (`HMAC-SHA256` sobre `tenantId:userId`) e um endereço estável de assinatura sem
> revogação individual prometeria o que não existe (ADR-336); e o aviso de choque usa o
> **intervalo puro** — encostar não é choque, conter é —, sem margem para atravessar o
> campus. **Contagem:** entram dois itens, então o `AGENTS.md` passa de **40** para
> **42** e o tema E de **23** para **25**. A contagem **linha por linha** da tabela dá
> **43** porque as linhas de **I1** e **I2** continuam sem o risco de quitadas (a FASE 60
> as fechou): a defasagem é ANTERIOR a esta fase e está registrada aqui para não virar
> número novo — o `AGENTS.md` segue a contagem publicada, e a tabela é que precisa da
> correção.
>
> No caminho, esta fase achou — e **NÃO** corrigiu, por estar fora do escopo da fatia —
> uma violação séria de contraste na aba **"Programação"** da página do evento, que o
> portão WCAG AA não varre: o `eyebrow` do `SectionHeading`
> (`src/components/events/theme-scope.tsx:118`, anterior a esta fase) pinta
> `opacity-60` sobre a `--ef-background` do organizador e mede **4,44:1**
> (`#72747c` sobre `#f9f9ff`) contra os 4,5:1 do AA. É a MESMA causa dos três nós que a
> fase corrigiu, e a correção seria a MESMA classe (`ef-muted`); falta a decisão de
> levar a aba "Programação" ao portão (o 20º caso). A medição completa está em
> `docs/fase-65-dia-do-evento.md` §8.
>
> **FASE 66 (o rótulo que ficou fora do portão):** fechou o que a FASE 65 achou e não fechou
> e **não quitou nem declarou item nenhum** — o defeito do rótulo de seção não estava neste
> levantamento, e o resto da família que a varredura achou já tem dono: é o escopo da **E84**,
> agora **medido** (o token de texto da PLATAFORMA sobre o tema **escuro** do organizador dá
> **2,10:1** sobre o fundo e **1,86:1** sobre o cartão; no modo claro do organizador o mesmo
> par passa, 8,93:1 e 7,45:1 — a assimetria é o achado). Neste documento, a fase fez UMA
> coisa: **corrigir a contagem**. As linhas de **I1** e **I2** ganharam o risco de quitadas —
> a FASE 60 as fechou, e o documento daquela fase diz "Quitadas: **E79, I2, I3 e I1**" — e a
> contagem passou a ser a **MEDIDA linha por linha**, sem tocar em nenhuma outra linha:
> A=3 · B=4 · C=1 · D=3 · **E=24** · F=5 · H=1 · **I=0** = **41**. A defasagem que a FASE 65
> registrou era de **dois** erros que se cancelavam: as duas linhas sem o risco (43 contadas
> como abertas) e o tema E anunciado com **25** quando a tabela tem **24** abertos. Os totais
> por tema da §3 continuam com a defasagem histórica já registrada na correção da FASE 51 —
> o número que as fases seguintes usam é o do `AGENTS.md`, que agora é o medido.
>
> **FASE 64 (a página pública da instituição):** quitou **E84 PARA A PÁGINA DA INSTITUIÇÃO** — a
> dívida que a FASE 63 declarou (e que nunca chegou a abrir linha na tabela): lá o claro/escuro do
> visitante **vence** a paleta da casa, porque a página vive dentro do casco da plataforma e o
> controle de aparência fica logo abaixo (ADR-332). **A dívida CONTINUA ABERTA para a página do
> EVENTO**, onde quem manda no modo é o organizador (ADR-325) — por isso a linha entra na tabela
> como PARCIAL. Nada mais é quitado nem declarado com número: o defeito grave que a fase achou (o
> cartão de evento desenhava o ícone do calendário com o texto VAZIO, porque o domínio carimbava
> `periodLabel` só em `items` e a tela desenha `events`) foi **consertado na hora**, e quem o pegou
> foi a **catraca de regressão visual** nova — nenhum teste de unidade, nenhuma varredura de
> acessibilidade e nenhum E2E o pegava. **Contagem:** entra UM item (a linha da E84), e o total
> medido linha por linha passa de **47 → 48**; os totais por tema da §3 seguem com a defasagem já
> registrada na correção da FASE 51.
>
> **RESOLVIDO NA PRÓPRIA FASE 64 (fatia 5): a paleta da instituição não pintava — e passou a
> pintar.** Medido com `theme.primaryColor = '#7b2ff7'` publicado no escopo, a cor computada do
> "Ver evento" (`text-brand`) era `rgb(53, 37, 205)` = `#3525cd` no claro e `rgb(165, 180, 252)`
> = `#a5b4fc` no escuro — os valores da RAIZ, porque o `globals.css` declara os apelidos semânticos
> na raiz e o CSS substitui `var()` no elemento onde a declaração é feita. O conserto ficou no
> DOMÍNIO (`buildTenantThemeScope` passou a publicar os apelidos de IDENTIDADE que a página lê, com
> o papel de TEXTO ajustado ao modo até 5:1) e **não** tocou no `globals.css`. Depois: `#7b2ff7` no
> claro e `#9c63f9` no escuro (4,69:1 na superfície real da plataforma), com o fundo da página
> intacto nos dois modos e o portão WCAG AA 17/17 sem isenção — a medição de antes e depois está em
> `docs/fase-64-pagina-da-instituicao.md` §8.2. **Não é item deste levantamento** (nasceu e morreu
> dentro da fase) e por isso não entra na contagem.
>> **FASE 62 (a tela medida · a suíte honesta · dois fechamentos):** quitou **H6** (regressão visual com
> `toHaveScreenshot`: 12 snapshots, `maxDiffPixelRatio: 0` e `threshold` 0,04 **medido** — o padrão 0,2
> era cego à troca de token do escuro), **I3** (a espera do `Alt+↑` passou a repetir o GESTO até a ordem
> mudar no banco; `workers: 1` mantido **com número**; `npm run e2e:clean` com dry run e preservação
> nominal da demonstração e do seed), **E80** (o ranking mascara quem foi ocultado **sem tirar a
> posição**, e a régua interna × pública ficou escrita) e **E81** (elevação do escuro por **TOM**, com o
> `--ef-outline-variant` corrigido por medição). **A catraca nova achou um defeito grave**: a gaveta de
> navegação do celular estava presa dentro do cabeçalho (64 px) — `backdrop-filter` cria containing block
> para `position: fixed` — e passou por F52/F58/F59/F61 porque nenhuma dessas fases **media a TELA**.
> Declarou **E82** (o ranking de revisores) e **E83** (a espera por gesto noutros cenários).
>
> **FASE 61 (modo noturno):** quitou **H3** — a escala escura existe de verdade (64 tokens nos dois
> modos, só a camada `--ef-*`), com três estados de escolha, a preferência do sistema valendo sem
> cookie e sem JavaScript e o painel em modo escuro dentro do portão WCAG AA. No caminho, **6 pares
> do modo CLARO** que reprovavam o AA foram corrigidos (3 tokens de identidade mudaram de valor,
> declarado na fase) e a página do organizador parou de herdar o modo da plataforma. Declarou
> **E81** (a elevação por sombra some no escuro) e **REABRIU a I3** (a execução completa voltou a
> acusar 1 vermelho que passa isolado, com 6 cenários novos na suíte), além de corrigir um defeito
> de layout relatado com imagem (o bloco de conta estourava a barra) e prender a geometria dele.
>
> **FASE 60 (o que se oculta fica oculto · landmark · suíte E2E):** quitou **E79** — a
> ocultação do perfil passou a valer em **toda** superfície que cita a pessoa (bloco "Equipe do
> evento", link selado da carta e o **sorteio público**, cujo vazamento apareceu na auditoria da
> própria dívida: a página publicava o nome inteiro de quem foi ocultado) —, **I2** (as **14**
> telas sem `<main>`; a lista da F52 dizia 16, e duas eram herança/redirect), **I3** (a
> interferência na suíte paralela: a spec que "poluía" era ela mesma) e **I1** (os **5**
> cenários em `test.fixme` fecharam; resta o do **E76**, medido e reproduzido). Declarou **E80**.
>
> **FASE 52 ("fechar o que abrimos"):** quitou **E74** e **E75** (declaradas na F50) e
> **riscou E8** — o lote de certificados em ZIP existe desde a **FASE 36**; a linha ficou
> aberta porque a verificação original procurou **biblioteca de terceiro** (`zip|archiver|jszip`)
> e não viu o escritor de ZIP próprio (`zip-writer.ts`). **I1 ficou parcial**: 8 dos 13
> cenários voltaram a rodar (e um deles achou um **defeito real** — a emissão à mão do crachá
> recusava quem a tela oferecia). **E77** continua aberta (exige imagem no escritor de PDF à
> mão) e entrou **I2** (16 páginas sem landmark `<main>`). B6 ganhou o número medido: **206**
> `console.*`, não ~66. O total **49 → 47**.
>
> **FASE 53 (painel de prontidão e áreas de gestão):** não quitou nem declarou item do
> levantamento. Ela entregou a leitura que faltava na raiz do evento — **o que falta para
> este evento ficar pronto** — e padronizou os atalhos em cartões agrupados pelo trabalho.
> O total segue **47**.
>

---

## 4. Levantamento detalhado

### A. Segurança e conformidade

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| A2 | **Assinatura assimétrica de certificado (PKCS#7/CMS)** | F1, F6 | Trocar HMAC por chave privada + certificado; `signatureAlg`/`keyId` já preparados; exige cofre de chave | Terceiros não validam offline sem confiar na instituição | G | Decorrente |
| ~~A3~~ | ~~**Antivírus nos arquivos de submissão**~~ | F4, F6 | **QUITADO na FASE 36** — `docs/fase-36-operacao-e-seguranca.md`. Driver de inspeção com o padrão em NÃO inspecionar, rotina `file-scan` no worker (de 5 em 5 minutos), portão de download nos dois caminhos que servem bytes de terceiro (submissão e material de palestrante), trilha da ameaça e ClamAV sob perfil próprio no compose. Ficou de fora `media_assets` (bucket público, leitura pela URL) e o anexo de proposta, que ainda não existe (**E46**) | — | — | — |
| A4 | **Auditoria de leitura de dados pessoais** | F7 | A trilha registra mutações; quem **visualizou** não é registrado | Sem rastro em incidente de acesso indevido | M | Decorrente |
| A6 | **Login social (Google/ORCID)** | F2 | Tabela `account` é multi-provedor; falta o provedor e as credenciais | Atrito de cadastro em público acadêmico | M | Sim |

> A5 (verificação de e-mail) continua agrupado com **D1** na F14 candidata: depende do
> provedor de e-mail, que é o item que a fase de Comunicação entrega primeiro.

### B. Confiabilidade e operação

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| B5 | **`unstable_cache` → `use cache`** | F9 | API legada no diretório público | Dívida de atualização do framework | P | Sim |
| B6 | **Adoção do `logger` nos serviços** | F13 (novo) | A FASE 13 migrou os pontos de operação; **206** `console.*` seguem (medido na FASE 52; a estimativa anterior era ~66) nos serviços (`catalog-service`, `certificate-service`, `raffle-service`, …) | Log sem estrutura nem redação nesses caminhos | M | Sim |
| ~~B7~~ | ~~**Agendamento da manutenção de partições**~~ | F13 (novo) | **QUITADO na FASE 36** — `docs/fase-36-operacao-e-seguranca.md`. A manutenção virou rotina do WORKER (`audit-partitions`, todo dia às 3h) e não depende mais de alguém configurar cron na máquina; a CLI (`npm run db:partitions`) continua existindo para quem opera sem worker, chamando o mesmo serviço | — | — | — |
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
| ~~C7~~ | ~~**Remover membro não preserva o acesso de participante**~~ (QUITADA na FASE 50 — ação "Converter em participante") | FASE 21 (novo) | O vínculo é UMA linha por (instituição, pessoa): remover a equipe tira junto a área de participante (as inscrições continuam registradas). Falta a ação "rebaixar para participante" (ou separar as duas relações em duas linhas) | Quem era equipe e público perde o acesso às próprias inscrições e certificados — hoje **avisado** no diálogo, mas sem alternativa | M | Sim |

### D. Comunicação e comunidade

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| D7 | **Domínio de envio não verificado** | FASE 15 (novo) | A conta do Resend é de **teste**: o remetente tem de ser `onboarding@resend.dev` e a entrega só alcança o endereço dono da conta. Falta verificar um domínio em `resend.com/domains` e trocar `EMAIL_FROM` | Convite, aviso de avaliação e certificado só chegam a UM endereço enquanto isso | P | Sim |
| D8 | **Sem webhook de entrega** | FASE 15 (novo) | `SENT` significa "aceito pelo provedor"; não há webhook de `delivered`/`bounced`/`complained` nem supressão de endereço inválido | Mensagem aceita e não entregue só aparece no painel do provedor; endereço que quica continua recebendo tentativa | M | Sim |
| D9 | **Sem preferências nem opt-out** | FASE 15 (novo) | Todos os avisos são transacionais e não há central de preferências; a celebração de carta (D5) não pode ser desligada | Quem não quiser a celebração não tem como desligá-la | P | Sim |

### E. Jornada do participante

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| ~~E1~~ | ~~**Fila de espera com prazo de confirmação**~~ (QUITADA na FASE 56 — `PROMOTION_WINDOW_HOURS` de 48 h no domínio, com o aceite pela própria pessoa) | F3 | **QUITADA na FASE 56** — a promoção nasce `PENDING` com `confirmationDueAt`, e a varredura da F34 libera e promove o próximo (ADR-305/306) | — | — | Sim |
| ~~E2~~ | ~~**Paginação das listagens públicas**~~ (QUITADA na FASE 56 — eventos e submissões paginam no banco, com uma fórmula só) | F3, F4, F7 | **QUITADA na FASE 56** — `pagination-rules.ts` é a única fórmula; `listPublicEvents` e `listMySubmissions` leem em página com o `count` na mesma transação (ADR-309) | — | — | Sim |
| ~~E7~~ | ~~**Validação de certificados em lote**~~ (QUITADA na FASE 51 — tela pública `/validar/lote`) | F6 | Serviço existe; falta a tela que confere uma lista de códigos | Contratação verifica um por um | P | Sim |
| ~~E8~~ | ~~**Exportação de certificados em ZIP**~~ | F6 | **QUITADA (FASE 36)** — o lote em ZIP existe desde então: `GET /api/t/<slug>/certificados/zip?evento=<id>`, com escritor de ZIP **próprio** (`src/lib/documents/zip-writer.ts`). A linha ficou aberta porque a verificação original procurou **biblioteca de terceiro** (`zip|archiver|jszip`), e não a função | — | — | Sim |
| ~~E18~~ | ~~**Miniaturas no acervo de mídia**~~ (QUITADA na FASE 56 — rota de miniatura derivada na leitura) | FASE 24 (novo) | **QUITADA na FASE 56** — `GET /api/t/<slug>/midia/<id>/miniatura` deriva 320 px em WebP na primeira visita e guarda em `thumbs/`; a galeria pede a miniatura, e o original segue para a página pública (ADR-311) | — | — | Sim |
| ~~E19~~ | ~~**Busca e filtro no acervo de mídia**~~ (QUITADA na FASE 51 — filtros no banco, com contagem) | FASE 24 (novo) | A listagem traz as 200 mais recentes, sem filtro por tipo, evento ou "em uso" (a tela mostra o uso, não filtra por ele) | Acervo grande exige rolar e comparar a olho | P | Sim |
| E20 | **Sincronizar todas as cópias de uma vez** | FASE 24 (novo) | A sincronia é por patrocinador (ADR-111); falta aplicar a mesma origem a todas as cópias de uma vez | Instituição com muitas edições sincroniza uma cópia por vez | M | Sim |
| ~~E26~~ | ~~**Integridade do upload confere só o tamanho quando o storage não reporta checksum**~~ (QUITADA na FASE 50 — checksum do STORAGE assinado no PUT) | FASE 25 (novo) | O `PUT` assinado não inclui `x-amz-meta-sha256`; `verifyStoredObject` cai no tamanho (mesmo caminho desde a FASE 4) | Um objeto trocado por outro de MESMO tamanho passaria — hoje nenhum caminho do sistema o produz | M | Sim |
| E27 | **Foto do palestrante só entra por upload** | FASE 25 (novo) | Não há campo de URL para quem hospeda a foto fora (decisão de segurança: a esteira valida a assinatura real) | Quem tem a foto em outro site precisa baixá-la e enviá-la | P | Sim |
| E28 | **Convite em lote / reenvio automático** | FASE 25 (novo) | Cada convite é gerado por palestrante, e regerar invalida o anterior (ADR-114) | Turma grande de convidados exige repetir o fluxo | M | Sim |
| E29 | **`activity_speakers` mantém as colunas legadas duplicadas** | FASE 25 (novo) | Nome, e-mail, instituição e bio existem no perfil e no vínculo, sincronizados por dois caminhos de escrita (ADR-113) | Duas fontes do mesmo dado; a divergência exigiria um backfill | M | Sim |
| E30 | **O convite aberto pelo e-mail da conta se apoia em endereço não verificado** | FASE 25 (revisão, ADR-120) | Quem cria uma conta com o endereço que a organização cadastrou entra no portal e assume o perfil — o mesmo grau de confiança do aceite pelo painel, mas sem a prova de posse do endereço, que é a verificação de e-mail da F15 | Sem F15, um terceiro que consiga criar conta com o e-mail do convidado assume o perfil; a auditoria registra o aceite, e a organização pode desvincular | M | Sim |
| ~~E31~~ | ~~**O autor não consegue RETIRAR uma submissão já enviada**~~ (QUITADA na FASE 56 — `withdrawSubmission` + botão com motivo na trilha) | FASE 4 (revisão, ADR-122) | **QUITADA na FASE 56** — o autor retira o próprio trabalho (`WITHDRAWN`), o protocolo fica e o motivo entra na trilha; rascunho se exclui, não se retira (ADR-308) | — | — | Sim | | FASE 4 (revisão, ADR-122) | A máquina de estados tem `WITHDRAWN` (e o limite da trilha já o ignora na contagem), mas não existe serviço nem tela que o produza — só a comissão pode cancelar, e não há caminho de autor | Quem enviou por engano depende de um pedido manual à comissão, e o trabalho fica no páreo até alguém agir; a tela de exclusão manda falar com a comissão porque não pode oferecer o que não existe | M | Sim |
| ~~E32~~ | ~~**A trilha do rascunho não pode ser trocada pela interface**~~ (QUITADA na FASE 51 — regra do domínio por dependências) | FASE 4 (revisão, ADR-123) | Título, resumo, palavras-chave e idioma são editáveis; a trilha ficou de fora porque trocá-la muda a rubrica de avaliação, o requisito de versão cega e a fila de revisores (decisão do comitê) | Quem escolheu a trilha errada precisa excluir o rascunho e recomeçar — a edição cobre o texto, não a classificação | P | Sim |
| ~~E33~~ | ~~**Não há lista de espera no nível do EVENTO**~~ (QUITADA na FASE 56 — a inscrição no evento entra na fila com posição, visível em `/confirmacoes`) | FASE 3 (revisão, ADR-124/125) | **QUITADA na FASE 56** — evento com lotação ENFILEIRA em vez de recusar; a promoção reserva o lugar, retém com prazo e só então inscreve nas atividades abertas (ADR-304) | — | — | Sim | | FASE 3 (revisão, ADR-124/125) | A fila existe por ATIVIDADE (com vaga e promoção automática); a inscrição no evento, criada nesta revisão, consome a lotação do evento e, quando ela acaba, **recusa** em vez de enfileirar — quem não coube não entra em fila nenhuma | Evento lotado perde o interessado: não há como saber quem esperava nem promover ninguém quando uma vaga abre; a organização só descobre a demanda por fora | M | Sim |
| E34 | **A sala de uma atividade ABERTA não limita o público do evento** | FASE 3 (revisão da sala, ADR-135) | O teto da sala é aplicado na reserva de vaga das atividades com inscrição própria. Atividade ABERTA recebe automaticamente quem se inscreveu no evento (ADR-124) e não tem fila: aplicar o teto ali significaria negar acesso em silêncio a quem já está inscrito. Hoje o painel **avisa** quando o público do evento excede a sala (`activity-room-overflow`), mas não bloqueia nem redistribui | O público pode passar do que a sala comporta e a organização só descobre pelo aviso da tela — a decisão (sala maior, atividade com vagas ou limite no evento) fica com quem organiza | M | Sim |
| ~~E35~~ | ~~**Não há tela para autorizar o nome no resultado público**~~ | FASE 22 | **QUITADO na FASE 44** — `docs/fase-44-perfil-publico-do-participante.md`. A tela "Meu perfil público" traz o interruptor do **nome completo no resultado público** (`isPublicProfile`) ao lado das outras decisões de "quem me vê", e o padrão continua **mascarado** (ADR-139 e 236). O nome completo passa a ser uma escolha da pessoa, e não um `UPDATE` no banco | — | — | — |
| E36 | **A lista publicada do sorteio não pode ser comprometida antes da apuração** | FASE 29 (novo, ADR-142) | O compromisso assina a SEMENTE (`sha256` publicado na criação). A lista de elegíveis é gravada na apuração, entra no payload do resultado (versão 3) e é publicada com o hash — mas só existe no momento da apuração, porque o credenciamento continua aberto até lá. Quem tem acesso ao banco poderia montar a lista e escolher a semente até gostar do resultado, desde que publique o compromisso depois | A auditoria prova que a semente foi fixada antes, que a lista publicada gerou o resultado e que nada mudou depois — **e declara na própria página que não prova a autenticidade da lista**. O caminho forte (notarização externa do compromisso, ou congelamento antecipado do credenciamento com segunda cerimônia) exige mudar o produto | G | Sim |
| ~~E37~~ | ~~**Não há interruptor para manter o telão fora do ar**~~ (QUITADA na FASE 51 — interruptor com página honesta) | FASE 29 (novo, ADR-141) | O palco (`.../sorteios/<id>/palco`) responde desde a criação do sorteio e mostra o título do prêmio, para que o organizador teste o endereço antes do evento e projete o mesmo link no dia. Não há como negar o acesso até a instituição decidir ligar o telão | Quem tem o link (UUID não enumerável, página com `noindex`) vê o título do prêmio antes da apuração. Quem quiser anunciar só na hora não tem como | P | Sim |
| ~~E38~~ | ~~**O prêmio e o patrocinador de uma rodada não podem ser corrigidos depois do anúncio**~~ | FASE 30 | **Quitado na FASE 35**: `updateRoundAnnouncement` permite a retificação imediata com auditoria e sem alterar hashes criptográficos (ADR-181) | — | — | — |
| ~~E40~~ | ~~**O credenciamento não funciona sem rede**~~ | FASE 31 | **Quitado na FASE 35**: fila assíncrona IndexedDB `eventflow_offline_v1` com sincronização idempotente cronológica via `idempotencyKey` e `Attendance.qrNonce` (ADR-179) | — | — | — |
| ~~E41~~ | ~~**A impressão é folha A4 para recortar, não etiqueta adesiva**~~ | FASE 31 | **QUITADO na FASE 37** — `docs/fase-37-crachas-e-checklist.md`. A área de crachás ganhou a folha de ETIQUETA adesiva em PDF (grade configurável em milímetros, padrão 3 × 8 de 63,5 × 33,9 mm centralizados em A4) e o arquivo ZPL II para impressora térmica (dpi, medida do rolo e ampliação do QR configuráveis, padrão 203 dpi · 100 × 50 mm) — sem marca nem modelo no código, com recusa do que não cabe antes de gastar a folha (ADR-192/193/194/195) | — | — | — |
| ~~E42~~ | ~~**O crachá não tem identidade visual do evento, e a câmera não deixa escolher a lente**~~ (QUITADA na FASE 51 — cor do tema, faixa por categoria e escolha da lente; o logo em imagem virou a **E74**) | FASE 31 (novo, ADR-152) | A etiqueta é funcional e fria (sem logo, cor do tema ou faixa por categoria) e o leitor usa sempre a câmera traseira (`facingMode: environment`), sem seleção de dispositivo. **A FASE 37 quitou a metade da etiqueta adesiva e da térmica, e deixou esta intacta**: as duas saídas novas desenham o mesmo crachá funcional, sem identidade visual | Num evento grande, a cor por categoria (palestrante, imprensa, equipe) economiza tempo na porta; e um notebook com duas câmeras pode abrir a errada. O projeto já tem o tema do evento (`ThemeScope`), e `enumerateDevices` resolve a lente | P | Sim |
| ~~E43~~ | ~~**O balcão não deixa pedir "só entrada": o botão único FECHA a presença na segunda leitura**~~ | FASE 31 | **Quitado na FASE 35**: seletor estrito de sentidos (`IN`, `TOGGLE`, `OUT`) no console do monitor, imune a bipes duplos e rajadas (ADR-180) | — | — | — |
| ~~E44~~ | ~~**O arquivo exportado não tem prazo nem controle de destino**~~ | FASE 32 (novo, ADR-157) → **QUITADA na FASE 49** | O CSV saía com e-mail completo (é o insumo da ação) e passava a viver em pasta compartilhada, e-mail e pen drive. A trilha registrava QUEM exportou e quantas linhas, e nada mais | O arquivo não volta, então a fase separou as duas coisas: **marca d'água** (procedência no topo e autor, instante e validade em CADA linha — a cópia de uma linha continua dizendo de onde veio) e **pedido com prazo de 24 h** (`data_exports`), com download por sessão, revogação e a lista de exportações recentes na tela. O ARQUIVO não é guardado: o que expira é o direito de baixar de novo | — | Sim |
| ~~E45~~ | ~~**O recado é mão única: não há resposta nem thread**~~ (QUITADA na FASE 56 — a conversa é de mão dupla) | FASE 32 (novo, ADR-156) | **QUITADA na FASE 56** — a pessoa responde o recado que recebeu (`direction: INBOUND`, `parentId` na RAIZ da conversa), a resposta aparece dentro do recado na caixa de entrada e a ficha da instituição mostra **"respondeu"** com a data (ADR-313) | — | — | Sim |
| ~~E39~~ | ~~**A roleta tem duração fixa e não pode ser reexecutada nem desligada**~~ | FASE 30 | **Quitado na FASE 35**: botões de pausa/retomada e replay determinístico sobre lista real no palco, com atalhos `Espaço` e `R` (ADR-182) | — | — | — |
| E46 | **A proposta de uma chamada não aceita anexo** | FASE 33 (novo, ADR-161/162) | O formulário público pede texto e os campos do TIPO (carga horária, público-alvo, minibiografia), e não tem upload — diferente da submissão de artigo, que anexa o PDF. A prontidão fora da ciência trata "sem arquivo" como AVISO, e o caminho de upload existe (FASE 23/24, com quota e assinatura real do arquivo) | A organização decide sobre um resumo de 150 caracteres e uma minibiografia, sem o plano de aula nem o currículo que costumam acompanhar a proposta — e a decisão fica mais pobre justamente nas chamadas em que ela é mais subjetiva. O caminho é reusar `requestUploadAction`/`confirmUploadAction` no formulário público, com visibilidade decidida como no material do palestrante | M | Sim |
| ~~E47~~ | ~~**O proponente não é avisado da decisão (aceite ou recusa)**~~ | FASE 33 | **QUITADO na FASE 36** — `docs/fase-36-operacao-e-seguranca.md`. Template `PROPOSAL_DECIDED`, disparado por `recordDecision` **fora da transação**, com `dedupeKey` por proposta × decisão, o parecer do comitê no aviso e os dois canais (caixa de entrada + outbox). Vale para a proposta de CHAMADA; o artigo do fluxo acadêmico continua acompanhando pela tela de submissões (limite declarado na ADR-189) | — | — | — |
| ~~E48~~ | ~~**A confirmação de vaga é do CONJUNTO, não de cada exigência**~~ | FASE 34 | **QUITADO na FASE 37** — `docs/fase-37-crachas-e-checklist.md`. Cada exigência da atividade vira uma linha da INSCRIÇÃO (`registration_confirmation_items`, criada no momento da inscrição e na promoção da lista de espera) com estado próprio (`PENDING`/`RECEIVED`/`WAIVED`, autor e hora), e a vaga é DERIVADA: quando todas as obrigatórias estão satisfeitas ela se confirma sozinha, pelo caminho de sempre (ADR-196/197/198/199). O item opcional não segura a vaga, e "sem exigências" continua sendo confirmação da equipe | — | — | — |
| ~~E49~~ | ~~**Não há prazo-limite da atividade além dos N dias da inscrição**~~ (QUITADA na FASE 50 — teto no início da atividade) | FASE 34 (novo, ADR-173) | O organizador escolhe "5 dias", e quem se inscreve no último dia antes do evento tem prazo até depois do evento começar: a varredura olha o prazo da pessoa, não a data da atividade | Uma vaga retida pode ser liberada com a atividade já em andamento, e quem se inscreve em cima da hora e não confirma ocupa o lugar no dia. O caminho é um campo opcional de data-limite na atividade, com o prazo da pessoa sendo o MENOR entre "N dias" e a data-limite (a terceira opção que o humano não escolheu nesta fase) | P | Sim |
| ~~E50~~ | ~~**A ação em linha só existe depois de hidratada**~~ (MEDIDA na FASE 50: sem JavaScript funciona e há catraca; a janela do meio virou a **E76**) | FASE 37 (novo, ADR-199) | O `InlineActionForm` (usado em todas as telas de operação: confirmar vaga, marcar item, aprovar, mover bloco, sincronizar) renderiza o formulário no servidor, mas quem o ENVIA é o cliente. Com o JavaScript ainda carregando, o clique é absorvido pelo React e não vira requisição — sem erro na tela e sem linha no log. O E2E provou pela trilha de rede: nenhum POST. **A FASE 38 quitou a METADE**: o quadro de demandas tem um formulário de movimento com `action` nativa (`(formData) => void`), que o E2E prova com `javaScriptEnabled: false` — a ação em linha continua dependendo da hidratação | Para quem opera é "cliquei e não aconteceu nada" — e a pessoa clica de novo. Numa tela de balcão, com fila esperando, é atrito no pior momento. O que falta é a RAIZ: converter as ações de linha para `(formData) => void` (o `<form action={...}>` do React só aceita essa forma, e o `useActionState` recebe `(prev, formData)`) e trazer o recado do servidor — uma dúzia de telas a reescrever, com o E2E de cada uma provando que nada regrediu | M | Sim |
| ~~E52~~ | ~~**O quadro de demandas carrega todos os cartões do evento**~~ (QUITADA na FASE 50 — janela por coluna com aviso) | FASE 38 (novo) | `loadDemandBoard` lê todas as demandas do quadro em uma consulta, com comentários contados. Um evento com centenas de demandas abertas (ou um histórico de anos) traz tudo para a tela | A tela é de OPERAÇÃO e precisa abrir rápido no dia do evento. O caminho é paginar por coluna, deixando as concluídas fora do primeiro carregamento (com um contador e "ver concluídas") | P | Sim |
| ~~E53~~ | ~~**A contagem que congela a rubrica da TRILHA é conservadora**~~ (QUITADA na FASE 50 — conta quem avalia POR ela) | FASE 39 (novo, ADR-217) | `assertRubricShapeFree` conta os pareceres de submissões da trilha sem verificar se aquela submissão realmente usa a rubrica DELA: a precedência é CHAMADA → TRILHA → PADRÃO, então uma submissão de chamada com rubrica própria entra na conta mesmo sem nunca ter lido a rubrica da trilha. Uma trilha pode congelar por um motivo que não é dela | O efeito é conservador (congela antes do necessário) e a mensagem diz o que foi contado, mas o organizador pode ficar sem editar sem entender por quê. O caminho é resolver a rubrica POR SUBMISSÃO na contagem (`resolveEffectiveRubric` por linha), trocando uma consulta por uma consulta por submissão avaliada | P | Sim |
| ~~E51~~ | ~~**O quadro de demandas não reordena por teclado**~~ (QUITADA na FASE 50 — Alt + setas) | FASE 38 (novo, ADR-202) | O arrastar e soltar reordena e move entre colunas, e o formulário do cartão move de coluna — mas reordenar DENTRO da coluna só existe pelo gesto do mouse | A ordem é informação de prioridade: sem caminho por teclado, quem não usa mouse não consegue dizer "isto vem antes daquilo". O caminho é um par de botões "mover para cima/baixo" no cartão, chamando o MESMO `moveDemand` com o índice de destino (o serviço já aceita `toIndex`) | P | Sim |
| ~~E54~~ | ~~**CPF e "título da apresentação" não existem como variável do certificado**~~ (QUITADA na FASE 56 — as duas variáveis existem, com fonte) | FASE 40 (novo, ADR-221) | **QUITADA na FASE 56** — `cpf` sai do formulário de INSCRIÇÃO (dígitos validados pelos verificadores, formatados na impressão) e `titulo_apresentacao` do trabalho enviado; as duas entram no conteúdo CONGELADO (ADR-310) | — | — | Sim |
| ~~E55~~ | ~~**O palco do editor visual não move por teclado**~~ (QUITADA na FASE 50 — setas de 1 mm e Shift de 10 mm) | FASE 40 (novo, ADR-226) | Arrastar exige ponteiro. O formulário numérico ao lado cobre o caso (e funciona sem JavaScript), mas quem navega por teclado no PALCO não consegue mover a caixa — mesma família da E51 | O caminho é permitir mover/redimensionar a caixa selecionada com as setas (1 mm por toque, 10 mm com modificador), escrevendo nos mesmos campos. É melhoria de acessibilidade, com o teclado já funcionando no caminho alternativo | P | Sim |
| E56 | **O aceite do convite de patrocinador cria vínculo `PARTICIPANT`, que não conta na quota de membros** | FASE 42 (novo, §3.5) | O contato comercial da empresa costuma não ter vínculo nenhum com a instituição, e exigir vínculo para aceitar criaria o impasse já conhecido (sem vínculo não se aceita, e sem aceitar não há vínculo). O aceite faz o `upsert` de `user_tenant_profiles` com `kind = PARTICIPANT` — a mesma régua da inscrição pública e do convite de palestrante, e por isso **não** consome a quota de membros do plano | É decisão de NEGÓCIO, não de código: a instituição pode querer contar contatos de patrocinador como equipe (eles entram no painel, aparecem na área do patrocinador e recebem avisos). Confirmar com o humano antes de mudar; o caminho seria `kind = MEMBER` com a quota aplicada no aceite, como no convite de equipe (FASE 15) | P | Sim |
| ~~E58~~ | ~~**Não há lista de arquivados nem restauração do que foi excluído**~~ (QUITADA na FASE 51 — filtro de arquivados com restauração) | FASE 43 (novo, ADR-235) | A exclusão de carta e de missão é **lógica** (`deletedAt`), mas todas as leituras filtram `deletedAt: null`: o item desaparece das telas e não há onde vê-lo de novo. Quem excluir por engano depende de `UPDATE deleted_at = NULL` no banco | Excluir é operação comum, e a diferença entre "excluir" e "arquivar" precisa estar na tela, não no suporte. O caminho é um filtro "arquivados" com o botão de restaurar (a trilha já guarda quem excluiu e quando), aproveitando a mesma listagem | P | Sim |
| ~~E59~~ | ~~**O XP da inscrição não é estornado quando a pessoa cancela**~~ (QUITADA na FASE 50 — estorno no livro-razão) | FASE 43 (novo, ADR-233) | A chave de idempotência é o ALVO (pessoa + atividade/evento), então reinscrever-se não paga de novo — mas quem se inscreveu, recebeu 30 XP e cancelou fica com os pontos de uma vaga que não usou. Não há coluna dizendo de qual vaga veio o crédito: para reconciliar é preciso ler a chave | Estorno é decisão de NEGÓCIO: o projeto nunca devolve XP automaticamente (o ajuste manual existe para corrigir caso a caso), e cancelar é direito da pessoa. Se a instituição quiser estorno, o caminho tem duas partes: (a) coluna de origem (`registrationId` já existe no livro-razão, mas não é usada para estorno) e (b) um serviço que debite por fato, com trilha | P | Sim |
| ~~E63~~ | ~~**O bloco de equipe não tem ordem manual dos cartões**~~ (QUITADA na FASE 51 — ordem por equipe) | FASE 45 (novo, ADR-244) | A ordem é **derivada** (equipe A→Z → líder → nome → id) e é o que dá conta do caso comum. Quem quiser "a presidente primeiro, depois a diretoria na ordem que eu decidir" não tem como | Guardar ordem de PESSOAS num bloco faz a lista envelhecer em silêncio quando alguém sai: a posição 3 vira a 4 e ninguém percebe. O caminho é a ordem por EQUIPE (um campo em `event_teams`, com a mesma régua da FASE 38) somada ao líder que já existe — e não um arrastar-cartões | P | Sim |
| E64 | **Quem está na equipe aparece com o nome na página pública, sem opt-out próprio** | FASE 45 (novo, ADR-245) | O consentimento cobre **foto e contato**; o NOME é informação do evento (decisão do humano: nome e equipe sempre). A pessoa que não quiser aparecer precisa pedir para sair da equipe — não há interruptor para "estou na equipe, mas não me liste" | É a fronteira entre o direito de imagem e de nome da pessoa e a necessidade de a instituição dizer quem organiza. O caminho é um campo por vínculo (`showOnPublicPage`), com a tela de equipes mostrando quem está oculto — e a decisão de negócio a tomar é se a instituição pode reverter a escolha de quem trabalha no evento | M | Sim |
| E60 | **Não há mensagem entre participantes** | FASE 44 (novo, §3.7) | A instituição fala com a pessoa (FASE 32) e o perfil público existe, mas **duas pessoas não conversam** pela plataforma: não há conversa direta, nem comentário, nem "seguir". O perfil é uma vitrine de mão única | É a metade social da gamificação — o que faria o perfil circular entre os participantes. Não entrou nesta fase porque traz junto **moderação, bloqueio e denúncia**, que são um escopo inteiro (e a E62): abrir mensagem sem esses três é abrir um canal de assédio sem saída. O caminho é uma conversa por par (instituição, pessoa A, pessoa B) com bloqueio na própria conversa e denúncia na trilha | M | Sim |
| E61 | **Não há visão da pessoa entre instituições** | FASE 44 (novo, ADR-243) | O `@handle` é **global**, mas a página é sempre de UMA instituição: não existe um "hub" que mostre a participação somada (XP, cartas, eventos) das várias casas. Quem participa de três instituições tem três páginas, cada uma com a sua parte | Quem mais participa é quem mais perde: a trajetória fica partida em pedaços, e o próprio perfil não conta a história toda. O caminho esbarra numa decisão de produto: o XP e as cartas são **por instituição** desde a FASE 5 (a instituição é a dona do jogo), então o hub teria de mostrar a lista de participações e deixar claro que os números não se somam — ou somar com uma regra explícita, que muda o significado do ranking | M | Sim |
| ~~E62~~ | ~~**Não há moderação nem denúncia do que é público**~~ (QUITADA na FASE 56 — denúncia, fila da plataforma e ocultação) | FASE 44 (novo, ADR-239) | **QUITADA na FASE 56** — qualquer pessoa autenticada denuncia (categoria + relato, sem auto-denúncia nem repetição aberta), a fila é da PLATAFORMA (`/superadmin/denuncias`, o `@handle` é global) e a decisão DISPENSA ou OCULTA com nota obrigatória; ocultar preserva o handle e tira o perfil da página e do diretório (ADR-314) | — | — | Sim |
| ~~E57~~ | ~~**Não há limite de QR por patrocinador nem aviso de QR repetido no mesmo evento**~~ (QUITADA na FASE 51 — avisa e confirma, sem teto) | FASE 42 (novo, ADR-232) | Um patrocinador pode ter dez QRs no mesmo estande e nada impede nem avisa. O crédito continua correto (um XP por pessoa **por QR**, garantido pelo índice único de `sponsor_scans`), mas cada código novo é uma chance nova de creditar a mesma gente | O número de "visitas" da área do patrocinador deixa de ser comparável entre patrocinadores, e a organização perde o controle do que está impresso. O caminho é um teto por patrocinador por evento (campo na cota ou constante do serviço) e um aviso na tela quando o mesmo patrocinador já tem QR naquele evento | P | Sim |
| ~~E65~~ | ~~**O acervo anterior à FASE 46 continua em PNG/JPEG no bucket**~~ (QUITADA na FASE 56 — `npm run media:reprocess`) | FASE 46 (novo, ADR-248) | **QUITADA na FASE 56** — o reprocessador converte para WebP em CHAVE NOVA, apaga o original depois de a linha apontar para o novo, e PULA imagem em uso com o número no relatório (ADR-312) | — | — | Sim |
| ~~E66~~ | ~~**A autorização da foto é DECLARADA, não guardada**~~ (QUITADA na FASE 51 — texto, versão, canal e data) | FASE 46 (novo, ADR-252) | A organização marca "tenho autorização do palestrante" e a declaração entra na trilha com autor e hora — mas a plataforma não guarda o documento nem registra por qual canal o consentimento veio (e-mail, telefone, contrato do evento). O que existe é a prova de quem afirmou, não a prova do consentimento | Se o uso da imagem for questionado, a instituição mostra a declaração dela mesma: serve para responsabilizar quem publicou, não para demonstrar a base legal. O caminho é um campo de observação obrigatório ao lado da caixa (canal e data) e, adiante, o anexo do termo — que é escopo de LGPD, não de upload | P | Sim |
| ~~E67~~ | ~~**As mudanças de IDENTIDADE não entram na trilha**~~ (QUITADA na FASE 49) | FASE 47 (novo, ADR-254) → FASE 49 (ADRs 271–273) | `audit_logs` tem `tenantId` e RLS: ela registra o que acontece DENTRO de uma instituição. Trocar senha, ligar/desligar o segundo fator, trocar e-mail, enviar a foto e encerrar sessões são fatos GLOBAIS (a identidade é global desde a ADR-002) e não têm onde ser auditados. O que resta é o efeito no banco (`twoFactorEnabled`, `updatedAt`) — não quem fez, quando e de onde | É a superfície mais sensível da plataforma sem rastro: numa investigação de invasão de conta, a pergunta "de onde veio a troca de senha?" não tem resposta. O caminho é uma trilha de identidade (tabela própria, sem `tenantId`, gravada fora da transação como manda a armadilha 97) com o mesmo cuidado de privacidade da trilha atual — que guarda a DECISÃO, nunca o valor | M | Sim |
| E68 | **Sem o celular E sem os códigos, só o suporte resolve — e não há confiança de dispositivo** | FASE 47 (novo, ADR-255) | Não existe caminho de administração para desligar o segundo fator de alguém (nem para a própria pessoa, fora os 10 códigos de recuperação). O plugin também oferece "confiar neste dispositivo por 30 dias" (`trustDevice`), que reduziria a frequência do código — e não foi exposto nesta fase | Quem perde o aparelho e os códigos fica sem entrar até alguém intervir no banco, o que é operação de risco (alterar `twoFactorEnabled` à mão não deixa rastro). O caminho tem duas partes: uma tela de suporte COM trilha (autor, motivo e alvo) para desligar o segundo fator, e a confiança de dispositivo por 30 dias na tela do desafio | M | Sim |
| E69 | **A arte da carta entra por URL, não pelo acervo** | FASE 48 (novo, ADR-260) | Frente e verso da carta são endereços http(s) validados por allowlist — como a frente é desde a FASE 5. Uma imagem externa colada ali **não** passa pela conversão WebP da FASE 46, não entra em `media_assets` e por isso não conta quota, não é reaproveitada por checksum e não aparece no acervo da instituição | A mesma instituição tem dois caminhos de imagem com regras diferentes: o acervo (convertido, medido, com biblioteca) e a carta (URL livre). Levar a arte da carta para a esteira exige um alvo **sem evento** — a carta pode ser da instituição, não de um evento —, o que a esteira de hoje não cobre (ela particiona por `tenants/<id>/eventos/<id>/`) | M | Sim |
| ~~E70~~ | ~~**O link compartilhado não expira nem é medido**~~ (QUITADA na FASE 51 — prazo opcional e contador de acessos) | FASE 48 (novo, ADR-263) | Há revogação imediata e histórico de links, mas não há prazo de validade, limite de aberturas nem contador de acessos. A instituição não consegue responder "quantas vezes esta carta foi vista?" nem "quais links estão vivos há meses?" | Um link antigo esquecido continua abrindo a carta para sempre — e o dono não tem como saber que ele está circulando. O caminho é um `expiresAt` opcional (escolhido na criação) e um contador de leituras na própria página pública, com o número visível ao dono | P | Sim |
| ~~E71~~ | ~~**A suíte de credenciamento depende da ORDEM dos testes**~~ (QUITADA na FASE 50 — fixture por `describe`) | FASE 48 (novo, ADR-266) | A fixture de `tests/integration/credential-service.test.ts` é compartilhada entre os `describe`: pessoa, inscrição e crachá são montados por testes anteriores. Rodar um caso isolado com `-t` falha com `Cannot read properties of null` — aconteceu ao investigar a corrida do balcão | Um teste que só passa na suíte inteira não serve para depurar: foi justamente por isso que o defeito da corrida ficou escondido atrás de um teste intermitente. O caminho é cada `describe` montar a própria fixture (o teste novo da segunda visita já faz) e a suíte ganhar um caso de fumaça rodando um arquivo por vez | M | Sim |
| E72 | **A trilha de identidade não tem expurgo nem alerta** | FASE 49 (novo, ADR-271) | A tabela cresce para sempre (a retenção é a mesma decisão em aberto da trilha de instituição, dívida B8) e um fato `CRITICAL` — segundo fator desligado, senha trocada, código de recuperação usado — **não avisa ninguém**: aparece para quem for olhar a tela | Sem alerta, a trilha serve para investigar DEPOIS; com alerta, serviria para reagir DURANTE. O canal já existe (e-mail de plataforma e a rotina `job_runs`, FASE 36) — falta a decisão de quem avisar e com que frequência | M | Não |
| ~~E73~~ | ~~**A tela mostra quantos downloads, não quem baixou**~~ (QUITADA na FASE 51 — a lista mostra os autores) | FASE 49 (novo, ADR-269) | O autor de cada download está na trilha da instituição (`AuditAction.EXPORT` com `entityId` = a exportação), mas exige sair da lista de exportações recentes e abrir a trilha para descobrir | A lista já mostra prazo, contagem e revogação; juntar as duas fontes numa visão só pede uma consulta à trilha por linha da lista (e a trilha é particionada por mês) | B | Não |
| E76 | **A ação em linha antes do BUNDLE não vira requisição** | FASE 50 (novo, medido) | Com o JavaScript ligado e o bundle ainda carregando, o React intercepta o `submit` para reexecutá-lo depois da hidratação — e sem hidratação não há reexecução: o clique se perde, sem erro na tela e sem linha no log. Medição da FASE 50: com o JavaScript DESLIGADO o mesmo formulário funciona (o caso está no E2E, verde); nesta janela o item fica `PENDING` | As duas saídas conhecidas mexem em todas as telas de operação: (a) `<form>` com `action` de URL de verdade, executada por rota que redireciona de volta; ou (b) caminho duplo React/nativo. Até lá, o E2E tem o caso medido em `test.fixme` com o número, para a decisão não se perder | M | Sim |### F. Gamificação
| E77 | **O logo da instituição não é embutido na etiqueta do crachá** | FASE 51 (novo, ADR-288) | A identidade visual chegou como **cor do tema + faixa de categoria + nome da instituição**; o logo em imagem ficou de fora. O renderizador embute **JPEG** (é o formato do desenho do certificado) e o `logoUrl` é URL pública do MinIO: embutir exige baixar e converter a imagem no caminho de impressão — e a falha desse download passaria a poder derrubar a impressão do crachá no balcão | Decidir onde cachear a imagem convertida (por instituição? por evento?) e só então embutir, com erro que NÃO impeça a impressão (o crachá sai sem logo, com aviso na trilha) | M | Sim |
| E78 | **A imagem EM USO não é convertida pelo reprocessador** | FASE 56 (novo, ADR-312) | A conversão troca a chave do objeto, e a URL está gravada nas referências (capa do evento, logotipo de patrocinador, foto de palestrante, JSON dos blocos da página). Reescrever todas elas é trabalho com risco próprio — o relatório do `media:reprocess` conta quantas ficaram | Acervo publicado segue pesado | M | Sim |
| E79 | **Superfícies que citam a pessoa não respeitam a ocultação do perfil** | FASE 56 (novo, ADR-314) | O bloco "Equipe do evento" (F45) e o link público selado da carta continuam mostrando nome e equipe de quem teve o perfil oculto pela moderação: o efeito da E62 é sobre o PERFIL PÚBLICO, e estendê-lo a toda superfície que cita a pessoa é uma varredura própria | Dado de quem foi ocultado segue visível em duas superfícies | M | Sim |
| ~~E80~~ (QUITADA na FASE 62) | **O ranking de conquistas cita quem foi ocultado** | FASE 60 (novo, ADR-321) | A tela `/t/<slug>/conquistas` mostra nome, `@handle` e foto sem consultar `isPersonPubliclyVisible`: a régua da ocultação existe desde a F60 e esta é a superfície que ficou fora dela. É tela AUTENTICADA (membros da instituição), não internet aberta — a exposição é menor, mas o desvio é o mesmo | Passar nome/handle/foto do ranking pela fonte única, como fizeram o perfil, o diretório, a equipe, a carta e o sorteio; e fixar a régua das superfícies INTERNAS (a pessoa some da lista ou aparece mascarada?) | S | Sim |
| ~~E81~~ (QUITADA na FASE 62) | **A elevação por sombra não existe no modo escuro** | FASE 61 (novo, ADR-324) | Resolvida por **TOM** (ADR-329): novo `--ef-surface-popover` (`#2f323c`, acima do cartão `#23252d`), `--ef-surface-container` deixou de empatar com o cartão e a sombra virou reforço do que flutua. O `--ef-outline-variant` do escuro subiu para `#7a7f8d` por medição (a hairline media 2,64:1 sobre o flutuante mais claro) | — | — | Sim |
| E82 | **O ranking de REVISORES cita quem foi ocultado** | FASE 62 (novo, ADR-328) | `getReviewerRanking` (`src/lib/gamification/achievement-service.ts:232`) usa `reviewer.name` sem a fonte única (`isPersonPubliclyVisible`), consumido pelo painel de Reconhecimento. A régua interna agora existe (mascarar sem tirar a posição) | Aplicar a fonte única ali; o painel de premiação também nomeia quem RECEBEU a carta, então a decisão é de produto e pede fixture de pareceres própria | M | Sim |
| E83 | **A espera por GESTO em outros cenários** | FASE 62 (novo, ADR-327) | `certificate-template.spec.ts:433-446` aperta a tecla uma vez e repete só a ASSERÇÃO (a mesma forma latente do `Alt+↑` corrigido em `demand-board`), e `f51-credential-badge.spec.ts:463` flocou 1× sob carga com mecanismo próprio (clique tardio do laço do select) | Medir antes/depois como na I3 e aplicar o mesmo `teclarAte`/repetição — declarado em vez de "consertado no escuro" | S | Sim |
| E84 (PARCIAL: quitada para a PÁGINA DA INSTITUIÇÃO na FASE 64; ABERTA para a página do EVENTO) | **O claro/escuro do visitante não vence a paleta do organizador** | FASE 63 (novo, ADR-330) | Na página do **EVENTO** quem manda no modo é o organizador (ADR-325): quem escolheu "escuro" no rodapé recebe a página clara que o organizador desenhou, sem aviso. Na página da **INSTITUIÇÃO** o problema foi resolvido na FASE 64 (ADR-332) — o modo vem do cookie `ef_tema` e a paleta da casa é identidade, não iluminação. O que falta é a página do evento, e ali a decisão é de produto (a landing é um cartaz) | O visitante que pediu escuro vê claro numa página pública | M | Sim |
| E85 | **A agenda não tem assinatura (`webcal`) nem revogação individual do endereço** | FASE 65 (novo, ADR-336) | O endereço do `.ics` é um token **derivado** (`HMAC-SHA256` sobre `tenantId:userId`, sem tabela): ele vale enquanto o vínculo valer, e não existe "gerar um link novo". Sem isso não há assinatura de calendário — uma assinatura exige endereço ESTÁVEL e um cliente que o releia, e prometer revogação que não existe é pior do que não ter a assinatura. O caminho alternativo está escrito no ADR-336: token aleatório em tabela (com `revokedAt`), que exigiria a migração que a fatia 1 fechou de propósito | Quem quer a grade sempre atualizada no celular precisa baixar o arquivo de novo; um endereço vazado não pode ser cortado sozinho (só desativando o vínculo) | M | Sim |
| E86 | **O choque de horário não considera a margem de deslocamento entre salas** | FASE 65 (novo, decisão do humano no plano) | A régua é `intervalsOverlap` sobre o **intervalo puro**: duas atividades em salas DIFERENTES que terminam e começam no mesmo minuto não são choque — e na prática a pessoa não tem tempo de atravessar o campus. A decisão foi avisar sobre o intervalo puro e declarar a margem, em vez de inventar um tempo de deslocamento que ninguém mediu (e que dependeria de mapa, andar e distância entre salas) | O aviso não cobre o caso real "sai de uma sala e chega atrasado na outra" | S | Sim |
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
| ~~H3~~ | ~~**Tema escuro completo**~~ (QUITADA na FASE 61 — ADR-323/324/325) | F11A, F11B | `.dark` só evitava variável indefinida e a escala escura não existia. A F61 desenhou os **64 tokens** nos dois modos (só a camada `--ef-*`; nenhum componente aprendeu o que é "modo"), com **três estados** (Claro · Escuro · Sistema), a preferência do sistema valendo sem cookie e sem JavaScript, a escolha de Claro vencendo o SO escuro (`:root:not([data-tema='claro'])` na media query), o estado no `<html>` da primeira resposta e o controle no menu de conta e em `/conta`. No caminho corrigiu **6 pares do modo CLARO** que reprovavam o AA (`--ef-success-strong` 3,59:1, `--ef-danger-strong` 4,41:1, `--ef-outline-variant` 1,63:1) e fez a página do organizador parar de herdar o modo da plataforma | — | — | Sim |
| ~~H5~~ | ~~**Testes de acessibilidade (`@axe-core/playwright`)**~~ (QUITADA na FASE 50 — portão WCAG AA em 6 telas) | F2, F3 | Recomendado desde a F2; não existe | Regressão de acessibilidade passa despercebida | P | Sim |
| ~~H6~~ (QUITADA na FASE 62) | **Regressão visual (`toHaveScreenshot`)** | F11B | Sem snapshot de tela | Troca de cor por engano só aparece em revisão manual | M | Sim |
| ~~E74~~ | ~~**O token de aviso não passa no contraste AA no painel claro**~~ (QUITADA na FASE 52) | FASE 50 (novo, ADR-277) | Medido com o axe: `#d97706` sobre `#fff2e4` = **2,89:1** (2,59:1 sob `opacity-90`) e 4,15:1 no telão escuro — **não existe valor único**. A F51 separou em DOIS tokens medidos: `warning-strong` (`#92400e`) para painéis claros (6,44:1 / 7,09:1 no branco) e `warning-strong-on-dark` (`#fcd34d`, 9,17:1 no telão), presos por catraca de contraste que lê o `globals.css` (`tests/unit/f52-warning-contrast.test.ts`). A **isenção do portão foi REMOVIDA** | — | — | Sim |
| ~~E75~~ | ~~**Dois landmarks `<main>` na mesma página**~~ (QUITADA na FASE 52) | FASE 50 (novo) | A casca deixou de ser landmark (é espaçamento, não conteúdo) e as quatro telas que se apoiavam nela ganharam o seu; a `EventLanding` passou a ter o dela, dando landmark à página pública do evento. A auditoria das 82 páginas revelou **16 páginas sem landmark nenhum** (8 do SuperAdmin, 8 públicas) — viraram a dívida **I2** | — | — | Sim |
### I. Plataforma e diretório

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| ~~I1~~ (QUITADA na FASE 60) | **Cenários E2E em `test.fixme`** | FASE 51 (novo) | **PARCIAL na FASE 52**: dos 13, **8 rodam e passam** (mídia, catálogo, link da carta, crachá). Cada um tinha causa própria — hidratação de formulário controlado, dependência de ordem entre cenários, helper que contava `<li>` aninhado, `page.url()` lido antes da navegação e comparação de HTML em vez do que o visitante lê. Os **5 restantes** seguiam em `fixme` com o motivo escrito no arquivo. **A FASE 60 fechou os cinco**, e nenhum era "timeout": o **400** era do TESTE (rodando sozinho, o lote ia vazio), a troca de categoria de UM crachá era o clique tardio do `<select>` controlado, o crachá online era dado de cenário sem vínculo e o seletor de lente pedia `enumerateDevices` falso. Todos rodam e passam, sem afrouxar asserção | — | — | Sim |
| ~~I2~~ (QUITADA na FASE 60) | **16 páginas sem landmark `<main>`** | FASE 52 (novo) | 8 do painel de plataforma (`/superadmin/**`) e 8 públicas (`/t/<slug>/eventos/<eventSlug>`, chamada, inscrição, convite, ficha do palestrante…). Anterior a esta fase: o landmark vinha da casca e só existia no painel autenticado — as outras árvores nunca tiveram. **A FASE 60 fechou as 14** (a lista dizia 16, e três arquivos sem `<main>` próprio não são defeito): cada página ganhou o seu, a régua passou a ser "exatamente um" — perguntada ao DOM, nos dois sentidos — e a catraca do landmark foi provada por mutação | — | — | Sim |
| ~~I3~~ (QUITADA na FASE 62) | **Interferência entre testes na suíte E2E paralela** — **REABERTA na FASE 61** | FASE 54 (novo) | Duas execuções completas seguidas acusaram falhas em specs **diferentes** (`demand-board` 3 casos numa; `content-and-media` 1 caso na outra), **todos passando isolados**. A FASE 60 achou o mecanismo de um dos casos — o próprio `demand-board` lia o cartão do caso anterior, e um tropeço virava três vermelhos —, corrigiu e fechou a execução verde; **a FASE 61 reabriu**: com 6 cenários novos na suíte, a execução completa voltou a acusar **1 vermelho** (`demand-board`, "Alt+↓ reordena e anuncia a posição") e o **mesmo arquivo passa isolado** (`7 passed`, 11,3 s). O vermelho continua podendo ser CARGA, não defeito | Medir o limite (workers, tempo por cenário, dado acumulado no banco de E2E — havia ~350 instituições de execuções interrompidas) e/ou tornar determinística a espera da ação de reordenar. Enquanto isso, execução completa com 1 vermelho exige rodar o arquivo isolado antes de tratar como regressão |

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
| **F22 — Operação de palco** | Desfazer entrega registrada, busca no histórico, premiar N revisores, página pública do sorteio, chave do cofre versionada, prévia ao vivo | G8–G13 | **Concluída como FASE 22** — `docs/fase-22-operacao-de-palco.md`. As seis dívidas do tema de sorteios foram quitadas; a fase declarou **E35** (não há tela para a pessoa autorizar o nome no resultado público), **quitado na FASE 44** |
| ~~**F23 — Conteúdo e mídia**~~ | Prévia da página, upload na galeria, reuso de patrocinador entre eventos, versões da página, publicação agendada | E9–E13 | **Concluída como FASE 23** — `docs/fase-23-conteudo-e-midia.md`. A página pública virou componente compartilhado, e o histórico exigiu a primeira tabela nova desde a FASE 16 |
| ~~**F24 — Mídia e agendamento**~~ | Biblioteca de mídia, vínculo de patrocinador entre eventos, janela de exibição, fuso do agendamento | E14–E17 | **Concluída como FASE 24** — `docs/fase-24-midia-e-agendamento.md`. O bucket deixou de ser a biblioteca: a imagem passou a ter registro, com reaproveitamento por checksum e exclusão que confere o uso |
| ~~**F25 — Portal do palestrante**~~ | Perfil do palestrante, convite e vínculo de conta, portal com posse, materiais com visibilidade, vitrine e certificado | E21–E24 (escopo definido pelo humano) | **Concluída como FASE 25** — `docs/fase-25-portal-do-palestrante.md`. O palestrante deixou de ser uma linha da atividade e passou a ser uma pessoa da instituição, com portal próprio |
| **F26 — Acervo de mídia (segunda ordem)** | Miniaturas, busca e filtro no acervo, sincronia em lote | E18–E20 | O que a FASE 24 declarou em aberto: são melhorias de USO do acervo, não requisitos — cabem como carona na F21 (entregue) ou num mutirão de meio dia |
| **F27 — Material e convite do palestrante** | Convite por e-mail, integridade forte no upload, foto por URL, convite em lote, colunas legadas | E26–E29 (+ E30) | O que a FASE 25 declarou em aberto (e a revisão dela, o E30). **O E25 foi quitado na FASE 33** (o convite de palestrante passou a sair por e-mail no protocolo de aceite); o **E28** (convite em lote) segue aberto e usa a mesma esteira. A verificação de e-mail já existe como caminho de confirmação do E30 — o que falta nele é o bloqueio de login |
| **F28 — Entrega de e-mail de segunda ordem** | Domínio verificado no provedor, webhook de entrega (bounce/reclamação), preferências e opt-out | D7, D8, D9 | O que a FASE 15 declarou em aberto. D7 é operação de conta (verificar domínio e trocar `EMAIL_FROM`); D8 e D9 são produto e cabem juntos num mutirão |
| ~~**F29 — Palco público e auditoria do sorteio**~~ | Página de telão do sorteio com efeitos, link e QR na tela de sorteios, lista publicada assinada no resultado e auditoria que qualquer pessoa confere | Escopo definido pelo humano (não vinha deste levantamento) | **Concluída como FASE 29** — `docs/fase-29-palco-e-auditoria.md`. Fechou um defeito de honestidade da FASE 22 (a página prometia uma reprodução que ninguém podia conferir) e declarou **E36** e **E37** |
| ~~**F30 — Sorteio ao vivo, em rodadas**~~ | Rodadas no mesmo sorteio (cada uma com o próprio compromisso, prêmio e resultado assinado), "criar para o palco", roleta com os nomes reais no telão e prêmio/patrocinador por momento | Escopo definido pelo humano (não vinha deste levantamento) | **Concluída como FASE 30** — `docs/fase-30-sorteio-ao-vivo-em-rodadas.md`. Revisou a FASE 29 (o telão só era alcançável com o resultado já apurado) e declarou **E38** e **E39** |
| ~~**F31 — Credenciamento e frequência por crachá**~~ | Leitura de QR pela câmera, área de crachás com emissão individual e em massa, etiqueta com QR + código + nome, crachá online do participante e a separação entre credenciamento e frequência | Escopo definido pelo humano (não vinha deste levantamento) | **Concluída como FASE 31** — `docs/fase-31-credenciamento-e-frequencia.md`. O crachá passou a existir de verdade (a coluna era lida por todos e escrita por ninguém) e declarou **E40**, **E41** e **E42** |
| ~~**F32 — Central do participante e inteligência da instituição**~~ | Diretório de participantes atravessando todos os eventos, ficha 360 (eventos, frequência, certificados, cartas, XP e comunicação), recado por e-mail **e** mensagem na caixa de entrada, panorama com a vida da instituição por período e por evento, e exportação em CSV | Escopo definido pelo humano (não vinha deste levantamento) | **Concluída como FASE 32** — `docs/fase-32-central-do-participante.md`. Deu à instituição a visão da PESSOA (até aqui só havia listas por evento), corrigiu uma recusa silenciosa na guarda das Server Actions e declarou **E44** e **E45** |
| ~~**F33 — Chamadas de propostas**~~ | Chamadas por tipo (palestrante, minicurso, oficina, mesa…), formulário público de proposta, bloco na página do evento e protocolo de aceite | Escopo definido pelo humano (não vinha deste levantamento) | **Concluída como FASE 33** — `docs/fase-33-chamadas-de-propostas.md`. Quitou o **E25** (o convite de palestrante passou a sair por e-mail) e declarou **E46** (a proposta não aceita anexo) e **E47** (o proponente não é avisado da decisão) |
| ~~**F34 — Confirmação de vaga com prazo**~~ | Atividade confirmável escolhida pelo organizador (prazo, o que é preciso e onde confirmar), vaga retida até a equipe confirmar, avisos por e-mail e na plataforma, liberação automática no vencimento com promoção da lista de espera e fila de confirmações para a equipe | Escopo definido pelo humano (não vinha deste levantamento) | **Concluída como FASE 34** — `docs/fase-34-confirmacao-de-vaga.md`. Separou "inscrever-se" de "confirmar-se" e declarou **E48** (a confirmação é do conjunto, não de cada exigência) e **E49** (não há prazo-limite da atividade); no caminho corrigiu a promoção que não devolvia o lugar no evento (armadilha 79) e a fila que abria pela agenda (armadilha 80) |
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
novas da fase (E25–E29) e a fronteira que ela **não** cruzou: o convite era entregue à mão porque não
havia canal de e-mail naquele momento (a FASE 15 chegou depois, e a **FASE 33 quitou o E25** — o
convite passou a sair por e-mail no protocolo de aceite).

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
nova, o **E35** (**quitado na FASE 44**, que deu tela à decisão) — e, no caminho, corrigiu um
defeito de privacidade que a FASE 16 não pegou: o consentimento de perfil público
(`User.isPublicProfile`) nascia **ligado**, então o nome dos ganhadores saía completo no
resultado público contra a regra documentada (ADR-139).

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
