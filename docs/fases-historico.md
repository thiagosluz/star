# Fases 1 a 25, 29 a 30, 31 a 35, 36 a 42, 43 a 49, 50 a 59, 60, 61 a 62, 63 a 65, 66 a 67, 68 a 69, 70 a 71, 72 a 74, 75 a 76, 77 a 78, 79 a 80, 81 a 82 e 83 — o histórico que saiu do `AGENTS.md`

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
> também sem uma linha reescrita. Na **FASE 86** a linha nova encostou no teto outra vez: as
> **sete mais antigas que restavam** — **50 a 56** — desceram juntas, e o fechamento da fase
> (o parágrafo de dívidas e o ponteiro) ainda pediu as **três seguintes**, **57 a 59**. As dez
> foram movidas **como estavam**, e o `AGENTS.md` terminou em **64.443 bytes**. Na **FASE 87** a
> linha nova e o parágrafo de dívidas encostaram no teto de novo: a **F60** desceu **como estava**
> e a tabela corrente passou a começar na **61**; o `AGENTS.md` terminou em **63.048 bytes**
> (a narrativa de dívidas foi reescrita mais curta; as **linhas de fase**, não — elas foram
> movidas como estavam). Na **FASE 89** a linha nova levou o `AGENTS.md` a **65.027 bytes** (acima do
> teto de 64.800): as **duas mais antigas que restavam** — **61** e **62** — desceram **como estavam**
> e a tabela corrente passou a começar na **63**; o `AGENTS.md` terminou em **64.493 bytes**. Na **FASE 91**
> a linha nova levou o `AGENTS.md` a encostar no teto novamente: as **três mais antigas que restavam** —
> **63 a 65** — desceram **como estavam** e a tabela corrente passou a começar na **66**; o `AGENTS.md` terminou
> em **64.620 bytes**. Na **FASE 92** a linha nova levou o `AGENTS.md` a encostar no teto novamente: as
> **duas mais antigas que restavam** — **66 e 67** — desceram **como estavam** e a tabela corrente passou a começar na **68**; o `AGENTS.md` terminou
> em **64.591 bytes**. Na **FASE 93** a linha nova levou o `AGENTS.md` a encostar no teto novamente: as
> **duas mais antigas que restavam** — **68 e 69** — desceram **como estavam** e a tabela corrente passou a começar na **70**; o `AGENTS.md` terminou
> em **64.630 bytes**. Na **FASE 94** a linha nova levou o `AGENTS.md` a encostar no teto novamente: as
> **duas mais antigas que restavam** — **70 e 71** — desceram **como estavam** e a tabela corrente passou a começar na **72**; o `AGENTS.md` terminou
> em **64.590 bytes**. Na **FASE 95** a linha nova levou o `AGENTS.md` a encostar no teto novamente: as
> **três mais antigas que restavam** — **72 a 74** — desceram **como estavam** e a tabela corrente passou a começar na **75**; o `AGENTS.md` terminou
> em **64.560 bytes**. Na **FASE 96** a linha nova levou o `AGENTS.md` a encostar no teto novamente: as
> **duas mais antigas que restavam** — **75 e 76** — desceram **como estavam** e a tabela corrente passou a começar na **77**; o `AGENTS.md` terminou
> em **64.541 bytes**. Na **FASE 97** a linha nova levou o `AGENTS.md` a encostar no teto novamente: as
> **duas mais antigas que restavam** — **77 e 78** — desceram **como estavam** e a tabela corrente passou a começar na **79**; o `AGENTS.md` terminou
> em **64.296 bytes**. Na **FASE 98** a linha nova levou o `AGENTS.md` a encostar no teto novamente: as
> **duas mais antigas que restavam** — **79 e 80** — desceram **como estavam** e a tabela corrente passou a começar na **81**; o `AGENTS.md` terminou
> com margem confortável abaixo de 64.800 bytes. Na **FASE 99** a linha nova levou o `AGENTS.md` a **64.903 bytes** (acima do teto);
> as **duas mais antigas que restavam** — **81 e 82** — desceram **como estavam** e a tabela corrente passou a começar na **83**; o `AGENTS.md`
> terminou com margem segura abaixo de 64.800 bytes. Na **FASE 101** a linha nova levou o `AGENTS.md` a encostar no teto novamente (64.937 bytes);
> a **mais antiga que restava** — **83** — desceu **como estava** e a tabela corrente passou a começar na **84**; o `AGENTS.md`
> terminou com margem confortável abaixo de 64.800 bytes.
>
> **Onde está o registro completo.** Cada fase tem o seu documento em `docs/fase-NN-*.md`
> (ADRs, lições aprendidas, evidências e comandos), e o `README.md` traz o índice da
> documentação.
>
> **Onde está a tabela corrente.** No [`AGENTS.md`](../AGENTS.md), §9: ela guarda as fases
> recentes e o estado atual (hoje, da **83** à **99**). A tabela abaixo é histórica e **não
> cresce com fase nova** — ela cresce só por MOVIMENTO: quando o estado encosta no teto, a
> fase mais antiga ainda na corrente desce para cá.
>
> **A ordem é a cronológica da tabela original**, não a numérica: a numeração identifica o
> TEMA, e é o humano quem o escolhe pelo nome — por isso a F16, a F17, a F23, a F24 e a F25
> vieram antes da F15, e a F21 foi entregue depois de todas. As fases movidas na FASE 82, na
> FASE 83, na FASE 84, na FASE 85, na FASE 86, na FASE 87, na FASE 89, na FASE 91, na FASE 92, na FASE 93, na FASE 94, na FASE 95, na FASE 96, na FASE 97 e na FASE 98 entram no fim, na ordem em que estavam.
>
> **Nota de rebrand.** O produto passou a se chamar **Koveno** em novembro de 2026. Este
> arquivo e os documentos de fase continuam dizendo **EventFlow** porque são registro do que
> foi entregue, não descrição do estado atual. Ver `README.md` §11 e `AGENTS.md` §1.

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
| 50 | **Mutirão de dívidas II** — onze dívidas (**C7, E26, E49, E50, E51, E52, E53, E55, E59, E71 e H5**), com **cinco defeitos reais** no caminho. Detalhe em `docs/fase-50-mutirao-de-dividas-ii.md` | ✅ |
| 51 | **Mutirão de dívidas III** — onze dívidas (**E7, E19, E32, E37, E42, E57, E58, E63, E66, E70 e E73**) e um **defeito real de INTEGRIDADE** (a assinatura entrou no veredito público e no download). Detalhe em `docs/fase-51-mutirao-de-dividas-iii.md` | ✅ |
| 52 | **"Fechar o que abrimos"** — a **dívida que nós criamos**: o **token de aviso** em claro × escuro com contraste **medido** e catraca que lê o CSS (6,44:1 / 7,09:1 no claro; 9,17:1 no telão), com o **portão WCAG AA sem isenções**; **um único `<main>` por tela** … | ✅ |
| 53 | **Painel de prontidão e áreas do evento** — a raiz do evento diz **o que falta para o evento ficar pronto** (pendências com efeito, gravidade, ordem e o caminho que resolve), e a faixa de links virou **grade de cartões nos quatro grupos**, … | ✅ |
| 54 | **O selo de contagem nos cartões** — cada área da raiz diz quanto há lá dentro, contado por evento e só sobre o que vale, em uma leitura; a frase é regra de domínio (zero aparece, `null` é "não sei" e vira SEM SELO) | ✅ |
| 55 | **As seções da raiz viram páginas com cartão** — as quatro sanfonas viraram **páginas** e a raiz ficou **prontidão + mapa**: 341 linhas (eram 955), **ZERO `<details>`** no E2E, `data-testid` preservados e 7 specs reapontados | ✅ |
| 56 | **Mutirão de dívidas da Jornada do participante** — nove dívidas do tema E em 4 fatias (fila no EVENTO + promoção com prazo, paginação e retirada da submissão, miniatura e WebP). … | ✅ |
| 57 | **Gantt e calendário das demandas** — duas vistas novas no quadro da F38 (`?vista=kanban\|gantt\|calendario`): eixo de dias no fuso do evento, barra com `startAt` ou criação (**estimada**) e calendário no dia do PRAZO. Uma leitura, três vistas, links | ✅ |
| 58 | **As telas novas no portão de acessibilidade** — `/demandas` (três vistas) e `/superadmin/denuncias` no `axe` WCAG AA; o **contraste do calendário (2,9:1)** foi corrigido, sem isenção nova. ADR-317/318 | ✅ |
| 59 | **O item do patrocinador e a barra que recolhe** — o item do menu passou a depender do **VÍNCULO** (`sponsor_users` ativo), não de `sponsor:read` (pacote mínimo, que fazia a área aparecer para revisor e dono); e a barra lateral ganhou dois estados (`full` × `rail`), com o estado em **cookie no servidor** | ✅ |
| 60 | **O que se oculta fica oculto · landmark em toda tela · suíte E2E estável** — **E79**: a ocultação passou a valer em toda superfície que cita a pessoa, inclusive o **sorteio público**; **I2** … | ✅ |
| 61 | **Modo noturno (dívida H3)** — a escala escura troca **só a camada de tokens**, com **três estados** (Claro · Escuro · Sistema) valendo **sem cookie e sem JavaScript**; controle no menu de conta e em `/conta`, com contraste **medido**. … | ✅ |
| 62 | **A tela medida · a suíte honesta · dois fechamentos** — **H6**: regressão visual com `toHaveScreenshot` (12 snapshots, `maxDiffPixelRatio: 0`, `threshold` 0,04 **medido**); **I3**: espera que repete o gesto, `workers: 1` e `npm run e2e:clean`; **E80/E81** | ✅ |
| 63 | **A aparência do visitante** — o visitante anônimo escolhe a aparência no rodapé das páginas públicas da plataforma: um componente só, sem JavaScript, no mesmo cookie `ef_tema`; a página do evento ficou de fora (o modo é do organizador) e um teste prende isso | ✅ |
| 64 | **A página pública da instituição** — `/t/<slug>` virou a **vitrine da casa** (capa, identidade, três grupos por DATA e blocos do editor); sem página publicada serve a listagem. … | ✅ |
| 65 | **O dia do evento na mão do participante** — favoritar é **INTENÇÃO** e inscrever-se é **LUGAR**; a **"minha agenda"** une as duas marcas com **aviso de choque** sem bloquear; a grade sai em **`.ics`**. … | ✅ |
| 66 | **O rótulo que ficou fora do portão** — o `eyebrow` media **4,44:1** sobre a `--ef-background` e sobreviveu à F65 porque a aba **"Programação"** não estava no portão; passou a `.ef-muted` (**5,08:1** / **5,91:1**). … | ✅ |
| 67 | **Mala direta por fatos reais** — catálogo de 15 condições com frase explicativa, composição que recusa em vez de falhar aberto e catraca catálogo↔construtor; aba "Segmentos" com contagem, prévia mascarada e outbox; descadastro com token próprio. Portão 20 → 23; visual 19 → 21. ADR-338 … 340 | ✅ |
| 68 | **O evento que não era de três dias** — a chamada vira **interruptor do evento** (`usesCall`; ausente **não** desliga) e as **duas colunas da janela são REMOVIDAS**; a chamada da F33 é a única fonte da verdade e o **`CFP_CLOSED` passa a ser devolvido … | ✅ |
| 69 | **Mutirão dos pequenos** — cinco dívidas quitadas: **E86** (margem de deslocamento pura de 15 min), **E82** (ranking mascarado pós-ordem), **E84** (papéis semânticos no tema do evento, 2 casos WCAG AA), **E83** (gesto repetido) e **E88** (motivo do descadastro sem atraso). ADR-344 … 346 | ✅ |
| 70 | **A inscrição que não deixa buraco · o formulário que o organizador monta** — reserva de vaga movida para o evento (`EVENT_AUTO`), `registrationRequiresMembership` no servidor e formulário por evento com allowlist de 6 tipos (ADR-347 … 349) … | ✅ |
| 71 | **A vitrine viva da plataforma · Descoberta e expansão institucional** — descoberta unificada em `/eventos` (abas + redirect 308), taxonomia `EventCategory`, landing com destaques e `/para-instituicoes` com leads (ADR-350 … 353) … | ✅ |
| 72 | **A API de leitura do evento** — `/api/v1` por evento com **projeção única** (`getPublicEventView`), **chave selada por evento**, 5 rotas, ETag/304 sem `generatedAt`, `Vary: Authorization`, 120/min e 401 uniforme (ADR-354 … 356) … | ✅ |
| 73 | **O resultado da chamada que o organizador publica** — publicar deixou de ser decidir: `SEM_RESULTADO`/`RASCUNHO`/`PARCIAL`/**`FINAL` travado**, lista derivada mas **escolhida**, quatro gestos sem JavaScript (ADR-357 … 359) … | ✅ |
| 74 | **A proposta que exige anexo e não pede** — a POSSE do upload vem antes do `inspectObject`, a recusa `NOT_READY` devolve o rascunho e o link, rascunho deixa de ser proposta recebida e a cegueira HERDA da trilha. **E46 re-escopada** (ADR-360 … 362) … | ✅ |
| 75 | **O refactor que mede antes** — a rede de **66 casos** veio antes do movimento; **16** guardas migradas para `guardAction` (+ a `registration` traduzida), com **4 exceções declaradas** (−760 linhas, não 1.500) e catálogo que reprova a cópia nova; a **leitura** extraída dos dois serviços (−2.324 linhas, escrita na mesma transação, catraca por AST); o **contexto** resolvido uma vez por render (2 + 2 → 1 + 1, ≈8 ms — em HTTP é ruído); e as **páginas de erro por área** (0 → 6 arquivos). ADR-363 … 365 | ✅ |
| 76 | **O mutirão dos 500 que deviam ser 404** — o id malformado era **500 exclusivo do FORMATO** (25 de 42): `isUuid` no domínio + `requireUuidParam` (404 antes de consultar) em 23 páginas/24 params e 9 rotas/11 params; a query não é endereço (3 telas ignoram e anunciam), a API ganhou um envelope `{ok:false,code,message}` e a régua **400 = entrada × 404 = endereço**; a catraca achou 2 buracos e a tabela de 35 casos reprovou a si mesma. ADR-366 … 368 | ✅ |
| 77 | **O organizador novo** — o **caminho de partida** (3 fatias com os fatos do render, dentro da prontidão, "pronto" proibido por varredura e o alvo resolvido NO CATÁLOGO — o que consertou o link morto de `sem-programacao`); a **exportação na raiz** (o recorte na PROJEÇÃO, 3/3/210 → 2/2/90, o XP do livro-razão, 3 colunas fora e o `ATTENDANCES_CSV` em formato longo, com migração); e o **demo de LEITURA** (`/t/<slug>/exemplo` por vínculo + catraca de escrita provada por hash). ADR-369 … 371 | ✅ |
| 78 | **O topo único** — a dívida **H1** fechada: **PageHeader server** (split de `navigation.tsx`, sem ~96 ilhas de cliente), com `eyebrow` = grupo de navegação da fonte única, **volta derivada da trilha** e `descriptionTestId`; **81 das 96 páginas migradas** e **15 exceções** motivadas (tema do evento, heróis, renderizador próprio e redirects); **`text-headline`** (16px) eliminado e **6 telas sem `<h1>`** corrigidas. Catracas: **fonte** + **12 telas** no navegador. ADR-372 … 374 | ✅ |
| 79 | **O `AGENTS.md` volta a respirar** — as fases **1 a 25** saíram da tabela da §9 e foram **movidas como estavam** para `docs/fases-historico.md` (nenhuma linha reescrita), com um ponteiro de três linhas no lugar; a tabela corrente ficou com folga real e uma catraca nova reprova fase histórica na tabela e fase corrente no histórico. ADR-375 | ✅ |
| 80 | **O ESLint 10, sem mudar uma linha de código** — `eslint` de `^9.39.5` para `^10.13.0` (o alvo medido): **920 arquivos lintados, 0/0** (o mesmo número de antes), `typecheck` 0, **4389 testes**, `build` OK e `npm ci` limpo com o lock novo; os três plugins do `eslint-config-next` (react, jsx-a11y e import) ainda declaram peer `^9` e o npm avisa `ERESOLVE` sem falhar — compatibilidade medida, não declarada; o E2E mediu **6 vermelhos** (3 de `label-content-name-mismatch`, expostos pelo `axe-core` 4.14; 2 de imagem pela seção mascarada que cresce com o dado; 1 intermitente de minuto no `f65`), nenhum do ESLint. ADR-376 | ✅ |
| 81 | **O rótulo que cabe no nome · a altura que não depende do dado** — os **3 `aria-label`** passaram a **começar** pelo texto visível (`Baixar .ics…`, `Adicionar a próxima…`, `Baixar a minha agenda…`), com catraca de fonte de **6 casos**; a seção de destaques da raiz passou a reservar **duas fileiras de cartão** (498 px = 2 × 237 + vão) e o resumo a uma linha, então a página mede **714 px de seção / 3334 px de página** com 0 a 6 eventos — provado com **um evento a mais** e o `f62` **duas vezes a 0 px**, sem re-basear; o intermitente de minuto do `f65` virou determinístico (a expectativa usa o instante gravado); o portão fechou **39/39** e o `f62` **23/23**. ADR-377 | ✅ |
| 82 | **A porta de entrada** — o destino de quem entra virou **regra pura** (`resolveEntryDestination`: `redirectTo` **OVERRIDE** → plataforma → vínculo `ACTIVE` → convite → `/eventos`, com **14 recusas** de destino), consumida só na ENTRADA por um adaptador que não derruba o login; o **`redirectTo` do login, morto**, voltou a valer sem `tenantSlug` e o `//evil.test` do 2FA foi fechado por **uma** validação; o rodapé do seletor passou a **"Ir ao painel da instituição"** (com um vínculo a linha é `<span>`, então era o único caminho) e o bloco de conta de `/superadmin` ganhou a **porta de volta**; `/eventos` no portão achou `select-name` nos **3 filtros**. **62** testes unit + **8** E2E. ADR-378/379 | ✅ |
| 83 | **O vínculo com significado e o resíduo que ninguém apagava** — o contexto implícito deixou de ser "o primeiro vínculo `ACTIVE` na ordem alfabética" e passou a ter **desempate declarado** (`MEMBER` → `joinedAt` mais antigo → `tenantId`), com a **pergunta** (seletor) quando há **2+ vínculos e nenhuma escolha**; o cookie é a escolha já dada e vence a contagem. O vínculo criado por inscrição em `WAITLISTED` **permanece** (é como a pessoa vê a fila). **4 de 96 fixtures** (114 chamadas) deixaram de criar instituição sem apagar, presas por **catraca de AST** sem allowlist; o `joinedAt` deixou de ser reescrito pelo seed e pela inscrição (só o `create` o define), provado com o **seed real** e a data fixada em 2020; `docs/contas-de-teste.md:107` afirmava o contrário do código. **26 + 6 + 3** testes Vitest + **2** E2E; E2E **481 = 480 + 1 skip**. ADR-380/381 | ✅ |
