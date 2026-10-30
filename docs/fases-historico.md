# Fases 1 a 25, 29 a 30, 31 a 35, 36 a 42 e 43 a 49 — o histórico que saiu do `AGENTS.md`

> **O que é este arquivo.** O registro das fases **1 a 25** — incluindo **11A** e **11B** —,
> movido **como estava** do `AGENTS.md` na **FASE 79**: a tabela da §9 carregava todas as
> fases desde a 1 e encostava no teto de ~64.800 bytes daquele arquivo, cujo corte do harness
> apaga conteúdo em silêncio. **Não é um resumo novo**: cada linha é a linha que estava lá,
> inclusive as reticências ` … ` das condensações anteriores. Na **FASE 82** a tabela voltou a
> encostar no teto (65.090 bytes) com a linha nova, e as **duas mais antigas que restavam** —
> **29** e **30** — vieram para cá pelo mesmo movimento, também como estavam. Na **FASE 83** a
> linha nova levou o `AGENTS.md` a **65.941 bytes**; o movimento das **cinco mais antigas que
> restavam** — **31 a 35** — o devolveu a **64.489 bytes**, sem uma linha reescrita. Na **FASE 84** o
> mesmo gesto se repetiu: a linha nova levou o arquivo a **66.050 bytes** (acima até do corte de
> 65.244 do harness) e o movimento das **sete mais antigas que restavam** — **36 a 42** — o
> devolveu a **64.654 bytes**, com as linhas movidas **como estavam**. Na **FASE 85** a linha
> nova levou o arquivo a **65.986 bytes**; o movimento das **sete mais antigas que restavam** —
> **43 a 49** — o devolveu a **64.519 bytes** (medido depois dos demais ajustes de estado),
> também sem uma linha reescrita.
>
> **Onde está o registro completo.** Cada fase tem o seu documento em `docs/fase-NN-*.md`
> (ADRs, lições aprendidas, evidências e comandos), e o `README.md` traz o índice da
> documentação.
>
> **Onde está a tabela corrente.** No [`AGENTS.md`](../AGENTS.md), §9: ela guarda as fases
> recentes e o estado atual (hoje, da **50** à **85**). A tabela abaixo é histórica e **não
> cresce com fase nova** — ela cresce só por MOVIMENTO: quando o estado encosta no teto, a
> fase mais antiga ainda na corrente desce para cá.
>
> **A ordem é a cronológica da tabela original**, não a numérica: a numeração identifica o
> TEMA, e é o humano quem o escolhe pelo nome — por isso a F16, a F17, a F23, a F24 e a F25
> vieram antes da F15, e a F21 foi entregue depois de todas. As fases movidas na FASE 82, na
> FASE 83, na FASE 84 e na FASE 85 entram no fim, na ordem em que estavam.

| Fase | Tema | Situação |
|---|---|---|
| 1 | Infraestrutura, modelagem, RLS | ✅ |
| 2 | Autenticação, RBAC, multi-tenancy | ✅ |
| 3 | Eventos, inscrições, landing pages (chamada por trilha, lotação atômica, lista de espera, landing modular) — **+ duas revisões pós-entrega**: inscrição no EVENTO incluindo as atividades abertas (`EVENT_AUTO`), editar/excluir atividade e **ciclo de vida da SALA** (capacidade opcional = sem … | ✅ |
| 4 | Submissões e avaliação por pares (chamada por trilha, upload direto com SHA-256, afinidade, conflito de interesse, revisão cega, nota ponderada no servidor, decisão com quórum) — **+ revisão pós-entrega**: o rascunho cai direto na página da submissão, não nasce inválido e pode ser editado/excluído | ✅ |
| 5 | Gamificação (XP, cartas, missões) | ✅ |
| 6 | Certificação (PDF assinado, QR, fila) | ✅ |
| 7 | Painel administrativo + E2E completo | ✅ |
| 8 | Motor de sorteios por presença real | ✅ |
| 9 | Diretório público de organizações e governança global (SuperAdmin) | ✅ |
| 10 | Inscrição pública e vínculo automático de participante | ✅ |
| 11A | Identidade visual, primitivos de UI e shell de navegação | ✅ |
| 11B | Propagação do design a todas as telas e quitação da dívida (catraca zerada) | ✅ |
| 12 | Mutirão de dívidas rápidas (I7, I3, I5, C2, I1, I2, H2, H4) | ✅ |
| 13 | Operação e segurança (A1, B1, B2, B3, B4: rate limit em Redis, observabilidade, RLS na migração, particionamento da auditoria, PgBouncer) | ✅ |
| 14 | Quotas e planos (C1, C3, I4: quota de membros aplicada, plano e quotas editáveis pela UI, membro × participante no modelo e nas listas) | ✅ |
| 15 | Comunicação (D1–D6, A5: e-mail transacional com driver que por padrão NÃO envia, outbox `email_messages`, templates puros e convite com quota no aceite) — detalhe no doc e na §6 … | ✅ |
| 16 | Sorteios de ponta a ponta (G1–G7 + F1: suplentes, entrega do prêmio por posição, peso por minutos, commit-reveal, resultado público mascarado, prévia ao vivo, gatilhos de marco) | ✅ |
| 17 | Página pública e patrocínio (E3–E6: editor de blocos com validação por tipo, tema visual, capa e logotipo por upload, cotas e patrocinadores com limite de vagas, edição de coautores com ordem de crédito) | ✅ |
| 23 | Conteúdo e mídia (E9–E13: pré-visualização do rascunho pelo mesmo componente da página pública, upload de imagem na galeria, cópia de patrocinador entre eventos, histórico de versões com restauração, publicação agendada decidida na leitura) | ✅ |
| 24 | Mídia e agendamento (E14–E17: acervo com reaproveitamento por checksum, sincronia da cópia, janela de exibição e agendamento no fuso do evento) | ✅ |
| 25 | **Portal do palestrante** (E21–E24) — perfil como pessoa da instituição, convite por token hasheado, portal com posse no banco, materiais com visibilidade, vitrine e certificado `SPEAKER`; + revisão pós-entrega (ADR-119/120) … | ✅ |
| 21 | Ciclo de vida do membro e storage (C4, C5: troca de papéis e remoção lógica do membro pela tela de equipe com posse do OWNER protegida, quota de **armazenamento aplicada de verdade** em todo envio — submissão, mídia e material de palestrante — medida sobre tudo o que a instituição guarda) | ✅ |
| 22 | **Operação de palco** — desfazer a entrega com motivo na trilha, filtro do histórico, premiar N revisores, endereço próprio do resultado, chave do cofre versionada e prévia ao vivo; o consentimento de perfil público passou a nascer DESLIGADO. ADR-139 | ✅ |
| 29 | **Palco público e auditoria do sorteio** — telão com compromisso antes da apuração, contagem ao vivo e revelação automática; link + QR na tela de sorteios; lista publicada gravada na apuração e assinada no resultado; auditoria que refaz as contas no navegador | ✅ |
| 30 | Sorteio ao vivo, em rodadas (compromisso, prêmio, patrocinador e resultado assinado por rodada; **"Criar para o palco"**, **roleta** com a lista publicada, **payload v4**; auditoria e resultado público por rodada) … | ✅ |

| 31 | **Credenciamento e frequência por crachá** — um código por pessoa no evento, com o contexto da leitura decidindo o fato; chegada ≠ frequência (sessão por visita, minutos com teto no fim da atividade); emissão em massa, folha A4 em PDF, crachá online e modo monitor | ✅ |
| 32 | **Central do participante** — diretório (união de vínculo e inscrição), ficha 360, recado por e-mail e caixa de entrada, panorama com taxa de comparecimento no fuso da instituição, exportação em CSV com trilha e ficha auditada | ✅ |
| 33 | **Chamadas de propostas** — chamada como entidade (tipo, janela, cegueira, rubrica própria — CHAMADA → TRILHA → PADRÃO — e limite por autor por chamada); a proposta é uma submissão; formulário público; protocolo de aceite (o convite quita E25) | ✅ |
| 34 | **Confirmação de vaga com prazo** — escolha por atividade (automática × exige confirmação, com prazo, o que é preciso e onde confirmar); a inscrição nasce retendo a vaga; avisos por e-mail e na plataforma; a vaga vencida é liberada e o próximo da fila é promovido | ✅ |
| 35 | Resiliência de balcão e palco (**operação sem rede** no credenciamento, **sentido da leitura** no balcão — entrada × saída × alternar —, prêmio e patrocinador da rodada corrigíveis pela tela e **controles do palco** com pausa/replay/atalhos; quitou **E38, E39, E40 e E43**) — escopo definido pelo humano | ✅ |
| 36 | Operação das rotinas automáticas (**histórico, saúde e "executar agora"** em `/superadmin/rotinas`, com a linha em `job_runs` servindo de registro E de exclusão mútua), **inspeção antivírus** dos arquivos (driver com o padrão em NÃO inspecionar, portão nos dois caminhos e ClamAV sob perfil), … | ✅ |
| 37 | Crachá em **etiqueta adesiva** (PDF com grade configurável) e em **impressora térmica** (ZPL II configurável), e **confirmação de vaga por ITEM** (checklist snapshot da inscrição, com a vaga confirmada quando as obrigatórias acabam); quitou **E41** e **E48**) — escopo definido pelo humano | ✅ |
| 38 | **Quadro de demandas internas do evento** — Kanban por evento com colunas configuráveis, equipes com líder, prazo no fuso do evento, comentários com menção e o cartão movido por arrastar **ou** por formulário (funciona sem JavaScript); quitou a METADE da E50 e declarou E51/E52 | ✅ |
| 39 | **Rubrica com número livre de critérios** (1 a 12 critérios, com a chave **derivada do rótulo**; a **edição de trilha**, que não existia; e a rubrica **congelada a partir do primeiro parecer** — só rótulo, descrição e ordem seguem livres); declarou **E53**) — escopo definido pelo humano | ✅ |
| 40 | **Editor visual do certificado** — arte de fundo, texto por variáveis, posicionamento por milímetros (arrastando ou digitando, sem JavaScript), cinco modelos e prévia pelo mesmo renderizador do PDF; o desenho congela no certificado e sem modelo vale o desenho antigo. Declarou E54/E55 | ✅ |
| 41 | **Vitrine do patrocínio** — a cota define cor e tamanho da logo na página pública (Pequena · Média · Grande · Destaque), com prévia do cartão e amostras de cor; a coluna de cor existia desde a FASE 17 e não tinha leitor | ✅ |
| 42 | **Experiência do patrocinador** — área de **só leitura** por **vínculo** (não pelo papel), **QR do estande** imprimível e XP/carta **uma vez por pessoa por QR**. … | ✅ |
| 43 | **Catálogo de gamificação** (auditoria dos gatilhos → **editar** e **excluir** carta e missão, com exclusão **LÓGICA**: a carta sai do catálogo mas **fica no álbum de quem a ganhou**, e é recusada quando é prêmio de missão/QR; a missão preserva progresso e XP resgatado); e os fatos que não … | ✅ |
| 44 | **Perfil público do participante** — `/u/<handle>` com **quinze campos** em três níveis (internet · quem participa da instituição · só eu), pacote **campo a campo** por allowlist testada, **404 para perfil todo privado**, e a página **só existe onde a pessoa participa** (o `user` é global: a … | ✅ |
| 45 | **Equipe do evento na página pública** — bloco que o organizador adiciona ou não, com o corpo lido das equipes REAIS do evento na renderização; a etiqueta é o nome da equipe (quem está em duas aparece uma vez com as duas), líder … | ✅ |
| 46 | **Imagens em WebP e a foto do palestrante sem conta** — toda imagem é **reconvertida no servidor** na confirmação (o original é apagado, perda calibrada na foto e nenhuma no logotipo, metadados descartados e orientação EXIF … | ✅ |
| 47 | **Área de conta e segurança da identidade** — `/conta` é **GLOBAL** (a identidade vale em qualquer instituição e existe sem vínculo): dados com confirmação no endereço novo e a senha atual como prova, foto em WebP, troca de senha … | ✅ |
| 48 | **Carta colecionável premium e compartilhamento** — palco **3D** com brilho holográfico e verso, geometria no DOMÍNIO; a apresentação é DADO (`holo`, `sheen`, `tilt`, `backUrl`) e o foil acende o brilho sozinho; o link é **POR … | ✅ |
| 49 | **Exportação com marca d'água e prazo · Trilha de identidade** (o CSV de dado pessoal virou **PEDIDO** com prazo de 24 h: `data_exports` guarda o ATO — autor, filtros, linhas, downloads e revogação — e o arquivo é **regerado no … | ✅ |
